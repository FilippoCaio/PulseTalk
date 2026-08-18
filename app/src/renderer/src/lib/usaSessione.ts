import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
  type VideoTrack
} from 'livekit-client'
import type { Impostazioni, Ingresso, ModoAudioSistema, Sorgente } from '@shared/tipi'
import type { ModoAudio } from '@shared/qualita'
import { PRESET_CAMERA, type Limiti, type PresetSchermo } from '@shared/qualita'
import {
  accendiCamera,
  accendiMicrofono,
  catturaSchermo,
  chiudiCatenaMicrofono,
  impostaGuadagnoMicrofono,
  pubblicaSchermo,
  type SchermoPubblicato
} from './pubblica'
import { configuraSuoni, suona } from './suoni'
import { coloreDi } from './avatar'
import { ponte } from '../ponte'
import { creaRiascolto, type Riascolto } from './riascolto'

/**
 * La chiamata, vista da React.
 *
 * La verita' su chi c'e' e cosa sta trasmettendo ce l'ha l'oggetto `Room` di
 * livekit-client, e copiarla dentro allo stato di React sarebbe il modo piu'
 * rapido per avere due versioni che divergono. Quindi non si copia: si tiene la
 * stanza in un ref, si conta quante volte e' cambiata, e le liste si ricavano
 * a ogni disegno da quello che la stanza dice adesso.
 */

export interface Riquadro {
  id: string
  identita: string
  nome: string
  /**
   * `persona` c'e' sempre, uno per partecipante: mostra la camera se e'
   * accesa, altrimenti l'avatar. `schermo` compare solo quando qualcuno
   * condivide, e ce ne possono essere piu' d'uno a testa.
   *
   * Tenere la casella della persona anche senza video e' cio' che rende la
   * stanza una stanza invece di una griglia di finestre: si vede chi c'e'
   * mentre parla, non solo chi ha acceso qualcosa.
   */
  tipo: 'persona' | 'schermo'
  etichetta: string
  traccia: VideoTrack | null
  locale: boolean
  moderatore: boolean
  /** La traccia c'e' ma non e' ancora arrivato niente da mostrare. */
  inArrivo: boolean
  /** Sta parlando adesso: e' il bordo verde. */
  parla: boolean
  microfonoAcceso: boolean
}

export interface Persona {
  identita: string
  nome: string
  locale: boolean
  moderatore: boolean
  parla: boolean
  microfonoAcceso: boolean
  camera: boolean
  schermi: number
  qualita: ConnectionQuality
}

/**
 * Quanto forte si sente qualcuno, e da quale delle sue due bocche.
 *
 * Una persona che condivide lo schermo manda due suoni diversi sotto lo stesso
 * nome: la sua voce, e cio' che esce dal suo computer. Sono due cose che si
 * vogliono regolare separatamente — il gioco troppo alto sopra la voce di chi
 * lo commenta e' il caso di tutti i giorni — e LiveKit lo consente, perche'
 * `setVolume` accetta la sorgente.
 *
 * Il muto e' un interruttore a parte e non il cursore a zero: chi zittisce
 * qualcuno per due minuti vuole ritrovare il suo volume di prima, non doverlo
 * indovinare di nuovo.
 */
export interface Volumi {
  /** Il microfono di quella persona. */
  voce: number
  /** L'audio della sua condivisione. */
  schermo: number
  mutoVoce: boolean
  mutoSchermo: boolean
}

/** Quale dei due suoni di una persona. */
export type SorgenteAudio = 'voce' | 'schermo'

export const VOLUMI_INIZIALI: Volumi = {
  voce: 1,
  schermo: 1,
  mutoVoce: false,
  mutoSchermo: false
}

/**
 * Un "guarda qui" arrivato adesso.
 *
 * Le coordinate sono frazioni del video, da 0 a 1: chi indica ha il riquadro
 * grande e chi guarda ce l'ha nella striscia, e dei pixel non vorrebbero dire
 * niente per l'altro. Scadono da sole: un puntatore che resta e' un puntatore
 * che dopo due minuti indica una cosa che non c'e' piu'.
 */
export interface Puntatore {
  id: string
  /** Il `trackSid` del riquadro indicato. */
  schermo: string
  x: number
  y: number
  colore: string
  nome: string
}

export interface Messaggio {
  id: string
  da: string
  testo: string
  istante: number
  mio: boolean
}

function moderatoreDi(partecipante: Participant): boolean {
  // I metadati arrivano dentro al gettone firmato dal server: il client non
  // puo' fabbricarseli, ed e' per questo che ci si puo' disegnare sopra una
  // coroncina senza chiedere niente a nessuno.
  try {
    return !!JSON.parse(partecipante.metadata || '{}').moderatore
  } catch {
    return false
  }
}

function riquadriDi(
  partecipante: Participant,
  locale: boolean,
  cheParla: Set<string>
): Riquadro[] {
  const moderatore = moderatoreDi(partecipante)
  const nome = partecipante.name || partecipante.identity
  const parla = cheParla.has(partecipante.identity)
  const microfonoAcceso = partecipante.isMicrophoneEnabled

  const fuori: Riquadro[] = []
  let camera: TrackPublication | null = null
  let contatoreSchermi = 0

  partecipante.trackPublications.forEach((pubblicazione: TrackPublication) => {
    if (pubblicazione.kind !== Track.Kind.Video) return

    if (pubblicazione.source === Track.Source.Camera) {
      if (!pubblicazione.isMuted) camera = pubblicazione
      return
    }
    if (pubblicazione.source !== Track.Source.ScreenShare) return

    contatoreSchermi += 1
    fuori.push({
      id: pubblicazione.trackSid,
      identita: partecipante.identity,
      nome,
      tipo: 'schermo',
      etichetta: pubblicazione.trackName || `Schermo ${contatoreSchermi}`,
      traccia: (pubblicazione.track as VideoTrack | undefined) ?? null,
      locale,
      moderatore,
      inArrivo: !pubblicazione.track,
      // Uno schermo non parla mai.
      //
      // Il bordo verde risponde a una domanda sola — "chi sta parlando?" — e la
      // risposta e' sempre una persona. Acceso anche sulle condivisioni, chi
      // condivide due monitor si accendeva a tre riquadri per volta: la stanza
      // lampeggiava tutta insieme e l'unica informazione che quel colore
      // portava, cioe' dove guardare, si perdeva.
      parla: false,
      microfonoAcceso
    })
  })

  // La casella della persona, sempre, anche a camera spenta: dentro ci finisce
  // il video se c'e', l'avatar se non c'e'. L'id non e' quello della traccia —
  // che va e viene accendendo la camera — ma l'identita', cosi' React non
  // smonta e rimonta il riquadro a ogni accensione.
  fuori.unshift({
    id: `persona:${partecipante.identity}`,
    identita: partecipante.identity,
    nome,
    tipo: 'persona',
    etichetta: camera ? 'Camera' : '',
    traccia: (camera as TrackPublication | null)?.track as VideoTrack | undefined ?? null,
    locale,
    moderatore,
    inArrivo: !!camera && !(camera as TrackPublication).track,
    parla,
    microfonoAcceso
  })

  return fuori
}

