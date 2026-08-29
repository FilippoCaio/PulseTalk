# PulseTalk sul tuo NAS

Questa guida parte da «ho un NAS e non ho mai visto questo progetto». Non serve
clonare niente, non serve compilare niente, non serve saper leggere il codice.
Il [README](../README.md) resta il documento del progetto — cosa fa, com'e'
fatto, perche' certe scelte — e rimanda qui per l'installazione.

## Cosa stai per mettere sulla macchina

Due container, e vale la pena sapere cosa fa ciascuno perche' quando qualcosa
non va la differenza dice subito dove guardare.

| | cosa fa | cosa non fa |
|---|---|---|
| **pulse-talk** | decide chi entra e in quale stanza, tiene account, spazi e messaggi | non vede un byte di audio |
| **livekit** | riceve i pacchetti audio/video e li ripete agli altri | non li decodifica, non li ricodifica |

La seconda riga e' il motivo per cui tutto questo gira su un NAS: la SFU non
transcodifica, quindi un 4K60 le costa **banda, non processore**. Un vecchio
i3 con una linea in salita seria regge meglio di un server potente con una
linea lenta.

## Cosa serve avere

- **Docker con il plugin compose.** Su TrueNAS e Synology si abilita dal
  pannello; su un NAS generico si installa.
- **Una cartella per i dati.** Ci finisce `talk.db` — qualche decina di
  kilobyte. Niente registrazioni, niente cache dei media, niente che cresca.
  Mettila su un dataset che fa gli snapshot: e' l'unica copia di account,
  spazi e messaggi.
- **Tre porte libere sul NAS**: `7880`, `7881`, `7882`. La SFU gira sulla rete
  dell'host e quelle non si spostano.
- Se ci si vuole parlare **da fuori casa**: un dominio, un reverse proxy gia'
  sulla macchina, e la possibilita' di inoltrare due porte sul router.

Se ti manca l'ultimo punto, va benissimo lo stesso: si installa in rete locale,
funziona tutto, e si apre a internet dopo. La strada e' la stessa.

---

## L'installazione, in un comando

```sh
curl -fsSLO https://raw.githubusercontent.com/FilippoCaio/PulseTalk/main/deploy/installa.sh
curl -fsSLO https://raw.githubusercontent.com/FilippoCaio/PulseTalk/main/deploy/docker-compose.nas.yml
curl -fsSLO https://raw.githubusercontent.com/FilippoCaio/PulseTalk/main/deploy/livekit.yaml
sh installa.sh
```

Lo script fa le domande che questa guida farebbe leggere: la cartella dei dati,
se ci si collega da internet o dalla rete di casa, la porta, e poi genera il
segreto della SFU, scrive `.env` e `livekit.yaml`, e accende i container.

Non tocca il router, non tocca il DNS, non tocca il reverse proxy — e non perche'
sarebbe difficile: sono le tre cose che, sbagliate da uno script, lasciano una
macchina raggiungibile da fuori senza che nessuno se ne accorga.

### Oppure a mano

Se preferisci vedere cosa succede:

```sh
mkdir -p pulsetalk && cd pulsetalk
curl -fsSLO https://raw.githubusercontent.com/FilippoCaio/PulseTalk/main/deploy/docker-compose.nas.yml
curl -fsSLO https://raw.githubusercontent.com/FilippoCaio/PulseTalk/main/deploy/livekit.yaml

cat > .env <<'FINE'
TALK_DATASET=/mnt/pool/pulsetalk/dati
SFU_API_KEY=pulsetalk
SFU_API_SECRET=<incolla qui il risultato di: openssl rand -hex 32>
SFU_URL=ws://192.168.1.10:7880
FINE

docker compose -f docker-compose.nas.yml up -d
```

E in `livekit.yaml`, `use_external_ip: false` finche' si sta in rete locale.

### Su TrueNAS

TrueNAS ha una strada sua, e una particolarita' che vale la pena sapere prima:
**dalla 24.10 non si possono piu' aggiungere cataloghi di terze parti**, quindi
PulseTalk non comparira' mai in «Discover Apps». Ci si arriva da **Apps →
Discover Apps → ⋮ → Install via YAML**, incollando
[`truenas/pulse-talk.yaml`](../truenas/pulse-talk.yaml) — un file solo,
autosufficiente, con sei righe da cambiare. Da li' in poi l'app compare fra le
installate come tutte le altre, con log, riavvio automatico e stato di salute.

I dettagli e cosa si puo' o non si puo' verificare stanno in
[`truenas/README.md`](../truenas/README.md).

---

## I due interruttori che si girano insieme

E' l'unico punto in cui si sbaglia davvero, e sbagliarlo produce il guasto piu'
difficile da riconoscere: **la chiamata si collega e resta muta**, senza nessun
errore da nessuna parte.

| | `SFU_URL` nel `.env` | `use_external_ip` in `livekit.yaml` |
|---|---|---|
| **rete locale** | `ws://<ip-del-nas>:7880` | `false` |
| **da internet** | `wss://sfu.<dominio>` | `true` |

Perche' e' un aut-aut e non un «anche»: con `true` la SFU annuncia **soltanto**
il proprio indirizzo pubblico, e un computer che sta nella stessa casa proverebbe
a raggiungere l'IP pubblico da dentro casa — cosa che la maggior parte dei router
domestici non sa fare (il *NAT hairpinning*). Con `false` annuncia `192.168.x.x`,
che da internet non esiste.

Si cambia e si riavvia il solo container `livekit`: chi e' in chiamata non se ne
accorge, e i client ricevono i candidati nuovi al prossimo ingresso.

## Le due porte sul router

Solo se ci si vuole parlare da fuori casa:

| porta | cosa ci passa |
|---|---|
| **7882/UDP** | audio, video e schermo |
| **7881/TCP** | il ripiego per le reti che bloccano l'UDP |

**Non passano dal reverse proxy.** Vanno dall'app alla SFU direttamente, cifrate
con DTLS-SRTP. Un proxy davanti non le aiuta, e un tunnel neanche: le porte del
media vanno aperte comunque.

## I due record DNS e le due voci nel proxy

Sempre solo per l'accesso da internet:

```
talk.<dominio>   A   <il tuo indirizzo pubblico>
sfu.<dominio>    A   <il tuo indirizzo pubblico>
```

e nel reverse proxy che gia' gira sulla macchina — Nginx Proxy Manager, Caddy,
Traefik, nginx a mano:

```
talk.<dominio>  ->  http://<ip-del-nas>:8080
sfu.<dominio>   ->  http://<ip-del-nas>:7880    con WebSocket abilitato
```

Le istruzioni per voce sono in [`deploy/proxy.md`](../deploy/proxy.md).

## Il primo accesso

Non esiste nessun account finche' non se ne crea uno, ed e' voluto: un server
che nasce con un `admin/admin` e' un server che qualcuno dimentica di cambiare.

```sh
docker compose -f docker-compose.nas.yml exec pulse-talk node src/cli.mjs invita --ruolo admin
```

Stampa un codice. Si apre `http://<ip-del-nas>:8080` (o `https://talk.<dominio>`),
si incolla il codice, si sceglie nome utente e password.

---

## Aggiornare il server

```sh
docker compose -f docker-compose.nas.yml pull
docker compose -f docker-compose.nas.yml up -d
```

`talk.db` non viene toccato: sta sul volume montato, fuori dal container, e ogni
versione lo migra da sola all'avvio. Le migrazioni aggiungono colonne e non ne
tolgono, e sono idempotenti — rilanciarle non fa niente.

Prima di un aggiornamento importante, **uno snapshot del dataset**. Non perche'
ci si aspetti che vada storto, ma perche' quel file e' l'unica copia di tutto.

Per non farsi aggiornare a sorpresa: in `.env`, `TALK_VERSIONE=1.2.3` invece di
`latest`.

---

## Servire gli aggiornamenti dell'applicazione dalla tua istanza

Questa parte e' facoltativa, e la maggior parte delle installazioni non ne ha
bisogno: chi usa PulseTalk scarica l'applicazione da dove l'ha scaricata la
prima volta, e l'applicazione lo sa. Se il tuo server non serve nessun feed, il
pannello degli aggiornamenti dice *«questo server non pubblica aggiornamenti»* e
si ferma li' — non e' un errore, ed e' scritto in modo che non lo sembri.

Se invece **compili tu l'applicazione** e vuoi che la tua istanza la distribuisca:

1. Crea la cartella `aggiornamenti/` dentro al volume dei dati e **riavvia il
   container**. La rotta `/aggiornamenti` nasce solo se la cartella esiste
   all'avvio.
2. Dal computer su cui compili, scrivi `app/nas.local`:

   ```
   nas=root@192.168.1.10
   cartella=/mnt/pool/pulsetalk/dati/aggiornamenti
   ```

   e `app/server.local` con l'indirizzo pubblico del server, una riga sola.

3. Rilascia:

   ```powershell
   .\rilascia-nas.ps1 -Tipo patch
   ```

   Alza la versione, compila passando l'indirizzo del tuo feed a
   electron-builder, e copia installer, `.blockmap` e `latest.yml` sul NAS.

`latest.yml` e' il file che decide tutto: e' l'elenco che l'applicazione legge
per sapere se e' vecchia. Senza quello, non si aggiorna nessuno anche con
l'installer al suo posto. Il `.blockmap` accanto e' cio' che fa scaricare solo i
pezzi cambiati invece di novantacinque megabyte ogni volta: va caricato, e vanno
lasciati sul NAS anche quelli delle versioni precedenti.

### Obbligare tutti ad aggiornare

Nel `.env`:

```
TALK_CLIENT_TARGET=0.7.0
```

Da quel momento chi apre una versione precedente viene fermato **prima
dell'accesso**, l'aggiornamento si scarica da solo e si installa al riavvio,
senza schermate da leggere.

**Da alzare solo insieme alla pubblicazione**, mai prima: una target che il feed
non sa servire blocca tutti su un errore invece che su un aggiornamento. L'app lo
dice con chiarezza, ma resta fuori lo stesso.

---

## Quando qualcosa non va

**La chiamata entra e resta muta.**
E' quasi sempre i due interruttori qui sopra, oppure `7882/UDP` non inoltrata.
Prova prima in rete locale con `use_external_ip: false`: se li' si sente, il
problema e' fuori dal NAS.

**La chiamata entra e esce subito.**
La stanza non esiste sulla SFU. Guarda i log di `pulse-talk`: se dice «la SFU non
risponde», il piano di controllo non raggiunge `livekit` — controlla che le porte
`7880`, `7881`, `7882` siano libere e che il container `pulse-talk-sfu` sia vivo.

**«manca SFU_API_SECRET nel .env».**
Il `.env` deve stare **accanto** al file compose, non nella cartella dei dati.

**L'app dice che il server richiede una versione piu' nuova.**
`TALK_CLIENT_TARGET` e' stata alzata senza pubblicare l'installer. Riportala
vuota, oppure pubblica.

**Su ARM: «exec format error».**
L'immagine non e' multi-architettura. Quella pubblicata da questo repository lo
e' (`linux/amd64` e `linux/arm64`); se ne stai usando un'altra, e' li' il
problema.
