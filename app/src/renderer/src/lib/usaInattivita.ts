import { useEffect, useRef } from 'react'
import type { Api } from './api'

/** Dopo quanto silenzio si e' inattivi. */
const SILENZIO_MS = 10 * 60 * 1000

/** Ogni quanto si guarda l'orologio. Mezzo minuto: la soglia e' dieci. */
const CONTROLLO_MS = 30_000

/**
 * Ogni quanto si ridice al server la stessa cosa.
 *
 * Serve alla riconnessione: il server dimentica l'inattivita' quando il flusso
 * si chiude — giustamente, perche' chi chiude l'applicazione diventa offline e
 * non "inattivo da ieri sera". Ma un flusso puo' cadere e riaprirsi da solo, e
 * in quel caso chi era fermo tornerebbe "online" senza aver toccato niente.
 * Ripeterlo ogni tanto lo rimette a posto senza che nessuno debba accorgersene.
 */
const RIPETIZIONE_MS = 4 * 60 * 1000

/**
 * "Sono qui, ma sono fermo".
 *
 * Inattivo non si sceglie piu' da un menu — dire "non sono davanti allo
 * schermo" premendo un pulsante era una contraddizione, e infatti quel
 * pulsante non lo usava nessuno. Adesso lo decide questa funzione, e la regola
 * e' il microfono: dieci minuti con il microfono spento, o acceso ma sempre
 * sotto la soglia dell'automute, e si e' fermi.
 *
 * Il "sotto la soglia" non si misura qui e non serve misurarlo: `parla` e' gia'
 * il risultato di quel confronto — e' lo stesso segnale che accende il bordo
 * verde attorno a chi sta parlando, e nasce dal livello del microfono contro la
 * soglia scelta nelle impostazioni. Ricalcolarlo vorrebbe dire due idee diverse
 * di cosa sia "parlare", e prima o poi una delle due sbaglia.
 *
 * Non guarda mouse e tastiera. E' voluto, ed e' la regola che e' stata chiesta:
 * l'inattivita' qui dentro riguarda la voce, non la presenza fisica. Chi legge
 * la chat per venti minuti senza mai accendere il microfono risulta inattivo, ed
 * e' corretto — a chi lo cerca per parlare interessa sapere proprio quello.
 */
export function usaInattivita(api: Api | null, parla: boolean): void {
  const ultimaVoce = useRef(Date.now())
  const dichiarato = useRef<boolean | null>(null)
  const quandoDetto = useRef(0)

  // Ogni istante in cui si parla azzera il conto. Sta in un ref e non nello
  // stato: il conto va aggiornato sessanta volte al minuto e non deve
  // ridisegnare niente.
  if (parla) ultimaVoce.current = Date.now()

  useEffect(() => {
    if (!api) return

    const guarda = (): void => {
      const fermo = Date.now() - ultimaVoce.current >= SILENZIO_MS
      const cambiato = dichiarato.current !== fermo
      const scaduto = Date.now() - quandoDetto.current >= RIPETIZIONE_MS
      if (!cambiato && !scaduto) return

      dichiarato.current = fermo
      quandoDetto.current = Date.now()
      void api.dichiaraInattivita(fermo).catch(() => {
        // Il server non risponde: si riprova al giro dopo. Un'inattivita' non
        // consegnata non e' un errore da mostrare a nessuno.
        dichiarato.current = null
      })
    }

    const battito = window.setInterval(guarda, CONTROLLO_MS)
    return () => window.clearInterval(battito)
  }, [api])
}
