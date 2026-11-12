<#
.SYNOPSIS
  Importiert ein von TRELLIS2 erzeugtes GLB als GQ Dev-Asset in den GQ-Asset-Ordner.

.PARAMETER SourceGlb
  Pfad zum generierten GLB (aus generated/trellis2/).

.PARAMETER AssetType
  Typ des Assets: ship | building | station | object

.PARAMETER Faction
  Fraktion (optional). Leerstring = 'generic'.

.PARAMETER Variant
  Varianten-Label (z. B. 'cargo', 'heavy', 'outpost').

.PARAMETER Slot
  Optionaler LOD-Slot-Bezeichner (z. B. 'lod0'). Standard: 'lod0'.

.PARAMETER Force
  Vorhandenes Asset-Ziel ueberschreiben.
#>
param(
    [Parameter(Mandatory)]
    [string]$SourceGlb,

    [Parameter(Mandatory)]
    [ValidateSet("ship", "building", "station", "object")]
    [string]$AssetType,

    [string]$Faction = "generic",
    [string]$Variant = "v1",
    [string]$Slot = "lod0",
    [ValidateSet(
        "habitat", "agriculture", "hydroponics", "industry", "warehouse", "tank", "silo",
        "solar", "fusion", "research", "nanotech", "hospital", "school", "command",
        "security", "terraforming", "drilling"
    )]
    [string]$FacilityKind,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($FacilityKind -and $AssetType -ne "building") {
    throw "FacilityKind ist nur fuer AssetType building zulaessig."
}

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")

# --- Pfade ---
$sourceGlbPath = [System.IO.Path]::IsPathRooted($SourceGlb) `
    ? $SourceGlb `
    : (Join-Path $workspace $SourceGlb)

if (-not (Test-Path $sourceGlbPath)) {
    throw "Quelldatei nicht gefunden: $sourceGlbPath"
}

$factionSlug = ($Faction -replace '[^a-z0-9_]', '_').ToLower()
$variantSlug = ($Variant -replace '[^a-z0-9_]', '_').ToLower()
$assetSlug = ($AssetType -replace '[^a-z0-9_]', '_').ToLower()

# GQ-Namenskonvention:  {assettype}_{faction}_{variant}_{slot}_trellis2_dev.glb
$targetFilename = "${assetSlug}_${factionSlug}_${variantSlug}_${Slot}_trellis2_dev.glb"

$targetDir = Join-Path $workspace "generated/trellis2/imported/$assetSlug"
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

$targetPath = Join-Path $targetDir $targetFilename

if ((Test-Path $targetPath) -and -not $Force) {
    throw "Zieldatei existiert bereits: $targetPath`nVerwende -Force zum Ueberschreiben."
}

$inspectionSource = [System.IO.Path]::ChangeExtension($sourceGlbPath, $null).TrimEnd('.') `
    + "_inspection.json"
$inspectionTarget = [System.IO.Path]::ChangeExtension($targetPath, $null).TrimEnd('.') `
    + "_inspection.json"
$importedFacilityKind = $null
if (Test-Path -LiteralPath $inspectionSource) {
    $inspection = Get-Content -LiteralPath $inspectionSource -Raw | ConvertFrom-Json
    $sourceHash = (Get-FileHash -LiteralPath $sourceGlbPath -Algorithm SHA256).Hash
    $inspectionAssetType = $inspection.PSObject.Properties["asset_type"]
    $inspectionFacilityKind = $inspection.PSObject.Properties["facility_kind"]
    $expectedFacilityKind = if ([string]::IsNullOrWhiteSpace($FacilityKind)) { $null } else { $FacilityKind }
    if ($inspection.schema -ne "gq.trellis-inspection.v2" -or `
        $inspection.status -ne "DEV_ONLY" -or `
        $inspection.source_sha256 -ne $sourceHash -or `
        -not $inspectionAssetType -or $inspectionAssetType.Value -ne $AssetType -or `
        -not $inspectionFacilityKind -or $inspectionFacilityKind.Value -ne $expectedFacilityKind -or `
        ($FacilityKind -and $AssetType -ne "building")) {
        throw "Inspection-Sidecar ist ungueltig oder gehoert nicht zu diesem GLB: $inspectionSource"
    }
    $importedFacilityKind = $inspectionFacilityKind.Value
}

Copy-Item -Path $sourceGlbPath -Destination $targetPath -Force

if (Test-Path -LiteralPath $inspectionSource) {
    Copy-Item -LiteralPath $inspectionSource -Destination $inspectionTarget -Force
    Write-Host "[TRELLIS2] Inspection-Sidecar kopiert (DEV_ONLY): $inspectionTarget"
} else {
    if (Test-Path -LiteralPath $inspectionTarget) {
        Remove-Item -LiteralPath $inspectionTarget
    }
    Write-Warning "[TRELLIS2] Kein Inspection-Sidecar vorhanden; Asset bleibt ungeprueft."
}

Write-Host "[TRELLIS2] Asset importiert: $targetPath"

# --- Sidecar quality.json mitkopieren (falls vorhanden) ---
$qualitySource = [System.IO.Path]::ChangeExtension($sourceGlbPath, $null).TrimEnd('.') `
    + "_quality.json"
$qualitySourceAlt = $sourceGlbPath -replace '\.glb$', '_quality.json'
foreach ($qSrc in @($qualitySource, $qualitySourceAlt)) {
    if (Test-Path $qSrc) {
        $qDest = $targetPath -replace '\.glb$', '_quality.json'
        Copy-Item -Path $qSrc -Destination $qDest -Force
        Write-Host "[TRELLIS2] Quality-Sidecar kopiert: $qDest"
        break
    }
}

# --- Import-Log schreiben ---
$logPath = Join-Path $workspace "generated/trellis2/import_log.jsonl"
$fileSizeKb = [math]::Round((Get-Item $targetPath).Length / 1024, 1)
$logEntry = [ordered]@{
    timestamp    = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    source       = $sourceGlbPath
    target       = $targetPath
    asset_type   = $AssetType
    faction      = $Faction
    variant      = $Variant
    slot         = $Slot
    facility_kind = $importedFacilityKind
    file_size_kb = $fileSizeKb
    status       = "DEV_ONLY"
}
Add-Content -Path $logPath -Value ($logEntry | ConvertTo-Json -Compress)

Write-Host "[TRELLIS2] Log aktualisiert: $logPath"
Write-Host "[TRELLIS2] Fertig."
Write-Host ""
Write-Host "  Dateiname : $targetFilename"
Write-Host "  Pfad      : $targetPath"
Write-Host "  Status    : DEV_ONLY (nicht produktionsreif)"
