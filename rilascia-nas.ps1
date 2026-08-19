<#
.SYNOPSIS
  Compila PulseTalk e carica l'aggiornamento sul proprio server.

.DESCRIPTION
  Niente GitHub: il client interroga il server di PulseTalk, che e' gia' quello
  a cui e' collegato. Questo script fa i tre passi che servono.

    1. legge l'indirizzo da app/server.local
    2. compila passando quell'indirizzo a electron-builder, che lo scrive
       dentro all'app e genera latest.yml accanto all'installer
    3. copia installer, mappa a blocchi e latest.yml nella cartella degli
       aggiornamenti sul NAS

  latest.yml e' il file che decide tutto: e' l'elenco che il client legge per
  sapere se e' vecchio. Se manca, non si aggiorna nessuno anche con l'installer
  al suo posto.

.EXAMPLE
  .\rilascia-nas.ps1 -Tipo patch
#>
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Tipo = 'patch',
    [string]$Versione = '',
    # Dove copiare. L'utente e l'host del NAS, e la cartella servita da /aggiornamenti.
    [string]$Nas = 'root@192.168.1.10',
    [string]$Cartella = '/mnt/Ratchet/pulsetalk/dati/aggiornamenti',
    [switch]$Prova
)

$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot 'app'

function Passo($t) { Write-Host "`n  $t" -ForegroundColor Cyan }
function Nota($t)  { Write-Host "  $t" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  RILASCIO DI PULSETALK SUL TUO SERVER" -ForegroundColor White

# -- 1. L'indirizzo ---------------------------------------------------------

Passo "Leggo l'indirizzo"
$fileServer = Join-Path $app 'server.local'
if (-not (Test-Path $fileServer)) {
    throw "Manca $fileServer - scrivici dentro l'indirizzo del tuo server, una riga sola."
}
$server = (Get-Content $fileServer | Where-Object { $_.Trim() -and -not $_.StartsWith('#') } |
           Select-Object -First 1).Trim().TrimEnd('/')
$feed = "$server/aggiornamenti"
Nota "server: $server"
Nota "feed:   $feed"

# -- 2. La versione ---------------------------------------------------------

Passo "Alzo la versione"
$pkg = Join-Path $app 'package.json'
$adesso = (Get-Content $pkg -Raw | ConvertFrom-Json).version
if ($Versione) {
    if ($Versione -notmatch '^\d+\.\d+\.\d+$') { throw "'$Versione' non e' una versione X.Y.Z." }
    $nuova = $Versione
} else {
    $p = $adesso.Split('.') | ForEach-Object { [int]$_ }
    switch ($Tipo) {
        'major' { $nuova = "$($p[0] + 1).0.0" }
        'minor' { $nuova = "$($p[0]).$($p[1] + 1).0" }
        default { $nuova = "$($p[0]).$($p[1]).$($p[2] + 1)" }
    }
}
Nota "$adesso -> $nuova"

if ($Prova) {
    Write-Host ""
    Write-Host "  -Prova: mi fermo qui. Avrei compilato la $nuova e caricata su $feed." -ForegroundColor Yellow
    Write-Host ""
    return
}

Push-Location $app
try {
    & npm version $nuova --no-git-tag-version | Out-Null

    Passo "Compilo"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "La compilazione e' fallita." }
    & npm run icon | Out-Null

    # L'indirizzo entra qui e finisce dentro app-update.yml, che e' cio' che
    # l'applicazione installata legge per sapere dove guardare.
    & npx electron-builder --win "-c.publish.provider=generic" "-c.publish.url=$feed" --publish never
    if ($LASTEXITCODE -ne 0) { throw "electron-builder e' fallito." }
} finally { Pop-Location }

# -- 3. Il caricamento ------------------------------------------------------

Passo "Carico sul NAS"
$rilascio = Join-Path $app 'release'
$file = @(
    (Join-Path $rilascio "PulseTalk Setup $nuova.exe"),
    (Join-Path $rilascio "PulseTalk Setup $nuova.exe.blockmap"),
    (Join-Path $rilascio 'latest.yml')
)
foreach ($f in $file) { if (-not (Test-Path $f)) { throw "Manca $f" } }

& ssh $Nas "mkdir -p '$Cartella'"
if ($LASTEXITCODE -ne 0) { throw "Non riesco a creare $Cartella sul NAS." }

foreach ($f in $file) {
    Nota (Split-Path $f -Leaf)
    & scp -q $f "${Nas}:$Cartella/"
    if ($LASTEXITCODE -ne 0) { throw "Copia fallita: $f" }
}

# Il portabile non si aggiorna da solo e non va nel feed: se finisse li',
# l'unica cosa che otterrebbe e' occupare 95 MB sul NAS.

Passo "Controllo che il server lo veda"
try {
    $r = Invoke-WebRequest -Uri "$feed/latest.yml" -UseBasicParsing -TimeoutSec 15
    if ($r.Content -match 'version:\s*(\S+)') {
        Write-Host "  Il server risponde: versione $($Matches[1])" -ForegroundColor Green
    } else {
        Write-Host "  Risponde ma non capisco cosa: controlla $feed/latest.yml" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Il server non serve ancora quella cartella." -ForegroundColor Yellow
    Write-Host "  La rotta /aggiornamenti nasce solo se la cartella esiste all'avvio:" -ForegroundColor DarkGray
    Write-Host "    ssh $Nas 'docker restart pulse-talk'" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Fatto: PulseTalk $nuova su $feed" -ForegroundColor Green
Write-Host ""
