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
        {/* Il nome e i millisecondi stanno insieme, a sinistra, e il vuoto
            resta fra loro e l'uscita.

            La latenza prima galleggiava all'altro capo della riga, appiccicata
            al pulsante rosso: la si leggeva come un pezzo dell'uscita, e per
            capire se il numero riguardava questa chiamata bisognava ricordarsi
            che di chiamate ce n'e' una sola. Attaccata al nome del canale non
            c'e' niente da ricordare — dice il ritardo *di quel canale li'*,
            e si legge nello stesso colpo d'occhio.

            Per questo il pulsante del ritorno non e' piu' `flex-1`: cresceva
            fino a riempire la riga e spingeva il numero fuori dalla vista del
            nome. Adesso e' largo quanto il testo che porta, si stringe se il
            nome e' lungo, e lo spazio che avanza sta dopo. */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            onClick={torna}
            disabled={guardando}
            title={guardando ? `${canale} — ${spazio}` : `Torna in ${canale} — ${spazio}`}
            className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors disabled:cursor-default enabled:hover:bg-ok/10"
          >
            <Altoparlante className="h-4 w-4 shrink-0 text-ok" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-xs font-semibold text-ok">{canale}</span>
              <span className="block truncate text-[10px] text-testo-3">{spazio}</span>
            </span>
          </button>

          <Latenza
            valore={latenza}
            collegando={collegando}
            statistiche={impostazioni.mostraStatistiche}
            alterna={() => salva({ mostraStatistiche: !impostazioni.mostraStatistiche })}
          />
        </div>

        {/* Quadrato, come tutti gli altri comandi.

            Portava addosso le classi della `Scatola`, che nella fila qui sotto
            deve crescere per dividersi la riga con le altre cinque — e qui,
            dove di scatole ce n'e' una sola, quella crescita se la prendeva
            tutta: un rettangolo lungo un terzo del pannello per un'icona da
            diciotto pixel. Un pulsante largo cosi' si legge come il comando
            principale della riga, mentre e' quello che si preme una volta per
            chiamata, alla fine. */}
        <button
          onClick={esci}
          title="Esci dalla chiamata"
          aria-label="Esci dalla chiamata"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-male/40 bg-male/10 text-male transition-colors hover:bg-male/20 [&>svg]:h-[18px] [&>svg]:w-[18px]"
        >
          <Esci />
        </button>
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

        {/* Le scatole si dividono la riga per intero.

            Sei quadrati da trentasei pixel dentro a un pannello da diciannove
            rem lasciavano un dito di vuoto a destra, e una fila che finisce
            prima del suo contenitore si legge come una fila incompleta —
            sembra che manchi un pulsante, non che ce ne siano sei. Crescendo
            arrivano a tutti e due i bordi e la fila si chiude.

            `basis-9` e non `basis-0`, ed e' la riga che tiene in piedi anche
            l'altro caso: la base e' la misura che avevano prima, ed e' quella
            che `flex-wrap` guarda per decidere quando andare a capo. Con base
            zero nessuno supera mai la larghezza disponibile, quindi non si va
            a capo mai — e nella colonna stretta, quella senza spazi aperti,
            invece di impilarsi si sarebbero schiacciate in sei fessure da
            cinque pixel. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <div className="relative flex shrink-0 grow basis-9">
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
 * I millisecondi verso il server, e il comando che apre i numeri veri.
 *
 * Prima era una spia: tre tacche colorate, e il numero solo passandoci sopra.
 * La regola dietro era buona — una cifra che cambia da sola ogni tre secondi
 * in un angolo dell'occhio e' una distrazione continua — ma pagata cara: il
 * numero c'era e nessuno sapeva che ci fosse, perche' niente invitava a
 * passarci sopra.
 *
 * Adesso il numero si vede sempre, e a tenerlo tranquillo ci pensa la
 * larghezza fissa delle cifre invece della sua assenza: `numeri` e' tabulare,
 * quindi 9 ms e 148 ms occupano lo stesso posto e niente si sposta quando la
 * misura cambia.
 *
 * E ha un fondo suo, con un bordo. Non e' decorazione: e' cio' che dice che
 * qui *si preme*. Un testo appoggiato sulla riga verde accanto a due pulsanti
 * si legge come un'etichetta, e un'etichetta non la clicca nessuno — il che
 * era vero anche prima, ma allora non c'era niente da cliccare.
 *
 * Cosa fa premendolo: accende e spegne i numeri veri sopra a ogni riquadro
 * della sala — risoluzione, fotogrammi, bitrate. E' la stessa domanda posta
 * piu' in grande: questa spia dice *quanto ci mette*, quelle statistiche
 * dicono *cosa ne esce*, e chi guarda la prima perche' qualcosa non va e'
 * esattamente chi vuole le seconde.
 */
function Latenza({
  valore,
  collegando,
  statistiche,
  alterna
}: {
  valore: number | null
  collegando: boolean
  /** Se i numeri sopra ai riquadri sono accesi adesso. */
  statistiche: boolean
  alterna: () => void
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

  const misura = collegando
    ? 'Sto riprendendo la linea'
    : valore === null
      ? 'Latenza non ancora misurata'
      : `${valore} ms verso il server`

  const titolo = `${misura} — premi per ${
    statistiche ? 'nascondere' : 'mostrare'
  } i numeri sopra ai riquadri`

  return (
    <button
      onClick={alterna}
      title={titolo}
      aria-label={titolo}
      aria-pressed={statistiche}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors ${
        statistiche
          ? 'border-ok/40 bg-ok/10 hover:bg-ok/20'
          : 'border-bordo bg-fondo/60 hover:border-fondo-3 hover:bg-fondo'
      } ${colore}`}
    >
      <span className="numeri text-[10px] leading-none tabular-nums">
        {collegando ? '•••' : valore === null ? '—' : `${valore}ms`}
      </span>
      <span className="flex items-end gap-px" aria-hidden="true">
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
    </button>
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
    <span className="relative inline-flex w-full shrink-0 grow basis-9">
      <button
        onClick={premi}
        title={titolo}
        aria-label={titolo}
        className={`flex h-9 w-full items-center justify-center rounded-xl border transition-colors ${colore} [&>svg]:h-[18px] [&>svg]:w-[18px]`}
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
