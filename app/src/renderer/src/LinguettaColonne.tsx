import type { CSSProperties } from 'react'
import { Chevron } from './icone'

/**
 * La linguetta che chiude e riapre la sezione di sinistra.
 *
 * Lo stesso pulsante in due posti: attaccato al bordo delle colonne mentre si
 * legge o si scrive, e dentro all'overlay quando si e' in chiamata — li' va e
 * viene col cursore insieme a tutti gli altri comandi, invece di restare
 * acceso sul bordo di un video per tutta la sera.
 *
 * Sta in un file suo perche' quello che deve restare uguale non e' l'aspetto
 * ma cio' che dice: il verso del chevron, il titolo e `aria-expanded`
 * raccontano la stessa cosa tre volte, e tenerli allineati a mano in due file
 * diversi e' il modo in cui si finisce con una freccia che indica da una parte
 * e una scritta che dice l'altra.
 *
 * Dove sta e' invece affare di chi la disegna: posizione e trasparenza
 * arrivano da fuori in `className`, e sono l'unica differenza fra le due.
 *
 * Solo da 768 pixel in su, in tutti e due i posti e per lo stesso motivo:
 * sotto, quelle colonne non sono colonne ma il cassetto della navigazione, e
 * chiuderlo vorrebbe dire lasciare il telefono senza un modo di cambiare
 * canale.
 */
export function LinguettaColonne({
  ritirate,
  alterna,
  className = '',
  style
}: {
  ritirate: boolean
  alterna: () => void
  className?: string
  style?: CSSProperties
}): React.JSX.Element {
  const cosaFa = ritirate ? 'Mostra server e canali' : 'Nascondi server e canali'

  return (
    <button
      type="button"
      onClick={alterna}
      title={cosaFa}
      aria-label={cosaFa}
      aria-expanded={!ritirate}
      className={`hidden h-16 w-5 items-center justify-center rounded-r-lg border border-l-0 border-bordo bg-fondo-2/90 text-testo-3 opacity-70 backdrop-blur hover:bg-fondo-3 hover:text-testo hover:opacity-100 md:flex ${className}`}
      style={style}
    >
      <Chevron className={`h-4 w-4 ${ritirate ? '-rotate-90' : 'rotate-90'}`} />
    </button>
  )
}
