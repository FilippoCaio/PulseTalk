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
import { avviaScadenzaCanali } from './canali-temporanei.mjs';
import { creaChiamate } from './chiamate.mjs';
import { avviaOreLavoro } from './ore-lavoro.mjs';
import { leggiConfig } from './config.mjs';
import { ambienteEffettivo } from './impostazioni-istanza.mjs';
import { TalkDb } from './db.mjs';
import { creaEventi } from './eventi.mjs';
import { creaStati } from './stati.mjs';
import { creaRegistroMusica } from './provider/musica.mjs';
import { creaAnteprimeLink } from './provider/anteprime-link.mjs';
import { creaGif } from './provider/gif.mjs';
import { creaPosta } from './posta.mjs';
import { creaAvvisi } from './avvisi.mjs';
import { creaSpotify } from './provider/spotify.mjs';
import { creaProviderAi } from './provider/ai.mjs';
import { creaGeneratoreImmagini, elencoGeneratori } from './provider/generazione-immagini.mjs';
import { creaUnsplash } from './provider/immagini.mjs';
import { rotteAllegati, spazzaAllegati, spazzaParziali } from './routes/allegati.mjs';
import { rotteAdmin, rotteChiaveAi } from './routes/admin.mjs';
import { rotteOre } from './routes/ore.mjs';
import { rotteRegistrazioni } from './routes/registrazioni.mjs';
import { rotteAi } from './routes/ai.mjs';
import { rotteAutoWriter } from './routes/autowriter.mjs';
import { rotteBot } from './routes/bot.mjs';
import { rotteAmici } from './routes/amici.mjs';
import { rotteAuth } from './routes/auth.mjs';
import { rotteEmail } from './routes/email.mjs';
import { rotteCompatibilita } from './routes/compatibilita.mjs';
import { rotteDiretti } from './routes/diretti.mjs';
import { rotteEventiSpazio } from './routes/eventi-spazio.mjs';
import { rotteModerazione } from './routes/moderazione.mjs';
import { creaModerazione } from './moderazione.mjs';
import { rotteInviti } from './routes/inviti.mjs';
import { rotteInvitiSpazio } from './routes/inviti-spazio.mjs';
import { rotteMedia } from './routes/media.mjs';
import { rotteMessaggi } from './routes/messaggi.mjs';
import { rotteMusica } from './routes/musica.mjs';
import { rotteRuoli } from './routes/ruoli.mjs';
import { rotteServizi } from './routes/servizi.mjs';
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

/**
 * La configurazione, piu' cio' che il pannello di amministrazione ha scritto.
 *
 * Le impostazioni salvate dal pannello vincono sull'ambiente, e devono valere
 * anche all'avvio: una chiave scritta ieri dall'applicazione deve esserci
 * ancora dopo un riavvio del container, senza che nessuno la ricopi nel
 * docker-compose.
 *
 * Il try non e' pudore. `leggiConfig` valida, e valida rifiutando: una riga
 * scritta male — un URL storto rimasto in tabella da una versione precedente,
 * un intero fuori scala — impedirebbe l'avvio del server. Un pannello che puo'
 * rendere il server non avviabile e' peggio del problema che risolve, perche'
 * l'unico rimedio tornerebbe a essere la sessione SSH. Se la lettura fallisce
 * si riparte da cio' che c'e' nell'ambiente e lo si dice forte nel log.
 */
function conImpostazioni(base, ambiente, db, log = null) {
  const righe = db.impostazioniIstanza();
  if (Object.keys(righe).length === 0) return base;
  try {
    return leggiConfig(ambienteEffettivo(ambiente, righe));
  } catch (errore) {
    log?.error(
      { err: errore },
      "impostazioni salvate non valide: uso solo l'ambiente del container",
    );
    return base;
  }
}

/**
 * I servizi esterni, tutti quelli che nascono da una `config` e basta.
 *
 * Stanno insieme perche' cambiano insieme: si scrive una chiave nel pannello e
 * vanno rifatti tutti da capo, con la configurazione nuova. Sono funzioni pure
 * di `config` — nessuno di loro tiene uno stato che si perderebbe — quindi
 * rifarli costa quanto costruirli la prima volta.
 */
function montaServizi(config) {
  return {
    config,
    gif: creaGif(config),
    ai: creaProviderAi(config),
    immagini: creaUnsplash(config),
    // Chi disegna e' scelto a parte da chi chiacchiera: si puo' avere la chat
    // su OpenAI e le immagini da una Stable Diffusion in casa, o il contrario.
    generatoreImmagini: creaGeneratoreImmagini(config),
    generatori: elencoGeneratori(config),
    posta: creaPosta(config),
  };
}

