import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionState } from 'livekit-client'
import type { Amicizie, Canale, Impostazioni, Ingresso, Utente } from '@shared/tipi'
import { ponte } from './ponte'
import { Api } from './lib/api'
import { usaChat } from './lib/usaChat'
import { usaMondo } from './lib/usaMondo'
import { usaSessione } from './lib/usaSessione'
import { suona } from './lib/suoni'
import Accesso, { Completa } from './atrio/Accesso'
import Inviti from './atrio/Inviti'
import BarraSpazi from './spazi/BarraSpazi'
import ColonnaCanali from './spazi/ColonnaCanali'
import PannelloVoce from './spazi/PannelloVoce'
import Amici from './spazi/Amici'
import IscrittiCanale from './spazi/IscrittiCanale'
import Chat from './chat/Chat'
import Ricerca from './chat/Ricerca'
import Sala from './sala/Sala'
import PannelloImpostazioni from './Impostazioni'
import PopupProfilo from './PopupProfilo'
import { Avviso, Conferma } from './ui'

/**
 * Tre colonne, e una regola che le tiene insieme.
 *
 * La sessione vocale vive **qui**, non dentro alla schermata della sala. E' la
 * differenza fra questa versione e la precedente, ed e' l'unica cosa che
 * permette di entrare in un canale vocale e continuare a leggere le chat
 * mentre si parla — che e' come si usa Discord, e come nessuno usa una app che
 * ti costringe a guardare la griglia dei video per restare collegato.
 */
