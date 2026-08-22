// dati/inviti-spazio.mjs - i codici che fanno entrare in uno spazio.
//
// Cosa diversa dagli inviti dell'istanza, che stanno in db.mjs e fanno nascere
// un account. Questi presuppongono che l'account ci sia gia': aprono una porta
// su uno spazio, e possono generarli anche i membri normali quando il permesso
// createInvites glielo consente.
//
// Come sempre da queste parti, il codice in chiaro esiste per il tempo di una
// risposta HTTP: sul disco resta la sua impronta, e nessuna rotta puo'
// ristamparlo. Se si perde se ne fa un altro.

import { createHash, randomBytes } from 'node:crypto';

const ora = () => Math.floor(Date.now() / 1000);
const impronta = (valore) => createHash('sha256').update(valore, 'utf8').digest('hex');

export function creaInvitiSpazio(sql) {
  const q = {
    inserisci: sql.prepare(
      `INSERT INTO inviti_spazio (spazio, impronta, creatoDa, creato, scade, usiMax, ruolo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    perImpronta: sql.prepare('SELECT * FROM inviti_spazio WHERE impronta = ?'),
    perId: sql.prepare('SELECT * FROM inviti_spazio WHERE id = ?'),
    dello: sql.prepare(
      `SELECT i.*, u.nome AS nomeCreatore, r.nome AS nomeRuolo
         FROM inviti_spazio i
         LEFT JOIN utenti u ON u.id = i.creatoDa
         LEFT JOIN ruoli r ON r.id = i.ruolo
        WHERE i.spazio = ? AND i.scade > ? AND (i.usiMax = 0 OR i.usi < i.usiMax)
        ORDER BY i.creato DESC`,
    ),
    elimina: sql.prepare('DELETE FROM inviti_spazio WHERE id = ?'),
    consuma: sql.prepare(
      `UPDATE inviti_spazio SET usi = usi + 1
        WHERE id = ? AND scade > ? AND (usiMax = 0 OR usi < usiMax)`,
    ),
  };

  const problema = (riga) => {
    if (!riga) return 'codice non valido';
    if (riga.scade < ora()) return 'codice scaduto';
    if (riga.usiMax > 0 && riga.usi >= riga.usiMax) return 'codice gia\' usato';
    return null;
  };

  return {
    crea(spazioId, { creatoDa = null, giorni = 7, usiMax = 0, ruolo = null } = {}) {
      // 18 byte in base64url: entrano in un link, si leggono al telefono, e
      // sono 144 bit — nessuno li indovina.
      const codice = randomBytes(18).toString('base64url');
      const ins = q.inserisci.run(
        spazioId,
        impronta(codice),
        creatoDa,
        ora(),
        ora() + Math.max(1, Math.min(30, giorni)) * 86400,
        Math.max(0, Math.min(500, usiMax)),
        ruolo,
      );
      return { codice, invito: q.perId.get(Number(ins.lastInsertRowid)) };
    },

    /** Cosa apre questo codice, senza consumarlo. */
    guarda(codice) {
      const riga = q.perImpronta.get(impronta(String(codice)));
      const male = problema(riga);
      return male ? { errore: male } : { invito: riga };
    },

    /**
     * Lo consuma. Il contatore si alza dentro alla UPDATE, non prima.
     *
     * E' cosi' che due persone che riscattano l'ultimo posto nello stesso
     * istante non entrano entrambe: la condizione sta nella WHERE, e SQLite
     * garantisce che una sola delle due righe cambi.
     */
    consuma(codice) {
      const riga = q.perImpronta.get(impronta(String(codice)));
      const male = problema(riga);
      if (male) return { errore: male };
      if (q.consuma.run(riga.id, ora()).changes !== 1) return { errore: 'codice gia\' usato' };
      return { invito: riga };
    },

    aperti(spazioId) {
      return q.dello.all(spazioId, ora());
    },

    invito(id) {
      return q.perId.get(id) ?? null;
    },

    elimina(id) {
      return q.elimina.run(id).changes;
    },
  };
}
