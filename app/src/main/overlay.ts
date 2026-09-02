import { BrowserWindow, screen } from 'electron'
import { anelloOverlay, MISURE_OVERLAY } from '@shared/tipi'
import type {
  DimensioneOverlay,
  Impostazioni,
  NomiOverlay,
  PersonaOverlay
} from '@shared/tipi'

/**
 * Le facce di chi e' in chiamata, sopra a tutto il resto.
 *
 * ## Quando compare, e perche' proprio allora
 *
 * Solo con la finestra ridotta a icona e una chiamata in corso. E' l'unico
 * momento in cui serve: davanti alla finestra si vede gia' chi parla, con la
 * finestra chiusa non si e' in chiamata, e con la finestra dietro ad altre —
 * mentre si lavora — resta comunque un pezzo di applicazione da guardare se si
 * vuole. Ridotta a icona no: li' l'unico modo di sapere chi sta parlando e'
 * riaprire la finestra, cioe' interrompere quello che si stava facendo proprio
 * per una risposta che dura un secondo.
 *
 * ## Perche' non e' una finestra dell'applicazione
 *
 * E' una `BrowserWindow` a parte, senza cornice, trasparente e sempre sopra, e
 * la pagina che ci sta dentro e' scritta qui in mezzo al codice invece di
 * essere un secondo punto d'ingresso del renderer. Le due strade fanno la
 * stessa cosa; questa costa un file, l'altra un secondo bundle di React da
 * caricare in memoria per disegnare otto cerchi, un ingresso in piu' nella
 * configurazione di Vite e un secondo `index.html` da tenere allineato. La
 * stessa scelta di `schermataAggiornamento.ts`, per la stessa ragione.
 *
 * I dati arrivano con `executeJavaScript` invece che da un canale IPC, e cosi'
 * l'overlay non ha bisogno di un preload suo: la finestra e' nostra, la pagina
 * e' nostra, e non c'e' nessun altro che possa parlarle.
 *
 * ## Perche' due aggiornamenti diversi
 *
 * L'elenco delle persone si porta dietro le foto profilo, che sono data URL da
 * qualche kilobyte l'una, e cambia quando qualcuno entra o esce. Chi parla
 * cambia dieci volte al minuto ed e' una lista di identita'. Rimandare le foto
 * a ogni sillaba sarebbe stato qualche megabyte al minuto attraverso il ponte,
 * per ridisegnare un bordo verde.
 *
 * ## Il pannello non e' un pannello
 *
 * Niente riquadro attorno: solo le facce, una sotto l'altra, ognuna con la sua
 * ombra. Su uno sfondo qualunque — un gioco, un foglio bianco, un video — un
 * riquadro semitrasparente diventa una macchia che copre; una faccia con
 * l'ombra si stacca da sola da qualunque cosa ci sia dietro, senza nascondere
 * niente di piu' di se stessa.
 *
 * La finestra si tiene stretta attorno al contenuto proprio per questo: e'
 * trasparente ma non e' attraversabile dai clic, e ogni pixel di finestra
 * vuota sarebbe un pezzo di schermo che non risponde piu'. L'ombra pero' ha
 * bisogno di respiro attorno, e sono i pochi pixel di `BORDO`.
 */

/** Lo spazio fra una faccia e l'altra, oltre a quello dell'anello. */
const SPAZIO = 6
/** Il respiro attorno al contenuto: e' li' che si disegna l'ombra. */
const BORDO = 8
/** Quanto puo' essere lunga la linguetta del nome prima di tagliare. */
const NOME = 168
/** Lo stacco dal bordo dello schermo, la prima volta che compare. */
const MARGINE = 24

interface Stato {
  persone: PersonaOverlay[]
  parlano: string[]
  avatar: DimensioneOverlay
  nomi: NomiOverlay
  /**
   * Le misure, calcolate qui e mandate di la'.
   *
   * La pagina potrebbe ricavarsele da sola dalla misura della faccia - la
   * formula e' una riga - ma allora sarebbero due copie della stessa formula,
   * una che decide quanto e' grande la finestra e una che decide quanto e'
   * grande cio' che ci sta dentro. Il giorno in cui divergono, l'anello finisce
   * tagliato dal bordo e nessuno sa perche'.
   */
  lato: number
  bordo: number
  spazio: number
  scuro: number
  verde: number
}

