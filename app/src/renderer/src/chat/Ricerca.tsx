import { useEffect, useRef, useState } from 'react'
import type { Messaggio, Spazio } from '@shared/tipi'
import type { Api } from '../lib/api'
import { Avviso, classiInput } from '../ui'

/**
 * Cercare nello storico.
 *
 * L'indice e' FTS5 di SQLite, sul NAS: nessun servizio esterno, nessun
 * documento che esce di casa. Cerca dalla terza lettera in poi e aspetta
 * duecento millisecondi dopo l'ultimo tasto — non per risparmiare al server,
 * che non se ne accorgerebbe, ma perche' i risultati che cambiano a ogni
 * carattere sono impossibili da leggere.
 */
export default function Ricerca({
  api,
  spazio,
  profili,
  vaiA,
  chiudi
}: {
  api: Api
  spazio: Spazio
  profili: Map<number, { nome: string; avatar: string | null }>
  vaiA: (canale: number) => void
  chiudi: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [risultati, setRisultati] = useState<Messaggio[] | null>(null)
  const [cercando, setCercando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const attesa = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (attesa.current) clearTimeout(attesa.current)
    if (query.trim().length < 3) {
      setRisultati(null)
      return
    }

    attesa.current = setTimeout(() => {
      setCercando(true)
      setErrore(null)
      void api
        .cerca(spazio.id, query.trim())
        .then(({ risultati }) => setRisultati(risultati))
        .catch((e) => setErrore((e as Error).message))
        .finally(() => setCercando(false))
    }, 200)

    return () => {
      if (attesa.current) clearTimeout(attesa.current)
    }
  }, [api, spazio.id, query])

  const nomeCanale = (id: number): string =>
    spazio.canali.find((c) => c.id === id)?.nome ?? 'un canale'

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/70 p-6 pt-20 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-bordo p-3">
          <input
            className={classiInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && chiudi()}
            placeholder={`Cerca in ${spazio.nome}…`}
            autoFocus
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {errore && <Avviso>{errore}</Avviso>}

          {query.trim().length > 0 && query.trim().length < 3 && (
            <p className="py-6 text-center text-sm text-testo-3">Almeno tre lettere.</p>
          )}

          {cercando && <p className="respiro py-6 text-center text-sm text-testo-3">cerco…</p>}

          {!cercando && risultati?.length === 0 && (
            <p className="py-6 text-center text-sm text-testo-3">Niente che contenga quelle parole.</p>
          )}

          <div className="space-y-1">
            {risultati?.map((messaggio) => (
              <button
                key={messaggio.id}
                onClick={() => vaiA(messaggio.canale)}
                className="block w-full rounded-lg border border-bordo bg-fondo px-3 py-2 text-left transition-colors hover:border-fondo-3"
              >
                <div className="flex items-baseline gap-2 text-xs text-testo-3">
                  <span className="text-testo-2">
                    {profili.get(messaggio.autore)?.nome ?? 'qualcuno'}
                  </span>
                  <span>in #{nomeCanale(messaggio.canale)}</span>
                  <span className="numeri">
                    {new Date(messaggio.istante).toLocaleDateString('it-IT', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-3 text-sm break-words whitespace-pre-wrap text-testo">
                  {messaggio.testo}
                </p>
              </button>
            ))}
          </div>
        </div>

        <p className="border-t border-bordo px-3 py-2 text-[11px] text-testo-3">
          Cerca in tutti i canali di questo spazio. L'indice sta sul NAS: nessun messaggio esce di
          casa per essere cercato.
        </p>
      </div>
    </div>
  )
}
