import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IMPOSTAZIONI_INIZIALI, type Impostazioni } from '@shared/tipi'
import {
  collegaNellElenco,
  nomeDaIndirizzo,
  normalizzaIndirizzo,
  scollegaDallElenco,
  stessoServer,
  trovaServer,
  type ServerCollegato
} from '@shared/collegamenti'

/**
 * Impostazioni su disco, e i token tenuti a parte.
 *
 * Stessa scelta del Companion, per la stessa ragione: i token non finiscono nel
 * json ma in un file loro, cifrato con `safeStorage`, che su Windows e' la DPAPI
 * dell'utente. Un file copiato via da un altro account non si apre.
 *
 * Qui pero' un token pesa di piu' che una chiave API: chi ce l'ha entra nelle
 * stanze e sente quello che si dicono gli altri. Se il sistema non offre la
 * cifratura preferiamo non salvarlo affatto e richiedere il codice di invito,
 * piuttosto che scriverlo in chiaro accanto all'eseguibile.
 *
 * ## Uno per server
 *
 * Da quando ci si puo' collegare a piu' server — il NAS di casa e quello
 * dell'ufficio insieme — i token sono tanti quanti gli indirizzi, e stanno in
 * un file solo: un oggetto `{ indirizzo: token }` cifrato tutto insieme.
 * Cifrarli in file separati non avrebbe aggiunto niente — la chiave e' la
 * stessa, quella dell'utente di Windows — e avrebbe aggiunto un nome di file
 * da inventare per ogni indirizzo, cioe' un modo in piu' di sbagliare.
 *
 * Il file vecchio con il token unico si legge ancora, una volta, per non
 * chiedere di nuovo la password a chi aggiorna: quello che c'era dentro
 * diventa il token del server che era gia' configurato.
 */

const dir = app.getPath('userData')
const percorsoImpostazioni = join(dir, 'impostazioni.json')
/** Il file di prima: un token solo, e nessun indirizzo accanto. */
const percorsoTokenVecchio = join(dir, 'gettone.bin')
const percorsoGettoni = join(dir, 'gettoni.bin')

let cache: Impostazioni | null = null
/** indirizzo normalizzato -> token. Vive in memoria quanto l'applicazione. */
let gettoni: Record<string, string> | null = null

function assicuraCartella(percorso: string): void {
  mkdirSync(dirname(percorso), { recursive: true })
}

// -- I token ------------------------------------------------------------------

function leggiGettoni(): Record<string, string> {
  if (gettoni) return gettoni

  gettoni = {}
  if (existsSync(percorsoGettoni)) {
    try {
      const letto = JSON.parse(safeStorage.decryptString(readFileSync(percorsoGettoni)))
      if (letto && typeof letto === 'object') gettoni = letto as Record<string, string>
    } catch {
      // Cifrato da un altro utente o da un'altra macchina: e' irrecuperabile, e
      // trattarlo come assente porta a rifare l'accesso invece che a guardare
      // un errore di decifratura che non dice niente.
    }
  }
  return gettoni
}

function scriviGettoni(): { ok: boolean; errore?: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      errore:
        'Windows non offre la cifratura in questo momento, e un token che apre le tue stanze in chiaro non lo scrivo. ' +
        'Riprova dopo aver rifatto l\'accesso: per questa sessione l\'app funziona lo stesso, ma alla prossima apertura ti richiedera\' il codice.'
    }
  }
  assicuraCartella(percorsoGettoni)
  writeFileSync(percorsoGettoni, safeStorage.encryptString(JSON.stringify(leggiGettoni())))
  return { ok: true }
}

/**
 * Il token del server di prima, portato dentro al nuovo file.
 *
 * Si fa una volta e si cancella il file vecchio: lasciarlo li' vorrebbe dire
 * un token valido in un posto che nessuno rilegge piu', cioe' un segreto che
 * resta sul disco senza che nessuno sappia perche'.
 */
function migraTokenUnico(indirizzo: string): void {
  if (!existsSync(percorsoTokenVecchio)) return
  try {
    const vecchio = safeStorage.decryptString(readFileSync(percorsoTokenVecchio))
    if (vecchio && indirizzo) {
      leggiGettoni()[indirizzo] = vecchio
      scriviGettoni()
    }
  } catch {
    // Illeggibile: non c'e' niente da salvare, e il file va via lo stesso.
  }
  try {
    rmSync(percorsoTokenVecchio)
  } catch {
    // Se non si riesce a cancellarlo pazienza: la migrazione e' idempotente e
    // il prossimo giro riscriverebbe lo stesso valore.
  }
}

