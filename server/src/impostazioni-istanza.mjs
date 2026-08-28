// impostazioni-istanza.mjs - le chiavi dei servizi esterni, scrivibili da dentro.
//
// Prima l'unico modo di collegare OpenAI, Tenor o Spotify era entrare sul NAS,
// modificare il file d'ambiente del container e ricrearlo. Funziona, ma vuol
// dire che l'unica persona che puo' accendere una funzione e' quella seduta
// davanti a una sessione SSH — e quella persona spesso e' la stessa che si
// trova davanti al pulsante spento nell'applicazione, senza modo di agirci.
//
// Da qui si scrivono nel database e valgono subito. Non tutte, pero': quello
// che si puo' cambiare da un modulo web e' *soltanto* cio' che, sbagliato,
// spegne una funzione facoltativa. Le chiavi della SFU, il segreto dei gettoni,
// le cartelle e i domini restano fuori — un campo sbagliato li' chiude fuori
// tutti, chi lo ha scritto compreso, e l'unico rimedio sarebbe proprio la
// sessione SSH che questo pannello esiste per evitare.
//
// Il catalogo ha due livelli, e non e' decorazione. La **categoria** e' una
// funzione intera — l'AI, le GIF, la musica — ed e' l'unita' che si accende o
// si spegne; il **gruppo** e' la manciata di campi che si compilano insieme.
// Un elenco piatto di sedici campi si legge una volta e poi si scorre a caso:
// "indirizzo del servizio" e "modello di chat" sono due domande diverse, e
// messe una sotto l'altra sembrano la stessa cosa scritta in due righe.

/**
 * Le chiavi si chiamano come le variabili d'ambiente.
 *
 * Volutamente: chi guarda il pannello e chi guarda il docker-compose devono
 * leggere lo stesso nome. Un vocabolario parallelo — `aiApiKey` di qua,
 * `TALK_AI_API_KEY` di la' — costringe a tenere in testa una tabella di
 * traduzione ogni volta che qualcosa non va.
 *
 * `segreta` non cambia come si scrive il valore: cambia se torna indietro.
 * Una chiave scritta qui non si rilegge mai piu' in chiaro, come i codici
 * d'invito — al suo posto il pannello riceve le ultime quattro cifre, che
 * bastano a riconoscere *quale* chiave c'e' senza consegnarla a chi guarda lo
 * schermo alle spalle.
 *
 * `gruppo: null` vuol dire che il campo esiste, si scrive e si valida come
 * tutti gli altri, ma non compare in mezzo a loro: e' l'interruttore in testa
 * a una categoria, e il pannello lo pesca per nome.
 */
