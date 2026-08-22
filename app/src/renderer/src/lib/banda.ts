/**
 * Chi si prende la linea, e chi deve farsi da parte.
 *
 * Un modulo con dentro un booleano, e sembra troppo poco per meritarsi un
 * file. Il punto e' chi lo legge: il caricamento di un allegato parte dalla
 * chat, che della chiamata non sa niente e non deve saperne — passarle la
 * sessione vocale solo per questo vorrebbe dire legare due parti
 * dell'applicazione che stanno bene separate.
 *
 * La regola e' una: mentre c'e' una chiamata aperta, un file che sale non deve
 * mangiarsi la banda che serve alle voci.
 */

let chiamataAperta = false

/** La dice la sessione vocale, entrando e uscendo da un canale. */
export function segnalaChiamata(attiva: boolean): void {
  chiamataAperta = attiva
}

export function inChiamata(): boolean {
  return chiamataAperta
}

/**
 * Quante volte il tempo di un pezzo si sta fermi, mentre si e' in chiamata.
 *
 * Tre: si manda per un quarto del tempo e si aspetta per tre quarti, quindi il
 * caricamento si prende all'incirca un quarto di quello che la linea puo'
 * dare. Il numero e' arbitrario, ma il modo di calcolarlo no — misurando
 * quanto ci ha messo il pezzo appena andato, la pausa si adatta da sola alla
 * linea che si ha, senza doverne conoscere la velocita'.
 */
const QUOTA = 3

/** Il tetto della pausa: oltre, un caricamento sembrerebbe piantato. */
const PAUSA_MASSIMA = 4000

/**
 * La pausa fra un pezzo e l'altro.
 *
 * Fuori da una chiamata non aspetta niente: se nessuno sta parlando, la linea
 * e' li' per quello.
 */
export function respira(quantoCiHaMesso: number): Promise<void> {
  if (!chiamataAperta) return Promise.resolve()
  const attesa = Math.min(quantoCiHaMesso * QUOTA, PAUSA_MASSIMA)
  return new Promise((finito) => setTimeout(finito, attesa))
}
