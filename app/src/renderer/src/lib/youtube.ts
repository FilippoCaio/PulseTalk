/**
 * Il player di YouTube, caricato una volta sola.
 *
 * Si usa l'IFrame Player API ufficiale. La ragione per cui questa e' la strada
 * giusta, e non un dettaglio: il video **non passa da PulseTalk**. Ogni
 * computer lo scarica per conto suo, con la sua linea e la sua qualita', e da
 * qui viaggiano solo quattro numeri — quale video, se sta andando, a che
 * secondo, e da quando quel secondo era vero.
 *
 * L'alternativa sarebbe stata condividere lo schermo di chi guarda: un flusso
 * ricompresso, con il testo illeggibile e la banda di uno solo a reggere tutti.
 * Questa costa duecento byte a comando.
 *
 * Lo script arriva da YouTube e gira in questa pagina: e' l'unico modo di
 * usare l'API ufficiale, ed e' il motivo per cui la CSP lo consente da due
 * host precisi e da nessun altro (vedi main/index.ts).
 */

/** Cosa serve del player. Sono cinque metodi su una trentina che ne ha. */
export interface Player {
  caricaVideo(id: string, secondi: number): void
  /** Prepara il fotogramma senza far partire la riproduzione. */
  preparaVideo(id: string, secondi: number): void
  suona(): void
  ferma(): void
  vaiA(secondi: number): void
  /** Dove sta adesso, in millisecondi. */
  posizione(): number
  /** Quanto dura, in millisecondi. Zero finche' non lo sa. */
  durata(): number
  /** Se sta davvero suonando: puo' non farlo per un buffer o per un errore. */
  staSuonando(): boolean
  volume(percento: number): void
  distruggi(): void
}

/** Gli stati del player, come li chiama YouTube. */
export const STATO = {
  nonPartito: -1,
  finito: 0,
  suona: 1,
  pausa: 2,
  buffer: 3,
  inCoda: 5
} as const

type ApiYouTube = {
  Player: new (
    elemento: HTMLElement,
    opzioni: Record<string, unknown>
  ) => Record<string, (...args: unknown[]) => unknown>
}

declare global {
  interface Window {
    YT?: ApiYouTube
    onYouTubeIframeAPIReady?: () => void
  }
}

let inArrivo: Promise<ApiYouTube> | null = null

/** Un blocco di rete non deve trasformarsi in un'attesa senza fine. */
const ATTESA_API_MS = 15_000
const ATTESA_PLAYER_MS = 15_000

/**
 * Carica lo script, una volta per sessione dell'applicazione.
 *
 * La promessa si conserva: cinque riquadri che chiedono il player insieme non
 * devono produrre cinque `<script>` — YouTube ne eseguirebbe uno solo e gli
 * altri quattro resterebbero appesi ad aspettare un callback gia' consumato.
 */
export function caricaApi(): Promise<ApiYouTube> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (inArrivo) return inArrivo

  inArrivo = new Promise<ApiYouTube>((risolvi, rifiuta) => {
    const precedente = window.onYouTubeIframeAPIReady
    let conclusa = false
    let tag: HTMLScriptElement | null = null

    const ripristinaCallback = (): void => {
      if (window.onYouTubeIframeAPIReady === pronta) {
        window.onYouTubeIframeAPIReady = precedente
      }
    }

    const fallisci = (errore: Error): void => {
      if (conclusa) return
      conclusa = true
      window.clearTimeout(scadenza)
      ripristinaCallback()
      tag?.remove()
      inArrivo = null
      rifiuta(errore)
    }

    const pronta = (): void => {
      if (conclusa) return
      try {
        precedente?.()
      } catch {
        // Un altro consumatore dell'API non deve impedire a PulseTalk di
        // completare la propria inizializzazione.
      }
      if (!window.YT?.Player) {
        fallisci(new Error('Il player di YouTube non si e\' inizializzato correttamente.'))
        return
      }
      conclusa = true
      window.clearTimeout(scadenza)
      ripristinaCallback()
      risolvi(window.YT)
    }
    window.onYouTubeIframeAPIReady = pronta

    const scadenza = window.setTimeout(() => {
      fallisci(
        new Error(
          'YouTube non ha risposto. Controlla la connessione o eventuali filtri DNS e prova di nuovo.'
        )
      )
    }, ATTESA_API_MS)

    tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    tag.onerror = () => {
      fallisci(
        new Error(
          'Non riesco a caricare il player di YouTube. Serve una connessione a internet: il video ' +
            'lo scarica il tuo computer, non il server.'
        )
      )
    }
    document.head.appendChild(tag)
  })

  return inArrivo
}

/**
 * Se l'IFrame Player API puo' funzionare da dove gira questa pagina.
 *
 * L'API vuole un'origine vera per identificare chi incorpora il video. Da
 * `file://` l'origine e' opaca: il player risponde `onReady`, accetta i
 * comandi, e poi rifiuta ogni video con l'errore 153 — la durata resta zero e
 * l'iframe resta nero. Saperlo prima evita quindici secondi di rettangolo nero
 * a chi guarda, e permette di andare dritti al player standard.
 *
 * L'app installata si serve da `http://127.0.0.1` proprio per questo (vedi
 * main/sito.ts), ma se quel servitore non parte si ricade su `file://`, ed e'
 * il caso che questa funzione riconosce.
 */
