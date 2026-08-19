import { useEffect, useRef, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import { PRESET_SCHERMO } from '@shared/qualita'
import { livelloMicrofono } from '../lib/pubblica'
import { usaDispositivi } from '../lib/usaDispositivi'
import {
  Camera,
  CameraSpenta,
  Esci,
  Ingranaggio,
  Microfono,
  MicrofonoSpento,
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
  const [aperto, setAperto] = useState<'microfono' | 'camera' | 'condivisioni' | null>(null)
  const scadenza = useRef<number | null>(null)

  // Il timer di sparizione, azzerato a ogni movimento del cursore: chi muove
  // il mouse sta cercando qualcosa, e quel qualcosa sta quasi sempre qui.
  useEffect(() => {
    const riavvia = (): void => {
      setVisibile(true)
      if (scadenza.current) window.clearTimeout(scadenza.current)
      scadenza.current = window.setTimeout(() => setVisibile(false), 2600)
    }

    riavvia()
    window.addEventListener('mousemove', riavvia)
    return () => {
      window.removeEventListener('mousemove', riavvia)
      if (scadenza.current) window.clearTimeout(scadenza.current)
    }
  }, [])

  const mostra = visibile || aperto !== null

  return (
    <div
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
        {aperto === 'condivisioni' && (
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
  const { per } = usaDispositivi()
  const [livello, setLivello] = useState(0)

  // La barra segue il microfono finche' il menu e' aperto. A fotogramma e non
  // a timer: e' l'unica cadenza in cui sembra rispondere alla voce invece di
  // inseguirla.
  useEffect(() => {
    let vivo = true
    const giro = (): void => {
      if (!vivo) return
      setLivello(livelloMicrofono())
      requestAnimationFrame(giro)
    }
    requestAnimationFrame(giro)
    return () => {
      vivo = false
    }
  }, [])

  // Scala compressa: la voce parlata sta fra 0.02 e 0.2 di valore efficace, e
  // su una scala lineare resterebbe tutta schiacciata contro il bordo.
  const percento = Math.min(100, (Math.sqrt(livello) / 0.6) * 100)

  return (
    <Pannello>
      <div>
        <Etichetta>Microfono</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.microfonoId ?? ''}
          onChange={(e) => salva({ microfonoId: e.target.value || null })}
        >
          <option value="">Predefinito di Windows</option>
          {per('audioinput').map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Microfono senza nome'}
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
          {per('audiooutput').map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Uscita senza nome'}
            </option>
          ))}
        </select>
      </div>

      <Cursore
        nome="Entrata"
        valore={impostazioni.volumeMicrofono ?? 1}
        massimo={2}
        cambia={(v) => salva({ volumeMicrofono: v })}
      />
      <Cursore
        nome="Uscita"
        valore={impostazioni.volumeUscita ?? 1}
        massimo={1}
        cambia={(v) => salva({ volumeUscita: v })}
      />

      <button
        onClick={apriImpostazioni}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-testo-2 hover:bg-fondo-3 hover:text-testo"
      >
        <Ingranaggio className="h-3.5 w-3.5" />
        Tutte le impostazioni audio
      </button>
    </Pannello>
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
  cambia: (v: number) => void
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
