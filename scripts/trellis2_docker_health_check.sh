#!/usr/bin/env bash
# TRELLIS2 Docker Health Check
# Verifies if Docker container is running and models are available

set -e

echo "🐳 TRELLIS2 Docker Health Check"
echo "================================"
echo ""

# Check 1: Container Status
echo "[1/4] Checking container status..."
if docker ps | grep -q "galaxyquest-trellis2"; then
    echo "✓ Container is running"
else
    echo "⚠ Container is not running"
    echo "  To start: docker compose --profile ai-3d up -d trellis2"
fi

# Check 2: GPU/CUDA
echo ""
echo "[2/4] Checking GPU access..."
if docker exec galaxyquest-trellis2 nvidia-smi &>/dev/null 2>&1; then
    gpu_info=$(docker exec galaxyquest-trellis2 nvidia-smi --query-gpu=name,memory.total --format=csv,noheader)
    echo "✓ GPU Available: $gpu_info"
else
    echo "ℹ GPU not available (CPU mode will be used)"
fi

# Check 3: PyTorch / CUDA
echo ""
echo "[3/4] Checking PyTorch & CUDA..."
pytorch_check=$(docker exec galaxyquest-trellis2 python -c "import torch; print(f'PyTorch: {torch.__version__}, CUDA: {torch.cuda.is_available()}')" 2>/dev/null)
echo "✓ $pytorch_check"

# Check 4: Models
echo ""
echo "[4/4] Checking models..."
models_size=$(docker exec galaxyquest-trellis2 du -sh /workspace/models 2>/dev/null | cut -f1)
if [ -n "$models_size" ]; then
    echo "✓ Models found: $models_size"
else
    echo "ℹ No models downloaded yet"
    echo "  To download: ./scripts/trellis2_docker.ps1 -Action models-download"
fi

echo ""
echo "================================"
echo "✅ Health check complete"
