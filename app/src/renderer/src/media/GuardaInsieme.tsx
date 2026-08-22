import { useState } from 'react'
import type { SessioneMedia } from '@shared/tipi'
import type { ComandoMedia, SessioniMedia } from '../lib/usaSessioniMedia'
import { idDaUrl, secondiDaUrl } from '../lib/youtube'
import { Avviso, Bottone, classiInput } from '../ui'
import { Avanti, Cestino, Chiudi, Pausa, Play, Riavvolgi } from '../icone'

/**
 * Guardare un video di YouTube insieme.
 *
 * La regola che tiene in piedi tutto: **il video non passa da PulseTalk**. Ogni
 * computer lo scarica dal player ufficiale con la propria linea, e da qui
 * viaggia solo lo stato — quale video, se va, a che secondo, e da quando quel
 * secondo era vero. E' il motivo per cui questa funzione si puo' tenere accesa
 * in cinque senza che nessuno debba reggere la banda degli altri.
 *
 * La sincronizzazione ha tre regole, e sono tutte per lo stesso motivo — non
 * far tremare la riproduzione di chi sta guardando:
 *
 *   **Si corregge solo sopra soglia.** Sotto un secondo e mezzo di scarto non
 *   si tocca niente. Inseguire il millisecondo vorrebbe dire un salto ogni due
 *   secondi, e un video che salta e' peggio di un video mezzo secondo indietro.
 *
 *   **Il tempo lo tiene il server.** La posizione attesa e' una sottrazione
 *   fatta sull'orologio del server (vedi usaSessioniMedia). Chi ha il computer
 *   avanti di tre secondi non trascina dietro gli altri.
 *
 *   **Cio' che arriva non rimbalza.** Mentre si applica uno stato remoto, gli
 *   eventi del player sono ignorati: senza, una pausa ricevuta genererebbe un
 *   comando di pausa verso il server, che tornerebbe indietro a tutti.
 */

export default function GuardaInsieme({
  sessione,
  media,
  puoComandare,
  chiudi
}: {
  sessione: SessioneMedia
  media: SessioniMedia
  puoComandare: boolean
  chiudi: () => void
}): React.JSX.Element {
  const [errore, setErrore] = useState<string | null>(null)
  const [incolla, setIncolla] = useState('')

  const stato = sessione.stato
  const riferimento = stato.riferimento ?? null

  const comanda = (comando: ComandoMedia): void => void media.comanda(sessione.id, comando)

  const metti = (): void => {
    const id = idDaUrl(incolla)
    if (!id) {
      setErrore('Non riconosco questo indirizzo di YouTube.')
      return
    }
    setErrore(null)
    setIncolla('')
    comanda({
      azione: 'cambia',
      riferimento: id,
      posizioneMs: secondiDaUrl(incolla) * 1000
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="rounded-xl border border-bordo bg-fondo-2 p-3 text-sm text-testo-2">
        {riferimento ? (
          <p>Il video e' aperto come riquadro condiviso nella chiamata.</p>
        ) : (
          <p>Incolla un indirizzo di YouTube: il video comparira' nella chiamata come una condivisione.</p>
        )}
      </div>

      {errore && <Avviso tono="attenzione">{errore}</Avviso>}
      {media.errore && <Avviso>{media.errore}</Avviso>}

      <div className="flex flex-wrap items-center gap-2">
        {puoComandare ? (
          <>
            <Bottone
              tono={stato.inRiproduzione ? 'normale' : 'vivo'}
              onClick={() => comanda({ azione: stato.inRiproduzione ? 'pausa' : 'play' })}
              disabled={!riferimento}
            >
              {stato.inRiproduzione ? <Pausa className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {stato.inRiproduzione ? 'Pausa' : 'Riprendi'}
            </Bottone>

            <Bottone tono="fantasma" onClick={() => comanda({ azione: 'riparti' })} disabled={!riferimento}>
              <Riavvolgi className="h-4 w-4" />
              Da capo
            </Bottone>

            {sessione.coda.length > 0 && (
              <Bottone tono="fantasma" onClick={() => comanda({ azione: 'prossimo' })}>
                <Avanti className="h-4 w-4" />
                Prossimo
              </Bottone>
            )}
          </>
        ) : (
          <span className="text-xs text-testo-3">
            Qui puoi guardare: i comandi sono di chi ha il permesso di condividere.
          </span>
        )}

        <span className="flex-1" />

        <Bottone tono="fantasma" className="py-1 text-xs" onClick={chiudi}>
          <Chiudi className="h-3.5 w-3.5" />
          Chiudi la sessione
        </Bottone>
      </div>

      <div className="flex gap-2">
        <input
          className={classiInput}
          value={incolla}
          onChange={(e) => setIncolla(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && metti()}
          placeholder="Incolla un indirizzo di YouTube"
        />
        <Bottone tono="vivo" disabled={!incolla.trim() || !puoComandare} onClick={metti}>
          Metti
        </Bottone>
        <Bottone
          tono="normale"
          disabled={!incolla.trim()}
          onClick={() => {
            const id = idDaUrl(incolla)
            if (!id) return setErrore('Non riconosco questo indirizzo di YouTube.')
            setErrore(null)
            setIncolla('')
            void media.accoda(sessione.id, { riferimento: id })
          }}
          title="In coda: parte quando finisce quello di adesso"
        >
          In coda
        </Bottone>
      </div>

      {sessione.coda.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-bordo bg-fondo-2 p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
            In coda ({sessione.coda.filter((v) => !v.suonato).length})
          </p>
          {sessione.coda.map((voce) => (
            <div
              key={voce.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-fondo-3/50 ${
                voce.suonato ? 'text-testo-3 line-through' : 'text-testo-2'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{voce.titolo || voce.riferimento}</span>
              {voce.nomeAggiunto && (
                <span className="shrink-0 text-[11px] text-testo-3">da {voce.nomeAggiunto}</span>
              )}
              <button
                onClick={() => void media.togliDallaCoda(sessione.id, voce.id)}
                title="Togli dalla coda"
                aria-label="Togli dalla coda"
                className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
              >
                <Cestino className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
