# 3D-Geometrie & Texture-Prompts für Schiff-Komponenten

**Datei**: `api/ship_component_prompts.php`  
**Zweck**: Zentrale Bibliothek für detaillierte 3D-Generierungs-Prompts  
**Status**: ✅ Production-ready

---

## 📋 Übersicht

Die `ShipComponentPromptLibrary` definiert detaillierte technische Spezifikationen für:

- **Geometrie**: Polygon-Budgets, Panel-Layouts, strukturelle Details
- **Texturen**: PBR Maps (Albedo, Metallic, Roughness, Normal, Emission)
- **Fraktions-Ästhetik**: Vor'Tak (angular), Syl'Nar (organic), etc.
- **Assembly**: Integration mit Basis-Hull und anderen Komponenten

---

## 🏗️ Komponenten-Struktur

### 1. **Hull (Rumpf)**

Kanonische Schiff-Form pro Fraktion mit allen Details:

```
VOR'TAK HULL:
├─ Geometrie
│  ├─ Silhouette: WEDGE + ARMORED (angular, aggressive)
│  ├─ Panel-Anordnung: Überlappende Platten mit Bevels
│  ├─ Zentrale Rippe: Recessed line 4mm Tiefe
│  ├─ Polygon-Budget: 4000-5000 Triangles
│  └─ Symmetrie: Bilateral (L-R Mirror)
│
├─ Texture (PBR)
│  ├─ Albedo: #5C3317 (dark bronze)
│  ├─ Metallic: 0.9 (polished surfaces)
│  ├─ Roughness: 0.3-0.9 (varying wear)
│  ├─ Normal Map: Rillen, Nieten, Kratzer
│  └─ Emission: Keine (oder nur minimal)
│
└─ Assembly
   ├─ Engine-Mount: Stern, 100mm Ø
   ├─ Weapon-Turret: Top/Port, 80mm height
   ├─ Shield-Generator: Bow/Sides, flush
   └─ Sensor-Pod: Dorsal, 120mm height

SYL'NAR HULL:
├─ Geometrie
│  ├─ Silhouette: FLOWING CURVES (organic)
│  ├─ Panel-Anordnung: Radial mit asymmetrischen Kurven
│  ├─ Bulges: 15-20% Volumen in Mid-Body
│  ├─ Polygon-Budget: 4500-5500 Triangles
│  └─ Symmetrie: Radial (biologisch asymmetrisch)
│
├─ Texture (PBR)
│  ├─ Albedo: #2E5090 (deep ocean blue)
│  ├─ Metallic: 0.2 (organic, non-metallic)
│  ├─ Roughness: 0.2-0.7 (smooth shell)
│  ├─ Normal Map: Ridges, Schuppen, Bio-luminescent veins
│  ├─ Emission: 0.2-0.8 in cyan (bioluminescence)
│  └─ Translucent Sections: Separate layer (0.3 opacity)
│
└─ Assembly
   ├─ Engine-Integration: Organic tapered junction
   ├─ Weapon-Deployment: Flexible curved arm (150mm reach)
   ├─ Shield-Nodes: 3-4 distributed points
   └─ Sensor-Bulges: Raised organic formations
```

---

### 2. **Weapons (Waffen-Hardpoints)**

Modulare Waffen-Türme mit 3 Größen:

```
SMALL (2m):
├─ Geometry: 100-200 triangles
├─ Faction: Vor'Tak = angular pod | Syl'Nar = organic bulge
├─ Rotation: 360° horizontal, ±45° vertical
└─ Mounting: Ball turret on rotating base

MEDIUM (4m):
├─ Geometry: 300-400 triangles
├─ Purpose: Primary weapon system
└─ Features: Barrel visible, heat sink vents

LARGE (6m):
├─ Geometry: 500-700 triangles
├─ Purpose: Capital ship primary weapon
└─ Features: Heavy armor plating, multiple barrels
```

**Texture-Anforderungen**:
- Dark matte surface (0.1 metallic, 0.8 rough)
- Barrel interior: bright (0.95 metallic)
- Mounting bracket: corrosion near hull

---

### 3. **Engines (Triebwerke)**

Dual-Mount Thruster-Pods für Stern:

```
Each Engine:
├─ Engine Bell: 600-800 triangles
│  └─ Interior: Dark red/orange (heat-damaged)
│  └─ Metallic: 0.9 (shiny bell)
│  └─ Burnt edges: Charred from exhaust
│
├─ Intake Manifold: 200-300 triangles
│  └─ Ridged texture (suction-like)
│  └─ Color gradient: Hull → Darker interior
│  └─ Rust/corrosion near vents
│
└─ Radiator Fins: 100-150 triangles
   └─ Pale gray/white (heat-dissipating)
   └─ Metallic: 0.8 (aluminum-like)
   └─ Dust/debris accumulation

Total: 1000-1400 per engine × 2 = 2000 polygons
```

