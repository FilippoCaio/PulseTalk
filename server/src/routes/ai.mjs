// AI Chat e AI Image: autorizzazione del canale, provider e persistenza in un solo percorso.

import { richiedeRuolo } from '../auth.mjs';
import { accessoAlCanale } from '../permessi.mjs';
import { salvaAllegatoInterno } from './allegati.mjs';

const PROMPT_MAX = 4000;

export function rotteAi(app, { db, eventi, provider, generatoreImmagini, config }) {
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
    const acceso = capacita === 'immagini' ? generatoreImmagini.disponibile : provider.capabilities[capacita];
    if (!acceso) {
      risposta.code(501).send({
        errore:
          capacita === 'chat'
            ? 'AI Chat non configurata'
            : `generazione immagini non configurata${generatoreImmagini.motivo ? `: ${generatoreImmagini.motivo}` : ''}`,
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
    const contesto = db.messaggi(pronto.esito.canale.id, { quanti: config.ai.contestoMessaggi })
      .filter((m) => !m.eliminato && m.testo).slice(-config.ai.contestoMessaggi);
    const testo = await provider.chat({ prompt: pronto.prompt, contesto, signal: controllo.signal });
    const id = db.scriviMessaggio({
      canale: pronto.esito.canale.id, autore: bot.id, testo,
      origine: 'ai', provider: provider.id, modello: provider.modelloChat,
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
    const generata = await generatoreImmagini.genera({ prompt: pronto.prompt, signal: controllo.signal });
    const allegato = await salvaAllegatoInterno({ db, config, utente: bot.id, ...generata });
    const id = db.scriviMessaggio({
      canale: pronto.esito.canale.id, autore: bot.id, testo: 'Immagine generata dall\'AI',
      origine: 'ai-immagine', provider: generatoreImmagini.id, modello: provider.modelloImmagini,
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
