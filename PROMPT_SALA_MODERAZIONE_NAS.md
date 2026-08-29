# PulseTalk — sala, audio, aggiornamenti, moderazione e distribuzione su NAS

Lavora esclusivamente sul progetto `G:\Projects\Apps\PulseTalk` e implementa quanto descritto qui, integrandolo con l'architettura esistente.

## Obiettivo e confini

PulseTalk usa già:

- un server Node.js 22 con Fastify e SQLite in `server/`;
- un client React + TypeScript condiviso fra Electron, browser e Android in `app/`;
- SSE per gli eventi realtime del piano di controllo (`server/src/eventi.mjs`);
- LiveKit per voce, video e condivisione schermo (`server/src/sfu.mjs`, `app/src/renderer/src/lib/pubblica.ts`, `app/src/renderer/src/lib/usaSessione.ts`);
- spazi, membri, ruoli, permessi a stringa (`server/src/permessi/catalogo.mjs`), canali, eventi di spazio, messaggi diretti e di spazio;
- un aggiornatore Electron già scritto (`app/src/main/aggiorna.ts`) che punta al feed servito dal server stesso, non a GitHub.

Nel codice e nella UI usa **spazio** per l'entità equivalente a un server Discord, e **istanza PulseTalk** per il server/NAS che ospita l'applicazione. Non confondere le due cose.

Il lavoro resta confinato a `G:\Projects\Apps\PulseTalk`:

- non modificare gli altri progetti sotto `G:\Projects\Apps`;
- non modificare configurazioni reali di NAS, reverse proxy, DNS, router o firewall;
- non toccare `.env`, credenziali, token o segreti reali; `.env.example` e la documentazione sì, senza segreti dentro;
- non pubblicare release, non fare deploy, non caricare immagini su nessun registry e non produrre installer se non te lo chiedo esplicitamente: i workflow e gli script che scrivi devono esistere e restare fermi finché non li avvio io;
- non modificare artefatti generati, `release/`, `out/`, `public/assets/`, `node_modules/` o dipendenze vendorizzate;
- non riscrivere `_nas/`, che è una copia di lavoro e non la sorgente.

## Metodo di lavoro obbligatorio

Prima di scrivere codice:

1. leggi il repository e individua ciò che è già presente o parziale — buona parte di quanto segue è una correzione, non una funzione nuova;
2. controlla lo stato Git e preserva le modifiche non committate;
3. ricostruisci i flussi reali di permessi, presenze vocali, token LiveKit, SSE e aggiornamento prima di intervenirci;
4. mantieni la compatibilità con i database SQLite già creati: migrazioni idempotenti, nessun dato perso;
5. prepara un piano per fasi sui file reali, poi implementa — non fermarti all'analisi;
6. non duplicare store, componenti, menu o sistemi di autorizzazione già esistenti: `MenuRiquadro`, `PopupProfilo`, `PannelloVolume`, `usaSessione` e il catalogo dei permessi sono i punti in cui innestarsi;
7. niente refactoring estranei a quanto chiesto.

Per ogni funzionalità: autenticazione, autorizzazione e validazione lato server; SSE solo agli utenti interessati; riconnessione, riavvio del server e stato obsoleto della UI considerati; loading, errori e stati vuoti gestiti; testi italiani e design system coerenti. **Nascondere un controllo nella UI non è una misura di sicurezza**: ogni potere di moderazione descritto qui vale solo se il server lo fa rispettare anche a un client modificato.

Una regola in più, che vale soprattutto per la Fase 5: **dove il formato di un file dipende da un prodotto esterno che cambia da solo — TrueNAS, LiveKit, electron-builder, electron-updater — verifica il formato attuale sulla documentazione ufficiale prima di scriverlo, e cita nel riepilogo la versione a cui ti sei attenuto.** Un file di catalogo scritto a memoria, nel formato di due versioni fa, non è un lavoro fatto a metà: è un lavoro che sembra fatto e non si installa.

---

## Fase 1 — La sala a tutto schermo

### 1. La barra degli spazi deve sparire, e sparire bene

