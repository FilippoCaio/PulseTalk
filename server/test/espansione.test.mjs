// I pezzi aggiunti dopo: ruoli, permessi, override, inviti allo spazio,
// eventi, messaggi diretti, chiamate dirette e sessioni condivise.
//
// Stanno in un file loro e non in talk.test.mjs per una ragione pratica:
// quello e' gia' lungo, e le cose che si provano qui hanno tutte lo stesso
// impianto — uno spazio, due persone, e la domanda "chi puo' fare cosa".
//
// Il filo conduttore e' uno solo: **il permesso lo verifica il server**. Ogni
// volta che qui c'e' un 403, e' un pulsante che l'interfaccia nasconde e che
// resterebbe comunque premibile da chiunque sappia scrivere una fetch.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import { spazzaCanaliTemporanei } from '../src/canali-temporanei.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';
import { posizioneAttesa } from '../src/dati/media.mjs';
import { risolvi } from '../src/permessi/risoluzione.mjs';
import { PERMESSI } from '../src/permessi/catalogo.mjs';
import { lookupFissato } from '../src/provider/anteprime-link.mjs';
import { creaProviderAi, ripuliscJson } from '../src/provider/ai.mjs';
import { scegliDialetto } from '../src/provider/ai-dialetti.mjs';
import {
  creaGeneratoreImmagini,
  elencoGeneratori,
  PERCHANCE,
} from '../src/provider/generazione-immagini.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';

async function conServer(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-'));
  const config = leggiConfig({
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
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
    talk.chiamate.spegni();
    await talk.app.close();
    talk.db.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
  });

  return { talk, base, config };
}

async function accesso(talk, base, { nome, ruolo }) {
  const codice = talk.db.creaInvito({ nome, ruolo });
  const nomeUtente = nome.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = await fetch(`${base}/api/auth/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codice, utente: nomeUtente, password: PASSWORD, nome }),
  });
  assert.equal(r.status, 200, `riscatto fallito per ${nome}`);
  const corpo = await r.json();

  const chiama = (percorso, opzioni = {}) =>
    fetch(`${base}${percorso}`, {
      ...opzioni,
      headers: {
        authorization: `Bearer ${corpo.token}`,
        ...(opzioni.body ? { 'content-type': 'application/json' } : {}),
        ...opzioni.headers,
      },
    });

  return { ...corpo, chiama };
}

const corpoDi = async (risposta) => risposta.json();

/** Uno spazio con dentro un canale di testo e uno vocale, e il suo elenco. */
async function conSpazio(chiama, dati = { nome: 'Casa' }) {
  const richiesta = {
    ...dati,
    impostazioni: { apertoATutti: true, ...(dati.impostazioni ?? {}) },
  };
  const r = await chiama('/api/spazi', { method: 'POST', body: JSON.stringify(richiesta) });
  assert.equal(r.status, 201, 'creazione dello spazio fallita');
  const { spazio } = await r.json();

  const { spazi } = await corpoDi(await chiama('/api/spazi'));
  const mio = spazi.find((s) => s.id === spazio.id);
  return {
    spazio: mio,
    testo: mio.canali.find((c) => c.tipo === 'testo'),
    voce: mio.canali.find((c) => c.tipo === 'voce'),
  };
}

describe('privacy, proprieta\' e canali temporanei', () => {
  it('uno spazio nuovo nasce privato e non viene annunciato agli altri account', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo privato', ruolo: 'admin' });
    const altro = await accesso(talk, base, { nome: 'Altro privato', ruolo: 'membro' });

    const creato = await capo.chiama('/api/spazi', {
      method: 'POST',
      body: JSON.stringify({ nome: 'Porte chiuse' }),
    });
    assert.equal(creato.status, 201);
    const { spazio } = await creato.json();
    assert.equal(talk.db.impostazioniSpazio(spazio).apertoATutti, false);

    const suoi = await corpoDi(await altro.chiama('/api/spazi'));
    assert.ok(!suoi.spazi.some((s) => s.id === spazio.id));
    assert.equal((await altro.chiama(`/api/spazi/${spazio.id}/membri`)).status, 404);
  });

  it('passa la proprieta\' soltanto a un membro che sia un amico confermato', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo passaggio', ruolo: 'admin' });
    const amico = await accesso(talk, base, { nome: 'Amico passaggio', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const passa = () =>
      capo.chiama(`/api/spazi/${spazio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ proprietario: amico.utente.id }),
      });

    assert.equal((await passa()).status, 400, 'un semplice membro non basta');
    assert.equal(
      (await capo.chiama('/api/amici', {
        method: 'POST',
        body: JSON.stringify({ utente: amico.utente.id }),
      })).status,
      201,
    );
    assert.equal((await passa()).status, 400, 'una richiesta pendente non basta');
    assert.equal(
      (await amico.chiama(`/api/amici/${capo.utente.id}/accetta`, { method: 'POST' })).status,
      200,
    );

    const membri = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/membri`));
    assert.equal(membri.membri.find((m) => m.id === amico.utente.id).amico, true);
    assert.equal((await passa()).status, 200);
    assert.equal(talk.db.spazio(spazio.id).proprietario, amico.utente.id);
    assert.ok(talk.db.ruoli.diUtente(spazio.id, amico.utente.id).some((r) => r.tipo === 'admin'));
    assert.equal((await capo.chiama(`/api/spazi/${spazio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ proprietario: capo.utente.id }),
    })).status, 403, 'il vecchio proprietario non puo\' riprenderselo');
  });

  it('ricontrolla amicizia e appartenenza al momento esatto del trasferimento', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo controllo', ruolo: 'admin' });
    const candidato = await accesso(talk, base, { nome: 'Candidato controllo', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    await capo.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ utente: candidato.utente.id }),
    });
    await candidato.chiama(`/api/amici/${capo.utente.id}/accetta`, { method: 'POST' });
    await capo.chiama(`/api/amici/${candidato.utente.id}`, { method: 'DELETE' });

    const senzaAmicizia = await capo.chiama(`/api/spazi/${spazio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ proprietario: candidato.utente.id }),
    });
    assert.equal(senzaAmicizia.status, 400);

    await capo.chiama('/api/amici', {
      method: 'POST',
      body: JSON.stringify({ utente: candidato.utente.id }),
    });
    await candidato.chiama(`/api/amici/${capo.utente.id}/accetta`, { method: 'POST' });
    talk.db.togliMembro(spazio.id, candidato.utente.id);
    const senzaSpazio = await capo.chiama(`/api/spazi/${spazio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ proprietario: candidato.utente.id }),
    });
    assert.equal(senzaSpazio.status, 404);
  });

  it('valida, persiste e rimuove i canali temporanei anche fuori dal timer', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo temporaneo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama);

    const troppo = await capo.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Troppo lungo', tipo: 'testo', durataMinuti: 2881 }),
    });
    assert.equal(troppo.status, 400);

    const risposta = await capo.chiama(`/api/spazi/${spazio.id}/canali`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Riunione breve', tipo: 'testo', durataMinuti: 30 }),
    });
    assert.equal(risposta.status, 201);
    const { canale } = await risposta.json();
    assert.equal(canale.creatoDa, capo.utente.id);
    assert.ok(canale.scade > canale.creato);

    const elenco = await corpoDi(await capo.chiama('/api/spazi'));
    const visibile = elenco.spazi.find((s) => s.id === spazio.id).canali.find((c) => c.id === canale.id);
    assert.ok(visibile.restanoMs > 0 && visibile.restanoMs <= 30 * 60_000);

    talk.db.sql.prepare('UPDATE canali SET scade = ? WHERE id = ?').run(1, canale.id);
    assert.equal(talk.db.canale(canale.id), null, 'scaduto non e\' piu\' accessibile prima della spazzata');
    assert.equal(await spazzaCanaliTemporanei(talk), 1);
    assert.equal(talk.db.sql.prepare('SELECT 1 FROM canali WHERE id = ?').get(canale.id), undefined);
  });
});

