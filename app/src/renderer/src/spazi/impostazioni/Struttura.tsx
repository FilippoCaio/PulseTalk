import { useState } from 'react'
import type { Api } from '../../lib/api'
import type { Canale, Categoria, Spazio } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { Avviso, Bottone, classiInput, Conferma, Sezione } from '../../ui'
import { Altoparlante, Cancelletto, Cestino, Chevron, Matita, Piu, Spunta, Chiudi } from '../../icone'

/**
 * Categorie e canali: crearli, rinominarli, spostarli, riordinarli.
 *
 * Il riordino e' con due frecce e non con il trascinamento. Non e' una
 * rinuncia: qui dentro si sposta una riga ogni tanto, quasi sempre di un posto,
 * e il trascinamento su un elenco che scorre — dentro a un pannello che a sua
 * volta scorre — e' il gesto che fallisce piu' spesso di quanto riesca. Con due
 * frecce non si sbaglia mai bersaglio e si puo' premere due volte di fila.
 *
 * L'ordine si manda tutto insieme, non una riga per volta: una connessione che
 * cade a meta' lascerebbe un elenco in un ordine che nessuno ha voluto.
 */
export default function Struttura({
  api,
  spazio,
  ricarica
}: {
  api: Api
  spazio: Spazio
  ricarica: () => void
}): React.JSX.Element {
  const [errore, setErrore] = useState<string | null>(null)
  const [nuovaCategoria, setNuovaCategoria] = useState('')
  const [daEliminare, setDaEliminare] = useState<
    { tipo: 'categoria' | 'canale'; id: number; nome: string } | null
  >(null)

  const con = (p: Promise<unknown>): void => {
    setErrore(null)
    void p.then(ricarica).catch((e) => setErrore((e as Error).message))
  }

  const categorie = [...spazio.categorie].sort((a, b) => a.posizione - b.posizione)
  const senzaCategoria = spazio.canali
    .filter((c) => c.categoria === null)
    .sort((a, b) => a.posizione - b.posizione)

  const spostaCategoria = (id: number, verso: -1 | 1): void => {
    const ordine = categorie.map((c) => c.id)
    const dove = ordine.indexOf(id)
    const meta = dove + verso
    if (meta < 0 || meta >= ordine.length) return
    ;[ordine[dove], ordine[meta]] = [ordine[meta], ordine[dove]]
    con(api.riordina(spazio.id, { categorie: ordine }))
  }

  const spostaCanale = (dentro: Canale[], id: number, verso: -1 | 1): void => {
    const ordine = dentro.map((c) => c.id)
    const dove = ordine.indexOf(id)
    const meta = dove + verso
    if (meta < 0 || meta >= ordine.length) return
    ;[ordine[dove], ordine[meta]] = [ordine[meta], ordine[dove]]
    con(api.riordina(spazio.id, { canali: ordine }))
  }

  return (
    <>
      {errore && <Avviso>{errore}</Avviso>}

      {puo(spazio.permessiMiei, 'createCategories') && (
        <Sezione titolo="Nuova categoria" sotto="Un raggruppamento nella colonna dei canali.">
          <div className="flex gap-2">
            <input
              className={classiInput}
              value={nuovaCategoria}
              onChange={(e) => setNuovaCategoria(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !nuovaCategoria.trim()) return
                con(api.creaCategoria(spazio.id, nuovaCategoria.trim()))
                setNuovaCategoria('')
              }}
              placeholder="Giochi"
              maxLength={40}
            />
            <Bottone
              tono="normale"
              disabled={!nuovaCategoria.trim()}
              onClick={() => {
                con(api.creaCategoria(spazio.id, nuovaCategoria.trim()))
                setNuovaCategoria('')
              }}
            >
              <Piu className="h-4 w-4" />
              Crea
            </Bottone>
          </div>
        </Sezione>
      )}

      <Sezione titolo="Struttura" sotto="Trascina non serve: le frecce spostano di un posto.">
        {senzaCategoria.length > 0 && (
          <div className="rounded-xl border border-dashed border-bordo p-2">
            <p className="mb-1 px-1 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
              Senza categoria
            </p>
            {senzaCategoria.map((canale, indice) => (
              <RigaCanale
                key={canale.id}
                api={api}
                spazio={spazio}
                canale={canale}
                categorie={categorie}
                primo={indice === 0}
                ultimo={indice === senzaCategoria.length - 1}
                sposta={(verso) => spostaCanale(senzaCategoria, canale.id, verso)}
                aggiorna={(m) => con(api.aggiornaCanale(canale.id, m))}
                elimina={() => setDaEliminare({ tipo: 'canale', id: canale.id, nome: canale.nome })}
              />
            ))}
          </div>
        )}

        {categorie.map((categoria, indice) => {
          const dentro = spazio.canali
            .filter((c) => c.categoria === categoria.id)
            .sort((a, b) => a.posizione - b.posizione)

          return (
            <div key={categoria.id} className="rounded-xl border border-bordo bg-fondo-2 p-2">
              <RigaCategoria
                api={api}
                spazio={spazio}
                categoria={categoria}
                primo={indice === 0}
                ultimo={indice === categorie.length - 1}
                sposta={(verso) => spostaCategoria(categoria.id, verso)}
                rinomina={(nome) => con(api.rinominaCategoria(spazio.id, categoria.id, nome))}
                elimina={() =>
                  setDaEliminare({ tipo: 'categoria', id: categoria.id, nome: categoria.nome })
                }
              />

              <div className="mt-1 space-y-0.5 pl-3">
                {dentro.length === 0 ? (
                  <p className="px-1 py-1 text-xs text-testo-3">Vuota.</p>
                ) : (
                  dentro.map((canale, i) => (
                    <RigaCanale
                      key={canale.id}
                      api={api}
                      spazio={spazio}
                      canale={canale}
                      categorie={categorie}
                      primo={i === 0}
                      ultimo={i === dentro.length - 1}
                      sposta={(verso) => spostaCanale(dentro, canale.id, verso)}
                      aggiorna={(m) => con(api.aggiornaCanale(canale.id, m))}
                      elimina={() =>
                        setDaEliminare({ tipo: 'canale', id: canale.id, nome: canale.nome })
                      }
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </Sezione>

      <NuovoCanale api={api} spazio={spazio} categorie={categorie} quandoFatto={ricarica} />

      {daEliminare && (
        <Conferma
          titolo={`Elimini ${daEliminare.nome}?`}
          testo={
            daEliminare.tipo === 'categoria'
              ? "I canali dentro non si perdono: restano dove sono, senza categoria, in cima all'elenco."
              : 'Spariscono anche tutti i messaggi e gli allegati che ci sono dentro.'
          }
          azione="Elimina"
          tono="male"
          conferma={() => {
            const quale = daEliminare
            setDaEliminare(null)
            con(
              quale.tipo === 'categoria'
                ? api.eliminaCategoria(spazio.id, quale.id)
                : api.eliminaCanale(quale.id)
            )
          }}
          chiudi={() => setDaEliminare(null)}
        />
      )}
    </>
  )
}

function Frecce({
  primo,
  ultimo,
  sposta,
  cosa
}: {
  primo: boolean
  ultimo: boolean
  sposta: (verso: -1 | 1) => void
  cosa: string
}): React.JSX.Element {
  return (
    <span className="flex shrink-0">
      <button
        disabled={primo}
        onClick={() => sposta(-1)}
        title={`Sposta ${cosa} in su`}
        aria-label={`Sposta ${cosa} in su`}
        className="p-1 text-testo-3 hover:text-testo disabled:opacity-25"
      >
        <Chevron className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button
        disabled={ultimo}
        onClick={() => sposta(1)}
        title={`Sposta ${cosa} in giu'`}
        aria-label={`Sposta ${cosa} in giu'`}
        className="p-1 text-testo-3 hover:text-testo disabled:opacity-25"
      >
        <Chevron className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}

function RigaCategoria({
  spazio,
  categoria,
  primo,
  ultimo,
  sposta,
  rinomina,
  elimina
}: {
  api: Api
  spazio: Spazio
  categoria: Categoria
  primo: boolean
  ultimo: boolean
  sposta: (verso: -1 | 1) => void
  rinomina: (nome: string) => void
  elimina: () => void
}): React.JSX.Element {
  const [modifica, setModifica] = useState(false)
  const [nome, setNome] = useState(categoria.nome)

  const puoModificare = puo(spazio.permessiMiei, 'editCategories')
  const puoEliminare = puo(spazio.permessiMiei, 'deleteCategories')

  if (modifica) {
    return (
      <div className="flex gap-1.5">
        <input
          className={classiInput}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nome.trim()) {
              rinomina(nome.trim())
              setModifica(false)
            }
            if (e.key === 'Escape') setModifica(false)
          }}
          maxLength={40}
          autoFocus
        />
        <button
          className="px-1 text-ok"
          title="Salva"
          onClick={() => {
            if (!nome.trim()) return
            rinomina(nome.trim())
            setModifica(false)
          }}
        >
          <Spunta className="h-4 w-4" />
        </button>
        <button className="px-1 text-testo-3" title="Annulla" onClick={() => setModifica(false)}>
          <Chiudi className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-1 px-1">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider text-testo-2 uppercase">
        {categoria.nome}
      </span>
      {puoModificare && <Frecce primo={primo} ultimo={ultimo} sposta={sposta} cosa={categoria.nome} />}
      {puoModificare && (
        <button
          onClick={() => setModifica(true)}
          title={`Rinomina ${categoria.nome}`}
          aria-label={`Rinomina ${categoria.nome}`}
          className="p-1 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-testo"
        >
          <Matita className="h-3.5 w-3.5" />
        </button>
      )}
      {puoEliminare && (
        <button
          onClick={elimina}
          title={`Elimina ${categoria.nome}`}
          aria-label={`Elimina ${categoria.nome}`}
          className="p-1 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
        >
          <Cestino className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function RigaCanale({
  spazio,
  canale,
  categorie,
  primo,
  ultimo,
  sposta,
  aggiorna,
  elimina
}: {
  api: Api
  spazio: Spazio
  canale: Canale
  categorie: Categoria[]
  primo: boolean
  ultimo: boolean
  sposta: (verso: -1 | 1) => void
  aggiorna: (modifiche: { nome?: string; categoria?: number | null }) => void
  elimina: () => void
}): React.JSX.Element {
  const [modifica, setModifica] = useState(false)
  const [nome, setNome] = useState(canale.nome)

  const puoModificare = puo(
    spazio.permessiMiei,
    canale.tipo === 'voce' ? 'editVoiceChannels' : 'editTextChannels'
  )
  const puoEliminare = puo(
    spazio.permessiMiei,
    canale.tipo === 'voce' ? 'deleteVoiceChannels' : 'deleteTextChannels'
  )

  return (
    <div className="group flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-fondo-3/50">
      <span className="shrink-0 text-testo-3">
        {canale.tipo === 'voce' ? (
          <Altoparlante className="h-3.5 w-3.5" />
        ) : (
          <Cancelletto className="h-3.5 w-3.5" />
        )}
      </span>

      {modifica ? (
        <input
          className="min-w-0 flex-1 rounded-md border border-bordo bg-fondo px-2 py-0.5 text-sm"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nome.trim()) {
              aggiorna({ nome: nome.trim() })
              setModifica(false)
            }
            if (e.key === 'Escape') setModifica(false)
          }}
          maxLength={40}
          autoFocus
          onBlur={() => setModifica(false)}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-testo-2">{canale.nome}</span>
      )}

      {puoModificare && (
        <select
          value={canale.categoria ?? ''}
          onChange={(e) => aggiorna({ categoria: e.target.value ? Number(e.target.value) : null })}
          aria-label={`Categoria di ${canale.nome}`}
          className="shrink-0 rounded-md border border-bordo bg-fondo px-1 py-0.5 text-[11px] text-testo-3 opacity-0 group-hover:opacity-100"
        >
          <option value="">senza categoria</option>
          {categorie.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      )}

      {puoModificare && <Frecce primo={primo} ultimo={ultimo} sposta={sposta} cosa={canale.nome} />}

      {puoModificare && !modifica && (
        <button
          onClick={() => setModifica(true)}
          title={`Rinomina ${canale.nome}`}
          aria-label={`Rinomina ${canale.nome}`}
          className="p-1 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-testo"
        >
          <Matita className="h-3.5 w-3.5" />
        </button>
      )}

      {puoEliminare && (
        <button
          onClick={elimina}
          title={`Elimina ${canale.nome}`}
          aria-label={`Elimina ${canale.nome}`}
          className="p-1 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
        >
          <Cestino className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function NuovoCanale({
  api,
  spazio,
  categorie,
  quandoFatto
}: {
  api: Api
  spazio: Spazio
  categorie: Categoria[]
  quandoFatto: () => void
}): React.JSX.Element | null {
  const [tipo, setTipo] = useState<'testo' | 'voce'>('testo')
  const [nome, setNome] = useState('')
  const [categoria, setCategoria] = useState<number | null>(null)
  const [durataMinuti, setDurataMinuti] = useState<number>(0)
  const [errore, setErrore] = useState<string | null>(null)

  const puoTesto = puo(spazio.permessiMiei, 'createTextChannels')
  const puoVoce = puo(spazio.permessiMiei, 'createVoiceChannels')
  if (!puoTesto && !puoVoce) return null

  return (
    <Sezione titolo="Nuovo canale" sotto="Nasce in fondo alla categoria che scegli.">
      <div className="flex flex-wrap gap-2">
        <select
          className={`${classiInput} max-w-32`}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as 'testo' | 'voce')}
        >
          {puoTesto && <option value="testo">Testo</option>}
          {puoVoce && <option value="voce">Voce</option>}
        </select>

        <select
          className={`${classiInput} max-w-40`}
          value={durataMinuti}
          onChange={(e) => setDurataMinuti(Number(e.target.value))}
          aria-label="Durata del canale"
        >
          <option value={0}>Permanente</option>
          <option value={30}>30 minuti</option>
          <option value={60}>1 ora</option>
          <option value={180}>3 ore</option>
          <option value={360}>6 ore</option>
          <option value={720}>12 ore</option>
          <option value={1440}>24 ore</option>
        </select>

        <input
          className={`${classiInput} min-w-40 flex-1`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={tipo === 'voce' ? 'Officina' : 'generale'}
          maxLength={40}
        />

        <select
          className={`${classiInput} max-w-40`}
          value={categoria ?? ''}
          onChange={(e) => setCategoria(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Senza categoria</option>
          {categorie.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>

        <Bottone
          tono="vivo"
          disabled={!nome.trim()}
          onClick={() => {
            setErrore(null)
            void api
              .creaCanale(spazio.id, { nome: nome.trim(), tipo, categoria, durataMinuti })
              .then(() => {
                setNome('')
                quandoFatto()
              })
              .catch((e) => setErrore((e as Error).message))
          }}
        >
          Crea
        </Bottone>
      </div>
      {errore && <Avviso>{errore}</Avviso>}
    </Sezione>
  )
}
