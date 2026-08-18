// auth.mjs - chi sta chiamando, e se puo'.
//
// Un modello di accesso volutamente semplice, con
// gli stessi codici di invito e le stesse revoche, e chi amministra una delle
// due cose sa gia' amministrare l'altra.

import { ruoloBasta } from './config.mjs';

function tokenDa(richiesta) {
  const h = richiesta.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

// Aggancia `richiesta.utente`. Non rifiuta niente da solo: sono le rotte a
// dichiarare il ruolo che vogliono, cosi' una rotta senza dichiarazione non
// finisce per essere aperta per distrazione — non passa da qui affatto.
export function agganciaAutenticazione(app, { db, config }) {
  app.decorateRequest('utente', null);

  app.addHook('onRequest', async (richiesta) => {
    if (config.senzaAuth) {
      richiesta.utente = { id: 0, nome: 'senza-auth', ruolo: 'admin' };
      return;
    }
    richiesta.utente = db.utenteDaToken(tokenDa(richiesta));
  });
}

export function richiedeRuolo(ruoloMinimo) {
  return async function controllo(richiesta, risposta) {
    if (!richiesta.utente) {
      return risposta.code(401).send({ errore: 'serve un token valido' });
    }
    if (!ruoloBasta(richiesta.utente.ruolo, ruoloMinimo)) {
      return risposta.code(403).send({
        errore: `serve il ruolo "${ruoloMinimo}", il tuo e' "${richiesta.utente.ruolo}"`,
      });
    }
  };
}
