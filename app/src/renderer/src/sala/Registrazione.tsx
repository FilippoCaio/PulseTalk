import { useEffect, useMemo, useRef, useState } from 'react'
import type { Room } from 'livekit-client'
import { catturaLaChiamata } from '../lib/catturaChiamata'
import { usaRegistrazione, type Bersaglio } from '../lib/usaRegistrazione'
import type { Riquadro } from '../lib/usaSessione'
import { ponte } from '../ponte'
import { Giu, SchermoCondividi, Utenti } from '../icone'
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
 *   nessuno registra   un pulsante discreto, con accanto la freccetta di cosa
 *                      registrare quando c'e' piu' di una risposta;
 *   registra un altro  una barra rossa con dentro la domanda che conta —
 *                      la tua voce c'e' o non c'e', e come cambiarlo;
 *   registro io        la stessa barra, con il cronometro e lo stop.
 *
 * Il pezzo che vale la pena difendere e' la frase del secondo stato. Dice
 * *chi* registra e con quale nome, dice che il file finisce sul computer di
 * quella persona e non sul server, e dice che togliere il consenso vale da qui
 * in avanti e non all'indietro. Sono tre cose che l'utente non puo' dedurre e
 * che cambiano la risposta che darebbe.
 *
 * ## Il pulsante c'e' sempre, la freccetta quando serve
 *
 * Prima il pulsante compariva solo con una condivisione in corso, e registrava
 * quella: senza schermi non c'era niente da registrare. Adesso si puo'
 * registrare anche la chiamata cosi' com'e' — la finestra, con i riquadri e i
 * nomi — e quindi qualcosa da registrare c'e' sempre.
 *
 * Le due cose stanno in un pulsante solo e non in due: quello grande fa la
 * risposta piu' probabile, la freccetta apre le altre. Due pulsanti affiancati
 * avrebbero chiesto a tutti, ogni volta, una scelta che nella maggior parte
 * delle chiamate ha una risposta sola.
 */
