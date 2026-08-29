import { useEffect, useState } from 'react'
import type { StatoAggiornamento } from '@shared/tipi'
import { Bottone, BottoneIcona } from './ui'
import { Chiudi, Giu } from './icone'

/**
 * «C'e' una versione nuova», detto all'avvio e senza mettersi in mezzo.
 *
 * Prima questa notizia esisteva in un posto solo: dentro alle impostazioni,
 * nella sezione degli aggiornamenti, cioe' esattamente dove non guarda nessuno
 * che ha appena aperto il programma per entrare in una chiamata. Adesso il
 * controllo parte all'avvio e il risultato si vede.
 *
 * Non e' una finestra modale, ed e' una scelta: chi apre PulseTalk lo sta
 * aprendo per parlare con qualcuno, e mettergli davanti una porta da chiudere
 * prima di poterlo fare significa insegnargli a chiudere le porte senza
 * leggerle. E' una striscia in alto, si legge in un colpo d'occhio, e si manda
 * via con la x.
 *
 * Chi la manda via non la rivede per quella versione. Torna quando c'e' una
 * versione ancora piu' nuova, e torna quando il download che si e' chiesto e'
 * finito — perche' a quel punto la notizia non e' piu' "c'e' una novita'", e'
 * "quella che hai chiesto e' pronta", e l'ha chiesta chi legge.
 */
