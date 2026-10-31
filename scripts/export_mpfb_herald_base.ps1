param(
    [string]$BlenderPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$workspace = Resolve-Path (Join-Path $PSScriptRoot '..')
$exportScript = Join-Path $workspace 'scripts/export_mpfb_herald_base.py'
$candidates = @()
if (-not [string]::IsNullOrWhiteSpace($BlenderPath)) {
    $candidates += $BlenderPath
}
$blenderCommand = Get-Command blender -ErrorAction SilentlyContinue
if ($blenderCommand) {
    $candidates += $blenderCommand.Source
}
$candidates += @(
    (Join-Path $env:ProgramFiles 'Blender Foundation/Blender 4.4/blender.exe'),
    (Join-Path $env:ProgramFiles 'Blender Foundation/Blender 4.5/blender.exe')
)
$blender = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $blender) {
    throw 'Blender 4.4+ was not found. Pass -BlenderPath or add blender to PATH.'
}

& $blender --background --factory-startup --python $exportScript --python-exit-code 1
if ($LASTEXITCODE -ne 0) {
    throw "MakeHuman/MPFB GLB export failed with exit code $LASTEXITCODE."
}