let finestra: BrowserWindow | null = null
let impostazioni: Impostazioni | null = null
let ridotta = false

let persone: PersonaOverlay[] = []
let parlano = new Set<string>()

/**
 * L'ultima volta che si e' sentita ciascuna voce.
 *
 * Serve solo quando c'e' un tetto al numero di facce: fra venti persone in
 * stanza si tengono quelle che hanno parlato piu' di recente, perche' e'
 * l'unica scelta che risponde alla domanda per cui l'overlay esiste. L'ordine
 * in cui si vedono resta pero' quello dell'elenco: riordinarle a ogni parola
 * avrebbe fatto ballare le facce sotto al cursore.
 */
const ultimaVoce = new Map<string, number>()

/** Chi va disegnato adesso, nell'ordine in cui va disegnato. */
function visibili(): PersonaOverlay[] {
  if (!impostazioni) return []

  let elenco = persone
  if (impostazioni.overlayUtenti === 'parlando') {
    elenco = elenco.filter((p) => parlano.has(p.id))
  }

  const tetto = impostazioni.overlayMassimo
  if (tetto > 0 && elenco.length > tetto) {
    // Si scelgono per voce recente, si disegnano nell'ordine di sempre.
    const tenuti = new Set(
      [...elenco]
        .sort((a, b) => (ultimaVoce.get(b.id) ?? 0) - (ultimaVoce.get(a.id) ?? 0))
        .slice(0, tetto)
        .map((p) => p.id)
    )
    elenco = elenco.filter((p) => tenuti.has(p.id))
  }

  return elenco
}

/**
 * Tutte le misure che dipendono dalla faccia, ricavate una volta sola.
 *
 * L'anello di chi parla sta fuori dalla faccia, quindi il suo spessore entra
 * due volte: nel respiro attorno al contenuto - altrimenti il bordo della
 * finestra lo taglierebbe a meta' - e nella distanza fra una faccia e l'altra,
 * altrimenti l'anello di chi parla finirebbe addosso a chi sta sotto.
 *
 * Lo spazio c'e' sempre, anche quando non parla nessuno: riservarlo solo al
 * bisogno vorrebbe dire una finestra che cambia misura a ogni sillaba, cioe'
 * un pannello che pulsa in un angolo dello schermo.
 */
function misure(): {
  lato: number
  anello: number
  bordo: number
  spazio: number
  scuro: number
  verde: number
} {
  const lato = MISURE_OVERLAY[impostazioni?.overlayAvatar ?? 'grande']
  const { scuro, verde, tutto } = anelloOverlay(lato)
  return {
    lato,
    anello: tutto,
    bordo: BORDO + tutto,
    spazio: SPAZIO + tutto,
    scuro,
    verde
  }
}

function misuraFinestra(quante: number): { larghezza: number; altezza: number } {
  const { lato, bordo, spazio } = misure()
  const conNomi = (impostazioni?.overlayNomi ?? 'sempre') !== 'mai'
  return {
    larghezza: bordo * 2 + lato + (conNomi ? 8 + NOME : 0),
    altezza: bordo * 2 + quante * lato + Math.max(0, quante - 1) * spazio
  }
}

/**
 * Dove metterla: dove l'hanno lasciata, o in alto a destra la prima volta.
 *
 * La posizione salvata si riporta dentro allo schermo che la contiene meglio,
 * e non si prende per buona com'e': un portatile che ieri aveva due monitor
 * oggi ne ha uno, e una finestra a x=3000 sarebbe una finestra che non si vede
 * e non si puo' riportare indietro, perche' per trascinarla bisognerebbe
 * prima trovarla.
 */
function posizione(larghezza: number, altezza: number): { x: number; y: number } {
  const salvata =
    impostazioni?.overlayX != null && impostazioni?.overlayY != null
      ? { x: impostazioni.overlayX, y: impostazioni.overlayY }
      : null

  const schermo = salvata
    ? screen.getDisplayMatching({ x: salvata.x, y: salvata.y, width: larghezza, height: altezza })
    : screen.getPrimaryDisplay()
  const area = schermo.workArea

  if (!salvata) {
    return { x: area.x + area.width - larghezza - MARGINE, y: area.y + MARGINE }
  }

  return {
    x: Math.min(Math.max(salvata.x, area.x), area.x + area.width - larghezza),
    y: Math.min(Math.max(salvata.y, area.y), area.y + area.height - altezza)
  }
}

