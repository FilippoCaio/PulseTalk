import { useRef, useState } from 'react'
import type { Allegato, Canale, Messaggio } from '@shared/tipi'
import type { Api } from '../lib/api'
import { Avviso } from '../ui'
import { Chiudi, Graffetta } from '../icone'

/**
 * Dove si scrive.
 *
 * Gli allegati partono **prima** del messaggio: si trascina un'immagine, il
 * caricamento comincia subito, e intanto si finisce la frase. Al momento
 * dell'invio restano da mandare solo gli id — che e' anche il motivo per cui
 * premere Invio con una foto da dieci megabyte non fa aspettare nessuno.
 */
export default function Compositore({
  api,
  canale,
  rispondiA,
  profili,
  annullaRisposta,
  manda
}: {
  api: Api
  canale: Canale
  rispondiA: Messaggio | null
  profili: Map<number, { nome: string; avatar: string | null }>
  annullaRisposta: () => void
  manda: (dati: { testo?: string; allegati?: number[] }) => Promise<void>
}): React.JSX.Element {
  const [testo, setTesto] = useState('')
  const [allegati, setAllegati] = useState<Allegato[]>([])
  const [inCaricamento, setInCaricamento] = useState(0)
  const [errore, setErrore] = useState<string | null>(null)
  const [sopra, setSopra] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const carica = async (scelti: FileList | File[]): Promise<void> => {
    setErrore(null)
    for (const scelto of Array.from(scelti)) {
      setInCaricamento((n) => n + 1)
      try {
        const allegato = await api.carica(scelto)
        setAllegati((prima) => [...prima, allegato])
      } catch (e) {
        setErrore(`${scelto.name}: ${(e as Error).message}`)
      } finally {
        setInCaricamento((n) => n - 1)
      }
    }
  }

  const invia = async (): Promise<void> => {
    const pulito = testo.trim()
    if (!pulito && allegati.length === 0) return
    if (inCaricamento > 0) return

    // Si svuota subito: se l'invio fallisce l'errore compare, ma il campo
    // vuoto e' cio' che ci si aspetta dopo aver premuto Invio.
    setTesto('')
    const daMandare = allegati
    setAllegati([])

    try {
      await manda({ testo: pulito, allegati: daMandare.map((a) => a.id) })
    } catch (e) {
      setErrore((e as Error).message)
      setTesto(pulito)
      setAllegati(daMandare)
    }
  }

  return (
    <div
      className="border-t border-bordo p-3"
      onDragOver={(e) => {
        e.preventDefault()
        setSopra(true)
      }}
      onDragLeave={() => setSopra(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSopra(false)
        if (e.dataTransfer.files.length) void carica(e.dataTransfer.files)
      }}
    >
      {rispondiA && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-fondo-2 px-3 py-1.5 text-xs">
          <span className="text-testo-3">rispondi a</span>
          <span className="text-testo-2">{profili.get(rispondiA.autore)?.nome ?? 'qualcuno'}</span>
          <span className="min-w-0 flex-1 truncate text-testo-3">{rispondiA.testo.slice(0, 80)}</span>
          <button
            onClick={annullaRisposta}
            title="Non rispondere piu' a questo messaggio"
            aria-label="Annulla la risposta"
            className="shrink-0 text-testo-3 hover:text-testo"
          >
            <Chiudi className="h-4 w-4" />
          </button>
        </div>
      )}

      {errore && (
        <div className="mb-2">
          <Avviso>{errore}</Avviso>
        </div>
      )}

      {(allegati.length > 0 || inCaricamento > 0) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {allegati.map((allegato) => (
            <span
              key={allegato.id}
              className="flex items-center gap-2 rounded-lg border border-bordo bg-fondo-2 px-2.5 py-1 text-xs"
            >
              <span className="max-w-40 truncate">{allegato.nome}</span>
              <button
                onClick={() => setAllegati((prima) => prima.filter((a) => a.id !== allegato.id))}
                title={`Togli ${allegato.nome}`}
                aria-label={`Togli ${allegato.nome}`}
                className="text-testo-3 hover:text-male"
              >
                <Chiudi className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {inCaricamento > 0 && (
            <span className="respiro rounded-lg border border-bordo px-2.5 py-1 text-xs text-testo-3">
              carico {inCaricamento}…
            </span>
          )}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-xl border bg-fondo px-3 py-2 transition-colors ${
          sopra ? 'border-vivo' : 'border-bordo focus-within:border-fondo-3'
        }`}
      >
        <input
          ref={file}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void carica(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => file.current?.click()}
          title="Allega un file"
          aria-label="Allega un file"
          className="shrink-0 pb-1 text-testo-3 hover:text-testo"
        >
          <Graffetta className="h-5 w-5" />
        </button>

        <textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onPaste={(e) => {
            // Incollare uno screenshot deve funzionare come trascinarlo: e'
            // il modo in cui la meta' delle immagini finisce in una chat.
            const immagini = Array.from(e.clipboardData.files)
            if (immagini.length) {
              e.preventDefault()
              void carica(immagini)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void invia()
            }
          }}
          rows={1}
          placeholder={`Scrivi in #${canale.nome}`}
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-testo-3"
          style={{ height: 'auto' }}
          onInput={(e) => {
            // Il campo cresce con il testo, fino a un tetto: scrivere un
            // paragrafo in una riga alta ventidue pixel e' scomodo, e un
            // campo che occupa mezzo schermo lo e' altrettanto.
            const elemento = e.currentTarget
            elemento.style.height = 'auto'
            elemento.style.height = `${Math.min(elemento.scrollHeight, 160)}px`
          }}
        />
      </div>

      <p className="mt-1 px-1 text-[11px] text-testo-3">
        Invio per mandare, Maiusc+Invio per andare a capo. Trascina o incolla un file per allegarlo.
      </p>
    </div>
  )
}
