// sfu.mjs - il rapporto con LiveKit.
//
// LiveKit e' un SFU: riceve i pacchetti di chi trasmette e li ripete a chi
// ascolta, senza decodificarli. Non transcodifica, quindi un 4K60 gli costa
// quanto un 480p — banda, non CPU — ed e' la ragione per cui tutto questo puo'
// girare su un NAS invece che su una scheda video.
//
// Questo modulo e' l'unico punto in cui il piano di controllo tocca la SFU. Fa
// tre cose: firma i gettoni con cui le app entrano, chiede chi c'e' dentro, e
// caccia fuori chi deve uscire.

import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';

/**
 * Il gettone con cui l'app entra in un canale vocale.
 *
 * E' un JWT firmato con SFU_API_SECRET, e la SFU lo verifica da sola: il
 * piano di controllo non viene interpellato al momento dell'ingresso, e se
 * questo processo e' spento le chiamate gia' in corso non se ne accorgono.
 *
 * I permessi arrivano gia' decisi: chi puo' trasmettere dove lo stabilisce
 * `permessi.mjs`, incrociando il ruolo nell'istanza, quello nello spazio e il
 * tipo di canale. Qui si firma soltanto — se questa funzione ricalcolasse i
 * permessi per conto suo, ci sarebbero due regole in due posti, e prima o poi
 * a divergere sarebbe quella che concede.
 *
 * L'identita' e' l'id numerico dell'utente, non il nome. Due persone possono
 * chiamarsi Marco; due utenti non possono avere lo stesso id, e LiveKit usa
 * l'identita' per decidere chi buttare fuori quando la stessa persona si
 * ricollega da un'altra macchina.
 */
export async function creaGettone({
  utente,
  stanza,
  config,
  moderatore = false,
  puoCondividere = true,
  restrizioni = new Set(),
}) {
  const puoTrasmettere = !stanza.soloAscolto;
  const permessi = permessiPartecipante({ puoTrasmettere, puoCondividere, restrizioni });

  const gettone = new AccessToken(config.sfuChiave, config.sfuSegreto, {
    identity: `u${utente.id}`,
    name: utente.nome,
    ttl: config.gettoneTtlSec,
    // Viaggia dentro il gettone e arriva a tutti gli altri partecipanti: e'
    // cosi' che l'interfaccia sa disegnare la coroncina accanto a chi modera,
    // senza una seconda chiamata e senza fidarsi di quello che dice il client.
    metadata: JSON.stringify({ ruolo: utente.ruolo, moderatore }),
  });

  gettone.addGrant({
    room: stanza.chiave,
    roomJoin: true,
    canSubscribe: permessi.canSubscribe,
    canPublish: permessi.canPublish,
    canPublishSources: permessi.canPublishSources,
    canPublishData: permessi.canPublishData,
    // Serve per la mano alzata e per il "sto scrivendo": sono attributi
    // dell'utente su se stesso, non su altri.
    canUpdateOwnMetadata: permessi.canUpdateMetadata,
    // Volutamente assente: `roomAdmin`. Cacciare e zittire passano dalle
    // nostre rotte, che controllano il ruolo nel nostro database. Se il
    // permesso vivesse nel gettone, un gettone vecchio continuerebbe a
    // moderare anche dopo una revoca.
  });

  return gettone.toJwt();
}

/** Le quattro sorgenti che LiveKit distingue, nell'ordine in cui le pensiamo. */
const TUTTE_LE_SORGENTI = [
  TrackSource.CAMERA,
  TrackSource.MICROPHONE,
  TrackSource.SCREEN_SHARE,
  TrackSource.SCREEN_SHARE_AUDIO,
];

