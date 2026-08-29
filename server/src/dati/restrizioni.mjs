// dati/restrizioni.mjs - cosa non puoi fare in questa stanza, e da quando.
//
// Quattro provvedimenti, e sono quattro perche' sono quattro cose diverse:
//
//   camera        la telecamera resta spenta. Solo spenta: accendere quella di
//                 qualcun altro non e' possibile per nessuno, con nessun
//                 permesso, mai. Non e' una svista, e' una riga che non esiste
//                 da nessuna parte in questo file ne' altrove.
//   condivisione  non puo' condividere schermo ne' audio, e cio' che stava
//                 condividendo si chiude.
//   microfono     muto forzato: non parla.
//   cuffie        muto forzato in entrata: non sente. E' l'unico dei quattro
//                 che il client da solo non potrebbe garantire, perche' basta
//                 lasciare la sottoscrizione aperta per continuare a ricevere
//                 l'audio e ascoltarlo con due righe di JavaScript.
//
// Vivono dentro a un canale vocale e non nello spazio. Un provvedimento preso
// durante una serata non deve seguire nessuno in tutte le altre stanze, e
// soprattutto: chi modera un canale non necessariamente modera gli altri.

const ora = () => Math.floor(Date.now() / 1000);

/** I quattro generi, e non se ne aggiunge un quinto senza passare da qui. */
export const GENERI = ['camera', 'condivisione', 'microfono', 'cuffie'];

const NOTI = new Set(GENERI);

export const genereNoto = (g) => NOTI.has(g);

/**
 * Quanto puo' durare al massimo un evento che non dichiara una fine.
 *
 * Serve perche' l'organizzatore di un evento e' amministratore dentro al
 * proprio evento, e un evento senza fine sarebbe un'amministrazione a tempo
 * indeterminato regalata da un permesso minore — "crea eventi" — a chi non ha
 * nessun permesso di moderazione. Quattro ore: piu' lunga di qualunque serata
 * vera, abbastanza corta da non diventare una carica.
 *
 * Chi organizza qualcosa di piu' lungo mette una fine esplicita, e allora vale
 * quella: il tetto e' per gli eventi a cui nessuno ha dato una fine, non per
 * quelli lunghi.
 */
export const DURATA_MASSIMA_EVENTO = 4 * 3600;

/**
 * Il margine prima dell'inizio e dopo la fine.
 *
 * Un quarto d'ora da entrambe le parti. Prima, perche' chi organizza entra in
 * stanza qualche minuto avanti a sistemare e li' i poteri gli servono gia'.
 * Dopo, perche' un evento non finisce all'istante scritto in agenda, e
 * togliere la moderazione mentre la gente sta ancora salutando e' esattamente
 * il momento peggiore per toglierla.
 */
export const TOLLERANZA_EVENTO = 15 * 60;

/**
 * La finestra in cui un evento conferisce poteri: `{ da, a }`, oppure nullo.
 *
 * Nullo vuol dire "questo evento non conferisce niente", e i casi sono tre:
 * non esiste, e' annullato, o non ha un canale. L'ultimo e' il piu' facile da
 * dimenticare: un evento senza canale non dice in quale stanza si comanda, e
 * "in tutte" non e' una risposta accettabile.
 */
export function finestraEvento(evento) {
  if (!evento) return null;
  if (evento.stato === 'annullato') return null;
  if (evento.canale === null || evento.canale === undefined) return null;

  const inizio = Number(evento.inizio);
  if (!Number.isFinite(inizio)) return null;

  const fineDichiarata =
    evento.fine === null || evento.fine === undefined ? null : Number(evento.fine);
  // Una fine dichiarata oltre il tetto non lo scavalca: il tetto esiste per
  // l'evento senza fine, ma una fine di tre settimane e' lo stesso problema
  // scritto in un altro modo.
  const fine =
    fineDichiarata === null || !Number.isFinite(fineDichiarata)
      ? inizio + DURATA_MASSIMA_EVENTO
      : Math.min(fineDichiarata, inizio + DURATA_MASSIMA_EVENTO);

  return { da: inizio - TOLLERANZA_EVENTO, a: fine + TOLLERANZA_EVENTO };
}

