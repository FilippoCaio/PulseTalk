import { useCallback, useEffect, useRef, useState } from 'react'
import type { Canale, Evento, Messaggio } from '@shared/tipi'
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

  // L'ultimo messaggio che abbiamo segnato come letto. Serve a non ripetere la
  // stessa chiamata a ogni ridisegno.
  const lettoFino = useRef(0)

  // -- La prima pagina, a ogni cambio di canale ------------------------------

  useEffect(() => {
    if (!api || !canale || canale.tipo !== 'testo') {
      setMessaggi([])
      setAltri(false)
      return
    }

    let valido = true
    setCaricando(true)
    setErrore(null)
    lettoFino.current = 0

    void api
      .messaggi(canale.id, { quanti: 50 })
      .then(({ messaggi, altri }) => {
        if (!valido) return
        setMessaggi(messaggi)
        setAltri(altri)
      })
      .catch((e) => valido && setErrore((e as Error).message))
      .finally(() => valido && setCaricando(false))

    return () => {
      // Cambiare canale mentre la pagina sta arrivando non deve far comparire
      // i messaggi di quello vecchio dentro a quello nuovo.
      valido = false
    }
  }, [api, canale])

  // -- Quello che arriva dal flusso ------------------------------------------

  useEffect(() => {
    if (!canale) return

    return iscrivi((evento) => {
      if (!('canale' in evento) || evento.canale !== canale.id) return

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
      } else if (evento.tipo === 'reazioni') {
        setMessaggi((prima) =>
          prima.map((m) => (m.id === evento.messaggio ? { ...m, reazioni: evento.reazioni } : m))
        )
      }
    })
  }, [canale, iscrivi])

  // -- Segnare come letto ----------------------------------------------------

  useEffect(() => {
    if (!api || !canale || canale.tipo !== 'testo' || messaggi.length === 0) return

    const ultimo = messaggi[messaggi.length - 1].id
    if (ultimo <= lettoFino.current) return
    lettoFino.current = ultimo

    void api.segnaLetto(canale.id, ultimo).catch(() => {
      // Un pallino di non letti che resta acceso e' fastidioso, non grave:
      // non vale un errore in faccia a chi sta leggendo.
    })
  }, [api, canale, messaggi])

  // -- Le azioni -------------------------------------------------------------

  const risaliDiUnaPagina = useCallback(() => {
    if (!api || !canale || caricando || !altri || messaggi.length === 0) return
    setCaricando(true)
    void api
      .messaggi(canale.id, { prima: messaggi[0].id, quanti: 50 })
      .then((piu) => {
        setMessaggi((prima) => [...piu.messaggi, ...prima])
        setAltri(piu.altri)
      })
      .catch((e) => setErrore((e as Error).message))
      .finally(() => setCaricando(false))
  }, [api, canale, caricando, altri, messaggi])

  const manda = useCallback(
    async (dati: { testo?: string; rispondeA?: number | null; allegati?: number[] }) => {
      if (!api || !canale) return
      const { messaggio } = await api.scrivi(canale.id, dati)
      // Si aggiunge subito, senza aspettare il proprio evento dal flusso: chi
      // scrive deve vedere il messaggio comparire nell'istante in cui preme
      // Invio, non dopo un giro di rete.
      setMessaggi((prima) => (prima.some((m) => m.id === messaggio.id) ? prima : [...prima, messaggio]))
    },
    [api, canale]
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

  return { messaggi, altri, caricando, errore, risaliDiUnaPagina, manda, modifica, elimina, reagisci }
}