---

### 4. **Shields (Schutzgeneratoren)**

Energy Defense Nodes verteilt über den Rumpf:

```
Generator Core:
├─ Geometry: 300-400 triangles
├─ Texture
│  ├─ Emissive: 0.4-0.8 (glowing effect)
│  ├─ Color: Faction primary (cyan for Syl'Nar, bronze for Vor'Tak)
│  ├─ Metallic: 0.6
│  └─ Roughness: 0.3 (polished active surface)
│
├─ Emission Array: 150-200 triangles
│  ├─ Radiating elements (energy projection)
│  ├─ Metallic: 0.8 (shiny reflective)
│  └─ Roughness: 0.4
│
└─ Support Structure: 100-150 triangles
   └─ Matches hull color + finish
```

---

### 5. **Sensors (Sensor-Arrays)**

Dorsal-mounted Scanning & Targeting Pod:

```
Sensor Array:
├─ Main Pod: 300-400 triangles
│  ├─ Slightly bulging, streamlined form
│  ├─ Metallic: 0.7 (EM shielding)
│  └─ Roughness: 0.5
│
├─ Receiver Dishes: 100-150 triangles
│  ├─ Parabolic surfaces
│  ├─ Metallic: 0.95 (pristine reflective)
│  └─ Grid pattern: Mesh/screen texture
│
├─ Antennae: Variable
│  ├─ Multiple directional arrays
│  ├─ Faction-specific coating
│  └─ Flexible organic vs. mechanical
│
└─ Targeting Indicator (optional):
   ├─ Emissive: 0.3-0.5 in red
   └─ Color: Bright red or faction color
```

---

## 📡 API Endpunkte

### **GET** `/api/ship_component_prompts.php?action=get_hull_prompt&faction_code=vor_tak`

Hole vollständigen Hull-Prompt (Geometrie + Texture + Assembly):

```bash
curl -s "http://localhost:8080/api/ship_component_prompts.php?action=get_hull_prompt&faction_code=vor_tak" | jq '.prompt'
```

**Response**:
```json
{
  "prompt": "# 3D SHIP HULL GENERATION PROMPT\n## Faction: vor_tak\n...",
  "faction": "vor_tak"
}
```

---

### **GET** `/api/ship_component_prompts.php?action=get_component_prompt&component=weapons&faction_code=vor_tak&size=medium`

Hole Komponenten-spezifischen Prompt:

```bash
curl -s "http://localhost:8080/api/ship_component_prompts.php?action=get_component_prompt&component=engines&faction_code=syl_nar&size=large" | jq '.prompt'
```

**Query-Parameter**:
- `component`: `weapons`, `engines`, `shields`, `sensors`
- `faction_code`: `vor_tak`, `syl_nar`, `aereth`, etc.
- `size`: `small`, `medium`, `large`

---

### **GET** `/api/ship_component_prompts.php?action=get_geometry_reference&faction_code=vor_tak`

Hole alle Geometrie-Spezifikationen als Referenz:

```bash
curl -s "http://localhost:8080/api/ship_component_prompts.php?action=get_geometry_reference&faction_code=vor_tak" | jq '.geometry_specs'
```

---

### **GET** `/api/ship_component_prompts.php?action=get_texture_reference&faction_code=syl_nar`

Hole alle Texture-Spezifikationen als Referenz:

```bash
curl -s "http://localhost:8080/api/ship_component_prompts.php?action=get_texture_reference&faction_code=syl_nar" | jq '.texture_specs'
```

---

## 🔗 Integration mit TRELLIS2 Generator

Die `BaseShipComponentGenerator` klasse nutzt die Prompts automatisch:

```php
require_once 'ship_component_prompts.php';
require_once 'trellis2_generator.php';

$db = new PDO(...);
$generator = new BaseShipComponentGenerator($db);

// ✓ Nutzt automatisch detaillierte Prompts aus ShipComponentPromptLibrary
$result = $generator->generateBaseHull('vor_tak');

// Returns:
// {
//   "success": true,
//   "job_id": "trellis2_job_abc123",
//   "component_type": "hull",
//   "source": "ShipComponentPromptLibrary"
// }
```

---

## 🎨 Texture-Details: PBR-Maps erklärt

