import { useState, type ReactNode } from 'react'
import type { Spazio, Utente } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import OverlaySpazio from './OverlaySpazio'
import { Bottone, Campo, classiInput } from '../ui'
import { Fumetto, Piu, Utenti } from '../icone'

/**
 * Quanto sono smussati i quadrati dei server, a riposo e da scelti.
 *
 * Due valori e non uno: l'icona cambia forma quando la si apre o ci si passa
 * sopra, ed e' quel piccolo scatto — non un colore, non un bordo — la cosa
 * che dice "questo qui". Scritti una volta perche' li montano in quattro
 * posti — i messaggi diretti, ogni spazio, l'anello verde di chi sta
 * parlando, il piu' per crearne uno — e quattro copie a mano divergono al
 * primo ritocco: l'anello che non segue il raggio dell'icona sotto si vede
 * subito, perche' si stacca proprio negli angoli.
 *
 * Erano 24 e 16 pixel su un quadrato da 48, cioe' un cerchio che diventava
 * quasi un cerchio: la differenza fra riposo e scelto c'era ma andava cercata,
 * e con dodici server in colonna l'insieme era una fila di pastiglie tutte
 * uguali. A 12 e 6 restano quadrati con gli angoli tolti — la forma si
 * riconosce, l'iniziale dentro sta su una base larga invece che dentro a un
 * tondo, e il passaggio a scelto dimezza il raggio, che e' il salto che si
 * vede senza doverlo cercare.
 */
const RAGGIO_SCELTO = 'rounded-md'
/**
 * Il riposo porta con se' il suo `group-hover`, e non e' pignoleria di stile.
 *
 * Tailwind non gira: legge i sorgenti e genera solo le classi che ci trova
 * scritte per intero. `group-hover:${RAGGIO_SCELTO}` diventa
 * `group-hover:rounded-md` soltanto a schermo acceso — nel file c'e' un
 * pezzo di template, quindi quella regola nel foglio di stile non nascerebbe
 * mai e il cambio di forma sotto al cursore sparirebbe senza un errore da
 * nessuna parte. Scritte intere, invece, si vedono.
 */
const RAGGIO_RIPOSO = 'rounded-xl group-hover:rounded-md'
/** Lo stesso, per chi si accende da solo invece che dentro a un `group`. */
const RAGGIO_RIPOSO_SOLO = 'rounded-xl hover:rounded-md'

/**
 * La colonna delle icone, a sinistra di tutto.
 *
 * Stretta apposta: e' un indice, non un elenco. Il nome per esteso compare
 * passandoci sopra, perche' con quattro spazi le iniziali bastano e con venti
 * un elenco di nomi occuperebbe un quarto dello schermo per sempre.
 *
 * Il pallino a sinistra dice quale e' aperto e dove ci sono cose da leggere:
 * sono le due sole informazioni che servono guardando da lontano.
 */
