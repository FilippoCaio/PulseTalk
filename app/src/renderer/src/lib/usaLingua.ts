import { useSyncExternalStore } from 'react'
import { LINGUA_SORGENTE, type Dizionario } from '@shared/lingue'

/**
 * La lingua accesa adesso, e la funzione che traduce.
 *
 * ## Perche' non un contesto React
 *
 * Il primo istinto era un `Provider` intorno all'applicazione. Non regge la
 * forma di questo `App.tsx`: ha una dozzina di uscite anticipate — avvio,
 * scelta del server, accesso, blocco per aggiornamento — e avvolgerle tutte
 * voleva dire dodici punti in cui ci si puo' dimenticare il fornitore, con la
 * schermata che resta in italiano senza dire perche'.
 *
 * Qui la lingua vive fuori da React, in un negozio grande dieci righe, e i
 * componenti ci si affacciano con `useSyncExternalStore`. Cambiare lingua
 * ridisegna **solo** chi mostra testo, e non smonta niente: cambiarla durante
 * una chiamata non fa cadere la chiamata, che sarebbe successo montando di
 * nuovo l'albero.
 *
 * ## `usaT` e' l'unico modo di ottenere `t`
 *
 * Ed e' voluto. Se `t` si potesse importare come funzione qualunque, un
 * componente potrebbe tradurre senza essersi iscritto ai cambiamenti: al primo
 * cambio di lingua resterebbe indietro, e sarebbe un difetto che si vede solo
 * cambiando lingua — cioe' quasi mai, cioe' in mano a qualcun altro. Passando
 * dall'hook, chi traduce e' iscritto per costruzione.
 */

let corrente = LINGUA_SORGENTE
let dizionario: Dizionario = {}
const iscritti = new Set<() => void>()

function avvisa(): void {
  for (const chi of iscritti) chi()
}

/**
 * Cosa restituisce lo store: una coppia che cambia identita' solo quando la
 * lingua cambia davvero.
 *
 * `useSyncExternalStore` confronta con `Object.is`, quindi restituire un
 * oggetto nuovo a ogni lettura farebbe ridisegnare all'infinito. Si tiene
 * quindi la stessa istanza finche' non si cambia lingua.
 */
let istantanea = { codice: corrente, t: traduci }

function leggi(): typeof istantanea {
  return istantanea
}

function iscrivi(chi: () => void): () => void {
  iscritti.add(chi)
  return () => {
    iscritti.delete(chi)
  }
}

function traduci(frase: string, valori?: Record<string, string | number>): string {
  const tradotta = dizionario[frase] ?? frase
  if (!valori) return tradotta
  // I segnaposto sono `{nome}`. Restano nella frase tradotta perche' fanno
  // parte della chiave: chi traduce li sposta dove vuole ma non li inventa.
  return tradotta.replace(/\{(\w+)\}/g, (intero, nome: string) =>
    nome in valori ? String(valori[nome]) : intero
  )
}

/** Che lingua e' accesa, senza iscriversi. Per chi deve deciderne un'altra. */
export function linguaAccesa(): string {
  return corrente
}

/**
 * Accende una lingua con il suo dizionario.
 *
 * Il dizionario arriva gia' caricato: questo modulo non sa da dove vengono i
 * pacchetti, e non deve — vedi `caricaDizionario`, che li cerca prima fra
 * quelli compilati dentro e poi sul server.
 */
export function impostaLingua(codice: string, pacchetto: Dizionario): void {
  if (codice === corrente && pacchetto === dizionario) return
  corrente = codice
  dizionario = pacchetto
  istantanea = { codice, t: traduci }
  // La lingua del documento, che non e' cosmetica: la usano la sillabazione,
  // le virgolette tipografiche e chi legge la pagina ad alta voce.
  if (typeof document !== 'undefined') document.documentElement.lang = codice
  avvisa()
}

/**
 * `t`, e la lingua per chi deve saperla.
 *
 * Si chiama in ogni componente che mostra testo. Costa un'iscrizione a un
 * `Set` e niente altro.
 */
export function usaT(): { t: typeof traduci; codice: string } {
  return useSyncExternalStore(iscrivi, leggi, leggi)
}

/**
 * Quali frasi un pacchetto non copre.
 *
 * E' il prezzo della chiave-come-frase, pagato apposta: correggere un refuso
 * nell'italiano scollega quella traduzione, e senza un modo di accorgersene la
 * frase tornerebbe italiana in silenzio. Questa funzione confronta un
 * pacchetto con l'elenco delle frasi usate e dice cosa manca.
 *
 * L'elenco delle frasi usate non si puo' ricavare a schermo acceso — sono
 * chiamate sparse in cinquanta file — quindi lo produce lo script di
 * estrazione, e questa serve a confrontarci un pacchetto.
 */
export function mancanti(pacchetto: Dizionario, usate: readonly string[]): string[] {
  return usate.filter((frase) => !(frase in pacchetto))
}
