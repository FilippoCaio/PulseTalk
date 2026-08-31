/**
 * I server a cui si e' collegati, e come si tiene in ordine l'elenco.
 *
 * "Server" qui vuol dire l'installazione vera: il NAS di casa, la macchina
 * dell'ufficio. Sono cose separate fino in fondo — database diversi, account
 * diversi, inviti diversi — e l'unica cosa che hanno in comune e'
 * l'applicazione con cui ci si entra. Da non confondere con gli **spazi**, che
 * Discord chiama server e che stanno *dentro* a uno di questi.
 *
 * ## L'indirizzo e' l'identita'
 *
 * Non c'e' un id inventato accanto all'indirizzo: l'indirizzo normalizzato *e'*
 * la chiave. Vuol dire una cosa precisa, ed e' una scelta e non una scorciatoia:
 * **un'identita' per server**. Due account sullo stesso NAS nella stessa
 * applicazione non si possono avere, e non e' una mancanza — e' la stessa
 * regola che vale sul server, dove un nome utente sta per una persona sola.
 *
 * ## I nomi duplicati
 *
 * E' il problema vero del collegarsi a piu' server, e si risolve dove nasce.
 * Ogni server ha il suo elenco di nomi utente e non sa niente degli altri:
 * `marco` sul NAS di casa e `marco` in ufficio possono essere due persone
 * diverse, e nessuno dei due server puo' accorgersene. Quindi non si prova a
 * tenere un'identita' unica fra i server — non esiste un posto dove tenerla —
 * ma si tiene unica *dentro* ogni server, che e' l'unico posto dove la
 * domanda ha una risposta.
 *
 * In pratica: entrando in un server nuovo si propone il nome che si usa gia'
 * altrove. Se li' e' libero, non e' successo niente e si continua con lo
 * stesso nome ovunque. Se e' preso, se ne sceglie un altro *per quel server*,
 * e l'applicazione se lo ricorda accanto al suo indirizzo. Da fuori sembra un
 * account solo; sotto sono account separati, come e' giusto che siano quando
 * i server non si conoscono fra loro.
 */

/** Un server a cui si e' collegati. */
export interface ServerCollegato {
  /** L'indirizzo normalizzato. E' anche la chiave: uno per server. */
  indirizzo: string
  /** Come si chiama nell'elenco. Di serie il nome dell'host. */
  nome: string
  /** Il nome utente usato li'. Puo' essere diverso da server a server. */
  utente: string | null
  /** Il nome visibile di la'. */
  nomeVisibile: string | null
  /** Secondi epoch dell'ultima volta che ci si e' entrati. Ordina l'elenco. */
  ultimoAccesso: number
}

/**
 * Da quello che uno scrive a un indirizzo utilizzabile.
 *
 * Chi incolla `talk.casa.it` intende https, non un errore di analisi: aggiungere
 * lo schema qui, in un posto solo, evita che ogni modulo lo faccia a modo suo.
 */
export function normalizzaIndirizzo(grezzo: string): string {
  const pulito = String(grezzo ?? '')
    .trim()
    .replace(/\/+$/, '')
  if (!pulito) return ''
  return /^https?:\/\//i.test(pulito) ? pulito : `https://${pulito}`
}

/**
 * Il nome di serie di un server: il suo host, senza `www.` e senza porta.
 *
 * Si puo' cambiare, e cambiarlo e' quasi sempre la prima cosa che si fa: fra
 * `talk.casa.it` e `talk.acme-interno.example` la differenza si legge, ma fra
 * due indirizzi lunghi che cominciano uguale no, e la barra a sinistra ha
 * spazio per una parola.
 */
