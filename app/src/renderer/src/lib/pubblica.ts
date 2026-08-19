import {
  LocalAudioTrack,
  LocalVideoTrack,
  Track,
  type AudioCaptureOptions,
  type LocalTrackPublication,
  type Room,
  type TrackPublishOptions,
  type VideoCodec
} from 'livekit-client'
import {
  entroILimiti,
  entroILimitiAudio,
  entroILimitiCamera,
  PROFILI_AUDIO,
  type Degradazione,
  type Limiti,
  type ModoAudio,
  type PresetCamera,
  type PresetSchermo
} from '@shared/qualita'
import type { ModoAudioSistema, Sorgente } from '@shared/tipi'
import { ponte } from '../ponte'

/**
 * Dove i tetti vengono tolti davvero.
 *
 * Tutto il resto del programma — il server, le stanze, i gettoni — serve a
 * portare due persone dentro la stessa chiamata. Quello che si vedono e' deciso
 * qui, in quattro decisioni che valgono piu' di qualunque numero:
 *
 *   1. `contentHint = 'text'`     dice al codificatore di tenere i bordi netti
 *                                 invece di ammorbidire per risparmiare bit.
 *   2. `degradationPreference`    dice cosa sacrificare quando non si arriva:
 *                                 i fotogrammi, o la risoluzione.
 *   3. niente simulcast           sullo schermo, dove le copie a bassa
 *                                 risoluzione mangiano meta' banda per niente.
 *   4. i parametri riscritti      dopo la pubblicazione, perche' e' l'unico
 *      sul sender                 punto in cui nessuna libreria puo' piu'
 *                                 abbassare quello che abbiamo chiesto.
 *
 * La quarta e' quella che tiene. Le prime tre passano da livekit-client, che
 * ha le sue idee su cosa sia ragionevole; l'ultima parla direttamente a WebRTC.
 */

function codecPerWebRtc(codec: string): VideoCodec {
  return codec as VideoCodec
}

/**
 * `nitidezza` -> 'maintain-resolution'.
 *
 * E' l'impostazione che separa uno schermo condiviso leggibile da una macchia
 * colorata. Con 'maintain-framerate' — il default di Chrome — appena la banda
 * stringe la risoluzione crolla, e il testo sparisce per primo perche' e' fatto
 * di dettagli sottili. Con 'maintain-resolution' cadono i fotogrammi: il
 * puntatore si muove a scatti, ma il codice resta leggibile.
 */
function preferenza(degradazione: Degradazione): RTCDegradationPreference {
  if (degradazione === 'nitidezza') return 'maintain-resolution'
  if (degradazione === 'fluidita') return 'maintain-framerate'
  return 'balanced'
}

/**
 * Riscrive i parametri del mittente dopo la pubblicazione.
 *
 * Serve perche' fra quello che si chiede e quello che parte c'e' di mezzo
 * livekit-client, che applica i suoi massimi, e Chrome, che applica i suoi.
 * `setParameters` e' l'ultimo anello: quello che si scrive qui e' quello che il
 * codificatore riceve.
 *
 * In particolare `scaleResolutionDownBy = 1` toglie qualunque riduzione che
 * qualcuno abbia deciso per noi, ed e' il motivo per cui uno schermo 4K arriva
 * davvero a 4K invece che al 1080p che sembrava ragionevole a qualche libreria.
 */
export async function forzaParametri(
  traccia: LocalVideoTrack,
  opzioni: { bitrate: number; fps: number; degradazione: Degradazione }
): Promise<void> {
  const mittente = traccia.sender
  if (!mittente) return

  const parametri = mittente.getParameters()
  parametri.degradationPreference = preferenza(opzioni.degradazione)

  // `encodings` puo' essere vuoto per un istante subito dopo la pubblicazione:
  // in quel caso non c'e' niente da riscrivere e si riprova al giro dopo.
  if (!parametri.encodings?.length) return

  for (const codifica of parametri.encodings) {
    codifica.active = true
    codifica.maxBitrate = opzioni.bitrate
    codifica.maxFramerate = opzioni.fps
    codifica.scaleResolutionDownBy = 1
  }

  try {
    await mittente.setParameters(parametri)
  } catch {
    // Chrome rifiuta i cambiamenti strutturali (aggiungere o togliere layer),
    // non questi. Se succede lo stesso, la pubblicazione resta valida con i
    // valori che livekit-client aveva gia' messo: peggiore, non rotta.
  }
}