export default function App(): React.JSX.Element {
  const [impostazioni, setImpostazioni] = useState<Impostazioni | null>(null)
  const [utente, setUtente] = useState<Utente | null>(null)
  const [verificaFatta, setVerificaFatta] = useState(false)
  const [deveCompletare, setDeveCompletare] = useState(false)

  const [spazioApertoId, setSpazioApertoId] = useState<number | null>(null)
  const [canaleApertoId, setCanaleApertoId] = useState<number | null>(null)
  const [ingresso, setIngresso] = useState<Ingresso | null>(null)

  const [mostraImpostazioni, setMostraImpostazioni] = useState(false)
  const [mostraProfilo, setMostraProfilo] = useState(false)
  /** Con quale sezione aprire le impostazioni. Null: l'ultima usata. */
  const [sezioneImpostazioni, setSezioneImpostazioni] = useState<string | null>(null)
  const [mostraInviti, setMostraInviti] = useState(false)
  const [mostraRicerca, setMostraRicerca] = useState(false)
  const [mostraAmici, setMostraAmici] = useState(false)
  const [iscrittiDi, setIscrittiDi] = useState<Canale | null>(null)
  const [amicizie, setAmicizie] = useState<Amicizie | null>(null)
  /** Chi era in un vocale al giro precedente, per identita'. */
  const presentiPrima = useRef<Map<string, string> | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
  /** Il vocale che si vorrebbe aprire lasciando quello in cui si e' adesso. */
  const [cambioVocale, setCambioVocale] = useState<Canale | null>(null)

  const sessione = usaSessione(impostazioni ?? ({} as Impostazioni))

  useEffect(() => {
    void ponte.leggiImpostazioni().then(setImpostazioni)
    return ponte.onImpostazioniCambiate(setImpostazioni)
  }, [])

  const api = useMemo(
    () => (impostazioni?.server && impostazioni.token ? new Api(impostazioni.server, impostazioni.token) : null),
    [impostazioni?.server, impostazioni?.token]
  )

  const salva = useCallback(async (modifiche: Partial<Impostazioni>) => {
    const { impostazioni: nuove } = await ponte.scriviImpostazioni(modifiche)
    setImpostazioni(nuove)
    return nuove
  }, [])

  // Chi ha gia' un token non deve rivedere la schermata dell'accesso: si prova
  // il token, e se e' stato revocato si torna li' con un motivo scritto.
  useEffect(() => {
    if (!api || verificaFatta) return
    void api
      .io()
      .then(({ utente, deveCompletare }) => {
        setUtente(utente)
        setDeveCompletare(deveCompletare)
      })
      .catch(() => setUtente(null))
      .finally(() => setVerificaFatta(true))
  }, [api, verificaFatta])

  const mondo = usaMondo(utente ? api : null)

  // Gli amici, ricaricati quando il server dice che qualcosa e' cambiato.
  // Passa dallo stesso flusso di tutto il resto: una richiesta di amicizia
  // arriva mentre si sta guardando altro, ed e' li' che deve comparire il
  // pallino rosso.
  const ricaricaAmici = useCallback(() => {
    if (!api || !utente) return
    void api
      .amici()
      .then(setAmicizie)
      .catch(() => {
        // Un elenco che non arriva non deve rompere niente: il pannello dira'
        // che sta caricando, e al prossimo evento riprova.
      })
  }, [api, utente])

  useEffect(ricaricaAmici, [ricaricaAmici])

  useEffect(() => {
    return mondo.iscrivi((evento) => {
      if (evento.tipo === 'amici') ricaricaAmici()
    })
  }, [mondo.iscrivi, ricaricaAmici])

  // Le foto e i nomi di tutti, per i messaggi e per i riquadri della stanza.
  const [profili, setProfili] = useState<Map<number, { nome: string; avatar: string | null }>>(new Map())
  useEffect(() => {
    if (!api || !utente) return
    void api
      .utenti()
      .then(({ utenti }) => setProfili(new Map(utenti.map((u) => [u.id, { nome: u.nome, avatar: u.avatar }]))))
      .catch(() => {
        // Senza le foto restano le iniziali, che e' un ripiego onesto.
      })
  }, [api, utente, utente?.avatar])

  // -- Cosa e' aperto ---------------------------------------------------------

  const spazi = mondo.spazi ?? []
  const spazioAperto = spazi.find((s) => s.id === spazioApertoId) ?? spazi[0] ?? null
  const canaleAperto =
    spazioAperto?.canali.find((c) => c.id === canaleApertoId) ??
    spazioAperto?.canali.find((c) => c.tipo === 'testo') ??
    null

  // Il primo spazio che arriva diventa quello aperto, cosi' non si guarda mai
  // una finestra vuota aspettando di scegliere.
  useEffect(() => {
    if (spazioApertoId === null && spazi.length > 0) setSpazioApertoId(spazi[0].id)
  }, [spazi, spazioApertoId])

  const chat = usaChat(api, canaleAperto?.tipo === 'testo' ? canaleAperto : null, mondo.iscrivi)

  // -- La voce ---------------------------------------------------------------

  const entraDavvero = useCallback(
    async (canale: Canale) => {
      if (!api || !impostazioni) return
      setAvviso(null)

      // Entrare in un vocale mentre si e' gia' in un altro: si esce dal primo.
      // Due chiamate insieme non hanno senso, e la SFU accetterebbe entrambe.
      if (ingresso) await sessione.esci().catch(() => {})

      try {
        const nuovo = await api.entra(canale.id)
        setIngresso(nuovo)
        setCanaleApertoId(canale.id)
        await sessione.entra(nuovo, impostazioni)
      } catch (e) {
        setIngresso(null)
        await sessione.esci().catch(() => {})
        setAvviso(spiega(e as Error))
      }
    },
    [api, impostazioni, ingresso, sessione]
  )

  /**
   * Il guardiano davanti all'ingresso.
   *
   * Tre casi e tre risposte diverse. Se si clicca il canale in cui si e' gia',
   * non si rientra: si torna a guardarlo, perche' rientrare vorrebbe dire
   * uscire e rientrare davvero, e per un istante gli altri ti vedrebbero
   * sparire. Se si e' in un altro vocale si chiede, perche' quel clic e' spesso
   * la riga sbagliata dell'elenco. Se non si e' in nessuno si entra e basta.
   *
   * Un canale di testo non passa di qui: quello si apre e la chiamata resta
   * dov'e'. E' tutto il senso di aver messo la sessione vocale qui in App.
   */
  const entraInVoce = useCallback(
    (canale: Canale) => {
      if (ingresso && ingresso.canale.id === canale.id) {
        setCanaleApertoId(canale.id)
        return
      }
      if (ingresso) {
        setCambioVocale(canale)
        return
      }
      void entraDavvero(canale)
    },
    [ingresso, entraDavvero]
  )

  const esciDallaVoce = useCallback(async () => {
    await sessione.esci()
    setIngresso(null)
    mondo.ricarica()
  }, [sessione, mondo.ricarica])

  /**
   * Entrare e uscire da un vocale rilegge l'elenco.
   *
   * Chi c'e' dentro a una stanza lo sa la SFU, e il server glielo chiede quando
   * qualcuno domanda `/api/spazi`. Il proprio ingresso, pero', non faceva
   * ridomandare niente: si entrava, si compariva nel riquadro di destra, e
   * sotto al canale a sinistra non compariva nessuno — la colonna era ferma
   * alla lettura fatta prima di entrare.
   *
   * Il momento giusto e' `Connected` e non la chiamata a `entra`: fino a
   * connessione stabilita la SFU non ha ancora nessuno in quella stanza, e una
   * domanda anticipata tornerebbe con l'elenco di prima.
   */
  useEffect(() => {
    if (sessione.stato === ConnectionState.Connected) mondo.ricarica()
  }, [sessione.stato, mondo.ricarica])

  // Cacciati, o canale eliminato: si esce da soli, con il motivo in mano.
  useEffect(() => {
    if (sessione.motivoUscita && ingresso) {
      setAvviso(sessione.motivoUscita)
      setIngresso(null)
    }
  }, [sessione.motivoUscita, ingresso])

  /**
   * "Avvisami quando entra Marco".
   *
   * Si guarda chi c'e' adesso nei vocali e lo si confronta con chi c'era al
   * giro prima. Il primo confronto non annuncia niente: aprendo l'app,
   * chiunque sia gia' dentro sarebbe una novita', e si verrebbe accolti da
   * cinque notifiche per gente che sta li' da un'ora.
   */
  useEffect(() => {
    const adesso = new Map<string, string>()
    for (const spazio of spazi) {
      for (const canale of spazio.canali) {
        if (canale.tipo !== 'voce') continue
        for (const persona of canale.presenti) adesso.set(persona.identita, canale.nome)
      }
    }

    const prima = presentiPrima.current
    presentiPrima.current = adesso
    if (prima === null || !impostazioni) return

    for (const chi of impostazioni.avvisiPersone ?? []) {
      if (chi === utente?.id) continue
      const identita = `u${chi}`
      if (!adesso.has(identita) || prima.has(identita)) continue

      const nome = profili.get(chi)?.nome ?? 'Qualcuno'
      ponte.notifica({ titolo: `${nome} e' entrato`, corpo: `In ${adesso.get(identita)}` })
      suona('altroEntrato')
    }
  }, [spazi, impostazioni, profili, utente?.id])

  const inVoce = ingresso && sessione.stato !== ConnectionState.Disconnected ? ingresso.canale.id : null

  /**
   * Ctrl+Shift+R: riascolta, da qualunque schermata.
   *
   * Sta qui e non nella stanza perche' il momento in cui serve e' quello in cui
   * la stanza non si sta guardando: si legge una chat, si sente mezza frase, e
   * la si vuole indietro senza prima ritrovare la finestra giusta. Dentro a un
   * campo di testo non si intercetta: li' quella combinazione e' di chi scrive.
   */
  useEffect(() => {
    const tasto = (evento: KeyboardEvent): void => {
      if (!evento.ctrlKey || !evento.shiftKey || evento.code !== 'KeyR') return
      const dentro = document.activeElement
      if (dentro instanceof HTMLInputElement || dentro instanceof HTMLTextAreaElement) return
      evento.preventDefault()
      sessione.riascolta()
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [sessione])

  /**
   * La chiamata a tutto schermo: via le due colonne di sinistra.
   *
   * Sta qui e non dentro alla stanza perche' le colonne da nascondere sono di
   * qui: uno stato tenuto piu' in basso non potrebbe toccarle.
   *
   * E sta SOPRA ai ritorni anticipati qui sotto, non sotto: gli hook devono
   * essere gli stessi a ogni disegno. Messo dopo, non veniva mai eseguito
   * finche' si era alla schermata d'accesso, e al primo disegno da dentro
   * React ne trovava tre in piu' e si fermava — pagina vuota, errore 310.
   */
  const [chiamataPiena, setChiamataPiena] = useState(false)

  // Uscire con Escape, che e' dove la mano va da sola.
  useEffect(() => {
    if (!chiamataPiena) return
    const tasto = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setChiamataPiena(false)
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [chiamataPiena])

  // Uscendo dalla chiamata non si resta a tutto schermo su una stanza vuota.
  useEffect(() => {
    if (!inVoce) setChiamataPiena(false)
  }, [inVoce])

  // -- Le schermate che vengono prima ----------------------------------------

  if (!impostazioni) {
    return (
      <div className="flex h-full items-center justify-center text-testo-3">
        <span className="respiro">un istante…</span>
      </div>
    )
  }

  if (!utente || !api) {
    return (
      <Accesso
        impostazioni={impostazioni}
        salva={salva}
        quandoEntra={(u) => {
          setUtente(u)
          setDeveCompletare(false)
          setVerificaFatta(true)
        }}
      />
    )
  }

  if (deveCompletare) {
    return (
      <Completa
        api={api}
        quandoFatto={(aggiornato) => {
          setUtente(aggiornato)
          setDeveCompletare(false)
          void salva({ utenteRicordato: aggiornato.utente, nome: aggiornato.nome })
        }}
      />
    )
  }

  // -- Le tre colonne ---------------------------------------------------------

  return (
    <div className="relative flex h-full">
      {!chiamataPiena && (
      <BarraSpazi
        spazi={spazi}
        aperto={spazioAperto?.id ?? null}
        utente={utente}
        scegli={(id) => {
          setSpazioApertoId(id)
          setCanaleApertoId(null)
        }}
        crea={async (nome) => {
          await api.creaSpazio({ nome })
          mondo.ricarica()
        }}
        apriAmici={() => setMostraAmici(true)}
        richieste={amicizie?.ricevute.length ?? 0}
        apriProfilo={() => setMostraProfilo(true)}
      />
      )}

      {/* Il pannello della chiamata copre le due colonne insieme.
          
          La larghezza e' la somma delle due qui accanto — w-16 della barra
          degli spazi e w-60 dei canali — e sta scritta a mano perche' un
          overlay non puo' misurarle: cambiando una delle due, va cambiata
          anche questa. Senza spazio aperto la colonna dei canali non esiste, e
          il pannello si restringe sulla sola barra. */}
      {inVoce && utente && !chiamataPiena && (
        <div
          className={`absolute bottom-0 left-0 z-20 ${spazioAperto ? 'w-[19rem]' : 'w-16'}`}
        >
          <PannelloVoce
            utente={utente}
            canale={ingresso!.canale.nome}
            stato={sessione.stato}
            latenza={sessione.latenza}
            microfonoAcceso={sessione.microfonoAcceso}
            cameraAccesa={sessione.cameraAccesa}
            sordina={sessione.sordina}
            condivide={sessione.schermiAttivi.length > 0}
            riascoltoAttivo={sessione.riascoltoAttivo}
            secondiRiascolto={impostazioni.secondiRiascolto || 30}
            guardando={canaleAperto?.id === inVoce}
            alternaMicrofono={() => void sessione.alternaMicrofono()}
            alternaCamera={() => void sessione.alternaCamera()}
            alternaSordina={sessione.alternaSordina}
            apriCondivisione={() => setCanaleApertoId(inVoce)}
            riascolta={sessione.riascolta}
            torna={() => setCanaleApertoId(inVoce)}
            esci={() => void esciDallaVoce()}
            apriProfilo={() => setMostraProfilo(true)}
            apriImpostazioni={() => {
              setSezioneImpostazioni(null)
              setMostraImpostazioni(true)
            }}
          />
        </div>
      )}

      {mostraProfilo && utente && (
        <PopupProfilo
          utente={utente}
          cambiaStato={(stato) => {
            void api.profilo({ stato }).then((r) => setUtente(r.utente))
          }}
          apriImpostazioni={() => {
            setSezioneImpostazioni(null)
            setMostraImpostazioni(true)
          }}
          apriProfilo={() => {
            setSezioneImpostazioni('profilo')
            setMostraImpostazioni(true)
          }}
          chiudi={() => setMostraProfilo(false)}
        />
      )}

      {spazioAperto ? (
        <>
          {/* Bordo e sfondo stanno qui e non sulla colonna: la riga verticale
              deve correre dall'alto al basso senza spezzarsi dove finisce
              l'elenco dei canali e comincia la barra della voce. */}
          <div
            className={`flex w-60 shrink-0 flex-col border-r border-bordo bg-fondo-2 ${
              chiamataPiena ? 'hidden' : ''
            }`}
          >
            <ColonnaCanali
              spazio={spazioAperto}
              apertoId={canaleAperto?.id ?? null}
              inVoce={inVoce}
              scegli={(canale) => setCanaleApertoId(canale.id)}
              entraInVoce={entraInVoce}
              parlanti={sessione.parlanti}
              esciDallaVoce={() => void esciDallaVoce()}
              crea={async (dati) => {
                await api.creaCanale(spazioAperto.id, dati)
                mondo.ricarica()
              }}
              elimina={async (canale) => {
                if (canale.id === inVoce) await esciDallaVoce()
                await api.eliminaCanale(canale.id)
                mondo.ricarica()
              }}
              apriRicerca={() => setMostraRicerca(true)}
              gestisciIscritti={(canale) => setIscrittiDi(canale)}
              modificaCanale={async (canale, modifiche) => {
                await api.aggiornaCanale(canale.id, modifiche)
                mondo.ricarica()
              }}
              profili={profili}
              microfoniSpenti={sessione.microfoniSpenti}
            />

          </div>

          <main className="flex min-w-0 flex-1 flex-col">
            {avviso && (
              <div className="p-3">
                <Avviso tono="attenzione">{avviso}</Avviso>
              </div>
            )}
            {mondo.errore && (
              <div className="p-3">
                <Avviso>{mondo.errore}</Avviso>
              </div>
            )}

            {ingresso && inVoce && canaleAperto?.id === inVoce ? (
              <Sala
                api={api}
                ingresso={ingresso}
                sessione={sessione}
                impostazioni={impostazioni}
                profili={profili}
                moderatore={spazioAperto.ruoloMio === 'admin'}
                salvaImpostazioni={salva}
                schermoIntero={{
                  attivo: chiamataPiena,
                  alterna: () => setChiamataPiena((v) => !v)
                }}
                esci={esciDallaVoce}
                apriImpostazioni={() => setMostraImpostazioni(true)}
              />
            ) : canaleAperto?.tipo === 'testo' ? (
              <Chat
                api={api}
                canale={canaleAperto}
                chat={chat}
                io={utente}
                profili={profili}
                amministra={spazioAperto.ruoloMio === 'admin'}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
                <p className="text-testo-2">Scegli un canale a sinistra.</p>
                <p className="text-sm text-testo-3">
                  Quelli con il # si leggono, quelli con l'altoparlante si ascoltano.
                </p>
              </div>
            )}
          </main>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          {/* L'errore prima di tutto. Senza, un elenco che non arriva resta
              "carico…" per sempre: il motivo c'era, e non lo leggeva nessuno
              perche' l'unico posto in cui si mostrava era la colonna di destra,
              che senza spazi aperti non viene disegnata. */}
          {mondo.errore ? (
            <>
              <Avviso>{mondo.errore}</Avviso>
              <button className="text-sm text-testo-3 underline" onClick={mondo.ricarica}>
                riprova
              </button>
            </>
          ) : mondo.spazi === null ? (
            <span className="respiro text-testo-3">carico…</span>
          ) : (
            <>
              <p className="text-testo-2">Non c'e' ancora nessuno spazio.</p>
              <p className="text-sm text-testo-3">
                {utente.ruolo === 'admin'
                  ? 'Creane uno con il + nella colonna a sinistra.'
                  : 'Chiedi a chi amministra il server di crearne uno.'}
              </p>
            </>
          )}
        </div>
      )}

      {/* -- I pannelli sopra a tutto ------------------------------------- */}

      {mostraRicerca && spazioAperto && (
        <Ricerca
          api={api}
          spazio={spazioAperto}
          profili={profili}
          vaiA={(canale) => {
            setCanaleApertoId(canale)
            setMostraRicerca(false)
          }}
          chiudi={() => setMostraRicerca(false)}
        />
      )}

      {cambioVocale && ingresso && (
        <Conferma
          titolo={`Lasci ${ingresso.canale.nome}?`}
          testo={
            <>
              Sei in <strong className="text-testo">{ingresso.canale.nome}</strong>. Per entrare in{' '}
              <strong className="text-testo">{cambioVocale.nome}</strong> devi uscire da li': in due
              stanze insieme non si puo' stare, e chi c'e' rimasto ti vedra' uscire.
            </>
          }
          azione="Spostati"
          conferma={() => {
            const dove = cambioVocale
            setCambioVocale(null)
            void entraDavvero(dove)
          }}
          chiudi={() => setCambioVocale(null)}
        />
      )}

      {mostraAmici && (
        <Amici
          api={api}
          amicizie={amicizie}
          avvisi={impostazioni.avvisiPersone ?? []}
          alternaAvviso={(chi) => {
            const adesso = impostazioni.avvisiPersone ?? []
            void salva({
              avvisiPersone: adesso.includes(chi)
                ? adesso.filter((id) => id !== chi)
                : [...adesso, chi]
            })
          }}
          ricarica={ricaricaAmici}
          chiudi={() => setMostraAmici(false)}
        />
      )}

      {iscrittiDi && spazioAperto && (
        <IscrittiCanale
          api={api}
          canale={iscrittiDi}
          spazio={spazioAperto.id}
          amministra={spazioAperto.ruoloMio === 'admin'}
          io={utente.id}
          chiudi={() => {
            setIscrittiDi(null)
            mondo.ricarica()
          }}
        />
      )}

      {mostraInviti && (
        <Inviti api={api} server={impostazioni.server} chiudi={() => setMostraInviti(false)} />
      )}

      {mostraImpostazioni && (
        <PannelloImpostazioni
          paginaIniziale={sezioneImpostazioni === 'profilo' ? 'profilo' : undefined}
          api={api}
          impostazioni={impostazioni}
          utente={utente}
          salva={salva}
          inChiamata={!!inVoce}
          chiudi={() => setMostraImpostazioni(false)}
          apriInviti={() => {
            setMostraImpostazioni(false)
            setMostraInviti(true)
          }}
          quandoCambiaUtente={(aggiornato) => {
            setUtente(aggiornato)
            void salva({ nome: aggiornato.nome })
          }}
          esciDallAccount={async () => {
            await sessione.esci()
            // Prima si dice al server di chiudere la sessione, poi si dimentica
            // il token: nell'ordine inverso resterebbe una sessione viva sul
            // NAS che nessuno puo' piu' revocare, perche' non si sa piu' quale
            // sia.
            await api.esci().catch(() => {})
            await salva({ token: null })
            setUtente(null)
            setIngresso(null)
            setVerificaFatta(false)
            setMostraImpostazioni(false)
          }}
        />
      )}
    </div>
  )
}

/**
 * Da errore tecnico a frase che dice cosa fare.
 *
 * Quando la SFU non risponde, livekit-client dice "could not establish signal
 * connection" — che e' esatto e non aiuta nessuno. Il piano di controllo aveva
 * appena risposto, quindi il server c'e': il problema e' l'altra meta'
 * dell'impianto, ed e' quello che va detto.
 */
function spiega(errore: Error): string {
  const testo = errore.message ?? ''
  if (/signal|websocket|could not (establish|connect)|timeout/i.test(testo)) {
    return (
      'Il piano di controllo risponde, ma la SFU no. Di solito e\' una di tre cose: ' +
      'il container livekit non e\' partito; SFU_URL nel .env punta a un indirizzo che ' +
      'da qui non si raggiunge; oppure il reverse proxy non ha quel nome, o non ha il ' +
      'supporto WebSocket acceso.'
    )
  }
  return testo || 'Non sono riuscito a entrare, e non so dire perche\'.'
}
