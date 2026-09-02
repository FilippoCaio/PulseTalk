import type { Codec, Limiti, ModoAudio } from './qualita'
import type { Permesso } from './permessi'
import { SERVER_PREDEFINITO } from './predefiniti'
import type { ServerCollegato } from './collegamenti'

export type { ServerCollegato } from './collegamenti'

/**
 * I nomi dei canali fra la finestra e il processo principale.
 *
 * Costanti e non stringhe sparse: un canale scritto male da una parte e giusto
 * dall'altra non da' nessun errore, resta solo in silenzio per sempre.
 */
export const IPC = {
  sorgenti: 'sorgenti',
  preparaCattura: 'prepara-cattura',
  /**
   * L'identificativo di cattura della nostra stessa finestra.
   *
   * Serve a una cosa sola: registrare la chiamata cosi' com'e' sullo schermo,
   * riquadri e nomi compresi. Il selettore delle sorgenti non lo offre — nessuno
   * condivide PulseTalk dentro PulseTalk — e cercarla per nome fra le finestre
   * aperte vorrebbe dire indovinare fra due copie dell'applicazione.
   */
  sorgenteFinestra: 'sorgente-finestra',
  /**
   * L'overlay: chi c'e' in chiamata, e chi sta parlando adesso.
   *
   * Due canali e non uno perche' le due cose hanno ritmi diversi di due ordini
   * di grandezza. L'elenco cambia quando qualcuno entra o esce - qualche volta
   * per chiamata - e si porta dietro le foto profilo, che sono data URL da
   * qualche kilobyte l'una. Chi parla cambia dieci volte al minuto ed e' una
   * lista di identita': mandare tutto insieme vorrebbe dire rispedire le foto
   * a ogni sillaba.
   */
  overlayPersone: 'overlay-persone',
  overlayVoci: 'overlay-voci',
  leggiImpostazioni: 'leggi-impostazioni',
  scriviImpostazioni: 'scrivi-impostazioni',
  impostazioniCambiate: 'impostazioni-cambiate',
  collegaServer: 'collega-server',
  passaAServer: 'passa-a-server',
  scollegaServer: 'scollega-server',
  scorciatoia: 'scorciatoia',
  apriEsterno: 'apri-esterno',
  versione: 'versione',
  puntatore: 'puntatore',
  notifica: 'notifica',
  diagnosticaAudio: 'diagnostica-audio',
  /**
   * L'audio di una condivisione preso dal processo giusto, non dalle casse.
   * Vedi `main/audioProcesso.ts`: `dati` porta i campioni, `finito` dice che
   * quella cattura non c'e' piu' (l'applicazione condivisa e' stata chiusa).
   */
  audioProcessoAvvia: 'audio-processo-avvia',
  audioProcessoFerma: 'audio-processo-ferma',
  audioProcessoDati: 'audio-processo-dati',
  audioProcessoFinito: 'audio-processo-finito',
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
    /**
     * Questo server non pubblica aggiornamenti, e non e' un guasto.
     *
     * Un'istanza installata da qualcun altro puo' benissimo non servire nessun
     * feed: chi la amministra non compila l'applicazione, la scarica come tutti
     * gli altri. Prima questo caso arrivava come un errore rosso — "404 su
     * latest.yml" — e faceva sembrare rotta una cosa che semplicemente non c'e'.
     */
    | 'senzaFeed'
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
  /**
   * L'indirizzo del server attivo adesso, senza barra finale.
   *
   * Resta un campo solo anche adesso che i server collegati possono essere
   * piu' d'uno: tutto il resto dell'applicazione parla con *un* server per
   * volta, e farle tenere in mano un elenco vorrebbe dire far scegliere a
   * ognuno dei venti punti che lo usano. Qui c'e' quello scelto; l'elenco sta
   * in `serverCollegati`, e cambiarlo cambia questo.
   */
  server: string
  /** Il token della sessione sul server attivo. */
  token: string | null
  nome: string | null
  /** L'ultimo nome utente usato: al prossimo accesso resta solo la password. */
  utenteRicordato: string | null

  /**
   * I server a cui si e' collegati: il NAS di casa, quello dell'ufficio.
   *
   * Ognuno con le sue credenziali, che restano di la'. Il token di ciascuno
   * non sta qui dentro — nell'app installata vive cifrato accanto agli altri,
   * e nel browser in `localStorage` come e' sempre stato.
   */
  serverCollegati: ServerCollegato[]
  /** L'indirizzo di quello scelto, fra i collegati. */
  serverAttivo: string | null

  microfonoId: string | null
  cameraId: string | null
  altoparlanteId: string | null

  /**
   * Il nome del dispositivo scelto, salvato accanto al suo id.
   *
   * Non serve a riaprirlo: per quello basta l'id. Serve a poterlo nominare il
   * giorno in cui non c'e' piu' — un avviso che dice quali cuffie mancano si
   * capisce, uno che dice "il dispositivo salvato" no. Nullo quando si lascia
   * fare a Windows.
   */
  microfonoNome: string | null
  cameraNome: string | null
  altoparlanteNome: string | null

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

  /** Nel passaggio diretto fra due canali, il nuovo parte con mic e camera spenti. */
  disattivaMediaCambioCanale: boolean

  /** Specchia soltanto la propria anteprima locale della webcam. */
  specchiaCamera: boolean

  /** Carica automaticamente dal server titolo e immagine del primo link. */
  mostraAnteprimeLink: boolean

  /** L'app parte insieme a Windows e si apre da sola. */
  avvioAutomatico: boolean

  /**
   * La sezione di sinistra chiusa a mano: barra dei server e colonna dei canali.
   *
   * E' una scelta di chi guarda, non uno stato dell'applicazione, e per questo
   * sta qui e non in un `useState`: chi lavora con la finestra larga e la
   * chiude per far posto a una chat non intende richiuderla ogni mattina. Si
   * apre e si chiude con la linguetta sul bordo.
   *
   * Sul telefono non conta: li' le due colonne sono un cassetto a tutta pagina,
   * e a comandarle e' la navigazione.
   */
  colonneChiuse: boolean

  /**
   * Le persone da annunciare quando entrano in un canale vocale.
   *
   * Un suono e una notifica di Windows, e basta: serve a chi vuole tornare a
   * parlare con qualcuno senza controllare l'app ogni dieci minuti. Sono id, e
   * si accendono dal pannello degli amici.
   */
  avvisiPersone: number[]

  /**
   * Gli spazi silenziati, e fino a quando.
   *
   * Sta qui e non sul server perche' e' una preferenza di questo computer: chi
   * silenzia un server mentre lavora non intende silenziarlo anche sul
   * telefono. `fino` e' un istante in millisecondi; `null` vuol dire "finche'
   * non lo riattivo".
   */
  spaziSilenziati: { spazio: number; fino: number | null }[]

  /**
   * Su quale dispositivo Spotify mandare la musica condivisa.
   *
   * Nullo: quello attivo, che e' quasi sempre quello giusto. Si sceglie solo
   * quando ce ne sono due e la musica esce dalla stanza sbagliata.
   */
  dispositivoMusica: string | null

  /**
   * Di che colore e' dipinta l'app.
   *
   * Sta fra le impostazioni locali e non sul server per la stessa ragione dei
   * silenzi: e' una preferenza di *questo* schermo. Chi lavora al buio la sera
   * e sotto una finestra la mattina cambia tema due volte al giorno, e non
   * intende cambiarlo anche a chi sta dall'altra parte della chiamata.
   */
  tema: Tema

  /**
   * L'overlay: le facce di chi e' in chiamata, sopra a tutto il resto.
   *
   * Compare quando la finestra e' ridotta a icona e si e' dentro a un canale
   * vocale, e sparisce appena si torna alla finestra. E' l'unico momento in cui
   * serve davvero: con l'applicazione davanti agli occhi, chi parla lo si vede
   * gia'; con l'applicazione ridotta a icona - cioe' mentre si lavora, si gioca
   * o si guarda altro - non lo si sa piu', e l'unico modo di scoprirlo e'
   * riaprire la finestra proprio mentre qualcuno sta parlando.
   */
  overlay: boolean
  overlayAvatar: DimensioneOverlay
  overlayNomi: NomiOverlay
  overlayUtenti: UtentiOverlay
  /**
   * Quante facce al massimo. Zero vuol dire nessun limite.
   *
   * In una stanza da venti persone l'overlay diventerebbe una colonna alta
   * quanto lo schermo. Con un tetto, le facce sono quelle che parlano piu' di
   * recente e le altre restano fuori: chi guarda vuole sapere chi sta parlando
   * adesso, non avere l'elenco completo dei presenti.
   */
  overlayMassimo: number
  /**
   * Dove sta il pannello, in pixel dello schermo.
   *
   * Nullo finche' non lo si sposta: la prima volta si mette da solo in alto a
   * destra dello schermo principale. Si salva trascinandolo, ed e' l'unica
   * impostazione dell'overlay che non si tocca da un menu.
   */
  overlayX: number | null
  overlayY: number | null

  /**
   * In che lingua e' scritta l'interfaccia.
   *
   * Vuoto vuol dire "non ho ancora scelto", e non e' la stessa cosa di
   * "italiano": alla prima apertura si guarda cosa dice il sistema e si parte
   * da li', ma chi sceglie l'italiano di proposito deve restarci anche se
   * domani apre l'app su un computer in inglese. Un valore scelto e uno
   * indovinato non si possono distinguere se si scrivono nello stesso modo.
   */
  lingua: string
}

