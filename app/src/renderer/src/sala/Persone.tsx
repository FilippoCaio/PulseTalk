import { useState } from 'react'
import { ConnectionQuality } from 'livekit-client'
import type { Persona, SorgenteAudio, Volumi } from '../lib/usaSessione'
import { Pallino } from '../ui'
import {
  Altoparlante,
  AltoparlanteMuto,
  Camera,
  Espelli,
  MicrofonoSpento,
  SchermoCondividi,
  Stella
} from '../icone'
import { PannelloVolume, type VoceVolume } from './Volume'

const COLORE_QUALITA: Record<string, string> = {
  [ConnectionQuality.Excellent]: 'var(--color-ok)',
  [ConnectionQuality.Good]: 'var(--color-ok)',
  [ConnectionQuality.Poor]: 'var(--color-attenzione)',
  [ConnectionQuality.Lost]: 'var(--color-male)',
  [ConnectionQuality.Unknown]: 'var(--color-testo-3)'
}

/**
 * Chi c'e', e a che volume.
 *
 * I cursori sono per persona e non globali: quando uno ha il microfono troppo
 * alto, la soluzione non e' abbassare tutti. E sono due, quando serve — la voce
 * e cio' che esce dallo schermo che sta condividendo — perche' il gioco piu'
 * forte di chi lo commenta e' il caso di tutti i giorni.
 */
export default function Persone({
  persone,
  moderatore,
  volumiDi,
  impostaVolume,
  alternaMuto,
  caccia
}: {
  persone: Persona[]
  moderatore: boolean
  volumiDi: (identita: string) => Volumi
  impostaVolume: (identita: string, sorgente: SorgenteAudio, volume: number) => void
  alternaMuto: (identita: string, sorgente: SorgenteAudio) => void
  caccia: (identita: string) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="space-y-0.5 p-2">
      {persone.map((persona) => (
        <Riga
          key={persona.identita}
          persona={persona}
          moderatore={moderatore}
          volumi={volumiDi(persona.identita)}
          impostaVolume={impostaVolume}
          alternaMuto={alternaMuto}
          caccia={caccia}
        />
      ))}
    </div>
  )
}

function Riga({
  persona,
  moderatore,
  volumi,
  impostaVolume,
  alternaMuto,
  caccia
}: {
  persona: Persona
  moderatore: boolean
  volumi: Volumi
  impostaVolume: (identita: string, sorgente: SorgenteAudio, volume: number) => void
  alternaMuto: (identita: string, sorgente: SorgenteAudio) => void
  caccia: (identita: string) => Promise<void>
}): React.JSX.Element {
  const [aperta, setAperta] = useState(false)

  const zittito = volumi.mutoVoce || (persona.schermi > 0 && volumi.mutoSchermo)

  const voci: VoceVolume[] = [
    {
      chiave: 'voce',
      nome: 'voce',
      volume: volumi.voce,
      muto: volumi.mutoVoce,
      cambia: (v) => impostaVolume(persona.identita, 'voce', v),
      alternaMuto: () => alternaMuto(persona.identita, 'voce')
    }
  ]

  // Il secondo cursore compare solo se c'e' un secondo suono da regolare.
  if (persona.schermi > 0) {
    voci.push({
      chiave: 'schermo',
      nome: 'schermo',
      volume: volumi.schermo,
      muto: volumi.mutoSchermo,
      cambia: (v) => impostaVolume(persona.identita, 'schermo', v),
      alternaMuto: () => alternaMuto(persona.identita, 'schermo')
    })
  }

  return (
    <div
      className={`rounded-lg px-2.5 py-2 transition-colors ${
        persona.parla ? 'bg-ok/10' : 'hover:bg-fondo-3'
      }`}
    >
      <div className="flex items-center gap-2">
        <Pallino colore={COLORE_QUALITA[persona.qualita] ?? 'var(--color-testo-3)'} />

        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm">
          {persona.moderatore && (
            <span title="Modera" className="shrink-0 text-attenzione">
              <Stella className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate">
            {persona.nome}
            {persona.locale && <span className="text-testo-3"> (tu)</span>}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1 text-testo-3">
          {!persona.microfonoAcceso && (
            <span title="Microfono spento">
              <MicrofonoSpento className="h-3.5 w-3.5" />
            </span>
          )}
          {persona.camera && (
            <span title="Camera accesa" className="text-testo-2">
              <Camera className="h-3.5 w-3.5" />
            </span>
          )}
          {persona.schermi > 0 && (
            <span
              title={persona.schermi > 1 ? `${persona.schermi} schermi condivisi` : 'Schermo condiviso'}
              className="text-ok"
            >
              <SchermoCondividi className="h-3.5 w-3.5" />
            </span>
          )}
        </span>

        {!persona.locale && (
          <button
            onClick={() => setAperta(!aperta)}
            title="Volume e moderazione"
            aria-label="Volume e moderazione"
            aria-expanded={aperta}
            className={`shrink-0 rounded p-1 transition-colors ${
              zittito ? 'text-male hover:bg-male/15' : 'text-testo-3 hover:bg-bordo hover:text-testo'
            }`}
          >
            {zittito ? (
              <AltoparlanteMuto className="h-4 w-4" />
            ) : (
              <Altoparlante className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {aperta && !persona.locale && (
        <div className="mt-2 space-y-2 pl-3.5">
          <PannelloVolume voci={voci} />

          {moderatore && (
            <button
              onClick={() => void caccia(persona.identita)}
              title={`Caccia ${persona.nome} dalla stanza`}
              aria-label={`Caccia ${persona.nome} dalla stanza`}
              className="rounded p-1 text-male hover:bg-male/15"
            >
              <Espelli className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
