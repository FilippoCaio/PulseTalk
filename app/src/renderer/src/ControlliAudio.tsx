import { useEffect, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import { Ingranaggio } from './icone'
import { livelloMicrofono } from './lib/pubblica'
import { scegli, usaDispositivi, vociTendina } from './lib/usaDispositivi'

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
  apriImpostazioni,
  lato = 'tutto'
}: {
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
  /**
   * Quale meta' mostrare: cio' che entra, cio' che esce, o tutto.
   *
   * Nasce dal pannello in basso a sinistra, dove il microfono e le cuffie sono
   * due pulsanti distinti e ognuno apre la sua tendina. Prima la freccetta del
   * microfono apriva anche altoparlante e volume di uscita: due comandi
   * separati che portavano allo stesso posto, e per cambiare l'altoparlante si
   * finiva sotto al microfono, che e' l'ultimo posto in cui uno lo cerca.
   *
   * `tutto` resta il valore di serie perche' la barra della chiamata ha un
   * pulsante solo, e li' dividere vorrebbe dire nasconderne meta'.
   */
  lato?: 'entrata' | 'uscita' | 'tutto'
}): React.JSX.Element {
  const { tutti } = usaDispositivi()
  const [livello, setLivello] = useState(0)

  const conEntrata = lato !== 'uscita'
  const conUscita = lato !== 'entrata'

  useEffect(() => {
    // Il misuratore gira a ogni fotogramma: senza il microfono in vista non
    // c'e' niente da misurare, e tenerlo acceso sarebbe un ciclo di animazione
    // per disegnare una barretta che non c'e'.
    if (!conEntrata) return
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
  }, [conEntrata])

  // La radice quadrata rende leggibile la normale voce parlata, che su una
  // scala lineare resterebbe quasi sempre schiacciata contro il bordo.
  const percento = Math.min(100, (Math.sqrt(livello) / 0.6) * 100)

  return (
    <>
      {conEntrata && (
      <div>
        <Etichetta>Microfono</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.microfonoId ?? ''}
          onChange={(e) => salva(scegli('microfono', tutti, e.target.value))}
        >
          <option value="">Predefinito di Windows</option>
          {vociTendina('microfono', tutti, impostazioni).map((voce) => (
            <option key={voce.id} value={voce.id} disabled={voce.assente}>
              {voce.nome}
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
      )}

      {conUscita && (
      <div>
        <Etichetta>Altoparlante</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.altoparlanteId ?? ''}
          onChange={(e) => salva(scegli('altoparlante', tutti, e.target.value))}
        >
          <option value="">Predefinito di Windows</option>
          {vociTendina('altoparlante', tutti, impostazioni).map((voce) => (
            <option key={voce.id} value={voce.id} disabled={voce.assente}>
              {voce.nome}
            </option>
          ))}
        </select>
      </div>
      )}

      {conEntrata && (
      <Cursore
        nome="Entrata"
        valore={impostazioni.volumeMicrofono ?? 1}
        massimo={2}
        cambia={(volumeMicrofono) => salva({ volumeMicrofono })}
      />
      )}

      {conUscita && (
      <Cursore
        nome="Uscita"
        valore={impostazioni.volumeUscita ?? 1}
        massimo={1}
        cambia={(volumeUscita) => salva({ volumeUscita })}
      />
      )}

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
