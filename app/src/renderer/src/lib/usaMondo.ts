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
 *
 * Con un'eccezione, e vale la pena dire perche'. I **non letti** non si
 * rileggono: si contano qui. Erano l'unica cosa dell'elenco che cambiava di
 * continuo senza che cambiasse la struttura, e il server non aveva nessun
 * motivo di annunciare `spazi` per un numero — quindi il numero blu si
 * accendeva quando capitava e non si spegneva mai. Adesso il messaggio che
 * arriva lo alza, l'evento `letto` lo azzera, e la lettura da `GET /api/spazi`
 * resta la verita' a cui si torna a ogni ricaricamento.
 */
export function usaMondo(api: Api | null): {
  spazi: Spazio[] | null
  errore: string | null
  ricarica: () => void
  iscrivi: (callback: (evento: Evento) => void) => () => void
  /**
   * Il canale che si sta guardando adesso, se e' di testo.
   *
   * Chi disegna lo aggiorna a ogni cambio. Serve a non far lampeggiare un "1"
   * sul canale aperto: il messaggio arriva, il conteggio si alzerebbe, e un
   * istante dopo la lettura lo riazzererebbe. Saperlo qui evita il lampo
   * invece di rincorrerlo.
   */
  inLettura: React.MutableRefObject<number | null>
} {
  const [spazi, setSpazi] = useState<Spazio[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const iscritti = useRef(new Set<(evento: Evento) => void>())
  const inLettura = useRef<number | null>(null)

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

  /**
   * Cambiando server si riparte da zero, non dall'elenco di prima.
   *
   * `ricarica` cambia identita' solo quando cambia l'API, cioe' solo quando
   * cambia l'indirizzo o il token: e' esattamente il momento in cui gli spazi
   * di prima smettono di esistere. Senza questo azzeramento restavano
   * disegnati finche' non arrivava la risposta del server nuovo, e per un
   * istante si vedevano i canali di casa sotto il nome dell'ufficio.
   */
  useEffect(() => {
    setSpazi(null)
    ricarica()
  }, [ricarica])

  /** Cambia il conteggio di un canale solo, lasciando intatto tutto il resto. */
  const contaNonLetti = useCallback((canale: number, quanti: (prima: number) => number) => {
    setSpazi((prima) => {
      if (!prima) return prima
      let toccato = false
      const dopo = prima.map((spazio) => {
        if (!spazio.canali.some((c) => c.id === canale)) return spazio
        return {
          ...spazio,
          canali: spazio.canali.map((c) => {
            if (c.id !== canale) return c
            const nuovo = Math.max(0, quanti(c.nonLetti))
            if (nuovo === c.nonLetti) return c
            toccato = true
            return { ...c, nonLetti: nuovo }
          })
        }
      })
      // Senza questo controllo ogni evento sostituirebbe l'elenco con uno
      // equivalente, e mezza interfaccia si ridisegnerebbe per un numero che
      // non e' cambiato.
      return toccato ? dopo : prima
    })
  }, [])

  useEffect(() => {
    if (!api) return

    return api.flusso(
      (evento) => {
        // La struttura cambia di rado, e quando cambia la si rilegge tutta
        // invece di applicare la modifica in locale: un elenco ricostruito dal
        // server non puo' divergere da quello che il server ha davvero.
        if (evento.tipo === 'spazi' || evento.tipo === 'presenza') ricarica()

        // I conteggi invece si muovono a ogni frase detta da chiunque, e
        // rileggere tutto per uno non sarebbe sostenibile.
        if (evento.tipo === 'messaggio' && !evento.diretto) {
          if (evento.canale !== inLettura.current) {
            contaNonLetti(evento.canale, (prima) => prima + 1)
          }
        } else if (evento.tipo === 'letto' && !evento.diretto) {
          contaNonLetti(evento.canale, () => 0)
        } else if (evento.tipo === 'letto-spazio') {
          setSpazi((prima) =>
            prima?.map((spazio) =>
              spazio.id === evento.spazio
                ? { ...spazio, canali: spazio.canali.map((c) => ({ ...c, nonLetti: 0 })) }
                : spazio
            ) ?? prima
          )
        }

        for (const iscritto of iscritti.current) iscritto(evento)
      },
      (e) => setErrore(`${e.message} Riprovo…`)
    )
  }, [api, ricarica, contaNonLetti])

  const iscrivi = useCallback((callback: (evento: Evento) => void) => {
    iscritti.current.add(callback)
    return () => {
      iscritti.current.delete(callback)
    }
  }, [])

  return { spazi, errore, ricarica, iscrivi, inLettura }
}