export const CAMPI_ISTANZA = [
  // -- L'AI: chi porta la chiave --------------------------------------------
  {
    chiave: 'TALK_AI_CHIAVI',
    gruppo: null,
    etichetta: 'Chi porta la chiave',
    aiuto:
      "«istanza»: la chiave del server vale per tutti, e paghi tu. «utente»: ognuno collega la propria e consuma il proprio credito. «mista»: chi ce l'ha usa la sua, gli altri ricadono sulla tua.",
    tipo: 'scelta',
    valori: ['istanza', 'utente', 'mista'],
  },

  // -- L'AI: il collegamento ------------------------------------------------
  {
    chiave: 'TALK_AI_BASE_URL',
    gruppo: 'ai-collegamento',
    etichetta: 'Indirizzo del servizio',
    aiuto:
      "Lascialo vuoto per OpenAI. Puntalo altrove per un servizio compatibile, in casa o no: e' lo stesso indirizzo per chat, trascrizione e immagini.",
    tipo: 'url',
    esempio: 'https://api.openai.com/v1',
  },
  {
    chiave: 'TALK_AI_API_KEY',
    gruppo: 'ai-collegamento',
    etichetta: 'Chiave API',
    aiuto:
      "Senza questa e' spento tutto l'AI, trascrizione compresa: e' la prima cosa che il server guarda. Con un servizio in casa che non chiede autenticazione scrivi comunque qualcosa, per esempio «locale».",
    tipo: 'testo',
    segreta: true,
  },
  {
    chiave: 'TALK_AI_FORMATO',
    gruppo: 'ai-collegamento',
    etichetta: 'Dialetto',
    aiuto:
      "«auto» indovina dall'indirizzo: Responses sul dominio di OpenAI, /chat/completions ovunque altro. Si forza a mano solo nei casi in mezzo, come un proxy verso OpenAI su un dominio proprio.",
    tipo: 'scelta',
    valori: ['auto', 'responses', 'chat'],
  },

  // -- L'AI: i modelli ------------------------------------------------------
  {
    chiave: 'TALK_AI_STT_MODEL',
    gruppo: 'ai-modelli',
    etichetta: 'Modello di trascrizione',
    aiuto: 'Accende Auto Writer. Su OpenAI oggi e\' «gpt-transcribe»; «whisper-1» resta valido.',
    tipo: 'testo',
    esempio: 'gpt-transcribe',
  },
  {
    chiave: 'TALK_AI_CHAT_MODEL',
    gruppo: 'ai-modelli',
    etichetta: 'Modello di chat',
    aiuto:
      'Accende l\'AI nelle chat e il pulsante "Riassumi conversazione" di Auto Writer. Sono la stessa capacita\': senza questo, la trascrizione funziona ma il riassunto no.',
    tipo: 'testo',
    esempio: 'gpt-5',
  },
  {
    chiave: 'TALK_AI_IMAGE_MODEL',
    gruppo: 'ai-modelli',
    etichetta: 'Modello per le immagini',
    aiuto: 'Solo se vuoi generare immagini da questo stesso servizio.',
    tipo: 'testo',
    esempio: 'gpt-image-1',
  },

  // -- L'AI: cosa puo' fare in piu' -----------------------------------------
  {
    chiave: 'TALK_AI_WEB_SEARCH',
    gruppo: 'ai-extra',
    etichetta: 'Ricerca web',
    aiuto:
      "Lascia cercare sul web al modello, quando risponde nelle chat. Esiste solo dentro all'API Responses: con /chat/completions non c'e' niente da accendere.",
    tipo: 'interruttore',
  },

  // -- Le GIF ---------------------------------------------------------------
  {
    chiave: 'TALK_TENOR_API_KEY',
    gruppo: 'gif-provider',
    etichetta: 'Chiave Tenor',
    aiuto: 'Il provider GIF preferito. Si prende dalla console di Google Cloud, API "Tenor".',
    tipo: 'testo',
    segreta: true,
  },
  {
    chiave: 'TALK_GIPHY_API_KEY',
    gruppo: 'gif-provider',
    etichetta: 'Chiave Giphy',
    aiuto: "L'alternativa, usata solo se Tenor non c'e'. Le chiavi le da' ancora a chi le chiede.",
    tipo: 'testo',
    segreta: true,
  },

  // -- Le immagini ----------------------------------------------------------
  {
    chiave: 'TALK_UNSPLASH_ACCESS_KEY',
    gruppo: 'immagini-ricerca',
    etichetta: 'Chiave Unsplash',
    aiuto: 'Serve a cercare immagini, non a generarle.',
    tipo: 'testo',
    segreta: true,
  },
  {
    chiave: 'TALK_IMMAGINI_URL',
    gruppo: 'immagini-generazione',
    etichetta: 'Stable Diffusion in casa',
    aiuto:
      "L'indirizzo di una Stable Diffusion WebUI sulla tua rete. Se c'e', genera lei invece di OpenAI: gratis, e i prompt non escono da casa.",
    tipo: 'url',
    esempio: 'http://192.168.1.10:7860',
  },

  // -- La musica ------------------------------------------------------------
  {
    chiave: 'SPOTIFY_CLIENT_ID',
    gruppo: 'musica-app',
    etichetta: 'Client ID Spotify',
    aiuto: "Dal cruscotto per sviluppatori di Spotify. Senza, la coda condivisa resta una lista che non suona.",
    tipo: 'testo',
  },
  {
    chiave: 'SPOTIFY_CLIENT_SECRET',
    gruppo: 'musica-app',
    etichetta: 'Client secret Spotify',
    aiuto: 'Sta qui e non nell\'applicazione: un segreto dentro a un programma installato su venti computer non e\' piu\' un segreto.',
    tipo: 'testo',
    segreta: true,
  },
  {
    chiave: 'SPOTIFY_REDIRECT_URI',
    gruppo: 'musica-app',
    etichetta: 'Indirizzo di ritorno',
    aiuto:
      'Deve combaciare carattere per carattere con quello scritto nel cruscotto di Spotify: e\' loro che lo confrontano.',
    tipo: 'url',
    esempio: 'https://talk.esempio.it/api/musica/spotify/ritorno',
  },
];

