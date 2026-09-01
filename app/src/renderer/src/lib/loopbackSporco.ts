/**
 * Quando il loopback si porta dietro anche il microfono.
 *
 * Il loopback di Windows — `loopback` e `loopbackWithMute` in
 * `main/cattura.ts` — non cattura "l'audio dell'applicazione": cattura cio' che
 * esce dal dispositivo di riproduzione predefinito, chiunque ce l'abbia messo.
 * Nella stragrande maggioranza dei casi ci sta dentro solo cio' che si voleva
 * condividere. In tre casi ci finisce anche la voce di chi condivide, e in
 * nessuno dei tre c'e' un errore da nessuna parte: e' il sistema che sta
 * facendo esattamente quello che gli e' stato chiesto.
 *
 *   1. l'uscita predefinita e' un dispositivo di missaggio — "Stereo Mix",
 *      "Missaggio stereo", "What U Hear", un cavo virtuale, VoiceMeeter — che
 *      per mestiere somma le sorgenti, microfono compreso;
 *   2. il microfono ha "Ascolta questo dispositivo" acceso nel pannello audio
 *      di Windows, che lo rimanda alle casse;
 *   3. la scheda audio ha un monitoraggio hardware acceso, cosa normalissima
 *      sulle interfacce audio esterne.
 *
 * Solo il primo si puo' riconoscere da qui, e si riconosce dal nome: gli altri
 * due vivono in impostazioni che nessuna API del web puo' leggere. Quello che
 * NON si fa in nessuno dei tre casi e' aggiungere il microfono alla traccia di
 * condivisione o toglierlo da li': sono due tracce diverse e restano due
 * tracce diverse fino alle orecchie di chi ascolta. Qui si riconosce e si
 * dice, che e' l'unica cosa onesta da fare — una condivisione sporca senza
 * spiegazione fa perdere mezz'ora a cercare il guasto nel posto sbagliato.
 */

/**
 * I nomi delle uscite che in realta' sono missaggi.
 *
 * Un elenco di nomi e' una cosa fragile per definizione, e va bene cosi': il
 * costo di un falso positivo e' una riga di avviso in piu' nel selettore, il
 * costo di un falso negativo e' una condivisione in cui si sente chi parla e
 * nessuno sa perche'. I due errori non pesano uguale.
 */
const MISSAGGI = [
  /stereo\s*mix/i,
  /missaggio\s*stereo/i,
  /what\s*u\s*hear/i,
  /wave\s*out\s*mix/i,
  /\bloopback\b/i,
  /voicemeeter/i,
  /vb-?audio/i,
  /virtual\s*(audio\s*)?cable/i,
  /\bcable\s*input\b/i,
  /^mix\b/i,
]

/** Il nome dell'uscita a rischio, se ce n'e' una. Nullo quando e' tutto normale. */
export function missaggioFraLeUscite(dispositivi: MediaDeviceInfo[]): string | null {
  const uscite = dispositivi.filter((d) => d.kind === 'audiooutput')
  // Quella predefinita, che e' l'unica da cui il loopback prende davvero.
  // `default` e' l'id che Chromium usa per "quella di sistema"; senza, si
  // guarda la prima, che e' la stessa cosa nell'ordine in cui le consegna.
  const predefinita =
    uscite.find((d) => d.deviceId === 'default') ?? uscite.find((d) => d.deviceId === 'communications') ?? uscite[0]
  if (!predefinita?.label) return null
  return MISSAGGI.some((n) => n.test(predefinita.label)) ? pulisci(predefinita.label) : null
}

/** Chromium antepone "Predefinito - " al nome vero. Nell'avviso e' rumore. */
function pulisci(etichetta: string): string {
  return etichetta.replace(/^(predefinito|default|comunicazioni|communications)\s*-\s*/i, '').trim()
}

/**
 * Vero quando le voci degli altri finiscono di sicuro nella condivisione.
 *
 * E' l'altra faccia del missaggio, e capita molto piu' spesso. Il loopback
 * prende cio' che esce dall'uscita **predefinita** di Windows; se PulseTalk
 * suona proprio li' - e ci suona finche' nessuno ha scelto un'uscita a mano -
 * allora nella condivisione ci sono anche le voci di tutti quelli in chiamata.
 * Chi guarda lo schermo si sente rimandare indietro la propria voce, e sente
 * gli altri due volte, la seconda in ritardo.
 *
 * E' come funziona il loopback, e Chromium non ha altro: tutta la superficie
 * audio di `getDisplayMedia` in Electron 43 e' `loopback | loopbackWithMute |
 * WebFrameMain` - i primi due sono tutto il sistema, il terzo e' un frame
 * dentro a PulseTalk. Un'applicazione esterna non c'e'.
 *
 * Windows pero' ce l'ha, e adesso la usiamo: `lib/audioProcesso.ts` prende
 * l'audio del processo condiviso, o quello di tutto il computer tranne il
 * nostro. Quando quella strada c'e' - dentro Electron su Windows, con
 * l'eseguibile al suo posto - questa domanda non si pone piu': le voci non
 * possono finirci dentro. Resta viva per due casi, ed e' per quelli che questo
 * file non e' stato cancellato: «Solo a loro», che ha bisogno di mutare il
 * suono anche qui e quindi passa ancora dal loopback di sistema, e le macchine
 * dove la cattura per processo non parte.
 *
 * E NON C'ENTRANO LE CASSE. E' una cattura digitale del flusso che il sistema
 * manda al dispositivo di uscita, non una registrazione di quello che si sente
 * nella stanza: mettere le cuffie non cambia niente, perche' il flusso e'
 * quello comunque. Vale la pena scriverlo perche' e' il consiglio sbagliato che
 * viene in mente per primo, ed e' quello che si da' pensando all'eco acustica
 * del microfono - un problema diverso, che qui non c'entra.
 *
 * Cio' che conta e' su **quale uscita** PulseTalk suona. Il loopback prende
 * quella predefinita di Windows: se PulseTalk ne usa un'altra, la sua voce non
 * passa di li' e nella condivisione non ci finisce. Un paio di cuffie aiuta
 * solo se e' un dispositivo diverso da quello predefinito, e non perche' sia
 * un paio di cuffie. Con la cattura per processo non conta piu' nemmeno
 * quello: il suono si prende dove nasce, e l'uscita non c'entra.
 *
 * Si risponde solo quando la risposta e' certa. Con un'uscita scelta a mano
 * non si puo' sapere da qui se sia anche quella predefinita di Windows, e un
 * avviso che compare a caso e' un avviso che si impara a chiudere senza
 * leggere.
 */
export function vociNellaCondivisione(altoparlanteScelto: string | null | undefined): boolean {
  const scelto = String(altoparlanteScelto ?? '').trim()
  return scelto === '' || scelto === 'default'
}