// -- Schermo ------------------------------------------------------------------

/**
 * Chiede a Chromium i pixel dello schermo.
 *
 * Dentro Electron la sorgente e' gia' stata scelta nel nostro selettore, e
 * `preparaCattura` l'ha appena detta al processo principale: qui si chiede e
 * basta. Nel browser questa chiamata fa comparire la finestra di Chrome, ed e'
 * giusto cosi' — nel web la scelta di cosa mostrare non deve mai essere di
 * chi guarda.
 */
export async function catturaSchermo(
  sorgente: Sorgente | null,
  preset: PresetSchermo,
  audioSistema: ModoAudioSistema
): Promise<MediaStream> {
  // Una scheda di acquisizione o una camera non passano da desktopCapturer:
  // si aprono come un microfono, con il loro id. L'audio di sistema qui non
  // c'entra — se il dispositivo ha un suo audio arriva insieme.
  if (sorgente?.tipo === 'dispositivo') {
    return navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: sorgente.id },
        frameRate: { ideal: preset.fps, max: preset.fps },
        ...(preset.altezza > 0 ? { height: { max: preset.altezza } } : {})
      },
      audio: false
    })
  }

  if (ponte.elettrone && sorgente) {
    await ponte.preparaCattura({ sorgenteId: sorgente.id, audioSistema })
  }

  const vincoliVideo: MediaTrackConstraints = {
    frameRate: { ideal: preset.fps, max: preset.fps }
  }

  // Altezza 0 significa "nativa": non si scrive nessun vincolo, cosi' Chrome
  // consegna i pixel veri dello schermo. Metterci un massimo alto sarebbe
  // uguale in teoria, e in pratica su qualche driver fa scattare una scalatura
  // che non serviva a niente.
  if (preset.altezza > 0) {
    vincoliVideo.height = { max: preset.altezza }
    vincoliVideo.width = { max: Math.ceil((preset.altezza * 16) / 9) }
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: vincoliVideo,
    // Nel browser questo diventa la spunta "condividi l'audio"; dentro
    // Electron e' il loopback di Windows, gia' deciso da preparaCattura.
    audio: audioSistema !== 'niente'
  })

  const video = stream.getVideoTracks()[0]
  if (video) {
    // La riga piu' economica di tutto il programma, e una delle piu' efficaci.
    video.contentHint = preset.indizio
  }

  return stream
}

export interface SchermoPubblicato {
  /**
   * Come questa condivisione si chiama per tutti gli altri.
   *
   * E' il trackSid del video, o quello dell'audio quando video non ce n'e'.
   * Esiste come campo suo perche' con la condivisione di solo audio nessuno
   * puo' piu' scrivere `pubblicato.video.trackSid` e sperare che ci sia.
   */
  id: string
  /** Manca nelle condivisioni di solo audio. */
  video: LocalTrackPublication | null
  audio: LocalTrackPublication | null
  /** Il nome da mostrare: la finestra, o cio' che si sta suonando. */
  etichetta: string
  /** Ferma la cattura e toglie le tracce dalla stanza. */
  chiudi: () => Promise<void>
}

/**
 * Condivide SOLO l'audio di una sorgente, senza immagine.
 *
 * Serve per la musica, ed e' il caso in cui il video non e' un di piu' ma un
 * danno: trenta megabit al secondo per mostrare la finestra ferma di un
 * lettore multimediale, mentre quello che conta sono i 510 kbit dell'audio.
 * Senza video la banda va tutta dove serve, e dall'altra parte non compare un
 * riquadro da guardare che non ha niente da mostrare.
 *
 * La cattura resta quella di sempre — Chromium non sa catturare l'audio di una
 * finestra senza catturarne anche l'immagine — ma la traccia video viene
 * fermata subito e non pubblicata mai.
 */
