/**
 * Registrare cio' che si sta guardando, con sotto le voci di chi ha detto di si'.
 *
 * Il video arriva gia' pronto da fuori: o e' la traccia di una condivisione,
 * che sta gia' passando davanti agli occhi di tutti, o e' la cattura della
 * nostra finestra quando si registra la chiamata intera — vedi
 * `catturaChiamata.ts`. Qui non si sceglie: si registra quello che viene dato.
 * L'audio invece si costruisce, ed e' li' che sta tutto il senso di questo file.
 *
 * ## Il mescolatore e' il consenso
 *
 * Le voci entrano nel mescolatore una per una, e ognuna si puo' staccare mentre
 * la registrazione va avanti. Non e' un dettaglio di implementazione: e' cio'
 * che rende il consenso una cosa vera invece di una casella spuntata
 * all'inizio. Chi ci ripensa a meta' smette di essere registrato **da
 * quell'istante**, senza fermare la registrazione degli altri.
 *
 * E qui va detto il limite, perche' l'interfaccia lo deve dire a chi acconsente:
 * cio' che e' gia' finito nel file ci resta. Si mescola dal vivo, quindi non
 * esiste un momento successivo in cui si possa togliere una voce da un minuto
 * gia' scritto. Togliere il consenso ferma il seguito, non cancella il prima.
 *
 * La cura vera a questo sarebbe registrare una traccia separata per persona e
 * mescolarle alla fine — che e' quello che sa fare l'Egress di LiveKit, dal
 * server. Qui non c'e', e allora si dice come stanno le cose invece di
 * lasciarlo credere.
 *
 * ## Il compressore non e' un effetto
 *
 * Stessa ragione per cui sta nel riascolto: quattro persone che parlano insieme
 * sommano le loro onde, e la somma esce dal fondo scala. Senza, le sovrapposi-
 * zioni tornano indietro come una lamiera.
 *
 * ## Perche' webm e non mp4
 *
 * `MediaRecorder` in Chromium scrive webm e basta. Non e' una scelta: e' cio'
 * che c'e'. Si apre in qualunque lettore recente, e chi deve mandarlo a
 * qualcuno lo converte una volta.
 */

/** Cosa si puo' fare a una registrazione mentre e' in corso. */
export interface Registrazione {
  /** Quando e' cominciata, per il cronometro. */
  readonly iniziata: number
  /** Le identita' che stanno finendo nell'audio adesso. */
  vociDentro(): string[]
  /** Attacca una voce al mescolatore. Ripetuta sulla stessa identita' non fa niente. */
  includi(identita: string, traccia: MediaStreamTrack): void
  /** La stacca. Da qui in poi quella persona non e' piu' nel file. */
  escludi(identita: string): void
  /** Le chiavi dell'audio dei contenuti attaccati adesso. */
  contenutiDentro(): string[]
  /**
   * Attacca l'audio di una condivisione: non e' la voce di nessuno, e' cio'
   * che si e' scelto di mostrare. Il consenso su quello l'ha gia' dato chi ha
   * premuto «condividi».
   */
  includiContenuto(chiave: string, traccia: MediaStreamTrack): void
  escludiContenuto(chiave: string): void
  /** Chiude e restituisce il girato. Null se non e' uscito niente. */
  ferma(): Promise<Blob | null>
}

/**
 * I formati, dal migliore al piu' compatibile.
 *
 * VP9 fa file sensibilmente piu' piccoli a parita' di resa su uno schermo
 * condiviso — che e' quasi tutto testo fermo, cioe' il caso in cui i codec
 * moderni guadagnano di piu'. Se la macchina non ce l'ha si scende, e
 * l'ultimo caso e' "decidi tu", che in Chromium vuol dire comunque webm.
 */
const FORMATI = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

function formatoBuono(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return FORMATI.find((f) => MediaRecorder.isTypeSupported(f))
}

/** Vero se questo browser sa registrare. Nel dubbio il pulsante non compare. */
export function sapRegistrare(): boolean {
  return typeof MediaRecorder !== 'undefined' && formatoBuono() !== undefined
}