/**
 * I dodici colori con cui e' dipinta l'app, e nient'altro.
 *
 * Sono esattamente le variabili dichiarate in `@theme` dentro a `index.css`:
 * ogni classe di Tailwind usata nell'interfaccia — `bg-fondo-2`, `text-ok`,
 * `border-bordo` — pesca da una di queste dodici e da nessun'altra. E' per
 * questo che un tema puo' essere un oggetto di dodici stringhe invece di un
 * foglio di stile: non c'e' nessun colore che sfugga all'elenco.
 *
 * I nomi sono quelli del CSS meno il prefisso `--color-`, cosi' il giro
 * dall'impostazione alla variabile e' una concatenazione e non una tabella di
 * traduzione da tenere allineata.
 */
export type ChiaveColore =
  | 'fondo'
  | 'fondo-2'
  | 'fondo-3'
  | 'bordo'
  | 'testo'
  | 'testo-2'
  | 'testo-3'
  | 'vivo'
  | 'vivo-2'
  | 'ok'
  | 'attenzione'
  | 'male'

/** Da quale dei tre punti di partenza si parte. */
export type PresetTema = 'pulse' | 'scuro' | 'chiaro'

/**
 * Il tema: un preset, e cio' che si e' cambiato a mano rispetto a lui.
 *
 * Si salvano gli **scostamenti** e non i dodici colori risolti, ed e' la
 * differenza che conta il giorno in cui si ritocca un preset: chi aveva
 * cambiato solo il blu si ritrova il preset nuovo con sopra il suo blu, invece
 * di una fotografia dei colori di due versioni fa che nessuno ha piu' modo di
 * riconoscere come vecchia.
 */
