// La moderazione della voce: chi puo', su chi, dove, e per quanto.
//
// Il filo conduttore e' lo stesso degli altri file di prova — **il permesso lo
// verifica il server** — con una seconda domanda che qui conta quanto la prima:
// **la restrizione sopravvive?** Una moderazione che si aggira uscendo e
// rientrando dalla stanza non e' una moderazione, e' un fastidio. Per questo
// meta' di queste prove guarda cosa c'e' scritto nel gettone, che e' l'unica
// cosa che la SFU legge davvero.
//
// La SFU qui non c'e' (SFU_API_URL punta a una porta chiusa): le chiamate di
// servizio falliscono in silenzio, com'e' previsto che facciano, e cio' che
// resta da guardare e' il database e il gettone. Il pezzo che si puo' provare
// solo con un LiveKit vero — che togliendo una sorgente stacchi la traccia gia'
// in volo — sta scritto nel riepilogo fra le cose da verificare a mano.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';
import {
  DURATA_MASSIMA_EVENTO,
  TOLLERANZA_EVENTO,
  eventoInCorso,
  finestraEvento,
} from '../src/dati/restrizioni.mjs';
import { permessiPartecipante } from '../src/sfu.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';

async function conServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-mod-'));
  const config = leggiConfig({
    TALK_ROOT: dir,
    SFU_API_KEY: 'chiave-di-prova',
    SFU_API_SECRET: SEGRETO,
    SFU_URL: 'wss://sfu.esempio.it',
    SFU_API_URL: 'http://127.0.0.1:1',
    TALK_LOG_LEVEL: 'silent',
  });

  const talk = await creaTalk(config);
  const porta = await ascoltaSuPortaBuona(talk.app);
  const base = `http://127.0.0.1:${porta}`;

  t.after(async () => {
    talk.chiamate.spegni();
    await talk.app.close();
    talk.db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* niente */
    }
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

async function conSpazio(chiama, { apertoATutti = true, nome = 'Casa' } = {}) {
  const r = await chiama('/api/spazi', {
    method: 'POST',
    body: JSON.stringify({ nome, impostazioni: { apertoATutti } }),
  });
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

/** Il gettone e' un JWT: qui interessa solo cosa c'e' scritto nel grant video. */
function grantDelGettone(gettone) {
  const [, corpo] = gettone.split('.');
  return JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')).video;
}

const ora = () => Math.floor(Date.now() / 1000);

/** Impone (o toglie) un provvedimento e restituisce la risposta cruda. */
const modera = (chi, canale, corpo) =>
  chi.chiama(`/api/canali/${canale}/restrizioni`, {
    method: 'POST',
    body: JSON.stringify(corpo),
  });

/**
 * Un secondo membro con un ruolo su misura.
 *
 * Il ruolo base non ha nessuno dei permessi di moderazione, quindi ogni prova
 * che riguarda "chi puo'" comincia da qui.
 */
async function conRuolo(capo, spazio, chi, permessi, priorita = 50) {
  const { ruolo } = await corpoDi(
    await capo.chiama(`/api/spazi/${spazio.id}/ruoli`, {
      method: 'POST',
      body: JSON.stringify({ nome: `Ruolo ${permessi.join('-')}`, permessi, priorita }),
    }),
  );
  const r = await capo.chiama(`/api/spazi/${spazio.id}/ruoli/${ruolo.id}/membri`, {
    method: 'POST',
    body: JSON.stringify({ utente: chi.utente.id }),
  });
  assert.ok(r.ok, 'assegnazione del ruolo fallita');
  return ruolo;
}

describe('restrizioni vocali: chi le impone', () => {
  it('un amministratore impone e toglie tutti e quattro i provvedimenti', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    for (const genere of ['camera', 'condivisione', 'microfono', 'cuffie']) {
      const messa = await modera(capo, voce.id, { utente: marco.utente.id, genere, attiva: true });
      assert.equal(messa.status, 200, `${genere} non imposta`);
      const corpo = await messa.json();
      assert.equal(corpo.cambiato, true);
      assert.ok(corpo.restrizioni.some((r) => r.genere === genere));
      assert.equal(
        corpo.restrizioni.find((r) => r.genere === genere).da.id,
        capo.utente.id,
        'deve restare scritto chi l\'ha imposta',
      );
    }

    const tutte = talk.db.restrizioni.di(voce.id, marco.utente.id);
    assert.equal(tutte.size, 4);

    for (const genere of ['camera', 'condivisione', 'microfono', 'cuffie']) {
      const tolta = await modera(capo, voce.id, { utente: marco.utente.id, genere, attiva: false });
      assert.equal(tolta.status, 200);
      assert.equal((await tolta.json()).cambiato, true);
    }
    assert.equal(talk.db.restrizioni.di(voce.id, marco.utente.id).size, 0);
  });

  it('imporre due volte la stessa cosa non e\' un errore', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    const dati = { utente: marco.utente.id, genere: 'microfono', attiva: true };
    assert.equal((await modera(capo, voce.id, dati)).status, 200);

    // Due amministratori che premono insieme: il secondo non deve ricevere un
    // errore per aver chiesto una cosa che nel frattempo era gia' vera.
    const seconda = await modera(capo, voce.id, dati);
    assert.equal(seconda.status, 200);
    assert.equal((await seconda.json()).cambiato, false);
    assert.equal(talk.db.restrizioni.di(voce.id, marco.utente.id).size, 1);

    // E toglierla due volte, allo stesso modo.
    await modera(capo, voce.id, { ...dati, attiva: false });
    const ritolta = await modera(capo, voce.id, { ...dati, attiva: false });
    assert.equal(ritolta.status, 200);
    assert.equal((await ritolta.json()).cambiato, false);
  });

  it('senza permessi si prende 403, e i permessi sono quelli giusti', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    for (const genere of ['camera', 'condivisione', 'microfono', 'cuffie']) {
      const r = await modera(marco, voce.id, { utente: lia.utente.id, genere, attiva: true });
      assert.equal(r.status, 403, `${genere} non deve passare al ruolo base`);
    }

    // A Marco solo "zittisce gli altri": il microfono si', il resto no. Sono
    // permessi diversi perche' sono poteri diversi, e un permesso che ne
    // concedesse quattro sarebbe un permesso che nessuno da' a cuor leggero.
    await conRuolo(capo, spazio, marco, ['muteMembers']);
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      200,
    );
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'cuffie', attiva: true }))
        .status,
      403,
      'deafenMembers e\' un altro permesso',
    );
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'camera', attiva: true }))
        .status,
      403,
      'camera e condivisione vogliono manageVoiceMembers',
    );
  });

  it('non si modera se stessi, ne\' chi sta piu\' in alto', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    await conRuolo(capo, spazio, marco, ['manageVoiceMembers', 'muteMembers'], 30);
    await conRuolo(capo, spazio, lia, ['manageVoiceMembers'], 80);

    assert.equal(
      (await modera(marco, voce.id, { utente: marco.utente.id, genere: 'microfono', attiva: true }))
        .status,
      400,
      'a se stessi no',
    );

    const alto = await modera(marco, voce.id, {
      utente: lia.utente.id,
      genere: 'microfono',
      attiva: true,
    });
    assert.equal(alto.status, 403);
    assert.match((await alto.json()).errore, /piu' in alto|stesso livello/);

    const proprietario = await modera(marco, voce.id, {
      utente: capo.utente.id,
      genere: 'microfono',
      attiva: true,
    });
    assert.equal(proprietario.status, 403);
  });

  it('un canale di testo non si modera, e un canale che non si vede non esiste', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, testo } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    assert.equal(
      (await modera(capo, testo.id, { utente: marco.utente.id, genere: 'microfono', attiva: true }))
        .status,
      400,
    );

    // Uno spazio di cui Marco non fa parte: per lui quel canale non esiste, e
    // la risposta e' 404 e non 403 — un "non puoi" direbbe comunque che c'e'.
    const altro = await conSpazio(capo.chiama, { apertoATutti: false, nome: 'Chiuso' });
    assert.equal(
      (await modera(marco, altro.voce.id, {
        utente: capo.utente.id,
        genere: 'microfono',
        attiva: true,
      })).status,
      404,
    );
  });
});

