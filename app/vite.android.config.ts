import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * L'indirizzo del server da mettere nel campo d'accesso, deciso al momento
 * della compilazione.
 *
 * **Di serie non c'e' niente, ed e' voluto.** PulseTalk non e' un servizio: e'
 * un programma che gira sulla macchina di qualcuno, e non esiste un indirizzo
 * giusto da mettere qui. Con un indirizzo scritto dentro, l'applicazione si
 * apriva "gia' da qualche parte" — e chi la installava per collegarsi al server
 * di un amico si trovava davanti l'indirizzo di un altro da cancellare.
 *
 * Vuoto, invece, la prima schermata chiede dove andare. Che e' anche l'ordine
 * giusto delle cose: un account esiste dentro a un server e non prima, e il
 * codice di invito che si incolla vale per quel server soltanto.
 *
 * Prima qui si leggeva anche `server.local`. Quel file resta, ma per il
 * mestiere che aveva davvero: dire agli script di rilascio dove sta il feed
 * degli aggiornamenti. Che facesse anche da indirizzo di serie era un effetto
 * collaterale, non una decisione.
 *
 * Chi distribuisce l'app ai suoi e vuole comunque l'indirizzo gia' scritto lo
 * chiede per nome:
 *
 *     PULSETALK_SERVER=https://talk.casa.it npm run build
 */
function serverPredefinito(): string {
  return process.env.PULSETALK_SERVER?.trim() ?? ''
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  define: {
    __SERVER_PREDEFINITO__: JSON.stringify(serverPredefinito())
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/android'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
