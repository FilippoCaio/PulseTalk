import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from './api'
import type { GenereRestrizione, Restrizione } from '@shared/tipi'

/**
 * Chi, in quale canale vocale, ha addosso cosa.
 *
 * Uno stato solo per tutta l'applicazione, e lo guardano in tre: il menu del
 * tasto destro su un riquadro, il pannellino sulla persona nella colonna dei
 * canali, e la riga che chi subisce una restrizione si vede scritta addosso.
 * Tre copie dello stesso elenco avrebbero prodotto tre risposte leggermente
 * diverse alla stessa domanda, che e' peggio di nessuna risposta.
 *
 * Tiene piu' di un canale, e non e' generalita' gratuita: la colonna dei canali
 * mostra le persone di **tutti** i vocali, non solo di quello in cui si sta
 * parlando, e chi ha il diritto di moderare deve poterlo fare da li'. Con un
 * canale solo, aprire il pannellino su una stanza in cui non si e' entrati
 * avrebbe mostrato ogni interruttore spento — cioe' "riattiva" scritto sopra a
 * un microfono gia' bloccato.
 *
 * Quello in cui si sta parlando si carica da solo; gli altri si chiedono
 * quando servono, con `assicura`, e una volta sola. Da li' in poi si muovono
 * con gli eventi: il server manda il cambiamento a chi sta nella stanza, e non
 * c'e' niente da ricontrollare a intervalli.
 */
export interface Restrizioni {
  /** Chi ha cosa, in questo canale. Vuota anche quando non si sa ancora. */
  per: (canale: number | null) => Map<number, Restrizione[]>
  /** Le proprie nel canale in cui si sta parlando: quelle da mostrare a chi legge. */
  mie: Restrizione[]
  /** Comodita' per il caso piu' frequente: "questa persona ce l'ha?". */
  ha: (canale: number, utente: number, genere: GenereRestrizione) => boolean
  /**
   * Fa in modo che le restrizioni di questo canale siano state chieste.
   *
   * Idempotente e silenziosa: chiamarla a ogni apertura del pannellino non
   * produce una richiesta a ogni apertura.
   */
  assicura: (canale: number | null) => void
  /**
   * Impone o toglie. L'errore torna al chiamante invece di finire in uno stato
   * qui dentro: chi ha premuto e' l'unico che deve leggerlo, e sa gia' dove
   * mostrarlo.
   */
  imponi: (
    canale: number,
    utente: number,
    genere: GenereRestrizione,
    attiva: boolean
  ) => Promise<void>
}

const VUOTA: Map<number, Restrizione[]> = new Map()

