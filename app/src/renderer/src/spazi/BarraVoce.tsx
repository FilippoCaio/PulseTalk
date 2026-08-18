import { ConnectionState } from 'livekit-client'
import { Esci, Microfono, MicrofonoSpento, Riavvolgi, SchermoCondividi, Torna } from '../icone'

/**
 * La barretta che dice "sei ancora in chiamata".
 *
 * Esiste per una ragione sola, e vale tutta la fatica che e' costata staccare
 * la sessione vocale dalla schermata: si puo' essere in un canale vocale e
 * intanto leggere una chat, e senza questa barra non ci sarebbe piu' niente a
 * ricordarlo — se non il fatto che gli altri ti sentono.
 */
export default function BarraVoce({
  nome,
  stato,
  microfonoAcceso,
  condivide,
  guardando,
  riascoltoAttivo,
  secondiRiascolto,
  riascolta,
  alternaMicrofono,
  torna,
  esci
}: {
  nome: string
  stato: ConnectionState
  microfonoAcceso: boolean
  condivide: boolean
  /** Vero se si sta gia' guardando la griglia di questa chiamata. */
  guardando: boolean
  riascoltoAttivo: boolean
  secondiRiascolto: number
  riascolta: () => void
  alternaMicrofono: () => void
  torna: () => void
  esci: () => void
}): React.JSX.Element {
  const collegato = stato === ConnectionState.Connected
  const riprendendo = stato === ConnectionState.Reconnecting

  return (
    <div className="shrink-0 border-t border-bordo bg-fondo px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            riprendendo ? 'respiro bg-attenzione' : collegato ? 'bg-ok' : 'bg-testo-3'
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ok">
            {riprendendo ? 'riprendo la linea…' : 'in chiamata'}
          </p>
          <button
            onClick={torna}
            disabled={guardando}
            className="flex w-full items-center gap-1 text-left text-xs text-testo-2 hover:text-testo disabled:hover:text-testo-2"
            title={guardando ? undefined : 'Torna alla chiamata'}
          >
            {!guardando && <Torna className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{nome}</span>
            {condivide && (
              <span title="Stai condividendo lo schermo" className="shrink-0 text-ok">
                <SchermoCondividi className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </div>

        {/* Qui piu' che nella stanza: e' leggendo una chat che ci si perde una
            frase, e prima non c'era modo di recuperarla senza tornare
            indietro a chiedere. */}
        {riascoltoAttivo && (
          <button
            onClick={riascolta}
            title={`Riascolta gli ultimi ${secondiRiascolto} secondi — Ctrl+Shift+R`}
            aria-label={`Riascolta gli ultimi ${secondiRiascolto} secondi`}
            className="shrink-0 rounded-lg bg-fondo-3 p-1.5 text-testo-2 transition-colors hover:bg-bordo hover:text-testo"
          >
            <Riavvolgi className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={alternaMicrofono}
          title={microfonoAcceso ? 'Zittisciti' : 'Riprendi la parola'}
          aria-label={microfonoAcceso ? 'Zittisciti' : 'Riprendi la parola'}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            microfonoAcceso ? 'bg-ok/15 text-ok hover:bg-ok/25' : 'bg-male/15 text-male hover:bg-male/25'
          }`}
        >
          {microfonoAcceso ? (
            <Microfono className="h-4 w-4" />
          ) : (
            <MicrofonoSpento className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={esci}
          title="Esci dalla chiamata"
          aria-label="Esci dalla chiamata"
          className="shrink-0 rounded-lg bg-male/15 p-1.5 text-male hover:bg-male/25"
        >
          <Esci className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
