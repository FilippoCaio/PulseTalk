import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chiamata, Conversazione, Evento } from '@shared/tipi'
import type { Api } from './api'
import { suona } from './suoni'

/**
 * Le conversazioni dirette e il telefono che ci sta dentro.
 *
 * Un hook solo per due cose che sembrano diverse e non lo sono: entrambe
 * vivono fuori da qualunque schermata. Una chiamata deve poter squillare
 * mentre si sta leggendo un canale di un altro server, e l'elenco dei messaggi
 * diretti deve aggiornarsi anche quando quella colonna non e' aperta —
 * altrimenti il pallino rosso comparirebbe solo andando a guardare.
 *
 * Nessuna richiesta periodica: l'elenco si rilegge quando il server dice che e'
 * cambiato qualcosa. Gli eventi delle chiamate arrivano dallo stesso flusso di
 * tutto il resto, quindi non c'e' una seconda connessione da tenere aperta ne'
 * una seconda riconnessione da scrivere.
 */
export interface Diretti {
  conversazioni: Conversazione[]
  /** Quanti messaggi diretti aspettano una risposta, in tutto. */
  nonLetti: number
  errore: string | null
  ricarica: () => void
  apriCon: (utente: number) => Promise<Conversazione | null>

  /** La chiamata di adesso: che stia squillando o che sia in corso. */
  chiamata: Chiamata | null
  /** Perche' l'ultima chiamata e' finita. Sparisce da solo dopo qualche secondo. */
  finita: { chiamata: Chiamata; motivo: 'chiusa' | 'rifiutata' | 'persa' } | null
  scartaFinita: () => void
  segnaChiamata: (chiamata: Chiamata | null) => void
}

export function usaDiretti(api: Api | null, io: number | null, iscrivi: (c: (e: Evento) => void) => () => void): Diretti {
  const [conversazioni, setConversazioni] = useState<Conversazione[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [chiamata, setChiamata] = useState<Chiamata | null>(null)
  const [finita, setFinita] = useState<Diretti['finita']>(null)

  // Il suono dello squillo va fatto una volta sola per chiamata: gli eventi
  // possono ripetersi dopo una riconnessione, e tre squilli per la stessa
  // telefonata sembrano tre telefonate.
  const suonata = useRef<number | null>(null)

  const ricarica = useCallback(() => {
    if (!api) return
    void api
      .diretti()
      .then((r) => {
        setConversazioni(r.conversazioni)
        setErrore(null)
      })
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  useEffect(ricarica, [ricarica])

  useEffect(() => {
    return iscrivi((evento) => {
      switch (evento.tipo) {
        case 'diretti':
          ricarica()
          break

        // Qualcuno e' comparso o sparito: nell'elenco cambia solo un pallino,
        // ma quel pallino e' il motivo per cui si guarda l'elenco prima di
        // scrivere a qualcuno.
        case 'stato-utente':
          ricarica()
          break

        // Un messaggio diretto cambia due cose nell'elenco: l'ultima riga e il
        // conteggio dei non letti. Si rilegge invece di applicarlo a mano —
        // l'elenco ricostruito dal server non puo' divergere da quello che il
        // server ha davvero, e sono poche righe.
        case 'messaggio':
        case 'messaggio-eliminato':
          if (evento.diretto) ricarica()
          break

        case 'chiamata-arriva':
          setFinita(null)
          setChiamata(evento.chiamata)
          if (evento.chiamata.a === io && suonata.current !== evento.conversazione) {
            suonata.current = evento.conversazione
            suona('altroEntrato')
          }
          break

        case 'chiamata-risposta':
          setChiamata(evento.chiamata)
          break

        case 'chiamata-finita':
          suonata.current = null
          setChiamata(null)
          // Persa e rifiutata vanno dette; chiusa da uno dei due la sa gia'
          // chi ha premuto, e l'altro se ne accorge dal riquadro che sparisce.
          setFinita(
            evento.motivo === 'chiusa' && evento.chiusaDa === io
              ? null
              : { chiamata: evento.chiamata, motivo: evento.motivo }
          )
          break

        default:
          break
      }
    })
  }, [iscrivi, ricarica, io])

  // L'avviso di chiamata persa non resta li' per sempre: dopo otto secondi ha
  // gia' detto quello che doveva.
  useEffect(() => {
    if (!finita) return
    const via = setTimeout(() => setFinita(null), 8000)
    return () => clearTimeout(via)
  }, [finita])

  const apriCon = useCallback(
    async (utente: number): Promise<Conversazione | null> => {
      if (!api) return null
      const gia = conversazioni.find((c) => c.con.id === utente)
      if (gia) return gia
      const { conversazione } = await api.apriConversazione({ utente })
      ricarica()
      return conversazione
    },
    [api, conversazioni, ricarica]
  )

  return {
    conversazioni,
    nonLetti: conversazioni.reduce((somma, c) => somma + c.nonLetti, 0),
    errore,
    ricarica,
    apriCon,
    chiamata,
    finita,
    scartaFinita: () => setFinita(null),
    segnaChiamata: setChiamata
  }
}
