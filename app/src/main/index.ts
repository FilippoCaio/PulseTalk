import { app, BrowserWindow, globalShortcut, ipcMain, Notification, session, shell } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { agganciaCattura, elencaSorgenti, ricordaScelta } from './cattura'
import {
  collegaServer,
  dimenticaToken,
  leggiImpostazioni,
  passaAServer,
  scollegaServer,
  scriviImpostazioni,
  scriviToken
} from './impostazioni'
import { chiudiPuntatori, mostraPuntatore } from './puntatore'
import { preparaAggiornamenti } from './aggiorna'
import { avviaSito, type Sito } from './sito'
import { coloriDi } from '@shared/tema'
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

/**
 * Il servitore di loopback che da' un'origine vera all'interfaccia.
 *
 * Esiste solo in produzione: in sviluppo ci pensa Vite, che gia' serve la
 * pagina da http://localhost. Vedi sito.ts per il perche' non basta file://.
 */
let sito: Sito | null = null

/**
 * Quante volte la pagina e' stata rianimata dopo un crollo.
 *
 * Serve a non entrare in un giro infinito: se muore subito ogni volta,
 * ricaricarla all'infinito e' peggio che fermarsi e dirlo.
 */
let rianimazioni = 0

/** Dove finiscono le morti del renderer, per poterle leggere il giorno dopo. */
function registraGuasto(testo: string): void {
  const riga = `[${new Date().toISOString()}] ${testo}
`
  try {
    appendFileSync(join(app.getPath('userData'), 'guasti.log'), riga)
  } catch {
    // Se non si puo' scrivere non si puo' fare altro: almeno resta a schermo.
  }
  console.error(riga.trim())
}

/**
 * Le distorsioni audio intermittenti spariscono prima che si possa aprire un
 * pannello di diagnostica. Queste righe restano in `%APPDATA%/PulseTalk/audio.log`
 * e contengono solo misure WebRTC: niente nomi, dispositivi o contenuto audio.
 */
