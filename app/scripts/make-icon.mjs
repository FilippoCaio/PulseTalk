import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * L'icona, disegnata invece che disegnata.
 *
 * Nessuna dipendenza: si riempie un rettangolo di pixel, lo si comprime in PNG
 * a mano e lo si impacchetta in un .ico. La macchina dei PNG e' la stessa del
 * Companion — funziona, e riscriverla sarebbe stato un modo di passare il
 * pomeriggio.
 *
 * Il disegno: un profilo rivolto a destra, e tre lineette che gli escono dalla
 * bocca. Tutto a tratto e niente riempito, con lo stesso spessore ovunque: un
 * disegno a linea con due spessori diversi sembra due disegni accostati.
 *
 * Lo spessore e' la cosa che ha richiesto piu' tentativi, perche' tira in due
 * direzioni. Sottile abbastanza da far vedere labbra e mento a 256 pixel e'
 * troppo sottile per sopravvivere a 32; spesso abbastanza per 32 chiude i
 * dettagli a 256. La via d'uscita non e' stata lo spessore ma il tracciato:
 * lungo la faccia la linea **scende sempre** e ondeggia di lato, invece di
 * tornare indietro su se stessa come faceva prima. Un dente di sega si chiude
 * da solo appena il tratto diventa piu' largo dello scarto; un'onda no,
 * qualunque spessore abbia.
 *
 * A 16 pixel resta un contorno con un bozzo al posto del naso. E' il limite del
 * tratto a quella misura, e vale per qualunque faccia; le tre lineette invece
 * si leggono, e sono quelle che dicono di cosa si tratta.
 *
 *    node scripts/make-icon.mjs   ->   build/icon.ico + build/icona.png
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const MISURE = [16, 24, 32, 48, 64, 128, 256]

const FONDO = [11, 14, 20, 255]
const VIVO = [79, 156, 249, 255]

/**
 * Il profilo della faccia, in coordinate 0..1 sul lato dell'icona.
 *
 * E' un poligono e non delle curve perche' il rasterizzatore qui sotto sa fare
 * una cosa sola — dire se un punto sta dentro o fuori — e con abbastanza
 * vertici la differenza dalle curve non si vede nemmeno a 256 pixel. A 16 non
 * si vedrebbe comunque, ed e' quella la misura che conta.
 *
 * Si legge in senso orario dalla cima della testa: fronte, arcata, naso,
 * labbra, mento, mascella, e la nuca che risale.
 */
const PROFILO = [
  // Fronte.
  [0.230, 0.200], [0.298, 0.210], [0.352, 0.238], [0.392, 0.278],
  [0.416, 0.325], [0.426, 0.372],
  // L'incavo del sopracciglio.
  [0.406, 0.404], [0.400, 0.418],
  // Naso, con la punta arrotondata.
  [0.418, 0.446], [0.440, 0.478], [0.462, 0.506], [0.482, 0.532],
  [0.488, 0.546], [0.476, 0.558], [0.452, 0.566], [0.424, 0.574],
  // Labbra, bocca, mento.
  //
  // Qui conta il *passo verticale* fra un'inversione e l'altra, piu' della
  // larghezza dello sbalzo: se due inversioni distano meno del doppio del
  // tratto, i due lati della curva si saldano e al posto della bocca resta un
  // nodo. Con un tratto grosso le inversioni devono quindi essere poche e
  // distanti — due in tutto il volto basso, non quattro.
  [0.448, 0.610], [0.466, 0.646], [0.450, 0.682], [0.430, 0.718],
  [0.450, 0.746], [0.464, 0.774],
  // Mascella, e la linea finisce qui.
  [0.436, 0.798], [0.386, 0.812], [0.330, 0.818]
]










/**
 * Le tre lineette della voce, all'altezza della bocca.
 *
 * La piu' lunga e' quella di mezzo. Tre segmenti uguali sembrerebbero il menu
 * a panino di una pagina web; tre disuguali sembrano qualcosa che esce.
 */
const VOCE = [
  { y: 0.468, da: 0.578, a: 0.692 },
  { y: 0.6, da: 0.578, a: 0.776 },
  { y: 0.732, da: 0.578, a: 0.692 }
]