function personaDa(partecipante: Participant, locale: boolean, cheParla: Set<string>): Persona {
  let schermi = 0
  let camera = false
  partecipante.trackPublications.forEach((p) => {
    if (p.kind !== Track.Kind.Video) return
    if (p.source === Track.Source.ScreenShare) schermi += 1
    if (p.source === Track.Source.Camera && !p.isMuted) camera = true
  })

  return {
    identita: partecipante.identity,
    nome: partecipante.name || partecipante.identity,
    locale,
    moderatore: moderatoreDi(partecipante),
    parla: cheParla.has(partecipante.identity),
    microfonoAcceso: partecipante.isMicrophoneEnabled,
    camera,
    schermi,
    qualita: partecipante.connectionQuality
  }
}

export interface Sessione {
  stanza: Room | null
  stato: ConnectionState
  errore: string | null
  motivoUscita: string | null

  riquadri: Riquadro[]
  persone: Persona[]
  messaggi: Messaggio[]
  /**
   * Le identita' di chi sta parlando adesso.
   *
   * Esce di qui perche' serve anche fuori dalla stanza: nella colonna dei
   * canali, sotto al vocale, il pallino verde su chi parla e' l'unica cosa che
   * dice cosa sta succedendo mentre si sta leggendo una chat.
   */
  parlanti: Set<string>

  microfonoAcceso: boolean
  cameraAccesa: boolean
  /** Non sento piu' nessuno: il volume di tutti a zero, senza disiscriversi. */
  sordina: boolean
  /** Il volume di tutta la stanza, che moltiplica quelli delle singole persone. */
  volumeGenerale: number
  schermiAttivi: { id: string; etichetta: string }[]
  /** Chi ha il microfono spento, dal vivo. Vale solo per il canale in cui si e'. */
  microfoniSpenti: Set<string>
  /** Il browser non lascia partire il suono finche' non si clicca. */
  audioBloccato: boolean
  sbloccaAudio(): Promise<void>

  /**
   * Il riascolto: quanti secondi ci sono in memoria adesso, e come suonarli.
   *
   * `riascoltoAttivo` dice che l'anello sta girando — serve alla stanza per
   * dirlo a chi c'e' dentro. `riascoltoInCorso` c'e' solo mentre sta
   * risuonando, e porta con se' quando finira': e' quello che disegna la
   * barretta che avanza.
   */
  riascoltoAttivo: boolean
  riascoltoInCorso: { fino: number; durata: number } | null
  riascolta(): void
  fermaRiascolto(): void

  /** I "guarda qui" ancora vivi, da disegnare sopra ai riquadri. */
  puntatori: Puntatore[]
  /** Indica un punto dello schermo di qualcuno: lo vedono tutti, lui sul monitor. */
  punta(schermo: string, x: number, y: number): void

  entra(ingresso: Ingresso, impostazioni: Impostazioni): Promise<void>
  esci(): Promise<void>

  alternaMicrofono(): Promise<void>
  alternaCamera(): Promise<void>
  alternaSordina(): void
  condividi(
    sorgente: Sorgente | null,
    preset: PresetSchermo,
    audioSistema?: ModoAudioSistema
  ): Promise<void>
  smettiDiCondividere(id?: string): Promise<void>
  manda(testo: string): void

  impostaVolumeGenerale(volume: number): void
  volumiDi(identita: string): Volumi
  impostaVolume(identita: string, sorgente: SorgenteAudio, volume: number): void
  alternaMuto(identita: string, sorgente: SorgenteAudio): void
}

