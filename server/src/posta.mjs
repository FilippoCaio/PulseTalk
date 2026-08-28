// posta.mjs - spedire un messaggio breve, e nient'altro.
//
// Serve per due cose sole: il codice che conferma un indirizzo e quello che
// rimette in piedi una password dimenticata. Sono messaggi di poche righe, a
// un destinatario per volta, senza allegati e senza HTML.
//
// PERCHE' SCRITTO A MANO. La regola di questa cartella e' quella di
// `password.mjs`: una libreria in piu' per una cosa delicata e' una libreria
// in piu' da tenere aggiornata per sempre. Qui la regola vale doppio, perche'
// il fabbisogno e' una frazione minuscola di SMTP — niente code, niente
// allegati, niente invii in massa — e importare un client completo
// significherebbe portarsi dentro tutto il resto per non usarlo mai.
//
// SMTP e' un protocollo a righe: si scrive un comando, si legge un numero. La
// parte che merita attenzione non e' il dialogo, sono i tre modi in cui si
// puo' sbagliare in silenzio, e stanno tutti commentati sotto: la lettura
// delle risposte su piu' righe, il passaggio a TLS, e il timeout.
//
// QUELLO CHE QUESTO MODULO NON FA. Non riprova. Se il server di posta e' giu',
// la richiesta fallisce e chi ha premuto il pulsante lo vede subito: e' molto
// meglio di una coda che ritenta per venti minuti mentre la persona davanti
// allo schermo aspetta un codice che non arriva. Chi vuole un codice nuovo
// preme di nuovo.

import { createConnection } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { hostname } from 'node:os';

/** Oltre questo, si smette di aspettare. Un server di posta lento e' un server rotto. */
const TIMEOUT_MS = 15_000;

/**
 * Il dialogo con il server, riga per riga.
 *
 * Incapsula la sola cosa di SMTP che non e' ovvia: una risposta puo' occupare
 * piu' righe, e finisce quando ne arriva una in cui al codice segue uno spazio
 * invece di un trattino. `250-STARTTLS` e' in mezzo, `250 SIZE` e' l'ultima.
 * Chi legge solo la prima riga crede che la conversazione sia avanti di un
 * passo rispetto a dove e' davvero, e da li' in poi legge ogni risposta
 * sfasata di uno — un errore che si manifesta come "a volte non parte", che e'
 * il tipo di guasto peggiore da inseguire.
 */
function creaDialogo(presa) {
  let avanzo = '';
  // Due code, e servono entrambe. Il saluto del server arriva da solo appena
  // la presa si apre, prima che qualcuno lo chieda: senza un posto dove
  // metterlo si perderebbe, e la prima `ascolta` resterebbe ferma per sempre
  // aspettando una risposta gia' arrivata.
  const ricevute = [];
  const inAttesa = [];
  let rotta = null;

  const consegna = (esito) => {
    const primo = inAttesa.shift();
    if (primo) primo(esito);
    else if (!esito.errore) ricevute.push(esito);
  };

  presa.setEncoding('utf8');
  presa.on('data', (pezzo) => {
    avanzo += pezzo;

    for (;;) {
      const righe = avanzo.split('\r\n');
      // L'ultimo elemento e' cio' che segue l'ultimo a capo: se il server ha
      // spedito mezza riga, quella meta' non e' ancora una riga. Si guarda
      // solo fra quelle terminate.
      const terminate = righe.slice(0, -1);
      // Una risposta finisce dove al codice segue uno spazio invece di un
      // trattino: `250-STARTTLS` sta in mezzo, `250 SIZE` chiude.
      const chiusa = terminate.findIndex((r) => /^\d{3} /.test(r));
      if (chiusa === -1) return;

      const blocco = terminate.slice(0, chiusa + 1);
      avanzo = righe.slice(chiusa + 1).join('\r\n');
      // Il codice e' quello della riga che chiude, non della prima: in una
      // risposta su piu' righe sono uguali, ma affidarsi a quello sbagliato
      // e' un difetto che aspetta il primo server che li fa diversi.
      consegna({ codice: Number(blocco[chiusa].slice(0, 3)), testo: blocco.join('\n') });
    }
  });

  const muori = (errore) => {
    rotta = errore;
    while (inAttesa.length) consegna({ errore });
  };

  presa.on('error', muori);
  presa.on('close', () => muori(rotta ?? new Error('il server di posta ha chiuso il collegamento')));

  return {
    /** La prossima risposta completa: quella gia' arrivata, o la prima che arrivera'. */
    ascolta() {
      const gia = ricevute.shift();
      if (gia) return Promise.resolve(gia);
      if (rotta) return Promise.reject(rotta);
      return new Promise((risolvi, rifiuta) => {
        inAttesa.push((esito) => (esito.errore ? rifiuta(esito.errore) : risolvi(esito)));
      });
    },
    /** Scrive un comando e aspetta la risposta, controllando che sia quella attesa. */
    async chiedi(comando, attesi) {
      if (comando !== null) presa.write(`${comando}\r\n`);
      const { codice, testo } = await this.ascolta();
      if (attesi && !attesi.includes(codice)) {
        // Il testo del server dentro all'errore: "535 autenticazione fallita"
        // dice cosa fare, "codice inatteso 535" no.
        throw new Error(`il server di posta ha risposto: ${testo.split('\n').pop()?.trim() ?? codice}`);
      }
      return { codice, testo };
    },
  };
}

