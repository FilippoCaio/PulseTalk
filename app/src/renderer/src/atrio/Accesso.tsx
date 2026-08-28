import { useEffect, useState } from 'react'
import type { Impostazioni, Utente } from '@shared/tipi'
import { nomiVicini, nomeDaIndirizzo, normalizzaIndirizzo } from '@shared/collegamenti'
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
 *   registra   un codice di invito, una volta sola per server. Da li' escono
 *              le credenziali con cui si entrera' da qualunque dispositivo.
 *
 * L'indirizzo del server sta nascosto sotto a "Cambia server": chi riceve
 * questa app dal proprietario del NAS non deve sapere che esiste un indirizzo,
 * e chi ne ha uno suo lo trova al primo posto dove lo cercherebbe.
 */
type Modo = 'accedi' | 'registra'

/** Cosa esce da un accesso riuscito. */
export interface Entrata {
  indirizzo: string
  token: string
  utente: Utente
}

/**
 * Il modulo vero e proprio, senza la pagina intorno.
 *
 * Sta a parte perche' lo stesso modulo serve due volte: alla schermata di
 * accesso, che occupa tutta la finestra, e al pannello dei server, dove si
 * aggiunge un secondo server senza uscire da quello in cui si sta. Erano due
 * copie fino a ieri, e la seconda e' quella che sarebbe rimasta indietro.
 */
