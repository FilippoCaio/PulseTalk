// L'audio di una singola applicazione, e l'audio di tutte tranne una.
//
// Windows sa fare tutte e due le cose dal 2020 (Windows 10 2004, SDK 20348), e
// non le sa fare Chromium: `getDisplayMedia` in Electron 43 offre `loopback` e
// `loopbackWithMute`, e sono tutti e due tutto il dispositivo di uscita,
// PulseTalk compreso. E' da li' che nascono i due difetti che questo programma
// esiste per togliere:
//
//   - chi condivide manda dentro anche le voci di chi e' in chiamata, perche'
//     escono dalla stessa uscita che il loopback cattura, e tutti si sentono
//     due volte;
//   - chi condivide una finestra manda tutto il sistema - le notifiche, la
//     musica, il video nell'altra scheda del browser.
//
// L'API si chiama process loopback e vive dentro `ActivateAudioInterfaceAsync`
// con un endpoint finto, `VAD\Process_Loopback`. Prende un PID e una fra due
// modalita': *includi* quell'albero di processi, oppure *escludilo* prendendo
// tutto il resto. Le due modalita' sono esattamente i due difetti qui sopra:
//
//   --includi <pid>    l'audio di quell'applicazione e di nessun'altra
//   --escludi <pid>    tutto il sistema tranne quell'applicazione (noi)
//   --finestra <hwnd>  come --includi, ma il PID lo trova da solo
//
// Perche' un eseguibile separato e non un modulo nativo di Node: un addon va
// ricompilato a ogni cambio di ABI di Electron e su ogni macchina che
// costruisce il pacchetto. Questo si compila una volta, sta nelle risorse, e
// se un giorno non parte l'applicazione resta in piedi senza l'audio della
// condivisione, invece di non partire.
//
// Un limite misurato, che nella documentazione non c'e': l'esclusione vale per
// chi suona con WASAPI, non per chi passa dalle vecchie API di Windows
// (winmm/`PlaySound`, DirectSound). Provato con un processo che suonava un wav
// via `System.Media.SoundPlayer`: `--includi` su quel PID lo prendeva, ma
// `--escludi` sullo stesso PID lo prendeva lo stesso, mentre con una sorgente
// WASAPI l'esclusione dava silenzio pieno. Per noi non cambia niente - PulseTalk
// e' Chromium, e Chromium usa WASAPI - ma spiega perche' una prova fatta con un
// suono di sistema sembri dire che l'esclusione non funziona.
//
// L'albero, poi, e' vivo: se il processo padre muore, i figli ne escono e
// smettono di essere esclusi. Anche questo qui non ci riguarda, perche' il
// processo principale di Electron resta acceso per tutta la chiamata.
//
// Il PCM esce da stdout: 48000 Hz, 2 canali, 16 bit interi con segno,
// interlacciati. Stderr porta le diagnostiche, una riga per volta, e la prima
// e' sempre `PRONTO` oppure `ERRORE <codice> <cosa>`: chi ci parla dall'altra
// parte aspetta quella riga prima di credere che la cattura sia partita.
//
// Si spegne da solo quando stdin si chiude. E' il modo di dire "il padre non
// c'e' piu'" che funziona anche quando il padre e' morto male, senza lasciare
// in giro un processo che cattura audio per sempre.

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <wrl/implements.h>
#include <wrl/client.h>

#include <fcntl.h>
#include <io.h>
#include <stdarg.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <atomic>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "mmdevapi.lib")

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

// Il formato non si negozia e non si chiede: il process loopback non ha un mix
// format da leggere come un endpoint vero - e' un dispositivo virtuale, e il
// formato glielo si dice. 48 kHz stereo perche' e' quello che Opus vuole
// dall'altra parte: chiedendone un altro il ricampionamento lo farebbe
// comunque qualcuno, e tanto vale che lo faccia il servizio audio di Windows,
// che ha gia' i campioni in mano.
constexpr int FREQUENZA = 48000;
constexpr int CANALI = 2;
constexpr int BIT = 16;

