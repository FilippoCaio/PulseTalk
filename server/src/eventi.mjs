// eventi.mjs - un solo flusso per persona, e ci passa dentro tutto.
//
// Un messaggio nuovo, una reazione, qualcuno che entra in un canale vocale, un
// canale creato: sono cose diverse che devono arrivare nello stesso istante
// alle stesse persone. Con un flusso per argomento servirebbero cinque
// connessioni aperte per utente, e ognuna con la sua riconnessione e il suo
// battito.
//
// SSE e non WebSocket, per la stessa ragione dell'atrio: e' traffico a senso
// unico — dal server verso l'app — e passa da qualunque proxy come una normale
// risposta HTTP che non finisce mai. Cio' che l'app manda *al* server passa
// dalle rotte normali, dove c'e' gia' l'autenticazione e il controllo dei
// permessi.

/**
 * Il registro di chi sta ascoltando.
 *
 * Non sa niente di spazi ne' di permessi: gli si dice a quali utenti mandare, e
 * manda. Decidere chi ha diritto di sapere una cosa e' un problema delle
 * rotte, che hanno il database sottomano; farlo anche qui vorrebbe dire due
 * copie della stessa regola, e prima o poi una delle due sbaglia.
 */
export function creaEventi() {
  // utenteId -> Set di funzioni che scrivono sul suo flusso. Un insieme e non
  // una sola: la stessa persona puo' avere l'app aperta sul portatile e il
  // browser sul telefono, e un evento deve arrivare a entrambi.
  const ascoltatori = new Map();

  function iscrivi(utenteId, manda) {
    if (!ascoltatori.has(utenteId)) ascoltatori.set(utenteId, new Set());
    ascoltatori.get(utenteId).add(manda);

    return () => {
      const suoi = ascoltatori.get(utenteId);
      if (!suoi) return;
      suoi.delete(manda);
      if (suoi.size === 0) ascoltatori.delete(utenteId);
    };
  }

  function aUtenti(utenti, evento) {
    const corpo = JSON.stringify(evento);
    for (const id of utenti) {
      const suoi = ascoltatori.get(id);
      if (!suoi) continue;
      for (const manda of suoi) {
        try {
          manda(corpo);
        } catch {
          // Un flusso gia' chiuso: se ne accorgera' il suo `close`, che lo
          // toglie dal registro. Qui interessa solo non far cadere l'evento
          // per gli altri.
        }
      }
    }
  }

  return {
    iscrivi,
    aUtenti,
    /** Quante persone stanno ascoltando adesso. Serve al /salute. */
    get quanti() {
      return ascoltatori.size;
    },
  };
}

/**
 * Apre un flusso SSE su una risposta Fastify.
 *
 * Restituisce la funzione per chiuderlo. Il battito ogni venti secondi non
 * serve al client: serve a tenere sveglia la connessione attraverso i proxy,
 * che una risposta ferma la chiudono e basta — nginx di serie a un minuto,
 * certi proxy a cento secondi.
 */
export function apriFlusso(richiesta, risposta) {
  risposta.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Senza questo nginx bufferizza il flusso e gli eventi arrivano a scatti
    // di sedici kilobyte invece che nell'istante in cui succedono.
    'x-accel-buffering': 'no',
  });

  const manda = (corpo) => risposta.raw.write(`data: ${corpo}\n\n`);

  // Un commento subito, e non e' cortesia.
  //
  // `writeHead` non manda niente sul filo: le intestazioni partono con il
  // primo byte del corpo. Senza questa riga, il client resterebbe appeso ad
  // aspettare la risposta fino al primo evento vero — che su un canale
  // tranquillo puo' voler dire minuti. Con questa, la connessione si stabilisce
  // subito e da li' in poi si aspetta soltanto cio' che succede.
  risposta.raw.write(': collegato\n\n');

  const battito = setInterval(() => risposta.raw.write(': .\n\n'), 20_000);

  richiesta.raw.on('close', () => clearInterval(battito));

  return { manda, chiudi: () => clearInterval(battito) };
}
