/**
 * I preset di qualita', cioe' il motivo per cui questo programma esiste.
 *
 * Non importa niente da livekit-client di proposito: questo file lo legge
 * anche il processo principale, che gira su Node e non ha il DOM. Sono numeri
 * e nomi, e la traduzione in oggetti WebRTC avviene una volta sola, in
 * `renderer/src/lib/pubblica.ts`.
 *
 * Per avere un riferimento di quanto siano alti questi numeri:
 *
 *   Discord gratis     schermo 1080p30 a 2,5 Mbit/s      voce  96 kbit/s mono
 *   Discord Nitro      schermo 4K60    a   8 Mbit/s      voce 384 kbit/s
 *   qui                schermo 4K60    a  50 Mbit/s      voce 510 kbit/s stereo
 *
 * La differenza si vede soprattutto sul testo piccolo, che e' poi il caso per
 * cui si condivide uno schermo il 90% delle volte.
 */

export type Codec = 'vp9' | 'vp8' | 'h264' | 'av1'

/**
 * Cosa dire al codificatore quando la banda non basta.
 *
 * E' l'impostazione che conta di piu' di tutte, piu' del bitrate.
 *
 *   nitidezza  tiene la risoluzione e lascia cadere i fotogrammi. Il testo
 *              resta leggibile, il movimento diventa a scatti.
 *   fluidita'  tiene i fotogrammi e riduce la risoluzione. E' quello che fa
 *              Discord, ed e' il motivo per cui il codice condiviso diventa
 *              una macchia appena qualcuno muove una finestra.
 *   bilanciato lascia decidere al browser.
 */
export type Degradazione = 'nitidezza' | 'fluidita' | 'bilanciato'

export interface PresetSchermo {
  id: string
  nome: string
  /** Una riga che dice quando sceglierlo, mostrata sotto al nome. */
  spiegazione: string
  /** 0 = la risoluzione nativa dello schermo, senza ridurre niente. */
  altezza: number
  fps: number
  bitrate: number
  codec: Codec
  degradazione: Degradazione
  /**
   * `contentHint` sulla traccia. Non e' un sinonimo della degradazione: quella
   * dice cosa sacrificare, questo dice come codificare. 'text' accende nel
   * codificatore le scelte che tengono i bordi netti — ed e' gratis.
   */
  indizio: 'text' | 'detail' | 'motion'
}

export const PRESET_SCHERMO: PresetSchermo[] = [
  {
    id: 'codice',
    nome: 'Codice e testo',
    spiegazione: 'Risoluzione nativa, nitidezza sopra a tutto. Per leggere davvero quello che c\'e\' scritto.',
    altezza: 0,
    fps: 30,
    bitrate: 25_000_000,
    codec: 'vp9',
    degradazione: 'nitidezza',
    indizio: 'text'
  },
  {
    id: 'gioco',
    nome: 'Gioco e movimento',
    spiegazione: '1440p a 60, codificato dalla scheda video. Fluido, e non scalda il processore.',
    altezza: 1440,
    fps: 60,
    bitrate: 35_000_000,
    codec: 'h264',
    degradazione: 'fluidita',
    indizio: 'motion'
  },
  {
    id: 'tutto',
    nome: 'Senza compromessi',
    spiegazione: '4K a 60 fotogrammi, 50 Mbit/s. Vuole una linea in salita seria e un processore che tenga.',
    altezza: 2160,
    fps: 60,
    bitrate: 50_000_000,
    codec: 'vp9',
    degradazione: 'nitidezza',
    indizio: 'detail'
  },
  {
    id: 'leggero',
    nome: 'Linea lenta',
    spiegazione: '1080p30 a 4 Mbit/s. Per l\'hotspot del telefono, o per un portatile che soffre.',
    altezza: 1080,
    fps: 30,
    bitrate: 4_000_000,
    codec: 'h264',
    degradazione: 'nitidezza',
    indizio: 'text'
  }
]

export interface PresetCamera {
  id: string
  nome: string
  altezza: number
  fps: number
  bitrate: number
  codec: Codec
}

export const PRESET_CAMERA: PresetCamera[] = [
  { id: 'alta', nome: '1080p 30', altezza: 1080, fps: 30, bitrate: 4_000_000, codec: 'vp9' },
  { id: 'media', nome: '720p 30', altezza: 720, fps: 30, bitrate: 1_800_000, codec: 'vp9' },
  { id: 'quattrok', nome: '4K 30', altezza: 2160, fps: 30, bitrate: 12_000_000, codec: 'vp9' }
]