/** Apre la presa, in chiaro o gia' cifrata. */
function apri({ host, porta, tls }) {
  return new Promise((risolvi, rifiuta) => {
    const presa = tls
      ? connectTls({ host, port: porta, servername: host }, () => risolvi(presa))
      : createConnection({ host, port: porta }, () => risolvi(presa));

    presa.setTimeout(TIMEOUT_MS, () => {
      presa.destroy(new Error(`il server di posta non ha risposto entro ${TIMEOUT_MS / 1000} secondi`));
    });
    presa.once('error', rifiuta);
  });
}

/**
 * Passa a TLS su una presa gia' aperta in chiaro.
 *
 * E' il momento delicato: si consegna la stessa presa a `tls.connect`, che ci
 * costruisce sopra il canale cifrato. Sbagliarlo non da' errore — da' una
 * sessione in chiaro su cui poi si scrive la password del mittente.
 */
function elevaATls(presa, host) {
  return new Promise((risolvi, rifiuta) => {
    const cifrata = connectTls({ socket: presa, servername: host }, () => risolvi(cifrata));
    cifrata.setTimeout(TIMEOUT_MS, () => {
      cifrata.destroy(new Error('il server di posta non ha completato il TLS in tempo'));
    });
    cifrata.once('error', rifiuta);
  });
}

/**
 * Un'intestazione che regge caratteri non inglesi.
 *
 * Le intestazioni SMTP sono ASCII. Un oggetto con una lettera accentata va
 * codificato secondo la RFC 2047, altrimenti arriva a pezzi — ed e' il genere
 * di cosa che non si nota provando in inglese.
 */
