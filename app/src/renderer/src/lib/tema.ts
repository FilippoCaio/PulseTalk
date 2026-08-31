import type { Tema } from '@shared/tipi'
import { CHIAVI, coloriDi, leggiEsadecimale, luminosita, type Colori } from '@shared/tema'

/**
 * I colori, messi davvero sullo schermo.
 *
 * Il *cosa* sta in `@shared/tema` — i dodici ruoli, i tre preset, i conti che
 * ricavano un tema da una tavolozza — ed e' li' perche' non serve solo qui:
 * anche il processo principale deve sapere di che colore dipingere la finestra
 * prima che dentro ci sia una pagina, e una seconda copia di quei valori
 * diverge al primo ritocco.
 *
 * Qui resta il *dove*: `document`, che di la' non esiste. Tre funzioni, e la
 * copia in `localStorage` che permette di dipingere prima ancora di sapere.
 */

export * from '@shared/tema'

/**
 * Dove si tiene una copia del tema per l'avvio.
 *
 * Le impostazioni arrivano da un giro asincrono — IPC nell'app installata, una
 * lettura in `localStorage` nella pagina — e fino a quando non arrivano
 * l'interfaccia e' gia' disegnata con i colori di serie. Su un tema chiaro
 * quel vuoto e' un lampo nero a tutto schermo a ogni apertura.
 *
 * Quindi una copia sola, qui, letta e applicata prima ancora che React monti:
 * `localStorage` e' sincrono, e questo e' uno dei pochi casi in cui quella
 * proprieta' e' esattamente cio' che serve. Non e' la verita' — la verita'
 * resta nelle impostazioni — e' un'anticipazione che vive un decimo di secondo.
 */
const CHIAVE_COPIA = 'pulsetalk.tema'

/**
 * Scrive i dodici colori sulla radice del documento.
 *
 * Su `--pt-*` e non su `--color-*`, ed e' obbligatorio: `--color-*` e' cio' che
 * Tailwind ha gia' letto in fase di compilazione, e le utility con
 * un'opacita' — `bg-ok/10`, `bg-fondo-2/95` — se lo sono portato dentro
 * come colore fisso. Riscriverlo qui cambierebbe le tinte piene e lascerebbe
 * indietro tutte quelle trasparenti. Il perche' per esteso sta in `index.css`,
 * accanto alle due dichiarazioni.
 */
export function applicaColori(colori: Colori): void {
  const radice = document.documentElement
  for (const chiave of CHIAVI) radice.style.setProperty(`--pt-${chiave}`, colori[chiave])

  // La tinta che Android usa per la barra di sistema, e quella che il browser
  // mette intorno alla pagina: stanno fuori dal foglio di stile e vanno spinte
  // a mano, altrimenti restano quelle scritte nell'HTML.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', colori.fondo)

  // `color-scheme` decide di che colore il browser disegna cio' che non e'
  // nostro: le barre di scorrimento native, la tendina di un `select`, il
  // calendario di un campo data. Su un tema chiaro restavano neri.
  const fondo = leggiEsadecimale(colori.fondo)
  radice.style.colorScheme = fondo && luminosita(fondo) > 0.5 ? 'light' : 'dark'
}

/** Applica un tema e ne lascia la copia per la prossima apertura. */
export function applicaTema(tema: Tema | undefined | null): void {
  const colori = coloriDi(tema)
  applicaColori(colori)
  try {
    localStorage.setItem(CHIAVE_COPIA, JSON.stringify(colori))
  } catch {
    // Spazio finito, o `localStorage` negato in una finestra privata: si perde
    // solo l'anticipazione all'avvio, e il tema vero arriva un istante dopo.
  }
}

/**
 * Il tema di ieri, rimesso su prima del primo disegno.
 *
 * Si chiama da `main.tsx`, fuori da React e prima di `createRoot`.
 */
export function applicaTemaSalvato(): void {
  try {
    const letto = localStorage.getItem(CHIAVE_COPIA)
    if (!letto) return
    const colori = JSON.parse(letto) as Partial<Colori>
    // Solo se ci sono tutti e dodici e sono tutti leggibili: mezza copia
    // dipingerebbe un'app meta' di un tema e meta' dell'altro.
    if (CHIAVI.some((c) => !colori[c] || !leggiEsadecimale(colori[c]!))) return
    applicaColori(colori as Colori)
  } catch {
    // Una copia rotta non deve impedire l'avvio: si parte dai colori di serie.
  }
}