// -- Le impostazioni ----------------------------------------------------------

/**
 * Rimette in fila elenco, server attivo e token.
 *
 * E' l'unico posto che decide quale server e' quello attivo, e lo fa da una
 * regola sola: se `serverAttivo` punta a qualcosa che sta nell'elenco vale
 * quello, altrimenti vale il primo dell'elenco, altrimenti non ce n'e' nessuno.
 *
 * `semina` e' l'eccezione, e vale una volta sola nella vita di
 * un'installazione: chi aggiorna da una versione che l'elenco non ce l'aveva
 * ha un indirizzo scritto in `server` e nient'altro, e quell'indirizzo deve
 * diventare la prima voce. La distinzione fra "non ho mai avuto un elenco" e
 * "avevo un elenco e l'ho svuotato" non e' pedanteria: senza, scollegando
 * l'ultimo server lo si vedrebbe ricomparire da solo un istante dopo.
 */
function riallinea(base: Impostazioni, { semina = false } = {}): Impostazioni {
  const elenco: ServerCollegato[] = Array.isArray(base.serverCollegati)
    ? base.serverCollegati.filter((s) => s && typeof s.indirizzo === 'string' && s.indirizzo)
    : []

  const primo = normalizzaIndirizzo(base.server ?? '')
  if (semina && primo && elenco.length === 0) {
    elenco.push({
      indirizzo: primo,
      nome: nomeDaIndirizzo(primo),
      utente: base.utenteRicordato ?? null,
      nomeVisibile: base.nome ?? null,
      ultimoAccesso: Math.floor(Date.now() / 1000)
    })
    migraTokenUnico(primo)
  }

  const attivo =
    trovaServer(elenco, base.serverAttivo ?? null) ?? trovaServer(elenco, primo) ?? elenco[0] ?? null

  return {
    ...base,
    serverCollegati: elenco,
    serverAttivo: attivo?.indirizzo ?? null,
    // Senza nessun server collegato l'indirizzo e' vuoto, e non l'ultimo che
    // c'era: e' cio' che fa comparire il campo dell'indirizzo all'accesso,
    // invece di riproporre un server che si e' appena tolto.
    server: attivo?.indirizzo ?? '',
    token: attivo ? (leggiGettoni()[attivo.indirizzo] ?? null) : null
  }
}

export function leggiImpostazioni(): Impostazioni {
  if (cache) return cache

  let salvate: Partial<Impostazioni> = {}
  try {
    if (existsSync(percorsoImpostazioni)) {
      salvate = JSON.parse(readFileSync(percorsoImpostazioni, 'utf8'))
    }
  } catch {
    // Un file rotto non deve impedire l'avvio: si riparte dai valori di serie
    // e il primo salvataggio lo riscrive sano.
  }

  // Si semina solo se sul disco l'elenco non c'era proprio: e' il segno di
  // un'installazione che viene da prima che i server fossero piu' d'uno.
  cache = riallinea(
    { ...IMPOSTAZIONI_INIZIALI, ...salvate },
    { semina: !Array.isArray(salvate.serverCollegati) }
  )
  return cache
}

function salvaSuDisco(prossime: Impostazioni): void {
  // I token non passano da qui: hanno una strada loro, cifrata. Scriverli nel
  // json sarebbe il modo piu' semplice per vanificare tutto il resto.
  const { token: _ignorato, ...daSalvare } = prossime
  assicuraCartella(percorsoImpostazioni)
  writeFileSync(percorsoImpostazioni, JSON.stringify(daSalvare, null, 2), 'utf8')
}

export function scriviImpostazioni(modifiche: Partial<Impostazioni>): Impostazioni {
  const prossime = riallinea({ ...leggiImpostazioni(), ...modifiche })

  // Il nome utente e il nome visibile si tengono anche accanto al server a cui
  // appartengono: sono cose di quel server, e tornando dall'ufficio a casa
  // devono tornare quelle di casa.
  const attivo = prossime.serverAttivo
  if (attivo && (modifiche.utenteRicordato !== undefined || modifiche.nome !== undefined)) {
    prossime.serverCollegati = prossime.serverCollegati.map((s) =>
      stessoServer(s.indirizzo, attivo)
        ? {
            ...s,
            utente: modifiche.utenteRicordato !== undefined ? modifiche.utenteRicordato : s.utente,
            nomeVisibile: modifiche.nome !== undefined ? modifiche.nome : s.nomeVisibile
          }
        : s
    )
  }

  cache = prossime
  salvaSuDisco(prossime)

  // L'avvio automatico non e' una nostra impostazione: e' una voce del
  // registro di Windows, e va tenuta allineata a mano.
  if (modifiche.avvioAutomatico !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: prossime.avvioAutomatico,
      // Non `--hidden`: chi accende questa opzione vuole trovarsi la finestra
      // aperta, non un'icona nella barra da andare a cercare.
      args: []
    })
  }

  return prossime
}

