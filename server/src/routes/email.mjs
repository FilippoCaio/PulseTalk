// routes/email.mjs - l'indirizzo di posta, e la strada per rientrare.
//
// Due gruppi di rotte che sembrano uno solo e non lo sono. La conferma la
// chiede chi e' gia' dentro, per il proprio indirizzo; il recupero lo chiede
// chi e' fuori, e non ha modo di dimostrare niente tranne aprire una casella.
// Il secondo e' l'unico punto di questo server in cui si concede qualcosa a
// una richiesta che non porta credenziali, e quasi tutti i commenti qui sotto
// riguardano quello.
//
// PERCHE' LA CONFERMA ESISTE. Senza, l'indirizzo sarebbe una stringa scritta
// in un campo, e il recupero manderebbe la chiave di casa a un refuso — o
// all'indirizzo di qualcun altro, scritto apposta. La conferma e' cio' che
// separa un indirizzo dichiarato da un indirizzo posseduto, ed e' il solo
// motivo per cui il recupero puo' fidarsi.
//
// PERCHE' NON SI PUO' RILEGGERE LA PROPRIA PASSWORD, visto che e' la prima
// cosa che viene in mente guardando queste rotte. Perche' il server non la
// sa: `password.mjs` ne conserva solo l'impronta scrypt, che e' a senso unico.
// Mostrarla vorrebbe dire salvarla in modo reversibile, e talk.db non e'
// cifrato — chi lo legge avrebbe la password di ognuno, e siccome le password
// si riusano avrebbe anche la loro posta. Chi ha dimenticato la sua ne mette
// una nuova da qui, che risolve lo stesso problema senza tenere in giro
// niente da rubare.

import { richiedeRuolo } from '../auth.mjs';
import { indirizzoValido } from '../posta.mjs';
import { cifra, creaFreno, problemaConLaPassword, verifica } from '../password.mjs';

/** Quanto vale un codice. Corto: e' una cosa che si fa subito o non si fa. */
const VALIDO_MINUTI = 15;

function testoConferma({ nome, codice }) {
  return [
    `Ciao ${nome},`,
    '',
    'per confermare questo indirizzo su PulseTalk scrivi questo codice',
    'nella pagina che hai lasciato aperta:',
    '',
    `    ${codice}`,
    '',
    `Vale ${VALIDO_MINUTI} minuti.`,
    '',
    'Se non hai chiesto tu niente, qualcuno ha scritto il tuo indirizzo per',
    'sbaglio: ignora questo messaggio e non succede nulla. Senza il codice',
    'quell indirizzo non viene collegato a nessun account.',
  ].join('\n');
}

function testoRecupero({ nome, utente, codice }) {
  return [
    `Ciao ${nome},`,
    '',
    `qualcuno ha chiesto di rimettere la password dell'account "${utente}".`,
    'Se sei stato tu, scrivi questo codice nella finestra di PulseTalk:',
    '',
    `    ${codice}`,
    '',
    `Vale ${VALIDO_MINUTI} minuti e si usa una volta sola.`,
    '',
    'Se non sei stato tu, ignora questo messaggio: senza il codice non',
    'cambia niente, e la password di adesso continua a funzionare.',
  ].join('\n');
}

