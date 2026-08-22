// Gestione minima dei bot interni: installazioni auditabili e revocabili, nessun token pubblico.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlloSpazio, richiedePermesso } from '../permessi.mjs';

export function rotteBot(app, { db, eventi }) {
  app.get('/api/spazi/:spazio/bot', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
    if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
    return { bot: db.botDiSpazio(esito.spazio.id) };
  });

  app.post('/api/spazi/:spazio/bot/assistente', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageServer');
    if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
    const bot = db.botInterno(esito.spazio.id, richiesta.utente.id);
    eventi.aUtenti(db.membriDi(esito.spazio.id).map((m) => m.id), { tipo: 'spazi' });
    return risposta.code(201).send({ bot: { id: bot.id, nome: bot.nome, avatar: bot.avatar ?? null, tipo: 'bot' } });
  });

  app.delete('/api/spazi/:spazio/bot/:bot', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageServer');
    if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
    const tolto = db.revocaBot(esito.spazio.id, Number(richiesta.params.bot));
    if (!tolto) return risposta.code(404).send({ errore: 'bot non installato in questo spazio' });
    eventi.aUtenti(db.membriDi(esito.spazio.id).map((m) => m.id), { tipo: 'spazi' });
    return { revocato: Number(richiesta.params.bot) };
  });
}
