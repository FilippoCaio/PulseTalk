// Ricerca immagini ufficiale Unsplash, normalizzata e senza chiave nel renderer.

export function creaUnsplash(config) {
  const chiave = config.unsplash.accessKey;
  const chiama = async (percorso) => {
    if (!chiave) throw Object.assign(new Error('ricerca immagini non configurata'), { statusCode: 501 });
    let risposta;
    try {
      risposta = await fetch(`https://api.unsplash.com${percorso}`, {
        headers: { authorization: `Client-ID ${chiave}`, 'accept-version': 'v1' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw Object.assign(new Error('provider immagini non raggiungibile'), { statusCode: 502 });
    }
    if (risposta.status === 429) throw Object.assign(new Error('limite ricerca immagini esaurito'), { statusCode: 429 });
    if (!risposta.ok) throw Object.assign(new Error(`provider immagini ha risposto ${risposta.status}`), { statusCode: 502 });
    return risposta.json();
  };
  return {
    id: 'unsplash',
    disponibile: Boolean(chiave),
    async cerca(q) {
      const dati = await chiama(`/search/photos?query=${encodeURIComponent(q)}&per_page=24&content_filter=high`);
      return (dati.results ?? []).map((r) => ({
        id: String(r.id),
        titolo: String(r.alt_description ?? r.description ?? 'Immagine').slice(0, 180),
        anteprima: r.urls?.small ?? r.urls?.thumb,
        immagine: r.urls?.regular,
        pagina: r.links?.html,
        autore: r.user?.name ?? 'Autore su Unsplash',
      })).filter((r) => r.anteprima && r.immagine && r.pagina);
    },
    async usa(id) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(id))) throw Object.assign(new Error('immagine non valida'), { statusCode: 400 });
      await chiama(`/photos/${encodeURIComponent(id)}/download`);
    },
  };
}