export function usaRestrizioni(
  api: Api | null,
  /** Il canale in cui si sta parlando adesso, se ce n'e' uno. */
  inVoce: number | null,
  io: number | null,
  /** Il flusso degli eventi dell'applicazione, gia' aperto da chi sta sopra. */
  iscrivi: (callback: (evento: { tipo: string } & Record<string, unknown>) => void) => () => void,
  /** Quelle proprie arrivate con l'ingresso: si mostrano senza aspettare la lettura. */
  iniziali?: Restrizione[]
): Restrizioni {
  /** canale -> utente -> le sue. */
  const [per, setPer] = useState<Map<number, Map<number, Restrizione[]>>>(new Map())
  /** A quali canali si e' gia' chiesto, per non richiederlo a ogni apertura. */
  const chiesti = useRef<Set<number>>(new Set())

  // Cambiare server vuol dire che tutto quello che si sapeva non vale piu'.
  useEffect(() => {
    chiesti.current = new Set()
    setPer(new Map())
  }, [api])

  const carica = useCallback(
    (canale: number | null) => {
      if (!api || !canale) return
      if (chiesti.current.has(canale)) return
      chiesti.current.add(canale)

      void api
        .restrizioni(canale)
        .then(({ restrizioni }) => {
          setPer((prima) => {
            const dopo = new Map(prima)
            dopo.set(canale, new Map(restrizioni.map((r) => [r.utente, r.sue])))
            return dopo
          })
        })
        .catch(() => {
          // Un canale di testo, un server piu' vecchio, la rete che cade: qui
          // non c'e' niente da dire a nessuno. Si riprovera' alla prossima
          // apertura, e nel frattempo il server continua a farle rispettare
          // comunque — e' lui che decide, non questo elenco.
          chiesti.current.delete(canale)
        })
    },
    [api]
  )

  // Quello in cui si sta parlando si carica da solo: li' le restrizioni si
  // vedono addosso alle persone senza che nessuno apra niente.
  useEffect(() => carica(inVoce), [carica, inVoce])

  // Le proprie arrivano gia' con il gettone. Metterle subito evita l'istante in
  // cui si entra con il microfono bloccato e l'interfaccia dice che e' tutto a
  // posto — un istante corto, e sufficiente a far premere il pulsante.
  useEffect(() => {
    if (!io || !inVoce || !iniziali?.length) return
    setPer((prima) => {
      const dopo = new Map(prima)
      const suo = new Map(dopo.get(inVoce) ?? [])
      suo.set(io, iniziali)
      dopo.set(inVoce, suo)
      return dopo
    })
  }, [io, inVoce, iniziali])

  useEffect(
    () =>
      iscrivi((evento) => {
        if (evento.tipo !== 'restrizioni') return
        const canale = evento.canale as number
        const utente = evento.utente as number
        const sue = evento.restrizioni as Restrizione[]
        setPer((prima) => {
          // Un evento su un canale che non si e' mai chiesto non lo si tiene:
          // sarebbe mezza verita' — quella persona li' — spacciata per l'elenco
          // di quella stanza.
          if (!prima.has(canale)) return prima
          const dopo = new Map(prima)
          const suo = new Map(dopo.get(canale))
          // Un elenco vuoto e' "non ha piu' niente": la riga sparisce invece di
          // restare con zero elementi, cosi' chi guarda la mappa non deve
          // distinguere fra le due cose.
          if (sue.length === 0) suo.delete(utente)
          else suo.set(utente, sue)
          dopo.set(canale, suo)
          return dopo
        })
      }),
    [iscrivi]
  )

  const leggi = useCallback(
    (canale: number | null) => (canale ? (per.get(canale) ?? VUOTA) : VUOTA),
    [per]
  )

  const ha = useCallback(
    (canale: number, utente: number, genere: GenereRestrizione) =>
      (leggi(canale).get(utente) ?? []).some((r) => r.genere === genere),
    [leggi]
  )

  const imponi = useCallback(
    async (canale: number, utente: number, genere: GenereRestrizione, attiva: boolean) => {
      if (!api) return
      const { restrizioni } = await api.imponiRestrizione(canale, utente, genere, attiva)
      // La risposta e' gia' lo stato nuovo: si applica subito invece di
      // aspettare l'evento, che arrivera' comunque e dira' la stessa cosa. La
      // differenza si vede sul pulsante appena premuto, che altrimenti resta
      // com'era per il tempo di un giro di rete.
      chiesti.current.add(canale)
      setPer((prima) => {
        const dopo = new Map(prima)
        const suo = new Map(dopo.get(canale))
        if (restrizioni.length === 0) suo.delete(utente)
        else suo.set(utente, restrizioni)
        dopo.set(canale, suo)
        return dopo
      })
    },
    [api]
  )

  return {
    per: leggi,
    mie: (io && inVoce && leggi(inVoce).get(io)) || [],
    ha,
    assicura: carica,
    imponi
  }
}

/**
 * Un provvedimento come lo vede un menu: cosa, com'e' adesso, e come si cambia.
 *
 * Vive qui e non accanto al menu che lo disegna perche' lo costruiscono in due
 * — la sala e la colonna dei canali — e il menu e' solo uno dei posti in cui
 * finisce.
 */
