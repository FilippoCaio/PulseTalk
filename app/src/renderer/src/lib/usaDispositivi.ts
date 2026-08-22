import { useEffect, useState } from 'react'
import type { Impostazioni } from '@shared/tipi'

/**
 * L'elenco di microfoni, camere e altoparlanti, con i nomi veri.
 *
 * Il giro strano in mezzo non e' superfluo: senza un permesso gia' concesso
 * Chromium restituisce l'elenco giusto ma con le etichette vuote, e le tendine
 * diventano "Dispositivo 1, Dispositivo 2, Dispositivo 3". Si chiede una
 * traccia qualunque, si rilegge l'elenco — che adesso ha i nomi — e la si
 * chiude subito.
 *
 * Sta qui e non dentro alle Impostazioni perche' lo usano in due: il pannello,
 * e il menu del microfono nella barra della chiamata.
 *
 * `nomi: false` salta quel giro. Serve a chi guarda solo gli id — il controllo
 * all'avvio — perche' aprire una traccia costa la spia del microfono accesa
 * per un istante, e vederla lampeggiare ogni volta che parte l'applicazione,
 * senza aver premuto niente, e' esattamente il sospetto che un programma di
 * chiamate non si puo' permettere.
 */
export function usaDispositivi(opzioni?: { nomi?: boolean }): {
  tutti: MediaDeviceInfo[]
  per: (tipo: MediaDeviceKind) => MediaDeviceInfo[]
} {
  const [dispositivi, setDispositivi] = useState<MediaDeviceInfo[]>([])
  const conNomi = opzioni?.nomi !== false

  useEffect(() => {
    let vivo = true

    const carica = async (): Promise<void> => {
      let elenco = await navigator.mediaDevices.enumerateDevices()
      if (conNomi && elenco.some((d) => d.kind !== 'videoinput' && !d.label)) {
        try {
          const prova = await navigator.mediaDevices.getUserMedia({ audio: true })
          for (const t of prova.getTracks()) t.stop()
          elenco = await navigator.mediaDevices.enumerateDevices()
        } catch {
          // Permesso negato: i nomi restano vuoti, ma le tendine funzionano
          // lo stesso e si sceglie per posizione.
        }
      }
      if (vivo) setDispositivi(elenco)
    }

    void carica()

    // Le cuffie USB si attaccano a chiamata iniziata, ed e' proprio il momento
    // in cui uno vuole sceglierle. Senza questo, comparirebbero solo riaprendo
    // l'applicazione.
    navigator.mediaDevices.addEventListener('devicechange', carica)
    return () => {
      vivo = false
      navigator.mediaDevices.removeEventListener('devicechange', carica)
    }
  }, [conNomi])

  return {
    tutti: dispositivi,
    per: (tipo) => dispositivi.filter((d) => d.kind === tipo)
  }
}

// -- La scelta fatta a mano, e cosa succede quando sparisce --------------------

/** I tre dispositivi che si possono scegliere invece di lasciar fare a Windows. */
export type CampoDispositivo = 'microfono' | 'altoparlante' | 'camera'

const CAMPI: Record<
  CampoDispositivo,
  {
    tipo: MediaDeviceKind
    /** Con l'articolo e l'accordo giusti: l'avviso ci costruisce sopra una frase. */
    come: string
    senzaNome: string
    id: (i: Impostazioni) => string | null
    nome: (i: Impostazioni) => string | null
  }
> = {
  microfono: {
    tipo: 'audioinput',
    come: 'Il microfono scelto',
    senzaNome: 'Microfono senza nome',
    id: (i) => i.microfonoId,
    nome: (i) => i.microfonoNome
  },
  altoparlante: {
    tipo: 'audiooutput',
    come: 'Gli altoparlanti scelti',
    senzaNome: 'Uscita senza nome',
    id: (i) => i.altoparlanteId,
    nome: (i) => i.altoparlanteNome
  },
  camera: {
    tipo: 'videoinput',
    come: 'La camera scelta',
    senzaNome: 'Camera senza nome',
    id: (i) => i.cameraId,
    nome: (i) => i.cameraNome
  }
}

