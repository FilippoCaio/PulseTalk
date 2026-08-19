import { useEffect, useState } from 'react'

/**
 * L'elenco di microfoni, camere e altoparlanti, con i nomi veri.
 *
 * Il giro strano in mezzo non e' superfluo: senza un permesso gia' concesso
 * Chromium restituisce l'elenco giusto ma con le etichette vuote, e le tendine
 * diventano "Dispositivo 1, Dispositivo 2, Dispositivo 3". Si chiede una
 * traccia qualunque, si rilegge l'elenco — che adesso ha i nomi — e la si
 * chiude subito.
 *
 * Sta qui e non dentro alle Impostazioni perche' lo usano in due: il pannello,
 * e il menu del microfono nella barra della chiamata.
 */
export function usaDispositivi(): {
  tutti: MediaDeviceInfo[]
  per: (tipo: MediaDeviceKind) => MediaDeviceInfo[]
} {
  const [dispositivi, setDispositivi] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    let vivo = true

    const carica = async (): Promise<void> => {
      let elenco = await navigator.mediaDevices.enumerateDevices()
      if (elenco.some((d) => d.kind !== 'videoinput' && !d.label)) {
        try {
          const prova = await navigator.mediaDevices.getUserMedia({ audio: true })
          for (const t of prova.getTracks()) t.stop()
          elenco = await navigator.mediaDevices.enumerateDevices()
        } catch {
          // Permesso negato: i nomi restano vuoti, ma le tendine funzionano
          // lo stesso e si sceglie per posizione.
        }
      }
      if (vivo) setDispositivi(elenco)
    }

    void carica()

    // Le cuffie USB si attaccano a chiamata iniziata, ed e' proprio il momento
    // in cui uno vuole sceglierle. Senza questo, comparirebbero solo riaprendo
    // l'applicazione.
    navigator.mediaDevices.addEventListener('devicechange', carica)
    return () => {
      vivo = false
      navigator.mediaDevices.removeEventListener('devicechange', carica)
    }
  }, [])

  return {
    tutti: dispositivi,
    per: (tipo) => dispositivi.filter((d) => d.kind === tipo)
  }
}
