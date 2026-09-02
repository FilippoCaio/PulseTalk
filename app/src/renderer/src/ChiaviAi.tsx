import { useEffect, useMemo, useState } from 'react'
import type {
  Api,
  CampoIstanza,
  CategoriaIstanza,
  MiaChiaveAi,
  Prova,
  StatoIstanza
} from './lib/api'
import { Avviso, Bottone, Campo, classiInput, Conferma, Interruttore, Sezione } from './ui'
import { OreDiTutti } from './Ore'
import { Scintille, Spunta } from './icone'
import { ContenutoInviti } from './atrio/Inviti'

/**
 * Collegare i servizi esterni da dentro l'applicazione.
 *
 * Prima l'unico modo era una sessione SSH sul NAS: modificare l'ambiente del
 * container e ricrearlo. Funziona, ma vuol dire che l'unica persona che puo'
 * accendere una funzione e' quella davanti a un terminale — e quasi sempre e'
 * la stessa che si trova davanti al pulsante spento, senza modo di agirci.
 *
 * Due pannelli, per due domande diverse, e la differenza fra i due e' *dove
 * finisce quello che scrivi*.
 *
 * **Server** e' di chi amministra. Quello che si scrive qui non resta qui: va
 * a valere per tutti, subito, e per questo non si salva scrivendo — si scrive,
 * si guarda, e poi si preme «Pubblica». Da li' in poi il campo si svuota,
 * perche' il valore adesso sta sul server e questo modulo non lo possiede piu'.
 *
 * **La mia chiave** e' di chiunque, ed e' il contrario: si salva scrivendo, e
 * quello che si e' messo resta scritto nelle proprie impostazioni. Il pannello
 * si spiega da solo quando non serve, invece di sparire: uno che compare e
 * scompare a seconda di una impostazione altrui e' una cosa che si cerca e non
 * si trova.
 */

// -- Il pannello dell'amministratore ------------------------------------------

/** La pagina degli inviti non ha campi d'ambiente: e' tutta di questo lato. */
const SCHEDA_INVITI = 'inviti'

