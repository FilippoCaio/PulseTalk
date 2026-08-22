import { useEffect, useRef, useState } from 'react'
import type { Canale, Messaggio as Dati, Utente } from '@shared/tipi'
import type { Api } from '../lib/api'
import type { usaChat } from '../lib/usaChat'
import { Avviso } from '../ui'
import { Giu } from '../icone'
import Compositore from './Compositore'
import Messaggio from './Messaggio'

/**
 * Un canale di testo.
 *
 * Lo scorrimento e' la parte con piu' trucchi dentro, e sono tutti per la
 * stessa ragione: chi legge non deve mai perdere il punto in cui era. Quindi
 * si scende in fondo solo se ci si era gia', e risalendo per caricare lo
 * storico si conserva la posizione — altrimenti il contenuto nuovo in cima
 * spingerebbe giu' quello che si stava leggendo.
 */
export default function Chat({
  api,
  canale,
  chat,
  io,
  profili,
  intestazione,
  nomeVisibile,
  mostraAnteprimeLink = true
}: {
  api: Api
  canale: Canale
  chat: ReturnType<typeof usaChat>
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  /**
   * Cosa mettere al posto dell'intestazione con il cancelletto.
   *
   * Serve ai messaggi diretti, che sotto sono lo stesso canale ma sopra non
   * sono un canale: hanno una faccia, un nome, e il pulsante per telefonare.
   * Un secondo componente di chat, uguale tranne che nella prima riga,
   * sarebbe stato quattrocento righe da tenere allineate per sempre.
   */
  intestazione?: React.ReactNode
  /** Come si chiama questo posto nelle frasi. Di serie: #nome-del-canale. */
  nomeVisibile?: string
  mostraAnteprimeLink?: boolean
}): React.JSX.Element {
  const scorrevole = useRef<HTMLDivElement>(null)
  const [rispondiA, setRispondiA] = useState<Dati | null>(null)
  const [inFondo, setInFondo] = useState(true)

  // Se si era in fondo, ci si resta: un messaggio nuovo scende da solo. Se si
  // stava leggendo piu' su, non ci si muove — e comparira' il pulsante.
  useEffect(() => {
    if (!inFondo) return
    const elemento = scorrevole.current
    if (elemento) elemento.scrollTop = elemento.scrollHeight
  }, [chat.messaggi, inFondo])

  // Cambiando canale si riparte sempre dal fondo, che e' dove sta la
  // conversazione di adesso.
  useEffect(() => {
    setInFondo(true)
    setRispondiA(null)
    const elemento = scorrevole.current
    if (elemento) elemento.scrollTop = elemento.scrollHeight
  }, [canale.id])

  const alloScorrimento = (): void => {
    const elemento = scorrevole.current
    if (!elemento) return

    const distanzaDalFondo = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight
    setInFondo(distanzaDalFondo < 80)

    // Arrivati in cima si carica la pagina precedente, conservando la
    // posizione: senza, i messaggi appena inseriti sopra farebbero saltare la
    // vista di qualche schermata.
    if (elemento.scrollTop < 120 && chat.altri && !chat.caricando) {
      const altezzaPrima = elemento.scrollHeight
      chat.risaliDiUnaPagina()
      requestAnimationFrame(() => {
        const dopo = scorrevole.current
        if (dopo) dopo.scrollTop = dopo.scrollHeight - altezzaPrima
      })
    }
  }

  const perId = new Map(chat.messaggi.map((m) => [m.id, m]))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {intestazione ?? (
        <header className="flex items-baseline gap-3 border-b border-bordo px-5 py-3">
          <h1 className="font-medium">
            <span className="text-testo-3">#</span> {canale.nome}
          </h1>
          {canale.argomento && (
            <p className="min-w-0 truncate text-sm text-testo-3">{canale.argomento}</p>
          )}
        </header>
      )}

      <div
        ref={scorrevole}
        onScroll={alloScorrimento}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {chat.caricando && chat.messaggi.length === 0 && (
          <p className="respiro py-8 text-center text-sm text-testo-3">carico…</p>
        )}

        {chat.altri && chat.messaggi.length > 0 && (
          <p className="py-2 text-center text-xs text-testo-3">
            {chat.caricando ? 'carico quelli prima…' : 'risali per leggere quelli prima'}
          </p>
        )}

        {!chat.altri && chat.messaggi.length > 0 && (
          <p className="py-4 text-center text-xs text-testo-3">
            L'inizio di <span className="text-testo-2">{nomeVisibile ?? `#${canale.nome}`}</span>.
          </p>
        )}

        {!chat.caricando && chat.messaggi.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-testo-2">Ancora niente qui dentro.</p>
            <p className="text-sm text-testo-3">Scrivi qualcosa: resta, e lo leggeranno anche dopo.</p>
          </div>
        )}

        {chat.errore && <Avviso>{chat.errore}</Avviso>}

        {chat.messaggi.map((messaggio, indice) => {
          const prima = chat.messaggi[indice - 1]
          // Messaggi di fila della stessa persona, entro cinque minuti: si
          // raggruppano sotto un'intestazione sola. E' cio' che fa sembrare
          // una chat una conversazione invece di un registro.
          const raggruppato =
            !!prima &&
            prima.autore === messaggio.autore &&
            !prima.eliminato &&
            !messaggio.eliminato &&
            messaggio.istante - prima.istante < 5 * 60_000 &&
            !messaggio.rispondeA

          return (
            <Messaggio
              key={messaggio.id}
              api={api}
              dati={messaggio}
              citato={messaggio.rispondeA ? (perId.get(messaggio.rispondeA) ?? null) : null}
              profili={profili}
              io={io}
              raggruppato={raggruppato}
              ricevute={chat.ricevute}
              rispondi={() => setRispondiA(messaggio)}
              modifica={chat.modifica}
              elimina={chat.elimina}
              reagisci={chat.reagisci}
              mostraAnteprimeLink={mostraAnteprimeLink}
            />
          )
        })}
      </div>

      {!inFondo && (
        <button
          onClick={() => {
            setInFondo(true)
            const elemento = scorrevole.current
            if (elemento) elemento.scrollTop = elemento.scrollHeight
          }}
          title="Scendi in fondo"
          aria-label="Scendi in fondo"
          className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-fondo-3 text-testo-2 hover:text-testo"
        >
          <Giu className="h-4 w-4" />
        </button>
      )}

      <Compositore
        api={api}
        canale={canale}
        rispondiA={rispondiA}
        profili={profili}
        annullaRisposta={() => setRispondiA(null)}
        manda={async (dati) => {
          await chat.manda({ ...dati, rispondeA: rispondiA?.id ?? null })
          setRispondiA(null)
          setInFondo(true)
        }}
      />
    </div>
  )
}
