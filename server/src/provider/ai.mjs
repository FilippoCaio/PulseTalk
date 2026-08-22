// Provider AI lato server. Nessun prompt, risposta o segreto viene registrato.
//
// Parla due dialetti — l'API Responses di OpenAI e il piu' diffuso
// `/chat/completions` — e quale usare lo decide ai-dialetti.mjs guardando
// l'indirizzo. E' cio' che rende vero quello che `TALK_AI_BASE_URL` prometteva:
// un Ollama sul NAS, o un servizio piu' economico, funzionano senza toccare il
// codice. La generazione di immagini e la trascrizione restano sui percorsi
// standard di OpenAI, che i servizi compatibili implementano quando li hanno.

import { scegliDialetto } from './ai-dialetti.mjs';

/** Quanto testo si accetta indietro, per non far esplodere un messaggio. */
const TESTO_MAX = 12_000;

export function creaProviderAi(config) {
  const c = config.ai;
  const disponibile = Boolean(c.apiKey);
  const dialetto = scegliDialetto({ formato: c.formato, baseUrl: c.baseUrl });

  const headers = { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' };

  const json = async (percorso, body, signal) => {
    if (!disponibile) throw errore('provider AI non configurato', 501);
    const controllo = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(c.timeoutMs)]);
    let risposta;
    try {
      risposta = await fetch(`${c.baseUrl}${percorso}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controllo });
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') throw errore('richiesta AI annullata o scaduta', 504);
      throw errore('provider AI non raggiungibile', 502);
    }
    if (!risposta.ok) {
      if (risposta.status === 429) throw errore('quota o limite del provider AI esaurito', 429);
      // Un 404 sul percorso della generazione e' quasi sempre il dialetto
      // sbagliato, ed e' un errore che senza questa riga si scopre leggendo la
      // documentazione di qualcun altro.
      if (risposta.status === 404) {
        throw errore(
          `il provider AI non conosce ${percorso}: probabilmente parla l'altro formato. ` +
            `Prova a impostare TALK_AI_FORMATO=${dialetto.nome === 'responses' ? 'chat' : 'responses'}.`,
          502,
        );
      }
      throw errore(`il provider AI ha risposto ${risposta.status}`, 502);
    }
    return risposta.json();
  };

  /** Una generazione di testo, nel dialetto giusto. */
  const genera = async ({ messaggi, maxToken, ricercaWeb = false, signal }) => {
    const dati = await json(
      dialetto.percorso,
      dialetto.corpo({ modello: c.chatModel, messaggi, maxToken, ricercaWeb }),
      signal,
    );
    const testo = dialetto.testo(dati);
    if (!testo) throw errore('il provider AI non ha restituito testo', 502);
    return { testo, fonti: ricercaWeb ? dialetto.fonti(dati) : [] };
  };

  return {
    id: c.baseUrl.includes('api.openai.com') ? 'openai' : 'compatibile',
    /** Quale formato si sta parlando. Serve a spiegarlo nel pannello. */
    formato: dialetto.nome,
    modelloChat: c.chatModel,
    modelloImmagini: c.imageModel,
    modelloStt: c.sttModel,
    capabilities: {
      chat: disponibile && Boolean(c.chatModel),
      riassunto: disponibile && Boolean(c.chatModel),
      immagini: disponibile && Boolean(c.imageModel),
      stt: disponibile && Boolean(c.sttModel),
      // Lo strumento di ricerca web vive dentro all'API Responses: con
      // /chat/completions non c'e' niente da accendere, e prometterlo
      // vorrebbe dire un pulsante che risponde sempre "non configurato".
      ricercaWeb: disponibile && Boolean(c.chatModel) && c.webSearch && dialetto.ricercaWeb,
      ricercaImmagini: false,
    },

    async chat({ prompt, contesto, signal }) {
      if (!this.capabilities.chat) throw errore('AI Chat non configurata', 501);
      const messaggi = [
        {
          ruolo: 'sistema',
          testo:
            'Sei l assistente di una chat. Rispondi nella lingua della richiesta, sii conciso e non inventare fatti.',
        },
        ...contesto.map((m) => ({
          ruolo: m.origine === 'ai' ? 'assistente' : 'utente',
          testo: m.testo,
        })),
        { ruolo: 'utente', testo: prompt },
      ];

      const { testo, fonti } = await genera({
        messaggi,
        maxToken: 1200,
        ricercaWeb: this.capabilities.ricercaWeb,
        signal,
      });

      const conFonti = fonti.length
        ? `${testo}\n\nFonti:\n${fonti.slice(0, 8).map((f) => `- ${f.titolo}: ${f.url}`).join('\n')}`
        : testo;
      return conFonti.slice(0, TESTO_MAX);
    },

    async immagine({ prompt, signal }) {
      if (!this.capabilities.immagini) throw errore('generazione immagini non configurata', 501);
      const dati = await json('/images/generations', { model: c.imageModel, prompt, size: '1024x1024', n: 1 }, signal);
      const b64 = dati.data?.[0]?.b64_json;
      if (!b64) throw errore('il provider non ha restituito i byte dell immagine', 502);
      const corpo = Buffer.from(b64, 'base64');
      if (!corpo.length || corpo.length > config.limiti.allegatoMax) throw errore('immagine generata non valida o troppo grande', 502);
      return { corpo, tipo: 'image/png', nome: `immagine-ai-${Date.now()}.png` };
    },

    async trascrivi({ corpo, tipo, signal }) {
      if (!this.capabilities.stt) throw errore('speech-to-text non configurato', 501);
      const controllo = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(c.timeoutMs)]);
      const modulo = new FormData();
      modulo.append('model', c.sttModel);
      modulo.append('response_format', 'json');
      modulo.append('file', new Blob([corpo], { type: tipo }), `audio-${Date.now()}.webm`);
      let risposta;
      try {
        risposta = await fetch(`${c.baseUrl}/audio/transcriptions`, {
          method: 'POST', headers: { authorization: `Bearer ${c.apiKey}` }, body: modulo, signal: controllo,
        });
      } catch (e) {
        if (e.name === 'AbortError' || e.name === 'TimeoutError') throw errore('trascrizione annullata o scaduta', 504);
        throw errore('provider STT non raggiungibile', 502);
      }
      if (risposta.status === 429) throw errore('quota o limite STT esaurito', 429);
      if (!risposta.ok) throw errore(`il provider STT ha risposto ${risposta.status}`, 502);
      return String((await risposta.json()).text ?? '').trim().slice(0, 8000);
    },

    async riassumi({ trascrizione, signal }) {
      if (!this.capabilities.riassunto) throw errore('riassunto AI non configurato', 501);

      // L'istruzione va nel ruolo di sistema e la trascrizione in quello
      // dell'utente: un modello locale piccolo, con tutto impastato in un
      // messaggio solo, tende a riassumere anche l'istruzione.
      const { testo } = await genera({
        messaggi: [
          {
            ruolo: 'sistema',
            testo:
              'Riassumi senza inventare. Rispondi con JSON valido e nient altro, con le chiavi ' +
              'argomenti, decisioni, problemi, attivita, daDecidere. Ogni valore e un array di stringhe.',
          },
          { ruolo: 'utente', testo: trascrizione },
        ],
        maxToken: 1600,
        signal,
      });

      const grezzo = ripuliscJson(testo);
      try {
        const valore = JSON.parse(grezzo);
        return Object.fromEntries(['argomenti', 'decisioni', 'problemi', 'attivita', 'daDecidere'].map((k) => [
          k, Array.isArray(valore[k]) ? valore[k].map(String).slice(0, 20) : [],
        ]));
      } catch {
        throw errore('il provider non ha restituito un riassunto strutturato valido', 502);
      }
    },
  };
}

/**
 * Il JSON dentro alla risposta, quando il modello ci mette qualcosa intorno.
 *
 * I modelli locali piccoli premettono volentieri una riga di cortesia o
 * chiudono il JSON in un blocco di codice, anche quando gli si dice di non
 * farlo. Buttare via la risposta per quello vorrebbe dire un riassunto che
 * fallisce a caso su meta' dei modelli.
 */
export function ripuliscJson(testo) {
  const senzaBlocco = String(testo).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const apre = senzaBlocco.indexOf('{');
  const chiude = senzaBlocco.lastIndexOf('}');
  return apre >= 0 && chiude > apre ? senzaBlocco.slice(apre, chiude + 1) : senzaBlocco.trim();
}

function errore(messaggio, statusCode) {
  return Object.assign(new Error(messaggio), { statusCode });
}
