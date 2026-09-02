import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// ore-lavoro.mjs - quanto tempo si e' passato nei canali vocali, giorno per giorno.
//
// Serve a una cosa sola, e vale la pena dirla in chiaro: **contare le ore di
// lavoro di chi usa PulseTalk per lavorare**. Non e' una statistica per curiosi
// ne' un grafico da pannello. Chi accende questa funzione lo fa perche' deve
// dire a fine mese quante ore ha fatto una persona, e chi la subisce ha il
// diritto di vedere gli stessi numeri, con la stessa precisione, dal proprio
// account. Per questo `/api/ore/mie` esiste dal primo giorno e non e' un'idea
// per dopo: un registro che l'interessato non puo' leggere e' un registro di
// cui non ci si puo' fidare.
//
// ## Si conta a battiti, non a ingressi e uscite
//
// La strada ovvia sarebbe: al `participant_joined` segno l'ora, al
// `participant_left` faccio la differenza. E' la strada che si rompe da sola.
// Un webhook che si perde, un server che si riavvia con dentro qualcuno in
// chiamata, una rete che cade: in tutti quei casi resta un ingresso senza
// uscita, cioe' una sessione aperta all'infinito o un pomeriggio perso.
//
// Qui invece, ogni minuto, si guarda chi c'e' e si aggiunge un minuto a
// ciascuno. Un tick perso vale un minuto perso; un riavvio del server vale un
// minuto perso; niente altro si sfascia, e non c'e' nessuno stato da
// riconciliare all'avvio perche' non c'e' nessuno stato. La precisione e' il
// minuto, ed e' la precisione giusta: nessuno contesta un cartellino per
// quaranta secondi.
//
// ## Il giorno e la settimana sono quelli del server
//
// `YYYY-MM-DD` calcolato sull'ora locale del container. Non e' un dettaglio da
// niente: un'azienda con qualcuno in un altro fuso vedrebbe le sue ore cadere
// nel giorno sbagliato. La scelta e' voluta - il registro e' uno solo, e deve
// essere leggibile da chi paga - ma va saputa, e sta scritta anche nel
// pannello.
//
// La settimana va da **lunedi' a sabato**, e la domenica non si conta: e' la
// settimana lavorativa, non quella del calendario ISO. Quando ne comincia una
// nuova, quella appena finita viene scritta in un file dentro a `ore/` e resta
// li' anche se qualcuno un domani cancellasse le righe dal database.

/** Ogni quanto si guarda chi c'e'. Un minuto: e' la precisione del cartellino. */
const PASSO_MS = 60_000;

/** Il giorno locale in forma `YYYY-MM-DD`. */
export function giornoDi(quando = new Date()) {
  const due = (n) => String(n).padStart(2, '0');
  return `${quando.getFullYear()}-${due(quando.getMonth() + 1)}-${due(quando.getDate())}`;
}

/**
 * Il lunedi' della settimana in cui cade questa data.
 *
 * La domenica appartiene alla settimana che si e' appena chiusa, non a quella
 * che comincia il giorno dopo: chi entra in chiamata di domenica sera sta
 * finendo qualcosa, non cominciando la settimana nuova. Quelle ore finiscono
 * comunque nel registro del giorno - non si buttano via - ma nel totale della
 * settimana di prima.
 */
export function lunediDi(quando = new Date()) {
  const data = new Date(quando.getFullYear(), quando.getMonth(), quando.getDate());
  const giorno = data.getDay(); // 0 = domenica
  const indietro = giorno === 0 ? 6 : giorno - 1;
  data.setDate(data.getDate() - indietro);
  return giornoDi(data);
}

/** I sei giorni della settimana lavorativa che comincia con quel lunedi'. */
export function giorniDellaSettimana(lunedi) {
  const [a, m, g] = lunedi.split('-').map(Number);
  // `new Date(2026, 0, 33)` e' il 2 febbraio: il traboccamento lo fa gia' il
  // costruttore, e non c'e' niente da calcolare sui mesi corti.
  const fuori = [];
  for (let i = 0; i < 6; i += 1) fuori.push(giornoDi(new Date(a, m - 1, g + i)));
  return fuori;
}

