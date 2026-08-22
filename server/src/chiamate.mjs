// chiamate.mjs - il telefono fra due persone.
//
// Una chiamata diretta e' un canale vocale che dura quanto la conversazione:
// stessa SFU, stessi gettoni, stesso codice del client. L'unica cosa che
// manca ai canali vocali normali e' il momento prima — quello in cui uno
// chiama e l'altro non ha ancora risposto — e sta tutto qui dentro.
//
// Lo stato vive in memoria e non nel database, ed e' voluto: una chiamata che
// sopravvive al riavvio del server e' una chiamata che squilla nel vuoto. Al
// riavvio non c'e' niente da riconciliare, perche' non c'e' niente da
// ricordare. Cio' che resta sul disco e' la conversazione, che e' un'altra
// cosa.

/** Quanto squilla prima di diventare una chiamata persa. */
const SQUILLI_MS = 45_000;

/** Quanto si aspetta, dopo che l'ultimo e' uscito, prima di chiudere la stanza. */
const GRAZIA_MS = 15_000;

export function creaChiamate({ eventi, presenze, log = null } = {}) {
  /** conversazione -> { stanza, da, a, stato, iniziata, timer } */
  const attive = new Map();

  const manda = (chiamata, tipo, extra = {}) =>
    eventi.aUtenti([chiamata.da, chiamata.a], {
      tipo,
      conversazione: chiamata.conversazione,
      chiamata: pubblica(chiamata),
      ...extra,
    });

  function pubblica(chiamata) {
    return {
      conversazione: chiamata.conversazione,
      stanza: chiamata.stanza,
      da: chiamata.da,
      a: chiamata.a,
      stato: chiamata.stato,
      iniziata: chiamata.iniziata,
      risposta: chiamata.risposta ?? null,
    };
  }

  function ferma(chiamata) {
    if (chiamata.timer) clearTimeout(chiamata.timer);
    chiamata.timer = null;
  }

  async function smonta(chiamata) {
    ferma(chiamata);
    attive.delete(chiamata.conversazione);
    // La stanza sulla SFU va chiusa a mano: con `auto_create` spento non
    // sparisce da sola, e restare aperta vorrebbe dire che chi ha ancora il
    // gettone in mano puo' rientrarci mezz'ora dopo.
    await presenze.chiudiStanza(chiamata.stanza).catch(() => {});
  }

  const api = {
    /** Quella in corso su questa conversazione, se c'e'. */
    attiva(conversazioneId) {
      const chiamata = attive.get(conversazioneId);
      return chiamata ? pubblica(chiamata) : null;
    },

    /** Se questa persona sta gia' squillando o parlando da qualche altra parte. */
    occupato(utenteId, esclusa = null) {
      for (const chiamata of attive.values()) {
        if (chiamata.conversazione === esclusa) continue;
        if (chiamata.da === utenteId || chiamata.a === utenteId) return true;
      }
      return false;
    },

    /**
     * Comincia a squillare.
     *
     * Se l'altro stava gia' chiamando noi, questa non apre una seconda
     * chiamata speculare: risponde alla sua. Due persone che si telefonano
     * nello stesso istante finiscono nella stessa stanza invece che ognuna ad
     * ascoltare lo squillo dell'altra — la stessa scelta fatta per le
     * richieste di amicizia, per la stessa ragione.
     */
    avvia({ conversazione, stanza, da, a }) {
      const gia = attive.get(conversazione);
      if (gia) {
        if (gia.stato === 'squilla' && gia.a === da) return api.accetta(conversazione, da);
        return { chiamata: pubblica(gia), gia: true };
      }

      const chiamata = {
        conversazione,
        stanza,
        da,
        a,
        stato: 'squilla',
        iniziata: Date.now(),
        risposta: null,
        timer: null,
      };

      chiamata.timer = setTimeout(() => {
        if (attive.get(conversazione) !== chiamata) return;
        chiamata.stato = 'persa';
        manda(chiamata, 'chiamata-finita', { motivo: 'persa' });
        void smonta(chiamata);
        log?.info({ conversazione }, 'chiamata persa');
      }, SQUILLI_MS);
      // Un timer non deve tenere in vita il processo: se il server sta
      // chiudendo, la chiamata muore con lui e non c'e' niente da aspettare.
      chiamata.timer.unref?.();

      attive.set(conversazione, chiamata);
      manda(chiamata, 'chiamata-arriva');
      return { chiamata: pubblica(chiamata), gia: false };
    },

    /** Risponde. Idempotente: due "accetto" di fila non sono un errore. */
    accetta(conversazioneId, chi) {
      const chiamata = attive.get(conversazioneId);
      if (!chiamata) return { errore: 'questa chiamata non c\'e\' piu\'' };
      // Risponde chi e' stato chiamato. Il chiamante ha gia' il proprio
      // ingresso e non deve poter trasformare da solo lo squillo in una
      // chiamata accettata passando direttamente dalla rotta HTTP.
      if (chiamata.a !== chi) return { errore: 'non puoi rispondere alla chiamata che hai avviato' };

      if (chiamata.stato !== 'in corso') {
        ferma(chiamata);
        chiamata.stato = 'in corso';
        chiamata.risposta = Date.now();
        manda(chiamata, 'chiamata-risposta');
      }
      return { chiamata: pubblica(chiamata) };
    },

    /** Rifiuta, riaggancia, o annulla: da fuori sono tre parole, qui e' una. */
    async chiudi(conversazioneId, chi, motivo = 'chiusa') {
      const chiamata = attive.get(conversazioneId);
      if (!chiamata) return { gia: true };
      if (chiamata.a !== chi && chiamata.da !== chi) return { errore: 'non e\' la tua chiamata' };

      chiamata.stato = motivo === 'rifiutata' ? 'rifiutata' : 'chiusa';
      manda(chiamata, 'chiamata-finita', { motivo, chiusaDa: chi });
      await smonta(chiamata);
      return { chiusa: conversazioneId };
    },

    /**
     * Cade la linea a entrambi: la stanza resta vuota.
     *
     * Chiamata dal webhook della SFU quando l'ultimo partecipante esce. Non
     * chiude subito: chi perde il wi-fi per dieci secondi deve ritrovare la
     * chiamata dov'era, non una schermata che dice "terminata".
     */
    vuota(stanza) {
      for (const chiamata of attive.values()) {
        if (chiamata.stanza !== stanza) continue;
        if (chiamata.stato !== 'in corso') return;
        ferma(chiamata);
        chiamata.timer = setTimeout(() => {
          if (attive.get(chiamata.conversazione) !== chiamata) return;
          manda(chiamata, 'chiamata-finita', { motivo: 'chiusa' });
          void smonta(chiamata);
        }, GRAZIA_MS);
        chiamata.timer.unref?.();
        return;
      }
    },

    /** Qualcuno e' (ri)entrato: la grazia non serve piu'. */
    viva(stanza) {
      for (const chiamata of attive.values()) {
        if (chiamata.stanza === stanza && chiamata.stato === 'in corso') ferma(chiamata);
      }
    },

    /** Chiude tutto. Serve a spegnere il server senza lasciare timer accesi. */
    spegni() {
      for (const chiamata of attive.values()) ferma(chiamata);
      attive.clear();
    },

    get quante() {
      return attive.size;
    },
  };

  return api;
}
