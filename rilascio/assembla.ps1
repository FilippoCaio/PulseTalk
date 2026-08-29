<#
.SYNOPSIS
  Tiene allineata rilascio/server/ alle sue sorgenti, e prepara i due pacchetti.

.DESCRIPTION
  `rilascio/server/` non e' scritta a mano: e' fatta di copie identiche di file
  che vivono altrove nel repository — il compose sta in `deploy/`, il file per
  TrueNAS in `truenas/`. Le copie servono perche' chi installa il server deve
  poter scaricare UNA cartella e trovarci dentro tutto, senza andare a pescare
  cinque file da cinque posti diversi.

  Le copie pero' invecchiano in silenzio, ed e' il motivo di questo script.
  Con `-Verifica` non scrive niente e fallisce se una copia si e' scostata
  dall'originale: e' il controllo che gira nel workflow di rilascio, cosi' una
  copia vecchia ferma la pubblicazione invece di finirci dentro.

  Le copie sono IDENTICHE, byte per byte. Nessuna sostituzione, nessun percorso
  riscritto: una trasformazione, per quanto piccola, e' una seconda cosa da
  tenere allineata e qui non ce n'e' bisogno. Per questo `docker-compose.nas.yml`
  mantiene il suo nome anche dove e' l'unico compose della cartella — se lo
  cambiassi, `installa.sh`, che lo cerca per nome, smetterebbe di trovarlo.

.EXAMPLE
  .\rilascio\assembla.ps1
  Aggiorna le copie in rilascio/server/.

.EXAMPLE
  .\rilascio\assembla.ps1 -Verifica
  Non tocca niente. Esce con 1 se qualcosa e' fuori sincrono.

.EXAMPLE
  .\rilascio\assembla.ps1 -Zip
  Aggiorna le copie e scrive rilascio/pacchetti/pulsetalk-server-X.Y.Z.zip
#>
param(
    # Controlla e basta: non scrive niente, esce 1 se qualcosa non torna.
    [switch]$Verifica,

    # Scrive anche l'archivio del lato server, pronto da allegare a una release.
    [switch]$Zip,

    # Il numero da mettere nel nome dell'archivio. Senza, quello di server/package.json.
    [string]$Versione = ''
)

$ErrorActionPreference = 'Stop'
$radice = Split-Path -Parent $PSScriptRoot
$destinazione = Join-Path $PSScriptRoot 'server'

# sorgente (relativa alla radice del repo)  ->  nome nella cartella del rilascio
$copie = [ordered]@{
    'deploy/docker-compose.nas.yml' = 'docker-compose.nas.yml'
    'deploy/livekit.yaml'           = 'livekit.yaml'
    'deploy/installa.sh'            = 'installa.sh'
    'deploy/.env.example'           = '.env.example'
    'deploy/proxy.md'               = 'proxy.md'
    'truenas/pulse-talk.yaml'       = 'truenas.yaml'
}

function Impronta($percorso) {
    if (-not (Test-Path -LiteralPath $percorso)) { return $null }
    return (Get-FileHash -LiteralPath $percorso -Algorithm SHA256).Hash
}

Write-Host ""
if ($Verifica) {
    Write-Host "  CONTROLLO DELLE COPIE" -ForegroundColor White
} else {
    Write-Host "  ASSEMBLO IL LATO SERVER" -ForegroundColor White
}

if (-not (Test-Path -LiteralPath $destinazione)) {
    if ($Verifica) { throw "Non esiste $destinazione." }
    New-Item -ItemType Directory -Path $destinazione | Out-Null
}

$fuoriSincrono = @()

foreach ($voce in $copie.GetEnumerator()) {
    $da = Join-Path $radice $voce.Key
    $a = Join-Path $destinazione $voce.Value

    if (-not (Test-Path -LiteralPath $da)) {
        throw "Manca la sorgente $($voce.Key). O e' stata spostata, o questa riga va tolta da assembla.ps1."
    }

    $prima = Impronta $a
    $dopo = Impronta $da

    if ($prima -eq $dopo) {
        Write-Host "    = $($voce.Value)" -ForegroundColor DarkGray
        continue
    }

    if ($Verifica) {
        $fuoriSincrono += "$($voce.Value)  (da $($voce.Key))"
        Write-Host "    ! $($voce.Value)" -ForegroundColor Red
        continue
    }

    Copy-Item -LiteralPath $da -Destination $a -Force
    if ($null -eq $prima) {
        Write-Host "    + $($voce.Value)" -ForegroundColor Green
    } else {
        Write-Host "    ~ $($voce.Value)" -ForegroundColor Yellow
    }
}

