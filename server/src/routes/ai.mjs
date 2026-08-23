// AI Chat e AI Image: autorizzazione del canale, provider e persistenza in un solo percorso.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale } from '../permessi.mjs';
import { salvaAllegatoInterno } from './allegati.mjs';

const PROMPT_MAX = 4000;

/**
 * `servizi` e non i singoli provider.
 *
 * Le chiavi si cambiano dal pannello di amministrazione mentre il server gira,
 * e quando succede i provider vengono rifatti da capo. Chi se ne fosse preso
 * uno all'avvio continuerebbe a parlare con quello vecchio — cioe' con la
 * chiave che l'admin ha appena tolto — finche' qualcuno non riavvia il
 * container. Guardare dentro alla scatola al momento della chiamata costa una
 * indirezione e toglie di mezzo un'intera categoria di bug che si manifestano
 * solo dopo un cambio di configurazione.
 */
export function rotteAi(app, { db, eventi, servizi }) {
  const rate = creaRateLimit(10, 60_000);

  const prepara = (richiesta, risposta, capacita) => {
    const esito = accessoAlCanale(db, richiesta.utente, richiesta.params.canale);
    if (esito.errore) {
      risposta.code(esito.stato).send({ errore: esito.errore });
      return null;
    }
    if (esito.diretto) {
      risposta.code(422).send({ errore: 'le funzioni AI non si installano nelle conversazioni dirette' });
      return null;
    }
    if (!esito.permessi.has('sendMessages')) {
      risposta.code(403).send({ errore: 'non puoi scrivere in questo canale' });
      return null;
    }
    // La generazione delle immagini ha un provider suo, scelto a parte: puo'
    // essere una Stable Diffusion in casa anche quando la chat parla con
    // OpenAI, o viceversa.
    const acceso =
      capacita === 'immagini'
        ? servizi.generatoreImmagini.disponibile
        : servizi.aiPer(richiesta.utente).capabilities[capacita];
    if (!acceso) {
      risposta.code(501).send({
        errore:
          capacita === 'chat'
            ? messaggioChatSpenta(servizi, richiesta.utente)
            : `generazione immagini non configurata${servizi.generatoreImmagini.motivo ? `: ${servizi.generatoreImmagini.motivo}` : ''}`,
      });
      return null;
    }
    if (!rate(`${richiesta.utente.id}:${esito.spazio.id}:${capacita}`)) {
      risposta.code(429).send({ errore: 'troppe richieste AI, riprova fra un minuto' });
      return null;
    }
    const prompt = String(richiesta.body?.prompt ?? '').trim().slice(0, PROMPT_MAX);
    if (!prompt) {
      risposta.code(400).send({ errore: 'il prompt e\' vuoto' });
      return null;
    }
    return { esito, prompt };
  };

  const pubblica = (esito, messaggio) => eventi.aUtenti(db.destinatariCanale(esito.canale.id), {
    tipo: 'messaggio', spazio: esito.spazio.id, canale: esito.canale.id, messaggio,
  });

  app.post('/api/canali/:canale/ai/chat', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const pronto = prepara(richiesta, risposta, 'chat');
    if (!pronto) return;
    const bot = db.botInterno(pronto.esito.spazio.id, richiesta.utente.id);
    const accessoBot = accessoAlCanale(db, bot, pronto.esito.canale.id);
    if (accessoBot.errore || !accessoBot.permessi.has('sendMessages')) {
      return risposta.code(403).send({ errore: 'il bot assistente non ha accesso e permesso di scrivere in questo canale' });
    }
    const controllo = new AbortController();
    richiesta.raw.once('aborted', () => controllo.abort());
    const contesto = db.messaggi(pronto.esito.canale.id, { quanti: servizi.config.ai.contestoMessaggi })
      .filter((m) => !m.eliminato && m.testo).slice(-servizi.config.ai.contestoMessaggi);
    const mio = servizi.aiPer(richiesta.utente);
    const testo = await mio.chat({ prompt: pronto.prompt, contesto, signal: controllo.signal });
    const id = db.scriviMessaggio({
      canale: pronto.esito.canale.id, autore: bot.id, testo,
      origine: 'ai', provider: mio.id, modello: mio.modelloChat,
      richiestoDa: richiesta.utente.id,
    });
    const messaggio = db.messaggi(pronto.esito.canale.id, { prima: id + 1, quanti: 1 })[0];
    pubblica(pronto.esito, messaggio);
    return risposta.code(201).send({ messaggio, bot: profiloBot(bot) });
  });

  app.post('/api/canali/:canale/ai/immagine', { onRequest: richiedeRuolo('membro') }, async (richiesta, risposta) => {
    const pronto = prepara(richiesta, risposta, 'immagini');
    if (!pronto) return;
    const controllo = new AbortController();
    richiesta.raw.once('aborted', () => controllo.abort());
    const bot = db.botInterno(pronto.esito.spazio.id, richiesta.utente.id);
    const accessoBot = accessoAlCanale(db, bot, pronto.esito.canale.id);
    if (accessoBot.errore || !accessoBot.permessi.has('sendMessages')) {
      return risposta.code(403).send({ errore: 'il bot assistente non ha accesso e permesso di scrivere in questo canale' });
    }
    const generata = await servizi.generatoreImmagini.genera({ prompt: pronto.prompt, signal: controllo.signal });
    const allegato = await salvaAllegatoInterno({ db, config, utente: bot.id, ...generata });
    const id = db.scriviMessaggio({
      canale: pronto.esito.canale.id, autore: bot.id, testo: 'Immagine generata dall\'AI',
      origine: 'ai-immagine', provider: servizi.generatoreImmagini.id, modello: servizi.aiPer(richiesta.utente).modelloImmagini,
      richiestoDa: richiesta.utente.id,
    });
    db.legaAllegati(id, [allegato.id], bot.id);
    const messaggio = db.messaggi(pronto.esito.canale.id, { prima: id + 1, quanti: 1 })[0];
    pubblica(pronto.esito, messaggio);
    return risposta.code(201).send({ messaggio, bot: profiloBot(bot) });
  });
}

const profiloBot = (bot) => ({ id: bot.id, nome: bot.nome, avatar: bot.avatar ?? null, tipo: 'bot' });

function creaRateLimit(massimo, finestraMs) {
  const voci = new Map();
  return (chiave) => {
    const adesso = Date.now();
    const voce = voci.get(chiave);
    if (!voce || voce.fino <= adesso) {
      voci.set(chiave, { quanti: 1, fino: adesso + finestraMs });
      return true;
    }
    if (voce.quanti >= massimo) return false;
    voce.quanti += 1;
    return true;
  };
}

/**
 * Perche' l'AI e' spenta, detto a chi la sta chiedendo.
 *
 * "AI Chat non configurata" e' vero in tutti i casi ed e' utile in uno solo.
 * Se l'amministratore ha scelto che ognuno porti la propria chiave, la frase
 * da leggere e' un'altra — e dice cosa fare, invece di dire cosa manca a
 * qualcun altro.
 */
function messaggioChatSpenta(servizi, utente) {
  const modo = servizi.config.ai.chiavi;
  if (modo === 'istanza') return 'AI Chat non configurata';
  const sua = servizi.aiPer(utente);
  if (sua.capabilities.chat) return 'AI Chat non configurata';
  return modo === 'utente'
    ? "Su questo server l'AI la porta ognuno per se': collega la tua chiave dalle impostazioni, sezione Account."
    : "Nessuna chiave configurata: ne' la tua ne' quella del server.";
}
