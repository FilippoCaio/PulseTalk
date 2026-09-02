import { useEffect, useState } from 'react'
import type { Membro } from '../../lib/api'
import type { Api } from '../../lib/api'
import type { Ruolo, Spazio, Utente } from '@shared/tipi'
import { puo, puoQualcosa, type Permesso } from '@shared/permessi'
import { BottoneIcona } from '../../ui'
import {
  Calendario,
  Registra,
  Cartella,
  Catena,
  Chiudi,
  Ingranaggio,
  Lucchetto,
  Scudo,
  Utenti
} from '../../icone'
import Panoramica from './Panoramica'
import Membri from './Membri'
import Ruoli from './Ruoli'
import PermessiCanali from './PermessiCanali'
import Struttura from './Struttura'
import InvitiSpazio from './InvitiSpazio'
import EventiSpazio from './EventiSpazio'
import Registrazioni from './Registrazioni'

/**
 * Le impostazioni di un server.
 *
 * Stesso impianto del pannello dell'applicazione — colonna a sinistra,
 * contenuto a destra — perche' sono la stessa cosa vista da due parti, e
 * inventare una seconda forma per la stessa idea costringerebbe a impararla due
 * volte.
 *
 * Le sezioni compaiono in base ai permessi. Non e' sicurezza: e' il motivo per
 * cui questo pannello ha senso aprirlo. Un moderatore che vede sette voci di
 * cui cinque rispondono "non puoi" impara solo a non fidarsi di quello che
 * legge. La porta chiusa vera sta nelle rotte, che rifanno il calcolo a ogni
 * richiesta.
 */
type Sezione =
  | 'panoramica'
  | 'membri'
  | 'ruoli'
  | 'permessi'
  | 'struttura'
  | 'inviti'
  | 'eventi'
  | 'registrazioni'

interface Voce {
  id: Sezione
  nome: string
  Icona: (p: { className?: string }) => React.JSX.Element
  /** Uno di questi permessi basta a mostrarla. */
  serve: Permesso[]
}

const VOCI: Voce[] = [
  { id: 'panoramica', nome: 'Panoramica', Icona: Ingranaggio, serve: ['manageServerSettings'] },
  {
    id: 'membri',
    nome: 'Membri',
    Icona: Utenti,
    serve: ['manageMembers', 'kickMembers', 'banMembers', 'manageRoles']
  },
  { id: 'ruoli', nome: 'Ruoli', Icona: Scudo, serve: ['manageRoles'] },
  { id: 'permessi', nome: 'Permessi', Icona: Lucchetto, serve: ['managePermissions'] },
  {
    id: 'struttura',
    nome: 'Categorie e canali',
    Icona: Cartella,
    serve: [
      'createCategories',
      'editCategories',
      'deleteCategories',
      'createTextChannels',
      'editTextChannels',
      'deleteTextChannels',
      'createVoiceChannels',
      'editVoiceChannels',
      'deleteVoiceChannels'
    ]
  },
  { id: 'inviti', nome: 'Inviti', Icona: Catena, serve: ['createInvites'] },
  { id: 'eventi', nome: 'Eventi', Icona: Calendario, serve: ['createEvents', 'manageEvents'] },
  // Ultima, e con i permessi di chi risponde delle persone: e' la pagina che
  // si apre quando qualcuno chiede «chi mi ha registrato», e chi la apre e'
  // quello a cui la domanda arriva.
  {
    id: 'registrazioni',
    nome: 'Registrazioni',
    Icona: Registra,
    serve: ['manageServerSettings', 'manageMembers', 'kickMembers', 'banMembers']
  }
]

