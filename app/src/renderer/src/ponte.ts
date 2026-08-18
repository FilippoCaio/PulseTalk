import {
  IMPOSTAZIONI_INIZIALI,
  type Impostazioni,
  type Puntata,
  type SceltaCattura,
  type Scorciatoia,
  type Sorgente
} from '@shared/tipi'

/**
 * La stessa interfaccia, due case.
 *
 * Dentro Electron c'e' `window.pulsetalk` e si puo' fare tutto: scegliere quale
 * schermo, agganciare l'audio di sistema, tenere il token cifrato dalla DPAPI,
 * sentire un tasto premuto mentre l'app e' dietro a tutto.
 *
 * Nel browser niente di tutto questo esiste, e non e' una mancanza da
 * nascondere: e' come funziona il web, ed e' giusto che una pagina non possa
 * decidere da sola quale finestra guardare. Qui sotto il ponte dichiara cosa
 * sa fare, e l'interfaccia si comporta di conseguenza invece di provarci e
 * fallire.
 */

export interface Ponte {
  /** Vero dentro l'app installata. */
  elettrone: boolean

  /**
   * Il nostro selettore di sorgenti, con le anteprime. Nel browser torna vuoto
   * e la condivisione passa dalla finestra di Chrome.
   */
  sorgenti(): Promise<Sorgente[]>
  /** Vero se si puo' mandare l'audio di sistema insieme al video. */
  audioDiSistema: boolean

  preparaCattura(scelta: SceltaCattura): Promise<void>

  leggiImpostazioni(): Promise<Impostazioni>
  scriviImpostazioni(
    modifiche: Partial<Impostazioni>
  ): Promise<{ impostazioni: Impostazioni; errore?: string }>
  onImpostazioniCambiate(callback: (i: Impostazioni) => void): () => void

  /** Scorciatoie globali: nel browser funzionano solo con la finestra a fuoco. */
  onScorciatoia(callback: (quale: Scorciatoia) => void): () => void

  apriEsterno(url: string): void

  /**
   * Disegna il "guarda qui" sul monitor vero di chi sta condividendo.
   *
   * Solo dentro l'app installata: nel browser una pagina non puo' disegnare
   * fuori da se stessa, ed e' giusto cosi'. Li' il cerchietto resta dentro al
   * riquadro, che e' comunque meglio di niente.
   */
  puntatoreSulloSchermo(punta: Puntata): void

  /** Una notifica di Windows. Nel browser non fa niente. */
  notifica(avviso: { titolo: string; corpo: string }): void
}

// -- Dentro Electron ----------------------------------------------------------

function ponteElettrone(api: NonNullable<Window['pulsetalk']>): Ponte {
  return {
    elettrone: true,
    audioDiSistema: true,
    sorgenti: () => api.sorgenti(),
    preparaCattura: (scelta) => api.preparaCattura(scelta),
    leggiImpostazioni: () => api.leggiImpostazioni(),
    scriviImpostazioni: (modifiche) => api.scriviImpostazioni(modifiche),
    onImpostazioniCambiate: (callback) => api.onImpostazioniCambiate(callback),
    onScorciatoia: (callback) => api.onScorciatoia(callback),
    apriEsterno: (url) => api.apriEsterno(url),
    puntatoreSulloSchermo: (punta) => api.puntatore(punta),
    notifica: (avviso) => api.notifica(avviso)
  }
}

// -- Nel browser --------------------------------------------------------------

const CHIAVE = 'pulsetalk.impostazioni'

function ponteBrowser(): Ponte {
  const ascoltatori = new Set<(i: Impostazioni) => void>()

  const leggi = (): Impostazioni => {
    let salvate: Partial<Impostazioni> = {}
    try {
      salvate = JSON.parse(localStorage.getItem(CHIAVE) ?? '{}')
    } catch {
      // Un valore illeggibile non deve impedire di entrare in una stanza.
    }
    return {
      ...IMPOSTAZIONI_INIZIALI,
      // Il server e' quello che ha servito questa pagina: chi apre
      // talk.<dominio> non deve digitare di nuovo l'indirizzo da cui e'
      // appena arrivato.
      server: location.origin,
      ...salvate
    }
  }

  const tasti = new Map<string, Scorciatoia>([
    ['ctrl+shift+KeyM', 'muto'],
    ['ctrl+shift+KeyD', 'sordina']
  ])

  return {
    elettrone: false,

    // Chrome sa condividere l'audio di una scheda, e su Windows anche quello
    // di sistema, ma solo se e' l'utente a spuntarlo nella sua finestra. Da
    // qui non si puo' ne' chiedere ne' garantire, quindi si dichiara di no e
    // l'interfaccia non promette quello che non puo' mantenere.
    audioDiSistema: false,
    sorgenti: async () => [],
    preparaCattura: async () => {},

    leggiImpostazioni: async () => leggi(),

    scriviImpostazioni: async (modifiche) => {
      const prossime = { ...leggi(), ...modifiche }
      localStorage.setItem(CHIAVE, JSON.stringify(prossime))
      for (const ascoltatore of ascoltatori) ascoltatore(prossime)
      return {
        impostazioni: prossime,
        // Detto una volta, senza insistere. Nel browser il token sta in
        // localStorage perche' non c'e' altro posto: chi ha accesso a questo
        // profilo di Chrome ce l'ha. Nell'app installata e' cifrato con la
        // DPAPI dell'utente di Windows.
        errore: modifiche.token
          ? 'Il browser tiene il token in chiaro nella memoria del sito. Per un accesso permanente conviene l\'app installata.'
          : undefined
      }
    },

    onImpostazioniCambiate: (callback) => {
      ascoltatori.add(callback)
      return () => ascoltatori.delete(callback)
    },

    onScorciatoia: (callback) => {
      const gestore = (evento: KeyboardEvent): void => {
        // Con il fuoco dentro a un campo di testo, Ctrl+Shift+M e' roba di chi
        // sta scrivendo, non nostra.
        const dentro = document.activeElement
        if (dentro instanceof HTMLInputElement || dentro instanceof HTMLTextAreaElement) return

        const combinazione = `${evento.ctrlKey ? 'ctrl+' : ''}${evento.shiftKey ? 'shift+' : ''}${evento.code}`
        const quale = tasti.get(combinazione)
        if (!quale) return
        evento.preventDefault()
        callback(quale)
      }
      window.addEventListener('keydown', gestore)
      return () => window.removeEventListener('keydown', gestore)
    },

    apriEsterno: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    // Nel browser il puntatore resta dentro al riquadro e la notifica non
    // esiste: sono le due cose che una pagina non puo' fare fuori da se'.
    puntatoreSulloSchermo: () => {},
    notifica: () => {}
  }
}

export const ponte: Ponte = window.pulsetalk ? ponteElettrone(window.pulsetalk) : ponteBrowser()
