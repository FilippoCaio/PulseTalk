import { useMemo } from 'react'
import { Track, type Room } from 'livekit-client'
import { usaRegistrazione } from '../lib/usaRegistrazione'
import type { Riquadro } from '../lib/usaSessione'
import { Pallino } from '../ui'

/**
 * La barra della registrazione, in cima alla sala.
 *
 * Un componente solo per tre stati diversi, e sta in alto e non fra i comandi
 * che vanno e vengono col cursore. E' la regola che tiene in piedi tutto il
 * resto: **se si sta registrando dev'essere impossibile non accorgersene**. Un
 * indicatore che si nasconde dopo tre secondi come gli altri comandi sarebbe
 * un indicatore che non c'e'.
 *
 * I tre stati:
 *
 *   nessuno registra   un pulsante discreto, e solo se c'e' uno schermo da
 *                      registrare e questa macchina sa farlo;
 *   registra un altro  una barra rossa con dentro la domanda che conta —
 *                      la tua voce c'e' o non c'e', e come cambiarlo;
 *   registro io        la stessa barra, con il cronometro e lo stop.
 *
 * Il pezzo che vale la pena difendere e' la frase del secondo stato. Dice
 * *chi* registra e con quale nome, dice che il file finisce sul computer di
 * quella persona e non sul server, e dice che togliere il consenso vale da qui
 * in avanti e non all'indietro. Sono tre cose che l'utente non puo' dedurre e
 * che cambiano la risposta che darebbe.
 */
