import { richiedeRuolo } from '../auth.mjs';

// routes/registrazioni.mjs - il registro di chi ha registrato cosa.
//
// Tre rotte e una regola: **si apre e si chiude la propria, si legge quella di
// tutti**. Chi puo' leggere il canale puo' leggere anche chi lo ha registrato,
// e non e' una svista: sapere di essere stati registrati non e' un privilegio
// di chi amministra, e' il minimo che si debba a chi c'era dentro.
//
// Il registro non si spegne con nessuna impostazione. La regola su *quando* si
// puo' registrare cambia da un server all'altro (`TALK_REGISTRAZIONE`); quella
// su *tenerne traccia* no, perche' e' l'unica cosa che rende verificabile la
// prima.
//
// Ed e' un registro della strada onesta: lo scrive il client che registra, e un
// programma modificato puo' non scriverlo. Vale la pena tenerlo lo stesso -
// senza, anche chi si comporta bene non ha modo di dimostrarlo.

const COSE = new Set(['chiamata', 'schermo']);

export function rotteRegistrazioni(app, { db, config, servizi }) {
  const regola = () => servizi?.config?.registrazione ?? config.registrazione ?? 'libera';

  /**
   * Comincia: la riga si apre adesso e torna il suo numero.
   *
   * Presenti e consensi arrivano dal client, che e' l'unico a saperli - il
   * consenso vive negli attributi del partecipante sulla SFU, non qui. Sono
   * numeri, non nomi: al registro serve dire in che condizioni e' cominciata,
   * non fare l'elenco di chi c'era, che sarebbe un secondo trattamento di dati
   * di persone che non hanno chiesto niente.
   */
  app.post(
    '/api/canali/:id/registrazioni',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      if (regola() === 'vietata') {
        return risposta.code(403).send({ errore: "su questo server le registrazioni sono vietate" });
      }

      const canale = Number(richiesta.params.id);
      if (!Number.isInteger(canale) || !db.canale(canale)) {
        return risposta.code(404).send({ errore: 'canale inesistente' });
      }

      const cosa = String(richiesta.body?.cosa ?? '');
      if (!COSE.has(cosa)) {
        return risposta.code(400).send({ errore: "«cosa» dev'essere chiamata o schermo" });
      }

      const numero = (valore) => {
        const n = Number(valore);
        return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : 0;
      };

      const id = db.apriRegistrazione({
        canale,
        chi: richiesta.utente.id,
        cosa,
        presenti: numero(richiesta.body?.presenti),
        consensi: numero(richiesta.body?.consensi),
      });

      richiesta.log.info({ canale, chi: richiesta.utente.id, cosa }, 'registrazione avviata');
      return { id };
    },
  );

  /** Finisce. Idempotente: chiudere due volte non e' un errore. */
  app.patch(
    '/api/registrazioni/:id',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta) => {
      const id = Number(richiesta.params.id);
      if (Number.isInteger(id)) db.chiudiRegistrazione(id, richiesta.utente.id);
      return { chiusa: true };
    },
  );

  /**
   * Chi ha registrato in questo spazio, dal piu' recente.
   *
   * Aperta a chi e' membro dello spazio, come quella del canale: sapere di
   * essere stati registrati non e' un privilegio di chi amministra. Chi non e'
   * dentro non vede niente, perche' non c'era.
   */
  app.get(
    '/api/spazi/:id/registrazioni',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const spazio = Number(richiesta.params.id);
      if (!Number.isInteger(spazio) || !db.spazio(spazio)) {
        return risposta.code(404).send({ errore: 'spazio inesistente' });
      }
      // Lo stesso controllo di appartenenza che usa tutto il resto: il ruolo
      // nello spazio. Nullo vuol dire che non ci si e' dentro, e chi non c'era
      // non ha niente da sapere di cio' che e' successo qui.
      if (!db.ruoloNelloSpazio(spazio, richiesta.utente)) {
        return risposta.code(403).send({ errore: 'non sei in questo spazio' });
      }
      return { registrazioni: db.registrazioniDelloSpazio(spazio) };
    },
  );

  /** Chi ha registrato questo canale, dal piu' recente. */
  app.get(
    '/api/canali/:id/registrazioni',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const canale = Number(richiesta.params.id);
      if (!Number.isInteger(canale) || !db.canale(canale)) {
        return risposta.code(404).send({ errore: 'canale inesistente' });
      }
      return { registrazioni: db.registrazioniDi(canale) };
    },
  );
}
