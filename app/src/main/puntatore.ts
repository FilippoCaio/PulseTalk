import { BrowserWindow, screen } from 'electron'
import type { Puntata } from '@shared/tipi'

/**
 * "Guarda qui", disegnato sul monitor vero.
 *
 * Questa e' la meta' che nessun'altra app fa. Quando qualcuno indica un punto
 * dello schermo che stai condividendo, il cerchietto non compare dentro a
 * PulseTalk — dove non lo guarderesti, perche' stai guardando il tuo codice —
 * ma sopra al tuo schermo, nel punto esatto. Chi indica dice "qui" e tu lo
 * vedi dove stai gia' guardando.
 *
 * E' una finestra senza cornice, trasparente, che ignora il mouse e si
 * distrugge da sola dopo due secondi e mezzo. Ne nasce una per ogni gesto: una
 * finestra sola da riposizionare costerebbe meno, ma due persone che indicano
 * insieme due punti diversi sono esattamente il momento in cui questa cosa
 * serve.
 *
 * Sopra a un gioco a schermo intero esclusivo non si vede: li' non c'e' un
 * desktop su cui disegnare, e nessuna finestra puo' arrivarci. In modalita'
 * finestra senza bordi — come giocano quasi tutti — si vede.
 */

const DURATA = 2500
const LATO = 260

/** Le finestre vive, per non lasciarne in giro se l'app si chiude nel mezzo. */
const aperte = new Set<BrowserWindow>()

export function mostraPuntatore(punta: Puntata): void {
  const display = screen
    .getAllDisplays()
    .find((d) => String(d.id) === String(punta.schermoId))
  if (!display) return

  // Le coordinate arrivano come frazione del video, che per uno schermo intero
  // e' il monitor: si moltiplicano per i suoi lati logici, che sono quelli in
  // cui Electron posiziona le finestre.
  const x = Math.round(display.bounds.x + punta.x * display.bounds.width - LATO / 2)
  const y = Math.round(display.bounds.y + punta.y * display.bounds.height - LATO / 2)

  const finestra = new BrowserWindow({
    x: Math.min(Math.max(x, display.bounds.x - LATO / 2), display.bounds.x + display.bounds.width - LATO / 2),
    y: Math.min(Math.max(y, display.bounds.y - LATO / 2), display.bounds.y + display.bounds.height - LATO / 2),
    width: LATO,
    height: LATO,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    // Non deve mai prendere il fuoco: chi sta scrivendo non deve perdere una
    // lettera perche' qualcuno ha indicato qualcosa.
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })

  // Sopra a tutto, e trasparente ai clic: e' un disegno, non un ostacolo.
  finestra.setAlwaysOnTop(true, 'screen-saver')
  finestra.setIgnoreMouseEvents(true)

  void finestra.loadURL(pagina(punta))
  finestra.once('ready-to-show', () => finestra.showInactive())

  aperte.add(finestra)
  finestra.on('closed', () => aperte.delete(finestra))
  setTimeout(() => {
    if (!finestra.isDestroyed()) finestra.close()
  }, DURATA)
}

export function chiudiPuntatori(): void {
  for (const finestra of [...aperte]) {
    if (!finestra.isDestroyed()) finestra.close()
  }
}

/**
 * Il disegno, come pagina.
 *
 * Tutto in CSS e niente script: non c'e' niente da eseguire, quindi non c'e'
 * niente da proteggere. Due anelli che si allargano sfalsati e un punto fermo
 * al centro — la forma che l'occhio riconosce come "qui", la stessa di un
 * tocco su una mappa.
 */
function pagina({ colore, nome }: Puntata): string {
  const sicuro = /^#[0-9a-fA-F]{3,8}$/.test(colore) ? colore : '#4f9cf9'
  const etichetta = (nome || '').replace(/[<>&"]/g, '').slice(0, 24)

  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;
      font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif}
    .centro{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
    .anello{position:absolute;width:36px;height:36px;border-radius:50%;
      border:3px solid ${sicuro};opacity:0;animation:onda 1.15s ease-out 2}
    .anello.due{animation-delay:.42s}
    .punto{position:absolute;width:14px;height:14px;border-radius:50%;background:${sicuro};
      box-shadow:0 0 12px ${sicuro};animation:battito 1.15s ease-out 2}
    .nome{position:absolute;top:calc(50% + 26px);padding:2px 8px;border-radius:999px;
      background:rgba(0,0,0,.72);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;
      animation:svanisci 2.5s ease-out forwards}
    @keyframes onda{0%{transform:scale(.35);opacity:.95}100%{transform:scale(4.2);opacity:0}}
    @keyframes battito{0%{transform:scale(.5);opacity:1}70%{transform:scale(1);opacity:1}100%{opacity:0}}
    @keyframes svanisci{0%,70%{opacity:1}100%{opacity:0}}
  </style><div class="centro">
    <div class="anello"></div><div class="anello due"></div><div class="punto"></div>
    ${etichetta ? `<div class="nome">${etichetta}</div>` : ''}
  </div>`

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
