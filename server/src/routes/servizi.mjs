// routes/servizi.mjs - funzioni esterne facoltative, sempre dietro al server.

import { richiedeRuolo } from '../auth.mjs';

export function rotteServizi(app, { gif, anteprime, ai, immagini, generatoreImmagini, generatori }) {
  const rate = creaRateLimit(30, 60_000);

  app.get('/api/servizi', { onRequest: richiedeRuolo('ospite') }, async () => ({
    gif: {
      disponibile: gif.disponibile,
      provider: gif.disponibile ? gif.id : null,
      etichetta: gif.disponibile ? (gif.etichetta ?? gif.id) : null,
    },
    anteprimeLink: { disponibile: true },
    ai: {
      provider: Object.values(ai.capabilities).some(Boolean) ? ai.id : null,
      // Quale dei due formati si sta parlando: e' la prima cosa da guardare
      // quando un modello risponde 404 invece che con una frase.
      formato: ai.formato,
      ...ai.capabilities,
      // La generazione ha un provider suo: non dipende dalla chiave della chat.
      immagini: generatoreImmagini.disponibile,
      ricercaImmagini: immagini.disponibile,
    },
    /**
     * Chi puo' disegnare, e perche' gli altri no.
     *
     * Si elencano anche quelli spenti, con il motivo: "Perchance non c'e'" e
     * "Perchance non si puo' usare, ed ecco perche'" sono due risposte
     * diverse, e senza la seconda la domanda torna ogni sei mesi.
     */
    generazioneImmagini: {
      attivo: generatoreImmagini.disponibile ? generatoreImmagini.id : null,
      provider: generatori,
    },
  }));

  app.get('/api/gif/cerca', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    if (!rate(`${richiesta.utente.id}:gif`)) return risposta.code(429).send({ errore: 'troppe ricerche GIF, riprova fra poco' });
    if (!gif.disponibile) return risposta.code(501).send({ errore: 'La ricerca GIF non e\' configurata su questa istanza' });
    const q = String(richiesta.query.q ?? '').trim();
    // L'attribuzione la vogliono tutti e due nelle loro condizioni d'uso, e
    // cambia con il provider: scritta fissa nel client diceva "Tenor" anche
    // sotto ai risultati di GIPHY.
    const attribuzione = `Powered by ${gif.etichetta ?? gif.id}`;
    if (!q) return { risultati: [], attribuzione };
    return { risultati: await gif.cerca(q), attribuzione };
  });

  app.post('/api/anteprime-link', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    if (!rate(`${richiesta.utente.id}:link`)) return risposta.code(429).send({ errore: 'troppe anteprime, riprova fra poco' });
    return { anteprima: await anteprime.leggi(richiesta.body?.url) };
  });

  app.get('/api/anteprime-link/immagini/:id', { onRequest: richiedeRuolo('ospite') }, async (richiesta, risposta) => {
    const immagine = await anteprime.immagine(richiesta.params.id);
    if (!immagine) return risposta.code(404).send({ errore: 'immagine anteprima non disponibile' });
    return risposta.header('content-type', immagine.tipo).header('cache-control', 'private, max-age=3600').send(immagine.corpo);
  });

  app.get('/api/immagini/cerca', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    if (!rate(`${richiesta.utente.id}:immagini`)) return risposta.code(429).send({ errore: 'troppe ricerche immagini' });
    if (!immagini.disponibile) return risposta.code(501).send({ errore: 'ricerca immagini non configurata' });
    const q = String(richiesta.query.q ?? '').trim().slice(0, 120);
    return { risultati: q ? await immagini.cerca(q) : [], provider: immagini.id };
  });

  app.post('/api/immagini/:id/usa', { onRequest: richiedeRuolo('membro') }, async (richiesta) => {
    await immagini.usa(richiesta.params.id);
    return { ok: true };
  });
}

function creaRateLimit(massimo, finestraMs) {
  const contatori = new Map();
  return (chiave) => {
    const adesso = Date.now();
    const voce = contatori.get(chiave);
    if (!voce || voce.fino <= adesso) {
      contatori.set(chiave, { quanti: 1, fino: adesso + finestraMs });
      return true;
    }
    if (voce.quanti >= massimo) return false;
    voce.quanti += 1;
    return true;
  };
}
