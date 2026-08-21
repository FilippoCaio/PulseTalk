import type { LocalTrack, RemoteTrack } from 'livekit-client'

/**
 * Numeri che servono a distinguere una voce distorta per rete da una voce
 * distorta prima ancora di essere spedita.
 *
 * Sono tutti ricavati da `getStats()`: nessun campione audio viene letto o
 * conservato qui. Le percentuali sono calcolate sull'ultimo intervallo, non
 * dall'inizio della chiamata, altrimenti un guasto di due secondi sparirebbe
 * dentro alla media di mezz'ora.
 */
export interface DiagnosticaAudio {
  direzione: 'ricezione' | 'invio'
  codec: string | null
  clockCodec: number | null
  canaliCodec: number | null
  frequenzaTraccia: number | null
  canaliTraccia: number | null
  jitterMs: number | null
  bufferJitterMs: number | null
  perditaPercento: number | null
  concealmentPercento: number | null
  correzioneClockPercento: number | null
  eventiConcealment: number | null
  roundTripMs: number | null
}

interface ContatoriAudio {
  istante: number
  pacchetti: number
  persi: number
  campioni: number
  nascosti: number
  eventiNascosti: number
  inseriti: number
  rimossi: number
  ritardoBuffer: number
  emessiBuffer: number
}

function numero(valore: unknown, ripiego = 0): number {
  return typeof valore === 'number' && Number.isFinite(valore) ? valore : ripiego
}

/** Torna null quando il contatore si e' azzerato (per esempio dopo un reconnect). */
function differenza(adesso: number, prima: number): number | null {
  return adesso >= prima ? adesso - prima : null
}

function percentuale(parte: number | null, totale: number | null): number | null {
  if (parte == null || totale == null || totale <= 0) return null
  return Math.max(0, (parte / totale) * 100)
}

function nomeCodec(mime: unknown): string | null {
  if (typeof mime !== 'string') return null
  return mime.split('/')[1]?.toUpperCase() ?? mime.toUpperCase()
}

/**
 * Estrae un campione da un rapporto WebRTC. E' esportata per poterla provare
 * con rapporti registrati senza dover aprire davvero microfono e rete.
 */
export function estraiDiagnosticaAudio(
  rapporto: RTCStatsReport,
  direzione: DiagnosticaAudio['direzione'],
  impostazioniTraccia: MediaTrackSettings,
  precedente: ContatoriAudio | null
): { misura: DiagnosticaAudio | null; contatori: ContatoriAudio | null } {
  let rtp: any = null

  rapporto.forEach((stat: any) => {
    const tipo = direzione === 'ricezione' ? 'inbound-rtp' : 'outbound-rtp'
    if (stat.type === tipo && stat.kind === 'audio' && !stat.isRemote) rtp ??= stat
  })

  if (!rtp) return { misura: null, contatori: precedente }

  // Per chi invia, jitter/perdita/RTT sono riportati dal destinatario in una
  // riga `remote-inbound-rtp`. Non tutti i browser espongono ogni campo.
  let ritorno: any = null
  if (direzione === 'invio') {
    if (rtp.remoteId) ritorno = rapporto.get(rtp.remoteId)
    if (!ritorno) {
      rapporto.forEach((stat: any) => {
        if (stat.type === 'remote-inbound-rtp' && stat.kind === 'audio') {
          if (stat.localId === rtp.id || stat.ssrc === rtp.ssrc) ritorno ??= stat
        }
      })
    }
  }

  const rete = direzione === 'ricezione' ? rtp : ritorno
  const codec = rtp.codecId ? rapporto.get(rtp.codecId) : null
  const contatori: ContatoriAudio = {
    istante: numero(rtp.timestamp, performance.now()),
    pacchetti: numero(
      direzione === 'ricezione' ? rtp.packetsReceived : rtp.packetsSent
    ),
    persi: numero(rete?.packetsLost),
    campioni: numero(rtp.totalSamplesReceived ?? rtp.totalSamplesSent),
    nascosti: numero(rtp.concealedSamples),
    eventiNascosti: numero(rtp.concealmentEvents),
    inseriti: numero(rtp.insertedSamplesForDeceleration),
    rimossi: numero(rtp.removedSamplesForAcceleration),
    ritardoBuffer: numero(rtp.jitterBufferDelay),
    emessiBuffer: numero(rtp.jitterBufferEmittedCount)
  }

  let perditaPercento: number | null = null
  let concealmentPercento: number | null = null
  let correzioneClockPercento: number | null = null
  let bufferJitterMs: number | null = null
  let eventiConcealment: number | null = null

  if (precedente && contatori.istante > precedente.istante) {
    const pacchetti = differenza(contatori.pacchetti, precedente.pacchetti)
    const persi = differenza(contatori.persi, precedente.persi)
    perditaPercento = percentuale(persi, pacchetti == null || persi == null ? null : pacchetti + persi)

    const campioni = differenza(contatori.campioni, precedente.campioni)
    const nascosti = differenza(contatori.nascosti, precedente.nascosti)
    concealmentPercento = percentuale(nascosti, campioni)

    const inseriti = differenza(contatori.inseriti, precedente.inseriti)
    const rimossi = differenza(contatori.rimossi, precedente.rimossi)
    correzioneClockPercento = percentuale(
      inseriti == null || rimossi == null ? null : inseriti + rimossi,
      campioni
    )

    eventiConcealment = differenza(contatori.eventiNascosti, precedente.eventiNascosti)

    const ritardo = differenza(contatori.ritardoBuffer, precedente.ritardoBuffer)
    const emessi = differenza(contatori.emessiBuffer, precedente.emessiBuffer)
    if (ritardo != null && emessi != null && emessi > 0) bufferJitterMs = (ritardo / emessi) * 1000
  }

  return {
    misura: {
      direzione,
      codec: nomeCodec(codec?.mimeType),
      clockCodec: typeof codec?.clockRate === 'number' ? codec.clockRate : null,
      canaliCodec: typeof codec?.channels === 'number' ? codec.channels : null,
      frequenzaTraccia:
        typeof impostazioniTraccia.sampleRate === 'number' ? impostazioniTraccia.sampleRate : null,
      canaliTraccia:
        typeof impostazioniTraccia.channelCount === 'number' ? impostazioniTraccia.channelCount : null,
      jitterMs: typeof rete?.jitter === 'number' ? rete.jitter * 1000 : null,
      bufferJitterMs,
      perditaPercento,
      concealmentPercento,
      correzioneClockPercento,
      eventiConcealment,
      roundTripMs: typeof rete?.roundTripTime === 'number' ? rete.roundTripTime * 1000 : null
    },
    contatori
  }
}

