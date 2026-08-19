// server.mjs - avvio.
//
// Una sola applicazione Fastify su una sola porta, e non servono due strade
// e vale la pena dirlo: da questa porta non passano byte pesanti. Passano login,
// elenchi di canali, messaggi di testo e gettoni — qualche kilobyte a testa.
// L'audio e il video viaggiano direttamente fra le app e la SFU, e gli
// allegati sono l'unica cosa grossa che tocca il disco.
//
//   :8080  API + app web  -> ci arriva il reverse proxy della macchina, che
//                            termina il TLS e smista per nome.
//
// La SFU sta in un altro container, sulla rete dell'host, e la sua
// segnalazione passa dallo stesso proxy su un nome suo. I pacchetti audio no:
// quelli vanno diretti in UDP, ed e' l'unica ragione per cui va aperta una
// porta sul router.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import cors from '@fastify/cors';
import statico from '@fastify/static';
import Fastify from 'fastify';

import { agganciaAutenticazione } from './auth.mjs';
import { leggiConfig } from './config.mjs';
import { TalkDb } from './db.mjs';
import { creaEventi } from './eventi.mjs';
import { rotteAllegati, spazzaAllegati } from './routes/allegati.mjs';
import { rotteAmici } from './routes/amici.mjs';
import { rotteAuth } from './routes/auth.mjs';
import { rotteInviti } from './routes/inviti.mjs';
import { rotteMessaggi } from './routes/messaggi.mjs';
import { rotteSpazi } from './routes/spazi.mjs';
import { rotteWebhook } from './routes/webhook.mjs';
import { creaVerificatore, Presenze } from './sfu.mjs';

function gestoreErrori(errore, richiesta, risposta) {
  if (errore.statusCode && errore.statusCode < 500) {
    return risposta.code(errore.statusCode).send({ errore: errore.message });
  }
  // Il dettaglio finisce nel log, non nella risposta: un messaggio di errore
  // interno racconta a chi guarda com'e' fatto il server.
  richiesta.log.error({ err: errore }, 'richiesta fallita');
  return risposta.code(500).send({ errore: 'errore interno' });
}

export async function creaTalk(config) {
  const db = new TalkDb(config.dbPath);

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,          // dietro al reverse proxy: l'IP vero sta negli header
    bodyLimit: 1 << 20,
  });
  app.setErrorHandler(gestoreErrori);

  // Origine libera, e non e' una svista. L'unica credenziale e' un Bearer che
  // il browser non allega da solo: nessun sito puo' fare una richiesta
  // autenticata per conto di chi la visita, che e' esattamente il rischio da
  // cui la restrizione sull'origine proteggerebbe. In cambio, l'app installata
  // — che gira su file:// e non ha un'origine — puo' parlare col server.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-nome'],
    maxAge: 86400,
  });

  const presenze = new Presenze(config, app.log);
  const eventi = creaEventi();

  agganciaAutenticazione(app, { db, config });
  rotteAuth(app, { db, config });
  rotteInviti(app, { db });
  rotteAmici(app, { db, eventi });
  rotteSpazi(app, { db, config, presenze, eventi });
  rotteMessaggi(app, { db, eventi });
  await rotteAllegati(app, { db, config });
  await rotteWebhook(app, { verificatore: creaVerificatore(config), presenze, eventi, db });

  app.get('/salute', async () => ({ ok: true, ascolto: eventi.quanti }));

  // L'app web, se e' stata costruita. La sua assenza non e' un errore: senza,
  // il server e' una pura API e ci si collega solo dall'app installata.
  //
  // Si controlla index.html e non la cartella: la cartella esiste sempre
  // (Docker la vuole per la COPY, e dentro c'e' un .gitkeep), ma una cartella
  // con dentro solo un segnaposto non e' un'app web, e servirla produrrebbe
  // un 500 al primo percorso sconosciuto.
  // Gli aggiornamenti, se la cartella c'e'. Prima del resto, perche' il
  // ripiego della pagina singola qui sotto risponde a qualunque percorso e si
  // mangerebbe anche questo.
  //
  // decorateReply: false perche' @fastify/static aggiunge reply.sendFile una
  // volta sola: registrandolo due volte senza questa riga, il server non parte
  // proprio.
  if (existsSync(config.aggiornamentiDir)) {
    await app.register(statico, {
      root: config.aggiornamentiDir,
      prefix: '/aggiornamenti/',
      decorateReply: false,
      index: false,
      // Elencare il contenuto non serve a nessuno: il client sa gia' quali
      // file chiedere, e una pagina che mostra tutti gli installer e' solo un
      // invito a scaricarne uno vecchio.
      list: false,
    });
    app.log.info({ cartella: config.aggiornamentiDir }, 'aggiornamenti serviti su /aggiornamenti');
  }

  if (existsSync(join(config.publicDir, 'index.html'))) {
    await app.register(statico, { root: config.publicDir, prefix: '/', index: ['index.html'] });

    // Una sola pagina con la navigazione dentro: qualunque percorso che non sia
    // /api e non sia un file vero deve restituire la pagina, non un 404, o
    // ricaricare /spazio/casa porterebbe a una pagina bianca.
    app.setNotFoundHandler((richiesta, risposta) => {
      if (richiesta.url.startsWith('/api') || richiesta.url.startsWith('/webhook')) {
        return risposta.code(404).send({ errore: 'rotta inesistente' });
      }
      return risposta.sendFile('index.html');
    });
  }

  return { app, db, config, presenze, eventi };
}

export async function avvia(config = leggiConfig()) {
  const talk = await creaTalk(config);

  await talk.app.listen({ host: config.host, port: config.port });

  if (config.senzaAuth) {
    talk.app.log.warn(
      'TALK_NO_AUTH attivo: chiunque raggiunga questa porta ha i permessi di amministratore. ' +
      'Va bene solo per i test.',
    );
  }
  talk.app.log.info(
    { sfu: config.sfuUrl, ricerca: talk.db.ricercaDisponibile },
    'PulseTalk in ascolto',
  );

  // I file caricati e mai mandati: un giro all'avvio e poi ogni sei ore.
  const spazza = () =>
    spazzaAllegati(talk.db, config, talk.app.log).catch((e) =>
      talk.app.log.error({ err: e }, 'spazzata degli allegati fallita'),
    );
  await spazza();
  const spazzino = setInterval(spazza, 6 * 3600_000);
  spazzino.unref();

  const chiudi = async () => {
    talk.app.log.info('chiusura');
    clearInterval(spazzino);
    await talk.app.close();
    talk.db.close();
    process.exit(0);
  };
  process.on('SIGTERM', chiudi);
  process.on('SIGINT', chiudi);

  return talk;
}

// Avvio diretto (node src/server.mjs), non quando il modulo viene importato da
// un test.
if (process.argv[1]?.endsWith('server.mjs')) {
  avvia().catch((e) => {
    console.error(`PulseTalk non e' partito: ${e.message}`);
    process.exit(1);
  });
}
