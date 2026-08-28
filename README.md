# PulseTalk

Spazi, canali di testo e di voce, condivisione dello schermo senza i tetti che
mette Discord, su una macchina che e' tua.

Non nasce dall'idea di rifare Discord: nasce dal fatto che condividere lo
schermo per far leggere del codice, su Discord, non funziona. Il testo si
sgrana appena qualcuno muove una finestra, l'audio della voce sta sotto ai 96
kbit/s, e il suono di sistema che accompagna quello che stai mostrando o non
parte o parte a meta'. Ognuna di quelle tre cose e' una scelta economica di chi
paga la banda, non un limite tecnico. Su un NAS in casa la banda la paghi tu, e
allora quelle scelte le fai tu.

---

## Come sta insieme

```
   talk.dominio.it  ─┐   (record A grigi, DNS-only)
   sfu.dominio.it   ─┤
                     ▼
                   :443                   ┌────────── il tuo server ──────────┐
  app ─ HTTPS ─────────────────────────▶  │  proxy ──── talk.* ─▶ :8080       │
  (chi entra, quali stanze, il gettone)   │                       pulse-talk  │
  app ─ WSS ───────────────────────────▶  │  proxy ──── sfu.*  ─▶ :7880       │
  (chi c'è, quali codec, le chiavi)       │                       livekit     │
                                          │                                   │
  app ─ UDP 7882 ──────────────────────▶  │  livekit                          │
  (audio, video, schermo)                 │                                   │
  app ─ TCP 7881 ──────────────────────▶  │  livekit                          │
  (ripiego se l'UDP è bloccato)           └───────────────────────────────────┘
```

**Il TLS lo fa il reverse proxy che c'e' gia' sulla macchina** — due Proxy Host
da aggiungere, e le istruzioni stanno in [`deploy/proxy.md`](deploy/proxy.md).

PulseTalk non sa che esista e non lo cerca: pubblica le sue porte
sull'indirizzo della macchina, e il proxy le raggiunge come raggiungerebbe
qualunque altro servizio. Nessuna rete condivisa, nessun volume in comune,
nessun ordine di avvio. `docker compose up` qui funziona anche col proxy spento:
semplicemente, da fuori non risponde nessuno.

Le istruzioni sono scritte per Nginx Proxy Manager perche' e' quello che gira
qui, ma non c'e' niente di specifico: due nomi, un certificato, il supporto
WebSocket acceso e i buffer disattivati. Con Caddy, Traefik o nginx a mano
cambiano le parole, non le quattro cose da dire.

**Niente tunnel, e vale la pena dire perche' no.** Un tunnel (Cloudflare o
simili) sembra la scelta ovvia per non aprire porte, e qui non guadagnerebbe
niente: le porte del media vanno aperte comunque, perche' l'audio e il video
non passano da nessun proxy. In cambio di zero aggiungerebbe un container da
tenere aggiornato, un salto attraverso un datacenter su ogni connessione, e una
spunta "WebSocket" da ricordarsi di accendere in un pannello.

**Dal proxy passa solo il discorso preliminare.** Segnalazione: chi sei, che
codec parli, con quale chiave cifriamo. Qualche kilobyte per chiamata. I frame
veri non toccano ne' Caddy ne' nessun altro proxy — escono dalla 7882 e vanno
diretti, cifrati con DTLS-SRTP, con le chiavi scambiate in quella segnalazione.
Un pacchetto audio che aspetta la ritrasmissione di quello prima e' un pacchetto
arrivato tardi, cioe' inutile: per quello il media non tollera nessun
intermediario, e per quello la 7882 non e' opzionale.

**La SFU non transcodifica.** Riceve i pacchetti e li ripete a chi ascolta,
senza decodificarli. Un 4K60 le costa quanto un 480p — banda, non processore —
ed e' l'unica ragione per cui tutto questo puo' girare accanto agli altri
servizi invece che su una macchina dedicata.

### I due record DNS vanno grigi

`talk.*` e `sfu.*` sono record `A` verso l'IP della tua linea. Se il DNS lo
tieni su Cloudflare, lasciali con la **nuvoletta grigia** — DNS-only, non
proxati — per due ragioni.

La prima e' che le condizioni d'uso di Cloudflare (§2.8) non vogliono video
attraverso il proxy sui piani non-Enterprise. Qui a rigore non passerebbe video
nemmeno lasciandoli arancioni — i frame vanno in UDP e il proxy non li vedrebbe
comunque — ma non c'e' motivo di avvicinarsi al confine.

La seconda e' che il proxy aggiungerebbe un salto su ogni connessione, e
riporterebbe dentro il timeout di circa cento secondi che Cloudflare applica a
una connessione proxata che resta muta. A quello sarebbe gia' stato risposto —
il flusso SSE dell'atrio manda un battito ogni venti secondi, e il WebSocket di
LiveKit ha il suo ping ogni trenta — ma e' un problema che con la nuvoletta
grigia semplicemente non esiste.