function intestazione(testo) {
  const grezzo = String(testo ?? '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(grezzo)) return grezzo;
  return `=?UTF-8?B?${Buffer.from(grezzo, 'utf8').toString('base64')}?=`;
}

/** L'indirizzo nudo, per i comandi che non vogliono il nome davanti. */
function soloIndirizzo(mittente) {
  const dentro = String(mittente).match(/<([^>]+)>/);
  return (dentro ? dentro[1] : String(mittente)).trim();
}

/**
 * Il messaggio, pronto da consegnare a DATA.
 *
 * Il corpo va in base64 e non in chiaro: cosi' nessuna riga puo' cominciare
 * con un punto — che in SMTP a inizio riga vuol dire "ho finito" — e nessuna
 * puo' superare le settantotto colonne, che e' l'altro modo silenzioso di
 * consegnare un messaggio troncato.
 */
function componi({ da, a, oggetto, testo }) {
  const corpo = Buffer.from(String(testo), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

  return [
    `From: ${da}`,
    `To: <${a}>`,
    `Subject: ${intestazione(oggetto)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    // Auto-Submitted dice ai client di posta che non c'e' nessuno a cui
    // rispondere: evita che una risposta automatica torni indietro in eterno.
    'Auto-Submitted: auto-generated',
    '',
    corpo,
  ].join('\r\n');
}

/**
 * Spedisce, e chiude.
 *
 * Una connessione per messaggio. Tenerla aperta sarebbe piu' efficiente, ma
 * qui i messaggi sono rari — qualche conferma, qualche recupero — e una presa
 * aperta a lungo verso un servizio esterno e' una cosa in piu' che puo'
 * marcire mentre nessuno guarda.
 */
async function spedisci(posta, { a, oggetto, testo }) {
  const { host, porta, utente, password, mittente, tls } = posta;
  let presa = await apri({ host, porta, tls });
  let dialogo = creaDialogo(presa);

  try {
    await dialogo.chiedi(null, [220]);

    const io = hostname() || 'pulsetalk';
    let { testo: capacita } = await dialogo.chiedi(`EHLO ${io}`, [250]);

    // STARTTLS quando non si e' partiti gia' cifrati e il server lo offre.
    // Dopo il passaggio si ripete EHLO: le capacita' dichiarate in chiaro non
    // valgono piu', e in particolare i metodi di autenticazione cambiano —
    // molti server offrono AUTH solo dopo il TLS, ed e' giusto cosi'.
    if (!tls && /STARTTLS/i.test(capacita)) {
      await dialogo.chiedi('STARTTLS', [220]);
      presa = await elevaATls(presa, host);
      dialogo = creaDialogo(presa);
      ({ testo: capacita } = await dialogo.chiedi(`EHLO ${io}`, [250]));
    }

    if (utente) {
      // AUTH PLAIN in un colpo solo dove c'e', LOGIN dove no. Non si prova
      // CRAM-MD5: e' piu' vecchio, piu' raro, e su un canale gia' cifrato non
      // aggiunge niente.
      if (/AUTH[ =-][^\n]*PLAIN/i.test(capacita)) {
        const credenziale = Buffer.from(`\0${utente}\0${password}`, 'utf8').toString('base64');
        await dialogo.chiedi(`AUTH PLAIN ${credenziale}`, [235]);
      } else {
        await dialogo.chiedi('AUTH LOGIN', [334]);
        await dialogo.chiedi(Buffer.from(utente, 'utf8').toString('base64'), [334]);
        await dialogo.chiedi(Buffer.from(password, 'utf8').toString('base64'), [235]);
      }
    }

    await dialogo.chiedi(`MAIL FROM:<${soloIndirizzo(mittente)}>`, [250]);
    await dialogo.chiedi(`RCPT TO:<${a}>`, [250, 251]);
    await dialogo.chiedi('DATA', [354]);
    await dialogo.chiedi(`${componi({ da: mittente, a, oggetto, testo })}\r\n.`, [250]);

    // Se QUIT fallisce il messaggio e' comunque partito: il 250 di sopra e' la
    // presa in carico. Non si trasforma in errore cio' che accade dopo.
    try {
      await dialogo.chiedi('QUIT', [221]);
    } catch {
      /* consegnato lo stesso */
    }
  } finally {
    presa.destroy();
  }
}

/**
 * Il servizio, come gli altri: una funzione pura della configurazione.
 *
 * `disponibile` e' falso finche' non ci sono host e mittente. Tutto cio' che
 * dipende dalla posta guarda quel campo e si spegne da solo, invece di
 * offrire un pulsante che poi fallisce.
 */
export function creaPosta(config) {
  const posta = config.posta ?? {};
  const disponibile = Boolean(posta.host && posta.mittente);

  return {
    disponibile,
    mittente: posta.mittente ?? '',

    async invia({ a, oggetto, testo }) {
      if (!disponibile) throw new Error('la posta non e\' configurata su questo server');
      if (!indirizzoValido(a)) throw new Error('indirizzo di posta non valido');
      await spedisci(posta, { a, oggetto, testo });
    },

    /**
     * Il dialogo fino all'autenticazione, senza spedire niente.
     *
     * E' quello che serve al pulsante "prova": dice se host, porta, TLS e
     * credenziali stanno in piedi, che e' dove sbaglia il novantacinque per
     * cento delle configurazioni — senza consegnare posta a nessuno.
     */
    async prova() {
      if (!disponibile) throw new Error('mancano indirizzo del server e mittente');
      const { host, porta, utente, password, tls } = posta;
      let presa = await apri({ host, porta, tls });
      let dialogo = creaDialogo(presa);
      try {
        await dialogo.chiedi(null, [220]);
        const io = hostname() || 'pulsetalk';
        let { testo: capacita } = await dialogo.chiedi(`EHLO ${io}`, [250]);

        if (!tls && /STARTTLS/i.test(capacita)) {
          await dialogo.chiedi('STARTTLS', [220]);
          presa = await elevaATls(presa, host);
          dialogo = creaDialogo(presa);
          ({ testo: capacita } = await dialogo.chiedi(`EHLO ${io}`, [250]));
        } else if (!tls) {
          // Vale la pena dirlo: funziona, ma la password del mittente sta
          // viaggiando in chiaro, e chi legge questo esito puo' decidere.
          return { ok: true, avviso: 'il server non offre STARTTLS: le credenziali viaggiano in chiaro' };
        }

        if (utente) {
          if (/AUTH[ =-][^\n]*PLAIN/i.test(capacita)) {
            const credenziale = Buffer.from(`\0${utente}\0${password}`, 'utf8').toString('base64');
            await dialogo.chiedi(`AUTH PLAIN ${credenziale}`, [235]);
          } else {
            await dialogo.chiedi('AUTH LOGIN', [334]);
            await dialogo.chiedi(Buffer.from(utente, 'utf8').toString('base64'), [334]);
            await dialogo.chiedi(Buffer.from(password, 'utf8').toString('base64'), [235]);
          }
        }
        try {
          await dialogo.chiedi('QUIT', [221]);
        } catch {
          /* la prova era gia' riuscita */
        }
        return { ok: true, avviso: null };
      } finally {
        presa.destroy();
      }
    },
  };
}

/**
 * Un indirizzo plausibile, non un indirizzo esistente.
 *
 * Non si valida un'email con un'espressione regolare: la grammatica vera e'
 * assurda e ogni tentativo rifiuta qualcosa di legittimo. Qui si scartano solo
 * le cose che di sicuro non sono un indirizzo — niente chiocciola, spazi
 * dentro, due chiocciole. La verifica seria e' l'unica che conta davvero:
 * mandarci un codice e vedere se qualcuno lo riporta indietro.
 */
export function indirizzoValido(grezzo) {
  const testo = String(grezzo ?? '').trim();
  if (testo.length < 3 || testo.length > 254) return false;
  if (/\s/.test(testo)) return false;
  const pezzi = testo.split('@');
  if (pezzi.length !== 2) return false;
  const [locale, dominio] = pezzi;
  return locale.length > 0 && dominio.includes('.') && !dominio.startsWith('.') && !dominio.endsWith('.');
}
