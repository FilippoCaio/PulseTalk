import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type Impostazioni,
  type Puntata,
  type SceltaCattura,
  type Scorciatoia,
  type Sorgente
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

  // Va chiamata subito prima di getDisplayMedia(): dice al processo principale
  // quale sorgente consegnare e se attaccarci l'audio di sistema.
  preparaCattura: (scelta: SceltaCattura): Promise<void> =>
    ipcRenderer.invoke(IPC.preparaCattura, scelta),

  leggiImpostazioni: (): Promise<Impostazioni> => ipcRenderer.invoke(IPC.leggiImpostazioni),
  scriviImpostazioni: (
    modifiche: Partial<Impostazioni>
  ): Promise<{ impostazioni: Impostazioni; errore?: string }> =>
    ipcRenderer.invoke(IPC.scriviImpostazioni, modifiche),

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

  versione: (): Promise<{
    app: string
    elettrone: string
    chrome: string
    piattaforma: string
  }> => ipcRenderer.invoke(IPC.versione),

  apriEsterno: (url: string): void => ipcRenderer.send(IPC.apriEsterno, url),

  /** Disegna un alone sul monitor condiviso, sopra a tutto il resto. */
  puntatore: (punta: Puntata): void => ipcRenderer.send(IPC.puntatore, punta),

  notifica: (avviso: { titolo: string; corpo: string }): void =>
    ipcRenderer.send(IPC.notifica, avviso)
}

export type ApiPulseTalk = typeof api

contextBridge.exposeInMainWorld('pulsetalk', api)
