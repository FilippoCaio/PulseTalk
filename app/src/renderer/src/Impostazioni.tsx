import { useEffect, useRef, useState } from 'react'
import type {
  Impostazioni,
  PosizioneStriscia,
  Sessione,
  StatoEmail,
  StatoAggiornamento,
  StatoUtente,
  Utente
} from '@shared/tipi'
import {
  bitrateLeggibile,
  PRESET_CAMERA,
  PRESET_SCHERMO,
  PROFILI_AUDIO,
  type ModoAudio
} from '@shared/qualita'
import type { Api } from './lib/api'
import { coloreDi, inizialiDi } from './lib/avatar'
import { ponte } from './ponte'
import { STATI } from './PopupProfilo'
import { avviaProva, type Prova } from './lib/provaMicrofono'
import { usaMisuratore } from './lib/misuratoreMicrofono'
import { scegli, usaDispositivi, vociTendina } from './lib/usaDispositivi'
import { Avviso, Bottone, BottoneIcona, Campo, classiInput, Interruttore, Sezione } from './ui'
import { Altoparlante, Camera, Chiudi, Esci, Ingranaggio, Persona, Scintille, Scudo } from './icone'
import { ImpostazioniServer, MiaAi } from './ChiaviAi'
import { configuraSuoni, suona } from './lib/suoni'

/**
 * Le impostazioni.
 *
 * Si apre anche durante una chiamata, e i cambiamenti che si possono applicare
 * a caldo si applicano subito; quelli che vogliono una riaccensione lo dicono,
 * invece di far credere che siano attivi.
 */
