import { useState } from 'react'
import type { Impostazioni, ServerCollegato } from '@shared/tipi'
import { nomeDaIndirizzo, stessoServer, trovaServer } from '@shared/collegamenti'
import { ponte } from '../ponte'
import { Avviso, Bottone, Campo, BottoneIcona, Conferma, classiInput } from '../ui'
import { Chiudi, Macchina, Matita, Piu, Spunta } from '../icone'
import { ModuloAccesso } from './Accesso'
import { provaServer } from '../lib/api'

/**
 * I server veri, e il passaggio dall'uno all'altro.
 *
 * "Server" qui vuol dire la macchina: il NAS di casa, quella dell'ufficio.
 * Sono installazioni separate fino in fondo — database, account, inviti,
 * chiamate — e l'unica cosa che condividono e' questa applicazione. Gli
 * **spazi** (quelli che Discord chiama server) stanno dentro a una di queste
 * macchine, e la barra a sinistra e' la loro.
 *
 * Il punto di tutto e' che non si esce per entrare: le credenziali di ogni
 * server restano salvate accanto al suo indirizzo, e passare dal NAS di casa a
 * quello dell'ufficio e' un clic, non un accesso da rifare. La chiamata in
 * corso pero' si lascia — e' un canale di quella macchina, e non c'e' nessun
 * modo di portarsela dietro.
 */

/** Il quadratino in cima alla barra: dice dove si e', e apre l'elenco. */
export function BottoneServer({
  impostazioni,
  apri,
  className = ''
}: {
  impostazioni: Impostazioni
  apri: () => void
  className?: string
}): React.JSX.Element {
  const attivo = trovaServer(impostazioni.serverCollegati, impostazioni.serverAttivo)
  const nome = attivo?.nome ?? nomeDaIndirizzo(impostazioni.server)
  const quanti = impostazioni.serverCollegati.length

  return (
    <button
      onClick={apri}
      title={`${nome} — cambia server`}
      aria-label={`Server: ${nome}. Cambia server.`}
      className={`group relative flex h-9 w-12 shrink-0 items-center justify-center rounded-xl border border-bordo bg-fondo-2 text-testo-2 transition-all hover:border-vivo hover:text-vivo ${className}`}
    >
      {/* Lo stack di server, e non piu' due lettere ricavate dal nome.
          Le iniziali sembravano scelte a caso perche' in un certo senso lo
          erano: «TA» per talk.madebyfil.it non e' il nome di niente, e' il
          taglio di una stringa. Il disegno invece dice cos'e' quel quadratino
          — una macchina — che e' l'unica cosa che serve sapere guardandolo,
          visto che il nome per esteso ce l'ha gia' nel cartellino. */}
      <Macchina className="h-[18px] w-[18px]" />
      {/* Il pallino compare solo quando i server sono piu' d'uno: con uno solo
          direbbe "ce n'e' uno", che non e' una notizia. */}
      {quanti > 1 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-fondo-3 px-1 text-[9px] text-testo-3 group-hover:text-vivo">
          {quanti}
        </span>
      )}
    </button>
  )
}

