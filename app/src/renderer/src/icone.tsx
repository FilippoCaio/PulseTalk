import type { SVGProps } from 'react'

/**
 * Le icone, disegnate a mano qui dentro.
 *
 * Nessuna libreria: sarebbero duecento file in node_modules per venti disegni,
 * e in una app che gira anche da `file://` ogni dipendenza in piu' e' una cosa
 * che puo' non arrivare. Sono tutte sulla stessa griglia 24x24, tutte a tratto
 * e tutte in `currentColor`, cosi' il colore lo decide il pulsante che le
 * contiene e non l'icona.
 *
 * Ogni pulsante che le usa deve avere un `title`: un'icona senza nome e' un
 * indovinello, e l'unico modo per risolverlo sarebbe premerla.
 */

type Props = SVGProps<SVGSVGElement>

// La misura arriva dal `className` di chi la usa e *sostituisce* quella di
// serie invece di aggiungersi: due utility che toccano la stessa proprieta'
// non si battono in base all'ordine in cui sono scritte qui, ma a quello in cui
// Tailwind le ha messe nel foglio di stile — e vincerebbe sempre la stessa.
function Base({ children, className = 'h-5 w-5', ...resto }: Props): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...resto}
    >
      {children}
    </svg>
  )
}

/** La sbarra di chi e' spento. Sempre la stessa, sempre nello stesso verso. */
function Sbarra(): React.JSX.Element {
  return <path d="M3.5 3.5 20.5 20.5" />
}

export function Microfono(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5" />
    </Base>
  )
}

export function MicrofonoSpento(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5" />
      <Sbarra />
    </Base>
  )
}

export function Camera(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
    </Base>
  )
}

export function CameraSpenta(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
      <Sbarra />
    </Base>
  )
}

/** Uno schermo con la freccia in su: condividi. */
export function SchermoCondividi(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8.5 20.5h7" />
      <path d="M12 16.5v4" />
      <path d="M12 13V7.5" />
      <path d="m9.5 10 2.5-2.5L14.5 10" />
    </Base>
  )
}

/** Lo stesso schermo, sbarrato: smetti. */
export function SchermoStop(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8.5 20.5h7" />
      <path d="M12 16.5v4" />
      <Sbarra />
    </Base>
  )
}

/** Cinque barre audio. Quando `attiva` e' vero respirano come un misuratore. */
export function OndeAudio({
  attiva = false,
  className,
  ...props
}: Props & { attiva?: boolean }): React.JSX.Element {
  return (
    <Base
      {...props}
      className={`${className ?? 'h-5 w-5'} onde-audio${attiva ? ' onde-audio-attiva' : ''}`}
    >
      <path d="M4 9v6" />
      <path d="M8 6v12" />
      <path d="M12 3.5v17" />
      <path d="M16 6v12" />
      <path d="M20 9v6" />
    </Base>
  )
}

export function Altoparlante(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M11 4.5 6.5 8.5H3v7h3.5L11 19.5z" />
      <path d="M14.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M17 7a7 7 0 0 1 0 10" />
    </Base>
  )
}

export function AltoparlanteMuto(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M11 4.5 6.5 8.5H3v7h3.5L11 19.5z" />
      <path d="m15.5 9.5 5 5" />
      <path d="m20.5 9.5-5 5" />
    </Base>
  )
}

/** Le cuffie: non sento piu' niente da nessuno. */
export function Cuffie(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M4 15.5v-3.5a8 8 0 0 1 16 0v3.5" />
      <rect x="2.5" y="14" width="4.5" height="6" rx="2" />
      <rect x="17" y="14" width="4.5" height="6" rx="2" />
    </Base>
  )
}

export function CuffieSpente(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M4 15.5v-3.5a8 8 0 0 1 16 0v3.5" />
      <rect x="2.5" y="14" width="4.5" height="6" rx="2" />
      <rect x="17" y="14" width="4.5" height="6" rx="2" />
      <Sbarra />
    </Base>
  )
}

