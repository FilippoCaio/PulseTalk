// I test girano su un socket vero, non con inject() di Fastify.
//
// La ragione: qui c'e' un flusso SSE che
// resta aperto, ed e' esattamente la cosa che inject() non sa rappresentare. Se
// gli eventi smettessero di arrivare, nessun test che finge di fare una
// richiesta se ne accorgerebbe.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { TokenVerifier } from 'livekit-server-sdk';

import { leggiConfig } from '../src/config.mjs';
import { chiaveDa } from '../src/db.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';

async function conServer(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-'));
  const config = leggiConfig({
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
    // Porta 1, chiusa per costruzione. La SFU non risponde e non deve
    // rispondere: verificare che tutto resti leggibile con la SFU spenta e'
    // meta' del valore di questi test, perche' e' lo stato in cui si trova
    // chiunque stia installando tutto per la prima volta.
    SFU_API_URL: 'http://127.0.0.1:1',
    TALK_LOG_LEVEL: 'silent',
    ...extra,
  });

  const talk = await creaTalk(config);
  // Non `port: 0`: il sistema puo' scegliere una porta che `fetch` rifiuta.
  // Vedi porta.mjs.
  const porta = await ascoltaSuPortaBuona(talk.app);
  const base = `http://127.0.0.1:${porta}`;

  t.after(async () => {
    await talk.app.close();
    talk.db.close();
    // Su Windows SQLite puo' tenere il -wal ancora aperto per un istante.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
  });

  return { talk, base, config };
}

function conToken(base, token) {
  return (percorso, opzioni = {}) =>
    fetch(`${base}${percorso}`, {
      ...opzioni,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opzioni.body ? { 'content-type': 'application/json' } : {}),
        ...opzioni.headers,
      },
    });
}

// Crea l'invito direttamente nel database (e' cosi' che si fa davvero, dalla
// riga di comando) e poi lo riscatta via HTTP, che e' la strada dell'app.
async function accesso(talk, base, { nome, ruolo, utente, password = PASSWORD }) {
  const codice = talk.db.creaInvito({ nome, ruolo });
  const nomeUtente = utente ?? nome.toLowerCase().replace(/[^a-z0-9]/g, '');

  const r = await fetch(`${base}/api/auth/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codice, utente: nomeUtente, password, nome }),
  });
  assert.equal(r.status, 200, `riscatto fallito per ${nome}`);

  const corpo = await r.json();
  return { ...corpo, chiama: conToken(base, corpo.token) };
}

/** Uno spazio con dentro un canale di testo e uno vocale, gia' pronti. */
async function conSpazio(chiama, nome = 'Casa') {
  const r = await chiama('/api/spazi', {
    method: 'POST',
    body: JSON.stringify({ nome, impostazioni: { apertoATutti: true } }),
  });
  assert.equal(r.status, 201, 'creazione dello spazio fallita');
  const { spazio } = await r.json();

  const { spazi } = await (await chiama('/api/spazi')).json();
  const mio = spazi.find((s) => s.id === spazio.id);
  return {
    spazio: mio,
    testo: mio.canali.find((c) => c.tipo === 'testo'),
    voce: mio.canali.find((c) => c.tipo === 'voce'),
  };
}

describe('chiavi', () => {
  it('riduce un nome a qualcosa che sta in un JWT', () => {
    assert.equal(chiaveDa('Il Salotto'), 'il-salotto');
    assert.equal(chiaveDa('Caffè & Chiacchiere'), 'caffe-chiacchiere');
    assert.equal(chiaveDa('  --- Riunione del lunedì ---  '), 'riunione-del-lunedi');
  });

  it('inventa una chiave quando il nome non lascia niente', () => {
    assert.match(chiaveDa('🎧🎧🎧'), /^x-[0-9a-f]{8}$/);
  });

  it('non produce mai una chiave vuota o troppo lunga', () => {
    assert.ok(chiaveDa('a'.repeat(200)).length <= 48);
    assert.ok(chiaveDa('...').length > 0);
  });
});

describe('accesso', () => {
  const registra = (base, corpo) =>
    fetch(`${base}/api/auth/riscatta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });

  it('scambia un codice con un account, una volta sola', async (t) => {
    const { talk, base } = await conServer(t);
    const codice = talk.db.creaInvito({ ruolo: 'membro' });

    const primo = await registra(base, {
      codice,
      utente: 'marco',
      password: PASSWORD,
      nome: 'Marco Rossi',
    });
    assert.equal(primo.status, 200);
    const { token, utente } = await primo.json();
    assert.equal(utente.utente, 'marco');
    assert.equal(utente.nome, 'Marco Rossi', 'il nome visibile e\' separato dal nome utente');
    assert.ok(token.length > 20);

    assert.equal((await registra(base, { codice, utente: 'altro', password: PASSWORD })).status, 403);
  });

  it('rifiuta un codice inventato o scaduto', async (t) => {
    const { talk, base } = await conServer(t);
    assert.equal(
      (await registra(base, { codice: 'non-esiste', utente: 'tizio', password: PASSWORD })).status,
      403,
    );

    const vecchio = talk.db.creaInvito({ ruolo: 'membro', validoGiorni: -1 });
    const r = await registra(base, { codice: vecchio, utente: 'tardi', password: PASSWORD });
    assert.equal(r.status, 403);
    assert.match((await r.json()).errore, /scaduto/);
  });

  it('non consuma il codice se il nome utente o la password non vanno', async (t) => {
    const { talk, base } = await conServer(t);
    const codice = talk.db.creaInvito({ ruolo: 'membro' });

    // Un codice bruciato da un errore di battitura sarebbe la peggiore delle
    // esperienze: vale una volta sola, e recuperarlo richiede un altro giro
    // da chi amministra.
    assert.equal((await registra(base, { codice, utente: 'ab', password: PASSWORD })).status, 400);
    assert.equal((await registra(base, { codice, utente: 'marco', password: 'corta' })).status, 400);
    assert.equal((await registra(base, { codice, utente: 'MAR CO!', password: PASSWORD })).status, 400);

    assert.equal((await registra(base, { codice, utente: 'marco', password: PASSWORD })).status, 200);
  });

  it('rifiuta un nome utente gia\' preso, senza bruciare il codice', async (t) => {
    const { talk, base } = await conServer(t);
    await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const codice = talk.db.creaInvito({ ruolo: 'membro' });
    assert.equal((await registra(base, { codice, utente: 'marco', password: PASSWORD })).status, 409);
    assert.equal((await registra(base, { codice, utente: 'marco2', password: PASSWORD })).status, 200);
  });

  it('chiude tutto quello che non e\' il riscatto', async (t) => {
    const { base } = await conServer(t);
    for (const percorso of ['/api/config', '/api/spazi', '/api/auth/io']) {
      assert.equal((await fetch(`${base}${percorso}`)).status, 401, `${percorso} risponde senza token`);
    }
  });

  it('smette di riconoscere un token revocato', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    assert.equal((await marco.chiama('/api/auth/io')).status, 200);
    talk.db.revocaUtente(marco.utente.id);
    assert.equal((await marco.chiama('/api/auth/io')).status, 401);
  });
});

describe('inviti dall\'app', () => {
  it('li crea solo un admin', async (t) => {
    const { talk, base } = await conServer(t);
    const membro = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    assert.equal(
      (await membro.chiama('/api/inviti', { method: 'POST', body: JSON.stringify({}) })).status,
      403,
    );

    const creato = await admin.chiama('/api/inviti', {
      method: 'POST',
      body: JSON.stringify({ ruolo: 'membro', giorni: 7, usi: 1 }),
    });
    assert.equal(creato.status, 201);
    assert.ok((await creato.json()).codice.length > 10);
  });

  it('un codice per piu\' persone ne fa entrare esattamente quelle', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const { codice } = await (
      await admin.chiama('/api/inviti', { method: 'POST', body: JSON.stringify({ usi: 2 }) })
    ).json();

    const registra = (utente) =>
      fetch(`${base}/api/auth/riscatta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codice, utente, password: PASSWORD }),
      });

    assert.equal((await registra('primo')).status, 200);
    assert.equal((await registra('secondo')).status, 200);
    assert.equal((await registra('terzo')).status, 403, 'il contatore e\' arrivato al tetto');
  });

  it('elenca quelli aperti e li annulla', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const { codice } = await (
      await admin.chiama('/api/inviti', { method: 'POST', body: JSON.stringify({ usi: 5 }) })
    ).json();

    const { inviti } = await (await admin.chiama('/api/inviti')).json();
    assert.equal(inviti.length, 1);
    assert.equal(inviti[0].usiMax, 5);

    await admin.chiama(`/api/inviti/${inviti[0].id}`, { method: 'DELETE' });

    const dopo = await fetch(`${base}/api/auth/riscatta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codice, utente: 'tardivo', password: PASSWORD }),
    });
    assert.equal(dopo.status, 403, 'annullato vuol dire annullato');
  });

  it('rifiuta durate e usi fuori scala', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    for (const corpo of [{ giorni: 0 }, { giorni: 400 }, { usi: 0 }, { usi: 9999 }]) {
      const r = await admin.chiama('/api/inviti', { method: 'POST', body: JSON.stringify(corpo) });
      assert.equal(r.status, 400, `${JSON.stringify(corpo)} doveva essere rifiutato`);
    }
  });
});

