import { app, BrowserWindow, ipcMain } from 'electron'
import {
  mostraSchermataAggiornamento,
  segnaAggiornamentoInCorso
} from './schermataAggiornamento'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/tipi'
import type { PreparazioneAggiornamento, StatoAggiornamento } from '@shared/tipi'
import { confrontaVersioni, versioneValida } from '@shared/versione'

// electron-updater e' CommonJS: l'export nominato non esiste, si passa dal
// default. Scritto `import { autoUpdater }` compila e poi esplode a runtime.
const { autoUpdater } = electronUpdater

/**
 * Il controllo degli aggiornamenti.
 *
 * Regole di questa implementazione:
 *
 *  - **l'installer conosce gia' il feed pubblico.** Il controllo manuale deve
 *    quindi funzionare anche prima dell'accesso o quando il server non e'
 *    raggiungibile. Quando il server comunica un vincolo piu' preciso, quel
 *    vincolo e il suo feed sostituiscono la configurazione incorporata.
 *  - **un aggiornamento obbligatorio si scarica da solo.** In quel momento
 *    l'interfaccia e' bloccata prima del login, quindi non c'e' una chiamata da
 *    disturbare. Quelli facoltativi continuano ad aspettare il pulsante.
 *  - **non installa mentre si parla.** L'installazione chiude l'app: chiederla
 *    a chi sta in una stanza vocale significa buttarlo fuori a meta' frase. Il
 *    pulsante lo sa e lo dice.
 *
 * Il portabile resta fuori dall'installazione automatica. Se il server esige
 * una versione nuova, pero', resta bloccato con una spiegazione: proseguire
 * fingendo che sia aggiornabile vanificherebbe l'intero controllo.
 */
