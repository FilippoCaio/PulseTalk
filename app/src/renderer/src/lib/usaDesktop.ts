import { useEffect, useState } from 'react'

/**
 * La soglia di `md:` in Tailwind, la stessa a cui l'interfaccia cambia forma.
 *
 * Scritta qui e non in un `.includes('md')` qualunque: sotto ai 768 pixel le
 * due colonne di sinistra non sono due colonne, sono un cassetto a tutta
 * pagina, e le regole che valgono per le une non valgono per l'altro.
 */
const DESKTOP = '(min-width: 768px)'

/**
 * Vero quando la finestra e' larga come un desktop.
 *
 * Serve a una cosa sola, e a quella basta: la sezione di sinistra chiusa a
 * mano e' una scelta che ha senso su una finestra larga e nessuno sul
 * telefono, dove quelle stesse colonne sono la navigazione. Senza guardarla da
 * JavaScript la si sarebbe potuta esprimere solo in CSS — e una finestra
 * stretta si sarebbe ritrovata il cassetto chiuso, inerte, con la linguetta
 * per riaprirlo nascosta proprio dal breakpoint che l'aveva chiuso.
 *
 * Il valore di partenza si legge subito e non al primo effetto: al primo
 * disegno le colonne devono gia' essere come vanno lasciate, altrimenti si
 * vedono aprirsi e richiudersi appena aperta l'applicazione.
 */
export function usaDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(DESKTOP).matches ?? true)

  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP)
    if (!query) return
    const guarda = (): void => setDesktop(query.matches)
    guarda()
    query.addEventListener('change', guarda)
    return () => query.removeEventListener('change', guarda)
  }, [])

  return desktop
}
