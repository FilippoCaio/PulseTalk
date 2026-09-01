import { ponte } from '../ponte'

/**
 * I campioni che arrivano dal processo condiviso, rimessi dentro a una traccia.
 *
 * Dall'altra parte del ponte c'e' un eseguibile che cattura l'audio di *un*
 * processo — o di tutto il computer tranne noi — e scrive campioni grezzi:
 * 48000 Hz, due canali, 16 bit interi con segno, interlacciati. Vedi
 * `main/audioProcesso.ts` per il perche' quella strada esista, che e' la parte
 * che conta.
 *
 * Qui c'e' solo il pezzo che li rimette in una `MediaStreamTrack`, cosi' che
 * da `pubblica.ts` in giu' nessuno debba sapere da dove vengono: e' una
 * traccia audio come quella che consegnava `getDisplayMedia`, e prende la sua
 * strada.
 *
 * **Un ScriptProcessorNode, che e' deprecato.** Al suo posto ci andrebbe un
 * AudioWorklet, che gira sul thread dell'audio invece che su quello della
 * pagina. Ma un worklet e' un modulo da caricare per URL, e questa
 * applicazione gira anche da `file://` con `script-src 'self'`: il
 * caricamento verrebbe rifiutato dalla CSP proprio dove serve. E' la stessa
 * scelta, per la stessa ragione, che c'e' in `riascolto.ts`.
 */

/** Quanto suona un campione: due canali da 16 bit. */
const BYTE_PER_QUADRO = 4
const FREQUENZA = 48000

/**
 * Quanto suono si tiene da parte prima di suonarlo.
 *
 * I campioni fanno un giro lungo — l'eseguibile, una pipe, il processo
 * principale, il ponte — e non arrivano a intervalli regolari: un pacchetto in
 * ritardo, con la coda vuota, e' un buco che si sente come uno schiocco.
 * Centoventi millesimi sono quello che serve a coprire i ritardi normali senza
 * che il suono vada dietro all'immagine in modo visibile.
 */
const CUSCINO_QUADRI = Math.round(FREQUENZA * 0.12)

/**
 * E quanto e' troppo.
 *
 * Se chi consuma va piu' piano di chi produce — succede quando la finestra
 * resta indietro per qualche secondo — la coda cresce e il suono arriva sempre
 * piu' in ritardo, per sempre. Oltre mezzo secondo si butta via il passato e
 * si torna al cuscino: meglio un salto solo che una condivisione che va
 * lentamente fuori sincrono e non ci torna piu'.
 */
const CODA_MASSIMA_QUADRI = Math.round(FREQUENZA * 0.5)

export interface AudioDiProcesso {
  /** La traccia da pubblicare, indistinguibile da una catturata. */
  traccia: MediaStreamTrack
  /** Vero se e' l'audio di una sola applicazione, falso se e' tutto tranne noi. */
  soloQuestaApplicazione: boolean
  chiudi(): Promise<void>
}

/**
 * Accende la cattura per una sorgente e restituisce la traccia.
 *
 * Torna `null` quando non si puo': nel browser, su una macchina senza
 * l'eseguibile, o se il servizio audio rifiuta. Non e' un guasto da mostrare —
 * chi chiama ricade sul loopback di sistema di Electron, che e' quello di
 * prima — ma il motivo si porta dietro, perche' cambia cosa sentiranno gli
 * altri e va detto.
 */