export interface VoceModerazione {
  genere: GenereRestrizione
  attiva: boolean
  fai: (attiva: boolean) => void
}

/**
 * I permessi di moderazione, comunque li si sia saputi.
 *
 * Da dentro una stanza li dichiara il server all'ingresso, e li' dentro c'e'
 * anche chi comanda solo perche' sta organizzando un evento adesso. Da fuori si
 * ricavano dai permessi del canale, che arrivano gia' risolti in `GET /api/spazi`:
 * meno completi — l'organizzatore di un evento non si vede da li' — e
 * sufficienti per il caso normale.
 */
export interface PoteriDiModerazione {
  moderatore?: boolean
  puoZittire?: boolean
  puoAssordare?: boolean
}

/** I poteri ricavati dai permessi di un canale, per chi non ci e' dentro. */
export function poteriDaiPermessi(permessi: readonly string[] | undefined): PoteriDiModerazione {
  return {
    moderatore: !!permessi?.includes('manageVoiceMembers'),
    puoZittire: !!permessi?.includes('muteMembers'),
    puoAssordare: !!permessi?.includes('deafenMembers')
  }
}

/**
 * Le voci di moderazione su una persona, gia' filtrate per chi guarda.
 *
 * Un posto solo, e lo chiamano in due: il menu del tasto destro sul riquadro e
 * il pannellino sulla riga nella colonna dei canali. Sono le stesse azioni sulla
 * stessa persona, e due elenchi costruiti in due posti sarebbero diventati due
 * menu diversi al primo permesso aggiunto.
 *
 * Nullo quando non c'e' niente da mostrare: su se stessi, e a chi non ha nessuno
 * dei tre permessi.
 */
export function vociModerazione(
  poteri: PoteriDiModerazione | null | undefined,
  restrizioni: Restrizioni,
  canale: number,
  chi: number,
  quandoFallisce?: (messaggio: string) => void
): VoceModerazione[] | undefined {
  if (!poteri || !Number.isInteger(chi) || !Number.isInteger(canale)) return undefined

  const generi: GenereRestrizione[] = []
  // Camera e condivisione stanno insieme: sono tutte e due "decido cosa puoi
  // mandare in questa stanza", ed e' lo stesso permesso che serve a cacciare.
  if (poteri.moderatore) generi.push('camera', 'condivisione')
  if (poteri.puoZittire) generi.push('microfono')
  if (poteri.puoAssordare) generi.push('cuffie')
  if (generi.length === 0) return undefined

  return generi.map((genere) => ({
    genere,
    attiva: restrizioni.ha(canale, chi, genere),
    fai: (attiva) => {
      void restrizioni.imponi(canale, chi, genere, attiva).catch((e) => {
        quandoFallisce?.((e as Error).message)
      })
    }
  }))
}

/** Come si chiama, in italiano, cio' che e' stato tolto. */
export function nomeRestrizione(genere: GenereRestrizione): string {
  switch (genere) {
    case 'camera':
      return 'telecamera'
    case 'condivisione':
      return 'condivisione'
    case 'microfono':
      return 'microfono'
    case 'cuffie':
      return 'ascolto'
  }
}

/**
 * La frase che legge chi la subisce.
 *
 * Con il nome di chi l'ha imposta quando si sa. Senza un nome accanto, "non
 * puoi accendere il microfono" e' indistinguibile da un guasto — e chi lo legge
 * come un guasto riavvia l'applicazione tre volte prima di chiedere.
 */
export function fraseRestrizione(r: Restrizione): string {
  const chi = r.da?.nome ? ` da ${r.da.nome}` : ''
  switch (r.genere) {
    case 'camera':
      return `Telecamera bloccata${chi}.`
    case 'condivisione':
      return `Condivisione tolta${chi}.`
    case 'microfono':
      return `Microfono muto${chi}.`
    case 'cuffie':
      return `Ascolto tolto${chi}: non senti la stanza.`
  }
}
