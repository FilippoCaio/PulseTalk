import { useEffect, useRef, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import ControlliAudio from '../ControlliAudio'
import { LinguettaColonne } from '../LinguettaColonne'
import type { AudioCondiviso, AudioRemoto } from '../lib/usaSessione'
import { scegli, usaDispositivi, vociTendina } from '../lib/usaDispositivi'
import {
  Altoparlante,
  AltoparlanteMuto,
  Camera,
  CameraSpenta,
  Esci,
  Fumetto,
  Giu,
  Ingranaggio,
  Microfono,
  MicrofonoSpento,
  Sottotitoli,
  Onde,
  Riavvolgi,
  SchermoCondividi,
  SchermoIntero,
  SchermoNormale,
  SchermoStop,
  Su,
  Utenti,
  UtentiPiu,
  Video
} from '../icone'

const RITARDO_NASCONDI_MS = 3000

/**
 * La barra dei comandi della chiamata, sospesa sopra ai riquadri.
 *
 * Compare muovendo il cursore e sparisce da sola dopo qualche secondo di
 * immobilita'. E' il motivo per cui la colonna delle persone e la barra fissa
 * non ci sono piu': in una videochiamata lo spazio e' l'unica risorsa scarsa,
 * e due strisce di interfaccia sempre accese si mangiano un riquadro intero
 * per mostrare cose che servono tre volte in un'ora.
 *
 * Resta ferma finche' un sottomenu e' aperto: sparire sotto al cursore mentre
 * si sta scegliendo un microfono e' il modo piu' rapido di far odiare una
 * barra che si nasconde.
 */
export default function OverlayChiamata({
  microfonoAcceso,
  cameraAccesa,
  puoTrasmettere,
  schermiAttivi,
  audioCondivisi,
  audioRemoti,
  volumeAudioCondiviso,
  mutoAudioCondiviso,
  volumeAudioRemoto,
  mutoAudioRemoto,
  guardaCondivisione,
  nonGuardareCondivisione,
  riascoltoAttivo,
  secondiRiascolto,
  nomeCanale,
  quantePersone,
  soloAscolto,
  collegando,
  chat,
  insieme,
  trascrizione,
  soloGrande,
  invita,
  impostazioni,
  colonne,
  schermoIntero,
  tornaAiServer,
  alternaMicrofono,
  alternaCamera,
  apriCondivisione,
  modificaCondivisione,
  smettiDiCondividere,
  riascolta,
  salva,
  apriImpostazioni,
  esci
}: {
  microfonoAcceso: boolean
  cameraAccesa: boolean
  puoTrasmettere: boolean
  schermiAttivi: { id: string; etichetta: string }[]
  /** Le proprie condivisioni di solo audio: quanto forte esce da te. */
  audioCondivisi: AudioCondiviso[]
  /** Gli audio condivisi dagli altri: quanto forte arriva a te. */
  audioRemoti: AudioRemoto[]
  volumeAudioCondiviso: (id: string, volume: number) => void
  mutoAudioCondiviso: (id: string) => void
  volumeAudioRemoto: (id: string, volume: number) => void
  mutoAudioRemoto: (id: string) => void
  /**
   * Riapre e chiude una condivisione di solo audio.
   *
   * Sono le stesse due funzioni degli schermi — `guarda` e `nonGuardare` —
   * perche' e' la stessa azione: una condivisione di solo audio e' una
   * condivisione senza immagine, e chiuderla vuol dire staccarne l'unica
   * traccia invece di abbassarne il volume.
   */
  guardaCondivisione: (id: string) => void
  nonGuardareCondivisione: (id: string) => void
  riascoltoAttivo: boolean
  secondiRiascolto: number
  nomeCanale: string
  quantePersone: number
  soloAscolto: boolean
  /** La linea sta rientrando: si dice, e sparisce da solo quando torna. */
  collegando: boolean
  /** Assente quando il canale non ha una chat: allora il pulsante non c'e'. */
  chat?: { aperta: boolean; alterna: () => void }
  /**
   * Il pannello delle cose da fare insieme: un video, una coda musicale.
   *
   * Sta accanto alla chat perche' e' la stessa idea — un pannello a destra dei
   * riquadri — e perche' i due si escludono a vicenda nello spazio: aprirne
   * uno chiude l'altro, ed e' cio' che ci si aspetta da due schede.
   */
  insieme?: { aperta: boolean; alterna: () => void; attiva: boolean }
  /**
   * Auto Writer: il pannello che trasforma le voci in testo.
   *
   * Ha un pulsante suo, accanto alla chat, perche' prima non ne aveva
   * nessuno: il pannello compariva da solo in cima alla stanza quando il
   * server era configurato, e non compariva affatto quando non lo era. Nei
   * due casi la domanda "da dove si attiva?" non aveva risposta — nel primo
   * perche' non c'era niente da attivare, nel secondo perche' non c'era
   * niente.
   *
   * `attiva` accende il pallino: sta trascrivendo adesso, e chi entra a meta'
   * ha diritto di saperlo senza aprire niente.
   */
  trascrizione?: { aperta: boolean; alterna: () => void; attiva: boolean }
  /** Assente quando non c'e' niente in sovraimpressione: niente da nascondere. */
  soloGrande?: { attivo: boolean; alterna: () => void }
  /**
   * Apre l'elenco degli amici da chiamare qui dentro.
   *
   * Assente quando l'invito e' gia' un riquadro intero nella griglia — vedi
   * `RiquadroInvito`, che compare stando da soli — perche' due porte per la
   * stessa stanza a mezzo centimetro di distanza sono una di troppo. Chi
   * decide quale delle due mostrare e' la sala, che e' l'unica a sapere se la
   * griglia c'e'.
   */
  invita?: () => void
  impostazioni: Impostazioni
  /**
   * La sezione di sinistra: com'e' adesso, e come la si apre e si chiude.
   *
   * Non e' roba della chiamata — quelle colonne sono dell'applicazione — ma la
   * linguetta per aprirle e chiuderle sta qui dentro, nell'involucro che va e
   * viene col cursore. Ferma sul bordo di un video sarebbe una cosa in piu' da
   * guardare per tutta la sera, e non c'e' niente da guardare: e' un pulsante.
   */
  colonne: { ritirate: boolean; alterna: () => void }
  /**
   * Il tutto schermo della sala, che e' un'altra cosa dalle colonne qui sopra.
   *
   * Sembrano lo stesso comando — tutti e due fanno sparire la sezione di
   * sinistra — e non lo sono. La linguetta e' una preferenza: chiusa resta
   * chiusa, anche domani, anche fuori dalla chiamata. Questo e' un modo di
   * stare dentro alla stanza per un po', si spegne da solo uscendo, e con un
   * riquadro solo in primo piano toglie di mezzo anche i margini.
   */
  schermoIntero: { attivo: boolean; alterna: () => void }
  /** Esce dalla vista della sala, non dalla chiamata. Solo telefono. */
  tornaAiServer?: () => void
  alternaMicrofono: () => void
  alternaCamera: () => void
  apriCondivisione: () => void
  /** Riapre il pannello della condivisione gia' accesa, per cambiarla senza spegnerla. */
  modificaCondivisione: (id: string, soloAudio: boolean) => void
  smettiDiCondividere: (id: string) => void
  riascolta: () => void
  salva: (modifiche: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
  esci: () => void
}): React.JSX.Element {
  const [visibile, setVisibile] = useState(true)
  const [aperto, setAperto] = useState<'microfono' | 'camera' | 'condivisioni' | 'audio' | null>(
    null
  )
  const scadenza = useRef<number | null>(null)
  const radice = useRef<HTMLDivElement>(null)
  const visibileAdesso = useRef(true)
  const tocco = useRef<{ id: number; x: number; y: number } | null>(null)

  // Si ascolta solo la superficie della chiamata. Muovere il mouse nella chat
  // o nelle colonne laterali non deve far ricomparire comandi che non
  // appartengono a quelle zone.
  useEffect(() => {
    const superficie = radice.current?.parentElement
    if (!superficie) return

    const annulla = (): void => {
      if (scadenza.current !== null) window.clearTimeout(scadenza.current)
      scadenza.current = null
    }
    const impostaVisibile = (valore: boolean): void => {
      visibileAdesso.current = valore
      setVisibile(valore)
    }
    const nascondiDopo = (ritardo = RITARDO_NASCONDI_MS): void => {
      annulla()
      scadenza.current = window.setTimeout(() => impostaVisibile(false), ritardo)
    }
    const mostraPerUnPo = (): void => {
      impostaVisibile(true)
      nascondiDopo()
    }
    const muove = (evento: PointerEvent): void => {
      // Su touch un pointermove arriva anche tenendo il dito fermo con un
      // minimo tremolio. Era questo a far sembrare necessaria la pressione
      // prolungata. Il movimento continua invece a essere il gesto giusto per
      // mouse e trackpad.
      if (evento.pointerType === 'mouse') mostraPerUnPo()
    }
    const entra = (evento: PointerEvent): void => {
      if (evento.pointerType === 'mouse') mostraPerUnPo()
    }
    const iniziaTocco = (evento: PointerEvent): void => {
      if (evento.pointerType === 'mouse' || !evento.isPrimary) {
        if (evento.pointerType === 'mouse') mostraPerUnPo()
        return
      }
      tocco.current = { id: evento.pointerId, x: evento.clientX, y: evento.clientY }
    }
    const finisceTocco = (evento: PointerEvent): void => {
      const iniziato = tocco.current
      tocco.current = null
      if (!iniziato || iniziato.id !== evento.pointerId) return

      // Uno scorrimento della griglia non e' un tap.
      if (Math.hypot(evento.clientX - iniziato.x, evento.clientY - iniziato.y) > 14) return

      // I comandi hanno gia' una propria azione: il loro tap tiene viva la
      // barra, ma non la alterna accidentalmente mentre si preme Muto o Camera.
      if (radice.current?.contains(evento.target as Node)) {
        mostraPerUnPo()
        return
      }

      if (visibileAdesso.current) {
        annulla()
        impostaVisibile(false)
        setAperto(null)
      } else {
        mostraPerUnPo()
      }
    }
    const annullaTocco = (): void => {
      tocco.current = null
    }
    const esce = (evento: PointerEvent): void => {
      if (evento.pointerType !== 'mouse') return
      annulla()
      setAperto(null)
      nascondiDopo(120)
    }

    mostraPerUnPo()
    superficie.addEventListener('pointerenter', entra)
    superficie.addEventListener('pointermove', muove)
    superficie.addEventListener('pointerdown', iniziaTocco)
    superficie.addEventListener('pointerup', finisceTocco)
    superficie.addEventListener('pointercancel', annullaTocco)
    superficie.addEventListener('pointerleave', esce)
    return () => {
      superficie.removeEventListener('pointerenter', entra)
      superficie.removeEventListener('pointermove', muove)
      superficie.removeEventListener('pointerdown', iniziaTocco)
      superficie.removeEventListener('pointerup', finisceTocco)
      superficie.removeEventListener('pointercancel', annullaTocco)
      superficie.removeEventListener('pointerleave', esce)
      annulla()
    }
  }, [])

  // Se si ferma l'ultima condivisione mentre il pannello e' aperto, chiudiamo
  // anche il pannello. Altrimenti restava il riquadro con la sola frase sulla
  // qualita', che sembrava una finestra comparsa dopo lo stop.
  useEffect(() => {
    if (aperto === 'condivisioni' && schermiAttivi.length === 0) setAperto(null)
  }, [aperto, schermiAttivi.length])

  // Quanti audio ci sono in giro, e se almeno uno sta davvero suonando: il
  // primo numero va nel cerchietto, il secondo decide se l'icona si muove.
  const quantiAudio = audioCondivisi.length + audioRemoti.length

  // Stessa storia per gli audio, e qui si vedeva peggio: chiuso l'ultimo, il
  // pulsante che aveva aperto il pannello spariva dalla barra — perche' non
  // c'e' piu' niente da regolare — e restava sospeso in aria un rettangolo
  // vuoto, senza nemmeno il modo di farlo sparire.
  useEffect(() => {
    if (aperto === 'audio' && quantiAudio === 0) setAperto(null)
  }, [aperto, quantiAudio])
  const qualcunoSuona =
    audioCondivisi.some((a) => a.attivo) || audioRemoti.some((a) => !a.muto && a.volume > 0)

  const mostra = visibile || aperto !== null

  return (
    <div
      ref={radice}
      // Si ferma dove comincia il pannello laterale, invece di arrivare al
      // bordo della finestra. Chat e sessioni media hanno larghezze diverse:
      // entrambe vanno sottratte, altrimenti i pulsanti finiscono sopra al
      // pannello e la barra inferiore e' centrata sulla finestra anziche'
      // sulla chiamata.
      //
      // Le due misure sono le stesse scritte sugli `aside` in Sala.tsx, e
      // vanno cambiate insieme: sono la stessa larghezza detta due volte,
      // perche' un overlay non puo' misurare un elemento che gli sta accanto.
      // Allargando la chat e dimenticando questa riga, i comandi finiscono
      // sotto al pannello — ed e' successo.
      className={`pointer-events-none absolute top-0 bottom-0 left-0 z-30 transition-opacity ${
        insieme?.aperta
          ? 'right-0 md:right-[clamp(18rem,34vw,26rem)]'
          : chat?.aperta
            ? 'right-0 md:right-[clamp(18rem,32vw,26rem)]'
            : 'right-0'
      } ${mostra ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Le due ombre, in cima e in fondo.

          Le barre galleggiano sopra ai riquadri, e un riquadro puo' essere
          qualunque cosa: una faccia in controluce, un documento bianco, un
          terminale. Senza niente sotto, il nome del canale e i pulsanti a
          volte si leggono e a volte scompaiono, e non c'e' modo di
          prevederlo. Due sfumature scure danno un fondo a tutte e due le
          strisce senza disegnare un bordo.

          Stanno dentro all'involucro che si accende col cursore, quindi
          vanno e vengono con i pulsanti: fuori resterebbero due bande scure
          appoggiate su un video che nessuno stava piu' guardando. Prime fra i
          fratelli, cosi' le barre ci stanno sopra. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/65 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/65 via-black/25 to-transparent" />

      {/* La barra alta: quello che prima era l'intestazione fissa.
          Sta nello stesso involucro dei comandi in basso, quindi compare e
          sparisce con lo stesso gesto e con la stessa opacita' — due strisce
          che si nascondono con tempi propri sarebbero due cose diverse da
          imparare. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl border border-bordo bg-fondo-2/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur">
          <Altoparlante className="h-4 w-4 shrink-0 text-testo-3" />
          <div className="min-w-0">
            <h1 className="truncate text-sm leading-tight font-medium">{nomeCanale}</h1>
            <p className="flex items-center gap-1.5 text-[11px] leading-tight text-testo-3">
              {quantePersone === 1 ? 'sei solo qui' : `${quantePersone} persone`}
              {soloAscolto && ' · palco'}
              {!puoTrasmettere && ' · puoi solo ascoltare'}
              {/* Detto, e non nascosto: l'anello del riascolto tiene in
                  memoria la voce di altre persone. Non esce da questo computer
                  e muore uscendo dalla stanza, ma chi c'e' dentro ha diritto di
                  vederlo scritto da qualche parte. */}
              {riascoltoAttivo && (
                <span
                  title={`Gli ultimi ${secondiRiascolto} secondi di voce restano in memoria, qui, per poterli riascoltare. Non toccano il disco e spariscono uscendo.`}
                  className="flex items-center gap-1"
                >
                  ·
                  <Riavvolgi className="h-3 w-3" />
                  {secondiRiascolto}s
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {tornaAiServer && (
            <button
              type="button"
              onClick={tornaAiServer}
              title="Torna a server e canali"
              aria-label="Torna a server e canali"
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-bordo bg-fondo-2/95 text-testo-2 shadow-xl shadow-black/40 backdrop-blur transition-colors hover:text-testo md:hidden"
            >
              <Giu className="h-5 w-5 rotate-90" />
            </button>
          )}
          {collegando && (
            <span className="respiro rounded-2xl border border-bordo bg-fondo-2/95 px-3 py-2 text-xs text-attenzione shadow-xl shadow-black/40 backdrop-blur">
              riprendo la linea…
            </span>
          )}
          {insieme && (
            <button
              onClick={insieme.alterna}
              title={insieme.aperta ? 'Chiudi guarda e ascolta insieme' : 'Guarda e ascolta insieme'}
              aria-label={
                insieme.aperta ? 'Chiudi guarda e ascolta insieme' : 'Guarda e ascolta insieme'
              }
              className={`relative flex h-10 w-10 items-center justify-center rounded-2xl border border-bordo bg-fondo-2/95 shadow-xl shadow-black/40 backdrop-blur transition-colors ${
                insieme.aperta ? 'text-vivo' : 'text-testo-3 hover:text-testo'
              }`}
            >
              <Video className="h-5 w-5" />
              {/* Il pallino verde dice che una sessione c'e' gia': senza,
                  chi entra a meta' non saprebbe che gli altri stanno
                  guardando qualcosa. */}
              {insieme.attiva && !insieme.aperta && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-ok" />
              )}
            </button>
          )}
          {trascrizione && (
            <button
              onClick={trascrizione.alterna}
              title={
                trascrizione.aperta
                  ? 'Chiudi Auto Writer'
                  : 'Auto Writer: metti per iscritto quello che si dice'
              }
              aria-label={trascrizione.aperta ? 'Chiudi Auto Writer' : 'Auto Writer'}
              className={`relative flex h-10 w-10 items-center justify-center rounded-2xl border border-bordo bg-fondo-2/95 shadow-xl shadow-black/40 backdrop-blur transition-colors ${
                trascrizione.aperta ? 'text-vivo' : 'text-testo-3 hover:text-testo'
              }`}
            >
              <Sottotitoli className="h-5 w-5" />
              {/* Rosso e non verde: qui il pallino non dice "c'e' una cosa
                  bella in corso", dice "ti stanno registrando". */}
              {trascrizione.attiva && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-male" />
              )}
            </button>
          )}
          {chat && (
            <button
              onClick={chat.alterna}
              title={chat.aperta ? 'Chiudi la chat del canale' : 'Apri la chat del canale'}
              aria-label={chat.aperta ? 'Chiudi la chat del canale' : 'Apri la chat del canale'}
              className={`flex h-10 w-10 items-center justify-center rounded-2xl border border-bordo bg-fondo-2/95 shadow-xl shadow-black/40 backdrop-blur transition-colors ${
                chat.aperta ? 'text-vivo' : 'text-testo-3 hover:text-testo'
              }`}
            >
              <Fumetto className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {aperto !== null && (
        <div className="pointer-events-auto absolute inset-x-2 bottom-20 z-10 flex justify-center sm:bottom-24">
        {aperto === 'microfono' && (
          <MenuMicrofono
            impostazioni={impostazioni}
            salva={salva}
            apriImpostazioni={() => {
              setAperto(null)
              apriImpostazioni()
            }}
          />
        )}
        {aperto === 'camera' && (
          <MenuCamera impostazioni={impostazioni} salva={salva} accesa={cameraAccesa} />
        )}
        {aperto === 'audio' && quantiAudio > 0 && (
          <MenuAudio
            miei={audioCondivisi}
            loro={audioRemoti}
            volumeMio={volumeAudioCondiviso}
            mutoMio={mutoAudioCondiviso}
            smettiMio={smettiDiCondividere}
            volumeLoro={volumeAudioRemoto}
            mutoLoro={mutoAudioRemoto}
            ascoltaLoro={guardaCondivisione}
            smettiLoro={nonGuardareCondivisione}
          />
        )}
        {aperto === 'condivisioni' && schermiAttivi.length > 0 && (
          <MenuCondivisioni
            schermi={schermiAttivi}
            modifica={(id) => {
              setAperto(null)
              modificaCondivisione(id, false)
            }}
            smetti={smettiDiCondividere}
          />
        )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex justify-center overflow-x-auto p-2 sm:p-4">
        <div className="pointer-events-auto relative flex items-end gap-1.5 sm:gap-2">

        {/* Chiamare qualcun altro qui dentro. Fuori dalla scatola, a
            sinistra: non e' un comando del proprio microfono o della propria
            camera come quelli li' dentro — non cambia niente di cio' che sta
            uscendo da questo computer — ed e' la stessa ragione per cui
            "esci" e' uscito dall'altra parte.

            Manca quando l'invito e' gia' un riquadro nella griglia: la stessa
            porta due volte non aiuta nessuno a trovarla. */}
        {invita && (
          <button
            onClick={invita}
            title="Invita degli amici in chiamata"
            aria-label="Invita degli amici in chiamata"
            className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl border border-bordo bg-fondo-2/95 text-testo-2 shadow-xl shadow-black/40 backdrop-blur transition-colors hover:bg-fondo-3/95 hover:text-testo"
          >
            <UtentiPiu className="h-5 w-5" />
          </button>
        )}

        <div className="flex items-center gap-1.5 rounded-2xl border border-bordo bg-fondo-2/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur">
          <ConFreccia
            aperto={aperto === 'microfono'}
            apri={() => setAperto(aperto === 'microfono' ? null : 'microfono')}
          >
            <Tasto
              tono={microfonoAcceso ? 'normale' : 'male'}
              titolo={microfonoAcceso ? 'Zittisci il microfono' : 'Riaccendi il microfono'}
              premi={alternaMicrofono}
            >
              {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
            </Tasto>
          </ConFreccia>

          {puoTrasmettere && (
            <ConFreccia
              aperto={aperto === 'camera'}
              apri={() => setAperto(aperto === 'camera' ? null : 'camera')}
            >
              <Tasto
                acceso={cameraAccesa}
                titolo={cameraAccesa ? 'Spegni la camera' : 'Accendi la camera'}
                premi={alternaCamera}
              >
                {cameraAccesa ? <Camera /> : <CameraSpenta />}
              </Tasto>
            </ConFreccia>
          )}

          {/* L'elenco di cio' che sta uscendo da qui sta sotto alla freccia,
              come il microfono e la camera hanno la loro.

              Prima era un secondo pulsante accanto a questo, con l'icona delle
              pile, e compariva dal nulla appena partiva una condivisione: due
              icone vicine che parlano della stessa cosa, e nessuna delle due
              che dice di essere l'elenco dell'altra. La freccia invece si sa
              gia' leggere — e' la stessa di li' accanto — e dice a chi
              appartiene quello che apre.

              La freccia c'e' solo condividendo: senza condivisioni quell'elenco
              non elenca niente. */}
          {puoTrasmettere && (
            <ConFreccia
              aperto={aperto === 'condivisioni'}
              etichetta={`${schermiAttivi.length} in corso: apri l'elenco`}
              apri={
                schermiAttivi.length > 0
                  ? () => setAperto(aperto === 'condivisioni' ? null : 'condivisioni')
                  : undefined
              }
            >
              <Tasto
                acceso={schermiAttivi.length > 0}
                titolo="Condividi uno schermo o una finestra"
                premi={apriCondivisione}
              >
                <SchermoCondividi />
              </Tasto>
            </ConFreccia>
          )}

          {/* Gli audio condivisi hanno una porta tutta loro, e non stanno
              nell'elenco delle condivisioni: uno schermo si guarda, un audio si
              ascolta, e mescolarli vuol dire cercare il volume della musica in
              mezzo alle finestre aperte. Compare solo quando ce n'e' almeno
              uno, tuo o di qualcun altro. */}
          {quantiAudio > 0 && (
            <span className="relative">
              <Tasto
                acceso={aperto === 'audio'}
                titolo={`${quantiAudio} audio condivisi: volumi e muto`}
                premi={() => setAperto(aperto === 'audio' ? null : 'audio')}
              >
                <Onde attivo={qualcunoSuona} className="h-[18px] w-[18px]" />
              </Tasto>
              {/* Il numero nel cerchio verde, come il pallino di stato
                  sull'icona dell'utente: dice quante ce ne sono senza dover
                  aprire niente. */}
              <span className="numeri pointer-events-none absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ok px-1 text-[10px] font-semibold text-fondo ring-2 ring-fondo-2">
                {quantiAudio}
              </span>
            </span>
          )}

          {/* Compare solo con qualcosa in sovraimpressione, ed e' l'unico caso
              in cui un pulsante che va e viene ha senso: toglie di mezzo la
              striscia delle persone per lasciare la sovraimpressione da sola
              in tutta la finestra. Senza niente in primo piano non avrebbe
              nessuna striscia da nascondere, e sarebbe un pulsante che non fa
              niente. */}
          {soloGrande && (
            <Tasto
              acceso={soloGrande.attivo}
              titolo={
                soloGrande.attivo
                  ? 'Rimetti le persone accanto'
                  : 'Solo la sovraimpressione: nascondi le persone'
              }
              premi={soloGrande.alterna}
            >
              <Utenti />
            </Tasto>
          )}

          {/* Sempre presente, anche spento.
              
              Prima compariva solo con il riascolto attivo, e un pulsante che a
              volte c'e' e a volte no e' un pulsante che non si impara mai: chi
              l'ha disattivato senza accorgersene non ha modo di capire dove sia
              finito. Spento dice dov'e' e come riaccenderlo. */}
          <Tasto
            titolo={
              riascoltoAttivo
                ? `Riascolta gli ultimi ${secondiRiascolto} secondi`
                : 'Riascolto spento: si riaccende nelle impostazioni, sezione Audio'
            }
            premi={riascoltoAttivo ? riascolta : apriImpostazioni}
            spento={!riascoltoAttivo}
          >
            <Riavvolgi />
          </Tasto>
        </div>

        {/* Uscire, fuori dalla scatola e a destra di tutto.

            Dentro era un tondo rosso in fila con gli altri, e in fila con gli
            altri vuol dire a un pixel di distanza da "spegni la camera": e'
            l'unico pulsante della barra da cui non si torna indietro, ed era
            quello con il vicino piu' pericoloso. Staccato ha una mira tutta
            sua, e il rosso pieno lo si riconosce senza leggere niente. */}
        <button
          onClick={esci}
          title="Esci dalla chiamata"
          aria-label="Esci dalla chiamata"
          className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-2xl bg-male text-white shadow-xl shadow-black/40 transition-colors hover:bg-male/80 [&>svg]:h-5 [&>svg]:w-5"
        >
          <Esci />
        </button>

        </div>
      </div>

      {/* In fondo alla riga, cioe' nell'angolo: non e' un comando della
          chiamata ma della finestra, e tenerlo attaccato agli altri lo
          farebbe premere per sbaglio al posto di "esci". */}
      {/* Nuda, senza la scatola degli altri: non fa parte del gruppo dei
          comandi della chiamata, e incorniciarla la faceva sembrare un
          secondo gruppo da un pulsante solo. */}
      <button
        onClick={schermoIntero.alterna}
        title={schermoIntero.attivo ? 'Torna alle colonne' : 'A tutto schermo'}
        aria-label={schermoIntero.attivo ? 'Torna alle colonne' : 'A tutto schermo'}
        className="pointer-events-auto absolute right-5 bottom-6 hidden text-testo-3 transition-colors hover:text-testo md:block [&>svg]:h-5 [&>svg]:w-5"
      >
        {schermoIntero.attivo ? <SchermoNormale /> : <SchermoIntero />}
      </button>

      {/* La linguetta delle colonne, appoggiata al bordo sinistro.

          Sta dentro a questo involucro, e non nell'applicazione, perche' e'
          l'unico modo di farla sparire con tutto il resto quando il cursore
          esce dalla chiamata.

          `left-0` e non una misura: il bordo sinistro di qui e' gia' quello
          delle colonne, larghe, strette o ritirate che siano — un conto in
          meno da rifare a mano il giorno in cui una colonna cambia
          larghezza. */}
      <LinguettaColonne
        ritirate={colonne.ritirate}
        alterna={colonne.alterna}
        className="pointer-events-auto absolute top-1/2 left-0 -translate-y-1/2 transition"
      />
    </div>
  )
}

// -- I pezzi ------------------------------------------------------------------

/**
 * Un pulsante della barra in basso: quadrato, con gli angoli smussati.
 *
 * I dieci pixel di raggio non sono scelti a occhio. La scatola che li contiene
 * ha `rounded-2xl` — sedici pixel — e sei di spaziatura interna: sedici meno
 * sei fa dieci, ed e' il raggio che corre parallelo a quello esterno invece di
 * stringersi o allargarsi rispetto a lui. E' una differenza che si vede anche
 * senza saper dire cosa non va.
 */
function Tasto({
  children,
  titolo,
  premi,
  acceso = false,
  spento = false,
  tono = 'normale'
}: {
  children: React.ReactNode
  titolo: string
  premi: () => void
  acceso?: boolean
  /** Presente ma disattivato: si vede che esiste, e il titolo dice perche'. */
  spento?: boolean
  tono?: 'normale' | 'male'
}): React.JSX.Element {
  const colore = spento
    ? 'bg-fondo-3/50 text-testo-3 hover:text-testo-2'
    : tono === 'male'
      ? 'bg-male/90 text-white hover:bg-male'
      : acceso
        ? 'bg-vivo/20 text-vivo hover:bg-vivo/30'
        : 'bg-fondo-3 text-testo-2 hover:bg-fondo-3/70 hover:text-testo'

  return (
    <button
      onClick={premi}
      title={titolo}
      aria-label={titolo}
      className={`flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${colore} [&>svg]:h-[18px] [&>svg]:w-[18px]`}
    >
      {children}
    </button>
  )
}

/**
 * Un pulsante con la sua freccetta attaccata sotto.
 *
 * Senza `apri` la freccetta non c'e' e resta il solo pulsante: serve a chi
 * l'aggancio ce l'ha soltanto ogni tanto — l'elenco delle condivisioni esiste
 * finche' si condivide qualcosa — e cosi' il pulsante sotto non si sposta di
 * mezzo pixel quando la freccia compare.
 */
function ConFreccia({
  children,
  aperto,
  apri,
  etichetta = 'Altre impostazioni'
}: {
  children: React.ReactNode
  aperto: boolean
  apri?: () => void
  /** Cosa apre: lo leggono il passaggio del mouse e chi non vede la freccia. */
  etichetta?: string
}): React.JSX.Element {
  return (
    <div className="relative">
      {children}
      {apri && (
        <button
          onClick={apri}
          title={etichetta}
          aria-label={etichetta}
          className={`absolute -bottom-0.5 left-1/2 flex h-4 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-bordo bg-fondo-2 transition-colors ${
            aperto ? 'text-vivo' : 'text-testo-3 hover:text-testo'
          }`}
        >
          <Su className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function Pannello({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="max-h-[min(60dvh,30rem)] w-[min(18rem,calc(100vw-1rem))] space-y-3 overflow-y-auto rounded-xl border border-bordo bg-fondo-2 p-3 shadow-xl shadow-black/40">
      {children}
    </div>
  )
}

function Etichetta({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="mb-1 block text-[11px] tracking-wide text-testo-3 uppercase">{children}</span>
  )
}

const CLASSI_SELECT =
  'w-full rounded-lg border border-bordo bg-fondo px-2 py-1.5 text-xs text-testo focus:border-vivo focus:outline-none'

function MenuMicrofono({
  impostazioni,
  salva,
  apriImpostazioni
}: {
  impostazioni: Impostazioni
  salva: (m: Partial<Impostazioni>) => void
  apriImpostazioni: () => void
}): React.JSX.Element {
  return (
    <Pannello>
      <ControlliAudio
        impostazioni={impostazioni}
        salva={salva}
        apriImpostazioni={apriImpostazioni}
      />
    </Pannello>
  )
}

function MenuCamera({
  impostazioni,
  salva,
  accesa
}: {
  impostazioni: Impostazioni
  salva: (m: Partial<Impostazioni>) => void
  accesa: boolean
}): React.JSX.Element {
  const { tutti } = usaDispositivi()
  const video = useRef<HTMLVideoElement>(null)
  const [errore, setErrore] = useState<string | null>(null)

  // L'anteprima apre una cattura sua, anche a camera spenta: serve proprio a
  // vedere come si viene inquadrati PRIMA di accendere. Si chiude uscendo dal
  // menu, altrimenti resterebbe la spia accesa senza che nessuno la veda.
  useEffect(() => {
    let stream: MediaStream | null = null
    let vivo = true

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: impostazioni.cameraId ? { deviceId: { exact: impostazioni.cameraId } } : true
        })
        if (!vivo) {
          for (const t of stream.getTracks()) t.stop()
          return
        }
        if (video.current) video.current.srcObject = stream
      } catch (e) {
        if (vivo) setErrore((e as Error).message)
      }
    })()

    return () => {
      vivo = false
      if (stream) for (const t of stream.getTracks()) t.stop()
    }
  }, [impostazioni.cameraId])

  return (
    <Pannello>
      <div>
        <Etichetta>Camera</Etichetta>
        <select
          className={CLASSI_SELECT}
          value={impostazioni.cameraId ?? ''}
          onChange={(e) => salva(scegli('camera', tutti, e.target.value))}
        >
          <option value="">Predefinita</option>
          {vociTendina('camera', tutti, impostazioni).map((voce) => (
            <option key={voce.id} value={voce.id} disabled={voce.assente}>
              {voce.nome}
            </option>
          ))}
        </select>
      </div>

      <div className="aspect-video overflow-hidden rounded-lg bg-fondo">
        {errore ? (
          <p className="p-3 text-[11px] text-attenzione">Non riesco ad aprirla: {errore}</p>
        ) : (
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            // Specchiata come tutte le anteprime: ci si aggiusta guardandosi, e
            // guardarsi al contrario non funziona.
            className="h-full w-full -scale-x-100 object-cover"
          />
        )}
      </div>

      <p className="text-[11px] text-testo-3">
        {accesa ? 'Stanno vedendo questa.' : 'Anteprima: non la sta vedendo nessuno.'}
      </p>
    </Pannello>
  )
}

