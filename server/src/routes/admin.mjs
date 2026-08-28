// routes/admin.mjs - collegare i servizi esterni senza aprire una sessione SSH.
//
// Fino a ieri accendere la trascrizione voleva dire: entrare sul NAS,
// modificare l'ambiente del container, ricrearlo. Tre passi che sa fare una
// persona sola, e che quella persona deve rifare ogni volta che cambia una
// chiave o si prova un altro servizio. Qui sono un modulo e un pulsante.
//
// Due cose che questo file non fa, e sono scelte:
//
// NON scrive l'infrastruttura. Le chiavi della SFU, il segreto dei gettoni, le
// cartelle, i domini: quelle restano nell'ambiente. Un valore sbagliato li'
// chiude fuori tutti — chi lo ha scritto per primo — e il rimedio sarebbe
// proprio la sessione SSH che questo pannello esiste per evitare. Cio' che si
// puo' cambiare da qui, se sbagliato, spegne una funzione facoltativa e basta.
//
// NON rimanda mai indietro una chiave. Si scrive e non si rilegge, come i
// codici d'invito: al posto del valore tornano le ultime quattro cifre, che
// bastano a riconoscere quale chiave c'e' senza consegnarla a chiunque passi
// dietro allo schermo.

import { richiedeRuolo } from '../auth.mjs';
import { leggiConfig } from '../config.mjs';
import {
  CAMPI_ISTANZA,
  CATEGORIE_ISTANZA,
  GRUPPI_ISTANZA,
  ambienteEffettivo,
  campoIstanza,
  coda,
} from '../impostazioni-istanza.mjs';

