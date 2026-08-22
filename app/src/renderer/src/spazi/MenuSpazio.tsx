import { useEffect, useRef, useState } from 'react'
import type { Impostazioni, Spazio } from '@shared/tipi'
import { PERMESSI_DI_GESTIONE, puo, puoQualcosa } from '@shared/permessi'
import {
  Calendario,
  Campanella,
  CampanellaSpenta,
  Catena,
  Chevron,
  Esci,
  Ingranaggio,
  Letto,
  Piu
} from '../icone'

/**
 * Il menu accanto al nome del server.
 *
 * C'e' per tutti, e mostra cose diverse a persone diverse. Non e' una tendina
 * "da amministratore" che gli altri non vedono: le voci di tutti — silenzia,
 * segna come letto, abbandona — sono le stesse che servono a chi in quel server
 * e' solo di passaggio, e nasconderle a chi non amministra vorrebbe dire non
 * avere nessun posto in cui metterle.
 *
 * Cio' che compare dipende dai permessi risolti dal server e arrivati insieme
 * allo spazio. Nascondere un pulsante e' cortesia: chi lo premesse lo stesso —
 * con un client modificato, o con una fetch scritta a mano — troverebbe
 * comunque un 403 dall'altra parte.
 */

/** Le durate del silenzio, in minuti. Null: finche' non lo riattivo. */
const DURATE: { minuti: number | null; testo: string }[] = [
  { minuti: 15, testo: 'Per 15 minuti' },
  { minuti: 60, testo: "Per un'ora" },
  { minuti: 180, testo: 'Per 3 ore' },
  { minuti: 480, testo: 'Per 8 ore' },
  { minuti: 1440, testo: 'Per 24 ore' },
  { minuti: null, testo: 'Finche\' non lo riattivo' }
]

