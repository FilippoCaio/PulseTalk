import { useEffect, useState } from 'react'
import type { Utente } from '@shared/tipi'
import type { Api, InvitoAperto } from '../lib/api'
import { Avviso, Bottone, Campo, classiInput, Sezione } from '../ui'

/**
 * Far entrare qualcuno, da qui invece che da SSH.
 *
 * Il codice si vede **una volta sola**, esattamente come dalla riga di
 * comando: il server ne conserva l'impronta, non il valore. Non e' una
 * scomodita' da aggirare, e' il motivo per cui una copia rubata del database
 * non apre nessuna porta. Per questo appena creato viene mostrato in grande
 * con un pulsante per copiarlo, e l'elenco qui sotto mostra che *esiste* un
 * invito ma non puo' ripescarlo.
 *
 * Vive dentro alle impostazioni del server e non in una finestra sua. Chi
 * crea un invito sta amministrando l'istanza — decide chi ci entra e con quali
 * poteri — ed e' la stessa materia delle chiavi dei servizi, non un accessorio
 * del proprio account. Sotto "Account" ci era finito perche' li' c'era spazio.
 */
export function ContenutoInviti({
  api,
  /** L'indirizzo pubblico: serve a comporre il link pronto da mandare. */
  server
}: {
  api: Api
  server: string
}): React.JSX.Element {
  const [ruolo, setRuolo] = useState<Utente['ruolo']>('membro')
  const [giorni, setGiorni] = useState(14)
  const [usi, setUsi] = useState(1)

  const [nato, setNato] = useState<{ codice: string; usi: number } | null>(null)
  const [aperti, setAperti] = useState<InvitoAperto[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const [copiato, setCopiato] = useState<string | null>(null)

  const carica = (): void => {
    void api
      .inviti()
      .then(({ inviti }) => setAperti(inviti))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(carica, [api])

  const crea = async (): Promise<void> => {
    setErrore(null)
    setInCorso(true)
    try {
      const esito = await api.creaInvito({ ruolo, giorni, usi })
      setNato({ codice: esito.codice, usi: esito.usi })
      carica()
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  const link = nato ? `${server}/?invito=${encodeURIComponent(nato.codice)}` : ''

  const copia = async (testo: string, cosa: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(testo)
      setCopiato(cosa)
      setTimeout(() => setCopiato(null), 2000)
    } catch {
      setErrore('Il sistema non mi ha lasciato scrivere negli appunti: selezionalo e copialo a mano.')
    }
  }

  const quando = (t: number): string =>
    new Date(t * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })

  return (
    <>
      <Sezione
        titolo="Una chiave d'invito"
        sotto="Chi ce l'ha entra in questo server e si sceglie nome utente e password. Senza, non entra nessuno."
      >
        {nato ? (
          <div className="space-y-4">
            <Avviso tono="neutro">
              Questo codice si vede <strong>adesso e mai piu&apos;</strong>. Il server ne conserva
              solo l&apos;impronta: se lo perdi, se ne fa un altro.
            </Avviso>

            <div className="rounded-lg border border-vivo/40 bg-vivo/5 p-4 text-center">
              <p className="numeri text-lg font-medium break-all select-all">{nato.codice}</p>
              <p className="mt-1 text-xs text-testo-3">
                {nato.usi === 1 ? 'per una persona' : `per ${nato.usi} persone`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Bottone tono="vivo" onClick={() => void copia(nato.codice, 'codice')}>
                {copiato === 'codice' ? 'copiato' : 'Copia il codice'}
              </Bottone>
              <Bottone onClick={() => void copia(link, 'link')}>
                {copiato === 'link' ? 'copiato' : 'Copia il link pronto'}
              </Bottone>
            </div>

            <p className="text-xs leading-relaxed text-testo-3">
              Il link apre PulseTalk nel browser con il codice gia&apos; compilato: chi lo riceve
              deve solo scegliersi nome utente e password. Il codice nudo serve invece a chi ha
              l&apos;app installata.
            </p>

            <Bottone tono="fantasma" onClick={() => setNato(null)}>
              Fanne un altro
            </Bottone>
          </div>
        ) : (
          <div className="space-y-4">
            <Campo etichetta="Cosa potra' fare">
              <select
                className={classiInput}
                value={ruolo}
                onChange={(e) => setRuolo(e.target.value as Utente['ruolo'])}
              >
                <option value="ospite">Ospite — entra e ascolta, non trasmette</option>
                <option value="membro">Membro — voce, camera e schermo</option>
                <option value="admin">Admin — crea stanze, modera, invita</option>
              </select>
            </Campo>

            <div className="grid grid-cols-2 gap-3">
              <Campo etichetta="Per quante persone">
                <input
                  type="number"
                  className={classiInput}
                  min={1}
                  max={50}
                  value={usi}
                  onChange={(e) => setUsi(Math.max(1, Number(e.target.value) || 1))}
                />
              </Campo>
              <Campo etichetta="Valido per (giorni)">
                <input
                  type="number"
                  className={classiInput}
                  min={1}
                  max={30}
                  value={giorni}
                  onChange={(e) => setGiorni(Math.max(1, Number(e.target.value) || 1))}
                />
              </Campo>
            </div>

            {usi > 1 && (
              <Avviso tono="attenzione">
                Un codice per piu&apos; persone entra chiunque ce l&apos;abbia, finche&apos; non si
                esaurisce o scade. Inoltrato in una chat di gruppo, ci entra il gruppo.
              </Avviso>
            )}

            {errore && <Avviso>{errore}</Avviso>}

            <Bottone tono="vivo" disabled={inCorso} onClick={() => void crea()}>
              {inCorso ? 'un momento…' : 'Crea il codice'}
            </Bottone>
          </div>
        )}
      </Sezione>

      {/* -- Quelli ancora aperti ------------------------------------------- */}
      {aperti && aperti.length > 0 && (
        <Sezione
          titolo="Inviti ancora validi"
          sotto="Il codice non compare: il server non ce l'ha. Annullarne uno lo rende inservibile subito, anche per chi lo aveva gia' ricevuto."
        >
          <div className="space-y-1.5">
            {aperti.map((invito) => (
              <div
                key={invito.id}
                className="flex items-center gap-3 rounded-lg border border-bordo bg-fondo px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {invito.ruolo}
                  <span className="numeri text-testo-3">
                    {' · '}
                    {invito.usi}/{invito.usiMax} usati · scade il {quando(invito.scade)}
                  </span>
                </span>
                <button
                  className="shrink-0 text-xs text-male hover:underline"
                  onClick={() => {
                    void api
                      .eliminaInvito(invito.id)
                      .then(carica)
                      .catch((e) => setErrore((e as Error).message))
                  }}
                >
                  annulla
                </button>
              </div>
            ))}
          </div>
        </Sezione>
      )}
    </>
  )
}
