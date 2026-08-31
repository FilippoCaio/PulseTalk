import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GenereRestrizione, Restrizione } from '@shared/tipi'
import { PannelloVolume, type VoceVolume } from './Volume'
import { fraseRestrizione, type VoceModerazione } from '../lib/usaRestrizioni'
import {
  Altoparlante,
  AltoparlanteMuto,
  Camera,
  CameraSpenta,
  Cuffie,
  CuffieSpente,
  Espelli,
  Ingrandisci,
  Lente,
  MicrofonoSpento,
  Rimpicciolisci,
  SchermoCondividi,
  SchermoIntero,
  SchermoNormale,
  SchermoStop
} from '../icone'

/** Come si chiama, nel menu, cio' che si sta per fare o disfare. */
const PAROLE: Record<GenereRestrizione, { imponi: string; togli: string }> = {
  // Solo spegnere. Accendere la telecamera di qualcun altro non e' possibile
  // per nessuno, con nessun permesso, mai: non e' una voce che manca, e' una
  // voce che non deve esistere.
  camera: { imponi: 'Forza la telecamera spenta', togli: 'Ridai la telecamera' },
  condivisione: { imponi: 'Togli la condivisione', togli: 'Ridai la condivisione' },
  microfono: { imponi: 'Muto forzato del microfono', togli: 'Riattiva il microfono' },
  cuffie: { imponi: 'Muto forzato delle cuffie', togli: "Ridai l'ascolto" }
}

function iconaDi(genere: GenereRestrizione, attiva: boolean): React.ReactNode {
  if (genere === 'camera') return attiva ? <Camera /> : <CameraSpenta />
  if (genere === 'condivisione') return attiva ? <SchermoCondividi /> : <SchermoStop />
  if (genere === 'microfono') return attiva ? <Altoparlante /> : <MicrofonoSpento />
  return attiva ? <Cuffie /> : <CuffieSpente />
}

/** Quanto stare lontani dal bordo della finestra. */
const MARGINE = 8

/**
 * Il menu del tasto destro su un riquadro.
 *
 * Le stesse cose che stanno gia' sparse fra il fumetto dell'altoparlante, le
 * iconcine in alto a destra e la colonna delle persone — ma tutte insieme,
 * dove le sta cercando la mano, sul riquadro che si sta guardando. E' l'unico
 * gesto che nessuno deve imparare: dove c'e' roba, tasto destro.
 *
 * Non sa piu' cos'e' un riquadro: prende un titolo, delle voci di volume e
 * delle cose da fare. Serviva a farlo aprire anche sul video condiviso, che
 * riquadro non e' — ma per la mano che ci arriva sopra e' la stessa cosa, e
 * due menu diversi per lo stesso gesto sarebbero due menu da imparare.
 *
 * Qui dentro sta il cursore del volume, e non sta piu' da nessun'altra parte:
 * sui riquadri — condivisioni e persone — e' rimasto l'interruttore, che e'
 * cio' che si preme di fretta. Il livello preciso e' una cosa che si regola
 * una volta e si dimentica, e le cose che si regolano una volta stanno tutte
 * qui: insieme alla qualita' della propria condivisione, a cosa si sta
 * mostrando, e a chi si vuole cacciare fuori.
 */