export interface Tema {
  preset: PresetTema
  /** Solo i colori toccati. Vuoto quando il preset e' intatto. */
  colori: Partial<Record<ChiaveColore, string>>
}

export const IMPOSTAZIONI_INIZIALI: Impostazioni = {
  server: SERVER_PREDEFINITO,
  token: null,
  nome: null,
  utenteRicordato: null,

  serverCollegati: [],
  serverAttivo: null,

  microfonoId: null,
  cameraId: null,
  altoparlanteId: null,

  microfonoNome: null,
  cameraNome: null,
  altoparlanteNome: null,

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
  disattivaMediaCambioCanale: false,
  specchiaCamera: true,
  mostraAnteprimeLink: true,
  avvisiPersone: [],
  avvioAutomatico: false,
  colonneChiuse: false,
  spaziSilenziati: [],
  dispositivoMusica: null,
  tema: { preset: 'pulse', colori: {} },

  overlay: true,
  overlayAvatar: 'grande',
  overlayNomi: 'sempre',
  overlayUtenti: 'sempre',
  overlayMassimo: 8,
  overlayX: null,
  overlayY: null,

  lingua: ''
}

/**
 * Una faccia nell'overlay.
 *
 * Colore e iniziali arrivano gia' calcolati dalla finestra invece di essere
 * rifatti nel processo principale: la funzione che li ricava sta nel renderer
 * (`lib/avatar.ts`) ed e' la stessa che dipinge i riquadri della sala. Due
 * copie della stessa regola vorrebbero dire, prima o poi, la stessa persona di
 * due colori diversi nelle due finestre.
 */
