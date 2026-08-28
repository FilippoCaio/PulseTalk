// routes/spazi.mjs - spazi, categorie, canali, e il flusso degli eventi.

import { richiedeRuolo } from '../auth.mjs';
import { apriFlusso } from '../eventi.mjs';
import { PERMESSI_DI_CANALE } from '../permessi/catalogo.mjs';
import {
  accessoAlCanale,
  accessoAlloSpazio,
  puoEntrare,
  puoInvitare,
  puoTrasmettere,
  richiedePermesso,
} from '../permessi.mjs';
import { creaGettone } from '../sfu.mjs';

/** Quale permesso serve per creare/modificare/eliminare un canale di questo tipo. */
const PERMESSO_CANALE = {
  crea: { testo: 'createTextChannels', voce: 'createVoiceChannels' },
  modifica: { testo: 'editTextChannels', voce: 'editVoiceChannels' },
  elimina: { testo: 'deleteTextChannels', voce: 'deleteVoiceChannels' },
};

const DURATA_MASSIMA_MINUTI = 48 * 60;

/** Converte una durata relativa in un istante Unix, validandola in un posto solo. */
function scadenzaDaDurata(durataMinuti) {
  if (durataMinuti === undefined) return { scade: undefined };
  if (durataMinuti === null || durataMinuti === 0) return { scade: null };
  const minuti = Number(durataMinuti);
  if (!Number.isFinite(minuti) || minuti <= 0 || minuti > DURATA_MASSIMA_MINUTI) {
    return { errore: 'la durata deve essere maggiore di zero e non superare 48 ore' };
  }
  return { scade: Math.floor(Date.now() / 1000 + minuti * 60) };
}