describe('restrizioni vocali: l\'organizzatore di un evento', () => {
  /** Uno spazio con un evento in corso nel canale vocale, organizzato da chi si dice. */
  async function conEvento(capo, organizzatore, spazio, canale, quando = {}) {
    const inizio = quando.inizio ?? ora() - 60;
    const corpo = {
      titolo: 'Serata',
      inizio,
      canale,
      ...(quando.fine === undefined ? {} : { fine: quando.fine }),
    };
    const r = await organizzatore.chiama(`/api/spazi/${spazio.id}/eventi`, {
      method: 'POST',
      body: JSON.stringify(corpo),
    });
    assert.equal(r.status, 201, 'evento non creato');
    return (await r.json()).evento;
  }

  it('dentro al proprio evento comanda, e la restrizione ne porta il segno', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    // Marco non amministra niente: ha soltanto "crea eventi".
    await conRuolo(capo, spazio, marco, ['createEvents']);
    const evento = await conEvento(capo, marco, spazio, voce.id);

    for (const genere of ['camera', 'condivisione', 'microfono', 'cuffie']) {
      const r = await modera(marco, voce.id, { utente: lia.utente.id, genere, attiva: true });
      assert.equal(r.status, 200, `${genere} negato all'organizzatore`);
    }

    const righe = talk.db.restrizioni.righeDi(voce.id, lia.utente.id);
    assert.equal(righe.length, 4);
    assert.ok(
      righe.every((r) => r.evento === evento.id),
      'ogni restrizione deve portare l\'evento che la regge, o non decadrebbe mai',
    );
  });

  it('fuori dalla finestra temporale non comanda niente', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await conRuolo(capo, spazio, marco, ['createEvents']);

    // Finito ieri: la tolleranza e' di un quarto d'ora, non di un giorno.
    await conEvento(capo, marco, spazio, voce.id, {
      inizio: ora() - 86400,
      fine: ora() - 86000,
    });
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      403,
      'un evento finito non conferisce niente',
    );

    // Comincia fra due ore: nemmeno.
    await conEvento(capo, marco, spazio, voce.id, { inizio: ora() + 7200 });
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      403,
      'un evento di domani non conferisce niente oggi',
    );
  });

  it('un evento in un altro canale non da\' poteri qui', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await conRuolo(capo, spazio, marco, ['createEvents', 'createVoiceChannels']);

    const { canale: altro } = await corpoDi(
      await capo.chiama(`/api/spazi/${spazio.id}/canali`, {
        method: 'POST',
        body: JSON.stringify({ nome: 'seconda-stanza', tipo: 'voce' }),
      }),
    );

    await conEvento(capo, marco, spazio, altro.id);
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      403,
      'i poteri valgono solo nel canale dell\'evento',
    );
    assert.equal(
      (await modera(marco, altro.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      200,
    );
  });

  it('un evento annullato, o senza canale, non conferisce niente', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await conRuolo(capo, spazio, marco, ['createEvents']);

    const evento = await conEvento(capo, marco, spazio, voce.id);
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      200,
    );

    const annullato = await marco.chiama(`/api/spazi/${spazio.id}/eventi/${evento.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ stato: 'annullato' }),
    });
    assert.ok(annullato.ok);

    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'cuffie', attiva: true }))
        .status,
      403,
      'annullare un evento e\' il modo di dire che quella serata non si fa',
    );

    // E senza canale nemmeno: "in tutte le stanze" non e' una risposta.
    const senzaCanale = await marco.chiama(`/api/spazi/${spazio.id}/eventi`, {
      method: 'POST',
      body: JSON.stringify({ titolo: 'Ovunque', inizio: ora() - 60 }),
    });
    assert.equal(senzaCanale.status, 201);
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'cuffie', attiva: true }))
        .status,
      403,
    );
  });

  it('non si usa contro chi nello spazio sta piu\' in alto', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    await conRuolo(capo, spazio, marco, ['createEvents']);
    await conEvento(capo, marco, spazio, voce.id);

    // Il proprietario dello spazio: senza questo vincolo "crea eventi"
    // diventerebbe la strada per zittire il padrone di casa.
    const contro = await modera(marco, voce.id, {
      utente: capo.utente.id,
      genere: 'microfono',
      attiva: true,
    });
    assert.equal(contro.status, 403);

    // E chi ha manageEvents, che sull'agenda comanda piu' di lui.
    await conRuolo(capo, spazio, lia, ['manageEvents']);
    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      403,
    );
  });

  it('non delega: il permesso di creare eventi non basta se l\'evento e\' di un altro', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const nina = await accesso(talk, base, { nome: 'Nina', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    for (const chi of [marco, lia, nina]) {
      await chi.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    }

    await conRuolo(capo, spazio, marco, ['createEvents']);
    await conRuolo(capo, spazio, lia, ['createEvents'], 40);
    await conEvento(capo, marco, spazio, voce.id);

    // Lia ha lo stesso permesso di Marco e sta nel canale dell'evento, ma
    // l'evento non e' suo: i poteri sono di chi lo ha creato e non si passano.
    assert.equal(
      (await modera(lia, voce.id, { utente: nina.utente.id, genere: 'microfono', attiva: true }))
        .status,
      403,
    );
  });
});

describe('restrizioni vocali: durano', () => {
  it('sopravvivono all\'uscita e al rientro, e viaggiano dentro al gettone', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    const primo = await corpoDi(await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }));
    const grantLibero = grantDelGettone(primo.gettone);
    assert.equal(grantLibero.canPublish, true);
    assert.deepEqual(
      [...grantLibero.canPublishSources].sort(),
      ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
    );
    assert.notEqual(grantLibero.canSubscribe, false);
    assert.equal(primo.restrizioni.length, 0);

    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'microfono', attiva: true });
    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'condivisione', attiva: true });

    // Uscire e rientrare e' il modo piu' ovvio di provare ad aggirare una
    // moderazione, ed e' esattamente quello che non deve funzionare: il
    // gettone nuovo nasce gia' con le restrizioni dentro.
    const secondo = await corpoDi(
      await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    const grant = grantDelGettone(secondo.gettone);
    assert.deepEqual([...grant.canPublishSources].sort(), ['camera']);
    assert.equal(grant.canPublish, true, 'la camera gli resta');
    assert.notEqual(grant.canSubscribe, false, 'le cuffie non gliele ha tolte nessuno');

    assert.equal(secondo.restrizioni.length, 2);
    assert.equal(
      secondo.restrizioni.find((r) => r.genere === 'microfono').da.nome,
      'Capo',
      'chi la subisce deve poter leggere chi gliel\'ha messa',
    );
  });

  it('le cuffie forzate tolgono la sottoscrizione, non il volume', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'cuffie', attiva: true });

    const dentro = await corpoDi(
      await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    const grant = grantDelGettone(dentro.gettone);
    assert.equal(
      grant.canSubscribe,
      false,
      'con la sottoscrizione aperta bastano due righe di JavaScript per riascoltare tutto',
    );
    // E puo' ancora parlare: assordare non e' zittire.
    assert.equal(grant.canPublish, true);
  });

  it('un provvedimento di un evento decade quando l\'evento finisce', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await conRuolo(capo, spazio, marco, ['createEvents']);

    const { evento } = await corpoDi(
      await marco.chiama(`/api/spazi/${spazio.id}/eventi`, {
        method: 'POST',
        body: JSON.stringify({ titolo: 'Serata', inizio: ora() - 60, canale: voce.id }),
      }),
    );

    assert.equal(
      (await modera(marco, voce.id, { utente: lia.utente.id, genere: 'microfono', attiva: true }))
        .status,
      200,
    );
    assert.equal(talk.db.restrizioni.di(voce.id, lia.utente.id).size, 1);

    // L'evento viene spostato nel passato: chiuso. Non serve aspettare quattro
    // ore per provarlo, serve che la regola guardi l'orologio.
    await capo.chiama(`/api/spazi/${spazio.id}/eventi/${evento.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ inizio: ora() - 86400, fine: ora() - 86000 }),
    });

    const cadute = await talk.moderazione.spazzaScadute();
    assert.equal(cadute, 1);
    assert.equal(talk.db.restrizioni.di(voce.id, lia.utente.id).size, 0);

    // E il gettone torna completo.
    const dentro = await corpoDi(
      await lia.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    assert.deepEqual(
      [...grantDelGettone(dentro.gettone).canPublishSources].sort(),
      ['camera', 'microphone', 'screen_share', 'screen_share_audio'],
    );
  });

  it('una restrizione di un amministratore non scade da sola', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'camera', attiva: true });
    assert.equal(await talk.moderazione.spazzaScadute(), 0);
    assert.equal(talk.db.restrizioni.di(voce.id, marco.utente.id).size, 1);
  });
});

