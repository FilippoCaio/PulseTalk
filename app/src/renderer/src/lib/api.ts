import type {
  Allegato,
  Amicizie,
  BranoTrovato,
  Canale,
  Categoria,
  Chiamata,
  CollegamentoProvider,
  CompatibilitaClient,
  Conversazione,
  Evento,
  EventoSpazio,
  GenereRestrizione,
  Restrizione,
  ImpostazioniSpazio,
  InformazioniClient,
  Ingresso,
  InvitoSpazio,
  Messaggio,
  Override,
  Profilo,
  ProviderMusica,
  Reazione,
  Ricevute,
  Ruolo,
  SessioneMedia,
  Sessione,
  StatoEmail,
  Spazio,
  Utente,
  VoceCoda,
  StatoUtente
} from '@shared/tipi'
import type { Permesso } from '@shared/permessi'
import type { Limiti } from '@shared/qualita'
import { confrontaVersioni, versioneValida } from '@shared/versione'
import { respira } from './banda'

/**
 * Oltre a questo, il file va a pezzi.
 *
 * E' la misura di serie di un pezzo lato server (`TALK_PEZZO_ALLEGATO`). Non
 * deve per forza coincidere: serve solo a decidere se vale la pena fare tre
 * richieste invece di una. Quella vera, per spezzare, la dice il server
 * all'apertura del caricamento.
 */
const SOGLIA_PEZZI = 8 * 1024 * 1024

/** Quante volte si riprova un pezzo prima di arrendersi. */
const TENTATIVI_PEZZO = 5

/** Una persona dentro a uno spazio, con i ruoli che ha li'. */
export interface Membro {
  id: number
  nome: string
  utente: string | null
  avatar: string | null
  ruolo: 'membro' | 'admin'
  entrato: number
  ruoli: Pick<Ruolo, 'id' | 'nome' | 'colore' | 'priorita' | 'tipo'>[]
  proprietario: boolean
  /** Amicizia accettata con chi ha richiesto l'elenco. */
  amico: boolean
}

/** Chi e' stato messo alla porta, e da chi. */
export interface Bando {
  spazio: number
  utente: number
  motivo: string
  da: number | null
  istante: number
  nome: string
  nomeUtente: string | null
  avatar: string | null
}

export interface RisultatoGif {
  id: string
  titolo: string
  url: string
  anteprima: string
  larghezza: number | null
  altezza: number | null
}

export interface RisultatoImmagineWeb {
  id: string
  titolo: string
  anteprima: string
  immagine: string
  pagina: string
  autore: string
}

export interface AnteprimaLink {
  url: string
  dominio: string
  titolo: string
  descrizione: string
  immagineId: string | null
  faviconId: string | null
}

/** Un campo del pannello di amministrazione, con la sua storia. */
export interface CampoIstanza {
  chiave: string
  /** Null quando il campo non sta in un gruppo: e' l'interruttore di una categoria. */
  gruppo: string | null
  etichetta: string
  aiuto: string
  tipo: 'testo' | 'url' | 'scelta' | 'interruttore'
  valori: string[] | null
  esempio: string | null
  /** Non torna mai indietro in chiaro: al suo posto c'e' `coda`. */
  segreta: boolean
  impostata: boolean
  /** `pannello` vince su `container`; `niente` vuol dire che non c'e' da nessuna parte. */
  origine: 'pannello' | 'container' | 'niente'
  valore: string
  /** Le ultime quattro cifre di una chiave segreta, per riconoscerla. */
  coda: string | null
  aggiornato: number | null
  da: number | null
}

/**
 * Una funzione intera: l'AI, le GIF, la musica.
 *
 * O ha `personale` — e allora esiste un interruttore per far portare a ognuno
 * la propria chiave — o ha `senzaPersonale`, che e' la riga con scritto
 * perche' qui quell'interruttore non avrebbe senso.
 */
export interface CategoriaIstanza {
  id: string
  nome: string
  sotto: string
  personale: {
    /** Il campo che tiene la scelta. */
    chiave: string
    titolo: string
    sotto: string
    /** Il valore da scrivere quando l'interruttore e' spento. */
    spento: string
    /** I modi che l'interruttore acceso puo' avere. */
    acceso: { valore: string; nome: string; sotto: string }[]
    /** In quale pagina va, chi vuole collegare la sua. */
    dove: string
  } | null
  senzaPersonale: string | null
}

/** Una manciata di campi che si compilano insieme, dentro a una categoria. */
export interface GruppoIstanza {
  id: string
  categoria: string
  nome: string
  sotto: string
}

export interface StatoIstanza {
  categorie: CategoriaIstanza[]
  gruppi: GruppoIstanza[]
  campi: CampoIstanza[]
  capacita: Record<string, unknown>
}

export interface Prova {
  ok: boolean
  cosa: string
  risposta?: string
  errore?: string
}

export interface MiaChiaveAi {
  /** Chi paga l'AI su questo server. */
  modo: 'istanza' | 'utente' | 'mista'
  /** Falso quando la chiave la mette l'amministratore: qui non c'e' niente da fare. */
  serve: boolean
  collegata: boolean
  coda: string | null
  baseUrl: string
  chatModel: string
  sttModel: string
  imageModel: string
  aggiornato: number | null
  capacita: Record<string, boolean>
  /** Cosa si eredita lasciando un campo vuoto. */
  predefiniti: { baseUrl: string; chatModel: string; sttModel: string; imageModel: string }
}

export interface SessioneAutoWriter {
  id: number
  canale: number
  richiestoDa: number
  provider: string
  stato: 'consenso' | 'attiva'
  creato: number
  avviato: number | null
  consensi: { utente: number; consenso: boolean | null; istante: number | null }[]
  segmenti: { id: number; parlante: number | null; testo: string; definitivo: boolean; creato: number }[]
}

/** Cosa dire al server su chi sta entrando, cosi' le sessioni si distinguono. */
function dispositivo(): string {
  const elettrone = !!window.pulsetalk
  const piattaforma = navigator.platform || 'ignoto'
  return `PulseTalk ${elettrone ? 'app' : 'web'} su ${piattaforma}`.slice(0, 80)
}

/**
 * Il piano di controllo.
 *
 * Passa di qui pochissimo: chi sei, quali stanze ci sono, e il gettone con cui
 * entrare in una. Tutto il resto — la voce, il video, lo schermo, la chat — va
 * direttamente alla SFU e non tocca mai questo server.
 */

/** Un invito ancora buono. Il codice non c'e': il server non lo sa piu'. */
export interface InvitoAperto {
  id: number
  nome: string
  ruolo: Utente['ruolo']
  creato: number
  scade: number
  usi: number
  usiMax: number
}

export class ErroreApi extends Error {
  constructor(
    message: string,
    readonly stato: number
  ) {
    super(message)
    this.name = 'ErroreApi'
  }
}

/**
 * A questo indirizzo c'e' un PulseTalk?
 *
 * Serve prima di qualunque altra cosa: alla prima apertura non c'e' nessun
 * token, nessun account e nessun server, e la prima domanda da fare e' dove
 * andare. Chiederla e basta, senza verificarla, vorrebbe dire scoprire un
 * indirizzo sbagliato piu' tardi — al momento della password, con un errore
 * che parla di credenziali quando il problema era una lettera nel dominio.
 *
 * `/salute` e' pubblica e non richiede niente: e' la stessa rotta che guarda
 * Docker per sapere se il container e' vivo.
 *
 * I tre esiti sono tre frasi diverse di proposito. "Non risponde nessuno" si
 * risolve controllando l'indirizzo o la rete; "risponde ma non e' PulseTalk" si
 * risolve sapendo che li' c'e' dell'altro — un router, un pannello, il NAS
 * stesso — e sono due strade che non si somigliano.
 */
