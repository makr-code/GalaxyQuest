<#
.SYNOPSIS
  Vollstaendiges TRELLIS2 Dev-Setup fuer GalaxyQuest:
  Repo-Clone, Conda-Env (via WSL2 oder nativ), HuggingFace-Modell-Download.

.PARAMETER RepoRoot
  Relativer Pfad zum TRELLIS-Repo. Default: tools/trellis2

.PARAMETER Models
  Kommagetrennte Liste der HF-Models.
  Erlaubt: image-large, text-base, text-large, text-xlarge
  Default: image-large

.PARAMETER ModelDir
  Lokales Verzeichnis fuer HuggingFace-Cache (HF_HOME).
  Default: tools/trellis2/models

.PARAMETER CondaEnv
  Name der Conda-Umgebung. Default: trellis

.PARAMETER WslDistro
  WSL-Distro-Name fuer das Env-Setup (leer = default-Distro).

.PARAMETER SkipRepo
  Repo-Clone/Check ueberspringen.

.PARAMETER SkipEnv
  Conda-Env-Setup ueberspringen.

.PARAMETER SkipModels
  HuggingFace-Download ueberspringen.

.PARAMETER UseWsl
  WSL2 explizit fuer Env-Setup verwenden. Empfohlen auf Windows.

.PARAMETER UseSystemPython
  Systemweites Python fuer den Model-Download nutzen
  (statt Conda-Env). Benoetigt huggingface_hub im aktiven Env.

.PARAMETER HfToken
  HuggingFace-API-Token (optional; fuer private/gated Models).