describe('entrare con la password', () => {
  const accedi = (base, corpo) =>
    fetch(`${base}/api/auth/accedi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });

  it('da\' una sessione nuova a ogni accesso', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const r = await accedi(base, { utente: 'marco', password: PASSWORD });
    assert.equal(r.status, 200);
    const { token } = await r.json();

    assert.notEqual(token, marco.token, 'ogni dispositivo ha la sua sessione');
    // Entrare dal portatile non deve buttare fuori il telefono.
    assert.equal((await marco.chiama('/api/auth/io')).status, 200);
    assert.equal((await conToken(base, token)('/api/auth/io')).status, 200);
  });

  it('accetta il nome utente con qualunque maiuscola', async (t) => {
    const { talk, base } = await conServer(t);
    await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    assert.equal((await accedi(base, { utente: '  MaRcO ', password: PASSWORD })).status, 200);
  });

  it('non distingue un utente inesistente da una password sbagliata', async (t) => {
    const { talk, base } = await conServer(t);
    await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const inesistente = await accedi(base, { utente: 'nessuno', password: PASSWORD });
    const sbagliata = await accedi(base, { utente: 'marco', password: 'un-altra-password' });

    assert.equal(inesistente.status, 401);
    assert.equal(sbagliata.status, 401);
    // Stessa identica risposta: distinguerle direbbe a chi prova quali nomi
    // esistono, che e' meta' del lavoro di chi vuole entrare.
    assert.deepEqual(await inesistente.json(), await sbagliata.json());
  });

  it('cambia la password e chiude le altre sessioni', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const { token: altrove } = await (await accedi(base, { utente: 'marco', password: PASSWORD })).json();
    const daAltrove = conToken(base, altrove);
    assert.equal((await daAltrove('/api/auth/io')).status, 200);

    const cambio = await marco.chiama('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ vecchia: PASSWORD, nuova: 'un-altra-password-lunga' }),
    });
    assert.equal(cambio.status, 200);

    // Chi cambia password resta dentro dove sta; tutti gli altri cadono.
    assert.equal((await marco.chiama('/api/auth/io')).status, 200);
    assert.equal((await daAltrove('/api/auth/io')).status, 401);
    assert.equal((await accedi(base, { utente: 'marco', password: PASSWORD })).status, 401);
  });

  it('non cambia la password senza quella vecchia', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const r = await marco.chiama('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ vecchia: 'indovinata', nuova: 'un-altra-password-lunga' }),
    });
    assert.equal(r.status, 403);
  });

  it('elenca le proprie sessioni e ne revoca una', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const { token: altro } = await (
      await accedi(base, { utente: 'marco', password: PASSWORD, dispositivo: 'Telefono' })
    ).json();

    const { sessioni } = await (await marco.chiama('/api/auth/sessioni')).json();
    assert.equal(sessioni.length, 2);
    assert.equal(sessioni.filter((s) => s.questa).length, 1);

    const telefono = sessioni.find((s) => s.dispositivo === 'Telefono');
    await marco.chiama(`/api/auth/sessioni/${telefono.id}/revoca`, { method: 'POST' });

    assert.equal((await conToken(base, altro)('/api/auth/io')).status, 401);
    assert.equal((await marco.chiama('/api/auth/io')).status, 200);
  });

  it('non lascia revocare la sessione di un altro', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const anna = await accesso(talk, base, { nome: 'Anna', ruolo: 'membro' });

    const { sessioni } = await (await anna.chiama('/api/auth/sessioni')).json();
    const r = await marco.chiama(`/api/auth/sessioni/${sessioni[0].id}/revoca`, { method: 'POST' });

    assert.equal(r.status, 404, 'l\'id di una sessione altrui non deve bastare a chiuderla');
    assert.equal((await anna.chiama('/api/auth/io')).status, 200);
  });
});

describe('account nati prima delle password', () => {
  function vecchioStile(talk) {
    const ins = talk.db.sql
      .prepare('INSERT INTO utenti (nome, ruolo, creato) VALUES (?, ?, ?)')
      .run('Marco', 'admin', Math.floor(Date.now() / 1000));
    const id = Number(ins.lastInsertRowid);
    return { id, token: talk.db.creaSessione(id, 'prima') };
  }

  it('continua a funzionare, e lo dichiara', async (t) => {
    const { talk, base } = await conServer(t);
    const chiama = conToken(base, vecchioStile(talk).token);

    const corpo = await (await chiama('/api/auth/io')).json();
    assert.equal(corpo.utente.utente, null);
    assert.equal(corpo.deveCompletare, true);
  });

  it('sceglie nome utente e password, una volta sola', async (t) => {
    const { talk, base } = await conServer(t);
    const chiama = conToken(base, vecchioStile(talk).token);

    const r = await chiama('/api/auth/completa', {
      method: 'POST',
      body: JSON.stringify({ utente: 'filippo', password: PASSWORD }),
    });
    assert.equal(r.status, 200);
    assert.equal((await (await chiama('/api/auth/io')).json()).deveCompletare, false);

    // Un secondo giro no: da li' in poi si passa da /password, che la vecchia
    // la chiede. Altrimenti chiunque rubi un token la cambierebbe senza saperla.
    const secondo = await chiama('/api/auth/completa', {
      method: 'POST',
      body: JSON.stringify({ utente: 'filippo2', password: 'un-altra-password' }),
    });
    assert.equal(secondo.status, 409);
  });
});

describe('profilo', () => {
  it('cambia nome visibile e foto senza toccare le credenziali', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const r = await marco.chiama('/api/auth/profilo', {
      method: 'POST',
      body: JSON.stringify({ nome: 'Marco il Grande', avatar: 'data:image/png;base64,iVBORw0KGgo=' }),
    });
    assert.equal(r.status, 200);
    const { utente } = await r.json();
    assert.equal(utente.nome, 'Marco il Grande');
    assert.equal(utente.utente, 'marco', 'il nome utente non si tocca cambiando il nome visibile');
  });

  it('rifiuta una foto che non e\' un\'immagine o e\' troppo grande', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    assert.equal(
      (await marco.chiama('/api/auth/profilo', {
        method: 'POST',
        body: JSON.stringify({ avatar: 'https://esempio.it/foto.png' }),
      })).status,
      400,
    );
    assert.equal(
      (await marco.chiama('/api/auth/profilo', {
        method: 'POST',
        body: JSON.stringify({ avatar: `data:image/png;base64,${'A'.repeat(300 * 1024)}` }),
      })).status,
      413,
    );
  });
});

describe('spazi e canali', () => {
  it('lo crea chiunque, e nasce con un canale di ognuno', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const { spazio, testo, voce } = await conSpazio(admin.chiama, 'Casa');
    assert.equal(spazio.chiave, 'casa');
    assert.ok(testo, 'uno spazio vuoto non si sa da dove cominciare a usarlo');
    assert.ok(voce);
  });

  it('lo crea anche un membro, e nasce privato', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const altro = await accesso(talk, base, { nome: 'Altro', ruolo: 'membro' });

    const r = await marco.chiama('/api/spazi', {
      method: 'POST',
      body: JSON.stringify({ nome: 'Musica' }),
    });
    assert.equal(r.status, 201, 'per farsi un posto dove parlare non si chiede il permesso');

    const suoi = await (await marco.chiama('/api/spazi')).json();
    assert.equal(suoi.spazi.length, 1);
    assert.equal(suoi.spazi[0].ruoloMio, 'admin', 'chi lo crea ne e\' padrone');

    const altrui = await (await altro.chiama('/api/spazi')).json();
    assert.equal(altrui.spazi.length, 0, 'privato vuol dire che gli altri non lo vedono');
  });

  it('un membro non puo\' farlo comparire nella barra di tutti', async (t) => {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const r = await marco.chiama('/api/spazi', {
      method: 'POST',
      body: JSON.stringify({ nome: 'Ovunque', impostazioni: { apertoATutti: true } }),
    });
    assert.equal(r.status, 403);
  });

  it('due spazi con lo stesso nome convivono', async (t) => {
    const { talk, base } = await conServer(t);
    const uno = await accesso(talk, base, { nome: 'Uno', ruolo: 'membro' });
    const due = await accesso(talk, base, { nome: 'Due', ruolo: 'membro' });

    const crea = (chi) =>
      chi.chiama('/api/spazi', { method: 'POST', body: JSON.stringify({ nome: 'Musica' }) });

    assert.equal((await crea(uno)).status, 201);
    // Non 409: rifiutare direbbe a chi prova che uno spazio con quel nome
    // esiste gia', e quasi tutti sono privati.
    const seconda = await crea(due);
    assert.equal(seconda.status, 201);
    const { spazio } = await seconda.json();
    assert.equal(spazio.chiave, 'musica-2');
  });

  it('ci mette dentro tutti quelli che gia\' esistono', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    await conSpazio(admin.chiama, 'Casa');

    const { spazi } = await (await marco.chiama('/api/spazi')).json();
    assert.equal(spazi.length, 1, 'chi c\'era gia\' non deve aspettare un invito');
  });

  it('ci mette dentro anche chi arriva dopo', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const tardi = await accesso(talk, base, { nome: 'Tardi', ruolo: 'membro' });
    const { spazi } = await (await tardi.chiama('/api/spazi')).json();
    assert.equal(spazi.length, 1);
  });

  it('nasconde lo spazio a chi non ne fa parte, e non dice che esiste', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo } = await conSpazio(admin.chiama, 'Casa');

    await admin.chiama(`/api/spazi/${spazio.id}/membri/${marco.utente.id}`, { method: 'DELETE' });

    // 404 e non 403: dire "esiste ma non entri" racconta a chi prova quali
    // spazi esistono.
    assert.equal((await marco.chiama(`/api/spazi/${spazio.id}/membri`)).status, 404);
    assert.equal((await marco.chiama(`/api/canali/${testo.id}/messaggi`)).status, 404);
    assert.equal((await (await marco.chiama('/api/spazi')).json()).spazi.length, 0);
  });

  it('crea canali di testo e di voce, e li elimina', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(admin.chiama, 'Casa');

    const r = await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Officina', tipo: 'voce', argomento: 'si lavora' }),
    });
    assert.equal(r.status, 201);
    const { canale } = await r.json();
    assert.equal(canale.chiave, 'officina');

    assert.equal((await admin.chiama(`/api/canali/${canale.id}`, { method: 'DELETE' })).status, 200);
  });

  it("l'icona di un canale si mette, si cambia e si toglie", async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(admin.chiama, 'Casa');

    const creato = await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Giochi', tipo: 'voce' }),
    });
    const { canale } = await creato.json();
    assert.equal(canale.icona ?? null, null);

    const conIcona = await admin.chiama(`/api/canali/${canale.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icona: '🎮' }),
    });
    assert.equal(conIcona.status, 200);
    assert.equal((await conIcona.json()).canale.icona, '🎮');

    // Stringa vuota vuol dire "togli": e' la distinzione che senza codice
    // apposta si perde, lasciando un'icona che non si leva piu'.
    const senza = await admin.chiama(`/api/canali/${canale.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ icona: '' }),
    });
    const finale = (await senza.json()).canale;
    assert.equal(finale.icona ?? null, null);
    // E il nome non e' stato toccato da nessuna delle due PATCH: si stava
    // cambiando solo l'icona, e un aggiornamento parziale che azzera il resto
    // e' il modo classico in cui questa rotta si rompe.
    assert.equal(finale.nome, 'Giochi');
  });

  it('a due canali con lo stesso nome aggiunge un numero, invece di rifiutare', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(admin.chiama, 'Casa');

    const crea = () =>
      admin.chiama(`/api/spazi/${spazio.id}/canali`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Chiacchiere', tipo: 'testo' }),
      });

    assert.equal((await (await crea()).json()).canale.chiave, 'chiacchiere');
    assert.equal((await (await crea()).json()).canale.chiave, 'chiacchiere-2');
  });

  it('un membro semplice non crea ne\' cancella canali', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo } = await conSpazio(admin.chiama, 'Casa');

    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/canali`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Mio', tipo: 'testo' }),
      })).status,
      403,
    );
    assert.equal((await marco.chiama(`/api/canali/${testo.id}`, { method: 'DELETE' })).status, 403);
  });

  it('elenca i canali con i non letti e chi c\'e\' nei vocali', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const { spazi } = await (await admin.chiama('/api/spazi')).json();
    const canali = spazi[0].canali;
    // La SFU e' spenta: i vocali risultano vuoti, e questo non deve rompere
    // niente — e' lo stato di chiunque stia installando tutto per la prima volta.
    assert.deepEqual(canali.find((c) => c.tipo === 'voce').presenti, []);
    assert.equal(canali.find((c) => c.tipo === 'testo').nonLetti, 0);
  });
});

