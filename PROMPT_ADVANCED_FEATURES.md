# PulseTalk — espansione funzionalità avanzate

Lavora esclusivamente sul progetto `G:\Projects\Apps\PulseTalk` e implementa le funzionalità descritte in questo documento, integrandole con l'architettura esistente.

## Obiettivo e confini

PulseTalk usa già:

- un server Node.js 22 con Fastify e SQLite in `server/`;
- un client React + TypeScript condiviso tra Electron e browser in `app/`;
- SSE per gli eventi realtime del piano di controllo;
- LiveKit per voce, video e condivisione schermo;
- spazi, membri, amicizie, ruoli, permessi, categorie, canali, messaggi diretti e di spazio già esistenti.

Nel codice e nella UI usa il termine **spazio** per l'entità equivalente a un server Discord. Usa **istanza PulseTalk** quando ti riferisci al server/NAS che ospita l'applicazione. Non confondere queste due entità.

Il lavoro deve rimanere confinato a `G:\Projects\Apps\PulseTalk`:

- non modificare gli altri progetti sotto `G:\Projects\Apps`;
- non modificare configurazioni del NAS, reverse proxy, DNS, router, firewall o servizi esterni;
- non modificare `.env`, credenziali, token o segreti reali;
- non creare account, risorse o configurazioni su servizi esterni;
- non pubblicare release, non eseguire deploy e non produrre installer, salvo mia richiesta esplicita;
- non modificare artefatti generati, cartelle di build, release o dipendenze vendorizzate;
- puoi aggiornare `.env.example` e la documentazione interna quando servono nuove variabili configurabili, senza inserirvi segreti.

Le API o i servizi esterni devono essere soltanto integrazioni opzionali e configurabili dall'interno di PulseTalk. Se nessun provider è configurato, l'app deve continuare a funzionare e mostrare chiaramente la funzione come non disponibile. Non simulare provider funzionanti, API inesistenti o risultati fittizi.

## Metodo di lavoro obbligatorio

Prima di scrivere codice:

1. leggi il repository e individua le implementazioni già presenti o parziali;
2. controlla lo stato Git e preserva tutte le modifiche dell'utente, anche se non ancora committate;
3. ricostruisci i flussi reali di autenticazione, spazi, inviti, amicizie, ruoli, permessi, canali, messaggi, impostazioni, SSE e LiveKit;
4. individua schema e migrazioni SQLite esistenti e mantieni la compatibilità con i database già creati;
5. prepara un piano per fasi basato sui file reali e poi procedi con l'implementazione, senza fermarti a una semplice analisi;
6. non duplicare servizi, store, componenti o sistemi di autorizzazione già presenti;
7. non fare refactoring estranei alle funzionalità richieste.

Se una funzione è già presente, non riscriverla: verificala rispetto ai criteri di accettazione, correggi soltanto ciò che manca e aggiungi test mirati. Se un requisito è incompatibile con una scelta architetturale reale, adotta la soluzione più piccola e coerente che preserva il comportamento esistente e documenta la decisione nel riepilogo finale.

Per ogni funzionalità:

- applica autenticazione, autorizzazione e validazione lato server;
- per risorse invisibili a un utente non autorizzato, preferisci `404` a risposte che ne confermino l'esistenza, seguendo le convenzioni esistenti;
- invia eventi SSE solo agli utenti interessati;
- considera riconnessione, riavvio del server, richieste duplicate e stato obsoleto della UI;
- gestisci loading, empty state, errori, retry espliciti, disabilitazione e accessibilità di base;
- mantieni UI, testi italiani e design system coerenti con PulseTalk;
- non considerare il semplice occultamento di un controllo UI una misura di sicurezza.

## Regola trasversale — proprietà dei messaggi

Un messaggio può essere modificato ed eliminato soltanto da chi lo ha scritto. La regola vale ovunque: nessun ruolo, nessun permesso e nessun proprietario di spazio può riscrivere o cancellare il messaggio di un altro. Il controllo è server-side; nascondere il pulsante non è una misura di sicurezza.

Non deve quindi esistere un permesso di moderazione dei messaggi. Se ne trovi uno nel catalogo dei permessi, rimuovilo invece di lasciarlo senza effetto: un permesso che si può concedere e non fa niente è peggio di un permesso che non c'è. Chi amministra uno spazio modera le persone e i canali — allontanando, togliendo l'accesso, chiudendo un canale — non il testo altrui.