/** Da `u12` a 12. Qualunque altra cosa non e' una persona di questo server. */
function idDaIdentita(identita) {
  const n = Number(String(identita ?? '').replace(/^u/, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Accende il contatore, se le impostazioni dicono di si'.
 *
 * Il modulo gira comunque: e' il singolo battito a guardare l'interruttore, e
 * non l'avvio. Cosi' accendere la funzione dal pannello la accende davvero,
 * senza riavviare il container - che e' esattamente cio' che quel pannello
 * esiste per evitare.
 */
export function avviaOreLavoro({ db, presenze, servizi, config, log = null }) {
  const cartella = join(config.root, 'ore');

  /** L'ultima settimana che si e' vista passare: serve a chiudere la precedente. */
  let settimanaVista = lunediDi();

  const attivo = () => servizi?.config?.lavoro?.attivo ?? config.lavoro?.attivo ?? false;

  async function battito() {
    if (!attivo()) return;

    let dentro;
    try {
      dentro = await presenze.leggi();
    } catch (errore) {
      log?.warn({ err: errore }, 'ore: la SFU non risponde, questo minuto non si conta');
      return;
    }

    // Un insieme e non una somma per stanza: chi e' in due stanze insieme non
    // esiste - la SFU non lo permette - ma se un giorno esistesse, un minuto
    // di orologio resterebbe un minuto di lavoro.
    const presenti = new Set();
    for (const partecipanti of dentro.values()) {
      for (const p of partecipanti) {
        const id = idDaIdentita(p.identita);
        if (id) presenti.add(id);
      }
    }

    if (presenti.size > 0) {
      const giorno = giornoDi();
      const secondi = Math.round(PASSO_MS / 1000);
      for (const utente of presenti) db.aggiungiSecondiVocale(utente, giorno, secondi);
    }

    // Settimana nuova: quella di prima si chiude e si scrive su file.
    const adesso = lunediDi();
    if (adesso !== settimanaVista) {
      const chiusa = settimanaVista;
      settimanaVista = adesso;
      await scriviSettimana(chiusa).catch((errore) => {
        log?.error({ err: errore, settimana: chiusa }, 'ore: non ho potuto scrivere la settimana');
      });
    }
  }

  /**
   * La settimana su file, accanto al database.
   *
   * Il database ce l'ha gia' tutto, e questo file e' comunque il punto: e' cio'
   * che si apre senza PulseTalk, si allega a una mail, si tiene in una cartella
   * di contabilita' e resta leggibile fra dieci anni quando il server non
   * esistera' piu'. Un JSON e non un CSV perche' dentro ci sono i giorni, il
   * totale e i nomi, e un CSV di sei colonne obbliga a decidere subito quale
   * forma avra' per sempre.
   */
  async function scriviSettimana(lunedi) {
    const righe = riepilogo(lunedi);
    if (righe.persone.length === 0) return null;
    await mkdir(cartella, { recursive: true });
    const percorso = join(cartella, `settimana-${lunedi}.json`);
    await writeFile(percorso, `${JSON.stringify(righe, null, 2)}\n`, 'utf8');
    log?.info({ settimana: lunedi, persone: righe.persone.length }, 'ore: settimana scritta');
    return percorso;
  }

  /** Cosa c'e' nel registro per quella settimana, gia' pronto da leggere. */
  function riepilogo(lunedi) {
    const giorni = giorniDellaSettimana(lunedi);
    const conteggi = db.oreVocaleFra(giorni[0], giorni[giorni.length - 1]);

    const per = new Map();
    for (const riga of conteggi) {
      const chi = per.get(riga.utente) ?? { utente: riga.utente, nome: riga.nome, giorni: {}, secondi: 0 };
      chi.giorni[riga.giorno] = riga.secondi;
      chi.secondi += riga.secondi;
      per.set(riga.utente, chi);
    }

    return {
      settimana: lunedi,
      da: giorni[0],
      a: giorni[giorni.length - 1],
      // L'obiettivo viaggia dentro al file: fra un anno, chi lo apre deve
      // poter dire se quelle ore bastavano senza andare a cercare com'era
      // configurato il server quel mese.
      oreSettimana: servizi?.config?.lavoro?.oreSettimana ?? config.lavoro?.oreSettimana ?? 40,
      persone: [...per.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
    };
  }

  /** Le settimane gia' chiuse su disco, dalla piu' recente. */
  function settimaneSuDisco() {
    try {
      return readdirSync(cartella)
        .filter((n) => /^settimana-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .map((n) => n.slice('settimana-'.length, -'.json'.length))
        .sort()
        .reverse();
    } catch {
      // La cartella nasce alla prima settimana chiusa: prima di allora non
      // esiste, e non e' un errore.
      return [];
    }
  }

  const passo = setInterval(() => {
    void battito();
  }, PASSO_MS);
  passo.unref?.();

  return {
    riepilogo,
    scriviSettimana,
    settimaneSuDisco,
    /** Un battito subito, per i test: non aspetta il minuto. */
    battito,
    ferma() {
      clearInterval(passo);
    },
  };
}
