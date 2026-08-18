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

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { RUOLI } from './config.mjs';
import { SCHEMA, SCHEMA_RICERCA } from './schema.mjs';

export const impronta = (valore) => createHash('sha256').update(valore, 'utf8').digest('hex');

// base64url senza padding: entra in una URL e in un campo di testo senza
// sorprese, e 32 byte sono 256 bit di entropia.
const segretoNuovo = (byte = 32) => randomBytes(byte).toString('base64url');

const ora = () => Math.floor(Date.now() / 1000);

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
  ['utenti', 'utente', 'TEXT'],
  ['utenti', 'password', 'TEXT'],
  ['utenti', 'avatar', 'TEXT'],
  ['token', 'dispositivo', 'TEXT'],
  ['inviti', 'usiMax', 'INTEGER NOT NULL DEFAULT 1'],
  ['inviti', 'usi', 'INTEGER NOT NULL DEFAULT 0'],
  ['inviti', 'creatoDa', 'INTEGER'],
  ['canali', 'privato', 'INTEGER NOT NULL DEFAULT 0'],
];

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

    this.#migraStanze();
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

      // Chi entra adesso entra in tutti gli spazi che esistono. Su
      // un'istanza di casa e' cio' che ci si aspetta: l'invito e' gia' il
      // filtro, e trovarsi dentro senza nessun canale visibile sembrerebbe
      // un guasto.
      for (const s of this.sql.prepare('SELECT id FROM spazi').all()) {
        this.sql
          .prepare('INSERT OR IGNORE INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
          .run(s.id, utenteId, riga.ruolo === 'admin' ? 'admin' : 'membro', ora());
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

  /** Nome visibile e foto: non toccano le credenziali. */
  aggiornaProfilo(utenteId, { nome, avatar }) {
    const attuale = this.utente(utenteId);
    if (!attuale) return 0;
    return this.sql
      .prepare('UPDATE utenti SET nome = ?, avatar = ? WHERE id = ?')
      .run(
        nome === undefined ? attuale.nome : nome,
        avatar === undefined ? attuale.avatar : avatar,
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
  elencoProfili() {
    return this.sql
      .prepare('SELECT id, nome, utente, avatar FROM utenti WHERE attivo = 1 ORDER BY id')
      .all();
  }

  sessioniDi(utenteId) {
    return this.sql
      .prepare(
        `SELECT id, creato, ultimoUso, dispositivo, revocato
           FROM token WHERE utente = ? AND revocato = 0 ORDER BY creato DESC`,
      )
      .all(utenteId);
  }

  utenteDaToken(token) {
    if (!token) return null;
    const riga = this.sql
      .prepare(
        `SELECT t.id AS tokenId, t.revocato,
                u.id, u.nome, u.utente, u.ruolo, u.attivo, u.avatar, u.password
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

  creaSpazio({ nome, icona = null, creatoDa = null }) {
    const chiave = chiaveDa(nome);
    if (this.sql.prepare('SELECT id FROM spazi WHERE chiave = ?').get(chiave)) {
      return { errore: `esiste gia' uno spazio con la chiave "${chiave}"` };
    }

    const crea = this.sql.transaction(() => {
      const ins = this.sql
        .prepare('INSERT INTO spazi (chiave, nome, icona, creato, creatoDa) VALUES (?, ?, ?, ?, ?)')
        .run(chiave, nome, icona, ora(), creatoDa);
      const id = Number(ins.lastInsertRowid);

      if (creatoDa) {
        this.sql
          .prepare('INSERT INTO membri (spazio, utente, ruolo, entrato) VALUES (?, ?, ?, ?)')
          .run(id, creatoDa, 'admin', ora());
      }

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

  spazioPerChiave(chiave) {
    return this.sql.prepare('SELECT * FROM spazi WHERE chiave = ?').get(chiave) ?? null;
  }

  /** Gli spazi a cui una persona appartiene, in ordine di ingresso. */
  spaziDi(utenteId) {
    return this.sql
      .prepare(
        `SELECT s.*, m.ruolo AS ruoloMio
           FROM spazi s JOIN membri m ON m.spazio = s.id
          WHERE m.utente = ? ORDER BY m.entrato, s.id`,
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
  }

  togliMembro(spazioId, utenteId) {
    return this.sql
      .prepare('DELETE FROM membri WHERE spazio = ? AND utente = ?')
      .run(spazioId, utenteId).changes;
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

  /**
   * Che ruolo ha questa persona in questo spazio.
   *
   * Un admin dell'istanza e' admin ovunque: su una macchina di casa il
   * proprietario del NAS puo' comunque leggere il database, quindi fingere che
   * non possa moderare uno spazio sarebbe una recita.
   */
  ruoloNelloSpazio(spazioId, utente) {
    if (utente.ruolo === 'admin') return 'admin';
    const riga = this.sql
      .prepare('SELECT ruolo FROM membri WHERE spazio = ? AND utente = ?')
      .get(spazioId, utente.id);
    return riga?.ruolo ?? null;
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

  eliminaCategoria(id) {
    // I canali dentro non si perdono: la ON DELETE SET NULL li lascia dove
    // sono, senza categoria, in cima all'elenco. Cancellare un raggruppamento
    // non deve mai cancellare quello che raggruppa.
    return this.sql.prepare('DELETE FROM categorie WHERE id = ?').run(id).changes;
  }

  creaCanale(spazioId, { nome, tipo, categoria = null, argomento = '', soloAscolto = false, privato = false }) {
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
        `INSERT INTO canali (spazio, categoria, chiave, nome, tipo, argomento, posizione, soloAscolto, privato, creato)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );

    return { canale: this.canale(Number(ins.lastInsertRowid)) };
  }

  canale(id) {
    const riga = this.sql.prepare('SELECT * FROM canali WHERE id = ?').get(id);
    return riga ? { ...riga, soloAscolto: !!riga.soloAscolto, privato: !!riga.privato } : null;
  }

  canaliDi(spazioId) {
    return this.sql
      .prepare('SELECT * FROM canali WHERE spazio = ? ORDER BY posizione, id')
      .all(spazioId)
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
  canaliVisibili(spazioId, utenteId, ruolo) {
    const tutti = this.canaliDi(spazioId);
    if (ruolo === 'admin') return tutti;
    const miei = new Set(this.canaliIscritto(utenteId));
    return tutti.filter((c) => !c.privato || miei.has(c.id));
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

  aggiornaCanale(id, { nome, argomento, categoria, posizione, soloAscolto, privato }) {
    const attuale = this.canale(id);
    if (!attuale) return 0;
    return this.sql
      .prepare(
        `UPDATE canali SET nome = ?, argomento = ?, categoria = ?, posizione = ?, soloAscolto = ?, privato = ?
          WHERE id = ?`,
      )
      .run(
        nome ?? attuale.nome,
        argomento ?? attuale.argomento,
        categoria === undefined ? attuale.categoria : categoria,
        posizione ?? attuale.posizione,
        (soloAscolto === undefined ? attuale.soloAscolto : soloAscolto) ? 1 : 0,
        (privato === undefined ? attuale.privato : privato) ? 1 : 0,
        id,
      ).changes;
  }

  eliminaCanale(id) {
    return this.sql.prepare('DELETE FROM canali WHERE id = ?').run(id).changes;
  }

  /** La chiave con cui la SFU conosce un canale vocale: spazio e canale insieme. */
  chiaveSfu(canale) {
    const spazio = this.spazio(canale.spazio);
    return `${spazio.chiave}--${canale.chiave}`;
  }

  // -- Messaggi --------------------------------------------------------------

  scriviMessaggio({ canale, autore, testo, rispondeA = null }) {
    const scrivi = this.sql.transaction(() => {
      const ins = this.sql
        .prepare('INSERT INTO messaggi (canale, autore, testo, istante, rispondeA) VALUES (?, ?, ?, ?, ?)')
        .run(canale, autore, testo, Date.now(), rispondeA);
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
   */
  messaggi(canaleId, { prima = null, quanti = 50 } = {}) {
    const limite = Math.min(Math.max(1, quanti), 100);
    const righe = prima
      ? this.sql
          .prepare('SELECT * FROM messaggi WHERE canale = ? AND id < ? ORDER BY id DESC LIMIT ?')
          .all(canaleId, prima, limite)
      : this.sql
          .prepare('SELECT * FROM messaggi WHERE canale = ? ORDER BY id DESC LIMIT ?')
          .all(canaleId, limite);

    // Si leggono all'indietro e si consegnano in avanti: chi li mostra li
    // vuole in ordine di lettura, non di recupero.
    return righe.reverse().map((m) => this.#componiMessaggio(m));
  }

  #componiMessaggio(riga) {
    return {
      id: riga.id,
      canale: riga.canale,
      autore: riga.autore,
      testo: riga.eliminato ? '' : riga.testo,
      istante: riga.istante,
      modificato: riga.modificato,
      rispondeA: riga.rispondeA,
      eliminato: !!riga.eliminato,
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
    if (ruolo === 'admin' || utente === null) return messaggi;

    // I canali privati in cui non si e' stati invitati non esistono, e non
    // esistono neanche in una ricerca: senza questo filtro basterebbe cercare
    // una parola per leggere cio' che si dicono gli altri.
    const nascosti = new Set(
      this.sql
        .prepare(
          `SELECT c.id FROM canali c
            WHERE c.spazio = ? AND c.privato = 1
              AND NOT EXISTS (SELECT 1 FROM iscritti i WHERE i.canale = c.id AND i.utente = ?)`,
        )
        .all(spazio, utente)
        .map((r) => r.id),
    );
    return messaggi.filter((m) => !nascosti.has(m.canale));
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