export function ImpostazioniServer({
  api,
  /** L'indirizzo pubblico, per il link d'invito pronto da mandare. */
  server
}: {
  api: Api
  server: string
}): React.JSX.Element {
  const [stato, setStato] = useState<StatoIstanza | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  /** Cosa e' stato toccato ma non ancora pubblicato, per chiave. */
  const [bozza, setBozza] = useState<Record<string, string>>({})
  const [inCorso, setInCorso] = useState(false)
  const [pubblicato, setPubblicato] = useState(false)
  const [chiede, setChiede] = useState(false)
  const [prova, setProva] = useState<Prova | null>(null)
  const [scheda, setScheda] = useState<string>(SCHEDA_INVITI)

  useEffect(() => {
    void api
      .impostazioniIstanza()
      .then(setStato)
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  const scrivi = (chiave: string, valore: string): void => {
    setBozza((prima) => ({ ...prima, [chiave]: valore }))
    setPubblicato(false)
    setProva(null)
  }

  /**
   * In quale scheda sta un campo.
   *
   * Serve a mettere il pallino sulla linguetta giusta: con le categorie
   * separate, una modifica lasciata indietro in un'altra scheda sparirebbe
   * dalla vista pur restando nella bozza, e si pubblicherebbe senza sapere
   * cosa.
   */
  const schedaDi = useMemo(() => {
    if (!stato) return () => null as string | null
    return (chiave: string): string | null => {
      const campo = stato.campi.find((c) => c.chiave === chiave)
      if (!campo) return null
      if (campo.gruppo) return stato.gruppi.find((g) => g.id === campo.gruppo)?.categoria ?? null
      return stato.categorie.find((c) => c.personale?.chiave === chiave)?.id ?? null
    }
  }, [stato])

  const pubblica = async (): Promise<void> => {
    if (Object.keys(bozza).length === 0) return
    setInCorso(true)
    setErrore(null)
    try {
      const nuovo = await api.salvaImpostazioniIstanza(bozza)
      setStato(nuovo)
      setBozza({})
      setPubblicato(true)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  if (errore && !stato) return <Avviso>{errore}</Avviso>
  if (!stato) return <p className="respiro text-sm text-testo-3">carico…</p>

  const daPubblicare = Object.keys(bozza)
  const quanti = daPubblicare.length
  const categoria = stato.categorie.find((c) => c.id === scheda) ?? null
  const perChiave = new Map(stato.campi.map((c) => [c.chiave, c]))

  return (
    <>
      {/* La riga delle categorie sta in cima e appiccicata, e arriva davvero
          al bordo. I tre pezzi vanno insieme e nessuno basta da solo:
          `-mt-5` la fa partire dentro all'imbottitura del contenitore,
          `-top-5` la ci tiene mentre si scorre, `pt-5` rimette lo spazio
          dentro alla barra invece che fuori. Con il solo `top-0` la barra si
          ferma venti pixel piu' su e il testo che scorre le passa sotto in
          quella striscia — che e' esattamente il difetto che sembra un pezzo
          rotto. */}
      <div className="sticky -top-5 z-10 -mx-5 -mt-5 border-b border-bordo bg-fondo-2 px-5 pt-5 pb-3">
        <div className="flex flex-wrap gap-1">
          <Linguetta
            nome="Inviti"
            attiva={scheda === SCHEDA_INVITI}
            premi={() => setScheda(SCHEDA_INVITI)}
          />
          {stato.categorie.map((c) => (
            <Linguetta
              key={c.id}
              nome={c.nome}
              attiva={scheda === c.id}
              inSospeso={daPubblicare.some((k) => schedaDi(k) === c.id)}
              premi={() => setScheda(c.id)}
            />
          ))}
        </div>
      </div>

      {errore && <Avviso>{errore}</Avviso>}

      {/* -- Gli inviti ---------------------------------------------------- */}
      {scheda === SCHEDA_INVITI && <ContenutoInviti api={api} server={server} />}

      {/* -- Una categoria di servizi -------------------------------------- */}
      {categoria && (
        <>
          <div>
            <h3 className="font-semibold">{categoria.nome}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-testo-3">{categoria.sotto}</p>
          </div>

          <ChiPortaLaChiave
            categoria={categoria}
            campo={categoria.personale ? (perChiave.get(categoria.personale.chiave) ?? null) : null}
            bozza={categoria.personale ? bozza[categoria.personale.chiave] : undefined}
            scrivi={(v) => categoria.personale && scrivi(categoria.personale.chiave, v)}
          />

          {stato.gruppi
            .filter((g) => g.categoria === categoria.id)
            .map((gruppo) => (
              <Sezione key={gruppo.id} titolo={gruppo.nome} sotto={gruppo.sotto}>
                {stato.campi
                  .filter((c) => c.gruppo === gruppo.id)
                  .map((campo) => (
                    <CampoServizio
                      key={campo.chiave}
                      campo={campo}
                      bozza={bozza[campo.chiave]}
                      scrivi={(v) => scrivi(campo.chiave, v)}
                    />
                  ))}
              </Sezione>
            ))}

          {/* Le ore di tutti, sotto all'interruttore che le accende: chi
              cerca questa tabella l'ha appena acceso, ed e' li' che la
              cerchera' di nuovo il mese prossimo. */}
          {categoria.id === 'lavoro' && <OreDiTutti api={api} />}

          {/* La prova sta in fondo alle categorie a cui si possa chiedere
              qualcosa e sentirsi rispondere. Una chiave si scrive giusta e non
              funziona lo stesso — credito finito, modello che non esiste,
              indirizzo che parla un altro dialetto, password della casella
              cambiata il mese scorso — e sono tutti casi che si vedono solo
              chiedendo. */}
          {PROVE[categoria.id] && (
            <Sezione
              titolo="Prova"
              sotto="Chiede davvero qualcosa al servizio, con la configurazione gia' pubblicata."
            >
              <div className="flex flex-wrap items-center gap-2">
                {PROVE[categoria.id].map(({ cosa, etichetta }) => (
                  <Bottone
                    key={cosa}
                    tono="fantasma"
                    onClick={() => void chiedi(api.provaImpostazioniIstanza(cosa), setProva)}
                  >
                    {etichetta}
                  </Bottone>
                ))}
              </div>
              <EsitoProva prova={prova} />
            </Sezione>
          )}
        </>
      )}

      {/* La barra della pubblicazione resta in fondo e appiccicata, e come
          quella in cima arriva fino al bordo: stessa terna, `-mb-5` piu'
          `-bottom-5` piu' `pb-5`. Sta in fondo perche' i campi sono tanti, e
          un pulsante in cima si perde di vista proprio mentre si scrive quello
          che dovrebbe mandare via. */}
      {(categoria || quanti > 0) && (
        <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center gap-3 border-t border-bordo bg-fondo-2 px-5 pt-3 pb-5">
          <Bottone tono="vivo" disabled={inCorso || quanti === 0} onClick={() => setChiede(true)}>
            {inCorso
              ? 'pubblico…'
              : quanti
                ? `Pubblica ${quanti} ${quanti === 1 ? 'campo' : 'campi'}`
                : 'Pubblica sul server'}
          </Bottone>
          {quanti > 0 && (
            <Bottone tono="fantasma" onClick={() => setBozza({})}>
              Annulla
            </Bottone>
          )}
          {quanti > 0 ? (
            <span className="text-xs text-testo-3">
              scritto qui, non ancora sul server
            </span>
          ) : pubblicato ? (
            <span className="flex items-center gap-1.5 text-xs text-ok">
              <Spunta className="h-3.5 w-3.5" />
              pubblicato, e gia&apos; attivo
            </span>
          ) : null}
        </div>
      )}

      {/* Il "sicuro?" c'e' perche' questo pulsante non salva delle preferenze:
          accende o spegne una funzione per tutti quelli che stanno usando il
          server adesso, e le chiavi che manda non tornano piu' indietro
          leggibili. Un passo in piu' su una cosa che si fa tre volte all'anno
          costa meno di una volta sola fatta per sbaglio. */}
      {chiede && (
        <Conferma
          titolo={quanti === 1 ? 'Pubblicare questo campo?' : `Pubblicare questi ${quanti} campi?`}
          testo={
            <>
              <span className="block">
                Vanno sul server e valgono per tutti da subito, senza riavvii:{' '}
                {daPubblicare
                  .map((k) => perChiave.get(k)?.etichetta ?? k)
                  .join(', ')}
                .
              </span>
              {daPubblicare.some((k) => perChiave.get(k)?.segreta) && (
                <span className="mt-2 block">
                  Fra questi c&apos;e&apos; una chiave segreta: una volta pubblicata non torna piu&apos;
                  indietro leggibile, nemmeno a te. Da qui in avanti ne vedrai solo le ultime quattro
                  cifre.
                </span>
              )}
            </>
          }
          azione="Pubblica"
          conferma={() => {
            setChiede(false)
            void pubblica()
          }}
          chiudi={() => setChiede(false)}
        />
      )}
    </>
  )
}

/** Una categoria nella riga in cima, con il pallino se ha roba non pubblicata. */
function Linguetta({
  nome,
  attiva,
  inSospeso = false,
  premi
}: {
  nome: string
  attiva: boolean
  inSospeso?: boolean
  premi: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={premi}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
        attiva ? 'bg-fondo-3 text-testo' : 'text-testo-2 hover:bg-fondo-3/60 hover:text-testo'
      }`}
    >
      {nome}
      {inSospeso && (
        <span className="h-1.5 w-1.5 rounded-full bg-vivo" title="ci sono modifiche non pubblicate" />
      )}
    </button>
  )
}

/**
 * Chi porta la chiave, per le categorie dove la domanda esiste.
 *
 * Dove non esiste, al suo posto c'e' scritto perche'. Un interruttore che
 * manca e basta e' una domanda che torna ogni sei mesi — "e per le GIF si
 * puo'?" — e la risposta scritta qui costa una riga e la chiude per sempre.
 */
function ChiPortaLaChiave({
  categoria,
  campo,
  bozza,
  scrivi
}: {
  categoria: CategoriaIstanza
  campo: CampoIstanza | null
  bozza: string | undefined
  scrivi: (valore: string) => void
}): React.JSX.Element | null {
  const personale = categoria.personale

  if (!personale) {
    if (!categoria.senzaPersonale) return null
    return (
      <div className="rounded-lg border border-bordo bg-fondo px-3.5 py-2.5">
        <p className="text-sm">Una chiave sola, quella del server.</p>
        <p className="mt-0.5 text-xs leading-relaxed text-testo-3">{categoria.senzaPersonale}</p>
      </div>
    )
  }

  const valore = bozza ?? campo?.valore ?? personale.spento
  const acceso = valore !== personale.spento
  const scelto = acceso ? valore : personale.acceso[0].valore

  return (
    <div className="space-y-3 rounded-lg border border-bordo bg-fondo px-3.5 py-3">
      <Interruttore
        acceso={acceso}
        cambia={(v) => scrivi(v ? personale.acceso[0].valore : personale.spento)}
        titolo={personale.titolo}
        sotto={personale.sotto}
      />

      {acceso && (
        <div className="ml-6 space-y-2.5 border-l border-bordo pl-3.5">
          {personale.acceso.map((modo) => (
            <label key={modo.valore} className="flex cursor-pointer items-start gap-2.5">
              <input
                type="radio"
                name={personale.chiave}
                className="mt-0.5 accent-vivo"
                checked={scelto === modo.valore}
                onChange={() => scrivi(modo.valore)}
              />
              <span className="text-sm">
                {modo.nome}
                <span className="mt-0.5 block text-xs leading-relaxed text-testo-3">
                  {modo.sotto}
                </span>
              </span>
            </label>
          ))}
          <p className="text-xs text-testo-3">
            Chi vuole la sua la collega da «{personale.dove}», nelle proprie impostazioni.
          </p>
        </div>
      )}

      {bozza !== undefined && (
        <p className="text-xs text-vivo">
          da pubblicare — finche&apos; non premi «Pubblica», sul server vale ancora quello di prima.
        </p>
      )}
    </div>
  )
}

/**
 * Un campo, con scritto da dove viene il valore che c'e' adesso.
 *
 * "Da dove" non e' un dettaglio decorativo: un campo pieno che non si sa
 * spiegare e' la cosa che fa perdere il pomeriggio. Sul server vuol dire che
 * vince su tutto; dal container vuol dire che sparira' appena si pubblica.
 */
function CampoServizio({
  campo,
  bozza,
  scrivi
}: {
  campo: CampoIstanza
  bozza: string | undefined
  scrivi: (valore: string) => void
}): React.JSX.Element {
  const valore = bozza ?? campo.valore
  const toccato = bozza !== undefined

  const provenienza = toccato
    ? 'da pubblicare'
    : campo.origine === 'pannello'
      ? 'sul server'
      : campo.origine === 'container'
        ? 'dal container'
        : null

  return (
    <Campo etichetta={campo.etichetta} aiuto={campo.aiuto}>
      <div className="flex items-center gap-2">
        {campo.tipo === 'scelta' ? (
          <select className={classiInput} value={valore} onChange={(e) => scrivi(e.target.value)}>
            {(campo.valori ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : campo.tipo === 'interruttore' ? (
          <select
            className={classiInput}
            value={valore ? 'si' : 'no'}
            onChange={(e) => scrivi(e.target.value === 'si' ? '1' : '')}
          >
            <option value="no">Spenta</option>
            <option value="si">Accesa</option>
          </select>
        ) : (
          <input
            className={classiInput}
            type={campo.segreta ? 'password' : 'text'}
            value={valore}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => scrivi(e.target.value)}
            placeholder={
              campo.segreta && campo.impostata
                ? `impostata, finisce con ${campo.coda ?? '····'} — scrivi per sostituirla`
                : (campo.esempio ?? '')
            }
          />
        )}

        {provenienza && (
          <span
            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${
              toccato ? 'border-vivo/40 bg-vivo/10 text-vivo' : 'border-bordo text-testo-3'
            }`}
          >
            {provenienza}
          </span>
        )}
      </div>
    </Campo>
  )
}