function pagina(): string {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;
    -webkit-user-select:none;user-select:none;cursor:default}
  /* Tutta la superficie trascina: il pannello si prende dal punto in cui lo si
     vede, non da una maniglia che bisogna prima trovare. */
  body{-webkit-app-region:drag}
  /* Imbottitura e distanze le scrive JS: dipendono dalla misura delle facce,
     e quella si cambia da un menu mentre la finestra e' aperta. */
  #lista{box-sizing:border-box;display:flex;
    flex-direction:column;align-items:flex-start}
  .riga{display:flex;align-items:center;gap:8px;max-width:100%}
  .ritratto{position:relative;flex:0 0 auto;border-radius:50%;overflow:hidden;
    background:#1a2030;color:#fff;display:flex;align-items:center;
    justify-content:center;font-weight:600;
    transition:box-shadow .1s ease}
  .ritratto img{width:100%;height:100%;object-fit:cover;display:block}
  .muto{position:absolute;right:-1px;bottom:-1px;width:42%;height:42%;
    border-radius:50%;background:#f4525a;box-shadow:0 0 0 2px rgba(0,0,0,.5);
    display:flex;align-items:center;justify-content:center}
  .muto svg{width:64%;height:64%;stroke:#fff;stroke-width:2.4;fill:none;
    stroke-linecap:round}
  .nome{max-width:${NOME}px;overflow:hidden;text-overflow:ellipsis;
    white-space:nowrap;background:rgba(20,24,34,.92);color:#e6e9f0;
    border-radius:999px;padding:4px 10px;font-size:13px;line-height:1.2;
    box-shadow:0 3px 10px rgba(0,0,0,.55)}
</style>
<div id="lista"></div>
<script>
  const stato = {
    persone: [], parlano: [], nomi: 'sempre',
    lato: 48, bordo: 14, spazio: 12, scuro: 3, verde: 5
  }

  /**
   * L'ombra di una faccia.
   *
   * Ferma: solo lo stacco dal fondo, che e' cio' che la tiene staccata da un
   * gioco chiaro o da un foglio bianco.
   *
   * Mentre parla: due anelli concentrici fuori dal cerchio, lo scuro attaccato
   * alla faccia e il verde subito fuori. Il primo della lista si disegna sopra,
   * quindi lo scuro con lo sbordo piccolo copre la parte interna del verde, che
   * ne ha uno piu' grande: da fuori si vedono due fasce invece di un contorno
   * solo. Senza lo stacco scuro, il verde appoggiato a una foto scura sparisce.
   */
  function ombra(parla) {
    const fondo = '0 3px 10px rgba(0,0,0,.55)'
    if (!parla) return fondo + ',0 0 0 1px rgba(0,0,0,.35)'
    const dentro = '0 0 0 ' + stato.scuro + 'px #0b0e14'
    const fuori = '0 0 0 ' + (stato.scuro + stato.verde) + 'px #3ecf8e'
    return dentro + ',' + fuori + ',' + fondo
  }

  function dipingi() {
    const lato = stato.lato
    const lista = document.getElementById('lista')
    lista.textContent = ''
    lista.style.padding = stato.bordo + 'px'
    lista.style.gap = stato.spazio + 'px'

    for (const p of stato.persone) {
      const parla = stato.parlano.includes(p.id)

      const riga = document.createElement('div')
      riga.className = 'riga'

      const ritratto = document.createElement('div')
      ritratto.className = 'ritratto'
      ritratto.style.width = lato + 'px'
      ritratto.style.height = lato + 'px'
      ritratto.style.fontSize = Math.round(lato * 0.36) + 'px'
      ritratto.style.boxShadow = ombra(parla)

      if (p.avatar) {
        const img = document.createElement('img')
        img.src = p.avatar
        img.alt = ''
        ritratto.appendChild(img)
      } else {
        ritratto.style.background = p.colore
        ritratto.textContent = p.iniziali
      }

      if (p.muto) {
        const segno = document.createElement('span')
        segno.className = 'muto'
        segno.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M4 4l16 16"/>' +
          '<path d="M9 5a3 3 0 0 1 6 0v6"/><path d="M12 19v-3"/></svg>'
        ritratto.appendChild(segno)
      }

      riga.appendChild(ritratto)

      if (stato.nomi === 'sempre' || (stato.nomi === 'parlando' && parla)) {
        const nome = document.createElement('div')
        nome.className = 'nome'
        nome.textContent = p.nome
        riga.appendChild(nome)
      }

      lista.appendChild(riga)
    }
  }

  window.applica = function (pezzo) {
    Object.assign(stato, pezzo)
    dipingi()
  }
