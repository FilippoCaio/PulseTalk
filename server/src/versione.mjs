// Versioni dell'app, senza dipendenze.
//
// Node non offre un confronto semver e trascinare un pacchetto intero nel
// server per tre numeri renderebbe piu' fragile proprio il controllo che deve
// proteggere gli aggiornamenti. Questo e' SemVer 2.0: il metadata dopo `+` non
// cambia l'ordine e una prerelease viene prima della versione stabile.

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function analizzaVersione(valore) {
  if (typeof valore !== 'string') return null;
  const esito = SEMVER.exec(valore);
  if (!esito) return null;
  return {
    maggiore: Number(esito[1]),
    minore: Number(esito[2]),
    patch: Number(esito[3]),
    prerelease: esito[4] ? esito[4].split('.') : [],
  };
}

export function versioneValida(valore) {
  return analizzaVersione(valore) !== null;
}

export function confrontaVersioni(a, b) {
  const prima = analizzaVersione(a);
  const seconda = analizzaVersione(b);
  if (!prima || !seconda) throw new Error(`versione non valida: "${!prima ? a : b}"`);

  for (const campo of ['maggiore', 'minore', 'patch']) {
    if (prima[campo] !== seconda[campo]) return prima[campo] < seconda[campo] ? -1 : 1;
  }

  if (prima.prerelease.length === 0 || seconda.prerelease.length === 0) {
    if (prima.prerelease.length === seconda.prerelease.length) return 0;
    return prima.prerelease.length === 0 ? 1 : -1;
  }

  const quanti = Math.max(prima.prerelease.length, seconda.prerelease.length);
  for (let i = 0; i < quanti; i++) {
    const x = prima.prerelease[i];
    const y = seconda.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;

    const xNumero = /^\d+$/.test(x);
    const yNumero = /^\d+$/.test(y);
    if (xNumero && yNumero) return Number(x) < Number(y) ? -1 : 1;
    if (xNumero !== yNumero) return xNumero ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
