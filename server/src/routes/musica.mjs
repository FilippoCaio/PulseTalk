// routes/musica.mjs - collegare un servizio di musica, e comandarlo.
//
// Le rotte sono generiche: `:provider` e' un nome, e chi lo implementa sta in
// provider/. Oggi ce n'e' uno, Spotify; domani un altro non richiede di
// toccare questo file, solo di registrarsi nel registro.
//
// Comandare il player di una persona vuol dire comandare il SUO player. Non
// c'e' nessuna rotta che faccia partire la musica sul dispositivo di qualcun
// altro, e non e' una svista: sarebbe esattamente la cosa che, dall'altra
// parte, si vive come "il computer ha cominciato a suonare da solo".
//
// Chi ascolta insieme lo fa perche' il suo client, vedendo cambiare lo stato
// della sessione condivisa, chiede al proprio provider di mettersi in pari.

import { richiedeRuolo } from '../auth.mjs';
import { ErroreProvider } from '../provider/musica.mjs';

/** Da eccezione del provider a risposta HTTP, in un posto solo. */
function rispondiMale(risposta, errore) {
  if (errore instanceof ErroreProvider) {
    // 5xx del servizio diventano 502 per noi: il guasto non e' qui, e un 500
    // manderebbe a cercarlo nel posto sbagliato.
    const stato = errore.stato >= 500 ? 502 : errore.stato;
    return risposta.code(stato).send({ errore: errore.message });
  }
  return risposta.code(502).send({ errore: 'il servizio di musica non risponde' });
}

export function rotteMusica(app, { db, registro, config }) {
  /** Il provider chiesto, se esiste ed e' configurato. */
  function quale(richiesta) {
    const provider = registro.ottieni(richiesta.params.provider);
    if (!provider) return { errore: 'provider sconosciuto', stato: 404 };
    if (!provider.configurato) {
      return {
        errore:
          'questo server non ha le credenziali per questo servizio: vanno messe nel .env e il server va riavviato',
        stato: 501,
      };
    }
    return { provider };
  }

  /** Cosa c'e' a disposizione e a cosa sono collegato. */
  app.get(
    '/api/musica',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => ({
      provider: registro.disponibili(),
      collegamenti: db.collegamenti.riassunto(richiesta.utente.id),
      // L'indirizzo a cui torna il browser dopo il consenso: serve a chi
      // configura, per copiarlo dentro al cruscotto del servizio.
      ritorno: config.spotify?.redirectUri || null,
    }),
  );

  // -- Collegare -------------------------------------------------------------

  app.post(
    '/api/musica/:provider/collega',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = quale(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      try {
        // L'URL si apre nel browser di sistema, non in una finestra dell'app:
        // e' una pagina di accesso di terzi, e va vista con la barra degli
        // indirizzi in vista. Il client usa ponte.apriEsterno.
        return { autorizzazione: esito.provider.autorizza(richiesta.utente.id).url };
      } catch (errore) {
        return rispondiMale(risposta, errore);
      }
    },
  );

  /**
   * Il ritorno dal browser.
   *
   * Non ha autenticazione, e non puo' averla: ci arriva il browser di sistema,
   * che non ha il nostro gettone. A legare la risposta alla persona giusta e'
   * lo `state`, che il provider ha generato e si e' tenuto: senza quello, il
   * codice non vale niente.
   */
  app.get('/api/musica/:provider/ritorno', async (richiesta, risposta) => {
    const provider = registro.ottieni(richiesta.params.provider);
    if (!provider) return risposta.code(404).send({ errore: 'provider sconosciuto' });

    const { code, state, error } = richiesta.query ?? {};
    if (error) return risposta.type('text/html').send(pagina(`Autorizzazione annullata: ${error}`));
    if (!code || !state) {
      return risposta.type('text/html').send(pagina('Manca il codice di autorizzazione.'));
    }

    try {
      await provider.scambia(String(code), String(state));
      richiesta.log.info({ provider: provider.nome }, 'account di musica collegato');
      return risposta.type('text/html').send(pagina(`${provider.etichetta} e' collegato. Puoi chiudere questa pagina.`, true));
    } catch (errore) {
      richiesta.log.warn({ err: errore }, 'collegamento fallito');
      return risposta.type('text/html').send(pagina(errore.message ?? 'Collegamento fallito.'));
    }
  });

  app.delete(
    '/api/musica/:provider/collega',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta) => {
      // Solo da noi: revocare davvero l'accesso si fa dal sito del servizio, e
      // dirlo e' piu' onesto che far credere il contrario.
      db.collegamenti.revoca(richiesta.utente.id, richiesta.params.provider);
      return { scollegato: richiesta.params.provider };
    },
  );

  // -- Comandare il proprio player -------------------------------------------

  app.get(
    '/api/musica/:provider/cerca',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = quale(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const q = String(richiesta.query?.q ?? '').trim();
      if (!q) return { risultati: [] };

      try {
        return { risultati: await esito.provider.cerca(richiesta.utente.id, q) };
      } catch (errore) {
        return rispondiMale(risposta, errore);
      }
    },
  );

  app.get(
    '/api/musica/:provider/dispositivi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = quale(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      try {
        return { dispositivi: await esito.provider.dispositivi(richiesta.utente.id) };
      } catch (errore) {
        return rispondiMale(risposta, errore);
      }
    },
  );

  app.get(
    '/api/musica/:provider/adesso',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = quale(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      try {
        return { riproduzione: await esito.provider.adesso(richiesta.utente.id), adesso: Date.now() };
      } catch (errore) {
        return rispondiMale(risposta, errore);
      }
    },
  );

  /**
   * Mettiti in pari.
   *
   * E' la rotta che il client chiama quando la sessione condivisa cambia: dice
   * al proprio player quale brano e da che punto. Il salto e la partenza sono
   * lo stesso comando perche' per Spotify lo sono — `play` accetta gia' la
   * posizione, e farne due chiamate significherebbe sentire mezzo secondo
   * dell'inizio prima del salto.
   */
  app.post(
    '/api/musica/:provider/allinea',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = quale(richiesta);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { riferimento = null, posizioneMs = 0, inRiproduzione = true, dispositivo = null } =
        richiesta.body ?? {};

      try {
        if (!inRiproduzione) {
          await esito.provider.pausa(richiesta.utente.id, { dispositivo });
          return { ok: true, adesso: Date.now() };
        }

        if (riferimento) {
          await esito.provider.riproduci(richiesta.utente.id, {
            riferimento,
            posizioneMs,
            dispositivo,
          });
        } else {
          await esito.provider.vai(richiesta.utente.id, posizioneMs, { dispositivo });
        }
        return { ok: true, adesso: Date.now() };
      } catch (errore) {
        return rispondiMale(risposta, errore);
      }
    },
  );

}

/** La paginetta che vede il browser dopo il consenso. Statica, senza script. */
function pagina(testo, riuscito = false) {
  const colore = riuscito ? '#3ecf8e' : '#f5a524';
  const sicuro = String(testo)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<title>PulseTalk</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
      background:#0b0e14;color:#e6e9f0;font-family:system-ui,sans-serif}
 .c{max-width:28rem;padding:2rem;border:1px solid #232b3d;border-radius:1rem;background:#121722;text-align:center}
 h1{font-size:1.1rem;margin:0 0 .75rem}
 p{margin:0;color:#98a2b8;line-height:1.6}
 .p{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;background:${colore};margin-right:.5rem}
</style></head>
<body><div class="c"><h1><span class="p"></span>PulseTalk</h1><p>${sicuro}</p></div></body></html>`;
}
