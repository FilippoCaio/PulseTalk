# PulseTalk

Spazi, canali di testo e di voce, condivisione dello schermo **senza i tetti che
mette Discord**, su una macchina che e' tua.

Schermo fino a 4K60 a 50 Mbit/s con la nitidezza tenuta sopra ai fotogrammi —
che e' la differenza fra del codice condiviso leggibile e una macchia colorata —
voce fino a 510 kbit/s stereo, e l'audio di sistema che parte insieme a cio' che
stai mostrando.

## Due container

- **pulse-talk** — decide chi entra e in quale stanza. Non vede un byte di audio.
- **pulse-talk-sfu** — LiveKit: riceve i pacchetti e li ripete. Non transcodifica
  niente, ed e' la ragione per cui tutto questo gira su un NAS invece che su una
  scheda video.

## Prima di installare

Serve avere presenti tre cose, perche' due l'installazione non le puo' fare:

1. **7881/TCP e 7882/UDP inoltrate sul router** verso questo NAS, se ci si vuole
   parlare da fuori casa. Senza, la chiamata si collega e resta muta — e non
   compare nessun errore da nessuna parte.
2. **Due record DNS** (`talk.` e `sfu.` del tuo dominio) e due voci nel reverse
   proxy, sempre solo se si vuole entrare da internet.
3. **Un segreto per la SFU**: una stringa lunga e casuale, da incollare nel
   campo apposta. `openssl rand -hex 32` ne produce una.

In sola rete locale non serve niente di tutto questo.

## Il primo accesso

Non esiste nessun account finche' non se ne crea uno, e il primo invito si crea
da qui:

```
docker exec -it pulse-talk node src/cli.mjs invita --ruolo admin
```