export async function catturaAudioDiProcesso(
  sorgenteId: string
): Promise<{ audio: AudioDiProcesso } | { errore: string }> {
  const esito = await ponte.avviaAudioProcesso(sorgenteId)
  if ('errore' in esito) return { errore: esito.errore }

  const id = esito.id
  const contesto = new AudioContext({ latencyHint: 'interactive', sampleRate: FREQUENZA })

  // La coda dei campioni ancora da suonare, in pezzi come sono arrivati.
  let coda: Int16Array[] = []
  let quadriInCoda = 0
  let lettiDalPrimo = 0

  // I byte di un campione spezzato a meta' fra due pacchetti. La pipe non sa
  // niente di campioni: taglia dove capita, e senza tenere il resto i due
  // canali si scambierebbero di posto per il resto della condivisione.
  let resto: Uint8Array = new Uint8Array(0)

  const accoda = (grezzi: Uint8Array): void => {
    let dati = grezzi
    if (resto.length) {
      const unito = new Uint8Array(resto.length + grezzi.length)
      unito.set(resto, 0)
      unito.set(grezzi, resto.length)
      dati = unito
    }

    const quadri = Math.floor(dati.length / BYTE_PER_QUADRO)
    const usati = quadri * BYTE_PER_QUADRO
    resto = dati.slice(usati)
    if (quadri === 0) return

    // Una copia, e non una vista sul buffer che arriva: quello lo possiede
    // il ponte, e tenerselo vorrebbe dire tenere in vita anche tutto il
    // pacchetto che c'era intorno.
    const campioni = new Int16Array(quadri * 2)
    const vista = new DataView(dati.buffer, dati.byteOffset, usati)
    for (let i = 0; i < campioni.length; i++) campioni[i] = vista.getInt16(i * 2, true)

    coda.push(campioni)
    quadriInCoda += quadri

    if (quadriInCoda > CODA_MASSIMA_QUADRI) {
      // Si tiene la fine, che e' il presente, e si butta l'inizio.
      let daButtare = quadriInCoda - CUSCINO_QUADRI
      while (daButtare > 0 && coda.length) {
        const primo = coda[0]
        const disponibili = primo.length / 2 - lettiDalPrimo
        if (disponibili > daButtare) {
          lettiDalPrimo += daButtare
          quadriInCoda -= daButtare
          daButtare = 0
        } else {
          coda.shift()
          lettiDalPrimo = 0
          quadriInCoda -= disponibili
          daButtare -= disponibili
        }
      }
    }
  }

  const smettiDiRicevere = ponte.onAudioProcessoDati((quale, campioni) => {
    if (quale === id) accoda(campioni)
  })

  let finita = false
  const smettiDiAspettare = ponte.onAudioProcessoFinito((quale) => {
    if (quale === id) finita = true
  })

  // Il nodo che consegna i campioni al grafo. Mille quadri sono venti
  // millesimi: abbastanza radi da non pesare sul thread della pagina, abbastanza
  // fitti da non aggiungere ritardo che si noti.
  const consegna = contesto.createScriptProcessor(1024, 1, 2)

  // Un ScriptProcessor viene chiamato solo se qualcosa lo tira. Una sorgente
  // costante a zero in ingresso e una destinazione in uscita sono i due
  // ganci che lo tengono vivo: senza il primo, con l'ingresso scollegato,
  // Chromium puo' decidere che non c'e' niente da processare.
  const zero = contesto.createConstantSource()
  zero.offset.value = 0
  zero.connect(consegna)
  zero.start()

  const destinazione = contesto.createMediaStreamDestination()
  consegna.connect(destinazione)

  /**
   * Se si sta suonando o si sta ancora riempiendo il cuscino.
   *
   * Comincia spento e si accende quando in coda c'e' abbastanza suono da
   * reggere un ritardo. Se la coda si svuota del tutto - la macchina che si
   * impunta, l'applicazione condivisa che smette di suonare - torna spento e
   * il cuscino si rifa': senza, si resterebbe sul filo, a suonare un pezzetto
   * e a lasciare un buco, per tutto il resto della condivisione.
   */
  let scorre = false

  consegna.onaudioprocess = (evento) => {
    const sinistro = evento.outputBuffer.getChannelData(0)
    const destro = evento.outputBuffer.getChannelData(1)
    const quanti = evento.outputBuffer.length

    if (!scorre && quadriInCoda >= CUSCINO_QUADRI) scorre = true

    for (let i = 0; i < quanti; i++) {
      if (!scorre || quadriInCoda === 0 || !coda.length) {
        // Un silenzio scritto e' meglio di un buco: la traccia continua a
        // scorrere, e chi ascolta non sente uno schiocco.
        if (scorre && quadriInCoda === 0) scorre = false
        sinistro[i] = 0
        destro[i] = 0
        continue
      }

      const primo = coda[0]
      const posizione = lettiDalPrimo * 2
      sinistro[i] = primo[posizione] / 32768
      destro[i] = primo[posizione + 1] / 32768

      lettiDalPrimo++
      quadriInCoda--
      if (lettiDalPrimo * 2 >= primo.length) {
        coda.shift()
        lettiDalPrimo = 0
      }
    }
  }

  await contesto.resume().catch(() => {})

  const traccia = destinazione.stream.getAudioTracks()[0]
  if (!traccia) {
    smettiDiRicevere()
    smettiDiAspettare()
    ponte.fermaAudioProcesso(id)
    await contesto.close().catch(() => {})
    return { errore: "Non sono riuscito a preparare l'audio della condivisione." }
  }

  /**
   * Fermare la traccia spegne anche l'eseguibile.
   *
   * Da qui in poi questa traccia gira per l'applicazione come una qualunque:
   * finisce dentro a LiveKit, viene scambiata da `replaceTrack`, fermata dai
   * cleanup di `pubblica.ts`. Tutti quei punti sanno fare una cosa sola —
   * `stop()` — e nessuno di loro ha motivo di sapere che dietro c'e' un
   * processo separato che sta registrando l'audio di qualcuno.
   *
   * Invece di inseguirli uno per uno, e di dimenticarne uno il giorno che se
   * ne aggiunge un altro, `stop()` vuol dire anche "spegni la cattura". La
   * traccia resta una `MediaStreamTrack` normale in tutto il resto.
   */
  const fermaDavvero = traccia.stop.bind(traccia)
  traccia.stop = (): void => {
    fermaDavvero()
    void chiudi()
  }

  let chiusa = false
  const chiudi = async (): Promise<void> => {
    if (chiusa) return
    chiusa = true
    smettiDiRicevere()
    smettiDiAspettare()
    if (!finita) ponte.fermaAudioProcesso(id)
    consegna.onaudioprocess = null
    zero.stop()
    zero.disconnect()
    consegna.disconnect()
    fermaDavvero()
    coda = []
    quadriInCoda = 0
    await contesto.close().catch(() => {})
  }

  return {
    audio: {
      traccia,
      soloQuestaApplicazione: sorgenteId.startsWith('window:'),
      chiudi
    }
  }
}
