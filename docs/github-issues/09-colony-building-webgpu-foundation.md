# [FEATURE] Colony Building WebGPU – Phase W1+W2: Fundament & Ground Tile Renderer

**Labels:** `feature`, `engine`, `webgpu`, `rendering`, `colony`  
**Milestone:** Colony Building WebGPU v1.0  
**Referenz:** `COLONY_BUILDING_WEBGPU_DESIGN.md` – Kapitel 1–6 & 16 Phase W1+W2

---

## Zusammenfassung

Implementierung des Fundaments des Colony Building Grid Systems: Datenmodell (`ColonyGrid.js`), JSON-Gebäudemodell-Loader (`BuildingMeshLibrary.js`), erste 5 Gebäude-JSON-Dateien, Ground-Tile-WGSL-Shader und isometrischer Kamera-Controller. Integration als PiP-Viewport im `ViewportManager`.

---

## Hintergrund

Das Colony Building Grid rendert eine isometrische (30° Elevation) 3D-Ansicht einer Kolonie als NxM-Raster von Bauslots. Jeder Slot ist leer, im Bau, oder mit einem 3D-Gebäude belegt. Es ist eine neue `js/engine/colony/`-Ordnerstruktur – **kein Code in bestehenden Dateien außer `ViewportManager.js` und `js/engine/index.js`**.

Bestehende Basis-Klassen werden **wiederverwendet**:
- `WebGPUBuffer`, `WebGPUShader`, `WebGPURenderPass`, `WebGPUDevice` aus `js/engine/`
- `Geometry.plane()` für Tile-Geometrie
- `ViewportManager` + PiP-System (PIP_DEFAULTS.headerHeight = 22 px)
- `EffectComposer` (Bloom + SSAO für spätere Phasen W5)

---

## Akzeptanzkriterien – Phase W1: Fundament (2–3 Tage)

### `js/engine/colony/ColonyGrid.js` (neues Modul)

- [ ] `SlotState`-Enum:
  ```js
  export const SlotState = { EMPTY: 0, LOCKED: 1, CONSTRUCTION: 2, BUILT: 3, DAMAGED: 4 };
  ```
- [ ] `GridSlot`-Klasse:
  ```js
  class GridSlot {
    constructor(col, row) { /* col, row, state=EMPTY, buildingType=null, progress=0, health=1.0 */ }
    worldPos(tileSize)   // → {x, z} Weltkoordinaten aus Grid-Position
    isDirty              // true wenn seit letztem GPU-Upload geändert
    markDirty() / markClean()
    serialize() / static fromSnapshot(data)
  }
  ```
- [ ] `ColonyGrid`-Klasse:
  ```js
  class ColonyGrid {
    constructor(cols, rows, tileSize = 1.0)
    slot(col, row): GridSlot       // Null-safe
    placeBuilding(col, row, buildingType, slotsRequired)
    removeBuilding(col, row)
    startConstruction(col, row, buildingType, durationTicks)
    advanceConstruction(col, row)  // progress += 1/duration; bei 1.0 → BUILT
    dirtySlots(): GridSlot[]       // nur veränderte Slots
    serialize() / static fromSnapshot(data)
  }
  ```
- [ ] Validierungen: Slot-Out-of-Bounds → null, Überlapping-Buildings → Exception

### `js/engine/colony/BuildingMeshLibrary.js` (neues Modul)

- [ ] JSON-Loader für `data/buildings/*.building.json`:
  ```js
  class BuildingMeshLibrary {
    async load(buildingId)        // fetch + JSON.parse
    bakeGeometry(buildingDef, lodLevel)  // Primitiv-Baker: box/cylinder/sphere → Vertex/Index-Array
    getVertexBuffer(buildingId, lodLevel): Float32Array
    getIndexBuffer(buildingId, lodLevel): Uint16Array
    getMaterial(buildingId, materialName): { albedo, metallic, roughness, emissive }
  }
  ```