export default function BarraSpazi({
  spazi,
  aperto,
  utente,
  scegli,
  crea,
  apriAmici,
  richieste,
  apriProfilo,
  apriDiretti,
  direttiAperti = false,
  direttiNonLetti = 0,
  inVoce = null,
  profili,
  intestazione,
  className = ''
}: {
  spazi: Spazio[]
  aperto: number | null
  utente: Utente
  scegli: (id: number) => void
  crea: (nome: string) => Promise<void>
  apriAmici: () => void
  /** Quante richieste di amicizia aspettano una risposta. */
  richieste: number
  /** Apre il pannello del profilo, quello con gli stati. */
  apriProfilo: () => void
  /** Apre la sezione dei messaggi diretti. */
  apriDiretti: () => void
  direttiAperti?: boolean
  /** Quanti messaggi diretti aspettano una risposta. */
  direttiNonLetti?: number
  /**
   * Il canale vocale in cui si sta parlando adesso.
   *
   * Serve al cartellino: passando sopra all'icona del server in cui c'e' la
   * chiamata, si vedono il canale e chi c'e' dentro senza doverci tornare.
   */
  inVoce?: number | null
  profili?: Map<number, { nome: string; avatar: string | null }>
  /**
   * Cosa sta sopra a tutto: il quadratino del server vero.
   *
   * Arriva da fuori invece di essere disegnato qui perche' non riguarda gli
   * spazi — riguarda la macchina su cui gli spazi stanno, e questa colonna e'
   * gia' piena di roba che parla di una macchina sola.
   */
  intestazione?: ReactNode
  className?: string
}): React.JSX.Element {
  const [creando, setCreando] = useState(false)
  const [nome, setNome] = useState('')
  const [inCorso, setInCorso] = useState(false)
  /**
   * Quale icona ha il cursore sopra, e dove sta sullo schermo.
   *
   * L'ancoraggio serve perche' il cartellino non puo' piu' posizionarsi da
   * solo rispetto al bottone: questa barra scorre (`overflow-y-auto`, che
   * serve sul telefono), e una barra che scorre ritaglia cio' che le esce —
   * su tutti e due gli assi, perche' il CSS porta ad `auto` anche quello
   * lasciato `visible`. Un cartellino a `left: 100%` finiva quindi tagliato
   * via, e l'unica cosa che se ne vedeva era la barra di scorrimento
   * orizzontale che la sua sporgenza faceva comparire in fondo.
   *
   * Misurando qui e disegnando in posizione fissa, il cartellino esce dal
   * ritaglio: `fixed` si ancora alla finestra, non al contenitore.
   */
  const [sopra, setSopra] = useState<{ id: number; ancora: DOMRect } | null>(null)

  const entra = (id: number) => (e: React.FocusEvent | React.MouseEvent): void =>
    setSopra({ id, ancora: e.currentTarget.getBoundingClientRect() })
  const esci = (id: number) => (): void => setSopra((q) => (q?.id === id ? null : q))

  const conferma = async (): Promise<void> => {
    if (!nome.trim()) return
    setInCorso(true)
    try {
      await crea(nome.trim())
      setNome('')
      setCreando(false)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <nav className={`flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-bordo bg-fondo py-3 ${className}`}>
      {/* Il server vero, sopra a tutto e separato da una riga: cambiarlo
          cambia *tutto* quello che sta sotto — spazi, canali, persone,
          messaggi — e una cosa che ha quel peso non sta in mezzo alle altre. */}
      {intestazione}
      {intestazione && <span className="my-0.5 h-px w-8 shrink-0 bg-bordo" />}

      {/* I messaggi diretti stanno in cima, sopra alla riga: non sono un
          server, e metterli in mezzo agli altri li farebbe sembrare tali. */}
      <button
        onClick={apriDiretti}
        title="Messaggi diretti"
        aria-label="Messaggi diretti"
        className="group relative flex h-12 w-12 items-center justify-center"
      >
        <span
          className={`absolute -left-3 w-1 rounded-r-full bg-testo transition-all ${
            direttiAperti ? 'h-8' : direttiNonLetti > 0 ? 'h-2' : 'h-0'
          }`}
        />
        <span
          className={`flex h-12 w-12 items-center justify-center transition-all ${
            direttiAperti
              ? `${RAGGIO_SCELTO} bg-vivo text-fondo`
              : `${RAGGIO_RIPOSO} bg-fondo-2 text-testo-2 group-hover:bg-fondo-3 group-hover:text-testo`
          }`}
        >
          <Fumetto className="h-5 w-5" />
        </span>
        {direttiNonLetti > 0 && (
          <span className="numeri absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-male px-1 text-[10px] font-semibold text-white">
            {direttiNonLetti > 9 ? '9+' : direttiNonLetti}
          </span>
        )}
      </button>

      <span className="my-0.5 h-px w-8 shrink-0 bg-bordo" />

      {spazi.map((spazio) => {
        const daLeggere = spazio.canali.reduce((somma, c) => somma + c.nonLetti, 0)
        const attivo = spazio.id === aperto
        // Il vocale di questa barra e' quello in cui si sta parlando adesso, se
        // appartiene a questo spazio. Null quasi sempre: si sta in una stanza
        // sola per volta.
        const vocale = spazio.canali.find((c) => c.id === inVoce && c.tipo === 'voce') ?? null

        return (
          <button
            key={spazio.id}
            onClick={() => scegli(spazio.id)}
            onMouseEnter={entra(spazio.id)}
            onMouseLeave={esci(spazio.id)}
            onFocus={entra(spazio.id)}
            onBlur={esci(spazio.id)}
            // Niente `title`: il cartellino dice gia' tutto, e i due insieme
            // farebbero comparire due riquadri sovrapposti dopo un secondo.
            aria-label={spazio.nome}
            className="group relative flex h-12 w-12 items-center justify-center"
          >
            {/* Il segno a sinistra: alto quando e' aperto, un punto quando ha
                da leggere, niente quando non c'e' niente da dire. */}
            <span
              className={`absolute -left-3 w-1 rounded-r-full bg-testo transition-all ${
                attivo ? 'h-8' : daLeggere > 0 ? 'h-2' : 'h-0'
              }`}
            />
            <span
              className={`flex h-12 w-12 items-center justify-center text-lg font-semibold transition-all ${
                attivo ? RAGGIO_SCELTO : RAGGIO_RIPOSO
              }`}
              style={{
                background: attivo ? 'var(--color-vivo)' : coloreDi(`s${spazio.id}`),
                // Il fondo del tema, non un nero scritto a mano: con un tema
                // chiaro le iniziali devono scurirsi insieme a tutto il resto.
                color: 'var(--color-fondo)'
              }}
            >
              {spazio.icona || inizialiDi(spazio.nome)}
            </span>

            {/* L'anello verde intorno all'icona del server in cui si sta
                parlando: si vede da lontano, e da lontano e' l'unica cosa che
                serve sapere.

                Il raggio e' lo stesso dell'icona — le stesse due costanti,
                non un valore fisso ricopiato qui. L'icona cambia forma da sola
                — smussata a riposo, quasi quadra da aperta o sotto al
                cursore — e un anello
                che non la seguiva restava squadrato intorno a un quadrato con
                gli angoli tondi: si vedeva l'anello staccarsi negli angoli
                proprio quando si guardava un altro server, cioe' quando
                l'anello e' l'unica cosa che sta dicendo dove si sta
                parlando. */}
            {vocale && (
              <span
                className={`pointer-events-none absolute inset-0 border-2 border-ok transition-all ${
                  attivo ? RAGGIO_SCELTO : RAGGIO_RIPOSO
                }`}
              />
            )}

            {sopra?.id === spazio.id && (
              <OverlaySpazio
                spazio={spazio}
                canaleVocale={vocale}
                profili={profili}
                ancora={sopra.ancora}
              />
            )}
          </button>
        )
      })}

      {/* Lo puo' premere chiunque abbia un account.
          Prima era riservato a chi amministra l'istanza, ed era una regola
          presa dal caso piu' piccolo — quattro persone in casa, e una sola che
          crea. Uno spazio nuovo pero' nasce vuoto e invisibile: dentro c'e'
          chi l'ha fatto e nessun altro, e nella barra degli altri non compare
          niente finche' non li si invita. Non c'e' quindi niente da
          proteggere, e c'era da chiedere il permesso per farsi un posto dove
          parlare in tre. */}
      <button
        onClick={() => setCreando(true)}
        title="Nuovo spazio"
        aria-label="Nuovo spazio"
        className={`flex h-12 w-12 shrink-0 items-center justify-center ${RAGGIO_RIPOSO_SOLO} border border-dashed border-bordo text-testo-3 transition-all hover:border-vivo hover:text-vivo`}
      >
        <Piu />
      </button>

      <div className="flex-1" />

      {/* Il pallino rosso e' l'unica cosa che porta ad aprire questo pannello:
          una richiesta di amicizia non ha nessun altro posto in cui farsi
          notare. */}
      <button
        onClick={apriAmici}
        title={richieste > 0 ? `Amici — ${richieste} in attesa` : 'Amici'}
        aria-label="Amici"
        className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-fondo-2 text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
      >
        <Utenti />
        {richieste > 0 && (
          <span className="numeri absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-male px-1 text-[10px] font-semibold text-white">
            {richieste > 9 ? '9+' : richieste}
          </span>
        )}
      </button>

      {/* Apre il pannello, non le impostazioni: nove volte su dieci si preme
          per cambiare stato o per guardarsi il nome, e aprire un pannello a
          tutta pagina per quello e' un salto sproporzionato. */}
      <button
        onClick={apriProfilo}
        title={utente.nome}
        className="relative h-10 w-10 rounded-full ring-2 ring-transparent transition-all hover:ring-vivo"
      >
        {utente.avatar ? (
          <img src={utente.avatar} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center rounded-full text-sm font-semibold text-black/75"
            style={{ background: coloreDi(`u${utente.id}`) }}
          >
            {inizialiDi(utente.nome)}
          </span>
        )}
        <PallinoStato stato={utente.stato ?? 'online'} className="h-3 w-3" fondo="var(--color-fondo)" />
      </button>

      {creando && (
        <div
          className="velo absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setCreando(false)}
        >
          <div
            className="pannello w-full max-w-sm space-y-4 rounded-2xl border border-bordo bg-fondo-2 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Nuovo spazio</h2>
            <Campo
              etichetta="Nome"
              aiuto="Nasce privato e con due canali — uno di testo e uno vocale — cosi' si puo' cominciare subito. Lo vedi solo tu finche' non inviti qualcuno."
            >
              <input
                className={classiInput}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void conferma()}
                placeholder="Musica"
                autoFocus
              />
            </Campo>
            <div className="flex gap-2">
              <Bottone tono="vivo" disabled={inCorso || !nome.trim()} onClick={() => void conferma()}>
                Crea
              </Bottone>
              <Bottone tono="fantasma" onClick={() => setCreando(false)}>
                Annulla
              </Bottone>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
