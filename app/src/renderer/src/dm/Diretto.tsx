import { useMemo } from 'react'
import type { Canale, Chiamata, Conversazione, Utente } from '@shared/tipi'
import type { Api } from '../lib/api'
import type { usaChat } from '../lib/usaChat'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { PallinoStato } from '../PopupProfilo'
import Chat from '../chat/Chat'
import { BottoneIcona } from '../ui'
import { Telefono, TelefonoGiu } from '../icone'

/**
 * Una conversazione a due.
 *
 * Sotto e' un canale come tutti gli altri — stessa chat, stessi allegati,
 * stesse reazioni, stessa ricerca dei non letti — e questo componente
 * aggiunge le due cose che un canale non ha: una faccia in cima e un pulsante
 * per telefonare.
 *
 * La chat vera e' `Chat`, con l'intestazione sostituita. Un secondo componente
 * di chat identico tranne che nella prima riga sarebbe stato quattrocento
 * righe da tenere allineate a ogni correzione.
 */
export default function Diretto({
  api,
  conversazione,
  chat,
  io,
  profili,
  chiamata,
  chiamando,
  telefona,
  riaggancia,
  mostraAnteprimeLink = true
}: {
  api: Api
  conversazione: Conversazione
  chat: ReturnType<typeof usaChat>
  io: Utente
  profili: Map<number, { nome: string; avatar: string | null }>
  /** La chiamata in corso su QUESTA conversazione, se c'e'. */
  chiamata: Chiamata | null
  /** Vero mentre si sta chiedendo la linea: il pulsante non si preme due volte. */
  chiamando: boolean
  telefona: () => void
  riaggancia: () => void
  mostraAnteprimeLink?: boolean
}): React.JSX.Element {
  // Un canale finto per la chat: quello vero e' un canale privato dentro allo
  // spazio di sistema, e i suoi campi — categoria, argomento, presenti — non
  // vogliono dire niente qui. Cio' che serve alla chat e' l'id.
  //
  // Tenuto fermo fra un render e l'altro: `conversazione` arriva da un elenco
  // che si rilegge a ogni evento del server, e un oggetto nuovo ogni volta
  // farebbe ripartire tutto cio' che sta a valle e guarda l'identita'.
  const canale: Canale = useMemo(
    () => ({
      id: conversazione.canale,
      chiave: `dm-${conversazione.id}`,
      nome: conversazione.con.nome,
      icona: null,
      tipo: 'testo',
      argomento: '',
      categoria: null,
      posizione: 0,
      soloAscolto: false,
      privato: true,
      creato: 0,
      creatoDa: null,
      scade: null,
      restanoMs: null,
      nonLetti: conversazione.nonLetti,
      presenti: []
    }),
    [conversazione.canale, conversazione.id, conversazione.con.nome, conversazione.nonLetti]
  )

  const inCorso = chiamata?.stato === 'in corso' || chiamata?.stato === 'squilla'

  return (
    <Chat
      api={api}
      canale={canale}
      chat={chat}
      io={io}
      profili={profili}
      nomeVisibile={`la conversazione con ${conversazione.con.nome}`}
      accantoAllaLinguetta
      mostraAnteprimeLink={mostraAnteprimeLink}
      intestazione={
        <header className="flex items-center gap-3 border-b border-bordo px-5 py-2.5 md:pl-10">
          <span className="relative shrink-0">
            {conversazione.con.avatar ? (
              <img
                src={conversazione.con.avatar}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-black/75"
                style={{ background: coloreDi(`u${conversazione.con.id}`) }}
              >
                {inizialiDi(conversazione.con.nome)}
              </span>
            )}
            <PallinoStato
              stato={conversazione.con.stato ?? 'offline'}
              className="h-3 w-3"
              fondo="var(--color-fondo)"
            />
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-medium">{conversazione.con.nome}</h1>
            {conversazione.con.utente && (
              <p className="truncate text-xs text-testo-3">@{conversazione.con.utente}</p>
            )}
          </div>

          {inCorso ? (
            <BottoneIcona
              tono="male"
              title={chiamata?.stato === 'squilla' ? 'Annulla la chiamata' : 'Riaggancia'}
              onClick={riaggancia}
            >
              <TelefonoGiu className="h-4 w-4" />
            </BottoneIcona>
          ) : (
            <BottoneIcona
              tono="fantasma"
              title={`Chiama ${conversazione.con.nome}`}
              disabled={chiamando}
              onClick={telefona}
            >
              <Telefono className="h-4 w-4" />
            </BottoneIcona>
          )}
        </header>
      }
    />
  )
}