/**
 * Cosa questa persona puo' mandare e ricevere in questa stanza.
 *
 * Un posto solo, e ci passano tutti e due i momenti in cui la domanda si pone:
 * quando si firma il gettone (all'ingresso) e quando si riscrivono i permessi
 * a caldo (moderando chi e' gia' dentro). Due calcoli in due posti avrebbero
 * prodotto la cosa peggiore possibile — una restrizione che vale finche' non
 * esci e rientri.
 *
 * Tre cose vanno sapute di come LiveKit legge questi campi, e tutte e tre sono
 * il genere di dettaglio che si scopre tardi:
 *
 *   1. `canPublishSources` vuoto vuol dire "tutte", non "nessuna". Quindi per
 *      togliere una sorgente bisogna elencare per esteso quelle che restano,
 *      non togliere quella di troppo da una lista vuota.
 *   2. i permessi si sostituiscono in blocco. `UpdateFromPermission` riscrive
 *      l'intero grant dal messaggio ricevuto, quindi ogni campo che si vuole
 *      conservare va rimandato ogni volta.
 *   3. togliere una sorgente chiude cio' che sta gia' viaggiando: alla
 *      modifica dei permessi il server scorre le tracce pubblicate e stacca
 *      quelle non piu' consentite. E' esattamente cio' che serve per "togli la
 *      condivisione", che deve anche chiudere quella in corso.
 *
 * Una nota per chi un giorno leggera' i log della SFU e si preoccupera': in
 * `UpdateParticipant` i campi booleani falsi **non compaiono** nel JSON. Non e'
 * un pezzo che si perde per strada — e' proto3, dove il valore di serie di un
 * bool e' `false` e chi serializza lo omette. Dall'altra parte il campo assente
 * torna `false`, che e' esattamente quello che si voleva dire. Quindi un
 * `UpdateParticipant` senza `canSubscribe` e' un "non sente", non un "non l'ho
 * detto".
 *
 * `canSubscribe: false` e' l'unica applicazione onesta delle cuffie forzate.
 * Abbassare il volume nel client lascia la sottoscrizione aperta, e con la
 * sottoscrizione aperta l'audio arriva davvero al computer di chi non dovrebbe
 * sentirlo: bastano due righe per riascoltarlo. Tolta la sottoscrizione, il
 * server smette proprio di mandare — e, sempre in `SetPermission`, chiude
 * anche quelle gia' aperte.
 */
export function permessiPartecipante({
  puoTrasmettere = true,
  puoCondividere = true,
  restrizioni = new Set(),
}) {
  const sorgenti = TUTTE_LE_SORGENTI.filter((sorgente) => {
    if (sorgente === TrackSource.CAMERA) return !restrizioni.has('camera');
    if (sorgente === TrackSource.MICROPHONE) return !restrizioni.has('microfono');
    // Lo schermo e il suo audio sono una cosa sola: consentirne uno solo dei
    // due vorrebbe dire una condivisione muta o un suono senza immagine, che
    // non e' nessuna delle cose che qualcuno ha chiesto.
    return puoCondividere && !restrizioni.has('condivisione');
  });

  return {
    // Nessuna sorgente consentita vuol dire che non c'e' niente da pubblicare:
    // lasciare `canPublish` acceso con una lista vuota sarebbe la trappola del
    // punto 1 qui sopra, cioe' "tutte".
    canPublish: puoTrasmettere && sorgenti.length > 0,
    canPublishSources: sorgenti,
    canSubscribe: !restrizioni.has('cuffie'),
    canPublishData: true,
    canUpdateMetadata: true,
  };
}

/**
 * Il cliente per le operazioni di servizio.
 *
 * Parla con la SFU dall'interno della rete di compose, in chiaro: TLS fra due
 * container sulla stessa macchina proteggerebbe da un attaccante che e' gia'
 * dentro l'host, cioe' da uno che ha gia' vinto.
 */
export function creaCliente(config) {
  return new RoomServiceClient(config.sfuApiUrl, config.sfuChiave, config.sfuSegreto);
}

export function creaVerificatore(config) {
  return new WebhookReceiver(config.sfuChiave, config.sfuSegreto);
}

/**
 * Chi c'e' dentro, stanza per stanza.
 *
 * La verita' su chi sta parlando ce l'ha la SFU, non noi: qui non c'e' nessuna
 * tabella "presenze" da tenere allineata, e un riavvio del piano di controllo
 * non lascia in giro nessuno che sembra collegato e non lo e'.
 *
 * La cache da un secondo esiste per l'atrio aperto in dieci finestre: senza,
 * ogni finestra interrogherebbe la SFU per conto suo.
 */
export class Presenze {
  #cliente;
  #cache = null;
  #scade = 0;
  #inVolo = null;

  constructor(config, log) {
    this.#cliente = creaCliente(config);
    this.log = log;
  }

  invalida() {
    this.#scade = 0;
  }