- [ ] Primitiv-Baker implementieren:
  - `box` → 24 Vertices (6 Seiten × 4 Ecken) + 36 Indices
  - `cylinder` → `(segments + 1) × 2 + 2` Vertices + korrekte Index-Berechnung
  - `sphere` → UV-Sphere mit konfigurierbaren Segmenten (falls verwendet)
  - Offset aus `primitives[i].offset` auf alle Vertices anwenden
  - Geometrien zusammenführen zu einem einzigen Vertex/Index-Buffer pro LOD

### Erste 5 Gebäude-JSON-Dateien (`data/buildings/`)

- [ ] `data/buildings/metal_mine.building.json`:
  - LOD 0: Box-Basis (0.9×0.5×0.9) + 2 kurze Zylinder-Schächte + kleines Förderband-Dach
  - LOD 1: Vereinfachte Box
  - Materialien: `metal_dark`, `ore_rough`
- [ ] `data/buildings/research_lab.building.json`:
  - LOD 0: Box-Basis + 3 Kuppeln (Sphere-Primitiv) + Antenne (schmaler Zylinder)
  - Materialien: `glass_blue`, `metal_clean`, `emissive_cyan` (emissive: [0,0.5,0.8])
- [ ] `data/buildings/habitat.building.json`:
  - LOD 0: Mehrstufige Box-Anlage (3 versetzte Boxen unterschiedlicher Höhe) + Verbindungsröhren
  - Materialien: `habitat_panel`, `metal_pipe`
- [ ] `data/buildings/solar_plant.building.json`:
  - LOD 0: Sockel-Box + 4 ausladende flache Panels (Box sehr flach, extended)
  - Materialien: `solar_panel`, `metal_base`
- [ ] `data/buildings/shipyard.building.json`:
  - LOD 0: Große Basis-Box + 2 Kran-Strukturen (vertikaler Zylinder + horizontale Box) + Dock-Rahmen
  - Materialien: `metal_heavy`, `industrial_panel`
- [ ] Alle 5 Dateien folgen exakt dem JSON-Schema aus `COLONY_BUILDING_WEBGPU_DESIGN.md §2.2`

### Tests (`tests/js/colony-grid.test.js`)

- [ ] `testGridSlotWorldPos()` – Slot (2,3) mit tileSize=1.5 → korrekte Weltkoordinaten
- [ ] `testPlaceBuildingOccupiesSlot()` – State BUILT nach placeBuilding()
- [ ] `testOutOfBoundsReturnsNull()` – slot(999,999) → null
- [ ] `testConstructionAdvances()` – advanceConstruction() 10× bei duration=10 → State BUILT
- [ ] `testDirtyFlagSystem()` – nach placeBuilding() → isDirty, nach markClean() → nicht dirty
- [ ] `testBakerBoxGeometry()` – Box-Primitiv → 24 Vertices, 36 Indices
- [ ] `testBakerCylinderSegments()` – Zylinder 8 Segmente → korrekte Vertex-Anzahl
- [ ] `testBuildingJsonLoaderMine()` – metal_mine.building.json lädt ohne Fehler, LOD 0 vorhanden

---

## Akzeptanzkriterien – Phase W2: Ground Tile Renderer (2–3 Tage)

### WGSL-Shader (`js/engine/colony/shaders/building_grid.wgsl`)

- [ ] Ground-Tile-Shader (instanced quads, 1 Quad = 1 Slot):
  ```wgsl
  // Vertex-Shader: nimmt Instance-Buffer (64 Bytes / Slot, 16×f32)
  // Slot-Instance-Layout (aus COLONY_BUILDING_WEBGPU_DESIGN.md §6):
  //   [0-2]  worldPos (x,y,z)
  //   [3]    slotState (float, interpretiert als uint)
  //   [4-7]  tileColor RGBA
  //   [8]    constructionProgress (0.0..1.0)
  //   [9-11] reserved
  //   [12-15] padding
  ```
- [ ] Fragment-Shader:
  - `EMPTY` → neutrale Kachel (dunkelgrau)
  - `LOCKED` → sehr dunkle Kachel (gesperrt)
  - `CONSTRUCTION` → animierter Gelb-Rand (basierend auf `time` uniform)
  - `BUILT` → Kachelfarbe aus tileColor
  - Grid-Linien zwischen Slots (dünne helle Linien, 0.02 Einheiten Breite)
