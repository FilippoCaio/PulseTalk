import { useEffect, useMemo, useState } from 'react'
import { catturaLaChiamata } from '../lib/catturaChiamata'
import type { Bersaglio, Registratore } from '../lib/usaRegistrazione'
import type { Riquadro } from '../lib/usaSessione'
import { ponte } from '../ponte'
import { SchermoCondividi, Utenti } from '../icone'
import { Pallino } from '../ui'

/**
 * La registrazione, in due pezzi che stanno in due posti diversi.
 *
 * `BarraRegistrazione` e' la barra rossa, e sta in cima alla sala **sempre**,
 * fuori dai comandi che vanno e vengono col cursore. E' la regola che tiene in
 * piedi tutto il resto: se si sta registrando dev'essere impossibile non
 * accorgersene. Un indicatore che si nasconde dopo tre secondi come gli altri
 * comandi sarebbe un indicatore che non c'e'.
 *
 * Il **tasto** invece sta fra i comandi della chiamata, accanto a microfono,
 * camera e condivisione, e con loro compare e sparisce: e' un comando come
 * quelli, si preme una volta e per il resto del tempo non serve piu' a niente.
 * Prima era un pulsantino sospeso in alto al centro, sempre acceso sopra ai
 * riquadri: occupava per tutta la chiamata il posto piu' visibile della
 * finestra per una cosa che si fa una volta ogni tanto.
 *
 * Da qui escono i pezzi che servono a montarlo di la' — l'elenco di cosa si
 * puo' registrare, cosa succede premendo, e il pannello della scelta - invece
 * del pulsante gia' fatto: la forma dei tasti di quella barra e' roba sua, e
 * un pulsante costruito qui sarebbe stato l'unico diverso dagli altri.
 */

/** Una cosa che si puo' registrare: la chiamata intera, o una condivisione. */
export interface CosaRegistrare {
  id: string
  nome: string
  sotto: string
  icona: React.JSX.Element
  /** Prepara l'immagine da registrare. Nulla se nel frattempo e' sparita. */
  prepara: () => Promise<Bersaglio | null>
}

/**
 * Cosa si puo' registrare adesso.
 *
 * La chiamata sta in cima perche' e' l'unica voce che c'e' sempre, ed e' quella
 * che il tasto fa senza aprire niente. Nel browser non c'e': una pagina non
 * puo' guardare se stessa senza chiedere all'utente di scegliersi a mano la
 * scheda giusta nella finestra di Chrome, e li' si registra una condivisione e
 * basta.
 */
export function coseDaRegistrare(riquadri: Riquadro[]): CosaRegistrare[] {
  const elenco: CosaRegistrare[] = []

  if (ponte.elettrone) {
    elenco.push({
      id: 'chiamata',
      nome: 'Tutta la chiamata',
      sotto: "La finestra di PulseTalk com'e' adesso: i riquadri, i nomi, e chi ha la camera accesa.",
      icona: <Utenti className="h-4 w-4" />,
      prepara: async () => {
        const stream = await catturaLaChiamata()
        const video = stream.getVideoTracks()[0]
        if (!video) return null
        return { cosa: 'chiamata', nome: 'la chiamata', video, nostra: true, contenutoDi: null }
      }
    })
  }

  for (const r of riquadri.filter((q) => q.tipo === 'schermo' && q.traccia && !q.bloccato)) {
    elenco.push({
      id: r.id,
      nome: r.etichetta ? `${r.nome} — ${r.etichetta}` : r.nome,
      sotto: "Solo cio' che sta mostrando, con il suo audio: nessun riquadro, nessuna faccia.",
      icona: <SchermoCondividi className="h-4 w-4" />,
      prepara: async () => {
        const video = r.traccia?.mediaStreamTrack
        if (!video) return null
        return {
          cosa: 'schermo',
          nome: `lo schermo di ${r.nome}`,
          video,
          nostra: false,
          contenutoDi: r.identita
        }
      }
    })
  }

  return elenco
}

/**
 * Il comando pronto da appendere alla barra: cosa c'e', e cosa fa premerlo.
 *
 * Un hook e non tre pezzi sparsi perche' i tre stati che si porta dietro -
 * l'attesa della cattura, l'errore, e l'elenco - vivono insieme e si spengono
 * insieme. Chi lo usa deve solo decidere dove disegnarli.
 */
export function usaComandoRegistrazione(
  /** Nullo dove la registrazione non c'e': l'hook gira lo stesso e non fa niente. */
  registratore: Registratore | null,
  riquadri: Riquadro[]
): {
  voci: CosaRegistrare[]
  parti: (voce: CosaRegistrare) => Promise<void>
  inArrivo: boolean
  errore: string | null
} {
  const [inArrivo, setInArrivo] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const voci = useMemo(() => coseDaRegistrare(riquadri), [riquadri])

  // Un errore che resta li' per sempre diventa parte dell'arredamento.
  useEffect(() => {
    if (!errore) return
    const via = window.setTimeout(() => setErrore(null), 8000)
    return () => window.clearTimeout(via)
  }, [errore])

  const parti = async (voce: CosaRegistrare): Promise<void> => {
    if (!registratore) return
    setErrore(null)
    setInArrivo(true)
    try {
      const bersaglio = await voce.prepara()
      if (bersaglio) registratore.avvia(bersaglio)
      else setErrore('Quella sorgente non sta mandando niente da registrare.')
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "La registrazione non e' partita.")
    } finally {
      setInArrivo(false)
    }
  }

  return { voci, parti, inArrivo, errore }
}

