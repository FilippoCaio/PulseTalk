// routes/allegati.mjs - i file che accompagnano un messaggio.
//
// Il nome sul disco e' l'impronta del contenuto: due persone che
// mandano lo stesso meme occupano lo spazio di una. Niente multipart e nessuna
// dipendenza per analizzarlo — il corpo arriva grezzo e il nome del file sta in
// un'intestazione. Un byte che entra e' un byte che finisce sul disco, senza
// mai stare tutto in memoria.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { richiedeRuolo } from '../auth.mjs';

/**
 * Dove stanno i caricamenti a meta'.
 *
 * Due file per caricamento: i byte, e un `.json` accanto con nome, tipo,
 * dimensione promessa e chi lo sta mandando. Lo stato sta tutto qui e non in
 * memoria — cosi' un riavvio del server non fa perdere quello che e' gia'
 * salito, e la ripresa e' una `stat` invece di una struttura da ricostruire.
 */
function cartellaParziali(radice) {
  return join(radice, 'allegati', '.parziali');
}

function percorsoParziale(radice, id) {
  return join(cartellaParziali(radice), id);
}

/** Legge la scheda di un caricamento, o null se non esiste. */
async function schedaDi(radice, id) {
  // L'id arriva dal client: senza questo controllo, `../../` porterebbe a
  // leggere e scrivere dove non si deve.
  if (!/^[0-9a-f]{32}$/.test(String(id))) return null;
  const grezzo = await readFile(`${percorsoParziale(radice, id)}.json`, 'utf8').catch(() => null);
  if (!grezzo) return null;
  try {
    return JSON.parse(grezzo);
  } catch {
    return null;
  }
}

/**
 * Dove finisce un file, dato il suo contenuto.
 *
 * Due livelli di sottocartelle dai primi caratteri dell'impronta: con
 * diecimila allegati in una cartella sola, `ls` diventa lento e certi
 * filesystem cominciano a soffrire. E' la disposizione che usano git e quasi
 * tutti gli archivi indirizzati per contenuto.
 */
function percorsoDi(radice, impronta, estensione) {
  return join(radice, 'allegati', impronta.slice(0, 2), `${impronta}${estensione}`);
}

function estensioneDa(nome) {
  const punto = nome.lastIndexOf('.');
  if (punto <= 0 || nome.length - punto > 12) return '';
  return nome.slice(punto).toLowerCase().replace(/[^a-z0-9.]/g, '');
}

/** Salva byte prodotti da un servizio server-side usando lo stesso archivio deduplicato. */
export async function salvaAllegatoInterno({ db, config, utente, nome, tipo, corpo }) {
  if (!Buffer.isBuffer(corpo) || corpo.length === 0 || corpo.length > config.limiti.allegatoMax) {
    throw Object.assign(new Error('allegato interno non valido'), { statusCode: 422 });
  }
  const digest = createHash('sha256').update(corpo).digest('hex');
  const definitivo = percorsoDi(config.root, digest, estensioneDa(nome));
  await mkdir(dirname(definitivo), { recursive: true });
  const gia = await stat(definitivo).then(() => true).catch(() => false);
  if (!gia) await writeFile(definitivo, corpo, { flag: 'wx' }).catch((e) => {
    if (e.code !== 'EEXIST') throw e;
  });
  const id = db.aggiungiAllegato({ utente, nome, tipo, dimensione: corpo.length, impronta: digest });
  return { id, nome, tipo, dimensione: corpo.length };
}

/** Cosa si puo' mostrare in linea senza far scaricare niente. */
const IN_LINEA = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

