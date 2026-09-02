// Il registro delle registrazioni, e la regola che dice quando si puo'.
//
// Quello che questi test difendono e' la parte che serve dopo: che con la
// regola su «vietata» il server dica di no invece di lasciar fare, che una
// registrazione lasci una riga con dentro in che condizioni e' cominciata, e
// che nessuno possa chiudere quella di un altro - una riga chiusa da qualcun
// altro direbbe che ho smesso di registrare in un momento in cui non e' vero.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';

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

async function conServer(t, ambiente = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-rec-'));
  const env = {
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
    SFU_API_URL: 'http://127.0.0.1:1',
    TALK_LOG_LEVEL: 'silent',
    ...ambiente,
  };
  const talk = await creaTalk(leggiConfig(env), { ambiente: env });
  const porta = await ascoltaSuPortaBuona(talk.app);
  const base = `http://127.0.0.1:${porta}`;

  t.after(async () => {
    await talk.app.close();
    talk.db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
  });

  return { talk, base };
}

async function accesso(talk, base, { nome, ruolo }) {
  const codice = talk.db.creaInvito({ nome, ruolo });
  const r = await fetch(`${base}/api/auth/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codice, utente: nome.toLowerCase(), password: PASSWORD, nome }),
  });
  assert.equal(r.status, 200, `riscatto fallito per ${nome}`);
  const corpo = await r.json();
  return { ...corpo, chiama: conToken(base, corpo.token) };
}

async function conSpazio(chiama, nome) {
  const r = await chiama('/api/spazi', {
    method: 'POST',
    body: JSON.stringify({ nome, impostazioni: { apertoATutti: true } }),
  });
  assert.equal(r.status, 201);
  const { spazio } = await r.json();
  const { spazi } = await (await chiama('/api/spazi')).json();
  const mio = spazi.find((s) => s.id === spazio.id);
  return { spazio: mio, voce: mio.canali.find((c) => c.tipo === 'voce') };
}

describe('la regola sulle registrazioni', () => {
  it('di serie e\' libera, e viaggia con il gettone della stanza', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama, 'Casa');

    const dentro = await capo.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST', body: '{}' });
    assert.equal(dentro.status, 200);
    assert.equal((await dentro.json()).registrazione, 'libera');
  });

  it('vietata, il server dice di no invece di lasciar fare', async (t) => {
    const { talk, base } = await conServer(t, { TALK_REGISTRAZIONE: 'vietata' });
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama, 'Casa');

    const dentro = await capo.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST', body: '{}' });
    assert.equal((await dentro.json()).registrazione, 'vietata');

    const aperta = await capo.chiama(`/api/canali/${voce.id}/registrazioni`, {
      method: 'POST',
      body: JSON.stringify({ cosa: 'chiamata', presenti: 2, consensi: 2 }),
    });
    assert.equal(aperta.status, 403);
  });

  it('un valore inventato non fa partire il server', () => {
    assert.throws(
      () =>
        leggiConfig({
          TALK_ROOT: tmpdir(),
          SFU_API_KEY: 'chiave-di-prova',
          SFU_API_SECRET: SEGRETO,
          SFU_URL: 'wss://sfu.esempio.it',
          TALK_REGISTRAZIONE: 'quandomipare',
        }),
      /TALK_REGISTRAZIONE/,
    );
  });
});

describe('il registro delle registrazioni', () => {
  it('tiene chi, cosa, quando, e in che condizioni e\' cominciata', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama, 'Casa');
    await tale.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST', body: '{}' });

    const aperta = await capo.chiama(`/api/canali/${voce.id}/registrazioni`, {
      method: 'POST',
      body: JSON.stringify({ cosa: 'chiamata', presenti: 3, consensi: 2 }),
    });
    assert.equal(aperta.status, 200);
    const { id } = await aperta.json();

    // Chi c'era dentro puo' sapere di essere stato registrato: non e' un
    // privilegio di chi amministra.
    const prima = await (await tale.chiama(`/api/canali/${voce.id}/registrazioni`)).json();
    assert.equal(prima.registrazioni.length, 1);
    assert.equal(prima.registrazioni[0].nome, 'Capo');
    assert.equal(prima.registrazioni[0].cosa, 'chiamata');
    assert.equal(prima.registrazioni[0].presenti, 3);
    assert.equal(prima.registrazioni[0].consensi, 2);
    assert.equal(prima.registrazioni[0].chiusa, null, 'appena aperta non e\' chiusa');

    // Quella di un altro non si chiude.
    await tale.chiama(`/api/registrazioni/${id}`, { method: 'PATCH', body: '{}' });
    const mezzo = await (await capo.chiama(`/api/canali/${voce.id}/registrazioni`)).json();
    assert.equal(mezzo.registrazioni[0].chiusa, null, 'l\'ha chiusa qualcun altro');

    await capo.chiama(`/api/registrazioni/${id}`, { method: 'PATCH', body: '{}' });
    const dopo = await (await capo.chiama(`/api/canali/${voce.id}/registrazioni`)).json();
    assert.ok(dopo.registrazioni[0].chiusa > 0, 'chiusa da chi registrava');
  });

  it('rifiuta un «cosa» che non esiste e un canale che non c\'e\'', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama, 'Casa');

    const storta = await capo.chiama(`/api/canali/${voce.id}/registrazioni`, {
      method: 'POST',
      body: JSON.stringify({ cosa: 'tutto' }),
    });
    assert.equal(storta.status, 400);

    const inesistente = await capo.chiama('/api/canali/999999/registrazioni', {
      method: 'POST',
      body: JSON.stringify({ cosa: 'chiamata' }),
    });
    assert.equal(inesistente.status, 404);
  });
});
