import { useEffect, useRef, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import { PRESET_SCHERMO } from '@shared/qualita'
import ControlliAudio from '../ControlliAudio'
import type { AudioCondiviso, AudioRemoto } from '../lib/usaSessione'
import { usaDispositivi } from '../lib/usaDispositivi'
import {
  Altoparlante,
  AltoparlanteMuto,
  Camera,
  CameraSpenta,
  Esci,
  Microfono,
  MicrofonoSpento,
  Onde,
  Pile,
  Riavvolgi,
  SchermoCondividi,
  SchermoIntero,
  SchermoNormale,
  SchermoStop,
  Su
} from '../icone'

/**
 * La barra dei comandi della chiamata, sospesa sopra ai riquadri.
 *
 * Compare muovendo il cursore e sparisce da sola dopo qualche secondo di
 * immobilita'. E' il motivo per cui la colonna delle persone e la barra fissa
 * non ci sono piu': in una videochiamata lo spazio e' l'unica risorsa scarsa,
 * e due strisce di interfaccia sempre accese si mangiano un riquadro intero
 * per mostrare cose che servono tre volte in un'ora.
 *
 * Resta ferma finche' un sottomenu e' aperto: sparire sotto al cursore mentre
 * si sta scegliendo un microfono e' il modo piu' rapido di far odiare una
 * barra che si nasconde.
 */
export default function OverlayChiamata({
  microfonoAcceso,
  cameraAccesa,
  puoTrasmettere,
  schermiAttivi,
  audioCondivisi,
  audioRemoti,
  volumeAudioCondiviso,
  mutoAudioCondiviso,
  volumeAudioRemoto,
  mutoAudioRemoto,
  riascoltoAttivo,
  secondiRiascolto,
  impostazioni,
  schermoIntero,
  alternaMicrofono,
  alternaCamera,
  apriCondivisione,
  smettiDiCondividere,
  cambiaQualita,
  presetDi,
  riascolta,
  salva,
  apriImpostazioni,
  esci
}: {
  microfonoAcceso: boolean
  cameraAccesa: boolean
  puoTrasmettere: boolean
  schermiAttivi: { id: string; etichetta: string }[]
  /** Le proprie condivisioni di solo audio: quanto forte esce da te. */
  audioCondivisi: AudioCondiviso[]
  /** Gli audio condivisi dagli altri: quanto forte arriva a te. */
  audioRemoti: AudioRemoto[]
  volumeAudioCondiviso: (id: string, volume: number) => void
  mutoAudioCondiviso: (id: string) => void
  volumeAudioRemoto: (id: string, volume: number) => void
  mutoAudioRemoto: (id: string) => void
  riascoltoAttivo: boolean
  secondiRiascolto: number
  impostazioni: Impostazioni
  schermoIntero: { attivo: boolean; alterna: () => void }
  alternaMicrofono: () => void
  alternaCamera: () => void
  apriCondivisione: () => void
  smettiDiCondividere: (id: string) => void
  cambiaQualita: (id: string, presetId: string) => void
  presetDi: (id: string) => string | null
  riascolta: () => void
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
  esci: () => void
}): React.JSX.Element {
  const [visibile, setVisibile] = useState(true)
  const [aperto, setAperto] = useState<'microfono' | 'camera' | 'condivisioni' | 'audio' | null>(
    null
  )
  const scadenza = useRef<number | null>(null)
  const radice = useRef<HTMLDivElement>(null)

  // Si ascolta solo la superficie della chiamata. Muovere il mouse nella chat
  // o nelle colonne laterali non deve far ricomparire comandi che non
  // appartengono a quelle zone.
  useEffect(() => {
    const superficie = radice.current?.parentElement
    if (!superficie) return

    const annulla = (): void => {
      if (scadenza.current !== null) window.clearTimeout(scadenza.current)
      scadenza.current = null
    }
    const riavvia = (): void => {
      annulla()
      setVisibile(true)
      scadenza.current = window.setTimeout(() => setVisibile(false), 2600)
    }
    const esce = (): void => {
      annulla()
      setAperto(null)
      scadenza.current = window.setTimeout(() => setVisibile(false), 120)
    }

    riavvia()
    superficie.addEventListener('pointerenter', riavvia)
    superficie.addEventListener('pointermove', riavvia)
    superficie.addEventListener('pointerleave', esce)
    return () => {
      superficie.removeEventListener('pointerenter', riavvia)
      superficie.removeEventListener('pointermove', riavvia)
      superficie.removeEventListener('pointerleave', esce)
      annulla()
    }
  }, [])

  // Se si ferma l'ultima condivisione mentre il pannello e' aperto, chiudiamo
  // anche il pannello. Altrimenti restava il riquadro con la sola frase sulla
  // qualita', che sembrava una finestra comparsa dopo lo stop.
  useEffect(() => {
    if (aperto === 'condivisioni' && schermiAttivi.length === 0) setAperto(null)
  }, [aperto, schermiAttivi.length])

  // Quanti audio ci sono in giro, e se almeno uno sta davvero suonando: il
  // primo numero va nel cerchietto, il secondo decide se l'icona si muove.
  const quantiAudio = audioCondivisi.length + audioRemoti.length
  const qualcunoSuona =
    audioCondivisi.some((a) => a.attivo) || audioRemoti.some((a) => !a.muto && a.volume > 0)

  const mostra = visibile || aperto !== null

  return (
    <div
      ref={radice}
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4 transition-opacity duration-200 ${
        mostra ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="pointer-events-auto relative flex items-end gap-2">
        {aperto === 'microfono' && (
          <MenuMicrofono
            impostazioni={impostazioni}
            salva={salva}
            apriImpostazioni={() => {
              setAperto(null)
              apriImpostazioni()
            }}
          />
        )}
        {aperto === 'camera' && (
          <MenuCamera impostazioni={impostazioni} salva={salva} accesa={cameraAccesa} />
        )}
        {aperto === 'audio' && (
          <MenuAudio
            miei={audioCondivisi}
            loro={audioRemoti}
            volumeMio={volumeAudioCondiviso}
            mutoMio={mutoAudioCondiviso}
            volumeLoro={volumeAudioRemoto}
            mutoLoro={mutoAudioRemoto}
          />
        )}
        {aperto === 'condivisioni' && schermiAttivi.length > 0 && (
          <MenuCondivisioni
            schermi={schermiAttivi}
            presetDi={presetDi}
            cambiaQualita={cambiaQualita}
            smetti={smettiDiCondividere}
          />
        )}

        <div className="flex items-center gap-1.5 rounded-2xl border border-bordo bg-fondo-2/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur">
          <ConFreccia
            aperto={aperto === 'microfono'}
            apri={() => setAperto(aperto === 'microfono' ? null : 'microfono')}
          >
            <Tondo
              tono={microfonoAcceso ? 'normale' : 'male'}
              titolo={microfonoAcceso ? 'Zittisci il microfono' : 'Riaccendi il microfono'}
              premi={alternaMicrofono}
            >
              {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
            </Tondo>
          </ConFreccia>

          {puoTrasmettere && (
            <ConFreccia
              aperto={aperto === 'camera'}
              apri={() => setAperto(aperto === 'camera' ? null : 'camera')}
            >
              <Tondo
                acceso={cameraAccesa}
                titolo={cameraAccesa ? 'Spegni la camera' : 'Accendi la camera'}
                premi={alternaCamera}
              >
                {cameraAccesa ? <Camera /> : <CameraSpenta />}
              </Tondo>
            </ConFreccia>
          )}

          {puoTrasmettere && (
            <>
              <Tondo
                acceso={schermiAttivi.length > 0}
                titolo="Condividi uno schermo o una finestra"
                premi={apriCondivisione}
              >
                <SchermoCondividi />
              </Tondo>

              {/* Compare solo condividendo: e' la porta sull'elenco di cio' che
                  sta uscendo da qui, e senza condivisioni non elenca niente. */}
              {schermiAttivi.length > 0 && (
                <Tondo
                  acceso={aperto === 'condivisioni'}
                  titolo={`${schermiAttivi.length} in corso: apri l'elenco`}
                  premi={() => setAperto(aperto === 'condivisioni' ? null : 'condivisioni')}
                >
                  <Pile />
                </Tondo>
              )}
            </>
          )}

          {/* Gli audio condivisi hanno una porta tutta loro, e non stanno
              nell'elenco delle condivisioni: uno schermo si guarda, un audio si
              ascolta, e mescolarli vuol dire cercare il volume della musica in
              mezzo alle finestre aperte. Compare solo quando ce n'e' almeno
              uno, tuo o di qualcun altro. */}
          {quantiAudio > 0 && (
            <span className="relative">
              <Tondo
                acceso={aperto === 'audio'}
                titolo={`${quantiAudio} audio condivisi: volumi e muto`}
                premi={() => setAperto(aperto === 'audio' ? null : 'audio')}
              >
                <Onde attivo={qualcunoSuona} className="h-[18px] w-[18px]" />
              </Tondo>
              {/* Il numero nel cerchio verde, come il pallino di stato
                  sull'icona dell'utente: dice quante ce ne sono senza dover
                  aprire niente. */}
              <span className="numeri pointer-events-none absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ok px-1 text-[10px] font-semibold text-fondo ring-2 ring-fondo-2">
                {quantiAudio}
              </span>
            </span>
          )}

          {/* Sempre presente, anche spento.
              
              Prima compariva solo con il riascolto attivo, e un pulsante che a
              volte c'e' e a volte no e' un pulsante che non si impara mai: chi
              l'ha disattivato senza accorgersene non ha modo di capire dove sia
              finito. Spento dice dov'e' e come riaccenderlo. */}
          <Tondo
            titolo={
              riascoltoAttivo
                ? `Riascolta gli ultimi ${secondiRiascolto} secondi`
                : 'Riascolto spento: si riaccende nelle impostazioni, sezione Audio'
            }
            premi={riascoltoAttivo ? riascolta : apriImpostazioni}
            spento={!riascoltoAttivo}
          >
            <Riavvolgi />
          </Tondo>

          <Tondo tono="male" titolo="Esci dalla chiamata" premi={esci}>
            <Esci />
          </Tondo>
        </div>

      </div>

      {/* In fondo alla riga, cioe' nell'angolo: non e' un comando della
          chiamata ma della finestra, e tenerlo attaccato agli altri lo
          farebbe premere per sbaglio al posto di "esci". */}
      {/* Nuda, senza la scatola degli altri: non fa parte del gruppo dei
          comandi della chiamata, e incorniciarla la faceva sembrare un
          secondo gruppo da un pulsante solo. */}
      <button
        onClick={schermoIntero.alterna}
        title={schermoIntero.attivo ? 'Torna alle colonne' : 'A tutto schermo'}
        aria-label={schermoIntero.attivo ? 'Torna alle colonne' : 'A tutto schermo'}
        className="pointer-events-auto absolute right-5 bottom-6 text-testo-3 transition-colors hover:text-testo [&>svg]:h-5 [&>svg]:w-5"
      >
        {schermoIntero.attivo ? <SchermoNormale /> : <SchermoIntero />}
      </button>
    </div>
  )
}

// -- I pezzi ------------------------------------------------------------------

function Tondo({
  children,
  titolo,
  premi,
  acceso = false,
  spento = false,
  tono = 'normale'
}: {
  children: React.ReactNode
  titolo: string
  premi: () => void
  acceso?: boolean
  /** Presente ma disattivato: si vede che esiste, e il titolo dice perche'. */
  spento?: boolean
  tono?: 'normale' | 'male'
}): React.JSX.Element {
  const colore = spento
    ? 'bg-fondo-3/50 text-testo-3 hover:text-testo-2'
    : tono === 'male'
      ? 'bg-male/90 text-white hover:bg-male'
      : acceso
        ? 'bg-vivo/20 text-vivo hover:bg-vivo/30'
        : 'bg-fondo-3 text-testo-2 hover:bg-fondo-3/70 hover:text-testo'

  return (
    <button
      onClick={premi}
      title={titolo}
      aria-label={titolo}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${colore} [&>svg]:h-[18px] [&>svg]:w-[18px]`}
    >
      {children}
    </button>
  )
}

/** Un pulsante con la sua freccetta attaccata sotto. */
function ConFreccia({
  children,
  aperto,
  apri
}: {
  children: React.ReactNode
  aperto: boolean
  apri: () => void
}): React.JSX.Element {
  return (
    <div className="relative">
      {children}
      <button
        onClick={apri}
        aria-label="Altre impostazioni"
        className={`absolute -bottom-0.5 left-1/2 flex h-4 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-bordo bg-fondo-2 transition-colors ${
          aperto ? 'text-vivo' : 'text-testo-3 hover:text-testo'
        }`}
      >
        <Su className="h-3 w-3" />
      </button>
    </div>
  )
}

function Pannello({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 space-y-3 rounded-xl border border-bordo bg-fondo-2 p-3 shadow-xl shadow-black/40">
      {children}
    </div>
  )
}

function Etichetta({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="mb-1 block text-[11px] tracking-wide text-testo-3 uppercase">{children}</span>
  )
}

const CLASSI_SELECT =
  'w-full rounded-lg border border-bordo bg-fondo px-2 py-1.5 text-xs text-testo focus:border-vivo focus:outline-none'

function MenuMicrofono({
  impostazioni,
  salva,
  apriImpostazioni
}: {
  impostazioni: Impostazioni
  salva: (m: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  return (
    <Pannello>
      <ControlliAudio
        impostazioni={impostazioni}
        salva={salva}
        apriImpostazioni={apriImpostazioni}
      />
    </Pannello>
  )
}

function MenuCamera({
  impostazioni,
  salva,
  accesa
}: {
  impostazioni: Impostazioni
  salva: (m: Partial<Impostazioni>) => void
  accesa: boolean
}): React.JSX.Element {
  const { per } = usaDispositivi()
  const video = useRef<HTMLVideoElement>(null)
  const [errore, setErrore] = useState<string | null>(null)

  // L'anteprima apre una cattura sua, anche a camera spenta: serve proprio a
  // vedere come si viene inquadrati PRIMA di accendere. Si chiude uscendo dal
  // menu, altrimenti resterebbe la spia accesa senza che nessuno la veda.
  useEffect(() => {
    let stream: MediaStream | null = null
    let vivo = true

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: impostazioni.cameraId ? { deviceId: { exact: impostazioni.cameraId } } : true
        })
        if (!vivo) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        if (video.current) video.current.srcObject = stream
      } catch (e) {
        if (vivo) setErrore((e as Error).message)
      }
    })()

    return () => {
      vivo = false
      if (stream) for (const t of stream.getTracks()) t.stop()
    }
  }, [impostazioni.cameraId])

  return (
    <Pannello>
      <div>
        <Etichetta>Camera</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.cameraId ?? ''}
          onChange={(e) => salva({ cameraId: e.target.value || null })}
        >
          <option value="">Predefinita</option>
          {per('videoinput').map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Camera senza nome'}
            </option>
          ))}
        </select>
      </div>

      <div className="aspect-video overflow-hidden rounded-lg bg-fondo">
        {errore ? (
          <p className="p-3 text-[11px] text-attenzione">Non riesco ad aprirla: {errore}</p>
        ) : (
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            // Specchiata come tutte le anteprime: ci si aggiusta guardandosi, e
            // guardarsi al contrario non funziona.
            className="h-full w-full -scale-x-100 object-cover"
          />
        )}
      </div>

      <p className="text-[11px] text-testo-3">
        {accesa ? 'Stanno vedendo questa.' : 'Anteprima: non la sta vedendo nessuno.'}
      </p>
    </Pannello>
  )
}

function MenuCondivisioni({
  schermi,
  presetDi,
  cambiaQualita,
  smetti
}: {
  schermi: { id: string; etichetta: string }[]
  presetDi: (id: string) => string | null
  cambiaQualita: (id: string, presetId: string) => void
  smetti: (id: string) => void
}): React.JSX.Element {
  return (
    <Pannello>
      <Etichetta>Stai condividendo</Etichetta>
      <div className="space-y-3">
        {schermi.map((schermo) => (
          <div key={schermo.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-testo">{schermo.etichetta}</span>
              <button
                onClick={() => smetti(schermo.id)}
                title={`Smetti di condividere ${schermo.etichetta}`}
                aria-label={`Smetti di condividere ${schermo.etichetta}`}
                className="shrink-0 text-male hover:opacity-80"
              >
                <SchermoStop className="h-4 w-4" />
              </button>
            </div>
            <select
              className={CLASSI_SELECT}
              value={presetDi(schermo.id) ?? ''}
              onChange={(e) => cambiaQualita(schermo.id, e.target.value)}
            >
              {presetDi(schermo.id) === null && <option value="">Qualita sconosciuta</option>}
              {PRESET_SCHERMO.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-testo-3">
        Cambiare qualita non interrompe niente: chi guarda non vede nessun salto.
      </p>
    </Pannello>
  )
}

/**
 * I volumi degli audio condivisi, i propri e quelli degli altri.
 *
 * Due elenchi separati perche' sono due cose diverse: sopra c'e' quanto forte
 * esce da te — muoverlo cambia cio' che sentono gli altri — e sotto quanto
 * forte arriva a te, che non tocca nessun altro. Metterli insieme senza dirlo
 * significherebbe far abbassare la musica a tutta la stanza a chi voleva solo
 * sentirla meno lui.
 */
function MenuAudio({
  miei,
  loro,
  volumeMio,
  mutoMio,
  volumeLoro,
  mutoLoro
}: {
  miei: AudioCondiviso[]
  loro: AudioRemoto[]
  volumeMio: (id: string, volume: number) => void
  mutoMio: (id: string) => void
  volumeLoro: (id: string, volume: number) => void
  mutoLoro: (id: string) => void
}): React.JSX.Element {
  return (
    <Pannello>
      {miei.length > 0 && (
        <div>
          <Etichetta>Stai condividendo</Etichetta>
          <div className="space-y-2">
            {miei.map((a) => (
              <RigaAudio
                key={a.id}
                nome={a.etichetta}
                sotto="quanto forte esce da te"
                volume={a.volume}
                muto={a.muto}
                cambia={(v) => volumeMio(a.id, v)}
                alterna={() => mutoMio(a.id)}
              />
            ))}
          </div>
        </div>
      )}

      {loro.length > 0 && (
        <div>
          <Etichetta>Stai ascoltando</Etichetta>
          <div className="space-y-2">
            {loro.map((a) => (
              <RigaAudio
                key={a.id}
                nome={a.etichetta}
                sotto={`da ${a.nome} — solo per te`}
                volume={a.volume}
                muto={a.muto}
                cambia={(v) => volumeLoro(a.id, v)}
                alterna={() => mutoLoro(a.id)}
              />
            ))}
          </div>
        </div>
      )}
    </Pannello>
  )
}

function RigaAudio({
  nome,
  sotto,
  volume,
  muto,
  cambia,
  alterna
}: {
  nome: string
  sotto: string
  volume: number
  muto: boolean
  cambia: (volume: number) => void
  alterna: () => void
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={alterna}
          title={muto ? `Riattiva ${nome}` : `Zittisci ${nome}`}
          aria-label={muto ? `Riattiva ${nome}` : `Zittisci ${nome}`}
          className={`shrink-0 ${muto ? 'text-male' : 'text-testo-3 hover:text-testo'}`}
        >
          {muto ? <AltoparlanteMuto className="h-4 w-4" /> : <Altoparlante className="h-4 w-4" />}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-testo">{nome}</span>
          <span className="block truncate text-[10px] text-testo-3">{sotto}</span>
        </span>
        <span className="numeri shrink-0 text-[10px] text-testo-3">
          {Math.round(volume * 100)}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => cambia(Number(e.target.value))}
        aria-label={`Volume di ${nome}`}
        className="mt-1 w-full"
      />
    </div>
  )
}