#>
param(
    [string]$RepoRoot     = "tools/trellis2",
    [string]$Models       = "image-large",
    [string]$ModelDir     = "tools/trellis2/models",
    [string]$CondaEnv     = "trellis",
    [string]$WslDistro    = "",
    [switch]$SkipRepo,
    [switch]$SkipEnv,
    [switch]$SkipModels,
    [switch]$UseWsl,
    [switch]$UseSystemPython,
    [string]$HfToken      = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $workspace

function Write-Step([string]$msg) { Write-Host "`n[TRELLIS2] === $msg ===" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[TRELLIS2] OK  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[TRELLIS2] ⚠   $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "[TRELLIS2] ✗   $msg" -ForegroundColor Red }

# ──────────────────────────────────────────────────────────────
# SCHRITT 1: Repo
# ──────────────────────────────────────────────────────────────
if (-not $SkipRepo) {
    Write-Step "Schritt 1/3: Repository"
    $linkScript = Join-Path $workspace "scripts/trellis2_link.ps1"
    if (-not (Test-Path $linkScript)) { throw "trellis2_link.ps1 nicht gefunden." }
    $repoPath = Join-Path $workspace $RepoRoot
    if (Test-Path $repoPath) {
        Write-Ok "Repo bereits vorhanden unter $repoPath"
    }
    else {
        Write-Host "[TRELLIS2] Clone wird gestartet..."
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $linkScript
    }
    $repoPath = Join-Path $workspace $RepoRoot
    if (-not (Test-Path $repoPath)) { throw "Repository nicht gefunden nach Clone: $repoPath" }
    Write-Ok "Repo verifiziert: $repoPath"
}
else {
    Write-Warn "Schritt 1/3 uebersprungen (SkipRepo)."
}

# ──────────────────────────────────────────────────────────────
# SCHRITT 2: Conda-Env
# ──────────────────────────────────────────────────────────────
if (-not $SkipEnv) {
    Write-Step "Schritt 2/3: Conda-Umgebung '$CondaEnv'"

    $repoPathFull = Join-Path $workspace $RepoRoot
    $setupSh = Join-Path $repoPathFull "setup.sh"
    if (-not (Test-Path $setupSh)) {
        throw "setup.sh nicht im Repo gefunden: $setupSh`nBitte zuerst Schritt 1 (Repo-Clone) ausfuehren."
    }

    # Ermittle WSL-Verfuegbarkeit
    $wslAvailable = $false
    try {
        $null = wsl --status 2>&1
        $wslAvailable = $true
    }
    catch { }

    if ($UseWsl -or $wslAvailable) {
        Write-Ok "WSL2 gefunden – setup.sh wird in WSL ausgefuehrt (Linux-Vollinstallation)."
        Write-Warn "Hinweis: Das kann 10-30 Minuten dauern (Deps + CUDA-Extensions)."

        # Windows-Pfad -> WSL-Pfad konvertieren
        $repoWslPath = "/mnt/" + ($repoPathFull -replace '\\', '/' -replace '^([A-Za-z]):', { $args[1].ToLower() }).TrimStart('/')

        $wslCmd = @"
set -e
cd '$repoWslPath'
chmod +x setup.sh
. ./setup.sh --new-env --basic --xformers --diffoctreerast --spconv --mipgaussian --nvdiffrast
"@
        $wslArgs = if ($WslDistro) { @("-d", $WslDistro, "--", "bash", "-c", $wslCmd) } else { @("--", "bash", "-c", $wslCmd) }

        Write-Host "[TRELLIS2] WSL-Befehl wird ausgefuehrt..."
        & wsl @wslArgs
        Write-Ok "Conda-Env '$CondaEnv' in WSL erstellt."
    }
    else {
        Write-Warn "WSL2 nicht verfuegbar. Fallback: minimale native Windows-Conda-Installation."
        Write-Warn "CUDA-Erweiterungen (spconv, flash-attn, diffoctreerast) werden uebersprungen."
        Write-Warn "Empfehlung: WSL2 installieren und scripts/trellis2_setup.ps1 -UseWsl erneut ausfuehren."

        if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
            throw "conda nicht gefunden. Bitte Miniconda/Anaconda installieren."
        }

        # Pruefen ob Env bereits existiert
        $envList = conda env list 2>&1
        $envExists = $envList | Where-Object { $_ -match "\btrellis\b" }

        if ($envExists) {
            Write-Ok "Conda-Env '$CondaEnv' existiert bereits."
        }
        else {
            Write-Host "[TRELLIS2] Erstelle Conda-Env '$CondaEnv' (Python 3.10)..."
            conda create -n $CondaEnv python=3.10 -y

            Write-Host "[TRELLIS2] Installiere PyTorch 2.4 (CUDA 11.8)..."
            conda run -n $CondaEnv conda install pytorch==2.4.0 torchvision==0.19.0 pytorch-cuda=11.8 -c pytorch -c nvidia -y

            Write-Host "[TRELLIS2] Installiere Basis-Abhaengigkeiten..."
            conda run -n $CondaEnv pip install `
                pillow imageio imageio-ffmpeg tqdm easydict `
                opencv-python-headless scipy ninja rembg onnxruntime `
                trimesh open3d xatlas pyvista pymeshfix igraph `
                transformers huggingface_hub `
                gradio==4.44.1 gradio_litmodel3d==0.0.1

            Write-Host "[TRELLIS2] Installiere utils3d..."
            conda run -n $CondaEnv pip install "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8"

            Write-Host "[TRELLIS2] Installiere spconv (CUDA 11.8)..."
            conda run -n $CondaEnv pip install spconv-cu118

            Write-Ok "Conda-Env '$CondaEnv' (Windows-Minimal) erstellt."
            Write-Warn "Fuer vollstaendige TRELLIS-Funktionalitaet wird WSL2 empfohlen."
        }
    }
}
else {
    Write-Warn "Schritt 2/3 uebersprungen (SkipEnv)."
}

# ──────────────────────────────────────────────────────────────
# SCHRITT 3: HuggingFace Modelle
# ──────────────────────────────────────────────────────────────
if (-not $SkipModels) {
    Write-Step "Schritt 3/3: HuggingFace Modelle herunterladen"

    $modelDirFull = Join-Path $workspace $ModelDir
    if (-not (Test-Path $modelDirFull)) {
        New-Item -ItemType Directory -Path $modelDirFull | Out-Null
    }

    $downloadScript = Join-Path $workspace "scripts/trellis2_download_models.py"
    if (-not (Test-Path $downloadScript)) {
        throw "trellis2_download_models.py nicht gefunden: $downloadScript"
    }

    $dlArgs = @(
        $downloadScript,
        "--models", $Models,
        "--cache-dir", $modelDirFull
    )
    if ($HfToken) { $dlArgs += @("--token", $HfToken) }

    $env:HF_HOME = $modelDirFull

    if ($UseSystemPython) {
        & python @dlArgs
    }
    else {
        & conda run -n $CondaEnv python @dlArgs
    }

    Write-Ok "Models heruntergeladen nach: $modelDirFull"
}
else {
    Write-Warn "Schritt 3/3 uebersprungen (SkipModels)."
}

Write-Host ""
Write-Ok "Setup abgeschlossen."
Write-Host "[TRELLIS2] Naechste Schritte:"
Write-Host "  WebApp starten:  pwsh -File scripts/trellis2_webapp.ps1 -Mode image"
Write-Host "  Generieren:     pwsh -File scripts/trellis2_generate.ps1 -Mode text -Prompt '...'"