Il prezzo, ed e' bene saperlo: per questi due nomi l'IP della tua linea e'
visibile a chi li risolve. E' l'unica cosa che si da' in cambio.

**Da non fare:** mettere una policy di accesso SSO davanti a `talk.*`.
Sembra prudente e romperebbe tutto — quelle policy vogliono cookie e sessione
di browser, mentre l'app installata si autentica con un Bearer token e di
sessioni browser non ne ha. L'accesso e' gia' chiuso a monte dai codici di
invito.

---

## Come e' fatto dentro

```
spazio "Casa"
├── generale          canale di testo   storico, allegati, reazioni, ricerca
├── Salotto           canale vocale     4K60, audio a 510 kbit/s, piu' schermi
└── categoria "Lavoro"
    ├── progetti      canale di testo
    └── Officina      canale vocale (palco: parlano gli admin)
```

Gli **spazi** sono quelli che Discord chiama server. I **canali** stanno dentro,
raggruppati in categorie, e sono di due tipi soli — si legge o si parla.

L'accesso funziona al contrario di Discord: li' ci si registra liberamente e poi
serve un invito per entrare in un server; qui **l'invito serve per esistere**, e
da quel momento in poi si ha un nome utente e una password propri. La differenza
conta perche' questo server sta su internet e ha dentro le conversazioni di
quattro persone: una rotta di registrazione aperta sarebbe una porta da
difendere per sempre, e cosi' invece non c'e' proprio.

**La voce resta collegata mentre si naviga.** Si entra in un canale vocale, si
va a leggere una chat in un altro canale, e si continua a parlare — con una
barretta in basso a sinistra che lo ricorda. E' la cosa che ha richiesto piu'
lavoro di tutte, perche' vuol dire che la sessione WebRTC non puo' vivere dentro
alla schermata che la mostra.

## Cosa toglie

|  | Discord | PulseTalk |
|---|---|---|
| Schermo | tetto legato all'abbonamento, qualche Mbit/s | **4K60 a 50 Mbit/s**, e il numero lo scrivi nel `.env` |
| Cosa cade quando la banda stringe | la risoluzione: il testo sparisce per primo | **i fotogrammi**: il puntatore scatta, il codice resta leggibile |
| Voce | 96 kbit/s mono, 384 col boost massimo | **510 kbit/s stereo**, cioe' il massimo che Opus accetta |
| Filtri sul microfono | sempre accesi | **spegnibili tutti**: una chitarra non viene scambiata per rumore |
| Audio di sistema | a fatica, e non sempre | **loopback di Windows**, una voce in un menu |
| Schermi per persona | uno | **quattro**, configurabile |
| Codec | quello che decide il server | **VP9, AV1, H.264 o VP8**, per preset |
| Persone per canale | un tetto per canale | **nessun limite fisso** |
| Dove finiscono i messaggi | sui loro server | **sul tuo NAS**, con la ricerca dentro |
| Vedere cosa sta arrivando davvero | no | **risoluzione, fps, bitrate e codec veri** sopra a ogni riquadro |

L'ultima riga e' quella che tiene in piedi tutte le altre. I numeri sui riquadri
non vengono dalle impostazioni: vengono da `getStats()`, cioe' dal codificatore.
Se chiedi 4K60 e ne arrivano 1440p a 24, si vede — e accanto c'e' scritto se a
non farcela e' il processore o la linea.

---

## Installazione

Serve Docker con il plugin compose, su qualunque macchina che resti accesa: un
NAS, un mini PC, un vecchio portatile. Su TrueNAS SCALE Docker c'e' nativo
dalla 24.10 (*Electric Eel*); su Debian, Ubuntu o Synology si installa come al
solito.

**1. La cartella dei dati.** Creane una e annota il percorso — per esempio
`/srv/pulsetalk`, o un dataset se sei su ZFS. Ci finisce dentro un file solo,
`talk.db`: utenti, inviti, stanze. Qualche decina di kilobyte, che non
crescono. Audio e video non toccano mai il disco.

**2. Il port forward.** Sul router, verso l'IP della macchina:

| Porta | Protocollo | A cosa serve |
|---|---|---|
| 7882 | UDP | i pacchetti. Senza questa non c'e' nessuna chiamata. |
| 7881 | TCP | il ripiego per le reti che non lasciano uscire l'UDP. |

La 443 pubblica deve gia' arrivare al reverse proxy: se gli altri servizi che ci
stanno dietro rispondono da fuori, quell'inoltro c'e' e non c'e' niente da fare.

