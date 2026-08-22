// routes/amici.mjs - chiedere, accettare, smettere.
//
// Gli amici qui non aprono porte da soli: non danno accesso a uno spazio ne' a
// un canale. Servono a due cose concrete — avere sottomano le persone che si
// invitano piu' spesso in un canale privato, e sapere quando qualcuno c'e'.
// Un permesso che si eredita dall'essere amici sarebbe un permesso che nessuno
// ha mai concesso esplicitamente, ed e' il modo in cui si finisce dentro a
// stanze in cui non si doveva entrare.

import { richiedeRuolo } from '../auth.mjs';

export function rotteAmici(app, { db, eventi }) {
  /** Le tre liste, che il client disegna come tre sezioni. */
  app.get(
    '/api/amici',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => db.amicizieDi(richiesta.utente.id),
  );

  app.post(
    '/api/amici',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const { utente: id, nomeUtente } = richiesta.body ?? {};

      // Si puo' chiedere per id o per nome utente: dall'interfaccia arriva
      // l'id di una persona che si vede gia', ma cercare qualcuno per nome e'
      // il modo in cui si aggiunge chi non si e' mai incrociato.
      const chi = id
        ? db.utente(Number(id))
        : typeof nomeUtente === 'string'
          ? db.utentePerNomeUtente(nomeUtente.trim().toLowerCase())
          : null;
      if (!chi) return risposta.code(404).send({ errore: 'non trovo questa persona' });
      if ((chi.tipo ?? 'umano') === 'bot') {
        return risposta.code(400).send({ errore: 'i bot non usano il sistema di amicizie' });
      }

      const esito = db.chiediAmicizia(richiesta.utente.id, chi.id);
      if (esito.errore) return risposta.code(400).send({ errore: esito.errore });

      eventi.aUtenti([richiesta.utente.id, chi.id], { tipo: 'amici' });
      return risposta.code(201).send({ stato: esito.stato, utente: chi.id });
    },
  );

  app.post(
    '/api/amici/:utente/accetta',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const chi = Number(richiesta.params.utente);
      const esito = db.accettaAmicizia(richiesta.utente.id, chi);
      if (esito.errore) return risposta.code(400).send({ errore: esito.errore });

      eventi.aUtenti([richiesta.utente.id, chi], { tipo: 'amici' });
      return { stato: esito.stato };
    },
  );

  /** Rifiuta, annulla o smette: da fuori sono tre parole, dentro e' una riga in meno. */
  app.delete(
    '/api/amici/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta) => {
      const chi = Number(richiesta.params.utente);
      db.togliAmicizia(richiesta.utente.id, chi);
      eventi.aUtenti([richiesta.utente.id, chi], { tipo: 'amici' });
      return { tolto: chi };
    },
  );
}
