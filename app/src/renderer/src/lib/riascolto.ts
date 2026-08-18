/**
 * "Cosa hai detto?", risolto.
 *
 * Tiene in memoria gli ultimi trenta secondi di voce della stanza e sa
 * risuonarli. E' la risposta alla frase piu' ripetuta di qualunque chiamata:
 * qualcuno parla sopra, la linea perde un pacchetto, ti giri un attimo — e
 * l'unica soluzione esistente e' far ripetere la persona.
 *
 * Tre scelte che sono anche tre limiti, e sono volute.
 *
 * **Solo le voci.** Si prendono le tracce del microfono, non l'audio degli
 * schermi condivisi: se qualcuno sta mostrando un video, quello coprirebbe
 * proprio la frase che si sta cercando di recuperare.
 *
 * **Solo in memoria.** Un anello di campioni grezzi che si sovrascrive da solo:
 * niente file, niente disco, niente server. Uscendo dalla stanza sparisce, e
 * non esiste un momento in cui questi trenta secondi sono un oggetto che si
 * possa copiare da qualche parte. E' una differenza di sostanza rispetto a
 * "registrare": qui non c'e' niente da conservare.
 *
 * **Campioni a 16 bit.** L'anello e' un `Int16Array` e non un
 * `Float32Array`: meta' della memoria per la stessa cosa. A dieci minuti la
 * differenza e' fra 115 e 57 megabyte, che e' la differenza fra "si puo'
 * scegliere" e "meglio di no". La perdita e' quella fra un CD e un file
 * senza compressione, su un suono che ha gia' attraversato Opus e una rete:
 * non c'e' orecchio che la trovi.
 *
 * **Un ScriptProcessorNode, che e' deprecato.** Al suo posto ci andrebbe un
 * AudioWorklet, che gira sul thread dell'audio invece che su quello della
 * pagina. Ma un worklet e' un modulo da caricare per URL, e questa app gira
 * anche da `file://` con `script-src 'self'`: il caricamento verrebbe rifiutato
 * dalla CSP proprio dove serve di piu'. Il costo vero e' una copia di memoria
 * ogni 85 millisecondi, che non si misura.
 */

export interface Riascolto {
  /** Quanti secondi tiene questo anello: serve a sapere se va rifatto. */
  readonly secondi: number
  /** Attacca la voce di qualcuno al mescolatore. La chiave e' la sua identita'. */
  aggiungi(chiave: string, traccia: MediaStreamTrack): void
  togli(chiave: string): void
  /**
   * Suona gli ultimi `secondi`. Torna quanto dura davvero — all'inizio di una
   * chiamata l'anello e' ancora mezzo vuoto — oppure null se non c'e' niente.
   */
  suona(secondi: number, quandoFinisce: () => void): { durata: number; ferma: () => void } | null
  chiudi(): void
}

export function creaRiascolto(secondiMassimi: number): Riascolto {
  const contesto = new AudioContext()
  const frequenza = contesto.sampleRate

  const anello = new Int16Array(Math.ceil(secondiMassimi * frequenza))
  let indice = 0
  let riempiti = 0

  // Il mescolatore. Il compressore non e' un effetto: e' cio' che evita che
  // quattro persone che parlano insieme sommino le loro onde oltre il massimo
  // e tornino indietro come una lamiera.
  const mescolatore = contesto.createGain()
  const compressore = contesto.createDynamicsCompressor()
  const raccoglitore = contesto.createScriptProcessor(4096, 1, 1)

  // Un nodo muto in fondo alla catena.
  //
  // Un ScriptProcessor viene chiamato solo se qualcosa, a valle, sta tirando
  // audio: senza un collegamento fino alla destinazione non partirebbe mai.
  // Ma quello che raccoglie non deve uscire dalle casse — sarebbe la stanza
  // che si sente due volte — quindi passa da un guadagno a zero.
  const silenzio = contesto.createGain()
  silenzio.gain.value = 0

  mescolatore.connect(compressore).connect(raccoglitore).connect(silenzio)
  silenzio.connect(contesto.destination)

  raccoglitore.onaudioprocess = (evento) => {
    const dentro = evento.inputBuffer.getChannelData(0)
    for (let i = 0; i < dentro.length; i++) {
      // Il compressore a monte tiene quasi tutto sotto l'unita', ma "quasi"
      // non basta: un campione oltre il fondo scala, convertito senza
      // limitarlo, gira di segno e diventa uno schiocco.
      const v = dentro[i]
      anello[indice] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767)
      indice = (indice + 1) % anello.length
    }
    riempiti = Math.min(riempiti + dentro.length, anello.length)
  }

  const sorgenti = new Map<string, MediaStreamAudioSourceNode>()
  let inCorso: AudioBufferSourceNode | null = null

  /** Gli ultimi `quanti` campioni, in ordine cronologico e di nuovo in virgola mobile. */
  const ultimi = (quanti: number) => {
    const presi = Math.min(quanti, riempiti)
    const fuori = new Float32Array(presi)
    const inizio = (indice - presi + anello.length) % anello.length

    for (let i = 0; i < presi; i++) {
      fuori[i] = anello[(inizio + i) % anello.length] / 32767
    }
    return fuori
  }

  return {
    secondi: secondiMassimi,

    aggiungi(chiave, traccia) {
      if (sorgenti.has(chiave)) return
      const sorgente = contesto.createMediaStreamSource(new MediaStream([traccia]))
      sorgente.connect(mescolatore)
      sorgenti.set(chiave, sorgente)
      // Il contesto puo' essere sospeso se la finestra e' rimasta dietro a
      // lungo: senza risvegliarlo l'anello resterebbe pieno di silenzio.
      if (contesto.state === 'suspended') void contesto.resume().catch(() => {})
    },

    togli(chiave) {
      const sorgente = sorgenti.get(chiave)
      if (!sorgente) return
      sorgente.disconnect()
      sorgenti.delete(chiave)
    },

    suona(secondi, quandoFinisce) {
      inCorso?.stop()
      inCorso = null

      const campioni = ultimi(Math.ceil(secondi * frequenza))
      // Meno di mezzo secondo non e' una frase, e' un clic.
      if (campioni.length < frequenza / 2) return null

      const pezzo = contesto.createBuffer(1, campioni.length, frequenza)
      pezzo.copyToChannel(campioni, 0)

      const sorgente = contesto.createBufferSource()
      sorgente.buffer = pezzo
      sorgente.connect(contesto.destination)
      sorgente.onended = () => {
        if (inCorso === sorgente) inCorso = null
        quandoFinisce()
      }
      sorgente.start()
      inCorso = sorgente

      return {
        durata: campioni.length / frequenza,
        ferma: () => {
          try {
            sorgente.stop()
          } catch {
            // Gia' finito da solo: non c'e' niente da fermare.
          }
        }
      }
    },

    chiudi() {
      inCorso?.stop()
      raccoglitore.onaudioprocess = null
      for (const sorgente of sorgenti.values()) sorgente.disconnect()
      sorgenti.clear()
      raccoglitore.disconnect()
      mescolatore.disconnect()
      compressore.disconnect()
      silenzio.disconnect()
      anello.fill(0)
      void contesto.close().catch(() => {})
    }
  }
}