export default function Registrazione({
  stanza,
  riquadri,
  nomeCanale
}: {
  stanza: Room | null
  /** Servono a sapere quali condivisioni si possono registrare, e di chi sono. */
  riquadri: Riquadro[]
  nomeCanale: string
}): React.JSX.Element | null {
  const registratore = usaRegistrazione(stanza, nomeCanale)

  const [menu, setMenu] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  /** Fra il clic e i primi fotogrammi: la cattura della finestra e' asincrona. */
  const [inArrivo, setInArrivo] = useState(false)
  const scatola = useRef<HTMLDivElement>(null)

  /** Le condivisioni che stanno davvero arrivando: le altre non hanno pixel. */
  const condivisioni = useMemo(
    () => riquadri.filter((r) => r.tipo === 'schermo' && r.traccia && !r.bloccato),
    [riquadri]
  )

  /**
   * Cosa si puo' registrare, nell'ordine in cui lo si sceglie.
   *
   * La chiamata sta in cima perche' e' l'unica voce che c'e' sempre, ed e'
   * quella che il pulsante grande fa senza aprire niente. Nel browser non c'e':
   * una pagina non puo' guardare se stessa senza chiedere all'utente di
   * scegliersi a mano la scheda giusta nella finestra di Chrome, e li' si
   * registra una condivisione e basta.
   */
  const voci = useMemo(() => {
    const elenco: {
      id: string
      nome: string
      sotto: string
      icona: React.JSX.Element
      prepara: () => Promise<Bersaglio | null>
    }[] = []

    if (ponte.elettrone) {
      elenco.push({
        id: 'chiamata',
        nome: 'Tutta la chiamata',
        sotto: 'La finestra di PulseTalk com\'e\' adesso: i riquadri, i nomi, e chi ha la camera accesa.',
        icona: <Utenti className="h-4 w-4" />,
        prepara: async () => {
          const stream = await catturaLaChiamata()
          const video = stream.getVideoTracks()[0]
          if (!video) return null
          return { cosa: 'chiamata', nome: 'la chiamata', video, nostra: true, contenutoDi: null }
        }
      })
    }

    for (const r of condivisioni) {
      elenco.push({
        id: r.id,
        nome: r.etichetta ? `${r.nome} — ${r.etichetta}` : r.nome,
        sotto: 'Solo cio\' che sta mostrando, con il suo audio: nessun riquadro, nessuna faccia.',
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
  }, [condivisioni])

  // Il menu si chiude cliccando fuori. Il pulsante che lo apre sta dentro alla
  // scatola, quindi il clic che lo apre non e' anche quello che lo richiude.
  useEffect(() => {
    if (!menu) return
    const fuori = (e: MouseEvent): void => {
      if (!scatola.current?.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', fuori)
    return () => window.removeEventListener('mousedown', fuori)
  }, [menu])

  // Un errore che resta li' per sempre diventa parte dell'arredamento.
  useEffect(() => {
    if (!errore) return
    const via = window.setTimeout(() => setErrore(null), 8000)
    return () => window.clearTimeout(via)
  }, [errore])

  const altri = registratore.mia ? [] : registratore.registrano
  const qualcunoRegistra = !!registratore.mia || altri.length > 0

  async function parti(voce: (typeof voci)[number]): Promise<void> {
    setMenu(false)
    setErrore(null)
    setInArrivo(true)
    try {
      const bersaglio = await voce.prepara()
      if (bersaglio) registratore.avvia(bersaglio)
      else setErrore('Quella sorgente non sta mandando niente da registrare.')
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'La registrazione non e\' partita.')
    } finally {
      setInArrivo(false)
    }
  }

  // Niente da registrare e nessuno che registra: non c'e' niente da dire.
  if (!qualcunoRegistra && (voci.length === 0 || !registratore.possibile)) return null

  if (!qualcunoRegistra) {
    const primo = voci[0]
    const conFreccetta = voci.length > 1

    return (
      <div className="pointer-events-none flex flex-col items-center gap-1.5">
        <div ref={scatola} className="pointer-events-auto relative">
          <div className="flex items-center rounded-full border border-bordo bg-fondo-2/90 text-xs text-testo-2 backdrop-blur transition-colors hover:border-male/50">
            <button
              onClick={() => void parti(primo)}
              disabled={inArrivo}
              title={
                primo.id === 'chiamata'
                  ? 'Registra la chiamata con le voci di chi acconsente'
                  : 'Registra questa condivisione con le voci di chi acconsente'
              }
              className={`flex items-center gap-2 py-1.5 transition-colors hover:text-testo disabled:opacity-60 ${
                conFreccetta ? 'rounded-l-full pl-3 pr-2.5' : 'rounded-full px-3'
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full border-2 border-male" />
              {inArrivo ? 'Preparo…' : 'Registra'}
            </button>

            {conFreccetta && (
              <>
                <span className="h-4 w-px bg-bordo" />
                <button
                  onClick={() => setMenu((v) => !v)}
                  title="Scegli cosa registrare"
                  aria-label="Scegli cosa registrare"
                  aria-expanded={menu}
                  className="rounded-r-full py-1.5 pl-1.5 pr-2.5 transition-colors hover:text-testo"
                >
                  <Giu className={`h-3.5 w-3.5 transition-transform ${menu ? 'rotate-180' : ''}`} />
                </button>
              </>
            )}
          </div>

          {/* Verso il basso, al contrario delle tendine del selettore delle
              sorgenti: questo pulsante vive in cima alla sala, e lo spazio ce
              l'ha tutto sotto. */}
          {menu && (
            <div className="absolute top-full left-1/2 z-20 mt-1.5 w-80 -translate-x-1/2 rounded-xl border border-bordo bg-fondo-2 p-1 shadow-xl shadow-black/50">
              {voci.map((v) => (
                <button
                  key={v.id}
                  onClick={() => void parti(v)}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-fondo-3/60"
                >
                  <span className="mt-0.5 shrink-0 text-testo-3">{v.icona}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-testo">{v.nome}</span>
                    <span className="block text-[11px] leading-snug text-testo-3">{v.sotto}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {errore && (
          <p className="pointer-events-none max-w-sm rounded-lg border border-male/40 bg-fondo-2/95 px-2.5 py-1 text-[11px] text-male backdrop-blur">
            {errore}
          </p>
        )}
      </div>
    )
  }

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