export function nomeDaIndirizzo(indirizzo: string): string {
  try {
    const url = new URL(normalizzaIndirizzo(indirizzo))
    const host = url.hostname.replace(/^www\./, '')

    // Un indirizzo IP non ha una parte che significhi qualcosa: `192.168.1.10`
    // spezzato sui punti darebbe `168`, che come nome e' peggio di niente.
    // Stessa cosa per `localhost` e per qualunque host senza punti. Li' si
    // tiene tutto, con la porta se ce n'e' una: fra due server sulla stessa
    // macchina e' l'unica cosa che li distingue.
    const numerico = /^[0-9.]+$/.test(host) || host.includes(':') || !host.includes('.')
    if (numerico) return url.port ? `${host}:${url.port}` : host

    const pezzi = host.split('.')
    // `talk.casa.it` -> `casa`. Con due pezzi soli — `casa.it` — si tiene il
    // primo, che e' comunque la parte che distingue.
    if (pezzi.length >= 3) return pezzi[1]
    return pezzi[0] || host
  } catch {
    return indirizzo
  }
}

/** Lo stesso server, riconosciuto anche se scritto in un altro modo. */
export function stessoServer(a: string, b: string): boolean {
  return normalizzaIndirizzo(a).toLowerCase() === normalizzaIndirizzo(b).toLowerCase()
}

export function trovaServer(
  elenco: ServerCollegato[] | undefined,
  indirizzo: string | null
): ServerCollegato | null {
  if (!elenco || !indirizzo) return null
  return elenco.find((s) => stessoServer(s.indirizzo, indirizzo)) ?? null
}

/**
 * Aggiunge un server all'elenco, o aggiorna quello che c'e' gia'.
 *
 * Restituisce sempre un elenco nuovo: chi lo chiama lo salva, e nessuno si
 * ritrova con quello di prima modificato sotto ai piedi.
 */
export function collegaNellElenco(
  elenco: ServerCollegato[],
  dati: {
    indirizzo: string
    nome?: string | null
    utente?: string | null
    nomeVisibile?: string | null
  }
): ServerCollegato[] {
  const indirizzo = normalizzaIndirizzo(dati.indirizzo)
  if (!indirizzo) return elenco

  const gia = trovaServer(elenco, indirizzo)
  const aggiornato: ServerCollegato = {
    indirizzo,
    // Il nome scritto a mano vince su quello indovinato, e quello che c'era
    // vince sull'indovinato di adesso: rinominarlo e poi rientrare non deve
    // riportare il nome dell'host.
    nome: (dati.nome ?? gia?.nome ?? nomeDaIndirizzo(indirizzo)).slice(0, 40),
    utente: dati.utente ?? gia?.utente ?? null,
    nomeVisibile: dati.nomeVisibile ?? gia?.nomeVisibile ?? null,
    ultimoAccesso: Math.floor(Date.now() / 1000)
  }

  return gia
    ? elenco.map((s) => (stessoServer(s.indirizzo, indirizzo) ? aggiornato : s))
    : [...elenco, aggiornato]
}

export function scollegaDallElenco(
  elenco: ServerCollegato[],
  indirizzo: string
): ServerCollegato[] {
  return elenco.filter((s) => !stessoServer(s.indirizzo, indirizzo))
}

/**
 * Nomi utente da proporre quando quello che si voleva e' gia' preso di la'.
 *
 * Tre e non dieci: un elenco lungo e' una scelta da fare, e qui la scelta e'
 * gia' stata fatta — si voleva `marco`. Questi servono a scriverne uno vicino
 * senza pensarci, non a ricominciare da capo.
 */
export function nomiVicini(nome: string, indizio?: string | null): string[] {
  const base = String(nome ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
  if (!base) return []

  // Il luogo entra nella proposta solo se e' una parola: da `talk.casa.it`
  // esce `marco.casa`, che si legge e si ricorda. Da un indirizzo IP
  // uscirebbe `marco.1270018091`, che non e' un nome — e' un numero di targa.
  const pulito = String(indizio ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12)
  const luogo = /[a-z]/.test(pulito) ? pulito : ''

  const proposte = [luogo ? `${base}.${luogo}` : `${base}2`, `${base}${new Date().getFullYear() % 100}`, `${base}-1`]
  // Il nome utente vuole almeno tre caratteri e non piu' di trentadue: una
  // proposta che il server rifiuterebbe non e' una proposta.
  return [...new Set(proposte)].filter((p) => p.length >= 3 && p.length <= 32)
}
