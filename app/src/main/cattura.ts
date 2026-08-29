import { desktopCapturer, screen, type Session } from 'electron'
import type { SceltaCattura, Sorgente } from '@shared/tipi'

/**
 * La cattura dello schermo, e l'audio che ci va insieme.
 *
 * Il selettore delle sorgenti e' nostro, non quello di sistema: serve perche'
 * accanto a ogni schermo vogliamo dire *cosa* verra' condiviso — la
 * risoluzione vera, e se il suono parte insieme al video. La finestra di
 * Windows quella scelta non la offre.
 *
 * L'audio di sistema e' la parte che vale il lavoro. Su Windows Electron sa
 * agganciare il loopback dell'uscita audio, cioe' esattamente quello che esce
 * dalle casse, e infilarlo nello stesso stream del video. Discord ci riesce a
 * fatica e solo per alcune finestre; qui e' una scelta in un menu.
 */

// La scelta arriva dalla finestra un istante prima di getDisplayMedia(), e il
// gestore la legge quando Chromium chiede il permesso.
//
// Sembra fragile, ma e' l'unico modo: getDisplayMedia() non ha un parametro per
// dire *quale* schermo, perche' nel browser quella decisione e' dell'utente e
// nessuna pagina deve poterla influenzare. Dentro Electron l'utente ha gia'
// scelto nella nostra finestra, e questa variabile e' il modo di riferirlo.
let sceltaCorrente: SceltaCattura | null = null

export function ricordaScelta(scelta: SceltaCattura): void {
  sceltaCorrente = scelta
}

/** I pixel veri di un monitor, non quelli logici del ridimensionamento. */
function pixelVeri(display: Electron.Display): { larghezza: number; altezza: number } {
  return {
    larghezza: Math.round(display.size.width * display.scaleFactor),
    altezza: Math.round(display.size.height * display.scaleFactor)
  }
}

export async function elencaSorgenti(): Promise<Sorgente[]> {
  const schermi = screen.getAllDisplays()

  const grezze = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    // Un'anteprima larga: il selettore la mostra grande, e con 150 pixel non si
    // riconosce quale delle tre finestre di VS Code sia quella giusta.
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true
  })

  return grezze
    .filter((s) => !s.thumbnail.isEmpty())
    .map((s) => {
      const display = s.display_id
        ? schermi.find((d) => String(d.id) === s.display_id)
        : undefined
      const misure = display ? pixelVeri(display) : null

      return {
        id: s.id,
        nome: s.name,
        tipo: s.id.startsWith('screen:') ? ('schermo' as const) : ('finestra' as const),
        anteprima: `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`,
        icona: s.appIcon && !s.appIcon.isEmpty()
          ? `data:image/png;base64,${s.appIcon.resize({ width: 32 }).toPNG().toString('base64')}`
          : null,
        schermoId: s.display_id || null,
        larghezza: misure?.larghezza ?? null,
        altezza: misure?.altezza ?? null
      }
    })
}

/**
 * Traduce la nostra scelta in cio' che Electron si aspetta.
 *
 *   condiviso   il suono esce dalle casse *e* va nello stream. E' il default:
 *               chi condivide un video vuole sentirlo anche lui.
 *   soloRemoto  il suono va solo nello stream. Serve quando si fa ascoltare
 *               qualcosa agli altri senza averlo addosso.
 *
 * Cosa prendono davvero, e conviene esserne precisi: non "l'audio della
 * finestra scelta" — quello Windows non lo sa isolare — ma tutto cio' che esce
 * dal dispositivo di riproduzione predefinito. Nella quasi totalita' dei casi
 * la differenza non si nota. Si nota quando quel dispositivo e' un missaggio
 * ("Stereo Mix", un cavo virtuale, VoiceMeeter), oppure quando il microfono ha
 * "Ascolta questo dispositivo" acceso, oppure quando la scheda audio fa
 * monitoraggio: in quei tre casi nel loopback c'e' dentro anche la voce di chi
 * condivide, e dall'altra parte si sente doppia e sfasata.
 *
 * Non e' una cosa che si aggiusta da qui, e soprattutto non si aggiusta
 * togliendo o aggiungendo tracce: il microfono e la condivisione sono due
 * tracce diverse e devono restare due tracce diverse fino alle orecchie di chi
 * ascolta. Il primo dei tre casi si riconosce dal nome dell'uscita, e chi lo
 * riconosce e lo dice e' il selettore delle sorgenti — vedi
 * `renderer/src/lib/loopbackSporco.ts`. Gli altri due vivono in impostazioni
 * che nessuna API leggibile da qui espone, e restano scritti li' come
 * possibilita' invece di essere taciuti.
 */
function audioPer(scelta: SceltaCattura): 'loopback' | 'loopbackWithMute' | undefined {
  // Il loopback e' una cosa di Windows. Su macOS e Linux Electron non lo ha, e
  // chiederlo li' non degrada la richiesta: la fa fallire tutta, portandosi
  // dietro anche il video.
  if (process.platform !== 'win32') return undefined
  if (scelta.audioSistema === 'condiviso') return 'loopback'
  if (scelta.audioSistema === 'soloRemoto') return 'loopbackWithMute'
  return undefined
}

export function agganciaCattura(sessione: Session): void {
  sessione.setDisplayMediaRequestHandler(
    (_richiesta, rispondi) => {
      const scelta = sceltaCorrente
      if (!scelta) {
        // Nessuna scelta significa che la richiesta non e' partita dal nostro
        // selettore. Un oggetto vuoto la rifiuta senza far comparire niente.
        rispondi({})
        return
      }

      // Le sorgenti si rileggono adesso e non si riusano quelle del selettore:
      // fra la scelta e la conferma possono passare secondi, e una finestra
      // chiusa nel frattempo darebbe uno stream nero.
      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sorgenti) => {
          const sorgente = sorgenti.find((s) => s.id === scelta.sorgenteId)
          if (!sorgente) {
            rispondi({})
            return
          }
          rispondi({ video: sorgente, audio: audioPer(scelta) })
        })
        .catch(() => rispondi({}))

      // La scelta vale per una condivisione sola: se il prossimo
      // getDisplayMedia() non passa dal nostro selettore, non deve ereditare
      // quello che era stato scelto mezz'ora prima.
      sceltaCorrente = null
    },
    // Il selettore di Windows non sa dire "e mandaci anche l'audio di sistema",
    // che e' meta' del motivo per cui questo programma esiste.
    { useSystemPicker: false }
  )
}
