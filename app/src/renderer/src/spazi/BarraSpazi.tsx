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
const RAGGIO_SCELTO = 'rounded-[6px]'
/**
 * Il riposo porta con se' il suo `group-hover`, e non e' pignoleria di stile.
 *
 * Tailwind non gira: legge i sorgenti e genera solo le classi che ci trova
 * scritte per intero. `group-hover:${RAGGIO_SCELTO}` diventa
 * `group-hover:rounded-[6px]` soltanto a schermo acceso — nel file c'e' un
 * pezzo di template, quindi quella regola nel foglio di stile non nascerebbe
 * mai e il cambio di forma sotto al cursore sparirebbe senza un errore da
 * nessuna parte. Scritte intere, invece, si vedono.
 */
const RAGGIO_RIPOSO = 'rounded-[12px] group-hover:rounded-[6px]'
/** Lo stesso, per chi si accende da solo invece che dentro a un `group`. */
const RAGGIO_RIPOSO_SOLO = 'rounded-[12px] hover:rounded-[6px]'

/**
 * La riga delle icone, in cima a tutto.
 *
 * Bassa apposta: e' un indice, non un elenco. Il nome per esteso compare
 * passandoci sopra, perche' con quattro spazi le iniziali bastano e con venti
 * un elenco di nomi occuperebbe una fascia di schermo per sempre.
 *
 * ## Perche' orizzontale, e in cima
 *
 * Era una colonna a sinistra, come in Discord, ed e' la prima cosa che si vede
 * aprendo l'applicazione: la forma di quella colonna *e'* il modo in cui si
 * riconosce da quale programma si viene. Sopra, e in orizzontale, gli spazi
 * diventano quello che sono davvero — delle linguette fra cui si passa — e
 * lasciano alla sinistra dello schermo una colonna sola invece di due.
 *
 * Il guadagno non e' di gusto: sotto ai 1200 pixel due colonne piu' la sala
 * erano tre cose che si contendevano la larghezza, e la larghezza e' quella
 * che serve alla chiamata. In cima, la riga costa 56 pixel di altezza a
 * tutti e non toglie niente a nessuno in larghezza.
 *
 * ## Il segno di quale e' aperto
 *
 * La barretta che stava a sinistra dell'icona adesso sta **sotto**: e' la
 * sottolineatura di una linguetta, che e' il segno che tutti hanno gia'
 * imparato per «sei qui» in orizzontale. Alta quanto la barretta era larga, e
 * larga quanto quella era alta: la stessa quantita' di inchiostro, girata.
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
    <nav
      className={`flex h-16 w-full shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-bordo bg-fondo px-3 ${className}`}
    >
      {/* Il server vero, sopra a tutto e separato da una riga: cambiarlo
          cambia *tutto* quello che sta sotto — spazi, canali, persone,
          messaggi — e una cosa che ha quel peso non sta in mezzo alle altre. */}
      {intestazione}
      {intestazione && <span className="mx-0.5 h-8 w-px shrink-0 bg-bordo" />}

      {/* I messaggi diretti stanno in cima, sopra alla riga: non sono un
          server, e metterli in mezzo agli altri li farebbe sembrare tali. */}
      <button
        onClick={apriDiretti}
        title="Messaggi diretti"
        aria-label="Messaggi diretti"
        className="group relative flex h-12 w-12 shrink-0 items-center justify-center"
      >
        <span
          className={`absolute -bottom-2 h-1 rounded-t-full bg-testo transition-all ${
            direttiAperti ? 'w-8' : direttiNonLetti > 0 ? 'w-2' : 'w-0'
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

      <span className="mx-0.5 h-8 w-px shrink-0 bg-bordo" />

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
            className="group relative flex h-12 w-12 shrink-0 items-center justify-center"
          >
            {/* Il segno sotto: largo quando e' aperto, un punto quando ha da
                leggere, niente quando non c'e' niente da dire. */}
            <span
              className={`absolute -bottom-2 h-1 rounded-t-full bg-testo transition-all ${
                attivo ? 'w-8' : daLeggere > 0 ? 'w-2' : 'w-0'
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
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fondo-2 text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
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
        className="relative h-10 w-10 shrink-0 rounded-full ring-2 ring-transparent transition-all hover:ring-vivo"
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

      {/* `fixed` e non `absolute`: da quando la barra e' una riga alta
          cinquanta pixel, un velo ancorato a lei sarebbe una striscia, e la
          finestrella dentro finirebbe schiacciata e tagliata. Ancorata alla
          finestra copre tutto, che e' quello che una richiesta modale deve
          fare. */}
      {creando && (
        <div
          className="velo fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
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
