// dati/collegamenti.mjs - gli account di terzi, e le chiavi per usarli.
//
// Una riga per persona e per servizio. Dentro c'e' il gettone d'accesso, che
// dura un'ora, e quello di rinnovo, che dura finche' la persona non revoca
// l'autorizzazione dal sito del servizio.
//
// Stanno sul server e non nell'applicazione per una ragione sola: rinnovare un
// gettone richiede il segreto del client, e un segreto dentro a un programma
// installato su venti computer non e' un segreto. Il prezzo e' che chi legge
// una copia di talk.db legge anche questi: e' il motivo per cui `revoca`
// esiste, ed e' il motivo per cui l'ambito richiesto e' il minimo che serve.

const ora = () => Math.floor(Date.now() / 1000);

export function creaCollegamenti(sql) {
  const q = {
    leggi: sql.prepare('SELECT * FROM collegamenti WHERE utente = ? AND provider = ?'),
    scrivi: sql.prepare(
      `INSERT INTO collegamenti (utente, provider, accesso, rinnovo, scade, ambiti, identita, nome, prodotto, collegato)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (utente, provider) DO UPDATE SET
         accesso = excluded.accesso,
         -- Il rinnovo si conserva se il servizio non ne manda uno nuovo:
         -- Spotify lo rimanda solo qualche volta, e sovrascriverlo con NULL
         -- vorrebbe dire dover rifare l'autorizzazione fra un'ora.
         rinnovo = COALESCE(excluded.rinnovo, collegamenti.rinnovo),
         scade = excluded.scade,
         ambiti = excluded.ambiti,
         identita = COALESCE(excluded.identita, collegamenti.identita),
         nome = COALESCE(excluded.nome, collegamenti.nome),
         prodotto = COALESCE(excluded.prodotto, collegamenti.prodotto)`,
    ),
    aggiornaProfilo: sql.prepare(
      'UPDATE collegamenti SET identita = ?, nome = ?, prodotto = ? WHERE utente = ? AND provider = ?',
    ),
    revoca: sql.prepare('DELETE FROM collegamenti WHERE utente = ? AND provider = ?'),
    diUtente: sql.prepare('SELECT provider, identita, nome, prodotto, collegato, ambiti FROM collegamenti WHERE utente = ?'),
  };

  return {
    leggi(utenteId, provider) {
      return q.leggi.get(utenteId, provider) ?? null;
    },

    salva(utenteId, provider, { accesso, rinnovo = null, duraSec = 3600, ambiti = '', identita = null, nome = null, prodotto = null }) {
      q.scrivi.run(
        utenteId,
        provider,
        accesso,
        rinnovo,
        ora() + Math.max(30, Number(duraSec) || 3600),
        ambiti,
        identita,
        nome,
        prodotto,
        ora(),
      );
      return q.leggi.get(utenteId, provider);
    },

    aggiornaProfilo(utenteId, provider, { identita, nome, prodotto }) {
      q.aggiornaProfilo.run(identita ?? null, nome ?? null, prodotto ?? null, utenteId, provider);
    },

    revoca(utenteId, provider) {
      return q.revoca.run(utenteId, provider).changes;
    },

    /** Cosa dire al client: mai i gettoni, solo che il collegamento c'e'. */
    riassunto(utenteId) {
      return q.diUtente.all(utenteId).map((r) => ({
        provider: r.provider,
        identita: r.identita,
        nome: r.nome,
        // Se il provider lo dichiara, serve a spiegare prima perche' i comandi
        // non funzionano. Puo' essere null: non significa account gratuito.
        prodotto: r.prodotto,
        collegato: r.collegato,
        ambiti: r.ambiti ? r.ambiti.split(' ') : [],
      }));
    },

    /** Scaduto o in scadenza fra meno di un minuto: da rinnovare. */
    daRinnovare(riga) {
      return !riga?.accesso || (riga.scade ?? 0) <= ora() + 60;
    },
  };
}
