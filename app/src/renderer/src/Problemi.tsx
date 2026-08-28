import { useEffect, useState } from 'react'
import { usaProblemi, type Problema } from './lib/diagnostica'
import { Attenzione, Chiudi, Errore } from './icone'
import { Bottone } from './ui'

/**
 * Le due spie dei guai, e il pannello che le apre.
 *
 * Sono due e non una perche' "tre problemi" non dice niente di utile: tre cose
 * rotte e tre cose da configurare si affrontano in due giornate diverse. Il
 * triangolo giallo conta cio' che si puo' rimandare, il cerchio rosso cio' che
 * non funziona adesso.
 *
 * Compaiono solo quando c'e' qualcosa da contare. Una spia sempre accesa che
 * dice zero e' rumore, e dopo una settimana non la guarda piu' nessuno.
 *
 * Stanno in basso a destra, fisse: e' l'unico angolo che non litiga con la
 * barra della chiamata (in mezzo in basso), con i comandi della stanza (in
 * alto a destra) e con la finestra vera (in alto). Il contenitore non prende
 * clic — solo i due bottoni li prendono — cosi' non c'e' nessun rettangolo
 * invisibile che si mangia i clic di cio' che sta sotto.
 */
export default function Problemi(): React.JSX.Element | null {
  const problemi = usaProblemi()
  const [aperto, setAperto] = useState(false)

  const errori = problemi.filter((p) => p.gravita === 'errore')
  const attenzioni = problemi.filter((p) => p.gravita === 'attenzione')

  // Sparito l'ultimo guaio mentre il pannello era aperto, il pannello si
  // chiude da solo: restare davanti a un elenco vuoto fa cercare cosa non si
  // e' capito.
  useEffect(() => {
    if (!problemi.length) setAperto(false)
  }, [problemi.length])

  if (!problemi.length) return null

  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex items-center gap-2">
        {errori.length > 0 && (
          <Spia
            tono="errore"
            quanti={errori.length}
            premi={() => setAperto(true)}
          />
        )}
        {attenzioni.length > 0 && (
          <Spia
            tono="attenzione"
            quanti={attenzioni.length}
            premi={() => setAperto(true)}
          />
        )}
      </div>

      {aperto && (
        <Pannello
          problemi={problemi}
          chiudi={() => setAperto(false)}
        />
      )}
    </>
  )
}

