// provider/gif.mjs - contratti e provider ufficiali per le GIF.

export function creaTenor(config) {
  const apiKey = config.tenor?.apiKey ?? '';
  const clientKey = config.tenor?.clientKey ?? 'pulse_talk';

  return {
    id: 'tenor',
    etichetta: 'Tenor',
    disponibile: !!apiKey,

    async cerca(query, { limite = 24, segnale } = {}) {
      if (!apiKey) throw Object.assign(new Error('La ricerca GIF non e\' configurata su questa istanza'), { statusCode: 501 });
      const q = String(query ?? '').trim().slice(0, 120);
      if (!q) return [];

      const url = new URL('https://tenor.googleapis.com/v2/search');
      url.search = new URLSearchParams({
        q,
        key: apiKey,
        client_key: clientKey,
        limit: String(Math.min(50, Math.max(1, limite))),
        locale: 'it_IT',
        country: 'IT',
        contentfilter: 'medium',
        media_filter: 'gif,tinygif',
      }).toString();

      const timeout = AbortSignal.timeout(7000);
      const risposta = await fetch(url, { signal: segnale ? AbortSignal.any([segnale, timeout]) : timeout });
      if (!risposta.ok) throw Object.assign(new Error(`Tenor non risponde (${risposta.status})`), { statusCode: 502 });
      const corpo = await risposta.json();
      return (Array.isArray(corpo.results) ? corpo.results : []).flatMap((voce) => {
        const gif = voce?.media_formats?.gif;
        const piccola = voce?.media_formats?.tinygif ?? gif;
        if (!gif?.url || !piccola?.url) return [];
        return [{
          id: String(voce.id),
          titolo: String(voce.content_description ?? voce.title ?? '').slice(0, 200),
          anteprima: piccola.url,
          url: gif.url,
          pagina: voce.itemurl ?? `https://tenor.com/view/${voce.id}`,
          larghezza: Number(gif.dims?.[0]) || null,
          altezza: Number(gif.dims?.[1]) || null,
          provider: 'tenor',
        }];
      });
    },
  };
}

/**
 * Giphy, l'altro provider ufficiale.
 *
 * Esiste perche' Tenor ha smesso di accettare nuovi client: chi installa
 * PulseTalk oggi una chiave Tenor non riesce piu' a ottenerla, e restava con il
 * pannello GIF spento e nessuna strada per accenderlo. Giphy le chiavi le da'
 * ancora, gratis, con un tetto di richieste che per una manciata di persone non
 * si tocca nemmeno.
 *
 * Una chiave serve comunque. Non esiste un'API GIF ufficiale che non la
 * chieda, e le scorciatoie — la chiave pubblica dei loro esempi, o il sito
 * raschiato da dietro — sono lo stesso genere di cosa che si e' gia' rifiutato
 * per Perchance: funzionano finche' non guarda nessuno.
 */
export function creaGiphy(config) {
  const apiKey = config.giphy?.apiKey ?? '';

  return {
    id: 'giphy',
    etichetta: 'GIPHY',
    disponibile: !!apiKey,

    async cerca(query, { limite = 24, segnale } = {}) {
      if (!apiKey) throw Object.assign(new Error('La ricerca GIF non e\' configurata su questa istanza'), { statusCode: 501 });
      const q = String(query ?? '').trim().slice(0, 120);
      if (!q) return [];

      const url = new URL('https://api.giphy.com/v1/gifs/search');
      url.search = new URLSearchParams({
        q,
        api_key: apiKey,
        limit: String(Math.min(50, Math.max(1, limite))),
        lang: 'it',
        // Il filtro piu' stretto che offrono: questa tendina si apre dentro a
        // una conversazione, non dentro a un motore di ricerca.
        rating: 'pg-13',
        bundle: 'messaging_non_clips',
      }).toString();

      const timeout = AbortSignal.timeout(7000);
      const risposta = await fetch(url, { signal: segnale ? AbortSignal.any([segnale, timeout]) : timeout });
      if (risposta.status === 429) throw Object.assign(new Error('limite di ricerche GIF esaurito'), { statusCode: 429 });
      if (!risposta.ok) throw Object.assign(new Error(`GIPHY non risponde (${risposta.status})`), { statusCode: 502 });
      const corpo = await risposta.json();

      return (Array.isArray(corpo.data) ? corpo.data : []).flatMap((voce) => {
        const gif = voce?.images?.downsized ?? voce?.images?.original;
        const piccola = voce?.images?.fixed_width_small ?? voce?.images?.preview_gif ?? gif;
        if (!gif?.url || !piccola?.url) return [];
        return [{
          id: String(voce.id),
          titolo: String(voce.title ?? '').slice(0, 200),
          anteprima: piccola.url,
          url: gif.url,
          pagina: voce.url ?? `https://giphy.com/gifs/${voce.id}`,
          larghezza: Number(gif.width) || null,
          altezza: Number(gif.height) || null,
          provider: 'giphy',
        }];
      });
    },
  };
}

/**
 * Quale provider GIF usare: quello che ha una chiave.
 *
 * Tenor per primo se c'e', perche' chi ce l'ha gia' non deve accorgersi di
 * niente. Se non c'e' ne' l'una ne' l'altra si restituisce comunque un
 * provider — spento, ma con un'identita' — cosi' il pannello puo' dire *cosa*
 * manca invece di limitarsi a non funzionare.
 */
export function creaGif(config) {
  const tenor = creaTenor(config);
  if (tenor.disponibile) return tenor;

  const giphy = creaGiphy(config);
  if (giphy.disponibile) return giphy;

  return {
    id: 'nessuno',
    etichetta: 'nessun provider',
    disponibile: false,
    async cerca() {
      throw Object.assign(
        new Error('La ricerca GIF non e\' configurata: serve TALK_GIPHY_API_KEY oppure TALK_TENOR_API_KEY'),
        { statusCode: 501 },
      );
    },
  };
}
