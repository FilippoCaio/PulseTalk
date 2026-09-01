#!/usr/bin/env node
// cli.mjs - amministrazione da riga di comando: inviti, stanze, revoche.
//
// Vive accanto al server e non attraverso il server: le operazioni che decidono
// chi entra si fanno sulla macchina, non da una rotta HTTP. Cosi' non esiste
// una rotta "crea amministratore" da dover proteggere.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { RUOLI } from './config.mjs';
import { TalkDb } from './db.mjs';

// Comodita': se c'e' un .env accanto al progetto lo si legge, cosi' non serve
// riesportare TALK_ROOT a ogni comando.
for (const candidato of ['.env', resolve(import.meta.dirname, '..', '.env'), resolve(import.meta.dirname, '..', '..', 'deploy', '.env')]) {
  if (existsSync(candidato)) {
    try {
      process.loadEnvFile(candidato);
      break;
    } catch { /* un .env malformato non deve impedire di revocare un token */ }
  }
}

const AIUTO = `
PulseTalk — amministrazione

  pulse-talk invita [--ruolo membro] [--giorni 14] [--usi 1]
  pulse-talk inviti
  pulse-talk elenca
  pulse-talk revoca --token <id>
  pulse-talk revoca --utente <id>

  pulse-talk spazi
  pulse-talk segreto

Ruoli:
  ospite   entra e ascolta, non trasmette
  membro   trasmette schermo, camera e voce
  admin    crea spazi e canali, modera, invita

Con --giorni 0 l'invito non scade: vale finche' non finisce gli usi o finche'
non lo si annulla dall'app. Il massimo per uno che scade e' 365.

Spazi e canali si creano dall'app: qui c'e' solo "spazi", che li elenca — serve
a guardare cosa c'e' dentro al database senza aprirlo.

L'ambiente deve dire dove sta il database: TALK_ROOT (che implica
<TALK_ROOT>/talk.db) oppure TALK_DB direttamente.
`;

function apriDb() {
  const percorso = process.env.TALK_DB
    ? resolve(process.env.TALK_DB)
    : process.env.TALK_ROOT
      ? resolve(process.env.TALK_ROOT, 'talk.db')
      : null;
  if (!percorso) {
    console.error('Nessun database: imposta TALK_ROOT oppure TALK_DB.');
    process.exit(2);
  }
  return new TalkDb(percorso);
}

const quando = (t) => (t ? new Date(t * 1000).toLocaleString('it-IT') : '—');

function comandoInvita(opzioni) {
  // `--nome` e' facoltativo da quando esistono gli account: chi riscatta
  // sceglie il proprio nome utente e il proprio nome visibile. Se lo si passa,
  // e' solo il valore gia' scritto nel modulo di registrazione.
  const nome = opzioni.nome ?? '';
  const ruolo = opzioni.ruolo ?? 'membro';
  if (!RUOLI.includes(ruolo)) {
    console.error(`Ruolo sconosciuto: ${ruolo}. Ammessi: ${RUOLI.join(', ')}.`);
    process.exit(2);
  }
  const giorni = Number(opzioni.giorni ?? 14);
  const usi = Number(opzioni.usi ?? 1);

  const db = apriDb();
  const codice = db.creaInvito({ nome, ruolo, validoGiorni: giorni, usiMax: usi });
  db.close();

  console.log(`
Invito ${nome ? `per ${nome} ` : ''}con ruolo ${ruolo}, ${giorni === 0 ? 'senza scadenza' : `valido ${giorni} giorni`},
per ${usi === 1 ? 'una persona' : `${usi} persone`}:

    ${codice}

Chi lo riceve apre l'app, incolla il codice e sceglie nome utente e password.
Da quel momento entra da qualunque dispositivo senza piu' codici.

Non e' recuperabile da qui: il database ne conserva solo l'impronta. Lo stesso
si puo' fare dall'app, dal pulsante "Invita" nell'atrio, senza entrare qui.
`);
}

function comandoInviti() {
  const db = apriDb();
  const righe = db.invitiAperti();
  db.close();

  if (righe.length === 0) return console.log('Nessun invito in attesa.');
  console.log('id   ruolo    usi    scade                  nome');
  for (const r of righe) {
    console.log(
      `${String(r.id).padEnd(4)} ${r.ruolo.padEnd(8)} ${`${r.usi}/${r.usiMax}`.padEnd(6)} ` +
      `${(r.scade === 0 ? 'mai' : quando(r.scade)).padEnd(22)} ${r.nome}`,
    );
  }
}

