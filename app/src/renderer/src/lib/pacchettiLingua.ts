import { LINGUA_SORGENTE, type Dizionario } from '@shared/lingue'
import { impostaLingua } from './usaLingua'
import en from '../lingue/en'

/**
 * Da dove arrivano le traduzioni: da dentro, e dal server.
 *
 * ## Due sorgenti, e nessuna delle due e' facoltativa
 *
 * **Dentro all'applicazione** ci sono i pacchetti che escono con lei. Devono
 * esserci: la prima schermata che qualcuno vede e' quella che chiede
 * l'indirizzo del server, cioe' un momento in cui un server non c'e' ancora e
 * scaricare non e' un'opzione. Se le lingue arrivassero solo dalla rete, la
 * schermata in cui si sceglie dove andare sarebbe l'unica intraducibile — e
 * sarebbe proprio quella che serve a chi non conosce l'italiano.
 *
 * **Dal server** arrivano quelle aggiunte o corrette dopo. E' la stessa strada
 * degli aggiornamenti — una cartella servita se esiste — e vale la pena perche'
 * il server e' una macchina tua: aggiungere una lingua vuol dire lasciare un
 * file JSON in una cartella, senza ricompilare niente e senza aspettare che
 * qualcuno pubblichi una versione nuova.
 *
 * Quello del server **vince** su quello compilato dentro, chiave per chiave.
 * Cosi' si puo' correggere una traduzione sbagliata senza rifare l'app, e chi
 * non ha ancora scaricato niente vede comunque quella di prima invece del
 * vuoto.
 *
 * ## Se la rete non risponde non succede niente
 *
 * Un pacchetto che non arriva lascia quello compilato dentro, e in mancanza di
 * entrambi resta l'italiano. Nessun errore in faccia a nessuno: una lingua che
 * non si carica e' un peggioramento, non un guasto, e trattarla da guasto
 * vorrebbe dire fermare l'accesso perche' mancava una traduzione.
 */

/** I pacchetti che escono insieme all'applicazione. */
const DENTRO: Record<string, Dizionario> = { en }

/** Quanto si aspetta il server prima di lasciar perdere e usare cio' che si ha. */
const ATTESA_MS = 4000

/**
 * Carica una lingua e la accende.
 *
 * `server` e' facoltativo: senza, si usano solo i pacchetti compilati dentro —
 * ed e' il caso della schermata che chiede l'indirizzo, dove un server non si
 * sa ancora quale sia.
 */
export async function caricaLingua(codice: string, server?: string | null): Promise<void> {
  if (codice === LINGUA_SORGENTE) {
    // L'italiano e' la lingua in cui e' scritto il sorgente: la chiave *e'* la
    // frase, quindi il dizionario vuoto e' esattamente la traduzione giusta.
    impostaLingua(codice, {})
    return
  }

  const dentro = DENTRO[codice] ?? {}
  // Si accende subito quello che si ha, senza aspettare la rete: meglio
  // l'interfaccia tradotta a meta' adesso che quella giusta fra due secondi.
  impostaLingua(codice, dentro)

  const daFuori = server ? await dalServer(codice, server) : null
  if (daFuori) impostaLingua(codice, { ...dentro, ...daFuori })
}

async function dalServer(codice: string, server: string): Promise<Dizionario | null> {
  const base = server.replace(/\/+$/, '')
  try {
    const risposta = await fetch(`${base}/lingue/${codice}.json`, {
      signal: AbortSignal.timeout(ATTESA_MS)
    })
    if (!risposta.ok) return null

    const letto: unknown = await risposta.json()
    if (!letto || typeof letto !== 'object' || Array.isArray(letto)) return null

    // Si tengono solo le coppie testo-testo. Un pacchetto scritto a mano puo'
    // contenere un numero o un oggetto per distrazione, e infilarlo
    // nell'interfaccia darebbe un `[object Object]` al posto di una frase.
    const pulito: Dizionario = {}
    for (const [chiave, valore] of Object.entries(letto as Record<string, unknown>)) {
      if (typeof valore === 'string' && valore) pulito[chiave] = valore
    }
    return Object.keys(pulito).length > 0 ? pulito : null
  } catch {
    // Server spento, rotta assente, rete lenta: si resta con cio' che c'e'.
    return null
  }
}

/** Le lingue per cui l'applicazione si porta dietro un pacchetto. */
export function tradotteDentro(): string[] {
  return [LINGUA_SORGENTE, ...Object.keys(DENTRO)]
}
