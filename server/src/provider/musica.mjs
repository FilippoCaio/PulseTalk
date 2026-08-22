// provider/musica.mjs - l'interfaccia che un servizio di musica deve avere.
//
// La sessione musicale condivisa non sa niente di Spotify. Sa che c'e' una
// coda, un brano corrente, una posizione e delle persone che ascoltano: quella
// parte sta in dati/media.mjs e in routes/media.mjs, e non cambierebbe di una
// riga se domani arrivasse un altro servizio.
//
// Questo file dice cosa deve saper fare un provider perche' quella sessione
// possa comandare davvero la riproduzione. Chi ne aggiunge uno nuovo scrive un
// oggetto con questi metodi e lo registra: nient'altro.
//
// Perche' un provider e non la riproduzione diretta? Perche' la musica non e'
// come un video di YouTube. Un video si apre in un player embedded e si comanda
// dal browser; un brano di Spotify no — si comanda l'applicazione che quella
// persona ha gia' aperta, attraverso l'API ufficiale, e cosa sia permesso farle
// fare lo decide il servizio, non noi.

/**
 * @typedef {object} ProviderMusica
 * @property {string} nome                          la chiave con cui si registra
 * @property {string} etichetta                     come si chiama davanti alle persone
 * @property {boolean} configurato                  se l'installazione ha le credenziali
 * @property {(utenteId:number)=>string} autorizza  l'URL a cui mandare chi collega
 * @property {(codice:string,stato:string)=>Promise<object>} scambia
 * @property {(utenteId:number)=>Promise<object|null>} accessoValido
 * @property {(utenteId:number)=>Promise<object>} profilo
 * @property {(utenteId:number,q:string)=>Promise<Array>} cerca
 * @property {(utenteId:number,opzioni:object)=>Promise<object>} riproduci
 * @property {(utenteId:number)=>Promise<object>} pausa
 * @property {(utenteId:number,ms:number)=>Promise<object>} vai
 * @property {(utenteId:number)=>Promise<object|null>} adesso
 * @property {(utenteId:number)=>Promise<Array>} dispositivi
 */

/**
 * Il registro dei provider disponibili.
 *
 * Una mappa e tre righe, e non serve altro: i provider si registrano all'avvio
 * e nessuno ne aggiunge a caldo. Esiste per non avere un `if (provider ===
 * 'spotify')` sparso in cinque rotte — quello e' il punto in cui aggiungere il
 * secondo provider diventa una caccia al tesoro.
 */
export function creaRegistroMusica() {
  const per = new Map();

  return {
    registra(provider) {
      per.set(provider.nome, provider);
      return provider;
    },

    ottieni(nome) {
      return per.get(nome) ?? null;
    },

    /** Quelli che questa installazione puo' davvero usare, per l'interfaccia. */
    disponibili() {
      return [...per.values()].map((p) => ({
        nome: p.nome,
        etichetta: p.etichetta,
        configurato: p.configurato,
        limiti: p.limiti ?? null,
      }));
    },
  };
}

/**
 * L'errore che un provider lancia quando il servizio dice di no.
 *
 * Porta con se' il codice HTTP originale perche' quelli che contano sono due e
 * vanno detti in modo diverso a chi guarda: 403 su Spotify vuol dire quasi
 * sempre "questo account non e' Premium", e 404 sul player vuol dire "non hai
 * nessuna applicazione Spotify aperta". Entrambi sono cose che la persona puo'
 * risolvere, se glielo si dice.
 */
export class ErroreProvider extends Error {
  constructor(messaggio, stato = 502, dettaglio = null) {
    super(messaggio);
    this.name = 'ErroreProvider';
    this.stato = stato;
    this.dettaglio = dettaglio;
  }
}
