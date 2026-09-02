import { useState } from 'react'
import { ConnectionState } from 'livekit-client'
import type { Impostazioni } from '@shared/tipi'
import ControlliAudio from '../ControlliAudio'
import { scriviTempoInsieme } from '../lib/usaTempoInsieme'
import {
  Altoparlante,
  Camera,
  CameraSpenta,
  Cuffie,
  CuffieSpente,
  Esci,
  Microfono,
  MicrofonoSpento,
  SchermoCondividi
} from '../icone'

/**
 * Il pannello della chiamata, in fondo alla colonna di sinistra.
 *
 * E' largo quanto quella colonna, e vale sopra a tutto quello che ci si
 * sfoglia dentro: la chiamata continua qualunque spazio si stia guardando.
 * Copriva anche la colonna degli spazi, quando gli spazi erano una colonna.
 *
 * Dentro ci sono due cose e basta: dove si sta parlando - con il ritardo e il
 * pulsante rosso per uscire - e i cinque comandi in una riga.
 *
 * Chi si e' non c'e' piu': ritratto, nome e stato stanno in cima a sinistra,
 * nella riga degli spazi, e tenerli anche qui sotto voleva dire la stessa
 * faccia due volte a venti pixel di distanza. Con il nome se n'e' andata anche
 * la ragione per cui i comandi stavano su due file: la prima portava il nome,
 * ed era il nome a dire che quei tre - microfono, ascolto, impostazioni -
 * riguardavano la persona e non la stanza. Senza, erano due file di quadrati
 * identici divise da un confine che non si vedeva piu'.
 *
 * Le cuffie che silenziano tutto stanno qui e in nessun altro posto. Nella
 * barra della chiamata non ci sono apposta: due pulsanti per lo stesso stato
 * vogliono dire due posti da tenere d'accordo, e prima o poi uno dei due mente.
 */
