import { useState } from 'react'
import type { Canale, Spazio } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Avviso, Bottone, Campo, classiInput } from '../ui'
import {
  Altoparlante,
  Cancelletto,
  Cestino,
  Chiudi,
  Cuffie,
  Esci,
  Lente,
  Lucchetto,
  MicrofonoSpento,
  Piu,
  SchermoCondividi,
  Spunta,
  Utenti
} from '../icone'

/**
 * La colonna dei canali.
 *
 * Sotto ai canali vocali compare chi c'e' dentro, com'e' giusto che sia: la
 * domanda vera guardando quella colonna non e' "quali canali esistono" ma
 * "dove sono gli altri". Con i nomi visibili si entra dove c'e' qualcuno senza
 * doverci entrare per scoprirlo.
 */
export default function ColonnaCanali({
  spazio,
  apertoId,
  inVoce,
  scegli,
  entraInVoce,
  esciDallaVoce,
  crea,
  elimina,
  apriRicerca,
  gestisciIscritti,
  parlanti
}: {
  spazio: Spazio
  apertoId: number | null
  /** Il canale vocale in cui si sta parlando adesso, se ce n'e' uno. */
  inVoce: number | null
  scegli: (canale: Canale) => void
  entraInVoce: (canale: Canale) => void
  esciDallaVoce: () => void
  crea: (dati: {
    nome: string
    tipo: 'testo' | 'voce'
    soloAscolto: boolean
    privato: boolean
  }) => Promise<void>
  elimina: (canale: Canale) => Promise<void>
  apriRicerca: () => void
  /** Apre l'elenco di chi sta dentro a un canale privato. */
  gestisciIscritti: (canale: Canale) => void
  /**
   * Chi sta parlando adesso, per identita'.
   *
   * Arriva dalla sessione vocale, che vive in App e continua a girare anche
   * mentre si legge una chat. E' l'unico modo per sapere chi sta parlando senza
   * tornare a guardare la griglia — che e' esattamente il momento in cui uno
   * vorrebbe saperlo.
   */
  parlanti?: Set<string>
}): React.JSX.Element {
  const [creando, setCreando] = useState<'testo' | 'voce' | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const amministra = spazio.ruoloMio === 'admin'
  const perCategoria = (id: number | null): Canale[] =>
    spazio.canali.filter((c) => c.categoria === id).sort((a, b) => a.posizione - b.posizione)

  const gruppi: { id: number | null; nome: string | null; canali: Canale[] }[] = [
    { id: null, nome: null, canali: perCategoria(null) },
    ...spazio.categorie
      .slice()
      .sort((a, b) => a.posizione - b.posizione)
      .map((c) => ({ id: c.id, nome: c.nome, canali: perCategoria(c.id) }))
  ]

  return (
    // `flex-1` e non un'altezza propria: la colonna deve occupare tutto quello
    // che resta fino in fondo, con la barra della voce appoggiata sotto. Con
    // l'altezza data dal contenuto si fermava dov'era finito l'ultimo canale, e
    // sotto restava un rettangolo vuoto con il bordo interrotto a meta'.
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-bordo px-4 py-3">
        <h2 className="min-w-0 truncate font-medium">{spazio.nome}</h2>
        <button
          onClick={apriRicerca}
          title="Cerca nei messaggi"
          aria-label="Cerca nei messaggi"
          className="shrink-0 text-testo-3 hover:text-testo"
        >
          <Lente className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {errore && <Avviso>{errore}</Avviso>}

        {gruppi.map((gruppo) =>
          gruppo.canali.length === 0 && gruppo.id !== null ? null : (
            <section key={gruppo.id ?? 'sciolti'} className="mb-3">
              {gruppo.nome && (
                <p className="px-2 py-1 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
                  {gruppo.nome}
                </p>
              )}

              {gruppo.canali.map((canale) => (
                <RigaCanale
                  key={canale.id}
                  canale={canale}
                  aperto={canale.id === apertoId}
                  inVoce={canale.id === inVoce}
                  amministra={amministra}
                  scegli={() => (canale.tipo === 'voce' ? entraInVoce(canale) : scegli(canale))}
                  esci={esciDallaVoce}
                  gestisciIscritti={() => gestisciIscritti(canale)}
                  parlanti={canale.id === inVoce ? parlanti : undefined}
                  elimina={async () => {
                    try {
                      await elimina(canale)
                    } catch (e) {
                      setErrore((e as Error).message)
                    }
                  }}
                />
              ))}
            </section>
          )
        )}

        {amministra && (
          <div className="mt-2 flex gap-1 px-1">
            <button
              onClick={() => setCreando('testo')}
              title="Nuovo canale di testo"
              aria-label="Nuovo canale di testo"
              className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-dashed border-bordo py-1.5 text-testo-3 hover:border-vivo hover:text-vivo"
            >
              <Piu className="h-3.5 w-3.5" />
              <Cancelletto className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCreando('voce')}
              title="Nuovo canale vocale"
              aria-label="Nuovo canale vocale"
              className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-dashed border-bordo py-1.5 text-testo-3 hover:border-vivo hover:text-vivo"
            >
              <Piu className="h-3.5 w-3.5" />
              <Altoparlante className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {creando && (
        <ModuloCanale
          tipo={creando}
          chiudi={() => setCreando(null)}
          crea={async (dati) => {
            try {
              await crea(dati)
              setCreando(null)
            } catch (e) {
              setErrore((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}

function RigaCanale({
  canale,
  aperto,
  inVoce,
  amministra,
  scegli,
  esci,
  elimina,
  gestisciIscritti,
  parlanti
}: {
  canale: Canale
  aperto: boolean
  inVoce: boolean
  amministra: boolean
  scegli: () => void
  esci: () => void
  elimina: () => Promise<void>
  gestisciIscritti: () => void
  /** Valorizzato solo per il canale in cui si sta parlando adesso. */
  parlanti?: Set<string>
}): React.JSX.Element {
  const [conferma, setConferma] = useState(false)

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          aperto ? 'bg-fondo-3 text-testo' : 'text-testo-2 hover:bg-fondo-3/60 hover:text-testo'
        }`}
      >
        <button onClick={scegli} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="shrink-0 text-testo-3">
            {canale.tipo === 'voce' ? (
              <Altoparlante className="h-4 w-4" />
            ) : (
              <Cancelletto className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{canale.nome}</span>
          {canale.privato && (
            <span title="Privato: lo vedono solo gli invitati" className="shrink-0 text-attenzione">
              <Lucchetto className="h-3 w-3" />
            </span>
          )}
          {canale.soloAscolto && (
            <span className="shrink-0 text-attenzione" title="Palco: parlano gli admin, gli altri ascoltano">
              <Cuffie className="h-3.5 w-3.5" />
            </span>
          )}
          {canale.nonLetti > 0 && (
            <span className="numeri shrink-0 rounded-full bg-vivo px-1.5 py-0.5 text-[10px] font-semibold text-fondo">
              {canale.nonLetti > 99 ? '99+' : canale.nonLetti}
            </span>
          )}
        </button>

        {inVoce && (
          <button
            onClick={esci}
            title="Esci dal canale vocale"
            aria-label="Esci dal canale vocale"
            className="shrink-0 text-male opacity-0 group-hover:opacity-100"
          >
            <Esci className="h-4 w-4" />
          </button>
        )}

        {canale.privato && (
          <button
            onClick={gestisciIscritti}
            title={`Chi puo' vedere ${canale.nome}`}
            aria-label={`Chi puo' vedere ${canale.nome}`}
            className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-testo"
          >
            <Utenti className="h-4 w-4" />
          </button>
        )}

        {amministra &&
          !inVoce &&
          (conferma ? (
            <span className="flex shrink-0 gap-1">
              <button
                className="text-male"
                onClick={() => void elimina()}
                title={`Elimina ${canale.nome}: non si torna indietro`}
                aria-label={`Elimina ${canale.nome}`}
              >
                <Spunta className="h-4 w-4" />
              </button>
              <button
                className="text-testo-3 hover:text-testo"
                onClick={() => setConferma(false)}
                title="Lascia stare"
                aria-label="Lascia stare"
              >
                <Chiudi className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConferma(true)}
              title={`Elimina il canale ${canale.nome}`}
              aria-label={`Elimina il canale ${canale.nome}`}
              className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
            >
              <Cestino className="h-4 w-4" />
            </button>
          ))}
      </div>

      {/* Chi sta dentro al canale vocale, sotto al suo nome.
          Aria fra una riga e l'altra, e non per gusto: senza, le pastiglie
          colorate si toccano e l'elenco diventa una colonna unica di colore in
          cui le facce non si distinguono piu' l'una dall'altra. L'anello verde
          poi ha bisogno del suo spazio per non finire addosso al vicino. */}
      {canale.tipo === 'voce' && canale.presenti.length > 0 && (
        <div className="mt-1 mb-2 ml-6 space-y-2">
          {canale.presenti.map((persona) => (
            <div key={persona.identita} className="flex items-center gap-2 text-xs text-testo-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-black/75 transition-all duration-150 ${
                  parlanti?.has(persona.identita)
                    ? 'ring-2 ring-ok ring-offset-2 ring-offset-fondo-2'
                    : 'ring-0'
                }`}
                style={{ background: coloreDi(persona.identita) }}
              >
                {inizialiDi(persona.nome)}
              </span>
              <span className="min-w-0 flex-1 truncate">{persona.nome}</span>
              {!persona.microfono && (
                <span className="shrink-0 text-testo-3" title="Microfono spento">
                  <MicrofonoSpento className="h-3.5 w-3.5" />
                </span>
              )}
              {persona.schermi > 0 && (
                <span className="shrink-0 text-ok" title="Sta condividendo">
                  <SchermoCondividi className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ModuloCanale({
  tipo,
  crea,
  chiudi
}: {
  tipo: 'testo' | 'voce'
  crea: (dati: {
    nome: string
    tipo: 'testo' | 'voce'
    soloAscolto: boolean
    privato: boolean
  }) => Promise<void>
  chiudi: () => void
}): React.JSX.Element {
  const [nome, setNome] = useState('')
  const [palco, setPalco] = useState(false)
  const [privato, setPrivato] = useState(false)
  const [inCorso, setInCorso] = useState(false)

  const conferma = async (): Promise<void> => {
    if (!nome.trim()) return
    setInCorso(true)
    try {
      await crea({ nome: nome.trim(), tipo, soloAscolto: palco, privato })
    } finally {
      setInCorso(false)
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-bordo bg-fondo-2 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">
          Nuovo canale {tipo === 'voce' ? 'vocale' : 'di testo'}
        </h2>

        <Campo etichetta="Nome">
          <input
            className={classiInput}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void conferma()}
            placeholder={tipo === 'voce' ? 'Officina' : 'generale'}
            autoFocus
          />
        </Campo>

        {tipo === 'voce' && (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-vivo"
              checked={palco}
              onChange={(e) => setPalco(e.target.checked)}
            />
            <span>
              Canale da palco
              <span className="mt-0.5 block text-xs text-testo-3">
                Trasmettono solo gli admin, gli altri guardano e scrivono.
              </span>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-vivo"
            checked={privato}
            onChange={(e) => setPrivato(e.target.checked)}
          />
          <span>
            Privato
            <span className="mt-0.5 block text-xs text-testo-3">
              Lo vedono solo le persone che inviti: per tutti gli altri questo canale non esiste, ne'
              nell'elenco ne' cercando fra i messaggi. Chi amministra lo spazio lo vede comunque.
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Bottone tono="vivo" disabled={inCorso || !nome.trim()} onClick={() => void conferma()}>
            Crea
          </Bottone>
          <Bottone tono="fantasma" onClick={chiudi}>
            Annulla
          </Bottone>
        </div>
      </div>
    </div>
  )
}
