import { useCallback, useEffect, useRef, useState } from 'react'
import type { Evento, Spazio } from '@shared/tipi'
import type { Api } from './api'

/**
 * Cosa c'e' e cosa succede.
 *
 * Un flusso solo per tutta l'applicazione, aperto qui e distribuito a chi lo
 * vuole. Aprirne uno per schermata sarebbe piu' comodo da scrivere e molto
 * peggio da usare: cambiando canale si chiuderebbe e riaprirebbe la
 * connessione, e nei due secondi in mezzo si perderebbe cio' che arriva.
 *
 * Gli eventi strutturali (`spazi`, `presenza`) li gestisce direttamente questo
 * hook, ricaricando l'elenco. Quelli sui messaggi li passa a chi si e'
 * iscritto — cioe' alla schermata del canale aperto, che sa cosa farne.
 */
export function usaMondo(api: Api | null): {
  spazi: Spazio[] | null
  errore: string | null
  ricarica: () => void
  iscrivi: (callback: (evento: Evento) => void) => () => void
} {
  const [spazi, setSpazi] = useState<Spazio[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const iscritti = useRef(new Set<(evento: Evento) => void>())

  const ricarica = useCallback(() => {
    if (!api) return
    void api
      .spazi()
      .then(({ spazi }) => {
        setSpazi(spazi)
        setErrore(null)
      })
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  useEffect(ricarica, [ricarica])

  useEffect(() => {
    if (!api) return

    return api.flusso(
      (evento) => {
        // La struttura cambia di rado, e quando cambia la si rilegge tutta
        // invece di applicare la modifica in locale: un elenco ricostruito dal
        // server non puo' divergere da quello che il server ha davvero.
        if (evento.tipo === 'spazi' || evento.tipo === 'presenza') ricarica();

        for (const iscritto of iscritti.current) iscritto(evento)
      },
      (e) => setErrore(`${e.message} Riprovo…`)
    )
  }, [api, ricarica])

  const iscrivi = useCallback((callback: (evento: Evento) => void) => {
    iscritti.current.add(callback)
    return () => {
      iscritti.current.delete(callback)
    }
  }, [])

  return { spazi, errore, ricarica, iscrivi }
}
