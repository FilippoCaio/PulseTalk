import { useState } from 'react'
import type { Impostazioni } from '@shared/tipi'
import { nomeDaIndirizzo, normalizzaIndirizzo } from '@shared/collegamenti'
import { provaServer } from '../lib/api'
import { Avviso, Bottone, Campo, classiInput } from '../ui'
import { Chevron } from '../icone'

/**
 * La prima domanda, e viene prima di tutte le altre: dove.
 *
 * PulseTalk non e' un servizio a cui ci si iscrive: e' un programma che qualcuno
 * ha acceso su una macchina sua. Non esiste un indirizzo giusto da mettere di
 * serie, e finche' ce n'era uno l'applicazione raccontava una cosa falsa —
 * sembrava di essere gia' "da qualche parte", e chi la installava per collegarsi
 * al server di un amico si trovava davanti l'indirizzo di un altro.
 *
 * Quindi: prima si sceglie il server, poi si entra o si crea l'account **su
 * quel server**. E' anche l'ordine giusto per come stanno davvero le cose,
 * perche' un account esiste dentro a un server e non prima: lo stesso nome su
 * due macchine diverse sono due persone diverse, e il codice di invito che si
 * incolla vale per una sola delle due.
 *
 * L'indirizzo non si prende per buono: si va a bussare. Un errore di battitura
 * scoperto qui costa di rifare una riga; scoperto dopo, arriva travestito da
 * "credenziali sbagliate" al momento della password.
 */
export default function SceltaServer({
  impostazioni,
  quandoScelto
}: {
  impostazioni: Impostazioni
  /** L'indirizzo verificato, gia' normalizzato. */
  quandoScelto: (indirizzo: string) => Promise<void> | void
}): React.JSX.Element {
  const [indirizzo, setIndirizzo] = useState('')
  const [inCorso, setInCorso] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  /**
   * I server gia' conosciuti da questa installazione.
   *
   * Ci si arriva togliendo quello attivo, o scollegandosi: in quel caso
   * riscrivere a mano un indirizzo che l'applicazione conosce gia' sarebbe
   * lavoro inutile, e sbagliabile.
   */
  const conosciuti = impostazioni.serverCollegati ?? []

  const vai = async (grezzo: string): Promise<void> => {
    setErrore(null)
    setInCorso(true)
    try {
      const esito = await provaServer(grezzo)
      if (!esito.ok) {
        setErrore(esito.motivo)
        return
      }
      await quandoScelto(esito.indirizzo)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4 sm:p-8">
      <div className="pannello w-full max-w-md py-4 sm:py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">PulseTalk</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-testo-2">
            A quale server ti colleghi?
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-bordo bg-fondo-2 p-5">
          <p className="text-sm leading-relaxed text-testo-2">
            PulseTalk non e&apos; un servizio: e&apos; un programma che gira su una macchina di
            qualcuno. L&apos;indirizzo te lo da&apos; chi l&apos;ha acceso, insieme al codice di
            invito.
          </p>

          <Campo
            etichetta="Indirizzo del server"
            aiuto="Per esempio talk.casa.it, oppure http://192.168.1.10:8080 in rete locale."
          >
            <input
              className={classiInput}
              value={indirizzo}
              onChange={(e) => setIndirizzo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !inCorso) void vai(indirizzo)
              }}
              placeholder="talk.casa.it"
              spellCheck={false}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Campo>

          {errore && <Avviso>{errore}</Avviso>}

          <Bottone
            tono="vivo"
            className="w-full"
            disabled={inCorso || !indirizzo.trim()}
            onClick={() => void vai(indirizzo)}
          >
            {inCorso ? 'Guardo se c’e’…' : 'Continua'}
          </Bottone>
        </div>

        {/* Quelli gia' conosciuti, quando ce ne sono: si torna a casa con un
            tocco invece di riscrivere un indirizzo che l'applicazione sa. */}
        {conosciuti.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-[11px] tracking-wide text-testo-3 uppercase">
              Gia&apos; collegati
            </p>
            <div className="space-y-1.5">
              {conosciuti.map((s) => (
                <button
                  key={s.indirizzo}
                  type="button"
                  disabled={inCorso}
                  onClick={() => void vai(s.indirizzo)}
                  className="flex w-full items-center gap-2 rounded-xl border border-bordo bg-fondo-2 px-3 py-2.5 text-left transition-colors hover:border-vivo disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-testo">
                      {s.nome || nomeDaIndirizzo(s.indirizzo)}
                    </span>
                    <span className="block truncate text-xs text-testo-3">
                      {normalizzaIndirizzo(s.indirizzo)}
                    </span>
                  </span>
                  <Chevron className="h-4 w-4 shrink-0 -rotate-90 text-testo-3" />
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-testo-3">
          Non ce l&apos;hai? Non c&apos;e&apos; un elenco pubblico da cui sceglierne uno: chiedi
          l&apos;indirizzo a chi ti ha invitato.
        </p>
      </div>
    </div>
  )
}
