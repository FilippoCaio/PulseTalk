import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client'
import {
  avviaRegistrazione,
  salvaRegistrazione,
  sapRegistrare,
  type Registrazione
} from './registrazione'

/**
 * Chi acconsente a essere registrato, chi sta registrando, e la registrazione.
 *
 * ## Il consenso vive negli attributi del partecipante, non sul server
 *
 * LiveKit li sincronizza da solo a tutta la stanza, e il gettone concede gia'
 * `canUpdateOwnMetadata` a chiunque: nessuna rotta nuova, nessuna tabella,
 * nessun evento SSE da tenere allineato. Ma la ragione vera non e' che costa
 * meno — e' che gli attributi hanno la **durata giusta**.
 *
 * Un consenso e' una cosa di questa conversazione. Vive quanto la stanza e
 * muore con lei, e alla chiamata dopo si riparte da no. Salvarlo nel database
 * vorrebbe dire che il "si" detto una sera vale anche fra tre mesi, in
 * un'altra conversazione, con altre persone dentro — cioe' esattamente il tipo
 * di consenso che non e' un consenso.
 *
 * ## Tre attributi, e sono tre cose diverse
 *
 *   `rec-consenso`  la mia voce puo' entrare in una registrazione
 *   `rec-attiva`    sto registrando io, adesso
 *   `rec-cosa`      cosa sto registrando: la chiamata, o una condivisione
 *
 * Il secondo non e' una gentilezza: con la registrazione che gira dentro a un
 * client, l'unico modo che gli altri hanno di saperlo e' che quel client lo
 * dica. Un programma modificato puo' mentire — come puo' farlo OBS aperto di
 * fianco — e non c'e' niente da fare. Cio' che si puo' fare e' rendere
 * impossibile non accorgersene quando la strada onesta viene usata.
 *
 * Il terzo e' arrivato dopo, ed e' un attributo nuovo invece di un valore
 * diverso dentro a `rec-attiva` di proposito: le versioni di prima leggono
 * quell'attributo cercando esattamente «si», e scriverci «chiamata» avrebbe
 * spento la barra rossa a chi non ha ancora aggiornato. Su una funzione che
 * esiste per farsi vedere, un cambio che la rende invisibile a meta' stanza e'
 * il peggiore dei difetti. Chi non lo manda viene letto come «schermo», che e'
 * l'unica cosa che quelle versioni sapevano fare.
 *
 * ## Cosa si registra
 *
 * Due cose, e sono diverse fra loro:
 *
 *   una condivisione   la traccia che sta gia' arrivando. Nel file c'e' il
 *                      contenuto e nient'altro: niente riquadri, niente facce.
 *   la chiamata        la finestra di PulseTalk cosi' com'e'. Dentro ci
 *                      finisce anche chi ha la camera accesa, e per questo la
 *                      barra lo dice a chiare lettere invece di lasciarlo
 *                      scoprire a chi riceve il file.
 *
 * Il consenso resta quello che era — riguarda **le voci**, che sono l'unica
 * cosa che questo modulo mescola. Le immagini non si mescolano: o si registra
 * quella finestra o non la si registra, e l'unica difesa vera e' che tutti
 * sappiano che sta succedendo.
 */

const CONSENSO = 'rec-consenso'
const ATTIVA = 'rec-attiva'
const COSA = 'rec-cosa'

/** La chiamata cosi' com'e' sullo schermo, oppure una condivisione sola. */
export type CosaSiRegistra = 'chiamata' | 'schermo'

/** Cosa si e' scelto di registrare, deciso da chi preme il pulsante. */
export interface Bersaglio {
  cosa: CosaSiRegistra
  /** Come chiamarlo nella barra: «la chiamata», «lo schermo di Marco». */
  nome: string
  /** L'immagine che finisce nel file. */
  video: MediaStreamTrack
  /**
   * Vero se la traccia l'abbiamo catturata noi.
   *
   * Cambia una cosa sola, ma va saputa: alla fine si spegne. Quella di una
   * condivisione appartiene a LiveKit e la stanno guardando anche gli altri —
   * fermarla vorrebbe dire spegnere la condivisione a tutti smettendo di
   * registrare.
   */
  nostra: boolean
  /**
   * Da chi prendere l'audio delle condivisioni: un'identita' sola, oppure
   * `null` per chiunque stia condividendo, anche fra dieci minuti.
   */
  contenutoDi: string | null
}

