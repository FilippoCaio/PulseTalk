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

import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';

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
export async function creaGettone({ utente, stanza, config, moderatore = false }) {
  const puoTrasmettere = !stanza.soloAscolto;

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
    canSubscribe: true,
    canPublish: puoTrasmettere,
    canPublishData: true,
    // Serve per la mano alzata e per il "sto scrivendo": sono attributi
    // dell'utente su se stesso, non su altri.
    canUpdateOwnMetadata: true,
    // Volutamente assente: `roomAdmin`. Cacciare e zittire passano dalle
    // nostre rotte, che controllano il ruolo nel nostro database. Se il
    // permesso vivesse nel gettone, un gettone vecchio continuerebbe a
    // moderare anche dopo una revoca.
  });

  return gettone.toJwt();
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

  async chiudiStanza(chiaveStanza) {
    await this.#cliente.deleteRoom(chiaveStanza);
    this.invalida();
  }
}
