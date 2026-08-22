// sgombero.mjs - i permessi che cambiano mentre qualcuno sta gia' parlando.
//
// Un gettone della SFU vale sei ore e la SFU non ci richiede niente dopo
// l'ingresso: e' cio' che permette a una chiamata di continuare anche se il
// piano di controllo si riavvia, ed e' anche il buco per cui togliere a
// qualcuno il permesso di entrare in un canale non lo fa uscire da li'.
//
// Chiudere il buco con gettoni brevi vorrebbe dire una rinegoziazione ogni
// pochi minuti per tutti, per un caso che capita una volta al mese. Invece si
// guarda chi c'e' dentro nel momento in cui i permessi cambiano davvero, e si
// caccia chi non potrebbe piu' entrare. Un giro sui canali vocali di uno
// spazio: pochi canali, poche persone, e solo quando qualcuno tocca i ruoli.

/**
 * Butta fuori dai vocali di questo spazio chi ha appena perso `connect`.
 *
 * Non lancia mai: se la SFU non risponde, il peggio che succede e' che quella
 * persona resta dentro fino a quando esce da sola. Far fallire una modifica ai
 * ruoli perche' un container non risponde sarebbe peggio del problema.
 */
export async function sgomberaChiNonPuoPiu(db, presenze, spazioId, log = null) {
  let dentro;
  try {
    dentro = await presenze.leggi();
  } catch {
    return 0;
  }

  const spazio = db.spazio(spazioId);
  if (!spazio) return 0;

  let cacciati = 0;

  for (const canale of db.canaliDi(spazioId)) {
    if (canale.tipo !== 'voce') continue;
    const presenti = dentro.get(db.chiaveSfu(canale)) ?? [];
    if (presenti.length === 0) continue;

    for (const persona of presenti) {
      // L'identita' sulla SFU e' `u<id>`: qualunque altra cosa non e' una
      // persona di questo database, e non la si tocca.
      const id = /^u(\d+)$/.exec(persona.identita)?.[1];
      if (!id) continue;

      const utente = db.utente(Number(id));
      if (!utente) continue;

      const permessi = db.permessiIn(utente, { spazio, canale });
      const dentroDavvero =
        permessi.has('viewChannel') &&
        permessi.has('connect') &&
        !!db.ruoloNelloSpazio(spazioId, utente);
      if (dentroDavvero) continue;

      await presenze.caccia(db.chiaveSfu(canale), persona.identita).catch(() => {});
      cacciati += 1;
      log?.info({ chi: utente.id, canale: canale.id }, 'fuori dal vocale: permessi cambiati');
    }
  }

  return cacciati;
}
