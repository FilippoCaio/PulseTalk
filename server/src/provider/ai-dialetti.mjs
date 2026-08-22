// provider/ai-dialetti.mjs - i due modi di chiedere una risposta a un modello.
//
// `TALK_AI_BASE_URL` lasciava credere che bastasse cambiare indirizzo per
// puntare a Ollama o a un servizio piu' economico. Non era vero: il codice
// parlava solo l'API Responses di OpenAI (`POST /responses`), che quasi nessun
// altro implementa. Chi cambiava indirizzo riceveva un 404 e nessuna
// spiegazione utile.
//
// Qui i due dialetti stanno uno accanto all'altro:
//
//   responses   `POST /responses`, di OpenAI. E' l'unico che ha lo strumento
//               di ricerca web, quindi resta il predefinito quando l'indirizzo
//               e' quello ufficiale.
//   chat        `POST /chat/completions`, il formato che parlano Ollama, LM
//               Studio, vLLM, Groq, OpenRouter e in generale tutto cio' che si
//               dichiara "OpenAI compatibile".
//
// Sono funzioni pure: costruiscono un corpo e leggono una risposta, senza
// toccare la rete. Cosi' si provano con dati scritti a mano, che e' l'unico
// modo di accorgersi di un campo sbagliato senza avere una chiave in tasca.

/**
 * I ruoli, tradotti.
 *
 * Le due API chiamano in modo diverso la stessa cosa: l'istruzione di sistema
 * e' `developer` per Responses e `system` per chat/completions. Tenere un nome
 * nostro in mezzo evita che la differenza si sparpagli nel resto del codice.
 */
const RUOLI = {
  responses: { sistema: 'developer', utente: 'user', assistente: 'assistant' },
  chat: { sistema: 'system', utente: 'user', assistente: 'assistant' },
};

export const DIALETTI = {
  responses: {
    nome: 'responses',
    percorso: '/responses',
    /** Solo qui esiste lo strumento di ricerca web. */
    ricercaWeb: true,

    corpo({ modello, messaggi, maxToken, ricercaWeb = false }) {
      return {
        model: modello,
        input: messaggi.map((m) => ({ role: RUOLI.responses[m.ruolo], content: m.testo })),
        max_output_tokens: maxToken,
        ...(ricercaWeb ? { tools: [{ type: 'web_search' }] } : {}),
      };
    },

    testo(dati) {
      return String(
        dati?.output_text ??
          dati?.output?.flatMap((o) => o.content ?? []).find((x) => x.type === 'output_text')?.text ??
          '',
      ).trim();
    },

    /**
     * Le fonti citate, quando la ricerca web e' accesa.
     *
     * Arrivano come annotazioni attaccate al testo, e OpenAI le ha scritte in
     * due forme diverse nel tempo: si guardano entrambe invece di scegliere
     * quella di oggi e ritrovarsi senza fonti dopo un aggiornamento loro.
     */
    fonti(dati) {
      const trovate = [];
      for (const contenuto of dati?.output?.flatMap((o) => o.content ?? []) ?? []) {
        for (const a of contenuto.annotations ?? []) {
          const url = a.url ?? a.url_citation?.url;
          if (!url || trovate.some((f) => f.url === url)) continue;
          trovate.push({ url, titolo: a.title ?? a.url_citation?.title ?? url });
        }
      }
      return trovate;
    },
  },

  chat: {
    nome: 'chat',
    percorso: '/chat/completions',
    ricercaWeb: false,

    corpo({ modello, messaggi, maxToken }) {
      return {
        model: modello,
        messages: messaggi.map((m) => ({ role: RUOLI.chat[m.ruolo], content: m.testo })),
        // `max_tokens` e non `max_completion_tokens`: e' quello che accettano
        // i servizi compatibili, ed e' per loro che questo dialetto esiste.
        max_tokens: maxToken,
        stream: false,
      };
    },

    testo(dati) {
      const messaggio = dati?.choices?.[0]?.message;
      // Alcuni modelli locali mettono il testo in un array di parti invece che
      // in una stringa: leggerlo comunque costa due righe e toglie di mezzo un
      // "il provider non ha restituito testo" che non spiega niente.
      const contenuto = Array.isArray(messaggio?.content)
        ? messaggio.content.map((p) => p?.text ?? '').join('')
        : messaggio?.content;
      return String(contenuto ?? '').trim();
    },

    fonti() {
      return [];
    },
  },
};

/**
 * Quale dialetto usare.
 *
 * In automatico: Responses solo sull'indirizzo ufficiale di OpenAI, perche' e'
 * l'unico posto in cui esiste. Ovunque altro si parla chat/completions, che e'
 * il formato che chiunque dica "compatibile con OpenAI" implementa davvero.
 *
 * `TALK_AI_FORMATO` esiste per i casi in mezzo: un proxy verso OpenAI su un
 * dominio proprio, o un servizio che espone Responses e non e' OpenAI.
 */
export function scegliDialetto({ formato = 'auto', baseUrl = '' } = {}) {
  if (formato === 'responses' || formato === 'chat') return DIALETTI[formato];
  return /^https:\/\/api\.openai\.com(\/|$)/i.test(baseUrl) ? DIALETTI.responses : DIALETTI.chat;
}
