import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * L'indirizzo del server da mettere nel campo d'accesso, deciso al momento
 * della compilazione.
 *
 * Sta fuori dal codice apposta: nel repo l'app deve restare neutra, perche'
 * chi la scarica la punta al proprio server. Ma le build fatte qui, per i
 * propri colleghi, devono avere l'indirizzo gia' scritto — dettarlo a voce
 * significa vederselo sbagliare.
 *
 * Due modi, in ordine: la variabile d'ambiente PULSETALK_SERVER, oppure un
 * file `server.local` accanto a questo, che git ignora.
 */
function serverPredefinito(): string {
  if (process.env.PULSETALK_SERVER) return process.env.PULSETALK_SERVER.trim()
  const file = resolve('server.local')
  if (existsSync(file)) {
    // Si scartano righe vuote e commenti: e' un file che si apre col blocco
    // note, e prima o poi ci si scrive dentro una nota.
    const riga = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((r) => r.trim())
      .find((r) => r && !r.startsWith('#'))
    if (riga) return riga
  }
  return ''
}

const costanti = {
  __SERVER_PREDEFINITO__: JSON.stringify(serverPredefinito())
}

export default defineConfig({
  main: {
    define: costanti,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    define: costanti,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    define: costanti,
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
