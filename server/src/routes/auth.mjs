// routes/auth.mjs - entrare, restare, e sapere chi si e'.
//
// Il modello e' quello di Discord ribaltato: li' ti registri liberamente e poi
// serve un invito per entrare in un server; qui l'invito serve *per esistere*,
// e da quel momento in poi hai credenziali tue.
//
// La differenza conta perche' questo server sta su internet e ha dentro le
// conversazioni di quattro persone. Una rotta di registrazione aperta sarebbe
// una porta da difendere per sempre; cosi' invece non c'e' proprio, e chi
// decide chi entra lo fa dalla riga di comando sulla macchina.

import { richiedeRuolo } from '../auth.mjs';
import { problemaConIlNomeUtente } from '../db.mjs';
import { cifra, creaFreno, daRicifrare, problemaConLaPassword, verifica } from '../password.mjs';

// Massimo 256 KB per la foto profilo. Il ridimensionamento lo fa il client
// prima di mandarla; questo e' il muro contro chi non lo fa.
const AVATAR_MAX = 256 * 1024;

function dispositivoDa(richiesta) {
  const dichiarato = richiesta.body?.dispositivo;
  if (typeof dichiarato === 'string' && dichiarato.trim()) return dichiarato.trim().slice(0, 80);
  const agente = richiesta.headers['user-agent'] ?? '';
  return agente.slice(0, 80) || null;
}

function vistaUtente(utente) {
  return {
    id: utente.id,
    nome: utente.nome,
    utente: utente.utente ?? null,
    ruolo: utente.ruolo,
    avatar: utente.avatar ?? null,
    stato: utente.stato ?? 'online',
  };
}

/** Gli unici stati che accettiamo: qualunque altra cosa e' un errore di chi chiama. */
const STATI = ['online', 'inattivo', 'occupato', 'invisibile'];

