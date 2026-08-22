import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'

/**
 * L'interfaccia servita da un'origine vera, invece che da file://.
 *
 * Sembra un giro largo per niente, e invece e' l'unica strada. Una pagina
 * caricata da `file://` ha un'origine **opaca**: per il browser vale `null`, e
 * non e' un dettaglio formale. Tutto cio' che sta fuori e deve sapere *chi* sta
 * chiedendo non ha modo di saperlo.
 *
 * Il caso concreto per cui questo file esiste: il player incorporato di
 * YouTube. Da `file://` risponde `onReady` — sembra funzionare — e poi rifiuta
 * ogni video con l'errore 153, "embedder non identificato". Provato: da
 * `file://` la durata resta 0 e il salto viene ignorato; dalla stessa identica
 * pagina servita su `http://127.0.0.1` il video parte e il salto arriva al
 * secondo giusto.
 *
 * Il ripiego precedente — allegare a mano un `Referer` alle richieste verso
 * YouTube — non basta e per giunta scriveva un dominio fisso dentro alla build
 * di chiunque.
 *
 * Perche' il loopback e non un `app://` registrato a mano: 127.0.0.1 e' una
 * delle poche origini che il browser considera **sicure** anche senza TLS, e
 * quindi `getUserMedia` continua a dare microfono e camera esattamente come da
 * `file://`. Uno schema inventato non sarebbe http, e YouTube tornerebbe al
 * punto di prima.
 *
 * Cosa NON cambia: le impostazioni dell'app installata vivono nel processo
 * principale e passano dall'IPC, non da `localStorage` — cambiare origine non
 * fa dimenticare niente a nessuno.
 */

/** Solo cio' che una interfaccia costruita da Vite puo' contenere. */
const TIPI: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8'
}

export interface Sito {
  /** L'indirizzo da dare a `loadURL`. E' anche l'origine della pagina. */
  url: string
  chiudi: () => Promise<void>
}

export async function avviaSito(cartella: string): Promise<Sito> {
  const radice = resolve(cartella)

  const server = createServer((richiesta, risposta) => {
    // Solo lettura: questo server esiste per consegnare tre file, non per
    // ricevere niente da nessuno.
    if (richiesta.method !== 'GET' && richiesta.method !== 'HEAD') {
      risposta.writeHead(405).end()
      return
    }

    void servi(radice, richiesta.url ?? '/', risposta)
  })

  // Solo loopback. Non e' una precauzione teorica: senza `127.0.0.1` esplicito
  // Node ascolterebbe su tutte le interfacce, e l'interfaccia di PulseTalk
  // sarebbe raggiungibile da chiunque stia sulla stessa rete.
  await ascolta(server)

  const porta = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${porta}/`,
    chiudi: () =>
      new Promise((fatto) => {
        server.close(() => fatto())
      })
  }
}

async function servi(radice: string, grezzo: string, risposta: NodeJS.WritableStream & { writeHead: (c: number, h?: Record<string, string>) => void; end: (d?: unknown) => void }): Promise<void> {
  let percorso: string
  try {
    percorso = decodeURIComponent(new URL(grezzo, 'http://127.0.0.1').pathname)
  } catch {
    risposta.writeHead(400)
    risposta.end()
    return
  }

  // La normalizzazione da sola non basta: si controlla che il file finito
  // stia davvero dentro alla cartella, o un `..%2f` ben piazzato leggerebbe
  // il disco di chi ha installato il programma.
  const dentro = normalize(join(radice, percorso === '/' ? 'index.html' : percorso))
  const ammesso = dentro === radice || dentro.startsWith(radice + sep)

  const file = ammesso ? await esiste(dentro) : null
  // Una pagina sola con la navigazione dentro: qualunque percorso che non sia
  // un file vero deve restituire index.html, non un 404.
  const scelto = file ?? (await esiste(join(radice, 'index.html')))

  if (!scelto) {
    risposta.writeHead(404)
    risposta.end()
    return
  }

  risposta.writeHead(200, {
    'content-type': TIPI[extname(scelto).toLowerCase()] ?? 'application/octet-stream',
    // L'interfaccia cambia a ogni aggiornamento e i nomi dei bundle portano
    // gia' l'impronta: una cache qui vorrebbe solo dire vecchie schermate
    // dopo un aggiornamento.
    'cache-control': 'no-store'
  })
  createReadStream(scelto).pipe(risposta)
}

async function esiste(percorso: string): Promise<string | null> {
  try {
    return (await stat(percorso)).isFile() ? percorso : null
  } catch {
    return null
  }
}
/**
 * Le porte da provare, in ordine, e perche' non se ne prende una a caso.
 *
 * La prima stesura chiedeva la porta al sistema (`listen(0)`) — sembra la cosa
 * pulita: nessuna collisione possibile, niente da ricordare. Il guaio e' che
 * la porta fa parte dell'**origine**, e l'origine e' cio' su cui Chromium
 * calcola il sale degli identificativi dei dispositivi. Porta diversa a ogni
 * avvio voleva dire `deviceId` diversi a ogni avvio: il microfono scelto ieri
 * non corrispondeva a niente stamattina, l'applicazione avvisava che non era
 * collegato, e nelle tendine la stessa camera compariva due volte — una vera e
 * una fantasma. La stessa cosa vale per qualunque altra memoria che il browser
 * tiene per origine.
 *
 * Quindi una porta fissa. Il rischio che qualcun altro la occupi resta, ed e'
 * il motivo per cui sono dieci invece di una: dieci tentativi nello stesso
 * intervallo alto e poco frequentato bastano, e chi arriva secondo scivola
 * sulla successiva restando comunque su un'origine stabile per se'.
 *
 * L'ultimo tentativo e' `0`, cioe' "quella che c'e'". Se la macchina ha tutte e
 * dieci occupate, un'origine che cambia e' meglio di un'applicazione che non
 * parte: si torna al fastidio di prima, non a una finestra vuota.
 */
const PORTE = [47821, 47822, 47823, 47824, 47825, 47826, 47827, 47828, 47829, 47830, 0]

async function ascolta(server: ReturnType<typeof createServer>): Promise<void> {
  for (const porta of PORTE) {
    try {
      await new Promise<void>((pronto, male) => {
        const rinuncia = (errore: Error): void => {
          server.removeListener('listening', riuscito)
          male(errore)
        }
        const riuscito = (): void => {
          server.removeListener('error', rinuncia)
          pronto()
        }
        server.once('error', rinuncia)
        server.once('listening', riuscito)
        server.listen(porta, '127.0.0.1')
      })
      return
    } catch (errore) {
      // Occupata da qualcun altro: si prova la prossima. Qualunque altro
      // errore non migliorerebbe cambiando numero, e viene rilanciato.
      if ((errore as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw errore
    }
  }
}