/** Le quattro frecce che vanno fuori: a tutto schermo. */
export function SchermoIntero(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M9 3.5H5.5a2 2 0 0 0-2 2V9" />
      <path d="M15 3.5h3.5a2 2 0 0 1 2 2V9" />
      <path d="M15 20.5h3.5a2 2 0 0 0 2-2V15" />
      <path d="M9 20.5H5.5a2 2 0 0 1-2-2V15" />
    </Base>
  )
}

/** Le stesse frecce rivolte dentro: torna alla finestra. */
export function SchermoNormale(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M3.5 9H7a2 2 0 0 0 2-2V3.5" />
      <path d="M20.5 9H17a2 2 0 0 1-2-2V3.5" />
      <path d="M20.5 15H17a2 2 0 0 0-2 2v3.5" />
      <path d="M3.5 15H7a2 2 0 0 1 2 2v3.5" />
    </Base>
  )
}

/** Metti a fuoco: questo riquadro grande, gli altri sotto. */
export function Ingrandisci(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M14.5 3.5h6v6" />
      <path d="M9.5 20.5h-6v-6" />
      <path d="m20.5 3.5-7 7" />
      <path d="m3.5 20.5 7-7" />
    </Base>
  )
}

/** Togli il fuoco: tutti nella griglia. */
export function Rimpicciolisci(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M20.5 9.5h-6v-6" />
      <path d="M3.5 14.5h6v6" />
      <path d="m14.5 9.5 6-6" />
      <path d="m9.5 14.5-6 6" />
    </Base>
  )
}

export function Ingranaggio(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 14.6a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Base>
  )
}

/** La porta con la freccia che esce: via dalla chiamata. */
export function Esci(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M14 3.5h4.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H14" />
      <path d="m8.5 8-4 4 4 4" />
      <path d="M4.5 12h11" />
    </Base>
  )
}

/** Torna a guardare la chiamata che e' rimasta aperta. */
export function Torna(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M20 3.5h-4.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H20" />
      <path d="m8 8 4 4-4 4" />
      <path d="M12 12H3.5" />
    </Base>
  )
}

/** La stella di chi modera. */
export function Stella(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="m12 3.2 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 19.85l1.03-6L3.3 9.6l6-.9z" />
    </Base>
  )
}

/** Una persona con una croce: fuori dalla stanza. */
export function Espelli(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="8.5" cy="7.5" r="3.8" />
      <path d="M2 20.5v-1a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v1" />
      <path d="m17.5 8.5 4.5 4.5" />
      <path d="m22 8.5-4.5 4.5" />
    </Base>
  )
}

export function Chiudi(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="m5.5 5.5 13 13" />
      <path d="m18.5 5.5-13 13" />
    </Base>
  )
}

export function Lente(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </Base>
  )
}

/** Le funzioni AI: una scintilla, non un marchio di un provider specifico. */
export function Scintille(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 2.8c.7 4.3 2.9 6.5 7.2 7.2-4.3.7-6.5 2.9-7.2 7.2-.7-4.3-2.9-6.5-7.2-7.2 4.3-.7 6.5-2.9 7.2-7.2Z" />
      <path d="M19 16.5c.25 1.4 1.1 2.25 2.5 2.5-1.4.25-2.25 1.1-2.5 2.5-.25-1.4-1.1-2.25-2.5-2.5 1.4-.25 2.25-1.1 2.5-2.5Z" />
    </Base>
  )
}

/** Un'immagine generata o trovata: il significato lo completa il pulsante. */
export function Immagine(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4.5 17 4.8-4.8 3.2 3.2 2.2-2.2 4.8 4.8" />
    </Base>
  )
}

/** La ricerca web dell'assistente, distinta dalla ricerca di sole immagini. */
export function Globo(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
      <path d="M12 3c2.2 2.4 3.4 5.4 3.4 9S14.2 18.6 12 21c-2.2-2.4-3.4-5.4-3.4-9S9.8 5.4 12 3Z" />
    </Base>
  )
}

/** Il cancelletto dei canali di testo. */
export function Cancelletto(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M9.5 3.5 7.5 20.5" />
      <path d="M16.5 3.5 14.5 20.5" />
      <path d="M4 9h16" />
      <path d="M3.5 15h16" />
    </Base>
  )
}

