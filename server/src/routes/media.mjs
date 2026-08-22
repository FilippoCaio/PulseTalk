// routes/media.mjs - guardare e ascoltare insieme.
//
// Due sessioni diverse con la stessa ossatura, ed e' il motivo per cui stanno
// in un file solo: un video di YouTube e una coda musicale condivisa hanno lo
// stesso identico problema — dire a tutti *cosa* e *da che punto*, e tenerli
// insieme mentre il tempo passa.
//
// Cio' che NON passa di qui e' il contenuto. Nessun video viene ritrasmesso da
// un partecipante agli altri: ogni computer apre il suo player e usa la sua
// linea. PulseTalk sincronizza soltanto lo stato, che sono duecento byte ogni
// volta che qualcuno tocca qualcosa. E' la differenza fra una funzione che si
// puo' tenere accesa in cinque e una che satura la salita di chi condivide.
//
// L'orologio e' quello del server. Ogni risposta e ogni evento portano
// `adesso`, e il client ne ricava di quanto e' avanti o indietro: senza, due
// macchine con orologi diversi di tre secondi resterebbero disallineate per
// sempre, e nessuna delle due saprebbe di esserlo.

import { richiedeRuolo } from '../auth.mjs';
import { posizioneAttesa } from '../dati/media.mjs';
import { accessoAlCanale } from '../permessi.mjs';

/** L'identificativo di un video di YouTube: undici caratteri, e nient'altro. */
const VIDEO_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

/** Le sessioni che questo server sa tenere. */
const TIPI = ['youtube', 'musica'];