- [ ] `uniform FrameUniforms { viewProj: mat4x4f; time: f32; }` aus Uniform-Buffer

### `js/engine/colony/ColonyGridRenderer.js` (Skeleton – nur Ground Tiles)

- [ ] Klasse `ColonyGridRenderer`:
  ```js
  class ColonyGridRenderer {
    constructor(device, grid, buildingLibrary) {}
    
    async init()     // Pipeline erstellen, Buffer allocieren
    updateSlots()    // Nur dirty Slots in GPU-Buffer schreiben (Dirty-Flag-System)
    render(commandEncoder, passDescriptor, camera, time)  // Ground-Tile-Pass
    destroy()        // GPU-Ressourcen freigeben
  }
  ```
- [ ] Instance-Buffer: `Float32Array(grid.cols * grid.rows * 16)` als `STORAGE | COPY_DST`
- [ ] Dirty-Flag-basiertes Update: nur geänderte Slots neu schreiben (nicht ganzen Buffer)
- [ ] Render-Pass: `loadOp: 'clear'` mit schwarzem Hintergrund, Depth-Test aktiviert

### `js/engine/colony/IsoCameraController.js` (neues Modul)

- [ ] Isometrische Kamera (30° Elevation, konfigurierbarer Azimut):
  ```js
  class IsoCameraController {
    constructor(canvas, grid) {}
    
    // Input-Handler (Mouse/Touch)
    onMouseDown / onMouseMove / onMouseUp / onWheel
    
    // Kamera-State
    azimuth    // Horizontale Drehung (Grad)
    elevation  // = 30° (konstant, isometrisch)
    distance   // Zoom-Entfernung (min: 5, max: 50)
    target     // Fokuspunkt auf Grid (Vec3)
    
    // Aktionen
    pan(dx, dz)
    zoom(delta)
    rotate(dAzimuth)
    focusSlot(col, row)
    
    // Ausgabe
    getViewProjMatrix(): Float32Array  // 4×4 für GPU-Uniform
    update(dt)
  }
  ```
- [ ] Rechtsklick + Drag → rotieren (Azimut)
- [ ] Mittelklick / Space + Drag → pannen
- [ ] Scrollrad → zoomen

### Integration in `ViewportManager.js`

- [ ] Neue PiP-Typ-Konstante: `PipType.COLONY_GRID`
- [ ] `ViewportManager.openColonyGrid(colonyId)`:
  - Erstellt neues PiP-Fenster mit Titel „Kolonie: [Name]"
  - Initiiert `ColonyGridRenderer` für die Colony
  - Schließen via Standard-PiP-Close-Schaltfläche
- [ ] Colony-Grid-Canvas teilt sich **keinen** Swap-Chain-Buffer mit Galaxy-Renderer → eigenes Off-Screen-Canvas oder Sub-Viewport

### Export aus `js/engine/index.js`

- [ ] `ColonyGrid`, `GridSlot`, `SlotState` exportieren
- [ ] `BuildingMeshLibrary` exportieren
- [ ] `ColonyGridRenderer` exportieren
- [ ] `IsoCameraController` exportieren

---

## Dateistruktur

```
js/engine/colony/
  ColonyGrid.js
  BuildingMeshLibrary.js
  ColonyGridRenderer.js
  IsoCameraController.js
  shaders/
    building_grid.wgsl

data/buildings/
  metal_mine.building.json
  research_lab.building.json
  habitat.building.json
  solar_plant.building.json
  shipyard.building.json

tests/js/
  colony-grid.test.js
```

---

## Abhängigkeiten

- Setzt bestehende `WebGPUDevice`, `WebGPUBuffer`, `WebGPUShader`, `WebGPURenderPass` voraus
- Setzt `ViewportManager` + PiP-System voraus (PIP_DEFAULTS.headerHeight = 22)
- Blockiert: Issue #10 (3D-Gebäude, Interaktion, Post-FX)

---

## Estimate

**~5–6 Tage** (W1 Fundament 2–3 Tage + W2 Ground Tile Renderer 2–3 Tage)