export function preparaAggiornamenti(): { allAvvio: () => void } {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  let stato: StatoAggiornamento = { fase: 'fermo', versione: app.getVersion() }
  let vincolo: PreparazioneAggiornamento | null = null
  let operazione: Promise<StatoAggiornamento> | null = null

  const avvisa = (nuovo: Partial<StatoAggiornamento>): void => {
    stato = { ...stato, ...nuovo }
    for (const f of BrowserWindow.getAllWindows()) {
      f.webContents.send(IPC.aggiornamento, stato)
    }
  }

  const disponibile = (versione: string, note?: unknown): void => {
    if (!versioneValida(versione)) {
      avvisa({ fase: 'errore', errore: `Il feed dichiara una versione non valida: ${versione}.` })
      return
    }
    if (vincolo && confrontaVersioni(versione, vincolo.versioneTarget) < 0) {
      avvisa({
        fase: 'errore',
        disponibile: versione,
        errore:
          `Il server richiede la ${vincolo.versioneTarget}, ma il feed offre soltanto la ${versione}. ` +
          'Chi amministra il server deve completare la pubblicazione.'
      })
      return
    }
    if (
      vincolo?.versioneMassima &&
      confrontaVersioni(versione, vincolo.versioneMassima) > 0
    ) {
      avvisa({
        fase: 'errore',
        disponibile: versione,
        errore:
          `Il feed offre la ${versione}, ma questo server accetta al massimo la ` +
          `${vincolo.versioneMassima}. latest.yml e i vincoli del server non sono allineati.`
      })
      return
    }
    avvisa({ fase: 'disponibile', disponibile: versione, note: normalizzaNote(note), errore: undefined })
  }

  autoUpdater.on('update-available', (info) => disponibile(info.version, info.releaseNotes))
  autoUpdater.on('update-not-available', () => {
    if (vincolo?.obbligatorio) {
      avvisa({
        fase: 'errore',
        errore:
          `Il server richiede la ${vincolo.versioneTarget}, ma nel feed non c'e' un aggiornamento ` +
          'installabile. Chi amministra il server deve pubblicare i file della release.'
      })
      return
    }
    avvisa({ fase: 'aggiornato', errore: undefined })
  })
  autoUpdater.on('download-progress', (p) => avvisa({ fase: 'scarico', percento: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', () => avvisa({ fase: 'pronto', percento: 100 }))
  autoUpdater.on('error', (e) => {
    // Senza rete, o dietro a una rete che blocca GitHub, questo scatta a ogni
    // avvio: e' rumore, non un guasto. Resta nello stato per chi apre il
    // pannello, e non diventa mai una finestra in faccia a nessuno.
    //
    // Un caso pero' non e' un errore per niente: un repository senza nemmeno
    // una release. Vuol dire solo che non c'e' ancora niente da scaricare, ed
    // e' esattamente cio' che l'utente legge come "sei aggiornato". Mostrargli
    // "No published versions on GitHub" e' farlo preoccupare di una cosa che
    // riguarda chi pubblica, non lui.
    if (/no published versions/i.test(e.message) && !vincolo?.obbligatorio) {
      avvisa({ fase: 'aggiornato', errore: undefined })
      return
    }
    // E un caso che non e' nemmeno un errore: il server a cui si e' collegati
    // non pubblica aggiornamenti. Succede a ogni istanza installata da qualcun
    // altro — chi la amministra non compila l'applicazione, se la scarica come
    // tutti — e il feed semplicemente non esiste. Mostrarlo come "404 su
    // latest.yml" fa sembrare rotta una cosa che non c'e' e basta.
    if (senzaFeed(e) && !vincolo?.obbligatorio) {
      avvisa({ fase: 'senzaFeed', errore: undefined })
      return
    }
    avvisa({ fase: 'errore', errore: e.message })
  })

  ipcMain.handle(IPC.aggiornamentoStato, () => stato)

  const controlla = async (scaricaSeObbligatorio: boolean): Promise<StatoAggiornamento> => {
    if (!aggiornabile()) {
      avvisa({
        fase: 'nonSupportato',
        errore: vincolo?.obbligatorio
          ? `Il server richiede la ${vincolo.versioneTarget}, ma questa copia e' portabile o di sviluppo e non puo aggiornarsi da sola.`
          : undefined
      })
      return stato
    }
    avvisa({ fase: 'controllo', errore: undefined })
    try {
      const esito = await autoUpdater.checkForUpdates()
      // L'evento arriva normalmente prima della risoluzione. Questo ripiego
      // rende il risultato deterministico anche con provider che non lo fanno.
      if (stato.fase === 'controllo' && esito?.updateInfo?.version) {
        disponibile(esito.updateInfo.version, esito.updateInfo.releaseNotes)
      }
      if (scaricaSeObbligatorio && vincolo?.obbligatorio && stato.fase === 'disponibile') {
        avvisa({ fase: 'scarico', percento: 0 })
        await autoUpdater.downloadUpdate()
      }
    } catch (e) {
      avvisa({ fase: 'errore', errore: (e as Error).message })
    }
    return stato
  }

  ipcMain.handle(IPC.aggiornamentoPrepara, async (_evento, dati: unknown) => {
    try {
      vincolo = validaPreparazione(dati)
      autoUpdater.setFeedURL({ provider: 'generic', url: vincolo.feedUrl })
      avvisa({
        fase: 'fermo',
        obbligatorio: vincolo.obbligatorio,
        richiesta: vincolo.versioneTarget,
        disponibile: undefined,
        percento: undefined,
        note: undefined,
        errore: undefined
      })
    } catch (e) {
      vincolo = null
      avvisa({ fase: 'errore', errore: (e as Error).message })
      return stato
    }

    // React puo' ripetere un effetto in sviluppo: una seconda richiesta non
    // deve aprire due download concorrenti sullo stesso file.
    if (operazione) return operazione
    operazione = controlla(vincolo.obbligatorio).finally(() => {
      operazione = null
    })
    return operazione
  })

  ipcMain.handle(IPC.aggiornamentoControlla, async () => {
    if (operazione) return operazione
    operazione = controlla(false).finally(() => {
      operazione = null
    })
    return operazione
  })

  ipcMain.handle(IPC.aggiornamentoScarica, async () => {
    if (stato.fase !== 'disponibile') return stato
    avvisa({ fase: 'scarico', percento: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (e) {
      avvisa({ fase: 'errore', errore: (e as Error).message })
    }
    return stato
  })

  ipcMain.handle(IPC.aggiornamentoInstalla, () => {
    if (stato.fase !== 'pronto') return
    // Silenzioso, e rilancia.
    //
    // Il primo argomento diventa `/S` sulla riga di comando dell'installer, ed
    // e' l'unica cosa che separa un aggiornamento da una reinstallazione: con
    // `false` comparivano le schermate dell'installer NSIS — benvenuto,
    // modalita', cartella, fine — a chi aveva chiesto soltanto di riavviare.
    // Il secondo passa `--force-run`, che nell'installer assistito e' proprio
    // il ramo che rilancia l'applicazione quando ha finito in silenzio.
    //
    // Perche' questo funzioni servono le righe `nsis:` di electron-builder.yml:
    // per utente, cosi' non c'e' niente da elevare, e senza pagine da mostrare
    // durante un aggiornamento.
    // Prima la finestrella, poi l'uscita.
    //
    // `quitAndInstall` chiude tutto: chiamandolo per primo, chi guarda vedrebbe
    // sparire la finestra e basta - da fuori indistinguibile da un crash, ed e'
    // il momento in cui qualcuno riapre a mano l'app che si stava gia'
    // riaprendo da sola. La schermata si aspetta che abbia davvero dipinto,
    // altrimenti sarebbe un lampo grigio; se non ci riesce entro un secondo si
    // va avanti comunque, perche' l'aggiornamento non si ferma per
    // un'animazione.
    // Il segnale resta sul disco e sopravvive al riavvio: e' cosi' che il
    // processo che nascera' fra qualche secondo sapra' di essere tornato da un
    // aggiornamento invece che da un doppio clic, e mostrera' la schermata
    // anche in entrata.
    segnaAggiornamentoInCorso()
    void mostraSchermataAggiornamento('esce').finally(() => {
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
    })
  })

  /**
   * Il controllo all'avvio, una volta sola.
   *
   * Prima il primo controllo partiva da `aggiornamentoPrepara`, cioe' quando il
   * server comunica il vincolo di versione: dopo l'accesso, e solo se il server
   * risponde. Chi apriva l'applicazione per entrare in una chiamata non sapeva
   * di essere indietro finche' non andava a cercarlo nelle impostazioni.
   *
   * L'installer pero' il feed lo conosce gia' — glielo scrive electron-builder
   * dentro ad app-update.yml — quindi qui non serve niente e nessuno: si
   * controlla e basta. Se poi il server dira' un feed diverso, `prepara` lo
   * sostituisce e rifa' il giro.
   *
   * `scaricaSeObbligatorio` e' falso: all'avvio non si sa ancora se il server
   * pretende una versione, e trecento megabyte scaricati senza chiedere sono
   * l'ultima cosa che deve succedere a chi ha appena aperto il programma.
   */
  const allAvvio = (): void => {
    if (operazione) return
    operazione = controlla(false).finally(() => {
      operazione = null
    })
  }

  return { allAvvio }
}

/**
 * Il feed non c'e', il che e' diverso dal feed rotto.
 *
 * electron-updater lo racconta come un 404 sul file di canale. Non si guarda
 * solo il numero: un 404 su altro sarebbe comunque un errore da mostrare, e un
 * "Cannot find channel" senza numero e' lo stesso caso detto in un altro modo
 * dalla stessa libreria.
 */
function senzaFeed(errore: Error): boolean {
  const testo = errore.message ?? ''
  if (/cannot find channel/i.test(testo)) return true
  if (/ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(testo)) return true
  if (/\b404\b/.test(testo) && /latest.*\.yml/i.test(testo)) return true
  // E il caso di un server piu' vecchio di questa correzione: li' un
  // `latest.yml` che non esiste non tornava 404 ma 200 con dentro l'HTML
  // dell'applicazione — il ripiego della pagina singola se lo mangiava — e
  // quello che electron-updater riporta non e' un codice ma un errore di
  // lettura. Anche quello vuol dire "questo server non pubblica aggiornamenti".
  return /<!doctype html|<html/i.test(testo) || /cannot parse update info/i.test(testo)
}

/**
 * Il portabile e la versione di sviluppo non si aggiornano.
 *
 * `isPackaged` esclude `npm run dev`; la variabile PORTABLE_EXECUTABLE_DIR la
 * mette electron-builder solo dentro al portabile, ed e' l'unico modo per
 * riconoscerlo dall'interno.
 */
function aggiornabile(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
}

/** Il renderer e' isolato, ma ogni valore IPC resta comunque non fidato. */
function validaPreparazione(dati: unknown): PreparazioneAggiornamento {
  if (!dati || typeof dati !== 'object') throw new Error('Vincolo di aggiornamento non valido.')
  const valore = dati as Partial<PreparazioneAggiornamento>
  if (
    !versioneValida(valore.versioneTarget) ||
    (valore.versioneMassima !== null && !versioneValida(valore.versioneMassima)) ||
    typeof valore.obbligatorio !== 'boolean' ||
    typeof valore.feedUrl !== 'string'
  ) {
    throw new Error('Vincolo di aggiornamento incompleto o non valido.')
  }
  if (
    valore.versioneMassima !== null &&
    confrontaVersioni(valore.versioneMassima, valore.versioneTarget) < 0
  ) {
    throw new Error('La versione massima del server precede la release richiesta.')
  }

  let feed: URL
  try {
    feed = new URL(valore.feedUrl)
  } catch {
    throw new Error('Il server ha indicato un feed di aggiornamento non valido.')
  }
  if (!['http:', 'https:'].includes(feed.protocol) || feed.username || feed.password) {
    throw new Error('Il feed di aggiornamento deve essere http/https e non puo contenere credenziali.')
  }
  feed.hash = ''
  return { ...valore, feedUrl: feed.toString() } as PreparazioneAggiornamento
}

/** Le note arrivano come stringa, o come elenco di release, o niente. */
function normalizzaNote(note: unknown): string | undefined {
  if (typeof note === 'string') return note
  if (Array.isArray(note)) {
    return note
      .map((n) => (typeof n === 'string' ? n : ((n as { note?: string }).note ?? '')))
      .filter(Boolean)
      .join('\n\n')
  }
  return undefined
}
