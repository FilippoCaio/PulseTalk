// Spedire un messaggio breve, contro un server di posta finto.
//
// Quello che questi test difendono non e' "la mail parte": e' il dialogo. SMTP
// e' un protocollo a righe, e i modi di sbagliarlo sono tutti silenziosi — si
// legge una risposta su piu' righe come se fossero due, si perde il saluto
// perche' arriva prima che qualcuno lo aspetti, si crede di essere passati a
// TLS quando si sta ancora scrivendo in chiaro. Nessuno di questi da' errore:
// danno "a volte non parte", che e' il guasto peggiore da inseguire.
//
// Il server finto e' venti righe di node:net e registra cosa ha ricevuto,
// cosi' le prove guardano il dialogo vero invece del valore di ritorno.

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';

import { creaPosta, indirizzoValido } from '../src/posta.mjs';

/**
 * Un server SMTP che dice sempre di si'.
 *
 * `copione` permette di cambiare cosa risponde a un comando: e' cosi' che si
 * provano il rifiuto dell'autenticazione e le risposte su piu' righe, senza
 * dover installare niente.
 */
function serverFinto({ capacita = ['SIZE 10240000'], copione = {} } = {}) {
  const ricevuto = [];
  let inDati = false;

  const server = createServer((presa) => {
    presa.setEncoding('utf8');
    presa.write('220 posta.esempio.it pronto\r\n');

    let avanzo = '';
    presa.on('data', (pezzo) => {
      avanzo += pezzo;
      for (;;) {
        const taglio = avanzo.indexOf('\r\n');
        if (taglio === -1) return;
        const riga = avanzo.slice(0, taglio);
        avanzo = avanzo.slice(taglio + 2);

        if (inDati) {
          ricevuto.push(riga);
          if (riga === '.') {
            inDati = false;
            presa.write('250 preso in carico\r\n');
          }
          continue;
        }

        ricevuto.push(riga);
        const comando = riga.split(' ')[0].toUpperCase();

        if (copione[comando]) {
          presa.write(copione[comando]);
          continue;
        }

        if (comando === 'EHLO') {
          // Di proposito su piu' righe: e' la forma che un lettore ingenuo
          // conta male, e la ragione per cui questo test esiste.
          const righe = capacita.map((c) => `250-${c}`).join('\r\n');
          presa.write(`250-posta.esempio.it\r\n${righe ? `${righe}\r\n` : ''}250 OK\r\n`);
        } else if (comando === 'DATA') {
          inDati = true;
          presa.write('354 avanti\r\n');
        } else if (comando === 'QUIT') {
          presa.write('221 arrivederci\r\n');
          presa.end();
        } else {
          presa.write('250 OK\r\n');
        }
      }
    });
    presa.on('error', () => {});
  });

  return {
    ricevuto,
    ascolta() {
      return new Promise((risolvi) => {
        server.listen(0, '127.0.0.1', () => risolvi(server.address().port));
      });
    },
    chiudi() {
      return new Promise((risolvi) => server.close(risolvi));
    },
  };
}

function postaVerso(porta, extra = {}) {
  return creaPosta({
    posta: {
      host: '127.0.0.1',
      porta,
      utente: '',
      password: '',
      mittente: 'PulseTalk <talk@esempio.it>',
      tls: false,
      ...extra,
    },
  });
}

