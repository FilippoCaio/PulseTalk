// L'indirizzo di posta, e la strada per rientrare.
//
// Quello che questi test difendono non e' "il codice arriva": e' che questa
// strada non ne apra un'altra. Il recupero e' l'unico punto del server in cui
// si concede qualcosa a chi non porta credenziali, e i modi di sbagliarlo sono
// quattro — si lascia capire chi ha un account qui dentro, si accetta un
// indirizzo mai dimostrato, si permette di indovinare un codice corto a forza
// di tentativi, o si rimette la password lasciando dentro chi c'era gia'.
//
// Il codice si legge dal messaggio davvero spedito, non dal database: pescarlo
// dalla tabella proverebbe soltanto che la tabella contiene cio' che ci
// abbiamo messo.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';
import { creaSmtpFinto } from './smtp-finto.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';
const NUOVA = 'un-altra-password-lunga';

async function conServer(t, { conPosta = true } = {}) {
  const smtp = creaSmtpFinto();
  const portaSmtp = await smtp.ascolta();
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-email-'));

  const env = {
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
    SFU_API_URL: 'http://127.0.0.1:1',
    TALK_LOG_LEVEL: 'silent',
    ...(conPosta
      ? {
          TALK_SMTP_HOST: '127.0.0.1',
          TALK_SMTP_PORTA: String(portaSmtp),
          TALK_SMTP_MITTENTE: 'PulseTalk <talk@esempio.it>',
        }
      : {}),
  };

  const talk = await creaTalk(leggiConfig(env), { ambiente: env });
  const porta = await ascoltaSuPortaBuona(talk.app);
  const base = `http://127.0.0.1:${porta}`;

  t.after(async () => {
    await talk.app.close();
    talk.db.close();
    await smtp.chiudi();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
  });

  return { talk, base, smtp };
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

async function accesso(talk, base, { nome, ruolo = 'membro' }) {
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

/** Collega e conferma un indirizzo, che e' il punto di partenza di quasi tutto. */
async function conIndirizzo(talk, base, smtp, persona, indirizzo) {
  const r = await persona.chiama('/api/io/email', {
    method: 'POST',
    body: JSON.stringify({ indirizzo, password: PASSWORD }),
  });
  assert.equal(r.status, 200, 'la scrittura dell\'indirizzo doveva riuscire');
  const codice = smtp.codice();
  assert.ok(codice, 'nessun codice nel messaggio spedito');

  const c = await persona.chiama('/api/io/email/conferma', {
    method: 'POST',
    body: JSON.stringify({ codice }),
  });
  assert.equal(c.status, 200, 'la conferma doveva riuscire');
  return codice;
}

describe('l\'indirizzo di posta', () => {
  it('non si scrive senza la password attuale', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });

    const r = await tizio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'tizio@esempio.it', password: 'sbagliata-e-lunga' }),
    });

    // Cambiare l'indirizzo vale quanto cambiare la password: e' la strada per
    // rientrare. Una sessione lasciata aperta non deve poterla dirottare.
    assert.equal(r.status, 403);
    assert.equal(smtp.messaggi.length, 0, 'non doveva partire niente');
    assert.equal(talk.db.utente(tizio.utente.id).email, null);
  });

  it('arriva un codice, e conferma solo quello giusto', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });

    await tizio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'Tizio@Esempio.IT', password: PASSWORD }),
    });

    const messaggio = smtp.ultimo();
    assert.equal(messaggio.a, 'tizio@esempio.it', 'l\'indirizzo si normalizza in minuscolo');
    assert.ok(messaggio.testo.includes('Tizio'), 'il messaggio saluta per nome');

    const sbagliato = await tizio.chiama('/api/io/email/conferma', {
      method: 'POST',
      body: JSON.stringify({ codice: 'ZZZZZZ' }),
    });
    assert.equal(sbagliato.status, 400);
    assert.equal(Boolean(talk.db.utente(tizio.utente.id).emailConfermata), false);

    const giusto = await tizio.chiama('/api/io/email/conferma', {
      method: 'POST',
      body: JSON.stringify({ codice: smtp.codice() }),
    });
    assert.equal(giusto.status, 200);
    assert.equal(Boolean(talk.db.utente(tizio.utente.id).emailConfermata), true);
  });

  it('riscriverlo lo rimette da confermare', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');

    await tizio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'altro@esempio.it', password: PASSWORD }),
    });

    // Un indirizzo nuovo non eredita la fiducia di quello vecchio.
    const riga = talk.db.utente(tizio.utente.id);
    assert.equal(riga.email, 'altro@esempio.it');
    assert.equal(Boolean(riga.emailConfermata), false);
  });

  it('due account non possono confermare la stessa casella', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    const caio = await accesso(talk, base, { nome: 'Caio' });
    await conIndirizzo(talk, base, smtp, tizio, 'condivisa@esempio.it');

    const r = await caio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'condivisa@esempio.it', password: PASSWORD }),
    });

    // Altrimenti chi apre quella casella rientra in due account, e il recupero
    // non sa piu' di quale sta parlando.
    assert.equal(r.status, 409);
  });

  it('senza posta configurata non si offre niente', async (t) => {
    const { talk, base } = await conServer(t, { conPosta: false });
    const tizio = await accesso(talk, base, { nome: 'Tizio' });

    const stato = await (await tizio.chiama('/api/io/email')).json();
    assert.equal(stato.possibile, false);

    const r = await tizio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'tizio@esempio.it', password: PASSWORD }),
    });
    assert.equal(r.status, 501);
  });
});