export function Piu(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  )
}

export function Spunta(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Base>
  )
}

export function Cestino(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
      <path d="M10.5 10v6.5" />
      <path d="M13.5 10v6.5" />
    </Base>
  )
}

export function Matita(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M16.5 3.9a2 2 0 0 1 2.8 2.8L8.4 17.6l-3.9 1.1 1.1-3.9z" />
      <path d="m14.8 5.6 3.6 3.6" />
    </Base>
  )
}

/** La freccia che rientra: rispondi, e la citazione sopra al messaggio. */
export function Rispondi(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="m9 5.5-5.5 5.5L9 16.5" />
      <path d="M3.5 11h10a7 7 0 0 1 7 7v.5" />
    </Base>
  )
}

export function Emoji(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9.5 9.5v.01" />
      <path d="M14.5 9.5v.01" />
    </Base>
  )
}

export function Graffetta(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />
    </Base>
  )
}

export function Giu(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 4.5v15" />
      <path d="m5.5 13 6.5 6.5 6.5-6.5" />
    </Base>
  )
}

/** Una persona: il profilo, nelle impostazioni. */
export function Persona(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5v-1a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1" />
    </Base>
  )
}

/** La freccia che torna indietro con il tempo: riascolta. */
/**
 * Il tondo della registrazione.
 *
 * Due cerchi e non uno: quello pieno da solo si legge come un pallino di
 * stato - e' lo stesso segno che dice «sta parlando» o «e' online» - mentre
 * l'anello attorno lo rende il tasto di un registratore, che e' cio' che tutti
 * hanno gia' imparato da qualche altra parte.
 */
export function Registra(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Base>
  )
}

export function Riavvolgi(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M3.5 5.5v5h5" />
      <path d="M4.4 10.5a8 8 0 1 1 .6 5.5" />
    </Base>
  )
}

/** Il lucchetto dei canali privati. */
export function Lucchetto(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </Base>
  )
}

/** Due persone: gli iscritti di un canale, gli amici. */
export function Utenti(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3.6" />
      <path d="M2.5 20.5v-1a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v1" />
      <path d="M16.5 4.8a3.6 3.6 0 0 1 0 6.7" />
      <path d="M18 15h.5a4.5 4.5 0 0 1 3 4.5v1" />
    </Base>
  )
}

/**
 * Una persona con il piu': chiama qualcuno qui dentro.
 *
 * E' l'`Utenti` con la seconda sagoma sostituita da una crocetta. Due persone
 * dicono "gli amici", il piu' dice "aggiungine uno": messe insieme dicono la
 * cosa senza bisogno di leggere il nome del pulsante, che e' il punto di
 * un'icona che compare solo quando serve.
 */
export function UtentiPiu(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="9.5" cy="8" r="3.6" />
      <path d="M3 20.5v-1a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v1" />
      <path d="M19 6.5v5" />
      <path d="M16.5 9h5" />
    </Base>
  )
}

/** La campanella: avvisami quando questa persona entra in un vocale. */
export function Campanella(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </Base>
  )
}

export function CampanellaSpenta(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
      <Sbarra />
    </Base>
  )
}

/** La freccetta verso l'alto dei sottomenu della barra. */
export function Su(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="m6 14 6-6 6 6" />
    </Base>
  )
}

/** Le condivisioni aperte: due rettangoli sovrapposti. */
export function Pile(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="3" y="7" width="13" height="10" rx="1.6" />
      <path d="M8 4h11a1.6 1.6 0 0 1 1.6 1.6v9" />
    </Base>
  )
}

/** La chat del canale: un fumetto. */
/**
 * Il fumetto della chat.
 *
 * Rettangolo arrotondato con la codina in basso a sinistra, e non la goccia
 * asimmetrica che c'era prima: quella, ruotata come stava, sembrava tutto
 * fuorche' un fumetto. I tre puntini dentro servono a distinguerlo da un
 * riquadro qualunque nelle misure piccole, dove la codina da sola si perde.
 */
