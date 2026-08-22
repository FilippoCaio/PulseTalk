import { useCallback, useEffect, useRef, useState } from 'react'
import type { Evento, SessioneMedia } from '@shared/tipi'
import type { Api } from './api'
import { suona } from './suoni'

/**
 * Le sessioni condivise di un canale, e l'orologio su cui vanno a tempo.
 *
 * Il problema vero non e' mandare "play": e' che due computer non sanno che ora
 * e'. Un orologio di Windows puo' essere avanti di secondi rispetto a un altro,
 * e "riparti dal minuto 1:32" detto alle 20:04:11 di chi lo dice non vuol dire
 * niente per chi lo riceve alle 20:04:08 delle sue.
 *
 * Quindi si misura lo scarto. Si chiede l'ora al server tre volte, si tiene la
 * risposta arrivata piu' in fretta — quella con meno strada in mezzo, e quindi
 * meno errore — e da li' in poi `oraServer()` restituisce l'ora di casa. Tutti
 * i calcoli passano da li'.
 *
 * La posizione attesa e' una sottrazione: `posizioneMs + (adesso - aggiornato)`
 * mentre suona, `posizioneMs` fermo. Il server manda entrambi i numeri proprio
 * perche' questa sottrazione si possa fare da qualunque parte.
 */
export interface SessioniMedia {
  sessioni: SessioneMedia[]
  puoComandare: boolean
  errore: string | null
  /** L'ora del server, adesso, in millisecondi. */
  oraServer: () => number
  /** Dove dovrebbe essere la riproduzione di questa sessione, adesso. */
  posizioneAttesa: (sessione: SessioneMedia) => number
  ricarica: () => void
  apri: (tipo: 'youtube' | 'musica', provider?: string) => Promise<void>
  chiudi: (id: number) => Promise<void>
  comanda: (id: number, comando: ComandoMedia) => Promise<void>
  accoda: (id: number, voce: { riferimento: string; titolo?: string; durata?: number | null }) => Promise<void>
  togliDallaCoda: (id: number, voce: number) => Promise<void>
}

export type ComandoMedia = Parameters<Api['comandoMedia']>[1]

/**
 * Ogni quanto si ricontrolla lo stato anche se non e' successo niente.
 *
 * Gli eventi possono perdersi durante una riconnessione, e una sessione che
 * resta indietro di venti secondi senza accorgersene e' peggio di una richiesta
 * ogni quindici. E' anche il modo in cui chi arriva a meta' si mette in pari
 * senza che nessuno debba premere niente.
 */
const RISINCRONIA_MS = 15_000

/** Ogni quanto si rimisura lo scarto fra il proprio orologio e quello del server. */
const OROLOGIO_MS = 5 * 60_000