const TUTTI_I_CAMPI = ['microfono', 'altoparlante', 'camera'] as const

/**
 * Gli id che non indicano un dispositivo ma una regola.
 *
 * Windows li tiene sempre validi: "default" segue quello scelto nel pannello
 * di sistema, "communications" quello riservato alle chiamate. Non possono
 * sparire, e cercarli nell'elenco per sapere se ci sono ancora non ha senso.
 */
const GENERICI = new Set(['default', 'communications'])

/**
 * Un elenco si puo' confrontare solo se e' quello vero.
 *
 * Senza permesso Chromium risponde lo stesso, ma con una voce segnaposto per
 * tipo: id vuoto, nome vuoto. La' dentro qualunque scelta salvata sembrerebbe
 * sparita, e all'avvio comparirebbe un avviso per dei dispositivi che sono al
 * loro posto. Un avviso che grida al lupo si impara a chiuderlo senza
 * leggerlo, quindi in quel caso si tace.
 */
function attendibile(elenco: MediaDeviceInfo[], tipo: MediaDeviceKind): boolean {
  return elenco.some((d) => d.kind === tipo && d.deviceId && !GENERICI.has(d.deviceId))
}

/**
 * Che fine ha fatto il dispositivo scelto per questo campo.
 *
 *   `nessuno`   non c'era niente da cercare: nessuna scelta, o una che segue
 *               il sistema.
 *   `incerto`   l'elenco non e' attendibile e non si dichiara niente.
 *   `presente`  l'id salvato indica un dispositivo che c'e'.
 *   `ritrovato` quell'id non esiste piu', ma un dispositivo dello stesso tipo
 *               si chiama esattamente come quello scelto: e' lui, con un id
 *               nuovo.
 *   `assente`   staccato davvero.
 */
export type EsitoDispositivo =
  | { stato: 'nessuno' }
  | { stato: 'incerto' }
  | { stato: 'presente'; id: string }
  | { stato: 'ritrovato'; id: string }
  | { stato: 'assente' }

/**
 * Dov'e' finito il dispositivo salvato — e perche' `ritrovato` esiste.
 *
 * `deviceId` non e' l'identificativo dell'hardware: e' un'impronta calcolata
 * su un sale che dipende dall'**origine della pagina**. Cambia l'origine,
 * cambiano tutti gli id in blocco — stesso microfono, stringa diversa — e la
 * scelta salvata ieri non corrisponde piu' a niente. All'app installata
 * succedeva a ogni avvio, perche' si serviva da una porta diversa ogni volta
 * (ora non piu': vedi main/sito.ts). Il risultato era l'avviso "il microfono
 * scelto non risponde" alla partenza, e la stessa camera elencata due volte
 * nella tendina — una presente e una fantasma.
 *
 * Il nome invece e' dell'hardware e non cambia. Se c'e' un dispositivo di quel
 * tipo che si chiama esattamente come quello scelto, e' quello.
 *
 * Uno solo con quel nome, pero'. Con due webcam identiche il nome non
 * distingue piu' niente, e tirare a indovinare fra le due sarebbe peggio che
 * ammettere di non sapere: in quel caso si dichiara `assente` e l'avviso
 * compare, che e' la risposta onesta.
 */
export function risolvi(
  elenco: MediaDeviceInfo[],
  campo: CampoDispositivo,
  impostazioni: Impostazioni
): EsitoDispositivo {
  const c = CAMPI[campo]
  const id = c.id(impostazioni)

  if (!id || GENERICI.has(id)) return { stato: 'nessuno' }
  if (!attendibile(elenco, c.tipo)) return { stato: 'incerto' }
  if (elenco.some((d) => d.kind === c.tipo && d.deviceId === id)) return { stato: 'presente', id }

  const nome = c.nome(impostazioni)
  if (nome) {
    const conEtichetta = elenco.filter((d) => d.kind === c.tipo && d.label)
    // Senza etichette non si distingue "staccato" da "stesso dispositivo con
    // un id nuovo". Dichiarare l'assenza qui vorrebbe dire gridare al lupo
    // proprio nel caso in cui non si sa niente: meglio tacere.
    if (!conEtichetta.length) return { stato: 'incerto' }
    const omonimi = conEtichetta.filter((d) => d.label === nome)
    if (omonimi.length === 1) return { stato: 'ritrovato', id: omonimi[0].deviceId }
  }

  return { stato: 'assente' }
}