/**
 * Le funzioni, una pagina per ciascuna.
 *
 * `personale` c'e' solo dove una chiave di ciascuno vuol dire davvero
 * qualcosa: un servizio che si paga a consumo, dove far portare a ognuno la
 * propria e' l'unico modo perche' il conto non arrivi tutto a chi amministra.
 *
 * Dove non c'e', c'e' `senzaPersonale` con scritto perche'. Non e' zelo: un
 * interruttore assente e basta e' una domanda che torna ogni sei mesi, e la
 * risposta — "le GIF sono gratis, una chiave sola basta per tutti" — e' una
 * riga che vale la pena scrivere una volta invece di rispondere cinque.
 */
export const CATEGORIE_ISTANZA = [
  {
    id: 'ai',
    nome: 'Intelligenza artificiale',
    sotto:
      "Un solo servizio per tre cose: la trascrizione delle chiamate, l'AI nelle chat e le immagini. L'indirizzo e la chiave valgono per tutte e tre; i modelli accendono una funzione ciascuno.",
    personale: {
      /** Il campo che decide, fra quelli scrivibili qui sopra. */
      chiave: 'TALK_AI_CHIAVI',
      titolo: 'Lascia che ognuno porti la propria chiave',
      sotto:
        "L'AI si paga a consumo, ed e' l'unica cosa qui dentro dove chi la usa puo' pagarsela da se'. Chi collega la sua la scrive nelle proprie impostazioni: resta li', e la tua non viene toccata.",
      /** Il valore quando l'interruttore e' spento. */
      spento: 'istanza',
      /** I due modi dell'interruttore acceso, e cosa cambia fra loro. */
      acceso: [
        {
          valore: 'mista',
          nome: "Chi non ce l'ha usa quella del server",
          sotto:
            "Nessuno resta senza AI: la tua chiave fa da rete, e chi collega la propria smette di consumarla.",
        },
        {
          valore: 'utente',
          nome: "Chi non ce l'ha resta senza",
          sotto:
            "La tua chiave non la usa nessun altro. Per chi non ne collega una l'AI e' spenta — e il suo pannello glielo dice, invece di far finta di niente.",
        },
      ],
      /** Dove va, chi vuole collegare la sua. */
      dove: 'La mia AI',
    },
  },
  {
    id: 'gif',
    nome: 'GIF',
    sotto: 'La ricerca delle GIF nel compositore dei messaggi.',
    senzaPersonale:
      "Qui una chiave sola basta per tutti: le ricerche sono gratuite e il limite e' del server, non della persona. Una versione personale sarebbe una domanda in piu' a ogni nuovo iscritto, senza niente in cambio.",
  },
  {
    id: 'immagini',
    nome: 'Immagini',
    sotto: 'Cercarle su Unsplash, o generarle da una Stable Diffusion sulla tua rete.',
    senzaPersonale:
      "Unsplash e' gratuito e vale per tutti. Stable Diffusion la chiama il server, quindi l'indirizzo dev'essere uno che il server vede: una versione personale punterebbe a una macchina irraggiungibile da qui. Le immagini generate dal servizio AI seguono invece l'interruttore di «Intelligenza artificiale».",
  },
  {
    id: 'musica',
    nome: 'Musica',
    sotto: "La sessione di ascolto condiviso via Spotify.",
    senzaPersonale:
      "Client ID e secret sono l'applicazione registrata su Spotify, e ne serve una per server — non una per persona. L'account personale si collega gia' da se': ognuno entra con il proprio quando avvia l'ascolto.",
  },
];

