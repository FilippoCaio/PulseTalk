// canali-temporanei.mjs - la scadenza persistente dei canali.
//
// La data sta nel database: questo giro serve soltanto a rendere effettiva la
// cancellazione e a chiudere le stanze LiveKit. Anche se il processo resta
// spento per ore, al riavvio trova tutto cio' che nel frattempo e' scaduto.

/** Elimina tutti i canali arrivati a scadenza e restituisce quanti erano. */
export async function spazzaCanaliTemporanei({ db, presenze, eventi, log = null }) {
  const scaduti = db.canaliScaduti();
  for (const canale of scaduti) {
    const destinatari = db.membriDi(canale.spazio).map((m) => m.id);
    if (canale.tipo === 'voce') {
      await presenze.chiudiStanza(db.chiaveSfu(canale)).catch((errore) =>
        log?.warn({ err: errore, canale: canale.id }, 'stanza scaduta non raggiungibile sulla SFU'),
      );
    }
    db.eliminaCanale(canale.id);
    eventi.aUtenti(destinatari, { tipo: 'spazi' });
    log?.info({ canale: canale.id, spazio: canale.spazio }, 'canale temporaneo scaduto');
  }
  return scaduti.length;
}

/** Avvia il recupero iniziale e un giro breve; il timer non tiene vivo Node. */
export async function avviaScadenzaCanali(contesto, ogniMs = 15_000) {
  let inCorso = null;
  const giro = () => {
    inCorso ??= spazzaCanaliTemporanei(contesto)
      .catch((errore) => contesto.log?.error({ err: errore }, 'scadenza canali fallita'))
      .finally(() => {
        inCorso = null;
      });
    return inCorso;
  };

  await giro();
  const timer = setInterval(giro, ogniMs);
  timer.unref();
  return () => clearInterval(timer);
}