/** Se il dispositivo salvato per quel campo adesso non c'e' davvero. */
function assente(
  elenco: MediaDeviceInfo[],
  campo: CampoDispositivo,
  impostazioni: Impostazioni
): boolean {
  return risolvi(elenco, campo, impostazioni).stato === 'assente'
}

/**
 * Cosa salvare scegliendo un dispositivo: l'id, e accanto il suo nome.
 *
 * Il nome non serve a farlo funzionare — per quello basta l'id — ma a poterlo
 * nominare il giorno in cui non c'e' piu'. Gli id sono stringhe lunghe che non
 * vogliono dire niente: "il microfono scelto non risponde" fa alzare le
 * spalle, "le Cuffie USB non rispondono" si capisce da solo. E serve anche
 * quando Chromium consegna l'elenco senza etichette, perche' il nome buono lo
 * avevamo in mano al momento della scelta.
 */
export function scegli(
  campo: CampoDispositivo,
  elenco: MediaDeviceInfo[],
  valore: string
): Partial<Impostazioni> {
  const id = valore || null
  const nome = (id && elenco.find((d) => d.deviceId === id)?.label) || null

  if (campo === 'microfono') return { microfonoId: id, microfonoNome: nome }
  if (campo === 'altoparlante') return { altoparlanteId: id, altoparlanteNome: nome }
  return { cameraId: id, cameraNome: nome }
}

/**
 * Le voci di una tendina: i dispositivi presenti, piu' quello salvato se non
 * c'e' piu'.
 *
 * Quella voce in coda evita una bugia. Un select il cui valore non compare fra
 * le opzioni non resta vuoto: mostra la prima, cioe' "Predefinito di Windows"
 * — e chi arriva qui dall'avviso leggerebbe che va tutto bene proprio dove gli
 * abbiamo appena detto il contrario. Disabilitata, perche' sceglierla di nuovo
 * non porterebbe da nessuna parte.
 */
export function vociTendina(
  campo: CampoDispositivo,
  elenco: MediaDeviceInfo[],
  impostazioni: Impostazioni
): Array<{ id: string; nome: string; assente: boolean }> {
  const c = CAMPI[campo]
  const voci = elenco
    .filter((d) => d.kind === c.tipo)
    .map((d) => ({ id: d.deviceId, nome: d.label || c.senzaNome, assente: false }))

  if (assente(elenco, campo, impostazioni)) {
    voci.push({
      id: c.id(impostazioni)!,
      nome: `${c.nome(impostazioni) ?? c.senzaNome} — non collegato`,
      assente: true
    })
  }

  return voci
}

export interface DispositivoMancante {
  campo: CampoDispositivo
  /** "Il microfono scelto", pronto per entrare in una frase. */
  come: string
  /** Il nome con cui era stato scelto, se lo si era salvato. */
  nome: string | null
}

/**
 * I dispositivi scelti a mano che adesso non rispondono.
 *
 * Serve all'apertura dell'app, ed e' la meta' che mancava: l'id del microfono
 * scelto era gia' salvato e gia' riletto, ma nessuno controllava che quel
 * dispositivo ci fosse ancora. Staccate le cuffie, Chromium ripiega in
 * silenzio sul predefinito — e si parla nel microfono sbagliato senza che
 * niente lo dica.
 *
 * Cio' che e' salvato non si tocca: ricollegando le cuffie la scelta torna al
 * suo posto da sola. Ripiegare sul predefinito e scriverlo su disco vorrebbe
 * dire ritrovarsi la tendina cambiata al ritorno, senza averla mai toccata.
 *
 * Qui gli id bastano, e i nomi non si vanno a cercare: quello del dispositivo
 * mancante ce l'abbiamo salvato da quando lo si era scelto, ed e' l'unico che
 * serve — l'elenco senza etichette dice comunque cosa c'e' e cosa no.
 */
