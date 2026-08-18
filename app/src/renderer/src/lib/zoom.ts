/**
 * Zoom, trascinamento, e il punto esatto in cui qualcuno sta indicando.
 *
 * Sono la stessa matematica letta nei due versi, ed e' il motivo per cui
 * stanno in un file solo. Un riquadro mostra un video con `object-contain`:
 * dentro a una scatola 16:9 uno schermo 16:10 lascia due bande, e i pixel veri
 * occupano solo una parte della scatola. Sopra a questo c'e' la trasformazione
 * dello zoom. Per sapere dove ha cliccato uno si va da fuori a dentro, per
 * disegnare dove ha indicato un altro si va da dentro a fuori.
 *
 * Le coordinate che viaggiano fra le persone sono sempre normalizzate sul
 * *contenuto*, da 0 a 1: chi indica ha il riquadro grande e chi guarda ce l'ha
 * nella striscia, e un numero di pixel non vorrebbe dire niente per l'altro.
 */

export interface Zoom {
  scala: number
  /** Lo spostamento, in pixel dell'elemento, applicato dopo la scala. */
  x: number
  y: number
}

export const FERMO: Zoom = { scala: 1, x: 0, y: 0 }

export const SCALA_MASSIMA = 8

export interface Misure {
  /** La scatola: quanto e' grande il riquadro. */
  larghezza: number
  altezza: number
  /** I pixel veri del video. Zero finche' non e' arrivato il primo fotogramma. */
  videoLargo: number
  videoAlto: number
}

/**
 * Dove sta davvero il video dentro alla scatola, prima dello zoom.
 *
 * Con `object-contain` il video sta tutto dentro e avanza spazio su due lati;
 * con `object-cover` riempie e viene tagliato. Le camere usano il secondo, gli
 * schermi il primo — e per gli schermi, che sono gli unici su cui si indica e
 * si ingrandisce, conta questo.
 */
export function contenuto(m: Misure): { x: number; y: number; larghezza: number; altezza: number } {
  if (!m.videoLargo || !m.videoAlto || !m.larghezza || !m.altezza) {
    return { x: 0, y: 0, larghezza: m.larghezza, altezza: m.altezza }
  }

  const rapportoVideo = m.videoLargo / m.videoAlto
  const rapportoScatola = m.larghezza / m.altezza

  if (rapportoVideo > rapportoScatola) {
    const altezza = m.larghezza / rapportoVideo
    return { x: 0, y: (m.altezza - altezza) / 2, larghezza: m.larghezza, altezza }
  }
  const larghezza = m.altezza * rapportoVideo
  return { x: (m.larghezza - larghezza) / 2, y: 0, larghezza, altezza: m.altezza }
}

/**
 * Da un punto sul riquadro alla frazione di video che c'e' sotto.
 *
 * E' l'inverso esatto di `transform: translate(...) scale(...)` con l'origine
 * al centro, che e' quello che il CSS sta applicando al video.
 */
export function versoContenuto(
  punto: { x: number; y: number },
  zoom: Zoom,
  m: Misure
): { x: number; y: number } {
  const cx = m.larghezza / 2
  const cy = m.altezza / 2

  // Prima si torna indietro dallo zoom, poi si toglie la banda nera.
  const senzaZoom = {
    x: cx + (punto.x - zoom.x - cx) / zoom.scala,
    y: cy + (punto.y - zoom.y - cy) / zoom.scala
  }

  const c = contenuto(m)
  return {
    x: fra(0, 1, (senzaZoom.x - c.x) / c.larghezza),
    y: fra(0, 1, (senzaZoom.y - c.y) / c.altezza)
  }
}

/** E il viaggio di ritorno: dalla frazione al punto dove disegnare. */
export function versoElemento(
  frazione: { x: number; y: number },
  zoom: Zoom,
  m: Misure
): { x: number; y: number } {
  const c = contenuto(m)
  const senzaZoom = { x: c.x + frazione.x * c.larghezza, y: c.y + frazione.y * c.altezza }

  const cx = m.larghezza / 2
  const cy = m.altezza / 2
  return {
    x: cx + (senzaZoom.x - cx) * zoom.scala + zoom.x,
    y: cy + (senzaZoom.y - cy) * zoom.scala + zoom.y
  }
}

/**
 * Ingrandisce tenendo fermo il punto sotto al puntatore.
 *
 * E' la differenza fra uno zoom che si usa e uno che fa arrabbiare: se il
 * centro fosse sempre quello del riquadro, per guardare una riga di codice in
 * un angolo bisognerebbe ingrandire e poi rincorrerla trascinando.
 */
export function versoIlPuntatore(zoom: Zoom, scalaNuova: number, punto: { x: number; y: number }, m: Misure): Zoom {
  const scala = fra(1, SCALA_MASSIMA, scalaNuova)
  const cx = m.larghezza / 2
  const cy = m.altezza / 2

  // Il punto fermo, in coordinate non trasformate.
  const fermo = {
    x: cx + (punto.x - zoom.x - cx) / zoom.scala,
    y: cy + (punto.y - zoom.y - cy) / zoom.scala
  }

  return limita(
    {
      scala,
      x: punto.x - (cx + (fermo.x - cx) * scala),
      y: punto.y - (cy + (fermo.y - cy) * scala)
    },
    m
  )
}

/**
 * Tiene il video attaccato ai bordi.
 *
 * Senza, trascinando si porta l'immagine fuori dal riquadro e si resta a
 * guardare il nero, senza capire dove sia finita — e l'unico modo per
 * ritrovarla sarebbe azzerare tutto.
 */
export function limita(zoom: Zoom, m: Misure): Zoom {
  if (zoom.scala <= 1) return FERMO

  const c = contenuto(m)
  // Di quanto puo' spostarsi: meta' della crescita, per lato.
  const massimoX = Math.max(0, (c.larghezza * zoom.scala - m.larghezza) / 2 + (m.larghezza - c.larghezza) / 2)
  const massimoY = Math.max(0, (c.altezza * zoom.scala - m.altezza) / 2 + (m.altezza - c.altezza) / 2)

  return {
    scala: zoom.scala,
    x: fra(-massimoX, massimoX, zoom.x),
    y: fra(-massimoY, massimoY, zoom.y)
  }
}

function fra(minimo: number, massimo: number, valore: number): number {
  return Math.min(massimo, Math.max(minimo, valore))
}
