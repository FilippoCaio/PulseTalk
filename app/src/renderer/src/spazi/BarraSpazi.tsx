import { useState, type ReactNode } from 'react'
import type { Spazio, Utente } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import OverlaySpazio from './OverlaySpazio'
import { Bottone, Campo, classiInput } from '../ui'
import { Fumetto, Ingranaggio, Piu, Utenti } from '../icone'

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
 * che serve alla chiamata. In cima, la riga costa 64 pixel di altezza a tutti
 * e non toglie niente a nessuno in larghezza.
 *
 * ## Tre zone, e i due separatori che le dividono
 *
 *   a sinistra   chi si e' e con chi si parla: il proprio ritratto, gli amici,
 *                i messaggi diretti. Sono le cose che non appartengono a
 *                nessuno spazio, e stanno larghe quanto la colonna qui sotto —
 *                il separatore cade sul bordo di quella colonna, cosi' la riga
 *                in cima e cio' che ci sta sotto sono la stessa geometria e non
 *                due griglie che si somigliano;
 *   in mezzo     gli spazi, che scorrono se sono tanti;
 *   a destra     il server vero, dietro all'altro separatore. Cambiarlo cambia
 *                tutto quello che sta a sinistra, e una cosa con quel peso non
 *                va messa dove si passa continuamente.
 *
 * ## Il segno di quale e' aperto
 *
 * Non una riga sotto: la **linguetta**. Lo spazio aperto si veste del colore
 * della schermata che apre — lo stesso fondo della chiamata — con gli angoli di
 * sopra smussati e il bordo di sotto attaccato alla barra, che invece e' del
 * colore dei pannelli. E' il gesto delle linguette di un browser, e dice una
 * cosa che una sottolineatura non dice: che la linguetta e la pagina sono lo
 * stesso oggetto, e che questa barra sta *sopra* a cio' che si guarda invece
 * che accanto.
 *
 * Funziona perche' gli spazi cominciano esattamente dove comincia la schermata
 * della chiamata: e' la stessa geometria del separatore di sinistra, guardata
 * dall'altro lato. Il segno di «c'e' da leggere» si e' spostato di conseguenza
 * — un punto sull'angolo dell'icona, come sui messaggi diretti — perche' il
 * posto che aveva prima adesso vuol dire un'altra cosa.
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
  apriImpostazioni,
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
  /**
   * Apre le impostazioni.
   *
   * Sta qui e non piu' in fondo alla colonna della chiamata: quel pannello
   * compare solo mentre si e' in chiamata e si sta guardando altrove, e le
   * impostazioni si aprono anche - soprattutto - quando non si sta parlando
   * con nessuno.
   */
  apriImpostazioni: () => void
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
      className={`barra-spazi relative flex h-16 w-full shrink-0 items-center overflow-x-auto overflow-y-hidden bg-fondo-2 ${className}`}
    >
      {/* La riga che divide la barra da cio' che ci sta sotto.

          Non e' piu' il `border-b` della barra, ed e' tutta la differenza: un
          bordo passa **sotto** alle linguette e le taglia via dal contenuto,
          che e' esattamente cio' che una linguetta non deve fare. Disegnata
          come un fratello, invece, la linguetta aperta le passa sopra e la
          interrompe - e ai suoi fianchi i due quadratini di `.linguetta-tab`
          la riprendono curvando.

          Sta dentro alla barra e non fuori perche' quando gli spazi sono tanti
          la barra scorre: fuori resterebbe ferma mentre le linguette le
          scivolano davanti, e il raccordo si staccherebbe dal suo posto. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-bordo" />
      {/* A sinistra, chi si e' e con chi si parla: il proprio ritratto, gli
          amici, i messaggi diretti. Sono le tre cose che non appartengono a
          nessuno spazio - riguardano la persona, non il posto - e stanno
          insieme, staccate dagli spazi da una riga.

          Il gruppo e' largo esattamente quanto la colonna qui sotto, e il
          separatore cade sul suo bordo: la riga in cima e la colonna diventano
          la stessa geometria invece di due griglie che si somigliano. Il
          `-ml-px` non e' pignoleria — il bordo della colonna sta *dentro* ai
          suoi 15rem, quindi senza quel pixel il separatore le resterebbe
          accanto invece che sopra. */}
      <div className="flex h-full w-60 shrink-0 items-center gap-2 px-3">
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
          <PallinoStato
            stato={utente.stato ?? 'online'}
            className="h-3 w-3"
            fondo="var(--color-fondo-2)"
          />
        </button>

        {/* Il pallino rosso e' l'unica cosa che porta ad aprire questo
            pannello: una richiesta di amicizia non ha nessun altro posto in cui
            farsi notare. */}
        <button
          onClick={apriAmici}
          title={richieste > 0 ? `Amici — ${richieste} in attesa` : 'Amici'}
          aria-label="Amici"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fondo text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
        >
          <Utenti />
          {richieste > 0 && (
            <span className="numeri absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-male px-1 text-[10px] font-semibold text-white">
              {richieste > 9 ? '9+' : richieste}
            </span>
          )}
        </button>

        <button
          onClick={apriDiretti}
          title="Messaggi diretti"
          aria-label="Messaggi diretti"
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center"
        >
          <span
            className={`flex h-10 w-10 items-center justify-center transition-all ${
              direttiAperti
                ? `${RAGGIO_SCELTO} bg-vivo text-fondo`
                : `${RAGGIO_RIPOSO} bg-fondo text-testo-2 group-hover:bg-fondo-3 group-hover:text-testo`
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

        {/* Le impostazioni, dopo i diretti e non in fondo alla chiamata: sono
            la cosa che si apre anche - e soprattutto - quando non si sta
            parlando con nessuno, e il pannello in cui stavano prima compare
            solo mentre una chiamata e' in corso. */}
        <button
          onClick={apriImpostazioni}
          title="Impostazioni"
          aria-label="Impostazioni"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fondo text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
        >
          <Ingranaggio className="h-5 w-5" />
        </button>
      </div>

      {/* Fra il gruppo di sinistra e gli spazi non c'e' nessun separatore, ed
          e' voluto: la prima linguetta comincia esattamente dove finisce la
          colonna qui sotto, e il suo fianco sinistro **e'** la riga che divide
          i due pannelli. Un separatore li' in mezzo sarebbe una seconda riga
          verticale a un pixel dalla prima. */}

      {/* Gli spazi, e sono linguette.

          Quello aperto non ha piu' una riga sotto: si veste del colore della
          schermata che apre, con gli angoli di sopra smussati e il fondo
          attaccato al bordo della barra. E' il gesto delle linguette di un
          browser, e dice una cosa che una sottolineatura non dice — che la
          linguetta e la pagina sono lo stesso oggetto, e che quella barra sta
          *sopra* a cio' che si sta guardando invece che accanto.

          Funziona perche' sotto agli spazi comincia esattamente la schermata
          della chiamata, che e' di quel colore: e' la stessa geometria del
          separatore qui sopra, guardata dall'altro lato. */}
      {/* `-ml-px`: la prima linguetta deve cadere **sopra** al bordo della
          colonna, non accanto.

          Il bordo di quella colonna sta dentro ai suoi 15rem - box-border - e
          occupa l'ultimo pixel; il bordo sinistro della linguetta invece parte
          dal primo pixel dopo. Senza questo spostamento le due righe verticali
          sono adiacenti e non sovrapposte, e si vede: un gradino di un pixel
          proprio nel punto in cui la linguetta dovrebbe diventare la riga. */}
      <div className="barra-spazi -ml-px flex h-full min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto pr-2">
        {spazi.map((spazio, indice) => {
          const daLeggere = spazio.canali.reduce((somma, c) => somma + c.nonLetti, 0)
          const attivo = spazio.id === aperto
          // Il vocale di questa barra e' quello in cui si sta parlando adesso,
          // se appartiene a questo spazio. Null quasi sempre: si sta in una
          // stanza sola per volta.
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
              /* `pb-2` e non solo `mt-2`: lo stacco sopra lo si vede - e' il
                 gradino che fa la linguetta - ma senza uno stacco uguale sotto
                 l'icona si troverebbe quattro pixel piu' in basso di quelle
                 che stanno fuori dalle linguette, e in una riga di icone
                 tutte uguali quattro pixel sono la differenza fra allineate e
                 storte.

                 Il bordo c'e' anche da spenta, trasparente: senza, la
                 linguetta aperta sarebbe due pixel piu' larga delle altre e
                 tutte quelle a destra scatterebbero di lato a ogni cambio di
                 spazio. */
              /* Sei pixel attorno all'icona, sopra e ai lati.

                 Le tre misure non sono libere: l'icona deve restare centrata a
                 32 pixel, come tutte le altre della riga. Con la linguetta che
                 comincia a 6 e finisce in fondo, l'imbottitura di sotto deve
                 valere 6 perche' il centro del contenuto ricada li' - e' la
                 stessa somma vista da dentro. Cambiarne una senza rifare il
                 conto sposta le icone degli spazi e le lascia storte rispetto
                 al piu' e al ritratto. */
              className={`group relative mt-1.5 flex h-[calc(100%-0.375rem)] shrink-0 items-center justify-center rounded-t-[6px] border border-b-0 px-1.5 pb-1.5 transition-colors ${
                attivo
                  ? `linguetta-tab border-bordo bg-fondo ${
                      // La prima non ha il raccordo a sinistra: li' non c'e'
                      // niente da raccordare. Il suo fianco scende dritto e
                      // diventa la riga che divide la colonna dalla chiamata,
                      // che e' esattamente sotto di lui.
                      indice === 0 ? 'linguetta-tab-prima' : ''
                    }`
                  : 'border-transparent hover:bg-fondo/50'
              }`}
            >
              <span
                className={`relative flex h-10 w-10 items-center justify-center text-base font-semibold transition-all ${
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

                {/* L'anello verde di chi sta parlando in quello spazio, dentro
                    all'icona e non centrato sul pulsante.

                    Il pulsante ha l'imbottitura in basso che tiene le icone in
                    fila con quelle fuori dalle linguette, quindi il suo centro
                    non e' il centro dell'icona: l'anello, appeso al pulsante,
                    finiva quattro pixel piu' in basso - alto uguale e largo
                    uguale, ma sfalsato. Appeso all'icona non puo' piu' non
                    combaciare.

                    Il raggio e' lo stesso dell'icona, dalle stesse due
                    costanti: l'icona cambia forma da sola - smussata a riposo,
                    quasi quadra da aperta - e un anello che non la seguiva
                    restava squadrato intorno a un quadrato con gli angoli
                    tondi. */}
                {vocale && (
                  <span
                    className={`pointer-events-none absolute inset-0 border-2 border-ok transition-all ${
                      attivo ? RAGGIO_SCELTO : RAGGIO_RIPOSO
                    }`}
                  />
                )}
              </span>

              {/* Da leggere: un punto sull'angolo, come i messaggi diretti.
                  Era una barretta sotto all'icona, ed era lo stesso segno con
                  cui si diceva «sei qui»: adesso quel posto e' della
                  linguetta, e due significati sullo stesso segno non si
                  distinguono piu'. */}
              {daLeggere > 0 && !attivo && (
                <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-testo ring-2 ring-fondo-2" />
              )}

              {/* L'anello verde intorno all'icona del server in cui si sta
                  parlando: si vede da lontano, e da lontano e' l'unica cosa che
                  serve sapere.

                  Il raggio e' lo stesso dell'icona — le stesse due costanti,
                  non un valore fisso ricopiato qui. L'icona cambia forma da
                  sola — smussata a riposo, quasi quadra da aperta o sotto al
                  cursore — e un anello che non la seguiva restava squadrato
                  intorno a un quadrato con gli angoli tondi. */}
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
            presa dal caso piu' piccolo — quattro persone in casa, e una sola
            che crea. Uno spazio nuovo pero' nasce vuoto e invisibile: dentro
            c'e' chi l'ha fatto e nessun altro, e nella barra degli altri non
            compare niente finche' non li si invita. Non c'e' quindi niente da
            proteggere, e c'era da chiedere il permesso per farsi un posto dove
            parlare in tre. */}
        <span className="flex h-full shrink-0 items-center pl-1">
          <button
            onClick={() => setCreando(true)}
            title="Nuovo spazio"
            aria-label="Nuovo spazio"
            className={`flex h-10 w-10 shrink-0 items-center justify-center ${RAGGIO_RIPOSO_SOLO} border border-dashed border-bordo text-testo-3 transition-all hover:border-vivo hover:text-vivo`}
          >
            <Piu />
          </button>
        </span>
      </div>

      {/* Il server vero, in fondo a destra e dietro a una riga: cambiarlo
          cambia *tutto* quello che sta a sinistra — spazi, canali, persone,
          messaggi. Una cosa che ha quel peso non sta in mezzo alle altre, e
          nemmeno in cima all'elenco che governa: sta dall'altra parte, dove
          non la si preme per sbaglio passando da uno spazio all'altro. */}
      {intestazione && (
        <>
          <span className="h-8 w-px shrink-0 bg-bordo" />
          <span className="flex h-full shrink-0 items-center px-3">{intestazione}</span>
        </>
      )}

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
