import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectionQuality,
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
  type LocalTrack,
  type LocalParticipant,
  type Participant,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteAudioTrack,
  type RemoteTrackPublication,
  type TrackPublication,
  type VideoTrack
} from 'livekit-client'
import type { Impostazioni, Ingresso, ModoAudioSistema, Sorgente } from '@shared/tipi'
import type { ModoAudio } from '@shared/qualita'
import { PRESET_CAMERA, PRESET_SCHERMO, type Limiti, type PresetSchermo } from '@shared/qualita'
import {
  accendiCamera,
  accendiMicrofono,
  cambiaQualitaSchermo,
  catturaSchermo,
  chiudiCatenaMicrofono,
  etichettaSoloAudio,
  impostaGuadagnoMicrofono,
  livelloMicrofono,
  microfonoPassa,
  impostaSogliaMicrofono,
  pubblicaSchermo,
  pubblicaSoloAudio,
  type SchermoPubblicato
} from './pubblica'
import { configuraSuoni, suona } from './suoni'
import { coloreDi } from './avatar'
import { ponte } from '../ponte'
import { idDaAprire } from './usaDispositivi'
import { creaRilevatoreVoci, type RilevatoreVoci } from './vociAttive'
import { creaRiascolto, type Riascolto } from './riascolto'
import { osservaDiagnosticaAudio } from './diagnosticaAudio'
import { segnalaChiamata } from './banda'

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
  /**
   * Condivisione altrui che non stiamo ricevendo: c'e', ma nessuno la scarica.
   *
   * Il riquadro esiste lo stesso — si sa chi condivide e quante ne ha aperte —
   * ma al posto del video c'e' il pulsante per aprirla. Vedi
   * `MAX_CONDIVISIONI_GUARDATE`.
   */
  bloccato: boolean
  /** Sta parlando adesso: e' il bordo verde. */
  parla: boolean
  microfonoAcceso: boolean
}

/**
 * Quante condivisioni altrui si possono ricevere insieme.
 *
 * Non e' un limite di quante ne possono esistere: in una stanza da dieci
 * persone con tre monitor a testa i riquadri restano trenta. E' un limite a
 * quante se ne **scaricano**, perche' quelle sono trenta flussi video che
 * arrivano tutti insieme sulla stessa linea, e a quel punto non si vede bene
 * nessuna delle trenta — ne' si sente piu' nessuno parlare.
 *
 * Due, e non uno, perche' guardare il codice di qualcuno accanto al suo
 * terminale e' il caso che capita davvero. L'audio delle condivisioni non
 * conta qui: pesa poco e non ha senso doverlo sbloccare per sentirlo.
 */
export const MAX_CONDIVISIONI_GUARDATE = 2

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

/** Una propria traccia solo-audio, separata dai riquadri video. */
export interface AudioCondiviso {
  id: string
  etichetta: string
  volume: number
  muto: boolean
  /** Basta per decidere se animare l'icona a onde. */
  attivo: boolean
}

/**
 * Audio di schermo ricevuto da un altro partecipante.
 *
 * Il volume e' per trackSid e non per persona: due tracce contemporanee della
 * stessa persona possono quindi avere regolazioni diverse.
 */