export default function PannelloVoce({
  canale,
  secondiInChiamata,
  spazio,
  stato,
  latenza,
  microfonoAcceso,
  cameraAccesa,
  sordina,
  condivide,
  guardando,
  alternaMicrofono,
  alternaCamera,
  alternaSordina,
  apriCondivisione,
  torna,
  esci,
  impostazioni,
  salva,
  apriImpostazioni
}: {
  canale: string
  /** Da quanti secondi si e' in questa chiamata. Nullo finche' non si sa. */
  secondiInChiamata: number | null
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
  /** Vero se si sta gia' guardando la stanza: allora "torna" non serve. */
  guardando: boolean
  alternaMicrofono: () => void
  alternaCamera: () => void
  alternaSordina: () => void
  apriCondivisione: () => void
  torna: () => void
  esci: () => void
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  const [menuMicrofono, setMenuMicrofono] = useState(false)
  // Due tendine e non una condivisa: aprendone una si chiude l'altra (vedi i
  // due `premi`), ma tenerle in due stati separati e' cio' che permette alla
  // freccetta di ciascuna di sapere se e' la sua a essere aperta.
  const [menuUscita, setMenuUscita] = useState(false)
  const collegando = stato === ConnectionState.Reconnecting

  return (
    // `@container` e non un breakpoint della finestra: questo pannello e' largo
    // 19rem quando c'e' uno spazio aperto e 64 pixel quando non c'e', e la
    // finestra non cambia di un pixel fra i due casi. Cio' che sta dentro deve
    // guardare il proprio contenitore, non lo schermo.
    <div className="@container space-y-1.5 border-t border-bordo bg-fondo-2/95 p-1.5 backdrop-blur">
      {/* Dove si sta parlando, e come si torna a guardarlo.

          Due righe e non una: il canale in grande, lo spazio sotto in piccolo.
          Tutto il blocco e' il pulsante che riporta dentro — non "dentro alla
          chiamata", che non si e' mai usciti, ma alla pagina di quella
          chiamata, nel server giusto. */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-ok/25 bg-ok/[0.06] p-1">
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
        <div className="flex min-w-0 flex-1 basis-24 items-start gap-1">
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

          {/* I millisecondi in cima, allineati al nome del canale, e sotto da
              quanto si e' in chiamata.

              Prima la latenza era centrata sulla riga, cioe' a meta' fra le due
              righe del nome: un numero che galleggia fra due testi sembra
              appartenere a tutti e due e a nessuno. In cima e' alla stessa
              altezza del nome del canale, e si legge come una cosa **di quel
              canale li'**.

              Il cronometro sotto risponde all'altra domanda che ci si fa
              guardando quel riquadro mentre si sta leggendo altrove: non «come
              va la linea» ma «da quanto sono qui». */}
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <Latenza
              valore={latenza}
              collegando={collegando}
              statistiche={impostazioni.mostraStatistiche}
              alterna={() => salva({ mostraStatistiche: !impostazioni.mostraStatistiche })}
            />
            {secondiInChiamata !== null && (
              <span
                className="numeri px-1 text-[10px] leading-tight text-testo-3"
                title="Da quanto sei in questa chiamata"
              >
                {scriviTempoInsieme(secondiInChiamata)}
              </span>
            )}
          </div>
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
          className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-male/40 bg-male/10 text-male transition-colors hover:bg-male/20 [&>svg]:h-[18px] [&>svg]:w-[18px]"
        >
          <Esci />
        </button>
      </div>

      {/* I cinque comandi, in una riga sola.

          Qui sopra c'era anche chi si e': ritratto, nome e pallino dello
          stato, con accanto i tre comandi che riguardano la persona e sotto
          quelli che riguardano la stanza. Adesso l'utente sta in cima a
          sinistra, nella riga degli spazi, e ripeterlo qui sotto vorrebbe dire
          due volte la stessa faccia a venti pixel di distanza.

          Restano i cinque comandi, tutti sulla stessa riga e tutti larghi
          uguali: microfono, ascolto, camera, condivisione, impostazioni. La
          divisione fra «cose mie» e «cose di questa stanza» - due file
          separate - aveva senso finche' la prima fila portava anche il nome:
          era il nome a dire di chi fossero quei tre. Senza, erano due file di
          quadrati identici divise da un confine che non si vedeva piu'.

          `basis-9` e non `basis-0`: la base e' la misura che avevano da sole,
          ed e' quella che `flex-wrap` guarda per decidere quando andare a
          capo. Con base zero nessuno supera mai la larghezza disponibile,
          quindi non si andrebbe a capo mai - e nella colonna stretta le cinque
          scatole si schiaccerebbero in fessure da pochi pixel invece di
          impilarsi. */}
      <div className="rounded-2xl border border-bordo bg-fondo-3/40 p-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="relative flex grow basis-9">
            <Scatola
              tono={microfonoAcceso ? 'normale' : 'male'}
              titolo={microfonoAcceso ? 'Zittisci il microfono' : 'Riaccendi il microfono'}
              premi={alternaMicrofono}
              secondario={{
                titolo: 'Microfono: dispositivo e volume in entrata',
                premi: () => {
                  setMenuUscita(false)
                  setMenuMicrofono((v) => !v)
                }
              }}
            >
              {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
            </Scatola>
            {menuMicrofono && (
              <MenuRapido
                lato="entrata"
                impostazioni={impostazioni}
                salva={salva}
                chiudi={() => setMenuMicrofono(false)}
                apriImpostazioni={() => {
                  setMenuMicrofono(false)
                  apriImpostazioni()
                }}
              />
            )}
          </span>

          {/* L'unico posto in cui si spegne l'ascolto, e anche quello in cui si
              sceglie da dove esce. La freccetta e' la stessa del microfono
              perche' la domanda e' la stessa, dall'altro lato: prima
              l'altoparlante stava dentro alla tendina del microfono, cioe'
              l'ultimo posto in cui uno va a cercarlo. */}
          <span className="relative flex grow basis-9">
            <Scatola
              tono={sordina ? 'male' : 'normale'}
              titolo={sordina ? 'Riattiva tutto' : 'Silenzia tutto: non senti e non ti sentono'}
              premi={alternaSordina}
              secondario={{
                titolo: 'Ascolto: dispositivo e volume in uscita',
                premi: () => {
                  setMenuMicrofono(false)
                  setMenuUscita((v) => !v)
                }
              }}
            >
              {sordina ? <CuffieSpente /> : <Cuffie />}
            </Scatola>
            {menuUscita && (
              <MenuRapido
                lato="uscita"
                impostazioni={impostazioni}
                salva={salva}
                chiudi={() => setMenuUscita(false)}
                apriImpostazioni={() => {
                  setMenuUscita(false)
                  apriImpostazioni()
                }}
              />
            )}
          </span>

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

        </div>
      </div>
    </div>
  )
}

/**
 * I millisecondi verso il server, e l'interruttore dei numeri sui riquadri.
 *
 * Il numero si vede sempre, e a tenerlo tranquillo ci pensa la larghezza fissa
 * delle cifre invece della sua assenza: `numeri` e' tabulare, quindi 9 ms e
 * 148 ms occupano lo stesso posto e niente si sposta quando la misura cambia.
 *
 * ## Il comando e' tornato, ma con lo stato addosso
 *
 * Premendolo si accendono e si spengono le statistiche sopra ai riquadri. Era
 * cosi', poi e' diventato «apri le impostazioni» perche' qualcuno le aveva
 * spente per sbaglio senza capire cosa avesse premuto, e adesso e' di nuovo un
 * interruttore - ma il difetto di allora non era il comando, era che **non si
 * vedeva in che stato fosse**.
 *
 * Da spento il riquadro era identico a un'etichetta qualunque, quindi non
 * c'era niente che dicesse «c'e' una cosa spenta qui, e l'hai spenta tu». Ora
 * i due stati si distinguono senza leggere: acceso ha il fondo e il bordo del
 * verde di sistema e le cifre piene; spento e' smorto e ha le cifre a meta'
 * opacita'. Uno che si ritrova le statistiche sparite guarda li' e vede che
 * quel riquadro e' cambiato.
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

  const titolo = `${misura} — ${
    statistiche
      ? 'i numeri sopra ai riquadri sono accesi: premi per spegnerli'
      : 'i numeri sopra ai riquadri sono spenti: premi per accenderli'
  }`

  return (
    <button
      onClick={alterna}
      title={titolo}
      aria-label={titolo}
      aria-pressed={statistiche}
      className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors @min-[11rem]:flex ${
        statistiche
          ? 'border-ok/40 bg-ok/10 hover:bg-ok/20'
          : 'border-bordo/60 bg-fondo/40 opacity-60 hover:border-bordo hover:opacity-100'
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
  cresce = true,
  secondario
}: {
  children: React.ReactNode
  titolo: string
  premi: () => void
  acceso?: boolean
  /** Presente ma disattivato: si vede che esiste, e il titolo dice perche'. */
  spento?: boolean
  tono?: 'normale' | 'male'
  /**
   * Se allargarsi per riempire la riga.
   *
   * Vero nella fila dei comandi della stanza, dove tre scatole si dividono
   * tutta la larghezza. Falso accanto al nome, dove a crescere deve essere il
   * nome: li' queste restano quadrate, e un quadrato che si stira per
   * riempire un vuoto smette di sembrare un pulsante e comincia a sembrare
   * una barra.
   */
  cresce?: boolean
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
    <span
      className={`relative inline-flex shrink-0 ${cresce ? 'w-full grow basis-9' : 'w-9'}`}
    >
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
  lato,
  impostazioni,
  salva,
  chiudi,
  apriImpostazioni
}: {
  /** Quale meta' dei controlli: quella del microfono o quella dell'ascolto. */
  lato: 'entrata' | 'uscita'
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
          lato={lato}
          impostazioni={impostazioni}
          salva={salva}
          apriImpostazioni={apriImpostazioni}
        />
      </div>
    </>
  )
}
