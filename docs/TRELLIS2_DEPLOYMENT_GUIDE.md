# TRELLIS2 Docker Deployment Guide

**Status**: ✅ Service Running  
**Container**: galaxyquest-trellis2 (Active)  
**Date**: 2026-08-02  
**Version**: 1.0 (Production Ready)

---

## 🚀 Quick Start

### Local Machine (Windows/Mac/Linux)

#### 1. Start Service (30 seconds)
```powershell
# Windows PowerShell
cd c:\Projects\GalaxyQuest
docker compose --profile ai-3d up trellis2 -d

# Or use Task in VS Code
# Ctrl+Shift+P → "TRELLIS2 Docker: Up (GPU)"
```

#### 2. Verify Running (10 seconds)
```bash
docker compose ps
# Expected: trellis2 ... Up ... 7862:7862
```

#### 3. Access WebApp (immediate)
```
🌐 Image-to-3D: http://localhost:7862
🌐 Text-to-3D:  http://localhost:7863 (alternative port)
```

#### 4. Download Models (First Time Only - ~20 min)
```bash
docker compose exec trellis2 bash -c \
  'python -c "from transformers import AutoModel; AutoModel.from_pretrained(\"JeffreyXiang/TRELLIS-image-large\", trust_remote_code=True)"'

# Models cached in: generated/trellis2/models/
# Next start: no re-download needed
```

#### 5. Stop Service
```bash
docker compose down trellis2
# or: docker compose kill trellis2
```

---

## 🌐 Remote Machine Deployment

### Prerequisites
```bash
# On remote host:
docker version      # ✓ Must exist
docker compose version  # ✓ Version 2.0+
docker run --gpus all nvidia-smi  # ✓ NVIDIA runtime configured
```

### Option A: Full Repository Deployment

**Best for**: Clean installations, production servers

```bash
# Step 1: Clone repo on remote
ssh user@remote
git clone https://github.com/makr-code/GalaxyQuest.git
cd GalaxyQuest
git checkout develop

# Step 2: Build or pull image
docker build -f docker/trellis2/Dockerfile -t galaxyquest-trellis2:latest .
# OR: docker pull your-registry/galaxyquest-trellis2:latest

# Step 3: Create directories
mkdir -p generated/trellis2/{image2text,text2image,logs,imported}
chmod 777 generated/trellis2

# Step 4: Start service
docker compose --profile ai-3d up trellis2 -d

# Step 5: Verify
docker compose ps
curl http://localhost:7862/health

# Step 6: Download models (optional, auto-triggers on use)
docker compose exec trellis2 bash -c \
  'python -c "from transformers import AutoModel; AutoModel.from_pretrained(\"JeffreyXiang/TRELLIS-image-large\", trust_remote_code=True)"'
```

### Option B: Docker Image Transfer (No Clone)

**Best for**: Air-gapped networks, quick migration

#### On Local Machine
```bash
# 1. Export Docker image
docker save galaxyquest-trellis2:latest | gzip > trellis2.tar.gz
# Result: ~5 GB compressed file

# 2. Upload to remote
scp trellis2.tar.gz user@remote:/tmp/

# 3. Upload docker-compose files
scp docker-compose.yml user@remote:/path/to/GalaxyQuest/
scp .env.trellis2 user@remote:/path/to/GalaxyQuest/
```

#### On Remote Machine
```bash
# 1. Import image
gunzip -c /tmp/trellis2.tar.gz | docker load
# Result: galaxyquest-trellis2:latest loaded

# 2. Create directories
mkdir -p generated/trellis2/{image2text,text2image,logs}

# 3. Start service
cd /path/to/GalaxyQuest
docker compose -f docker-compose.yml up trellis2 -d

# 4. Verify
docker compose ps
```

### Option C: Minimal Automated Deployment

**Best for**: CI/CD pipelines

```bash
#!/bin/bash
# Deploy TRELLIS2 to remote host

set -e

TARGET_HOST="user@deploy.example.com"
GQ_PATH="/opt/galaxyquest"

# 1. SSH into host and pull latest
ssh $TARGET_HOST << 'EOF'
  cd $GQ_PATH
  git fetch origin develop
  git reset --hard origin/develop
EOF

# 2. Build image on remote
ssh $TARGET_HOST << 'EOF'
  docker build -f $GQ_PATH/docker/trellis2/Dockerfile \
    -t galaxyquest-trellis2:latest $GQ_PATH
EOF

# 3. Start service
ssh $TARGET_HOST << 'EOF'
  cd $GQ_PATH
  docker compose --profile ai-3d up trellis2 -d
EOF

# 4. Verify health
sleep 30
curl http://$TARGET_HOST:7862/health || echo "Health check failed"
```

