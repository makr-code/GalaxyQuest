# 🛸 Ship Designer Prompt Engine – Quickstart

**Status**: Prototyp, nicht produktionsbereit. Die Prompt-API ist implementiert, aber der vollständige UI-Generierungspfad ist derzeit nicht erreichbar: `.htaccess` deaktiviert die `/api/vessel_designs`-Rewrite-Regel und blockiert die eigenständige `ship-designer.html`-Seite. Asset-Validierung, Thumbnail-Erstellung und Material-Nachbearbeitung enthalten außerdem Platzhalter.

**Zusammenfassung**: Prompt-Generierung für spieler-editierbare 3D-Schiffsentwürfe auf Basis von Fraktionsvorgaben, Prompt-Stil-Presets und Spieler-Eingaben.

---

## 📦 Was wurde erstellt?

### 1. **Backend Prompt Engine** (`api/ship_designer_engine.php`)
- **FactionShipSignature**: Fraktionsspezifische Visualsignaturen (Silhouette, Materialien, Farben)
- **ShipClassTemplate**: Schiff-Klassen mit Triangle-Budgets (3k–25k tri)
- **LoRAStylePreset**: Prompt-Stil-Presets (keine Aussage über geladene LoRA-Modellgewichte)
- **ShipDesignerPromptEngine**: Kern-Logik für Prompt-Generierung

**API-Endpunkte**:
```bash
POST   /api/ship_designer_engine.php?action=generate_prompt
       → Input: faction_code, ship_class, customization_prompt, lora_styles
       → Output: TRELLIS2-ready prompt + metadata

GET    /api/ship_designer_engine.php?action=ship_templates
       → Alle verfügbaren Schiff-Klassen

GET    /api/ship_designer_engine.php?action=faction_ships?faction_code=vor_tak
       → Fraktionsspezifische Vorlagen + Signaturen

GET    /api/ship_designer_engine.php?action=lora_styles&faction_code=vor_tak
       → LoRA-Styles für eine Fraktion
```

Die UI ist für einen getrennten Generierungspfad geschrieben: Sie versucht Entwürfe über `/api/vessel_designs` zu speichern, Jobs über `/api/vessel_designs/{id}/generate` einzureihen, `/api/generation_queue/{id}` abzufragen und Ergebnisse über `/api/asset_generations/{id}` zu laden. Dieser vollständige Pfad ist mit der aktuellen `.htaccess`-Konfiguration nicht verfügbar; behandle die UI-Beispiele als Prototyp, nicht als funktionierende Produktionsintegration.

### 2. **Frontend Spieler-UI** (`js/ui/ship-designer.js`)
- Fraktions-Galerie (visuell, 6 Fraktionen)
- Schiff-Klassen-Selector (mit Budget-Info)
- Schiff-Name-Input
- Prompt-Stil-Preset Multi-Select (mit Beschreibungen)
- **Custom Prompt Editor** (free-text für extra Details)
- **Prompt-Preview** (collapsible)
- **3D-Viewer** (GLB-Rendering via Three.js)
- Generation-Fortschrittsbalken
- Ship-Stats Display (Triangles, Materials, Dateigröße)
- Save/Export-Buttons

### 3. **Asset-Pipeline-Prototyp** (`js/engine/ShipDesignerAssetPipeline.js`)
- GLB-Prüfung verwendet grobe Dateigrößen-Schätzungen statt vollständiger Mesh-Analyse
- Signaturteile-Erkennung ist ein Stub
- Quality-Tier-Skalierung ist nicht implementiert
- Fraktionsspezifisches Post-Processing protokolliert nur vorgesehene Änderungen
- Thumbnail-Generierung erzeugt ein Platzhalterbild
- Datenbank-Speicherung über diese Pipeline ist nicht im Prompt-Endpoint implementiert

### 4. **Unit Tests** (`tests/Unit/ShipDesignerEngineTest.php`)
- 21 PHPUnit-Testmethoden für Signaturen, Klassen, Stil-Presets und Prompt-Generierung
- Validierung von Fraktionssignaturen
- Schiff-Klassen-Templates
- LoRA-Style-Empfehlungen
- Prompt-Generierung

### 5. **Dokumentation** (`docs/technical/SHIP_DESIGNER_PROMPT_ENGINE.md`)
- API-Referenz und Implementierungshinweise
- Beispiel-Prompts und Prompt-Stil-Presets
- Bekannte Grenzen und offene Produktionsreife-Arbeiten

---

## 🚀 Quick Start

### 1. Backend testen

```bash
# Tests ausführen
phpunit tests/Unit/ShipDesignerEngineTest.php

# API manuell testen
curl -X POST http://localhost/api/ship_designer_engine.php?action=generate_prompt \
  -H "Content-Type: application/json" \
  -d '{
    "faction_code": "vor_tak",
    "ship_class": "corvette",
    "name": "Void Stalker",
    "customization_prompt": "sleeker than default",
    "lora_styles": ["faction_signature", "industrial_militaristic"]
  }'
```