describe('servizi esterni protetti dal server', () => {
  it('dichiara le capacita\' e non finge una ricerca GIF senza provider', async (t) => {
    const { talk, base } = await conServer(t);
    const persona = await accesso(talk, base, { nome: 'Ada', ruolo: 'membro' });

    const servizi = await corpoDi(await persona.chiama('/api/servizi'));
    assert.deepEqual(servizi.gif, { disponibile: false, provider: null, etichetta: null });
    assert.equal(servizi.anteprimeLink.disponibile, true);

    const ricerca = await persona.chiama('/api/gif/cerca?q=gatto');
    assert.equal(ricerca.status, 501);
    assert.match((await corpoDi(ricerca)).errore, /non e' configurata/i);
  });

  it('blocca loopback e porte arbitrarie prima di scaricare una anteprima', async (t) => {
    const { talk, base } = await conServer(t);
    const persona = await accesso(talk, base, { nome: 'Ada', ruolo: 'membro' });

    const loopback = await persona.chiama('/api/anteprime-link', {
      method: 'POST',
      body: JSON.stringify({ url: 'http://127.0.0.1/' }),
    });
    assert.equal(loopback.status, 422);

    const porta = await persona.chiama('/api/anteprime-link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com:444/segreto' }),
    });
    assert.equal(porta.status, 422);
  });
});

describe('AI opzionale e identita\' bot', () => {
  it('dichiara le capability AI assenti e non crea messaggi o bot fittizi', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const casa = await conSpazio(admin.chiama, { nome: 'Casa AI' });

    const servizi = await corpoDi(await admin.chiama('/api/servizi'));
    assert.equal(servizi.ai.provider, null);
    assert.equal(servizi.ai.chat, false);
    assert.equal(servizi.ai.immagini, false);

    const risposta = await admin.chiama(`/api/canali/${casa.testo.id}/ai/chat`, {
      method: 'POST', body: JSON.stringify({ prompt: 'Ciao' }),
    });
    assert.equal(risposta.status, 501);
    assert.equal(talk.db.sql.prepare("SELECT COUNT(*) AS n FROM utenti WHERE tipo = 'bot'").get().n, 0);
  });

  it('un bot interno non ha login, privilegi impliciti, amicizie o accesso ad altri spazi', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const primo = await conSpazio(admin.chiama, { nome: 'Primo' });
    const secondo = await conSpazio(admin.chiama, { nome: 'Secondo' });
    const bot = talk.db.botInterno(primo.spazio.id, admin.utente.id);

    assert.equal(bot.tipo, 'bot');
    assert.equal(bot.utente, null);
    assert.equal(bot.password, null);
    assert.equal(talk.db.sql.prepare('SELECT COUNT(*) AS n FROM token WHERE utente = ?').get(bot.id).n, 0);
    assert.equal(talk.db.ruoloNelloSpazio(primo.spazio.id, bot), 'membro');
    assert.equal(talk.db.permessiIn(bot, { spazio: talk.db.spazio(primo.spazio.id) }).has('manageServer'), false);
    assert.equal(talk.db.ruoloNelloSpazio(secondo.spazio.id, bot), null);

    const amicizia = await admin.chiama('/api/amici', {
      method: 'POST', body: JSON.stringify({ utente: bot.id }),
    });
    assert.equal(amicizia.status, 400);

    const umano = await admin.chiama(`/api/canali/${primo.testo.id}/messaggi`, {
      method: 'POST', body: JSON.stringify({ testo: 'sono umano', autore: bot.id }),
    });
    assert.equal((await corpoDi(umano)).messaggio.autore, admin.utente.id);

    const revocaAltrui = await admin.chiama(`/api/spazi/${secondo.spazio.id}/bot/${bot.id}`, { method: 'DELETE' });
    assert.equal(revocaAltrui.status, 404);
    const revoca = await admin.chiama(`/api/spazi/${primo.spazio.id}/bot/${bot.id}`, { method: 'DELETE' });
    assert.equal(revoca.status, 200);
    assert.equal(talk.db.ruoloNelloSpazio(primo.spazio.id, bot), null);
  });
});

describe('Auto Writer consensuale', () => {
  it('non parte senza provider STT e non crea una sessione vuota', async (t) => {
    const { talk, base } = await conServer(t);
    const admin = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const casa = await conSpazio(admin.chiama, { nome: 'Riunione' });
    const r = await admin.chiama(`/api/canali/${casa.voce.id}/autowriter`, { method: 'POST' });
    assert.equal(r.status, 501);
    assert.equal(talk.db.sql.prepare('SELECT COUNT(*) AS n FROM trascrizioni').get().n, 0);
  });

  it('registra il consenso e non mostra la trascrizione a un membro non autorizzato', async (t) => {
    const { talk, base } = await conServer(t, {
      TALK_AI_API_KEY: 'chiave-finta-solo-per-capability',
      TALK_AI_STT_MODEL: 'stt-di-prova',
      TALK_AI_CHAT_MODEL: 'chat-di-prova',
    });
    const admin = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const altro = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const casa = await conSpazio(admin.chiama, { nome: 'Riunione' });
    talk.presenze.leggi = async () => new Map([
      [talk.db.chiaveSfu(talk.db.canale(casa.voce.id)), [{ identita: `u${admin.utente.id}` }]],
    ]);

    const avvio = await admin.chiama(`/api/canali/${casa.voce.id}/autowriter`, { method: 'POST' });
    assert.equal(avvio.status, 201);
    const sessione = (await corpoDi(avvio)).sessione;
    assert.equal(sessione.stato, 'attiva');
    assert.equal(sessione.consensi[0].consenso, true);

    talk.db.sql.prepare(
      'INSERT INTO segmenti_trascrizione (trascrizione, parlante, testo, definitivo, creato) VALUES (?, ?, ?, 1, ?)',
    ).run(sessione.id, admin.utente.id, 'dato riservato', Date.now());
    const vista = await corpoDi(await altro.chiama(`/api/canali/${casa.voce.id}/autowriter`));
    assert.deepEqual(vista.sessione.segmenti, []);
    const riassunto = await altro.chiama(`/api/canali/${casa.voce.id}/autowriter/riassunto`, { method: 'POST' });
    assert.equal(riassunto.status, 404);
  });
});

// -----------------------------------------------------------------------------

describe('risoluzione dei permessi', () => {
  it('somma i ruoli, e l\'admin li ha tutti per costruzione', () => {
    const sommati = risolvi({
      utente: 1,
      ruoli: [
        { id: 1, tipo: 'custom', priorita: 10, permessi: ['sendMessages'] },
        { id: 2, tipo: 'base', priorita: 0, permessi: ['viewChannel'] },
      ],
    });
    assert.deepEqual([...sommati].sort(), ['sendMessages', 'viewChannel']);

    const tutto = risolvi({ utente: 1, ruoli: [{ id: 1, tipo: 'admin', priorita: 100 }] });
    assert.equal(tutto.size, PERMESSI.length);
  });

  it('applica gli override dal piu\' debole al piu\' forte, e la persona vince su tutti', () => {
    const ruoli = [
      { id: 9, tipo: 'custom', priorita: 50, permessi: ['sendMessages', 'viewChannel'] },
      { id: 3, tipo: 'base', priorita: 0, permessi: ['sendMessages', 'viewChannel'] },
    ];

    // La base nega, il ruolo alto restituisce: vince il ruolo alto.
    const restituito = risolvi({
      utente: 7,
      ruoli,
      overrideCanale: [
        { tipo: 'ruolo', soggetto: 3, consenti: [], nega: ['sendMessages'] },
        { tipo: 'ruolo', soggetto: 9, consenti: ['sendMessages'], nega: [] },
      ],
    });
    assert.ok(restituito.has('sendMessages'));

    // Un override sulla persona batte anche il ruolo alto.
    const zittito = risolvi({
      utente: 7,
      ruoli,
      overrideCanale: [
        { tipo: 'ruolo', soggetto: 9, consenti: ['sendMessages'], nega: [] },
        { tipo: 'utente', soggetto: 7, consenti: [], nega: ['sendMessages'] },
      ],
    });
    assert.ok(!zittito.has('sendMessages'));
  });

  it('la categoria decide prima del canale', () => {
    const ruoli = [{ id: 3, tipo: 'base', priorita: 0, permessi: ['viewChannel'] }];
    const nascosto = risolvi({
      utente: 7,
      ruoli,
      overrideCategoria: [{ tipo: 'ruolo', soggetto: 3, consenti: [], nega: ['viewChannel'] }],
    });
    assert.ok(!nascosto.has('viewChannel'));

    const eccezione = risolvi({
      utente: 7,
      ruoli,
      overrideCategoria: [{ tipo: 'ruolo', soggetto: 3, consenti: [], nega: ['viewChannel'] }],
      overrideCanale: [{ tipo: 'ruolo', soggetto: 3, consenti: ['viewChannel'], nega: [] }],
    });
    assert.ok(eccezione.has('viewChannel'), 'il canale puo\' riaprire cio\' che la categoria chiude');
  });

  it('il proprietario non lo ferma nessun override', () => {
    const suo = risolvi({
      utente: 1,
      proprietario: true,
      ruoli: [{ id: 3, tipo: 'base', priorita: 0, permessi: [] }],
      overrideCanale: [{ tipo: 'utente', soggetto: 1, consenti: [], nega: ['viewChannel'] }],
    });
    assert.equal(suo.size, PERMESSI.length);
  });
});

