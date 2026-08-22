/**
 * I permessi, con le parole che si vedono.
 *
 * Le chiavi sono le stesse del server (server/src/permessi/catalogo.mjs) e sono
 * in inglese perche' sono nomi macchina: viaggiano dentro al JSON salvato sul
 * disco, e cambiarli vorrebbe dire riscrivere righe gia' scritte. Qui accanto
 * ci stanno le parole italiane, che sono l'unica cosa che le persone leggono e
 * l'unica che si puo' cambiare senza rompere niente.
 *
 * Questo file NON decide niente. Serve a disegnare i pannelli e a nascondere i
 * pulsanti che non si possono premere; a dire di no e' il server, che rifa' lo
 * stesso calcolo su ogni richiesta. Un client modificato che si desse tutti i
 * permessi non otterrebbe altro che vedere pulsanti che rispondono 403.
 *
 * L'elenco puo' restare indietro rispetto al server, ed e' previsto: un
 * permesso sconosciuto si mostra con la sua chiave invece di sparire.
 */

export type Permesso = string

export interface GruppoPermessi {
  id: string
  nome: string
  /** Cosa raggruppa, in una riga, per chi apre il pannello la prima volta. */
  sotto: string
  permessi: { chiave: Permesso; nome: string; sotto: string }[]
}

export const GRUPPI_PERMESSI: GruppoPermessi[] = [
  {
    id: 'server',
    nome: 'Server',
    sotto: 'Chi comanda, e fin dove.',
    permessi: [
      {
        chiave: 'manageServer',
        nome: 'Amministra il server',
        sotto: "Da' tutto il resto. E' il permesso da cui si torna indietro con difficolta'."
      },
      {
        chiave: 'manageServerSettings',
        nome: 'Modifica le impostazioni',
        sotto: 'Nome, icona, descrizione, regole e preferenze.'
      },
      { chiave: 'manageRoles', nome: 'Gestisce i ruoli', sotto: 'Crea ruoli e li assegna.' },
      {
        chiave: 'managePermissions',
        nome: 'Gestisce i permessi',
        sotto: 'Le eccezioni su categorie e canali.'
      },
      { chiave: 'manageMembers', nome: 'Gestisce i membri', sotto: 'Aggiunge persone allo spazio.' },
      { chiave: 'kickMembers', nome: 'Caccia i membri', sotto: 'Li mette fuori: possono rientrare.' },
      { chiave: 'banMembers', nome: 'Bandisce i membri', sotto: 'Li mette fuori e non rientrano.' },
      {
        chiave: 'createInvites',
        nome: 'Crea inviti',
        sotto: 'Genera i codici per far entrare altre persone.'
      }
    ]
  },
  {
    id: 'struttura',
    nome: 'Categorie e canali',
    sotto: "Chi puo' cambiare la forma della colonna a sinistra.",
    permessi: [
      { chiave: 'createCategories', nome: 'Crea categorie', sotto: '' },
      { chiave: 'editCategories', nome: 'Modifica categorie', sotto: 'Rinomina e riordina.' },
      { chiave: 'deleteCategories', nome: 'Elimina categorie', sotto: 'I canali dentro restano.' },
      { chiave: 'createTextChannels', nome: 'Crea canali di testo', sotto: '' },
      { chiave: 'editTextChannels', nome: 'Modifica canali di testo', sotto: '' },
      { chiave: 'deleteTextChannels', nome: 'Elimina canali di testo', sotto: '' },
      { chiave: 'createVoiceChannels', nome: 'Crea canali vocali', sotto: '' },
      { chiave: 'editVoiceChannels', nome: 'Modifica canali vocali', sotto: '' },
      { chiave: 'deleteVoiceChannels', nome: 'Elimina canali vocali', sotto: '' }
    ]
  },
  {
    id: 'testo',
    nome: 'Testo',
    sotto: 'Si possono cambiare canale per canale.',
    permessi: [
      {
        chiave: 'viewChannel',
        nome: 'Vede il canale',
        sotto: 'Senza, quel canale non esiste: non compare, non si apre, non si trova cercando.'
      },
      { chiave: 'sendMessages', nome: 'Scrive messaggi', sotto: '' }
    ]
  },
  {
    id: 'voce',
    nome: 'Voce',
    sotto: 'Anche questi si possono cambiare canale per canale.',
    permessi: [
      { chiave: 'connect', nome: 'Entra nei vocali', sotto: '' },
      { chiave: 'speak', nome: 'Parla', sotto: 'Senza, si entra e si ascolta.' },
      { chiave: 'stream', nome: 'Condivide', sotto: 'Schermo, camera, e le sessioni da guardare insieme.' },
      { chiave: 'muteMembers', nome: 'Zittisce gli altri', sotto: '' },
      { chiave: 'deafenMembers', nome: 'Assorda gli altri', sotto: '' },
      {
        chiave: 'manageVoiceMembers',
        nome: 'Modera il vocale',
        sotto: 'Caccia dalla stanza chi ci sta dentro.'
      }
    ]
  },
  {
    id: 'eventi',
    nome: 'Eventi',
    sotto: "L'agenda dello spazio.",
    permessi: [
      { chiave: 'createEvents', nome: 'Crea eventi', sotto: 'E modifica i propri.' },
      { chiave: 'manageEvents', nome: 'Gestisce gli eventi', sotto: 'Anche quelli degli altri.' }
    ]
  }
]

