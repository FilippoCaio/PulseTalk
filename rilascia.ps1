<#
.SYNOPSIS
  Pubblica una nuova versione di PulseTalk. Un comando, dall'inizio alla fine.

.DESCRIPTION
  Fa nell'ordine giusto le cose che sbagliate nell'ordine sbagliato non danno
  errore ma non aggiornano nessuno:

    1. controlla di essere in un repo con un remoto, e su un ramo
    2. calcola il numero nuovo e verifica che quel tag non esista gia'
    3. COMPILA IN LOCALE - se non compila qui, si ferma prima di spingere
    4. alza la versione in package.json
    5. mette insieme tutto, committa, tagga
    6. spinge codice e tag, e apre la pagina delle Action

  Il passo 3 e' quello che sembra superfluo e non lo e': senza, un errore di
  compilazione lo scopri tre minuti dopo da un'Action rossa, con il tag gia'
  spinto e da togliere a mano da due posti.

.EXAMPLE
  .\rilascia.ps1
  Alza l'ultima cifra: 0.3.0 -> 0.3.1

.EXAMPLE
  .\rilascia.ps1 -Tipo minor -Messaggio "Menu col tasto destro e foto profilo"

.EXAMPLE
  .\rilascia.ps1 -Prova
  Fa tutti i controlli e la compilazione, non tocca git.
#>
param(
    # Quale cifra alzare, se non passi -Versione.
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Tipo = 'patch',

    # Il numero esatto, se lo vuoi decidere tu. Ha la precedenza su -Tipo.
    [string]$Versione = '',

    # Il messaggio del commit. Senza, ci va il numero di versione e basta.
    [string]$Messaggio = '',

    # Controlla e compila, ma non committa, non tagga e non spinge.
    [switch]$Prova
)

$ErrorActionPreference = 'Stop'
$radice = $PSScriptRoot
$app = Join-Path $radice 'app'

function Passo($testo) { Write-Host "`n  $testo" -ForegroundColor Cyan }
function Bene($testo)  { Write-Host "  $testo" -ForegroundColor Green }
function Nota($testo)  { Write-Host "  $testo" -ForegroundColor DarkGray }

# git scrive sul canale degli errori anche quando va tutto bene (i progressi
# della push, per esempio). Senza questo, PowerShell li tratterebbe come
# guasti e si fermerebbe a meta' lavoro.
# Il percorso dell'eseguibile, non il nome: PowerShell non distingue
# maiuscole e minuscole, quindi dentro una funzione chiamata Git la parola
# `git` richiamerebbe la funzione stessa all'infinito.
$gitExe = (Get-Command git -CommandType Application -ErrorAction SilentlyContinue |
           Select-Object -First 1).Source
if (-not $gitExe) { throw "git non e' nel PATH." }

function Git {
    $vecchio = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $risultato = & $gitExe @args 2>&1
    $codice = $LASTEXITCODE
    $ErrorActionPreference = $vecchio
    if ($codice -ne 0) {
        $risultato | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
        throw "git $($args -join ' ') e' fallito (codice $codice)."
    }
    return $risultato
}

Write-Host ""
Write-Host "  RILASCIO DI PULSETALK" -ForegroundColor White

# -- 1. Il repo -------------------------------------------------------------

Passo "Controllo il repository"
Push-Location $radice
try {
    Git rev-parse --git-dir | Out-Null

    $ramo = (Git rev-parse --abbrev-ref HEAD).Trim()
    if ($ramo -eq 'HEAD') { throw "Sei in stato 'detached HEAD': fai prima 'git switch main'." }

    $remoto = (Git remote) | Select-Object -First 1
    if (-not $remoto) { throw "Questo repo non ha un remoto: non c'e' dove spingere." }

    Nota "ramo $ramo, remoto $remoto"

    # -- 2. Il numero -------------------------------------------------------

    Passo "Calcolo la versione"
    $pkgFile = Join-Path $app 'package.json'
    $adesso = (Get-Content $pkgFile -Raw | ConvertFrom-Json).version

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
    Nota "$adesso  ->  $nuova"

    $tag = "v$nuova"
    # Qui non passo dal wrapper apposta: rev-parse --verify risponde 1 quando
    # il tag non esiste, che e' esattamente il caso in cui vogliamo proseguire.
    & $gitExe rev-parse -q --verify "refs/tags/$tag" 2>&1 | Out-Null
    $esiste = ($LASTEXITCODE -eq 0)
    $global:LASTEXITCODE = 0
    if ($esiste) {
        throw "Il tag $tag esiste gia'. Scegli un altro numero, o cancellalo con 'git tag -d $tag'."
    }

    # -- 3. La compilazione -------------------------------------------------

    Passo "Compilo (e' il controllo che evita un'Action rossa)"
    Push-Location $app
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "La compilazione e' fallita: niente da rilasciare finche' non passa." }
    } finally { Pop-Location }
    Bene "compila"

    if ($Prova) {
        Write-Host ""
        Write-Host "  -Prova: mi fermo qui. Non ho toccato git." -ForegroundColor Yellow
        Write-Host "  Senza -Prova avrei taggato $tag e spinto." -ForegroundColor Yellow
        Write-Host ""
        return
    }

    # -- 4/5. Versione, commit, tag ----------------------------------------

    Passo "Alzo la versione e committo"
    Push-Location $app
    try {
        & npm version $nuova --no-git-tag-version | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "npm version non e' riuscito ad alzare il numero." }
    } finally { Pop-Location }

    # -A e non -a: i file nuovi (un componente aggiunto, un workflow) non sono
    # ancora tracciati, e con -a resterebbero fuori dal commit senza dirlo.
    Git add -A | Out-Null

    $testo = if ($Messaggio) { "$nuova - $Messaggio" } else { $nuova }
    Git commit -m $testo | Out-Null
    Bene "commit: $testo"

    Git tag $tag | Out-Null
    Bene "tag: $tag"

    # -- 6. La spinta -------------------------------------------------------

    Passo "Spingo codice e tag"
    Git push --follow-tags | Out-Null
    Bene "spinto su $remoto"

    $url = (Git remote get-url $remoto).Trim() -replace '\.git$', '' -replace '^git@github\.com:', 'https://github.com/'

    Write-Host ""
    Write-Host "  Fatto. Adesso tocca a GitHub:" -ForegroundColor Green
    Write-Host "    $url/actions" -ForegroundColor White
    Write-Host ""
    Write-Host "  Quando l'Action diventa verde, la release $tag e' pubblica e i" -ForegroundColor DarkGray
    Write-Host "  client la trovano alla prima riapertura." -ForegroundColor DarkGray
    Write-Host ""

    Start-Process "$url/actions"
}
finally { Pop-Location }