describe('ruoli di uno spazio', () => {
  it('nasce con Admin, Master e il ruolo base, e chi crea e\' proprietario', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    assert.deepEqual(
      ruoli.map((r) => r.tipo).sort(),
      ['admin', 'base', 'master'],
    );
    assert.equal(spazio.proprietario, capo.utente.id);
    assert.equal(spazio.permessiMiei.length, PERMESSI.length);
  });

  it('un membro semplice ha il pavimento, e non puo\' toccare i ruoli', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const { spazi } = await corpoDi(await marco.chiama('/api/spazi'));
    const suo = spazi.find((s) => s.id === spazio.id);
    assert.ok(suo.permessiMiei.includes('sendMessages'));
    assert.ok(!suo.permessiMiei.includes('manageServer'));

    const r = await marco.chiama(`/api/spazi/${spazio.id}/ruoli`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Capi', permessi: ['manageServer'] }),
    });
    assert.equal(r.status, 403);
  });

  it('non lascia regalare permessi che non si hanno', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    // A Marco si da' solo manageRoles: puo' creare ruoli, ma non uno che
    // conceda l'amministrazione dello spazio — sarebbe la scala per prendersi
    // tutto partendo da un permesso solo.
    const { ruolo } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/ruoli`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Gestore', permessi: ['manageRoles'], priorita: 50 }),
      }),
    );
    await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${ruolo.id}/membri`, {
      method: 'POST',
      body: JSON.stringify({ utente: marco.utente.id }),
    });

    const troppo = await marco.chiama(`/api/spazi/${spazio.id}/ruoli`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Padroni', permessi: ['manageServer'] }),
    });
    assert.equal(troppo.status, 403);
    assert.match((await troppo.json()).errore, /non puoi dare permessi che non hai/);

    const giusto = await marco.chiama(`/api/spazi/${spazio.id}/ruoli`, {
      method: 'POST',
      body: JSON.stringify({ nome: 'Aiutanti', permessi: ['manageRoles'] }),
    });
    assert.equal(giusto.status, 201);
  });

  it('i ruoli predefiniti non si cancellano, e l\'Admin non si modifica', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama);
    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const admin = ruoli.find((r) => r.tipo === 'admin');

    assert.equal(
      (await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${admin.id}`, { method: 'DELETE' })).status,
      400,
    );
    assert.equal(
      (
        await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${admin.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ permessi: [] }),
        })
      ).status,
      400,
    );
  });
});

describe('permessi per canale', () => {
  it('un canale negato al ruolo base sparisce dall\'elenco e dalla ricerca', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo } = await conSpazio(capo.chiama);

    await capo.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'parola-segreta' }),
    });

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');

    const messo = await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${testo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['viewChannel'] }),
    });
    assert.equal(messo.status, 200);

    const { spazi } = await corpoDi(await marco.chiama('/api/spazi'));
    const suo = spazi.find((s) => s.id === spazio.id);
    assert.ok(!suo.canali.some((c) => c.id === testo.id), 'il canale non deve comparire');

    // 404 e non 403: un "non puoi" direbbe comunque che quel canale esiste.
    assert.equal((await marco.chiama(`/api/canali/${testo.id}/messaggi`)).status, 404);

    const { risultati } = await corpoDi(
      await marco.chiama(`/api/spazi/${spazio.id}/cerca?q=parola-segreta`),
    );
    assert.equal(risultati.length, 0, 'la ricerca non deve essere la porta di servizio');

    // Nemmeno il flusso realtime deve diventare una porta laterale: gli
    // eventi portano il messaggio e lo stato media completi, quindi non basta
    // che il canale sia sparito dalla risposta di /api/spazi.
    const ricevuti = [];
    const disiscrivi = talk.eventi.iscrivi(marco.utente.id, (corpo) => ricevuti.push(JSON.parse(corpo)));
    t.after(disiscrivi);

    await capo.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'ancora-piu-segreta' }),
    });
    await capo.chiama(`/api/canali/${testo.id}/media`, {
      method: 'POST',
      body: JSON.stringify({ tipo: 'youtube' }),
    });
    assert.ok(!ricevuti.some((evento) => evento.canale === testo.id));
  });

  it('si puo\' leggere senza poter scrivere', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');
    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${testo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['sendMessages'] }),
    });

    assert.equal((await marco.chiama(`/api/canali/${testo.id}/messaggi`)).status, 200);
    const scritto = await marco.chiama(`/api/canali/${testo.id}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'ciao' }),
    });
    assert.equal(scritto.status, 403);

    // Un'eccezione sulla persona lo rimette in condizione di scrivere.
    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${testo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'utente', soggetto: marco.utente.id, consenti: ['sendMessages'] }),
    });
    assert.equal(
      (
        await marco.chiama(`/api/canali/${testo.id}/messaggi`, {
          method: 'POST',
          body: JSON.stringify({ testo: 'ciao' }),
        })
      ).status,
      201,
    );
  });

  it('senza connect non si entra nel vocale, senza speak si entra muti', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');

    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${voce.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['speak'] }),
    });
    const muto = await corpoDi(await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }));
    assert.equal(muto.permessi.puoTrasmettere, false);
    assert.equal(muto.permessi.puoAscoltare, true);

    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${voce.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['speak', 'connect'] }),
    });
    assert.equal(
      (await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' })).status,
      403,
    );
  });

  it('gli override se ne vanno insieme al canale che li portava', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio, testo } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');
    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${testo.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['sendMessages'] }),
    });

    await capo.chiama(`/api/canali/${testo.id}`, { method: 'DELETE' });
    assert.equal(talk.db.ruoli.overrideDi('canale', testo.id).length, 0);
  });
});

describe('categorie', () => {
  it('si creano, si rinominano, si riordinano', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama);

    const uno = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/categorie`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Prima' }),
      }),
    );
    const due = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/categorie`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Seconda' }),
      }),
    );

    const rinominata = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/categorie/${uno.categoria.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nome: 'Rinominata' }),
      }),
    );
    assert.equal(rinominata.categoria.nome, 'Rinominata');

    await capo.chiama(`/api/spazi/${spazio.id}/ordine`, {
      method: 'POST',
      body: JSON.stringify({ categorie: [due.categoria.id, uno.categoria.id] }),
    });

    const { spazi } = await corpoDi(await capo.chiama('/api/spazi'));
    const ordinate = spazi
      .find((s) => s.id === spazio.id)
      .categorie.sort((a, b) => a.posizione - b.posizione)
      .map((c) => c.nome);
    assert.deepEqual(ordinate, ['Seconda', 'Rinominata']);
  });

  it('un membro senza permessi non le tocca', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    assert.equal(
      (
        await marco.chiama(`/api/spazi/${spazio.id}/categorie`, {
          method: 'POST',
          body: JSON.stringify({ nome: 'Mia' }),
        })
      ).status,
      403,
    );
  });
});

