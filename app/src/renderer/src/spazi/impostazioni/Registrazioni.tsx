import { useEffect, useState } from 'react'
import type { Api, RigaRegistrazione } from '../../lib/api'
import type { Spazio } from '@shared/tipi'
import { Avviso, Sezione } from '../../ui'

/**
 * Chi ha registrato qui dentro, e in che condizioni.
 *
 * Non e' una statistica: e' la risposta a una domanda che prima o poi arriva,
 * e che senza questa pagina non ha nessuna risposta se non il ricordo di
 * qualcuno. «Chi mi ha registrato il 4 marzo» e' una domanda legittima di chi
 * e' stato registrato, e un programma che permette di registrare senza saperla
 * rispondere sta scaricando il problema su chi lo usa.
 *
 * Le due colonne che contano sono le ultime. **Presenti** e **con il consenso**
 * sono contati al momento dell'avvio e restano: dicono se quella registrazione
 * e' cominciata con tutti d'accordo o con meta' stanza che non aveva risposto,
 * ed e' esattamente la differenza fra un file che si puo' tenere e uno no.
 *
 * Quello che questa pagina **non** puo' dire, e che sta scritto in fondo: chi
 * usa un programma modificato o apre OBS di fianco non lascia nessuna riga.
 * Prometterlo sarebbe peggio che non avere la pagina.
 */
export default function Registrazioni({
  api,
  spazio
}: {
  api: Api
  spazio: Spazio
}): React.JSX.Element {
  const [righe, setRighe] = useState<RigaRegistrazione[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    api
      .registrazioniDelloSpazio(spazio.id)
      .then((r) => vivo && setRighe(r.registrazioni))
      .catch((e) => vivo && setErrore((e as Error).message))
    return () => {
      vivo = false
    }
  }, [api, spazio.id])

  return (
    <Sezione
      titolo="Registrazioni"
      sotto="Chi ha registrato una chiamata in questo spazio, e in che condizioni ha cominciato."
    >
      {errore && <Avviso>{errore}</Avviso>}

      {righe && righe.length === 0 && (
        <p className="text-sm text-testo-3">
          Qui dentro non ha ancora registrato nessuno.
        </p>
      )}

      {righe && righe.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-testo-3 uppercase">
                <th className="py-2 pr-3 font-medium">Quando</th>
                <th className="py-2 pr-3 font-medium">Chi</th>
                <th className="py-2 pr-3 font-medium">Dove</th>
                <th className="py-2 pr-3 font-medium">Cosa</th>
                <th className="py-2 pr-3 font-medium">Quanto</th>
                <th className="py-2 pl-3 text-right font-medium">Consenso</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.id} className="border-t border-bordo">
                  <td className="numeri py-2 pr-3 text-testo-2">{quando(r.avviata)}</td>
                  <td className="truncate py-2 pr-3">{r.nome}</td>
                  <td className="truncate py-2 pr-3 text-testo-2">{r.canaleNome ?? '—'}</td>
                  <td className="py-2 pr-3 text-testo-2">
                    {r.cosa === 'chiamata' ? 'La chiamata' : 'Una condivisione'}
                  </td>
                  <td className="numeri py-2 pr-3 text-testo-2">
                    {r.chiusa ? durata(r.chiusa - r.avviata) : 'in corso'}
                  </td>
                  {/* Il colore dice la sola cosa che conta a colpo d'occhio:
                      erano tutti d'accordo, o no. */}
                  <td
                    className={`numeri py-2 pl-3 text-right ${
                      r.consensi >= r.presenti ? 'text-ok' : 'text-attenzione'
                    }`}
                    title={
                      r.consensi >= r.presenti
                        ? 'Tutti i presenti avevano acconsentito'
                        : 'Qualcuno in stanza non aveva acconsentito: la sua voce non e\' nel file, la sua immagine si\' se la registrazione era della chiamata intera'
                    }
                  >
                    {r.consensi} su {r.presenti}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-testo-3">
        La riga la scrive PulseTalk quando qualcuno preme «registra», e con lei parte un tono che
        sentono tutti in stanza. Chi usa un programma modificato, o apre un registratore di
        schermo di fianco, non lascia nessuna riga: questo elenco dice cosa e&rsquo; successo
        passando dalla strada normale, che e&rsquo; l&rsquo;unica che si possa pretendere.
      </p>
    </Sezione>
  )
}

function quando(secondi: number): string {
  const data = new Date(secondi * 1000)
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${due(data.getDate())}/${due(data.getMonth() + 1)} ${due(data.getHours())}:${due(
    data.getMinutes()
  )}`
}

function durata(secondi: number): string {
  if (secondi < 60) return `${Math.max(0, Math.round(secondi))}s`
  const minuti = Math.round(secondi / 60)
  if (minuti < 60) return `${minuti}m`
  return `${Math.floor(minuti / 60)}h ${minuti % 60}m`
}