export function rotteSpazi(app, { db, config, presenze, eventi }) {
  /** A chi va detto che qualcosa e' cambiato qui dentro. */
  const membriDelloSpazio = (spazioId) => db.membriDi(spazioId).map((m) => m.id);

  const avvisa = (spazioId, evento) => eventi.aUtenti(membriDelloSpazio(spazioId), evento);

  // -- Cosa c'e' -------------------------------------------------------------

  /**
   * Tutto quello che serve a disegnare le tre colonne, in una chiamata.
   *
   * Spazi, categorie, canali, quanti non letti, e chi sta dentro ai canali
   * vocali. Sono cinque interrogazioni al database e una alla SFU: farne
   * cinque chiamate HTTP separate significherebbe cinque giri di rete su una
   * connessione che magari passa da un telefono.
   *
   * Da qui escono anche i permessi gia' risolti — quelli sullo spazio e quelli
   * su ogni canale. Non e' un'ottimizzazione: e' l'unico modo perche' la
   * colonna a sinistra mostri gli stessi pulsanti che il server accettera'.
   * Il calcolo resta comunque di qua, e ogni rotta lo rifa' per conto suo:
   * quello che va al client serve a disegnare, non a decidere.
   */
  app.get(
    '/api/spazi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta) => {
      const dentro = await presenze.leggi();
      const miei = db.spaziDi(richiesta.utente.id);

      return {
        spazi: miei.map((spazio) => {
          const permessi = db.permessiIn(richiesta.utente, { spazio });
          const ruoloMio = permessi.has('manageServer') ? 'admin' : 'membro';
          const canali = db.canaliVisibili(spazio.id, richiesta.utente, ruoloMio);
          const nonLetti = new Map(db.nonLetti(richiesta.utente.id, spazio.id).map((r) => [r.canale, r.quanti]));

          return {
            id: spazio.id,
            chiave: spazio.chiave,
            nome: spazio.nome,
            icona: spazio.icona,
            descrizione: spazio.descrizione ?? '',
            regole: spazio.regole ?? '',
            proprietario: spazio.proprietario ?? null,
            impostazioni: db.impostazioniSpazio(spazio),
            ruoloMio,
            permessiMiei: [...permessi],
            categorie: db.categorieDi(spazio.id),
            canali: canali.map((canale) => {
              const suoi = db.permessiIn(richiesta.utente, { spazio, canale });
              return {
                id: canale.id,
                chiave: canale.chiave,
                nome: canale.nome,
                icona: canale.icona ?? null,
                tipo: canale.tipo,
                argomento: canale.argomento,
                categoria: canale.categoria,
                posizione: canale.posizione,
                soloAscolto: canale.soloAscolto,
                privato: canale.privato,
                creato: canale.creato,
                creatoDa: canale.creatoDa ?? null,
                scade: canale.scade ?? null,
                restanoMs: canale.scade === null ? null : Math.max(0, canale.scade * 1000 - Date.now()),
                // Solo quelli che cambiano da canale a canale: mandare tutti e
                // ventotto per ogni riga sarebbe rumore che non dice niente.
                permessiMiei: PERMESSI_DI_CANALE.filter((p) => suoi.has(p)),
                nonLetti: canale.tipo === 'testo' ? (nonLetti.get(canale.id) ?? 0) : 0,
                presenti: canale.tipo === 'voce' ? (dentro.get(db.chiaveSfu(canale)) ?? []) : [],
              };
            }),
          };
        }),
      };
    },
  );

  /**
   * Il flusso degli eventi: uno per persona, ci passa dentro tutto.
   *
   * Non manda lo stato iniziale — quello lo prende `GET /api/spazi`. Cosi' la
   * riconnessione e' banale: si riapre il flusso e si rilegge lo stato, senza
   * dover riconciliare cio' che e' successo mentre la linea era giu'.
   */
  app.get(
    '/api/eventi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const { manda, chiudi } = apriFlusso(richiesta, risposta);
      const disiscrivi = eventi.iscrivi(richiesta.utente.id, manda);

      richiesta.raw.on('close', () => {
        disiscrivi();
        chiudi();
      });

      // Fastify non deve considerare conclusa la richiesta: la risposta resta
      // aperta finche' non se ne va il client.
      return risposta;
    },
  );

  /**
   * Che ora e' per il server.
   *
   * Serve alle sessioni condivise — guardare un video insieme, ascoltare
   * insieme — che si sincronizzano su un orologio solo. Il client la chiama
   * qualche volta, misura il giro, e ne ricava di quanto e' avanti o indietro
   * rispetto a qui. Senza, ogni computer partirebbe dal proprio orologio, che
   * fra due macchine puo' differire di secondi.
   */
  app.get('/api/tempo', { onRequest: richiedeRuolo('ospite') }, async () => ({
    adesso: Date.now(),
  }));

  // -- Spazi -----------------------------------------------------------------

  /**
   * Uno spazio nuovo, e chiunque abbia un account puo' farlo.
   *
   * Prima ci voleva il ruolo `admin` dell'istanza, ed era una regola presa dal
   * caso piu' piccolo: quattro persone in casa, e l'unica che crea spazi e'
   * quella che ha installato il server. Su un'installazione con venti persone
   * quella stessa regola vuol dire che per farsi un posto dove parlare in tre
   * bisogna chiedere il permesso a qualcuno.
   *
   * Il motivo per cui si puo' aprire senza pentirsene e' che uno spazio nuovo
   * **non si vede**: nasce con dentro chi l'ha creato e nessun altro, e chi
   * arriva dopo ci arriva per invito. Non c'e' un elenco pubblico da riempire
   * di rumore, e la barra a sinistra di chi non e' stato invitato resta come
   * era.
   *
   * Le due cose che restano dell'admin sono quelle che toccano *gli altri*:
   * `apertoATutti`, che infilerebbe lo spazio nella barra di tutti quanti, e
   * la lista degli invitati al momento della creazione, che ce li metterebbe
   * dentro senza che nessuno abbia chiesto niente. Chi non e' admin invita nel
   * modo normale — un codice — che e' un invito che si puo' anche ignorare.
   */
  app.post(
    '/api/spazi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const {
        nome,
        icona = null,
        descrizione = '',
        regole = '',
        impostazioni = {},
        categorie = [],
        canali = [],
        invitati = [],
      } = richiesta.body ?? {};
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const amministra = richiesta.utente.ruolo === 'admin';
      const volute = typeof impostazioni === 'object' && impostazioni ? { ...impostazioni } : {};
      // Detto e non ignorato in silenzio: chi lo chiede da un client suo deve
      // sapere perche' non e' successo.
      if (!amministra && volute.apertoATutti) {
        return risposta.code(403).send({
          errore:
            'uno spazio aperto a tutti lo puo\' creare solo chi amministra il server: il tuo nasce privato, e ci entra chi inviti',
        });
      }

      const esito = db.creaSpazio({
        nome: nome.trim().slice(0, 60),
        icona: typeof icona === 'string' ? icona.slice(0, 8) : null,
        descrizione: typeof descrizione === 'string' ? descrizione : '',
        regole: typeof regole === 'string' ? regole : '',
        impostazioni: volute,
        creatoDa: richiesta.utente.id,
        // Con una struttura gia' descritta non servono i due canali di serie:
        // nascerebbero accanto a quelli chiesti e andrebbero cancellati subito.
        canaliIniziali: !Array.isArray(canali) || canali.length === 0,
      });
      if (esito.errore) return risposta.code(409).send({ errore: esito.errore });

      const spazio = esito.spazio;

      // La struttura chiesta al momento della creazione: categorie prima,
      // cosi' i canali possono gia' finirci dentro.
      const perNome = new Map();
      for (const c of Array.isArray(categorie) ? categorie.slice(0, 20) : []) {
        const nomeCat = String(c?.nome ?? c ?? '').trim();
        if (!nomeCat) continue;
        perNome.set(nomeCat, db.creaCategoria(spazio.id, nomeCat.slice(0, 40)).id);
      }

      for (const c of Array.isArray(canali) ? canali.slice(0, 40) : []) {
        if (typeof c?.nome !== 'string' || !c.nome.trim()) continue;
        db.creaCanale(spazio.id, {
          nome: c.nome.trim().slice(0, 40),
          tipo: c.tipo === 'voce' ? 'voce' : 'testo',
          categoria: c.categoria ? (perNome.get(String(c.categoria)) ?? null) : null,
          argomento: String(c.argomento ?? '').slice(0, 200),
          soloAscolto: !!c.soloAscolto,
          creatoDa: richiesta.utente.id,
        });
      }

      // Su un'istanza di casa uno spazio nuovo e' per tutti: chi c'e' gia' non
      // deve aspettare un invito per una cosa che e' stata creata in casa sua.
      // A porte chiuse, invece, ci entra solo chi viene chiamato per nome.
      if (db.impostazioniSpazio(spazio).apertoATutti) {
        for (const u of db.elencoProfili()) db.aggiungiMembro(spazio.id, u.id);
      } else if (amministra) {
        for (const chi of Array.isArray(invitati) ? invitati.slice(0, 100) : []) {
          if (db.utente(Number(chi))) db.aggiungiMembro(spazio.id, Number(chi));
        }
      }

      avvisa(spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ spazio: db.spazio(spazio.id) });
    },
  );

  /**
   * Nome, icona, descrizione, regole e preferenze.
   *
   * Una rotta sola e non cinque: sono i campi di un pannello unico, si salvano
   * insieme, e cinque rotte vorrebbero dire cinque modi diversi di sbagliare
   * il controllo dei permessi.
   */
  app.patch(
    '/api/spazi/:spazio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'manageServerSettings',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { nome, icona, descrizione, regole, impostazioni, proprietario } = richiesta.body ?? {};

      // Passare la casa a un altro e' cosa del proprietario, e di nessun altro:
      // nemmeno di chi ha manageServer. Altrimenti il permesso di amministrare
      // sarebbe anche il permesso di prendersi lo spazio.
      let nuovoProprietario;
      if (proprietario !== undefined) {
        const chi = Number(proprietario);
        const trasferito = db.trasferisciProprieta(esito.spazio.id, richiesta.utente.id, chi);
        if (trasferito.errore) {
          return risposta.code(trasferito.stato).send({ errore: trasferito.errore });
        }
        nuovoProprietario = trasferito.spazio.proprietario;
      }

      const aggiornato = db.aggiornaSpazio(esito.spazio.id, {
        nome: typeof nome === 'string' && nome.trim() ? nome.trim() : undefined,
        icona: icona === undefined ? undefined : typeof icona === 'string' ? icona.slice(0, 8) : null,
        descrizione: typeof descrizione === 'string' ? descrizione : undefined,
        regole: typeof regole === 'string' ? regole : undefined,
        proprietario: nuovoProprietario,
        impostazioni:
          impostazioni && typeof impostazioni === 'object' ? ripuliscImpostazioni(impostazioni) : undefined,
      });

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { spazio: aggiornato };
    },
  );

  app.delete(
    '/api/spazi/:spazio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio, 'admin');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Si avvisa prima di cancellare: dopo, i membri non ci sono piu' e non
      // c'e' piu' nessuno a cui dirlo.
      const destinatari = membriDelloSpazio(esito.spazio.id);

      // I canali vocali vivi vanno chiusi sulla SFU, o chi ci sta dentro
      // continua a parlare in un posto che non esiste piu'.
      for (const canale of db.canaliDi(esito.spazio.id)) {
        if (canale.tipo !== 'voce') continue;
        await presenze.chiudiStanza(db.chiaveSfu(canale)).catch(() => {});
      }

      db.eliminaSpazio(esito.spazio.id);
      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return { eliminato: esito.spazio.id };
    },
  );

  /** Tutto letto, in tutti i canali. E' la voce "segna come gia' letto". */
  app.post(
    '/api/spazi/:spazio/letto',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      for (const canale of db.canaliVisibili(esito.spazio.id, richiesta.utente, esito.ruolo)) {
        if (canale.tipo !== 'testo') continue;
        db.segnaLetto(canale.id, richiesta.utente.id, db.ultimoMessaggioDi(canale.id));
      }

      // Solo a chi ha premuto: i non letti degli altri non sono cambiati.
      // `letto-spazio` e non `spazi`: qui non e' cambiata la struttura, sono
      // cambiati dei conteggi, e rileggere tutto per azzerarli farebbe
      // ridisegnare le tre colonne per niente.
      eventi.aUtenti([richiesta.utente.id], { tipo: 'letto-spazio', spazio: esito.spazio.id });
      return { ok: true };
    },
  );

  // -- Membri ----------------------------------------------------------------

  app.get(
    '/api/spazi/:spazio/membri',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return {
        membri: db.membriConRuoli(esito.spazio.id).map((membro) => ({
          ...membro,
          amico: db.amicizia(richiesta.utente.id, membro.id)?.stato === 'amici',
        })),
      };
    },
  );

  app.post(
    '/api/spazi/:spazio/membri',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'manageMembers',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.body?.utente);
      if (!db.utente(chi)) return risposta.code(404).send({ errore: 'utente inesistente' });
      if (db.ruoli.eBandito(esito.spazio.id, chi)) {
        return risposta.code(403).send({ errore: 'questa persona e\' stata bandita da qui' });
      }

      // Promuovere ad admin e' cosa dei ruoli: chiederlo qui vorrebbe dire
      // aggirare il controllo che impedisce di regalare piu' di quanto si ha.
      db.aggiungiMembro(esito.spazio.id, chi, 'membro');
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return { aggiunto: chi };
    },
  );

  /**
   * Uscire da uno spazio.
   *
   * Sta prima della rotta con l'id perche' Fastify sceglie il percorso piu'
   * specifico, ma tenerle vicine e in quest'ordine e' cio' che rende evidente
   * che sono due cose diverse: andarsene e cacciare qualcuno.
   */
  app.delete(
    '/api/spazi/:spazio/membri/io',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (esito.spazio.proprietario === richiesta.utente.id) {
        return risposta.code(400).send({
          errore:
            'sei il proprietario di questo spazio: passa la proprieta\' a qualcun altro, oppure eliminalo',
        });
      }

      const destinatari = membriDelloSpazio(esito.spazio.id);
      db.togliMembro(esito.spazio.id, richiesta.utente.id);

      // Fuori dai canali privati e dalle chiamate: restare dentro a un canale
      // vocale di uno spazio che si e' appena lasciato e' esattamente il tipo
      // di stato incoerente che nessuno va a cercare finche' non capita.
      await sgomberaDaiVocali(db, presenze, esito.spazio.id, richiesta.utente.id);

      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return { uscito: richiesta.utente.id };
    },
  );

  app.delete(
    '/api/spazi/:spazio/membri/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'kickMembers',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.params.utente);
      const problema = nonToccare(db, esito, richiesta.utente, chi);
      if (problema) return risposta.code(403).send({ errore: problema });

      const destinatari = membriDelloSpazio(esito.spazio.id);
      db.togliMembro(esito.spazio.id, chi);
      await sgomberaDaiVocali(db, presenze, esito.spazio.id, chi);

      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return { tolto: chi };
    },
  );

  // -- Bandi -----------------------------------------------------------------

  app.get(
    '/api/spazi/:spazio/bandi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'banMembers');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return { bandi: db.ruoli.bandi(esito.spazio.id) };
    },
  );

  app.post(
    '/api/spazi/:spazio/bandi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'banMembers');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const chi = Number(richiesta.body?.utente);
      if (!db.utente(chi)) return risposta.code(404).send({ errore: 'utente inesistente' });
      const problema = nonToccare(db, esito, richiesta.utente, chi);
      if (problema) return risposta.code(403).send({ errore: problema });

      const destinatari = membriDelloSpazio(esito.spazio.id);
      db.ruoli.bandisci(esito.spazio.id, chi, {
        motivo: richiesta.body?.motivo ?? '',
        da: richiesta.utente.id,
      });
      db.togliMembro(esito.spazio.id, chi);
      await sgomberaDaiVocali(db, presenze, esito.spazio.id, chi);

      eventi.aUtenti(destinatari, { tipo: 'spazi' });
      return risposta.code(201).send({ bandito: chi });
    },
  );

  app.delete(
    '/api/spazi/:spazio/bandi/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(db, richiesta.utente, { spazio: richiesta.params.spazio }, 'banMembers');
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      db.ruoli.perdona(esito.spazio.id, Number(richiesta.params.utente));
      return { perdonato: Number(richiesta.params.utente) };
    },
  );

  // -- Categorie -------------------------------------------------------------

  app.post(
    '/api/spazi/:spazio/categorie',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'createCategories',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const nome = richiesta.body?.nome;
      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }

      const categoria = db.creaCategoria(esito.spazio.id, nome.trim().slice(0, 40));
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ categoria });
    },
  );

  app.patch(
    '/api/spazi/:spazio/categorie/:categoria',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'editCategories',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const categoria = db.categoria(Number(richiesta.params.categoria));
      if (!categoria || categoria.spazio !== esito.spazio.id) {
        return risposta.code(404).send({ errore: 'categoria inesistente' });
      }

      const aggiornata = db.aggiornaCategoria(categoria.id, {
        nome: richiesta.body?.nome,
        posizione: richiesta.body?.posizione,
      });
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { categoria: aggiornata };
    },
  );

  /** L'ordine di categorie e canali, tutto insieme. */
  app.post(
    '/api/spazi/:spazio/ordine',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const { categorie, canali } = richiesta.body ?? {};

      if (Array.isArray(categorie)) {
        if (!esito.permessi.has('editCategories')) {
          return risposta.code(403).send({ errore: 'non puoi riordinare le categorie' });
        }
        db.riordina('categorie', esito.spazio.id, categorie);
      }

      if (Array.isArray(canali)) {
        // Riordinare i canali e' modificarli: si chiede il permesso per il
        // tipo di ognuno di quelli toccati, invece di uno solo per tutti.
        for (const id of canali) {
          const canale = db.canale(Number(id));
          if (!canale || canale.spazio !== esito.spazio.id) continue;
          if (!esito.permessi.has(PERMESSO_CANALE.modifica[canale.tipo])) {
            return risposta.code(403).send({ errore: `non puoi spostare ${canale.nome}` });
          }
        }
        db.riordina('canali', esito.spazio.id, canali);
      }

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { ok: true };
    },
  );

  app.delete(
    '/api/spazi/:spazio/categorie/:categoria',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        'deleteCategories',
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      db.eliminaCategoria(Number(richiesta.params.categoria));
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { ok: true };
    },
  );

  // -- Canali ----------------------------------------------------------------

  app.post(
    '/api/spazi/:spazio/canali',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const {
        nome,
        tipo,
        categoria = null,
        argomento = '',
        soloAscolto = false,
        privato = false,
        invitati = [],
        durataMinuti,
      } = richiesta.body ?? {};

      const quale = tipo === 'voce' ? 'voce' : 'testo';
      const esito = richiedePermesso(
        db,
        richiesta.utente,
        { spazio: richiesta.params.spazio },
        PERMESSO_CANALE.crea[quale],
      );
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (typeof nome !== 'string' || !nome.trim()) {
        return risposta.code(400).send({ errore: 'serve un nome' });
      }
      const durata = scadenzaDaDurata(durataMinuti);
      if (durata.errore) return risposta.code(400).send({ errore: durata.errore });

      const creato = db.creaCanale(esito.spazio.id, {
        nome: nome.trim().slice(0, 40),
        tipo: quale,
        categoria: categoria ? Number(categoria) : null,
        argomento: String(argomento).slice(0, 200),
        soloAscolto: !!soloAscolto,
        privato: !!privato,
        creatoDa: richiesta.utente.id,
        scade: durata.scade ?? null,
      });
      if (creato.errore) return risposta.code(400).send({ errore: creato.errore });

      if (creato.canale.privato) {
        // Chi lo crea ci entra da solo: un canale privato senza nemmeno il suo
        // autore dentro sarebbe una stanza chiusa a chiave dall'esterno.
        db.iscrivi(creato.canale.id, richiesta.utente.id, richiesta.utente.id);
        for (const chi of Array.isArray(invitati) ? invitati : []) {
          if (db.ruoloNelloSpazio(esito.spazio.id, { id: Number(chi), ruolo: 'membro' })) {
            db.iscrivi(creato.canale.id, Number(chi), richiesta.utente.id);
          }
        }
      }

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return risposta.code(201).send({ canale: creato.canale });
    },
  );

  app.patch(
    '/api/canali/:canale',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.diretto) return risposta.code(404).send({ errore: 'canale inesistente' });

      if (!esito.permessi.has(PERMESSO_CANALE.modifica[esito.canale.tipo])) {
        return risposta.code(403).send({ errore: 'non puoi modificare questo canale' });
      }

      const { nome, argomento, categoria, posizione, soloAscolto, privato, icona, durataMinuti } =
        richiesta.body ?? {};
      const durata = scadenzaDaDurata(durataMinuti);
      if (durata.errore) return risposta.code(400).send({ errore: durata.errore });

      // Spostare un canale dentro a una categoria di un altro spazio lo
      // farebbe sparire dalla colonna senza cancellarlo: 400, non silenzio.
      if (categoria !== undefined && categoria !== null) {
        const dove = db.categoria(Number(categoria));
        if (!dove || dove.spazio !== esito.spazio.id) {
          return risposta.code(400).send({ errore: 'categoria inesistente in questo spazio' });
        }
      }

      db.aggiornaCanale(esito.canale.id, {
        // Due caratteri bastano per un'emoji: il taglio serve a impedire che
        // qualcuno ci infili una frase e sfondi la colonna.
        icona: typeof icona === 'string' ? icona.trim().slice(0, 4) : undefined,
        nome: typeof nome === 'string' ? nome.trim().slice(0, 40) : undefined,
        argomento: typeof argomento === 'string' ? argomento.slice(0, 200) : undefined,
        categoria: categoria === undefined ? undefined : categoria === null ? null : Number(categoria),
        posizione: posizione === undefined ? undefined : Number(posizione),
        soloAscolto,
        privato,
        scade: durata.scade,
      });

      // Un canale che diventa privato adesso non ha iscritti: senza questa
      // riga sparirebbe dagli occhi di tutti, compreso chi lo ha appena chiuso.
      if (privato === true && !db.eIscritto(esito.canale.id, richiesta.utente.id)) {
        db.iscrivi(esito.canale.id, richiesta.utente.id, richiesta.utente.id);
      }

      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { canale: db.canale(esito.canale.id) };
    },
  );

  app.delete(
    '/api/canali/:canale',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.diretto) return risposta.code(404).send({ errore: 'canale inesistente' });

      if (!esito.permessi.has(PERMESSO_CANALE.elimina[esito.canale.tipo])) {
        return risposta.code(403).send({ errore: 'non puoi eliminare questo canale' });
      }

      if (esito.canale.tipo === 'voce') {
        await presenze.chiudiStanza(db.chiaveSfu(esito.canale)).catch(() => {});
      }
      db.eliminaCanale(esito.canale.id);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      return { eliminato: esito.canale.id };
    },
  );

  // -- Chi sta dentro a un canale privato ------------------------------------

  app.get(
    '/api/canali/:canale/iscritti',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      return { iscritti: db.iscrittiAlCanale(esito.canale.id) };
    },
  );

  app.post(
    '/api/canali/:canale/iscritti',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.diretto) return risposta.code(404).send({ errore: 'canale inesistente' });
      if (!esito.canale.privato) {
        return risposta.code(400).send({ errore: 'questo canale lo vedono gia\' tutti' });
      }
      if (!puoInvitare(db, richiesta.utente, esito.canale, esito.ruolo)) {
        return risposta.code(403).send({ errore: 'per invitare bisogna essere dentro' });
      }

      const chi = Number(richiesta.body?.utente);
      if (!db.utente(chi)) return risposta.code(404).send({ errore: 'utente inesistente' });
      // Dentro a un canale ci si sta solo se si sta nello spazio che lo
      // contiene: un invito non deve essere una porta laterale.
      if (!db.ruoloNelloSpazio(esito.spazio.id, { id: chi, ruolo: 'membro' })) {
        return risposta.code(400).send({ errore: 'questa persona non e\' in questo spazio' });
      }

      db.iscrivi(esito.canale.id, chi, richiesta.utente.id);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return risposta.code(201).send({ iscritti: db.iscrittiAlCanale(esito.canale.id) });
    },
  );

  app.delete(
    '/api/canali/:canale/iscritti/:utente',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.diretto) return risposta.code(404).send({ errore: 'canale inesistente' });

      const chi = Number(richiesta.params.utente);
      // Se stesso sempre — si esce da un canale senza chiedere il permesso —
      // gli altri solo se si e' admin dello spazio.
      if (chi !== richiesta.utente.id && esito.ruolo !== 'admin') {
        return risposta.code(403).send({ errore: 'serve essere admin di questo spazio' });
      }

      db.disiscrivi(esito.canale.id, chi);
      avvisa(esito.spazio.id, { tipo: 'spazi' });
      eventi.aUtenti([chi], { tipo: 'spazi' });
      return { tolto: chi };
    },
  );

  // -- Moderare un canale vocale ---------------------------------------------
  //
  // Passa da qui e non dal gettone: il permesso di moderare non viaggia con il
  // client, quindi togliere il ruolo a un admin ha effetto alla richiesta
  // successiva invece che alla scadenza del suo gettone, sei ore dopo.

  app.post(
    '/api/canali/:canale/caccia',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (!esito.permessi.has('manageVoiceMembers')) {
        return risposta.code(403).send({ errore: 'non puoi moderare questo canale vocale' });
      }

      const identita = richiesta.body?.identita;
      if (typeof identita !== 'string' || !identita) {
        return risposta.code(400).send({ errore: 'serve l\'identita\' di chi va cacciato' });
      }

      await presenze.caccia(db.chiaveSfu(esito.canale), identita);
      avvisa(esito.spazio.id, { tipo: 'presenza', spazio: esito.spazio.id });
      richiesta.log.info(
        { da: richiesta.utente.id, chi: identita, canale: esito.canale.id },
        'cacciato',
      );
      return { cacciato: identita };
    },
  );

  // -- Entrare in un canale vocale -------------------------------------------

  app.post(
    '/api/canali/:canale/entra',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      if (esito.canale.tipo !== 'voce') {
        return risposta.code(400).send({ errore: 'questo e\' un canale di testo' });
      }
      if (!puoEntrare({ ruoloSpazio: esito.ruolo, permessi: esito.permessi })) {
        return risposta.code(403).send({ errore: 'non puoi entrare in questo canale vocale' });
      }

      const chiave = db.chiaveSfu(esito.canale);

      // La stanza deve esistere sulla SFU prima che il gettone arrivi li'.
      // Con `auto_create` spento non nasce da sola, e un gettone per una
      // stanza inesistente produce un 404 a ogni tentativo: il client riprova,
      // rinuncia, e sembra che la chiamata entri e esca subito.
      try {
        await presenze.assicuraStanza(chiave, { personeMax: config.limiti.personePerStanza });
      } catch (errore) {
        richiesta.log.warn({ err: errore, canale: chiave }, 'la SFU non risponde');
      }

      const trasmette = puoTrasmettere({
        utente: richiesta.utente,
        ruoloSpazio: esito.ruolo,
        canale: esito.canale,
        permessi: esito.permessi,
      });

      const gettone = await creaGettone({
        utente: richiesta.utente,
        stanza: { chiave, soloAscolto: !trasmette },
        config,
        moderatore: esito.permessi.has('manageVoiceMembers'),
      });

      return {
        gettone,
        sfuUrl: config.sfuUrl,
        canale: {
          id: esito.canale.id,
          nome: esito.canale.nome,
          spazio: esito.spazio.id,
          soloAscolto: esito.canale.soloAscolto,
        },
        permessi: {
          puoTrasmettere: trasmette,
          puoAscoltare: true,
          puoScrivere: esito.permessi.has('sendMessages'),
          puoCondividere: esito.permessi.has('stream'),
          moderatore: esito.permessi.has('manageVoiceMembers'),
        },
        limiti: config.limiti,
      };
    },
  );
}

