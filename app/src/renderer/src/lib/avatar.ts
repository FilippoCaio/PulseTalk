/**
 * L'avatar di chi non ha una foto.
 *
 * Iniziali su un colore, come fanno tutti, con una regola sola che vale la
 * pena rispettare: il colore si ricava dall'**identita'**, non dal nome. Due
 * persone che si chiamano entrambe Marco devono avere due colori diversi,
 * altrimenti l'avatar smette di distinguere proprio nel caso in cui servirebbe.
 *
 * Quando gli account avranno una foto vera, questa resta il ripiego: chi non
 * l'ha caricata continua ad avere qualcosa di riconoscibile invece di una
 * sagoma grigia uguale per tutti.
 */

// Colori scelti per stare su un fondo scuro senza gridare, e abbastanza
// distanti fra loro da riconoscersi con la coda dell'occhio in una griglia.
const COLORI = [
  '#4f9cf9', // blu
  '#3ecf8e', // verde
  '#f5a524', // ambra
  '#f4525a', // rosso
  '#a78bfa', // viola
  '#22d3ee', // ciano
  '#fb923c', // arancio
  '#f472b6', // rosa
  '#84cc16', // lime
  '#38bdf8' // azzurro
]

function impronta(testo: string): number {
  // djb2. Non serve una funzione crittografica per scegliere un colore, e
  // questa sta in tre righe e da' sempre lo stesso risultato ovunque.
  let h = 5381
  for (let i = 0; i < testo.length; i += 1) {
    h = ((h << 5) + h + testo.charCodeAt(i)) >>> 0
  }
  return h
}

export function coloreDi(identita: string): string {
  return COLORI[impronta(identita) % COLORI.length]
}

/**
 * Una o due lettere.
 *
 * "Marco Rossi" -> MR, "Ada" -> A. Con i nomi che cominciano per emoji o
 * per simbolo non resta niente da mostrare: in quel caso meglio un punto
 * interrogativo di un riquadro vuoto che sembra rotto.
 */
export function inizialiDi(nome: string): string {
  const parole = nome
    .trim()
    .split(/\s+/)
    .map((p) => [...p].find((c) => /\p{L}|\p{N}/u.test(c)))
    .filter((c): c is string => !!c)

  if (parole.length === 0) return '?'
  if (parole.length === 1) return parole[0].toUpperCase()
  return (parole[0] + parole[parole.length - 1]).toUpperCase()
}