export default function Registrazione({
  stanza,
  riquadri,
  nomeCanale
}: {
  stanza: Room | null
  /** Servono a trovare uno schermo da registrare, e a sapere se ce n'e' uno. */
  riquadri: Riquadro[]
  nomeCanale: string
}): React.JSX.Element | null {
  const registratore = usaRegistrazione(stanza, nomeCanale)

  /**
   * Lo schermo che si registra: il primo condiviso che stia davvero arrivando.
   *
   * "Il primo" e non "quello scelto" perche' scegliere sarebbe un menu, e un
   * menu davanti a una funzione che nella stragrande maggioranza dei casi ha
   * una risposta sola e' un passo in piu' per tutti per servire quasi nessuno.
   * Con due schermi condivisi si registra quello comparso per primo, e chi ne
   * vuole un altro ferma e riavvia quando quello e' l'unico.
   */
  const schermo = useMemo(
    () => riquadri.find((r) => r.tipo === 'schermo' && r.traccia && !r.bloccato) ?? null,
    [riquadri]
  )

  const altri = registratore.registrano.filter(() => !registratore.mia)
  const qualcunoRegistra = registratore.mia || altri.length > 0

  // Niente da guardare e nessuno che registra: non c'e' niente da dire.
  if (!qualcunoRegistra && (!schermo || !registratore.possibile)) return null

  if (!qualcunoRegistra) {
    return (
      <div className="pointer-events-none flex justify-center">
        <button
          onClick={() => {
            const traccia = schermo?.traccia?.mediaStreamTrack
            if (!traccia) return
            registratore.avvia(traccia, audioDelloSchermo(stanza, schermo!.identita))
          }}
          title="Registra questo schermo con le voci di chi acconsente"
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-bordo bg-fondo-2/90 px-3 py-1.5 text-xs text-testo-2 backdrop-blur transition-colors hover:border-male/50 hover:text-testo"
        >
          <span className="h-2.5 w-2.5 rounded-full border-2 border-male" />
          Registra
        </button>
      </div>
    )
  }

  const chi = registratore.mia ? 'Stai registrando' : `${altri.join(', ')} sta registrando`

  return (
    <div className="pointer-events-auto w-full">
      <div className="rounded-xl border border-male/50 bg-fondo-2/95 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="respiro flex h-2.5 w-2.5 shrink-0 items-center justify-center">
            <Pallino colore="var(--color-male)" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-male">
            {chi} lo schermo
            {registratore.mia && (
              <span className="numeri ml-2 font-normal text-testo-2">
                {durata(registratore.secondi)}
              </span>
            )}
          </span>

          {registratore.mia ? (
            <button
              onClick={registratore.ferma}
              className="shrink-0 rounded-lg border border-male/40 bg-male/10 px-2.5 py-1 text-xs text-male transition-colors hover:bg-male/20"
            >
              Ferma e salva
            </button>
          ) : (
            <span className="flex shrink-0 gap-1.5">
              {registratore.consensoMio === null ? (
                <>
                  <button
                    onClick={() => registratore.rispondi(true)}
                    className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-1 text-xs text-ok transition-colors hover:bg-ok/20"
                  >
                    Acconsento
                  </button>
                  <button
                    onClick={() => registratore.rispondi(false)}
                    className="rounded-lg border border-bordo bg-fondo px-2.5 py-1 text-xs text-testo-2 transition-colors hover:border-fondo-3 hover:text-testo"
                  >
                    Rifiuto
                  </button>
                </>
              ) : (
                <button
                  onClick={() => registratore.rispondi(!registratore.consensoMio)}
                  title={
                    registratore.consensoMio
                      ? 'Togli il consenso: da qui in avanti non sei piu’ nel file'
                      : 'Dai il consenso: da qui in avanti la tua voce entra nel file'
                  }
                  className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    registratore.consensoMio
                      ? 'border-ok/40 bg-ok/10 text-ok hover:bg-ok/20'
                      : 'border-bordo bg-fondo text-testo-2 hover:border-fondo-3 hover:text-testo'
                  }`}
                >
                  {registratore.consensoMio ? 'La mia voce e’ dentro' : 'Sono fuori'}
                </button>
              )}
            </span>
          )}
        </div>

        {/* La riga che dice cio' che non si puo' dedurre.

            Tre fatti, e nessuno dei tre e' ovvio: dove finisce il file, che le
            voci ci sono solo se qualcuno ha detto di si', e che il consenso
            tolto non torna indietro su cio' che e' gia' scritto. Senza
            l'ultimo, "includi la mia voce" sembrerebbe reversibile. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-testo-3">
          {registratore.mia ? (
            <>
              Il file finisce sul tuo computer, non sul server.{' '}
              {registratore.vociDentro === 0
                ? 'Nessuno ha acconsentito: per ora e’ solo immagine e audio di cio’ che mostri.'
                : `${registratore.vociDentro} ${
                    registratore.vociDentro === 1 ? 'voce' : 'voci'
                  } nel file, oltre all’audio di cio’ che mostri.`}
            </>
          ) : registratore.consensoMio === null ? (
            <>
              Ti sta chiedendo se la tua voce puo&rsquo; entrare nel file. Finche&rsquo; non
              rispondi non ci entra. Il file resta sul computer di chi registra, non sul server.
            </>
          ) : registratore.consensoMio ? (
            <>
              La tua voce sta entrando nel file, che resta sul computer di chi registra. Togliendo
              il consenso smetti di essere registrato da quel momento &mdash; cio&rsquo; che e&rsquo;
              gia&rsquo; stato scritto ci resta.
            </>
          ) : (
            <>
              La tua voce <span className="text-testo-2">non</span> e&rsquo; nel file. Il microfono
              di chi ha acconsentito pero&rsquo; puo&rsquo; sentirti lo stesso, se siete nella
              stessa stanza.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function durata(secondi: number): string {
  const m = Math.floor(secondi / 60)
  const s = secondi % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * L'audio che accompagna quello schermo, se chi condivide lo manda.
 *
 * Si cerca sul partecipante che condivide e non fra le tracce a caso: due
 * persone che condividono insieme hanno due audio diversi, e prendere il primo
 * che capita vorrebbe dire registrare il video di uno con il suono dell'altro.
 */
function audioDelloSchermo(stanza: Room | null, identita: string): MediaStreamTrack | null {
  if (!stanza) return null
  const chi =
    stanza.localParticipant.identity === identita
      ? stanza.localParticipant
      : [...stanza.remoteParticipants.values()].find((p) => p.identity === identita)
  return chi?.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.mediaStreamTrack ?? null
}
