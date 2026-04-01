# [FEATURE] Colony Building WebGPU – Phase W3–W6: 3D-Gebäude, Interaktion & Post-FX

**Labels:** `feature`, `engine`, `webgpu`, `rendering`, `colony`  
**Milestone:** Colony Building WebGPU v1.0  
**Referenz:** `COLONY_BUILDING_WEBGPU_DESIGN.md` – Kapitel 7–16 Phase W3–W6  
**Abhängigkeit:** Issue #09 (Phase W1+W2) muss abgeschlossen sein

---

## Zusammenfassung

Erweiterung des Colony Grid Renderers um 3D-Gebäudemesh-Rendering (instanced, per BuildingType), GPU-Picking für Klick/Hover-Interaktion, Bau-Animationen, alle 24+ Gebäude-JSON-Dateien, EffectComposer-Integration (SSAO + Bloom) und `ColonyGridController` in `js/game.js`.

---

## Akzeptanzkriterien – Phase W3: 3D-Gebäude (3–4 Tage)

### Building Mesh Shader (`js/engine/colony/shaders/building_mesh.wgsl`)

- [ ] Instanced Mesh-Shader für 3D-Gebäude:
  ```wgsl
  // Instance-Layout pro Gebäude (64 Bytes):
  //   [0-2]  worldPos (x,y,z)
  //   [3]    slotState
  //   [4-7]  tileColor RGBA (= building Tint)
  //   [8]    constructionProgress
  //   [9]    emissiveIntensity     // für Bau-Glow-Animation
  //   [10]   alphaScale            // für Ghost-Vorschau
  //   [11-15] padding/reserved
  ```
- [ ] Vertex-Shader: `worldPos + instanceOffset`, Normal-Transformation, UV-Passthrough
- [ ] Fragment-Shader:
  - PBR-Beleuchtung (Lambert + Blinn-Phong, vereinfacht ohne Raytracing)
  - `metallic`, `roughness` aus Material-Buffer
  - `emissive` mit `emissiveIntensity`-Multiplikator (für Bau-Animation)
  - Alpha-Multiplikator (für Ghost-Vorschau halbtransparent)
- [ ] Uniform-Buffer: `{ viewProj: mat4x4f; lightDir: vec3f; time: f32; }`
- [ ] Material-Buffer: `array<MaterialData, 32>` als `STORAGE` (Index-Mapping aus BuildingMeshLibrary)

### BuildingInstanceBatch (`js/engine/colony/ColonyGridRenderer.js` – Erweiterung)

- [ ] `BuildingInstanceBatch`-Klasse per BuildingType:
  ```js
  class BuildingInstanceBatch {
    constructor(device, maxInstances)
    addInstance(slot, animation)   // Instance zu Buffer hinzufügen
    uploadToGPU(queue)             // CPU→GPU-Transfer
    clear()                        // für nächsten Frame
    get liveCount(): number
  }
  ```
- [ ] `ColonyGridRenderer._renderBuildingMeshes(pass)`:
  - Für jede BuildingType-Batch: `pass.setVertexBuffer()` + `pass.setIndexBuffer()` + `pass.drawIndexed()`
  - `pass.setBindGroup()` mit Material-Buffer + Frame-Uniforms
- [ ] LOD-Auswahl basierend auf Kamera-Distanz (`camera.distance` vs. `lods[i].maxDistance`)
- [ ] `BuildingMeshLibrary._uploadToGPU(device)`: Vertex/Index-Buffer pro BuildingType auf GPU laden

### Alle 24+ Gebäude-JSON-Dateien (`data/buildings/`)

Die ersten 5 wurden in Issue #09 erstellt. Hier die restlichen 19+:

