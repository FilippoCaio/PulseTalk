import {
  IMPOSTAZIONI_INIZIALI,
  type InformazioniClient,
  type Impostazioni,
  type PreparazioneAggiornamento,
  type Puntata,
  type SceltaCattura,
  type Scorciatoia,
  type Sorgente,
  type StatoAggiornamento
} from '@shared/tipi'
import { Browser } from '@capacitor/browser'
import { Preferences } from '@capacitor/preferences'
import { suAndroid } from './lib/android'
import { SERVER_PREDEFINITO } from '@shared/predefiniti'
import {
  collegaNellElenco,
  nomeDaIndirizzo,
  normalizzaIndirizzo,
  scollegaDallElenco,
  stessoServer,
  trovaServer,
  type ServerCollegato
} from '@shared/collegamenti'

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
  /** Vero dentro il contenitore Android. */
  android: boolean

  /**
   * Gli aggiornamenti. Nel browser non esistono: la pagina e' sempre l'ultima
   * versione per costruzione, ed e' l'unico posto dove il problema non c'e'.
   */
  aggiornamenti: {
    stato(): Promise<StatoAggiornamento>
    prepara(vincolo: PreparazioneAggiornamento): Promise<StatoAggiornamento>
    controlla(): Promise<StatoAggiornamento>
    scarica(): Promise<StatoAggiornamento>
    installa(): Promise<void>
    ascolta(quando: (stato: StatoAggiornamento) => void): () => void
  } | null

  /** Versione del binario installato. Nulla nel browser, che segue il server. */
  informazioniClient(): Promise<InformazioniClient | null>

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

  /**
   * I server veri: il NAS di casa, quello dell'ufficio.
   *
   * Stanno qui e non dentro all'API perche' sono una cosa dell'apparecchio, non
   * di un server: e' l'applicazione installata su questo computer a sapere a
   * quali indirizzi ci si e' collegati, e nessuno dei server lo sa ne' deve
   * saperlo.
   *
   * `collegaServer` fa due cose in un colpo — mette l'indirizzo nell'elenco e
   * ci passa sopra — perche' separarle vorrebbe dire un istante in cui il
   * token appena ottenuto e l'indirizzo attivo sono di due server diversi.
   */
  collegaServer(dati: {
    indirizzo: string
    token?: string | null
    nome?: string | null
    utente?: string | null
    nomeVisibile?: string | null
  }): Promise<{ impostazioni: Impostazioni; errore?: string }>
  passaAServer(indirizzo: string): Promise<Impostazioni>
  scollegaServer(indirizzo: string): Promise<Impostazioni>

  /** Scorciatoie globali: nel browser funzionano solo con la finestra a fuoco. */
  onScorciatoia(callback: (quale: Scorciatoia) => void): () => void

  /**
   * La finestra e' entrata o uscita dal tutto schermo del sistema.
   *
   * Nel browser non arriva mai: il tutto schermo di Chrome premendo F11 non
   * produce nessun evento per la pagina, ed e' voluto — una pagina non deve
   * sapere quanto e' grande la finestra che la contiene. Li' resta il pulsante
   * dentro alla sala, che fa la stessa cosa in un posto che si vede.
   */
  onSchermoFinestra(callback: (pieno: boolean) => void): () => void

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

  /** Registra una misura WebRTC anonima; nell'app resta in `audio.log`. */
  diagnosticaAudio(testo: string): void
}

// -- Dentro Electron ----------------------------------------------------------

function ponteElettrone(api: NonNullable<Window['pulsetalk']>): Ponte {
  return {
    elettrone: true,
    android: false,
    audioDiSistema: true,
    aggiornamenti: api.aggiornamento,
    informazioniClient: async () => {
      const info = await api.versione()
      return {
        versione: info.app,
        piattaforma: info.piattaforma,
        architettura: info.architettura
      }
    },
    sorgenti: () => api.sorgenti(),
    preparaCattura: (scelta) => api.preparaCattura(scelta),
    leggiImpostazioni: () => api.leggiImpostazioni(),
    scriviImpostazioni: (modifiche) => api.scriviImpostazioni(modifiche),
    onImpostazioniCambiate: (callback) => api.onImpostazioniCambiate(callback),
    collegaServer: (dati) => api.collegaServer(dati),
    passaAServer: async (indirizzo) => (await api.passaAServer(indirizzo)).impostazioni,
    scollegaServer: async (indirizzo) => (await api.scollegaServer(indirizzo)).impostazioni,
    onScorciatoia: (callback) => api.onScorciatoia(callback),
    onSchermoFinestra: (callback) => api.onSchermoFinestra(callback),
    apriEsterno: (url) => api.apriEsterno(url),
    puntatoreSulloSchermo: (punta) => api.puntatore(punta),
    diagnosticaAudio: (testo) => api.diagnosticaAudio(testo),
    notifica: (avviso) => api.notifica(avviso)
  }
}

// -- Nel browser --------------------------------------------------------------