export default function PannelloSpazio({
  api,
  spazio,
  io,
  profili,
  sezioneIniziale,
  ricarica,
  chiudi,
  eliminaSpazio
}: {
  api: Api
  spazio: Spazio
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  sezioneIniziale?: string
  /** Rilegge spazi e canali dopo una modifica strutturale. */
  ricarica: () => void
  chiudi: () => void
  eliminaSpazio: () => void
}): React.JSX.Element {
  const visibili = VOCI.filter((v) => puoQualcosa(spazio.permessiMiei, v.serve))
  const [sezione, setSezione] = useState<Sezione>(
    (visibili.find((v) => v.id === sezioneIniziale)?.id ?? visibili[0]?.id ?? 'panoramica') as Sezione
  )

  // Membri e ruoli servono a tre sezioni su sette: si leggono una volta qui e
  // si passano giu'. Tre componenti che li chiedono per conto proprio farebbero
  // tre richieste per la stessa risposta ogni volta che si cambia scheda.
  const [membri, setMembri] = useState<Membro[] | null>(null)
  const [ruoli, setRuoli] = useState<Ruolo[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const rileggi = (): void => {
    void api
      .membri(spazio.id)
      .then((r) => setMembri(r.membri))
      .catch((e) => setErrore((e as Error).message))
    void api
      .ruoli(spazio.id)
      .then((r) => setRuoli(r.ruoli))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(rileggi, [api, spazio.id])

  useEffect(() => {
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') chiudi()
    }
    document.addEventListener('keydown', tasto)
    return () => document.removeEventListener('keydown', tasto)
  }, [chiudi])

  return (
    <div className="pannello absolute inset-0 z-40 flex flex-col bg-fondo sm:flex-row">
      <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-bordo bg-fondo-2 p-2 sm:w-56 sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-3">
        <p className="hidden mb-2 truncate px-2 text-[11px] font-semibold tracking-wider text-testo-3 uppercase sm:block">
          {spazio.nome}
        </p>
        {visibili.map(({ id, nome, Icona }) => (
          <button
            key={id}
            onClick={() => setSezione(id)}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              sezione === id
                ? 'bg-fondo-3 text-testo'
                : 'text-testo-2 hover:bg-fondo-3/60 hover:text-testo'
            }`}
          >
            <Icona className="h-4 w-4" />
            {nome}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-bordo px-5 py-4">
          <h2 className="font-semibold">{VOCI.find((v) => v.id === sezione)?.nome}</h2>
          <BottoneIcona tono="fantasma" onClick={chiudi} title="Chiudi le impostazioni del server">
            <Chiudi />
          </BottoneIcona>
        </header>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-4 sm:p-5">
          {errore && <p className="text-sm text-male">{errore}</p>}

          {sezione === 'panoramica' && (
            <Panoramica
              api={api}
              spazio={spazio}
              io={io}
              membri={membri}
              ricarica={ricarica}
              eliminaSpazio={eliminaSpazio}
            />
          )}

          {sezione === 'membri' && (
            <Membri
              api={api}
              spazio={spazio}
              io={io}
              membri={membri}
              ruoli={ruoli}
              rileggi={() => {
                rileggi()
                ricarica()
              }}
            />
          )}

          {sezione === 'ruoli' && (
            <Ruoli
              api={api}
              spazio={spazio}
              ruoli={ruoli}
              membri={membri}
              rileggi={() => {
                rileggi()
                ricarica()
              }}
            />
          )}

          {sezione === 'permessi' && (
            <PermessiCanali
              api={api}
              spazio={spazio}
              ruoli={ruoli}
              membri={membri}
              ricarica={ricarica}
            />
          )}

          {sezione === 'struttura' && <Struttura api={api} spazio={spazio} ricarica={ricarica} />}

          {sezione === 'inviti' && <InvitiSpazio api={api} spazio={spazio} ruoli={ruoli} />}

          {sezione === 'registrazioni' && <Registrazioni api={api} spazio={spazio} />}

          {sezione === 'eventi' && (
            <EventiSpazio api={api} spazio={spazio} io={io} profili={profili} />
          )}
        </div>
      </div>
    </div>
  )
}

/** Se questo pannello ha almeno una sezione da mostrare a questa persona. */
export function apribile(spazio: Spazio): boolean {
  return VOCI.some((v) => puoQualcosa(spazio.permessiMiei, v.serve))
}

/** Comodita' per chi disegna: lo stesso controllo usato dalle sezioni. */
export { puo }