A tutto schermo la sezione della chiamata deve prendersi tutta la finestra: la barra degli spazi e la colonna dei canali devono ritirarsi, e devono farlo **con un'animazione**, scivolando via e restituendo la larghezza alla sala, non scomparendo di colpo.

Oggi non succede. Guarda `app/src/renderer/src/App.tsx`:

- la barra degli spazi è dentro a `{!chiamataPiena && (<BarraSpazi … />)}`: smontata di netto, quindi senza transizione possibile;
- la colonna dei canali ha `className={\`… md:flex md:w-60 ${chiamataPiena ? 'hidden' : ''}\`}` — e in Tailwind `md:flex` vince su `hidden` sopra i 768 pixel, che è esattamente la larghezza a cui si sta guardando un desktop a tutto schermo. La classe c'è e non fa niente.

Da fare:

- verifica **tutti** i modi in cui si entra e si esce dal tutto schermo (il pulsante nella sala, la voce in `MenuRiquadro`, il doppio clic sul riquadro, F11 e il tutto schermo di finestra se esiste un percorso che non passa da `chiamataPiena`) e fa' che convergano tutti sullo stesso stato. Se ce n'è uno che non lo aggiorna, è quello il difetto che vedo;
- sostituisci lo smontaggio con una transizione reale di larghezza e opacità: le due colonne collassano insieme, la sala si allarga nello stesso movimento, niente sfarfallio del contenuto e niente barra di scorrimento orizzontale a metà animazione;
- ripiega su un cambio immediato quando `prefers-reduced-motion` è attivo;
- risolvi il conflitto di specificità Tailwind in modo che valga anche sotto i 768 pixel e sul mobile, dove la colonna è già governata da `navigazioneMobileAperta`;
- uscendo dal tutto schermo tutto deve tornare com'era, compreso il pannello della voce in basso a sinistra, la cui larghezza è scritta a mano in `App.tsx` (`w-16` / `w-[19rem]`): se cambia il comportamento delle colonne, quel numero va riconsiderato insieme.

Criterio di accettazione: su desktop, entrando a tutto schermo da qualunque percorso, dopo l'animazione nella finestra non resta nessuna colonna laterale, e uscendo tornano entrambe senza che la sala salti.

---

## Fase 2 — L'audio: tre cose separate che oggi si toccano

### 2. «Come suona» riguarda solo il microfono

L'impostazione `modoAudio` (voce / musica, `Impostazioni.modoAudio`, profili in `app/src/shared/qualita.ts`) deve descrivere **soltanto** come viene catturato e pubblicato il microfono di chi la imposta. Non deve toccare, né direttamente né per effetti collaterali, l'audio delle condivisioni.

`accendiMicrofono` in `app/src/renderer/src/lib/pubblica.ts` è già così, e va lasciato così. Il lavoro è dall'altra parte:

- in `catturaSchermo` l'audio si chiede con `audio: audioSistema !== 'niente'`, cioè un booleano nudo, e quello che arriva dipende da cosa Chromium decide di serie. Passa vincoli espliciti: `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`, due canali, e la frequenza di campionamento nativa quando la sorgente la dichiara. La cancellazione dell'eco su un loopback è la peggiore delle tre: sottrae dal suono condiviso ciò che sta uscendo dalle casse, che è precisamente il suono condiviso;
- `creaCatenaAudioCondiviso` deve restare un solo `GainNode` per il volume di trasmissione e nient'altro: nessun filtro, nessun profilo preso da `modoAudio`, nessun `PROFILI_AUDIO` letto per sbaglio;
- la pubblicazione della traccia `ScreenShareAudio` deve usare un profilo suo, di qualità musicale, dentro ai `Limiti` del server, indipendente da `modoAudio`. Vale identico per la **condivisione di solo audio** (`pubblicaSoloAudio`), che è lo stesso caso senza immagine;
- verifica il percorso Electron in `app/src/main/cattura.ts`: `loopback` e `loopbackWithMute` prendono l'uscita della scheda audio. Se in qualche configurazione ci finisce dentro anche il microfono — un dispositivo di ascolto attivo, un «Stereo Mix» scelto come uscita, un monitoraggio del microfono acceso — riconoscilo e dillo nel selettore delle sorgenti, invece di consegnare una condivisione sporca senza spiegazione. Non aggiungere mai tu il microfono a una traccia di condivisione: sono due tracce diverse, e devono restare due tracce diverse fino alle orecchie di chi ascolta.

