// routes/allegati.mjs - i file che accompagnano un messaggio.
//
// Il nome sul disco e' l'impronta del contenuto: due persone che
// mandano lo stesso meme occupano lo spazio di una. Niente multipart e nessuna
// dipendenza per analizzarlo — il corpo arriva grezzo e il nome del file sta in
// un'intestazione. Un byte che entra e' un byte che finisce sul disco, senza
// mai stare tutto in memoria.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { richiedeRuolo } from '../auth.mjs';

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
