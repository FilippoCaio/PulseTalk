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
  profili,
  ancora
}: {
  spazio: Spazio
  /** Il canale vocale di questo spazio in cui si sta parlando adesso, se c'e'. */
  canaleVocale: Canale | null
  profili?: Map<number, { nome: string; avatar: string | null }>
  /** Dove sta sullo schermo l'icona che lo ha fatto comparire. */
  ancora: DOMRect
}): React.JSX.Element {
  const presenti = canaleVocale?.presenti ?? []

  return (
    <div
      // pointer-events-none e' la riga che lo rende innocuo: il mouse ci passa
      // attraverso, quindi non copre le icone sotto e non interrompe l'hover
      // che lo ha fatto comparire.
      //
      // E niente animazione di comparsa, che c'e' stata per una versione e ha
      // fatto danno. Un'animazione che parte da `opacity: 0` rende la
      // visibilita' del cartellino dipendente dal fatto che l'animazione
      // arrivi in fondo — e ci sono molti modi perche' non ci arrivi: una
      // finestra che il sistema non sta componendo, un fotogramma saltato, un
      // ridisegno che la fa ripartire. Il costo di sbagliare e' che il
      // cartellino non compare affatto, e il guadagno era un decimo di
      // secondo di morbidezza su una cosa che deve esserci subito.
      //
      // POSIZIONE FISSA, e non piu' `absolute left-full` rispetto al bottone.
      // La barra degli spazi scorre — le serve, sul telefono — e una scatola
      // che scorre ritaglia cio' che le esce su tutti e due gli assi, anche
      // quello lasciato `visible`: il CSS lo porta ad `auto` da solo appena
      // l'altro non e' piu' `visible`. Il cartellino, che sta a `left: 100%`
      // di un'icona larga 48 dentro a una colonna larga 64, cadeva quindi
      // fuori dal ritaglio: non si vedeva, e l'unica traccia che lasciava era
      // la barra di scorrimento orizzontale che la sua sporgenza faceva
      // comparire in fondo alla colonna.
      //
      // `fixed` si ancora alla finestra invece che al contenitore, quindi
      // nessun `overflow` di mezzo lo puo' tagliare. In cambio le coordinate
      // vanno misurate: le prende chi lo fa comparire, dal bottone, nello
      // stesso momento in cui il mouse ci arriva.
      // Sotto all'icona e centrato su di lei, da quando la barra degli spazi
      // e' una riga in cima: di fianco, come stava, sarebbe uscito dallo
      // schermo su tutte le icone tranne le prime due, e su una barra che
      // scorre sarebbe finito sopra alla vicina invece che accanto alla sua.
      //
      // Il `left` si tiene dentro alla finestra da solo: un cartellino largo
      // duecento pixel centrato sull'ultima icona a destra sporgerebbe, e
      // sporgendo allargherebbe la pagina.
      className="pointer-events-none fixed z-40 w-max max-w-64 -translate-x-1/2 rounded-xl border border-bordo bg-fondo-2 px-3 py-2 shadow-lg shadow-black/40"
      style={{
        left: Math.min(Math.max(ancora.left + ancora.width / 2, 140), window.innerWidth - 140),
        top: ancora.bottom + 8
      }}
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
