// provider/generazione-immagini.mjs - chi disegna, e come si cambia.
//
// La generazione delle immagini stava incastrata dentro al provider AI, come
// un metodo che sapeva parlare solo con `/images/generations` di OpenAI.
// Funzionava, e legava PulseTalk a un servizio solo: per usare una Stable
// Diffusion in casa bisognava mettere le mani nel codice della chat.
//
// Qui c'e' un contratto e i suoi implementatori. Aggiungerne uno vuol dire
// scrivere un oggetto con `genera` e registrarlo: la chat non se ne accorge.
//
//   openai          `POST /images/generations`. Si paga, funziona sempre.
//   automatic1111   `POST /sdapi/v1/txt2img` della Stable Diffusion WebUI.
//                   Gratis, gira in casa, non manda niente fuori. Vuole la
//                   WebUI avviata con `--api`.
//   perchance       dichiarato e non disponibile. Il perche' e' scritto sotto:
//                   e' una spiegazione, non un segnaposto.
//
// Un provider dichiarato ma spento non e' rumore. E' la differenza fra "quel
// servizio qui non c'e'" e "quel servizio non si puo' usare, ed ecco perche'":
// senza, la stessa domanda torna ogni sei mesi.

/**
 * @typedef {object} GeneratoreImmagini
 * @property {string} id
 * @property {string} etichetta
 * @property {boolean} disponibile
 * @property {string|null} motivo        perche' non e' disponibile, se non lo e'
 * @property {(dati: {prompt: string, signal?: AbortSignal}) => Promise<{corpo: Buffer, tipo: string, nome: string}>} genera
 */

/** Quanto si aspetta un'immagine prima di rinunciare. Una locale ci mette. */
const ATTESA_MS = 180_000;

const errore = (messaggio, statusCode) => Object.assign(new Error(messaggio), { statusCode });

/**
 * Perchance: dichiarato, e non utilizzabile.
 *
 * Non ha un'API pubblica, e non e' una svista loro. I generatori di immagini
 * sono pagati dalla pubblicita' mostrata sulla loro pagina; il loro autore ha
 * scritto esplicitamente che non e' possibile usarli da un'API perche' cosi'
 * quella pubblicita' non verrebbe mostrata. Le pagine rispondono 403 anche a
 * un semplice recupero automatico.
 *
 * Arrivarci lo stesso vorrebbe dire un endpoint interno non documentato,
 * trovato per reverse engineering, usato per aggirare il modo in cui quel
 * servizio si paga. Non si fa, e resta scritto qui perche' la domanda e'
 * ragionevole e merita una risposta invece del silenzio.
 */
export const PERCHANCE = {
  id: 'perchance',
  etichetta: 'Perchance',
  disponibile: false,
  motivo:
    "Perchance non offre un'API pubblica: i suoi generatori di immagini sono finanziati dalla " +
    'pubblicita\' mostrata sulla loro pagina, e il loro autore ha dichiarato che non e\' possibile ' +
    'usarli da un\'API. Usarli lo stesso vorrebbe dire aggirare il modo in cui quel servizio si paga.',
  async genera() {
    throw errore(PERCHANCE.motivo, 501);
  },
};

/** Il generatore di OpenAI, quello che c'era gia'. */
function creaOpenai(config) {
  const c = config.ai;
  const disponibile = Boolean(c.apiKey && c.imageModel);

  return {
    id: 'openai',
    etichetta: 'OpenAI',
    disponibile,
    motivo: disponibile ? null : 'servono TALK_AI_API_KEY e TALK_AI_IMAGE_MODEL',

    async genera({ prompt, signal }) {
      if (!disponibile) throw errore('generazione immagini non configurata', 501);
      const controllo = AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(ATTESA_MS),
      ]);

      let risposta;
      try {
        risposta = await fetch(`${c.baseUrl}/images/generations`, {
          method: 'POST',
          headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: c.imageModel, prompt, size: '1024x1024', n: 1 }),
          signal: controllo,
        });
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
          throw errore('generazione annullata o scaduta', 504);
        }
        throw errore('il servizio di generazione non risponde', 502);
      }

      if (risposta.status === 429) throw errore('quota di generazione immagini esaurita', 429);
      if (!risposta.ok) throw errore(`il servizio di generazione ha risposto ${risposta.status}`, 502);

      const dati = await risposta.json();
      return daBase64(dati?.data?.[0]?.b64_json, config, 'openai');
    },
  };
}

