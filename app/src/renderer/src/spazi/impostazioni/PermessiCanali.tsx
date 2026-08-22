import { useEffect, useState } from 'react'
import type { Api, Membro } from '../../lib/api'
import type { Override, Ruolo, Spazio } from '@shared/tipi'
import { nomePermesso, PERMESSI_DI_CANALE, sottoPermesso, type Permesso } from '@shared/permessi'
import { Avviso, Bottone, Campo, classiInput, Sezione } from '../../ui'
import { Altoparlante, Cancelletto, Cartella, Chiudi } from '../../icone'

/**
 * Le eccezioni, categoria per categoria e canale per canale.
 *
 * La catena e' questa, e si legge da sinistra a destra:
 *
 *     permessi del server  →  categoria  →  canale
 *
 * Ogni anello puo' aggiungere o togliere rispetto a quello prima. Un permesso
 * che nessuno nomina resta com'era: e' la differenza fra "negato" e "non
 * detto", ed e' il motivo per cui qui ci sono tre stati e non una casella.
 *
 *     Consenti   lo aggiunge, anche se un anello prima lo aveva tolto
 *     Nega       lo toglie
 *     —          non dice niente: decide il livello di sopra
 *
 * Fra due eccezioni che si contraddicono sullo stesso canale vince quella del
 * ruolo con priorita' piu' alta; un'eccezione scritta su una persona vince su
 * tutti i ruoli, perche' altrimenti non servirebbe a niente.
 */
type Stato = 'consenti' | 'nega' | 'niente'

