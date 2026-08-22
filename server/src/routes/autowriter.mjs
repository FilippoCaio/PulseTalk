// Auto Writer: consenso per persona, segmenti attribuiti alla traccia locale, riassunto.
//
// La prima versione chiedeva l'unanimita': finche' anche uno solo non aveva
// risposto non partiva niente, e un solo rifiuto chiudeva la sessione per
// tutti. In una stanza da sei bastava qualcuno con la finestra in secondo piano
// per non trascrivere mai niente, e chi non voleva essere trascritto si
// trovava a decidere per gli altri.
//
// Adesso il consenso e' di ciascuno e vale solo per se'. Si trascrive chi ha
// detto di si'; chi ha detto di no, e chi non ha ancora risposto, semplicemente
// non viene considerato — la sua voce non parte, e la sua riga non compare.
// Nessuno tiene in ostaggio la stanza, in nessuna delle due direzioni.
//
// Cio' che non cambia: nessun audio parte senza un si' esplicito, la
// trascrizione la leggono solo quelli che hanno acconsentito, e la richiesta e'
// visibile a tutti i presenti dal primo istante. Auto Writer non deve mai poter
// diventare una registrazione di nascosto.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale } from '../permessi.mjs';

export function rotteAutoWriter(app, { db, eventi, provider, presenze }) {
  const contesto = (richiesta, risposta) => {
    const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
    if (esito.errore) {
      risposta.code(esito.stato).send({ errore: esito.errore });
      return null;
    }
    if (esito.canale.tipo !== 'voce') {
      risposta.code(422).send({ errore: 'Auto Writer si usa in un canale vocale' });
      return null;
    }
    return esito;
  };
  const notifica = (esito) => eventi.aUtenti(db.destinatariCanale(esito.canale.id), {
    tipo: 'autowriter', spazio: esito.spazio.id, canale: esito.canale.id,
  });

  app.get('/api/canali/:canale/autowriter', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    await sincronizzaPartecipanti(db, presenze, esito);
    return { disponibile: provider.capabilities.stt, sessione: perUtente(leggi(db, esito.canale.id), richiesta.utente.id) };
  });

  app.post('/api/canali/:canale/autowriter', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    if (!provider.capabilities.stt) return risposta.code(501).send({ errore: 'Auto Writer non disponibile: provider STT non configurato' });
    if (leggi(db, esito.canale.id)) return risposta.code(409).send({ errore: 'Auto Writer e\' gia\' stato richiesto' });

    const dentro = await presenze.leggi();
    const partecipanti = new Set();
    for (const p of dentro.get(db.chiaveSfu(esito.canale)) ?? []) {
      const id = /^u(\d+)$/.exec(p.identita)?.[1];
      if (id) partecipanti.add(Number(id));
    }
    if (!partecipanti.has(richiesta.utente.id)) {
      return risposta.code(409).send({ errore: 'devi essere realmente nel canale vocale per chiedere Auto Writer' });
    }
    const transazione = db.sql.transaction(() => {
      const ins = db.sql.prepare(
        `INSERT INTO trascrizioni (canale, richiestoDa, provider, stato, creato) VALUES (?, ?, ?, 'consenso', ?)`,
      ).run(esito.canale.id, richiesta.utente.id, provider.id, Date.now());
      const id = Number(ins.lastInsertRowid);
      const aggiungi = db.sql.prepare(
        'INSERT INTO consensi_trascrizione (trascrizione, utente, consenso, istante) VALUES (?, ?, ?, ?)',
      );
      for (const utente of partecipanti) aggiungi.run(id, utente, utente === richiesta.utente.id ? 1 : null, Date.now());
      // Chi la chiede ha gia' acconsentito, quindi c'e' gia' qualcuno da
      // trascrivere e si parte subito. Gli altri decidono per se': finche' non
      // rispondono, la loro voce non parte.
      db.sql.prepare("UPDATE trascrizioni SET stato = 'attiva', avviato = ? WHERE id = ?").run(Date.now(), id);
    });
    transazione();
    notifica(esito);
    return risposta.code(201).send({ sessione: perUtente(leggi(db, esito.canale.id), richiesta.utente.id) });
  });

  app.post('/api/canali/:canale/autowriter/consenso', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    const sessione = leggi(db, esito.canale.id);
    if (!sessione) return risposta.code(404).send({ errore: 'nessuna richiesta Auto Writer attiva' });
    await sincronizzaPartecipanti(db, presenze, esito);
    const consenso = richiesta.body?.consenso === true;
    const cambia = db.sql.prepare(
      'UPDATE consensi_trascrizione SET consenso = ?, istante = ? WHERE trascrizione = ? AND utente = ?',
    ).run(consenso ? 1 : 0, Date.now(), sessione.id, richiesta.utente.id);
    if (!cambia.changes) return risposta.code(403).send({ errore: 'non eri fra i partecipanti chiamati a consentire' });

    // Un rifiuto vale per chi lo dice, e per nessun altro: la sua voce non
    // parte piu' e la trascrizione smette di essere sua, ma la stanza va avanti
    // per chi ha detto di si'. Prima un solo no chiudeva tutto, ed era un modo
    // gentile di dare a una persona il potere di decidere per sei.
    aggiornaStato(db, sessione.id);
    notifica(esito);
    return { sessione: perUtente(leggi(db, esito.canale.id), richiesta.utente.id) };
  });

  app.post('/api/canali/:canale/autowriter/segmenti', {
    onRequest: richiedeRuolo('membro'), bodyLimit: 2 * 1024 * 1024,
  }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    await sincronizzaPartecipanti(db, presenze, esito);
    const sessione = leggi(db, esito.canale.id);
    if (!sessione || sessione.stato !== 'attiva') return risposta.code(409).send({ errore: 'Auto Writer non e\' attivo' });
    const consentito = sessione.consensi.some((c) => c.utente === richiesta.utente.id && c.consenso === true);
    if (!consentito) return risposta.code(403).send({ errore: 'manca il consenso alla trascrizione' });
    const tipo = String(richiesta.body?.tipo ?? 'audio/webm').slice(0, 80);
    let corpo;
    try { corpo = Buffer.from(String(richiesta.body?.audio ?? ''), 'base64'); } catch { corpo = Buffer.alloc(0); }
    if (!corpo.length || corpo.length > 1_400_000 || !tipo.startsWith('audio/')) return risposta.code(400).send({ errore: 'segmento audio non valido' });
    const testo = await provider.trascrivi({ corpo, tipo });
    if (!testo) return risposta.code(204).send();
    db.sql.prepare(
      'INSERT INTO segmenti_trascrizione (trascrizione, parlante, testo, definitivo, creato) VALUES (?, ?, ?, 1, ?)',
    ).run(sessione.id, richiesta.utente.id, testo, Date.now());
    notifica(esito);
    return risposta.code(201).send({ testo });
  });

  app.delete('/api/canali/:canale/autowriter', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    const sessione = leggi(db, esito.canale.id);
    if (!sessione) return risposta.code(404).send({ errore: 'Auto Writer non attivo' });
    if (sessione.richiestoDa !== richiesta.utente.id && !esito.permessi.has('manageVoiceMembers')) {
      return risposta.code(403).send({ errore: 'solo chi l\'ha richiesto o un moderatore puo fermarlo' });
    }
    db.sql.prepare("UPDATE trascrizioni SET stato = 'chiusa', chiuso = ? WHERE id = ?").run(Date.now(), sessione.id);
    notifica(esito);
    return { chiusa: sessione.id };
  });

  app.post('/api/canali/:canale/autowriter/riassunto', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = contesto(richiesta, risposta);
    if (!esito) return;
    const ultima = db.sql.prepare('SELECT * FROM trascrizioni WHERE canale = ? ORDER BY id DESC LIMIT 1').get(esito.canale.id);
    if (!ultima) return risposta.code(404).send({ errore: 'non esiste una trascrizione da riassumere' });
    const autorizzato = db.sql.prepare(
      'SELECT 1 FROM consensi_trascrizione WHERE trascrizione = ? AND utente = ? AND consenso = 1',
    ).get(ultima.id, richiesta.utente.id);
    if (!autorizzato) return risposta.code(404).send({ errore: 'non esiste una trascrizione da riassumere' });
    const segmenti = db.sql.prepare('SELECT * FROM segmenti_trascrizione WHERE trascrizione = ? ORDER BY id').all(ultima.id);
    if (!segmenti.length) return risposta.code(422).send({ errore: 'la trascrizione e\' vuota' });
    const testo = segmenti.map((s) => `${db.utente(s.parlante)?.nome ?? 'Non identificato'}: ${s.testo}`).join('\n').slice(-40_000);
    const struttura = await provider.riassumi({ trascrizione: testo });
    return { riassunto: struttura, generatoDaAi: true };
  });
}

