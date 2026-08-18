import { useEffect, useRef, useState } from 'react'
import { Altoparlante, AltoparlanteMuto } from '../icone'

/**
 * Il volume di qualcuno, o di tutti.
 *
 * Lo stesso pezzo serve in tre posti — sopra a un riquadro, nella colonna delle
 * persone, e nella barra per il volume generale — e in due di questi tre e'
 * dentro a un fumetto che si apre. Da qui escono le due forme: il pannello nudo
 * e il pulsante che lo apre.
 *
 * Il muto e' un pulsante separato dal cursore, e non il cursore a zero. Chi
 * zittisce qualcuno per due minuti vuole ritrovarlo dov'era, e muovere il
 * cursore di uno zittito lo riaccende — perche' e' quello che uno intende
 * facendolo.
 *
 * Il massimo e' cento e non duecento. Il volume di un <audio> vive fra 0 e 1, e
 * un valore piu' alto non viene ignorato: solleva un'eccezione. Amplificare
 * davvero vorrebbe dire far passare ogni voce dentro a un AudioContext, e la
 * cancellazione dell'eco di Chrome funziona peggio quando il suono non esce da
 * un elemento normale. Meglio un cursore che dice la verita' su quello che fa.
 */

export interface VoceVolume {
  chiave: string
  /** Cosa si sta regolando: "voce", "schermo", "tutti". */
  nome: string
  volume: number
  muto: boolean
  cambia: (volume: number) => void
  alternaMuto: () => void
}

export function PannelloVolume({ voci }: { voci: VoceVolume[] }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {voci.map((voce) => (
        <div key={voce.chiave} className="flex items-center gap-1.5">
          <button
            onClick={voce.alternaMuto}
            title={voce.muto ? `Riattiva: ${voce.nome}` : `Zittisci: ${voce.nome}`}
            aria-label={voce.muto ? `Riattiva: ${voce.nome}` : `Zittisci: ${voce.nome}`}
            className={`shrink-0 rounded p-1 transition-colors ${
              voce.muto ? 'text-male hover:bg-male/15' : 'text-testo-3 hover:bg-fondo-3 hover:text-testo'
            }`}
          >
            {voce.muto ? (
              <AltoparlanteMuto className="h-4 w-4" />
            ) : (
              <Altoparlante className="h-4 w-4" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={voce.volume}
            onChange={(e) => voce.cambia(Number(e.target.value))}
            title={voce.nome}
            aria-label={voce.nome}
            className={`h-1 min-w-0 flex-1 accent-vivo ${voce.muto ? 'opacity-40' : ''}`}
          />

          <span
            className={`numeri w-9 shrink-0 text-right text-[11px] ${
              voce.muto ? 'text-male' : 'text-testo-3'
            }`}
          >
            {voce.muto ? 'muto' : `${Math.round(voce.volume * 100)}%`}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Il pulsante con l'altoparlante, e il pannello che gli si apre accanto.
 *
 * Il fumetto si chiude cliccando fuori o con Esc, e ferma i clic che lo
 * attraversano: dentro a un riquadro, un clic che arrivasse fino in fondo
 * metterebbe a fuoco la persona invece di spostarne il volume.
 */
export function BottoneVolume({
  voci,
  titolo,
  verso = 'sopra',
  variante = 'barra',
  className = ''
}: {
  voci: VoceVolume[]
  titolo: string
  verso?: 'sopra' | 'sotto'
  /** Sulla barra e' un pulsante come gli altri; sopra a un video e' un vetro scuro. */
  variante?: 'barra' | 'riquadro'
  className?: string
}): React.JSX.Element {
  const [aperto, setAperto] = useState(false)
  const contenitore = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aperto) return
    const fuori = (evento: PointerEvent): void => {
      if (!contenitore.current?.contains(evento.target as Node)) setAperto(false)
    }
    const tasto = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return
      // Fermato qui: altrimenti lo stesso Esc toglierebbe anche il fuoco al
      // riquadro sotto, e si perderebbero due cose con un tasto solo.
      evento.stopPropagation()
      setAperto(false)
    }
    document.addEventListener('pointerdown', fuori)
    document.addEventListener('keydown', tasto, true)
    return () => {
      document.removeEventListener('pointerdown', fuori)
      document.removeEventListener('keydown', tasto, true)
    }
  }, [aperto])

  const tuttoMuto = voci.every((v) => v.muto || v.volume === 0)

  return (
    <div
      ref={contenitore}
      className={`relative ${className}`}
      onClick={(evento) => evento.stopPropagation()}
    >
      <button
        onClick={() => setAperto(!aperto)}
        title={titolo}
        aria-label={titolo}
        className={
          variante === 'riquadro'
            ? `inline-flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors ${
                tuttoMuto
                  ? 'bg-male/70 text-white hover:bg-male/85'
                  : aperto
                    ? 'bg-black/85 text-white'
                    : 'bg-black/55 text-white/85 hover:bg-black/80 hover:text-white'
              }`
            : `inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                tuttoMuto
                  ? 'border-male/30 bg-male/15 text-male hover:bg-male/25'
                  : aperto
                    ? 'border-bordo bg-bordo text-testo'
                    : 'border-bordo bg-fondo-3 text-testo hover:bg-bordo'
              }`
        }
      >
        {tuttoMuto ? (
          <AltoparlanteMuto className={variante === 'riquadro' ? 'h-4 w-4' : undefined} />
        ) : (
          <Altoparlante className={variante === 'riquadro' ? 'h-4 w-4' : undefined} />
        )}
      </button>

      {aperto && (
        <div
          className={`absolute right-0 z-30 rounded-xl border border-bordo bg-fondo-2 p-2.5 shadow-2xl ${
            // Sopra a un riquadro il fumetto e' piu' stretto: il riquadro ha
            // gli angoli tondi e taglia via quello che ne esce, e in una
            // griglia affollata un riquadro puo' essere largo poco piu' di
            // duecento pixel.
            variante === 'riquadro' ? 'w-44' : 'w-56'
          } ${verso === 'sopra' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <PannelloVolume voci={voci} />
        </div>
      )}
    </div>
  )
}