/** L'elenco piatto, nell'ordine del catalogo. */
export const PERMESSI: Permesso[] = GRUPPI_PERMESSI.flatMap((g) => g.permessi.map((p) => p.chiave))

/** Quelli che ha senso cambiare dentro a una categoria o a un canale. */
export const PERMESSI_DI_CANALE: Permesso[] = [
  'viewChannel',
  'sendMessages',
  'connect',
  'speak',
  'stream',
  'muteMembers',
  'deafenMembers',
  'manageVoiceMembers',
  'createEvents',
  'createInvites'
]

const PER_CHIAVE = new Map(
  GRUPPI_PERMESSI.flatMap((g) => g.permessi).map((p) => [p.chiave, p])
)

/** Il nome italiano di un permesso. Uno sconosciuto torna com'e' scritto. */
export function nomePermesso(chiave: Permesso): string {
  return PER_CHIAVE.get(chiave)?.nome ?? chiave
}

export function sottoPermesso(chiave: Permesso): string {
  return PER_CHIAVE.get(chiave)?.sotto ?? ''
}

/**
 * Ho questo permesso, qui?
 *
 * Una funzione e non un `array.includes` sparso ovunque, per un motivo che si
 * vede solo dopo: la domanda ricorre in venti componenti, e il giorno in cui
 * arriva un caso particolare — un permesso che ne implica un altro, una
 * modalita' di sola lettura — si cambia qui invece che in venti posti.
 */
export function puo(permessi: readonly Permesso[] | undefined, chiave: Permesso): boolean {
  return !!permessi?.includes(chiave)
}

/** Almeno uno dei permessi indicati: serve a decidere se un menu ha voci. */
export function puoQualcosa(
  permessi: readonly Permesso[] | undefined,
  chiavi: readonly Permesso[]
): boolean {
  return chiavi.some((c) => puo(permessi, c))
}

/** I permessi che aprono una qualunque sezione delle impostazioni del server. */
export const PERMESSI_DI_GESTIONE: Permesso[] = [
  'manageServer',
  'manageServerSettings',
  'manageRoles',
  'managePermissions',
  'manageMembers',
  'kickMembers',
  'banMembers',
  'createCategories',
  'editCategories',
  'deleteCategories',
  'createTextChannels',
  'editTextChannels',
  'deleteTextChannels',
  'createVoiceChannels',
  'editVoiceChannels',
  'deleteVoiceChannels',
  'manageEvents'
]
