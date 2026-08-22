import { useEffect, useRef, useState } from 'react'
import { avviaProva, type Prova } from './provaMicrofono'
import { catenaViva, livelloMicrofono, microfonoPassa } from './pubblica'

/**
 * Il livello del microfono, da qualunque parte arrivi.
 *
 * Due sorgenti e una regola sola: **mai due catture dello stesso dispositivo**.
 *
 *   in chiamata   il microfono e' gia' aperto e la sua catena ha gia' un
 *                 analizzatore prima del guadagno. Si legge quello. Aprire un
 *                 secondo getUserMedia sullo stesso dispositivo, su Windows,
 *                 non e' solo spreco: certe schede lo consegnano con impostazioni
 *                 diverse, e il misuratore mostrerebbe un livello che non e'
 *                 quello che sta uscendo davvero.
 *
 *   fuori         non c'e' nessuna catena, quindi se ne apre una di prova. E'
 *                 il caso di chi regola la soglia prima di entrare da qualche
 *                 parte, che e' poi il momento in cui uno la regola.
 *
 * Il valore NON passa da uno stato React. Chi disegna riceve un `attacca` da
 * mettere sulla barra e la muove scrivendo `style.width` a ogni fotogramma:
 * sessanta `setState` al secondo per un rettangolo che si allunga farebbero
 * ridisegnare l'intero pannello delle impostazioni sessanta volte al secondo,
 * cursori compresi.
 */
export interface Misuratore {
  /** Il livello adesso, da 0 a 1. Da leggere dentro a un requestAnimationFrame. */
  livello(): number
  /** Se il cancello dell'automute sta lasciando passare la voce. */
  passa(): boolean
  /** Vero quando si sta usando il microfono della chiamata invece di uno nuovo. */
  daChiamata: boolean
  chiudi(): Promise<void>
}

/**
 * Quanto il cancello resta aperto dopo l'ultima sillaba sopra soglia.
 *
 * Lo stesso valore della catena vera (pubblica.ts): il misuratore deve mostrare
 * la stessa cosa che succede, non una sua approssimazione piu' nervosa.
 */
const CODA_MS = 350

export async function apriMisuratore(
  dispositivoId: string | null,
  dispositivoNome: string | null,
  soglia: () => number
): Promise<Misuratore> {
  if (catenaViva()) {
    return {
      livello: livelloMicrofono,
      passa: microfonoPassa,
      daChiamata: true,
      // Non si chiude niente: quella catena e' della chiamata, e spegnerla
      // qui vorrebbe dire zittire chi sta parlando per aver chiuso un pannello.
      async chiudi() {}
    }
  }

  const prova: Prova = await avviaProva(dispositivoId, dispositivoNome)
  let apertoFino = 0

  return {
    livello() {
      const valore = prova.livello()
      if (valore >= soglia() && soglia() > 0) apertoFino = performance.now() + CODA_MS
      return valore
    },
    passa() {
      return soglia() <= 0 || performance.now() < apertoFino
    },
    daChiamata: false,
    chiudi: () => prova.chiudi()
  }
}

/**
 * Il misuratore acceso finche' serve, con il ritorno in cuffia.
 *
 * `attivo` decide se sta aperto. Il ritorno ("sentiti") esiste solo sulla
 * catena di prova: durante una chiamata mandarsi il proprio microfono in cuffia
 * significherebbe sentirsi due volte, una dalla catena e una dal ritorno della
 * stanza.
 */
export function usaMisuratore(
  attivo: boolean,
  dispositivoId: string | null,
  dispositivoNome: string | null,
  soglia: number
): {
  misuratore: Misuratore | null
  errore: string | null
} {
  const [misuratore, setMisuratore] = useState<Misuratore | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  // La soglia cambia mentre il misuratore e' aperto: si legge da un ref, cosi'
  // spostare il cursore non richiude e riapre il microfono a ogni pixel.
  const sogliaRef = useRef(soglia)
  sogliaRef.current = soglia

  useEffect(() => {
    if (!attivo) return

    let vivo = true
    let aperto: Misuratore | null = null

    void apriMisuratore(dispositivoId, dispositivoNome, () => sogliaRef.current)
      .then((nuovo) => {
        aperto = nuovo
        // Chiuso mentre si apriva: si spegne subito, o resterebbe acceso il
        // microfono di un pannello che non c'e' piu'.
        if (!vivo) return void nuovo.chiudi()
        setMisuratore(nuovo)
        setErrore(null)
      })
      .catch((e) => {
        if (vivo) setErrore((e as Error).message)
      })

    return () => {
      vivo = false
      setMisuratore(null)
      void aperto?.chiudi()
    }
  }, [attivo, dispositivoId, dispositivoNome])

  return { misuratore, errore }
}
