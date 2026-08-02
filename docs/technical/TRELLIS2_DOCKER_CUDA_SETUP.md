# TRELLIS2 Docker Setup mit CUDA (GalaxyQuest)

Vollständiges Setup für lokale TRELLIS2-Entwicklung mit GPU-Unterstützung in Docker.

## Voraussetzungen

### Hardware
- **GPU**: NVIDIA mit mindestens 8 GB VRAM (RTX 3060 oder besser empfohlen)
- **RAM**: 32 GB System-RAM
- **Disk**: ~50 GB freier Speicher (für Modelle + Outputs)

### Software
- **Docker Desktop**: 4.10+ mit NVIDIA Container Runtime
- **Docker Compose**: 2.0+ (in Docker Desktop enthalten)
- **nvidia-docker**: Automatisch via Docker Desktop oder manuell installieren

## 1. NVIDIA Container Runtime aktivieren

### Windows (Docker Desktop)

```powershell
# In Docker Desktop Settings:
# - Gehe zu Settings → Resources → Advanced
# - Aktiviere "Use WSL 2 based engine"
# - Setze "Memory limit" auf mind. 24 GB
# - Starte Docker Desktop neu
```

Oder per CLI (WSL2):

```bash
# In WSL2 Terminal prüfen
nvidia-smi
```

### Linux (Ubuntu)

```bash
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt update && sudo apt install -y nvidia-docker2
sudo systemctl restart docker
```

## 2. TRELLIS2 Repository einbinden

```powershell
# Im GalaxyQuest Verzeichnis:
cd c:\Projects\GalaxyQuest

# TRELLIS2 als Git Submodule einbinden
git submodule add https://github.com/JeffreyXiang/TRELLIS.git tools/trellis2
git submodule update --init --recursive

# Oder via PowerShell-Script:
./scripts/trellis2_link.ps1 -UseSubmodule
```

## 3. Docker-Service starten

### Option A: Mit GPU + alle AI-Services

```powershell
docker compose --profile ai-full up -d trellis2
```

### Option B: Nur TRELLIS2

```powershell
docker compose up -d trellis2
```

### Option C: Verbose Output (Debugging)

```bash
docker compose up trellis2  # Ohne -d, sieht Logs in Echtzeit
```

## 4. Modelle herunterladen (erste Nutzung)

```bash
# In den laufenden Container gehen
docker exec -it galaxyquest-trellis2 bash

# Modelle lokal herunterladen (ca. 10-15 GB)
cd /workspace/trellis2
python scripts/download_model.py --model TRELLIS-image-large --output-dir ../models
python scripts/download_model.py --model TRELLIS-text-large --output-dir ../models

# Oder via Python-Script im Projekt:
python scripts/trellis2_download_models.py --models image-large --cache-dir tools/trellis2/models
```

## 5. WebApp nutzen

Nach Container-Start:

- **Image→3D**: http://127.0.0.1:7862
- **Text→3D**: http://127.0.0.1:7863

### Beispiel-Workflow

1. Image→3D-Seite öffnen (7862)
2. Concept-Art hochladen
3. Optional: Text-Prompt eingeben
4. "Generate" klicken
5. GLB + Preview-Video herunterladen
6. Output liegt in `generated/trellis2/`

## 6. CLI-Generierung

### Direkt im Container

```bash
docker exec -it galaxyquest-trellis2 bash

cd /workspace/trellis2
python scripts/inference.py \
  --input-image /workspace/generated/concept.png \
  --output-dir /workspace/generated/output \
  --device cuda:0
```

### Via Host-Script

```powershell
./scripts/trellis2_generate.ps1 -Mode image -ImagePath "C:\path\to\concept.png"
```

## 7. Logs & Debugging

```bash
# Logs sehen
docker compose logs trellis2 -f

# CUDA-Info prüfen
docker exec galaxyquest-trellis2 nvidia-smi

# Python-Imports prüfen
docker exec galaxyquest-trellis2 python -c "import torch; print(torch.cuda.is_available())"

# Modelle prüfen
docker exec galaxyquest-trellis2 ls -lh /workspace/models/
```

## 8. Container neustarten

```bash
# Stop
docker compose stop trellis2

# Start
docker compose up -d trellis2

# Rebuild (nach Dockerfile-Änderungen)
docker compose up -d --build trellis2
```

## 9. GPU-Speicher optimieren

Falls GPU-OOM-Fehler auftreten:

### Option A: Im docker-compose.yml

```yaml
trellis2:
  environment:
    CUDA_VISIBLE_DEVICES: 0              # Nur GPU 0 nutzen
    TORCH_CUDA_EMPTY_CACHE: 1
    TRELLIS_BATCH_SIZE: 1                # Kleinere Batches
    TRELLIS_MAX_RESOLUTION: 768          # Niedrigere Auflösung
```

### Option B: In der Python-Inference

```python
import torch
torch.cuda.empty_cache()

# Generierung mit reduzierten Settings
result = model.generate(
    image=input_image,
    max_steps=30,  # Weniger Diffusion Steps
    guidance_scale=5.0
)
```

## 10. Outputs in Spiel importieren

Nach Generierung:

```powershell
# GLB automatisch als Dev-Asset importieren
./scripts/trellis2_import.ps1 \
  -SourceGlb "generated/trellis2/output_20250801.glb" \
  -AssetType "ship" \
  -Faction "terran" \
  -Variant "fighter_001"

# Output in generated/trellis2/imported/ship/
```

## 11. Produktion: GPU-Sharing

Für mehrere Services (vLLM + TRELLIS2 + Stable Diffusion):

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          device_ids: ['0']        # GPU 0
          capabilities: [gpu]

        # Für Split:
        # - device_ids: ['0']      → vLLM
        # - device_ids: ['0']      → Stable Diffusion
        # - device_ids: ['1']      → TRELLIS2 (separate GPU)
```

## 12. Testing mit mocks

Tests verwenden bereits Mock-Klassen (keine GPU erforderlich):

```bash
npm run test:3d-geometry
```

## 13. Häufige Fehler

| Error | Lösung |
|-------|--------|
| `nvidia-smi: command not found` | NVIDIA Container Runtime nicht installiert |
| `CUDA out of memory` | BATCH_SIZE reduzieren, oder max_resolution senken |
| `Module not found: triton` | `pip install triton==2.3.0` in Container |
| `FileNotFoundError: models/` | `trellis2_download_models.py` ausführen |
| `Port 7862 already in use` | Anderen Service stoppen oder Port ändern |

## 14. Verwandte Dokumentation

- [TRELLIS2 Dev Toolset](../technical/TRELLIS2_DEV_TOOLSET.md)
- [3D Rendering System](../3D_RENDERING_SYSTEM_ANALYSIS.md)
- [Test Suite](../TESTING_3D_GEOMETRY.md)

## 15. Support & Performance

**Empfohlene GPU-Performance:**

| GPU | Model Fit | Speed |
|-----|-----------|-------|
| RTX 3060 (12GB) | TRELLIS-image-large | ~45s per generation |
| RTX 4070 (12GB) | TRELLIS-large | ~25s per generation |
| RTX 4090 (24GB) | TRELLIS-large + batch processing | ~10s per generation |

**Nächste Schritte:**

1. ✅ Docker-Setup (dieses Dokument)
2. ⏳ Real-API Integration in Tests
3. ⏳ CI/CD mit GPU-Runner
4. ⏳ Asset-Qualitäts-Pipeline
