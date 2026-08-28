// Gli avvisi per posta: chi li riceve, e soprattutto chi no.
//
// Quello che questi test difendono e' che questa funzione non diventi due
// cose: spam, o una fuga. Sono i due modi in cui muore — una casella che
// riceve venti messaggi a sera si mette un filtro, e da li' in poi la funzione
// non esiste piu' anche se il codice gira; e un invisibile nominato in una
// mail e' una promessa rotta in un posto dove resta scritta.
//
// Si prova il dispatcher direttamente invece che attraverso il webhook della
// SFU: le regole vivono tutte li' dentro, e passare per il webhook vorrebbe
// dire firmare eventi finti per provare cose che col trasporto non c'entrano.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { creaAvvisi, leggiPreferenze, scriviPreferenze } from '../src/avvisi.mjs';
import { TalkDb } from '../src/db.mjs';

/** Un mondo minimo: un database vero, e tutto il resto finto e controllabile. */
function mondo(t, { finestraMinuti = 30 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-avvisi-'));
  const db = new TalkDb(join(dir, 'talk.db'));
  t.after(() => {
    db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
  });

  const collegati = new Set();
  const invisibili = new Set();
  const spediti = [];

  const avvisi = creaAvvisi({
    db,
    eventi: { collegato: (id) => collegati.has(id) },
    stati: { visibile: (u) => (invisibili.has(u.id) ? 'offline' : 'online') },
    servizi: {
      posta: {
        disponibile: true,
        invia: async (messaggio) => {
          spediti.push(messaggio);
        },
      },
    },
    log: { warn() {} },
    finestraMinuti,
  });

  const { spazio } = db.creaSpazio({ nome: 'Casa' });

  /** Una persona con indirizzo confermato e avvisi accesi, salvo diverso ordine. */
  function persona(nome, { email = true, confermato = true, vuole = true, dentro = true } = {}) {
    const codice = db.creaInvito({ nome, ruolo: 'membro' });
    const esito = db.riscattaInvito(codice, {
      utente: nome.toLowerCase(),
      nome,
      password: 'una-password-lunga',
    });
    assert.ok(esito.utente, `non sono riuscito a creare ${nome}`);
    const id = esito.utente.id;

    if (email) {
      db.impostaEmail(id, `${nome.toLowerCase()}@esempio.it`);
      if (confermato) db.confermaEmail(id, `${nome.toLowerCase()}@esempio.it`);
    }
    if (vuole) db.impostaAvvisi(id, scriviPreferenze({ vocale: true }));
    if (dentro) db.aggiungiMembro(spazio.id, id);
    return db.utente(id);
  }

  const entra = (chi) =>
    avvisi.entratoInVocale({ utenteId: chi.id, spazioId: spazio.id, canale: 'Generale' });

  return { db, spazio, persona, entra, spediti, collegati, invisibili, avvisi };
}

describe('a chi arriva un avviso', () => {
  it('a chi non e\' collegato, lo vuole, e ha un indirizzo confermato', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    const lucia = m.persona('Lucia');

    m.entra(marco);

    assert.equal(m.spediti.length, 1);
    assert.equal(m.spediti[0].a, lucia.email);
    assert.match(m.spediti[0].oggetto, /Marco/);
    assert.match(m.spediti[0].testo, /Generale/);
  });

  it('mai a chi e\' collegato: quello lo vede gia\'', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    const lucia = m.persona('Lucia');
    m.collegati.add(lucia.id);

    m.entra(marco);

    // La colonna dei canali si accende da sola. Una mail direbbe due volte la
    // stessa cosa a chi la sapeva gia', ed e' cosi' che nasce un filtro.
    assert.equal(m.spediti.length, 0);
  });

  it('mai a chi non lo ha acceso', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    m.persona('Lucia', { vuole: false });

    m.entra(marco);
    assert.equal(m.spediti.length, 0);
  });

  it('mai a un indirizzo scritto ma non confermato', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    m.persona('Lucia', { confermato: false });

    // Verso una casella mai dimostrata si manderebbe a uno sconosciuto la
    // notizia che i tuoi amici sono in chiamata.
    m.entra(marco);
    assert.equal(m.spediti.length, 0);
  });

  it('mai a se stessi', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');

    m.entra(marco);
    assert.equal(m.spediti.length, 0);
  });

  it('mai a chi non e\' di quello spazio', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    m.persona('Estranea', { dentro: false });

    m.entra(marco);
    assert.equal(m.spediti.length, 0);
  });
});