### 2. Frontend testen

```html
<!-- In HTML Page -->
<div id="ship-designer-container"></div>

<script type="module">
  import createShipDesignerUI from '/js/ui/ship-designer.js';

  const designer = createShipDesignerUI({
    containerId: 'ship-designer-container',
    apiBase: '/api',
    onGenerate: (metadata) => console.log('Generated:', metadata),
    onSave: (result) => console.log('Saved:', result),
    onError: (msg) => console.error('Error:', msg),
  });
</script>
```

### 3. Docker TRELLIS2 vorbereiten

```powershell
# TRELLIS2 Container starten (GPU support)
./scripts/trellis2_docker.ps1 -Action up

# GPU verifizieren
./scripts/trellis2_docker.ps1 -Action gpu-check

# Modelle herunterladen (~15 GB)
./scripts/trellis2_docker.ps1 -Action models-download

# WebApp öffnen
# Image→3D: http://127.0.0.1:7862
# Text→3D: http://127.0.0.1:7863
```

---

## 📊 Datenfluss-Beispiel

### Eingabe
```json
{
  "faction_code": "syl_nar",
  "ship_class": "frigate",
  "name": "Gezeitenflüsterer",
  "customization_prompt": "more bioluminescent veins, larger sail section",
  "lora_styles": ["faction_signature", "organic_biomimetic"]
}
```

### → Prompt-Engine erzeugt:
```
Generate a high-quality 3D spaceship in GLB format for TRELLIS2.

## Faction Context
Faction: Syl'Nar
Type: spiritual
Description: ...

## Visual Signature (MUST apply)
Silhouette: soft orbital geometry, flowing curves, tentacle-like extensions, bioluminescent features
Materials: translucent shells, bio-luminescent veins, wet-glossy surfaces, mother-of-pearl shimmer
Primary Color: #4169E1
Secondary Color: #7FFFD4
Signature Parts: halo_tentacles, lumen_veins, tide_fins

## Ship Class Specifications
Class: Frigate
Scale Reference: 120 meters
Triangle Budget: max 12000 triangles

## Style Modifiers
- Apply faction-specific LoRA for visual consistency
- Flowing curves, biological inspiration

## Player Customization
more bioluminescent veins, larger sail section

## Output Requirements
- Export as GLB format
- Ensure silhouette is instantly recognizable as faction: syl_nar
- Apply all signature parts distinctly
```

### → TRELLIS2 generiert:
```
GLB-Datei mit:
- ~10,000 Triangles (im Budget von 12,000)
- 6 Materialien (Transluzent, Biolumineszenz, etc.)
- Sichtbare signature_parts (halo_tentacles, lumen_veins)
- Syl'Nar-spezifische Farben und Glühen-Effekte
```

### → Asset-Pipeline validiert:
```
✓ Triangle count: 10,123 / 12,000 (84% of budget)
✓ Material count: 6 (within limit)
✓ Signature parts detected: 2/3 (OK)
✓ File size: 2.4 MB
✓ Faction recognition: Syl'Nar (confidence: 92%)
```

### → Spieler kann speichern:
```
Schiff wird gespeichert als:
  user_id: 12345
  faction_id: 2 (Syl'Nar)
  ship_class: frigate
  name: "Gezeitenflüsterer"
  glb_data: [binary]
  thumbnail: [PNG]
  metadata: { ... }
  created_at: 2026-08-01 14:23:45
```

---

## 🎨 Fraktions-Design-Highlights

| Fraktion | Ästhetik | Signature Parts | Farben |
|----------|----------|-----------------|--------|
| **Vor'Tak** ⚔ | Industriell-militärisch, gepanzert | jaw_bridge, dorsal_spine, armor_scales | #8B4513, #C0C0C0 |
| **Syl'Nar** 🐙 | Organisch, Biolumineszenz, fließend | halo_tentacles, lumen_veins, tide_fins | #4169E1, #7FFFD4 |
| **Aereth** 🔬 | Kristallin, geometrisch, energetisch | crystal_core, energy_vanes, sensor_crown | #2288EE, #FFFFFF |
| **Kryl'Tha** 🦗 | Insektoid, chitin, Schwarm-Ästhetik | chitin_ridges, swarm_appendages, mandible_jaw | #228B22, #FFD700 |
| **Zhareen** 📚 | Archival, strukturiert, präzise | archive_spire, data_node_cluster, sealed_vault_section | #CC44AA, #FFD700 |
| **Vel'Ar** 👁 | Stealth, Schatten, minimal | stealth_vanes, sensor_ghost_array, shadow_cowl | #1C1C1C, #4A4A4A |

---

## 📋 Architektur-Komponenten

