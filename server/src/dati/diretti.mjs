// dati/diretti.mjs - i messaggi fra due persone.
//
// La scelta che regge tutto sta qui: una conversazione diretta *e'* un canale.
// Un canale privato, dentro a uno spazio di sistema che non compare in nessuna
// barra laterale e che non ha ne' ruoli ne' proprietario.
//
// Sembra un giro largo e invece e' la strada corta. Messaggi, allegati,
// reazioni, risposte citate, non letti, ricerca, modifica e cancellazione sono
// gia' scritti e gia' collaudati per i canali: rifarli per i messaggi diretti
// vorrebbe dire una seconda implementazione da tenere allineata alla prima per
// sempre — e il giorno in cui si corregge un difetto in una delle due,
// l'altra se lo tiene.
//
// L'unica cosa che questo modulo aggiunge e' l'accoppiamento fra le due
// persone e il loro canale, e la garanzia che nessuno ci entri dentro: chi
// amministra l'istanza qui non ha nessun potere in piu' degli altri, e
// accessoAlCanale lo verifica guardando `spazi.sistema`.

const ora = () => Math.floor(Date.now() / 1000);

/** La chiave dello spazio che contiene tutte le conversazioni. */
export const SPAZIO_DIRETTI = 'diretti';

export function creaDiretti(sql, db) {
  const q = {
    spazio: sql.prepare('SELECT * FROM spazi WHERE chiave = ? AND sistema = 1'),
    perCoppia: sql.prepare('SELECT * FROM conversazioni WHERE uno = ? AND due = ?'),
    perId: sql.prepare('SELECT * FROM conversazioni WHERE id = ?'),
    perCanale: sql.prepare('SELECT * FROM conversazioni WHERE canale = ?'),
    inserisci: sql.prepare(
      'INSERT INTO conversazioni (uno, due, canale, creato) VALUES (?, ?, ?, ?)',
    ),
    mie: sql.prepare(
      `SELECT c.*,
              (SELECT MAX(m.id) FROM messaggi m WHERE m.canale = c.canale) AS ultimo,
              (SELECT COALESCE(l.ultimoMessaggio, 0) FROM letture l
                WHERE l.canale = c.canale AND l.utente = ?) AS letto
         FROM conversazioni c
        WHERE c.uno = ? OR c.due = ?`,
    ),
    nonLetti: sql.prepare(
      `SELECT COUNT(*) AS quanti FROM messaggi
        WHERE canale = ? AND autore <> ? AND eliminato = 0
          AND id > COALESCE((SELECT ultimoMessaggio FROM letture WHERE canale = ? AND utente = ?), 0)`,
    ),
  };

  /** La coppia, sempre ordinata: e' la chiave unica di `conversazioni`. */
  const coppia = (a, b) => (a < b ? [a, b] : [b, a]);

  /**
   * Lo spazio che contiene le conversazioni, creandolo se non c'e'.
   *
   * Nasce alla prima conversazione e non all'avvio: un'installazione in cui
   * nessuno si e' mai scritto in privato non ha nessun motivo di avere una
   * riga in piu' nel database.
   */
  function assicuraSpazio() {
    const gia = q.spazio.get(SPAZIO_DIRETTI);
    if (gia) return gia;

    const esito = db.creaSpazio({
      nome: 'Messaggi diretti',
      sistema: true,
      canaliIniziali: false,
    });
    // La chiave viene dal nome, e qui serve che sia esattamente quella che
    // cerchiamo: se il nome cambiasse, questo modulo non ritroverebbe piu'
    // nulla. Per questo la si riscrive a mano una volta sola.
    if (esito.spazio) {
      sql.prepare('UPDATE spazi SET chiave = ? WHERE id = ?').run(SPAZIO_DIRETTI, esito.spazio.id);
    }
    return q.spazio.get(SPAZIO_DIRETTI);
  }

  const api = {
    /**
     * La conversazione fra due persone, aprendola se non esiste.
     *
     * Idempotente: chiamarla dieci volte non fa dieci canali. Le due persone
     * diventano iscritte del canale, ed e' l'iscrizione — non la membership
     * dello spazio di sistema — a decidere chi puo' leggere.
     */
    conversazione(a, b) {
      if (a === b) return { errore: 'non si scrive a se stessi' };
      if (!db.utente(a) || !db.utente(b)) return { errore: 'questa persona non esiste' };

      const [uno, due] = coppia(a, b);
      const gia = q.perCoppia.get(uno, due);
      if (gia) return { conversazione: gia };

      const spazio = assicuraSpazio();

      const apri = sql.transaction(() => {
        const creato = db.creaCanale(spazio.id, {
          // La chiave e' univoca dentro allo spazio, e questa lo e' per
          // costruzione: due id ordinati non si ripetono mai.
          nome: `dm-${uno}-${due}`,
          tipo: 'testo',
          privato: true,
        });
        if (creato.errore) throw new Error(creato.errore);

        db.iscrivi(creato.canale.id, uno, null);
        db.iscrivi(creato.canale.id, due, null);

        // Membri dello spazio di sistema: serve solo perche' il resto del
        // programma dia per scontato che chi legge un canale stia nel suo
        // spazio. Non da' nessun diritto — quello spazio non ha ruoli.
        db.aggiungiMembro(spazio.id, uno);
        db.aggiungiMembro(spazio.id, due);

        const ins = q.inserisci.run(uno, due, creato.canale.id, ora());
        return q.perId.get(Number(ins.lastInsertRowid));
      });

      return { conversazione: apri() };
    },

    /** Quella che c'e' gia', senza aprirne una nuova. */
    esistente(a, b) {
      const [uno, due] = coppia(a, b);
      return q.perCoppia.get(uno, due) ?? null;
    },

    perId(id) {
      return q.perId.get(id) ?? null;
    },

    perCanale(canaleId) {
      return q.perCanale.get(canaleId) ?? null;
    },

    /** L'altra persona. */
    altro(conversazione, utenteId) {
      return conversazione.uno === utenteId ? conversazione.due : conversazione.uno;
    },

    /**
     * Le conversazioni di una persona, come le disegna l'elenco.
     *
     * Ordinate per ultimo messaggio e non per data di apertura: quello che
     * serve e' "con chi ho parlato di recente", non "chi ho conosciuto prima".
     * Quelle senza nemmeno un messaggio restano in fondo — sono canali aperti
     * e mai usati, e nasconderli farebbe sparire la conversazione appena
     * cominciata prima ancora di scrivere.
     */
    mie(utenteId) {
      const righe = q.mie.all(utenteId, utenteId, utenteId);
      return righe
        .map((riga) => {
          const altro = api.altro(riga, utenteId);
          const profilo = db.utente(altro);
          const ultimo = riga.ultimo ? db.messaggio(riga.ultimo) : null;
          return {
            id: riga.id,
            canale: riga.canale,
            creato: riga.creato,
            con: profilo
              ? {
                  id: profilo.id,
                  nome: profilo.nome,
                  utente: profilo.utente,
                  avatar: profilo.avatar,
                  stato: profilo.stato ?? 'online',
                }
              : null,
            ultimo: ultimo
              ? {
                  id: ultimo.id,
                  autore: ultimo.autore,
                  testo: ultimo.eliminato ? '' : ultimo.testo,
                  istante: ultimo.istante,
                  eliminato: !!ultimo.eliminato,
                }
              : null,
            nonLetti: q.nonLetti.get(riga.canale, utenteId, riga.canale, utenteId).quanti,
          };
        })
        .filter((c) => c.con !== null)
        .sort((a, b) => (b.ultimo?.id ?? 0) - (a.ultimo?.id ?? 0));
    },

    /** Chi partecipa, per mandare gli eventi solo a loro due. */
    destinatari(conversazione) {
      return [conversazione.uno, conversazione.due];
    },

    /** La chiave con cui la SFU conosce la chiamata di questa conversazione. */
    chiaveChiamata(conversazione) {
      return `dm--${conversazione.id}`;
    },
  };

  return api;
}
