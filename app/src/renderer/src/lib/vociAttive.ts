/**
 * Chi sta parlando, misurato qui invece che chiesto alla SFU.
 *
 * LiveKit lo sa gia' — `ActiveSpeakersChanged` — ma lo calcola sul server con
 * una finestra di 400 ms smorzata su due intervalli: fra il momento in cui
 * qualcuno apre bocca e il bordo verde passa quasi un secondo, piu' il viaggio
 * di rete. Su una conversazione a battute rapide quel ritardo si vede: il
 * bordo si accende su chi ha appena finito di parlare.
 *
 * Le tracce audio pero' arrivano qui gia' decodificate. Misurarle sul posto
 * costa un analizzatore per persona — niente, per venti persone — e toglie di
 * mezzo sia la finestra del server sia il viaggio di ritorno.
 *
 * Restano due accorgimenti che non sono opzionali:
 *
 *  - una **soglia**, altrimenti il respiro e la ventola accendono tutti;
 *  - un **tempo di rilascio**, altrimenti il bordo lampeggia fra una sillaba e
 *    l'altra, che e' peggio di un bordo lento.
 */

/** Sopra questo valore efficace si considera voce. Circa -36 dBFS. */
const SOGLIA = 0.015

/**
 * Quanto tenere acceso dopo l'ultimo suono sopra soglia.
 *
 * Le pause fra le parole stanno sotto i 200 ms; sotto quel tempo il bordo
 * sfarfalla a ogni sillaba.
 */
const RILASCIO_MS = 350

/** Ogni quanto guardare i livelli. Venti volte al secondo bastano all'occhio. */
const PASSO_MS = 50

export interface RilevatoreVoci {
  /** Comincia a misurare la traccia di qualcuno. */
  aggiungi(identita: string, traccia: MediaStreamTrack): void
  togli(identita: string): void
  /**
   * Il livello del microfono locale, che non passa da una traccia ricevuta.
   *
   * Lo fornisce chi chiama, perche' la catena del microfono vive altrove e
   * duplicarne l'analisi vorrebbe dire aprire due volte lo stesso dispositivo.
   */
  livelloLocale(identita: string, leggi: () => number): void
  /** Le identita' misurate qui: per le altre resta valido il dato della SFU. */
  misurate(): Set<string>
  chiudi(): void
}

export function creaRilevatoreVoci(quando: (chi: Set<string>) => void): RilevatoreVoci {
  const contesto = new AudioContext()
  const voci = new Map<
    string,
    {
      analizzatore: AnalyserNode
      campioni: Float32Array<ArrayBuffer>
      /** Va fermato: senza, la traccia resta agganciata al contesto per sempre. */
      stacca: () => void
    }
  >()

  let localeId: string | null = null
  let leggiLocale: (() => number) | null = null

  /** Fino a quando tenere acceso ciascuno. */
  const finoA = new Map<string, number>()
  let ultimo = ''

  const battito = window.setInterval(() => {
    const adesso = performance.now()

    const misura = (identita: string, livello: number): void => {
      if (livello >= SOGLIA) finoA.set(identita, adesso + RILASCIO_MS)
    }

    for (const [identita, voce] of voci) {
      voce.analizzatore.getFloatTimeDomainData(voce.campioni)
      let somma = 0
      for (let i = 0; i < voce.campioni.length; i++) somma += voce.campioni[i] * voce.campioni[i]
      misura(identita, Math.sqrt(somma / voce.campioni.length))
    }

    if (localeId && leggiLocale) misura(localeId, leggiLocale())

    const chi = new Set<string>()
    for (const [identita, scadenza] of finoA) {
      if (adesso < scadenza) chi.add(identita)
      else finoA.delete(identita)
    }

    // Si avvisa solo quando cambia davvero: venti stati identici al secondo
    // farebbero ridisegnare mezza interfaccia per niente.
    const firma = [...chi].sort().join(',')
    if (firma !== ultimo) {
      ultimo = firma
      quando(chi)
    }
  }, PASSO_MS)

  return {
    aggiungi(identita, traccia) {
      voci.get(identita)?.stacca()

      const stream = new MediaStream([traccia])
      const sorgente = contesto.createMediaStreamSource(stream)
      const analizzatore = contesto.createAnalyser()
      analizzatore.fftSize = 512
      sorgente.connect(analizzatore)

      voci.set(identita, {
        analizzatore,
        campioni: new Float32Array(analizzatore.fftSize),
        stacca: () => {
          sorgente.disconnect()
          analizzatore.disconnect()
        }
      })
    },

    togli(identita) {
      voci.get(identita)?.stacca()
      voci.delete(identita)
      finoA.delete(identita)
    },

    livelloLocale(identita, leggi) {
      localeId = identita
      leggiLocale = leggi
    },

    misurate() {
      const insieme = new Set(voci.keys())
      if (localeId) insieme.add(localeId)
      return insieme
    },

    chiudi() {
      window.clearInterval(battito)
      for (const voce of voci.values()) voce.stacca()
      voci.clear()
      finoA.clear()
      void contesto.close().catch(() => {})
    }
  }
}
