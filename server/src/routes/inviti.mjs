// routes/inviti.mjs - fare entrare qualcuno, senza passare da SSH.
//
// La stessa cosa che fa `pulse-talk invita` dalla riga di comando, ma
// raggiungibile da dove ci si trova — compreso il telefono. Resta riservata
// agli admin: la rotta dichiara il ruolo, e chi non ce l'ha non vede nemmeno
// il pulsante.
//
// Il codice si vede una volta sola, qui come da riga di comando. Il database
// ne conserva l'impronta, quindi non c'e' nessuna rotta che possa
// ristamparlo: se si perde, se ne fa un altro e si cancella quello vecchio.

import { richiedeRuolo } from '../auth.mjs';
import { RUOLI } from '../config.mjs';

// Il tetto per un invito che una scadenza ce l'ha. Un anno: oltre, la data
// smette di voler dire qualcosa. Prima era un mese, per non lasciare porte
// accostate che nessuno ricorda — ma una porta che resta aperta e' una scelta
// da fare apposta, non il risultato di un numero scritto grosso: per quella
// c'e' A_VITA, e chi la sceglie sa cosa sta facendo.
const GIORNI_MAX = 365;

// Zero giorni: non scade mai. E' lo stesso zero degli usi negli inviti agli
// spazi — in questo database "senza limite" si scrive cosi'. Resta comunque un
// invito con un tetto di usi, e `DELETE /api/inviti/:id` lo chiude in ogni
// momento: non scadere non vuol dire non finire.
const A_VITA = 0;

const USI_MAX = 50;

export function rotteInviti(app, { db }) {
  app.post(
    '/api/inviti',
    { onRequest: richiedeRuolo('admin') },
    async (richiesta, risposta) => {
      const { ruolo = 'membro', giorni = 14, usi = 1, nome = '' } = richiesta.body ?? {};

      if (!RUOLI.includes(ruolo)) {
        return risposta.code(400).send({ errore: `ruolo sconosciuto: ${ruolo}` });
      }

      const giorniValidi = Number(giorni);
      const nonScade = giorniValidi === A_VITA;
      if (!Number.isInteger(giorniValidi) || giorniValidi < A_VITA || giorniValidi > GIORNI_MAX) {
        return risposta.code(400).send({
          errore: `i giorni devono stare fra 1 e ${GIORNI_MAX}, oppure 0 per un invito che non scade`,
        });
      }

      const usiValidi = Number(usi);
      if (!Number.isInteger(usiValidi) || usiValidi < 1 || usiValidi > USI_MAX) {
        return risposta.code(400).send({ errore: `gli usi devono stare fra 1 e ${USI_MAX}` });
      }

      const codice = db.creaInvito({
        nome: String(nome).slice(0, 60),
        ruolo,
        validoGiorni: giorniValidi,
        usiMax: usiValidi,
        creatoDa: richiesta.utente.id || null,
      });

      richiesta.log.info(
        { da: richiesta.utente.id, ruolo, giorni: giorniValidi, usi: usiValidi },
        'invito creato',
      );

      // Il codice in chiaro esiste solo in questa risposta. Da qui in poi il
      // database ne ha solo l'impronta, e nessuna rotta puo' ripescarlo.
      return risposta.code(201).send({
        codice,
        ruolo,
        usi: usiValidi,
        scade: nonScade ? A_VITA : Math.floor(Date.now() / 1000) + giorniValidi * 86400,
      });
    },
  );

  app.get(
    '/api/inviti',
    { onRequest: richiedeRuolo('admin') },
    async () => ({ inviti: db.invitiAperti() }),
  );

  app.delete(
    '/api/inviti/:id',
    { onRequest: richiedeRuolo('admin') },
    async (richiesta, risposta) => {
      const eliminati = db.eliminaInvito(Number(richiesta.params.id));
      if (eliminati === 0) return risposta.code(404).send({ errore: 'invito inesistente' });
      richiesta.log.info({ da: richiesta.utente.id, invito: richiesta.params.id }, 'invito annullato');
      return { eliminato: Number(richiesta.params.id) };
    },
  );
}
