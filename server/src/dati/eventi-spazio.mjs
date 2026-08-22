// dati/eventi-spazio.mjs - "giovedi' alle nove si gioca".
//
// Un evento e' poco piu' di una riga in agenda: titolo, quando, dove, e chi ha
// detto che ci sara'. Sta sul server e non nella testa di chi organizza perche'
// e' l'unica cosa che rende possibile ricordarlo a tutti allo stesso momento.
//
// Le date sono secondi epoch, come tutto il resto del database. Il fuso orario
// non si salva: chi legge ha il suo, e l'unico istante che conta e' lo stesso
// per tutti.

const ora = () => Math.floor(Date.now() / 1000);

export function creaEventiSpazio(sql) {
  const q = {
    inserisci: sql.prepare(
      `INSERT INTO eventi_spazio (spazio, canale, titolo, descrizione, inizio, fine, creatoDa, creato)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    perId: sql.prepare('SELECT * FROM eventi_spazio WHERE id = ?'),
    dello: sql.prepare(
      `SELECT * FROM eventi_spazio
        WHERE spazio = ? AND (stato <> 'annullato' OR ? = 1)
        ORDER BY inizio`,
    ),
    elimina: sql.prepare('DELETE FROM eventi_spazio WHERE id = ?'),
    interesse: sql.prepare(
      `INSERT INTO eventi_interesse (evento, utente, stato, istante) VALUES (?, ?, ?, ?)
       ON CONFLICT (evento, utente) DO UPDATE SET stato = excluded.stato, istante = excluded.istante`,
    ),
    disinteresse: sql.prepare('DELETE FROM eventi_interesse WHERE evento = ? AND utente = ?'),
    partecipanti: sql.prepare(
      `SELECT e.utente, e.stato, u.nome, u.avatar
         FROM eventi_interesse e JOIN utenti u ON u.id = e.utente
        WHERE e.evento = ? ORDER BY e.istante`,
    ),
  };

  const conPartecipanti = (riga) =>
    riga ? { ...riga, partecipanti: q.partecipanti.all(riga.id) } : null;

  return {
    crea(spazioId, { titolo, descrizione = '', inizio, fine = null, canale = null, creatoDa = null }) {
      const ins = q.inserisci.run(
        spazioId,
        canale,
        String(titolo).trim().slice(0, 120),
        String(descrizione).slice(0, 2000),
        Number(inizio),
        fine === null ? null : Number(fine),
        creatoDa,
        ora(),
      );
      return conPartecipanti(q.perId.get(Number(ins.lastInsertRowid)));
    },

    evento(id) {
      return conPartecipanti(q.perId.get(id));
    },

    /** Gli eventi di uno spazio. Quelli annullati restano visibili a chi gestisce. */
    dello(spazioId, { conAnnullati = false } = {}) {
      return q.dello.all(spazioId, conAnnullati ? 1 : 0).map(conPartecipanti);
    },

    aggiorna(id, { titolo, descrizione, inizio, fine, canale, stato }) {
      const attuale = q.perId.get(id);
      if (!attuale) return null;
      sql
        .prepare(
          `UPDATE eventi_spazio
              SET titolo = ?, descrizione = ?, inizio = ?, fine = ?, canale = ?, stato = ?
            WHERE id = ?`,
        )
        .run(
          titolo === undefined ? attuale.titolo : String(titolo).trim().slice(0, 120),
          descrizione === undefined ? attuale.descrizione : String(descrizione).slice(0, 2000),
          inizio === undefined ? attuale.inizio : Number(inizio),
          fine === undefined ? attuale.fine : fine === null ? null : Number(fine),
          canale === undefined ? attuale.canale : canale,
          stato === undefined ? attuale.stato : stato,
          id,
        );
      return conPartecipanti(q.perId.get(id));
    },

    elimina(id) {
      return q.elimina.run(id).changes;
    },

    /**
     * "Ci sono" / "forse" / "non ci sono".
     *
     * Uno stato vuoto toglie la riga invece di scrivere "niente": un elenco di
     * partecipanti in cui meta' delle righe dicono che non parteciperanno e'
     * un elenco che nessuno legge.
     */
    segna(eventoId, utenteId, stato) {
      if (!stato) return q.disinteresse.run(eventoId, utenteId).changes;
      q.interesse.run(eventoId, utenteId, stato, ora());
      return 1;
    },

    partecipanti(eventoId) {
      return q.partecipanti.all(eventoId);
    },
  };
}
