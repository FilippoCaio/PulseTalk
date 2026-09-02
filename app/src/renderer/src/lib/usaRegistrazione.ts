import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client'
import type { RegolaRegistrazione } from '@shared/tipi'
import type { Api } from './api'
import { suona } from './suoni'
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
 *
 * ## La regola del server, e le tre cose che aggiunge
 *
 * Chi amministra decide a quali condizioni si registra qui dentro
 * (`TALK_REGISTRAZIONE`): libera come e' sempre stata, col consenso di tutti,
 * oppure vietata. Su «consenso di tutti» il pulsante non parte finche' resta
 * una persona che non ha risposto, e la registrazione **si ferma da sola** se
 * entra qualcuno che non ha detto di si': un consenso che vale solo per chi
 * c'era all'inizio non e' una regola, e' un momento.
 *
 * Le altre due cose valgono su ogni server, anche il piu' permissivo, perche'
 * non sono funzioni ma prove:
 *
 *   il **tono** che sentono tutti quando comincia e quando finisce, che non si
 *   spegne dalle impostazioni di chi registra;
 *
 *   la **riga nel registro** sul server - chi, cosa, quando, quanti c'erano e
 *   quanti avevano acconsentito - che risponde alla domanda «chi mi ha
 *   registrato il 4 marzo» senza dipendere dal ricordo di nessuno.
 *
 * Tutte e tre valgono per il client onesto. Un programma modificato registra
 * lo stesso, come puo' farlo OBS aperto di fianco: cio' che si puo' ottenere
 * non e' impedirlo, e' che la strada normale sia impossibile da usare di
 * nascosto — ed e' anche l'unica cosa che si possa scrivere in una
 * informativa.
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
  /** La regola di questo server. */
  regola: RegolaRegistrazione
  /**
   * Perche' non si puo' registrare adesso, se non si puo'.
   *
   * Una frase e non un booleano: il pulsante resta al suo posto, spento, e il
   * titolo dice cosa manca. Un pulsante che sparisce non spiega niente, e chi
   * lo cercava resta a chiedersi se l'ha sognato.
   */
  bloccato: string | null
}

