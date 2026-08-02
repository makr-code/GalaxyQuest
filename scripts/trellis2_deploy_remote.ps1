#!/usr/bin/env powershell
<#
.SYNOPSIS
    TRELLIS2 Docker Service Manager & Remote Deployment Helper
.DESCRIPTION
    Manages TRELLIS2 Docker container lifecycle (up/down/logs/etc)
    Plus remote deployment automation for other systems
.USAGE
    ./trellis2_deploy_remote.ps1 -Action "deploy-script" -TargetHost "user@host.com"
#>

param(
    [ValidateSet('generate-env', 'generate-compose', 'deploy-script', 'quick-start')]
    [string]$Action = 'quick-start'
)

$ErrorActionPreference = 'Stop'

function Generate-EnvFile {
    Write-Host "📄 Generating .env.trellis2 file..."
    
    $envContent = @'
# ============================================================================
# TRELLIS2 Docker Environment Configuration
# ============================================================================
# Copy to .env.trellis2 in your GalaxyQuest directory
# Then: docker compose --env-file .env.trellis2 up trellis2 -d

# Model & Cache Paths (inside container)
TORCH_HOME=/workspace/models/torch
HF_HOME=/workspace/models/huggingface
HF_DATASETS_CACHE=/workspace/models/datasets

# GPU Configuration
CUDA_VISIBLE_DEVICES=0          # Single GPU (0-indexed)
CUDA_DEVICE_ORDER=PCI_BUS_ID    # Order GPUs by physical slot
CUDA_LAUNCH_BLOCKING=0          # Async GPU execution

# Gradio Server Configuration
GRADIO_SERVER_NAME=0.0.0.0      # Listen on all interfaces
GRADIO_SERVER_PORT=7862         # Image-to-3D port
GRADIO_ENABLE_QUEUE=true        # Enable request queue
GRADIO_SHARE=false              # No public share link

# TRELLIS2 Model Selection (if using full models)
TRELLIS_MODEL=TRELLIS-large     # Options: text-base, text-large, image-large, large
TRELLIS_MODE=both               # Options: text, image, both

# HuggingFace Configuration
HF_HUB_DISABLE_TELEMETRY=1      # Disable telemetry
HF_TOKEN=                       # Leave empty unless using private models

# Optional: For multi-GPU setup
# CUDA_VISIBLE_DEVICES=0,1,2,3
# CUDA_DEVICE_ORDER=PCI_BUS_ID
'@

    $envContent | Out-File -Encoding UTF8 ".env.trellis2"
    Write-Host "✅ Created: .env.trellis2" -ForegroundColor Green
}