export default function MenuRiquadro({
  x,
  y,
  titolo,
  sottotitolo,
  cosa,
  intestazione,
  voci,
  aFuoco = false,
  metti,
  schermoIntero,
  azioni,
  caccia,
  moderazione,
  chiudiCondivisione,
  restrizioniAddosso,
  qualita,
  chiudi
}: {
  x: number
  y: number
  /** Di chi, o di cosa: la prima riga del menu. */
  titolo: string
  /** Quale delle sue, quando ce n'e' piu' d'una. */
  sottotitolo?: string
  /** Come chiamare cio' che si zittisce: "lo schermo", "la voce", "il video". */
  cosa: string
  /**
   * Un blocco libero in cima, sotto al titolo.
   *
   * Serve al pannellino sulla persona nella colonna dei canali, che sopra ai
   * comandi mostra faccia, nome e stato. Un nodo e non tre proprieta' perche'
   * cio' che ci va dentro non e' affare di questo menu.
   */
  intestazione?: React.ReactNode
  voci: VoceVolume[]
  aFuoco?: boolean
  /**
   * Mette a fuoco, o toglie dal fuoco se ci sta gia'.
   *
   * Facoltativo perche' questo stesso menu si apre anche fuori dalla griglia —
   * sull'elenco delle persone nella colonna dei canali — dove un "primo piano"
   * non vuol dire niente. E' lo stesso menu di proposito: sono le stesse cose
   * fatte alla stessa persona, e due menu diversi per la stessa domanda
   * sarebbero due menu da imparare.
   */
  metti?: () => void
  /** Solo sul riquadro grande: il vero schermo intero. */
  schermoIntero?: { attivo: boolean; alterna: () => void }
  /** Le voci che valgono solo per questo tipo di riquadro, in fondo. */
  azioni?: { icona: React.ReactNode; testo: string; fai: () => void; pericolo?: boolean }[]
  /** Gia' filtrato da chi apre il menu: se c'e', si puo' fare. */
  caccia?: () => Promise<void>
  /**
   * I provvedimenti che si possono prendere su chi sta in questo riquadro.
   *
   * Gia' filtrati da chi apre il menu: qui dentro ci sono soltanto quelli che
   * chi guarda ha il diritto di usare. Nascondere una voce non e' pero' cio'
   * che li fa rispettare — quello lo fa il server su ogni richiesta — ed e' il
   * motivo per cui non c'e' nessuna voce disabilitata: un pulsante spento
   * racconta a chi non puo' esattamente cosa potrebbe fare qualcun altro.
   */
  moderazione?: VoceModerazione[]
  /**
   * Ferma questa condivisione per tutti, adesso.
   *
   * Da tenere ben distinta dallo "smetti di guardare e ascoltare" qui sopra,
   * che riguarda solo chi preme: questa la chiude a tutta la stanza. Per
   * questo sta in fondo, in rosso, con le altre cose che si fanno agli altri.
   */
  chiudiCondivisione?: () => void
  /** Cio' che questa persona ha gia' addosso, per dirlo invece di lasciarlo indovinare. */
  restrizioniAddosso?: Restrizione[]
  /**
   * Solo sulla PROPRIA condivisione: cambiare qualita' mentre e' accesa.
   *
   * Il cambio non interrompe niente — bitrate e fotogrammi si riscrivono sul
   * mittente vivo — quindi si puo' alzare la qualita' a meta' partita senza
   * sparire per un secondo dagli schermi degli altri.
   */
  qualita?: {
    scelte: { id: string; nome: string; spiegazione: string }[]
    attuale: string | null
    cambia: (id: string) => void
  }
  chiudi: () => void
}): React.JSX.Element {
  const scatola = useRef<HTMLDivElement>(null)
  const [posto, setPosto] = useState({ sinistra: x, alto: y, pronto: false })

  // Prima si misura, poi si mostra: aperto vicino al bordo destro il menu
  // uscirebbe dalla finestra, e in una finestra senza barra di scorrimento
  // quello che esce non torna piu'.
  //
  // Due limiti per asse, e il secondo mancava. `Math.min` da solo tira il menu
  // su finche' il suo fondo rientra, e con un menu piu' alto dello spazio
  // disponibile quel conto da' un numero negativo: il fondo rientrava e la
  // cima usciva dall'altra parte. Succedeva a chi modera, che ha qualche voce
  // in piu' - cioe' proprio a chi il menu lo apre per farci qualcosa.
  //
  // Il `max` da solo pero' non basta, perche' un menu piu' alto della finestra
  // non ci sta e basta: da li' l'altezza massima e lo scorrimento qui sotto.
  useLayoutEffect(() => {
    const e = scatola.current
    if (!e) return
    const { width, height } = e.getBoundingClientRect()
    setPosto({
      sinistra: Math.max(MARGINE, Math.min(x, window.innerWidth - width - MARGINE)),
      alto: Math.max(MARGINE, Math.min(y, window.innerHeight - height - MARGINE)),
      pronto: true
    })
  }, [x, y])

  /**
   * Il fuoco ci entra, e quando si chiude torna da dove era venuto.
   *
   * Col tasto destro non si nota: la mano e' gia' sul mouse. Si nota aprendo
   * questo stesso pannello da tastiera sull'elenco delle persone, dove senza
   * queste righe il fuoco restava sulla riga dietro — e il Tab successivo
   * portava sulla persona dopo invece che dentro al pannello appena aperto.
   */
  useEffect(() => {
    const tornaA = document.activeElement as HTMLElement | null
    const dentro = scatola.current?.querySelector<HTMLElement>('[role="menuitem"]')
    ;(dentro ?? scatola.current)?.focus({ preventScroll: true })
    return () => tornaA?.focus?.({ preventScroll: true })
  }, [])

  // Si chiude con Escape, col clic fuori, e anche col tasto destro fuori:
  // aprirne due insieme e' un modo sicuro di lasciarne uno orfano a mezz'aria.
  useEffect(() => {
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') chiudi()
    }
    const fuori = (e: MouseEvent): void => {
      if (!scatola.current?.contains(e.target as Node)) chiudi()
    }
    window.addEventListener('keydown', tasto)
    window.addEventListener('blur', chiudi)

    // I due che ascoltano il mouse partono al giro dopo, e senza questo il
    // menu non si vedeva mai.
    //
    // Il tasto destro sul riquadro fa una cosa sola, ma l'evento passa da due
    // punti: React lo raccoglie sulla radice dell'applicazione e apre il menu,
    // e *poi* lo stesso evento continua a salire fino a `window`. In mezzo ai
    // due momenti React ha gia' montato questo componente e mandato in
    // esecuzione questo effetto - per gli eventi discreti non aspetta il
    // fotogramma dopo - quindi l'ascoltatore qui sotto esisteva in tempo per
    // sentire il clic che lo aveva creato. Il bersaglio era il riquadro, cioe'
    // fuori dal menu, quindi `fuori` chiudeva: aperto e richiuso nello stesso
    // istante, e da fuori sembrava che il tasto destro non facesse niente.
    //
    // Anche `mousedown`, non solo `contextmenu`: un clic destro li manda tutti
    // e due, e bastava quello a rifare lo stesso guaio.
    const dopo = window.setTimeout(() => {
      window.addEventListener('mousedown', fuori)
      window.addEventListener('contextmenu', fuori)
    }, 0)

    return () => {
      window.clearTimeout(dopo)
      window.removeEventListener('keydown', tasto)
      window.removeEventListener('mousedown', fuori)
      window.removeEventListener('contextmenu', fuori)
      window.removeEventListener('blur', chiudi)
    }
  }, [chiudi])

  const zittito = voci.length > 0 && voci.every((v) => v.muto)

  return (
    <div
      ref={scatola}
      role="menu"
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      className={`menu-comparsa fixed z-50 w-56 overflow-y-auto overscroll-contain rounded-xl border border-bordo bg-fondo-2 p-2 shadow-xl shadow-black/40 ${
        posto.pronto ? 'opacity-100' : 'opacity-0'
      }`}
      // L'altezza massima e' la finestra meno i due margini: piu' alto di
      // cosi' non ci sta, e invece di uscire si scorre. Con le voci di chi
      // modera il menu supera i seicento pixel, che su un portatile in
      // orizzontale e' gia' oltre.
      style={{
        left: posto.sinistra,
        top: posto.alto,
        maxHeight: `calc(100dvh - ${MARGINE * 2}px)`
      }}
    >
      {intestazione ?? (
        <div className="truncate px-1.5 pt-0.5 pb-2 text-xs font-semibold text-testo-2">
          {titolo}
          {sottotitolo && <span className="font-normal text-testo-3"> · {sottotitolo}</span>}
        </div>
      )}

      {voci.length > 0 && (
        <>
          <div className="px-1.5 pb-2">
            <PannelloVolume voci={voci} />
          </div>
          <Riga
            icona={zittito ? <AltoparlanteMuto /> : <Altoparlante />}
            testo={zittito ? `Riattiva ${cosa}` : `Zittisci ${cosa}`}
            fai={() => {
              // Con due cursori (voce e schermo) si zittisce tutto insieme:
              // singolarmente si fa gia' dai pulsanti qui sopra.
              for (const v of voci) if (v.muto === zittito) v.alternaMuto()
              chiudi()
            }}
          />
          <div className="my-1 border-t border-bordo" />
        </>
      )}

      {metti && (
        <Riga
          icona={aFuoco ? <Rimpicciolisci /> : <Ingrandisci />}
          testo={aFuoco ? 'Togli dal primo piano' : 'Metti in primo piano'}
          fai={() => {
            metti()
            chiudi()
          }}
        />
      )}

      {schermoIntero && (
        <Riga
          icona={schermoIntero.attivo ? <SchermoNormale /> : <SchermoIntero />}
          testo={schermoIntero.attivo ? 'Esci da schermo intero' : 'A tutto schermo'}
          fai={() => {
            schermoIntero.alterna()
            chiudi()
          }}
        />
      )}

      {qualita && qualita.scelte.length > 0 && (
        <>
          <div className="my-1 border-t border-bordo" />
          <div className="px-1.5 pt-0.5 pb-1 text-[11px] uppercase tracking-wide text-testo-3">
            Qualita' della condivisione
          </div>
          {qualita.scelte.map((scelta) => (
            <Riga
              key={scelta.id}
              icona={<Lente />}
              testo={scelta.nome + (scelta.id === qualita.attuale ? ' ·' : '')}
              fai={() => {
                qualita.cambia(scelta.id)
                chiudi()
              }}
            />
          ))}
        </>
      )}

      {azioni && azioni.length > 0 && (
        <>
          <div className="my-1 border-t border-bordo" />
          {azioni.map((azione) => (
            <Riga
              key={azione.testo}
              icona={azione.icona}
              testo={azione.testo}
              pericolo={azione.pericolo}
              fai={() => {
                azione.fai()
                chiudi()
              }}
            />
          ))}
        </>
      )}

      {/* Cosa gli e' gia' stato tolto, scritto e non da indovinare.
          Vale per chi modera — che deve sapere se sta per rimettere o togliere
          — e vale soprattutto per chi guarda il proprio riquadro e non capisce
          perche' il microfono non risponde. */}
      {restrizioniAddosso && restrizioniAddosso.length > 0 && (
        <>
          <div className="my-1 border-t border-bordo" />
          <div className="space-y-0.5 px-1.5 py-1">
            {restrizioniAddosso.map((r) => (
              <p key={r.genere} className="text-[11px] leading-snug text-attenzione">
                {fraseRestrizione(r)}
              </p>
            ))}
          </div>
        </>
      )}

      {chiudiCondivisione && (
        <>
          <div className="my-1 border-t border-bordo" />
          <Riga
            icona={<SchermoStop />}
            testo="Chiudi questa condivisione per tutti"
            pericolo
            fai={() => {
              chiudiCondivisione()
              chiudi()
            }}
          />
        </>
      )}

      {moderazione && moderazione.length > 0 && (
        <>
          <div className="my-1 border-t border-bordo" />
          <div className="px-1.5 pt-0.5 pb-1 text-[11px] tracking-wide text-testo-3 uppercase">
            Moderazione
          </div>
          {moderazione.map((voce) => (
            <Riga
              key={voce.genere}
              icona={iconaDi(voce.genere, voce.attiva)}
              testo={voce.attiva ? PAROLE[voce.genere].togli : PAROLE[voce.genere].imponi}
              // Rimettere non e' pericoloso: il rosso e' per cio' che toglie
              // qualcosa a qualcuno, e usarlo anche per il contrario lo
              // svuoterebbe di significato.
              pericolo={!voce.attiva}
              fai={() => {
                voce.fai(!voce.attiva)
                chiudi()
              }}
            />
          ))}
        </>
      )}

      {caccia && (
        <>
          <div className="my-1 border-t border-bordo" />
          <Riga
            icona={<Espelli />}
            testo="Espelli dal canale"
            pericolo
            fai={() => {
              void caccia()
              chiudi()
            }}
          />
        </>
      )}
    </div>
  )
}

function Riga({
  icona,
  testo,
  fai,
  pericolo = false
}: {
  icona: React.ReactNode
  testo: string
  fai: () => void
  pericolo?: boolean
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      onClick={fai}
      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors ${
        pericolo ? 'text-male hover:bg-male/10' : 'text-testo-2 hover:bg-fondo-3 hover:text-testo-1'
      }`}
    >
      <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icona}</span>
      <span className="truncate">{testo}</span>
    </button>
  )
}