export function origineUsabile(): boolean {
  return ['http:', 'https:'].includes(location.protocol)
}

/**
 * Costruisce un player dentro a un contenitore.
 *
 * `origin` deve essere il dominio HTTP(S) reale della pagina. La build desktop
 * vive invece su `file://`: passare quello schema come dominio rende non
 * validi i comandi del player. In quel caso l'identificazione richiesta da
 * YouTube arriva dal Referer aggiunto dal processo principale.
 */
export async function creaPlayer(
  contenitore: HTMLElement,
  quandoCambiaStato: (stato: number) => void,
  quandoErrore?: (codice: number) => void
): Promise<Player> {
  const api = await caricaApi()
  const origine = ['http:', 'https:'].includes(location.protocol) ? location.origin : undefined

  const grezzo = await new Promise<Record<string, (...a: unknown[]) => unknown>>(
    (risolvi, rifiuta) => {
      let conclusa = false
      let player: Record<string, (...a: unknown[]) => unknown> | null = null

      const fallisci = (errore: Error): void => {
        if (conclusa) return
        conclusa = true
        window.clearTimeout(scadenza)
        const distruggi = player?.destroy
        if (typeof distruggi === 'function') distruggi.call(player)
        rifiuta(errore)
      }

      const scadenza = window.setTimeout(() => {
        fallisci(
          new Error(
            'Il player di YouTube non si e\' avviato. Controlla la connessione o eventuali filtri e riprova.'
          )
        )
      }, ATTESA_PLAYER_MS)

      try {
        player = new api.Player(contenitore, {
          width: '100%',
          height: '100%',
          playerVars: {
            enablejsapi: 1,
            // Niente controlli del player: comandarlo da li' significherebbe
            // comandare solo il proprio, e vedere gli altri restare indietro.
            // I comandi veri stanno nella barra di PulseTalk e passano dal server.
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            ...(origine ? { origin: origine } : {})
          },
          events: {
            onReady: () => {
              if (conclusa || !player) return
              conclusa = true
              window.clearTimeout(scadenza)
              risolvi(player)
            },
            onStateChange: (evento: { data: number }) => quandoCambiaStato(evento.data),
            // Senza onError YouTube lascia un iframe nero e la sessione sembra
            // semplicemente non caricarsi. I codici distinguono un video che non
            // consente embed dall'identificazione mancante del client Electron.
            onError: (evento: { data: number }) => {
              const codice = Number(evento.data)
              quandoErrore?.(codice)
              if (!conclusa) {
                fallisci(new Error(`YouTube ha rifiutato il player (errore ${codice}).`))
              }
            }
          }
        })
      } catch (errore) {
        fallisci(
          errore instanceof Error
            ? errore
            : new Error('Non riesco a costruire il player di YouTube.')
        )
      }
    }
  )

  const chiama = (nome: string, ...argomenti: unknown[]): unknown => {
    const funzione = grezzo[nome]
    return typeof funzione === 'function' ? funzione.call(grezzo, ...argomenti) : undefined
  }

  return {
    caricaVideo: (id, secondi) => chiama('loadVideoById', { videoId: id, startSeconds: secondi }),
    preparaVideo: (id, secondi) => chiama('cueVideoById', { videoId: id, startSeconds: secondi }),
    suona: () => chiama('playVideo'),
    ferma: () => chiama('pauseVideo'),
    // `true` come secondo argomento: cerca subito invece di aspettare il
    // prossimo keyframe scaricato. Su un salto voluto e' cio' che serve.
    vaiA: (secondi) => chiama('seekTo', secondi, true),
    posizione: () => Number(chiama('getCurrentTime') ?? 0) * 1000,
    durata: () => Number(chiama('getDuration') ?? 0) * 1000,
    staSuonando: () => Number(chiama('getPlayerState') ?? -1) === STATO.suona,
    volume: (percento) => chiama('setVolume', Math.max(0, Math.min(100, percento))),
    distruggi: () => chiama('destroy')
  }
}

/**
 * Da qualunque cosa una persona incolli all'id di undici caratteri.
 *
 * Si incolla l'indirizzo della barra, quello del pulsante "condividi", quello
 * con il minuto dentro, o l'id nudo. Rifiutare tutto tranne una forma sarebbe
 * far ricordare a chi incolla quale delle cinque e' quella giusta.
 */
export function idDaUrl(grezzo: string): string | null {
  const testo = grezzo.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(testo)) return testo

  try {
    const url = new URL(testo)
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1)
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname)) {
      const v = url.searchParams.get('v')
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
      // /embed/<id> e /shorts/<id>
      const pezzi = url.pathname.split('/').filter(Boolean)
      const ultimo = pezzi.at(-1) ?? ''
      return /^[A-Za-z0-9_-]{11}$/.test(ultimo) ? ultimo : null
    }
  } catch {
    // Non era un indirizzo: si e' gia' provato con l'id nudo qui sopra.
  }
  return null
}

/** Il secondo di partenza scritto dentro all'indirizzo (`?t=90`, `#t=1m30s`). */
export function secondiDaUrl(grezzo: string): number {
  try {
    const url = new URL(grezzo.trim())
    const t = url.searchParams.get('t') ?? url.searchParams.get('start') ?? ''
    if (/^\d+$/.test(t)) return Number(t)
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
    if (m && (m[1] || m[2] || m[3])) {
      return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    }
  } catch {
    // Niente: si parte da zero.
  }
  return 0
}
