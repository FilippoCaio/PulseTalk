import { app, type BrowserWindow } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/tipi'

/**
 * L'audio di una condivisione, preso dal processo giusto invece che dalle
 * casse.
 *
 * Cio' che Electron sa fare da solo - `loopback` dentro `cattura.ts` - e'
 * prendere tutto quello che esce dall'uscita predefinita di Windows. Sembra la
 * stessa cosa e non lo e', e le due differenze si sentono tutte e due:
 *
 *   1. dentro c'e' anche PulseTalk, cioe' le voci di chi e' in chiamata. Chi
 *      guarda si sente rimandare indietro la propria voce e sente gli altri
 *      due volte, la seconda in ritardo. Non e' eco acustica e non si aggiusta
 *      con le cuffie: e' una copia digitale del flusso, e il flusso e' quello
 *      anche in cuffia;
 *   2. condividendo *una finestra* dentro ci finisce lo stesso tutto il
 *      sistema - le notifiche, il video nell'altra scheda, la musica.
 *
 * Windows sa fare la cosa giusta dal 2020 e Chromium non la espone: si chiama
 * process loopback, prende un PID e sa includere solo quell'albero di processi
 * o prendere tutto tranne quello. Le due modalita' sono esattamente i due
 * difetti qui sopra, e stanno in `native/audioprocesso/audioprocesso.cpp`.
 *
 * Qui si tiene acceso quell'eseguibile, uno per condivisione, e si passano al
 * renderer i campioni che scrive: 48000 Hz, due canali, 16 bit interi con
 * segno. Il renderer li rimette dentro una traccia vera - vedi
 * `renderer/src/lib/audioProcesso.ts` - e da li' in poi la condivisione non sa
 * di essere diversa da prima.
 *
 * Quando non si puo' - Windows troppo vecchio, l'eseguibile che manca perche'
 * nessuno l'ha compilato, il servizio audio che rifiuta - non si finge: si
 * torna un errore e chi ha chiesto ricade sul loopback di prima, che e'
 * peggiore ma esiste.
 */

/** Una cattura viva: il processo, e come farlo smettere. */
interface Cattura {
  processo: ChildProcess
  /** Il PID di cui stiamo prendendo (o evitando) l'audio. */
  bersaglio: number
}

const catture = new Map<string, Cattura>()
let contatore = 0

/**
 * Dove sta l'eseguibile.
 *
 * Impacchettato finisce fra le risorse, accanto ad app.asar; in sviluppo sta
 * in `resources/` dentro al progetto, dove lo lascia `compila.ps1`. Non e'
 * generato dalla build di npm apposta: compilarlo vuole Visual Studio, e chi
 * costruisce il pacchetto non deve averlo.
 */
function percorsoEseguibile(): string | null {
  const nome = 'audioprocesso.exe'
  const candidati = app.isPackaged
    ? [join(process.resourcesPath, nome)]
    : [join(app.getAppPath(), 'resources', nome), join(process.cwd(), 'resources', nome)]

  return candidati.find((p) => existsSync(p)) ?? null
}

/** Vero se questa macchina puo' catturare l'audio di un processo solo. */
export function audioDiProcessoDisponibile(): boolean {
  return process.platform === 'win32' && percorsoEseguibile() !== null
}

/**
 * L'handle della finestra dentro all'id di desktopCapturer.
 *
 * Chromium lo scrive come `window:<HWND>:<n>`, e su Windows quel numero in
 * mezzo e' proprio l'handle nativo. Per gli schermi l'id e'
 * `screen:<display>:<n>` e non c'e' nessuna finestra: quello e' l'altro caso.
 */
function finestraDi(sorgenteId: string): number | null {
  const pezzi = sorgenteId.split(':')
  if (pezzi[0] !== 'window') return null
  const handle = Number(pezzi[1])
  return Number.isFinite(handle) && handle > 0 ? handle : null
}

/**
 * Accende la cattura per una sorgente.
 *
 * Torna l'identificativo con cui arriveranno i campioni, oppure il motivo per
 * cui non si puo'. Il motivo va detto e non nascosto: chi condivide deve
 * sapere se sta mandando l'audio della sua applicazione o quello di tutto il
 * computer, che sono due cose diverse per chi ascolta.
 */
