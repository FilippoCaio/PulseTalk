import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionState, Track } from 'livekit-client'
import type {
  Canale,
  Impostazioni,
  Ingresso,
  ModoAudioSistema,
  PosizioneStriscia,
  Sorgente,
  Utente
} from '@shared/tipi'
import { PRESET_SCHERMO, type PresetSchermo } from '@shared/qualita'
import { ErroreApi, type Api, type SessioneAutoWriter } from '../lib/api'
import { MAX_CONDIVISIONI_GUARDATE } from '../lib/usaSessione'
import type { Riquadro as DatiRiquadro, Sessione } from '../lib/usaSessione'
import { usaMisura } from '../lib/misura'
import { ponte } from '../ponte'
import { Chiudi, Pausa, Play, Riavvolgi } from '../icone'
import { Avviso } from '../ui'
import OverlayChiamata from './OverlayChiamata'
import MenuRiquadro from './MenuRiquadro'
import Chat from '../chat/Chat'
import type { usaChat } from '../lib/usaChat'
import Riquadro from './Riquadro'
import SceltaSorgente from './SceltaSorgente'
import { PannelloInvito, RiquadroInvito } from './Invito'
import PannelloInsieme from '../media/PannelloInsieme'
import RiquadroYouTube from '../media/RiquadroYouTube'
import type { SessioniMedia } from '../lib/usaSessioniMedia'
import type { VoceVolume } from './Volume'
import { usaProblema } from '../lib/diagnostica'

/**
 * La griglia di un canale vocale.
 *
 * Due regole, e valgono piu' di qualunque algoritmo di disposizione.
 *
 * La prima: i riquadri hanno tutti la stessa forma, sempre. Le misure le
 * calcola `tessere()` sullo spazio disponibile invece di lasciarle al CSS,
 * perche' una griglia che si limita a dividere lo spazio fa riquadri lunghi e
 * bassi in due, alti e stretti in cinque, e ogni volta che qualcuno entra
 * cambia forma a tutti gli altri.
 *
 * La seconda: se qualcuno sta mostrando qualcosa, quello e' cio' che si deve
 * guardare. Cliccando un riquadro — chiunque sia, non solo uno schermo — quello
 * va sopra a prendersi tutto lo spazio e gli altri finiscono in una striscia
 * sotto. Si torna indietro cliccandolo di nuovo, o con Esc.
 *
 * Lo schermo intero e' quello vero del sistema, e resta comunque una cosa da
 * cui si esce: la barra in basso non sparisce mai, perche' la scorciatoia per
 * uscire da un finto schermo intero e' la cosa che nessuno ricorda mai.
 */