/** Se adesso ci si sta dentro. */
export function eventoInCorso(evento, adesso = ora()) {
  const finestra = finestraEvento(evento);
  if (!finestra) return false;
  return adesso >= finestra.da && adesso <= finestra.a;
}

export function creaRestrizioni(sql, db) {
  const q = {
    inserisci: sql.prepare(
      `INSERT INTO restrizioni_voce (canale, utente, genere, evento, daUtente, istante)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (canale, utente, genere) DO NOTHING`,
    ),
    togli: sql.prepare(
      'DELETE FROM restrizioni_voce WHERE canale = ? AND utente = ? AND genere = ?',
    ),
    delCanale: sql.prepare('SELECT * FROM restrizioni_voce WHERE canale = ? ORDER BY utente, genere'),
    delCanaleUtente: sql.prepare(
      'SELECT * FROM restrizioni_voce WHERE canale = ? AND utente = ? ORDER BY genere',
    ),
    conEvento: sql.prepare('SELECT * FROM restrizioni_voce WHERE evento IS NOT NULL'),
    elimina: sql.prepare('DELETE FROM restrizioni_voce WHERE id = ?'),
  };

  /**
   * Butta via quelle che l'evento che le reggeva non regge piu'.
   *
   * Gira all'inizio di ogni lettura invece che da un timer, ed e' voluto: un
   * timer che gira ogni minuto e' un timer che non gira quando il server e'
   * spento, e al riavvio si troverebbe un mucchio di restrizioni scadute
   * ancora in piedi. Cosi' invece la domanda "e' ancora valida?" e la sua
   * risposta cadono nello stesso istante, sempre, anche dopo un mese di server
   * fermo.
   *
   * Costa una lettura in piu' delle sole righe legate a un evento, che sono
   * poche per definizione: le altre non scadono mai e non vengono nemmeno
   * guardate.
   */
  function scadi(adesso = ora()) {
    const legate = q.conEvento.all();
    if (legate.length === 0) return [];

    const validi = new Map();
    const tolte = [];
    for (const riga of legate) {
      if (!validi.has(riga.evento)) {
        validi.set(riga.evento, eventoInCorso(db.eventiSpazio.evento(riga.evento), adesso));
      }
      if (!validi.get(riga.evento)) {
        q.elimina.run(riga.id);
        tolte.push(riga);
      }
    }
    return tolte;
  }

  return {
    /** Le righe decadute, per chi deve avvisare gli interessati. */
    scadi,

    /** Tutte quelle vive in un canale. */
    delCanale(canaleId) {
      scadi();
      return q.delCanale.all(canaleId);
    },

    /** I generi vivi addosso a una persona in un canale, come insieme. */
    di(canaleId, utenteId) {
      scadi();
      return new Set(q.delCanaleUtente.all(canaleId, utenteId).map((r) => r.genere));
    },

    /** Le righe intere, per chi deve mostrare chi le ha imposte e quando. */
    righeDi(canaleId, utenteId) {
      scadi();
      return q.delCanaleUtente.all(canaleId, utenteId);
    },

    /**
     * Impone o toglie, e dice se qualcosa e' cambiato davvero.
     *
     * Idempotente da entrambe le parti: due amministratori che premono insieme
     * ottengono lo stesso stato finale, e il secondo si sente rispondere che
     * non ha cambiato niente invece di un errore. Un errore, li', direbbe che
     * qualcosa non ha funzionato quando invece e' andato tutto come doveva.
     */
    imposta(canaleId, utenteId, genere, { attiva, evento = null, daUtente = null }) {
      if (!attiva) return q.togli.run(canaleId, utenteId, genere).changes > 0;
      return q.inserisci.run(canaleId, utenteId, genere, evento, daUtente, ora()).changes > 0;
    },
  };
}
