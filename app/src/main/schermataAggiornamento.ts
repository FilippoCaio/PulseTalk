import { app, BrowserWindow } from 'electron'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * La finestrella che copre il buco dell'aggiornamento.
 *
 * Installare un aggiornamento vuol dire chiudere l'applicazione, far girare
 * l'installer e riaprirla. Chi guarda vede la finestra sparire di colpo e poi,
 * qualche secondo dopo, ricomparire: dal di fuori e' indistinguibile da un
 * crash, ed e' il momento in cui qualcuno riapre a mano l'app che si stava gia'
 * riaprendo da sola.
 *
 * ## Cosa copre davvero, e cosa no
 *
 * Copre l'uscita: dal clic su «installa» fino a quando questo processo muore.
 * E' poco tempo, ed e' voluto dirlo — la parte in cui l'installer NSIS lavora
 * e l'applicazione non esiste **non si puo' coprire da qui**, perche' per
 * disegnare una finestra serve un processo vivo e in quel momento non ce n'e'
 * nessuno. Quel pezzo lo si potrebbe coprire solo con un secondo programma che
 * sopravvive all'aggiornamento, che e' un'altra cosa e va decisa a parte.
 *
 * Quello che si guadagna comunque e' la differenza fra «e' sparito tutto» e
 * «sta installando, si riapre da solo»: la finestra principale se ne va e al
 * suo posto resta una frase che dice cosa sta succedendo.
 *
 * ## Perche' una barra che non misura niente
 *
 * A questo punto lo scaricamento e' gia' finito — l'avanzamento vero c'era
 * durante quello, e lo mostra il pannello degli aggiornamenti. Dell'installer
 * silenzioso non arriva nessun evento: non sappiamo se ci mettera' due secondi
 * o dieci. Una barra che si riempie su un tempo inventato direbbe una cosa che
 * non sa, e le barre che mentono si riconoscono — sono quelle che arrivano al
 * 99% e restano li'. Questa scorre e basta: dice «sta succedendo», che e'
 * l'unica cosa vera che si possa dire.
 *
 * ## Il disegno
 *
 * Il logo e' lo stesso di `scripts/make-icon.mjs`, in SVG invece che in pixel:
 * gli stessi vertici del profilo e le stesse tre lineette. Ripetuti qui e non
 * importati perche' quello script disegna riempiendo una griglia di pixel — non
 * ha un tracciato da esportare — e perche' questo file finisce nel processo
 * principale, che non puo' tirarsi dentro uno script di build.
 *
 * Le tre lineette escono dalla bocca a tre velocita' diverse e mai in fase: le
 * durate non sono multiple l'una dell'altra, quindi il gruppo non ritorna mai
 * allo stesso allineamento e non si vede il punto in cui il ciclo ricomincia.
 * Tre durate uguali avrebbero fatto tre trattini che marciano insieme, cioe'
 * una cosa sola che si muove invece di una voce che esce.
 */

/** Il profilo, dagli stessi vertici dell'icona, portati da 0..1 a 0..100. */
const PROFILO = [
  [0.23, 0.2], [0.298, 0.21], [0.352, 0.238], [0.392, 0.278],
  [0.416, 0.325], [0.426, 0.372],
  [0.406, 0.404], [0.4, 0.418],
  [0.418, 0.446], [0.44, 0.478], [0.462, 0.506], [0.482, 0.532],
  [0.488, 0.546], [0.476, 0.558], [0.452, 0.566], [0.424, 0.574],
  [0.448, 0.61], [0.466, 0.646], [0.45, 0.682], [0.43, 0.718],
  [0.45, 0.746], [0.464, 0.774],
  [0.436, 0.798], [0.386, 0.812], [0.33, 0.818]
]

/** Le tre lineette: y, inizio e fine. La piu' lunga e' quella di mezzo. */
const VOCE = [
  { y: 0.468, da: 0.578, a: 0.692, durata: 1.15 },
  { y: 0.6, da: 0.578, a: 0.776, durata: 1.75 },
  { y: 0.732, da: 0.578, a: 0.692, durata: 1.42 }
]

const FONDO = '#0b0e14'
const VIVO = '#4f9cf9'
const TESTO = '#98a2b8'