export default function PannelloServer({
  impostazioni,
  chiudi,
  cambiaServer,
  scollega
}: {
  impostazioni: Impostazioni
  chiudi: () => void
  /** Passa a un server gia' collegato: chi chiama sa cosa smontare prima. */
  cambiaServer: (indirizzo: string) => Promise<void>
  scollega: (indirizzo: string) => Promise<void>
}): React.JSX.Element {
  const [aggiungendo, setAggiungendo] = useState(false)
  const [rinominando, setRinominando] = useState<ServerCollegato | null>(null)
  const [nuovoNome, setNuovoNome] = useState('')
  const [daScollegare, setDaScollegare] = useState<ServerCollegato | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const elenco = [...impostazioni.serverCollegati].sort((a, b) => b.ultimoAccesso - a.ultimoAccesso)

  /**
   * Cambiare l'etichetta, e nient'altro.
   *
   * Passa da `scriviImpostazioni` e non da `collegaServer` per una ragione
   * sola: `collegaServer` fa diventare attivo il server che tocca, ed e' cio'
   * che si vuole facendo un accesso — ma rinominando il NAS di casa mentre si
   * sta in ufficio significherebbe ritrovarsi a casa. Qui si riscrive
   * l'elenco e basta: il server attivo non e' fra i campi toccati, quindi
   * resta quello.
   */
  const rinomina = async (): Promise<void> => {
    if (!rinominando) return
    const nome = nuovoNome.trim()
    if (!nome) return
    await ponte.scriviImpostazioni({
      serverCollegati: impostazioni.serverCollegati.map((s) =>
        stessoServer(s.indirizzo, rinominando.indirizzo) ? { ...s, nome: nome.slice(0, 40) } : s
      )
    })
    setRinominando(null)
  }

  return (
    <div
      className="velo absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={chiudi}
    >
      <div
        className="pannello flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-bordo p-5">
          <span className="mt-0.5 text-vivo">
            <Macchina />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Server</h2>
            <p className="mt-1 text-sm leading-relaxed text-testo-2">
              Le macchine a cui sei collegato. Ognuna ha i suoi account, i suoi spazi e le sue
              chiamate: qui si sceglie in quale stare adesso.
            </p>
          </div>
          <BottoneIcona tono="fantasma" title="Chiudi" onClick={chiudi}>
            <Chiudi />
          </BottoneIcona>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {errore && (
            <div className="mb-3">
              <Avviso>{errore}</Avviso>
            </div>
          )}

          <ul className="space-y-1.5">
            {elenco.map((server, i) => {
              const attivo = stessoServer(server.indirizzo, impostazioni.serverAttivo ?? '')
              return (
                <li
                  key={server.indirizzo}
                  className={`riga-comparsa scaglione-${Math.min(i + 1, 5)} group flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                    attivo ? 'border-vivo/50 bg-vivo/10' : 'border-bordo bg-fondo hover:border-testo-3'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (attivo) return chiudi()
                      setErrore(null)
                      void cambiaServer(server.indirizzo)
                        .then(chiudi)
                        .catch((e) => setErrore((e as Error).message))
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        attivo ? 'bg-vivo text-fondo' : 'bg-fondo-3 text-testo-2'
                      }`}
                    >
                      <Macchina className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{server.nome}</span>
                        {attivo && <Spunta className="h-3.5 w-3.5 shrink-0 text-vivo" />}
                      </span>
                      <span className="block truncate text-xs text-testo-3">
                        {server.utente ? `${server.utente} · ` : ''}
                        {server.indirizzo.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                  </button>

                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <BottoneIcona
                      tono="fantasma"
                      title="Rinomina"
                      className="h-8 w-8"
                      onClick={() => {
                        setRinominando(server)
                        setNuovoNome(server.nome)
                      }}
                    >
                      <Matita className="h-3.5 w-3.5" />
                    </BottoneIcona>
                    <BottoneIcona
                      tono="fantasma"
                      title="Scollega"
                      className="h-8 w-8 text-male"
                      onClick={() => setDaScollegare(server)}
                    >
                      <Chiudi className="h-3.5 w-3.5" />
                    </BottoneIcona>
                  </span>
                </li>
              )
            })}
          </ul>

          {aggiungendo ? (
            <div className="riga-comparsa mt-3 rounded-xl border border-bordo bg-fondo p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="text-sm leading-relaxed text-testo-2">
                  L'indirizzo dell'altro server, e le credenziali di la'. Se non ne hai ancora,
                  serve un codice di invito di quel server: e' cosi' che si esiste su una macchina
                  nuova.
                </p>
                <BottoneIcona
                  tono="fantasma"
                  title="Annulla"
                  className="h-8 w-8"
                  onClick={() => setAggiungendo(false)}
                >
                  <Chiudi className="h-3.5 w-3.5" />
                </BottoneIcona>
              </div>

              <AggiungiServer
                impostazioni={impostazioni}
                collega={async (indirizzo) => {
                  setAggiungendo(false)
                  await cambiaServer(indirizzo)
                  chiudi()
                }}
                avvisa={setErrore}
              />
            </div>
          ) : (
            <button
              onClick={() => setAggiungendo(true)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-bordo p-3 text-sm text-testo-3 transition-colors hover:border-vivo hover:text-vivo"
            >
              <Piu className="h-4 w-4" />
              Collega un altro server
            </button>
          )}
        </div>
      </div>

      {rinominando && (
        <div
          className="velo absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setRinominando(null)}
        >
          <div
            className="pannello w-full max-w-sm space-y-4 rounded-2xl border border-bordo bg-fondo-2 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold">Come si chiama</h3>
            <Campo
              etichetta="Nome"
              aiuto="Solo per te: e' l'etichetta che compare qui e nella barra."
            >
              <input
                className={classiInput}
                value={nuovoNome}
                onChange={(e) => setNuovoNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void rinomina()}
                autoFocus
              />
            </Campo>
            <div className="flex gap-2">
              <Bottone tono="vivo" disabled={!nuovoNome.trim()} onClick={() => void rinomina()}>
                Salva
              </Bottone>
              <Bottone tono="fantasma" onClick={() => setRinominando(null)}>
                Annulla
              </Bottone>
            </div>
          </div>
        </div>
      )}

      {daScollegare && (
        <Conferma
          titolo={`Scolleghi ${daScollegare.nome}?`}
          testo={
            <>
              Sparisce dall'elenco e il suo accesso viene dimenticato su questo apparecchio. Il tuo
              account di la' resta: per tornarci basta rimettere l'indirizzo e la password, senza
              nessun invito nuovo.
            </>
          }
          azione="Scollega"
          tono="male"
          conferma={() => {
            const quale = daScollegare
            setDaScollegare(null)
            void scollega(quale.indirizzo).catch((e) => setErrore((e as Error).message))
          }}
          chiudi={() => setDaScollegare(null)}
        />
      )}
    </div>
  )
}

/**
 * Collegare un secondo server: prima dove, poi chi.
 *
 * Gli stessi due passi del primo avvio, e non per simmetria estetica. Prima
 * qui c'era il modulo delle credenziali con dentro anche un campo per
 * l'indirizzo, e quel campo era l'unico posto dell'applicazione in cui un
 * indirizzo veniva preso per buono senza andare a bussare: si scriveva il
 * server, si scriveva la password, si premeva, e un errore di battitura
 * nell'indirizzo tornava indietro travestito da credenziali sbagliate.
 *
 * Adesso l'indirizzo si verifica per conto suo con `provaServer` — lo stesso
 * controllo della schermata iniziale — e solo dopo compaiono i campi delle
 * credenziali. L'errore di battitura si scopre dove e' stato fatto, e il
 * modulo delle credenziali torna a occuparsi di una cosa sola.
 */
function AggiungiServer({
  impostazioni,
  collega,
  avvisa
}: {
  impostazioni: Impostazioni
  /** Chiamata a collegamento avvenuto, con l'indirizzo normalizzato. */
  collega: (indirizzo: string) => Promise<void> | void
  avvisa: (errore: string | null) => void
}): React.JSX.Element {
  const [indirizzo, setIndirizzo] = useState('')
  const [verificato, setVerificato] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const verifica = async (): Promise<void> => {
    setErrore(null)
    setInCorso(true)
    try {
      const esito = await provaServer(indirizzo)
      if (esito.ok) setVerificato(esito.indirizzo)
      else setErrore(esito.motivo)
    } finally {
      setInCorso(false)
    }
  }

  if (!verificato) {
    return (
      <div className="space-y-3">
        <Campo
          etichetta="Indirizzo del server"
          aiuto="Per esempio talk.casa.it, oppure http://192.168.1.10:8080 in rete locale."
        >
          <input
            className={classiInput}
            value={indirizzo}
            onChange={(e) => setIndirizzo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !inCorso && indirizzo.trim()) void verifica()
            }}
            placeholder="talk.casa.it"
            spellCheck={false}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
          />
        </Campo>

        {errore && <Avviso>{errore}</Avviso>}

        <Bottone
          tono="vivo"
          className="w-full"
          disabled={inCorso || !indirizzo.trim()}
          onClick={() => void verifica()}
        >
          {inCorso ? 'Guardo se c’e’…' : 'Continua'}
        </Bottone>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* L'indirizzo verificato resta in vista, ma come etichetta: e' cio' su
          cui si sta per mettere una password, e non saperlo piu' sarebbe
          peggio che non averlo mai visto. Si torna indietro con "cambia",
          che rimette il campo invece di aprirne un secondo. */}
      <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/[0.06] px-3 py-2">
        <Spunta className="h-3.5 w-3.5 shrink-0 text-ok" />
        <span className="min-w-0 flex-1 truncate text-xs text-testo-2" title={verificato}>
          {nomeDaIndirizzo(verificato)}
        </span>
        <button
          onClick={() => {
            setVerificato(null)
            setErrore(null)
          }}
          className="shrink-0 text-xs text-testo-3 underline underline-offset-2 hover:text-testo-2"
        >
          cambia
        </button>
      </div>

      <ModuloAccesso
        serverIniziale={verificato}
        // Il nome usato altrove, come proposta. Se di la' e' libero non
        // succede niente e si resta la stessa persona ovunque; se e' preso,
        // il modulo lo dice prima della password e ne propone uno vicino.
        utenteIniziale={impostazioni.utenteRicordato}
        etichettaAzione={{ accedi: 'Collega', registra: 'Crea l\'account e collega' }}
        quandoEntra={async ({ indirizzo: dove, token, utente }) => {
          const { errore: avviso } = await ponte.collegaServer({
            indirizzo: dove,
            token,
            utente: utente.utente,
            nomeVisibile: utente.nome
          })
          if (avviso) avvisa(avviso)
          // Collegarsi vuol dire anche andarci: e' quello che uno intende
          // avendo appena scritto la password.
          await collega(dove)
        }}
      />
    </div>
  )
}
