import { useEffect, useRef, useState } from 'react'
import type { ModoAudioSistema, Sorgente } from '@shared/tipi'
import { PRESET_SCHERMO, type PresetSchermo } from '@shared/qualita'
import { ponte } from '../ponte'
import { usaDispositivi } from '../lib/usaDispositivi'
import { Avviso, Bottone } from '../ui'
import { Altoparlante, Giu, Lente, SchermoCondividi, Spunta } from '../icone'

type Categoria = 'schermi' | 'applicazioni' | 'dispositivi'
export type ModalitaSceltaSorgente = 'nuova' | 'cambia-video' | 'cambia-audio'

const CATEGORIE: [Categoria, string][] = [
  ['schermi', 'Schermi'],
  ['applicazioni', 'Applicazioni'],
  ['dispositivi', 'Dispositivi']
]

const AUDIO: [ModoAudioSistema, string, string][] = [
  ['niente', 'Nessuno', 'Va solo il video: quello che suona dal tuo computer resta a te.'],
  ['condiviso', 'Insieme al video', 'Lo sentono loro e continui a sentirlo anche tu.'],
  ['soloRemoto', 'Solo a loro', 'Lo sentono loro, da te resta muto. Per non sentirlo due volte.']
]

const BITRATE_AUDIO: [number, string, string][] = [
  [510_000, 'Massima', '510 kbit/s stereo. Musica, senza compromessi.'],
  [256_000, 'Alta', '256 kbit/s. Quasi indistinguibile, meta\' della banda.'],
  [128_000, 'Leggera', '128 kbit/s. Per linee lente.']
]

/**
 * Cosa condividere, e come.
 *
 * Le anteprime prendono tutta l'altezza che c'e', e i settaggi stanno su una
 * riga sola in fondo. Prima era il contrario — mezza finestra di riquadri
 * descrittivi e una feritoia per le anteprime — e la scelta vera, cioe' quale
 * schermo, era quella che si vedeva peggio. I dettagli non sono spariti: sono
 * dentro alle tendine, e compaiono passandoci sopra col cursore.
 */
