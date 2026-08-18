import { useEffect } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * I cinque pezzi che tornano ovunque.
 *
 * Non e' una libreria di componenti: sono cinque funzioni che tengono in un
 * posto solo le classi che altrimenti verrebbero ricopiate a mano venti volte,
 * con una differenza di due pixel ogni cinque copie.
 */

type Tono = 'normale' | 'vivo' | 'male' | 'acceso' | 'fantasma'

const TONI: Record<Tono, string> = {
  normale: 'bg-fondo-3 hover:bg-bordo text-testo border border-bordo',
  vivo: 'bg-vivo hover:bg-vivo-2 text-fondo border border-transparent font-medium',
  male: 'bg-male/15 hover:bg-male/25 text-male border border-male/30',
  acceso: 'bg-ok/15 hover:bg-ok/25 text-ok border border-ok/30',
  fantasma: 'bg-transparent hover:bg-fondo-3 text-testo-2 hover:text-testo border border-transparent'
}

export function Bottone({
  tono = 'normale',
  className = '',
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { tono?: Tono }): React.JSX.Element {
  return (
    <button
      {...resto}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONI[tono]} ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * Il pulsante quadrato, quello con dentro solo un'icona.
 *
 * Stessi toni del `Bottone`, perche' stanno affiancati nella stessa barra e
 * due verdi diversi si vedrebbero. Il `title` non e' facoltativo: un'icona
 * senza nome si impara solo premendola, e in una chiamata premere per scoprire
 * cosa fa un pulsante e' esattamente cio' che non si vuole rischiare.
 */
export function BottoneIcona({
  tono = 'normale',
  title,
  className = '',
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { tono?: Tono; title: string }): React.JSX.Element {
  return (
    <button
      {...resto}
      title={title}
      aria-label={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONI[tono]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Campo({
  etichetta,
  aiuto,
  children
}: {
  etichetta: string
  aiuto?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-testo-2 uppercase">
        {etichetta}
      </span>
      {children}
      {aiuto && <span className="mt-1.5 block text-xs leading-relaxed text-testo-3">{aiuto}</span>}
    </label>
  )
}

export const classiInput =
  'w-full rounded-lg border border-bordo bg-fondo px-3 py-2 text-sm text-testo outline-none transition-colors placeholder:text-testo-3 focus:border-vivo'

export function Avviso({
  tono = 'male',
  children
}: {
  tono?: 'male' | 'attenzione' | 'neutro'
  children: ReactNode
}): React.JSX.Element {
  const colori =
    tono === 'male'
      ? 'border-male/40 bg-male/10 text-male'
      : tono === 'attenzione'
        ? 'border-attenzione/40 bg-attenzione/10 text-attenzione'
        : 'border-bordo bg-fondo-2 text-testo-2'
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${colori}`}>
      {children}
    </div>
  )
}

/**
 * "Sicuro?", fatto bene.
 *
 * Esiste per un caso solo, ed e' quello che l'ha richiesta: cliccare un canale
 * vocale mentre si e' gia' dentro a un altro. Prima si usciva e si entrava
 * senza dire niente — e chi aveva sbagliato riga si ritrovava fuori da una
 * conversazione, con gli altri che lo vedevano sparire.
 *
 * Esc annulla, ed e' la cosa che si preme d'istinto quando ci si accorge di
 * aver cliccato la riga sbagliata.
 */
export function Conferma({
  titolo,
  testo,
  azione,
  tono = 'vivo',
  conferma,
  chiudi
}: {
  titolo: string
  testo: ReactNode
  azione: string
  tono?: Tono
  conferma: () => void
  chiudi: () => void
}): React.JSX.Element {
  useEffect(() => {
    const tasto = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return
      evento.stopPropagation()
      chiudi()
    }
    document.addEventListener('keydown', tasto, true)
    return () => document.removeEventListener('keydown', tasto, true)
  }, [chiudi])

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-bordo bg-fondo-2 p-5"
        onClick={(evento) => evento.stopPropagation()}
      >
        <h2 className="font-semibold">{titolo}</h2>
        <p className="mt-2 text-sm leading-relaxed text-testo-2">{testo}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Bottone tono="fantasma" onClick={chiudi}>
            Annulla
          </Bottone>
          <Bottone tono={tono} onClick={conferma}>
            {azione}
          </Bottone>
        </div>
      </div>
    </div>
  )
}

/** Il pallino della qualita' di connessione, da verde a rosso. */
export function Pallino({ colore }: { colore: string }): React.JSX.Element {
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colore }} />
}
