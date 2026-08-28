import { useEffect, useState } from 'react'
import type { Canale, Spazio } from '@shared/tipi'
import { puo } from '@shared/permessi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Avviso, Bottone, Campo, classiInput } from '../ui'
import {
  Altoparlante,
  Cancelletto,
  Chevron,
  Cestino,
  Chiudi,
  Cuffie,
  Esci,
  Lente,
  Lucchetto,
  Matita,
  CuffieSpente,
  MicrofonoSpento,
  Piu,
  SchermoCondividi,
  Spunta,
  Utenti
} from '../icone'

/**
 * La colonna dei canali.
 *
 * Sotto ai canali vocali compare chi c'e' dentro, com'e' giusto che sia: la
 * domanda vera guardando quella colonna non e' "quali canali esistono" ma
 * "dove sono gli altri". Con i nomi visibili si entra dove c'e' qualcuno senza
 * doverci entrare per scoprirlo.
 */
export default function ColonnaCanali({
  spazio,
  apertoId,
  inVoce,
  scegli,
  entraInVoce,
  esciDallaVoce,
  crea,
  elimina,
  modificaCanale,
  apriRicerca,
  gestisciIscritti,
  profili,
  microfoniSpenti,
  sordine,
  parlanti,
  menu,
  menuAperto = false,
  alternaMenu
}: {
  spazio: Spazio
  apertoId: number | null
  /** Il canale vocale in cui si sta parlando adesso, se ce n'e' uno. */
  inVoce: number | null
  scegli: (canale: Canale) => void
  entraInVoce: (canale: Canale) => void
  esciDallaVoce: () => void
  crea: (dati: {
    nome: string
    tipo: 'testo' | 'voce'
    soloAscolto: boolean
    privato: boolean
    durataMinuti: number | null
  }) => Promise<void>
  elimina: (canale: Canale) => Promise<void>
  /** Rinomina, cambia icona e argomento. */
  modificaCanale: (
    canale: Canale,
    modifiche: { nome: string; icona: string; argomento: string; durataMinuti?: number | null }
  ) => Promise<void>
  apriRicerca: () => void
  /** Apre l'elenco di chi sta dentro a un canale privato. */
  gestisciIscritti: (canale: Canale) => void
  /**
   * Nome e foto di ognuno, per id.
   *
   * Le presenze che arrivano dal server portano solo il nome: la foto sta qui,
   * ed e' il motivo per cui prima in questa colonna si vedevano le iniziali
   * anche a chi un'immagine ce l'aveva caricata.
   */
  profili?: Map<number, { nome: string; avatar: string | null }>
  /**
   * Chi ha il microfono spento adesso, dal vivo.
   *
   * Ha la precedenza su quello che dicono le presenze: quelle vengono da una
   * fotografia della SFU che non si riscatta a ogni muto, e mostrare il
   * simbolo sulla persona sbagliata e' peggio che non mostrarlo.
   */
  microfoniSpenti?: Set<string>
  /**
   * Chi ha spento tutto: non sente e non parla.
   *
   * Separata dai microfoni spenti perche' le due cose insieme dicono una terza
   * cosa. Il microfono barrato da solo e' "adesso non parla"; le cuffie barrate
   * accanto sono "non e' qui": puo' restarci mezz'ora senza accorgersi di
   * niente, e chi glielo sta chiedendo dall'altra parte deve poterlo vedere
   * prima di ripetere la domanda tre volte.
   */
  sordine?: Set<string>
  /**
   * Chi sta parlando adesso, per identita'.
   *
   * Arriva dalla sessione vocale, che vive in App e continua a girare anche
   * mentre si legge una chat. E' l'unico modo per sapere chi sta parlando senza
   * tornare a guardare la griglia — che e' esattamente il momento in cui uno
   * vorrebbe saperlo.
   */
  parlanti?: Set<string>
  /**
   * Il menu del server, gia' costruito da chi sta sopra.
   *
   * Arriva come nodo invece che come elenco di richiami: le sue voci
   * dipendono da cose che questa colonna non ha — le impostazioni locali, gli
   * eventi, il pannello di gestione — e passarle tutte una per una avrebbe
   * fatto crescere questa firma di dieci righe per un pulsante.
   */
  menu?: React.ReactNode
  menuAperto?: boolean
  alternaMenu?: () => void
}): React.JSX.Element {
  const [creando, setCreando] = useState<'testo' | 'voce' | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  // I pulsanti seguono i permessi risolti dal server, non il ruolo grosso:
  // chi puo' creare canali di testo ma non vocali vede un pulsante solo.
  const amministra = spazio.ruoloMio === 'admin'
  const puoCreareTesto = puo(spazio.permessiMiei, 'createTextChannels')
  const puoCreareVoce = puo(spazio.permessiMiei, 'createVoiceChannels')
  const perCategoria = (id: number | null): Canale[] =>
    spazio.canali.filter((c) => c.categoria === id).sort((a, b) => a.posizione - b.posizione)

  const gruppi: { id: number | null; nome: string | null; canali: Canale[] }[] = [
    { id: null, nome: null, canali: perCategoria(null) },
    ...spazio.categorie
      .slice()
      .sort((a, b) => a.posizione - b.posizione)
      .map((c) => ({ id: c.id, nome: c.nome, canali: perCategoria(c.id) }))
  ]

  return (
    // `flex-1` e non un'altezza propria: la colonna deve occupare tutto quello
    // che resta fino in fondo, con la barra della voce appoggiata sotto. Con
    // l'altezza data dal contenuto si fermava dov'era finito l'ultimo canale, e
    // sotto restava un rettangolo vuoto con il bordo interrotto a meta'.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* `relative` e' l'ancora del menu del server, che scende da qui. */}
      <header className="relative flex items-center justify-between gap-2 border-b border-bordo px-4 py-3">
        {/* Il nome del server e' anche il pulsante del suo menu: e' il posto in
            cui la mano va da sola, ed e' come funziona ovunque. */}
        <button
          onClick={alternaMenu}
          disabled={!alternaMenu}
          title={alternaMenu ? `Impostazioni di ${spazio.nome}` : spazio.nome}
          aria-haspopup={alternaMenu ? 'menu' : undefined}
          aria-expanded={alternaMenu ? menuAperto : undefined}
          data-menu-spazio-trigger
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          <h2 className="min-w-0 truncate font-medium">{spazio.nome}</h2>
          {alternaMenu && (
            <Chevron
              className={`h-3.5 w-3.5 shrink-0 text-testo-3 transition-transform ${
                menuAperto ? 'rotate-180' : ''
              }`}
            />
          )}
        </button>
        <button
          onClick={apriRicerca}
          title="Cerca nei messaggi"
          aria-label="Cerca nei messaggi"
          className="shrink-0 text-testo-3 hover:text-testo"
        >
          <Lente className="h-4 w-4" />
        </button>

        {menuAperto && menu}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {errore && <Avviso>{errore}</Avviso>}

        {gruppi.map((gruppo) =>
          gruppo.canali.length === 0 && gruppo.id !== null ? null : (
            <section key={gruppo.id ?? 'sciolti'} className="mb-3">
              {gruppo.nome && (
                <p className="px-2 py-1 text-[11px] font-semibold tracking-wider text-testo-3 uppercase">
                  {gruppo.nome}
                </p>
              )}

              {gruppo.canali.map((canale) => (
                <RigaCanale
                  key={canale.id}
                  canale={canale}
                  aperto={canale.id === apertoId}
                  inVoce={canale.id === inVoce}
                  amministra={amministra}
                  scegli={() => (canale.tipo === 'voce' ? entraInVoce(canale) : scegli(canale))}
                  esci={esciDallaVoce}
                  gestisciIscritti={() => gestisciIscritti(canale)}
                  modifica={(m) => modificaCanale(canale, m)}
                  profili={profili}
                  microfoniSpenti={canale.id === inVoce ? microfoniSpenti : undefined}
                  sordine={canale.id === inVoce ? sordine : undefined}
                  parlanti={canale.id === inVoce ? parlanti : undefined}
                  elimina={async () => {
                    try {
                      await elimina(canale)
                    } catch (e) {
                      setErrore((e as Error).message)
                    }
                  }}
                />
              ))}
            </section>
          )
        )}

        {(puoCreareTesto || puoCreareVoce) && (
          <div className="mt-2 flex gap-1 px-1">
            {puoCreareTesto && (
            <button
              onClick={() => setCreando('testo')}
              title="Nuovo canale di testo"
              aria-label="Nuovo canale di testo"
              className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-dashed border-bordo py-1.5 text-testo-3 hover:border-vivo hover:text-vivo"
            >
              <Piu className="h-3.5 w-3.5" />
              <Cancelletto className="h-4 w-4" />
            </button>
            )}
            {puoCreareVoce && (
            <button
              onClick={() => setCreando('voce')}
              title="Nuovo canale vocale"
              aria-label="Nuovo canale vocale"
              className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-dashed border-bordo py-1.5 text-testo-3 hover:border-vivo hover:text-vivo"
            >
              <Piu className="h-3.5 w-3.5" />
              <Altoparlante className="h-4 w-4" />
            </button>
            )}
          </div>
        )}
      </div>

      {creando && (
        <ModuloCanale
          tipo={creando}
          chiudi={() => setCreando(null)}
          crea={async (dati) => {
            try {
              await crea(dati)
              setCreando(null)
            } catch (e) {
              setErrore((e as Error).message)
            }
          }}
        />
      )}
    </div>
  )
}