export function Fumetto(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M4.5 4.5h15a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-8.2L7 19.8V16H4.5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" />
      <path d="M7.6 10.3h.01M12 10.3h.01M16.4 10.3h.01" />
    </Base>
  )
}

/**
 * Le onde degli audio condivisi: quattro barrette verticali.
 *
 * Si muovono quando almeno una traccia sta suonando davvero, e stanno ferme
 * quando sono tutte mute o a volume zero. Il movimento e' l'unico modo per
 * dire a colpo d'occhio che da qui sta uscendo del suono: un'icona ferma
 * accanto a un numero non distingue "tre tracce che suonano" da "tre tracce
 * silenziate".
 *
 * L'animazione e' dentro all'SVG e non in CSS: cosi' l'icona si porta dietro
 * il proprio movimento, e chi la usa non deve ricordarsi di importare niente.
 *
 * Le altezze a riposo sono diverse fra loro di proposito — quattro barrette
 * uguali sembrano un codice a barre, non un suono.
 */
export function Onde({
  attivo = false,
  className = 'h-5 w-5',
  ...resto
}: Props & { attivo?: boolean }): React.JSX.Element {
  const barre = [
    { x: 4, riposo: 8, alta: 16, ritardo: '0s' },
    { x: 9.5, riposo: 14, alta: 20, ritardo: '.18s' },
    { x: 15, riposo: 6, alta: 18, ritardo: '.36s' },
    { x: 20.5, riposo: 11, alta: 15, ritardo: '.54s' }
  ]

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...resto}
    >
      {barre.map((b) => {
        const basso = b.riposo * 0.45
        return (
          <rect
            key={b.x}
            x={b.x - 1.5}
            width="3"
            rx="1.5"
            fill="currentColor"
            y={12 - b.riposo / 2}
            height={b.riposo}
          >
            {attivo && (
              <>
                <animate
                  attributeName="height"
                  values={`${b.riposo};${b.alta};${basso};${b.riposo}`}
                  dur="1.1s"
                  begin={b.ritardo}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="y"
                  values={`${12 - b.riposo / 2};${12 - b.alta / 2};${12 - basso / 2};${12 - b.riposo / 2}`}
                  dur="1.1s"
                  begin={b.ritardo}
                  repeatCount="indefinite"
                />
              </>
            )}
          </rect>
        )
      })}
    </svg>
  )
}

/** Il calendario degli eventi. */
export function Calendario(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 2.5v4M16 2.5v4" />
    </Base>
  )
}

/** La cornetta: chiamare. */
export function Telefono(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M7.5 3.5 9.8 8l-2 2a13 13 0 0 0 6.2 6.2l2-2 4.5 2.3v3a1.5 1.5 0 0 1-1.7 1.5C10.4 20 4 13.6 3 4.7A1.5 1.5 0 0 1 4.5 3h3Z" />
    </Base>
  )
}

/** La cornetta girata: riagganciare. La sbarra dice che si chiude. */
export function TelefonoGiu(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M7.5 3.5 9.8 8l-2 2a13 13 0 0 0 6.2 6.2l2-2 4.5 2.3v3a1.5 1.5 0 0 1-1.7 1.5C10.4 20 4 13.6 3 4.7A1.5 1.5 0 0 1 4.5 3h3Z" />
      <Sbarra />
    </Base>
  )
}

/** Il triangolo di chi riparte. */
export function Play(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M7 4.5 19.5 12 7 19.5Z" />
    </Base>
  )
}

/** Le due barre di chi si ferma. */
export function Pausa(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M8.5 4.5v15M15.5 4.5v15" />
    </Base>
  )
}

/** Al prossimo della coda. */
export function Avanti(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M6 4.5 16 12 6 19.5Z" />
      <path d="M18.5 4.5v15" />
    </Base>
  )
}

/** La nota: la sessione musicale. */
export function Nota(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </Base>
  )
}

/** Lo schermo con il triangolo dentro: guardare un video insieme. */
export function Video(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <path d="M10 9.5 15 12l-5 2.5Z" />
    </Base>
  )
}