describe('espellere dalla stanza', () => {
  it("lo puo' anche l'organizzatore, dentro al suo evento, e non contro chi sta sopra", async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const lia = await accesso(talk, base, { nome: 'Lia', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });
    await lia.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    const caccia = (chi, bersaglio) =>
      chi.chiama(`/api/canali/${voce.id}/caccia`, {
        method: 'POST',
        body: JSON.stringify({ identita: `u${bersaglio}` }),
      });

    // Prima dell'evento: Marco non e' nessuno.
    assert.equal((await caccia(marco, lia.utente.id)).status, 403);

    await conRuolo(capo, spazio, marco, ['createEvents']);
    const creato = await marco.chiama(`/api/spazi/${spazio.id}/eventi`, {
      method: 'POST',
      body: JSON.stringify({ titolo: 'Serata', inizio: ora() - 60, canale: voce.id }),
    });
    assert.equal(creato.status, 201);

    // Adesso si': chi puo' togliere il microfono deve poter anche mandare
    // fuori, che e' il provvedimento piu' lieve dei due.
    //
    // 502 e non 200 perche' qui la SFU non c'e' — cacciare qualcuno lo fa lei,
    // non noi — e cio' che si sta provando e' che l'autorizzazione passa: un
    // 403 vorrebbe dire fermato prima, un 502 vuol dire arrivato fino in fondo.
    assert.equal((await caccia(marco, lia.utente.id)).status, 502);

    // Ma non contro il proprietario dello spazio.
    assert.equal((await caccia(marco, capo.utente.id)).status, 403);
    // Ne' contro se stesso: per uscire c'e' il pulsante "esci".
    assert.equal((await caccia(marco, marco.utente.id)).status, 400);
  });

  it("un'identita' che non e' un utente si prende 400", async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const { voce } = await conSpazio(capo.chiama);

    const r = await capo.chiama(`/api/canali/${voce.id}/caccia`, {
      method: 'POST',
      body: JSON.stringify({ identita: 'nonSonoUnUtente' }),
    });
    assert.equal(r.status, 400);
  });
});

