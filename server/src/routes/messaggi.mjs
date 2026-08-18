// routes/messaggi.mjs - la chat che resta.
//
// A differenza della prima versione, dove i messaggi viaggiavano sul canale
// dati di WebRTC e sparivano con la chiamata, qui passano dal server e restano
// sul NAS. Il cambiamento non e' solo tecnico: una chat che resta e' una chat
// in cui si puo' scrivere a qualcuno che non c'e' ancora.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale, accessoAlloSpazio } from '../permessi.mjs';

const TESTO_MAX = 4000;

// Un'emoji, e nient'altro. Senza questo controllo una "reazione" potrebbe
// essere un paragrafo, e l'interfaccia che le dispone in riga si sfascerebbe.
//
// I pezzi invisibili sono scritti per punto di codice e non come carattere: lo
// ZWJ che unisce due figure in una (U+200D), il selettore che le rende
// colorate (U+FE0F) e le tonalita' della pelle. Scritti in chiaro sarebbero
// invisibili nel sorgente, e il primo editor che normalizza il file li
// mangerebbe senza che nessuno se ne accorga.
const EMOJI = new RegExp(
  '^\\p{Extended_Pictographic}' +
    '(\\u200d\\p{Extended_Pictographic}|[\\ufe0f\\u{1f3fb}-\\u{1f3ff}])*$',
  'u',
);

