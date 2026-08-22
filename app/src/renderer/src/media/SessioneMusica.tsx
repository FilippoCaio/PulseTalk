import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BranoTrovato,
  CollegamentoProvider,
  Impostazioni,
  ProviderMusica,
  SessioneMedia
} from '@shared/tipi'
import type { Api } from '../lib/api'
import type { SessioniMedia } from '../lib/usaSessioniMedia'
import { ponte } from '../ponte'
import { Avviso, Bottone, classiInput } from '../ui'
import { Avanti, Cestino, Chiudi, Nota, Pausa, Play } from '../icone'

/**
 * Ascoltare insieme.
 *
 * Cosa fa PulseTalk e cosa fa il servizio, perche' la differenza spiega tutto
 * il resto:
 *
 *   **PulseTalk** tiene la sessione: la coda condivisa, chi ha aggiunto cosa,
 *   quale brano sta suonando e da che punto. E' roba nostra, sta sul NAS, e
 *   funziona anche per chi non ha collegato nessun account — vede la coda, vede
 *   cosa sta suonando, ci puo' aggiungere brani.
 *
 *   **Il provider** (oggi Spotify) suona. Su ogni computer, con l'applicazione
 *   che quella persona ha gia' aperta, attraverso l'API ufficiale.
 *
 * Perche' non una "Jam" vera: Spotify non ha nessuna API pubblica per le
 * sessioni condivise. Non esiste modo di farla creare da un programma, e
 * arrivarci vorrebbe dire API private o reverse engineering — cose che qui non
 * entrano. Quindi si fa l'unica cosa che l'API ufficiale consente: si comanda
 * il player di chi ha dato il permesso, e lo si tiene al passo con la sessione.
 *
 * Le conseguenze, dette prima invece che scoperte premendo:
 *   - i comandi di riproduzione richiedono Spotify Premium;
 *   - serve avere Spotify aperto da qualche parte;
 *   - la sincronizzazione non e' campione-esatta: fra il comando e il player
 *     di quella persona c'e' internet.
 */
