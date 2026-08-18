// schema.mjs - la forma dei dati.
//
// Sta in un file suo perche' e' la cosa che si va a rileggere piu' spesso, e
// cercarla in mezzo ai metodi che la usano e' fastidioso. Qui c'e' solo il
// "cosa"; il "come si legge e si scrive" sta in db.mjs.

export const SCHEMA = `
-- Le persone -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS utenti (
  id      INTEGER PRIMARY KEY,
  nome    TEXT    NOT NULL,
  ruolo   TEXT    NOT NULL,
  creato  INTEGER NOT NULL,
  attivo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS token (
  id        INTEGER PRIMARY KEY,
  utente    INTEGER NOT NULL REFERENCES utenti(id),
  impronta  TEXT    NOT NULL UNIQUE,
  creato    INTEGER NOT NULL,
  ultimoUso INTEGER,
  revocato  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_token_impronta ON token(impronta);

CREATE TABLE IF NOT EXISTS inviti (
  id       INTEGER PRIMARY KEY,
  impronta TEXT    NOT NULL UNIQUE,
  nome     TEXT    NOT NULL,
  ruolo    TEXT    NOT NULL,
  creato   INTEGER NOT NULL,
  scade    INTEGER NOT NULL,
  usato    INTEGER,
  utente   INTEGER REFERENCES utenti(id)
);

-- I posti ---------------------------------------------------------------------
--
-- Uno spazio e' quello che Discord chiama "server": un gruppo di persone con i
-- suoi canali. Le categorie servono solo a raggruppare nella colonna: non
-- portano permessi, e un canale senza categoria e' legittimo — finisce in cima.

CREATE TABLE IF NOT EXISTS spazi (
  id       INTEGER PRIMARY KEY,
  chiave   TEXT    NOT NULL UNIQUE,
  nome     TEXT    NOT NULL,
  icona    TEXT,
  creato   INTEGER NOT NULL,
  creatoDa INTEGER REFERENCES utenti(id)
);

CREATE TABLE IF NOT EXISTS membri (
  spazio  INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  utente  INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  ruolo   TEXT    NOT NULL DEFAULT 'membro',
  entrato INTEGER NOT NULL,
  PRIMARY KEY (spazio, utente)
);

CREATE TABLE IF NOT EXISTS categorie (
  id        INTEGER PRIMARY KEY,
  spazio    INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  nome      TEXT    NOT NULL,
  posizione INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS canali (
  id          INTEGER PRIMARY KEY,
  spazio      INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  categoria   INTEGER REFERENCES categorie(id) ON DELETE SET NULL,
  chiave      TEXT    NOT NULL,
  nome        TEXT    NOT NULL,
  tipo        TEXT    NOT NULL,           -- 'testo' | 'voce'
  argomento   TEXT    NOT NULL DEFAULT '',
  posizione   INTEGER NOT NULL DEFAULT 0,
  -- Solo per i canali vocali: parlano gli admin, gli altri guardano.
  soloAscolto INTEGER NOT NULL DEFAULT 0,
  creato      INTEGER NOT NULL,
  UNIQUE (spazio, chiave)
);
CREATE INDEX IF NOT EXISTS idx_canali_spazio ON canali(spazio);

-- Chi e' stato invitato in un canale privato.
--
-- Un canale con privato = 0 non ha righe qui e lo vedono tutti i membri
-- dello spazio: e' il caso normale, e non costa niente. Con 'privato = 1'
-- questa tabella e' l'elenco di chi lo vede — chi non c'e' dentro non sa
-- nemmeno che quel canale esiste.
CREATE TABLE IF NOT EXISTS iscritti (
  canale     INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  utente     INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  invitatoDa INTEGER REFERENCES utenti(id),
  entrato    INTEGER NOT NULL,
  PRIMARY KEY (canale, utente)
);
CREATE INDEX IF NOT EXISTS idx_iscritti_utente ON iscritti(utente);

-- Le amicizie.
--
-- Una riga sola per coppia, con l'id piu' piccolo sempre in 'uno': due righe
-- speculari sarebbero due verita' che prima o poi divergono, e ogni domanda
-- ("siamo amici?") diventerebbe due interrogazioni invece di una. Da che parte
-- sia partita la richiesta lo dice 'chiedente', che e' l'unica cosa per cui
-- serve saperlo: mostrare "ti ha chiesto" invece di "gli hai chiesto".
CREATE TABLE IF NOT EXISTS amicizie (
  uno       INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  due       INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  chiedente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  stato     TEXT    NOT NULL,          -- 'attesa' | 'amici'
  chiesto   INTEGER NOT NULL,
  risposto  INTEGER,
  PRIMARY KEY (uno, due)
);

-- Le cose dette ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messaggi (
  id         INTEGER PRIMARY KEY,
  canale     INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  autore     INTEGER NOT NULL REFERENCES utenti(id),
  testo      TEXT    NOT NULL DEFAULT '',
  istante    INTEGER NOT NULL,
  modificato INTEGER,
  -- Il messaggio a cui questo risponde. Se quello viene cancellato resta il
  -- riferimento vuoto, e la citazione diventa "messaggio rimosso" invece di
  -- far sparire anche la risposta.
  rispondeA  INTEGER REFERENCES messaggi(id) ON DELETE SET NULL,
  eliminato  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messaggi_canale ON messaggi(canale, id DESC);

-- Il file viene caricato *prima* del messaggio che lo porta: si trascina
-- un'immagine, parte il caricamento, e intanto si finisce di scrivere. Per
-- questo "messaggio" puo' essere nullo: vuol dire caricato ma non ancora
-- mandato. Gli avanzi li spazza via un giro periodico.
CREATE TABLE IF NOT EXISTS allegati (
  id         INTEGER PRIMARY KEY,
  messaggio  INTEGER REFERENCES messaggi(id) ON DELETE CASCADE,
  utente     INTEGER NOT NULL REFERENCES utenti(id),
  nome       TEXT    NOT NULL,
  tipo       TEXT    NOT NULL,
  dimensione INTEGER NOT NULL,
  -- Il nome sul disco e' l'impronta del contenuto: due persone
  -- che mandano lo stesso file occupano lo spazio di uno.
  impronta   TEXT    NOT NULL,
  larghezza  INTEGER,
  altezza    INTEGER,
  caricato   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allegati_messaggio ON allegati(messaggio);

CREATE TABLE IF NOT EXISTS reazioni (
  messaggio INTEGER NOT NULL REFERENCES messaggi(id) ON DELETE CASCADE,
  utente    INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  emoji     TEXT    NOT NULL,
  istante   INTEGER NOT NULL,
  PRIMARY KEY (messaggio, utente, emoji)
);

-- Fin dove ognuno ha letto, per il pallino dei non letti.
CREATE TABLE IF NOT EXISTS letture (
  canale          INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  utente          INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  ultimoMessaggio INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canale, utente)
);
`;

/**
 * L'indice per la ricerca.
 *
 * Sta a parte perche' e' una tabella virtuale FTS5, e non tutte le build di
 * SQLite ce l'hanno. Quella dentro better-sqlite3 si', ma se un giorno il
 * modulo venisse compilato senza, il resto del programma deve continuare a
 * funzionare — solo senza ricerca. Per questo la creazione sta in un try.
 *
 * `content=''` la rende un indice puro, senza copia del testo: i messaggi
 * restano nella loro tabella e qui c'e' solo cio' che serve a trovarli. Meta'
 * dello spazio, e nessun rischio che le due copie divergano.
 */
export const SCHEMA_RICERCA = `
CREATE VIRTUAL TABLE IF NOT EXISTS ricerca USING fts5(
  testo,
  content='',
  tokenize='unicode61 remove_diacritics 2'
);
`;
