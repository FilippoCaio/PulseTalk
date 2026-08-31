import type { Dizionario } from '@shared/lingue'

/**
 * English.
 *
 * Le chiavi sono le frasi italiane, per esteso e con gli stessi apostrofi
 * tipografici che stanno nel sorgente: una chiave che differisce di un
 * carattere e' una chiave che non esiste, e la frase resta in italiano senza
 * dire perche'. Quando si tocca una frase italiana, `mancanti()` dice quale
 * riga di qui e' rimasta scollegata.
 *
 * Tradotto finora: tutto cio' che si vede **prima di entrare** — la schermata
 * che chiede il server e il modulo di accesso. E' un confine scelto e non un
 * punto in cui ci si e' fermati: sono le uniche schermate che qualcuno vede
 * *prima* di poter cambiare qualcosa, quindi sono quelle in cui l'italiano non
 * si puo' scavalcare. Dentro all'applicazione si continua in italiano finche'
 * non arriva il resto — meta' inglese e meta' italiano si legge come un
 * difetto, ma qui il confine e' netto e si capisce dove passa.
 */
const en: Dizionario = {
  // -- La scelta del server ---------------------------------------------------
  'A quale server ti colleghi?': 'Which server are you connecting to?',
  'PulseTalk non e’ un servizio: e’ un programma che gira su una macchina di qualcuno. L’indirizzo te lo da’ chi l’ha acceso, insieme al codice di invito.':
    'PulseTalk is not a service: it is a program running on someone’s machine. Whoever set it up gives you the address, along with the invite code.',
  'Indirizzo del server': 'Server address',
  'Per esempio talk.casa.it, oppure http://192.168.1.10:8080 in rete locale.':
    'For example talk.home.net, or http://192.168.1.10:8080 on a local network.',
  'Guardo se c’e’…': 'Checking…',
  Continua: 'Continue',
  'Gia’ collegati': 'Already connected',
  'Non ce l’hai? Non c’e’ un elenco pubblico da cui sceglierne uno: chiedi l’indirizzo a chi ti ha invitato.':
    'Don’t have one? There is no public directory to pick from: ask whoever invited you for the address.',

  // -- La lingua --------------------------------------------------------------
  Lingua: 'Language',
  'non ancora tradotta': 'not translated yet',

  // -- L'accesso --------------------------------------------------------------
  'Bentornato.': 'Welcome back.',
  'Un codice di invito, e poi le credenziali sono tue.':
    'An invite code, and the credentials are yours.',
  su: 'on',
  'Nome utente': 'Username',
  Password: 'Password',
  'Ripeti la password': 'Repeat the password',
  'Codice di invito': 'Invite code',
  'Te lo da’ chi amministra il server. Vale una volta sola.':
    'Whoever administers the server gives it to you. It works once.',
  Entra: 'Sign in',
  'Crea l’account': 'Create the account',
  'un momento…': 'one moment…',
  'Ho dimenticato la password': 'I forgot my password',
  'Ho un codice da un altro dispositivo': 'I have a code from another device',
  'Nome visibile': 'Display name',
  'Almeno 10 caratteri.': 'At least 10 characters.',
  'Hai gia’ un account qui?': 'Already have an account here?',
  'Hai un codice di invito?': 'Got an invite code?',
  'Crea un account': 'Create an account',
  'Non e’ questo il server?': 'Not the right server?',
  Cambialo: 'Change it',
  'Servono nome utente e password.': 'Username and password are both required.',
  'Serve il codice di invito.': 'The invite code is required.',
  'Scegli un nome utente.': 'Choose a username.',
  'Le due password non coincidono.': 'The two passwords do not match.',
  'Serve l’indirizzo del server: torna indietro e scegline uno.':
    'The server address is missing: go back and pick one.',
  'Il codice non e’ valido, o e’ gia’ stato usato. I codici valgono una volta sola: fattene dare un altro.':
    'The code is not valid, or it has already been used. Codes work once: ask for another one.',
  'Stai usando la versione web. Funziona, ma l’app installata sa mandare anche l’audio di sistema insieme allo schermo, e tiene il token cifrato invece che nella memoria del browser.':
    'You are using the web version. It works, but the installed app can also send system audio along with your screen, and it keeps the token encrypted instead of in browser storage.'
}

export default en