export default function SceltaSorgente({
  presetIniziale,
  audioIniziale,
  modalita = 'nuova',
  conferma,
  chiudi
}: {
  presetIniziale: string
  audioIniziale: ModoAudioSistema
  modalita?: ModalitaSceltaSorgente
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
  const [categoria, setCategoria] = useState<Categoria>('schermi')

  /**
   * Solo l'audio, senza immagine.
   *
   * Per la musica il video non e' un di piu': e' un danno. Trenta megabit al
   * secondo per mostrare la finestra ferma di un lettore, mentre quello che
   * conta sono i 510 kbit dell'audio.
   */
  const [soloAudio, setSoloAudio] = useState(modalita === 'cambia-audio')
  const [bitrateAudio, setBitrateAudio] = useState(510_000)

  /**
   * Se gli altri possono indicare punti su questa condivisione.
   *
   * Acceso di partenza, perche' e' il motivo per cui la condivisione esiste:
   * si mostra qualcosa per parlarne insieme. Si toglie quando si mostra una
   * cosa e basta, e gli aloni sopra sarebbero solo un disturbo.
   */
  const [permettiInterazione, setPermettiInterazione] = useState(true)

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

  useEffect(() => {
    void ponte.sorgenti().then(setSorgenti)
  }, [])

  const preset = PRESET_SCHERMO.find((p) => p.id === presetId) ?? PRESET_SCHERMO[0]

  // Nel browser il selettore e' quello di Chrome: qui si sceglie solo la
  // qualita', e la sorgente la chiede il browser un istante dopo.
  const nelBrowser = !ponte.elettrone

  const diCategoria = (id: Categoria): Sorgente[] =>
    id === 'dispositivi'
      ? dispositivi
      : (sorgenti?.filter((s) => (id === 'schermi' ? s.tipo === 'schermo' : s.tipo === 'finestra')) ??
        [])

  const parti = (): void => {
    const sorgente = nelBrowser
      ? null
      : (sorgenti?.find((s) => s.id === scelta) ?? dispositivi.find((d) => d.id === scelta) ?? null)
    if (!nelBrowser && !sorgente) return
    conferma(sorgente, preset, audio, soloAudio, bitrateAudio, permettiInterazione)
  }

  const elenco = diCategoria(categoria)

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="flex h-full max-h-[46rem] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-bordo bg-fondo-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Titolo e schede sulla stessa riga: due righe separate costavano
            quaranta pixel di altezza che servono alle anteprime. */}
        <header className="flex shrink-0 items-center gap-5 border-b border-bordo px-5">
          <h2 className="py-4 font-semibold">
            {modalita === 'nuova'
              ? 'Condividi'
              : modalita === 'cambia-audio'
                ? 'Cambia sorgente audio'
                : 'Cambia finestra o schermo'}
          </h2>

          {!nelBrowser && (
            <nav className="flex gap-1">
              {CATEGORIE.map(([id, nome]) => (
                <button
                  key={id}
                  onClick={() => setCategoria(id)}
                  className={`-mb-px border-b-2 px-3 py-4 text-sm transition-colors ${
                    categoria === id
                      ? 'border-vivo text-testo'
                      : 'border-transparent text-testo-3 hover:text-testo-2'
                  }`}
                >
                  {nome}
                  <span className="numeri ml-1.5 text-[11px] text-testo-3">
                    {diCategoria(id).length}
                  </span>
                </button>
              ))}
            </nav>
          )}
        </header>

        {/* Le anteprime: tutta l'altezza che resta. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {nelBrowser ? (
            <Avviso tono="neutro">
              Nel browser la scelta di cosa mostrare la fa Chrome, un istante dopo aver premuto
              Condividi. L&apos;audio di sistema c&apos;e&apos; solo se lo spunti nella sua finestra,
              e su Windows solo condividendo uno schermo intero.
            </Avviso>
          ) : sorgenti === null ? (
            <p className="respiro text-testo-3">guardo cosa c&apos;e&apos; aperto…</p>
          ) : elenco.length === 0 ? (
            <Avviso tono="neutro">
              {categoria === 'dispositivi'
                ? 'Nessuna camera o scheda di acquisizione collegata. Qui compaiono le schede di cattura e le webcam, per mostrare una console o una fotocamera esterna come fosse uno schermo.'
                : categoria === 'schermi'
                  ? 'Windows non ha restituito nessuno schermo.'
                  : 'Nessuna finestra aperta da condividere.'}
            </Avviso>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {elenco.map((s) => (
                <Riquadro key={s.id} sorgente={s} scelto={s.id === scelta} scegli={setScelta} />
              ))}
            </div>
          )}
        </div>

        {/* I settaggi: una riga sola, tendine e interruttori. Il dettaglio sta
            dentro, e nel titolo che compare passandoci sopra. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-bordo px-5 py-3">
          {!soloAudio && (
            <Tendina
              icona={<Lente />}
              etichetta="Qualita'"
              valore={preset.nome}
              titolo={preset.spiegazione}
              voci={PRESET_SCHERMO.map((p) => ({
                id: p.id,
                nome: p.nome,
                sotto: p.spiegazione,
                scelto: p.id === presetId
              }))}
              scegli={setPresetId}
            />
          )}

          {ponte.audioDiSistema && !soloAudio && (
            <Tendina
              icona={<Altoparlante />}
              etichetta="Audio di sistema"
              valore={AUDIO.find(([id]) => id === audio)?.[1] ?? ''}
              titolo={AUDIO.find(([id]) => id === audio)?.[2] ?? ''}
              voci={AUDIO.map(([id, nome, sotto]) => ({
                id,
                nome,
                sotto,
                scelto: id === audio
              }))}
              scegli={(id) => setAudio(id as ModoAudioSistema)}
            />
          )}

          {soloAudio && (
            <Tendina
              icona={<Altoparlante />}
              etichetta="Qualita' audio"
              valore={BITRATE_AUDIO.find(([v]) => v === bitrateAudio)?.[1] ?? ''}
              titolo={BITRATE_AUDIO.find(([v]) => v === bitrateAudio)?.[2] ?? ''}
              voci={BITRATE_AUDIO.map(([v, nome, sotto]) => ({
                id: String(v),
                nome,
                sotto,
                scelto: v === bitrateAudio
              }))}
              scegli={(id) => setBitrateAudio(Number(id))}
            />
          )}

          {ponte.audioDiSistema && modalita === 'nuova' && (
            <Interruttore
              acceso={soloAudio}
              premi={() => setSoloAudio((v) => !v)}
              icona={<Altoparlante />}
              etichetta="Solo audio"
              titolo="Condividi solo l'audio, senza immagine. Per la musica: niente riquadro da guardare dall'altra parte, e tutta la banda va al suono invece che a una finestra ferma."
            />
          )}

          {!soloAudio && modalita === 'nuova' && (
            <Interruttore
              acceso={permettiInterazione}
              premi={() => setPermettiInterazione((v) => !v)}
              icona={<SchermoCondividi />}
              etichetta="Possono indicare"
              titolo="Chi guarda puo' segnare un punto sulla tua condivisione, e te lo vedi comparire sul monitor vero. Togliendola, resta una cosa da guardare e basta."
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            <Bottone tono="fantasma" onClick={chiudi}>
              Annulla
            </Bottone>
            <Bottone onClick={parti} disabled={!nelBrowser && !scelta}>
              {modalita === 'nuova' ? 'Condividi' : 'Cambia'}
            </Bottone>
          </div>
        </div>
      </div>
    </div>
  )
}

// -- I pezzi ------------------------------------------------------------------

function Riquadro({
  sorgente,
  scelto,
  scegli
}: {
  sorgente: Sorgente
  scelto: boolean
  scegli: (id: string) => void
}): React.JSX.Element {
  const misura =
    sorgente.larghezza && sorgente.altezza ? `${sorgente.larghezza}×${sorgente.altezza}` : null

  return (
    <button
      onClick={() => scegli(sorgente.id)}
      title={misura ? `${sorgente.nome} — ${misura} pixel veri` : sorgente.nome}
      className={`overflow-hidden rounded-xl border text-left transition-colors ${
        scelto ? 'border-vivo ring-1 ring-vivo' : 'border-bordo hover:border-fondo-3'
      }`}
    >
      {sorgente.anteprima ? (
        <img
          src={sorgente.anteprima}
          alt=""
          className="aspect-video w-full bg-black object-contain"
        />
      ) : (
        // I dispositivi non hanno un'anteprima da desktopCapturer: aprirla
        // vorrebbe dire accendere la camera solo per mostrarne il riquadro.
        <span className="flex aspect-video w-full items-center justify-center bg-fondo text-testo-3">
          <SchermoCondividi className="h-7 w-7" />
        </span>
      )}
      <span className="flex items-center gap-2 px-3 py-2">
        {sorgente.icona && <img src={sorgente.icona} alt="" className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{sorgente.nome}</span>
          {misura && <span className="numeri block text-[10px] text-testo-3">{misura}</span>}
        </span>
        {scelto && <Spunta className="h-4 w-4 shrink-0 text-vivo" />}
      </span>
    </button>
  )
}

/**
 * Una tendina che si apre verso l'alto.
 *
 * Verso l'alto perche' vive in fondo alla finestra: aperta verso il basso
 * finirebbe fuori dal pannello.
 */
function Tendina({
  icona,
  etichetta,
  valore,
  titolo,
  voci,
  scegli
}: {
  icona: React.ReactNode
  etichetta: string
  valore: string
  titolo: string
  voci: { id: string; nome: string; sotto: string; scelto: boolean }[]
  scegli: (id: string) => void
}): React.JSX.Element {
  const [aperta, setAperta] = useState(false)
  const scatola = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aperta) return
    const fuori = (e: MouseEvent): void => {
      if (!scatola.current?.contains(e.target as Node)) setAperta(false)
    }
    window.addEventListener('mousedown', fuori)
    return () => window.removeEventListener('mousedown', fuori)
  }, [aperta])

  return (
    <div ref={scatola} className="relative">
      <button
        onClick={() => setAperta((v) => !v)}
        title={`${etichetta}: ${titolo}`}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          aperta ? 'border-vivo bg-vivo/10' : 'border-bordo bg-fondo hover:border-fondo-3'
        }`}
      >
        <span className="shrink-0 text-testo-3 [&>svg]:h-4 [&>svg]:w-4">{icona}</span>
        <span className="text-testo-3">{etichetta}</span>
        <span className="text-testo">{valore}</span>
        <Giu className={`h-3.5 w-3.5 shrink-0 text-testo-3 ${aperta ? 'rotate-180' : ''}`} />
      </button>

      {aperta && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-80 rounded-xl border border-bordo bg-fondo-2 p-1 shadow-xl shadow-black/50">
          {voci.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                scegli(v.id)
                setAperta(false)
              }}
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                v.scelto ? 'bg-fondo-3' : 'hover:bg-fondo-3/60'
              }`}
            >
              <span className="mt-0.5 w-4 shrink-0">
                {v.scelto && <Spunta className="h-4 w-4 text-vivo" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-testo">{v.nome}</span>
                <span className="block text-[11px] leading-snug text-testo-3">{v.sotto}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Interruttore({
  acceso,
  premi,
  icona,
  etichetta,
  titolo
}: {
  acceso: boolean
  premi: () => void
  icona: React.ReactNode
  etichetta: string
  titolo: string
}): React.JSX.Element {
  return (
    <button
      onClick={premi}
      title={titolo}
      aria-pressed={acceso}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        acceso ? 'border-vivo bg-vivo/10 text-testo' : 'border-bordo bg-fondo text-testo-3 hover:border-fondo-3'
      }`}
    >
      <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icona}</span>
      {etichetta}
    </button>
  )
}