---

## 📊 Environment Configuration

### .env.trellis2 (Copy to project root)

```bash
# GPU Setup
CUDA_VISIBLE_DEVICES=0          # Single GPU (0 = first GPU)
CUDA_DEVICE_ORDER=PCI_BUS_ID    # Order by physical slot
CUDA_LAUNCH_BLOCKING=0          # Enable async GPU execution

# Model Caching (inside container)
TORCH_HOME=/workspace/models/torch
HF_HOME=/workspace/models/huggingface
HF_DATASETS_CACHE=/workspace/models/datasets

# Gradio Server
GRADIO_SERVER_NAME=0.0.0.0      # Listen on all IPs
GRADIO_SERVER_PORT=7862         # Image-to-3D
GRADIO_ENABLE_QUEUE=true        # Enable request queue
GRADIO_SHARE=false              # Disable public link

# TRELLIS2 Configuration
TRELLIS_MODEL=TRELLIS-large     # Model variant
TRELLIS_MODE=both               # text/image/both
HF_HUB_DISABLE_TELEMETRY=1      # Disable telemetry
```

### For Multi-GPU Setup

```bash
# Use all GPUs
CUDA_VISIBLE_DEVICES=0,1,2,3
CUDA_DEVICE_ORDER=PCI_BUS_ID

# Or specific GPUs
CUDA_VISIBLE_DEVICES=0,2        # Use GPU 0 and 2 only
```

---

## 🔍 Monitoring & Logs

### View Logs (Real-Time)
```bash
docker compose logs -f trellis2

# Last 100 lines
docker compose logs --tail=100 trellis2

# Specific time range (last 5 minutes)
docker compose logs --since 5m trellis2
```

### Health Check
```bash
# TRELLIS2 health endpoint
curl http://localhost:7862/health

# Expected response:
# {
#   "status": "healthy",
#   "device": "cuda",
#   "cuda_available": true,
#   "gpu": "NVIDIA GeForce RTX 3060"
# }
```

### Monitor Event Logs
```bash
# View generated event logs
docker compose exec trellis2 tail -f /workspace/generated/logs/gradio_events.jsonl

# Sample entry:
# {"timestamp": "2026-08-02T10:15:23.456789", "event_type": "text_to_3d_start", ...}
```

### Container Stats
```bash
# GPU/Memory usage
docker stats galaxyquest-trellis2

# One-time snapshot
docker compose exec trellis2 nvidia-smi
```

---

## 📦 Storage Management

### Disk Usage
```bash
# Check Docker image sizes
docker image ls galaxyquest-trellis2

# Check volume sizes
docker volume ls
du -sh ./generated/trellis2/

# Cleanup old assets
docker compose exec trellis2 rm -rf /workspace/generated/*.glb
```

### Model Cache Location

| Component | Path | Size |
|-----------|------|------|
| PyTorch cache | `/workspace/models/torch` | ~2 GB |
| HuggingFace cache | `/workspace/models/huggingface` | ~10 GB |
| Dataset cache | `/workspace/models/datasets` | Variable |
| Generated assets | `/workspace/generated` | 1-100 GB |

### Persistent Volume Management
```bash
# Inspect volume
docker volume inspect galaxyquest-trellis2_trellis2-models

# Remove volume (deletes cached models!)
docker volume rm galaxyquest-trellis2_trellis2-models
```

---

## 🐛 Troubleshooting

### Service Won't Start

```bash
# 1. Check logs
docker compose logs trellis2

# 2. Verify Docker image exists
docker image ls | grep trellis2

# 3. Check for port conflicts
netstat -an | grep 7862  # Windows: netstat -ano

# 4. Restart Docker daemon
# Windows: Restart Docker Desktop
# Linux: sudo systemctl restart docker
```

### GPU Not Detected

```bash
# 1. Verify NVIDIA runtime installed
docker run --rm --gpus all ubuntu nvidia-smi

# 2. Check CUDA availability in container
docker compose exec trellis2 nvidia-smi

# 3. Force CPU mode (slower)
CUDA_VISIBLE_DEVICES=-1 docker compose up trellis2 -d
```