export interface PersonaOverlay {
  /** L'identita' LiveKit, `u<id>`: unica, e stabile quanto la chiamata. */
  id: string
  nome: string
  /** La foto profilo come data URL, oppure nulla: restano le iniziali. */
  avatar: string | null
  colore: string
  iniziali: string
  /** Il microfono spento, o la sordina: nell'overlay diventano lo stesso segno. */
  muto: boolean
}

/** Quanto grandi le facce nell'overlay. */
export type DimensioneOverlay = 'piccolo' | 'medio' | 'grande'

/**
 * Quanti pixel misura una faccia, per ognuna delle tre.
 *
 * Qui e non in `main/overlay.ts`, che pure e' l'unico a disegnarle davvero: il
 * pannello delle impostazioni ne mostra l'anteprima, e un'anteprima che
 * sbaglia la misura e' un'anteprima che mente su cio' che si sta scegliendo.
 */
export const MISURE_OVERLAY: Record<DimensioneOverlay, number> = {
  piccolo: 28,
  medio: 36,
  grande: 48
}

/**
 * L'anello di chi parla, e quanto spazio si prende attorno alla faccia.
 *
 * Tutto in proporzione alla faccia, e non in pixel fissi: un anello da due
 * pixel attorno a una faccia da 48 e' un filo che non si vede, e lo stesso
 * anello attorno a una da 28 e' una fascia. Quello che deve restare uguale fra
 * le tre misure e' il **rapporto**, cioe' quanto l'anello pesa rispetto a cio'
 * che circonda.
 *
 * Sono due anelli concentrici e non uno. Il verde da solo, appoggiato a una
 * foto profilo, si perde: le foto sono scure sui bordi quasi sempre, e il
 * verde di sopra ci si appiattisce dentro. Lo stacco scuro fra la faccia e il
 * verde e' cio' che lo rende un anello invece che un contorno - lo separa da
 * quello che ha dentro e da quello che ha dietro, che di solito e' uno
 * schermo pieno di roba.
 *
 * Stanno **fuori** dalla faccia e non sopra: dentro avrebbero mangiato un
 * quinto della foto proprio nel momento in cui si guarda chi sta parlando. Lo
 * spazio per l'anello e' sempre riservato, anche quando nessuno parla, cosi'
 * la finestra non cambia misura a ogni sillaba.
 */
export function anelloOverlay(lato: number): {
  /** Lo stacco scuro attaccato alla faccia. */
  scuro: number
  /** Il verde, subito fuori. */
  verde: number
  /** Quanto sporgono in tutto: e' lo spazio da riservare attorno. */
  tutto: number
} {
  const scuro = Math.max(1, Math.round(lato * 0.055))
  const verde = Math.max(2, Math.round(lato * 0.1))
  return { scuro, verde, tutto: scuro + verde }
}

