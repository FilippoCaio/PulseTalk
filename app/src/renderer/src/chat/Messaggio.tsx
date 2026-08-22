import { useEffect, useState } from 'react'
import type { Allegato, Messaggio as Dati, Ricevute, Utente } from '@shared/tipi'
import type { AnteprimaLink, Api } from '../lib/api'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { ponte } from '../ponte'
import { Cestino, Emoji, Matita, Rispondi, Spunta, SpuntaDoppia } from '../icone'

/** Le emoji che si offrono al volo. Le altre si scrivono. */
const RAPIDE = ['👍', '❤️', '😂', '🎉', '👀', '🔥']

export default function Messaggio({
  api,
  dati,
  citato,
  profili,
  io,
  raggruppato,
  ricevute,
  rispondi,
  modifica,
  elimina,
  reagisci,
  mostraAnteprimeLink = true
}: {
  api: Api
  dati: Dati
  /** Il messaggio a cui questo risponde, se e' ancora nella pagina caricata. */
  citato: Dati | null
  profili: Map<number, { nome: string; avatar: string | null }>
  io: Utente
  raggruppato: boolean
  /** Le due spunte, solo nelle conversazioni dirette e solo sui propri messaggi. */
  ricevute: Ricevute | null
  rispondi: () => void
  modifica: (id: number, testo: string) => Promise<void>
  elimina: (id: number) => Promise<void>
  reagisci: (id: number, emoji: string) => Promise<void>
  mostraAnteprimeLink?: boolean
}): React.JSX.Element {
  const [inModifica, setInModifica] = useState(false)
  const [bozza, setBozza] = useState(dati.testo)
  const [mostraEmoji, setMostraEmoji] = useState(false)
  const [linkSorvolato, setLinkSorvolato] = useState(false)
  const [anteprima, setAnteprima] = useState<AnteprimaLink | null>(null)
  const [immagineAnteprima, setImmagineAnteprima] = useState<string | null>(null)
  const [faviconAnteprima, setFaviconAnteprima] = useState<string | null>(null)

  const autore = profili.get(dati.autore) ?? (dati.autoreNome ? { nome: dati.autoreNome, avatar: dati.autoreAvatar } : undefined)
  const mio = dati.autore === io.id
  // Il bot non fa login: la sua risposta la toglie chi se l'e' fatta scrivere,
  // altrimenti resta nel canale per sempre.
  const possoTogliere = mio || dati.richiestoDa === io.id
  const nome = autore?.nome ?? 'qualcuno'
  const primoLink = dati.testo.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[),.;!?]+$/, '') ?? null
  /**
   * Un indirizzo che punta a una GIF, e da quale servizio arriva.
   *
   * Mandare una GIF vuol dire mandare il suo indirizzo, come fa Discord: e' il
   * messaggio a riconoscerlo e a disegnarla al posto del link. Qui prima
   * c'era scritto solo Tenor, quindi con GIPHY usciva la scheda grigia del
   * link, e per vedere la GIF bisognava cliccare e aprire il browser.
   *
   * GIPHY distribuisce da media0 a media4 e il numero cambia a ogni risultato:
   * quel numero facoltativo nel motivo serve a questo.
   *
   * Ed e' un motivo *letterale*, non costruito da una stringa. Scritto come
   * stringa era gia' andato storto una volta: dentro agli apici `\d` diventa
   * `d` e `\.` diventa `.`, quindi la regex compilata cercava `mediad*` — che
   * con `media1` non combacia, e le GIF di GIPHY continuavano a uscire come
   * link. Un letterale non ha quel passaggio in mezzo.
   */
  const gifDove = primoLink
    ? primoLink.match(/^https:\/\/(media\.tenor\.com|media\d*\.giphy\.com)\//i)
    : null
  const gifUrl = gifDove ? primoLink : null
  const gifDa = gifDove ? (/tenor/i.test(gifDove[1]) ? 'Tenor' : 'GIPHY') : null

  /**
   * Il messaggio e' soltanto una GIF: si disegna quella e basta.
   *
   * Mandare una GIF vuol dire mandare il suo indirizzo, quindi il testo del
   * messaggio *e'* il link. Mostrarlo sopra all'immagine significa far vedere
   * ottanta caratteri di indirizzo che non dicono niente a nessuno — e sotto la
   * stessa cosa, disegnata. Se invece qualcuno ha scritto qualcosa attorno al
   * link, quel qualcosa resta: e' un messaggio con dentro una GIF, non una GIF.
   */
  const soloGif = Boolean(gifUrl && dati.testo.trim() === gifUrl)

  const immagineWeb = primoLink && /^https:\/\/images\.unsplash\.com\//i.test(primoLink) ? primoLink : null

  useEffect(() => {
    if (!primoLink || gifUrl || immagineWeb || (!mostraAnteprimeLink && !linkSorvolato) || anteprima) return
    let vivo = true
    const timer = window.setTimeout(() => {
      void api
        .anteprimaLink(primoLink)
        .then(({ anteprima: ricevuta }) => vivo && setAnteprima(ricevuta))
        .catch(() => undefined)
    }, mostraAnteprimeLink ? 0 : 250)
    return () => {
      vivo = false
      window.clearTimeout(timer)
    }
  }, [api, anteprima, gifUrl, immagineWeb, linkSorvolato, mostraAnteprimeLink, primoLink])

  useEffect(() => {
    if (!anteprima?.immagineId) return
    let vivo = true
    let locale: string | null = null
    void api.scaricaImmagineAnteprima(anteprima.immagineId).then((url) => {
      locale = url
      if (vivo) setImmagineAnteprima(url)
      else URL.revokeObjectURL(url)
    }).catch(() => undefined)
    return () => {
      vivo = false
      if (locale) URL.revokeObjectURL(locale)
    }
  }, [anteprima?.immagineId, api])

  useEffect(() => {
    if (!anteprima?.faviconId) return
    let vivo = true
    let locale: string | null = null
    void api.scaricaImmagineAnteprima(anteprima.faviconId).then((url) => {
      locale = url
      if (vivo) setFaviconAnteprima(url)
      else URL.revokeObjectURL(url)
    }).catch(() => undefined)
    return () => {
      vivo = false
      if (locale) URL.revokeObjectURL(locale)
    }
  }, [anteprima?.faviconId, api])

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
              {dati.autoreTipo === 'bot' && (
                <span className="rounded bg-vivo/20 px-1 py-0.5 text-[9px] font-bold tracking-wide text-vivo">BOT</span>
              )}
              {dati.origine !== 'umano' && (
                <span className="text-[10px] text-testo-3">contenuto generato dall’AI</span>
              )}
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
            dati.testo &&
            !soloGif && (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-testo">
                <ConLink
                  testo={dati.testo}
                  suLink={(url, sopra) => {
                    if (url.replace(/[),.;!?]+$/, '') === primoLink) setLinkSorvolato(sopra)
                  }}
                />
                {dati.modificato && (
                  <span className="ml-1.5 text-[11px] text-testo-3" title="modificato">
                    (modificato)
                  </span>
                )}
                <Ricevuta dati={dati} mio={mio} ricevute={ricevute} />
              </p>
            )
          )}

          {gifUrl && (
            <figure className="mt-1.5 w-fit max-w-full">
              <img src={gifUrl} alt="GIF condivisa" className="max-h-96 max-w-full rounded-lg border border-bordo" />
              <figcaption className="mt-0.5 text-right text-[10px] text-testo-3">Via {gifDa}</figcaption>
            </figure>
          )}

          {immagineWeb && (
            <figure className="mt-1.5 w-fit max-w-full">
              <img src={immagineWeb} alt="Immagine trovata sul web" className="max-h-96 max-w-full rounded-lg border border-bordo" />
              <figcaption className="mt-0.5 text-right text-[10px] text-testo-3">Immagine trovata sul web · Unsplash</figcaption>
            </figure>
          )}

          {anteprima && (mostraAnteprimeLink || linkSorvolato) && (
            <button
              onClick={() => ponte.apriEsterno(anteprima.url)}
              onMouseEnter={() => setLinkSorvolato(true)}
              onMouseLeave={() => setLinkSorvolato(false)}
              className="mt-1.5 flex max-w-xl overflow-hidden rounded-lg border border-bordo bg-fondo-2 text-left hover:border-fondo-3"
            >
              <span className="min-w-0 flex-1 p-3">
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-testo-3">
                  {faviconAnteprima && <img src={faviconAnteprima} alt="" className="h-4 w-4 rounded-sm" />}
                  {anteprima.dominio}
                </span>
                {anteprima.titolo && <span className="mt-0.5 block text-sm font-medium">{anteprima.titolo}</span>}
                {anteprima.descrizione && <span className="mt-1 line-clamp-2 block text-xs text-testo-3">{anteprima.descrizione}</span>}
              </span>
              {immagineAnteprima && <img src={immagineAnteprima} alt="" className="h-28 w-36 shrink-0 object-cover" />}
            </button>
          )}

          {dati.allegati.map((allegato) => (
            <Attaccato key={allegato.id} api={api} allegato={allegato} />
          ))}

          {/* Un messaggio di soli allegati e' un messaggio valido, e le sue
              spunte vanno dette lo stesso: quelle di sopra stanno in coda al
              testo, e senza testo non ci sarebbe niente a cui accodarsi. */}
          {(!dati.testo || soloGif) && !inModifica && (
            <div className="text-right">
              <Ricevuta dati={dati} mio={mio} ricevute={ricevute} />
            </div>
          )}

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
        {possoTogliere && (
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
function ConLink({
  testo,
  suLink
}: {
  testo: string
  suLink?: (url: string, sopra: boolean) => void
}): React.JSX.Element {
  const pezzi = testo.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {pezzi.map((pezzo, indice) =>
        /^https?:\/\//.test(pezzo) ? (
          <button
            key={indice}
            onClick={() => ponte.apriEsterno(pezzo)}
            onMouseEnter={() => suLink?.(pezzo, true)}
            onMouseLeave={() => suLink?.(pezzo, false)}
            onFocus={() => suLink?.(pezzo, true)}
            onBlur={() => suLink?.(pezzo, false)}
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

/**
 * Le due spunte, come su WhatsApp.
 *
 * Tre stati e tre disegni: una spunta sola vuol dire che il messaggio e' sul
 * server, due spunte grigie che e' arrivato all'apparecchio dell'altra persona,
 * due spunte colorate che l'ha aperto.
 *
 * Solo sui propri messaggi e solo nelle conversazioni dirette. Sui messaggi
 * altrui non direbbero niente — si sa gia' di averli ricevuti, si stanno
 * guardando — e in un canale di spazio "gli e' arrivato" non e' una domanda con
 * una risposta sola.
 *
 * Il confronto e' sugli id e non sulle date: gli id sono unici e crescenti, e
 * "ho letto fino al messaggio 412" e' un fatto, mentre "ho letto fino alle
 * 14:03" dipende da quale dei due orologi lo dice.
 */
function Ricevuta({
  dati,
  mio,
  ricevute
}: {
  dati: Dati
  mio: boolean
  ricevute: Ricevute | null
}): React.JSX.Element | null {
  if (!mio || !ricevute || dati.eliminato) return null

  const letto = dati.id <= ricevute.letto
  const consegnato = dati.id <= ricevute.consegnato

  const nome = letto ? 'Letto' : consegnato ? 'Consegnato' : 'Inviato'
  const Segno = consegnato ? SpuntaDoppia : Spunta

  // Il nome sta sul contenitore e non sull'icona: le icone qui dentro sono
  // tutte `aria-hidden`, e il loro contenuto viene sostituito dai tracciati.
  return (
    <span
      title={nome}
      aria-label={nome}
      role="img"
      className={`ml-1.5 inline-block align-[-2px] ${letto ? 'text-vivo' : 'text-testo-3'}`}
    >
      <Segno className="h-3.5 w-3.5" />
    </span>
  )
}
