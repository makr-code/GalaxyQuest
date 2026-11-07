# Ship Designer Prompt Engine – Spieler-Editierbare 3D-Schiffe

**Status**: Prototypische Prompt- und Designer-Integration, keine Produktionsfreigabe. Die Prompt-API ist von den Vessel-Design-/Generation-APIs getrennt; die Asset-Pipeline enthält noch Platzhalter für Analyse und Nachbearbeitung.

**Überblick**: Die Prompt-API erzeugt aus Fraktionsvorgaben, Prompt-Stil-Presets und Spieler-Eingaben Prompts für den separaten Text-to-3D-Generierungspfad.

---

## 🏗 Architektur

```
Spieler-UI (ship-designer.js)
  ↓
Prompt-Engine (ship_designer_engine.php)
  ├── FactionShipSignature: Fraktionsspezifisches visuelles Design
  ├── ShipClassTemplate: Geometrie- & Performance-Budgets
  ├── LoRAStylePreset: Prompt-Stil-Presets (keine Modellgewichte)
  └── ShipDesignerPromptEngine: Prompt-Generierung
  ↓
Vessel-Design-/Generation-APIs (von der UI aufgerufen, REST-Route aktuell deaktiviert)
  ├── /api/vessel_designs
  ├── /api/vessel_designs/{id}/generate
  ├── /api/generation_queue/{id}
  └── /api/asset_generations/{id}
  ↓
TRELLIS2 Worker / Generator
  ↓
GLB-Asset (separate Asset-Pipeline-Helfer sind noch nicht vollständig integriert)
```

---

## 🎨 Fraktions-Visuelles Design

Jede Fraktion hat **fünf bindende visuelle Signaturen**:

| Fraktion | Silhouette | Materialien | Signaturbauteile | Farben | LoRA-Style |
|----------|-----------|-----------|----------------|--------|-----------|
| **Vor'Tak** | Keilförmig, gepanzert, frontlastig | Dunkle Metalle, Knochenplatten, Bronze-Akzente | `jaw_bridge`, `dorsal_spine`, `armor_scales` | #8B4513 (Dunkelbraun), #C0C0C0 (Silber) | `vor_tak_industrial_militaristic` |
| **Syl'Nar** | Fließend, orbital, Tentakel-Ausläufer | Transluzent, Biolumineszenz, nass-glänzend | `halo_tentacles`, `lumen_veins`, `tide_fins` | #4169E1 (Royal Blau), #7FFFD4 (Aquamarin) | `syl_nar_organic_bioluminescent` |
| **Aereth** | Schlank, kristallin, eckig, präzise | Polierte Kristallstrukturen, Energie-Adern | `crystal_core`, `energy_vanes`, `sensor_crown` | #2288EE (Hellblau), #FFFFFF (Weiß) | `aereth_crystalline_scientific` |
| **Kryl'Tha** | Insektoid, chitin, segmentiert | Bio-metallisch, organische Panzer, glänzend | `chitin_ridges`, `swarm_appendages`, `mandible_jaw` | #228B22 (Waldgrün), #FFD700 (Gold) | `kryl_tha_insectoid_organic` |
| **Zhareen** | Geometrisch, strukturiert, archival | Poliert mit Gravuren, Daten-Platten, Bernstein-Knoten | `archive_spire`, `data_node_cluster`, `sealed_vault_section` | #CC44AA (Magenta), #FFD700 (Gold) | `zhareen_archival_geometric` |
| **Vel'Ar** | Schatten-ähnlich, eckig, minimal | Radar-absorbierende Matte-Schwarz, Stealth-Facetten | `stealth_vanes`, `sensor_ghost_array`, `shadow_cowl` | #1C1C1C (Schwarz), #4A4A4A (Grau) | `vel_ar_stealth_espionage` |

---

## 📦 Schiff-Klassen & Performance-Budgets

