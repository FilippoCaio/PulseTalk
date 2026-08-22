// routes/diretti.mjs - i messaggi diretti, e il telefono che ci sta dentro.
//
// I messaggi non passano di qui. Una conversazione diretta e' un canale (vedi
// dati/diretti.mjs), quindi scrivere, rileggere, modificare, cancellare,
// reagire, allegare e segnare come letto sono gia' le rotte dei canali — le
// stesse, senza una riga in piu' da tenere allineata.
//
// Qui c'e' solo cio' che ai canali normali non serve: l'elenco delle
// conversazioni con l'ultimo messaggio e i non letti, e la chiamata diretta
// con il suo momento di squillo.

import { richiedeRuolo } from '../auth.mjs';
import { creaGettone } from '../sfu.mjs';

export function rotteDiretti(app, { db, config, presenze, eventi, chiamate, stati }) {
  /**
   * La conversazione, se e' tua.
   *
   * Il 404 anche quando esiste ma e' di altri e' la stessa scelta fatta per
   * spazi e canali: un 403 direbbe comunque che quelle due persone si parlano.
   */
  function mia(richiesta) {
    const conversazione = db.diretti.perId(Number(richiesta.params.conversazione));
    if (!conversazione) return { errore: 'conversazione inesistente', stato: 404 };
    if (conversazione.uno !== richiesta.utente.id && conversazione.due !== richiesta.utente.id) {
      return { errore: 'conversazione inesistente', stato: 404 };
    }
    return { conversazione, altro: db.diretti.altro(conversazione, richiesta.utente.id) };
  }

  // -- Le conversazioni ------------------------------------------------------

  app.get(
    '/api/diretti',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => ({
      // Lo stato passa da `stati.visibile` come dappertutto. Qui prima usciva
      // la parola salvata cosi' com'era: chi si era messo invisibile compariva
      // *invisibile* nell'elenco delle conversazioni, che e' esattamente la
      // cosa che invisibile deve impedire.
      conversazioni: db.diretti.mie(richiesta.utente.id).map((c) => ({
        ...c,
        con: c.con ? { ...c.con, stato: stati.visibile(c.con) } : null,
      })),
    }),
  );

  /**
   * Apre una conversazione, o restituisce quella che c'era.
   *
   * Non serve essere amici: qui dentro si entra su invito e ci si conosce
   * tutti. Serve pero' che l'altro esista e non sia se stessi.
   */
  app.post(
    '/api/diretti',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const { utente, nomeUtente } = richiesta.body ?? {};
      const chi = utente
        ? db.utente(Number(utente))
        : typeof nomeUtente === 'string'
          ? db.utentePerNomeUtente(nomeUtente.trim().toLowerCase())
          : null;
      if (!chi) return risposta.code(404).send({ errore: 'non trovo questa persona' });

      const esito = db.diretti.conversazione(richiesta.utente.id, chi.id);
      if (esito.errore) return risposta.code(400).send({ errore: esito.errore });

      // A tutti e due: chi riceve deve vedere comparire la conversazione anche
      // se in quel momento sta guardando un'altra finestra.
      eventi.aUtenti(db.diretti.destinatari(esito.conversazione), { tipo: 'diretti' });

      const mie = db.diretti.mie(richiesta.utente.id);
      return risposta
        .code(201)
        .send({ conversazione: mie.find((c) => c.id === esito.conversazione.id) ?? null });
    },
  );

  app.get(
    '/api/diretti/:conversazione',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = mia(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const riassunto = db.diretti.mie(richiesta.utente.id).find((c) => c.id === esito.conversazione.id);
      return {
        conversazione: riassunto ?? null,
        chiamata: chiamate.attiva(esito.conversazione.id),
      };
    },
  );

  // -- La chiamata -----------------------------------------------------------

  /** Il gettone per entrare nella stanza di questa conversazione. */
  async function gettonePer(utente, chiave) {
    return creaGettone({
      utente,
      stanza: { chiave, soloAscolto: false },
      config,
      moderatore: false,
    });
  }

  function ingresso(gettone, conversazione, altro) {
    const chi = db.utente(altro);
    return {
      gettone,
      sfuUrl: config.sfuUrl,
      canale: {
        // Id negativo, e non e' un trucco sporco: e' il modo di dire "questo
        // non e' un canale dello spazio" a un client che tiene un id solo per
        // sapere dove sta parlando. Nessuna rotta lo riceve mai indietro.
        id: -conversazione.id,
        nome: chi?.nome ?? 'Chiamata',
        spazio: 0,
        soloAscolto: false,
      },
      diretta: { conversazione: conversazione.id, con: altro },
      permessi: {
        puoTrasmettere: true,
        puoAscoltare: true,
        puoScrivere: true,
        puoCondividere: true,
        moderatore: false,
      },
      limiti: config.limiti,
    };
  }

  app.post(
    '/api/diretti/:conversazione/chiamata',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = mia(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (chiamate.occupato(richiesta.utente.id, esito.conversazione.id)) {
        return risposta.code(409).send({ errore: 'sei gia\' in una chiamata' });
      }
      if (chiamate.occupato(esito.altro, esito.conversazione.id)) {
        return risposta.code(409).send({ errore: 'questa persona e\' gia\' in una chiamata' });
      }

      const chiave = db.diretti.chiaveChiamata(esito.conversazione);
      try {
        await presenze.assicuraStanza(chiave, { personeMax: 2 });
      } catch (errore) {
        richiesta.log.warn({ err: errore, stanza: chiave }, 'la SFU non risponde');
      }

      const avviata = chiamate.avvia({
        conversazione: esito.conversazione.id,
        stanza: chiave,
        da: richiesta.utente.id,
        a: esito.altro,
      });

      const gettone = await gettonePer(richiesta.utente, chiave);
      return risposta.code(201).send({
        chiamata: avviata.chiamata,
        ingresso: ingresso(gettone, esito.conversazione, esito.altro),
      });
    },
  );

  app.post(
    '/api/diretti/:conversazione/chiamata/accetta',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = mia(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const accettata = chiamate.accetta(esito.conversazione.id, richiesta.utente.id);
      if (accettata.errore) return risposta.code(409).send({ errore: accettata.errore });

      const gettone = await gettonePer(richiesta.utente, accettata.chiamata.stanza);
      return {
        chiamata: accettata.chiamata,
        ingresso: ingresso(gettone, esito.conversazione, esito.altro),
      };
    },
  );

  app.post(
    '/api/diretti/:conversazione/chiamata/chiudi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = mia(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const motivo = richiesta.body?.motivo === 'rifiutata' ? 'rifiutata' : 'chiusa';
      const chiusa = await chiamate.chiudi(esito.conversazione.id, richiesta.utente.id, motivo);
      if (chiusa.errore) return risposta.code(409).send({ errore: chiusa.errore });
      return { ok: true };
    },
  );
}
