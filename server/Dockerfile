# better-sqlite3 e' un modulo nativo: si compila nell'immagine di build, e nel
# runtime finisce solo il .node gia' compilato. Senza questa separazione
# l'immagine si porterebbe dietro python e il toolchain C++ per sempre.
FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------

FROM node:24-bookworm-slim

# tini raccoglie i processi orfani e inoltra i segnali: senza, un SIGTERM da
# `docker stop` non arriverebbe a Node e la chiusura pulita non partirebbe.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# L'app web costruita, se c'e'. La cartella esiste sempre (dentro c'e' almeno
# un segnaposto), cosi' questa COPY non fa fallire la build di chi non ha
# costruito il client web.
COPY public ./public

# I permessi si normalizzano qui, e non e' una precauzione teorica.
#
# Questi file nascono su un disco Windows, che i permessi POSIX non li ha, e
# arrivano al contesto di build passando da scp — che a quel punto se li
# inventa. Una sottocartella puo' ritrovarsi 0700 di root senza che nessuno
# l'abbia deciso, e il container, che gira come utente non privilegiato, non
# la aprirebbe.
#
# Il modo in cui si manifesta merita di essere ricordato: Node, quando non
# riesce ad aprire la cartella che contiene un modulo, non dice "permesso
# negato" — dice ERR_MODULE_NOT_FOUND, cioe' esattamente quello che direbbe se
# il file non ci fosse. Si finisce a cercare un file che c'e', e si guarda
# ovunque tranne che ai permessi.
#
# 755 sulle cartelle, 644 sui file, nessun permesso di scrittura: il codice
# nell'immagine non deve essere modificabile nemmeno da chi lo esegue.
RUN chmod -R u=rwX,go=rX /app/src /app/public

ENV NODE_ENV=production \
    TALK_ROOT=/dati \
    TALK_PORT=8080 \
    TALK_HOST=0.0.0.0

EXPOSE 8080

# Gira come utente non privilegiato. Il dataset montato in /dati deve
# appartenere a questo uid: su TrueNAS si imposta dalla scheda del dataset,
# oppure si passa `user:` nel compose con l'uid del proprietario.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TALK_PORT||8080)+'/salute').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.mjs"]
