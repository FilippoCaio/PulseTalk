// stati.mjs - chi c'e', chi non c'e', e chi non vuole essere disturbato.
//
// Fino a ieri lo stato era soltanto una parola salvata sull'utente: chi si
// metteva "online" restava online per sempre, anche a computer spento, anche
// dopo tre giorni. Non era un dettaglio estetico — l'unico modo per sapere se
// valeva la pena scrivere a qualcuno era scrivergli.
//
// Qui la parola scelta a mano e la presenza vera si incontrano. La presenza
// vera non ha bisogno di essere dichiarata: il flusso SSE e' aperto o non lo
// e', e quella e' la definizione di "c'e'". Chiudere l'applicazione chiude il
// flusso, e la persona sparisce senza che nessuno debba ricordarsi di dirlo.
//
// Le tre regole che decidono cosa vedono gli altri:
//
//   **Invisibile non si dice mai.** Da fuori e' indistinguibile da offline, ed
//   e' l'unico modo perche' invisibile serva a qualcosa.
//
//   **Non disturbare resta anche da spenti.** E' l'unico stato che sopravvive
//   alla chiusura: chi lo mette la sera lo mette proprio perche' non vuole
//   essere cercato, e vederlo diventare "offline" alle due di notte non
//   cambierebbe niente per lui ma toglierebbe la risposta a chi guarda —
//   "non c'e'" e "non vuole" sono due cose diverse.
//
//   **Inattivo non si sceglie.** Lo dichiara l'applicazione dopo dieci minuti
//   in cui si e' li' ma non si parla (vedi il client). Sceglierlo a mano non
//   aveva senso: dire "non sono davanti allo schermo" mentre si preme il
//   pulsante per dirlo e' una contraddizione, e infatti nessuno lo usava.

/** Gli stati che una persona puo' scegliere. `inattivo` non e' fra questi. */
export const STATI_SCELTI = ['online', 'occupato', 'invisibile'];

/** Cio' che puo' arrivare agli altri. `invisibile` non c'e': da fuori e' offline. */
export const STATI_VISIBILI = ['online', 'inattivo', 'occupato', 'offline'];

export function creaStati({ eventi, db }) {
  // Chi ha dichiarato di essere fermo. Sta in memoria e non sul disco: e' una
  // condizione del momento, e un riavvio del server la azzera come deve —
  // dopo un riavvio nessuno e' inattivo finche' non lo ridichiara.
  const inattivi = new Set();

  eventi.quandoCambiaPresenza((utente, collegato) => {
    // Chiudendo l'applicazione l'inattivita' non ha piu' senso: si e' offline,
    // che e' un'altra cosa. Lasciarla ferma qui vorrebbe dire tornare online
    // domani mattina gia' inattivi.
    if (!collegato) inattivi.delete(utente);
    annuncia(utente);
  });

  /**
   * Cosa vede chi guarda questa persona.
   *
   * Prende la riga dell'utente cosi' com'e' nel database, perche' chi chiama ce
   * l'ha gia' in mano e rileggerla qui vorrebbe dire una query per ogni faccia
   * in un elenco di duecento.
   */
  function visibile(utente) {
    if (!utente) return 'offline';
    const scelto = utente.stato ?? 'online';

    if (scelto === 'invisibile') return 'offline';
    if (scelto === 'occupato') return 'occupato';
    if (!eventi.collegato(utente.id)) return 'offline';

    return inattivi.has(utente.id) ? 'inattivo' : 'online';
  }

  /**
   * L'applicazione dice se e' ferma o no.
   *
   * Restituisce se qualcosa e' cambiato davvero: il client lo ridichiara ogni
   * tanto per sopravvivere a una riconnessione, e ripetere lo stesso valore non
   * deve svegliare tutti gli altri.
   */
  function dichiaraInattivita(utenteId, fermo) {
    const prima = inattivi.has(utenteId);
    if (prima === Boolean(fermo)) return false;
    if (fermo) inattivi.add(utenteId);
    else inattivi.delete(utenteId);
    annuncia(utenteId);
    return true;
  }

  /**
   * Dice a tutti come sta adesso quella persona.
   *
   * A tutti e non solo a chi condivide uno spazio: l'elenco dei profili
   * (`GET /api/utenti`) e' gia' visibile a chiunque abbia un account, e mandare
   * l'aggiornamento a meno persone di quante possono leggerlo con una GET
   * vorrebbe dire soltanto delle facce ferme sullo stato di ieri.
   *
   * `invisibile` non fa eccezione: passa da qui come tutti, ma cio' che esce e'
   * `offline`, e nessuno puo' distinguerlo da un computer spento.
   */
  function annuncia(utenteId) {
    eventi.aTutti({
      tipo: 'stato-utente',
      utente: utenteId,
      stato: visibile(db.utente(utenteId)),
    });
  }

  return {
    visibile,
    dichiaraInattivita,
    annuncia,
    /** Solo per i test: chi risulta fermo adesso. */
    get inattivi() {
      return new Set(inattivi);
    },
  };
}