export default function AvvisoAggiornamento({
  stato,
  inVoce,
  scarica,
  installa
}: {
  stato: StatoAggiornamento | null
  /** In una stanza vocale non si installa: il riavvio chiuderebbe la chiamata. */
  inVoce: boolean
  scarica: () => void
  installa: () => void
}): React.JSX.Element | null {
  const [chiusaPer, setChiusaPer] = useState<string | null>(null)

  const fase = stato?.fase
  const versione = stato?.disponibile ?? null

  // Il download finito riapre l'avviso anche a chi lo aveva chiuso: e' il
  // seguito di una cosa che ha chiesto lui, non una novita' che gli capita
  // addosso.
  useEffect(() => {
    if (fase === 'pronto') setChiusaPer(null)
  }, [fase])

  if (!stato || !versione) return null

  // Solo le tre fasi che riguardano chi legge. `controllo`, `aggiornato`,
  // `nonSupportato` e `errore` restano nelle impostazioni: senza rete, dietro
  // a una rete che blocca il feed o su un server senza release, all'avvio non
  // deve comparire niente — quel caso non e' un guasto di nessuno e non e' una
  // notizia per chi sta aprendo il programma.
  if (fase !== 'disponibile' && fase !== 'scarico' && fase !== 'pronto') return null
  if (chiusaPer === versione) return null

  const bloccato = fase === 'pronto' && inVoce

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center p-3">
      <div className="scheda pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-xl border border-bordo bg-fondo-2/95 p-3 shadow-xl shadow-black/40 backdrop-blur">
        <span className="mt-0.5 shrink-0 text-vivo">
          <Giu className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm text-testo">
            {fase === 'pronto'
              ? `PulseTalk ${versione} e' pronta.`
              : fase === 'scarico'
                ? `Scarico PulseTalk ${versione}…`
                : `C'e' PulseTalk ${versione}.`}
            <span className="text-testo-3"> Tu hai la {stato.versione}.</span>
          </p>

          {fase === 'disponibile' && stato.note && (
            <p className="line-clamp-2 text-xs text-testo-3">{primaRiga(stato.note)}</p>
          )}

          {/* Una barra sola, e questa e' quella: la percentuale che arriva da
              `download-progress` finisce qui e non in due posti che si
              contraddicono. Nelle impostazioni si vede la stessa cosa perche'
              legge lo stesso stato. */}
          {fase === 'scarico' && (
            <div className="space-y-1 pt-0.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-fondo-3">
                <div
                  className="h-full rounded-full bg-vivo transition-[width] duration-200"
                  style={{ width: `${stato.percento ?? 0}%` }}
                />
              </div>
              <p className="numeri text-[11px] text-testo-3">{stato.percento ?? 0}%</p>
            </div>
          )}

          {/* Il pulsante disabilitato senza spiegazione e' un pulsante rotto:
              chi lo preme e non succede niente conclude che il programma non
              funziona, non che sta in una chiamata. */}
          {bloccato && (
            <p className="text-xs text-attenzione">
              Si installa riavviando, e il riavvio chiude la chiamata: esci dalla stanza vocale e
              questo pulsante si accende.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {fase === 'disponibile' && (
            <Bottone className="h-8 px-3 text-xs" onClick={scarica}>
              Scarica
            </Bottone>
          )}
          {fase === 'pronto' && (
            <Bottone className="h-8 px-3 text-xs" disabled={bloccato} onClick={installa}>
              Riavvia per usare la nuova versione
            </Bottone>
          )}
          <BottoneIcona
            tono="fantasma"
            title="Chiudi l'avviso"
            className="h-7 w-7"
            onClick={() => setChiusaPer(versione)}
          >
            <Chiudi className="h-3.5 w-3.5" />
          </BottoneIcona>
        </div>
      </div>
    </div>
  )
}

/** Le note di rilascio in una riga: qui non c'e' spazio per di piu'. */
function primaRiga(note: string): string {
  const pulite = note
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return pulite.length > 160 ? `${pulite.slice(0, 157)}…` : pulite
}

/**
 * Il muro: questo server non parla con questa versione.
 *
 * Sta prima dell'accesso perche' e' li' che il server lo dice, e perche' non
 * ha senso far scrivere una password a chi comunque non entrera'. A differenza
 * dell'avviso qui sopra non si chiude: non e' una notizia, e' una condizione.
 *
 * Il download parte da solo, e in questo caso e' giusto — non c'e' nessuna
 * chiamata da disturbare, non c'e' niente altro da fare in questa schermata, e
 * l'alternativa sarebbe un pulsante con una sola cosa che si puo' premere.
 *
 * Tre strade senza uscita, e tutte e tre vanno dette per nome invece di
 * lasciare una rotella che gira:
 *
 *   il portabile          non si aggiorna da solo, e non deve fingere di si'
 *   il client piu' nuovo  del server: e' il server a dover salire, non l'app
 *   il feed senza release chi amministra deve finire di pubblicare
 */
export function BloccoAggiornamento({
  stato,
  motivo,
  target,
  troppoNuovo,
  scarica,
  installa
}: {
  stato: StatoAggiornamento | null
  /** La frase del server, che sa cose che noi non sappiamo. */
  motivo: string | null
  /** La versione che il server pretende. */
  target: string
  /** Il server e' indietro rispetto all'app: aggiornare l'app non serve. */
  troppoNuovo: boolean
  scarica: () => void
  installa: () => void
}): React.JSX.Element {
  const fase = stato?.fase

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-full max-w-md space-y-3">
        <h1 className="text-lg font-medium text-testo">
          {troppoNuovo ? 'Questo server e\' indietro' : `Serve PulseTalk ${target}`}
        </h1>

        <p className="text-sm text-testo-2">
          {motivo ??
            `Questo server non accetta la versione ${stato?.versione ?? 'installata'}.`}
        </p>

        {troppoNuovo ? (
          <p className="text-sm text-testo-3">
            Non c&apos;e&apos; niente da aggiornare da questa parte: e&apos; il server che deve
            salire di versione. Con il pulsante in alto a sinistra si passa a un altro server.
          </p>
        ) : fase === 'nonSupportato' ? (
          <p className="text-sm text-testo-3">
            Questa e&apos; la copia portabile: non si aggiorna da sola. Scarica la {target} e
            sostituisci il file, oppure installa PulseTalk.
          </p>
        ) : fase === 'errore' ? (
          <p className="text-sm text-male">{stato?.errore}</p>
        ) : fase === 'scarico' ? (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-fondo-3">
              <div
                className="h-full rounded-full bg-vivo transition-[width] duration-200"
                style={{ width: `${stato?.percento ?? 0}%` }}
              />
            </div>
            <p className="numeri text-xs text-testo-3">Scarico… {stato?.percento ?? 0}%</p>
          </div>
        ) : fase === 'pronto' ? (
          <Bottone onClick={installa}>Riavvia per usare la nuova versione</Bottone>
        ) : fase === 'disponibile' ? (
          <Bottone onClick={scarica}>Scarica la {stato?.disponibile}</Bottone>
        ) : (
          <p className="respiro text-sm text-testo-3">controllo…</p>
        )}
      </div>
    </div>
  )
}
