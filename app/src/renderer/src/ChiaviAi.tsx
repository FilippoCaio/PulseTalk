import { useEffect, useState } from 'react'
import type { Api, CampoIstanza, MiaChiaveAi, Prova, StatoIstanza } from './lib/api'
import { Avviso, Bottone, Campo, classiInput, Sezione } from './ui'
import { Scintille, Spunta } from './icone'

/**
 * Collegare i servizi esterni da dentro l'applicazione.
 *
 * Prima l'unico modo era una sessione SSH sul NAS: modificare l'ambiente del
 * container e ricrearlo. Funziona, ma vuol dire che l'unica persona che puo'
 * accendere una funzione e' quella davanti a un terminale — e quasi sempre e'
 * la stessa che si trova davanti al pulsante spento, senza modo di agirci.
 *
 * Due pannelli, per due domande diverse. **Server** e' di chi amministra: una
 * chiave per tutti, e la paga lui. **La mia chiave** e' di chiunque, e serve
 * solo quando l'amministratore ha deciso che ognuno porti la propria. Il
 * secondo si spiega da solo quando non serve, invece di sparire: un pannello
 * che compare e scompare a seconda di una impostazione altrui e' una cosa che
 * si cerca e non si trova.
 */

// -- Il pannello dell'amministratore ------------------------------------------

export function ImpostazioniServer({ api }: { api: Api }): React.JSX.Element {
  const [stato, setStato] = useState<StatoIstanza | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  /** Cosa e' stato toccato ma non ancora salvato, per chiave. */
  const [bozza, setBozza] = useState<Record<string, string>>({})
  const [inCorso, setInCorso] = useState(false)
  const [salvato, setSalvato] = useState(false)
  const [prova, setProva] = useState<Prova | null>(null)

  useEffect(() => {
    void api
      .impostazioniIstanza()
      .then(setStato)
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  const scrivi = (chiave: string, valore: string): void => {
    setBozza((prima) => ({ ...prima, [chiave]: valore }))
    setSalvato(false)
    setProva(null)
  }

  const salva = async (): Promise<void> => {
    if (Object.keys(bozza).length === 0) return
    setInCorso(true)
    setErrore(null)
    try {
      const nuovo = await api.salvaImpostazioniIstanza(bozza)
      setStato(nuovo)
      setBozza({})
      setSalvato(true)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  if (errore && !stato) return <Avviso>{errore}</Avviso>
  if (!stato) return <p className="respiro text-sm text-testo-3">carico…</p>

  const daSalvare = Object.keys(bozza).length

  return (
    <>
      {errore && <Avviso>{errore}</Avviso>}

      {stato.gruppi.map((gruppo) => (
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

      {/* La prova sta in fondo perche' e' l'ultimo passo: si scrive, si salva,
          si chiede al servizio se risponde davvero. Una chiave si scrive
          giusta e non funziona lo stesso — credito finito, modello che non
          esiste, indirizzo che parla un altro dialetto — e sono tutti casi che
          si vedono solo chiedendo. */}
      <Sezione titolo="Prova" sotto="Chiede davvero qualcosa al servizio, con la configurazione salvata.">
        <div className="flex flex-wrap items-center gap-2">
          <Bottone tono="fantasma" onClick={() => void chiedi(api.provaImpostazioniIstanza('chat'), setProva)}>
            Prova la chat
          </Bottone>
          <Bottone
            tono="fantasma"
            onClick={() => void chiedi(api.provaImpostazioniIstanza('trascrizione'), setProva)}
          >
            Prova la trascrizione
          </Bottone>
        </div>
        <EsitoProva prova={prova} />
      </Sezione>

      {/* La barra del salvataggio resta in fondo e appiccicata: i campi sono
          tanti, e un pulsante in cima si perde di vista proprio mentre si
          scrive quello che dovrebbe salvare. */}
      <div className="sticky bottom-0 -mx-5 flex items-center gap-3 border-t border-bordo bg-fondo-2/95 px-5 py-3 backdrop-blur">
        <Bottone tono="vivo" disabled={inCorso || daSalvare === 0} onClick={() => void salva()}>
          {inCorso ? 'salvo…' : daSalvare ? `Salva ${daSalvare} ${daSalvare === 1 ? 'campo' : 'campi'}` : 'Salva'}
        </Bottone>
        {daSalvare > 0 && (
          <Bottone tono="fantasma" onClick={() => setBozza({})}>
            Annulla
          </Bottone>
        )}
        {salvato && daSalvare === 0 && (
          <span className="flex items-center gap-1.5 text-xs text-ok">
            <Spunta className="h-3.5 w-3.5" />
            salvato, e gia' attivo
          </span>
        )}
      </div>
    </>
  )
}

/**
 * Un campo, con scritto da dove viene il valore che c'e' adesso.
 *
 * "Da dove" non e' un dettaglio decorativo: un campo pieno che non si sa
 * spiegare e' la cosa che fa perdere il pomeriggio. Scritto qui vuol dire che
 * vince su tutto; dal container vuol dire che sparira' appena si scrive.
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
    ? 'da salvare'
    : campo.origine === 'pannello'
      ? 'scritta qui'
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
              toccato
                ? 'border-vivo/40 bg-vivo/10 text-vivo'
                : 'border-bordo text-testo-3'
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
          collegare da qui. Se preferisci usare la tua, chiedi a chi amministra di passare a
          «ognuno la sua».
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
        {stato.collegata ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Spunta className="h-4 w-4 shrink-0" />
            Collegata{stato.coda ? `, finisce con ${stato.coda}` : ''}.
          </p>
        ) : (
          <p className="text-sm text-testo-3">Nessuna chiave collegata.</p>
        )}

        <Campo
          etichetta="Chiave"
          aiuto="Resta sul server, che e' chi chiama il modello. Nessun altro la puo' usare, e non torna piu' indietro leggibile — nemmeno a te."
        >
          <input
            className={classiInput}
            type="password"
            value={chiave}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setChiave(e.target.value)}
            placeholder={stato.collegata ? 'scrivi per sostituirla' : 'sk-…'}
          />
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

async function chiedi(
  promessa: Promise<Prova>,
  mostra: (p: Prova) => void
): Promise<void> {
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