/**
 * Chi non si tocca: se stessi, il proprietario, e chi sta piu' in alto.
 *
 * Senza la terza regola, chiunque possa cacciare potrebbe cacciare chi gli ha
 * dato quel permesso — e la moderazione diventerebbe una gara a chi preme per
 * primo.
 */
function nonToccare(db, esito, chi, bersaglio) {
  if (bersaglio === chi.id) return 'non puoi farlo a te stesso';
  if (bersaglio === esito.spazio.proprietario) return 'il proprietario non si tocca';

  const suoi = db.ruoli.diUtente(esito.spazio.id, bersaglio);
  const miei = db.ruoli.diUtente(esito.spazio.id, chi.id);
  const alto = (elenco) => elenco.reduce((max, r) => Math.max(max, r.priorita ?? 0), 0);

  // L'admin dell'istanza e il proprietario passano sopra alla gerarchia: sono
  // gli stessi che potrebbero aprire il database a mano.
  if (chi.ruolo === 'admin' || esito.spazio.proprietario === chi.id) return null;

  return alto(suoi) >= alto(miei) ? 'questa persona sta al tuo stesso livello, o piu\' in alto' : null;
}

/**
 * Fuori dai canali vocali di questo spazio, adesso.
 *
 * Chi viene cacciato o se ne va mentre sta parlando resterebbe collegato alla
 * SFU: il suo gettone vale ancora sei ore, e nessuno lo controlla piu' dopo
 * l'ingresso. E' l'unico posto in cui una revoca deve arrivare fino li'.
 */
