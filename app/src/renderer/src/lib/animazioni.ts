import { useLayoutEffect, useRef } from 'react'

/**
 * Far comparire qualcosa che non e' appena nato.
 *
 * Le animazioni CSS di `index.css` bastano per tutto cio' che si monta e si
 * smonta: un pannello, un riquadro, una riga di elenco. Non bastano per il
 * caso piu' frequente di tutti — cambiare canale, o passare dai server ai
 * messaggi diretti — perche' li' il contenitore resta lo stesso e React
 * sostituisce solo cio' che ha dentro. Una classe CSS su un elemento che c'era
 * gia' non riparte, e la strada ovvia per farla ripartire (una `key` che
 * cambia) rimonterebbe tutto il sottoalbero: la chat riscaricherebbe la sua
 * pagina di messaggi, il video si riattaccherebbe, e per un'animazione si
 * pagherebbe un giro di rete.
 *
 * `Element.animate()` non ha questo problema: e' un'animazione che si lancia,
 * non uno stato in cui si entra. L'elemento resta quello, i figli restano
 * montati, e la si puo' rilanciare quante volte si vuole.
 *
 * `segno` e' cio' che, cambiando, vale una nuova comparsa. Di solito e' una
 * stringa messa insieme con quello che si sta guardando.
 */
export function usaComparsa<T extends HTMLElement>(
  segno: unknown,
  modo: 'vista' | 'colonna' | 'salita' = 'vista'
): React.RefObject<T | null> {
  const riferimento = useRef<T | null>(null)
  // Il primo giro non si anima: quando l'applicazione si apre, tutto e' nuovo
  // e animare ogni cosa insieme fa sembrare l'avvio piu' lento di quello che
  // e'. Si comincia dal secondo cambio, che e' il primo vero cambio.
  const primoGiro = useRef(true)

  useLayoutEffect(() => {
    const elemento = riferimento.current
    if (!elemento) return
    if (primoGiro.current) {
      primoGiro.current = false
      return
    }
    if (typeof elemento.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const fotogrammi: Keyframe[] =
      modo === 'colonna'
        ? [
            { opacity: 0, transform: 'translate3d(-8px, 0, 0)' },
            { opacity: 1, transform: 'none' }
          ]
        : modo === 'salita'
          ? [
              { opacity: 0, transform: 'translate3d(0, 10px, 0)' },
              { opacity: 1, transform: 'none' }
            ]
          : [
              // La vista principale: un soffio di scala e un dito di salita.
              // Piu' movimento di cosi', su un'area grande quanto la finestra,
              // si legge come uno scatto invece che come un cambio.
              { opacity: 0, transform: 'translate3d(0, 6px, 0) scale(0.994)' },
              { opacity: 1, transform: 'none' }
            ]

    const corsa = elemento.animate(fotogrammi, {
      duration: modo === 'vista' ? 220 : 180,
      easing: 'cubic-bezier(0.22, 1.24, 0.36, 1)',
      fill: 'none'
    })

    return () => corsa.cancel()
  }, [segno, modo])

  return riferimento
}
