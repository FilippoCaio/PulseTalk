import { useState } from 'react'
import { ConnectionState } from 'livekit-client'
import type { Impostazioni, StatoUtente, Utente } from '@shared/tipi'
import ControlliAudio from '../ControlliAudio'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import {
  Altoparlante,
  Camera,
  CameraSpenta,
  Cuffie,
  CuffieSpente,
  Esci,
  Ingranaggio,
  Microfono,
  MicrofonoSpento,
  Riavvolgi,
  SchermoCondividi
} from '../icone'

/**
 * Il pannello della chiamata, in basso a sinistra.
 *
 * Copre tutte e due le colonne — quella degli spazi e quella dei canali —
 * perche' e' il comando che vale sopra a entrambe: la chiamata continua
 * qualunque spazio si stia guardando, e un pannello largo quanto una sola
 * colonna suggerirebbe il contrario.
 *
 * Le cuffie che silenziano tutto stanno qui e in nessun altro posto. Nella
 * barra della chiamata non ci sono apposta: due pulsanti per lo stesso stato
 * vogliono dire due posti da tenere d'accordo, e prima o poi uno dei due mente.
 */
export default function PannelloVoce({
  utente,
  canale,
  stato,
  latenza,
  microfonoAcceso,
  cameraAccesa,
  sordina,
  condivide,
  riascoltoAttivo,
  secondiRiascolto,
  guardando,
  alternaMicrofono,
  alternaCamera,
  alternaSordina,
  apriCondivisione,
  riascolta,
  torna,
  esci,
  apriProfilo,
  impostazioni,
  salva,
  apriImpostazioni
}: {
  utente: Utente
  canale: string
  stato: ConnectionState
  latenza: number | null
  microfonoAcceso: boolean
  cameraAccesa: boolean
  sordina: boolean
  condivide: boolean
  riascoltoAttivo: boolean
  secondiRiascolto: number
  /** Vero se si sta gia' guardando la stanza: allora "torna" non serve. */
  guardando: boolean
  alternaMicrofono: () => void
  alternaCamera: () => void
  alternaSordina: () => void
  apriCondivisione: () => void
  riascolta: () => void
  torna: () => void
  esci: () => void
  apriProfilo: () => void
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  const [menuMicrofono, setMenuMicrofono] = useState(false)
  const collegando = stato === ConnectionState.Reconnecting

  return (
    <div className="border-t border-bordo bg-fondo-2/95 px-2 py-2 backdrop-blur">
      {/* Riga uno: dove sei, quanto ci mette la voce ad arrivare, e come si esce. */}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={torna}
          disabled={guardando}
          title={guardando ? canale : `Torna in ${canale}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          <Altoparlante className="h-3.5 w-3.5 shrink-0 text-ok" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ok">{canale}</span>
        </button>

        <Latenza valore={latenza} collegando={collegando} />

        <button
          onClick={esci}
          title="Esci dalla chiamata"
          aria-label="Esci dalla chiamata"
          className="shrink-0 text-male hover:opacity-80"
        >
          <Esci className="h-4 w-4" />
        </button>
      </div>

      {/* Riga due: cosa mando. Qui i comandi non hanno sottomenu — le scelte
          stanno nella barra dentro alla chiamata, dove si vede cosa cambia. */}
      <div className="mt-2 flex items-center gap-1">
        <Comando
          acceso={cameraAccesa}
          titolo={cameraAccesa ? 'Spegni la camera' : 'Accendi la camera'}
          premi={alternaCamera}
        >
          {cameraAccesa ? <Camera /> : <CameraSpenta />}
        </Comando>

        <Comando
          acceso={condivide}
          titolo={condivide ? 'Stai condividendo' : 'Condividi lo schermo'}
          premi={apriCondivisione}
        >
          <SchermoCondividi />
        </Comando>

        <Comando
          titolo={
            riascoltoAttivo
              ? `Riascolta gli ultimi ${secondiRiascolto} secondi`
              : 'Riascolto spento: si riaccende nelle impostazioni, sezione Audio'
          }
          premi={riascoltoAttivo ? riascolta : apriImpostazioni}
          spento={!riascoltoAttivo}
        >
          <Riavvolgi />
        </Comando>
      </div>

      {/* Riga tre: chi sono, e i due comandi che valgono ovunque. */}
      <div className="mt-2 flex items-center gap-1 border-t border-bordo pt-2">
        <button
          onClick={apriProfilo}
          title={utente.nome}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-fondo-3"
        >
          <span className="relative shrink-0">
            {utente.avatar ? (
              <img src={utente.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-black/75"
                style={{ background: coloreDi(`u${utente.id}`) }}
              >
                {inizialiDi(utente.nome)}
              </span>
            )}
            <PallinoStato
              stato={(utente.stato ?? 'online') as StatoUtente}
              className="h-2.5 w-2.5"
            />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-testo">{utente.nome}</span>
        </button>

        <div className="relative shrink-0">
          <Comando
            tono={microfonoAcceso ? 'normale' : 'male'}
            titolo={microfonoAcceso ? 'Zittisci il microfono' : 'Riaccendi il microfono'}
            premi={alternaMicrofono}
            secondario={{
              titolo: 'Impostazioni del microfono',
              premi: () => setMenuMicrofono((v) => !v)
            }}
          >
            {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
          </Comando>
          {menuMicrofono && (
            <MenuRapido
              impostazioni={impostazioni}
              salva={salva}
              chiudi={() => setMenuMicrofono(false)}
              apriImpostazioni={() => {
                setMenuMicrofono(false)
                apriImpostazioni()
              }}
            />
          )}
        </div>

        {/* L'unico posto in cui si spegne l'ascolto. */}
        <Comando
          tono={sordina ? 'male' : 'normale'}
          titolo={sordina ? 'Riattiva tutto' : 'Silenzia tutto: non senti e non ti sentono'}
          premi={alternaSordina}
        >
          {sordina ? <CuffieSpente /> : <Cuffie />}
        </Comando>

        <Comando titolo="Impostazioni" premi={apriImpostazioni}>
          <Ingranaggio />
        </Comando>
      </div>
    </div>
  )
}

/**
 * I millisecondi verso il server.
 *
 * Il numero compare passandoci sopra e non sempre: una cifra che cambia da
 * sola ogni tre secondi in un angolo dell'occhio e' una distrazione continua,
 * mentre il colore delle tacche dice gia' tutto quello che serve sapere a
 * colpo d'occhio.
 */
function Latenza({
  valore,
  collegando
}: {
  valore: number | null
  collegando: boolean
}): React.JSX.Element {
  const colore = collegando
    ? 'text-attenzione'
    : valore === null
      ? 'text-testo-3'
      : valore < 60
        ? 'text-ok'
        : valore < 150
          ? 'text-attenzione'
          : 'text-male'

  const titolo = collegando
    ? 'Sto riprendendo la linea'
    : valore === null
      ? 'Non ancora misurata'
      : `${valore} ms verso il server`

  return (
    <span
      title={titolo}
      className={`group/lat flex shrink-0 items-end gap-px ${colore}`}
      aria-label={titolo}
    >
      <span className="numeri mr-1 hidden text-[10px] group-hover/lat:inline">
        {valore === null ? '—' : `${valore}ms`}
      </span>
      {[3, 5, 7].map((altezza, i) => (
        <span
          key={altezza}
          className="w-[3px] rounded-sm bg-current"
          style={{
            height: altezza,
            // Le tacche oltre la qualita' misurata restano smorte: e' la
            // lettura immediata, quella che si fa senza fermarsi a leggere.
            opacity: valore === null ? 0.25 : i < tacche(valore) ? 1 : 0.25
          }}
        />
      ))}
    </span>
  )
}

function tacche(ms: number): number {
  if (ms < 60) return 3
  if (ms < 150) return 2
  return 1
}

function Comando({
  children,
  titolo,
  premi,
  acceso = false,
  spento = false,
  tono = 'normale',
  secondario
}: {
  children: React.ReactNode
  titolo: string
  premi: () => void
  acceso?: boolean
  /** Presente ma disattivato: si vede che esiste, e il titolo dice perche'. */
  spento?: boolean
  tono?: 'normale' | 'male'
  /** La freccetta accanto, per chi ne ha una. */
  secondario?: { titolo: string; premi: () => void }
}): React.JSX.Element {
  const colore = spento
    ? 'text-testo-3/60 hover:bg-fondo-3 hover:text-testo-3'
    : tono === 'male'
      ? 'text-male hover:bg-male/10'
      : acceso
        ? 'text-ok hover:bg-ok/10'
        : 'text-testo-2 hover:bg-fondo-3 hover:text-testo'

  return (
    <span className="flex items-center">
      <button
        onClick={premi}
        title={titolo}
        aria-label={titolo}
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${colore} [&>svg]:h-[17px] [&>svg]:w-[17px]`}
      >
        {children}
      </button>
      {secondario && (
        <button
          onClick={secondario.premi}
          title={secondario.titolo}
          aria-label={secondario.titolo}
          className="-ml-1 flex h-8 w-3 items-center justify-center rounded-lg text-testo-3 hover:text-testo"
        >
          <span className="text-[9px] leading-none">▾</span>
        </button>
      )}
    </span>
  )
}

/**
 * Il menu della freccetta accanto al microfono.
 *
 * Contiene gli stessi controlli della barra sospesa della chiamata: sono lo
 * stesso componente, quindi dispositivi e volumi non possono divergere.
 */
function MenuRapido({
  impostazioni,
  salva,
  chiudi,
  apriImpostazioni
}: {
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  chiudi: () => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={chiudi} />
      {/* Si apre verso destra, non verso sinistra.
          Ancorato a `right-0` il pannello cresceva di 18rem partendo dal bordo
          destro del pulsante — che sta in fondo alla colonna di sinistra, a
          meno di 18rem dal bordo della finestra: il menu usciva dallo schermo e
          i nomi dei dispositivi restavano tagliati a meta'. Da qui c'e' tutta
          la larghezza della chiamata davanti. */}
      <div className="absolute bottom-full left-0 z-50 mb-1 w-72 space-y-3 rounded-xl border border-bordo bg-fondo-2 p-3 shadow-xl shadow-black/40">
        <ControlliAudio
          impostazioni={impostazioni}
          salva={salva}
          apriImpostazioni={apriImpostazioni}
        />
      </div>
    </>
  )
}