function RigaCanale({
  canale,
  aperto,
  inVoce,
  amministra,
  scegli,
  esci,
  elimina,
  gestisciIscritti,
  modifica,
  profili,
  microfoniSpenti,
  sordine,
  parlanti
}: {
  canale: Canale
  aperto: boolean
  inVoce: boolean
  amministra: boolean
  scegli: () => void
  esci: () => void
  elimina: () => Promise<void>
  gestisciIscritti: () => void
  modifica: (m: { nome: string; icona: string; argomento: string; durataMinuti?: number | null }) => Promise<void>
  profili?: Map<number, { nome: string; avatar: string | null }>
  microfoniSpenti?: Set<string>
  /** Valorizzata solo per il canale in cui si sta parlando adesso. */
  sordine?: Set<string>
  /** Valorizzato solo per il canale in cui si sta parlando adesso. */
  parlanti?: Set<string>
}): React.JSX.Element {
  const [conferma, setConferma] = useState(false)
  const [modificaAperta, setModificaAperta] = useState(false)

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          aperto ? 'bg-fondo-3 text-testo' : 'text-testo-2 hover:bg-fondo-3/60 hover:text-testo'
        }`}
      >
        <button onClick={scegli} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {/* L'icona scelta prende il posto del simbolo del tipo. Il tipo
              resta leggibile lo stesso: un canale vocale ha le persone
              elencate sotto, e uno di testo no. */}
          <span className="shrink-0 text-testo-3">
            {canale.icona ? (
              <span className="block w-4 text-center text-sm leading-4">{canale.icona}</span>
            ) : canale.tipo === 'voce' ? (
              <Altoparlante className="h-4 w-4" />
            ) : (
              <Cancelletto className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{canale.nome}</span>
          {typeof canale.restanoMs === 'number' && Number.isFinite(canale.restanoMs) && (
            <ScadenzaCanale restanoMs={canale.restanoMs} />
          )}
          {canale.privato && (
            <span title="Privato: lo vedono solo gli invitati" className="shrink-0 text-attenzione">
              <Lucchetto className="h-3 w-3" />
            </span>
          )}
          {canale.soloAscolto && (
            <span className="shrink-0 text-attenzione" title="Palco: parlano gli admin, gli altri ascoltano">
              <Cuffie className="h-3.5 w-3.5" />
            </span>
          )}
          {canale.nonLetti > 0 && (
            <span className="numeri shrink-0 rounded-full bg-vivo px-1.5 py-0.5 text-[10px] font-semibold text-fondo">
              {canale.nonLetti > 99 ? '99+' : canale.nonLetti}
            </span>
          )}
        </button>

        {inVoce && (
          <button
            onClick={esci}
            title="Esci dal canale vocale"
            aria-label="Esci dal canale vocale"
            className="shrink-0 text-male opacity-0 group-hover:opacity-100"
          >
            <Esci className="h-4 w-4" />
          </button>
        )}

        {canale.privato && (
          <button
            onClick={gestisciIscritti}
            title={`Chi puo' vedere ${canale.nome}`}
            aria-label={`Chi puo' vedere ${canale.nome}`}
            className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-testo"
          >
            <Utenti className="h-4 w-4" />
          </button>
        )}

        {amministra && !inVoce && !conferma && (
          <button
            onClick={() => setModificaAperta(true)}
            title={`Modifica ${canale.nome}`}
            aria-label={`Modifica ${canale.nome}`}
            className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-testo"
          >
            <Matita className="h-4 w-4" />
          </button>
        )}

        {amministra &&
          !inVoce &&
          (conferma ? (
            <span className="flex shrink-0 gap-1">
              <button
                className="text-male"
                onClick={() => void elimina()}
                title={`Elimina ${canale.nome}: non si torna indietro`}
                aria-label={`Elimina ${canale.nome}`}
              >
                <Spunta className="h-4 w-4" />
              </button>
              <button
                className="text-testo-3 hover:text-testo"
                onClick={() => setConferma(false)}
                title="Lascia stare"
                aria-label="Lascia stare"
              >
                <Chiudi className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConferma(true)}
              title={`Elimina il canale ${canale.nome}`}
              aria-label={`Elimina il canale ${canale.nome}`}
              className="shrink-0 text-testo-3 opacity-0 group-hover:opacity-100 hover:text-male"
            >
              <Cestino className="h-4 w-4" />
            </button>
          ))}
      </div>

      {modifica && modificaAperta && (
        <ModuloModifica
          canale={canale}
          salva={async (m) => {
            await modifica(m)
            setModificaAperta(false)
          }}
          annulla={() => setModificaAperta(false)}
        />
      )}

      {/* Chi sta dentro al canale vocale, sotto al suo nome.
          Aria fra una riga e l'altra, e non per gusto: senza, le pastiglie
          colorate si toccano e l'elenco diventa una colonna unica di colore in
          cui le facce non si distinguono piu' l'una dall'altra. */}
      {canale.tipo === 'voce' && canale.presenti.length > 0 && (
        <div className="mt-1 mb-2 ml-6 space-y-2">
          {canale.presenti.map((persona) => {
            // L'identita' sulla SFU e' `u<id>`: e' l'unica chiave su cui una
            // presenza e un profilo combaciano.
            const foto = profili?.get(Number(persona.identita.slice(1)))?.avatar ?? null
            const parla = parlanti?.has(persona.identita) ?? false
            const sordo = sordine?.has(persona.identita) ?? false

            return (
            <div key={persona.identita} className="flex items-center gap-2 text-xs text-testo-2">
              {/* L'anello sta DENTRO l'icona, non fuori.
                  
                  Fuori — con ring-offset — ogni faccia si portava dietro due
                  pixel di corona, e con tre persone che parlano insieme le
                  corone si toccavano fra loro e con i nomi. Dentro occupa
                  zero spazio in piu': l'elenco non si muove quando qualcuno
                  attacca a parlare.
                  
                  E' un elemento sovrapposto e non un `ring-inset`, perche' un
                  bordo interno disegnato con l'ombra finisce sotto al
                  contenuto e su una foto profilo non si vedrebbe. */}
              <span className="relative h-6 w-6 shrink-0">
              {foto ? (
                <img
                  src={foto}
                  alt=""
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-black/75"
                  style={{ background: coloreDi(persona.identita) }}
                >
                  {inizialiDi(persona.nome)}
                </span>
              )}
                <span
                  className={`pointer-events-none absolute inset-0 rounded-full border-2 transition-colors duration-100 ${
                    parla ? 'border-ok' : 'border-transparent'
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{persona.nome}</span>
              {(microfoniSpenti ? microfoniSpenti.has(persona.identita) : !persona.microfono) && (
                <span
                  className={`shrink-0 ${sordo ? 'text-male/70' : 'text-testo-3'}`}
                  title={sordo ? 'Non parla e non sente' : 'Microfono spento'}
                >
                  <MicrofonoSpento className="h-3.5 w-3.5" />
                </span>
              )}
              {/* Le due insieme, e in quest'ordine: prima cio' che non esce,
                  poi cio' che non entra. Una sola delle due si legge male —
                  il microfono barrato da solo e' uno che sta ascoltando — e
                  sono proprio le due insieme a dire l'unica cosa che serve
                  sapere: che non e' il caso di parlargli. */}
              {sordo && (
                <span className="shrink-0 text-male/70" title="Non parla e non sente">
                  <CuffieSpente className="h-3.5 w-3.5" />
                </span>
              )}
              {persona.schermi > 0 && (
                <span className="shrink-0 text-ok" title="Sta condividendo">
                  <SchermoCondividi className="h-3.5 w-3.5" />
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

function ModuloCanale({
  tipo,
  crea,
  chiudi
}: {
  tipo: 'testo' | 'voce'
  crea: (dati: {
    nome: string
    tipo: 'testo' | 'voce'
    soloAscolto: boolean
    privato: boolean
    durataMinuti: number | null
  }) => Promise<void>
  chiudi: () => void
}): React.JSX.Element {
  const [nome, setNome] = useState('')
  const [palco, setPalco] = useState(false)
  const [privato, setPrivato] = useState(false)
  const [durata, setDurata] = useState('0')
  const [personalizzata, setPersonalizzata] = useState('60')
  const [inCorso, setInCorso] = useState(false)

  const conferma = async (): Promise<void> => {
    if (!nome.trim()) return
    setInCorso(true)
    try {
      const durataMinuti = durata === 'custom' ? Number(personalizzata) : Number(durata)
      await crea({ nome: nome.trim(), tipo, soloAscolto: palco, privato, durataMinuti })
    } finally {
      setInCorso(false)
    }
  }

  return (
    <div
      className="velo absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={chiudi}
    >
      <div
        className="pannello w-full max-w-sm space-y-4 rounded-2xl border border-bordo bg-fondo-2 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold">
          Nuovo canale {tipo === 'voce' ? 'vocale' : 'di testo'}
        </h2>

        <Campo etichetta="Nome">
          <input
            className={classiInput}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void conferma()}
            placeholder={tipo === 'voce' ? 'Officina' : 'generale'}
            autoFocus
          />
        </Campo>

        <DurataCanale
          valore={durata}
          personalizzata={personalizzata}
          cambia={setDurata}
          cambiaPersonalizzata={setPersonalizzata}
        />

        {tipo === 'voce' && (
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-vivo"
              checked={palco}
              onChange={(e) => setPalco(e.target.checked)}
            />
            <span>
              Canale da palco
              <span className="mt-0.5 block text-xs text-testo-3">
                Trasmettono solo gli admin, gli altri guardano e scrivono.
              </span>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-vivo"
            checked={privato}
            onChange={(e) => setPrivato(e.target.checked)}
          />
          <span>
            Privato
            <span className="mt-0.5 block text-xs text-testo-3">
              Lo vedono solo le persone che inviti: per tutti gli altri questo canale non esiste, ne'
              nell'elenco ne' cercando fra i messaggi. Chi amministra lo spazio lo vede comunque.
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Bottone tono="vivo" disabled={inCorso || !nome.trim()} onClick={() => void conferma()}>
            Crea
          </Bottone>
          <Bottone tono="fantasma" onClick={chiudi}>
            Annulla
          </Bottone>
        </div>
      </div>
    </div>
  )
}

/**
 * Rinomina un canale, gli mette un'icona, gli cambia argomento.
 *
 * Inline sotto alla riga e non in una finestra sopra a tutto: si sta
 * modificando una voce di un elenco, e vedere le altre intorno mentre si
 * sceglie il nome e' cio' che impedisce di chiamarne due allo stesso modo.
 */
function ModuloModifica({
  canale,
  salva,
  annulla
}: {
  canale: Canale
  salva: (m: { nome: string; icona: string; argomento: string; durataMinuti?: number | null }) => Promise<void>
  annulla: () => void
}): React.JSX.Element {
  const [nome, setNome] = useState(canale.nome)
  const [icona, setIcona] = useState(canale.icona ?? '')
  const [argomento, setArgomento] = useState(canale.argomento)
  const [durata, setDurata] = useState('invariata')
  const [personalizzata, setPersonalizzata] = useState('60')
  const [errore, setErrore] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const invia = async (): Promise<void> => {
    const pulito = nome.trim()
    if (!pulito) {
      setErrore("Il nome non puo' restare vuoto.")
      return
    }
    setSalvando(true)
    setErrore(null)
    try {
      const durataMinuti =
        durata === 'invariata' ? undefined : durata === 'custom' ? Number(personalizzata) : Number(durata)
      await salva({ nome: pulito, icona: icona.trim(), argomento, durataMinuti })
    } catch (e) {
      setErrore((e as Error).message)
      setSalvando(false)
    }
  }

  return (
    <div className="mt-1 mb-2 ml-6 space-y-2 rounded-lg border border-bordo bg-fondo-2 p-2">
      <div className="flex gap-1.5">
        {/* Il campo dell'icona e' largo quanto un'emoji: cosi' si capisce da
            solo che li' non ci va una parola. */}
        <input
          value={icona}
          onChange={(e) => setIcona(e.target.value)}
          placeholder="🎮"
          maxLength={4}
          aria-label="Icona"
          className="w-10 shrink-0 rounded-md border border-bordo bg-fondo px-1 py-1 text-center text-sm"
        />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void invia()
            if (e.key === 'Escape') annulla()
          }}
          maxLength={40}
          aria-label="Nome del canale"
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-bordo bg-fondo px-2 py-1 text-sm"
        />
      </div>

      <input
        value={argomento}
        onChange={(e) => setArgomento(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void invia()
          if (e.key === 'Escape') annulla()
        }}
        placeholder="Argomento (facoltativo)"
        maxLength={200}
        aria-label="Argomento"
        className="w-full rounded-md border border-bordo bg-fondo px-2 py-1 text-xs"
      />

      <DurataCanale
        valore={durata}
        personalizzata={personalizzata}
        cambia={setDurata}
        cambiaPersonalizzata={setPersonalizzata}
        consentiInvariata
      />

      {errore && <p className="text-xs text-male">{errore}</p>}

      <div className="flex gap-1.5">
        <button
          onClick={() => void invia()}
          disabled={salvando}
          className="rounded-md bg-vivo px-2 py-1 text-xs font-medium text-fondo disabled:opacity-50"
        >
          {salvando ? 'Salvo…' : 'Salva'}
        </button>
        <button onClick={annulla} className="rounded-md px-2 py-1 text-xs text-testo-3 hover:text-testo">
          Annulla
        </button>
      </div>
    </div>
  )
}

function DurataCanale({
  valore,
  personalizzata,
  cambia,
  cambiaPersonalizzata,
  consentiInvariata = false
}: {
  valore: string
  personalizzata: string
  cambia: (valore: string) => void
  cambiaPersonalizzata: (valore: string) => void
  consentiInvariata?: boolean
}): React.JSX.Element {
  return (
    <Campo etichetta="Durata">
      <div className="flex gap-2">
        <select className={classiInput} value={valore} onChange={(e) => cambia(e.target.value)}>
          {consentiInvariata && <option value="invariata">Non cambiare</option>}
          <option value="0">Permanente</option>
          <option value="30">30 minuti</option>
          <option value="60">1 ora</option>
          <option value="180">3 ore</option>
          <option value="360">6 ore</option>
          <option value="720">12 ore</option>
          <option value="1440">24 ore</option>
          <option value="custom">Personalizzata</option>
        </select>
        {valore === 'custom' && (
          <input
            className={`${classiInput} w-28`}
            type="number"
            min={1}
            max={2880}
            value={personalizzata}
            onChange={(e) => cambiaPersonalizzata(e.target.value)}
            aria-label="Durata personalizzata in minuti"
          />
        )}
      </div>
      {valore === 'custom' && <span className="mt-1 block text-xs text-testo-3">Da 1 minuto a 48 ore.</span>}
    </Campo>
  )
}

function ScadenzaCanale({ restanoMs }: { restanoMs: number }): React.JSX.Element {
  const [restano, setRestano] = useState(restanoMs)

  useEffect(() => {
    const partenza = performance.now()
    const aggiorna = (): void => setRestano(Math.max(0, restanoMs - (performance.now() - partenza)))
    aggiorna()
    const timer = window.setInterval(aggiorna, 30_000)
    return () => window.clearInterval(timer)
  }, [restanoMs])

  const minuti = Math.ceil(restano / 60_000)
  const testo = minuti < 60 ? `${minuti}m` : minuti < 1440 ? `${Math.ceil(minuti / 60)}h` : `${Math.ceil(minuti / 1440)}g`
  return (
    <span className="numeri shrink-0 text-[10px] text-attenzione" title={`Scade tra ${testo}`}>
      {testo}
    </span>
  )
}