// -- Il pannello di chiunque --------------------------------------------------

export function MiaAi({ api }: { api: Api }): React.JSX.Element {
  const [stato, setStato] = useState<MiaChiaveAi | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [chiave, setChiave] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [sttModel, setSttModel] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [prova, setProva] = useState<Prova | null>(null)

  const carica = (nuovo: MiaChiaveAi): void => {
    setStato(nuovo)
    setBaseUrl(nuovo.baseUrl)
    setChatModel(nuovo.chatModel)
    setSttModel(nuovo.sttModel)
    setChiave('')
  }

  useEffect(() => {
    void api
      .miaChiaveAi()
      .then(carica)
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  if (errore && !stato) return <Avviso>{errore}</Avviso>
  if (!stato) return <p className="respiro text-sm text-testo-3">carico…</p>

  // Con la chiave dell'istanza qui non c'e' niente da fare, e dirlo e' meglio
  // che far sparire la sezione: chi ne ha sentito parlare la cerca, e non
  // trovarla non spiega niente.
  if (!stato.serve) {
    return (
      <Sezione titolo="La mia chiave AI" sotto="Su questo server la mette l'amministratore.">
        <p className="text-sm text-testo-2">
          L&apos;AI di questo server usa una chiave sola, per tutti, e non c&apos;e&apos; niente da
          collegare da qui. Se preferisci usare la tua, chiedi a chi amministra di accendere
          «ognuno porta la propria» nelle impostazioni del server.
        </p>
      </Sezione>
    )
  }

  const salva = async (): Promise<void> => {
    if (!chiave.trim()) return
    setInCorso(true)
    setErrore(null)
    setProva(null)
    try {
      carica(
        await api.salvaMiaChiaveAi({
          apiKey: chiave.trim(),
          baseUrl: baseUrl.trim(),
          chatModel: chatModel.trim(),
          sttModel: sttModel.trim()
        })
      )
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  const scollega = async (): Promise<void> => {
    setInCorso(true)
    try {
      carica(await api.scollegaMiaChiaveAi())
      setProva(null)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <>
      {errore && <Avviso>{errore}</Avviso>}

      <Sezione
        titolo="La mia chiave AI"
        sotto={
          stato.modo === 'utente'
            ? "Su questo server l'AI la porta ognuno per se': senza la tua, per te resta spenta."
            : 'Su questo server puoi usare la tua. Senza, ricadi su quella di casa.'
        }
      >
        {/* La differenza con il pannello del server, detta una volta: qui non
            c'e' niente da pubblicare, e quello che si scrive resta scritto. */}
        <p className="text-xs leading-relaxed text-testo-3">
          Quello che metti qui resta nelle <strong>tue</strong> impostazioni: si salva premendo
          «Collega» e ci rimane, senza mandarlo a nessun altro. Nessuno degli altri iscritti lo
          vede, e non cambia niente per loro.
        </p>

        <Campo
          etichetta="Chiave"
          aiuto="Resta sul server, che e' chi chiama il modello. Nessun altro la puo' usare, e non torna piu' indietro leggibile — nemmeno a te."
        >
          <div className="flex items-center gap-2">
            <input
              className={classiInput}
              type="password"
              value={chiave}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setChiave(e.target.value)}
              placeholder={
                stato.collegata
                  ? `collegata, finisce con ${stato.coda ?? '····'} — scrivi per sostituirla`
                  : 'sk-…'
              }
            />
            {(chiave.trim() || stato.collegata) && (
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${
                  chiave.trim()
                    ? 'border-vivo/40 bg-vivo/10 text-vivo'
                    : 'border-bordo text-testo-3'
                }`}
              >
                {chiave.trim() ? 'da salvare' : 'salvata qui'}
              </span>
            )}
          </div>
        </Campo>

        <Campo
          etichetta="Indirizzo del servizio"
          aiuto={`Vuoto vuol dire quello di casa: ${stato.predefiniti.baseUrl}. Cambialo se la tua chiave e' di un altro servizio.`}
        >
          <input
            className={classiInput}
            value={baseUrl}
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={stato.predefiniti.baseUrl}
          />
        </Campo>

        <Campo etichetta="Modello di trascrizione" aiuto="Vuoto vuol dire quello di casa.">
          <input
            className={classiInput}
            value={sttModel}
            spellCheck={false}
            onChange={(e) => setSttModel(e.target.value)}
            placeholder={stato.predefiniti.sttModel || 'gpt-transcribe'}
          />
        </Campo>

        <Campo etichetta="Modello di chat" aiuto="Vuoto vuol dire quello di casa.">
          <input
            className={classiInput}
            value={chatModel}
            spellCheck={false}
            onChange={(e) => setChatModel(e.target.value)}
            placeholder={stato.predefiniti.chatModel || 'gpt-5'}
          />
        </Campo>

        <div className="flex flex-wrap items-center gap-2">
          <Bottone tono="vivo" disabled={inCorso || !chiave.trim()} onClick={() => void salva()}>
            {inCorso ? 'salvo…' : stato.collegata ? 'Sostituisci' : 'Collega'}
          </Bottone>
          {stato.collegata && (
            <>
              <Bottone
                tono="fantasma"
                onClick={() => void chiedi(api.provaMiaChiaveAi('trascrizione'), setProva)}
              >
                Prova la trascrizione
              </Bottone>
              <Bottone tono="fantasma" disabled={inCorso} onClick={() => void scollega()}>
                Scollega
              </Bottone>
            </>
          )}
        </div>

        <EsitoProva prova={prova} />

        {stato.collegata && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-testo-3">
            <Scintille className="h-3.5 w-3.5 shrink-0 text-vivo" />
            Con questa chiave hai:{' '}
            {Object.entries(stato.capacita)
              .filter(([, acceso]) => acceso)
              .map(([nome]) => nome)
              .join(', ') || 'niente ancora'}
          </p>
        )}
      </Sezione>
    </>
  )
}

// -- I pezzi in comune --------------------------------------------------------

/**
 * Cosa si puo' provare, categoria per categoria.
 *
 * Una tabella e non una catena di `if`: quando si aggiunge un servizio a cui
 * si possa chiedere qualcosa, si aggiunge una riga qui e il pulsante compare
 * da solo nel posto giusto.
 *
 * La posta si ferma prima di spedire. Un messaggio vero vorrebbe un
 * destinatario, e l'unico a portata sarebbe l'admin che sta premendo — che
 * proprio in quel momento non ha ancora confermato il suo indirizzo. Host,
 * porta, TLS e credenziali sono comunque dove sbaglia quasi tutto.
 */
const PROVE: Record<string, { cosa: 'chat' | 'trascrizione' | 'posta'; etichetta: string }[]> = {
  ai: [
    { cosa: 'chat', etichetta: 'Prova la chat' },
    { cosa: 'trascrizione', etichetta: 'Prova la trascrizione' }
  ],
  posta: [{ cosa: 'posta', etichetta: 'Prova il collegamento' }]
}

async function chiedi(promessa: Promise<Prova>, mostra: (p: Prova) => void): Promise<void> {
  try {
    mostra(await promessa)
  } catch (e) {
    mostra({ ok: false, cosa: 'prova', errore: (e as Error).message })
  }
}

function EsitoProva({ prova }: { prova: Prova | null }): React.JSX.Element | null {
  if (!prova) return null
  return prova.ok ? (
    <p className="flex items-start gap-2 text-sm text-ok">
      <Spunta className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Il servizio risponde.
        {prova.risposta ? <span className="text-testo-3"> «{prova.risposta}»</span> : null}
      </span>
    </p>
  ) : (
    <Avviso>{prova.errore ?? 'non ha funzionato'}</Avviso>
  )
}