export function rotteMedia(app, { db, eventi }) {
  /**
   * Dove sta questa sessione, e chi ha il diritto di toccarla.
   *
   * Un canale vocale dello spazio, oppure la conversazione di una chiamata
   * diretta. Le due cose finiscono nello stesso posto — una riga di
   * `sessioni_media` agganciata a un canale — e da qui in giu' il codice non
   * ha piu' bisogno di sapere quale delle due fosse.
   */
  function contesto(richiesta, canaleId) {
    const esito = accessoAlCanale(db, richiesta.utente, canaleId);
    if (esito.errore) return esito;

    if (esito.diretto) {
      return {
        ...esito,
        destinatari: db.destinatariCanale(esito.canale.id),
        puoComandare: true,
      };
    }

    return {
      ...esito,
      destinatari: db.destinatariCanale(esito.canale.id),
      // Condividere qualcosa da guardare insieme e' una condivisione: chiede
      // lo stesso permesso dello schermo. Chi non ce l'ha guarda e basta.
      puoComandare: esito.permessi.has('stream'),
    };
  }

  const avvisa = (ctx, sessione, extra = {}) =>
    eventi.aUtenti(ctx.destinatari, {
      tipo: 'media',
      canale: ctx.canale.id,
      sessione: sessione ? vista(sessione) : null,
      adesso: Date.now(),
      ...extra,
    });

  /**
   * Chi apre una sessione se la porta dietro quando esce.
   *
   * Prima non la chiudeva nessuno. "Guarda insieme" restava aperta dopo la
   * chiusura dell'applicazione, e riaprendola il giorno dopo il video era
   * ancora li': stessa sessione, stesso secondo, e nessuno dentro. L'unico modo
   * per toglierla era premere "chiudi la sessione", cioe' ricordarsi di una
   * cosa che si era gia' chiusa.
   *
   * Si guarda l'ultimo flusso e non il primo: chi ha l'applicazione aperta
   * anche sul telefono non deve perdere la sessione chiudendo il portatile.
   */
  eventi.quandoCambiaPresenza((utenteId, collegato) => {
    if (collegato) return;
    for (const sessione of db.media.dellHost(utenteId)) {
      const canale = db.canale(sessione.canale);
      if (!canale) continue;
      db.media.chiudi(sessione.id);
      eventi.aUtenti(db.destinatariCanale(canale.id), {
        tipo: 'media',
        canale: canale.id,
        sessione: null,
        adesso: Date.now(),
        evento: 'chiusa',
        chiusa: sessione.id,
      });
    }
  });

  /** Come una sessione esce di qui: stato, coda, e la posizione attesa adesso. */
  function vista(sessione) {
    if (!sessione) return null;
    return {
      id: sessione.id,
      canale: sessione.canale,
      tipo: sessione.tipo,
      provider: sessione.provider,
      host: sessione.host,
      stato: sessione.stato,
      posizioneAttesa: posizioneAttesa(sessione.stato),
      coda: db.media.coda(sessione.id),
      aggiornato: sessione.aggiornato,
    };
  }

  /** La sessione, se e' di un canale che questa persona puo' vedere. */
  function suaSessione(richiesta) {
    const sessione = db.media.perId(Number(richiesta.params.sessione));
    if (!sessione) return { errore: 'sessione inesistente', stato: 404 };
    const ctx = contesto(richiesta, sessione.canale);
    if (ctx.errore) return { errore: 'sessione inesistente', stato: 404 };
    return { sessione, ctx };
  }

  // -- Aprire e chiudere -----------------------------------------------------

  app.get(
    '/api/canali/:canale/media',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const ctx = contesto(richiesta, richiesta.params.canale);
      if (ctx.errore) return risposta.code(ctx.stato).send({ errore: ctx.errore });

      return {
        sessioni: db.media.delCanale(ctx.canale.id).map(vista),
        adesso: Date.now(),
        puoComandare: ctx.puoComandare,
      };
    },
  );

  app.post(
    '/api/canali/:canale/media',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const ctx = contesto(richiesta, richiesta.params.canale);
      if (ctx.errore) return risposta.code(ctx.stato).send({ errore: ctx.errore });
      if (!ctx.puoComandare) {
        return risposta.code(403).send({ errore: 'non puoi aprire una sessione condivisa qui' });
      }

      const tipo = richiesta.body?.tipo;
      if (!TIPI.includes(tipo)) return risposta.code(400).send({ errore: 'tipo sconosciuto' });

      const provider = tipo === 'musica' ? String(richiesta.body?.provider ?? 'spotify') : null;

      const sessione = db.media.apri(ctx.canale.id, tipo, {
        host: richiesta.utente.id,
        provider,
        stato: { inRiproduzione: false, posizioneMs: 0 },
      });

      avvisa(ctx, sessione, { evento: 'aperta' });
      return risposta.code(201).send({ sessione: vista(sessione), adesso: Date.now() });
    },
  );

  app.delete(
    '/api/media/:sessione',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });
      if (!trovata.ctx.puoComandare && trovata.sessione.host !== richiesta.utente.id) {
        return risposta.code(403).send({ errore: 'non puoi chiudere questa sessione' });
      }

      db.media.chiudi(trovata.sessione.id);
      avvisa(trovata.ctx, null, { evento: 'chiusa', chiusa: trovata.sessione.id });
      return { chiusa: trovata.sessione.id };
    },
  );

  /**
   * Lo stato adesso. E' la risincronizzazione periodica.
   *
   * Il client la chiama ogni tanto anche quando non e' successo niente: gli
   * eventi possono essersi persi durante una riconnessione, e una sessione che
   * resta indietro di venti secondi senza accorgersene e' peggio di una
   * chiamata in piu' ogni dieci secondi.
   */
  app.get(
    '/api/media/:sessione',
    { onRequest: richiedeRuolo('ospite') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });
      return {
        sessione: vista(trovata.sessione),
        adesso: Date.now(),
        puoComandare: trovata.ctx.puoComandare,
      };
    },
  );

  // -- I comandi -------------------------------------------------------------

  /**
   * Play, pausa, salto, cambio video, avanti.
   *
   * Una rotta sola e non cinque. Sono tutte la stessa cosa vista da vicino —
   * scrivere lo stato e dirlo a tutti — e cinque rotte vorrebbero dire cinque
   * posti in cui dimenticarsi di timbrare l'ora.
   */
  app.post(
    '/api/media/:sessione/comando',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });
      if (!trovata.ctx.puoComandare) {
        return risposta.code(403).send({ errore: 'qui puoi solo guardare' });
      }

      const { azione } = richiesta.body ?? {};
      const sessione = trovata.sessione;
      let modifiche = null;

      switch (azione) {
        case 'play':
          modifiche = { inRiproduzione: true, posizioneMs: posizioneOppure(richiesta, sessione) };
          break;

        case 'pausa':
          modifiche = { inRiproduzione: false, posizioneMs: posizioneOppure(richiesta, sessione) };
          break;

        case 'salta':
          // Il salto porta con se' lo stato di riproduzione che c'era: chi
          // sposta la barra a video in pausa non si aspetta che riparta.
          modifiche = { posizioneMs: posizioneOppure(richiesta, sessione) };
          break;

        case 'riparti':
          modifiche = { posizioneMs: 0, inRiproduzione: true };
          break;

        case 'cambia': {
          const scelto = riferimentoValido(sessione.tipo, richiesta.body?.riferimento);
          if (!scelto) return risposta.code(400).send({ errore: 'riferimento non valido' });
          modifiche = {
            riferimento: scelto,
            titolo: String(richiesta.body?.titolo ?? '').slice(0, 200),
            durataMs: Number(richiesta.body?.durataMs) || 0,
            posizioneMs: 0,
            inRiproduzione: true,
          };
          break;
        }

        case 'prossimo': {
          const voce = db.media.prossimo(sessione.id);
          if (!voce) {
            return risposta.code(400).send({ errore: 'la coda e\' vuota' });
          }
          db.media.segnaSuonato(voce.id);
          modifiche = {
            riferimento: voce.riferimento,
            titolo: voce.titolo,
            durataMs: voce.durata ? voce.durata : 0,
            vocePosizione: voce.id,
            posizioneMs: 0,
            inRiproduzione: true,
          };
          break;
        }

        default:
          return risposta.code(400).send({ errore: 'azione sconosciuta' });
      }

      const aggiornata = db.media.aggiornaStato(sessione.id, modifiche);
      avvisa(trovata.ctx, aggiornata, { evento: azione, da: richiesta.utente.id });
      return { sessione: vista(aggiornata), adesso: Date.now() };
    },
  );

  /** Passare il timone. Serve alla musica, dove l'host decide cosa parte. */
  app.post(
    '/api/media/:sessione/host',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });

      const chi = Number(richiesta.body?.utente ?? richiesta.utente.id);
      // Se lo prende chi comanda, oppure lo passa chi ce l'ha adesso.
      const suo = trovata.sessione.host === richiesta.utente.id;
      if (!suo && !trovata.ctx.puoComandare) {
        return risposta.code(403).send({ errore: 'non puoi cambiare chi guida' });
      }
      if (!trovata.ctx.destinatari.includes(chi)) {
        return risposta.code(400).send({ errore: 'chi guida deve poter vedere questo canale' });
      }

      const aggiornata = db.media.cambiaHost(trovata.sessione.id, chi);
      avvisa(trovata.ctx, aggiornata, { evento: 'host' });
      return { sessione: vista(aggiornata) };
    },
  );

  // -- La coda ---------------------------------------------------------------

  app.post(
    '/api/media/:sessione/coda',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });

      // Accodare lo puo' fare chiunque sia dentro, non solo chi comanda: e' il
      // punto di una coda condivisa. Chi ha il permesso decide cosa parte
      // adesso; chi non ce l'ha mette in fila e aspetta il suo turno.
      const scelto = riferimentoValido(trovata.sessione.tipo, richiesta.body?.riferimento);
      if (!scelto) return risposta.code(400).send({ errore: 'riferimento non valido' });

      if (db.media.coda(trovata.sessione.id).length >= 200) {
        return risposta.code(400).send({ errore: 'la coda e\' piena' });
      }

      const voce = db.media.accoda(trovata.sessione.id, {
        riferimento: scelto,
        titolo: richiesta.body?.titolo ?? '',
        durata: richiesta.body?.durata ?? null,
        meta: richiesta.body?.meta ?? null,
        aggiuntoDa: richiesta.utente.id,
      });

      avvisa(trovata.ctx, db.media.perId(trovata.sessione.id), { evento: 'coda' });
      return risposta.code(201).send({ voce });
    },
  );

  app.delete(
    '/api/media/:sessione/coda/:voce',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });

      const voce = db.media.voce(Number(richiesta.params.voce));
      if (!voce || voce.sessione !== trovata.sessione.id) {
        return risposta.code(404).send({ errore: 'questa voce non c\'e\'' });
      }
      // Il proprio brano sempre, quello degli altri solo comandando.
      if (voce.aggiuntoDa !== richiesta.utente.id && !trovata.ctx.puoComandare) {
        return risposta.code(403).send({ errore: 'non puoi togliere cio\' che ha messo un altro' });
      }

      db.media.togli(voce.id);
      avvisa(trovata.ctx, db.media.perId(trovata.sessione.id), { evento: 'coda' });
      return { tolta: voce.id };
    },
  );

  app.post(
    '/api/media/:sessione/coda/ordine',
    { onRequest: richiedeRuolo('membro') },
    async (richiesta, risposta) => {
      const trovata = suaSessione(richiesta);
      if (trovata.errore) return risposta.code(trovata.stato).send({ errore: trovata.errore });
      if (!trovata.ctx.puoComandare) {
        return risposta.code(403).send({ errore: 'non puoi riordinare la coda' });
      }

      const ordine = Array.isArray(richiesta.body?.ordine) ? richiesta.body.ordine : [];
      db.media.riordina(trovata.sessione.id, ordine);
      avvisa(trovata.ctx, db.media.perId(trovata.sessione.id), { evento: 'coda' });
      return { ok: true };
    },
  );
}

/** La posizione chiesta, oppure quella che sarebbe adesso se non se ne chiede una. */
function posizioneOppure(richiesta, sessione) {
  const chiesta = Number(richiesta.body?.posizioneMs);
  if (Number.isFinite(chiesta) && chiesta >= 0) return Math.floor(chiesta);
  return Math.floor(posizioneAttesa(sessione.stato));
}

/**
 * Cosa accettiamo come "questa cosa da suonare".
 *
 * Per YouTube l'id e' undici caratteri di un alfabeto preciso: validarlo qui
 * significa che nessuno puo' far caricare al player di tutti un URL scelto da
 * lui. Per la musica e' un URI di Spotify, con lo stesso ragionamento.
 */
function riferimentoValido(tipo, grezzo) {
  const valore = String(grezzo ?? '').trim();
  if (!valore) return null;

  if (tipo === 'youtube') {
    return VIDEO_YOUTUBE.test(valore) ? valore : null;
  }
  return /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(valore) ? valore : null;
}
