import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChiaveColore, Impostazioni, PresetTema, Tema } from '@shared/tipi'
import { Avviso, Bottone, Campo, classiInput, Sezione } from './ui'
import {
  coloriDi,
  daCoolors,
  esadecimale,
  leggibilita,
  leggiEsadecimale,
  luminosita,
  personalizzato,
  PRESET,
  RUOLI,
  soloSuperficie,
  temaDaPalette,
  type Colori
} from './lib/tema'

/**
 * La pagina dei colori.
 *
 * Un principio solo, e regge tutto il resto: **si vede prima di scegliere**.
 * Un tema non si giudica da dodici quadratini in fila, si giudica guardando
 * l'app dipinta — e l'app e' proprio quella che sta dietro a questo pannello.
 * Quindi non c'e' nessun "applica": ogni tocco qui dentro salva, e cio' che si
 * salva dipinge la finestra nello stesso fotogramma. Si sfogliano i preset e i
 * colori cambiano sotto le dita, pannello compreso.
 *
 * Il che apre il buco che questo pannello deve tappare: si puo' arrivare in
 * due mosse a un tema in cui non si legge piu' niente, compresi i pulsanti per
 * tornare indietro. Da qui le due reti — l'avviso di leggibilita', che parla
 * *prima* che il tema si applichi, e "Rimetti tutto com'era", che riporta ai
 * colori con cui l'app e' nata e sta sempre nello stesso posto.
 */
export default function Aspetto({
  impostazioni,
  salva
}: {
  impostazioni: Impostazioni
  salva: (modifiche: Partial<Impostazioni>) => void
}): React.JSX.Element {
  const tema: Tema = impostazioni.tema ?? { preset: 'pulse', colori: {} }
  const colori = useMemo(() => coloriDi(tema), [tema])
  const toccato = personalizzato(tema)
  const conto = useMemo(() => leggibilita(colori), [colori])

  // Applicarlo non tocca a questa pagina: ci pensa la radice dell'app, che
  // guarda `impostazioni.tema` e ridipinge. E' un giro solo apposta — il tema
  // cambia anche da un'altra finestra, e con due posti che lo applicano ce ne
  // sarebbe uno che non se ne accorge. Qui basta salvare, e il colore arriva.
  const cambia = (modifiche: Partial<Tema>): void =>
    salva({ tema: { preset: tema.preset, colori: tema.colori, ...modifiche } })

  /** Un preset intero: si azzerano anche gli scostamenti, altrimenti non si vedrebbe cambiare niente. */
  const scegliPreset = (preset: PresetTema): void => salva({ tema: { preset, colori: {} } })

  /**
   * Un colore solo, cambiato a mano.
   *
   * Si scrive fra gli scostamenti solo se e' *diverso* dal preset: rimettere a
   * mano il valore che c'era gia' deve riportare il tema a essere il preset
   * intatto, non lasciarlo "personalizzato" per sempre con dentro dodici
   * colori identici a quelli di partenza.
   */
  const cambiaColore = (chiave: ChiaveColore, valore: string): void => {
    const letto = leggiEsadecimale(valore)
    if (!letto) return
    const pulito = esadecimale(letto)
    const prossimi = { ...tema.colori }
    if (pulito.toLowerCase() === PRESET[tema.preset][chiave].toLowerCase()) delete prossimi[chiave]
    else prossimi[chiave] = pulito
    cambia({ colori: prossimi })
  }

  /** Dodici colori insieme: da una tavolozza, o da un preset preso come punto di partenza. */
  const applicaTutti = (nuovi: Colori): void => {
    const scostamenti: Partial<Record<ChiaveColore, string>> = {}
    for (const { chiave } of RUOLI) {
      if (nuovi[chiave].toLowerCase() !== PRESET[tema.preset][chiave].toLowerCase()) {
        scostamenti[chiave] = nuovi[chiave]
      }
    }
    cambia({ colori: scostamenti })
  }

  return (
    <>
      <Sezione
        titolo="Punto di partenza"
        sotto="Tre insiemi provati sullo schermo vero. Da qualunque dei tre si puo' poi cambiare quello che si vuole."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PRESET) as PresetTema[]).map((id) => (
            <CartaPreset
              key={id}
              id={id}
              scelto={tema.preset === id}
              // Il preset resta "scelto" anche con dei colori cambiati sopra:
              // e' la sua base, e nasconderlo lascerebbe senza risposta la
              // domanda "da dove sono partito".
              toccato={tema.preset === id && toccato}
              scegli={() => scegliPreset(id)}
            />
          ))}
        </div>

        {tema.preset === 'chiaro' && !toccato && (
          <Avviso tono="neutro">
            PulseTalk e' nata scura per un motivo che vale ancora: accanto a un riquadro che mostra
            lo schermo di qualcun altro, ogni pixel chiaro e' luce da scavalcare per tornare a
            leggere. Di giorno, fuori dalle chiamate, e' pero' esattamente il contrario — e
            questo tema esiste per quello.
          </Avviso>
        )}
      </Sezione>

      <Tavolozza colori={colori} applica={(nuovi) => applicaTutti(soloSuperficie(nuovi, colori))} />

      <Sezione
        titolo="I dodici colori"
        sotto="Tutta l'app e' dipinta con questi e con nessun altro. Ognuno dice dove si vede: e' l'unica cosa che serve per decidere se toccarlo."
      >
        <div className="grid gap-1.5 sm:grid-cols-2">
          {RUOLI.map(({ chiave, nome, dove }) => (
            <RigaColore
              key={chiave}
              nome={nome}
              dove={dove}
              valore={colori[chiave]}
              cambiato={colori[chiave].toLowerCase() !== PRESET[tema.preset][chiave].toLowerCase()}
              cambia={(v) => cambiaColore(chiave, v)}
            />
          ))}
        </div>

        {/* L'avviso vive qui e non fra i preset, perche' e' qui che si arriva
            a rompere qualcosa: i tre preset sono stati provati, e un colore
            cambiato a mano no. Dice il numero e non solo "attenzione" — chi
            sta scurendo il testo apposta ha bisogno di sapere quanto manca,
            non di essere sgridato. */}
        {conto.scarso && (
          <Avviso tono="attenzione">
            Il contrasto piu' basso di questo tema e' {conto.minimo.toFixed(1)} a 1, sotto il
            minimo che rende leggibile anche solo il testo grande. Guarda il fondo, il testo smorto
            e il colore vivo: sono i tre che misuro.
          </Avviso>
        )}

        {toccato && (
          <div className="flex items-center gap-2">
            <Bottone tono="fantasma" onClick={() => cambia({ colori: {} })}>
              Torna al preset {NOMI[tema.preset]}
            </Bottone>
            <Bottone tono="fantasma" onClick={() => scegliPreset('pulse')}>
              Rimetti tutto com'era
            </Bottone>
          </div>
        )}
      </Sezione>
    </>
  )
}