export function usaSessione(impostazioni: Impostazioni): Sessione {
  const stanzaRef = useRef<Room | null>(null)
  const schermiRef = useRef<Map<string, SchermoPubblicato>>(new Map())
  const limitiRef = useRef<Limiti | null>(null)
  // Gli elementi <audio> di chi parla.
  //
  // Fuori da React di proposito: un <audio> che React rimonta perche' una lista
  // si e' riordinata riparte da zero, e chi lo stava ascoltando sente un buco.
  // Qui gli elementi nascono quando arriva la traccia e muoiono quando se ne
  // va, e nel mezzo React non li tocca.
  const audioRef = useRef<HTMLDivElement | null>(null)
  // Quando siamo entrati. Serve a distinguere un'uscita voluta da una caduta
  // subito dopo l'ingresso, che ha una causa sola e vale la pena nominare.
  const entratoRef = useRef(0)

  // Il contatore che fa ridisegnare. Non contiene niente: dice solo "la stanza
  // e' cambiata, riguardala".
  const [giro, avanza] = useState(0)
  const ridisegna = useCallback(() => avanza((n) => n + 1), [])

  const [stato, setStato] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [errore, setErrore] = useState<string | null>(null)
  const [motivoUscita, setMotivoUscita] = useState<string | null>(null)
  const [messaggi, setMessaggi] = useState<Messaggio[]>([])
  const [cheParla, setCheParla] = useState<Set<string>>(new Set())
  const [sordina, setSordina] = useState(false)
  const [audioBloccato, setAudioBloccato] = useState(false)
  const [volumeGenerale, setVolumeGenerale] = useState(1)
  const [puntatori, setPuntatori] = useState<Puntatore[]>([])
  /** Il monitor dietro a ogni schermo che sto condividendo io. */
  const schermiSuMonitorRef = useRef<Map<string, string | null>>(new Map())
  const [riascoltoAttivo, setRiascoltoAttivo] = useState(false)
  const [riascoltoInCorso, setRiascoltoInCorso] = useState<{ fino: number; durata: number } | null>(
    null
  )
  const riascoltoRef = useRef<Riascolto | null>(null)
  const fermaRef = useRef<(() => void) | null>(null)
  /**
   * Quanto abbassare il vivo mentre si riascolta.
   *
   * Non zero: chi continua a parlare mentre stai recuperando la frase di prima
   * deve restare sotto, non sparire — altrimenti si perde il pezzo nuovo per
   * sentire quello vecchio, e si e' punto e a capo.
   */
  const attenuazioneRef = useRef(1)
  const [volumi, setVolumi] = useState<Map<string, Volumi>>(new Map())

  // Gli stessi tre valori anche in dei ref.
  //
  // `applicaAudio` la chiamano i gestori di eventi della stanza, agganciati
  // una volta sola all'ingresso: se leggessero lo stato di React leggerebbero
  // per sempre quello del primo disegno, e un volume messo dopo non
  // arriverebbe mai a chi entra dopo.
  const volumiRef = useRef(volumi)
  const generaleRef = useRef(1)
  const sordinaRef = useRef(false)

  /** Smonta l'anello e dimentica quello che c'era dentro. */
  const spegniRiascolto = useCallback(() => {
    fermaRef.current?.()
    fermaRef.current = null
    attenuazioneRef.current = 1
    riascoltoRef.current?.chiudi()
    riascoltoRef.current = null
    setRiascoltoAttivo(false)
    setRiascoltoInCorso(null)
  }, [])

  /**
   * Porta i volumi decisi qui sopra i partecipanti veri.
   *
   * Si chiama a ogni cambiamento e a ogni arrivo, ed e' volutamente stupida:
   * riscrive tutto per tutti invece di cercare cosa e' cambiato. Sono due
   * chiamate a testa in una stanza che ne ha dieci, e in cambio non esiste il
   * caso in cui qualcuno resta indietro.
   *
   * LiveKit si ricorda il valore anche per una traccia non ancora arrivata: chi
   * accende il microfono un minuto dopo lo fa gia' al volume giusto.
   */
  const applicaAudio = useCallback(() => {
    const stanza = stanzaRef.current
    if (!stanza) return
    const generale = (sordinaRef.current ? 0 : generaleRef.current) * attenuazioneRef.current

    stanza.remoteParticipants.forEach((partecipante) => {
      const suoi = volumiRef.current.get(partecipante.identity) ?? VOLUMI_INIZIALI
      partecipante.setVolume(suoi.mutoVoce ? 0 : generale * suoi.voce, Track.Source.Microphone)
      partecipante.setVolume(
        suoi.mutoSchermo ? 0 : generale * suoi.schermo,
        Track.Source.ScreenShareAudio
      )
    })
  }, [])

  // Il contenitore nascosto dove vivono gli <audio>. Uno solo per tutta la
  // durata della pagina: crearlo e distruggerlo a ogni chiamata sarebbe un
  // altro modo di far ripartire le riproduzioni.
  useEffect(() => {
    const contenitore = document.createElement('div')
    contenitore.style.display = 'none'
    document.body.appendChild(contenitore)
    audioRef.current = contenitore
    return () => {
      contenitore.remove()
      audioRef.current = null
    }
  }, [])

  // -- Il ciclo di vita della stanza -----------------------------------------

  /**
   * Aggiunge un puntatore e lo fa scadere da solo.
   *
   * Se il riquadro indicato e' uno dei miei, il cerchietto va anche sul
   * monitor vero: e' tutto il senso della cosa. Chi condivide sta guardando il
   * proprio schermo, non la finestra di PulseTalk, e un alone dentro all'app
   * sarebbe un alone che non vede nessuno.
   */
  const accogliPuntatore = useCallback((arrivato: Puntatore) => {
    setPuntatori((prima) => [...prima.filter((p) => p.id !== arrivato.id), arrivato])
    setTimeout(() => {
      setPuntatori((prima) => prima.filter((p) => p.id !== arrivato.id))
    }, 2600)

    const monitor = schermiSuMonitorRef.current.get(arrivato.schermo)
    if (monitor) {
      ponte.puntatoreSulloSchermo({
        schermoId: monitor,
        x: arrivato.x,
        y: arrivato.y,
        colore: arrivato.colore,
        nome: arrivato.nome
      })
    }
  }, [])

  const aggancia = useCallback(
    (stanza: Room) => {
      const eventi: RoomEvent[] = [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ParticipantMetadataChanged,
        RoomEvent.ConnectionQualityChanged
      ]
      for (const evento of eventi) stanza.on(evento, ridisegna)

      // Chi entra adesso non sa niente di come lo avevamo regolato prima.
      stanza.on(RoomEvent.ParticipantConnected, () => {
        applicaAudio()
        suona('altroEntrato')
      })
      stanza.on(RoomEvent.ParticipantDisconnected, () => suona('altroUscito'))

      stanza.on(RoomEvent.ConnectionStateChanged, (nuovo) => {
        setStato(nuovo)
        ridisegna()
      })

      stanza.on(RoomEvent.ActiveSpeakersChanged, (parlanti: Participant[]) => {
        setCheParla(new Set(parlanti.map((p) => p.identity)))
      })

      // L'audio degli altri, attaccato a mano.
      //
      // I video li mettiamo dentro ai riquadri che si vedono; l'audio no, e
      // se non gli si da' un elemento resta una traccia sottoscritta che non
      // suona. E' il primo modo in cui una chiamata sembra collegata e muta.
      stanza.on(RoomEvent.TrackSubscribed, (traccia, pubblicazione, partecipante) => {
        if (traccia.kind !== Track.Kind.Audio) return
        const elemento = traccia.attach()
        elemento.autoplay = true
        audioRef.current?.appendChild(elemento)

        // Nell'anello vanno solo le voci. L'audio di uno schermo condiviso no:
        // se qualcuno sta mostrando un video, coprirebbe esattamente la frase
        // che si sta cercando di recuperare.
        if (pubblicazione.source === Track.Source.Microphone && traccia.mediaStreamTrack) {
          riascoltoRef.current?.aggiungi(partecipante.identity, traccia.mediaStreamTrack)
        }
        // Un elemento appena creato parte a volume pieno: se questa persona
        // era stata abbassata o zittita, senza questa riga il primo istante di
        // suono uscirebbe comunque a tutto volume.
        applicaAudio()
      })
      stanza.on(RoomEvent.TrackUnsubscribed, (traccia, pubblicazione, partecipante) => {
        if (traccia.kind !== Track.Kind.Audio) return
        for (const elemento of traccia.detach()) elemento.remove()
        if (pubblicazione.source === Track.Source.Microphone) {
          riascoltoRef.current?.togli(partecipante.identity)
        }
      })

      // Nel browser il suono non parte finche' l'utente non ha toccato la
      // pagina. Non e' un guasto e non va nascosto: si mostra un pulsante, si
      // clicca, e da li' in poi non succede piu'.
      stanza.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBloccato(!stanza.canPlaybackAudio)
      })

      stanza.on(RoomEvent.Disconnected, (motivo?: DisconnectReason) => {
        // Essere cacciati non e' come cadere la linea, e dirlo cambia cosa fa
        // l'utente dopo: uno riprova, l'altro no.
        if (motivo === DisconnectReason.CLIENT_INITIATED) {
          // Sei uscito tu. Non e' successo niente, e non va detto niente.
          //
          // Senza questo ramo si finiva dritti in quello dei venti secondi qui
          // sotto: chi entrava in un vocale, dava un'occhiata e usciva dopo
          // dieci secondi si prendeva un pistolotto su `use_external_ip` e la
          // porta 7882, per aver premuto Esci. La diagnosi era giusta come
          // testo e sbagliata come momento, che e' il modo piu' efficace per
          // far smettere di leggere gli avvisi.
          setMotivoUscita(null)
        } else if (motivo === DisconnectReason.PARTICIPANT_REMOVED) {
          setMotivoUscita('Un moderatore ti ha tolto dalla stanza.')
        } else if (motivo === DisconnectReason.ROOM_DELETED) {
          setMotivoUscita('La stanza e\' stata chiusa.')
        } else if (motivo === DisconnectReason.DUPLICATE_IDENTITY) {
          setMotivoUscita('Sei entrato nella stessa stanza da un\'altra finestra.')
        } else if (Date.now() - entratoRef.current < 20_000) {
          // Entrare e uscire subito, senza un motivo dichiarato, e' quasi
          // sempre una cosa sola: la segnalazione e' passata — quella va per
          // HTTP e non incontra ostacoli — ma i pacchetti non hanno trovato
          // una strada, e dopo qualche secondo la SFU rinuncia.
          //
          // Senza questo ramo l'app tornava nell'atrio in silenzio, e non
          // c'era modo di distinguerlo da un'uscita voluta.
          setMotivoUscita(
            'La chiamata si e\' collegata, ma i pacchetti audio e video non sono passati. ' +
            'Se stai provando dalla rete di casa, e\' quasi sempre `use_external_ip` in ' +
            'livekit.yaml: con `true` la SFU annuncia l\'indirizzo pubblico, e il router ' +
            'non sa rimandare indietro un pacchetto che esce e rientra da se\'. ' +
            'Da fuori invece manca la porta 7882/UDP inoltrata.'
          )
        } else {
          setMotivoUscita(null)
        }
        schermiRef.current.clear()
        // Anche qui, e non solo in `esci`: da una stanza si esce anche perche'
        // un moderatore ti ha cacciato o perche' e' caduta la linea, e in quei
        // due casi nessuno passa da li'. Senza, il microfono resterebbe aperto
        // — spia accesa, dispositivo occupato — fino alla chiusura dell'app.
        void chiudiCatenaMicrofono()
        spegniRiascolto()
        ridisegna()
      })

      stanza.on(RoomEvent.MediaDevicesError, (e: Error) => {
        setErrore(
          e.name === 'NotAllowedError'
            ? 'Windows non ha dato il permesso di usare microfono o camera. Si sistema in Impostazioni > Privacy.'
            : `Problema con un dispositivo: ${e.message}`
        )
      })

      stanza.on(
        RoomEvent.DataReceived,
        (carico: Uint8Array, da?: RemoteParticipant) => {
          try {
            const dati = JSON.parse(new TextDecoder().decode(carico))

            if (dati.tipo === 'punta' && da) {
              accogliPuntatore({
                id: `${da.identity}-${dati.istante}`,
                schermo: String(dati.schermo),
                x: Number(dati.x),
                y: Number(dati.y),
                colore: coloreDi(da.identity),
                nome: da.name || da.identity
              })
              return
            }

            if (dati.tipo !== 'chat') return
            setMessaggi((precedenti) => [
              ...precedenti.slice(-199),
              {
                id: `${da?.identity ?? '?'}-${dati.istante}`,
                da: da?.name || da?.identity || 'qualcuno',
                testo: String(dati.testo).slice(0, 2000),
                istante: dati.istante,
                mio: false
              }
            ])
          } catch {
            // Un pacchetto dati che non e' una chat: lo mandera' una versione
            // futura, e questa non deve rompersi per non conoscerlo.
          }
        }
      )
    },
    [accogliPuntatore, applicaAudio, ridisegna]
  )

  const entra = useCallback(
    async (ingresso: Ingresso, config: Impostazioni) => {
      setErrore(null)
      setMotivoUscita(null)
      setMessaggi([])
      limitiRef.current = ingresso.limiti

      const stanza = new Room({
        // Spento di serie, ed e' una posizione.
        //
        // `adaptiveStream` abbassa la qualita' di cio' che ricevi in base a
        // quanto e' grande il riquadro sullo schermo. E' ragionevole, fa
        // risparmiare banda a tutti, ed e' anche il motivo per cui in Discord
        // il codice condiviso in un riquadro piccolo e' illeggibile. Qui la
        // qualita' e' quella che si e' chiesta, finche' non si dice il
        // contrario in Impostazioni.
        adaptiveStream: config.adattaAllaFinestra,
        // Questo invece resta acceso: mette in pausa i livelli che nessuno sta
        // guardando. Non toglie qualita' a chi guarda, toglie lavoro a chi
        // trasmette per gli assenti.
        dynacast: true,
        disconnectOnPageLeave: true,
        // I riquadri li mettiamo noi negli elementi <video>: senza questo,
        // livekit-client ne creerebbe di suoi in un angolo del documento.
        audioOutput: config.altoparlanteId ? { deviceId: config.altoparlanteId } : undefined
      })

      aggancia(stanza)
      stanzaRef.current = stanza
      entratoRef.current = Date.now()

      await stanza.connect(ingresso.sfuUrl, ingresso.gettone)

      // Il microfono si prepara solo se si puo' trasmettere: in una stanza da
      // palco un ospite che vede il pulsante acceso e non viene sentito da
      // nessuno e' peggio che non vederlo affatto.
      //
      // Acceso, di serie. Si entra in un vocale per parlare, e un microfono
      // spento all'ingresso vuol dire che la prima frase di ogni chiamata e'
      // qualcun altro che dice "non ti sento". Chi preferisce il contrario
      // spegne l'interruttore nelle impostazioni: allora la traccia si pubblica
      // zittita, e zittita davvero — vedi `accendiMicrofono`.
      if (ingresso.permessi.puoTrasmettere) {
        try {
          await accendiMicrofono(
            stanza,
            config.modoAudio,
            ingresso.limiti,
            config.microfonoId,
            config.microfonoAllIngresso === false,
            config.volumeMicrofono ?? 1
          )
        } catch (e) {
          setErrore(`Il microfono non parte: ${(e as Error).message}`)
        }
      }

      if (config.riascolto !== false) {
        riascoltoRef.current = creaRiascolto(config.secondiRiascolto || 30)
        setRiascoltoAttivo(true)
        // Chi era gia' dentro quando siamo arrivati: le sue tracce erano gia'
        // sottoscritte, e l'evento che le aggiunge all'anello e' passato prima
        // che l'anello esistesse.
        stanza.remoteParticipants.forEach((partecipante) => {
          const voce = partecipante.getTrackPublication(Track.Source.Microphone)
          const traccia = voce?.track?.mediaStreamTrack
          if (traccia) riascoltoRef.current?.aggiungi(partecipante.identity, traccia)
        })
      }

      // Chi era gia' dentro prima di noi: i volumi decisi in una chiamata
      // precedente valgono ancora, e vanno rimessi adesso.
      applicaAudio()
      suona('entrato')
      ridisegna()
    },
    [aggancia, applicaAudio, ridisegna]
  )

  const esci = useCallback(async () => {
    if (stanzaRef.current) suona('uscito')
    for (const schermo of schermiRef.current.values()) {
      await schermo.chiudi().catch(() => {})
    }
    schermiRef.current.clear()
    await stanzaRef.current?.disconnect()
    await chiudiCatenaMicrofono()
    spegniRiascolto()
    stanzaRef.current = null
    limitiRef.current = null
    setStato(ConnectionState.Disconnected)
    setMessaggi([])
    ridisegna()
  }, [ridisegna])

  // Chiudere la finestra durante una chiamata deve valere come uscire, non
  // come sparire: gli altri devono vedere il posto vuoto subito.
  useEffect(() => {
    return () => {
      void stanzaRef.current?.disconnect()
    }
  }, [])

  // Le impostazioni audio cambiate mentre si e' dentro alla chiamata.
  //
  // Prima valevano solo dal rientro successivo: si cambiava microfono nelle
  // impostazioni, si continuava a parlare in quello vecchio, e non lo diceva
  // nessuno. Sono due strade diverse perche' sono due cose diverse:
  //
  //  - il dispositivo si scambia sotto alla traccia gia' pubblicata, senza
  //    rinegoziare niente e senza che gli altri sentano un buco;
  //  - il modo (voce o musica) cambia i vincoli di cattura e il bitrate, che
  //    su una traccia viva non si toccano: quella va ripubblicata.
  //
  // Il primo giro non fa niente: la traccia e' appena stata creata con questi
  // stessi valori, e ripubblicarla subito sarebbe un secondo di silenzio
  // regalato a ogni ingresso.
  const audioApplicato = useRef<{ microfono: string | null; modo: ModoAudio } | null>(null)

  useEffect(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return

    const prima = audioApplicato.current
    const adesso = { microfono: impostazioni.microfonoId ?? null, modo: impostazioni.modoAudio }
    audioApplicato.current = adesso
    if (!prima) return

    void (async () => {
      try {
        if (prima.modo !== adesso.modo) {
          const locale = stanza.localParticipant
          const eraAcceso = locale.isMicrophoneEnabled

          // Si TOGLIE la traccia vecchia, non la si mette in muto.
          //
          // setMicrophoneEnabled(false) la lascia pubblicata e silenziosa: la
          // nuova si aggiungeva accanto, e chi cambiava modo si sentiva due
          // volte. In muto se ne sentiva una sola, che e' il sintomo da cui si
          // capisce che le tracce vive erano due.
          const vecchia = locale.getTrackPublication(Track.Source.Microphone)
          if (vecchia?.track) {
            await locale.unpublishTrack(vecchia.track, true)
          } else {
            await locale.setMicrophoneEnabled(false)
          }

          if (eraAcceso) {
            await accendiMicrofono(
              stanza,
              adesso.modo,
              limitiRef.current!,
              adesso.microfono,
              false,
              impostazioni.volumeMicrofono ?? 1
            )
          }
        } else if (prima.microfono !== adesso.microfono) {
          await stanza.switchActiveDevice('audioinput', adesso.microfono ?? 'default')
        }
        ridisegna()
      } catch (e) {
        setErrore(`Non sono riuscito a cambiare microfono: ${(e as Error).message}`)
      }
    })()
  }, [impostazioni.microfonoId, impostazioni.modoAudio, stato, ridisegna])

  // L'altoparlante invece e' innocuo: cambia solo dove esce il suono gia'
  // ricevuto, quindi si applica sempre, anche al primo giro.
  useEffect(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return
    void stanza
      .switchActiveDevice('audiooutput', impostazioni.altoparlanteId ?? 'default')
      .catch(() => {
        // Non tutti i sistemi lasciano scegliere l'uscita: se non si puo', si
        // resta su quella di Windows senza dire niente. Non e' un guasto.
      })
  }, [impostazioni.altoparlanteId, stato])

  // E la camera, ma solo se e' accesa: se e' spenta se ne riparla
  // all'accensione, che gia' legge l'impostazione giusta.
  useEffect(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return
    if (!stanza.localParticipant.isCameraEnabled) return
    void stanza
      .switchActiveDevice('videoinput', impostazioni.cameraId ?? 'default')
      .catch(() => {})
  }, [impostazioni.cameraId, stato])

  // -- Le azioni --------------------------------------------------------------

  const alternaMicrofono = useCallback(async () => {
    const stanza = stanzaRef.current
    if (!stanza) return
    const locale: LocalParticipant = stanza.localParticipant
    if (!locale.isMicrophoneEnabled && !locale.getTrackPublication(Track.Source.Microphone)) {
      // Prima accensione dentro alla chiamata: passa dal profilo giusto invece
      // che dai valori di serie di livekit-client.
      await accendiMicrofono(
        stanza,
        impostazioni.modoAudio,
        limitiRef.current!,
        impostazioni.microfonoId,
        false,
        impostazioni.volumeMicrofono ?? 1
      )
    } else {
      await locale.setMicrophoneEnabled(!locale.isMicrophoneEnabled)
    }
    suona(locale.isMicrophoneEnabled ? 'microfonoAcceso' : 'microfonoSpento')
    ridisegna()
  }, [
    impostazioni.modoAudio,
    impostazioni.microfonoId,
    impostazioni.volumeMicrofono,
    ridisegna
  ])

  const alternaCamera = useCallback(async () => {
    const stanza = stanzaRef.current
    if (!stanza) return
    if (stanza.localParticipant.isCameraEnabled) {
      await stanza.localParticipant.setCameraEnabled(false)
    } else {
      const preset =
        PRESET_CAMERA.find((p) => p.id === impostazioni.presetCamera) ?? PRESET_CAMERA[0]
      await accendiCamera(stanza, preset, limitiRef.current!, impostazioni.cameraId)
    }
    suona(stanza.localParticipant.isCameraEnabled ? 'cameraAccesa' : 'cameraSpenta')
    ridisegna()
  }, [impostazioni.cameraId, impostazioni.presetCamera, ridisegna])

  // Non si disiscrivono le tracce: si azzera il volume. Disiscriversi farebbe
  // smettere di ricevere, e riaccendere costerebbe una rinegoziazione e due
  // secondi di silenzio in piu'.
  // Il microfono com'era prima della sordina, per rimetterlo com'era dopo.
  const microfonoPrimaDellaSordina = useRef(false)

  const alternaSordina = useCallback(() => {
    sordinaRef.current = !sordinaRef.current
    setSordina(sordinaRef.current)
    applicaAudio()

    // Sordina vuol dire fuori dalla conversazione in tutti e due i versi: non
    // sento loro e non mi sentono. Mutare solo l'ascolto lascia la parte
    // peggiore delle due, quella in cui uno continua a parlare a gente che non
    // lo puo' sentire rispondere.
    const stanza = stanzaRef.current
    if (stanza) {
      const locale = stanza.localParticipant
      if (sordinaRef.current) {
        microfonoPrimaDellaSordina.current = locale.isMicrophoneEnabled
        if (locale.isMicrophoneEnabled) void locale.setMicrophoneEnabled(false).then(ridisegna)
      } else if (microfonoPrimaDellaSordina.current) {
        // Si riaccende solo se era acceso: chi era gia' muto prima resta muto,
        // altrimenti togliere la sordina lo farebbe parlare per sbaglio.
        void locale.setMicrophoneEnabled(true).then(ridisegna)
      }
    }

    suona(sordinaRef.current ? 'sordinaAccesa' : 'sordinaSpenta')
  }, [applicaAudio, ridisegna])

  const impostaVolumeGenerale = useCallback(
    (volume: number) => {
      generaleRef.current = volume
      setVolumeGenerale(volume)
      applicaAudio()
    },
    [applicaAudio]
  )

  const volumiDi = useCallback(
    (identita: string): Volumi => volumi.get(identita) ?? VOLUMI_INIZIALI,
    [volumi]
  )

  const scrivi = useCallback(
    (identita: string, modifiche: Partial<Volumi>) => {
      const prossimi = new Map(volumiRef.current)
      prossimi.set(identita, { ...(prossimi.get(identita) ?? VOLUMI_INIZIALI), ...modifiche })
      volumiRef.current = prossimi
      setVolumi(prossimi)
      applicaAudio()
    },
    [applicaAudio]
  )

  const impostaVolume = useCallback(
    (identita: string, sorgente: SorgenteAudio, volume: number) => {
      // Muovere il cursore di uno che era zittito lo riaccende: e' quello che
      // uno intende facendolo, e il contrario — spostare un cursore e non
      // sentire niente — e' un minuto perso a cercare il perche'.
      scrivi(
        identita,
        sorgente === 'voce'
          ? { voce: volume, mutoVoce: false }
          : { schermo: volume, mutoSchermo: false }
      )
    },
    [scrivi]
  )

  const alternaMuto = useCallback(
    (identita: string, sorgente: SorgenteAudio) => {
      const suoi = volumiRef.current.get(identita) ?? VOLUMI_INIZIALI
      scrivi(
        identita,
        sorgente === 'voce' ? { mutoVoce: !suoi.mutoVoce } : { mutoSchermo: !suoi.mutoSchermo }
      )
    },
    [scrivi]
  )

  const condividi = useCallback(
    async (
      sorgente: Sorgente | null,
      preset: PresetSchermo,
      audioSistema?: ModoAudioSistema
    ) => {
      const stanza = stanzaRef.current
      const limiti = limitiRef.current
      if (!stanza || !limiti) return

      if (schermiRef.current.size >= limiti.streamPerPersona) {
        setErrore(
          `Il server ne consente ${limiti.streamPerPersona} per persona. Chiudine uno per aprirne un altro.`
        )
        return
      }

      setErrore(null)
      try {
        // La scelta fatta nel selettore vince su quella di serie: si puo'
        // mandare l'audio di questa condivisione e non della prossima senza
        // dover cambiare le impostazioni e poi rimetterle a posto.
        const stream = await catturaSchermo(
          sorgente,
          preset,
          audioSistema ?? impostazioni.audioSistema
        )
        const etichetta = sorgente?.nome ?? `Schermo ${schermiRef.current.size + 1}`
        const pubblicato = await pubblicaSchermo(
          stanza,
          stream,
          preset,
          limiti,
          etichetta,
          (idTraccia) => {
            // Chiusa dalla barra di Windows o perche' la finestra non c'e'
            // piu': si toglie dall'elenco e si fa lo stesso rumore di quando
            // la si chiude dal pulsante, perche' per chi guarda e' successa
            // esattamente la stessa cosa.
            schermiRef.current.delete(idTraccia)
            schermiSuMonitorRef.current.delete(idTraccia)
            suona('condivisioneFinita')
            ridisegna()
          }
        )
        schermiRef.current.set(pubblicato.video.trackSid, pubblicato)
        // Serve al puntatore: quando qualcuno indica questo riquadro, e' su
        // questo monitor che va disegnato l'alone. Le finestre singole non
        // hanno un monitor proprio — di quelle Electron non conosce la
        // posizione — e li' il cerchietto resta dentro all'app.
        schermiSuMonitorRef.current.set(
          pubblicato.video.trackSid,
          sorgente?.tipo === 'schermo' ? sorgente.schermoId : null
        )
        suona('condivisioneIniziata')
        ridisegna()
      } catch (e) {
        const errore = e as Error
        // Chiudere il selettore di Chrome senza scegliere e' una risposta
        // legittima, non un guasto da mostrare in rosso.
        if (errore.name === 'NotAllowedError') return
        setErrore(`La condivisione non e' partita: ${errore.message}`)
      }
    },
    [impostazioni.audioSistema, ridisegna]
  )

  const smettiDiCondividere = useCallback(
    async (id?: string) => {
      const daChiudere = id
        ? [schermiRef.current.get(id)].filter(Boolean)
        : [...schermiRef.current.values()]

      for (const schermo of daChiudere) {
        await schermo!.chiudi().catch(() => {})
      }
      if (id) {
        schermiRef.current.delete(id)
        schermiSuMonitorRef.current.delete(id)
      } else {
        schermiRef.current.clear()
        schermiSuMonitorRef.current.clear()
      }
      if (daChiudere.length > 0) suona('condivisioneFinita')
      ridisegna()
    },
    [ridisegna]
  )

  const manda = useCallback((testo: string) => {
    const stanza = stanzaRef.current
    const pulito = testo.trim().slice(0, 2000)
    if (!stanza || !pulito) return

    const istante = Date.now()
    void stanza.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ tipo: 'chat', testo: pulito, istante })),
      { reliable: true }
    )
    setMessaggi((precedenti) => [
      ...precedenti.slice(-199),
      { id: `io-${istante}`, da: 'Tu', testo: pulito, istante, mio: true }
    ])
  }, [])

  /**
   * Riascolta, abbassando il vivo mentre scorre.
   *
   * La barretta che avanza la disegna la stanza a partire da `fino`, che e'
   * l'istante in cui finira': un timer che conta all'indietro qui dentro
   * costerebbe un ridisegno ogni decimo di secondo di tutta la chiamata.
   */
  const riascolta = useCallback(() => {
    const anello = riascoltoRef.current
    if (!anello) return

    fermaRef.current?.()

    const finito = (): void => {
      fermaRef.current = null
      attenuazioneRef.current = 1
      applicaAudio()
      setRiascoltoInCorso(null)
    }

    const partito = anello.suona(impostazioni.secondiRiascolto || 30, finito)
    if (!partito) return

    attenuazioneRef.current = 0.3
    applicaAudio()
    fermaRef.current = partito.ferma
    setRiascoltoInCorso({ fino: Date.now() + partito.durata * 1000, durata: partito.durata })
  }, [applicaAudio, impostazioni.secondiRiascolto])

  const fermaRiascolto = useCallback(() => {
    fermaRef.current?.()
  }, [])

  const punta = useCallback(
    (schermo: string, x: number, y: number) => {
      const stanza = stanzaRef.current
      if (!stanza) return

      const io = stanza.localParticipant
      const carico = { tipo: 'punta', schermo, x, y, istante: Date.now() }
      void stanza.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(carico)),
        { reliable: true }
      )

      // Anche a se stessi, subito: chi indica deve vedere dove ha indicato
      // senza aspettare che il pacchetto faccia il giro.
      accogliPuntatore({
        id: `${io.identity}-${carico.istante}`,
        schermo,
        x,
        y,
        colore: coloreDi(io.identity),
        nome: io.name || 'tu'
      })
    },
    [accogliPuntatore]
  )

  const sbloccaAudio = useCallback(async () => {
    await stanzaRef.current?.startAudio()
    setAudioBloccato(false)
  }, [])

  // Le impostazioni che vanno portate su cose vive: il guadagno sul GainNode
  // del microfono, il volume generale sui partecipanti, i suoni sul loro
  // generatore. Sono tre effetti e non tre chiamate sparse nei gestori perche'
  // devono valere anche quando a cambiarle e' l'altra finestra — le
  // impostazioni arrivano anche da fuori, per IPC.
  useEffect(() => {
    impostaGuadagnoMicrofono(impostazioni.volumeMicrofono ?? 1)
  }, [impostazioni.volumeMicrofono])

  useEffect(() => {
    const valore = impostazioni.volumeUscita ?? 1
    generaleRef.current = valore
    setVolumeGenerale(valore)
    applicaAudio()
  }, [impostazioni.volumeUscita, applicaAudio])

  useEffect(() => {
    const vuole = impostazioni.riascolto !== false
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return

    const secondi = impostazioni.secondiRiascolto || 30

    // Cambiare la durata durante una chiamata rifa' l'anello da capo, e quello
    // che c'era dentro se ne va. E' l'unica strada onesta: un anello si alloca
    // una volta sola, e allungarlo vorrebbe dire ricopiare i campioni vecchi in
    // un ordine che dipende da dove era arrivato a scrivere. Chi sposta questa
    // manopola sta decidendo per le prossime frasi, non per quelle appena dette.
    const daRifare = !!riascoltoRef.current && riascoltoRef.current.secondi !== secondi

    if (vuole && (!riascoltoRef.current || daRifare)) {
      riascoltoRef.current?.chiudi()
      riascoltoRef.current = creaRiascolto(secondi)
      setRiascoltoAttivo(true)
      stanza.remoteParticipants.forEach((partecipante) => {
        const traccia = partecipante.getTrackPublication(Track.Source.Microphone)?.track
          ?.mediaStreamTrack
        if (traccia) riascoltoRef.current?.aggiungi(partecipante.identity, traccia)
      })
    } else if (!vuole && riascoltoRef.current) {
      spegniRiascolto()
    }
  }, [impostazioni.riascolto, impostazioni.secondiRiascolto, stato])

  useEffect(() => {
    configuraSuoni({
      acceso: impostazioni.suoni !== false,
      volume: impostazioni.volumeSuoni ?? 0.6
    })
  }, [impostazioni.suoni, impostazioni.volumeSuoni])

  // -- La vista ---------------------------------------------------------------

  const { riquadri, persone, schermiAttivi } = useMemo(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato === ConnectionState.Disconnected) {
      return { riquadri: [] as Riquadro[], persone: [] as Persona[], schermiAttivi: [] }
    }

    const riquadri: Riquadro[] = []
    const persone: Persona[] = []

    riquadri.push(...riquadriDi(stanza.localParticipant, true, cheParla))
    persone.push(personaDa(stanza.localParticipant, true, cheParla))

    stanza.remoteParticipants.forEach((p) => {
      riquadri.push(...riquadriDi(p, false, cheParla))
      persone.push(personaDa(p, false, cheParla))
    })

    // Gli schermi davanti alle persone: se qualcuno sta mostrando qualcosa, e'
    // quella la cosa da guardare. Poi in ordine di nome — e non di chi parla,
    // che rimescolerebbe la griglia a ogni frase.
    riquadri.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'schermo' ? -1 : 1
      return a.nome.localeCompare(b.nome, 'it')
    })
    persone.sort((a, b) => {
      if (a.locale !== b.locale) return a.locale ? -1 : 1
      return a.nome.localeCompare(b.nome, 'it')
    })

    const schermiAttivi = [...schermiRef.current.entries()].map(([id, s]) => ({
      id,
      etichetta: s.video.trackName || 'Schermo'
    }))

    return { riquadri, persone, schermiAttivi }
    // `giro` non si usa nel corpo: e' li' per far ricalcolare quando la stanza
    // cambia sotto, cosa che React da solo non puo' vedere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giro, stato, cheParla])

  /**
   * Chi ha il microfono spento adesso, per identita'.
   *
   * La colonna dei canali riceve le presenze dal server, che le ricava da una
   * fotografia della SFU: giusta quando viene scattata, ferma da li' in poi.
   * Per il canale in cui si e' dentro il dato vero ce l'abbiamo qui, e va
   * usato quello - altrimenti il simbolo del muto resta appeso addosso alla
   * persona sbagliata finche' qualcuno non entra o non esce.
   */
  const microfoniSpenti = useMemo(
    () => new Set(persone.filter((p) => !p.microfonoAcceso).map((p) => p.identita)),
    [persone]
  )

  const stanza = stanzaRef.current

  return {
    stanza,
    stato,
    errore,
    motivoUscita,
    riquadri,
    persone,
    messaggi,
    parlanti: cheParla,
    microfonoAcceso: !!stanza?.localParticipant.isMicrophoneEnabled,
    cameraAccesa: !!stanza?.localParticipant.isCameraEnabled,
    sordina,
    volumeGenerale,
    schermiAttivi,
    microfoniSpenti,
    audioBloccato,
    sbloccaAudio,
    riascoltoAttivo,
    riascoltoInCorso,
    riascolta,
    fermaRiascolto,
    puntatori,
    punta,
    entra,
    esci,
    alternaMicrofono,
    alternaCamera,
    alternaSordina,
    condividi,
    smettiDiCondividere,
    manda,
    impostaVolumeGenerale,
    volumiDi,
    impostaVolume,
    alternaMuto
  }
}
