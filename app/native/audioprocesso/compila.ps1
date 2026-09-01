# Compila l'helper che cattura l'audio di un processo solo.
#
# Serve MSVC di Visual Studio 2022 e il Windows SDK 10.0.20348 o piu' nuovo:
# `audioclientactivationparams.h` prima non c'era. Su questa macchina ci sono
# due Visual Studio installati e questo script prende il 2022 apposta, che
# l'altro compila ma poi il linker cerca librerie che non stanno dove crede.
#
# L'eseguibile finisce in `app/resources/`, che e' la cartella che
# electron-builder copia dentro al pacchetto e che in sviluppo il processo
# principale guarda per prima. Non e' generato da npm: si compila a mano quando
# cambia il .cpp, ed e' versionato con il resto perche' chi costruisce il
# pacchetto non deve avere Visual Studio per farlo.

$ErrorActionPreference = 'Stop'

$qui = Split-Path -Parent $MyInvocation.MyCommand.Path
$radice = Resolve-Path (Join-Path $qui '..\..')
$uscita = Join-Path $radice 'resources'
if (-not (Test-Path $uscita)) { New-Item -ItemType Directory -Path $uscita | Out-Null }

$vs = @(
  'C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat',
  'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $vs) { throw "Visual Studio 2022 non trovato: serve vcvars64.bat" }

$sorgente = Join-Path $qui 'audioprocesso.cpp'
$exe = Join-Path $uscita 'audioprocesso.exe'
$temporanei = Join-Path $env:TEMP 'pulsetalk-audioprocesso'
if (-not (Test-Path $temporanei)) { New-Item -ItemType Directory -Path $temporanei | Out-Null }

# /O2 perche' gira mentre si condivide, /MT perche' non deve dipendere dal
# runtime ridistribuibile: chi installa PulseTalk non installa anche quello.
#
# Si compila da dentro la cartella dei temporanei invece di passare `/Fo`: quel
# percorso finisce per forza con una barra rovescia, e una barra rovescia
# davanti alle virgolette e' un carattere di fuga per cmd - la riga di comando
# si spezzava li' e cl diceva di non aver ricevuto nessun sorgente.
$comando = "call `"$vs`" >nul && cl /nologo /std:c++17 /EHsc /O2 /MT /W3 /DUNICODE /D_UNICODE " +
           "/Fe`"$exe`" `"$sorgente`" ole32.lib mmdevapi.lib user32.lib advapi32.lib"

Push-Location $temporanei
try {
  cmd /c $comando
  if ($LASTEXITCODE -ne 0) { throw "compilazione fallita ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

Write-Host "fatto: $exe"