export function usaRegistrazione(
  stanza: Room | null,
  {
    api,
    canale,
    nomeCanale,
    regola = 'libera'
  }: {
    /** Serve al registro sul server. Nullo nelle chiamate dirette, che non hanno un canale. */
    api: Api | null
    canale: number | null
    nomeCanale: string
    regola?: RegolaRegistrazione
  }
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
  /** La riga aperta nel registro del server, da chiudere quando si smette. */
  const riga = useRef<number | null>(null)
  /** Chi stava registrando al giro prima: serve al tono, non allo stato. */
  const registravano = useRef<Set<string>>(new Set())

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
    const attivi = tutti.filter((p) => p.attributes?.[ATTIVA] === 'si')

    setRegistrano(
      attivi.map((p) => ({
        nome: p.name || p.identity,
        // Chi non lo manda registra uno schermo: e' cio' che facevano tutte
        // le versioni prima che la chiamata intera si potesse registrare.
        cosa: p.attributes?.[COSA] === 'chiamata' ? 'chiamata' : ('schermo' as CosaSiRegistra)
      }))
    )

    /**
     * Il tono, a chiunque sia in stanza.
     *
     * Sul cambiamento e non sullo stato: `rileggi` gira a ogni evento della
     * stanza - qualcuno alza la mano, cambia nome, entra - e suonare a ogni
     * giro sarebbe un allarme antifurto. Suona quando compare un nome che
     * prima non c'era, e quando l'ultimo sparisce.
     *
     * Suona anche a chi entra in una stanza dove si sta gia' registrando, ed
     * e' voluto: e' esattamente il caso in cui bisogna accorgersene.
     */
    const adesso = new Set(attivi.map((p) => p.identity))
    const prima = registravano.current
    if ([...adesso].some((id) => !prima.has(id))) {
      suona('registrazioneIniziata', { sempre: true })
    } else if (prima.size > 0 && adesso.size === 0) {
      suona('registrazioneFinita', { sempre: true })
    }
    registravano.current = adesso
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

  /**
   * Chi c'e' in stanza e non ha detto di si'.
   *
   * Il proprio nome non compare: chi preme «registra» acconsente premendo, e
   * `avvia` scrive il si' negli attributi un istante dopo. Vedersi elencare
   * fra quelli che mancano mentre si sta per registrare sarebbe solo confusione.
   */
  const mancano = useCallback((): string[] => {
    if (!stanza) return []
    return [...stanza.remoteParticipants.values()]
      .filter((p) => p.attributes?.[CONSENSO] !== 'si')
      .map((p) => p.name || p.identity)
  }, [stanza])

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
    const suRegistro = riga.current
    corrente.current = null
    bersaglio.current = null
    riga.current = null

    // La riga sul server si chiude subito, senza aspettare che il file sia
    // scritto: il registro dice quando si e' smesso di registrare, non quando
    // il disco ha finito di girare.
    if (suRegistro !== null) {
      void api?.chiudiRegistrazione(suRegistro).catch(() => {
        // Una riga che resta aperta e' brutta ma innocua, e riprovare qui
        // vorrebbe dire una coda di richieste per una cosa che nessuno legge
        // in tempo reale.
      })
    }
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
      // La regola del server prima di tutto. Il pulsante di solito e' gia'
      // spento, ma «di solito» non e' una garanzia: fra il disegno del
      // pulsante e il clic puo' essere entrato qualcuno.
      const impedimento =
        regola === 'vietata'
          ? 'vietata'
          : regola === 'consenso-di-tutti' && mancano().length > 0
            ? 'senza consenso'
            : null

      if (impedimento) {
        if (scelto.nostra) scelto.video.stop()
        return
      }

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

      /**
       * La riga nel registro del server.
       *
       * Presenti e consensi contati adesso: dicono in che condizioni questa
       * registrazione e' cominciata, che e' la domanda a cui bisogna saper
       * rispondere dopo. Se la chiamata fallisce la registrazione va avanti
       * lo stesso - fermarla perche' il registro non risponde vorrebbe dire
       * che un server occupato spegne una funzione - e resta il tono, che
       * l'hanno sentito tutti.
       */
      if (api && canale !== null && stanza) {
        const presenti = stanza.remoteParticipants.size + 1
        const consensi =
          [...stanza.remoteParticipants.values()].filter(
            (p) => p.attributes?.[CONSENSO] === 'si'
          ).length + 1
        void api
          .apriRegistrazione(canale, { cosa: scelto.cosa, presenti, consensi })
          .then(({ id }) => {
            riga.current = id
          })
          .catch(() => {
            riga.current = null
          })
      }

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
    [annuncia, ferma, consensoMio, rispondi, regola, mancano, api, canale, stanza]
  )

  /**
   * Su «consenso di tutti», entra qualcuno che non ha risposto: si ferma.
   *
   * E' la meta' che rende la regola una regola. Chiedere il consenso solo
   * all'inizio vorrebbe dire che chi arriva al minuto due viene registrato
   * senza che nessuno gli abbia chiesto niente - e chi arriva dopo e' il caso
   * normale, non l'eccezione. Vale anche per chi ci ripensa: togliere il
   * consenso ferma tutto invece di togliere solo la propria voce.
   *
   * Il file gia' scritto si salva, come in ogni altro modo di finire: sono
   * minuti in cui tutti avevano detto di si'.
   */
  useEffect(() => {
    if (!mia || regola !== 'consenso-di-tutti') return
    if (mancano().length === 0) return
    ferma()
  }, [mia, regola, mancano, acconsentono, ferma])

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

  const senzaConsenso = regola === 'consenso-di-tutti' ? mancano() : []

  return {
    possibile: sapRegistrare(),
    regola,
    bloccato:
      regola === 'vietata'
        ? 'Su questo server le registrazioni sono vietate.'
        : senzaConsenso.length > 0
          ? `Qui si registra solo con il consenso di tutti: manca ${
              senzaConsenso.length === 1
                ? senzaConsenso[0]
                : `${senzaConsenso.length} persone (${senzaConsenso.slice(0, 3).join(', ')}${
                    senzaConsenso.length > 3 ? '…' : ''
                  })`
            }.`
          : null,
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
