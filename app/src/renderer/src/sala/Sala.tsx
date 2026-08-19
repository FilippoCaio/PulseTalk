import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionState } from 'livekit-client'
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
import type { Api } from '../lib/api'
import type { Riquadro as DatiRiquadro, Sessione } from '../lib/usaSessione'
import { usaMisura } from '../lib/misura'
import { ponte } from '../ponte'
import { Altoparlante, Chiudi, Fumetto, Riavvolgi } from '../icone'
import { Avviso } from '../ui'
import OverlayChiamata from './OverlayChiamata'
import MenuRiquadro from './MenuRiquadro'
import Chat from '../chat/Chat'
import type { usaChat } from '../lib/usaChat'
import Riquadro from './Riquadro'
import SceltaSorgente from './SceltaSorgente'
import type { VoceVolume } from './Volume'

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
  utente
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
}): React.JSX.Element {
  const [aFuoco, setAFuoco] = useState<string | null>(null)
  // Vero quando l'utente ha tolto lui il fuoco. Serve a non rimetterlo subito:
  // senza, chiudere l'unico schermo condiviso lo farebbe tornare grande al
  // disegno successivo, e sembrerebbe che il clic non abbia funzionato.
  const [senzaFuoco, setSenzaFuoco] = useState(false)
  const [scegliSorgente, setScegliSorgente] = useState(false)
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

  const { grande, striscia, griglia } = useMemo(() => {
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

  const tessera = useMemo(
    () => tessere(griglia.length, spazio.larghezza, spazio.altezza),
    [griglia.length, spazio.larghezza, spazio.altezza]
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
    bitrateAudio: number
  ): Promise<void> => {
    setScegliSorgente(false)
    // La scelta fatta qui vale per questa condivisione: quella di serie resta
    // nelle impostazioni e non viene riscritta da un ripensamento di un minuto.
    await sessione.condividi(sorgente, preset, audio, soloAudio, bitrateAudio)
  }

  const aggancio: PosizioneStriscia = impostazioni.posizioneStriscia ?? 'sotto'
  const collegando = sessione.stato === ConnectionState.Reconnecting

  // `relative` sulla radice qui sotto e l ancora della barra dei comandi.
  // Senza, quella si aggrappava alla radice dell applicazione — che comprende
  // le due colonne di sinistra — e finiva centrata sulla finestra invece che
  // sulla schermata della chiamata.
  return (
    <div ref={radice} className="relative flex h-full min-h-0 flex-col bg-fondo">
      {/* A tutto schermo l'intestazione se ne va: chi ci e' andato l'ha fatto
          per vedere il video, e il nome del canale lo sa gia'. */}
      {!schermoIntero.attivo && (
        <header className="flex items-center justify-between border-b border-bordo px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Altoparlante className="h-4 w-4 shrink-0 text-testo-3" />
            <div className="min-w-0">
              <h1 className="truncate font-medium">{ingresso.canale.nome}</h1>
              <p className="flex items-center gap-1.5 text-xs text-testo-3">
                {persone.length === 1 ? 'sei solo qui' : `${persone.length} persone`}
                {ingresso.canale.soloAscolto && ' · palco'}
                {!ingresso.permessi.puoTrasmettere && ' · puoi solo ascoltare'}
                {/* Detto, e non nascosto: l'anello del riascolto tiene in
                    memoria la voce di altre persone. Non esce da questo
                    computer e muore uscendo dalla stanza, ma chi c'e' dentro
                    ha diritto di vederlo scritto da qualche parte. */}
                {sessione.riascoltoAttivo && (
                  <span
                    title={`Gli ultimi ${impostazioni.secondiRiascolto || 30} secondi di voce restano in memoria, qui, per poterli riascoltare. Non toccano il disco e spariscono uscendo.`}
                    className="flex items-center gap-1 text-testo-3"
                  >
                    ·
                    <Riavvolgi className="h-3 w-3" />
                    {impostazioni.secondiRiascolto || 30}s
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {collegando && (
              <span className="respiro text-xs text-attenzione">riprendo la linea…</span>
            )}
            {canaleVocale && (
              <button
                onClick={() => setMostraChat((v) => !v)}
                title={mostraChat ? 'Chiudi la chat del canale' : 'Apri la chat del canale'}
                aria-label={mostraChat ? 'Chiudi la chat del canale' : 'Apri la chat del canale'}
                className={`transition-colors ${
                  mostraChat ? 'text-vivo' : 'text-testo-3 hover:text-testo'
                }`}
              >
                <Fumetto className="h-5 w-5" />
              </button>
            )}
          </div>
        </header>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="group/sala relative flex min-w-0 flex-1 flex-col gap-2 p-3">
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
              {grande && (
                <div className={`flex min-h-0 flex-1 gap-2 ${VERSO[aggancio]}`}>
                  <div className="min-h-0 min-w-0 flex-1">
                    <Riquadro
                      dati={grande}
                      foto={fotoDi(grande.identita)}
                      mostraStatistiche={impostazioni.mostraStatistiche}
                      aFuoco
                      volumi={vociDi(grande)}
                      schermoIntero={schermoIntero}
                      puntatori={puntatoriDi(grande)}
                      quandoPunta={
                        grande.tipo === 'schermo'
                          ? (x, y) => sessione.punta(grande.id, x, y)
                          : undefined
                      }
                      quandoMenu={(x, y) => setMenu({ x, y, id: grande.id })}
                      quandoScelto={togli}
                    />
                  </div>

                  {striscia.length > 0 && (
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
                              aFuoco={false}
                              volumi={vociDi(riquadro)}
                              puntatori={puntatoriDi(riquadro)}
                              // Anche qui, e non solo sul grande: su una
                              // condivisione il clic indica sempre, in qualunque
                              // punto della stanza si trovi il riquadro. Una
                              // regola che vale a meta' e' una regola che
                              // bisogna ricordarsi, e nessuno se la ricorda.
                              quandoPunta={
                                riquadro.tipo === 'schermo'
                                  ? (x, y) => sessione.punta(riquadro.id, x, y)
                                  : undefined
                              }
                              quandoMenu={(x, y) => setMenu({ x, y, id: riquadro.id })}
                              quandoScelto={() => metti(riquadro)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {griglia.length > 0 && (
                <div
                  ref={contenitore}
                  className="flex min-h-0 flex-1 items-center justify-center"
                >
                  {/* Il tetto in larghezza e' cio' che tiene le righe come le
                      ha decise `tessere()`: senza, il flex ne infilerebbe una
                      in piu' dove ci sta, e l'ultima riga resterebbe storta. */}
                  <div
                    className="flex flex-wrap content-center justify-center gap-2"
                    style={{ maxWidth: tessera.colonne * (tessera.larghezza + SPAZIO) - SPAZIO }}
                  >
                    {griglia.map((riquadro) => {
                      const { className, ...trascina } = trascinamento(riquadro.id)
                      return (
                        <div
                          key={riquadro.id}
                          {...trascina}
                          className={className}
                          style={{ width: tessera.larghezza, height: tessera.altezza }}
                        >
                          <Riquadro
                            dati={riquadro}
                            foto={fotoDi(riquadro.identita)}
                            mostraStatistiche={impostazioni.mostraStatistiche}
                            aFuoco={false}
                            volumi={vociDi(riquadro)}
                            puntatori={puntatoriDi(riquadro)}
                            quandoPunta={
                              riquadro.tipo === 'schermo'
                                ? (x, y) => sessione.punta(riquadro.id, x, y)
                                : undefined
                            }
                            quandoMenu={(x, y) => setMenu({ x, y, id: riquadro.id })}
                            quandoScelto={() => metti(riquadro)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {scegliSorgente && (
            <SceltaSorgente
              presetIniziale={impostazioni.presetSchermo}
              audioIniziale={impostazioni.audioSistema}
              conferma={(s, p, a, solo, bit) => void condividi(s, p, a, solo, bit)}
              chiudi={() => setScegliSorgente(false)}
            />
          )}
        </main>

        {/* La chat, a destra dei riquadri e non sopra: sovrapposta coprirebbe
            proprio le persone che si stanno guardando mentre si scrive. */}
        {mostraChat && canaleVocale && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-bordo bg-fondo-2">
            <Chat
              api={api}
              canale={canaleVocale}
              chat={chatVocale}
              io={utente}
              profili={profili}
              amministra={moderatore}
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
        riascoltoAttivo={sessione.riascoltoAttivo}
        secondiRiascolto={impostazioni.secondiRiascolto || 30}
        impostazioni={impostazioni}
        schermoIntero={schermoIntero}
        alternaMicrofono={() => void sessione.alternaMicrofono()}
        alternaCamera={() => void sessione.alternaCamera()}
        apriCondivisione={() => setScegliSorgente(true)}
        smettiDiCondividere={(id) => void sessione.smettiDiCondividere(id)}
        cambiaQualita={(id, presetId) => void sessione.cambiaQualitaCondivisione(id, presetId)}
        presetDi={sessione.presetDiCondivisione}
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
        const suo = riquadri.find((r) => r.id === menu.id)
        if (!suo) return null
        return (
          <MenuRiquadro
            x={menu.x}
            y={menu.y}
            dati={suo}
            voci={vociDi(suo)}
            aFuoco={grande?.id === suo.id}
            moderatore={moderatore}
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

/** Lo spazio fra un riquadro e l'altro, in pixel. Uguale al `gap-2` del CSS. */
const SPAZIO = 8

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
