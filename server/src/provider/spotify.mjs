// provider/spotify.mjs - la parte di sessione musicale che parla con Spotify.
//
// Quello che l'API ufficiale permette, e quello che non permette. Vale la pena
// scriverlo qui, perche' e' la ragione per cui questo file e' fatto cosi' e non
// come uno si aspetterebbe:
//
//  * Non esiste nessuna API pubblica per le "Jam" di Spotify. Non c'e' modo di
//    creare una sessione condivisa vera, ne' di far ascoltare a due persone lo
//    stesso stream dal server. Chi lo fa, lo fa con API private o reverse
//    engineering — cose che qui non entrano.
//
//  * Cio' che si puo' fare e' comandare il player di UNA persona alla volta,
//    con il suo consenso: play, pausa, seek, coda, stato, dispositivi. Sono
//    endpoint ufficiali e documentati (/v1/me/player/...).
//
//  * Quegli endpoint funzionano solo se l'account e' Premium. Con un account
//    gratuito la risposta e' 403, e non c'e' niente da aggirare: e' una
//    condizione del servizio.
//
//  * Le app in "Development Mode" hanno limiti stretti (un Client ID per
//    sviluppatore, pochi utenti autorizzabili a mano, e il proprietario
//    dell'app deve avere Premium). Per andare oltre serve chiedere a Spotify
//    l'Extended Quota Mode.
//
//  * La ricerca accetta al massimo dieci risultati per richiesta.
//
// Da qui la scelta di fondo: la sessione condivisa e la coda sono di
// PulseTalk, tenute dal nostro server, e Spotify e' soltanto il braccio che
// suona per chi ha collegato il proprio account e ha Premium. Chi non ha
// collegato niente vede la coda e chi sta suonando cosa, e non sente nulla da
// noi. La sincronizzazione non e' campione-esatta, e non puo' esserlo: fra il
// nostro comando e il player di quella persona c'e' internet.

import { ErroreProvider } from './musica.mjs';

const AUTORIZZA = 'https://accounts.spotify.com/authorize';
const GETTONE = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/**
 * Gli ambiti chiesti, e nient'altro.
 *
 * Ognuno serve a una cosa che si vede nell'interfaccia. Chiederne uno in piu'
 * "per il futuro" vorrebbe dire far leggere a chi collega una schermata di
 * permessi piu' spaventosa di quello che il programma fa davvero.
 */
const AMBITI = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-private',
].join(' ');

/** Quanto vive uno `state` in attesa del ritorno dal browser. */
const ATTESA_MS = 10 * 60_000;