export function rotteAdmin(app, { db, servizi, ambiente = process.env }) {
  /**
   * Il valore che vale adesso, e da dove viene.
   *
   * "Da dove" non e' un dettaglio: un campo pieno che non si puo' spiegare e'
   * la cosa che fa perdere il pomeriggio. `pannello` vuol dire che lo ha
   * scritto qualcuno da qui e vince su tutto; `container` che arriva
   * dall'ambiente e sparira' se qualcuno scrive in questo campo.
   */
  const stato = () => {
    const salvate = db.impostazioniIstanza();
    const provenienza = new Map(db.provenienzaImpostazioni().map((r) => [r.chiave, r]));

    const campi = CAMPI_ISTANZA.map((campo) => {
      const daPannello = Object.hasOwn(salvate, campo.chiave);
      const valore = daPannello ? salvate[campo.chiave] : (ambiente[campo.chiave] ?? '');
      const riga = provenienza.get(campo.chiave) ?? null;

      return {
        chiave: campo.chiave,
        gruppo: campo.gruppo,
        etichetta: campo.etichetta,
        aiuto: campo.aiuto,
        tipo: campo.tipo,
        valori: campo.valori ?? null,
        esempio: campo.esempio ?? null,
        segreta: campo.segreta === true,
        impostata: Boolean(valore),
        origine: daPannello ? 'pannello' : valore ? 'container' : 'niente',
        // Le segrete non escono mai di qui. Le altre si', perche' un indirizzo
        // o il nome di un modello non sono un segreto — e un campo che non si
        // rilegge costringerebbe a riscriverlo per cambiare quello accanto.
        valore: campo.segreta ? '' : valore,
        coda: campo.segreta ? coda(valore) : null,
        aggiornato: riga?.aggiornato ?? null,
        da: riga?.da ?? null,
      };
    });

    return {
      categorie: CATEGORIE_ISTANZA,
      gruppi: GRUPPI_ISTANZA,
      campi,
      capacita: capacita(),
    };
  };

  /** Cosa e' acceso davvero, adesso. E' la verifica che il salvataggio ha fatto effetto. */
  const capacita = () => ({
    provider: servizi.ai.id,
    formato: servizi.ai.formato,
    ...servizi.ai.capabilities,
    immagini: servizi.generatoreImmagini.disponibile,
    gif: servizi.gif.disponibile,
    ricercaImmagini: servizi.immagini.disponibile,
  });

  app.get('/api/admin/impostazioni', { onRequest: richiedeRuolo('admin') }, async () => stato());

  app.put('/api/admin/impostazioni', { onRequest: richiedeRuolo('admin') }, async (richiesta, risposta) => {
    const modifiche = richiesta.body?.impostazioni;
    if (!modifiche || typeof modifiche !== 'object' || Array.isArray(modifiche)) {
      return risposta.code(400).send({ errore: 'mi aspettavo un oggetto «impostazioni»' });
    }

    // Una chiave fuori catalogo non si ignora in silenzio: chi la manda crede
    // di aver configurato qualcosa, e scoprire fra un mese che non era cosi'
    // e' peggio di un errore adesso.
    const pulite = {};
    for (const [chiave, grezzo] of Object.entries(modifiche)) {
      if (!campoIstanza(chiave)) {
        return risposta.code(400).send({ errore: `«${chiave}» non e' una impostazione modificabile da qui` });
      }
      if (grezzo !== null && typeof grezzo !== 'string' && typeof grezzo !== 'boolean') {
        return risposta.code(400).send({ errore: `«${chiave}» deve essere un testo` });
      }
      pulite[chiave] = grezzo === null ? '' : typeof grezzo === 'boolean' ? (grezzo ? '1' : '') : grezzo.trim();
    }

    // Si prova PRIMA di scrivere.
    //
    // `leggiConfig` valida rifiutando, e quello che rifiuta all'avvio impedisce
    // l'avvio. Costruire qui la configurazione che nascerebbe, e salvarla solo
    // se nasce, e' cio' che tiene questo modulo lontano dal poter rendere il
    // server non avviabile: l'errore arriva addosso a chi sta premendo Salva,
    // che e' l'unico momento in cui e' utile leggerlo.
    const salvate = { ...db.impostazioniIstanza() };
    for (const [chiave, valore] of Object.entries(pulite)) {
      if (valore) salvate[chiave] = valore;
      else delete salvate[chiave];
    }

    let nuova;
    try {
      nuova = leggiConfig(ambienteEffettivo(ambiente, salvate));
    } catch (errore) {
      return risposta.code(400).send({ errore: errore.message });
    }

    const scritte = [];
    for (const [chiave, valore] of Object.entries(pulite)) {
      db.scriviImpostazione(chiave, valore, richiesta.utente.id || null);
      scritte.push(chiave);
    }

    servizi.ricarica(nuova);

    // Nel log finiscono i nomi, mai i valori: un log e' un file che si manda a
    // qualcuno per farsi aiutare.
    richiesta.log.info({ da: richiesta.utente.id, chiavi: scritte }, 'impostazioni istanza aggiornate');

    return stato();
  });

  /**
   * Prova davvero il servizio, invece di dire che la chiave "sembra a posto".
   *
   * Una chiave si scrive giusta e non funziona lo stesso: credito finito,
   * modello che non esiste, indirizzo che risponde ma parla un altro dialetto.
   * Sono tutti casi che si scoprono solo chiedendo qualcosa al servizio, e
   * scoprirli qui — con il pannello ancora aperto — invece che in mezzo a una
   * chiamata e' tutta la differenza.
   */
  app.post('/api/admin/impostazioni/prova', { onRequest: richiedeRuolo('admin') }, async (richiesta, risposta) => {
    const quale = String(richiesta.body?.cosa ?? 'chat');
    const ai = servizi.ai;

    try {
      if (quale === 'chat') {
        if (!ai.capabilities.chat) return risposta.code(501).send({ errore: 'nessun modello di chat configurato' });
        const esito = await ai.chat({ prompt: 'Rispondi con una parola sola: funziona.', contesto: [] });
        return { ok: true, cosa: 'chat', risposta: String(esito).slice(0, 200) };
      }

      if (quale === 'trascrizione') {
        if (!ai.capabilities.stt) {
          return risposta.code(501).send({ errore: 'nessun modello di trascrizione configurato' });
        }
        // Mezzo secondo di silenzio in WAV, costruito qui: mandare un file
        // vero vorrebbe dire tenerne uno nel repository, e la prova serve a
        // sapere se il servizio risponde — non a leggere cosa c'e' scritto.
        const esito = await ai.trascrivi({ corpo: silenzioWav(), tipo: 'audio/wav' });
        return { ok: true, cosa: 'trascrizione', risposta: String(esito ?? '').slice(0, 200) };
      }

      return risposta.code(400).send({ errore: 'si puo\' provare «chat» o «trascrizione»' });
    } catch (errore) {
      // Non e' un guasto del server: e' la risposta alla domanda che e' stata
      // fatta. Duecento, con dentro cosa non ha funzionato.
      return { ok: false, cosa: quale, errore: errore.message };
    }
  });
}

/**
 * La chiave AI di una persona sola.
 *
 * Non e' amministrazione: e' il contrario. Vive qui perche' e' la stessa
 * materia — quale servizio, quale chiave, quali modelli — ma la scrive
 * chiunque, per se', e non tocca nessun altro. La modalita' decide se serva
 * davvero: con `istanza` questi campi non cambiano niente, e il pannello lo
 * dice invece di lasciar scrivere una chiave che non verra' mai usata.
 */
