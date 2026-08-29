#!/bin/sh
# installa.sh - PulseTalk sul tuo NAS, chiedendo le cose invece di farle
# leggere.
#
# POSIX sh e non bash: la shell di serie di un NAS non e' bash abbastanza
# spesso da poterlo dare per scontato — BusyBox su Synology e QNAP, ash su
# Alpine. Niente array, niente `[[ ]]`, niente `local` fuori dalle funzioni.
#
# Cosa fa, in ordine:
#
#   1. controlla che ci sia Docker con il plugin compose
#   2. fa le domande che il README fa leggere
#   3. genera i segreti (non li inventa: usa lo stesso comando del server)
#   4. scrive .env e livekit.yaml
#   5. tira su i due container
#   6. dice cosa resta da fare a mano, perche' due cose restano da fare a mano
#
# Non tocca il router, non tocca il DNS, non tocca il reverse proxy. Non perche'
# sarebbe difficile: perche' sono le tre cose che, sbagliate da uno script,
# lasciano una macchina raggiungibile da fuori senza che nessuno se ne accorga.

set -eu

CARTELLA=$(cd "$(dirname "$0")" && pwd)
IMMAGINE_PREDEFINITA='ghcr.io/filippocaio/pulse-talk'

# -- Modi di dire le cose ----------------------------------------------------

titolo() { printf '\n\033[1m%s\033[0m\n' "$1"; }
nota() { printf '  \033[2m%s\033[0m\n' "$1"; }
buono() { printf '  \033[32m%s\033[0m\n' "$1"; }
male() { printf '  \033[31m%s\033[0m\n' "$1" >&2; }
muori() { male "$1"; exit 1; }

# Una domanda con una risposta di serie. Con stdin non interattivo — lanciato da
# uno script, da un cron, da una pipe — prende sempre il valore di serie invece
# di leggere EOF all'infinito.
chiedi() {
  _domanda=$1
  _predefinito=${2:-}
  if [ ! -t 0 ]; then
    RISPOSTA=$_predefinito
    return 0
  fi
  if [ -n "$_predefinito" ]; then
    printf '  %s [%s]: ' "$_domanda" "$_predefinito"
  else
    printf '  %s: ' "$_domanda"
  fi
  read -r RISPOSTA || RISPOSTA=''
  [ -n "$RISPOSTA" ] || RISPOSTA=$_predefinito
}

