import { useEffect, useState } from 'react'
import type { Conversazione, Profilo } from '@shared/tipi'
import type { Api } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import { classiInput } from '../ui'
import { Piu, Utenti } from '../icone'

/**
 * L'elenco delle conversazioni, al posto della colonna dei canali.
 *
 * In ordine di ultimo messaggio, non di quando la conversazione e' nata: la
 * domanda vera aprendo questa colonna e' "con chi stavo parlando", non "chi ho
 * conosciuto per primo".
 *
 * Quelle senza nemmeno un messaggio restano in fondo invece di sparire: una
 * conversazione appena aperta e ancora vuota deve restare visibile, o si
 * perderebbe proprio nel momento in cui si sta per scrivere.
 */
export default function ColonnaDiretti({
  api,
  conversazioni,
  apertaId,
  scegli,
  apriAmici,
  quandoApre
}: {
  api: Api
  conversazioni: Conversazione[]
  apertaId: number | null
  scegli: (conversazione: Conversazione) => void
  apriAmici: () => void
  /** Apre (o riapre) la conversazione con questa persona. */
  quandoApre: (utente: number) => void
}): React.JSX.Element {
  const [cercando, setCercando] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [tutti, setTutti] = useState<(Profilo & { stato?: string })[] | null>(null)

  useEffect(() => {
    if (!cercando || tutti !== null) return
    void api
      .utenti()
      .then((r) => setTutti(r.utenti))
      .catch(() => setTutti([]))
  }, [api, cercando, tutti])

  const gia = new Set(conversazioni.map((c) => c.con.id))
  const trovati = (tutti ?? []).filter(
    (u) =>
      !gia.has(u.id) &&
      (!filtro.trim() ||
        `${u.nome} ${u.utente ?? ''}`.toLowerCase().includes(filtro.trim().toLowerCase()))
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-bordo px-4 py-3">
        <h2 className="min-w-0 truncate font-medium">Messaggi diretti</h2>
        <button
          onClick={() => setCercando((v) => !v)}
          title="Scrivi a qualcuno"
          aria-label="Scrivi a qualcuno"
          className="shrink-0 text-testo-3 hover:text-testo"
        >
          <Piu className="h-4 w-4" />
        </button>
      </header>

      {cercando && (
        <div className="space-y-1 border-b border-bordo p-2">
          <input
            className={classiInput}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Cerca una persona"
            autoFocus
          />
          <div className="max-h-56 overflow-y-auto">
            {tutti === null ? (
              <p className="respiro px-2 py-2 text-xs text-testo-3">carico…</p>
            ) : trovati.length === 0 ? (
              <p className="px-2 py-2 text-xs text-testo-3">Nessuno da aggiungere.</p>
            ) : (
              trovati.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    quandoApre(u.id)
                    setCercando(false)
                    setFiltro('')
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-testo-2 hover:bg-fondo-3 hover:text-testo"
                >
                  <Faccia id={u.id} nome={u.nome} avatar={u.avatar} />
                  <span className="min-w-0 flex-1 truncate">{u.nome}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversazioni.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <Utenti className="h-6 w-6 text-testo-3" />
            <p className="text-sm text-testo-2">Nessuna conversazione.</p>
            <p className="text-xs text-testo-3">
              Con il + qui sopra si scrive a chiunque abbia un account su questo server.
            </p>
            <button className="text-xs text-vivo underline" onClick={apriAmici}>
              Guarda gli amici
            </button>
          </div>
        ) : (
          conversazioni.map((c) => (
            <button
              key={c.id}
              onClick={() => scegli(c)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                c.id === apertaId ? 'bg-fondo-3 text-testo' : 'text-testo-2 hover:bg-fondo-3/60'
              }`}
            >
              <span className="relative shrink-0">
                <Faccia id={c.con.id} nome={c.con.nome} avatar={c.con.avatar} grande />
                <PallinoStato stato={c.con.stato ?? 'offline'} className="h-3 w-3" fondo="var(--color-fondo-2)" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{c.con.nome}</span>
                {c.ultimo && (
                  <span className="block truncate text-xs text-testo-3">
                    {c.ultimo.eliminato ? 'messaggio rimosso' : c.ultimo.testo || 'allegato'}
                  </span>
                )}
              </span>

              {c.nonLetti > 0 && (
                <span className="numeri shrink-0 rounded-full bg-vivo px-1.5 py-0.5 text-[10px] font-semibold text-fondo">
                  {c.nonLetti > 99 ? '99+' : c.nonLetti}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function Faccia({
  id,
  nome,
  avatar,
  grande = false
}: {
  id: number
  nome: string
  avatar: string | null
  grande?: boolean
}): React.JSX.Element {
  const misura = grande ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]'
  return avatar ? (
    <img src={avatar} alt="" className={`${misura} rounded-full object-cover`} />
  ) : (
    <span
      className={`${misura} flex items-center justify-center rounded-full font-semibold text-black/75`}
      style={{ background: coloreDi(`u${id}`) }}
    >
      {inizialiDi(nome)}
    </span>
  )
}
