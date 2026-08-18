// routes/spazi.mjs - spazi, categorie, canali, e il flusso degli eventi.

import { richiedeRuolo } from '../auth.mjs';
import { apriFlusso } from '../eventi.mjs';
import { accessoAlCanale, accessoAlloSpazio, puoInvitare, puoTrasmettere } from '../permessi.mjs';
import { creaGettone } from '../sfu.mjs';

export function rotteSpazi(app, { db, config, presenze, eventi }) {
  /** A chi va detto che qualcosa e' cambiato qui dentro. */
  const membriDelloSpazio = (spazioId) => db.membriDi(spazioId).map((m) => m.id);

  const avvisa = (spazioId, evento) => eventi.aUtenti(membriDelloSpazio(spazioId), evento);

  // -- Cosa c'e' -------------------------------------------------------------

  /**
   * Tutto quello che serve a disegnare le tre colonne, in una chiamata.
   *
   * Spazi, categorie, canali, quanti non letti, e chi sta dentro ai canali
   * vocali. Sono cinque interrogazioni al database e una alla SFU: farne
   * cinque chiamate HTTP separate significherebbe cinque giri di rete su una
   * connessione che magari passa da un telefono.
   */
  app.get(
    '/api/spazi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => {
      const dentro = await presenze.leggi();
      const miei = db.spaziDi(richiesta.utente.id);

      return {
        spazi: miei.map((spazio) => {
          const canali = db.canaliVisibili(spazio.id, richiesta.utente.id, spazio.ruoloMio);
          const nonLetti = new Map(db.nonLetti(richiesta.utente.id, spazio.id).map((r) => [r.canale, r.quanti]));

          return {
            id: spazio.id,
            chiave: spazio.chiave,
            nome: spazio.nome,
            icona: spazio.icona,
            ruoloMio: spazio.ruoloMio,
            categorie: db.categorieDi(spazio.id),
            canali: canali.map((canale) => ({
              id: canale.id,
              chiave: canale.chiave,
              nome: canale.nome,
              tipo: canale.tipo,
              argomento: canale.argomento,
              categoria: canale.categoria,
              posizione: canale.posizione,
              soloAscolto: canale.soloAscolto,
              privato: canale.privato,
              nonLetti: canale.tipo === 'testo' ? (nonLetti.get(canale.id) ?? 0) : 0,
              presenti: canale.tipo === 'voce' ? (dentro.get(db.chiaveSfu(canale)) ?? []) : [],
            })),
          };
        }),
      };
    },
  );

  /**
   * Il flusso degli eventi: uno per persona, ci passa dentro tutto.
   *
   * Non manda lo stato iniziale — quello lo prende `GET /api/spazi`. Cosi' la
   * riconnessione e' banale: si riapre il flusso e si rilegge lo stato, senza
   * dover riconciliare cio' che e' successo mentre la linea era giu'.
   */
  app.get(
    '/api/eventi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const { manda, chiudi } = apriFlusso(richiesta, risposta);
      const disiscrivi = eventi.iscrivi(richiesta.utente.id, manda);

      richiesta.raw.on('close', () => {
        disiscrivi();
        chiudi();
      });

      // Fastify non deve considerare conclusa la richiesta: la risposta resta
      // aperta finche' non se ne va il client.
      return risposta;
    },
  );

  // -- Spazi -----------------------------------------------------------------

  app.post(
    '/api/spazi',
    { onRequest: richiedeRuolo('admin') },
    async (richiesta, risposta) => {
      const { nome, icona = null } = richiesta.body ?? {};
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const esito = db.creaSpazio({
        nome: nome.trim().slice(0, 60),
        icona: typeof icona === 'string' ? icona.slice(0, 8) : null,
        creatoDa: richiesta.utente.id,
      });
      if (esito.errore) return risposta.code(409).send({ errore: esito.errore });

      // Su un'istanza di casa uno spazio nuovo e' per tutti: chi c'e' gia' non
      // deve aspettare un invito per una cosa che e' stata creata in casa sua.
      for (const u of db.elencoProfili()) db.aggiungiMembro(esito.spazio.id, u.id);

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ spazio: esito.spazio });
    },
  );

  app.delete(
    '/api/spazi/:spazio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Si avvisa prima di cancellare: dopo, i membri non ci sono piu' e non
      // c'e' piu' nessuno a cui dirlo.
      const destinatari = membriDelloSpazio(esito.spazio.id);

      // I canali vocali vivi vanno chiusi sulla SFU, o chi ci sta dentro
      // continua a parlare in un posto che non esiste piu'.
      for (const canale of db.canaliDi(esito.spazio.id)) {
        if (canale.tipo !== 'voce') continue;
        await presenze.chiudiStanza(db.chiaveSfu(canale)).catch(() => {});
      }

      db.eliminaSpazio(esito.spazio.id);
      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return { eliminato: esito.spazio.id };
    },
  );

  app.get(
    '/api/spazi/:spazio/membri',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return { membri: db.membriDi(esito.spazio.id) };
    },
  );

  app.post(
    '/api/spazi/:spazio/membri',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.body?.utente);
      if (!db.utente(chi)) return risposta.code(404).send({ errore: 'utente inesistente' });

      db.aggiungiMembro(esito.spazio.id, chi, richiesta.body?.ruolo === 'admin' ? 'admin' : 'membro');
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return { aggiunto: chi };
    },
  );

  app.delete(
    '/api/spazi/:spazio/membri/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.params.utente);
      const destinatari = membriDelloSpazio(esito.spazio.id);
      db.togliMembro(esito.spazio.id, chi);
      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return { tolto: chi };
    },
  );

  // -- Categorie -------------------------------------------------------------

  app.post(
    '/api/spazi/:spazio/categorie',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const nome = richiesta.body?.nome;
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const categoria = db.creaCategoria(esito.spazio.id, nome.trim().slice(0, 40));
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ categoria });
    },
  );

  app.delete(
    '/api/spazi/:spazio/categorie/:categoria',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      db.eliminaCategoria(Number(richiesta.params.categoria));
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { ok: true };
    },
  );

  // -- Canali ----------------------------------------------------------------

  app.post(
    '/api/spazi/:spazio/canali',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const {
        nome,
        tipo,
        categoria = null,
        argomento = '',
        soloAscolto = false,
        privato = false,
        invitati = [],
      } = richiesta.body ?? {};
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const creato = db.creaCanale(esito.spazio.id, {
        nome: nome.trim().slice(0, 40),
        tipo,
        categoria: categoria ? Number(categoria) : null,
        argomento: String(argomento).slice(0, 200),
        soloAscolto: !!soloAscolto,
        privato: !!privato,
      });
      if (creato.errore) return risposta.code(400).send({ errore: creato.errore });

      if (creato.canale.privato) {
        // Chi lo crea ci entra da solo: un canale privato senza nemmeno il suo
        // autore dentro sarebbe una stanza chiusa a chiave dall'esterno.
        db.iscrivi(creato.canale.id, richiesta.utente.id, richiesta.utente.id);
        for (const chi of Array.isArray(invitati) ? invitati : []) {
          if (db.ruoloNelloSpazio(esito.spazio.id, { id: Number(chi), ruolo: 'membro' })) {
            db.iscrivi(creato.canale.id, Number(chi), richiesta.utente.id);
          }
        }
      }

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ canale: creato.canale });
    },
  );

  app.patch(
    '/api/canali/:canale',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { nome, argomento, categoria, posizione, soloAscolto, privato } = richiesta.body ?? {};
      db.aggiornaCanale(esito.canale.id, {
        nome: typeof nome === 'string' ? nome.trim().slice(0, 40) : undefined,
        argomento: typeof argomento === 'string' ? argomento.slice(0, 200) : undefined,
        categoria: categoria === undefined ? undefined : categoria === null ? null : Number(categoria),
        posizione: posizione === undefined ? undefined : Number(posizione),
        soloAscolto,
        privato,
      });

      // Un canale che diventa privato adesso non ha iscritti: senza questa
      // riga sparirebbe dagli occhi di tutti, compreso chi lo ha appena chiuso.
      if (privato === true && !db.eIscritto(esito.canale.id, richiesta.utente.id)) {
        db.iscrivi(esito.canale.id, richiesta.utente.id, richiesta.utente.id);
      }

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { canale: db.canale(esito.canale.id) };
    },
  );

  app.delete(
    '/api/canali/:canale',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (esito.canale.tipo === 'voce') {
        await presenze.chiudiStanza(db.chiaveSfu(esito.canale)).catch(() => {});
      }
      db.eliminaCanale(esito.canale.id);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { eliminato: esito.canale.id };
    },
  );

  // -- Chi sta dentro a un canale privato ------------------------------------

  app.get(
    '/api/canali/:canale/iscritti',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return { iscritti: db.iscrittiAlCanale(esito.canale.id) };
    },
  );

  app.post(
    '/api/canali/:canale/iscritti',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (!esito.canale.privato) {
        return risposta.code(400).send({ errore: 'questo canale lo vedono gia\' tutti' });
      }
      if (!puoInvitare(db, richiesta.utente, esito.canale, esito.ruolo)) {
        return risposta.code(403).send({ errore: 'per invitare bisogna essere dentro' });
      }

      const chi = Number(richiesta.body?.utente);
      if (!db.utente(chi)) return risposta.code(404).send({ errore: 'utente inesistente' });
      // Dentro a un canale ci si sta solo se si sta nello spazio che lo
      // contiene: un invito non deve essere una porta laterale.
      if (!db.ruoloNelloSpazio(esito.spazio.id, { id: chi, ruolo: 'membro' })) {
        return risposta.code(400).send({ errore: 'questa persona non e\' in questo spazio' });
      }

      db.iscrivi(esito.canale.id, chi, richiesta.utente.id);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return risposta.code(201).send({ iscritti: db.iscrittiAlCanale(esito.canale.id) });
    },
  );

  app.delete(
    '/api/canali/:canale/iscritti/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.params.utente);
      // Se stesso sempre — si esce da un canale senza chiedere il permesso —
      // gli altri solo se si e' admin dello spazio.
      if (chi !== richiesta.utente.id && esito.ruolo !== 'admin') {
        return risposta.code(403).send({ errore: 'serve essere admin di questo spazio' });
      }

      db.disiscrivi(esito.canale.id, chi);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return { tolto: chi };
    },
  );

  // -- Moderare un canale vocale ---------------------------------------------
  //
  // Passa da qui e non dal gettone: il permesso di moderare non viaggia con il
  // client, quindi togliere il ruolo a un admin ha effetto alla richiesta
  // successiva invece che alla scadenza del suo gettone, sei ore dopo.

  app.post(
    '/api/canali/:canale/caccia',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const identita = richiesta.body?.identita;
      if (typeof identita !== 'string' || !identita) {
        return risposta.code(400).send({ errore: 'serve l\'identita\' di chi va cacciato' });
      }

      await presenze.caccia(db.chiaveSfu(esito.canale), identita);
      avvisa(esito.spazio.id, { tipo: 'presenza', spazio: esito.spazio.id });
      richiesta.log.info(
        { da: richiesta.utente.id, chi: identita, canale: esito.canale.id },
        'cacciato',
      );
      return { cacciato: identita };
    },
  );

  // -- Entrare in un canale vocale -------------------------------------------

  app.post(
    '/api/canali/:canale/entra',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.canale.tipo !== 'voce') {
        return risposta.code(400).send({ errore: 'questo e\' un canale di testo' });
      }

      const chiave = db.chiaveSfu(esito.canale);

      // La stanza deve esistere sulla SFU prima che il gettone arrivi li'.
      // Con `auto_create` spento non nasce da sola, e un gettone per una
      // stanza inesistente produce un 404 a ogni tentativo: il client riprova,
      // rinuncia, e sembra che la chiamata entri e esca subito.
      try {
        await presenze.assicuraStanza(chiave, { personeMax: config.limiti.personePerStanza });
      } catch (errore) {
        richiesta.log.warn({ err: errore, canale: chiave }, 'la SFU non risponde');
      }

      const trasmette = puoTrasmettere({
        utente: richiesta.utente,
        ruoloSpazio: esito.ruolo,
        canale: esito.canale,
      });

      const gettone = await creaGettone({
        utente: richiesta.utente,
        stanza: { chiave, soloAscolto: !trasmette },
        config,
        moderatore: esito.ruolo === 'admin',
      });

      return {
        gettone,
        sfuUrl: config.sfuUrl,
        canale: {
          id: esito.canale.id,
          nome: esito.canale.nome,
          spazio: esito.spazio.id,
          soloAscolto: esito.canale.soloAscolto,
        },
        permessi: {
          puoTrasmettere: trasmette,
          puoAscoltare: true,
          puoScrivere: true,
          moderatore: esito.ruolo === 'admin',
        },
        limiti: config.limiti,
      };
    },
  );
}
