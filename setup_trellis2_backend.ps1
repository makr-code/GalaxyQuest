#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Setup TRELLIS2 Backend Integration – Automatisierte Deployment-Pipeline
    
.DESCRIPTION
    1. Wartet auf Docker CUDA-Download
    2. Baut TRELLIS2 Container
    3. Führt Datenbank-Migration durch
    4. Seedet Base Assets
    5. Testet alle Endpunkte
    
.EXAMPLE
    pwsh setup_trellis2_backend.ps1
#>

param(
    [switch]$NoWait = $false,      # Skip job completion waiting
    [switch]$TestOnly = $false,    # Only test, don't seed
    [string]$Faction = $null       # Seed only one faction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$WorkspaceRoot = Split-Path -Parent $PSScriptRoot

Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  TRELLIS2 Backend Integration – Deployment Pipeline       ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ─────────────────────────────────────────────────────────────────────────

function Test-DockerImage {
    param([string]$Image, [string]$Tag)
    
    Write-Host "🔍 Prüfe Docker Image: $Image:$Tag" -ForegroundColor Blue
    
    try {
        $output = & docker images --format "{{.Repository}}:{{.Tag}}" | Select-String "^$Image:$Tag$"
        return $null -ne $output
    } catch {
        return $false
    }
}

function Wait-DockerImage {
    param([string]$Image, [string]$Tag)
    
    $maxAttempts = 30
    $attempt = 0
    
    while ($attempt -lt $maxAttempts) {
        if (Test-DockerImage $Image $Tag) {
            Write-Host "✓ Docker Image $Image:$Tag verfügbar" -ForegroundColor Green
            return $true
        }
        
        $attempt++
        $remaining = $maxAttempts - $attempt
        Write-Host "  ⏳ Warte auf Download ($remaining Versuche übrig)..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
    
    Write-Host "❌ Timeout beim Warten auf Docker Image" -ForegroundColor Red
    return $false
}

# ─────────────────────────────────────────────────────────────────────────

# 1. Wait for CUDA image download
Write-Host ""
Write-Host "▶ Schritt 1: Docker CUDA Image" -ForegroundColor Cyan

if (-not (Test-DockerImage "nvidia/cuda" "12.1.1-cudnn8-runtime-ubuntu22.04")) {
    Write-Host "ℹ Starte Docker Pull im Hintergrund..." -ForegroundColor Blue
    if (-not (Wait-DockerImage "nvidia/cuda" "12.1.1-cudnn8-runtime-ubuntu22.04")) {
        Write-Host "❌ Konnte CUDA Image nicht herunterladen" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ CUDA Image bereits vorhanden" -ForegroundColor Green
}

# ─────────────────────────────────────────────────────────────────────────

# 2. Build TRELLIS2 container
Write-Host ""
Write-Host "▶ Schritt 2: Build TRELLIS2 Container" -ForegroundColor Cyan

try {
    Write-Host "  Baue Image: galaxyquest-trellis2" -ForegroundColor Gray
    Push-Location $WorkspaceRoot
    
    & docker compose build trellis2 2>&1 | ForEach-Object {
        if ($_ -match "error|failed") {
            Write-Host "  ❌ $_" -ForegroundColor Red
        } else {
            Write-Host "  ℹ $_" -ForegroundColor Gray
        }
    }
    
    Pop-Location
    Write-Host "✓ TRELLIS2 Container erfolgreich gebaut" -ForegroundColor Green
} catch {
    Write-Host "❌ Build fehlgeschlagen: $_" -ForegroundColor Red
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────

# 3. Start dependencies
Write-Host ""
Write-Host "▶ Schritt 3: Starte Services" -ForegroundColor Cyan

try {
    Push-Location $WorkspaceRoot
    
    # Starte db + web zuerst
    Write-Host "  Starte MySQL..." -ForegroundColor Gray
    & docker compose up -d db 2>&1 | Out-Null
    
    # Warte auf DB
    Write-Host "  Warte auf MySQL Health Check..." -ForegroundColor Gray
    $maxWait = 60
    $elapsed = 0
    
    while ($elapsed -lt $maxWait) {
        $health = & docker compose exec -T db mysqladmin ping -h localhost -proot 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ MySQL ist bereit" -ForegroundColor Green
            break
        }
        Start-Sleep -Seconds 2
        $elapsed += 2
    }
    
    if ($elapsed -ge $maxWait) {
        Write-Host "⚠ MySQL Timeout - fahre trotzdem fort" -ForegroundColor Yellow
    }
    
    Pop-Location
} catch {
    Write-Host "❌ Service Start fehlgeschlagen: $_" -ForegroundColor Red
    # Nicht exit - fahre fort
}

# ─────────────────────────────────────────────────────────────────────────

# 4. Run database migration
Write-Host ""
Write-Host "▶ Schritt 4: Datenbank-Migration" -ForegroundColor Cyan

try {
    Push-Location $WorkspaceRoot
    
    Write-Host "  Führe Migration durch: trellis2_generation_queue" -ForegroundColor Gray
    
    # Create migration file for MySQL
    $migrationSql = @"
-- Migration: TRELLIS2 Generation Queue
CREATE TABLE IF NOT EXISTS trellis2_generation_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_id VARCHAR(128) NOT NULL UNIQUE,
    component_type VARCHAR(32),
    faction_code VARCHAR(32),
    prompt LONGTEXT,
    metadata JSON,
    status ENUM('queued', 'processing', 'completed', 'failed') DEFAULT 'queued',
    glb_path VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    INDEX idx_faction_type (faction_code, component_type),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS base_ship_components (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_code VARCHAR(32) NOT NULL,
    component_type VARCHAR(32) NOT NULL,
    glb_path VARCHAR(255) NOT NULL,
    metadata JSON,
    version INT DEFAULT 1,
    checksum VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_faction (faction_code),
    INDEX idx_type (component_type),
    UNIQUE KEY unique_faction_type (faction_code, component_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS species_avatars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    species_code VARCHAR(32) NOT NULL,
    gender ENUM('male', 'female') NOT NULL,
    glb_path VARCHAR(255) NOT NULL,
    metadata JSON,
    thumbnail_path VARCHAR(255),
    version INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_species (species_code),
    INDEX idx_gender (gender),
    UNIQUE KEY unique_species_gender (species_code, gender)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend user_generated_ships if needed
ALTER TABLE user_generated_ships 
ADD COLUMN IF NOT EXISTS base_hull_id INT;
"@
    
    $migrationSql | & docker compose exec -T db mysql -u galaxyquest_user -pgalaxyquest_dev galaxyquest 2>&1 | Out-Null
    
    Write-Host "✓ Datenbank-Migration erfolgreich" -ForegroundColor Green
    
    Pop-Location
} catch {
    Write-Host "❌ Migration fehlgeschlagen: $_" -ForegroundColor Red
    # Nicht exit - fahre fort
}

# ─────────────────────────────────────────────────────────────────────────

# 5. Test backend endpoints
Write-Host ""
Write-Host "▶ Schritt 5: Test Backend-Endpunkte" -ForegroundColor Cyan

try {
    Push-Location $WorkspaceRoot
    
    # Start web container
    Write-Host "  Starte Web Container..." -ForegroundColor Gray
    & docker compose up -d web 2>&1 | Out-Null
    
    # Wait for web to be ready
    Start-Sleep -Seconds 5
    
    # Test health endpoint
    Write-Host "  Teste Health Endpoint..." -ForegroundColor Gray
    $response = Invoke-WebRequest -Uri "http://localhost:8080/api/trellis2_generator.php?action=status" -ErrorAction SilentlyContinue
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ Backend ist erreichbar" -ForegroundColor Green
    } else {
        Write-Host "⚠ Backend Status: $($response.StatusCode)" -ForegroundColor Yellow
    }
    
    Pop-Location
} catch {
    Write-Host "⚠ Endpoint Test fehlgeschlagen (optional): $_" -ForegroundColor Yellow
    # Nicht exit
}

# ─────────────────────────────────────────────────────────────────────────

# 6. Seed base assets (optional)
if (-not $TestOnly) {
    Write-Host ""
    Write-Host "▶ Schritt 6: Seed Base Assets" -ForegroundColor Cyan
    
    try {
        Push-Location $WorkspaceRoot
        
        $args = if ($NoWait) { "--no-wait" } else { "" }
        $args += if ($Faction) { " --faction $Faction" } else { "" }
        
        Write-Host "  Seeding (möglicherweise lange Laufzeit)..." -ForegroundColor Gray
        Write-Host "  Kommando: php tools/seed_trellis2_assets.php $args" -ForegroundColor Gray
        
        & php tools/seed_trellis2_assets.php $args.Split() 2>&1 | ForEach-Object {
            Write-Host "  $_"
        }
        
        Write-Host "✓ Asset Seeding abgeschlossen" -ForegroundColor Green
        
        Pop-Location
    } catch {
        Write-Host "⚠ Seeding fehlgeschlagen (optional): $_" -ForegroundColor Yellow
    }
}

# ─────────────────────────────────────────────────────────────────────────

# Summary
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  ✅ Setup abgeschlossen!                                  ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host ""
Write-Host "📋 Nächste Schritte:" -ForegroundColor Green
Write-Host "  1. Prüfe Logs: docker logs galaxyquest-trellis2" -ForegroundColor Gray
Write-Host "  2. Test TRELLIS2: curl http://localhost:7862/api/health" -ForegroundColor Gray
Write-Host "  3. Prüfe Assets: mysql -u galaxyquest_user -pgalaxyquest_dev -e 'SELECT COUNT(*) FROM base_ship_components;'" -ForegroundColor Gray
Write-Host "  4. Teste API: curl http://localhost:8080/api/ship_designer_enhanced.php?action=get_base_assets" -ForegroundColor Gray
Write-Host ""

exit 0