</script>`
}

function crea(): BrowserWindow {
  const nuova = new BrowserWindow({
    width: 200,
    height: 100,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // `screen-saver` e non `true`: e' il livello che sta sopra anche alle
    // finestre a tutto schermo di altri programmi, che e' esattamente il caso
    // per cui l'overlay esiste.
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })

  nuova.setAlwaysOnTop(true, 'screen-saver')
  nuova.setMenu(null)

  /**
   * Trascinata: dove l'ha lasciata ci resta, anche domani.
   *
   * Si scrive alla fine del movimento e non durante, altrimenti sarebbero
   * cento scritture del file delle impostazioni per un trascinamento.
   *
   * E si scrive in **due** posti: sul disco e nella copia che questo modulo
   * tiene in mano. Prima solo sul disco, ed era il difetto per cui l'overlay
   * tornava in alto a destra appena qualcuno parlava: la copia locale restava
   * a com'era - senza posizione, cioe' «mettiti in alto a destra» - e il primo
   * ridisegno utile la rimetteva li'. Chi parla fa ridisegnare dieci volte al
   * minuto, quindi il difetto si vedeva subito e sembrava un capriccio.
   */
  nuova.on('moved', () => {
    const [x, y] = nuova.getPosition()
    if (impostazioni) impostazioni = { ...impostazioni, overlayX: x, overlayY: y }
    quandoSiSposta?.({ overlayX: x, overlayY: y })
  })

  nuova.on('closed', () => {
    finestra = null
  })

  void nuova.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pagina())}`)
  nuova.webContents.once('did-finish-load', () => spingi())

  return nuova
}

/** Chi salva la posizione. Lo mette `preparaOverlay`, per non importare da qui. */
let quandoSiSposta: ((modifiche: Partial<Impostazioni>) => void) | null = null

/** Manda alla pagina tutto quello che sa. */
function spingi(): void {
  if (!finestra || finestra.isDestroyed()) return
  const elenco = visibili()
  const { lato, bordo, spazio, scuro, verde } = misure()
  const dati: Stato = {
    persone: elenco,
    parlano: [...parlano],
    avatar: impostazioni?.overlayAvatar ?? 'grande',
    nomi: impostazioni?.overlayNomi ?? 'sempre',
    lato,
    bordo,
    spazio,
    scuro,
    verde
  }
  finestra.webContents
    .executeJavaScript(`window.applica && window.applica(${JSON.stringify(dati)})`)
    .catch(() => {
      // La finestra puo' morire fra il controllo e la consegna. Non c'e'
      // niente da riferire: al prossimo giro si ridisegna tutto da capo.
    })
}

/** Se ci sono le condizioni perche' si veda, e quante facce ci sono dentro. */
function deveVedersi(): number {
  if (!impostazioni?.overlay) return 0
  if (!ridotta) return 0
  if (persone.length === 0) return 0
  return visibili().length
}

/**
 * L'unico punto in cui l'overlay compare, sparisce, cambia misura o si
 * ridisegna. Chiamato da ogni cosa che possa averlo cambiato.
 */
