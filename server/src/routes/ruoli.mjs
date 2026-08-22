// routes/ruoli.mjs - ruoli, permessi e override, dall'applicazione.
//
// Tutto quello che sta qui dentro si puo' gia' fare aprendo SQLite sul NAS.
// Non e' un buon motivo per lasciarlo la': chi amministra uno spazio non e'
// per forza chi amministra la macchina, ed e' proprio la separazione fra le
// due cose che rende utili i ruoli.
//
// Ogni rotta controlla il permesso sul server. La colonna a sinistra nasconde
// i pulsanti a chi non puo' premerli, ma quella e' cortesia: la porta chiusa
// e' qui.

import { richiedeRuolo } from '../auth.mjs';
import {
  GRUPPI_PERMESSI,
  PERMESSI,
  PERMESSI_DI_CANALE,
  ripuliscePermessi,
} from '../permessi/catalogo.mjs';
import { accessoAlloSpazio, richiedePermesso } from '../permessi.mjs';
import { sgomberaChiNonPuoPiu } from '../sgombero.mjs';

/** Un colore vero, o niente. Serve solo a disegnare il pallino accanto al nome. */
function colorePulito(grezzo) {
  if (grezzo === null || grezzo === '') return null;
  if (typeof grezzo !== 'string') return undefined;
  return /^#[0-9a-fA-F]{6}$/.test(grezzo.trim()) ? grezzo.trim().toLowerCase() : undefined;
}