describe("cosa dichiara l'ingresso", () => {
  it("i poteri di moderazione ci sono, e ci sta dentro l'organizzatore", async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    const semplice = await corpoDi(
      await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    assert.equal(semplice.permessi.moderatore, false);
    assert.equal(semplice.permessi.puoZittire, false);
    assert.equal(semplice.permessi.puoAssordare, false);

    // Il proprietario ha tutto per costruzione.
    const padrone = await corpoDi(
      await capo.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    assert.equal(padrone.permessi.moderatore, true);
    assert.equal(padrone.permessi.puoZittire, true);
    assert.equal(padrone.permessi.puoAssordare, true);

    // E l'organizzatore, dentro al suo evento, li vede comparire senza avere
    // nessun permesso di moderazione nello spazio: senza questo, le voci del
    // menu non gli si disegnerebbero e i poteri che ha davvero resterebbero
    // invisibili.
    await conRuolo(capo, spazio, marco, ['createEvents']);
    await marco.chiama(`/api/spazi/${spazio.id}/eventi`, {
      method: 'POST',
      body: JSON.stringify({ titolo: 'Serata', inizio: ora() - 60, canale: voce.id }),
    });

    const organizza = await corpoDi(
      await marco.chiama(`/api/canali/${voce.id}/entra`, { method: 'POST' }),
    );
    assert.equal(organizza.permessi.moderatore, true);
    assert.equal(organizza.permessi.puoZittire, true);
    assert.equal(organizza.permessi.puoAssordare, true);
  });
});

describe('restrizioni vocali: cosa si legge', () => {
  it('l\'elenco del canale le mostra raggruppate per persona', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'camera', attiva: true });
    await modera(capo, voce.id, { utente: marco.utente.id, genere: 'cuffie', attiva: true });

    const { restrizioni } = await corpoDi(await marco.chiama(`/api/canali/${voce.id}/restrizioni`));
    assert.equal(restrizioni.length, 1);
    assert.equal(restrizioni[0].utente, marco.utente.id);
    assert.deepEqual(restrizioni[0].sue.map((r) => r.genere).sort(), ['camera', 'cuffie']);
  });

  it('un provvedimento inventato o un corpo storto si prendono 400', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const marco = await accesso(talk, base, { nome: 'Marco', ruolo: 'membro' });
    const { spazio, voce } = await conSpazio(capo.chiama);
    await marco.chiama(`/api/spazi/${spazio.id}/entra`, { method: 'POST' });

    assert.equal(
      (await modera(capo, voce.id, { utente: marco.utente.id, genere: 'telepatia', attiva: true }))
        .status,
      400,
    );
    // "accendi la camera di un altro" non esiste come provvedimento, e non
    // esiste di proposito: non c'e' nessun permesso che lo conceda, a nessuno.
    assert.equal(
      (await modera(capo, voce.id, { utente: marco.utente.id, genere: 'cameraAccesa', attiva: true }))
        .status,
      400,
    );
    assert.equal(
      (await modera(capo, voce.id, { utente: marco.utente.id, genere: 'microfono' })).status,
      400,
      'serve dire se imporre o togliere',
    );
  });
});

