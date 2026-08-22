import { useEffect, useState } from 'react'
import type { Api, Bando, Membro } from '../../lib/api'
import type { Ruolo, Spazio, Utente } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { coloreDi, inizialiDi } from '../../lib/avatar'
import { Avviso, Bottone, classiInput, Conferma, Sezione } from '../../ui'
import { Chiudi, Piu, Stella } from '../../icone'

/**
 * Chi c'e' dentro, con quali ruoli, e chi non deve rientrare.
 *
 * I ruoli si mettono e si tolgono da qui perche' e' qui che si guarda una
 * persona: aprire la scheda del ruolo per aggiungerci qualcuno funziona quando
 * si sta organizzando la gerarchia, non quando e' appena entrato Marco e gli si
 * vuole dare i permessi di moderare.
 *
 * Entrambe le strade esistono, e portano alla stessa tabella.
 */
export default function Membri({
  api,
  spazio,
  io,
  membri,
  ruoli,
  rileggi
}: {
  api: Api
  spazio: Spazio
  io: Utente
  membri: Membro[] | null
  ruoli: Ruolo[] | null
  rileggi: () => void
}): React.JSX.Element {
  const [filtro, setFiltro] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [daCacciare, setDaCacciare] = useState<Membro | null>(null)
  const [daBandire, setDaBandire] = useState<Membro | null>(null)
  const [bandi, setBandi] = useState<Bando[] | null>(null)

  const gestisceRuoli = puo(spazio.permessiMiei, 'manageRoles')
  const caccia = puo(spazio.permessiMiei, 'kickMembers')
  const bandisce = puo(spazio.permessiMiei, 'banMembers')

  useEffect(() => {
    if (!bandisce) return
    void api
      .bandi(spazio.id)
      .then((r) => setBandi(r.bandi))
      .catch(() => setBandi([]))
  }, [api, spazio.id, bandisce])

  const con = <T,>(promessa: Promise<T>): void => {
    setErrore(null)
    void promessa.then(rileggi).catch((e) => setErrore((e as Error).message))
  }

  const cercati = (membri ?? []).filter((m) =>
    filtro.trim()
      ? `${m.nome} ${m.utente ?? ''}`.toLowerCase().includes(filtro.trim().toLowerCase())
      : true
  )

  // Il ruolo base non si assegna: ce l'hanno tutti per definizione.
  const assegnabili = (ruoli ?? []).filter((r) => r.tipo !== 'base')

  return (
    <>
      <Sezione titolo={`Membri (${membri?.length ?? 0})`} sotto="Chi c'e', e con quali ruoli.">
        {errore && <Avviso>{errore}</Avviso>}

        <input
          className={classiInput}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Cerca per nome"
        />

        {membri === null ? (
          <p className="respiro text-sm text-testo-3">carico…</p>
        ) : (
          <div className="space-y-1">
            {cercati.map((membro) => (
              <div
                key={membro.id}
                className="group flex items-start gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-bordo hover:bg-fondo-2"
              >
                {membro.avatar ? (
                  <img src={membro.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-black/75"
                    style={{ background: coloreDi(`u${membro.id}`) }}
                  >
                    {inizialiDi(membro.nome)}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm">
                    <span className="truncate">{membro.nome}</span>
                    {membro.proprietario && (
                      <span title="Proprietario del server" className="shrink-0 text-attenzione">
                        <Stella className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {membro.utente && (
                      <span className="shrink-0 text-xs text-testo-3">@{membro.utente}</span>
                    )}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {membro.ruoli.map((r) => (
                      <span
                        key={r.id}
                        className="flex items-center gap-1 rounded-full border border-bordo px-2 py-0.5 text-[11px] text-testo-2"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: r.colore ?? 'var(--color-testo-3)' }}
                        />
                        {r.nome}
                        {gestisceRuoli && (
                          <button
                            title={`Togli ${r.nome} a ${membro.nome}`}
                            aria-label={`Togli ${r.nome}`}
                            className="text-testo-3 hover:text-male"
                            onClick={() => con(api.togliRuolo(spazio.id, r.id, membro.id))}
                          >
                            <Chiudi className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </span>
                    ))}

                    {gestisceRuoli && assegnabili.some((r) => !membro.ruoli.some((s) => s.id === r.id)) && (
                      <select
                        value=""
                        aria-label={`Aggiungi un ruolo a ${membro.nome}`}
                        onChange={(e) => {
                          if (!e.target.value) return
                          con(api.assegnaRuolo(spazio.id, Number(e.target.value), membro.id))
                        }}
                        className="rounded-full border border-dashed border-bordo bg-transparent px-2 py-0.5 text-[11px] text-testo-3 hover:border-vivo hover:text-vivo"
                      >
                        <option value="">+ ruolo</option>
                        {assegnabili
                          .filter((r) => !membro.ruoli.some((s) => s.id === r.id))
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.nome}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                </div>

                {membro.id !== io.id && !membro.proprietario && (
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {caccia && (
                      <Bottone
                        tono="fantasma"
                        className="py-1 text-xs"
                        onClick={() => setDaCacciare(membro)}
                      >
                        Caccia
                      </Bottone>
                    )}
                    {bandisce && (
                      <Bottone
                        tono="male"
                        className="py-1 text-xs"
                        onClick={() => setDaBandire(membro)}
                      >
                        Bandisci
                      </Bottone>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Sezione>

      {bandisce && (
        <Sezione
          titolo={`Banditi (${bandi?.length ?? 0})`}
          sotto="Non rientrano nemmeno con un invito valido, finche' non li si perdona."
        >
          {bandi === null ? (
            <p className="respiro text-sm text-testo-3">carico…</p>
          ) : bandi.length === 0 ? (
            <p className="text-sm text-testo-3">Nessuno.</p>
          ) : (
            <div className="space-y-1">
              {bandi.map((bando) => (
                <div
                  key={bando.utente}
                  className="flex items-center gap-3 rounded-lg border border-bordo bg-fondo-2 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{bando.nome}</span>
                    {bando.motivo && (
                      <span className="block truncate text-xs text-testo-3">{bando.motivo}</span>
                    )}
                  </span>
                  <Bottone
                    tono="fantasma"
                    className="py-1 text-xs"
                    onClick={() =>
                      void api
                        .perdona(spazio.id, bando.utente)
                        .then(() => setBandi((b) => (b ?? []).filter((x) => x.utente !== bando.utente)))
                        .catch((e) => setErrore((e as Error).message))
                    }
                  >
                    Perdona
                  </Bottone>
                </div>
              ))}
            </div>
          )}
        </Sezione>
      )}

      {puo(spazio.permessiMiei, 'manageMembers') && (
        <AggiungiMembro api={api} spazio={spazio} membri={membri} quandoFatto={rileggi} />
      )}

      {daCacciare && (
        <Conferma
          titolo={`Cacci ${daCacciare.nome}?`}
          testo="Esce subito da qui, anche se sta parlando in un canale vocale. Puo' rientrare con un nuovo invito."
          azione="Caccia"
          tono="male"
          conferma={() => {
            con(api.cacciaMembro(spazio.id, daCacciare.id))
            setDaCacciare(null)
          }}
          chiudi={() => setDaCacciare(null)}
        />
      )}

      {daBandire && (
        <Conferma
          titolo={`Bandisci ${daBandire.nome}?`}
          testo="Esce subito e non rientra: nemmeno con un invito valido, finche' non lo perdoni."
          azione="Bandisci"
          tono="male"
          conferma={() => {
            con(
              api.bandisci(spazio.id, daBandire.id).then(() =>
                api.bandi(spazio.id).then((r) => setBandi(r.bandi))
              )
            )
            setDaBandire(null)
          }}
          chiudi={() => setDaBandire(null)}
        />
      )}
    </>
  )
}

/**
 * Aggiungere qualcuno senza passare da un invito.
 *
 * Serve a chi ha aperto uno spazio a porte chiuse e vuole tirarci dentro tre
 * persone che gia' hanno un account: mandargli un codice sarebbe un giro in
 * piu' per una cosa che si sa gia' di voler fare.
 */
function AggiungiMembro({
  api,
  spazio,
  membri,
  quandoFatto
}: {
  api: Api
  spazio: Spazio
  membri: Membro[] | null
  quandoFatto: () => void
}): React.JSX.Element {
  const [tutti, setTutti] = useState<{ id: number; nome: string; utente: string | null }[] | null>(
    null
  )
  const [scelto, setScelto] = useState<number | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    void api
      .utenti()
      .then((r) => setTutti(r.utenti))
      .catch(() => setTutti([]))
  }, [api])

  const dentro = new Set((membri ?? []).map((m) => m.id))
  const fuori = (tutti ?? []).filter((u) => !dentro.has(u.id))

  return (
    <Sezione titolo="Aggiungi qualcuno" sotto="Chi ha gia' un account su questo server.">
      {fuori.length === 0 ? (
        <p className="text-sm text-testo-3">Ci sono gia' dentro tutti.</p>
      ) : (
        <div className="flex gap-2">
          <select
            className={classiInput}
            value={scelto ?? ''}
            onChange={(e) => setScelto(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Scegli una persona…</option>
            {fuori.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} {u.utente ? `(@${u.utente})` : ''}
              </option>
            ))}
          </select>
          <Bottone
            tono="normale"
            disabled={!scelto}
            onClick={() => {
              if (!scelto) return
              setErrore(null)
              void api
                .aggiungiMembro(spazio.id, scelto)
                .then(() => {
                  setScelto(null)
                  quandoFatto()
                })
                .catch((e) => setErrore((e as Error).message))
            }}
          >
            <Piu className="h-4 w-4" />
            Aggiungi
          </Bottone>
        </div>
      )}
      {errore && <Avviso>{errore}</Avviso>}
    </Sezione>
  )
}