describe('gettoni per i canali vocali', () => {
  const verificatore = new TokenVerifier('chiave-di-prova', SEGRETO);

  async function grantDi(risposta) {
    const corpo = await risposta.json();
    const claim = await verificatore.verify(corpo.gettone);
    return { corpo, claim, video: claim.video };
  }

  it('firma un gettone che la SFU sa verificare', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(admin.chiama, 'Casa');

    const r = await admin.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' });
    assert.equal(r.status, 200);

    const { corpo, claim, video } = await grantDi(r);
    // La stanza sulla SFU porta dentro anche lo spazio: due spazi possono
    // avere entrambi un canale "salotto", e senza il prefisso finirebbero
    // nella stessa chiamata.
    assert.equal(video.room, 'casa--salotto');
    assert.equal(video.roomJoin, true);
    assert.equal(claim.sub ?? claim.identity, `u${admin.utente.id}`);
    assert.equal(corpo.sfuUrl, 'wss://sfu.esempio.it');
  });

  it('non firma un gettone per un canale di testo', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    assert.equal((await admin.chiama(`/api/canali/${testo.id}/entra`, { method: 'POST' })).status, 400);
  });

  it('all\'ospite lascia ascoltare, non trasmettere', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(admin.chiama, 'Casa');
    const ospite = await accesso(talk, base, { nome: 'Passante', ruolo: 'ospite' });

    const { corpo, video } = await grantDi(await ospite.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }));
    assert.equal(video.canSubscribe, true);
    assert.equal(video.canPublish, false);
    // La chat resta: e' l'unico modo che ha un ospite per chiedere la parola.
    assert.equal(video.canPublishData, true);
    assert.equal(corpo.permessi.puoTrasmettere, false);
  });

  it('nel canale da palco trasmettono solo gli admin', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(admin.chiama, 'Casa');

    const { canale: palco } = await (
      await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Presentazione', tipo: 'voce', soloAscolto: true }),
      })
    ).json();

    const suo = await grantDi(await marco.chiama(`/api/canali/${palco.id}/entra`, { method: 'POST' }));
    assert.equal(suo.video.canPublish, false, 'un membro non deve trasmettere sul palco');

    const capo = await grantDi(await admin.chiama(`/api/canali/${palco.id}/entra`, { method: 'POST' }));
    assert.equal(capo.video.canPublish, true);

    // E nel canale libero lo stesso membro trasmette eccome: il permesso e' il
    // prodotto di ruolo e canale, non una proprieta' della persona.
    const altrove = await grantDi(await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }));
    assert.equal(altrove.video.canPublish, true);
  });

  it('non mette il permesso di moderare dentro il gettone', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(admin.chiama, 'Casa');

    const { video } = await grantDi(await admin.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }));
    // Se roomAdmin viaggiasse nel gettone, un admin revocato continuerebbe a
    // cacciare la gente per altre sei ore.
    assert.ok(!video.roomAdmin, 'roomAdmin non deve stare nel gettone');
  });

  it('consegna il gettone anche se la SFU non risponde', async (t) => {
    // La SFU di questi test e' su una porta chiusa, quindi `assicuraStanza`
    // fallisce sempre. Deve fallire *piano*: il gettone si firma senza
    // interpellare nessuno, e chi entra ricevera' un errore di connessione —
    // che e' la verita' — invece di un 500 dal piano di controllo.
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(admin.chiama, 'Casa');

    const r = await admin.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).gettone.length > 20);
  });

  it('scade quando dice la configurazione', async (t) => {
    const { talk, base } = await conServer(t, { TALK_GETTONE_TTL: '900' });
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(admin.chiama, 'Casa');

    const { gettone } = await (await admin.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' })).json();
    // La validita' sta fra `nbf` ed `exp`: il gettone non ha un `iat`.
    const corpo = JSON.parse(Buffer.from(gettone.split('.')[1], 'base64url').toString());
    const durata = corpo.exp - corpo.nbf;
    assert.ok(Math.abs(durata - 900) <= 2, `durata ${durata}, attesa 900`);
  });
});