describe('il feed degli aggiornamenti', () => {
  it("un latest.yml che non c'e' torna 404, non la pagina dell'applicazione", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-feed-'));
    const pubblica = join(dir, 'public');
    const aggiornamenti = join(dir, 'aggiornamenti');
    mkdirSync(pubblica, { recursive: true });
    mkdirSync(aggiornamenti, { recursive: true });
    // Con questo file esiste il ripiego della pagina singola, che e' proprio
    // quello che si mangiava la richiesta. Senza, questa prova non proverebbe
    // niente — ed e' il motivo per cui il difetto non si e' visto prima:
    // durante i test `public/` e' vuota.
    writeFileSync(join(pubblica, 'index.html'), '<!doctype html><title>PulseTalk</title>');

    const config = leggiConfig({
      TALK_ROOT: dir,
      TALK_PUBLIC: pubblica,
      TALK_AGGIORNAMENTI: aggiornamenti,
      SFU_API_KEY: 'chiave-di-prova',
      SFU_API_SECRET: SEGRETO,
      SFU_URL: 'wss://sfu.esempio.it',
      SFU_API_URL: 'http://127.0.0.1:1',
      TALK_LOG_LEVEL: 'silent',
    });
    const talk = await creaTalk(config);
    const porta = await ascoltaSuPortaBuona(talk.app);
    const base = `http://127.0.0.1:${porta}`;

    t.after(async () => {
      talk.chiamate.spegni();
      await talk.app.close();
      talk.db.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* niente */
      }
    });

    const feed = await fetch(`${base}/aggiornamenti/latest.yml`);
    assert.equal(feed.status, 404, "un manifesto che non c'e' non e' una pagina");
    assert.doesNotMatch(
      await feed.text(),
      /<!doctype html/i,
      'electron-updater proverebbe a leggerlo come YAML e morirebbe con un errore incomprensibile',
    );

    // E il ripiego per le pagine vere deve continuare a funzionare: ricaricare
    // /spazio/casa deve dare la pagina, non un 404.
    const pagina = await fetch(`${base}/spazio/casa`);
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /<!doctype html/i);

    // Un file che c'e' davvero si scarica.
    writeFileSync(join(aggiornamenti, 'latest.yml'), 'version: 9.9.9\n');
    const vero = await fetch(`${base}/aggiornamenti/latest.yml`);
    assert.equal(vero.status, 200);
    assert.match(await vero.text(), /version: 9\.9\.9/);
  });
});

