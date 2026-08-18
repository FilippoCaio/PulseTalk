import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { IMPOSTAZIONI_INIZIALI, type Impostazioni } from '@shared/tipi'

/**
 * Impostazioni su disco, e il token tenuto a parte.
 *
 * Stessa scelta del Companion, per la stessa ragione: il token non finisce nel
 * json ma in un file suo, cifrato con `safeStorage`, che su Windows e' la DPAPI
 * dell'utente. Un file copiato via da un altro account non si apre.
 *
 * Qui pero' il token pesa di piu' che una chiave API: chi ce l'ha entra nelle
 * stanze e sente quello che si dicono gli altri. Se il sistema non offre la
 * cifratura preferiamo non salvarlo affatto e richiedere il codice di invito,
 * piuttosto che scriverlo in chiaro accanto all'eseguibile.
 */

const dir = app.getPath('userData')
const percorsoImpostazioni = join(dir, 'impostazioni.json')
const percorsoToken = join(dir, 'gettone.bin')

let cache: Impostazioni | null = null

function assicuraCartella(percorso: string): void {
  mkdirSync(dirname(percorso), { recursive: true })
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

  const unite: Impostazioni = { ...IMPOSTAZIONI_INIZIALI, ...salvate }
  unite.server = unite.server.replace(/\/+$/, '')
  unite.token = leggiToken()

  cache = unite
  return unite
}

export function scriviImpostazioni(modifiche: Partial<Impostazioni>): Impostazioni {
  const prossime: Impostazioni = { ...leggiImpostazioni(), ...modifiche }
  prossime.server = prossime.server.replace(/\/+$/, '')

  // Il token non passa da qui: ha una strada sua, cifrata. Scriverlo nel json
  // sarebbe il modo piu' semplice per vanificare tutto il resto.
  const { token: _ignorato, ...daSalvare } = prossime
  cache = prossime

  assicuraCartella(percorsoImpostazioni)
  writeFileSync(percorsoImpostazioni, JSON.stringify(daSalvare, null, 2), 'utf8')

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

export function scriviToken(token: string): { ok: boolean; errore?: string } {
  const pulito = token.trim()
  if (!pulito) return { ok: false, errore: 'Il token e\' vuoto.' }
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      ok: false,
      errore:
        'Windows non offre la cifratura in questo momento, e un token che apre le tue stanze in chiaro non lo scrivo. ' +
        'Riprova dopo aver rifatto l\'accesso: per questa sessione l\'app funziona lo stesso, ma alla prossima apertura ti richiedera\' il codice.'
    }
  }
  assicuraCartella(percorsoToken)
  writeFileSync(percorsoToken, safeStorage.encryptString(pulito))
  if (cache) cache.token = pulito
  return { ok: true }
}

export function dimenticaToken(): void {
  if (existsSync(percorsoToken)) rmSync(percorsoToken)
  if (cache) cache.token = null
}

function leggiToken(): string | null {
  if (!existsSync(percorsoToken)) return null
  try {
    return safeStorage.decryptString(readFileSync(percorsoToken))
  } catch {
    // Cifrato da un altro utente o da un'altra macchina: e' irrecuperabile, e
    // trattarlo come assente porta a reincollare il codice di invito invece
    // che a guardare un errore di decifratura che non dice niente.
    return null
  }
}