export function avviaRegistrazione({
  video
}: {
  /** L'immagine da registrare: una condivisione, o la finestra della chiamata. */
  video: MediaStreamTrack
}): Registrazione {
  const contesto = new AudioContext()

  const mescolatore = contesto.createGain()
  const compressore = contesto.createDynamicsCompressor()
  const uscita = contesto.createMediaStreamDestination()
  mescolatore.connect(compressore).connect(uscita)

  const sorgenti = new Map<string, MediaStreamAudioSourceNode>()

  /**
   * L'audio dei contenuti, in una mappa tutta sua.
   *
   * Due mappe e non una: le chiavi della prima sono identita' di persone, e
   * infilarci dentro qualcosa che persona non e' obbligherebbe a inventare un
   * prefisso che nessuna identita' possa avere, e poi a ricordarsi di filtrarlo
   * ovunque. Separate, il problema non esiste — `vociDentro` conta le voci
   * perche' dentro ci sono solo quelle, e nessun `escludi` puo' staccare per
   * sbaglio l'audio di una condivisione mentre toglie il consenso a qualcuno.
   *
   * Entrano ed escono dal vivo come le voci, e per un motivo pratico: chi
   * condivide puo' aggiungere l'audio dopo aver cominciato, e registrando la
   * chiamata intera le condivisioni vanno e vengono per tutto il tempo.
   */
  const contenuti = new Map<string, MediaStreamAudioSourceNode>()

  const attacca = (
    dove: Map<string, MediaStreamAudioSourceNode>,
    chiave: string,
    traccia: MediaStreamTrack
  ): void => {
    if (dove.has(chiave)) return
    const sorgente = contesto.createMediaStreamSource(new MediaStream([traccia]))
    sorgente.connect(mescolatore)
    dove.set(chiave, sorgente)
  }

  const stacca = (dove: Map<string, MediaStreamAudioSourceNode>, chiave: string): void => {
    const sorgente = dove.get(chiave)
    if (!sorgente) return
    sorgente.disconnect()
    dove.delete(chiave)
  }

  const pezzi: Blob[] = []
  const formato = formatoBuono()
  const registratore = new MediaRecorder(
    new MediaStream([video, ...uscita.stream.getAudioTracks()]),
    formato ? { mimeType: formato } : undefined
  )
  registratore.ondataavailable = (e) => {
    if (e.data.size > 0) pezzi.push(e.data)
  }
  // Un pezzo al secondo invece di uno solo alla fine: se l'applicazione muore
  // a meta' si perde l'ultimo secondo, non l'ora intera.
  registratore.start(1000)

  // Il contesto puo' nascere sospeso se la finestra e' rimasta dietro: senza
  // risvegliarlo si registrerebbe un'ora di silenzio senza un errore.
  if (contesto.state === 'suspended') void contesto.resume().catch(() => {})

  const iniziata = Date.now()
  let chiusa = false

  return {
    iniziata,

    vociDentro: () => [...sorgenti.keys()],

    includi: (identita, traccia) => attacca(sorgenti, identita, traccia),

    escludi: (identita) => stacca(sorgenti, identita),

    contenutiDentro: () => [...contenuti.keys()],

    includiContenuto: (chiave, traccia) => attacca(contenuti, chiave, traccia),

    escludiContenuto: (chiave) => stacca(contenuti, chiave),

    async ferma() {
      if (chiusa) return null
      chiusa = true

      const finito = new Promise<void>((risolvi) => {
        registratore.onstop = () => risolvi()
      })
      /**
       * `stop()` su un registratore gia' fermo lancia, e capita davvero:
       * quando la traccia finisce da sola — chi condivideva ha smesso, o si e'
       * chiusa la cattura della finestra — Chromium ferma il registratore per
       * conto suo un istante prima che arrivi la richiesta.
       *
       * Prima quel caso tornava `null`, cioe' buttava via l'intera
       * registrazione proprio nella situazione per cui era stata scritta la
       * scrittura a pezzi di un secondo: i pezzi c'erano tutti, ed erano gia'
       * sul posto. Adesso si aspetta solo se c'e' qualcosa da aspettare, e il
       * file si consegna comunque.
       */
      if (registratore.state !== 'inactive') {
        registratore.stop()
        await finito
      }

      for (const sorgente of [...sorgenti.values(), ...contenuti.values()]) {
        sorgente.disconnect()
      }
      sorgenti.clear()
      contenuti.clear()
      await contesto.close().catch(() => {})

      if (pezzi.length === 0) return null
      return new Blob(pezzi, { type: formato ?? 'video/webm' })
    }
  }
}

/**
 * Il nome del file, e come arriva sul disco.
 *
 * Un `<a download>` e non un giro per il processo principale: in Electron
 * quella e' gia' la strada che apre la finestra "Salva con nome" di Windows, e
 * nel browser scarica come qualunque altra cosa. Una rotta IPC in piu' avrebbe
 * aggiunto un file da tenere allineato per fare la stessa cosa in un posto solo
 * dei due.
 */
export function salvaRegistrazione(dati: Blob, canale: string): void {
  const quando = new Date()
  const due = (n: number): string => String(n).padStart(2, '0')
  const nome =
    `PulseTalk ${canale} ` +
    `${quando.getFullYear()}-${due(quando.getMonth() + 1)}-${due(quando.getDate())} ` +
    `${due(quando.getHours())}.${due(quando.getMinutes())}.webm`

  const url = URL.createObjectURL(dati)
  const a = document.createElement('a')
  a.href = url
  a.download = nome.replace(/[\\/:*?"<>|]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Non subito: revocare l'URL prima che il download sia partito lo annulla.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
