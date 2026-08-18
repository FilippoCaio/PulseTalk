// password.mjs - custodire una password senza conoscerla.
//
// scrypt, che sta dentro Node e non ha bisogno di nessuna dipendenza. La
// scelta non e' di comodo: una libreria in piu' per una cosa cosi' delicata
// significa una libreria in piu' da tenere aggiornata per sempre, e scrypt e'
// esattamente cio' che serve — lento apposta, e costoso in memoria, che e' la
// parte che rende inutile provare a indovinare con una scheda video.
//
// Il formato in cui si salva contiene i parametri usati. Serve a poterli
// alzare fra dieci anni senza invalidare le password di tutti: chi entra con
// una impronta vecchia viene verificato con i parametri vecchi, e la si
// riscrive con quelli nuovi al primo accesso riuscito.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// N=16384 sono circa cento millisecondi su una macchina normale. Abbastanza da
// rendere impraticabile provare a tentativi, abbastanza poco da non far
// aspettare chi si sta solo collegando.
const PARAMETRI = { N: 16384, r: 8, p: 1, lunghezza: 64 };

export const LUNGHEZZA_MINIMA = 10;

/**
 * Le password troppo corte non si accettano, e il perche' si dice.
 *
 * Nessuna regola su maiuscole e simboli: obbligano a "Password1!" e non
 * aggiungono niente. La lunghezza si', quella conta davvero.
 */
export function problemaConLaPassword(password) {
  if (typeof password !== 'string' || password.length < LUNGHEZZA_MINIMA) {
    return `La password deve essere lunga almeno ${LUNGHEZZA_MINIMA} caratteri.`;
  }
  if (password.length > 200) {
    return 'La password e\' troppo lunga.';
  }
  return null;
}

export async function cifra(password, parametri = PARAMETRI) {
  const sale = randomBytes(16);
  const impronta = await scryptAsync(password, sale, parametri.lunghezza, {
    N: parametri.N,
    r: parametri.r,
    p: parametri.p,
    // Senza questo Node rifiuta N alti con "memory limit exceeded": il limite
    // di serie e' 32 MB, e scrypt con N=16384 e r=8 ne vuole 16 piu' il resto.
    maxmem: 256 * 1024 * 1024,
  });

  return [
    'scrypt',
    parametri.N,
    parametri.r,
    parametri.p,
    sale.toString('hex'),
    impronta.toString('hex'),
  ].join('$');
}

/**
 * Verifica, a tempo costante.
 *
 * Il confronto passa da `timingSafeEqual` e non da `===`: la differenza si
 * misura in nanosecondi, ma su milioni di tentativi quei nanosecondi
 * raccontano quanti byte iniziali erano giusti.
 */
export async function verifica(password, salvata) {
  if (typeof password !== 'string' || typeof salvata !== 'string') return false;

  const pezzi = salvata.split('$');
  if (pezzi.length !== 6 || pezzi[0] !== 'scrypt') return false;

  const [, N, r, p, saleHex, improntaHex] = pezzi;
  const sale = Buffer.from(saleHex, 'hex');
  const attesa = Buffer.from(improntaHex, 'hex');

  let ottenuta;
  try {
    ottenuta = await scryptAsync(password, sale, attesa.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    // Parametri illeggibili o fuori scala: non e' una password sbagliata, e'
    // un record rotto. In entrambi i casi non si entra.
    return false;
  }

  return ottenuta.length === attesa.length && timingSafeEqual(ottenuta, attesa);
}

/** Vero se l'impronta e' stata fatta con parametri piu' deboli di quelli di oggi. */
export function daRicifrare(salvata) {
  const pezzi = String(salvata).split('$');
  if (pezzi.length !== 6 || pezzi[0] !== 'scrypt') return true;
  return Number(pezzi[1]) < PARAMETRI.N;
}

/**
 * Il freno contro chi prova a indovinare.
 *
 * I codici di invito sono 144 bit di entropia e non si indovinano; una
 * password scelta da una persona si'. Dopo qualche tentativo sbagliato ogni
 * risposta viene ritardata, e il ritardo cresce: dopo dieci tentativi sono
 * secondi, che rende inutile qualunque tentativo automatico senza mai
 * bloccare fuori chi si e' solo confuso.
 *
 * In memoria e non nel database di proposito: e' uno stato che deve sparire al
 * riavvio, e scriverlo su disco a ogni tentativo sarebbe il modo piu' semplice
 * per trasformare un attacco di forza bruta in un attacco al disco.
 */
export function creaFreno({ soglia = 3, passoMs = 400, tettoMs = 5000 } = {}) {
  const fallimenti = new Map();

  return {
    async attendi(chiave) {
      const quanti = fallimenti.get(chiave) ?? 0;
      if (quanti < soglia) return;
      const attesa = Math.min((quanti - soglia + 1) * passoMs, tettoMs);
      await new Promise((r) => setTimeout(r, attesa));
    },
    sbagliato(chiave) {
      fallimenti.set(chiave, (fallimenti.get(chiave) ?? 0) + 1);
    },
    riuscito(chiave) {
      fallimenti.delete(chiave);
    },
    get quanti() {
      return fallimenti.size;
    },
  };
}