export function rotteChiaveAi(app, { db, servizi }) {
  const mia = (utente) => {
    const riga = db.chiaveAi(utente.id);
    const modo = servizi.config.ai.chiavi;
    return {
      modo,
      // Con `istanza` non c'e' niente da fare qui, e dirlo evita la domanda
      // "l'ho messa e non funziona".
      serve: modo !== 'istanza',
      collegata: Boolean(riga?.apiKey),
      coda: coda(riga?.apiKey),
      baseUrl: riga?.baseUrl ?? '',
      chatModel: riga?.chatModel ?? '',
      sttModel: riga?.sttModel ?? '',
      imageModel: riga?.imageModel ?? '',
      aggiornato: riga?.aggiornato ?? null,
      // Cosa si accende davvero con quello che c'e' adesso, propria chiave
      // compresa. E' la riga che risponde a "ho finito?".
      capacita: servizi.aiPer(utente).capabilities,
      /** I valori di casa, per far vedere cosa si eredita lasciando vuoto. */
      predefiniti: {
        baseUrl: servizi.config.ai.baseUrl,
        chatModel: servizi.config.ai.chatModel,
        sttModel: servizi.config.ai.sttModel,
        imageModel: servizi.config.ai.imageModel,
      },
    };
  };

  app.get('/api/io/ai', { onRequest: richiedeRuolo('membro') }, async (richiesta) => mia(richiesta.utente));

  app.put('/api/io/ai', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const corpo = richiesta.body ?? {};
    const apiKey = String(corpo.apiKey ?? '').trim();
    if (!apiKey) return risposta.code(400).send({ errore: 'serve la chiave' });
    if (apiKey.length > 400) return risposta.code(400).send({ errore: "questa chiave e' troppo lunga per essere una chiave" });

    const baseUrl = String(corpo.baseUrl ?? '').trim();
    if (baseUrl) {
      let url;
      try { url = new URL(baseUrl); } catch { url = null; }
      if (!url || !['http:', 'https:'].includes(url.protocol)) {
        return risposta.code(400).send({ errore: "l'indirizzo deve essere http o https" });
      }
    }

    db.scriviChiaveAi(richiesta.utente.id, {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey,
      chatModel: corpo.chatModel,
      sttModel: corpo.sttModel,
      imageModel: corpo.imageModel,
    });
    // Nel log il nome, mai il valore.
    richiesta.log.info({ utente: richiesta.utente.id }, 'chiave AI personale aggiornata');
    return mia(richiesta.utente);
  });

  app.delete('/api/io/ai', { onRequest: richiedeRuolo('membro') }, async (richiesta) => {
    db.cancellaChiaveAi(richiesta.utente.id);
    return mia(richiesta.utente);
  });

  /** La stessa prova del pannello di amministrazione, ma sulla propria chiave. */
  app.post('/api/io/ai/prova', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const quale = String(richiesta.body?.cosa ?? 'chat');
    const ai = servizi.aiPer(richiesta.utente);
    try {
      if (quale === 'chat') {
        if (!ai.capabilities.chat) return risposta.code(501).send({ errore: 'nessun modello di chat configurato' });
        const esito = await ai.chat({ prompt: 'Rispondi con una parola sola: funziona.', contesto: [] });
        return { ok: true, cosa: 'chat', risposta: String(esito).slice(0, 200) };
      }
      if (quale === 'trascrizione') {
        if (!ai.capabilities.stt) return risposta.code(501).send({ errore: 'nessun modello di trascrizione configurato' });
        const esito = await ai.trascrivi({ corpo: silenzioWav(), tipo: 'audio/wav' });
        return { ok: true, cosa: 'trascrizione', risposta: String(esito ?? '').slice(0, 200) };
      }
      return risposta.code(400).send({ errore: "si puo' provare «chat» o «trascrizione»" });
    } catch (errore) {
      return { ok: false, cosa: quale, errore: errore.message };
    }
  });
}

/** Mezzo secondo di silenzio, 8 kHz mono: l'audio piu' piccolo che sia un file vero. */
function silenzioWav() {
  const campioni = 4000;
  const dati = Buffer.alloc(campioni * 2);
  const testa = Buffer.alloc(44);
  testa.write('RIFF', 0);
  testa.writeUInt32LE(36 + dati.length, 4);
  testa.write('WAVE', 8);
  testa.write('fmt ', 12);
  testa.writeUInt32LE(16, 16);
  testa.writeUInt16LE(1, 20);
  testa.writeUInt16LE(1, 22);
  testa.writeUInt32LE(8000, 24);
  testa.writeUInt32LE(16000, 28);
  testa.writeUInt16LE(2, 32);
  testa.writeUInt16LE(16, 34);
  testa.write('data', 36);
  testa.writeUInt32LE(dati.length, 40);
  return Buffer.concat([testa, dati]);
}