function Spia({
  tono,
  quanti,
  premi
}: {
  tono: 'errore' | 'attenzione'
  quanti: number
  premi: () => void
}): React.JSX.Element {
  const errore = tono === 'errore'
  const Icona = errore ? Errore : Attenzione
  const nome = errore
    ? `${quanti} ${quanti === 1 ? 'errore' : 'errori'}`
    : `${quanti} ${quanti === 1 ? 'avviso' : 'avvisi'}`

  return (
    <button
      type="button"
      onClick={premi}
      title={`${nome} — apri l'elenco`}
      aria-label={`${nome}. Apri l'elenco dei problemi.`}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-semibold shadow-lg backdrop-blur transition-colors ${
        errore
          ? 'border-male/50 bg-male/15 text-male hover:bg-male/25'
          : 'border-attenzione/50 bg-attenzione/15 text-attenzione hover:bg-attenzione/25'
      }`}
    >
      <Icona className="h-4 w-4" />
      <span className="numeri leading-none">{quanti}</span>
    </button>
  )
}

/**
 * L'elenco, grande quasi quanto la finestra.
 *
 * Grande perche' e' il posto in cui si legge cosa non va, e leggere sei righe
 * per volta dentro a un riquadro da francobollo e' il modo di non leggerle. Esc
 * chiude, come dappertutto qui dentro.
 */
function Pannello({
  problemi,
  chiudi
}: {
  problemi: Problema[]
  chiudi: () => void
}): React.JSX.Element {
  useEffect(() => {
    const tasto = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') chiudi()
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [chiudi])

  const errori = problemi.filter((p) => p.gravita === 'errore').length
  const attenzioni = problemi.length - errori

  return (
    <div
      className="velo fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={chiudi}
      role="presentation"
    >
      <div
        className="pannello flex h-[min(92vh,60rem)] w-[min(92vw,64rem)] min-h-0 flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2 shadow-2xl"
        onClick={(evento) => evento.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Problemi"
      >
        <header className="flex items-center gap-3 border-b border-bordo px-5 py-3.5">
          <h2 className="text-base font-semibold text-testo">Cosa non va</h2>
          <span className="text-xs text-testo-3">
            {errori > 0 && `${errori} ${errori === 1 ? 'errore' : 'errori'}`}
            {errori > 0 && attenzioni > 0 && ' · '}
            {attenzioni > 0 && `${attenzioni} ${attenzioni === 1 ? 'avviso' : 'avvisi'}`}
          </span>
          <button
            type="button"
            onClick={chiudi}
            title="Chiudi"
            aria-label="Chiudi"
            className="ml-auto rounded-lg p-1.5 text-testo-3 hover:bg-fondo-3 hover:text-testo"
          >
            <Chiudi className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ul className="flex flex-col gap-2.5">
            {problemi.map((p) => (
              <Riga key={p.chiave} problema={p} chiudi={chiudi} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Riga({
  problema,
  chiudi
}: {
  problema: Problema
  chiudi: () => void
}): React.JSX.Element {
  const errore = problema.gravita === 'errore'
  const Icona = errore ? Errore : Attenzione

  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
        errore ? 'border-male/35 bg-male/8' : 'border-attenzione/35 bg-attenzione/8'
      }`}
    >
      <Icona className={`mt-0.5 h-5 w-5 shrink-0 ${errore ? 'text-male' : 'text-attenzione'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-testo">{problema.titolo}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-testo-2">{problema.dettaglio}</p>
      </div>
      {problema.azione && (
        <Bottone
          tono="fantasma"
          className="shrink-0 py-1 text-xs"
          onClick={() => {
            problema.azione!.fai()
            chiudi()
          }}
        >
          {problema.azione.nome}
        </Bottone>
      )}
    </li>
  )
}

/**
 * Il guaio piu' grave, disteso in cima al contenuto.
 *
 * Le spie in basso dicono *quanti*; questa dice *cosa*, e lo dice senza che si
 * debba premere niente. Ne mostra uno solo — il piu' grave — perche' tre
 * strisce gialle in cima alla finestra sono una finestra piu' corta: gli altri
 * stanno nel pannello, che e' fatto per quello.
 *
 * Chiudendola si zittisce quel guaio li', non la striscia: se domani ne compare
 * un altro, torna. La chiave e' quella del problema, quindi la stessa cosa
 * chiusa ieri e ricomparsa oggi resta chiusa — ed e' il comportamento giusto
 * per un avviso che non si puo' risolvere in cinque minuti.
 */
export function StrisciaProblemi(): React.JSX.Element | null {
  const problemi = usaProblemi()
  const [chiusi, setChiusi] = useState<string[]>([])

  const primo = problemi.find((p) => !chiusi.includes(p.chiave))
  if (!primo) return null

  const errore = primo.gravita === 'errore'
  const Icona = errore ? Errore : Attenzione

  return (
    <div className="p-3 pb-0">
      <div
        className={`flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${
          errore
            ? 'border-male/40 bg-male/10 text-male'
            : 'border-attenzione/40 bg-attenzione/10 text-attenzione'
        }`}
      >
        <Icona className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">{primo.titolo}</span>{' '}
          <span className="text-testo-2">{primo.dettaglio}</span>
        </p>
        {primo.azione && (
          <Bottone tono="fantasma" className="shrink-0 py-1 text-xs" onClick={primo.azione.fai}>
            {primo.azione.nome}
          </Bottone>
        )}
        <button
          type="button"
          title="Chiudi l'avviso"
          aria-label="Chiudi l'avviso"
          className="shrink-0 rounded p-1 hover:bg-fondo-3"
          onClick={() => setChiusi((elenco) => [...elenco, primo.chiave])}
        >
          <Chiudi className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
