// Collegare un dispositivo nuovo senza digitare la password.
//
// Il codice qui *e'* una credenziale: chi lo ha entra, senza sapere altro.
// Quindi quello che questi test difendono e' che duri poco, valga una volta, e
// non ne restino in giro due — e che il dispositivo nuovo ottenga una sessione
// sua, distinguibile dalle altre, invece di condividere quella di chi ha letto
// il codice.

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

async function conServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-disp-'));
  const env = {
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
    SFU_API_URL: 'http://127.0.0.1:1',
    TALK_LOG_LEVEL: 'silent',
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

async function accesso(talk, base, nome) {
  const codice = talk.db.creaInvito({ nome, ruolo: 'membro' });
  const r = await fetch(`${base}/api/auth/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codice, utente: nome.toLowerCase(), password: PASSWORD, nome }),
  });
  assert.equal(r.status, 200);
  const corpo = await r.json();
  return { ...corpo, chiama: conToken(base, corpo.token) };
}

const riscatta = (base, codice, dispositivo) =>
  fetch(`${base}/api/auth/dispositivo/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codice, dispositivo }),
  });

describe('collegare un dispositivo con un codice', () => {
  it('il dispositivo nuovo entra, con una sessione sua', async (t) => {
    const { talk, base } = await conServer(t);
    const tizio = await accesso(talk, base, 'Tizio');

    const { codice } = await (
      await tizio.chiama('/api/auth/dispositivo/codice', { method: 'POST' })
    ).json();
    assert.match(codice, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);

    const r = await riscatta(base, codice, 'PulseTalk app su telefono');
    assert.equal(r.status, 200);
    const { token, utente } = await r.json();

    assert.equal(utente.utente, 'tizio');
    assert.notEqual(token, tizio.token, 'deve essere una sessione nuova, non la stessa');

    // E si vede nell'elenco dei dispositivi, che e' il punto: da li' si
    // scollega senza toccare le altre.
    const { sessioni } = await (await tizio.chiama('/api/auth/sessioni')).json();
    assert.equal(sessioni.length, 2);
    assert.ok(sessioni.some((s) => s.dispositivo === 'PulseTalk app su telefono'));
  });

  it('vale una volta sola', async (t) => {
    const { talk, base } = await conServer(t);
    const tizio = await accesso(talk, base, 'Tizio');
    const { codice } = await (
      await tizio.chiama('/api/auth/dispositivo/codice', { method: 'POST' })
    ).json();

    assert.equal((await riscatta(base, codice)).status, 200);
    assert.equal((await riscatta(base, codice)).status, 400);
  });

  it('chiederne uno nuovo spegne il precedente', async (t) => {
    const { talk, base } = await conServer(t);
    const tizio = await accesso(talk, base, 'Tizio');

    const primo = (await (await tizio.chiama('/api/auth/dispositivo/codice', { method: 'POST' })).json())
      .codice;
    const secondo = (await (await tizio.chiama('/api/auth/dispositivo/codice', { method: 'POST' })).json())
      .codice;
    assert.notEqual(primo, secondo);

    // Due codici vivi sono due chiavi, e la seconda esiste solo perche' ci si
    // e' dimenticati della prima.
    assert.equal((await riscatta(base, primo)).status, 400);
    assert.equal((await riscatta(base, secondo)).status, 200);
  });

  it('scaduto non apre piu\' niente', async (t) => {
    const { talk, base } = await conServer(t);
    const tizio = await accesso(talk, base, 'Tizio');

    // Si crea gia' scaduto passando dal database: aspettare due minuti in un
    // test vorrebbe dire una suite che dura due minuti.
    const { codice } = talk.db.creaAccoppiamento(tizio.utente.id, { validoSecondi: -1 });
    assert.equal((await riscatta(base, codice)).status, 400);
  });

  it('un codice inventato non entra', async (t) => {
    const { base } = await conServer(t);
    for (const finto of ['', 'ZZZZZZZZ', 'abc', '        ']) {
      const r = await riscatta(base, finto);
      assert.equal(r.status, 400, `"${finto}" non doveva entrare`);
    }
  });

  it('il codice non si chiede senza essere gia\' dentro', async (t) => {
    const { base } = await conServer(t);
    const r = await fetch(`${base}/api/auth/dispositivo/codice`, { method: 'POST' });
    assert.equal(r.status, 401);
  });

  it('scollegare la sessione nuova non tocca quella vecchia', async (t) => {
    const { talk, base } = await conServer(t);
    const tizio = await accesso(talk, base, 'Tizio');
    const { codice } = await (
      await tizio.chiama('/api/auth/dispositivo/codice', { method: 'POST' })
    ).json();
    const { token } = await (await riscatta(base, codice, 'telefono')).json();
    const telefono = conToken(base, token);

    const { sessioni } = await (await tizio.chiama('/api/auth/sessioni')).json();
    const quella = sessioni.find((s) => s.dispositivo === 'telefono');
    await tizio.chiama(`/api/auth/sessioni/${quella.id}/revoca`, { method: 'POST' });

    assert.equal((await telefono('/api/auth/io')).status, 401);
    assert.equal((await tizio.chiama('/api/auth/io')).status, 200);
  });
});
