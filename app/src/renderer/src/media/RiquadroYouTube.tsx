import { useEffect, useRef, useState } from 'react'
import type { SessioneMedia } from '@shared/tipi'
import type { SessioniMedia } from '../lib/usaSessioniMedia'
import { creaPlayer, origineUsabile, STATO, type Player } from '../lib/youtube'
import { Ingrandisci, Rimpicciolisci, Video } from '../icone'
import { BottoneMuto, type VoceVolume } from '../sala/Volume'

/** Oltre questo scarto si salta. Sotto si lascia in pace. */
const SOGLIA_MS = 1500

/** Ogni quanto si confronta la propria posizione con quella attesa. */
const CONTROLLO_MS = 2000

/** Dopo questo tempo si mostra un errore utile invece di girare per sempre. */
const ATTESA_VIDEO_MS = 8_000

interface RipiegoYouTube {
  riferimento: string
  secondi: number
  inRiproduzione: boolean
}

/**
 * Il video condiviso, dentro alla superficie della chiamata.
 *
 * Non e' un'anteprima del pannello laterale: e' un riquadro della stanza e
 * resta visibile anche quando il pannello dei comandi viene chiuso. Ogni
 * partecipante carica il player ufficiale di YouTube sul proprio computer;
 * PulseTalk sincronizza soltanto id, play/pausa e posizione.
 */
