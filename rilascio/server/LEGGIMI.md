# Il lato server

Tutto quello che serve per far girare PulseTalk su una macchina tua. Sono sei
file, e non ce n'e' nessun altro da andare a cercare.

```
docker-compose.nas.yml   i due servizi: il piano di controllo e la SFU
livekit.yaml             la configurazione della SFU
installa.sh              fa le domande e scrive .env e livekit.yaml
.env.example             tutte le manopole, spiegate una per una
proxy.md                 le due voci da aggiungere al reverse proxy
truenas.yaml             la strada alternativa, se la macchina e' un TrueNAS
```

Scarica **`pulsetalk-server-X.Y.Z.zip`** dalla
[pagina delle release](https://github.com/FilippoCaio/PulseTalk/releases), o
prendi questa cartella dal repository. E' la stessa roba.

## Cosa deve esserci sulla macchina

- **Docker con il plugin compose.** `docker compose version` deve rispondere.
- **Una cartella per i dati.** Bastano pochi megabyte: dentro ci va `talk.db`,
  che e' l'unica copia di account, spazi e messaggi. Mettila dove vengono fatti
  gli snapshot.
- **Le porte 7880, 7881 e 7882 libere.** La SFU sta sulla rete dell'host, non
  dietro al NAT di Docker — a cinquanta megabit al secondo quella riscrittura
  diventerebbe il collo di bottiglia.

## L'installazione

```sh
chmod +x installa.sh
./installa.sh
```

Fa sette domande, genera i segreti con `openssl` invece di inventarli, scrive
`.env` con i permessi giusti, gira l'interruttore in `livekit.yaml`, e tira su i
container. Alla fine dice le due cose che non puo' fare da solo — perche' sono
le due che, sbagliate da uno script, lasciano una macchina aperta da fuori senza
che nessuno se ne accorga:

- **il port forward sul router**: `7881/TCP` e `7882/UDP` verso questa macchina;
- **i due record DNS**: `talk.<dominio>` e `sfu.<dominio>`, piu' le due voci nel
  reverse proxy — che stanno in [`proxy.md`](proxy.md).

### A mano, se preferisci

```sh
cp .env.example .env      # poi aprilo: le righe da riempire sono segnate
docker compose -f docker-compose.nas.yml up -d
```

### Su un TrueNAS

[`truenas.yaml`](truenas.yaml) e' lo stesso identico impianto in un file solo,
da incollare in **Apps → Discover Apps → ⋮ → Install via YAML**. Da li' in poi
PulseTalk compare fra le app installate come tutte le altre. Le righe da
cambiare sono sei, e sono tutte segnate con `⇦ CAMBIA`.

(Non e' un catalogo da aggiungere: TrueNAS ha tolto i cataloghi di terze parti
con la 24.10 e non li ha piu' rimessi. Install via YAML e' la strada che indica
iX stessa, e funziona adesso.)

## I due interruttori che si girano insieme

Sono la causa piu' comune di una chiamata che **si collega e resta muta**, senza
nessun errore da nessuna parte:

| | `SFU_URL` (nel `.env`) | `use_external_ip` (in `livekit.yaml`) |
|---|---|---|
| da internet | `wss://sfu.<dominio>` | `true` |
| solo rete locale | `ws://<ip-della-macchina>:7880` | `false` |

Con `true` la SFU annuncia **soltanto** il proprio indirizzo pubblico, e un
computer nella stessa casa proverebbe a raggiungerlo uscendo e rientrando — cosa
che quasi nessun router domestico sa fare. Con `false` annuncia un `192.168.x.x`,
che da internet non esiste.

`installa.sh` li gira tutti e due insieme, ed e' il motivo per cui esiste.

## Il primo accesso

Non esiste ancora nessun account, e non c'e' una password di serie da
dimenticare di cambiare:

```sh
docker compose -f docker-compose.nas.yml exec pulse-talk node src/cli.mjs invita --ruolo admin
```

Stampa un codice d'invito. Quello serve per creare il primo account
dall'applicazione.

## Aggiornare

```sh
# alza TALK_VERSIONE nel .env, poi:
docker compose -f docker-compose.nas.yml pull
docker compose -f docker-compose.nas.yml up -d
```

`talk.db` non viene toccato: sta fuori dal container e ogni versione lo migra da
sola all'avvio. Le migrazioni aggiungono colonne e tabelle, non ne tolgono —
nessun account, spazio o messaggio si perde.

L'accortezza vera resta una: **prima di un aggiornamento importante, uno
snapshot**. Non perche' ci si aspetti che vada storto, ma perche' quel file e'
l'unica copia di tutto.

## La guida lunga

Questa pagina e' la strada dritta. Quando qualcosa non torna — la chiamata muta,
il proxy che non passa il WebSocket, gli aggiornamenti dell'app serviti dalla tua
istanza — la guida completa e' in
[`docs/NAS.md`](https://github.com/FilippoCaio/PulseTalk/blob/main/docs/NAS.md).

---

I sei file qui sopra sono **copie identiche** di file che vivono in
[`deploy/`](https://github.com/FilippoCaio/PulseTalk/tree/main/deploy) e
[`truenas/`](https://github.com/FilippoCaio/PulseTalk/tree/main/truenas): non
modificarli qui, perche' `rilascio/assembla.ps1` li riscrive.
