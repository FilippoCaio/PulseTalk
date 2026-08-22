// permessi.mjs - chi puo' fare cosa, e dove.
//
// Un posto solo che risponde, invece della stessa catena di controlli
// ricopiata in ogni rotta. Da qui passano tre domande:
//
//   posso vedere questo spazio?     -> accessoAlloSpazio
//   posso vedere questo canale?     -> accessoAlCanale
//   posso fare questa cosa qui?     -> permesso / richiedePermesso
//
// La terza e' quella nuova, ed e' quella che conta: il permesso vero lo
// calcola sempre il database incrociando ruoli, override di categoria e
// override di canale (vedi permessi/risoluzione.mjs). Nessuna rotta se lo
// ricalcola per conto suo, e nessuna si accontenta di cio' che l'interfaccia
// avrebbe dovuto nascondere — un pulsante nascosto e' cortesia, non sicurezza.
//
// Le funzioni restituiscono un errore invece di lanciarlo: una rotta che
// dimentica di controllare il valore di ritorno e' un bug che si vede subito
// leggendo, mentre un'eccezione dimenticata sembra codice a posto.

export function accessoAlloSpazio(db, utente, spazioId, minimo = 'membro') {
  const spazio = db.spazio(Number(spazioId));
  if (!spazio) return { errore: 'spazio inesistente', stato: 404 };

  // Gli spazi di sistema — quello che tiene i canali dei messaggi diretti —
  // non si raggiungono dalle rotte degli spazi. Non hanno impostazioni, non
  // hanno ruoli, e le loro conversazioni si aprono solo dalle rotte dei DM,
  // che controllano l'iscrizione al singolo canale.
  if (spazio.sistema) return { errore: 'spazio inesistente', stato: 404 };

  const ruolo = db.ruoloNelloSpazio(spazio.id, utente);
  // 404 e non 403 per chi non e' membro: dire "esiste ma non entri" racconta a
  // chi prova quali spazi esistono. Chi non ne fa parte non deve nemmeno
  // sapere che c'e'.
  if (!ruolo) return { errore: 'spazio inesistente', stato: 404 };

  const permessi = db.permessiIn(utente, { spazio });

  if (minimo === 'admin' && !permessi.has('manageServer')) {
    return { errore: 'serve amministrare questo spazio', stato: 403 };
  }
  return { spazio, ruolo, permessi };
}

export function accessoAlCanale(db, utente, canaleId, minimo = 'membro') {
  const canale = db.canale(Number(canaleId));
  if (!canale) return { errore: 'canale inesistente', stato: 404 };

  const spazio = db.spazio(canale.spazio);
  if (!spazio) return { errore: 'canale inesistente', stato: 404 };

  // Un canale di un messaggio diretto: ci si sta se ci si e' dentro, e basta.
  // Nessun ruolo, nessun proprietario, nessun admin dell'istanza che passa
  // sopra — una conversazione fra due persone non ha un piano di sopra.
  if (spazio.sistema) {
    if (!db.eIscritto(canale.id, utente.id)) {
      return { errore: 'canale inesistente', stato: 404 };
    }
    return {
      canale,
      spazio,
      ruolo: 'membro',
      diretto: true,
      permessi: new Set(['viewChannel', 'sendMessages', 'connect', 'speak', 'stream']),
    };
  }

  const esito = accessoAlloSpazio(db, utente, canale.spazio, minimo);
  if (esito.errore) return esito;

  // Un canale privato, per chi non e' stato invitato, non esiste. E 404 come
  // per gli spazi, non 403: un "non puoi entrare" direbbe comunque che quel
  // canale c'e', e con un nome davanti agli occhi si indovina il resto.
  if (canale.privato && esito.ruolo !== 'admin' && !db.eIscritto(canale.id, utente.id)) {
    return { errore: 'canale inesistente', stato: 404 };
  }

  const permessi = db.permessiIn(utente, { spazio: esito.spazio, canale });
  // Stessa scelta, per la stessa ragione: un canale che non si puo' vedere non
  // esiste. Vale anche per chi amministra lo spazio? No — chi amministra ha il
  // database sotto mano, e nascondergli un canale sarebbe una recita.
  if (!permessi.has('viewChannel') && esito.ruolo !== 'admin') {
    return { errore: 'canale inesistente', stato: 404 };
  }

  return { canale, spazio: esito.spazio, ruolo: esito.ruolo, permessi };
}

/**
 * Un permesso, sullo spazio o su un canale suo.
 *
 * E' la forma corta che usano quasi tutte le rotte: si chiede l'accesso e si
 * chiede il permesso in una riga sola, e cio' che torna e' o l'errore da
 * spedire o il contesto gia' pronto.
 */
export function richiedePermesso(db, utente, { spazio, canale = null }, permesso) {
  const esito = canale
    ? accessoAlCanale(db, utente, canale)
    : accessoAlloSpazio(db, utente, spazio);
  if (esito.errore) return esito;

  if (!esito.permessi.has(permesso)) {
    return { errore: `non hai il permesso "${permesso}" qui`, stato: 403, ...esito };
  }
  return esito;
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
 * Il permesso e' il prodotto di quattro cose: il ruolo nell'istanza (un ospite
 * non trasmette mai), i permessi risolti qui dentro, e se il canale e' da
 * palco. Non e' una proprieta' della persona ne' del canale: e' l'incrocio.
 */
export function puoTrasmettere({ utente, ruoloSpazio, canale, permessi = null }) {
  if (utente.ruolo === 'ospite') return false;
  if (canale.soloAscolto && ruoloSpazio !== 'admin') return false;
  // Senza insieme risolto si ricade sul comportamento di prima: e' il caso dei
  // canali diretti, dove i permessi non hanno un ruolo che li porti.
  return permessi ? permessi.has('speak') : true;
}

/** Se puo' anche solo entrare ad ascoltare. */
export function puoEntrare({ ruoloSpazio, permessi = null }) {
  if (ruoloSpazio === 'admin') return true;
  return permessi ? permessi.has('connect') : true;
}
