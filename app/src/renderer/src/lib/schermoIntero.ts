import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Il vero schermo intero, quello del sistema.
 *
 * E' l'API del browser e funziona uguale nelle due case: dentro Electron
 * Chromium porta con se' anche la finestra, quindi non serve nessun canale
 * verso il processo principale. Da qui esce anche l'unica cosa che conta
 * davvero: `attivo` viene da `fullscreenchange` e non da un nostro contatore,
 * cosi' quando l'utente preme Esc — che e' come si esce sempre — il pulsante
 * si aggiorna insieme allo schermo invece di restare acceso a mentire.
 */
export function usaSchermoIntero(riferimento: RefObject<HTMLElement | null>): {
  attivo: boolean
  alterna: () => void
} {
  const [attivo, setAttivo] = useState(false)

  useEffect(() => {
    const cambiato = (): void => setAttivo(document.fullscreenElement === riferimento.current)
    document.addEventListener('fullscreenchange', cambiato)
    return () => document.removeEventListener('fullscreenchange', cambiato)
  }, [riferimento])

  const alterna = useCallback(() => {
    const elemento = riferimento.current
    if (!elemento) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    // `navigationUI: 'hide'` non lo onora nessuno su desktop, ma non costa
    // niente e su qualche piattaforma toglie una barra.
    void elemento.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }, [riferimento])

  return { attivo, alterna }
}
