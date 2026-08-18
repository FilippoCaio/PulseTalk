import { useEffect, useState } from 'react'
import type { ModoAudioSistema, Sorgente } from '@shared/tipi'
import { PRESET_SCHERMO, type PresetSchermo } from '@shared/qualita'
import { ponte } from '../ponte'
import { Avviso, Bottone } from '../ui'

/**
 * Cosa condividere, e come.
 *
 * Il selettore di Windows sa fare la prima meta' e non sa fare la seconda. Qui
 * accanto a ogni schermo c'e' scritto quanti pixel ha davvero, si sceglie il
 * profilo di qualita' prima di partire invece che scoprirlo dopo, e c'e'
 * l'interruttore dell'audio di sistema — che e' la cosa che manda in bestia
 * chiunque abbia mai provato a far sentire un video su Discord.
 */
export default function SceltaSorgente({
  presetIniziale,
  audioIniziale,
  conferma,
  chiudi
}: {
  presetIniziale: string
  audioIniziale: ModoAudioSistema
  conferma: (sorgente: Sorgente | null, preset: PresetSchermo, audio: ModoAudioSistema) => void
  chiudi: () => void
}): React.JSX.Element {
  const [sorgenti, setSorgenti] = useState<Sorgente[] | null>(null)
  const [scelta, setScelta] = useState<string | null>(null)
  const [presetId, setPresetId] = useState(presetIniziale)
  const [audio, setAudio] = useState<ModoAudioSistema>(audioIniziale)

  useEffect(() => {
    void ponte.sorgenti().then((elenco) => {
      setSorgenti(elenco)
      setScelta(elenco.find((s) => s.tipo === 'schermo')?.id ?? elenco[0]?.id ?? null)
    })
  }, [])

  const preset = PRESET_SCHERMO.find((p) => p.id === presetId) ?? PRESET_SCHERMO[0]

  // Nel browser il selettore e' quello di Chrome: qui si sceglie solo la
  // qualita', e la sorgente la chiede il browser un istante dopo.
  const nelBrowser = !ponte.elettrone

  const parti = (): void => {
    const sorgente = nelBrowser ? null : (sorgenti?.find((s) => s.id === scelta) ?? null)
    if (!nelBrowser && !sorgente) return
    conferma(sorgente, preset, audio)
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-bordo px-5 py-4">
          <h2 className="font-semibold">Condividi</h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {nelBrowser ? (
            <Avviso tono="neutro">
              Nel browser la scelta di cosa mostrare la fa Chrome, un istante dopo aver premuto
              Condividi. L'audio di sistema c'e' solo se lo spunti nella sua finestra, e su Windows
              solo condividendo uno schermo intero.
            </Avviso>
          ) : (
            <>
              {sorgenti === null && <p className="respiro text-testo-3">guardo cosa c'e' aperto…</p>}
              {sorgenti?.length === 0 && (
                <Avviso>Windows non ha restituito nessuna finestra da condividere.</Avviso>
              )}

              <ElencoSorgenti
                titolo="Schermi"
                sorgenti={sorgenti?.filter((s) => s.tipo === 'schermo') ?? []}
                scelta={scelta}
                scegli={setScelta}
              />
              <ElencoSorgenti
                titolo="Finestre"
                sorgenti={sorgenti?.filter((s) => s.tipo === 'finestra') ?? []}
                scelta={scelta}
                scegli={setScelta}
              />
            </>
          )}
        </div>

        <div className="space-y-4 border-t border-bordo p-5">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-testo-2 uppercase">Qualita'</p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {PRESET_SCHERMO.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    p.id === presetId
                      ? 'border-vivo bg-vivo/10'
                      : 'border-bordo bg-fondo hover:border-fondo-3'
                  }`}
                >
                  <span className="block text-sm font-medium">{p.nome}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-testo-3">
                    {p.spiegazione}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {ponte.audioDiSistema && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-testo-2 uppercase">
                Audio di sistema
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['niente', 'Nessuno', 'Solo il video.'],
                    ['condiviso', 'Insieme al video', 'Lo senti anche tu.'],
                    ['soloRemoto', 'Solo a loro', 'Da te resta muto.']
                  ] as [ModoAudioSistema, string, string][]
                ).map(([valore, nome, sotto]) => (
                  <button
                    key={valore}
                    onClick={() => setAudio(valore)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      audio === valore
                        ? 'border-vivo bg-vivo/10'
                        : 'border-bordo bg-fondo hover:border-fondo-3'
                    }`}
                  >
                    {nome}
                    <span className="block text-[11px] text-testo-3">{sotto}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Bottone tono="fantasma" onClick={chiudi}>
              Annulla
            </Bottone>
            <Bottone tono="vivo" disabled={!nelBrowser && !scelta} onClick={parti}>
              Condividi
            </Bottone>
          </div>
        </div>
      </div>
    </div>
  )
}

function ElencoSorgenti({
  titolo,
  sorgenti,
  scelta,
  scegli
}: {
  titolo: string
  sorgenti: Sorgente[]
  scelta: string | null
  scegli: (id: string) => void
}): React.JSX.Element | null {
  if (sorgenti.length === 0) return null

  return (
    <section className="mb-5 last:mb-0">
      <p className="mb-2 text-xs font-medium tracking-wide text-testo-2 uppercase">{titolo}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {sorgenti.map((s) => (
          <button
            key={s.id}
            onClick={() => scegli(s.id)}
            className={`overflow-hidden rounded-lg border text-left transition-colors ${
              s.id === scelta ? 'border-vivo' : 'border-bordo hover:border-fondo-3'
            }`}
          >
            <img src={s.anteprima} alt="" className="aspect-video w-full bg-black object-contain" />
            <div className="flex items-center gap-2 px-2.5 py-2">
              {s.icona && <img src={s.icona} alt="" className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs">{s.nome}</span>
                {s.larghezza && s.altezza && (
                  <span className="numeri block text-[10px] text-testo-3">
                    {s.larghezza}×{s.altezza}
                  </span>
                )}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