export interface Registratore {
  /** Vero se questa macchina sa registrare: senza, l'interfaccia non offre niente. */
  possibile: boolean
  /**
   * Cosa ho risposto: si', no, oppure non ancora.
   *
   * Tre stati e non due, come per Auto Writer. La differenza fra "ha detto di
   * no" e "non ha ancora risposto" e' tutta: un no implicito lo si ottiene
   * anche da chi non ha visto la domanda, e su un consenso non si tira a
   * indovinare. Finche' e' null la barra fa la domanda a chiare lettere.
   */
  consensoMio: boolean | null
  rispondi: (si: boolean) => void
  /** Le identita' di chi ha detto di si', me compreso. */
  acconsentono: Set<string>
  /** Chi sta registrando adesso, e cosa. Vuoto quasi sempre. */
  registrano: { nome: string; cosa: CosaSiRegistra }[]
  /** Cosa sto registrando io, se sto registrando. */
  mia: { cosa: CosaSiRegistra; nome: string } | null
  /** Da quanti secondi. Zero se non e' in corso. */
  secondi: number
  /** Quante voci stanno entrando nel file adesso. */
  vociDentro: number
  avvia: (bersaglio: Bersaglio) => void
  ferma: () => void
}

export function usaRegistrazione(
  stanza: Room | null,
  nomeCanale: string
): Registratore {
  const [consensoMio, setConsensoMio] = useState<boolean | null>(null)
  const [acconsentono, setAcconsentono] = useState<Set<string>>(new Set())
  const [registrano, setRegistrano] = useState<{ nome: string; cosa: CosaSiRegistra }[]>([])
  const [secondi, setSecondi] = useState(0)
  const [vociDentro, setVociDentro] = useState(0)
  /**
   * Cosa sto registrando io, se sto registrando.
   *
   * Uno stato e non `corrente.current !== null`: un ref non fa ridisegnare, e
   * il pulsante sarebbe rimasto "Registra" per tutta la registrazione.
   */
  const [mia, setMia] = useState<{ cosa: CosaSiRegistra; nome: string } | null>(null)

  const corrente = useRef<Registrazione | null>(null)
  /** Cosa si sta registrando: serve a `ferma` e all'audio dei contenuti. */
  const bersaglio = useRef<Bersaglio | null>(null)

  /**
   * Chi acconsente, riletto da capo a ogni cambiamento.
   *
   * Ricalcolare tutto invece di aggiornare la voce che e' cambiata: l'insieme
   * ha al massimo qualche decina di elementi, e una lista che si aggiorna a
   * pezzi e' una lista che prima o poi diverge da cio' che dice la stanza.
   */
  const rileggi = useCallback((): void => {
    if (!stanza) return
    const tutti: Participant[] = [stanza.localParticipant, ...stanza.remoteParticipants.values()]

    setAcconsentono(
      new Set(tutti.filter((p) => p.attributes?.[CONSENSO] === 'si').map((p) => p.identity))
    )
    setRegistrano(
      tutti
        .filter((p) => p.attributes?.[ATTIVA] === 'si')
        .map((p) => ({
          nome: p.name || p.identity,
          // Chi non lo manda registra uno schermo: e' cio' che facevano tutte
          // le versioni prima che la chiamata intera si potesse registrare.
          cosa: p.attributes?.[COSA] === 'chiamata' ? 'chiamata' : ('schermo' as CosaSiRegistra)
        }))
    )
    const mio = stanza.localParticipant.attributes?.[CONSENSO]
    setConsensoMio(mio === 'si' ? true : mio === 'no' ? false : null)
  }, [stanza])

  useEffect(() => {
    if (!stanza) {
      setAcconsentono(new Set())
      setRegistrano([])
      setConsensoMio(null)
      return
    }
    rileggi()
    stanza
      .on(RoomEvent.ParticipantAttributesChanged, rileggi)
      .on(RoomEvent.ParticipantConnected, rileggi)
      .on(RoomEvent.ParticipantDisconnected, rileggi)
      .on(RoomEvent.Connected, rileggi)
    return () => {
      stanza
        .off(RoomEvent.ParticipantAttributesChanged, rileggi)
        .off(RoomEvent.ParticipantConnected, rileggi)
        .off(RoomEvent.ParticipantDisconnected, rileggi)
        .off(RoomEvent.Connected, rileggi)
    }
  }, [stanza, rileggi])

  const rispondi = useCallback(
    (si: boolean): void => {
      if (!stanza) return
      const prima = consensoMio
      // Si scrive subito nello stato locale invece di aspettare il giro dalla
      // SFU: e' un pulsante che si preme, e mezzo secondo di "non e' successo
      // niente" lo fa premere due volte.
      setConsensoMio(si)
      void stanza.localParticipant
        .setAttributes({
          ...stanza.localParticipant.attributes,
          [CONSENSO]: si ? 'si' : 'no'
        })
        .catch(() => {
          // Non e' passato: si rimette com'era. Un pulsante che dice si'
          // mentre la stanza sa altro e' peggio di un clic perso.
          setConsensoMio(prima)
        })
    },
    [stanza, consensoMio]
  )

  /**
   * Le voci di chi acconsente, tenute allineate mentre si registra.
   *
   * E' questo effetto a rendere il consenso revocabile davvero: cambia
   * l'insieme, e le sorgenti entrano o escono dal mescolatore senza fermare
   * niente. Gira anche quando qualcuno accende il microfono a meta'
   * registrazione, perche' la traccia prima non c'era.
   */
  useEffect(() => {
    const registrazione = corrente.current
    if (!registrazione || !stanza) return

    const tutti: Participant[] = [stanza.localParticipant, ...stanza.remoteParticipants.values()]
    const dentro = new Set(registrazione.vociDentro())

    for (const p of tutti) {
      const traccia = p.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
      const deveEsserci = acconsentono.has(p.identity) && !!traccia
      if (deveEsserci && !dentro.has(p.identity)) registrazione.includi(p.identity, traccia!)
      if (!deveEsserci && dentro.has(p.identity)) registrazione.escludi(p.identity)
    }
    // Chi se n'e' andato dalla stanza: la sua sorgente resta appesa a una
    // traccia morta finche' non la si stacca.
    for (const identita of dentro) {
      if (!tutti.some((p) => p.identity === identita)) registrazione.escludi(identita)
    }
    setVociDentro(registrazione.vociDentro().length)

    /**
     * L'audio delle condivisioni, con la stessa riconciliazione delle voci.
     *
     * Non chiede il consenso a nessuno — e' contenuto, non e' la voce di una
     * persona — ma entra ed esce dal vivo per la stessa ragione pratica: chi
     * condivide puo' accendere l'audio dopo, e registrando la chiamata intera
     * le condivisioni cominciano e finiscono mentre il file gia' scorre.
     */
    const contenutoDi = bersaglio.current?.contenutoDi ?? null
    const contenuti = new Set(registrazione.contenutiDentro())

    for (const p of tutti) {
      const suono = p.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.mediaStreamTrack
      const deveEsserci = !!suono && (contenutoDi === null || p.identity === contenutoDi)
      if (deveEsserci && !contenuti.has(p.identity)) {
        registrazione.includiContenuto(p.identity, suono!)
      }
      if (!deveEsserci && contenuti.has(p.identity)) registrazione.escludiContenuto(p.identity)
    }
    for (const identita of contenuti) {
      if (!tutti.some((p) => p.identity === identita)) registrazione.escludiContenuto(identita)
    }
  }, [acconsentono, stanza, mia, secondi])

  /**
   * Il cronometro.
   *
   * Batte anche quando non c'e' niente da contare per chi guarda, ed e'
   * voluto: `secondi` e' una delle dipendenze dell'effetto qui sopra, quindi
   * questo battito e' anche cio' che riporta dentro al mescolatore i microfoni
   * accesi a meta' registrazione. Un secondo di ritardo su un microfono appena
   * acceso e' accettabile; non accorgersene mai non lo sarebbe.
   */
  useEffect(() => {
    if (!mia) return
    const passo = window.setInterval(() => {
      const r = corrente.current
      if (r) setSecondi(Math.floor((Date.now() - r.iniziata) / 1000))
    }, 1000)
    return () => window.clearInterval(passo)
  }, [mia])

  const annuncia = useCallback(
    (cosa: CosaSiRegistra | null): void => {
      if (!stanza) return
      void stanza.localParticipant
        .setAttributes({
          ...stanza.localParticipant.attributes,
          [ATTIVA]: cosa ? 'si' : '',
          [COSA]: cosa ?? ''
        })
        .catch(() => {
          // Se l'annuncio non passa, la registrazione non parte: registrare
          // senza che gli altri lo sappiano e' esattamente cio' che questa
          // funzione non deve poter fare.
        })
    },
    [stanza]
  )

  const ferma = useCallback((): void => {
    const registrazione = corrente.current
    const cosa = bersaglio.current
    corrente.current = null
    bersaglio.current = null
    setMia(null)
    setSecondi(0)
    setVociDentro(0)
    annuncia(null)

    /**
     * La cattura della finestra e' roba nostra e va spenta: lasciarla accesa
     * vorrebbe dire tenersi un flusso video che nessuno guarda piu'. Quella di
     * una condivisione no — e' di LiveKit, e la stanno guardando anche gli
     * altri: fermarla spegnerebbe la condivisione a tutta la stanza.
     *
     * Dopo il registratore e non prima: una traccia che finisce fa fermare il
     * registratore per conto suo, ed e' esattamente mentre gli si sta
     * chiedendo l'ultimo pezzo.
     */
    const spegniLaNostra = (): void => {
      if (cosa?.nostra) cosa.video.stop()
    }

    if (!registrazione) {
      spegniLaNostra()
      return
    }
    void registrazione.ferma().then((dati) => {
      spegniLaNostra()
      if (dati) salvaRegistrazione(dati, nomeCanale)
    })
  }, [annuncia, nomeCanale])

  const avvia = useCallback(
    (scelto: Bersaglio): void => {
      if (corrente.current || !sapRegistrare()) {
        // La traccia era stata catturata per una registrazione che non parte:
        // lasciarla accesa vorrebbe dire tenersi una cattura dello schermo di
        // cui nessuno sa piu' niente.
        if (scelto.nostra) scelto.video.stop()
        return
      }
      corrente.current = avviaRegistrazione({ video: scelto.video })
      bersaglio.current = scelto
      setMia({ cosa: scelto.cosa, nome: scelto.nome })
      setSecondi(0)
      annuncia(scelto.cosa)

      // Chi preme registra acconsente, e va detto invece di darlo per scontato
      // in silenzio: prima la propria voce restava fuori dal file finche' non
      // si rispondeva anche alla domanda del consenso - che a chi ha appena
      // premuto «Registra» non viene nemmeno mostrata, perche' la barra in
      // quel caso mostra il cronometro. Il risultato era una registrazione con
      // dentro tutti tranne chi la stava facendo, cioe' meta' di ogni scambio.
      //
      // Passa dallo stesso `rispondi` di tutti gli altri, non da una
      // scorciatoia: cosi' il si' finisce negli attributi e lo vedono anche
      // gli altri, che e' l'unico modo perche' «chi acconsente» resti una
      // lista vera invece di una lista con un'eccezione implicita dentro.
      if (consensoMio !== true) rispondi(true)

      // Se chi condivide smette, la registrazione finisce da sola: continuare
      // su una traccia morta scriverebbe minuti di nero.
      scelto.video.addEventListener('ended', () => ferma(), { once: true })
    },
    [annuncia, ferma, consensoMio, rispondi]
  )

  // Uscendo dalla stanza con una registrazione aperta il file va salvato lo
  // stesso: e' roba gia' scritta, e buttarla via perche' si e' chiuso male
  // sarebbe la peggiore delle risposte.
  useEffect(() => () => {
    const registrazione = corrente.current
    const cosa = bersaglio.current
    corrente.current = null
    bersaglio.current = null
    if (registrazione) {
      void registrazione.ferma().then((dati) => {
        if (cosa?.nostra) cosa.video.stop()
        if (dati) salvaRegistrazione(dati, nomeCanale)
      })
    } else if (cosa?.nostra) {
      cosa.video.stop()
    }
    // Volutamente senza dipendenze: deve girare allo smontaggio e basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    possibile: sapRegistrare(),
    consensoMio,
    rispondi,
    acconsentono,
    registrano,
    mia,
    secondi,
    vociDentro,
    avvia,
    ferma
  }
}