export function rotteEmail(app, { db, servizi }) {
  // Il freno del recupero conta per indirizzo. Chiedere il codice e' gratis e
  // non richiede di sapere niente: senza un limite, questa rotta diventa il
  // modo piu' comodo per riempire la casella di qualcuno.
  const frenoRecupero = creaFreno({ soglia: 3, passoMs: 700, tettoMs: 8000 });
  const frenoCodice = creaFreno({ soglia: 3 });

  // -- Il proprio indirizzo --------------------------------------------------

  app.get('/api/io/email', { onRequest: richiedeRuolo('ospite') }, async (richiesta) => {
    const utente = db.utente(richiesta.utente.id);
    return {
      // Il proprio indirizzo torna indietro in chiaro, e va bene: e' suo, lo
      // ha scritto lui, e nasconderlo costringerebbe a riscriverlo per intero
      // ogni volta che si vuole solo controllare quale c'e'.
      indirizzo: utente?.email ?? null,
      confermato: Boolean(utente?.emailConfermata),
      // Senza posta configurata il pannello non offre niente, invece di
      // offrire un pulsante che poi fallisce.
      possibile: servizi.posta.disponibile,
    };
  });

  /**
   * Scrive l'indirizzo e ci manda un codice.
   *
   * Chiede la password attuale, e non e' zelo: l'indirizzo di posta e' la
   * strada per rientrare, quindi cambiarlo vale quanto cambiare la password.
   * Una sessione lasciata aperta su un computer altrui, senza questa domanda,
   * basterebbe a dirottare su un'altra casella tutti i recuperi futuri — e chi
   * ha subito il dirottamento se ne accorgerebbe la prossima volta che
   * dimentica la password, cioe' troppo tardi.
   */
  app.post('/api/io/email', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    if (!servizi.posta.disponibile) {
      return risposta.code(501).send({ errore: 'su questo server la posta non e\' configurata' });
    }

    const attuale = db.utente(richiesta.utente.id);
    const { indirizzo, password } = richiesta.body ?? {};

    if (!attuale?.password) {
      return risposta.code(409).send({ errore: 'questo account non ha ancora una password' });
    }

    await frenoUtenteAttendi(frenoCodice, attuale.id);
    if (!(await verifica(password, attuale.password))) {
      frenoCodice.sbagliato(`email:${attuale.id}`);
      return risposta.code(403).send({ errore: 'la password non e\' corretta' });
    }
    frenoCodice.riuscito(`email:${attuale.id}`);

    const pulito = String(indirizzo ?? '').trim().toLowerCase();
    if (!indirizzoValido(pulito)) {
      return risposta.code(400).send({ errore: 'questo non sembra un indirizzo di posta' });
    }

    // Un indirizzo confermato appartiene a un account solo. Due account con la
    // stessa casella vorrebbero dire che chi la apre puo' rientrare in
    // entrambi, e che il recupero non sa piu' di quale sta parlando.
    const gia = db.utentePerEmail(pulito);
    if (gia && gia.id !== attuale.id) {
      return risposta.code(409).send({ errore: 'questo indirizzo e\' gia\' collegato a un altro account' });
    }

    db.impostaEmail(attuale.id, pulito);
    const codice = db.creaCodice({
      utente: attuale.id,
      scopo: 'conferma',
      indirizzo: pulito,
      validoMinuti: VALIDO_MINUTI,
    });

    try {
      await servizi.posta.invia({
        a: pulito,
        oggetto: 'Il codice per confermare il tuo indirizzo',
        testo: testoConferma({ nome: attuale.nome, codice }),
      });
    } catch (errore) {
      // Qui l'errore si dice per intero: e' il proprio indirizzo, non c'e'
      // niente da proteggere, e sapere che il server di posta rifiuta e'
      // esattamente cio' che serve a chi amministra.
      richiesta.log.error({ errore: errore.message }, 'invio della conferma fallito');
      return risposta.code(502).send({ errore: `non sono riuscito a spedire: ${errore.message}` });
    }

    richiesta.log.info({ utente: attuale.id }, 'codice di conferma spedito');
    return { indirizzo: pulito, confermato: false, validoMinuti: VALIDO_MINUTI };
  });

  app.post('/api/io/email/conferma', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    const attuale = db.utente(richiesta.utente.id);
    if (!attuale?.email) return risposta.code(409).send({ errore: 'non c\'e\' nessun indirizzo da confermare' });

    const esito = db.consumaCodice({
      scopo: 'conferma',
      indirizzo: attuale.email,
      codice: richiesta.body?.codice,
    });
    if (esito.problema) return risposta.code(400).send({ errore: esito.problema });

    // Il codice dice di chi e'. Un codice valido ma di un'altra persona non
    // deve poter confermare l'indirizzo di questa: e' improbabile, ma
    // "improbabile" non e' una condizione da cui dipendere.
    if (esito.utente !== attuale.id) return risposta.code(400).send({ errore: 'codice non valido' });

    db.confermaEmail(attuale.id, esito.indirizzo);
    richiesta.log.info({ utente: attuale.id }, 'indirizzo confermato');
    return { indirizzo: esito.indirizzo, confermato: true };
  });

  app.delete('/api/io/email', { onRequest: richiedeRuolo('ospite') }, async (richiesta) => {
    db.impostaEmail(richiesta.utente.id, null);
    richiesta.log.info({ utente: richiesta.utente.id }, 'indirizzo tolto');
    return { indirizzo: null, confermato: false };
  });

  // -- Rientrare, da fuori ---------------------------------------------------

  /**
   * Chiede il codice per rimettere la password.
   *
   * LA RISPOSTA E' SEMPRE LA STESSA, e' la regola che regge tutto il resto.
   * Rispondere "questo indirizzo non risulta" trasformerebbe questa rotta in
   * uno strumento per sapere chi ha un account qui dentro — provando una lista
   * di indirizzi e guardando quali rispondono diversamente. Su un'istanza di
   * quattro amici sembra poco; e' comunque la differenza fra sapere e non
   * sapere chi frequenta questo posto.
   *
   * Vale anche per i fallimenti dell'invio: se il messaggio non parte lo si
   * scrive nel log, dove lo legge chi amministra, non nella risposta, dove lo
   * leggerebbe chi sta provando indirizzi altrui.
   */
  app.post('/api/auth/recupero', async (richiesta, risposta) => {
    if (!servizi.posta.disponibile) {
      // Questa non e' una fuga di informazioni: e' una caratteristica del
      // server, uguale per tutti, e chi la riceve deve sapere che qui il
      // recupero non c'e' invece di aspettare un messaggio che non arrivera'.
      return risposta.code(501).send({ errore: 'su questo server il recupero per posta non e\' attivo' });
    }

    const pulito = String(richiesta.body?.indirizzo ?? '').trim().toLowerCase();
    const generica = { ok: true, validoMinuti: VALIDO_MINUTI };

    await frenoRecupero.attendi(pulito);
    frenoRecupero.sbagliato(pulito);

    if (!indirizzoValido(pulito)) return generica;

    const utente = db.utentePerEmail(pulito);
    if (!utente || !utente.utente) return generica;

    const codice = db.creaCodice({
      utente: utente.id,
      scopo: 'recupero',
      indirizzo: pulito,
      validoMinuti: VALIDO_MINUTI,
    });

    try {
      await servizi.posta.invia({
        a: pulito,
        oggetto: 'Rimettere la password di PulseTalk',
        testo: testoRecupero({ nome: utente.nome, utente: utente.utente, codice }),
      });
      richiesta.log.info({ utente: utente.id }, 'codice di recupero spedito');
    } catch (errore) {
      richiesta.log.error({ errore: errore.message }, 'invio del recupero fallito');
    }

    return generica;
  });

  /**
   * Il codice, e la password nuova.
   *
   * Alla fine cadono tutte le sessioni, compresa quella di chi eventualmente
   * era gia' dentro. E' il senso stesso di rimettere una password: se qualcuno
   * c'era, adesso non c'e' piu'. Non si consegna un gettone nuovo — si torna
   * alla schermata di accesso e si entra con la password appena scelta, che e'
   * anche il modo di scoprire subito di averla scritta come si credeva.
   */
  app.post('/api/auth/recupero/riscatta', async (richiesta, risposta) => {
    const pulito = String(richiesta.body?.indirizzo ?? '').trim().toLowerCase();
    const { codice, password } = richiesta.body ?? {};

    await frenoRecupero.attendi(`riscatto:${pulito}`);

    // La password si controlla prima di bruciare il codice: una password
    // troppo corta non deve costare il viaggio in casella.
    const problema = problemaConLaPassword(password);
    if (problema) return risposta.code(400).send({ errore: problema });

    const esito = db.consumaCodice({ scopo: 'recupero', indirizzo: pulito, codice });
    if (esito.problema) {
      frenoRecupero.sbagliato(`riscatto:${pulito}`);
      return risposta.code(400).send({ errore: esito.problema });
    }
    frenoRecupero.riuscito(`riscatto:${pulito}`);

    db.impostaPassword(esito.utente, await cifra(password));

    let chiuse = 0;
    for (const sessione of db.sessioniDi(esito.utente)) chiuse += db.revocaToken(sessione.id);

    richiesta.log.info({ utente: esito.utente, chiuse }, 'password rimessa con un codice');
    return { ok: true, sessioniChiuse: chiuse };
  });
}

/** Il freno del cambio indirizzo, con la stessa chiave usata per contarlo. */
function frenoUtenteAttendi(freno, id) {
  return freno.attendi(`email:${id}`);
}
