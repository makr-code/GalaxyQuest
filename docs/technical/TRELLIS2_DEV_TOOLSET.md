# TRELLIS2 Dev Toolset (GalaxyQuest)

Dieses Setup ist bewusst als **Entwickler-Toolset** gedacht, nicht als Produktions-Pipeline.

## Ziel

- TRELLIS2 lokal im Projekt verlinken unter `tools/trellis2`
- Per CLI schnell 3D-Modelle fuer GQ erzeugen
- Per WebApp iterativ prompten und Assets exportieren

## 1) Repo lokal als Link einbinden

Empfohlen (Git Submodule):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1 -UseSubmodule
```

Alternativ als normaler Clone:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1
```

Update:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1 -Update
```

## 2) TRELLIS-Umgebung vorbereiten

Die Skripte erwarten standardmaessig eine Conda-Umgebung `trellis`.

- Standardaufruf nutzt: `conda run -n trellis python ...`
- Mit `-UseSystemPython` kann eine aktive Python-Umgebung genutzt werden.

Hinweis: TRELLIS ist primär fuer Linux + NVIDIA GPU getestet. Windows kann funktionieren, ist aber typischerweise aufwendiger in der Einrichtung.

## 3) CLI-Generierung fuer GQ

Text -> 3D (GLB + Preview):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_generate.ps1 \
  -Mode text \
  -Prompt "a modular hard-surface sci-fi cargo ship with armored hull"
```

Image -> 3D:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_generate.ps1 \
  -Mode image \
  -ImagePath "C:/path/to/concept.png" \
  -Prompt "industrial mining outpost"
```

Ausgabe standardmaessig:

- `generated/trellis2/*_text.glb` oder `*_image.glb`
- `generated/trellis2/*_preview.mp4`

## 4) WebApp starten

Image-conditioned WebApp (empfohlen):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_webapp.ps1 -Mode image -Port 7860
```

Text-conditioned WebApp:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_webapp.ps1 -Mode text -Port 7861
```

URLs:

- `http://127.0.0.1:7860` (Image -> 3D)
- `http://127.0.0.1:7861` (Text -> 3D)

## 5) VS Code Tasks

Es wurden folgende Tasks hinterlegt:

- `TRELLIS2: Link Repo (Submodule)`
- `TRELLIS2: Update Repo`
- `TRELLIS2: WebApp (Image->3D)`
- `TRELLIS2: WebApp (Text->3D)`
- `TRELLIS2: Generate Ship (Text CLI)`

## 6) Dev-Only Governance fuer GQ

Empfohlen fuer Team-Nutzung:

- Alle generierten Assets als **DEV_ONLY** kennzeichnen
- Uebernahme in Spiel-Content nur nach manueller Sichtung
- Keine Produktions-SLA auf Topologie/LOD/UV erwarten

So bleibt TRELLIS ein schnelles Entwickler-Werkzeug fuer Ideation, Prototyping und interne Tests.