export default function SessioneMusica({
  api,
  sessione,
  media,
  puoComandare,
  impostazioni,
  salva,
  chiudi
}: {
  api: Api
  sessione: SessioneMedia
  media: SessioniMedia
  puoComandare: boolean
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  chiudi: () => void
}): React.JSX.Element {
  const provider = sessione.provider ?? 'spotify'

  const [stato, setStato] = useState<{
    provider: ProviderMusica[]
    collegamenti: CollegamentoProvider[]
  } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [risultati, setRisultati] = useState<BranoTrovato[] | null>(null)
  const [cercando, setCercando] = useState(false)
  const [dispositivi, setDispositivi] = useState<{ id: string; nome: string; attivo: boolean }[]>([])

  /** L'ultimo stato applicato al proprio player: evita di ricomandarlo uguale. */
  const applicato = useRef<string>('')

  const leggiStato = useCallback(() => {
    void api
      .musica()
      .then(setStato)
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  useEffect(leggiStato, [leggiStato])

  const suoProvider = stato?.provider.find((p) => p.nome === provider) ?? null
  const collegato = stato?.collegamenti.find((c) => c.provider === provider) ?? null
  // Dal 2026 Spotify puo' omettere `product` da /me per le app in Development
  // Mode. Null quindi significa "non dichiarato", non "account gratuito": si
  // prova il comando e si lascia all'API Player l'eventuale 403 esplicito.
  const nonPremium = collegato?.prodotto === 'free'

  // -- Tenere il proprio player al passo --------------------------------------

  useEffect(() => {
    if (!collegato || nonPremium) return

    const s = sessione.stato
    const posizione = Math.floor(media.posizioneAttesa(sessione))

    // Una firma dello stato: cambia quando cambia il brano o quando si passa
    // da fermo a in movimento. Non contiene la posizione, o si manderebbe un
    // comando al secondo per il solo scorrere del tempo.
    const firma = `${s.riferimento ?? ''}|${s.inRiproduzione ? 1 : 0}|${s.aggiornato ?? 0}`
    if (firma === applicato.current) return
    applicato.current = firma

    void api
      .allineaMusica(provider, {
        riferimento: s.riferimento ?? null,
        posizioneMs: posizione,
        inRiproduzione: !!s.inRiproduzione,
        dispositivo: impostazioni.dispositivoMusica
      })
      .catch((e) => setErrore((e as Error).message))
  }, [api, provider, sessione, collegato, nonPremium, media, impostazioni.dispositivoMusica])

  // -- Cercare ----------------------------------------------------------------

  const cercaBrani = async (): Promise<void> => {
    if (!cerca.trim()) return
    setCercando(true)
    setErrore(null)
    try {
      const r = await api.cercaBrani(provider, cerca.trim())
      setRisultati(r.risultati)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setCercando(false)
    }
  }

  const collega = async (): Promise<void> => {
    setErrore(null)
    try {
      const { autorizzazione } = await api.collegaMusica(provider)
      // Nel browser di sistema, non in una finestra dell'app: e' una pagina di
      // accesso di terzi, e va vista con la barra degli indirizzi davanti.
      await ponte.apriEsterno(autorizzazione)
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  const s = sessione.stato

  if (!suoProvider) {
    return <p className="respiro text-sm text-testo-3">carico…</p>
  }

  if (!suoProvider.configurato) {
    return (
      <div className="space-y-3">
        <Avviso tono="attenzione">
          Questo server non ha le credenziali di {suoProvider.etichetta}. Chi lo amministra deve
          metterle nel <code>.env</code> (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
          SPOTIFY_REDIRECT_URI) e riavviarlo.
        </Avviso>
        <p className="text-xs text-testo-3">
          La coda condivisa funziona lo stesso: si puo' compilare insieme, e chi vuole ascoltare
          apre i brani a mano.
        </p>
        <Coda sessione={sessione} media={media} puoComandare={puoComandare} />
        <Bottone tono="fantasma" onClick={chiudi}>
          <Chiudi className="h-4 w-4" />
          Chiudi la sessione
        </Bottone>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* -- Il collegamento ------------------------------------------- */}
      {!collegato ? (
        <div className="rounded-xl border border-bordo bg-fondo-2 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Nota className="h-4 w-4" />
            Collega {suoProvider.etichetta}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-testo-3">
            Serve a far suonare la musica sul tuo computer. Senza, resti nella sessione e vedi la
            coda: semplicemente non parte niente da qui.
          </p>
          <Bottone tono="vivo" className="mt-3" onClick={() => void collega()}>
            Collega
          </Bottone>
          <button className="mt-2 block text-xs text-testo-3 underline" onClick={leggiStato}>
            Ho gia' autorizzato: ricontrolla
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-bordo bg-fondo-2 px-3 py-2">
          <Nota className="h-4 w-4 shrink-0 text-ok" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {collegato.nome ?? suoProvider.etichetta}
            {nonPremium && (
              <span className="ml-2 text-xs text-attenzione">account non Premium</span>
            )}
          </span>
          <button
            className="text-xs text-testo-3 underline hover:text-testo"
            onClick={() => {
              void api.scollegaMusica(provider).then(leggiStato)
            }}
          >
            Scollega
          </button>
        </div>
      )}

      {collegato && nonPremium && (
        <Avviso tono="attenzione">
          {suoProvider.limiti?.premium ??
            'I comandi di riproduzione richiedono un account Premium.'}{' '}
          La coda condivisa funziona lo stesso: vedi cosa suona e puoi aggiungere brani.
        </Avviso>
      )}

      {errore && <Avviso>{errore}</Avviso>}
      {media.errore && <Avviso>{media.errore}</Avviso>}

      {/* -- Cosa sta suonando ----------------------------------------- */}
      <div className="rounded-xl border border-bordo bg-fondo-2 p-3">
        {s.riferimento ? (
          <>
            <p className="truncate text-sm font-medium">{s.titolo || s.riferimento}</p>
            <p className="numeri mt-0.5 text-xs text-testo-3">
              {formatta(media.posizioneAttesa(sessione))}
              {s.durataMs ? ` / ${formatta(s.durataMs)}` : ''}
              {s.inRiproduzione ? '' : ' · in pausa'}
            </p>
          </>
        ) : (
          <p className="text-sm text-testo-3">Niente in riproduzione.</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {puoComandare ? (
            <>
              <Bottone
                tono={s.inRiproduzione ? 'normale' : 'vivo'}
                disabled={!s.riferimento}
                onClick={() =>
                  void media.comanda(sessione.id, { azione: s.inRiproduzione ? 'pausa' : 'play' })
                }
              >
                {s.inRiproduzione ? <Pausa className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {s.inRiproduzione ? 'Pausa' : 'Riprendi'}
              </Bottone>
              <Bottone
                tono="fantasma"
                disabled={sessione.coda.length === 0}
                onClick={() => void media.comanda(sessione.id, { azione: 'prossimo' })}
              >
                <Avanti className="h-4 w-4" />
                Prossimo
              </Bottone>
            </>
          ) : (
            <span className="text-xs text-testo-3">
              I comandi sono di chi ha il permesso di condividere. Puoi aggiungere brani alla coda.
            </span>
          )}

          <span className="flex-1" />

          <Bottone tono="fantasma" className="py-1 text-xs" onClick={chiudi}>
            <Chiudi className="h-3.5 w-3.5" />
            Chiudi
          </Bottone>
        </div>
      </div>

      {/* -- Dove suona ------------------------------------------------ */}
      {collegato && !nonPremium && (
        <div className="flex items-center gap-2">
          <select
            className={`${classiInput} text-xs`}
            value={impostazioni.dispositivoMusica ?? ''}
            onChange={(e) => salva({ dispositivoMusica: e.target.value || null })}
            onFocus={() => {
              void api
                .dispositiviMusica(provider)
                .then((r) => setDispositivi(r.dispositivi))
                .catch(() => setDispositivi([]))
            }}
            aria-label="Dove suona la musica"
          >
            <option value="">Dispositivo attivo</option>
            {dispositivi.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
                {d.attivo ? ' (attivo)' : ''}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-testo-3">
            {suoProvider.limiti?.dispositivo ?? ''}
          </span>
        </div>
      )}

      {/* -- Cercare e accodare ---------------------------------------- */}
      {collegato && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className={classiInput}
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void cercaBrani()}
              placeholder="Cerca un brano"
            />
            <Bottone tono="normale" disabled={!cerca.trim() || cercando} onClick={() => void cercaBrani()}>
              {cercando ? 'Cerco…' : 'Cerca'}
            </Bottone>
          </div>

          {risultati !== null && (
            <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-bordo bg-fondo-2 p-2">
              {risultati.length === 0 ? (
                <p className="px-1 py-2 text-xs text-testo-3">Niente.</p>
              ) : (
                risultati.map((brano) => (
                  <div
                    key={brano.riferimento}
                    className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-fondo-3/60"
                  >
                    {brano.copertina && (
                      <img src={brano.copertina} alt="" className="h-8 w-8 shrink-0 rounded" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{brano.titolo}</span>
                      <span className="block truncate text-xs text-testo-3">{brano.artista}</span>
                    </span>
                    <Bottone
                      tono="fantasma"
                      className="shrink-0 py-1 text-xs"
                      onClick={() =>
                        void media.accoda(sessione.id, {
                          riferimento: brano.riferimento,
                          titolo: `${brano.titolo} — ${brano.artista}`,
                          durata: brano.durata
                        })
                      }
                    >
                      In coda
                    </Bottone>
                    {puoComandare && (
                      <Bottone
                        tono="vivo"
                        className="shrink-0 py-1 text-xs"
                        onClick={() =>
                          void media.comanda(sessione.id, {
                            azione: 'cambia',
                            riferimento: brano.riferimento,
                            titolo: `${brano.titolo} — ${brano.artista}`,
                            durataMs: brano.durata ?? 0
                          })
                        }
                      >
                        Suona
                      </Bottone>
                    )}
                  </div>
                ))
              )}
              {risultati.length >= 10 && (
                <p className="px-1 pt-1 text-[11px] text-testo-3">
                  {suoProvider.limiti?.ricerca ?? 'Al massimo dieci risultati per ricerca.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <Coda sessione={sessione} media={media} puoComandare={puoComandare} />

      {suoProvider.limiti?.jam && (
        <p className="text-[11px] leading-relaxed text-testo-3">{suoProvider.limiti.jam}</p>
      )}
    </div>
  )
}

/** La coda condivisa: si legge sempre, anche senza nessun account collegato. */
function Coda({
  sessione,
  media,
  puoComandare
}: {
  sessione: SessioneMedia
  media: SessioniMedia
  puoComandare: boolean
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-bordo bg-fondo-2 p-2">
      <p className="mb-1 px-1 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
        Coda condivisa ({sessione.coda.filter((v) => !v.suonato).length})
      </p>
      {sessione.coda.length === 0 ? (
        <p className="px-1 py-2 text-xs text-testo-3">
          Vuota. Chi e' in chiamata puo' aggiungere brani, anche senza poter comandare.
        </p>
      ) : (
        sessione.coda.map((voce) => (
          <div
            key={voce.id}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-fondo-3/50 ${
              voce.suonato ? 'text-testo-3 line-through' : 'text-testo-2'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{voce.titolo || voce.riferimento}</span>
            {voce.nomeAggiunto && (
              <span className="shrink-0 text-[11px] text-testo-3">da {voce.nomeAggiunto}</span>
            )}
            {puoComandare && (
              <button
                onClick={() => void media.togliDallaCoda(sessione.id, voce.id)}
                title="Togli dalla coda"
                aria-label="Togli dalla coda"
                className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
              >
                <Cestino className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

/** Millisecondi in m:ss. */
function formatta(ms: number): string {
  const totale = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(totale / 60)}:${String(totale % 60).padStart(2, '0')}`
}
