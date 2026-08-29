// db.mjs - talk.db: chi puo' entrare, dove, e cosa si sono detti.
//
// Non passa da qui un solo byte di audio o di video. Quelli vanno dall'app
// alla SFU e ritorno, senza toccare questo processo: e' esattamente cio' che
// permette a un 4K60 di non costare niente al piano di controllo.
//
// Ne' i token ne' i codici di invito vengono salvati in chiaro: di entrambi si
// conserva l'impronta SHA-256. Chi legge una copia di talk.db non ottiene le
// chiavi per entrare, e l'unico momento in cui il valore vero esiste e' quando
// lo si consegna a chi lo usera'.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { RUOLI } from './config.mjs';
import { creaCollegamenti } from './dati/collegamenti.mjs';
import { creaDiretti } from './dati/diretti.mjs';
import { creaEventiSpazio } from './dati/eventi-spazio.mjs';
import { creaRestrizioni } from './dati/restrizioni.mjs';
import { creaInvitiSpazio } from './dati/inviti-spazio.mjs';
import { creaMedia } from './dati/media.mjs';
import { creaRuoli } from './dati/ruoli.mjs';
import { PERMESSI } from './permessi/catalogo.mjs';
import { risolvi } from './permessi/risoluzione.mjs';
import { SCHEMA, SCHEMA_RICERCA } from './schema.mjs';

export const impronta = (valore) => createHash('sha256').update(valore, 'utf8').digest('hex');

// base64url senza padding: entra in una URL e in un campo di testo senza
// sorprese, e 32 byte sono 256 bit di entropia.
const segretoNuovo = (byte = 32) => randomBytes(byte).toString('base64url');

const ora = () => Math.floor(Date.now() / 1000);

/**
 * Quante volte si puo' sbagliare un codice prima che smetta di valere.
 *
 * E' il controllo che rende sicuro un codice corto. Sei caratteri su
 * trentadue sono circa trenta bit: pochi contro un programma che li prova
 * tutti, moltissimi contro cinque tentativi. La lunghezza serve a poterlo
 * digitare, il tetto a renderlo inespugnabile.
 */
const TENTATIVI_MAX = 5;

