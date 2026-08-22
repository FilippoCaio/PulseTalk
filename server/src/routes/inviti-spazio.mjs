// routes/inviti-spazio.mjs - far entrare qualcuno in uno spazio.
//
// Due strade che non vanno confuse. `routes/inviti.mjs` fa nascere un account
// sull'istanza e resta cosa di chi amministra la macchina. Questa fa entrare
// in uno spazio un account che esiste gia', e puo' passarci anche un membro
// normale: basta il permesso createInvites, e che lo spazio non abbia chiuso
// gli inviti dei membri dalle sue impostazioni.
//
// Due condizioni e non una, perche' sono due domande diverse: "questa persona
// puo' invitare?" la decidono i ruoli, "in questo spazio i membri possono
// invitare?" la decide chi lo amministra. Serve che siano vere entrambe.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlloSpazio, richiedePermesso } from '../permessi.mjs';

export function rotteInvitiSpazio(app, { db, eventi }) {
  const avvisa = (spazioId, evento) =>
    eventi.aUtenti(db.membriDi(spazioId).map((m) => m.id), evento);

  app.get(
    '/api/spazi/:spazio/inviti',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const tutti = db.invitiSpazio.aperti(esito.spazio.id);
      // Chi non amministra vede solo i propri: l'elenco degli inviti altrui
      // dice chi sta portando dentro chi, e non e' affare di tutti.
      const miei = esito.permessi.has('manageServer')
        ? tutti
        : tutti.filter((i) => i.creatoDa === richiesta.utente.id);

      return { inviti: miei.map(({ impronta, ...resto }) => resto) };
    },
  );

  app.post(
    '/api/spazi/:spazio/inviti',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'createInvites',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const impostazioni = db.impostazioniSpazio(esito.spazio);
      if (!impostazioni.invitiAperti && !esito.permessi.has('manageServer')) {
        return risposta.code(403).send({
          errore: 'in questo spazio gli inviti li fa solo chi lo amministra',
        });
      }

      const { giorni, usi, ruolo = null } = richiesta.body ?? {};

      // Un ruolo consegnato con l'invito e' un permesso regalato a distanza:
      // lo puo' mettere solo chi quel ruolo potrebbe darlo di persona.
      let ruoloDaDare = null;
      if (ruolo !== null && ruolo !== undefined) {
        if (!esito.permessi.has('manageRoles')) {
          return risposta.code(403).send({ errore: 'non puoi allegare un ruolo a un invito' });
        }
        const quale = db.ruoli.ruolo(Number(ruolo));
        if (!quale || quale.spazio !== esito.spazio.id || quale.tipo === 'base') {
          return risposta.code(404).send({ errore: 'ruolo inesistente' });
        }
        const suoi = db.permessiIn(richiesta.utente, { spazio: esito.spazio });
        if (quale.tipo === 'admin' || quale.permessi.some((p) => !suoi.has(p))) {
          return risposta.code(403).send({ errore: 'questo ruolo da\' piu\' di quanto tu abbia' });
        }
        ruoloDaDare = quale.id;
      }

      // Chi non amministra non sceglie ne' la durata ne' gli usi: quelli li
      // decide lo spazio. Altrimenti "gli inviti li possono fare i membri"
      // vorrebbe dire, in pratica, "un membro puo' aprire una porta per un
      // mese a chiunque".
      const amministra = esito.permessi.has('manageServer');
      const durata = amministra ? Number(giorni ?? impostazioni.invitiGiorni) : impostazioni.invitiGiorni;
      const quanti = amministra
        ? Number(usi ?? 0)
        : impostazioni.invitiUsoSingolo
          ? 1
          : 0;

      const { codice, invito } = db.invitiSpazio.crea(esito.spazio.id, {
        creatoDa: richiesta.utente.id,
        giorni: Number.isFinite(durata) ? durata : 7,
        usiMax: Number.isFinite(quanti) ? quanti : 0,
        ruolo: ruoloDaDare,
      });

      richiesta.log.info(
        { da: richiesta.utente.id, spazio: esito.spazio.id, usi: invito.usiMax },
        'invito allo spazio creato',
      );

      // Il codice in chiaro esiste solo in questa risposta.
      const { impronta, ...pubblico } = invito;
      return risposta.code(201).send({ codice, invito: pubblico });
    },
  );

  app.delete(
    '/api/spazi/:spazio/inviti/:id',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const invito = db.invitiSpazio.invito(Number(richiesta.params.id));
      if (!invito || invito.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'invito inesistente' });
      }
      // Il proprio sempre, quello degli altri solo amministrando.
      if (invito.creatoDa !== richiesta.utente.id && !esito.permessi.has('manageServer')) {
        return risposta.code(403).send({ errore: 'non puoi annullare l\'invito di un altro' });
      }

      db.invitiSpazio.elimina(invito.id);
      return { eliminato: invito.id };
    },
  );

  // -- Riscattare ------------------------------------------------------------

  /** Cosa apre questo codice, prima di usarlo. Serve a scrivere "Entra in Casa". */
  app.get(
    '/api/inviti-spazio/:codice',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = db.invitiSpazio.guarda(richiesta.params.codice);
      if (esito.errore) return risposta.code(403).send({ errore: esito.errore });

      const spazio = db.spazio(esito.invito.spazio);
      if (!spazio) return risposta.code(404).send({ errore: 'lo spazio non esiste piu\'' });

      return {
        spazio: {
          id: spazio.id,
          nome: spazio.nome,
          icona: spazio.icona,
          descrizione: spazio.descrizione ?? '',
          regole: spazio.regole ?? '',
          membri: db.membriDi(spazio.id).length,
        },
        gia: !!db.ruoloNelloSpazio(spazio.id, richiesta.utente),
      };
    },
  );

  app.post(
    '/api/inviti-spazio/:codice/entra',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const guarda = db.invitiSpazio.guarda(richiesta.params.codice);
      if (guarda.errore) return risposta.code(403).send({ errore: guarda.errore });

      const spazio = db.spazio(guarda.invito.spazio);
      if (!spazio) return risposta.code(404).send({ errore: 'lo spazio non esiste piu\'' });

      if (db.ruoli.eBandito(spazio.id, richiesta.utente.id)) {
        return risposta.code(403).send({ errore: 'sei stato bandito da questo spazio' });
      }

      // Chi c'e' gia' non consuma un uso: cliccare due volte lo stesso link
      // non deve bruciare il posto di qualcun altro.
      if (db.ruoloNelloSpazio(spazio.id, richiesta.utente)) {
        return { spazio: spazio.id, gia: true };
      }

      const consumato = db.invitiSpazio.consuma(richiesta.params.codice);
      if (consumato.errore) return risposta.code(403).send({ errore: consumato.errore });

      db.aggiungiMembro(spazio.id, richiesta.utente.id);
      if (consumato.invito.ruolo) {
        const ruolo = db.ruoli.ruolo(consumato.invito.ruolo);
        if (ruolo && ruolo.spazio === spazio.id) db.ruoli.assegna(ruolo.id, richiesta.utente.id);
      }

      avvisa(spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([richiesta.utente.id], { tipo: 'spazi' });
      richiesta.log.info({ chi: richiesta.utente.id, spazio: spazio.id }, 'entrato con invito');
      return risposta.code(201).send({ spazio: spazio.id, gia: false });
    },
  );
}