export async function pubblicaSoloAudio(
  stanza: Room,
  stream: MediaStream,
  limiti: Limiti,
  etichetta: string,
  bitrate: number,
  quandoFinisce?: (idTraccia: string) => void
): Promise<SchermoPubblicato> {
  const tracceAudio = stream.getAudioTracks()

  // Il video si ferma subito: non pubblicarlo basterebbe a non farlo viaggiare,
  // ma lasciarlo vivo terrebbe accesa la cattura dello schermo, con la sua
  // cornice gialla e il suo costo, per niente.
  for (const t of stream.getVideoTracks()) t.stop()

  if (!tracceAudio.length) {
    throw new Error(
      "Questa sorgente non da' audio. Su Windows l'audio si prende da uno schermo intero, " +
        'oppure da una finestra spuntando "Condividi audio" nella finestra di scelta.'
    )
  }

  const traccia = new LocalAudioTrack(tracceAudio[0], undefined, false)
  const audio = await stanza.localParticipant.publishTrack(traccia, {
    source: Track.Source.ScreenShareAudio,
    name: etichetta,
    audioPreset: { maxBitrate: Math.min(bitrate, limiti.bitrateVoce) },
    forceStereo: true,
    // DTX taglia i silenzi: su una voce fa risparmiare, su una traccia
    // musicale mangia le code delle note e i passaggi in dissolvenza.
    dtx: false,
    red: false
  })

  tracceAudio[0].addEventListener(
    'ended',
    () => {
      void chiudi()
      quandoFinisce?.(audio.trackSid)
    },
    { once: true }
  )

  const chiudi = async (): Promise<void> => {
    await stanza.localParticipant.unpublishTrack(traccia, true)
    for (const t of stream.getTracks()) t.stop()
  }

  return { id: audio.trackSid, video: null, audio, etichetta, chiudi }
}

/**
 * Cambia la qualita' di una condivisione **gia' accesa**, senza spegnerla.
 *
 * Bitrate, fotogrammi e preferenza di degradazione si riscrivono direttamente
 * sul mittente WebRTC: non serve ripubblicare, quindi chi sta guardando non
 * vede il buco nero di un secondo che una ripubblicazione costerebbe. E' anche
 * il motivo per cui questa strada esiste invece di "chiudi e riapri": chi
 * condivide una partita o una compilazione non puo' permettersi di sparire per
 * alzare il bitrate.
 *
 * Quello che NON si puo' cambiare cosi' e' il codec e la sorgente: per quelli
 * la traccia va rifatta, e chi chiama deve saperlo.
 */
export async function cambiaQualitaSchermo(
  pubblicato: SchermoPubblicato,
  presetGrezzo: PresetSchermo,
  limiti: Limiti
): Promise<void> {
  const preset = entroILimiti(presetGrezzo, limiti)
  // Su una condivisione di solo audio non c e niente da riqualificare.
  const traccia = pubblicato.video?.track as LocalVideoTrack | undefined
  if (!traccia) return

  await forzaParametri(traccia, {
    bitrate: preset.bitrate,
    fps: preset.fps,
    degradazione: preset.degradazione
  })
}