export function usaDispositiviMancanti(impostazioni: Impostazioni | null): DispositivoMancante[] {
  const { tutti } = usaDispositivi({ nomi: false })
  if (!impostazioni) return []

  return TUTTI_I_CAMPI.filter((campo) => assente(tutti, campo, impostazioni)).map((campo) => ({
    campo,
    come: CAMPI[campo].come,
    nome: CAMPI[campo].nome(impostazioni)
  }))
}

/**
 * L'avviso, in italiano, al singolare o al plurale.
 *
 * Sta qui accanto a chi conosce i campi: la frase cambia con l'accordo — "il
 * microfono scelto non risponde", "la camera scelta non risponde" — e comporla
 * nel componente vorrebbe dire portarsi dietro i generi.
 */
export function fraseMancanti(mancanti: DispositivoMancante[]): string {
  const pezzi = mancanti
    .map((m) => (m.nome ? `${m.come} (${m.nome})` : m.come))
    // Solo il primo tiene la maiuscola: gli altri entrano in mezzo alla frase.
    .map((t, i) => (i === 0 ? t : t.charAt(0).toLowerCase() + t.slice(1)))

  return pezzi.length === 1
    ? `${pezzi[0]} non risponde: al suo posto sta andando il predefinito di Windows. La scelta resta salvata — ricollegandolo, torna com'era.`
    : `${pezzi.join(' e ')} non rispondono: al loro posto stanno andando i predefiniti di Windows. Le scelte restano salvate — ricollegandoli, tornano come erano.`
}

/**
 * Rimette a posto gli id salvati quando l'unica cosa cambiata e' l'id.
 *
 * Non e' la stessa cosa di `usaDispositiviMancanti`, che avvisa e non tocca
 * niente. La' il dispositivo e' staccato davvero e la scelta va lasciata dov'e',
 * perche' ricollegandolo deve tornare da sola. Qui invece il dispositivo e'
 * attaccato e funziona: e' cambiata solo la stringa con cui Chromium lo chiama,
 * ed e' una stringa che non ha nessun valore da conservare (vedi `risolvi`).
 *
 * Riscriverla e' l'unico modo perche' la scelta continui a valere: tutto il
 * resto dell'applicazione apre le tracce con l'id salvato, e un id che non
 * esiste piu' fa ripiegare Chromium sul predefinito senza dire niente.
 *
 * Gira una volta per elenco: quando l'id salvato e' gia' giusto non scrive
 * niente e non c'e' nessun ciclo da rompere.
 */
export function usaRiallineaDispositivi(
  impostazioni: Impostazioni | null,
  salva: (modifiche: Partial<Impostazioni>) => Promise<unknown>
): void {
  const { tutti } = usaDispositivi({ nomi: false })

  useEffect(() => {
    if (!impostazioni || !tutti.length) return

    let modifiche: Partial<Impostazioni> = {}
    for (const campo of TUTTI_I_CAMPI) {
      const esito = risolvi(tutti, campo, impostazioni)
      if (esito.stato !== 'ritrovato') continue
      // Il nome resta quello salvato: e' lo stesso, ed e' cio' che ha permesso
      // di ritrovarlo.
      modifiche = { ...modifiche, ...scegli(campo, tutti, esito.id) }
    }

    if (Object.keys(modifiche).length) void salva(modifiche)
  }, [tutti, impostazioni, salva])
}

/**
 * L'id da passare davvero a `getUserMedia`, risolto sul momento.
 *
 * Serve perche' `deviceId` in una richiesta di cattura e' una *preferenza*,
 * non un vincolo: se l'id non esiste piu', Chromium non protesta — apre il
 * predefinito di sistema e non lo dice a nessuno. Il risultato e' il peggiore
 * possibile: le impostazioni mostrano il microfono giusto, e a parlare e' un
 * altro. Nemmeno riscegliere lo stesso dispositivo dal menu rapido lo
 * sistemava, perche' il valore non cambiava e quindi non ripartiva niente.
 *
 * Qui l'elenco si chiede nell'istante in cui serve, che e' anche l'unico
 * istante in cui e' sicuramente completo: si sta per aprire una traccia, quindi
 * il permesso c'e' e le etichette pure. Se l'id salvato c'e' ancora si usa
 * quello; se non c'e' ma il nome combacia con un dispositivo solo, si usa il
 * suo; altrimenti si lascia decidere il sistema, che e' cio' che sarebbe
 * successo comunque, ma stavolta per scelta.
 */
