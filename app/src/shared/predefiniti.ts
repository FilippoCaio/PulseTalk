/**
 * I valori con cui l'app parte quando non sa ancora niente.
 *
 * Vuoto di proposito: questa e' un'applicazione che si collega al server di
 * chi la installa, e non esiste un indirizzo giusto da mettere qui. Lasciato
 * vuoto, la schermata d'accesso apre da sola il campo dell'indirizzo; una volta
 * scritto, dalla seconda apertura vale quello.
 *
 * **Se distribuisci l'app ai tuoi**, conviene invece scriverci il tuo server
 * prima di compilare:
 *
 *     export const SERVER_PREDEFINITO = 'https://talk.esempio.it'
 *
 * Da quel momento chi la riceve deve incollare **solo il codice di invito**.
 * L'indirizzo del server e' una cosa che sai tu, non lei, e chiederglielo
 * significa doverglielo dettare — e sbagliarlo. Resta comunque un campo
 * modificabile, sotto "Cambia server".
 */
export const SERVER_PREDEFINITO = ''
