/**
 * I suoni delle azioni, sintetizzati.
 *
 * Nessun file audio: sono note generate da un oscillatore. Non e' avarizia di
 * megabyte — e' che un wav va caricato, e la prima volta che si preme il muto
 * il suono arriverebbe mezzo secondo dopo, che e' il momento sbagliato. Qui il
 * suono e' pronto sempre, pesa zero, e non c'e' niente che possa mancare
 * quando la pagina gira da `file://`.
 *
 * La grammatica e' una sola e vale per tutti: **sale quando qualcosa si apre**
 * (accendi, entra, comincia a condividere), **scende quando qualcosa si
 * chiude**. Si impara senza accorgersene, ed e' il motivo per cui in Discord si
 * sa chi e' entrato senza guardare lo schermo.
 *
 * Quello che riguarda gli altri e' piu' basso e piu' piano di quello che
 * riguarda te: la tua azione l'hai appena fatta e il suono conferma, quella di
 * un altro e' una notizia e non deve interrompere.
 */

export type Suono =
  | 'microfonoAcceso'
  | 'microfonoSpento'
  | 'cameraAccesa'
  | 'cameraSpenta'
  | 'condivisioneIniziata'
  | 'condivisioneFinita'
  | 'insiemeIniziato'
  | 'insiemeFinito'
  | 'entrato'
  | 'uscito'
  | 'altroEntrato'
  | 'altroUscito'
  | 'sordinaAccesa'
  | 'sordinaSpenta'
  | 'registrazioneIniziata'
  | 'registrazioneFinita'

interface Nota {
  /** Hertz. 440 e' il la. */
  frequenza: number
  /** Quando parte, in millisecondi dall'inizio del suono. */
  quando: number
  durata: number
  volume: number
  forma?: OscillatorType
}

/**
 * Le sequenze. Poche note, corte, e mai sopra i 900 Hz: un suono acuto in
 * cuffia mentre si sta parlando e' una sberla, e questo suono si sentira'
 * duecento volte al giorno.
 */
const SEQUENZE: Record<Suono, Nota[]> = {
  // Le tue azioni: due note nette, volume pieno.
  microfonoAcceso: [
    { frequenza: 520, quando: 0, durata: 70, volume: 0.5 },
    { frequenza: 780, quando: 55, durata: 90, volume: 0.5 }
  ],
  microfonoSpento: [
    { frequenza: 780, quando: 0, durata: 70, volume: 0.5 },
    { frequenza: 520, quando: 55, durata: 90, volume: 0.5 }
  ],

  // La camera ha un timbro suo, piu' morbido: due cose diverse non devono
  // suonare uguali solo perche' sono tutte e due un interruttore.
  cameraAccesa: [
    { frequenza: 440, quando: 0, durata: 80, volume: 0.42, forma: 'triangle' },
    { frequenza: 660, quando: 65, durata: 110, volume: 0.42, forma: 'triangle' }
  ],
  cameraSpenta: [
    { frequenza: 660, quando: 0, durata: 80, volume: 0.42, forma: 'triangle' },
    { frequenza: 440, quando: 65, durata: 110, volume: 0.42, forma: 'triangle' }
  ],

  // Condividere e' l'azione piu' grossa che si fa qui dentro, e ha tre note.
  condivisioneIniziata: [
    { frequenza: 440, quando: 0, durata: 60, volume: 0.4 },
    { frequenza: 587, quando: 50, durata: 60, volume: 0.4 },
    { frequenza: 784, quando: 100, durata: 130, volume: 0.4 }
  ],
  condivisioneFinita: [
    { frequenza: 784, quando: 0, durata: 60, volume: 0.4 },
    { frequenza: 587, quando: 50, durata: 60, volume: 0.4 },
    { frequenza: 440, quando: 100, durata: 130, volume: 0.4 }
  ],

  // Guardare insieme: le stesse tre note della condivisione — perche' e' la
  // stessa famiglia di cose, qualcosa che compare nella stanza per tutti — ma
  // in triangolo e un tono sotto, cosi' non si confonde con uno schermo
  // condiviso mentre si sta guardando altrove.
  insiemeIniziato: [
    { frequenza: 392, quando: 0, durata: 60, volume: 0.38, forma: 'triangle' },
    { frequenza: 523, quando: 50, durata: 60, volume: 0.38, forma: 'triangle' },
    { frequenza: 698, quando: 100, durata: 140, volume: 0.38, forma: 'triangle' }
  ],
  insiemeFinito: [
    { frequenza: 698, quando: 0, durata: 60, volume: 0.38, forma: 'triangle' },
    { frequenza: 523, quando: 50, durata: 60, volume: 0.38, forma: 'triangle' },
    { frequenza: 392, quando: 100, durata: 140, volume: 0.38, forma: 'triangle' }
  ],

  /**
   * La registrazione: tre note che salgono, e non e' un suono come gli altri.
   *
   * Lo sentono **tutti** quelli in stanza, non solo chi preme, e non si spegne
   * con gli altri suoni: e' l'unico avviso che raggiunge chi in quel momento
   * sta guardando altrove, ed e' anche l'unico modo di dirlo a chi ha la
   * finestra ridotta a icona. In parecchi posti del mondo un avviso udibile
   * prima di registrare non e' una gentilezza: e' la condizione perche' si
   * possa fare.
   *
   * Piu' lente e piu' distanti delle altre - 200 millisecondi buoni - perche'
   * un suono che si confonde con quello del microfono non avvisa nessuno.
   */
  registrazioneIniziata: [
    { frequenza: 523, quando: 0, durata: 110, volume: 0.5 },
    { frequenza: 659, quando: 130, durata: 110, volume: 0.5 },
    { frequenza: 880, quando: 260, durata: 220, volume: 0.5 }
  ],
  registrazioneFinita: [
    { frequenza: 880, quando: 0, durata: 110, volume: 0.45 },
    { frequenza: 659, quando: 130, durata: 110, volume: 0.45 },
    { frequenza: 523, quando: 260, durata: 220, volume: 0.45 }
  ],

  // Entrare e uscire da una stanza: intervallo largo, si sente da lontano.
  entrato: [
    { frequenza: 392, quando: 0, durata: 90, volume: 0.5 },
    { frequenza: 659, quando: 80, durata: 160, volume: 0.5 }
  ],
  uscito: [
    { frequenza: 659, quando: 0, durata: 90, volume: 0.5 },
    { frequenza: 392, quando: 80, durata: 160, volume: 0.5 }
  ],

  // Gli altri: stesse note un'ottava sotto e a meta' volume.
  altroEntrato: [
    { frequenza: 294, quando: 0, durata: 80, volume: 0.28 },
    { frequenza: 440, quando: 70, durata: 140, volume: 0.28 }
  ],
  altroUscito: [
    { frequenza: 440, quando: 0, durata: 80, volume: 0.28 },
    { frequenza: 294, quando: 70, durata: 140, volume: 0.28 }
  ],

  // La sordina e' l'unica che si sente *mentre* si spegne tutto il resto:
  // una nota sola, cupa, che non si confonde con il muto del microfono.
  sordinaAccesa: [{ frequenza: 300, quando: 0, durata: 180, volume: 0.45, forma: 'triangle' }],
  sordinaSpenta: [{ frequenza: 500, quando: 0, durata: 180, volume: 0.45, forma: 'triangle' }]
}

