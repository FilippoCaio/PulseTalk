import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionState } from 'livekit-client'
import type {
  Amicizie,
  Canale,
  Impostazioni,
  Ingresso,
  Spazio,
  Utente
} from '@shared/tipi'
import { PERMESSI_DI_GESTIONE, puo, puoQualcosa } from '@shared/permessi'
import { ponte } from './ponte'
import AvvisoAggiornamento, { BloccoAggiornamento } from './AvvisoAggiornamento'
import SceltaServer from './atrio/SceltaServer'
import { usaAggiornamenti } from './lib/usaAggiornamenti'
import { poteriDaiPermessi, usaRestrizioni, vociModerazione } from './lib/usaRestrizioni'
import type { PersonaInVoce } from './spazi/personaInVoce'
import { stessoServer } from '@shared/collegamenti'
import { Api } from './lib/api'
import { usaChat } from './lib/usaChat'
import { usaMondo } from './lib/usaMondo'
import { usaSessione } from './lib/usaSessione'
import { usaDiretti } from './lib/usaDiretti'
import { usaSessioniMedia } from './lib/usaSessioniMedia'
import { suona } from './lib/suoni'
import Accesso, { Completa } from './atrio/Accesso'
import Avvio from './atrio/Avvio'
import PannelloServer, { BottoneServer } from './atrio/Server'
import { applicaTema } from './lib/tema'
import { caricaLingua } from './lib/pacchettiLingua'
import { linguaDaUsare } from './atrio/ScegliLingua'
import BarraSpazi from './spazi/BarraSpazi'
import ColonnaCanali from './spazi/ColonnaCanali'
import PannelloVoce from './spazi/PannelloVoce'
import Amici from './spazi/Amici'
import IscrittiCanale from './spazi/IscrittiCanale'
import MenuSpazio from './spazi/MenuSpazio'
import PannelloSpazio from './spazi/impostazioni/PannelloSpazio'
import EventiSpazio from './spazi/impostazioni/EventiSpazio'
import ColonnaDiretti from './dm/ColonnaDiretti'
import Diretto from './dm/Diretto'
import ChiamataInArrivo, { ChiamataFinita } from './dm/ChiamataInArrivo'
import Chat from './chat/Chat'
import Ricerca from './chat/Ricerca'
import Sala from './sala/Sala'
import AtrioVocale from './spazi/AtrioVocale'
import PannelloImpostazioni from './Impostazioni'
import PopupProfilo from './PopupProfilo'
import { StrisciaProblemi } from './Problemi'
import { LinguettaColonne } from './LinguettaColonne'
import { usaProblema } from './lib/diagnostica'
import { usaComparsa } from './lib/animazioni'
import { usaInattivita } from './lib/usaInattivita'
import { usaDesktop } from './lib/usaDesktop'
import {
  fraseMancanti,
  usaDispositiviMancanti,
  usaRiallineaDispositivi
} from './lib/usaDispositivi'
import { Chiudi, Giu, Menu } from './icone'
import { Avviso, BottoneIcona, Conferma } from './ui'
import { ErroreApi } from './lib/api'
import {
  ascoltaIndietroAndroid,
  avviaServizioChiamata,
  fermaServizioChiamata,
  preparaAudioAndroid
} from './lib/android'

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
  /**
   * Cosa e' andato storto controllando la sessione.
   *
   * Due esiti diversi e volutamente separati. `motivoAccesso` e' una sessione
   * che non vale piu': il token va dimenticato e si torna al modulo di
   * accesso, dicendo perche'. `erroreAvvio` e' il server irraggiungibile: il
   * token e' probabilmente ancora buono e buttarlo via costringerebbe a
   * riscrivere la password ogni volta che cade la linea, quindi si resta sulla
   * schermata di avvio con un "riprova" sotto.
   */
  /**
   * Il server scelto nella prima schermata, prima di avere un account.
   *
   * Non si salva, e non e' una dimenticanza. Nelle impostazioni `server` e' un
   * campo **derivato**: `riallinea` lo ricava dall'elenco dei server collegati,
   * e un collegamento e' un indirizzo con accanto un token. Scriverlo da solo
   * verrebbe scartato al primo salvataggio — e scriverci dentro un indirizzo
   * senza account vorrebbe dire riempire lo scambiatore di server di posti in
   * cui non si e' mai entrati.
   *
   * Quindi vive qui, per il tempo che passa fra "vado su questo" e "ci sono
   * dentro". Al primo accesso riuscito e' `collegaServer` a renderlo vero, con
   * il suo token accanto, e da li' in poi comanda quello.
   */
  const [serverScelto, setServerScelto] = useState<string | null>(null)

  const [motivoAccesso, setMotivoAccesso] = useState<string | null>(null)
  const [erroreAvvio, setErroreAvvio] = useState<string | null>(null)

  const [spazioApertoId, setSpazioApertoId] = useState<number | null>(null)
  const [canaleApertoId, setCanaleApertoId] = useState<number | null>(null)
  const [ingresso, setIngresso] = useState<Ingresso | null>(null)

  /**
   * Cosa occupa le due colonne: i server, oppure i messaggi diretti.
   *
   * Uno stato solo e non due schermate separate: la chiamata vocale, le
   * impostazioni e il pannello del profilo devono continuare a funzionare
   * uguali da entrambe le parti, e duplicarle sarebbe stato il modo piu' rapido
   * di farne divergere una.
   */
  const [vista, setVista] = useState<'spazi' | 'diretti'>('spazi')
  const [conversazioneApertaId, setConversazioneApertaId] = useState<number | null>(null)
  /** Sul telefono le due colonne di navigazione sono un cassetto a tutta pagina. */
  const [navigazioneMobileAperta, setNavigazioneMobileAperta] = useState(true)
  /** La sala occupa anche le colonne desktop; sul telefono la vista e' gia' piena. */
  const [chiamataPiena, setChiamataPiena] = useState(false)

  const [menuSpazioAperto, setMenuSpazioAperto] = useState(false)
  const [impostazioniSpazio, setImpostazioniSpazio] = useState<string | null>(null)
  const [mostraEventi, setMostraEventi] = useState<'guarda' | 'crea' | null>(null)
  const [confermaAbbandono, setConfermaAbbandono] = useState<Spazio | null>(null)
  /** Vero mentre si sta chiedendo la linea a qualcuno: il pulsante non si ripreme. */
  const [chiamando, setChiamando] = useState(false)

  /** L'elenco dei server veri: il NAS di casa, quello dell'ufficio. */
  const [mostraServer, setMostraServer] = useState(false)
  const [mostraImpostazioni, setMostraImpostazioni] = useState(false)
  const [mostraProfilo, setMostraProfilo] = useState(false)
  /** Con quale sezione aprire le impostazioni. Null: l'ultima usata. */
  const [sezioneImpostazioni, setSezioneImpostazioni] = useState<string | null>(null)
  const [mostraRicerca, setMostraRicerca] = useState(false)
  const [mostraAmici, setMostraAmici] = useState(false)
  const [iscrittiDi, setIscrittiDi] = useState<Canale | null>(null)
  const [amicizie, setAmicizie] = useState<Amicizie | null>(null)
  /** Chi era in un vocale al giro precedente, per identita'. */
  const presentiPrima = useRef<Map<string, { canale: string; spazio: number }> | null>(null)
  /**
   * L'ultima cosa andata storta, detta in una riga.
   *
   * Si spegne da sola dopo qualche secondo, e non e' un vezzo: prima restava
   * li' per sempre. Chi provava ad abbandonare uno spazio di cui e'
   * proprietario — cosa che il server rifiuta, e giustamente — si ritrovava
   * quella striscia gialla in cima alla finestra fino alla chiusura
   * dell'applicazione, senza una X, senza scadenza, e senza che cambiare
   * spazio la togliesse. Un avviso che non si puo' chiudere smette di essere
   * un avviso e diventa arredamento.
   */
  const [avviso, setAvviso] = useState<string | null>(null)
  /** Il vocale che si vorrebbe aprire lasciando quello in cui si e' adesso. */
  const [cambioVocale, setCambioVocale] = useState<Canale | null>(null)

  const sessione = usaSessione(impostazioni ?? ({} as Impostazioni))


  useEffect(() => {
    void preparaAudioAndroid()
    void ponte.leggiImpostazioni().then(setImpostazioni)
    return ponte.onImpostazioniCambiate(setImpostazioni)
  }, [])

  /**
   * I colori, messi sullo schermo da un posto solo.
   *
   * Qui e non nella pagina che li sceglie, ed e' la differenza fra "il tema si
   * applica quando lo cambio" e "il tema *e'* cio' che dicono le impostazioni".
   * Il secondo copre anche i due casi che il primo perde: l'apertura dell'app,
   * quando nessuno ha scelto niente e il tema arriva dal disco, e il cambio
   * fatto da un'altra finestra, che entra da `onImpostazioniCambiate` e deve
   * dipingere anche questa.
   *
   * `applicaTema` lascia anche una copia in `localStorage`, che e' cio' che
   * `main.tsx` rilegge prima del primo disegno: senza, ogni apertura sarebbe un
   * lampo dei colori di serie prima che le impostazioni finiscano di arrivare.
   *
   * La dipendenza e' il tema **scritto**, non l'oggetto. Le impostazioni
   * arrivano da IPC, e passando di la' vengono clonate: `impostazioni.tema` e'
   * un oggetto nuovo dopo *qualunque* salvataggio, anche quello di un cursore
   * del volume. Legarsi alla sua identita' vorrebbe dire ridipingere l'app e
   * riscrivere la copia su disco ogni volta che si tocca una qualsiasi
   * impostazione; legarsi al suo contenuto lo fa solo quando i colori cambiano
   * davvero.
   */
  /**
   * La lingua, accesa da qui come i colori.
   *
   * Le due dipendenze sono la scelta e il server, e sono due cose diverse: la
   * scelta decide *quale* lingua, il server decide se esiste un pacchetto
   * aggiornato da scaricare oltre a quello compilato dentro. Cambiare server
   * ricarica quindi la stessa lingua, che e' giusto: il pacchetto potrebbe
   * essere un altro.
   *
   * Senza scelta si guarda il sistema, e non si scrive niente: `lingua` resta
   * vuota finche' qualcuno non la sceglie davvero, cosi' chi apre l'app su un
   * computer in inglese la trova in inglese, e chi ha scelto l'italiano se lo
   * tiene ovunque.
   */
  useEffect(() => {
    void caricaLingua(linguaDaUsare(impostazioni?.lingua), impostazioni?.server || null)
  }, [impostazioni?.lingua, impostazioni?.server])

  const temaScritto = JSON.stringify(impostazioni?.tema ?? null)
  useEffect(() => {
    const tema = JSON.parse(temaScritto) as Impostazioni['tema'] | null
    if (tema) applicaTema(tema)
  }, [temaScritto])

  const api = useMemo(
    () => (impostazioni?.server && impostazioni.token ? new Api(impostazioni.server, impostazioni.token) : null),
    [impostazioni?.server, impostazioni?.token]
  )

  const salva = useCallback(async (modifiche: Partial<Impostazioni>) => {
    const { impostazioni: nuove } = await ponte.scriviImpostazioni(modifiche)
    setImpostazioni(nuove)
    return nuove
  }, [])

  /**
   * Il microfono di ieri, controllato oggi.
   *
   * Chi ha scelto un dispositivo a mano se lo ritrova scelto anche riaprendo
   * l'app — ma se nel frattempo quelle cuffie sono state staccate, Chromium
   * ripiega sul predefinito senza dire niente, e si parla in un microfono che
   * non e' quello che si crede. Qui si guarda e si dice, una volta sola: la
   * scelta resta salvata, e ricollegandolo torna al suo posto da solo.
   *
   * La chiave e' quali mancano, non quanti: chiudendo l'avviso si zittiscono
   * quei dispositivi li'. Se domani ne sparisce un altro, si riapre.
   */
  // Prima di guardare cosa manca, si rimettono a posto gli id che sono
  // cambiati senza che sia cambiato niente: altrimenti il primo avviso della
  // giornata sarebbe sempre per dei dispositivi che stanno al loro posto.
  usaRiallineaDispositivi(impostazioni, salva)

  /**
   * Gli aggiornamenti, guardati da un posto solo.
   *
   * Il controllo all'avvio l'ha gia' fatto il processo principale appena la
   * finestra e' comparsa; questo hook si limita ad ascoltare lo stato e a
   * consegnare all'aggiornatore il vincolo che il server dichiara, quando
   * risponde. Le due cose non si accavallano: il main ha una guardia sola per
   * entrambe, quindi il secondo che arriva si attacca al primo invece di
   * aprire un altro download sullo stesso file.
   */
  const aggiornamenti = usaAggiornamenti(api)

  // Inattivo non e' piu' una voce di menu: lo decide il microfono. `parlanti`
  // contiene chi supera in questo istante la soglia dell'automute, e la propria
  // identita' nella stanza e' sempre `u<id>`.
  usaInattivita(api, utente ? sessione.parlanti.has(`u${utente.id}`) : false)

  // Otto secondi bastano a leggerlo, e sono pochi abbastanza da non farlo
  // diventare parte della finestra.
  useEffect(() => {
    if (!avviso) return
    const scadenza = window.setTimeout(() => setAvviso(null), 8000)
    return () => window.clearTimeout(scadenza)
  }, [avviso])

  // Cambiando spazio se ne va comunque: quasi sempre parlava di quello che si
  // e' appena lasciato, e portarselo dietro altrove e' solo confusione. Vale
  // anche per lo spazio cancellato, che cambia lo spazio aperto.
  useEffect(() => setAvviso(null), [spazioApertoId])

  const mancanti = usaDispositiviMancanti(impostazioni)
  usaProblema(
    mancanti.length
      ? {
          // La chiave dice *quali*, non quanti: chiudendo l'avviso si
          // zittiscono quei dispositivi li'. Se domani ne sparisce un altro, la
          // chiave cambia e l'avviso torna.
          chiave: `dispositivi:${mancanti.map((m) => m.campo).join(',')}`,
          gravita: 'attenzione',
          titolo:
            mancanti.length === 1
              ? 'Un dispositivo scelto non risponde'
              : 'Dei dispositivi scelti non rispondono',
          dettaglio: fraseMancanti(mancanti),
          azione: {
            nome: 'Impostazioni audio',
            fai: () => {
              setSezioneImpostazioni('audio')
              setMostraImpostazioni(true)
            }
          }
        }
      : null
  )

  /**
   * La verifica della sessione, che decide dove si va a finire.
   *
   * Finche' non ha risposto non si disegna ne' l'accesso ne' l'applicazione:
   * si resta sulla schermata di avvio. E' l'unica maniera di non far comparire
   * per un istante il modulo dell'accesso a chi e' gia' dentro.
   *
   * Fallire non e' una cosa sola. Un 401 e' una sessione che non c'e' piu': il
   * token si dimentica e si torna all'accesso con scritto perche'. Tutto il
   * resto — server spento, tunnel giu', wi-fi cambiato — non dice niente sul
   * token, e buttarlo via sarebbe la reazione sbagliata al guasto sbagliato.
   */
  useEffect(() => {
    if (!api || verificaFatta) return
    let vivo = true

    void api
      .io()
      .then(({ utente, deveCompletare }) => {
        if (!vivo) return
        setUtente(utente)
        setDeveCompletare(deveCompletare)
        setErroreAvvio(null)
        setMotivoAccesso(null)
        setVerificaFatta(true)
      })
      .catch((e) => {
        if (!vivo) return
        const problema = e as ErroreApi
        if (problema instanceof ErroreApi && (problema.stato === 401 || problema.stato === 403)) {
          setUtente(null)
          setMotivoAccesso(
            "La sessione non vale piu': puo' essere scaduta, oppure e' stata revocata da un altro dispositivo."
          )
          void salva({ token: null })
          setVerificaFatta(true)
          return
        }
        setErroreAvvio(problema.message)
      })

    return () => {
      vivo = false
    }
  }, [api, verificaFatta, salva])

  /** Riprovare dopo un guasto di rete: si rimette in moto la verifica. */
  const riprovaAvvio = useCallback(() => {
    setErroreAvvio(null)
    setVerificaFatta(false)
  }, [])

  /**
   * Passare a un altro server vero.
   *
   * Non e' un cambio di schermata: e' un cambio di *tutto*. Spazi, canali,
   * persone, messaggi, amicizie e la chiamata in corso appartengono alla
   * macchina che si sta lasciando, e nessuna di quelle cose ha un
   * corrispondente di la'. Quindi si smonta prima e si cambia dopo, in
   * quest'ordine: uscire dal vocale mentre l'indirizzo e' gia' cambiato
   * vorrebbe dire mandare il "sono uscito" al server sbagliato, e restare
   * dentro alla stanza di prima con dentro un fantasma.
   *
   * `verificaFatta` torna falso: e' cio' che fa ripartire il controllo della
   * sessione, che sul server nuovo e' una sessione diversa. Se di la' un token
   * valido c'e', si entra senza accorgersi di niente; se non c'e', compare il
   * modulo di accesso di quel server.
   */
  const smontaTutto = useCallback(async () => {
    if (ingresso) {
      await sessione.esci().catch(() => {})
      await fermaServizioChiamata().catch(() => {})
    }
    setIngresso(null)
    setChiamataPiena(false)
    setVista('spazi')
    setSpazioApertoId(null)
    setCanaleApertoId(null)
    setConversazioneApertaId(null)
    setMenuSpazioAperto(false)
    setImpostazioniSpazio(null)
    setNavigazioneMobileAperta(true)
    setAmicizie(null)
    setProfili(new Map())
    setAvviso(null)
    setErroreAvvio(null)
    setMotivoAccesso(null)
    setUtente(null)
    setVerificaFatta(false)
  }, [ingresso, sessione])

  const cambiaServer = useCallback(
    async (indirizzo: string) => {
      await smontaTutto()
      setImpostazioni(await ponte.passaAServer(indirizzo))
    },
    [smontaTutto]
  )

  /**
   * Togliere un server dall'elenco.
   *
   * Se e' quello in cui si sta, si smonta tutto come per un cambio: il ponte
   * ha gia' scelto dove si finisce — un altro server collegato, o nessuno, e
   * in quel caso si torna al modulo dell'accesso con il campo dell'indirizzo
   * aperto. Se invece si stava altrove, non c'e' niente da smontare: cambia
   * una riga di un elenco.
   */
  const scollegaServer = useCallback(
    async (indirizzo: string) => {
      const eraAttivo = stessoServer(indirizzo, impostazioni?.serverAttivo ?? '')
      if (eraAttivo) await smontaTutto()
      setImpostazioni(await ponte.scollegaServer(indirizzo))
    },
    [smontaTutto, impostazioni?.serverAttivo]
  )

  /** Sbloccarsi entrando con un altro account: si dimentica il token e si va li'. */
  const vaiAllAccesso = useCallback(() => {
    setErroreAvvio(null)
    setUtente(null)
    setMotivoAccesso(null)
    setVerificaFatta(true)
    void salva({ token: null })
  }, [salva])

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

  // Quale canale sta sotto agli occhi, detto a chi tiene i conteggi. Senza,
  // un messaggio che arriva nel canale aperto accenderebbe il numero blu per
  // il decimo di secondo che passa fra "e' arrivato" e "l'ho letto".
  const canaleInLettura = vista === 'spazi' && canaleAperto?.tipo === 'testo' ? canaleAperto.id : null
  useEffect(() => {
    mondo.inLettura.current = canaleInLettura
  }, [mondo.inLettura, canaleInLettura])

  // -- I messaggi diretti ----------------------------------------------------

  const diretti = usaDiretti(utente ? api : null, utente?.id ?? null, mondo.iscrivi)
  const conversazioneAperta =
    diretti.conversazioni.find((c) => c.id === conversazioneApertaId) ??
    (vista === 'diretti' ? (diretti.conversazioni[0] ?? null) : null)

  // La chat di una conversazione diretta passa dallo stesso hook dei canali:
  // sotto e' un canale, e riscriverla sarebbe stata una seconda copia da tenere
  // allineata per sempre.
  //
  // Ricostruito solo quando cambia qualcosa che conta. L'elenco delle
  // conversazioni si rilegge a ogni evento — uno che entra, uno che scrive —
  // e senza questo il canale finto sarebbe un oggetto nuovo a ogni giro:
  // uguale in tutto tranne che nell'identita', che e' pero' l'unica cosa che
  // React guarda.
  const canaleDiretto: Canale | null = useMemo(
    () =>
      conversazioneAperta
        ? {
            id: conversazioneAperta.canale,
            chiave: `dm-${conversazioneAperta.id}`,
            nome: conversazioneAperta.con.nome,
            icona: null,
            tipo: 'testo',
            argomento: '',
            categoria: null,
            posizione: 0,
            soloAscolto: false,
            privato: true,
            creato: 0,
            creatoDa: null,
            scade: null,
            restanoMs: null,
            nonLetti: conversazioneAperta.nonLetti,
            presenti: []
          }
        : null,
    [
      conversazioneAperta?.canale,
      conversazioneAperta?.id,
      conversazioneAperta?.con.nome,
      conversazioneAperta?.nonLetti
    ]
  )
  const chatDiretta = usaChat(api, vista === 'diretti' ? canaleDiretto : null, mondo.iscrivi)


  // -- La voce ---------------------------------------------------------------

  /** Vero mentre un ingresso e' in volo: vedi `entraDavvero`. */
  const entrando = useRef(false)

  const entraDavvero = useCallback(
    async (canale: Canale) => {
      if (!api || !impostazioni) return
      // Un ingresso alla volta.
      //
      // Il guardiano qui sotto guarda `ingresso`, che resta nullo finche' il
      // server non ha risposto: due clic sul canale entro quel mezzo secondo
      // arrivavano qui tutti e due. Ne uscivano due stanze con la stessa
      // identita', che si cacciano a vicenda — e' il resto della storia in
      // `usaSessione.entra`, che ormai sa difendersi da sola. Questa riga
      // evita comunque il giro: una chiamata al server e una stanza in meno.
      if (entrando.current) return
      entrando.current = true
      setAvviso(null)

      // Entrare in un vocale mentre si e' gia' in un altro: si esce dal primo.
      // Due chiamate insieme non hanno senso, e la SFU accetterebbe entrambe.
      if (ingresso) await sessione.esci().catch(() => {})

      try {
        const nuovo = await api.entra(canale.id)
        setIngresso(nuovo)
        setCanaleApertoId(canale.id)
        await sessione.entra(
          nuovo,
          ingresso && impostazioni.disattivaMediaCambioCanale
            ? { ...impostazioni, microfonoAllIngresso: false }
            : impostazioni
        )
        await avviaServizioChiamata(nuovo.canale.nome)
      } catch (e) {
        setIngresso(null)
        await sessione.esci().catch(() => {})
        await fermaServizioChiamata()
        setAvviso(spiega(e as Error))
      } finally {
        entrando.current = false
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
    const chiamata = ingresso
    const diretta = ingresso?.diretta ?? null
    await sessione.esci()
    setIngresso(null)
    setChiamataPiena(false)
    setNavigazioneMobileAperta(true)
    setMenuSpazioAperto(false)
    if (chiamata?.diretta) {
      setVista('diretti')
      setConversazioneApertaId(chiamata.diretta.conversazione)
    } else if (chiamata) {
      setVista('spazi')
      setSpazioApertoId(chiamata.canale.spazio)
      // Il canale resta selezionato, e non e' un dettaglio: uscendo si torna
      // a guardare il posto da cui si e' usciti, con dentro chi c'e' rimasto
      // e il pulsante per rientrare (vedi `AtrioVocale`). Prima si azzerava,
      // e la parte grande dello schermo rispondeva «Scegli un canale a
      // sinistra» a chi un canale ce l'aveva selezionato eccome - e per
      // rientrare bisognava rifare nella colonna il clic appena fatto.
      setCanaleApertoId(chiamata.canale.id)
    }
    await fermaServizioChiamata()
    // Uscire da una chiamata diretta vuol dire riagganciare: senza questa
    // riga la stanza resterebbe aperta sulla SFU e l'altro continuerebbe a
    // vedere una chiamata in corso con dentro nessuno.
    if (diretta && api) await api.chiudiChiamata(diretta.conversazione).catch(() => {})
    mondo.ricarica()
  }, [sessione, mondo.ricarica, ingresso, api])

  /** Entra in una chiamata (di canale o diretta) con un ingresso gia' ottenuto. */
  const entraConIngresso = useCallback(
    async (nuovo: Ingresso) => {
      if (!impostazioni) return
      setAvviso(null)
      if (ingresso) await sessione.esci().catch(() => {})
      try {
        setIngresso(nuovo)
        await sessione.entra(nuovo, impostazioni)
        await avviaServizioChiamata(nuovo.canale.nome)
      } catch (e) {
        setIngresso(null)
        await sessione.esci().catch(() => {})
        await fermaServizioChiamata()
        setAvviso(spiega(e as Error))
      }
    },
    [impostazioni, ingresso, sessione]
  )

  const telefona = useCallback(
    async (conversazione: number) => {
      if (!api) return
      setChiamando(true)
      try {
        const { chiamata, ingresso: nuovo } = await api.avviaChiamata(conversazione)
        diretti.segnaChiamata(chiamata)
        await entraConIngresso(nuovo)
      } catch (e) {
        setAvviso((e as Error).message)
      } finally {
        setChiamando(false)
      }
    },
    [api, diretti, entraConIngresso]
  )

  const rispondi = useCallback(
    async (conversazione: number) => {
      if (!api) return
      try {
        const { chiamata, ingresso: nuovo } = await api.accettaChiamata(conversazione)
        diretti.segnaChiamata(chiamata)
        // Rispondere apre anche la conversazione: chi ha appena risposto vuole
        // vedere con chi sta parlando, non restare dov'era.
        setVista('diretti')
        setConversazioneApertaId(conversazione)
        setNavigazioneMobileAperta(false)
        await entraConIngresso(nuovo)
      } catch (e) {
        setAvviso((e as Error).message)
      }
    },
    [api, diretti, entraConIngresso]
  )

  const riaggancia = useCallback(
    async (conversazione: number, motivo: 'chiusa' | 'rifiutata' = 'chiusa') => {
      if (!api) return
      // Prima si esce dalla stanza, poi si dice al server: nell'ordine inverso
      // la stanza verrebbe chiusa mentre siamo ancora dentro, e livekit-client
      // lo racconterebbe come una disconnessione anomala.
      if (ingresso?.diretta?.conversazione === conversazione) {
        await sessione.esci().catch(() => {})
        setIngresso(null)
        await fermaServizioChiamata()
      }
      await api.chiudiChiamata(conversazione, motivo).catch(() => {})
      diretti.segnaChiamata(null)
    },
    [api, ingresso, sessione, diretti]
  )

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
    const adesso = new Map<string, { canale: string; spazio: number }>()
    for (const spazio of spazi) {
      for (const canale of spazio.canali) {
        if (canale.tipo !== 'voce') continue
        for (const persona of canale.presenti) {
          adesso.set(persona.identita, { canale: canale.nome, spazio: spazio.id })
        }
      }
    }

    const prima = presentiPrima.current
    presentiPrima.current = adesso
    if (prima === null || !impostazioni) return

    for (const chi of impostazioni.avvisiPersone ?? []) {
      if (chi === utente?.id) continue
      const identita = `u${chi}`
      if (!adesso.has(identita) || prima.has(identita)) continue

      const dove = adesso.get(identita)!
      const silenziato = (impostazioni.spaziSilenziati ?? []).some(
        (s) => s.spazio === dove.spazio && (s.fino === null || s.fino > Date.now())
      )
      if (silenziato) continue

      const nome = profili.get(chi)?.nome ?? 'Qualcuno'
      ponte.notifica({ titolo: `${nome} e' entrato`, corpo: `In ${dove.canale}` })
      suona('altroEntrato')
    }
  }, [spazi, impostazioni, profili, utente?.id])

  const inVoce = ingresso && sessione.stato !== ConnectionState.Disconnected ? ingresso.canale.id : null
  /**
   * Le restrizioni vocali del canale in cui si sta parlando.
   *
   * Vive qui e non dentro alla sala per lo stesso motivo della sessione: la
   * colonna dei canali le mostra anche mentre si sta leggendo una chat, e uno
   * stato tenuto piu' in basso morirebbe a ogni cambio di schermata.
   */
  const restrizioni = usaRestrizioni(
    api,
    inVoce,
    utente?.id ?? null,
    mondo.iscrivi,
    ingresso?.restrizioni
  )

  /**
   * Cosa si puo' fare a chi compare sotto a un canale vocale.
   *
   * Costruito qui perche' e' l'unico posto in cui esistono tutte e tre le cose
   * che servono: la sessione RTC per i volumi, i diretti per scrivere a
   * qualcuno, e i permessi del canale in cui si sta parlando per i
   * provvedimenti.
   *
   * I provvedimenti compaiono solo nel canale in cui si e' dentro, e non e' una
   * limitazione arbitraria: i poteri arrivano con l'ingresso — `ingresso.permessi`
   * li calcola il server per QUEL canale — e per un canale in cui non si e'
   * entrati non li abbiamo. Il server accetterebbe la richiesta lo stesso;
   * disegnare voci senza sapere se si possono premere sarebbe un modo di far
   * scoprire i propri permessi a forza di 403.
   */
  const personaInVoce: PersonaInVoce = useMemo(
    () => ({
      io: utente?.id ?? null,
      volumi: (identita) => {
        const suoi = sessione.volumiDi(identita)
        return [
          {
            chiave: 'voce',
            nome: 'voce',
            volume: suoi.voce,
            muto: suoi.mutoVoce,
            cambia: (v) => sessione.impostaVolume(identita, 'voce', v),
            alternaMuto: () => sessione.alternaMuto(identita, 'voce')
          }
        ]
      },
      /**
       * I poteri, presi dalla fonte migliore che c'e' per quel canale.
       *
       * Dentro alla stanza in cui si sta parlando li dichiara il server
       * all'ingresso, e li' dentro c'e' anche chi comanda soltanto perche' sta
       * organizzando un evento adesso. Per gli altri canali si ricavano dai
       * permessi che `GET /api/spazi` restituisce gia' risolti, canale per
       * canale: non conoscono l'organizzatore di un evento — quello lo calcola
       * il server all'ingresso — e bastano per tutto il resto.
       *
       * Le voci si disegnano comunque solo dove si ha il diritto: a dire di no
       * resta il server, su ogni richiesta.
       */
      moderazione: (canale, chi) => {
        const poteri =
          ingresso && ingresso.canale.id === canale
            ? ingresso.permessi
            : poteriDaiPermessi(
                spazi
                  .flatMap((s) => s.canali)
                  .find((c) => c.id === canale)?.permessiMiei
              )
        return vociModerazione(poteri, restrizioni, canale, chi, setAvviso)
      },
      restrizioni: (canale, chi) => restrizioni.per(canale).get(chi),
      assicura: restrizioni.assicura,
      caccia: api
        ? async (canale, identita) => {
            try {
              await api.caccia(canale, identita)
            } catch (e) {
              setAvviso((e as Error).message)
            }
          }
        : undefined,
      scrivi: (chi) => {
        void diretti.apriCon(chi).then((c) => {
          if (!c) return
          setVista('diretti')
          setConversazioneApertaId(c.id)
          setNavigazioneMobileAperta(false)
        })
      },
      vaiAiDiretti: (chi) => {
        void diretti.apriCon(chi).then((c) => {
          if (!c) return
          setVista('diretti')
          setConversazioneApertaId(c.id)
          setNavigazioneMobileAperta(true)
        })
      }
    }),
    [utente?.id, sessione, ingresso, api, restrizioni, diretti, spazi]
  )
  /**
   * La chat del canale VOCALE, che e' una cosa diversa da quella del canale
   * aperto: mentre si parla si puo' stare a leggere un canale di testo, e le
   * due conversazioni non devono mescolarsi.
   *
   * Sono due istanze separate apposta. Una sola, spostata avanti e indietro,
   * ricaricherebbe i messaggi ogni volta che si cambia scheda.
   */
  const canaleVocale = spazioAperto?.canali.find((c) => c.id === inVoce) ?? null
  const chatVocale = usaChat(api, canaleVocale, mondo.iscrivi)

  /**
   * Le sessioni condivise del canale in cui si sta parlando.
   *
   * Vivono qui e non dentro alla sala per la stessa ragione della sessione
   * vocale: chi apre un video insieme e poi va a leggere una chat deve
   * ritrovarlo dov'era. Il canale e' quello vero per un vocale, e quello della
   * conversazione per una chiamata diretta — sotto sono la stessa cosa.
   */
  const canaleMedia = ingresso?.diretta
    ? (diretti.conversazioni.find((c) => c.id === ingresso.diretta!.conversazione)?.canale ?? null)
    : inVoce
  const media = usaSessioniMedia(api, canaleMedia, mondo.iscrivi)

  /**
   * Dove sta la chiamata: il nome dello spazio, e come ci si torna.
   *
   * Il nome serve al pannello in basso a sinistra, che con il solo nome del
   * canale diceva di essere in chiamata senza dire in casa di chi: con
   * quattro server aperti "Salotto" ce l'hanno in tre.
   *
   * Tornare, invece, vuol dire rimettere a posto tutte e tre le cose che si
   * sono spostate mentre si parlava: quale colonna si guarda, quale spazio e'
   * aperto, e quale canale dentro a quello spazio. Rimettere solo l'ultima
   * lasciava selezionato il canale della chiamata dentro a un server che non
   * si stava guardando, e il pulsante sembrava non fare niente.
   */
  const spazioDellaChiamata = ingresso?.diretta
    ? 'Messaggi diretti'
    : (spazi.find((s) => s.id === ingresso?.canale.spazio)?.nome ?? 'Questo server')

  /** Vero se sotto agli occhi c'e' gia' la stanza in cui si sta parlando. */
  const guardaLaChiamata = ingresso?.diretta
    ? vista === 'diretti' && conversazioneApertaId === ingresso.diretta.conversazione
    : vista === 'spazi' && spazioAperto?.id === ingresso?.canale.spazio && canaleApertoId === inVoce

  /**
   * Le due comparse della finestra principale.
   *
   * `segnoVista` cambia quando cambia cio' che si sta guardando: il canale, la
   * conversazione, il passaggio dai server ai diretti, l'entrata in una
   * chiamata. Non cambia per un messaggio nuovo ne' per uno che entra in un
   * vocale — quelle sono cose che succedono *dentro* a cio' che si guarda, e
   * far ripartire l'animazione a ogni frase detta sarebbe insopportabile.
   */
  const segnoVista = `${vista}:${spazioAperto?.id ?? 0}:${canaleAperto?.id ?? 0}:${
    conversazioneAperta?.id ?? 0
  }:${guardaLaChiamata ? 'sala' : 'testo'}`
  const finestra = usaComparsa<HTMLElement>(segnoVista)
  const colonna = usaComparsa<HTMLDivElement>(`${vista}:${spazioAperto?.id ?? 0}`, 'colonna')

  const tornaAllaChiamata = useCallback((): void => {
    if (!ingresso) return
    setMenuSpazioAperto(false)
    setNavigazioneMobileAperta(false)
    if (ingresso.diretta) {
      setVista('diretti')
      setConversazioneApertaId(ingresso.diretta.conversazione)
      return
    }
    setVista('spazi')
    setSpazioApertoId(ingresso.canale.spazio)
    setCanaleApertoId(ingresso.canale.id)
  }, [ingresso])

  /**
   * Lascia soltanto la schermata della chiamata, restando collegati al vocale.
   * Sul telefono riapre server e canali nello spazio della chiamata; la
   * linguetta laterale permette poi di rientrare con un solo tocco.
   */
  const lasciaVistaChiamata = useCallback((): void => {
    if (!ingresso) return
    setChiamataPiena(false)
    setMenuSpazioAperto(false)
    setNavigazioneMobileAperta(true)
    if (ingresso.diretta) {
      setVista('diretti')
      setConversazioneApertaId(ingresso.diretta.conversazione)
      return
    }
    setVista('spazi')
    setSpazioApertoId(ingresso.canale.spazio)
    setCanaleApertoId(ingresso.canale.id)
  }, [ingresso])

  /**
   * La richiesta di condividere arrivata da fuori dalla sala.
   *
   * Sta qui e non nella sala perche' la sala spesso non c'e' ancora: si preme
   * il pulsante stando a leggere una chat, e il pannello delle sorgenti vive
   * dentro alla schermata della chiamata, che viene montata da quello stesso
   * clic. La richiesta resta appesa qui finche' qualcuno la raccoglie, e chi
   * la raccoglie la spegne — un contatore da confrontare col precedente non
   * avrebbe funzionato proprio nel caso che conta, perche' una sala appena
   * nata non ha nessun precedente da confrontare.
   */
  const [richiestaCondivisione, setRichiestaCondivisione] = useState(false)
  const condivisioneServita = useCallback(() => setRichiestaCondivisione(false), [])

  /** La chiamata diretta di adesso, se e' quella su cui si sta parlando. */
  const chiamataAperta =
    diretti.chiamata && conversazioneAperta && diretti.chiamata.conversazione === conversazioneAperta.id
      ? diretti.chiamata
      : null

  /** Chi sta chiamando adesso, e non e' una chiamata partita da qui. */
  const squilla =
    diretti.chiamata?.stato === 'squilla' && diretti.chiamata.a === utente?.id
      ? diretti.chiamata
      : null

  /**
   * Il menu del server: quali voci, e cosa fanno.
   *
   * Costruito qui e passato giu' come nodo, perche' le sue voci toccano cose
   * che la colonna dei canali non ha: le impostazioni locali per i silenzi, il
   * pannello degli eventi, quello di gestione.
   */
  const silenzia = useCallback(
    (spazioId: number, minuti: number | null) => {
      const altri = (impostazioni?.spaziSilenziati ?? []).filter((s) => s.spazio !== spazioId)
      void salva({
        spaziSilenziati: [
          ...altri,
          { spazio: spazioId, fino: minuti === null ? null : Date.now() + minuti * 60_000 }
        ]
      })
    },
    [impostazioni?.spaziSilenziati, salva]
  )

  const riattiva = useCallback(
    (spazioId: number) => {
      void salva({
        spaziSilenziati: (impostazioni?.spaziSilenziati ?? []).filter((s) => s.spazio !== spazioId)
      })
    },
    [impostazioni?.spaziSilenziati, salva]
  )

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

  /**
   * La sezione di sinistra: chiusa o aperta, e chi lo decide.
   *
   * Due soli motivi per cui quelle colonne possono non esserci, e vale la pena
   * tenerli separati. `chiamataPiena` e' la stanza che si prende la finestra:
   * dura quanto la chiamata e si spegne da sola uscendo. La preferenza salvata
   * e' invece una scelta di chi guarda, e deve sopravvivere alla chiusura
   * dell'applicazione.
   *
   * Il terzo motivo che c'era e' stato tolto: il tutto schermo della finestra —
   * F11, o il pulsante del sistema. Il processo principale avvisava, la sala si
   * prendeva tutto e la sezione di sinistra spariva senza che nessuno l'avesse
   * chiesto. Allargare la finestra vuol dire volere piu' spazio per cio' che si
   * sta guardando, non un'interfaccia diversa — e soprattutto non restava
   * niente da premere per riaverla indietro, perche' l'unica via era Esc e non
   * si vedeva da nessuna parte.
   *
   * Solo sul desktop: sotto ai 768 pixel quelle stesse colonne sono il cassetto
   * della navigazione, e chiuderle vorrebbe dire lasciare il telefono senza un
   * modo di cambiare canale.
   */
  const desktop = usaDesktop()
  const colonneChiuse = desktop && (impostazioni?.colonneChiuse ?? false)
  const colonneRitirate = chiamataPiena || colonneChiuse

  /**
   * Quante colonne ci sono davvero: due, o solo la barra dei server.
   *
   * Serve alla linguetta, che deve stare sul loro bordo destro e non sa
   * misurarlo. Nei diretti la colonna delle conversazioni c'e' sempre; fra i
   * server c'e' quella dei canali solo se uno spazio e' aperto — senza, resta
   * la sola barra delle icone e il bordo cade quindici rem piu' a sinistra.
   */
  const dueColonne = vista === 'diretti' || spazioAperto !== null

  /**
   * La linguetta: un pulsante solo per due direzioni.
   *
   * Riaprire vuol dire riavere le colonne comunque fossero sparite. Se a
   * ritirarle e' stata la chiamata a tutta finestra, questa le rimette dentro
   * anche uscendo da li': lasciare `chiamataPiena` acceso con le colonne
   * aperte vorrebbe dire una sala che si crede a tutto schermo mentre non lo
   * e', e da quello stato in poi il pulsante nell'angolo della sala direbbe
   * il contrario di quello che fa.
   */
  const alternaColonne = useCallback((): void => {
    const riapri = chiamataPiena || colonneChiuse
    if (riapri) setChiamataPiena(false)
    void salva({ colonneChiuse: !riapri })
  }, [chiamataPiena, colonneChiuse, salva])

  /**
   * Il tutto schermo della sala, dal suo pulsante e dal menu del tasto destro.
   *
   * Uscendo riapre anche le colonne chiuse a mano. Quel pulsante si chiama
   * "Torna alle colonne", e con la sezione di sinistra gia' chiusa non ne
   * sarebbe tornata nessuna: un pulsante che promette una cosa e non la fa e'
   * peggio di un pulsante che non c'e'.
   */
  const alternaChiamataPiena = useCallback((): void => {
    if (chiamataPiena && colonneChiuse) void salva({ colonneChiuse: false })
    setChiamataPiena(!chiamataPiena)
  }, [chiamataPiena, colonneChiuse, salva])

  /**
   * Se sullo schermo, adesso, c'e' la sala.
   *
   * Sono le stesse due condizioni dei rami piu' sotto, scritte una volta sola
   * perche' servono anche qui: in chiamata la linguetta la disegna l'overlay
   * della sala — dentro, cosi' va e viene col cursore — e quella
   * dell'applicazione deve togliersi di mezzo, o sarebbero due nello stesso
   * punto.
   *
   * Non si riusa `guardaLaChiamata`: quello guarda quale canale e quale
   * conversazione si sono *scelti*, questi due guardano cio' che si e' davvero
   * trovato. In mezzo c'e' un ripiego — la prima conversazione, il primo
   * canale di testo — e finche' la scelta e' vuota le due risposte non
   * coincidono. Qui una risposta sbagliata vuol dire la linguetta due volte,
   * oppure nessuna.
   */
  const salaDiretta = !!(
    ingresso?.diretta &&
    conversazioneAperta &&
    ingresso.diretta.conversazione === conversazioneAperta.id
  )
  const salaCanale = !!(inVoce && canaleAperto?.id === inVoce)
  const salaInVista = vista === 'diretti' ? salaDiretta : !!spazioAperto && salaCanale

  useEffect(
    () =>
      ascoltaIndietroAndroid(() => {
        if (chiamataPiena || (guardaLaChiamata && !navigazioneMobileAperta)) {
          lasciaVistaChiamata()
          return true
        }
        if (mostraRicerca) return setMostraRicerca(false), true
        if (mostraAmici) return setMostraAmici(false), true
        if (mostraProfilo) return setMostraProfilo(false), true
        if (mostraImpostazioni) return setMostraImpostazioni(false), true
        if (impostazioniSpazio !== null) return setImpostazioniSpazio(null), true
        if (mostraEventi) return setMostraEventi(null), true
        if (iscrittiDi) return setIscrittiDi(null), true
        if (cambioVocale) return setCambioVocale(null), true
        if (!navigazioneMobileAperta) return setNavigazioneMobileAperta(true), true
        return false
      }),
    [
      chiamataPiena,
      guardaLaChiamata,
      lasciaVistaChiamata,
      mostraRicerca,
      mostraAmici,
      mostraProfilo,
      mostraImpostazioni,
      impostazioniSpazio,
      mostraEventi,
      iscrittiDi,
      cambioVocale,
      navigazioneMobileAperta
    ]
  )

  // -- Le schermate che vengono prima ----------------------------------------


  // L'ordine di questi quattro casi e' il flusso di avvio, e conta:
  //
  //   impostazioni non lette  -> avvio
  //   nessun token            -> accesso, senza aspettare niente
  //   token da verificare     -> avvio, e da qui si esce in una direzione sola
  //   dentro, dati in arrivo  -> avvio, finche' non c'e' l'essenziale
  if (!impostazioni) {
    return <Avvio passo="un istante…" />
  }

  /**
   * L'accesso, con l'elenco dei server sempre a portata.
   *
   * Serve per una strada storta che altrimenti non ha uscita: si passa al
   * server dell'ufficio, di la' il token non vale piu', e si finisce sul
   * modulo di accesso di *quel* server. Senza questo pulsante l'unico modo per
   * tornare a casa sarebbe indovinare la password dell'ufficio, cioe' nessuno.
   *
   * Sta sotto alla guardia qui sopra e non insieme agli altri `useCallback`
   * perche' ha bisogno delle impostazioni gia' lette: prima di quella riga
   * sono ancora `null`.
   */
  const impostazioniLette = impostazioni

  /**
   * Il server di questo momento: quello collegato, o quello appena scelto.
   *
   * Vuoto vuol dire "non si sa ancora dove", ed e' l'unico caso in cui la
   * prima schermata e' quella dell'indirizzo invece che quella dell'accesso.
   */
  const serverDaUsare = impostazioni.server || serverScelto || ''
  const conScambiatore = (schermata: React.JSX.Element): React.JSX.Element => (
    <div className="relative h-full">
      {schermata}
      {/* La novita' si vede anche da qui, e non e' un di piu'.

          «All'apertura» per chi non ha ancora fatto l'accesso vuol dire questa
          schermata: e' la prima cosa che vede, e per un pezzo l'unica. Il
          controllo parte comunque — l'installer il feed lo conosce gia', e
          `aggiorna.ts` e' scritto apposta per funzionare prima del login —
          quindi lo stato c'e' e mancava soltanto un posto in cui mostrarlo.

          Si e' visto solo installando l'applicazione e aprendola: da
          sviluppatore si arriva alle tre colonne con il token gia' in tasca, e
          questa schermata non la si attraversa quasi mai. */}
      <AvvisoAggiornamento
        stato={aggiornamenti.stato}
        inVoce={false}
        scarica={aggiornamenti.scarica}
        installa={aggiornamenti.installa}
      />
      {impostazioniLette.serverCollegati.length > 0 && (
        <div className="absolute top-3 left-3 z-10">
          <BottoneServer impostazioni={impostazioniLette} apri={() => setMostraServer(true)} />
        </div>
      )}
      {mostraServer && (
        <PannelloServer
          impostazioni={impostazioniLette}
          chiudi={() => setMostraServer(false)}
          cambiaServer={cambiaServer}
          scollega={scollegaServer}
        />
      )}
    </div>
  )

  /**
   * Prima di tutto: dove.
   *
   * Senza un server non c'e' niente da chiedere a nessuno — non un nome, non
   * una password, non un codice di invito, perche' un codice di invito vale
   * per un server solo. Prima si sceglie la macchina, poi ci si entra o ci si
   * fa un account sopra.
   *
   * Nel browser questa schermata non compare mai, ed e' giusto: li' il server
   * e' l'origine da cui la pagina e' stata servita, e chiederlo vorrebbe dire
   * far scrivere a qualcuno l'indirizzo che ha appena aperto.
   *
   * Non passa da `conScambiatore`: lo scambiatore di server, qui, sarebbe un
   * secondo modo di fare l'unica cosa che questa schermata gia' fa.
   */
  if (!serverDaUsare) {
    return <SceltaServer impostazioni={impostazioni} quandoScelto={setServerScelto} />
  }

  if (!api) {
    return conScambiatore(
      <Accesso
        impostazioni={impostazioni}
        serverScelto={serverDaUsare}
        motivo={motivoAccesso}
        salva={salva}
        // Solo al primo avvio, quando di server collegati non ce n'e' nessuno:
        // li' `serverScelto` e' l'unica cosa che tiene in piedi questa
        // schermata, e azzerarlo riporta alla domanda «dove». Con un server
        // gia' collegato la strada e' un'altra ed e' migliore — il quadratino
        // in alto a sinistra, che apre l'elenco invece di riportare a un campo
        // vuoto — e infatti `conScambiatore` lo disegna proprio da li' in su.
        tornaAllaScelta={
          impostazioniLette.serverCollegati.length === 0
            ? () => setServerScelto(null)
            : undefined
        }
        quandoEntra={(u) => {
          setUtente(u)
          setDeveCompletare(false)
          setMotivoAccesso(null)
          setErroreAvvio(null)
          setVerificaFatta(true)
        }}
      />
    )
  }

  /**
   * Il server non parla con questa versione: si ferma qui.
   *
   * Prima dell'accesso, e prima del controllo della sessione: chiedere una
   * password a chi comunque non entrera' e' farlo lavorare per niente. Resta
   * raggiungibile lo scambiatore di server, che e' l'unica strada sensata
   * quando e' il server a essere indietro.
   */
  if (aggiornamenti.vincolo?.obbligatorio) {
    return conScambiatore(
      <BloccoAggiornamento
        stato={aggiornamenti.stato}
        motivo={aggiornamenti.vincolo.motivo}
        target={aggiornamenti.vincolo.versioneTarget}
        troppoNuovo={aggiornamenti.vincolo.azione === 'clientTroppoNuovo'}
        scarica={aggiornamenti.scarica}
        installa={aggiornamenti.installa}
      />
    )
  }

  if (erroreAvvio) {
    return conScambiatore(
      <Avvio
        passo="Controllo la sessione…"
        errore={erroreAvvio}
        riprova={riprovaAvvio}
        vaiAllAccesso={vaiAllAccesso}
      />
    )
  }

  if (!verificaFatta) {
    return <Avvio passo="Controllo la sessione…" />
  }

  if (!utente) {
    return conScambiatore(
      <Accesso
        impostazioni={impostazioni}
        serverScelto={serverDaUsare}
        motivo={motivoAccesso}
        salva={salva}
        quandoEntra={(u) => {
          setUtente(u)
          setDeveCompletare(false)
          setMotivoAccesso(null)
          setErroreAvvio(null)
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

  // I dati essenziali: gli spazi. Finche' non sono arrivati si resta sulla
  // schermata di avvio invece di far lampeggiare le tre colonne vuote. Un
  // errore, invece, passa: sotto c'e' gia' chi lo mostra con il "riprova".
  if (mondo.spazi === null && !mondo.errore) {
    return <Avvio passo="Carico i tuoi spazi…" />
  }

  // -- Le tre colonne ---------------------------------------------------------

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* La novita' si vede appena si apre l'applicazione, e si manda via.
          Sopra a tutto e senza rubare spazio: e' una striscia che galleggia,
          non una riga che spinge giu' le tre colonne. */}
      <AvvisoAggiornamento
        stato={aggiornamenti.stato}
        inVoce={inVoce !== null}
        scarica={aggiornamenti.scarica}
        installa={aggiornamenti.installa}
      />

      {/* La barra degli spazi non si smonta quando sparisce: si ritira.

          Smontata non aveva nessuno stato intermedio da disegnare — spariva in
          un fotogramma mentre la sala si allargava nel successivo, ed e' quello
          che si vedeva come uno scatto. Adesso resta nell'albero dentro a un
          contenitore che porta la sua larghezza a zero, e la sala si allarga
          nello stesso movimento perche' e' lo stesso spazio.

          La larghezza sta nello `style` e non in una classe: `md:w-60` e simili
          vincono su qualunque `w-0` sopra ai 768 pixel — che e' esattamente la
          larghezza a cui si guarda un desktop — e la classe che c'era prima non
          faceva niente. Una regola in linea non ha breakpoint contro cui
          perdere. */}
      <div
        className={`riga-collassabile flex w-full shrink-0 ${
          colonneRitirate ? 'riga-collassata' : ''
        }`}
        style={{ height: colonneRitirate ? 0 : '4rem' }}
        inert={colonneRitirate}
      >
      <BarraSpazi
        spazi={spazi}
        aperto={vista === 'spazi' ? (spazioAperto?.id ?? null) : null}
        utente={utente}
        scegli={(id) => {
          setVista('spazi')
          setSpazioApertoId(id)
          setCanaleApertoId(null)
          setMenuSpazioAperto(false)
          setNavigazioneMobileAperta(true)
        }}
        crea={async (nome) => {
          await api.creaSpazio({ nome })
          mondo.ricarica()
        }}
        apriAmici={() => setMostraAmici(true)}
        richieste={amicizie?.ricevute.length ?? 0}
        apriProfilo={() => setMostraProfilo(true)}
        apriDiretti={() => {
          setVista('diretti')
          setMenuSpazioAperto(false)
          setNavigazioneMobileAperta(true)
        }}
        direttiAperti={vista === 'diretti'}
        direttiNonLetti={diretti.nonLetti}
        inVoce={inVoce}
        profili={profili}
        intestazione={
          <BottoneServer impostazioni={impostazioni} apri={() => setMostraServer(true)} />
        }
      />
      </div>

      {mostraServer && (
        <PannelloServer
          impostazioni={impostazioni}
          chiudi={() => setMostraServer(false)}
          cambiaServer={cambiaServer}
          scollega={scollegaServer}
        />
      )}

      {/* Il pannello della chiamata sta in fondo alla colonna di sinistra.

          La larghezza e' quella della colonna dei canali — 15rem — e sta
          scritta a mano perche' un overlay non puo' misurare i fratelli:
          cambiando quella, va cambiata anche questa. Erano 19rem finche' a
          sinistra ce n'erano due, e la barra degli spazi valeva i suoi 4rem:
          adesso quella e' una riga in cima e non toglie piu' larghezza a
          niente.

          A tutto schermo questo pannello se ne va scorrendo a sinistra invece
          di stringersi, e non e' una scelta di gusto — dentro ha una tendina
          che si apre verso l'alto, e un contenitore che taglia cio' che esce
          (`overflow: hidden`) la mozzerebbe a meta' ogni volta. */}
      {inVoce && utente && (
        <div
          className={`pannello-scorrevole absolute bottom-0 left-0 z-20 ${
            navigazioneMobileAperta ? 'block' : 'hidden md:block'
          } w-full md:w-60 ${colonneRitirate ? 'pannello-ritirato' : ''}`}
          inert={colonneRitirate}
        >
          <PannelloVoce
            canale={ingresso!.canale.nome}
            spazio={spazioDellaChiamata}
            stato={sessione.stato}
            latenza={sessione.latenza}
            microfonoAcceso={sessione.microfonoAcceso}
            cameraAccesa={sessione.cameraAccesa}
            sordina={sessione.sordina}
            condivide={sessione.schermiAttivi.length > 0}
            guardando={guardaLaChiamata}
            alternaMicrofono={() => void sessione.alternaMicrofono()}
            alternaCamera={() => void sessione.alternaCamera()}
            alternaSordina={sessione.alternaSordina}
            apriCondivisione={() => {
              // Prima si torna a guardare la stanza, poi si chiede il
              // pannello: il selettore delle sorgenti vive dentro alla sala, e
              // chiederlo restando su una chat vorrebbe dire aprirlo dietro a
              // cio' che si sta leggendo. Prima questo pulsante faceva solo il
              // primo dei due passi, e da dentro alla chiamata — dove il primo
              // passo non cambia niente — sembrava rotto.
              tornaAllaChiamata()
              setRichiestaCondivisione(true)
            }}
            torna={tornaAllaChiamata}
            esci={() => void esciDallaVoce()}
            impostazioni={impostazioni}
            salva={(modifiche) => void salva(modifiche)}
            apriImpostazioni={() => {
              setSezioneImpostazioni(null)
              setMostraImpostazioni(true)
            }}
          />
        </div>
      )}

      {/* Sul telefono e' il filo che riporta alla chiamata mentre si sfogliano
          server, canali o chat. Attaccato al bordo, non ruba spazio al
          contenuto e resta riconoscibile come una linguetta di ritorno. */}
      {inVoce && (navigazioneMobileAperta || !guardaLaChiamata) && (
        <button
          type="button"
          onClick={() => {
            setChiamataPiena(false)
            tornaAllaChiamata()
          }}
          title="Torna alla chiamata"
          aria-label="Torna alla chiamata"
          className="absolute top-1/2 right-0 z-40 flex h-16 w-9 -translate-y-1/2 items-center justify-center rounded-l-2xl border border-r-0 border-bordo bg-fondo-2/95 text-vivo shadow-xl shadow-black/40 backdrop-blur md:hidden"
        >
          <Giu className="h-5 w-5 -rotate-90" />
        </button>
      )}

      {/* Sul desktop, la linguetta che chiude e riapre la sezione di sinistra.
          Stessa idea di quella qui sopra — un pulsante attaccato al bordo, che
          non ruba niente al contenuto — dall'altro lato dello schermo.

          Non in chiamata: li' la stessa linguetta la disegna l'overlay della
          sala, dove va e viene col cursore invece di restare accesa sul bordo
          di un video. Qui fuori resta, e deve restare: la sezione chiusa e'
          una preferenza che sopravvive alla chiamata, e senza un pulsante
          anche nella chat non ci sarebbe piu' modo di riaprirla.

          Il `left` e' calcolato e non e' una classe: sta sul bordo destro della
          colonna, che cade a 15rem quando c'e' e a zero quando e' ritirata o
          quando non ce n'e' nessuna. La stessa misura del pannello della voce
          qui sopra, e come quella va rifatta a mano il giorno in cui la
          colonna cambia larghezza: un elemento in posizione assoluta non puo'
          misurare i fratelli. */}
      {!salaInVista && (
        <LinguettaColonne
          ritirate={colonneRitirate}
          alterna={alternaColonne}
          className="linguetta-colonne absolute top-1/2 z-30 -translate-y-1/2"
          style={{ left: colonneRitirate || !dueColonne ? 0 : '15rem' }}
        />
      )}

      {mostraProfilo && utente && (
        <PopupProfilo
          utente={utente}
          cambiaStato={(stato) => {
            void api.profilo({ stato }).then((r) => setUtente(r.utente))
          }}
          apriAmici={() => setMostraAmici(true)}
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

      {/* Le due colonne, sotto alla riga degli spazi.

          Questo involucro esiste da quando gli spazi sono passati in cima:
          la radice adesso impila in verticale — riga, poi contenuto — e senza
          qualcosa che rimetta in riga cio' che sta sotto, la colonna dei
          canali finirebbe sopra alla chiamata invece che accanto.

          `min-h-0` non e' decorazione: senza, un figlio che scorre porta
          l'altezza del contenitore oltre lo schermo invece di scorrere
          dentro ai suoi limiti, ed e' il modo in cui una chat lunga si
          mangia la barra dei comandi. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {vista === 'diretti' ? (
          <>
            {/* I messaggi diretti prendono le stesse due colonne dei server:
                stessa larghezza, stesso bordo, stesso posto per il pannello
                della voce. Cambiare geometria fra le due viste vorrebbe dire far
                saltare l'interfaccia a ogni passaggio. */}
            <div
              className={`colonna-collassabile w-full shrink-0 border-r border-bordo bg-fondo-2 md:w-60 ${
                navigazioneMobileAperta ? 'flex' : 'hidden md:flex'
              } ${colonneRitirate ? 'colonna-collassata' : ''}`}
              style={{ width: colonneRitirate ? 0 : undefined }}
              inert={colonneRitirate}
            >
            {/* La larghezza di dentro e' fissa e in unita' di finestra, non in
                percentuale del contenitore: se seguisse il contenitore che si
                sta stringendo, a ogni fotogramma l'elenco andrebbe a capo e poi
                si troncherebbe, e per un terzo di secondo la colonna sembrerebbe
                rompersi invece che ritirarsi. */}
            <div ref={colonna} className="flex w-screen shrink-0 flex-col md:w-60">
              <ColonnaDiretti
                api={api}
                conversazioni={diretti.conversazioni}
                apertaId={conversazioneAperta?.id ?? null}
                scegli={(c) => {
                  setConversazioneApertaId(c.id)
                  setNavigazioneMobileAperta(false)
                }}
                apriAmici={() => setMostraAmici(true)}
                quandoApre={(chi) => {
                  void diretti.apriCon(chi).then((c) => {
                    if (!c) return
                    setConversazioneApertaId(c.id)
                    setNavigazioneMobileAperta(false)
                  })
                }}
              />
            </div>
            </div>

            <main
              ref={finestra}
              className={`${navigazioneMobileAperta ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}
            >
              {!guardaLaChiamata && (
                <BarraMobile
                  titolo={conversazioneAperta?.con.nome ?? 'Messaggi diretti'}
                  apri={() => setNavigazioneMobileAperta(true)}
                />
              )}
              {avviso && (
                <div className="p-3">
                  <Avviso tono="attenzione">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1">{avviso}</p>
                      <BottoneIcona
                        tono="fantasma"
                        title="Chiudi l'avviso"
                        className="h-7 w-7 shrink-0"
                        onClick={() => setAvviso(null)}
                      >
                        <Chiudi className="h-3.5 w-3.5" />
                      </BottoneIcona>
                    </div>
                  </Avviso>
                </div>
              )}
              {diretti.errore && (
                <div className="p-3">
                  <Avviso>{diretti.errore}</Avviso>
                </div>
              )}

              {/* `ingresso` di nuovo per esteso accanto al booleano: un `true`
                  non racconta a TypeScript che li' dentro non e' nullo. */}
              {salaDiretta && ingresso ? (
                // In chiamata con questa persona: al posto della chat c'e' la
                // sala, con la conversazione nel pannello laterale. E' lo stesso
                // componente dei canali vocali — una chiamata a due non e' un
                // altro tipo di chiamata, e' una chiamata con due persone.
                <Sala
                  api={api}
                  ingresso={ingresso}
                  sessione={sessione}
                  impostazioni={impostazioni}
                  profili={profili}
                  moderatore={false}
                  salvaImpostazioni={salva}
                  chatVocale={chatDiretta}
                  canaleVocale={canaleDiretto}
                  utente={utente}
                  media={media}
                  schermoIntero={{ attivo: chiamataPiena, alterna: alternaChiamataPiena }}
                  colonne={{ ritirate: colonneRitirate, alterna: alternaColonne }}
                  tornaAiServer={lasciaVistaChiamata}
                  condivisioneRichiesta={richiestaCondivisione}
                  condivisioneServita={condivisioneServita}
                  restrizioni={restrizioni}
                  esci={esciDallaVoce}
                  apriImpostazioni={() => setMostraImpostazioni(true)}
                />
              ) : conversazioneAperta ? (
                <Diretto
                  api={api}
                  conversazione={conversazioneAperta}
                  chat={chatDiretta}
                  io={utente}
                  profili={profili}
                  chiamata={chiamataAperta}
                  chiamando={chiamando}
                  telefona={() => void telefona(conversazioneAperta.id)}
                  riaggancia={() => void riaggancia(conversazioneAperta.id)}
                  mostraAnteprimeLink={impostazioni.mostraAnteprimeLink ?? true}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
                  <p className="text-testo-2">Nessuna conversazione aperta.</p>
                  <p className="text-sm text-testo-3">
                    Con il + nella colonna a sinistra si scrive a chiunque abbia un account qui.
                  </p>
                </div>
              )}
            </main>
          </>
        ) : spazioAperto ? (
          <>
            {/* Bordo e sfondo stanno qui e non sulla colonna: la riga verticale
                deve correre dall'alto al basso senza spezzarsi dove finisce
                l'elenco dei canali e comincia la barra della voce. */}
            <div
              className={`colonna-collassabile w-full shrink-0 border-r border-bordo bg-fondo-2 md:w-60 ${
                navigazioneMobileAperta ? 'flex' : 'hidden md:flex'
              } ${colonneRitirate ? 'colonna-collassata' : ''}`}
              style={{ width: colonneRitirate ? 0 : undefined }}
              inert={colonneRitirate}
            >
            <div ref={colonna} className="flex w-screen shrink-0 flex-col md:w-60">
              <ColonnaCanali
                spazio={spazioAperto}
                apertoId={canaleAperto?.id ?? null}
                inVoce={inVoce}
                scegli={(canale) => {
                  setCanaleApertoId(canale.id)
                  setNavigazioneMobileAperta(false)
                }}
                entraInVoce={(canale) => {
                  setNavigazioneMobileAperta(false)
                  entraInVoce(canale)
                }}
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
                sordine={sessione.sordine}
                persona={personaInVoce}
                menuAperto={menuSpazioAperto}
                alternaMenu={() => setMenuSpazioAperto((v) => !v)}
                menu={
                  impostazioni && (
                    <MenuSpazio
                      spazio={spazioAperto}
                      impostazioni={impostazioni}
                      silenzia={(minuti) => silenzia(spazioAperto.id, minuti)}
                      riattiva={() => riattiva(spazioAperto.id)}
                      apriImpostazioniSpazio={(sezione) => setImpostazioniSpazio(sezione ?? '')}
                      apriInviti={() => setImpostazioniSpazio('inviti')}
                      apriEventi={() => setMostraEventi('guarda')}
                      creaEvento={() => setMostraEventi('crea')}
                      segnaLetto={() => {
                        void api.segnaSpazioLetto(spazioAperto.id).then(mondo.ricarica)
                      }}
                      abbandona={() => setConfermaAbbandono(spazioAperto)}
                      chiudi={() => setMenuSpazioAperto(false)}
                    />
                  )
                }
              />

            </div>
            </div>

            <main
              ref={finestra}
              className={`${navigazioneMobileAperta ? 'hidden md:flex' : 'flex'} min-w-0 flex-1 flex-col`}
            >
              {!guardaLaChiamata && (
                <BarraMobile
                  titolo={canaleAperto ? `${canaleAperto.tipo === 'testo' ? '#' : ''}${canaleAperto.nome}` : spazioAperto.nome}
                  apri={() => setNavigazioneMobileAperta(true)}
                />
              )}
              <StrisciaProblemi />
              {avviso && (
                <div className="p-3">
                  <Avviso tono="attenzione">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1">{avviso}</p>
                      <BottoneIcona
                        tono="fantasma"
                        title="Chiudi l'avviso"
                        className="h-7 w-7 shrink-0"
                        onClick={() => setAvviso(null)}
                      >
                        <Chiudi className="h-3.5 w-3.5" />
                      </BottoneIcona>
                    </div>
                  </Avviso>
                </div>
              )}
              {mondo.errore && (
                <div className="p-3">
                  <Avviso>{mondo.errore}</Avviso>
                </div>
              )}

              {salaCanale && ingresso ? (
                <Sala
                  api={api}
                  ingresso={ingresso}
                  sessione={sessione}
                  impostazioni={impostazioni}
                  profili={profili}
                  moderatore={puo(canaleVocale?.permessiMiei, 'manageVoiceMembers')}
                  salvaImpostazioni={salva}
                  chatVocale={chatVocale}
                  canaleVocale={canaleVocale}
                  utente={utente}
                  media={media}
                  schermoIntero={{ attivo: chiamataPiena, alterna: alternaChiamataPiena }}
                  colonne={{ ritirate: colonneRitirate, alterna: alternaColonne }}
                  tornaAiServer={lasciaVistaChiamata}
                  condivisioneRichiesta={richiestaCondivisione}
                  condivisioneServita={condivisioneServita}
                  restrizioni={restrizioni}
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
                  mostraAnteprimeLink={impostazioni.mostraAnteprimeLink ?? true}
                  accantoAllaLinguetta
                />
              ) : canaleAperto?.tipo === 'voce' ? (
                <AtrioVocale
                  canale={canaleAperto}
                  profili={profili}
                  entra={() => entraInVoce(canaleAperto)}
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
                  Creane uno con il + nella colonna a sinistra: nasce privato, e lo vedi solo tu
                  finche' non inviti qualcuno.
                </p>
              </>
            )}
          </div>
        )}
      </div>

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
          amministra={puoQualcosa(spazioAperto.permessiMiei, PERMESSI_DI_GESTIONE)}
          io={utente.id}
          chiudi={() => {
            setIscrittiDi(null)
            mondo.ricarica()
          }}
        />
      )}

      {/* -- Il server: impostazioni, eventi, uscita --------------------- */}

      {impostazioniSpazio !== null && spazioAperto && (
        <PannelloSpazio
          api={api}
          spazio={spazioAperto}
          io={utente}
          profili={profili}
          sezioneIniziale={impostazioniSpazio || undefined}
          ricarica={mondo.ricarica}
          chiudi={() => setImpostazioniSpazio(null)}
          eliminaSpazio={() => {
            setImpostazioniSpazio(null)
            void api
              .eliminaSpazio(spazioAperto.id)
              .then(() => {
                setSpazioApertoId(null)
                mondo.ricarica()
              })
              .catch((e) => setAvviso((e as Error).message))
          }}
        />
      )}

      {mostraEventi && spazioAperto && (
        <div
          className="velo absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setMostraEventi(null)}
        >
          <div
            className="pannello w-full max-w-2xl space-y-6 rounded-2xl border border-bordo bg-fondo-2 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Eventi di {spazioAperto.nome}</h2>
              <BottoneIcona tono="fantasma" title="Chiudi" onClick={() => setMostraEventi(null)}>
                <Chiudi />
              </BottoneIcona>
            </div>
            <EventiSpazio
              api={api}
              spazio={spazioAperto}
              io={utente}
              profili={profili}
              apriSubitoIlModulo={mostraEventi === 'crea'}
            />
          </div>
        </div>
      )}

      {confermaAbbandono && (
        <Conferma
          titolo={`Abbandoni ${confermaAbbandono.nome}?`}
          testo={
            <>
              Sparisce dalla barra a sinistra e non vedrai piu' i suoi canali. Per rientrare servira'
              un invito — a meno che il server non sia aperto a chiunque abbia un account qui.
            </>
          }
          azione="Abbandona"
          tono="male"
          conferma={() => {
            const quale = confermaAbbandono
            setConfermaAbbandono(null)
            setMenuSpazioAperto(false)
            void api
              .abbandonaSpazio(quale.id)
              .then(() => {
                if (inVoce && quale.canali.some((c) => c.id === inVoce)) void esciDallaVoce()
                setSpazioApertoId(null)
                setCanaleApertoId(null)
                mondo.ricarica()
              })
              .catch((e) => setAvviso((e as Error).message))
          }}
          chiudi={() => setConfermaAbbandono(null)}
        />
      )}

      {/* -- Il telefono ------------------------------------------------- */}

      {squilla && (
        <ChiamataInArrivo
          chiamata={squilla}
          chi={
            diretti.conversazioni.find((c) => c.id === squilla.conversazione)?.con ??
            (profili.has(squilla.da)
              ? {
                  id: squilla.da,
                  nome: profili.get(squilla.da)!.nome,
                  utente: null,
                  avatar: profili.get(squilla.da)!.avatar
                }
              : null)
          }
          rispondi={() => void rispondi(squilla.conversazione)}
          rifiuta={() => void riaggancia(squilla.conversazione, 'rifiutata')}
        />
      )}

      {!squilla && diretti.finita && (
        <ChiamataFinita
          motivo={diretti.finita.motivo}
          nome={
            diretti.conversazioni.find((c) => c.id === diretti.finita!.chiamata.conversazione)?.con
              .nome ?? 'La persona'
          }
          chiudi={diretti.scartaFinita}
        />
      )}

      {mostraImpostazioni && (
        <PannelloImpostazioni
          paginaIniziale={sezioneImpostazioni === 'profilo' ? 'profilo' : undefined}
          api={api}
          impostazioni={impostazioni}
          utente={utente}
          salva={salva}
          inChiamata={!!inVoce}
          apriServer={() => {
            setMostraImpostazioni(false)
            setMostraServer(true)
          }}
          chiudi={() => setMostraImpostazioni(false)}
          quandoCambiaUtente={(aggiornato) => {
            setUtente(aggiornato)
            void salva({ nome: aggiornato.nome })
          }}
          esciDallAccount={async () => {
            await sessione.esci()
            await fermaServizioChiamata()
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

function BarraMobile({ titolo, apri }: { titolo: string; apri: () => void }): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-bordo bg-fondo-2 px-2 md:hidden">
      <BottoneIcona tono="fantasma" title="Apri spazi e canali" onClick={apri}>
        <Menu className="h-5 w-5" />
      </BottoneIcona>
      <span className="min-w-0 flex-1 truncate font-medium">{titolo}</span>
    </header>
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
