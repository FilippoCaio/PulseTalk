import { useEffect, useState } from 'react'
import type { Api } from '../../lib/api'
import type { EventoSpazio, Spazio, Utente } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { coloreDi, inizialiDi } from '../../lib/avatar'
import { Avviso, Bottone, Campo, classiInput, Conferma, Sezione } from '../../ui'
import { Altoparlante, Calendario, Cestino, Matita, Piu } from '../../icone'

/**
 * L'agenda del server.
 *
 * Lo stesso componente serve due posti: la sezione delle impostazioni, per chi
 * gestisce, e la finestrella che si apre dal menu accanto al nome del server,
 * per tutti. Cambia solo cosa si puo' premere, e a deciderlo sono i permessi
 * gia' risolti dal server — non un secondo componente da tenere allineato.
 *
 * Le date si scrivono con i campi nativi del browser e si mandano in secondi
 * epoch: il fuso orario non viaggia, perche' l'unico istante che conta e' lo
 * stesso per tutti e ognuno lo legge nel proprio.
 */
export default function EventiSpazio({
  api,
  spazio,
  io,
  profili,
  apriSubitoIlModulo = false
}: {
  api: Api
  spazio: Spazio
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  /** Aperto dal menu con "Crea evento": il modulo e' gia' li' pronto. */
  apriSubitoIlModulo?: boolean
}): React.JSX.Element {
  const [eventi, setEventi] = useState<EventoSpazio[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [creando, setCreando] = useState(apriSubitoIlModulo)
  const [modifica, setModifica] = useState<EventoSpazio | null>(null)
  const [daEliminare, setDaEliminare] = useState<EventoSpazio | null>(null)

  const puoCreare =
    puo(spazio.permessiMiei, 'createEvents') &&
    (spazio.impostazioni.eventiAperti || puo(spazio.permessiMiei, 'manageEvents'))
  const gestisce = puo(spazio.permessiMiei, 'manageEvents')

  const carica = (): void => {
    void api
      .eventiSpazio(spazio.id)
      .then((r) => setEventi(r.eventi))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(carica, [api, spazio.id])

  const vocali = spazio.canali.filter((c) => c.tipo === 'voce')

  return (
    <>
      {errore && <Avviso>{errore}</Avviso>}

      {puoCreare && !creando && !modifica && (
        <Bottone tono="vivo" onClick={() => setCreando(true)}>
          <Piu className="h-4 w-4" />
          Nuovo evento
        </Bottone>
      )}

      {(creando || modifica) && (
        <Modulo
          spazio={spazio}
          evento={modifica}
          vocali={vocali}
          annulla={() => {
            setCreando(false)
            setModifica(null)
          }}
          salva={async (dati) => {
            setErrore(null)
            try {
              if (modifica) await api.aggiornaEvento(spazio.id, modifica.id, dati)
              else await api.creaEvento(spazio.id, dati)
              setCreando(false)
              setModifica(null)
              carica()
            } catch (e) {
              setErrore((e as Error).message)
            }
          }}
        />
      )}

      <Sezione titolo="In programma" sotto="Chi dice di esserci compare qui sotto.">
        {eventi === null ? (
          <p className="respiro text-sm text-testo-3">carico…</p>
        ) : eventi.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-testo-3">
            <Calendario className="h-4 w-4" />
            Non c'e' ancora niente in programma.
          </p>
        ) : (
          <div className="space-y-2">
            {eventi.map((evento) => (
              <RigaEvento
                key={evento.id}
                api={api}
                spazio={spazio}
                evento={evento}
                io={io}
                profili={profili}
                canale={spazio.canali.find((c) => c.id === evento.canale) ?? null}
                puoToccare={gestisce || (evento.creatoDa === io.id && puoCreare)}
                modifica={() => setModifica(evento)}
                elimina={() => setDaEliminare(evento)}
                quandoCambia={carica}
              />
            ))}
          </div>
        )}
      </Sezione>

      {daEliminare && (
        <Conferma
          titolo={`Elimini "${daEliminare.titolo}"?`}
          testo="Sparisce per tutti, compresi quelli che avevano detto di esserci."
          azione="Elimina"
          tono="male"
          conferma={() => {
            const quale = daEliminare
            setDaEliminare(null)
            void api
              .eliminaEvento(spazio.id, quale.id)
              .then(carica)
              .catch((e) => setErrore((e as Error).message))
          }}
          chiudi={() => setDaEliminare(null)}
        />
      )}
    </>
  )
}

function RigaEvento({
  api,
  spazio,
  evento,
  io,
  profili,
  canale,
  puoToccare,
  modifica,
  elimina,
  quandoCambia
}: {
  api: Api
  spazio: Spazio
  evento: EventoSpazio
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  canale: { id: number; nome: string } | null
  puoToccare: boolean
  modifica: () => void
  elimina: () => void
  quandoCambia: () => void
}): React.JSX.Element {
  const mio = evento.partecipanti.find((p) => p.utente === io.id)
  const quando = new Date(evento.inizio * 1000)
  const passato = evento.inizio * 1000 < Date.now()

  const segna = (stato: 'partecipa' | 'forse' | null): void => {
    void api.partecipo(spazio.id, evento.id, stato).then(quandoCambia)
  }

  return (
    <div
      className={`rounded-xl border p-3 ${
        evento.stato === 'annullato'
          ? 'border-male/30 bg-male/5 opacity-70'
          : passato
            ? 'border-bordo bg-fondo-2 opacity-70'
            : 'border-bordo bg-fondo-2'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Il giorno grande a sinistra: e' la cosa che si cerca scorrendo un
            elenco di eventi, e leggerla dentro a una frase costa un secondo. */}
        <div className="shrink-0 rounded-lg border border-bordo bg-fondo px-2.5 py-1.5 text-center">
          <p className="text-[10px] tracking-wider text-testo-3 uppercase">
            {quando.toLocaleDateString('it-IT', { month: 'short' })}
          </p>
          <p className="numeri text-lg leading-none font-semibold">{quando.getDate()}</p>
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{evento.titolo}</span>
            {evento.stato === 'annullato' && (
              <span className="shrink-0 rounded-full bg-male/20 px-2 py-0.5 text-[10px] text-male">
                annullato
              </span>
            )}
          </p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-testo-3">
            <span>
              {quando.toLocaleDateString('it-IT', { weekday: 'long' })} alle{' '}
              {quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {canale && (
              <span className="flex items-center gap-1">
                <Altoparlante className="h-3 w-3" />
                {canale.nome}
              </span>
            )}
          </p>

          {evento.descrizione && (
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-testo-2">
              {evento.descrizione}
            </p>
          )}

          {evento.partecipanti.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {evento.partecipanti.slice(0, 10).map((p) => {
                const foto = p.avatar ?? profili.get(p.utente)?.avatar ?? null
                return foto ? (
                  <img
                    key={p.utente}
                    src={foto}
                    alt=""
                    title={`${p.nome}${p.stato === 'forse' ? ' (forse)' : ''}`}
                    className={`h-5 w-5 rounded-full object-cover ${p.stato === 'forse' ? 'opacity-50' : ''}`}
                  />
                ) : (
                  <span
                    key={p.utente}
                    title={`${p.nome}${p.stato === 'forse' ? ' (forse)' : ''}`}
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-black/75 ${
                      p.stato === 'forse' ? 'opacity-50' : ''
                    }`}
                    style={{ background: coloreDi(`u${p.utente}`) }}
                  >
                    {inizialiDi(p.nome)}
                  </span>
                )
              })}
              {evento.partecipanti.length > 10 && (
                <span className="numeri text-[10px] text-testo-3">
                  +{evento.partecipanti.length - 10}
                </span>
              )}
            </div>
          )}
        </div>

        {puoToccare && (
          <div className="flex shrink-0 gap-1">
            <button
              onClick={modifica}
              title={`Modifica ${evento.titolo}`}
              aria-label={`Modifica ${evento.titolo}`}
              className="p-1 text-testo-3 hover:text-testo"
            >
              <Matita className="h-4 w-4" />
            </button>
            <button
              onClick={elimina}
              title={`Elimina ${evento.titolo}`}
              aria-label={`Elimina ${evento.titolo}`}
              className="p-1 text-testo-3 hover:text-male"
            >
              <Cestino className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {evento.stato !== 'annullato' && !passato && (
        <div className="mt-2.5 flex gap-1.5 border-t border-bordo pt-2.5">
          <Bottone
            tono={mio?.stato === 'partecipa' ? 'acceso' : 'fantasma'}
            className="py-1 text-xs"
            onClick={() => segna(mio?.stato === 'partecipa' ? null : 'partecipa')}
          >
            Ci sono
          </Bottone>
          <Bottone
            tono={mio?.stato === 'forse' ? 'normale' : 'fantasma'}
            className="py-1 text-xs"
            onClick={() => segna(mio?.stato === 'forse' ? null : 'forse')}
          >
            Forse
          </Bottone>
        </div>
      )}
    </div>
  )
}