function rivedi(): void {
  const quante = deveVedersi()

  if (quante === 0) {
    if (finestra && !finestra.isDestroyed() && finestra.isVisible()) finestra.hide()
    return
  }

  finestra ??= crea()

  const { larghezza, altezza } = misuraFinestra(quante)
  const gia = finestra.isVisible()

  if (gia) {
    /**
     * Aperta, si cambia solo la misura.
     *
     * La posizione e' di chi l'ha trascinata, e questa funzione gira a ogni
     * cambio di voce: ridargliela ogni volta vorrebbe dire strappargliela di
     * mano mentre la sta spostando. Si tocca `setBounds` solo quando la misura
     * cambia davvero - una faccia in piu', una in meno - perche' su una
     * finestra trasparente anche un setBounds identico costa un ridisegno.
     */
    const adesso = finestra.getBounds()
    if (adesso.width !== larghezza || adesso.height !== altezza) {
      finestra.setBounds({ x: adesso.x, y: adesso.y, width: larghezza, height: altezza })
    }
  } else {
    const dove = posizione(larghezza, altezza)
    finestra.setBounds({ x: dove.x, y: dove.y, width: larghezza, height: altezza })
  }

  spingi()

  if (!finestra.isVisible()) {
    // `showInactive` e non `show`: un pannello che compare non deve rubare la
    // tastiera a cio' che si stava facendo. E' comparso perche' l'utente ha
    // ridotto a icona PulseTalk per fare altro — dargli il fuoco vorrebbe dire
    // interrompere proprio quello.
    finestra.showInactive()
    finestra.setAlwaysOnTop(true, 'screen-saver')
  }
}

/**
 * Aggancia l'overlay alla finestra vera.
 *
 * E' qui che si decide "ridotta a icona": non lo si chiede al renderer, che
 * non lo sa, ma alla finestra stessa. `restore`, `show` e `focus` insieme e non
 * solo il primo, perche' una finestra si riapre in tre modi diversi — dalla
 * barra, dal vassoio, o con la scorciatoia — e ognuno manda il suo.
 */
export function preparaOverlay(
  principale: BrowserWindow,
  {
    leggi,
    scrivi
  }: {
    leggi: () => Impostazioni
    scrivi: (modifiche: Partial<Impostazioni>) => void
  }
): void {
  impostazioni = leggi()
  quandoSiSposta = scrivi

  ridotta = principale.isMinimized() || !principale.isVisible()

  const cambia = (adesso: boolean): void => {
    if (ridotta === adesso) return
    ridotta = adesso
    rivedi()
  }

  principale.on('minimize', () => cambia(true))
  principale.on('hide', () => cambia(true))
  principale.on('restore', () => cambia(false))
  principale.on('show', () => cambia(false))
  principale.on('focus', () => cambia(false))
  /**
   * Chiusa la finestra vera, l'overlay non si nasconde: muore.
   *
   * Nasconderla sarebbe stato il gesto naturale e il difetto peggiore di tutti:
   * `window-all-closed` scatta quando non resta **nessuna** finestra, e una
   * finestra nascosta e' una finestra. PulseTalk sarebbe rimasta accesa senza
   * niente da vedere, un processo nel gestore attivita' che nessuno sa come
   * chiudere.
   */
  principale.on('closed', () => {
    chiudiOverlay()
  })

  rivedi()
}

/** Le impostazioni sono cambiate: misura, nomi, tetto, o l'interruttore. */
export function impostazioniOverlay(nuove: Impostazioni): void {
  impostazioni = nuove
  rivedi()
}

/** Chi c'e' in chiamata. Vuoto vuol dire che non ci si e'. */
export function personeOverlay(elenco: PersonaOverlay[]): void {
  persone = elenco
  if (elenco.length === 0) parlano.clear()
  else {
    // Chi e' uscito non deve restare nella memoria delle voci: fra un'ora
    // sarebbe uno che "ha parlato di recente" e non c'e' piu'.
    const presenti = new Set(elenco.map((p) => p.id))
    for (const id of [...parlano]) if (!presenti.has(id)) parlano.delete(id)
    for (const id of [...ultimaVoce.keys()]) if (!presenti.has(id)) ultimaVoce.delete(id)
  }
  rivedi()
}

/** Chi sta parlando adesso. */
export function vociOverlay(ids: string[]): void {
  const adesso = Date.now()
  for (const id of ids) ultimaVoce.set(id, adesso)
  parlano = new Set(ids)
  rivedi()
}

/** Chiude tutto: si spegne l'applicazione, o si esce dall'account. */
export function chiudiOverlay(): void {
  persone = []
  parlano.clear()
  ultimaVoce.clear()
  if (finestra && !finestra.isDestroyed()) finestra.destroy()
  finestra = null
}
