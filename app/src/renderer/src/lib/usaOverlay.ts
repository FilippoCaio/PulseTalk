import { useEffect, useMemo } from 'react'
import type { PersonaOverlay } from '@shared/tipi'
import { ponte } from '../ponte'
import { coloreDi, inizialiDi } from './avatar'
import type { Riquadro } from './usaSessione'

/**
 * Racconta la chiamata all'overlay.
 *
 * Il pannello che compare sopra a tutto quando la finestra e' ridotta a icona
 * lo disegna il processo principale (`main/overlay.ts`), che di una chiamata
 * non sa niente: chi c'e' e chi parla e' roba di LiveKit, e LiveKit vive qui.
 * Questo aggancio e' la striscia di nastro fra le due cose.
 *
 * ## Due spedizioni, due ritmi
 *
 * L'elenco delle persone si porta dietro le foto profilo, che sono data URL da
 * qualche kilobyte l'una, e cambia quando qualcuno entra o esce. Chi parla
 * cambia dieci volte al minuto ed e' una lista di stringhe corte. Tenerli
 * insieme avrebbe voluto dire spedire le foto a ogni sillaba - qualche megabyte
 * al minuto attraverso il ponte, per accendere un bordo verde.
 *
 * La firma serve a questo: React ridisegna la sala molte volte al secondo -
 * ogni misura di banda, ogni fotogramma contato - e senza un confronto sul
 * contenuto ogni ridisegno sarebbe una spedizione. Si confronta cio' che
 * l'overlay vede davvero, foto compresa ma per lunghezza e coda invece che per
 * intero: due data URL diverse della stessa persona non capitano, e
 * confrontare centomila caratteri a ogni fotogramma costerebbe piu' di quanto
 * si risparmia.
 */
export function usaOverlay(
  riquadri: Riquadro[],
  profili: Map<number, { nome: string; avatar: string | null }>
): void {
  const persone = useMemo<PersonaOverlay[]>(
    () =>
      riquadri
        .filter((r) => r.tipo === 'persona')
        .map((r) => ({
          id: r.identita,
          nome: r.nome,
          avatar: profili.get(Number(r.identita.slice(1)))?.avatar ?? null,
          colore: coloreDi(r.identita),
          iniziali: inizialiDi(r.nome),
          // Nell'overlay le due cose diventano lo stesso segno, ed e' giusto:
          // da fuori "ha il microfono spento" e "non sente niente" hanno la
          // stessa conseguenza pratica - da li' non arrivera' una risposta.
          muto: !r.microfonoAcceso || r.sordina
        })),
    [riquadri, profili]
  )

  const firma = persone
    .map((p) => `${p.id}|${p.nome}|${p.muto ? 1 : 0}|${p.avatar?.length ?? 0}|${p.avatar?.slice(-16) ?? ''}`)
    .join('\n')

  useEffect(() => {
    ponte.overlay.persone(persone)
    // Volutamente sulla firma e non sull'elenco: l'elenco e' un array nuovo a
    // ogni ridisegno, la firma cambia solo quando cambia cio' che si vede.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma])

  // Uscendo dalla stanza l'overlay non ha piu' niente da mostrare. Non basta
  // che la finestra torni grande: si puo' uscire da una chiamata con
  // l'applicazione ridotta a icona, dal pannellino della barra.
  useEffect(() => () => ponte.overlay.persone([]), [])

  const parlano = persone.length > 0 ? riquadriCheParlano(riquadri) : []
  const firmaVoci = parlano.join(',')

  useEffect(() => {
    ponte.overlay.voci(firmaVoci ? firmaVoci.split(',') : [])
  }, [firmaVoci])
}

function riquadriCheParlano(riquadri: Riquadro[]): string[] {
  return riquadri.filter((r) => r.tipo === 'persona' && r.parla).map((r) => r.identita)
}
