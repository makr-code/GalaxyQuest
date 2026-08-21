# TRELLIS2 Runtime Monitoring Dashboard
# Monitor GPU, logs, API health, and queue status

param(
    [switch]$Continuous = $false,
    [int]$RefreshSeconds = 5
)

$TRELLIS2_URL = "http://localhost:7862"
$API_ENDPOINT = "$TRELLIS2_URL/gradio_api/info"

function Get-ContainerStatus {
    $container = docker ps --filter "name=galaxyquest-trellis2" --format "{{.Names}};{{.Status}}" 2>$null
    if ($container) {
        $name, $status = $container -split ";"
        return @{
            Name = $name
            Status = $status
            Running = $status -like "Up*"
            Healthy = $status -like "*healthy*"
        }
    }
    return @{ Running = $false }
}

function Get-GPUStatus {
    try {
        $result = docker exec galaxyquest-trellis2 nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits 2>$null
        if ($result) {
            $parts = $result -split ","
            return @{
                MemoryUsedMB = [int]$parts[0]
                MemoryTotalMB = [int]$parts[1]
                GPUUtilization = [int]$parts[2]
                MemoryPercent = [math]::Round(([int]$parts[0] / [int]$parts[1]) * 100)
            }
        }
    } catch {
        return @{ Error = $_.Exception.Message }
    }
    return $null
}

function Get-APIHealth {
    try {
        $response = Invoke-WebRequest -Uri $API_ENDPOINT -Method GET -TimeoutSec 5 -ErrorAction Stop
        return @{
            Responding = $true
            StatusCode = $response.StatusCode
            ResponseTimeMs = $response.BaseResponse.Headers["Date"]
        }
    } catch {
        return @{
            Responding = $false
            Error = $_.Exception.Message
        }
    }
}

function Get-RecentLogs {
    try {
        $logs = docker logs --tail 20 galaxyquest-trellis2 2>$null
        $errors = $logs | Select-String -Pattern "ERROR|FAILED|Exception" -ErrorAction SilentlyContinue
        return @{
            TotalLines = ($logs | Measure-Object -Line).Lines
            ErrorCount = ($errors | Measure-Object -Line).Lines
            LastLine = $logs[-1] -replace '^.*\s+', ''
        }
    } catch {
        return @{ Error = $_.Exception.Message }
    }
}

function Get-GenerationStatus {
    try {
        $queueCount = 0
        
        # Check database for pending/processing jobs
        $mysql_result = docker compose exec -T db mysql -u root galaxyquest -e "SELECT COUNT(*) as count FROM generation_queue WHERE status IN ('pending', 'processing');" 2>$null
        if ($mysql_result) {
            $lines = $mysql_result -split "`n"
            if ($lines.Count -gt 1) {
                $queueCount = [int]$lines[1]
            }
        }
        
        return @{
            QueuedJobs = $queueCount
            Timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        }
    } catch {
        return @{ Error = $_.Exception.Message }
    }
}

function Show-Dashboard {
    Clear-Host
    Write-Host "╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║            TRELLIS2 RUNTIME MONITORING DASHBOARD                    ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    
    # Container Status
    Write-Host "━━━ CONTAINER STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    $container = Get-ContainerStatus
    if ($container.Running) {
        $statusColor = if ($container.Healthy) { "Green" } else { "Yellow" }
        Write-Host "✅ Status: $($container.Status)" -ForegroundColor $statusColor
    } else {
        Write-Host "❌ TRELLIS2 Container is NOT RUNNING" -ForegroundColor Red
        return
    }
    Write-Host ""
    
    # GPU Status
    Write-Host "━━━ GPU STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    $gpu = Get-GPUStatus
    if ($gpu.Error) {
        Write-Host "⚠️  GPU Error: $($gpu.Error)" -ForegroundColor Yellow
    } elseif ($gpu) {
        $memColor = if ($gpu.MemoryPercent -gt 80) { "Red" } else { if ($gpu.MemoryPercent -gt 50) { "Yellow" } else { "Green" } }
        $utilColor = if ($gpu.GPUUtilization -gt 80) { "Green" } else { "Cyan" }
        
        Write-Host "  Memory: $($gpu.MemoryUsedMB) MB / $($gpu.MemoryTotalMB) MB ($($gpu.MemoryPercent)%)" -ForegroundColor $memColor
        Write-Host "  GPU Utilization: $($gpu.GPUUtilization)%" -ForegroundColor $utilColor
        
        if ($gpu.MemoryPercent -gt 80) {
            Write-Host "  ⚠️  WARNING: GPU Memory high!" -ForegroundColor Red
        }
    }
    Write-Host ""
    
    # API Health
    Write-Host "━━━ API HEALTH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    $api = Get-APIHealth
    if ($api.Responding) {
        Write-Host "✅ API Responding: HTTP $($api.StatusCode)" -ForegroundColor Green
        Write-Host "   Endpoint: $API_ENDPOINT" -ForegroundColor Cyan
    } else {
        Write-Host "❌ API Not Responding: $($api.Error)" -ForegroundColor Red
    }
    Write-Host ""
    
    # Generation Queue
    Write-Host "━━━ GENERATION QUEUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    $queue = Get-GenerationStatus
    if ($queue.Error) {
        Write-Host "⚠️  Queue Error: $($queue.Error)" -ForegroundColor Yellow
    } else {
        $queueColor = if ($queue.QueuedJobs -gt 0) { "Magenta" } else { "Green" }
        Write-Host "  Queued Jobs: $($queue.QueuedJobs)" -ForegroundColor $queueColor
        Write-Host "  Timestamp: $($queue.Timestamp)" -ForegroundColor Gray
    }
    Write-Host ""
    
    # Recent Logs
    Write-Host "━━━ RECENT LOGS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Yellow
    $logs = Get-RecentLogs
    if ($logs.Error) {
        Write-Host "⚠️  Log Error: $($logs.Error)" -ForegroundColor Yellow
    } else {
        Write-Host "  Recent Lines: $($logs.TotalLines)" -ForegroundColor Cyan
        Write-Host "  Error Count: $($logs.ErrorCount)" -ForegroundColor $(if ($logs.ErrorCount -gt 0) { "Red" } else { "Green" })
    }
    Write-Host ""
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Last Update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
    if ($Continuous) {
        Write-Host "Next refresh in $RefreshSeconds seconds (Ctrl+C to stop)" -ForegroundColor Gray
    }
}

if ($Continuous) {
    while ($true) {
        Show-Dashboard
        Start-Sleep -Seconds $RefreshSeconds
    }
} else {
    Show-Dashboard
}