describe('rientrare con un codice', () => {
  const chiedi = (base, indirizzo) =>
    fetch(`${base}/api/auth/recupero`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ indirizzo }),
    });

  const riscatta = (base, corpo) =>
    fetch(`${base}/api/auth/recupero/riscatta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });

  it('risponde uguale che l\'indirizzo esista o no', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    const esiste = await chiedi(base, 'tizio@esempio.it');
    const inventato = await chiedi(base, 'nessuno@esempio.it');

    // Stessa risposta, stesso corpo. Una differenza qui trasformerebbe questa
    // rotta in un elenco di chi frequenta il server.
    assert.equal(esiste.status, inventato.status);
    assert.deepEqual(await esiste.json(), await inventato.json());
    // Ma il messaggio parte per uno solo dei due.
    assert.equal(smtp.messaggi.length, 1);
    assert.equal(smtp.ultimo().a, 'tizio@esempio.it');
  });

  it('un indirizzo scritto ma mai confermato non apre niente', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await tizio.chiama('/api/io/email', {
      method: 'POST',
      body: JSON.stringify({ indirizzo: 'tizio@esempio.it', password: PASSWORD }),
    });
    smtp.svuota();

    const r = await chiedi(base, 'tizio@esempio.it');
    assert.equal(r.status, 200, 'la risposta resta quella generica');
    // Ma non parte niente: senza la conferma quell'indirizzo non e' suo.
    assert.equal(smtp.messaggi.length, 0);
  });

  it('rimette la password e butta fuori tutte le sessioni', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    // Una seconda sessione, come chi e' entrato da un altro computer.
    const seconda = await accesso(talk, base, { nome: 'Tizio2' });
    assert.equal((await tizio.chiama('/api/auth/io')).status, 200);

    await chiedi(base, 'tizio@esempio.it');
    const esito = await riscatta(base, {
      indirizzo: 'tizio@esempio.it',
      codice: smtp.codice(),
      password: NUOVA,
    });
    assert.equal(esito.status, 200);

    // Chi era dentro con quell'account adesso e' fuori: e' il senso stesso di
    // rimettere una password.
    assert.equal((await tizio.chiama('/api/auth/io')).status, 401);
    // Le sessioni di un altro account non c'entrano niente.
    assert.equal((await seconda.chiama('/api/auth/io')).status, 200);

    // E la password nuova funziona davvero.
    const entra = await fetch(`${base}/api/auth/accedi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utente: 'tizio', password: NUOVA }),
    });
    assert.equal(entra.status, 200);
  });

  it('il codice vale una volta sola', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    await chiedi(base, 'tizio@esempio.it');
    const codice = smtp.codice();

    assert.equal((await riscatta(base, { indirizzo: 'tizio@esempio.it', codice, password: NUOVA })).status, 200);
    const seconda = await riscatta(base, {
      indirizzo: 'tizio@esempio.it',
      codice,
      password: 'terza-password-lunga',
    });
    assert.equal(seconda.status, 400);
  });

  it('chiederne uno nuovo spegne il precedente', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    await chiedi(base, 'tizio@esempio.it');
    const vecchio = smtp.codice();
    await chiedi(base, 'tizio@esempio.it');
    const nuovo = smtp.codice();
    assert.notEqual(vecchio, nuovo);

    // Cinque codici in giro perche' il primo tardava sono cinque chiavi.
    const r = await riscatta(base, { indirizzo: 'tizio@esempio.it', codice: vecchio, password: NUOVA });
    assert.equal(r.status, 400);
  });

  it('dopo cinque tentativi il codice smette di valere', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    await chiedi(base, 'tizio@esempio.it');
    const buono = smtp.codice();

    // Sei caratteri si finirebbero di provare in un pomeriggio: e' il tetto
    // sui tentativi, non la lunghezza, a rendere la cosa impraticabile.
    for (let i = 0; i < 5; i++) {
      const r = await riscatta(base, { indirizzo: 'tizio@esempio.it', codice: 'ZZZZZZ', password: NUOVA });
      assert.equal(r.status, 400);
    }

    const dopo = await riscatta(base, { indirizzo: 'tizio@esempio.it', codice: buono, password: NUOVA });
    assert.equal(dopo.status, 400, 'nemmeno quello giusto, dopo cinque errori');
    assert.match((await dopo.json()).errore, /tentativi/);
  });

  it('una password troppo corta non brucia il codice', async (t) => {
    const { talk, base, smtp } = await conServer(t);
    const tizio = await accesso(talk, base, { nome: 'Tizio' });
    await conIndirizzo(talk, base, smtp, tizio, 'tizio@esempio.it');
    smtp.svuota();

    await chiedi(base, 'tizio@esempio.it');
    const codice = smtp.codice();

    const corta = await riscatta(base, { indirizzo: 'tizio@esempio.it', codice, password: 'breve' });
    assert.equal(corta.status, 400);

    // Il codice deve essere ancora buono: sbagliare la password nuova non e'
    // sbagliare il codice, e costringere a un secondo viaggio in casella per
    // questo sarebbe una punizione per un errore di battitura.
    const poi = await riscatta(base, { indirizzo: 'tizio@esempio.it', codice, password: NUOVA });
    assert.equal(poi.status, 200);
  });

  it('senza posta configurata il recupero si dichiara spento', async (t) => {
    const { base } = await conServer(t, { conPosta: false });
    const r = await chiedi(base, 'chiunque@esempio.it');
    assert.equal(r.status, 501);
  });
});
