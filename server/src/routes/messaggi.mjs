// routes/messaggi.mjs - la chat che resta.
//
// A differenza della prima versione, dove i messaggi viaggiavano sul canale
// dati di WebRTC e sparivano con la chiamata, qui passano dal server e restano
// sul NAS. Il cambiamento non e' solo tecnico: una chat che resta e' una chat
// in cui si puo' scrivere a qualcuno che non c'e' ancora.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale, accessoAlloSpazio } from '../permessi.mjs';

const TESTO_MAX = 4000;

// Un'emoji, e nient'altro. Senza questo controllo una "reazione" potrebbe
// essere un paragrafo, e l'interfaccia che le dispone in riga si sfascerebbe.
//
// I pezzi invisibili sono scritti per punto di codice e non come carattere: lo
// ZWJ che unisce due figure in una (U+200D), il selettore che le rende
// colorate (U+FE0F) e le tonalita' della pelle. Scritti in chiaro sarebbero
// invisibili nel sorgente, e il primo editor che normalizza il file li
// mangerebbe senza che nessuno se ne accorga.
const EMOJI = new RegExp(
  '^\\p{Extended_Pictographic}' +
    '(\\u200d\\p{Extended_Pictographic}|[\\ufe0f\\u{1f3fb}-\\u{1f3ff}])*$',
  'u',
);

