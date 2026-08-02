# TRELLIS2 Docker Quick Start (mit CUDA GPU)

## 🚀 Schneller Start (5 Minuten)

### 1. Voraussetzungen prüfen

```powershell
# NVIDIA GPU vorhanden?
nvidia-smi

# Docker + NVIDIA Container Runtime OK?
docker run --rm --gpus all nvidia/cuda:12.4.1-runtime-ubuntu22.04 nvidia-smi
```

Falls Fehler: Siehe [TRELLIS2_DOCKER_CUDA_SETUP.md](TRELLIS2_DOCKER_CUDA_SETUP.md) Punkt 1.

### 2. TRELLIS2-Repo verlinken

```powershell
# Im GalaxyQuest-Verzeichnis:
./scripts/trellis2_link.ps1 -UseSubmodule
```

### 3. Container starten

```powershell
# Methode A: VS Code Task
# - Öffne Task Palette (Ctrl+Shift+P)
# - Suche: "TRELLIS2 Docker: Up (GPU)"
# - Enter

# Methode B: Kommandozeile
docker compose --profile ai-3d up -d trellis2
```

### 4. GPU-Zugang verifizieren

```powershell
./scripts/trellis2_docker.ps1 -Action gpu-check
```

Output sollte zeigen:
```
CUDA Available: True
CUDA Device: NVIDIA RTX 3060 (oder ähnlich)
```

### 5. Modelle herunterladen (erste Nutzung nur!)

```powershell
# Methode A: Task aus VS Code
# - Task Palette → "TRELLIS2 Docker: Download Models"

# Methode B: Kommandozeile
./scripts/trellis2_docker.ps1 -Action models-download

# Dauert ca. 10-15 Minuten + 15 GB Download
```

### 6. WebApp öffnen

Nach Container-Start:

- **Image→3D**: http://127.0.0.1:7862
- **Text→3D**: http://127.0.0.1:7863

Einfach Browser öffnen und ausprobieren! 🎨

## 📝 Häufige Aufgaben

### Logs anschauen
```powershell
./scripts/trellis2_docker.ps1 -Action logs
# Oder Ctrl+Shift+P → "TRELLIS2 Docker: Logs"
```

### Shell im Container öffnen
```powershell
./scripts/trellis2_docker.ps1 -Action shell
# Oder Ctrl+Shift+P → "TRELLIS2 Docker: Shell"
```

### Container neu starten
```powershell
docker compose restart trellis2
# Oder Ctrl+Shift+P → "Docker: Restart"
```

### Outputs importieren
Nach Generierung:
```powershell
./scripts/trellis2_import.ps1 \
  -SourceGlb "generated/trellis2/output_20250801.glb" \
  -AssetType "ship" \
  -Faction "terran" \
  -Variant "fighter"
```

Output → `generated/trellis2/imported/ship/`

## ⚠️ Troubleshooting

| Problem | Lösung |
|---------|--------|
| Container startet nicht | `./scripts/trellis2_docker.ps1 -Action gpu-check` |
| WebApp lädt nicht | `docker compose logs trellis2` → Fehler suchen |
| CUDA OOM (GPU out of memory) | `BATCH_SIZE` reduzieren oder niedrigere Auflösung |
| Modelle nicht gefunden | `./scripts/trellis2_docker.ps1 -Action models-download` |
| Port 7862 in use | `docker compose stop trellis2` + warten + retry |

## 📚 Weiterführend

- **Vollständiges Setup**: [TRELLIS2_DOCKER_CUDA_SETUP.md](TRELLIS2_DOCKER_CUDA_SETUP.md)
- **CLI Generierung**: [TRELLIS2_DEV_TOOLSET.md](TRELLIS2_DEV_TOOLSET.md)
- **Tests**: [TESTING_3D_GEOMETRY.md](../TESTING_3D_GEOMETRY.md)

## 🎯 Nächster Schritt

1. Container hochfahren (Punkt 3)
2. Mit WebApp experimentieren (Punkt 6)
3. Assets generieren + importieren (Aufgaben Sektion)
4. Tests mit echten Assets laufen lassen

Viel Spaß! 🚀