function registraDiagnosticaAudio(testo: string): void {
  const pulito = String(testo).replace(/[\r\n\t]+/g, ' ').slice(0, 1200)
  if (!pulito) return
  const riga = `[${new Date().toISOString()}] ${pulito}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'audio.log'), riga)
  } catch {
    // La diagnosi non deve mai interrompere una chiamata.
  }
  console.warn(riga.trim())
}

// Su una macchina con due schede video, la finestra che codifica un 4K60 vuole
// quella vera. Senza, Windows la lascia sulla integrata "per risparmiare".
app.commandLine.appendSwitch('force_high_performance_gpu')

async function creaFinestra(): Promise<void> {
  finestra = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    // Non `show: false` con un ripensamento dopo: la finestra si apre, punto.
    // Un programma che all'avvio mette solo un'icona nella barra e' un
    // programma che l'utente dimentica di avere.
    show: true,
    // Il fondo del tema salvato, non un nero scritto qui.
    //
    // E' il colore che Chromium dipinge prima che la pagina esista, cioe' per
    // i due o tre decimi che passano fra l'apertura della finestra e il primo
    // fotogramma. Con un tema chiaro, un nero fisso qui sarebbe un lampo scuro
    // a tutto schermo a ogni avvio — lo stesso difetto che nel renderer cura
    // la copia in `localStorage`, curato dall'altro lato.
    backgroundColor: coloriDi(leggiImpostazioni().tema).fondo,
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

  // F11 allarga la finestra e basta: quello che c'e' dentro resta com'era.
  //
  // Prima da qui partiva un avviso al renderer, che ritirava le due colonne di
  // sinistra — un tutto schermo del sistema che si portava dietro un cambio di
  // interfaccia mai chiesto, e senza niente da premere per rimetterle a posto.
  // Adesso le colonne si chiudono e si riaprono solo dalla linguetta sul loro
  // bordo, che e' dove uno la cerca.

  // Un link nella chat apre il browser, non sostituisce l'applicazione con una
  // pagina qualunque da cui non si torna indietro.
  finestra.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV) {
    await finestra.loadURL(process.env.ELECTRON_RENDERER_URL!)
    return
  }

  // Da qui in poi la pagina ha un'origine vera (http://127.0.0.1:<porta>)
  // invece di quella opaca di file://. Se il servitore non parte si ricade
  // sul caricamento da file: l'applicazione funziona lo stesso, e a non
  // funzionare sara' solo il player di YouTube — meglio di una finestra vuota.
  try {
    sito ??= await avviaSito(join(import.meta.dirname, '../renderer'))
    await finestra.loadURL(sito.url)
  } catch (errore) {
    registraGuasto(`servitore locale non partito: ${(errore as Error).message}`)
    await finestra.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/**
 * Se un indirizzo e' una pagina di PulseTalk, e non roba di terzi.
 *
 * Sono i due posti da cui l'interfaccia puo' arrivare: il servitore di
 * loopback quando parte (il caso normale) e `file://` quando non parte. Tutto
 * il resto — l'iframe di YouTube e cio' che si tira dietro — e' di qualcun
 * altro, gira in un'origine sua, e le nostre regole non lo riguardano.
 */
function nostra(indirizzo: string): boolean {
  if (indirizzo.startsWith('file://')) return true
  if (!sito) return false
  try {
    return new URL(indirizzo).origin === new URL(sito.url).origin
  } catch {
    // Un indirizzo che non si riesce nemmeno a leggere non e' una nostra
    // pagina: nel dubbio non gli si scrive addosso niente.
    return false
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

  // In sviluppo niente CSP: Vite ha bisogno di eval per il ricaricamento a
  // caldo, e una CSP severa trasformerebbe ogni salvataggio in una pagina
  // bianca.
  if (DEV) return

  // Qui prima c'era un `Referer` scritto a mano verso YouTube, per farsi
  // riconoscere da una pagina file:// che origine non ne ha. Non bastava — il
  // player rispondeva comunque errore 153 — e per giunta cuciva un dominio
  // fisso dentro alla build di chiunque. Adesso l'interfaccia arriva da
  // http://127.0.0.1 e si identifica da sola: vedi sito.ts.

  session.defaultSession.webRequest.onHeadersReceived((dettagli, continua) => {
    // La CSP vale per le NOSTRE pagine, e solo per quelle.
    //
    // Questo gancio vede ogni risposta della sessione, comprese quelle che
    // caricano l'iframe di YouTube — che ha un'origine sua e una CSP sua.
    // Sovrascrivergliela voleva dire imporre al player di YouTube le regole
    // scritte per PulseTalk: dentro a quel documento `'self'` e'
    // youtube-nocookie.com, e `script-src` senza `'unsafe-inline'` fermava lo
    // script in linea con cui la pagina si avvia. Il risultato era un iframe
    // che rispondeva, si caricava, e restava nero per sempre — sia con il
    // player sincronizzato sia con quello standard, perche' la causa non era
    // in nessuno dei due.
    //
    // Delle regole qui sotto nessuna serve a difendersi da YouTube: servono a
    // tenere stretta la pagina di PulseTalk, che e' l'unica che esegue codice
    // nostro. Fuori da quella non hanno niente da proteggere.
    if (!nostra(dettagli.url)) {
      continua({})
      return
    }

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
            // Le anteprime dei video e le copertine dei dischi arrivano dai
            // due host che le servono, e da nessun altro: `https:` intero
            // permetterebbe a un messaggio con dentro un'immagine remota di
            // fare da segnale di lettura verso un server qualunque.
            // GIPHY serve da media0..media4.giphy.com e cambia numero a ogni
            // risultato, quindi qui ci vuole il carattere jolly: elencarli a
            // mano vorrebbe dire scoprire il sesto il giorno in cui compare.
            // Resta comunque una famiglia di domini sola, non `https:` intero.
            "img-src 'self' data: blob: https://i.ytimg.com https://i.scdn.co https://media.tenor.com https://*.giphy.com https://images.unsplash.com",
            // Tailwind scrive gli stili nel documento.
            "style-src 'self' 'unsafe-inline'",
            // Il player di YouTube, e nient'altro.
            //
            // Guardare un video insieme vuol dire che ogni computer lo
            // riproduce per conto suo con il player ufficiale: PulseTalk
            // sincronizza solo lo stato. Il player si comanda con l'IFrame
            // Player API, che e' uno script servito da YouTube e che gira in
            // questa pagina — e' il prezzo della strada ufficiale, e va
            // scritto invece che nascosto.
            //
            // Cio' che lo tiene stretto e' che sono due host precisi, non
            // `https:`: uno script iniettato da un'altra parte resta bloccato
            // come prima. Il video vero sta dentro all'iframe, che ha
            // un'origine sua e non vede niente di questa pagina.
            "script-src 'self' https://www.youtube.com https://s.ytimg.com",
            "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
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

  /**
   * Collegarsi a un server, e passarci sopra.
   *
   * Una chiamata sola con dentro indirizzo e token, e non due passaggi da
   * `scriviImpostazioni`: fra un passaggio e l'altro l'indirizzo attivo e il
   * token sarebbero stati per un istante di due server diversi, ed e' proprio
   * la coppia sbagliata che poi si salva sul disco.
   */
  ipcMain.handle(
    IPC.collegaServer,
    (
      _evento,
      dati: {
        indirizzo: string
        token?: string | null
        nome?: string | null
        utente?: string | null
        nomeVisibile?: string | null
      }
    ) => {
      const esito = collegaServer(dati)
      finestra?.webContents.send(IPC.impostazioniCambiate, esito.impostazioni)
      return esito
    }
  )

  ipcMain.handle(IPC.passaAServer, (_evento, indirizzo: string) => {
    const impostazioni = passaAServer(indirizzo)
    finestra?.webContents.send(IPC.impostazioniCambiate, impostazioni)
    return { impostazioni }
  })

  ipcMain.handle(IPC.scollegaServer, (_evento, indirizzo: string) => {
    const impostazioni = scollegaServer(indirizzo)
    finestra?.webContents.send(IPC.impostazioniCambiate, impostazioni)
    return { impostazioni }
  })

  ipcMain.handle(IPC.versione, () => ({
    app: app.getVersion(),
    elettrone: process.versions.electron,
    chrome: process.versions.chrome,
    piattaforma: process.platform,
    architettura: process.arch
  }))

  ipcMain.on(IPC.apriEsterno, (_evento, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  // Il "guarda qui" degli altri, disegnato sul monitor vero invece che dentro
  // alla finestra: chi condivide sta guardando il suo schermo, non noi.
  ipcMain.on(IPC.puntatore, (_evento, punta: Puntata) => {
    mostraPuntatore(punta)
  })

  ipcMain.on(IPC.diagnosticaAudio, (_evento, testo: string) => {
    registraDiagnosticaAudio(testo)
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
    // Se la finestra non c'e' piu' ma il processo e' rimasto in piedi, si
    // rifa'. Senza questo ramo il doppio clic muore in silenzio contro il
    // lucchetto: l'app risulta gia' aperta, non ha niente da mostrare, e
    // l'unico modo di riaverla e' il Task Manager. E' il genere di guasto che
    // l'utente descrive come "non compare nulla", perche' e' esattamente cio'
    // che vede.
    if (!finestra || finestra.isDestroyed()) {
      void creaFinestra().catch((e) => registraGuasto(`finestra non riaperta: ${(e as Error).message}`))
      return
    }
    if (finestra.isMinimized()) finestra.restore()
    finestra.show()
    finestra.focus()
  })

  // Un renderer che muore lascia una finestra grigia e nient'altro: nessun
  // errore, nessuna traccia, e l'utente che scrive "non compare nulla". Qui la
  // morte viene scritta su file e la pagina viene rianimata una volta sola.
  app.on('render-process-gone', (_evento, contenuti, dettagli) => {
    registraGuasto(
      `renderer morto: motivo=${dettagli.reason} codice=${dettagli.exitCode ?? '?'}`
    )
    if (rianimazioni >= 2) {
      registraGuasto('gia rianimato due volte: mi fermo, sarebbe un giro infinito')
      return
    }
    rianimazioni++
    // Un giro di orologio: ricaricare dentro al gestore stesso non funziona.
    setTimeout(() => {
      if (!contenuti.isDestroyed()) contenuti.reload()
    }, 300)
  })

  app.whenReady().then(() => {
    agganciaPermessi()
    agganciaCanali()
    agganciaScorciatoie(leggiImpostazioni())
    const aggiornamenti = preparaAggiornamenti()
    void creaFinestra()
      .then(() => {
        // Il controllo all'avvio parte quando la finestra c'e', non prima: lo
        // stato viaggia con `webContents.send`, e mandato a una finestra che
        // non esiste ancora non lo riceverebbe nessuno. E' anche il motivo per
        // cui non basta chiamarlo dentro a `preparaAggiornamenti`.
        aggiornamenti.allAvvio()
      })
      .catch((e) => registraGuasto(`finestra non creata: ${(e as Error).message}`))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void creaFinestra().catch((e) => registraGuasto(`finestra non creata: ${(e as Error).message}`))
      }
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    chiudiPuntatori()
    void sito?.chiudi()
  })
}
