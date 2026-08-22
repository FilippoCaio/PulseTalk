import type { Canale, Spazio } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Altoparlante } from '../icone'

/**
 * Il cartellino che compare passando sopra a un'icona nella barra degli spazi.
 *
 * Nasce da una domanda che la barra, da sola, non sapeva rispondere: con
 * quattro server e le iniziali al posto dei nomi, "dove sono adesso?" si
 * scopriva solo cliccando. Il `title` del browser il nome lo diceva, ma dopo un
 * secondo e mezzo e senza niente intorno.
 *
 * Quando in quel server c'e' la chiamata a cui si sta partecipando, il
 * cartellino porta anche il nome del canale e le facce di chi c'e' dentro: e'
 * l'unica informazione che serve davvero mentre si sta leggendo altrove, ed e'
 * anche il modo di ritrovare la strada per tornarci.
 *
 * Non e' un menu: non si puo' cliccare, non ruba il fuoco e sparisce appena il
 * mouse se ne va. Se diventasse premibile, ogni passaggio accidentale sopra
 * alla barra diventerebbe un ostacolo.
 */
export default function OverlaySpazio({
  spazio,
  canaleVocale,
  profili
}: {
  spazio: Spazio
  /** Il canale vocale di questo spazio in cui si sta parlando adesso, se c'e'. */
  canaleVocale: Canale | null
  profili?: Map<number, { nome: string; avatar: string | null }>
}): React.JSX.Element {
  const presenti = canaleVocale?.presenti ?? []

  return (
    <div
      // pointer-events-none e' la riga che lo rende innocuo: il mouse ci passa
      // attraverso, quindi non copre le icone sotto e non interrompe l'hover
      // che lo ha fatto comparire.
      className="pointer-events-none absolute left-full z-40 ml-2 w-max max-w-64 -translate-y-1/2 rounded-xl border border-bordo bg-fondo-2 px-3 py-2 shadow-lg shadow-black/40"
      style={{ top: '50%' }}
      role="tooltip"
    >
      <p className="truncate text-sm font-medium text-testo">{spazio.nome}</p>

      {canaleVocale && (
        <div className="mt-2 border-t border-bordo pt-2">
          <p className="flex items-center gap-1.5 text-xs text-ok">
            <Altoparlante className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{canaleVocale.nome}</span>
          </p>

          {presenti.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {presenti.slice(0, 8).map((persona) => {
                // L'identita' sulla SFU e' `u<id>`: e' l'unica chiave su cui una
                // presenza e un profilo combaciano.
                const foto = profili?.get(Number(persona.identita.slice(1)))?.avatar ?? null
                return foto ? (
                  <img
                    key={persona.identita}
                    src={foto}
                    alt=""
                    title={persona.nome}
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <span
                    key={persona.identita}
                    title={persona.nome}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-black/75"
                    style={{ background: coloreDi(persona.identita) }}
                  >
                    {inizialiDi(persona.nome)}
                  </span>
                )
              })}
              {presenti.length > 8 && (
                <span className="numeri text-[10px] text-testo-3">+{presenti.length - 8}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
