import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * I guasti dell'applicazione, raccolti in un posto solo.
 *
 * Prima ognuno se li diceva per conto suo: il microfono staccato era una
 * striscia gialla in cima alla chat, Auto Writer era una frase grigia dentro
 * alla barra della chiamata, e l'AI non configurata non si diceva affatto —
 * lasciava dei pulsanti che rispondevano 501. Tre modi diversi di dire la
 * stessa cosa, e nessuno che li mettesse insieme: con due problemi aperti se ne
 * vedeva uno.
 *
 * Qui invece chi ha un guaio lo dichiara e se ne dimentica. Il guaio resta
 * finche' resta il componente che l'ha dichiarato — sparisce da solo quando la
 * causa sparisce — e l'interfaccia lo mostra in un modo solo: uno inline se e'
 * l'unico, due spie con il numero quando sono di piu'.
 *
 * Le chiavi sono stabili apposta. Lo stesso guaio dichiarato da due componenti
 * diversi, o ridichiarato a ogni render, deve restare una riga sola: contarlo
 * due volte vorrebbe dire una spia che dice "3" quando i problemi sono due, e
 * un numero di cui non ci si fida e' peggio di nessun numero.
 */
export interface Problema {
  /** Stabile: identifica *quale* guaio, non chi l'ha segnalato. */
  chiave: string
  gravita: 'errore' | 'attenzione'
  /** Una riga, senza punto finale. E' il titolo nell'elenco. */
  titolo: string
  /** Cosa e' successo e cosa comporta, in una o due frasi. */
  dettaglio: string
  /** L'unica cosa sensata da fare, se c'e'. */
  azione?: { nome: string; fai: () => void }
}

interface Azioni {
  segnala: (problema: Problema) => void
  ritira: (chiave: string) => void
}

/**
 * Due contesti e non uno, ed e' la cosa che tiene in piedi tutto il resto.
 *
 * Con un contesto solo — `{ problemi, segnala, ritira }` — il valore cambia a
 * ogni segnalazione, perche' dentro ci sta anche l'elenco. Chi dichiara un
 * guaio dipende da quel valore, quindi il suo effetto rigira; rigirando fa
 * `ritira` e poi `segnala`; tutte e due cambiano l'elenco; l'elenco cambia il
 * valore del contesto; e si ricomincia. Un ciclo senza fondo, e di quelli che
 * si notano solo quando la ventola comincia a girare.
 *
 * Separati, chi dichiara guarda soltanto le due funzioni — che non cambiano
 * mai — e chi disegna guarda soltanto l'elenco.
 */
const ContestoAzioni = createContext<Azioni | null>(null)
const ContestoElenco = createContext<Problema[]>([])

export function Diagnostica({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [mappa, setMappa] = useState<Map<string, Problema>>(() => new Map())

  const azioni = useMemo<Azioni>(
    () => ({
      segnala(problema) {
        setMappa((precedente) => {
          const gia = precedente.get(problema.chiave)
          // Stesso contenuto: si restituisce la mappa di prima invece di una
          // copia uguale, o ogni render di chi segnala ne farebbe uno a valle.
          if (
            gia &&
            gia.gravita === problema.gravita &&
            gia.titolo === problema.titolo &&
            gia.dettaglio === problema.dettaglio &&
            gia.azione?.nome === problema.azione?.nome
          ) {
            return precedente
          }
          const copia = new Map(precedente)
          copia.set(problema.chiave, problema)
          return copia
        })
      },
      ritira(chiave) {
        setMappa((precedente) => {
          if (!precedente.has(chiave)) return precedente
          const copia = new Map(precedente)
          copia.delete(chiave)
          return copia
        })
      }
    }),
    []
  )

  // Gli errori prima, e a parita' l'ordine in cui sono arrivati: chi apre il
  // pannello deve trovare in cima la cosa che rompe, non quella che infastidisce.
  const problemi = useMemo(
    () =>
      [...mappa.values()].sort((a, b) =>
        a.gravita === b.gravita ? 0 : a.gravita === 'errore' ? -1 : 1
      ),
    [mappa]
  )

  return (
    <ContestoAzioni.Provider value={azioni}>
      <ContestoElenco.Provider value={problemi}>{children}</ContestoElenco.Provider>
    </ContestoAzioni.Provider>
  )
}

/** L'elenco, per chi lo disegna. Fuori dal provider e' vuoto invece che un errore. */
export function usaProblemi(): Problema[] {
  return useContext(ContestoElenco)
}

/**
 * Dichiara un guaio finche' dura.
 *
 * Si passa `null` quando non c'e' niente da dire, e la riga sparisce. Chi la
 * dichiara non deve ricordarsi di ritirarla: smontandosi il componente, se ne
 * va da sola.
 *
 * Le dipendenze dell'effetto sono i campi e non l'oggetto: un letterale scritto
 * dentro al render e' nuovo a ogni giro, e come dipendenza rifarebbe il lavoro
 * sessanta volte al secondo senza che sia cambiato niente.
 *
 * La funzione dell'azione fra le dipendenze non ci va, per la stessa ragione: e'
 * quasi sempre una freccia scritta dentro al render. Sta in un riferimento, che
 * si aggiorna in silenzio e viene letto solo quando qualcuno preme il pulsante.
 */
export function usaProblema(problema: Problema | null): void {
  const azioni = useContext(ContestoAzioni)
  const chiave = problema?.chiave
  const gravita = problema?.gravita
  const titolo = problema?.titolo
  const dettaglio = problema?.dettaglio
  const nomeAzione = problema?.azione?.nome

  const fai = useRef(problema?.azione?.fai)
  fai.current = problema?.azione?.fai

  const stabile = useCallback(() => fai.current?.(), [])

  useEffect(() => {
    if (!azioni || !chiave || !gravita || !titolo || dettaglio === undefined) return
    azioni.segnala({
      chiave,
      gravita,
      titolo,
      dettaglio,
      ...(nomeAzione ? { azione: { nome: nomeAzione, fai: stabile } } : {})
    })
    return () => azioni.ritira(chiave)
  }, [azioni, chiave, gravita, titolo, dettaglio, nomeAzione, stabile])
}