  async leggi() {
    if (this.#cache && Date.now() < this.#scade) return this.#cache;
    // Dieci richieste simultanee su una cache scaduta devono produrre una sola
    // chiamata alla SFU, non dieci.
    this.#inVolo ??= this.#interroga().finally(() => {
      this.#inVolo = null;
    });
    return this.#inVolo;
  }

  async #interroga() {
    const dentro = new Map();
    try {
      const stanze = await this.#cliente.listRooms();
      for (const stanza of stanze) {
        const partecipanti = await this.#cliente.listParticipants(stanza.name);
        dentro.set(
          stanza.name,
          partecipanti.map((p) => ({
            identita: p.identity,
            nome: p.name || p.identity,
            entrato: Number(p.joinedAt) * 1000 || null,
            // Quanti stream sta davvero mandando. E' l'unica cosa dell'atrio
            // che non si potrebbe indovinare dal numero di persone, ed e'
            // quella che dice se in una stanza si sta lavorando o chiacchierando.
            schermi: p.tracks.filter((t) => t.source === 3 /* SCREEN_SHARE */).length,
            camera: p.tracks.some((t) => t.source === 1 /* CAMERA */),
            microfono: p.tracks.some((t) => t.source === 2 /* MICROPHONE */ && !t.muted),
          })),
        );
      }
      this.#cache = dentro;
      this.#scade = Date.now() + 1000;
    } catch (errore) {
      // La SFU spenta non deve rendere illeggibile l'atrio: si vede l'elenco
      // delle stanze, vuote, e si capisce dall'assenza che qualcosa non va.
      this.log?.warn({ err: errore }, 'la SFU non risponde: presenze non disponibili');
      this.#cache = dentro;
      this.#scade = Date.now() + 1000;
    }
    return this.#cache;
  }

  /**
   * Fa esistere la stanza sulla SFU, se non esiste gia'.
   *
   * Serve perche' `auto_create` in livekit.yaml e' spento: senza questa
   * chiamata la SFU riceve un gettone valido, non trova la stanza a cui si
   * riferisce, e risponde 404 a ogni tentativo di ingresso. Il client riprova
   * qualche volta e poi rinuncia — dal di fuori sembra che la chiamata entri
   * e esca subito.
   *
   * `createRoom` e' idempotente: chiamata su una stanza gia' viva restituisce
   * quella, senza toccare chi c'e' dentro. Quindi la si chiama a ogni ingresso
   * invece di tenere traccia di cosa esiste — che sarebbe uno stato in piu' da
   * mantenere allineato, e sbagliato dopo ogni riavvio della SFU.
   */
  async assicuraStanza(chiaveStanza, { personeMax = 0 } = {}) {
    await this.#cliente.createRoom({
      name: chiaveStanza,
      // Cinque minuti di grazia dopo l'uscita dell'ultimo: chi cade e rientra
      // ritrova la stanza invece di ricominciare da zero.
      emptyTimeout: 300,
      departureTimeout: 20,
      maxParticipants: personeMax,
    });
    this.invalida();
  }

  async caccia(chiaveStanza, identita) {
    await this.#cliente.removeParticipant(chiaveStanza, identita);
    this.invalida();
  }

  async zittisci(chiaveStanza, identita, sid, muto = true) {
    await this.#cliente.mutePublishedTrack(chiaveStanza, identita, sid, muto);
    this.invalida();
  }

  /**
   * Riscrive i permessi di chi e' gia' dentro, senza farlo uscire.
   *
   * E' la meta' che mancava alla moderazione. Scrivere la restrizione nel
   * database la rende vera al prossimo ingresso; questa la rende vera adesso,
   * che e' l'unico momento in cui a qualcuno interessa.
   *
   * `updateParticipant` sostituisce l'intero blocco dei permessi — non ne
   * aggiorna un campo — quindi cio' che arriva qui dentro deve essere gia'
   * completo. Lo produce `permessiPartecipante`, che e' anche quello che firma
   * il gettone: una regola sola per i due momenti.
   *
   * Se la persona nel frattempo e' uscita dalla stanza, LiveKit risponde che
   * non c'e': non e' un errore da propagare, e' la condizione normale di chi
   * viene moderato mentre sta chiudendo l'applicazione. Il database resta la
   * verita', e al rientro il gettone porta gia' le restrizioni giuste.
   */
  async aggiornaPermessi(chiaveStanza, identita, permessi) {
    try {
      await this.#cliente.updateParticipant(chiaveStanza, identita, { permission: permessi });
      this.invalida();
      return true;
    } catch (errore) {
      this.log?.debug?.(
        { err: errore, stanza: chiaveStanza, identita },
        "permessi non aggiornati: probabilmente non e' piu' nella stanza",
      );
      return false;
    }
  }

  /** Le tracce che una persona sta pubblicando adesso, cosi' come le vede la SFU. */
  async tracceDi(chiaveStanza, identita) {
    try {
      const partecipante = await this.#cliente.getParticipant(chiaveStanza, identita);
      return partecipante?.tracks ?? [];
    } catch {
      return [];
    }
  }

  async chiudiStanza(chiaveStanza) {
    await this.#cliente.deleteRoom(chiaveStanza);
    this.invalida();
  }
}
