// permessi/catalogo.mjs - l'elenco dei permessi, e nient'altro.
//
// Un permesso e' una stringa. Non un bit, non una posizione in una maschera:
// una stringa. Costa qualche byte in piu' per riga di database e in cambio
// aggiungere il ventinovesimo permesso e' aggiungere una riga qui — nessun
// numero da non superare, nessuna migrazione che sposti i bit, nessun rischio
// che due versioni del programma diano al bit 17 due significati diversi.
//
// Le chiavi restano in inglese anche se tutto il resto e' in italiano: sono
// nomi macchina, finiscono dentro al JSON salvato sul disco, e cambiarli
// domani vorrebbe dire riscrivere righe gia' scritte. L'etichetta italiana la
// mette l'interfaccia, che e' il posto in cui le parole si possono cambiare
// senza rompere niente.

/**
 * Tutti i permessi riconosciuti, in gruppi.
 *
 * I gruppi servono soltanto a disegnare il pannello: la risoluzione non li
 * guarda mai. Un permesso che sparisse da qui resterebbe scritto nelle righe
 * gia' salvate e verrebbe semplicemente ignorato — che e' il comportamento
 * giusto per un programma che si aggiorna un pezzo alla volta.
 */
export const GRUPPI_PERMESSI = [
  {
    id: 'server',
    nome: 'Server',
    permessi: [
      'manageServer',
      'manageServerSettings',
      'manageRoles',
      'managePermissions',
      'manageMembers',
      'kickMembers',
      'banMembers',
      'createInvites',
    ],
  },
  {
    id: 'struttura',
    nome: 'Categorie e canali',
    permessi: [
      'createCategories',
      'editCategories',
      'deleteCategories',
      'createTextChannels',
      'editTextChannels',
      'deleteTextChannels',
      'createVoiceChannels',
      'editVoiceChannels',
      'deleteVoiceChannels',
    ],
  },
  {
    id: 'testo',
    nome: 'Testo',
    permessi: ['viewChannel', 'sendMessages'],
  },
  {
    id: 'voce',
    nome: 'Voce',
    permessi: [
      'connect',
      'speak',
      'stream',
      'muteMembers',
      'deafenMembers',
      'manageVoiceMembers',
    ],
  },
  {
    id: 'eventi',
    nome: 'Eventi',
    permessi: ['createEvents', 'manageEvents'],
  },
];

/** L'elenco piatto, che e' quello che serve a validare. */
export const PERMESSI = GRUPPI_PERMESSI.flatMap((g) => g.permessi);

const NOTI = new Set(PERMESSI);

/**
 * I permessi che si applicano a una categoria o a un canale.
 *
 * Sono gli unici che ha senso ritrovare in un override: "puo' amministrare il
 * server" non cambia significato dentro a un canale, mentre "puo' scrivere"
 * cambia significato in ogni canale. Consentire override sugli altri
 * darebbe la possibilita' di regalare l'amministrazione dell'intero spazio
 * nascondendola in fondo alle impostazioni di un canale.
 */
export const PERMESSI_DI_CANALE = [
  'viewChannel',
  'sendMessages',
  'connect',
  'speak',
  'stream',
  'muteMembers',
  'deafenMembers',
  'manageVoiceMembers',
  'createEvents',
  'createInvites',
];

const DI_CANALE = new Set(PERMESSI_DI_CANALE);

/**
 * Cosa puo' fare, di serie, chi entra e basta.
 *
 * E' il ruolo base — quello che ogni membro ha senza che nessuno glielo dia.
 * Volutamente generoso: qui dentro si entra su invito, e un posto in cui il
 * nuovo arrivato non puo' nemmeno parlare finche' qualcuno non se ne accorge
 * e' un posto che fa perdere mezz'ora a ogni ingresso.
 */
export const PERMESSI_BASE = [
  'viewChannel',
  'sendMessages',
  'connect',
  'speak',
  'stream',
  'createInvites',
];

/**
 * Il ruolo Master: il secondo in comando.
 *
 * Predefinito di PulseTalk, come chiede la specifica, ma con i permessi
 * modificabili: nasce con tutto tranne le tre cose con cui si smonta un
 * server — amministrarlo, riscrivere i ruoli e cambiare i permessi. Chi vuole
 * dargli anche quelle glielo da', ed e' una scelta esplicita invece che un
 * regalo di serie.
 */
export const PERMESSI_MASTER = PERMESSI.filter(
  (p) => !['manageServer', 'manageRoles', 'managePermissions'].includes(p),
);

/** Se questa stringa e' un permesso che esiste. */
export const permessoNoto = (chiave) => NOTI.has(chiave);

/** Se ha senso metterlo in un override di categoria o di canale. */
export const permessoDiCanale = (chiave) => DI_CANALE.has(chiave);

/**
 * Ripulisce un elenco che arriva da fuori.
 *
 * Butta via i duplicati e cio' che non esiste, e mantiene l'ordine del
 * catalogo: due ruoli con gli stessi permessi salvati in ordine diverso
 * darebbero due JSON diversi per la stessa cosa, e ogni confronto fra i due
 * direbbe che sono cambiati quando non e' cambiato niente.
 */
export function ripuliscePermessi(grezzo, { soloDiCanale = false } = {}) {
  if (!Array.isArray(grezzo)) return [];
  const chiesti = new Set(grezzo.filter((p) => typeof p === 'string'));
  const ammessi = soloDiCanale ? PERMESSI_DI_CANALE : PERMESSI;
  return ammessi.filter((p) => chiesti.has(p));
}