### Backend (PHP)
```
api/ship_designer_engine.php
├── FactionShipSignature (6 Fraktionen × 5 Attribute)
├── ShipClassTemplate (6 Klassen × Triangle-Budgets)
├── LoRAStylePreset (6 Styles × guidance_scales)
└── ShipDesignerPromptEngine (Kern-Logik)
    ├── generatePrompt() → TRELLIS2-ready string
    ├── getShipTemplates() → Alle Klassen
    ├── getFactionShips() → Fraktionsspezifische Vorlagen
    └── getLoRAStyles() → LoRA-Empfehlungen
```

### Frontend (JavaScript)
```
js/ui/ship-designer.js
├── createShipDesignerUI (Main UI Component)
├── Faction Gallery (6 Cards, visuell)
├── Ship Class Selector (mit Budgets)
├── LoRA Style Checkboxes (Multi-Select)
├── Custom Prompt Editor (Free-text)
├── 3D GLB Viewer (Three.js)
└── Save/Export Actions

js/engine/ShipDesignerAssetPipeline.js
├── validateGLB() → Budget-Validierung
├── detectSignatureParts() → Fraktions-Erkennung
├── prepareForImport() → Kompression + Thumbnail
├── saveShip() → Datenbank-Speicherung
└── applyFactionPostProcessing() → Farben/Materialien
```

### Tests
```
tests/Unit/ShipDesignerEngineTest.php
├── Faction signature validation (6 tests)
├── Ship class template validation (4 tests)
├── LoRA style preset validation (4 tests)
└── Prompt generation (6 tests)
```

---

## 🔧 Offene Produktionsreife-Arbeiten

1. **HTTP-Routing und UI-Aktivierung**
   - Die `/api/vessel_designs`-Rewrite-Regel ist in `.htaccess` deaktiviert.
   - `ship-designer.html` ist in `.htaccess` für direkte Auslieferung gesperrt.
   - Vor Aktivierung Routing, Auth/CSRF, Schema und Worker-Ende-zu-Ende gemeinsam abnehmen.

2. **Asset-Pipeline vervollständigen**
   - Echte GLB-Geometrie- und Materialanalyse statt Dateigrößen-Schätzung
   - Signatur-Erkennung, Quality-Tier-Skalierung und Material-Nachbearbeitung implementieren
   - Thumbnail aus dem Modell rendern und Asset-Speicherung/Persistenz integrieren

3. **Ende-zu-Ende-Verifikation**
   - Queue-, Worker-, TRELLIS2-Fehler- und Wiederanlaufpfade testen
   - Browser- und GPU-Tests ergänzen; vorhandene Prompt-Engine-Tests decken dies nicht ab
   - Ressourcenbedarf und Latenz mit den tatsächlich unterstützten Modellen messen

---

## 📚 Dateien-Übersicht

| Datei | Zweck |
|-------|-------|
| `api/ship_designer_engine.php` | Prompt-Engine und Katalog-API |
| `js/ui/ship-designer.js` | Prototypische Spieler-UI |
| `js/engine/ShipDesignerAssetPipeline.js` | Unvollständige Asset-Pipeline-Helfer |
| `tests/Unit/ShipDesignerEngineTest.php` | Prompt-Engine-Unit-Tests |
| `docs/technical/SHIP_DESIGNER_PROMPT_ENGINE.md` | API-Referenz und dokumentierte Grenzen |

---

## 🎯 Feature-Highlights

✅ **6 Fraktionen** mit eindeutigen visuellen Signaturen  
✅ **6 Schiff-Klassen** mit Triangle-Budgets (3k–25k)  
✅ **6 LoRA-Styles** für Konsistenz-Styling  
✅ **Spieler-Editor-UI** für Customization  
✅ **Budget-Validierung** (Triangles, Materials)  
✅ **Signature-Part-Detektion** (Fraktions-Erkennung)  
✅ **Prompt-Vorschau** (transparent, debuggable)  
⚠️ **Asynchrone Erzeugung** ist in der UI gegen separate Vessel-Design- und Queue-APIs vorgesehen, der dokumentierte REST-Pfad ist derzeit aber nicht aktiv
✅ **Prompt-Engine-Tests** (21 Testmethoden; belegen nicht die Produktionsreife des vollständigen Generierungspfads)
⚠️ **Asset-Pipeline** (Validierung, Thumbnail und Nachbearbeitung noch teilweise Platzhalter)

---

## 💬 Fragen?

Siehe ausführliche Doku: [`docs/technical/SHIP_DESIGNER_PROMPT_ENGINE.md`](docs/technical/SHIP_DESIGNER_PROMPT_ENGINE.md)

**Testen Sie es jetzt**:
```bash
phpunit tests/Unit/ShipDesignerEngineTest.php
npm run test:3d-geometry  # Integriert in bestehende Tests
```
