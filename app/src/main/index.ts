import { app, BrowserWindow, globalShortcut, ipcMain, Notification, session, shell } from 'electron'
import { join } from 'node:path'
import { agganciaCattura, elencaSorgenti, ricordaScelta } from './cattura'
import { dimenticaToken, leggiImpostazioni, scriviImpostazioni, scriviToken } from './impostazioni'
import { chiudiPuntatori, mostraPuntatore } from './puntatore'
import {
  IPC,
  type Impostazioni,
  type Puntata,
  type SceltaCattura,
  type Scorciatoia
} from '@shared/tipi'

/**
 * Il processo principale.
 *
 * Fa poco, e il poco che fa non si potrebbe fare da nessun'altra parte: dare
 * alla finestra l'elenco degli schermi, agganciare l'audio di sistema alla
 * cattura, tenere il token cifrato, e ascoltare due tasti anche quando l'app e'
 * dietro a tutto il resto.
 *
 * Le chiamate no: quelle vivono interamente nella finestra, che e' Chromium e
 * quindi ha gia' dentro tutto WebRTC. Nessun pacchetto audio passa di qui.
 */

const DEV = !!process.env.ELECTRON_RENDERER_URL

let finestra: BrowserWindow | null = null

// Su una macchina con due schede video, la finestra che codifica un 4K60 vuole
// quella vera. Senza, Windows la lascia sulla integrata "per risparmiare".
app.commandLine.appendSwitch('force_high_performance_gpu')

function creaFinestra(): void {
  finestra = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    // Non `show: false` con un ripensamento dopo: la finestra si apre, punto.
    // Un programma che all'avvio mette solo un'icona nella barra e' un
    // programma che l'utente dimentica di avere.
    show: true,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'PulseTalk',
    icon: join(import.meta.dirname, '../../build/icona.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      // I tre interruttori che tengono la pagina dentro la sua scatola. La
      // pagina e' nostra, ma la stessa pagina gira anche nel browser e non
      // deve maturare l'abitudine a poteri che li' non avrebbe.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Serve al vero: la cattura dello schermo produce blob: URL, e le
      // riproduzioni partono da sole senza che nessuno abbia cliccato.
      autoplayPolicy: 'no-user-gesture-required',
      // Senza questo Chromium sospende i timer delle finestre in secondo
      // piano, e una chiamata minimizzata comincia a perdere pacchetti.
      backgroundThrottling: false
    }
  })

  finestra.on('closed', () => {
    finestra = null
  })

  // Un link nella chat apre il browser, non sostituisce l'applicazione con una
  // pagina qualunque da cui non si torna indietro.
  finestra.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV) {
    finestra.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    finestra.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/**
 * I permessi che la finestra puo' chiedere, e nessun altro.
 *
 * Chromium chiederebbe all'utente; qui l'utente ha gia' risposto installando il
 * programma. Ma la lista resta corta: `notifications` o `geolocation` non
 * hanno niente a che fare con una chiamata, e concederli "tanto e' la nostra
 * pagina" e' il modo in cui si accumulano poteri che nessuno ha mai voluto.
 */
function agganciaPermessi(): void {
  const concessi = new Set(['media', 'display-capture', 'audioCapture', 'videoCapture'])

  session.defaultSession.setPermissionRequestHandler((_contenuti, permesso, rispondi) => {
    rispondi(concessi.has(permesso))
  })
  session.defaultSession.setPermissionCheckHandler((_contenuti, permesso) => concessi.has(permesso))

  agganciaCattura(session.defaultSession)

  // In produzione la pagina arriva da file://, e da li' non deve poter
  // chiamare niente che non sia il server scelto dall'utente. In sviluppo no:
  // Vite ha bisogno di eval per il ricaricamento a caldo, e una CSP severa
  // trasformerebbe ogni salvataggio in una pagina bianca.
  if (DEV) return

  session.defaultSession.webRequest.onHeadersReceived((dettagli, continua) => {
    continua({
      responseHeaders: {
        ...dettagli.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            // Qualunque schema, e non e' una resa.
            //
            // L'indirizzo del server lo sceglie l'utente, ed e' legittimo che
            // sia `http://192.168.0.50:8080` — un NAS in rete locale, senza
            // certificato perche' non gli serve. La prima stesura consentiva
            // solo https e localhost, e quel caso lo bloccava: Chromium
            // tagliava la richiesta prima che partisse, e l'app diceva "non
            // riesco a raggiungere il server" indicando il posto sbagliato.
            //
            // Restringere lo schema qui non proteggeva granche' comunque: chi
            // riuscisse a eseguire codice in questa pagina potrebbe mandare
            // dati a qualunque host https gli pare. Cio' che conta davvero e'
            // che quel codice non arrivi a eseguirsi, ed e' il lavoro di
            // `script-src 'self'` e `object-src 'none'` qui sotto.
            "connect-src 'self' https: wss: http: ws:",
            // I video arrivano come blob: dalle tracce WebRTC.
            "media-src 'self' blob:",
            "img-src 'self' data: blob:",
            // Tailwind scrive gli stili nel documento.
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self'",
            "object-src 'none'",
            "base-uri 'none'"
          ].join('; ')
        ]
      }
    })
  })
}