describe("un database gia' esistente", () => {
  it("la tabella nasce su un database che non ce l'aveva, e i dati restano", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-mig-restr-'));
    const percorso = join(dir, 'talk.db');
    t.after(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* niente */
      }
    });

    const { TalkDb } = await import('../src/db.mjs');

    // Un database come quello di chi aggiorna: pieno di roba, e senza la
    // tabella nuova. Si costruisce con il codice di adesso e poi le si toglie
    // la tabella — e' il modo piu' fedele di rifare "com'era prima" senza
    // portarsi dietro una copia dello schema vecchio che nessuno aggiornerebbe.
    const prima = new TalkDb(percorso);
    const codice = prima.creaInvito({ nome: "Chi C'era", ruolo: 'admin' });
    assert.ok(codice);
    prima.sql.exec('DROP TABLE restrizioni_voce');
    assert.equal(
      prima.sql
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'restrizioni_voce'")
        .get(),
      undefined,
    );
    const invitiPrima = prima.sql.prepare('SELECT COUNT(*) AS q FROM inviti').get().q;
    assert.ok(invitiPrima > 0);
    prima.close();

    // E adesso il codice nuovo apre quel file.
    const dopo = new TalkDb(percorso);
    assert.ok(
      dopo.sql
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'restrizioni_voce'")
        .get(),
      'la tabella deve nascere da sola',
    );
    assert.ok(
      dopo.sql
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_restrizioni_canale'")
        .get(),
      'e con i suoi indici',
    );
    assert.equal(
      dopo.sql.prepare('SELECT COUNT(*) AS q FROM inviti').get().q,
      invitiPrima,
      "e non deve perdere niente di quello che c'era",
    );
    dopo.close();

    // Riaprirlo ancora non deve fare niente: una migrazione che non e'
    // idempotente si scopre al secondo avvio, cioe' in produzione.
    const terza = new TalkDb(percorso);
    assert.equal(terza.sql.prepare('SELECT COUNT(*) AS q FROM inviti').get().q, invitiPrima);
    assert.equal(terza.restrizioni.delCanale(1).length, 0);
    terza.close();
  });
});