- [ ] `alloy_foundry.building.json` – Industriegebäude mit Schornsteinen (aus Design-Doc §2.2 als Referenz)
- [ ] `farm.building.json` – Terraform-Gewächshaus-Cluster, flach, Glas-Dach
- [ ] `water_processor.building.json` – Tank-Zylinder + Verbindungsröhren
- [ ] `energy_grid.building.json` – Hochspannungsmasten-Cluster (dünne Zylinder + horizontale Boxen)
- [ ] `factory.building.json` – Großes Fabrikgebäude, 2-stufig, mit Förderband
- [ ] `refinery.building.json` – Zylinder-Tank-Cluster + Rohrsystem
- [ ] `research_center.building.json` – Mehrstöckiges Gebäude + Radioteleskop-Schüssel
- [ ] `xenobiology_lab.building.json` – Organische Kuppelform, unregelmäßige Geometrie
- [ ] `institute.building.json` – Imposantes Hauptgebäude + Verbindungsbrücken zu Türmen
- [ ] `senate_chamber.building.json` – Klassisch-futuristisch: Kuppel-Hauptgebäude + Säulen
- [ ] `pleasure_dome.building.json` – Große Kuppel mit Innenbeleuchtung (Emissive-Shader)
- [ ] `immigration_center.building.json` – Flaches Verwaltungsgebäude + Empfangsbereich
- [ ] `spaceport.building.json` – Landepad (flache Kreisscheibe) + Kontrolltürme
- [ ] `shipyard_complex.building.json` – Großes Dock-Gebäude (2× Slots), Kräne, Rumpf-Rahmen
- [ ] `orbital_station.building.json` – Platzhalter-Mesh (Icon im Grid, 3D-Detail im Orbital-View)
- [ ] `fortification_l1.building.json` – Niedrige Verteidigungsmauer-Segmente
- [ ] `fortification_l2.building.json` – Verteidigungstürme
- [ ] `fortification_l3.building.json` – Energieschirm-Projektoren
- [ ] `fortification_l4.building.json` – Orbitale Abwehrkannonen (Symbol-Mesh)
- [ ] `district_industrial.building.json` – Fabrik-Distrikt-Block (mehrere kleine Gebäude)
- [ ] `district_agricultural.building.json` – Felder-Cluster + Bewässerungsanlagen
- [ ] `district_research.building.json` – Wissenschaftspark-Cluster
- [ ] `district_urban.building.json` – Wohnblock-Cluster (3–5 Box-Türme unterschiedlicher Höhe)

---

## Akzeptanzkriterien – Phase W4: Interaktion & Animation (2–3 Tage)

### GPU-Picking Shader (`js/engine/colony/shaders/building_pick.wgsl`)

- [ ] Picking-Shader rendert Slot-Index als Farbe in Offscreen-Buffer:
  ```wgsl
  // Fragment gibt Slot-ID als RGBA kodiert zurück:
  // slot_id = col + row * gridWidth
  // RGBA = [(id >> 0) & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, 0xFF] / 255.0
  ```
- [ ] Picking-Buffer: R8G8B8A8-Textur, `RENDER_ATTACHMENT | COPY_SRC`

### `ColonyGridRenderer.pickSlotAtScreenPos(x, y)` 

- [ ] Liest einzelnen Pixel aus Picking-Buffer (GPU-Readback via `copyTextureToBuffer` + `mapAsync`):
  ```js
  async pickSlotAtScreenPos(x, y): GridSlot | null
  ```
- [ ] Hover-Highlight: aktuell gehoverter Slot bekommt `tileColor` = Highlight-Gelb
- [ ] Click-to-Select: Auswahl-Ring um Slot (separater Overlay-Pass oder modifizierter Ground-Tile-Pass)

### `js/engine/colony/BuildingAnimation.js` (neue Datei)

- [ ] `BuildingAnimation`-Klasse:
  ```js
  class BuildingAnimation {
    constructor(type)  // 'construction' | 'idle' | 'selected'
    tick(dt, progress) // aktualisiert emissive, alpha, scale
    get emissiveIntensity(): number  // für GPU-Instance
    get alphaScale(): number         // für Ghost-Vorschau
    get scaleY(): number             // Construction Scale-In (0→1)
    isComplete(): boolean
  }
  ```
- [ ] `construction`-Animation: 3 Phasen
  1. Scale-In: scaleY 0→1 (erste 30 % der Bauzeit)
  2. Bau-Glow: emissiveIntensity pulsiert 0.3→1.0 (mittlere 40 %)
  3. Fertigstellungs-Flash: emissiveIntensity 2.0 → 0.0 in 10 Frames
- [ ] `idle`-Animation: sehr leichtes emissiveIntensity-Pulsieren (0.05 Amplitude, 0.5 Hz)
- [ ] Smoke-Emitter-Integration:
  - Bei `construction`-Animation: `GPUParticleSystem.spawn()` für Baustaub-Partikel
  - Emitter-Position = Slot-Weltkoordinaten + (0, 1.5, 0)

