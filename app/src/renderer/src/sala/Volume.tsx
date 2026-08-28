import { Altoparlante, AltoparlanteMuto } from '../icone'

/**
 * Il volume di qualcuno, o di tutti.
 *
 * Due forme, e una sola strada per arrivarci. Il pannello col cursore vive nel
 * menu del tasto destro; sopra ai riquadri c'e' l'interruttore e basta. Il
 * fumetto col cursore che si apriva dal riquadro non c'e' piu': vedi
 * `BottoneMuto`.
 *
 * Il muto e' un pulsante separato dal cursore, e non il cursore a zero. Chi
 * zittisce qualcuno per due minuti vuole ritrovarlo dov'era, e muovere il
 * cursore di uno zittito lo riaccende — perche' e' quello che uno intende
 * facendolo.
 *
 * Il massimo e' cento e non duecento. Il volume di un <audio> vive fra 0 e 1, e
 * un valore piu' alto non viene ignorato: solleva un'eccezione. Amplificare
 * davvero vorrebbe dire far passare ogni voce dentro a un AudioContext, e la
 * cancellazione dell'eco di Chrome funziona peggio quando il suono non esce da
 * un elemento normale. Meglio un cursore che dice la verita' su quello che fa.
 */

export interface VoceVolume {
  chiave: string
  /** Cosa si sta regolando: "voce", "schermo", "tutti". */
  nome: string
  volume: number
  muto: boolean
  cambia: (volume: number) => void
  alternaMuto: () => void
}

export function PannelloVolume({ voci }: { voci: VoceVolume[] }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      {voci.map((voce) => (
        <div key={voce.chiave} className="flex items-center gap-1.5">
          <button
            onClick={voce.alternaMuto}
            title={voce.muto ? `Riattiva: ${voce.nome}` : `Zittisci: ${voce.nome}`}
            aria-label={voce.muto ? `Riattiva: ${voce.nome}` : `Zittisci: ${voce.nome}`}
            className={`shrink-0 rounded p-1 transition-colors ${
              voce.muto ? 'text-male hover:bg-male/15' : 'text-testo-3 hover:bg-fondo-3 hover:text-testo'
            }`}
          >
            {voce.muto ? (
              <AltoparlanteMuto className="h-4 w-4" />
            ) : (
              <Altoparlante className="h-4 w-4" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={voce.volume}
            onChange={(e) => voce.cambia(Number(e.target.value))}
            title={voce.nome}
            aria-label={voce.nome}
            className={`h-1 min-w-0 flex-1 accent-vivo ${voce.muto ? 'opacity-40' : ''}`}
          />

          <span
            className={`numeri w-9 shrink-0 text-right text-[11px] ${
              voce.muto ? 'text-male' : 'text-testo-3'
            }`}
          >
            {voce.muto ? 'muto' : `${Math.round(voce.volume * 100)}%`}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * L'altoparlante e basta: acceso o spento, senza cursore.
 *
 * Sta sopra a tutti i riquadri — condivisioni e persone — perche' il fumetto
 * col cursore era la scelta sbagliata dappertutto. Si preme per un motivo
 * solo: far tacere qualcosa, subito. Una notifica, un video partito da solo,
 * qualcuno che sta mangiando. E si preme di fretta; un fumetto che si apre
 * chiede un secondo clic per fare quella cosa li', e intanto copre un pezzo
 * di quello che si stava guardando.
 *
 * Il livello preciso non sparisce: sta nel menu del tasto destro, insieme a
 * tutto il resto che si regola di rado. Un gesto per la cosa frequente, un
 * altro per quella rara.
 */
export function BottoneMuto({
  voci,
  titolo
}: {
  voci: VoceVolume[]
  /** Cosa si sta zittendo, per il nome del pulsante. */
  titolo: string
}): React.JSX.Element {
  const zittito = voci.every((v) => v.muto || v.volume === 0)
  const nome = zittito ? `Riattiva ${titolo}` : `Zittisci ${titolo}`

  return (
    <button
      onClick={(evento) => {
        evento.stopPropagation()
        // Con piu' di una voce si spengono e si riaccendono insieme: il
        // pulsante ne mostra una sola, e lasciarne indietro una vorrebbe dire
        // un'icona che dice "acceso" sopra a qualcosa che non si sente.
        for (const v of voci) if (v.muto === zittito) v.alternaMuto()
      }}
      title={`${nome} — il livello preciso sta nel menu del tasto destro`}
      aria-label={nome}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-sm transition-colors ${
        zittito
          ? 'bg-male/70 text-white hover:bg-male/85'
          : 'bg-black/55 text-white/85 hover:bg-black/80 hover:text-white'
      }`}
    >
      {zittito ? <AltoparlanteMuto className="h-4 w-4" /> : <Altoparlante className="h-4 w-4" />}
    </button>
  )
}