/** Quanto dista un punto da un segmento. Le lineette sono capsule: distanza e raggio. */
function distanzaDalSegmento(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const quadrato = dx * dx + dy * dy
  const t = quadrato === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / quadrato))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/**
 * Quanto di questo pixel e' coperto dalla figura, fra 0 e 1.
 *
 * Si campiona una griglia dentro al pixel invece di chiedere "il centro sta
 * dentro?": senza, il naso e il mento diventano una scaletta, ed e' proprio
 * sui bordi obliqui che si riconosce una faccia.
 */
function copertura(x, y, lato, sta) {
  const PASSI = 4
  let dentroQuanti = 0
  for (let sy = 0; sy < PASSI; sy += 1) {
    for (let sx = 0; sx < PASSI; sx += 1) {
      const px = (x + (sx + 0.5) / PASSI) / lato
      const py = (y + (sy + 0.5) / PASSI) / lato
      if (sta(px, py)) dentroQuanti += 1
    }
  }
  return dentroQuanti / (PASSI * PASSI)
}

/**
 * Quanto dista un punto da una spezzata **aperta**.
 *
 * Aperta e non chiusa, ed e' tutta la differenza fra un viso e una testa: qui
 * l'ultimo vertice non torna al primo, quindi la nuca non viene disegnata e
 * il profilo resta una linea sola — fronte, naso, labbra, mento — che comincia
 * e finisce nel vuoto.
 */
function distanzaDallaLinea(px, py, punti) {
  let minima = Infinity
  for (let i = 0; i < punti.length - 1; i += 1) {
    const [x0, y0] = punti[i]
    const [x1, y1] = punti[i + 1]
    const d = distanzaDalSegmento(px, py, x0, y0, x1, y1)
    if (d < minima) minima = d
  }
  return minima
}

function disegna(lato) {
  const pixel = Buffer.alloc(lato * lato * 4)
  const raggio = lato * 0.22

  const metti = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= lato || y >= lato) return
    const dove = (y * lato + x) * 4
    const alfa = a / 255
    pixel[dove] = Math.round(pixel[dove] * (1 - alfa) + r * alfa)
    pixel[dove + 1] = Math.round(pixel[dove + 1] * (1 - alfa) + g * alfa)
    pixel[dove + 2] = Math.round(pixel[dove + 2] * (1 - alfa) + b * alfa)
    pixel[dove + 3] = Math.max(pixel[dove + 3], a)
  }

  // Il fondo, con gli angoli arrotondati.
  for (let y = 0; y < lato; y += 1) {
    for (let x = 0; x < lato; x += 1) {
      const dx = Math.max(raggio - x, x - (lato - raggio - 1), 0)
      const dy = Math.max(raggio - y, y - (lato - raggio - 1), 0)
      const quanto = Math.max(0, Math.min(1, raggio - Math.hypot(dx, dy) + 0.5))
      if (quanto > 0) metti(x, y, [FONDO[0], FONDO[1], FONDO[2], Math.round(255 * quanto)])
    }
  }

  // Lo spessore del tratto scala con l'icona, ma non scende sotto il pixel: a
  // 16 px una linea di mezzo pixel sparirebbe del tutto. E' lo stesso per il
  // profilo e per le lineette — un disegno a tratto con due spessori diversi
  // sembra due disegni accostati.
  const spessore = Math.max(2.2 / lato, 0.036) / 2

  // Specchiato: il viso guarda a sinistra e la voce gli esce da quella parte.
  //
  // Si ribalta il punto invece dei dati — `1 - px` invece di riscrivere
  // trentadue coppie di numeri — cosi' le coordinate qui sopra restano leggibili
  // da sinistra a destra come si disegna una faccia, e tornare indietro e' una
  // riga sola.
  const faccia = (px, py) => distanzaDallaLinea(1 - px, py, PROFILO) <= spessore
  const voce = (px, py) =>
    VOCE.some((l) => distanzaDalSegmento(1 - px, py, l.da, l.y, l.a, l.y) <= spessore)

  for (let y = 0; y < lato; y += 1) {
    for (let x = 0; x < lato; x += 1) {
      const suFaccia = copertura(x, y, lato, faccia)
      if (suFaccia > 0) metti(x, y, [VIVO[0], VIVO[1], VIVO[2], Math.round(255 * suFaccia)])
      const suVoce = copertura(x, y, lato, voce)
      if (suVoce > 0) metti(x, y, [VIVO[0], VIVO[1], VIVO[2], Math.round(255 * suVoce)])
    }
  }

  return pixel
}

