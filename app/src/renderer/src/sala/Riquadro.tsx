import { useEffect, useRef, useState } from 'react'
import { bitrateLeggibile } from '@shared/qualita'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { osserva, type Statistiche } from '../lib/statistiche'
import type { Puntatore, Riquadro as Dati } from '../lib/usaSessione'
import {
  FERMO,
  limita,
  versoContenuto,
  versoElemento,
  versoIlPuntatore,
  type Misure,
  type Zoom
} from '../lib/zoom'
import {
  AltoparlanteMuto,
  Ingrandisci,
  MicrofonoSpento,
  Rimpicciolisci,
  Lente,
  SchermoIntero,
  SchermoNormale,
  Stella
} from '../icone'
import { BottoneVolume, type VoceVolume } from './Volume'

/**
 * Un riquadro: una persona, o uno schermo.
 *
 * Sta sempre in 16:9, e non perche' i video lo siano — un avatar non ha una
 * forma — ma perche' otto riquadri tutti uguali si leggono con la coda
 * dell'occhio e otto riquadri di forme diverse no. La misura gliela passa la
 * griglia, che la calcola sullo spazio che c'e'; qui dentro si riempie e basta.
 *
 * Per la persona il video c'e' solo se la camera e' accesa; altrimenti resta
 * l'avatar, che e' comunque una presenza. Il bordo diventa verde quando parla,
 * ed e' l'unico movimento dell'interfaccia — proprio perche' si veda mentre si
 * sta guardando altro.
 *
 * I numeri veri (risoluzione, fotogrammi, bitrate, codec) compaiono passando
 * sopra col puntatore, e vengono da `getStats()`: sono cio' che il
 * codificatore sta facendo adesso, non cio' che gli e' stato chiesto.
 */