export interface AudioRemoto {
  id: string
  identita: string
  nome: string
  etichetta: string
  volume: number
  muto: boolean
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
  /**
   * Tenuto premuto: niente onde, e non svanisce da solo.
   *
   * Sono due gesti con due significati. Il tocco dice "guarda qui adesso" e si
   * spegne da solo; il tenuto e' un dito appoggiato che segue quello di cui si
   * sta parlando, e resta finche' serve.
   */
  tenuto?: boolean
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
    // La propria condivisione non si sblocca: e' gia' qui, mostrarla non
    // costa banda in entrata, e chiedere di aprire il proprio schermo sarebbe
    // una domanda senza senso.
    const bloccato = !locale && !(pubblicazione as RemoteTrackPublication).isSubscribed
    fuori.push({
      id: pubblicazione.trackSid,
      identita: partecipante.identity,
      nome,
      tipo: 'schermo',
      etichetta: pubblicazione.trackName || `Schermo ${contatoreSchermi}`,
      traccia: (pubblicazione.track as VideoTrack | undefined) ?? null,
      locale,
      moderatore,
      bloccato,
      // Bloccato non e' "sta arrivando": non arriva niente, ed e' voluto. La
      // rotellina dell'attesa qui direbbe una bugia.
      inArrivo: !bloccato && !pubblicazione.track,
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
    bloccato: false,
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
  /** Solo le condivisioni con video, mostrate nel menu degli schermi. */
  schermiAttivi: { id: string; etichetta: string }[]
  /** Le proprie condivisioni solo-audio, mostrate nel popup a onde. */
  audioCondivisi: AudioCondiviso[]
  /** Le tracce audio di schermo ricevute, regolabili una per una. */
  audioRemoti: AudioRemoto[]
  /** Chi ha il microfono spento, dal vivo. Vale solo per il canale in cui si e'. */
  microfoniSpenti: Set<string>
  /** Andata e ritorno verso la SFU in millisecondi. Null: non ancora misurabile. */
  latenza: number | null
  /** Dice quale schermo si sta guardando: gli altri scendono di qualita'. */
  applicaQualita: (idAFuoco: string | null) => void
  /** Cambia la qualita' di una propria condivisione senza interromperla. */
  cambiaQualitaCondivisione: (idTraccia: string, presetId: string) => Promise<void>
  /** Con quale preset sta andando una propria condivisione. */
  presetDiCondivisione: (idTraccia: string) => string | null
  /** Scambia finestra/schermo conservando la publication e il trackSid. */
  cambiaSorgenteCondivisione(
    idTraccia: string,
    sorgente: Sorgente | null,
    preset?: PresetSchermo,
    audioSistema?: ModoAudioSistema
  ): Promise<void>
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
  /** Un tocco, oppure — con `tenuto` — un puntatore che resta finche' non si lascia. */
  punta(schermo: string, x: number, y: number, tenuto?: boolean): void
  /** Lascia la presa sul puntatore tenuto: sparisce per tutti. */
  lascia(schermo: string): void

  /**
   * Le condivisioni altrui si aprono a mano, due alla volta.
   *
   * Vedi `MAX_CONDIVISIONI_GUARDATE`. `guarda` non fa niente se i posti sono
   * pieni: e' l'interfaccia a spegnere il pulsante e a dire perche', invece di
   * lasciar premere qualcosa che non succede.
   */
  guarda(idTraccia: string): void
  nonGuardare(idTraccia: string): void
  quanteGuardate: number

  entra(ingresso: Ingresso, impostazioni: Impostazioni): Promise<void>
  esci(): Promise<void>

  alternaMicrofono(): Promise<void>
  alternaCamera(): Promise<void>
  alternaSordina(): void
  condividi(
    sorgente: Sorgente | null,
    preset: PresetSchermo,
    audioSistema?: ModoAudioSistema,
    soloAudio?: boolean,
    bitrateAudio?: number,
    permettiInterazione?: boolean
  ): Promise<void>
  smettiDiCondividere(id?: string): Promise<void>
  impostaVolumeAudioCondiviso(id: string, volume: number): void
  alternaMutoAudioCondiviso(id: string): void
  impostaVolumeAudioRemoto(id: string, volume: number): void
  alternaMutoAudioRemoto(id: string): void
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
  /**
   * Una sola riproduzione per pubblicazione audio.
   *
   * `TrackSubscribed` puo' tornare dopo una risottoscrizione/reconnect. Senza
   * una chiave, `track.attach()` crea un secondo elemento e la stessa voce
   * suona due volte con pochi millisecondi di scarto: all'orecchio e' proprio
   * un timbro metallico/elettrico.
   */
  const riproduzioniAudioRef = useRef<
    Map<
      string,
      {
        traccia: RemoteTrack
        elemento: HTMLMediaElement
        identita: string
        sorgente: Track.Source
      }
    >
  >(new Map())
  /** I cicli `getStats()`, locali e remoti, indicizzati dalla pubblicazione. */
  const diagnosticheAudioRef = useRef<Map<string, () => void>>(new Map())
  // Quando siamo entrati. Serve a distinguere un'uscita voluta da una caduta
  // subito dopo l'ingresso, che ha una causa sola e vale la pena nominare.
  const entratoRef = useRef(0)

  // Il contatore che fa ridisegnare. Non contiene niente: dice solo "la stanza
  // e' cambiata, riguardala".
  const [giro, avanza] = useState(0)
  const ridisegna = useCallback(() => avanza((n) => n + 1), [])

  /**
   * Le condivisioni altrui che si e' scelto di ricevere, per trackSid.
   *
   * Un ref e non uno stato: ci si legge dentro da dentro ai gestori degli
   * eventi della stanza, che sono agganciati una volta sola e vedrebbero per
   * sempre il primo valore. Il ridisegno lo chiediamo a mano.
   */
  const guardateRef = useRef<Set<string>>(new Set())
  const [quanteGuardate, setQuanteGuardate] = useState(0)

  /**
   * Taglia la ricezione di tutte le condivisioni che non si sta guardando.
   *
   * Passa da qui ogni condivisione altrui: quelle appena pubblicate, quelle
   * gia' in corso di chi entra dopo di noi, e quelle che c'erano gia' quando
   * siamo entrati noi. `autoSubscribe` resta acceso — spegnerlo per tutti
   * vorrebbe dire gestire a mano anche le voci, che invece devono arrivare
   * sempre — e qui si disdice subito cio' che non serve.
   */
  const potaCondivisioni = useCallback((stanza: Room) => {
    stanza.remoteParticipants.forEach((partecipante) => {
      partecipante.trackPublications.forEach((pubblicazione) => {
        if (pubblicazione.kind !== Track.Kind.Video) return
        if (pubblicazione.source !== Track.Source.ScreenShare) return

        const voluta = guardateRef.current.has(pubblicazione.trackSid)
        if (pubblicazione.isSubscribed !== voluta) pubblicazione.setSubscribed(voluta)
      })
    })
  }, [])

  /** Apre una condivisione altrui, se non se ne stanno gia' guardando due. */
  const guarda = useCallback(
    (id: string) => {
      const stanza = stanzaRef.current
      if (!stanza) return
      if (guardateRef.current.has(id)) return
      if (guardateRef.current.size >= MAX_CONDIVISIONI_GUARDATE) return

      guardateRef.current.add(id)
      setQuanteGuardate(guardateRef.current.size)
      potaCondivisioni(stanza)
      ridisegna()
    },
    [potaCondivisioni, ridisegna]
  )

  /** Chiude una condivisione: smette di scaricarla e libera uno dei due posti. */
  const nonGuardare = useCallback(
    (id: string) => {
      const stanza = stanzaRef.current
      if (!guardateRef.current.delete(id)) return

      setQuanteGuardate(guardateRef.current.size)
      if (stanza) potaCondivisioni(stanza)
      ridisegna()
    },
    [potaCondivisioni, ridisegna]
  )

  const [stato, setStato] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [errore, setErrore] = useState<string | null>(null)
  const [motivoUscita, setMotivoUscita] = useState<string | null>(null)
  const [messaggi, setMessaggi] = useState<Messaggio[]>([])
  const [cheParla, setCheParla] = useState<Set<string>>(new Set())

  /**
   * Chi parla, misurato qui invece che chiesto alla SFU.
   *
   * Il calcolo del server ha una finestra di 400 ms smorzata: fra l'apertura
   * di bocca e il bordo verde passa quasi un secondo. Le tracce pero' arrivano
   * qui gia' decodificate, e misurarle sul posto toglie di mezzo sia la
   * finestra sia il viaggio di ritorno.
   *
   * Il dato della SFU non si butta: resta valido per chi, per qualunque
   * motivo, qui non si riesce a misurare.
   */
  const rilevatore = useRef<RilevatoreVoci | null>(null)
  const [vociLocali, setVociLocali] = useState<Set<string>>(new Set())
  const [vociSfu, setVociSfu] = useState<Set<string>>(new Set())
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
  /** Regolazioni che vincono sul volume "audio schermo" della persona. */
  const volumiAudioRemotiRef = useRef(new Map<string, { volume: number; muto: boolean }>())

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
      // `Participant.setVolume(ScreenShareAudio)` tocca soltanto la prima
      // publication trovata da LiveKit. Qui si passa invece per ogni
      // trackSid, cosi' due condivisioni audio della stessa persona non si
      // pestano i piedi e possono avere cursori diversi.
      // Il nome del video di ogni condivisione di questa persona. Serve a
      // capire quale audio appartiene a quale riquadro: l'audio di una
      // condivisione e' una traccia separata, e livekit non le lega fra loro.
      // Le lega il nome, che le assegniamo noi pubblicando: "Finestra" e
      // "Finestra (audio)".
      const nomeAFuoco = (() => {
        const id = aFuocoRef.current
        if (!id) return null
        const video = partecipante.trackPublications.get(id)
        return video?.source === Track.Source.ScreenShare ? (video.trackName ?? null) : null
      })()

      partecipante.trackPublications.forEach((pubblicazione) => {
        if (pubblicazione.source !== Track.Source.ScreenShareAudio) return
        const sua = volumiAudioRemotiRef.current.get(pubblicazione.trackSid)
        const volume = sua?.volume ?? suoi.schermo
        let muto = sua?.muto ?? suoi.mutoSchermo

        // Con una condivisione in primo piano si sente solo quella.
        //
        // Due schermi che suonano insieme sono rumore, non stereofonia: uno
        // copre l'altro e non si capisce piu' niente di nessuno dei due. Chi
        // ne mette una in primo piano sta dicendo quale vuole seguire.
        //
        // Le condivisioni di solo audio restano fuori da questa regola: non
        // hanno un video da mettere a fuoco, e zittirle vorrebbe dire
        // spegnere la musica ogni volta che qualcuno ingrandisce uno schermo.
        if (nomeAFuoco !== null) {
          const suoVideo = [...partecipante.trackPublications.values()].some(
            (p) =>
              p.source === Track.Source.ScreenShare &&
              `${p.trackName} (audio)` === pubblicazione.trackName
          )
          if (suoVideo && pubblicazione.trackName !== `${nomeAFuoco} (audio)`) muto = true
        }

        ;(pubblicazione.track as RemoteAudioTrack | undefined)?.setVolume(
          muto ? 0 : generale * volume
        )
      })
    })
  }, [])

  const fermaDiagnosticaAudio = useCallback((chiave: string) => {
    diagnosticheAudioRef.current.get(chiave)?.()
    diagnosticheAudioRef.current.delete(chiave)
  }, [])

  const avviaDiagnosticaAudio = useCallback(
    (chiave: string, traccia: LocalTrack | RemoteTrack, fonte: string) => {
      fermaDiagnosticaAudio(chiave)
      diagnosticheAudioRef.current.set(
        chiave,
        osservaDiagnosticaAudio(traccia, fonte, ponte.diagnosticaAudio)
      )
    },
    [fermaDiagnosticaAudio]
  )

  const rimuoviRiproduzioneAudio = useCallback((sid: string) => {
    const riproduzione = riproduzioniAudioRef.current.get(sid)
    if (!riproduzione) return
    riproduzioniAudioRef.current.delete(sid)
    try {
      riproduzione.traccia.detach(riproduzione.elemento)
    } catch {
      // La traccia puo' essersi gia' chiusa durante un reconnect.
    }
    riproduzione.elemento.pause()
    riproduzione.elemento.srcObject = null
    riproduzione.elemento.remove()
  }, [])

  const fermaTuttoAudio = useCallback(() => {
    for (const sid of [...riproduzioniAudioRef.current.keys()]) rimuoviRiproduzioneAudio(sid)
    for (const ferma of diagnosticheAudioRef.current.values()) ferma()
    diagnosticheAudioRef.current.clear()
  }, [rimuoviRiproduzioneAudio])

  // Il contenitore nascosto dove vivono gli <audio>. Uno solo per tutta la
  // durata della pagina: crearlo e distruggerlo a ogni chiamata sarebbe un
  // altro modo di far ripartire le riproduzioni.
  useEffect(() => {
    const contenitore = document.createElement('div')
    contenitore.style.display = 'none'
    document.body.appendChild(contenitore)
    audioRef.current = contenitore
    return () => {
      fermaTuttoAudio()
      contenitore.remove()
      audioRef.current = null
    }
  }, [fermaTuttoAudio])

  // -- Il ciclo di vita della stanza -----------------------------------------

  /**
   * Aggiunge un puntatore e lo fa scadere da solo.
   *
   * Se il riquadro indicato e' uno dei miei, il cerchietto va anche sul
   * monitor vero: e' tutto il senso della cosa. Chi condivide sta guardando il
   * proprio schermo, non la finestra di PulseTalk, e un alone dentro all'app
   * sarebbe un alone che non vede nessuno.
   */
  // Il rilevatore vive quanto la pagina: aprirlo e chiuderlo a ogni ingresso
  // vorrebbe dire un AudioContext nuovo ogni volta, e Chromium ne concede un
  // numero limitato per pagina.
  useEffect(() => {
    rilevatore.current = creaRilevatoreVoci(setVociLocali)
    return () => {
      rilevatore.current?.chiudi()
      rilevatore.current = null
    }
  }, [])

  // La propria voce non arriva da una traccia ricevuta: si legge dalla catena
  // del microfono, che sta gia' misurando per il cancello e per il misuratore.
  useEffect(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return

    const locale = stanza.localParticipant
    rilevatore.current?.livelloLocale(locale.identity, () => {
      // Due condizioni, e servono entrambe. A microfono spento la catena
      // continua a misurare il dispositivo, e senza il primo controllo il
      // proprio bordo si accenderebbe parlando da mutati. Con il cancello
      // chiuso il suono c'e' ma non esce, e accendere il bordo direbbe agli
      // altri una cosa che loro non stanno sentendo.
      if (!locale.isMicrophoneEnabled) return 0
      if (!microfonoPassa()) return 0
      return livelloMicrofono()
    })
  }, [stato])

  useEffect(() => {
    const misurate = rilevatore.current?.misurate() ?? new Set<string>()
    const unione = new Set(vociLocali)
    // Della SFU si tiene solo chi non stiamo gia' misurando: sommare i due
    // farebbe restare acceso il bordo per gli 800 ms di coda del server,
    // buttando via il guadagno.
    for (const chi of vociSfu) if (!misurate.has(chi)) unione.add(chi)
    setCheParla(unione)
  }, [vociLocali, vociSfu])

  const accogliPuntatore = useCallback((arrivato: Puntatore) => {
    setPuntatori((prima) => [...prima.filter((p) => p.id !== arrivato.id), arrivato])

    // Solo il tocco scade da solo. Il tenuto se ne va quando arriva il
    // rilascio, e un timer qui lo farebbe sparire sotto al dito di chi lo
    // tiene ancora premuto.
    if (!arrivato.tenuto) {
      setTimeout(() => {
        setPuntatori((prima) => prima.filter((p) => p.id !== arrivato.id))
      }, 2600)
    }

    const monitor = schermiSuMonitorRef.current.get(arrivato.schermo)
    if (monitor) {
      ponte.puntatoreSulloSchermo({
        schermoId: monitor,
        x: arrivato.x,
        y: arrivato.y,
        colore: arrivato.colore,
        nome: arrivato.nome,
        tenuto: arrivato.tenuto ? arrivato.id : undefined
      })
    }
  }, [])

  /** Toglie un puntatore tenuto, qui e sul monitor di chi condivide. */
  const lasciaPuntatore = useCallback((id: string, schermo: string) => {
    setPuntatori((prima) => prima.filter((p) => p.id !== id))
    const monitor = schermiSuMonitorRef.current.get(schermo)
    if (monitor) {
      ponte.puntatoreSulloSchermo({
        schermoId: monitor,
        x: 0,
        y: 0,
        colore: '#000000',
        nome: '',
        lascia: id
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
        potaCondivisioni(stanza)
        suona('altroEntrato')
      })
      stanza.on(RoomEvent.ParticipantDisconnected, () => suona('altroUscito'))

      // Una condivisione appena aperta da qualcun altro non si scarica finche'
      // non la si apre. Qui e' il primo momento in cui la si vede esistere, ed
      // e' anche il momento in cui `autoSubscribe` la prenderebbe.
      stanza.on(RoomEvent.TrackPublished, () => potaCondivisioni(stanza))

      // Chi smette di condividere libera il posto che teneva occupato: senza
      // questo, due condivisioni chiuse lasciavano il tetto pieno e nessuna da
      // guardare.
      stanza.on(RoomEvent.TrackUnpublished, (pubblicazione) => {
        if (guardateRef.current.delete(pubblicazione.trackSid)) {
          setQuanteGuardate(guardateRef.current.size)
        }
      })

      stanza.on(RoomEvent.ConnectionStateChanged, (nuovo) => {
        setStato(nuovo)
        // Rientrando dopo una caduta la SFU rifa' le sottoscrizioni da capo,
        // e senza questo si tornerebbe dentro scaricando tutti gli schermi
        // della stanza — proprio nel momento in cui la linea ha gia' dato
        // segno di non farcela.
        if (nuovo === ConnectionState.Connected) potaCondivisioni(stanza)
        ridisegna()
      })

      stanza.on(RoomEvent.ActiveSpeakersChanged, (parlanti: Participant[]) => {
        setVociSfu(new Set(parlanti.map((p) => p.identity)))
      })

      stanza.on(RoomEvent.LocalTrackPublished, (pubblicazione) => {
        const traccia = pubblicazione.track
        if (!traccia || traccia.kind !== Track.Kind.Audio) return
        const fonte =
          pubblicazione.source === Track.Source.Microphone
            ? 'microfono-locale'
            : 'condivisione-locale'
        avviaDiagnosticaAudio(`locale:${pubblicazione.trackSid}`, traccia, fonte)
      })
      stanza.on(RoomEvent.LocalTrackUnpublished, (pubblicazione) => {
        fermaDiagnosticaAudio(`locale:${pubblicazione.trackSid}`)
      })

      // L'audio degli altri, attaccato a mano.
      //
      // I video li mettiamo dentro ai riquadri che si vedono; l'audio no, e
      // se non gli si da' un elemento resta una traccia sottoscritta che non
      // suona. E' il primo modo in cui una chiamata sembra collegata e muta.
      stanza.on(RoomEvent.TrackSubscribed, (traccia, pubblicazione, partecipante) => {
        if (traccia.kind !== Track.Kind.Audio) return

        // Una voce sola per persona. Due pubblicazioni di microfono non sono
        // una funzione: sono una vecchia traccia rimasta viva durante una
        // ripubblicazione. Le condivisioni audio invece possono essere molte
        // e restano distinte tramite il loro SID.
        if (pubblicazione.source === Track.Source.Microphone) {
          // L'anello e il rilevatore sono indicizzati per identita': prima si
          // stacca l'eventuale vecchia MediaStreamTrack, poi il blocco sotto
          // aggancia quella appena sottoscritta.
          riascoltoRef.current?.togli(partecipante.identity)
          rilevatore.current?.togli(partecipante.identity)
          for (const [sid, esistente] of riproduzioniAudioRef.current) {
            if (
              sid !== pubblicazione.trackSid &&
              esistente.identita === partecipante.identity &&
              esistente.sorgente === Track.Source.Microphone
            ) {
              rimuoviRiproduzioneAudio(sid)
              fermaDiagnosticaAudio(`remoto:${sid}`)
              ponte.diagnosticaAudio('riproduzione microfono duplicata rimossa dopo risottoscrizione')
            }
          }
        }

        // Lo stesso evento, con lo stesso SID, e' idempotente.
        rimuoviRiproduzioneAudio(pubblicazione.trackSid)
        fermaDiagnosticaAudio(`remoto:${pubblicazione.trackSid}`)

        const elemento = document.createElement('audio')
        elemento.autoplay = true
        traccia.attach(elemento)
        audioRef.current?.appendChild(elemento)
        riproduzioniAudioRef.current.set(pubblicazione.trackSid, {
          traccia,
          elemento,
          identita: partecipante.identity,
          sorgente: pubblicazione.source
        })

        const fonte =
          pubblicazione.source === Track.Source.Microphone
            ? 'microfono-remoto'
            : 'condivisione-remota'
        avviaDiagnosticaAudio(`remoto:${pubblicazione.trackSid}`, traccia, fonte)

        // Nell'anello vanno solo le voci. L'audio di uno schermo condiviso no:
        // se qualcuno sta mostrando un video, coprirebbe esattamente la frase
        // che si sta cercando di recuperare.
        if (pubblicazione.source === Track.Source.Microphone && traccia.mediaStreamTrack) {
          riascoltoRef.current?.aggiungi(partecipante.identity, traccia.mediaStreamTrack)
          rilevatore.current?.aggiungi(partecipante.identity, traccia.mediaStreamTrack)
        }
        // Un elemento appena creato parte a volume pieno: se questa persona
        // era stata abbassata o zittita, senza questa riga il primo istante di
        // suono uscirebbe comunque a tutto volume.
        applicaAudio()
      })
      stanza.on(RoomEvent.TrackUnsubscribed, (traccia, pubblicazione, partecipante) => {
        if (traccia.kind !== Track.Kind.Audio) return
        rimuoviRiproduzioneAudio(pubblicazione.trackSid)
        fermaDiagnosticaAudio(`remoto:${pubblicazione.trackSid}`)
        if (pubblicazione.source === Track.Source.ScreenShareAudio) {
          volumiAudioRemotiRef.current.delete(pubblicazione.trackSid)
        }
        if (pubblicazione.source === Track.Source.Microphone) {
          const restaUnaVoce = [...riproduzioniAudioRef.current.values()].some(
            (riproduzione) =>
              riproduzione.identita === partecipante.identity &&
              riproduzione.sorgente === Track.Source.Microphone
          )
          if (!restaUnaVoce) {
            riascoltoRef.current?.togli(partecipante.identity)
            rilevatore.current?.togli(partecipante.identity)
          }
        }
      })

      // Nel browser il suono non parte finche' l'utente non ha toccato la
      // pagina. Non e' un guasto e non va nascosto: si mostra un pulsante, si
      // clicca, e da li' in poi non succede piu'.
      stanza.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioBloccato(!stanza.canPlaybackAudio)
      })

      stanza.on(RoomEvent.Disconnected, (motivo?: DisconnectReason) => {
        // Comunque sia finita — usciti, cacciati, linea caduta — la chiamata
        // non c'e' piu', e un allegato che stava salendo al rallentatore puo'
        // riprendere a pieno ritmo. Non basta dirlo in `esci`: da li' non
        // passa chi viene buttato fuori.
        segnalaChiamata(false)

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
        volumiAudioRemotiRef.current.clear()
        fermaTuttoAudio()
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
              // Su una propria condivisione con l'interazione tolta, i
              // puntatori altrui si buttano via qui.
              //
              // Il controllo sta da questa parte e non da quella di chi indica
              // perche' e' l'unica che conta: chi condivide decide sul proprio
              // schermo, e un client modificato non puo' aggirarlo.
              if (senzaInterazioneRef.current.has(String(dati.schermo))) return

              accogliPuntatore({
                id: String(dati.id ?? `${da.identity}-${dati.istante}`),
                schermo: String(dati.schermo),
                x: Number(dati.x),
                y: Number(dati.y),
                colore: coloreDi(da.identity),
                nome: da.name || da.identity,
                tenuto: Boolean(dati.tenuto)
              })
              return
            }

            if (dati.tipo === 'lascia' && da) {
              lasciaPuntatore(String(dati.id), String(dati.schermo))
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
    [
      accogliPuntatore,
      lasciaPuntatore,
      applicaAudio,
      avviaDiagnosticaAudio,
      fermaDiagnosticaAudio,
      fermaTuttoAudio,
      potaCondivisioni,
      rimuoviRiproduzioneAudio,
      ridisegna
    ]
  )

  const entra = useCallback(
    async (ingresso: Ingresso, config: Impostazioni) => {
      setErrore(null)
      setMotivoUscita(null)
      setMessaggi([])
      volumiAudioRemotiRef.current.clear()
      // Le condivisioni aperte valgono per la stanza da cui si esce, non per
      // quella in cui si entra: entrando altrove si riparte da nessuna, e i
      // due posti sono di nuovo liberi.
      guardateRef.current.clear()
      setQuanteGuardate(0)
      // Da adesso un allegato che sale deve farsi da parte: la linea serve
      // prima alle voci.
      segnalaChiamata(true)
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

      // Chi condivideva gia' prima che arrivassimo: `autoSubscribe` se le
      // prenderebbe tutte all'ingresso, ed entrare in una stanza con sei
      // schermi accesi vorrebbe dire sei flussi addosso prima ancora di aver
      // detto "ciao".
      potaCondivisioni(stanza)

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
            config.volumeMicrofono ?? 1,
            config.microfonoNome
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
    [aggancia, applicaAudio, potaCondivisioni, ridisegna]
  )

  const esci = useCallback(async () => {
    if (stanzaRef.current) suona('uscito')
    for (const schermo of schermiRef.current.values()) {
      await schermo.chiudi().catch(() => {})
    }
    schermiRef.current.clear()
    volumiAudioRemotiRef.current.clear()
    guardateRef.current.clear()
    setQuanteGuardate(0)
    segnalaChiamata(false)
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
  // nessuno.
  //
  // Cambiare dispositivo e cambiare modo sembrano due cose diverse, e per un
  // po' hanno avuto due strade diverse: il modo ripubblicava la traccia, il
  // dispositivo si limitava a `switchActiveDevice`, che pareva la mossa
  // elegante — nessuna rinegoziazione, nessun buco di suono per gli altri.
  //
  // Non lo era, perche' la traccia che pubblichiamo NON e' quella del
  // microfono: e' l'uscita della catena audio (vedi `accendiMicrofono`), con
  // dentro il guadagno e il cancello del rumore. `switchActiveDevice` non lo
  // sa: apre il dispositivo per conto suo e sostituisce la traccia pubblicata
  // con quella grezza. Da li' in poi il cursore del volume non muoveva piu'
  // niente, il cancello non tagliava piu' niente, il misuratore leggeva il
  // dispositivo vecchio — rimasto aperto, con la sua spia accesa — e i vincoli
  // del profilo (stereo, bitrate, eco) sparivano.
  //
  // E soprattutto: livekit chiede il dispositivo con `exact`, quindi quando
  // l'id salvato non si risolveva noi gli passavamo `'default'` — il
  // predefinito di Windows, imposto di proposito, mentre le impostazioni
  // continuavano a mostrare il microfono scelto. E' *questo* il microfono
  // sbagliato che si sentiva.
  //
  // Una strada sola, allora: si rifa' la catena da capo, che e' l'unica cosa
  // che sa mettere insieme dispositivo, profilo e guadagno.
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
        const locale = stanza.localParticipant
        const vecchia = locale.getTrackPublication(Track.Source.Microphone)

        // Nessuna traccia pubblicata: il microfono in questa chiamata non e'
        // mai stato acceso, e all'accensione leggera' da se' l'impostazione
        // nuova. Non c'e' niente da rifare.
        if (!vecchia) return

        // Zittito resta zittito. Rifare la catena e ritrovarsi accesi senza
        // aver premuto niente vorrebbe dire mandare fuori una stanza intera
        // solo perche' si e' cambiato microfono nelle impostazioni.
        const eraMuto = vecchia.track?.isMuted ?? !locale.isMicrophoneEnabled

        // Si TOGLIE la traccia vecchia, non la si mette in muto.
        //
        // setMicrophoneEnabled(false) la lascia pubblicata e silenziosa: la
        // nuova si aggiungeva accanto, e chi cambiava modo si sentiva due
        // volte. In muto se ne sentiva una sola, che e' il sintomo da cui si
        // capisce che le tracce vive erano due.
        if (vecchia.track) {
          await locale.unpublishTrack(vecchia.track, true)
        } else {
          await locale.setMicrophoneEnabled(false)
        }

        await accendiMicrofono(
          stanza,
          adesso.modo,
          limitiRef.current!,
          adesso.microfono,
          eraMuto,
          impostazioni.volumeMicrofono ?? 1,
          impostazioni.microfonoNome
        )
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
    void idDaAprire('altoparlante', impostazioni.altoparlanteId, impostazioni.altoparlanteNome)
      .then((vero) => stanza.switchActiveDevice('audiooutput', vero ?? 'default'))
      .catch(() => {
        // Non tutti i sistemi lasciano scegliere l'uscita: se non si puo', si
        // resta su quella di Windows senza dire niente. Non e' un guasto.
      })
  }, [impostazioni.altoparlanteId, impostazioni.altoparlanteNome, stato])

  // E la camera, ma solo se e' accesa: se e' spenta se ne riparla
  // all'accensione, che gia' legge l'impostazione giusta.
  useEffect(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato !== ConnectionState.Connected) return
    if (!stanza.localParticipant.isCameraEnabled) return
    void idDaAprire('camera', impostazioni.cameraId, impostazioni.cameraNome)
      .then((vera) => stanza.switchActiveDevice('videoinput', vera ?? 'default'))
      .catch(() => {})
  }, [impostazioni.cameraId, impostazioni.cameraNome, stato])

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
        impostazioni.volumeMicrofono ?? 1,
        impostazioni.microfonoNome
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
      await accendiCamera(stanza, preset, limitiRef.current!, impostazioni.cameraId, impostazioni.cameraNome)
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

  /**
   * La qualita' di cio' che si RICEVE, decisa da cosa si sta guardando.
   *
   * Chi guarda uno schermo in primo piano lo vuole intero; gli altri schermi,
   * grandi come francobolli nella striscia, non hanno bisogno di trenta
   * fotogrammi al secondo per dire che sono ancora li'. Abbassarli fa
   * risparmiare banda a chi riceve senza togliere niente a cio' che sta
   * effettivamente guardando.
   *
   * Sugli schermi il simulcast e' spento di proposito — chi condivide lo fa per
   * farsi leggere — quindi qui LOW non toglie pixel: toglie fotogrammi, grazie
   * ai livelli temporali di VP9. E' la degradazione giusta per un francobollo.
   *
   * Le persone restano fuori: una faccia sgranata in un riquadro piccolo e' il
   * genere di risparmio che si nota subito e non ripaga.
   */
  /** Con quale preset e' partita ogni condivisione, per id di traccia. */
  const presetSchermiRef = useRef(new Map<string, string>())

  /**
   * Le proprie condivisioni su cui gli altri non possono indicare.
   *
   * Serve a chi condivide, non a chi guarda: e' qui che i puntatori in arrivo
   * vengono ignorati. La spunta nel selettore decide, e da quel momento nessun
   * alone compare piu' sul proprio monitor per quella condivisione.
   */
  const senzaInterazioneRef = useRef(new Set<string>())

  /**
   * Cambia la qualita' di una condivisione gia' accesa.
   *
   * Non la ferma e non la ripubblica: bitrate e fotogrammi si riscrivono sul
   * mittente vivo, quindi chi sta guardando non vede nessuna interruzione. Chi
   * condivide una partita puo' alzare il bitrate mentre gioca.
   */
  const cambiaQualitaCondivisione = useCallback(
    async (idTraccia: string, presetId: string) => {
      const pubblicato = schermiRef.current.get(idTraccia)
      if (!pubblicato) return
      const preset = PRESET_SCHERMO.find((p) => p.id === presetId)
      if (!preset) return

      try {
        await cambiaQualitaSchermo(pubblicato, preset, limitiRef.current!)
        presetSchermiRef.current.set(idTraccia, presetId)
        ridisegna()
      } catch (e) {
        setErrore(`Non sono riuscito a cambiare la qualita': ${(e as Error).message}`)
      }
    },
    [ridisegna]
  )

  /** Il preset con cui sta andando una condivisione, se e' una nostra. */
  const presetDiCondivisione = useCallback(
    (idTraccia: string): string | null => presetSchermiRef.current.get(idTraccia) ?? null,
    []
  )

  /**
   * Cambia finestra o monitor senza togliere la publication dalla stanza.
   *
   * La nuova cattura viene consegnata a `LocalTrack.replaceTrack`: per chi
   * guarda il trackSid e l'elemento video/audio restano gli stessi. Soltanto
   * l'eventuale audio associato puo' nascere o sparire indipendentemente.
   */
  const cambiaSorgenteCondivisione = useCallback(
    async (
      idTraccia: string,
      sorgente: Sorgente | null,
      presetRichiesto?: PresetSchermo,
      audioSistema?: ModoAudioSistema
    ) => {
      const pubblicato = schermiRef.current.get(idTraccia)
      const limiti = limitiRef.current
      if (!pubblicato || !limiti) return

      const presetId = presetSchermiRef.current.get(idTraccia) ?? impostazioni.presetSchermo
      const preset =
        presetRichiesto ?? PRESET_SCHERMO.find((p) => p.id === presetId) ?? PRESET_SCHERMO[0]
      if (!preset) return

      setErrore(null)
      try {
        const stream = await catturaSchermo(
          sorgente,
          preset,
          pubblicato.tipo === 'solo-audio'
            ? 'condiviso'
            : (audioSistema ?? impostazioni.audioSistema)
        )
        await pubblicato.cambiaSorgente(stream, preset, limiti, sorgente?.nome)
        presetSchermiRef.current.set(idTraccia, preset.id)
        if (pubblicato.tipo === 'video') {
          schermiSuMonitorRef.current.set(
            idTraccia,
            sorgente?.tipo === 'schermo' ? sorgente.schermoId : null
          )
        } else {
          schermiSuMonitorRef.current.delete(idTraccia)
        }
        ridisegna()
      } catch (e) {
        const errore = e as Error
        if (errore.name === 'NotAllowedError') return
        setErrore(`Non sono riuscito a cambiare sorgente: ${errore.message}`)
      }
    },
    [impostazioni.audioSistema, impostazioni.presetSchermo, ridisegna]
  )

  /** Il riquadro in primo piano, per l'audio: lo aggiorna `applicaQualita`. */
  const aFuocoRef = useRef<string | null>(null)

  const applicaQualita = useCallback(
    (idAFuoco: string | null) => {
      // Non serve solo alla qualita': anche l'audio delle condivisioni guarda
      // qui, per far sentire solo quella che si sta guardando.
      aFuocoRef.current = idAFuoco
      applicaAudio()

      const stanza = stanzaRef.current
      if (!stanza) return

      // Con adaptiveStream acceso e' livekit a decidere in base alla
      // dimensione del riquadro: mettere bocca qui vorrebbe dire litigare con
      // lui a ogni ridisegno, e vincerebbe lui.
      if (impostazioni.adattaAllaFinestra) return

      for (const partecipante of stanza.remoteParticipants.values()) {
        for (const pubblicazione of partecipante.trackPublications.values()) {
          if (pubblicazione.source !== Track.Source.ScreenShare) continue
          if (!pubblicazione.isSubscribed) continue

          // Senza nessuno in primo piano si torna tutti pieni: in griglia si
          // guardano davvero tutti.
          const alta = idAFuoco === null || pubblicazione.trackSid === idAFuoco
          pubblicazione.setVideoQuality(alta ? VideoQuality.HIGH : VideoQuality.LOW)
        }
      }
    },
    [impostazioni.adattaAllaFinestra, applicaAudio]
  )

  /**
   * Il tempo di andata e ritorno verso la SFU, in millisecondi.
   *
   * Si legge dalle statistiche WebRTC della propria traccia, che e' l'unica
   * strada pubblica: livekit-client non espone un RTT suo, e frugare dentro al
   * suo motore vorrebbe dire rompersi al primo aggiornamento della libreria.
   *
   * Null finche' non c'e' niente da misurare — appena entrati, o con il
   * microfono mai acceso: meglio niente che uno zero che sembra un valore.
   */
  const [latenza, setLatenza] = useState<number | null>(null)

  useEffect(() => {
    if (stato !== ConnectionState.Connected) {
      setLatenza(null)
      return
    }

    const misura = async (): Promise<void> => {
      const stanza = stanzaRef.current
      if (!stanza) return

      // La propria traccia se c'e', altrimenti una qualunque ricevuta: la
      // coppia di connessioni e' la stessa, e il numero pure.
      const locale = stanza.localParticipant.getTrackPublication(Track.Source.Microphone)
      const traccia =
        locale?.track ??
        [...stanza.remoteParticipants.values()]
          .flatMap((p) => [...p.trackPublications.values()])
          .find((pu) => pu.isSubscribed && pu.track)?.track

      const rapporto = await traccia?.getRTCStatsReport().catch(() => undefined)
      if (!rapporto) return

      for (const voce of rapporto.values()) {
        if (voce.type === 'candidate-pair' && voce.state === 'succeeded') {
          const secondi = voce.currentRoundTripTime
          if (typeof secondi === 'number') {
            setLatenza(Math.round(secondi * 1000))
            return
          }
        }
      }
    }

    void misura()
    const battito = window.setInterval(() => void misura(), 3000)
    return () => window.clearInterval(battito)
  }, [stato])

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

  const impostaVolumeAudioCondiviso = useCallback(
    (id: string, valore: number) => {
      const pubblicato = schermiRef.current.get(id)
      if (!pubblicato || pubblicato.tipo !== 'solo-audio') return
      const volume = Math.max(0, Math.min(1, Number.isFinite(valore) ? valore : 1))
      pubblicato.impostaVolume(volume)
      // Come per i cursori delle persone: muoverne uno significa voler
      // sentire/inviare la traccia, quindi la si riaccende se era muta.
      if (volume > 0 && pubblicato.muto) pubblicato.impostaMuto(false)
      ridisegna()
    },
    [ridisegna]
  )

  const alternaMutoAudioCondiviso = useCallback(
    (id: string) => {
      const pubblicato = schermiRef.current.get(id)
      if (!pubblicato || pubblicato.tipo !== 'solo-audio') return
      pubblicato.impostaMuto(!pubblicato.muto)
      ridisegna()
    },
    [ridisegna]
  )

  const statoAudioRemoto = useCallback((id: string) => {
    const esplicito = volumiAudioRemotiRef.current.get(id)
    if (esplicito) return esplicito
    const stanza = stanzaRef.current
    if (!stanza) return { volume: 1, muto: false }
    for (const partecipante of stanza.remoteParticipants.values()) {
      if (!partecipante.trackPublications.has(id)) continue
      const suoi = volumiRef.current.get(partecipante.identity) ?? VOLUMI_INIZIALI
      return { volume: suoi.schermo, muto: suoi.mutoSchermo }
    }
    return { volume: 1, muto: false }
  }, [])

  const impostaVolumeAudioRemoto = useCallback(
    (id: string, valore: number) => {
      const volume = Math.max(0, Math.min(1, Number.isFinite(valore) ? valore : 1))
      volumiAudioRemotiRef.current.set(id, { volume, muto: false })
      applicaAudio()
      ridisegna()
    },
    [applicaAudio, ridisegna]
  )

  const alternaMutoAudioRemoto = useCallback(
    (id: string) => {
      const attuale = statoAudioRemoto(id)
      volumiAudioRemotiRef.current.set(id, { ...attuale, muto: !attuale.muto })
      applicaAudio()
      ridisegna()
    },
    [applicaAudio, ridisegna, statoAudioRemoto]
  )

  const condividi = useCallback(
    async (
      sorgente: Sorgente | null,
      preset: PresetSchermo,
      audioSistema?: ModoAudioSistema,
      /** Solo l'audio, senza immagine: per la musica. */
      soloAudio = false,
      /** Il bitrate dell'audio condiviso. Serve solo con soloAudio. */
      bitrateAudio = 510_000,
      /** Se falso, gli altri non possono indicare punti su questa condivisione. */
      permettiInterazione = true
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
        // Senza immagine l'audio va chiesto comunque: Chromium non cattura
        // l'audio di una sorgente senza catturarne anche il video, e la
        // traccia video la butteremo via subito dopo.
        const stream = await catturaSchermo(
          sorgente,
          preset,
          soloAudio ? 'condiviso' : (audioSistema ?? impostazioni.audioSistema)
        )
        const etichetta = sorgente?.nome ?? `Schermo ${schermiRef.current.size + 1}`

        const finita = (idTraccia: string): void => {
          // Chiusa dalla barra di Windows o perche' la finestra non c'e'
          // piu': si toglie dall'elenco e si fa lo stesso rumore di quando la
          // si chiude dal pulsante, perche' per chi guarda e' successa
          // esattamente la stessa cosa.
          schermiRef.current.delete(idTraccia)
          schermiSuMonitorRef.current.delete(idTraccia)
          presetSchermiRef.current.delete(idTraccia)
          senzaInterazioneRef.current.delete(idTraccia)
          suona('condivisioneFinita')
          ridisegna()
        }

        const pubblicato = soloAudio
          ? await pubblicaSoloAudio(stanza, stream, limiti, etichetta, bitrateAudio, finita)
          : await pubblicaSchermo(
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
            finita(idTraccia)
          }
        )
        schermiRef.current.set(pubblicato.id, pubblicato)
        // Serve a sapere quale voce e' spuntata nel menu, e a non riapplicare
        // una qualita' che c'e' gia'.
        presetSchermiRef.current.set(pubblicato.id, preset.id)
        if (!permettiInterazione) senzaInterazioneRef.current.add(pubblicato.id)
        // Serve al puntatore: quando qualcuno indica questo riquadro, e' su
        // questo monitor che va disegnato l'alone. Le finestre singole non
        // hanno un monitor proprio — di quelle Electron non conosce la
        // posizione — e li' il cerchietto resta dentro all'app.
        schermiSuMonitorRef.current.set(
          pubblicato.id,
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
        presetSchermiRef.current.delete(id)
        senzaInterazioneRef.current.delete(id)
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

    // Gia' in corso: questa pressione lo ferma e basta.
    //
    // Prima ogni pressione faceva ripartire da capo. Premuto tre volte di
    // seguito — cosa che si fa, perche' il primo secondo di riascolto sembra
    // silenzio — partivano tre riproduzioni sovrapposte, e si sentiva un coro.
    if (fermaRef.current) {
      fermaRef.current()
      fermaRef.current = null
      attenuazioneRef.current = 1
      applicaAudio()
      setRiascoltoInCorso(null)
      return
    }

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
    (schermo: string, x: number, y: number, tenuto = false) => {
      const stanza = stanzaRef.current
      if (!stanza) return

      const io = stanza.localParticipant

      // Un puntatore tenuto ha un id stabile — uno per persona — cosi' i
      // movimenti aggiornano quello che c'e' invece di accumularne uno nuovo a
      // ogni pixel. Il tocco invece ha l'istante, perche' due tocchi vicini
      // sono due cose distinte.
      const id = tenuto ? `${io.identity}-tenuto` : `${io.identity}-${Date.now()}`
      const carico = { tipo: 'punta', id, schermo, x, y, tenuto }

      void stanza.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(carico)),
        // I movimenti di un puntatore tenuto sono tanti e sostituibili: se uno
        // si perde, quello dopo lo rimpiazza un centesimo di secondo dopo.
        // Chiederli affidabili li metterebbe in coda dietro a se stessi.
        { reliable: !tenuto }
      )

      // Anche a se stessi, subito: chi indica deve vedere dove ha indicato
      // senza aspettare che il pacchetto faccia il giro.
      accogliPuntatore({
        id,
        schermo,
        x,
        y,
        colore: coloreDi(io.identity),
        nome: io.name || 'tu',
        tenuto
      })
    },
    [accogliPuntatore]
  )

  /** Lascia la presa: il puntatore tenuto sparisce per tutti. */
  const lascia = useCallback(
    (schermo: string) => {
      const stanza = stanzaRef.current
      if (!stanza) return
      const id = `${stanza.localParticipant.identity}-tenuto`
      void stanza.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ tipo: 'lascia', id, schermo })),
        { reliable: true }
      )
      lasciaPuntatore(id, schermo)
    },
    [lasciaPuntatore]
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

  // La soglia dell'automute, applicata mentre si parla come il guadagno: la si
  // regola guardando il misuratore, e aspettare un rientro in stanza per
  // sentire l'effetto renderebbe la regolazione impossibile.
  useEffect(() => {
    impostaSogliaMicrofono(impostazioni.sogliaMicrofono ?? 0)
  }, [impostazioni.sogliaMicrofono])

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

  const { riquadri, persone, schermiAttivi, audioCondivisi, audioRemoti } = useMemo(() => {
    const stanza = stanzaRef.current
    if (!stanza || stato === ConnectionState.Disconnected) {
      return {
        riquadri: [] as Riquadro[],
        persone: [] as Persona[],
        schermiAttivi: [],
        audioCondivisi: [] as AudioCondiviso[],
        audioRemoti: [] as AudioRemoto[]
      }
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

    const schermiAttivi = [...schermiRef.current.entries()]
      .filter(([, s]) => s.tipo === 'video')
      .map(([id, s]) => ({ id, etichetta: s.etichetta }))

    const audioCondivisi = [...schermiRef.current.entries()]
      .filter(([, s]) => s.tipo === 'solo-audio')
      .map(([id, s]) => ({
        id,
        etichetta: s.etichetta,
        volume: s.volume,
        muto: s.muto,
        attivo: !s.muto && s.volume > 0
      }))

    const audioRemoti: AudioRemoto[] = []
    stanza.remoteParticipants.forEach((partecipante) => {
      const suoi = volumiRef.current.get(partecipante.identity) ?? VOLUMI_INIZIALI
      partecipante.trackPublications.forEach((pubblicazione) => {
        if (pubblicazione.source !== Track.Source.ScreenShareAudio) return
        const etichetta = etichettaSoloAudio(pubblicazione.trackName || '')
        // L'audio che accompagna un riquadro video resta regolato dal menu di
        // quel riquadro; nel popup a onde entrano soltanto gli standalone.
        if (etichetta === null) return
        const esplicito = volumiAudioRemotiRef.current.get(pubblicazione.trackSid)
        audioRemoti.push({
          id: pubblicazione.trackSid,
          identita: partecipante.identity,
          nome: partecipante.name || partecipante.identity,
          etichetta: etichetta || `Audio di ${partecipante.name || partecipante.identity}`,
          volume: esplicito?.volume ?? suoi.schermo,
          muto: esplicito?.muto ?? suoi.mutoSchermo
        })
      })
    })
    audioRemoti.sort((a, b) =>
      `${a.nome}:${a.etichetta}`.localeCompare(`${b.nome}:${b.etichetta}`, 'it')
    )

    return { riquadri, persone, schermiAttivi, audioCondivisi, audioRemoti }
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
    // Erano gia' scritte, gia' dichiarate nell'interfaccia e gia' calcolate:
    // mancava solo che uscissero di qui. Senza queste righe restavano codice
    // morto, e il controllo dei tipi lo diceva.
    audioCondivisi,
    audioRemoti,
    cambiaSorgenteCondivisione,
    impostaVolumeAudioCondiviso,
    alternaMutoAudioCondiviso,
    impostaVolumeAudioRemoto,
    alternaMutoAudioRemoto,
    microfoniSpenti,
    latenza,
    applicaQualita,
    cambiaQualitaCondivisione,
    presetDiCondivisione,
    audioBloccato,
    sbloccaAudio,
    riascoltoAttivo,
    riascoltoInCorso,
    riascolta,
    fermaRiascolto,
    puntatori,
    punta,
    lascia,
    guarda,
    nonGuardare,
    /** Quante condivisioni altrui si stanno ricevendo adesso, su due. */
    quanteGuardate,
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