/**
 * Apre il microfono scelto — e se non ci riesce lo dice, invece di cambiarlo.
 *
 * Sta qui, e non dentro a chi cattura, perche' i posti che aprono un microfono
 * sono due e devono aprire lo STESSO: la catena della chiamata e la prova nelle
 * impostazioni. Quando erano due strade separate si poteva regolare la soglia
 * guardando la barra di un dispositivo e poi parlare in un altro.
 *
 * Il nocciolo e' che `deviceId: "abc"` dentro a una richiesta di cattura e' una
 * *preferenza*, non un vincolo. Se quell'id non indica piu' niente Chromium non
 * protesta: apre il predefinito di sistema, restituisce una traccia
 * perfettamente funzionante, e non lo dice a nessuno. Le impostazioni
 * continuano a mostrare il microfono scelto e a parlare e' un altro — che e' il
 * modo peggiore in cui una cosa puo' non funzionare, perche' non si vede da
 * nessuna parte.
 *
 * `exact` trasforma quella sostituzione silenziosa in un errore, ed e' l'unica
 * forma in cui la si puo' prendere in mano. Il ripiego sul predefinito resta,
 * perche' restare muti sarebbe peggio che parlare nel microfono sbagliato — ma
 * adesso e' una decisione presa qui, e chi chiama la vede in `ripiegato` invece
 * di non saperne niente.
 */
export async function apriMicrofonoScelto(
  vincoli: MediaTrackConstraints,
  id: string | null,
  nome: string | null
): Promise<{ flusso: MediaStream; ripiegato: boolean }> {
  const scelto = await idDaAprire('microfono', id, nome)

  // Nessuna scelta da rispettare: si vuole il predefinito, e il predefinito non
  // puo' mancare.
  if (!scelto) {
    return { flusso: await navigator.mediaDevices.getUserMedia({ audio: vincoli }), ripiegato: false }
  }

  try {
    const flusso = await navigator.mediaDevices.getUserMedia({
      audio: { ...vincoli, deviceId: { exact: scelto } }
    })
    return { flusso, ripiegato: false }
  } catch (errore) {
    const quale = (errore as Error).name
    // Solo il dispositivo che non c'e'. Un permesso negato o un microfono gia'
    // occupato da un altro programma non si risolvono cambiando dispositivo, e
    // vanno detti a chi ha premuto invece che nascosti dietro a un ripiego.
    if (quale !== 'OverconstrainedError' && quale !== 'NotFoundError') throw errore

    const { deviceId: _scartato, ...senzaDispositivo } = vincoli
    return {
      flusso: await navigator.mediaDevices.getUserMedia({ audio: senzaDispositivo }),
      ripiegato: true
    }
  }
}

export async function idDaAprire(
  campo: CampoDispositivo,
  id: string | null,
  nome: string | null
): Promise<string | undefined> {
  if (!id || GENERICI.has(id)) return undefined

  let elenco: MediaDeviceInfo[]
  try {
    elenco = await navigator.mediaDevices.enumerateDevices()
  } catch {
    // Se non si riesce nemmeno a chiedere l'elenco, tanto vale provare con
    // quello che si ha: peggio di com'era non puo' andare.
    return id
  }

  const tipo = CAMPI[campo].tipo
  if (elenco.some((d) => d.kind === tipo && d.deviceId === id)) return id

  if (nome) {
    const omonimi = elenco.filter((d) => d.kind === tipo && d.label === nome)
    if (omonimi.length === 1) return omonimi[0].deviceId
  }

  return undefined
}