**3. Il DNS.** Due record `A` verso l'IP pubblico della tua linea: `talk` e
`sfu`. Se il DNS e' su Cloudflare, con la **nuvoletta grigia**: arancioni si
aggiunge un salto inutile e ci si riavvicina al confine delle condizioni d'uso.

**4. I segreti.**

```bash
cp .env.example .env
```

Poi riempi `TALK_DATASET`, `PULSE_DOMINIO` e il segreto della SFU, che si genera
con:

```bash
node ../server/src/cli.mjs segreto
```

**Spotify e' facoltativo.** La coda musicale condivisa di PulseTalk funziona
anche senza credenziali. Per comandare il player personale di ogni partecipante
servono `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` e
`SPOTIFY_REDIRECT_URI`; quest'ultimo va registrato identico nel dashboard
Spotify. I comandi di riproduzione richiedono Spotify Premium e non sono una
Jam: l'API pubblica consente di controllare il player autorizzato di ciascuna
persona, non di creare o ritrasmettere una sessione Spotify multiutente. Le app
Spotify in Development Mode sono inoltre limitate agli utenti ammessi nel
dashboard (cinque per le nuove app, secondo le regole 2026); per un pubblico
piu' ampio serve l'Extended Quota Mode. Riferimenti ufficiali:
[Player API](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)
e [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

**L'AI e' facoltativa.** PulseTalk funziona senza. Con una chiave si accendono
AI Chat nel composer, la generazione di immagini, Auto Writer (la trascrizione
di una chiamata) e il riassunto di quella trascrizione. Ogni riga accende una
cosa diversa, e si possono mettere anche solo alcune:

| Variabile | Cosa accende |
|---|---|
| `TALK_AI_API_KEY` | niente da sola: e' la condizione di tutto il resto |
| `TALK_AI_CHAT_MODEL` | AI Chat, e il riassunto di Auto Writer |
| `TALK_AI_WEB_SEARCH=true` | la ricerca web con le fonti in fondo alla risposta |
| `TALK_AI_IMAGE_MODEL` | AI Image |
| `TALK_AI_STT_MODEL` | Auto Writer |

**Non serve OpenAI.** `TALK_AI_BASE_URL` accetta qualunque servizio che parli
il formato compatibile: un Ollama sulla stessa macchina, LM Studio, vLLM, Groq,
OpenRouter. Il dialetto lo sceglie `TALK_AI_FORMATO=auto` guardando
l'indirizzo — l'API Responses sul dominio di OpenAI, `/chat/completions` ovunque
altro — e si forza a mano solo nei casi in mezzo, come un proxy verso OpenAI su
un dominio proprio. Un Ollama in casa costa zero e non manda niente fuori:

```
TALK_AI_BASE_URL=http://192.168.1.10:11434/v1
TALK_AI_API_KEY=ollama
TALK_AI_CHAT_MODEL=llama3.1
```

L'unica cosa che resta solo su OpenAI e' la **ricerca web**: lo strumento vive
dentro all'API Responses e non esiste in `/chat/completions`. Con un modello
locale quell'interruttore resta spento invece di promettere un pulsante che
risponde sempre "non configurato".

Per sapere cosa e' acceso davvero, `GET /api/servizi` risponde con le capacita'
e con il formato scelto — ed e' la prima cosa da guardare quando un modello
risponde 404 invece che con una frase.

**Chi genera le immagini si sceglie a parte.** `TALK_AI_IMAGE_MODEL` accende
quello di OpenAI, che si paga. In alternativa c'e' una Stable Diffusion WebUI in
casa: gratis, e i prompt non escono dalla rete.

```
TALK_IMMAGINI_URL=http://192.168.1.10:7860
```

La WebUI va avviata con `--api`, o risponde 404 e PulseTalk lo dice. Con
`TALK_IMMAGINI_PROVIDER=auto` si preferisce sempre quella locale quando c'e'.

**Perchance non si puo' usare**, e vale la pena scriverlo perche' la domanda
torna. I suoi generatori di immagini sono finanziati dalla pubblicita' mostrata
sulla loro pagina, non c'e' un'API pubblica, e il loro autore ha dichiarato che
non e' possibile usarli da un'API proprio perche' cosi' quella pubblicita' non
verrebbe mostrata. Le loro pagine rispondono 403 anche a un semplice recupero
automatico. Arrivarci lo stesso vorrebbe dire un endpoint interno non
documentato, usato per aggirare il modo in cui quel servizio si paga: resta
nell'elenco dei provider, dichiarato e spento, con questa spiegazione.

**GIF e ricerca immagini** hanno chiavi gratuite e indipendenti. Per le GIF ce
ne sono due e si usa la prima che c'e': `TALK_TENOR_API_KEY` (Tenor, dalla
console di Google Cloud — ma Google non abilita nuovi client Tenor da gennaio
2026, quindi su un'installazione nuova questa strada e' chiusa) oppure
`TALK_GIPHY_API_KEY`, che si chiede a developers.giphy.com. Li' vanno scelte
**API** e non SDK: l'SDK e' una libreria che gira nel client con la chiave
dentro, mentre qui la ricerca la fa il server e la chiave non esce dal NAS. Per
le immagini serve `TALK_UNSPLASH_ACCESS_KEY` (unsplash.com/developers). Senza,
i pannelli dicono che non sono configurati invece di fallire premendo.

**5. I due nomi sul proxy.** Due Proxy Host, uno per `talk.*` e uno per `sfu.*`,
con il certificato, il supporto WebSocket e i buffer disattivati: il dettaglio
sta in [`deploy/proxy.md`](deploy/proxy.md).

**6. Avvio.**

```bash
docker compose up -d --build
```

`--build` e non solo `up -d`: l'immagine di `pulse-talk` si costruisce dal
sorgente qui accanto, e senza quel flag compose riusa quella che trova gia'
fatta. Dopo una modifica al server, un `up -d` liscio riparte con il codice di
prima senza dire niente — e la prima volta che succede si perde mezz'ora a
cercare un errore in un file che sul disco e' gia' corretto.

### I due interruttori da girare insieme

Fra "provo in casa" e "ci entrano gli altri" cambiano due valori, e vanno
cambiati **entrambi**. Girarne uno solo produce un guasto che sembra
inspiegabile: la chiamata si collega e resta muta.

| | prova in rete locale | aperto a internet |
|---|---|---|
| `SFU_URL` nel `.env` | `ws://<ip-locale>:7880` | `wss://sfu.<dominio>` |
| `use_external_ip` in `livekit.yaml` | `false` | `true` |

Il primo dice alle app dove cercare la segnalazione. Il secondo dice alla SFU
quale indirizzo annunciare nei candidati ICE — e con `true` annuncia **solo**
quello pubblico, che da dentro casa quasi nessun router sa rimandare indietro.
Sono la stessa decisione vista da due lati.

**7. La verifica che conta** — da una connessione diversa, non dalla rete di
casa. Con l'hotspot del telefono:

```bash
curl https://talk.<dominio>/salute
```

Poi apri `https://talk.<dominio>` nel browser del telefono, incolla un codice, e
prova a entrare in una stanza. E' l'unico modo per accorgersi di un record
lasciato arancione, o di un port forward che non e' mai stato salvato.

---

## Dare l'accesso a qualcuno

**Dall'app**, che e' il modo normale: *Impostazioni -> Server -> Inviti*,
pagina visibile solo agli admin. Si sceglie il ruolo, per quante persone e per
quanti giorni, e si ottiene un codice piu' un link pronto da mandare — che apre
PulseTalk con il codice gia' compilato. Sta li' e non sotto al proprio account
perche' e' amministrazione dell'istanza: chi crea un invito decide chi entra e
con quali poteri, ed e' la stessa materia delle chiavi dei servizi.

**Dalla riga di comando**, se si e' gia' dentro al NAS:

```bash
docker compose exec pulse-talk node src/cli.mjs invita --ruolo membro --usi 3
```

Il codice non e' recuperabile dopo: il database ne conserva solo l'impronta,
come per i token. Se si perde, se ne genera un altro e si annulla il vecchio.

Chi lo riceve sceglie **nome utente e password**, e da quel momento entra da
qualunque dispositivo senza piu' codici.

| Ruolo | Cosa puo' fare |
|---|---|
| `ospite` | entra, ascolta, guarda, scrive nei canali di testo |
| `membro` | anche trasmettere: voce, camera, schermo |
| `admin` | anche creare spazi e canali, moderare, invitare |

```bash
docker compose exec pulse-talk node src/cli.mjs elenca
docker compose exec pulse-talk node src/cli.mjs spazi
docker compose exec pulse-talk node src/cli.mjs revoca --utente 3
```

**Sulla revoca c'e' una cosa da sapere.** Vale dalla richiesta successiva al
piano di controllo, ma un gettone della SFU gia' consegnato resta valido fino a
scadenza — sei ore di serie. Per tagliare fuori qualcuno che sta parlando
*adesso*, va cacciato dalla stanza: quello ha effetto immediato, perche' lo
esegue la SFU.

---

## L'app

Due modi di entrare, dallo stesso sorgente.

**Nel browser**: `https://talk.<dominio>` e basta. Il piano di controllo serve
anche l'interfaccia. Funziona tutto tranne due cose: il selettore delle sorgenti
e' quello di Chrome, e l'audio di sistema c'e' solo se l'utente lo spunta nella
finestra di Chrome — su Windows, e solo condividendo uno schermo intero.

**Installata** (Windows): sa fare anche quelle due. Il selettore mostra le
anteprime con la risoluzione vera accanto, l'audio di sistema e' una voce in un
menu, il token sta cifrato con la DPAPI invece che in `localStorage`, e le
scorciatoie per il muto funzionano anche con l'app dietro a tutto — che e'
esattamente il momento in cui servono.

```powershell
npm --prefix app install
```

```powershell
npm --prefix app run dist:installer
```

L'installer esce in `app/release/`.

**Installata (Android):** usa lo stesso server, account, messaggi, spazi,
allegati e chiamate voce/video dell'app desktop. Sui telefoni la navigazione diventa un
pannello a tutta larghezza, chat e sala occupano lo schermo disponibile e il
tasto Indietro chiude prima pannelli e chiamate. Una chiamata attiva resta
segnalata da una notifica anche quando PulseTalk passa in secondo piano.

Per compilare l'APK servono Android Studio (con Android SDK 36) e Java 17. Metti
l'indirizzo pubblico HTTPS del server in `app/server.local`, una riga sola e
senza barra finale, poi esegui:

```powershell
npm --prefix app install
npm --prefix app run android:apk
```

L'APK di prova esce in
`app/android/app/build/outputs/apk/debug/app-debug.apk`. E' una build debug:
serve per provarla sui tuoi dispositivi, non per pubblicarla sul Play Store.

Per l'emulatore, apri il progetto Android e premi **Run** su un telefono
virtuale:

```powershell
npm --prefix app run android:open
```

Per un telefono vero, abilita *Opzioni sviluppatore → Debug USB*, collegalo e
installa l'APK con:

```powershell
adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk
```

In alternativa puoi copiare l'APK sul telefono e aprirlo, autorizzando per
quella volta l'installazione da origine sconosciuta. Alla prima apertura Android
puo' chiedere l'accesso ai dispositivi vicini; microfono e fotocamera vengono
chiesti quando li usi.

Per una prova completa conviene controllare, nell'ordine: accesso; invio e
ricezione di messaggi e allegati; messaggi diretti; ingresso in un canale
vocale; muto e uscita audio; videocamera; passaggio a un'altra app mentre la
chiamata continua; rientro tramite notifica; condivisione dello schermo.
Quest'ultima usa `MediaProjection`: Android mostra ogni volta il proprio
consenso e mantiene una notifica finche' la cattura e' attiva. Viene condiviso
il video dello schermo, non l'audio riprodotto dalle altre app.

Sul telefono `localhost` indica il telefono stesso, non il PC. Usa quindi il
dominio HTTPS pubblico di PulseTalk; per un server di sviluppo in LAN usa
l'indirizzo del PC e un certificato considerato valido dal dispositivo.

**Prima di compilarla per gli altri**, conviene scriverci dentro il tuo server.
In [`app/src/shared/predefiniti.ts`](app/src/shared/predefiniti.ts) c'e' una
riga sola:

```ts
export const SERVER_PREDEFINITO = 'https://talk.<dominio>'
```

Vuota — com'e' nel repository — la schermata d'accesso chiede l'indirizzo, ed e'
giusto cosi' per chiunque scarichi questo progetto. Riempita, chi riceve la tua
app deve incollare **solo il codice di invito**: l'indirizzo del server e' una
cosa che sai tu, non lui, e chiederglielo significa doverglielo dettare — e
sbagliarlo. Resta comunque cambiabile a mano, sotto "Cambia server". Se `npm install` lascia
`node_modules/electron` senza `dist/`, il binario si scarica a parte:

```powershell
node app/node_modules/electron/install.js
```

E per ricostruire l'interfaccia web che il server serve, in `server/public`:

```powershell
npm --prefix app run build:web
```

---

## Le API

Tutto sotto `/api` vuole `Authorization: Bearer <token>`, tranne il riscatto.

```
POST   /api/auth/invito                  cosa da', senza consumarlo  (aperta)
POST   /api/auth/riscatta                codice → account            (aperta)
POST   /api/auth/accedi                  utente e password → token   (aperta)
GET    /api/auth/io
POST   /api/auth/esci                    chiude questa sessione
POST   /api/auth/completa                per gli account senza password
POST   /api/auth/password                {vecchia, nuova}
POST   /api/auth/profilo                 {nome, avatar}
GET    /api/auth/sessioni                i dispositivi collegati
POST   /api/auth/sessioni/:id/revoca
GET    /api/utenti                       nomi e foto di tutti        ospite
GET    /api/config                       sfuUrl, i tetti             ospite

POST   /api/inviti                       crea un codice              admin
GET    /api/inviti                       quelli ancora validi        admin
DELETE /api/inviti/:id

GET    /api/spazi                        spazi, canali, non letti    ospite
GET    /api/eventi                       tutto cio' che succede (SSE) ospite
POST   /api/spazi                        crea                        admin
DELETE /api/spazi/:id
GET    /api/spazi/:id/membri
POST   /api/spazi/:id/membri             {utente}                    admin spazio
DELETE /api/spazi/:id/membri/:utente
POST   /api/spazi/:id/categorie          {nome}                      admin spazio
DELETE /api/spazi/:id/categorie/:cat
POST   /api/spazi/:id/canali             {nome, tipo, ...}           admin spazio
PATCH  /api/canali/:id
DELETE /api/canali/:id

POST   /api/canali/:id/entra             → gettone per la SFU        ospite
POST   /api/canali/:id/caccia            {identita}                  admin spazio

GET    /api/canali/:id/messaggi          ?prima=&quanti=             ospite
POST   /api/canali/:id/messaggi          {testo, rispondeA, allegati} membro
PATCH  /api/messaggi/:id                 solo i propri
DELETE /api/messaggi/:id                 i propri, o da admin
POST   /api/messaggi/:id/reazioni        {emoji} — due volte toglie
POST   /api/canali/:id/letto             {fino}
GET    /api/spazi/:id/cerca              ?q=&canale=                 ospite

POST   /api/allegati                     corpo grezzo, x-nome        membro
GET    /api/allegati/:id

POST   /api/allegati/inizio               x-nome, x-tipo, x-dimensione membro
PUT    /api/allegati/:id/pezzo            corpo grezzo, x-offset      membro
GET    /api/allegati/:id/stato            dove riprendere             membro
POST   /api/allegati/:id/fine             chiude e crea l'allegato    membro

POST   /webhook/sfu                      da LiveKit, firmato
GET    /salute
```

---

## Quattro scelte che vale la pena conoscere

**Il permesso di moderare non sta nel gettone.** LiveKit avrebbe un flag
`roomAdmin` che lo metterebbe li' dentro, e cacciare qualcuno diventerebbe una
chiamata diretta alla SFU senza passare da noi. Non lo usiamo: un gettone dura
sei ore, e un admin revocato continuerebbe a cacciare la gente per il resto
della giornata. Moderare passa dalle nostre rotte, che guardano il ruolo nel
database a ogni richiesta.

**Niente simulcast sullo schermo, simulcast sulla camera.** Sono la stessa
funzione con due esiti opposti. Sulla camera produce copie a 360p che salvano
chi ha la linea lenta: un volto a bassa risoluzione resta un volto. Sullo
schermo produce copie in cui il testo non si legge, che nessuno guardera' mai, e
costa meta' della banda per farle. Al loro posto, su VP9 e AV1, restano i
livelli temporali: chi non ce la fa riceve meno fotogrammi, non meno pixel.

**I parametri vengono riscritti dopo la pubblicazione.** Fra quello che si
chiede e quello che parte ci sono livekit-client, che applica i suoi massimi, e
Chrome, che applica i suoi. Dopo aver pubblicato, `pubblica.ts` prende
l'`RTCRtpSender` e ci riscrive sopra bitrate, fotogrammi, preferenza di
degradazione e `scaleResolutionDownBy = 1`. E' l'ultimo anello prima del
codificatore, ed e' il motivo per cui uno schermo 4K arriva davvero a 4K.

**Un flusso solo per persona, e ci passa tutto.** Messaggi, reazioni, canali
creati, chi entra in un vocale: sono cose diverse che devono arrivare nello
stesso istante alle stesse persone. Con un flusso per argomento servirebbero
cinque connessioni aperte a testa, ognuna con la sua riconnessione e il suo
battito. Ed e' SSE e non WebSocket per la stessa ragione dell'atrio di prima:
e' traffico a senso unico, e passa da qualunque proxy come una risposta HTTP che
non finisce mai.

**Il nome di un allegato sul disco e' l'impronta del suo contenuto**, come
due persone che mandano lo stesso meme occupano lo spazio di una. Il
file si carica *prima* del messaggio — si trascina un'immagine, il caricamento
parte, e intanto si finisce la frase — e quelli che non vengono mai mandati li
spazza via un giro ogni sei ore.

**Sopra agli otto mega il file sale a pezzi.** Il tetto e' 4 GB
(`TALK_MAX_ALLEGATO`), il pezzo 8 MB (`TALK_PEZZO_ALLEGATO`), e i pezzi servono
a tre cose che una richiesta sola non sa fare: riprendere da dove si era
arrivati quando la linea cade, dire a che punto e', e **fermarsi in mezzo** —
perche' fra un pezzo e l'altro c'e' un istante in cui non si sta mandando
niente, ed e' li' che il client rallenta da solo mentre c'e' una chiamata
aperta. I byte pero' restano quelli: quattro giga passano per lo stesso cavo,
spezzati o interi. I tronconi mai finiti li butta via lo stesso giro che spazza
gli allegati orfani, dopo un giorno.

**Eliminare un messaggio lascia il posto vuoto**, non fa sparire la riga. Se la
riga sparisse, sparirebbero anche le risposte che la citano, e chi legge si
troverebbe una conversazione con dei buchi che non tornano.

**Le due spunte dicono due cose diverse.** Una spunta: il messaggio e' sul
server. Due grigie: e' arrivato all'apparecchio dell'altra persona. Due
colorate: l'ha aperto. La seconda spunta la mette il server guardando se il
flusso di quella persona e' aperto, non chiedendolo alla sua applicazione — se
lo chiedesse, il destinatario deciderebbe da solo se risultare raggiungibile, e
quella spunta smetterebbe di voler dire qualcosa. Vale solo per le
conversazioni dirette: in un canale con quaranta persone "gli e' arrivato" non
e' una domanda con una risposta sola.

**A toglierlo, pero', e' solo chi lo ha scritto.**
 Non esiste un permesso per
cancellare i messaggi degli altri, e nemmeno il proprietario dello spazio ce
l'ha: chi amministra modera le persone e i canali — allontana, toglie
l'accesso, chiude un canale — non il testo altrui. Modificare, a maggior
ragione: un messaggio riscritto da qualcun altro sarebbe una cosa che uno non
ha detto, con sopra il suo nome.

L'unica riga senza un padrone umano e' la risposta dell'AI, che ha per autore
il bot dello spazio. Il bot non fa login, quindi quella riga non la
cancellerebbe piu' nessuno: se la riprende chi se l'e' fatta scrivere, ed e'
per questo che il messaggio si porta dietro `richiestoDa`.

---

## Sviluppo

Da PowerShell — niente `&&`, che in Windows PowerShell non esiste:

```powershell
npm --prefix server install; npm --prefix server test
```

I test girano su socket veri, non con `inject()` di Fastify. La ragione e' la
questa: qui c'e' un flusso SSE che resta aperto, ed e'
esattamente la cosa che `inject()` non sa rappresentare. Se l'atrio smettesse di
aggiornarsi, nessun test che finge una richiesta se ne accorgerebbe.

Sessantaquattro prove, e coprono: gli inviti monouso, a piu' usi, scaduti e
annullati; il fatto che un errore di battitura **non** bruci un codice che vale
una volta sola; le password, il cambio che chiude le altre sessioni, e il non
distinguere un utente inesistente da una password sbagliata; i permessi per
spazio, compreso il 404 — e non 403 — a chi non ne fa parte; i gettoni
verificati con il verificatore vero di LiveKit, l'assenza di `roomAdmin`, il
palco; i messaggi con le pagine all'indietro, le citazioni che non attraversano
i canali, e l'eliminazione che lascia il posto; le reazioni, la ricerca con gli
apostrofi che manderebbero in errore FTS5; gli allegati, compreso il tentativo
di appropriarsi di quello di un altro; il flusso degli eventi su un socket vero;
e la migrazione dalla versione con le stanze, che gira una volta sola e non
perde niente.

E tutto **con la SFU spenta**, che e' lo stato in cui si trova chiunque stia
installando tutto per la prima volta.

Per provare a mano senza inventarsi dei token:

```bash
TALK_ROOT=./dati TALK_NO_AUTH=1 npm start
```

`TALK_NO_AUTH` rende tutti amministratori. Il server lo scrive nel log
all'avvio a caratteri cubitali. Non usarlo su una macchina raggiungibile.

Per l'app:

```powershell
npm --prefix app run dev
```

```powershell
npm --prefix app run dev:web
```

Il primo apre Electron con il ricaricamento a caldo, il secondo la stessa
interfaccia nel browser sulla porta 5174.

---

## Cosa non fa

- **Non cattura l'audio di una singola applicazione.** Prende tutto quello che
  esce dalla scheda audio. Windows un'API per-applicazione ce l'ha, ma Electron
  non la espone e arrivarci vorrebbe dire un modulo nativo. Il giro che funziona
  oggi: in Windows 11, *Impostazioni → Sistema → Audio → Mixer volume* lascia
  mandare una singola applicazione a un dispositivo di uscita diverso; con un
  cavo audio virtuale come VB-Cable, quel dispositivo diventa un microfono
  selezionabile in PulseTalk.

- **Non fa 4:4:4.** WebRTC non ha un profilo con la crominanza piena, in nessun
  codec. Il testo rosso su fondo nero resta appena morbido anche a 50 Mbit/s, e
  non e' il bitrate: e' il sottocampionamento. L'unico rimedio e' quello che
  facciamo gia', cioe' catturare alla risoluzione nativa senza ridurre niente.

- **Non registra.** Nessun file finisce sul NAS. LiveKit avrebbe un Egress che
  lo saprebbe fare, e sarebbe un quarto container.

- **Non cifra da capo a capo.** I pacchetti sono cifrati sulla tratta con
  DTLS-SRTP, ma la SFU li vede in chiaro — deve, per poterli smistare. LiveKit
  supporta l'E2EE con le insertable streams; accenderlo e' un lavoro a parte, e
  vorrebbe dire distribuire una chiave fuori banda.

- **Non nasconde il tuo indirizzo di casa.** Chi entra in una chiamata riceve i
  candidati ICE della SFU, e li' dentro c'e' l'IP pubblico. E' inevitabile per
  chiunque faccia media diretto, ed e' un dato che si da' solo a chi ha gia' un
  codice di invito.

- **Non attraversa una rete che lascia uscire solo la 443.** L'UDP ha il
  ripiego TCP sulla 7881, ma una porta non standard resta una porta non
  standard. Coprire anche quel caso vorrebbe dire un TURN su TLS sulla 443, con
  il suo certificato: si puo' fare, e in `livekit.yaml` c'e' il blocco pronto e
  commentato con scritto perche' oggi e' spento.

## Chi c'e', e chi non c'e'

Lo stato di una persona nasce da due cose che si incontrano: quella che ha
scelto lei, e quella che sa il server.

Il server ne sa una sola, e non ha bisogno che nessuno gliela dica: **il flusso
degli eventi e' aperto oppure no**. Chiudere l'applicazione lo chiude, e la
persona sparisce senza che qualcuno debba ricordarsi di annunciarlo. Prima non
era cosi': lo stato era solo una parola salvata sull'utente, e chi si era messo
"online" restava online per sempre — a computer spento, dopo tre giorni.
L'unico modo per sapere se valeva la pena scrivere a qualcuno era scrivergli.

Le tre regole che decidono cosa vedono gli altri:

**Invisibile non si dice mai.** Da fuori e' indistinguibile da offline, ed e'
l'unico modo perche' invisibile serva a qualcosa. Per un pezzo non ha
funzionato affatto, e per una ragione stupida: l'elenco dei profili leggeva
tutte le colonne tranne `stato`, non lo trovava, e ripiegava su "online" per
chiunque — compreso chi si era appena messo invisibile proprio per non
comparire. Il valore di ripiego era quello giusto per quasi tutte le righe, ed
e' per questo che non se n'era accorto nessuno.

**Non disturbare resta anche da spenti.** E' l'unico stato che sopravvive alla
chiusura: chi lo mette la sera lo mette proprio perche' non vuole essere
cercato, e vederlo diventare "offline" alle due di notte non cambierebbe niente
per lui, ma toglierebbe la risposta a chi guarda. "Non c'e'" e "non vuole" sono
due cose diverse. Anche qui c'era un pezzo che mancava: la sessione non
rileggeva `stato`, quindi chi si metteva "non disturbare" la sera riapriva il
giorno dopo trovandosi online — il valore era salvato correttamente sul disco,
e' che nessuno andava a riprenderlo.

**Inattivo non si sceglie.** Lo mette l'applicazione dopo dieci minuti con il
microfono spento o sempre sotto la soglia dell'automute. Sceglierlo a mano non
aveva senso — dire "non sono davanti allo schermo" premendo un pulsante e' una
contraddizione — ed era anche una bugia comoda, perche' restava li' anche
mentre si parlava.

## Gli identificativi dei dispositivi cambiano sotto i piedi

`deviceId` non e' l'identificativo di un microfono: e' un'impronta calcolata su
un sale che dipende dall'**origine della pagina**. Cambia l'origine, cambiano
tutti gli id in blocco — stesso microfono, stringa diversa.

All'applicazione installata succedeva a ogni avvio. L'interfaccia si serve da
`http://127.0.0.1` (vedi `main/sito.ts`) e la porta la sceglieva il sistema:
porta diversa ogni volta, origine diversa ogni volta, e quindi la camera scelta
ieri non corrispondeva a niente stamattina. Si vedeva in due modi — un avviso
"il dispositivo scelto non risponde" a ogni partenza, e la stessa camera
elencata due volte nella tendina, una vera e una fantasma.

Adesso la porta e' fissa, con nove alternative se qualcuno l'ha occupata. E
siccome il sale puo' cambiare comunque — basta ripulire i dati del sito — la
scelta salvata si ritrova anche per nome: se c'e' un dispositivo di quel tipo
che si chiama esattamente come quello scelto, e' quello, e l'id nuovo diventa
il suo. Uno solo con quel nome, pero': con due webcam identiche il nome non
distingue piu' niente, e tirare a indovinare fra le due sarebbe peggio che
ammettere di non sapere.
