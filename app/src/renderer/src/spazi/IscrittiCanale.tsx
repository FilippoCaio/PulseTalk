import { useEffect, useState } from 'react'
import type { Canale, Profilo } from '@shared/tipi'
import type { Api, Membro } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Avviso, Bottone, BottoneIcona } from '../ui'
import { Chiudi, Espelli, Lucchetto, Piu } from '../icone'

/**
 * Chi sta dentro a un canale privato.
 *
 * Due elenchi e basta: chi c'e', e chi dello spazio si puo' ancora chiamare
 * dentro. Non c'e' una ricerca fra tutti gli utenti dell'istanza di proposito —
 * in un canale ci si sta solo se si sta nello spazio che lo contiene, e un
 * invito non deve essere una porta laterale per farci entrare qualcuno che nel
 * posto non c'era.
 *
 * Invitare puo' farlo chi e' gia' dentro, non solo chi amministra: in un gruppo
 * di amici il canale lo apre chi organizza qualcosa, e dover chiedere
 * all'amministratore del NAS il permesso di aggiungere una persona
 * trasformerebbe una cosa spiccia in una pratica. Togliere invece resta agli
 * admin — e a se stessi, che si esce sempre da soli.
 */
export default function IscrittiCanale({
  api,
  canale,
  spazio,
  amministra,
  io,
  chiudi
}: {
  api: Api
  canale: Canale
  spazio: number
  amministra: boolean
  /** Il proprio id: da un canale si esce anche senza essere admin. */
  io: number
  chiudi: () => void
}): React.JSX.Element {
  const [iscritti, setIscritti] = useState<Profilo[] | null>(null)
  const [membri, setMembri] = useState<Membro[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState<number | null>(null)

  const carica = async (): Promise<void> => {
    try {
      const [a, b] = await Promise.all([api.iscritti(canale.id), api.membri(spazio)])
      setIscritti(a.iscritti)
      setMembri(b.membri)
      setErrore(null)
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  useEffect(() => {
    void carica()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canale.id, spazio])

  const dentro = new Set((iscritti ?? []).map((i) => i.id))
  const daInvitare = (membri ?? []).filter((m) => !dentro.has(m.id))

  const invita = async (utente: number): Promise<void> => {
    setInCorso(utente)
    try {
      const { iscritti: nuovi } = await api.invitaNelCanale(canale.id, utente)
      setIscritti(nuovi)
      setErrore(null)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(null)
    }
  }

  const togli = async (utente: number): Promise<void> => {
    setInCorso(utente)
    try {
      await api.togliDalCanale(canale.id, utente)
      // Togliendo se stessi si perde il canale: da qui in poi non esiste piu',
      // e restare aperti su un pannello che parla di un posto che non c'e'
      // sarebbe la cosa piu' confusa possibile.
      if (utente === io) chiudi()
      else await carica()
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(null)
    }
  }

  return (
    <div
      className="velo absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="pannello flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-bordo px-5 py-4">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">
            <Lucchetto className="h-4 w-4 shrink-0 text-attenzione" />
            <span className="truncate">{canale.nome}</span>
          </h2>
          <BottoneIcona tono="fantasma" onClick={chiudi} title="Chiudi">
            <Chiudi />
          </BottoneIcona>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {errore && <Avviso>{errore}</Avviso>}

          <section className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-testo-2 uppercase">
              Dentro ({iscritti?.length ?? 0})
            </h3>
            {iscritti === null ? (
              <p className="respiro text-sm text-testo-3">carico…</p>
            ) : (
              iscritti.map((persona) => (
                <Riga key={persona.id} persona={persona}>
                  {(amministra || persona.id === io) && (
                    <BottoneIcona
                      tono="fantasma"
                      className="text-male"
                      disabled={inCorso === persona.id}
                      onClick={() => void togli(persona.id)}
                      title={persona.id === io ? 'Esci da questo canale' : `Togli ${persona.nome}`}
                    >
                      <Espelli className="h-4 w-4" />
                    </BottoneIcona>
                  )}
                </Riga>
              ))
            )}
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold tracking-wide text-testo-2 uppercase">
              Nello spazio, ma non qui
            </h3>
            {membri === null ? (
              <p className="respiro text-sm text-testo-3">carico…</p>
            ) : daInvitare.length === 0 ? (
              <p className="text-sm text-testo-3">Ci sono già tutti.</p>
            ) : (
              daInvitare.map((persona) => (
                <Riga key={persona.id} persona={persona}>
                  <BottoneIcona
                    tono="fantasma"
                    disabled={inCorso === persona.id}
                    onClick={() => void invita(persona.id)}
                    title={`Invita ${persona.nome}`}
                  >
                    <Piu className="h-4 w-4" />
                  </BottoneIcona>
                </Riga>
              ))
            )}
          </section>
        </div>

        <footer className="border-t border-bordo px-5 py-3">
          <Bottone tono="fantasma" onClick={chiudi}>
            Chiudi
          </Bottone>
        </footer>
      </div>
    </div>
  )
}

function Riga({
  persona,
  children
}: {
  persona: { id: number; nome: string; utente: string | null; avatar: string | null }
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-fondo-3">
      {persona.avatar ? (
        <img src={persona.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-black/75"
          style={{ background: coloreDi(`u${persona.id}`) }}
        >
          {inizialiDi(persona.nome)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm">
        {persona.nome}
        {persona.utente && <span className="text-testo-3"> @{persona.utente}</span>}
      </span>
      {children}
    </div>
  )
}
