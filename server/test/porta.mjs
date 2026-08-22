// test/porta.mjs - una porta su cui `fetch` accetti di parlare.
//
// I test aprivano il server con `listen({ port: 0 })`, lasciando scegliere al
// sistema. Sembra la cosa giusta e ogni tanto non lo e': Windows puo'
// assegnare una porta che sta nell'elenco di quelle **bloccate** dai browser —
// e undici, il client dentro a `fetch`, quell'elenco lo rispetta. Il risultato
// era un `TypeError: fetch failed` con dentro `Error: bad port`, su un test a
// caso, una volta ogni tre o quattro giri.
//
// Un test che fallisce a caso e' peggio di un test che manca: insegna a
// rilanciare la suite invece di leggere l'errore, e il giorno in cui il rosso
// e' vero lo si rilancia lo stesso.
//
// Qui si sceglie a mano dentro all'intervallo effimero (49152-65535), dove non
// cade nessuna porta bloccata — la piu' alta dell'elenco e' la 10080. Se e'
// occupata si riprova con un'altra.

/** Quanti tentativi prima di arrendersi. Con 16k porte libere, non capita. */
const TENTATIVI = 20;

const EFFIMERA_MIN = 49152;
const EFFIMERA_MAX = 65535;

/**
 * Mette in ascolto l'applicazione su una porta utilizzabile e la restituisce.
 *
 * @param {{ listen: (opzioni: object) => Promise<unknown> }} app
 * @returns {Promise<number>}
 */
export async function ascoltaSuPortaBuona(app, host = '127.0.0.1') {
  let ultimo;
  for (let i = 0; i < TENTATIVI; i++) {
    const porta = EFFIMERA_MIN + Math.floor(Math.random() * (EFFIMERA_MAX - EFFIMERA_MIN));
    try {
      await app.listen({ host, port: porta });
      return porta;
    } catch (errore) {
      // Solo la collisione si riprova: qualunque altro guasto e' un guasto, e
      // nasconderlo dietro venti tentativi vorrebbe dire venti volte lo stesso
      // errore e nessuna spiegazione.
      if (errore?.code !== 'EADDRINUSE') throw errore;
      ultimo = errore;
    }
  }
  throw ultimo ?? new Error('nessuna porta libera fra quelle effimere');
}