export default function PannelloImpostazioni({
  api,
  impostazioni,
  utente,
  salva,
  inChiamata,
  chiudi,
  esciDallAccount,
  quandoCambiaUtente,
  apriServer,
  paginaIniziale
}: {
  api: Api
  impostazioni: Impostazioni
  utente: Utente
  salva: (modifiche: Partial<Impostazioni>) => Promise<Impostazioni>
  inChiamata: boolean
  chiudi: () => void
  esciDallAccount: () => Promise<void>
  quandoCambiaUtente: (utente: Utente) => void
  /** Apre l'elenco dei server veri. Il pannello vive fuori da qui. */
  apriServer?: () => void
  /** Con quale sezione aprirsi. Senza, quella di sempre. */
  paginaIniziale?: Pagina
}): React.JSX.Element {
  // L'elenco arriva dall'hook, che ne teneva gia' una copia identica per la
  // barra della chiamata — con in piu' l'ascolto di `devicechange`, che qui
  // mancava: le cuffie attaccate a pannello aperto adesso compaiono da sole.
  const { tutti } = usaDispositivi()
  const [confermaUscita, setConfermaUscita] = useState(false)

  // Chi arriva da "Il tuo profilo" nel pannellino in basso a sinistra deve
  // trovarsi gia' sulla sua pagina: farlo atterrare sull'audio e poi cercare
  // e' esattamente il passaggio in piu' che quel pannellino esiste per
  // togliere.
  const [pagina, setPagina] = useState<Pagina>(paginaIniziale ?? 'audio')

  const profilo = PROFILI_AUDIO[impostazioni.modoAudio]

  return (
    <div
      className="velo absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm sm:p-6"
      onClick={chiudi}
    >
      <div
        className="pannello flex h-full w-full max-w-4xl flex-col overflow-hidden border border-bordo bg-fondo-2 sm:h-[min(46rem,88vh)] sm:flex-row sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* La colonna delle sezioni.
            Qui le parole restano parole: un elenco di sezioni fatto di sole
            icone si impara a memoria, e le impostazioni si aprono una volta al
            mese — il tempo esatto per dimenticarsele. */}
        <nav className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-bordo bg-fondo p-2 sm:block sm:w-52 sm:space-y-0.5 sm:overflow-y-auto sm:border-r sm:border-b-0">
          {PAGINE.filter((p) => !p.soloAdmin || utente.ruolo === 'admin').map(({ id, nome, Icona }) => (
            <button
              key={id}
              onClick={() => setPagina(id)}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors sm:w-full ${
                pagina === id
                  ? 'bg-fondo-3 text-testo'
                  : 'text-testo-2 hover:bg-fondo-3/60 hover:text-testo'
              }`}
            >
              <Icona className="h-4 w-4 shrink-0 text-testo-3" />
              {nome}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-bordo px-5 py-4">
            <h2 className="font-semibold">{PAGINE.find((p) => p.id === pagina)?.nome}</h2>
            <BottoneIcona tono="fantasma" onClick={chiudi} title="Chiudi le impostazioni">
              <Chiudi />
            </BottoneIcona>
          </header>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-4 sm:p-5">
            {pagina === 'audio' && (
              <>
                <Sezione
                  titolo="Entrata"
                  sotto="Il tuo microfono: quale, e quanto forte esce da te."
                >
                  <Campo etichetta="Microfono">
                    <select
                      className={classiInput}
                      value={impostazioni.microfonoId ?? ''}
                      onChange={(e) => void salva(scegli('microfono', tutti, e.target.value))}
                    >
                      <option value="">Predefinito di Windows</option>
                      {vociTendina('microfono', tutti, impostazioni).map((voce) => (
                        <option key={voce.id} value={voce.id} disabled={voce.assente}>
                          {voce.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  <Cursore
                    etichetta="Volume in entrata"
                    aiuto="Un guadagno vero, applicato prima che la voce parta. Sopra il 100% si alza
                      davvero — e' l'unica strada per un microfono debole — ma oltre il 150% sale anche
                      il fruscio insieme alla voce. Si sposta durante una chiamata, senza interruzioni."
                    valore={impostazioni.volumeMicrofono ?? 1}
                    minimo={0}
                    massimo={2}
                    passo={0.05}
                    cambia={(v) => void salva({ volumeMicrofono: v })}
                  />

                  <ProvaMicrofono
                    dispositivoId={impostazioni.microfonoId ?? null}
                    dispositivoNome={impostazioni.microfonoNome ?? null}
                    soglia={impostazioni.sogliaMicrofono ?? 0}
                    cambiaSoglia={(v) => void salva({ sogliaMicrofono: v })}
                    inChiamata={inChiamata}
                  />

                  <Interruttore
                    acceso={impostazioni.microfonoAllIngresso}
                    cambia={(v) => void salva({ microfonoAllIngresso: v })}
                    titolo="Entra con il microfono acceso"
                    sotto="Acceso, si entra parlando. Spento, il microfono viene comunque preparato ma
                      resta zittito: fuori non esce niente, e al primo clic si parla senza aspettare che
                      Windows apra il dispositivo."
                  />

                  <Interruttore
                    acceso={impostazioni.disattivaMediaCambioCanale ?? false}
                    cambia={(v) => void salva({ disattivaMediaCambioCanale: v })}
                    titolo="Spegni audio e video quando cambio canale"
                    sotto="Nel passaggio diretto fra due canali vocali, il nuovo canale parte sempre con
                      microfono e videocamera spenti. Non cambia i dispositivi scelti ne' la semplice
                      navigazione fra canali testuali."
                  />

                  <Interruttore
                    acceso={impostazioni.mostraAnteprimeLink ?? true}
                    cambia={(v) => void salva({ mostraAnteprimeLink: v })}
                    titolo="Carica automaticamente le anteprime dei link"
                    sotto="Il server legge titolo e immagine con protezione dalla rete privata. Se spento, il link resta semplice e l'anteprima viene richiesta solo passandoci sopra."
                  />
                </Sezione>

                <Sezione titolo="Uscita" sotto="Quello che arriva dagli altri, e da dove esce.">
                  <Campo etichetta="Altoparlanti">
                    <select
                      className={classiInput}
                      value={impostazioni.altoparlanteId ?? ''}
                      onChange={(e) => void salva(scegli('altoparlante', tutti, e.target.value))}
                    >
                      <option value="">Predefiniti di Windows</option>
                      {vociTendina('altoparlante', tutti, impostazioni).map((voce) => (
                        <option key={voce.id} value={voce.id} disabled={voce.assente}>
                          {voce.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  <Cursore
                    etichetta="Volume in uscita"
                    aiuto="Vale per tutti insieme, e si moltiplica con i volumi delle singole persone.
                      Si ferma a 100%: un elemento audio non accetta di piu', e per alzare oltre
                      bisognerebbe far passare ogni voce dentro a un AudioContext — con l'eco di Chrome
                      che comincia a tornare indietro."
                    valore={impostazioni.volumeUscita ?? 1}
                    minimo={0}
                    massimo={1}
                    passo={0.02}
                    cambia={(v) => void salva({ volumeUscita: v })}
                  />
                </Sezione>

                <Sezione
                  titolo="Come suona"
                  sotto="La differenza fra parlare e suonare, e sono davvero due mestieri diversi."
                >
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['voce', 'Voce', 'Eco cancellata, rumore soppresso. Per le riunioni.'],
                        ['musica', 'Musica', 'Tutto spento, stereo, 510 kbit/s. Vuole le cuffie.']
                      ] as [ModoAudio, string, string][]
                    ).map(([valore, nome, sotto]) => (
                      <button
                        key={valore}
                        onClick={() => void salva({ modoAudio: valore })}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          impostazioni.modoAudio === valore
                            ? 'border-vivo bg-vivo/10'
                            : 'border-bordo bg-fondo hover:border-fondo-3'
                        }`}
                      >
                        <span className="block text-sm font-medium">{nome}</span>
                        <span className="mt-1 block text-[11px] leading-snug text-testo-3">
                          {sotto}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="numeri text-[11px] text-testo-3">
                    adesso: {bitrateLeggibile(profilo.bitrate)} ·{' '}
                    {profilo.stereo ? 'stereo' : 'mono'} ·{' '}
                    {profilo.soppressioneRumore ? 'rumore soppresso' : 'nessun filtro'}
                  </p>

                  {inChiamata && (
                    <Avviso tono="neutro">
                      Il modo dell'audio si applica alla prossima accensione del microfono: spegnilo e
                      riaccendilo dalla barra.
                    </Avviso>
                  )}
                </Sezione>

                <Sezione
                  titolo="Riascolto"
                  sotto="La risposta a 'cosa hai detto?', che nessun'altra app ha."
                >
                  <Interruttore
                    acceso={impostazioni.riascolto !== false}
                    cambia={(v) => void salva({ riascolto: v })}
                    titolo="Tieni in memoria gli ultimi secondi di voce"
                    sotto="Un anello di suono che si sovrascrive da solo: niente file, niente disco,
                      niente server, e sparisce uscendo dalla stanza. Ctrl+Shift+R lo risuona, anche
                      mentre stai leggendo una chat. Resta pur sempre la voce di altre persone: finche'
                      e' acceso, la stanza lo dichiara in alto."
                  />

                  <Campo
                    etichetta="Quanto indietro"
                    aiuto="Quanto lontano puoi tornare. La memoria e' quella del computer, non del
                      disco, e si libera uscendo dalla stanza. Cambiarlo mentre sei in chiamata
                      riparte da vuoto: vale per le frasi che verranno, non per quelle gia' dette."
                  >
                    <select
                      className={classiInput}
                      value={impostazioni.secondiRiascolto || 30}
                      onChange={(e) => void salva({ secondiRiascolto: Number(e.target.value) })}
                    >
                      {DURATE_RIASCOLTO.map(({ secondi, nome }) => (
                        <option key={secondi} value={secondi}>
                          {nome} — {memoria(secondi)}
                        </option>
                      ))}
                    </select>
                  </Campo>
                </Sezione>

                <Sezione
                  titolo="Suoni"
                  sotto="Salgono quando qualcosa si apre, scendono quando si chiude."
                >
                  <Interruttore
                    acceso={impostazioni.suoni !== false}
                    cambia={(v) => void salva({ suoni: v })}
                    titolo="Suona le azioni"
                    sotto="Muto, camera, condivisione, chi entra e chi esce. Quello che fanno gli altri
                      suona un'ottava sotto e a meta' volume: la tua azione conferma, la loro avvisa."
                  />

                  <Cursore
                    etichetta="Volume dei suoni"
                    valore={impostazioni.volumeSuoni ?? 0.6}
                    minimo={0}
                    massimo={1}
                    passo={0.05}
                    cambia={(v) => {
                      void salva({ volumeSuoni: v })
                      configuraSuoni({ acceso: impostazioni.suoni !== false, volume: v })
                      suona('entrato')
                    }}
                  />
                </Sezione>
              </>
            )}

            {pagina === 'video' && (
              <>
                <Sezione titolo="Camera">
                  <Campo etichetta="Dispositivo">
                    <select
                      className={classiInput}
                      value={impostazioni.cameraId ?? ''}
                      onChange={(e) => void salva(scegli('camera', tutti, e.target.value))}
                    >
                      <option value="">Predefinita</option>
                      {vociTendina('camera', tutti, impostazioni).map((voce) => (
                        <option key={voce.id} value={voce.id} disabled={voce.assente}>
                          {voce.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  <Campo etichetta="Qualita'">
                    <select
                      className={classiInput}
                      value={impostazioni.presetCamera}
                      onChange={(e) => void salva({ presetCamera: e.target.value })}
                    >
                      {PRESET_CAMERA.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome} — {bitrateLeggibile(p.bitrate)}
                        </option>
                      ))}
                    </select>
                  </Campo>
                </Sezione>

                <Sezione
                  titolo="Disposizione"
                  sotto="Come si mettono i riquadri quando uno e' in sovraimpressione."
                >
                  <Campo
                    etichetta="Gli altri riquadri stanno"
                    aiuto="Su uno schermo largo la striscia di lato lascia tutta l'altezza a quello che
                      stai guardando. Dentro alla stanza puoi anche trascinare un riquadro sopra a un
                      altro per scambiarli di posto."
                  >
                    <select
                      className={classiInput}
                      value={impostazioni.posizioneStriscia ?? 'sotto'}
                      onChange={(e) =>
                        void salva({ posizioneStriscia: e.target.value as PosizioneStriscia })
                      }
                    >
                      <option value="sotto">sotto</option>
                      <option value="sopra">sopra</option>
                      <option value="sinistra">a sinistra</option>
                      <option value="destra">a destra</option>
                    </select>
                  </Campo>
                </Sezione>

                <Sezione titolo="Schermo condiviso">
                  <Campo
                    etichetta="Qualita' di serie"
                    aiuto="Si puo' cambiare anche al volo, ogni volta che si condivide."
                  >
                    <select
                      className={classiInput}
                      value={impostazioni.presetSchermo}
                      onChange={(e) => void salva({ presetSchermo: e.target.value })}
                    >
                      {PRESET_SCHERMO.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome} — {p.altezza === 0 ? 'nativa' : `${p.altezza}p`} {p.fps},{' '}
                          {bitrateLeggibile(p.bitrate)}, {p.codec.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </Campo>

                  <Interruttore
                    acceso={impostazioni.adattaAllaFinestra}
                    cambia={(v) => void salva({ adattaAllaFinestra: v })}
                    titolo="Adatta la qualita' alla dimensione del riquadro"
                    sotto="Spento, quello che ricevi resta alla qualita' che manda chi trasmette, anche in
                      un riquadro piccolo. Acceso, si risparmia banda e il testo in un angolo diventa
                      illeggibile — che e' esattamente quello che fa Discord. Ha effetto alla prossima
                      stanza."
                  />

                  <Interruttore
                    acceso={impostazioni.mostraStatistiche}
                    cambia={(v) => void salva({ mostraStatistiche: v })}
                    titolo="Mostra i numeri veri sui riquadri"
                    sotto="Risoluzione, fotogrammi, bitrate e codec misurati sulla connessione, passando
                      il puntatore sopra a un riquadro. E' l'unico modo per sapere se stai davvero
                      mandando quello che hai chiesto."
                  />

                  <Interruttore
                    acceso={impostazioni.specchiaCamera ?? true}
                    cambia={(v) => void salva({ specchiaCamera: v })}
                    titolo="Specchia la mia anteprima video"
                    sotto="Cambia soltanto come vedi la tua webcam su questo dispositivo. Gli altri
                      ricevono sempre la traccia originale."
                  />
                </Sezione>
              </>
            )}

            {pagina === 'profilo' && (
              <>
                <Profilo api={api} utente={utente} quandoCambia={quandoCambiaUtente} />
                <StatoDiProfilo api={api} utente={utente} quandoCambia={quandoCambiaUtente} />
                <CambioPassword api={api} />
                <Email api={api} />
              </>
            )}

            {pagina === 'app' && (
              <>
                <SezioneAggiornamenti />

                {ponte.elettrone ? (
                  <Sezione titolo="Applicazione">
                    <Interruttore
                      acceso={impostazioni.avvioAutomatico}
                      cambia={(v) => void salva({ avvioAutomatico: v })}
                      titolo="Parti insieme a Windows"
                      sotto="La finestra si apre da sola all'accesso, non resta solo un'icona nella
                        barra."
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <Campo
                        etichetta="Muto"
                        aiuto="Funziona anche con l'app dietro ad altre finestre."
                      >
                        <input
                          className={classiInput}
                          value={impostazioni.scorciatoiaMuto}
                          onChange={(e) => void salva({ scorciatoiaMuto: e.target.value })}
                          spellCheck={false}
                        />
                      </Campo>
                      <Campo etichetta="Sordina">
                        <input
                          className={classiInput}
                          value={impostazioni.scorciatoiaSordina}
                          onChange={(e) => void salva({ scorciatoiaSordina: e.target.value })}
                          spellCheck={false}
                        />
                      </Campo>
                    </div>
                  </Sezione>
                ) : (
                  <Sezione titolo="Applicazione">
                    <Avviso tono="neutro">
                      Avvio automatico e scorciatoie globali esistono solo nell'app installata: sono le
                      due cose che una pagina web non puo' fare, ed e' giusto cosi'.
                    </Avviso>
                  </Sezione>
                )}
              </>
            )}

            {pagina === 'ai' && <MiaAi api={api} />}

            {pagina === 'server' && utente.ruolo === 'admin' && (
              <ImpostazioniServer api={api} server={impostazioni.server} />
            )}

            {pagina === 'account' && (
              <>
                <Sessioni api={api} />
                <CodiceDispositivo api={api} />

                <Sezione titolo="Accesso">
                  <p className="text-sm text-testo-2">
                    {utente.utente ? `@${utente.utente}` : utente.nome} · {utente.ruolo}
                    <span className="mt-0.5 block text-xs text-testo-3">{impostazioni.server}</span>
                  </p>

                  {/* Le credenziali qui sopra valgono per questo server e per
                      nessun altro: e' il posto giusto per ricordare che ce ne
                      possono essere altri, e per andarci. */}
                  {apriServer && (
                    <div className="flex items-center gap-2">
                      <Bottone tono="fantasma" onClick={apriServer}>
                        {impostazioni.serverCollegati.length > 1
                          ? `Cambia server (${impostazioni.serverCollegati.length} collegati)`
                          : 'Collega un altro server'}
                      </Bottone>
                    </div>
                  )}

                  {confermaUscita ? (
                    <div className="space-y-2">
                      <Avviso tono="attenzione">
                        Uscendo, questa sessione viene chiusa sul server e il token dimenticato qui. Per
                        rientrare bastano il tuo nome utente e la tua password — nessun codice nuovo.
                      </Avviso>
                      <div className="flex gap-2">
                        <Bottone tono="male" onClick={() => void esciDallAccount()}>
                          Esci
                        </Bottone>
                        <Bottone tono="fantasma" onClick={() => setConfermaUscita(false)}>
                          Annulla
                        </Bottone>
                      </div>
                    </div>
                  ) : (
                    <Bottone tono="fantasma" onClick={() => setConfermaUscita(true)}>
                      Esci da questo dispositivo
                    </Bottone>
                  )}
                </Sezione>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Quanto indietro puo' arrivare il riascolto.
 *
 * Da una frase a un quarto d'ora. Il costo e' scritto accanto a ogni voce
 * perche' e' l'unica cosa che serve sapere per scegliere: sono megabyte di
 * memoria che restano occupati per tutta la chiamata, e a un quarto d'ora
 * diventano abbastanza da volerlo decidere invece di scoprirlo.
 */
const DURATE_RIASCOLTO = [
  { secondi: 15, nome: '15 secondi — una frase' },
  { secondi: 30, nome: '30 secondi — uno scambio' },
  { secondi: 60, nome: '1 minuto — un discorso intero' },
  { secondi: 120, nome: '2 minuti' },
  { secondi: 300, nome: '5 minuti' },
  { secondi: 600, nome: '10 minuti' },
  { secondi: 900, nome: '15 minuti — mezza riunione' }
]

/**
 * Quanta memoria costa tenere quei secondi.
 *
 * Un campione da due byte a 48 kHz, un canale solo: e' esattamente cio' che
 * alloca `creaRiascolto`. La frequenza vera la decide la scheda audio e puo'
 * essere 44,1 kHz — allora e' un po' meno di cosi', mai di piu'.
 */
function memoria(secondi: number): string {
  const mb = (secondi * 48000 * 2) / (1024 * 1024)
  return mb < 10 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(mb)} MB`
}

type Pagina = 'audio' | 'video' | 'profilo' | 'app' | 'account' | 'ai' | 'server'

const PAGINE: {
  id: Pagina
  nome: string
  Icona: (p: { className?: string }) => React.JSX.Element
  /** Non compare a chi non amministra l'istanza. */
  soloAdmin?: boolean
}[] = [
  { id: 'audio', nome: 'Audio', Icona: Altoparlante },
  { id: 'video', nome: 'Video', Icona: Camera },
  { id: 'profilo', nome: 'Profilo', Icona: Persona },
  { id: 'app', nome: 'Applicazione', Icona: Ingranaggio },
  { id: 'ai', nome: 'La mia AI', Icona: Scintille },
  { id: 'account', nome: 'Account', Icona: Esci },
  // Ultima, e solo per chi amministra: e' la pagina da cui si spegne un
  // servizio per tutti, e non deve stare a un pixel da quelle di tutti i
  // giorni.
  { id: 'server', nome: 'Server', Icona: Scudo, soloAdmin: true }
]

/**
 * Un cursore che scrive su disco solo quando lo lasci.
 *
 * Un `range` manda un evento ogni pixel: legato dritto al salvataggio,
 * trascinarlo da zero a cento vorrebbe dire cento scritture del file delle
 * impostazioni e cento messaggi verso il processo principale. Qui il valore
 * vive nello stato locale mentre lo si muove, e si posa quando si molla.
 */
function Cursore({
  etichetta,
  aiuto,
  valore,
  minimo,
  massimo,
  passo,
  cambia
}: {
  etichetta: string
  aiuto?: string
  valore: number
  minimo: number
  massimo: number
  passo: number
  cambia: (valore: number) => void
}): React.JSX.Element {
  const [locale, setLocale] = useState(valore)

  // Se il valore cambia da fuori — l'altra finestra, un altro pannello — il
  // cursore deve seguirlo invece di restare dov'era.
  useEffect(() => setLocale(valore), [valore])

  const posa = (): void => {
    if (locale !== valore) cambia(locale)
  }

  return (
    <Campo etichetta={etichetta} aiuto={aiuto}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={minimo}
          max={massimo}
          step={passo}
          value={locale}
          onChange={(e) => setLocale(Number(e.target.value))}
          onPointerUp={posa}
          onKeyUp={posa}
          onBlur={posa}
          className="h-1 min-w-0 flex-1 accent-vivo"
        />
        <span className="numeri w-12 shrink-0 text-right text-xs text-testo-3">
          {Math.round(locale * 100)}%
        </span>
      </div>
    </Campo>
  )
}

/**
 * Nome visibile e foto.
 *
 * La foto viene ridimensionata **qui**, prima di partire: 256 pixel bastano
 * per un riquadro video, e mandare al server i dodici megapixel di una foto
 * del telefono per poi mostrarne una miniatura sarebbe una scortesia verso la
 * linea di tutti quelli che poi la scaricano.
 */
function Profilo({
  api,
  utente,
  quandoCambia
}: {
  api: Api
  utente: Utente
  quandoCambia: (utente: Utente) => void
}): React.JSX.Element {
  const [nome, setNome] = useState(utente.nome)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const salva = async (modifiche: { nome?: string; avatar?: string | null }): Promise<void> => {
    setErrore(null)
    setInCorso(true)
    try {
      const { utente: aggiornato } = await api.profilo(modifiche)
      quandoCambia(aggiornato)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  const scegliFoto = async (scelto: File): Promise<void> => {
    try {
      const ridotta = await riduci(scelto, 256)
      await salva({ avatar: ridotta })
    } catch {
      setErrore('Non sono riuscito a leggere quell\'immagine.')
    }
  }

  return (
    <Sezione titolo="Profilo" sotto="Come ti vedono gli altri nelle stanze.">
      <div className="flex items-center gap-4">
        {utente.avatar ? (
          <img
            src={utente.avatar}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-black/75"
            style={{ background: coloreDi(`u${utente.id}`) }}
          >
            {inizialiDi(utente.nome)}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const scelto = e.target.files?.[0]
              if (scelto) void scegliFoto(scelto)
              e.target.value = ''
            }}
          />
          <Bottone disabled={inCorso} onClick={() => file.current?.click()}>
            {utente.avatar ? 'Cambia foto' : 'Carica una foto'}
          </Bottone>
          {utente.avatar && (
            <Bottone tono="fantasma" disabled={inCorso} onClick={() => void salva({ avatar: null })}>
              Togli
            </Bottone>
          )}
        </div>
      </div>

      <Campo etichetta="Nome visibile">
        <div className="flex gap-2">
          <input
            className={classiInput}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void salva({ nome })}
          />
          <Bottone
            disabled={inCorso || !nome.trim() || nome === utente.nome}
            onClick={() => void salva({ nome })}
          >
            Salva
          </Bottone>
        </div>
      </Campo>

      {errore && <Avviso>{errore}</Avviso>}
    </Sezione>
  )
}

/** Ridimensiona e ricomprime in JPEG, restituendo un data URL. */
function riduci(scelto: File, lato: number): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    const lettore = new FileReader()
    lettore.onerror = () => rifiuta(new Error('lettura fallita'))
    lettore.onload = () => {
      const immagine = new Image()
      immagine.onerror = () => rifiuta(new Error('immagine illeggibile'))
      immagine.onload = () => {
        // Ritaglio quadrato dal centro: un avatar sta dentro a un cerchio, e
        // schiacciare un rettangolo in un cerchio deforma le facce.
        const corto = Math.min(immagine.width, immagine.height)
        const tela = document.createElement('canvas')
        tela.width = lato
        tela.height = lato
        const pennello = tela.getContext('2d')
        if (!pennello) return rifiuta(new Error('canvas non disponibile'))
        pennello.drawImage(
          immagine,
          (immagine.width - corto) / 2,
          (immagine.height - corto) / 2,
          corto,
          corto,
          0,
          0,
          lato,
          lato
        )
        risolvi(tela.toDataURL('image/jpeg', 0.85))
      }
      immagine.src = String(lettore.result)
    }
    lettore.readAsDataURL(scelto)
  })
}

function CambioPassword({ api }: { api: Api }): React.JSX.Element {
  const [aperto, setAperto] = useState(false)
  const [vecchia, setVecchia] = useState('')
  const [nuova, setNuova] = useState('')
  const [conferma, setConferma] = useState('')
  const [esito, setEsito] = useState<string | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)

  const cambia = async (): Promise<void> => {
    setErrore(null)
    setEsito(null)
    if (nuova !== conferma) return setErrore('Le due password non coincidono.')

    setInCorso(true)
    try {
      const { sessioniChiuse } = await api.cambiaPassword(vecchia, nuova)
      setEsito(
        sessioniChiuse === 0
          ? 'Password cambiata.'
          : `Password cambiata. Chiuse ${sessioniChiuse} sessioni sugli altri dispositivi.`
      )
      setVecchia('')
      setNuova('')
      setConferma('')
      setAperto(false)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  return (
    <Sezione titolo="Password">
      {esito && <Avviso tono="neutro">{esito}</Avviso>}

      {!aperto ? (
        <Bottone tono="fantasma" onClick={() => setAperto(true)}>
          Cambia la password
        </Bottone>
      ) : (
        <div className="space-y-3">
          <Campo etichetta="Password attuale">
            <input
              className={classiInput}
              type="password"
              value={vecchia}
              onChange={(e) => setVecchia(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </Campo>
          <Campo etichetta="Nuova password" aiuto="Almeno 10 caratteri.">
            <input
              className={classiInput}
              type="password"
              value={nuova}
              onChange={(e) => setNuova(e.target.value)}
              autoComplete="new-password"
            />
          </Campo>
          <Campo etichetta="Ripeti la nuova password">
            <input
              className={classiInput}
              type="password"
              value={conferma}
              onChange={(e) => setConferma(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !inCorso && void cambia()}
              autoComplete="new-password"
            />
          </Campo>

          {errore && <Avviso>{errore}</Avviso>}

          <Avviso tono="attenzione">
            Cambiare la password chiude le sessioni su tutti gli altri dispositivi. Questo resta
            aperto.
          </Avviso>

          <div className="flex gap-2">
            <Bottone tono="vivo" disabled={inCorso} onClick={() => void cambia()}>
              Cambia
            </Bottone>
            <Bottone tono="fantasma" onClick={() => setAperto(false)}>
              Annulla
            </Bottone>
          </div>
        </div>
      )}
    </Sezione>
  )
}

/**
 * Un codice da ribattere su un dispositivo nuovo.
 *
 * E' la risposta alla domanda che nasce quasi sempre col telefono in mano: "e
 * la mia password qual era?". Il server non la sa e non puo' saperla — ne
 * conserva solo l'impronta scrypt, che e' a senso unico — ma il problema vero
 * non era saperla: era entrare da li'. Cosi' non passa da nessuna tastiera di
 * vetro, che e' anche il motivo per cui le password sui telefoni diventano
 * corte.
 *
 * Il conto alla rovescia si vede, e non e' decorazione: due minuti sono pochi
 * apposta — un codice che apre un account e resta buono un pomeriggio e' un
 * codice che qualcuno legge da sopra la spalla e usa dopo — e chi lo sta
 * copiando deve sapere quanto tempo ha invece di scoprirlo fallendo.
 */
function CodiceDispositivo({ api }: { api: Api }): React.JSX.Element {
  const [codice, setCodice] = useState<string | null>(null)
  const [restano, setRestano] = useState(0)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    if (!codice) return
    if (restano <= 0) return setCodice(null)
    const t = setTimeout(() => setRestano((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [codice, restano])

  const chiedi = (): void => {
    setErrore(null)
    void api
      .codiceDispositivo()
      .then(({ codice, scade }) => {
        setCodice(codice)
        setRestano(Math.max(1, scade - Math.floor(Date.now() / 1000)))
      })
      .catch((e) => setErrore((e as Error).message))
  }

  return (
    <Sezione
      titolo="Collega un dispositivo"
      sotto="Per entrare da un telefono o da un altro computer senza riscrivere la password."
    >
      {errore && <Avviso>{errore}</Avviso>}

      {codice ? (
        <div className="space-y-2">
          <p className="numeri rounded-lg border border-bordo bg-fondo px-4 py-3 text-center text-2xl tracking-[0.35em]">
            {codice}
          </p>
          <p className="text-center text-xs text-testo-3">
            scade fra {Math.floor(restano / 60)}:{String(restano % 60).padStart(2, '0')} · si usa
            una volta sola
          </p>
          <p className="text-sm text-testo-2">
            Sull&apos;altro dispositivo apri PulseTalk, scegli lo stesso server e usa{' '}
            <span className="text-testo">Ho un codice da un altro dispositivo</span>.
          </p>
        </div>
      ) : (
        <Bottone tono="fantasma" onClick={chiedi}>
          Mostrami un codice
        </Bottone>
      )}
    </Sezione>
  )
}

/**
 * L'indirizzo di posta del proprio account.
 *
 * Facoltativo, e resta tale: questa e' un'istanza fra amici e c'e' chi non lo
 * dara'. Serve a una cosa sola, per adesso — rientrare avendo dimenticato la
 * password — e la schermata lo dice invece di chiederlo e basta: un campo che
 * non spiega a cosa serve e' un campo che si compila male o non si compila.
 *
 * I due stati che contano sono «scritto» e «dimostrato», e si vedono a colpo
 * d'occhio. Solo il secondo apre qualcosa: senza la conferma, un refuso
 * manderebbe la chiave di casa a uno sconosciuto.
 */
function Email({ api }: { api: Api }): React.JSX.Element | null {
  const [stato, setStato] = useState<StatoEmail | null>(null)
  const [aperto, setAperto] = useState(false)
  const [indirizzo, setIndirizzo] = useState('')
  const [password, setPassword] = useState('')
  const [codice, setCodice] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [esito, setEsito] = useState<string | null>(null)
  const [inCorso, setInCorso] = useState(false)

  useEffect(() => {
    void api
      .statoEmail()
      .then(setStato)
      .catch((e) => setErrore((e as Error).message))
  }, [api])

  const fai = async (cosa: () => Promise<StatoEmail>, detto: string): Promise<void> => {
    setErrore(null)
    setEsito(null)
    setInCorso(true)
    try {
      setStato(await cosa())
      setEsito(detto)
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setInCorso(false)
    }
  }

  // Dove il server non sa spedire non si offre niente: un campo che promette
  // di far rientrare, su un server senza posta, promette una cosa che non
  // succedera'.
  if (!stato?.possibile) return null

  // Scritto ma non confermato: l'unica cosa da fare e' finire.
  const daConfermare = stato.indirizzo !== null && !stato.confermato

  return (
    <Sezione
      titolo="Indirizzo di posta"
      sotto="Serve a due cose: rientrare se dimentichi la password, e — solo se lo accendi tu — sapere quando qualcuno entra in un canale vocale mentre non sei collegato. Non lo vede nessun altro."
    >
      {esito && <Avviso tono="neutro">{esito}</Avviso>}
      {errore && <Avviso>{errore}</Avviso>}

      {stato.indirizzo && (
        <div className="flex items-center gap-3 rounded-lg border border-bordo bg-fondo px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{stato.indirizzo}</p>
            <p className="text-[11px] text-testo-3">
              {stato.confermato ? (
                <span className="text-ok">confermato</span>
              ) : (
                <span className="text-attenzione">manca la conferma: cosi&apos; non serve a rientrare</span>
              )}
            </p>
          </div>
          <button
            className="shrink-0 text-xs text-male hover:underline"
            onClick={() => void fai(() => api.togliEmail(), 'Indirizzo tolto.')}
          >
            togli
          </button>
        </div>
      )}

      {daConfermare && (
        <div className="space-y-3">
          <Campo
            etichetta="Il codice che ti e' arrivato"
            aiuto="Sei caratteri. Vale un quarto d'ora, e si usa una volta sola."
          >
            <input
              className={`${classiInput} numeri tracking-[0.3em] uppercase`}
              value={codice}
              maxLength={6}
              onChange={(e) => setCodice(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && !inCorso && void confermaOra()}
              autoFocus
            />
          </Campo>
          <Bottone tono="vivo" disabled={inCorso} onClick={() => void confermaOra()}>
            Conferma
          </Bottone>
        </div>
      )}

      {/* Gli avvisi compaiono solo con un indirizzo dimostrato. Offrirli prima
          vorrebbe dire promettere di scrivere a una casella che potrebbe non
          essere di chi sta guardando. L'elenco arriva dal server insieme al
          valore, cosi' aggiungerne uno e' una riga in avvisi.mjs. */}
      {stato.confermato &&
        (stato.avvisi ?? []).map((avviso) => (
          <Interruttore
            key={avviso.chiave}
            acceso={stato.scelte?.[avviso.chiave] === true}
            cambia={(acceso) => {
              // Ottimismo sull'interruttore: aspettare il giro di rete per
              // vederlo muovere fa premere due volte.
              setStato({ ...stato, scelte: { ...stato.scelte, [avviso.chiave]: acceso } })
              void api
                .impostaAvvisi({ [avviso.chiave]: acceso })
                .then(({ scelte }) => setStato((s) => (s ? { ...s, scelte } : s)))
                .catch((e) => setErrore((e as Error).message))
            }}
            titolo={avviso.nome}
            sotto={avviso.sotto}
          />
        ))}

      {!aperto && !daConfermare && (
        <Bottone tono="fantasma" onClick={() => setAperto(true)}>
          {stato.indirizzo ? 'Cambia indirizzo' : 'Aggiungi un indirizzo'}
        </Bottone>
      )}

      {aperto && !daConfermare && (
        <div className="space-y-3">
          <Campo etichetta="Indirizzo">
            <input
              className={classiInput}
              type="email"
              value={indirizzo}
              onChange={(e) => setIndirizzo(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </Campo>
          {/* La password attuale non e' un fastidio in piu': l'indirizzo e' la
              strada per rientrare, quindi cambiarlo vale quanto cambiare la
              password. Senza questa domanda, una sessione lasciata aperta su un
              computer altrui basterebbe a dirottare tutti i recuperi futuri. */}
          <Campo etichetta="La tua password" aiuto="Serve perche' questo indirizzo e' la strada per rientrare.">
            <input
              className={classiInput}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !inCorso && void scriviOra()}
              autoComplete="current-password"
            />
          </Campo>
          <div className="flex gap-2">
            <Bottone tono="vivo" disabled={inCorso} onClick={() => void scriviOra()}>
              Mandami il codice
            </Bottone>
            <Bottone tono="fantasma" onClick={() => setAperto(false)}>
              Annulla
            </Bottone>
          </div>
        </div>
      )}
    </Sezione>
  )

  async function scriviOra(): Promise<void> {
    await fai(() => api.scriviEmail(indirizzo, password), 'Ti ho mandato un codice.')
    setPassword('')
    setAperto(false)
  }

  async function confermaOra(): Promise<void> {
    await fai(() => api.confermaEmail(codice), 'Indirizzo confermato.')
    setCodice('')
  }
}

/**
 * I dispositivi da cui si e' entrati.
 *
 * Serve a una domanda sola, ed e' la piu' importante che si possa fare a un
 * sistema di account: "c'e' dentro qualcuno che non sono io?". Se la risposta
 * e' si', la si chiude da qui senza cambiare password a nessuno.
 */
function Sessioni({ api }: { api: Api }): React.JSX.Element {
  const [sessioni, setSessioni] = useState<Sessione[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)

  const carica = (): void => {
    void api
      .sessioni()
      .then(({ sessioni }) => setSessioni(sessioni))
      .catch((e) => setErrore((e as Error).message))
  }

  useEffect(carica, [api])

  const quando = (t: number | null): string =>
    t ? new Date(t * 1000).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'

  return (
    <Sezione titolo="Dispositivi collegati">
      {errore && <Avviso>{errore}</Avviso>}
      {sessioni === null && <p className="respiro text-sm text-testo-3">guardo…</p>}

      <div className="space-y-1.5">
        {sessioni?.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-bordo bg-fondo px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {s.dispositivo ?? 'dispositivo sconosciuto'}
                {s.questa && <span className="text-ok"> · questo</span>}
              </p>
              <p className="numeri text-[11px] text-testo-3">ultimo uso {quando(s.ultimoUso)}</p>
            </div>
            {!s.questa && (
              <button
                className="shrink-0 text-xs text-male hover:underline"
                onClick={() => {
                  void api
                    .revocaSessione(s.id)
                    .then(carica)
                    .catch((e) => setErrore((e as Error).message))
                }}
              >
                disconnetti
              </button>
            )}
          </div>
        ))}
      </div>
    </Sezione>
  )
}

/**
 * Gli aggiornamenti.
 *
 * Tre stati e tre pulsanti, e mai piu' di un pulsante alla volta: cerca,
 * scarica, riavvia. Non parte niente da solo — il controllo all'avvio si',
 * ma trecento megabyte scaricati senza chiedere mentre uno e' in chiamata
 * sono un modo sicuro di far saltare la chiamata.
 */
function SezioneAggiornamenti(): React.JSX.Element | null {
  const aggiornamenti = ponte.aggiornamenti
  const [stato, setStato] = useState<StatoAggiornamento | null>(null)

  useEffect(() => {
    if (!aggiornamenti) return
    void aggiornamenti.stato().then(setStato)
    return aggiornamenti.ascolta(setStato)
  }, [aggiornamenti])

  // Nel browser la sezione non esiste proprio: non c'e' niente da aggiornare,
  // e una sezione che dice "qui non si puo'" e' solo una riga in piu' da
  // leggere per scoprire che non serviva.
  if (!aggiornamenti || !stato) return null

  const fase = stato.fase

  return (
    <Sezione titolo="Aggiornamenti" sotto={`Stai usando la versione ${stato.versione}.`}>
      {fase === 'nonSupportato' ? (
        <Avviso tono="neutro">
          Questa e' la versione portabile: si aggiorna sostituendo il file, che e' poi il motivo per
          cui esiste un portabile.
        </Avviso>
      ) : (
        <>
          {fase === 'disponibile' && (
            <Avviso tono="neutro">
              C'e' la {stato.disponibile}.{stato.note ? ` ${primaRiga(stato.note)}` : ''}
            </Avviso>
          )}
          {fase === 'aggiornato' && <Avviso tono="neutro">Sei all'ultima versione.</Avviso>}
          {fase === 'pronto' && (
            <Avviso tono="neutro">
              La {stato.disponibile} e' scaricata. Si installa al riavvio dell'applicazione — e il
              riavvio chiude la chiamata, se sei in una stanza.
            </Avviso>
          )}
          {fase === 'errore' && (
            <Avviso tono="attenzione">
              Non sono riuscito a controllare: {stato.errore}
            </Avviso>
          )}

          {fase === 'scarico' && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-fondo-3">
                <div
                  className="h-full rounded-full bg-vivo transition-[width] duration-200"
                  style={{ width: `${stato.percento ?? 0}%` }}
                />
              </div>
              <p className="text-xs text-testo-3">Scarico… {stato.percento ?? 0}%</p>
            </div>
          )}

          <div className="flex gap-2">
            {fase === 'disponibile' ? (
              <Bottone onClick={() => void aggiornamenti.scarica()}>
                Scarica la {stato.disponibile}
              </Bottone>
            ) : fase === 'pronto' ? (
              <Bottone onClick={() => void aggiornamenti.installa()}>Riavvia e installa</Bottone>
            ) : (
              <Bottone
                tono="fantasma"
                disabled={fase === 'controllo' || fase === 'scarico'}
                onClick={() => void aggiornamenti.controlla()}
              >
                {fase === 'controllo' ? 'Controllo…' : 'Controlla adesso'}
              </Bottone>
            )}
          </div>
        </>
      )}
    </Sezione>
  )
}

/** Le note di rilascio in una riga: nel pannello non c'e' spazio per di piu'. */
function primaRiga(note: string): string {
  const pulite = note.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return pulite.length > 120 ? pulite.slice(0, 117) + '…' : pulite
}

/**
 * Il microfono, la soglia, e il punto esatto in cui smetti di essere sentito.
 *
 * Le due cose stanno insieme perche' separate non servono a niente: una soglia
 * si regola guardando dove arriva la propria voce e dove arriva il proprio
 * silenzio, e un misuratore senza soglia dice solo che il microfono e' vivo.
 *
 * Tre segni sulla stessa barra, e ognuno risponde a una domanda diversa:
 *
 *   la barra piena     quanto forte stai parlando adesso
 *   il segno giallo    dove hai messo la soglia
 *   il colore          se in questo istante la voce esce o viene tagliata
 *
 * Il livello NON passa da uno stato React. Si legge a ogni fotogramma e si
 * scrive direttamente nello stile della barra: con un `setState` sessanta volte
 * al secondo si ridisegnerebbe tutto il pannello — cursori, tendine, sezioni —
 * per far allungare un rettangolo.
 *
 * Durante una chiamata non si apre nessun microfono nuovo: si legge quello che
 * sta gia' trasmettendo. Vedi lib/misuratoreMicrofono.ts.
 */
function ProvaMicrofono({
  dispositivoId,
  dispositivoNome,
  soglia,
  cambiaSoglia,
  inChiamata = false
}: {
  dispositivoId: string | null
  dispositivoNome: string | null
  soglia: number
  cambiaSoglia: (valore: number) => void
  /** Con una chiamata aperta il misuratore parte da solo e non chiede niente. */
  inChiamata?: boolean
}): React.JSX.Element {
  const [acceso, setAcceso] = useState(inChiamata)
  const [ritorno, setRitorno] = useState(false)
  const barra = useRef<HTMLDivElement | null>(null)
  const spia = useRef<HTMLSpanElement | null>(null)
  const prova = useRef<Prova | null>(null)

  const { misuratore, errore } = usaMisuratore(acceso, dispositivoId, dispositivoNome, soglia)

  // In chiamata il misuratore e' sempre acceso: il microfono e' gia' aperto,
  // e chiedere di premere "prova" per guardare una barra che potrebbe gia'
  // muoversi sarebbe un passaggio inventato.
  useEffect(() => {
    if (inChiamata) setAcceso(true)
  }, [inChiamata])

  /**
   * Il ritorno in cuffia, solo fuori dalla chiamata.
   *
   * Dentro una chiamata mandarsi il proprio microfono in cuffia vorrebbe dire
   * sentirsi due volte — e con le casse accese, fischiare.
   */
  useEffect(() => {
    if (inChiamata || !acceso) return
    let vivo = true
    void avviaProva(dispositivoId, dispositivoNome)
      .then((nuova) => {
        if (!vivo) return void nuova.chiudi()
        prova.current = nuova
        nuova.sentiti(ritorno)
      })
      .catch(() => {
        // Il misuratore ha gia' detto cosa non va: qui si perde solo il ritorno.
      })
    return () => {
      vivo = false
      void prova.current?.chiudi()
      prova.current = null
    }
    // Volutamente senza `ritorno`: accenderlo non deve riaprire il dispositivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceso, dispositivoId, dispositivoNome, inChiamata])

  useEffect(() => {
    prova.current?.sentiti(ritorno)
  }, [ritorno])

  // La barra e' logaritmica: la voce parlata sta fra 0.02 e 0.2 di valore
  // efficace, e su una scala lineare quei numeri stanno tutti schiacciati
  // contro il bordo sinistro, dove non si distingue niente.
  const perCento = (v: number): number => Math.min(100, Math.max(0, (Math.sqrt(v) / 0.6) * 100))

  useEffect(() => {
    if (!misuratore) {
      if (barra.current) barra.current.style.width = '0%'
      return
    }

    let vivo = true
    let ultimoColore = ''

    const giro = (): void => {
      if (!vivo) return
      const elemento = barra.current
      if (elemento) {
        elemento.style.width = `${perCento(misuratore.livello())}%`

        // Il colore cambia poche volte al secondo, la larghezza sessanta:
        // toccare la classe solo quando serve evita di far ricalcolare lo stile
        // a ogni fotogramma.
        const colore = misuratore.passa() ? 'var(--color-ok)' : 'var(--color-testo-3)'
        if (colore !== ultimoColore) {
          elemento.style.background = colore
          if (spia.current) spia.current.style.background = colore
          ultimoColore = colore
        }
      }
      requestAnimationFrame(giro)
    }

    requestAnimationFrame(giro)
    return () => {
      vivo = false
    }
  }, [misuratore])

  return (
    <Campo
      etichetta="Livello e automute"
      aiuto="Parla e guarda dove arriva la barra. Il segno e' la soglia: sotto, il microfono non
        trasmette e la barra diventa grigia. Si alza finche' il silenzio resta a sinistra del segno e
        la voce lo supera."
    >
      <div className="space-y-2">
        {/* La barra e la soglia sullo stesso righello: e' l'unico modo per
            vedere il punto esatto in cui la voce smette di uscire. */}
        <div className="relative h-2.5 overflow-hidden rounded-full bg-fondo-3">
          <div
            ref={barra}
            className="h-full rounded-full"
            style={{ width: '0%', background: 'var(--color-testo-3)' }}
          />
          {soglia > 0 && (
            <div
              className="absolute inset-y-0 w-0.5 bg-attenzione"
              style={{ left: `${perCento(soglia)}%` }}
              title="Soglia dell'automute"
            />
          )}
        </div>

        <input
          type="range"
          min={0}
          max={0.35}
          step={0.005}
          value={soglia}
          onChange={(e) => cambiaSoglia(Number(e.target.value))}
          className="w-full"
          aria-label="Soglia dell'automute"
        />

        <div className="flex flex-wrap items-center gap-2">
          {!inChiamata && (
            <Bottone tono="fantasma" onClick={() => setAcceso((v) => !v)}>
              {acceso ? 'Ferma la prova' : 'Prova il microfono'}
            </Bottone>
          )}

          {acceso && !inChiamata && (
            <Bottone tono="fantasma" onClick={() => setRitorno((v) => !v)}>
              {ritorno ? 'Smetti di sentirti' : 'Sentiti'}
            </Bottone>
          )}

          <span className="flex items-center gap-1.5 text-xs text-testo-3">
            <span
              ref={spia}
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--color-testo-3)' }}
            />
            {soglia <= 0 ? 'automute spento' : `soglia ${Math.round(soglia * 100)}`}
          </span>

          {misuratore?.daChiamata && (
            <span className="text-xs text-testo-3">
              — dal microfono della chiamata, senza riaprirlo
            </span>
          )}
        </div>

        {ritorno && (
          <p className="text-xs text-attenzione">
            Con le casse accese questo fischia: e' un microfono che si risente da solo.
          </p>
        )}
        {errore && <Avviso tono="attenzione">Non riesco ad aprire il microfono: {errore}</Avviso>}
      </div>
    </Campo>
  )
}

/**
 * Lo stato, anche da qui.
 *
 * Sta nel pannellino in basso a sinistra, dove serve di corsa, ma appartiene
 * al profilo: chi apre le impostazioni per sistemare nome e foto si aspetta di
 * trovarlo insieme a quelli, non di doverlo cercare in un altro posto.
 */
function StatoDiProfilo({
  api,
  utente,
  quandoCambia
}: {
  api: Api
  utente: Utente
  quandoCambia: (utente: Utente) => void
}): React.JSX.Element {
  const [errore, setErrore] = useState<string | null>(null)
  const attuale = utente.stato ?? 'online'

  const scegli = async (stato: StatoUtente): Promise<void> => {
    setErrore(null)
    try {
      const { utente: nuovo } = await api.profilo({ stato })
      quandoCambia(nuovo)
    } catch (e) {
      setErrore((e as Error).message)
    }
  }

  return (
    <Sezione
      titolo="Stato"
      sotto="Resta quello che scegli finche' non lo cambi. Inattivo non c'e' perche' non si sceglie: lo mette l'applicazione dopo dieci minuti senza parlare."
    >
      <div className="grid grid-cols-2 gap-2">
        {(['online', 'occupato', 'invisibile'] as StatoUtente[]).map((quale) => (
          <button
            key={quale}
            onClick={() => void scegli(quale)}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
              quale === attuale
                ? 'border-vivo bg-vivo/10'
                : 'border-bordo bg-fondo hover:border-fondo-3'
            }`}
          >
            <span
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: STATI[quale].colore }}
            />
            <span className="min-w-0">
              <span className="block text-sm text-testo">{STATI[quale].nome}</span>
              {STATI[quale].sotto && (
                <span className="block text-[11px] text-testo-3">{STATI[quale].sotto}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {errore && <Avviso tono="attenzione">{errore}</Avviso>}
    </Sezione>
  )
}
