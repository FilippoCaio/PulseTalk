// dati/ruoli.mjs - ruoli, assegnazioni e override, letti e scritti.
//
// Sta fuori da db.mjs per una ragione sola: db.mjs e' gia' il file che si
// rilegge piu' spesso, e infilarci dentro altre quattrocento righe lo
// trasformerebbe in quel tipo di file che nessuno apre volentieri. Qui c'e'
// tutto e solo cio' che tocca le tabelle `ruoli`, `ruoli_membri`,
// `permessi_override` e `bandi`.
//
// Nessuna decisione: solo righe. Chi puo' fare cosa lo stabilisce
// permessi/risoluzione.mjs, a cui questi dati arrivano gia' letti.

import {
  PERMESSI_BASE,
  PERMESSI_MASTER,
  ripuliscePermessi,
} from '../permessi/catalogo.mjs';

const ora = () => Math.floor(Date.now() / 1000);

/** Da colonna TEXT a elenco. Una riga rotta vale zero permessi, non un errore. */
function elenco(grezzo) {
  try {
    const letto = JSON.parse(grezzo ?? '[]');
    return Array.isArray(letto) ? letto.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function ruoloDaRiga(riga) {
  return riga ? { ...riga, permessi: elenco(riga.permessi) } : null;
}

function overrideDaRiga(riga) {
  return { ...riga, consenti: elenco(riga.consenti), nega: elenco(riga.nega) };
}

/**
 * I tre ruoli che esistono in ogni spazio appena nato.
 *
 * Le priorita' sono distanziate di dieci: cosi' infilare un ruolo fra Master e
 * base non costringe a rinumerare tutto quello che c'e' sopra.
 */
const PREDEFINITI = [
  { tipo: 'admin', nome: 'Admin', colore: '#f4525a', priorita: 100, permessi: [] },
  { tipo: 'master', nome: 'Master', colore: '#4f9cf9', priorita: 90, permessi: PERMESSI_MASTER },
  { tipo: 'base', nome: 'Membri', colore: null, priorita: 0, permessi: PERMESSI_BASE },
];

export function creaRuoli(sql) {
  const q = {
    diSpazio: sql.prepare('SELECT * FROM ruoli WHERE spazio = ? ORDER BY priorita DESC, id'),
    perId: sql.prepare('SELECT * FROM ruoli WHERE id = ?'),
    perTipo: sql.prepare('SELECT * FROM ruoli WHERE spazio = ? AND tipo = ?'),
    inserisci: sql.prepare(
      `INSERT INTO ruoli (spazio, nome, colore, permessi, priorita, tipo, creato)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    elimina: sql.prepare('DELETE FROM ruoli WHERE id = ?'),
    assegna: sql.prepare('INSERT OR IGNORE INTO ruoli_membri (ruolo, utente, dato) VALUES (?, ?, ?)'),
    togli: sql.prepare('DELETE FROM ruoli_membri WHERE ruolo = ? AND utente = ?'),
    togliTutti: sql.prepare(
      `DELETE FROM ruoli_membri
        WHERE utente = ? AND ruolo IN (SELECT id FROM ruoli WHERE spazio = ?)`,
    ),
    diUtente: sql.prepare(
      `SELECT r.* FROM ruoli r
         JOIN ruoli_membri rm ON rm.ruolo = r.id
        WHERE r.spazio = ? AND rm.utente = ?
        ORDER BY r.priorita DESC, r.id`,
    ),
    membriDi: sql.prepare('SELECT utente FROM ruoli_membri WHERE ruolo = ?'),
    override: sql.prepare('SELECT * FROM permessi_override WHERE ambito = ? AND bersaglio = ?'),
    scriviOverride: sql.prepare(
      `INSERT INTO permessi_override (ambito, bersaglio, tipo, soggetto, consenti, nega)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (ambito, bersaglio, tipo, soggetto)
       DO UPDATE SET consenti = excluded.consenti, nega = excluded.nega`,
    ),
    cancellaOverride: sql.prepare(
      'DELETE FROM permessi_override WHERE ambito = ? AND bersaglio = ? AND tipo = ? AND soggetto = ?',
    ),
    cancellaOverrideDi: sql.prepare('DELETE FROM permessi_override WHERE ambito = ? AND bersaglio = ?'),
    cancellaOverrideRuolo: sql.prepare(
      "DELETE FROM permessi_override WHERE tipo = 'ruolo' AND soggetto = ?",
    ),
    bandisci: sql.prepare(
      `INSERT INTO bandi (spazio, utente, motivo, da, istante) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (spazio, utente) DO UPDATE SET motivo = excluded.motivo, da = excluded.da`,
    ),
    perdona: sql.prepare('DELETE FROM bandi WHERE spazio = ? AND utente = ?'),
    bando: sql.prepare('SELECT * FROM bandi WHERE spazio = ? AND utente = ?'),
    bandi: sql.prepare(
      `SELECT b.*, u.nome, u.utente AS nomeUtente, u.avatar
         FROM bandi b JOIN utenti u ON u.id = b.utente
        WHERE b.spazio = ? ORDER BY b.istante DESC`,
    ),
  };

  const api = {
    // -- Ruoli ---------------------------------------------------------------

    diSpazio(spazioId) {
      return q.diSpazio.all(spazioId).map(ruoloDaRiga);
    },

    ruolo(id) {
      return ruoloDaRiga(q.perId.get(id));
    },

    perTipo(spazioId, tipo) {
      return ruoloDaRiga(q.perTipo.get(spazioId, tipo));
    },

    /**
     * I ruoli di questa persona qui dentro, base compreso.
     *
     * Il ruolo base non sta in `ruoli_membri` e non ci stara' mai: e' di tutti
     * i membri per definizione, e scriverne una riga per ognuno vorrebbe dire
     * una tabella che cresce con i membri e che si dimentica di crescere ogni
     * volta che qualcuno entra da una strada nuova.
     */
    diUtente(spazioId, utenteId) {
      const suoi = q.diUtente.all(spazioId, utenteId).map(ruoloDaRiga);
      const base = api.perTipo(spazioId, 'base');
      return base ? [...suoi, base] : suoi;
    },

    crea(spazioId, { nome, colore = null, permessi = [], priorita = 10, tipo = 'custom' }) {
      const ins = q.inserisci.run(
        spazioId,
        nome,
        colore,
        JSON.stringify(ripuliscePermessi(permessi)),
        priorita,
        tipo,
        ora(),
      );
      return api.ruolo(Number(ins.lastInsertRowid));
    },

    aggiorna(id, { nome, colore, permessi, priorita }) {
      const vecchio = api.ruolo(id);
      if (!vecchio) return null;

      // Il tipo non si cambia mai da fuori: un Master che diventasse 'admin'
      // sarebbe un modo di prendersi tutto passando dal pannello dei nomi.
      sql
        .prepare('UPDATE ruoli SET nome = ?, colore = ?, permessi = ?, priorita = ? WHERE id = ?')
        .run(
          nome === undefined ? vecchio.nome : nome,
          colore === undefined ? vecchio.colore : colore,
          JSON.stringify(
            permessi === undefined ? vecchio.permessi : ripuliscePermessi(permessi),
          ),
          priorita === undefined ? vecchio.priorita : priorita,
          id,
        );
      return api.ruolo(id);
    },

    elimina(id) {
      // Gli override che parlavano di questo ruolo non hanno piu' un soggetto:
      // lasciarli sarebbe accumulare righe che non decidono piu' niente e che
      // un giorno tornerebbero vive addosso a un ruolo con lo stesso id.
      q.cancellaOverrideRuolo.run(id);
      return q.elimina.run(id).changes;
    },

    assegna(ruoloId, utenteId) {
      q.assegna.run(ruoloId, utenteId, ora());
    },

    togli(ruoloId, utenteId) {
      return q.togli.run(ruoloId, utenteId).changes;
    },

    /** Uscendo da uno spazio si perdono i suoi ruoli, e solo quelli. */
    togliTuttiDelloSpazio(spazioId, utenteId) {
      q.togliTutti.run(utenteId, spazioId);
    },

    membriDelRuolo(ruoloId) {
      return q.membriDi.all(ruoloId).map((r) => r.utente);
    },

    /**
     * Fa esistere Admin, Master e base in questo spazio.
     *
     * Idempotente, e chiamata a ogni apertura del database: e' cosi' che gli
     * spazi nati prima dei ruoli se li ritrovano senza che nessuno debba
     * lanciare una migrazione a mano. Restituisce il ruolo Admin, che serve a
     * chi sta convertendo i vecchi membri.
     */
    assicuraPredefiniti(spazioId) {
      for (const modello of PREDEFINITI) {
        if (api.perTipo(spazioId, modello.tipo)) continue;
        api.crea(spazioId, {
          nome: modello.nome,
          colore: modello.colore,
          // Il ruolo admin ha tutto per costruzione, non per elenco: la
          // risoluzione lo riconosce dal tipo e non guarda mai questa colonna.
          permessi: modello.permessi,
          priorita: modello.priorita,
          tipo: modello.tipo,
        });
      }
      return api.perTipo(spazioId, 'admin');
    },

    // -- Override ------------------------------------------------------------

    overrideDi(ambito, bersaglio) {
      return q.override.all(ambito, bersaglio).map(overrideDaRiga);
    },

    impostaOverride(ambito, bersaglio, { tipo, soggetto, consenti = [], nega = [] }) {
      const buoni = ripuliscePermessi(consenti, { soloDiCanale: true });
      const cattivi = ripuliscePermessi(nega, { soloDiCanale: true }).filter(
        (p) => !buoni.includes(p),
      );

      // Un override che non dice niente non e' un override: si cancella,
      // invece di lasciare una riga vuota che confonde chi legge il pannello.
      if (buoni.length === 0 && cattivi.length === 0) {
        q.cancellaOverride.run(ambito, bersaglio, tipo, soggetto);
        return null;
      }

      q.scriviOverride.run(
        ambito,
        bersaglio,
        tipo,
        soggetto,
        JSON.stringify(buoni),
        JSON.stringify(cattivi),
      );
      return { ambito, bersaglio, tipo, soggetto, consenti: buoni, nega: cattivi };
    },

    eliminaOverride(ambito, bersaglio, tipo, soggetto) {
      return q.cancellaOverride.run(ambito, bersaglio, tipo, soggetto).changes;
    },

    eliminaOverrideDi(ambito, bersaglio) {
      return q.cancellaOverrideDi.run(ambito, bersaglio).changes;
    },

    // -- Bandi ---------------------------------------------------------------

    bandisci(spazioId, utenteId, { motivo = '', da = null } = {}) {
      q.bandisci.run(spazioId, utenteId, String(motivo).slice(0, 300), da, ora());
    },

    perdona(spazioId, utenteId) {
      return q.perdona.run(spazioId, utenteId).changes;
    },

    eBandito(spazioId, utenteId) {
      return !!q.bando.get(spazioId, utenteId);
    },

    bandi(spazioId) {
      return q.bandi.all(spazioId);
    },
  };

  return api;
}
