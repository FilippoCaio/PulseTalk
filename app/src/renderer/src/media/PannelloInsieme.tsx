import { useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import type { Api } from '../lib/api'
import type { SessioniMedia } from '../lib/usaSessioniMedia'
import { Avviso, Bottone } from '../ui'
import { Nota, Video } from '../icone'
import GuardaInsieme from './GuardaInsieme'
import SessioneMusica from './SessioneMusica'

/**
 * Il pannello delle cose da fare insieme, con dentro due schede.
 *
 * Le due sessioni — un video di YouTube e una coda musicale — hanno la stessa
 * ossatura e lo stesso posto sullo schermo, quindi stanno sotto lo stesso
 * pulsante. Cambia cosa suona, non come si arriva a farlo partire.
 *
 * Cio' che non cambia mai, ed e' il punto: **niente di quello che si guarda o
 * si ascolta passa da PulseTalk**. Ogni computer riproduce per conto suo con la
 * propria linea, e da qui viaggia solo lo stato — cosa, se va, e da che punto.
 */
export default function PannelloInsieme({
  api,
  media,
  impostazioni,
  salva,
  puoCondividere,
  chiudi
}: {
  api: Api
  media: SessioniMedia
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  /** Chi non puo' condividere entra, guarda e accoda: non comanda. */
  puoCondividere: boolean
  chiudi: () => void
}): React.JSX.Element {
  const video = media.sessioni.find((s) => s.tipo === 'youtube') ?? null
  const musica = media.sessioni.find((s) => s.tipo === 'musica') ?? null

  // La scheda aperta segue cio' che c'e': entrando a meta' si trova aperta la
  // sessione che gli altri stanno gia' usando, invece di una schermata vuota
  // che sembra dire "non sta succedendo niente".
  const [scheda, setScheda] = useState<'youtube' | 'musica'>(
    video ? 'youtube' : musica ? 'musica' : 'youtube'
  )

  const attiva = scheda === 'youtube' ? video : musica

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-bordo">
        {(
          [
            ['youtube', 'Guarda insieme', Video, !!video],
            ['musica', 'Ascolta insieme', Nota, !!musica]
          ] as const
        ).map(([id, nome, Icona, accesa]) => (
          <button
            key={id}
            onClick={() => setScheda(id)}
            className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              scheda === id
                ? 'border-vivo text-testo'
                : 'border-transparent text-testo-3 hover:text-testo'
            }`}
          >
            <Icona className="h-4 w-4" />
            {nome}
            {accesa && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {media.errore && <Avviso>{media.errore}</Avviso>}

        {!attiva ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            {scheda === 'youtube' ? (
              <>
                <Video className="h-8 w-8 text-testo-3" />
                <p className="text-sm text-testo-2">Guardate un video di YouTube insieme.</p>
                <p className="text-xs leading-relaxed text-testo-3">
                  Il video non viene ritrasmesso da nessuno: ognuno lo scarica per conto suo, con la
                  propria linea e la propria qualita'. PulseTalk tiene solo il punto in cui siete —
                  play, pausa e salti arrivano a tutti.
                </p>
              </>
            ) : (
              <>
                <Nota className="h-8 w-8 text-testo-3" />
                <p className="text-sm text-testo-2">Una coda musicale condivisa.</p>
                <p className="text-xs leading-relaxed text-testo-3">
                  La coda e' di PulseTalk e la riempite in tanti. A suonare e' il vostro Spotify, uno
                  per uno, attraverso l'API ufficiale: serve collegare l'account, e i comandi di
                  riproduzione richiedono Premium.
                </p>
              </>
            )}

            {puoCondividere ? (
              <Bottone
                tono="vivo"
                onClick={() => void media.apri(scheda, scheda === 'musica' ? 'spotify' : undefined)}
              >
                Apri la sessione
              </Bottone>
            ) : (
              <p className="text-xs text-testo-3">
                Aprirla e' di chi ha il permesso di condividere in questo canale.
              </p>
            )}
          </div>
        ) : scheda === 'youtube' ? (
          <GuardaInsieme
            sessione={attiva}
            media={media}
            puoComandare={media.puoComandare && puoCondividere}
            chiudi={() => void media.chiudi(attiva.id)}
          />
        ) : (
          <SessioneMusica
            api={api}
            sessione={attiva}
            media={media}
            puoComandare={media.puoComandare && puoCondividere}
            impostazioni={impostazioni}
            salva={salva}
            chiudi={() => void media.chiudi(attiva.id)}
          />
        )}
      </div>

      <button
        onClick={chiudi}
        className="shrink-0 border-t border-bordo px-3 py-2 text-xs text-testo-3 hover:text-testo"
      >
        Nascondi questo pannello
      </button>
    </div>
  )
}
