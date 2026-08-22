import { useCallback, useEffect, useRef, useState } from 'react'
import type { Canale, Evento, Messaggio, Ricevute } from '@shared/tipi'
import type { Api } from './api'

/**
 * I messaggi di un canale.
 *
 * Lo storico si carica a pagine, dal fondo verso l'alto, e i messaggi nuovi
 * arrivano sul flusso degli eventi invece che con una richiesta. Cambiare
 * canale butta via tutto e ricomincia: tenere in memoria lo storico di venti
 * canali per il caso in cui si torni indietro costa piu' di quanto valga.
 */
export function usaChat(
  api: Api | null,
  canale: Canale | null,
  iscrivi: (callback: (evento: Evento) => void) => () => void
): {
  messaggi: Messaggio[]
  altri: boolean
  caricando: boolean
  errore: string | null
  /** Le due spunte, solo nelle conversazioni dirette. */
  ricevute: Ricevute | null
  risaliDiUnaPagina: () => void
  manda: (dati: { testo?: string; rispondeA?: number | null; allegati?: number[] }) => Promise<void>
  modifica: (id: number, testo: string) => Promise<void>
  elimina: (id: number) => Promise<void>
  reagisci: (id: number, emoji: string) => Promise<void>
} {
  const [messaggi, setMessaggi] = useState<Messaggio[]>([])
  const [altri, setAltri] = useState(false)
  const [caricando, setCaricando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  /**
   * Fin dove e' arrivato, e fin dove ha letto, chi sta dall'altra parte.
   *
   * `null` quando la domanda non ha senso: in un canale di spazio "gli e'
   * arrivato" non vuol dire niente — arrivato a chi, dei quaranta? — e infatti
   * il server lo manda solo per le conversazioni dirette.
   */
  const [ricevute, setRicevute] = useState<Ricevute | null>(null)

  // L'ultimo messaggio che abbiamo segnato come letto. Serve a non ripetere la
  // stessa chiamata a ogni ridisegno.
  const lettoFino = useRef(0)

  /**
   * Il canale si riconosce dal suo id, non dall'oggetto che lo descrive.
   *
   * Chi chiama questo hook costruisce quell'oggetto a ogni render — per le
   * conversazioni dirette e' un canale finto messo insieme sul momento, per i
   * canali veri e' una voce dentro a un elenco che si rilegge a ogni evento del
   * server. In entrambi i casi l'identita' cambia in continuazione mentre il
   * canale resta lo stesso, e legare gli effetti a quell'identita' voleva dire
   * rifare tutto da capo per niente: la pagina di messaggi richiesta di nuovo,
   * l'elenco sostituito da uno equivalente, le spunte azzerate e ridisegnate.
   * E' lo sfarfallio che si vedeva nei diretti, dove gli eventi arrivano di
   * continuo — ogni "e' entrato", ogni "sta scrivendo".
   *
   * Peggio del tremolio c'era un giro che si alimentava da solo: rileggendo i
   * messaggi `lettoFino` tornava a zero, quindi si rimandava "letto fin qui",
   * il server rispondeva annunciando le ricevute, l'evento faceva ridisegnare,
   * e si ricominciava.
   *
   * Quello che cambia dentro all'oggetto e non e' l'id — il nome, i non letti,
   * l'argomento — riguarda chi lo disegna, e arriva li' comunque: non e' roba
   * per cui ricaricare la conversazione.
   */
  const idCanale = canale?.id ?? null

  // -- La prima pagina, a ogni cambio di canale ------------------------------

  useEffect(() => {
    if (!api || !idCanale) {
      setMessaggi([])
      setAltri(false)
      return
    }

    let valido = true
    setCaricando(true)
    setErrore(null)
    lettoFino.current = 0
    setRicevute(null)

    void api
      .messaggi(idCanale, { quanti: 50 })
      .then(({ messaggi, altri, ricevute }) => {
        if (!valido) return
        setMessaggi(messaggi)
        setAltri(altri)
        setRicevute(ricevute ?? null)
      })
      .catch((e) => valido && setErrore((e as Error).message))
      .finally(() => valido && setCaricando(false))

    return () => {
      // Cambiare canale mentre la pagina sta arrivando non deve far comparire
      // i messaggi di quello vecchio dentro a quello nuovo.
      valido = false
    }
  }, [api, idCanale])

  // -- Quello che arriva dal flusso ------------------------------------------

  useEffect(() => {
    if (!idCanale) return

    return iscrivi((evento) => {
      if (!('canale' in evento) || evento.canale !== idCanale) return

      if (evento.tipo === 'messaggio') {
        setMessaggi((prima) =>
          // Il proprio messaggio e' gia' stato aggiunto quando la POST e'
          // tornata: senza questo controllo comparirebbe due volte.
          prima.some((m) => m.id === evento.messaggio.id) ? prima : [...prima, evento.messaggio]
        )
      } else if (evento.tipo === 'messaggio-modificato') {
        setMessaggi((prima) => prima.map((m) => (m.id === evento.messaggio.id ? evento.messaggio : m)))
      } else if (evento.tipo === 'messaggio-eliminato') {
        setMessaggi((prima) =>
          prima.map((m) => (m.id === evento.id ? { ...m, eliminato: true, testo: '', allegati: [], reazioni: [] } : m))
        )
      } else if (evento.tipo === 'ricevute') {
        setRicevute(evento.ricevute)
      } else if (evento.tipo === 'reazioni') {
        setMessaggi((prima) =>
          prima.map((m) => (m.id === evento.messaggio ? { ...m, reazioni: evento.reazioni } : m))
        )
      }
    })
  }, [idCanale, iscrivi])

  // -- Segnare come letto ----------------------------------------------------

  useEffect(() => {
    if (!api || !idCanale || messaggi.length === 0) return

    const ultimo = messaggi[messaggi.length - 1].id
    if (ultimo <= lettoFino.current) return
    lettoFino.current = ultimo

    void api.segnaLetto(idCanale, ultimo).catch(() => {
      // Un pallino di non letti che resta acceso e' fastidioso, non grave:
      // non vale un errore in faccia a chi sta leggendo.
    })
  }, [api, idCanale, messaggi])

  // -- Le azioni -------------------------------------------------------------

  const risaliDiUnaPagina = useCallback(() => {
    if (!api || !idCanale || caricando || !altri || messaggi.length === 0) return
    setCaricando(true)
    void api
      .messaggi(idCanale, { prima: messaggi[0].id, quanti: 50 })
      .then((piu) => {
        setMessaggi((prima) => [...piu.messaggi, ...prima])
        setAltri(piu.altri)
      })
      .catch((e) => setErrore((e as Error).message))
      .finally(() => setCaricando(false))
  }, [api, idCanale, caricando, altri, messaggi])

  const manda = useCallback(
    async (dati: { testo?: string; rispondeA?: number | null; allegati?: number[] }) => {
      if (!api || !idCanale) return
      const { messaggio } = await api.scrivi(idCanale, dati)
      // Si aggiunge subito, senza aspettare il proprio evento dal flusso: chi
      // scrive deve vedere il messaggio comparire nell'istante in cui preme
      // Invio, non dopo un giro di rete.
      setMessaggi((prima) => (prima.some((m) => m.id === messaggio.id) ? prima : [...prima, messaggio]))
    },
    [api, idCanale]
  )

  const modifica = useCallback(
    async (id: number, testo: string) => {
      if (!api) return
      const { messaggio } = await api.modificaMessaggio(id, testo)
      setMessaggi((prima) => prima.map((m) => (m.id === id ? messaggio : m)))
    },
    [api]
  )

  const elimina = useCallback(
    async (id: number) => {
      if (!api) return
      await api.eliminaMessaggio(id)
      setMessaggi((prima) =>
        prima.map((m) => (m.id === id ? { ...m, eliminato: true, testo: '', allegati: [], reazioni: [] } : m))
      )
    },
    [api]
  )

  const reagisci = useCallback(
    async (id: number, emoji: string) => {
      if (!api) return
      const { reazioni } = await api.reagisci(id, emoji)
      setMessaggi((prima) => prima.map((m) => (m.id === id ? { ...m, reazioni } : m)))
    },
    [api]
  )

  return {
    messaggi,
    altri,
    caricando,
    errore,
    ricevute,
    risaliDiUnaPagina,
    manda,
    modifica,
    elimina,
    reagisci
  }
}