/** Lo scudo dei ruoli. */
/**
 * La trascrizione: un riquadro con dentro due righe di parole.
 *
 * E' la forma dei sottotitoli, che e' la cosa piu' vicina a "quello che
 * dite diventa testo" che si possa disegnare in ventiquattro pixel. Un
 * microfono avrebbe detto "audio", una matita "scrivi tu".
 */
export function Sottotitoli(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M6 11h5" />
      <path d="M13 11h5" />
      <path d="M6 15h8" />
    </Base>
  )
}

export function Scudo(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 2.5 20 5.5v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6Z" />
    </Base>
  )
}

/** L'anello di catena: un invito da copiare. */
export function Catena(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" />
    </Base>
  )
}

/** Il chevron: apre e chiude un menu o una sezione. */
export function Chevron(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Base>
  )
}

/** Tre righe: apre la navigazione sui telefoni. */
export function Menu(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </Base>
  )
}

/** Le tre righe di una cartella: le categorie. */
export function Cartella(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M3 6.5A2 2 0 0 1 5 4.5h4l2 2.5h6a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Base>
  )
}

/**
 * La tavolozza del pittore: i colori dell'app.
 *
 * Il buco per il pollice e' quello che la rende riconoscibile a venti pixel —
 * senza, resta un cerchio schiacciato con dentro dei punti, cioe' un'icona
 * qualunque. I quattro punti sono i quattro accenti, nell'ordine in cui la
 * pagina li mostra.
 */
export function Tavolozza(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 2.6c5.2 0 9.4 3.8 9.4 8.5 0 2.6-2.1 4.1-4.3 4.1h-1.6c-1.2 0-2.1.9-2.1 2 0 .5.2.9.5 1.3.3.4.5.8.5 1.3 0 1-.9 1.6-2.4 1.6-5.2 0-9.4-4.2-9.4-9.4S6.8 2.6 12 2.6Z" />
      <circle cx="7.6" cy="11.4" r="1.05" />
      <circle cx="10.4" cy="7.2" r="1.05" />
      <circle cx="15.2" cy="7.4" r="1.05" />
      <circle cx="17.6" cy="11.2" r="1.05" />
    </Base>
  )
}

/** Il quadretto con la spunta: segna come letto. */
export function Letto(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M2.5 12.5 7 17 14 8" />
      <path d="M11 15.5 12.5 17 21.5 6" />
    </Base>
  )
}

/**
 * Il triangolo dell'attenzione e il cerchio dell'errore.
 *
 * Due forme diverse e non due colori diversi della stessa: il colore da solo
 * non basta a chi non lo distingue, e queste due icone stanno spesso una
 * accanto all'altra con dentro un numero — se differissero solo per la tinta
 * sarebbero due numeri senza etichetta.
 */
/**
 * La macchina vera: due unita' impilate con la loro spia.
 *
 * Serve a distinguerla dallo *spazio*, che nel resto dell'interfaccia si
 * disegna con le sue iniziali colorate. Sono due cose che l'abitudine di
 * Discord porta a chiamare tutte e due "server", e l'unico modo per non
 * confonderle e' che non si somiglino.
 */
export function Macchina(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Base>
  )
}

export function Attenzione(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M12 3.6 21.2 19.4a1 1 0 0 1-.87 1.5H3.67a1 1 0 0 1-.87-1.5Z" />
      <path d="M12 9.6v4.2" />
      <path d="M12 17.2h.01" />
    </Base>
  )
}

export function Errore(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.4v5.2" />
      <path d="M12 16.4h.01" />
    </Base>
  )
}

/**
 * La spunta doppia delle ricevute.
 *
 * Due segni sfalsati e non due sovrapposti: sovrapposti, alla misura in cui
 * stanno accanto a un orario, diventano una macchia indistinguibile dalla
 * spunta singola — e distinguerle e' l'unica ragione per cui esistono.
 */
export function SpuntaDoppia(props: Props): React.JSX.Element {
  return (
    <Base {...props}>
      <path d="M2 12.6 6.2 17 13.6 8" />
      <path d="M9.6 13.2 11.4 15.2 19.2 6" />
    </Base>
  )
}
