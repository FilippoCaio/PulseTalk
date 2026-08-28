import { useEffect, useRef } from 'react'
import type { StatoUtente, Utente } from '@shared/tipi'
import { coloreDi, inizialiDi } from './lib/avatar'
import { Ingranaggio, Persona, Utenti } from './icone'

/**
 * Il colore del pallino di stato, e come si chiama a parole.
 *
 * Due di questi cinque non si scelgono e stanno qui solo per essere disegnati:
 * `offline` e' cio' che gli altri vedono al posto di `invisibile` o di chi ha
 * chiuso l'applicazione, e `inattivo` lo decide il microfono dopo dieci minuti
 * di silenzio (vedi lib/usaInattivita.ts). Sceglierlo a mano non aveva senso —
 * dire "non sono davanti allo schermo" premendo un pulsante e' una
 * contraddizione — ed era anche una bugia comoda: restava li' anche mentre si
 * parlava.
 */
export const STATI: Record<StatoUtente, { nome: string; sotto?: string; colore: string }> = {
  online: { nome: 'Online', colore: 'var(--color-ok)' },
  inattivo: {
    nome: 'Inattivo',
    sotto: 'Dieci minuti senza parlare. Lo mette l\'applicazione da sola.',
    colore: 'var(--color-attenzione)'
  },
  occupato: {
    nome: 'Non disturbare',
    sotto: 'Le notifiche restano zitte.',
    colore: 'var(--color-male)'
  },
  invisibile: {
    nome: 'Invisibile',
    sotto: 'Per tutti sei offline, ma vedi e senti tutto.',
    colore: 'var(--color-testo-3)'
  },
  offline: { nome: 'Offline', colore: 'var(--color-testo-3)' }
}

/** I tre che si possono scegliere. Gli altri due li mette l'applicazione. */
const SCEGLIBILI: StatoUtente[] = ['online', 'occupato', 'invisibile']

/**
 * Il pallino di stato, da mettere sopra a un'icona.
 *
 * Ha un bordo del colore dello sfondo e non un margine: sovrapposto a una foto
 * chiara, un pallino senza stacco si confonde con l'immagine sotto.
 */
export function PallinoStato({
  stato,
  className = 'h-3.5 w-3.5',
  fondo = 'var(--color-fondo-2)'
}: {
  stato: StatoUtente
  className?: string
  fondo?: string
}): React.JSX.Element {
  return (
    <span
      title={STATI[stato].nome}
      className={`absolute right-0 bottom-0 rounded-full ${className}`}
      style={{ background: STATI[stato].colore, boxShadow: `0 0 0 2.5px ${fondo}` }}
    />
  )
}

/**
 * Il pannello che si apre dall'icona in basso a sinistra.
 *
 * Prima quel pulsante portava dritto alle impostazioni, che e' un salto
 * sproporzionato: nove volte su dieci lo si preme per cambiare stato o per
 * guardarsi il nome, non per aprire un pannello a tutta pagina. Le
 * impostazioni restano, in fondo, come una voce fra le altre.
 */
export default function PopupProfilo({
  utente,
  cambiaStato,
  apriAmici,
  apriImpostazioni,
  apriProfilo,
  chiudi
}: {
  utente: Utente
  cambiaStato: (stato: StatoUtente) => void
  apriAmici: () => void
  apriImpostazioni: () => void
  apriProfilo: () => void
  chiudi: () => void
}): React.JSX.Element {
  const scatola = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') chiudi()
    }
    const fuori = (e: MouseEvent): void => {
      if (!scatola.current?.contains(e.target as Node)) chiudi()
    }
    window.addEventListener('keydown', tasto)
    // In cattura: senza, il clic sul pulsante che ha aperto il pannello
    // arriverebbe prima qui e lo richiuderebbe subito dopo averlo aperto.
    window.addEventListener('mousedown', fuori, true)
    return () => {
      window.removeEventListener('keydown', tasto)
      window.removeEventListener('mousedown', fuori, true)
    }
  }, [chiudi])

  const stato = utente.stato ?? 'online'

  return (
    <div
      ref={scatola}
      className="menu-comparsa absolute right-3 bottom-3 left-3 z-50 rounded-xl border border-bordo bg-fondo-2 p-3 shadow-xl shadow-black/50 sm:right-auto sm:left-[4.5rem] sm:w-64"
    >
      <div className="flex items-center gap-3 pb-3">
        <span className="relative shrink-0">
          {utente.avatar ? (
            <img src={utente.avatar} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold text-black/75"
              style={{ background: coloreDi(`u${utente.id}`) }}
            >
              {inizialiDi(utente.nome)}
            </span>
          )}
          <PallinoStato stato={stato} />
        </span>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-testo">{utente.nome}</p>
          {utente.utente && <p className="truncate text-xs text-testo-3">{utente.utente}</p>}
        </div>
      </div>

      <div className="border-t border-bordo pt-2">
        {SCEGLIBILI.map((quale) => (
          <button
            key={quale}
            onClick={() => {
              cambiaStato(quale)
              chiudi()
            }}
            className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
              quale === stato ? 'bg-fondo-3' : 'hover:bg-fondo-3/60'
            }`}
          >
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: STATI[quale].colore }}
            />
            <span className="min-w-0">
              <span className="block text-sm text-testo">{STATI[quale].nome}</span>
              {STATI[quale].sotto && (
                <span className="block text-[11px] text-testo-3">{STATI[quale].sotto}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2 border-t border-bordo pt-2">
        <Voce icona={<Utenti />} testo="Amici" fai={apriAmici} chiudi={chiudi} />
        <Voce icona={<Persona />} testo="Il tuo profilo" fai={apriProfilo} chiudi={chiudi} />
        <Voce icona={<Ingranaggio />} testo="Impostazioni" fai={apriImpostazioni} chiudi={chiudi} />
      </div>
    </div>
  )
}

function Voce({
  icona,
  testo,
  fai,
  chiudi
}: {
  icona: React.ReactNode
  testo: string
  fai: () => void
  chiudi: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => {
        fai()
        chiudi()
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
    >
      <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icona}</span>
      {testo}
    </button>
  )
}