/**
 * L'elenco delle proprie condivisioni: cosa sta uscendo, e i due comandi.
 *
 * Una riga, tre cose: il nome, l'ingranaggio che riapre il pannello della
 * condivisione, e la croce che la chiude. La tendina della qualita' stava
 * qui e se n'e' andata: era l'unica impostazione delle sei arrivata fin
 * quassu', e averne una a portata di mano e cinque nascoltate altrove faceva
 * sembrare che le altre non si potessero cambiare. Adesso si aprono tutte
 * dallo stesso posto, che e' il pannello da cui la condivisione era nata.
 */
function MenuCondivisioni({
  schermi,
  modifica,
  smetti
}: {
  schermi: { id: string; etichetta: string }[]
  modifica: (id: string) => void
  smetti: (id: string) => void
}): React.JSX.Element {
  return (
    <Pannello>
      <Etichetta>Stai condividendo</Etichetta>
      <div className="space-y-1.5">
        {schermi.map((schermo) => (
          <div key={schermo.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-testo">{schermo.etichetta}</span>
            <button
              onClick={() => modifica(schermo.id)}
              title={`Impostazioni di ${schermo.etichetta} — qualita', audio, sorgente`}
              aria-label={`Impostazioni di ${schermo.etichetta}`}
              className="shrink-0 text-testo-3 hover:text-testo"
            >
              <Ingranaggio className="h-4 w-4" />
            </button>
            <button
              onClick={() => smetti(schermo.id)}
              title={`Smetti di condividere ${schermo.etichetta}`}
              aria-label={`Smetti di condividere ${schermo.etichetta}`}
              className="shrink-0 text-male hover:opacity-80"
            >
              <SchermoStop className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Pannello>
  )
}

/**
 * I volumi degli audio condivisi, i propri e quelli degli altri.
 *
 * Due elenchi separati perche' sono due cose diverse: sopra c'e' quanto forte
 * esce da te — muoverlo cambia cio' che sentono gli altri — e sotto quanto
 * forte arriva a te, che non tocca nessun altro. Metterli insieme senza dirlo
 * significherebbe far abbassare la musica a tutta la stanza a chi voleva solo
 * sentirla meno lui.
 */
function MenuAudio({
  miei,
  loro,
  volumeMio,
  mutoMio,
  smettiMio,
  volumeLoro,
  mutoLoro,
  ascoltaLoro,
  smettiLoro
}: {
  miei: AudioCondiviso[]
  loro: AudioRemoto[]
  volumeMio: (id: string, volume: number) => void
  mutoMio: (id: string) => void
  smettiMio: (id: string) => void
  volumeLoro: (id: string, volume: number) => void
  mutoLoro: (id: string) => void
  /** Torna a ricevere una condivisione di solo audio staccata. */
  ascoltaLoro: (id: string) => void
  /** Stacca davvero la traccia: non e' il muto, e' smettere di scaricarla. */
  smettiLoro: (id: string) => void
}): React.JSX.Element {
  return (
    <Pannello>
      {miei.length > 0 && (
        <div>
          <Etichetta>Stai condividendo</Etichetta>
          <div className="space-y-2">
            {miei.map((a) => (
              <RigaAudio
                key={a.id}
                nome={a.etichetta}
                sotto="quanto forte esce da te"
                volume={a.volume}
                muto={a.muto}
                cambia={(v) => volumeMio(a.id, v)}
                alterna={() => mutoMio(a.id)}
                // Le proprie si chiudono da qui, e non c'era modo di farlo:
                // una condivisione di solo audio non ha un riquadro, quindi
                // non ha nemmeno il menu del tasto destro con cui si spengono
                // le altre. L'unica uscita era uscire dalla chiamata.
                chiudi={() => smettiMio(a.id)}
              />
            ))}
          </div>
        </div>
      )}

      {loro.length > 0 && (
        <div>
          <Etichetta>Stai ascoltando</Etichetta>
          <div className="space-y-2">
            {loro.map((a) => (
              <RigaAudio
                key={a.id}
                nome={a.etichetta}
                sotto={
                  a.ascoltato
                    ? `da ${a.nome} — solo per te`
                    : `da ${a.nome} — staccata, non la stai ricevendo`
                }
                volume={a.volume}
                muto={a.muto}
                staccato={!a.ascoltato}
                cambia={(v) => volumeLoro(a.id, v)}
                alterna={() => mutoLoro(a.id)}
                /* Una condivisione di solo audio non ha un riquadro: qui c'e'
                   l'unica "smetti di ascoltare" che possa avere, ed e' la
                   stessa azione dello "smetti di guardare e ascoltare" degli
                   schermi — stacca la traccia invece di abbassarla. */
                chiudi={a.ascoltato ? () => smettiLoro(a.id) : undefined}
                riapri={a.ascoltato ? undefined : () => ascoltaLoro(a.id)}
              />
            ))}
          </div>
        </div>
      )}
    </Pannello>
  )
}

function RigaAudio({
  nome,
  sotto,
  volume,
  muto,
  staccato = false,
  cambia,
  alterna,
  chiudi,
  riapri
}: {
  nome: string
  sotto: string
  volume: number
  muto: boolean
  /** Non sta arrivando: il cursore non ha niente da regolare. */
  staccato?: boolean
  cambia: (volume: number) => void
  alterna: () => void
  /** Sulle proprie smette di condividere, sulle altrui smette di riceverle. */
  chiudi?: () => void
  /** Torna a riceverla. Solo su una staccata. */
  riapri?: () => void
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={alterna}
          disabled={staccato}
          title={muto ? `Riattiva ${nome}` : `Zittisci ${nome}`}
          aria-label={muto ? `Riattiva ${nome}` : `Zittisci ${nome}`}
          className={`shrink-0 disabled:opacity-40 ${
            muto || staccato ? 'text-male' : 'text-testo-3 hover:text-testo'
          }`}
        >
          {muto || staccato ? (
            <AltoparlanteMuto className="h-4 w-4" />
          ) : (
            <Altoparlante className="h-4 w-4" />
          )}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-testo">{nome}</span>
          <span className="block truncate text-[10px] text-testo-3">{sotto}</span>
        </span>
        <span className="numeri shrink-0 text-[10px] text-testo-3">
          {Math.round(volume * 100)}%
        </span>
        {chiudi && (
          <button
            onClick={chiudi}
            title={`Smetti ${nome}`}
            aria-label={`Smetti ${nome}`}
            className="shrink-0 text-male hover:opacity-80"
          >
            <SchermoStop className="h-4 w-4" />
          </button>
        )}
        {riapri && (
          <button
            onClick={riapri}
            title={`Torna ad ascoltare ${nome}`}
            aria-label={`Torna ad ascoltare ${nome}`}
            className="shrink-0 text-ok hover:opacity-80"
          >
            <SchermoCondividi className="h-4 w-4" />
          </button>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        disabled={staccato}
        onChange={(e) => cambia(Number(e.target.value))}
        aria-label={`Volume di ${nome}`}
        className="mt-1 w-full disabled:opacity-40"
      />
    </div>
  )
}
