// Il cartellino: quante ore ha fatto ognuno, e chi puo' leggerle.
//
// Quello che questi test difendono non e' "la somma e' giusta" - una somma di
// minuti si sbaglia difficilmente. E' il contorno, che e' dove stanno le cose
// che fanno male: che con le impostazioni di lavoro spente non si scriva
// niente, che un collega non possa leggere le ore di un altro, e che la
// settimana finisca il sabato invece che la domenica. Un registro delle ore
// sbagliato di un giorno e' un registro che qualcuno paga.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import { creaTalk } from '../src/server.mjs';
import { avviaOreLavoro, giorniDellaSettimana, giornoDi, lunediDi } from '../src/ore-lavoro.mjs';
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
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-ore-'));
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

  return { talk, base, dir, env };
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

/** Una SFU finta: dice che in una stanza ci sono queste identita'. */
function presenzeFinte(identita) {
  return {
    async leggi() {
      return new Map([['spazio--generale', identita.map((i) => ({ identita: i }))]]);
    },
  };
}

describe('la settimana lavorativa', () => {
  it('va da lunedi a sabato, e la domenica appartiene a quella prima', () => {
    // 2026-09-02 e' un mercoledi'.
    assert.equal(lunediDi(new Date(2026, 8, 2, 12)), '2026-08-31');
    assert.equal(lunediDi(new Date(2026, 7, 31, 12)), '2026-08-31', 'il lunedi e se stesso');
    assert.equal(lunediDi(new Date(2026, 8, 5, 23)), '2026-08-31', 'il sabato chiude la settimana');
    assert.equal(
      lunediDi(new Date(2026, 8, 6, 20)),
      '2026-08-31',
      'la domenica sera e ancora la settimana che si sta chiudendo',
    );
    assert.equal(lunediDi(new Date(2026, 8, 7, 9)), '2026-09-07', 'il lunedi dopo ricomincia');
  });

  it('sono sei giorni, anche a cavallo di due mesi', () => {
    assert.deepEqual(giorniDellaSettimana('2026-08-31'), [
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });
});

describe('il contatore delle ore', () => {
  it('spento non scrive niente, acceso conta un minuto per battito', async (t) => {
    const { talk, base, dir } = await conServer(t);
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });
    const id = tale.utente.id;

    const config = { ...talk.config, lavoro: { attivo: false, oreSettimana: 40 } };
    const servizi = { config };
    const ore = avviaOreLavoro({
      db: talk.db,
      presenze: presenzeFinte([`u${id}`]),
      servizi,
      config,
    });
    t.after(() => ore.ferma());

    await ore.battito();
    assert.equal(
      talk.db.oreVocaleFra(giornoDi(), giornoDi()).length,
      0,
      'con le impostazioni di lavoro spente non si scrive niente',
    );

    servizi.config = { ...config, lavoro: { attivo: true, oreSettimana: 40 } };
    await ore.battito();
    await ore.battito();

    const righe = talk.db.oreVocaleFra(giornoDi(), giornoDi());
    assert.equal(righe.length, 1);
    assert.equal(righe[0].secondi, 120, 'due battiti sono due minuti');

    // E la settimana su file, con dentro anche l'obiettivo.
    const percorso = await ore.scriviSettimana(lunediDi());
    assert.ok(percorso, 'il file va scritto');
    const dentro = JSON.parse(readFileSync(join(dir, 'ore', `settimana-${lunediDi()}.json`), 'utf8'));
    assert.equal(dentro.oreSettimana, 40);
    assert.equal(dentro.persone.length, 1);
    assert.equal(dentro.persone[0].secondi, 120);
    assert.equal(ore.settimaneSuDisco()[0], lunediDi());
  });
});

describe('le rotte delle ore', () => {
  it('spente rispondono 404 invece di zeri', async (t) => {
    const { talk, base } = await conServer(t);
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });
    assert.equal((await tale.chiama('/api/ore/mie')).status, 404);
  });

  it('ognuno vede le proprie, e solo chi amministra le vede tutte', async (t) => {
    const { talk, base } = await conServer(t, { TALK_LAVORO: '1', TALK_LAVORO_ORE: '36' });
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });

    const oggi = giornoDi();
    talk.db.aggiungiSecondiVocale(tale.utente.id, oggi, 3600);
    talk.db.aggiungiSecondiVocale(capo.utente.id, oggi, 1800);

    const mie = await (await tale.chiama('/api/ore/mie')).json();
    assert.equal(mie.oreSettimana, 36);
    assert.equal(mie.giorni.length, 6);
    assert.equal(mie.mie.secondi, 3600);
    assert.equal(mie.mie.giorni[oggi], 3600);
    assert.ok(!('persone' in mie), 'dalle proprie ore non si risale a quelle degli altri');

    assert.equal((await tale.chiama('/api/ore')).status, 403, 'un collega non legge le altrui');

    const tutte = await (await capo.chiama('/api/ore')).json();
    assert.equal(tutte.persone.length, 2);
    assert.equal(tutte.persone.find((p) => p.utente === tale.utente.id).secondi, 3600);

    // Chiudere la settimana a mano scrive il file, e lo puo' fare solo un admin.
    assert.equal((await tale.chiama('/api/ore/chiudi', { method: 'POST', body: '{}' })).status, 403);
    const chiusa = await capo.chiama('/api/ore/chiudi', { method: 'POST', body: '{}' });
    assert.equal(chiusa.status, 200);
    assert.equal((await chiusa.json()).settimana, lunediDi());
  });

  it('una settimana passata si chiede per giorno, e torna la sua', async (t) => {
    const { talk, base } = await conServer(t, { TALK_LAVORO: '1' });
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });

    // Un mercoledi' qualunque: deve rispondere con il lunedi' della sua settimana.
    const risposta = await (await tale.chiama('/api/ore/mie?settimana=2026-09-02')).json();
    assert.equal(risposta.settimana, '2026-08-31');
    assert.equal(risposta.giorni[0], '2026-08-31');
    assert.equal(risposta.giorni[5], '2026-09-05');
  });
});
