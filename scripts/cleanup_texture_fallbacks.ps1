param(
    [string]$CacheDir = 'generated/textures/planet'
)

if (-not (Test-Path $CacheDir)) {
    Write-Output "CACHE_DIR_MISSING=$CacheDir"
    exit 0
}

$removed = 0
Get-ChildItem -Path $CacheDir -Filter *.svg -File | ForEach-Object {
    $pngPath = Join-Path $CacheDir ($_.BaseName + '.png')
    if (Test-Path $pngPath) {
        Remove-Item $_.FullName -Force
        $removed++
    }
}

Write-Output "SVG_REMOVED=$removed"
Get-ChildItem -Path $CacheDir -File |
    Group-Object Extension |
    Sort-Object Name |
    Select-Object Name, Count |
    Format-Table -AutoSize |
    Out-String
