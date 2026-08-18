import { useCallback, useRef, useState } from 'react'

/**
 * Quanto e' grande, adesso, un pezzo di pagina.
 *
 * Serve a una cosa sola, ed e' la griglia della sala: per tenere tutti i
 * riquadri nella stessa proporzione bisogna calcolarne la misura in pixel, e
 * per calcolarla bisogna sapere quanto spazio c'e'. Il CSS da solo non ci
 * arriva — sa dividere lo spazio, non sa scegliere quante colonne fare perche'
 * i riquadri restino 16:9 e siano i piu' grandi possibile.
 *
 * Torna un `ref` che e' una funzione e non un oggetto, e la differenza conta:
 * il contenitore della griglia viene smontato ogni volta che si mette qualcuno
 * a fuoco e rimontato quando lo si toglie. Con un `useRef` piu' un `useEffect`
 * vuoto, l'osservatore resterebbe attaccato al primo elemento e continuerebbe a
 * misurare un nodo che non e' piu' nella pagina — e alla prima griglia, che
 * arriva dopo il primo disegno, non si attaccherebbe affatto: riquadri larghi
 * zero, cioe' invisibili.
 */
export interface Misura {
  larghezza: number
  altezza: number
}

export function usaMisura<T extends HTMLElement>(): [(elemento: T | null) => void, Misura] {
  const [misura, setMisura] = useState<Misura>({ larghezza: 0, altezza: 0 })
  const osservatore = useRef<ResizeObserver | null>(null)

  const aggancia = useCallback((elemento: T | null) => {
    osservatore.current?.disconnect()
    osservatore.current = null
    if (!elemento) return

    const aggiorna = (): void => {
      const larghezza = elemento.clientWidth
      const altezza = elemento.clientHeight
      setMisura((prima) =>
        // Senza questo confronto ogni misura uguale alla precedente farebbe
        // comunque un ridisegno, e il ResizeObserver ne manda parecchie.
        prima.larghezza === larghezza && prima.altezza === altezza
          ? prima
          : { larghezza, altezza }
      )
    }

    // Subito, mentre React sta ancora sistemando la pagina: la prima misura
    // arriva cosi' prima che il browser disegni, e non si vede il fotogramma
    // con i riquadri a zero.
    aggiorna()

    const nuovo = new ResizeObserver(aggiorna)
    nuovo.observe(elemento)
    osservatore.current = nuovo
  }, [])

  return [aggancia, misura]
}
