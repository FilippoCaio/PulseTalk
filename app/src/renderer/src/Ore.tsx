import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Api, OreDiUno, SettimanaMia, SettimanaTutti } from './lib/api'
import { Avviso, Bottone, Sezione } from './ui'

/**
 * Il cartellino, dalle due parti.
 *
 * `MieOre` e' quello di chi lavora: le proprie ore della settimana, quante ne
 * mancano, e il pulsante per tornare indietro a guardare quelle di prima.
 * `OreDiTutti` e' quello di chi paga, e vive nel pannello del server.
 *
 * Sono nello stesso file perche' sono la stessa tabella vista da due
 * distanze, e devono restare la stessa tabella: se un giorno i totali qui e
 * li' cominciassero a essere calcolati in due modi diversi, la prima persona
 * ad accorgersene sarebbe quella a cui manca un'ora in busta paga. Le somme
 * arrivano gia' fatte dal server per la stessa ragione.
 *
 * ## Perche' le ore si scrivono cosi'
 *
 * `7h 20m`, non `7,33` e non `07:20`. Il decimale e' la forma in cui si
 * pagano ma non quella in cui si vivono - nessuno sa a mente quanto sia 0,33
 * di ora - e il formato con i due punti si legge come un orario, cioe' come
 * "le sette e venti". Il totale della settimana lo si guarda per capire se si
 * e' in pari, ed e' una domanda a cui si risponde in ore e minuti.
 */

/** Da secondi a «7h 20m». Sotto l'ora restano solo i minuti. */
export function scriviOre(secondi: number): string {
  const minuti = Math.round(secondi / 60)
  const ore = Math.floor(minuti / 60)
  const resto = minuti % 60
  if (ore === 0) return `${resto}m`
  return resto === 0 ? `${ore}h` : `${ore}h ${resto}m`
}

/** Da «2026-08-31» a «lun 31/8». */
function scriviGiorno(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number)
  const data = new Date(a, m - 1, g)
  const nomi = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
  return `${nomi[data.getDay()]} ${data.getDate()}/${data.getMonth() + 1}`
}

/** Il lunedi' di prima o di dopo, per navigare le settimane. */
function spostaSettimana(lunedi: string, quante: number): string {
  const [a, m, g] = lunedi.split('-').map(Number)
  const data = new Date(a, m - 1, g + quante * 7)
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${due(data.getMonth() + 1)}-${due(data.getDate())}`
}

/**
 * Il lunedi' di questa settimana.
 *
 * Uguale al `lunediDi` del server, e non e' una copia per distrazione: e' il
 * valore di partenza della pagina, e chiederlo al server vorrebbe dire un giro
 * di rete per sapere che giorno e'. La domenica appartiene alla settimana che
 * sta finendo, come di la'.
 */
function questoLunedi(): string {
  const oggi = new Date()
  const giorno = oggi.getDay()
  const indietro = giorno === 0 ? 6 : giorno - 1
  const lunedi = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() - indietro)
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${lunedi.getFullYear()}-${due(lunedi.getMonth() + 1)}-${due(lunedi.getDate())}`
}

/** Le frecce per cambiare settimana, con «questa» che si spegne quando ci sei. */
function Navigatore({
  settimana,
  cambia
}: {
  settimana: string
  cambia: (lunedi: string) => void
}): React.JSX.Element {
  const corrente = questoLunedi()
  return (
    <div className="flex items-center gap-2">
      <Bottone tono="fantasma" onClick={() => cambia(spostaSettimana(settimana, -1))}>
        &lsaquo; Settimana prima
      </Bottone>
      <Bottone
        tono="fantasma"
        disabled={settimana === corrente}
        onClick={() => cambia(spostaSettimana(settimana, 1))}
      >
        Settimana dopo &rsaquo;
      </Bottone>
      {settimana !== corrente && (
        <Bottone tono="fantasma" onClick={() => cambia(corrente)}>
          Torna a questa
        </Bottone>
      )}
    </div>
  )
}