export default function Riquadro({
  dati,
  foto,
  mostraStatistiche,
  aFuoco,
  volumi,
  schermoIntero,
  puntatori,
  quandoPunta,
  quandoMenu,
  quandoScelto
}: {
  dati: Dati
  /** La foto profilo, se ne ha caricata una. Altrimenti restano le iniziali. */
  foto?: string | null
  mostraStatistiche: boolean
  aFuoco: boolean
  /** I cursori da mettere nel fumetto dell'altoparlante. Vuoti: niente pulsante. */
  volumi?: VoceVolume[]
  /** Solo sul riquadro grande: il vero schermo intero. */
  schermoIntero?: { attivo: boolean; alterna: () => void }
  /** I "guarda qui" da disegnare qui sopra, gia' filtrati per questo riquadro. */
  puntatori?: Puntatore[]
  /** Indica un punto: alt+clic, in frazioni di video da 0 a 1. */
  quandoPunta?: (x: number, y: number) => void
  /** Tasto destro: apre il menu del riquadro alle coordinate del puntatore. */
  quandoMenu?: (x: number, y: number) => void
  quandoScelto: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const scatola = useRef<HTMLDivElement>(null)
  const [statistiche, setStatistiche] = useState<Statistiche | null>(null)
  const [zoom, setZoom] = useState<Zoom>(FERMO)
  const [misure, setMisure] = useState<Misure>({
    larghezza: 0,
    altezza: 0,
    videoLargo: 0,
    videoAlto: 0
  })
  // Da dove e' partito il trascinamento, e se si e' mosso abbastanza da non
  // essere piu' un clic.
  const presa = useRef<{ x: number; y: number; zoom: Zoom; mosso: boolean } | null>(null)

  // Solo gli schermi si ingrandiscono: su un volto non serve, e un volto
  // trascinabile per sbaglio e' solo un modo per spostare la faccia di
  // qualcuno fuori dal riquadro.
  const ingrandibile = dati.tipo === 'schermo'

  useEffect(() => {
    const elemento = video.current
    const traccia = dati.traccia
    if (!elemento || !traccia) return

    traccia.attach(elemento)
    return () => {
      traccia.detach(elemento)
    }
  }, [dati.traccia])

  useEffect(() => {
    if (!mostraStatistiche || !dati.traccia) return
    return osserva(dati.traccia, setStatistiche)
  }, [dati.traccia, mostraStatistiche])

  /**
   * Le due misure che servono alla matematica dello zoom.
   *
   * La scatola cambia quando cambia la finestra o quando qualcuno entra; i
   * pixel veri del video cambiano quando arriva il primo fotogramma e quando
   * chi condivide cambia risoluzione. Senza il secondo, le bande nere sopra e
   * sotto verrebbero contate come parte dell'immagine, e ogni "guarda qui"
   * finirebbe qualche decina di pixel piu' in alto di dove e' stato messo.
   */
  useEffect(() => {
    const elemento = scatola.current
    if (!elemento) return

    const misura = (): void => {
      const v = video.current
      setMisure((prima) => {
        const dopo = {
          larghezza: elemento.clientWidth,
          altezza: elemento.clientHeight,
          videoLargo: v?.videoWidth ?? 0,
          videoAlto: v?.videoHeight ?? 0
        }
        return prima.larghezza === dopo.larghezza &&
          prima.altezza === dopo.altezza &&
          prima.videoLargo === dopo.videoLargo &&
          prima.videoAlto === dopo.videoAlto
          ? prima
          : dopo
      })
    }

    misura()
    const osservatore = new ResizeObserver(misura)
    osservatore.observe(elemento)

    const v = video.current
    v?.addEventListener('loadedmetadata', misura)
    v?.addEventListener('resize', misura)
    return () => {
      osservatore.disconnect()
      v?.removeEventListener('loadedmetadata', misura)
      v?.removeEventListener('resize', misura)
    }
  }, [dati.traccia])

  // Un riquadro che smette di essere grande torna a distanza normale: restare
  // ingranditi dentro a una tessera da duecento pixel non serve a nessuno.
  useEffect(() => {
    if (!aFuoco) setZoom(FERMO)
  }, [aFuoco])

  const dove = (evento: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = scatola.current!.getBoundingClientRect()
    return { x: evento.clientX - r.left, y: evento.clientY - r.top }
  }

  // Il bordo e' un elemento suo, sopra a tutto il resto.
  //
  // Le due strade ovvie falliscono tutte e due, e in modi opposti. Un `ring`
  // normale e' un'ombra disegnata *fuori* dal riquadro: nella striscia, che
  // scorre in orizzontale e quindi taglia anche sopra e sotto, spariva per
  // meta'. Portarlo dentro con `ring-inset` risolveva il taglio e creava il
  // guaio simmetrico: un'ombra interna viene disegnata sotto ai figli, e un
  // video che riempie il riquadro se la mangia tutta — bordo invisibile
  // proprio a chi ha la camera accesa.
  //
  // Un fratello in `absolute inset-0` non e' ne' fuori — quindi non si taglia —
  // ne' sotto — quindi il video non lo copre. E non prende i clic, che
  // altrimenti si fermerebbero sul bordo invece di arrivare al riquadro.
  const bordo = dati.parla
    ? 'border-2 border-ok'
    : aFuoco
      ? 'border-2 border-vivo'
      : 'border border-bordo group-hover:border-fondo-3'

  const zittito = (volumi ?? []).some((voce) => voce.muto)

  /** Vero per un istante dopo un trascinamento: serve a mangiarsi il clic dopo. */
  const pretesa = useRef(false)

  const rotella = (evento: React.WheelEvent): void => {
    if (!ingrandibile || !aFuoco) return
    evento.preventDefault()
    // Un passo moltiplicativo e non additivo: da 1 a 2 e da 4 a 8 devono
    // costare lo stesso numero di scatti, altrimenti in alto si striscia.
    const passo = Math.exp(-evento.deltaY * 0.0015)
    setZoom((prima) => versoIlPuntatore(prima, prima.scala * passo, dove(evento), misure))
  }

  const premuto = (evento: React.PointerEvent): void => {
    if (!ingrandibile || zoom.scala <= 1) return
    presa.current = { ...dove(evento), zoom, mosso: false }
    ;(evento.target as HTMLElement).setPointerCapture?.(evento.pointerId)
  }

  const mosso = (evento: React.PointerEvent): void => {
    const da = presa.current
    if (!da) return
    const adesso = dove(evento)
    const dx = adesso.x - da.x
    const dy = adesso.y - da.y
    if (Math.abs(dx) + Math.abs(dy) > 3) presa.current = { ...da, mosso: true }
    setZoom(limita({ scala: da.zoom.scala, x: da.zoom.x + dx, y: da.zoom.y + dy }, misure))
  }

  const lasciato = (): void => {
    // Un trascinamento non e' un clic: senza questa riga, ogni spostamento
    // dell'immagine toglierebbe anche il fuoco al riquadro.
    if (presa.current?.mosso) pretesa.current = true
    presa.current = null
  }

  /**
   * Cosa vuol dire un clic, e dipende da cosa c'e' sotto.
   *
   * Su una persona mette a fuoco, come sempre. Su uno schermo condiviso
   * **indica**: e' il gesto che si fa dieci volte in una sessione, e mettere
   * a fuoco — che si fa una volta — se lo prendeva tutto. La
   * sovraimpressione e' rimasta, ma sull'icona in alto a destra, dove sta
   * una cosa che si preme di rado.
   *
   * Dopo un trascinamento non succede niente: si stava spostando l'immagine,
   * non indicando un punto.
   */
  const cliccato = (evento: React.MouseEvent): void => {
    if (pretesa.current) {
      pretesa.current = false
      return
    }
    if (quandoPunta && dati.traccia) {
      const frazione = versoContenuto(dove(evento), zoom, misure)
      quandoPunta(frazione.x, frazione.y)
      return
    }
    quandoScelto()
  }

  return (
    <div
      ref={scatola}
      onClick={cliccato}
      onContextMenu={(e) => {
        if (!quandoMenu) return
        // Senza questo esce il menu di Chromium ("Ricarica", "Ispeziona"), che
        // dentro a un'applicazione non ha senso di esistere.
        e.preventDefault()
        quandoMenu(e.clientX, e.clientY)
      }}
      onWheel={rotella}
      onPointerDown={premuto}
      onPointerMove={mosso}
      onPointerUp={lasciato}
      onPointerCancel={lasciato}
      onDoubleClick={() => !quandoPunta && ingrandibile && setZoom(FERMO)}
      className={`group relative h-full w-full overflow-hidden rounded-xl bg-fondo-2 ${
        dati.tipo === 'schermo' ? 'bg-black' : ''
      } ${quandoPunta ? 'cursor-crosshair' : aFuoco ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
    >
      {/* Il bordo, sopra a tutto e senza rubare i clic. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 rounded-xl transition-colors duration-150 ${bordo}`}
      />
      {dati.traccia ? (
        <video
          ref={video}
          // Il proprio video non deve mai suonare: sarebbe il ritorno di se'
          // stessi con qualche decimo di ritardo, che e' insopportabile.
          muted={dati.locale}
          autoPlay
          playsInline
          // `contain` sugli schermi: un 16:10 dentro a un riquadro 16:9 va
          // mostrato intero con due bande, non tagliato — il pezzo tagliato e'
          // sempre quello che serviva. Sulle camere invece `cover`, perche' un
          // volto con le bande nere ai lati sta male e non si perde niente.
          className={`h-full w-full ${dati.tipo === 'schermo' ? 'object-contain' : 'object-cover'}`}
          style={
            zoom.scala > 1
              ? {
                  transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scala})`,
                  // Niente transizione: durante il trascinamento l'immagine
                  // deve stare sotto al dito, non rincorrerlo.
                  transformOrigin: 'center',
                  cursor: 'grab'
                }
              : undefined
          }
        />
      ) : (
        <Avatar dati={dati} foto={foto} />
      )}

      {dati.inArrivo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="respiro text-sm text-testo-3">arriva…</span>
        </div>
      )}

      {/* I comandi, in alto a destra e solo passandoci sopra: un riquadro che
          mostra sempre tre pulsanti e' un riquadro che mostra meno video.
          `focus-within` li tiene visibili mentre il fumetto del volume e'
          aperto, altrimenti sparirebbero da sotto al puntatore. */}
      <div
        onClick={(evento) => evento.stopPropagation()}
        className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        {volumi && volumi.length > 0 && (
          <BottoneVolume
            voci={volumi}
            titolo={`Volume di ${dati.nome}`}
            verso="sotto"
            variante="riquadro"
          />
        )}

        {schermoIntero && (
          <Comando
            titolo={schermoIntero.attivo ? 'Esci da tutto schermo' : 'A tutto schermo'}
            premi={schermoIntero.alterna}
          >
            {schermoIntero.attivo ? (
              <SchermoNormale className="h-4 w-4" />
            ) : (
              <SchermoIntero className="h-4 w-4" />
            )}
          </Comando>
        )}

        <Comando
          titolo={
            aFuoco
              ? 'Rimetti nella griglia'
              : quandoPunta
                ? 'Metti a fuoco — sullo schermo il clic serve a indicare'
                : 'Metti a fuoco'
          }
          premi={quandoScelto}
        >
          {aFuoco ? (
            <Rimpicciolisci className="h-4 w-4" />
          ) : (
            <Ingrandisci className="h-4 w-4" />
          )}
        </Comando>
      </div>

      {/* I "guarda qui". Sopra al video ma sotto ai comandi, e trasparenti ai
          clic: indicare non deve rubare la possibilita' di cliccare. */}
      {(puntatori ?? []).map((puntatore) => {
        const punto = versoElemento(puntatore, zoom, misure)
        return (
          <div
            key={puntatore.id}
            className="pointer-events-none absolute z-[15]"
            style={{ left: punto.x, top: punto.y }}
          >
            <span
              className="alone absolute rounded-full"
              style={{ borderColor: puntatore.colore }}
            />
            <span
              className="alone ritardo absolute rounded-full"
              style={{ borderColor: puntatore.colore }}
            />
            <span
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: puntatore.colore, boxShadow: `0 0 10px ${puntatore.colore}` }}
            />
            <span className="svanisci absolute top-4 left-0 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white">
              {puntatore.nome}
            </span>
          </div>
        )
      })}

      {zoom.scala > 1 && (
        <div
          onClick={(evento) => {
            evento.stopPropagation()
            setZoom(FERMO)
          }}
          title="Torna a grandezza naturale (doppio clic)"
          className="numeri absolute top-2 left-2 z-20 flex cursor-pointer items-center gap-1 rounded-lg bg-black/65 px-2 py-1 text-[11px] text-white/80 backdrop-blur-sm hover:bg-black/85"
        >
          <Lente className="h-3.5 w-3.5" />
          {zoom.scala.toFixed(1).replace('.', ',')}×
        </div>
      )}

      {/* Il nome, sempre visibile ma discreto. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-8 pb-2">
        <div className="flex items-center gap-1.5 text-xs">
          {dati.moderatore && (
            <span title="Modera questa stanza" className="shrink-0 text-attenzione">
              <Stella className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate font-medium text-white/90">
            {dati.nome}
            {dati.locale && <span className="font-normal text-white/50"> (tu)</span>}
          </span>
          {dati.etichetta && <span className="truncate text-white/50">· {dati.etichetta}</span>}

          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* Chi ho zittito io e chi si e' zittito da solo sono due silenzi
                diversi, e vanno distinti senza dover andare a cercare dove si
                era lasciato il cursore. */}
            {zittito && (
              <span title="L'hai zittito tu" className="text-male/90">
                <AltoparlanteMuto className="h-3.5 w-3.5" />
              </span>
            )}
            {dati.tipo === 'persona' && !dati.microfonoAcceso && (
              <span title="Microfono spento" className="text-white/45">
                <MicrofonoSpento className="h-3.5 w-3.5" />
              </span>
            )}
          </span>
        </div>
      </div>

      {mostraStatistiche && statistiche && <Numeri statistiche={statistiche} locale={dati.locale} />}
    </div>
  )
}

/** Un pulsante dei comandi sopra al video: vetro scuro, e con un nome. */
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
      onClick={premi}
      title={titolo}
      aria-label={titolo}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
    >
      {children}
    </button>
  )
}

/**
 * L'avatar, quando la camera e' spenta.
 *
 * Iniziali su un colore ricavato dall'identita'. Un alone dello stesso colore
 * dietro, che pulsa piano quando parla: il bordo verde dice *chi*, l'alone lo
 * dice anche a chi sta guardando il riquadro da vicino invece che la griglia.
 *
 * Le iniziali sono disegnate dentro a un SVG e non scritte in HTML, e non e'
 * un vezzo: il riquadro cambia misura di continuo — grande a fuoco, minuscolo
 * nella striscia — e un `font-size` in pixel andrebbe bene a una sola di
 * quelle misure. Dentro al `viewBox` la scritta scala insieme al cerchio, da
 * sola e senza calcoli.
 */
function Avatar({ dati, foto }: { dati: Dati; foto?: string | null }): React.JSX.Element {
  const colore = coloreDi(dati.identita)

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative aspect-square h-[42%] max-h-28 min-h-9">
        <div
          className={`absolute -inset-[12%] rounded-full transition-opacity duration-200 ${
            dati.parla ? 'opacity-25' : 'opacity-0'
          }`}
          style={{ background: colore }}
        />
        {foto ? (
          <img src={foto} alt="" className="relative h-full w-full rounded-full object-cover" />
        ) : (
          <svg viewBox="0 0 100 100" className="relative h-full w-full select-none" aria-hidden="true">
            <circle cx="50" cy="50" r="50" fill={colore} />
            <text
              x="50"
              y="50"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="38"
              fontWeight="600"
              fill="rgba(0,0,0,0.75)"
            >
              {inizialiDi(dati.nome)}
            </text>
          </svg>
        )}
      </div>
    </div>
  )
}

function Numeri({
  statistiche,
  locale
}: {
  statistiche: Statistiche
  locale: boolean
}): React.JSX.Element {
  const { larghezza, altezza, fps, bitrate, codec, perdita, motivoRiduzione } = statistiche

  return (
    // In alto a sinistra: a destra ci sono i comandi, che comparendo
    // finirebbero sopra ai numeri proprio mentre si sta cercando di leggerli.
    <div className="numeri pointer-events-none absolute top-2 left-2 space-y-0.5 rounded-lg bg-black/65 px-2 py-1.5 text-[11px] leading-tight text-white/70 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
      {larghezza && altezza && (
        <div>
          {larghezza}×{altezza}
          {fps != null && <span className="text-white/45"> · {fps} fps</span>}
        </div>
      )}
      {bitrate != null && (
        <div>
          {bitrateLeggibile(bitrate)}
          {codec && <span className="text-white/45"> · {codec}</span>}
        </div>
      )}
      {perdita != null && perdita > 1 && (
        <div className="text-attenzione">{perdita.toFixed(1).replace('.', ',')}% perso</div>
      )}
      {/* La riga che risponde a "perche' si vede male" senza doverlo dedurre. */}
      {locale && motivoRiduzione && (
        <div className="text-attenzione">
          {motivoRiduzione === 'cpu' ? 'riduco: processore' : 'riduco: banda'}
        </div>
      )}
    </div>
  )
}
