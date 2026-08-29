/**
 * I valori con cui l'app parte quando non sa ancora niente.
 *
 * Il server e' **vuoto, e resta vuoto**. PulseTalk non e' un servizio a cui ci
 * si iscrive: e' un programma che gira sulla macchina di qualcuno, e non esiste
 * un indirizzo giusto da scrivere qui. Vuoto, la prima schermata chiede dove
 * andare — e solo dopo si entra o ci si fa un account **su quel server**.
 *
 * L'ordine non e' una cortesia: un account esiste dentro a un server e non
 * prima. Lo stesso nome su due macchine diverse sono due persone diverse, e il
 * codice di invito che si incolla vale per una sola delle due. Chiedere prima
 * le credenziali e poi dove usarle era chiedere le cose al contrario.
 *
 * **Se distribuisci l'app ai tuoi** e vuoi comunque l'indirizzo gia' scritto,
 * lo si chiede per nome al momento della compilazione:
 *
 *     PULSETALK_SERVER=https://talk.esempio.it npm run build
 *
 * Da quel momento chi la riceve deve incollare solo il codice di invito. Resta
 * comunque un campo modificabile, sotto "Cambia server".
 *
 * Nel browser non c'entra niente di tutto questo: li' il server e' l'origine da
 * cui la pagina e' arrivata, e chiederlo vorrebbe dire far scrivere a qualcuno
 * l'indirizzo che ha appena aperto.
 */
declare const __SERVER_PREDEFINITO__: string | undefined

// Sostituito da vite al momento della compilazione. Quando non c'e' niente da
// sostituire — i test, il controllo dei tipi — resta la stringa vuota, che e'
// il comportamento giusto per chi compila dal repo pubblico.
export const SERVER_PREDEFINITO =
  typeof __SERVER_PREDEFINITO__ === 'string' ? __SERVER_PREDEFINITO__ : ''
