import type {
  Allegato,
  Amicizie,
  Canale,
  Categoria,
  CompatibilitaClient,
  Evento,
  InformazioniClient,
  Ingresso,
  Messaggio,
  Profilo,
  Reazione,
  Sessione,
  Spazio,
  Utente,
  StatoUtente
} from '@shared/tipi'
import type { Limiti } from '@shared/qualita'
import { confrontaVersioni, versioneValida } from '@shared/versione'

/** Una persona dentro a uno spazio, con il ruolo che ha li'. */
export interface Membro {
  id: number
  nome: string
  utente: string | null
  avatar: string | null
  ruolo: 'membro' | 'admin'
  entrato: number
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

export class Api {
  constructor(
    private readonly base: string,
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
    } catch {
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

  // -- Messaggi --------------------------------------------------------------

  messaggi(
    canale: number,
    opzioni: { prima?: number; quanti?: number } = {}
  ): Promise<{ messaggi: Messaggio[]; altri: boolean }> {
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
   */
  async carica(file: File): Promise<Allegato> {
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
