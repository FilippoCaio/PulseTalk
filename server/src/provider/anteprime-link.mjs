// provider/anteprime-link.mjs - metadata web senza trasformare PulseTalk in
// un proxy verso la rete privata.

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

const HTML_MAX = 512 * 1024;
const IMMAGINE_MAX = 2 * 1024 * 1024;
const REDIRECT_MAX = 3;
const TTL = 60 * 60_000;

export function creaAnteprimeLink() {
  const cache = new Map();
  const immagini = new Map();

  return {
    async leggi(grezzo) {
      const iniziale = urlPubblico(grezzo);
      const chiave = iniziale.toString();
      const gia = cache.get(chiave);
      if (gia && gia.scade > Date.now()) return gia.valore;

      const { url, corpo } = await scarica(iniziale, { massimo: HTML_MAX, tipo: 'text/html' });
      const html = corpo.toString('utf8');
      const titolo = pulisci(meta(html, ['og:title', 'twitter:title']) ?? titoloHtml(html) ?? '');
      const descrizione = pulisci(meta(html, ['og:description', 'description', 'twitter:description']) ?? '');
      const favicon = assoluto(metaLink(html, ['icon', 'shortcut icon']), url);
      const immagine = assoluto(meta(html, ['og:image', 'twitter:image']), url);
      let faviconId = null;
      if (favicon) {
        faviconId = createHash('sha256').update(favicon).digest('hex').slice(0, 32);
        immagini.set(faviconId, { url: favicon, scade: Date.now() + TTL, dati: null });
      }
      let immagineId = null;
      if (immagine) {
        immagineId = createHash('sha256').update(immagine).digest('hex').slice(0, 32);
        immagini.set(immagineId, { url: immagine, scade: Date.now() + TTL, dati: null });
        limita(immagini, 200);
      }

      const valore = {
        url: url.toString(),
        dominio: url.hostname,
        titolo: titolo.slice(0, 240),
        descrizione: descrizione.slice(0, 500),
        faviconId,
        immagineId,
      };
      cache.set(chiave, { valore, scade: Date.now() + TTL });
      limita(cache, 500);
      return valore;
    },

    async immagine(id) {
      const voce = immagini.get(String(id));
      if (!voce || voce.scade <= Date.now()) return null;
      if (voce.dati) return voce.dati;
      const risposta = await scarica(new URL(voce.url), { massimo: IMMAGINE_MAX, tipo: 'image/' });
      voce.dati = { corpo: risposta.corpo, tipo: risposta.contentType };
      return voce.dati;
    },
  };
}

async function scarica(iniziale, { massimo, tipo }, salti = 0) {
  if (salti > REDIRECT_MAX) throw errore('troppi reindirizzamenti', 422);
  const url = urlPubblico(iniziale);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const indirizzi = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (indirizzi.length === 0 || indirizzi.some((voce) => nonPubblico(voce.address))) {
    throw errore('questo indirizzo non e\' pubblico', 422);
  }
  const scelto = indirizzi[0];

  const risposta = await richiestaFissata(url, scelto, massimo);
  if (risposta.stato >= 300 && risposta.stato < 400 && risposta.location) {
    return scarica(new URL(risposta.location, url), { massimo, tipo }, salti + 1);
  }
  if (risposta.stato < 200 || risposta.stato >= 300) throw errore(`la pagina risponde ${risposta.stato}`, 422);
  if (!risposta.contentType.toLowerCase().startsWith(tipo)) throw errore('il contenuto non ha un formato utilizzabile', 422);
  return { url, corpo: risposta.corpo, contentType: risposta.contentType.split(';')[0] };
}

