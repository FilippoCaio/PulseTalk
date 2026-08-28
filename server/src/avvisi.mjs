// avvisi.mjs - dire per posta cio' che non si puo' vedere.
//
// "E' entrato qualcuno in un canale vocale" e' l'informazione che fa nascere
// meta' delle serate qui dentro, e ha un difetto: la vede solo chi e' gia'
// dentro. Chi ha chiuso l'applicazione non sa che gli altri ci sono, e non lo
// scopre finche' non la riapre — cioe' quasi sempre troppo tardi.
//
// TRE REGOLE, e sono tutte per non trasformare questo in spam. Una casella che
// riceve venti messaggi a sera diventa una casella con un filtro, e da li' in
// poi la funzione non esiste piu' anche se il codice continua a girare.
//
//   **Solo a chi non e' collegato.** Se l'applicazione e' aperta, quello che
//   succede si vede: la colonna dei canali si accende da sola. Mandare anche
//   una mail vorrebbe dire dire due volte la stessa cosa a chi la sapeva gia'.
//
//   **Al massimo una ogni tanto.** Passata la prima, per un po' non ne parte
//   nessun'altra. Non c'e' nessuna coda e nessun timer: gli avvisi successivi
//   dentro alla finestra si buttano via. Sembra una perdita e non lo e' — il
//   messaggio da consegnare non e' "chi e' entrato", e' "ci sono, vieni". Una
//   volta e' esattamente quante volte va detto.
//
//   **Solo a chi lo ha chiesto.** Spento di serie, e non per prudenza
//   generica: chi non l'ha acceso non ha dato il suo indirizzo per questo.
//
// E UNA REGOLA CHE NON E' SUL VOLUME, ed e' la piu' importante. Chi si mette
// invisibile non compare in nessun avviso. Lo stato invisibile vale finche'
// tutte le strade lo rispettano, e una mail e' la peggiore in cui perderlo:
// resta scritta, e chi la riceve la rilegge quando vuole. Il filtro passa da
// `stati.visibile`, che e' il posto unico dove quella regola vive — scriverla
// una seconda volta qui dentro vorrebbe dire aspettare che le due divergano.

/** Quanto silenzio dopo un avviso, per la stessa persona. */
const FINESTRA_MINUTI = 30;

/** Gli avvisi che si possono accendere, uno per riga nel pannello. */
export const AVVISI = [
  {
    chiave: 'vocale',
    nome: 'Quando qualcuno entra in un canale vocale',
    sotto:
      "Arriva solo se in quel momento non sei collegato, e al massimo una ogni mezz'ora: serve a farti sapere che ci sono, non a raccontarti la serata.",
  },
];

const CHIAVI = new Set(AVVISI.map((a) => a.chiave));

/** Le preferenze salvate, ripulite da cio' che non e' piu' nel catalogo. */
export function leggiPreferenze(grezzo) {
  let dentro = {};
  try {
    // Una preferenza illeggibile non deve impedire di entrare: si ricade sul
    // silenzio, che e' anche il valore di serie.
    dentro = JSON.parse(grezzo || '{}');
  } catch {
    dentro = {};
  }
  const fuori = {};
  for (const { chiave } of AVVISI) fuori[chiave] = dentro?.[chiave] === true;
  return fuori;
}

export function scriviPreferenze(modifiche, precedenti = {}) {
  const fuori = { ...leggiPreferenze(JSON.stringify(precedenti)) };
  for (const [chiave, valore] of Object.entries(modifiche ?? {})) {
    if (!CHIAVI.has(chiave)) continue;
    fuori[chiave] = valore === true;
  }
  return JSON.stringify(fuori);
}

export function creaAvvisi({ db, eventi, stati, servizi, log, finestraMinuti = FINESTRA_MINUTI }) {
  // L'ultima volta che si e' scritto a ciascuno. In memoria e non sul disco:
  // e' uno stato che al riavvio deve sparire — dopo un riavvio nessuno ha
  // ricevuto niente di recente, e ricominciare da capo e' corretto.
  const ultimo = new Map();

  function troppoPresto(utenteId) {
    const quando = ultimo.get(utenteId);
    return quando !== undefined && Date.now() - quando < finestraMinuti * 60_000;
  }

  /**
   * Chi va avvisato che questa persona e' entrata in un canale.
   *
   * Si parte dai membri dello spazio e si toglie, in quest'ordine: chi e'
   * entrato, chi e' collegato, chi non lo ha chiesto, chi non ha un indirizzo
   * dimostrato, e chi ha gia' ricevuto qualcosa da poco.
   */
  function daAvvisare(chiEntra, spazioId) {
    return db
      .membriDi(spazioId)
      .map((m) => db.utente(m.id))
      .filter((u) => {
        if (!u || u.id === chiEntra.id) return false;
        if (eventi.collegato(u.id)) return false;
        if (!u.email || !u.emailConfermata) return false;
        if (!leggiPreferenze(u.avvisiEmail).vocale) return false;
        return !troppoPresto(u.id);
      });
  }

  return {
    /**
     * Qualcuno e' entrato in un canale vocale.
     *
     * Non aspetta nessuno: chi la chiama e' un webhook della SFU, che vuole un
     * 200 subito e ritenta se non lo ottiene. Un invio di posta lento
     * trascinerebbe il webhook con se'.
     */
    entratoInVocale({ utenteId, spazioId, canale }) {
      if (!servizi.posta.disponibile) return;

      const chi = db.utente(utenteId);
      if (!chi) return;

      // Invisibile non si dice mai, nemmeno per posta. Anzi: soprattutto per
      // posta, perche' li' resta scritto.
      if (stati.visibile(chi) === 'offline') return;

      for (const destinatario of daAvvisare(chi, spazioId)) {
        ultimo.set(destinatario.id, Date.now());
        servizi.posta
          .invia({
            a: destinatario.email,
            oggetto: `${chi.nome} e' in chiamata su PulseTalk`,
            testo: [
              `Ciao ${destinatario.nome},`,
              '',
              `${chi.nome} e' appena entrato in ${canale ? `«${canale}»` : 'un canale vocale'}.`,
              '',
              'Se ti va, apri PulseTalk.',
              '',
              `Non riceverai un altro avviso per almeno ${finestraMinuti} minuti, e nessuno`,
              'mentre sei collegato. Si spegne da Impostazioni, nella pagina del',
              'tuo profilo.',
            ].join('\n'),
          })
          .catch((errore) => {
            // Un avviso che non parte non e' un guasto da propagare: e' una
            // comodita' mancata. Nel log, dove lo legge chi amministra.
            log?.warn?.({ errore: errore.message }, 'avviso per posta non spedito');
          });
      }
    },

    /** Solo per i test: fa finta che non sia stato mandato ancora niente. */
    dimentica() {
      ultimo.clear();
    },
  };
}
