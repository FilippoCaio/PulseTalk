import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Impostazioni,
  type PreparazioneAggiornamento,
  type Puntata,
  type SceltaCattura,
  type Scorciatoia,
  type Sorgente,
  type StatoAggiornamento
} from '@shared/tipi'

/**
 * L'unico varco fra la pagina e il resto del programma.
 *
 * La lista e' corta apposta, e resta corta anche se un giorno servisse una
 * scorciatoia in piu': la pagina non puo' leggere un file, non puo' vedere il
 * token in chiaro finche' non lo chiede, e non puo' catturare uno schermo che
 * l'utente non abbia scelto nel selettore.
 *
 * La stessa pagina gira anche nel browser, dove questo oggetto non esiste. E'
 * `ponte.ts`, dall'altra parte, a occuparsi della differenza.
 */

const api = {
  sorgenti: (): Promise<Sorgente[]> => ipcRenderer.invoke(IPC.sorgenti),

  /**
   * Se l'audio della condivisione si puo' prendere dal processo invece che
   * dalle casse. Lo decide il processo principale all'avvio - dipende da
   * Windows e da un eseguibile che puo' mancare - e lo consegna qui fra gli
   * argomenti, che e' il modo di saperlo senza aspettare una risposta.
   */
  audioPerApplicazione: process.argv.includes('--audio-per-applicazione'),

  // Va chiamata subito prima di getDisplayMedia(): dice al processo principale
  // quale sorgente consegnare e se attaccarci l'audio di sistema.
  preparaCattura: (scelta: SceltaCattura): Promise<void> =>
    ipcRenderer.invoke(IPC.preparaCattura, scelta),

  /**
   * L'audio della condivisione preso dal processo, non dalle casse.
   *
   * Torna un identificativo con cui riconoscere i campioni, oppure il motivo
   * per cui non si e' potuto. Chi chiama non deve fidarsi che vada bene: senza
   * questa strada la condivisione parte lo stesso, con il vecchio loopback di
   * tutto il sistema. Vedi `main/audioProcesso.ts`.
   */
  avviaAudioProcesso: (sorgenteId: string): Promise<{ id: string } | { errore: string }> =>
    ipcRenderer.invoke(IPC.audioProcessoAvvia, sorgenteId),

  fermaAudioProcesso: (id: string): void => ipcRenderer.send(IPC.audioProcessoFerma, id),

  onAudioProcessoDati: (callback: (id: string, campioni: Uint8Array) => void) => {
    const gestore = (_evento: unknown, id: string, campioni: Uint8Array): void =>
      callback(id, campioni)
    ipcRenderer.on(IPC.audioProcessoDati, gestore)
    return (): void => {
      ipcRenderer.removeListener(IPC.audioProcessoDati, gestore)
    }
  },

  onAudioProcessoFinito: (callback: (id: string) => void) => {
    const gestore = (_evento: unknown, id: string): void => callback(id)
    ipcRenderer.on(IPC.audioProcessoFinito, gestore)
    return (): void => {
      ipcRenderer.removeListener(IPC.audioProcessoFinito, gestore)
    }
  },

  leggiImpostazioni: (): Promise<Impostazioni> => ipcRenderer.invoke(IPC.leggiImpostazioni),
  scriviImpostazioni: (
    modifiche: Partial<Impostazioni>
  ): Promise<{ impostazioni: Impostazioni; errore?: string }> =>
    ipcRenderer.invoke(IPC.scriviImpostazioni, modifiche),

  /** Collegarsi a un server (o rifare l'accesso a uno gia' collegato). */
  collegaServer: (dati: {
    indirizzo: string
    token?: string | null
    nome?: string | null
    utente?: string | null
    nomeVisibile?: string | null
  }): Promise<{ impostazioni: Impostazioni; errore?: string }> =>
    ipcRenderer.invoke(IPC.collegaServer, dati),

  passaAServer: (indirizzo: string): Promise<{ impostazioni: Impostazioni }> =>
    ipcRenderer.invoke(IPC.passaAServer, indirizzo),

  scollegaServer: (indirizzo: string): Promise<{ impostazioni: Impostazioni }> =>
    ipcRenderer.invoke(IPC.scollegaServer, indirizzo),

  onImpostazioniCambiate: (callback: (impostazioni: Impostazioni) => void) => {
    const gestore = (_evento: unknown, impostazioni: Impostazioni): void => callback(impostazioni)
    ipcRenderer.on(IPC.impostazioniCambiate, gestore)
    return (): void => {
      ipcRenderer.removeListener(IPC.impostazioniCambiate, gestore)
    }
  },

  onScorciatoia: (callback: (quale: Scorciatoia) => void) => {
    const gestore = (_evento: unknown, quale: Scorciatoia): void => callback(quale)
    ipcRenderer.on(IPC.scorciatoia, gestore)
    return (): void => {
      ipcRenderer.removeListener(IPC.scorciatoia, gestore)
    }
  },

  /** Lo stato del controllo aggiornamenti, e i tre comandi che lo muovono. */
  aggiornamento: {
    stato: (): Promise<StatoAggiornamento> => ipcRenderer.invoke(IPC.aggiornamentoStato),
    prepara: (vincolo: PreparazioneAggiornamento): Promise<StatoAggiornamento> =>
      ipcRenderer.invoke(IPC.aggiornamentoPrepara, vincolo),
    controlla: (): Promise<StatoAggiornamento> => ipcRenderer.invoke(IPC.aggiornamentoControlla),
    scarica: (): Promise<StatoAggiornamento> => ipcRenderer.invoke(IPC.aggiornamentoScarica),
    installa: (): Promise<void> => ipcRenderer.invoke(IPC.aggiornamentoInstalla),
    /** Restituisce la funzione per smettere di ascoltare. */
    ascolta: (quando: (stato: StatoAggiornamento) => void): (() => void) => {
      const gestore = (_e: unknown, stato: StatoAggiornamento): void => quando(stato)
      ipcRenderer.on(IPC.aggiornamento, gestore)
      return () => {
        ipcRenderer.off(IPC.aggiornamento, gestore)
      }
    }
  },

  versione: (): Promise<{
    app: string
    elettrone: string
    chrome: string
    piattaforma: string
    architettura: string
  }> => ipcRenderer.invoke(IPC.versione),

  apriEsterno: (url: string): void => ipcRenderer.send(IPC.apriEsterno, url),

  /** Disegna un alone sul monitor condiviso, sopra a tutto il resto. */
  puntatore: (punta: Puntata): void => ipcRenderer.send(IPC.puntatore, punta),

  /**
   * Una riga tecnica e anonima sulle tracce WebRTC. Il processo principale la
   * conserva su disco: il renderer non ha accesso diretto ai file, e perdere
   * questi numeri alla chiusura renderebbe impossibili i guasti intermittenti.
   */
  diagnosticaAudio: (testo: string): void => ipcRenderer.send(IPC.diagnosticaAudio, testo),

  notifica: (avviso: { titolo: string; corpo: string }): void =>
    ipcRenderer.send(IPC.notifica, avviso)
}

export type ApiPulseTalk = typeof api

contextBridge.exposeInMainWorld('pulsetalk', api)
