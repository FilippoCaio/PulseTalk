import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client'
import {
  avviaRegistrazione,
  salvaRegistrazione,
  sapRegistrare,
  type Registrazione
} from './registrazione'

/**
 * Chi acconsente a essere registrato, chi sta registrando, e la registrazione.
 *
 * ## Il consenso vive negli attributi del partecipante, non sul server
 *
 * LiveKit li sincronizza da solo a tutta la stanza, e il gettone concede gia'
 * `canUpdateOwnMetadata` a chiunque: nessuna rotta nuova, nessuna tabella,
 * nessun evento SSE da tenere allineato. Ma la ragione vera non e' che costa
 * meno — e' che gli attributi hanno la **durata giusta**.
 *
 * Un consenso e' una cosa di questa conversazione. Vive quanto la stanza e
 * muore con lei, e alla chiamata dopo si riparte da no. Salvarlo nel database
 * vorrebbe dire che il "si" detto una sera vale anche fra tre mesi, in
 * un'altra conversazione, con altre persone dentro — cioe' esattamente il tipo
 * di consenso che non e' un consenso.
 *
 * ## Due attributi, e sono due cose diverse
 *
 *   `rec-consenso`  la mia voce puo' entrare in una registrazione
 *   `rec-attiva`    sto registrando io, adesso
 *
 * Il secondo non e' una gentilezza: con la registrazione che gira dentro a un
 * client, l'unico modo che gli altri hanno di saperlo e' che quel client lo
 * dica. Un programma modificato puo' mentire — come puo' farlo OBS aperto di
 * fianco — e non c'e' niente da fare. Cio' che si puo' fare e' rendere
 * impossibile non accorgersene quando la strada onesta viene usata.
 *
 * ## Cosa NON fa
 *
 * Non registra le persone: registra **uno schermo condiviso** con sotto le
 * voci. Senza niente da guardare non c'e' niente da registrare, e il pulsante
 * non compare — una registrazione di sole voci sarebbe un'altra funzione, con
 * altre domande da farsi.
 */

const CONSENSO = 'rec-consenso'
const ATTIVA = 'rec-attiva'

export interface Registratore {
  /** Vero se questa macchina sa registrare: senza, l'interfaccia non offre niente. */
  possibile: boolean
  /**
   * Cosa ho risposto: si', no, oppure non ancora.
   *
   * Tre stati e non due, come per Auto Writer. La differenza fra "ha detto di
   * no" e "non ha ancora risposto" e' tutta: un no implicito lo si ottiene
   * anche da chi non ha visto la domanda, e su un consenso non si tira a
   * indovinare. Finche' e' null la barra fa la domanda a chiare lettere.
   */
  consensoMio: boolean | null
  rispondi: (si: boolean) => void
  /** Le identita' di chi ha detto di si', me compreso. */
  acconsentono: Set<string>
  /** I nomi di chi sta registrando adesso. Vuoto quasi sempre. */
  registrano: string[]
  /** Sto registrando io. */
  mia: boolean
  /** Da quanti secondi. Zero se non e' in corso. */
  secondi: number
  /** Quante voci stanno entrando nel file adesso. */
  vociDentro: number
  avvia: (schermo: MediaStreamTrack, sistema: MediaStreamTrack | null) => void
  ferma: () => void
}

