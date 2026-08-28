import { useEffect, useState } from 'react'
import type { Profilo } from '@shared/tipi'
import type { Api } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Avviso, Bottone } from '../ui'
import { Catena, Chiudi, Spunta, UtentiPiu } from '../icone'

/**
 * Chiamare qualcuno dentro alla stanza in cui si e' gia'.
 *
 * Il caso vero e' uno solo: si entra in un vocale, non c'e' nessuno, e la cosa
 * da fare adesso e' avvisare qualcuno. Finche' si e' da soli l'invito prende
 * il posto di un riquadro nella griglia — lo spazio c'e' comunque, e uno
 * schermo con una faccia sola e' esattamente il momento in cui l'unica cosa
 * utile da mostrare e' come farne arrivare un'altra. Appena entra qualcuno il
 * riquadro sparisce e resta il pulsantino nell'overlay: da li' in poi lo
 * spazio serve alle persone.
 *
 * Invitare vuol dire mandare un messaggio diretto. Non c'e' nessuna suoneria
 * per i canali — squillare a qualcuno che non ha chiesto niente e' una cosa
 * che si perdona una volta — e un messaggio arriva comunque, anche a chi in
 * questo momento e' via.
 */

/**
 * Il riquadro dell'invito, quando si e' da soli.
 *
 * Sta nella griglia insieme ai riquadri veri e ne prende la misura da fuori:
 * deve essere una tessera come le altre, non una scatola incollata di lato.
 */
export function RiquadroInvito({ invita }: { invita: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bordo bg-fondo-2 p-4 text-center">
      <p className="max-w-full text-sm text-testo-2">Non c&apos;e&apos; ancora nessun altro qui.</p>
      <Bottone tono="vivo" onClick={invita}>
        <UtentiPiu className="h-4 w-4" />
        Invita degli amici
      </Bottone>
      <p className="max-w-[24ch] text-[11px] leading-snug text-testo-3">
        Gli arriva un messaggio diretto, non uno squillo.
      </p>
    </div>
  )
}

/**
 * L'elenco degli amici, con accanto il pulsante che li chiama qui.
 *
 * Solo gli amici e nessuna ricerca fra tutti gli utenti: e' la stessa regola
 * degli inviti ai canali privati, e vale ancora di piu' qui, dove il messaggio
 * parte a nome di chi preme.
 */
export function PannelloInvito({
  api,
  nomeCanale,
  gia,
  chiudi
}: {
  api: Api
  /** Il nome della stanza, che finisce dentro al messaggio. */
  nomeCanale: string
  /** Gli id di chi e' gia' dentro: a loro non si manda niente. */
  gia: Set<number>
  chiudi: () => void
}): React.JSX.Element {
  const [amici, setAmici] = useState<Profilo[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState<number | null>(null)
  const [fatti, setFatti] = useState<number[]>([])
  const [copiato, setCopiato] = useState(false)

  const testo = `Sono in «${nomeCanale}» su PulseTalk: vieni?`

  useEffect(() => {
    void api
      .amici()
      .then((esito) => setAmici(esito.amici))
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  /**
   * Apre la conversazione — o ripesca quella che c'era — e ci lascia una riga.
   *
   * Due chiamate e non una perche' i messaggi diretti passano da un canale
   * come tutti gli altri: il primo passo serve a sapere qual e'.
   */
  const invita = async (persona: Profilo): Promise<void> => {
    setInCorso(persona.id)
    try {
      const { conversazione } = await api.apriConversazione({ utente: persona.id })
      if (!conversazione) throw new Error('Non riesco ad aprire la conversazione.')
      await api.scrivi(conversazione.canale, { testo })
      setFatti((prima) => [...prima, persona.id])
      setErrore(null)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(null)
    }
  }

  const copia = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(testo)
      setCopiato(true)
      window.setTimeout(() => setCopiato(false), 2000)
    } catch {
      setErrore('Il sistema non mi ha lasciato scrivere negli appunti: copialo a mano.')
    }
  }

  return (
    <div
      className="velo absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="pannello flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-bordo px-5 py-4">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">
            <UtentiPiu className="h-4 w-4 shrink-0 text-vivo" />
            <span className="truncate">Invita in «{nomeCanale}»</span>
          </h2>
          <button
            onClick={chiudi}
            title="Chiudi"
            aria-label="Chiudi"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
          >
            <Chiudi />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {errore && <Avviso>{errore}</Avviso>}

          {/* Detto prima di premere, non dopo: chi invita deve sapere che sta
              scrivendo a nome suo, e cosa c'e' scritto. */}
          <div className="space-y-2 rounded-lg border border-bordo bg-fondo px-3 py-2.5">
            <p className="text-[11px] tracking-wide text-testo-3 uppercase">Gli arriva questo</p>
            <p className="text-sm text-testo-2">{testo}</p>
            <Bottone tono="fantasma" className="py-1 text-xs" onClick={() => void copia()}>
              {copiato ? <Spunta className="h-3.5 w-3.5" /> : <Catena className="h-3.5 w-3.5" />}
              {copiato ? 'Copiato' : 'Copia il testo'}
            </Bottone>
          </div>

          {amici === null ? (
            <p className="respiro text-sm text-testo-3">carico…</p>
          ) : amici.length === 0 ? (
            <p className="text-sm text-testo-3">
              Non hai ancora nessun amico da chiamare. Si aggiungono dall&apos;icona degli amici
              nella barra a sinistra.
            </p>
          ) : (
            <section className="space-y-1">
              <h3 className="text-xs font-semibold tracking-wide text-testo-2 uppercase">
                Amici <span className="text-testo-3">({amici.length})</span>
              </h3>
              {amici.map((persona) => {
                const dentro = gia.has(persona.id)
                const fatto = fatti.includes(persona.id)
                return (
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

                    {dentro ? (
                      <span className="shrink-0 text-xs text-testo-3">gia&apos; qui</span>
                    ) : fatto ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-ok">
                        <Spunta className="h-3.5 w-3.5" />
                        invitato
                      </span>
                    ) : (
                      <Bottone
                        tono="vivo"
                        className="shrink-0 py-1 text-xs"
                        disabled={inCorso !== null}
                        onClick={() => void invita(persona)}
                      >
                        {inCorso === persona.id ? 'mando…' : 'Invita'}
                      </Bottone>
                    )}
                  </div>
                )
              })}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
