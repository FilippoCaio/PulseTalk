// config.mjs - lettura e validazione dell'ambiente.
//
// La regola: tutto ha un valore ragionevole tranne cio' che non puo'
// averlo. Qui sono tre cose — la cartella dei dati, e la coppia chiave/segreto
// con cui si firmano i gettoni della SFU. Un segreto con un default sarebbe lo
// stesso su ogni installazione, e chiunque potrebbe fabbricarsi un permesso di
// entrare in qualunque stanza.

import { resolve } from 'node:path';

import { confrontaVersioni, versioneValida } from './versione.mjs';

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

function versione(env, nome, fallback) {
  const grezzo = env[nome];
  const valore = grezzo === undefined || grezzo === '' ? fallback : grezzo;
  if (!versioneValida(valore)) {
    throw new Error(`${nome} deve essere una versione semver completa (per esempio 0.3.6), non "${valore}"`);
  }
  return valore;
}

function urlAggiornamenti(env) {
  const grezzo = env.TALK_AGGIORNAMENTI_URL;
  if (grezzo === undefined || grezzo === '') return '/aggiornamenti/';
  let url;
  try {
    url = new URL(grezzo);
  } catch {
    throw new Error(`TALK_AGGIORNAMENTI_URL non e' un URL valido: "${grezzo}"`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('TALK_AGGIORNAMENTI_URL deve essere un URL http/https senza credenziali');
  }
  return url.toString();
}

/** Quale generatore di immagini usare. Vedi provider/generazione-immagini.mjs. */
function providerImmagini(env) {
  const grezzo = (env.TALK_IMMAGINI_PROVIDER ?? 'auto').trim().toLowerCase();
  const ammessi = ['auto', 'openai', 'automatic1111', 'perchance', 'nessuno'];
  if (!ammessi.includes(grezzo)) {
    throw new Error(`TALK_IMMAGINI_PROVIDER deve essere uno fra ${ammessi.join(', ')}, non "${grezzo}"`);
  }
  return grezzo;
}

/** Il dialetto con cui parlare al modello. Vedi provider/ai-dialetti.mjs. */
function formatoAi(env) {
  const grezzo = (env.TALK_AI_FORMATO ?? 'auto').trim().toLowerCase();
  if (!['auto', 'responses', 'chat'].includes(grezzo)) {
    throw new Error(`TALK_AI_FORMATO deve essere auto, responses o chat, non "${grezzo}"`);
  }
  return grezzo;
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

  // Nessun blocco a sorpresa per gli impianti gia' esistenti: finche' queste
  // variabili non sono configurate, qualunque semver e' compatibile e non c'e'
  // una release obbligatoria. Appena l'amministratore pubblica una target (e,
  // se vuole impedire i client futuri, una massima), il server diventa
  // l'autorita' prima ancora del login.
  const clientMinima = versione(env, 'TALK_CLIENT_MIN', '0.0.0');
  const clientTarget = versione(env, 'TALK_CLIENT_TARGET', clientMinima);
  const clientMassima = env.TALK_CLIENT_MAX
    ? versione(env, 'TALK_CLIENT_MAX', clientTarget)
    : null;
  if (confrontaVersioni(clientTarget, clientMinima) < 0) {
    throw new Error('TALK_CLIENT_TARGET non puo essere precedente a TALK_CLIENT_MIN');
  }
  if (clientMassima !== null && confrontaVersioni(clientMassima, clientTarget) < 0) {
    throw new Error('TALK_CLIENT_MAX non puo essere precedente a TALK_CLIENT_TARGET');
  }

  return {
    root: resolve(root),
    dbPath: env.TALK_DB ? resolve(env.TALK_DB) : resolve(root, 'talk.db'),

    // Dove stanno gli aggiornamenti dell'applicazione: l'installer, la sua
    // mappa a blocchi e latest.yml, che e' l'elenco che il client legge per
    // sapere se e' vecchio.
    //
    // Serviti dal server invece che da GitHub perche' e' lo stesso indirizzo a
    // cui il client e' gia' collegato: nessun nome nuovo da esporre, nessun
    // repository da tenere pubblico, e chi puo' entrare in una stanza puo'
    // gia' scaricare l'aggiornamento.
    aggiornamentiDir: env.TALK_AGGIORNAMENTI
      ? resolve(env.TALK_AGGIORNAMENTI)
      : resolve(root, 'aggiornamenti'),

    client: {
      minima: clientMinima,
      target: clientTarget,
      massima: clientMassima,
      // Relativo significa "sullo stesso server che hai appena scelto". Un
      // URL assoluto permette invece un CDN, senza cambiare il protocollo.
      feedUrl: urlAggiornamenti(env),
    },

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

      // Quanto puo' pesare un allegato, in tutto.
      //
      // Erano 100 MB, e il motivo non era il disco — su un NAS ce n'e' — ma la
      // linea in salita: un file grosso si prende la banda che serve alle
      // chiamate in corso. Adesso il caricamento va a pezzi, e fra un pezzo e
      // l'altro il client rallenta da solo quando c'e' una chiamata aperta:
      // quel motivo non regge piu' un tetto cosi' basso.
      //
      // Quattro giga e' una scelta, non una legge di natura: sta qui perche' e'
      // la misura oltre la quale un file mandato in chat e' quasi sempre un
      // trascinamento per sbaglio. Si alza con TALK_MAX_ALLEGATO.
      allegatoMax: intero(env, 'TALK_MAX_ALLEGATO', 4 * 1024 * 1024 * 1024, { min: 64 * 1024 }),

      // Quanto e' grosso un pezzo.
      //
      // Otto mega: abbastanza da non spendere piu' tempo in richieste che in
      // byte, abbastanza poco da non perdere niente di serio quando la linea
      // cade a meta' di uno. E' anche il tetto della singola richiesta, quindi
      // il server non deve mai reggere un corpo piu' grande di questo.
      allegatoPezzo: intero(env, 'TALK_PEZZO_ALLEGATO', 8 * 1024 * 1024, {
        min: 256 * 1024,
        max: 64 * 1024 * 1024,
      }),
    },

    /**
     * Le credenziali per la sessione musicale condivisa.
     *
     * Assenti su quasi tutte le installazioni, e va benissimo: senza, la
     * sessione musicale resta una coda condivisa che si vede e si compila, e
     * il collegamento a Spotify dice di non essere configurato invece di
     * fallire a meta' del consenso.
     *
     * Il segreto sta qui e non nell'applicazione perche' e' l'unico modo di
     * poter rinnovare i gettoni: un segreto dentro a un programma installato
     * su venti computer non e' piu' un segreto.
     */
    spotify: {
      clientId: env.SPOTIFY_CLIENT_ID ?? '',
      clientSecret: env.SPOTIFY_CLIENT_SECRET ?? '',
      // Deve combaciare, carattere per carattere, con quella scritta nel
      // cruscotto per sviluppatori di Spotify: e' loro che la confrontano.
      redirectUri: env.SPOTIFY_REDIRECT_URI ?? '',
    },

    /** Provider GIF ufficiale e facoltativo; le chiavi restano solo qui. */
    tenor: {
      apiKey: env.TALK_TENOR_API_KEY ?? '',
      clientKey: env.TALK_TENOR_CLIENT_KEY ?? 'pulse_talk',
    },

    /** L'alternativa a Tenor, che le chiavi le da' ancora a chi le chiede. */
    giphy: {
      apiKey: env.TALK_GIPHY_API_KEY ?? '',
    },

    /** API AI opzionale. Il default e' l'API OpenAI; baseUrl puo puntare a un servizio compatibile. */
    ai: {
      baseUrl: (env.TALK_AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: env.TALK_AI_API_KEY ?? '',
      // Quale formato parlare con il modello.
      //
      // 'auto' guarda l'indirizzo: l'API Responses di OpenAI sul suo dominio,
      // '/chat/completions' ovunque altro — che e' cio' che implementano
      // Ollama, LM Studio, vLLM, Groq e in genere tutto quello che si dichiara
      // compatibile. Si forza a mano solo nei casi in mezzo: un proxy verso
      // OpenAI su un dominio proprio, o un servizio che espone Responses.
      formato: formatoAi(env),
      chatModel: env.TALK_AI_CHAT_MODEL ?? '',
      imageModel: env.TALK_AI_IMAGE_MODEL ?? '',
      sttModel: env.TALK_AI_STT_MODEL ?? '',
      webSearch: booleano(env, 'TALK_AI_WEB_SEARCH', false),
      timeoutMs: intero(env, 'TALK_AI_TIMEOUT_MS', 60_000, { min: 1000, max: 300_000 }),
      contestoMessaggi: intero(env, 'TALK_AI_CONTESTO_MESSAGGI', 20, { min: 1, max: 100 }),
    },

    unsplash: {
      accessKey: env.TALK_UNSPLASH_ACCESS_KEY ?? '',
    },

    /**
     * Chi genera le immagini.
     *
     * `auto` preferisce cio' che gira in casa: con un indirizzo di Stable
     * Diffusion WebUI usa quello — gratis, e i prompt non escono dalla rete —
     * altrimenti ripiega su OpenAI se e' configurato. Vedi
     * provider/generazione-immagini.mjs.
     */
    immagini: {
      provider: providerImmagini(env),
      url: (env.TALK_IMMAGINI_URL ?? '').trim(),
      passi: intero(env, 'TALK_IMMAGINI_PASSI', 25, { min: 1, max: 150 }),
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
