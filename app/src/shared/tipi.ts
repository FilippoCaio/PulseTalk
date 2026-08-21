import type { Codec, Limiti, ModoAudio } from './qualita'
import { SERVER_PREDEFINITO } from './predefiniti'

/**
 * I nomi dei canali fra la finestra e il processo principale.
 *
 * Costanti e non stringhe sparse: un canale scritto male da una parte e giusto
 * dall'altra non da' nessun errore, resta solo in silenzio per sempre.
 */
export const IPC = {
  sorgenti: 'sorgenti',
  preparaCattura: 'prepara-cattura',
  leggiImpostazioni: 'leggi-impostazioni',
  scriviImpostazioni: 'scrivi-impostazioni',
  impostazioniCambiate: 'impostazioni-cambiate',
  scorciatoia: 'scorciatoia',
  apriEsterno: 'apri-esterno',
  versione: 'versione',
  puntatore: 'puntatore',
  notifica: 'notifica',
  diagnosticaAudio: 'diagnostica-audio',
  aggiornamento: 'aggiornamento',
  aggiornamentoStato: 'aggiornamento-stato',
  aggiornamentoControlla: 'aggiornamento-controlla',
  aggiornamentoPrepara: 'aggiornamento-prepara',
  aggiornamentoScarica: 'aggiornamento-scarica',
  aggiornamentoInstalla: 'aggiornamento-installa'
} as const

/**
 * A che punto sta il controllo degli aggiornamenti.
 *
 * Uno stato solo, spedito dal main a ogni cambiamento, invece di cinque eventi
 * separati da riordinare nel renderer: chi apre il pannello a meta' download
 * deve vedere il download, non l'ultimo evento che gli e' passato accanto.
 */
export interface StatoAggiornamento {
  fase:
    | 'fermo'
    | 'controllo'
    | 'disponibile'
    | 'scarico'
    | 'pronto'
    | 'aggiornato'
    | 'errore'
    /** Portabile o versione di sviluppo: non c'e' niente da aggiornare. */
    | 'nonSupportato'
  /** Quella installata adesso. */
  versione: string
  /** Quella trovata, se ce n'e' una. */
  disponibile?: string
  note?: string
  percento?: number
  errore?: string
  /** Vero quando il server non consente di continuare con la versione attuale. */
  obbligatorio?: boolean
  /** La prima versione che il feed deve offrire per soddisfare il server. */
  richiesta?: string
}

/** Risposta pubblica del server, consultata prima dell'autenticazione. */
export interface CompatibilitaClient {
  versioneClient: string
  versioneMinima: string
  versioneTarget: string
  versioneMassima: string | null
  compatibile: boolean
  obbligatorio: boolean
  azione: 'nessuna' | 'aggiorna' | 'clientTroppoNuovo'
  /** Assoluto dopo la validazione dell'API client. */
  feedUrl: string
  motivo: string | null
}

/** Dati non sensibili del binario, usati nella verifica pubblica. */
export interface InformazioniClient {
  versione: string
  piattaforma: string
  architettura: string
}

/** Vincolo che il renderer consegna all'aggiornatore nel processo main. */
export interface PreparazioneAggiornamento {
  feedUrl: string
  versioneTarget: string
  versioneMassima: string | null
  obbligatorio: boolean
}

/** Uno schermo o una finestra che si puo' condividere. */
export interface Sorgente {
  id: string
  nome: string
  /**
   * `dispositivo` non viene da desktopCapturer: lo costruisce il selettore
   * partendo dalle camere e dalle schede di acquisizione. Passa dalla stessa
   * strada di tutto il resto perche' per chi guarda e' identico — un riquadro
   * che arriva da te — e sdoppiare il percorso avrebbe voluto dire due
   * pubblicazioni da tenere d'accordo.
   */
  tipo: 'schermo' | 'finestra' | 'dispositivo'
  /** JPEG in base64, gia' come data URL. Serve solo al selettore. */
  anteprima: string
  /** L'icona dell'applicazione, quando Windows la fornisce. */
  icona: string | null
  /** Presente solo per gli schermi: dice quale monitor e'. */
  schermoId: string | null
  /**
   * I pixel veri, non quelli logici. Su uno schermo al 150% le due misure
   * differiscono, e sono i pixel veri quelli che decidono se il testo si legge:
   * chiedere la cattura a 2560x1440 su un monitor che ne ha 3840x2160 fa una
   * riduzione che nessun bitrate recupera piu'.
   */
  larghezza: number | null
  altezza: number | null
}

