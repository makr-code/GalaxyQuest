# GalaxyQuest Development Watch Script
# Überwacht Dateien und invalidiert Browser-Cache bei Änderungen

param(
    [int]$Port = 8080,
    [string]$Watch = "js,php,css,html",
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

Write-Host "🚀 GalaxyQuest Development Watch" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Server: http://localhost:$Port" -ForegroundColor Yellow
Write-Host "Watching: $Watch" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

# Check if Docker is running
$containers = docker ps --format "table {{.Names}}" 2>$null
if ($containers -notmatch "galaxyquest-web") {
    Write-Host "⚠️  Docker containers not running. Starting..." -ForegroundColor Yellow
    docker compose up -d --wait
    Start-Sleep -Seconds 5
}

$watchPatterns = $Watch -split "," | ForEach-Object { "*.{$($_)}" }
$lastCacheBust = 0
$fileWatcher = @{}

Write-Host "✅ Ready for development. Press Ctrl+C to stop." -ForegroundColor Green
Write-Host ""

# Monitor file changes
$fsWatcher = New-Object System.IO.FileSystemWatcher
$fsWatcher.Path = (Get-Location).Path
$fsWatcher.IncludeSubdirectories = $true
$fsWatcher.NotifyFilter = [System.IO.NotifyFilters]::LastWriteTime

# Ignore common temporary files
$ignorePatterns = @("*.gz", "node_modules", "build", "dist", ".git", "vendor", "__pycache__")

$onFileChanged = {
    $file = $Event.SourceEventArgs.FullPath
    $name = $Event.SourceEventArgs.Name
    
    # Skip ignored patterns
    $shouldIgnore = $false
    foreach ($pattern in $ignorePatterns) {
        if ($file -like "*$pattern*") {
            $shouldIgnore = $true
            break
        }
    }
    
    if ($shouldIgnore) { return }
    
    # Check if file matches watch pattern
    $isWatched = $false
    foreach ($ext in $Watch -split ",") {
        if ($file -like "*.$ext" -or $file -like "*.$($ext).map") {
            $isWatched = $true
            break
        }
    }
    
    if (-not $isWatched) { return }
    
    # Debounce: only react to changes > 500ms apart
    $now = [datetime]::Now.Ticks / 10000000
    $lastChange = $fileWatcher[$file] ?? 0
    
    if (($now - $lastChange) -lt 0.5) {
        return
    }
    
    $fileWatcher[$file] = $now
    
    # Extract relative path for display
    $relativePath = $file -replace [regex]::Escape((Get-Location).Path + '\'), ''
    
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 📝 Modified: $relativePath" -ForegroundColor Cyan
    
    # PHP: Reload OPCache
    if ($file -like "*.php") {
        Write-Host "  → Clearing PHP OPCache..." -ForegroundColor Gray
        docker compose exec -T web php -r "if (function_exists('opcache_reset')) opcache_reset();" 2>$null | Out-Null
    }
    
    # JS/CSS: Increment cache bust parameter
    if ($file -like "*.js" -or $file -like "*.css" -or $file -like "*.html") {
        $lastCacheBust = [int]([datetime]::Now.Ticks / 10000000)
        Write-Host "  → Cache bust: ?v=$lastCacheBust" -ForegroundColor Gray
        Write-Host "  → Reload browser: http://localhost:$Port/?cache_bust=$lastCacheBust" -ForegroundColor Yellow
    }
}

Register-ObjectEvent -InputObject $fsWatcher -EventName "Changed" -Action $onFileChanged | Out-Null
Register-ObjectEvent -InputObject $fsWatcher -EventName "Created" -Action $onFileChanged | Out-Null

# Open browser if not suppressed
if (-not $NoBrowser) {
    Start-Sleep -Seconds 2
    try {
        Start-Process "http://localhost:$Port"
    } catch {
        Write-Host "⚠️  Could not open browser automatically" -ForegroundColor Yellow
    }
}

# Keep script running
while ($true) {
    Start-Sleep -Seconds 1
}
