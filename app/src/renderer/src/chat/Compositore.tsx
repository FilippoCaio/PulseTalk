import { useEffect, useRef, useState } from 'react'
import type { Allegato, Canale, Messaggio } from '@shared/tipi'
import type { Api, RisultatoGif, RisultatoImmagineWeb } from '../lib/api'
import { Avviso } from '../ui'
import { Chiudi, Globo, Graffetta, Immagine, Lente, Scintille } from '../icone'

/**
 * Dove si scrive.
 *
 * Gli allegati partono **prima** del messaggio: si trascina un'immagine, il
 * caricamento comincia subito, e intanto si finisce la frase. Al momento
 * dell'invio restano da mandare solo gli id — che e' anche il motivo per cui
 * premere Invio con una foto da dieci megabyte non fa aspettare nessuno.
 */
/**
 * Quanto puo' pesare un allegato.
 *
 * E' lo stesso tetto del server (`TALK_MAX_ALLEGATO`, 4 GB di serie).
 * Ripeterlo qui non e' una duplicazione inutile: e' cio' che permette di dirlo
 * prima di spedire, invece di far aspettare il caricamento di un file troppo
 * grande per poi rifiutarlo. Se di la' cambia, qui si vede solo un messaggio
 * un po' meno preciso — non si rompe niente.
 */
const ALLEGATO_MAX = 4 * 1024 * 1024 * 1024

const inMega = (byte: number): string =>
  byte >= 1024 * 1024 * 1024
    ? `${(byte / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${Math.round(byte / (1024 * 1024))} MB`

