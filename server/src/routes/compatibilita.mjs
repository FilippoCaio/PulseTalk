import { confrontaVersioni, versioneValida } from '../versione.mjs';

const RISPOSTA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'versioneClient',
    'versioneMinima',
    'versioneTarget',
    'versioneMassima',
    'compatibile',
    'obbligatorio',
    'azione',
    'feedUrl',
    'motivo',
  ],
  properties: {
    versioneClient: { type: 'string' },
    versioneMinima: { type: 'string' },
    versioneTarget: { type: 'string' },
    versioneMassima: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    compatibile: { type: 'boolean' },
    obbligatorio: { type: 'boolean' },
    azione: { enum: ['nessuna', 'aggiorna', 'clientTroppoNuovo'] },
    feedUrl: { type: 'string' },
    motivo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

/**
 * Il contratto pubblico fra una app e il server a cui sta per collegarsi.
 *
 * E' pubblico apposta: deve essere consultabile prima del login, prima di
 * usare un token ricordato e perfino prima di creare un account con un invito.
 * Non rivela niente dell'installazione oltre alle versioni che il client deve
 * conoscere per riuscire a parlarle.
 */
export function rotteCompatibilita(app, { config }) {
  app.get(
    '/api/client/compatibilita',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          required: ['versione', 'piattaforma', 'architettura'],
          properties: {
            versione: {
              type: 'string',
              maxLength: 100,
              pattern:
                '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$',
            },
            piattaforma: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$' },
            architettura: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-zA-Z0-9_-]+$' },
          },
        },
        response: { 200: RISPOSTA },
      },
    },
    async (richiesta, risposta) => {
      risposta.header('cache-control', 'no-store');

      const versioneClient = richiesta.query.versione;
      // Lo schema elimina input arbitrari; questo secondo controllo applica
      // anche le regole SemVer che JSON Schema non esprime bene (per esempio
      // uno zero iniziale in un identificatore numerico di prerelease).
      if (!versioneValida(versioneClient)) {
        return risposta.code(400).send({ errore: 'versione client non valida' });
      }
      const { minima, target, massima, feedUrl } = config.client;
      const troppoVecchio = confrontaVersioni(versioneClient, minima) < 0;
      const troppoNuovo = massima !== null && confrontaVersioni(versioneClient, massima) > 0;
      const sottoTarget = confrontaVersioni(versioneClient, target) < 0;

      if (troppoNuovo) {
        return {
          versioneClient,
          versioneMinima: minima,
          versioneTarget: target,
          versioneMassima: massima,
          compatibile: false,
          obbligatorio: true,
          azione: 'clientTroppoNuovo',
          feedUrl,
          motivo:
            `Questa app e' la ${versioneClient}, ma il server accetta al massimo la ${massima}. ` +
            'Va aggiornato il server prima di usare questo client.',
        };
      }

      if (troppoVecchio || sottoTarget) {
        return {
          versioneClient,
          versioneMinima: minima,
          versioneTarget: target,
          versioneMassima: massima,
          compatibile: !troppoVecchio,
          obbligatorio: true,
          azione: 'aggiorna',
          feedUrl,
          motivo: `Il server richiede PulseTalk ${target} prima di continuare.`,
        };
      }

      return {
        versioneClient,
        versioneMinima: minima,
        versioneTarget: target,
        versioneMassima: massima,
        compatibile: true,
        obbligatorio: false,
        azione: 'nessuna',
        feedUrl,
        motivo: null,
      };
    },
  );
}
