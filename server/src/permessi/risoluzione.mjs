// permessi/risoluzione.mjs - da cosa hai a cosa puoi, in un posto solo.
//
// La regola e' una catena di tre anelli, e non ce n'e' un quarto da nessuna
// parte:
//
//   permessi dello spazio  ->  override della categoria  ->  override del canale
//
// Chi vuole sapere se qualcuno puo' fare qualcosa chiama `risolvi` e legge il
// risultato. Nessuna rotta ricalcola niente per conto suo: e' l'unico modo per
// non ritrovarsi, fra sei mesi, con due idee diverse di chi puo' parlare in un
// canale — e a divergere e' sempre quella che concede.
//
// Questo modulo non conosce il database. Gli si passano righe gia' lette e
// restituisce un insieme di stringhe: cosi' si puo' provare da solo, con dati
// scritti a mano, senza montare un server.

import { PERMESSI } from './catalogo.mjs';

/**
 * Cosa puo' fare questa persona, qui.
 *
 * @param {object} dati
 * @param {Array<{id:number,tipo:string,priorita:number,permessi:string[]}>} dati.ruoli
 *        I ruoli che questa persona ha in questo spazio, base compreso.
 * @param {number} dati.utente id di chi chiede, per gli override personali.
 * @param {boolean} [dati.proprietario] se e' il proprietario dello spazio.
 * @param {boolean} [dati.amministratoreIstanza] se e' admin dell'installazione.
 * @param {Array<object>} [dati.overrideCategoria] righe di `permessi_override`.
 * @param {Array<object>} [dati.overrideCanale] righe di `permessi_override`.
 * @returns {Set<string>}
 */
export function risolvi({
  ruoli = [],
  utente,
  proprietario = false,
  amministratoreIstanza = false,
  overrideCategoria = [],
  overrideCanale = [],
}) {
  // Il proprietario e l'admin dell'installazione hanno tutto, e nessun
  // override glielo toglie.
  //
  // Non e' pigrizia: chi amministra la macchina ha il file del database sotto
  // mano, e fingere che un permesso possa fermarlo sarebbe una recita. Il
  // proprietario, allo stesso modo, deve poter rientrare in casa propria anche
  // dopo essersi tolto un permesso per sbaglio — altrimenti l'unico rimedio
  // sarebbe aprire SQLite a mano.
  if (amministratoreIstanza || proprietario) return new Set(PERMESSI);

  const avuti = new Set();
  for (const ruolo of ruoli) {
    // Un ruolo di tipo admin non elenca i suoi permessi: li ha tutti, oggi e
    // anche quelli che verranno aggiunti domani.
    if (ruolo.tipo === 'admin') return new Set(PERMESSI);
    for (const p of ruolo.permessi ?? []) avuti.add(p);
  }

  applica(avuti, overrideCategoria, ruoli, utente);
  applica(avuti, overrideCanale, ruoli, utente);
  return avuti;
}

/**
 * Un livello di override, nell'ordine che conta.
 *
 * Prima i ruoli dal piu' debole al piu' forte, cosi' che un ruolo alto possa
 * restituire cio' che uno basso aveva tolto. Poi la persona, che vince su
 * tutti: un override personale e' stato scritto per quella riga li', e se
 * perdesse contro un ruolo non servirebbe a niente.
 */
function applica(insieme, override, ruoli, utente) {
  if (override.length === 0) return;

  const priorita = new Map(ruoli.map((r) => [r.id, r.priorita ?? 0]));
  const deiRuoli = override
    .filter((o) => o.tipo === 'ruolo' && priorita.has(o.soggetto))
    .sort((a, b) => (priorita.get(a.soggetto) ?? 0) - (priorita.get(b.soggetto) ?? 0));

  for (const riga of deiRuoli) applicaRiga(insieme, riga);

  for (const riga of override) {
    if (riga.tipo === 'utente' && riga.soggetto === utente) applicaRiga(insieme, riga);
  }
}

function applicaRiga(insieme, riga) {
  for (const p of riga.nega ?? []) insieme.delete(p);
  for (const p of riga.consenti ?? []) insieme.add(p);
}