export function rotteMessaggi(app, { db, eventi }) {
  /**
   * A chi va detto che in questo canale e' successo qualcosa.
   *
   * Per un canale normale sono i membri dello spazio. Per una conversazione
   * diretta sono le due persone e nessun altro: lo spazio che le contiene e'
   * quello di sistema, e i suoi "membri" sono tutti quelli che si sono
   * scambiati un messaggio da quando esiste l'installazione.
   */
  const destinatari = (esito) => db.destinatariCanale(esito.canale.id);

  /**
   * Come si chiama, per il client, il posto in cui e' arrivato il messaggio.
   *
   * Il campo `spazio` di un evento serve a decidere quale colonna aggiornare.
   * Per un messaggio diretto quella colonna non esiste: al suo posto va l'id
   * della conversazione, che e' cio' che l'elenco dei DM sa disegnare.
   */
  const dove = (esito) => {
    if (!esito.diretto) return { spazio: esito.spazio.id };
    const conversazione = db.diretti.perCanale(esito.canale.id);
    return { spazio: esito.spazio.id, conversazione: conversazione?.id ?? null, diretto: true };
  };

  /**
   * "Fin qui l'ho letto", detto a chi ha letto.
   *
   * Va soltanto alle sue sessioni, ed e' voluto: e' l'unica persona per cui
   * questo fatto cambia qualcosa da disegnare. A tutte le sue sessioni pero',
   * non solo a quella che ha chiesto — letto sul telefono e' letto anche sul
   * computer, e un numero blu che resta acceso su un apparecchio e spento
   * sull'altro e' peggio di uno che resta acceso su entrambi.
   */
  const annunciaLettura = (esito, utenteId, fino) => {
    eventi.aUtenti([utenteId], {
      tipo: 'letto',
      ...dove(esito),
      canale: esito.canale.id,
      fino,
    });
  };

  /**
   * Le due spunte, dette a chi ha scritto.
   *
   * Solo per le conversazioni dirette. In un canale di spazio "gli e' arrivato"
   * non vuol dire niente — arrivato a chi, dei quaranta? — e mostrare una
   * spunta li' sarebbe una promessa che nessuno puo' mantenere.
   *
   * Va a tutti e due i capi e non solo a chi ha scritto: cosi' la stessa riga
   * di codice serve anche a chi apre la conversazione da due apparecchi.
   */
  const annunciaRicevute = (esito) => {
    if (!esito.diretto) return;
    for (const utente of destinatari(esito)) {
      eventi.aUtenti([utente], {
        tipo: 'ricevute',
        ...dove(esito),
        canale: esito.canale.id,
        ricevute: db.ricevuteDi(esito.canale.id, utente),
      });
    }
  };

  // -- Leggere ---------------------------------------------------------------

  app.get(
    '/api/canali/:canale/messaggi',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const prima = richiesta.query.prima ? Number(richiesta.query.prima) : null;
      const quanti = richiesta.query.quanti ? Number(richiesta.query.quanti) : 50;

      const messaggi = db.messaggi(esito.canale.id, { prima, quanti });

      // Leggere la conversazione e' la prova che i messaggi sono arrivati, ed
      // e' la strada che copre chi era spento quando sono stati scritti:
      // l'evento in tempo reale non l'ha ricevuto nessuno, ma adesso e' qui.
      if (esito.diretto) {
        const ultimo = db.ultimoMessaggioDi(esito.canale.id);
        const erano = db.ricevuteDi(esito.canale.id, richiesta.utente.id);
        db.segnaConsegnato(esito.canale.id, richiesta.utente.id, ultimo);
        if (db.ricevuteDi(esito.canale.id, richiesta.utente.id).consegnato !== erano.consegnato) {
          annunciaRicevute(esito);
        }
      }

      return {
        messaggi,
        // Se ne sono tornati meno di quanti chiesti, non ce n'e' altri dietro:
        // il client puo' smettere di risalire senza una seconda chiamata a
        // vuoto ogni volta che si arriva in cima.
        altri: messaggi.length >= Math.min(quanti, 100),
        ricevute: esito.diretto ? db.ricevuteDi(esito.canale.id, richiesta.utente.id) : null,
      };
    },
  );

  // -- Scrivere --------------------------------------------------------------

  app.post(
    '/api/canali/:canale/messaggi',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });
      // Anche i canali vocali hanno la loro chat, come su Discord: si apre
      // dal fumetto mentre si e dentro. Il divieto che stava qui aveva senso
      // quando quella chat non esisteva.
      if (!esito.permessi.has('sendMessages')) {
        return risposta.code(403).send({ errore: 'non puoi scrivere in questo canale' });
      }

      const { testo = '', rispondeA = null, allegati = [] } = richiesta.body ?? {};
      const pulito = String(testo).trim().slice(0, TESTO_MAX);
      const daLegare = Array.isArray(allegati) ? allegati.map(Number).filter(Number.isInteger) : [];

      // Un messaggio senza testo e senza allegati e' un a capo per sbaglio.
      if (!pulito && daLegare.length === 0) {
        return risposta.code(400).send({ errore: 'il messaggio e\' vuoto' });
      }

      // Si puo' rispondere solo a qualcosa che sta in questo canale: l'id di un
      // messaggio di un altro spazio produrrebbe una citazione che il
      // destinatario non ha il diritto di vedere.
      let citato = null;
      if (rispondeA) {
        const quello = db.messaggio(Number(rispondeA));
        if (quello && quello.canale === esito.canale.id) citato = quello.id;
      }

      const id = db.scriviMessaggio({
        canale: esito.canale.id,
        autore: richiesta.utente.id,
        testo: pulito,
        rispondeA: citato,
      });

      if (daLegare.length) db.legaAllegati(id, daLegare, richiesta.utente.id);

      // Chi scrive ha letto fin qui per definizione: senza questo, il proprio
      // messaggio comparirebbe fra i non letti.
      db.segnaLetto(esito.canale.id, richiesta.utente.id, id);
      // Anche sugli altri suoi apparecchi: scritto dal telefono, il computer
      // non deve accendere un numero blu per una frase che ha scritto lui.
      annunciaLettura(esito, richiesta.utente.id, id);

      const messaggio = db.messaggi(esito.canale.id, { prima: id + 1, quanti: 1 })[0];
      eventi.aUtenti(destinatari(esito), {
        tipo: 'messaggio',
        ...dove(esito),
        canale: esito.canale.id,
        messaggio,
      });

      // Consegnato vuol dire che il messaggio e' uscito verso un apparecchio
      // acceso. Lo decide il server guardando se il flusso di quella persona e'
      // aperto: chiederlo al client vorrebbe dire lasciare al destinatario la
      // scelta di risultare raggiungibile o no, e la seconda spunta smetterebbe
      // di voler dire qualcosa.
      if (esito.diretto) {
        for (const utente of destinatari(esito)) {
          if (utente !== richiesta.utente.id && eventi.collegato(utente)) {
            db.segnaConsegnato(esito.canale.id, utente, id);
          }
        }
        annunciaRicevute(esito);
      }

      return risposta.code(201).send({ messaggio });
    },
  );

  app.patch(
    '/api/messaggi/:messaggio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello) return risposta.code(404).send({ errore: 'messaggio inesistente' });

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Solo il proprio, e nemmeno un admin. Moderare significa togliere, non
      // riscrivere: un messaggio modificato da qualcun altro sarebbe una cosa
      // che uno non ha detto, con sopra il suo nome.
      if (quello.autore !== richiesta.utente.id) {
        return risposta.code(403).send({ errore: 'si possono modificare solo i propri messaggi' });
      }

      const testo = String(richiesta.body?.testo ?? '').trim().slice(0, TESTO_MAX);
      if (!testo) return risposta.code(400).send({ errore: 'il messaggio e\' vuoto' });

      db.modificaMessaggio(quello.id, testo);
      const messaggio = db.messaggi(quello.canale, { prima: quello.id + 1, quanti: 1 })[0];

      eventi.aUtenti(destinatari(esito), {
        tipo: 'messaggio-modificato',
        ...dove(esito),
        canale: quello.canale,
        messaggio,
      });
      return { messaggio };
    },
  );

  app.delete(
    '/api/messaggi/:messaggio',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello) return risposta.code(404).send({ errore: 'messaggio inesistente' });

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      // Solo il proprio, come per la modifica: un messaggio e' di chi lo ha
      // scritto, e lo toglie soltanto lui — nemmeno il proprietario dello
      // spazio glielo cancella.
      //
      // L'unica riga in cui autore e padrone non coincidono e' la risposta
      // dell'AI: a scriverla e' il bot dello spazio, ma esiste perche'
      // qualcuno l'ha chiesta. Senza `richiestoDa` resterebbe li' per sempre,
      // perche' il bot non fa login e quindi non cancella niente.
      const suo = quello.autore === richiesta.utente.id
        || quello.richiestoDa === richiesta.utente.id;
      if (!suo) {
        return risposta.code(403).send({ errore: 'non puoi eliminare i messaggi degli altri' });
      }

      db.eliminaMessaggio(quello.id);
      eventi.aUtenti(destinatari(esito), {
        tipo: 'messaggio-eliminato',
        ...dove(esito),
        canale: quello.canale,
        id: quello.id,
      });
      return { eliminato: quello.id };
    },
  );

  // -- Reazioni --------------------------------------------------------------

  app.post(
    '/api/messaggi/:messaggio/reazioni',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const quello = db.messaggio(Number(richiesta.params.messaggio));
      if (!quello || quello.eliminato) {
        return risposta.code(404).send({ errore: 'messaggio inesistente' });
      }

      const esito = accessoAlCanale(db, richiesta.utente, quello.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const emoji = String(richiesta.body?.emoji ?? '');
      if (!EMOJI.test(emoji)) return risposta.code(400).send({ errore: 'serve una emoji' });

      // Premere due volte toglie, come ovunque: e' lo stesso gesto, e avere
      // due rotte per accendere e spegnere costringerebbe il client a sapere
      // gia' cosa aveva fatto.
      const tolta = db.togliReazione(quello.id, richiesta.utente.id, emoji);
      if (!tolta) db.reagisci(quello.id, richiesta.utente.id, emoji);

      const reazioni = db.reazioniDi(quello.id);
      eventi.aUtenti(destinatari(esito), {
        tipo: 'reazioni',
        ...dove(esito),
        canale: quello.canale,
        messaggio: quello.id,
        reazioni,
      });
      return { reazioni };
    },
  );

  // -- Non letti -------------------------------------------------------------

  app.post(
    '/api/canali/:canale/letto',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      const fino = Number(richiesta.body?.fino) || db.ultimoMessaggioDi(esito.canale.id);
      db.segnaLetto(esito.canale.id, richiesta.utente.id, fino);
      // Chi ha letto ha anche ricevuto: senza questo, aprire la conversazione
      // da un apparecchio che non era collegato quando il messaggio e' arrivato
      // farebbe comparire "letto" senza che sia mai comparso "consegnato".
      db.segnaConsegnato(esito.canale.id, richiesta.utente.id, fino);
      annunciaRicevute(esito);
      // E il numero blu si spegne. Prima questa riga non c'era: la lettura
      // finiva nel database e nessuno lo diceva all'elenco dei canali, che
      // restava fermo al conteggio dell'ultima `GET /api/spazi`. Il pallino si
      // accendeva da solo e non si spegneva mai, se non ricaricando per caso.
      annunciaLettura(esito, richiesta.utente.id, fino);
      return { fino };
    },
  );

  // -- Ricerca ---------------------------------------------------------------

  app.get(
    '/api/spazi/:spazio/cerca',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const esito = accessoAlloSpazio(db, richiesta.utente, richiesta.params.spazio);
      if (esito.errore) return risposta.code(esito.stato).send({ errore: esito.errore });

      if (!db.ricercaDisponibile) {
        return risposta.code(501).send({ errore: 'questa installazione non ha l\'indice di ricerca' });
      }

      const query = String(richiesta.query.q ?? '');
      const canale = richiesta.query.canale ? Number(richiesta.query.canale) : null;

      // Un canale di un altro spazio darebbe risultati che chi cerca non ha il
      // diritto di leggere.
      if (canale) {
        const suo = db.canale(canale);
        if (!suo || suo.spazio !== esito.spazio.id) {
          return risposta.code(404).send({ errore: 'canale inesistente' });
        }
      }

      return {
        risultati: db.cerca({
          spazio: esito.spazio.id,
          canale,
          query,
          utente: richiesta.utente,
          ruolo: esito.ruolo,
        }),
      };
    },
  );
}
