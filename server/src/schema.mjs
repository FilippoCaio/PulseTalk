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

CREATE TABLE IF NOT EXISTS bot_installazioni (
  spazio       INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  bot          INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  installatoDa INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
  installato   INTEGER NOT NULL,
  attivo       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (spazio, bot)
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

-- I codici usa e getta mandati per posta ---------------------------------------
--
-- Due usi, una tabella: 'conferma' certifica che un indirizzo appartiene a chi
-- lo ha scritto, 'recupero' rimette in piedi una password dimenticata. Stanno
-- insieme perche' hanno le stesse regole — scadono, valgono una volta sola, e
-- si consumano contando i tentativi — e due tabelle vorrebbero dire due copie
-- di quelle regole, che prima o poi divergono. A divergere e' sempre quella
-- che concede.
--
-- Il codice non si salva in chiaro, come gli inviti: resta solo la sua
-- impronta. Chi legge questo file non trova niente con cui entrare.
--
-- La colonna indirizzo c'e' e non si ricava dall'utente, ed e' il punto della
-- conferma: il codice certifica *quell'indirizzo li'*, che al momento
-- dell'invio non e' ancora quello dell'account — se lo fosse, si starebbe
-- confermando una cosa gia' data per buona.
--
-- La colonna tentativi e' il controllo che conta davvero. Un codice di sei
-- caratteri e' corto abbastanza da poter essere digitato da una persona, e
-- quindi corto abbastanza da poter essere indovinato da un programma: e' il
-- tetto sui tentativi, non la lunghezza, a rendere la cosa impraticabile.
CREATE TABLE IF NOT EXISTS codici (
  id        INTEGER PRIMARY KEY,
  utente    INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  scopo     TEXT    NOT NULL,
  impronta  TEXT    NOT NULL,
  indirizzo TEXT    NOT NULL,
  creato    INTEGER NOT NULL,
  scade     INTEGER NOT NULL,
  usato     INTEGER,
  tentativi INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codici_ricerca ON codici(scopo, impronta);
CREATE INDEX IF NOT EXISTS idx_codici_utente ON codici(utente, scopo);

-- Entrare da un dispositivo nuovo senza digitare la password ------------------
--
-- Si guarda il codice su un aggeggio dove si e' gia' dentro e lo si scrive su
-- quello nuovo. E' l'unica strada in cui la password non passa da una
-- tastiera: e su un telefono, dove digitare venti caratteri e' un supplizio,
-- e' anche la ragione per cui le password sul telefono diventano corte.
--
-- Perche' un codice piu' lungo di quelli mandati per posta. Quelli si cercano
-- insieme all'indirizzo, che dice gia' di chi sono; questo si cerca da solo,
-- perche' il dispositivo nuovo non sa ancora niente di nessuno. Senza un
-- secondo dato che restringa la ricerca, l'unica difesa e' l'entropia: otto
-- caratteri invece di sei, e due minuti invece di un quarto d'ora.
--
-- Vive appena il tempo di essere ribattuto, ed e' la parte che lo rende
-- sicuro: un codice che apre un account e resta valido un pomeriggio e' un
-- codice che qualcuno legge da sopra la spalla e usa dopo.
CREATE TABLE IF NOT EXISTS accoppiamenti (
  id       INTEGER PRIMARY KEY,
  utente   INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  impronta TEXT    NOT NULL UNIQUE,
  creato   INTEGER NOT NULL,
  scade    INTEGER NOT NULL,
  usato    INTEGER
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
  creatoDa    INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
  -- NULL significa permanente; altrimenti e' un istante Unix in secondi.
  scade       INTEGER,
  UNIQUE (spazio, chiave)
);
CREATE INDEX IF NOT EXISTS idx_canali_spazio ON canali(spazio);
-- L'indice sulla scadenza nasce in TalkDb.#aggiorna, dopo l'eventuale
-- ALTER TABLE: un database creato prima dei canali temporanei non possiede
-- ancora la colonna quando questo schema viene eseguito.

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

CREATE TABLE IF NOT EXISTS trascrizioni (
  id          INTEGER PRIMARY KEY,
  canale      INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  richiestoDa INTEGER NOT NULL REFERENCES utenti(id),
  provider    TEXT NOT NULL,
  stato       TEXT NOT NULL,
  creato      INTEGER NOT NULL,
  avviato     INTEGER,
  chiuso      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trascrizioni_canale ON trascrizioni(canale, id DESC);

CREATE TABLE IF NOT EXISTS consensi_trascrizione (
  trascrizione INTEGER NOT NULL REFERENCES trascrizioni(id) ON DELETE CASCADE,
  utente       INTEGER NOT NULL REFERENCES utenti(id),
  consenso     INTEGER,
  istante      INTEGER,
  PRIMARY KEY (trascrizione, utente)
);

CREATE TABLE IF NOT EXISTS segmenti_trascrizione (
  id            INTEGER PRIMARY KEY,
  trascrizione  INTEGER NOT NULL REFERENCES trascrizioni(id) ON DELETE CASCADE,
  parlante      INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
  testo         TEXT NOT NULL,
  definitivo    INTEGER NOT NULL DEFAULT 1,
  creato        INTEGER NOT NULL
);

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

-- I ruoli, e cosa aprono -------------------------------------------------------
--
-- Un ruolo vive dentro a uno spazio e non esce da li': lo stesso nome in due
-- spazi sono due righe diverse, con permessi diversi, e chi comanda a casa
-- propria non comanda a casa d'altri. E' l'unica regola che rende sicuro
-- lasciar creare uno spazio a chiunque.
--
-- 'permessi' e' un JSON con dentro un elenco di stringhe. Non una maschera di
-- bit: il perche' sta in permessi/catalogo.mjs.
--
-- 'tipo' distingue i tre ruoli che non si cancellano — 'admin', 'master',
-- 'base' — da quelli inventati da chi amministra ('custom'). Il ruolo 'base'
-- ce l'hanno tutti i membri senza che nessuno glielo assegni: e' il pavimento,
-- e per questo non compare mai in ruoli_membri.

CREATE TABLE IF NOT EXISTS ruoli (
  id        INTEGER PRIMARY KEY,
  spazio    INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  nome      TEXT    NOT NULL,
  colore    TEXT,
  permessi  TEXT    NOT NULL DEFAULT '[]',
  priorita  INTEGER NOT NULL DEFAULT 0,
  tipo      TEXT    NOT NULL DEFAULT 'custom',
  creato    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ruoli_spazio ON ruoli(spazio, priorita DESC);

CREATE TABLE IF NOT EXISTS ruoli_membri (
  ruolo  INTEGER NOT NULL REFERENCES ruoli(id) ON DELETE CASCADE,
  utente INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  dato   INTEGER NOT NULL,
  PRIMARY KEY (ruolo, utente)
);
CREATE INDEX IF NOT EXISTS idx_ruoli_membri_utente ON ruoli_membri(utente);

-- Le eccezioni, per categoria e per canale.
--
-- Una riga dice, per un ruolo o per una persona sola, cosa aggiungere e cosa
-- togliere rispetto a cio' che si aveva un anello prima nella catena. Due
-- elenchi separati e non un valore per permesso: "non detto" e "negato" sono
-- cose diverse, e schiacciarle su un booleano toglierebbe la possibilita' di
-- lasciar decidere al livello di sopra.
CREATE TABLE IF NOT EXISTS permessi_override (
  id        INTEGER PRIMARY KEY,
  ambito    TEXT    NOT NULL,           -- 'categoria' | 'canale'
  bersaglio INTEGER NOT NULL,
  tipo      TEXT    NOT NULL,           -- 'ruolo' | 'utente'
  soggetto  INTEGER NOT NULL,
  consenti  TEXT    NOT NULL DEFAULT '[]',
  nega      TEXT    NOT NULL DEFAULT '[]',
  UNIQUE (ambito, bersaglio, tipo, soggetto)
);
CREATE INDEX IF NOT EXISTS idx_override_bersaglio ON permessi_override(ambito, bersaglio);

-- Chi e' stato messo alla porta e non deve rientrare.
CREATE TABLE IF NOT EXISTS bandi (
  spazio  INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  utente  INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  motivo  TEXT    NOT NULL DEFAULT '',
  da      INTEGER REFERENCES utenti(id),
  istante INTEGER NOT NULL,
  PRIMARY KEY (spazio, utente)
);

-- Gli inviti a uno spazio ------------------------------------------------------
--
-- Cosa diversa dagli inviti dell'istanza (tabella 'inviti'), che fanno nascere
-- un account. Questi fanno entrare in uno spazio un account che esiste gia', e
-- possono crearli anche i membri normali se il permesso c'e'. Come sempre, il
-- codice non si salva in chiaro: resta solo la sua impronta.
CREATE TABLE IF NOT EXISTS inviti_spazio (
  id       INTEGER PRIMARY KEY,
  spazio   INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  impronta TEXT    NOT NULL UNIQUE,
  creatoDa INTEGER REFERENCES utenti(id),
  creato   INTEGER NOT NULL,
  scade    INTEGER NOT NULL,
  usiMax   INTEGER NOT NULL DEFAULT 0,   -- 0: senza limite
  usi      INTEGER NOT NULL DEFAULT 0,
  ruolo    INTEGER REFERENCES ruoli(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inviti_spazio ON inviti_spazio(spazio);

-- Gli eventi -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eventi_spazio (
  id          INTEGER PRIMARY KEY,
  spazio      INTEGER NOT NULL REFERENCES spazi(id) ON DELETE CASCADE,
  canale      INTEGER REFERENCES canali(id) ON DELETE SET NULL,
  titolo      TEXT    NOT NULL,
  descrizione TEXT    NOT NULL DEFAULT '',
  inizio      INTEGER NOT NULL,
  fine        INTEGER,
  creatoDa    INTEGER REFERENCES utenti(id),
  creato      INTEGER NOT NULL,
  stato       TEXT    NOT NULL DEFAULT 'programmato'
);
CREATE INDEX IF NOT EXISTS idx_eventi_spazio ON eventi_spazio(spazio, inizio);

-- Le restrizioni vocali -------------------------------------------------------
--
-- Camera spenta d'ufficio, condivisione tolta, microfono muto, cuffie mute.
-- Sono stato e non messaggi: chi si disconnette e rientra le ritrova, e un
-- riavvio del server non le perde. Un "muto" che valesse solo per la traccia
-- viva sarebbe una moderazione che si aggira uscendo e rientrando dalla
-- stanza, cioe' nessuna moderazione.
--
-- La chiave e' canale + utente + genere: le restrizioni vivono dentro a un
-- canale vocale e non nello spazio, perche' e' li' che si parla e perche' un
-- provvedimento preso in una stanza non deve seguire nessuno in tutte le
-- altre.
--
-- La colonna evento dice sotto quale autorita' e' stata imposta. Nulla vuol
-- dire "un amministratore dello spazio", e allora dura finche' qualcuno non la
-- toglie. Valorizzata vuol dire "l'organizzatore di quell'evento li'", e allora
-- vale quanto l'evento: alla sua chiusura decade da sola. Senza questa colonna
-- un potere temporaneo lascerebbe conseguenze permanenti.
--
-- La colonna daUtente e' chi l'ha imposta, e serve a chi la subisce: "non puoi
-- accendere il microfono" senza un nome accanto e' un guasto, con un nome
-- accanto e' una decisione a cui si puo' rispondere.
CREATE TABLE IF NOT EXISTS restrizioni_voce (
  id       INTEGER PRIMARY KEY,
  canale   INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  utente   INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  genere   TEXT    NOT NULL,
  evento   INTEGER REFERENCES eventi_spazio(id) ON DELETE CASCADE,
  daUtente INTEGER REFERENCES utenti(id) ON DELETE SET NULL,
  istante  INTEGER NOT NULL,
  UNIQUE (canale, utente, genere)
);
CREATE INDEX IF NOT EXISTS idx_restrizioni_canale ON restrizioni_voce(canale);
CREATE INDEX IF NOT EXISTS idx_restrizioni_utente ON restrizioni_voce(utente);

CREATE TABLE IF NOT EXISTS eventi_interesse (
  evento  INTEGER NOT NULL REFERENCES eventi_spazio(id) ON DELETE CASCADE,
  utente  INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  stato   TEXT    NOT NULL DEFAULT 'interessato',
  istante INTEGER NOT NULL,
  PRIMARY KEY (evento, utente)
);

-- I messaggi diretti -----------------------------------------------------------
--
-- Non hanno tabelle proprie, ed e' voluto. Una conversazione fra due persone e'
-- un canale privato dentro a uno spazio di sistema che non compare in nessuna
-- barra laterale: cosi' messaggi, allegati, reazioni, non letti e ricerca sono
-- gli stessi di sempre, con le stesse rotte e le stesse correzioni gia' fatte.
-- Qui sotto resta solo l'accoppiamento fra le due persone e il loro canale.
CREATE TABLE IF NOT EXISTS conversazioni (
  id      INTEGER PRIMARY KEY,
  uno     INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  due     INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  canale  INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  creato  INTEGER NOT NULL,
  UNIQUE (uno, due)
);
CREATE INDEX IF NOT EXISTS idx_conversazioni_canale ON conversazioni(canale);

-- Le sessioni condivise: guardare un video insieme, ascoltare insieme ----------
--
-- Una riga per canale e per tipo. Lo stato e' un JSON perche' e' diverso per
-- ogni tipo di sessione e perche' cambia dieci volte al minuto: una colonna per
-- campo vorrebbe dire una migrazione a ogni provider aggiunto. Cio' che conta
-- e' che l'orologio sia questo, del server, e non quello di chi preme play.
CREATE TABLE IF NOT EXISTS sessioni_media (
  id         INTEGER PRIMARY KEY,
  canale     INTEGER NOT NULL REFERENCES canali(id) ON DELETE CASCADE,
  tipo       TEXT    NOT NULL,          -- 'youtube' | 'musica'
  provider   TEXT,                      -- per la musica: 'spotify' | ...
  host       INTEGER REFERENCES utenti(id),
  stato      TEXT    NOT NULL DEFAULT '{}',
  creato     INTEGER NOT NULL,
  aggiornato INTEGER NOT NULL,
  UNIQUE (canale, tipo)
);

CREATE TABLE IF NOT EXISTS coda_media (
  id          INTEGER PRIMARY KEY,
  sessione    INTEGER NOT NULL REFERENCES sessioni_media(id) ON DELETE CASCADE,
  riferimento TEXT    NOT NULL,
  titolo      TEXT    NOT NULL DEFAULT '',
  durata      INTEGER,
  meta        TEXT,
  aggiuntoDa  INTEGER REFERENCES utenti(id),
  posizione   INTEGER NOT NULL DEFAULT 0,
  suonato     INTEGER NOT NULL DEFAULT 0,
  aggiunto    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coda_sessione ON coda_media(sessione, posizione);

-- I collegamenti a servizi di terzi (Spotify, e domani altri).
--
-- Il gettone di rinnovo e' la chiave vera: con quello si ottiene un accesso
-- nuovo per sempre, finche' la persona non revoca. Sta qui e non
-- nell'applicazione perche' il rinnovo va fatto da un posto che conosce il
-- segreto del client, e quel segreto dentro a un'app installata sarebbe
-- pubblico.
CREATE TABLE IF NOT EXISTS collegamenti (
  utente    INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  provider  TEXT    NOT NULL,
  accesso   TEXT,
  rinnovo   TEXT,
  scade     INTEGER,
  ambiti    TEXT    NOT NULL DEFAULT '',
  identita  TEXT,
  nome      TEXT,
  prodotto  TEXT,
  collegato INTEGER NOT NULL,
  PRIMARY KEY (utente, provider)
);

-- Le impostazioni dell'istanza -----------------------------------------------
--
-- Le chiavi dei servizi esterni, scritte dal pannello di amministrazione invece
-- che dall'ambiente del container. La chiave e' il nome della variabile
-- d'ambiente corrispondente, cosi' il pannello e il docker-compose parlano la
-- stessa lingua; il valore vince su quello dell'ambiente, e cancellare la riga
-- fa riemergere quello del container.
--
-- Non c'e' nessuna cifratura, ed e' una posizione: chi legge questo file legge
-- anche i gettoni di sessione e le impronte degli inviti, e una chiave cifrata
-- con una chiave custodita nello stesso file non e' protetta, e' solo scomoda.
-- Cio' che protegge questa tabella e' il disco su cui sta.
-- La chiave AI di una singola persona.
--
-- Esiste solo quando l'amministratore ha scelto che ognuno porti la propria
-- (vedi TALK_AI_CHIAVI). Sta sul server e non sul computer di chi la scrive
-- perche' e' il server a chiamare il modello: la trascrizione arriva qui dentro
-- come audio e riparte come richiesta, e un client che parlasse da solo con
-- OpenAI dovrebbe mandarci l'audio due volte.
--
-- Una riga per persona: chi la cancella torna a non avere l'AI, o a ricadere
-- sulla chiave di casa se la modalita' e' «mista».
CREATE TABLE IF NOT EXISTS chiavi_ai (
  utente     INTEGER PRIMARY KEY REFERENCES utenti(id) ON DELETE CASCADE,
  baseUrl    TEXT,
  apiKey     TEXT    NOT NULL,
  chatModel  TEXT,
  sttModel   TEXT,
  imageModel TEXT,
  aggiornato INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS impostazioni_istanza (
  chiave     TEXT PRIMARY KEY,
  valore     TEXT    NOT NULL,
  aggiornato INTEGER NOT NULL,
  da         INTEGER REFERENCES utenti(id) ON DELETE SET NULL
);

-- Le ore nei canali vocali ----------------------------------------------------
--
-- Un totale per persona e per giorno, e nient'altro: non c'e' una riga per
-- ingresso, non c'e' un'ora d'inizio e una di fine. Il contatore aggiunge un
-- minuto per volta a chi e' dentro (vedi ore-lavoro.mjs), e questa forma e' la
-- conseguenza di quella scelta - non si puo' perdere una sessione aperta
-- perche' non esistono sessioni.
--
-- Il giorno e' testo AAAA-MM-GG e non un istante: e' cio' su cui si
-- raggruppa, si ordina e si confronta, e in SQLite l'ordinamento
-- alfabetico di quella forma e' anche quello cronologico. Un intero avrebbe
-- voluto dire ricalcolare il fuso a ogni lettura.
--
-- Serve solo con le impostazioni di lavoro accese. Spente, la tabella resta
-- vuota: il contatore guarda l'interruttore a ogni battito.
CREATE TABLE IF NOT EXISTS ore_vocale (
  utente  INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  giorno  TEXT    NOT NULL,
  secondi INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (utente, giorno)
);
CREATE INDEX IF NOT EXISTS idx_ore_giorno ON ore_vocale(giorno);
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
