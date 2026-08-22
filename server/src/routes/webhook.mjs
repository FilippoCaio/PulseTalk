// routes/webhook.mjs - la SFU racconta cosa succede.
//
// Senza questa rotta i canali vocali funzionano lo stesso, ma chi guarda la
// colonna dei canali vedrebbe le persone comparire e sparire con qualche
// secondo di ritardo. Con questa rotta si aggiornano nell'istante in cui
// qualcuno entra.
//
// Chi arriva qui non ha un nostro token e non ce l'avra' mai: la SFU firma il
// corpo con lo stesso segreto con cui noi firmiamo i gettoni, e il segreto e'
// la prova. Verificare la firma non e' opzionale — la rotta e' raggiungibile
// da chiunque arrivi al container, e senza verifica sarebbe un modo per far
// dire al server qualsiasi cosa.

const EVENTI_DI_PRESENZA = new Set([
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'track_published',
  'track_unpublished',
]);

export function rotteWebhook(app, { verificatore, presenze, eventi, db, chiamate = null }) {
  // Dentro a un plugin, e non e' un vezzo di stile: i parser di Fastify sono
  // incapsulati per contesto, e qui sotto ne serve uno che lascia il corpo
  // grezzo. Registrarlo sull'istanza principale lo applicherebbe a *tutte* le
  // rotte, e il riscatto di un invito riceverebbe una stringa dove si aspetta
  // un oggetto. E' esattamente quello che e' successo alla prima stesura.
  return app.register(async (istanza) => {
    // LiveKit manda `application/webhook+json`, e il corpo deve arrivare come
    // stringa esatta: la firma copre i byte, non l'oggetto che ne verrebbe
    // fuori. Un JSON.parse seguito da JSON.stringify cambierebbe l'ordine
    // delle chiavi e la verifica fallirebbe.
    istanza.addContentTypeParser(
      ['application/webhook+json', 'application/json'],
      { parseAs: 'string' },
      (richiesta, corpo, fatto) => fatto(null, corpo),
    );

    istanza.post('/webhook/sfu', gestisci);
  });

  async function gestisci(richiesta, risposta) {
    let evento;
    try {
      evento = await verificatore.receive(richiesta.body, richiesta.headers.authorization);
    } catch (errore) {
      richiesta.log.warn({ err: errore }, 'webhook con firma non valida');
      return risposta.code(401).send({ errore: 'firma non valida' });
    }

    if (EVENTI_DI_PRESENZA.has(evento.event)) {
      presenze.invalida();

      // Il nome della stanza sulla SFU e' `<spazio>--<canale>`: da li' si
      // risale a chi va avvisato. Se non si risale — una stanza rimasta viva
      // dopo che il canale e' stato cancellato — non si avvisa nessuno, ed e'
      // giusto cosi'.
      const nome = evento.room?.name ?? '';
      const [chiaveSpazio] = nome.split('--');

      // Le chiamate dirette hanno una stanza tutta loro (`dm--<id>`) e non
      // appartengono a nessuno spazio: chi va avvisato lo sa il registro delle
      // chiamate, che tiene anche il conto di quando la stanza resta vuota.
      if (chiaveSpazio === 'dm' && chiamate) {
        if (evento.event === 'participant_joined') chiamate.viva(nome);
        // `room_finished` non arriva sempre: la SFU tiene la stanza in vita
        // per il timeout di grazia. L'uscita dell'ultimo, invece, arriva.
        if (evento.event === 'participant_left' || evento.event === 'room_finished') {
          const rimasti = Number(evento.room?.numParticipants ?? 0);
          if (rimasti <= 0) chiamate.vuota(nome);
        }
        return { ok: true };
      }

      const spazio = chiaveSpazio ? db.spazioPerChiave(chiaveSpazio) : null;

      if (spazio) {
        eventi.aUtenti(
          db.membriDi(spazio.id).map((m) => m.id),
          { tipo: 'presenza', spazio: spazio.id },
        );
      }
    }

    richiesta.log.debug(
      { evento: evento.event, stanza: evento.room?.name, chi: evento.participant?.identity },
      'webhook',
    );

    // La SFU ritenta finche' non riceve un 200, e ritentare non ci serve: se
    // un evento si perde, il peggio che succede e' che la colonna dei canali
    // si aggiorna al prossimo. Rispondere sempre 200 evita una coda di
    // ritentativi per un problema che si risolve da solo.
    return { ok: true };
  }
}
