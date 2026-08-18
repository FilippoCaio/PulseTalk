import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/tipi'
import type { StatoAggiornamento } from '@shared/tipi'

// electron-updater e' CommonJS: l'export nominato non esiste, si passa dal
// default. Scritto `import { autoUpdater }` compila e poi esplode a runtime.
const { autoUpdater } = electronUpdater

/**
 * Il controllo degli aggiornamenti.
 *
 * Regole di questa implementazione, tutte e tre volute:
 *
 *  - **non scarica da solo.** Cerca all'avvio, dice cosa ha trovato, e aspetta.
 *    Trecento megabyte partiti da soli mentre uno e' in chiamata sono un modo
 *    sicuro di far saltare la chiamata.
 *  - **non installa mentre si parla.** L'installazione chiude l'app: chiederla
 *    a chi sta in una stanza vocale significa buttarlo fuori a meta' frase. Il
 *    pulsante lo sa e lo dice.
 *  - **tace se non c'e' niente.** Un aggiornamento assente non e' una notizia.
 *
 * Il portabile resta fuori: si aggiorna sostituendo il file, ed e' gia' cio'
 * che uno si aspetta da un portabile. Provarci sopra darebbe solo un errore
 * che nessuno puo' risolvere.
 */
export function preparaAggiornamenti(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  let stato: StatoAggiornamento = { fase: 'fermo', versione: app.getVersion() }

  const avvisa = (nuovo: Partial<StatoAggiornamento>): void => {
    stato = { ...stato, ...nuovo }
    for (const f of BrowserWindow.getAllWindows()) {
      f.webContents.send(IPC.aggiornamento, stato)
    }
  }

  autoUpdater.on('update-available', (info) => {
    avvisa({ fase: 'disponibile', disponibile: info.version, note: normalizzaNote(info.releaseNotes) })
  })
  autoUpdater.on('update-not-available', () => avvisa({ fase: 'aggiornato' }))
  autoUpdater.on('download-progress', (p) => avvisa({ fase: 'scarico', percento: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => avvisa({ fase: 'pronto', percento: 100 }))
  autoUpdater.on('error', (e) => {
    // Senza rete, o dietro a una rete che blocca GitHub, questo scatta a ogni
    // avvio: e' rumore, non un guasto. Resta nello stato per chi apre il
    // pannello, e non diventa mai una finestra in faccia a nessuno.
    //
    // Un caso pero' non e' un errore per niente: un repository senza nemmeno
    // una release. Vuol dire solo che non c'e' ancora niente da scaricare, ed
    // e' esattamente cio' che l'utente legge come "sei aggiornato". Mostrargli
    // "No published versions on GitHub" e' farlo preoccupare di una cosa che
    // riguarda chi pubblica, non lui.
    if (/no published versions/i.test(e.message)) {
      avvisa({ fase: 'aggiornato', errore: undefined })
      return
    }
    avvisa({ fase: 'errore', errore: e.message })
  })

  ipcMain.handle(IPC.aggiornamentoStato, () => stato)

  ipcMain.handle(IPC.aggiornamentoControlla, async () => {
    if (!aggiornabile()) {
      avvisa({ fase: 'nonSupportato' })
      return stato
    }
    avvisa({ fase: 'controllo', errore: undefined })
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      avvisa({ fase: 'errore', errore: (e as Error).message })
    }
    return stato
  })

  ipcMain.handle(IPC.aggiornamentoScarica, async () => {
    if (stato.fase !== 'disponibile') return stato
    avvisa({ fase: 'scarico', percento: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      avvisa({ fase: 'errore', errore: (e as Error).message })
    }
    return stato
  })

  ipcMain.handle(IPC.aggiornamentoInstalla, () => {
    if (stato.fase !== 'pronto') return
    // `false` sul secondo argomento: si chiude tutto per davvero invece di
    // lasciare in giro una finestra che il programma di installazione poi non
    // riesce a sostituire.
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  })

  // All'avvio, ma non subito: i primi secondi servono alla finestra e
  // all'ingresso in stanza, non a una richiesta di rete che puo' aspettare.
  if (aggiornabile()) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => {})
    }, 8000)
  }
}

/**
 * Il portabile e la versione di sviluppo non si aggiornano.
 *
 * `isPackaged` esclude `npm run dev`; la variabile PORTABLE_EXECUTABLE_DIR la
 * mette electron-builder solo dentro al portabile, ed e' l'unico modo per
 * riconoscerlo dall'interno.
 */
function aggiornabile(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
}

/** Le note arrivano come stringa, o come elenco di release, o niente. */
function normalizzaNote(note: unknown): string | undefined {
  if (typeof note === 'string') return note
  if (Array.isArray(note)) {
    return note
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? '')))
      .filter(Boolean)
      .join('\n\n')
  }
  return undefined
}
