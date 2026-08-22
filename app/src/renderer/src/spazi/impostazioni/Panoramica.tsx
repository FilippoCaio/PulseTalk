import { useState } from 'react'
import type { Api, Membro } from '../../lib/api'
import type { Spazio, Utente } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { Avviso, Bottone, Campo, classiInput, Conferma, Interruttore, Sezione } from '../../ui'

/**
 * Nome, icona, descrizione, regole e le preferenze del server.
 *
 * Un modulo solo con un unico "Salva" invece di dieci campi che si scrivono da
 * soli: qui dentro si scrive un testo lungo — le regole — e un salvataggio a
 * ogni tasto premuto vorrebbe dire una richiesta ogni lettera, piu' il rischio
 * di pubblicare mezza frase a chi sta leggendo in quel momento.
 */
export default function Panoramica({
  api,
  spazio,
  io,
  membri,
  ricarica,
  eliminaSpazio
}: {
  api: Api
  spazio: Spazio
  io: Utente
  membri: Membro[] | null
  ricarica: () => void
  eliminaSpazio: () => void
}): React.JSX.Element {
  const [nome, setNome] = useState(spazio.nome)
  const [icona, setIcona] = useState(spazio.icona ?? '')
  const [descrizione, setDescrizione] = useState(spazio.descrizione ?? '')
  const [regole, setRegole] = useState(spazio.regole ?? '')
  const [impostazioni, setImpostazioni] = useState(spazio.impostazioni)

  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [fatto, setFatto] = useState(false)
  const [confermaElimina, setConfermaElimina] = useState(false)
  const [passaggio, setPassaggio] = useState<number | null>(null)

  const sonoProprietario = spazio.proprietario === io.id
  const cambiato =
    nome !== spazio.nome ||
    icona !== (spazio.icona ?? '') ||
    descrizione !== (spazio.descrizione ?? '') ||
    regole !== (spazio.regole ?? '') ||
    JSON.stringify(impostazioni) !== JSON.stringify(spazio.impostazioni)

  const salva = async (): Promise<void> => {
    setSalvando(true)
    setErrore(null)
    setFatto(false)
    try {
      await api.aggiornaSpazio(spazio.id, {
        nome: nome.trim() || spazio.nome,
        icona: icona.trim() || null,
        descrizione,
        regole,
        impostazioni
      })
      setFatto(true)
      ricarica()
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Sezione titolo="Identita'" sotto="Come si chiama questo posto, e cosa ci si fa.">
        <div className="flex gap-2">
          {/* Il campo dell'icona e' largo quanto un'emoji: cosi' si capisce da
              solo che li' non ci va una parola. */}
          <label className="shrink-0">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-testo-2 uppercase">
              Icona
            </span>
            <input
              value={icona}
              onChange={(e) => setIcona(e.target.value)}
              placeholder="🏠"
              maxLength={8}
              aria-label="Icona del server"
              className="w-14 rounded-lg border border-bordo bg-fondo px-1 py-2 text-center text-lg"
            />
          </label>

          <div className="min-w-0 flex-1">
            <Campo etichetta="Nome">
              <input
                className={classiInput}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={60}
              />
            </Campo>
          </div>
        </div>

        <Campo
          etichetta="Descrizione"
          aiuto="Una riga o due. Si vede a chi apre un invito, prima di decidere se entrare."
        >
          <textarea
            className={`${classiInput} min-h-16 resize-y`}
            value={descrizione}
            onChange={(e) => setDescrizione(e.target.value)}
            maxLength={1000}
          />
        </Campo>
      </Sezione>

      <Sezione
        titolo="Regole"
        sotto="Cosa si puo' fare qui dentro e cosa no. Le legge chi entra, e restano consultabili."
      >
        <textarea
          className={`${classiInput} min-h-40 resize-y font-[inherit]`}
          value={regole}
          onChange={(e) => setRegole(e.target.value)}
          maxLength={8000}
          placeholder={"1. Non si urla.\n2. I link si mettono nel canale giusto."}
        />
      </Sezione>

      <Sezione titolo="Preferenze" sotto="Interruttori, non permessi: quelli stanno nei ruoli.">
        <Interruttore
          acceso={impostazioni.apertoATutti}
          cambia={(v) => setImpostazioni({ ...impostazioni, apertoATutti: v })}
          titolo="Aperto a chiunque abbia un account"
          sotto="Acceso, chi si registra su questo server entra qui dentro da solo. Spento, si entra
            solo con un invito — e chi c'e' gia' resta dov'e'."
        />

        <Interruttore
          acceso={impostazioni.invitiAperti}
          cambia={(v) => setImpostazioni({ ...impostazioni, invitiAperti: v })}
          titolo="I membri possono invitare"
          sotto="Spento, gli inviti li genera solo chi amministra. Il permesso 'Crea inviti' resta
            necessario in entrambi i casi: questo interruttore lo restringe, non lo sostituisce."
        />

        <Interruttore
          acceso={impostazioni.invitiUsoSingolo}
          cambia={(v) => setImpostazioni({ ...impostazioni, invitiUsoSingolo: v })}
          titolo="Gli inviti dei membri valgono una volta sola"
          sotto="Un codice per una persona. Chi amministra puo' comunque farne a piu' usi."
          disabilitato={!impostazioni.invitiAperti}
        />

        <Campo
          etichetta="Quanto durano gli inviti dei membri"
          aiuto="Chi amministra sceglie la durata ogni volta; per gli altri e' questa."
        >
          <select
            className={classiInput}
            value={impostazioni.invitiGiorni}
            onChange={(e) =>
              setImpostazioni({ ...impostazioni, invitiGiorni: Number(e.target.value) })
            }
          >
            {[1, 3, 7, 14, 30].map((g) => (
              <option key={g} value={g}>
                {g === 1 ? 'Un giorno' : `${g} giorni`}
              </option>
            ))}
          </select>
        </Campo>

        <Interruttore
          acceso={impostazioni.eventiAperti}
          cambia={(v) => setImpostazioni({ ...impostazioni, eventiAperti: v })}
          titolo="Chi ha il permesso puo' creare eventi da solo"
          sotto="Spento, gli eventi li crea solo chi li gestisce."
        />

        <Campo
          etichetta="Notifiche di serie"
          aiuto="Cosa riceve chi entra e non ha ancora scelto niente. Ognuno puo' cambiarla dal menu
            accanto al nome del server."
        >
          <select
            className={classiInput}
            value={impostazioni.notifichePredefinite}
            onChange={(e) =>
              setImpostazioni({
                ...impostazioni,
                notifichePredefinite: e.target.value as typeof impostazioni.notifichePredefinite
              })
            }
          >
            <option value="tutto">Tutti i messaggi</option>
            <option value="menzioni">Solo quando mi nominano</option>
            <option value="niente">Niente</option>
          </select>
        </Campo>
      </Sezione>

      <div className="flex items-center gap-3">
        <Bottone tono="vivo" disabled={!cambiato || salvando} onClick={() => void salva()}>
          {salvando ? 'Salvo…' : 'Salva'}
        </Bottone>
        {fatto && !cambiato && <span className="text-xs text-ok">Salvato.</span>}
        {errore && <span className="text-xs text-male">{errore}</span>}
      </div>

      {sonoProprietario && (
        <Sezione
          titolo="Proprieta'"
          sotto="Il proprietario e' l'unico che nessun permesso puo' fermare. Ce n'e' sempre e solo uno."
        >
          <Campo
            etichetta="Passa la proprieta'"
            aiuto="Chi la riceve diventa Admin e non potra' essere cacciato. Tu resti Admin, ma da quel
              momento potrai essere fermato dai permessi come tutti gli altri."
          >
            <div className="flex gap-2">
              <select
                className={classiInput}
                value={passaggio ?? ''}
                onChange={(e) => setPassaggio(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Scegli una persona…</option>
                {(membri ?? [])
                  .filter((m) => m.id !== io.id && m.amico)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
              </select>
              <Bottone
                tono="normale"
                disabled={!passaggio}
                onClick={() => {
                  if (!passaggio) return
                  void api
                    .aggiornaSpazio(spazio.id, { proprietario: passaggio })
                    .then(() => {
                      setPassaggio(null)
                      ricarica()
                    })
                    .catch((e) => setErrore((e as Error).message))
                }}
              >
                Passa
              </Bottone>
            </div>
            {(membri ?? []).filter((m) => m.id !== io.id && m.amico).length === 0 && (
              <p className="mt-2 text-xs text-testo-3">
                Puoi passare la proprieta' soltanto a un membro che sia anche un tuo amico.
              </p>
            )}
          </Campo>
        </Sezione>
      )}

      {puo(spazio.permessiMiei, 'manageServer') && (
        <Sezione titolo="Zona pericolosa" sotto="Da qui non si torna indietro.">
          <Avviso tono="attenzione">
            Eliminare il server cancella canali, messaggi, allegati, ruoli ed eventi. Non c'e' un
            cestino: cio' che sparisce sparisce.
          </Avviso>
          <Bottone tono="male" onClick={() => setConfermaElimina(true)}>
            Elimina questo server
          </Bottone>
        </Sezione>
      )}

      {confermaElimina && (
        <Conferma
          titolo={`Elimini ${spazio.nome}?`}
          testo={
            <>
              Spariscono tutti i canali, tutti i messaggi e tutti gli allegati. Le persone dentro se
              lo ritroveranno via dalla barra a sinistra, senza preavviso.
            </>
          }
          azione="Elimina"
          tono="male"
          conferma={() => {
            setConfermaElimina(false)
            eliminaSpazio()
          }}
          chiudi={() => setConfermaElimina(false)}
        />
      )}
    </>
  )
}