const NOMI: Record<PresetTema, string> = { pulse: 'PulseTalk', scuro: 'Scuro', chiaro: 'Chiaro' }

const SOTTO: Record<PresetTema, string> = {
  pulse: 'I colori di sempre: notte con dentro del blu.',
  scuro: 'Grigi neutri, senza tinta. Non tira i colori degli schermi condivisi.',
  chiaro: 'Per il giorno, e fuori dalle chiamate.'
}

/**
 * Un preset, mostrato con i suoi colori invece che col suo nome.
 *
 * La cartolina e' una finta finestra dell'app in miniatura — la colonna, un
 * pannello, una riga di testo, i quattro accenti in fila — e non un elenco di
 * pastiglie. Un tema non e' un insieme di colori, e' come stanno *uno accanto
 * all'altro*: il grigio del bordo su un fondo blu notte e' un altro grigio che
 * su un fondo neutro, e in una fila di pastiglie quella differenza non si vede.
 */
function CartaPreset({
  id,
  scelto,
  toccato,
  scegli
}: {
  id: PresetTema
  scelto: boolean
  toccato: boolean
  scegli: () => void
}): React.JSX.Element {
  const c = PRESET[id]

  return (
    <button
      onClick={scegli}
      aria-pressed={scelto}
      className={`group overflow-hidden rounded-xl border text-left transition-colors ${
        scelto ? 'border-vivo' : 'border-bordo hover:border-fondo-3'
      }`}
    >
      {/* I colori qui dentro sono scritti a mano e non presi dalle classi:
          questa e' l'unica parte dell'app che deve mostrare un tema *diverso*
          da quello acceso, e con `bg-fondo` mostrerebbe tre volte lo stesso. */}
      <span className="flex h-16 items-stretch gap-1 p-1.5" style={{ background: c.fondo }}>
        <span className="w-3 shrink-0 rounded" style={{ background: c['fondo-2'] }} />
        <span
          className="flex min-w-0 flex-1 flex-col justify-between rounded p-1.5"
          style={{ background: c['fondo-2'], border: `1px solid ${c.bordo}` }}
        >
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-6 rounded-full" style={{ background: c.testo }} />
            <span className="h-1.5 w-4 rounded-full" style={{ background: c['testo-3'] }} />
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded" style={{ background: c.vivo }} />
            {[c.ok, c.attenzione, c.male].map((accento) => (
              <span key={accento} className="h-2.5 w-2.5 rounded-full" style={{ background: accento }} />
            ))}
          </span>
        </span>
      </span>

      <span
        className={`block border-t px-2.5 py-2 transition-colors ${
          scelto ? 'border-vivo/40 bg-vivo/10' : 'border-bordo bg-fondo-2 group-hover:bg-fondo-3'
        }`}
      >
        <span className={`block text-xs font-semibold ${scelto ? 'text-vivo' : 'text-testo'}`}>
          {NOMI[id]}
          {toccato && <span className="ml-1 font-normal text-testo-3">— modificato</span>}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-testo-3">{SOTTO[id]}</span>
      </span>
    </button>
  )
}

