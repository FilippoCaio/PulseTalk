// permessi.mjs - chi puo' fare cosa, e dove.
//
// Un posto solo che risponde, invece della stessa catena di controlli
// ricopiata in ogni rotta. Le regole sono tre e stanno in tre righe:
//
//   per vedere uno spazio        bisogna esserne membri
//   per cambiarne la forma       bisogna esserne admin
//   per parlare in un canale     bisogna poter trasmettere
//
// Le funzioni restituiscono un errore invece di lanciarlo: una rotta che
// dimentica di controllare il valore di ritorno e' un bug che si vede subito
// leggendo, mentre un'eccezione dimenticata sembra codice a posto.

export function accessoAlloSpazio(db, utente, spazioId, minimo = 'membro') {
  const spazio = db.spazio(Number(spazioId));
  if (!spazio) return { errore: 'spazio inesistente', stato: 404 };

  const ruolo = db.ruoloNelloSpazio(spazio.id, utente);
  // 404 e non 403 per chi non e' membro: dire "esiste ma non entri" racconta a
  // chi prova quali spazi esistono. Chi non ne fa parte non deve nemmeno
  // sapere che c'e'.
  if (!ruolo) return { errore: 'spazio inesistente', stato: 404 };

  if (minimo === 'admin' && ruolo !== 'admin') {
    return { errore: 'serve essere admin di questo spazio', stato: 403 };
  }
  return { spazio, ruolo };
}

export function accessoAlCanale(db, utente, canaleId, minimo = 'membro') {
  const canale = db.canale(Number(canaleId));
  if (!canale) return { errore: 'canale inesistente', stato: 404 };

  const esito = accessoAlloSpazio(db, utente, canale.spazio, minimo);
  if (esito.errore) return esito;

  // Un canale privato, per chi non e' stato invitato, non esiste. E 404 come
  // per gli spazi, non 403: un "non puoi entrare" direbbe comunque che quel
  // canale c'e', e con un nome davanti agli occhi si indovina il resto.
  if (canale.privato && esito.ruolo !== 'admin' && !db.eIscritto(canale.id, utente.id)) {
    return { errore: 'canale inesistente', stato: 404 };
  }

  return { canale, spazio: esito.spazio, ruolo: esito.ruolo };
}

/**
 * Se puo' cambiare chi sta dentro a un canale privato.
 *
 * Gli admin dello spazio, e chi e' gia' dentro. La seconda meta' e' una scelta:
 * in un gruppo di amici il canale privato lo apre chi organizza qualcosa, e
 * dover chiedere all'amministratore del NAS il permesso di aggiungere un amico
 * trasformerebbe una cosa spiccia in una pratica.
 */
export function puoInvitare(db, utente, canale, ruolo) {
  if (ruolo === 'admin') return true;
  return db.eIscritto(canale.id, utente.id);
}

/**
 * Se puo' trasmettere in questo canale vocale.
 *
 * Il permesso e' il prodotto di tre cose: il ruolo nell'istanza (un ospite non
 * trasmette mai), il ruolo nello spazio, e se il canale e' da palco. Non e' una
 * proprieta' della persona ne' del canale: e' l'incrocio.
 */
export function puoTrasmettere({ utente, ruoloSpazio, canale }) {
  if (utente.ruolo === 'ospite') return false;
  if (canale.soloAscolto) return ruoloSpazio === 'admin';
  return true;
}
