import type { ChiaveColore, PresetTema, Tema } from './tipi'

/**
 * I colori dell'app, e i tre modi di sceglierli.
 *
 * Tutta l'interfaccia dipende da dodici variabili CSS e da nessun colore
 * scritto a mano — e' la premessa che rende possibile questo file. Cambiare
 * tema non vuol dire ridisegnare niente: vuol dire scrivere dodici valori su
 * `documentElement`, e Tailwind, che quelle dodici le legge con `var()`,
 * ridipinge tutto da solo nello stesso fotogramma. Quella scrittura sta in
 * `renderer/lib/tema.ts`; qui ci sono i valori e i conti, che non toccano il
 * documento.
 *
 * Sono condivisi perche' li guardano in due. Il processo principale deve
 * sapere di che colore aprire la finestra *prima* che dentro ci sia una
 * pagina: senza, ogni avvio con un tema chiaro comincia con un rettangolo nero
 * grande quanto lo schermo. Un secondo elenco di colori scritto di la' sarebbe
 * divergente al primo ritocco.
 *
 * Tre modi di arrivarci, dal piu' comodo al piu' libero:
 *
 * 1. **I preset.** Tre insiemi scritti a mano, provati sullo schermo vero.
 * 2. **A mano libera.** Ogni colore si apre e si cambia, e sopra al preset
 *    restano solo gli scostamenti.
 * 3. **Una tavolozza da coolors.co.** Cinque colori scelti da qualcun altro
 *    diventano dodici, con le regole scritte qui sotto.
 *
 * Il terzo e' quello che ha richiesto vero lavoro, e vale la pena dire
 * perche'. Una tavolozza di coolors non e' un tema: e' un accordo di colori
 * senza ruoli, e nessuno dei cinque porta scritto addosso "io sono il fondo" o
 * "io sono l'errore". I ruoli vanno dedotti, e dedotti in modo che il
 * risultato sia *leggibile* anche quando la tavolozza non e' stata pensata per
 * un'interfaccia — che e' il caso normale, visto che su coolors si generano a
 * caso finche' una piace.
 */

// -- Conti sui colori ---------------------------------------------------------

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Legge un colore scritto come lo scrive un essere umano.
 *
 * Con o senza cancelletto, a tre cifre o a sei, con spazi intorno: sono le
 * quattro forme in cui un colore arriva incollato da fuori, e rifiutarne tre
 * su quattro vorrebbe dire un campo che si lamenta di cio' che ha capito
 * benissimo.
 */
