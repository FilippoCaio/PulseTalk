import { richiedeRuolo } from '../auth.mjs';
import { giorniDellaSettimana, lunediDi } from '../ore-lavoro.mjs';

// routes/ore.mjs - il cartellino, da leggere in due modi.
//
// Due rotte e una regola sola: **chi lavora vede le proprie ore, chi
// amministra le vede tutte**. Non c'e' una terza via, e in particolare non
// c'e' modo di guardare le ore di una singola persona senza essere
// amministratore — se ci fosse, sarebbe la funzione con cui i colleghi si
// controllano fra loro, che e' un'altra cosa da quella per cui questo registro
// esiste.
//
// Con le impostazioni di lavoro spente le rotte rispondono 404 invece di
// restituire zeri: uno zero e' un dato, e dire "hai fatto zero ore" a chi sta
// su un server dove nessuno conta niente sarebbe una bugia. Il 404 dice
// l'unica cosa vera — qui il registro non esiste.

/** Un lunedi' scritto bene, o niente. */
function settimanaChiesta(grezzo) {
  const testo = String(grezzo ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testo)) return null;
  // Si normalizza al lunedi' della sua settimana: cosi' un giorno qualunque
  // passato per sbaglio non restituisce sei giorni sfalsati, che sarebbe un
  // errore silenzioso e credibile.
  return lunediDi(new Date(`${testo}T12:00:00`));
}

export function rotteOre(app, { servizi, ore, config }) {
  const impostazioni = () => servizi?.config?.lavoro ?? config.lavoro;
  const acceso = () => impostazioni()?.attivo === true;

  const spento = (risposta) =>
    risposta.code(404).send({ errore: "il registro delle ore non e' acceso su questo server" });

  /** L'ossatura comune: settimana, giorni, obiettivo. */
  const cornice = (settimana) => ({
    settimana,
    giorni: giorniDellaSettimana(settimana),
    oreSettimana: impostazioni()?.oreSettimana ?? 40,
  });

  /**
   * Le mie ore di questa settimana, o di una passata.
   *
   * Non chiede nessun ruolo: sono i propri numeri, e l'unica ragione per cui
   * questa rotta esiste e' che chi e' contato possa contare a sua volta.
   */
  app.get('/api/ore/mie', async (richiesta, risposta) => {
    if (!acceso()) return spento(risposta);

    const settimana = settimanaChiesta(richiesta.query?.settimana) ?? lunediDi();
    const tutte = ore.riepilogo(settimana);
    const mie = tutte.persone.find((p) => p.utente === richiesta.utente.id) ?? {
      utente: richiesta.utente.id,
      nome: richiesta.utente.nome,
      giorni: {},
      secondi: 0,
    };

    return { ...cornice(settimana), mie };
  });

  /** Tutte le ore di tutti, per chi amministra l'istanza. */
  app.get('/api/ore', { onRequest: richiedeRuolo('admin') }, async (richiesta, risposta) => {
    if (!acceso()) return spento(risposta);

    const settimana = settimanaChiesta(richiesta.query?.settimana) ?? lunediDi();
    const tutte = ore.riepilogo(settimana);

    return {
      ...cornice(settimana),
      persone: tutte.persone,
      // Le settimane gia' chiuse su disco: servono a sapere fin dove si puo'
      // tornare indietro senza provare a caso.
      archivio: ore.settimaneSuDisco(),
    };
  });

  /**
   * Chiude a mano la settimana e ne scrive il file.
   *
   * Di suo lo fa da solo al primo battito del lunedi'. Questa rotta serve al
   * caso in cui serva il file **adesso** - una settimana da consegnare oggi -
   * e a quello in cui il server fosse spento nel momento del passaggio.
   * Riscrivere un file gia' scritto e' innocuo: i numeri vengono dal database,
   * che e' lo stesso di prima.
   */
  app.post('/api/ore/chiudi', { onRequest: richiedeRuolo('admin') }, async (richiesta, risposta) => {
    if (!acceso()) return spento(risposta);

    const settimana = settimanaChiesta(richiesta.body?.settimana) ?? lunediDi();
    const percorso = await ore.scriviSettimana(settimana);
    if (!percorso) {
      return risposta.code(400).send({ errore: 'in quella settimana non ha lavorato nessuno' });
    }
    richiesta.log.info({ da: richiesta.utente.id, settimana }, 'ore: settimana chiusa a mano');
    return { settimana, scritto: true };
  });
}