describe('messaggi', () => {
  async function conCanale(t) {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo, voce } = await conSpazio(admin.chiama, 'Casa');
    return { talk, base, admin, marco, spazio, testo, voce };
  }

  const scrivi = (chi, canale, corpo) =>
    chi.chiama(`/api/canali/${canale.id}/messaggi`, { method: 'POST', body: JSON.stringify(corpo) });

  it('scrive e rilegge, in ordine di lettura', async (t) => {
    const { admin, testo } = await conCanale(t);

    await scrivi(admin, testo, { testo: 'primo' });
    await scrivi(admin, testo, { testo: 'secondo' });
    await scrivi(admin, testo, { testo: 'terzo' });

    const { messaggi } = await (await admin.chiama(`/api/canali/${testo.id}/messaggi`)).json();
    assert.deepEqual(messaggi.map((m) => m.testo), ['primo', 'secondo', 'terzo']);
  });

  it('rifiuta un messaggio vuoto', async (t) => {
    const { admin, testo } = await conCanale(t);
    assert.equal((await scrivi(admin, testo, { testo: '   ' })).status, 400);
  });

  it('accetta i messaggi anche in un canale vocale, che ha la sua chat', async (t) => {
    const { admin, voce } = await conCanale(t);
    assert.equal((await scrivi(admin, voce, { testo: 'ci sono' })).status, 201);

    const letti = await (await admin.chiama(`/api/canali/${voce.id}/messaggi`)).json();
    assert.deepEqual(letti.messaggi.map((m) => m.testo), ['ci sono']);
  });

  it('risale all\'indietro a pagine', async (t) => {
    const { admin, testo } = await conCanale(t);
    for (let i = 1; i <= 7; i += 1) await scrivi(admin, testo, { testo: `m${i}` });

    const ultima = await (await admin.chiama(`/api/canali/${testo.id}/messaggi?quanti=3`)).json();
    assert.deepEqual(ultima.messaggi.map((m) => m.testo), ['m5', 'm6', 'm7']);
    assert.equal(ultima.altri, true);

    const prima = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi?quanti=3&prima=${ultima.messaggi[0].id}`)
    ).json();
    assert.deepEqual(prima.messaggi.map((m) => m.testo), ['m2', 'm3', 'm4']);
  });

  it('cita solo messaggi dello stesso canale', async (t) => {
    const { admin, spazio, testo } = await conCanale(t);
    const { canale: altro } = await (
      await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Altrove', tipo: 'testo' }),
      })
    ).json();

    const { messaggio: qui } = await (await scrivi(admin, testo, { testo: 'qui' })).json();
    const { messaggio: risposta } = await (
      await scrivi(admin, testo, { testo: 'rispondo', rispondeA: qui.id })
    ).json();
    assert.equal(risposta.rispondeA, qui.id);

    // Un id di un altro canale non produce un errore, produce un messaggio
    // senza citazione: rifiutare significherebbe perdere quello che uno ha
    // scritto per colpa di un riferimento andato storto.
    const { messaggio: fuori } = await (
      await scrivi(admin, altro, { testo: 'e qui?', rispondeA: qui.id })
    ).json();
    assert.equal(fuori.rispondeA, null);
  });

  it('modifica solo i propri, e nemmeno un admin tocca gli altrui', async (t) => {
    const { admin, marco, testo } = await conCanale(t);
    const { messaggio } = await (await scrivi(marco, testo, { testo: 'mio' })).json();

    assert.equal(
      (await admin.chiama(`/api/messaggi/${messaggio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ testo: 'riscritto' }),
      })).status,
      403,
      'moderare significa togliere, non riscrivere',
    );

    const r = await marco.chiama(`/api/messaggi/${messaggio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ testo: 'corretto' }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).messaggio.testo, 'corretto');
  });

  it('elimina solo i propri, e nemmeno il proprietario tocca gli altrui', async (t) => {
    const { talk, admin, marco, testo } = await conCanale(t);
    const { messaggio: suo } = await (await marco.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'da togliere' }),
    })).json();
    const { messaggio: mio } = await (await scrivi(admin, testo, { testo: 'anche questo' })).json();

    assert.equal((await marco.chiama(`/api/messaggi/${mio.id}`, { method: 'DELETE' })).status, 403);
    assert.equal(
      (await admin.chiama(`/api/messaggi/${suo.id}`, { method: 'DELETE' })).status,
      403,
      'chi ha scritto il messaggio e\' l\'unico che puo\' toglierlo',
    );
    assert.equal((await marco.chiama(`/api/messaggi/${suo.id}`, { method: 'DELETE' })).status, 200);

    // Riletta, la conversazione non ha buchi: la lapide "messaggio rimosso"
    // la vede solo chi era in ascolto, dall'evento. Chi apre la chat dopo
    // trova solo cio' che c'e' ancora.
    const { messaggi } = await (await admin.chiama(`/api/canali/${testo.id}/messaggi`)).json();
    assert.equal(messaggi.length, 1);
    assert.equal(messaggi[0].id, mio.id);

    // La riga pero' resta in tabella: se sparisse davvero, sparirebbe anche
    // l'id, e le risposte che la citavano punterebbero nel vuoto.
    const riga = talk.db.messaggio(suo.id);
    assert.ok(riga, 'la riga non va cancellata dal database');
    assert.equal(riga.eliminato, 1);
    assert.equal(riga.testo, '');
  });

  // Un messaggio dell'AI ha per autore il bot, e il bot non fa login: se a
  // cancellare fosse solo l'autore, quella riga non la toglierebbe piu'
  // nessuno. La toglie chi se l'e' fatta scrivere.
  it('la risposta dell\'AI la toglie chi l\'ha chiesta, e nessun altro', async (t) => {
    const { talk, admin, marco, spazio, testo } = await conCanale(t);
    const bot = talk.db.botInterno(spazio.id, marco.utente.id);
    const id = talk.db.scriviMessaggio({
      canale: testo.id,
      autore: bot.id,
      testo: 'risposta generata',
      origine: 'ai',
      richiestoDa: marco.utente.id,
    });

    assert.equal((await admin.chiama(`/api/messaggi/${id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await marco.chiama(`/api/messaggi/${id}`, { method: 'DELETE' })).status, 200);
  });

  it('conta i non letti, e non conta i propri', async (t) => {
    const { admin, marco, spazio, testo } = await conCanale(t);

    await scrivi(admin, testo, { testo: 'uno' });
    await scrivi(admin, testo, { testo: 'due' });

    const suoi = await (await marco.chiama('/api/spazi')).json();
    const canale = suoi.spazi.find((s) => s.id === spazio.id).canali.find((c) => c.id === testo.id);
    assert.equal(canale.nonLetti, 2);

    // Chi scrive ha letto per definizione.
    const dellAdmin = await (await admin.chiama('/api/spazi')).json();
    assert.equal(
      dellAdmin.spazi.find((s) => s.id === spazio.id).canali.find((c) => c.id === testo.id).nonLetti,
      0,
    );

    await marco.chiama(`/api/canali/${testo.id}/letto`, { method: 'POST', body: JSON.stringify({}) });
    const dopo = await (await marco.chiama('/api/spazi')).json();
    assert.equal(
      dopo.spazi.find((s) => s.id === spazio.id).canali.find((c) => c.id === testo.id).nonLetti,
      0,
    );
  });
});

