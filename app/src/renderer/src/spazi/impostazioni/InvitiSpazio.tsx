import { useEffect, useState } from 'react'
import type { Api } from '../../lib/api'
import type { InvitoSpazio, Ruolo, Spazio } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { Avviso, Bottone, Campo, classiInput, Sezione } from '../../ui'
import { Catena, Cestino, Spunta } from '../../icone'

/**
 * I codici per far entrare qualcuno in questo server.
 *
 * Il codice in chiaro esiste per il tempo di una risposta: il server ne
 * conserva solo l'impronta, e non c'e' nessuna rotta che possa ristamparlo.
 * Per questo, appena creato, sta li' grande in mezzo alla pagina con il
 * pulsante per copiarlo: se si chiude il pannello senza copiarlo, l'unica cosa
 * da fare e' farne un altro e cancellare quello.
 *
 * Chi non amministra vede solo i propri inviti: l'elenco di quelli altrui dice
 * chi sta portando dentro chi, e non e' affare di tutti.
 */
export default function InvitiSpazio({
  api,
  spazio,
  ruoli
}: {
  api: Api
  spazio: Spazio
  ruoli: Ruolo[] | null
}): React.JSX.Element {
  const [inviti, setInviti] = useState<InvitoSpazio[] | null>(null)
  const [appena, setAppena] = useState<string | null>(null)
  const [copiato, setCopiato] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const [giorni, setGiorni] = useState(spazio.impostazioni.invitiGiorni)
  const [usi, setUsi] = useState(0)
  const [ruolo, setRuolo] = useState<number | null>(null)

  const amministra = puo(spazio.permessiMiei, 'manageServer')
  const gestisceRuoli = puo(spazio.permessiMiei, 'manageRoles')

  const carica = (): void => {
    void api
      .invitiSpazio(spazio.id)
      .then((r) => setInviti(r.inviti))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(carica, [api, spazio.id])

  const crea = async (): Promise<void> => {
    setErrore(null)
    setCopiato(false)
    try {
      const { codice } = await api.creaInvitoSpazio(spazio.id, {
        giorni: amministra ? giorni : undefined,
        usi: amministra ? usi : undefined,
        ruolo
      })
      setAppena(codice)
      carica()
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  const copia = async (): Promise<void> => {
    if (!appena) return
    await navigator.clipboard.writeText(appena).catch(() => {})
    setCopiato(true)
  }

  return (
    <>
      <Sezione titolo="Nuovo invito" sotto="Un codice da passare a chi vuoi far entrare qui.">
        {errore && <Avviso>{errore}</Avviso>}

        {amministra && (
          <div className="flex flex-wrap gap-2">
            <Campo etichetta="Durata">
              <select
                className={classiInput}
                value={giorni}
                onChange={(e) => setGiorni(Number(e.target.value))}
              >
                {[1, 3, 7, 14, 30].map((g) => (
                  <option key={g} value={g}>
                    {g === 1 ? 'Un giorno' : `${g} giorni`}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etichetta="Quante persone">
              <select
                className={classiInput}
                value={usi}
                onChange={(e) => setUsi(Number(e.target.value))}
              >
                <option value={0}>Senza limite</option>
                {[1, 2, 5, 10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Campo>

            {gestisceRuoli && (
              <Campo
                etichetta="Con un ruolo"
                aiuto="Chi entra con questo codice lo riceve subito."
              >
                <select
                  className={classiInput}
                  value={ruolo ?? ''}
                  onChange={(e) => setRuolo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Nessuno</option>
                  {(ruoli ?? [])
                    .filter((r) => r.tipo === 'custom' || r.tipo === 'master')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nome}
                      </option>
                    ))}
                </select>
              </Campo>
            )}
          </div>
        )}

        {!amministra && (
          <p className="text-xs text-testo-3">
            Durata e numero di usi li decide chi amministra il server:{' '}
            {spazio.impostazioni.invitiGiorni === 1
              ? 'un giorno'
              : `${spazio.impostazioni.invitiGiorni} giorni`}
            , {spazio.impostazioni.invitiUsoSingolo ? 'per una persona sola' : 'senza limite di persone'}.
          </p>
        )}

        <Bottone tono="vivo" onClick={() => void crea()}>
          <Catena className="h-4 w-4" />
          Genera un invito
        </Bottone>

        {appena && (
          <div className="rounded-xl border border-vivo/40 bg-vivo/10 p-3">
            <p className="mb-2 text-xs text-testo-2">
              Copialo adesso: il server ne conserva solo l'impronta, e non c'e' modo di rileggerlo.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={appena}
                onFocus={(e) => e.currentTarget.select()}
                className={`${classiInput} font-mono text-xs`}
              />
              <Bottone tono={copiato ? 'acceso' : 'normale'} onClick={() => void copia()}>
                {copiato ? <Spunta className="h-4 w-4" /> : null}
                {copiato ? 'Copiato' : 'Copia'}
              </Bottone>
            </div>
          </div>
        )}
      </Sezione>

      <Sezione titolo="Inviti aperti" sotto="Quelli ancora validi. Annullarli chiude la porta subito.">
        {inviti === null ? (
          <p className="respiro text-sm text-testo-3">carico…</p>
        ) : inviti.length === 0 ? (
          <p className="text-sm text-testo-3">Nessun invito aperto.</p>
        ) : (
          <div className="space-y-1">
            {inviti.map((invito) => (
              <div
                key={invito.id}
                className="flex items-center gap-3 rounded-lg border border-bordo bg-fondo-2 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {invito.usiMax === 0
                      ? `${invito.usi} usati, senza limite`
                      : `${invito.usi} di ${invito.usiMax} usati`}
                    {invito.nomeRuolo ? ` · da' il ruolo ${invito.nomeRuolo}` : ''}
                  </span>
                  <span className="block text-xs text-testo-3">
                    {invito.nomeCreatore ? `da ${invito.nomeCreatore} · ` : ''}
                    scade il {new Date(invito.scade * 1000).toLocaleDateString('it-IT')}
                  </span>
                </span>
                <button
                  title="Annulla questo invito"
                  aria-label="Annulla questo invito"
                  className="shrink-0 text-testo-3 hover:text-male"
                  onClick={() =>
                    void api
                      .eliminaInvitoSpazio(spazio.id, invito.id)
                      .then(carica)
                      .catch((e) => setErrore((e as Error).message))
                  }
                >
                  <Cestino className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Sezione>
    </>
  )
}
