import type { Restrizione } from '@shared/tipi'
import type { VoceModerazione } from '../lib/usaRestrizioni'
import type { VoceVolume } from '../sala/Volume'

/**
 * Cosa si puo' fare a una persona elencata sotto a un canale vocale.
 *
 * Un oggetto solo invece di otto proprieta' separate sulla colonna dei canali,
 * e non e' pigrizia: sono tutte cose che quella colonna non ha e non deve
 * avere — i volumi vivono nella sessione RTC, i diretti nel loro hook, i
 * provvedimenti nei permessi del canale — e passarle una per una avrebbe fatto
 * crescere quella firma di otto righe per un pannellino.
 *
 * Tutto quello che sta qui dentro e' gia' filtrato da chi lo costruisce:
 * `moderazione` contiene soltanto le voci che chi guarda ha il diritto di
 * usare, e `caccia` c'e' solo se si puo'. A dire di no resta comunque il
 * server su ogni richiesta — nascondere un controllo non e' una misura di
 * sicurezza — ma disegnare voci che rispondono 403 sarebbe soltanto un modo di
 * raccontare a chi non puo' cosa potrebbe fare qualcun altro.
 */
export interface PersonaInVoce {
  /** Chi guarda, per non aprire il pannello dei provvedimenti su se stesso. */
  io: number | null
  /**
   * Il volume di quella persona e lo zittiscila-per-me.
   *
   * Sono impostazioni locali di chi guarda: non toccano nessun altro, e per
   * questo compaiono anche a chi non ha nessun permesso. Vuoto quando non si
   * sta parlando in quel canale — un cursore che regola una voce che non
   * arriva non regola niente.
   */
  volumi: (identita: string) => VoceVolume[]
  /**
   * I provvedimenti disponibili su questa persona, in questo canale.
   *
   * Il canale e' un parametro e non una costante perche' questa colonna mostra
   * le persone di **tutti** i vocali, non solo di quello in cui si sta
   * parlando: chi ha il diritto di moderare deve poterlo fare anche su una
   * stanza in cui non e' entrato.
   */
  moderazione: (canale: number, utente: number) => VoceModerazione[] | undefined
  /** Cosa le e' gia' stato imposto, per dirlo invece di lasciarlo indovinare. */
  restrizioni: (canale: number, utente: number) => Restrizione[] | undefined
  /** Da chiamare aprendo il pannello: chiede al server cosa c'e' in quel canale. */
  assicura: (canale: number) => void
  /** Espelli dal canale vocale. Assente se non si puo'. */
  caccia?: (canale: number, identita: string) => Promise<void>
  /** Apre il composer del diretto con questa persona. */
  scrivi: (utente: number) => void
  /** Porta alla vista diretti sulla conversazione con questa persona. */
  vaiAiDiretti: (utente: number) => void
}