function comandoElenca() {
  const db = apriDb();
  const righe = db.elencoAccessi();
  db.close();

  if (righe.length === 0) return console.log('Nessun accesso ancora riscattato.');
  console.log('id   nome utente      ruolo    ses. stato      ultimo uso             dispositivo');
  for (const r of righe) {
    const stato = !r.attivo ? 'disattivo' : r.revocato ? 'revocato' : 'attiva';
    console.log(
      `${String(r.id).padEnd(4)} ${String(r.utente ?? '(senza)').padEnd(16)} ` +
      `${r.ruolo.padEnd(8)} ${String(r.tokenId ?? '—').padEnd(4)} ${stato.padEnd(10)} ` +
      `${quando(r.ultimoUso).padEnd(22)} ${r.dispositivo ?? '—'}`,
    );
  }
  console.log('\nUna riga per sessione: chi entra da tre dispositivi compare tre volte.');
}

function comandoRevoca(opzioni) {
  const db = apriDb();
  let cambiati = 0;
  if (opzioni.token) cambiati = db.revocaToken(Number(opzioni.token));
  else if (opzioni.utente) cambiati = db.revocaUtente(Number(opzioni.utente));
  else {
    db.close();
    console.error('Serve --token <id> oppure --utente <id>. Gli id si leggono con "elenca".');
    process.exit(2);
  }
  db.close();

  if (cambiati === 0) console.log('Niente da revocare: id inesistente o gia\' revocato.');
  else {
    console.log(
      'Revocato. Le richieste con quel token vengono rifiutate da subito, ma un\n' +
      'gettone della SFU gia\' consegnato resta valido fino alla scadenza: per\n' +
      'tagliare fuori qualcuno che sta parlando adesso, cacciarlo dalla stanza.',
    );
  }
}

function comandoSpazi() {
  const db = apriDb();
  const spazi = db.sql.prepare('SELECT * FROM spazi ORDER BY id').all();
  const righe = spazi.map((s) => ({ spazio: s, canali: db.canaliDi(s.id) }));
  db.close();

  if (righe.length === 0) {
    return console.log('Nessuno spazio. Se ne crea uno dall\'app, dalla colonna a sinistra.');
  }
  for (const { spazio, canali } of righe) {
    console.log(`\n${spazio.nome}  (${spazio.chiave})`);
    if (canali.length === 0) console.log('  nessun canale');
    for (const c of canali) {
      console.log(
        `  ${c.tipo === 'voce' ? '🔊' : '#'} ${c.nome.padEnd(24)} ${c.tipo}` +
        (c.soloAscolto ? ' (palco)' : ''),
      );
    }
  }
  console.log('');
}

function comandoSegreto() {
  // La chiave e' un nome, non un segreto: dice *quale* segreto usare, e
  // compare in chiaro dentro `livekit.yaml` sotto `webhook.api_key`. Generarla
  // a caso non aggiungerebbe nessuna sicurezza e costringerebbe a tenere
  // allineati due file — quindi resta fissa, e si cambia solo di proposito.
  //
  // Il segreto invece e' l'unica cosa che conta: con quello si firmano i
  // gettoni, e chi ce l'ha entra in qualunque stanza con qualunque nome.
  console.log('SFU_API_KEY=pulsetalk');
  console.log(`SFU_API_SECRET=${randomBytes(32).toString('hex')}`);
  console.log('');
  console.log('Vanno copiate nel .env dentro deploy/. Se cambi la chiave, cambiala');
  console.log('anche in livekit.yaml sotto webhook.api_key, o i webhook smettono');
  console.log('di arrivare e l\'atrio torna a interrogare la SFU invece che a');
  console.log('esserne avvisato.');
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    nome: { type: 'string' },
    descrizione: { type: 'string' },
    ruolo: { type: 'string' },
    giorni: { type: 'string' },
    usi: { type: 'string' },
    token: { type: 'string' },
    utente: { type: 'string' },
    stanza: { type: 'string' },
    palco: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const comando = positionals[0];
if (values.help || !comando) {
  console.log(AIUTO);
  process.exit(comando ? 0 : 2);
}

switch (comando) {
  case 'invita': comandoInvita(values); break;
  case 'inviti': comandoInviti(); break;
  case 'elenca': comandoElenca(); break;
  case 'revoca': comandoRevoca(values); break;
  case 'spazi': comandoSpazi(); break;
  case 'segreto': comandoSegreto(); break;
  default:
    console.error(`Comando sconosciuto: ${comando}`);
    console.log(AIUTO);
    process.exit(2);
}
