#!/usr/bin/env pwsh
<#
.SYNOPSIS
    TRELLIS2 Docker Manager für GalaxyQuest
    
.DESCRIPTION
    Startet, stoppt, debuggt und verwaltet den TRELLIS2 CUDA Docker Container
    
.PARAMETER Action
    Aktion: up | down | rebuild | logs | shell | gpu-check | models-download
    
.PARAMETER Profile
    Docker Compose Profile: ai-3d | ai-full (default: ai-3d)
    
.PARAMETER Verbose
    Zeige Logs in Echtzeit (ohne -d flag)
    
.EXAMPLE
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_docker.ps1 -Action up
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_docker.ps1 -Action logs -Verbose
    pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_docker.ps1 -Action gpu-check
#>

param(
    [ValidateSet("up", "down", "restart", "rebuild", "logs", "shell", "gpu-check", "models-download", "status")]
    [string]$Action = "up",
    
    [ValidateSet("ai-3d", "ai-full")]
    [string]$Profile = "ai-3d",
    
    [switch]$Verbose
)

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────

$workspace = Split-Path -Parent $PSScriptRoot
$containerName = "galaxyquest-trellis2"
$dockerComposePath = Join-Path $workspace "docker-compose.yml"

function Write-Step($msg) {
    Write-Host "`n[TRELLIS2] === $msg ===" -ForegroundColor Cyan
}

function Write-Ok($msg) {
    Write-Host "[TRELLIS2] ✓ $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "[TRELLIS2] ⚠ $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
    Write-Host "[TRELLIS2] ✗ $msg" -ForegroundColor Red
}

# ─────────────────────────────────────────────────────────────────────────────
# Actions
# ─────────────────────────────────────────────────────────────────────────────

switch ($Action) {
    "up" {
        Write-Step "Starte TRELLIS2 Container (Profile: $Profile)"
        
        if ($Verbose) {
            Write-Host "[TRELLIS2] Logs werden ausgegeben. Drücke Ctrl+C zum Beenden." -ForegroundColor Blue
            docker compose --profile $Profile up trellis2
        } else {
            docker compose --profile $Profile up -d trellis2
            Write-Ok "Container gestartet (Hintergrund)"
            Write-Host "[TRELLIS2] WebApp URLs:"
            Write-Host "  - Image→3D: http://127.0.0.1:7862"
            Write-Host "  - Text→3D:  http://127.0.0.1:7863"
        }
    }
    
    "down" {
        Write-Step "Stoppe TRELLIS2 Container"
        docker compose stop trellis2
        Write-Ok "Container gestoppt"
    }
    
    "restart" {
        Write-Step "Starte TRELLIS2 neu"
        docker compose restart trellis2
        Write-Ok "Container neu gestartet"
    }
    
    "rebuild" {
        Write-Step "Rebuild TRELLIS2 Image"
        docker compose --profile $Profile build trellis2
        Write-Ok "Image erfolgreich gebaut"
        Write-Host "[TRELLIS2] Jetzt 'up' ausführen: ./scripts/trellis2_docker.ps1 -Action up" -ForegroundColor Yellow
    }
    
    "logs" {
        Write-Step "Zeige Container-Logs (Ctrl+C zum Beenden)"
        docker compose logs trellis2 -f
    }
    
    "shell" {
        Write-Step "Öffne Shell im Container"
        docker exec -it $containerName bash
    }
    
    "gpu-check" {
        Write-Step "Prüfe GPU-Zugang"
        
        # 1. Docker GPU Status
        Write-Host "`n[TRELLIS2] Docker GPU Runtime:" -ForegroundColor Cyan
        $gpuInfo = docker run --rm --gpus all nvidia/cuda:12.4.1-runtime-ubuntu22.04 nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
        
        if ($gpuInfo -match "error|not found") {
            Write-Fail "NVIDIA Container Runtime nicht konfiguriert"
            Write-Warn "Schreibe in Docker Desktop Settings:"
            Write-Warn "  Settings → Resources → Advanced → Use WSL 2 based engine"
            return
        }
        
        Write-Host $gpuInfo -ForegroundColor Green
        
        # 2. CUDA in Container
        Write-Host "`n[TRELLIS2] CUDA im TRELLIS2 Container:" -ForegroundColor Cyan
        
        if (-not (docker ps | Select-String $containerName)) {
            Write-Warn "Container nicht aktiv. Starten..."
            & $PSScriptRoot/trellis2_docker.ps1 -Action up
            Start-Sleep -Seconds 10
        }
        
        $cudaCheck = docker exec $containerName python -c "import torch; print(f'PyTorch Version: {torch.__version__}\nCUDA Available: {torch.cuda.is_available()}\nCUDA Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"No GPU\"}')" 2>&1
        Write-Host $cudaCheck -ForegroundColor Green
        
        # 3. Modell-Status
        Write-Host "`n[TRELLIS2] Modelle im Container:" -ForegroundColor Cyan
        $modelCheck = docker exec $containerName bash -c "du -sh /workspace/models/* 2>/dev/null || echo 'Keine Modelle heruntergeladen'" 2>&1
        Write-Host $modelCheck -ForegroundColor Yellow
    }
    
    "models-download" {
        Write-Step "Lade TRELLIS2 Modelle herunter (ca. 15 GB)"
        
        if (-not (docker ps | Select-String $containerName)) {
            Write-Warn "Container nicht aktiv. Starten..."
            & $PSScriptRoot/trellis2_docker.ps1 -Action up
            Start-Sleep -Seconds 10
        }
        
        Write-Host "[TRELLIS2] Lade image-large Modell..." -ForegroundColor Cyan
        docker exec $containerName python /workspace/trellis2/scripts/download_model.py `
            --model "TRELLIS-image-large" `
            --output-dir "/workspace/models"
        
        Write-Ok "Modell heruntergeladen zu /workspace/models"
    }
    
    "status" {
        Write-Step "Container Status"
        docker ps --filter "name=$containerName" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    }
    
    default {
        Write-Fail "Unbekannte Aktion: $Action"
    }
}

Write-Host ""
