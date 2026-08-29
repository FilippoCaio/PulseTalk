import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from './api'
import type { CompatibilitaClient, StatoAggiornamento } from '@shared/tipi'
import { ponte } from '../ponte'

/**
 * Gli aggiornamenti visti dall'interfaccia.
 *
 * Il lavoro vero lo fa il processo principale (`main/aggiorna.ts`): scarica,
 * verifica la firma, installa. Qui si tengono due cose sole — lo stato, e il
 * vincolo che il server dichiara — perche' vanno guardate da tre posti diversi
 * (l'avviso in alto, il pannello delle impostazioni, il blocco prima
 * dell'accesso) e tre copie dello stesso abbonamento darebbero tre verita'
 * leggermente diverse.
 *
 * Il controllo all'avvio lo fa gia' il processo principale appena la finestra
 * e' pronta: qui non si ricontrolla niente, ci si limita ad ascoltare.
 */
export interface Aggiornamenti {
  /** Nullo nel browser, dove non c'e' niente da aggiornare. */
  stato: StatoAggiornamento | null
  /** Cosa pretende il server, quando ha risposto. */
  vincolo: CompatibilitaClient | null
  scarica: () => void
  installa: () => void
  controlla: () => void
}

export function usaAggiornamenti(api: Api | null): Aggiornamenti {
  const aggiornamenti = ponte.aggiornamenti
  const [stato, setStato] = useState<StatoAggiornamento | null>(null)
  const [vincolo, setVincolo] = useState<CompatibilitaClient | null>(null)
  /**
   * Il server a cui si e' gia' chiesto.
   *
   * Non basta la dipendenza dell'effetto: `api` e' un oggetto nuovo a ogni
   * cambio di token, e senza questa memoria si rifarebbe la domanda a ogni
   * rinnovo — che nel caso obbligatorio vuol dire far ripartire un download.
   */
  const chiesto = useRef<string | null>(null)

  useEffect(() => {
    if (!aggiornamenti) return
    void aggiornamenti.stato().then(setStato)
    return aggiornamenti.ascolta(setStato)
  }, [aggiornamenti])

  /**
   * Cosa pretende questo server, e il suo feed.
   *
   * La rotta e' pubblica apposta — si interroga prima di qualunque
   * autenticazione — perche' la risposta puo' essere "questa versione qui non
   * entra". Nel browser non si chiede niente: la pagina e' sempre l'ultima
   * versione per costruzione, ed e' l'unico posto dove il problema non esiste.
   *
   * `prepara` nel processo principale ha gia' la sua guardia contro le
   * chiamate doppie: se il controllo all'avvio sta ancora girando, questo si
   * attacca a quello invece di aprire un secondo download sullo stesso file.
   */
  useEffect(() => {
    if (!api || !aggiornamenti) return
    if (chiesto.current === api.base) return
    chiesto.current = api.base

    let vivo = true
    void (async () => {
      try {
        const info = await ponte.informazioniClient()
        if (!info || !vivo) return
        const risposta = await api.compatibilitaClient(info)
        if (!vivo) return
        setVincolo(risposta)
        await aggiornamenti.prepara({
          feedUrl: risposta.feedUrl,
          versioneTarget: risposta.versioneTarget,
          versioneMassima: risposta.versioneMassima,
          obbligatorio: risposta.obbligatorio
        })
      } catch {
        // Un server vecchio che non conosce la rotta, o irraggiungibile: si
        // continua con il feed scritto dentro all'installer, che e' cio' che
        // il controllo all'avvio sta gia' usando. Un errore qui non e' un
        // guasto dell'applicazione ed e' sbagliato mostrarlo come tale.
        if (vivo) chiesto.current = null
      }
    })()

    return () => {
      vivo = false
    }
  }, [api, aggiornamenti])

  const scarica = useCallback(() => void aggiornamenti?.scarica(), [aggiornamenti])
  const installa = useCallback(() => void aggiornamenti?.installa(), [aggiornamenti])
  const controlla = useCallback(() => void aggiornamenti?.controlla(), [aggiornamenti])

  return { stato, vincolo, scarica, installa, controlla }
}

/**
 * La frase che descrive una fase, in italiano e senza gergo.
 *
 * Sta qui e non dentro al componente perche' la leggono in due — l'avviso e il
 * pannello — e due frasi diverse per lo stesso stato sono il modo piu' rapido
 * di far credere che siano due stati diversi.
 */
export function fraseAggiornamento(stato: StatoAggiornamento): string {
  switch (stato.fase) {
    case 'controllo':
      return 'Controllo se c\'e\' una versione nuova…'
    case 'disponibile':
      return `C'e' la ${stato.disponibile}. La tua e' la ${stato.versione}.`
    case 'scarico':
      return `Scarico la ${stato.disponibile ?? 'nuova versione'}…`
    case 'pronto':
      return `La ${stato.disponibile ?? 'nuova versione'} e' pronta.`
    case 'aggiornato':
      return 'Sei all\'ultima versione.'
    case 'errore':
      return stato.errore ?? 'Non sono riuscito a controllare.'
    case 'nonSupportato':
      return 'Questa e\' la versione portabile: si aggiorna sostituendo il file, che e\' poi il motivo per cui esiste un portabile.'
    default:
      return `Stai usando la versione ${stato.versione}.`
  }
}
