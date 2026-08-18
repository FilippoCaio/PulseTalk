// La stessa interfaccia, costruita per il browser.
//
// Non e' un secondo client: e' lo stesso sorgente di `src/renderer`, con lo
// stesso ponte, che a runtime si accorge di non essere dentro Electron e si
// arrangia — il selettore delle sorgenti diventa quello di Chrome, l'audio di
// sistema resta una spunta nella finestra del browser invece che una scelta
// nella nostra, e tutto il resto e' identico.
//
// Il risultato finisce in `server/public`, che il piano di controllo serve
// alla radice: chi non vuole installare niente apre talk.<dominio> e entra.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const USCITA = resolve(import.meta.dirname, '../server/public')

/**
 * Rimette il segnaposto che `emptyOutDir` ha appena cancellato.
 *
 * Serve al Dockerfile, che copia `public/` comunque: senza un file dentro, la
 * cartella non esiste in git, e la COPY fa fallire la build dell'immagine di
 * chi non ha costruito il client web. Senza questa riga il segnaposto
 * risulterebbe cancellato dopo ogni build, in ogni diff.
 */
function tieniIlSegnaposto(): Plugin {
  return {
    name: 'pulse-talk-segnaposto',
    closeBundle() {
      writeFileSync(
        resolve(USCITA, '.gitkeep'),
        'L\'app web costruita finisce qui: `npm run build:web` dentro ../app la scrive\n' +
          'in questa cartella, e il server la serve alla radice.\n\n' +
          'La cartella esiste anche vuota perche\' il Dockerfile la copia comunque, e una\n' +
          'COPY di qualcosa che non c\'e\' fa fallire la build dell\'immagine.\n'
      )
    }
  }
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  // Percorsi relativi: l'app funziona anche se un giorno la si serve da una
  // sottocartella invece che dalla radice.
  base: './',
  plugins: [react(), tailwindcss(), tieniIlSegnaposto()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: USCITA,
    emptyOutDir: true,
    // La versione web gira su browser veri, non solo su quello di Electron:
    // il bersaglio e' piu' prudente di quello del renderer.
    target: 'es2022'
  },
  server: {
    port: 5174
  }
})