export default function PermessiCanali({
  api,
  spazio,
  ruoli,
  membri,
  ricarica
}: {
  api: Api
  spazio: Spazio
  ruoli: Ruolo[] | null
  membri: Membro[] | null
  ricarica: () => void
}): React.JSX.Element {
  const [ambito, setAmbito] = useState<'categoria' | 'canale'>(
    spazio.categorie.length > 0 ? 'categoria' : 'canale'
  )
  const [bersaglio, setBersaglio] = useState<number | null>(
    spazio.categorie[0]?.id ?? spazio.canali[0]?.id ?? null
  )
  const [override, setOverride] = useState<Override[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [aggiungi, setAggiungi] = useState('')

  const carica = (): void => {
    if (bersaglio === null) return
    setOverride(null)
    void api
      .override(spazio.id, ambito, bersaglio)
      .then((r) => setOverride(r.override))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(carica, [api, spazio.id, ambito, bersaglio])

  const scrivi = async (
    tipo: 'ruolo' | 'utente',
    soggetto: number,
    consenti: Permesso[],
    nega: Permesso[]
  ): Promise<void> => {
    if (bersaglio === null) return
    setErrore(null)
    try {
      const r = await api.impostaOverride(spazio.id, ambito, bersaglio, {
        tipo,
        soggetto,
        consenti,
        nega
      })
      setOverride(r.override)
      // I permessi cambiati possono aver fatto sparire o comparire dei canali:
      // la colonna a sinistra va riletta, non indovinata.
      ricarica()
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  const nomeDi = (riga: Override): string => {
    if (riga.tipo === 'ruolo') return ruoli?.find((r) => r.id === riga.soggetto)?.nome ?? 'ruolo'
    return membri?.find((m) => m.id === riga.soggetto)?.nome ?? 'persona'
  }

  const gia = new Set((override ?? []).map((o) => `${o.tipo}:${o.soggetto}`))
  const candidati = [
    ...(ruoli ?? []).map((r) => ({ chiave: `ruolo:${r.id}`, nome: `Ruolo · ${r.nome}` })),
    ...(membri ?? []).map((m) => ({ chiave: `utente:${m.id}`, nome: `Persona · ${m.nome}` }))
  ].filter((c) => !gia.has(c.chiave))

  return (
    <>
      <Sezione
        titolo="Dove"
        sotto="Scegli la categoria o il canale su cui scrivere le eccezioni."
      >
        <div className="flex gap-2">
          <select
            className={`${classiInput} max-w-40`}
            value={ambito}
            onChange={(e) => {
              const nuovo = e.target.value as 'categoria' | 'canale'
              setAmbito(nuovo)
              setBersaglio(nuovo === 'categoria' ? (spazio.categorie[0]?.id ?? null) : (spazio.canali[0]?.id ?? null))
            }}
          >
            <option value="categoria">Categoria</option>
            <option value="canale">Canale</option>
          </select>

          <select
            className={classiInput}
            value={bersaglio ?? ''}
            onChange={(e) => setBersaglio(e.target.value ? Number(e.target.value) : null)}
          >
            {ambito === 'categoria'
              ? spazio.categorie.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))
              : spazio.canali.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tipo === 'voce' ? '🔊' : '#'} {c.nome}
                  </option>
                ))}
          </select>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-testo-3">
          {ambito === 'categoria' ? (
            <Cartella className="h-3.5 w-3.5" />
          ) : spazio.canali.find((c) => c.id === bersaglio)?.tipo === 'voce' ? (
            <Altoparlante className="h-3.5 w-3.5" />
          ) : (
            <Cancelletto className="h-3.5 w-3.5" />
          )}
          {ambito === 'categoria'
            ? 'Cio\' che si scrive qui vale per tutti i canali dentro alla categoria, e i singoli canali possono ancora cambiarlo.'
            : 'Cio\' che si scrive qui vince sulla categoria che lo contiene.'}
        </p>
      </Sezione>

      {errore && <Avviso>{errore}</Avviso>}

      <Sezione titolo="Eccezioni" sotto="Niente qui dentro vuol dire: decide il livello di sopra.">
        {override === null ? (
          <p className="respiro text-sm text-testo-3">carico…</p>
        ) : override.length === 0 ? (
          <p className="text-sm text-testo-3">Nessuna eccezione: vale quello che dicono i ruoli.</p>
        ) : (
          <div className="space-y-3">
            {override.map((riga) => (
              <BloccoOverride
                key={`${riga.tipo}:${riga.soggetto}`}
                nome={nomeDi(riga)}
                riga={riga}
                scrivi={(consenti, nega) => void scrivi(riga.tipo, riga.soggetto, consenti, nega)}
                togli={() => {
                  if (bersaglio === null) return
                  void api
                    .eliminaOverride(spazio.id, ambito, bersaglio, riga.tipo, riga.soggetto)
                    .then(() => {
                      carica()
                      ricarica()
                    })
                    .catch((e) => setErrore((e as Error).message))
                }}
              />
            ))}
          </div>
        )}

        {candidati.length > 0 && (
          <Campo etichetta="Aggiungi un'eccezione">
            <div className="flex gap-2">
              <select
                className={classiInput}
                value={aggiungi}
                onChange={(e) => setAggiungi(e.target.value)}
              >
                <option value="">Per chi…</option>
                {candidati.map((c) => (
                  <option key={c.chiave} value={c.chiave}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <Bottone
                tono="normale"
                disabled={!aggiungi}
                onClick={() => {
                  const [tipo, id] = aggiungi.split(':')
                  // Un'eccezione vuota il server la cancella: si parte da un
                  // permesso qualunque negato, cosi' la riga esiste e si puo'
                  // sistemare guardandola.
                  void scrivi(tipo as 'ruolo' | 'utente', Number(id), [], ['sendMessages']).then(
                    () => setAggiungi('')
                  )
                }}
              >
                Aggiungi
              </Bottone>
            </div>
          </Campo>
        )}
      </Sezione>
    </>
  )
}

function BloccoOverride({
  nome,
  riga,
  scrivi,
  togli
}: {
  nome: string
  riga: Override
  scrivi: (consenti: Permesso[], nega: Permesso[]) => void
  togli: () => void
}): React.JSX.Element {
  const statoDi = (p: Permesso): Stato =>
    riga.consenti.includes(p) ? 'consenti' : riga.nega.includes(p) ? 'nega' : 'niente'

  const cambia = (p: Permesso, stato: Stato): void => {
    const consenti = riga.consenti.filter((x) => x !== p)
    const nega = riga.nega.filter((x) => x !== p)
    if (stato === 'consenti') consenti.push(p)
    if (stato === 'nega') nega.push(p)
    scrivi(consenti, nega)
  }

  return (
    <div className="rounded-xl border border-bordo bg-fondo-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{nome}</p>
        <button
          onClick={togli}
          title={`Togli l'eccezione per ${nome}`}
          aria-label={`Togli l'eccezione per ${nome}`}
          className="text-testo-3 hover:text-male"
        >
          <Chiudi className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1">
        {PERMESSI_DI_CANALE.map((p) => {
          const stato = statoDi(p)
          return (
            <div key={p} className="flex items-center gap-2 py-0.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-testo-2">{nomePermesso(p)}</span>
                {stato !== 'niente' && sottoPermesso(p) && (
                  <span className="block truncate text-[11px] text-testo-3">{sottoPermesso(p)}</span>
                )}
              </span>

              {/* Tre pulsanti e non una casella: "non detto" non e' "no". */}
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-bordo">
                {(
                  [
                    ['nega', '✕', 'Nega', 'text-male'],
                    ['niente', '—', 'Lascia decidere sopra', 'text-testo-3'],
                    ['consenti', '✓', 'Consenti', 'text-ok']
                  ] as [Stato, string, string, string][]
                ).map(([quale, segno, titolo, colore]) => (
                  <button
                    key={quale}
                    title={titolo}
                    aria-label={`${nomePermesso(p)}: ${titolo}`}
                    onClick={() => cambia(p, quale)}
                    className={`w-8 py-1 text-xs transition-colors ${
                      stato === quale ? `bg-fondo-3 ${colore}` : 'text-testo-3 hover:bg-fondo-3/50'
                    }`}
                  >
                    {segno}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