// Venti millesimi di secondo di buffer. Piu' corto vorrebbe dire svegliarsi
// piu' spesso per niente; piu' lungo, che il suono va in ritardo sull'immagine
// di quel tanto che si nota.
constexpr REFERENCE_TIME DURATA_BUFFER = 200000;  // unita' da 100 ns

std::atomic<bool> vivo{true};
HANDLE eventoFine = nullptr;

void diagnostica(const char* formato, ...) {
  va_list argomenti;
  va_start(argomenti, formato);
  vfprintf(stderr, formato, argomenti);
  va_end(argomenti);
  fputc('\n', stderr);
  fflush(stderr);
}

void chiudiTutto() {
  vivo = false;
  if (eventoFine) SetEvent(eventoFine);
}

/**
 * Il completamento dell'attivazione, che arriva su un altro thread.
 *
 * `ActivateAudioInterfaceAsync` e' asincrona per forza - dietro c'e' un giro
 * fino al servizio audio - e vuole un oggetto COM a cui richiamare. Qui dentro
 * non si fa niente se non svegliare chi aspetta: il risultato vero si legge
 * dopo, con `GetActivateResult`, e leggerlo da questo thread invece che da
 * quello che ha chiesto non cambierebbe niente ma renderebbe il codice piu'
 * difficile da seguire.
 */
class Completamento
    : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase,
                          IActivateAudioInterfaceCompletionHandler> {
 public:
  HANDLE fatto = CreateEventW(nullptr, TRUE, FALSE, nullptr);

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation*) override {
    SetEvent(fatto);
    return S_OK;
  }

  ~Completamento() {
    if (fatto) CloseHandle(fatto);
  }
};

/** Il nome dell'eseguibile di un processo, minuscolo. Vuoto se non si puo'. */
std::wstring nomeProcesso(DWORD pid) {
  HANDLE processo = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!processo) return L"";
  wchar_t percorso[MAX_PATH] = {0};
  DWORD quanti = MAX_PATH;
  std::wstring nome;
  if (QueryFullProcessImageNameW(processo, 0, percorso, &quanti)) {
    std::wstring intero(percorso, quanti);
    size_t barra = intero.find_last_of(L"\\/");
    nome = barra == std::wstring::npos ? intero : intero.substr(barra + 1);
    for (auto& c : nome) c = towlower(c);
  }
  CloseHandle(processo);
  return nome;
}

struct RicercaFiglia {
  HWND trovata;
};

BOOL CALLBACK cercaCoreWindow(HWND figlia, LPARAM dato) {
  wchar_t classe[128] = {0};
  GetClassNameW(figlia, classe, 128);
  if (wcscmp(classe, L"Windows.UI.Core.CoreWindow") == 0) {
    reinterpret_cast<RicercaFiglia*>(dato)->trovata = figlia;
    return FALSE;
  }
  return TRUE;
}

/**
 * Il processo che possiede una finestra, e quello vero quando la finestra
 * mente.
 *
 * Le applicazioni del Microsoft Store non hanno una finestra propria: la
 * cornice la disegna `ApplicationFrameHost.exe`, che e' il processo che
 * `GetWindowThreadProcessId` restituisce, e che non emette un suono in vita
 * sua. L'applicazione vera sta in una finestra figlia di classe
 * `Windows.UI.Core.CoreWindow`, e per quella la stessa chiamata dice il PID
 * giusto. E' un caso solo, ma coglie tutte le app dello Store insieme.
 */
DWORD processoDellaFinestra(HWND finestra) {
  DWORD pid = 0;
  GetWindowThreadProcessId(finestra, &pid);
  if (pid == 0) return 0;

  if (nomeProcesso(pid) == L"applicationframehost.exe") {
    RicercaFiglia ricerca{nullptr};
    EnumChildWindows(finestra, cercaCoreWindow, reinterpret_cast<LPARAM>(&ricerca));
    if (ricerca.trovata) {
      DWORD vero = 0;
      GetWindowThreadProcessId(ricerca.trovata, &vero);
      if (vero) return vero;
    }
  }
  return pid;
}