export default function MenuSpazio({
  spazio,
  impostazioni,
  silenzia,
  riattiva,
  apriImpostazioniSpazio,
  apriInviti,
  apriEventi,
  creaEvento,
  segnaLetto,
  abbandona,
  chiudi
}: {
  spazio: Spazio
  impostazioni: Impostazioni
  silenzia: (minuti: number | null) => void
  riattiva: () => void
  apriImpostazioniSpazio: (sezione?: string) => void
  apriInviti: () => void
  apriEventi: () => void
  creaEvento: () => void
  segnaLetto: () => void
  abbandona: () => void
  chiudi: () => void
}): React.JSX.Element {
  const [sottoMenu, setSottoMenu] = useState<'silenzia' | null>(null)
  const riquadro = useRef<HTMLDivElement | null>(null)

  // Escape e clic fuori: sono i due gesti con cui si chiude un menu senza
  // pensarci. Il listener e' in fase di cattura per arrivare prima di chi sta
  // sotto — altrimenti il primo clic fuori aprirebbe anche quello che c'e' li'.
  useEffect(() => {
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        chiudi()
      }
    }
    const fuori = (e: MouseEvent): void => {
      const bersaglio = e.target
      if (!riquadro.current || !(bersaglio instanceof Node)) return
      if (riquadro.current.contains(bersaglio)) return

      // Il pulsante col nome del server e' parte del menu anche se, nel DOM,
      // ne e' un fratello. Se lo trattassimo come un clic esterno, il
      // `mousedown` chiuderebbe il menu e il successivo `click` lo riaprirebbe
      // subito: sembrerebbe impossibile richiuderlo dallo stesso pulsante.
      if (bersaglio instanceof Element && bersaglio.closest('[data-menu-spazio-trigger]')) return

      chiudi()
    }
    document.addEventListener('keydown', tasto, true)
    document.addEventListener('mousedown', fuori, true)
    return () => {
      document.removeEventListener('keydown', tasto, true)
      document.removeEventListener('mousedown', fuori, true)
    }
  }, [chiudi])

  const permessi = spazio.permessiMiei
  const amministra = puoQualcosa(permessi, PERMESSI_DI_GESTIONE)
  const puoInvitare =
    puo(permessi, 'createInvites') &&
    (spazio.impostazioni.invitiAperti || puo(permessi, 'manageServer'))

  const silenziato = (impostazioni.spaziSilenziati ?? []).find((s) => s.spazio === spazio.id)
  const ancoraSilenziato = !!silenziato && (silenziato.fino === null || silenziato.fino > Date.now())

  return (
    <div
      ref={riquadro}
      className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-bordo bg-fondo-2 py-1.5 shadow-xl shadow-black/50"
      role="menu"
    >
      {/* -- Per tutti ------------------------------------------------- */}

      {ancoraSilenziato ? (
        <Voce
          icona={<Campanella className="h-4 w-4" />}
          testo="Riattiva le notifiche"
          sotto={
            silenziato?.fino
              ? `Silenziato fino alle ${new Date(silenziato.fino).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
              : 'Silenziato finche\' non lo riattivi'
          }
          premi={() => {
            riattiva()
            chiudi()
          }}
        />
      ) : (
        <>
          <Voce
            icona={<CampanellaSpenta className="h-4 w-4" />}
            testo="Silenzia le notifiche"
            freccia
            aperto={sottoMenu === 'silenzia'}
            premi={() => setSottoMenu((quale) => (quale === 'silenzia' ? null : 'silenzia'))}
          />
          {sottoMenu === 'silenzia' && (
            <div className="border-y border-bordo bg-fondo/40 py-1">
              {DURATE.map((durata) => (
                <button
                  key={durata.testo}
                  role="menuitem"
                  onClick={() => {
                    silenzia(durata.minuti)
                    chiudi()
                  }}
                  className="block w-full px-3 py-1.5 pl-10 text-left text-sm text-testo-2 hover:bg-fondo-3 hover:text-testo"
                >
                  {durata.testo}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {puoInvitare && (
        <Voce
          icona={<Catena className="h-4 w-4" />}
          testo="Invita persone"
          premi={() => {
            apriInviti()
            chiudi()
          }}
        />
      )}

      <Voce
        icona={<Letto className="h-4 w-4" />}
        testo="Segna come gia' letto"
        premi={() => {
          segnaLetto()
          chiudi()
        }}
      />

      <Voce
        icona={<Calendario className="h-4 w-4" />}
        testo="Eventi"
        premi={() => {
          apriEventi()
          chiudi()
        }}
      />

      {puo(permessi, 'createEvents') && (
        <Voce
          icona={<Piu className="h-4 w-4" />}
          testo="Crea evento"
          premi={() => {
            creaEvento()
            chiudi()
          }}
        />
      )}

      {/* -- Per chi amministra ----------------------------------------- */}

      {amministra && (
        <>
          <Separatore />
          <Voce
            icona={<Ingranaggio className="h-4 w-4" />}
            testo="Impostazioni del server"
            premi={() => {
              apriImpostazioniSpazio()
              chiudi()
            }}
          />
        </>
      )}

      {/* -- L'uscita ---------------------------------------------------- */}

      <Separatore />
      <Voce
        icona={<Esci className="h-4 w-4" />}
        testo="Abbandona il server"
        tono="male"
        premi={() => {
          abbandona()
          chiudi()
        }}
      />
    </div>
  )
}

function Separatore(): React.JSX.Element {
  return <div className="my-1.5 h-px bg-bordo" />
}

function Voce({
  icona,
  testo,
  sotto,
  tono = 'normale',
  freccia = false,
  aperto = false,
  premi
}: {
  icona: React.ReactNode
  testo: string
  sotto?: string
  tono?: 'normale' | 'male'
  freccia?: boolean
  aperto?: boolean
  premi: () => void
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      onClick={premi}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
        tono === 'male'
          ? 'text-male hover:bg-male/10'
          : 'text-testo-2 hover:bg-fondo-3 hover:text-testo'
      }`}
    >
      <span className="shrink-0">{icona}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{testo}</span>
        {sotto && <span className="block truncate text-[11px] text-testo-3">{sotto}</span>}
      </span>
      {freccia && (
        <Chevron className={`h-3.5 w-3.5 shrink-0 transition-transform ${aperto ? '' : '-rotate-90'}`} />
      )}
    </button>
  )
}