export function rotteAllegati(app, { db, config }) {
  // Dentro a un plugin, come per il webhook della SFU: i parser di Fastify
  // sono incapsulati per contesto, e questo qui sotto accetta *qualunque*
  // tipo. Registrato sull'istanza principale renderebbe grezzo anche il corpo
  // JSON di tutte le altre rotte.
  return app.register(async (istanza) => {
    // Il corpo arriva grezzo — anzi, non arriva affatto: il parser consegna
    // il *flusso*, non i byte. E' cosi' che un file da cento megabyte scorre
    // dalla rete al disco senza mai stare tutto in memoria.
    //
    // Da qui in poi va letto `richiesta.body`, che e' quel flusso, e non
    // `richiesta.raw`: quello Fastify l'ha gia' consegnato al parser, e
    // leggerlo una seconda volta restituisce zero byte.
    istanza.addContentTypeParser('*', (richiesta, flusso, fatto) => fatto(null, flusso));

    rotte(istanza);
  });

  function rotte(app) {
    app.post(
    '/api/allegati',
    {
      onRequest: richiedeRuolo('membro'),
      bodyLimit: config.limiti.allegatoMax,
    },
    async (richiesta, risposta) => {
      const nome = String(richiesta.headers['x-nome'] ?? 'file')
        .replace(/[\r\n]/g, '')
        .slice(0, 120);
      const tipo = String(richiesta.headers['content-type'] ?? 'application/octet-stream')
        .split(';')[0]
        .slice(0, 80);

      const estensione = estensioneDa(nome);

      // Si scrive prima in un file d'appoggio, perche' l'impronta si conosce
      // solo quando i byte sono finiti. Poi si sposta sul nome definitivo:
      // `rename` sullo stesso filesystem e' atomico, quindi non esiste un
      // istante in cui il nome giusto punta a un file a meta'.
      const appoggio = join(config.root, 'allegati', `.incoming-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(dirname(appoggio), { recursive: true });

      const digestore = createHash('sha256');
      let dimensione = 0;

      try {
        await pipeline(
          richiesta.body,
          async function* (sorgente) {
            for await (const pezzo of sorgente) {
              digestore.update(pezzo);
              dimensione += pezzo.length;
              yield pezzo;
            }
          },
          createWriteStream(appoggio),
        );
      } catch (errore) {
        await rm(appoggio, { force: true });
        richiesta.log.warn({ err: errore }, 'caricamento interrotto');
        return risposta.code(400).send({ errore: 'il caricamento si e\' interrotto' });
      }

      if (dimensione === 0) {
        await rm(appoggio, { force: true });
        return risposta.code(400).send({ errore: 'il file e\' vuoto' });
      }

      const impronta = digestore.digest('hex');
      const definitivo = percorsoDi(config.root, impronta, estensione);
      await mkdir(dirname(definitivo), { recursive: true });

      // Se quel contenuto c'e' gia', il file d'appoggio si butta: e'
      // identico, byte per byte, a quello che c'e' sul disco.
      const gia = await stat(definitivo).then(() => true).catch(() => false);
      if (gia) await rm(appoggio, { force: true });
      else await rename(appoggio, definitivo);

      const id = db.aggiungiAllegato({
        utente: richiesta.utente.id,
        nome,
        tipo,
        dimensione,
        impronta,
      });

      richiesta.log.info({ utente: richiesta.utente.id, dimensione, gia }, 'allegato caricato');
      return risposta.code(201).send({ id, nome, tipo, dimensione });
    },
  );

  // -- Il caricamento a pezzi -------------------------------------------------
  //
  // Serve a due cose, e la seconda conta piu' della prima. La prima e' poter
  // mandare file piu' grandi di quanto una singola richiesta regga. La
  // seconda: su una linea di casa un caricamento da un'ora cade, e senza pezzi
  // riparte da zero — con i pezzi riparte da dove era arrivato.
  //
  // Cio' che i pezzi *non* risolvono e' la banda: quattro giga passano per lo
  // stesso cavo in salita, spezzati o interi. A quello serve la pausa fra un
  // pezzo e l'altro, e la decide il client, che e' l'unico che sa se in questo
  // momento c'e' una chiamata in corso.

  app.post(
    '/api/allegati/inizio',
    { onRequest: richiedeRuolo('membro'), bodyLimit: 1024 },
    async (richiesta, risposta) => {
      richiesta.body?.resume?.();

      const nome = String(richiesta.headers['x-nome'] ?? 'file')
        .replace(/[\r\n]/g, '')
        .slice(0, 120);
      const tipo = String(richiesta.headers['x-tipo'] ?? 'application/octet-stream')
        .split(';')[0]
        .slice(0, 80);
      const dimensione = Number(richiesta.headers['x-dimensione']);

      if (!Number.isSafeInteger(dimensione) || dimensione <= 0) {
        return risposta.code(400).send({ errore: 'dimensione mancante o non valida' });
      }
      if (dimensione > config.limiti.allegatoMax) {
        return risposta
          .code(413)
          .send({ errore: 'file troppo grande', massimo: config.limiti.allegatoMax });
      }

      const id = randomBytes(16).toString('hex');
      const parziale = percorsoParziale(config.root, id);
      await mkdir(dirname(parziale), { recursive: true });

      // Il file dei byte nasce vuoto: da qui in poi la sua dimensione *e'* lo
      // stato del caricamento, e non c'e' un secondo posto che possa dire una
      // cosa diversa.
      await writeFile(parziale, '');
      await writeFile(
        `${parziale}.json`,
        JSON.stringify({ utente: richiesta.utente.id, nome, tipo, dimensione, iniziato: Date.now() }),
        'utf8',
      );

      richiesta.log.info({ utente: richiesta.utente.id, dimensione }, 'caricamento a pezzi aperto');
      return risposta
        .code(201)
        .send({ id, pezzo: config.limiti.allegatoPezzo, ricevuti: 0, dimensione });
    },
  );

  app.get(
    '/api/allegati/:id/stato',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const scheda = await schedaDi(config.root, richiesta.params.id);
      if (!scheda || scheda.utente !== richiesta.utente.id) {
        return risposta.code(404).send({ errore: 'caricamento inesistente' });
      }

      const informazioni = await stat(percorsoParziale(config.root, richiesta.params.id)).catch(
        () => null,
      );
      return risposta.send({
        ricevuti: informazioni?.size ?? 0,
        dimensione: scheda.dimensione,
        pezzo: config.limiti.allegatoPezzo,
      });
    },
  );

  app.put(
    '/api/allegati/:id/pezzo',
    {
      onRequest: richiedeRuolo('membro'),
      // Un pezzo, piu' il margine per l'inevitabile arrotondamento. Il tetto
      // vero del file non c'entra: qui non passa mai piu' di un pezzo.
      bodyLimit: config.limiti.allegatoPezzo + 64 * 1024,
    },
    async (richiesta, risposta) => {
      const scheda = await schedaDi(config.root, richiesta.params.id);
      if (!scheda || scheda.utente !== richiesta.utente.id) {
        richiesta.body?.resume?.();
        return risposta.code(404).send({ errore: 'caricamento inesistente' });
      }

      const parziale = percorsoParziale(config.root, richiesta.params.id);
      const prima = (await stat(parziale).catch(() => null))?.size ?? 0;
      const offset = Number(richiesta.headers['x-offset']);

      // Si scrive solo in coda, e solo se il client e' d'accordo su dove sia
      // la coda. Un pezzo che arriva due volte, o fuori ordine, verrebbe
      // appeso lo stesso e il file finirebbe giusto di dimensione e sbagliato
      // di contenuto: se ne accorgerebbe solo chi apre il file, domani.
      if (!Number.isSafeInteger(offset) || offset !== prima) {
        richiesta.body?.resume?.();
        return risposta.code(409).send({ errore: 'pezzo fuori posto', ricevuti: prima });
      }

      try {
        await pipeline(richiesta.body, createWriteStream(parziale, { flags: 'a' }));
      } catch (errore) {
        // Il troncone resta: e' proprio il punto da cui si riprende.
        richiesta.log.warn({ err: errore }, 'pezzo interrotto');
        return risposta.code(400).send({ errore: 'il pezzo si e\' interrotto', ricevuti: prima });
      }

      const dopo = (await stat(parziale)).size;
      if (dopo > scheda.dimensione) {
        // Piu' byte di quanti ne erano stati promessi: si torna alla misura di
        // prima e si dice di no. Senza questo, la dimensione dichiarata
        // all'inizio non sarebbe un limite ma un suggerimento.
        await truncate(parziale, prima).catch(() => {});
        return risposta.code(413).send({ errore: 'piu\' byte del previsto', ricevuti: prima });
      }

      return risposta.send({ ricevuti: dopo, dimensione: scheda.dimensione });
    },
  );

  app.post(
    '/api/allegati/:id/fine',
    { onRequest: richiedeRuolo('membro'), bodyLimit: 1024 },
    async (richiesta, risposta) => {
      richiesta.body?.resume?.();

      const scheda = await schedaDi(config.root, richiesta.params.id);
      if (!scheda || scheda.utente !== richiesta.utente.id) {
        return risposta.code(404).send({ errore: 'caricamento inesistente' });
      }

      const parziale = percorsoParziale(config.root, richiesta.params.id);
      const informazioni = await stat(parziale).catch(() => null);
      if (!informazioni || informazioni.size !== scheda.dimensione) {
        return risposta.code(409).send({
          errore: 'il caricamento non e\' completo',
          ricevuti: informazioni?.size ?? 0,
          dimensione: scheda.dimensione,
        });
      }

      // L'impronta si calcola adesso, rileggendo il file.
      //
      // Si potrebbe tenerla aggiornata pezzo per pezzo, ma vorrebbe dire
      // conservare lo stato dell'hash in memoria fra una richiesta e l'altra —
      // e allora un riavvio del server, o un secondo processo, renderebbero
      // impossibile finire un caricamento gia' quasi arrivato. Una rilettura
      // dal disco locale costa molto meno di quello che e' appena salito dalla
      // rete.
      const digestore = createHash('sha256');
      for await (const blocco of createReadStream(parziale)) digestore.update(blocco);
      const impronta = digestore.digest('hex');

      const definitivo = percorsoDi(config.root, impronta, estensioneDa(scheda.nome));
      await mkdir(dirname(definitivo), { recursive: true });

      const gia = await stat(definitivo).then(() => true).catch(() => false);
      if (gia) await rm(parziale, { force: true });
      else await rename(parziale, definitivo);
      await rm(`${parziale}.json`, { force: true });

      const id = db.aggiungiAllegato({
        utente: richiesta.utente.id,
        nome: scheda.nome,
        tipo: scheda.tipo,
        dimensione: scheda.dimensione,
        impronta,
      });

      richiesta.log.info(
        { utente: richiesta.utente.id, dimensione: scheda.dimensione, gia },
        'allegato caricato a pezzi',
      );
      return risposta
        .code(201)
        .send({ id, nome: scheda.nome, tipo: scheda.tipo, dimensione: scheda.dimensione });
    },
  );

  app.get(
    '/api/allegati/:id',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const allegato = db.allegato(Number(richiesta.params.id));
      if (!allegato) return risposta.code(404).send({ errore: 'allegato inesistente' });

      // Un allegato gia' mandato si vede solo se si ha accesso al suo canale.
      // Uno non ancora mandato lo vede solo chi l'ha caricato: e' il suo,
      // nessun altro sa nemmeno che esiste.
      if (allegato.messaggio) {
        const messaggio = db.messaggio(allegato.messaggio);
        const canale = messaggio && db.canale(messaggio.canale);
        const ruolo = canale && db.ruoloNelloSpazio(canale.spazio, richiesta.utente);
        if (!ruolo) return risposta.code(404).send({ errore: 'allegato inesistente' });
      } else if (allegato.utente !== richiesta.utente.id) {
        return risposta.code(404).send({ errore: 'allegato inesistente' });
      }

      const percorso = percorsoDi(config.root, allegato.impronta, estensioneDa(allegato.nome));
      const informazioni = await stat(percorso).catch(() => null);
      if (!informazioni) {
        richiesta.log.error({ allegato: allegato.id }, 'il file non c\'e\' piu\' sul disco');
        return risposta.code(410).send({ errore: 'il file non c\'e\' piu\'' });
      }

      // Le immagini si mostrano, il resto si scarica. Senza `attachment` un
      // HTML caricato da qualcuno verrebbe aperto dal browser sullo stesso
      // dominio dell'app, e potrebbe leggerne la sessione.
      const inLinea = IN_LINEA.has(allegato.tipo);
      risposta
        .header('content-type', inLinea ? allegato.tipo : 'application/octet-stream')
        .header(
          'content-disposition',
          `${inLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(allegato.nome)}`,
        )
        // Volutamente senza `content-length`. Dichiararla e poi consegnare uno
        // stream fa scegliere a Fastify la codifica a blocchi, e il client
        // resta ad aspettare i byte promessi dall'intestazione che non
        // arriveranno mai: la richiesta si chiude solo quando scade il timeout
        // della connessione, dopo piu' di un minuto.
        //
        // La dimensione vera la sa gia' il client: sta nei metadati
        // dell'allegato, che ha ricevuto insieme al messaggio.
        .header('cache-control', 'private, max-age=31536000, immutable');

      const { createReadStream } = await import('node:fs');
      return risposta.send(createReadStream(percorso));
      },
    );
  }
}

/**
 * Butta via i file caricati e mai mandati.
 *
 * Succede a chi trascina un'immagine e poi cambia idea: il file e' gia' sul
 * disco, ma nessun messaggio lo nomina. Un giro ogni sei ore, e si toccano
 * solo quelli piu' vecchi di un giorno — chi sta ancora scrivendo il messaggio
 * non deve vedersi sparire l'allegato sotto le mani.
 */
export async function spazzaAllegati(db, config, log) {
  const soglia = Date.now() - 24 * 3600_000;
  const orfani = db.allegatiOrfani(soglia);
  if (orfani.length === 0) return 0;

  let tolti = 0;
  for (const orfano of orfani) {
    // L'estensione si ricava dal nome *prima* di cancellare il record: dopo,
    // il percorso sul disco non si saprebbe piu' ricostruire e resterebbe li'
    // un file che nessuno nomina piu'.
    const percorso = percorsoDi(config.root, orfano.impronta, estensioneDa(orfano.nome));
    db.eliminaAllegato(orfano.id);

    // Il file si cancella solo se nessun altro allegato usa quella stessa
    // impronta: due persone possono aver caricato lo stesso file, e uno dei
    // due averlo mandato davvero.
    if (!db.improntaOrfana(orfano.impronta)) continue;
    await rm(percorso, { force: true }).catch(() => {});
    tolti += 1;
  }

  log?.info({ tolti }, 'allegati mai mandati, buttati');
  return tolti;
}

/**
 * Butta via i caricamenti a pezzi lasciati a meta'.
 *
 * Un file da un giga interrotto a meta' e mai ripreso resta un mezzo giga sul
 * disco che nessun messaggio nomina e nessuna spazzata degli allegati vede:
 * quella guarda il database, e un troncone nel database non c'e' ancora.
 *
 * Ventiquattro ore, come per gli orfani, e per la stessa ragione: chi ha
 * chiuso il portatile a caricamento aperto deve poterlo riprendere il giorno
 * dopo.
 */
export async function spazzaParziali(config, log) {
  const cartella = cartellaParziali(config.root);
  const dentro = await readdir(cartella).catch(() => []);
  if (dentro.length === 0) return 0;

  const soglia = Date.now() - 24 * 3600_000;
  let tolti = 0;

  for (const voce of dentro) {
    if (voce.endsWith('.json')) continue;

    const parziale = join(cartella, voce);
    const scheda = await schedaDi(config.root, voce);

    // Senza scheda non si sa nemmeno di chi sia: e' spazzatura comunque, ma la
    // data di modifica del file evita di buttare qualcosa di vivo.
    const quando = scheda?.iniziato ?? (await stat(parziale).catch(() => null))?.mtimeMs ?? 0;
    if (quando > soglia) continue;

    await rm(parziale, { force: true }).catch(() => {});
    await rm(`${parziale}.json`, { force: true }).catch(() => {});
    tolti += 1;
  }

  if (tolti > 0) log?.info({ tolti }, 'caricamenti a meta\', buttati');
  return tolti;
}