| Klasse | Größe (m) | Triangle-Budget | Beschreibung | Rolle |
|--------|-----------|-----------------|-------------|-------|
| **Fighter** | 20 | 3,000 | Einzelpilot-Kampfschiff | Agiler Abfangjäger |
| **Corvette** | 60 | 8,000 | Leichte Patrouille/Schlag | Schnelle Patrouille & Angriff |
| **Frigate** | 120 | 12,000 | Mittlere Eskorte/Erkundung | Erkundung & mittlerer Kampf |
| **Destroyer** | 180 | 18,000 | Schweres Kampfschiff | Dominante Feuerkraft |
| **Freighter** | 150 | 15,000 | Frachttransporter | Maximale Frachtkapazität |
| **Capital** | 300 | 25,000 | Flaggschiff | Flotten-Kommandozentrale |

---

## 🎛 LoRA-Style-Presets

**Zweck**: Konsistenz über mehrere Generierungen hinweg + Spieler-Kontrolle über Ästhetik

### Verfügbare Presets

```javascript
{
  "faction_signature": {
    "name": "Faction Signature Style",
    "description": "Apply faction-specific LoRA for visual consistency",
    "enabled_by_default": true,
    "guidance_scale": 7.5,
    "affects": ["silhouette", "materials", "color_palette", "signature_parts"]
  },
  "industrial_militaristic": {
    "name": "Industrial Militaristic",
    "description": "Heavy armor plating, angular geometry, weapons-focused",
    "guidance_scale": 6.0,
    "faction_optimized_for": ["vor_tak"]
  },
  "organic_biomimetic": {
    "name": "Organic Biomimetic",
    "description": "Flowing curves, biological inspiration",
    "guidance_scale": 7.0,
    "faction_optimized_for": ["syl_nar", "kryl_tha"]
  },
  "crystalline_geometric": {
    "name": "Crystalline Geometric",
    "description": "Sharp angles, crystalline structures",
    "guidance_scale": 6.5,
    "faction_optimized_for": ["aereth"]
  },
  "stealth_angular": {
    "name": "Stealth Angular",
    "description": "Radar-absorbing geometry, minimal profile",
    "guidance_scale": 7.0,
    "faction_optimized_for": ["vel_ar"]
  },
  "archival_geometric": {
    "name": "Archival Geometric",
    "description": "Information storage emphasis, precise geometry",
    "guidance_scale": 6.0,
    "faction_optimized_for": ["zhareen"]
  }
}
```

---

## 💻 API-Referenz

### `POST /api/ship_designer_engine.php?action=generate_prompt`

Generiert einen TRELLIS2-ready Prompt aus Fraktions- und Spieler-Vorgaben.

**Request**:
```json
{
  "faction_code": "vor_tak",
  "ship_class": "corvette",
  "name": "Vor'Tak Klingenfang",
  "customization_prompt": "sleeker than default, with more visible weapon ports",
  "lora_styles": ["faction_signature", "industrial_militaristic"]
}
```

**Response**:
```json
{
  "prompt": "Generate a high-quality 3D spaceship in GLB format for TRELLIS2.\n\n## Faction Context\nFaction: Vor'Tak\n...\n[Full multi-section prompt]",
  "metadata": {
    "faction_code": "vor_tak",
    "faction_name": "Vor'Tak",
    "ship_class": "corvette",
    "ship_name": "Vor'Tak Klingenfang",
    "scale_reference": 60,
    "tri_budget": 8000,
    "lora_styles": ["faction_signature", "industrial_militaristic"],
    "signature_parts": ["jaw_bridge", "dorsal_spine", "armor_scales"],
    "generated_at": "2026-08-01T14:23:45Z"
  }
}
```

### `GET /api/ship_designer_engine.php?action=ship_templates`

Alle verfügbaren Schiff-Klassen + Budgets.

**Response**:
```json
{
  "templates": {
    "fighter": { "title": "Fighter", "scale_unit": 20, "tri_budget": 3000, ... },
    "corvette": { "title": "Corvette", "scale_unit": 60, "tri_budget": 8000, ... },
    ...
  }
}
```

### `GET /api/ship_designer_engine.php?action=faction_ships?faction_code=vor_tak`