export function ModuloAccesso({
  serverIniziale,
  utenteIniziale,
  codiceIniziale = null,
  modoIniziale,
  motivo = null,
  bloccaServer = false,
  etichettaAzione,
  quandoCambiaModo,
  quandoEntra
}: {
  serverIniziale: string
  /** Il nome che si usa altrove: qui e' una proposta, non un obbligo. */
  utenteIniziale: string | null
  codiceIniziale?: string | null
  modoIniziale?: Modo
  motivo?: string | null
  /** Vero dove l'indirizzo non si tocca: il modulo dentro a un server gia' scelto. */
  bloccaServer?: boolean
  etichettaAzione?: { accedi: string; registra: string }
  /** Per chi disegna la frase in cima, che cambia con la strada scelta. */
  quandoCambiaModo?: (modo: Modo) => void
  quandoEntra: (entrata: Entrata) => Promise<void> | void
}): React.JSX.Element {
  const [modo, setModo] = useState<Modo>(modoIniziale ?? (codiceIniziale ? 'registra' : 'accedi'))
  const [server, setServer] = useState(serverIniziale)
  const [mostraServer, setMostraServer] = useState(!bloccaServer && !serverIniziale)

  const [utente, setUtente] = useState(utenteIniziale ?? '')
  const [password, setPassword] = useState('')

  const [codice, setCodice] = useState(codiceIniziale ?? '')
  const [nome, setNome] = useState('')
  const [conferma, setConferma] = useState('')

  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [recupero, setRecupero] = useState(false)
  const [conCodice, setConCodice] = useState(false)

  /**
   * Se il nome scelto e' gia' di qualcun altro **su questo server**.
   *
   * E' la cosa che rende sopportabile avere piu' server: il nome con cui si
   * entra e' una faccenda del singolo server, e due server che non si
   * conoscono possono benissimo avere due `marco` diversi. Si chiede appena
   * c'e' un codice e un nome, invece di scoprirlo da un 409 dopo aver scelto
   * la password — che era il modo peggiore, perche' costringe a rifare tutto
   * il modulo per cambiare una parola.
   */
  const [preso, setPreso] = useState<{ nome: string; proposte: string[] } | null>(null)

  useEffect(() => {
    if (modo !== 'registra') return setPreso(null)
    const base = normalizzaIndirizzo(server)
    const scelto = utente.trim().toLowerCase()
    if (!base || !codice.trim() || scelto.length < 3) return setPreso(null)

    let vivo = true
    // Mezzo secondo di silenzio prima di chiedere: senza, si manderebbe una
    // richiesta per ogni lettera digitata.
    const attesa = window.setTimeout(() => {
      void new Api(base, null)
        .nomeLibero(codice.trim(), scelto)
        .then(({ libero }) => {
          if (!vivo) return
          setPreso(
            libero ? null : { nome: scelto, proposte: nomiVicini(scelto, nomeDaIndirizzo(base)) }
          )
        })
        .catch(() => {
          // Il codice non vale, o il server e' rimasto indietro e la rotta non
          // ce l'ha: in entrambi i casi non si sa niente, e non sapere niente
          // si dice non dicendo niente. Il riscatto poi rispondera' comunque.
          if (vivo) setPreso(null)
        })
    }, 500)

    return () => {
      vivo = false
      window.clearTimeout(attesa)
    }
  }, [modo, server, codice, utente])

  const prova = async (): Promise<void> => {
    setErrore(null)

    const base = normalizzaIndirizzo(server)
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

      await quandoEntra({ indirizzo: base, token: esito.token, utente: esito.utente })
    } catch (e) {
      const problema = e as ErroreApi

      // 409 sul riscatto vuol dire una cosa sola: il nome e' gia' di qualcuno
      // qui. Non e' un errore da leggere e basta — e' una domanda, e la si fa
      // con le proposte accanto invece di lasciare il campo com'e'.
      if (problema.stato === 409 && modo === 'registra') {
        const scelto = utente.trim().toLowerCase()
        setPreso({ nome: scelto, proposte: nomiVicini(scelto, nomeDaIndirizzo(base)) })
        setErrore(null)
      } else {
        setErrore(
          problema.stato === 403 && modo === 'registra'
            ? 'Il codice non e\' valido, o e\' gia\' stato usato. I codici valgono una volta sola: fattene dare un altro.'
            : problema.message
        )
      }
    } finally {
      setInCorso(false)
    }
  }

  const alInvio = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !inCorso) void prova()
  }

  const azione =
    etichettaAzione ?? { accedi: 'Entra', registra: 'Crea l\'account' }
  const nomePreso = preso?.nome === utente.trim().toLowerCase() ? preso : null

  if (recupero) {
    return <Recupero server={server} indietro={() => setRecupero(false)} />
  }

  if (conCodice) {
    return (
      <ConCodice
        server={server}
        indietro={() => setConCodice(false)}
        quandoEntra={quandoEntra}
      />
    )
  }

  return (
    <>
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
              ? 'Minuscolo, senza spazi. E\' quello con cui entrerai qui d\'ora in poi.'
              : undefined
          }
        >
          <input
            className={`${classiInput} ${nomePreso ? 'border-attenzione focus:border-attenzione' : ''}`}
            value={utente}
            onChange={(e) => setUtente(e.target.value)}
            onKeyDown={alInvio}
            placeholder="marco"
            autoFocus={modo === 'accedi'}
            autoComplete="username"
            spellCheck={false}
          />
        </Campo>

        {nomePreso && (
          <div className="riga-comparsa space-y-2 rounded-lg border border-attenzione/40 bg-attenzione/10 p-3">
            <p className="text-sm leading-relaxed text-attenzione">
              Su questo server <strong>{nomePreso.nome}</strong> e' gia' di qualcun altro. Non e'
              un problema del tuo account: ogni server ha il suo elenco di nomi, e qui questo e'
              occupato. Scegline un altro — resta il tuo solo per questo server.
            </p>
            {nomePreso.proposte.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {nomePreso.proposte.map((proposta) => (
                  <button
                    key={proposta}
                    type="button"
                    onClick={() => {
                      setUtente(proposta)
                      setPreso(null)
                    }}
                    className="rounded-lg border border-bordo bg-fondo px-2.5 py-1 text-xs text-testo-2 transition-colors hover:border-vivo hover:text-vivo"
                  >
                    {proposta}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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

        <Campo etichetta="Password" aiuto={modo === 'registra' ? 'Almeno 10 caratteri.' : undefined}>
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

        {!bloccaServer &&
          (mostraServer ? (
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
          ))}

        {errore && <Avviso>{errore}</Avviso>}

        <Bottone
          tono="vivo"
          className="w-full"
          disabled={inCorso || !!nomePreso}
          onClick={() => void prova()}
        >
          {inCorso ? 'un momento…' : modo === 'accedi' ? azione.accedi : azione.registra}
        </Bottone>

        {/* Solo entrando: in registrazione una password da dimenticare non
            c'e' ancora, e l'offerta sarebbe una porta che non va da nessuna
            parte. */}
        {modo === 'accedi' && (
          <button
            onClick={() => {
              setErrore(null)
              setRecupero(true)
            }}
            className="w-full text-center text-xs text-testo-3 underline underline-offset-2 hover:text-testo-2"
          >
            Ho dimenticato la password
          </button>
        )}

        {modo === 'accedi' && (
          <button
            onClick={() => {
              setErrore(null)
              setConCodice(true)
            }}
            className="w-full text-center text-xs text-testo-3 underline underline-offset-2 hover:text-testo-2"
          >
            Ho un codice da un altro dispositivo
          </button>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-testo-3">
        {modo === 'accedi' ? 'Hai un codice di invito?' : 'Hai gia\' un account qui?'}{' '}
        <button
          onClick={() => {
            const prossimo = modo === 'accedi' ? 'registra' : 'accedi'
            setModo(prossimo)
            quandoCambiaModo?.(prossimo)
            setErrore(null)
            setPreso(null)
            setPassword('')
            setConferma('')
          }}
          className="text-vivo underline underline-offset-2 hover:text-vivo-2"
        >
          {modo === 'accedi' ? 'Crea un account' : 'Entra'}
        </button>
      </p>
    </>
  )
}

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

  const [avvertenza, setAvvertenza] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>(invitoDalLink ? 'registra' : 'accedi')

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4 sm:p-8">
      <div className="pannello w-full max-w-md py-4 sm:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PulseTalk</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-testo-2">
            {modo === 'accedi' ? 'Bentornato.' : 'Un codice di invito, e poi le credenziali sono tue.'}
          </p>
        </div>

        <ModuloAccesso
          modoIniziale={modo}
          quandoCambiaModo={setModo}
          serverIniziale={impostazioni.server}
          utenteIniziale={impostazioni.utenteRicordato}
          codiceIniziale={invitoDalLink}
          motivo={motivo}
          quandoEntra={async ({ indirizzo, token, utente }) => {
            // Il server entra nell'elenco dei collegati e diventa quello
            // attivo, con il suo token accanto. Una chiamata sola: separarla
            // in due vorrebbe dire un istante in cui il token appena ottenuto
            // sta sotto l'indirizzo di un altro server.
            const { errore: avviso } = await ponte.collegaServer({
              indirizzo,
              token,
              utente: utente.utente,
              nomeVisibile: utente.nome
            })
            await salva({ nome: utente.nome, utenteRicordato: utente.utente })
            if (avviso) setAvvertenza(avviso)
            quandoEntra(utente)
          }}
        />

        {avvertenza && (
          <div className="mt-4">
            <Avviso tono="attenzione">{avvertenza}</Avviso>
          </div>
        )}

        {!ponte.elettrone && !ponte.android && (
          <p className="mt-6 text-center text-xs leading-relaxed text-testo-3">
            Stai usando la versione web. Funziona, ma l'app installata sa mandare anche l'audio di
            sistema insieme allo schermo, e tiene il token cifrato invece che nella memoria del
            browser.
          </p>
        )}
        {ponte.android && (
          <p className="mt-6 text-center text-xs leading-relaxed text-testo-3">
            App Android. Microfono, camera, messaggi e chiamate usano direttamente il tuo server
            PulseTalk.
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
      <div className="pannello w-full max-w-md">
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

/**
 * Rientrare avendo dimenticato la password.
 *
 * Due passi, e il secondo non arriva mai da solo: si chiede il codice a una
 * casella, e chi la apre lo riporta qui dentro. E' la stessa idea dell'invito
 * — dimostrare di possedere qualcosa invece di sapere qualcosa — con la
 * differenza che qui la cosa da possedere l'ha dichiarata l'interessato.
 *
 * LA RISPOSTA E' SEMPRE LA STESSA, anche per un indirizzo che qui dentro non
 * esiste, e la schermata deve dire la stessa cosa: "se quell'indirizzo e'
 * collegato a un account, il codice e' partito". Scrivere "indirizzo non
 * trovato" renderebbe questo modulo il modo piu' comodo per sapere chi
 * frequenta il server, e vanificherebbe la cautela che sta nella rotta.
 *
 * NON SI ENTRA DA QUI. Finito, si torna al modulo di accesso e si entra con la
 * password appena scelta: e' un passaggio in piu' e serve, perche' e' il
 * momento in cui si scopre di averla scritta come si credeva — mentre la si
 * ha ancora in mente, invece che alla prossima apertura.
 */
function Recupero({
  server,
  indietro
}: {
  server: string
  indietro: () => void
}): React.JSX.Element {
  const [passo, setPasso] = useState<'chiedo' | 'riscatto' | 'fatto'>('chiedo')
  const [indirizzo, setIndirizzo] = useState('')
  const [codice, setCodice] = useState('')
  const [password, setPassword] = useState('')
  const [conferma, setConferma] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const api = (): Api => new Api(normalizzaIndirizzo(server) ?? '', null)

  const chiedi = async (): Promise<void> => {
    setErrore(null)
    if (!indirizzo.trim()) return setErrore('Serve l\'indirizzo di posta.')
    setInCorso(true)
    try {
      await api().chiediRecupero(indirizzo.trim())
      setPasso('riscatto')
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  const riscatta = async (): Promise<void> => {
    setErrore(null)
    if (password !== conferma) return setErrore('Le due password non coincidono.')
    setInCorso(true)
    try {
      await api().riscattaRecupero(indirizzo.trim(), codice.trim(), password)
      setPasso('fatto')
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        {passo === 'chiedo' && (
          <>
            <p className="text-sm text-testo-2">
              Scrivi l&apos;indirizzo di posta collegato al tuo account: ti arriva un codice per
              sceglierne una nuova.
            </p>
            <Campo etichetta="Indirizzo di posta">
              <input
                className={classiInput}
                type="email"
                value={indirizzo}
                onChange={(e) => setIndirizzo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !inCorso && void chiedi()}
                autoComplete="email"
                autoFocus
              />
            </Campo>
            {errore && <Avviso>{errore}</Avviso>}
            <Bottone tono="vivo" className="w-full" disabled={inCorso} onClick={() => void chiedi()}>
              {inCorso ? 'un momento…' : 'Mandami il codice'}
            </Bottone>
          </>
        )}

        {passo === 'riscatto' && (
          <>
            {/* Il condizionale non e' timidezza: e' la stessa frase che il
                server dice a chiunque, ed e' cio' che impedisce di usare
                questo modulo per scoprire chi ha un account qui. */}
            <Avviso tono="neutro">
              Se {indirizzo.trim()} e&apos; collegato a un account, il codice e&apos; partito. Vale
              un quarto d&apos;ora.
            </Avviso>
            <Campo etichetta="Il codice" aiuto="Sei caratteri, dalla mail.">
              <input
                className={`${classiInput} numeri tracking-[0.3em] uppercase`}
                value={codice}
                maxLength={6}
                onChange={(e) => setCodice(e.target.value.toUpperCase())}
                autoFocus
              />
            </Campo>
            <Campo etichetta="Nuova password" aiuto="Almeno 10 caratteri.">
              <input
                className={classiInput}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Campo>
            <Campo etichetta="Ripeti la nuova password">
              <input
                className={classiInput}
                type="password"
                value={conferma}
                onChange={(e) => setConferma(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !inCorso && void riscatta()}
                autoComplete="new-password"
              />
            </Campo>
            {errore && <Avviso>{errore}</Avviso>}
            <Bottone
              tono="vivo"
              className="w-full"
              disabled={inCorso}
              onClick={() => void riscatta()}
            >
              {inCorso ? 'un momento…' : 'Rimetti la password'}
            </Bottone>
          </>
        )}

        {passo === 'fatto' && (
          <>
            <Avviso tono="neutro">
              Fatto. Sono state chiuse tutte le sessioni aperte con questo account, anche sugli
              altri dispositivi.
            </Avviso>
            <Bottone tono="vivo" className="w-full" onClick={indietro}>
              Entra con la password nuova
            </Bottone>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-testo-3">
        <button
          onClick={indietro}
          className="text-vivo underline underline-offset-2 hover:text-vivo-2"
        >
          Torna indietro
        </button>
      </p>
    </>
  )
}

/**
 * Entrare con un codice letto su un dispositivo dove si e' gia' dentro.
 *
 * E' la strada per il telefono, e la ragione per cui esiste e' che la password
 * su una tastiera di vetro e' un supplizio — che e' anche il motivo per cui le
 * password scelte sui telefoni sono corte. Qui non ne passa nessuna: il codice
 * vive due minuti, vale una volta, e vale come credenziale.
 *
 * Nessun campo per il nome utente, di proposito: il codice dice gia' di chi e'.
 * Chiederlo comunque sembrerebbe piu' sicuro e non lo sarebbe — sarebbe solo
 * un secondo modo di sbagliare.
 */
function ConCodice({
  server,
  indietro,
  quandoEntra
}: {
  server: string
  indietro: () => void
  quandoEntra: (entrata: Entrata) => Promise<void> | void
}): React.JSX.Element {
  const [codice, setCodice] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const entra = async (): Promise<void> => {
    setErrore(null)
    const base = normalizzaIndirizzo(server)
    if (!base) return setErrore('Serve l\'indirizzo del server.')

    setInCorso(true)
    try {
      const esito = await new Api(base, null).collegaConCodice(codice.trim())
      await quandoEntra({ indirizzo: base, token: esito.token, utente: esito.utente })
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-testo-2">
          Su un dispositivo dove sei gia&apos; dentro apri{' '}
          <span className="text-testo">Impostazioni → Account → Collega un dispositivo</span> e
          scrivi qui il codice che compare.
        </p>

        <Campo etichetta="Il codice" aiuto="Otto caratteri. Vale due minuti.">
          <input
            className={`${classiInput} numeri text-center text-lg tracking-[0.3em] uppercase`}
            value={codice}
            maxLength={8}
            onChange={(e) => setCodice(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && !inCorso && void entra()}
            autoFocus
            spellCheck={false}
          />
        </Campo>

        {errore && <Avviso>{errore}</Avviso>}

        <Bottone tono="vivo" className="w-full" disabled={inCorso} onClick={() => void entra()}>
          {inCorso ? 'un momento…' : 'Entra'}
        </Bottone>
      </div>

      <p className="mt-4 text-center text-sm text-testo-3">
        <button
          onClick={indietro}
          className="text-vivo underline underline-offset-2 hover:text-vivo-2"
        >
          Torna indietro
        </button>
      </p>
    </>
  )
}