export default function Compositore({
  api,
  canale,
  rispondiA,
  profili,
  annullaRisposta,
  manda,
  margine = ''
}: {
  api: Api
  canale: Canale
  rispondiA: Messaggio | null
  profili: Map<number, { nome: string; avatar: string | null }>
  annullaRisposta: () => void
  manda: (dati: { testo?: string; allegati?: number[] }) => Promise<void>
  /**
   * Classi di margine sinistro, per allinearsi al resto della chat.
   *
   * Arriva da fuori invece di essere decisa qui perche' dipende da cosa c'e'
   * a sinistra della chat, che il compositore non puo' sapere: vedi
   * `accantoAllaLinguetta` in `Chat`.
   */
  margine?: string
}): React.JSX.Element {
  const [testo, setTesto] = useState('')
  const [allegati, setAllegati] = useState<Allegato[]>([])
  const [inCaricamento, setInCaricamento] = useState(0)
  const [avanzamento, setAvanzamento] = useState<{
    nome: string
    fatto: number
    totale: number
  } | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [sopra, setSopra] = useState(false)
  const [gifAperte, setGifAperte] = useState(false)
  const [gifDisponibili, setGifDisponibili] = useState<boolean | null>(null)
  const [cercaGif, setCercaGif] = useState('')
  const [gif, setGif] = useState<RisultatoGif[]>([])
  const [gifCaricando, setGifCaricando] = useState(false)
  // Chi ha servito questi risultati. Le condizioni d'uso di Tenor e di GIPHY
  // chiedono tutte e due che si veda, e non e' sempre lo stesso.
  const [attribuzioneGif, setAttribuzioneGif] = useState('')
  const [modo, setModo] = useState<'normale' | 'ai-chat' | 'ai-immagine'>('normale')
  const [ai, setAi] = useState<{
    chat: boolean
    immagini: boolean
    ricercaWeb: boolean
    ricercaImmagini: boolean
  } | null>(null)
  const [aiInCorso, setAiInCorso] = useState(false)
  const [immaginiAperte, setImmaginiAperte] = useState(false)
  const [queryImmagini, setQueryImmagini] = useState('')
  const [immagini, setImmagini] = useState<RisultatoImmagineWeb[]>([])
  const [immaginiCaricando, setImmaginiCaricando] = useState(false)
  // Se non funziona niente, la riga dei modi non si disegna affatto.
  const qualcheAi = Boolean(ai && (ai.chat || ai.immagini || ai.ricercaWeb || ai.ricercaImmagini))
  const annullaAi = useRef<AbortController | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let vivo = true
    void api
      .servizi()
      .then((s) => vivo && setAi(s.ai))
      .catch(
        () =>
          vivo &&
          setAi({ chat: false, immagini: false, ricercaWeb: false, ricercaImmagini: false })
      )
    return () => {
      vivo = false
      annullaAi.current?.abort()
    }
  }, [api])

  const carica = async (scelti: FileList | File[]): Promise<void> => {
    setErrore(null)
    for (const scelto of Array.from(scelti)) {
      // Il peso si guarda PRIMA di partire.
      //
      // Senza questo controllo un file da quattro giga veniva spedito per
      // intero, e la risposta era un "413" secco: un numero che non dice
      // quanto era grande il file, ne' quanto poteva esserlo. E nel frattempo
      // si era aspettato per niente.
      if (scelto.size > ALLEGATO_MAX) {
        setErrore(
          `${scelto.name} pesa ${inMega(scelto.size)} e il limite e' ${inMega(ALLEGATO_MAX)}. ` +
            'Per file grossi conviene un collegamento invece dell\'allegato.'
        )
        continue
      }

      setInCaricamento((n) => n + 1)
      try {
        // La percentuale non e' un vezzo: un file da un giga sale in minuti, e
        // senza un numero che si muove l'unica cosa che si vede e' un'app che
        // non risponde. Arriva solo dai caricamenti a pezzi — sotto agli otto
        // mega non fa in tempo a servire.
        const allegato = await api.carica(scelto, (fatto) =>
          setAvanzamento({ nome: scelto.name, fatto, totale: scelto.size })
        )
        setAllegati((prima) => [...prima, allegato])
      } catch (e) {
        setErrore(`${scelto.name}: ${(e as Error).message}`)
      } finally {
        setInCaricamento((n) => n - 1)
        setAvanzamento(null)
      }
    }
  }

  const invia = async (): Promise<void> => {
    const pulito = testo.trim()
    if (!pulito && allegati.length === 0) return
    if (inCaricamento > 0) return

    if (modo !== 'normale') {
      if (!pulito || aiInCorso) return
      setAiInCorso(true)
      setErrore(null)
      const controllo = new AbortController()
      annullaAi.current = controllo
      try {
        if (modo === 'ai-chat') await api.aiChat(canale.id, pulito, controllo.signal)
        else await api.aiImmagine(canale.id, pulito, controllo.signal)
        setTesto('')
      } catch (e) {
        if (!controllo.signal.aborted) setErrore((e as Error).message)
      } finally {
        if (annullaAi.current === controllo) annullaAi.current = null
        setAiInCorso(false)
      }
      return
    }

    // Si svuota subito: se l'invio fallisce l'errore compare, ma il campo
    // vuoto e' cio' che ci si aspetta dopo aver premuto Invio.
    setTesto('')
    const daMandare = allegati
    setAllegati([])

    try {
      await manda({ testo: pulito, allegati: daMandare.map((a) => a.id) })
    } catch (e) {
      setErrore((e as Error).message)
      setTesto(pulito)
      setAllegati(daMandare)
    }
  }

  const apriGif = (): void => {
    const apri = !gifAperte
    setGifAperte(apri)
    if (apri && gifDisponibili === null) {
      void api.servizi().then((s) => setGifDisponibili(s.gif.disponibile)).catch((e) => {
        setGifDisponibili(false)
        setErrore((e as Error).message)
      })
    }
  }

  const cerca = async (): Promise<void> => {
    const q = cercaGif.trim()
    if (!q || !gifDisponibili) return
    setGifCaricando(true)
    setErrore(null)
    try {
      const risposta = await api.cercaGif(q)
      setGif(risposta.risultati)
      setAttribuzioneGif(risposta.attribuzione)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setGifCaricando(false)
    }
  }

  const mandaGif = async (scelta: RisultatoGif): Promise<void> => {
    try {
      await manda({ testo: scelta.url })
      setGifAperte(false)
      setGif([])
      setCercaGif('')
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  const cercaImmaginiWeb = async (): Promise<void> => {
    const q = queryImmagini.trim()
    if (!q) return
    setImmaginiCaricando(true)
    setErrore(null)
    try {
      setImmagini((await api.cercaImmagini(q)).risultati)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setImmaginiCaricando(false)
    }
  }

  const condividiImmagineWeb = async (scelta: RisultatoImmagineWeb): Promise<void> => {
    try {
      await api.usaImmagine(scelta.id)
      await manda({ testo: `Immagine trovata sul web\n${scelta.immagine}\nFonte: ${scelta.pagina}\nFoto di ${scelta.autore} su Unsplash` })
      setImmaginiAperte(false)
      setImmagini([])
      setQueryImmagini('')
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  return (
    <div
      className={`border-t border-bordo p-3 ${margine}`}
      onDragOver={(e) => {
        e.preventDefault()
        setSopra(true)
      }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSopra(false)
        if (e.dataTransfer.files.length) void carica(e.dataTransfer.files)
      }}
    >
      {rispondiA && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-fondo-2 px-3 py-1.5 text-xs">
          <span className="text-testo-3">rispondi a</span>
          <span className="text-testo-2">{profili.get(rispondiA.autore)?.nome ?? 'qualcuno'}</span>
          <span className="min-w-0 flex-1 truncate text-testo-3">{rispondiA.testo.slice(0, 80)}</span>
          <button
            onClick={annullaRisposta}
            title="Non rispondere piu' a questo messaggio"
            aria-label="Annulla la risposta"
            className="shrink-0 text-testo-3 hover:text-testo"
          >
            <Chiudi className="h-4 w-4" />
          </button>
        </div>
      )}

      {errore && (
        <div className="mb-2">
          <Avviso>{errore}</Avviso>
        </div>
      )}

      {gifAperte && (
        <div className="mb-2 max-w-3xl rounded-xl border border-bordo bg-fondo-2 p-3 shadow-lg">
          {gifDisponibili === null ? (
            <p className="respiro text-sm text-testo-3">Controllo il servizio GIF…</p>
          ) : !gifDisponibili ? (
            <p className="text-sm text-testo-3">
              Ricerca GIF non disponibile: chi amministra il server deve mettere una chiave in
              deploy/.env — TALK_GIPHY_API_KEY (gratuita, si chiede a GIPHY) oppure
              TALK_TENOR_API_KEY, se ne ha gia' una.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={cercaGif}
                  onChange={(e) => setCercaGif(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void cerca()
                    }
                  }}
                  placeholder="Cerca una GIF"
                  className="min-w-0 flex-1 rounded-lg border border-bordo bg-fondo px-3 py-1.5 text-sm outline-none focus:border-vivo"
                  autoFocus
                />
                <button
                  onClick={() => void cerca()}
                  disabled={!cercaGif.trim() || gifCaricando}
                  className="rounded-lg bg-vivo px-3 py-1.5 text-sm text-black disabled:opacity-50"
                >
                  {gifCaricando ? 'Cerco…' : 'Cerca'}
                </button>
              </div>
              {/*
                Griglia a colonne strette, con le GIF alla loro altezza vera.

                Due modi sbagliati, provati in quest'ordine. Prima una griglia a
                celle uguali con `object-cover`: con la finestra larga venivano
                caselle da seicento pixel per centoventi, e le GIF uscivano
                tagliate a fette. Poi le colonne CSS, che tengono le proporzioni
                ma riempiono *per colonna*: dentro a un riquadro di altezza
                fissa il contenuto in eccesso non va sotto, va **a destra**, e
                lo scorrimento diventa orizzontale.

                Questa e' una griglia vera: le colonne le conta il browser
                (`auto-fill`), l'altezza di ogni GIF resta la sua, e cio' che non
                ci sta va sotto — che e' l'unica direzione in cui si ha voglia di
                scorrere cercando una GIF.
              */}
              {gif.length > 0 && (
                <div className="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] items-start gap-2 overflow-x-hidden overflow-y-auto">
                  {gif.map((scelta) => (
                    <button
                      key={scelta.id}
                      onClick={() => void mandaGif(scelta)}
                      title={`Invia ${scelta.titolo || 'GIF'}`}
                      className="block w-full overflow-hidden rounded-lg border border-bordo bg-fondo hover:border-vivo"
                    >
                      <img
                        src={scelta.anteprima}
                        alt={scelta.titolo || 'GIF'}
                        loading="lazy"
                        className="block h-auto w-full"
                      />
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-right text-[11px] text-testo-3">{attribuzioneGif}</p>
            </>
          )}
        </div>
      )}

      {immaginiAperte && (
        <div className="mb-2 max-w-3xl rounded-xl border border-bordo bg-fondo-2 p-3 shadow-lg">
          <div className="flex gap-2">
            <input
              value={queryImmagini}
              onChange={(e) => setQueryImmagini(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void cercaImmaginiWeb())}
              placeholder="Cerca immagini sul web"
              className="min-w-0 flex-1 rounded-lg border border-bordo bg-fondo px-3 py-1.5 text-sm outline-none focus:border-vivo"
              autoFocus
            />
            <button onClick={() => void cercaImmaginiWeb()} disabled={!queryImmagini.trim() || immaginiCaricando} className="rounded-lg bg-vivo px-3 text-sm text-black disabled:opacity-50">
              {immaginiCaricando ? 'Cerco…' : 'Cerca'}
            </button>
          </div>
          <div className="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2 overflow-x-hidden overflow-y-auto">
            {immagini.map((scelta) => (
              <button
                key={scelta.id}
                onClick={() => void condividiImmagineWeb(scelta)}
                className="block w-full overflow-hidden rounded-lg border border-bordo text-left hover:border-vivo"
              >
                <img src={scelta.anteprima} alt={scelta.titolo} loading="lazy" className="block h-auto w-full" />
                <span className="block truncate px-2 py-1 text-[10px] text-testo-3">{scelta.autore} · Unsplash</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-testo-3">Immagini trovate sul web · fonte e autore saranno inclusi nel messaggio.</p>
        </div>
      )}

      {/*
        La riga dei modi compare solo se c'e' almeno un modo che funziona.

        Prima i pulsanti c'erano sempre, spenti e con un `title` che spiegava
        cosa configurare sul server. Ma chi usa PulseTalk non e' chi amministra
        il NAS: leggere "AI Chat non configurata su questa istanza" ogni volta
        che si scrive un messaggio e' un promemoria per qualcun altro, occupa
        una riga e insegna che quattro pulsanti su cinque non si premono.

        E se resta solo "Chat" sparisce anche quello: un interruttore con una
        sola posizione non e' una scelta, e' una decorazione.
      */}
      {qualcheAi && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button
            onClick={() => setModo('normale')}
            aria-pressed={modo === 'normale'}
            className={`inline-flex h-8 items-center rounded-lg border px-2.5 ${modo === 'normale' ? 'border-vivo bg-vivo/15 text-vivo' : 'border-bordo text-testo-3'}`}
          >
            Chat
          </button>
          {ai?.chat && (
            <button
              onClick={() => setModo(modo === 'ai-chat' ? 'normale' : 'ai-chat')}
              title="Chiedi all’AI senza inviare il prompt come messaggio normale"
              aria-label="Modalità AI Chat"
              aria-pressed={modo === 'ai-chat'}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 ${modo === 'ai-chat' ? 'border-vivo bg-vivo/15 text-vivo' : 'border-bordo text-testo-3'}`}
            >
              <Scintille className="h-3.5 w-3.5" />
              AI Chat
            </button>
          )}
          {ai?.immagini && (
            <button
              onClick={() => setModo(modo === 'ai-immagine' ? 'normale' : 'ai-immagine')}
              title="Genera una nuova immagine"
              aria-label="Modalità AI Image"
              aria-pressed={modo === 'ai-immagine'}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 ${modo === 'ai-immagine' ? 'border-vivo bg-vivo/15 text-vivo' : 'border-bordo text-testo-3'}`}
            >
              <Immagine className="h-3.5 w-3.5" />
              AI Image
            </button>
          )}
          {ai?.ricercaWeb && (
            <button
              onClick={() => setModo('ai-chat')}
              title="Usa AI Chat con ricerca web e fonti"
              aria-label="Ricerca web tramite AI"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-bordo px-2.5 text-testo-3 hover:text-testo"
            >
              <Globo className="h-3.5 w-3.5" />
              AI Ricerca
            </button>
          )}
          {ai?.ricercaImmagini && (
            <button
              onClick={() => setImmaginiAperte((v) => !v)}
              title="Cerca immagini esistenti sul web; non genera immagini"
              aria-label="Cerca immagini sul web"
              aria-pressed={immaginiAperte}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 ${immaginiAperte ? 'border-vivo bg-vivo/15 text-vivo' : 'border-bordo text-testo-3 hover:text-testo'}`}
            >
              <Lente className="h-3.5 w-3.5" />
              Immagini web
            </button>
          )}
        </div>
      )}

      {(allegati.length > 0 || inCaricamento > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {allegati.map((allegato) => (
            <span
              key={allegato.id}
              className="flex items-center gap-2 rounded-lg border border-bordo bg-fondo-2 px-2.5 py-1 text-xs"
            >
              <span className="max-w-40 truncate">{allegato.nome}</span>
              <button
                onClick={() => setAllegati((prima) => prima.filter((a) => a.id !== allegato.id))}
                title={`Togli ${allegato.nome}`}
                aria-label={`Togli ${allegato.nome}`}
                className="text-testo-3 hover:text-male"
              >
                <Chiudi className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {inCaricamento > 0 && (
            <span className="respiro rounded-lg border border-bordo px-2.5 py-1 text-xs text-testo-3">
              {avanzamento
                ? `${avanzamento.nome} — ${Math.floor((avanzamento.fatto / avanzamento.totale) * 100)}%`
                : `carico ${inCaricamento}…`}
            </span>
          )}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-xl border bg-fondo px-3 py-2 transition-colors ${
          sopra ? 'border-vivo' : 'border-bordo focus-within:border-fondo-3'
        }`}
      >
        <input
          ref={file}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void carica(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => file.current?.click()}
          title="Allega un file"
          aria-label="Allega un file"
          className="shrink-0 pb-1 text-testo-3 hover:text-testo"
        >
          <Graffetta className="h-5 w-5" />
        </button>

        <button
          onClick={apriGif}
          title="Cerca una GIF"
          aria-label="Cerca una GIF"
          className={`shrink-0 pb-1 text-xs font-semibold ${gifAperte ? 'text-vivo' : 'text-testo-3 hover:text-testo'}`}
        >
          GIF
        </button>

        <textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onPaste={(e) => {
            // Incollare uno screenshot deve funzionare come trascinarlo: e'
            // il modo in cui la meta' delle immagini finisce in una chat.
            const immagini = Array.from(e.clipboardData.files)
            if (immagini.length) {
              e.preventDefault()
              void carica(immagini)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void invia()
            }
          }}
          rows={1}
          placeholder={modo === 'ai-chat' ? 'Chiedi qualcosa all’AI' : modo === 'ai-immagine' ? 'Descrivi l’immagine da generare' : `Scrivi in #${canale.nome}`}
          disabled={aiInCorso}
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-testo-3"
          style={{ height: 'auto' }}
          onInput={(e) => {
            // Il campo cresce con il testo, fino a un tetto: scrivere un
            // paragrafo in una riga alta ventidue pixel e' scomodo, e un
            // campo che occupa mezzo schermo lo e' altrettanto.
            const elemento = e.currentTarget
            elemento.style.height = 'auto'
            elemento.style.height = `${Math.min(elemento.scrollHeight, 160)}px`
          }}
        />
      </div>

      <p className="mt-1 px-1 text-[11px] text-testo-3">
        {aiInCorso ? (
          <button className="text-male underline" onClick={() => annullaAi.current?.abort()}>Annulla generazione</button>
        ) : modo === 'normale' ? (
          'Invio per mandare, Maiusc+Invio per andare a capo. Trascina o incolla un file per allegarlo.'
        ) : (
          'Il prompt va al provider configurato e non viene inviato come messaggio umano.'
        )}
      </p>
    </div>
  )
}
