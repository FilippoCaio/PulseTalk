# Il rilascio

PulseTalk e' due cose che si installano separatamente, su macchine diverse, da
persone che spesso non sono la stessa:

| | | |
|---|---|---|
| [**`server/`**](server/) | il piano di controllo e la SFU | gira su un NAS, un mini PC, un VPS |
| [**`client/`**](client/) | l'applicazione | gira sul computer di chi parla |

**Ne serve uno solo per volta.** Chi vuole entrare in un PulseTalk che esiste
gia' guarda `client/` e ignora tutto il resto; chi vuole tirarne su uno guarda
`server/` e poi, alla fine, `client/`.

## Perche' le due cartelle non si somigliano

`server/` contiene **i file veri** — il compose, la configurazione della SFU, lo
script che installa, l'esempio di `.env`. Sono file di testo, si leggono, e sono
esattamente quelli che finiscono sulla macchina.

`client/` contiene **solo delle istruzioni**, perche' l'applicazione e' un
eseguibile da cento megabyte e un repository non e' il posto dove tenerlo. Sta
fra gli allegati delle
[release](https://github.com/FilippoCaio/PulseTalk/releases), che e' dove
GitHub tiene i binari.

Non e' un'asimmetria elegante, ma e' quella onesta: mettere l'installer in git
lo farebbe pesare un gigabyte dopo dieci versioni, e chi clona per leggere il
codice se lo porterebbe dietro tutto.

## I numeri di versione sono due

Il tag della release — `v0.6.2` — e' il numero **dell'applicazione**, ed e'
quello che decide cosa viene compilato e pubblicato.

Il server ha un suo numero, in [`server/package.json`](../server/package.json),
e cammina piu' lentamente: l'applicazione cambia a ogni ritocco dell'interfaccia,
il piano di controllo no. Le due cose restano compatibili perche' e' il server a
dichiarare quali versioni dell'app accetta (`TALK_CLIENT_MIN`,
`TALK_CLIENT_TARGET`, `TALK_CLIENT_MAX` nel suo `.env`), non il contrario.

Quindi: **un server piu' vecchio dell'app non e' un problema**, finche' non
dichiara un tetto. E' scritto per essere l'ordine normale delle cose, non
l'eccezione.

## Come si mette insieme un rilascio

```
.\rilascio\assembla.ps1            aggiorna le copie in server/
.\rilascio\assembla.ps1 -Verifica  controlla e basta, esce 1 se qualcosa e' vecchio
.\rilascio\assembla.ps1 -Zip       scrive anche pacchetti/pulsetalk-server-X.Y.Z.zip
```

I file dentro `server/` sono **copie identiche** di file che vivono altrove nel
repository (`deploy/`, `truenas/`). Le copie invecchiano in silenzio, e per
questo il controllo `-Verifica` gira dentro al workflow di rilascio: una copia
scaduta ferma la pubblicazione invece di finirci dentro.

Il rilascio vero e' un tag:

```sh
.\rilascia.ps1 -Tipo minor -Messaggio "Moderazione dei vocali"
```

che alza il numero, committa, tagga, spinge, e da li' in poi tocca a GitHub:
[`immagine.yml`](../.github/workflows/immagine.yml) pubblica l'immagine del
server su GHCR, [`rilascio.yml`](../.github/workflows/rilascio.yml) compila
l'installer di Windows e prepara la release **come bozza**, con dentro tutti e
due i lati.

Bozza e non pubblicata di proposito: finche' resta tale, `latest.yml` non e'
raggiungibile e nessuno si aggiorna. Il momento in cui una versione diventa
quella che scaricano tutti resta una decisione presa a mano, con un pulsante.