describe('impostazioni, membri e bandi', () => {
  it('cambia nome, descrizione e regole solo con il permesso', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const cambiato = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ descrizione: 'la casa', regole: 'niente urla', icona: '🏠' }),
      }),
    );
    assert.equal(cambiato.spazio.descrizione, 'la casa');
    assert.equal(cambiato.spazio.icona, '🏠');

    assert.equal(
      (
        await marco.chiama(`/api/spazi/${spazio.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ nome: 'Mia' }),
        })
      ).status,
      403,
    );
  });

  it('si abbandona uno spazio, ma non se se ne e\' proprietari', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/membri/io`, { method: 'DELETE' })).status,
      200,
    );
    assert.equal((await corpoDi(await marco.chiama('/api/spazi'))).spazi.length, 0);

    const suo = await capo.chiama(`/api/spazi/${spazio.id}/membri/io`, { method: 'DELETE' });
    assert.equal(suo.status, 400);
    assert.match((await suo.json()).errore, /proprietario/);
  });

  it('bandisce, e chi e\' bandito non rientra con un invito', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const bandito = await capo.chiama(`/api/spazi/${spazio.id}/bandi`, {
      method: 'POST',
      body: JSON.stringify({ utente: marco.utente.id, motivo: 'urla' }),
    });
    assert.equal(bandito.status, 201);
    assert.equal((await corpoDi(await marco.chiama('/api/spazi'))).spazi.length, 0);

    const { codice } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/inviti`, { method: 'POST', body: JSON.stringify({}) }),
    );
    const rientro = await marco.chiama(`/api/inviti-spazio/${codice}/entra`, { method: 'POST' });
    assert.equal(rientro.status, 403);

    await capo.chiama(`/api/spazi/${spazio.id}/bandi/${marco.utente.id}`, { method: 'DELETE' });
    assert.equal(
      (await marco.chiama(`/api/inviti-spazio/${codice}/entra`, { method: 'POST' })).status,
      201,
    );
  });

  it('il proprietario non si caccia, e nemmeno chi sta al tuo livello', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lucia = await accesso(talk, base, { nome: 'Lucia', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const { ruolo } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/ruoli`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'Buttafuori', permessi: ['kickMembers'], priorita: 30 }),
      }),
    );
    for (const chi of [marco, lucia]) {
      await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${ruolo.id}/membri`, {
        method: 'POST',
        body: JSON.stringify({ utente: chi.utente.id }),
      });
    }

    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/membri/${capo.utente.id}`, { method: 'DELETE' }))
        .status,
      403,
      'il proprietario non si tocca',
    );
    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/membri/${lucia.utente.id}`, { method: 'DELETE' }))
        .status,
      403,
      'chi sta al tuo livello non si tocca',
    );
  });
});

describe('inviti a uno spazio', () => {
  it('li fa anche un membro, se lo spazio lo consente', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const suo = await marco.chiama(`/api/spazi/${spazio.id}/inviti`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(suo.status, 201);
    assert.ok((await suo.json()).codice.length > 20);

    // Chiudendo gli inviti dei membri, resta solo chi amministra.
    await capo.chiama(`/api/spazi/${spazio.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ impostazioni: { invitiAperti: false } }),
    });
    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/inviti`, { method: 'POST', body: JSON.stringify({}) }))
        .status,
      403,
    );
  });

  it('senza createInvites non se ne fanno', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');
    await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${baseRuolo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ permessi: baseRuolo.permessi.filter((p) => p !== 'createInvites') }),
    });

    assert.equal(
      (await marco.chiama(`/api/spazi/${spazio.id}/inviti`, { method: 'POST', body: JSON.stringify({}) }))
        .status,
      403,
    );
  });

  it('un codice a uso singolo fa entrare una persona sola', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama, { nome: 'Chiuso', impostazioni: { apertoATutti: false } });

    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lucia = await accesso(talk, base, { nome: 'Lucia', ruolo: 'membro' });
    assert.equal((await corpoDi(await marco.chiama('/api/spazi'))).spazi.length, 0, 'a porte chiuse non si entra da soli');

    const { codice } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/inviti`, {
        method: 'POST',
        body: JSON.stringify({ usi: 1 }),
      }),
    );

    assert.equal((await marco.chiama(`/api/inviti-spazio/${codice}/entra`, { method: 'POST' })).status, 201);
    assert.equal((await lucia.chiama(`/api/inviti-spazio/${codice}/entra`, { method: 'POST' })).status, 403);
    assert.equal((await corpoDi(await marco.chiama('/api/spazi'))).spazi.length, 1);
  });
});

describe('eventi', () => {
  it('li crea chi ha il permesso, e gli altri dicono se ci sono', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);

    const negato = await marco.chiama(`/api/spazi/${spazio.id}/eventi`, {
      method: 'POST',
      body: JSON.stringify({ titolo: 'Serata', inizio: Math.floor(Date.now() / 1000) + 3600 }),
    });
    assert.equal(negato.status, 403, 'createEvents non e\' nel ruolo base');

    const { evento } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/eventi`, {
        method: 'POST',
        body: JSON.stringify({
          titolo: 'Serata',
          descrizione: 'si gioca',
          inizio: Math.floor(Date.now() / 1000) + 3600,
          canale: voce.id,
        }),
      }),
    );
    assert.equal(evento.titolo, 'Serata');
    assert.equal(evento.partecipanti.length, 1, 'chi organizza c\'e\' per definizione');

    const { partecipanti } = await corpoDi(
      await marco.chiama(`/api/spazi/${spazio.id}/eventi/${evento.id}/partecipo`, {
        method: 'POST',
        body: JSON.stringify({ stato: 'partecipa' }),
      }),
    );
    assert.equal(partecipanti.length, 2);

    // Modificarlo e' cosa di chi lo gestisce.
    assert.equal(
      (
        await marco.chiama(`/api/spazi/${spazio.id}/eventi/${evento.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ titolo: 'Altro' }),
        })
      ).status,
      403,
    );
  });

  it('rifiuta una data che non e\' una data', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { spazio } = await conSpazio(capo.chiama);

    for (const inizio of ['domani', 0, Date.now() / 1000 + 10 * 365 * 86400]) {
      const r = await capo.chiama(`/api/spazi/${spazio.id}/eventi`, {
        method: 'POST',
        body: JSON.stringify({ titolo: 'X', inizio }),
      });
      assert.equal(r.status, 400, `${inizio} doveva essere rifiutata`);
    }
  });
});

describe('messaggi diretti', () => {
  it('aprono una conversazione riusabile, e i messaggi passano dalle rotte dei canali', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const aperta = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );
    assert.equal(aperta.conversazione.con.nome, 'Marco');

    // Riaprirla non ne fa una seconda.
    const seconda = await corpoDi(
      await marco.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: capo.utente.id }),
      }),
    );
    assert.equal(seconda.conversazione.id, aperta.conversazione.id);

    const canale = aperta.conversazione.canale;
    assert.equal(
      (
        await capo.chiama(`/api/canali/${canale}/messaggi`, {
          method: 'POST',
          body: JSON.stringify({ testo: 'ciao Marco' }),
        })
      ).status,
      201,
    );

    const { conversazioni } = await corpoDi(await marco.chiama('/api/diretti'));
    assert.equal(conversazioni[0].nonLetti, 1);
    assert.equal(conversazioni[0].ultimo.testo, 'ciao Marco');
  });

  it('non li legge nessun altro, nemmeno un admin dell\'istanza', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const altro = await accesso(talk, base, { nome: 'Altro', ruolo: 'admin' });

    const { conversazione } = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );
    await capo.chiama(`/api/canali/${conversazione.canale}/messaggi`, {
      method: 'POST',
      body: JSON.stringify({ testo: 'una cosa privata' }),
    });

    assert.equal((await altro.chiama(`/api/canali/${conversazione.canale}/messaggi`)).status, 404);
    assert.equal((await altro.chiama(`/api/diretti/${conversazione.id}`)).status, 404);
  });

  it('lo spazio di sistema non compare fra gli spazi e non si amministra', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    await conSpazio(capo.chiama);

    const { conversazione } = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );

    const { spazi } = await corpoDi(await capo.chiama('/api/spazi'));
    assert.equal(spazi.length, 1, 'solo lo spazio vero');

    const sistema = talk.db.spazioPerChiave('diretti');
    assert.ok(sistema, 'lo spazio di sistema esiste sul disco');
    assert.equal((await capo.chiama(`/api/spazi/${sistema.id}/membri`)).status, 404);
    assert.equal(
      (await capo.chiama(`/api/canali/${conversazione.canale}`, { method: 'DELETE' })).status,
      404,
      'un canale diretto non si cancella dalle rotte dei canali',
    );
  });
});