export function rotteRuoli(app, { db, eventi, presenze = null }) {
  const avvisa = (spazioId, evento) =>
    eventi.aUtenti(db.membriDi(spazioId).map((m) => m.id), evento);

  /**
   * Dopo aver cambiato i permessi: chi non potrebbe piu' entrare, esce.
   *
   * Senza questa riga un gettone gia' consegnato continuerebbe a valere per
   * sei ore, e togliere a qualcuno il permesso di stare in un canale vocale
   * non lo farebbe uscire da li'. Non si aspetta l'esito: la risposta al
   * pannello non deve dipendere da quanto ci mette la SFU.
   */
  const sgombera = (spazioId) => {
    if (!presenze) return;
    void sgomberaChiNonPuoPiu(db, presenze, spazioId, app.log).catch(() => {});
  };

  /**
   * Il catalogo dei permessi, come lo conosce QUESTO server.
   *
   * L'applicazione ne ha una copia per scrivere le etichette in italiano, ma
   * l'elenco che conta e' questo: un client piu' nuovo che conosce un permesso
   * che il server non ha ancora deve poterlo scoprire senza provarci.
   */
  app.get('/api/permessi', { onRequest: richiedeRuolo('ospite') }, async () => ({
    permessi: PERMESSI,
    gruppi: GRUPPI_PERMESSI,
    diCanale: PERMESSI_DI_CANALE,
  }));

  // -- Ruoli -----------------------------------------------------------------

  app.get(
    '/api/spazi/:spazio/ruoli',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // I ruoli li vedono tutti i membri: servono a capire chi e' chi
      // nell'elenco delle persone, e nasconderli renderebbe illeggibile la
      // colonna dei membri senza proteggere niente.
      return {
        ruoli: db.ruoli.diSpazio(esito.spazio.id).map((r) => ({
          ...r,
          membri: r.tipo === 'base' ? null : db.ruoli.membriDelRuolo(r.id),
        })),
      };
    },
  );

  app.post(
    '/api/spazi/:spazio/ruoli',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageRoles');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { nome, colore = null, permessi = [], priorita = 10 } = richiesta.body ?? {};
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const tinta = colorePulito(colore);
      if (tinta === undefined) return risposta.code(400).send({ errore: 'colore non valido' });

      const chiesti = ripuliscePermessi(permessi);
      const mancanti = daNonRegalare(db, richiesta.utente, esito, chiesti);
      if (mancanti.length) {
        return risposta.code(403).send({
          errore: `non puoi dare permessi che non hai: ${mancanti.join(', ')}`,
        });
      }

      const ruolo = db.ruoli.crea(esito.spazio.id, {
        nome: nome.trim().slice(0, 40),
        colore: tinta,
        permessi: chiesti,
        priorita: limitePriorita(priorita),
      });

      avvisa(esito.spazio.id, { tipo: 'ruoli', spazio: esito.spazio.id });
      return risposta.code(201).send({ ruolo });
    },
  );

  app.patch(
    '/api/spazi/:spazio/ruoli/:ruolo',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageRoles');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const ruolo = db.ruoli.ruolo(Number(richiesta.params.ruolo));
      if (!ruolo || ruolo.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'ruolo inesistente' });
      }

      const { nome, colore, permessi, priorita } = richiesta.body ?? {};

      // Il ruolo Admin ha tutto per costruzione: elencargli dei permessi non
      // vorrebbe dire niente, e lasciar credere che glieli si stia togliendo
      // sarebbe peggio che rifiutare.
      if (ruolo.tipo === 'admin' && permessi !== undefined) {
        return risposta.code(400).send({
          errore: 'il ruolo Admin ha tutti i permessi per definizione: non si modificano',
        });
      }

      const tinta = colore === undefined ? undefined : colorePulito(colore);
      if (tinta === undefined && colore !== undefined) {
        return risposta.code(400).send({ errore: 'colore non valido' });
      }

      if (permessi !== undefined) {
        const mancanti = daNonRegalare(db, richiesta.utente, esito, ripuliscePermessi(permessi));
        if (mancanti.length) {
          return risposta.code(403).send({
            errore: `non puoi dare permessi che non hai: ${mancanti.join(', ')}`,
          });
        }
      }

      const aggiornato = db.ruoli.aggiorna(ruolo.id, {
        nome: nome === undefined ? undefined : String(nome).trim().slice(0, 40) || ruolo.nome,
        colore: tinta,
        permessi,
        // La gerarchia dei tre ruoli predefiniti non si sposta: e' cio' che
        // rende prevedibile chi vince quando due override si contraddicono.
        priorita: priorita === undefined || ruolo.tipo !== 'custom' ? undefined : limitePriorita(priorita),
      });

      avvisa(esito.spazio.id, { tipo: 'ruoli', spazio: esito.spazio.id });
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      sgombera(esito.spazio.id);
      return { ruolo: aggiornato };
    },
  );

  app.delete(
    '/api/spazi/:spazio/ruoli/:ruolo',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageRoles');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const ruolo = db.ruoli.ruolo(Number(richiesta.params.ruolo));
      if (!ruolo || ruolo.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'ruolo inesistente' });
      }
      if (ruolo.tipo !== 'custom') {
        return risposta.code(400).send({ errore: 'i ruoli predefiniti non si cancellano' });
      }

      db.ruoli.elimina(ruolo.id);
      avvisa(esito.spazio.id, { tipo: 'ruoli', spazio: esito.spazio.id });
      // Chi aveva quel ruolo ha appena cambiato permessi: la colonna dei canali
      // va riletta, o resterebbe a mostrare cose che non si possono piu' aprire.
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      sgombera(esito.spazio.id);
      return { eliminato: ruolo.id };
    },
  );

  // -- Chi ha quale ruolo ----------------------------------------------------

  app.post(
    '/api/spazi/:spazio/ruoli/:ruolo/membri',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageRoles');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const ruolo = db.ruoli.ruolo(Number(richiesta.params.ruolo));
      if (!ruolo || ruolo.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'ruolo inesistente' });
      }
      if (ruolo.tipo === 'base') {
        return risposta.code(400).send({ errore: 'il ruolo base ce l\'hanno gia\' tutti' });
      }

      const chi = Number(richiesta.body?.utente);
      if (!db.ruoloNelloSpazio(esito.spazio.id, { id: chi, ruolo: 'membro' })) {
        return risposta.code(404).send({ errore: 'questa persona non e\' in questo spazio' });
      }

      // Dare un ruolo che concede piu' di quanto si abbia sarebbe un modo
      // elegante di promuoversi passando da un'altra persona.
      const mancanti = daNonRegalare(db, richiesta.utente, esito, ruolo.tipo === 'admin' ? PERMESSI : ruolo.permessi);
      if (mancanti.length) {
        return risposta.code(403).send({ errore: 'questo ruolo da\' piu\' di quanto tu abbia' });
      }

      db.ruoli.assegna(ruolo.id, chi);
      avvisa(esito.spazio.id, { tipo: 'ruoli', spazio: esito.spazio.id });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return risposta.code(201).send({ assegnato: chi });
    },
  );

  app.delete(
    '/api/spazi/:spazio/ruoli/:ruolo/membri/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'manageRoles');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const ruolo = db.ruoli.ruolo(Number(richiesta.params.ruolo));
      if (!ruolo || ruolo.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'ruolo inesistente' });
      }

      const chi = Number(richiesta.params.utente);
      // Il proprietario non si spoglia: e' l'unico modo di garantire che
      // rimanga sempre qualcuno capace di rimettere a posto i permessi.
      if (chi === esito.spazio.proprietario && ruolo.tipo === 'admin') {
        return risposta.code(400).send({ errore: 'il proprietario resta admin' });
      }

      db.ruoli.togli(ruolo.id, chi);
      avvisa(esito.spazio.id, { tipo: 'ruoli', spazio: esito.spazio.id });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      sgombera(esito.spazio.id);
      return { tolto: chi };
    },
  );

  // -- Override su categorie e canali ----------------------------------------

  app.get(
    '/api/spazi/:spazio/override/:ambito/:bersaglio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = controllaAmbito(db, richiesta, 'managePermissions');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return { override: db.ruoli.overrideDi(esito.ambito, esito.bersaglio) };
    },
  );

  app.put(
    '/api/spazi/:spazio/override/:ambito/:bersaglio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = controllaAmbito(db, richiesta, 'managePermissions');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { tipo, soggetto, consenti = [], nega = [] } = richiesta.body ?? {};
      if (tipo !== 'ruolo' && tipo !== 'utente') {
        return risposta.code(400).send({ errore: 'il tipo dev\'essere ruolo o utente' });
      }

      const chi = Number(soggetto);
      if (tipo === 'ruolo') {
        const ruolo = db.ruoli.ruolo(chi);
        if (!ruolo || ruolo.spazio !== esito.spazio.id) {
          return risposta.code(404).send({ errore: 'ruolo inesistente' });
        }
      } else if (!db.ruoloNelloSpazio(esito.spazio.id, { id: chi, ruolo: 'membro' })) {
        return risposta.code(404).send({ errore: 'questa persona non e\' in questo spazio' });
      }

      db.ruoli.impostaOverride(esito.ambito, esito.bersaglio, {
        tipo,
        soggetto: chi,
        consenti,
        nega,
      });

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      sgombera(esito.spazio.id);
      return { override: db.ruoli.overrideDi(esito.ambito, esito.bersaglio) };
    },
  );

  app.delete(
    '/api/spazi/:spazio/override/:ambito/:bersaglio/:tipo/:soggetto',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = controllaAmbito(db, richiesta, 'managePermissions');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      db.ruoli.eliminaOverride(
        esito.ambito,
        esito.bersaglio,
        richiesta.params.tipo,
        Number(richiesta.params.soggetto),
      );
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      sgombera(esito.spazio.id);
      return { ok: true };
    },
  );
}