// --- PNG a mano --------------------------------------------------------------

const TABELLA_CRC = (() => {
  const tabella = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabella[n] = c >>> 0
  }
  return tabella
})()

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = TABELLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function blocco(tipo, dati) {
  const lunghezza = Buffer.alloc(4)
  lunghezza.writeUInt32BE(dati.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([lunghezza, corpo, crc])
}

function png(pixel, lato) {
  const intestazione = Buffer.alloc(13)
  intestazione.writeUInt32BE(lato, 0)
  intestazione.writeUInt32BE(lato, 4)
  intestazione[8] = 8 // otto bit per canale
  intestazione[9] = 6 // con trasparenza
  intestazione[10] = 0
  intestazione[11] = 0
  intestazione[12] = 0

  // Ogni riga vuole davanti il byte del filtro; zero vuol dire "nessuno".
  const grezzo = Buffer.alloc(lato * (lato * 4 + 1))
  for (let y = 0; y < lato; y += 1) {
    grezzo[y * (lato * 4 + 1)] = 0
    pixel.copy(grezzo, y * (lato * 4 + 1) + 1, y * lato * 4, (y + 1) * lato * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco('IHDR', intestazione),
    blocco('IDAT', deflateSync(grezzo, { level: 9 })),
    blocco('IEND', Buffer.alloc(0))
  ])
}

// --- il contenitore .ico -----------------------------------------------------

function ico(immagini) {
  const indice = Buffer.alloc(6 + immagini.length * 16)
  indice.writeUInt16LE(0, 0)
  indice.writeUInt16LE(1, 2)
  indice.writeUInt16LE(immagini.length, 4)

  let posizione = indice.length
  immagini.forEach((immagine, i) => {
    const dove = 6 + i * 16
    // 256 si scrive come 0: il campo e' un byte solo, e la convenzione e'
    // che zero significhi "il massimo".
    indice[dove] = immagine.lato >= 256 ? 0 : immagine.lato
    indice[dove + 1] = immagine.lato >= 256 ? 0 : immagine.lato
    indice[dove + 2] = 0
    indice[dove + 3] = 0
    indice.writeUInt16LE(1, dove + 4)
    indice.writeUInt16LE(32, dove + 6)
    indice.writeUInt32LE(immagine.dati.length, dove + 8)
    indice.writeUInt32LE(posizione, dove + 12)
    posizione += immagine.dati.length
  })

  return Buffer.concat([indice, ...immagini.map((immagine) => immagine.dati)])
}

const immagini = MISURE.map((lato) => ({ lato, dati: png(disegna(lato), lato) }))

const cartella = join(HERE, '..', 'build')
mkdirSync(cartella, { recursive: true })

const percorsoIco = join(cartella, 'icon.ico')
writeFileSync(percorsoIco, ico(immagini))

// Il PNG serve alla finestra durante lo sviluppo: BrowserWindow su Windows
// legge volentieri un .png, e non obbliga a ricostruire l'.ico per vedere
// l'icona giusta nella barra delle applicazioni.
const percorsoPng = join(cartella, 'icona.png')
writeFileSync(percorsoPng, png(disegna(256), 256))

// Android usa lo stesso segno, senza mantenere una seconda icona disegnata a
// mano che prima o poi divergerebbe. Il sistema applica da solo la maschera
// dell'icona prevista dal launcher del telefono.
const cartellaAndroid = join(HERE, '..', 'android', 'app', 'src', 'main', 'res', 'drawable')
mkdirSync(cartellaAndroid, { recursive: true })
const percorsoAndroid = join(cartellaAndroid, 'ic_launcher_pulsetalk.png')
writeFileSync(percorsoAndroid, png(disegna(256), 256))

console.log(`icona: ${percorsoIco} (${MISURE.join(', ')} px)`)
console.log(`png:   ${percorsoPng}`)
console.log(`android: ${percorsoAndroid}`)