Criterio di accettazione: cambiando `modoAudio` fra voce e musica mentre una condivisione è in corso, la traccia della condivisione non cambia bitrate, canali né lavorazione — e nella condivisione non si sente chi parla.

### 3. Smettere di guardare deve smettere anche di sentire

Oggi «Smetti di guardare — libera un posto» stacca il video e lascia l'audio. Il motivo è in `potaCondivisioni`, dentro a `app/src/renderer/src/lib/usaSessione.ts`:

```ts
if (pubblicazione.kind !== Track.Kind.Video) return
if (pubblicazione.source !== Track.Source.ScreenShare) return
```

La traccia `ScreenShareAudio` di quella stessa condivisione non passa mai da lì e resta sottoscritta: si continua a scaricarla e a sentirla, che è l'opposto di ciò che si è chiesto premendo.

Da fare:

- `guarda` e `nonGuardare` devono agire sulla **condivisione**, non sulla traccia video: video e audio dello stesso schermo si aprono e si chiudono insieme. Serve la corrispondenza fra le due pubblicazioni dello stesso partecipante — c'è già il mestiere per farlo in `etichettaSoloAudio` e nel suffisso `" (audio)"`, riusalo invece di inventare una seconda convenzione;
- la condivisione di **solo audio** non ha video: lì «smetti di ascoltare» è la stessa azione e deve staccare la sua unica traccia;
- nella UI la voce diventa **«Smetti di guardare e ascoltare»** (e «Guarda e ascolta» per riaprirla), perché è una cosa sola e va detta come una cosa sola;
- il conteggio di `MAX_CONDIVISIONI_GUARDATE` deve restare coerente, e una condivisione chiusa così deve riaprirsi correttamente, con audio, senza dover uscire e rientrare dalla stanza;
- chi vuole sentire senza vedere ha già il cursore del volume e la condivisione di solo audio: non aggiungere un terzo interruttore per questo.

---

## Fase 3 — Aggiornamenti veri

### 4. Aggiornare non deve aprire l'installer

Oggi accettare un aggiornamento fa comparire l'installer NSIS classico, con le sue schermate. Deve invece essere un aggiornamento vero: barra di avanzamento dentro all'applicazione mentre scarica, e alla fine una richiesta di riavvio — «Riavvia per usare la nuova versione» — e nient'altro da leggere o da confermare.

I due pezzi sono già quasi al loro posto e vanno allineati:

- `app/src/main/aggiorna.ts` emette già `download-progress` → `fase: 'scarico'` con `percento`, e `update-downloaded` → `fase: 'pronto'`. Assicurati che quella percentuale arrivi davvero a un'unica barra visibile e che gli stati `controllo`, `scarico`, `pronto`, `aggiornato`, `errore`, `nonSupportato` siano tutti rappresentati con una frase che si capisce;
- `quitAndInstall(false, true)` chiede esplicitamente l'installazione **non** silenziosa: è quel primo argomento a far comparire le schermate;
- in `app/electron-builder.yml` la sezione `nsis` ha `oneClick: false` e `allowToChangeInstallationDirectory: true`, e con un installer assistito l'installazione silenziosa non è supportata. Passa alla configurazione che consente l'aggiornamento silenzioso — verifica sulla documentazione di electron-builder ed electron-updater qual è, oggi, la combinazione corretta di `oneClick`, `perMachine`, `allowToChangeInstallationDirectory` e `differentialPackage`, e sceglila spiegando la scelta. La prima installazione può restare guidata solo se questo non impedisce l'aggiornamento silenzioso; se le due cose sono incompatibili, vince l'aggiornamento silenzioso, perché la prima installazione si fa una volta e l'aggiornamento tutte le altre;
- resta valida la regola già scritta nel file: **non si installa mentre si è in una stanza vocale**. Il pulsante deve dirlo, non limitarsi a essere disabilitato;
- il portabile continua a non aggiornarsi da solo e continua a spiegarlo. Non fingere il contrario;
- `rilascia.ps1` e `rilascia-nas.ps1` producono già `latest.yml` accanto all'installer: se la nuova configurazione NSIS cambia i nomi degli artefatti, aggiorna gli script di conseguenza, altrimenti il feed punta a file che non esistono più.

