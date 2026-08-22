import { useState } from 'react'
import type { Api, Membro } from '../../lib/api'
import type { Ruolo, Spazio } from '@shared/tipi'
import { GRUPPI_PERMESSI, type Permesso } from '@shared/permessi'
import { Avviso, Bottone, Campo, classiInput, Conferma, Sezione } from '../../ui'
import { Cestino, Piu } from '../../icone'

/**
 * I ruoli, e cosa aprono.
 *
 * Tre cose valgono la pena di essere dette, perche' spiegano perche' il
 * pannello e' fatto cosi' e non come quello di Discord:
 *
 *   **Admin non si modifica.** Ha tutti i permessi per costruzione, compresi
 *   quelli che verranno aggiunti fra sei mesi. Mostrargli un elenco di caselle
 *   tutte spuntate lascerebbe credere che si possano togliere.
 *
 *   **La priorita' decide chi vince.** Quando due eccezioni su uno stesso
 *   canale si contraddicono, passa quella del ruolo piu' alto. E' l'unica cosa
 *   che rende prevedibile un sistema di override, e per questo i tre ruoli
 *   predefiniti hanno una posizione fissa.
 *
 *   **Non si regala cio' che non si ha.** Il server rifiuta un ruolo con dentro
 *   un permesso che chi lo crea non possiede. Qui quelle caselle si vedono
 *   spente, cosi' il rifiuto non arriva a sorpresa dopo aver premuto Salva.
 */