L'unica eccezione riguarda i messaggi senza autore umano. Una risposta AI o di un bot ha per autore un'identità che non fa login: se a cancellare fosse solo l'autore, quella riga resterebbe nel canale per sempre. Registra chi ha richiesto il messaggio e concedi l'eliminazione a quella persona, e a nessun'altra. La modifica resta impossibile anche per lei, perché riscrivere una risposta generata falsificherebbe ciò che il bot ha detto.

## Fase 1 — Privacy degli spazi, proprietà e canali temporanei

### 1. Trasferimento della proprietà solo a un amico

Il proprietario di uno spazio può trasferirne la proprietà soltanto a un utente che, al momento della richiesta:

- è un membro effettivo dello spazio;
- è un amico accettato del proprietario attuale;
- non è una richiesta di amicizia pendente, rifiutata o rimossa;
- è diverso dal proprietario attuale.

La verifica deve essere atomica e server-side immediatamente prima dell'aggiornamento. La UI deve elencare soltanto i membri idonei, ma il backend deve rifiutare comunque un trasferimento diventato non valido mentre il pannello era aperto.

Preserva gli invarianti esistenti: un solo proprietario, proprietario sempre membro e amministratore, ruoli e permessi coerenti dopo il passaggio. Invia gli eventi SSE solo ai membri dello spazio e aggiorna la UI senza riavvio. Aggiungi test per successo, non-amico, richiesta pendente, non-membro, amicizia rimossa e chiamante non proprietario.

### 2. Spazi privati per impostazione predefinita

Un nuovo spazio deve nascere con `apertoATutti: false`, o con l'equivalente previsto dall'architettura esistente. Non deve essere elencato, serializzato o annunciato via SSE a utenti che non ne sono membri.

Non confondere:

- inviti all'istanza, usati per creare un account PulseTalk;
- inviti a uno spazio, usati da un account esistente per entrarvi;
- inviti a un canale privato.

Mantieni i flussi esistenti, ma uno spazio deve entrare nell'elenco principale dell'utente soltanto quando l'utente ne diventa effettivamente membro. Prima dell'ingresso, una schermata di anteprima dell'invito può mostrare solo i dati minimi necessari a riconoscere e accettare l'invito, come nome, icona, descrizione e ruolo proposto. Non deve esporre membri, categorie, canali, messaggi, permessi, presenze vocali o altri dati interni.

Dopo l'accettazione o il riscatto valido dell'invito:

- registra l'appartenenza nel database in modo transazionale;
- consegna eventuali ruoli previsti dall'invito senza escalation di privilegi;
- notifica soltanto l'utente interessato e i membri per i quali l'evento è pertinente;
- carica subito lo spazio e soltanto i canali visibili secondo i permessi.

Controlla tutti i percorsi di ingresso già esistenti, compresa l'aggiunta diretta di un membro da parte di chi ne ha il permesso. Non introdurre un secondo sistema di inviti se quello attuale può essere esteso. Verifica che endpoint, ricerca, allegati, messaggi, presenze LiveKit e SSE non rivelino l'esistenza o i dati di uno spazio a chi non ne fa parte.

### 3. Canali temporanei

Estendi il modello di canale esistente per supportare canali di testo e voce permanenti oppure temporanei.

Nella creazione e modifica proponi:

- permanente;
- 30 minuti;
- 1 ora;
- 3 ore;
- 6 ore;
- 12 ore;
- 24 ore;
- durata personalizzata, maggiore di zero e non superiore a 48 ore.

Valida sempre il limite lato server. Riusa i campi temporali esistenti e aggiungi solo quelli necessari, ad esempio `creato`, `scade` e `creatoDa`; non duplicare dati già disponibili. Le migrazioni devono essere idempotenti e compatibili con i canali esistenti, che restano permanenti.

La scadenza deve sopravvivere a riavvii e periodi di inattività: non affidarti soltanto a timer in memoria. Usa un meccanismo persistente coerente con il server attuale, con recupero dei canali già scaduti all'avvio. Alla scadenza applica la stessa semantica sicura della normale eliminazione di un canale, rimuovilo dalla navigazione, impedisci nuovi accessi e invia SSE soltanto ai membri interessati. Se è vocale, espelli i partecipanti dalla stanza LiveKit e pulisci correttamente lo stato client. Mostra il tempo residuo quando utile, usando l'orologio del server per evitare divergenze.

## Fase 2 — Voce, video e zoom

### 4. Stato media quando si cambia canale vocale

Aggiungi una preferenza utente persistente: **Disattiva automaticamente microfono e videocamera quando cambio canale vocale**.