export function rotteMessaggi(app, { db, eventi }) {
  const membriDelloSpazio = (spazioId) => db.membriDi(spazioId).map((m) => m.id);

  // -- Leggere ---------------------------------------------------------------

  app.get(
    '/api/canali/:canale/messaggi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const prima = richiesta.query.prima ? Number(richiesta.query.prima) : null;
      const quanti = richiesta.query.quanti ? Number(richiesta.query.quanti) : 50;

      const messaggi = db.messaggi(esito.canale.id, { prima, quanti });
      return {
        messaggi,
        // Se ne sono tornati meno di quanti chiesti, non ce n'e' altri dietro:
        // il client puo' smettere di risalire senza una seconda chiamata a
        // vuoto ogni volta che si arriva in cima.
        altri: messaggi.length >= Math.min(quanti, 100),
      };
    },
  );

  // -- Scrivere --------------------------------------------------------------

  app.post(
    '/api/canali/:canale/messaggi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.canale.tipo !== 'testo') {
        return risposta.code(400).send({ errore: 'questo e\' un canale vocale' });
      }

      const { testo = '', rispondeA = null, allegati = [] } = richiesta.body ?? {};
      const pulito = String(testo).trim().slice(0, TESTO_MAX);
      const daLegare = Array.isArray(allegati) ? allegati.map(Number).filter(Number.isInteger) : [];

      // Un messaggio senza testo e senza allegati e' un a capo per sbaglio.
      if (!pulito && daLegare.length === 0) {
        return risposta.code(400).send({ errore: 'il messaggio e\' vuoto' });
      }

      // Si puo' rispondere solo a qualcosa che sta in questo canale: l'id di un
      // messaggio di un altro spazio produrrebbe una citazione che il
      // destinatario non ha il diritto di vedere.
      let citato = null;
      if (rispondeA) {
        const quello = db.messaggio(Number(rispondeA));
        if (quello && quello.canale === esito.canale.id) citato = quello.id;
      }

      const id = db.scriviMessaggio({
        canale: esito.canale.id,
        autore: richiesta.utente.id,
        testo: pulito,
        rispondeA: citato,
      });

      if (daLegare.length) db.legaAllegati(id, daLegare, richiesta.utente.id);

      // Chi scrive ha letto fin qui per definizione: senza questo, il proprio
      // messaggio comparirebbe fra i non letti.
      db.segnaLetto(esito.canale.id, richiesta.utente.id, id);

      const messaggio = db.messaggi(esito.canale.id, { prima: id + 1, quanti: 1 })[0];
      eventi.aUtenti(membriDelloSpazio(esito.spazio.id), {
        tipo: 'messaggio',
        spazio: esito.spazio.id,
        canale: esito.canale.id,
        messaggio,
      });

      return risposta.code(201).send({ messaggio });
    },
  );

  app.patch(
    '/api/messaggi/:messaggio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello) return risposta.code(404).send({ errore: 'messaggio inesistente' });

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Solo il proprio, e nemmeno un admin. Moderare significa togliere, non
      // riscrivere: un messaggio modificato da qualcun altro sarebbe una cosa
      // che uno non ha detto, con sopra il suo nome.
      if (quello.autore !== richiesta.utente.id) {
        return risposta.code(403).send({ errore: 'si possono modificare solo i propri messaggi' });
      }

      const testo = String(richiesta.body?.testo ?? '').trim().slice(0, TESTO_MAX);
      if (!testo) return risposta.code(400).send({ errore: 'il messaggio e\' vuoto' });

      db.modificaMessaggio(quello.id, testo);
      const messaggio = db.messaggi(quello.canale, { prima: quello.id + 1, quanti: 1 })[0];

      eventi.aUtenti(membriDelloSpazio(esito.spazio.id), {
        tipo: 'messaggio-modificato',
        spazio: esito.spazio.id,
        canale: quello.canale,
        messaggio,
      });
      return { messaggio };
    },
  );

  app.delete(
    '/api/messaggi/:messaggio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello) return risposta.code(404).send({ errore: 'messaggio inesistente' });

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Il proprio sempre; quello altrui solo se si modera lo spazio.
      const suo = quello.autore === richiesta.utente.id;
      if (!suo && esito.ruolo !== 'admin') {
        return risposta.code(403).send({ errore: 'non puoi eliminare i messaggi degli altri' });
      }

      db.eliminaMessaggio(quello.id);
      eventi.aUtenti(membriDelloSpazio(esito.spazio.id), {
        tipo: 'messaggio-eliminato',
        spazio: esito.spazio.id,
        canale: quello.canale,
        id: quello.id,
      });
      return { eliminato: quello.id };
    },
  );

  // -- Reazioni --------------------------------------------------------------

  app.post(
    '/api/messaggi/:messaggio/reazioni',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello || quello.eliminato) {
        return risposta.code(404).send({ errore: 'messaggio inesistente' });
      }

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const emoji = String(richiesta.body?.emoji ?? '');
      if (!EMOJI.test(emoji)) return risposta.code(400).send({ errore: 'serve una emoji' });

      // Premere due volte toglie, come ovunque: e' lo stesso gesto, e avere
      // due rotte per accendere e spegnere costringerebbe il client a sapere
      // gia' cosa aveva fatto.
      const tolta = db.togliReazione(quello.id, richiesta.utente.id, emoji);
      if (!tolta) db.reagisci(quello.id, richiesta.utente.id, emoji);

      const reazioni = db.reazioniDi(quello.id);
      eventi.aUtenti(membriDelloSpazio(esito.spazio.id), {
        tipo: 'reazioni',
        spazio: esito.spazio.id,
        canale: quello.canale,
        messaggio: quello.id,
        reazioni,
      });
      return { reazioni };
    },
  );

  // -- Non letti -------------------------------------------------------------

  app.post(
    '/api/canali/:canale/letto',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const fino = Number(richiesta.body?.fino) || db.ultimoMessaggioDi(esito.canale.id);
      db.segnaLetto(esito.canale.id, richiesta.utente.id, fino);
      return { fino };
    },
  );

  // -- Ricerca ---------------------------------------------------------------

  app.get(
    '/api/spazi/:spazio/cerca',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (!db.ricercaDisponibile) {
        return risposta.code(501).send({ errore: 'questa installazione non ha l\'indice di ricerca' });
      }

      const query = String(richiesta.query.q ?? '');
      const canale = richiesta.query.canale ? Number(richiesta.query.canale) : null;

      // Un canale di un altro spazio darebbe risultati che chi cerca non ha il
      // diritto di leggere.
      if (canale) {
        const suo = db.canale(canale);
        if (!suo || suo.spazio !== esito.spazio.id) {
          return risposta.code(404).send({ errore: 'canale inesistente' });
        }
      }

      return {
        risultati: db.cerca({
          spazio: esito.spazio.id,
          canale,
          query,
          utente: richiesta.utente.id,
          ruolo: esito.ruolo,
        }),
      };
    },
  );
}