/**
 * Un colore: il quadratino che si apre, e le sei cifre che si incollano.
 *
 * Tutti e due e non uno solo, perche' sono due gesti diversi. Il selettore del
 * sistema serve a *cercare* un colore guardandolo; il campo di testo serve a
 * metterne uno che si ha gia', copiato da un altro posto — ed e' il caso piu'
 * frequente, visto che chi arriva qui di solito ha una tavolozza in mano.
 *
 * Il campo tiene il testo in uno stato suo mentre lo si scrive. Legato dritto
 * al salvataggio, `#3ec` sarebbe un colore valido a tre cifre e il tema
 * cambierebbe a meta' di ogni parola scritta a mano.
 */
function RigaColore({
  nome,
  dove,
  valore,
  cambiato,
  cambia
}: {
  nome: string
  dove: string
  valore: string
  cambiato: boolean
  cambia: (valore: string) => void
}): React.JSX.Element {
  const [scritto, setScritto] = useState(valore)
  useEffect(() => setScritto(valore), [valore])

  const posa = (): void => {
    const letto = leggiEsadecimale(scritto)
    if (letto) cambia(esadecimale(letto))
    // Storto: torna quello vero invece di restare li' a fare finta.
    else setScritto(valore)
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border p-2 transition-colors ${
        cambiato ? 'border-vivo/30 bg-vivo/[0.04]' : 'border-bordo bg-fondo/40'
      }`}
    >
      {/* Il quadratino e' l'etichetta del campo: cliccarlo apre il selettore
          del sistema. Il bordo chiaro sopra al colore serve ai colori che
          coincidono col fondo — senza, il "fondo" sarebbe un buco invisibile. */}
      <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-bordo">
        <span className="absolute inset-0" style={{ background: valore }} />
        <input
          type="color"
          value={valore}
          onChange={(e) => cambia(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label={nome}
        />
      </label>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-testo">{nome}</span>
        <span className="block truncate text-[11px] text-testo-3" title={dove}>
          {dove}
        </span>
      </span>

      <input
        value={scritto}
        onChange={(e) => setScritto(e.target.value)}
        onBlur={posa}
        onKeyDown={(e) => e.key === 'Enter' && posa()}
        spellCheck={false}
        aria-label={`${nome}, in esadecimale`}
        className="numeri w-[5.5rem] shrink-0 rounded-md border border-bordo bg-fondo px-2 py-1.5 text-center text-[11px] text-testo-2 uppercase outline-none transition-colors focus:border-vivo focus:text-testo"
      />
    </div>
  )
}

/**
 * Una tavolozza di coolors.co, letta e trasformata in dodici colori.
 *
 * Non si applica scrivendola: si vede prima. Sotto al campo compaiono i colori
 * letti, i dodici che ne verrebbero fuori e la stessa cartolina dei preset —
 * e solo dopo c'e' il pulsante. E' la differenza fra provare una tavolozza e
 * doverne ricostruire un'altra perche' questa non andava.
 *
 * Il verso e' una scelta e non una deduzione. Le stesse cinque tinte fanno un
 * tema notturno o uno diurno a seconda di quale estremo si prende come fondo,
 * e non c'e' modo di indovinare quale dei due si voleva: cinque pastelli
 * possono diventare tutte e due le cose, e sono ugualmente sensate.
 */
function Tavolozza({
  colori,
  applica
}: {
  colori: Colori
  applica: (colori: Colori) => void
}): React.JSX.Element {
  const [testo, setTesto] = useState('')
  const [verso, setVerso] = useState<'scuro' | 'chiaro'>('scuro')
  const campo = useRef<HTMLInputElement>(null)

  const letti = useMemo(() => daCoolors(testo), [testo])
  const proposta = useMemo(
    () => (letti.length > 0 ? temaDaPalette(letti, verso) : null),
    [letti, verso]
  )
  const conto = useMemo(() => (proposta ? leggibilita(proposta) : null), [proposta])

  return (
    <Sezione
      titolo="Una tavolozza da coolors.co"
      sotto="Incolla l'indirizzo di una tavolozza — o anche solo i suoi colori — e diventa un tema intero."
    >
      <Campo
        etichetta="Indirizzo o colori"
        aiuto={
          <>
            Vanno bene <span className="numeri">coolors.co/palette/264653-2a9d8f-e9c46a</span>, lo
            stesso senza <span className="numeri">/palette/</span>, o una riga di colori copiati da
            qualunque altro posto. I dodici dell'app si ricavano da quelli che ci sono: i fondi e i
            testi dalle due estremita', i quattro accenti per tinta — verde a cio' che va bene,
            rosso a cio' che elimina, e chi manca viene fabbricato ruotando il piu' colorato della
            tavolozza, cosi' resta di famiglia.
          </>
        }
      >
        <input
          ref={campo}
          className={classiInput}
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder="https://coolors.co/palette/264653-2a9d8f-e9c46a-f4a261-e76f51"
          spellCheck={false}
        />
      </Campo>

      {testo.trim() && letti.length === 0 && (
        <Avviso tono="attenzione">
          Non ci ho trovato nessun colore. Servono gruppi di sei cifre esadecimali — e' cosi' che
          li scrive coolors, sia nell'indirizzo sia quando li si copia.
        </Avviso>
      )}

      {proposta && (
        <div className="space-y-3 rounded-xl border border-bordo bg-fondo/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-testo-2">
              {letti.length} {letti.length === 1 ? 'colore letto' : 'colori letti'}
            </span>
            <span className="flex gap-1">
              {letti.map((c) => (
                <span
                  key={c}
                  title={c}
                  className="h-5 w-5 rounded border border-bordo"
                  style={{ background: c }}
                />
              ))}
            </span>

            {/* Il verso, a destra: e' l'unica manopola di questa sezione, e le
                due possibilita' vanno viste insieme per poter scegliere. */}
            <span className="ml-auto flex overflow-hidden rounded-lg border border-bordo">
              {(['scuro', 'chiaro'] as const).map((quale) => (
                <button
                  key={quale}
                  onClick={() => setVerso(quale)}
                  aria-pressed={verso === quale}
                  className={`px-2.5 py-1 text-xs transition-colors ${
                    verso === quale
                      ? 'bg-vivo/15 text-vivo'
                      : 'text-testo-3 hover:bg-fondo-3 hover:text-testo-2'
                  }`}
                >
                  {quale === 'scuro' ? 'Fondo scuro' : 'Fondo chiaro'}
                </button>
              ))}
            </span>
          </div>

          <Anteprima colori={proposta} />

          {/* Cosa si prende e cosa no, detto prima di premere.

              L'anteprima qui sopra mostra il tema intero — accenti compresi —
              perche' e' cio' che la tavolozza saprebbe fare, ed e' giusto
              vederlo. Applicando pero' si prendono solo fondi, bordi e testi:
              verde uguale «va bene» e rosso uguale «esci» sono le due cose che
              in una chiamata si obbediscono senza leggerle, e riscriverle con
              un accordo cromatico preso da un poster vuol dire due pulsanti
              importanti dello stesso colore. */}
          <p className="text-[11px] leading-relaxed text-testo-3">
            Si prendono <span className="text-testo-2">fondi, bordi e testi</span>. Verde, ambra,
            rosso e il colore vivo restano quelli che sono: dicono cosa fa un pulsante prima che
            uno lo legga, e una tavolozza non sa che significato hanno. Cambiarli si puo&rsquo; uno
            per uno, qui sotto.
          </p>

          {conto?.scarso && (
            <Avviso tono="attenzione">
              Con questa tavolozza il contrasto piu' basso e' {conto.minimo.toFixed(1)} a 1, sotto
              il minimo che rende leggibile anche solo il testo grande. Si puo' applicare lo stesso
              — e poi ritoccare a mano fondo e testo qui sotto — ma sappi che stai partendo da un
              tema in cui qualcosa non si legge.
            </Avviso>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Bottone tono="vivo" onClick={() => applica(proposta)}>
              Usa i fondi di questa tavolozza
            </Bottone>
            <Bottone
              tono="fantasma"
              onClick={() => {
                setTesto('')
                campo.current?.focus()
              }}
            >
              Cancella
            </Bottone>
          </div>
        </div>
      )}

      {!proposta && (
        <>
          <p className="text-xs text-testo-3">Quella accesa adesso:</p>
          <Anteprima colori={colori} />
        </>
      )}
    </Sezione>
  )
}

/**
 * Un tema visto come lo si vedra': una finestra finta, in piccolo.
 *
 * Dodici quadratini in fila dicono quali colori ci sono e non dicono niente di
 * cio' che conta — se il testo smorto si legge sul fondo dei pannelli, se il
 * verde della chiamata si distingue dal blu dei link, se il bordo esiste
 * ancora. Qui ognuno sta dove starebbe davvero, ed e' per questo che i colori
 * sono in `style` e non in classi: e' l'unica parte dell'app che deve
 * disegnarsi con un tema che non e' quello acceso.
 */
function Anteprima({ colori }: { colori: Colori }): React.JSX.Element {
  const chiaro = luminosita(leggiEsadecimale(colori.fondo)!) > 0.5

  return (
    // Larga al massimo quanto una finestra piccola, e non quanto il pannello.
    // Stirata a tutta larghezza le due colonne diventano due fili accanto a
    // una chat larghissima — cioe' una proporzione che l'app non ha mai, e
    // un'anteprima che mente sulle proporzioni non serve a niente.
    <div
      className="max-w-md overflow-hidden rounded-lg border"
      style={{ background: colori.fondo, borderColor: colori.bordo }}
    >
      <div className="flex h-[5.5rem]">
        {/* La colonna dei server. */}
        <div
          className="flex w-9 shrink-0 flex-col items-center gap-1.5 border-r py-2"
          style={{ borderColor: colori.bordo, background: colori.fondo }}
        >
          <span className="h-5 w-5 rounded-md" style={{ background: colori.vivo }} />
          <span className="h-5 w-5 rounded-xl" style={{ background: colori['fondo-3'] }} />
          <span className="h-5 w-5 rounded-xl" style={{ background: colori['fondo-3'] }} />
        </div>

        {/* La colonna dei canali, con la riga verde della chiamata in fondo. */}
        <div
          className="flex w-24 shrink-0 flex-col justify-between border-r p-1.5"
          style={{ borderColor: colori.bordo, background: colori['fondo-2'] }}
        >
          <div className="space-y-1">
            <span className="block h-1.5 w-10 rounded-full" style={{ background: colori['testo-3'] }} />
            <span
              className="block rounded px-1 py-0.5"
              style={{ background: colori['fondo-3'] }}
            >
              <span className="block h-1.5 w-12 rounded-full" style={{ background: colori.testo }} />
            </span>
            <span className="block h-1.5 w-9 rounded-full" style={{ background: colori['testo-2'] }} />
          </div>
          <span
            className="flex items-center gap-1 rounded px-1 py-1"
            style={{ background: `${colori.ok}1f`, border: `1px solid ${colori.ok}55` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: colori.ok }} />
            <span className="h-1.5 w-9 rounded-full" style={{ background: colori.ok }} />
          </span>
        </div>

        {/* La chat, e i due accenti che restano. */}
        <div className="flex min-w-0 flex-1 flex-col justify-between p-2">
          <div className="space-y-1.5">
            <span className="block h-1.5 w-full rounded-full" style={{ background: colori.testo }} />
            <span className="block h-1.5 w-4/5 rounded-full" style={{ background: colori['testo-2'] }} />
            <span className="block h-1.5 w-3/5 rounded-full" style={{ background: colori['testo-3'] }} />
          </div>
          <div className="flex items-center gap-1.5">
            {/* Il pulsante pieno: e' il caso in cui il fondo fa da inchiostro,
                quello che si dimentica sempre di controllare. */}
            <span
              className="flex h-4 w-10 items-center justify-center rounded"
              style={{ background: colori.vivo }}
            >
              <span className="h-1 w-5 rounded-full" style={{ background: colori.fondo }} />
            </span>
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: colori.attenzione }} />
            <span className="h-3.5 w-3.5 rounded-full" style={{ background: colori.male }} />
            <span className="ml-auto text-[9px]" style={{ color: colori['testo-3'] }}>
              {chiaro ? 'chiaro' : 'scuro'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
