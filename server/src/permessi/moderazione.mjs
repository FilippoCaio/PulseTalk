// permessi/moderazione.mjs - chi puo' moderare la voce, dove, e fin quando.
//
// Due livelli, e il secondo e' quello che va guardato con attenzione.
//
// **Amministratore dello spazio.** Ha il permesso — nello spazio o come
// override sul canale — e allora vale su chiunque, in qualunque canale vocale
// dello spazio, con la sola gerarchia dei ruoli a fermarlo. E' il livello che
// esisteva gia' per "caccia dalla stanza".
//
// **Organizzatore di un evento.** Non amministra niente: ha `createEvents`, ha
// creato un evento, e dentro a quell'evento — in quel canale, in quelle ore —
// puo' fare le stesse cose. Serve, perche' chi organizza una serata deve poter
// zittire chi la sta rovinando senza svegliare l'amministratore del NAS.
//
// I confini sono stretti apposta, e ognuno risponde a un modo preciso di
// abusarne:
//
//   solo nel canale dell'evento   altrimenti "crea eventi" darebbe la
//                                 moderazione di tutto lo spazio
//   solo nella sua finestra       altrimenti basterebbe un evento nel 2019 per
//                                 comandare oggi
//   niente evento senza canale    "in tutte le stanze" non e' una risposta
//   niente evento annullato       annullarlo e' esattamente il modo di dire
//                                 che quella serata non si fa
//   non contro chi sta piu' in    altrimenti "crea eventi" sarebbe la strada
//   alto nello spazio             per zittire il proprietario dello spazio:
//                                 una scalata di privilegi nascosta dentro a
//                                 un permesso che sembra innocuo
//
// E non si delega: i poteri sono di chi ha creato l'evento, non di chi lui
// decide. Un organizzatore che potesse nominare un secondo organizzatore
// avrebbe di fatto il permesso di distribuire moderazione, che e'
// `manageRoles` sotto un altro nome.

import { accessoAlCanale } from '../permessi.mjs';
import { eventoInCorso } from '../dati/restrizioni.mjs';

/**
 * Quale permesso serve per ciascun provvedimento.
 *
 * Nessun permesso nuovo: `muteMembers` e `deafenMembers` dicono gia'
 * esattamente queste due cose, e camera e condivisione sono "decido cosa puoi
 * mandare in questa stanza", che e' il mestiere di `manageVoiceMembers` — lo
 * stesso che serve a cacciare qualcuno fuori. Aggiungerne un quinto avrebbe
 * significato una riga in piu' in due cataloghi per una distinzione che
 * nessuno avrebbe saputo spiegare.
 */
export const PERMESSO_PER_GENERE = {
  microfono: 'muteMembers',
  cuffie: 'deafenMembers',
  camera: 'manageVoiceMembers',
  condivisione: 'manageVoiceMembers',
};

/** Chi sta troppo in alto perche' un organizzatore possa toccarlo. */
const INTOCCABILI_DA_ORGANIZZATORE = ['manageServer', 'manageEvents'];

/**
 * Puo' fare questa cosa, a questa persona, in questo canale?
 *
 * Restituisce l'errore da spedire, oppure il contesto gia' pronto — la stessa
 * forma delle altre funzioni di `permessi.mjs`, per la stessa ragione: una
 * rotta che dimentica di guardare il valore di ritorno e' un difetto che si
 * vede leggendo, mentre un'eccezione dimenticata sembra codice a posto.
 *
 * `evento` nel risultato e' l'id dell'evento sotto la cui autorita' si sta
 * agendo, oppure `null` per un amministratore. Va scritto nella restrizione:
 * e' cio' che la fa decadere quando l'evento finisce.
 */
export function puoModerareLaVoce(db, chi, canaleId, { bersaglio, genere }) {
  const permesso = PERMESSO_PER_GENERE[genere];
  if (!permesso) return { errore: 'provvedimento sconosciuto', stato: 400 };
  return verifica(db, chi, canaleId, { bersaglio, permesso });
}

/**
 * Espellere dalla stanza, con le stesse regole di tutto il resto.
 *
 * Sta qui e non in `routes/spazi.mjs` perche' e' la stessa autorita': chi
 * organizza un evento e puo' zittire deve poter anche mandare fuori, e prima
 * quella rotta guardava soltanto il permesso nello spazio — quindi
 * l'organizzatore poteva togliere il microfono a qualcuno e non poteva
 * mandarlo via, che e' il provvedimento piu' lieve dei due.
 */
export function puoEspellereDallaVoce(db, chi, canaleId, bersaglio) {
  return verifica(db, chi, canaleId, { bersaglio, permesso: 'manageVoiceMembers' });
}

/**
 * Cosa puo' fare in questo canale, senza un bersaglio in mente.
 *
 * Serve all'interfaccia: quali voci del menu disegnare. A dire di no e'
 * comunque il server su ogni richiesta — questo elenco decide solo cosa
 * mostrare, e un client modificato che se le desse tutte otterrebbe soltanto
 * dei pulsanti che rispondono 403.
 */