/**
 * Un codice che una persona deve poter leggere da una mail e ribattere.
 *
 * Niente 0, O, 1, I e L: sono le coppie che si sbagliano leggendo, e uno
 * scambio fra zero e O si presenta come "il codice non funziona" — indistinguibile
 * da un codice davvero scaduto, e quindi impossibile da capire per chi lo sta
 * digitando.
 *
 * `randomInt` e non `Math.random()`: il codice apre un account.
 */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const codiceLeggibile = (quanti = 6) =>
  Array.from({ length: quanti }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

// I segni diacritici, scritti per punto di codice invece che come carattere
// vero: questo file passa da editor, da git e da un disco exFAT, e un accento
// combinante scritto in chiaro non sopravvive sempre al viaggio.
const DIACRITICI = new RegExp('[\\u0300-\\u036f]', 'g');

// La chiave di uno spazio o di un canale finisce dentro un gettone JWT e
// dentro il nome che la SFU usa per la stanza: niente spazi, niente accenti,
// niente maiuscole.
export function chiaveDa(nome) {
  const pulita = nome
    .normalize('NFD')
    .replace(DIACRITICI, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  // Un nome fatto di soli emoji e' legittimo e non lascia niente: in quel caso
  // la chiave se la inventa il server, e resta comunque stabile nel database.
  return pulita || `x-${randomBytes(4).toString('hex')}`;
}

// Il nome utente e' l'identita' con cui si entra: minuscolo, senza spazi, e
// unico. Il `nome` invece e' come ti vedono gli altri, e puo' essere qualunque
// cosa — accenti, spazi, un emoji. Tenerli separati significa che cambiare il
// proprio nome visibile non tocca le credenziali di nessuno.
const NOME_UTENTE = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;

export function normalizzaNomeUtente(grezzo) {
  return String(grezzo ?? '').trim().toLowerCase();
}

export function problemaConIlNomeUtente(grezzo) {
  const nome = normalizzaNomeUtente(grezzo);
  if (nome.length < 3) return 'Il nome utente deve essere lungo almeno 3 caratteri.';
  if (nome.length > 32) return 'Il nome utente non puo\' superare i 32 caratteri.';
  if (!NOME_UTENTE.test(nome)) {
    return 'Il nome utente puo\' contenere lettere, numeri, punto, trattino e trattino basso, e deve cominciare e finire con una lettera o un numero.';
  }
  return null;
}

/**
 * Le colonne aggiunte dopo.
 *
 * SQLite non ha `ADD COLUMN IF NOT EXISTS`, e rieseguire una ADD COLUMN che
 * c'e' gia' e' un errore. Quindi si guarda prima. Sono migrazioni fatte a
 * mano perche' sono poche e perche' un sistema di migrazioni vero, con i suoi
 * numeri di versione, per qualche colonna sarebbe piu' codice della cosa che
 * gestisce.
 */
const COLONNE_AGGIUNTE = [
  ['utenti', 'tipo', "TEXT NOT NULL DEFAULT 'umano'"],
  ['utenti', 'utente', 'TEXT'],
  ['utenti', 'password', 'TEXT'],
  ['utenti', 'avatar', 'TEXT'],
  // L'indirizzo e' facoltativo, e resta tale: questa e' un'istanza fra amici,
  // e c'e' chi non lo dara'. Per loro la strada per rientrare resta quella di
  // prima — un admin che rimette la password — e va bene cosi'.
  //
  // `emailConfermata` non e' un dettaglio contabile: e' cio' che separa un
  // indirizzo scritto da un indirizzo posseduto. Solo il secondo puo' servire
  // a rientrare, altrimenti basterebbe un refuso perche' la strada per il
  // proprio account passi dalla casella di uno sconosciuto.
  ['utenti', 'email', 'TEXT'],
  ['utenti', 'emailConfermata', 'INTEGER NOT NULL DEFAULT 0'],
  // Quali avvisi per posta si vogliono ricevere, in un JSON.
  //
  // In un campo solo e non in una colonna per avviso: sono preferenze, e ogni
  // avviso nuovo vorrebbe una migrazione. Vuoto vuol dire nessuno, che e' il
  // valore giusto di serie — chi ha dato il suo indirizzo per rientrare non lo
  // ha dato per essere avvisato.
  ['utenti', 'avvisiEmail', "TEXT NOT NULL DEFAULT ''"],
  ['token', 'dispositivo', 'TEXT'],
  ['inviti', 'usiMax', 'INTEGER NOT NULL DEFAULT 1'],
  ['inviti', 'usi', 'INTEGER NOT NULL DEFAULT 0'],
  ['inviti', 'creatoDa', 'INTEGER'],
  ['canali', 'privato', 'INTEGER NOT NULL DEFAULT 0'],
  ['canali', 'creatoDa', 'INTEGER'],
  ['canali', 'scade', 'INTEGER'],
  ['messaggi', 'origine', "TEXT NOT NULL DEFAULT 'umano'"],
  ['messaggi', 'provider', 'TEXT'],
  ['messaggi', 'modello', 'TEXT'],
  // Chi ha chiesto il messaggio, quando a scriverlo e' stato un bot.
  //
  // Un messaggio dell'AI ha per autore il bot dello spazio, e un bot non fa
  // login: senza questa colonna nessuno potrebbe piu' toglierlo dal canale,
  // ora che a cancellare e' soltanto l'autore. Chi lo ha chiesto e' la persona
  // piu' vicina ad averlo scritto, ed e' quella che se lo riprende.
  ['messaggi', 'richiestoDa', 'INTEGER'],

  // Fin dove il messaggio e' *arrivato*, che non e' fin dove e' stato letto.
  //
  // Sono due cose diverse e servono a rispondere a due domande diverse: "gli e'
  // arrivato?" e "l'ha letto?". Con il solo `ultimoMessaggio` chi scriveva
  // vedeva un messaggio non letto e non aveva modo di sapere se il problema era
  // il destinatario o la rete.
  ['letture', 'ultimoConsegnato', 'INTEGER NOT NULL DEFAULT 0'],
  // Un'emoji davanti al nome. Solo estetica, ma e' l'unico modo per far
  // riconoscere un canale in una colonna di venti a colpo d'occhio.
  ['canali', 'icona', 'TEXT'],
  // Lo stato scelto a mano: online, inattivo, occupato, invisibile.
  //
  // Sta sull'utente e non sulla sessione perche' deve sopravvivere alla
  // chiusura dell'applicazione: chi si mette "non disturbare" la sera non
  // vuole ritrovarsi online il mattino dopo per aver riavviato il computer.
  ['utenti', 'stato', "TEXT NOT NULL DEFAULT 'online'"],

  // Uno spazio non e' piu' solo un nome e un'icona.
  //
  // `proprietario` e' chi non puo' essere fermato da nessun permesso: serve a
  // garantire che ci sia sempre almeno una persona capace di rientrare dopo
  // essersi tolta un ruolo per sbaglio. `sistema` marca gli spazi che non
  // appartengono a nessuno e non compaiono in nessuna barra — oggi ce n'e' uno
  // solo, quello che contiene i canali dei messaggi diretti.
  ['spazi', 'descrizione', "TEXT NOT NULL DEFAULT ''"],
  ['spazi', 'regole', "TEXT NOT NULL DEFAULT ''"],
  ['spazi', 'proprietario', 'INTEGER'],
  ['spazi', 'sistema', 'INTEGER NOT NULL DEFAULT 0'],
  ['spazi', 'impostazioni', "TEXT NOT NULL DEFAULT '{}'"],
];

/**
 * Le impostazioni di uno spazio, quando la colonna non dice niente.
 *
 * Stanno in un JSON e non in cinque colonne perche' sono preferenze: se ne
 * aggiunge una ogni tanto, e una migrazione per ogni interruttore sarebbe piu'
 * codice della cosa che gestisce. Cio' che decide chi puo' fare cosa non sta
 * qui: quello sono i permessi, che hanno tabelle vere.
 */
export const IMPOSTAZIONI_SPAZIO = {
  /** Se i membri senza permessi amministrativi possono generare inviti. */
  invitiAperti: true,
  /** Quanti giorni vale un invito appena creato. */
  invitiGiorni: 7,
  /** Se gli inviti dei membri normali valgono una volta sola. */
  invitiUsoSingolo: false,
  /** Se chi ha createEvents puo' creare eventi senza passare da un admin. */
  eventiAperti: true,
  /** Cosa notificare di serie a chi entra: 'tutto' | 'menzioni' | 'niente'. */
  notifichePredefinite: 'tutto',
  /**
   * Chi si registra sull'istanza entra qui dentro da solo.
   *
   * Uno spazio nuovo nasce a porte chiuse. Gli spazi creati dalle versioni
   * precedenti conservano esplicitamente il comportamento che avevano grazie
   * a `#migraPrivacySpazi`.
   */
  apertoATutti: false,
};

export class TalkDb {
  constructor(percorso) {
    mkdirSync(dirname(percorso), { recursive: true });
    this.sql = new Database(percorso);
    this.sql.pragma('journal_mode = WAL');
    this.sql.pragma('foreign_keys = ON');
    this.sql.exec(SCHEMA);
    this.#aggiorna();

    // La ricerca e' un di piu': se questa build di SQLite non ha FTS5, tutto
    // il resto deve funzionare lo stesso.
    try {
      this.sql.exec(SCHEMA_RICERCA);
      this.ricercaDisponibile = true;
    } catch {
      this.ricercaDisponibile = false;
    }

    // I moduli dei dati. Composizione e non ereditarieta': ognuno si prova da
    // solo con un database in memoria, e questo file non diventa il posto in
    // cui finisce tutto quello che non si sa dove mettere.
    this.ruoli = creaRuoli(this.sql);
    this.invitiSpazio = creaInvitiSpazio(this.sql);
    this.eventiSpazio = creaEventiSpazio(this.sql);
    // Dopo gli eventi, e non prima: una restrizione legata a un evento deve
    // poterlo interrogare per sapere se e' ancora in corso.
    this.restrizioni = creaRestrizioni(this.sql, this);
    this.media = creaMedia(this.sql);
    this.collegamenti = creaCollegamenti(this.sql);
    this.diretti = creaDiretti(this.sql, this);

    this.#migraStanze();
    this.#migraPrivacySpazi();
    this.#migraRuoli();
  }

  close() {
    this.sql.close();
  }

  #aggiorna() {
    for (const [tabella, colonna, tipo] of COLONNE_AGGIUNTE) {
      const esistenti = this.sql.prepare(`PRAGMA table_info(${tabella})`).all();
      if (esistenti.some((c) => c.name === colonna)) continue;
      this.sql.exec(`ALTER TABLE ${tabella} ADD COLUMN ${colonna} ${tipo}`);
    }
    // Unico, ma solo fra i valori non nulli: gli utenti senza nome utente
    // possono essere piu' d'uno, e in SQLite i NULL non collidono mai fra loro
    // in un indice unico.
    this.sql.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_utenti_utente ON utenti(utente) WHERE utente IS NOT NULL',
    );
    this.sql.exec(
      'CREATE INDEX IF NOT EXISTS idx_canali_scadenza ON canali(scade) WHERE scade IS NOT NULL',
    );

    // Gli inviti gia' riscattati prima che esistesse il contatore: `usato`
    // dice quando, ma `usi` e' rimasto a zero. Senza questo travaso
    // tornerebbero disponibili tutti insieme, che e' il modo piu' rapido di
    // riaprire porte che qualcuno aveva chiuso.
    this.sql.exec('UPDATE inviti SET usi = 1 WHERE usato IS NOT NULL AND usi = 0');
  }

  /**
   * Le stanze della prima versione diventano canali vocali.
   *
   * Gira una volta sola: se esiste gia' uno spazio, non c'e' niente da
   * convertire. Nessuna stanza va persa e nessuna chiave cambia — chi aveva
   * "officina" continua ad averla, dentro uno spazio che prima non c'era.
   *
   * La tabella `stanze` resta sul disco anche dopo. Non serve piu' a niente,
   * e cancellarla vorrebbe dire buttare l'unica copia dei dati di prima nel
   * momento esatto in cui si scopre che la conversione aveva un difetto.
   */
  #migraStanze() {
    const vecchie = this.sql.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='stanze'`).get();
    if (!vecchie) return;
    if (this.sql.prepare('SELECT id FROM spazi LIMIT 1').get()) return;

    const stanze = this.sql.prepare('SELECT * FROM stanze ORDER BY id').all();
    if (stanze.length === 0) return;

    const trasferisci = this.sql.transaction(() => {
      const spazio = this.sql
        .prepare('INSERT INTO spazi (chiave, nome, creato) VALUES (?, ?, ?)')
        .run('casa', 'Casa', ora());
      const spazioId = Number(spazio.lastInsertRowid);

      // Tutti quelli che gia' esistono entrano nello spazio: prima non c'era
      // niente da cui essere esclusi, e ritrovarsi fuori dopo un aggiornamento
      // sarebbe una sorpresa spiacevole.
      const adesso = ora();
      for (const u of this.sql.prepare('SELECT id, ruolo FROM utenti WHERE attivo = 1').all()) {
        this.sql
          .prepare('INSERT OR IGNORE INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
          .run(spazioId, u.id, u.ruolo === 'admin' ? 'admin' : 'membro', adesso);
      }

      for (const [i, stanza] of stanze.entries()) {
        this.sql
          .prepare(
            `INSERT INTO canali (spazio, chiave, nome, tipo, argomento, posizione, soloAscolto, creato)
             VALUES (?, ?, ?, 'voce', ?, ?, ?, ?)`,
          )
          .run(spazioId, stanza.chiave, stanza.nome, stanza.descrizione ?? '', i, stanza.soloAscolto ?? 0, adesso);
      }

      // Un canale di testo per cominciare: uno spazio fatto di soli canali
      // vocali sembra rotto finche' non ci si entra dentro.
      this.sql
        .prepare(
          `INSERT INTO canali (spazio, chiave, nome, tipo, posizione, creato)
           VALUES (?, 'generale', 'generale', 'testo', -1, ?)`,
        )
        .run(spazioId, adesso);
    });

    trasferisci();
  }

  /**
   * Le versioni precedenti consideravano aperto uno spazio senza la chiave
   * `apertoATutti`. Scriverla una volta preserva quel comportamento, mentre il
   * nuovo valore predefinito puo' essere privato senza cambiare gli spazi gia'
   * esistenti. Gli spazi nuovi scrivono sempre la chiave e non vengono toccati.
   */
  #migraPrivacySpazi() {
    const aggiorna = this.sql.prepare('UPDATE spazi SET impostazioni = ? WHERE id = ?');
    const migra = this.sql.transaction(() => {
      for (const spazio of this.sql.prepare('SELECT id, impostazioni FROM spazi WHERE sistema = 0').all()) {
        let impostazioni;
        try {
          impostazioni = JSON.parse(spazio.impostazioni ?? '{}') ?? {};
        } catch {
          impostazioni = {};
        }
        if (Object.hasOwn(impostazioni, 'apertoATutti')) continue;
        aggiorna.run(JSON.stringify({ ...impostazioni, apertoATutti: true }), spazio.id);
      }
    });
    migra();
  }

  /**
   * Gli spazi nati prima dei ruoli se li ritrovano addosso.
   *
   * Gira a ogni apertura ed e' idempotente: crea i tre ruoli predefiniti dove
   * mancano, da' il ruolo Admin a chi risultava admin nella vecchia colonna
   * `membri.ruolo`, e mette un proprietario dove non c'era. Nessuno perde
   * niente — chi amministrava continua ad amministrare, con in piu' la
   * possibilita' di dare via pezzi di quel potere invece che tutto o niente.
   */
  #migraRuoli() {
    const spazi = this.sql.prepare('SELECT id, creatoDa, proprietario, sistema FROM spazi').all();

    const converti = this.sql.transaction(() => {
      for (const spazio of spazi) {
        if (spazio.sistema) continue;
        const admin = this.ruoli.assicuraPredefiniti(spazio.id);
        if (!admin) continue;

        for (const membro of this.sql
          .prepare("SELECT utente FROM membri WHERE spazio = ? AND ruolo = 'admin'")
          .all(spazio.id)) {
          this.ruoli.assegna(admin.id, membro.utente);
        }

        if (!spazio.proprietario) {
          // Chi lo ha creato, e se quella riga non c'e' piu' il primo admin
          // rimasto. Uno spazio senza proprietario e' uno spazio in cui, il
          // giorno in cui l'ultimo admin si toglie un permesso per sbaglio,
          // non entra piu' nessuno a rimetterlo a posto.
          const ripiego = this.sql
            .prepare("SELECT utente FROM membri WHERE spazio = ? AND ruolo = 'admin' ORDER BY entrato LIMIT 1")
            .get(spazio.id);
          const chi = spazio.creatoDa ?? ripiego?.utente ?? null;
          if (chi) {
            this.sql.prepare('UPDATE spazi SET proprietario = ? WHERE id = ?').run(chi, spazio.id);
          }
        }
      }
    });

    converti();
  }

  // -- Inviti ---------------------------------------------------------------

  // `nome` e' solo un suggerimento per il modulo di registrazione — chi
  // riscatta puo' cambiarlo. Da quando esistono gli account non identifica
  // piu' nessuno: quello lo fa il nome utente, che se lo sceglie chi entra.
  creaInvito({ nome = '', ruolo, validoGiorni = 14, usiMax = 1, creatoDa = null }) {
    if (!RUOLI.includes(ruolo)) throw new Error(`ruolo sconosciuto: ${ruolo}`);
    const codice = segretoNuovo(18);
    this.sql
      .prepare(
        `INSERT INTO inviti (impronta, nome, ruolo, creato, scade, usiMax, creatoDa)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(impronta(codice), nome ?? '', ruolo, ora(), ora() + validoGiorni * 86400, Math.max(1, usiMax), creatoDa);
    return codice;
  }

  /**
   * Perche' questo codice non va bene, se non va bene.
   *
   * Un posto solo che decide, invece della stessa catena di if ripetuta fra
   * `guardaInvito` e `riscattaInvito`: quando le condizioni sono due copie,
   * prima o poi divergono, e a divergere e' quella che concede.
   */
  #problemaConInvito(riga) {
    if (!riga) return 'codice non valido';
    if (riga.scade < ora()) return 'codice scaduto';
    if (riga.usi >= riga.usiMax) return 'codice gia\' usato';
    return null;
  }

  invitiAperti() {
    return this.sql
      .prepare(
        `SELECT id, nome, ruolo, creato, scade, usi, usiMax, creatoDa
           FROM inviti WHERE usi < usiMax AND scade > ? ORDER BY creato DESC`,
      )
      .all(ora());
  }

  eliminaInvito(id) {
    return this.sql.prepare('DELETE FROM inviti WHERE id = ?').run(id).changes;
  }

  // -- La chiave AI di una persona ------------------------------------------

  /** La riga di questa persona, o null. Il valore in chiaro: serve a chiamare il modello. */
  chiaveAi(utenteId) {
    return this.sql.prepare('SELECT * FROM chiavi_ai WHERE utente = ?').get(utenteId) ?? null;
  }

  scriviChiaveAi(utenteId, { baseUrl = null, apiKey, chatModel = null, sttModel = null, imageModel = null }) {
    const vuoto = (v) => {
      const t = String(v ?? '').trim();
      return t || null;
    };
    return this.sql
      .prepare(
        `INSERT INTO chiavi_ai (utente, baseUrl, apiKey, chatModel, sttModel, imageModel, aggiornato)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(utente) DO UPDATE SET baseUrl = excluded.baseUrl,
                                           apiKey = excluded.apiKey,
                                           chatModel = excluded.chatModel,
                                           sttModel = excluded.sttModel,
                                           imageModel = excluded.imageModel,
                                           aggiornato = excluded.aggiornato`,
      )
      .run(utenteId, vuoto(baseUrl), String(apiKey).trim(), vuoto(chatModel), vuoto(sttModel), vuoto(imageModel), ora())
      .changes;
  }

  cancellaChiaveAi(utenteId) {
    return this.sql.prepare('DELETE FROM chiavi_ai WHERE utente = ?').run(utenteId).changes;
  }

  // -- Le impostazioni dell'istanza -----------------------------------------

  /** Tutte, come un oggetto ambiente: chiave -> valore. */
  impostazioniIstanza() {
    const fuori = {};
    for (const riga of this.sql.prepare('SELECT chiave, valore FROM impostazioni_istanza').all()) {
      fuori[riga.chiave] = riga.valore;
    }
    return fuori;
  }

  /** Chi ha scritto cosa e quando, per il pannello. Senza i valori. */
  provenienzaImpostazioni() {
    return this.sql
      .prepare('SELECT chiave, aggiornato, da FROM impostazioni_istanza')
      .all();
  }

  /**
   * Scrive o cancella una impostazione.
   *
   * Il vuoto cancella invece di salvare una stringa vuota, e non e' la stessa
   * cosa: una riga vuota vincerebbe sull'ambiente e spegnerebbe una funzione
   * che il container aveva acceso, senza che nessuno lo abbia chiesto.
   * Cancellandola torna a valere quello che c'e' fuori.
   */
  scriviImpostazione(chiave, valore, da = null) {
    const pulito = String(valore ?? '').trim();
    if (!pulito) {
      return this.sql.prepare('DELETE FROM impostazioni_istanza WHERE chiave = ?').run(chiave).changes;
    }
    return this.sql
      .prepare(
        `INSERT INTO impostazioni_istanza (chiave, valore, aggiornato, da) VALUES (?, ?, ?, ?)
         ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore,
                                           aggiornato = excluded.aggiornato,
                                           da = excluded.da`,
      )
      .run(chiave, pulito, ora(), da).changes;
  }

  /** Cosa dice l'invito, senza consumarlo. Serve a mostrare il ruolo prima di registrarsi. */
  guardaInvito(codice) {
    const riga = this.sql.prepare('SELECT * FROM inviti WHERE impronta = ?').get(impronta(codice));
    const problema = this.#problemaConInvito(riga);
    if (problema) return { errore: problema };
    return {
      invito: { ruolo: riga.ruolo, nomeSuggerito: riga.nome, restano: riga.usiMax - riga.usi },
    };
  }

  /**
   * Scambia il codice con un account. Monouso, salvo inviti a piu' usi.
   *
   * La `password` arriva gia' cifrata: il calcolo di scrypt e' asincrono e
   * costa cento millisecondi, e questo strato e' sincrono di proposito — una
   * transazione SQLite che aspetta una promessa e' una transazione che tiene
   * il database bloccato mentre non sta facendo niente.
   */
  riscattaInvito(codice, { utente, nome, password, dispositivo = null }) {
    const riga = this.sql.prepare('SELECT * FROM inviti WHERE impronta = ?').get(impronta(codice));
    const problema = this.#problemaConInvito(riga);
    if (problema) return { errore: problema };

    const nomeUtente = normalizzaNomeUtente(utente);
    const gia = this.sql.prepare('SELECT id FROM utenti WHERE utente = ?').get(nomeUtente);
    if (gia) return { errore: 'questo nome utente e\' gia\' preso' };

    const transazione = this.sql.transaction(() => {
      const ins = this.sql
        .prepare('INSERT INTO utenti (nome, utente, password, ruolo, creato) VALUES (?, ?, ?, ?, ?)')
        .run(nome || nomeUtente, nomeUtente, password, riga.ruolo, ora());
      const utenteId = Number(ins.lastInsertRowid);

      const token = segretoNuovo(32);
      this.sql
        .prepare('INSERT INTO token (utente, impronta, creato, dispositivo) VALUES (?, ?, ?, ?)')
        .run(utenteId, impronta(token), ora(), dispositivo);

      // Il contatore si incrementa nella stessa transazione, e la condizione
      // `usi < usiMax` sta nella UPDATE e non in un controllo prima: e' cosi'
      // che due riscatti simultanei sull'ultimo posto disponibile non
      // riescono entrambi.
      const agg = this.sql
        .prepare(
          'UPDATE inviti SET usi = usi + 1, usato = COALESCE(usato, ?), utente = COALESCE(utente, ?) WHERE id = ? AND usi < usiMax',
        )
        .run(ora(), utenteId, riga.id);
      if (agg.changes !== 1) throw new Error('codice gia\' usato');

      // Chi entra adesso entra negli spazi aperti. Su un'istanza di casa e'
      // cio' che ci si aspetta: l'invito all'istanza e' gia' il filtro, e
      // trovarsi dentro senza nessun canale visibile sembrerebbe un guasto.
      //
      // Gli spazi di sistema no: quello dei messaggi diretti non ha membri, ha
      // conversazioni. E nemmeno quelli chiusi a porte chiuse, dove si entra
      // con un invito loro.
      for (const s of this.sql.prepare('SELECT * FROM spazi WHERE sistema = 0').all()) {
        if (!this.impostazioniSpazio(s).apertoATutti) continue;
        this.sql
          .prepare('INSERT OR IGNORE INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
          .run(s.id, utenteId, riga.ruolo === 'admin' ? 'admin' : 'membro', ora());
        if (riga.ruolo === 'admin') {
          const admin = this.ruoli.perTipo(s.id, 'admin');
          if (admin) this.ruoli.assegna(admin.id, utenteId);
        }
      }

      return { token, utenteId };
    });

    try {
      const { token, utenteId } = transazione();
      return {
        token,
        utente: { id: utenteId, nome: nome || nomeUtente, utente: nomeUtente, ruolo: riga.ruolo, avatar: null },
      };
    } catch (errore) {
      if (String(errore.message).includes('UNIQUE')) {
        return { errore: 'questo nome utente e\' gia\' preso' };
      }
      return { errore: 'codice gia\' usato' };
    }
  }

  // -- Account ---------------------------------------------------------------

  utentePerNomeUtente(nomeUtente) {
    return this.sql
      .prepare('SELECT * FROM utenti WHERE utente = ? AND attivo = 1')
      .get(normalizzaNomeUtente(nomeUtente));
  }

  utente(id) {
    return this.sql.prepare('SELECT * FROM utenti WHERE id = ?').get(id);
  }

  /** Una sessione nuova: e' quello che si ottiene entrando con la password. */
  creaSessione(utenteId, dispositivo = null) {
    const token = segretoNuovo(32);
    this.sql
      .prepare('INSERT INTO token (utente, impronta, creato, dispositivo) VALUES (?, ?, ?, ?)')
      .run(utenteId, impronta(token), ora(), dispositivo);
    return token;
  }

  impostaPassword(utenteId, cifrata) {
    return this.sql.prepare('UPDATE utenti SET password = ? WHERE id = ?').run(cifrata, utenteId).changes;
  }

  // -- L'indirizzo di posta, e i codici che lo certificano --------------------

  /**
   * Scrive l'indirizzo e lo dichiara da confermare.
   *
   * Sempre da confermare, anche se e' lo stesso di prima riscritto uguale: la
   * conferma dice "questa casella la apre chi ha scritto qui dentro", ed e'
   * una cosa che si dimostra, non che si eredita da una schermata precedente.
   */
  impostaEmail(utenteId, indirizzo) {
    return this.sql
      .prepare('UPDATE utenti SET email = ?, emailConfermata = 0 WHERE id = ?')
      .run(indirizzo ? String(indirizzo).trim().toLowerCase() : null, utenteId).changes;
  }

  /**
   * Chi ha questo indirizzo, se qualcuno ce l'ha e lo ha confermato.
   *
   * Solo confermati, ed e' il cuore del recupero: un indirizzo scritto e mai
   * dimostrato non deve poter aprire niente, o basterebbe scrivere quello di
   * qualcun altro nel proprio account per farsi mandare la sua chiave di casa.
   */
  utentePerEmail(indirizzo) {
    return this.sql
      .prepare('SELECT * FROM utenti WHERE email = ? AND emailConfermata = 1 AND attivo = 1')
      .get(String(indirizzo ?? '').trim().toLowerCase());
  }

  /**
   * Un codice nuovo, e la fine di quelli di prima.
   *
   * Chiederne uno secondo invalida il primo. Senza, ogni richiesta lascerebbe
   * dietro un codice ancora valido, e chi ne chiede cinque perche' il primo
   * non arriva si ritroverebbe cinque chiavi in giro invece di una.
   *
   * Torna il codice in chiaro, e questa e' l'unica volta che esiste: da qui in
   * poi il database ne ha solo l'impronta, e nessuna rotta puo' ripescarlo.
   */
  creaCodice({ utente, scopo, indirizzo, validoMinuti = 15 }) {
    this.sql.prepare('DELETE FROM codici WHERE utente = ? AND scopo = ?').run(utente, scopo);
    const codice = codiceLeggibile();
    this.sql
      .prepare(
        `INSERT INTO codici (utente, scopo, impronta, indirizzo, creato, scade)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(utente, scopo, impronta(codice), String(indirizzo).trim().toLowerCase(), ora(), ora() + validoMinuti * 60);
    return codice;
  }

  /**
   * Perche' questo codice non va bene, se non va bene.
   *
   * Un posto solo che decide, come per gli inviti. Le stesse condizioni
   * ripetute nella conferma e nel recupero sarebbero due copie, e quando due
   * copie divergono a divergere e' quella che lascia passare.
   */
  #problemaConCodice(riga) {
    if (!riga) return 'codice non valido';
    if (riga.usato) return 'codice gia\' usato';
    if (riga.scade < ora()) return 'codice scaduto';
    if (riga.tentativi >= TENTATIVI_MAX) return 'troppi tentativi: chiedine uno nuovo';
    return null;
  }

  /**
   * Consuma un codice, o dice perche' no.
   *
   * Il tentativo si conta *prima* di rispondere, e vale anche quando il codice
   * non esiste — altrimenti sbagliarlo mille volte costerebbe quanto
   * sbagliarlo una, e sei caratteri si finiscono di provare in un pomeriggio.
   *
   * Si cerca per indirizzo oltre che per impronta: e' l'indirizzo a dire di
   * chi e' il codice, e chiederlo insieme toglie ogni ambiguita' su codici
   * corti che potrebbero, in teoria, ripetersi fra due persone.
   */
  consumaCodice({ scopo, indirizzo, codice }) {
    const pulito = String(codice ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
    const dove = String(indirizzo ?? '').trim().toLowerCase();

    const riga = this.sql
      .prepare('SELECT * FROM codici WHERE scopo = ? AND indirizzo = ? AND impronta = ?')
      .get(scopo, dove, impronta(pulito));

    // Il conteggio va sul codice vivo di quella persona, non su quello che non
    // e' stato trovato: e' l'unico modo di far pesare un tentativo sbagliato.
    if (!riga) {
      this.sql
        .prepare('UPDATE codici SET tentativi = tentativi + 1 WHERE scopo = ? AND indirizzo = ? AND usato IS NULL')
        .run(scopo, dove);
      return { problema: 'codice non valido' };
    }

    const problema = this.#problemaConCodice(riga);
    if (problema) {
      this.sql.prepare('UPDATE codici SET tentativi = tentativi + 1 WHERE id = ?').run(riga.id);
      return { problema };
    }

    this.sql.prepare('UPDATE codici SET usato = ? WHERE id = ?').run(ora(), riga.id);
    return { utente: riga.utente, indirizzo: riga.indirizzo };
  }

  // -- Collegare un dispositivo nuovo -----------------------------------------

  /**
   * Un codice da guardare qui e ribattere altrove.
   *
   * Come per i codici di posta, chiederne uno nuovo spegne il precedente: due
   * codici vivi contemporaneamente sono due chiavi, e la seconda esiste solo
   * perche' ci si e' dimenticati della prima.
   *
   * Otto caratteri e due minuti. Vedi lo schema per il perche' della
   * differenza con i sei della posta.
   */
  creaAccoppiamento(utenteId, { validoSecondi = 120 } = {}) {
    this.sql.prepare('DELETE FROM accoppiamenti WHERE utente = ?').run(utenteId);
    const codice = codiceLeggibile(8);
    this.sql
      .prepare('INSERT INTO accoppiamenti (utente, impronta, creato, scade) VALUES (?, ?, ?, ?)')
      .run(utenteId, impronta(codice), ora(), ora() + validoSecondi);
    return { codice, scade: ora() + validoSecondi };
  }

  /**
   * Consuma un codice e dice di chi era.
   *
   * Il codice si brucia appena viene riconosciuto, prima ancora che la sessione
   * nasca: se qualcosa va storto dopo, il peggio che succede e' che ne serve
   * uno nuovo — molto meglio di un codice che resta valido perche' il passo
   * successivo e' fallito.
   */
  consumaAccoppiamento(codice) {
    const pulito = String(codice ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (!pulito) return { problema: 'codice non valido' };

    const riga = this.sql.prepare('SELECT * FROM accoppiamenti WHERE impronta = ?').get(impronta(pulito));
    if (!riga) return { problema: 'codice non valido' };
    if (riga.usato) return { problema: 'codice gia\' usato' };
    if (riga.scade < ora()) return { problema: 'codice scaduto' };

    this.sql.prepare('UPDATE accoppiamenti SET usato = ? WHERE id = ?').run(ora(), riga.id);

    const utente = this.utente(riga.utente);
    if (!utente || !utente.attivo) return { problema: 'codice non valido' };
    return { utente };
  }

  /** Quali avvisi per posta vuole ricevere questa persona. */
  impostaAvvisi(utenteId, json) {
    return this.sql.prepare('UPDATE utenti SET avvisiEmail = ? WHERE id = ?').run(json, utenteId).changes;
  }

  /** L'indirizzo diventa quello dell'account, e da adesso e' dimostrato. */
  confermaEmail(utenteId, indirizzo) {
    return this.sql
      .prepare('UPDATE utenti SET email = ?, emailConfermata = 1 WHERE id = ?')
      .run(String(indirizzo).trim().toLowerCase(), utenteId).changes;
  }

  /** Nome visibile e foto: non toccano le credenziali. */
  aggiornaProfilo(utenteId, { nome, avatar, stato }) {
    const attuale = this.utente(utenteId);
    if (!attuale) return 0;
    return this.sql
      .prepare('UPDATE utenti SET nome = ?, avatar = ?, stato = ? WHERE id = ?')
      .run(
        nome === undefined ? attuale.nome : nome,
        avatar === undefined ? attuale.avatar : avatar,
        stato === undefined ? (attuale.stato ?? 'online') : stato,
        utenteId,
      ).changes;
  }

  /** Sceglie il nome utente per chi e' nato prima che esistessero gli account. */
  impostaNomeUtente(utenteId, nomeUtente) {
    const nome = normalizzaNomeUtente(nomeUtente);
    const gia = this.sql.prepare('SELECT id FROM utenti WHERE utente = ?').get(nome);
    if (gia && gia.id !== utenteId) return { errore: 'questo nome utente e\' gia\' preso' };
    this.sql.prepare('UPDATE utenti SET utente = ? WHERE id = ?').run(nome, utenteId);
    return { ok: true };
  }

  /** Cio' che di una persona possono vedere gli altri, e nient'altro. */
  /**
   * Le facce di tutti, per disegnare gli elenchi.
   *
   * `stato` c'e' e prima non c'era, ed e' il motivo per cui invisibile non ha
   * mai funzionato: la rotta dei profili lo leggeva da queste righe, non lo
   * trovava, e ripiegava su "online" per chiunque — compreso chi si era appena
   * messo invisibile proprio per non comparire. Nessuno se n'era accorto
   * perche' il valore di ripiego era quello giusto per la stragrande
   * maggioranza delle righe.
   */
  elencoProfili() {
    return this.sql
      .prepare('SELECT id, nome, utente, avatar, tipo, stato FROM utenti WHERE attivo = 1 ORDER BY id')
      .all();
  }

  /** Installa un'identita' bot interna nello spazio, senza token o login. */
  botInterno(spazioId, installatoDa, nome = 'Assistente PulseTalk') {
    const esistente = this.sql.prepare(
      `SELECT u.* FROM bot_installazioni b JOIN utenti u ON u.id = b.bot
        WHERE b.spazio = ? AND b.attivo = 1 AND u.attivo = 1 ORDER BY b.installato LIMIT 1`,
    ).get(spazioId);
    if (esistente) return esistente;

    const crea = this.sql.transaction(() => {
      const ins = this.sql.prepare(
        `INSERT INTO utenti (nome, utente, password, ruolo, creato, attivo, tipo)
         VALUES (?, NULL, NULL, 'membro', ?, 1, 'bot')`,
      ).run(nome, ora());
      const id = Number(ins.lastInsertRowid);
      this.aggiungiMembro(spazioId, id, 'membro');
      this.sql.prepare(
        'INSERT INTO bot_installazioni (spazio, bot, installatoDa, installato, attivo) VALUES (?, ?, ?, ?, 1)',
      ).run(spazioId, id, installatoDa, ora());
      return this.utente(id);
    });
    return crea();
  }

  botDiSpazio(spazioId) {
    return this.sql.prepare(
      `SELECT u.id, u.nome, u.avatar, u.tipo, b.installatoDa, b.installato, b.attivo
         FROM bot_installazioni b JOIN utenti u ON u.id = b.bot
        WHERE b.spazio = ? ORDER BY b.installato, u.id`,
    ).all(spazioId).map((b) => ({ ...b, attivo: !!b.attivo }));
  }

  revocaBot(spazioId, botId) {
    const revoca = this.sql.transaction(() => {
      const r = this.sql.prepare(
        'UPDATE bot_installazioni SET attivo = 0 WHERE spazio = ? AND bot = ? AND attivo = 1',
      ).run(spazioId, botId);
      if (!r.changes) return 0;
      this.togliMembro(spazioId, botId);
      this.sql.prepare('UPDATE utenti SET attivo = 0 WHERE id = ? AND tipo = \'bot\'').run(botId);
      return 1;
    });
    return revoca();
  }

  sessioniDi(utenteId) {
    return this.sql
      .prepare(
        `SELECT id, creato, ultimoUso, dispositivo, revocato
           FROM token WHERE utente = ? AND revocato = 0 ORDER BY creato DESC`,
      )
      .all(utenteId);
  }

  /**
   * Chi e' il proprietario di questo token.
   *
   * `stato` c'e' e prima non c'era, e con lui mancava all'applicazione la
   * memoria di cio' che aveva scelto: `/api/auth/io` rispondeva sempre
   * "online", quindi chi si metteva "non disturbare" la sera riapriva il
   * giorno dopo trovandosi online. Lo stato era salvato correttamente sul
   * disco — e' che nessuno lo rileggeva.
   */
  utenteDaToken(token) {
    if (!token) return null;
    const riga = this.sql
      .prepare(
        `SELECT t.id AS tokenId, t.revocato,
                u.id, u.nome, u.utente, u.ruolo, u.attivo, u.avatar, u.password,
                u.stato
           FROM token t JOIN utenti u ON u.id = t.utente
          WHERE t.impronta = ?`,
      )
      .get(impronta(token));
    if (!riga || riga.revocato || !riga.attivo) return null;

    // Serve a sapere chi e' ancora vivo prima di revocare: si scrive al
    // massimo una volta al minuto, per non trasformare ogni GET in una
    // scrittura su un database che sta su ZFS.
    this.sql
      .prepare('UPDATE token SET ultimoUso = ? WHERE id = ? AND (ultimoUso IS NULL OR ultimoUso < ?)')
      .run(ora(), riga.tokenId, ora() - 60);

    return {
      id: riga.id,
      nome: riga.nome,
      utente: riga.utente,
      ruolo: riga.ruolo,
      avatar: riga.avatar,
      stato: riga.stato ?? 'online',
      tokenId: riga.tokenId,
      deveCompletare: !riga.utente || !riga.password,
    };
  }

  elencoAccessi() {
    return this.sql
      .prepare(
        `SELECT u.id, u.nome, u.utente, u.ruolo, u.attivo,
                t.id AS tokenId, t.creato, t.ultimoUso, t.revocato, t.dispositivo
           FROM utenti u LEFT JOIN token t ON t.utente = u.id
          ORDER BY u.id, t.id`,
      )
      .all();
  }

  revocaToken(tokenId) {
    return this.sql.prepare('UPDATE token SET revocato = 1 WHERE id = ?').run(tokenId).changes;
  }

  revocaUtente(utenteId) {
    const t = this.sql.transaction(() => {
      this.sql.prepare('UPDATE token SET revocato = 1 WHERE utente = ?').run(utenteId);
      return this.sql.prepare('UPDATE utenti SET attivo = 0 WHERE id = ?').run(utenteId).changes;
    });
    return t();
  }

  // -- Spazi -----------------------------------------------------------------

  creaSpazio({
    nome,
    icona = null,
    creatoDa = null,
    descrizione = '',
    regole = '',
    sistema = false,
    impostazioni = {},
    canaliIniziali = true,
  }) {
    // Come per i canali: un numero in coda invece di un rifiuto.
    //
    // Rifiutare aveva senso quando gli spazi li creava solo chi amministra, e
    // vedeva tutti quelli che c'erano. Adesso li crea chiunque, e quasi tutti
    // sono privati: un "esiste gia' uno spazio con la chiave musica" sarebbe
    // insieme un fastidio — chi lo legge non ha nessun modo di sapere quale —
    // e un modo per scoprire i nomi degli spazi degli altri provando a
    // crearli. La chiave e' un identificatore interno, il nome resta quello
    // che si e' scelto.
    let chiave = chiaveDa(nome);
    let n = 2;
    while (this.sql.prepare('SELECT id FROM spazi WHERE chiave = ?').get(chiave)) {
      chiave = `${chiaveDa(nome)}-${n}`;
      n += 1;
    }

    const crea = this.sql.transaction(() => {
      const ins = this.sql
        .prepare(
          `INSERT INTO spazi (chiave, nome, icona, creato, creatoDa, descrizione, regole, proprietario, sistema, impostazioni)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chiave,
          nome,
          icona,
          ora(),
          creatoDa,
          String(descrizione).slice(0, 1000),
          String(regole).slice(0, 8000),
          creatoDa,
          sistema ? 1 : 0,
          JSON.stringify({ ...IMPOSTAZIONI_SPAZIO, ...impostazioni }),
        );
      const id = Number(ins.lastInsertRowid);

      // I ruoli prima dei membri: chi crea deve trovare l'Admin gia' pronto da
      // indossare, o resterebbe padrone di casa senza le chiavi.
      const admin = sistema ? null : this.ruoli.assicuraPredefiniti(id);

      if (creatoDa) {
        this.sql
          .prepare('INSERT INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
          .run(id, creatoDa, 'admin', ora());
        if (admin) this.ruoli.assegna(admin.id, creatoDa);
      }

      if (!canaliIniziali) return id;

      // Uno spazio vuoto non si sa da dove cominciare a usarlo.
      this.sql
        .prepare(
          `INSERT INTO canali (spazio, chiave, nome, tipo, posizione, creato)
           VALUES (?, 'generale', 'generale', 'testo', 0, ?)`,
        )
        .run(id, ora());
      this.sql
        .prepare(
          `INSERT INTO canali (spazio, chiave, nome, tipo, posizione, creato)
           VALUES (?, 'salotto', 'Salotto', 'voce', 1, ?)`,
        )
        .run(id, ora());

      return id;
    });

    return { spazio: this.spazio(crea()) };
  }

  spazio(id) {
    return this.sql.prepare('SELECT * FROM spazi WHERE id = ?').get(id) ?? null;
  }

  aggiornaSpazio(id, { nome, icona, descrizione, regole, proprietario, impostazioni }) {
    const attuale = this.spazio(id);
    if (!attuale) return null;

    this.sql
      .prepare(
        `UPDATE spazi SET nome = ?, icona = ?, descrizione = ?, regole = ?, proprietario = ?, impostazioni = ?
          WHERE id = ?`,
      )
      .run(
        nome === undefined ? attuale.nome : String(nome).slice(0, 60),
        // Stringa vuota vuol dire "togli l'icona", undefined "non toccarla".
        icona === undefined ? attuale.icona : icona || null,
        descrizione === undefined ? attuale.descrizione : String(descrizione).slice(0, 1000),
        regole === undefined ? attuale.regole : String(regole).slice(0, 8000),
        proprietario === undefined ? attuale.proprietario : proprietario,
        impostazioni === undefined
          ? attuale.impostazioni
          : JSON.stringify({ ...this.impostazioniSpazio(attuale), ...impostazioni }),
        id,
      );
    return this.spazio(id);
  }

  /**
   * Passa la proprieta' verificando tutti gli invarianti nello stesso lock di
   * scrittura SQLite. Fra controllo dell'amicizia e UPDATE non puo' infilarsi
   * una richiesta che la rimuove lasciando un trasferimento ormai invalido.
   */
  trasferisciProprieta(spazioId, proprietarioAttuale, nuovoProprietario) {
    const trasferisci = this.sql.transaction(() => {
      const spazio = this.spazio(spazioId);
      if (!spazio || spazio.sistema) return { errore: 'spazio inesistente', stato: 404 };
      if (spazio.proprietario !== proprietarioAttuale) {
        return { errore: 'solo il proprietario passa la proprieta\'', stato: 403 };
      }
      if (!Number.isInteger(nuovoProprietario) || nuovoProprietario === proprietarioAttuale) {
        return { errore: 'scegli un altro membro dello spazio', stato: 400 };
      }

      const membro = this.sql
        .prepare(
          `SELECT 1 FROM membri m JOIN utenti u ON u.id = m.utente
            WHERE m.spazio = ? AND m.utente = ? AND u.attivo = 1`,
        )
        .get(spazioId, nuovoProprietario);
      if (!membro) return { errore: 'questa persona non e\' in questo spazio', stato: 404 };

      const amicizia = this.amicizia(proprietarioAttuale, nuovoProprietario);
      if (amicizia?.stato !== 'amici') {
        return { errore: 'la proprieta\' si puo\' passare soltanto a un amico', stato: 400 };
      }

      const admin = this.ruoli.perTipo(spazioId, 'admin');
      if (admin) this.ruoli.assegna(admin.id, nuovoProprietario);
      const cambiato = this.sql
        .prepare('UPDATE spazi SET proprietario = ? WHERE id = ? AND proprietario = ?')
        .run(nuovoProprietario, spazioId, proprietarioAttuale).changes;
      if (cambiato !== 1) return { errore: 'la proprieta\' e\' cambiata, rileggi lo spazio', stato: 409 };
      return { spazio: this.spazio(spazioId) };
    });
    return trasferisci();
  }

  /** Le preferenze dello spazio, con i buchi riempiti dai valori di serie. */
  impostazioniSpazio(spazio) {
    const riga = typeof spazio === 'object' ? spazio : this.spazio(spazio);
    if (!riga) return { ...IMPOSTAZIONI_SPAZIO };
    try {
      return { ...IMPOSTAZIONI_SPAZIO, ...(JSON.parse(riga.impostazioni ?? '{}') ?? {}) };
    } catch {
      return { ...IMPOSTAZIONI_SPAZIO };
    }
  }

  /**
   * Cosa puo' fare questa persona qui dentro.
   *
   * L'unico modo per saperlo, in tutto il programma. Prende lo spazio e, se
   * c'e', il canale: la categoria la ricava da solo, perche' un chiamante che
   * dovesse ricordarsi di passarla e' un chiamante che prima o poi la
   * dimentica — e dimenticarla vuol dire concedere.
   */
  permessiIn(utente, { spazio, canale = null }) {
    const riga = typeof spazio === 'object' ? spazio : this.spazio(spazio);
    if (!riga) return new Set();

    const suoCanale = canale === null ? null : typeof canale === 'object' ? canale : this.canale(canale);
    const categoria = suoCanale?.categoria ?? null;

    return risolvi({
      utente: utente.id,
      ruoli: this.ruoli.diUtente(riga.id, utente.id),
      // Su uno spazio di sistema — quello dei messaggi diretti — non esiste
      // nessun padrone di casa: sono conversazioni fra due persone, e
      // l'amministratore dell'istanza non ci mette piede piu' degli altri.
      proprietario: !riga.sistema && riga.proprietario === utente.id,
      amministratoreIstanza: !riga.sistema && utente.ruolo === 'admin',
      overrideCategoria: categoria ? this.ruoli.overrideDi('categoria', categoria) : [],
      overrideCanale: suoCanale ? this.ruoli.overrideDi('canale', suoCanale.id) : [],
    });
  }

  /** Comodita': un permesso solo, senza costruire l'insieme a mano fuori. */
  puo(utente, permesso, { spazio, canale = null }) {
    return this.permessiIn(utente, { spazio, canale }).has(permesso);
  }

  spazioPerChiave(chiave) {
    return this.sql.prepare('SELECT * FROM spazi WHERE chiave = ?').get(chiave) ?? null;
  }

  /** Gli spazi a cui una persona appartiene, in ordine di ingresso. */
  spaziDi(utenteId) {
    return this.sql
      .prepare(
        `SELECT s.*, m.ruolo AS ruoloMio
           FROM spazi s JOIN membri m ON m.spazio = s.id
          WHERE m.utente = ? AND s.sistema = 0 ORDER BY m.entrato, s.id`,
      )
      .all(utenteId);
  }

  eliminaSpazio(id) {
    return this.sql.prepare('DELETE FROM spazi WHERE id = ?').run(id).changes;
  }

  aggiungiMembro(spazioId, utenteId, ruolo = 'membro') {
    this.sql
      .prepare('INSERT OR IGNORE INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
      .run(spazioId, utenteId, ruolo, ora());

    // Il ruolo grosso adesso vive nei ruoli veri: chiedere 'admin' qui vuol
    // dire ricevere il ruolo Admin dello spazio, non una stringa in una
    // colonna che nessuno legge piu' per decidere.
    if (ruolo === 'admin') {
      const admin = this.ruoli.perTipo(spazioId, 'admin');
      if (admin) this.ruoli.assegna(admin.id, utenteId);
    }
  }

  togliMembro(spazioId, utenteId) {
    const via = this.sql.transaction(() => {
      // Prima i ruoli: restare assegnati a un ruolo di uno spazio da cui si e'
      // usciti vorrebbe dire riprenderseli tutti rientrando, anche dopo un
      // bando revocato per pieta'.
      this.ruoli.togliTuttiDelloSpazio(spazioId, utenteId);
      return this.sql
        .prepare('DELETE FROM membri WHERE spazio = ? AND utente = ?')
        .run(spazioId, utenteId).changes;
    });
    return via();
  }

  membriDi(spazioId) {
    return this.sql
      .prepare(
        `SELECT u.id, u.nome, u.utente, u.avatar, m.ruolo, m.entrato
           FROM membri m JOIN utenti u ON u.id = m.utente
          WHERE m.spazio = ? AND u.attivo = 1
          ORDER BY u.nome COLLATE NOCASE`,
      )
      .all(spazioId);
  }

  /** Gli stessi membri, con addosso i ruoli che hanno qui. Per il pannello. */
  membriConRuoli(spazioId) {
    const per = new Map();
    for (const riga of this.sql
      .prepare(
        `SELECT rm.utente, r.id, r.nome, r.colore, r.priorita, r.tipo
           FROM ruoli_membri rm JOIN ruoli r ON r.id = rm.ruolo
          WHERE r.spazio = ?
          ORDER BY r.priorita DESC, r.id`,
      )
      .all(spazioId)) {
      if (!per.has(riga.utente)) per.set(riga.utente, []);
      per.get(riga.utente).push({
        id: riga.id,
        nome: riga.nome,
        colore: riga.colore,
        priorita: riga.priorita,
        tipo: riga.tipo,
      });
    }

    const proprietario = this.spazio(spazioId)?.proprietario ?? null;
    return this.membriDi(spazioId).map((m) => ({
      ...m,
      ruoli: per.get(m.id) ?? [],
      proprietario: m.id === proprietario,
    }));
  }

  /**
   * Che ruolo ha questa persona in questo spazio.
   *
   * Un admin dell'istanza e' admin ovunque: su una macchina di casa il
   * proprietario del NAS puo' comunque leggere il database, quindi fingere che
   * non possa moderare uno spazio sarebbe una recita.
   */
  ruoloNelloSpazio(spazioId, utente) {
    const spazio = this.spazio(spazioId);
    if (!spazio) return null;

    // Uno spazio di sistema non ha membri nel senso normale: ci si sta se si e'
    // iscritti a un canale suo, e a deciderlo e' accessoAlCanale.
    if (spazio.sistema) {
      return this.sql
        .prepare(
          `SELECT 1 FROM iscritti i JOIN canali c ON c.id = i.canale
            WHERE c.spazio = ? AND i.utente = ? LIMIT 1`,
        )
        .get(spazioId, utente.id)
        ? 'membro'
        : null;
    }

    if (utente.ruolo === 'admin') return 'admin';

    const riga = this.sql
      .prepare('SELECT ruolo FROM membri WHERE spazio = ? AND utente = ?')
      .get(spazioId, utente.id);
    if (!riga) return null;

    // Il ruolo grosso non e' piu' una colonna: e' cio' che i permessi dicono.
    // Cosi' non esistono due verita' — una nella colonna e una nei ruoli — e
    // togliere manageServer a qualcuno lo declassa davvero, invece di lasciarlo
    // admin agli occhi di meta' del codice.
    return this.permessiIn(utente, { spazio }).has('manageServer') ? 'admin' : 'membro';
  }

  // -- Categorie e canali ----------------------------------------------------

  creaCategoria(spazioId, nome) {
    const dopo = this.sql
      .prepare('SELECT COALESCE(MAX(posizione), -1) + 1 AS p FROM categorie WHERE spazio = ?')
      .get(spazioId);
    const ins = this.sql
      .prepare('INSERT INTO categorie (spazio, nome, posizione) VALUES (?, ?, ?)')
      .run(spazioId, nome, dopo.p);
    return this.sql.prepare('SELECT * FROM categorie WHERE id = ?').get(Number(ins.lastInsertRowid));
  }

  categorieDi(spazioId) {
    return this.sql
      .prepare('SELECT * FROM categorie WHERE spazio = ? ORDER BY posizione, id')
      .all(spazioId);
  }

  categoria(id) {
    return this.sql.prepare('SELECT * FROM categorie WHERE id = ?').get(id) ?? null;
  }

  aggiornaCategoria(id, { nome, posizione }) {
    const attuale = this.categoria(id);
    if (!attuale) return null;
    this.sql
      .prepare('UPDATE categorie SET nome = ?, posizione = ? WHERE id = ?')
      .run(
        nome === undefined ? attuale.nome : String(nome).trim().slice(0, 40) || attuale.nome,
        posizione === undefined ? attuale.posizione : Number(posizione),
        id,
      );
    return this.categoria(id);
  }

  /**
   * Rimette in fila categorie o canali, in un colpo solo.
   *
   * Un ordine si trascina tutto insieme: mandare una PATCH per riga vorrebbe
   * dire che una connessione caduta a meta' lascia l'elenco in un ordine che
   * nessuno ha mai voluto.
   */
  riordina(tabella, spazioId, idInOrdine) {
    if (tabella !== 'categorie' && tabella !== 'canali') throw new Error('tabella sconosciuta');
    const scrivi = this.sql.prepare(
      `UPDATE ${tabella} SET posizione = ? WHERE id = ? AND spazio = ?`,
    );
    const tutte = this.sql.transaction(() => {
      idInOrdine.forEach((id, indice) => scrivi.run(indice, Number(id), spazioId));
    });
    tutte();
  }

  eliminaCategoria(id) {
    // Gli override della categoria se ne vanno con lei: restare in tabella
    // vorrebbe dire che la prossima categoria con lo stesso id nascerebbe con
    // dentro i permessi di una che non c'e' piu'.
    this.ruoli.eliminaOverrideDi('categoria', id);
    // I canali dentro non si perdono: la ON DELETE SET NULL li lascia dove
    // sono, senza categoria, in cima all'elenco. Cancellare un raggruppamento
    // non deve mai cancellare quello che raggruppa.
    return this.sql.prepare('DELETE FROM categorie WHERE id = ?').run(id).changes;
  }

  creaCanale(
    spazioId,
    {
      nome,
      tipo,
      categoria = null,
      argomento = '',
      soloAscolto = false,
      privato = false,
      creatoDa = null,
      scade = null,
    },
  ) {
    if (tipo !== 'testo' && tipo !== 'voce') return { errore: 'il tipo deve essere testo o voce' };

    let chiave = chiaveDa(nome);
    // Due canali con lo stesso nome dentro allo stesso spazio: si aggiunge un
    // numero invece di rifiutare. Chi crea "generale" quando esiste gia' non
    // sta sbagliando, sta solo scegliendo un nome ovvio.
    let n = 2;
    while (this.sql.prepare('SELECT id FROM canali WHERE spazio = ? AND chiave = ?').get(spazioId, chiave)) {
      chiave = `${chiaveDa(nome)}-${n}`;
      n += 1;
    }

    const dopo = this.sql
      .prepare('SELECT COALESCE(MAX(posizione), -1) + 1 AS p FROM canali WHERE spazio = ?')
      .get(spazioId);

    const ins = this.sql
      .prepare(
        `INSERT INTO canali
           (spazio, categoria, chiave, nome, tipo, argomento, posizione, soloAscolto, privato, creato, creatoDa, scade)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        spazioId,
        categoria,
        chiave,
        nome,
        tipo,
        argomento,
        dopo.p,
        soloAscolto ? 1 : 0,
        privato ? 1 : 0,
        ora(),
        creatoDa,
        scade,
      );

    return { canale: this.canale(Number(ins.lastInsertRowid)) };
  }

  canale(id) {
    const riga = this.sql
      .prepare('SELECT * FROM canali WHERE id = ? AND (scade IS NULL OR scade > ?)')
      .get(id, ora());
    return riga ? { ...riga, soloAscolto: !!riga.soloAscolto, privato: !!riga.privato } : null;
  }

  canaliDi(spazioId) {
    return this.sql
      .prepare('SELECT * FROM canali WHERE spazio = ? AND (scade IS NULL OR scade > ?) ORDER BY posizione, id')
      .all(spazioId, ora())
      .map((r) => ({ ...r, soloAscolto: !!r.soloAscolto, privato: !!r.privato }));
  }

  /**
   * I canali che questa persona puo' vedere in questo spazio.
   *
   * Un canale privato lo vedono gli iscritti e gli admin dello spazio. Che
   * l'admin veda tutto non e' una svista: su un'istanza di casa chi amministra
   * ha comunque il file del database sotto mano, e fingere che un canale gli
   * sia nascosto sarebbe una recita — la stessa posizione, per lo stesso
   * motivo, di `ruoloNelloSpazio`.
   */
  canaliVisibili(spazioId, utente, ruolo) {
    // Retrocompatibilita': fino a ieri qui arrivava un id, adesso arriva la
    // persona intera perche' i permessi hanno bisogno del ruolo d'istanza.
    const chi = typeof utente === 'object' ? utente : { id: utente, ruolo: ruolo ?? 'membro' };
    const tutti = this.canaliDi(spazioId);
    const spazio = this.spazio(spazioId);
    const miei = new Set(this.canaliIscritto(chi.id));

    return tutti.filter((canale) => {
      // Il canale privato resta quello che era: lo vedono gli invitati. E' la
      // scorciatoia di sempre, e continua a valere accanto agli override.
      if (canale.privato && !miei.has(canale.id) && ruolo !== 'admin') return false;
      return this.permessiIn(chi, { spazio, canale }).has('viewChannel');
    });
  }

  /**
   * Le persone a cui si puo' rivelare cio' che succede in un canale.
   *
   * Le rotte HTTP controllano l'accesso di chi le chiama, ma gli eventi SSE
   * partono dal server: mandare un messaggio intero a tutti i membri dello
   * spazio aggirerebbe un override `viewChannel` proprio sul canale nascosto.
   * Questa e' la stessa regola di `canaliVisibili`, usata dal lato push.
   */
  destinatariCanale(canaleId) {
    const canale = this.canale(Number(canaleId));
    if (!canale) return [];

    const spazio = this.spazio(canale.spazio);
    if (!spazio) return [];
    if (spazio.sistema) return this.iscrittiAlCanale(canale.id).map((i) => i.id);

    return this.membriDi(spazio.id)
      .filter((membro) => {
        const utente = this.utente(membro.id);
        if (!utente) return false;
        const ruolo = this.ruoloNelloSpazio(spazio.id, utente);
        return this.canaliVisibili(spazio.id, utente, ruolo).some((c) => c.id === canale.id);
      })
      .map((membro) => membro.id);
  }

  // -- Iscritti ai canali privati --------------------------------------------

  /** Gli id dei canali privati in cui questa persona e' stata invitata. */
  canaliIscritto(utenteId) {
    return this.sql
      .prepare('SELECT canale FROM iscritti WHERE utente = ?')
      .all(utenteId)
      .map((r) => r.canale);
  }

  iscrittiAlCanale(canaleId) {
    return this.sql
      .prepare(
        `SELECT u.id, u.nome, u.utente, u.avatar, i.entrato, i.invitatoDa
           FROM iscritti i JOIN utenti u ON u.id = i.utente
          WHERE i.canale = ? AND u.attivo = 1
          ORDER BY u.nome COLLATE NOCASE`,
      )
      .all(canaleId);
  }

  eIscritto(canaleId, utenteId) {
    return !!this.sql
      .prepare('SELECT 1 FROM iscritti WHERE canale = ? AND utente = ?')
      .get(canaleId, utenteId);
  }

  iscrivi(canaleId, utenteId, invitatoDa = null) {
    this.sql
      .prepare(
        'INSERT OR IGNORE INTO iscritti (canale, utente, invitatoDa, entrato) VALUES (?, ?, ?, ?)',
      )
      .run(canaleId, utenteId, invitatoDa, ora());
  }

  disiscrivi(canaleId, utenteId) {
    return this.sql
      .prepare('DELETE FROM iscritti WHERE canale = ? AND utente = ?')
      .run(canaleId, utenteId).changes;
  }

  // -- Amicizie --------------------------------------------------------------

  /** La coppia, sempre ordinata: e' la chiave primaria di `amicizie`. */
  #coppia(a, b) {
    return a < b ? [a, b] : [b, a];
  }

  amicizia(a, b) {
    const [uno, due] = this.#coppia(a, b);
    return this.sql.prepare('SELECT * FROM amicizie WHERE uno = ? AND due = ?').get(uno, due) ?? null;
  }

  /**
   * Chiede, oppure accetta.
   *
   * Se l'altro aveva gia' chiesto, questa chiamata non apre una seconda
   * richiesta speculare: chiude la sua. Due persone che si cercano nello stesso
   * momento diventano amiche, invece di restare ognuna in attesa dell'altra.
   */
  chiediAmicizia(chiedente, altro) {
    if (chiedente === altro) return { errore: 'non si diventa amici di se stessi' };
    if (!this.utente(altro)) return { errore: 'questa persona non esiste' };

    const esistente = this.amicizia(chiedente, altro);
    if (esistente?.stato === 'amici') return { stato: 'amici' };
    if (esistente?.stato === 'attesa') {
      if (esistente.chiedente === chiedente) return { stato: 'attesa' };
      return this.accettaAmicizia(chiedente, altro);
    }

    const [uno, due] = this.#coppia(chiedente, altro);
    this.sql
      .prepare(
        'INSERT INTO amicizie (uno, due, chiedente, stato, chiesto) VALUES (?, ?, ?, ?, ?)',
      )
      .run(uno, due, chiedente, 'attesa', ora());
    return { stato: 'attesa' };
  }

  accettaAmicizia(chiAccetta, altro) {
    const esistente = this.amicizia(chiAccetta, altro);
    if (!esistente) return { errore: 'non c\'e\' nessuna richiesta' };
    // Solo chi ha ricevuto puo' accettare: accettare la propria richiesta
    // sarebbe diventare amici da soli.
    if (esistente.chiedente === chiAccetta) return { errore: 'sei tu ad aver chiesto' };

    const [uno, due] = this.#coppia(chiAccetta, altro);
    this.sql
      .prepare('UPDATE amicizie SET stato = ?, risposto = ? WHERE uno = ? AND due = ?')
      .run('amici', ora(), uno, due);
    return { stato: 'amici' };
  }

  /** Rifiuta, annulla, o smette: sono la stessa riga che se ne va. */
  togliAmicizia(a, b) {
    const [uno, due] = this.#coppia(a, b);
    return this.sql.prepare('DELETE FROM amicizie WHERE uno = ? AND due = ?').run(uno, due).changes;
  }

  /** Amici, richieste ricevute e richieste mandate, in una lettura sola. */
  amicizieDi(utenteId) {
    const righe = this.sql
      .prepare(
        `SELECT a.uno, a.due, a.chiedente, a.stato, a.chiesto,
                u.id, u.nome, u.utente, u.avatar
           FROM amicizie a
           JOIN utenti u ON u.id = CASE WHEN a.uno = ? THEN a.due ELSE a.uno END
          WHERE (a.uno = ? OR a.due = ?) AND u.attivo = 1
          ORDER BY u.nome COLLATE NOCASE`,
      )
      .all(utenteId, utenteId, utenteId);

    return {
      amici: righe.filter((r) => r.stato === 'amici').map(profiloDaRiga),
      ricevute: righe
        .filter((r) => r.stato === 'attesa' && r.chiedente !== utenteId)
        .map(profiloDaRiga),
      inviate: righe
        .filter((r) => r.stato === 'attesa' && r.chiedente === utenteId)
        .map(profiloDaRiga),
    };
  }

  aggiornaCanale(id, { nome, argomento, categoria, posizione, soloAscolto, privato, icona, scade }) {
    const attuale = this.canale(id);
    if (!attuale) return 0;
    return this.sql
      .prepare(
        `UPDATE canali SET nome = ?, argomento = ?, categoria = ?, posizione = ?, soloAscolto = ?, privato = ?, icona = ?, scade = ?
          WHERE id = ?`,
      )
      .run(
        nome ?? attuale.nome,
        argomento ?? attuale.argomento,
        categoria === undefined ? attuale.categoria : categoria,
        posizione ?? attuale.posizione,
        (soloAscolto === undefined ? attuale.soloAscolto : soloAscolto) ? 1 : 0,
        (privato === undefined ? attuale.privato : privato) ? 1 : 0,
        // Stringa vuota vuol dire "togli l'icona": undefined vuol dire "non
        // toccarla". Senza questa distinzione un'icona messa non si leverebbe
        // piu'.
        icona === undefined ? attuale.icona : icona || null,
        scade === undefined ? attuale.scade : scade,
        id,
      ).changes;
  }

  /** Canali scaduti ancora da rimuovere, inclusi quelli vocali da chiudere. */
  canaliScaduti(adesso = ora()) {
    return this.sql
      .prepare('SELECT * FROM canali WHERE scade IS NOT NULL AND scade <= ? ORDER BY scade, id')
      .all(adesso)
      .map((r) => ({ ...r, soloAscolto: !!r.soloAscolto, privato: !!r.privato }));
  }

  eliminaCanale(id) {
    this.ruoli.eliminaOverrideDi('canale', id);
    return this.sql.prepare('DELETE FROM canali WHERE id = ?').run(id).changes;
  }

  /** La chiave con cui la SFU conosce un canale vocale: spazio e canale insieme. */
  chiaveSfu(canale) {
    const spazio = this.spazio(canale.spazio);
    return `${spazio.chiave}--${canale.chiave}`;
  }

  /**
   * Il canale che sta dietro a un nome di stanza della SFU.
   *
   * La strada opposta di `chiaveSfu`, e serve a chi riceve un webhook: da li'
   * arriva un nome di stanza e nient'altro. Torna null per una stanza che non
   * corrisponde piu' a niente — un canale cancellato mentre la SFU la teneva
   * ancora viva — ed e' un caso normale, non un errore.
   */
  canalePerChiaveSfu(nome) {
    const [chiaveSpazio, chiaveCanale] = String(nome ?? '').split('--');
    if (!chiaveSpazio || !chiaveCanale) return null;
    return this.sql
      .prepare(
        `SELECT c.* FROM canali c
           JOIN spazi s ON s.id = c.spazio
          WHERE s.chiave = ? AND c.chiave = ?`,
      )
      .get(chiaveSpazio, chiaveCanale) ?? null;
  }

  // -- Messaggi --------------------------------------------------------------

  scriviMessaggio({
    canale, autore, testo, rispondeA = null,
    origine = 'umano', provider = null, modello = null, richiestoDa = null,
  }) {
    const scrivi = this.sql.transaction(() => {
      const ins = this.sql
        .prepare(
          'INSERT INTO messaggi (canale, autore, testo, istante, rispondeA, origine, provider, modello, richiestoDa) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(canale, autore, testo, Date.now(), rispondeA, origine, provider, modello, richiestoDa);
      const id = Number(ins.lastInsertRowid);
      this.#indicizza(id, testo);
      return id;
    });
    return scrivi();
  }

  /**
   * L'indice della ricerca, tenuto allineato a mano.
   *
   * FTS5 con `content=''` non copia il testo e non ha nessun modo di
   * accorgersi da solo di un INSERT: ogni scrittura va rispecchiata qui. In
   * cambio l'indice pesa la meta' e non puo' andare fuori sincrono col
   * contenuto, perche' il contenuto non ce l'ha.
   */
  #indicizza(id, testo) {
    if (!this.ricercaDisponibile) return;
    this.sql.prepare('INSERT INTO ricerca(rowid, testo) VALUES (?, ?)').run(id, testo);
  }

  #disindicizza(id, testo) {
    if (!this.ricercaDisponibile) return;
    // Il protocollo delle tabelle senza contenuto: per togliere una riga
    // bisogna ridarle il testo esatto che era stato indicizzato.
    this.sql
      .prepare(`INSERT INTO ricerca(ricerca, rowid, testo) VALUES ('delete', ?, ?)`)
      .run(id, testo);
  }

  messaggio(id) {
    return this.sql.prepare('SELECT * FROM messaggi WHERE id = ?').get(id) ?? null;
  }

  /**
   * Una pagina di messaggi, dal piu' recente all'indietro.
   *
   * Il cursore e' l'id e non la data: gli id sono unici e monotoni, le date
   * no — due messaggi nello stesso millisecondo esistono, e con un cursore
   * temporale uno dei due sparirebbe dallo scorrimento.
   *
   * Gli eliminati non escono di qui. La riga resta in tabella — serve a non
   * riusare l'id e a tenere in piedi le risposte che la citavano — ma la
   * lapide "messaggio rimosso" la vede solo chi era in ascolto nel momento in
   * cui e' successo, mandata dall'evento. Chi apre la chat dopo trova la
   * conversazione senza buchi.
   *
   * Prima uscivano, e quelle righe grigie non se ne andavano piu': una chat
   * usata per un mese diventava un elenco di cose cancellate con qualche
   * messaggio in mezzo. Una cancellazione che lascia un segno permanente non
   * e' una cancellazione, e' una nota a margine che nessuno ha chiesto.
   */
  messaggi(canaleId, { prima = null, quanti = 50 } = {}) {
    const limite = Math.min(Math.max(1, quanti), 100);
    const righe = prima
      ? this.sql
          .prepare(
            'SELECT * FROM messaggi WHERE canale = ? AND eliminato = 0 AND id < ? ORDER BY id DESC LIMIT ?',
          )
          .all(canaleId, prima, limite)
      : this.sql
          .prepare(
            'SELECT * FROM messaggi WHERE canale = ? AND eliminato = 0 ORDER BY id DESC LIMIT ?',
          )
          .all(canaleId, limite);

    // Si leggono all'indietro e si consegnano in avanti: chi li mostra li
    // vuole in ordine di lettura, non di recupero.
    return righe.reverse().map((m) => this.#componiMessaggio(m));
  }

  #componiMessaggio(riga) {
    const autore = this.utente(riga.autore);
    return {
      id: riga.id,
      canale: riga.canale,
      autore: riga.autore,
      testo: riga.eliminato ? '' : riga.testo,
      istante: riga.istante,
      modificato: riga.modificato,
      rispondeA: riga.rispondeA,
      eliminato: !!riga.eliminato,
      origine: riga.origine ?? 'umano',
      provider: riga.provider ?? null,
      modello: riga.modello ?? null,
      richiestoDa: riga.richiestoDa ?? null,
      autoreTipo: autore?.tipo ?? 'umano',
      autoreNome: autore?.nome ?? null,
      autoreAvatar: autore?.avatar ?? null,
      allegati: riga.eliminato ? [] : this.allegatiDi(riga.id),
      reazioni: this.reazioniDi(riga.id),
    };
  }

  modificaMessaggio(id, testo) {
    const attuale = this.messaggio(id);
    if (!attuale || attuale.eliminato) return 0;

    const modifica = this.sql.transaction(() => {
      this.#disindicizza(id, attuale.testo);
      this.sql.prepare('UPDATE messaggi SET testo = ?, modificato = ? WHERE id = ?').run(testo, Date.now(), id);
      this.#indicizza(id, testo);
      return 1;
    });
    return modifica();
  }

  /**
   * Eliminare lascia il posto vuoto, non fa sparire la riga.
   *
   * Se la riga sparisse, sparirebbero anche le risposte che la citano — e chi
   * legge si troverebbe una conversazione con dei buchi che non tornano. Cosi'
   * invece resta un "messaggio rimosso" al posto giusto.
   */
  eliminaMessaggio(id) {
    const attuale = this.messaggio(id);
    if (!attuale || attuale.eliminato) return 0;

    const elimina = this.sql.transaction(() => {
      this.#disindicizza(id, attuale.testo);
      this.sql.prepare('UPDATE messaggi SET eliminato = 1, testo = \'\' WHERE id = ?').run(id);
      this.sql.prepare('DELETE FROM allegati WHERE messaggio = ?').run(id);
      this.sql.prepare('DELETE FROM reazioni WHERE messaggio = ?').run(id);
      return 1;
    });
    return elimina();
  }

  ultimoMessaggioDi(canaleId) {
    return this.sql
      .prepare('SELECT MAX(id) AS ultimo FROM messaggi WHERE canale = ?')
      .get(canaleId).ultimo ?? 0;
  }

  // -- Allegati --------------------------------------------------------------

  /** Un file caricato ma non ancora mandato: il messaggio arriva dopo. */
  aggiungiAllegato({ utente, nome, tipo, dimensione, impronta: hash, larghezza = null, altezza = null }) {
    const ins = this.sql
      .prepare(
        `INSERT INTO allegati (utente, nome, tipo, dimensione, impronta, larghezza, altezza, caricato)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(utente, nome, tipo, dimensione, hash, larghezza, altezza, Date.now());
    return Number(ins.lastInsertRowid);
  }

  /**
   * Attacca al messaggio i file che chi scrive aveva gia' caricato.
   *
   * Solo i propri, e solo quelli non ancora attaccati: senza queste due
   * condizioni l'id di un allegato altrui basterebbe per appropriarsene, o per
   * spostarlo da un messaggio a un altro.
   */
  legaAllegati(messaggioId, idAllegati, utenteId) {
    const lega = this.sql.prepare(
      'UPDATE allegati SET messaggio = ? WHERE id = ? AND utente = ? AND messaggio IS NULL',
    );
    let quanti = 0;
    for (const id of idAllegati) quanti += lega.run(messaggioId, id, utenteId).changes;
    return quanti;
  }

  /** Gli allegati caricati e mai mandati, piu' vecchi di un tot. */
  allegatiOrfani(primaDi) {
    return this.sql
      .prepare('SELECT id, impronta, nome FROM allegati WHERE messaggio IS NULL AND caricato < ?')
      .all(primaDi);
  }

  eliminaAllegato(id) {
    return this.sql.prepare('DELETE FROM allegati WHERE id = ?').run(id).changes;
  }

  allegato(id) {
    return this.sql.prepare('SELECT * FROM allegati WHERE id = ?').get(id) ?? null;
  }

  allegatiDi(messaggioId) {
    return this.sql
      .prepare('SELECT id, nome, tipo, dimensione, larghezza, altezza FROM allegati WHERE messaggio = ?')
      .all(messaggioId);
  }

  /** Vero se nessun altro messaggio usa quell'impronta: allora il file si puo' togliere. */
  improntaOrfana(hash) {
    return !this.sql.prepare('SELECT id FROM allegati WHERE impronta = ? LIMIT 1').get(hash);
  }

  // -- Reazioni --------------------------------------------------------------

  reagisci(messaggioId, utenteId, emoji) {
    this.sql
      .prepare('INSERT OR IGNORE INTO reazioni (messaggio, utente, emoji, istante) VALUES (?, ?, ?, ?)')
      .run(messaggioId, utenteId, emoji, Date.now());
  }

  togliReazione(messaggioId, utenteId, emoji) {
    return this.sql
      .prepare('DELETE FROM reazioni WHERE messaggio = ? AND utente = ? AND emoji = ?')
      .run(messaggioId, utenteId, emoji).changes;
  }

  reazioniDi(messaggioId) {
    const righe = this.sql
      .prepare('SELECT emoji, utente FROM reazioni WHERE messaggio = ? ORDER BY istante')
      .all(messaggioId);

    // Raggruppate per emoji, con chi le ha messe: l'interfaccia deve poter
    // dire "tu e altri due", e per farlo le serve l'elenco, non il conteggio.
    const per = new Map();
    for (const r of righe) {
      if (!per.has(r.emoji)) per.set(r.emoji, []);
      per.get(r.emoji).push(r.utente);
    }
    return [...per.entries()].map(([emoji, utenti]) => ({ emoji, utenti }));
  }

  // -- Non letti -------------------------------------------------------------

  segnaLetto(canaleId, utenteId, fino) {
    this.sql
      .prepare(
        `INSERT INTO letture (canale, utente, ultimoMessaggio) VALUES (?, ?, ?)
         ON CONFLICT(canale, utente) DO UPDATE SET ultimoMessaggio = MAX(ultimoMessaggio, excluded.ultimoMessaggio)`,
      )
      .run(canaleId, utenteId, fino);
  }

  /**
   * Fin dove il messaggio e' arrivato all'apparecchio di questa persona.
   *
   * "Arrivato" e non "letto": lo scrive il server quando riesce a consegnare
   * l'evento, o quando quella persona rilegge il canale. Non chiede niente al
   * client — un destinatario che non conferma sarebbe un destinatario che
   * decide da solo se risultare raggiungibile.
   */
  segnaConsegnato(canaleId, utenteId, fino) {
    if (!fino) return;
    this.sql
      .prepare(
        `INSERT INTO letture (canale, utente, ultimoConsegnato) VALUES (?, ?, ?)
         ON CONFLICT(canale, utente) DO UPDATE SET ultimoConsegnato = MAX(ultimoConsegnato, excluded.ultimoConsegnato)`,
      )
      .run(canaleId, utenteId, fino);
  }

  /**
   * Le due spunte, dal punto di vista di chi ha scritto.
   *
   * Sono i valori piu' *bassi* fra gli altri iscritti al canale, non i piu'
   * alti: in una conversazione a due la differenza non si vede, ma la regola
   * giusta e' quella — "consegnato" vuol dire a tutti, e con il massimo
   * basterebbe il piu' veloce a far comparire la spunta anche per chi non ha
   * ricevuto niente.
   *
   * Chi ha scritto non conta: le proprie spunte le mette gia' l'invio.
   */
  ricevuteDi(canaleId, autore) {
    const riga = this.sql
      .prepare(
        `SELECT MIN(COALESCE(l.ultimoConsegnato, 0)) AS consegnato,
                MIN(COALESCE(l.ultimoMessaggio, 0))  AS letto
           FROM iscritti i
           LEFT JOIN letture l ON l.canale = i.canale AND l.utente = i.utente
          WHERE i.canale = ? AND i.utente <> ?`,
      )
      .get(canaleId, autore);

    return { consegnato: riga?.consegnato ?? 0, letto: riga?.letto ?? 0 };
  }

  /** Quanti messaggi non letti per canale, per una persona sola. */
  nonLetti(utenteId, spazioId) {
    return this.sql
      .prepare(
        `SELECT c.id AS canale, COUNT(m.id) AS quanti
           FROM canali c
           LEFT JOIN letture l ON l.canale = c.id AND l.utente = ?
           LEFT JOIN messaggi m ON m.canale = c.id
                               AND m.id > COALESCE(l.ultimoMessaggio, 0)
                               AND m.autore <> ?
          WHERE c.spazio = ? AND c.tipo = 'testo'
          GROUP BY c.id`,
      )
      .all(utenteId, utenteId, spazioId);
  }

  // -- Ricerca ---------------------------------------------------------------

  /**
   * Cerca nel testo, dentro uno spazio o dentro un canale solo.
   *
   * La query dell'utente viene racchiusa fra virgolette: senza, un apostrofo o
   * un trattino verrebbero letti come sintassi di FTS5 e la ricerca fallirebbe
   * con un errore invece di non trovare niente. Chi cerca «l'officina» sta
   * cercando quella parola, non scrivendo un'espressione.
   */
  cerca({ spazio, canale = null, query, quanti = 40, utente = null, ruolo = 'membro' }) {
    if (!this.ricercaDisponibile) return [];
    const pulita = String(query).replace(/"/g, ' ').trim();
    if (!pulita) return [];

    const termine = `"${pulita}"`;
    const limite = Math.min(Math.max(1, quanti), 100);

    const righe = canale
      ? this.sql
          .prepare(
            `SELECT m.id FROM ricerca r JOIN messaggi m ON m.id = r.rowid
              WHERE ricerca MATCH ? AND m.canale = ? AND m.eliminato = 0
              ORDER BY m.id DESC LIMIT ?`,
          )
          .all(termine, canale, limite)
      : this.sql
          .prepare(
            `SELECT m.id FROM ricerca r
               JOIN messaggi m ON m.id = r.rowid
               JOIN canali c ON c.id = m.canale
              WHERE ricerca MATCH ? AND c.spazio = ? AND m.eliminato = 0
              ORDER BY m.id DESC LIMIT ?`,
          )
          .all(termine, spazio, limite);

    const messaggi = righe.map((r) => this.#componiMessaggio(this.messaggio(r.id)));
    if (utente === null) return messaggi;

    // Un canale che non si puo' vedere non si puo' nemmeno trovare cercando
    // una parola: senza questo filtro il campo di ricerca sarebbe la porta di
    // servizio di ogni permesso negato.
    const chi = typeof utente === 'object' ? utente : { id: utente, ruolo: ruolo ?? 'membro' };
    const visibili = new Set(this.canaliVisibili(spazio, chi, ruolo).map((c) => c.id));
    return messaggi.filter((m) => visibili.has(m.canale));

  }

  /** L'elenco completo dei permessi che questa versione del server conosce. */
  get catalogoPermessi() {
    return PERMESSI;
  }
}

/** Da riga di join a profilo, per le liste di persone. */
function profiloDaRiga(riga) {
  return { id: riga.id, nome: riga.nome, utente: riga.utente, avatar: riga.avatar };
}

// Confronto a tempo costante fra due stringhe della stessa lunghezza. Su
// stringhe di lunghezza diversa restituisce false senza confrontare: la
// lunghezza non e' un segreto.
export function confrontoCostante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
