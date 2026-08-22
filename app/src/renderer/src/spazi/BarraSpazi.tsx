import { useState } from 'react'
import type { Spazio, Utente } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import OverlaySpazio from './OverlaySpazio'
import { Bottone, Campo, classiInput } from '../ui'
import { Fumetto, Piu, Utenti } from '../icone'

/**
 * La colonna delle icone, a sinistra di tutto.
 *
 * Stretta apposta: e' un indice, non un elenco. Il nome per esteso compare
 * passandoci sopra, perche' con quattro spazi le iniziali bastano e con venti
 * un elenco di nomi occuperebbe un quarto dello schermo per sempre.
 *
 * Il pallino a sinistra dice quale e' aperto e dove ci sono cose da leggere:
 * sono le due sole informazioni che servono guardando da lontano.
 */
export default function BarraSpazi({
  spazi,
  aperto,
  utente,
  scegli,
  crea,
  apriAmici,
  richieste,
  apriProfilo,
  apriDiretti,
  direttiAperti = false,
  direttiNonLetti = 0,
  inVoce = null,
  profili
}: {
  spazi: Spazio[]
  aperto: number | null
  utente: Utente
  scegli: (id: number) => void
  crea: (nome: string) => Promise<void>
  apriAmici: () => void
  /** Quante richieste di amicizia aspettano una risposta. */
  richieste: number
  /** Apre il pannello del profilo, quello con gli stati. */
  apriProfilo: () => void
  /** Apre la sezione dei messaggi diretti. */
  apriDiretti: () => void
  direttiAperti?: boolean
  /** Quanti messaggi diretti aspettano una risposta. */
  direttiNonLetti?: number
  /**
   * Il canale vocale in cui si sta parlando adesso.
   *
   * Serve al cartellino: passando sopra all'icona del server in cui c'e' la
   * chiamata, si vedono il canale e chi c'e' dentro senza doverci tornare.
   */
  inVoce?: number | null
  profili?: Map<number, { nome: string; avatar: string | null }>
}): React.JSX.Element {
  const [creando, setCreando] = useState(false)
  const [nome, setNome] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [sopra, setSopra] = useState<number | null>(null)

  const conferma = async (): Promise<void> => {
    if (!nome.trim()) return
    setInCorso(true)
    try {
      await crea(nome.trim())
      setNome('')
      setCreando(false)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-bordo bg-fondo py-3">
      {/* I messaggi diretti stanno in cima, sopra alla riga: non sono un
          server, e metterli in mezzo agli altri li farebbe sembrare tali. */}
      <button
        onClick={apriDiretti}
        title="Messaggi diretti"
        aria-label="Messaggi diretti"
        className="group relative flex h-12 w-12 items-center justify-center"
      >
        <span
          className={`absolute -left-3 w-1 rounded-r-full bg-testo transition-all ${
            direttiAperti ? 'h-8' : direttiNonLetti > 0 ? 'h-2' : 'h-0'
          }`}
        />
        <span
          className={`flex h-12 w-12 items-center justify-center transition-all ${
            direttiAperti
              ? 'rounded-2xl bg-vivo text-fondo'
              : 'rounded-3xl bg-fondo-2 text-testo-2 group-hover:rounded-2xl group-hover:bg-fondo-3 group-hover:text-testo'
          }`}
        >
          <Fumetto className="h-5 w-5" />
        </span>
        {direttiNonLetti > 0 && (
          <span className="numeri absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-male px-1 text-[10px] font-semibold text-white">
            {direttiNonLetti > 9 ? '9+' : direttiNonLetti}
          </span>
        )}
      </button>

      <span className="my-0.5 h-px w-8 shrink-0 bg-bordo" />

      {spazi.map((spazio) => {
        const daLeggere = spazio.canali.reduce((somma, c) => somma + c.nonLetti, 0)
        const attivo = spazio.id === aperto
        // Il vocale di questa barra e' quello in cui si sta parlando adesso, se
        // appartiene a questo spazio. Null quasi sempre: si sta in una stanza
        // sola per volta.
        const vocale = spazio.canali.find((c) => c.id === inVoce && c.tipo === 'voce') ?? null

        return (
          <button
            key={spazio.id}
            onClick={() => scegli(spazio.id)}
            onMouseEnter={() => setSopra(spazio.id)}
            onMouseLeave={() => setSopra((quale) => (quale === spazio.id ? null : quale))}
            onFocus={() => setSopra(spazio.id)}
            onBlur={() => setSopra((quale) => (quale === spazio.id ? null : quale))}
            // Niente `title`: il cartellino dice gia' tutto, e i due insieme
            // farebbero comparire due riquadri sovrapposti dopo un secondo.
            aria-label={spazio.nome}
            className="group relative flex h-12 w-12 items-center justify-center"
          >
            {/* Il segno a sinistra: alto quando e' aperto, un punto quando ha
                da leggere, niente quando non c'e' niente da dire. */}
            <span
              className={`absolute -left-3 w-1 rounded-r-full bg-testo transition-all ${
                attivo ? 'h-8' : daLeggere > 0 ? 'h-2' : 'h-0'
              }`}
            />
            <span
              className={`flex h-12 w-12 items-center justify-center text-lg font-semibold transition-all ${
                attivo ? 'rounded-2xl' : 'rounded-3xl group-hover:rounded-2xl'
              }`}
              style={{
                background: attivo ? 'var(--color-vivo)' : coloreDi(`s${spazio.id}`),
                color: '#0b0e14'
              }}
            >
              {spazio.icona || inizialiDi(spazio.nome)}
            </span>

            {/* L'anello verde intorno all'icona del server in cui si sta
                parlando: si vede da lontano, e da lontano e' l'unica cosa che
                serve sapere. */}
            {vocale && (
              <span className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-ok" />
            )}

            {sopra === spazio.id && (
              <OverlaySpazio spazio={spazio} canaleVocale={vocale} profili={profili} />
            )}
          </button>
        )
      })}

      {utente.ruolo === 'admin' && (
        <button
          onClick={() => setCreando(true)}
          title="Nuovo spazio"
          aria-label="Nuovo spazio"
          className="flex h-12 w-12 items-center justify-center rounded-3xl border border-dashed border-bordo text-testo-3 transition-all hover:rounded-2xl hover:border-vivo hover:text-vivo"
        >
          <Piu />
        </button>
      )}

      <div className="flex-1" />

      {/* Il pallino rosso e' l'unica cosa che porta ad aprire questo pannello:
          una richiesta di amicizia non ha nessun altro posto in cui farsi
          notare. */}
      <button
        onClick={apriAmici}
        title={richieste > 0 ? `Amici — ${richieste} in attesa` : 'Amici'}
        aria-label="Amici"
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-fondo-2 text-testo-2 transition-colors hover:bg-fondo-3 hover:text-testo"
      >
        <Utenti />
        {richieste > 0 && (
          <span className="numeri absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-male px-1 text-[10px] font-semibold text-white">
            {richieste > 9 ? '9+' : richieste}
          </span>
        )}
      </button>

      {/* Apre il pannello, non le impostazioni: nove volte su dieci si preme
          per cambiare stato o per guardarsi il nome, e aprire un pannello a
          tutta pagina per quello e' un salto sproporzionato. */}
      <button
        onClick={apriProfilo}
        title={utente.nome}
        className="relative h-10 w-10 rounded-full ring-2 ring-transparent transition-all hover:ring-vivo"
      >
        {utente.avatar ? (
          <img src={utente.avatar} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center rounded-full text-sm font-semibold text-black/75"
            style={{ background: coloreDi(`u${utente.id}`) }}
          >
            {inizialiDi(utente.nome)}
          </span>
        )}
        <PallinoStato stato={utente.stato ?? 'online'} className="h-3 w-3" fondo="var(--color-fondo)" />
      </button>

      {creando && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setCreando(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl border border-bordo bg-fondo-2 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Nuovo spazio</h2>
            <Campo
              etichetta="Nome"
              aiuto="Nasce con un canale di testo e uno vocale, cosi' si puo' cominciare subito."
            >
              <input
                className={classiInput}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void conferma()}
                placeholder="Musica"
                autoFocus
              />
            </Campo>
            <div className="flex gap-2">
              <Bottone tono="vivo" disabled={inCorso || !nome.trim()} onClick={() => void conferma()}>
                Crea
              </Bottone>
              <Bottone tono="fantasma" onClick={() => setCreando(false)}>
                Annulla
              </Bottone>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