export function rotteAuth(app, { db, config }) {
  // Un freno per il nome utente e uno per l'indirizzo: chi prova mille
  // password sullo stesso account viene rallentato, e chi prova una password
  // su mille account pure. Sono due attacchi diversi e vanno contati a parte.
  const frenoUtente = creaFreno();
  const frenoIndirizzo = creaFreno({ soglia: 10 });

  // -- Registrarsi -----------------------------------------------------------

  // Cosa da' questo codice, senza consumarlo. Serve al modulo di
  // registrazione, che cosi' puo' dire "ti stai registrando come membro"
  // prima che l'utente scelga una password.
  app.post('/api/auth/invito', async (richiesta, risposta) => {
    const codice = richiesta.body?.codice;
    if (typeof codice !== 'string' || !codice.trim()) {
      return risposta.code(400).send({ errore: 'serve un codice di invito' });
    }
    const esito = db.guardaInvito(codice.trim());
    if (esito.errore) return risposta.code(403).send({ errore: esito.errore });
    return esito.invito;
  });

  app.post('/api/auth/riscatta', async (richiesta, risposta) => {
    const { codice, utente, password, nome } = richiesta.body ?? {};

    if (typeof codice !== 'string' || !codice.trim()) {
      return risposta.code(400).send({ errore: 'serve un codice di invito' });
    }

    const problemaUtente = problemaConIlNomeUtente(utente);
    if (problemaUtente) return risposta.code(400).send({ errore: problemaUtente });

    const problemaPassword = problemaConLaPassword(password);
    if (problemaPassword) return risposta.code(400).send({ errore: problemaPassword });

    const cifrata = await cifra(password);
    const esito = db.riscattaInvito(codice.trim(), {
      utente,
      nome: typeof nome === 'string' ? nome.trim().slice(0, 60) : '',
      password: cifrata,
      dispositivo: dispositivoDa(richiesta),
    });

    if (esito.errore) {
      richiesta.log.warn({ motivo: esito.errore }, 'riscatto rifiutato');
      // 409 per il nome gia' preso — e' una cosa che si sistema cambiando
      // nome — e 403 per il codice, che invece non si sistema.
      const stato = esito.errore.includes('nome utente') ? 409 : 403;
      return risposta.code(stato).send({ errore: esito.errore });
    }

    richiesta.log.info({ utente: esito.utente.id, nome: esito.utente.utente }, 'account creato');
    return { token: esito.token, utente: esito.utente };
  });

  // -- Entrare ---------------------------------------------------------------

  app.post('/api/auth/accedi', async (richiesta, risposta) => {
    const { utente: nomeUtente, password } = richiesta.body ?? {};
    if (typeof nomeUtente !== 'string' || typeof password !== 'string') {
      return risposta.code(400).send({ errore: 'servono nome utente e password' });
    }

    const chiave = String(nomeUtente).toLowerCase();
    await frenoUtente.attendi(chiave);
    await frenoIndirizzo.attendi(richiesta.ip);

    const riga = db.utentePerNomeUtente(nomeUtente);
    // Sempre la stessa risposta, sia per un utente che non esiste sia per una
    // password sbagliata: distinguerli direbbe a chi prova quali nomi sono
    // veri, e quello e' meta' del lavoro di chi vuole entrare.
    const rifiuta = () => {
      frenoUtente.sbagliato(chiave);
      frenoIndirizzo.sbagliato(richiesta.ip);
      richiesta.log.warn({ utente: chiave, ip: richiesta.ip }, 'accesso rifiutato');
      return risposta.code(401).send({ errore: 'nome utente o password non validi' });
    };

    if (!riga || !riga.password) return rifiuta();
    if (!(await verifica(password, riga.password))) return rifiuta();

    frenoUtente.riuscito(chiave);
    frenoIndirizzo.riuscito(richiesta.ip);

    // Se l'impronta e' stata fatta con parametri piu' deboli di quelli di
    // oggi, la si riscrive adesso che la password in chiaro ce l'abbiamo in
    // mano. E' l'unico momento in cui si puo' fare.
    if (daRicifrare(riga.password)) {
      db.impostaPassword(riga.id, await cifra(password));
    }

    const token = db.creaSessione(riga.id, dispositivoDa(richiesta));
    richiesta.log.info({ utente: riga.id }, 'accesso');
    return { token, utente: vistaUtente(riga) };
  });

  app.get(
    '/api/auth/io',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => ({
      utente: vistaUtente(richiesta.utente),
      // Vero per gli account nati prima che esistessero le password: l'app
      // chiede di scegliere nome utente e password una volta, e poi basta.
      deveCompletare: !!richiesta.utente.deveCompletare,
    }),
  );

  app.post(
    '/api/auth/esci',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => {
      db.revocaToken(richiesta.utente.tokenId);
      return { ok: true };
    },
  );

  // -- Completare o cambiare le credenziali ----------------------------------

  app.post(
    '/api/auth/completa',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const attuale = db.utente(richiesta.utente.id);
      if (!attuale) return risposta.code(404).send({ errore: 'utente inesistente' });

      // Questa rotta serve solo a chi non ha ancora credenziali. Chi ce le ha
      // gia' deve passare da /password, che la vecchia password la chiede.
      if (attuale.utente && attuale.password) {
        return risposta.code(409).send({ errore: 'questo account ha gia\' delle credenziali' });
      }

      const { utente: nomeUtente, password } = richiesta.body ?? {};

      if (!attuale.utente) {
        const problema = problemaConIlNomeUtente(nomeUtente);
        if (problema) return risposta.code(400).send({ errore: problema });
        const esito = db.impostaNomeUtente(attuale.id, nomeUtente);
        if (esito.errore) return risposta.code(409).send({ errore: esito.errore });
      }

      const problema = problemaConLaPassword(password);
      if (problema) return risposta.code(400).send({ errore: problema });
      db.impostaPassword(attuale.id, await cifra(password));

      richiesta.log.info({ utente: attuale.id }, 'credenziali completate');
      return { utente: vistaUtente(db.utente(attuale.id)) };
    },
  );

  app.post(
    '/api/auth/password',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const { vecchia, nuova } = richiesta.body ?? {};
      const attuale = db.utente(richiesta.utente.id);
      if (!attuale?.password) {
        return risposta.code(409).send({ errore: 'questo account non ha ancora una password' });
      }

      await frenoUtente.attendi(`cambio:${attuale.id}`);
      if (!(await verifica(vecchia, attuale.password))) {
        frenoUtente.sbagliato(`cambio:${attuale.id}`);
        return risposta.code(403).send({ errore: 'la password attuale non e\' corretta' });
      }
      frenoUtente.riuscito(`cambio:${attuale.id}`);

      const problema = problemaConLaPassword(nuova);
      if (problema) return risposta.code(400).send({ errore: problema });

      db.impostaPassword(attuale.id, await cifra(nuova));

      // Tutte le altre sessioni cadono. E' il motivo per cui si cambia una
      // password: se qualcuno era entrato, deve uscire adesso.
      let chiuse = 0;
      for (const sessione of db.sessioniDi(attuale.id)) {
        if (sessione.id === richiesta.utente.tokenId) continue;
        chiuse += db.revocaToken(sessione.id);
      }

      richiesta.log.info({ utente: attuale.id, chiuse }, 'password cambiata');
      return { ok: true, sessioniChiuse: chiuse };
    },
  );

  // -- Profilo ---------------------------------------------------------------

  app.post(
    '/api/auth/profilo',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const { nome, avatar, stato } = richiesta.body ?? {};

      if (stato !== undefined && !STATI.includes(stato)) {
        return risposta.code(400).send({ errore: `stato sconosciuto: ${stato}` });
      }

      if (nome !== undefined && (typeof nome !== 'string' || !nome.trim())) {
        return risposta.code(400).send({ errore: 'il nome visibile non puo\' essere vuoto' });
      }
      if (avatar !== undefined && avatar !== null) {
        if (typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
          return risposta.code(400).send({ errore: 'la foto deve essere un\'immagine' });
        }
        if (avatar.length > AVATAR_MAX) {
          return risposta
            .code(413)
            .send({ errore: `la foto e' troppo grande: al massimo ${AVATAR_MAX / 1024} KB` });
        }
      }

      db.aggiornaProfilo(richiesta.utente.id, {
        nome: nome === undefined ? undefined : nome.trim().slice(0, 60),
        avatar,
        stato,
      });
      return { utente: vistaUtente(db.utente(richiesta.utente.id)) };
    },
  );

  // -- Sessioni --------------------------------------------------------------

  app.get(
    '/api/auth/sessioni',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => ({
      sessioni: db.sessioniDi(richiesta.utente.id).map((s) => ({
        ...s,
        // Cosi' l'interfaccia puo' scrivere "questo dispositivo" invece di
        // costringere a indovinare quale delle righe sia quella davanti.
        questa: s.id === richiesta.utente.tokenId,
      })),
    }),
  );

  app.post(
    '/api/auth/sessioni/:id/revoca',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const id = Number(richiesta.params.id);
      // Solo le proprie. Senza questo controllo, l'id di una sessione altrui
      // basterebbe per buttare fuori chiunque.
      const mie = db.sessioniDi(richiesta.utente.id);
      if (!mie.some((s) => s.id === id)) {
        return risposta.code(404).send({ errore: 'sessione inesistente' });
      }
      db.revocaToken(id);
      return { revocata: id };
    },
  );

  // -- Chi sono gli altri ----------------------------------------------------

  /**
   * Il profilo pubblico di tutti: nome visibile e foto.
   *
   * Serve ai riquadri della stanza, che devono disegnare la faccia di chi ha
   * la camera spenta. La strada ovvia sarebbe stata mettere la foto dentro al
   * gettone, che viaggia gia' verso tutti — ma un gettone e' un'intestazione
   * HTTP, e infilarci dentro 256 KB di JPEG lo farebbe rifiutare da mezzo
   * mondo. Meglio una chiamata sola, che il client tiene in cache.
   *
   * Pubblico fra chi e' gia' dentro: chi ha un account vede i nomi e le facce
   * degli altri, che e' esattamente cio' che succede entrando in una stanza.
   */
  app.get(
    '/api/utenti',
    { onRequest: richiedeRuolo('ospite') },
    async () => ({
      utenti: db.elencoProfili().map((u) => ({
        id: u.id,
        nome: u.nome,
        utente: u.utente,
        avatar: u.avatar,
        // Invisibile non si dice: dall'altra parte deve sembrare offline, e
        // l'unico modo per non tradirlo e' non mandare mai quella parola.
        stato: (u.stato ?? 'online') === 'invisibile' ? 'offline' : (u.stato ?? 'online'),
      })),
    }),
  );

  // -- Configurazione --------------------------------------------------------

  // Tutto quello che l'app deve sapere e che potrebbe cambiare senza che lei
  // se ne accorga. Chiederlo invece di compilarlo dentro significa che
  // spostare la SFU, o alzare il tetto del bitrate, non richiede di
  // reinstallare niente a nessuno.
  app.get(
    '/api/config',
    { onRequest: richiedeRuolo('ospite') },
    async () => ({
      sfuUrl: config.sfuUrl,
      limiti: config.limiti,
      versione: 2,
    }),
  );
}
