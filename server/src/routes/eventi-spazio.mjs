// routes/eventi-spazio.mjs - l'agenda di uno spazio.
//
// Chi ha createEvents ne crea e gestisce i propri; chi ha manageEvents tocca
// anche quelli degli altri. Sono due permessi e non uno perche' sono due cose
// diverse: organizzare una serata e riscrivere la serata di qualcun altro.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlloSpazio, richiedePermesso } from '../permessi.mjs';

/** Il piu' lontano che accettiamo: due anni. Oltre e' quasi sempre un errore di unita'. */
const LONTANO = 2 * 365 * 86400;

function istanteValido(grezzo) {
  const n = Number(grezzo);
  if (!Number.isFinite(n)) return null;
  // Millisecondi scambiati per secondi sono l'errore piu' facile da fare, e
  // producono un evento nell'anno 56000: si riconosce e si converte.
  const secondi = n > 1e11 ? Math.floor(n / 1000) : Math.floor(n);
  const adesso = Math.floor(Date.now() / 1000);
  if (secondi < adesso - LONTANO || secondi > adesso + LONTANO) return null;
  return secondi;
}

export function rotteEventiSpazio(app, { db, eventi }) {
  const avvisa = (spazioId) =>
    eventi.aUtenti(db.membriDi(spazioId).map((m) => m.id), { tipo: 'eventi', spazio: spazioId });

  app.get(
    '/api/spazi/:spazio/eventi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const gestisce = esito.permessi.has('manageEvents');
      const visibili = new Set(
        db.canaliVisibili(esito.spazio.id, richiesta.utente, esito.ruolo).map((c) => c.id),
      );

      // Un evento agganciato a un canale che non si vede non si vede nemmeno
      // lui: il titolo direbbe comunque cosa succede la' dentro.
      return {
        eventi: db.eventiSpazio
          .dello(esito.spazio.id, { conAnnullati: gestisce })
          .filter((e) => e.canale === null || visibili.has(e.canale)),
      };
    },
  );

  app.post(
    '/api/spazi/:spazio/eventi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'createEvents',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (
        !db.impostazioniSpazio(esito.spazio).eventiAperti &&
        !esito.permessi.has('manageEvents')
      ) {
        return risposta.code(403).send({ errore: 'in questo spazio gli eventi li crea chi li gestisce' });
      }

      const { titolo, descrizione = '', inizio, fine = null, canale = null } = richiesta.body ?? {};
      if (typeof titolo !== 'string' || !titolo.trim()) {
        return risposta.code(400).send({ errore: 'serve un titolo' });
      }

      const quando = istanteValido(inizio);
      if (quando === null) return risposta.code(400).send({ errore: 'la data non e\' valida' });

      const finisce = fine === null || fine === undefined ? null : istanteValido(fine);
      if (fine !== null && fine !== undefined && finisce === null) {
        return risposta.code(400).send({ errore: 'la fine non e\' valida' });
      }
      if (finisce !== null && finisce < quando) {
        return risposta.code(400).send({ errore: 'la fine viene prima dell\'inizio' });
      }

      const dove = canale === null || canale === undefined ? null : Number(canale);
      if (dove !== null) {
        const suo = db.canale(dove);
        if (!suo || suo.spazio !== esito.spazio.id) {
          return risposta.code(400).send({ errore: 'canale inesistente in questo spazio' });
        }
      }

      const evento = db.eventiSpazio.crea(esito.spazio.id, {
        titolo,
        descrizione,
        inizio: quando,
        fine: finisce,
        canale: dove,
        creatoDa: richiesta.utente.id,
      });

      // Chi organizza c'e' per definizione: un evento con zero interessati e
      // il suo autore fra questi zero non ha senso.
      db.eventiSpazio.segna(evento.id, richiesta.utente.id, 'partecipa');

      avvisa(esito.spazio.id);
      return risposta.code(201).send({ evento: db.eventiSpazio.evento(evento.id) });
    },
  );

  app.patch(
    '/api/spazi/:spazio/eventi/:evento',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const evento = db.eventiSpazio.evento(Number(richiesta.params.evento));
      if (!evento || evento.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'evento inesistente' });
      }

      const suo = evento.creatoDa === richiesta.utente.id && esito.permessi.has('createEvents');
      if (!suo && !esito.permessi.has('manageEvents')) {
        return risposta.code(403).send({ errore: 'non puoi modificare questo evento' });
      }

      const { titolo, descrizione, inizio, fine, canale, stato } = richiesta.body ?? {};

      const quando = inizio === undefined ? undefined : istanteValido(inizio);
      if (inizio !== undefined && quando === null) {
        return risposta.code(400).send({ errore: 'la data non e\' valida' });
      }

      const aggiornato = db.eventiSpazio.aggiorna(evento.id, {
        titolo: typeof titolo === 'string' && titolo.trim() ? titolo : undefined,
        descrizione: typeof descrizione === 'string' ? descrizione : undefined,
        inizio: quando,
        fine: fine === undefined ? undefined : fine === null ? null : istanteValido(fine),
        canale: canale === undefined ? undefined : canale === null ? null : Number(canale),
        stato: ['programmato', 'annullato'].includes(stato) ? stato : undefined,
      });

      avvisa(esito.spazio.id);
      return { evento: aggiornato };
    },
  );

  app.delete(
    '/api/spazi/:spazio/eventi/:evento',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const evento = db.eventiSpazio.evento(Number(richiesta.params.evento));
      if (!evento || evento.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'evento inesistente' });
      }

      const suo = evento.creatoDa === richiesta.utente.id && esito.permessi.has('createEvents');
      if (!suo && !esito.permessi.has('manageEvents')) {
        return risposta.code(403).send({ errore: 'non puoi eliminare questo evento' });
      }

      db.eventiSpazio.elimina(evento.id);
      avvisa(esito.spazio.id);
      return { eliminato: evento.id };
    },
  );

  /** "Ci sono", "forse", oppure niente. */
  app.post(
    '/api/spazi/:spazio/eventi/:evento/partecipo',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const evento = db.eventiSpazio.evento(Number(richiesta.params.evento));
      if (!evento || evento.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'evento inesistente' });
      }

      const stato = richiesta.body?.stato ?? null;
      if (stato !== null && !['partecipa', 'forse'].includes(stato)) {
        return risposta.code(400).send({ errore: 'stato sconosciuto' });
      }

      db.eventiSpazio.segna(evento.id, richiesta.utente.id, stato);
      avvisa(esito.spazio.id);
      return { partecipanti: db.eventiSpazio.partecipanti(evento.id) };
    },
  );
}