/**
 * Stable Diffusion WebUI in casa.
 *
 * L'API di AUTOMATIC1111 e' documentata e stabile, e la WebUI la espone da
 * sola quando la si avvia con `--api`. Nessuna chiave, nessun costo, e i
 * prompt non escono dalla rete di casa — che per una chat privata non e' un
 * dettaglio da poco.
 */
function creaAutomatic1111(config) {
  const url = (config.immagini?.url ?? '').replace(/\/+$/, '');
  const disponibile = Boolean(url);

  return {
    id: 'automatic1111',
    etichetta: 'Stable Diffusion WebUI',
    disponibile,
    motivo: disponibile ? null : 'serve TALK_IMMAGINI_URL con l\'indirizzo della WebUI',

    async genera({ prompt, signal }) {
      if (!disponibile) throw errore('generazione immagini non configurata', 501);
      const controllo = AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(ATTESA_MS),
      ]);

      let risposta;
      try {
        risposta = await fetch(`${url}/sdapi/v1/txt2img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt,
            steps: config.immagini.passi,
            width: 1024,
            height: 1024,
            batch_size: 1,
            n_iter: 1,
          }),
          signal: controllo,
        });
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') {
          throw errore(
            'la generazione ha impiegato troppo. Una scheda lenta puo\' metterci minuti: ' +
              'prova ad abbassare TALK_IMMAGINI_PASSI.',
            504,
          );
        }
        throw errore(`la WebUI non risponde su ${url}: e' accesa, e avviata con --api?`, 502);
      }

      if (risposta.status === 404) {
        throw errore(
          'la WebUI risponde ma non ha l\'API: va avviata con il parametro --api.',
          502,
        );
      }
      if (!risposta.ok) throw errore(`la WebUI ha risposto ${risposta.status}`, 502);

      const dati = await risposta.json();
      return daBase64(dati?.images?.[0], config, 'sd');
    },
  };
}

/** Da base64 a byte, con i controlli che valgono per chiunque disegni. */
function daBase64(b64, config, etichetta) {
  if (!b64) throw errore('il servizio non ha restituito i byte dell\'immagine', 502);
  // Alcune WebUI antepongono il data URL: si taglia invece di rifiutare.
  const pulito = String(b64).replace(/^data:image\/\w+;base64,/, '');
  const corpo = Buffer.from(pulito, 'base64');
  if (!corpo.length || corpo.length > config.limiti.allegatoMax) {
    throw errore('immagine generata non valida o troppo grande', 502);
  }
  return { corpo, tipo: 'image/png', nome: `immagine-${etichetta}-${Date.now()}.png` };
}

/**
 * Chi disegna su questa installazione.
 *
 * In automatico si preferisce cio' che gira in casa: se c'e' un indirizzo di
 * WebUI si usa quello, perche' e' gratis e i prompt non escono. Altrimenti
 * OpenAI, se e' configurato. Altrimenti niente, e l'interfaccia lo dice invece
 * di mostrare un pulsante che non fa nulla.
 */
export function creaGeneratoreImmagini(config) {
  const scelta = config.immagini?.provider ?? 'auto';
  const disponibili = [creaAutomatic1111(config), creaOpenai(config)];

  if (scelta !== 'auto') {
    const chiesto = [...disponibili, PERCHANCE].find((p) => p.id === scelta);
    return chiesto ?? nessuno(`provider di immagini sconosciuto: ${scelta}`);
  }

  return disponibili.find((p) => p.disponibile) ?? disponibili[0] ?? nessuno('niente configurato');
}

/** Tutti quelli che esistono, per poterli elencare e spiegare. */
export function elencoGeneratori(config) {
  return [creaAutomatic1111(config), creaOpenai(config), PERCHANCE].map((p) => ({
    id: p.id,
    etichetta: p.etichetta,
    disponibile: p.disponibile,
    motivo: p.motivo,
  }));
}

function nessuno(motivo) {
  return {
    id: 'nessuno',
    etichetta: 'Nessuno',
    disponibile: false,
    motivo,
    async genera() {
      throw errore(motivo, 501);
    },
  };
}