/**
 * Una barra per giorno, alte in proporzione al giorno piu' lungo.
 *
 * In proporzione al massimo della settimana e non alle otto ore attese: una
 * settimana da tre ore in croce disegnata su un fondo scala di otto sarebbe
 * una fila di trattini indistinguibili, e la domanda a cui il grafico risponde
 * — quale giorno e' stato pieno e quale no — resterebbe senza risposta proprio
 * nella settimana in cui la si fa.
 */
function Barre({
  giorni,
  valori
}: {
  giorni: string[]
  valori: Record<string, number>
}): React.JSX.Element {
  const massimo = Math.max(1, ...giorni.map((g) => valori[g] ?? 0))

  return (
    <div className="flex items-end gap-2">
      {giorni.map((giorno) => {
        const secondi = valori[giorno] ?? 0
        return (
          <div key={giorno} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="numeri text-[10px] text-testo-3">
              {secondi > 0 ? scriviOre(secondi) : ''}
            </span>
            <div className="flex h-24 w-full items-end rounded-md bg-fondo">
              <div
                className={`w-full rounded-md transition-[height] ${
                  secondi > 0 ? 'bg-vivo' : 'bg-transparent'
                }`}
                style={{ height: `${Math.round((secondi / massimo) * 100)}%` }}
              />
            </div>
            <span className="truncate text-[10px] text-testo-3">{scriviGiorno(giorno)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Il totale, e quanto manca all'obiettivo. */
function Totale({
  secondi,
  oreSettimana
}: {
  secondi: number
  oreSettimana: number
}): React.JSX.Element {
  const attesi = oreSettimana * 3600
  const differenza = secondi - attesi

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="numeri text-2xl font-semibold text-testo">{scriviOre(secondi)}</span>
      <span className="text-xs text-testo-3">su {oreSettimana}h attese</span>
      {differenza < 0 ? (
        <span className="text-xs text-attenzione">
          ne mancano <span className="numeri">{scriviOre(-differenza)}</span>
        </span>
      ) : (
        <span className="text-xs text-ok">
          {differenza === 0 ? 'in pari' : <>ne hai fatte <span className="numeri">{scriviOre(differenza)}</span> in piu&rsquo;</>}
        </span>
      )}
    </div>
  )
}

/**
 * Le mie ore: la pagina che vede chi lavora.
 *
 * Esiste anche quando il registro e' spento, e in quel caso lo dice invece di
 * non comparire: una voce che appare e sparisce dal menu delle impostazioni a
 * seconda di come e' configurato il server e' una voce che, il giorno in cui
 * serve, non si trova.
 */
export function MieOre({ api }: { api: Api }): React.JSX.Element {
  const [settimana, setSettimana] = useState(questoLunedi())
  const [dati, setDati] = useState<SettimanaMia | null>(null)
  const [spento, setSpento] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setErrore(null)
    void api
      .oreMie(settimana)
      .then((risposta) => {
        if (!vivo) return
        setSpento(risposta === null)
        setDati(risposta)
      })
      .catch((e) => vivo && setErrore((e as Error).message))
    return () => {
      vivo = false
    }
  }, [api, settimana])

  if (spento) {
    return (
      <Sezione titolo="Le mie ore">
        <Avviso tono="neutro">
          Su questo server il registro delle ore non e&rsquo; acceso: nessuno sta contando quanto
          tempo passi nei canali vocali, e qui non c&rsquo;e&rsquo; niente da vedere. Lo accende
          chi amministra, dalle impostazioni del server.
        </Avviso>
      </Sezione>
    )
  }

  return (
    <Sezione
      titolo="Le mie ore"
      sotto="Il tempo passato nei canali vocali, contato dal server un minuto per volta. Da lunedi' a sabato."
    >
      {errore && <Avviso>{errore}</Avviso>}

      <Navigatore settimana={settimana} cambia={setSettimana} />

      {dati && (
        <>
          <Totale secondi={dati.mie.secondi} oreSettimana={dati.oreSettimana} />
          <Barre giorni={dati.giorni} valori={dati.mie.giorni} />

          <p className="text-xs leading-relaxed text-testo-3">
            Conta il tempo in cui sei dentro a un canale vocale o in una chiamata, anche a
            microfono spento: e&rsquo; presenza, non parlato. Il conto sta sul server, e questi
            stessi numeri li vede chi amministra.
          </p>
        </>
      )}
    </Sezione>
  )
}

/**
 * Le ore di tutti: la tabella che vede chi amministra.
 *
 * Sta dentro alla categoria «Lavoro» del pannello del server, sotto
 * all'interruttore che la accende — che e' l'unico posto in cui ha senso:
 * chi la cerca l'ha appena accesa.
 */
export function OreDiTutti({ api }: { api: Api }): React.JSX.Element {
  const [settimana, setSettimana] = useState(questoLunedi())
  const [dati, setDati] = useState<SettimanaTutti | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [scritto, setScritto] = useState<string | null>(null)

  const carica = useCallback(
    (quale: string) => {
      setErrore(null)
      void api
        .oreDiTutti(quale)
        .then(setDati)
        .catch((e) => setErrore((e as Error).message))
    },
    [api]
  )

  useEffect(() => carica(settimana), [carica, settimana])

  const ordinate = useMemo<OreDiUno[]>(
    () => (dati ? [...dati.persone].sort((a, b) => b.secondi - a.secondi) : []),
    [dati]
  )

  const chiudi = async (): Promise<void> => {
    setErrore(null)
    setScritto(null)
    try {
      const esito = await api.chiudiSettimanaOre(settimana)
      setScritto(esito.settimana)
      carica(settimana)
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  return (
    <Sezione
      titolo="Chi ha fatto quante ore"
      sotto="La settimana lavorativa, da lunedi' a sabato. Chi non compare non e' entrato in nessun canale vocale."
    >
      {errore && <Avviso>{errore}</Avviso>}

      <Navigatore settimana={settimana} cambia={setSettimana} />

      {dati && ordinate.length === 0 ? (
        <p className="text-sm text-testo-3">In questa settimana non e&rsquo; entrato nessuno.</p>
      ) : (
        dati && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-testo-3 uppercase">
                  <th className="py-2 pr-3 font-medium">Chi</th>
                  {dati.giorni.map((g) => (
                    <th key={g} className="px-2 py-2 text-right font-medium">
                      {scriviGiorno(g)}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-right font-medium">Totale</th>
                </tr>
              </thead>
              <tbody>
                {ordinate.map((persona) => {
                  const mancano = dati.oreSettimana * 3600 - persona.secondi
                  return (
                    <tr key={persona.utente} className="border-t border-bordo">
                      <td className="truncate py-2 pr-3">{persona.nome}</td>
                      {dati.giorni.map((g) => (
                        <td key={g} className="numeri px-2 py-2 text-right text-testo-2">
                          {persona.giorni[g] ? scriviOre(persona.giorni[g]) : '—'}
                        </td>
                      ))}
                      <td
                        className={`numeri py-2 pl-3 text-right font-semibold ${
                          mancano > 0 ? 'text-attenzione' : 'text-ok'
                        }`}
                        title={
                          mancano > 0
                            ? `Ne mancano ${scriviOre(mancano)} sulle ${dati.oreSettimana}h attese`
                            : `${dati.oreSettimana}h attese, raggiunte`
                        }
                      >
                        {scriviOre(persona.secondi)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Bottone tono="fantasma" onClick={() => void chiudi()}>
          Scrivi il file di questa settimana
        </Bottone>
        {scritto && <span className="text-xs text-ok">scritto: settimana-{scritto}.json</span>}
      </div>

      <p className="text-xs leading-relaxed text-testo-3">
        Ogni lunedi&rsquo; la settimana appena finita viene scritta da sola in un file dentro alla
        cartella <span className="numeri">ore/</span> del server, accanto al database: si apre
        senza PulseTalk e resta leggibile anche quando queste righe non ci saranno piu&rsquo;. Il
        pulsante qui sopra lo scrive adesso, se serve prima.
        {dati && dati.archivio.length > 0 && (
          <> Ce ne sono gia&rsquo; {dati.archivio.length} sul disco.</>
        )}
      </p>
    </Sezione>
  )
}
