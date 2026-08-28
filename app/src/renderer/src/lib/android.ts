import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'

interface FotogrammaSchermo {
  sessione: string
  dati: string
  larghezza: number
  altezza: number
}

interface EventoSessioneSchermo {
  sessione: string
}

interface ServizioChiamata {
  preparaAudio(): Promise<void>
  avvia(opzioni: { canale: string }): Promise<void>
  ferma(): Promise<void>
  avviaCondivisione(opzioni: {
    latoMassimo: number
    fps: number
  }): Promise<{ sessione: string }>
  fermaCondivisione(opzioni: { sessione: string }): Promise<void>
  addListener(
    evento: 'fotogrammaSchermo',
    ascolta: (fotogramma: FotogrammaSchermo) => void
  ): Promise<PluginListenerHandle>
  addListener(
    evento: 'condivisioneTerminata',
    ascolta: (evento: EventoSessioneSchermo) => void
  ): Promise<PluginListenerHandle>
}

const servizio = registerPlugin<ServizioChiamata>('PulseTalkCall')

export const suAndroid = Capacitor.getPlatform() === 'android'

/** Abilita le cuffie Bluetooth sui telefoni Android 12 e successivi. */
export async function preparaAudioAndroid(): Promise<void> {
  if (!suAndroid) return
  await servizio.preparaAudio().catch(() => {})
}

/**
 * Tiene viva una chiamata quando PulseTalk passa dietro a un'altra app.
 * Nel browser e in Electron e' intenzionalmente un no-op.
 */
export async function avviaServizioChiamata(canale: string): Promise<void> {
  if (!suAndroid) return
  await servizio.avvia({ canale }).catch(() => {})
}

export async function fermaServizioChiamata(): Promise<void> {
  if (!suAndroid) return
  await servizio.ferma().catch(() => {})
}

/**
 * Trasforma MediaProjection in una MediaStream utilizzabile da livekit-client.
 * Android produce JPEG ridimensionati; un canvas della WebView li rende una
 * traccia WebRTC. Si conserva solo il fotogramma piu' recente, cosi' un telefono
 * lento perde fluidita' ma non accumula secondi di ritardo.
 */
export async function catturaSchermoAndroid(
  latoMassimo: number,
  fps: number,
  indizio: string
): Promise<MediaStream> {
  if (!suAndroid) throw new Error('La cattura Android e\' stata chiamata fuori da Android.')

  const canvas = document.createElement('canvas')
  const contesto = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (!contesto || typeof canvas.captureStream !== 'function') {
    throw new Error('Questa WebView non puo\' trasformare la cattura in una traccia video.')
  }

  let sessione: string | null = null
  let ultimo: FotogrammaSchermo | null = null
  let disegnando = false
  let chiusa = false
  let traccia: MediaStreamTrack | null = null
  let stopOriginale: (() => void) | null = null
  let primoRisolvi: (() => void) | null = null
  let primoRifiuta: ((errore: Error) => void) | null = null
  let timeoutPrimo: number | null = null

  const primoFotogramma = new Promise<void>((risolvi, rifiuta) => {
    primoRisolvi = risolvi
    primoRifiuta = rifiuta
  })

  const disegnaProssimo = (): void => {
    if (disegnando || chiusa || !ultimo) return
    disegnando = true
    const fotogramma = ultimo
    ultimo = null
    const immagine = new Image()
    immagine.decoding = 'async'
    immagine.onload = () => {
      if (!chiusa) {
        if (canvas.width !== fotogramma.larghezza || canvas.height !== fotogramma.altezza) {
          canvas.width = fotogramma.larghezza
          canvas.height = fotogramma.altezza
        }
        contesto.drawImage(immagine, 0, 0, canvas.width, canvas.height)
        primoRisolvi?.()
        primoRisolvi = null
        primoRifiuta = null
      }
      disegnando = false
      disegnaProssimo()
    }
    immagine.onerror = () => {
      disegnando = false
      disegnaProssimo()
    }
    immagine.src = `data:image/jpeg;base64,${fotogramma.dati}`
  }

  const fotogrammi = await servizio.addListener('fotogrammaSchermo', (fotogramma) => {
    if (!sessione || fotogramma.sessione !== sessione || chiusa) return
    ultimo = fotogramma
    disegnaProssimo()
  })
  const terminata = await servizio.addListener('condivisioneTerminata', (evento) => {
    if (!sessione || evento.sessione !== sessione || chiusa) return
    chiudi(true)
  })

  const rimuoviAscoltatori = (): void => {
    void fotogrammi.remove()
    void terminata.remove()
  }
  const chiudi = (dalSistema: boolean): void => {
    if (chiusa) return
    chiusa = true
    ultimo = null
    if (timeoutPrimo !== null) window.clearTimeout(timeoutPrimo)
    rimuoviAscoltatori()
    if (traccia && stopOriginale) {
      stopOriginale()
      if (dalSistema) traccia.dispatchEvent(new Event('ended'))
    } else {
      primoRifiuta?.(new DOMException('Condivisione interrotta.', 'NotAllowedError'))
    }
    if (!dalSistema && sessione) {
      void servizio.fermaCondivisione({ sessione }).catch(() => {})
    }
  }

  try {
    const avviata = await servizio.avviaCondivisione({
      latoMassimo: Math.max(360, Math.min(1600, latoMassimo)),
      fps: Math.max(2, Math.min(12, fps))
    })
    sessione = avviata.sessione
    timeoutPrimo = window.setTimeout(() => {
      primoRifiuta?.(new Error('Android non ha consegnato il primo fotogramma dello schermo.'))
      primoRisolvi = null
      primoRifiuta = null
    }, 15_000)
    await primoFotogramma
    if (timeoutPrimo !== null) window.clearTimeout(timeoutPrimo)

    const stream = canvas.captureStream(Math.max(2, Math.min(12, fps)))
    traccia = stream.getVideoTracks()[0] ?? null
    if (!traccia) throw new Error('Il canvas non ha prodotto una traccia video.')
    traccia.contentHint = indizio
    stopOriginale = traccia.stop.bind(traccia)
    traccia.stop = () => chiudi(false)
    return stream
  } catch (errore) {
    chiudi(false)
    const codice = (errore as { code?: string }).code
    if (codice === 'CANCELLED') {
      throw new DOMException('Condivisione annullata.', 'NotAllowedError')
    }
    throw errore
  }
}

/** Il tasto Indietro chiude prima la pagina corrente, poi l'app. */
export function ascoltaIndietroAndroid(indietro: () => boolean): () => void {
  if (!suAndroid) return () => {}

  let rimuovi: (() => void) | null = null
  void CapacitorApp.addListener('backButton', () => {
    if (!indietro()) void CapacitorApp.exitApp()
  }).then((maniglia) => {
    rimuovi = () => void maniglia.remove()
  })

  return () => rimuovi?.()
}