describe('chiamate dirette', () => {
  it('squilla, si risponde, e si chiude', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const { conversazione } = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );

    const partita = await corpoDi(
      await capo.chiama(`/api/diretti/${conversazione.id}/chiamata`, { method: 'POST' }),
    );
    assert.equal(partita.chiamata.stato, 'squilla');
    assert.ok(partita.ingresso.gettone.length > 20);
    assert.equal(partita.ingresso.diretta.con, marco.utente.id);

    assert.equal(
      (await capo.chiama(`/api/diretti/${conversazione.id}/chiamata/accetta`, { method: 'POST' })).status,
      409,
      'chi chiama non puo\' rispondersi da solo',
    );

    const risposta = await corpoDi(
      await marco.chiama(`/api/diretti/${conversazione.id}/chiamata/accetta`, { method: 'POST' }),
    );
    assert.equal(risposta.chiamata.stato, 'in corso');
    assert.ok(risposta.ingresso.gettone.length > 20);

    assert.equal(
      (
        await capo.chiama(`/api/diretti/${conversazione.id}/chiamata/chiudi`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
      ).status,
      200,
    );
    assert.equal(talk.chiamate.attiva(conversazione.id), null);
  });

  it('due che si chiamano insieme finiscono nella stessa stanza', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });

    const { conversazione } = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );

    await capo.chiama(`/api/diretti/${conversazione.id}/chiamata`, { method: 'POST' });
    const seconda = await corpoDi(
      await marco.chiama(`/api/diretti/${conversazione.id}/chiamata`, { method: 'POST' }),
    );
    assert.equal(seconda.chiamata.stato, 'in corso');
    assert.equal(talk.chiamate.quante, 1);
  });

  it('non si telefona a una conversazione che non e\' propria', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const altro = await accesso(talk, base, { nome: 'Altro', ruolo: 'admin' });

    const { conversazione } = await corpoDi(
      await capo.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: marco.utente.id }),
      }),
    );
    assert.equal(
      (await altro.chiama(`/api/diretti/${conversazione.id}/chiamata`, { method: 'POST' })).status,
      404,
    );
  });
});

describe('sessioni condivise', () => {
  it('apre una sessione YouTube e sincronizza sull\'orologio del server', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama);

    const aperta = await corpoDi(
      await capo.chiama(`/api/canali/${voce.id}/media`, {
        method: 'POST',
        body: JSON.stringify({ tipo: 'youtube' }),
      }),
    );
    assert.equal(aperta.sessione.tipo, 'youtube');
    assert.ok(Math.abs(aperta.adesso - Date.now()) < 5000);

    const cambiata = await corpoDi(
      await capo.chiama(`/api/media/${aperta.sessione.id}/comando`, {
        method: 'POST',
        body: JSON.stringify({
          azione: 'cambia',
          riferimento: 'dQw4w9WgXcQ',
          titolo: 'Prova',
          durataMs: 213_000,
        }),
      }),
    );
    assert.equal(cambiata.sessione.stato.riferimento, 'dQw4w9WgXcQ');
    assert.equal(cambiata.sessione.stato.inRiproduzione, true);

    const saltata = await corpoDi(
      await capo.chiama(`/api/media/${aperta.sessione.id}/comando`, {
        method: 'POST',
        body: JSON.stringify({ azione: 'salta', posizioneMs: 92_000 }),
      }),
    );
    assert.ok(Math.abs(saltata.sessione.posizioneAttesa - 92_000) < 1000);
  });

  it('rifiuta un riferimento che non e\' un video di YouTube', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama);

    const { sessione } = await corpoDi(
      await capo.chiama(`/api/canali/${voce.id}/media`, {
        method: 'POST',
        body: JSON.stringify({ tipo: 'youtube' }),
      }),
    );

    for (const cattivo of ['https://esempio.it/x', 'dQw4w9WgXc', '<script>', '']) {
      const r = await capo.chiama(`/api/media/${sessione.id}/comando`, {
        method: 'POST',
        body: JSON.stringify({ azione: 'cambia', riferimento: cattivo }),
      });
      assert.equal(r.status, 400, `"${cattivo}" doveva essere rifiutato`);
    }
  });

  it('senza stream si guarda e basta, ma si puo\' accodare', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);

    const { ruoli } = await corpoDi(await capo.chiama(`/api/spazi/${spazio.id}/ruoli`));
    const baseRuolo = ruoli.find((r) => r.tipo === 'base');
    await capo.chiama(`/api/spazi/${spazio.id}/override/canale/${voce.id}`, {
      method: 'PUT',
      body: JSON.stringify({ tipo: 'ruolo', soggetto: baseRuolo.id, nega: ['stream'] }),
    });

    const { sessione } = await corpoDi(
      await capo.chiama(`/api/canali/${voce.id}/media`, {
        method: 'POST',
        body: JSON.stringify({ tipo: 'youtube' }),
      }),
    );

    assert.equal(
      (
        await marco.chiama(`/api/media/${sessione.id}/comando`, {
          method: 'POST',
          body: JSON.stringify({ azione: 'pausa' }),
        })
      ).status,
      403,
    );

    const accodato = await marco.chiama(`/api/media/${sessione.id}/coda`, {
      method: 'POST',
      body: JSON.stringify({ riferimento: 'oHg5SJYRHA0', titolo: 'Altro' }),
    });
    assert.equal(accodato.status, 201, 'una coda condivisa la riempie chi ascolta');
  });

  it('la coda si richiude ad anello', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama);

    const { sessione } = await corpoDi(
      await capo.chiama(`/api/canali/${voce.id}/media`, {
        method: 'POST',
        body: JSON.stringify({ tipo: 'youtube' }),
      }),
    );

    for (const id of ['dQw4w9WgXcQ', 'oHg5SJYRHA0']) {
      await capo.chiama(`/api/media/${sessione.id}/coda`, {
        method: 'POST',
        body: JSON.stringify({ riferimento: id, titolo: id }),
      });
    }

    const visti = [];
    for (let i = 0; i < 4; i++) {
      const r = await corpoDi(
        await capo.chiama(`/api/media/${sessione.id}/comando`, {
          method: 'POST',
          body: JSON.stringify({ azione: 'prossimo' }),
        }),
      );
      visti.push(r.sessione.stato.riferimento);
    }
    assert.deepEqual(visti, ['dQw4w9WgXcQ', 'oHg5SJYRHA0', 'dQw4w9WgXcQ', 'oHg5SJYRHA0']);
  });

  it('la posizione attesa avanza da sola solo mentre suona', () => {
    const partito = { posizioneMs: 1000, inRiproduzione: true, aggiornato: Date.now() - 5000 };
    assert.ok(Math.abs(posizioneAttesa(partito) - 6000) < 200);

    const fermo = { posizioneMs: 1000, inRiproduzione: false, aggiornato: Date.now() - 5000 };
    assert.equal(posizioneAttesa(fermo), 1000);

    // Oltre la durata non si va: un video finito resta finito.
    const finito = { posizioneMs: 1000, durataMs: 2000, inRiproduzione: true, aggiornato: Date.now() - 60_000 };
    assert.equal(posizioneAttesa(finito), 2000);
  });
});