export function usaSessioniMedia(
  api: Api | null,
  canale: number | null,
  iscrivi: (c: (e: Evento) => void) => () => void
): SessioniMedia {
  const [sessioni, setSessioni] = useState<SessioneMedia[]>([])
  const [puoComandare, setPuoComandare] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  /** Quanto il server e' avanti rispetto a questo computer, in millisecondi. */
  const scarto = useRef(0)
  /** Il giro di andata e ritorno della misura migliore finora. */
  const migliore = useRef(Number.POSITIVE_INFINITY)

  const oraServer = useCallback(() => Date.now() + scarto.current, [])

  // -- L'orologio -------------------------------------------------------------

  useEffect(() => {
    if (!api) return
    let vivo = true

    const misura = async (): Promise<void> => {
      for (let i = 0; i < 3 && vivo; i++) {
        const partito = Date.now()
        try {
          const { adesso } = await api.tempo()
          const giro = Date.now() - partito
          // Si tiene solo la misura piu' rapida: su una risposta che ha
          // impiegato mezzo secondo non si sa quanto di quel mezzo secondo sia
          // andata e quanto ritorno, e indovinarlo introduce l'errore che si
          // sta cercando di togliere.
          if (giro < migliore.current) {
            migliore.current = giro
            scarto.current = adesso + giro / 2 - Date.now()
          }
        } catch {
          // Senza orologio del server si va con il proprio: le sessioni
          // restano usabili, solo un po' meno precise.
          return
        }
      }
    }

    void misura()
    // Si rimisura ogni tanto: gli orologi derivano, e una sessione lasciata
    // aperta per due ore lo mostrerebbe.
    const battito = setInterval(() => {
      migliore.current = Number.POSITIVE_INFINITY
      void misura()
    }, OROLOGIO_MS)

    return () => {
      vivo = false
      clearInterval(battito)
    }
  }, [api])

  // -- Lo stato ---------------------------------------------------------------

  const ricarica = useCallback(() => {
    if (!api || canale === null) {
      setSessioni([])
      setPuoComandare(false)
      return
    }
    void api
      .sessioniMedia(canale)
      .then((r) => {
        setSessioni(r.sessioni)
        setPuoComandare(r.puoComandare)
        setErrore(null)
      })
      .catch((e) => setErrore((e as Error).message))
  }, [api, canale])

  useEffect(ricarica, [ricarica])

  useEffect(() => {
    if (canale === null) return
    return iscrivi((evento) => {
      if (evento.tipo !== 'media' || evento.canale !== canale) return

      // L'evento porta con se' l'ora del server: e' l'occasione per correggere
      // lo scarto senza fare una richiesta apposta. Non sostituisce la misura
      // vera — di un evento non si sa quanta strada abbia fatto — ma se lo
      // scarto stimato e' assurdo, questo lo riporta nell'ordine di grandezza.
      const scartoStimato = evento.adesso - Date.now()
      if (Math.abs(scartoStimato - scarto.current) > 5000) scarto.current = scartoStimato

      setSessioni((prima) => {
        if (evento.chiusa) {
          // Il suono solo se quella sessione c'era davvero: un evento di
          // chiusura puo' arrivare due volte — una dalla risposta e una dal
          // flusso — e due note identiche a mezzo secondo l'una dall'altra si
          // sentono come un difetto.
          if (prima.some((s) => s.id === evento.chiusa)) suona('insiemeFinito')
          return prima.filter((s) => s.id !== evento.chiusa)
        }
        if (!evento.sessione) return prima
        const senza = prima.filter((s) => s.id !== evento.sessione!.id)
        if (senza.length === prima.length) suona('insiemeIniziato')
        return [...senza, evento.sessione]
      })
    })
  }, [iscrivi, canale])

  // La risincronizzazione periodica: rilegge lo stato anche in silenzio.
  useEffect(() => {
    if (!api || canale === null) return
    const battito = setInterval(ricarica, RISINCRONIA_MS)
    return () => clearInterval(battito)
  }, [api, canale, ricarica])

  // -- I comandi --------------------------------------------------------------

  const conErrore = useCallback(async (fare: () => Promise<unknown>): Promise<void> => {
    setErrore(null)
    try {
      await fare()
    } catch (e) {
      setErrore((e as Error).message)
    }
  }, [])

  const posizioneAttesa = useCallback(
    (sessione: SessioneMedia): number => {
      const stato = sessione.stato
      const base = Number(stato.posizioneMs ?? 0)
      if (!stato.inRiproduzione) return base
      const passato = Math.max(0, oraServer() - Number(stato.aggiornato ?? oraServer()))
      const avanti = base + passato * Number(stato.velocita ?? 1)
      const durata = Number(stato.durataMs ?? 0)
      return durata > 0 ? Math.min(avanti, durata) : avanti
    },
    [oraServer]
  )

  return {
    sessioni,
    puoComandare,
    errore,
    oraServer,
    posizioneAttesa,
    ricarica,

    apri: (tipo, provider) =>
      conErrore(async () => {
        if (!api || canale === null) return
        const r = await api.apriSessioneMedia(canale, tipo, provider)
        setSessioni((prima) => [...prima.filter((s) => s.id !== r.sessione.id), r.sessione])
      }),

    chiudi: (id) =>
      conErrore(async () => {
        if (!api) return
        await api.chiudiSessioneMedia(id)
        setSessioni((prima) => prima.filter((s) => s.id !== id))
      }),

    comanda: (id, comando) =>
      conErrore(async () => {
        if (!api) return
        const r = await api.comandoMedia(id, comando)
        // Si applica subito la risposta invece di aspettare l'evento: chi
        // preme deve vedere il proprio comando fare effetto nello stesso
        // istante, non fra un giro di rete.
        setSessioni((prima) => prima.map((s) => (s.id === id ? r.sessione : s)))
      }),

    accoda: (id, voce) =>
      conErrore(async () => {
        if (!api) return
        await api.accodaMedia(id, voce)
      }),

    togliDallaCoda: (id, voce) =>
      conErrore(async () => {
        if (!api) return
        await api.togliDallaCoda(id, voce)
      })
  }
}
