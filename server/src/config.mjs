// config.mjs - lettura e validazione dell'ambiente.
//
// La regola: tutto ha un valore ragionevole tranne cio' che non puo'
// averlo. Qui sono tre cose — la cartella dei dati, e la coppia chiave/segreto
// con cui si firmano i gettoni della SFU. Un segreto con un default sarebbe lo
// stesso su ogni installazione, e chiunque potrebbe fabbricarsi un permesso di
// entrare in qualunque stanza.

import { resolve } from 'node:path';

const RUOLI = ['ospite', 'membro', 'admin'];

// L'ambiente arriva sempre come parametro, mai letto da process.env qui dentro:
// altrimenti passare un ambiente finto ai test non cambierebbe niente.
function intero(env, nome, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const grezzo = env[nome];
  if (grezzo === undefined || grezzo === '') return fallback;
  const n = Number(grezzo);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${nome} deve essere un intero fra ${min} e ${max}, non "${grezzo}"`);
  }
  return n;
}

function booleano(env, nome, fallback) {
  const grezzo = env[nome];
  if (grezzo === undefined || grezzo === '') return fallback;
  return ['1', 'true', 'si', 'yes', 'on'].includes(grezzo.toLowerCase());
}

export function leggiConfig(env = process.env) {
  const root = env.TALK_ROOT;
  if (!root) throw new Error('TALK_ROOT non impostata: e\' la cartella sul NAS dove vive talk.db');

  // Senza autenticazione chiunque raggiunga la porta e' amministratore. Lo
  // consentiamo solo ai test, e il server lo urla nel log all'avvio.
  const senzaAuth = booleano(env, 'TALK_NO_AUTH', false);

  const sfuChiave = env.SFU_API_KEY ?? '';
  const sfuSegreto = env.SFU_API_SECRET ?? '';
  if (!senzaAuth && (sfuChiave.length < 3 || sfuSegreto.length < 32)) {
    throw new Error(
      'SFU_API_KEY / SFU_API_SECRET mancanti o troppo corti (il segreto vuole almeno 32 caratteri). ' +
      'Generali con:  node src/cli.mjs segreto',
    );
  }

  return {
    root: resolve(root),
    dbPath: env.TALK_DB ? resolve(env.TALK_DB) : resolve(root, 'talk.db'),

    host: env.TALK_HOST ?? '0.0.0.0',
    port: intero(env, 'TALK_PORT', 8080, { min: 0, max: 65535 }),

    // Due indirizzi per la stessa SFU, e non e' una svista.
    //
    //   sfuUrl     e' quello che diciamo alle app: passa da Caddy, ha un
    //              certificato vero, ed e' un nome DNS-only che punta a casa.
    //   sfuApiUrl  e' quello che usiamo noi da dentro la rete di compose, dove
    //              TLS non serve e il nome del container basta.
    //
    // Tenerli separati significa che le app non sanno dove sia davvero la SFU,
    // e spostarla e' una riga nel .env invece che una nuova versione da
    // distribuire a tutti.
    sfuUrl: (env.SFU_URL ?? 'ws://localhost:7880').replace(/\/+$/, ''),
    sfuApiUrl: (env.SFU_API_URL ?? 'http://localhost:7880').replace(/\/+$/, ''),
    sfuChiave,
    sfuSegreto,

    // Sei ore: piu' lunga di qualsiasi sessione, cosi' il gettone non scade
    // mentre si parla. Non e' un rischio come una URL firmata: il
    // gettone vale per una stanza sola, e chi viene cacciato non rientra
    // perche' la SFU se lo ricorda.
    gettoneTtlSec: intero(env, 'TALK_GETTONE_TTL', 6 * 60 * 60),

    // I tetti. Non sono la qualita' che si usa — quella la sceglie chi
    // trasmette — ma il massimo che il server e' disposto a consigliare. Le
    // app li leggono da GET /api/config e ci si adeguano, quindi alzarli non
    // richiede di reinstallare niente a nessuno.
    //
    // I default sono volutamente alti: e' il punto di tutto questo lavoro.
    limiti: {
      // 50 Mbit/s: un 4K60 di testo nitido sta abbondantemente sotto. Discord
      // free si ferma a 2,5 Mbit/s a 1080p30.
      bitrateSchermo: intero(env, 'TALK_MAX_BITRATE_SCHERMO', 50_000_000, { min: 100_000 }),
      fpsSchermo: intero(env, 'TALK_MAX_FPS_SCHERMO', 60, { min: 1, max: 240 }),
      altezzaSchermo: intero(env, 'TALK_MAX_ALTEZZA_SCHERMO', 2160, { min: 240, max: 4320 }),

      bitrateCamera: intero(env, 'TALK_MAX_BITRATE_CAMERA', 12_000_000, { min: 100_000 }),
      altezzaCamera: intero(env, 'TALK_MAX_ALTEZZA_CAMERA', 2160, { min: 240, max: 4320 }),

      // 510 kbit/s e' il massimo che Opus accetta, ed e' trasparente anche
      // sulla musica. Discord ne da' 96, i server con boost 384.
      bitrateVoce: intero(env, 'TALK_MAX_BITRATE_VOCE', 510_000, { min: 6_000, max: 510_000 }),

      // Quanti stream video puo' aprire una persona da sola. Due monitor piu'
      // la camera fanno tre; quattro lascia spazio a una capture card.
      streamPerPersona: intero(env, 'TALK_MAX_STREAM_PER_PERSONA', 4, { min: 1, max: 16 }),
      // 0 = nessun limite. E' il default, e la SFU e' d'accordo.
      personePerStanza: intero(env, 'TALK_MAX_PERSONE', 0, { min: 0, max: 10_000 }),

      // 100 MB per allegato. Non e' il disco a preoccupare — su un NAS ce n'e'
      // — ma la linea in salita: mandare un file da un giga in chat significa
      // occupare la banda che serve alle chiamate in corso.
      allegatoMax: intero(env, 'TALK_MAX_ALLEGATO', 100 * 1024 * 1024, { min: 64 * 1024 }),
    },

    senzaAuth,
    logLevel: env.TALK_LOG_LEVEL ?? 'info',
    // La cartella con l'app web costruita. Se non c'e', il server resta una
    // pura API e si entra solo dall'app installata.
    publicDir: env.TALK_PUBLIC ? resolve(env.TALK_PUBLIC) : resolve(import.meta.dirname, '..', 'public'),
  };
}

export { RUOLI };

// I ruoli sono ordinati: chi puo' trasmettere puo' anche ascoltare.
export function ruoloBasta(ruoloUtente, ruoloMinimo) {
  return RUOLI.indexOf(ruoloUtente) >= RUOLI.indexOf(ruoloMinimo);
}
