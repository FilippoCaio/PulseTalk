import { useEffect, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import { Ingranaggio } from './icone'
import { livelloMicrofono } from './lib/pubblica'
import { usaDispositivi } from './lib/usaDispositivi'

const CLASSI_SELECT =
  'w-full rounded-lg border border-bordo bg-fondo px-2 py-1.5 text-xs text-testo focus:border-vivo focus:outline-none'

/**
 * I controlli audio rapidi condivisi dalla barra della chiamata e dal
 * pannello dell'utente. Una sola implementazione evita che i due menu
 * finiscano per mostrare dispositivi o volumi diversi.
 */
export default function ControlliAudio({
  impostazioni,
  salva,
  apriImpostazioni
}: {
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  const { per } = usaDispositivi()
  const [livello, setLivello] = useState(0)

  useEffect(() => {
    let vivo = true
    let fotogramma = 0
    const giro = (): void => {
      if (!vivo) return
      setLivello(livelloMicrofono())
      fotogramma = requestAnimationFrame(giro)
    }
    fotogramma = requestAnimationFrame(giro)
    return () => {
      vivo = false
      cancelAnimationFrame(fotogramma)
    }
  }, [])

  // La radice quadrata rende leggibile la normale voce parlata, che su una
  // scala lineare resterebbe quasi sempre schiacciata contro il bordo.
  const percento = Math.min(100, (Math.sqrt(livello) / 0.6) * 100)

  return (
    <>
      <div>
        <Etichetta>Microfono</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.microfonoId ?? ''}
          onChange={(e) => salva({ microfonoId: e.target.value || null })}
        >
          <option value="">Predefinito di Windows</option>
          {per('audioinput').map((dispositivo) => (
            <option key={dispositivo.deviceId} value={dispositivo.deviceId}>
              {dispositivo.label || 'Microfono senza nome'}
            </option>
          ))}
        </select>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fondo-3">
          <div
            className="h-full rounded-full bg-ok transition-[width] duration-75"
            style={{ width: `${percento}%` }}
          />
        </div>
      </div>

      <div>
        <Etichetta>Altoparlante</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.altoparlanteId ?? ''}
          onChange={(e) => salva({ altoparlanteId: e.target.value || null })}
        >
          <option value="">Predefinito di Windows</option>
          {per('audiooutput').map((dispositivo) => (
            <option key={dispositivo.deviceId} value={dispositivo.deviceId}>
              {dispositivo.label || 'Uscita senza nome'}
            </option>
          ))}
        </select>
      </div>

      <Cursore
        nome="Entrata"
        valore={impostazioni.volumeMicrofono ?? 1}
        massimo={2}
        cambia={(volumeMicrofono) => salva({ volumeMicrofono })}
      />
      <Cursore
        nome="Uscita"
        valore={impostazioni.volumeUscita ?? 1}
        massimo={1}
        cambia={(volumeUscita) => salva({ volumeUscita })}
      />

      <button
        onClick={apriImpostazioni}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-testo-2 hover:bg-fondo-3 hover:text-testo"
      >
        <Ingranaggio className="h-3.5 w-3.5" />
        Tutte le impostazioni audio
      </button>
    </>
  )
}

function Etichetta({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="mb-1 block text-[11px] tracking-wide text-testo-3 uppercase">{children}</span>
  )
}

function Cursore({
  nome,
  valore,
  massimo,
  cambia
}: {
  nome: string
  valore: number
  massimo: number
  cambia: (valore: number) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <Etichetta>{nome}</Etichetta>
        <span className="numeri text-[11px] text-testo-3">{Math.round(valore * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={massimo}
        step={0.05}
        value={valore}
        onChange={(e) => cambia(Number(e.target.value))}
        className="w-full"
        aria-label={nome}
      />
    </div>
  )
}