### Out of Memory

```bash
# Check memory
docker stats galaxyquest-trellis2

# Reduce model batch size
docker compose exec trellis2 bash -c \
  'export TORCH_BATCH_SIZE=1; python gradio_app.py'

# Use smaller model
docker compose exec trellis2 bash -c \
  'export TRELLIS_MODEL=TRELLIS-text-base; python gradio_app.py'
```

### Slow Generation

```bash
# Check GPU utilization
nvidia-smi dmon  # On host with GPU

# Check if running on CPU instead
docker compose logs trellis2 | grep -i "device: cpu"

# Optimize for your hardware
docker compose exec trellis2 bash -c \
  'export TORCH_NUM_THREADS=4; export TORCH_NUM_INTEROP_THREADS=1; python gradio_app.py'
```

---

## 🔐 Security Considerations

### Network Access

```bash
# Restrict to localhost only (don't expose to internet)
# In docker-compose.yml:
ports:
  - "127.0.0.1:7862:7862"  # Localhost only
```

### Authentication (Optional)

```bash
# Add basic auth with nginx reverse proxy
# Or use: GRADIO_AUTH=username:password
docker compose exec trellis2 bash -c \
  'GRADIO_AUTH=admin:secretpass python gradio_app.py'
```

### Data Security

```bash
# Backup generated models
docker volume create backup
docker run --rm -v galaxyquest-trellis2_trellis2-models:/data \
  -v backup:/backup busybox \
  tar czf /backup/models.tar.gz /data

# Encrypt sensitive data
chmod 700 ./generated/trellis2/models
```

---

## 📈 Performance Tuning

### For Slow GPUs (RTX 3060, etc.)

```bash
# Reduce generation quality/speed tradeoff
docker compose exec trellis2 bash -c \
  'export TRELLIS_MAX_STEPS=20; python gradio_app.py'

# Use smaller model variant
export TRELLIS_MODEL=TRELLIS-text-base
```

### For Fast GPUs (A100, RTX 4090, etc.)

```bash
# Increase batch size
export TORCH_BATCH_SIZE=8

# Use full resolution
export TRELLIS_RESOLUTION=1024
```

### Memory Optimization

```bash
# Enable gradient checkpointing
export GRADIENT_CHECKPOINTING=1

# Reduce precision to float16
export TORCH_DTYPE=float16
```

---

## 🔄 Updating

### Update to Latest Code

```bash
cd /path/to/GalaxyQuest
git fetch origin develop
git reset --hard origin/develop

# Rebuild image
docker compose build trellis2 --no-cache
docker compose up trellis2 -d
```

### Keep Models Cached

```bash
# Models persist in volume, no re-download needed
docker compose up trellis2 -d

# Force model refresh (slow!)
docker volume rm galaxyquest-trellis2_trellis2-models
docker compose up trellis2 -d
```

---

## ✅ Deployment Checklist

- [ ] Docker & Docker Compose installed on target host
- [ ] NVIDIA Docker runtime configured (if using GPU)
- [ ] 50+ GB free disk space for models & outputs
- [ ] Port 7862-7863 available (or remapped)
- [ ] Network connectivity to HuggingFace (for model downloads)
- [ ] GPU has 4+ GB VRAM (8+ GB recommended)

---

## 📞 Support

### Common Questions

**Q: Why does first startup take 30 minutes?**  
A: Models download from HuggingFace (~10-15 GB) on first use. Cached thereafter.

**Q: Can I run multiple instances?**  
A: Yes, set different ports: `GRADIO_SERVER_PORT=7862` for first, `7863` for second.

**Q: Is GPU required?**  
A: No, CPU fallback automatic but ~5-10x slower.

**Q: How to integrate with game backend?**  
A: Generated GLB files available in `./generated/trellis2/image2text/` or `text2image/`

---

## 📚 Files Reference

| File | Purpose |
|------|---------|
| `docker/trellis2/Dockerfile` | Container image definition |
| `docker-compose.yml` | Service orchestration |
| `.env.trellis2` | Environment configuration |
| `tools/trellis2/gradio_app.py` | WebApp entry point |
| `scripts/trellis2_deploy_remote.ps1` | Deployment automation |
| `generated/trellis2/` | Output directory |

---

**✅ Deployment Guide Complete**  
**🚀 Ready for Production**  
**📞 Questions? See Troubleshooting section above**
