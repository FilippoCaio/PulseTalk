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

/**
 * Far vedere il tragitto, quando qualcosa cambia posto.
 *
 * Mettere un riquadro in sovraimpressione non e' un cambio di stile: e' un
 * cambio di ramo dell'albero — la griglia, la striscia e il posto grande sono
 * tre posti diversi — e React lo fa smontando di qua e rimontando di la'. Un
 * elemento appena nato non ha niente da cui muoversi, quindi il riquadro
 * spariva da una parte e ricompariva dall'altra nello stesso fotogramma. E non
 * ne salta uno solo: mettendone a fuoco uno, tutti gli altri passano insieme
 * dalla griglia alla striscia, e la stanza sembra ricostruita da zero invece
 * che riordinata.
 *
 * La tecnica si chiama FLIP e sta tutta in una riga: si segnano le posizioni
 * di prima, si lascia che il browser impagini quelle di dopo, e poi si mette
 * addosso all'elemento — che ormai sta al posto giusto — la trasformazione che
 * lo riporterebbe dov'era, togliendola subito. Quello che si vede e' il
 * tragitto, ma nessuno l'ha mai calcolato.
 *
 * Si anima anche la scala e non solo lo spostamento, perche' un riquadro che
 * va grande cambia misura. Non deforma niente: le tessere sono tutte 16:9,
 * quindi le due scale sono lo stesso numero e ne basta uno.
 *
 * Gli elementi si trovano da soli, per `data-riquadro`. Una ref per ciascuno
 * vorrebbe dire tenere un elenco che cambia a ogni persona che entra o esce,
 * per sapere una cosa che l'attributo dice gia'.
 */
export function usaSpostamento(
  radice: React.RefObject<HTMLElement | null>,
  segno: string
): void {
  const posizioni = useRef<Map<string, DOMRect>>(new Map())
  const segnoPrima = useRef(segno)

  // Senza elenco di dipendenze, di proposito: le posizioni vanno risegnate a
  // ogni disegno, perche' non si sa in anticipo quale sara' l'ultimo prima
  // dello spostamento. E' una lettura di rettangoli per riquadro, dopo che il
  // browser ha gia' impaginato: costa poco e non fa ridisegnare niente.
  useLayoutEffect(() => {
    const elemento = radice.current
    if (!elemento) return

    const cambiato = segnoPrima.current !== segno
    segnoPrima.current = segno

    const anima =
      cambiato &&
      typeof Element.prototype.animate === 'function' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const adesso = new Map<string, DOMRect>()
    for (const nodo of Array.from(
      elemento.querySelectorAll<HTMLElement>('[data-riquadro]')
    )) {
      const id = nodo.dataset.riquadro
      if (!id) continue
      const dopo = nodo.getBoundingClientRect()
      adesso.set(id, dopo)
      if (!anima || dopo.width === 0) continue

      const prima = posizioni.current.get(id)
      if (!prima || prima.width === 0) continue

      const dx = prima.left - dopo.left
      const dy = prima.top - dopo.top
      const scala = prima.width / dopo.width
      // Sotto ai due pixel non si vede, e un'animazione che non si vede e' solo
      // lavoro in piu' per la scheda video.
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(scala - 1) < 0.02) continue

      nodo.animate(
        [
          {
            transformOrigin: 'top left',
            transform: `translate(${dx}px, ${dy}px) scale(${scala})`
          },
          { transformOrigin: 'top left', transform: 'none' }
        ],
        // La stessa durata e la stessa curva delle colonne che si ritirano:
        // sono movimenti della stessa stanza, e due tempi diversi si vedono.
        { duration: 300, easing: 'cubic-bezier(0.28, 0.75, 0, 1)', fill: 'none' }
      )
    }

    posizioni.current = adesso
  })
}