async function sgomberaDaiVocali(db, presenze, spazioId, utenteId) {
  for (const canale of db.canaliDi(spazioId)) {
    if (canale.tipo !== 'voce') continue;
    await presenze.caccia(db.chiaveSfu(canale), `u${utenteId}`).catch(() => {});
  }
}

/** Solo le preferenze che esistono, e solo con valori sensati. */
function ripuliscImpostazioni(grezzo) {
  const pulite = {};
  if (typeof grezzo.invitiAperti === 'boolean') pulite.invitiAperti = grezzo.invitiAperti;
  if (typeof grezzo.invitiUsoSingolo === 'boolean') pulite.invitiUsoSingolo = grezzo.invitiUsoSingolo;
  if (typeof grezzo.eventiAperti === 'boolean') pulite.eventiAperti = grezzo.eventiAperti;
  if (typeof grezzo.apertoATutti === 'boolean') pulite.apertoATutti = grezzo.apertoATutti;

  const giorni = Number(grezzo.invitiGiorni);
  if (Number.isInteger(giorni) && giorni >= 1 && giorni <= 30) pulite.invitiGiorni = giorni;

  if (['tutto', 'menzioni', 'niente'].includes(grezzo.notifichePredefinite)) {
    pulite.notifichePredefinite = grezzo.notifichePredefinite;
  }
  return pulite;
}
