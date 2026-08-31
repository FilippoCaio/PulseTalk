import { useEffect, useState } from 'react'
import { LINGUE, linguaDelSistema } from '@shared/lingue'
import { ponte } from '../ponte'
import { caricaLingua, tradotteDentro } from '../lib/pacchettiLingua'
import { usaT } from '../lib/usaLingua'

/**
 * La tendina della lingua.
 *
 * Un `select` del sistema e non un menu disegnato a mano, e per una volta e'
 * la scelta giusta senza riserve: la tendina nativa sa gia' scorrere con la
 * tastiera, sa cavarsela su un telefono, e chi usa un lettore di schermo la
 * conosce. Un elenco fatto in casa avrebbe dovuto reimparare tutte e tre le
 * cose per guadagnare un bordo piu' bello.
 *
 * Ogni lingua e' scritta **nel proprio nome**: chi cerca il tedesco cerca
 * «Deutsch», non «Tedesco». Una tendina che traduce i nomi delle lingue e'
 * leggibile solo da chi sa gia' la lingua in cui e' scritta, cioe' e' inutile
 * proprio a chi la sta aprendo.
 *
 * Le lingue senza pacchetto restano nell'elenco, segnate. Nasconderle
 * risparmierebbe una delusione e ne creerebbe una peggiore: chi cerca la
 * propria e non la trova non sa se manca o se ha guardato male, mentre
 * «non ancora tradotta» e' una risposta.
 */
export default function ScegliLingua({
  /** Da dove prendere i pacchetti aggiuntivi. Nella prima schermata non c'e' ancora. */
  server = null,
  className = ''
}: {
  server?: string | null
  className?: string
}): React.JSX.Element {
  const { t, codice } = usaT()
  const [scelta, setScelta] = useState(codice)
  const dentro = tradotteDentro()

  // La lingua puo' cambiare da fuori: da un'altra finestra, o al primo avvio
  // quando arriva quella del sistema. La tendina deve seguirla.
  useEffect(() => setScelta(codice), [codice])

  const cambia = (nuova: string): void => {
    setScelta(nuova)
    void caricaLingua(nuova, server)
    // Si scrive nelle impostazioni, che e' cio' che la rende una scelta invece
    // di una prova: senza, alla riapertura tornerebbe quella del sistema.
    void ponte.scriviImpostazioni({ lingua: nuova })
  }

  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <span className="sr-only">{t('Lingua')}</span>
      <select
        value={scelta}
        onChange={(e) => cambia(e.target.value)}
        aria-label={t('Lingua')}
        className="rounded-lg border border-bordo bg-fondo-2 px-2 py-1.5 text-xs text-testo-2 outline-none transition-colors hover:border-fondo-3 focus:border-vivo"
      >
        {LINGUE.map((l) => (
          <option key={l.codice} value={l.codice}>
            {l.bandiera} {l.nome}
            {dentro.includes(l.codice) ? '' : ` — ${t('non ancora tradotta')}`}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Che lingua accendere all'avvio.
 *
 * L'ordine e': quella scelta, poi quella del sistema. La distinzione fra le
 * due e' il motivo per cui l'impostazione parte vuota invece che da
 * `'it'` — vedi `Impostazioni.lingua`.
 */
export function linguaDaUsare(scelta: string | undefined): string {
  if (scelta) return scelta
  const dichiarate =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  return linguaDelSistema(dichiarate.filter(Boolean) as string[])
}