let contesto: AudioContext | null = null
let acceso = true
let volume = 0.6

/** Le due manopole, tenute qui perche' `suona` viene chiamata da ovunque. */
export function configuraSuoni(opzioni: { acceso: boolean; volume: number }): void {
  acceso = opzioni.acceso
  volume = opzioni.volume
}

/**
 * Suona, e non disturbare nessuno se non ci riesce.
 *
 * Il contesto audio nasce alla prima chiamata: prima di un clic il browser non
 * lo lascerebbe partire comunque, e tutti questi suoni arrivano da un clic o da
 * un evento che segue un clic. Se e' sospeso — succede quando la finestra e'
 * rimasta dietro a lungo — si prova a risvegliarlo, e se non si sveglia
 * pazienza: un suono mancato non e' un errore da mostrare a nessuno.
 */
export function suona(quale: Suono, { sempre = false }: { sempre?: boolean } = {}): void {
  /**
   * `sempre` scavalca le due manopole, ed e' usato da una cosa sola: l'avviso
   * che qualcuno ha cominciato a registrare.
   *
   * Scavalcare una scelta dell'utente e' brutto e qui e' il punto. Gli altri
   * suoni riguardano chi li sente - il proprio microfono, chi entra - e chi li
   * spegne rinuncia a una comodita' sua. Questo riguarda **gli altri**: e'
   * l'unico avviso che arriva a chi in quel momento sta guardando altrove, e
   * un avviso che chi registra puo' spegnere dalle proprie impostazioni non
   * avvisa nessuno. In parecchi posti del mondo, poi, un segnale udibile prima
   * di registrare non e' una gentilezza ma la condizione perche' si possa
   * fare.
   *
   * Il volume ha un fondo, non il valore scelto: a zero non si sentirebbe.
   */
  if (!sempre && (!acceso || volume <= 0)) return
  const forza = sempre ? Math.max(volume, 0.5) : volume

  try {
    contesto ??= new AudioContext()
    if (contesto.state === 'suspended') void contesto.resume()

    const adesso = contesto.currentTime
    const generale = contesto.createGain()
    generale.gain.value = forza
    generale.connect(contesto.destination)

    for (const nota of SEQUENZE[quale]) {
      const inizio = adesso + nota.quando / 1000
      const fine = inizio + nota.durata / 1000

      const oscillatore = contesto.createOscillator()
      oscillatore.type = nota.forma ?? 'sine'
      oscillatore.frequency.value = nota.frequenza

      // L'inviluppo, che e' quasi tutto il lavoro.
      //
      // Un oscillatore acceso e spento di netto fa "click" a tutti e due i
      // capi: e' lo scalino nella forma d'onda, e si sente piu' della nota.
      // Cinque millisecondi di salita e una discesa esponenziale bastano a
      // togliere il click e a far sembrare che qualcuno abbia pizzicato
      // qualcosa invece che acceso un generatore.
      const inviluppo = contesto.createGain()
      inviluppo.gain.setValueAtTime(0, inizio)
      inviluppo.gain.linearRampToValueAtTime(nota.volume, inizio + 0.005)
      inviluppo.gain.exponentialRampToValueAtTime(0.0001, fine)

      oscillatore.connect(inviluppo).connect(generale)
      oscillatore.start(inizio)
      oscillatore.stop(fine + 0.02)
    }
  } catch {
    // Nessun dispositivo di uscita, contesto rifiutato, scheda audio staccata:
    // sono tutti casi in cui l'app deve continuare a funzionare in silenzio.
  }
}