export function poteriDiModerazione(db, chi, { canale, spazio, permessi }) {
  const organizzatore = !!eventoCheAutorizza(db, chi, { canale, spazio, permessi });
  return {
    moderatore: permessi.has('manageVoiceMembers') || organizzatore,
    puoZittire: permessi.has('muteMembers') || organizzatore,
    puoAssordare: permessi.has('deafenMembers') || organizzatore,
    comeOrganizzatore: organizzatore,
  };
}

function verifica(db, chi, canaleId, { bersaglio, permesso }) {
  const esito = accessoAlCanale(db, chi, canaleId);
  if (esito.errore) return esito;
  if (esito.diretto) return { errore: 'canale inesistente', stato: 404 };
  if (esito.canale.tipo !== 'voce') {
    return { errore: 'questo non e\' un canale vocale', stato: 400 };
  }

  if (bersaglio === chi.id) {
    return { errore: 'non puoi farlo a te stesso', stato: 400 };
  }
  if (!db.utente(bersaglio)) return { errore: 'utente inesistente', stato: 404 };
  // Chi non e' nello spazio non e' moderabile in nessun canale suo: non e' una
  // finezza, e' cio' che impedisce di scrivere restrizioni per persone che con
  // questo spazio non hanno niente a che fare.
  if (!db.ruoloNelloSpazio(esito.spazio.id, { id: bersaglio, ruolo: 'membro' })) {
    return { errore: 'questa persona non e\' in questo spazio', stato: 404 };
  }

  // -- La strada dell'amministratore ----------------------------------------
  if (esito.permessi.has(permesso)) {
    const alto = fermatoDallaGerarchia(db, esito, chi, bersaglio);
    if (alto) return { errore: alto, stato: 403 };
    return { ...esito, evento: null, comeOrganizzatore: false };
  }

  // -- La strada dell'organizzatore -----------------------------------------
  const evento = eventoCheAutorizza(db, chi, esito);
  if (!evento) {
    return { errore: `non puoi moderare questo canale vocale`, stato: 403 };
  }

  const suoi = db.permessiIn({ id: bersaglio, ruolo: 'membro' }, {
    spazio: esito.spazio,
    canale: esito.canale,
  });
  if (bersaglio === esito.spazio.proprietario) {
    return { errore: 'il proprietario dello spazio non si tocca', stato: 403 };
  }
  if (INTOCCABILI_DA_ORGANIZZATORE.some((p) => suoi.has(p))) {
    return {
      errore: 'questa persona sta piu\' in alto di te in questo spazio',
      stato: 403,
    };
  }
  // L'admin dell'istanza non lo tocca nemmeno l'organizzatore: e' lo stesso
  // che potrebbe aprire il database a mano.
  if (db.utente(bersaglio)?.ruolo === 'admin') {
    return { errore: 'questa persona sta piu\' in alto di te in questo spazio', stato: 403 };
  }

  return { ...esito, evento: evento.id, comeOrganizzatore: true };
}

/**
 * L'evento, suo e in corso, che gli da' il comando in questo canale.
 *
 * Il primo che vale, e non serve sceglierne uno in particolare: due eventi
 * sovrapposti nello stesso canale dello stesso organizzatore conferiscono la
 * stessa cosa, e la restrizione ne cita uno — quando quello finisce, decade.
 *
 * `createEvents` si ricontrolla qui e non ci si fida di averlo avuto quando
 * l'evento e' stato creato: chi si e' visto togliere quel permesso non deve
 * continuare a comandare grazie a un evento scritto quando ce l'aveva.
 */
function eventoCheAutorizza(db, chi, esito) {
  if (!esito.permessi.has('createEvents')) return null;

  for (const evento of db.eventiSpazio.dello(esito.spazio.id)) {
    if (evento.canale !== esito.canale.id) continue;
    if (evento.creatoDa !== chi.id) continue;
    if (!eventoInCorso(evento)) continue;
    return evento;
  }
  return null;
}

/**
 * La gerarchia dei ruoli, con le stesse regole di "caccia dalla stanza".
 *
 * Scritta qui invece che importata da `routes/spazi.mjs` perche' li' e' una
 * funzione privata di quel file; il giorno in cui si volessero unificare, il
 * posto giusto e' questo — non l'altro.
 */
function fermatoDallaGerarchia(db, esito, chi, bersaglio) {
  if (bersaglio === esito.spazio.proprietario) return 'il proprietario non si tocca';
  // Chi amministra la macchina e il padrone di casa passano sopra a tutto:
  // sono gli stessi che potrebbero aprire il database a mano, e fingere che un
  // numero di priorita' li fermi sarebbe una recita.
  if (chi.ruolo === 'admin' || esito.spazio.proprietario === chi.id) return null;

  const alto = (elenco) => elenco.reduce((max, r) => Math.max(max, r.priorita ?? 0), 0);
  const suoi = alto(db.ruoli.diUtente(esito.spazio.id, bersaglio));
  const miei = alto(db.ruoli.diUtente(esito.spazio.id, chi.id));
  return suoi >= miei ? 'questa persona sta al tuo stesso livello, o piu\' in alto' : null;
}
