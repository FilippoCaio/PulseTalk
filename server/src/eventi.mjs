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

  // Chi vuole sapere quando qualcuno compare o sparisce. Ci sta la presenza, e
  // per ora nessun altro; e' un elenco invece di una funzione sola perche' un
  // secondo interessato non deve costringere a riscrivere il primo.
  const spettatori = new Set();

  function iscrivi(utenteId, manda) {
    if (!ascoltatori.has(utenteId)) ascoltatori.set(utenteId, new Set());
    const suoi = ascoltatori.get(utenteId);
    const primo = suoi.size === 0;
    suoi.add(manda);
    // Solo il primo flusso e' un arrivo: aprire l'app anche sul telefono non
    // vuol dire tornare online, perche' online lo si era gia'.
    if (primo) avvisaSpettatori(utenteId, true);

    return () => {
      const ancora = ascoltatori.get(utenteId);
      if (!ancora) return;
      ancora.delete(manda);
      if (ancora.size === 0) {
        ascoltatori.delete(utenteId);
        avvisaSpettatori(utenteId, false);
      }
    };
  }

  function avvisaSpettatori(utenteId, collegato) {
    for (const spettatore of spettatori) {
      try {
        spettatore(utenteId, collegato);
      } catch {
        // Chi guarda i cambi di presenza non deve poter rompere una
        // disiscrizione: un flusso che si chiude va tolto comunque.
      }
    }
  }

  /** Mandare a tutti quelli che stanno ascoltando, chiunque siano. */
  function aTutti(evento) {
    aUtenti([...ascoltatori.keys()], evento);
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
    aTutti,
    /** Se questa persona ha almeno un flusso aperto: e' la definizione di "c'e'". */
    collegato: (utenteId) => ascoltatori.has(utenteId),
    /** Da avvisare quando qualcuno apre il primo flusso o chiude l'ultimo. */
    quandoCambiaPresenza(spettatore) {
      spettatori.add(spettatore);
      return () => spettatori.delete(spettatore);
    },
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
  // Cio' che Fastify aveva gia' preparato per questa risposta, prima di tutto.
  //
  // Scrivendo le intestazioni con `raw.writeHead` si scavalca la pipeline di
  // Fastify, e con essa i plugin che le aggiungono — CORS in testa. Il
  // risultato era un flusso senza `access-control-allow-origin`: il browser lo
  // bloccava e l'applicazione mostrava "Failed to fetch, riprovo" all'infinito,
  // con tutto il resto funzionante perche' le altre rotte le intestazioni le
  // ricevono normalmente.
  //
  // Non si e' visto per un pezzo perche' l'interfaccia viveva su file://, che
  // non ha un'origine da confrontare. Appena la pagina ne ha avuta una vera —
  // e lo stesso sarebbe successo aprendo l'app web da un dominio diverso da
  // quello dell'API — il divieto e' diventato visibile.
  //
  // Si copia invece di riscrivere la regola: quale origine sia consentita lo
  // decide gia' la registrazione di @fastify/cors in server.mjs, e averlo
  // scritto in due posti vorrebbe dire due politiche che prima o poi divergono.
  const preparate = typeof risposta.getHeaders === 'function' ? risposta.getHeaders() : {};

  risposta.raw.writeHead(200, {
    ...preparate,
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