Fraktionsspezifische Vorlagen + visuelle Signaturen.

**Response**:
```json
{
  "faction": {
    "code": "vor_tak",
    "name": "Vor'Tak",
    "type": "military"
  },
  "signature": {
    "silhouette": "wedge-based, heavily armored, front-heavy, ...",
    "materials": "dark industrial metals, bone-colored plating, ...",
    "signature_parts": ["jaw_bridge", "dorsal_spine", "armor_scales"],
    "color_primary": "#8B4513",
    "color_secondary": "#C0C0C0",
    "lora_style": "vor_tak_industrial_militaristic",
    "motifs": ["jagged", "layered_armor", "forward_aggressive", ...]
  },
  "available_classes": ["fighter", "corvette", "frigate", "destroyer", "freighter", "capital"],
  "templates": { ... }
}
```

### `GET /api/ship_designer_engine.php?action=lora_styles&faction_code=vor_tak`

LoRA-Styles für eine Fraktion (mit Empfehlungen).

**Response**:
```json
{
  "styles": {
    "faction_signature": { "name": "Faction Signature Style", "enabled_by_default": true, ... },
    "industrial_militaristic": { "name": "Industrial Militaristic", "enabled_by_default": false, ... }
  }
}
```

---

## 🎮 Spieler-UI Integration

### Beispiel: HTML-Integration

```html
<div id="ship-designer-container"></div>

<script type="module">
  import createShipDesignerUI from '/js/ui/ship-designer.js';

  const designer = createShipDesignerUI({
    containerId: 'ship-designer-container',
    apiBase: '/api',
    onGenerate: (metadata) => {
      console.log('Ship generated:', metadata);
    },
    onSave: (result) => {
      console.log('Ship saved:', result);
    },
    onError: (message) => {
      console.error('Error:', message);
    },
  });
</script>
```

### Features der UI

1. **Fraktions-Galerie**: Schnelle Auswahl mit visuellen Indikatoren
2. **Schiff-Klassen-Selector**: Mit Triangle-Budget-Display
3. **Schiff-Name-Input**: Für Spieler-Customization
4. **LoRA-Style-Checkboxes**: Multi-Select mit Beschreibungen
5. **Customization-Prompt-Editor**: Free-text Eingabe für extra Details
6. **Prompt-Preview**: Collapsible View des generierten Prompts
7. **3D-Viewer**: Three.js GLB-Darstellung (mit GLTFLoader Integration)
8. **Generation-Progress**: Echtzeit-Fortschrittsbalken
9. **Ship-Stats**: Triangle-Count, Materials, Dateigröße
10. **Save/Export-Actions**: Datenbank-Speicherung oder GLB-Download

---

## 📝 Prompt-Generierungs-Beispiel

### Input

```php
{
  "faction_code": "syl_nar",
  "ship_class": "frigate",
  "name": "Gezeitenflüsterer",
  "customization_prompt": "make it bigger, with more bioluminescent veins running through the hull",
  "lora_styles": ["faction_signature", "organic_biomimetic"]
}
```

### Output-Prompt

```
Generate a high-quality 3D spaceship in GLB format for TRELLIS2.

## Faction Context
Faction: Syl'Nar
Type: spiritual
Description: A peace-seeking civilization of aquatic origin...

## Visual Signature (MUST apply)
Silhouette: soft orbital geometry, flowing curves, tentacle-like extensions, bioluminescent features
Materials: translucent shells, bio-luminescent veins, wet-glossy surfaces, mother-of-pearl shimmer
Primary Color: #4169E1
Secondary Color: #7FFFD4
Signature Parts: halo_tentacles, lumen_veins, tide_fins

## Ship Class Specifications
Class: Frigate
Description: Medium escort/exploration vessel
Role: exploration and medium-range combat with extended crew
Scale Reference: 120 meters
Triangle Budget: max 12000 triangles (CRITICAL - optimize geometry)
Silhouette Hint: balanced form, crew capacity, sensor suite

## Style Modifiers
- Apply faction-specific LoRA for visual consistency
- Flowing curves, biological inspiration, living vessel aesthetic

## Player Customization
make it bigger, with more bioluminescent veins running through the hull

## Output Requirements
- Export as GLB format (binary .glb file)
- All textures embedded or referenced with absolute paths
- Recognize TRELLIS2 output structure: single root Mesh3D with materials
- Ensure silhouette is instantly recognizable as faction: syl_nar
- Apply all signature parts distinctly to avoid ambiguity
- Maintain consistent materials across connected components
```