export async function creaTalk(configIniziale, { ambiente = process.env } = {}) {
  const db = new TalkDb(configIniziale.dbPath);
  const config = conImpostazioni(configIniziale, ambiente, db);

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
  //
  // PUT c'e', e per un po' non c'era: mancava dall'elenco, e il modo in cui si
  // rompeva non nominava mai la causa. Il client manda l'authorization in
  // un'intestazione, quindi ogni richiesta e' "non semplice" e il browser fa
  // prima un preflight; il preflight rispondeva senza PUT fra i metodi
  // ammessi, e la richiesta vera non partiva. `fetch` la' non riceve una
  // risposta da leggere - riceve un TypeError - e il client lo traduceva in
  // «non riesco a raggiungere il server», mandando a controllare l'indirizzo e
  // se il NAS fosse acceso. Nei log del server non compariva niente, perche'
  // dal suo punto di vista non era arrivato niente: solo OPTIONS senza la
  // richiesta che dovevano precedere, che e' la firma esatta di questo guasto.
  //
  // Erano ferme cinque cose - le preferenze di avviso, il caricamento degli
  // allegati a pezzi, le impostazioni dell'istanza, la chiave AI personale e
  // gli override dei permessi - e nessuna diceva perche'.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-nome'],
    maxAge: 86400,
  });

  const presenze = new Presenze(config, app.log);
  const eventi = creaEventi();
  // Chi c'e' davvero, incrociato con lo stato scelto a mano. Vive accanto agli
  // eventi perche' e' da li' che sa chi ha l'applicazione aperta.
  const stati = creaStati({ eventi, db });
  const chiamate = creaChiamate({ eventi, presenze, log: app.log });
  // Le restrizioni vocali scritte sul disco, portate fin dentro alla SFU. Vive
  // qui e non dentro alle rotte perche' ci passa anche lo spazzino che le fa
  // decadere alla fine di un evento.
  const moderazione = creaModerazione({ db, eventi, presenze, log: app.log });

  // I servizi di musica disponibili. Registrarli sempre, anche senza
  // credenziali: cosi' l'interfaccia puo' dire "Spotify c'e', ma questo server
  // non e' configurato" invece di far sparire la funzione senza spiegazioni.
  const registroMusica = creaRegistroMusica();
  registroMusica.registra(creaSpotify({ config, db, log: app.log }));
  const anteprime = creaAnteprimeLink();

  /**
   * I servizi vivi, dentro a una scatola che si puo' sostituire.
   *
   * Le rotte ricevono la scatola e guardano dentro al momento della chiamata,
   * invece di prendersi il provider una volta per tutte all'avvio. E' la
   * differenza fra un pannello che funziona e uno che chiede di riavviare:
   * riavviare il container per una chiave API vorrebbe dire buttare fuori
   * dalla chiamata chi ci sta parlando dentro.
   */
  const servizi = montaServizi(config);

  /**
   * Il provider AI da usare *per questa persona*.
   *
   * Chi paga lo decide `config.ai.chiavi`. Con `istanza` c'e' una chiave sola
   * e questa funzione restituisce sempre la stessa; con `utente` ognuno porta
   * la propria e chi non l'ha messa non ha l'AI; con `mista` la propria vince
   * e quella di casa fa da rete.
   *
   * Costruire un provider non costa niente — sono chiusure su un oggetto, zero
   * rete e zero stato — quindi si rifa' a ogni richiesta invece di tenere una
   * cache. Una cache qui vorrebbe dire ricordarsi di svuotarla quando qualcuno
   * cambia la propria chiave, e una chiave revocata che continua a funzionare
   * per dieci minuti e' esattamente il genere di bug che non si riproduce.
   */
  servizi.aiPer = (utente) => {
    const modo = servizi.config.ai.chiavi;
    if (modo === 'istanza' || !utente?.id) return servizi.ai;

    const sua = db.chiaveAi(utente.id);
    if (!sua?.apiKey) {
      // In `mista` si ricade sulla chiave di casa; in `utente` no, e il
      // provider che nasce senza chiave si dichiara spento da solo. Le rotte
      // rispondono gia' 501 a quello, e il messaggio lo aggiusta chi sa in
      // quale delle due modalita' siamo.
      return modo === 'mista' ? servizi.ai : creaProviderAi({ ...servizi.config, ai: { ...servizi.config.ai, apiKey: '' } });
    }

    return creaProviderAi({
      ...servizi.config,
      ai: {
        ...servizi.config.ai,
        baseUrl: sua.baseUrl ?? servizi.config.ai.baseUrl,
        apiKey: sua.apiKey,
        chatModel: sua.chatModel ?? servizi.config.ai.chatModel,
        sttModel: sua.sttModel ?? servizi.config.ai.sttModel,
        imageModel: sua.imageModel ?? servizi.config.ai.imageModel,
      },
    });
  };

  servizi.ricarica = (nuova) => {
    // `montaServizi` non contiene `aiPer` ne' `ricarica`: Object.assign
    // sovrascrive solo cio' che rifa', e le due funzioni restano quelle.
    Object.assign(servizi, montaServizi(nuova));
    // Spotify non nasce dalla sola config — vuole il database e il log — e
    // vive dentro al registro invece che qui. Registrarlo di nuovo sostituisce
    // quello vecchio: il registro e' una mappa per nome.
    registroMusica.registra(creaSpotify({ config: nuova, db, log: app.log }));
    return servizi;
  };

  const avvisi = creaAvvisi({ db, eventi, stati, servizi, log: app.log });

  agganciaAutenticazione(app, { db, config });
  rotteCompatibilita(app, { config });
  rotteAuth(app, { db, config, stati });
  rotteEmail(app, { db, servizi, avvisi });
  rotteInviti(app, { db });
  rotteAmici(app, { db, eventi });
  rotteSpazi(app, { db, config, presenze, eventi });
  rotteRuoli(app, { db, eventi, presenze });
  rotteInvitiSpazio(app, { db, eventi });
  rotteEventiSpazio(app, { db, eventi });
  rotteModerazione(app, { db, presenze, moderazione });
  rotteDiretti(app, { db, config, presenze, eventi, chiamate, stati });
  rotteMedia(app, { db, eventi });
  rotteMusica(app, { db, registro: registroMusica, config });
  rotteServizi(app, { servizi, anteprime });
  rotteAi(app, { db, eventi, servizi });
  rotteAutoWriter(app, { db, eventi, servizi, presenze });
  rotteAdmin(app, { db, servizi, ambiente });
  rotteChiaveAi(app, { db, servizi });
  rotteBot(app, { db, eventi });
  rotteMessaggi(app, { db, eventi });
  rotteRegistrazioni(app, { db, config, servizi });
  await rotteAllegati(app, { db, config });
  await rotteWebhook(app, { verificatore: creaVerificatore(config), presenze, eventi, db, chiamate, avvisi });

  const fermaScadenze = await avviaScadenzaCanali({ db, presenze, eventi, log: app.log });
  app.addHook('onClose', async () => fermaScadenze());

  // Il cartellino. Il modulo parte sempre; e' il singolo battito a guardare se
  // le impostazioni di lavoro sono accese, cosi' accenderle dal pannello le
  // accende davvero senza riavviare il container.
  const ore = avviaOreLavoro({ db, presenze, servizi, config, log: app.log });
  rotteOre(app, { servizi, ore, config });
  app.addHook('onClose', async () => ore.ferma());

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
      // E gli aggiornamenti, che non sono pagine.
      //
      // Senza questa riga un `latest.yml` che non c'e' — cioe' un'istanza che
      // non pubblica aggiornamenti, che e' il caso normale di chi installa
      // PulseTalk senza compilarlo — riceveva **200 con dentro l'HTML
      // dell'applicazione**. electron-updater provava a leggerlo come YAML e
      // moriva con un errore di parsing: chi apriva il pannello degli
      // aggiornamenti si trovava un guasto incomprensibile al posto di "questo
      // server non ne pubblica".
      //
      // Si e' visto solo facendo partire il server davvero: dai test non
      // emerge, perche' li' la cartella `public/` e' vuota e questo ripiego non
      // viene nemmeno registrato.
      if (richiesta.url.startsWith('/aggiornamenti')) {
        return risposta.code(404).send({ errore: 'questo server non pubblica aggiornamenti' });
      }
      return risposta.sendFile('index.html');
    });
  }

  return { app, db, config, presenze, eventi, chiamate, registroMusica, stati, moderazione };
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

  // I file caricati e mai mandati, e i caricamenti a pezzi lasciati a meta':
  // un giro all'avvio e poi ogni sei ore.
  const spazza = async () => {
    await spazzaAllegati(talk.db, config, talk.app.log).catch((e) =>
      talk.app.log.error({ err: e }, 'spazzata degli allegati fallita'),
    );
    await spazzaParziali(config, talk.app.log).catch((e) =>
      talk.app.log.error({ err: e }, 'spazzata dei caricamenti a meta\' fallita'),
    );
  };
  await spazza();
  const spazzino = setInterval(spazza, 6 * 3600_000);
  spazzino.unref();

  // Le restrizioni imposte dall'organizzatore di un evento cadono con
  // l'evento, e cadono anche per chi in quel momento e' ancora in stanza: il
  // database le butta via da solo alla prima lettura, ma i permessi gia'
  // scritti nella SFU vanno riscritti da qualcuno. Ogni minuto, perche' e' la
  // granularita' con cui una fine annunciata alle 23:00 si sente alle 23:00 e
  // non l'indomani.
  const decadenza = setInterval(() => {
    void talk.moderazione
      .spazzaScadute()
      .catch((e) => talk.app.log.error({ err: e }, 'decadenza delle restrizioni fallita'));
  }, 60_000);
  decadenza.unref();

  const chiudi = async () => {
    talk.app.log.info('chiusura');
    clearInterval(spazzino);
    clearInterval(decadenza);
    talk.chiamate.spegni();
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