/** Il pannello che si apre dalla freccetta: cosa registrare, fra quelle che ci sono. */
export function MenuRegistrazione({
  voci,
  scegli,
  errore
}: {
  voci: CosaRegistrare[]
  scegli: (voce: CosaRegistrare) => void
  errore: string | null
}): React.JSX.Element {
  return (
    <div className="w-[min(20rem,calc(100vw-1rem))] space-y-1 rounded-xl border border-bordo bg-fondo-2 p-1.5 shadow-xl shadow-black/40">
      <span className="mb-1 block px-1.5 pt-1 text-[11px] tracking-wide text-testo-3 uppercase">
        Cosa registrare
      </span>

      {voci.map((v) => (
        <button
          key={v.id}
          onClick={() => scegli(v)}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-fondo-3/60"
        >
          <span className="mt-0.5 shrink-0 text-testo-3">{v.icona}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-testo">{v.nome}</span>
            <span className="block text-[11px] leading-snug text-testo-3">{v.sotto}</span>
          </span>
        </button>
      ))}

      {errore && <p className="px-2 pb-1 text-[11px] text-male">{errore}</p>}
    </div>
  )
}

/**
 * La barra rossa: qualcuno sta registrando, e non si puo' non vederlo.
 *
 * Tre stati diventati due, da quando il tasto se n'e' andato fra i comandi:
 *
 *   registra un altro  la barra con dentro la domanda che conta — la tua voce
 *                      c'e' o non c'e', e come cambiarlo;
 *   registro io        la stessa barra, con il cronometro e lo stop.
 *
 * Il pezzo che vale la pena difendere e' la frase del primo. Dice *chi*
 * registra e con quale nome, dice che il file finisce sul computer di quella
 * persona e non sul server, e dice che togliere il consenso vale da qui in
 * avanti e non all'indietro. Sono tre cose che l'utente non puo' dedurre e che
 * cambiano la risposta che darebbe.
 */
export default function BarraRegistrazione({
  registratore
}: {
  registratore: Registratore
}): React.JSX.Element | null {
  const altri = registratore.mia ? [] : registratore.registrano

  if (!registratore.mia && altri.length === 0) return null

  const laChiamata = registratore.mia
    ? registratore.mia.cosa === 'chiamata'
    : altri.some((a) => a.cosa === 'chiamata')

  const chi = registratore.mia
    ? `Stai registrando ${registratore.mia.nome}`
    : `${altri.map((a) => a.nome).join(', ')} sta registrando ${
        laChiamata ? 'la chiamata' : 'lo schermo'
      }`

  return (
    <div className="pointer-events-auto w-full">
      <div className="rounded-xl border border-male/50 bg-fondo-2/95 px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="respiro flex h-2.5 w-2.5 shrink-0 items-center justify-center">
            <Pallino colore="var(--color-male)" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-male">
            {chi}
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
            l'ultimo, "includi la mia voce" sembrerebbe reversibile.

            Sulla chiamata intera ce n'e' un quarto, e va detto per primo a chi
            non sta registrando: nel file c'e' anche la sua immagine. Il
            consenso di questa barra e' sulle voci — l'unica cosa che si sappia
            mescolare — e lasciar credere che copra anche la faccia sarebbe la
            bugia peggiore che questo riquadro possa dire. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-testo-3">
          {registratore.mia ? (
            <>
              {laChiamata &&
                'Nel file c’e’ la finestra cosi’ com’e’: i riquadri, i nomi e chi ha la camera accesa. '}
              Il file finisce sul tuo computer, non sul server.{' '}
              {registratore.vociDentro === 0
                ? 'Nessuno ha acconsentito: per ora e’ solo immagine e audio di cio’ che mostri.'
                : `${registratore.vociDentro} ${
                    registratore.vociDentro === 1 ? 'voce' : 'voci'
                  } nel file, oltre all’audio di cio’ che mostri.`}
            </>
          ) : (
            <>
              {laChiamata && (
                <>
                  Sta registrando la finestra della chiamata: se hai la camera accesa, la tua
                  immagine e&rsquo; nel file. La domanda qui sopra riguarda la voce.{' '}
                </>
              )}
              {registratore.consensoMio === null ? (
                <>
                  Ti sta chiedendo se la tua voce puo&rsquo; entrare nel file. Finche&rsquo; non
                  rispondi non ci entra. Il file resta sul computer di chi registra, non sul
                  server.
                </>
              ) : registratore.consensoMio ? (
                <>
                  La tua voce sta entrando nel file, che resta sul computer di chi registra.
                  Togliendo il consenso smetti di essere registrato da quel momento &mdash;
                  cio&rsquo; che e&rsquo; gia&rsquo; stato scritto ci resta.
                </>
              ) : (
                <>
                  La tua voce <span className="text-testo-2">non</span> e&rsquo; nel file. Il
                  microfono di chi ha acconsentito pero&rsquo; puo&rsquo; sentirti lo stesso, se
                  siete nella stessa stanza.
                </>
              )}
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
