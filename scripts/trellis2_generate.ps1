param(
    [ValidateSet("text", "image")]
    [string]$Mode = "text",
    [string]$Prompt = "A modular sci-fi cargo ship with hard surface panels",
    [string]$ImagePath = "",
    [string]$RepoRoot = "tools/trellis2",
    [string]$ModelDir = "tools/trellis2/models",
    [string]$OutputDir = "generated/trellis2",
    [string]$Model = "",
    [int]$Seed = 42,
    [int]$SsSteps = 12,
    [double]$SsCfg = 7.5,
    [int]$SlatSteps = 12,
    [double]$SlatCfg = 3.0,
    [double]$Simplify = 0.95,
    [int]$TextureSize = 1024,
    [string]$CondaEnv = "trellis",
    [switch]$UseSystemPython
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $workspace

$pythonScript = Join-Path $workspace "scripts/trellis2_generate.py"
if (-not (Test-Path $pythonScript)) {
    throw "Python-Skript nicht gefunden: $pythonScript"
}

if ($Mode -eq "image" -and [string]::IsNullOrWhiteSpace($ImagePath)) {
    throw "Im image-Modus muss -ImagePath gesetzt sein."
}

$argList = @(
    $pythonScript,
    "--repo-root", $RepoRoot,
    "--mode", $Mode,
    "--prompt", $Prompt,
    "--image", $ImagePath,
    "--model", $Model,
    "--seed", "$Seed",
    "--ss-steps", "$SsSteps",
    "--ss-cfg", "$SsCfg",
    "--slat-steps", "$SlatSteps",
    "--slat-cfg", "$SlatCfg",
    "--simplify", "$Simplify",
    "--texture-size", "$TextureSize",
    "--output-dir", $OutputDir
)

# Lokalen Model-Cache als HF_HOME setzen (Prioritaet vor globalem ~/.cache/huggingface)
$modelDirFull = Join-Path $workspace $ModelDir
if (Test-Path $modelDirFull) {
    $env:HF_HOME = $modelDirFull
    Write-Host "[TRELLIS2] HF_HOME: $modelDirFull"
}

# Aus lokaler models.json automatisch besten lokal gecachten Model-Pfad ermitteln
if ([string]::IsNullOrWhiteSpace($Model)) {
    $registryPath = Join-Path $modelDirFull "models.json"
    if (Test-Path $registryPath) {
        $registry = Get-Content $registryPath -Raw | ConvertFrom-Json
        $lookupKey = if ($Mode -eq "image") { "image-large" } else { "text-xlarge" }
        if ($registry.PSObject.Properties[$lookupKey]) {
            $localDir = $registry.$lookupKey.local_dir
            if (Test-Path $localDir) {
                $Model = $localDir
                Write-Host "[TRELLIS2] Lokales Modell gefunden: $Model"
            }
        }
    }
}

Write-Host "[TRELLIS2] Mode: $Mode"
Write-Host "[TRELLIS2] OutputDir: $OutputDir"

if ($UseSystemPython) {
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "python wurde nicht gefunden."
    }
    & python @argList
}
else {
    if (-not (Get-Command conda -ErrorAction SilentlyContinue)) {
        throw "conda wurde nicht gefunden. Verwende -UseSystemPython oder installiere Conda."
    }
    & conda run -n $CondaEnv python @argList
}