Se attiva, nel passaggio diretto da un canale vocale a un altro il nuovo canale deve iniziare con microfono e videocamera disattivati, indipendentemente dallo stato precedente. Applica il comportamento alle tracce della sessione, senza cambiare permanentemente dispositivo scelto o altre preferenze media. Non applicarlo alla semplice navigazione tra canali testuali mentre la voce resta collegata.

### 5. Mirror Camera

Aggiungi una preferenza persistente **Specchia la mia anteprima video**. Deve trasformare orizzontalmente solo l'anteprima locale della webcam. Non deve modificare la traccia pubblicata, il video visto dagli altri, le webcam remote o lo screen sharing.

### 6. Zoom di screen sharing e webcam

Permetti di selezionare una condivisione schermo o webcam e applicare:

- zoom fluido;
- pan quando il contenuto supera l'area visibile;
- fit-to-screen;
- reset immediato al 100%;
- input da controlli visibili e, se già coerente con l'app, rotella/pinch e scorciatoie.

Lo zoom è soltanto una trasformazione del rendering locale: non deve cambiare qualità, vincoli o stream LiveKit. Riusa o estrai una piccola primitiva comune solo se riduce davvero la duplicazione tra webcam e screen share.

Quando lo zoom cambia, mostra per un breve periodo un overlay non invasivo con il valore corrente, per esempio `Zoom 125%`. Usa limiti sensati e accessibili; valori indicativi: 50%, 75%, 100%, 125%, 150% e 200%, senza imporre scatti discreti se il componente supporta già lo zoom continuo.

## Fase 3 — Composer, GIF e anteprime link

### 7. Composer ordinato e modalità esplicite

Riorganizza il composer senza sovraccaricarlo. Deve integrare in modo coerente allegati, GIF, modalità AI Chat, modalità AI Image, eventuale ricerca immagini, input e invio. Se lo spazio è insufficiente usa un menu secondario accessibile, invece di comprimere tutti i controlli.

Le modalità del composer sono esattamente una tra:

- chat normale;
- AI Chat;
- AI Image.

AI Chat e AI Image sono mutualmente esclusive; entrambe possono essere disattivate. Cambio modalità, placeholder, icona, stile attivo, tooltip e nome accessibile devono rendere evidente lo stato. La ricerca immagini web non va confusa con la generazione e può essere un'azione dedicata dentro la modalità AI o nel menu secondario.

### 8. Ricerca e condivisione GIF

Aggiungi un pulsante GIF che apre un pannello con ricerca, loading, risultati, anteprima e invio inline. Usa soltanto un provider con API ufficiale e configurabile lato server. Le credenziali non devono arrivare al renderer. Implementa una piccola interfaccia provider sostituibile, timeout, rate limit, risposta normalizzata, fonte e gestione del provider assente.

### 9. Anteprime sicure dei link

Aggiungi la preferenza utente **Mostra anteprime link**.

Se attiva, genera sotto il messaggio una card con i metadata realmente disponibili: dominio, favicon, titolo, descrizione e immagine Open Graph. Se disattiva, non effettuare fetch automatici; un hover/focus intenzionale può richiedere una preview temporanea del singolo URL, con debounce e possibilità di chiusura.

Il fetch deve passare dal server e accettare solo HTTP/HTTPS. Proteggilo da SSRF e abusi:

- blocca localhost, loopback, indirizzi privati/link-local e destinazioni vietate sia prima sia dopo la risoluzione DNS;
- ricontrolla ogni redirect e limita il loro numero;
- imposta timeout e limiti stretti su dimensione, content type e quantità di dati letti;
- non eseguire script e non renderizzare HTML remoto;
- sanitizza e normalizza metadata e URL;
- applica rate limit e cache con scadenza;
- evita di trasformare PulseTalk in un proxy generico.

## Fase 4 — Infrastruttura AI e funzioni chat

### 10. Layer comune dei provider

Costruisci un layer piccolo e coerente con i provider già presenti nel server. Non creare un'unica interfaccia artificiale se i contratti sono diversi; usa contratti specifici sotto una configurazione comune per:

- chat completion;
- riassunto;
- speech-to-text;
- web search;
- generazione immagini;
- ricerca immagini;
- GIF, se utile condividere configurazione e gestione errori.