function pagina(titolo: string, sotto: string): string {
  const punti = PROFILO.map(([x, y]) => `${(x * 100).toFixed(1)},${(y * 100).toFixed(1)}`).join(' ')

  const lineette = VOCE.map((v, i) => {
    const y = (v.y * 100).toFixed(1)
    const da = (v.da * 100).toFixed(1)
    const a = (v.a * 100).toFixed(1)
    return `<line class="onda o${i}" x1="${da}" y1="${y}" x2="${a}" y2="${y}" />`
  }).join('')

  const passi = VOCE.map(
    (v, i) => `.o${i}{animation-duration:${v.durata}s}`
  ).join('')

  return `<!doctype html>
<meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:${FONDO};overflow:hidden;
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
    -webkit-user-select:none;user-select:none}
  /* La finestra e' senza cornice: il bordo lo disegna la pagina, altrimenti
     su uno sfondo scuro si perderebbe il confine con cio' che ha dietro. */
  .telaio{box-sizing:border-box;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:18px;padding:26px;
    border:1px solid #232b3d;border-radius:14px}
  svg{width:92px;height:92px;overflow:visible}
  .profilo{fill:none;stroke:${VIVO};stroke-width:5.2;
    stroke-linecap:round;stroke-linejoin:round}
  .onda{stroke:${VIVO};stroke-width:5.2;stroke-linecap:round;
    animation-name:esce;animation-timing-function:cubic-bezier(.3,0,.5,1);
    animation-iteration-count:infinite}
  ${passi}
  /* Esce dalla bocca, corre in avanti e si dissolve arrivando in fondo.
     L'opacita' non cala dall'inizio: una lineetta che sbiadisce mentre parte
     sembra spenta, non in viaggio. Sta piena per meta' corsa e se ne va
     nell'ultimo terzo. */
  @keyframes esce{
    0%{transform:translateX(0);opacity:0}
    12%{opacity:1}
    62%{opacity:1}
    100%{transform:translateX(26px);opacity:0}
  }
  p{margin:0;color:${TESTO};font-size:13px;text-align:center;line-height:1.5}
  p b{color:#e6e9f0;font-weight:600;display:block;margin-bottom:2px}
  /* La barra scorre invece di riempirsi: vedi il commento nel modulo. */
  .binario{width:190px;height:4px;border-radius:999px;background:#1a2030;
    overflow:hidden}
  .corsa{height:100%;width:38%;border-radius:999px;background:${VIVO};
    animation:scorre 1.5s cubic-bezier(.5,0,.5,1) infinite}
  @keyframes scorre{
    0%{transform:translateX(-100%)}
    100%{transform:translateX(363%)}
  }
  @media (prefers-reduced-motion:reduce){
    .onda,.corsa{animation:none}
    .onda{opacity:1}
    .corsa{width:100%}
  }
</style>
<div class="telaio">
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <polyline class="profilo" points="${punti}" />
    ${lineette}
  </svg>
  <p><b>${titolo}</b>${sotto}</p>
  <div class="binario"><div class="corsa"></div></div>
</div>`
}

/**
 * Il segnale che sopravvive al riavvio.
 *
 * Un file vuoto in `userData`, e non una variabile: fra il momento in cui si
 * chiede l'aggiornamento e quello in cui l'applicazione torna su c'e' un
 * processo che muore e uno che nasce, e l'unica cosa che passa da uno all'altro
 * e' il disco.
 *
 * Serve a sapere **perche'** si sta aprendo. Un avvio normale non deve
 * mostrare niente: chi apre l'app la sta aprendo e lo sa. Chi invece se la
 * vede tornare su da sola dopo un aggiornamento non ha chiesto niente in quel
 * momento, e senza una riga che lo dica quella finestra che compare da sola
 * e' solo una finestra che compare da sola.
 */
function segnale(): string {
  return join(app.getPath('userData'), 'aggiornamento-in-corso')
}

/** Lasciato prima di uscire, letto e cancellato al ritorno. */
export function segnaAggiornamentoInCorso(): void {
  try {
    writeFileSync(segnale(), String(Date.now()))
  } catch {
    // Se non si riesce a scrivere si perde la schermata al ritorno, non
    // l'aggiornamento: non c'e' niente da riferire a nessuno.
  }
}

/** Vero una volta sola: la lettura consuma il segnale. */
export function tornaDaAggiornamento(): boolean {
  try {
    if (!existsSync(segnale())) return false
    rmSync(segnale())
    return true
  } catch {
    return false
  }
}

let aperta: BrowserWindow | null = null

/**
 * La apre e torna quando ha davvero disegnato.
 *
 * Aspettare `ready-to-show` non e' pignoleria: `quitAndInstall` chiude tutto
 * subito dopo, e una finestra creata ma non ancora dipinta sarebbe un lampo
 * grigio - cioe' peggio di niente. Se per qualunque motivo non e' pronta entro
 * un secondo si va avanti lo stesso: l'aggiornamento non si ferma perche' non
 * si e' riusciti a mostrare un'animazione.
 */
export async function mostraSchermataAggiornamento(
  fase: 'esce' | 'rientra' = 'esce'
): Promise<void> {
  if (aperta) return

  aperta = new BrowserWindow({
    width: 340,
    height: 240,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: FONDO,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })

  aperta.on('closed', () => {
    aperta = null
  })

  const finestra = aperta
  const [titolo, sotto] =
    fase === 'esce'
      ? ['Sto installando l&rsquo;aggiornamento', 'PulseTalk si riapre da sola.']
      : ['Aggiornamento installato', 'Sto riaprendo PulseTalk.']
  await finestra.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(pagina(titolo, sotto))}`
  )

  await new Promise<void>((risolvi) => {
    const vai = (): void => {
      finestra.show()
      risolvi()
    }
    if (!finestra.isDestroyed() && finestra.webContents.isLoading()) {
      finestra.once('ready-to-show', vai)
      setTimeout(vai, 1000)
    } else {
      vai()
    }
  })
}

/** La chiude, se c'e'. Chiamata quando la finestra vera ha finito di caricare. */
export function chiudiSchermataAggiornamento(): void {
  if (aperta && !aperta.isDestroyed()) aperta.close()
  aperta = null
}
