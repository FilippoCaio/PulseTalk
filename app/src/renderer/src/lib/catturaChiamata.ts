import { ponte } from '../ponte'

/**
 * La chiamata cosi' com'e' sullo schermo: i pixel della nostra stessa finestra.
 *
 * ## Perche' non si compone la griglia a mano
 *
 * Con le tracce che stanno gia' arrivando si potrebbe disegnare tutto in una
 * tela: riquadri, nomi, bordo verde di chi parla. Vorrebbe dire pero' riscrivere
 * la disposizione della sala una seconda volta, e tenerla uguale alla prima per
 * sempre — il fuoco, la striscia, la chat aperta, chi entra a meta'. Catturare
 * la finestra da' gratis la sola cosa che conta davvero, cioe' che il file
 * assomigli a cio' che si stava guardando mentre si registrava.
 *
 * Il prezzo e' scritto in chiaro nell'interfaccia: dentro ci finisce tutto
 * quello che c'e' nella finestra, chat compresa, e le facce di chi ha la camera
 * accesa. Registrare una condivisione sola resta l'altra voce del menu, ed e'
 * quella che si sceglie quando si vuole il contenuto e non le persone.
 *
 * ## Senza audio, di proposito
 *
 * `audioSistema: 'niente'`, e non e' una dimenticanza: il loopback di Windows
 * prenderebbe cio' che esce dalle casse, cioe' le voci di tutti — comprese
 * quelle di chi ha detto di no. Le voci nel file ce le mette il mescolatore di
 * `registrazione.ts`, una per una, e solo quelle che hanno acconsentito.
 */
export async function catturaLaChiamata(fps = 30): Promise<MediaStream> {
  const sorgenteId = await ponte.sorgenteFinestra()
  if (!sorgenteId) {
    throw new Error('Qui non si puo\' registrare la chiamata: serve l\'applicazione installata.')
  }

  await ponte.preparaCattura({ sorgenteId, audioSistema: 'niente' })

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: fps, max: fps } },
    audio: false
  })

  // Testo piccolo e finestre ferme: la stessa scelta della condivisione di uno
  // schermo, per la stessa ragione. Vedi `shared/qualita.ts`.
  const video = stream.getVideoTracks()[0]
  if (video) video.contentHint = 'detail'

  return stream
}
