# I due nomi sul reverse proxy

PulseTalk non termina il TLS e non ci prova: pubblica le sue porte
sull'indirizzo della macchina, e il reverse proxy che hai gia' le raggiunge
come raggiungerebbe qualunque altro servizio. Nessuna rete condivisa, nessun
volume in comune, nessun ordine di avvio.

Qui sotto le istruzioni sono scritte per **Nginx Proxy Manager**, perche' e'
quello che si trova piu' spesso su un NAS. Con Caddy, Traefik o nginx a mano
cambiano le parole, non le quattro cose da dire: due nomi, un certificato, il
supporto WebSocket acceso, i buffer disattivati.

In tutto il documento:

- `<dominio>` e' il tuo dominio,
- `<ip-del-server>` e' l'indirizzo in rete locale della macchina dove gira
  questo compose.

---

## Prima: i due record DNS

Due record `A` verso l'IP pubblico della tua linea:

```
talk   A   <ip pubblico>
sfu    A   <ip pubblico>
```

**Se usi Cloudflare, lasciali con la nuvoletta grigia** (DNS-only, non
proxati), per due motivi. Il proxy aggiungerebbe un salto su ogni connessione,
e riporterebbe dentro il timeout di circa cento secondi che applica a una
connessione proxata rimasta muta — un problema che con la nuvoletta grigia
semplicemente non esiste. E le condizioni d'uso (§2.8) non vogliono video
attraverso il proxy: qui non ne passerebbe comunque, perche' i frame vanno in
UDP e il proxy non li vedrebbe, ma non c'e' motivo di avvicinarsi al confine.

Il prezzo, ed e' bene saperlo: per questi due nomi l'IP della tua linea e'
visibile a chi li risolve.

**Da non fare:** mettere una policy di accesso SSO (tipo Cloudflare Access)
davanti a `talk.*`. Sembra prudente e romperebbe tutto: quelle policy vogliono
cookie e sessione di browser, mentre l'app installata si autentica con un
Bearer token e di sessioni browser non ne ha. L'accesso e' gia' chiuso a monte
dai codici di invito.

---

## 1. `talk.<dominio>` — il piano di controllo e l'app web

*Hosts → Proxy Hosts → Add Proxy Host*

**Scheda Details**

| Campo | Valore |
|---|---|
| Domain Names | `talk.<dominio>` |
| Scheme | `http` |
| Forward Hostname / IP | `<ip-del-server>` |
| Forward Port | `8080` |
| Cache Assets | **no** |
| Block Common Exploits | si |
| Websockets Support | si |

L'indirizzo della macchina e non un nome di container: il proxy quasi sempre
gira in uno stack suo, e i nomi della rete di compose di PulseTalk li' non
esistono. E' anche il motivo per cui `pulse-talk` pubblica la sua porta invece
di tenerla dentro.

**Scheda SSL**

Richiedi un certificato nuovo (*Request a new SSL Certificate*), con *Force
SSL* acceso. Se la sfida HTTP non passa perche' la 80 non e' inoltrata, usa la
sfida DNS con il tuo gestore DNS.

**Scheda Advanced** — questa non e' facoltativa:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 24h;
```

L'elenco degli spazi si aggiorna su un flusso SSE che resta aperto per tutta la
sessione, e nginx di serie bufferizza le risposte: senza `proxy_buffering off`
gli aggiornamenti arriverebbero a blocchi invece che nell'istante in cui
qualcuno entra in una stanza, e con il timeout di serie il flusso morirebbe
dopo un minuto. L'elenco smetterebbe di aggiornarsi senza nessun errore
visibile — il modo peggiore di rompersi.

---

## 2. `sfu.<dominio>` — la segnalazione WebRTC

*Add Proxy Host* di nuovo.

**Scheda Details**

| Campo | Valore |
|---|---|
| Domain Names | `sfu.<dominio>` |
| Scheme | `http` |
| Forward Hostname / IP | `<ip-del-server>` |
| Forward Port | `7880` |
| Websockets Support | **si, obbligatorio** |

Senza la spunta WebSocket la segnalazione si collega e cade un istante dopo: la
chiamata sembra partire e non parte, ed e' la cosa piu' difficile da
diagnosticare di tutta l'installazione.

La porta 7880 e' della SFU, che gira in `network_mode: host` — deve, o WebRTC
non funziona — quindi risponde direttamente sull'indirizzo della macchina.

**Scheda SSL**: come sopra.

**Scheda Advanced**:

```nginx
proxy_read_timeout 24h;
proxy_send_timeout 24h;
```

Una chiamata dura quanto dura. Col timeout di serie la segnalazione verrebbe
chiusa a meta' riunione, e la chiamata cadrebbe con tutti dentro.

---

## Quello che NON passa da qui

I frame audio e video. Vanno dall'app alla SFU in UDP sulla **7882**, cifrati
con DTLS-SRTP, senza toccare il proxy. Da qui passa solo il discorso
preliminare fra due app: chi sei, che codec parli, con quale chiave cifriamo —
qualche kilobyte per chiamata.

E' per questo che sul router servono comunque due inoltri verso
`<ip-del-server>`:

| Porta | Protocollo | A cosa serve |
|---|---|---|
| 7882 | UDP | i pacchetti. Senza questa non c'e' nessuna chiamata. |
| 7881 | TCP | il ripiego per le reti che non lasciano uscire l'UDP. |

E la 443 pubblica deve arrivare dove ascolta il tuo proxy in HTTPS. Se gli
altri servizi che ci hai gia' dietro rispondono da fuori, quell'inoltro c'e'
gia' e non c'e' niente da fare.