export async function pubblicaSchermo(
  stanza: Room,
  stream: MediaStream,
  presetGrezzo: PresetSchermo,
  limiti: Limiti,
  etichetta: string,
  /**
   * Chiamata quando la condivisione finisce **da sola**: la finestra viene
   * chiusa, o si preme "Interrompi condivisione" nella barra di Windows.
   *
   * Senza questo avviso la traccia spariva davvero ma la sessione continuava
   * a contare quello schermo fra i suoi: restava il pulsante rosso per
   * chiudere una cosa gia' chiusa, e non lo si poteva nemmeno premere due
   * volte per farlo sparire.
   */
  quandoFinisce?: (idTraccia: string) => void
): Promise<SchermoPubblicato> {
  const preset = entroILimiti(presetGrezzo, limiti)

  const mediaVideo = stream.getVideoTracks()[0]
  if (!mediaVideo) throw new Error('La cattura non ha restituito nessun video.')

  const traccia = new LocalVideoTrack(mediaVideo, undefined, false)

  const video = await stanza.localParticipant.publishTrack(traccia, {
    source: Track.Source.ScreenShare,
    // Il nome distingue il primo schermo dal secondo. LiveKit lascia
    // pubblicare piu' tracce con la stessa sorgente; senza un nome, dall'altra
    // parte sarebbero due riquadri identici senza modo di dire quale sia quale.
    name: etichetta,
    videoCodec: codecPerWebRtc(preset.codec),
    videoEncoding: {
      maxBitrate: preset.bitrate,
      maxFramerate: preset.fps,
      priority: 'high'
    },
    // Niente simulcast sullo schermo. LiveKit lo accenderebbe da solo, e
    // produrrebbe due copie ridotte che costano meta' della banda e che
    // nessuno guarda: chi condivide uno schermo lo condivide per farlo leggere.
    simulcast: false,
    // Per VP9 e AV1 restano i livelli temporali, che invece servono: chi ha la
    // linea lenta riceve meno fotogrammi, non meno pixel.
    scalabilityMode: preset.codec === 'vp9' || preset.codec === 'av1' ? 'L1T3' : undefined,
    degradationPreference: preferenza(preset.degradazione),
    // Un secondo codec di scorta raddoppia il lavoro del codificatore per
    // servire i browser vecchi. Qui i client li scegliamo noi.
    backupCodec: false
  })

  await forzaParametri(traccia, {
    bitrate: preset.bitrate,
    fps: preset.fps,
    degradazione: preset.degradazione
  })

  // Subito dopo la pubblicazione `encodings` puo' essere ancora vuoto: un
  // secondo giro poco dopo lo trova pronto. Costa un timer e salva il caso in
  // cui la prima scrittura non ha trovato niente da scrivere.
  setTimeout(() => {
    void forzaParametri(traccia, {
      bitrate: preset.bitrate,
      fps: preset.fps,
      degradazione: preset.degradazione
    })
  }, 1500)

  // L'audio di sistema, se c'e'. Sempre alla massima qualita' e sempre stereo:
  // non e' una voce, e' la colonna sonora di quello che si sta mostrando.
  let audio: LocalTrackPublication | null = null
  const mediaAudio = stream.getAudioTracks()[0]
  if (mediaAudio) {
    const tracciaAudio = new LocalAudioTrack(mediaAudio, undefined, false)
    audio = await stanza.localParticipant.publishTrack(tracciaAudio, {
      source: Track.Source.ScreenShareAudio,
      name: `${etichetta} (audio)`,
      audioPreset: { maxBitrate: Math.min(510_000, limiti.bitrateVoce) },
      forceStereo: true,
      dtx: false,
      red: false
    })
  }

  // Chi ferma la condivisione dalla barra di Windows invece che dalla nostra:
  // la traccia finisce, e la stanza deve accorgersene da sola.
  const chiudi = async (): Promise<void> => {
    if (audio) await stanza.localParticipant.unpublishTrack(audio.track!, true)
    await stanza.localParticipant.unpublishTrack(traccia, true)
    for (const t of stream.getTracks()) t.stop()
  }

  mediaVideo.addEventListener(
    'ended',
    () => {
      void chiudi()
      quandoFinisce?.(video.trackSid)
    },
    { once: true }
  )

  return { id: video.trackSid, video, audio, etichetta, chiudi }
}

// -- Camera -------------------------------------------------------------------

export async function accendiCamera(
  stanza: Room,
  presetGrezzo: PresetCamera,
  limiti: Limiti,
  dispositivoId: string | null
): Promise<void> {
  const preset = entroILimitiCamera(presetGrezzo, limiti)

  await stanza.localParticipant.setCameraEnabled(
    true,
    {
      deviceId: dispositivoId ?? undefined,
      resolution: {
        width: Math.round((preset.altezza * 16) / 9),
        height: preset.altezza,
        frameRate: preset.fps
      }
    },
    {
      videoCodec: codecPerWebRtc(preset.codec),
      videoEncoding: { maxBitrate: preset.bitrate, maxFramerate: preset.fps },
      // Sulla camera il simulcast serve eccome, ed e' l'opposto dello schermo:
      // un volto a 360p resta un volto riconoscibile, e chi ha la linea lenta
      // riceve quello invece di niente.
      simulcast: true,
      degradationPreference: 'balanced'
    }
  )
}

// -- Microfono ----------------------------------------------------------------

