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
import { usaOverlay } from '../lib/usaOverlay'
import { usaTempoInsieme } from '../lib/usaTempoInsieme'
import { usaRegistrazione } from '../lib/usaRegistrazione'
import { usaSpostamento } from '../lib/animazioni'
import { ponte } from '../ponte'
import { Chiudi, Matita, Pausa, Play, Riavvolgi, SchermoCondividi, SchermoStop } from '../icone'
import { Avviso } from '../ui'
import OverlayChiamata from './OverlayChiamata'
import BarraRegistrazione from './Registrazione'
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
import {
  fraseRestrizione,
  vociModerazione as costruisciVociModerazione,
  type Restrizioni
} from '../lib/usaRestrizioni'
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
  colonne,
  tornaAiServer,
  chatVocale,
  canaleVocale,
  utente,
  media,
  condivisioneRichiesta = false,
  condivisioneServita,
  restrizioni
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
   * Le colonne di sinistra: come stanno, e come si aprono e si chiudono.
   *
   * Passano di qui solo per arrivare all'overlay, che e' dove sta la linguetta
   * per aprirle e chiuderle: la sala non le tocca e non le guarda. Sono
   * dell'applicazione, e si chiudono anche stando in una chat — ma in chiamata
   * quel pulsante deve sparire col cursore come tutti gli altri, e l'unico
   * posto che sparisce col cursore e' li' dentro.
   */
  colonne: { ritirate: boolean; alterna: () => void }
  /** Sul telefono torna a server e canali senza abbandonare la voce. */
  tornaAiServer?: () => void
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
  /**
   * Qualcuno ha chiesto di condividere da fuori: dal pulsante nel pannello in
   * basso a sinistra, che resta a portata anche leggendo un'altra pagina.
   *
   * Arriva vera anche al primo disegno — premere quel pulsante da una chat
   * fa nascere questa schermata e alza la richiesta nello stesso istante — e
   * per questo va spenta chiamando `condivisioneServita`, non confrontandola
   * con il valore precedente: al primo disegno un valore precedente non c'e'.
   */
  condivisioneRichiesta?: boolean
  condivisioneServita?: () => void
  /**
   * Chi, in questa stanza, ha addosso cosa.
   *
   * Arriva da fuori come la sessione, e per lo stesso motivo: la colonna dei
   * canali deve poterla leggere anche mentre si sta guardando una chat, e uno
   * stato tenuto qui dentro morirebbe ogni volta che si cambia schermata.
   */
  restrizioni: Restrizioni
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

  /** La richiesta arrivata da fuori: apri la scelta di cosa condividere. */
  useEffect(() => {
    if (!condivisioneRichiesta) return
    condivisioneServita?.()
    if (ingresso.permessi.puoCondividere === false) return
    setScegliSorgente({ modifica: null, soloAudio: false })
  }, [condivisioneRichiesta, condivisioneServita, ingresso.permessi.puoCondividere])

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
  /**
   * Auto Writer: se il pannello e' stato chiesto, e se sta trascrivendo.
   *
   * Il pannello non compare piu' da solo quando il server e' configurato:
   * adesso ha un pulsante suo nella barra alta, accanto alla chat. Prima non
   * ne aveva nessuno, e la funzione risultava una cosa che ogni tanto appariva
   * in cima alla stanza — o che non esisteva affatto, se sul NAS mancava il
   * modello. In nessuno dei due casi c'era un posto dove andarla a cercare.
   */
  const [trascrizioneAperta, setTrascrizioneAperta] = useState(false)
  const [trascrizioneAttiva, setTrascrizioneAttiva] = useState(false)
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

  // L'overlay: le facce sopra a tutto quando la finestra e' ridotta a icona.
  // Da qui esce solo il racconto di chi c'e' e chi parla; se e quando si veda
  // lo decide il processo principale, che e' l'unico a sapere com'e' messa la
  // finestra. Gli passa l'elenco di partenza e non quello riordinato a mano:
  // l'ordine dei riquadri e' una cosa di questa griglia.
  usaOverlay(sessione.riquadri, profili)

  // Da quanto si sta insieme qui dentro: lo dice l'ora d'ingresso del primo,
  // che la SFU manda con ogni partecipante. Vive qui perche' qui c'e' la
  // stanza; a mostrarlo e' la barra alta, accanto al nome del canale.
  const secondiInsieme = usaTempoInsieme(sessione.stanza)

  /**
   * La registrazione, una sola per tutta la sala.
   *
   * Vive qui e non dentro a uno dei due pezzi che la mostrano: la barra rossa
   * in cima e il tasto fra i comandi sono due finestre sulla stessa cosa, e un
   * `usaRegistrazione` per ciascuno sarebbe stato due registratori che non si
   * sanno l'uno dell'altro - con il tasto che dice «registra» mentre la barra
   * dice che stai gia' registrando.
   */
  const registratore = usaRegistrazione(sessione.stanza, {
    api,
    canale: ingresso.canale.id,
    nomeCanale: ingresso.canale.nome,
    // La regola arriva con il gettone. Sui server piu' vecchi di questa
    // funzione il campo non c'e', e li' vale «libera»: e' quello che facevano.
    regola: ingresso.registrazione ?? 'libera'
  })

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
    // Il riquadro che si sta trascinando resta opaco.
    //
    // Prima si smorzava al 40%, che e' la convenzione dei trascinamenti di
    // file: li' l'oggetto e' un'icona ferma, e sbiadirlo dice "questo lo stai
    // spostando". Qui l'oggetto e' un video in movimento — una faccia che
    // parla, uno schermo su cui qualcuno sta lavorando — e smorzarlo vuol dire
    // smettere di poterlo guardare proprio nel momento in cui si sta decidendo
    // dove metterlo. Il segno c'e' lo stesso, ma e' un contorno tratteggiato
    // intorno: si distingue dal contorno pieno di dove si sta per lasciare, e
    // non toglie un pixel di immagine.
    className: `${
      trascinato === id
        ? 'outline outline-2 outline-dashed -outline-offset-2 outline-testo-3 rounded-xl'
        : ''
    } ${
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
      // A tutto schermo Esc serve gia' a uscire da li', e lo fa chi sta sopra.
      // Il controllo c'era gia' scritto nel commento e mancava nel codice: si
      // guardava soltanto il tutto schermo di un elemento — che questa
      // applicazione non usa mai — mentre quello vero e' uno stato di React.
      if (schermoIntero.attivo) return
      setAFuoco((prima) => {
        if (prima) setSenzaFuoco(true)
        return null
      })
      setYoutubeAFuoco(false)
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [schermoIntero.attivo])

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

  /**
   * Chi e' gia' comparso in questa sala.
   *
   * Serve perche' i riquadri vengono rimontati quando cambiano posto: il posto
   * grande, la striscia e la griglia sono tre rami diversi dell'albero, e
   * spostarne uno vuol dire distruggerlo e rifarlo. L'animazione di comparsa
   * riparte quindi a ogni ingrandimento — e non su uno solo: mettendo a fuoco
   * un riquadro, tutti gli altri passano insieme dalla griglia alla striscia.
   * Quello che si vede e' un lampo di tutta la sala.
   *
   * Questa memoria sta qui e non dentro al riquadro proprio perche' la sala
   * non viene rimontata: e' l'unico posto da cui si possa distinguere "sono
   * appena arrivato" da "mi hanno spostato".
   *
   * Si legge durante il disegno e si aggiorna dopo, quando cio' che si e'
   * disegnato e' ormai sullo schermo.
   */
  const gia = useRef<Set<string>>(new Set())
  useEffect(() => {
    const presenti = new Set(riquadri.map((r) => r.id))
    // Chi se ne va viene dimenticato: rientrando e' una comparsa vera, e
    // merita l'animazione come la prima volta.
    for (const id of gia.current) if (!presenti.has(id)) gia.current.delete(id)
    for (const id of presenti) gia.current.add(id)
  })

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

  /**
   * Cosa si puo' fare a QUESTO riquadro, e a nessun altro.
   *
   * E' la parte del menu del tasto destro che cambia sotto le dita: la propria
   * condivisione si cambia e si spegne, quella di un altro si apre e si
   * chiude, una persona non ha niente di suo — la sua voce sta gia' nel
   * cursore in cima al menu, e cacciarla e' un'altra faccenda, in fondo e in
   * rosso.
   *
   * Aprire e chiudere una condivisione altrui si puo' anche dai pulsantini
   * che compaiono sul riquadro, e il doppione e' voluto: quelli si trovano
   * solo passandoci sopra e sapendo gia' che ci sono. Cambiare e spegnere la
   * PROPRIA, invece, finora si poteva solo dal pannello delle condivisioni in
   * fondo — cioe' da un'altra parte della stanza rispetto alla cosa da
   * cambiare.
   */
  const azioniDi = (
    r: DatiRiquadro
  ): { icona: React.ReactNode; testo: string; fai: () => void; pericolo?: boolean }[] | undefined => {
    if (r.tipo !== 'schermo') return undefined

    if (r.locale) {
      return [
        {
          icona: <Matita />,
          testo: 'Cambia cosa sto condividendo',
          fai: () => setScegliSorgente({ modifica: r.id, soloAudio: false })
        },
        {
          icona: <SchermoStop />,
          testo: 'Smetti di condividere',
          pericolo: true,
          fai: () => void sessione.smettiDiCondividere(r.id)
        }
      ]
    }

    if (r.bloccato) {
      // Senza posti liberi non c'e' niente da mettere: una riga di menu che si
      // preme e non fa niente e' peggio di una riga che non c'e'. Il perche'
      // sta gia' scritto sul riquadro, sotto al lucchetto, in caratteri ben
      // piu' grandi di questi.
      return postiLiberi
        ? [
            {
              icona: <SchermoCondividi />,
              testo: 'Guarda e ascolta',
              fai: () => sessione.guarda(r.id)
            }
          ]
        : undefined
    }

    // Una cosa sola e detta come una cosa sola: l'immagine e il suono di quello
    // schermo si aprono e si chiudono insieme. Finche' la voce diceva soltanto
    // "smetti di guardare", chiuderla lasciava il suono acceso — e chi l'aveva
    // premuta continuava a sentire il gioco di un altro senza capire da dove
    // arrivasse, visto che il riquadro non c'era piu'.
    return [
      {
        icona: <SchermoStop />,
        testo: 'Smetti di guardare e ascoltare — libera un posto',
        fai: () => sessione.nonGuardare(r.id)
      }
    ]
  }

  /**
   * L'identita' sulla SFU e' `u<id>`: da li' si torna all'utente.
   *
   * E' la stessa conversione che fa il server all'ingresso, e l'unica chiave su
   * cui una presenza, un riquadro e un profilo combaciano.
   */
  const idDi = (identita: string): number => Number(identita.slice(1))

  /** Cosa chi guarda ha il diritto di fare agli altri, deciso dal server. */
  const poteri = ingresso.permessi

  /**
   * I provvedimenti che si possono prendere su questa persona.
   *
   * L'elenco lo filtra il server: `ingresso.permessi` dice cosa chi guarda ha
   * il diritto di fare qui dentro, e ci sta dentro anche il caso di chi non
   * amministra lo spazio ma sta organizzando un evento in questo canale
   * adesso. A dire di no resta comunque il server, su ogni richiesta: questo
   * elenco decide soltanto cosa disegnare.
   *
   * Su se stessi niente: non ci si modera da soli, e il server risponderebbe
   * 400 a chi ci provasse.
   */
  const vociModerazione = (r: DatiRiquadro): ReturnType<typeof costruisciVociModerazione> => {
    if (r.locale) return undefined
    return costruisciVociModerazione(
      poteri,
      restrizioni,
      ingresso.canale.id,
      idDi(r.identita),
      setErroreLocale
    )
  }

  // La combinazione richiesta per la vera superficie video: chiamata a tutta
  // applicazione, un riquadro in primo piano e la striscia degli altri
  // nascosta. In tutti gli altri casi restano i margini che separano le
  // tessere e fanno posto alle barre dell'overlay.
  const aTuttaSuperficie = schermoIntero.attivo && inPrimoPiano && soloGrande

  /**
   * Il tragitto, quando qualcuno va in sovraimpressione o torna nella griglia.
   *
   * Il segno mette insieme le quattro cose che spostano i riquadri: chi e' al
   * posto grande, se le persone sono nascoste, se il grande e' il video, e da
   * che lato sta la striscia. Cambiando una qualunque, i riquadri cambiano
   * ramo dell'albero e React li rifa da capo altrove — vedi `usaSpostamento`,
   * che e' cio' che rende quel salto un movimento.
   */
  usaSpostamento(radice, `${grande?.id ?? ''}|${soloGrande}|${youtubeAFuoco}|${aggancio}`)

  // `relative` sulla radice qui sotto e l ancora della barra dei comandi.
  // Senza, quella si aggrappava alla radice dell applicazione — che comprende
  // le due colonne di sinistra — e finiva centrata sulla finestra invece che
  // sulla schermata della chiamata.
  return (
    <div ref={radice} className="relative flex h-full min-h-0 flex-col bg-fondo">
      {/* Cio' che sta succedendo, in una colonna sola.
          Trascrizione e registrazione sono le due cose che devono vedersi
          sempre e non possono coprirsi: impilate, con `pointer-events-none`
          sulla colonna perche' lo spazio vuoto fra una barra e l'altra non
          deve rubare i clic al video che ci sta sotto. */}
      <div className="pointer-events-none absolute top-3 left-1/2 z-40 flex w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 flex-col gap-2">
        {canaleVocale && (
          <AutoWriter
            api={api}
            canale={canaleVocale.id}
            sessioneVoce={sessione}
            io={utente}
            profili={profili}
            moderatore={moderatore}
            aperto={trascrizioneAperta}
            chiudi={() => setTrascrizioneAperta(false)}
            quandoCambia={setTrascrizioneAttiva}
          />
        )}
        <BarraRegistrazione registratore={registratore} />
      </div>
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
            riquadro. Uguale a `pb-20` perche' le due barre sono alte uguali.

            Ai lati e' la stessa idea, ed e' arrivata dopo: la linguetta delle
            colonne e' larga venti pixel e sta appoggiata al bordo sinistro, e
            con `px-3` i riquadri le finivano sotto. Lo stesso spazio anche a
            destra, dove non c'e' niente da schivare, perche' una griglia
            staccata da un bordo solo si vede — e a quel punto sembra storta. */}
        <main
          className={`group/sala relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            aTuttaSuperficie
              ? 'gap-0 p-0'
              : 'gap-2 px-1 pt-14 pb-18 sm:px-3 sm:pt-20 sm:pb-20 md:px-7'
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

          {/* Cosa ti e' stato tolto, e da chi.
              Senza questa riga il microfono semplicemente non risponde, e un
              pulsante che non risponde si legge come un guasto: si riavvia
              l'applicazione, si cambia dispositivo, si scrive a qualcuno che
              "non funziona". Scritto, invece, e' una decisione a cui si puo'
              rispondere — e la persona a cui rispondere ha un nome. */}
          {restrizioni.mie.length > 0 && (
            <Avviso tono="attenzione">
              <div className="space-y-0.5">
                {restrizioni.mie.map((r) => (
                  <p key={r.genere}>{fraseRestrizione(r)}</p>
                ))}
              </div>
            </Avviso>
          )}

          {/* Detto una volta e piccolo: due gesti che non si scoprono da soli,
              e che dopo averli letti una volta non si dimenticano piu'. */}
          {grande?.tipo === 'schermo' && (
            <p className="pointer-events-none absolute right-4 bottom-2 z-10 text-[11px] text-testo-3 opacity-0 transition-opacity group-hover/sala:opacity-100">
              rotella per ingrandire · clic per indicare · icona in basso a destra per la
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
                  <div className="palco-sala flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
                    <div
                      data-riquadro={youtubeGrande && youtube ? youtube.id : grande?.id}
                      className={`overflow-hidden ${
                        aTuttaSuperficie ? 'h-full w-full' : 'grande-sala'
                      }`}
                    >
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
                          aTuttaSuperficie={aTuttaSuperficie}
                        />
                      ) : grande ? (
                        <Riquadro
                          dati={grande}
                          nuovo={!gia.current.has(grande.id)}
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
                          guarda={
                            daSbloccare(grande) ? () => sessione.guarda(grande.id) : undefined
                          }
                          nonGuardare={
                            daSbloccare(grande) ? () => sessione.nonGuardare(grande.id) : undefined
                          }
                          smettiDiCondividere={
                            grande.locale && grande.tipo === 'schermo'
                              ? () => void sessione.smettiDiCondividere(grande.id)
                              : undefined
                          }
                          puoiGuardare={postiLiberi}
                          aTuttaSuperficie={aTuttaSuperficie}
                        />
                      ) : null}
                    </div>
                  </div>

                  {striscia.length > 0 && !soloGrande && (
                    <div className={`flex shrink-0 gap-2 p-px ${STRISCIA[aggancio]}`}>
                      {striscia.map((riquadro) => {
                        const { className, ...trascina } = trascinamento(riquadro.id)
                        return (
                          <div
                            key={riquadro.id}
                            data-riquadro={riquadro.id}
                            {...trascina}
                            className={`aspect-video shrink-0 ${
                              aggancio === 'sotto' || aggancio === 'sopra' ? 'h-full' : 'w-full'
                            } ${className}`}
                          >
                            <Riquadro
                              dati={riquadro}
                              nuovo={!gia.current.has(riquadro.id)}
                              foto={fotoDi(riquadro.identita)}
                              mostraStatistiche={impostazioni.mostraStatistiche}
                              specchiaCamera={impostazioni.specchiaCamera ?? true}
                              aFuoco={false}
                              volumi={vociDi(riquadro)}
                              puntatori={puntatoriDi(riquadro)}
                              // Niente `quandoPunta` qui: da piccolo un
                              // riquadro non si indica. I "guarda qui" degli
                              // altri si vedono lo stesso — arrivano da
                              // `puntatori` — ma mandarne uno vuole
                              // l'immagine grande, dove si vede davvero cosa
                              // si sta toccando. Da qui il clic serve a
                              // portarsi la condivisione davanti, che e' cio'
                              // che uno intende facendolo.
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
                              smettiDiCondividere={
                                riquadro.locale && riquadro.tipo === 'schermo'
                                  ? () => void sessione.smettiDiCondividere(riquadro.id)
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
              {/* Lo spazio della barra di scorrimento, qui sotto, e' sempre
                  riservato: non e' un dettaglio estetico, e' la cura del
                  tremolio.

                  `tessere()` fa riquadri che riempiono `clientWidth` fino
                  all'ultimo pixel. Basta un fotogramma in cui serva una barra
                  verticale — e ne bastano tanti, perche' mentre le colonne di
                  sinistra si ritirano quella misura cambia a ogni fotogramma e
                  il ridisegno che ne segue atterra in quello dopo — e i dieci
                  pixel della barra spariscono dalla larghezza utile: la riga
                  non ci sta piu', la griglia si ri-avvolge su una colonna in
                  meno, il contenuto diventa alto una volta e mezza, e a quel
                  punto la barra serve davvero. Al giro dopo si rimisura, i
                  riquadri tornano piccoli, la barra se ne va, e si ricomincia.
                  Misurato su una riproduzione: l'altezza del contenuto saltava
                  fra 440 e 649 pixel per tutta la durata dell'animazione.

                  Riservando il posto una volta per tutte, la larghezza su cui
                  si fa il conto e quella su cui si disegna sono la stessa, e il
                  giro non parte. Costa dieci pixel sempre, invece di toglierli
                  e rimetterli venti volte al secondo. */}
              {(griglia.length > 0 || (youtube && !youtubeAFuoco)) && (
                <div
                  ref={contenitore}
                  className="contenitore-griglia flex min-h-0 flex-1 justify-center overflow-y-auto"
                >
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
                    className="griglia-sala m-auto flex flex-wrap content-center justify-center gap-2"
                    style={
                      {
                        '--colonne': tessera.colonne,
                        '--righe': tessera.righe
                      } as React.CSSProperties
                    }
                  >
                    {youtube && media && !youtubeAFuoco && (
                      <div data-riquadro={youtube.id} className="overflow-hidden">
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
                          data-riquadro={riquadro.id}
                          {...trascina}
                          className={`${className} overflow-hidden`}
                        >
                          <Riquadro
                            dati={riquadro}
                            nuovo={!gia.current.has(riquadro.id)}
                            foto={fotoDi(riquadro.identita)}
                            mostraStatistiche={impostazioni.mostraStatistiche}
                            specchiaCamera={impostazioni.specchiaCamera ?? true}
                            aFuoco={false}
                            volumi={vociDi(riquadro)}
                            puntatori={puntatoriDi(riquadro)}
                            // Come nella striscia: si indica solo da grandi.
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
                            smettiDiCondividere={
                              riquadro.locale && riquadro.tipo === 'schermo'
                                ? () => void sessione.smettiDiCondividere(riquadro.id)
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
                      <div className="overflow-hidden">
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
              altoparlanteScelto={impostazioni.altoparlanteId}
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
          <aside className="absolute inset-0 z-40 flex min-w-0 flex-col border-l border-bordo bg-fondo-2 md:static md:w-[clamp(18rem,32vw,26rem)] md:shrink-0">
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
          <aside className="absolute inset-0 z-40 flex min-w-0 flex-col border-l border-bordo bg-fondo-2 md:static md:w-[clamp(18rem,34vw,26rem)] md:shrink-0">
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
        guardaCondivisione={sessione.guarda}
        nonGuardareCondivisione={sessione.nonGuardare}
        riascoltoAttivo={sessione.riascoltoAttivo}
        secondiRiascolto={impostazioni.secondiRiascolto || 30}
        nomeCanale={ingresso.canale.nome}
        registrazione={{ registratore, riquadri: sessione.riquadri }}
        secondiInsieme={secondiInsieme}
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
        trascrizione={
          canaleVocale
            ? {
                aperta: trascrizioneAperta,
                attiva: trascrizioneAttiva,
                alterna: () => setTrascrizioneAperta((v) => !v)
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
        colonne={colonne}
        schermoIntero={schermoIntero}
        tornaAiServer={tornaAiServer}
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
            azioni={azioniDi(suo)}
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
            // Sul riquadro di una persona i quattro provvedimenti; su quello di
            // una condivisione no — li' quello che serve e' chiuderla, e
            // "togli la condivisione" e' una decisione sulla persona che si
            // prende dal suo riquadro.
            moderazione={suo.tipo === 'persona' ? vociModerazione(suo) : undefined}
            chiudiCondivisione={
              suo.tipo === 'schermo' && !suo.locale && poteri.moderatore
                ? () => {
                    void api
                      .chiudiCondivisione(ingresso.canale.id, idDi(suo.identita), suo.id)
                      .catch((e) => setErroreLocale((e as Error).message))
                  }
                : undefined
            }
            restrizioniAddosso={
              suo.tipo === 'persona'
                ? restrizioni.per(ingresso.canale.id).get(idDi(suo.identita))
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
  moderatore,
  aperto,
  chiudi,
  quandoCambia
}: {
  api: Api
  canale: number
  sessioneVoce: Sessione
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  moderatore: boolean
  /**
   * Se il pannello e' stato chiesto dal pulsante nella barra alta.
   *
   * Chiuso, questo pannello resta comunque acceso quando una sessione esiste
   * davvero: una richiesta di consenso — o una trascrizione in corso — deve
   * vedersi da sola, senza che nessuno debba aprire niente. Auto Writer non
   * deve mai poter diventare una registrazione di nascosto, e un pannello che
   * si puo' chiudere sarebbe esattamente questo.
   */
  aperto: boolean
  chiudi: () => void
  /** Dice alla sala se sta trascrivendo, per il pallino sul pulsante. */
  quandoCambia: (attiva: boolean) => void
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

  const attiva = stato?.stato === 'attiva'
  useEffect(() => quandoCambia(attiva), [attiva, quandoCambia])

  // Chiuso e senza sessione non c'e' niente da mostrare. Con una sessione
  // aperta invece si mostra sempre, che il pannello sia stato chiesto o no:
  // vedi `aperto`.
  if (!aperto && !stato) return null

  return (
    // Non si posiziona piu' da solo: sta in una colonna insieme alla barra
    // della registrazione, perche' erano tutte e due a `top-3 left-1/2` con la
    // stessa larghezza e con una trascrizione e una registrazione insieme si
    // coprivano a vicenda. Sono le due interfacce che non possono permettersi
    // di essere illeggibili.
    <aside className="pointer-events-auto w-full rounded-xl border border-bordo bg-fondo-2/95 p-2.5 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 text-xs">
        <span className={attiva ? 'text-male' : 'text-testo-2'}>
          ● Auto Writer {attiva ? 'sta trascrivendo' : stato ? 'attende il consenso' : ''}
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
        {/* La croce chiude il pannello, non la sessione. C'e' solo quando non
            c'e' niente in ballo: con una richiesta di consenso in piedi
            chiudere vorrebbe dire far sparire la domanda, e la domanda deve
            restare sotto agli occhi di tutti finche' qualcuno non risponde. */}
        {!stato && (
          <button
            onClick={chiudi}
            title="Chiudi"
            aria-label="Chiudi"
            className="-my-1 ml-1 shrink-0 rounded-lg p-1 text-testo-3 transition-colors hover:bg-fondo-3 hover:text-testo"
          >
            <Chiudi className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Come si attiva, detto per esteso e solo quando serve: aperto il
          pannello e senza niente in corso. E' la domanda che si fa la prima
          volta, e finora l'unica risposta era provare a premere. */}
      {!stato && disponibile && (
        <p className="mt-1 text-[11px] leading-snug text-testo-3">
          Trasforma in testo quello che si dice qui dentro. Chiedendo
          l&apos;attivazione la richiesta compare a tutti i presenti: ognuno
          decide per sé, chi accetta viene trascritto e chi rifiuta no. Nessun
          audio parte senza un sì.
        </p>
      )}

      {/* Niente provider configurato. Prima qui non compariva niente — nessun
          pannello, nessun pulsante, nessuna spiegazione — e la funzione
          risultava semplicemente inesistente: e' la ragione per cui non si
          capiva da dove si attivasse. Detto solo a chi apre apposta, che e'
          la persona che se lo sta chiedendo. */}
      {!stato && disponibile === false && (
        <p className="mt-1 text-[11px] leading-snug text-testo-3">
          {motivoIndisponibile === 'server'
            ? "Il server è più vecchio dell'applicazione e non conosce Auto Writer: va aggiornato il server."
            : "Su questo server non è configurato nessun modello di riconoscimento vocale, quindi non c'è niente da attivare. Si accende dal NAS, con le variabili TALK_AI_API_KEY e TALK_AI_STT_MODEL sul container di PulseTalk."}
        </p>
      )}

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

/**
 * `center-safe` e non `center`: la striscia scorre.
 *
 * Con il centraggio normale, tre riquadri in una finestra stretta non
 * traboccano solo a destra — traboccano di meta' per parte, e la meta' di
 * sinistra finisce a coordinate negative, dove lo scorrimento non arriva. Il
 * centraggio "sicuro" centra finche' il contenuto ci sta e allinea all'inizio
 * appena non ci sta piu', che e' esattamente la regola giusta per una striscia
 * che puo' scorrere.
 */
const STRISCIA: Record<PosizioneStriscia, string> = {
  sotto: 'h-28 w-full flex-row justify-center-safe overflow-x-auto overflow-y-hidden',
  sopra: 'h-28 w-full flex-row justify-center-safe overflow-x-auto overflow-y-hidden',
  sinistra: 'w-52 flex-col justify-center-safe overflow-y-auto overflow-x-hidden',
  destra: 'w-52 flex-col justify-center-safe overflow-y-auto overflow-x-hidden'
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
): { larghezza: number; altezza: number; colonne: number; righe: number } {
  if (quanti <= 0 || larghezza <= 0 || altezza <= 0) {
    return { larghezza: 0, altezza: 0, colonne: 1, righe: 1 }
  }

  let migliore = { larghezza: 0, altezza: 0, colonne: 1, righe: 1 }

  for (let colonne = 1; colonne <= quanti; colonne++) {
    const righe = Math.ceil(quanti / colonne)
    const perTessera = (larghezza - SPAZIO * (colonne - 1)) / colonne
    const altezzaDisponibile = (altezza - SPAZIO * (righe - 1)) / righe
    if (perTessera <= 0 || altezzaDisponibile <= 0) continue

    // La larghezza la decide il piu' stretto fra i due vincoli: lo spazio
    // orizzontale che c'e', e quello che l'altezza consente restando in 16:9.
    const l = Math.floor(Math.min(perTessera, altezzaDisponibile * RAPPORTO))
    if (l > migliore.larghezza) {
      migliore = { larghezza: l, altezza: Math.floor(l / RAPPORTO), colonne, righe }
    }
  }

  return migliore
}
