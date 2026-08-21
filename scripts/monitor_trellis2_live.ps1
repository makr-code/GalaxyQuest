#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Continuous TRELLIS2 Runtime Monitor
.DESCRIPTION
    Monitors TRELLIS2 health, GPU usage, generation queue, and API status
.PARAMETER Interval
    Refresh interval in seconds (default: 10)
.PARAMETER Continuous
    Run continuously (Ctrl+C to stop)
#>
param(
    [int]$Interval = 10,
    [switch]$Continuous
)

$ErrorActionPreference = 'SilentlyContinue'

function Show-Status {
    Clear-Host
    $timestamp = Get-Date -Format "HH:mm:ss"
    
    Write-Host "┌────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "│  🚀 TRELLIS2 LIVE MONITOR  |  $timestamp" -ForegroundColor Cyan
    Write-Host "└────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
    Write-Host ""
    
    # 1. Container Health
    Write-Host "1️⃣  CONTAINER HEALTH" -ForegroundColor Yellow
    $container = docker ps --filter "name=galaxyquest-trellis2" --format "{{.Status}}" 2>$null
    if ($container -like "Up*") {
        $statusEmoji = if ($container -like "*healthy*") { "✅" } else { "⚠️" }
        Write-Host "   $statusEmoji $container" -ForegroundColor $(if ($container -like "*healthy*") { "Green" } else { "Yellow" })
    } else {
        Write-Host "   ❌ Container not running" -ForegroundColor Red
        return
    }
    Write-Host ""
    
    # 2. GPU Status
    Write-Host "2️⃣  GPU STATUS" -ForegroundColor Yellow
    try {
        $gpuInfo = docker exec galaxyquest-trellis2 nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,utilization.memory --format=csv,noheader,nounits 2>$null
        if ($gpuInfo) {
            $mem_used, $mem_total, $util_gpu, $util_mem = $gpuInfo -split ","
            $mem_used = [int]$mem_used
            $mem_total = [int]$mem_total
            $util_gpu = [int]$util_gpu
            $util_mem = [int]$util_mem
            $mem_pct = [math]::Round(($mem_used / $mem_total) * 100)
            
            Write-Host "   Memory: $mem_used MB / $mem_total MB ($mem_pct%)" -ForegroundColor $(
                if ($mem_pct -gt 80) { "Red" } 
                elseif ($mem_pct -gt 50) { "Yellow" } 
                else { "Green" }
            )
            Write-Host "   GPU Utilization: $util_gpu%" -ForegroundColor $(if ($util_gpu -gt 0) { "Magenta" } else { "Gray" })
            Write-Host "   Memory Utilization: $util_mem%" -ForegroundColor $(if ($util_mem -gt 0) { "Magenta" } else { "Gray" })
            
            if ($util_gpu -gt 50) {
                Write-Host "   ⚡ ACTIVE GENERATION IN PROGRESS" -ForegroundColor Magenta
            }
        } else {
            Write-Host "   ⚠️  GPU monitoring unavailable" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "   ⚠️  GPU error: $_" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 3. API Health
    Write-Host "3️⃣  API HEALTH" -ForegroundColor Yellow
    try {
        $apiTest = Invoke-WebRequest -Uri "http://localhost:7862/gradio_api/info" -Method Get -TimeoutSec 3 -SkipHttpErrorCheck
        if ($apiTest.StatusCode -eq 200) {
            Write-Host "   ✅ Gradio API: Responding" -ForegroundColor Green
            Write-Host "   📡 Endpoint: http://localhost:7862" -ForegroundColor Cyan
        } else {
            Write-Host "   ❌ API: HTTP $($apiTest.StatusCode)" -ForegroundColor Red
        }
    } catch {
        Write-Host "   ❌ API: No response ($_)" -ForegroundColor Red
    }
    Write-Host ""
    
    # 4. Database Queue
    Write-Host "4️⃣  GENERATION QUEUE" -ForegroundColor Yellow
    try {
        $queueStatus = docker compose exec -T db mysql -u root galaxyquest -se "
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
            FROM generation_queue
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        " 2>$null
        
        if ($queueStatus) {
            $lines = $queueStatus -split "`n" | Where-Object { $_.Trim() }
            if ($lines.Count -gt 0) {
                $values = $lines[-1] -split "`t"
                $total, $pending, $processing, $completed = $values
                
                Write-Host "   Total (1h):     $total" -ForegroundColor Cyan
                Write-Host "   ⏳ Pending:      $pending" -ForegroundColor $(if ($pending -gt 0) { "Yellow" } else { "Green" })
                Write-Host "   ⚙️  Processing:   $processing" -ForegroundColor $(if ($processing -gt 0) { "Magenta" } else { "Green" })
                Write-Host "   ✅ Completed:    $completed" -ForegroundColor Green
                
                if ($processing -gt 0) {
                    Write-Host "   🎬 $processing generation(s) currently running" -ForegroundColor Magenta
                }
            }
        }
    } catch {
        Write-Host "   ⚠️  Queue check error" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 5. Recent Errors
    Write-Host "5️⃣  RECENT ERRORS (Last 5)" -ForegroundColor Yellow
    try {
        $logs = docker logs --tail 100 galaxyquest-trellis2 2>$null
        $errors = $logs | Select-String -Pattern "ERROR|FAILED|Exception" -ErrorAction SilentlyContinue | Select-Object -Last 5
        
        if ($errors) {
            $errors | ForEach-Object {
                $msg = $_.Line -replace '^.*(?=ERROR|FAILED|Exception)', ''
                Write-Host "   ❌ $msg" -ForegroundColor Red
            }
        } else {
            Write-Host "   ✅ No errors detected" -ForegroundColor Green
        }
    } catch {
        Write-Host "   ⚠️  Log check error" -ForegroundColor Yellow
    }
    Write-Host ""
    
    Write-Host "┌────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
    Write-Host "│  Updates every $Interval seconds | Press Ctrl+C to stop" -ForegroundColor Cyan
    Write-Host "└────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
}

if ($Continuous) {
    while ($true) {
        Show-Status
        Start-Sleep -Seconds $Interval
    }
} else {
    Show-Status
}
