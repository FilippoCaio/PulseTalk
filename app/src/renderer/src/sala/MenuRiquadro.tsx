import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Riquadro as Dati } from '../lib/usaSessione'
import { PannelloVolume, type VoceVolume } from './Volume'
import {
  Altoparlante,
  AltoparlanteMuto,
  Espelli,
  Ingrandisci,
  Lente,
  Rimpicciolisci,
  SchermoIntero,
  SchermoNormale
} from '../icone'

/** Quanto stare lontani dal bordo della finestra. */
const MARGINE = 8

/**
 * Il menu del tasto destro su un riquadro.
 *
 * Le stesse cose che stanno gia' sparse fra il fumetto dell'altoparlante, le
 * iconcine in alto a destra e la colonna delle persone — ma tutte insieme,
 * dove le sta cercando la mano, sul riquadro che si sta guardando. E' l'unico
 * gesto che nessuno deve imparare: dove c'e' roba, tasto destro.
 */
export default function MenuRiquadro({
  x,
  y,
  dati,
  voci,
  aFuoco,
  moderatore,
  metti,
  schermoIntero,
  caccia,
  qualita,
  chiudi
}: {
  x: number
  y: number
  dati: Dati
  voci: VoceVolume[]
  aFuoco: boolean
  moderatore: boolean
  /** Mette a fuoco, o toglie dal fuoco se ci sta gia'. */
  metti: () => void
  /** Solo sul riquadro grande: il vero schermo intero. */
  schermoIntero?: { attivo: boolean; alterna: () => void }
  caccia?: () => Promise<void>
  /**
   * Solo sulla PROPRIA condivisione: cambiare qualita' mentre e' accesa.
   *
   * Il cambio non interrompe niente — bitrate e fotogrammi si riscrivono sul
   * mittente vivo — quindi si puo' alzare la qualita' a meta' partita senza
   * sparire per un secondo dagli schermi degli altri.
   */
  qualita?: {
    scelte: { id: string; nome: string; spiegazione: string }[]
    attuale: string | null
    cambia: (id: string) => void
  }
  chiudi: () => void
}): React.JSX.Element {
  const scatola = useRef<HTMLDivElement>(null)
  const [posto, setPosto] = useState({ sinistra: x, alto: y, pronto: false })

  // Prima si misura, poi si mostra: aperto vicino al bordo destro il menu
  // uscirebbe dalla finestra, e in una finestra senza barra di scorrimento
  // quello che esce non torna piu'.
  useLayoutEffect(() => {
    const e = scatola.current
    if (!e) return
    const { width, height } = e.getBoundingClientRect()
    setPosto({
      sinistra: Math.min(x, window.innerWidth - width - MARGINE),
      alto: Math.min(y, window.innerHeight - height - MARGINE),
      pronto: true
    })
  }, [x, y])

  // Si chiude con Escape, col clic fuori, e anche col tasto destro fuori:
  // aprirne due insieme e' un modo sicuro di lasciarne uno orfano a mezz'aria.
  useEffect(() => {
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') chiudi()
    }
    const fuori = (e: MouseEvent): void => {
      if (!scatola.current?.contains(e.target as Node)) chiudi()
    }
    window.addEventListener('keydown', tasto)
    window.addEventListener('mousedown', fuori)
    window.addEventListener('contextmenu', fuori)
    window.addEventListener('blur', chiudi)
    return () => {
      window.removeEventListener('keydown', tasto)
      window.removeEventListener('mousedown', fuori)
      window.removeEventListener('contextmenu', fuori)
      window.removeEventListener('blur', chiudi)
    }
  }, [chiudi])

  const zittito = voci.length > 0 && voci.every((v) => v.muto)
  const cosa = dati.tipo === 'schermo' ? 'lo schermo' : 'la voce'

  return (
    <div
      ref={scatola}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className={`fixed z-50 w-56 rounded-xl border border-bordo bg-fondo-2 p-2 shadow-xl shadow-black/40 ${
        posto.pronto ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left: posto.sinistra, top: posto.alto }}
    >
      <div className="truncate px-1.5 pt-0.5 pb-2 text-xs font-semibold text-testo-2">
        {dati.nome}
        {dati.tipo === 'schermo' && (
          <span className="font-normal text-testo-3"> · {dati.etichetta}</span>
        )}
      </div>

      {voci.length > 0 && (
        <>
          <div className="px-1.5 pb-2">
            <PannelloVolume voci={voci} />
          </div>
          <Riga
            icona={zittito ? <AltoparlanteMuto /> : <Altoparlante />}
            testo={zittito ? `Riattiva ${cosa}` : `Zittisci ${cosa}`}
            fai={() => {
              // Con due cursori (voce e schermo) si zittisce tutto insieme:
              // singolarmente si fa gia' dai pulsanti qui sopra.
              for (const v of voci) if (v.muto === zittito) v.alternaMuto()
              chiudi()
            }}
          />
          <div className="my-1 border-t border-bordo" />
        </>
      )}

      <Riga
        icona={aFuoco ? <Rimpicciolisci /> : <Ingrandisci />}
        testo={aFuoco ? 'Togli dal primo piano' : 'Metti in primo piano'}
        fai={() => {
          metti()
          chiudi()
        }}
      />

      {schermoIntero && (
        <Riga
          icona={schermoIntero.attivo ? <SchermoNormale /> : <SchermoIntero />}
          testo={schermoIntero.attivo ? 'Esci da schermo intero' : 'A tutto schermo'}
          fai={() => {
            schermoIntero.alterna()
            chiudi()
          }}
        />
      )}

      {qualita && qualita.scelte.length > 0 && (
        <>
          <div className="my-1 border-t border-bordo" />
          <div className="px-1.5 pt-0.5 pb-1 text-[11px] uppercase tracking-wide text-testo-3">
            Qualita' della condivisione
          </div>
          {qualita.scelte.map((scelta) => (
            <Riga
              key={scelta.id}
              icona={<Lente />}
              testo={scelta.nome + (scelta.id === qualita.attuale ? ' ·' : '')}
              fai={() => {
                qualita.cambia(scelta.id)
                chiudi()
              }}
            />
          ))}
        </>
      )}

      {moderatore && caccia && !dati.locale && (
        <>
          <div className="my-1 border-t border-bordo" />
          <Riga
            icona={<Espelli />}
            testo="Espelli dal canale"
            pericolo
            fai={() => {
              void caccia()
              chiudi()
            }}
          />
        </>
      )}
    </div>
  )
}

function Riga({
  icona,
  testo,
  fai,
  pericolo = false
}: {
  icona: React.ReactNode
  testo: string
  fai: () => void
  pericolo?: boolean
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      onClick={fai}
      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors ${
        pericolo ? 'text-male hover:bg-male/10' : 'text-testo-2 hover:bg-fondo-3 hover:text-testo-1'
      }`}
    >
      <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icona}</span>
      <span className="truncate">{testo}</span>
    </button>
  )
}