/**
 * Come catturare l'audio di sistema insieme al video.
 *
 * Su Windows Electron sa agganciare il loopback del dispositivo di uscita, che
 * e' esattamente quello che Discord fa fatica a fare. Le due varianti si
 * distinguono solo per cosa succede *qui*: con `condiviso` il suono continua a
 * uscire dalle tue casse mentre lo mandi, con `soloRemoto` no.
 *
 * Non e' per applicazione: e' tutto quello che esce dalla scheda audio. Windows
 * un'API per-applicazione ce l'ha, ma Electron non la espone, e arrivarci
 * vorrebbe dire un modulo nativo. C'e' un giro che funziona lo stesso, ed e'
 * spiegato nel README.
 */
export type ModoAudioSistema = 'niente' | 'condiviso' | 'soloRemoto'

/**
 * Un "guarda qui": dove, su quale schermo, e di che colore.
 *
 * `x` e `y` sono frazioni del video da 0 a 1, non pixel: chi indica ha il
 * riquadro grande, chi guarda ce l'ha nella striscia, e un numero di pixel non
 * vorrebbe dire niente per l'altro. `schermoId` e' il monitor di chi
 * condivide, e serve solo a lui: e' quello su cui disegnare l'alone vero.
 */
export interface Puntata {
  schermoId: string
  x: number
  y: number
  colore: string
  nome: string
  /**
   * Chi lo tiene premuto, e quindi quale finestra spostare.
   *
   * Assente: e' un tocco: nasce, fa l'onda, muore da solo. Presente: e' un
   * puntatore tenuto, che si sposta finche' chi lo tiene non lascia — e
   * allora arriva `lascia` con lo stesso id.
   */
  tenuto?: string
  /** Chiude il puntatore tenuto con questo id. Gli altri campi si ignorano. */
  lascia?: string
}

export interface SceltaCattura {
  sorgenteId: string
  audioSistema: ModoAudioSistema
}

/** Cosa si ricorda l'app fra un'apertura e l'altra. */
export interface Impostazioni {
  /** L'indirizzo del piano di controllo, senza barra finale. */
  server: string
  /** Il token della sessione, ottenuto entrando o riscattando un invito. */
  token: string | null
  nome: string | null
  /** L'ultimo nome utente usato: al prossimo accesso resta solo la password. */
  utenteRicordato: string | null

  microfonoId: string | null
  cameraId: string | null
  altoparlanteId: string | null

  /**
   * Il volume in entrata e quello in uscita, come li chiama Discord.
   *
   * "Entrata" e' il proprio microfono prima che parta: un guadagno vero,
   * applicato da un GainNode fra il dispositivo e la pubblicazione, e per
   * questo puo' andare sopra il 100% — chi ha un microfono debole non ha altro
   * modo di farsi sentire. "Uscita" e' quanto forte arriva tutto il resto, e
   * si ferma a 100 perche' un elemento audio non accetta di piu'.
   */
  volumeMicrofono: number
  volumeUscita: number

  /**
   * La soglia sotto la quale il microfono non trasmette, da 0 a 1.
   *
   * L'automute: si alza finche' il rumore di fondo resta sotto e la voce sopra.
   * Zero e' spento, ed e' il valore di partenza — un cancello tarato a caso
   * taglia le parole, e va regolato guardando il misuratore nelle impostazioni.
   */
  sogliaMicrofono: number

  /** I suoni delle azioni: muto, camera, condivisione, chi entra e chi esce. */
  suoni: boolean
  volumeSuoni: number

  /**
   * Tiene in memoria gli ultimi secondi di voce, per poterli risuonare.
   *
   * Non e' una registrazione: e' un anello di campioni che si sovrascrive da
   * solo e che muore uscendo dalla stanza. Non tocca mai il disco e non esce
   * mai dal computer — ma resta la voce di altre persone, e per questo la
   * stanza lo dichiara mentre e' acceso.
   */
  riascolto: boolean
  /** Quanti secondi indietro. */
  secondiRiascolto: number

