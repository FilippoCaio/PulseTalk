// Le chiavi dei servizi esterni, scritte da dentro invece che da SSH.
//
// Quello che questi test difendono non e' "il campo si salva": e' che il
// pannello non possa fare danni. Un modulo web che scrive nella configurazione
// del server ha due modi di andare male, e sono tutti e due silenziosi — lascia
// scrivere cose che non dovrebbe, o accetta un valore che al riavvio successivo
// impedisce l'avvio. Il resto sono dettagli.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { leggiConfig } from '../src/config.mjs';
import {
  CAMPI_ISTANZA,
  CATEGORIE_ISTANZA,
  GRUPPI_ISTANZA,
} from '../src/impostazioni-istanza.mjs';
import { creaTalk } from '../src/server.mjs';
import { ascoltaSuPortaBuona } from './porta.mjs';

const SEGRETO = 'p'.repeat(40);
const PASSWORD = 'una-password-lunga';

async function conServer(t, ambiente = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-imp-'));
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

  return { talk, base, env };
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

async function accesso(talk, base, { nome, ruolo }) {
  const codice = talk.db.creaInvito({ nome, ruolo });
  const r = await fetch(`${base}/api/auth/riscatta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      codice,
      utente: nome.toLowerCase(),
      password: PASSWORD,
      nome,
    }),
  });
  assert.equal(r.status, 200, `riscatto fallito per ${nome}`);
  const corpo = await r.json();
  return { ...corpo, chiama: conToken(base, corpo.token) };
}

describe('impostazioni dell\'istanza', () => {
  it('le vede e le scrive solo chi amministra', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });

    assert.equal((await capo.chiama('/api/admin/impostazioni')).status, 200);
    assert.equal((await tale.chiama('/api/admin/impostazioni')).status, 403);

    const scritto = await tale.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_AI_API_KEY: 'mia' } }),
    });
    assert.equal(scritto.status, 403);
  });

  it('accende la trascrizione senza toccare il container', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const prima = await (await capo.chiama('/api/servizi')).json();
    assert.equal(prima.ai.stt, false, 'senza chiave la trascrizione e\' spenta');

    const dopo = await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({
        impostazioni: { TALK_AI_API_KEY: 'sk-finta-ma-lunga', TALK_AI_STT_MODEL: 'gpt-transcribe' },
      }),
    });
    assert.equal(dopo.status, 200);

    // La verifica vera: la rotta che *serve i client* dice di si', il che vuol
    // dire che i provider sono stati rifatti e non e' rimasto in giro quello
    // costruito all'avvio con la chiave vuota.
    const adesso = await (await capo.chiama('/api/servizi')).json();
    assert.equal(adesso.ai.stt, true);
    assert.equal(adesso.ai.chat, false, 'senza modello di chat resta spenta solo quella');
  });

  it('non rimanda mai indietro una chiave, solo la sua coda', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_AI_API_KEY: 'sk-segretissima-1234' } }),
    });

    const stato = await (await capo.chiama('/api/admin/impostazioni')).json();
    const campo = stato.campi.find((c) => c.chiave === 'TALK_AI_API_KEY');
    assert.equal(campo.valore, '', 'la chiave non deve tornare in chiaro');
    assert.equal(campo.coda, '1234');
    assert.equal(campo.impostata, true);
    assert.equal(campo.origine, 'pannello');
    assert.equal(JSON.stringify(stato).includes('segretissima'), false);
  });

  it('rifiuta un valore che impedirebbe l\'avvio, invece di salvarlo', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const r = await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_AI_CHIAVI: 'chiunque' } }),
    });
    assert.equal(r.status, 400);

    // E soprattutto: non deve essere finito in tabella. Se ci finisse, il
    // prossimo avvio troverebbe una configurazione che non si legge.
    assert.equal(talk.db.impostazioniIstanza().TALK_AI_CHIAVI, undefined);
  });

  it('rifiuta un mittente di posta storto, che fallirebbe in silenzio', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    // Un mittente senza indirizzo dentro non da' errore al salvataggio ne'
    // all'avvio: da' un relay che accetta il collegamento e poi rifiuta ogni
    // messaggio. Chi aspetta il codice non riceve niente, e nessuno ha visto
    // un errore. Va fermato qui, mentre il pannello e' ancora aperto.
    for (const storto of ['nessun-indirizzo', 'PulseTalk <>', 'due @@ chiocciole']) {
      const r = await capo.chiama('/api/admin/impostazioni', {
        method: 'PUT',
        body: JSON.stringify({ impostazioni: { TALK_SMTP_MITTENTE: storto } }),
      });
      assert.equal(r.status, 400, `"${storto}" non doveva essere accettato`);
      assert.equal(talk.db.impostazioniIstanza().TALK_SMTP_MITTENTE, undefined);
    }

    // Le due forme buone passano entrambe: l'indirizzo nudo e quello col nome.
    for (const buono of ['talk@esempio.it', 'PulseTalk <talk@esempio.it>']) {
      const r = await capo.chiama('/api/admin/impostazioni', {
        method: 'PUT',
        body: JSON.stringify({ impostazioni: { TALK_SMTP_MITTENTE: buono } }),
      });
      assert.equal(r.status, 200, `"${buono}" doveva essere accettato`);
    }
  });

  it('la posta risulta spenta finche\' non ci sono server e mittente', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const capacita = async () => (await (await capo.chiama('/api/admin/impostazioni')).json()).capacita.posta;
    assert.equal(await capacita(), false);

    // Solo l'host non basta: senza mittente non si puo' spedire, e dichiararsi
    // accesi a meta' vorrebbe dire offrire il recupero password e poi fallire.
    await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_SMTP_HOST: 'smtp.esempio.it' } }),
    });
    assert.equal(await capacita(), false);

    await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_SMTP_MITTENTE: 'talk@esempio.it' } }),
    });
    assert.equal(await capacita(), true);
  });

  it('non lascia scrivere cio' + '\' che non e\' del pannello', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    for (const chiave of ['SFU_API_SECRET', 'TALK_ROOT', 'TALK_NO_AUTH']) {
      const r = await capo.chiama('/api/admin/impostazioni', {
        method: 'PUT',
        body: JSON.stringify({ impostazioni: { [chiave]: 'x' } }),
      });
      assert.equal(r.status, 400, `${chiave} non deve essere scrivibile da qui`);
    }
  });

  it('svuotare un campo fa riemergere quello del container', async (t) => {
    const { talk, base } = await conServer(t, { TALK_AI_STT_MODEL: 'whisper-1' });
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const daContainer = await (await capo.chiama('/api/admin/impostazioni')).json();
    const prima = daContainer.campi.find((c) => c.chiave === 'TALK_AI_STT_MODEL');
    assert.equal(prima.valore, 'whisper-1');
    assert.equal(prima.origine, 'container');

    await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_AI_STT_MODEL: 'gpt-transcribe' } }),
    });
    const scritto = await (await capo.chiama('/api/admin/impostazioni')).json();
    assert.equal(scritto.campi.find((c) => c.chiave === 'TALK_AI_STT_MODEL').origine, 'pannello');

    const svuotato = await capo.chiama('/api/admin/impostazioni', {
      method: 'PUT',
      body: JSON.stringify({ impostazioni: { TALK_AI_STT_MODEL: '' } }),
    });
    const dopo = await svuotato.json();
    const campo = dopo.campi.find((c) => c.chiave === 'TALK_AI_STT_MODEL');
    assert.equal(campo.valore, 'whisper-1', 'torna a valere quello del container');
    assert.equal(campo.origine, 'container');
  });

  it('sopravvivono al riavvio', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'pulsetalk-riavvio-'));
    const env = {
      TALK_ROOT: dir,
      SFU_API_KEY: 'chiave-di-prova',
      SFU_API_SECRET: SEGRETO,
      SFU_URL: 'wss://sfu.esempio.it',
      SFU_API_URL: 'http://127.0.0.1:1',
      TALK_LOG_LEVEL: 'silent',
    };
    t.after(() => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* niente */ }
    });

    const primo = await creaTalk(leggiConfig(env), { ambiente: env });
    primo.db.scriviImpostazione('TALK_AI_API_KEY', 'sk-scritta-ieri');
    primo.db.scriviImpostazione('TALK_AI_STT_MODEL', 'gpt-transcribe');
    await primo.app.close();
    primo.db.close();

    // Un container ricreato riparte dallo stesso ambiente di prima: quello che
    // era stato scritto dal pannello deve valere ancora, senza che nessuno lo
    // ricopi nel docker-compose.
    const secondo = await creaTalk(leggiConfig(env), { ambiente: env });
    assert.equal(secondo.config.ai.apiKey, 'sk-scritta-ieri');
    assert.equal(secondo.config.ai.sttModel, 'gpt-transcribe');
    await secondo.app.close();
    secondo.db.close();
  });
});

describe('la chiave AI di ciascuno', () => {
  it('con la modalita\' istanza non c\'e\' niente da collegare', async (t) => {
    const { talk, base } = await conServer(t);
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });

    const mia = await (await tale.chiama('/api/io/ai')).json();
    assert.equal(mia.modo, 'istanza');
    assert.equal(mia.serve, false);
  });

  it('con la modalita\' utente ognuno accende la propria', async (t) => {
    const { talk, base } = await conServer(t, {
      TALK_AI_CHIAVI: 'utente',
      TALK_AI_STT_MODEL: 'gpt-transcribe',
    });
    const uno = await accesso(talk, base, { nome: 'Uno', ruolo: 'membro' });
    const due = await accesso(talk, base, { nome: 'Due', ruolo: 'membro' });

    const prima = await (await uno.chiama('/api/io/ai')).json();
    assert.equal(prima.serve, true);
    assert.equal(prima.collegata, false);
    assert.equal(prima.capacita.stt, false);

    const scritto = await uno.chiama('/api/io/ai', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-di-uno-1234' }),
    });
    assert.equal(scritto.status, 200);
    const dopo = await scritto.json();
    assert.equal(dopo.collegata, true);
    assert.equal(dopo.coda, '1234');
    assert.equal(dopo.capacita.stt, true, 'la sua chiave accende la trascrizione per lui');

    // E per nessun altro: e' tutto il senso della modalita'.
    const altro = await (await due.chiama('/api/io/ai')).json();
    assert.equal(altro.collegata, false);
    assert.equal(altro.capacita.stt, false);
  });

  it('la chiave di uno non si legge, nemmeno dal suo padrone', async (t) => {
    const { talk, base } = await conServer(t, { TALK_AI_CHIAVI: 'utente' });
    const uno = await accesso(talk, base, { nome: 'Uno', ruolo: 'membro' });

    await uno.chiama('/api/io/ai', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-riservatissima-9876' }),
    });

    const mia = await (await uno.chiama('/api/io/ai')).json();
    assert.equal(JSON.stringify(mia).includes('riservatissima'), false);
    assert.equal(mia.coda, '9876');
  });

  it('in modalita\' mista si ricade su quella di casa', async (t) => {
    const { talk, base } = await conServer(t, {
      TALK_AI_CHIAVI: 'mista',
      TALK_AI_API_KEY: 'sk-di-casa',
      TALK_AI_STT_MODEL: 'gpt-transcribe',
    });
    const tale = await accesso(talk, base, { nome: 'Tale', ruolo: 'membro' });

    const senza = await (await tale.chiama('/api/io/ai')).json();
    assert.equal(senza.collegata, false);
    assert.equal(senza.capacita.stt, true, 'senza la propria, vale quella del server');
  });

  it('scollegare la propria la toglie davvero', async (t) => {
    const { talk, base } = await conServer(t, {
      TALK_AI_CHIAVI: 'utente',
      TALK_AI_STT_MODEL: 'gpt-transcribe',
    });
    const uno = await accesso(talk, base, { nome: 'Uno', ruolo: 'membro' });

    await uno.chiama('/api/io/ai', { method: 'PUT', body: JSON.stringify({ apiKey: 'sk-mia-1111' }) });
    const dopo = await (await uno.chiama('/api/io/ai', { method: 'DELETE' })).json();
    assert.equal(dopo.collegata, false);
    assert.equal(dopo.capacita.stt, false);
  });
});

// Il pannello e' guidato dai dati: le categorie, i gruppi e i campi arrivano
// dal catalogo e il modulo li disegna cosi' come sono. Vuol dire che un id
// scritto storto non rompe niente all'avvio — fa sparire in silenzio un campo
// da una pagina, ed e' il tipo di guasto che si scopre il giorno in cui serve
// quel campo. Questi test sono il controllo che nessuno resti orfano.
describe('il catalogo delle impostazioni sta in piedi', () => {
  it('ogni campo sta in un gruppo che esiste, o e\' un interruttore di categoria', () => {
    const gruppi = new Set(GRUPPI_ISTANZA.map((g) => g.id));
    const interruttori = new Set(
      CATEGORIE_ISTANZA.filter((c) => c.personale).map((c) => c.personale.chiave),
    );

    for (const campo of CAMPI_ISTANZA) {
      if (campo.gruppo === null) {
        assert.ok(
          interruttori.has(campo.chiave),
          `${campo.chiave} non ha gruppo e non e' l'interruttore di nessuna categoria: non lo disegnerebbe nessuno`,
        );
        continue;
      }
      assert.ok(gruppi.has(campo.gruppo), `${campo.chiave} punta al gruppo inesistente «${campo.gruppo}»`);
    }
  });

  it('ogni gruppo sta in una categoria che esiste, e non e\' vuoto', () => {
    const categorie = new Set(CATEGORIE_ISTANZA.map((c) => c.id));
    for (const gruppo of GRUPPI_ISTANZA) {
      assert.ok(
        categorie.has(gruppo.categoria),
        `il gruppo «${gruppo.id}» punta alla categoria inesistente «${gruppo.categoria}»`,
      );
      const dentro = CAMPI_ISTANZA.filter((c) => c.gruppo === gruppo.id);
      assert.ok(dentro.length > 0, `il gruppo «${gruppo.id}» non ha campi: sarebbe un titolo e basta`);
    }
  });

  it('ogni categoria dice se la chiave personale ha senso, oppure perche\' no', () => {
    for (const categoria of CATEGORIE_ISTANZA) {
      const quante = [categoria.personale, categoria.senzaPersonale].filter(Boolean).length;
      assert.equal(
        quante,
        1,
        `«${categoria.id}» deve avere o «personale» o «senzaPersonale», non ${quante}: ` +
          'un interruttore che manca senza spiegazione e\' una domanda che torna ogni sei mesi',
      );
      assert.ok(
        GRUPPI_ISTANZA.some((g) => g.categoria === categoria.id),
        `la categoria «${categoria.id}» non ha gruppi: sarebbe una pagina vuota`,
      );
    }
  });

  it('l\'interruttore di una categoria e\' un campo vero, con dentro tutti i suoi valori', () => {
    for (const { id, personale } of CATEGORIE_ISTANZA) {
      if (!personale) continue;
      const campo = CAMPI_ISTANZA.find((c) => c.chiave === personale.chiave);
      assert.ok(campo, `«${id}» punta al campo inesistente «${personale.chiave}»`);
      assert.equal(campo.tipo, 'scelta', `«${personale.chiave}» deve essere una scelta`);

      // Se un modo non e' fra i valori ammessi, l'interruttore scrive qualcosa
      // che `leggiConfig` rifiuta: il pannello direbbe "non si puo' salvare"
      // su una cosa che l'interfaccia stessa ha proposto.
      const ammessi = new Set(campo.valori ?? []);
      const usati = [personale.spento, ...personale.acceso.map((m) => m.valore)];
      for (const valore of usati) {
        assert.ok(ammessi.has(valore), `«${valore}» non e' fra i valori di ${personale.chiave}`);
      }
      assert.ok(personale.acceso.length > 0, `«${id}» acceso non porta da nessuna parte`);
    }
  });

  it('la rotta manda categorie e gruppi, non solo i campi', async (t) => {
    const { talk, base } = await conServer(t);
    const capo = await accesso(talk, base, { nome: 'Capo', ruolo: 'admin' });

    const stato = await (await capo.chiama('/api/admin/impostazioni')).json();
    assert.ok(Array.isArray(stato.categorie) && stato.categorie.length > 0);
    assert.ok(Array.isArray(stato.gruppi) && stato.gruppi.length > 0);

    // Ogni campo dev'essere raggiungibile da una pagina del pannello: o dentro
    // a un gruppo, o come interruttore di una categoria.
    const gruppi = new Map(stato.gruppi.map((g) => [g.id, g.categoria]));
    for (const campo of stato.campi) {
      const dove = campo.gruppo
        ? gruppi.get(campo.gruppo)
        : stato.categorie.find((c) => c.personale?.chiave === campo.chiave)?.id;
      assert.ok(dove, `${campo.chiave} non finisce in nessuna pagina`);
    }
  });
});