export function usaRegistrazione(
  stanza: Room | null,
  nomeCanale: string
): Registratore {
  const [consensoMio, setConsensoMio] = useState<boolean | null>(null)
  const [acconsentono, setAcconsentono] = useState<Set<string>>(new Set())
  const [registrano, setRegistrano] = useState<string[]>([])
  const [secondi, setSecondi] = useState(0)
  const [vociDentro, setVociDentro] = useState(0)
  /**
   * Sto registrando io.
   *
   * Uno stato e non `corrente.current !== null`: un ref non fa ridisegnare, e
   * il pulsante sarebbe rimasto "Registra" per tutta la registrazione.
   */
  const [mia, setMia] = useState(false)

  const corrente = useRef<Registrazione | null>(null)

  /**
   * Chi acconsente, riletto da capo a ogni cambiamento.
   *
   * Ricalcolare tutto invece di aggiornare la voce che e' cambiata: l'insieme
   * ha al massimo qualche decina di elementi, e una lista che si aggiorna a
   * pezzi e' una lista che prima o poi diverge da cio' che dice la stanza.
   */
  const rileggi = useCallback((): void => {
    if (!stanza) return
    const tutti: Participant[] = [stanza.localParticipant, ...stanza.remoteParticipants.values()]

    setAcconsentono(
      new Set(tutti.filter((p) => p.attributes?.[CONSENSO] === 'si').map((p) => p.identity))
    )
    setRegistrano(
      tutti.filter((p) => p.attributes?.[ATTIVA] === 'si').map((p) => p.name || p.identity)
    )
    const mio = stanza.localParticipant.attributes?.[CONSENSO]
    setConsensoMio(mio === 'si' ? true : mio === 'no' ? false : null)
  }, [stanza])

  useEffect(() => {
    if (!stanza) {
      setAcconsentono(new Set())
      setRegistrano([])
      setConsensoMio(null)
      return
    }
    rileggi()
    stanza
      .on(RoomEvent.ParticipantAttributesChanged, rileggi)
      .on(RoomEvent.ParticipantConnected, rileggi)
      .on(RoomEvent.ParticipantDisconnected, rileggi)
      .on(RoomEvent.Connected, rileggi)
    return () => {
      stanza
        .off(RoomEvent.ParticipantAttributesChanged, rileggi)
        .off(RoomEvent.ParticipantConnected, rileggi)
        .off(RoomEvent.ParticipantDisconnected, rileggi)
        .off(RoomEvent.Connected, rileggi)
    }
  }, [stanza, rileggi])

  const rispondi = useCallback(
    (si: boolean): void => {
      if (!stanza) return
      const prima = consensoMio
      // Si scrive subito nello stato locale invece di aspettare il giro dalla
      // SFU: e' un pulsante che si preme, e mezzo secondo di "non e' successo
      // niente" lo fa premere due volte.
      setConsensoMio(si)
      void stanza.localParticipant
        .setAttributes({
          ...stanza.localParticipant.attributes,
          [CONSENSO]: si ? 'si' : 'no'
        })
        .catch(() => {
          // Non e' passato: si rimette com'era. Un pulsante che dice si'
          // mentre la stanza sa altro e' peggio di un clic perso.
          setConsensoMio(prima)
        })
    },
    [stanza, consensoMio]
  )

  /**
   * Le voci di chi acconsente, tenute allineate mentre si registra.
   *
   * E' questo effetto a rendere il consenso revocabile davvero: cambia
   * l'insieme, e le sorgenti entrano o escono dal mescolatore senza fermare
   * niente. Gira anche quando qualcuno accende il microfono a meta'
   * registrazione, perche' la traccia prima non c'era.
   */
  useEffect(() => {
    const registrazione = corrente.current
    if (!registrazione || !stanza) return

    const tutti: Participant[] = [stanza.localParticipant, ...stanza.remoteParticipants.values()]
    const dentro = new Set(registrazione.vociDentro())

    for (const p of tutti) {
      const traccia = p.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
      const deveEsserci = acconsentono.has(p.identity) && !!traccia
      if (deveEsserci && !dentro.has(p.identity)) registrazione.includi(p.identity, traccia!)
      if (!deveEsserci && dentro.has(p.identity)) registrazione.escludi(p.identity)
    }
    // Chi se n'e' andato dalla stanza: la sua sorgente resta appesa a una
    // traccia morta finche' non la si stacca.
    for (const identita of dentro) {
      if (!tutti.some((p) => p.identity === identita)) registrazione.escludi(identita)
    }
    setVociDentro(registrazione.vociDentro().length)
  }, [acconsentono, stanza, mia, secondi])

  /**
   * Il cronometro.
   *
   * Batte anche quando non c'e' niente da contare per chi guarda, ed e'
   * voluto: `secondi` e' una delle dipendenze dell'effetto qui sopra, quindi
   * questo battito e' anche cio' che riporta dentro al mescolatore i microfoni
   * accesi a meta' registrazione. Un secondo di ritardo su un microfono appena
   * acceso e' accettabile; non accorgersene mai non lo sarebbe.
   */
  useEffect(() => {
    if (!mia) return
    const passo = window.setInterval(() => {
      const r = corrente.current
      if (r) setSecondi(Math.floor((Date.now() - r.iniziata) / 1000))
    }, 1000)
    return () => window.clearInterval(passo)
  }, [mia])

  const annuncia = useCallback(
    (attiva: boolean): void => {
      if (!stanza) return
      void stanza.localParticipant
        .setAttributes({
          ...stanza.localParticipant.attributes,
          [ATTIVA]: attiva ? 'si' : ''
        })
        .catch(() => {
          // Se l'annuncio non passa, la registrazione non parte: registrare
          // senza che gli altri lo sappiano e' esattamente cio' che questa
          // funzione non deve poter fare.
        })
    },
    [stanza]
  )

  const ferma = useCallback((): void => {
    const registrazione = corrente.current
    corrente.current = null
    setMia(false)
    setSecondi(0)
    setVociDentro(0)
    annuncia(false)
    if (!registrazione) return
    void registrazione.ferma().then((dati) => {
      if (dati) salvaRegistrazione(dati, nomeCanale)
    })
  }, [annuncia, nomeCanale])

  const avvia = useCallback(
    (schermo: MediaStreamTrack, sistema: MediaStreamTrack | null): void => {
      if (corrente.current || !sapRegistrare()) return
      corrente.current = avviaRegistrazione({ video: schermo, sistema })
      setMia(true)
      setSecondi(0)
      annuncia(true)

      // Se chi condivide smette, la registrazione finisce da sola: continuare
      // su una traccia morta scriverebbe minuti di nero.
      schermo.addEventListener('ended', () => ferma(), { once: true })
    },
    [annuncia, ferma]
  )

  // Uscendo dalla stanza con una registrazione aperta il file va salvato lo
  // stesso: e' roba gia' scritta, e buttarla via perche' si e' chiuso male
  // sarebbe la peggiore delle risposte.
  useEffect(() => () => {
    const registrazione = corrente.current
    corrente.current = null
    if (registrazione) {
      void registrazione.ferma().then((dati) => {
        if (dati) salvaRegistrazione(dati, nomeCanale)
      })
    }
    // Volutamente senza dipendenze: deve girare allo smontaggio e basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    possibile: sapRegistrare(),
    consensoMio,
    rispondi,
    acconsentono,
    registrano,
    mia,
    secondi,
    vociDentro,
    avvia,
    ferma
  }
}