export function avviaAudioProcesso(
  finestra: BrowserWindow,
  sorgenteId: string
): Promise<{ id: string } | { errore: string }> {
  const eseguibile = percorsoEseguibile()
  if (!eseguibile) return Promise.resolve({ errore: 'La cattura per applicazione non c\'e\'.' })

  const handle = finestraDi(sorgenteId)
  // Una finestra: si prende l'albero di processi che la possiede, e nient'altro.
  // Uno schermo: si prende tutto tranne noi, che e' l'unico modo di non
  // rimandare indietro le voci della chiamata.
  const argomenti = handle
    ? ['--finestra', String(handle)]
    : ['--escludi', String(process.pid)]

  const processo = spawn(eseguibile, argomenti, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })

  const id = `ap${++contatore}`

  return new Promise((risolvi) => {
    let deciso = false
    let restoStderr = ''

    // Se non dice niente entro qualche secondo qualcosa e' bloccato: meglio
    // ricadere sul loopback di prima che restare senza audio e senza notizie.
    const scadenza = setTimeout(() => {
      if (deciso) return
      deciso = true
      processo.kill()
      risolvi({ errore: "La cattura dell'audio non e' partita." })
    }, 6000)

    processo.stderr?.on('data', (pezzo: Buffer) => {
      restoStderr += pezzo.toString('utf8')
      const righe = restoStderr.split('\n')
      restoStderr = righe.pop() ?? ''

      for (const grezza of righe) {
        const riga = grezza.trim()
        if (!riga) continue

        if (riga.startsWith('PRONTO')) {
          if (deciso) continue
          const bersaglio = Number(/pid=(\d+)/.exec(riga)?.[1] ?? 0)

          // Condividere una finestra di PulseTalk stesso: prendendo il nostro
          // audio si rimanderebbe indietro l'intera chiamata, che e' proprio
          // la cosa da cui tutto questo file esiste per scappare.
          //
          // Solo per le finestre. Su uno schermo il PID che l'eseguibile
          // annuncia e' il *nostro*, perche' e' quello da escludere: senza
          // questa distinzione ogni condivisione di uno schermo intero veniva
          // rifiutata come se fosse una finestra di PulseTalk, cioe' proprio
          // il caso piu' comune di tutti.
          if (handle && bersaglio === process.pid) {
            deciso = true
            clearTimeout(scadenza)
            processo.kill()
            risolvi({ errore: 'Non si puo\' condividere l\'audio di PulseTalk stesso.' })
            return
          }

          deciso = true
          clearTimeout(scadenza)
          catture.set(id, { processo, bersaglio })
          risolvi({ id })
          continue
        }

        if (riga.startsWith('ERRORE')) {
          if (deciso) continue
          deciso = true
          clearTimeout(scadenza)
          processo.kill()
          risolvi({ errore: riga.replace(/^ERRORE\s+\S+\s*/, '') || 'cattura rifiutata' })
        }
      }
    })

    // I campioni, cosi' come escono. Non si accumula niente qui in mezzo: chi
    // li riceve ha una coda sua, ed e' li' che si decide cosa fare quando
    // arrivano piu' in fretta di quanto si consumino.
    processo.stdout?.on('data', (pezzo: Buffer) => {
      if (finestra.isDestroyed()) return
      finestra.webContents.send(IPC.audioProcessoDati, id, pezzo)
    })

    processo.on('error', () => {
      if (deciso) return
      deciso = true
      clearTimeout(scadenza)
      risolvi({ errore: "Non sono riuscito ad avviare la cattura dell'audio." })
    })

    processo.on('exit', () => {
      catture.delete(id)
      if (!finestra.isDestroyed()) {
        finestra.webContents.send(IPC.audioProcessoFinito, id)
      }
      if (deciso) return
      deciso = true
      clearTimeout(scadenza)
      risolvi({ errore: "La cattura dell'audio si e' chiusa subito." })
    })
  })
}

/**
 * Spegne una cattura.
 *
 * Chiudere stdin basterebbe - l'eseguibile lo sta guardando apposta - ma un
 * `kill` dopo non fa male e copre il caso in cui sia rimasto fermo dentro a
 * una chiamata di sistema.
 */
export function fermaAudioProcesso(id: string): void {
  const cattura = catture.get(id)
  if (!cattura) return
  catture.delete(id)
  try {
    cattura.processo.stdin?.end()
  } catch {
    // Gia' chiuso: e' il caso normale quando il processo e' morto per conto suo.
  }
  cattura.processo.kill()
}

/** Alla chiusura dell'applicazione, o quando la finestra se ne va. */
export function fermaTuttiGliAudioProcesso(): void {
  for (const id of [...catture.keys()]) fermaAudioProcesso(id)
}
