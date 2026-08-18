import { BottoneIcona } from '../ui'
import {
  Camera,
  CameraSpenta,
  Cuffie,
  CuffieSpente,
  Esci,
  Ingranaggio,
  Microfono,
  MicrofonoSpento,
  Riavvolgi,
  SchermoCondividi,
  SchermoIntero,
  SchermoNormale,
  SchermoStop
} from '../icone'
import { BottoneVolume } from './Volume'

/**
 * La barra in basso.
 *
 * Solo icone, e ognuna con il suo nome sotto al puntatore. Non e' una moda: e'
 * una barra che deve restare leggibile anche stretta a meta' schermo, e delle
 * parole a quel punto o si accorciano fino a non dire piu' niente o vanno a
 * capo e spingono via il pulsante per uscire. Un microfono sbarrato invece si
 * riconosce di lato, e non diventa "Micr…".
 *
 * Il colore dice lo stato, e dice sempre la stessa cosa: verde acceso e
 * funzionante, rosso spento o interrotto, grigio a riposo.
 */
export default function Barra({
  riascoltoAttivo,
  riascoltoInCorso,
  secondiRiascolto,
  riascolta,
  microfonoAcceso,
  cameraAccesa,
  sordina,
  volumeGenerale,
  schermiAttivi,
  puoTrasmettere,
  schermoIntero,
  alternaMicrofono,
  alternaCamera,
  alternaSordina,
  impostaVolumeGenerale,
  apriCondivisione,
  smettiDiCondividere,
  apriImpostazioni,
  esci
}: {
  riascoltoAttivo: boolean
  riascoltoInCorso: boolean
  secondiRiascolto: number
  riascolta: () => void
  microfonoAcceso: boolean
  cameraAccesa: boolean
  sordina: boolean
  volumeGenerale: number
  schermiAttivi: { id: string; etichetta: string }[]
  puoTrasmettere: boolean
  schermoIntero: { attivo: boolean; alterna: () => void }
  alternaMicrofono: () => void
  alternaCamera: () => void
  alternaSordina: () => void
  impostaVolumeGenerale: (volume: number) => void
  apriCondivisione: () => void
  smettiDiCondividere: (id?: string) => void
  apriImpostazioni: () => void
  esci: () => void
}): React.JSX.Element {
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-bordo bg-fondo-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {puoTrasmettere && (
          <>
            <BottoneIcona
              tono={microfonoAcceso ? 'acceso' : 'male'}
              onClick={alternaMicrofono}
              title={
                microfonoAcceso
                  ? 'Microfono acceso — Ctrl+Shift+M, anche con l\'app dietro'
                  : 'Microfono spento — Ctrl+Shift+M, anche con l\'app dietro'
              }
            >
              {microfonoAcceso ? <Microfono /> : <MicrofonoSpento />}
            </BottoneIcona>

            <BottoneIcona
              tono={cameraAccesa ? 'acceso' : 'normale'}
              onClick={alternaCamera}
              title={cameraAccesa ? 'Spegni la camera' : 'Accendi la camera'}
            >
              {cameraAccesa ? <Camera /> : <CameraSpenta />}
            </BottoneIcona>

            <BottoneIcona
              tono={schermiAttivi.length > 0 ? 'acceso' : 'normale'}
              onClick={apriCondivisione}
              title={schermiAttivi.length > 0 ? 'Condividi un altro schermo' : 'Condividi lo schermo'}
            >
              <SchermoCondividi />
            </BottoneIcona>

            {/* Un pulsante per ogni schermo aperto: con due monitor condivisi
                insieme, "smetti di condividere" da solo non basterebbe a dire
                quale dei due. */}
            {schermiAttivi.map((schermo) => (
              <BottoneIcona
                key={schermo.id}
                tono="male"
                onClick={() => smettiDiCondividere(schermo.id)}
                title={`Smetti di condividere ${schermo.etichetta}`}
              >
                <SchermoStop />
              </BottoneIcona>
            ))}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {riascoltoAttivo && (
          <BottoneIcona
            tono={riascoltoInCorso ? 'acceso' : 'normale'}
            onClick={riascolta}
            title={`Riascolta gli ultimi ${secondiRiascolto} secondi — Ctrl+Shift+R`}
          >
            <Riavvolgi />
          </BottoneIcona>
        )}

        <BottoneVolume
          voci={[
            {
              chiave: 'tutti',
              nome: 'tutti',
              volume: volumeGenerale,
              muto: sordina,
              cambia: impostaVolumeGenerale,
              alternaMuto: alternaSordina
            }
          ]}
          titolo="Volume di tutta la stanza"
        />

        <BottoneIcona
          tono={sordina ? 'male' : 'normale'}
          onClick={alternaSordina}
          title={
            sordina
              ? 'Non senti nessuno — Ctrl+Shift+D, anche con l\'app dietro'
              : 'Smetti di sentire tutti — Ctrl+Shift+D, anche con l\'app dietro'
          }
        >
          {sordina ? <CuffieSpente /> : <Cuffie />}
        </BottoneIcona>

        <BottoneIcona
          tono={schermoIntero.attivo ? 'acceso' : 'normale'}
          onClick={schermoIntero.alterna}
          title={schermoIntero.attivo ? 'Esci da tutto schermo (Esc)' : 'A tutto schermo'}
        >
          {schermoIntero.attivo ? <SchermoNormale /> : <SchermoIntero />}
        </BottoneIcona>

        <BottoneIcona tono="fantasma" onClick={apriImpostazioni} title="Impostazioni">
          <Ingranaggio />
        </BottoneIcona>

        <BottoneIcona tono="male" onClick={esci} title="Esci dalla chiamata">
          <Esci />
        </BottoneIcona>
      </div>
    </footer>
  )
}