describe('reazioni', () => {
  it('la stessa emoji due volte si toglie', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const { messaggio } = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'ciao' }),
      })
    ).json();

    const reagisci = () =>
      admin.chiama(`/api/messaggi/${messaggio.id}/reazioni`, {
        method: 'POST',
        body: JSON.stringify({ emoji: '👍' }),
      });

    const messa = await (await reagisci()).json();
    assert.deepEqual(messa.reazioni, [{ emoji: '👍', utenti: [admin.utente.id] }]);

    // Premere due volte toglie, come ovunque: e' lo stesso gesto.
    const tolta = await (await reagisci()).json();
    assert.deepEqual(tolta.reazioni, []);
  });

  it('rifiuta cio\' che non e\' una emoji', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');
    const { messaggio } = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'ciao' }),
      })
    ).json();

    for (const emoji of ['un paragrafo intero', 'a', '', '<script>']) {
      const r = await admin.chiama(`/api/messaggi/${messaggio.id}/reazioni`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      assert.equal(r.status, 400, `"${emoji}" doveva essere rifiutata`);
    }
  });
});

describe('ricerca', () => {
  it('trova nel testo, anche con gli accenti scritti diversamente', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio, testo } = await conSpazio(admin.chiama, 'Casa');

    const scrivi = (t) =>
      admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: t }),
      });

    await scrivi('la riunione di lunedì');
    await scrivi('niente di interessante');

    const { risultati } = await (
      await admin.chiama(`/api/spazi/${spazio.id}/cerca?q=${encodeURIComponent('lunedi')}`)
    ).json();
    assert.equal(risultati.length, 1);
    assert.match(risultati[0].testo, /riunione/);
  });

  it('non si rompe con gli apostrofi e la punteggiatura', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio, testo } = await conSpazio(admin.chiama, 'Casa');

    await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: "l'officina e' aperta" }),
    });

    // Senza le virgolette attorno alla query, un apostrofo verrebbe letto come
    // sintassi di FTS5 e la ricerca fallirebbe con un errore.
    for (const q of ["l'officina", 'officina*', 'NOT aperta', '"']) {
      const r = await admin.chiama(`/api/spazi/${spazio.id}/cerca?q=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200, `la query "${q}" ha fatto errore`);
    }
  });

  it('non guarda dentro i messaggi eliminati', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio, testo } = await conSpazio(admin.chiama, 'Casa');

    const { messaggio } = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'segretissimo' }),
      })
    ).json();
    await admin.chiama(`/api/messaggi/${messaggio.id}`, { method: 'DELETE' });

    const { risultati } = await (await admin.chiama(`/api/spazi/${spazio.id}/cerca?q=segretissimo`)).json();
    assert.equal(risultati.length, 0);
  });
});

describe('allegati', () => {
  const carica = (chi, base, token, nome, contenuto, tipo = 'text/plain') =>
    fetch(`${base}/api/allegati`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': tipo, 'x-nome': nome },
      body: contenuto,
    });

  it('carica, lega a un messaggio e riscarica', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const su = await carica(admin, base, admin.token, 'note.txt', 'ciao mondo');
    assert.equal(su.status, 201);
    const { id, dimensione } = await su.json();
    assert.equal(dimensione, 10);

    const { messaggio } = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'ecco', allegati: [id] }),
      })
    ).json();
    assert.equal(messaggio.allegati.length, 1);
    assert.equal(messaggio.allegati[0].nome, 'note.txt');

    const giu = await admin.chiama(`/api/allegati/${id}`);
    assert.equal(giu.status, 200);
    assert.equal(await giu.text(), 'ciao mondo');
  });

  it('un messaggio di soli allegati e\' valido', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await carica(admin, base, admin.token, 'foto.png', 'finta')).json();
    const r = await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ allegati: [id] }),
    });
    assert.equal(r.status, 201);
  });

  it('non lascia appropriarsi dell\'allegato di un altro', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await carica(admin, base, admin.token, 'mio.txt', 'roba')).json();

    // Marco prova ad attaccarlo a un suo messaggio: non deve succedere niente.
    const { messaggio } = await (
      await marco.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'guardate qui', allegati: [id] }),
      })
    ).json();
    assert.equal(messaggio.allegati.length, 0);

    // E non deve nemmeno poterlo scaricare finche' non e' stato mandato.
    assert.equal((await marco.chiama(`/api/allegati/${id}`)).status, 404);
  });

  it('due file identici occupano lo spazio di uno', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const primo = await (await carica(admin, base, admin.token, 'a.txt', 'stesso contenuto')).json();
    const secondo = await (await carica(admin, base, admin.token, 'b.txt', 'stesso contenuto')).json();

    assert.notEqual(primo.id, secondo.id, 'due record distinti');
    const righe = talk.db.sql
      .prepare('SELECT DISTINCT impronta FROM allegati WHERE id IN (?, ?)')
      .all(primo.id, secondo.id);
    assert.equal(righe.length, 1, 'un file solo sul disco');
  });

  it('rifiuta un caricamento vuoto', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    assert.equal((await carica(admin, base, admin.token, 'vuoto.txt', '')).status, 400);
  });
});

describe('allegati a pezzi', () => {
  // La misura del pezzo la decide il client: il server dice solo qual e' il
  // massimo che regge in una richiesta. Qui sono da quattro byte, cosi' un
  // file da undici ne fa tre e i casi limite si scrivono a mano.
  const inizia = (base, token, nome, dimensione, tipo = 'text/plain') =>
    fetch(`${base}/api/allegati/inizio`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
        'x-nome': nome,
        'x-tipo': tipo,
        'x-dimensione': String(dimensione),
      },
    });

  const pezzo = (base, token, id, offset, contenuto) =>
    fetch(`${base}/api/allegati/${id}/pezzo`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
        'x-offset': String(offset),
      },
      body: contenuto,
    });

  const fine = (base, token, id) =>
    fetch(`${base}/api/allegati/${id}/fine`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    });

  it('carica in tre pezzi, lega a un messaggio e riscarica identico', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const contenuto = 'ciao mondo!';
    const aperto = await inizia(base, admin.token, 'lungo.txt', contenuto.length);
    assert.equal(aperto.status, 201);
    const { id, pezzo: quanto } = await aperto.json();
    assert.ok(quanto > 0, 'il server dice quanto puo\' essere grosso un pezzo');

    for (let offset = 0; offset < contenuto.length; offset += 4) {
      const r = await pezzo(base, admin.token, id, offset, contenuto.slice(offset, offset + 4));
      assert.equal(r.status, 200);
      const { ricevuti } = await r.json();
      assert.equal(ricevuti, Math.min(offset + 4, contenuto.length));
    }

    const chiuso = await fine(base, admin.token, id);
    assert.equal(chiuso.status, 201);
    const allegato = await chiuso.json();
    assert.equal(allegato.dimensione, contenuto.length);
    assert.equal(allegato.nome, 'lungo.txt');

    const { messaggio } = await (
      await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'eccolo', allegati: [allegato.id] }),
      })
    ).json();
    assert.equal(messaggio.allegati.length, 1);

    const giu = await admin.chiama(`/api/allegati/${allegato.id}`);
    assert.equal(await giu.text(), contenuto, 'i pezzi si sono rimessi insieme nell\'ordine giusto');
  });

  it('riprende da dove era arrivato', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const contenuto = 'meta e meta';
    const { id } = await (await inizia(base, admin.token, 'ripreso.txt', contenuto.length)).json();
    await pezzo(base, admin.token, id, 0, contenuto.slice(0, 5));

    // Qui il client "cade". Alla ripresa chiede dove era rimasto invece di
    // ricominciare: e' tutto il motivo per cui i pezzi esistono.
    const stato = await admin.chiama(`/api/allegati/${id}/stato`);
    assert.equal(stato.status, 200);
    const { ricevuti, dimensione } = await stato.json();
    assert.equal(ricevuti, 5);
    assert.equal(dimensione, contenuto.length);

    await pezzo(base, admin.token, id, ricevuti, contenuto.slice(ricevuti));
    const allegato = await (await fine(base, admin.token, id)).json();
    const giu = await admin.chiama(`/api/allegati/${allegato.id}`);
    assert.equal(await giu.text(), contenuto);
  });

  it('rifiuta un pezzo fuori posto e dice dov\'e\' la coda', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await inizia(base, admin.token, 'storto.txt', 10)).json();
    await pezzo(base, admin.token, id, 0, 'abcd');

    // Lo stesso pezzo due volte: appeso di nuovo darebbe un file della
    // dimensione giusta e del contenuto sbagliato.
    const ripetuto = await pezzo(base, admin.token, id, 0, 'abcd');
    assert.equal(ripetuto.status, 409);
    assert.equal((await ripetuto.json()).ricevuti, 4);

    const saltato = await pezzo(base, admin.token, id, 8, 'ef');
    assert.equal(saltato.status, 409);
  });

  it('non chiude un caricamento incompleto', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await inizia(base, admin.token, 'monco.txt', 10)).json();
    await pezzo(base, admin.token, id, 0, 'abcd');

    const chiuso = await fine(base, admin.token, id);
    assert.equal(chiuso.status, 409);
    const corpo = await chiuso.json();
    assert.equal(corpo.ricevuti, 4);
    assert.equal(corpo.dimensione, 10);
  });

  it('non accetta piu\' byte di quanti ne erano stati promessi', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await inizia(base, admin.token, 'gonfio.txt', 4)).json();
    const troppo = await pezzo(base, admin.token, id, 0, 'abcdefgh');
    assert.equal(troppo.status, 413);

    // E il troncone e' tornato come prima, non e' rimasto a meta'.
    assert.equal((await (await admin.chiama(`/api/allegati/${id}/stato`)).json()).ricevuti, 0);
  });

  it('rifiuta subito un file oltre il tetto, senza mandare niente', async (t) => {
    // Il tetto piu' basso che la configurazione accetta, per non dover
    // fabbricare quattro giga di prova.
    const tetto = 64 * 1024;
    const { talk, base } = await conServer(t, { TALK_MAX_ALLEGATO: String(tetto) });
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const troppo = await inizia(base, admin.token, 'enorme.bin', tetto * 2);
    assert.equal(troppo.status, 413);
    assert.equal((await troppo.json()).massimo, tetto);
  });

  it('il caricamento di un altro non si tocca', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    await conSpazio(admin.chiama, 'Casa');

    const { id } = await (await inizia(base, admin.token, 'mio.txt', 10)).json();

    assert.equal((await pezzo(base, marco.token, id, 0, 'abcd')).status, 404);
    assert.equal((await marco.chiama(`/api/allegati/${id}/stato`)).status, 404);
    assert.equal((await fine(base, marco.token, id)).status, 404);
  });

  it('due file identici mandati a pezzi occupano lo spazio di uno', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    await conSpazio(admin.chiama, 'Casa');

    const contenuto = 'stesso contenuto';
    const mandato = async (nome) => {
      const { id } = await (await inizia(base, admin.token, nome, contenuto.length)).json();
      await pezzo(base, admin.token, id, 0, contenuto);
      return (await fine(base, admin.token, id)).json();
    };

    const primo = await mandato('a.txt');
    const secondo = await mandato('b.txt');
    assert.notEqual(primo.id, secondo.id);

    const righe = talk.db.sql
      .prepare('SELECT DISTINCT impronta FROM allegati WHERE id IN (?, ?)')
      .all(primo.id, secondo.id);
    assert.equal(righe.length, 1, 'la deduplica vale anche per i pezzi');
  });
});

describe('il flusso degli eventi', () => {
  it('porta i messaggi a chi sta nello spazio, nell\'istante in cui arrivano', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { testo } = await conSpazio(admin.chiama, 'Casa');

    const flusso = await marco.chiama('/api/eventi');
    assert.equal(flusso.status, 200);
    assert.match(flusso.headers.get('content-type'), /text\/event-stream/);

    const lettore = flusso.body.getReader();
    const decoder = new TextDecoder();
    // Si aspetta *quel* tipo di evento, non il primo che passa.
    //
    // Dal flusso arriva anche la presenza: aprendolo si diventa online, e
    // l'annuncio parte subito — a chi si collega compreso. Pretendere che il
    // primo blocco sia un messaggio vorrebbe dire un test che fallisce ogni
    // volta che qualcuno aggiunge un evento di servizio, cioe' un test che
    // misura l'ordine invece del comportamento.
    let buffer = '';
    const prossimo = async (tipo) => {
      for (;;) {
        const { value, done } = await lettore.read();
        if (done) throw new Error('flusso chiuso troppo presto');
        buffer += decoder.decode(value, { stream: true });
        const blocchi = buffer.split('\n\n');
        buffer = blocchi.pop();
        for (const blocco of blocchi) {
          // I commenti di battito (`: .`) non sono eventi.
          const riga = blocco.split('\n').find((l) => l.startsWith('data: '));
          if (!riga) continue;
          const evento = JSON.parse(riga.slice(6));
          if (!tipo || evento.tipo === tipo) return evento;
        }
      }
    };

    await admin.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'arrivo' }),
    });

    const evento = await prossimo('messaggio');
    assert.equal(evento.tipo, 'messaggio');
    assert.equal(evento.canale, testo.id);
    assert.equal(evento.messaggio.testo, 'arrivo');

    // E leggendolo, il numero blu si spegne: l'evento va a chi ha letto, e va
    // a *tutte* le sue sessioni. Senza, la lettura finiva nel database e
    // nessuno lo diceva all'elenco dei canali, che restava fermo al conteggio
    // dell'ultima GET /api/spazi.
    await marco.chiama(`/api/canali/${testo.id}/letto`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const letto = await prossimo('letto');
    assert.equal(letto.canale, testo.id);
    assert.equal(letto.fino, evento.messaggio.id);

    await lettore.cancel();
  });
});

describe('nomi utente fra server diversi', () => {
  it('dice se un nome e\' gia\' preso, ma solo a chi ha un invito', async (t) => {
    const { talk, base } = await conServer(t);
    await accesso(talk, base, { nome: 'Marco', utente: 'marco', ruolo: 'membro' });

    const codice = talk.db.creaInvito({ nome: 'Nuovo', ruolo: 'membro' });

    const preso = await (
      await fetch(`${base}/api/auth/nome-libero`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codice, utente: 'marco' }),
      })
    ).json();
    assert.equal(preso.libero, false, 'su questo server un marco esiste gia');

    const libero = await (
      await fetch(`${base}/api/auth/nome-libero`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codice, utente: 'marco.casa' }),
      })
    ).json();
    assert.equal(libero.libero, true);

    // Senza un codice valido non si risponde: sarebbe un elenco di nomi utente
    // veri consegnato a chiunque passi.
    const senza = await fetch(`${base}/api/auth/nome-libero`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codice: 'inventato', utente: 'marco' }),
    });
    assert.equal(senza.status, 403);
  });

  it('riscattare con un nome preso da\' 409, e con un altro passa', async (t) => {
    const { talk, base } = await conServer(t);
    await accesso(talk, base, { nome: 'Marco', utente: 'marco', ruolo: 'membro' });

    const riscatta = (utente) =>
      fetch(`${base}/api/auth/riscatta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          codice: talk.db.creaInvito({ nome: 'Nuovo', ruolo: 'membro' }),
          utente,
          password: 'unapasswordlunga',
        }),
      });

    assert.equal((await riscatta('marco')).status, 409);
    assert.equal((await riscatta('marco.ufficio')).status, 200);
  });
});

