/**
 * La prova del microfono, indipendente dalla chiamata.
 *
 * Serve proprio quando NON si e' in stanza: si aprono le impostazioni prima di
 * entrare, si parla, e si vede se il microfono giusto e' selezionato e a che
 * livello arriva la voce. Per questo apre un suo `getUserMedia` invece di
 * appoggiarsi alla catena della sessione, che fuori dalla stanza non esiste.
 *
 * Il ritorno all'orecchio ("sentiti") e' spento di partenza: senza cuffie
 * innesca un fischio in due secondi, ed e' il primo modo in cui una prova del
 * microfono fa scappare chi la stava provando.
 */
import { apriMicrofonoScelto } from './usaDispositivi'

export interface Prova {
  /** Il livello adesso, da 0 a 1. Va letto a ogni fotogramma da chi disegna. */
  livello(): number
  /** Manda il microfono in cuffia, per sentirsi. Con le casse: fischio. */
  sentiti(acceso: boolean): void
  chiudi(): Promise<void>
}

export async function avviaProva(
  dispositivoId: string | null,
  dispositivoNome: string | null = null
): Promise<Prova> {
  // Dalla stessa porta da cui passa la chiamata, e non e' un dettaglio: qui si
  // regola la soglia guardando una barra, e se questa apre un dispositivo
  // diverso da quello che poi parlera' si sta tarando la cosa sbagliata.
  const { flusso: grezzo } = await apriMicrofonoScelto(
    {
      // Nessuna elaborazione: si sta provando il microfono, non la catena
      // della chiamata. Con la soppressione del rumore accesa, un microfono
      // che prende male sembra perfetto finche' non si parla davvero.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    dispositivoId,
    dispositivoNome
  )

  const contesto = new AudioContext()
  if (contesto.state === 'suspended') await contesto.resume().catch(() => {})

  const sorgente = contesto.createMediaStreamSource(grezzo)
  const analizzatore = contesto.createAnalyser()
  analizzatore.fftSize = 1024
  sorgente.connect(analizzatore)

  // Il ritorno passa da un guadagno a zero invece che da un collegamento da
  // fare e disfare: attaccare e staccare nodi mentre il contesto gira produce
  // uno scoppio, e su un ritorno in cuffia lo scoppio arriva dritto in testa.
  const ritorno = contesto.createGain()
  ritorno.gain.value = 0
  sorgente.connect(ritorno).connect(contesto.destination)

  const campioni = new Float32Array(analizzatore.fftSize)
  let chiusa = false

  return {
    livello() {
      if (chiusa) return 0
      analizzatore.getFloatTimeDomainData(campioni)
      let somma = 0
      for (let i = 0; i < campioni.length; i++) somma += campioni[i] * campioni[i]
      return Math.sqrt(somma / campioni.length)
    },

    sentiti(acceso) {
      if (chiusa) return
      ritorno.gain.setTargetAtTime(acceso ? 1 : 0, contesto.currentTime, 0.02)
    },

    async chiudi() {
      if (chiusa) return
      chiusa = true
      // Fermare le tracce e' cio' che spegne la spia del microfono: chiudere
      // il solo contesto la lascerebbe accesa finche' non si chiude l'app.
      for (const traccia of grezzo.getTracks()) traccia.stop()
      await contesto.close().catch(() => {})
    }
  }
}
