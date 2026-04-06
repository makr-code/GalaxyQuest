param(
    [ValidateSet("image", "text")]
    [string]$Mode = "image",
    [string]$RepoRoot = "tools/trellis2",
    [string]$ModelDir = "tools/trellis2/models",
    [int]$Port = 7860,
    [string]$Host = "127.0.0.1",
    [string]$CondaEnv = "trellis",
    [switch]$UseSystemPython
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
$repoPath = Join-Path $workspace $RepoRoot

if (-not (Test-Path $repoPath)) {
    throw "TRELLIS2 Repo nicht gefunden unter $repoPath. Bitte scripts/trellis2_link.ps1 ausfuehren."
}

Set-Location $repoPath

$scriptName = if ($Mode -eq "text") { "app_text.py" } else { "app.py" }
if (-not (Test-Path $scriptName)) {
    throw "TRELLIS App-Skript nicht gefunden: $scriptName"
}

$env:GRADIO_SERVER_NAME = $Host
$env:GRADIO_SERVER_PORT = "$Port"

# Lokalen Model-Cache als HF_HOME setzen
$modelDirFull = Join-Path $workspace $ModelDir
if (Test-Path $modelDirFull) {
    $env:HF_HOME = $modelDirFull
    Write-Host "[TRELLIS2] HF_HOME: $modelDirFull"
}

Write-Host "[TRELLIS2] Starte WebApp: $scriptName"
Write-Host "[TRELLIS2] URL: http://$Host`:$Port"

if ($UseSystemPython) {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "python wurde nicht gefunden."
    }
    & python $scriptName
}
else {
    if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
        throw "conda wurde nicht gefunden. Verwende -UseSystemPython oder installiere Conda."
    }
    & conda run -n $CondaEnv python $scriptName
}