export default function Ruoli({
  api,
  spazio,
  ruoli,
  membri,
  rileggi
}: {
  api: Api
  spazio: Spazio
  ruoli: Ruolo[] | null
  membri: Membro[] | null
  rileggi: () => void
}): React.JSX.Element {
  const [apertoId, setApertoId] = useState<number | null>(null)
  const [creando, setCreando] = useState(false)
  const [nuovoNome, setNuovoNome] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [daEliminare, setDaEliminare] = useState<Ruolo | null>(null)

  const miei = spazio.permessiMiei

  const crea = async (): Promise<void> => {
    if (!nuovoNome.trim()) return
    setErrore(null)
    try {
      const { ruolo } = await api.creaRuolo(spazio.id, { nome: nuovoNome.trim(), priorita: 10 })
      setNuovoNome('')
      setCreando(false)
      setApertoId(ruolo.id)
      rileggi()
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  return (
    <>
      <Sezione
        titolo="Ruoli"
        sotto="Valgono solo qui dentro: lo stesso nome in un altro server e' un'altra cosa, con altri permessi."
      >
        {errore && <Avviso>{errore}</Avviso>}

        {ruoli === null ? (
          <p className="respiro text-sm text-testo-3">carico…</p>
        ) : (
          <div className="space-y-2">
            {ruoli.map((ruolo) => (
              <RigaRuolo
                key={ruolo.id}
                api={api}
                spazio={spazio}
                ruolo={ruolo}
                membri={membri}
                aperto={apertoId === ruolo.id}
                apri={() => setApertoId((quale) => (quale === ruolo.id ? null : ruolo.id))}
                miei={miei}
                rileggi={rileggi}
                elimina={() => setDaEliminare(ruolo)}
              />
            ))}
          </div>
        )}

        {creando ? (
          <div className="flex gap-2">
            <input
              className={classiInput}
              value={nuovoNome}
              onChange={(e) => setNuovoNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void crea()
                if (e.key === 'Escape') setCreando(false)
              }}
              placeholder="Moderatori"
              maxLength={40}
              autoFocus
            />
            <Bottone tono="vivo" disabled={!nuovoNome.trim()} onClick={() => void crea()}>
              Crea
            </Bottone>
            <Bottone tono="fantasma" onClick={() => setCreando(false)}>
              Annulla
            </Bottone>
          </div>
        ) : (
          <Bottone tono="fantasma" onClick={() => setCreando(true)}>
            <Piu className="h-4 w-4" />
            Nuovo ruolo
          </Bottone>
        )}
      </Sezione>

      {daEliminare && (
        <Conferma
          titolo={`Elimini il ruolo ${daEliminare.nome}?`}
          testo="Chi ce l'aveva perde i permessi che dava, subito. Le eccezioni scritte per questo ruolo su categorie e canali spariscono con lui."
          azione="Elimina"
          tono="male"
          conferma={() => {
            const quale = daEliminare
            setDaEliminare(null)
            void api
              .eliminaRuolo(spazio.id, quale.id)
              .then(rileggi)
              .catch((e) => setErrore((e as Error).message))
          }}
          chiudi={() => setDaEliminare(null)}
        />
      )}
    </>
  )
}

function RigaRuolo({
  api,
  spazio,
  ruolo,
  membri,
  aperto,
  apri,
  miei,
  rileggi,
  elimina
}: {
  api: Api
  spazio: Spazio
  ruolo: Ruolo
  membri: Membro[] | null
  aperto: boolean
  apri: () => void
  miei: Permesso[]
  rileggi: () => void
  elimina: () => void
}): React.JSX.Element {
  const [nome, setNome] = useState(ruolo.nome)
  const [colore, setColore] = useState(ruolo.colore ?? '#6b7590')
  const [priorita, setPriorita] = useState(ruolo.priorita)
  const [permessi, setPermessi] = useState<Permesso[]>(ruolo.permessi)
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const modificabile = ruolo.tipo !== 'admin'
  const quanti = ruolo.tipo === 'base' ? (membri?.length ?? 0) : (ruolo.membri?.length ?? 0)

  const cambiato =
    nome !== ruolo.nome ||
    colore !== (ruolo.colore ?? '#6b7590') ||
    priorita !== ruolo.priorita ||
    permessi.join(',') !== ruolo.permessi.join(',')

  const salva = async (): Promise<void> => {
    setSalvando(true)
    setErrore(null)
    try {
      await api.aggiornaRuolo(spazio.id, ruolo.id, {
        nome: nome.trim() || ruolo.nome,
        colore,
        priorita: ruolo.tipo === 'custom' ? priorita : undefined,
        permessi: modificabile ? permessi : undefined
      })
      rileggi()
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-bordo bg-fondo-2">
      <button
        onClick={apri}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-fondo-3/50"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: ruolo.colore ?? 'var(--color-testo-3)' }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{ruolo.nome}</span>
          <span className="block text-[11px] text-testo-3">
            {ruolo.tipo === 'admin'
              ? 'Tutti i permessi, per costruzione'
              : ruolo.tipo === 'base'
                ? "Ce l'hanno tutti i membri"
                : `${ruolo.permessi.length} permessi`}
            {' · '}
            {quanti} {quanti === 1 ? 'persona' : 'persone'}
            {' · '}priorita' {ruolo.priorita}
          </span>
        </span>
        {ruolo.tipo === 'custom' && (
          <span
            role="button"
            tabIndex={0}
            title={`Elimina il ruolo ${ruolo.nome}`}
            className="shrink-0 text-testo-3 hover:text-male"
            onClick={(e) => {
              e.stopPropagation()
              elimina()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                elimina()
              }
            }}
          >
            <Cestino className="h-4 w-4" />
          </span>
        )}
      </button>

      {aperto && (
        <div className="space-y-4 border-t border-bordo p-3">
          {ruolo.tipo === 'admin' ? (
            <Avviso tono="neutro">
              Il ruolo Admin ha tutti i permessi per definizione, compresi quelli che verranno
              aggiunti in futuro. Non si modifica: per dare meno, si crea un ruolo apposta.
            </Avviso>
          ) : (
            <>
              <div className="flex gap-2">
                <label className="shrink-0">
                  <span className="mb-1.5 block text-xs font-medium tracking-wide text-testo-2 uppercase">
                    Colore
                  </span>
                  <input
                    type="color"
                    value={colore}
                    onChange={(e) => setColore(e.target.value)}
                    aria-label="Colore del ruolo"
                    className="h-9 w-14 cursor-pointer rounded-lg border border-bordo bg-fondo"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <Campo etichetta="Nome">
                    <input
                      className={classiInput}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      maxLength={40}
                    />
                  </Campo>
                </div>
              </div>

              {ruolo.tipo === 'custom' && (
                <Campo
                  etichetta={`Priorita': ${priorita}`}
                  aiuto="Piu' alta vince quando due eccezioni sullo stesso canale si contraddicono.
                    Master sta a 90, il ruolo base a 0."
                >
                  <input
                    type="range"
                    min={1}
                    max={89}
                    value={priorita}
                    onChange={(e) => setPriorita(Number(e.target.value))}
                    className="w-full"
                  />
                </Campo>
              )}

              <div className="space-y-4">
                {GRUPPI_PERMESSI.map((gruppo) => (
                  <div key={gruppo.id}>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
                      {gruppo.nome}
                    </p>
                    <div className="space-y-1.5">
                      {gruppo.permessi.map((p) => {
                        const posso = miei.includes(p.chiave)
                        const acceso = permessi.includes(p.chiave)
                        return (
                          <label
                            key={p.chiave}
                            className={`flex items-start gap-2.5 ${posso ? 'cursor-pointer' : 'opacity-40'}`}
                            title={posso ? undefined : 'Non puoi dare un permesso che non hai'}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-vivo"
                              checked={acceso}
                              disabled={!posso}
                              onChange={(e) =>
                                setPermessi((prima) =>
                                  e.target.checked
                                    ? [...prima, p.chiave]
                                    : prima.filter((x) => x !== p.chiave)
                                )
                              }
                            />
                            <span className="text-sm">
                              {p.nome}
                              {p.sotto && (
                                <span className="mt-0.5 block text-xs leading-relaxed text-testo-3">
                                  {p.sotto}
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {ruolo.tipo !== 'base' && ruolo.tipo !== 'admin' && (
            <ChiCeLHa api={api} spazio={spazio} ruolo={ruolo} membri={membri} rileggi={rileggi} />
          )}

          {errore && <Avviso>{errore}</Avviso>}

          {(modificabile || ruolo.tipo === 'master') && (
            <div className="flex items-center gap-2">
              <Bottone tono="vivo" disabled={!cambiato || salvando} onClick={() => void salva()}>
                {salvando ? 'Salvo…' : 'Salva'}
              </Bottone>
              {cambiato && (
                <Bottone
                  tono="fantasma"
                  onClick={() => {
                    setNome(ruolo.nome)
                    setColore(ruolo.colore ?? '#6b7590')
                    setPriorita(ruolo.priorita)
                    setPermessi(ruolo.permessi)
                  }}
                >
                  Annulla
                </Bottone>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Chi indossa questo ruolo, con il modo per aggiungerne e toglierne. */
function ChiCeLHa({
  api,
  spazio,
  ruolo,
  membri,
  rileggi
}: {
  api: Api
  spazio: Spazio
  ruolo: Ruolo
  membri: Membro[] | null
  rileggi: () => void
}): React.JSX.Element {
  const ha = new Set(ruolo.membri ?? [])
  const dentro = (membri ?? []).filter((m) => ha.has(m.id))
  const fuori = (membri ?? []).filter((m) => !ha.has(m.id))

  return (
    <Campo etichetta="Chi ce l'ha">
      <div className="space-y-1.5">
        {dentro.length === 0 ? (
          <p className="text-xs text-testo-3">Nessuno, per adesso.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {dentro.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-1 rounded-full border border-bordo px-2 py-0.5 text-[11px]"
              >
                {m.nome}
                <button
                  className="text-testo-3 hover:text-male"
                  title={`Togli ${ruolo.nome} a ${m.nome}`}
                  onClick={() => void api.togliRuolo(spazio.id, ruolo.id, m.id).then(rileggi)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {fuori.length > 0 && (
          <select
            className={classiInput}
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              void api.assegnaRuolo(spazio.id, ruolo.id, Number(e.target.value)).then(rileggi)
            }}
          >
            <option value="">Aggiungi qualcuno…</option>
            {fuori.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        )}
      </div>
    </Campo>
  )
}
