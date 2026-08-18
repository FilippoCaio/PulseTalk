import { useEffect, useState } from 'react'
import type { Allegato, Messaggio as Dati, Utente } from '@shared/tipi'
import type { Api } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { ponte } from '../ponte'
import { Cestino, Emoji, Matita, Rispondi } from '../icone'

/** Le emoji che si offrono al volo. Le altre si scrivono. */
const RAPIDE = ['👍', '❤️', '😂', '🎉', '👀', '🔥']

export default function Messaggio({
  api,
  dati,
  citato,
  profili,
  io,
  raggruppato,
  amministra,
  rispondi,
  modifica,
  elimina,
  reagisci
}: {
  api: Api
  dati: Dati
  /** Il messaggio a cui questo risponde, se e' ancora nella pagina caricata. */
  citato: Dati | null
  profili: Map<number, { nome: string; avatar: string | null }>
  io: Utente
  raggruppato: boolean
  amministra: boolean
  rispondi: () => void
  modifica: (id: number, testo: string) => Promise<void>
  elimina: (id: number) => Promise<void>
  reagisci: (id: number, emoji: string) => Promise<void>
}): React.JSX.Element {
  const [inModifica, setInModifica] = useState(false)
  const [bozza, setBozza] = useState(dati.testo)
  const [mostraEmoji, setMostraEmoji] = useState(false)

  const autore = profili.get(dati.autore)
  const mio = dati.autore === io.id
  const nome = autore?.nome ?? 'qualcuno'

  const orario = new Date(dati.istante).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit'
  })

  if (dati.eliminato) {
    return (
      <div className="px-2 py-1 text-sm text-testo-3 italic">
        <span className="mr-2 text-xs">{orario}</span>
        messaggio rimosso
      </div>
    )
  }

  return (
    <div className={`group relative rounded-lg px-2 hover:bg-fondo-2/60 ${raggruppato ? 'py-0.5' : 'pt-2 pb-0.5'}`}>
      {/* La citazione, sopra al messaggio: si vede a chi si sta rispondendo
          senza dover risalire. */}
      {dati.rispondeA && (
        <div className="mb-0.5 ml-11 flex items-center gap-1.5 text-xs text-testo-3">
          {/* La freccia della risposta, ribaltata: qui non si risponde, si dice
              da dove si veniva. */}
          <Rispondi className="h-3.5 w-3.5 -scale-y-100" />
          {citato ? (
            <>
              <span className="text-testo-2">{profili.get(citato.autore)?.nome ?? 'qualcuno'}</span>
              <span className="min-w-0 truncate">
                {citato.eliminato ? 'messaggio rimosso' : citato.testo.slice(0, 120)}
              </span>
            </>
          ) : (
            // Puo' succedere: si risponde a qualcosa che sta piu' su di quanto
            // e' stato caricato. Meglio dirlo che far sparire la freccia.
            <span>un messaggio piu' indietro</span>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <div className="w-8 shrink-0">
          {!raggruppato &&
            (autore?.avatar ? (
              <img src={autore.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-black/75"
                style={{ background: coloreDi(`u${dati.autore}`) }}
              >
                {inizialiDi(nome)}
              </span>
            ))}
        </div>

        <div className="min-w-0 flex-1">
          {!raggruppato && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium">{nome}</span>
              <span className="numeri text-[11px] text-testo-3">{orario}</span>
            </div>
          )}

          {inModifica ? (
            <div className="py-1">
              <textarea
                value={bozza}
                onChange={(e) => setBozza(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setInModifica(false)
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (bozza.trim()) {
                      void modifica(dati.id, bozza.trim()).then(() => setInModifica(false))
                    }
                  }
                }}
                rows={2}
                className="w-full resize-none rounded-lg border border-vivo bg-fondo px-3 py-2 text-sm outline-none"
                autoFocus
              />
              <p className="mt-1 text-[11px] text-testo-3">
                Invio per salvare, Esc per lasciar perdere.
              </p>
            </div>
          ) : (
            dati.testo && (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-testo">
                <ConLink testo={dati.testo} />
                {dati.modificato && (
                  <span className="ml-1.5 text-[11px] text-testo-3" title="modificato">
                    (modificato)
                  </span>
                )}
              </p>
            )
          )}

          {dati.allegati.map((allegato) => (
            <Attaccato key={allegato.id} api={api} allegato={allegato} />
          ))}

          {dati.reazioni.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {dati.reazioni.map((reazione) => {
                const ciSono = reazione.utenti.includes(io.id)
                return (
                  <button
                    key={reazione.emoji}
                    onClick={() => void reagisci(dati.id, reazione.emoji)}
                    title={reazione.utenti.map((u) => profili.get(u)?.nome ?? '?').join(', ')}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                      ciSono
                        ? 'border-vivo bg-vivo/15 text-vivo'
                        : 'border-bordo bg-fondo-2 text-testo-2 hover:border-fondo-3'
                    }`}
                  >
                    <span>{reazione.emoji}</span>
                    <span className="numeri">{reazione.utenti.length}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* I comandi, che compaiono passandoci sopra. */}
      <div className="absolute -top-3 right-2 hidden gap-0.5 rounded-lg border border-bordo bg-fondo-2 p-0.5 shadow-lg group-hover:flex">
        <button
          onClick={() => setMostraEmoji(!mostraEmoji)}
          title="Reagisci"
          aria-label="Reagisci"
          className="rounded p-1 hover:bg-fondo-3"
        >
          <Emoji className="h-4 w-4" />
        </button>
        <button
          onClick={rispondi}
          title="Rispondi"
          aria-label="Rispondi"
          className="rounded p-1 hover:bg-fondo-3"
        >
          <Rispondi className="h-4 w-4" />
        </button>
        {mio && (
          <button
            onClick={() => {
              setBozza(dati.testo)
              setInModifica(true)
            }}
            title="Modifica"
            aria-label="Modifica"
            className="rounded p-1 hover:bg-fondo-3"
          >
            <Matita className="h-4 w-4" />
          </button>
        )}
        {(mio || amministra) && (
          <button
            onClick={() => void elimina(dati.id)}
            title="Elimina"
            aria-label="Elimina"
            className="rounded p-1 text-male hover:bg-fondo-3"
          >
            <Cestino className="h-4 w-4" />
          </button>
        )}
      </div>

      {mostraEmoji && (
        <div className="absolute -top-9 right-2 z-10 flex gap-0.5 rounded-lg border border-bordo bg-fondo-2 p-1 shadow-lg">
          {RAPIDE.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                void reagisci(dati.id, emoji)
                setMostraEmoji(false)
              }}
              className="rounded px-1.5 py-0.5 text-base hover:bg-fondo-3"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Un allegato.
 *
 * Le immagini si scaricano e si mostrano; il resto diventa un collegamento. Il
 * download passa da `fetch` e non da `<img src>` perche' serve
 * l'autenticazione, e un tag immagine le intestazioni non le manda.
 */
function Attaccato({ api, allegato }: { api: Api; allegato: Allegato }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [errore, setErrore] = useState(false)
  const immagine = allegato.tipo.startsWith('image/')

  useEffect(() => {
    if (!immagine) return
    let vivo = true
    let creato: string | null = null

    void api
      .scaricaAllegato(allegato.id)
      .then((u) => {
        if (!vivo) return URL.revokeObjectURL(u)
        creato = u
        setUrl(u)
      })
      .catch(() => vivo && setErrore(true))

    return () => {
      vivo = false
      // L'URL locale tiene in memoria il blob finche' non lo si revoca:
      // scorrendo mille messaggi con foto, senza questo si arriva a occupare
      // centinaia di megabyte senza motivo.
      if (creato) URL.revokeObjectURL(creato)
    }
  }, [api, allegato.id, immagine])

  const misura = (byte: number): string =>
    byte >= 1024 * 1024 ? `${(byte / 1024 / 1024).toFixed(1)} MB` : `${Math.round(byte / 1024)} KB`

  if (immagine) {
    if (errore) return <p className="mt-1 text-xs text-testo-3">{allegato.nome} — non disponibile</p>
    return url ? (
      <img
        src={url}
        alt={allegato.nome}
        className="mt-1.5 max-h-96 max-w-full cursor-zoom-in rounded-lg border border-bordo"
        onClick={() => window.open(url, '_blank')}
      />
    ) : (
      <div className="respiro mt-1.5 h-32 w-48 rounded-lg bg-fondo-3" />
    )
  }

  return (
    <button
      onClick={() => {
        void api.scaricaAllegato(allegato.id).then((u) => {
          // Nell'app installata si apre col browser, che sa cosa farne; nel
          // browser si apre in una scheda.
          if (ponte.elettrone) ponte.apriEsterno(u)
          else window.open(u, '_blank')
        })
      }}
      className="mt-1.5 flex items-center gap-2 rounded-lg border border-bordo bg-fondo-2 px-3 py-2 text-left text-sm hover:border-fondo-3"
    >
      <span className="text-testo-3">↓</span>
      <span className="min-w-0">
        <span className="block truncate">{allegato.nome}</span>
        <span className="numeri block text-[11px] text-testo-3">{misura(allegato.dimensione)}</span>
      </span>
    </button>
  )
}

/** I link cliccabili, che aprono il browser invece di sostituire l'app. */
function ConLink({ testo }: { testo: string }): React.JSX.Element {
  const pezzi = testo.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {pezzi.map((pezzo, indice) =>
        /^https?:\/\//.test(pezzo) ? (
          <button
            key={indice}
            onClick={() => ponte.apriEsterno(pezzo)}
            className="text-vivo underline underline-offset-2 hover:text-vivo-2"
          >
            {pezzo}
          </button>
        ) : (
          <span key={indice}>{pezzo}</span>
        )
      )}
    </>
  )
}