function perUtente(sessione, utente) {
  if (!sessione) return null;
  const autorizzato = sessione.consensi.some((c) => c.utente === utente && c.consenso === true);
  return autorizzato ? sessione : { ...sessione, segmenti: [] };
}

function leggi(db, canale) {
  const riga = db.sql.prepare("SELECT * FROM trascrizioni WHERE canale = ? AND stato != 'chiusa' ORDER BY id DESC LIMIT 1").get(canale);
  if (!riga) return null;
  return {
    ...riga,
    consensi: db.sql.prepare('SELECT utente, consenso, istante FROM consensi_trascrizione WHERE trascrizione = ? ORDER BY utente').all(riga.id)
      .map((c) => ({ ...c, consenso: c.consenso === null ? null : !!c.consenso })),
    segmenti: db.sql.prepare('SELECT id, parlante, testo, definitivo, creato FROM segmenti_trascrizione WHERE trascrizione = ? ORDER BY id').all(riga.id)
      .map((s) => ({ ...s, definitivo: !!s.definitivo })),
  };
}

async function sincronizzaPartecipanti(db, presenze, esito) {
  const sessione = leggi(db, esito.canale.id);
  if (!sessione) return;
  const dentro = await presenze.leggi();
  const presenti = new Set();
  for (const p of dentro.get(db.chiaveSfu(esito.canale)) ?? []) {
    const id = /^u(\d+)$/.exec(p.identita)?.[1];
    if (id) presenti.add(Number(id));
  }
  if (!presenti.size) {
    db.sql.prepare("UPDATE trascrizioni SET stato = 'consenso' WHERE id = ? AND stato = 'attiva'").run(sessione.id);
    return;
  }

  const transazione = db.sql.transaction(() => {
    const noti = new Set(sessione.consensi.map((c) => c.utente));
    const aggiungi = db.sql.prepare(
      'INSERT OR IGNORE INTO consensi_trascrizione (trascrizione, utente, consenso, istante) VALUES (?, ?, NULL, NULL)',
    );
    let nuovo = false;
    for (const id of presenti) {
      if (!noti.has(id)) {
        aggiungi.run(sessione.id, id);
        nuovo = true;
      }
    }
    // Chi e' uscito prima di rispondere non tiene in ostaggio la stanza.
    for (const c of sessione.consensi) {
      if (c.consenso === null && !presenti.has(c.utente)) {
        db.sql.prepare('DELETE FROM consensi_trascrizione WHERE trascrizione = ? AND utente = ?').run(sessione.id, c.utente);
      }
    }
    // `nuovo` non serve piu' a fermare niente: chi arriva adesso trova la
    // richiesta e risponde per se', mentre gli altri continuano.
    void nuovo;
    aggiornaStato(db, sessione.id);
  });
  transazione();
}

/**
 * Attiva se c'e' almeno una voce da trascrivere, in attesa se non c'e' nessuno.
 *
 * "In attesa" adesso vuol dire una cosa sola: nessuno ha ancora detto di si'.
 * Non vuol piu' dire "manca qualcuno all'appello" — quello non ferma niente,
 * perche' ciascuno decide soltanto per la propria voce.
 */
function aggiornaStato(db, trascrizione) {
  const consenzienti = db.sql
    .prepare('SELECT COUNT(*) AS n FROM consensi_trascrizione WHERE trascrizione = ? AND consenso = 1')
    .get(trascrizione).n;

  if (consenzienti) {
    db.sql
      .prepare("UPDATE trascrizioni SET stato = 'attiva', avviato = COALESCE(avviato, ?) WHERE id = ?")
      .run(Date.now(), trascrizione);
  } else {
    db.sql.prepare("UPDATE trascrizioni SET stato = 'consenso' WHERE id = ?").run(trascrizione);
  }
}