/**
 * Il thread che guarda stdin: quando si chiude, il padre non c'e' piu'.
 *
 * Vale solo se stdin e' davvero un tubo. Avviato a mano da un terminale, o con
 * l'ingresso mandato su NUL, la prima lettura torna zero byte subito - che e'
 * la stessa cosa che dice un padre morto - e il programma si spegneva un
 * istante dopo aver scritto PRONTO, senza catturare niente. Un handle che non
 * e' un tubo non e' un segnale di vita: si lascia perdere e si resta accesi
 * finche' non ci ammazzano.
 */
DWORD WINAPI guardaIlPadre(LPVOID) {
  const HANDLE ingresso = GetStdHandle(STD_INPUT_HANDLE);
  if (ingresso == nullptr || ingresso == INVALID_HANDLE_VALUE ||
      GetFileType(ingresso) != FILE_TYPE_PIPE) {
    return 0;
  }

  char buco[256];
  while (vivo) {
    DWORD letti = 0;
    if (!ReadFile(ingresso, buco, sizeof(buco), &letti, nullptr) || letti == 0) break;
  }
  chiudiTutto();
  return 0;
}

BOOL WINAPI gestoreConsole(DWORD) {
  chiudiTutto();
  return TRUE;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  DWORD pid = 0;
  HWND finestra = nullptr;
  PROCESS_LOOPBACK_MODE modo = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  bool modoScelto = false;
  bool tuttoIlSistema = false;
  bool rumoroso = false;

  for (int i = 1; i < argc; i++) {
    const std::wstring voce = argv[i];
    const bool haValore = i + 1 < argc;
    if (voce == L"--sistema") {
      // Il loopback di sempre, quello dell'uscita predefinita. Non serve a
      // PulseTalk - e' esattamente cio' che Electron sa gia' fare da solo - ma
      // serve a dire da che parte sta un guasto: se qui arriva del suono e dal
      // process loopback no, il problema e' nel processo scelto e non
      // nell'audio di questa macchina.
      tuttoIlSistema = true;
      modoScelto = true;
      continue;
    }
    if (voce == L"--rumoroso") {
      rumoroso = true;
      continue;
    }
    if (voce == L"--includi" && haValore) {
      pid = static_cast<DWORD>(_wtoi64(argv[++i]));
      modo = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
      modoScelto = true;
    } else if (voce == L"--escludi" && haValore) {
      pid = static_cast<DWORD>(_wtoi64(argv[++i]));
      modo = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
      modoScelto = true;
    } else if (voce == L"--finestra" && haValore) {
      // L'id che desktopCapturer consegna e' `window:<HWND>:<n>`: il numero in
      // mezzo e' l'handle. Qui arriva gia' spacchettato, che a spacchettarlo
      // dall'altra parte si legge meglio.
      finestra = reinterpret_cast<HWND>(static_cast<INT_PTR>(_wtoi64(argv[++i])));
      modo = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
      modoScelto = true;
    }
  }

  if (finestra) {
    pid = processoDellaFinestra(finestra);
    if (pid == 0) {
      diagnostica("ERRORE 0 la finestra non esiste piu'");
      return 2;
    }
  }

  if (!modoScelto || (pid == 0 && !tuttoIlSistema)) {
    diagnostica(
        "ERRORE 0 uso: audioprocesso --includi <pid> | --escludi <pid> | --finestra <hwnd>");
    return 2;
  }

  // Il PCM va su stdout com'e'. Senza questa riga Windows traduce i byte 0x0A
  // in 0x0D 0x0A, che su del testo e' cortesia e su dell'audio e' un rumore
  // che cresce.
  _setmode(_fileno(stdout), _O_BINARY);

  eventoFine = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  SetConsoleCtrlHandler(gestoreConsole, TRUE);
  CloseHandle(CreateThread(nullptr, 0, guardaIlPadre, nullptr, 0, nullptr));

  // Multithreaded e non apartment: l'attivazione richiama su un thread suo, e
  // in un apartment quel richiamo aspetterebbe una pompa di messaggi che qui
  // non c'e' nessuno a girare.
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) {
    diagnostica("ERRORE 0x%08lX CoInitializeEx", hr);
    return 3;
  }

  ComPtr<IAudioClient> cliente;

  if (tuttoIlSistema) {
    ComPtr<IMMDeviceEnumerator> elenco;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                          IID_PPV_ARGS(&elenco));
    ComPtr<IMMDevice> uscita;
    if (SUCCEEDED(hr)) hr = elenco->GetDefaultAudioEndpoint(eRender, eConsole, &uscita);
    if (SUCCEEDED(hr)) hr = uscita->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &cliente);
    if (FAILED(hr)) {
      diagnostica("ERRORE 0x%08lX uscita predefinita", hr);
      return 3;
    }
  } else {
    AUDIOCLIENT_ACTIVATION_PARAMS parametri = {};
    parametri.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    parametri.ProcessLoopbackParams.TargetProcessId = pid;
    parametri.ProcessLoopbackParams.ProcessLoopbackMode = modo;

    PROPVARIANT valore = {};
    valore.vt = VT_BLOB;
    valore.blob.cbSize = sizeof(parametri);
    valore.blob.pBlobData = reinterpret_cast<BYTE*>(&parametri);

    auto completamento = Microsoft::WRL::Make<Completamento>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> operazione;
    hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                                     __uuidof(IAudioClient), &valore, completamento.Get(),
                                     &operazione);
    if (FAILED(hr)) {
      diagnostica("ERRORE 0x%08lX ActivateAudioInterfaceAsync", hr);
      return 3;
    }

    // Cinque secondi sono un'eternita' per un'attivazione che di solito prende
    // qualche millesimo. Servono a non restare appesi per sempre se il servizio
    // audio e' in una giornata storta: meglio un errore che un processo muto.
    if (WaitForSingleObject(completamento->fatto, 5000) != WAIT_OBJECT_0) {
      diagnostica("ERRORE 0 l'attivazione non e' mai tornata");
      return 3;
    }

    HRESULT esito = E_FAIL;
    ComPtr<IUnknown> generico;
    hr = operazione->GetActivateResult(&esito, &generico);
    if (FAILED(hr) || FAILED(esito)) {
      // 0x88890004 (AUDCLNT_E_DEVICE_INVALIDATED) qui vuol dire quasi sempre
      // che il processo target e' morto fra la scelta e adesso.
      diagnostica("ERRORE 0x%08lX attivazione rifiutata", FAILED(hr) ? hr : esito);
      return 3;
    }

    hr = generico.As(&cliente);
    if (FAILED(hr)) {
      diagnostica("ERRORE 0x%08lX non e' un IAudioClient", hr);
      return 3;
    }
  }

  WAVEFORMATEX formato = {};
  formato.wFormatTag = WAVE_FORMAT_PCM;
  formato.nChannels = CANALI;
  formato.nSamplesPerSec = FREQUENZA;
  formato.wBitsPerSample = BIT;
  formato.nBlockAlign = static_cast<WORD>(formato.nChannels * formato.wBitsPerSample / 8);
  formato.nAvgBytesPerSec = formato.nSamplesPerSec * formato.nBlockAlign;
  formato.cbSize = 0;

  DWORD bandiereFlusso = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
  // Sull'uscita vera il formato non lo scegliamo noi: e' quello del mixer, e
  // per chiederne un altro bisogna chiedere anche la conversione. Il process
  // loopback invece il formato lo prende cosi' com'e', che di dispositivo non
  // ne ha uno.
  if (tuttoIlSistema) {
    bandiereFlusso |= AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  }

  hr = cliente->Initialize(AUDCLNT_SHAREMODE_SHARED, bandiereFlusso, DURATA_BUFFER, 0, &formato,
                           nullptr);
  if (FAILED(hr)) {
    diagnostica("ERRORE 0x%08lX Initialize", hr);
    return 3;
  }

  HANDLE eventoBuffer = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = cliente->SetEventHandle(eventoBuffer);
  if (FAILED(hr)) {
    diagnostica("ERRORE 0x%08lX SetEventHandle", hr);
    return 3;
  }

  ComPtr<IAudioCaptureClient> cattura;
  hr = cliente->GetService(__uuidof(IAudioCaptureClient), &cattura);
  if (FAILED(hr)) {
    diagnostica("ERRORE 0x%08lX GetService", hr);
    return 3;
  }

  hr = cliente->Start();
  if (FAILED(hr)) {
    diagnostica("ERRORE 0x%08lX Start", hr);
    return 3;
  }

  diagnostica("PRONTO pid=%lu modo=%s %d Hz %d canali %d bit", pid,
              tuttoIlSistema ? "sistema"
              : modo == PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE ? "includi"
                                                                          : "escludi",
              FREQUENZA, CANALI, BIT);

  const HANDLE attese[2] = {eventoBuffer, eventoFine};
  std::vector<BYTE> silenzio;
  unsigned long risvegli = 0, scaduti = 0, pacchetti = 0, muti = 0;
  unsigned long long byteScritti = 0;
  DWORD ultimoConto = GetTickCount();

  while (vivo) {
    // Un secondo di pazienza e poi si rigira: senza un limite, un target che
    // non suona niente lascerebbe questo thread fermo per sempre.
    const DWORD sveglia = WaitForMultipleObjects(2, attese, FALSE, 1000);
    if (sveglia == WAIT_OBJECT_0 + 1) break;
    if (sveglia == WAIT_TIMEOUT) scaduti++; else risvegli++;

    UINT32 quanti = 0;
    while (SUCCEEDED(cattura->GetNextPacketSize(&quanti)) && quanti > 0) {
      pacchetti++;
      BYTE* campioni = nullptr;
      UINT32 fotogrammi = 0;
      DWORD bandiere = 0;
      hr = cattura->GetBuffer(&campioni, &fotogrammi, &bandiere, nullptr, nullptr);
      if (FAILED(hr)) break;

      const size_t byte = static_cast<size_t>(fotogrammi) * formato.nBlockAlign;

      // Il silenzio arriva come una bandiera e un buffer che non si deve
      // leggere. Va scritto lo stesso, e per intero: dall'altra parte c'e' una
      // traccia che deve continuare a scorrere, e un buco nel flusso e' un
      // buco nel tempo - la condivisione andrebbe avanti sfasata di quanto e'
      // durato il silenzio.
      if (bandiere & AUDCLNT_BUFFERFLAGS_SILENT) {
        muti++;
        if (silenzio.size() < byte) silenzio.assign(byte, 0);
        if (byte && fwrite(silenzio.data(), 1, byte, stdout) != byte) chiudiTutto();
      } else if (byte && fwrite(campioni, 1, byte, stdout) != byte) {
        // stdout chiuso: il padre se n'e' andato mentre scrivevamo.
        chiudiTutto();
      }
      byteScritti += byte;

      cattura->ReleaseBuffer(fotogrammi);
      if (!vivo) break;
    }
    fflush(stdout);

    if (rumoroso && GetTickCount() - ultimoConto >= 1000) {
      ultimoConto = GetTickCount();
      diagnostica("CONTO risvegli=%lu scaduti=%lu pacchetti=%lu muti=%lu byte=%llu", risvegli,
                  scaduti, pacchetti, muti, byteScritti);
    }
  }

  cliente->Stop();
  CloseHandle(eventoBuffer);
  if (eventoFine) CloseHandle(eventoFine);
  CoUninitialize();
  return 0;
}