### Placement-Preview (Ghost-Gebäude)

- [ ] `ColonyGridRenderer.setPlacementPreview(col, row, buildingType)`:
  - Rendert Ghost-Gebäude (alphaScale = 0.5) über dem Hover-Slot
  - Grün wenn Platzierung möglich, Rot wenn Slot belegt/gesperrt
- [ ] `ColonyGridRenderer.clearPlacementPreview()`

---

## Akzeptanzkriterien – Phase W5: Post-FX & Polish (1–2 Tage)

### EffectComposer-Konfiguration

- [ ] `ColonyGridRenderer.initPostFX(effectComposer)`:
  - Konfiguriert bestehenden `EffectComposer` aus `js/engine/post-effects/`:
    - `SSAOPass` – Building-Shadows (Radius: 0.5, Intensity: 0.6)
    - `BloomPass` – Construction-Glow + Emissive (Threshold: 0.7, Strength: 0.8)
    - `VignettePass` – leichte Randabdunklung (Darkness: 0.3)
  - Reuse bestehender Passes (kein neuer Code in Post-Effects-Modulen nötig)

### LOD-Wechsel-Blending

- [ ] Sanftes LOD-Überblenden: Alpha-Crossfade beim LOD-Wechsel über 10 Frames
- [ ] Kein harter Pop bei Kamera-Zoom (aktuelles LOD-Threshold ist kamera-distanzbasiert)

### `ColonyGridController` in `js/game.js`

- [ ] Neuer Controller `ColonyGridController`:
  - Öffnet sich wenn Spieler auf eine Kolonie klickt und „3D-Ansicht" wählt
  - Nutzt `ViewportManager.openColonyGrid(colonyId)`
  - Toolbar am oberen Rand: Gebäude-Auswahl-Palette (Gebäude-Typen nach Kategorie)
  - Rechtsklick auf Slot: Kontextmenü (Bauen / Abreißen / Details)
  - Details-Panel rechts: Gebäude-Name, Kosten, Output, Bauzeit
  - Gebäude-Bau ausgelöst via `POST api/colony.php?action=build_building`
  - Bestehende GQUI-API verwenden

---

## Akzeptanzkriterien – Phase W6: Tests & Optimierung (2 Tage)

- [ ] Vollständige Vitest-Test-Suite:
  - `tests/js/colony-renderer.test.js` (MockDevice + MockQueue, kein echtes GPU nötig):
    - `testInstanceBatchAddAndClear()` – Instance korrekt hinzugefügt und gecleart
    - `testLODSelectionByDistance()` – LOD 0 bei distance < 40, LOD 1 bei < 120
    - `testAnimationConstructionPhases()` – 3 Animationsphasen in korrekter Reihenfolge
    - `testGhostBuildingAlpha()` – Ghost hat alphaScale = 0.5
    - `testPickingShaderEncodesSlotId()` – Slot-ID korrekt RGBA-kodiert
- [ ] Performance-Ziel: 60 FPS bei 256 Slots + 100 Gebäuden (Profiling-Nachweis)
- [ ] Dirty-Flag-Optimierung sicherstellen: nur geänderte Slots neu hochladen
- [ ] WebGL-Fallback für `BuildingMeshLibrary`: Wenn kein WebGPU verfügbar → Canvas2D-2D-Icon-Fallback (keine 3D-Geometrie)

---

## Dateistruktur (Ergänzungen zu Issue #09)

```
js/engine/colony/
  BuildingAnimation.js       (neu)
  shaders/
    building_mesh.wgsl        (neu)
    building_pick.wgsl        (neu)

data/buildings/
  alloy_foundry.building.json
  farm.building.json
  ... (19 weitere, s.o.)

tests/js/
  colony-renderer.test.js    (neu)
```

---

## Abhängigkeiten

- Setzt Issue #09 (Phase W1+W2 – ColonyGrid, BuildingMeshLibrary, Ground Tiles) voraus
- Setzt `GPUParticleSystem` + `EffectComposer` aus bestehender Engine voraus
- Setzt `ViewportManager.openColonyGrid()` aus Issue #09 voraus

---

## Estimate

**~9–11 Tage** (W3 3D-Gebäude 3–4 Tage + W4 Interaktion 2–3 Tage + W5 Post-FX 1–2 Tage + W6 Tests 2 Tage)