/**
 * La catena del microfono, tenuta qui fuori da React.
 *
 * Fra il dispositivo e cio' che si pubblica c'e' un GainNode, sempre — anche
 * quando il guadagno e' 1 e non fa niente. Averlo sempre e' cio' che permette
 * di girare la manopola durante una chiamata e sentire l'effetto subito: se la
 * catena si costruisse solo quando serve, il primo movimento del cursore
 * costerebbe una ripubblicazione della traccia, cioe' un buco di suono per
 * tutti gli altri.
 *
 * La cancellazione dell'eco non ne soffre: quella la fa Chrome dentro
 * `getUserMedia`, prima di qui.
 */
interface CatenaMicrofono {
  contesto: AudioContext
  guadagno: GainNode
  /** Legge il livello PRIMA del guadagno: serve al misuratore e al cancello. */
  analizzatore: AnalyserNode
  /** Lo stream vero del dispositivo: va fermato a mano, o resta la spia accesa. */
  grezzo: MediaStream
  /** Il campionamento periodico del livello, da fermare smontando. */
  battito: number
}

let catena: CatenaMicrofono | null = null

/** Quanto vuole l'utente, prima che il cancello ci metta bocca. */
let guadagnoVoluto = 1

/** Sotto questo livello non esce niente. Zero tiene il cancello sempre aperto. */
let soglia = 0

/** L'ultimo livello misurato, da 0 a 1. Lo legge il misuratore nelle impostazioni. */
let livello = 0

/** Fino a quando tenere aperto dopo l'ultimo suono sopra soglia. */
let apertoFino = 0

/**
 * Quanto il cancello resta aperto dopo che si e' scesi sotto la soglia.
 *
 * Senza questa coda il cancello taglia la fine delle parole: le consonanti
 * finali stanno sotto soglia quasi sempre, e chiudere di netto da' un parlato
 * mozzato che si sente peggio del rumore che si voleva togliere.
 */
const CODA_MS = 350

/** Gira la manopola dell'entrata, senza toccare la traccia pubblicata. */
export function impostaGuadagnoMicrofono(valore: number): void {
  guadagnoVoluto = valore
  applicaGuadagno()
}

/**
 * La soglia sotto la quale il microfono non trasmette, da 0 a 1.
 *
 * E' l'automute alla Discord: si alza finche' il rumore di fondo — la ventola,
 * la tastiera, la strada — resta sotto e la voce sopra. Zero lo spegne del
 * tutto, ed e' il valore di partenza: un cancello tarato male taglia le parole,
 * e va acceso da chi ha davanti il misuratore per regolarlo.
 */
export function impostaSogliaMicrofono(valore: number): void {
  soglia = Math.max(0, Math.min(1, valore))
  applicaGuadagno()
}

/** Il livello del microfono adesso, da 0 a 1. Zero se non c'e' una catena viva. */
export function livelloMicrofono(): number {
  return catena ? livello : 0
}

/** Vero se il cancello sta lasciando passare: il misuratore lo mostra. */
export function microfonoPassa(): boolean {
  if (!catena) return false
  if (soglia <= 0) return true
  return performance.now() < apertoFino
}

function applicaGuadagno(): void {
  if (!catena) return
  const valore = soglia > 0 && !microfonoPassa() ? 0 : guadagnoVoluto
  // A rampa e non di scatto: un salto secco del guadagno fa un "click" udibile
  // dall'altra parte.
  catena.guadagno.gain.setTargetAtTime(valore, catena.contesto.currentTime, 0.05)
}

/**
 * Smonta la catena. Va chiamata uscendo dalla stanza.
 *
 * LiveKit, disconnettendosi, ferma la traccia che gli abbiamo dato — che e'
 * quella in uscita dal GainNode, non quella del microfono. Senza queste due
 * righe il dispositivo resterebbe aperto: su un portatile e' la spia della
 * webcam del microfono che non si spegne piu' finche' non si chiude l'app.
 */
export async function chiudiCatenaMicrofono(): Promise<void> {
  const vecchia = catena
  catena = null
  livello = 0
  if (!vecchia) return
  // Il battito continuerebbe a girare su un contesto chiuso: ogni ingresso in
  // stanza ne lascerebbe uno in piu' acceso per tutta la vita dell'app.
  window.clearInterval(vecchia.battito)
  for (const traccia of vecchia.grezzo.getTracks()) traccia.stop()
  await vecchia.contesto.close().catch(() => {})
}

