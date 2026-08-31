/**
 * Le lingue, e la scelta che decide come sono fatte tutte le altre.
 *
 * ## La chiave e' la frase italiana
 *
 * Non `accesso.pulsante.entra`, ma `Entra`. E' la decisione che pesa di piu' su
 * tutto il resto, quindi vale la pena dire perche'.
 *
 * **Il codice resta leggibile.** Questa applicazione e' scritta in italiano
 * fino in fondo — i nomi delle funzioni, dei file, i commenti — e riempirla di
 * `t('atrio.server.titolo')` avrebbe voluto dire un secondo vocabolario da
 * inventare, da ricordare e da tenere allineato, in mezzo a un codice che il
 * primo vocabolario ce l'ha gia'. Con la frase come chiave, leggendo il
 * sorgente si legge ancora cio' che compare a schermo.
 *
 * **Cio' che manca degrada bene.** Una chiave assente non lascia
 * `atrio.server.titolo` in faccia a qualcuno: lascia la frase italiana, che e'
 * una lingua vera. Un pacchetto tradotto a meta' produce un'app meta'
 * italiana, brutta ma comprensibile; con le chiavi simboliche produce un'app
 * meta' rotta.
 *
 * Il costo c'e' ed e' onesto: correggere un refuso nell'italiano scollega la
 * traduzione di quella frase. Si paga con `mancanti()`, che dice quali chiavi
 * un pacchetto non copre — e a quel punto la traduzione persa e' una riga in
 * un elenco invece di una sorpresa in produzione.
 *
 * ## Italiano non ha un pacchetto
 *
 * Perche' non gli serve: la chiave *e'* la frase. Il pacchetto italiano
 * sarebbe un file in cui ogni riga dice che «Entra» si traduce «Entra», cioe'
 * un file da tenere aggiornato per non fare niente.
 */

export interface Lingua {
  /** Il codice ISO, quello che finisce nelle impostazioni e nel nome del file. */
  codice: string
  /** Come si chiama **nella propria lingua**: chi cerca il tedesco cerca «Deutsch». */
  nome: string
  bandiera: string
}

/**
 * Quelle che l'applicazione conosce.
 *
 * Conoscerle non vuol dire averle tradotte: qui c'e' l'elenco di cio' che si
 * puo' scegliere, e `catalogo` dira' quanto e' coperta ciascuna. Una lingua
 * senza pacchetto resta scegliibile e mostra italiano — che e' meno peggio di
 * nasconderla, perche' chi la cerca almeno scopre che esiste e manca.
 */
export const LINGUE: Lingua[] = [
  { codice: 'it', nome: 'Italiano', bandiera: '\u{1F1EE}\u{1F1F9}' },
  { codice: 'en', nome: 'English', bandiera: '\u{1F1EC}\u{1F1E7}' },
  { codice: 'es', nome: 'Español', bandiera: '\u{1F1EA}\u{1F1F8}' },
  { codice: 'fr', nome: 'Français', bandiera: '\u{1F1EB}\u{1F1F7}' },
  { codice: 'de', nome: 'Deutsch', bandiera: '\u{1F1E9}\u{1F1EA}' }
]

/** La lingua in cui e' scritto il sorgente: quella che non ha bisogno di pacchetto. */
export const LINGUA_SORGENTE = 'it'

/** Frase italiana -> frase tradotta. Cio' che manca resta in italiano. */
export type Dizionario = Record<string, string>

export function lingua(codice: string): Lingua | null {
  return LINGUE.find((l) => l.codice === codice) ?? null
}

/**
 * La lingua da proporre a chi non ha ancora scelto.
 *
 * Si guarda cosa dice il sistema, e la si accetta solo se e' una che
 * conosciamo: `navigator.language` puo' dire `en-GB`, e ci interessa `en`.
 * Tutto il resto ricade sull'italiano, che e' la lingua in cui l'app e' scritta
 * e quindi l'unica coperta al cento per cento.
 */
export function linguaDelSistema(dichiarate: readonly string[]): string {
  for (const grezza of dichiarate) {
    const corta = String(grezza).toLowerCase().split('-')[0]
    if (LINGUE.some((l) => l.codice === corta)) return corta
  }
  return LINGUA_SORGENTE
}