  /**
   * Dove si agganciano gli altri riquadri quando uno e' in sovraimpressione.
   *
   * Sotto e' il posto normale. A destra o a sinistra serve su uno schermo largo,
   * dove una striscia orizzontale ruba altezza proprio a cio' che si sta
   * guardando; sopra serve a chi tiene la finestra in basso e non vuole
   * abbassare gli occhi per vedere chi parla.
   */
  posizioneStriscia: PosizioneStriscia

  modoAudio: ModoAudio
  presetSchermo: string
  presetCamera: string
  codecPreferito: Codec | 'auto'

  /**
   * Quando e' spento, la qualita' resta quella scelta anche se il riquadro e'
   * piccolo. E' il comportamento che ci si aspetta da un programma senza
   * limiti, ed e' il contrario di quello che fa qualunque altro.
   */
  adattaAllaFinestra: boolean

  /** L'audio di sistema da mandare insieme allo schermo. */
  audioSistema: ModoAudioSistema

  /** Premuta ovunque, anche con l'app dietro ad altre finestre. */
  scorciatoiaMuto: string
  scorciatoiaSordina: string

  /** Mostra risoluzione, fotogrammi e bitrate veri sopra a ogni riquadro. */
  mostraStatistiche: boolean

  /**
   * Entrare in un vocale accende il microfono.
   *
   * Acceso di serie: si entra in una stanza per parlare. Spento, la traccia si
   * pubblica zittita e il primo clic sul pulsante e' immediato, perche' il
   * dispositivo e' gia' aperto.
   */
  microfonoAllIngresso: boolean

  /** L'app parte insieme a Windows e si apre da sola. */
  avvioAutomatico: boolean

  /**
   * Le persone da annunciare quando entrano in un canale vocale.
   *
   * Un suono e una notifica di Windows, e basta: serve a chi vuole tornare a
   * parlare con qualcuno senza controllare l'app ogni dieci minuti. Sono id, e
   * si accendono dal pannello degli amici.
   */
  avvisiPersone: number[]
}

export const IMPOSTAZIONI_INIZIALI: Impostazioni = {
  server: SERVER_PREDEFINITO,
  token: null,
  nome: null,
  utenteRicordato: null,

  microfonoId: null,
  cameraId: null,
  altoparlanteId: null,

  volumeMicrofono: 1,
  volumeUscita: 1,
  sogliaMicrofono: 0,

  suoni: true,
  volumeSuoni: 0.6,

  riascolto: true,
  secondiRiascolto: 30,
  posizioneStriscia: 'sotto',

  modoAudio: 'voce',
  presetSchermo: 'codice',
  presetCamera: 'alta',
  codecPreferito: 'auto',

  adattaAllaFinestra: false,
  audioSistema: 'condiviso',

  scorciatoiaMuto: 'CommandOrControl+Shift+M',
  scorciatoiaSordina: 'CommandOrControl+Shift+D',

  mostraStatistiche: true,
  microfonoAllIngresso: true,
  avvisiPersone: [],
  avvioAutomatico: false
}

/** I quattro lati a cui si puo' agganciare la striscia dei riquadri. */
export type PosizioneStriscia = 'sotto' | 'sopra' | 'sinistra' | 'destra'

/** Le scorciatoie globali riconosciute, tradotte in un nome che vuol dire qualcosa. */
export type Scorciatoia = 'muto' | 'sordina'

// -- Cio' che arriva dal piano di controllo -----------------------------------

export interface Utente {
  id: number
  /** Come ti vedono gli altri. Cambiabile, con accenti, spazi ed emoji. */
  nome: string
  /** Il nome con cui si entra: minuscolo, unico, senza spazi. */
  utente: string | null
  ruolo: 'ospite' | 'membro' | 'admin'
  /** La foto profilo come data URL. Nullo: si ripiega sulle iniziali. */
  avatar: string | null
  /** Lo stato scelto a mano. Sul proprio profilo puo essere `invisibile`; su quello altrui mai. */
  stato: StatoUtente
}

export interface Sessione {
  id: number
  creato: number
  ultimoUso: number | null
  dispositivo: string | null
  /** Quella da cui stai guardando adesso: non si revoca per sbaglio. */
  questa: boolean
}

export interface Presente {
  identita: string
  nome: string
  entrato: number | null
  schermi: number
  camera: boolean
  microfono: boolean
}