---

## 🧪 Testing & Validation

### Unit Tests: `tests/Unit/ShipDesignerEngineTest.php`

```bash
phpunit tests/Unit/ShipDesignerEngineTest.php
```

Validiert:
- ✅ Prompt-Generierung für alle Fraktionen
- ✅ Triangle-Budget-Durchsetzung
- ✅ LoRA-Style-Auswahl & Empfehlungen
- ✅ Fraktionsspezifische Silhouetten
- ✅ Schiff-Klassen-Templates

### Integration Tests: `tests/Integration/ShipDesignerAPITest.php`

```bash
phpunit tests/Integration/ShipDesignerAPITest.php
```

Validiert:
- ✅ API-Endpunkte (generate_prompt, ship_templates, lora_styles)
- ✅ Prompt-Konsistenz über mehrere Fraktionen
- ✅ LoRA-Style-Empfehlungen

### Frontend Tests: `tests/Unit/ship-designer.test.js`

```bash
npm run test:3d-geometry
```

Validiert:
- ✅ UI-Rendering
- ✅ Fraktions-Auswahl & State-Management
- ✅ Prompt-Preview
- ✅ Generierungs-Workflow

---

## 🚀 Produktionsreife: offene Grenzen

- `ship_designer_engine.php` implementiert Prompt-, Template-, Fraktions- und Stil-Abfragen. Es implementiert keine `queue_generation`, `generation_status` oder `save_generated_ship` Aktionen.
- Die UI reiht die Generierung über die separaten Vessel-Design- und Queue-APIs ein; deren Laufzeit erfordert die konfigurierte Datenbank, den Worker und den TRELLIS2-Dienst.
- `ShipDesignerAssetPipeline.js` ist kein vollständiger Produktionspfad: GLB-Statistiken sind Näherungen, Signatur-Erkennung ist ein Stub, Skalierung fehlt, Thumbnail ist ein Platzhalter und Material-Nachbearbeitung wird nicht ausgeführt.
- Prompt-Stil-Presets belegen nicht, dass die entsprechenden LoRA-Modellgewichte geladen oder bei TRELLIS2 angewendet werden.
- Die vorhandenen Prompt-Engine-Tests decken nicht den vollständigen Browser-, Queue-, GPU- und Persistenzpfad ab.

---

## 🔄 Vorgesehener Generierungsvertrag (derzeit nicht verfügbar)

`ship_designer_engine.php` erzeugt nur den Prompt und liefert Vorlagen/Stil-Presets. Die UI versucht den Entwurf über `/api/vessel_designs` zu speichern, die Generierung über `/api/vessel_designs/{id}/generate` einzureihen, `/api/generation_queue/{id}` abzufragen und fertige Assets über `/api/asset_generations/{id}` zu laden. Die aktuelle `.htaccess`-Konfiguration deaktiviert jedoch die `/api/vessel_designs`-Rewrite-Regel; außerdem wird die eigenständige `ship-designer.html`-Seite blockiert. Der vollständige Designer-Flow ist daher nicht verfügbar. Die offenen Grenzen der Asset-Pipeline bestehen zusätzlich.

---

## 📚 Referenzen

- [FACTION_3D_OBJECT_DESIGN_LANGUAGE.md](../../docs/gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md)
- [TRELLIS2_DOCKER_CUDA_SETUP.md](../../docs/technical/TRELLIS2_DOCKER_CUDA_SETUP.md)
- [Asset Pipeline Tests](../../tests/Integration/3d-asset-pipeline.test.js)