# Un file rimasto li' da una versione precedente dell'elenco e' il caso che
# nessuno nota: la cartella contiene qualcosa che nessuno aggiorna piu'.
$attesi = @($copie.Values) + @('LEGGIMI.md')
Get-ChildItem -LiteralPath $destinazione -File -Force | ForEach-Object {
    if ($attesi -notcontains $_.Name) {
        if ($Verifica) {
            $fuoriSincrono += "$($_.Name)  (di troppo: nessuna sorgente lo produce)"
            Write-Host "    ! $($_.Name) - di troppo" -ForegroundColor Red
        } else {
            Write-Host "    ? $($_.Name) - di troppo, lo lascio ma nessuno lo aggiorna" -ForegroundColor Yellow
        }
    }
}

if ($Verifica) {
    Write-Host ""
    if ($fuoriSincrono.Count -gt 0) {
        Write-Host "  Fuori sincrono:" -ForegroundColor Red
        $fuoriSincrono | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Host ""
        Write-Host "  Rimetti a posto con:  .\rilascio\assembla.ps1" -ForegroundColor White
        Write-Host ""
        exit 1
    }
    Write-Host "  Tutto allineato." -ForegroundColor Green
    Write-Host ""
    exit 0
}

if (-not $Zip) {
    Write-Host ""
    Write-Host "  Fatto." -ForegroundColor Green
    Write-Host ""
    # `exit 0` e non `return`: `$LASTEXITCODE` non lo tocca nessun cmdlet, e
    # senza questa riga resterebbe quello di un comando di prima. Chi chiama
    # questo script — `rilascia.ps1`, e la shell `pwsh` del workflow, che in
    # coda fa `exit $LASTEXITCODE` — leggerebbe un guasto che non c'e' stato.
    exit 0
}

# -- L'archivio --------------------------------------------------------------

if (-not $Versione) {
    $Versione = (Get-Content (Join-Path $radice 'server/package.json') -Raw | ConvertFrom-Json).version
}

$pacchetti = Join-Path $PSScriptRoot 'pacchetti'
if (-not (Test-Path -LiteralPath $pacchetti)) { New-Item -ItemType Directory -Path $pacchetti | Out-Null }

$nome = "pulsetalk-server-$Versione"
$archivio = Join-Path $pacchetti "$nome.zip"
if (Test-Path -LiteralPath $archivio) { Remove-Item -LiteralPath $archivio -Force }

# Le voci si scrivono a mano, e non con `Compress-Archive`, per una ragione che
# si vede solo dall'altra parte.
#
# Windows PowerShell 5.1 scrive i nomi delle voci con la BARRA ROVESCIA. Lo zip
# vuole quella dritta, e chi scompatta con `unzip` su Linux — cioe' esattamente
# chi scarica questo pacchetto — non si ritrova una cartella: si ritrova sei
# file chiamati `pulsetalk-server-1.1.0\docker-compose.nas.yml`, barra rovescia
# compresa nel nome. PowerShell 7 lo fa giusto, ma qui gira anche il 5.1.
#
# La cartella dentro all'archivio si chiama come l'archivio e non `server`:
# dopo la seconda versione scaricata, due cartelle chiamate `server` nella
# stessa Download non si distinguono piu'.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$scrittura = [System.IO.Compression.ZipFile]::Open($archivio, 'Create')
try {
    # -Force perche' `.env.example` puo' portarsi dietro l'attributo di
    # nascosto, e senza resterebbe fuori dall'archivio in silenzio.
    Get-ChildItem -LiteralPath $destinazione -File -Force | Sort-Object Name | ForEach-Object {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $scrittura, $_.FullName, "$nome/$($_.Name)", 'Optimal') | Out-Null
    }
} finally {
    $scrittura.Dispose()
}

Write-Host ""
Write-Host "  $archivio" -ForegroundColor Green
Write-Host "  $([math]::Round((Get-Item $archivio).Length / 1KB)) KB" -ForegroundColor DarkGray
Write-Host ""
exit 0