describe('configurazione', () => {
  it('non parte senza il segreto della SFU', () => {
    assert.throws(
      () => leggiConfig({ TALK_ROOT: tmpdir(), SFU_API_KEY: 'x', SFU_API_SECRET: 'corto' }),
      /SFU_API_KEY \/ SFU_API_SECRET/,
    );
  });

  it('lascia alzare i tetti dall\'ambiente', () => {
    const config = leggiConfig({
      TALK_ROOT: tmpdir(),
      TALK_NO_AUTH: '1',
      TALK_MAX_BITRATE_SCHERMO: '80000000',
      TALK_MAX_FPS_SCHERMO: '120',
    });
    assert.equal(config.limiti.bitrateSchermo, 80_000_000);
    assert.equal(config.limiti.fpsSchermo, 120);
  });

  it('rifiuta un tetto che non e\' un numero', () => {
    assert.throws(
      () => leggiConfig({ TALK_ROOT: tmpdir(), TALK_NO_AUTH: '1', TALK_MAX_FPS_SCHERMO: 'tanti' }),
      /TALK_MAX_FPS_SCHERMO/,
    );
  });

  it('valida e ordina le versioni client dichiarate', () => {
    const config = leggiConfig({
      TALK_ROOT: tmpdir(),
      TALK_NO_AUTH: '1',
      TALK_CLIENT_MIN: '0.3.0',
      TALK_CLIENT_TARGET: '0.3.6',
      TALK_CLIENT_MAX: '0.3.9',
      TALK_AGGIORNAMENTI_URL: 'https://download.esempio.it/pulsetalk/',
    });
    assert.deepEqual(config.client, {
      minima: '0.3.0',
      target: '0.3.6',
      massima: '0.3.9',
      feedUrl: 'https://download.esempio.it/pulsetalk/',
    });

    assert.throws(
      () => leggiConfig({
        TALK_ROOT: tmpdir(),
        TALK_NO_AUTH: '1',
        TALK_CLIENT_MIN: '0.4.0',
        TALK_CLIENT_TARGET: '0.3.6',
      }),
      /TALK_CLIENT_TARGET/,
    );
    assert.throws(
      () => leggiConfig({ TALK_ROOT: tmpdir(), TALK_NO_AUTH: '1', TALK_CLIENT_MIN: 'ultima' }),
      /semver/,
    );
  });
});

