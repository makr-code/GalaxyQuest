param(
    [string]$RepoUrl = "https://github.com/microsoft/TRELLIS.git",
    [string]$TargetPath = "tools/trellis2",
    [string]$Branch = "main",
    [switch]$UseSubmodule,
    [switch]$Update
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $workspace

$resolvedTarget = Join-Path $workspace $TargetPath
$gitModulesPath = Join-Path $workspace ".gitmodules"

Write-Host "[TRELLIS2] Workspace: $workspace"
Write-Host "[TRELLIS2] Target: $resolvedTarget"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git wurde nicht gefunden. Bitte Git installieren und erneut versuchen."
}

if (Test-Path $resolvedTarget) {
    Write-Host "[TRELLIS2] Ziel existiert bereits."
    if ($Update) {
        Write-Host "[TRELLIS2] Update angefordert."
        if (Test-Path (Join-Path $resolvedTarget ".git")) {
            git -C $resolvedTarget fetch origin
            git -C $resolvedTarget checkout $Branch
            git -C $resolvedTarget pull --ff-only origin $Branch
            Write-Host "[TRELLIS2] Repository aktualisiert."
        }
        else {
            Write-Warning "[TRELLIS2] Kein Git-Repo unter $resolvedTarget gefunden. Update wird uebersprungen."
        }
    }
    else {
        Write-Host "[TRELLIS2] Kein Update angefordert."
    }
    exit 0
}

$targetParent = Split-Path -Parent $resolvedTarget
if (-not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent | Out-Null
}

if ($UseSubmodule) {
    Write-Host "[TRELLIS2] Fuege als Git-Submodule hinzu..."
    git submodule add -b $Branch $RepoUrl $TargetPath
    git submodule update --init --recursive $TargetPath
    Write-Host "[TRELLIS2] Submodule angelegt."
}
else {
    Write-Host "[TRELLIS2] Fuehre normalen Clone aus..."
    git clone --recurse-submodules --branch $Branch $RepoUrl $resolvedTarget
    Write-Host "[TRELLIS2] Clone abgeschlossen."
}

if ((Test-Path $gitModulesPath) -and -not $UseSubmodule) {
    Write-Host "[TRELLIS2] Hinweis: .gitmodules existiert, aber Clone-Modus wurde genutzt."
}

Write-Host "[TRELLIS2] Fertig. Naechster Schritt: scripts/trellis2_webapp.ps1 oder scripts/trellis2_generate.ps1 ausfuehren."