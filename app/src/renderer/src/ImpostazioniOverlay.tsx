import { useEffect, useState } from 'react'
import {
  MISURE_OVERLAY,
  type DimensioneOverlay,
  type Impostazioni,
  type NomiOverlay,
  type UtentiOverlay,
  type Utente
} from '@shared/tipi'
import { coloreDi, inizialiDi } from './lib/avatar'
import { ponte } from './ponte'
import { Avviso, Bottone, Campo, Interruttore, Sezione, classiInput } from './ui'

/**
 * Come e' fatto l'overlay, e la sua anteprima.
 *
 * L'anteprima non e' decorazione: le quattro scelte qui sotto cambiano una
 * cosa che si vede **solo quando la finestra e' ridotta a icona**, cioe' nel
 * momento esatto in cui questo pannello non e' sullo schermo. Senza un
 * riquadro che mostri il risultato, l'unico modo di regolarle sarebbe
 * scegliere alla cieca, ridurre a icona, guardare, riaprire — quattro volte
 * per quattro impostazioni.
 *
 * Il fondo a scacchi dell'anteprima dice l'altra meta': dietro all'overlay non
 * c'e' PulseTalk, c'e' qualunque cosa si stia guardando. E' il motivo per cui
 * ogni faccia ha la sua ombra invece di stare dentro a un riquadro comune.
 */
export default function ImpostazioniOverlay({
  impostazioni,
  utente,
  salva
}: {
  impostazioni: Impostazioni
  utente: Utente
  salva: (modifiche: Partial<Impostazioni>) => Promise<Impostazioni>
}): React.JSX.Element {
  const spento = !impostazioni.overlay

  return (
    <>
      <Sezione
        titolo="Overlay"
        sotto="Le facce di chi e' in chiamata, sopra a tutto il resto, mentre PulseTalk e' ridotta a icona."
      >
        <Interruttore
          acceso={impostazioni.overlay}
          cambia={(v) => void salva({ overlay: v })}
          titolo="Mostra l'overlay durante le chiamate"
          sotto="Compare quando riduci a icona la finestra e sei in un canale vocale, e sparisce appena torni. Si trascina dove vuoi, e ci resta."
        />

        {!ponte.elettrone && (
          <Avviso tono="neutro">
            Nel browser l&apos;overlay non c&apos;e&apos;: una pagina non puo&apos; disegnare sopra
            alle finestre degli altri programmi. Queste impostazioni valgono per
            l&apos;applicazione installata.
          </Avviso>
        )}
      </Sezione>

      <Sezione titolo="Anteprima" sotto="Cosi' si vedra' sopra a quello che stai facendo.">
        <Anteprima impostazioni={impostazioni} utente={utente} />
      </Sezione>

      <Sezione titolo="Come si vede">
        <Scelta
          etichetta="Dimensioni dell'avatar"
          aiuto="Quanto sono grandi le facce. Piccolo sta in un angolo senza farsi notare; grande si legge con la coda dell'occhio da lontano."
          valore={impostazioni.overlayAvatar}
          voci={[
            ['piccolo', 'Piccolo'],
            ['medio', 'Medio'],
            ['grande', 'Grande']
          ]}
          cambia={(v) => void salva({ overlayAvatar: v as DimensioneOverlay })}
          disabilitato={spento}
        />

        <Scelta
          etichetta="Visualizza nomi"
          aiuto="Il nome accanto alla faccia. Con «solo chi parla» l'overlay resta una colonna di cerchi finche' qualcuno non apre bocca."
          valore={impostazioni.overlayNomi}
          voci={[
            ['sempre', 'Sempre'],
            ['parlando', 'Solo chi parla'],
            ['mai', 'Mai']
          ]}
          cambia={(v) => void salva({ overlayNomi: v as NomiOverlay })}
          disabilitato={spento}
        />

        <Scelta
          etichetta="Mostra gli utenti"
          aiuto="Chi compare. Con «solo chi parla» l'overlay e' vuoto quando nessuno parla, e non occupa niente sullo schermo."
          valore={impostazioni.overlayUtenti}
          voci={[
            ['sempre', 'Sempre'],
            ['parlando', 'Solo chi parla']
          ]}
          cambia={(v) => void salva({ overlayUtenti: v as UtentiOverlay })}
          disabilitato={spento}
        />

        <CursoreInteri
          etichetta="Utenti massimi mostrati"
          aiuto="Il tetto alla colonna. Oltre quel numero restano le facce di chi ha parlato piu' di recente, che e' cio' che si sta cercando di sapere. Disattivato: ci sono tutti, anche in venti."
          valore={impostazioni.overlayMassimo}
          massimo={25}
          cambia={(v) => void salva({ overlayMassimo: v })}
          disabilitato={spento}
        />
      </Sezione>

      <Sezione titolo="Posizione">
        <p className="text-sm text-testo-2">
          {impostazioni.overlayX == null || impostazioni.overlayY == null ? (
            <>
              L&apos;overlay si mette in alto a destra dello schermo principale. Trascinalo dove
              vuoi: si ricorda dove l&apos;hai lasciato.
            </>
          ) : (
            <>
              L&apos;hai lasciato a{' '}
              <span className="numeri text-testo">
                {impostazioni.overlayX}, {impostazioni.overlayY}
              </span>
              . Se hai staccato il monitor su cui stava, si riporta da solo dentro a quello che
              c&apos;e&apos;.
            </>
          )}
        </p>

        <Bottone
          tono="fantasma"
          disabled={impostazioni.overlayX == null && impostazioni.overlayY == null}
          onClick={() => void salva({ overlayX: null, overlayY: null })}
        >
          Rimettilo in alto a destra
        </Bottone>
      </Sezione>
    </>
  )
}