describe('compatibilita client', () => {
  const chiedi = (base, versione) =>
    fetch(
      `${base}/api/client/compatibilita?versione=${encodeURIComponent(versione)}` +
      '&piattaforma=win32&architettura=x64',
    );

  it('e pubblica e distingue vecchio, corrente e troppo nuovo', async (t) => {
    const { base } = await conServer(t, {
      TALK_CLIENT_MIN: '0.3.0',
      TALK_CLIENT_TARGET: '0.3.6',
      TALK_CLIENT_MAX: '0.3.9',
    });

    const vecchioCompatibile = await chiedi(base, '0.3.2');
    assert.equal(vecchioCompatibile.status, 200, 'non deve servire un token');
    assert.deepEqual(await vecchioCompatibile.json(), {
      versioneClient: '0.3.2',
      versioneMinima: '0.3.0',
      versioneTarget: '0.3.6',
      versioneMassima: '0.3.9',
      compatibile: true,
      obbligatorio: true,
      azione: 'aggiorna',
      feedUrl: '/aggiornamenti/',
      motivo: 'Il server richiede PulseTalk 0.3.6 prima di continuare.',
    });

    const corrente = await chiedi(base, '0.3.6');
    assert.equal((await corrente.json()).azione, 'nessuna');

    const troppoVecchio = await chiedi(base, '0.2.9');
    const corpoVecchio = await troppoVecchio.json();
    assert.equal(corpoVecchio.compatibile, false);
    assert.equal(corpoVecchio.azione, 'aggiorna');

    const troppoNuovo = await chiedi(base, '0.4.0');
    const corpoNuovo = await troppoNuovo.json();
    assert.equal(corpoNuovo.compatibile, false);
    assert.equal(corpoNuovo.azione, 'clientTroppoNuovo');
    assert.match(corpoNuovo.motivo, /server accetta al massimo/);
  });

  it('resta permissiva senza configurazione e rifiuta query malformate', async (t) => {
    const { base } = await conServer(t);
    const futura = await chiedi(base, '99.0.0');
    const corpo = await futura.json();
    assert.equal(corpo.compatibile, true);
    assert.equal(corpo.obbligatorio, false);

    assert.equal((await chiedi(base, 'non-semver')).status, 400);
    assert.equal((await chiedi(base, '1.2.3-01')).status, 400);
  });
});

describe('webhook della SFU', () => {
  it('rifiuta un corpo senza firma o con la firma sbagliata', async (t) => {
    const { base } = await conServer(t);
    const corpo = JSON.stringify({ event: 'participant_joined', room: { name: 'casa--salotto' } });

    for (const intestazioni of [{}, { authorization: 'Bearer inventato' }]) {
      const r = await fetch(`${base}/webhook/sfu`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', ...intestazioni },
        body: corpo,
      });
      assert.equal(r.status, 401);
    }
  });

  it('accetta un corpo firmato con il segreto giusto', async (t) => {
    const { base } = await conServer(t);
    // Si firma come farebbe LiveKit: un gettone il cui claim `sha256` e'
    // l'impronta del corpo. E' la firma a legare l'autorizzazione a *questi*
    // byte, altrimenti un gettone catturato una volta varrebbe per qualunque
    // evento inventato dopo.
    const { AccessToken } = await import('livekit-server-sdk');
    const { createHash } = await import('node:crypto');

    const corpo = JSON.stringify({ event: 'participant_joined', room: { name: 'casa--salotto' } });
    const gettone = new AccessToken('chiave-di-prova', SEGRETO, { ttl: 60 });
    gettone.sha256 = createHash('sha256').update(corpo).digest('base64');

    const r = await fetch(`${base}/webhook/sfu`, {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: await gettone.toJwt() },
      body: corpo,
    });
    assert.equal(r.status, 200);
  });
});

describe('migrazione dalle stanze', () => {
  it('aggiunge la scadenza a un database che ha gia canali senza quella colonna', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-mig-canali-'));
    const percorso = join(dir, 'talk.db');
    const { default: Database } = await import('better-sqlite3');
    const grezzo = new Database(percorso);
    grezzo.exec(`
      CREATE TABLE canali (
        id INTEGER PRIMARY KEY, spazio INTEGER NOT NULL, categoria INTEGER,
        chiave TEXT NOT NULL, nome TEXT NOT NULL, tipo TEXT NOT NULL,
        argomento TEXT NOT NULL DEFAULT '', posizione INTEGER NOT NULL DEFAULT 0,
        soloAscolto INTEGER NOT NULL DEFAULT 0, creato INTEGER NOT NULL
      );
    `);
    grezzo.close();

    const { TalkDb } = await import('../src/db.mjs');
    const db = new TalkDb(percorso);
    assert.ok(db.sql.prepare('PRAGMA table_info(canali)').all().some((c) => c.name === 'scade'));
    assert.ok(
      db.sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_canali_scadenza'").get(),
    );
    db.close();
    t.after(() => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
    });
  });

  it('trasforma le stanze della prima versione in canali vocali', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-mig-'));
    const percorso = join(dir, 'talk.db');

    // Si ricostruisce a mano lo stato della prima versione: la tabella
    // `stanze` con dentro due righe, e nessuno spazio.
    const { default: Database } = await import('better-sqlite3');
    const grezzo = new Database(percorso);
    grezzo.exec(`
      CREATE TABLE utenti (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ruolo TEXT NOT NULL,
                           creato INTEGER NOT NULL, attivo INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE stanze (id INTEGER PRIMARY KEY, chiave TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
                           descrizione TEXT NOT NULL DEFAULT '', creata INTEGER NOT NULL,
                           creataDa INTEGER, soloAscolto INTEGER NOT NULL DEFAULT 0);
      INSERT INTO utenti (id, nome, ruolo, creato) VALUES (1, 'Marco', 'admin', 0);
      INSERT INTO stanze (chiave, nome, descrizione, creata, soloAscolto)
             VALUES ('officina', 'Officina', 'si lavora', 0, 0),
                    ('palco', 'Palco', '', 0, 1);
    `);
    grezzo.close();

    const { TalkDb } = await import('../src/db.mjs');
    const db = new TalkDb(percorso);

    const spazi = db.sql.prepare('SELECT * FROM spazi').all();
    assert.equal(spazi.length, 1, 'nasce uno spazio solo');

    const canali = db.canaliDi(spazi[0].id);
    const officina = canali.find((c) => c.chiave === 'officina');
    assert.ok(officina, 'nessuna stanza va persa');
    assert.equal(officina.tipo, 'voce');
    assert.equal(officina.argomento, 'si lavora');
    assert.equal(canali.find((c) => c.chiave === 'palco').soloAscolto, true);
    assert.ok(canali.some((c) => c.tipo === 'testo'), 'e ci si aggiunge un canale di testo');

    // Chi c'era gia' si ritrova dentro allo spazio, non fuori.
    assert.equal(db.spaziDi(1).length, 1);

    db.close();
    t.after(() => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
    });
  });

  it('non rifa\' la migrazione a ogni avvio', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-mig2-'));
    const percorso = join(dir, 'talk.db');
    const { TalkDb } = await import('../src/db.mjs');

    const primo = new TalkDb(percorso);
    // La tabella `stanze` non fa piu' parte dello schema: si ricrea a mano per
    // simulare un database che arriva dalla versione di prima.
    primo.sql.exec(`
      CREATE TABLE stanze (id INTEGER PRIMARY KEY, chiave TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
                           descrizione TEXT NOT NULL DEFAULT '', creata INTEGER NOT NULL,
                           creataDa INTEGER, soloAscolto INTEGER NOT NULL DEFAULT 0);
    `);
    primo.sql
      .prepare('INSERT INTO stanze (chiave, nome, creata) VALUES (?, ?, ?)')
      .run('officina', 'Officina', 0);
    primo.close();

    const secondo = new TalkDb(percorso);
    const quanti = secondo.sql.prepare('SELECT COUNT(*) AS n FROM spazi').get().n;
    secondo.close();

    const terzo = new TalkDb(percorso);
    assert.equal(terzo.sql.prepare('SELECT COUNT(*) AS n FROM spazi').get().n, quanti);
    terzo.close();

    t.after(() => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
    });
  });
});