### 5. La notifica arriva all'avvio

Se all'apertura dell'applicazione c'è un aggiornamento, deve dirlo subito, senza che nessuno vada a cercarlo nelle impostazioni.

- oggi il controllo parte da `IPC.aggiornamentoPrepara`, cioè quando il server comunica il vincolo di versione — e quindi dopo l'accesso. L'installer però conosce già il feed pubblico, e `aggiorna.ts` è scritto apposta per funzionare anche prima del login: fa' partire un controllo **all'avvio**, una volta sola, appena la finestra è pronta;
- quando c'è qualcosa, mostralo come avviso non bloccante e richiudibile — non una finestra modale in faccia a chi sta aprendo il programma per entrare in una chiamata — con la versione, le note se ci sono, e il pulsante per scaricare;
- un aggiornamento **obbligatorio** imposto dal server continua a comportarsi come adesso: si scarica da solo e blocca l'interfaccia prima del login;
- senza rete, dietro a una rete che blocca il feed, o su un repository senza release, all'avvio non deve comparire niente: quel caso è già trattato in `aggiorna.ts` e non deve diventare un avviso;
- il controllo all'avvio non deve raddoppiarsi con quello di `aggiornamentoPrepara` che arriva subito dopo il login: c'è già la guardia `operazione`, usala.

---

## Fase 4 — Le persone: pannelli e moderazione

Questa è la fase più grossa, ed è quella in cui il server conta più della UI.

### 6. Il pannello sulla persona nella colonna dei canali

L'elenco sotto a un canale vocale, in `app/src/renderer/src/spazi/ColonnaCanali.tsx`, oggi è fatto di `div` non cliccabili. Ogni riga deve diventare selezionabile e aprire un pannellino ancorato alla riga, con:

- nome, avatar, stato;
- **manda un messaggio diretto** — apre il composer del diretto con quella persona;
- **vai ai diretti** — porta alla vista diretti sulla conversazione con quella persona, aprendola se non esiste ancora;
- il volume di quella persona e lo zittiscila-per-me, che sono impostazioni locali di chi guarda;
- le azioni di moderazione della Fase 4.2, esattamente le stesse, quando chi apre il pannello ne ha il diritto.

Riusa il flusso dei diretti che esiste già (`lib/usaDiretti.ts`, `dm/ColonnaDiretti.tsx`, le rotte in `server/src/routes/diretti.mjs`): non aggiungere un secondo modo di creare una conversazione. Riusa anche il modo in cui `PopupProfilo` e `MenuSpazio` si posizionano, si chiudono con Escape e con il clic fuori, e restano dentro alla finestra — non scrivere un terzo meccanismo di comparsa.

Accessibilità: la riga è un `button`, si raggiunge da tastiera, il pannello ha un ruolo coerente e il fuoco ci entra e ne esce.

### 7. Il pannello del tasto destro sul riquadro in chiamata

`app/src/renderer/src/sala/MenuRiquadro.tsx` esiste già ed è il posto giusto: **estendilo, non affiancargli un secondo menu**. Deve diventare il pannello unico delle impostazioni del riquadro su cui si è premuto, e mostrare cose diverse a seconda di cosa c'è sotto e di chi sta guardando.

**Su un riquadro di condivisione — schermo o solo audio:**