/**
 * Il microfono, e la differenza fra parlare e suonare.
 *
 * In `voce` e' quello che fanno tutti: mono, eco cancellata, rumore soppresso.
 * In `musica` e' spento tutto e si apre a 510 kbit/s stereo — che e' il massimo
 * che Opus accetta, e a quel punto il codec smette di essere il collo di
 * bottiglia. Discord si ferma a 96, e non e' un limite tecnico: e' banda che
 * costa a chi la paga.
 */
export async function accendiMicrofono(
  stanza: Room,
  modo: ModoAudio,
  limiti: Limiti,
  dispositivoId: string | null,
  partiMuto = false,
  guadagno = 1
): Promise<void> {
  const profilo = entroILimitiAudio(PROFILI_AUDIO[modo], limiti)

  const cattura: AudioCaptureOptions = {
    deviceId: dispositivoId ?? undefined,
    echoCancellation: profilo.cancellazioneEco,
    noiseSuppression: profilo.soppressioneRumore,
    autoGainControl: profilo.guadagnoAutomatico,
    channelCount: profilo.stereo ? 2 : 1
  }

  const pubblicazione: TrackPublishOptions = {
    source: Track.Source.Microphone,
    audioPreset: { maxBitrate: profilo.bitrate },
    // `forceStereo` non e' solo il numero di canali: scrive `stereo=1` nella
    // negoziazione, senza cui l'altro capo riceve due canali identici.
    forceStereo: profilo.stereo,
    dtx: profilo.silenzioCompresso,
    // RED raddoppia i pacchetti per sopravvivere alle perdite. Sulla voce
    // vale la pena; sulla musica raddoppierebbe mezzo megabit al secondo.
    red: profilo.silenzioCompresso
  }

  await chiudiCatenaMicrofono()

  const grezzo = await navigator.mediaDevices.getUserMedia({ audio: cattura })
  const contesto = new AudioContext()
  if (contesto.state === 'suspended') await contesto.resume().catch(() => {})

  const sorgente = contesto.createMediaStreamSource(grezzo)
  const nodo = contesto.createGain()
  nodo.gain.value = guadagno
  const uscita = contesto.createMediaStreamDestination()

  // L'analizzatore sta PRIMA del guadagno, e non e' un dettaglio: deve
  // misurare quanto forte parli, non quanto forte esce. Messo dopo il cancello
  // leggerebbe zero appena il cancello chiude, e non riaprirebbe mai piu'.
  const analizzatore = contesto.createAnalyser()
  analizzatore.fftSize = 1024
  sorgente.connect(analizzatore)

  sorgente.connect(nodo).connect(uscita)

  guadagnoVoluto = guadagno
  livello = 0
  apertoFino = 0

  const campioni = new Float32Array(analizzatore.fftSize)
  const battito = window.setInterval(() => {
    const viva = catena
    if (!viva) return
    viva.analizzatore.getFloatTimeDomainData(campioni)

    // Valore efficace, non il picco: il picco salta a un colpo sul tavolo,
    // l'efficace segue la voce, ed e' la voce che deve aprire il cancello.
    let somma = 0
    for (let i = 0; i < campioni.length; i++) somma += campioni[i] * campioni[i]
    livello = Math.sqrt(somma / campioni.length)

    if (soglia > 0) {
      if (livello >= soglia) apertoFino = performance.now() + CODA_MS
      applicaGuadagno()
    }
  }, 50)

  catena = { contesto, guadagno: nodo, analizzatore, grezzo, battito }

  const traccia = new LocalAudioTrack(uscita.stream.getAudioTracks()[0], undefined, false)

  // Entrare in una stanza non deve far sentire niente.
  //
  // La strada ovvia — pubblicare e poi zittire — lascia aperta una finestra di
  // qualche decina di millisecondi in cui l'audio parte davvero. E' poco, ed e'
  // abbastanza per far arrivare agli altri il respiro di chi si e' appena
  // seduto. Qui la traccia viene zittita prima di essere pubblicata: fuori non
  // esce niente, mai.
  if (partiMuto) await traccia.mute()

  await stanza.localParticipant.publishTrack(traccia, pubblicazione)
}