const CHIAVE = 'pulsetalk.impostazioni'
/**
 * I token, tenuti a parte anche qui.
 *
 * Non e' sicurezza — sono nello stesso `localStorage`, e chi ha accesso a
 * questo profilo di Chrome ha entrambi — e' igiene: le impostazioni si
 * esportano, si copiano fra apparecchi, si guardano dagli strumenti dello
 * sviluppatore. Averle senza dentro i segreti di quattro server rende tutto
 * questo meno pericoloso per distrazione.
 */
const CHIAVE_GETTONI = 'pulsetalk.gettoni'

function ponteBrowser(): Ponte {
  const ascoltatori = new Set<(i: Impostazioni) => void>()

  const leggiGrezzo = async (chiave: string): Promise<string | null> =>
    suAndroid ? (await Preferences.get({ key: chiave })).value : localStorage.getItem(chiave)

  const scriviGrezzo = async (chiave: string, valore: string): Promise<void> => {
    if (suAndroid) await Preferences.set({ key: chiave, value: valore })
    else localStorage.setItem(chiave, valore)
  }

  const leggiGettoni = async (): Promise<Record<string, string>> => {
    try {
      const letto = JSON.parse((await leggiGrezzo(CHIAVE_GETTONI)) ?? '{}')
      return letto && typeof letto === 'object' ? (letto as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  /**
   * Elenco, server attivo e token rimessi in fila.
   *
   * La stessa regola del processo principale, e volutamente la stessa: e'
   * l'unico modo perche' l'app installata e la pagina web si comportino uguale
   * quando si passa da un server all'altro. La differenza sta solo in dove
   * finiscono i token.
   *
   * `semina` vale solo alla prima lettura di impostazioni che l'elenco non ce
   * l'hanno: distingue "non ne ho mai avuto uno" da "ne avevo uno e l'ho
   * svuotato". Senza, scollegando l'ultimo server lo si vedrebbe ricomparire
   * da solo un istante dopo.
   */
  const riallinea = async (
    base: Impostazioni,
    { semina = false } = {}
  ): Promise<Impostazioni> => {
    const elenco: ServerCollegato[] = Array.isArray(base.serverCollegati)
      ? base.serverCollegati.filter((s) => s && typeof s.indirizzo === 'string' && s.indirizzo)
      : []

    const primo = normalizzaIndirizzo(base.server ?? '')
    if (semina && primo && elenco.length === 0) {
      elenco.push({
        indirizzo: primo,
        nome: nomeDaIndirizzo(primo),
        utente: base.utenteRicordato ?? null,
        nomeVisibile: base.nome ?? null,
        ultimoAccesso: Math.floor(Date.now() / 1000)
      })
    }

    const attivo =
      trovaServer(elenco, base.serverAttivo ?? null) ?? trovaServer(elenco, primo) ?? elenco[0] ?? null
    const gettoni = await leggiGettoni()

    return {
      ...base,
      serverCollegati: elenco,
      serverAttivo: attivo?.indirizzo ?? null,
      server: attivo?.indirizzo ?? '',
      token: attivo ? (gettoni[attivo.indirizzo] ?? null) : null
    }
  }

  const leggi = async (): Promise<Impostazioni> => {
    let salvate: Partial<Impostazioni> = {}
    try {
      salvate = JSON.parse((await leggiGrezzo(CHIAVE)) ?? '{}')
    } catch {
      // Un valore illeggibile non deve impedire di entrare in una stanza.
    }
    return riallinea(
      {
        ...IMPOSTAZIONI_INIZIALI,
        // Il server e' quello che ha servito questa pagina: chi apre
        // talk.<dominio> non deve digitare di nuovo l'indirizzo da cui e'
        // appena arrivato.
        server: suAndroid ? SERVER_PREDEFINITO : location.origin,
        ...salvate
      },
      { semina: !Array.isArray(salvate.serverCollegati) }
    )
  }

  /** Scrive le impostazioni e avvisa chi guarda. Il token non passa di qui. */
  const salva = async (prossime: Impostazioni): Promise<Impostazioni> => {
    const { token: _fuori, ...daSalvare } = prossime
    await scriviGrezzo(CHIAVE, JSON.stringify(daSalvare))
    for (const ascoltatore of ascoltatori) ascoltatore(prossime)
    return prossime
  }

  const tasti = new Map<string, Scorciatoia>([
    ['ctrl+shift+KeyM', 'muto'],
    ['ctrl+shift+KeyD', 'sordina']
  ])

  return {
    elettrone: false,
    android: suAndroid,
    aggiornamenti: null,
    informazioniClient: async () => null,

    // Chrome sa condividere l'audio di una scheda, e su Windows anche quello
    // di sistema, ma solo se e' l'utente a spuntarlo nella sua finestra. Da
    // qui non si puo' ne' chiedere ne' garantire, quindi si dichiara di no e
    // l'interfaccia non promette quello che non puo' mantenere.
    audioDiSistema: false,
    sorgenti: async () => [],
    preparaCattura: async () => {},

    leggiImpostazioni: () => leggi(),

    scriviImpostazioni: async (modifiche) => {
      const attuali = await leggi()

      // Il token va nel suo cassetto, sotto l'indirizzo del server attivo.
      // Prima stava nelle impostazioni come tutto il resto, e con un server
      // solo non faceva differenza; adesso la farebbe, e la farebbe nel modo
      // peggiore — il token dell'ufficio sotto l'indirizzo di casa.
      if (modifiche.token !== undefined && attuali.serverAttivo) {
        const gettoni = await leggiGettoni()
        if (modifiche.token === null) delete gettoni[attuali.serverAttivo]
        else gettoni[attuali.serverAttivo] = modifiche.token
        await scriviGrezzo(CHIAVE_GETTONI, JSON.stringify(gettoni))
      }

      const prossime = await riallinea({ ...attuali, ...modifiche })
      // Anche accanto al server: nome utente e nome visibile sono cose di quel
      // server, e tornandoci devono tornare quelli.
      if (
        prossime.serverAttivo &&
        (modifiche.utenteRicordato !== undefined || modifiche.nome !== undefined)
      ) {
        const dove = prossime.serverAttivo
        prossime.serverCollegati = prossime.serverCollegati.map((server) =>
          stessoServer(server.indirizzo, dove)
            ? {
                ...server,
                utente:
                  modifiche.utenteRicordato !== undefined
                    ? modifiche.utenteRicordato
                    : server.utente,
                nomeVisibile: modifiche.nome !== undefined ? modifiche.nome : server.nomeVisibile
              }
            : server
        )
      }

      await salva(prossime)
      return {
        impostazioni: prossime,
        // Detto una volta, senza insistere. Nel browser il token sta in
        // localStorage perche' non c'e' altro posto: chi ha accesso a questo
        // profilo di Chrome ce l'ha. Nell'app installata e' cifrato con la
        // DPAPI dell'utente di Windows.
        errore: modifiche.token && !suAndroid
          ? 'Il browser tiene il token in chiaro nella memoria del sito. Per un accesso permanente conviene l\'app installata.'
          : undefined
      }
    },

    collegaServer: async (dati) => {
      const indirizzo = normalizzaIndirizzo(dati.indirizzo)
      if (!indirizzo) {
        return { impostazioni: await leggi(), errore: "Serve l\'indirizzo del server." }
      }

      if (dati.token !== undefined) {
        const gettoni = await leggiGettoni()
        if (dati.token === null) delete gettoni[indirizzo]
        else gettoni[indirizzo] = dati.token
        await scriviGrezzo(CHIAVE_GETTONI, JSON.stringify(gettoni))
      }

      const attuali = await leggi()
      const impostazioni = await riallinea({
        ...attuali,
        serverCollegati: collegaNellElenco(attuali.serverCollegati, {
          indirizzo,
          nome: dati.nome ?? null,
          utente: dati.utente ?? null,
          nomeVisibile: dati.nomeVisibile ?? null
        }),
        serverAttivo: indirizzo,
        utenteRicordato: dati.utente ?? attuali.utenteRicordato,
        nome: dati.nomeVisibile ?? attuali.nome
      })

      await salva(impostazioni)
      return {
        impostazioni,
        errore: dati.token && !suAndroid ? "Il browser tiene il token in chiaro nella memoria del sito. Per un accesso permanente conviene l\'app installata." : undefined
      }
    },

    passaAServer: async (indirizzo) => {
      const attuali = await leggi()
      const quale = trovaServer(attuali.serverCollegati, indirizzo)
      if (!quale) return attuali

      return salva(
        await riallinea({
          ...attuali,
          serverAttivo: quale.indirizzo,
          utenteRicordato: quale.utente ?? null,
          nome: quale.nomeVisibile ?? null
        })
      )
    },

    scollegaServer: async (indirizzo) => {
      const normale = normalizzaIndirizzo(indirizzo)
      const gettoni = await leggiGettoni()
      delete gettoni[normale]
      await scriviGrezzo(CHIAVE_GETTONI, JSON.stringify(gettoni))

      const attuali = await leggi()
      const elenco = scollegaDallElenco(attuali.serverCollegati, normale)
      const attivo = stessoServer(attuali.serverAttivo ?? '', normale)
        ? (elenco[0]?.indirizzo ?? null)
        : attuali.serverAttivo

      return salva(
        await riallinea({
          ...attuali,
          serverCollegati: elenco,
          serverAttivo: attivo,
          utenteRicordato: trovaServer(elenco, attivo)?.utente ?? null,
          nome: trovaServer(elenco, attivo)?.nomeVisibile ?? null
        })
      )
    },

    onImpostazioniCambiate: (callback) => {
      ascoltatori.add(callback)
      return () => ascoltatori.delete(callback)
    },

    onSchermoFinestra: () => () => {},

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
      if (suAndroid) void Browser.open({ url })
      else window.open(url, '_blank', 'noopener,noreferrer')
    },

    // Nel browser il puntatore resta dentro al riquadro e la notifica non
    // esiste: sono le due cose che una pagina non puo' fare fuori da se'.
    puntatoreSulloSchermo: () => {},
    diagnosticaAudio: (testo) => console.warn(`[audio] ${testo}`),
    notifica: () => {}
  }
}

export const ponte: Ponte = window.pulsetalk ? ponteElettrone(window.pulsetalk) : ponteBrowser()