/** Le priorita' dei ruoli inventati stanno sotto a Master e sopra alla base. */
function limitePriorita(grezzo) {
  const n = Number(grezzo);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(89, Math.round(n)));
}

/**
 * I permessi che stai per dare e che tu non hai.
 *
 * Senza questo controllo, chi puo' gestire i ruoli potrebbe crearne uno con
 * dentro manageServer, darselo, e ritrovarsi padrone dello spazio partendo da
 * un permesso solo. E' la scala che nessuno vuole lasciare appoggiata al muro.
 * Il proprietario e l'admin dell'istanza hanno tutto e non incontrano mai
 * questa funzione.
 */
function daNonRegalare(db, utente, esito, chiesti) {
  const miei = esito.permessi ?? db.permessiIn(utente, { spazio: esito.spazio });
  return chiesti.filter((p) => !miei.has(p));
}

/** Ambito valido, bersaglio dentro allo spazio giusto, permesso in mano. */
function controllaAmbito(db, richiesta, permesso) {
  const ambito = richiesta.params.ambito;
  if (ambito !== 'categoria' && ambito !== 'canale') {
    return { errore: 'ambito sconosciuto', stato: 404 };
  }

  const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, permesso);
  if (esito.errore) return esito;

  const bersaglio = Number(richiesta.params.bersaglio);
  const riga = ambito === 'categoria' ? db.categoria(bersaglio) : db.canale(bersaglio);
  if (!riga || riga.spazio !== esito.spazio.id) {
    return { errore: `${ambito} inesistente`, stato: 404 };
  }

  return { ...esito, ambito, bersaglio };
}