/**
 * Il DNS gia' risolto, consegnato a Node nella forma che sta chiedendo.
 *
 * L'indirizzo lo abbiamo gia' controllato: fissarlo qui impedisce che fra il
 * controllo e la connessione si infili una seconda risoluzione che punta
 * altrove — il DNS rebinding, cioe' il modo con cui un dominio pubblico
 * diventa 127.0.0.1 un millisecondo dopo essere stato promosso.
 *
 * La forma della risposta dipende da `opzioni.all`, e Node lo chiede sempre:
 * rispondere nella forma singola quando ne vuole un elenco gli fa leggere
 * `addresses[0].address` da dentro una stringa, cioe' `undefined`, e la
 * richiesta muore con "Invalid IP address: undefined" prima ancora di partire.
 * E' il motivo per cui, fino a ieri, nessuna anteprima si e' mai vista: ogni
 * URL vero rispondeva 500 e il client si mangiava l'errore in silenzio.
 *
 * Esportata apposta: e' l'unico pezzo di questo file che si puo' sbagliare
 * senza che nessun test se ne accorga, e adesso un test c'e'.
 */
export function lookupFissato(indirizzo) {
  return (_nome, opzioni, callback) =>
    opzioni?.all
      ? callback(null, [{ address: indirizzo.address, family: indirizzo.family }])
      : callback(null, indirizzo.address, indirizzo.family);
}

function richiestaFissata(url, indirizzo, massimo) {
  return new Promise((resolve, reject) => {
    const trasporto = url.protocol === 'https:' ? https : http;
    const richiesta = trasporto.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': 'PulseTalk-LinkPreview/1.0',
          accept: 'text/html,image/*;q=0.8',
          'accept-encoding': 'identity',
        },
        lookup: lookupFissato(indirizzo),
        servername: url.hostname,
      },
      (risposta) => {
        const pezzi = [];
        let quanti = 0;
        risposta.on('data', (pezzo) => {
          quanti += pezzo.length;
          if (quanti > massimo) {
            richiesta.destroy(errore('il contenuto e\' troppo grande', 413));
            return;
          }
          pezzi.push(pezzo);
        });
        risposta.on('end', () => resolve({
          stato: risposta.statusCode ?? 500,
          location: risposta.headers.location ?? null,
          contentType: String(risposta.headers['content-type'] ?? ''),
          corpo: Buffer.concat(pezzi),
        }));
      },
    );
    richiesta.setTimeout(5000, () => richiesta.destroy(errore('la pagina impiega troppo tempo', 504)));
    richiesta.on('error', reject);
    richiesta.end();
  });
}

function urlPubblico(grezzo) {
  let url;
  try {
    url = grezzo instanceof URL ? grezzo : new URL(String(grezzo));
  } catch {
    throw errore('URL non valido', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw errore('serve un URL HTTP/HTTPS senza credenziali', 400);
  }
  if (url.port && !['80', '443'].includes(url.port)) throw errore('porta URL non consentita', 422);
  return url;
}

function nonPubblico(indirizzo) {
  const basso = indirizzo.toLowerCase();
  if (basso.startsWith('::ffff:')) return nonPubblico(basso.slice(7));
  if (basso.includes(':')) {
    return basso === '::' || basso === '::1' || basso.startsWith('fc') || basso.startsWith('fd') ||
      basso.startsWith('fe8') || basso.startsWith('fe9') || basso.startsWith('fea') || basso.startsWith('feb') ||
      basso.startsWith('ff') || basso.startsWith('2001:db8:');
  }
  const p = basso.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

function meta(html, nomi) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributi(tag);
    const nome = String(a.property ?? a.name ?? '').toLowerCase();
    if (nomi.includes(nome) && a.content) return a.content;
  }
  return null;
}

function metaLink(html, relazioni) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attributi(tag);
    const rel = String(a.rel ?? '').toLowerCase();
    if (relazioni.some((r) => rel.split(/\s+/).includes(r)) && a.href) return a.href;
  }
  return null;
}

function attributi(tag) {
  const fuori = {};
  const re = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const m of tag.matchAll(re)) fuori[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return fuori;
}

function titoloHtml(html) {
  return html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
}

function pulisci(testo) {
  return String(testo)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function assoluto(grezzo, base) {
  if (!grezzo) return null;
  try {
    const url = new URL(grezzo, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function limita(mappa, massimo) {
  while (mappa.size > massimo) mappa.delete(mappa.keys().next().value);
}

function errore(messaggio, statusCode) {
  return Object.assign(new Error(messaggio), { statusCode });
}