/**
 * I due modi dell'audio, e sono davvero due mestieri diversi.
 *
 * `voce` e' quello che fanno tutti: mono, cancellazione dell'eco accesa,
 * soppressione del rumore accesa, guadagno automatico. Perfetto per parlare,
 * distruttivo per qualunque altra cosa — la soppressione del rumore scambia
 * una chitarra per rumore e la cancella a meta' frase.
 *
 * `musica` spegne tutto e apre a 510 kbit/s in stereo. Serve le cuffie, perche'
 * senza cancellazione dell'eco le casse rientrano nel microfono, ma e' l'unico
 * modo per far sentire uno strumento a qualcuno che non e' nella stanza.
 */
export type ModoAudio = 'voce' | 'musica'

export interface ProfiloAudio {
  bitrate: number
  stereo: boolean
  cancellazioneEco: boolean
  soppressioneRumore: boolean
  guadagnoAutomatico: boolean
  /** Smette di trasmettere nei silenzi. Fa risparmiare banda e taglia le code
   *  delle note: acceso per la voce, spento per la musica. */
  silenzioCompresso: boolean
}

export const PROFILI_AUDIO: Record<ModoAudio, ProfiloAudio> = {
  voce: {
    bitrate: 128_000,
    stereo: false,
    cancellazioneEco: true,
    soppressioneRumore: true,
    guadagnoAutomatico: true,
    silenzioCompresso: true
  },
  musica: {
    bitrate: 510_000,
    stereo: true,
    cancellazioneEco: false,
    soppressioneRumore: false,
    guadagnoAutomatico: false,
    silenzioCompresso: false
  }
}

/** I tetti che il server dichiara in GET /api/config. */
export interface Limiti {
  bitrateSchermo: number
  fpsSchermo: number
  altezzaSchermo: number
  bitrateCamera: number
  altezzaCamera: number
  bitrateVoce: number
  streamPerPersona: number
  personePerStanza: number
}

export const LIMITI_PRUDENTI: Limiti = {
  bitrateSchermo: 50_000_000,
  fpsSchermo: 60,
  altezzaSchermo: 2160,
  bitrateCamera: 12_000_000,
  altezzaCamera: 2160,
  bitrateVoce: 510_000,
  streamPerPersona: 4,
  personePerStanza: 0
}

/**
 * Il preset ridotto entro cio' che il server e' disposto a reggere.
 *
 * Chi trasmette sceglie, il server pone il tetto, e vince il piu' basso. Non
 * e' una restrizione arbitraria: e' la linea in salita del NAS, che va divisa
 * fra tutti quelli che stanno trasmettendo nello stesso momento.
 */
export function entroILimiti(preset: PresetSchermo, limiti: Limiti): PresetSchermo {
  return {
    ...preset,
    bitrate: Math.min(preset.bitrate, limiti.bitrateSchermo),
    fps: Math.min(preset.fps, limiti.fpsSchermo),
    // 0 vuol dire "nativa": resta 0 se anche il tetto e' generoso, altrimenti
    // diventa il tetto — che e' comunque meglio che non trasmettere.
    altezza: preset.altezza === 0
      ? (limiti.altezzaSchermo >= 2160 ? 0 : limiti.altezzaSchermo)
      : Math.min(preset.altezza, limiti.altezzaSchermo)
  }
}

export function entroILimitiCamera(preset: PresetCamera, limiti: Limiti): PresetCamera {
  return {
    ...preset,
    bitrate: Math.min(preset.bitrate, limiti.bitrateCamera),
    altezza: Math.min(preset.altezza, limiti.altezzaCamera)
  }
}

export function entroILimitiAudio(profilo: ProfiloAudio, limiti: Limiti): ProfiloAudio {
  return { ...profilo, bitrate: Math.min(profilo.bitrate, limiti.bitrateVoce) }
}

/** 12_500_000 -> "12,5 Mbit/s". Per l'interfaccia e per le statistiche. */
export function bitrateLeggibile(bit: number): string {
  if (bit >= 1_000_000) {
    const mega = bit / 1_000_000
    return `${mega >= 10 ? Math.round(mega) : mega.toFixed(1).replace('.', ',')} Mbit/s`
  }
  return `${Math.round(bit / 1000)} kbit/s`
}
