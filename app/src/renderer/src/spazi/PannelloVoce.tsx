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
  spazio,
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
  /**
   * Dove sta quel canale: il nome dello spazio, o "Messaggi diretti".
   *
   * Il nome del canale da solo non basta a ritrovare la strada. Con quattro
   * server aperti "Salotto" ce l'hanno in tre, e chi legge la riga verde
   * sapeva di essere in chiamata ma non in quale casa: la riga diceva dove si
   * sta parlando senza dire dove guardare per tornarci.
   */
  spazio: string
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
    <div className="space-y-1.5 border-t border-bordo bg-fondo-2/95 p-1.5 backdrop-blur">
      {/* Dove si sta parlando, e come si torna a guardarlo.

          Due righe e non una: il canale in grande, lo spazio sotto in piccolo.
          Tutto il blocco e' il pulsante che riporta dentro — non "dentro alla
          chiamata", che non si e' mai usciti, ma alla pagina di quella
          chiamata, nel server giusto. */}
      <div className="flex items-center gap-1 rounded-2xl border border-ok/25 bg-ok/[0.06] p-1">
        <button
          onClick={torna}
          disabled={guardando}
          title={guardando ? `${canale} — ${spazio}` : `Torna in ${canale} — ${spazio}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors disabled:cursor-default enabled:hover:bg-ok/10"
        >
          <Altoparlante className="h-4 w-4 shrink-0 text-ok" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-xs font-semibold text-ok">{canale}</span>
            <span className="block truncate text-[10px] text-testo-3">{spazio}</span>
          </span>
        </button>

        <Latenza valore={latenza} collegando={collegando} />

        <Scatola tono="male" titolo="Esci dalla chiamata" premi={esci}>
          <Esci />
        </Scatola>
      </div>

      {/* Chi sono, e tutto cio' che si comanda da qui.

          Una scatola sola, arrotondata e con un fondo suo: prima erano tre
          righe separate da un filo, e l'occhio non trovava piu' il confine fra
          "la chiamata" e "io". E ogni comando ha la sua scatola, perche' sei
          icone appoggiate sullo stesso fondo si leggono come una striscia
          unica: si mira quella accanto a quella che si voleva. */}
      <div className="rounded-2xl border border-bordo bg-fondo-3/40 p-1.5">
        <button
          onClick={apriProfilo}
          title={`${utente.nome} — apri il profilo`}
          className="flex w-full min-w-0 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-fondo-3"
        >
          <span className="relative shrink-0">
            {utente.avatar ? (
              <img src={utente.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-black/75"
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
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-testo">
            {utente.nome}
          </span>
        </button>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Scatola
              tono={microfonoAcceso ? 'normale' : 'male'}
              titolo={microfonoAcceso ? 'Zittisci il microfono' : 'Riaccendi il microfono'}
              premi={alternaMicrofono}
              secondario={{
                titolo: 'Impostazioni del microfono',
                premi: () => setMenuMicrofono((v) => !v)
              }}
            >
              {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
            </Scatola>
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
          <Scatola
            tono={sordina ? 'male' : 'normale'}
            titolo={sordina ? 'Riattiva tutto' : 'Silenzia tutto: non senti e non ti sentono'}
            premi={alternaSordina}
          >
            {sordina ? <CuffieSpente /> : <Cuffie />}
          </Scatola>

          <Scatola
            acceso={cameraAccesa}
            titolo={cameraAccesa ? 'Spegni la camera' : 'Accendi la camera'}
            premi={alternaCamera}
          >
            {cameraAccesa ? <Camera /> : <CameraSpenta />}
          </Scatola>

          <Scatola
            acceso={condivide}
            titolo={
              condivide
                ? 'Stai condividendo: apri di nuovo la scelta di cosa mostrare'
                : 'Condividi uno schermo, una finestra o un audio'
            }
            premi={apriCondivisione}
          >
            <SchermoCondividi />
          </Scatola>

          <Scatola
            titolo={
              riascoltoAttivo
                ? `Riascolta gli ultimi ${secondiRiascolto} secondi`
                : 'Riascolto spento: si riaccende nelle impostazioni, sezione Audio'
            }
            premi={riascoltoAttivo ? riascolta : apriImpostazioni}
            spento={!riascoltoAttivo}
          >
            <Riavvolgi />
          </Scatola>

          <Scatola titolo="Impostazioni" premi={apriImpostazioni}>
            <Ingranaggio />
          </Scatola>
        </div>
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

/**
 * Un comando dentro alla sua scatola.
 *
 * La scatola non e' decorazione: e' cio' che rende mirabile un pulsante da
 * trentasei pixel in fondo a una colonna. Sei icone appoggiate sullo stesso
 * fondo si leggono come una striscia unica — si vede il gruppo, non i singoli
 * — e in una chiamata il pulsante che si sbaglia e' quello che spegne il
 * microfono mentre si voleva la camera.
 *
 * Il colore dice lo stato prima del simbolo: rosso cio' che e' spento e non
 * dovrebbe, verde cio' che sta uscendo da qui, neutro il resto.
 */
function Scatola({
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
    ? 'border-bordo/60 bg-fondo/40 text-testo-3/60 hover:border-bordo hover:text-testo-3'
    : tono === 'male'
      ? 'border-male/40 bg-male/10 text-male hover:bg-male/20'
      : acceso
        ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20'
        : 'border-bordo bg-fondo text-testo-2 hover:border-fondo-3 hover:bg-fondo-3 hover:text-testo'

  return (
    <span className="relative inline-flex shrink-0">
      <button
        onClick={premi}
        title={titolo}
        aria-label={titolo}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${colore} [&>svg]:h-[18px] [&>svg]:w-[18px]`}
      >
        {children}
      </button>
      {/* Nell'angolo e non di fianco: una colonna a parte accanto al microfono
          spezzava la fila di scatole tutte uguali, che e' proprio la cosa che
          le rende leggibili di sfuggita. */}
      {secondario && (
        <button
          onClick={secondario.premi}
          title={secondario.titolo}
          aria-label={secondario.titolo}
          className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-md border border-bordo bg-fondo-2 text-testo-3 transition-colors hover:border-fondo-3 hover:text-testo"
        >
          <span className="text-[8px] leading-none">▾</span>
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
