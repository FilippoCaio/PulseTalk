import { Avviso, Bottone } from '../ui'

/**
 * La schermata che si vede per prima, sempre.
 *
 * Esiste per un difetto preciso: fino a ieri, chi era gia' entrato vedeva per
 * un istante il modulo dell'accesso: le impostazioni arrivavano, il token
 * c'era, ma la verifica col server non era ancora tornata e l'applicazione
 * disegnava intanto la schermata di chi non ha un token. Un lampo di mezzo
 * secondo che raccontava una bugia — "devi entrare" — a chi era gia' dentro.
 *
 * Adesso la sequenza e' una sola: si parte da qui, si guarda se la sessione
 * regge, e da qui si esce in una direzione sola. Chi non ha una sessione va
 * all'accesso; chi ce l'ha resta qui a guardare la stessa schermata mentre
 * arrivano profilo, spazi e flusso degli eventi, ed entra quando c'e' tutto.
 */
export default function Avvio({
  passo,
  errore,
  riprova,
  vaiAllAccesso
}: {
  /** Cosa si sta aspettando adesso. Una riga, sotto al nome. */
  passo: string
  /** Se il caricamento si e' fermato: cosa e' andato storto. */
  errore?: string | null
  riprova?: () => void
  /** Sbloccarsi entrando con un altro account, quando il resto non va. */
  vaiAllAccesso?: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-fondo p-6">
      <div className="flex flex-col items-center gap-3">
        <Impulso fermo={!!errore} />
        <h1 className="text-lg font-semibold tracking-wide">PulseTalk</h1>
      </div>

      {errore ? (
        <div className="w-full max-w-sm space-y-3">
          <Avviso tono="attenzione">{errore}</Avviso>
          <div className="flex justify-center gap-2">
            {riprova && (
              <Bottone tono="vivo" onClick={riprova}>
                Riprova
              </Bottone>
            )}
            {vaiAllAccesso && (
              <Bottone tono="fantasma" onClick={vaiAllAccesso}>
                Entra con un altro account
              </Bottone>
            )}
          </div>
        </div>
      ) : (
        <p className="respiro text-sm text-testo-3">{passo}</p>
      )}
    </div>
  )
}

/**
 * Il segno che dice che sta succedendo qualcosa.
 *
 * Due cerchi e nessuna immagine: l'icona vera vive nel file .ico e caricarla
 * qui vorrebbe dire un'altra richiesta prima di poter disegnare la prima
 * schermata — cioe' rallentare proprio la cosa che serve a coprire un'attesa.
 */
function Impulso({ fermo }: { fermo: boolean }): React.JSX.Element {
  return (
    <span className="relative flex h-14 w-14 items-center justify-center">
      <span
        className={`absolute inset-0 rounded-full border-2 ${
          fermo ? 'border-male/40' : 'respiro border-vivo/40'
        }`}
      />
      <span
        className="h-6 w-6 rounded-full"
        style={{ background: fermo ? 'var(--color-male)' : 'var(--color-vivo)' }}
      />
    </span>
  )
}
