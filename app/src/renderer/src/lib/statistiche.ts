import type { LocalTrack, RemoteTrack } from 'livekit-client'

/**
 * Cosa sta succedendo davvero.
 *
 * Un programma che promette di togliere i tetti deve far vedere il risultato,
 * altrimenti resta una promessa. Questi numeri non vengono dalle impostazioni:
 * vengono da `getStats()`, cioe' da quello che il codificatore sta facendo in
 * questo momento. Se hai chiesto 4K60 e ti arriva 1440p a 24, qui si vede — ed
 * e' l'unico modo per accorgersene senza indovinare.
 */

export interface Statistiche {
  larghezza: number | null
  altezza: number | null
  fps: number | null
  /** Bit al secondo, misurati sulla differenza fra due letture. */
  bitrate: number | null
  codec: string | null
  /** Percentuale di pacchetti persi, 0-100. */
  perdita: number | null
  /** Millisecondi. Sopra ai 30 la voce comincia a spezzarsi. */
  jitter: number | null
  /**
   * Vero quando il codificatore sta riducendo la qualita' da solo, e dice
   * perche'. E' la riga piu' utile di tutte: risponde a "perche' si vede male"
   * senza doverlo dedurre.
   */
  motivoRiduzione: 'cpu' | 'banda' | null
}

const VUOTE: Statistiche = {
  larghezza: null,
  altezza: null,
  fps: null,
  bitrate: null,
  codec: null,
  perdita: null,
  jitter: null,
  motivoRiduzione: null
}

interface Precedente {
  byte: number
  istante: number
  pacchetti: number
  persi: number
}

function nomeCodec(mime: string | undefined): string | null {
  if (!mime) return null
  // "video/VP9" -> "VP9"
  const nome = mime.split('/')[1]?.toUpperCase() ?? null
  return nome === 'H264' ? 'H.264' : nome
}

function leggi(rapporto: RTCStatsReport, precedente: Precedente | null): {
  statistiche: Statistiche
  ora: Precedente | null
} {
  let riga: any = null
  let entrante = false

  rapporto.forEach((stat: any) => {
    if (stat.type === 'outbound-rtp' && stat.kind === 'video' && !stat.rid) riga = stat
    else if (stat.type === 'outbound-rtp' && stat.kind === 'audio') riga ??= stat
    else if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.kind === 'audio')) {
      riga = stat
      entrante = true
    }
  })

  if (!riga) return { statistiche: VUOTE, ora: precedente }

  const byte = entrante ? (riga.bytesReceived ?? 0) : (riga.bytesSent ?? 0)
  const pacchetti = entrante ? (riga.packetsReceived ?? 0) : (riga.packetsSent ?? 0)
  const persi = riga.packetsLost ?? 0
  const istante = riga.timestamp ?? performance.now()

  let bitrate: number | null = null
  let perdita: number | null = null
  if (precedente && istante > precedente.istante) {
    const secondi = (istante - precedente.istante) / 1000
    bitrate = Math.max(0, Math.round(((byte - precedente.byte) * 8) / secondi))

    const nuoviPacchetti = pacchetti - precedente.pacchetti
    const nuoviPersi = persi - precedente.persi
    if (nuoviPacchetti + nuoviPersi > 0) {
      perdita = Math.max(0, (nuoviPersi / (nuoviPacchetti + nuoviPersi)) * 100)
    }
  }

  let codec: string | null = null
  if (riga.codecId) {
    rapporto.forEach((stat: any) => {
      if (stat.id === riga.codecId) codec = nomeCodec(stat.mimeType)
    })
  }

  // `qualityLimitationReason` esiste solo in uscita, ed e' il campo che
  // trasforma "si vede male" in "il processore non ce la fa" oppure "la linea
  // non ce la fa". Sono due problemi diversi con due rimedi diversi.
  const motivo = riga.qualityLimitationReason
  const motivoRiduzione =
    motivo === 'cpu' ? 'cpu' : motivo === 'bandwidth' ? 'banda' : null

  return {
    statistiche: {
      larghezza: riga.frameWidth ?? null,
      altezza: riga.frameHeight ?? null,
      fps: riga.framesPerSecond != null ? Math.round(riga.framesPerSecond) : null,
      bitrate,
      codec,
      perdita,
      jitter: riga.jitter != null ? Math.round(riga.jitter * 1000) : null,
      motivoRiduzione
    },
    ora: { byte, istante, pacchetti, persi }
  }
}

/**
 * Guarda una traccia e richiama con i numeri, una volta al secondo.
 *
 * Un secondo e non meno: `getStats()` non e' gratis, e sotto al secondo il
 * bitrate calcolato sulla differenza comincia a ballare da solo senza che stia
 * ballando niente.
 */
export function osserva(
  traccia: LocalTrack | RemoteTrack | undefined,
  quando: (statistiche: Statistiche) => void,
  ogniMs = 1000
): () => void {
  if (!traccia) return () => {}

  let precedente: Precedente | null = null
  let vivo = true

  const giro = async (): Promise<void> => {
    // `sender` sulle tracce locali, `receiver` su quelle remote: sono i due
    // capi dello stesso oggetto WebRTC, e nessuno dei due esiste finche' la
    // traccia non e' davvero pubblicata o sottoscritta.
    const fonte =
      (traccia as LocalTrack).sender ?? (traccia as RemoteTrack).receiver ?? null
    if (!fonte) return

    try {
      const rapporto = await fonte.getStats()
      if (!vivo) return
      const { statistiche, ora } = leggi(rapporto, precedente)
      precedente = ora
      quando(statistiche)
    } catch {
      // Una traccia chiusa fra una lettura e l'altra: non e' un problema,
      // il prossimo giro non la trovera' piu' e il ciclo verra' fermato.
    }
  }

  void giro()
  const orologio = setInterval(giro, ogniMs)

  return () => {
    vivo = false
    clearInterval(orologio)
  }
}