export function leggiEsadecimale(testo: string): Rgb | null {
  const pulito = testo.trim().replace(/^#/, '')
  const esteso =
    pulito.length === 3
      ? pulito
          .split('')
          .map((c) => c + c)
          .join('')
      : pulito
  if (!/^[0-9a-fA-F]{6}$/.test(esteso)) return null
  const n = parseInt(esteso, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function esadecimale({ r, g, b }: Rgb): string {
  const cifra = (v: number): string =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${cifra(r)}${cifra(g)}${cifra(b)}`
}

/**
 * Quanto un colore e' luminoso *per l'occhio*, da 0 a 1.
 *
 * La formula sRGB con la correzione di gamma, non la media dei tre canali: il
 * verde pesa quasi tre quarti e il blu quasi niente, e senza quella pesatura
 * un blu pieno e un giallo pieno risulterebbero ugualmente chiari — cioe' si
 * sceglierebbe il blu come colore del testo.
 */
export function luminosita({ r, g, b }: Rgb): number {
  const canale = (v: number): number => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b)
}

/** Il rapporto di contrasto fra due colori, come lo definisce il WCAG: da 1 a 21. */
export function contrasto(a: Rgb, b: Rgb): number {
  const la = luminosita(a)
  const lb = luminosita(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Due colori mescolati: `quanto` a 0 e' tutto il primo, a 1 tutto il secondo. */
export function mescola(a: Rgb, b: Rgb, quanto: number): Rgb {
  const q = Math.min(1, Math.max(0, quanto))
  return {
    r: a.r + (b.r - a.r) * q,
    g: a.g + (b.g - a.g) * q,
    b: a.b + (b.b - a.b) * q
  }
}

export interface Hsl {
  /** Gradi, da 0 a 360. */
  h: number
  s: number
  l: number
}

export function aHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const massimo = Math.max(rr, gg, bb)
  const minimo = Math.min(rr, gg, bb)
  const l = (massimo + minimo) / 2
  const d = massimo - minimo
  if (d === 0) return { h: 0, s: 0, l }

  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    massimo === rr
      ? 60 * (((gg - bb) / d + 6) % 6)
      : massimo === gg
        ? 60 * ((bb - rr) / d + 2)
        : 60 * ((rr - gg) / d + 4)
  return { h, s, l }
}

export function daHsl({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = l - c / 2
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** Lo stesso colore con la luce riportata dentro a un intervallo. */
function stringiLuce(colore: Rgb, minimo: number, massimo: number): Rgb {
  const hsl = aHsl(colore)
  return daHsl({ ...hsl, l: Math.min(massimo, Math.max(minimo, hsl.l)) })
}

/**
 * Un colore spinto lontano dal fondo finche' non ci si legge sopra.
 *
 * Sposta **solo la luce**, e non a occhio: cerca per bisezione il valore che
 * porta il contrasto WCAG all'obiettivo, e si ferma li'. Tinta e saturazione
 * restano quelle scelte da chi ha fatto la tavolozza, che e' l'unica cosa che
 * si vuole conservare; la luce e' cio' che decide se il colore si legge, e
 * quella la decidiamo noi.
 *
 * Perche' non basta stringere la luce in un intervallo, che e' cio' che si
 * fa d'istinto: **la L di HSL non e' la luminosita' percepita**. Un verde
 * pieno a L=0,5 e un blu pieno a L=0,5 hanno la stessa L e luminosita'
 * lontanissime — nella formula sRGB il verde pesa 0,72 e il blu 0,07. Il
 * risultato, misurato: un `ok` verde tenuto "a meta' strada" finiva a 1,1 di
 * contrasto su un fondo chiaro, cioe' invisibile, mentre lo stesso intervallo
 * su un blu dava 4,4. Un intervallo di L e' una regola che tratta i colori
 * come se fossero tutti dello stesso peso, e non lo sono.
 *
 * Il verso lo decide il fondo: su un fondo chiaro si scurisce, su uno scuro si
 * schiarisce. Chi e' gia' abbastanza staccato non si tocca — l'ambra su un
 * fondo quasi nero sta a 13 di contrasto di suo, e spegnerla per portarla a 4,5
 * vorrebbe dire rovinare un colore che andava bene.
 */
function staccaDa(colore: Rgb, fondo: Rgb, obiettivo: number): Rgb {
  if (contrasto(colore, fondo) >= obiettivo) return colore

  const fondoChiaro = luminosita(fondo) > 0.4
  const hsl = aHsl(colore)
  // L'estremo — nero su fondo chiaro, bianco su fondo scuro — arriva a 21 di
  // contrasto: e' la risposta di ripiego, quella che c'e' sempre.
  let migliore = daHsl({ ...hsl, l: fondoChiaro ? 0 : 1 })
  let basso = fondoChiaro ? 0 : hsl.l
  let alto = fondoChiaro ? hsl.l : 1

  // Dodici bisezioni su un intervallo lungo al piu' 1: l'errore finale sta
  // sotto un quarto di millesimo, cioe' sotto il gradino di un canale a 8 bit.
  for (let i = 0; i < 12; i += 1) {
    const meta = (basso + alto) / 2
    const prova = daHsl({ ...hsl, l: meta })
    const basta = contrasto(prova, fondo) >= obiettivo
    if (basta) migliore = prova
    // Si tiene il colore piu' vicino possibile a quello di partenza fra quelli
    // che bastano: si scurisce (o si schiarisce) del minimo indispensabile.
    if (basta === fondoChiaro) basso = meta
    else alto = meta
  }
  return migliore
}

/**
 * Quanto deve staccare un accento dal fondo.
 *
 * 4,5 e' il minimo che il WCAG chiede al testo normale, ed e' la soglia giusta
 * perche' gli accenti *sono* testo: `text-male` dipinge la parola "Esci",
 * `text-ok` il nome del canale in cui si sta parlando. Vale anche per il caso
 * rovesciato — `bg-vivo` con sopra il colore del fondo — perche' il
 * contrasto e' simmetrico: la stessa coppia, letta al contrario.
 */
const STACCO_ACCENTO = 4.5

/**
 * Quanto colore c'e' davvero dentro a un colore, da 0 a 1.
 *
 * La distanza fra il canale piu' acceso e il piu' spento, e non la saturazione
 * di HSL, che vicino al bianco e al nero mente in modo spettacolare: il panna
 * `#fefae0` ha saturazione HSL 0,96 — piu' di un arancione pieno — e di
 * colore non ne ha praticamente. La differenza fra i suoi canali e' 30 su 255.
 *
 * Conta perche' e' il filtro con cui si scelgono gli accenti. Con la
 * saturazione, una tavolozza di beige e crema offriva i suoi crema come
 * candidati e il verde della chiamata usciva bianco sporco; con la croma,
 * quei crema non si qualificano e gli accenti vengono fabbricati, che e' il
 * comportamento giusto per una tavolozza che di accenti non ne ha.
 */
function croma({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

/**
 * Sotto questa croma un colore non e' un accento, e' una tinta di grigio.
 *
 * 0,15 sta dove sta perche' e' li' che passa il confine su cui si sbaglia: il
 * panna a 0,12 resta fuori, il rosa pastello a 0,20 entra. Piu' in alto si
 * perderebbero le tavolozze pastello per intero — che sono meta' di quelle
 * che la gente genera — e piu' in basso rientrerebbero i beige.
 */
const CROMA_MINIMA = 0.15

/** Quanto distano due tinte sul cerchio: mai piu' di 180 gradi. */
function distanzaTinta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

// -- I dodici ruoli -----------------------------------------------------------

/**
 * Cosa dipinge ciascuno dei dodici, detto a chi li sta scegliendo.
 *
 * La descrizione non e' cortesia: davanti a dodici quadratini chiamati
 * "fondo-2" e "testo-3" non si sceglie, si prova a caso finche' qualcosa
 * cambia in un punto che si stava guardando. Ognuna dice **dove si vede** quel
 * colore, che e' l'unica informazione che serve per decidere se toccarlo.
 */
export const RUOLI: { chiave: ChiaveColore; nome: string; dove: string }[] = [
  { chiave: 'fondo', nome: 'Fondo', dove: 'Il nero sotto a tutto: la sala, le colonne, le pagine.' },
  { chiave: 'fondo-2', nome: 'Fondo dei pannelli', dove: 'Impostazioni, menu, il pannello della chiamata.' },
  { chiave: 'fondo-3', nome: 'Fondo sollevato', dove: 'La riga sotto al cursore, la sezione aperta, i campi.' },
  { chiave: 'bordo', nome: 'Bordi', dove: 'I fili fra una cosa e l\'altra, e le barre di scorrimento.' },
  { chiave: 'testo', nome: 'Testo', dove: 'Quello che si legge davvero: messaggi, nomi, titoli.' },
  { chiave: 'testo-2', nome: 'Testo secondario', dove: 'Etichette e spiegazioni sotto ai comandi.' },
  { chiave: 'testo-3', nome: 'Testo smorto', dove: 'Orari, conteggi, cio\' che c\'e\' ma non si legge.' },
  { chiave: 'vivo', nome: 'Colore vivo', dove: 'Il pulsante principale, i link, lo spazio aperto.' },
  { chiave: 'vivo-2', nome: 'Vivo al passaggio', dove: 'Lo stesso, sotto al cursore. Piu\' chiaro su fondo scuro, piu\' scuro su fondo chiaro.' },
  { chiave: 'ok', nome: 'Verde', dove: 'La chiamata in corso, chi e\' online, cio\' che e\' andato bene.' },
  { chiave: 'attenzione', nome: 'Ambra', dove: 'La linea che balla, gli avvisi che non fermano niente.' },
  { chiave: 'male', nome: 'Rosso', dove: 'Esci, elimina, il microfono spento, gli errori.' }
]

export const CHIAVI: ChiaveColore[] = RUOLI.map((r) => r.chiave)

export type Colori = Record<ChiaveColore, string>

// -- I tre preset -------------------------------------------------------------

/**
 * I tre punti di partenza.
 *
 * `pulse` e' quello di sempre, ed e' rimasto identico al pixel: chi non apre
 * mai questa pagina non deve accorgersi che esiste.
 *
 * `scuro` e' lo stesso mestiere senza la tinta blu — grigi neutri, accenti
 * appena spenti. Serve a chi guarda schermi condivisi tutto il giorno: un
 * fondo con dentro del blu tira il bianco degli altri verso il caldo, e su
 * quattro ore di codice altrui si sente.
 *
 * `chiaro` esiste perche' e' stato chiesto, e va detto che va contro la scelta
 * con cui l'app e' nata — accanto a un riquadro che mostra lo schermo di
 * qualcun altro, ogni pixel chiaro e' luce da scavalcare per tornare a
 * leggere. Fuori dalle chiamate, di giorno, davanti a una finestra, e' pero'
 * esattamente il contrario. Chi lo accende sa cosa sta facendo.
 */
export const PRESET: Record<PresetTema, Colori> = {
  pulse: {
    fondo: '#0b0e14',
    'fondo-2': '#121722',
    'fondo-3': '#1a2030',
    bordo: '#232b3d',
    testo: '#e6e9f0',
    'testo-2': '#98a2b8',
    'testo-3': '#6b7590',
    vivo: '#4f9cf9',
    'vivo-2': '#7cb8ff',
    ok: '#3ecf8e',
    attenzione: '#f5a524',
    male: '#f4525a'
  },
  scuro: {
    fondo: '#0c0c0e',
    'fondo-2': '#141417',
    'fondo-3': '#1e1e22',
    bordo: '#2b2b31',
    testo: '#eaeaee',
    'testo-2': '#9d9da7',
    'testo-3': '#6e6e78',
    vivo: '#7f8cf8',
    'vivo-2': '#a4adfb',
    ok: '#4dc98c',
    attenzione: '#e2a53c',
    male: '#ef5c64'
  },
  chiaro: {
    fondo: '#f6f7f9',
    'fondo-2': '#ffffff',
    'fondo-3': '#eceff4',
    bordo: '#d5dae3',
    testo: '#141821',
    'testo-2': '#4c5568',
    'testo-3': '#7b8497',
    vivo: '#2f6fd0',
    // Piu' scuro, non piu' chiaro: e' il vivo *sotto al cursore*, e su un fondo
    // bianco un blu che schiarisce sparisce invece di rispondere.
    'vivo-2': '#1f52a4',
    ok: '#18855a',
    attenzione: '#a86a08',
    male: '#c9313c'
  }
}

/** I dodici colori veri di un tema: il preset, con sopra cio' che si e' toccato. */
export function coloriDi(tema: Tema | undefined | null): Colori {
  const base = PRESET[tema?.preset ?? 'pulse'] ?? PRESET.pulse
  const scelti = tema?.colori ?? {}
  const fuori: Partial<Colori> = {}
  for (const chiave of CHIAVI) {
    // Un valore illeggibile si scarta invece di finire nel CSS: `var()` con
    // dentro una stringa storta non fallisce, lascia semplicemente la
    // proprieta' non impostata, e il risultato sarebbe un pannello trasparente
    // senza nessun errore da nessuna parte.
    const letto = scelti[chiave] ? leggiEsadecimale(scelti[chiave]!) : null
    if (letto) fuori[chiave] = esadecimale(letto)
  }
  return { ...base, ...fuori }
}

/** Vero se il tema si scosta dal suo preset. */
export function personalizzato(tema: Tema | undefined | null): boolean {
  const base = PRESET[tema?.preset ?? 'pulse'] ?? PRESET.pulse
  const colori = coloriDi(tema)
  return CHIAVI.some((c) => colori[c].toLowerCase() !== base[c].toLowerCase())
}

// -- Una tavolozza da coolors.co ----------------------------------------------

/**
 * I colori dentro a un indirizzo di coolors.co, o dentro a niente.
 *
 * Le forme che quel sito produce sono tre, e cambiano da una versione
 * all'altra: `coolors.co/264653-2a9d8f-e9c46a`, la stessa con `/palette/`
 * davanti, e i link di esportazione con altra roba in mezzo. Invece di
 * inseguire il formato si cerca cio' che non cambia — gruppi di sei cifre
 * esadecimali separati da trattini — e si prende il gruppo piu' lungo.
 *
 * Che accetti anche una riga di colori incollati a mano non e' un effetto
 * collaterale: chi ha la tavolozza su un foglio invece che in un link deve
 * poterla usare lo stesso, e "#264653, #2a9d8f, #e9c46a" e' esattamente come
 * la si copia da qualunque altro posto.
 */
export function daCoolors(testo: string): string[] {
  const trovati = testo.match(/[0-9a-fA-F]{6}/g)
  if (!trovati) return []

  // Senza doppioni e nell'ordine in cui erano scritti: una tavolozza di
  // coolors e' ordinata da chi l'ha fatta, e quell'ordine e' un'informazione.
  const visti = new Set<string>()
  const colori: string[] = []
  for (const grezzo of trovati) {
    const rgb = leggiEsadecimale(grezzo)
    if (!rgb) continue
    const pulito = esadecimale(rgb)
    if (visti.has(pulito)) continue
    visti.add(pulito)
    colori.push(pulito)
  }
  return colori
}

/** La tinta ideale di ciascun accento, e quanto lontano si accetta di andare. */
const ACCENTI: { chiave: 'vivo' | 'ok' | 'attenzione' | 'male'; tinta: number }[] = [
  // Il rosso per primo, ed e' voluto: e' l'unico che, sbagliato, fa danno —
  // "elimina" dipinto di verde si preme senza guardare. Prende quindi la prima
  // scelta fra i candidati, e gli altri si arrangiano con cio' che resta.
  { chiave: 'male', tinta: 5 },
  { chiave: 'ok', tinta: 145 },
  { chiave: 'attenzione', tinta: 42 },
  { chiave: 'vivo', tinta: 215 }
]

/**
 * Dodici colori ricavati da una tavolozza qualunque.
 *
 * Il problema, detto bene: cinque colori scelti perche' stanno bene insieme in
 * un poster devono diventare un'interfaccia in cui si legge una chat per
 * quattro ore. Sono due mestieri diversi, e la parte difficile non e'
 * distribuire i colori — e' impedire che il risultato sia illeggibile.
 *
 * Da qui le tre regole, in ordine di importanza:
 *
 * 1. **I fondi e i testi non vengono presi dalla tavolozza, ci vengono
 *    spinti.** Il piu' scuro fa da fondo, ma la sua luce viene stretta sotto a
 *    una soglia; il piu' chiaro fa da testo, e viene stretto sopra a un'altra.
 *    Si tiene la *tinta* — che e' cio' che rende un tema riconoscibile — e si
 *    butta la luce, che e' cio' che lo rende leggibile o no. Una tavolozza di
 *    cinque colori pastello, presa alla lettera, darebbe testo grigio chiaro su
 *    fondo grigio chiaro.
 *
 * 2. **Le quattro scale di fondo e le tre di testo si costruiscono
 *    mescolando**, non pescando. Servono sette valori vicini e ordinati, e
 *    cinque colori scelti per essere *distanti* fra loro non li contengono:
 *    presi a caso, il bordo verrebbe piu' chiaro del testo secondario.
 *
 * 3. **Gli accenti vanno per tinta, e il rosso vince.** Verde uguale bene,
 *    rosso uguale pericolo: sono le due convenzioni che nessun tema puo'
 *    permettersi di rovesciare, perche' non si leggono, si obbediscono. Chi
 *    non trova un candidato vicino alla sua tinta se lo fabbrica ruotando il
 *    piu' colorato che c'e', cosi' resta parente degli altri invece di essere
 *    un colore capitato li'.
 */
/**
 * Cosa una tavolozza puo' toccare, e cosa no.
 *
 * Fondi, bordi e testi si': sono la superficie su cui l'app e' disegnata, e
 * cambiarli e' esattamente cio' che si vuole incollando una tavolozza.
 *
 * Gli accenti no. Verde uguale «sta andando», rosso uguale «esci di qui»,
 * ambra uguale «guarda che». Non sono decorazione: sono l'unica cosa che nella
 * barra della chiamata distingue il pulsante che chiude una chiamata da quello
 * che accende la camera, e li si obbedisce senza leggerli. Una tavolozza presa
 * da un poster non sa niente di questo, e sostituendoli produce due pulsanti
 * importanti dello stesso colore — bello a vedersi, e sbagliato da premere.
 *
 * Restano modificabili a mano, uno per uno, dai dodici colori: li' si sta
 * cambiando *quel* colore sapendo cos'e', che e' un'altra cosa dal vederseli
 * riscritti in blocco da un accordo cromatico.
 */
const DALLA_TAVOLOZZA: ChiaveColore[] = [
  'fondo',
  'fondo-2',
  'fondo-3',
  'bordo',
  'testo',
  'testo-2',
  'testo-3'
]

/**
 * I dodici colori, ma con gli accenti lasciati dov'erano.
 *
 * `temaDaPalette` continua a calcolarli tutti — servono all'anteprima, che
 * mostra cosa la tavolozza saprebbe fare — e questa e' la funzione che poi ne
 * applica solo la parte che tocca la superficie.
 */
export function soloSuperficie(nuovi: Colori, attuali: Colori): Colori {
  const fuori = { ...attuali }
  for (const chiave of DALLA_TAVOLOZZA) fuori[chiave] = nuovi[chiave]
  return fuori
}

export function temaDaPalette(palette: string[], verso: 'scuro' | 'chiaro' = 'scuro'): Colori {
  const colori = palette.map(leggiEsadecimale).filter((c): c is Rgb => c !== null)
  if (colori.length === 0) return PRESET[verso === 'chiaro' ? 'chiaro' : 'pulse']

  const scuro = verso === 'scuro'
  const perLuce = [...colori].sort((a, b) => luminosita(a) - luminosita(b))
  const piuScuro = perLuce[0]
  const piuChiaro = perLuce[perLuce.length - 1]

  // Regola 1: la tinta della tavolozza, la luce nostra.
  const fondo = scuro ? stringiLuce(piuScuro, 0.02, 0.10) : stringiLuce(piuChiaro, 0.94, 0.99)
  const testo = scuro ? stringiLuce(piuChiaro, 0.88, 0.98) : stringiLuce(piuScuro, 0.06, 0.16)

  // Regola 2: le scale si mescolano fra i due estremi. I gradini non sono
  // uguali — 5, 11, 19 centesimi — perche' l'occhio distingue peggio le
  // differenze fra i toni scuri che fra quelli chiari, e tre passi uguali
  // darebbero un fondo-2 indistinguibile dal fondo e un bordo troppo acceso.
  const passo = (quanto: number): string => esadecimale(mescola(fondo, testo, quanto))

  // Regola 3: gli accenti, per tinta.
  //
  // Candidati sono i colori con abbastanza croma da essere riconoscibili come
  // colori: sotto la soglia un "rosso" e' un grigio caldo, e dipingerci sopra
  // il pulsante che elimina un canale sarebbe peggio che non avere tavolozza.
  const candidati = colori
    .map((c) => ({ rgb: c, hsl: aHsl(c), croma: croma(c) }))
    .filter((c) => c.croma >= CROMA_MINIMA)
    .sort((a, b) => b.croma - a.croma)

  const presi = new Set<number>()
  const accenti: Partial<Record<'vivo' | 'ok' | 'attenzione' | 'male', Rgb>> = {}

  for (const { chiave, tinta } of ACCENTI) {
    let migliore = -1
    let distanza = Infinity
    candidati.forEach((c, i) => {
      if (presi.has(i)) return
      const d = distanzaTinta(c.hsl.h, tinta)
      // Oltre 55 gradi non e' piu' "quel colore un po' spostato", e' un altro
      // colore: meglio fabbricarselo che chiamare verde un ciano.
      if (d < distanza && d <= 55) {
        distanza = d
        migliore = i
      }
    })
    if (migliore >= 0) {
      presi.add(migliore)
      accenti[chiave] = candidati[migliore].rgb
    }
  }

  // Chi e' rimasto senza: si ruota la tinta del piu' colorato che c'e',
  // tenendone saturazione e luce. Il risultato appartiene alla stessa
  // tavolozza — stessa intensita', stessa aria — invece di essere un rosso
  // qualunque appiccicato a un tema pastello.
  const sorgente = candidati[0]?.hsl ?? aHsl(leggiEsadecimale(PRESET.pulse.vivo)!)
  for (const { chiave, tinta } of ACCENTI) {
    if (accenti[chiave]) continue
    accenti[chiave] = daHsl({ h: tinta, s: Math.max(0.45, sorgente.s), l: sorgente.l })
  }

  /**
   * Un accento leggibile sul fondo che gli e' toccato.
   *
   * Serve perche' un accento vive in due modi opposti: dipinge testo *sopra*
   * al fondo (`text-ok`) e fa da fondo lui stesso con il colore del fondo
   * scritto sopra (`bg-vivo text-fondo`). Sono la stessa coppia letta nei due
   * versi, quindi una misura sola li copre tutti e due.
   */
  const accento = (c: Rgb): Rgb => staccaDa(c, fondo, STACCO_ACCENTO)

  const vivo = accento(accenti.vivo!)

  return {
    fondo: esadecimale(fondo),
    'fondo-2': passo(0.05),
    'fondo-3': passo(0.11),
    bordo: passo(0.19),
    testo: esadecimale(testo),
    // I due testi minori si spengono verso il fondo, non verso il grigio: e'
    // cosi' che restano dello stesso tema invece di sembrare presi da un altro.
    //
    // La mescolanza dice *quanto spenti si vogliono*, e il pavimento dice
    // quanto spenti si possono. Servono tutti e due perche' la mescolanza da
    // sola non e' una garanzia: lo stesso 0,58 che su fondo scuro lascia il
    // testo smorto a 3,7 di contrasto, su un fondo panna con sopra un testo
    // blu-grigio lo porta a 2,8 — sotto la soglia sotto la quale il WCAG non
    // accetta nemmeno il testo grande. Dipende da quanto sono distanti i due
    // estremi della tavolozza, e le tavolozze sono di chi le fa.
    //
    // 3,2 per lo smorto e non 3,0: e' il pavimento, e un pavimento che tocca
    // esattamente la soglia dell'avviso lo fa suonare a caso.
    'testo-2': esadecimale(staccaDa(mescola(testo, fondo, 0.38), fondo, 4.5)),
    'testo-3': esadecimale(staccaDa(mescola(testo, fondo, 0.58), fondo, 3.2)),
    vivo: esadecimale(vivo),
    // Il vivo sotto al cursore: sempre un passo *verso il testo*, che vuol
    // dire piu' chiaro su fondo scuro e piu' scuro su fondo chiaro. Una regola
    // sola per tutti e due i versi, perche' la cosa che deve succedere e' una
    // sola — il pulsante si allontana dal fondo, cioe' risponde di essere
    // stato notato.
    'vivo-2': esadecimale(mescola(vivo, testo, 0.3)),
    ok: esadecimale(accento(accenti.ok!)),
    attenzione: esadecimale(accento(accenti.attenzione!)),
    male: esadecimale(accento(accenti.male!))
  }
}

/**
 * Quanto e' leggibile un tema, in una riga sola.
 *
 * Tre misure e non dodici: il testo sul fondo, il testo smorto sul fondo, e il
 * fondo sopra al colore vivo — che e' il caso che si dimentica sempre, perche'
 * e' l'unico in cui il fondo fa da inchiostro. Sono le tre coppie che, se
 * reggono, portano dietro tutte le altre.
 *
 * Serve alla pagina delle impostazioni per dire "qui non si legge" *prima* che
 * si applichi il tema, invece di lasciarlo scoprire dopo, quando per tornare
 * indietro bisogna leggere dei pulsanti che non si vedono piu'.
 */
export function leggibilita(colori: Colori): { minimo: number; scarso: boolean } {
  const fondo = leggiEsadecimale(colori.fondo)!
  const coppie = [
    contrasto(leggiEsadecimale(colori.testo)!, fondo),
    contrasto(leggiEsadecimale(colori['testo-3'])!, fondo),
    contrasto(fondo, leggiEsadecimale(colori.vivo)!)
  ]
  const minimo = Math.min(...coppie)
  // 3 e' la soglia sotto la quale il WCAG non accetta nemmeno il testo grande:
  // sotto di li' non e' una questione di gusti.
  return { minimo, scarso: minimo < 3 }
}