/** Una tendina con l'etichetta sopra e la riga di spiegazione sotto. */
function Scelta({
  etichetta,
  aiuto,
  valore,
  voci,
  cambia,
  disabilitato
}: {
  etichetta: string
  aiuto: string
  valore: string
  voci: [string, string][]
  cambia: (valore: string) => void
  disabilitato: boolean
}): React.JSX.Element {
  return (
    <Campo etichetta={etichetta} aiuto={aiuto}>
      <select
        value={valore}
        disabled={disabilitato}
        onChange={(e) => cambia(e.target.value)}
        className={`${classiInput} disabled:opacity-40`}
      >
        {voci.map(([id, nome]) => (
          <option key={id} value={id}>
            {nome}
          </option>
        ))}
      </select>
    </Campo>
  )
}

/**
 * Un cursore che conta cose, non percentuali.
 *
 * Zero non e' "nessuno": e' il limite spento. Un tetto a zero facce sarebbe un
 * overlay vuoto, cioe' un modo involontario di spegnerlo dalla parte
 * sbagliata del pannello — e chi trascina un cursore fino in fondo a sinistra
 * si aspetta di togliere il limite, non la funzione.
 */
function CursoreInteri({
  etichetta,
  aiuto,
  valore,
  massimo,
  cambia,
  disabilitato
}: {
  etichetta: string
  aiuto: string
  valore: number
  massimo: number
  cambia: (valore: number) => void
  disabilitato: boolean
}): React.JSX.Element {
  const [locale, setLocale] = useState(valore)
  useEffect(() => setLocale(valore), [valore])

  const posa = (): void => {
    if (locale !== valore) cambia(locale)
  }

  return (
    <Campo etichetta={etichetta} aiuto={aiuto}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={massimo}
          step={1}
          value={locale}
          disabled={disabilitato}
          onChange={(e) => setLocale(Number(e.target.value))}
          onPointerUp={posa}
          onKeyUp={posa}
          onBlur={posa}
          className="h-1 min-w-0 flex-1 accent-vivo disabled:opacity-40"
        />
        <span className="numeri w-20 shrink-0 text-right text-xs text-testo-3">
          {locale === 0 ? 'Disattivato' : locale}
        </span>
      </div>
    </Campo>
  )
}

/** Le finte facce dell'anteprima: una parla, una e' muta, una sta zitta. */
const FINTI = [
  { id: 'anteprima-1', nome: 'Kovanth', parla: true, muto: false },
  { id: 'anteprima-2', nome: 'Acetaminophen', parla: false, muto: true },
  { id: 'anteprima-3', nome: 'Scynder', parla: false, muto: false }
]

function Anteprima({
  impostazioni,
  utente
}: {
  impostazioni: Impostazioni
  utente: Utente
}): React.JSX.Element {
  const lato = MISURE_OVERLAY[impostazioni.overlayAvatar]

  const tutte = [
    { id: `u${utente.id}`, nome: utente.nome, parla: false, muto: false, avatar: utente.avatar },
    ...FINTI.map((f) => ({ ...f, avatar: null as string | null }))
  ]

  const inScena = tutte
    .filter((f) => impostazioni.overlayUtenti !== 'parlando' || f.parla)
    .slice(0, impostazioni.overlayMassimo > 0 ? impostazioni.overlayMassimo : undefined)

  return (
    <div
      className="flex min-h-44 items-center justify-center rounded-xl border border-bordo p-5"
      // Gli scacchi dicono cio' che nessuna parola direbbe meglio: dietro
      // all'overlay non c'e' PulseTalk, c'e' quello che stai guardando.
      style={{
        backgroundColor: '#2a2f3a',
        backgroundImage:
          'linear-gradient(45deg,#333846 25%,transparent 25%,transparent 75%,#333846 75%),' +
          'linear-gradient(45deg,#333846 25%,transparent 25%,transparent 75%,#333846 75%)',
        backgroundSize: '22px 22px',
        backgroundPosition: '0 0,11px 11px'
      }}
    >
      {inScena.length === 0 ? (
        <p className="text-xs text-testo-3">
          Con queste impostazioni non si vede niente finche&rsquo; qualcuno non parla.
        </p>
      ) : (
        <div className="flex flex-col items-start gap-1.5">
          {inScena.map((f) => {
            const nome =
              impostazioni.overlayNomi === 'sempre' ||
              (impostazioni.overlayNomi === 'parlando' && f.parla)

            return (
              <div key={f.id} className="flex max-w-full items-center gap-2">
                <span
                  className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white"
                  style={{
                    width: lato,
                    height: lato,
                    fontSize: Math.round(lato * 0.36),
                    background: f.avatar ? '#1a2030' : coloreDi(f.id),
                    boxShadow: f.parla
                      ? 'inset 0 0 0 2px #3ecf8e, 0 3px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(62,207,142,.35)'
                      : '0 3px 10px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.35)'
                  }}
                >
                  {f.avatar ? (
                    <img src={f.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    inizialiDi(f.nome)
                  )}
                  {f.muto && (
                    <span
                      className="absolute right-0 bottom-0 rounded-full bg-male"
                      style={{
                        width: lato * 0.42,
                        height: lato * 0.42,
                        boxShadow: '0 0 0 2px rgba(0,0,0,.5)'
                      }}
                    />
                  )}
                </span>

                {nome && (
                  <span
                    className="max-w-42 truncate rounded-full px-2.5 py-1 text-[13px] text-testo"
                    style={{
                      background: 'rgba(20,24,34,.92)',
                      boxShadow: '0 3px 10px rgba(0,0,0,.55)'
                    }}
                  >
                    {f.nome}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