describe('canali privati', () => {
  /** Un admin, due membri, uno spazio, e un canale privato con dentro uno solo dei due. */
  async function conCanalePrivato(t) {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const dentro = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const fuori = await accesso(talk, base, { nome: 'Lucia', ruolo: 'membro' });

    const { spazio } = await conSpazio(admin.chiama, 'Casa');

    const r = await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({
        nome: 'Segreti',
        tipo: 'testo',
        privato: true,
        invitati: [dentro.utente.id],
      }),
    });
    assert.equal(r.status, 201);
    const { canale } = await r.json();
    assert.equal(canale.privato, true);

    return { talk, base, admin, dentro, fuori, spazio, canale };
  }

  const canaliDi = async (chi, spazioId) => {
    const { spazi } = await (await chi.chiama('/api/spazi')).json();
    return spazi.find((s) => s.id === spazioId).canali;
  };

  it('lo vede chi e\' stato invitato, e non esiste per gli altri', async (t) => {
    const { dentro, fuori, spazio, canale } = await conCanalePrivato(t);

    const suoi = await canaliDi(dentro, spazio.id);
    assert.ok(suoi.some((c) => c.id === canale.id), 'chi e\' invitato deve vederlo');

    const altrui = await canaliDi(fuori, spazio.id);
    assert.equal(altrui.some((c) => c.id === canale.id), false);

    // E non basta nasconderlo nell'elenco: chiedendolo per id deve rispondere
    // come se non ci fosse mai stato.
    assert.equal((await fuori.chiama(`/api/canali/${canale.id}/messaggi`)).status, 404);
    assert.equal(
      (
        await fuori.chiama(`/api/canali/${canale.id}/messaggi`, {
          method: 'POST',
          body: JSON.stringify({ testo: 'ciao' }),
        })
      ).status,
      404,
    );
  });

  it('non si entra nel vocale privato di qualcun altro', async (t) => {
    const { admin, fuori, spazio } = await conCanalePrivato(t);

    const r = await admin.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Riunione', tipo: 'voce', privato: true }),
    });
    const { canale } = await r.json();

    assert.equal(
      (await fuori.chiama(`/api/canali/${canale.id}/entra`, { method: 'POST' })).status,
      404,
    );
    // L'admin invece c'e' dentro, perche' l'ha creato lui.
    assert.equal(
      (await admin.chiama(`/api/canali/${canale.id}/entra`, { method: 'POST' })).status,
      200,
    );
  });

  it('non si trova nemmeno cercando', async (t) => {
    const { talk, dentro, fuori, spazio, canale } = await conCanalePrivato(t);
    if (!talk.db.ricercaDisponibile) return;

    await dentro.chiama(`/api/canali/${canale.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'parolamagica dentro al privato' }),
    });

    const suoi = await (await dentro.chiama(`/api/spazi/${spazio.id}/cerca?q=parolamagica`)).json();
    assert.equal(suoi.risultati.length, 1);

    const altrui = await (await fuori.chiama(`/api/spazi/${spazio.id}/cerca?q=parolamagica`)).json();
    assert.equal(altrui.risultati.length, 0, 'la ricerca non deve essere la porta di servizio');
  });

  it('chi e\' dentro invita, chi e\' fuori no', async (t) => {
    const { dentro, fuori, canale } = await conCanalePrivato(t);

    // Per chi e' fuori quel canale non esiste, quindi non esiste nemmeno il
    // suo elenco di iscritti.
    assert.equal(
      (
        await fuori.chiama(`/api/canali/${canale.id}/iscritti`, {
          method: 'POST',
          body: JSON.stringify({ utente: fuori.utente.id }),
        })
      ).status,
      404,
    );

    const r = await dentro.chiama(`/api/canali/${canale.id}/iscritti`, {
      method: 'POST',
      body: JSON.stringify({ utente: fuori.utente.id }),
    });
    assert.equal(r.status, 201);

    const { spazi } = await (await fuori.chiama('/api/spazi')).json();
    assert.ok(spazi[0].canali.some((c) => c.id === canale.id), 'invitato, ora lo vede');
  });

  it('chi viene tolto smette di vederlo, e da solo si puo\' uscire', async (t) => {
    const { admin, dentro, canale, spazio } = await conCanalePrivato(t);

    assert.equal(
      (
        await admin.chiama(`/api/canali/${canale.id}/iscritti/${dentro.utente.id}`, {
          method: 'DELETE',
        })
      ).status,
      200,
    );
    const dopo = await canaliDi(dentro, spazio.id);
    assert.equal(dopo.some((c) => c.id === canale.id), false);

    const rientro = await admin.chiama(`/api/canali/${canale.id}/iscritti`, {
      method: 'POST',
      body: JSON.stringify({ utente: dentro.utente.id }),
    });
    assert.equal(rientro.status, 201);

    // Un membro qualunque non puo' togliere un altro, ma se stesso si'.
    assert.equal(
      (
        await dentro.chiama(`/api/canali/${canale.id}/iscritti/${admin.utente.id}`, {
          method: 'DELETE',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await dentro.chiama(`/api/canali/${canale.id}/iscritti/${dentro.utente.id}`, {
          method: 'DELETE',
        })
      ).status,
      200,
    );
  });
});

describe('amici', () => {
  async function due(t) {
    const { talk, base } = await conServer(t);
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lucia = await accesso(talk, base, { nome: 'Lucia', ruolo: 'membro' });
    return { talk, base, marco, lucia };
  }

  it('chiede, accetta, e smette', async (t) => {
    const { marco, lucia } = await due(t);

    const r = await marco.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ utente: lucia.utente.id }),
    });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).stato, 'attesa');

    const suoi = await (await marco.chiama('/api/amici')).json();
    assert.equal(suoi.inviate.length, 1);
    assert.equal(suoi.amici.length, 0);

    const altrui = await (await lucia.chiama('/api/amici')).json();
    assert.equal(altrui.ricevute.length, 1);
    assert.equal(altrui.ricevute[0].nome, 'Marco');

    assert.equal(
      (await lucia.chiama(`/api/amici/${marco.utente.id}/accetta`, { method: 'POST' })).status,
      200,
    );
    assert.equal((await (await marco.chiama('/api/amici')).json()).amici.length, 1);
    assert.equal((await (await lucia.chiama('/api/amici')).json()).amici.length, 1);

    assert.equal(
      (await marco.chiama(`/api/amici/${lucia.utente.id}`, { method: 'DELETE' })).status,
      200,
    );
    assert.equal((await (await lucia.chiama('/api/amici')).json()).amici.length, 0);
  });

  it('due richieste incrociate fanno un\'amicizia sola', async (t) => {
    const { marco, lucia } = await due(t);

    await marco.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ utente: lucia.utente.id }),
    });
    const r = await lucia.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ utente: marco.utente.id }),
    });
    assert.equal((await r.json()).stato, 'amici');

    const suoi = await (await marco.chiama('/api/amici')).json();
    assert.equal(suoi.amici.length, 1);
    assert.equal(suoi.inviate.length, 0);
    assert.equal(suoi.ricevute.length, 0);
  });

  it('non si accetta la propria richiesta, e si cerca per nome utente', async (t) => {
    const { marco, lucia } = await due(t);

    const r = await marco.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ nomeUtente: 'lucia' }),
    });
    assert.equal(r.status, 201);

    assert.equal(
      (await marco.chiama(`/api/amici/${lucia.utente.id}/accetta`, { method: 'POST' })).status,
      400,
    );
    assert.equal(
      (
        await marco.chiama('/api/amici', {
          method: 'POST',
          body: JSON.stringify({ nomeUtente: 'nessuno' }),
        })
      ).status,
      404,
    );
  });
});