/** Da Date a "2026-08-21T21:00", che e' cio' che vuole datetime-local. */
function perCampo(secondi: number): string {
  const d = new Date(secondi * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function Modulo({
  spazio,
  evento,
  vocali,
  salva,
  annulla
}: {
  spazio: Spazio
  evento: EventoSpazio | null
  vocali: { id: number; nome: string }[]
  salva: (dati: {
    titolo: string
    descrizione: string
    inizio: number
    fine: number | null
    canale: number | null
  }) => Promise<void>
  annulla: () => void
}): React.JSX.Element {
  const fraUnOra = Math.floor(Date.now() / 1000) + 3600
  const [titolo, setTitolo] = useState(evento?.titolo ?? '')
  const [descrizione, setDescrizione] = useState(evento?.descrizione ?? '')
  const [inizio, setInizio] = useState(perCampo(evento?.inizio ?? fraUnOra))
  const [fine, setFine] = useState(evento?.fine ? perCampo(evento.fine) : '')
  const [canale, setCanale] = useState<number | null>(evento?.canale ?? null)
  const [salvando, setSalvando] = useState(false)

  return (
    <Sezione
      titolo={evento ? 'Modifica evento' : 'Nuovo evento'}
      sotto={`In ${spazio.nome}. Chi lo vede puo' dire se ci sara'.`}
    >
      <Campo etichetta="Titolo">
        <input
          className={classiInput}
          value={titolo}
          onChange={(e) => setTitolo(e.target.value)}
          placeholder="Serata di giochi"
          maxLength={120}
          autoFocus
        />
      </Campo>

      <Campo etichetta="Descrizione" aiuto="Facoltativa.">
        <textarea
          className={`${classiInput} min-h-20 resize-y`}
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          maxLength={2000}
        />
      </Campo>

      <div className="flex flex-wrap gap-2">
        <Campo etichetta="Quando">
          <input
            type="datetime-local"
            className={classiInput}
            value={inizio}
            onChange={(e) => setInizio(e.target.value)}
          />
        </Campo>
        <Campo etichetta="Fine" aiuto="Facoltativa.">
          <input
            type="datetime-local"
            className={classiInput}
            value={fine}
            onChange={(e) => setFine(e.target.value)}
          />
        </Campo>
      </div>

      <Campo etichetta="Dove" aiuto="Un canale vocale, se l'evento ha un posto dove ritrovarsi.">
        <select
          className={classiInput}
          value={canale ?? ''}
          onChange={(e) => setCanale(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Nessun canale</option>
          {vocali.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </Campo>

      <div className="flex gap-2">
        <Bottone
          tono="vivo"
          disabled={!titolo.trim() || !inizio || salvando}
          onClick={() => {
            setSalvando(true)
            void salva({
              titolo: titolo.trim(),
              descrizione,
              inizio: Math.floor(new Date(inizio).getTime() / 1000),
              fine: fine ? Math.floor(new Date(fine).getTime() / 1000) : null,
              canale
            }).finally(() => setSalvando(false))
          }}
        >
          {salvando ? 'Salvo…' : evento ? 'Salva' : 'Crea'}
        </Bottone>
        <Bottone tono="fantasma" onClick={annulla}>
          Annulla
        </Bottone>
      </div>
    </Sezione>
  )
}
