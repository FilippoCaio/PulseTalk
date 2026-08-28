// Un server SMTP che dice sempre di si', per i test.
//
// Serve a due cose diverse. In posta.test.mjs si guarda il dialogo riga per
// riga, per verificare che il client parli SMTP correttamente. Qui invece
// interessa il contenuto: le prove del recupero password devono poter leggere
// il codice che e' stato davvero spedito, invece di ripescarlo dal database —
// che proverebbe soltanto che il database contiene cio' che ci abbiamo messo.
//
// Venti righe di node:net, nessuna dipendenza, e si spegne da sola.

import { createServer } from 'node:net';

export function creaSmtpFinto({ capacita = ['SIZE 10240000'], copione = {} } = {}) {
  const ricevuto = [];
  const messaggi = [];

  const server = createServer((presa) => {
    presa.setEncoding('utf8');
    presa.write('220 posta.finta pronto\r\n');

    let avanzo = '';
    let inDati = false;
    let corpo = [];
    let destinatario = null;

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
            messaggi.push(leggi(corpo, destinatario));
            corpo = [];
            presa.write('250 preso in carico\r\n');
          } else {
            corpo.push(riga);
          }
          continue;
        }

        ricevuto.push(riga);
        const comando = riga.split(' ')[0].toUpperCase();
        if (comando === 'RCPT') destinatario = riga.match(/<([^>]*)>/)?.[1] ?? null;

        if (copione[comando]) {
          presa.write(copione[comando]);
        } else if (comando === 'EHLO') {
          const righe = capacita.map((c) => `250-${c}`).join('\r\n');
          presa.write(`250-posta.finta\r\n${righe ? `${righe}\r\n` : ''}250 OK\r\n`);
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
    messaggi,
    /** L'ultimo messaggio spedito, gia' decodificato. */
    ultimo() {
      return messaggi.at(-1) ?? null;
    },
    /**
     * Il codice dentro all'ultimo messaggio.
     *
     * Sei caratteri dell'alfabeto senza glifi ambigui, su una riga sua e
     * rientrata. Si pesca dal testo vero: e' l'unico modo di provare che il
     * codice e' arrivato a destinazione invece di essere solo stato scritto
     * da qualche parte.
     */
    codice() {
      return this.ultimo()?.testo.match(/^\s+([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})\s*$/m)?.[1] ?? null;
    },
    svuota() {
      messaggi.length = 0;
      ricevuto.length = 0;
    },
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

/** Intestazioni e corpo, con il base64 riportato in testo leggibile. */
function leggi(righe, destinatario) {
  const vuota = righe.indexOf('');
  const intestazioni = Object.fromEntries(
    righe.slice(0, vuota === -1 ? righe.length : vuota).map((r) => {
      const due = r.indexOf(':');
      return [r.slice(0, due).toLowerCase(), r.slice(due + 1).trim()];
    }),
  );

  const corpo = vuota === -1 ? [] : righe.slice(vuota + 1);
  return {
    a: destinatario,
    oggetto: decodificaIntestazione(intestazioni.subject ?? ''),
    testo: Buffer.from(corpo.join(''), 'base64').toString('utf8'),
  };
}

function decodificaIntestazione(grezzo) {
  const dentro = grezzo.match(/^=\?UTF-8\?B\?(.+)\?=$/i);
  return dentro ? Buffer.from(dentro[1], 'base64').toString('utf8') : grezzo;
}