describe('cio\' che un avviso non deve rivelare', () => {
  it('chi e\' invisibile non compare in nessun avviso', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    m.persona('Lucia');
    m.invisibili.add(marco.id);

    // Lo stato invisibile vale finche' tutte le strade lo rispettano, e una
    // mail e' la peggiore in cui perderlo: resta scritta.
    m.entra(marco);
    assert.equal(m.spediti.length, 0);
  });

  it('senza posta configurata non parte niente', async (t) => {
    const m = mondo(t);
    m.avvisi.dimentica();
    const marco = m.persona('Marco');
    m.persona('Lucia');

    const spento = creaAvvisi({
      db: m.db,
      eventi: { collegato: () => false },
      stati: { visibile: () => 'online' },
      servizi: { posta: { disponibile: false, invia: async () => assert.fail('non doveva spedire') } },
      log: { warn() {} },
    });
    spento.entratoInVocale({ utenteId: marco.id, spazioId: m.spazio.id, canale: 'Generale' });
  });
});

describe('quanti avvisi', () => {
  it('uno solo per destinatario dentro alla finestra, poi silenzio', async (t) => {
    const m = mondo(t);
    // Due che si muovono e una sola che vuole saperlo: cosi' si conta cosa
    // riceve lei, che e' quello che la regola promette. Il tetto e' per
    // destinatario, non per serata: tre persone che vogliono l'avviso sono
    // tre mail al primo movimento, ed e' giusto.
    const marco = m.persona('Marco', { vuole: false });
    const anna = m.persona('Anna', { vuole: false });
    m.persona('Lucia');

    m.entra(marco);
    m.entra(anna);
    m.entra(marco);

    // Il messaggio da consegnare non e' "chi e' entrato", e' "ci sono, vieni".
    // Una volta e' quante volte va detto.
    assert.equal(m.spediti.length, 1);
    assert.equal(m.spediti[0].a, 'lucia@esempio.it');
  });

  it('finita la finestra, se ne puo\' mandare un altro', async (t) => {
    const m = mondo(t, { finestraMinuti: 0 });
    const marco = m.persona('Marco');
    m.persona('Lucia');

    m.entra(marco);
    m.entra(marco);
    assert.equal(m.spediti.length, 2);
  });

  it('accendere un avviso non fa aspettare la finestra in corso', async (t) => {
    const m = mondo(t);
    const marco = m.persona('Marco');
    m.persona('Lucia');

    m.entra(marco);
    assert.equal(m.spediti.length, 1);

    // E' quello che fa la rotta quando si cambiano le preferenze: chi accende
    // un avviso adesso non deve restare mezz'ora senza capire perche'.
    m.avvisi.dimentica();
    m.entra(marco);
    assert.equal(m.spediti.length, 2);
  });
});

describe('le preferenze', () => {
  it('di serie sono tutte spente', () => {
    assert.deepEqual(leggiPreferenze(''), { vocale: false });
    assert.deepEqual(leggiPreferenze(null), { vocale: false });
  });

  it('un valore illeggibile non fa saltare niente', () => {
    // Ricade sul silenzio, che e' anche il valore di serie: una preferenza
    // rotta non deve impedire di entrare.
    assert.deepEqual(leggiPreferenze('{rotto'), { vocale: false });
  });

  it('si scrive solo cio\' che sta nel catalogo', () => {
    const json = scriviPreferenze({ vocale: true, inventato: true });
    assert.deepEqual(JSON.parse(json), { vocale: true });
  });
});