export function creaSpotify({ config, db, log = null }) {
  const impostato = !!(
    config.spotify?.clientId &&
    config.spotify?.clientSecret &&
    config.spotify?.redirectUri
  );

  /** state -> { utente, scade }. In memoria: dura il tempo di un consenso. */
  const inAttesa = new Map();

  function pulisci() {
    const adesso = Date.now();
    for (const [chiave, riga] of inAttesa) if (riga.scade < adesso) inAttesa.delete(chiave);
  }

  const base64 = () =>
    Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');

  async function chiediGettone(corpo) {
    const risposta = await fetch(GETTONE, {
      method: 'POST',
      headers: {
        authorization: `Basic ${base64()}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(corpo),
    });

    const letto = await risposta.json().catch(() => ({}));
    if (!risposta.ok) {
      throw new ErroreProvider(
        letto.error_description ?? 'Spotify ha rifiutato lo scambio del codice',
        risposta.status,
        letto,
      );
    }
    return letto;
  }

  /**
   * Il gettone d'accesso valido, rinnovandolo se serve.
   *
   * Rinnovare qui e non in un giro periodico: la maggior parte dei
   * collegamenti non viene usata per giorni, e un timer che rinnova gettoni
   * che nessuno chiedera' e' traffico verso Spotify a vuoto — piu' un modo di
   * far scadere il refresh token per inattivita' senza accorgersene.
   */
  async function accessoValido(utenteId) {
    const riga = db.collegamenti.leggi(utenteId, 'spotify');
    if (!riga) return null;
    if (!db.collegamenti.daRinnovare(riga)) return riga;
    if (!riga.rinnovo) return null;

    try {
      const nuovo = await chiediGettone({
        grant_type: 'refresh_token',
        refresh_token: riga.rinnovo,
      });
      return db.collegamenti.salva(utenteId, 'spotify', {
        accesso: nuovo.access_token,
        // Spotify rimanda il refresh solo qualche volta: quando non c'e', il
        // vecchio resta buono. Sovrascriverlo con null vorrebbe dire chiedere
        // di nuovo il consenso ogni ora.
        rinnovo: nuovo.refresh_token ?? null,
        duraSec: nuovo.expires_in,
        ambiti: nuovo.scope ?? riga.ambiti,
      });
    } catch (errore) {
      // Un rinnovo rifiutato vuol dire che la persona ha revocato l'accesso
      // dal sito di Spotify. Si cancella la riga: tenerla vorrebbe dire
      // riprovare per sempre e mostrare "collegato" a chi non lo e' piu'.
      if (errore.stato === 400 || errore.stato === 401) {
        db.collegamenti.revoca(utenteId, 'spotify');
        log?.info({ utente: utenteId }, 'collegamento Spotify revocato dal servizio');
        return null;
      }
      throw errore;
    }
  }

  /** Una chiamata all'API, con il gettone giusto e gli errori tradotti. */
  async function chiama(utenteId, percorso, opzioni = {}) {
    const riga = await accessoValido(utenteId);
    if (!riga) throw new ErroreProvider('Spotify non e\' collegato a questo account', 401);

    const risposta = await fetch(`${API}${percorso}`, {
      ...opzioni,
      headers: {
        authorization: `Bearer ${riga.accesso}`,
        ...(opzioni.body ? { 'content-type': 'application/json' } : {}),
        ...opzioni.headers,
      },
    });

    // 204 e' la risposta normale dei comandi del player: e' andata, e non c'e'
    // niente da leggere.
    if (risposta.status === 204) return null;

    const letto = await risposta.json().catch(() => null);
    if (risposta.ok) return letto;

    throw new ErroreProvider(spiega(risposta.status, letto), risposta.status, letto);
  }

  const provider = {
    nome: 'spotify',
    etichetta: 'Spotify',
    get configurato() {
      return impostato;
    },

    /**
     * Cosa questo provider NON puo' fare, detto una volta e mostrato
     * nell'interfaccia invece di lasciarlo scoprire premendo.
     */
    limiti: {
      premium: 'I comandi di riproduzione richiedono un account Spotify Premium.',
      jam: 'Spotify non offre un\'API pubblica per le sessioni Jam: la coda condivisa e\' di PulseTalk, e ogni partecipante suona sul proprio account.',
      dispositivo: 'Serve avere Spotify aperto su un dispositivo, perche\' i comandi agiscono su quello.',
      ricerca: 'La ricerca restituisce al massimo dieci risultati per richiesta.',
    },

    /** L'URL a cui mandare chi collega. Lo `state` lega il ritorno alla persona. */
    autorizza(utenteId) {
      if (!impostato) throw new ErroreProvider('Spotify non e\' configurato su questo server', 501);
      pulisci();

      const stato = crypto.randomUUID().replace(/-/g, '');
      inAttesa.set(stato, { utente: utenteId, scade: Date.now() + ATTESA_MS });

      const query = new URLSearchParams({
        client_id: config.spotify.clientId,
        response_type: 'code',
        redirect_uri: config.spotify.redirectUri,
        scope: AMBITI,
        state: stato,
        // Chi ha collegato l'account sbagliato deve poter cambiare: senza
        // questo, Spotify riusa il consenso di prima senza mostrare nulla.
        show_dialog: 'true',
      });
      return { url: `${AUTORIZZA}?${query}`, stato };
    },

    /** Il ritorno dal browser: codice in cambio dei gettoni. */
    async scambia(codice, stato) {
      pulisci();
      const attesa = inAttesa.get(stato);
      if (!attesa) throw new ErroreProvider('questa autorizzazione e\' scaduta: riprova', 400);
      inAttesa.delete(stato);

      const gettoni = await chiediGettone({
        grant_type: 'authorization_code',
        code: codice,
        redirect_uri: config.spotify.redirectUri,
      });

      db.collegamenti.salva(attesa.utente, 'spotify', {
        accesso: gettoni.access_token,
        rinnovo: gettoni.refresh_token ?? null,
        duraSec: gettoni.expires_in,
        ambiti: gettoni.scope ?? AMBITI,
      });

      // Il profilo mostra quale account e' collegato. `product`, quando c'e',
      // permette anche di spiegare prima che un account gratuito non puo'
      // comandare il player. Dal 2026 Spotify puo' ometterlo in Development
      // Mode: in quel caso resta null e sara' il comando Player a dare 403.
      try {
        const io = await chiama(attesa.utente, '/me');
        db.collegamenti.aggiornaProfilo(attesa.utente, 'spotify', {
          identita: io?.id ?? null,
          nome: io?.display_name ?? io?.id ?? null,
          prodotto: io?.product ?? null,
        });
      } catch {
        // Un profilo che non arriva non annulla il collegamento: si vedra' al
        // primo comando, con un messaggio piu' preciso di questo.
      }

      return { utente: attesa.utente };
    },

    accessoValido,

    profilo(utenteId) {
      return chiama(utenteId, '/me');
    },

    /**
     * Cerca brani.
     *
     * Dieci risultati e non venti: e' il tetto che l'API impone adesso, e
     * chiederne di piu' non fa un errore — fa una risposta piu' corta di
     * quella che l'interfaccia si aspettava.
     */
    async cerca(utenteId, q) {
      const query = new URLSearchParams({ q, type: 'track', limit: '10' });
      const letto = await chiama(utenteId, `/search?${query}`);
      return (letto?.tracks?.items ?? []).map((t) => ({
        riferimento: t.uri,
        titolo: t.name,
        artista: (t.artists ?? []).map((a) => a.name).join(', '),
        album: t.album?.name ?? '',
        durata: t.duration_ms ?? null,
        copertina: t.album?.images?.at(-1)?.url ?? null,
      }));
    },

    /**
     * Fa partire un brano sul player di questa persona.
     *
     * `device_id` solo se ci viene detto quale: senza, Spotify usa quello
     * attivo, che e' quasi sempre quello giusto. Passarne uno a caso
     * sposterebbe la musica su un altoparlante in un'altra stanza.
     */
    riproduci(utenteId, { riferimento, posizioneMs = 0, dispositivo = null } = {}) {
      const query = dispositivo ? `?device_id=${encodeURIComponent(dispositivo)}` : '';
      return chiama(utenteId, `/me/player/play${query}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...(riferimento ? { uris: [riferimento] } : {}),
          position_ms: Math.max(0, Math.floor(posizioneMs)),
        }),
      });
    },

    pausa(utenteId, { dispositivo = null } = {}) {
      const query = dispositivo ? `?device_id=${encodeURIComponent(dispositivo)}` : '';
      return chiama(utenteId, `/me/player/pause${query}`, { method: 'PUT' });
    },

    vai(utenteId, ms, { dispositivo = null } = {}) {
      const query = new URLSearchParams({ position_ms: String(Math.max(0, Math.floor(ms))) });
      if (dispositivo) query.set('device_id', dispositivo);
      return chiama(utenteId, `/me/player/seek?${query}`, { method: 'PUT' });
    },

    /** Mette in coda sul player di quella persona, non nella nostra coda. */
    accoda(utenteId, riferimento, { dispositivo = null } = {}) {
      const query = new URLSearchParams({ uri: riferimento });
      if (dispositivo) query.set('device_id', dispositivo);
      return chiama(utenteId, `/me/player/queue?${query}`, { method: 'POST' });
    },

    async adesso(utenteId) {
      const letto = await chiama(utenteId, '/me/player');
      if (!letto) return null;
      return {
        riferimento: letto.item?.uri ?? null,
        titolo: letto.item?.name ?? '',
        artista: (letto.item?.artists ?? []).map((a) => a.name).join(', '),
        durataMs: letto.item?.duration_ms ?? null,
        posizioneMs: letto.progress_ms ?? 0,
        inRiproduzione: !!letto.is_playing,
        dispositivo: letto.device?.name ?? null,
      };
    },

    async dispositivi(utenteId) {
      const letto = await chiama(utenteId, '/me/player/devices');
      return (letto?.devices ?? []).map((d) => ({
        id: d.id,
        nome: d.name,
        tipo: d.type,
        attivo: !!d.is_active,
      }));
    },
  };

  return provider;
}

/**
 * Da codice HTTP a frase che dice cosa fare.
 *
 * I due che contano sono 403 e 404, e sono quelli che senza spiegazione fanno
 * sembrare rotto il programma: il primo e' un account non Premium, il secondo
 * e' Spotify chiuso su tutti i dispositivi di quella persona.
 */
function spiega(stato, corpo) {
  const detto = corpo?.error?.message ?? corpo?.error_description ?? '';

  if (stato === 401) return 'Spotify ha rifiutato il gettone: ricollega l\'account.';
  if (stato === 403) {
    return (
      'Spotify non consente questa operazione a questo account. I comandi di riproduzione ' +
      'richiedono Spotify Premium.' + (detto ? ` (${detto})` : '')
    );
  }
  if (stato === 404) {
    return 'Nessun dispositivo Spotify attivo: apri Spotify e fai partire qualcosa, poi riprova.';
  }
  if (stato === 429) return 'Troppe richieste a Spotify: aspetta qualche secondo.';
  return detto || `Spotify ha risposto ${stato}.`;
}
