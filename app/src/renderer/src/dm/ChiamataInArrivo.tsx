import type { Chiamata, Profilo } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Bottone } from '../ui'
import { Telefono, TelefonoGiu } from '../icone'

/**
 * Il telefono che squilla.
 *
 * In basso a destra e non al centro dello schermo, e non e' un dettaglio: chi
 * riceve una chiamata quasi sempre sta facendo qualcos'altro — legge un canale,
 * guarda uno schermo condiviso — e un riquadro modale al centro gli toglierebbe
 * di mano cio' che stava facendo per chiedergli una cosa che puo' anche
 * rifiutare.
 *
 * Da qui si risponde e si rifiuta, e basta. Se nessuno tocca niente, dopo
 * quarantacinque secondi il server la dichiara persa e questo riquadro sparisce
 * da solo — l'attesa la conta il server, non questa schermata, cosi' due
 * dispositivi della stessa persona smettono di squillare insieme.
 */
export default function ChiamataInArrivo({
  chiamata,
  chi,
  rispondi,
  rifiuta
}: {
  chiamata: Chiamata
  /** Chi sta chiamando. Nullo mentre il profilo non e' ancora arrivato. */
  chi: Profilo | null
  rispondi: () => void
  rifiuta: () => void
}): React.JSX.Element {
  const nome = chi?.nome ?? 'Qualcuno'

  return (
    <div className="absolute right-4 bottom-4 z-50 w-72 rounded-2xl border border-bordo bg-fondo-2 p-4 shadow-2xl shadow-black/60">
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          {chi?.avatar ? (
            <img src={chi.avatar} alt="" className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-black/75"
              style={{ background: coloreDi(`u${chiamata.da}`) }}
            >
              {inizialiDi(nome)}
            </span>
          )}
          {/* L'anello che pulsa: e' cio' che si vede con la coda dell'occhio. */}
          <span className="respiro pointer-events-none absolute -inset-1 rounded-full border-2 border-ok" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{nome}</p>
          <p className="text-xs text-testo-3">ti sta chiamando</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Bottone tono="acceso" className="flex-1" onClick={rispondi}>
          <Telefono className="h-4 w-4" />
          Rispondi
        </Bottone>
        <Bottone tono="male" className="flex-1" onClick={rifiuta}>
          <TelefonoGiu className="h-4 w-4" />
          Rifiuta
        </Bottone>
      </div>
    </div>
  )
}

/**
 * Il cartellino di una chiamata finita male.
 *
 * Persa o rifiutata: sono le due che vanno dette, perche' senza una riga
 * scritta l'unica cosa che si vede e' un riquadro che sparisce — e chi stava
 * aspettando una risposta non saprebbe se e' stato rifiutato o se e' caduta la
 * linea. Sparisce da solo dopo qualche secondo.
 */
export function ChiamataFinita({
  motivo,
  nome,
  chiudi
}: {
  motivo: 'chiusa' | 'rifiutata' | 'persa'
  nome: string
  chiudi: () => void
}): React.JSX.Element {
  const testo =
    motivo === 'rifiutata'
      ? `${nome} ha rifiutato la chiamata.`
      : motivo === 'persa'
        ? `${nome} non ha risposto.`
        : 'Chiamata terminata.'

  return (
    <button
      onClick={chiudi}
      className="absolute right-4 bottom-4 z-50 flex items-center gap-2.5 rounded-xl border border-bordo bg-fondo-2 px-3.5 py-2.5 text-left text-sm text-testo-2 shadow-xl shadow-black/50 hover:text-testo"
    >
      <TelefonoGiu className="h-4 w-4 shrink-0 text-male" />
      {testo}
    </button>
  )
}