// -- I server collegati -------------------------------------------------------

/**
 * Aggiunge un server (o aggiorna quello che c'e') e ci passa sopra.
 *
 * Il token arriva da chi ha appena fatto l'accesso: e' l'unico momento in cui
 * lo si ha in mano, e riceverlo qui invece che da `scriviImpostazioni` evita
 * il caso storto in cui il token di un server finisce sotto l'indirizzo di un
 * altro perche' le due modifiche sono arrivate in due chiamate diverse.
 */
export function collegaServer(dati: {
  indirizzo: string
  token?: string | null
  nome?: string | null
  utente?: string | null
  nomeVisibile?: string | null
}): { impostazioni: Impostazioni; errore?: string } {
  const indirizzo = normalizzaIndirizzo(dati.indirizzo)
  if (!indirizzo) {
    return { impostazioni: leggiImpostazioni(), errore: 'Serve l\'indirizzo del server.' }
  }

  let errore: string | undefined
  if (dati.token !== undefined) {
    if (dati.token === null) delete leggiGettoni()[indirizzo]
    else leggiGettoni()[indirizzo] = dati.token
    const esito = scriviGettoni()
    if (!esito.ok) errore = esito.errore
  }

  const attuali = leggiImpostazioni()
  const impostazioni = scriviImpostazioni({
    serverCollegati: collegaNellElenco(attuali.serverCollegati, {
      indirizzo,
      nome: dati.nome ?? null,
      utente: dati.utente ?? null,
      nomeVisibile: dati.nomeVisibile ?? null
    }),
    serverAttivo: indirizzo,
    // Anche fuori dall'elenco, perche' e' li' che guarda il resto dell'app.
    utenteRicordato: dati.utente ?? attuali.utenteRicordato,
    nome: dati.nomeVisibile ?? attuali.nome
  })

  return { impostazioni, errore }
}

/** Passa a un server gia' collegato. Il token e' quello suo, se c'e' ancora. */
export function passaAServer(indirizzo: string): Impostazioni {
  const attuali = leggiImpostazioni()
  const quale = trovaServer(attuali.serverCollegati, indirizzo)
  if (!quale) return attuali

  return scriviImpostazioni({
    serverAttivo: quale.indirizzo,
    // Il nome utente ricordato segue il server: al modulo di accesso deve
    // comparire quello di la', non quello di dove si era prima.
    utenteRicordato: quale.utente ?? null,
    nome: quale.nomeVisibile ?? null
  })
}

/** Toglie un server dall'elenco, e con lui il suo token. */
export function scollegaServer(indirizzo: string): Impostazioni {
  const attuali = leggiImpostazioni()
  const normale = normalizzaIndirizzo(indirizzo)

  delete leggiGettoni()[normale]
  scriviGettoni()

  const elenco = scollegaDallElenco(attuali.serverCollegati, normale)
  const attivo = stessoServer(attuali.serverAttivo ?? '', normale)
    ? (elenco[0]?.indirizzo ?? null)
    : attuali.serverAttivo

  return scriviImpostazioni({
    serverCollegati: elenco,
    serverAttivo: attivo,
    utenteRicordato: trovaServer(elenco, attivo)?.utente ?? null,
    nome: trovaServer(elenco, attivo)?.nomeVisibile ?? null
  })
}

// -- Il token del server attivo ----------------------------------------------

export function scriviToken(token: string): { ok: boolean; errore?: string } {
  const pulito = token.trim()
  if (!pulito) return { ok: false, errore: 'Il token e\' vuoto.' }

  const attivo = leggiImpostazioni().serverAttivo
  if (!attivo) return { ok: false, errore: 'Non c\'e\' nessun server a cui legare questo accesso.' }

  leggiGettoni()[attivo] = pulito
  const esito = scriviGettoni()
  if (esito.ok && cache) cache = { ...cache, token: pulito }
  return esito
}

export function dimenticaToken(): void {
  const attivo = leggiImpostazioni().serverAttivo
  if (attivo) delete leggiGettoni()[attivo]
  scriviGettoni()
  if (cache) cache = { ...cache, token: null }
}
