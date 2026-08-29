# PulseTalk su TrueNAS

## Leggi prima questo, perche' cambia tutto

**Su TrueNAS non si possono piu' aggiungere cataloghi di terze parti.** Il
pulsante «Add Catalog» e' stato tolto con la 24.10 «Electric Eel», quando le app
sono passate da Kubernetes a Docker Compose, e non e' tornato ne' nella 25.04
«Fangtooth» ne' nella 25.10 «Goldeye». L'unico catalogo che TrueNAS conosce oggi
e' quello di iX.

Quindi: le cartelle qui accanto sono un train scritto nel formato corrente, ma
**oggi nessuno puo' aggiungerlo al proprio TrueNAS**. Dirlo qui in cima e'
meglio che lasciarlo scoprire dopo mezz'ora passata a cercare un pulsante che
non c'e'.

Quello che si puo' fare, e che funziona adesso, e' **Install via YAML**: TrueNAS
prende un Compose scritto da te e da li' in poi lo tratta come qualunque altra
app — compare fra le app installate, riparte da sola dopo un riavvio, ha i suoi
log e i suoi controlli di salute nella stessa interfaccia. Non e' un ripiego di
seconda scelta: e' la strada che iX indica per tutto cio' che non sta nel loro
catalogo.

## La strada che funziona: Install via YAML

**Il file da incollare e' [`truenas/pulse-talk.yaml`](pulse-talk.yaml).** E' uno
solo, autosufficiente — niente `.env`, niente `livekit.yaml` accanto — perche'
nella casella di TrueNAS si incolla un file e non c'e' modo di metterne un
secondo di fianco. Anche la configurazione della SFU sta li' dentro, in
`LIVEKIT_CONFIG`: livekit-server la legge da una variabile d'ambiente
esattamente come la leggerebbe da un file.

1. Apri [`pulse-talk.yaml`](pulse-talk.yaml) e cambia **le sei righe segnate
   con `⇦ CAMBIA`**. Sono sei e non trenta: immagine, segreto della SFU,
   indirizzo della SFU, `use_external_ip`, cartella dei dati, porta.
2. **Apps → Discover Apps → ⋮ (in alto a destra) → Install via YAML**
3. Nome: `pulse-talk`
4. In **Custom Config**, incolla il file. Installa.

Le due righe da guardare due volte sono la 3 e la 4, perche' vanno d'accordo o
non funziona niente:

| | `SFU_URL` | `use_external_ip` |
|---|---|---|
| da internet | `wss://sfu.<dominio>` | `true` |
| rete locale | `ws://<ip-del-nas>:7880` | `false` |

Girate a meta', la chiamata si collega e **resta muta**, senza nessun errore da
nessuna parte. `python truenas/prova.py` controlla anche questo, oltre alla
sintassi: se le hai lasciate in disaccordo te lo dice.

### Se preferisci non modificare niente a mano

`rendi.py` fa le stesse sostituzioni a partire dalle risposte:

```sh
pip install jinja2 pyyaml
python truenas/rendi.py --dominio casa.it --segreto "$(openssl rand -hex 32)"
```

Stampa il Compose pronto da incollare. `--help` elenca tutte le risposte.

### L'immagine

Il file punta di serie a `ghcr.io/filippocaio/pulse-talk:latest`, che **esiste
solo dopo** che `.github/workflows/immagine.yml` e' partito su un tag. Finche'
non l'hai pubblicata ci sono due strade, e la seconda funziona subito:

- costruirla sul NAS con `deploy/docker-compose.yml` (`build: ../server`) e poi
  scrivere qui il nome locale, per esempio `pulse-talk:1.0.0`. TrueNAS usa lo
  stesso demone Docker, quindi la trova senza passare da nessun registry — ed
  e' il motivo per cui il file dice `pull_policy: missing` invece di `always`.

## Cosa c'e' in queste cartelle