- «Smetti di guardare e ascoltare» / «Guarda e ascolta» (Fase 2.3);
- il cursore del volume, che è già lì con `PannelloVolume`;
- metti in primo piano, tutto schermo, qualità della propria condivisione: restano come sono;
- **chiudi questa condivisione**, a chi ne ha il diritto: ferma la condivisione altrui per tutti, non solo per sé. Va distinta con chiarezza dal «smetti di guardare», che riguarda solo chi preme.

**Su un riquadro di persona,** a chi ne ha il diritto:

- **forza la telecamera spenta.** Solo spegnere: accendere la telecamera di qualcun altro non deve essere possibile per nessuno, con nessun permesso, mai;
- **togli la condivisione**, cioè impedire a quella persona di condividere schermo o audio, e chiudere ciò che sta già condividendo;
- **muto forzato del microfono**;
- **muto forzato delle cuffie**, cioè impedirle anche di sentire;
- e, dove già esiste, «espelli dal canale».

Ogni voce è un interruttore con due direzioni: ciò che si è imposto si deve poter togliere, e lo stato attuale si deve leggere nel pannello senza indovinarlo. Chi subisce una restrizione deve vederla scritta nella propria interfaccia — con chi gliel'ha messa, se la conosce — invece di trovarsi un pulsante che non risponde.

### 8. Chi può, e fin dove

I permessi esistono già in `server/src/permessi/catalogo.mjs` e in `app/src/shared/permessi.ts`: `muteMembers`, `deafenMembers`, `manageVoiceMembers`, `stream`, `speak`, `createEvents`, `manageEvents`. Usa quelli. Aggiungine uno solo se ne manca davvero uno, e allora aggiungilo in **entrambi** i cataloghi con la sua etichetta italiana.

Due livelli, e il secondo è la parte nuova:

**Amministratore dello spazio.** Chi ha il permesso nello spazio (o l'override sul canale) può usare le azioni di moderazione su chiunque, in qualunque canale vocale dello spazio, come già fa `moderatore` in `Sala.tsx`, che oggi viene calcolato in `App.tsx` con `puo(canaleVocale?.permessiMiei, 'manageVoiceMembers')`.

**Organizzatore di un evento.** Chi non amministra lo spazio ma ha `createEvents` e ha creato un evento (`server/src/dati/eventi-spazio.mjs`, `server/src/routes/eventi-spazio.mjs`) è **amministratore dentro al proprio evento**, e lì può fare tutto quanto sopra. Con confini stretti, che vanno scritti nel codice e nel riepilogo:

- vale **solo nel canale dell'evento** (`eventi_spazio.canale`), e un evento senza canale non conferisce nessun potere;
- vale **solo nella finestra temporale** dell'evento, `inizio`–`fine`, con una tolleranza dichiarata prima e dopo; fuori da quella finestra i poteri non ci sono, e le restrizioni imposte durante l'evento decadono alla sua chiusura. Un evento senza `fine` ha bisogno di una durata massima esplicita: sceglila e documentala, perché un evento senza fine sarebbe un'amministrazione a tempo indeterminato regalata da un permesso minore;
- un evento **annullato** non conferisce niente;
- l'organizzatore **non può usare i poteri contro chi nello spazio sta più in alto di lui** — il proprietario, e chi ha `manageServer` o `manageEvents`. Senza questo vincolo, «crea eventi» diventa la strada per zittire il proprietario dello spazio: sarebbe una scalata di privilegi nascosta dentro a un permesso che sembra innocuo;
- l'organizzatore non può delegare: i poteri sono suoi e non si passano.

### 9. Il server deve farle rispettare davvero

Questa è la parte che decide se la Fase 4 è una funzione o una decorazione.

- **Persistenza.** Le restrizioni (camera spenta, condivisione tolta, microfono muto, cuffie mute) sono stato sul server, non un messaggio effimero: tabella nuova con migrazione idempotenta, chiave su utente + ambito (canale, o evento), con chi l'ha imposta e quando. Chi si disconnette e rientra le ritrova; un riavvio del server non le perde.
- **Applicazione sulla SFU.** Non basta `mutePublishedTrack` sulla traccia viva: chi rientra ottiene un token nuovo e ricomincia a pubblicare. Le restrizioni devono entrare nei **permessi del partecipante e nel token**, dove `server/src/sfu.mjs` e `server/src/chiamate.mjs` li emettono — `canPublish`, `canPublishSources`, `canSubscribe` — e devono essere applicate a caldo su chi è già dentro. Verifica sulla documentazione di LiveKit i nomi attuali dell'API di aggiornamento dei permessi del partecipante prima di scriverli.
- **Le cuffie forzate** sono l'unico caso in cui il client da solo non basterebbe mai: se la sottoscrizione resta aperta, l'audio arriva comunque e basta un client modificato per ascoltarlo. Togli la sottoscrizione lato SFU, non solo il volume lato client.
- **Autorizzazione.** Ogni rotta nuova ricalcola i permessi lato server sulla richiesta, senza fidarsi di niente che arrivi dal client — né del ruolo, né dell'evento dichiarato, né dell'identità del bersaglio. Chi non ha diritto riceve 403; chi non vede la risorsa riceve 404, secondo le convenzioni già in uso.
- **SSE.** Ogni cambio di restrizione va agli interessati: al bersaglio, e a chi sta nel canale perché la UI mostri lo stato giusto. A nessun altro.
- **Idempotenza e concorrenza.** Due amministratori che premono insieme, una richiesta ripetuta, un bersaglio che nel frattempo è uscito dal canale: nessuno di questi casi deve lasciare lo stato a metà.
- **Non toccare i messaggi.** Resta valida la regola trasversale già scritta in `PROMPT_ADVANCED_FEATURES.md`: nessun ruolo modifica o cancella il messaggio di un altro. Queste sono restrizioni sulla voce e sul video, non sul testo.

### 10. Test

In `server/test/` c'è già lo stile da seguire (`talk.test.mjs`, `espansione.test.mjs`). Aggiungi un file per la moderazione vocale, con almeno:

- amministratore che impone e toglie ciascuna delle quattro restrizioni;
- utente senza permessi che ci prova → 403;
- organizzatore dentro al proprio evento → passa; fuori dalla finestra temporale → 403; su un altro canale → 403; su un evento annullato → 403; contro il proprietario dello spazio → 403;
- restrizione che sopravvive all'uscita e al rientro nella stanza;
- restrizione che decade alla fine dell'evento;
- il token emesso a un utente ristretto non concede le sorgenti tolte.

---

## Fase 5 — Scaricare PulseTalk sul proprio NAS

Oggi l'installazione è documentata bene nel `README.md` ma è cucita addosso a una macchina sola: `rilascia-nas.ps1` ha dentro un indirizzo IP e un percorso, il `docker-compose.yml` in `deploy/` costruisce dal sorgente, e non esiste un modo per un estraneo di installare PulseTalk senza clonare il repository e leggere quaranta paragrafi.

Obiettivo: **chiunque abbia un NAS deve poter installare PulseTalk**, e su TrueNAS deve poterlo fare dall'elenco delle app.

### 11. Un'installazione che non presuppone il sorgente

- **Immagine pubblicata.** Prepara la pubblicazione dell'immagine del server su GHCR (`ghcr.io/<utente>/pulse-talk`), multi-architettura `linux/amd64` e `linux/arm64` — i NAS ARM esistono e sono metà del pubblico di questa funzione. Un workflow GitHub Actions che parte **solo su tag** e costruisce, etichetta (`X.Y.Z`, `X.Y`, `latest`) e carica. Il `Dockerfile` in `server/` è già il punto di partenza: verifica che costruisca su entrambe le architetture e correggi ciò che non lo fa.
- **Compose per chi installa, non per chi sviluppa.** Accanto a `deploy/docker-compose.yml` — che resta quello di sviluppo, con `build: ../server` — mettine uno che usa l'immagine pubblicata e non ha bisogno del sorgente. Stessi servizi, stessa rete, stessi volumi, nessun valore personale dentro.
- **Un installatore guidato.** Uno script POSIX che si può eseguire sul NAS e che fa le domande che il README fa leggere: cartella dei dati, dominio o IP locale, i due interruttori che vanno girati insieme (`SFU_URL` e `use_external_ip` in `livekit.yaml`), le porte da inoltrare, se il reverse proxy c'è già. Genera i segreti con il comando che esiste già (`node src/cli.mjs segreto`), scrive `.env` e `livekit.yaml`, e alla fine dice cosa manca ancora — il port forward e i due record DNS non li può fare lui.
- **Il feed degli aggiornamenti.** Un'istanza installata da altri deve poter servire i propri aggiornamenti come fa la tua: rendi parametrici l'host e la cartella oggi scritti dentro a `rilascia-nas.ps1`, e documenta come si pubblica una versione sulla propria istanza. Se un'istanza non serve nessun feed, l'app deve dirlo con calma invece di comportarsi come se l'aggiornamento fosse rotto.
- **Documentazione.** Una guida per NAS separata dal README, che parta da «ho un NAS e non ho mai visto questo progetto». Il README resta il documento del progetto e rimanda a quella.

### 12. PulseTalk fra le app di TrueNAS

Un **train/catalogo proprio**, ospitato in questo repository, che chi ha TrueNAS aggiunge e da cui installa PulseTalk come qualunque altra app. Niente attesa di approvazioni esterne.

- **Verifica il formato prima di scriverlo.** Il formato del catalogo di TrueNAS SCALE è cambiato più di una volta, e dalla 24.10 le app sono basate su Docker Compose. Vai a leggere la documentazione ufficiale e il repository `truenas/apps` **adesso**, ricava la struttura corrente di un train di terze parti — cartelle, `app.yaml`, `questions.yaml`, i template Compose, i metadati, l'icona, il versionamento — e scrivi quella. Dichiara nel riepilogo la versione di TrueNAS a cui ti sei attenuto e da dove hai preso il formato. Non dedurlo dalla memoria.
- **Le domande dell'installazione** devono essere quelle vere e non di più: cartella dei dati (dataset ospite), dominio pubblico o indirizzo locale, porte, segreto della SFU (generato di serie, modificabile), le chiavi facoltative di AI, Spotify, GIF e immagini — tutte spente di serie, tutte con la scritta che dice che senza di loro l'applicazione funziona lo stesso.
- **La SFU va installata insieme.** Una chiamata senza LiveKit non esiste: l'app deve tirarsi dietro `livekit-server` con `7880`, `7881/TCP` e `7882/UDP`, e la sua configurazione deve nascere dalle risposte alle domande, non da un file da modificare a mano dopo.
- **Onestà su cosa il catalogo non può fare.** Il port forward sul router e i due record DNS restano fuori dalla portata di qualunque installatore: mettili come istruzioni post-installazione, in chiaro, invece di lasciare che la prima chiamata muta sembri un difetto dell'applicazione.
- **Come si aggiorna** un'istanza installata dal catalogo, e cosa succede a `talk.db` quando si aggiorna: scrivilo.
- Verifica il risultato per quanto si può senza un TrueNAS sottomano: sintassi, schema delle domande, il Compose che parte davvero con `docker compose up` a partire dai valori di serie. Se qualcosa si può controllare solo su una macchina TrueNAS, dillo nel riepilogo invece di darlo per riuscito.
- Non pubblicare niente e non aprire nessuna richiesta a nessuno: i file esistono, il caricamento lo decido io.

---

## Cosa consegnare

Alla fine, un riepilogo che dica:

1. cosa hai cambiato, file per file, diviso per fase;
2. quali difetti hai trovato che non erano nell'elenco, e cosa hai fatto;
3. le decisioni prese dove il requisito toccava un vincolo architetturale reale — in particolare: la configurazione NSIS scelta e perché, la durata massima di un evento senza `fine`, il modo in cui le cuffie forzate sono applicate lato SFU, e la versione di TrueNAS di cui hai seguito il formato;
4. cosa resta da verificare a mano e su quale macchina;
5. i comandi per costruire e provare, senza eseguire nessuna pubblicazione.
