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
 * Il disegno invece e' altro: cinque barre di altezza diversa, un misuratore di
 * livello. Si riconosce a 16 pixel, che e' l'unica cosa che conta per un'icona.
 *
 *    node scripts/make-icon.mjs   ->   build/icon.ico + build/icona.png
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const MISURE = [16, 24, 32, 48, 64, 128, 256]

const FONDO = [11, 14, 20, 255]
const VIVO = [79, 156, 249, 255]
const SPENTO = [45, 90, 150, 255]

// Le altezze delle cinque barre, in frazioni del lato. La terza e' la piu'
// alta: un misuratore simmetrico sembra un grafico, uno asimmetrico sembra una
// voce.
const BARRE = [0.34, 0.62, 0.86, 0.5, 0.24]

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
      const copertura = Math.max(0, Math.min(1, raggio - Math.hypot(dx, dy) + 0.5))
      if (copertura > 0) metti(x, y, [FONDO[0], FONDO[1], FONDO[2], Math.round(255 * copertura)])
    }
  }

  // Le barre. Larghezza e spazio ricavati dal lato, cosi' a 16 px restano
  // cinque colonne distinte invece di una macchia.
  const larghezzaTotale = lato * 0.62
  const passo = larghezzaTotale / BARRE.length
  const spessore = Math.max(1, passo * 0.52)
  const primoX = (lato - larghezzaTotale) / 2 + (passo - spessore) / 2
  const centroY = lato / 2
  const arrotonda = spessore / 2

  BARRE.forEach((frazione, indice) => {
    const altezza = lato * frazione
    const x0 = primoX + indice * passo
    const y0 = centroY - altezza / 2
    // Le barre esterne piu' spente: da' profondita' senza aggiungere forme.
    const colore = indice === 0 || indice === BARRE.length - 1 ? SPENTO : VIVO

    for (let y = Math.floor(y0); y < Math.ceil(y0 + altezza); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + spessore); x += 1) {
        // Le estremita' arrotondate: quanto il pixel dista dal rettangolo
        // interno, come per gli angoli del fondo.
        const dx = Math.max(x0 + arrotonda - x, x - (x0 + spessore - arrotonda - 1), 0)
        const dy = Math.max(y0 + arrotonda - y, y - (y0 + altezza - arrotonda - 1), 0)
        const copertura = Math.max(0, Math.min(1, arrotonda - Math.hypot(dx, dy) + 0.5))
        if (copertura > 0) metti(x, y, [colore[0], colore[1], colore[2], Math.round(255 * copertura)])
      }
    }
  })

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

console.log(`icona: ${percorsoIco} (${MISURE.join(', ')} px)`)
console.log(`png:   ${percorsoPng}`)