function Generate-ComposeFile {
    Write-Host "📄 Generating docker-compose.trellis2.yml..."
    
    $composeContent = @'
# Minimal docker-compose for remote deployment
# Usage: docker compose -f docker-compose.trellis2.yml up -d

version: '3.8'

services:
  trellis2:
    image: galaxyquest-trellis2:latest
    container_name: galaxyquest-trellis2
    runtime: nvidia
    environment:
      CUDA_VISIBLE_DEVICES: ${CUDA_VISIBLE_DEVICES:-0}
      TORCH_HOME: /workspace/models/torch
      HF_HOME: /workspace/models/huggingface
      PYTHONUNBUFFERED: 1
      GRADIO_SERVER_NAME: 0.0.0.0
      GRADIO_SERVER_PORT: 7862
    ports:
      - "7862:7862"   # Image-to-3D
      - "7863:7863"   # Text-to-3D (alternative)
    volumes:
      - trellis2-models:/workspace/models
      - ./generated/trellis2:/workspace/generated
    working_dir: /workspace
    command: 
      - /bin/bash
      - -c
      - |
        python gradio_app.py both
    healthcheck:
      test: ["CMD", "python", "-c", "import torch; assert torch.cuda.is_available()"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  trellis2-models:
    driver: local
'@

    $composeContent | Out-File -Encoding UTF8 "docker-compose.trellis2.yml"
    Write-Host "✅ Created: docker-compose.trellis2.yml" -ForegroundColor Green
}

function Generate-DeployScript {
    Write-Host "📄 Generating remote deployment script..."
    
    $scriptContent = @'
#!/bin/bash
# TRELLIS2 Remote Deployment Script
# Run on remote Docker host to set up TRELLIS2 service
# Usage: bash trellis2_deploy_remote.sh

set -e

echo "=========================================="
echo "TRELLIS2 Remote Deployment"
echo "=========================================="

# 1. Verify Docker & GPU
echo "[1/5] Verifying Docker & GPU..."
docker --version || (echo "❌ Docker not found" && exit 1)
docker run --rm --gpus all ubuntu nvidia-smi || (echo "⚠ GPU access may be limited" && exit 1)

# 2. Pull/Build image
echo "[2/5] Preparing TRELLIS2 image..."
if [ -f "docker/trellis2/Dockerfile" ]; then
    echo "  Building from Dockerfile..."
    docker build -f docker/trellis2/Dockerfile -t galaxyquest-trellis2:latest .
else
    echo "  Pulling pre-built image from registry..."
    docker pull galaxyquest-trellis2:latest || echo "  Note: Image not found. Please build locally first."
fi

# 3. Create required directories
echo "[3/5] Creating directories..."
mkdir -p generated/trellis2/{image2text,text2image,logs,imported}
chmod 777 generated/trellis2

# 4. Start service
echo "[4/5] Starting TRELLIS2 service..."
docker compose -f docker-compose.trellis2.yml up -d

# 5. Verify health
echo "[5/5] Verifying service..."
sleep 30  # Wait for container startup

if docker compose -f docker-compose.trellis2.yml ps | grep -q "Up"; then
    echo "✅ TRELLIS2 service is running!"
    echo ""
    echo "📊 Service Details:"
    docker compose -f docker-compose.trellis2.yml ps
    echo ""
    echo "🌐 WebApp URLs:"
    echo "  Image-to-3D: http://localhost:7862"
    echo "  Text-to-3D:  http://localhost:7863"
    echo ""
    echo "📝 Next steps:"
    echo "  1. Download models: docker compose exec trellis2 python -c \\"from transformers import AutoModel; AutoModel.from_pretrained('JeffreyXiang/TRELLIS-image-large', trust_remote_code=True)\\""
    echo "  2. Test WebApp: curl http://localhost:7862/health"
    echo "  3. View logs: docker compose logs -f trellis2"
else
    echo "❌ Service failed to start. Check logs:"
    docker compose -f docker-compose.trellis2.yml logs
    exit 1
fi
'@

    $scriptContent | Out-File -Encoding UTF8 "scripts/trellis2_deploy_remote.sh" -NoNewline
    # Convert line endings for Unix
    (Get-Content "scripts/trellis2_deploy_remote.sh") -replace "`r`n", "`n" | Set-Content "scripts/trellis2_deploy_remote.sh"
    Write-Host "✅ Created: scripts/trellis2_deploy_remote.sh" -ForegroundColor Green
    Write-Host "   Usage: bash scripts/trellis2_deploy_remote.sh (on remote host)" -ForegroundColor DarkCyan
}

function Show-QuickStart {
    Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║          TRELLIS2 Docker Setup - Quick Start Guide             ║
╚════════════════════════════════════════════════════════════════╝

📋 OPTION 1: Local Setup (This Machine)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Start TRELLIS2 service:
   docker compose --profile ai-3d up trellis2 -d

2. Verify GPU access:
   docker compose exec trellis2 python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}')"

3. Download models (first time, ~15-30 min):
   docker compose exec trellis2 python -c \\
     "from transformers import AutoModel; \\
      AutoModel.from_pretrained('JeffreyXiang/TRELLIS-image-large', trust_remote_code=True)"

4. Open WebApp:
   🌐 Image-to-3D: http://localhost:7862
   🌐 Text-to-3D:  http://localhost:7863

🛑 Stop service:
   docker compose down trellis2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 OPTION 2: Remote Setup (Another Machine)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Generate deployment files:
   ./trellis2_deploy_remote.ps1 -Action generate-env
   ./trellis2_deploy_remote.ps1 -Action generate-compose
   ./trellis2_deploy_remote.ps1 -Action deploy-script

2. Copy to remote host:
   scp -r GalaxyQuest user@remote:/path/to/
   scp docker-compose.trellis2.yml user@remote:/path/to/GalaxyQuest/
   scp .env.trellis2 user@remote:/path/to/GalaxyQuest/
   scp scripts/trellis2_deploy_remote.sh user@remote:/path/to/GalaxyQuest/scripts/

3. On remote host:
   cd /path/to/GalaxyQuest
   bash scripts/trellis2_deploy_remote.sh

4. Verify:
   docker compose -f docker-compose.trellis2.yml ps
   curl http://remote:7862/health

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 System Requirements
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Minimum:
  • Docker 20.10+
  • Docker Compose 2.0+
  • GPU: NVIDIA RTX 3060 or better
  • Storage: 50 GB (Docker image + models)
  • RAM: 16 GB minimum

Recommended:
  • GPU: NVIDIA RTX 4070 or A100
  • Storage: 100 GB (models cache)
  • RAM: 32 GB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❓ Troubleshooting
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Problem: Container exits immediately
  → Check logs: docker compose logs trellis2
  → Verify GPU: docker run --rm --gpus all nvidia-smi

Problem: Port 7862 already in use
  → Kill existing: docker compose down trellis2

Problem: Out of GPU memory
  → Reduce batch size or use smaller model variant

Problem: Models not downloading
  → Verify HuggingFace access: curl https://huggingface.co/
  → Check internet connection from container

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 Additional Commands
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

View logs:
  docker compose logs -f trellis2

Enter container shell:
  docker compose exec trellis2 /bin/bash

Export image for transfer:
  docker save galaxyquest-trellis2:latest | gzip > trellis2.tar.gz

Load image on remote:
  gunzip -c trellis2.tar.gz | docker load

Clean up:
  docker compose down trellis2 --volumes

"@ -ForegroundColor Cyan
}

# Execute requested action
switch ($Action) {
    'generate-env' {
        Generate-EnvFile
    }
    'generate-compose' {
        Generate-ComposeFile
    }
    'deploy-script' {
        Generate-DeployScript
        Generate-EnvFile
        Generate-ComposeFile
    }
    'quick-start' {
        Show-QuickStart
    }
}

Write-Host ""
Write-Host "✅ Done!" -ForegroundColor Green