describe('musica condivisa', () => {
  it('dichiara i provider e i loro limiti anche senza credenziali', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const { provider, collegamenti } = await corpoDi(await capo.chiama('/api/musica'));
    const spotify = provider.find((p) => p.nome === 'spotify');
    assert.ok(spotify, 'Spotify va dichiarato anche se non configurato');
    assert.equal(spotify.configurato, false);
    assert.match(spotify.limiti.premium, /Premium/);
    assert.deepEqual(collegamenti, []);

    const r = await capo.chiama('/api/musica/spotify/collega', { method: 'POST' });
    assert.equal(r.status, 501, 'senza credenziali si dice che manca la configurazione');
  });

  it('con le credenziali produce un URL di autorizzazione con lo state', async (t) => {
    const { talk, base } = await conServer(t, {
      SPOTIFY_CLIENT_ID: 'un-client-id',
      SPOTIFY_CLIENT_SECRET: 'un-segreto',
      SPOTIFY_REDIRECT_URI: 'https://talk.esempio.it/api/musica/spotify/ritorno',
    });
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const { autorizzazione } = await corpoDi(
      await capo.chiama('/api/musica/spotify/collega', { method: 'POST' }),
    );
    const url = new URL(autorizzazione);
    assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
    assert.equal(url.searchParams.get('client_id'), 'un-client-id');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.ok(url.searchParams.get('state').length >= 16);
    assert.match(url.searchParams.get('scope'), /user-modify-playback-state/);
  });

  it('richiede anche il redirect e non riflette HTML nel ritorno OAuth', async (t) => {
    const { talk, base } = await conServer(t, {
      SPOTIFY_CLIENT_ID: 'un-client-id',
      SPOTIFY_CLIENT_SECRET: 'un-segreto',
    });
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const collega = await capo.chiama('/api/musica/spotify/collega', { method: 'POST' });
    assert.equal(collega.status, 501, 'senza redirect il provider non e\' configurato');

    const ritorno = await fetch(
      `${base}/api/musica/spotify/ritorno?error=${encodeURIComponent('<script>alert(1)</script>')}`,
    );
    const pagina = await ritorno.text();
    assert.ok(!pagina.includes('<script>alert(1)</script>'));
    assert.match(pagina, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('il ritorno con uno state inventato non collega niente', async (t) => {
    const { base } = await conServer(t, {
      SPOTIFY_CLIENT_ID: 'un-client-id',
      SPOTIFY_CLIENT_SECRET: 'un-segreto',
      SPOTIFY_REDIRECT_URI: 'https://talk.esempio.it/api/musica/spotify/ritorno',
    });

    const r = await fetch(`${base}/api/musica/spotify/ritorno?code=x&state=inventato`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /scaduta/);
  });
});

describe('anteprime dei link', () => {
  it('consegna il DNS fissato nella forma che Node sta chiedendo', () => {
    const risolvi = lookupFissato({ address: '93.184.216.34', family: 4 });

    // Con `all: true` Node legge `addresses[0].address`. Rispondere con la
    // forma singola gli fa leggere `undefined` e la connessione muore con
    // "Invalid IP address: undefined" prima di partire: e' il difetto per cui
    // ogni anteprima rispondeva 500 e il client se lo mangiava in silenzio.
    let visto = null;
    risolvi('example.com', { all: true }, (errore, valore) => {
      visto = { errore, valore };
    });
    assert.equal(visto.errore, null);
    assert.deepEqual(visto.valore, [{ address: '93.184.216.34', family: 4 }]);

    // Senza `all` vale ancora la forma a tre argomenti.
    let singolo = null;
    risolvi('example.com', {}, (errore, indirizzo, famiglia) => {
      singolo = { errore, indirizzo, famiglia };
    });
    assert.deepEqual(singolo, { errore: null, indirizzo: '93.184.216.34', famiglia: 4 });
  });

  it('rifiuta cio\' che non deve nemmeno provare a chiedere', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    // Localhost, reti private, l'indirizzo dei metadati delle macchine in
    // cloud, e gli schemi che non sono http: nessuno di questi deve diventare
    // una richiesta in uscita fatta dal server per conto di chi ha incollato
    // un link in chat.
    for (const url of [
      'http://127.0.0.1/x',
      'http://localhost/x',
      'http://10.0.0.1/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/x',
      'file:///etc/passwd',
      'ftp://esempio.it/x',
    ]) {
      const r = await capo.chiama('/api/anteprime-link', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      assert.ok(r.status === 400 || r.status === 422, `${url} doveva essere rifiutato, non ${r.status}`);
    }
  });

  it('non risponde a chi non ha un token', async (t) => {
    const { base } = await conServer(t);
    const r = await fetch(`${base}/api/anteprime-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://esempio.it' }),
    });
    assert.equal(r.status, 401);
  });
});

describe('dialetti del provider AI', () => {
  /** Config finta: qui non parte nessuna richiesta vera. */
  const conAi = (extra = {}) => ({
    limiti: { allegatoMax: 4 * 1024 * 1024 },
    ai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'chiave-finta',
      chatModel: 'un-modello',
      imageModel: '',
      sttModel: '',
      webSearch: false,
      timeoutMs: 5000,
      contestoMessaggi: 20,
      formato: 'auto',
      ...extra,
    },
  });

  /** Sostituisce fetch, registra cosa e' stato chiesto, risponde cio' che si vuole. */
  function conFetchFinto(t, risposta) {
    const chiamate = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, opzioni) => {
      chiamate.push({ url: String(url), corpo: JSON.parse(opzioni.body) });
      return {
        ok: risposta.stato === undefined || risposta.stato < 400,
        status: risposta.stato ?? 200,
        json: async () => risposta.dati ?? {},
      };
    };
    t.after(() => {
      globalThis.fetch = vero;
    });
    return chiamate;
  }

  it('sceglie il dialetto guardando l\'indirizzo', () => {
    assert.equal(scegliDialetto({ baseUrl: 'https://api.openai.com/v1' }).nome, 'responses');
    assert.equal(scegliDialetto({ baseUrl: 'http://192.168.1.10:11434/v1' }).nome, 'chat');
    assert.equal(scegliDialetto({ baseUrl: 'https://api.groq.com/openai/v1' }).nome, 'chat');

    // Forzato a mano: serve per un proxy verso OpenAI su un dominio proprio.
    assert.equal(
      scegliDialetto({ baseUrl: 'https://mio-proxy.it/v1', formato: 'responses' }).nome,
      'responses',
    );
  });

  it('su OpenAI manda /responses con input e ruolo developer', async (t) => {
    const chiamate = conFetchFinto(t, { dati: { output_text: 'ciao' } });
    const provider = creaProviderAi(conAi());

    assert.equal(provider.formato, 'responses');
    const testo = await provider.chat({ prompt: 'come stai?', contesto: [] });

    assert.equal(testo, 'ciao');
    assert.equal(chiamate.length, 1);
    assert.match(chiamate[0].url, /\/responses$/);
    assert.equal(chiamate[0].corpo.input[0].role, 'developer');
    assert.equal(chiamate[0].corpo.input.at(-1).content, 'come stai?');
    assert.equal(chiamate[0].corpo.max_output_tokens, 1200);
  });

  it('su un modello locale manda /chat/completions con messages e ruolo system', async (t) => {
    const chiamate = conFetchFinto(t, {
      dati: { choices: [{ message: { content: 'ciao da Ollama' } }] },
    });
    const provider = creaProviderAi(conAi({ baseUrl: 'http://192.168.1.10:11434/v1' }));

    assert.equal(provider.formato, 'chat');
    const testo = await provider.chat({
      prompt: 'come stai?',
      contesto: [{ origine: 'utente', testo: 'ciao' }, { origine: 'ai', testo: 'salve' }],
    });

    assert.equal(testo, 'ciao da Ollama');
    assert.match(chiamate[0].url, /\/chat\/completions$/);
    const messaggi = chiamate[0].corpo.messages;
    assert.equal(messaggi[0].role, 'system');
    assert.deepEqual(messaggi.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
    assert.equal(chiamate[0].corpo.max_tokens, 1200);
    assert.equal(chiamate[0].corpo.input, undefined, 'il corpo di Responses non deve finire qui');
  });

  it('legge il testo anche quando arriva a pezzi', async (t) => {
    conFetchFinto(t, {
      dati: { choices: [{ message: { content: [{ text: 'una ' }, { text: 'risposta' }] } }] },
    });
    const provider = creaProviderAi(conAi({ baseUrl: 'http://127.0.0.1:1234/v1' }));
    assert.equal(await provider.chat({ prompt: 'x', contesto: [] }), 'una risposta');
  });

  it('la ricerca web resta spenta dove non esiste', () => {
    const suOpenai = creaProviderAi(conAi({ webSearch: true }));
    assert.equal(suOpenai.capabilities.ricercaWeb, true);

    // /chat/completions non ha lo strumento: prometterlo vorrebbe dire un
    // pulsante acceso che risponde sempre "non configurato".
    const inLocale = creaProviderAi(conAi({ webSearch: true, baseUrl: 'http://192.168.1.10:11434/v1' }));
    assert.equal(inLocale.capabilities.ricercaWeb, false);
    assert.equal(inLocale.capabilities.chat, true, 'la chat deve restare accesa');
  });

  it('un 404 sul percorso suggerisce l\'altro formato', async (t) => {
    conFetchFinto(t, { stato: 404 });
    const provider = creaProviderAi(conAi());
    await assert.rejects(
      () => provider.chat({ prompt: 'x', contesto: [] }),
      /TALK_AI_FORMATO=chat/,
    );
  });

  it('trova il JSON del riassunto anche dentro a un blocco di codice', () => {
    assert.equal(ripuliscJson('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(ripuliscJson('Ecco il riassunto:\n{"a":1}\ngrazie'), '{"a":1}');
    assert.equal(ripuliscJson('{"a":1}'), '{"a":1}');
  });

  it('il riassunto separa istruzione e trascrizione', async (t) => {
    const chiamate = conFetchFinto(t, {
      dati: { choices: [{ message: { content: '{"argomenti":["menu"],"decisioni":[]}' } }] },
    });
    const provider = creaProviderAi(conAi({ baseUrl: 'http://192.168.1.10:11434/v1' }));

    const riassunto = await provider.riassumi({ trascrizione: 'Filippo: sistemiamo il menu.' });
    assert.deepEqual(riassunto.argomenti, ['menu']);
    assert.deepEqual(riassunto.problemi, [], 'le chiavi mancanti diventano elenchi vuoti');

    const messaggi = chiamate[0].corpo.messages;
    assert.equal(messaggi[0].role, 'system');
    assert.equal(messaggi[1].content, 'Filippo: sistemiamo il menu.');
  });
});

describe('il flusso degli eventi attraverso le origini', () => {
  /**
   * La rotta SSE scrive le intestazioni con `raw.writeHead`, scavalcando la
   * pipeline di Fastify. Senza ricopiare cio' che i plugin avevano gia'
   * preparato, il flusso esce senza intestazioni CORS: il browser lo blocca, e
   * l'applicazione resta con "Failed to fetch, riprovo" mentre tutto il resto
   * funziona — perche' le altre rotte le intestazioni le ricevono normalmente.
   *
   * Non si vedeva finche' l'interfaccia viveva su file://, che un'origine da
   * confrontare non ce l'ha.
   */
  it('porta le intestazioni CORS anche se scrive le sue a mano', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const controllo = new AbortController();
    t.after(() => controllo.abort());

    const r = await fetch(`${base}/api/eventi`, {
      headers: {
        authorization: `Bearer ${capo.token}`,
        origin: 'http://127.0.0.1:45678',
      },
      signal: controllo.signal,
    });

    assert.equal(r.status, 200);
    assert.equal(
      r.headers.get('access-control-allow-origin'),
      'http://127.0.0.1:45678',
      'senza questa intestazione il browser butta via il flusso',
    );
    // Le nostre non devono essere state schiacciate da quelle copiate.
    assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
    assert.equal(r.headers.get('x-accel-buffering'), 'no');

    controllo.abort();
  });

  it('il preflight della rotta degli eventi passa', async (t) => {
    const { base } = await conServer(t);
    const r = await fetch(`${base}/api/eventi`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:45678',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.ok(r.status < 300, `il preflight ha risposto ${r.status}`);
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://127.0.0.1:45678');
  });
});

describe('generazione delle immagini', () => {
  const conConfig = (extra = {}) => ({
    limiti: { allegatoMax: 4 * 1024 * 1024 },
    ai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', imageModel: '' },
    immagini: { provider: 'auto', url: '', passi: 25 },
    ...extra,
  });

  it('senza niente configurato non finge di poter disegnare', () => {
    const g = creaGeneratoreImmagini(conConfig());
    assert.equal(g.disponibile, false);
    assert.ok(g.motivo, 'deve dire cosa manca');
  });

  it('in automatico preferisce cio\' che gira in casa', () => {
    const soloOpenai = creaGeneratoreImmagini(
      conConfig({ ai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', imageModel: 'gpt-image-1' } }),
    );
    assert.equal(soloOpenai.id, 'openai');
    assert.equal(soloOpenai.disponibile, true);

    // Con una WebUI in rete si preferisce quella: e' gratis, e i prompt non
    // escono di casa.
    const conLocale = creaGeneratoreImmagini(
      conConfig({
        ai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', imageModel: 'gpt-image-1' },
        immagini: { provider: 'auto', url: 'http://192.168.1.10:7860', passi: 25 },
      }),
    );
    assert.equal(conLocale.id, 'automatic1111');
  });

  it('si puo\' scegliere a mano', () => {
    const forzato = creaGeneratoreImmagini(
      conConfig({
        ai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'k', imageModel: 'gpt-image-1' },
        immagini: { provider: 'openai', url: 'http://192.168.1.10:7860', passi: 25 },
      }),
    );
    assert.equal(forzato.id, 'openai');
  });

  /**
   * Perchance resta dichiarato e spento. Non e' un segnaposto: e' l'unico
   * posto in cui la risposta alla domanda "perche' no" e' scritta.
   */
  it('Perchance e\' dichiarato, spento, e spiega perche\'', async () => {
    assert.equal(PERCHANCE.disponibile, false);
    assert.match(PERCHANCE.motivo, /pubblicita|API pubblica/i);
    await assert.rejects(() => PERCHANCE.genera({ prompt: 'x' }), /API pubblica/i);

    const scelto = creaGeneratoreImmagini(conConfig({ immagini: { provider: 'perchance', url: '', passi: 25 } }));
    assert.equal(scelto.disponibile, false);
  });

  it('elenca tutti i provider con il motivo di chi e\' spento', () => {
    const elenco = elencoGeneratori(conConfig());
    assert.deepEqual(elenco.map((p) => p.id).sort(), ['automatic1111', 'openai', 'perchance']);
    assert.ok(elenco.every((p) => p.disponibile || p.motivo), 'chi e\' spento deve dire perche\'');
  });

  it('parla con la WebUI locale nel formato che si aspetta', async (t) => {
    const chiamate = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, opzioni) => {
      chiamate.push({ url: String(url), corpo: JSON.parse(opzioni.body) });
      // Una WebUI vera antepone volentieri il data URL: si deve tagliare.
      const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
      return { ok: true, status: 200, json: async () => ({ images: [`data:image/png;base64,${png}`] }) };
    };
    t.after(() => {
      globalThis.fetch = vero;
    });

    const g = creaGeneratoreImmagini(
      conConfig({ immagini: { provider: 'automatic1111', url: 'http://192.168.1.10:7860/', passi: 30 } }),
    );
    const esito = await g.genera({ prompt: 'una citta cyberpunk' });

    assert.equal(chiamate[0].url, 'http://192.168.1.10:7860/sdapi/v1/txt2img');
    assert.equal(chiamate[0].corpo.prompt, 'una citta cyberpunk');
    assert.equal(chiamate[0].corpo.steps, 30);
    assert.equal(esito.tipo, 'image/png');
    assert.ok(esito.corpo.length > 0, 'il data URL va tagliato, non decodificato com\'e\'');
  });

  it('un 404 sulla WebUI dice che manca --api', async (t) => {
    const vero = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    t.after(() => {
      globalThis.fetch = vero;
    });

    const g = creaGeneratoreImmagini(
      conConfig({ immagini: { provider: 'automatic1111', url: 'http://192.168.1.10:7860', passi: 25 } }),
    );
    await assert.rejects(() => g.genera({ prompt: 'x' }), /--api/);
  });
});

describe('presenza: chi c\'e\', chi non c\'e\', e chi non vuole essere disturbato', () => {
  /** Come lo vede un altro nell'elenco dei profili. */
  const comeLoVedono = async (chi, quale) => {
    const { utenti } = await corpoDi(await chi.chiama('/api/utenti'));
    return utenti.find((u) => u.id === quale)?.stato;
  };

  it('chi non ha l\'applicazione aperta risulta offline, anche se si era messo online', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    // Bruno ha un account e una sessione, ma nessun flusso aperto: ha fatto
    // login e ha chiuso la finestra. Prima restava "online" per sempre.
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'offline');
  });

  it('il flusso aperto e\' cio\' che rende online, e chiuderlo rimette offline', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    const chiudi = talk.eventi.iscrivi(bruno.utente.id, () => {});
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'online');

    chiudi();
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'offline');
  });

  it('non disturbare resta anche ad applicazione chiusa', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    const chiudi = talk.eventi.iscrivi(bruno.utente.id, () => {});
    await bruno.chiama('/api/auth/profilo', {
      method: 'POST',
      body: JSON.stringify({ stato: 'occupato' }),
    });
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'occupato');

    // E' l'unico stato che sopravvive alla chiusura: "non c'e'" e "non vuole"
    // sono due risposte diverse, e la seconda vale anche da spenti.
    chiudi();
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'occupato');
  });

  it('invisibile esce offline, con il flusso aperto e senza', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    await bruno.chiama('/api/auth/profilo', {
      method: 'POST',
      body: JSON.stringify({ stato: 'invisibile' }),
    });

    const chiudi = talk.eventi.iscrivi(bruno.utente.id, () => {});
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'offline', 'collegato ma invisibile');
    chiudi();
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'offline');

    // A se stesso pero' deve dire la verita', o non saprebbe di esserlo.
    const { utente } = await corpoDi(await bruno.chiama('/api/auth/io'));
    assert.equal(utente.stato, 'invisibile');
  });

  it('inattivo lo dichiara l\'applicazione, e si perde chiudendola', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    const chiudi = talk.eventi.iscrivi(bruno.utente.id, () => {});
    assert.equal(
      (await bruno.chiama('/api/auth/inattivita', {
        method: 'POST',
        body: JSON.stringify({ inattivo: true }),
      })).status,
      200,
    );
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'inattivo');

    // Chiudendo si diventa offline, non "inattivo da ieri sera": riaprendo
    // domani si riparte da online finche' non ci si ferma di nuovo.
    chiudi();
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'offline');
    const riapre = talk.eventi.iscrivi(bruno.utente.id, () => {});
    assert.equal(await comeLoVedono(ada, bruno.utente.id), 'online');
    riapre();
  });

  it('inattivo non si sceglie a mano', async (t) => {
    const { talk, base } = await conServer(t);
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    const r = await bruno.chiama('/api/auth/profilo', {
      method: 'POST',
      body: JSON.stringify({ stato: 'inattivo' }),
    });
    assert.equal(r.status, 400, 'lo decide l\'applicazione, non il pulsante');
  });

  it('chi entra e chi esce viene annunciato a chi sta ascoltando', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });

    const visti = [];
    const chiudiAda = talk.eventi.iscrivi(ada.utente.id, (corpo) => {
      const evento = JSON.parse(corpo);
      if (evento.tipo === 'stato-utente' && evento.utente === bruno.utente.id) visti.push(evento.stato);
    });

    const chiudiBruno = talk.eventi.iscrivi(bruno.utente.id, () => {});
    chiudiBruno();
    chiudiAda();

    assert.deepEqual(visti, ['online', 'offline']);
  });
});

describe('Auto Writer: ognuno decide per se\'', () => {
  const conStt = (t) =>
    conServer(t, {
      TALK_AI_API_KEY: 'chiave-finta-solo-per-capability',
      TALK_AI_STT_MODEL: 'stt-di-prova',
    });

  /** Due persone dentro allo stesso vocale, per la SFU finta. */
  const dentroInDue = (talk, canale, uno, due) => {
    talk.presenze.leggi = async () => new Map([
      [talk.db.chiaveSfu(talk.db.canale(canale)), [{ identita: `u${uno}` }, { identita: `u${due}` }]],
    ]);
  };

  it('parte subito con chi l\'ha chiesta, senza aspettare le risposte degli altri', async (t) => {
    const { talk, base } = await conStt(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const casa = await conSpazio(ada.chiama, { nome: 'Riunione' });
    dentroInDue(talk, casa.voce.id, ada.utente.id, bruno.utente.id);

    const avvio = await ada.chiama(`/api/canali/${casa.voce.id}/autowriter`, { method: 'POST' });
    assert.equal(avvio.status, 201);
    const sessione = (await corpoDi(avvio)).sessione;

    // Prima restava in 'consenso' finche' Bruno non rispondeva: bastava una
    // finestra in secondo piano per non trascrivere mai niente.
    assert.equal(sessione.stato, 'attiva');
    assert.equal(sessione.consensi.find((c) => c.utente === bruno.utente.id).consenso, null);
  });

  it('un rifiuto vale per chi lo dice, e non chiude la stanza agli altri', async (t) => {
    const { talk, base } = await conStt(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const casa = await conSpazio(ada.chiama, { nome: 'Riunione' });
    dentroInDue(talk, casa.voce.id, ada.utente.id, bruno.utente.id);

    await ada.chiama(`/api/canali/${casa.voce.id}/autowriter`, { method: 'POST' });
    assert.equal(
      (await bruno.chiama(`/api/canali/${casa.voce.id}/autowriter/consenso`, {
        method: 'POST',
        body: JSON.stringify({ consenso: false }),
      })).status,
      200,
    );

    const dopo = await corpoDi(await ada.chiama(`/api/canali/${casa.voce.id}/autowriter`));
    assert.equal(dopo.sessione.stato, 'attiva', 'il no di uno non decide per sei');
    assert.equal(dopo.sessione.consensi.find((c) => c.utente === bruno.utente.id).consenso, false);
  });

  it('chi ha rifiutato non manda audio e non legge la trascrizione', async (t) => {
    const { talk, base } = await conStt(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const casa = await conSpazio(ada.chiama, { nome: 'Riunione' });
    dentroInDue(talk, casa.voce.id, ada.utente.id, bruno.utente.id);

    await ada.chiama(`/api/canali/${casa.voce.id}/autowriter`, { method: 'POST' });
    await bruno.chiama(`/api/canali/${casa.voce.id}/autowriter/consenso`, {
      method: 'POST',
      body: JSON.stringify({ consenso: false }),
    });

    const segmento = await bruno.chiama(`/api/canali/${casa.voce.id}/autowriter/segmenti`, {
      method: 'POST',
      body: JSON.stringify({ audio: Buffer.from('finto').toString('base64'), tipo: 'audio/webm' }),
    });
    assert.equal(segmento.status, 403, 'senza consenso la sua voce non parte');

    const trascrizione = talk.db.sql.prepare('SELECT id FROM trascrizioni ORDER BY id DESC LIMIT 1').get();
    talk.db.sql.prepare(
      'INSERT INTO segmenti_trascrizione (trascrizione, parlante, testo, definitivo, creato) VALUES (?, ?, ?, 1, ?)',
    ).run(trascrizione.id, ada.utente.id, 'detto da Ada', Date.now());

    const suo = await corpoDi(await bruno.chiama(`/api/canali/${casa.voce.id}/autowriter`));
    assert.deepEqual(suo.sessione.segmenti, [], 'chi ha detto no non la legge');
    const dellAda = await corpoDi(await ada.chiama(`/api/canali/${casa.voce.id}/autowriter`));
    assert.equal(dellAda.sessione.segmenti.length, 1);
  });
});

describe('ricevute dei messaggi diretti', () => {
  /** Una conversazione fra due, e il canale che la porta. */
  const conversazioneFra = async (uno, due) => {
    const aperta = await corpoDi(
      await uno.chiama('/api/diretti', {
        method: 'POST',
        body: JSON.stringify({ utente: due.utente.id }),
      }),
    );
    return aperta.conversazione.canale;
  };

  const ricevuteDi = async (chi, canale) =>
    (await corpoDi(await chi.chiama(`/api/canali/${canale}/messaggi`))).ricevute;

  it('inviato, consegnato, letto: tre momenti diversi', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const canale = await conversazioneFra(ada, bruno);

    const { messaggio } = await corpoDi(
      await ada.chiama(`/api/canali/${canale}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'ci sei?' }),
      }),
    );

    // Bruno ha l'applicazione chiusa: il messaggio e' sul server e basta.
    let spunte = await ricevuteDi(ada, canale);
    assert.equal(spunte.consegnato, 0, 'nessuno l\'ha ancora ricevuto');
    assert.equal(spunte.letto, 0);

    // Bruno apre la conversazione: adesso ce l'ha, e l'ha letta.
    await bruno.chiama(`/api/canali/${canale}/messaggi`);
    spunte = await ricevuteDi(ada, canale);
    assert.equal(spunte.consegnato, messaggio.id, 'leggere e\' la prova che e\' arrivato');
    assert.equal(spunte.letto, 0, 'ricevuto non vuol dire letto');

    await bruno.chiama(`/api/canali/${canale}/letto`, {
      method: 'POST',
      body: JSON.stringify({ fino: messaggio.id }),
    });
    spunte = await ricevuteDi(ada, canale);
    assert.equal(spunte.letto, messaggio.id);
  });

  it('con l\'applicazione aperta la consegna e\' immediata', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const bruno = await accesso(talk, base, { nome: 'Bruno', ruolo: 'membro' });
    const canale = await conversazioneFra(ada, bruno);

    // Il flusso aperto e' cio' che il server guarda per dire "consegnato":
    // non lo chiede al client, o il destinatario deciderebbe da solo se
    // risultare raggiungibile.
    const chiudi = talk.eventi.iscrivi(bruno.utente.id, () => {});
    const { messaggio } = await corpoDi(
      await ada.chiama(`/api/canali/${canale}/messaggi`, {
        method: 'POST',
        body: JSON.stringify({ testo: 'eccomi' }),
      }),
    );
    chiudi();

    const spunte = await ricevuteDi(ada, canale);
    assert.equal(spunte.consegnato, messaggio.id);
    assert.equal(spunte.letto, 0);
  });

  it('nei canali di spazio le spunte non esistono', async (t) => {
    const { talk, base } = await conServer(t);
    const ada = await accesso(talk, base, { nome: 'Ada', ruolo: 'admin' });
    const casa = await conSpazio(ada.chiama, { nome: 'Casa' });

    const corpo = await corpoDi(await ada.chiama(`/api/canali/${casa.testo.id}/messaggi`));
    assert.equal(corpo.ricevute, null, '"gli e\' arrivato" fra quaranta persone non vuol dire niente');
  });
});