### **Albedo (Diffuse Color)**
- Basis-Farbe ohne Beleuchtung
- RGB-Werte für jedes Pixel
- Kein Highlight oder Shadow Information

### **Metallic**
- 0.0 = Pure non-metal (fabric, plastic, rust)
- 0.5 = Semi-metallic (weathered steel)
- 1.0 = Pure metal (polished steel, aluminum)

### **Roughness**
- 0.0 = Mirror-smooth (polished chrome)
- 0.5 = Satin finish (standard metal)
- 1.0 = Very rough (sandblasted, weathered)

### **Normal Map**
- Faux-Geometrie ohne zusätzliche Polygons
- Rillen, Kratzer, Nieten, Schuppen
- Kann bis zu 4mm Tiefe vortäuschen

### **Emission (Self-Illumination)**
- 0.0 = No glow
- 0.5 = Medium glow (visible in dark)
- 1.0 = Full brightness (light source)
- **Syl'Nar spezifisch**: Biolumineszenz (cyan/blue 0.4-0.8)

---

## 📐 Polygon-Budgets nach Komponente

| Komponente | Small | Medium | Large | Total |
|-----------|-------|--------|-------|-------|
| Hull | - | 4500 | 5500 | 5000 (avg) |
| Weapons | 200 | 400 | 700 | 1300 (all 3) |
| Engines | 1000 | 1200 | 1400 | 2400 (dual) |
| Shields | - | 600 | - | 600 (1x) |
| Sensors | - | 800 | - | 800 (1x) |
| **Total** | - | - | - | **10,100 triangles** |

**Für Corvette** (recommended budget: 8,000-12,000 triangles)

---

## 🎯 Best Practices

### ✅ DO:
- Verwende spezifische Zahlen für Geometrie (400-500 triangles, nicht "viele")
- Nenne Material-Namen explizit (PBR, Metallic, Roughness)
- Gib Farb-Werte als Hex und RGB an (#8B4513 und 139,69,19)
- Beschreibe Wear-Pattern systematisch (80% auf Kanten, 50% oben, 20% Recesses)
- Spezifiziere Montage-Punkte mit genauen Abmessungen

### ❌ DON'T:
- Verwende vage Begriffe wie "detailliert" oder "realistisch"
- Mische Fraktions-Ästhetiken (Vor'Tak angular ODER organic, nicht gemischt)
- Vergesse Assembly-Requirements bei Komponenten
- Setze unrealistische Polygon-Budgets (Hull unter 3000 oder über 6000)
- Erwähne Animationen (nur statische Meshes!)

---

## 📝 Beispiel: Hull-Prompt für Vor'Tak

```markdown
# 3D SHIP HULL GENERATION PROMPT
## Faction: vor_tak
## Model: TRELLIS2 Text-to-3D

## HULL GEOMETRY SPECIFICATION – Vor'Tak Faction
═════════════════════════════════════════════

Silhouette Style: WEDGE + ARMORED
Base Form: Angular, front-heavy wedge with reinforced bow section

Panel Layout (REQUIRED):
• Center spine running bow-to-stern (recessed line, ~4mm depth)
• Port/starboard hull plates arranged in overlapping rows
• Each plate has beveled edge (2-3mm chamfer)
• Longitudinal ribbing: 8-12 ribs, evenly spaced

Specific geometry:
- Primary polygon budget: 4000-5000 triangles
- Symmetry: Bilateral (left-right mirror)
- Weapon hardpoints: 3 visible mounting plates

[... texture, assembly specs follow ...]

## EXPORT REQUIREMENTS

Format: GLB (with embedded materials)
Scale: 60 meters reference length
Orientation: X-forward, Z-up
Geometry: Optimized for game engine import
Materials: PBR-compatible
Textures: 2048x2048 resolution
```

Wenn Sie diesen Prompt an TRELLIS2 schicken, erhalten Sie ein hochdetailliertes, spielgerecht optimiertes 3D-Modell. ✅

---

## 🚀 Deployment

1. **Kopiere** `ship_component_prompts.php` in `api/`
2. **Aktualisiere** `trellis2_generator.php` um `require_once`:
   ```php
   require_once __DIR__ . '/ship_component_prompts.php';
   ```
3. **Test** Prompt-Retrieval:
   ```bash
   curl http://localhost:8080/api/ship_component_prompts.php?action=get_hull_prompt&faction_code=vor_tak
   ```
4. **Nutze** bei `generateBaseHull()` & anderen Methoden

---

**Status**: ✅ Ready to deploy  
**Dependencies**: None (standalone PHP class)  
**Version**: 1.0  
**Last Updated**: 2026-08-02