export async function provaServer(
  grezzo: string,
  { timeoutMs = 8000 }: { timeoutMs?: number } = {}
): Promise<{ ok: true; indirizzo: string } | { ok: false; motivo: string }> {
  const indirizzo = String(grezzo ?? '').trim().replace(/\/+$/, '')
  if (!indirizzo) return { ok: false, motivo: "Serve l'indirizzo del server." }

  let base: URL
  try {
    base = new URL(/^https?:\/\//i.test(indirizzo) ? indirizzo : `https://${indirizzo}`)
  } catch {
    return { ok: false, motivo: `"${indirizzo}" non e' un indirizzo valido.` }
  }
  if (base.username || base.password) {
    return { ok: false, motivo: "L'indirizzo non puo' contenere credenziali." }
  }

  try {
    const risposta = await fetch(`${base.origin}${base.pathname.replace(/\/$/, '')}/salute`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!risposta.ok) {
      return { ok: false, motivo: `Risponde qualcosa, ma non e' PulseTalk (${risposta.status}).` }
    }
    const corpo = (await risposta.json()) as { ok?: boolean }
    if (corpo?.ok !== true) {
      return { ok: false, motivo: "Risponde qualcosa, ma non e' PulseTalk." }
    }
    return { ok: true, indirizzo: base.toString().replace(/\/+$/, '') }
  } catch (e) {
    // Un timeout e una connessione rifiutata sono la stessa cosa per chi
    // legge: da qui non si arriva. Distinguerli vorrebbe dire raccontare la
    // rete a qualcuno che sta solo cercando di entrare.
    const scaduto = (e as Error)?.name === 'TimeoutError'
    return {
      ok: false,
      motivo: scaduto
        ? 'Il server non ha risposto in tempo. Controlla che sia acceso e raggiungibile da qui.'
        : "Non risponde nessuno a quell'indirizzo. Controlla che sia scritto giusto — e che tu sia sulla rete giusta, se e' un indirizzo locale."
    }
  }
}

export class Api {
  constructor(
    /**
     * L'indirizzo del server, senza barra finale.
     *
     * Leggibile da fuori — il token no — perche' serve a distinguere un server
     * dall'altro: chi tiene una memoria per server (il controllo di
     * compatibilita', per esempio) deve poter dire "a questo l'ho gia'
     * chiesto" senza tenersi da parte una seconda copia dell'indirizzo.
     */
    readonly base: string,
    private token: string | null
  ) {
    this.base = base.replace(/\/+$/, '')
  }

  conToken(token: string | null): Api {
    return new Api(this.base, token)
  }

  private async chiama<T>(percorso: string, opzioni: RequestInit = {}): Promise<T> {
    let risposta: Response
    try {
      risposta = await fetch(`${this.base}${percorso}`, {
        ...opzioni,
        headers: {
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(opzioni.body ? { 'content-type': 'application/json' } : {}),
          ...opzioni.headers
        }
      })
    } catch (errore) {
      if (opzioni.signal?.aborted || (errore as Error).name === 'AbortError') {
        throw new ErroreApi('richiesta annullata', 0)
      }
      // Un fetch che fallisce prima di avere una risposta e' quasi sempre la
      // stessa cosa: l'indirizzo e' sbagliato, o il NAS e' spento. Dirlo cosi'
      // e' piu' utile di riportare "Failed to fetch".
      throw new ErroreApi(
        `Non riesco a raggiungere ${this.base}. Controlla l'indirizzo, o se il server e' acceso.`,
        0
      )
    }

    if (!risposta.ok) {
      const corpo = await risposta.json().catch(() => ({}))

      // `rotta inesistente` e' come il server risponde a un percorso che non
      // conosce, ed e' un'altra cosa dai suoi 404: quelli dicono che manca un
      // messaggio, un canale, un invito. Questo dice che manca la rotta, e fra
      // un'app aggiornata e un server rimasto indietro e' esattamente cio' che
      // succede. "Il server ha risposto 404" manderebbe a cercare il guasto
      // dalla parte sbagliata.
      if (risposta.status === 404 && (!corpo.errore || corpo.errore === 'rotta inesistente')) {
        throw new ErroreApi(
          `Questo server non conosce ${percorso}. E' rimasto indietro rispetto all'app: ` +
            `va ricostruito e riavviato (sul NAS, "docker compose up -d --build" nella ` +
            `cartella di deploy).`,
          404
        )
      }

      throw new ErroreApi(corpo.errore ?? `Il server ha risposto ${risposta.status}.`, risposta.status)
    }

    return risposta.status === 204 ? (undefined as T) : ((await risposta.json()) as T)
  }

  /**
   * Contratto pubblico da verificare prima di qualunque autenticazione.
   *
   * Il tipo TypeScript non basta: la risposta attraversa la rete e un server
   * vecchio, guasto o configurato male puo' inviare qualunque JSON. Si valida
   * qui, prima di consegnare un URL al processo che installa eseguibili.
   */
  async compatibilitaClient(info: InformazioniClient): Promise<CompatibilitaClient> {
    if (!versioneValida(info.versione)) {
      throw new ErroreApi(`La versione installata non e' una semver valida: ${info.versione}.`, 0)
    }
    const query = new URLSearchParams({
      versione: info.versione,
      piattaforma: info.piattaforma,
      architettura: info.architettura
    })
    const grezzo = await this.chiama<unknown>(`/api/client/compatibilita?${query}`)
    return validaCompatibilita(grezzo, this.base, info.versione)
  }

  // -- Accesso ---------------------------------------------------------------

  /** Cosa da' questo invito, senza consumarlo. */
  invito(codice: string): Promise<{ ruolo: Utente['ruolo']; nomeSuggerito: string }> {
    return this.chiama('/api/auth/invito', { method: 'POST', body: JSON.stringify({ codice }) })
  }

  /**
   * Questo nome utente e' libero *su questo server*?
   *
   * Serve collegandosi a un server nuovo: il nome che si usa altrove puo'
   * essere gia' di qualcun altro qui, e i due server non hanno modo di
   * saperlo l'uno dell'altro. Si chiede prima di scegliere una password,
   * invece di scoprirlo da un 409 dopo aver compilato tutto.
   *
   * Il codice di invito serve al server per rispondere: senza, sarebbe una
   * rotta aperta che dice quali nomi utente esistono.
   */
  nomeLibero(
    codice: string,
    utente: string
  ): Promise<{ libero: boolean; problema: string | null }> {
    return this.chiama('/api/auth/nome-libero', {
      method: 'POST',
      body: JSON.stringify({ codice, utente })
    })
  }

  /** Il codice diventa un account: da qui in poi si entra con utente e password. */
  riscatta(dati: {
    codice: string
    utente: string
    password: string
    nome?: string
  }): Promise<{ token: string; utente: Utente }> {
    return this.chiama('/api/auth/riscatta', {
      method: 'POST',
      body: JSON.stringify({ ...dati, dispositivo: dispositivo() })
    })
  }

  accedi(utente: string, password: string): Promise<{ token: string; utente: Utente }> {
    return this.chiama('/api/auth/accedi', {
      method: 'POST',
      body: JSON.stringify({ utente, password, dispositivo: dispositivo() })
    })
  }

  io(): Promise<{ utente: Utente; deveCompletare: boolean }> {
    return this.chiama('/api/auth/io')
  }

  esci(): Promise<{ ok: boolean }> {
    return this.chiama('/api/auth/esci', { method: 'POST' })
  }

  /** Per gli account nati prima delle password: si sceglie una volta sola. */
  completa(utente: string, password: string): Promise<{ utente: Utente }> {
    return this.chiama('/api/auth/completa', {
      method: 'POST',
      body: JSON.stringify({ utente, password })
    })
  }

  cambiaPassword(
    vecchia: string,
    nuova: string
  ): Promise<{ ok: boolean; sessioniChiuse: number }> {
    return this.chiama('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ vecchia, nuova })
    })
  }

  profilo(modifiche: {
    nome?: string
    avatar?: string | null
    stato?: StatoUtente
  }): Promise<{ utente: Utente }> {
    return this.chiama('/api/auth/profilo', { method: 'POST', body: JSON.stringify(modifiche) })
  }

  /**
   * "Sono qui ma sono fermo", detto ogni tanto dall'applicazione.
   *
   * Non salva niente sul disco: e' una condizione del momento, e chiudendo
   * l'applicazione si diventa offline, che e' un'altra cosa. Le regole di
   * quando dichiararla stanno in `usaInattivita`.
   */
  dichiaraInattivita(inattivo: boolean): Promise<{ inattivo: boolean }> {
    return this.chiama('/api/auth/inattivita', {
      method: 'POST',
      body: JSON.stringify({ inattivo })
    })
  }

  /** Nome e foto di tutti, per disegnare i riquadri di chi ha la camera spenta. */
  utenti(): Promise<{
    utenti: (Pick<Utente, 'id' | 'nome' | 'utente' | 'avatar'> & { stato: StatoUtente })[]
  }> {
    return this.chiama('/api/utenti')
  }

  sessioni(): Promise<{ sessioni: Sessione[] }> {
    return this.chiama('/api/auth/sessioni')
  }

  revocaSessione(id: number): Promise<{ revocata: number }> {
    return this.chiama(`/api/auth/sessioni/${id}/revoca`, { method: 'POST' })
  }

  // -- L'indirizzo di posta ---------------------------------------------------

  /** Quale indirizzo c'e', se e' dimostrato, e se il server sa spedire. */
  statoEmail(): Promise<StatoEmail> {
    return this.chiama('/api/io/email')
  }

  /**
   * Scrive l'indirizzo e ci fa mandare un codice.
   *
   * La password attuale serve davvero: l'indirizzo e' la strada per rientrare,
   * quindi cambiarlo vale quanto cambiare la password.
   */
  scriviEmail(indirizzo: string, password: string): Promise<StatoEmail> {
    return this.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo, password })
    })
  }

  confermaEmail(codice: string): Promise<StatoEmail> {
    return this.chiama('/api/io/email/conferma', {
      method: 'POST',
      body: JSON.stringify({ codice })
    })
  }

  togliEmail(): Promise<StatoEmail> {
    return this.chiama('/api/io/email', { method: 'DELETE' })
  }

  // -- Collegare un dispositivo nuovo -----------------------------------------

  /**
   * Un codice da guardare qui e ribattere sul dispositivo nuovo.
   *
   * E' la risposta a "e la mia password qual era?": il server non la sa — ne
   * tiene solo l'impronta scrypt — ma il problema vero non era saperla, era
   * entrare da li'.
   */
  codiceDispositivo(): Promise<{ codice: string; scade: number }> {
    return this.chiama('/api/auth/dispositivo/codice', { method: 'POST' })
  }

  /** Il codice, da fuori, in cambio di una sessione. Senza credenziali. */
  collegaConCodice(codice: string): Promise<{ token: string; utente: Utente }> {
    return this.chiama('/api/auth/dispositivo/riscatta', {
      method: 'POST',
      body: JSON.stringify({ codice, dispositivo: dispositivo() })
    })
  }

  /** Quali avvisi per posta si vogliono. Vuole un indirizzo gia' confermato. */
  impostaAvvisi(scelte: Record<string, boolean>): Promise<{ scelte: Record<string, boolean> }> {
    return this.chiama('/api/io/avvisi', {
      method: 'PUT',
      body: JSON.stringify({ scelte })
    })
  }

  // -- Rientrare senza la password --------------------------------------------

  /**
   * Chiede il codice per rimettere la password.
   *
   * La risposta e' la stessa che l'indirizzo esista o no, di proposito: una
   * differenza qui direbbe a chiunque chi ha un account su questo server.
   */
  chiediRecupero(indirizzo: string): Promise<{ ok: boolean; validoMinuti: number }> {
    return this.chiama('/api/auth/recupero', {
      method: 'POST',
      body: JSON.stringify({ indirizzo })
    })
  }

  /** Il codice e la password nuova. Chiude tutte le sessioni, compresa la propria. */
  riscattaRecupero(
    indirizzo: string,
    codice: string,
    password: string
  ): Promise<{ ok: boolean; sessioniChiuse: number }> {
    return this.chiama('/api/auth/recupero/riscatta', {
      method: 'POST',
      body: JSON.stringify({ indirizzo, codice, password })
    })
  }

  config(): Promise<{ sfuUrl: string; limiti: Limiti; versione: number }> {
    return this.chiama('/api/config')
  }

  // -- Inviti (solo admin) ---------------------------------------------------

  /** Il codice in chiaro esiste solo in questa risposta: dopo, il server ne ha solo l'impronta. */
  creaInvito(dati: {
    ruolo?: Utente['ruolo']
    giorni?: number
    usi?: number
  }): Promise<{ codice: string; ruolo: Utente['ruolo']; usi: number; scade: number }> {
    return this.chiama('/api/inviti', { method: 'POST', body: JSON.stringify(dati) })
  }

  inviti(): Promise<{ inviti: InvitoAperto[] }> {
    return this.chiama('/api/inviti')
  }

  eliminaInvito(id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/inviti/${id}`, { method: 'DELETE' })
  }

  // -- Spazi e canali --------------------------------------------------------

  spazi(): Promise<{ spazi: Spazio[] }> {
    return this.chiama('/api/spazi')
  }

  creaSpazio(dati: { nome: string; icona?: string | null }): Promise<{ spazio: Spazio }> {
    return this.chiama('/api/spazi', { method: 'POST', body: JSON.stringify(dati) })
  }

  eliminaSpazio(id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/spazi/${id}`, { method: 'DELETE' })
  }

  membri(spazio: number): Promise<{ membri: Membro[] }> {
    return this.chiama(`/api/spazi/${spazio}/membri`)
  }

  creaCategoria(spazio: number, nome: string): Promise<{ categoria: Categoria }> {
    return this.chiama(`/api/spazi/${spazio}/categorie`, {
      method: 'POST',
      body: JSON.stringify({ nome })
    })
  }

  eliminaCategoria(spazio: number, id: number): Promise<{ ok: boolean }> {
    return this.chiama(`/api/spazi/${spazio}/categorie/${id}`, { method: 'DELETE' })
  }

  creaCanale(
    spazio: number,
    dati: {
      nome: string
      tipo: 'testo' | 'voce'
      categoria?: number | null
      argomento?: string
      soloAscolto?: boolean
      privato?: boolean
      /** Chi ci trova gia' dentro, oltre a chi lo crea. */
      invitati?: number[]
      /** `null`/0 permanente; altrimenti da 1 minuto a 48 ore. */
      durataMinuti?: number | null
    }
  ): Promise<{ canale: Canale }> {
    return this.chiama(`/api/spazi/${spazio}/canali`, { method: 'POST', body: JSON.stringify(dati) })
  }

  aggiornaCanale(
    id: number,
    modifiche: {
      nome?: string
      icona?: string
      argomento?: string
      categoria?: number | null
      privato?: boolean
      durataMinuti?: number | null
    }
  ): Promise<{ canale: Canale }> {
    return this.chiama(`/api/canali/${id}`, { method: 'PATCH', body: JSON.stringify(modifiche) })
  }

  eliminaCanale(id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/canali/${id}`, { method: 'DELETE' })
  }

  // -- Chi sta dentro a un canale privato ------------------------------------

  iscritti(canale: number): Promise<{ iscritti: Profilo[] }> {
    return this.chiama(`/api/canali/${canale}/iscritti`)
  }

  invitaNelCanale(canale: number, utente: number): Promise<{ iscritti: Profilo[] }> {
    return this.chiama(`/api/canali/${canale}/iscritti`, {
      method: 'POST',
      body: JSON.stringify({ utente })
    })
  }

  togliDalCanale(canale: number, utente: number): Promise<{ tolto: number }> {
    return this.chiama(`/api/canali/${canale}/iscritti/${utente}`, { method: 'DELETE' })
  }

  // -- Amici -----------------------------------------------------------------

  amici(): Promise<Amicizie> {
    return this.chiama('/api/amici')
  }

  /** Per id quando la persona si vede gia', per nome utente quando la si cerca. */
  chiediAmicizia(chi: { utente?: number; nomeUtente?: string }): Promise<{ stato: string }> {
    return this.chiama('/api/amici', { method: 'POST', body: JSON.stringify(chi) })
  }

  accettaAmicizia(utente: number): Promise<{ stato: string }> {
    return this.chiama(`/api/amici/${utente}/accetta`, { method: 'POST' })
  }

  /** Rifiuta, annulla o smette: da fuori sono tre parole, qui e' una riga in meno. */
  togliAmicizia(utente: number): Promise<{ tolto: number }> {
    return this.chiama(`/api/amici/${utente}`, { method: 'DELETE' })
  }

  entra(canale: number): Promise<Ingresso> {
    return this.chiama(`/api/canali/${canale}/entra`, { method: 'POST' })
  }

  caccia(canale: number, identita: string): Promise<{ cacciato: string }> {
    return this.chiama(`/api/canali/${canale}/caccia`, {
      method: 'POST',
      body: JSON.stringify({ identita })
    })
  }

  // -- Moderazione della voce -------------------------------------------------

  /** Chi, in questo canale, ha addosso cosa. */
  restrizioni(canale: number): Promise<{ restrizioni: { utente: number; sue: Restrizione[] }[] }> {
    return this.chiama(`/api/canali/${canale}/restrizioni`)
  }

  /**
   * Impone o toglie un provvedimento. Le due direzioni sono la stessa chiamata.
   *
   * Un interruttore e non due rotte: cio' che si e' imposto si deve poter
   * togliere, e averle separate avrebbe reso possibile scriverne una sola —
   * cioe' una moderazione da cui non si torna indietro.
   */
  imponiRestrizione(
    canale: number,
    utente: number,
    genere: GenereRestrizione,
    attiva: boolean
  ): Promise<{ cambiato: boolean; restrizioni: Restrizione[] }> {
    return this.chiama(`/api/canali/${canale}/restrizioni`, {
      method: 'POST',
      body: JSON.stringify({ utente, genere, attiva })
    })
  }

  /**
   * Ferma una condivisione altrui per tutti, adesso.
   *
   * Diversa da `imponiRestrizione(..., 'condivisione', true)`, che invece le
   * impedisce di riaprirne: questa chiude quello che c'e' e basta. `traccia`
   * indica quale, quando ne ha piu' d'una aperte; senza, si chiudono tutte.
   */
  chiudiCondivisione(
    canale: number,
    utente: number,
    traccia?: string
  ): Promise<{ chiuse: number }> {
    return this.chiama(`/api/canali/${canale}/condivisioni/chiudi`, {
      method: 'POST',
      body: JSON.stringify({ utente, ...(traccia ? { traccia } : {}) })
    })
  }

  // -- Messaggi --------------------------------------------------------------

  messaggi(
    canale: number,
    opzioni: { prima?: number; quanti?: number } = {}
  ): Promise<{ messaggi: Messaggio[]; altri: boolean; ricevute?: Ricevute | null }> {
    const q = new URLSearchParams()
    if (opzioni.prima) q.set('prima', String(opzioni.prima))
    if (opzioni.quanti) q.set('quanti', String(opzioni.quanti))
    return this.chiama(`/api/canali/${canale}/messaggi?${q}`)
  }

  scrivi(
    canale: number,
    dati: { testo?: string; rispondeA?: number | null; allegati?: number[] }
  ): Promise<{ messaggio: Messaggio }> {
    return this.chiama(`/api/canali/${canale}/messaggi`, {
      method: 'POST',
      body: JSON.stringify(dati)
    })
  }

  modificaMessaggio(id: number, testo: string): Promise<{ messaggio: Messaggio }> {
    return this.chiama(`/api/messaggi/${id}`, { method: 'PATCH', body: JSON.stringify({ testo }) })
  }

  eliminaMessaggio(id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/messaggi/${id}`, { method: 'DELETE' })
  }

  /** Premere due volte la stessa emoji la toglie: e' lo stesso gesto. */
  reagisci(messaggio: number, emoji: string): Promise<{ reazioni: Reazione[] }> {
    return this.chiama(`/api/messaggi/${messaggio}/reazioni`, {
      method: 'POST',
      body: JSON.stringify({ emoji })
    })
  }

  segnaLetto(canale: number, fino?: number): Promise<{ fino: number }> {
    return this.chiama(`/api/canali/${canale}/letto`, {
      method: 'POST',
      body: JSON.stringify({ fino })
    })
  }

  cerca(spazio: number, q: string, canale?: number): Promise<{ risultati: Messaggio[] }> {
    const query = new URLSearchParams({ q })
    if (canale) query.set('canale', String(canale))
    return this.chiama(`/api/spazi/${spazio}/cerca?${query}`)
  }

  // -- Allegati --------------------------------------------------------------

  /**
   * Carica un file e restituisce il suo id.
   *
   * Il file si manda *prima* del messaggio: si trascina un'immagine, parte il
   * caricamento, e intanto si finisce di scrivere. Al momento dell'invio si
   * passano solo gli id.
   *
   * Sotto agli otto mega va in una richiesta sola, che e' la strada piu' corta
   * per uno screenshot incollato. Sopra, va a pezzi: vedi `caricaAPezzi`.
   */
  async carica(file: File, quandoAvanza?: (fatto: number) => void): Promise<Allegato> {
    if (file.size > SOGLIA_PEZZI) {
      try {
        return await this.caricaAPezzi(file, quandoAvanza)
      } catch (errore) {
        // Un server rimasto indietro non conosce ancora i pezzi. L'app si
        // aggiorna da sola, il server lo si ricostruisce a mano, e fra le due
        // cose passano dei giorni: in mezzo, meglio mandare il file per la
        // strada vecchia che non poterlo mandare affatto. Vale solo per il
        // 404 della rotta — un errore vero non si nasconde riprovando in un
        // altro modo.
        if (!(errore instanceof ErroreApi) || errore.stato !== 404) throw errore
      }
    }

    return this.chiama('/api/allegati', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        // Il nome viaggia in un'intestazione, che accetta solo ASCII: quello
        // vero puo' avere accenti ed emoji, quindi si codifica.
        'x-nome': encodeURIComponent(file.name)
      },
      body: file
    })
  }

  /**
   * Il file grosso, mandato un pezzo alla volta.
   *
   * Tre cose che una richiesta sola non sa fare. **Riprende**: se la linea
   * cade a tre quarti, si richiede al server dove era arrivato e si riparte da
   * li' invece che da zero — su un caricamento da mezz'ora e' la differenza
   * fra "e' andata" e "ricomincia". **Si sa a che punto e'**: un file da un
   * giga senza percentuale sembra piantato dopo dieci secondi. E soprattutto
   * **si puo' fermare**: fra un pezzo e l'altro c'e' un momento in cui non si
   * sta mandando niente, ed e' li' che `respira` lascia passare le chiamate in
   * corso. Con un unico PUT da un giga quel momento non esiste.
   *
   * Cio' che non fa e' ridurre i byte: un giga resta un giga, spezzato o
   * intero.
   */
  private async caricaAPezzi(
    file: File,
    quandoAvanza?: (fatto: number) => void
  ): Promise<Allegato> {
    const aperto = await this.chiama<{ id: string; pezzo: number; ricevuti: number }>(
      '/api/allegati/inizio',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-nome': encodeURIComponent(file.name),
          'x-tipo': file.type || 'application/octet-stream',
          'x-dimensione': String(file.size)
        }
      }
    )

    // La misura del pezzo la dice il server: e' anche il tetto di cio' che
    // regge in una richiesta, e sceglierla qui vorrebbe dire indovinarla.
    const quanto = Math.max(1, aperto.pezzo)
    let inviati = aperto.ricevuti
    let tentativi = 0

    while (inviati < file.size) {
      const fetta = file.slice(inviati, Math.min(inviati + quanto, file.size))
      const partito = performance.now()

      try {
        const esito = await this.chiama<{ ricevuti: number }>(
          `/api/allegati/${aperto.id}/pezzo`,
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/octet-stream',
              'x-offset': String(inviati)
            },
            body: fetta
          }
        )
        inviati = esito.ricevuti
        tentativi = 0
      } catch (errore) {
        // Cinque tentativi e poi si smette. Il troncone resta sul disco del
        // server per un giorno: riprovare piu' tardi ricomincia da li', non da
        // capo — ed e' il server a dire dove sia "li'", perche' un pezzo puo'
        // essere arrivato tutto proprio mentre cadeva la risposta.
        if (++tentativi > TENTATIVI_PEZZO) throw errore

        await new Promise((poi) => setTimeout(poi, 1000 * tentativi))
        const stato = await this.chiama<{ ricevuti: number }>(
          `/api/allegati/${aperto.id}/stato`
        )
        inviati = stato.ricevuti
        continue
      }

      quandoAvanza?.(inviati)
      await respira(performance.now() - partito)
    }

    return this.chiama<Allegato>(`/api/allegati/${aperto.id}/fine`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' }
    })
  }

  /** L'indirizzo da cui si scarica, con il token dentro: serve a <img src>. */
  urlAllegato(id: number): string {
    return `${this.base}/api/allegati/${id}`
  }

  /**
   * Gli allegati vogliono l'autenticazione, e un `<img src>` non manda header.
   * Si scarica con fetch e si crea un URL locale al documento.
   */
  async scaricaAllegato(id: number): Promise<string> {
    const risposta = await fetch(this.urlAllegato(id), {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {}
    })
    if (!risposta.ok) throw new ErroreApi('allegato non disponibile', risposta.status)
    return URL.createObjectURL(await risposta.blob())
  }

  // -- Le chiavi dei servizi esterni -----------------------------------------

  /** Il pannello di amministrazione: cosa e' configurato, e da dove. Solo admin. */
  impostazioniIstanza(): Promise<StatoIstanza> {
    return this.chiama('/api/admin/impostazioni')
  }

  /** Scrive. Un campo vuoto cancella e fa riemergere il valore del container. */
  salvaImpostazioniIstanza(impostazioni: Record<string, string>): Promise<StatoIstanza> {
    return this.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni })
    })
  }

  /** Chiede davvero qualcosa al servizio, invece di dire che la chiave sembra a posto. */
  provaImpostazioniIstanza(cosa: 'chat' | 'trascrizione' | 'posta'): Promise<Prova> {
    return this.chiama('/api/admin/impostazioni/prova', {
      method: 'POST',
      body: JSON.stringify({ cosa })
    })
  }

  /** La propria chiave AI, quando l'amministratore ha scelto che ognuno porti la sua. */
  miaChiaveAi(): Promise<MiaChiaveAi> {
    return this.chiama('/api/io/ai')
  }

  salvaMiaChiaveAi(dati: {
    apiKey: string
    baseUrl?: string
    chatModel?: string
    sttModel?: string
    imageModel?: string
  }): Promise<MiaChiaveAi> {
    return this.chiama('/api/io/ai', { method: 'PUT', body: JSON.stringify(dati) })
  }

  scollegaMiaChiaveAi(): Promise<MiaChiaveAi> {
    return this.chiama('/api/io/ai', { method: 'DELETE' })
  }

  provaMiaChiaveAi(cosa: 'chat' | 'trascrizione'): Promise<Prova> {
    return this.chiama('/api/io/ai/prova', { method: 'POST', body: JSON.stringify({ cosa }) })
  }

  servizi(): Promise<{
    gif: { disponibile: boolean; provider: string | null }
    anteprimeLink: { disponibile: boolean }
    ai: {
      provider: string | null
      chat: boolean
      riassunto: boolean
      immagini: boolean
      stt: boolean
      ricercaWeb: boolean
      ricercaImmagini: boolean
    }
  }> {
    return this.chiama('/api/servizi')
  }

  aiChat(canale: number, prompt: string, signal?: AbortSignal): Promise<{ messaggio: Messaggio }> {
    return this.chiama(`/api/canali/${canale}/ai/chat`, {
      method: 'POST', body: JSON.stringify({ prompt }), signal
    })
  }

  aiImmagine(canale: number, prompt: string, signal?: AbortSignal): Promise<{ messaggio: Messaggio }> {
    return this.chiama(`/api/canali/${canale}/ai/immagine`, {
      method: 'POST', body: JSON.stringify({ prompt }), signal
    })
  }

  autoWriter(canale: number): Promise<{ disponibile: boolean; sessione: SessioneAutoWriter | null }> {
    return this.chiama(`/api/canali/${canale}/autowriter`)
  }

  avviaAutoWriter(canale: number): Promise<{ sessione: SessioneAutoWriter }> {
    return this.chiama(`/api/canali/${canale}/autowriter`, { method: 'POST' })
  }

  consensoAutoWriter(canale: number, consenso: boolean): Promise<{ sessione: SessioneAutoWriter | null }> {
    return this.chiama(`/api/canali/${canale}/autowriter/consenso`, {
      method: 'POST', body: JSON.stringify({ consenso })
    })
  }

  segmentoAutoWriter(canale: number, audio: string, tipo: string): Promise<{ testo: string } | undefined> {
    return this.chiama(`/api/canali/${canale}/autowriter/segmenti`, {
      method: 'POST', body: JSON.stringify({ audio, tipo })
    })
  }

  fermaAutoWriter(canale: number): Promise<{ chiusa: number }> {
    return this.chiama(`/api/canali/${canale}/autowriter`, { method: 'DELETE' })
  }

  riassumiAutoWriter(canale: number): Promise<{
    riassunto: Record<'argomenti' | 'decisioni' | 'problemi' | 'attivita' | 'daDecidere', string[]>
    generatoDaAi: true
  }> {
    return this.chiama(`/api/canali/${canale}/autowriter/riassunto`, { method: 'POST' })
  }

  cercaGif(q: string): Promise<{ risultati: RisultatoGif[]; attribuzione: string }> {
    return this.chiama(`/api/gif/cerca?q=${encodeURIComponent(q)}`)
  }

  cercaImmagini(q: string): Promise<{ risultati: RisultatoImmagineWeb[]; provider: string }> {
    return this.chiama(`/api/immagini/cerca?q=${encodeURIComponent(q)}`)
  }

  usaImmagine(id: string): Promise<{ ok: true }> {
    return this.chiama(`/api/immagini/${encodeURIComponent(id)}/usa`, { method: 'POST' })
  }

  anteprimaLink(url: string): Promise<{ anteprima: AnteprimaLink }> {
    return this.chiama('/api/anteprime-link', { method: 'POST', body: JSON.stringify({ url }) })
  }

  async scaricaImmagineAnteprima(id: string): Promise<string> {
    const risposta = await fetch(`${this.base}/api/anteprime-link/immagini/${encodeURIComponent(id)}`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {}
    })
    if (!risposta.ok) throw new ErroreApi('immagine anteprima non disponibile', risposta.status)
    return URL.createObjectURL(await risposta.blob())
  }


  // -- Impostazioni di uno spazio --------------------------------------------

  aggiornaSpazio(
    id: number,
    modifiche: {
      nome?: string
      icona?: string | null
      descrizione?: string
      regole?: string
      proprietario?: number
      impostazioni?: Partial<ImpostazioniSpazio>
    }
  ): Promise<{ spazio: Spazio }> {
    return this.chiama(`/api/spazi/${id}`, { method: 'PATCH', body: JSON.stringify(modifiche) })
  }

  /** Tutto letto, in tutti i canali di testo che si vedono. */
  segnaSpazioLetto(id: number): Promise<{ ok: boolean }> {
    return this.chiama(`/api/spazi/${id}/letto`, { method: 'POST' })
  }

  /** Uscire. Il proprietario non puo': prima passa la casa a qualcun altro. */
  abbandonaSpazio(id: number): Promise<{ uscito: number }> {
    return this.chiama(`/api/spazi/${id}/membri/io`, { method: 'DELETE' })
  }

  aggiungiMembro(spazio: number, utente: number): Promise<{ aggiunto: number }> {
    return this.chiama(`/api/spazi/${spazio}/membri`, {
      method: 'POST',
      body: JSON.stringify({ utente })
    })
  }

  cacciaMembro(spazio: number, utente: number): Promise<{ tolto: number }> {
    return this.chiama(`/api/spazi/${spazio}/membri/${utente}`, { method: 'DELETE' })
  }

  bandi(spazio: number): Promise<{ bandi: Bando[] }> {
    return this.chiama(`/api/spazi/${spazio}/bandi`)
  }

  bandisci(spazio: number, utente: number, motivo = ''): Promise<{ bandito: number }> {
    return this.chiama(`/api/spazi/${spazio}/bandi`, {
      method: 'POST',
      body: JSON.stringify({ utente, motivo })
    })
  }

  perdona(spazio: number, utente: number): Promise<{ perdonato: number }> {
    return this.chiama(`/api/spazi/${spazio}/bandi/${utente}`, { method: 'DELETE' })
  }

  // -- Ruoli e permessi ------------------------------------------------------

  ruoli(spazio: number): Promise<{ ruoli: Ruolo[] }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli`)
  }

  creaRuolo(
    spazio: number,
    dati: { nome: string; colore?: string | null; permessi?: Permesso[]; priorita?: number }
  ): Promise<{ ruolo: Ruolo }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli`, { method: 'POST', body: JSON.stringify(dati) })
  }

  aggiornaRuolo(
    spazio: number,
    id: number,
    modifiche: { nome?: string; colore?: string | null; permessi?: Permesso[]; priorita?: number }
  ): Promise<{ ruolo: Ruolo }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(modifiche)
    })
  }

  eliminaRuolo(spazio: number, id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli/${id}`, { method: 'DELETE' })
  }

  assegnaRuolo(spazio: number, ruolo: number, utente: number): Promise<{ assegnato: number }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli/${ruolo}/membri`, {
      method: 'POST',
      body: JSON.stringify({ utente })
    })
  }

  togliRuolo(spazio: number, ruolo: number, utente: number): Promise<{ tolto: number }> {
    return this.chiama(`/api/spazi/${spazio}/ruoli/${ruolo}/membri/${utente}`, { method: 'DELETE' })
  }

  override(
    spazio: number,
    ambito: 'categoria' | 'canale',
    bersaglio: number
  ): Promise<{ override: Override[] }> {
    return this.chiama(`/api/spazi/${spazio}/override/${ambito}/${bersaglio}`)
  }

  /** Scrive un'eccezione. Consenti e nega vuoti la cancellano. */
  impostaOverride(
    spazio: number,
    ambito: 'categoria' | 'canale',
    bersaglio: number,
    dati: { tipo: 'ruolo' | 'utente'; soggetto: number; consenti?: Permesso[]; nega?: Permesso[] }
  ): Promise<{ override: Override[] }> {
    return this.chiama(`/api/spazi/${spazio}/override/${ambito}/${bersaglio}`, {
      method: 'PUT',
      body: JSON.stringify(dati)
    })
  }

  eliminaOverride(
    spazio: number,
    ambito: 'categoria' | 'canale',
    bersaglio: number,
    tipo: 'ruolo' | 'utente',
    soggetto: number
  ): Promise<{ ok: boolean }> {
    return this.chiama(`/api/spazi/${spazio}/override/${ambito}/${bersaglio}/${tipo}/${soggetto}`, {
      method: 'DELETE'
    })
  }

  // -- Categorie -------------------------------------------------------------

  rinominaCategoria(spazio: number, id: number, nome: string): Promise<{ categoria: Categoria }> {
    return this.chiama(`/api/spazi/${spazio}/categorie/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ nome })
    })
  }

  /** L'ordine di categorie e canali, tutto insieme: mezzo riordino non esiste. */
  riordina(
    spazio: number,
    ordine: { categorie?: number[]; canali?: number[] }
  ): Promise<{ ok: boolean }> {
    return this.chiama(`/api/spazi/${spazio}/ordine`, {
      method: 'POST',
      body: JSON.stringify(ordine)
    })
  }

  // -- Inviti allo spazio ----------------------------------------------------

  invitiSpazio(spazio: number): Promise<{ inviti: InvitoSpazio[] }> {
    return this.chiama(`/api/spazi/${spazio}/inviti`)
  }

  /** Il codice in chiaro esiste solo in questa risposta. */
  creaInvitoSpazio(
    spazio: number,
    dati: { giorni?: number; usi?: number; ruolo?: number | null } = {}
  ): Promise<{ codice: string; invito: InvitoSpazio }> {
    return this.chiama(`/api/spazi/${spazio}/inviti`, {
      method: 'POST',
      body: JSON.stringify(dati)
    })
  }

  eliminaInvitoSpazio(spazio: number, id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/spazi/${spazio}/inviti/${id}`, { method: 'DELETE' })
  }

  guardaInvitoSpazio(codice: string): Promise<{
    spazio: { id: number; nome: string; icona: string | null; descrizione: string; regole: string; membri: number }
    gia: boolean
  }> {
    return this.chiama(`/api/inviti-spazio/${encodeURIComponent(codice)}`)
  }

  entraConInvito(codice: string): Promise<{ spazio: number; gia: boolean }> {
    return this.chiama(`/api/inviti-spazio/${encodeURIComponent(codice)}/entra`, { method: 'POST' })
  }

  // -- Eventi ----------------------------------------------------------------

  eventiSpazio(spazio: number): Promise<{ eventi: EventoSpazio[] }> {
    return this.chiama(`/api/spazi/${spazio}/eventi`)
  }

  creaEvento(
    spazio: number,
    dati: {
      titolo: string
      descrizione?: string
      /** Secondi epoch. */
      inizio: number
      fine?: number | null
      canale?: number | null
    }
  ): Promise<{ evento: EventoSpazio }> {
    return this.chiama(`/api/spazi/${spazio}/eventi`, { method: 'POST', body: JSON.stringify(dati) })
  }

  aggiornaEvento(
    spazio: number,
    id: number,
    modifiche: Partial<{
      titolo: string
      descrizione: string
      inizio: number
      fine: number | null
      canale: number | null
      stato: 'programmato' | 'annullato'
    }>
  ): Promise<{ evento: EventoSpazio }> {
    return this.chiama(`/api/spazi/${spazio}/eventi/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(modifiche)
    })
  }

  eliminaEvento(spazio: number, id: number): Promise<{ eliminato: number }> {
    return this.chiama(`/api/spazi/${spazio}/eventi/${id}`, { method: 'DELETE' })
  }

  partecipo(
    spazio: number,
    evento: number,
    stato: 'partecipa' | 'forse' | null
  ): Promise<{ partecipanti: EventoSpazio['partecipanti'] }> {
    return this.chiama(`/api/spazi/${spazio}/eventi/${evento}/partecipo`, {
      method: 'POST',
      body: JSON.stringify({ stato })
    })
  }

  // -- Messaggi diretti ------------------------------------------------------

  diretti(): Promise<{ conversazioni: Conversazione[] }> {
    return this.chiama('/api/diretti')
  }

  /** Apre la conversazione con qualcuno, o restituisce quella che c'era. */
  apriConversazione(chi: { utente?: number; nomeUtente?: string }): Promise<{
    conversazione: Conversazione | null
  }> {
    return this.chiama('/api/diretti', { method: 'POST', body: JSON.stringify(chi) })
  }

  conversazione(id: number): Promise<{ conversazione: Conversazione | null; chiamata: Chiamata | null }> {
    return this.chiama(`/api/diretti/${id}`)
  }

  // -- Chiamate dirette ------------------------------------------------------

  avviaChiamata(conversazione: number): Promise<{ chiamata: Chiamata; ingresso: Ingresso }> {
    return this.chiama(`/api/diretti/${conversazione}/chiamata`, { method: 'POST' })
  }

  accettaChiamata(conversazione: number): Promise<{ chiamata: Chiamata; ingresso: Ingresso }> {
    return this.chiama(`/api/diretti/${conversazione}/chiamata/accetta`, { method: 'POST' })
  }

  chiudiChiamata(conversazione: number, motivo: 'chiusa' | 'rifiutata' = 'chiusa'): Promise<{ ok: boolean }> {
    return this.chiama(`/api/diretti/${conversazione}/chiamata/chiudi`, {
      method: 'POST',
      body: JSON.stringify({ motivo })
    })
  }

  // -- Sessioni condivise ----------------------------------------------------

  /** Che ora e' per il server: e' l'orologio su cui si sincronizzano tutti. */
  tempo(): Promise<{ adesso: number }> {
    return this.chiama('/api/tempo')
  }

  sessioniMedia(canale: number): Promise<{
    sessioni: SessioneMedia[]
    adesso: number
    puoComandare: boolean
  }> {
    return this.chiama(`/api/canali/${canale}/media`)
  }

  apriSessioneMedia(
    canale: number,
    tipo: 'youtube' | 'musica',
    provider?: string
  ): Promise<{ sessione: SessioneMedia; adesso: number }> {
    return this.chiama(`/api/canali/${canale}/media`, {
      method: 'POST',
      body: JSON.stringify({ tipo, provider })
    })
  }

  sessioneMedia(id: number): Promise<{
    sessione: SessioneMedia
    adesso: number
    puoComandare: boolean
  }> {
    return this.chiama(`/api/media/${id}`)
  }

  chiudiSessioneMedia(id: number): Promise<{ chiusa: number }> {
    return this.chiama(`/api/media/${id}`, { method: 'DELETE' })
  }

  comandoMedia(
    id: number,
    comando: {
      azione: 'play' | 'pausa' | 'salta' | 'riparti' | 'cambia' | 'prossimo'
      posizioneMs?: number
      riferimento?: string
      titolo?: string
      durataMs?: number
    }
  ): Promise<{ sessione: SessioneMedia; adesso: number }> {
    return this.chiama(`/api/media/${id}/comando`, { method: 'POST', body: JSON.stringify(comando) })
  }

  accodaMedia(
    id: number,
    voce: { riferimento: string; titolo?: string; durata?: number | null; meta?: unknown }
  ): Promise<{ voce: VoceCoda }> {
    return this.chiama(`/api/media/${id}/coda`, { method: 'POST', body: JSON.stringify(voce) })
  }

  togliDallaCoda(id: number, voce: number): Promise<{ tolta: number }> {
    return this.chiama(`/api/media/${id}/coda/${voce}`, { method: 'DELETE' })
  }

  riordinaCoda(id: number, ordine: number[]): Promise<{ ok: boolean }> {
    return this.chiama(`/api/media/${id}/coda/ordine`, {
      method: 'POST',
      body: JSON.stringify({ ordine })
    })
  }

  // -- Provider di musica ----------------------------------------------------

  musica(): Promise<{
    provider: ProviderMusica[]
    collegamenti: CollegamentoProvider[]
    ritorno: string | null
  }> {
    return this.chiama('/api/musica')
  }

  /** L'URL del consenso, da aprire nel browser di sistema. */
  collegaMusica(provider: string): Promise<{ autorizzazione: string }> {
    return this.chiama(`/api/musica/${provider}/collega`, { method: 'POST' })
  }

  scollegaMusica(provider: string): Promise<{ scollegato: string }> {
    return this.chiama(`/api/musica/${provider}/collega`, { method: 'DELETE' })
  }

  cercaBrani(provider: string, q: string): Promise<{ risultati: BranoTrovato[] }> {
    return this.chiama(`/api/musica/${provider}/cerca?${new URLSearchParams({ q })}`)
  }

  dispositiviMusica(
    provider: string
  ): Promise<{ dispositivi: { id: string; nome: string; tipo: string; attivo: boolean }[] }> {
    return this.chiama(`/api/musica/${provider}/dispositivi`)
  }

  /** Dice al proprio player di mettersi al passo con la sessione condivisa. */
  allineaMusica(
    provider: string,
    dati: {
      riferimento?: string | null
      posizioneMs?: number
      inRiproduzione?: boolean
      dispositivo?: string | null
    }
  ): Promise<{ ok: boolean; adesso: number }> {
    return this.chiama(`/api/musica/${provider}/allinea`, {
      method: 'POST',
      body: JSON.stringify(dati)
    })
  }

  // -- Il flusso degli eventi ------------------------------------------------

  /**
   * Un solo flusso per tutto: messaggi, reazioni, presenze, canali creati.
   *
   * Non si usa `EventSource`, che sarebbe la strada ovvia: non sa mandare un
   * header, e il token finirebbe nella query string — cioe' nei log di
   * chiunque stia in mezzo. Con `fetch` il flusso si legge a mano, il che
   * costa venti righe e le vale tutte.
   *
   * Restituisce la funzione per smettere.
   */
  flusso(
    quandoArriva: (evento: Evento) => void,
    quandoCade?: (errore: Error) => void
  ): () => void {
    const controllo = new AbortController()

    const gira = async (): Promise<void> => {
      const risposta = await fetch(`${this.base}/api/eventi`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        signal: controllo.signal
      })
      if (!risposta.ok || !risposta.body) {
        throw new ErroreApi(`Il flusso degli eventi ha risposto ${risposta.status}.`, risposta.status)
      }

      const lettore = risposta.body.getReader()
      const decodificatore = new TextDecoder()
      let avanzo = ''

      for (;;) {
        const { value, done } = await lettore.read()
        if (done) return

        avanzo += decodificatore.decode(value, { stream: true })
        const blocchi = avanzo.split('\n\n')
        // L'ultimo pezzo puo' essere un evento a meta': resta nell'avanzo e si
        // completa al prossimo giro.
        avanzo = blocchi.pop() ?? ''

        for (const blocco of blocchi) {
          const riga = blocco.split('\n').find((l) => l.startsWith('data: '))
          if (!riga) continue // un battito, non un evento
          try {
            quandoArriva(JSON.parse(riga.slice(6)))
          } catch {
            // Un evento malformato si salta: il prossimo arriva fra un istante
            // e contiene comunque lo stato intero, non un pezzo.
          }
        }
      }
    }

    // Il flusso cade: il portatile si addormenta, il tunnel si riavvia, il
    // wi-fi cambia rete. Si riprova con un'attesa che cresce, perche' un
    // riavvio del server non deve trasformarsi in mille richieste al secondo.
    let attesa = 1000
    let vivo = true

    const ciclo = async (): Promise<void> => {
      while (vivo) {
        try {
          await gira()
          attesa = 1000 // e' andata bene: la prossima caduta riparte piano
        } catch (errore) {
          if (!vivo || controllo.signal.aborted) return
          quandoCade?.(errore as Error)
        }
        if (!vivo) return
        await new Promise((r) => setTimeout(r, attesa))
        attesa = Math.min(attesa * 2, 30_000)
      }
    }

    void ciclo()

    return () => {
      vivo = false
      controllo.abort()
    }
  }
}

function validaCompatibilita(
  grezzo: unknown,
  base: string,
  versioneRichiesta: string
): CompatibilitaClient {
  if (!grezzo || typeof grezzo !== 'object' || Array.isArray(grezzo)) {
    throw new ErroreApi('Il server ha restituito una compatibilita client illeggibile.', 502)
  }
  const c = grezzo as Record<string, unknown>
  const versioni = [c.versioneClient, c.versioneMinima, c.versioneTarget]
  if (!versioni.every(versioneValida)) {
    throw new ErroreApi('Il server ha restituito versioni client non valide.', 502)
  }
  if (c.versioneMassima !== null && !versioneValida(c.versioneMassima)) {
    throw new ErroreApi('Il server ha restituito una versione massima non valida.', 502)
  }
  if (
    typeof c.compatibile !== 'boolean' ||
    typeof c.obbligatorio !== 'boolean' ||
    !['nessuna', 'aggiorna', 'clientTroppoNuovo'].includes(String(c.azione)) ||
    typeof c.feedUrl !== 'string' ||
    (c.motivo !== null && typeof c.motivo !== 'string')
  ) {
    throw new ErroreApi('Il contratto di compatibilita del server e incompleto.', 502)
  }

  const versioneClient = c.versioneClient as string
  const versioneMinima = c.versioneMinima as string
  const versioneTarget = c.versioneTarget as string
  const versioneMassima = c.versioneMassima as string | null
  const azione = c.azione as CompatibilitaClient['azione']
  if (
    versioneClient !== versioneRichiesta ||
    confrontaVersioni(versioneTarget, versioneMinima) < 0 ||
    (versioneMassima !== null && confrontaVersioni(versioneMassima, versioneTarget) < 0)
  ) {
    throw new ErroreApi('Il server ha restituito vincoli di versione incoerenti.', 502)
  }

  const troppoNuovo =
    versioneMassima !== null && confrontaVersioni(versioneClient, versioneMassima) > 0
  const sottoTarget = confrontaVersioni(versioneClient, versioneTarget) < 0
  const coerente =
    (azione === 'nessuna' && c.compatibile && !c.obbligatorio && !troppoNuovo && !sottoTarget) ||
    (azione === 'aggiorna' && c.obbligatorio && sottoTarget && !troppoNuovo) ||
    (azione === 'clientTroppoNuovo' && !c.compatibile && c.obbligatorio && troppoNuovo)
  if (!coerente) {
    throw new ErroreApi('Il server ha restituito una decisione di aggiornamento incoerente.', 502)
  }

  let feed: URL
  try {
    feed = new URL(c.feedUrl, `${base.replace(/\/+$/, '')}/`)
  } catch {
    throw new ErroreApi('Il server ha restituito un feed di aggiornamento non valido.', 502)
  }
  if (!['http:', 'https:'].includes(feed.protocol) || feed.username || feed.password) {
    throw new ErroreApi('Il feed di aggiornamento deve essere http/https e senza credenziali.', 502)
  }
  feed.hash = ''

  return {
    versioneClient,
    versioneMinima,
    versioneTarget,
    versioneMassima,
    compatibile: c.compatibile as boolean,
    obbligatorio: c.obbligatorio as boolean,
    azione,
    feedUrl: feed.toString(),
    motivo: c.motivo as string | null
  }
}