describe('posta', () => {
  it('non e\' disponibile senza host e mittente', () => {
    assert.equal(creaPosta({}).disponibile, false);
    assert.equal(creaPosta({ posta: { host: 'a.b' } }).disponibile, false);
    assert.equal(creaPosta({ posta: { host: 'a.b', mittente: 'x@y.z' } }).disponibile, true);
  });

  it('rifiuta di spedire quando non e\' configurata', async () => {
    await assert.rejects(
      () => creaPosta({}).invia({ a: 'chi@esempio.it', oggetto: 'x', testo: 'y' }),
      /non e' configurata/,
    );
  });

  it('porta a termine il dialogo e consegna il messaggio', async (t) => {
    const finto = serverFinto();
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    await postaVerso(porta).invia({
      a: 'chi@esempio.it',
      oggetto: 'Il tuo codice',
      testo: 'Il codice e 123456.',
    });

    const dialogo = finto.ricevuto;
    assert.ok(dialogo.some((r) => r.startsWith('EHLO')), 'manca EHLO');
    assert.ok(dialogo.includes('MAIL FROM:<talk@esempio.it>'), 'il mittente deve essere l\'indirizzo nudo');
    assert.ok(dialogo.includes('RCPT TO:<chi@esempio.it>'));
    assert.ok(dialogo.includes('DATA'));
    assert.ok(dialogo.includes('.'), 'il messaggio deve chiudersi con un punto su una riga sua');
  });

  it('scrive intestazioni valide e il corpo in base64', async (t) => {
    const finto = serverFinto();
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    await postaVerso(porta).invia({
      a: 'chi@esempio.it',
      oggetto: 'Perche\' non si puo\'',
      testo: 'Una riga con un accento: perche.',
    });

    const messaggio = finto.ricevuto.join('\n');
    assert.match(messaggio, /^To: <chi@esempio\.it>$/m);
    assert.match(messaggio, /^Content-Transfer-Encoding: base64$/m);
    // L'oggetto ha un apostrofo ma non caratteri fuori ASCII: resta in chiaro.
    assert.match(messaggio, /^Subject: Perche' non si puo'$/m);
  });

  it('codifica un oggetto con caratteri non inglesi', async (t) => {
    const finto = serverFinto();
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    await postaVerso(porta).invia({ a: 'chi@esempio.it', oggetto: 'Però è così', testo: 'x' });

    const messaggio = finto.ricevuto.join('\n');
    const riga = messaggio.split('\n').find((r) => r.startsWith('Subject:'));
    assert.match(riga, /^Subject: =\?UTF-8\?B\?/, 'un oggetto accentato va codificato RFC 2047');
    const dentro = riga.match(/=\?UTF-8\?B\?(.+)\?=/)[1];
    assert.equal(Buffer.from(dentro, 'base64').toString('utf8'), 'Però è così');
  });

  it('si autentica con AUTH PLAIN quando il server lo offre', async (t) => {
    const finto = serverFinto({
      capacita: ['AUTH PLAIN LOGIN'],
      copione: { AUTH: '235 autenticato\r\n' },
    });
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    await postaVerso(porta, { utente: 'tizio', password: 'segreta' }).invia({
      a: 'chi@esempio.it',
      oggetto: 'x',
      testo: 'y',
    });

    const auth = finto.ricevuto.find((r) => r.startsWith('AUTH PLAIN '));
    assert.ok(auth, 'doveva usare AUTH PLAIN');
    const decodificata = Buffer.from(auth.slice('AUTH PLAIN '.length), 'base64').toString('utf8');
    assert.equal(decodificata, '\0tizio\0segreta');
  });

  it('ripiega su AUTH LOGIN dove PLAIN non e\' dichiarato', async (t) => {
    const finto = serverFinto({
      capacita: ['AUTH LOGIN'],
      copione: { AUTH: '334 VXNlcm5hbWU6\r\n' },
    });
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    // Il server finto risponde 334 al primo passo e 250 (accettato dal
    // copione di serie) ai successivi: qui interessa solo quale via prende.
    await postaVerso(porta, { utente: 'tizio', password: 'segreta' })
      .invia({ a: 'chi@esempio.it', oggetto: 'x', testo: 'y' })
      .catch(() => {});

    assert.ok(finto.ricevuto.includes('AUTH LOGIN'), 'doveva ripiegare su AUTH LOGIN');
  });

  it('riporta il messaggio del server quando rifiuta', async (t) => {
    const finto = serverFinto({
      capacita: ['AUTH PLAIN'],
      copione: { AUTH: '535 credenziali rifiutate\r\n' },
    });
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    await assert.rejects(
      () => postaVerso(porta, { utente: 'tizio', password: 'sbagliata' })
        .invia({ a: 'chi@esempio.it', oggetto: 'x', testo: 'y' }),
      // Il testo del server deve arrivare a chi legge: "codice inatteso" no.
      /credenziali rifiutate/,
    );
  });

  it('la prova arriva fino all\'autenticazione senza spedire niente', async (t) => {
    const finto = serverFinto({ capacita: ['AUTH PLAIN'], copione: { AUTH: '235 ok\r\n' } });
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    const esito = await postaVerso(porta, { utente: 'tizio', password: 'segreta' }).prova();
    assert.equal(esito.ok, true);
    assert.ok(!finto.ricevuto.includes('DATA'), 'la prova non deve consegnare posta');
    assert.ok(!finto.ricevuto.some((r) => r.startsWith('RCPT')), 'la prova non ha un destinatario');
  });

  it('la prova avvisa quando il canale resta in chiaro', async (t) => {
    const finto = serverFinto({ capacita: ['SIZE 100'] });
    const porta = await finto.ascolta();
    t.after(() => finto.chiudi());

    const esito = await postaVerso(porta).prova();
    assert.equal(esito.ok, true);
    assert.match(esito.avviso ?? '', /in chiaro/);
  });
});

describe('indirizzoValido', () => {
  it('accetta gli indirizzi normali', () => {
    for (const buono of ['a@b.it', 'nome.cognome@posta.esempio.it', 'x+tag@d.co']) {
      assert.equal(indirizzoValido(buono), true, buono);
    }
  });

  it('scarta solo cio\' che di sicuro non e\' un indirizzo', () => {
    for (const cattivo of ['', 'senza-chiocciola', 'due@@a.it', 'con spazio@a.it', 'a@b', 'a@.b', 'a@b.']) {
      assert.equal(indirizzoValido(cattivo), false, cattivo);
    }
  });
});
