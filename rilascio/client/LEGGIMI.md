# Il lato client

Qui non ci sono file da scaricare, e la ragione sta scritta in
[`../LEGGIMI.md`](../LEGGIMI.md): l'applicazione e' un eseguibile da cento
megabyte, e un repository non e' il posto dove tenerlo. Sta fra gli allegati
delle release.

## Dove si scarica

[**Pagina delle release**](https://github.com/FilippoCaio/PulseTalk/releases) →
l'ultima, sezione *Assets*.

| | |
|---|---|
| `PulseTalk-Setup-X.Y.Z.exe` | **quello normale.** Si installa, mette il collegamento, e si aggiorna da solo |
| `PulseTalk-portable-X.Y.Z.exe` | un file solo, si apre e basta. **Non si aggiorna**: l'app lo sa e lo dice, invece di provarci |
| `latest.yml`, `.blockmap` | non si scaricano a mano: servono all'aggiornamento automatico |

Windows non firmato mostra SmartScreen alla prima apertura: *Ulteriori
informazioni → Esegui comunque*. Non c'e' modo di evitarlo senza un certificato
di firma, che costa qualche centinaio di euro all'anno.

### Senza installare niente

Ogni server di PulseTalk serve anche **l'app come pagina web**, allo stesso
indirizzo: `https://talk.<dominio>/`. Funziona, e per una prova veloce e' la via
piu' corta.

Quello che il browser non puo' dare, e che l'applicazione installata da, e' la
**cattura dell'audio di sistema** insieme allo schermo — su Windows passa da
un'API che una pagina web non ha. Se stai condividendo qualcosa che si sente,
serve l'applicazione.

## La prima apertura

Non c'e' nessun indirizzo gia' scritto dentro, ed e' voluto: questo installer non
appartiene a nessun server in particolare.

1. **Prima il server.** L'app chiede l'indirizzo (`talk.tuodominio.it`) e prova
   a raggiungerlo prima di andare avanti, cosi' un refuso si vede subito invece
   che tre schermate dopo.
2. **Poi l'account**, su quel server. Gli account non sono globali: sono di
   quell'istanza, e serve un codice d'invito, che te lo da' chi amministra —
   oppure te lo dai da solo con `node src/cli.mjs invita`, se il server e' tuo.

L'indirizzo si cambia dopo, da **Impostazioni → Server**, e piu' server possono
convivere.

## Come si aggiorna

Da solo, e senza interrompere niente:

- al primo avvio l'app chiede al server se c'e' qualcosa di nuovo;
- se c'e', lo dice con un avviso in alto che si puo' chiudere;
- lo scarica sotto, con la barra di avanzamento in **Impostazioni →
  Aggiornamenti**;
- quando e' pronto, chiede di riavviare. L'installazione e' **silenziosa**:
  nessuna finestra dell'installer, nessuna richiesta di amministratore. Si
  installa per utente, in `%LOCALAPPDATA%\Programs`, e li' non serve il permesso
  di nessuno.

Scarica solo i pezzi cambiati, non i cento megabyte ogni volta.

**Il pulsante «installa» resta spento durante una chiamata**, e lo dice: un
riavvio a meta' di una conversazione e' esattamente il momento sbagliato.

### Da dove arrivano gli aggiornamenti

Da chi ospita il server, non da qui.

L'installer nasce con un indirizzo segnaposto, e quando si collega a un server
gli chiede dove cercare: **la risposta del server vince** su quello incorporato.
Un'istanza che pubblica i propri installer aggiorna i propri utenti senza passare
da GitHub, e senza che nessuno debba tenere pubblico un repository.

Un server che non pubblica niente non e' un guasto: l'app se ne accorge e sta
zitta, invece di mostrare un errore a chi non puo' farci niente.

Come si serve un feed dalla propria istanza sta in
[`docs/NAS.md`, sezione *Servire gli aggiornamenti*](https://github.com/FilippoCaio/PulseTalk/blob/main/docs/NAS.md#servire-gli-aggiornamenti-dellapplicazione-dalla-tua-istanza).
In breve: i tre file (`.exe`, `.blockmap`, `latest.yml`) nella cartella
`dati/aggiornamenti/`, che il server espone su `/aggiornamenti`.

### Aggiornamenti obbligatori

Un server puo' dichiarare una versione minima (`TALK_CLIENT_MIN` nel suo `.env`).
Chi ha qualcosa di piu' vecchio non entra: vede una schermata che spiega perche' e
un pulsante che aggiorna.

E' l'unico caso in cui l'aggiornamento blocca, ed e' prima dell'accesso — mai a
sessione avviata.

## Compilarselo

```sh
cd app
npm ci
npm run dist:installer     # esce in app/release/
```

Serve Node 22 o piu' recente, e Windows: `electron-builder --win` non produce un
`.exe` da un'altra parte.

Per cuocerci dentro l'indirizzo del proprio server e il proprio feed, invece di
lasciarli vuoti:

```sh
echo "https://talk.tuodominio.it" > app/server.local
```

`server.local` e `nas.local` stanno fuori da git di proposito: sono la rete di
casa di qualcuno, e non sono un valore predefinito per nessun altro.
[`rilascia-nas.ps1`](https://github.com/FilippoCaio/PulseTalk/blob/main/rilascia-nas.ps1)
compila e carica i tre file sul proprio server in un comando.

## Android

C'e' un progetto Capacitor in [`app/android`](https://github.com/FilippoCaio/PulseTalk/tree/main/app/android),
e si compila con `npm run android:apk`. Non e' fra gli allegati delle release:
funziona, ma non ha ricevuto le stesse ore di prova del client Windows, e
allegarlo lo farebbe sembrare altrettanto pronto.