export default function Sala({
  api,
  ingresso,
  sessione,
  impostazioni,
  profili,
  moderatore,
  esci,
  apriImpostazioni,
  salvaImpostazioni,
  schermoIntero,
  chatVocale,
  canaleVocale,
  utente,
  media
}: {
  api: Api
  ingresso: Ingresso
  sessione: Sessione
  impostazioni: Impostazioni
  profili: Map<number, { nome: string; avatar: string | null }>
  moderatore: boolean
  esci: () => Promise<void>
  apriImpostazioni: () => void
  /** Salva un'impostazione dal menu del microfono, senza aprire il pannello. */
  salvaImpostazioni: (modifiche: Partial<Impostazioni>) => Promise<unknown>
  /**
   * Tutto schermo, ma dell'APPLICAZIONE: spariscono le due colonne di sinistra
   * e resta solo la chiamata.
   *
   * Non passa dall'API del browser, e non e' un ripiego: e' cio' che serve
   * davvero. `requestFullscreen` porta fuori dalla finestra, fallisce in
   * silenzio quando l'ambiente non la concede — ed e' esattamente cio' che
   * faceva qui, con un catch vuoto che se ne mangiava l'errore — e comunque
   * non toglierebbe di mezzo le colonne: le coprirebbe. Uno stato di React fa
   * la cosa chiesta e non puo' fallire.
   */
  schermoIntero: { attivo: boolean; alterna: () => void }
  /**
   * La chat di QUESTO canale vocale, distinta da quella del canale di testo
   * che si sta magari leggendo altrove.
   */
  chatVocale: ReturnType<typeof usaChat>
  canaleVocale: Canale | null
  utente: Utente
  /**
   * Le sessioni condivise di questo canale: guardare un video, ascoltare
   * insieme.
   *
   * Arriva da fuori invece di nascere qui perche' vive quanto la chiamata, non
   * quanto questa schermata: chi apre un video e poi va a leggere una chat non
   * deve trovare la sessione chiusa quando torna.
   */
  media?: SessioniMedia
}): React.JSX.Element {
  const [aFuoco, setAFuoco] = useState<string | null>(null)
  // Vero quando l'utente ha tolto lui il fuoco. Serve a non rimetterlo subito:
  // senza, chiudere l'unico schermo condiviso lo farebbe tornare grande al
  // disegno successivo, e sembrerebbe che il clic non abbia funzionato.
  const [senzaFuoco, setSenzaFuoco] = useState(false)
  /**
   * Il selettore delle sorgenti, e per cosa e' aperto.
   *
   * `modifica` nullo: se ne sta aprendo una nuova. Altrimenti e' l'id della
   * condivisione gia' accesa da cambiare — stesso pannello, ma alla conferma
   * la sorgente si sostituisce sotto a chi guarda invece di aggiungerne una
   * seconda, e nessuno vede un salto.
   */
  const [scegliSorgente, setScegliSorgente] = useState<{
    modifica: string | null
    soloAudio: boolean
  } | null>(null)
  /**
   * La sovraimpressione da sola, senza la striscia delle persone.
   *
   * Non e' il tutto schermo della finestra — quello e' `schermoIntero`, e
   * toglie le colonne. Questo toglie i riquadri degli altri e basta: serve a
   * chi sta guardando uno schermo condiviso e in quel momento delle facce non
   * gli importa niente.
   */
  const [soloGrande, setSoloGrande] = useState(false)
  /** L'elenco degli amici da chiamare dentro, quando e' aperto. */
  const [mostraInvito, setMostraInvito] = useState(false)
  const [erroreLocale, setErroreLocale] = useState<string | null>(null)
  /**
   * L'ordine deciso a mano, per id di riquadro.
   *
   * Vuoto finche' nessuno trascina niente: allora vale l'ordine naturale —
   * schermi davanti, poi per nome — che e' quello giusto per chi non ha
   * preferenze. Chi ne ha, se le prende trascinando, e da quel momento comanda
   * questa lista. Chi arriva dopo si mette in fondo invece di infilarsi in
   * mezzo e spostare tutti.
   */
  const [ordine, setOrdine] = useState<string[]>([])
  const [trascinato, setTrascinato] = useState<string | null>(null)
  const [sopra, setSopra] = useState<string | null>(null)

  const radice = useRef<HTMLDivElement>(null)
  const [contenitore, spazio] = usaMisura<HTMLDivElement>()

  const { persone } = sessione

  const riquadri = useMemo(() => {
    if (ordine.length === 0) return sessione.riquadri
    const posto = new Map(ordine.map((id, indice) => [id, indice]))
    // I nuovi in fondo, e nell'ordine in cui sarebbero arrivati da soli: il
    // `+ indice` tiene stabile chi non e' mai stato spostato.
    return [...sessione.riquadri].sort(
      (a, b) =>
        (posto.get(a.id) ?? ordine.length + sessione.riquadri.indexOf(a)) -
        (posto.get(b.id) ?? ordine.length + sessione.riquadri.indexOf(b))
    )
  }, [sessione.riquadri, ordine])

  /** Trascinato uno sopra a un altro, i due si scambiano di posto. */
  const scambia = (da: string, a: string): void => {
    if (da === a) return
    const attuale = riquadri.map((r) => r.id)
    const i = attuale.indexOf(da)
    const j = attuale.indexOf(a)
    if (i < 0 || j < 0) return
    const nuovo = [...attuale]
    nuovo[i] = attuale[j]
    nuovo[j] = attuale[i]
    setOrdine(nuovo)
  }

  /** Le quattro proprieta' che rendono trascinabile un involucro di riquadro. */
  const trascinamento = (
    id: string
  ): {
    draggable: true
    onDragStart: (evento: React.DragEvent) => void
    onDragEnd: () => void
    onDragOver: (evento: React.DragEvent) => void
    onDrop: (evento: React.DragEvent) => void
    className: string
  } => ({
    draggable: true,
    onDragStart: (evento) => {
      // Un comando premuto dentro al riquadro non deve trascinare il riquadro.
      //
      // Il caso che lo tradiva e' il cursore del volume: in Chromium, premere
      // la manopola di un <input type="range"> dentro a un elemento
      // `draggable` fa partire il trascinamento del contenitore invece di
      // muovere il cursore. Il riquadro se ne andava dietro al mouse e il
      // volume non cambiava di un decibel.
      if ((evento.target as HTMLElement).closest('input, button, select, textarea, [role="menu"]')) {
        evento.preventDefault()
        return
      }

      evento.dataTransfer.effectAllowed = 'move'
      // Firefox non fa partire nessun trascinamento senza dati dentro.
      evento.dataTransfer.setData('text/plain', id)
      setTrascinato(id)
    },
    onDragEnd: () => {
      setTrascinato(null)
      setSopra(null)
    },
    onDragOver: (evento) => {
      if (!trascinato || trascinato === id) return
      // Senza questa riga il rilascio non avviene: il valore predefinito di
      // dragover e' "qui non si puo' lasciare niente".
      evento.preventDefault()
      evento.dataTransfer.dropEffect = 'move'
      if (sopra !== id) setSopra(id)
    },
    onDrop: (evento) => {
      evento.preventDefault()
      const da = trascinato ?? evento.dataTransfer.getData('text/plain')
      if (da) scambia(da, id)
      setTrascinato(null)
      setSopra(null)
    },
    className: `${trascinato === id ? 'opacity-40' : ''} ${
      sopra === id && trascinato !== id
        ? 'outline outline-2 -outline-offset-2 outline-vivo rounded-xl'
        : ''
    }`
  })

  /** L'identita' sulla SFU e' `u<id>`: e' l'unica chiave su cui i due mondi combaciano. */
  const fotoDi = (identita: string): string | null =>
    profili.get(Number(identita.slice(1)))?.avatar ?? null

  /** Il riquadro su cui e' aperto il menu del tasto destro, e dove. */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  /**
   * La chat del canale vocale, a destra.
   *
   * Chiusa di partenza: chi entra in una stanza vuole vedere le facce, non un
   * pannello di testo che si mangia un terzo della larghezza. Si apre dal
   * fumetto in alto a destra e resta com'e' stata lasciata.
   */
  const [mostraChat, setMostraChat] = useState(false)
  /**
   * Il pannello delle cose da fare insieme.
   *
   * Si escludono con la chat: sono due pannelli per lo stesso posto, e tenerli
   * aperti insieme lascerebbe ai riquadri delle persone meno spazio di quello
   * che serve a riconoscerle.
   */
  const [mostraInsieme, setMostraInsieme] = useState(false)
  const [youtubeAFuoco, setYoutubeAFuoco] = useState(false)
  const [volumeYoutube, setVolumeYoutube] = useState(1)
  const [youtubeMuto, setYoutubeMuto] = useState(false)
  const youtube =
    media?.sessioni.find((s) => s.tipo === 'youtube' && Boolean(s.stato.riferimento)) ?? null
  const youtubePrecedente = useRef<number | null>(null)

  // Un nuovo video si comporta come l'unica condivisione schermo: va in primo
  // piano una volta. Se l'utente lo rimette piccolo, gli aggiornamenti di
  // play/pausa non devono ingrandirlo di nuovo.
  useEffect(() => {
    if (!youtube) {
      youtubePrecedente.current = null
      setYoutubeAFuoco(false)
      return
    }
    if (youtubePrecedente.current === youtube.id) return
    youtubePrecedente.current = youtube.id
    setAFuoco(null)
    setSenzaFuoco(true)
    setYoutubeAFuoco(true)
  }, [youtube?.id])

  /** Gli aloni ancora vivi su questo riquadro. */
  const puntatoriDi = (riquadro: DatiRiquadro): typeof sessione.puntatori =>
    sessione.puntatori.filter((p) => p.schermo === riquadro.id)

  /**
   * I cursori del volume di un riquadro.
   *
   * Uno solo per riquadro, e diverso a seconda di cosa mostra: sul riquadro
   * della persona si regola la sua voce, su quello del suo schermo si regola
   * l'audio di quello che sta mostrando. Sono due suoni distinti che arrivano
   * dalla stessa persona, ed e' giusto che si regolino dove si vedono.
   */
  const vociDi = (riquadro: DatiRiquadro): VoceVolume[] => {
    if (riquadro.locale) return []
    const suoi = sessione.volumiDi(riquadro.identita)

    if (riquadro.tipo === 'schermo') {
      return [
        {
          chiave: 'schermo',
          nome: 'schermo',
          volume: suoi.schermo,
          muto: suoi.mutoSchermo,
          cambia: (v) => sessione.impostaVolume(riquadro.identita, 'schermo', v),
          alternaMuto: () => sessione.alternaMuto(riquadro.identita, 'schermo')
        }
      ]
    }
    return [
      {
        chiave: 'voce',
        nome: 'voce',
        volume: suoi.voce,
        muto: suoi.mutoVoce,
        cambia: (v) => sessione.impostaVolume(riquadro.identita, 'voce', v),
        alternaMuto: () => sessione.alternaMuto(riquadro.identita, 'voce')
      }
    ]
  }

  // Le scorciatoie globali. Dentro Electron arrivano anche con la finestra
  // dietro a tutto, che e' esattamente il momento in cui servono.
  useEffect(() => {
    return ponte.onScorciatoia((quale) => {
      if (quale === 'muto') void sessione.alternaMicrofono()
      else sessione.alternaSordina()
    })
  }, [sessione])

  // Esc rimette tutti nella griglia. Quando si e' a tutto schermo no: li' Esc
  // e' gia' del browser, e togliere due cose con un tasto solo — lo schermo
  // intero *e* il fuoco — non e' quello che si stava chiedendo.
  useEffect(() => {
    const tasto = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape' || document.fullscreenElement) return
      setAFuoco((prima) => {
        if (prima) setSenzaFuoco(true)
        return null
      })
      setYoutubeAFuoco(false)
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [])

  // Uno schermo messo a fuoco che smette di trasmettere lascerebbe la griglia
  // su un riquadro che non esiste piu'.
  useEffect(() => {
    if (aFuoco && !riquadri.some((r) => r.id === aFuoco)) setAFuoco(null)
  }, [aFuoco, riquadri])

  // Quando qualcuno comincia (o smette) di condividere, la scelta di stare
  // nella griglia decade. Senza, uno che ha premuto Esc mezz'ora prima non
  // vedrebbe piu' andare grande nessuno schermo per tutto il resto della
  // chiamata, e non avrebbe modo di collegare le due cose.
  const quantiSchermi = riquadri.filter((r) => r.tipo === 'schermo').length
  useEffect(() => {
    setSenzaFuoco(false)
  }, [quantiSchermi])

  const { grande, striscia: strisciaScelta, griglia: grigliaScelta } = useMemo(() => {
    const scelto = aFuoco ? (riquadri.find((r) => r.id === aFuoco) ?? null) : null

    // Nessuno a fuoco: se c'e' un solo schermo condiviso in tutto il canale,
    // quello prende il posto grande di diritto — e' evidentemente la cosa da
    // guardare. Con due o piu' si torna alla griglia, perche' sceglierne uno
    // per l'utente sarebbe arbitrario.
    const schermi = riquadri.filter((r) => r.tipo === 'schermo')
    const unico = !scelto && !senzaFuoco && schermi.length === 1 ? schermi[0] : null
    const grande = scelto ?? unico

    if (grande) {
      return { grande, striscia: riquadri.filter((r) => r.id !== grande.id), griglia: [] }
    }
    return { grande: null, striscia: [], griglia: riquadri }
  }, [aFuoco, senzaFuoco, riquadri])

  // La scelta di nascondere gli altri resta com'e' stata lasciata, anche
  // passando dalla griglia e tornando indietro.
  //
  // Prima si azzerava ogni volta che non c'era piu' niente in primo piano, per
  // non far sparire nessuno a sorpresa al ritorno. Ma il ritorno succede di
  // continuo — basta un clic sulla sovraimpressione per rimetterla in griglia —
  // e chi si era messo a schermo pieno se lo ritrovava disfatto ogni volta, con
  // il pulsante da ripremere. Una preferenza che si dimentica da sola e' una
  // preferenza che va rimessa a mano dieci volte in una sessione: dura piu' del
  // primo piano che l'ha vista nascere.

  /**
   * Il video condiviso e' una condivisione come le altre.
   *
   * Prima era un caso a parte: messo a fuoco finiva dentro a un contenitore
   * con un tetto di larghezza, con le persone schiacciate in una striscia
   * bassa qui sotto e senza il pulsante per nasconderle. Ma per chi guarda non
   * c'e' nessuna differenza fra uno schermo condiviso e un video guardato
   * insieme — sono tutti e due "la cosa che stiamo guardando" — e ogni
   * differenza di trattamento era una regola in piu' da scoprire.
   *
   * Adesso prende lo stesso posto grande, con la stessa striscia accanto,
   * lo stesso "nascondi gli altri" e lo stesso pieno schermo a filo.
   */
  const youtubeGrande = Boolean(youtube && media && youtubeAFuoco)
  const striscia = youtubeGrande ? riquadri : strisciaScelta
  const griglia = youtubeGrande ? [] : grigliaScelta
  /** Qualcosa sta in primo piano: uno schermo, una persona, o il video. */
  const inPrimoPiano = Boolean(grande) || youtubeGrande

  /**
   * L'invito ha due forme, e non stanno mai insieme.
   *
   * Da soli in una griglia e' una tessera come le altre: lo spazio c'e'
   * comunque — una faccia sola in mezzo allo schermo non ne ha bisogno — e
   * quello e' esattamente il momento in cui l'unica cosa utile da mostrare e'
   * come far arrivare qualcun altro. In tutti gli altri casi, compagnia o
   * sovraimpressione, resta il pulsantino nell'overlay: li' lo spazio serve a
   * cio' che si sta guardando.
   *
   * In una chiamata diretta non c'e' ne' l'uno ne' l'altro: una conversazione
   * a due e' una stanza da due posti, e un terzo non ci entra nemmeno
   * volendo. Offrire di invitare qualcuno sarebbe un pulsante che promette
   * una cosa che il server rifiuta.
   */
  const puoInvitare = !ingresso.diretta
  const invitoInGriglia = puoInvitare && persone.length === 1 && griglia.length > 0

  const tessera = useMemo(
    () =>
      tessere(
        griglia.length + (youtube && !youtubeAFuoco ? 1 : 0) + (invitoInGriglia ? 1 : 0),
        spazio.larghezza,
        spazio.altezza
      ),
    [griglia.length, spazio.larghezza, spazio.altezza, youtube, youtubeAFuoco, invitoInGriglia]
  )

  // Chi e' in primo piano riceve tutto, gli altri schermi calano.
  //
  // Sta in un effetto e non dentro a `metti`/`togli` perche' il primo piano
  // cambia anche da solo: quando resta un solo schermo condiviso viene scelto
  // in automatico, e in quel caso non passa da nessun clic.
  useEffect(() => {
    sessione.applicaQualita(grande?.tipo === 'schermo' ? grande.id : null)
  }, [grande?.id, grande?.tipo, sessione.applicaQualita])

  const metti = (riquadro: DatiRiquadro): void => {
    setYoutubeAFuoco(false)
    setAFuoco(riquadro.id)
    setSenzaFuoco(false)
  }

  const togli = (): void => {
    setAFuoco(null)
    setSenzaFuoco(true)
  }

  const condividi = async (
    sorgente: Sorgente | null,
    preset: PresetSchermo,
    audio: ModoAudioSistema,
    soloAudio: boolean,
    bitrateAudio: number,
    permettiInterazione: boolean
  ): Promise<void> => {
    const aperto = scegliSorgente
    setScegliSorgente(null)
    if (!aperto) return

    // Cambiare una condivisione accesa non e' spegnerla e riaccenderla: la
    // traccia resta la stessa, cambia cosa ci passa dentro. Chi guarda non
    // vede il riquadro sparire e ricomparire, e chi l'aveva in primo piano se
    // lo tiene.
    if (aperto.modifica) {
      await sessione.cambiaSorgenteCondivisione(aperto.modifica, sorgente, preset, audio)
      return
    }

    // La scelta fatta qui vale per questa condivisione: quella di serie resta
    // nelle impostazioni e non viene riscritta da un ripensamento di un minuto.
    await sessione.condividi(sorgente, preset, audio, soloAudio, bitrateAudio, permettiInterazione)
  }

  const aggancio: PosizioneStriscia = impostazioni.posizioneStriscia ?? 'sotto'
  const collegando = sessione.stato === ConnectionState.Reconnecting

  // I due posti per le condivisioni altrui. La propria non passa di qui: e'
  // gia' sul computer, riceverla non costa niente.
  const postiLiberi = sessione.quanteGuardate < MAX_CONDIVISIONI_GUARDATE
  const daSbloccare = (r: DatiRiquadro): boolean => r.tipo === 'schermo' && !r.locale

  // La combinazione richiesta per la vera superficie video: chiamata a tutta
  // applicazione, un riquadro in primo piano e la striscia degli altri
  // nascosta. In tutti gli altri casi restano i margini che separano le
  // tessere e fanno posto alle barre dell'overlay.
  const aTuttaSuperficie = schermoIntero.attivo && inPrimoPiano && soloGrande

  // `relative` sulla radice qui sotto e l ancora della barra dei comandi.
  // Senza, quella si aggrappava alla radice dell applicazione — che comprende
  // le due colonne di sinistra — e finiva centrata sulla finestra invece che
  // sulla schermata della chiamata.
  return (
    <div ref={radice} className="relative flex h-full min-h-0 flex-col bg-fondo">
      {canaleVocale && (
        <AutoWriter
          api={api}
          canale={canaleVocale.id}
          sessioneVoce={sessione}
          io={utente}
          profili={profili}
          moderatore={moderatore}
        />
      )}
      {/* L'intestazione non e' piu' una fascia fissa: nome del canale,
          riascolto e chat sono passati nella barra alta dell'overlay, che
          compare e sparisce col cursore insieme ai comandi in basso. Una
          striscia sempre accesa in cima costava una riga di riquadri per dire
          il nome di una stanza in cui si e' appena entrati. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Lo spazio sopra e sotto e' la stanza che le due barre dell'overlay
            si prendono quando compaiono. Sotto era gia' giusto; sopra
            l'intestazione era una fascia che spingeva i riquadri, mentre
            adesso ci galleggia sopra — e con `pt-10` finiva addosso al primo
            riquadro. Uguale a `pb-20` perche' le due barre sono alte uguali. */}
        <main
          className={`group/sala relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            aTuttaSuperficie ? 'gap-0 p-0' : 'gap-2 px-3 pt-20 pb-20'
          }`}
        >
          {sessione.audioBloccato && (
            <Avviso tono="attenzione">
              Il browser non lascia partire il suono finche' non tocchi la pagina.{' '}
              <button
                className="underline underline-offset-2"
                onClick={() => void sessione.sbloccaAudio()}
              >
                Attiva l'audio
              </button>
            </Avviso>
          )}
          {(sessione.errore || erroreLocale) && <Avviso>{sessione.errore ?? erroreLocale}</Avviso>}

          {/* Detto una volta e piccolo: due gesti che non si scoprono da soli,
              e che dopo averli letti una volta non si dimenticano piu'. */}
          {grande?.tipo === 'schermo' && (
            <p className="pointer-events-none absolute right-4 bottom-2 z-10 text-[11px] text-testo-3 opacity-0 transition-opacity duration-200 group-hover/sala:opacity-100">
              rotella per ingrandire · clic per indicare · icona in alto a destra per la
              sovraimpressione
            </p>
          )}

          {sessione.riascoltoInCorso && (
            <BarraRiascolto
              fino={sessione.riascoltoInCorso.fino}
              durata={sessione.riascoltoInCorso.durata}
              ferma={sessione.fermaRiascolto}
            />
          )}

          {riquadri.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="respiro text-testo-3">mi collego…</span>
            </div>
          ) : (
            <>
              {inPrimoPiano && (
                <div
                  className={`flex min-h-0 flex-1 overflow-hidden ${
                    aTuttaSuperficie ? 'gap-0' : 'gap-2'
                  } ${VERSO[aggancio]}`}
                >
                  <div className="min-h-0 min-w-0 flex-1">
                    {youtubeGrande && youtube && media ? (
                      <RiquadroYouTube
                        key={youtube.id}
                        sessione={youtube}
                        media={media}
                        puoComandare={
                          media.puoComandare && ingresso.permessi.puoCondividere !== false
                        }
                        aFuoco
                        quandoScelto={() => setYoutubeAFuoco(false)}
                        volume={volumeYoutube}
                        muto={youtubeMuto}
                        cambiaVolume={(volume) => {
                          setVolumeYoutube(volume)
                          if (volume > 0) setYoutubeMuto(false)
                        }}
                        alternaMuto={() => setYoutubeMuto((muto) => !muto)}
                        quandoMenu={(x, y) => setMenu({ x, y, id: MENU_YOUTUBE })}
                        senzaCornice={aTuttaSuperficie}
                      />
                    ) : grande ? (
                      <Riquadro
                        dati={grande}
                        foto={fotoDi(grande.identita)}
                        mostraStatistiche={impostazioni.mostraStatistiche}
                        specchiaCamera={impostazioni.specchiaCamera ?? true}
                        aFuoco
                        volumi={vociDi(grande)}
                        puntatori={puntatoriDi(grande)}
                        quandoPunta={
                          grande.tipo === 'schermo' && !grande.locale
                            ? (x, y) => sessione.punta(grande.id, x, y)
                            : undefined
                        }
                        quandoTiene={
                          grande.tipo === 'schermo' && !grande.locale
                            ? (x, y) => sessione.punta(grande.id, x, y, true)
                            : undefined
                        }
                        quandoLascia={() => sessione.lascia(grande.id)}
                        quandoMenu={(x, y) => setMenu({ x, y, id: grande.id })}
                        quandoScelto={togli}
                        guarda={daSbloccare(grande) ? () => sessione.guarda(grande.id) : undefined}
                        nonGuardare={
                          daSbloccare(grande) ? () => sessione.nonGuardare(grande.id) : undefined
                        }
                        puoiGuardare={postiLiberi}
                        senzaCornice={aTuttaSuperficie}
                      />
                    ) : null}
                  </div>

                  {striscia.length > 0 && !soloGrande && (
                    <div className={`flex shrink-0 gap-2 p-px ${STRISCIA[aggancio]}`}>
                      {striscia.map((riquadro) => {
                        const { className, ...trascina } = trascinamento(riquadro.id)
                        return (
                          <div
                            key={riquadro.id}
                            {...trascina}
                            className={`aspect-video shrink-0 ${
                              aggancio === 'sotto' || aggancio === 'sopra' ? 'h-full' : 'w-full'
                            } ${className}`}
                          >
                            <Riquadro
                              dati={riquadro}
                              foto={fotoDi(riquadro.identita)}
                              mostraStatistiche={impostazioni.mostraStatistiche}
                              specchiaCamera={impostazioni.specchiaCamera ?? true}
                              aFuoco={false}
                              volumi={vociDi(riquadro)}
                              puntatori={puntatoriDi(riquadro)}
                              // Anche qui, e non solo sul grande: su una
                              // condivisione il clic indica sempre, in qualunque
                              // punto della stanza si trovi il riquadro. Una
                              // regola che vale a meta' e' una regola che
                              // bisogna ricordarsi, e nessuno se la ricorda.
                              quandoPunta={
                                riquadro.tipo === 'schermo' && !riquadro.locale
                                  ? (x, y) => sessione.punta(riquadro.id, x, y)
                                  : undefined
                              }
                              quandoTiene={
                                riquadro.tipo === 'schermo' && !riquadro.locale
                                  ? (x, y) => sessione.punta(riquadro.id, x, y, true)
                                  : undefined
                              }
                              quandoLascia={() => sessione.lascia(riquadro.id)}
                              quandoMenu={(x, y) => setMenu({ x, y, id: riquadro.id })}
                              quandoScelto={() => metti(riquadro)}
                              guarda={
                                daSbloccare(riquadro)
                                  ? () => sessione.guarda(riquadro.id)
                                  : undefined
                              }
                              nonGuardare={
                                daSbloccare(riquadro)
                                  ? () => sessione.nonGuardare(riquadro.id)
                                  : undefined
                              }
                              puoiGuardare={postiLiberi}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* La striscia bassa sotto al video non esiste piu': quando il
                  video sta in primo piano le persone finiscono nella striscia
                  vera, quella di fianco, come con ogni altra condivisione. Qui
                  resta solo la griglia. */}
              {(griglia.length > 0 || (youtube && !youtubeAFuoco)) && (
                <div ref={contenitore} className="flex min-h-0 flex-1 justify-center overflow-y-auto">
                  {/* `m-auto` sul figlio invece di `items-center` sul padre.

                      Sono la stessa cosa finche' il contenuto ci sta, e due
                      cose diverse quando non ci sta: il centraggio flex, con
                      un contenuto piu' alto del contenitore, lo taglia sopra e
                      sotto in parti uguali — e la parte sopra non si raggiunge
                      nemmeno scorrendo, perche' finisce a coordinate negative.
                      E' il motivo per cui su uno schermo piccolo i riquadri
                      uscivano dall'alto. Con i margini automatici il contenuto
                      resta centrato quando c'e' spazio e diventa scorribile
                      quando non ce n'e'.

                      Il tetto in larghezza e' cio' che tiene le righe come le
                      ha decise `tessere()`: senza, il flex ne infilerebbe una
                      in piu' dove ci sta, e l'ultima riga resterebbe storta. */}
                  <div
                    className="m-auto flex flex-wrap content-center justify-center gap-2"
                    style={{ maxWidth: tessera.colonne * (tessera.larghezza + SPAZIO) - SPAZIO }}
                  >
                    {youtube && media && !youtubeAFuoco && (
                      <div
                        className="overflow-hidden"
                        style={{ width: tessera.larghezza, height: tessera.altezza }}
                      >
                        <RiquadroYouTube
                          key={youtube.id}
                          sessione={youtube}
                          media={media}
                          puoComandare={
                            media.puoComandare && ingresso.permessi.puoCondividere !== false
                          }
                          aFuoco={false}
                          quandoScelto={() => {
                            setAFuoco(null)
                            setSenzaFuoco(true)
                            setYoutubeAFuoco(true)
                          }}
                          volume={volumeYoutube}
                          muto={youtubeMuto}
                          cambiaVolume={(volume) => {
                            setVolumeYoutube(volume)
                            if (volume > 0) setYoutubeMuto(false)
                          }}
                          alternaMuto={() => setYoutubeMuto((muto) => !muto)}
                          quandoMenu={(x, y) => setMenu({ x, y, id: MENU_YOUTUBE })}
                        />
                      </div>
                    )}
                    {griglia.map((riquadro) => {
                      const { className, ...trascina } = trascinamento(riquadro.id)
                      return (
                        <div
                          key={riquadro.id}
                          {...trascina}
                          className={`${className} overflow-hidden`}
                          style={{ width: tessera.larghezza, height: tessera.altezza }}
                        >
                          <Riquadro
                            dati={riquadro}
                            foto={fotoDi(riquadro.identita)}
                            mostraStatistiche={impostazioni.mostraStatistiche}
                            specchiaCamera={impostazioni.specchiaCamera ?? true}
                            aFuoco={false}
                            volumi={vociDi(riquadro)}
                            puntatori={puntatoriDi(riquadro)}
                            quandoPunta={
                              riquadro.tipo === 'schermo' && !riquadro.locale
                                ? (x, y) => sessione.punta(riquadro.id, x, y)
                                : undefined
                            }
                            quandoTiene={
                              riquadro.tipo === 'schermo' && !riquadro.locale
                                ? (x, y) => sessione.punta(riquadro.id, x, y, true)
                                : undefined
                            }
                            quandoLascia={() => sessione.lascia(riquadro.id)}
                            quandoMenu={(x, y) => setMenu({ x, y, id: riquadro.id })}
                            quandoScelto={() => metti(riquadro)}
                            guarda={
                              daSbloccare(riquadro) ? () => sessione.guarda(riquadro.id) : undefined
                            }
                            nonGuardare={
                              daSbloccare(riquadro)
                                ? () => sessione.nonGuardare(riquadro.id)
                                : undefined
                            }
                            puoiGuardare={postiLiberi}
                          />
                        </div>
                      )
                    })}

                    {/* Ultima della fila: l'invito viene dopo le persone che
                        ci sono gia', non prima. */}
                    {invitoInGriglia && (
                      <div
                        className="overflow-hidden"
                        style={{ width: tessera.larghezza, height: tessera.altezza }}
                      >
                        <RiquadroInvito invita={() => setMostraInvito(true)} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {mostraInvito && (
            <PannelloInvito
              api={api}
              nomeCanale={ingresso.canale.nome}
              gia={new Set(persone.map((p) => Number(p.identita.slice(1))))}
              chiudi={() => setMostraInvito(false)}
            />
          )}

          {scegliSorgente && (
            <SceltaSorgente
              presetIniziale={
                (scegliSorgente.modifica && sessione.presetDiCondivisione(scegliSorgente.modifica)) ||
                impostazioni.presetSchermo
              }
              audioIniziale={impostazioni.audioSistema}
              modalita={
                !scegliSorgente.modifica
                  ? 'nuova'
                  : scegliSorgente.soloAudio
                    ? 'cambia-audio'
                    : 'cambia-video'
              }
              conferma={(s, p, a, solo, bit, inter) => void condividi(s, p, a, solo, bit, inter)}
              chiudi={() => setScegliSorgente(null)}
            />
          )}
        </main>

        {/* La chat, a destra dei riquadri e non sopra: sovrapposta coprirebbe
            proprio le persone che si stanno guardando mentre si scrive. */}
        {mostraChat && canaleVocale && (
          <aside className="flex w-[clamp(14rem,28vw,20rem)] min-w-0 shrink-0 flex-col border-l border-bordo bg-fondo-2">
            <Chat
              api={api}
              canale={canaleVocale}
              chat={chatVocale}
              io={utente}
              profili={profili}
              mostraAnteprimeLink={impostazioni.mostraAnteprimeLink ?? true}
            />
          </aside>
        )}

        {mostraInsieme && media && (
          <aside className="flex w-[clamp(18rem,34vw,26rem)] min-w-0 shrink-0 flex-col border-l border-bordo bg-fondo-2">
            <PannelloInsieme
              api={api}
              media={media}
              impostazioni={impostazioni}
              salva={salvaImpostazioni}
              puoCondividere={ingresso.permessi.puoCondividere !== false}
              chiudi={() => setMostraInsieme(false)}
            />
          </aside>
        )}

      </div>

      {/* I comandi non sono piu' una striscia fissa: compaiono muovendo il
          cursore e si tolgono di mezzo da soli. Le cuffie che silenziano tutto
          non stanno qui ma nel pannello a sinistra, che e' l'unico posto in cui
          si spegne l'ascolto: averle in due posti vorrebbe dire due stati da
          tenere d'accordo e nessuno che sa quale comanda. */}
      <OverlayChiamata
        microfonoAcceso={sessione.microfonoAcceso}
        cameraAccesa={sessione.cameraAccesa}
        puoTrasmettere={ingresso.permessi.puoTrasmettere}
        schermiAttivi={sessione.schermiAttivi}
        audioCondivisi={sessione.audioCondivisi}
        audioRemoti={sessione.audioRemoti}
        volumeAudioCondiviso={sessione.impostaVolumeAudioCondiviso}
        mutoAudioCondiviso={sessione.alternaMutoAudioCondiviso}
        volumeAudioRemoto={sessione.impostaVolumeAudioRemoto}
        mutoAudioRemoto={sessione.alternaMutoAudioRemoto}
        riascoltoAttivo={sessione.riascoltoAttivo}
        secondiRiascolto={impostazioni.secondiRiascolto || 30}
        nomeCanale={ingresso.canale.nome}
        quantePersone={persone.length}
        soloAscolto={ingresso.canale.soloAscolto}
        collegando={collegando}
        chat={
          canaleVocale
            ? {
                aperta: mostraChat,
                alterna: () => {
                  setMostraChat((v) => !v)
                  setMostraInsieme(false)
                }
              }
            : undefined
        }
        insieme={
          media
            ? {
                aperta: mostraInsieme,
                attiva: media.sessioni.length > 0,
                alterna: () => {
                  setMostraInsieme((v) => !v)
                  setMostraChat(false)
                }
              }
            : undefined
        }
        // Vale anche col video in primo piano: da li' in poi e' una
        // condivisione come le altre, e nascondere le persone e' la stessa
        // cosa che si vuole fare.
        soloGrande={
          inPrimoPiano ? { attivo: soloGrande, alterna: () => setSoloGrande((v) => !v) } : undefined
        }
        // Nell'overlay solo quando l'invito non e' gia' una tessera: le due
        // forme si escludono, e a deciderlo e' chi sa com'e' fatta la griglia.
        invita={puoInvitare && !invitoInGriglia ? () => setMostraInvito(true) : undefined}
        impostazioni={impostazioni}
        schermoIntero={schermoIntero}
        alternaMicrofono={() => void sessione.alternaMicrofono()}
        alternaCamera={() => void sessione.alternaCamera()}
        apriCondivisione={() => setScegliSorgente({ modifica: null, soloAudio: false })}
        modificaCondivisione={(id, soloAudio) => setScegliSorgente({ modifica: id, soloAudio })}
        smettiDiCondividere={(id) => void sessione.smettiDiCondividere(id)}
        riascolta={sessione.riascolta}
        salva={(modifiche) => void salvaImpostazioni(modifiche)}
        apriImpostazioni={apriImpostazioni}
        esci={() => void esci()}
      />

      {/* Il menu del tasto destro. Sta qui e non dentro al riquadro perche' e'
          posizionato sulla finestra: dentro, il riquadro grande lo taglierebbe
          ai bordi come taglia tutto il resto. */}
      {(() => {
        if (!menu) return null

        // Il video condiviso non e' un riquadro e non sta nell'elenco: ha una
        // chiave sua. La tendina pero' e' la stessa — per la mano che ci
        // arriva sopra col tasto destro non c'e' nessuna differenza.
        if (menu.id === MENU_YOUTUBE) {
          if (!youtube || !media) return null
          const puoComandare =
            media.puoComandare && ingresso.permessi.puoCondividere !== false
          return (
            <MenuRiquadro
              x={menu.x}
              y={menu.y}
              titolo={youtube.stato.titolo || 'Video condiviso'}
              sottotitolo="YouTube"
              cosa="il video"
              voci={[
                {
                  chiave: 'youtube',
                  nome: 'video',
                  volume: volumeYoutube,
                  muto: youtubeMuto,
                  cambia: (v) => {
                    setVolumeYoutube(v)
                    if (v > 0) setYoutubeMuto(false)
                  },
                  alternaMuto: () => setYoutubeMuto((m) => !m)
                }
              ]}
              aFuoco={youtubeAFuoco}
              metti={() => {
                if (youtubeAFuoco) return setYoutubeAFuoco(false)
                setAFuoco(null)
                setSenzaFuoco(true)
                setYoutubeAFuoco(true)
              }}
              schermoIntero={youtubeAFuoco ? schermoIntero : undefined}
              azioni={
                puoComandare
                  ? [
                      {
                        icona: staSuonando(youtube) ? <Pausa /> : <Play />,
                        testo: staSuonando(youtube) ? 'Metti in pausa per tutti' : 'Riproduci per tutti',
                        fai: () =>
                          void media.comanda(youtube.id, {
                            azione: staSuonando(youtube) ? 'pausa' : 'play'
                          })
                      },
                      {
                        icona: <Riavvolgi />,
                        testo: 'Ricomincia da capo',
                        fai: () => void media.comanda(youtube.id, { azione: 'riparti' })
                      },
                      {
                        icona: <Chiudi />,
                        testo: 'Chiudi il video per tutti',
                        pericolo: true,
                        fai: () => void media.chiudi(youtube.id)
                      }
                    ]
                  : undefined
              }
              chiudi={() => setMenu(null)}
            />
          )
        }

        const suo = riquadri.find((r) => r.id === menu.id)
        if (!suo) return null
        return (
          <MenuRiquadro
            x={menu.x}
            y={menu.y}
            titolo={suo.nome}
            sottotitolo={suo.tipo === 'schermo' ? suo.etichetta : undefined}
            cosa={suo.tipo === 'schermo' ? 'lo schermo' : 'la voce'}
            voci={vociDi(suo)}
            aFuoco={grande?.id === suo.id}
            metti={() => (grande?.id === suo.id ? togli() : metti(suo))}
            schermoIntero={grande?.id === suo.id ? schermoIntero : undefined}
            caccia={
              moderatore && !suo.locale
                ? async () => {
                    try {
                      await api.caccia(ingresso.canale.id, suo.identita)
                    } catch (e) {
                      setErroreLocale((e as Error).message)
                    }
                  }
                : undefined
            }
            qualita={
              suo.locale && suo.tipo === 'schermo'
                ? {
                    scelte: PRESET_SCHERMO.map((p) => ({
                      id: p.id,
                      nome: p.nome,
                      spiegazione: p.spiegazione
                    })),
                    attuale: sessione.presetDiCondivisione(suo.id),
                    cambia: (id) => void sessione.cambiaQualitaCondivisione(suo.id, id)
                  }
                : undefined
            }
            chiudi={() => setMenu(null)}
          />
        )
      })()}
    </div>
  )
}

function AutoWriter({
  api,
  canale,
  sessioneVoce,
  io,
  profili,
  moderatore
}: {
  api: Api
  canale: number
  sessioneVoce: Sessione
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  moderatore: boolean
}): React.JSX.Element | null {
  const [disponibile, setDisponibile] = useState<boolean | null>(null)
  const [stato, setStato] = useState<SessioneAutoWriter | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [riassunto, setRiassunto] = useState<Record<string, string[]> | null>(null)
  const [motivoIndisponibile, setMotivoIndisponibile] = useState<'server' | 'provider' | null>(null)

  useEffect(() => {
    let vivo = true
    let supportato = true
    const carica = (): void => {
      void api.autoWriter(canale).then((r) => {
        if (!vivo) return
        setDisponibile(r.disponibile)
        setStato(r.sessione)
        setMotivoIndisponibile(r.disponibile ? null : 'provider')
        setErrore(null)
      }).catch((e) => {
        if (!vivo) return
        if (e instanceof ErroreApi && e.stato === 404) {
          // Un client nuovo puo' parlare per qualche minuto con il container
          // precedente durante un aggiornamento. Non ha senso ripetere la
          // stessa richiesta ogni tre secondi ne' coprire la chiamata con un
          // errore enorme: la funzione e' semplicemente indisponibile finche'
          // il server non viene ricostruito.
          supportato = false
          setDisponibile(false)
          setMotivoIndisponibile('server')
          setErrore(null)
          return
        }
        setErrore((e as Error).message)
      })
    }
    carica()
    const giro = window.setInterval(() => supportato && carica(), 3000)
    return () => {
      vivo = false
      window.clearInterval(giro)
    }
  }, [api, canale])

  const mioConsenso = stato?.consensi.find((c) => c.utente === io.id)?.consenso ?? null

  useEffect(() => {
    if (stato?.stato !== 'attiva' || mioConsenso !== true || !sessioneVoce.stanza) return
    const pubblicazione = sessioneVoce.stanza.localParticipant.getTrackPublication(Track.Source.Microphone)
    const originale = pubblicazione?.track?.mediaStreamTrack
    if (!originale || typeof MediaRecorder === 'undefined') return
    const copia = originale.clone()
    const flusso = new MediaStream([copia])
    let registratore: MediaRecorder
    try {
      registratore = new MediaRecorder(flusso, { mimeType: 'audio/webm;codecs=opus' })
    } catch {
      registratore = new MediaRecorder(flusso)
    }
    registratore.ondataavailable = (evento) => {
      if (!evento.data.size) return
      void evento.data.arrayBuffer().then((buffer) => {
        const byte = new Uint8Array(buffer)
        let binario = ''
        for (let i = 0; i < byte.length; i += 0x8000) {
          binario += String.fromCharCode(...byte.subarray(i, i + 0x8000))
        }
        return api.segmentoAutoWriter(canale, btoa(binario), evento.data.type || 'audio/webm')
      }).catch((e) => setErrore((e as Error).message))
    }
    registratore.start(8000)
    return () => {
      if (registratore.state !== 'inactive') registratore.stop()
      copia.stop()
    }
  }, [api, canale, mioConsenso, sessioneVoce.stanza, stato?.stato])

  /**
   * Si avvisa quando qualcosa e' rotto, non quando non e' acceso.
   *
   * Un provider di trascrizione mancante non e' un guasto: e' una funzione
   * facoltativa che nessuno ha configurato, e ricordarlo a ogni ingresso in
   * una chiamata e' un promemoria rivolto a chi amministra il NAS — che quasi
   * sempre non e' la persona davanti allo schermo. Vale la stessa regola dei
   * pulsanti AI nel compositore: cio' che non funziona non si mostra, invece
   * di mostrarsi spento e spiegare perche'.
   *
   * Il server piu' vecchio dell'applicazione, invece, resta un avviso. Li' due
   * pezzi che dovrebbero andare insieme non vanno insieme, e non si sistema da
   * solo: qualcuno deve accorgersene.
   */
  usaProblema(
    disponibile === false && motivoIndisponibile === 'server'
      ? {
          chiave: 'autowriter',
          gravita: 'attenzione',
          titolo: 'Auto Writer non è disponibile',
          dettaglio:
            'Il server è più vecchio dell\'applicazione e non conosce Auto Writer. Va aggiornato il server.'
        }
      : null
  )

  const azione = async (fn: () => Promise<unknown>): Promise<void> => {
    setErrore(null)
    try {
      await fn()
      const nuovo = await api.autoWriter(canale)
      setStato(nuovo.sessione)
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  // Niente sessione e niente provider: non c'e' nulla da dire qui, e il motivo
  // per cui non si puo' usare sta fra i problemi, che e' il posto giusto — e'
  // una cosa da sistemare sul server, non una scritta da leggere ogni volta che
  // si entra in una chiamata.
  if (!stato && !disponibile) return null

  return (
    <aside className="absolute top-3 left-1/2 z-40 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-bordo bg-fondo-2/95 p-2.5 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 text-xs">
        <span className={stato?.stato === 'attiva' ? 'text-male' : 'text-testo-2'}>
          ● Auto Writer {stato?.stato === 'attiva' ? 'sta trascrivendo' : stato ? 'attende il consenso' : ''}
        </span>
        {!stato && disponibile && (
          <button className="ml-auto text-vivo underline" onClick={() => void azione(() => api.avviaAutoWriter(canale))}>
            Richiedi attivazione
          </button>
        )}
        {stato && mioConsenso === null && (
          <span className="ml-auto flex gap-2">
            <button className="text-ok underline" onClick={() => void azione(() => api.consensoAutoWriter(canale, true))}>Acconsento</button>
            <button className="text-male underline" onClick={() => void azione(() => api.consensoAutoWriter(canale, false))}>Rifiuto</button>
          </span>
        )}
        {stato && (stato.richiestoDa === io.id || moderatore) && (
          <button className="ml-auto text-male underline" onClick={() => void azione(() => api.fermaAutoWriter(canale))}>Ferma</button>
        )}
      </div>
      {stato?.stato === 'consenso' && (
        <p className="mt-1 text-[11px] text-testo-3">
          Richiesto da {profili.get(stato.richiestoDa)?.nome ?? 'un partecipante'} tramite {stato.provider}. Ognuno decide per sé: chi accetta viene trascritto, chi rifiuta no, e la stanza va avanti comunque.
        </p>
      )}
      {stato?.segmenti.length ? (
        <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-fondo p-2 text-xs">
          {stato.segmenti.slice(-6).map((s) => (
            <p key={s.id}><span className="text-vivo">{s.parlante ? profili.get(s.parlante)?.nome ?? 'Partecipante' : 'Non identificato'}:</span> {s.testo}</p>
          ))}
          <button
            className="mt-1 text-vivo underline"
            onClick={() => void api.riassumiAutoWriter(canale).then((r) => setRiassunto(r.riassunto)).catch((e) => setErrore((e as Error).message))}
          >
            Riassumi conversazione
          </button>
        </div>
      ) : null}
      {riassunto && (
        <div className="mt-2 rounded-lg border border-vivo/30 p-2 text-[11px] text-testo-2">
          <p className="font-medium text-vivo">Riassunto generato dall’AI</p>
          {Object.entries(riassunto).map(([titolo, voci]) => voci.length ? <p key={titolo}><b>{titolo}:</b> {voci.join(' · ')}</p> : null)}
        </div>
      )}
      {errore && <p className="mt-1 text-[11px] text-male">{errore}</p>}
    </aside>
  )
}

/**
 * La barretta che scorre mentre si riascolta.
 *
 * Conta qui dentro e non nella sessione: e' un ridisegno ogni cento
 * millisecondi, e deve toccare questo pezzo di interfaccia soltanto. Messo
 * nella sessione, farebbe ridisegnare dieci volte al secondo tutta la stanza —
 * griglia, video e nomi compresi — per far avanzare una riga colorata.
 */
function BarraRiascolto({
  fino,
  durata,
  ferma
}: {
  fino: number
  durata: number
  ferma: () => void
}): React.JSX.Element {
  const [adesso, setAdesso] = useState(Date.now())

  useEffect(() => {
    const battito = setInterval(() => setAdesso(Date.now()), 100)
    return () => clearInterval(battito)
  }, [])

  const restano = Math.max(0, (fino - adesso) / 1000)
  const fatto = durata > 0 ? Math.min(1, (durata - restano) / durata) : 1

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg border border-vivo/40 bg-vivo/10 px-3 py-2 text-sm text-vivo">
      <Riavvolgi className="h-4 w-4 shrink-0" />
      <span className="shrink-0">riascolto gli ultimi {Math.round(durata)} secondi</span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-vivo/20">
        <div
          className="h-full rounded-full bg-vivo transition-[width] duration-100 ease-linear"
          style={{ width: `${Math.round(fatto * 100)}%` }}
        />
      </div>
      <button
        onClick={ferma}
        title="Torna al vivo"
        aria-label="Torna al vivo"
        className="shrink-0 rounded p-1 hover:bg-vivo/20"
      >
        <Chiudi className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Dove finisce la striscia, tradotto in classi.
 *
 * Sopra e sotto sono lo stesso asse con l'ordine invertito, e non due
 * disposizioni diverse: `flex-col-reverse` mette la striscia prima senza che
 * il JSX debba cambiare ordine, che sarebbe un secondo ramo da tenere allineato
 * al primo per sempre.
 */
const VERSO: Record<PosizioneStriscia, string> = {
  sotto: 'flex-col',
  sopra: 'flex-col-reverse',
  sinistra: 'flex-row-reverse',
  destra: 'flex-row'
}

const STRISCIA: Record<PosizioneStriscia, string> = {
  sotto: 'h-28 w-full flex-row overflow-x-auto overflow-y-hidden',
  sopra: 'h-28 w-full flex-row overflow-x-auto overflow-y-hidden',
  sinistra: 'w-52 flex-col overflow-y-auto overflow-x-hidden',
  destra: 'w-52 flex-col overflow-y-auto overflow-x-hidden'
}

/**
 * La chiave con cui il menu del tasto destro indica il video condiviso.
 *
 * Il menu si apre su un id di riquadro, e il video un riquadro non e': gli
 * serve un nome che nessun riquadro possa avere. Gli id veri arrivano dalla
 * SFU e sono `<identita>/<traccia>`, quindi due punti in testa bastano e
 * avanzano.
 */
const MENU_YOUTUBE = '::youtube'

/** Lo spazio fra un riquadro e l'altro, in pixel. Uguale al `gap-2` del CSS. */
const SPAZIO = 8

/** Se questa sessione sta suonando adesso. */
function staSuonando(sessione: { stato: { inRiproduzione?: boolean } }): boolean {
  return sessione.stato.inRiproduzione === true
}

/** Sedici a nove, come le camere e come quasi tutti gli schermi. */
const RAPPORTO = 16 / 9

/**
 * Quanto grandi i riquadri, e quanti per riga.
 *
 * Si provano tutte le disposizioni possibili — da una colonna sola fino a una
 * riga sola — e vince quella che fa i riquadri piu' grandi tenendoli in 16:9.
 * E' un ciclo su una manciata di numeri, e gira solo quando cambia la misura
 * della finestra o il numero di persone.
 *
 * Sembra il tipo di cosa che dovrebbe fare il CSS, e infatti il CSS la fa: la
 * fa male. `grid-cols-3` con le righe che si allungano da' riquadri di forme
 * diverse a ogni numero di partecipanti, e nessuna combinazione di `aspect` e
 * `minmax` sa scegliere fra tre colonne larghe e due colonne alte — perche' per
 * sceglierle bisogna conoscere l'altezza, e a quel punto tanto vale contarla.
 */
function tessere(
  quanti: number,
  larghezza: number,
  altezza: number
): { larghezza: number; altezza: number; colonne: number } {
  if (quanti <= 0 || larghezza <= 0 || altezza <= 0) {
    return { larghezza: 0, altezza: 0, colonne: 1 }
  }

  let migliore = { larghezza: 0, altezza: 0, colonne: 1 }

  for (let colonne = 1; colonne <= quanti; colonne++) {
    const righe = Math.ceil(quanti / colonne)
    const perTessera = (larghezza - SPAZIO * (colonne - 1)) / colonne
    const altezzaDisponibile = (altezza - SPAZIO * (righe - 1)) / righe
    if (perTessera <= 0 || altezzaDisponibile <= 0) continue

    // La larghezza la decide il piu' stretto fra i due vincoli: lo spazio
    // orizzontale che c'e', e quello che l'altezza consente restando in 16:9.
    const l = Math.floor(Math.min(perTessera, altezzaDisponibile * RAPPORTO))
    if (l > migliore.larghezza) {
      migliore = { larghezza: l, altezza: Math.floor(l / RAPPORTO), colonne }
    }
  }

  return migliore
}