export interface Categoria {
  id: number
  spazio: number
  nome: string
  posizione: number
}

/**
 * Lo stato scelto a mano.
 *
 * `offline` non si sceglie: e cio che gli altri vedono al posto di
 * `invisibile`, ed e il motivo per cui invisibile funziona — dal server esce
 * gia tradotto, quindi nemmeno un client modificato saprebbe distinguerlo da
 * chi ha davvero chiuso l applicazione.
 */
export type StatoUtente = 'online' | 'inattivo' | 'occupato' | 'invisibile' | 'offline'

export interface Canale {
  id: number
  chiave: string
  nome: string
  /** Un'emoji davanti al nome, per riconoscerlo a colpo d'occhio. */
  icona: string | null
  tipo: 'testo' | 'voce'
  argomento: string
  categoria: number | null
  posizione: number
  /** Solo per i vocali: parlano gli admin, gli altri guardano. */
  soloAscolto: boolean
  /**
   * Lo vedono solo gli invitati.
   *
   * Chi non e' iscritto non riceve questo canale nell'elenco, non ci entra
   * chiedendolo per id, e non lo incontra nemmeno cercando fra i messaggi: per
   * lui non esiste. Gli admin dello spazio lo vedono comunque — hanno il
   * database sotto mano, e fingere il contrario sarebbe una recita.
   */
  privato: boolean
  /** Solo per quelli di testo. */
  nonLetti: number
  /** Solo per i vocali: chi c'e' dentro adesso. */
  presenti: Presente[]
}

export interface Spazio {
  id: number
  chiave: string
  nome: string
  icona: string | null
  /** Il proprio ruolo qui dentro: decide chi vede i pulsanti di gestione. */
  ruoloMio: 'membro' | 'admin'
  categorie: Categoria[]
  canali: Canale[]
}

/** Una persona come compare negli elenchi: amici, iscritti, membri. */
export interface Profilo {
  id: number
  nome: string
  utente: string | null
  avatar: string | null
}

/**
 * Le tre liste degli amici.
 *
 * Essere amici qui non apre nessuna porta: non da' accesso a uno spazio ne' a
 * un canale. Serve ad avere sottomano le persone che si invitano piu' spesso,
 * e a sapere chi c'e'. Un permesso ereditato dall'amicizia sarebbe un permesso
 * che nessuno ha mai concesso davvero.
 */
export interface Amicizie {
  amici: Profilo[]
  /** Chi ha chiesto a te: aspettano una risposta. */
  ricevute: Profilo[]
  /** A chi hai chiesto tu. */
  inviate: Profilo[]
}

export interface Allegato {
  id: number
  nome: string
  tipo: string
  dimensione: number
  larghezza: number | null
  altezza: number | null
}

export interface Reazione {
  emoji: string
  /** Chi l'ha messa: serve a sapere se ci sei anche tu. */
  utenti: number[]
}

export interface Messaggio {
  id: number
  canale: number
  autore: number
  testo: string
  istante: number
  modificato: number | null
  /** L'id del messaggio citato, se questa e' una risposta. */
  rispondeA: number | null
  /** Il posto resta, il contenuto no: cosi' le risposte che lo citano reggono. */
  eliminato: boolean
  allegati: Allegato[]
  reazioni: Reazione[]
}

/** Cosa arriva sul flusso degli eventi. */
export type Evento =
  | { tipo: 'spazi' }
  | { tipo: 'amici' }
  | { tipo: 'presenza'; spazio: number }
  | { tipo: 'messaggio'; spazio: number; canale: number; messaggio: Messaggio }
  | { tipo: 'messaggio-modificato'; spazio: number; canale: number; messaggio: Messaggio }
  | { tipo: 'messaggio-eliminato'; spazio: number; canale: number; id: number }
  | { tipo: 'reazioni'; spazio: number; canale: number; messaggio: number; reazioni: Reazione[] }

export interface Permessi {
  puoTrasmettere: boolean
  puoAscoltare: boolean
  puoScrivere: boolean
  moderatore: boolean
}

export interface Ingresso {
  gettone: string
  sfuUrl: string
  canale: { id: number; nome: string; spazio: number; soloAscolto: boolean }
  permessi: Permessi
  limiti: Limiti
}