```
truenas/
├── pulse-talk.yaml                   IL FILE DA INCOLLARE — e' questo che serve
├── catalog.json                      l'indice, nel formato del catalogo
├── prova.py                          valida il file qui sopra e il template
├── rendi.py                          rende il template a partire dalle risposte
└── trains/pulse/pulse-talk/
    ├── item.yaml                     la scheda nell'elenco
    ├── app_versions.json             le versioni disponibili
    └── 1.0.0/
        ├── app.yaml                  metadati
        ├── ix_values.yaml            immagini e costanti
        ├── questions.yaml            le domande dell'installazione
        ├── README.md                 cosa legge chi la sta per installare
        └── templates/
            ├── docker-compose.yaml   il template Jinja2
            └── test_values/          i valori con cui `prova.py` lo rende
```

**Il formato viene da qui**, letto e non ricordato: il repository
[truenas/apps](https://github.com/truenas/apps) sul ramo `master`, il suo
`CONTRIBUTIONS.md`, e la struttura reale di un'app del train `community`
(`trains/community/actual-budget`) presa come riferimento. `min_scale_version`
e' `24.10.2.2`, la stessa che dichiarano le app ufficiali: e' la prima versione
di TrueNAS che legge questo formato.

**Una differenza voluta rispetto agli app ufficiali:** il template non usa
`ix_lib`, la libreria Python di iX che gli app del catalogo vendorizzano dentro
a `templates/library/` dichiarandone la versione e l'hash in `app.yaml`. Per un
train di terze parti quella dipendenza e' il pezzo che si rompe per primo — un
rilascio di TrueNAS e l'app non renderizza piu'. Qui il Compose e' scritto per
esteso: si legge, e non ha niente da tenere allineato.

## Come si aggiorna

Un'app installata via YAML si aggiorna cambiando il tag dell'immagine nel suo
Compose (**Apps → pulse-talk → Edit**) e salvando. TrueNAS riscarica e riavvia.

`talk.db` **non viene toccato**: sta sul dataset montato su `/dati`, fuori dal
container, e ogni versione del server lo migra da sola all'avvio — le migrazioni
sono idempotenti e aggiungono colonne, non ne tolgono. Un aggiornamento non
perde ne' account, ne' spazi, ne' messaggi.

L'unica accortezza vera: **prima di un aggiornamento importante, uno snapshot
del dataset**. Non perche' ci si aspetti che vada storto, ma perche' quel file e'
l'unica copia di tutto.

## Cosa non si puo' verificare senza un TrueNAS

Qui, su una macchina di sviluppo, si e' verificato che:

- i file YAML sono sintatticamente validi;
- il template renderizza con i valori di prova (`python truenas/prova.py`), in
  tutti e due i rami — rete locale e dominio;
- cio' che ne esce e' un Compose leggibile, con i due servizi attesi, la SFU
  sulla rete dell'host, e `use_external_ip` d'accordo con la risposta data;
- e che in `pulse-talk.yaml` le due coppie di valori che devono andare
  d'accordo lo facciano davvero: il segreto scritto due volte, e `SFU_URL` con
  `use_external_ip`. Sono i due errori che si fanno modificando il file a mano,
  e sono tutti e due silenziosi;
- ed e' **conforme alla Compose Specification**, validato contro lo schema
  ufficiale. Il controllo e' facoltativo perche' lo schema e' di qualcun altro
  e non sta in questo repository; per farlo girare:

  ```sh
  pip install jsonschema
  curl -sL -o truenas/compose-spec.json https://raw.githubusercontent.com/compose-spec/compose-spec/master/schema/compose-spec.json
  python truenas/prova.py
  ```

  Senza lo schema `prova.py` lo dice e salta, invece di tacere.

Quello che **si puo' verificare solo su un TrueNAS vero**:

- che lo schema delle domande venga disegnato come ci si aspetta dalla sua
  interfaccia (i `$ref` come `normalize/ixVolume` li risolve il middleware);
- che `ix_volumes.data` arrivi al template valorizzato con il percorso vero del
  dataset;
- che la casella «Install via YAML» accetti `network_mode: host` e un bind
  mount su una cartella dell'host. Sono cose normali per un'app personalizzata,
  e restano cose che si vedono solo li'.

  (`configs:` con il contenuto in linea non c'e' piu': la configurazione della
  SFU e' passata in `LIVEKIT_CONFIG`. Era Compose valido, ma richiedeva Compose
  2.23.1 o piu' recente, ed era una dipendenza in piu' su una funzione che si
  puo' non usare affatto.);
- che l'app parta davvero, e che le chiamate passino.
