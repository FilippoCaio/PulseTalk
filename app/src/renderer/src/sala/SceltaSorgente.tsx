import { useEffect, useState } from 'react'
import type { ModoAudioSistema, Sorgente } from '@shared/tipi'
import { PRESET_SCHERMO, type PresetSchermo } from '@shared/qualita'
import { ponte } from '../ponte'
import { usaDispositivi } from '../lib/usaDispositivi'

type Categoria = 'schermi' | 'applicazioni' | 'dispositivi'

const CATEGORIE: [Categoria, string][] = [
  ['schermi', 'Schermi'],
  ['applicazioni', 'Applicazioni'],
  ['dispositivi', 'Dispositivi']
]
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
  conferma: (
    sorgente: Sorgente | null,
    preset: PresetSchermo,
    audio: ModoAudioSistema,
    soloAudio: boolean,
    bitrateAudio: number,
    permettiInterazione: boolean
  ) => void
  chiudi: () => void
}): React.JSX.Element {
  const [sorgenti, setSorgenti] = useState<Sorgente[] | null>(null)
  const [scelta, setScelta] = useState<string | null>(null)
  const [presetId, setPresetId] = useState(presetIniziale)
  const [audio, setAudio] = useState<ModoAudioSistema>(audioIniziale)

  /**
   * Solo l'audio, senza immagine.
   *
   * Per la musica il video non e' un di piu': e' un danno. Trenta megabit al
   * secondo per mostrare la finestra ferma di un lettore, mentre quello che
   * conta sono i 510 kbit dell'audio. Spento, non compare nemmeno un riquadro
   * da guardare dall'altra parte.
   */
  const [soloAudio, setSoloAudio] = useState(false)
  const [categoria, setCategoria] = useState<Categoria>('schermi')

  /**
   * Se gli altri possono indicare punti su questa condivisione.
   *
   * Acceso di partenza, perche' e' il motivo per cui la condivisione esiste:
   * si mostra qualcosa per parlarne insieme. Si toglie quando si mostra una
   * cosa e basta — una presentazione, un documento — e gli aloni sopra
   * sarebbero solo un disturbo.
   */
  const [permettiInterazione, setPermettiInterazione] = useState(true)

  // Camere e schede di acquisizione, vestite da sorgente: cosi' proseguono
  // per la stessa strada di uno schermo condiviso.
  const { per } = usaDispositivi()
  const dispositivi: Sorgente[] = per('videoinput').map((d) => ({
    id: d.deviceId,
    nome: d.label || 'Dispositivo senza nome',
    tipo: 'dispositivo' as const,
    anteprima: '',
    icona: null,
    schermoId: null,
    larghezza: 0,
    altezza: 0
  }))

  const quante = (id: Categoria): number =>
    id === 'dispositivi'
      ? dispositivi.length
      : (sorgenti?.filter((s) => (id === 'schermi' ? s.tipo === 'schermo' : s.tipo === 'finestra'))
          .length ?? 0)
  const [bitrateAudio, setBitrateAudio] = useState(510_000)

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
    const sorgente = nelBrowser
      ? null
      : (sorgenti?.find((s) => s.id === scelta) ??
        dispositivi.find((d) => d.id === scelta) ??
        null)
    if (!nelBrowser && !sorgente) return
    conferma(sorgente, preset, audio, soloAudio, bitrateAudio, permettiInterazione)
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
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

              {/* Tre schede invece di due elenchi in fila.
                  
                  Con venti finestre aperte l'elenco unico costringeva a
                  scorrere per trovare il proprio schermo, che e' la scelta
                  piu' frequente di tutte. */}
              <div className="mb-4 flex gap-1 border-b border-bordo">
                {CATEGORIE.map(([id, nome]) => (
                  <button
                    key={id}
                    onClick={() => setCategoria(id)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                      categoria === id
                        ? 'border-vivo text-testo'
                        : 'border-transparent text-testo-3 hover:text-testo-2'
                    }`}
                  >
                    {nome}
                    <span className="numeri ml-1.5 text-[11px] text-testo-3">
                      {quante(id)}
                    </span>
                  </button>
                ))}
              </div>

              {categoria === 'dispositivi' ? (
                dispositivi.length === 0 ? (
                  <Avviso tono="neutro">
                    Nessuna camera o scheda di acquisizione collegata. Qui compaiono le schede di
                    cattura e le webcam, per mostrare una console o una fotocamera esterna come se
                    fosse uno schermo.
                  </Avviso>
                ) : (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {dispositivi.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setScelta(d.id)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          scelta === d.id
                            ? 'border-vivo bg-vivo/10'
                            : 'border-bordo bg-fondo hover:border-fondo-3'
                        }`}
                      >
                        <span className="block truncate text-sm">{d.nome}</span>
                        <span className="mt-0.5 block text-[11px] text-testo-3">
                          dispositivo di acquisizione
                        </span>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                <ElencoSorgenti
                  titolo=""
                  sorgenti={
                    sorgenti?.filter((s) =>
                      categoria === 'schermi' ? s.tipo === 'schermo' : s.tipo === 'finestra'
                    ) ?? []
                  }
                  scelta={scelta}
                  scegli={setScelta}
                />
              )}
            </>
          )}
        </div>

        <div className="space-y-4 border-t border-bordo p-5">
          {!soloAudio && (
            <button
              onClick={() => setPermettiInterazione((v) => !v)}
              className="flex w-full items-start gap-2.5 rounded-lg border border-bordo bg-fondo px-3 py-2 text-left transition-colors hover:border-fondo-3"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  permettiInterazione
                    ? 'border-vivo bg-vivo text-fondo'
                    : 'border-bordo text-transparent'
                }`}
              >
                ✓
              </span>
              <span>
                <span className="block text-sm">Lascia che indichino sulla tua condivisione</span>
                <span className="block text-[11px] text-testo-3">
                  Con la spunta, chi guarda puo' segnare un punto e te lo vedi comparire sul
                  monitor. Senza, resta una cosa da guardare e basta.
                </span>
              </span>
            </button>
          )}

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
                Solo audio
              </p>
              <button
                onClick={() => setSoloAudio(!soloAudio)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  soloAudio ? 'border-vivo bg-vivo/10' : 'border-bordo bg-fondo hover:border-fondo-3'
                }`}
              >
                Condividi solo l'audio, senza immagine
                <span className="block text-[11px] text-testo-3">
                  Per la musica. Niente riquadro da guardare dall'altra parte, e tutta la banda va
                  al suono invece che a una finestra ferma.
                </span>
              </button>

              {soloAudio && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(
                    [
                      [510_000, 'Massima', '510 kbit/s stereo. Musica.'],
                      [256_000, 'Alta', '256 kbit/s. Quasi indistinguibile.'],
                      [128_000, 'Leggera', '128 kbit/s. Per linee lente.']
                    ] as [number, string, string][]
                  ).map(([valore, nome, sotto]) => (
                    <button
                      key={valore}
                      onClick={() => setBitrateAudio(valore)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        bitrateAudio === valore
                          ? 'border-vivo bg-vivo/10'
                          : 'border-bordo bg-fondo hover:border-fondo-3'
                      }`}
                    >
                      {nome}
                      <span className="block text-[11px] text-testo-3">{sotto}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {ponte.audioDiSistema && !soloAudio && (
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
