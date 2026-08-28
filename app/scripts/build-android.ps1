$ErrorActionPreference = 'Stop'

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk -and $env:LOCALAPPDATA) {
  $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}

if (-not $sdk -or -not (Test-Path -LiteralPath $sdk)) {
  throw 'SDK Android non trovato. Installalo da Android Studio oppure imposta ANDROID_HOME.'
}

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

Push-Location (Join-Path $PSScriptRoot '..\android')
try {
  & .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host 'APK: android\app\build\outputs\apk\debug\app-debug.apk'
