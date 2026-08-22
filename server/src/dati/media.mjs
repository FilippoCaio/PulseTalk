// dati/media.mjs - guardare e ascoltare insieme, stando ognuno a casa propria.
//
// Qui non passa un solo byte di video o di musica. Passa lo *stato*: quale
// video, se sta andando, a che secondo, e da quale istante quel secondo era
// vero. Ogni computer riproduce per conto suo, con la sua linea e la sua
// qualita', e questo modulo tiene soltanto il metronomo.
//
// L'orologio e' quello del server, in millisecondi, e non e' un dettaglio: se
// la posizione fosse "il secondo 92 secondo l'orologio di chi ha premuto
// pausa", chi la riceve non saprebbe quanto tempo e' passato nel frattempo.
// Con `aggiornato` accanto, la posizione attesa e' una sottrazione — e chi
// arriva in ritardo si mette al passo da solo.

const adesso = () => Date.now();

/** Un JSON rotto vale uno stato vuoto, non un errore che ferma la stanza. */
function leggiStato(grezzo) {
  try {
    const letto = JSON.parse(grezzo ?? '{}');
    return letto && typeof letto === 'object' ? letto : {};
  } catch {
    return {};
  }
}

function daRiga(riga) {
  return riga ? { ...riga, stato: leggiStato(riga.stato) } : null;
}