export default function RiquadroYouTube({
  sessione,
  media,
  puoComandare,
  aFuoco,
  quandoScelto,
  volume,
  muto,
  cambiaVolume,
  alternaMuto,
  quandoMenu,
  senzaCornice = false
}: {
  sessione: SessioneMedia
  media: SessioniMedia
  puoComandare: boolean
  aFuoco: boolean
  quandoScelto: () => void
  volume: number
  muto: boolean
  cambiaVolume: (volume: number) => void
  alternaMuto: () => void
  /** Tasto destro: apre il menu del riquadro alle coordinate del puntatore. */
  quandoMenu?: (x: number, y: number) => void
  /** Riempie la sala a filo, come una condivisione a tutta superficie. */
  senzaCornice?: boolean
}): React.JSX.Element {
  const contenitore = useRef<HTMLDivElement | null>(null)
  const player = useRef<Player | null>(null)
  const [pronto, setPronto] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [scarto, setScarto] = useState(0)
  const [caricando, setCaricando] = useState(true)
  const [tentativo, setTentativo] = useState(0)
  const [ripiego, setRipiego] = useState<RipiegoYouTube | null>(null)
  /**
   * Dove sta il video e quanto dura, per la barra qui sotto.
   *
   * Si legge dal player e non dalla sessione: fra un battito e l'altro il
   * server non dice niente, e una barra che avanza a scatti di due secondi
   * sembra rotta. Quando il player non c'e' ancora — o si e' ripiegati su
   * quello standard — resta la posizione attesa, che e' comunque giusta.
   */
  const [dove, setDove] = useState({ posizione: 0, durata: 0 })
  /** Dove sta il pollice mentre lo si trascina. Null quando non lo si tiene. */
  const [trascinato, setTrascinato] = useState<number | null>(null)
  const applicando = useRef(false)
  const caricato = useRef<string | null>(null)
  const sessioneCorrente = useRef(sessione)
  const mediaCorrente = useRef(media)
  const puoComandareCorrente = useRef(puoComandare)

  sessioneCorrente.current = sessione
  mediaCorrente.current = media
  puoComandareCorrente.current = puoComandare

  const stato = sessione.stato
  const riferimento = stato.riferimento ?? null

  const usaPlayerStandard = (): void => {
    const corrente = sessioneCorrente.current
    const video = corrente.stato.riferimento
    if (!video) {
      setErrore('La sessione non indica piu\' quale video riprodurre.')
      return
    }
    setErrore(null)
    setCaricando(false)
    setRipiego({
      riferimento: video,
      secondi: Math.max(
        0,
        Math.floor(mediaCorrente.current.posizioneAttesa(corrente) / 1000)
      ),
      inRiproduzione: corrente.stato.inRiproduzione === true
    })
  }

  const riprovaSincronizzato = (): void => {
    setRipiego(null)
    setTentativo((valore) => valore + 1)
  }

  useEffect(() => {
    if (ripiego) return

    // Da un'origine che YouTube non sa identificare l'API ufficiale non
    // funzionera' mai: si va dritti al player standard invece di far guardare
    // un rettangolo nero finche' scade il controllo.
    if (!origineUsabile()) {
      usaPlayerStandard()
      return
    }

    let vivo = true
    const cornice = contenitore.current
    if (!cornice) return

    // L'API sostituisce il nodo ricevuto con un iframe. Tenendolo dentro a
    // una cornice stabile React puo' smontare e ricreare il player senza
    // ritrovarsi un proprio elemento rimosso da codice esterno.
    const dove = document.createElement('div')
    dove.className = 'h-full w-full'
    cornice.replaceChildren(dove)
    setPronto(false)
    setErrore(null)
    setCaricando(true)
    caricato.current = null

    void creaPlayer(
      dove,
      (nuovo) => {
        if (!vivo) return
        const corrente = sessioneCorrente.current
        if (
          [STATO.finito, STATO.inCoda, STATO.suona, STATO.pausa].includes(
            nuovo as 0 | 1 | 2 | 5
          )
        ) {
          setCaricando(false)
        }
        if (applicando.current || !puoComandareCorrente.current) return
        if (nuovo === STATO.finito && corrente.coda.some((v) => !v.suonato)) {
          void mediaCorrente.current.comanda(corrente.id, { azione: 'prossimo' })
        }
      },
      (codice) => {
        if (!vivo) return
        if (codice === 153) {
          usaPlayerStandard()
          return
        }
        const motivo =
          codice === 101 || codice === 150
              ? "Questo video non consente la riproduzione incorporata. Provane un altro."
              : codice === 100
                ? 'Questo video non esiste piu\' o e\' privato.'
                : `YouTube non riesce a riprodurre questo video (errore ${codice}).`
        setErrore(motivo)
      }
    )
      .then((creato) => {
        if (!vivo) return void creato.distruggi()
        // Il riferimento deve esistere prima di `pronto`: l'effetto che
        // carica il primo video non puo' cosi' perdere il comando per una
        // condizione di gara tra la Promise e il render di React.
        player.current = creato
        creato.volume((muto ? 0 : volume) * 100)
        setPronto(true)
      })
      .catch((e) => {
        if (!vivo) return
        const messaggio = (e as Error).message
        if (/errore (?:100|101|150)\b/.test(messaggio)) {
          setErrore((attuale) => attuale ?? messaggio)
        } else {
          usaPlayerStandard()
        }
      })

    return () => {
      vivo = false
      player.current?.distruggi()
      player.current = null
      caricato.current = null
      cornice.replaceChildren()
    }
    // Il player vive quanto il riquadro, salvo una riprova esplicita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tentativo, ripiego])

  useEffect(() => {
    player.current?.volume((muto ? 0 : volume) * 100)
  }, [muto, volume, pronto])

  useEffect(() => {
    if (!pronto || !player.current || !riferimento) return

    const allinea = (): void => {
      const p = player.current
      if (!p) return

      applicando.current = true
      try {
        const attesa = media.posizioneAttesa(sessione)
        if (caricato.current !== riferimento) {
          caricato.current = riferimento
          setErrore(null)
          setCaricando(true)
          // Se la sessione e' in pausa si prepara il fotogramma. Caricare il
          // video e fermarlo nello stesso istante puo' lasciare l'iframe nero
          // prima che YouTube abbia prodotto il primo frame.
          if (stato.inRiproduzione) p.caricaVideo(riferimento, attesa / 1000)
          else p.preparaVideo(riferimento, attesa / 1000)
          setScarto(0)
          return
        }

        const differenza = attesa - p.posizione()
        setScarto(differenza)
        if (Math.abs(differenza) > SOGLIA_MS) p.vaiA(attesa / 1000)
        if (stato.inRiproduzione && !p.staSuonando()) p.suona()
        if (!stato.inRiproduzione && p.staSuonando()) p.ferma()
      } finally {
        window.setTimeout(() => {
          applicando.current = false
        }, 250)
      }
    }

    allinea()
    const battito = window.setInterval(allinea, CONTROLLO_MS)
    return () => window.clearInterval(battito)
  }, [pronto, sessione, riferimento, stato.inRiproduzione, stato.posizioneMs, stato.aggiornato, media])

  /**
   * Il controllo che si accorge del nero.
   *
   * Prima guardava `caricando`, ed era la cosa sbagliata da guardare: YouTube
   * manda un cambio di stato (`inCoda`, `pausa`) anche quando poi non disegna
   * un solo fotogramma, `caricando` diventava falso, il controllo si spegneva —
   * e restava un rettangolo nero per sempre, senza messaggi e senza il pulsante
   * per ripiegare, perche' anche quello sparisce con `caricando`.
   *
   * La spia giusta e' la durata: un player che ha davvero caricato il video sa
   * quanto dura. Se dopo il tempo di grazia e' ancora zero, quel player non
   * suonera' niente, qualunque cosa dica il suo stato.
   */
  useEffect(() => {
    if (!pronto || !riferimento || errore || ripiego) return
    const scadenza = window.setTimeout(() => {
      if ((player.current?.durata() ?? 0) <= 0) usaPlayerStandard()
    }, ATTESA_VIDEO_MS)
    return () => window.clearTimeout(scadenza)
    // Lo stato corrente viene letto dai ref dentro `usaPlayerStandard`: un
    // aggiornamento SSE non deve riavviare il conto alla rovescia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, riferimento, errore, ripiego])

  // Quattro volte al secondo: abbastanza da sembrare continua, abbastanza poco
  // da non far lavorare la macchina per una barra che spesso nessuno guarda.
  useEffect(() => {
    const leggi = (): void => {
      const p = player.current
      const attesa = media.posizioneAttesa(sessione)
      const posizione = p && pronto && p.durata() > 0 ? p.posizione() : attesa
      const durata = (p && pronto ? p.durata() : 0) || stato.durataMs || 0
      setDove((prima) =>
        Math.abs(prima.posizione - posizione) < 120 && prima.durata === durata
          ? prima
          : { posizione, durata }
      )
    }
    leggi()
    const battito = window.setInterval(leggi, 250)
    return () => window.clearInterval(battito)
  }, [media, sessione, pronto, stato.durataMs])

  const alterna = (): void => {
    if (!puoComandare) return
    void media.comanda(sessione.id, {
      azione: stato.inRiproduzione ? 'pausa' : 'play'
    })
  }

  /**
   * Spostarsi nel video, per tutti.
   *
   * Passa dal server come play e pausa: chi trascina la barra sposta la
   * sessione, non il proprio player. Saltare per conto proprio vorrebbe dire
   * uscire dal "guardare insieme", che e' l'unica cosa che questo riquadro sa
   * fare.
   */
  const salta = (posizioneMs: number): void => {
    if (!puoComandare) return
    // Ottimismo locale: il video si sposta sotto al dito e non mezzo secondo
    // dopo, quando torna la risposta. Se il server dice altro, il battito
    // rimette le cose a posto da solo.
    setDove((prima) => ({ ...prima, posizione: posizioneMs }))
    void media.comanda(sessione.id, { azione: 'salta', posizioneMs: Math.round(posizioneMs) })
  }

  const voceVolume: VoceVolume = {
    chiave: 'youtube',
    nome: 'YouTube',
    volume,
    muto,
    cambia: cambiaVolume,
    alternaMuto
  }

  const urlRipiego = ripiego
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ripiego.riferimento)}?${new URLSearchParams({
        autoplay: ripiego.inRiproduzione ? '1' : '0',
        controls: '1',
        playsinline: '1',
        rel: '0',
        start: String(ripiego.secondi)
      }).toString()}`
    : null

  const durata = dove.durata
  const posizione = trascinato ?? dove.posizione

  return (
    <section
      onContextMenu={(evento) => {
        if (!quandoMenu) return
        // Senza questo esce il menu di Chromium ("Ricarica", "Ispeziona"), che
        // dentro a un'applicazione non ha senso di esistere.
        evento.preventDefault()
        quandoMenu(evento.clientX, evento.clientY)
      }}
      className={`group/youtube relative h-full w-full overflow-hidden bg-black ${
        senzaCornice
          ? 'rounded-none'
          : 'rounded-xl border border-bordo shadow-lg shadow-black/20'
      }`}
    >
      {urlRipiego ? (
        <iframe
          src={urlRipiego}
          title="Video YouTube condiviso"
          className="block h-full w-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <div ref={contenitore} className="h-full w-full [&>iframe]:block" />
      )}

      {/* Il player non riceve clic diretti: play e pausa devono passare dal
          server, altrimenti un solo partecipante si staccherebbe dagli altri. */}
      {!ripiego && (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer"
          onClick={alterna}
          aria-label={stato.inRiproduzione ? 'Metti in pausa per tutti' : 'Riproduci per tutti'}
        />
      )}

      <div
        className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover/youtube:opacity-100 focus-within:opacity-100"
        onClick={(evento) => evento.stopPropagation()}
      >
        {/* Solo l'interruttore, come sulle condivisioni. Il livello sta nel
            menu del tasto destro.

            Lo schermo intero non c'e' piu': era il tutto-schermo
            dell'applicazione, cioe' lo stesso comando che sta gia' in basso a
            destra nell'overlay. Due pulsanti per la stessa cosa a mezzo
            centimetro l'uno dall'altro non danno una scelta, danno il dubbio
            che facciano cose diverse. */}
        <BottoneMuto voci={[voceVolume]} titolo="il video" />
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3 left-3 z-20 space-y-2 opacity-0 transition-opacity group-hover/youtube:opacity-100 focus-within:opacity-100">
        {/* La barra del tempo.

            Non c'e' sul player standard: quello ha gia' i suoi comandi, e
            due barre sovrapposte che dicono numeri diversi sono peggio di
            una sola. E non c'e' finche' YouTube non dice quanto dura il
            video, perche' una barra senza fondo scala non e' una barra, e'
            una riga. */}
        {!ripiego && durata > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-fondo/90 px-2.5 py-1.5 shadow-lg backdrop-blur">
            <span className="numeri shrink-0 text-[11px] text-testo-2">{orologio(posizione)}</span>

            <input
              type="range"
              min={0}
              max={durata}
              step={1000}
              value={Math.min(posizione, durata)}
              disabled={!puoComandare}
              // Mentre si trascina il pollice resta dov'e' il dito, non dove
              // dice il battito: senza, il cursore tornava indietro da solo
              // quattro volte al secondo e diventava impossibile da mirare.
              onChange={(evento) => setTrascinato(Number(evento.target.value))}
              onPointerUp={() => {
                if (trascinato !== null) salta(trascinato)
                setTrascinato(null)
              }}
              // La rete di sicurezza: se il dito esce dalla barra e il
              // browser molla la presa, il salto va fatto lo stesso. Senza,
              // un trascinamento finito male lasciava il pollice fermo dove
              // era stato lasciato e il video dov'era.
              onLostPointerCapture={() => {
                if (trascinato !== null) salta(trascinato)
                setTrascinato(null)
              }}
              onKeyUp={() => {
                if (trascinato !== null) salta(trascinato)
                setTrascinato(null)
              }}
              onBlur={() => setTrascinato(null)}
              title={
                puoComandare
                  ? 'Sposta il video — per tutti'
                  : 'Qui puoi solo guardare: sposta il video chi comanda la sessione'
              }
              aria-label="Posizione nel video"
              className={`h-1 min-w-0 flex-1 accent-vivo ${
                puoComandare ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              }`}
            />

            <span className="numeri shrink-0 text-[11px] text-testo-3">{orologio(durata)}</span>
          </div>
        )}

        <div className="flex items-end justify-between gap-3">
          <span className="flex items-center gap-2 rounded-lg bg-fondo/90 px-2.5 py-1.5 text-xs text-testo shadow-lg backdrop-blur">
            <Video className="h-4 w-4 text-vivo" />
            YouTube · Guarda insieme
          </span>
          {/* La sovraimpressione sta in basso a destra come su ogni altro
              riquadro. Non poteva restare in alto insieme all'altoparlante e
              basta: in una griglia mista — facce, schermi, il video — l'occhio
              impara un angolo solo, e un box che fa eccezione e' un box che
              ogni volta si cerca due volte. Qui in fondo divide la riga con la
              spia del sincronismo, che non ne occupa mezza. */}
          <span className="flex items-end gap-2">
            <span className="numeri rounded-lg bg-fondo/90 px-2 py-1 text-[11px] text-testo-3 shadow-lg backdrop-blur">
              {ripiego
                ? 'player standard'
                : Math.abs(scarto) < 250
                ? 'in pari'
                : `${scarto > 0 ? '−' : '+'}${(Math.abs(scarto) / 1000).toFixed(1)}s`}
            </span>
            <span className="pointer-events-auto" onClick={(evento) => evento.stopPropagation()}>
              <Comando
                titolo={aFuoco ? 'Rimetti nella griglia' : 'Metti a fuoco'}
                premi={quandoScelto}
              >
                {aFuoco ? (
                  <Rimpicciolisci className="h-4 w-4" />
                ) : (
                  <Ingrandisci className="h-4 w-4" />
                )}
              </Comando>
            </span>
          </span>
        </div>
      </div>

      {caricando && !errore && !ripiego && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70">
          <span className="respiro rounded-lg bg-fondo/85 px-3 py-2 text-sm text-testo-2">
            carico il video…
          </span>
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-fondo/85 px-3 py-1.5 text-xs text-testo-2 hover:text-white"
            onClick={usaPlayerStandard}
          >
            Usa subito il player standard
          </button>
        </div>
      )}

      {errore && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-fondo-2/95 p-6 text-center">
          <div className="max-w-md">
            <Video className="mx-auto mb-3 h-8 w-8 text-male" />
            <p className="text-sm text-testo">{errore}</p>
            <button
              type="button"
              className="mt-4 rounded-lg bg-vivo px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              onClick={riprovaSincronizzato}
            >
              Riprova
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * Millisecondi in `m:ss`, o `h:mm:ss` da un'ora in su.
 *
 * L'ora compare solo quando serve: `0:04:12` su un video da cinque minuti fa
 * contare le cifre per capire che sono quattro minuti.
 */
function orologio(ms: number): string {
  const tutti = Math.max(0, Math.floor(ms / 1000))
  const ore = Math.floor(tutti / 3600)
  const minuti = Math.floor((tutti % 3600) / 60)
  const secondi = tutti % 60
  const ss = String(secondi).padStart(2, '0')
  return ore > 0 ? `${ore}:${String(minuti).padStart(2, '0')}:${ss}` : `${minuti}:${ss}`
}

function Comando({
  titolo,
  premi,
  children
}: {
  titolo: string
  premi: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={titolo}
      aria-label={titolo}
      onClick={premi}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
    >
      {children}
    </button>
  )
}
