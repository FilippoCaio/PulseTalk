// moderazione.mjs - portare le restrizioni scritte fin dentro alla SFU.
//
// Le restrizioni sono righe su disco (`dati/restrizioni.mjs`) e la loro verita'
// sta li'. Questo modulo e' l'altra meta': quello che le rende vere *adesso*,
// per chi e' gia' dentro a una stanza, e quello che avvisa chi deve saperlo.
//
// Sta fuori dalle rotte perche' ci passano da due parti — la rotta che impone
// un provvedimento, e lo spazzino che li fa decadere alla fine di un evento — e
// due copie di questo calcolo si sarebbero contraddette il giorno in cui una
// delle due fosse cambiata. A contraddirsi, poi, sarebbe stata quella che
// concede.

import { permessiPartecipante } from './sfu.mjs';
import { puoTrasmettere } from './permessi.mjs';

export function creaModerazione({ db, eventi, presenze, log = null }) {
  /** Una restrizione come la legge il client: cosa, da chi, da quando. */
  const pubblica = (riga) => ({
    genere: riga.genere,
    istante: riga.istante,
    evento: riga.evento,
    // Il nome e non solo l'id: chi legge "microfono bloccato" ha bisogno di
    // sapere da chi, e cercarlo in un secondo giro di rete vorrebbe dire
    // mostrargli un numero per tutto il tempo che ci mette.
    da: riga.daUtente ? { id: riga.daUtente, nome: db.utente(riga.daUtente)?.nome ?? null } : null,
  });

  /**
   * Rimette i permessi della SFU d'accordo con il database.
   *
   * Si ricalcola tutto da capo — permessi dello spazio compresi — invece di
   * applicare la differenza: una differenza si sbaglia una volta e resta
   * sbagliata, mentre un ricalcolo completo si autocorregge al giro dopo.
   *
   * Non fallisce mai in modo rumoroso. La persona puo' essersene andata dalla
   * stanza un istante prima, e in quel caso non c'e' niente da aggiornare: cio'
   * che e' scritto resta scritto, e al rientro il gettone lo porta con se'.
   */
  async function applica(canale, spazio, utenteId) {
    const utente = db.utente(utenteId);
    if (!utente) return false;

    const ruolo = db.ruoloNelloSpazio(spazio.id, utente);
    const suoi = db.permessiIn(utente, { spazio, canale });

    const permessi = permessiPartecipante({
      puoTrasmettere: puoTrasmettere({ utente, ruoloSpazio: ruolo, canale, permessi: suoi }),
      puoCondividere: suoi.has('stream'),
      restrizioni: db.restrizioni.di(canale.id, utenteId),
    });

    return presenze.aggiornaPermessi(db.chiaveSfu(canale), `u${utenteId}`, permessi);
  }

  /**
   * Chi deve sapere che le restrizioni di questa persona sono cambiate.
   *
   * Il bersaglio sempre: deve vedere scritto cosa non puo' fare e chi
   * gliel'ha impedito, invece di trovarsi un pulsante che non risponde. E chi
   * sta dentro alla stanza, perche' e' li' che si vede lo stato degli altri.
   *
   * Nessun altro. Chi sta leggendo una chat in un altro spazio non ha nessun
   * motivo di ricevere questo, e mandarglielo vorrebbe dire raccontare a mezza
   * istanza chi e' stato zittito.
   */
  async function avvisa(canale, utenteId) {
    const destinatari = new Set([utenteId]);
    try {
      const dentro = (await presenze.leggi()).get(db.chiaveSfu(canale)) ?? [];
      for (const persona of dentro) {
        const id = Number(String(persona.identita).slice(1));
        if (Number.isInteger(id)) destinatari.add(id);
      }
    } catch {
      // La SFU muta non deve impedire al bersaglio di sapere cosa gli e'
      // successo: si avvisa comunque lui, che e' il destinatario che conta.
    }

    eventi.aUtenti([...destinatari], {
      tipo: 'restrizioni',
      canale: canale.id,
      utente: utenteId,
      restrizioni: leggiPer(canale.id, utenteId),
    });
  }

  const leggiPer = (canaleId, utenteId) =>
    db.restrizioni.righeDi(canaleId, utenteId).map(pubblica);

  /**
   * Le restrizioni di un evento finito smettono di valere, e si vede.
   *
   * Il database le butta via da solo alla prima lettura (`scadi`), ma buttarle
   * via non basta: chi le sta subendo e' collegato adesso, con dei permessi
   * scritti nella SFU che nessuno ha piu' motivo di tenere. Senza questo giro,
   * la fine di un evento si sarebbe fatta sentire solo al prossimo ingresso —
   * cioe' a chi resta in stanza a chiacchierare dopo, mai.
   */
  async function spazzaScadute() {
    const cadute = db.restrizioni.scadi();
    if (cadute.length === 0) return 0;

    // Una persona per canale, non una riga per volta: quattro restrizioni che
    // decadono insieme sono una sola riscrittura di permessi e un solo evento.
    const perCanale = new Map();
    for (const riga of cadute) {
      if (!perCanale.has(riga.canale)) perCanale.set(riga.canale, new Set());
      perCanale.get(riga.canale).add(riga.utente);
    }

    for (const [canaleId, utenti] of perCanale) {
      const canale = db.canale(canaleId);
      if (!canale) continue;
      const spazio = db.spazio(canale.spazio);
      if (!spazio) continue;

      for (const utenteId of utenti) {
        await applica(canale, spazio, utenteId).catch(() => false);
        await avvisa(canale, utenteId);
      }
    }

    log?.info({ quante: cadute.length }, 'restrizioni decadute con la fine del loro evento');
    return cadute.length;
  }

  return { applica, avvisa, leggiPer, pubblica, spazzaScadute };
}