/**
 * I gruppi: quali campi si compilano insieme, dentro a una categoria.
 *
 * L'ordine e' quello in cui si riempiono davvero — prima dove sta il servizio
 * e con che chiave ci si presenta, poi cosa gli si chiede di fare.
 */
export const GRUPPI_ISTANZA = [
  {
    id: 'ai-collegamento',
    categoria: 'ai',
    nome: 'Collegamento',
    sotto: "Dove sta il servizio, e con quale chiave ci si presenta. Senza questi il resto non parte.",
  },
  {
    id: 'ai-modelli',
    categoria: 'ai',
    nome: 'Modelli',
    sotto:
      "Uno per funzione: quello che lasci vuoto e' la funzione che resta spenta, anche con la chiave giusta.",
  },
  {
    id: 'ai-extra',
    categoria: 'ai',
    nome: "Cosa puo' fare in piu'",
    sotto: "Capacita' che il modello usa mentre risponde, oltre a quello che sa gia'.",
  },
  {
    id: 'gif-provider',
    categoria: 'gif',
    nome: 'Provider',
    sotto: "Tenor per primo. Giphy entra in gioco solo se Tenor non c'e'.",
  },
  {
    id: 'immagini-ricerca',
    categoria: 'immagini',
    nome: 'Ricerca',
    sotto: "Immagini che esistono gia', cercate per parola.",
  },
  {
    id: 'immagini-generazione',
    categoria: 'immagini',
    nome: 'Generazione in casa',
    sotto: "Immagini che non esistono ancora, fatte da una macchina della tua rete invece che da OpenAI.",
  },
  {
    id: 'musica-app',
    categoria: 'musica',
    nome: 'Applicazione Spotify',
    sotto:
      "I tre valori del cruscotto per sviluppatori. Vanno insieme: uno solo sbagliato e l'autorizzazione non torna indietro.",
  },
];

const PER_CHIAVE = new Map(CAMPI_ISTANZA.map((c) => [c.chiave, c]));

/** Il campo con questo nome, o null se non e' fra quelli scrivibili. */
export function campoIstanza(chiave) {
  return PER_CHIAVE.get(String(chiave)) ?? null;
}

/**
 * Le ultime quattro cifre, per riconoscere una chiave senza consegnarla.
 *
 * Sotto gli otto caratteri non si mostra niente: su un valore corto quattro
 * cifre sono meta' del segreto, e "riconoscerla" non vale quel prezzo.
 */
export function coda(valore) {
  const testo = String(valore ?? '');
  return testo.length >= 8 ? testo.slice(-4) : null;
}

/**
 * Cosa vale davvero, e da dove viene.
 *
 * Il database vince sull'ambiente, ed e' l'unico ordine che rende utile questo
 * pannello: al contrario, una variabile scritta una volta nel docker-compose
 * bloccherebbe per sempre il campo corrispondente, e il modulo direbbe bugie.
 * Svuotare un campo cancella la riga e fa riemergere il valore del container,
 * che e' il modo di dire "ci ripenso" senza dover ricordare cosa c'era prima.
 */
export function ambienteEffettivo(env, righe) {
  const fuori = { ...env };
  for (const [chiave, valore] of Object.entries(righe)) {
    if (!PER_CHIAVE.has(chiave)) continue;
    fuori[chiave] = valore;
  }
  return fuori;
}