conferma() {
  chiedi "$1 (s/n)" "${2:-n}"
  case "$RISPOSTA" in
    s | S | si | Si | y | Y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

# -- 1. Cosa c'e' sulla macchina ---------------------------------------------

titolo 'PulseTalk — installazione'

command -v docker >/dev/null 2>&1 || muori "Docker non c'e'. Su TrueNAS e Synology si abilita dal pannello; altrove si installa."

if docker compose version >/dev/null 2>&1; then
  COMPOSE='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE='docker-compose'
else
  muori "Manca il plugin compose di Docker. Serve 'docker compose' oppure 'docker-compose'."
fi
nota "compose: $COMPOSE"

[ -f "$CARTELLA/docker-compose.nas.yml" ] || muori "Non trovo docker-compose.nas.yml accanto a questo script."
[ -f "$CARTELLA/livekit.yaml" ] || muori "Non trovo livekit.yaml accanto a questo script."

if [ -f "$CARTELLA/.env" ]; then
  male "Esiste gia' un .env in $CARTELLA."
  conferma 'Lo sovrascrivo? I segreti di adesso andrebbero persi' 'n' ||
    muori 'Mi fermo. Sposta il .env da parte se vuoi ricominciare.'
  cp "$CARTELLA/.env" "$CARTELLA/.env.prima-di-$(date +%Y%m%d%H%M%S)"
  nota 'Ne ho tenuto una copia.'
fi

# -- 2. Le domande -----------------------------------------------------------

titolo 'Dove stanno i dati'
nota 'Una cartella sul NAS. Dentro ci va talk.db: qualche decina di kilobyte,'
nota 'niente registrazioni, niente cache. Va su un dataset che fa gli snapshot.'
chiedi 'Cartella dei dati' "$CARTELLA/dati"
DATI=$RISPOSTA

titolo 'Come ci si arriva'
nota 'Due modi, e la scelta cambia due interruttori insieme:'
nota ''
nota '  dominio  -> si entra da internet, passando dal reverse proxy'
nota '  locale   -> si entra solo dalla rete di casa, senza certificati'
nota ''
nota 'Il secondo serve a provare tutto — schermo, audio, qualita — prima di'
nota 'avere un DNS, un certificato o una porta aperta. Si cambia anche dopo.'
chiedi 'dominio o locale' 'locale'
MODO=$RISPOSTA

if [ "$MODO" = 'dominio' ]; then
  chiedi 'Il tuo dominio (senza https://, per esempio casa.it)'
  DOMINIO=$RISPOSTA
  [ -n "$DOMINIO" ] || muori 'Senza dominio non posso continuare.'
  SFU_URL="wss://sfu.$DOMINIO"
  ESTERNO='true'
  PUBBLICO="https://talk.$DOMINIO"
else
  # L'indirizzo del NAS nella rete di casa. Indovinato dove si puo', chiesto
  # sempre: indovinare male qui vuol dire una chiamata muta e nessun errore.
  INDOVINATO=$(
    (ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p') ||
      (hostname -i 2>/dev/null | awk '{print $1}') || true
  )
  chiedi 'Indirizzo del NAS nella rete locale' "$INDOVINATO"
  LOCALE=$RISPOSTA
  # Se il rilevamento non ha funzionato non si tira a indovinare, ci si ferma.
  # Un indirizzo sbagliato qui non produce nessun errore: produce una chiamata
  # che si collega e resta muta, che e' il guasto piu' difficile da riconoscere
  # di tutti. Meglio una domanda in piu' adesso che mezz'ora di ricerche dopo.
  [ -n "$LOCALE" ] || muori 'Non sono riuscito a rilevare l indirizzo di questa macchina. Rilancialo da un terminale, cosi posso chiedertelo.'
  SFU_URL="ws://$LOCALE:7880"
  ESTERNO='false'
  PUBBLICO="http://$LOCALE:8080"
fi

titolo 'Le porte'
nota 'La porta HTTP del piano di controllo. Le altre tre — 7880, 7881/TCP e'
nota '7882/UDP — sono della SFU e non si spostano: livekit gira sulla rete'
nota "dell'host, e quelle porte devono essere libere sul NAS."
chiedi 'Porta di PulseTalk' '8080'
PORTA=$RISPOSTA

titolo "L'immagine"
chiedi 'Immagine del server' "$IMMAGINE_PREDEFINITA"
IMMAGINE=$RISPOSTA
chiedi 'Versione (latest, oppure X.Y.Z)' 'latest'
VERSIONE=$RISPOSTA

titolo 'Chiavi facoltative'
nota 'Le lascio tutte vuote. Senza, PulseTalk funziona lo stesso: le funzioni'
nota 'che le userebbero — AI, Spotify, GIF, immagini — dicono che il server non'
nota "e' configurato invece di sparire senza spiegazioni. Si aggiungono dopo,"
nota 'nel .env oppure dal pannello Server dentro all applicazione.'

# -- 3. I segreti ------------------------------------------------------------

titolo 'Genero i segreti'

# Lo stesso comando che usa chi ha il repository: `node src/cli.mjs segreto`.
# Girato dentro all'immagine, cosi' non serve avere Node sul NAS — e soprattutto
# non serve un secondo generatore di segreti che nessuno rilegge mai.
segreto() {
  docker run --rm --entrypoint node "$IMMAGINE:$VERSIONE" src/cli.mjs segreto 2>/dev/null |
    tr -d '\r\n'
}

nota "Scarico $IMMAGINE:$VERSIONE (la prima volta ci mette un po')…"
docker pull "$IMMAGINE:$VERSIONE" >/dev/null || muori "Non riesco a scaricare $IMMAGINE:$VERSIONE. Se il pacchetto e' privato, va reso pubblico dalla sua pagina su GitHub."

SFU_SEGRETO=$(segreto)
if [ -z "$SFU_SEGRETO" ]; then
  # Ripiego: la stessa cosa con gli strumenti che ci sono sempre. Non e' una
  # scorciatoia — /dev/urandom e' la stessa sorgente — ma passare dal comando
  # del server e' meglio perche' e' quello che ne conosce il formato atteso.
  SFU_SEGRETO=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
fi
[ -n "$SFU_SEGRETO" ] || muori 'Non sono riuscito a generare il segreto della SFU.'
buono "segreto della SFU: generato (${#SFU_SEGRETO} caratteri)"

# -- 4. I file ---------------------------------------------------------------

titolo 'Scrivo la configurazione'

mkdir -p "$DATI"

cat > "$CARTELLA/.env" <<FINE
# Scritto da installa.sh il $(date '+%Y-%m-%d %H:%M').
#
# Questo file contiene un segreto: non finisce in git, e non si copia in giro.
# Il .gitignore del progetto lo esclude gia'.

TALK_IMMAGINE=$IMMAGINE
TALK_VERSIONE=$VERSIONE
TALK_DATASET=$DATI
TALK_PORTA=$PORTA

SFU_API_KEY=pulsetalk
SFU_API_SECRET=$SFU_SEGRETO

# Va tenuto d'accordo con use_external_ip in livekit.yaml: sono i due
# interruttori che si girano insieme.
SFU_URL=$SFU_URL

TALK_LOG_LEVEL=info
TALK_GETTONE_TTL=21600

# La versione dell'app che questo server pretende. Vuote: entra qualunque
# versione. Vedi docs/NAS.md prima di alzarle.
TALK_CLIENT_MIN=
TALK_CLIENT_TARGET=
TALK_CLIENT_MAX=

# Facoltative, tutte spente. Senza, l'applicazione funziona lo stesso.
TALK_AI_API_KEY=
TALK_TENOR_API_KEY=
TALK_GIPHY_API_KEY=
TALK_UNSPLASH_ACCESS_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=
FINE
chmod 600 "$CARTELLA/.env"
buono ".env scritto (leggibile solo da te)"

# livekit.yaml: si parte da quello del progetto e si gira il solo interruttore
# che dipende dalla risposta. Riscriverlo da zero avrebbe voluto dire perdere
# tutti i commenti che spiegano perche' ogni riga sta li'.
sed "s/^  use_external_ip: .*/  use_external_ip: $ESTERNO/" \
  "$CARTELLA/livekit.yaml" > "$CARTELLA/livekit.yaml.nuovo"
mv "$CARTELLA/livekit.yaml.nuovo" "$CARTELLA/livekit.yaml"
buono "livekit.yaml: use_external_ip = $ESTERNO"

# -- 5. Su ------------------------------------------------------------------

titolo 'Accendo'
if conferma 'Faccio partire adesso i due container?' 's'; then
  (cd "$CARTELLA" && $COMPOSE -f docker-compose.nas.yml up -d)
  buono 'partiti'
else
  nota "Quando vuoi:  cd $CARTELLA && $COMPOSE -f docker-compose.nas.yml up -d"
fi

# -- 6. Cosa resta a mano ----------------------------------------------------

titolo 'Fatto. Quello che resta non lo puo fare nessuno script'

if [ "$MODO" = 'dominio' ]; then
  printf '\n'
  nota '1. DUE RECORD DNS, verso il tuo indirizzo pubblico:'
  nota "     talk.$DOMINIO    A    <il tuo IP>"
  nota "     sfu.$DOMINIO     A    <il tuo IP>"
  printf '\n'
  nota '2. DUE VOCI NEL REVERSE PROXY (istruzioni in deploy/proxy.md):'
  nota "     talk.$DOMINIO  ->  http://<ip-del-nas>:$PORTA"
  nota "     sfu.$DOMINIO   ->  http://<ip-del-nas>:7880   (con WebSocket)"
  printf '\n'
  nota '3. DUE PORTE INOLTRATE SUL ROUTER, verso il NAS:'
  nota '     7881/TCP     ripiego per le reti che bloccano UDP'
  nota '     7882/UDP     audio, video e schermo passano di qui'
  printf '\n'
  male 'Senza il punto 3 le chiamate si collegano e restano MUTE.'
  male "Non compare nessun errore: e' il guasto piu' difficile da riconoscere."
else
  printf '\n'
  nota 'Sei in rete locale: non serve ne DNS ne port forward.'
  nota 'Da internet non ci si entra, ed e giusto cosi finche non lo decidi tu.'
  nota 'Per aprire a internet: rilancia questo script e scegli "dominio".'
fi

printf '\n'
titolo 'Il primo accesso'
nota "  $PUBBLICO"
printf '\n'
nota "Il primo invito si crea dal NAS, perche' non esiste ancora nessuno:"
nota "  $COMPOSE -f docker-compose.nas.yml exec pulse-talk node src/cli.mjs invita --ruolo admin"
printf '\n'
