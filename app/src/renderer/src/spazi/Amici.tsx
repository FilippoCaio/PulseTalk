import { useState } from 'react'
import type { Amicizie, Profilo } from '@shared/tipi'
import type { Api } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Avviso, Bottone, BottoneIcona, Campo, classiInput } from '../ui'
import { Campanella, CampanellaSpenta, Chiudi, Espelli, Spunta, Utenti } from '../icone'

/**
 * Gli amici.
 *
 * Tre elenchi: chi lo e', chi te lo ha chiesto, e a chi lo hai chiesto tu. Si
 * aggiunge qualcuno con il suo nome utente — quello con la chiocciola, unico e
 * senza spazi — perche' i nomi visibili si ripetono e scegliere fra tre "Marco"
 * in un elenco e' il modo migliore per mandare la richiesta alla persona
 * sbagliata.
 *
 * Essere amici non apre nessuna porta: non da' accesso a uno spazio ne' a un
 * canale privato. Serve ad avere sottomano le persone che si invitano piu'
 * spesso, e a sapere chi c'e'. Un permesso che si eredita dall'amicizia
 * sarebbe un permesso che nessuno ha mai concesso davvero, ed e' il modo in cui
 * ci si ritrova dentro a stanze in cui non si doveva entrare.
 */
export default function Amici({
  api,
  amicizie,
  avvisi,
  alternaAvviso,
  ricarica,
  chiudi
}: {
  api: Api
  amicizie: Amicizie | null
  /** Gli id delle persone da annunciare quando entrano in un vocale. */
  avvisi: number[]
  alternaAvviso: (utente: number) => void
  ricarica: () => void
  chiudi: () => void
}): React.JSX.Element {
  const [nomeUtente, setNomeUtente] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [esito, setEsito] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)

  const fai = async (azione: () => Promise<unknown>, detto?: string): Promise<void> => {
    setInCorso(true)
    setErrore(null)
    setEsito(null)
    try {
      await azione()
      if (detto) setEsito(detto)
      ricarica()
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  const chiedi = (): void => {
    const pulito = nomeUtente.trim().replace(/^@/, '').toLowerCase()
    if (!pulito) return
    void fai(async () => {
      await api.chiediAmicizia({ nomeUtente: pulito })
      setNomeUtente('')
    }, 'Richiesta mandata.')
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
        <header className="flex items-center justify-between border-b border-bordo px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Utenti className="h-4 w-4 text-testo-3" />
            Amici
          </h2>
          <BottoneIcona tono="fantasma" onClick={chiudi} title="Chiudi">
            <Chiudi />
          </BottoneIcona>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {errore && <Avviso>{errore}</Avviso>}
          {esito && <Avviso tono="neutro">{esito}</Avviso>}

          <Campo
            etichetta="Aggiungi per nome utente"
            aiuto="Quello con la chiocciola, non il nome visibile: e' unico, e non si sbaglia persona."
          >
            <div className="flex gap-2">
              <input
                className={classiInput}
                value={nomeUtente}
                onChange={(e) => setNomeUtente(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && chiedi()}
                placeholder="@marco"
                spellCheck={false}
              />
              <Bottone tono="vivo" disabled={inCorso || !nomeUtente.trim()} onClick={chiedi}>
                Chiedi
              </Bottone>
            </div>
          </Campo>

          {amicizie === null ? (
            <p className="respiro text-sm text-testo-3">carico…</p>
          ) : (
            <>
              <Elenco
                titolo="Ti hanno chiesto"
                persone={amicizie.ricevute}
                vuoto="Nessuna richiesta in attesa."
              >
                {(persona) => (
                  <>
                    <BottoneIcona
                      tono="acceso"
                      disabled={inCorso}
                      onClick={() => void fai(() => api.accettaAmicizia(persona.id))}
                      title={`Accetta ${persona.nome}`}
                    >
                      <Spunta className="h-4 w-4" />
                    </BottoneIcona>
                    <BottoneIcona
                      tono="fantasma"
                      className="text-male"
                      disabled={inCorso}
                      onClick={() => void fai(() => api.togliAmicizia(persona.id))}
                      title={`Rifiuta ${persona.nome}`}
                    >
                      <Chiudi className="h-4 w-4" />
                    </BottoneIcona>
                  </>
                )}
              </Elenco>

              <Elenco titolo="Amici" persone={amicizie.amici} vuoto="Ancora nessuno.">
                {(persona) => (
                  <>
                    {/* La campanella e' per persona e non per canale: quello
                        che si aspetta e' che torni *lei*, non che si accenda
                        una stanza. */}
                    <BottoneIcona
                      tono={avvisi.includes(persona.id) ? 'acceso' : 'fantasma'}
                      onClick={() => alternaAvviso(persona.id)}
                      title={
                        avvisi.includes(persona.id)
                          ? `Smetti di avvisarmi quando entra ${persona.nome}`
                          : `Avvisami quando ${persona.nome} entra in un vocale`
                      }
                    >
                      {avvisi.includes(persona.id) ? (
                        <Campanella className="h-4 w-4" />
                      ) : (
                        <CampanellaSpenta className="h-4 w-4" />
                      )}
                    </BottoneIcona>

                    <BottoneIcona
                      tono="fantasma"
                      className="text-male"
                      disabled={inCorso}
                      onClick={() => void fai(() => api.togliAmicizia(persona.id))}
                      title={`Smetti di essere amico di ${persona.nome}`}
                    >
                      <Espelli className="h-4 w-4" />
                    </BottoneIcona>
                  </>
                )}
              </Elenco>

              <Elenco
                titolo="In attesa di risposta"
                persone={amicizie.inviate}
                vuoto="Nessuna richiesta mandata."
              >
                {(persona) => (
                  <BottoneIcona
                    tono="fantasma"
                    disabled={inCorso}
                    onClick={() => void fai(() => api.togliAmicizia(persona.id))}
                    title={`Annulla la richiesta a ${persona.nome}`}
                  >
                    <Chiudi className="h-4 w-4" />
                  </BottoneIcona>
                )}
              </Elenco>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Elenco({
  titolo,
  persone,
  vuoto,
  children
}: {
  titolo: string
  persone: Profilo[]
  vuoto: string
  children: (persona: Profilo) => React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold tracking-wide text-testo-2 uppercase">
        {titolo}
        {persone.length > 0 && <span className="text-testo-3"> ({persone.length})</span>}
      </h3>

      {persone.length === 0 ? (
        <p className="text-sm text-testo-3">{vuoto}</p>
      ) : (
        persone.map((persona) => (
          <div
            key={persona.id}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-fondo-3"
          >
            {persona.avatar ? (
              <img
                src={persona.avatar}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
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
            {children(persona)}
          </div>
        ))
      )}
    </section>
  )
}
