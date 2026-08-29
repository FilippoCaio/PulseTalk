// routes/moderazione.mjs - i provvedimenti sulla voce, fatti rispettare.
//
// Questo file e' la differenza fra una funzione e una decorazione. Nella UI le
// quattro voci del menu sono quattro interruttori; qui sotto sono quattro
// righe di database e una riscrittura dei permessi sulla SFU, e la seconda
// meta' e' quella che conta: `mutePublishedTrack` zittisce una traccia viva, e
// chi rientra ottiene un gettone nuovo e ricomincia a pubblicare come se non
// fosse successo niente.
//
// Regole trasversali, tutte gia' scritte altrove e tutte valide anche qui:
//
//   - il permesso lo ricalcola il server su ogni richiesta, senza fidarsi di
//     niente che arrivi dal client — ne' del ruolo, ne' dell'evento
//     dichiarato, ne' dell'identita' del bersaglio;
//   - 403 a chi non ha diritto, 404 a chi non vede la risorsa;
//   - l'evento SSE va agli interessati e a nessun altro: il bersaglio, e chi
//     sta nella stanza perche' la sua interfaccia mostri lo stato giusto;
//   - i messaggi non si toccano. Queste sono restrizioni sulla voce e sul
//     video, e nessun ruolo modifica o cancella il messaggio di un altro.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale } from '../permessi.mjs';
import { puoModerareLaVoce } from '../permessi/moderazione.mjs';
import { genereNoto } from '../dati/restrizioni.mjs';

export function rotteModerazione(app, { db, presenze, moderazione }) {
  const { applica, avvisa, leggiPer, pubblica } = moderazione;

  // -- Leggere -------------------------------------------------------------

  app.get(
    '/api/canali/:canale/restrizioni',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.canale.tipo !== 'voce') return { restrizioni: [] };

      // Raggruppate per persona: e' il modo in cui la UI le usa, e farlo qui
      // evita che ogni schermata si scriva lo stesso raggruppamento.
      const per = new Map();
      for (const riga of db.restrizioni.delCanale(esito.canale.id)) {
        if (!per.has(riga.utente)) per.set(riga.utente, []);
        per.get(riga.utente).push(pubblica(riga));
      }

      return {
        restrizioni: [...per.entries()].map(([utente, sue]) => ({ utente, sue })),
      };
    },
  );

  // -- Imporre e togliere ---------------------------------------------------

  app.post(
    '/api/canali/:canale/restrizioni',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const { utente: grezzoUtente, genere, attiva } = richiesta.body ?? {};

      const bersaglio = Number(grezzoUtente);
      if (!Number.isInteger(bersaglio) || bersaglio <= 0) {
        return risposta.code(400).send({ errore: 'serve chi va moderato' });
      }
      if (!genereNoto(genere)) {
        return risposta.code(400).send({ errore: 'provvedimento sconosciuto' });
      }
      if (typeof attiva !== 'boolean') {
        return risposta.code(400).send({ errore: 'serve dire se imporre o togliere' });
      }

      const esito = puoModerareLaVoce(db, richiesta.utente, richiesta.params.canale, {
        bersaglio,
        genere,
      });
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Idempotente: due amministratori che premono insieme ottengono lo
      // stesso stato finale, e chi arriva secondo non riceve un errore per
      // aver chiesto una cosa che era gia' vera.
      const cambiato = db.restrizioni.imposta(esito.canale.id, bersaglio, genere, {
        attiva,
        evento: esito.evento,
        daUtente: richiesta.utente.id,
      });

      // L'applicazione sulla SFU si fa comunque, anche quando il database non
      // e' cambiato: e' il caso di chi si e' visto togliere il permesso e poi
      // e' rientrato prima che qualcuno riapplicasse: lo stato scritto e'
      // giusto, quello vivo no, e questa riga li rimette d'accordo.
      await applica(esito.canale, esito.spazio, bersaglio);
      await avvisa(esito.canale, bersaglio);

      richiesta.log.info(
        {
          da: richiesta.utente.id,
          chi: bersaglio,
          canale: esito.canale.id,
          genere,
          attiva,
          evento: esito.evento,
        },
        'restrizione vocale',
      );

      return { cambiato, restrizioni: leggiPer(esito.canale.id, bersaglio) };
    },
  );

  // -- Chiudere una condivisione in corso -----------------------------------

  app.post(
    '/api/canali/:canale/condivisioni/chiudi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const bersaglio = Number(richiesta.body?.utente);
      if (!Number.isInteger(bersaglio) || bersaglio <= 0) {
        return risposta.code(400).send({ errore: 'serve di chi e\' la condivisione' });
      }

      // Stesso diritto che serve a togliergliela del tutto: chiudere una
      // condivisione altrui e' la stessa autorita' esercitata una volta sola.
      const esito = puoModerareLaVoce(db, richiesta.utente, richiesta.params.canale, {
        bersaglio,
        genere: 'condivisione',
      });
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chiave = db.chiaveSfu(esito.canale);
      const tracce = await presenze.tracceDi(chiave, `u${bersaglio}`);
      // 3 e 4 sono SCREEN_SHARE e SCREEN_SHARE_AUDIO nel protocollo di
      // LiveKit. Si zittiscono entrambe: sono due tracce di una cosa sola.
      const suoi = tracce.filter((t) => t.source === 3 || t.source === 4);
      const volute = richiesta.body?.traccia
        ? suoi.filter((t) => t.sid === richiesta.body.traccia || t.name === richiesta.body.traccia)
        : suoi;

      // Chi ha chiesto di chiudere *quella* condivisione e ha indicato la
      // traccia video, si porta dietro anche il suo audio: il nome li lega, ed
      // e' la stessa convenzione che usa il client ("Finestra" e "Finestra
      // (audio)").
      const nomi = new Set(volute.map((t) => t.name));
      const conAudio = suoi.filter(
        (t) => volute.includes(t) || nomi.has(String(t.name).replace(/ \(audio\)$/, '')),
      );

      for (const traccia of conAudio) {
        await presenze.zittisci(chiave, `u${bersaglio}`, traccia.sid, true).catch(() => {});
      }

      richiesta.log.info(
        { da: richiesta.utente.id, chi: bersaglio, canale: esito.canale.id, quante: conAudio.length },
        'condivisione chiusa da un moderatore',
      );

      return { chiuse: conAudio.length };
    },
  );
}