/** Quando si legge il nome accanto alla faccia. */
export type NomiOverlay = 'sempre' | 'parlando' | 'mai'

/** Chi compare: tutti, o solo chi sta parlando adesso. */
export type UtentiOverlay = 'sempre' | 'parlando'

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
  tipo?: 'umano' | 'bot'
}

export interface Sessione {
  id: number
  creato: number
  ultimoUso: number | null
  dispositivo: string | null
  /** Quella da cui stai guardando adesso: non si revoca per sbaglio. */
  questa: boolean
}

/**
 * L'indirizzo di posta del proprio account.
 *
 * `confermato` e' la sola cosa che conta davvero: separa un indirizzo scritto
 * da un indirizzo dimostrato, e solo il secondo serve a rientrare. `possibile`
 * dice se il server sa spedire — dove non sa, il pannello non offre niente
 * invece di offrire un pulsante che poi fallisce.
 */
export interface StatoEmail {
  indirizzo: string | null
  confermato: boolean
  possibile: boolean
  validoMinuti?: number
  /** Il catalogo degli avvisi, mandato dal server: il pannello lo disegna da sé. */
  avvisi?: { chiave: string; nome: string; sotto: string }[]
  /** Quali sono accesi. Di serie nessuno. */
  scelte?: Record<string, boolean>
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

/** Un ruolo dentro a uno spazio. Non vale un centimetro fuori da li'. */
export interface Ruolo {
  id: number
  spazio: number
  nome: string
  /** #rrggbb, oppure niente: e' solo il pallino accanto al nome. */
  colore: string | null
  permessi: Permesso[]
  /** Piu' alto vince quando due override si contraddicono. */
  priorita: number
  /** I tre predefiniti non si cancellano. */
  tipo: 'admin' | 'master' | 'base' | 'custom'
  /** Chi ce l'ha. Nullo per il ruolo base, che ce l'hanno tutti. */
  membri?: number[] | null
}

/** Un'eccezione ai permessi, su una categoria o su un canale. */
export interface Override {
  id: number
  ambito: 'categoria' | 'canale'
  bersaglio: number
  tipo: 'ruolo' | 'utente'
  soggetto: number
  consenti: Permesso[]
  nega: Permesso[]
}

/** Le preferenze di uno spazio: cose che si accendono, non permessi. */
export interface ImpostazioniSpazio {
  invitiAperti: boolean
  invitiGiorni: number
  invitiUsoSingolo: boolean
  eventiAperti: boolean
  notifichePredefinite: 'tutto' | 'menzioni' | 'niente'
  apertoATutti: boolean
}

/** Un codice che fa entrare in uno spazio. Il codice vero si vede una volta sola. */
export interface InvitoSpazio {
  id: number
  spazio: number
  creatoDa: number | null
  nomeCreatore?: string | null
  creato: number
  scade: number
  usi: number
  /** Zero: senza limite. */
  usiMax: number
  ruolo: number | null
  nomeRuolo?: string | null
}

/** Qualcosa che succedera'. */
export interface EventoSpazio {
  id: number
  spazio: number
  canale: number | null
  titolo: string
  descrizione: string
  /** Secondi epoch: il fuso e' di chi guarda. */
  inizio: number
  fine: number | null
  creatoDa: number | null
  creato: number
  stato: 'programmato' | 'annullato'
  partecipanti: { utente: number; stato: string; nome: string; avatar: string | null }[]
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
  /** Istanti Unix in secondi; `scade` nullo indica un canale permanente. */
  creato: number
  creatoDa: number | null
  scade: number | null
  /** Tempo residuo calcolato dall'orologio del server al caricamento. */
  restanoMs: number | null
  /** Solo per quelli di testo. */
  nonLetti: number
  /** Solo per i vocali: chi c'e' dentro adesso. */
  presenti: Presente[]
  /**
   * Cosa posso fare qui dentro, gia' risolto dal server.
   *
   * Solo i permessi che cambiano da canale a canale. Serve a disegnare: a dire
   * di no e' comunque il server, che rifa' lo stesso calcolo a ogni richiesta.
   */
  permessiMiei?: Permesso[]
}

export interface Spazio {
  id: number
  chiave: string
  nome: string
  icona: string | null
  descrizione: string
  regole: string
  /** Chi non lo ferma nessun permesso. Puo' mancare sugli spazi piu' vecchi. */
  proprietario: number | null
  impostazioni: ImpostazioniSpazio
  /**
   * Il proprio ruolo qui dentro, in due parole.
   *
   * Resta perche' meta' dell'interfaccia chiede solo "sono admin?". La verita'
   * fine sta in `permessiMiei`, e questo campo ne e' il riassunto: vale 'admin'
   * per chi ha manageServer.
   */
  ruoloMio: 'membro' | 'admin'
  permessiMiei: Permesso[]
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

/** Una conversazione a due, come compare nell'elenco. */
export interface Conversazione {
  id: number
  /** Il canale che la contiene: e' da li' che passano i messaggi. */
  canale: number
  creato: number
  con: Profilo & { stato: StatoUtente }
  ultimo: {
    id: number
    autore: number
    testo: string
    istante: number
    eliminato: boolean
  } | null
  nonLetti: number
}

/** Una chiamata fra due persone: prima squilla, poi c'e', poi non c'e' piu'. */
export interface Chiamata {
  conversazione: number
  /** Il nome della stanza sulla SFU. */
  stanza: string
  da: number
  a: number
  stato: 'squilla' | 'in corso' | 'chiusa' | 'rifiutata' | 'persa'
  iniziata: number
  risposta: number | null
}

/** Una voce della coda condivisa. */
export interface VoceCoda {
  id: number
  sessione: number
  /** L'id del video di YouTube, o l'URI di Spotify. */
  riferimento: string
  titolo: string
  durata: number | null
  meta: Record<string, unknown> | null
  aggiuntoDa: number | null
  nomeAggiunto?: string | null
  posizione: number
  suonato: boolean
  aggiunto: number
}

/**
 * Lo stato di una sessione condivisa.
 *
 * `aggiornato` e `posizioneMs` vanno letti insieme: la posizione vera adesso e'
 * la seconda piu' il tempo passato dalla prima, e solo se sta suonando. E'
 * l'unico modo perche' due computer con orologi diversi arrivino allo stesso
 * secondo.
 */
export interface StatoMedia {
  riferimento?: string
  titolo?: string
  durataMs?: number
  posizioneMs?: number
  inRiproduzione?: boolean
  velocita?: number
  /** Millisecondi dell'orologio del SERVER, non del proprio. */
  aggiornato?: number
  vocePosizione?: number
}

export interface SessioneMedia {
  id: number
  canale: number
  tipo: 'youtube' | 'musica'
  provider: string | null
  host: number | null
  stato: StatoMedia
  /** Dove sarebbe adesso, calcolata dal server nell'istante della risposta. */
  posizioneAttesa: number
  coda: VoceCoda[]
  aggiornato: number
}

/** Un servizio di musica che questo server sa usare. */
export interface ProviderMusica {
  nome: string
  etichetta: string
  configurato: boolean
  limiti: Record<string, string> | null
}

export interface CollegamentoProvider {
  provider: string
  identita: string | null
  nome: string | null
  /** 'premium' oppure 'free': i comandi funzionano solo col primo. */
  prodotto: string | null
  collegato: number
  ambiti: string[]
}

/** Un brano trovato cercando su un provider. */
export interface BranoTrovato {
  riferimento: string
  titolo: string
  artista: string
  album: string
  durata: number | null
  copertina: string | null
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
  origine: 'umano' | 'ai' | 'ai-immagine'
  provider: string | null
  modello: string | null
  /**
   * Chi ha chiesto il messaggio, quando a scriverlo e' stato un bot.
   *
   * Vale solo per le risposte dell'AI: il bot non fa login, e senza questo
   * la sua riga non la potrebbe togliere piu' nessuno.
   */
  richiestoDa: number | null
  autoreTipo: 'umano' | 'bot'
  autoreNome: string | null
  autoreAvatar: string | null
}

/**
 * Cosa arriva sul flusso degli eventi.
 *
 * Un'unione discriminata e non un `{ tipo: string; dati: unknown }`: cosi' chi
 * la legge, dopo aver controllato `tipo`, ha gia' i campi giusti sotto mano e
 * il compilatore si accorge di un campo dimenticato. Aggiungerne uno nuovo
 * senza gestirlo da' un errore dove serve, invece che silenzio a tempo di
 * esecuzione.
 *
 * I messaggi di una conversazione diretta arrivano con `diretto` e
 * `conversazione` valorizzati: e' lo stesso evento, perche' sotto e' lo stesso
 * canale.
 */
/**
 * Le due spunte di una conversazione diretta, dal punto di vista di chi guarda.
 *
 * Sono gli id dei messaggi fin dove l'altra persona e' arrivata: `consegnato` e'
 * fin dove il messaggio le e' stato recapitato, `letto` fin dove ha aperto la
 * conversazione. Zero vuol dire "non ancora".
 *
 * Solo per i diretti: in un canale con quaranta persone "gli e' arrivato" non
 * e' una domanda con una risposta sola.
 */
export interface Ricevute {
  consegnato: number
  letto: number
}

export type Evento =
  | { tipo: 'spazi' }
  | { tipo: 'amici' }
  | { tipo: 'diretti' }
  | { tipo: 'ruoli'; spazio: number }
  | { tipo: 'eventi'; spazio: number }
  | { tipo: 'autowriter'; spazio: number; canale: number }
  | { tipo: 'presenza'; spazio: number }
  /**
   * Le restrizioni vocali di qualcuno, in un canale, sono cambiate.
   *
   * Arriva solo agli interessati: al bersaglio, che deve vedere scritto cosa
   * non puo' fare e da parte di chi, e a chi sta nella stanza, perche' e' li'
   * che si legge lo stato degli altri. A nessun altro — chi sta leggendo una
   * chat da un'altra parte non ha motivo di sapere chi e' stato zittito.
   */
  | {
      tipo: 'restrizioni'
      canale: number
      utente: number
      restrizioni: Restrizione[]
    }
  /**
   * Qualcuno e' comparso, sparito, si e' fermato o si e' messo a non
   * disturbare. Da non confondere con `presenza`, che riguarda chi sta dentro
   * a un canale vocale di *quello* spazio: questo riguarda la persona, ovunque
   * sia, e lo stato e' gia' quello che si puo' mostrare — `invisibile` esce
   * come `offline` e non arriva mai fin qui.
   */
  | { tipo: 'stato-utente'; utente: number; stato: StatoUtente }
  | {
      tipo: 'ricevute'
      spazio: number
      canale: number
      conversazione?: number | null
      diretto?: boolean
      ricevute: Ricevute
    }
  /**
   * "Fin qui l'ho letto io", detto dal server a chi ha letto.
   *
   * Va soltanto alle sessioni di quella persona, e serve a spegnere il numero
   * blu. Prima non esisteva: la lettura si scriveva nel database e nessuno
   * avvisava l'elenco dei canali, che restava fermo al conteggio dell'ultima
   * `GET /api/spazi` — cioe' il pallino si accendeva da solo e si spegneva
   * soltanto ricaricando per un altro motivo.
   *
   * Va a tutte le sessioni e non solo a quella che ha chiesto: letto sul
   * telefono vuol dire letto anche sul computer, che e' la sola cosa che
   * "letto" possa ragionevolmente voler dire.
   */
  | {
      tipo: 'letto'
      spazio: number
      canale: number
      /** L'id dell'ultimo messaggio considerato letto. */
      fino: number
      diretto?: boolean
      conversazione?: number | null
    }
  /** Tutto letto in uno spazio intero: la voce "segna come gia' letto". */
  | { tipo: 'letto-spazio'; spazio: number }
  | {
      tipo: 'messaggio'
      spazio: number
      canale: number
      messaggio: Messaggio
      diretto?: boolean
      conversazione?: number | null
    }
  | {
      tipo: 'messaggio-modificato'
      spazio: number
      canale: number
      messaggio: Messaggio
      diretto?: boolean
      conversazione?: number | null
    }
  | {
      tipo: 'messaggio-eliminato'
      spazio: number
      canale: number
      id: number
      diretto?: boolean
      conversazione?: number | null
    }
  | {
      tipo: 'reazioni'
      spazio: number
      canale: number
      messaggio: number
      reazioni: Reazione[]
      diretto?: boolean
      conversazione?: number | null
    }
  | { tipo: 'chiamata-arriva'; conversazione: number; chiamata: Chiamata }
  | { tipo: 'chiamata-risposta'; conversazione: number; chiamata: Chiamata }
  | {
      tipo: 'chiamata-finita'
      conversazione: number
      chiamata: Chiamata
      motivo: 'chiusa' | 'rifiutata' | 'persa'
      chiusaDa?: number
    }
  | {
      tipo: 'media'
      canale: number
      sessione: SessioneMedia | null
      /** L'orologio del server nell'istante in cui l'evento e' partito. */
      adesso: number
      evento?: string
      chiusa?: number
      da?: number
    }

export interface Permessi {
  puoTrasmettere: boolean
  puoAscoltare: boolean
  puoScrivere: boolean
  /** Schermo, camera e sessioni da guardare insieme. */
  puoCondividere?: boolean
  /** Caccia dalla stanza, spegne le camere, toglie le condivisioni. */
  moderatore: boolean
  /** Muto forzato del microfono altrui. */
  puoZittire?: boolean
  /** Muto forzato delle cuffie altrui: gli impedisce anche di sentire. */
  puoAssordare?: boolean
}

/**
 * Cosa non si puo' fare in questo canale, per decisione di qualcun altro.
 *
 * Quattro generi e non uno di piu'. Manca — e manca apposta — "accendi la
 * telecamera": spegnere quella di un altro e' moderazione, accenderla sarebbe
 * un'altra cosa, e non esiste nessun permesso che la conceda a nessuno.
 */
export type GenereRestrizione = 'camera' | 'condivisione' | 'microfono' | 'cuffie'

export interface Restrizione {
  genere: GenereRestrizione
  /** Quando e' stata imposta, in secondi epoch. */
  istante: number
  /** L'evento sotto la cui autorita' e' stata imposta: alla sua fine decade. */
  evento: number | null
  /** Chi l'ha imposta. Nullo se quell'account non c'e' piu'. */
  da: { id: number; nome: string | null } | null
}

export interface Ingresso {
  gettone: string
  sfuUrl: string
  canale: { id: number; nome: string; spazio: number; soloAscolto: boolean }
  /**
   * Presente solo per le chiamate fra due persone.
   *
   * Il resto dell'ingresso e' identico a quello di un canale vocale, ed e'
   * voluto: la sessione RTC non deve sapere se sta parlando in un canale o al
   * telefono. Cambia solo cosa ci si disegna intorno.
   */
  diretta?: { conversazione: number; con: number }
  permessi: Permessi
  /**
   * Le proprie restrizioni in questo canale, gia' pronte all'ingresso.
   *
   * Arrivano insieme al gettone e non con un secondo giro di rete: chi entra
   * con il microfono bloccato deve vederlo scritto subito, non scoprirlo
   * premendo un pulsante che non risponde.
   */
  restrizioni?: Restrizione[]
  limiti: Limiti
}