/**
 * Le due scorciatoie globali.
 *
 * Globali perche' il momento in cui serve zittirsi e' quello in cui la finestra
 * di PulseTalk non e' quella davanti: si sta guardando il codice, si tossisce,
 * e non si vuole cercare l'applicazione per farlo.
 */
let registrate: string[] = []

function agganciaScorciatoie(impostazioni: Impostazioni): void {
  for (const combinazione of registrate) globalShortcut.unregister(combinazione)
  registrate = []

  const mappa: [string, Scorciatoia][] = [
    [impostazioni.scorciatoiaMuto, 'muto'],
    [impostazioni.scorciatoiaSordina, 'sordina']
  ]

  for (const [combinazione, quale] of mappa) {
    if (!combinazione) continue
    // Un'altra applicazione puo' avere gia' preso la combinazione. Non e' un
    // errore da mostrare: e' un tasto che non risponde, e l'unica cosa utile
    // e' che il resto del programma parta lo stesso.
    const presa = globalShortcut.register(combinazione, () => {
      finestra?.webContents.send(IPC.scorciatoia, quale)
    })
    if (presa) registrate.push(combinazione)
  }
}

function agganciaCanali(): void {
  ipcMain.handle(IPC.sorgenti, () => elencaSorgenti())

  ipcMain.handle(IPC.preparaCattura, (_evento, scelta: SceltaCattura) => {
    ricordaScelta(scelta)
  })

  ipcMain.handle(IPC.leggiImpostazioni, () => leggiImpostazioni())

  ipcMain.handle(IPC.scriviImpostazioni, (_evento, modifiche: Partial<Impostazioni>) => {
    // Il token ha una strada sua: arriva insieme alle altre modifiche perche'
    // dalla finestra e' comodo cosi', ma non finisce nello stesso file.
    let errore: string | undefined
    if (modifiche.token !== undefined) {
      if (modifiche.token === null) dimenticaToken()
      else {
        const esito = scriviToken(modifiche.token)
        if (!esito.ok) errore = esito.errore
      }
    }

    const { token: _ignorato, ...resto } = modifiche
    const impostazioni = scriviImpostazioni(resto)

    if (modifiche.scorciatoiaMuto !== undefined || modifiche.scorciatoiaSordina !== undefined) {
      agganciaScorciatoie(impostazioni)
    }

    finestra?.webContents.send(IPC.impostazioniCambiate, impostazioni)
    return { impostazioni, errore }
  })

  ipcMain.handle(IPC.versione, () => ({
    app: app.getVersion(),
    elettrone: process.versions.electron,
    chrome: process.versions.chrome,
    piattaforma: process.platform
  }))

  ipcMain.on(IPC.apriEsterno, (_evento, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  // Il "guarda qui" degli altri, disegnato sul monitor vero invece che dentro
  // alla finestra: chi condivide sta guardando il suo schermo, non noi.
  ipcMain.on(IPC.puntatore, (_evento, punta: Puntata) => {
    mostraPuntatore(punta)
  })

  ipcMain.on(IPC.notifica, (_evento, avviso: { titolo: string; corpo: string }) => {
    // Le notifiche di Windows passano da qui e non dall'API del browser: la
    // pagina non ha il permesso `notifications`, e non deve prenderlo per una
    // cosa che il processo principale sa gia' fare.
    if (!Notification.isSupported()) return
    const notifica = new Notification({
      title: String(avviso.titolo).slice(0, 80),
      body: String(avviso.corpo).slice(0, 200),
      silent: true
    })
    notifica.on('click', () => {
      if (!finestra) return
      if (finestra.isMinimized()) finestra.restore()
      finestra.focus()
    })
    notifica.show()
  })
}

// Una seconda copia non deve aprire una seconda finestra: chi rilancia l'app
// dalla barra vuole tornare a quella che sta gia' parlando.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!finestra) return
    if (finestra.isMinimized()) finestra.restore()
    finestra.focus()
  })

  app.whenReady().then(() => {
    agganciaPermessi()
    agganciaCanali()
    agganciaScorciatoie(leggiImpostazioni())
    creaFinestra()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) creaFinestra()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    chiudiPuntatori()
  })
}
