import { useEffect, useState } from 'react'
import { RoomEvent, type Participant, type Room } from 'livekit-client'

/**
 * Da quanto si sta insieme in questo canale.
 *
 * Non «da quanto ci sono io»: da quando e' entrato **il primo**. E' la
 * differenza fra un cronometro personale e l'eta' della conversazione — chi
 * arriva alle sei e mezza vuole sapere che gli altri stanno parlando da un'ora,
 * non che lui e' appena arrivato.
 *
 * ## Perche' non c'e' niente da salvare da nessuna parte
 *
 * L'ora d'ingresso di ogni partecipante la mette la SFU e viaggia dentro alle
 * informazioni di sala: `joinedAt` ce l'hanno tutti, anche chi era gia' dentro
 * prima che arrivassimo noi. Il piu' piccolo di quei numeri e' l'inizio, e non
 * serve che nessuno lo scriva sul disco — quando l'ultimo esce, i `joinedAt`
 * escono con lui, e chi entra dopo trova solo il proprio. Il cronometro si
 * azzera da solo perche' non esiste piu' niente da cui contare.
 *
 * ## Una cosa da sapere sugli orologi
 *
 * `joinedAt` e' l'ora del server, il confronto e' con l'ora di questo computer.
 * Due orologi lontani fra loro di mezz'ora darebbero mezz'ora di conversazione
 * che non c'e' stata. Non si corregge: sono due macchine che parlano fra loro
 * ogni secondo, e se sono cosi' distanti c'e' un problema piu' grosso di un
 * cronometro sbagliato. Si evita solo l'assurdo — un tempo negativo — perche'
 * quello si vede subito e sembra un difetto del programma.
 */
export function usaTempoInsieme(stanza: Room | null): number | null {
  const [da, setDa] = useState<number | null>(null)
  const [secondi, setSecondi] = useState(0)

  useEffect(() => {
    if (!stanza) {
      setDa(null)
      return
    }

    const rileggi = (): void => {
      const tutti: Participant[] = [stanza.localParticipant, ...stanza.remoteParticipants.values()]
      const inizi = tutti
        .map((p) => p.joinedAt?.getTime())
        .filter((n): n is number => typeof n === 'number' && n > 0)
      setDa(inizi.length > 0 ? Math.min(...inizi) : null)
    }

    rileggi()
    stanza
      .on(RoomEvent.ParticipantConnected, rileggi)
      .on(RoomEvent.ParticipantDisconnected, rileggi)
      .on(RoomEvent.Connected, rileggi)
      .on(RoomEvent.Reconnected, rileggi)
      .on(RoomEvent.Disconnected, rileggi)

    return () => {
      stanza
        .off(RoomEvent.ParticipantConnected, rileggi)
        .off(RoomEvent.ParticipantDisconnected, rileggi)
        .off(RoomEvent.Connected, rileggi)
        .off(RoomEvent.Reconnected, rileggi)
        .off(RoomEvent.Disconnected, rileggi)
    }
  }, [stanza])

  useEffect(() => {
    if (da == null) {
      setSecondi(0)
      return
    }
    const aggiorna = (): void => setSecondi(Math.max(0, Math.floor((Date.now() - da) / 1000)))
    aggiorna()
    const passo = window.setInterval(aggiorna, 1000)
    return () => window.clearInterval(passo)
  }, [da])

  return da == null ? null : secondi
}

/**
 * Da quanto ci sono **io**, in questa chiamata.
 *
 * L'altro cronometro dice l'eta' della conversazione - da quando e' entrato il
 * primo - e serve a chi arriva a capire in cosa sta entrando. Questo dice il
 * proprio tempo, ed e' un'altra domanda: quanto sono stato al telefono. Le due
 * risposte non coincidono quasi mai, e la seconda e' quella che si guarda
 * mentre si e' altrove con la testa.
 *
 * Stessa sorgente e stessa avvertenza sugli orologi dell'altro: `joinedAt` lo
 * mette il server, il confronto e' con l'ora di questo computer.
 */
export function usaTempoInChiamata(stanza: Room | null): number | null {
  const [da, setDa] = useState<number | null>(null)
  const [secondi, setSecondi] = useState(0)

  useEffect(() => {
    if (!stanza) {
      setDa(null)
      return
    }

    const rileggi = (): void => {
      const mio = stanza.localParticipant.joinedAt?.getTime()
      setDa(typeof mio === 'number' && mio > 0 ? mio : null)
    }

    rileggi()
    stanza.on(RoomEvent.Connected, rileggi).on(RoomEvent.Reconnected, rileggi)
    return () => {
      stanza.off(RoomEvent.Connected, rileggi).off(RoomEvent.Reconnected, rileggi)
    }
  }, [stanza])

  useEffect(() => {
    if (da == null) {
      setSecondi(0)
      return
    }
    const aggiorna = (): void => setSecondi(Math.max(0, Math.floor((Date.now() - da) / 1000)))
    aggiorna()
    const passo = window.setInterval(aggiorna, 1000)
    return () => window.clearInterval(passo)
  }, [da])

  return da == null ? null : secondi
}

/**
 * Il cronometro scritto come lo si legge a colpo d'occhio.
 *
 * Sotto l'ora due cifre e due punti, sopra tre gruppi: `07:12` e `1:04:39`.
 * L'ora non si scrive con lo zero davanti perche' non e' un orologio — e'
 * una durata, e "01:04:39" si legge come un orario delle una di notte.
 */
export function scriviTempoInsieme(secondi: number): string {
  const ore = Math.floor(secondi / 3600)
  const minuti = Math.floor((secondi % 3600) / 60)
  const resto = secondi % 60
  const due = (n: number): string => String(n).padStart(2, '0')
  return ore > 0 ? `${ore}:${due(minuti)}:${due(resto)}` : `${due(minuti)}:${due(resto)}`
}