export function creaMedia(sql) {
  const q = {
    perCanale: sql.prepare('SELECT * FROM sessioni_media WHERE canale = ? AND tipo = ?'),
    perId: sql.prepare('SELECT * FROM sessioni_media WHERE id = ?'),
    delCanale: sql.prepare('SELECT * FROM sessioni_media WHERE canale = ?'),
    dellHost: sql.prepare('SELECT * FROM sessioni_media WHERE host = ?'),
    apri: sql.prepare(
      `INSERT INTO sessioni_media (canale, tipo, provider, host, stato, creato, aggiornato)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    scriviStato: sql.prepare('UPDATE sessioni_media SET stato = ?, aggiornato = ? WHERE id = ?'),
    cambiaHost: sql.prepare('UPDATE sessioni_media SET host = ?, aggiornato = ? WHERE id = ?'),
    chiudi: sql.prepare('DELETE FROM sessioni_media WHERE id = ?'),

    coda: sql.prepare(
      `SELECT c.*, u.nome AS nomeAggiunto
         FROM coda_media c LEFT JOIN utenti u ON u.id = c.aggiuntoDa
        WHERE c.sessione = ? ORDER BY c.posizione, c.id`,
    ),
    accoda: sql.prepare(
      `INSERT INTO coda_media (sessione, riferimento, titolo, durata, meta, aggiuntoDa, posizione, aggiunto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    dopoUltimo: sql.prepare(
      'SELECT COALESCE(MAX(posizione), -1) + 1 AS p FROM coda_media WHERE sessione = ?',
    ),
    vocePerId: sql.prepare('SELECT * FROM coda_media WHERE id = ?'),
    togli: sql.prepare('DELETE FROM coda_media WHERE id = ?'),
    svuota: sql.prepare('DELETE FROM coda_media WHERE sessione = ?'),
    segnaSuonato: sql.prepare('UPDATE coda_media SET suonato = 1 WHERE id = ?'),
    riazzera: sql.prepare('UPDATE coda_media SET suonato = 0 WHERE sessione = ?'),
    prossimo: sql.prepare(
      `SELECT * FROM coda_media WHERE sessione = ? AND suonato = 0
        ORDER BY posizione, id LIMIT 1`,
    ),
    riordina: sql.prepare('UPDATE coda_media SET posizione = ? WHERE id = ? AND sessione = ?'),
  };

  const api = {
    /** La sessione di questo tipo su questo canale, se e' aperta. */
    sessione(canaleId, tipo) {
      return daRiga(q.perCanale.get(canaleId, tipo));
    },

    perId(id) {
      return daRiga(q.perId.get(id));
    },

    /** Tutte quelle aperte su un canale: il client ne disegna una scheda per una. */
    delCanale(canaleId) {
      return q.delCanale.all(canaleId).map(daRiga);
    },

    /**
     * Quelle che tiene aperte questa persona.
     *
     * Serve a chiuderle quando se ne va: una sessione senza nessuno che la
     * guarda resta aperta per sempre, e chi rientrava il giorno dopo trovava il
     * video ancora li' — in pausa, al secondo di ieri sera, senza sapere chi
     * l'avesse messo.
     */
    dellHost(utenteId) {
      return q.dellHost.all(utenteId).map(daRiga);
    },

    /**
     * Apre una sessione, o restituisce quella che c'era.
     *
     * Due persone che premono "guarda insieme" nello stesso secondo devono
     * ritrovarsi nella stessa sessione, non in due: e' il vincolo UNIQUE sulla
     * coppia (canale, tipo) a garantirlo, e qui si legge l'esito invece di
     * controllare prima e sperare.
     */
    apri(canaleId, tipo, { host = null, provider = null, stato = {} } = {}) {
      const gia = api.sessione(canaleId, tipo);
      if (gia) return gia;
      try {
        const ins = q.apri.run(
          canaleId,
          tipo,
          provider,
          host,
          JSON.stringify({ ...stato, aggiornato: adesso() }),
          adesso(),
          adesso(),
        );
        return api.perId(Number(ins.lastInsertRowid));
      } catch {
        return api.sessione(canaleId, tipo);
      }
    },

    /**
     * Scrive lo stato, timbrandolo con l'ora di adesso.
     *
     * Fonde con quello che c'era invece di sostituirlo: chi manda "in pausa"
     * non deve rimandare anche il titolo del video, e un comando che arriva
     * senza un campo non deve cancellarlo.
     */
    aggiornaStato(id, modifiche) {
      const attuale = api.perId(id);
      if (!attuale) return null;
      const nuovo = { ...attuale.stato, ...modifiche, aggiornato: adesso() };
      q.scriviStato.run(JSON.stringify(nuovo), adesso(), id);
      return api.perId(id);
    },

    cambiaHost(id, utenteId) {
      q.cambiaHost.run(utenteId, adesso(), id);
      return api.perId(id);
    },

    chiudi(id) {
      return q.chiudi.run(id).changes;
    },

    // -- La coda ---------------------------------------------------------------

    coda(sessioneId) {
      return q.coda.all(sessioneId).map((r) => ({
        ...r,
        suonato: !!r.suonato,
        meta: r.meta ? leggiStato(r.meta) : null,
      }));
    },

    voce(id) {
      const riga = q.vocePerId.get(id);
      return riga ? { ...riga, suonato: !!riga.suonato, meta: riga.meta ? leggiStato(riga.meta) : null } : null;
    },

    accoda(sessioneId, { riferimento, titolo = '', durata = null, meta = null, aggiuntoDa = null }) {
      const dopo = q.dopoUltimo.get(sessioneId);
      const ins = q.accoda.run(
        sessioneId,
        String(riferimento).slice(0, 300),
        String(titolo).slice(0, 200),
        durata === null ? null : Number(durata),
        meta ? JSON.stringify(meta) : null,
        aggiuntoDa,
        dopo.p,
        adesso(),
      );
      return api.voce(Number(ins.lastInsertRowid));
    },

    togli(id) {
      return q.togli.run(id).changes;
    },

    svuota(sessioneId) {
      return q.svuota.run(sessioneId).changes;
    },

    riordina(sessioneId, idInOrdine) {
      const tutte = sql.transaction(() => {
        idInOrdine.forEach((id, indice) => q.riordina.run(indice, Number(id), sessioneId));
      });
      tutte();
    },

    segnaSuonato(id) {
      q.segnaSuonato.run(id);
    },

    /**
     * Il prossimo da suonare, con la coda che si richiude ad anello.
     *
     * Arrivati in fondo si azzerano i "gia' suonato" e si riparte dal primo:
     * e' la playlist in loop chiesta, ed e' anche il comportamento che una
     * serata lunga vuole — nessuno si alza per rimettere la coda.
     */
    prossimo(sessioneId, { anello = true } = {}) {
      const primo = q.prossimo.get(sessioneId);
      if (primo) return api.voce(primo.id);
      if (!anello) return null;
      q.riazzera.run(sessioneId);
      const daCapo = q.prossimo.get(sessioneId);
      return daCapo ? api.voce(daCapo.id) : null;
    },
  };

  return api;
}

/**
 * Dove dovrebbe essere adesso la riproduzione, secondo lo stato salvato.
 *
 * Sta qui e non nel client perche' la stessa sottrazione la fanno in due — il
 * server quando risponde, il client quando corregge il proprio player — e due
 * copie della stessa formula sono due formule che un giorno divergono.
 */
export function posizioneAttesa(stato, quando = Date.now()) {
  const base = Number(stato?.posizioneMs ?? 0);
  if (!stato?.inRiproduzione) return base;
  const passato = Math.max(0, quando - Number(stato?.aggiornato ?? quando));
  const avanti = base + passato * Number(stato?.velocita ?? 1);
  const durata = Number(stato?.durataMs ?? 0);
  return durata > 0 ? Math.min(avanti, durata) : avanti;
}
