import type { Canale } from '@shared/tipi'
import { coloreDi, inizialiDi } from '../lib/avatar'
import { Bottone } from '../ui'
import { Altoparlante, Camera, MicrofonoSpento, SchermoCondividi } from '../icone'

/**
 * Un canale vocale guardato da fuori.
 *
 * Esiste per un buco che si apriva ogni volta che si usciva da una chiamata:
 * il canale restava li' nell'elenco, ma la parte grande dello schermo diceva
 * «Scegli un canale a sinistra» — cioe' rispondeva a una domanda che nessuno
 * aveva fatto, visto che un canale era selezionato eccome. E per rientrare
 * bisognava ricliccare nella colonna, che e' esattamente il gesto che si era
 * appena fatto.
 *
 * Adesso uscire lascia il canale selezionato e questa schermata al suo posto:
 * si vede dove si era, chi c'e' rimasto, e c'e' un pulsante per rientrare. E'
 * lo stesso posto di prima, senza la chiamata.
 *
 * Serve anche a chi il canale lo apre senza volerci entrare — per vedere chi
 * c'e' prima di decidere — che prima non era possibile: cliccare un vocale
 * voleva dire entrarci, e non esisteva un modo di guardare.
 *
 * ## Chi c'e', e cosa sta facendo
 *
 * Non solo i nomi: accanto a ognuno ci sono le icone di cio' che ha acceso.
 * E' la differenza fra «ci sono tre persone» e «ci sono tre persone, una sta
 * mostrando lo schermo» — che e' l'informazione che fa decidere se entrare
 * adesso o fra dieci minuti.
 */
export default function AtrioVocale({
  canale,
  profili,
  entra
}: {
  canale: Canale
  /** Per le foto vere al posto delle iniziali. */
  profili?: Map<number, { nome: string; avatar: string | null }>
  entra: () => void
}): React.JSX.Element {
  const dentro = canale.presenti ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fondo-3 text-testo-3">
          <Altoparlante className="h-7 w-7" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-testo">
          {canale.icona ? `${canale.icona} ` : ''}
          {canale.nome}
        </h1>
        {canale.argomento && (
          <p className="max-w-md text-sm leading-relaxed text-testo-3">{canale.argomento}</p>
        )}
      </div>

      {dentro.length === 0 ? (
        <p className="text-sm text-testo-2">Non c&apos;e&apos; nessuno qui dentro.</p>
      ) : (
        <div className="flex max-w-2xl flex-wrap items-start justify-center gap-4">
          {dentro.map((chi) => {
            // L'identita' sulla SFU e' `u<id>`: e' l'unica chiave su cui una
            // presenza e un profilo combaciano.
            const foto = profili?.get(Number(chi.identita.slice(1)))?.avatar ?? null

            return (
              <span key={chi.identita} className="flex w-24 flex-col items-center gap-1.5">
                <span className="relative">
                  {foto ? (
                    <img src={foto} alt="" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <span
                      className="flex h-14 w-14 items-center justify-center rounded-full text-base font-semibold text-black/75"
                      style={{ background: coloreDi(chi.identita) }}
                    >
                      {inizialiDi(chi.nome)}
                    </span>
                  )}
                  {/* Il microfono spento e' l'unico stato che si segna sulla
                      faccia: e' quello che cambia se conviene parlargli. */}
                  {!chi.microfono && (
                    <span className="absolute -right-0.5 -bottom-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-fondo bg-male text-white">
                      <MicrofonoSpento className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>

                <span className="w-full truncate text-xs text-testo-2">{chi.nome}</span>

                {(chi.schermi > 0 || chi.camera) && (
                  <span className="flex items-center gap-1.5 text-ok">
                    {chi.schermi > 0 && <SchermoCondividi className="h-3.5 w-3.5" />}
                    {chi.camera && <Camera className="h-3.5 w-3.5" />}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )}

      <Bottone tono="vivo" onClick={entra} className="px-6 py-2.5">
        {dentro.length === 0 ? 'Entra nel canale' : 'Entra con loro'}
      </Bottone>

      {canale.soloAscolto && (
        <p className="max-w-sm text-xs leading-relaxed text-testo-3">
          Qui parlano solo gli amministratori: entrando si ascolta.
        </p>
      )}
    </div>
  )
}