function cifra(valore: number | null, decimali = 1): string {
  return valore == null ? '-' : valore.toFixed(decimali)
}

function descrivi(misura: DiagnosticaAudio): string {
  const codec = misura.codec
    ? `${misura.codec}/${misura.clockCodec ?? '?'}Hz/${misura.canaliCodec ?? '?'}ch`
    : 'sconosciuto'
  const traccia = `${misura.frequenzaTraccia ?? '?'}Hz/${misura.canaliTraccia ?? '?'}ch`
  return (
    `direzione=${misura.direzione} codec=${codec} traccia=${traccia} ` +
    `jitter=${cifra(misura.jitterMs)}ms buffer=${cifra(misura.bufferJitterMs)}ms ` +
    `loss=${cifra(misura.perditaPercento, 2)}% concealment=${cifra(misura.concealmentPercento, 2)}% ` +
    `clockCorrection=${cifra(misura.correzioneClockPercento, 2)}% rtt=${cifra(misura.roundTripMs)}ms`
  )
}

function problemi(misura: DiagnosticaAudio): string[] {
  const fuori: string[] = []
  if ((misura.perditaPercento ?? 0) >= 1) fuori.push('perdita-pacchetti')
  if ((misura.jitterMs ?? 0) >= 30) fuori.push('jitter-alto')
  if ((misura.bufferJitterMs ?? 0) >= 120) fuori.push('buffer-jitter-alto')
  if ((misura.concealmentPercento ?? 0) >= 0.5 || (misura.eventiConcealment ?? 0) >= 2) {
    fuori.push('campioni-ricostruiti')
  }
  if ((misura.correzioneClockPercento ?? 0) >= 1) fuori.push('correzione-clock')
  if ((misura.roundTripMs ?? 0) >= 350) fuori.push('latenza-alta')
  return fuori
}

/**
 * Osserva una traccia una volta ogni due secondi. Scrive una riga iniziale,
 * poi soltanto anomalie e ritorni alla normalita': il log resta utile anche
 * dopo una chiamata lunga e non diventa telemetria rumorosa.
 */
export function osservaDiagnosticaAudio(
  traccia: LocalTrack | RemoteTrack,
  fonte: string,
  registra: (testo: string) => void,
  ogniMs = 2000
): () => void {
  const direzione: DiagnosticaAudio['direzione'] = traccia.isLocal ? 'invio' : 'ricezione'
  let precedente: ContatoriAudio | null = null
  let viva = true
  let inizialeScritta = false
  let inAllarme = false
  let ultimaFirma = ''
  let ultimoAvviso = 0

  const giro = async (): Promise<void> => {
    const capo = (traccia as LocalTrack).sender ?? (traccia as RemoteTrack).receiver
    if (!capo) return

    try {
      const rapporto = await capo.getStats()
      if (!viva) return
      const estratta = estraiDiagnosticaAudio(
        rapporto,
        direzione,
        traccia.mediaStreamTrack.getSettings(),
        precedente
      )
      precedente = estratta.contatori
      if (!estratta.misura) return

      const misura = estratta.misura
      if (!inizialeScritta) {
        registra(`audio avviato fonte=${fonte} ${descrivi(misura)}`)
        inizialeScritta = true
      }

      const guasti = problemi(misura)
      if (guasti.length > 0) {
        const firma = guasti.join(',')
        const adesso = performance.now()
        // La stessa condizione al massimo ogni quindici secondi. Un cambio di
        // causa invece va scritto subito, perche' e' proprio cio' che serve a
        // capire se il rumore segue la rete o il clock audio.
        if (firma !== ultimaFirma || adesso - ultimoAvviso >= 15_000) {
          registra(`audio anomalo fonte=${fonte} causa=${firma} ${descrivi(misura)}`)
          ultimaFirma = firma
          ultimoAvviso = adesso
        }
        inAllarme = true
      } else if (inAllarme) {
        registra(`audio stabilizzato fonte=${fonte} ${descrivi(misura)}`)
        inAllarme = false
        ultimaFirma = ''
      }
    } catch {
      // Una traccia puo' finire fra la lettura del sender e `getStats()`. Il
      // gestore dell'unsubscribe fermera' il ciclo; non e' un guasto audio.
    }
  }

  void giro()
  const orologio = window.setInterval(giro, ogniMs)
  return () => {
    viva = false
    window.clearInterval(orologio)
  }
}