describe('la finestra di un evento', () => {
  it('un evento senza fine dura al massimo il tetto dichiarato', () => {
    const inizio = 1_000_000;
    const finestra = finestraEvento({ inizio, fine: null, canale: 7, stato: 'programmato' });
    assert.equal(finestra.da, inizio - TOLLERANZA_EVENTO);
    assert.equal(finestra.a, inizio + DURATA_MASSIMA_EVENTO + TOLLERANZA_EVENTO);

    assert.equal(eventoInCorso({ inizio, fine: null, canale: 7 }, inizio + 60), true);
    assert.equal(
      eventoInCorso({ inizio, fine: null, canale: 7 }, inizio + DURATA_MASSIMA_EVENTO + 3600),
      false,
      'senza tetto sarebbe un\'amministrazione a tempo indeterminato',
    );
  });

  it('una fine lunghissima non scavalca il tetto', () => {
    const inizio = 1_000_000;
    const finestra = finestraEvento({
      inizio,
      fine: inizio + 30 * 86400,
      canale: 7,
      stato: 'programmato',
    });
    assert.equal(finestra.a, inizio + DURATA_MASSIMA_EVENTO + TOLLERANZA_EVENTO);
  });

  it('annullato o senza canale non vale niente', () => {
    const inizio = Math.floor(Date.now() / 1000);
    assert.equal(finestraEvento({ inizio, canale: 7, stato: 'annullato' }), null);
    assert.equal(finestraEvento({ inizio, canale: null, stato: 'programmato' }), null);
    assert.equal(finestraEvento(null), null);
  });
});

describe('i permessi che finiscono nel gettone', () => {
  it('senza restrizioni consente tutto, per esteso e non per omissione', () => {
    const p = permessiPartecipante({});
    assert.equal(p.canPublish, true);
    assert.equal(p.canSubscribe, true);
    // Per esteso e non lista vuota: per LiveKit una lista vuota vuol dire
    // "tutte", e sarebbe la stessa cosa oggi e una trappola domani.
    assert.equal(p.canPublishSources.length, 4);
  });

  it('ogni restrizione toglie la sua sorgente, e le cuffie tolgono l\'ascolto', () => {
    const senzaCamera = permessiPartecipante({ restrizioni: new Set(['camera']) });
    assert.equal(senzaCamera.canPublishSources.length, 3);

    const senzaSchermo = permessiPartecipante({ restrizioni: new Set(['condivisione']) });
    assert.equal(
      senzaSchermo.canPublishSources.length,
      2,
      'lo schermo e il suo audio sono una cosa sola',
    );

    const sordo = permessiPartecipante({ restrizioni: new Set(['cuffie']) });
    assert.equal(sordo.canSubscribe, false);
    assert.equal(sordo.canPublish, true, 'assordare non e\' zittire');
  });

  it('senza il permesso di condividere lo schermo non entra nel gettone', () => {
    const p = permessiPartecipante({ puoCondividere: false });
    assert.equal(p.canPublishSources.length, 2);
  });

  it('a chi non puo\' trasmettere non resta niente da pubblicare', () => {
    const p = permessiPartecipante({ puoTrasmettere: false });
    assert.equal(p.canPublish, false);

    // E quando le restrizioni tolgono tutto: `canPublish` deve spegnersi, o la
    // lista vuota tornerebbe a significare "tutte".
    const tolto = permessiPartecipante({
      puoCondividere: false,
      restrizioni: new Set(['camera', 'microfono']),
    });
    assert.equal(tolto.canPublishSources.length, 0);
    assert.equal(tolto.canPublish, false);
  });
});
