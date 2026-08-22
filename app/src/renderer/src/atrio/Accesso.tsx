import { useState } from 'react'
import type { Impostazioni, Utente } from '@shared/tipi'
import { Api, ErroreApi } from '../lib/api'
import { ponte } from '../ponte'
import { Avviso, Bottone, Campo, classiInput } from '../ui'

/**
 * Entrare.
 *
 * Due strade, e la differenza sta tutta in quante volte le si percorre.
 *
 *   accedi     nome utente e password. E' quella di tutti i giorni, quindi e'
 *              quella che si vede per prima.
 *   registra   un codice di invito, una volta sola nella vita. Da li' escono
 *              le credenziali con cui si entrera' da qualunque dispositivo.
 *
 * L'indirizzo del server sta nascosto sotto a "Cambia server": chi riceve
 * questa app dal proprietario del NAS non deve sapere che esiste un indirizzo,
 * e chi ne ha uno suo lo trova al primo posto dove lo cercherebbe.
 */
type Modo = 'accedi' | 'registra'

export default function Accesso({
  impostazioni,
  salva,
  quandoEntra,
  motivo = null
}: {
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => Promise<Impostazioni>
  quandoEntra: (utente: Utente) => void
  /**
   * Perche' si e' finiti qui invece che dentro.
   *
   * Vuoto quando si apre l'applicazione senza aver mai fatto l'accesso. Pieno
   * quando una sessione che c'era non vale piu': senza questa riga, chi viene
   * buttato fuori da una revoca si ritrova davanti al modulo di accesso senza
   * sapere se ha sbagliato qualcosa lui.
   */
  motivo?: string | null
}): React.JSX.Element {
  // Un link di invito porta il codice nella query: `?invito=...`. Se c'e', si
  // parte gia' sul modulo di registrazione con il codice dentro — chi ha
  // ricevuto un link non deve capire che esistono due modi di entrare.
  const invitoDalLink =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('invito') : null

  const [modo, setModo] = useState<Modo>(invitoDalLink ? 'registra' : 'accedi')
  const [server, setServer] = useState(impostazioni.server)
  const [mostraServer, setMostraServer] = useState(!impostazioni.server)

  const [utente, setUtente] = useState(impostazioni.utenteRicordato ?? '')
  const [password, setPassword] = useState('')

  const [codice, setCodice] = useState(invitoDalLink ?? '')
  const [nome, setNome] = useState('')
  const [conferma, setConferma] = useState('')

  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [avvertenza, setAvvertenza] = useState<string | null>(null)

  const indirizzo = (grezzo: string): string => {
    const pulito = grezzo.trim().replace(/\/+$/, '')
    if (!pulito) return ''
    // Chi incolla "talk.casa.it" intende https, non un errore di analisi
    // dell'indirizzo. Restare rigidi qui non insegna niente a nessuno.
    return /^https?:\/\//.test(pulito) ? pulito : `https://${pulito}`
  }

  async function conservaEEntra(base: string, token: string, chi: Utente): Promise<void> {
    const { errore: avviso } = await ponte.scriviImpostazioni({ server: base, token })
    await salva({ server: base, nome: chi.nome, utenteRicordato: chi.utente })
    if (avviso) setAvvertenza(avviso)
    quandoEntra(chi)
  }

  const prova = async (): Promise<void> => {
    setErrore(null)
    setAvvertenza(null)

    const base = indirizzo(server)
    if (!base) {
      setMostraServer(true)
      return setErrore('Serve l\'indirizzo del server.')
    }

    if (modo === 'accedi') {
      if (!utente.trim() || !password) return setErrore('Servono nome utente e password.')
    } else {
      if (!codice.trim()) return setErrore('Serve il codice di invito.')
      if (!utente.trim()) return setErrore('Scegli un nome utente.')
      if (password !== conferma) return setErrore('Le due password non coincidono.')
    }

    setInCorso(true)
    try {
      const api = new Api(base, null)
      const esito =
        modo === 'accedi'
          ? await api.accedi(utente.trim(), password)
          : await api.riscatta({
              codice: codice.trim(),
              utente: utente.trim(),
              password,
              nome: nome.trim() || undefined
            })

      await conservaEEntra(base, esito.token, esito.utente)
    } catch (e) {
      const problema = e as ErroreApi
      setErrore(
        problema.stato === 403 && modo === 'registra'
          ? 'Il codice non e\' valido, o e\' gia\' stato usato. I codici valgono una volta sola: fattene dare un altro.'
          : problema.message
      )
    } finally {
      setInCorso(false)
    }
  }

  const alInvio = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !inCorso) void prova()
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PulseTalk</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-testo-2">
            {modo === 'accedi'
              ? 'Bentornato.'
              : 'Un codice di invito, e poi le credenziali sono tue.'}
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-bordo bg-fondo-2 p-5">
          {motivo && <Avviso tono="attenzione">{motivo}</Avviso>}

          {modo === 'registra' && (
            <Campo
              etichetta="Codice di invito"
              aiuto="Te lo da' chi amministra il server. Vale una volta sola."
            >
              <input
                className={classiInput}
                value={codice}
                onChange={(e) => setCodice(e.target.value)}
                onKeyDown={alInvio}
                placeholder="incolla qui"
                autoFocus
                spellCheck={false}
              />
            </Campo>
          )}

          <Campo
            etichetta="Nome utente"
            aiuto={
              modo === 'registra'
                ? 'Minuscolo, senza spazi. E\' quello con cui entrerai d\'ora in poi.'
                : undefined
            }
          >
            <input
              className={classiInput}
              value={utente}
              onChange={(e) => setUtente(e.target.value)}
              onKeyDown={alInvio}
              placeholder="marco"
              autoFocus={modo === 'accedi'}
              autoComplete="username"
              spellCheck={false}
            />
          </Campo>

          {modo === 'registra' && (
            <Campo
              etichetta="Nome visibile"
              aiuto="Come ti vedono gli altri. Facoltativo: senza, usa il nome utente."
            >
              <input
                className={classiInput}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={alInvio}
                placeholder="Marco Rossi"
              />
            </Campo>
          )}

          <Campo
            etichetta="Password"
            aiuto={modo === 'registra' ? 'Almeno 10 caratteri.' : undefined}
          >
            <input
              className={classiInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={alInvio}
              autoComplete={modo === 'accedi' ? 'current-password' : 'new-password'}
            />
          </Campo>

          {modo === 'registra' && (
            <Campo etichetta="Ripeti la password">
              <input
                className={classiInput}
                type="password"
                value={conferma}
                onChange={(e) => setConferma(e.target.value)}
                onKeyDown={alInvio}
                autoComplete="new-password"
              />
            </Campo>
          )}

          {mostraServer ? (
            <Campo etichetta="Server" aiuto="L'indirizzo del NAS che ospita le stanze.">
              <input
                className={classiInput}
                value={server}
                onChange={(e) => setServer(e.target.value)}
                onKeyDown={alInvio}
                placeholder="talk.casa.it"
                spellCheck={false}
              />
            </Campo>
          ) : (
            <button
              onClick={() => setMostraServer(true)}
              className="text-xs text-testo-3 underline underline-offset-2 hover:text-testo-2"
            >
              Server: {server || 'da scegliere'} — cambia
            </button>
          )}

          {errore && <Avviso>{errore}</Avviso>}
          {avvertenza && <Avviso tono="attenzione">{avvertenza}</Avviso>}

          <Bottone tono="vivo" className="w-full" disabled={inCorso} onClick={() => void prova()}>
            {inCorso ? 'un momento…' : modo === 'accedi' ? 'Entra' : 'Crea l\'account'}
          </Bottone>
        </div>

        <p className="mt-4 text-center text-sm text-testo-3">
          {modo === 'accedi' ? 'Hai un codice di invito?' : 'Hai gia\' un account?'}{' '}
          <button
            onClick={() => {
              setModo(modo === 'accedi' ? 'registra' : 'accedi')
              setErrore(null)
              setPassword('')
              setConferma('')
            }}
            className="text-vivo underline underline-offset-2 hover:text-vivo-2"
          >
            {modo === 'accedi' ? 'Crea un account' : 'Entra'}
          </button>
        </p>

        {!ponte.elettrone && (
          <p className="mt-6 text-center text-xs leading-relaxed text-testo-3">
            Stai usando la versione web. Funziona, ma l'app installata sa mandare anche l'audio di
            sistema insieme allo schermo, e tiene il token cifrato invece che nella memoria del
            browser.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Lo schermo per chi ha un account nato prima delle password.
 *
 * Non e' un caso ipotetico: sono gli utenti creati dalla prima versione, che
 * hanno un token che funziona e nient'altro. Buttarli fuori sarebbe scortese;
 * lasciarli senza credenziali significherebbe che il giorno che perdono il
 * token devono farsi rifare un invito.
 */
export function Completa({
  api,
  quandoFatto
}: {
  api: Api
  quandoFatto: (utente: Utente) => void
}): React.JSX.Element {
  const [utente, setUtente] = useState('')
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const prova = async (): Promise<void> => {
    setErrore(null)
    if (password !== conferma) return setErrore('Le due password non coincidono.')

    setInCorso(true)
    try {
      const { utente: aggiornato } = await api.completa(utente.trim(), password)
      quandoFatto(aggiornato)
    } catch (e) {
      setErrore((e as ErroreApi).message)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Scegli le tue credenziali</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-testo-2">
            Il tuo account e' nato prima che esistessero le password. Sceglile adesso: da qui in
            poi entrerai da qualunque dispositivo senza doverti far rifare un invito.
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-bordo bg-fondo-2 p-5">
          <Campo etichetta="Nome utente" aiuto="Minuscolo, senza spazi.">
            <input
              className={classiInput}
              value={utente}
              onChange={(e) => setUtente(e.target.value)}
              placeholder="filippo"
              autoFocus
              spellCheck={false}
            />
          </Campo>
          <Campo etichetta="Password" aiuto="Almeno 10 caratteri.">
            <input
              className={classiInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Campo>
          <Campo etichetta="Ripeti la password">
            <input
              className={classiInput}
              type="password"
              value={conferma}
              onChange={(e) => setConferma(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !inCorso && void prova()}
              autoComplete="new-password"
            />
          </Campo>

          {errore && <Avviso>{errore}</Avviso>}

          <Bottone tono="vivo" className="w-full" disabled={inCorso} onClick={() => void prova()}>
            {inCorso ? 'un momento…' : 'Salva'}
          </Bottone>
        </div>
      </div>
    </div>
  )
}