Tutte le chiamate ai provider avvengono lato server. Prevedi configurazione tramite variabili d'ambiente documentate, disponibilità/capabilities, timeout, `AbortSignal`, rate limit per utente e spazio, limiti di input/output, quota esaurita, errori normalizzati e nessun retry incontrollato. Un fallback è consentito soltanto se esplicitamente configurato; non inviare dati a un secondo provider di nascosto.

Non salvare chiavi nel database o nel client. Non registrare nei log prompt, trascrizioni, chiavi o risposte sensibili per impostazione predefinita.

### 11. AI Chat e ricerca web

Quando AI Chat è attiva, l'input diventa una richiesta al provider AI e non un normale messaggio dell'utente. Mostra stato di generazione, annullamento ed errore. La risposta deve apparire nella conversazione con identità e tipo chiaramente distinti da un utente umano, seguendo il modello messaggi esistente e senza falsificare autori.

Definisci esplicitamente visibilità e persistenza: richiesta e risposta devono essere visibili solo agli utenti che possono vedere quel canale; se vengono salvate, devono seguire eliminazione, ricerca, citazioni e autorizzazioni dei messaggi normali. Il provider riceve solo il contesto minimo necessario e autorizzato, con un limite configurabile.

Per piccole ricerche web usa un `WebSearchProvider` ufficiale/configurato. Mostra le fonti come link e non presentare testo non verificato come risultato di ricerca. Se nessun provider di ricerca è configurato, AI Chat deve continuare a funzionare senza ricerca oppure dichiarare chiaramente che quella capacità non è disponibile.

### 12. Generazione immagini

In modalità AI Image, l'input è un prompt per `ImageGenerationProvider`. Mostra avanzamento, annullamento, errore e risultato inline. Tratta il file prodotto come un allegato PulseTalk, rispettando autorizzazioni, limiti, storage, deduplicazione e pulizia già esistenti. Distingui visivamente le immagini generate e conserva provider/modello solo come metadata tecnici non sensibili, se utile.

Valuta Perchance soltanto se esiste un'API pubblica, documentata e consentita per questo uso. Il sito web `perchance.org/ai-character-generator` non è di per sé un'API: non usare automazione del browser, scraping, endpoint interni, reverse engineering o aggiramento di protezioni. Se non esiste un'API adatta, non implementare un adapter finto: lascia Perchance non disponibile e usa l'interfaccia generica con un provider ufficiale o self-hosted configurabile. PulseTalk non deve dipendere obbligatoriamente da Perchance né da un servizio gratuito presunto.

### 13. Ricerca immagini web

La ricerca immagini è distinta dalla generazione. Implementa un `ImageSearchProvider` basato su API ufficiale/configurabile. I risultati devono mostrare anteprima, fonte originale, pagina sorgente e indicazione **Immagine trovata sul web**. Non copiare automaticamente immagini remote nello storage; fallo soltanto quando l'utente sceglie di condividerle e dopo le normali verifiche di sicurezza e dimensione.

## Fase 5 — Auto Writer

### 14. Trascrizione vocale

Aggiungi **Auto Writer** ai canali vocali e alle chiamate dove l'architettura lo permette. Non deve mai essere una registrazione nascosta.

Prima di catturare o inviare audio:

- mostra chiaramente a tutti i partecipanti chi ha richiesto l'attivazione e quale provider verrà usato;
- applica un flusso di consenso esplicito coerente e verificato lato server;
- segnala in modo persistente che la trascrizione è attiva;
- gestisci ingressi, uscite, revoca del consenso e arresto;
- limita accesso alla trascrizione ai partecipanti autorizzati;
- non conservare audio grezzo oltre il tempo strettamente necessario.

Sfrutta l'identità delle tracce/partecipanti LiveKit per associare il testo al parlante, invece di promettere diarizzazione perfetta su un mix audio quando sono disponibili tracce separate. Non inventare il parlante quando l'associazione è incerta: marcala come non identificata.

Se l'architettura non contiene già un motore STT, crea un contratto sostituibile e implementa soltanto provider realmente configurabili. Privilegia un provider locale/self-hosted quando disponibile, ma non includere modelli pesanti o binari nel repository senza necessità e senza mia autorizzazione. Senza provider configurato, il pulsante deve spiegare che Auto Writer non è disponibile.

La trascrizione deve aggiornarsi durante la conversazione, distinguere risultati parziali e definitivi ed evitare duplicati alla riconnessione. Persisti soltanto ciò che serve, con una politica chiara di conservazione ed eliminazione.

### 15. Riassunto della conversazione

Quando esiste una trascrizione autorizzata, aggiungi **Riassumi conversazione**. Il sistema di riassunto deve essere separato dallo STT e produrre una struttura con:

- argomenti discussi;
- decisioni prese;
- problemi emersi;
- attività da svolgere;
- persone associate alle attività solo quando dichiarate chiaramente;
- punti ancora da decidere.

Non inventare dettagli. Mostra chiaramente che il contenuto è generato dall'AI. Applica gli stessi permessi e la stessa visibilità della trascrizione, limiti di dimensione, cancellazione, rate limit e consenso previsto per l'invio della trascrizione al provider.

## Fase 6 — Fondazione bot

Implementa una base estensibile per bot interni agli spazi senza costruire ora marketplace, OAuth, portale sviluppatori, slash commands o un'API pubblica completa.

Un bot deve:

- essere distinguibile da un utente umano nel modello dati e nella UI;
- avere identificativo, nome, avatar e badge `BOT`;
- essere installato esplicitamente in uno spazio;
- ricevere ruoli e permessi tramite il sistema esistente;
- vedere canali e messaggi solo quando i permessi lo consentono;
- inviare messaggi attraverso un percorso server-side autenticato e attribuito al bot;
- non ricevere privilegi amministrativi impliciti;
- non poter usare login interattivo, sessioni utente o flussi di amicizia come un essere umano, salvo scelta architetturale motivata.

Prepara confini chiari per futuri token bot, webhook e command system, ma non generare o mostrare token reali se non sono necessari all'MVP. Ogni azione deve essere auditabile e revocabile. Aggiungi test contro escalation di privilegi, accesso a spazi/canali non autorizzati e impersonificazione di utenti.

## Database e compatibilità

Prima di aggiungere tabelle o colonne, verifica lo schema corrente. Crea solo strutture necessarie e migrazioni idempotenti, mantenendo i dati esistenti. Valuta in particolare, senza presumere che servano tutte:

- scadenza e autore dei canali temporanei;
- preferenze media, mirror e link preview;
- configurazione non segreta/capabilities dei provider;
- messaggi e allegati generati da AI;
- sessioni, segmenti e consensi Auto Writer;
- riassunti;
- identità e installazioni bot.

Non memorizzare segreti dei provider in SQLite. Aggiungi indici e vincoli per gli invarianti importanti. Aggiorna versione/contratto di compatibilità client-server se il repository lo richiede.

## Ordine di esecuzione e verifiche

Completa le fasi nell'ordine indicato. Tratta ogni fase come un blocco separato: implementazione, test mirati, verifica delle regressioni e poi fase successiva. Non creare commit e non pubblicare nulla salvo mia richiesta.

Usa i comandi realmente disponibili nel repository. Come minimo, al termine esegui:

```powershell
npm --prefix server test
npm --prefix app run typecheck
npm --prefix app run build
npm --prefix app run build:web
```

Non inventare un comando lint se il progetto non ne espone uno. Non eseguire `dist`, `dist:installer`, deploy o script di rilascio. Se una verifica non può essere eseguita, spiega il motivo esatto. Correggi tutte le regressioni causate dalle modifiche e aggiungi test server/client dove il rischio lo richiede.

## Criteri di completamento

Il lavoro è concluso soltanto quando:

- ogni requisito implementato usa i sistemi esistenti di utenti, spazi, permessi, messaggi, SSE e LiveKit;
- gli spazi sono privati per default e non perdono dati verso non membri;
- un messaggio lo modifica e lo elimina soltanto chi lo ha scritto, e la risposta generata la elimina chi l'ha richiesta;
- il trasferimento proprietà accetta solo membri che siano amici confermati;
- i canali temporanei scadono anche dopo un riavvio;
- preferenze media, mirror e zoom funzionano senza alterare stream o dispositivi degli altri;
- GIF e link preview sono configurabili e sicuri;
- le funzioni AI hanno provider sostituibili, segreti solo server-side e stati di indisponibilità reali;
- generazione e ricerca immagini sono chiaramente distinte;
- Auto Writer è visibile, consensuale e attribuisce i parlanti senza inventarli;
- i bot rispettano rigorosamente ruoli e permessi;
- database esistenti, browser ed Electron restano compatibili;
- test e build disponibili passano.

Nel riepilogo finale indica:

1. funzionalità completate per fase;
2. file principali modificati;
3. migrazioni e nuove variabili di configurazione;
4. provider realmente supportati e capacità non disponibili senza configurazione;
5. test/comandi eseguiti con relativo esito;
6. eventuali limiti rimasti, senza presentare stub o mock come funzionalità complete.
