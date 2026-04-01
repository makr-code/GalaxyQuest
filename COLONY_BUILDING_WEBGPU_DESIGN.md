# ⚙️ GalaxyQuest — Colony Building Grid: WebGPU Technical Design

## Technisches Implementierungs-Dokument

**Version:** 1.0  
**Status:** Implementation Blueprint  
**Stand:** 2026-04-01  
**Bezug:** [COLONY_BUILDING_SYSTEM_DESIGN.md](COLONY_BUILDING_SYSTEM_DESIGN.md) · [ARCHITECTURE.md](ARCHITECTURE.md)  
**Kontext:** Dieses Dokument beschreibt die **technische WebGPU-Umsetzung** des in `COLONY_BUILDING_SYSTEM_DESIGN.md` definierten Bausystems. Es behandelt 3D-Gebäudemodelle (JSON), den isometrischen Raster-Renderer (Stellaris-Stil) und die Integration in die bestehende WebGPU-Infrastruktur.

---

## Inhaltsverzeichnis

1. [Architektur-Übersicht](#1-architektur-übersicht)
2. [3D-Gebäudemodelle — JSON-Schema](#2-3d-gebäudemodelle--json-schema)
3. [Grid-System Design](#3-grid-system-design)
4. [WebGPU Rendering Pipeline](#4-webgpu-rendering-pipeline)
5. [WGSL Shader](#5-wgsl-shader)
6. [Instanced Rendering — Slot-Buffer](#6-instanced-rendering--slot-buffer)
7. [ColonyGridRenderer Klasse](#7-colonygridrenderer-klasse)
8. [Kamera & Projektion](#8-kamera--projektion)
9. [Interaktion (Picking & Selection)](#9-interaktion-picking--selection)
10. [Animationen & Building-States](#10-animationen--building-states)
11. [LOD-System](#11-lod-system)
12. [Integration in ViewportManager / PiP](#12-integration-in-viewportmanager--pip)
13. [Post-Processing für das Grid](#13-post-processing-für-das-grid)
14. [Datei-Struktur & Exports](#14-datei-struktur--exports)
15. [Test-Strategie](#15-test-strategie)
16. [Implementierungs-Phasen](#16-implementierungs-phasen)

---

## 1. Architektur-Übersicht

### 1.1 Gesamtkonzept

Das Colony Building Grid rendert eine **isometrische (30°-Tilt) oder leicht Top-Down-Ansicht** einer Kolonie als 3D-Szene im Stellaris-Stil. Jede Kolonie wird als ein **NxM-Raster von Bauslots** dargestellt, wobei jeder Slot entweder leer, im Bau, oder mit einem fertigen Gebäude belegt ist.

```
                    ┌──────────────────────────────────────────┐
                    │          Colony View (WebGPU Canvas)      │
                    │                                          │
                    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
                    │  │🏭  │ │⬜  │ │🔬  │ │⬜  │ │🏠  │   │
                    │  │    │ │    │ │    │ │    │ │    │   │
                    │  └────┘ └────┘ └────┘ └────┘ └────┘   │
                    │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │
                    │  │☀️  │ │⬜  │ │🤖  │ │⬜  │ │⬜  │   │
                    │  └────┘ └────┘ └────┘ └────┘ └────┘   │
                    │                  ...                     │
                    └──────────────────────────────────────────┘
                    
           Legend:  🏭 = Alloy Foundry    ⬜ = Leerer Slot
                    🔬 = Research Lab     ☀️ = Solar Plant
```

### 1.2 Rendering-Stack

```
┌──────────────────────────────────────────────────────────────────┐
│                    ColonyGridRenderer                            │
│                                                                  │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │ GridGeometry │  │ BuildingMeshLib │  │ SlotInstanceBuffer │  │
│  │ (Tile-Plane) │  │ (JSON-Modelle)  │  │ (Float32Array GPU) │  │
│  └──────────────┘  └─────────────────┘  └────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 WebGPU Render Pass                       │   │
│  │  1. Ground Tiles (instanced quads — das Raster)         │   │
│  │  2. Building Meshes (instanced pro Gebäudetyp)          │   │
│  │  3. Construction Progress Overlay (compute shader)      │   │
│  │  4. Selection Highlight (stencil / post-pass)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐  │
│  │ IsoCamCtrl   │  │  PickingBuffer  │  │   EffectComposer   │  │
│  │ (Orbit+Zoom) │  │  (GPU readback) │  │  (Bloom + SSAO)   │  │
│  └──────────────┘  └────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
        │                                         │
        ▼                                         ▼
  WebGPURenderer                          ViewportManager
  (device, queue)                         (PiP-Window)
```

### 1.3 Bestehende Komponenten, die wiederverwendet werden

| Bestehende Klasse | Nutzung im Colony Grid |
|---|---|
| `WebGPUBuffer` | Slot-Instance-Buffer (STORAGE, DYNAMIC) |
| `WebGPUShader` | WGSL-Kompilierung + Pipeline-Caching |
| `WebGPURenderPass` | Grid-Render-Pass-Descriptor |
| `WebGPUDevice` | Device-Lifecycle + GPU-Queue |
| `Geometry` | `Geometry.plane()` für Tiles, Mesh-Geometrien für Gebäude |
| `ViewportManager` + PiP | Colony-Fenster als PiP-Viewport |
| `EffectComposer` | Bloom (für Construction-Glow) + SSAO (Building-Shadows) |
| `BeamEffect` Pattern | Instanced-Buffer-Upload-Muster |
| `Camera`, `PerspectiveCamera` | Isometrische Kamera |

---

## 2. 3D-Gebäudemodelle — JSON-Schema

### 2.1 Building-Mesh-Format

Jedes Gebäude wird als JSON-Datei definiert, die Geometrie, Material-Parameter, LOD-Stufen und Animation-Marker beschreibt. Die Geometrie wird als kompaktes Vertex/Index-Array gespeichert (kein externes Mesh-Format wie GLTF benötigt).

**Dateikonvention:** `data/buildings/<building_type>.building.json`

### 2.2 JSON-Schema (vollständig)

```json
{
  "id": "alloy_foundry",
  "label": "Alloy Foundry",
  "version": 1,
  "bounds": {
    "gridSlots": 3,
    "footprintX": 1,
    "footprintZ": 1,
    "heightUnits": 1.8
  },
  "lods": [
    {
      "level": 0,
      "maxDistance": 40.0,
      "geometry": {
        "vertices": [
          { "pos": [0.0, 0.0, 0.0], "normal": [0, 1, 0], "uv": [0, 0], "color": [0.6, 0.6, 0.65, 1.0] },
          { "pos": [1.0, 0.0, 0.0], "normal": [0, 1, 0], "uv": [1, 0], "color": [0.6, 0.6, 0.65, 1.0] }
        ],
        "indices": [0, 1, 2, 0, 2, 3]
      },
      "primitives": [
        {
          "name": "base",
          "type": "box",
          "size": [0.85, 0.4, 0.85],
          "offset": [0.0, 0.2, 0.0],
          "material": "metal_dark"
        },
        {
          "name": "chimney_a",
          "type": "cylinder",
          "radius": 0.08,
          "height": 0.6,
          "segments": 8,
          "offset": [0.25, 0.7, 0.2],
          "material": "metal_pipe"
        },
        {
          "name": "chimney_b",
          "type": "cylinder",
          "radius": 0.06,
          "height": 0.5,
          "segments": 8,
          "offset": [-0.2, 0.65, -0.1],
          "material": "metal_pipe"
        },
        {
          "name": "rooftop",
          "type": "box",
          "size": [0.6, 0.15, 0.6],
          "offset": [0.0, 0.575, 0.0],
          "material": "industrial_panel"
        }
      ]
    },
    {
      "level": 1,
      "maxDistance": 120.0,
      "primitives": [
        {
          "name": "base",
          "type": "box",
          "size": [0.85, 0.5, 0.85],
          "offset": [0.0, 0.25, 0.0],
          "material": "metal_dark"
        }
      ]
    },
    {
      "level": 2,
      "maxDistance": 9999.0,
      "primitives": [
        {
          "name": "base",
          "type": "box",
          "size": [0.85, 0.5, 0.85],
          "offset": [0.0, 0.25, 0.0],
          "material": "metal_dark"
        }
      ]
    }
  ],
  "materials": {
    "metal_dark":     { "albedo": [0.35, 0.37, 0.42, 1.0], "metallic": 0.8, "roughness": 0.4, "emissive": [0, 0, 0] },
    "metal_pipe":     { "albedo": [0.5,  0.52, 0.55, 1.0], "metallic": 0.9, "roughness": 0.3, "emissive": [0, 0, 0] },
    "industrial_panel":{ "albedo": [0.25, 0.28, 0.3, 1.0], "metallic": 0.6, "roughness": 0.6, "emissive": [0.02, 0.04, 0.06] }
  },
  "animations": {
    "idle": {
      "type": "smoke_emit",
      "emitPoints": [
        { "pos": [0.25, 1.0, 0.2], "rate": 0.5, "color": [0.4, 0.4, 0.4] },
        { "pos": [-0.2, 0.95, -0.1], "rate": 0.3, "color": [0.5, 0.4, 0.3] }
      ]
    },
    "constructing": {
      "type": "construction_glow",
      "color": [0.2, 0.8, 1.0],
      "pulseRate": 1.5
    },
    "damaged": {
      "type": "smoke_emit",
      "emitPoints": [{ "pos": [0.0, 0.5, 0.0], "rate": 2.0, "color": [0.2, 0.2, 0.2] }]
    }
  },
  "selectionRadius": 0.55,
  "districtClass": "industrial",
  "tintByColonyType": {
    "industrial": [1.2, 1.0, 0.9],
    "research":   [0.9, 0.9, 1.1],
    "military":   [1.0, 0.9, 0.85]
  }
}
```

### 2.3 Primitiv-Typen

Das `primitives`-Array in jedem LOD beschreibt prozedural generierte Geometrie-Formen:

| `type` | Parameter | Vertices (approx.) |
|---|---|---|
| `box` | `size[3]`, `offset[3]` | 24 (6 Seiten × 4) |
| `cylinder` | `radius`, `height`, `segments` | `segments × 2 × 2` |
| `cone` | `radius`, `height`, `segments` | `segments + 1` |
| `pyramid` | `base`, `height` | 16 |
| `flat_quad` | `size[2]`, `offset[3]` | 4 |
| `dome` | `radius`, `latSegs`, `lonSegs` | `latSegs × lonSegs × 4` |

### 2.4 BuildingMeshLibrary — Geometrie-Bake-Prozess

`BuildingMeshLibrary` (neue Klasse) lädt alle `.building.json`-Dateien und bäckt die Primitive zu fertigen `Geometry`-Objekten:

```javascript
class BuildingMeshLibrary {
  constructor(device) {
    this._device = device;
    /** @type {Map<string, {lod0: Geometry, lod1: Geometry, lod2: Geometry, materials: object}>} */
    this._meshes = new Map();
    /** @type {Map<string, GPUBuffer>} per-type vertex/index buffers on GPU */
    this._gpuMeshBuffers = new Map();
  }

  async loadAll(buildingJsonPaths) { /* ... */ }

  /** Bake a primitive descriptor into vertex/index data */
  _bakePrimitive(prim) {
    switch (prim.type) {
      case 'box':      return _bakeBox(prim.size, prim.offset, prim.material);
      case 'cylinder': return _bakeCylinder(prim.radius, prim.height, prim.segments, prim.offset, prim.material);
      // ...
    }
  }

  /** Merge all primitives of one LOD into a single Geometry */
  _mergePrimitives(prims) { /* concatenate vertex/index arrays */ }

  /** Upload merged geometry to GPU as vertex + index buffers */
  _uploadToGPU(buildingId, geometry) { /* WebGPUBuffer VERTEX + INDEX */ }

  getMesh(buildingId, lod = 0) { return this._meshes.get(buildingId)?.[`lod${lod}`]; }
  getGPUBuffers(buildingId, lod = 0) { return this._gpuMeshBuffers.get(`${buildingId}_lod${lod}`); }
}
```

### 2.5 Vertex-Layout (interleaved, 48 Bytes pro Vertex)

```wgsl
struct BuildingVertex {
  position : vec3<f32>,   // bytes 0-11
  normal   : vec3<f32>,   // bytes 12-23
  uv       : vec2<f32>,   // bytes 24-31
  color    : vec4<f32>,   // bytes 32-47  (per-primitive base color, packed)
}
// stride = 48 bytes
```

---

## 3. Grid-System Design

### 3.1 Koordinatensystem

Das Grid verwendet ein **Welt-Koordinatensystem** wo:
- **X-Achse** = Zeilen-Richtung (rechts)
- **Z-Achse** = Spalten-Richtung (oben auf dem Planeten)
- **Y-Achse** = Höhe (oben im 3D-Raum)
- **Tile-Größe** = `1.0` Welteinheit (entspricht `tile_size = 1.0`)

```
   Z
   ↑
   │  [0,0] [1,0] [2,0] [3,0]
   │  [0,1] [1,1] [2,1] [3,1]
   │  [0,2] [1,2] [2,2] [3,2]
   └──────────────────────────→ X
```

**Slot-Weltposition:**
```javascript
function slotWorldPos(col, row, tile_size = 1.0) {
  return {
    x: (col + 0.5) * tile_size,
    y: 0.0,   // Terrain-Höhe (später variable per Tile)
    z: (row + 0.5) * tile_size,
  };
}
```

### 3.2 Grid-Datenstruktur (JavaScript)

```javascript
/**
 * ColonyGrid — Client-seitige Zustandsrepräsentation des Kolonierasters.
 * Wird aus dem API-Response befüllt und an den Renderer übergeben.
 */
class ColonyGrid {
  /**
   * @param {number} cols
   * @param {number} rows
   */
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    /** @type {GridSlot[]} Flat array, index = row*cols + col */
    this.slots = Array.from({ length: cols * rows }, (_, i) => new GridSlot(i % cols, Math.floor(i / cols)));
  }

  getSlot(col, row) { return this.slots[row * this.cols + col]; }
  setSlot(col, row, data) { Object.assign(this.getSlot(col, row), data); }
}

class GridSlot {
  constructor(col, row) {
    this.col = col;
    this.row = row;
    this.buildingType  = null;       // null = leer
    this.buildingLevel = 1;
    this.state = SlotState.EMPTY;    // EMPTY, OCCUPIED, CONSTRUCTING, DAMAGED
    this.constructProgress = 0.0;   // 0.0..1.0
    this.districtClass = 'flex';    // 'industrial', 'civic', 'science', etc.
    this.selected = false;
    this.hovered  = false;
  }
}

const SlotState = Object.freeze({
  EMPTY:        0,
  OCCUPIED:     1,
  CONSTRUCTING: 2,
  DAMAGED:      3,
  LOCKED:       4,   // Distrikt-Klasse passt nicht / Tech fehlt
});
```

### 3.3 Fromit: API-Response → ColonyGrid

```javascript
// Aus buildings.php action=list response befüllen:
function gridFromApiResponse(apiPayload) {
  const layout = apiPayload.layout;
  const cols = layout.grid.cols;
  const rows = layout.grid.rows;
  const grid = new ColonyGrid(cols, rows);

  // Gebäude platzieren (vereinfacht: sequenziell in der Reihenfolge)
  let slotIdx = 0;
  for (const building of apiPayload.buildings) {
    for (let i = 0; i < (building.instances ?? 1); i++) {
      const slot = grid.slots[slotIdx++];
      if (!slot) break;
      slot.buildingType  = building.type;
      slot.buildingLevel = building.level ?? 1;
      slot.state = SlotState.OCCUPIED;
      slot.districtClass = building.meta.class_key;
    }
  }
  // Laufende Bauprojekte
  for (const q of apiPayload.upgrade_queue) {
    if (q.status === 'running') {
      const slot = grid.slots[slotIdx++];
      if (slot) {
        slot.buildingType = q.type;
        slot.state = SlotState.CONSTRUCTING;
        slot.constructProgress = q.progress ?? 0.5;
      }
    }
  }
  // Verbleibende Slots: Distrikt-Klasse zuweisen
  const classCaps = layout.class_caps;
  // ... Verteilungslogik nach classCaps
  return grid;
}
```

---

## 4. WebGPU Rendering Pipeline

### 4.1 Pipeline-Übersicht

Der `ColonyGridRenderer` nutzt **drei separate Render-Passes**:

```
Frame N:
  Pass 1: GROUND TILES  (instanced quads, Boden-Raster)
  Pass 2: BUILDING MESH (instanced buildings, pro Typ gebündelt)
  Pass 3: OVERLAY PASS  (Construction-Glow, Selection-Highlight, Hover)
  Post:   EffectComposer (SSAO + Bloom + optionales Vignette)
```

### 4.2 Render-Pipeline-Descriptor (WGSL)

```javascript
// building_grid.wgsl — Render Pipeline für Tiles und Buildings

// Vertex-Buffer-Layout (Ground Tiles = flat quad + instanced position):
const groundTileLayout = {
  arrayStride: 32,  // pos(12) + uv(8) + districtColor(12)
  attributes: [
    { shaderLocation: 0, offset: 0,  format: 'float32x3' },  // position
    { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
    { shaderLocation: 2, offset: 20, format: 'float32x3' },  // district color
  ],
};

// Instance-Buffer-Layout (Slot-States):
const slotInstanceLayout = {
  arrayStride: 32,   // 8 × f32
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 3, offset: 0,  format: 'float32x3' },  // worldPos
    { shaderLocation: 4, offset: 12, format: 'float32'   },  // state (0=empty, 1=occupied, ...)
    { shaderLocation: 5, offset: 16, format: 'float32'   },  // constructProgress
    { shaderLocation: 6, offset: 20, format: 'float32'   },  // selected (0/1)
    { shaderLocation: 7, offset: 24, format: 'float32'   },  // hovered (0/1)
    { shaderLocation: 8, offset: 28, format: 'float32'   },  // pad
  ],
};
```

### 4.3 Bind-Group-Layout

```javascript
// Bind Group 0: Frame-Uniforms (Kamera, Zeit, globale Parameter)
const frameBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' } },  // GridFrameUniforms
  ],
});

// Bind Group 1: Building-Typ-spezifische Daten
const buildingBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX,
      buffer: { type: 'read-only-storage' } },  // BuildingInstanceBuffer (pro Typ)
    { binding: 1, visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'uniform' } },             // BuildingMaterialUniforms
  ],
});
```

---

## 5. WGSL Shader

### 5.1 `building_grid.wgsl` — Ground Tile Shader

```wgsl
// ============================================================
// building_grid.wgsl — Ground Tiles + Slot-State Overlay
// Instanced unit quads, one per grid slot.
// ============================================================

// ── Uniform Block ────────────────────────────────────────────
struct GridFrameUniforms {
  viewProj    : mat4x4<f32>,   // 64 bytes
  cameraPos   : vec3<f32>,     //
  time        : f32,           //
  tileSize    : f32,
  gridCols    : f32,
  gridRows    : f32,
  _pad        : f32,
};
@group(0) @binding(0) var<uniform> frame : GridFrameUniforms;

// ── Instance Data (one per slot, storage buffer) ─────────────
struct SlotInstance {
  worldPos          : vec3<f32>,
  state             : f32,    // 0=EMPTY,1=OCCUPIED,2=CONSTRUCTING,3=DAMAGED,4=LOCKED
  constructProgress : f32,
  selected          : f32,
  hovered           : f32,
  districtId        : f32,    // 0-6 district class index → color lookup
};
@group(1) @binding(0) var<storage, read> slots : array<SlotInstance>;

// ── Vertex Shader ─────────────────────────────────────────────
struct VertexOut {
  @builtin(position) clipPos  : vec4<f32>,
  @location(0)       worldPos : vec3<f32>,
  @location(1)       uv       : vec2<f32>,
  @location(2)       state    : f32,
  @location(3)       progress : f32,
  @location(4)       selected : f32,
  @location(5)       hovered  : f32,
  @location(6)       districtId : f32,
};

// Unit quad vertices (CCW winding, Y=0 plane)
const QUAD_POS = array<vec2<f32>, 4>(
  vec2<f32>(-0.5, -0.5),
  vec2<f32>( 0.5, -0.5),
  vec2<f32>( 0.5,  0.5),
  vec2<f32>(-0.5,  0.5),
);
const QUAD_UV = array<vec2<f32>, 4>(
  vec2<f32>(0.0, 0.0),
  vec2<f32>(1.0, 0.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(0.0, 1.0),
);
const QUAD_IDX = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);

@vertex
fn vs_tile(
  @builtin(vertex_index)   vertIdx     : u32,
  @builtin(instance_index) instanceIdx : u32,
) -> VertexOut {
  let slot     = slots[instanceIdx];
  let quadIdx  = QUAD_IDX[vertIdx % 6u];
  let localPos = vec3<f32>(QUAD_POS[quadIdx].x * frame.tileSize * 0.98,
                           0.0,
                           QUAD_POS[quadIdx].y * frame.tileSize * 0.98);
  let worldPos = localPos + slot.worldPos;

  var out : VertexOut;
  out.clipPos    = frame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos   = worldPos;
  out.uv         = QUAD_UV[quadIdx];
  out.state      = slot.state;
  out.progress   = slot.constructProgress;
  out.selected   = slot.selected;
  out.hovered    = slot.hovered;
  out.districtId = slot.districtId;
  return out;
}

// ── District Colors ───────────────────────────────────────────
const DISTRICT_COLORS = array<vec3<f32>, 7>(
  vec3<f32>(0.25, 0.18, 0.12),  // 0: industrial — dunkles Orange
  vec3<f32>(0.12, 0.22, 0.15),  // 1: civic      — dunkles Grün
  vec3<f32>(0.12, 0.18, 0.28),  // 2: utility    — dunkles Blau
  vec3<f32>(0.18, 0.12, 0.28),  // 3: science    — dunkles Violett
  vec3<f32>(0.28, 0.12, 0.12),  // 4: military   — dunkles Rot
  vec3<f32>(0.20, 0.20, 0.20),  // 5: orbital    — Grau
  vec3<f32>(0.16, 0.16, 0.16),  // 6: flex       — Dunkelgrau
);

// ── Fragment Shader ───────────────────────────────────────────
@fragment
fn fs_tile(in : VertexOut) -> @location(0) vec4<f32> {
  let districtId  = u32(in.districtId) % 7u;
  var baseColor   = DISTRICT_COLORS[districtId];

  // Tile-Raster-Linie (1px Rand)
  let border = step(0.96, max(abs(in.uv.x * 2.0 - 1.0), abs(in.uv.y * 2.0 - 1.0)));
  baseColor  = mix(baseColor, vec3<f32>(0.05, 0.05, 0.05), border * 0.7);

  // Zustands-Overlay
  var alpha = 1.0;
  if (in.state < 0.5) {
    // EMPTY — leerer Slot, etwas transparenter
    alpha = 0.7;
  } else if (in.state > 1.5 && in.state < 2.5) {
    // CONSTRUCTING — Pulsierender Cyan-Glow
    let pulse = 0.5 + 0.5 * sin(frame.time * 3.0 + in.worldPos.x + in.worldPos.z);
    baseColor += vec3<f32>(0.0, 0.3, 0.5) * pulse * 0.6;
    // Progress-Bar auf Tile
    let progressLine = step(in.uv.y, 0.08) * step(in.uv.x, in.progress);
    baseColor        = mix(baseColor, vec3<f32>(0.1, 0.9, 0.4), progressLine * 0.8);
  } else if (in.state > 2.5 && in.state < 3.5) {
    // DAMAGED — Rötliche Färbung
    baseColor = mix(baseColor, vec3<f32>(0.8, 0.1, 0.05), 0.4);
  } else if (in.state > 3.5) {
    // LOCKED — Dunkel + gestrichelt
    baseColor *= 0.4;
  }

  // Selection Highlight
  if (in.selected > 0.5) {
    let pulse = 0.5 + 0.5 * sin(frame.time * 4.0);
    baseColor = mix(baseColor, vec3<f32>(1.0, 0.85, 0.2), 0.5 + 0.2 * pulse);
    // Rand heller
    baseColor += vec3<f32>(0.6, 0.5, 0.1) * border;
  }

  // Hover Highlight
  if (in.hovered > 0.5) {
    baseColor = mix(baseColor, vec3<f32>(1.0, 1.0, 1.0), 0.15);
  }

  return vec4<f32>(baseColor, alpha);
}
```

### 5.2 `building_mesh.wgsl` — 3D-Gebäude-Shader

```wgsl
// ============================================================
// building_mesh.wgsl — Instanced 3D Building Meshes
// One draw call per building type; instance data: position,
// tint, state, emissive intensity.
// ============================================================

struct GridFrameUniforms {
  viewProj  : mat4x4<f32>,
  cameraPos : vec3<f32>,
  time      : f32,
};
@group(0) @binding(0) var<uniform> frame : GridFrameUniforms;

struct BuildingInstance {
  worldPos   : vec3<f32>,
  state      : f32,     // 0=normal,1=constructing,2=damaged
  tint       : vec3<f32>,
  emissive   : f32,     // 0.0 normal, 1.0 max glow (construction)
  alpha      : f32,     // 1.0 normal, 0→1 during placement animation
  _pad       : vec3<f32>,
};
@group(1) @binding(0) var<storage, read> instances : array<BuildingInstance>;

struct MaterialUniforms {
  albedo    : vec4<f32>,
  metallic  : f32,
  roughness : f32,
  emissive  : vec3<f32>,
  _pad      : f32,
};
@group(1) @binding(1) var<uniform> mat : MaterialUniforms;

struct BuildingVert {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
  @location(3) color    : vec4<f32>,
};

struct FragIn {
  @builtin(position) clipPos    : vec4<f32>,
  @location(0)       worldPos   : vec3<f32>,
  @location(1)       worldNormal: vec3<f32>,
  @location(2)       uv         : vec2<f32>,
  @location(3)       baseColor  : vec4<f32>,
  @location(4)       emissive   : f32,
  @location(5)       state      : f32,
  @location(6)       alpha      : f32,
};

@vertex
fn vs_building(vert : BuildingVert, @builtin(instance_index) iIdx : u32) -> FragIn {
  let inst     = instances[iIdx];
  // Building placed at slot center, Y offset on top of tile
  let worldPos = vert.position + inst.worldPos + vec3<f32>(0.0, 0.02, 0.0);

  // Construction animation: scale-in from 0 to 1
  let scaleY = mix(0.0, 1.0, inst.alpha);

  var out : FragIn;
  out.clipPos     = frame.viewProj * vec4<f32>(
    inst.worldPos.x + vert.position.x,
    vert.position.y * scaleY + inst.worldPos.y,
    inst.worldPos.z + vert.position.z,
    1.0
  );
  out.worldPos    = worldPos;
  out.worldNormal = normalize(vert.normal);
  out.uv          = vert.uv;
  out.baseColor   = vec4<f32>(vert.color.rgb * inst.tint * mat.albedo.rgb, inst.alpha);
  out.emissive    = inst.emissive;
  out.state       = inst.state;
  out.alpha       = inst.alpha;
  return out;
}

// Simple PBR-light (single directional — Sonne/Planeten-Stern)
const SUN_DIR    = normalize(vec3<f32>(0.6, 1.0, 0.4));
const AMBIENT    = vec3<f32>(0.25, 0.28, 0.35);

@fragment
fn fs_building(in : FragIn) -> @location(0) vec4<f32> {
  if (in.alpha < 0.01) { discard; }

  let N        = normalize(in.worldNormal);
  let diffuse  = max(0.0, dot(N, SUN_DIR));
  var color    = in.baseColor.rgb * (AMBIENT + diffuse * 0.75);

  // Construction glow (emissive overlay)
  let pulse    = 0.5 + 0.5 * sin(frame.time * 2.5);
  color       += mat.emissive * in.emissive * (0.6 + 0.4 * pulse);

  // Damage state: desaturate + darken
  if (in.state > 1.5 && in.state < 2.5) {
    let luma = dot(color, vec3<f32>(0.299, 0.587, 0.114));
    color    = mix(color, vec3<f32>(luma * 0.5), 0.5);
  }

  return vec4<f32>(color, in.alpha);
}
```

### 5.3 `building_pick.wgsl` — Picking-Shader (Object-ID in Render-Target)

```wgsl
// ============================================================
// building_pick.wgsl — GPU Picking Pass
// Renders each grid slot as a colored quad where the color
// encodes the slot index (R+G = 16-bit index, B = slot type).
// CPU reads back a single pixel to identify hovered slot.
// ============================================================

struct GridFrameUniforms {
  viewProj : mat4x4<f32>,
  tileSize : f32,
};
@group(0) @binding(0) var<uniform> frame : GridFrameUniforms;

struct SlotInstance {
  worldPos : vec3<f32>,
  slotIdx  : f32,
};
@group(1) @binding(0) var<storage, read> slots : array<SlotInstance>;

@vertex
fn vs_pick(@builtin(vertex_index) vIdx : u32, @builtin(instance_index) iIdx : u32) -> @builtin(position) vec4<f32> {
  // (same quad expansion as building_grid.wgsl)
  let slot = slots[iIdx];
  // ... quad expansion ...
  return frame.viewProj * vec4<f32>(0.0, 0.0, 0.0, 1.0); // placeholder
}

@fragment
fn fs_pick(@builtin(position) pos : vec4<f32>, @builtin(instance_index) iIdx : u32) -> @location(0) vec4<f32> {
  let idx = u32(slots[iIdx].slotIdx);
  let r = f32(idx & 0xFFu) / 255.0;
  let g = f32((idx >> 8u) & 0xFFu) / 255.0;
  let b = 0.5;  // marker channel
  return vec4<f32>(r, g, b, 1.0);
}
```

---

## 6. Instanced Rendering — Slot-Buffer

### 6.1 Slot-Instance-Buffer Layout

Jeder Grid-Slot wird als eine Instanz im Storage-Buffer gehalten. Das Layout folgt dem Muster aus `BeamEffect.js`:

```javascript
/**
 * Slot-Instance-Buffer: 64 Bytes pro Slot (16 × f32)
 *
 * Offset | Bytes | Feld
 * -------|-------|-----
 *   0    |  12   | worldPos (vec3)
 *  12    |   4   | state (f32: 0=EMPTY,1=OCCUPIED,2=CONSTRUCTING,3=DAMAGED,4=LOCKED)
 *  16    |   4   | constructProgress (0.0..1.0)
 *  20    |   4   | selected (0.0 / 1.0)
 *  24    |   4   | hovered  (0.0 / 1.0)
 *  28    |   4   | districtId (0..6)
 *  32    |  12   | tint (vec3 — colony-type color mult)
 *  44    |   4   | emissiveIntensity (0.0..1.0)
 *  48    |  12   | _pad
 *  60    |   4   | slotIdx (f32 — for picking)
 * Total: 64 bytes = 16 × f32
 */

const FLOATS_PER_SLOT = 16;

// Field offsets
const FS_WORLD_X     =  0;
const FS_WORLD_Y     =  1;
const FS_WORLD_Z     =  2;
const FS_STATE       =  3;
const FS_PROGRESS    =  4;
const FS_SELECTED    =  5;
const FS_HOVERED     =  6;
const FS_DISTRICT_ID =  7;
const FS_TINT_R      =  8;
const FS_TINT_G      =  9;
const FS_TINT_B      = 10;
const FS_EMISSIVE    = 11;
// 12-14 = pad
const FS_SLOT_IDX    = 15;
```

### 6.2 Buffer-Erstellungs- und Update-Logik

```javascript
class ColonyGridRenderer {
  _initInstanceBuffer(grid) {
    const count = grid.cols * grid.rows;
    this._instanceData = new Float32Array(count * FLOATS_PER_SLOT);
    this._gpuSlotBuffer = new WebGPUBuffer(
      this._device,
      BufferType.STORAGE,
      this._instanceData,
      BufferUsage.DYNAMIC
    );
  }

  /** Called each frame or when grid state changes */
  _updateInstanceBuffer(grid) {
    const buf = this._instanceData;
    const tileSize = this._tileSize;

    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const slot = grid.getSlot(col, row);
        const base = (row * grid.cols + col) * FLOATS_PER_SLOT;

        buf[base + FS_WORLD_X]     = (col + 0.5) * tileSize;
        buf[base + FS_WORLD_Y]     = 0.0;
        buf[base + FS_WORLD_Z]     = (row + 0.5) * tileSize;
        buf[base + FS_STATE]       = slot.state;
        buf[base + FS_PROGRESS]    = slot.constructProgress;
        buf[base + FS_SELECTED]    = slot.selected ? 1.0 : 0.0;
        buf[base + FS_HOVERED]     = slot.hovered  ? 1.0 : 0.0;
        buf[base + FS_DISTRICT_ID] = DISTRICT_CLASS_ID[slot.districtClass] ?? 6;
        buf[base + FS_TINT_R]      = 1.0;
        buf[base + FS_TINT_G]      = 1.0;
        buf[base + FS_TINT_B]      = 1.0;
        buf[base + FS_EMISSIVE]    = slot.state === SlotState.CONSTRUCTING ? 1.0 : 0.0;
        buf[base + FS_SLOT_IDX]    = row * grid.cols + col;
      }
    }

    this._gpuSlotBuffer.update(this._instanceData);
  }
}
```

### 6.3 Building-Instance-Buffer (pro Typ)

Für jede Gebäudekategorie (z.B. alle `alloy_foundry`-Instanzen) wird ein separater Instance-Buffer gehalten:

```javascript
// Separate instance buffer per building type for batch draw calls
// Layout: 48 bytes = 12 × f32
// worldPos(12) + state(4) + tint(12) + emissive(4) + alpha(4) + slotIdx(4) + pad(8)

class BuildingInstanceBatch {
  constructor(device, buildingType, maxInstances = 64) {
    this.type = buildingType;
    this._data = new Float32Array(maxInstances * 12);
    this._gpuBuffer = new WebGPUBuffer(device, BufferType.STORAGE, this._data, BufferUsage.DYNAMIC);
    this.liveCount = 0;
  }

  clear() { this.liveCount = 0; }

  addInstance(worldPos, state, tint, emissive, alpha, slotIdx) {
    const base = this.liveCount * 12;
    this._data[base + 0] = worldPos[0];
    this._data[base + 1] = worldPos[1];
    this._data[base + 2] = worldPos[2];
    this._data[base + 3] = state;
    this._data[base + 4] = tint[0];
    this._data[base + 5] = tint[1];
    this._data[base + 6] = tint[2];
    this._data[base + 7] = emissive;
    this._data[base + 8] = alpha;
    this._data[base + 9] = slotIdx;
    // 10-11 pad
    this.liveCount++;
  }

  uploadToGPU() {
    if (this.liveCount > 0) {
      this._gpuBuffer.update(this._data.subarray(0, this.liveCount * 12));
    }
  }
}
```

---

## 7. ColonyGridRenderer Klasse

### 7.1 Vollständige Klassen-API

```javascript
/**
 * ColonyGridRenderer — WebGPU-basierter Colony-Grid-3D-Renderer
 *
 * Rendert ein Stellaris-artiges Kolonieraster mit isometrischer Kamera,
 * instanced 3D-Gebäuden (aus BuildingMeshLibrary), Slot-Zustand-Overlays,
 * GPU-Picking und Post-FX (SSAO + Bloom).
 *
 * Verwendungsbeispiel:
 *   const renderer = new ColonyGridRenderer(gpuDevice, canvas);
 *   await renderer.init();
 *   renderer.loadGrid(colonyGrid, colonyData);
 *   // Im Animation-Loop:
 *   renderer.render(dt);
 *
 * License: MIT — makr-code/GalaxyQuest
 */
class ColonyGridRenderer {

  // ── Initialisierung ─────────────────────────────────────────────────────

  /**
   * @param {GPUDevice}    device
   * @param {HTMLCanvasElement} canvas
   * @param {object}       [opts]
   * @param {number}       [opts.tileSize=1.0]
   * @param {number}       [opts.maxSlots=256]
   * @param {boolean}      [opts.enableSSAO=true]
   * @param {boolean}      [opts.enableBloom=true]
   */
  constructor(device, canvas, opts = {}) {}

  async init() {
    await this._initShaders();       // Compile WGSL modules (cached)
    await this._initMeshLibrary();   // Load + bake building JSONs
    this._initRenderTargets();       // Depth texture, MSAA resolve target
    this._initPostFx();              // EffectComposer (SSAO + Bloom)
    this._initCamera();              // IsoCameraController
    this._initPickingBuffer();       // Single-pixel readback buffer
  }

  // ── Grid State ──────────────────────────────────────────────────────────

  /** @param {ColonyGrid} grid  @param {object} colonyData (API-Response) */
  loadGrid(grid, colonyData) {}

  /** Partial update: mark specific slots dirty and re-upload only changed slots */
  updateSlot(col, row, slotData) {}

  /** Called after API confirms build placed — starts construction animation */
  onBuildStarted(col, row, buildingType) {}

  /** Called when construction finishes */
  onBuildCompleted(col, row) {}

  // ── Render Loop ─────────────────────────────────────────────────────────

  /**
   * Main render entry point — call each animation frame.
   * @param {number} dt  Delta-time in seconds
   */
  render(dt) {
    this._time += dt;
    this._updateInstanceBuffers();   // CPU→GPU slot + building data
    this._updateAnimations(dt);      // Construction animations, smoke emitters
    this._encodeFrame();             // Record + submit command buffer
  }

  /** @private */
  _encodeFrame() {
    const commandEncoder = this._device.createCommandEncoder();

    // Pass 1: Ground tiles
    this._renderGroundTiles(commandEncoder);

    // Pass 2: Building meshes (batched by type)
    this._renderBuildingMeshes(commandEncoder);

    // Pass 3: Overlay (construction progress bars, selection outlines)
    this._renderOverlay(commandEncoder);

    // Post-FX
    this._effectComposer.render(commandEncoder);

    this._device.queue.submit([commandEncoder.finish()]);
  }

  // ── Ground Tile Pass ────────────────────────────────────────────────────

  /** @private */
  _renderGroundTiles(enc) {
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this._resolveTarget.createView(),
        loadOp: 'clear',
        clearValue: { r: 0.05, g: 0.07, b: 0.1, a: 1.0 },
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this._groundTilePipeline);
    pass.setBindGroup(0, this._frameBindGroup);     // Frame uniforms
    pass.setBindGroup(1, this._slotBindGroup);      // Slot instance storage
    pass.setVertexBuffer(0, this._quadVertexBuffer.gpuBuffer);
    pass.setIndexBuffer(this._quadIndexBuffer.gpuBuffer, 'uint16');
    pass.drawIndexed(6, this._grid.cols * this._grid.rows); // 6 indices, N instances
    pass.end();
  }

  // ── Building Mesh Pass ──────────────────────────────────────────────────

  /** @private */
  _renderBuildingMeshes(enc) {
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this._resolveTarget.createView(),
        loadOp: 'load',  // Preserve ground tiles
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this._depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this._buildingMeshPipeline);
    pass.setBindGroup(0, this._frameBindGroup);

    for (const [type, batch] of this._buildingBatches) {
      if (batch.liveCount === 0) continue;
      const lod = this._getLodLevel(type);
      const gpuBuffers = this._meshLibrary.getGPUBuffers(type, lod);
      if (!gpuBuffers) continue;

      pass.setBindGroup(1, this._buildingBindGroups.get(type));
      pass.setVertexBuffer(0, gpuBuffers.vertices);
      pass.setIndexBuffer(gpuBuffers.indices, 'uint32');
      pass.drawIndexed(gpuBuffers.indexCount, batch.liveCount);
    }
    pass.end();
  }

  // ── Camera ───────────────────────────────────────────────────────────────

  /** Center camera on a specific slot */
  focusSlot(col, row) {}

  /** @returns {IsoCameraController} */
  get camera() { return this._camera; }

  // ── Picking ──────────────────────────────────────────────────────────────

  /** GPU-Picking: identify slot under mouse cursor */
  async pickSlotAtScreenPos(screenX, screenY) {}

  // ── Placement Preview ────────────────────────────────────────────────────

  /** Show ghost/preview of building-to-be-placed over hovered slot */
  showPlacementPreview(buildingType, col, row) {}
  hidePlacementPreview() {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  resize(width, height) {}
  destroy() {}
}
```

---

## 8. Kamera & Projektion

### 8.1 IsoCameraController

Die Kamera verwendet eine **isometrische Perspektive** (feste 30° Elevation, rotierbar um Y-Achse), inspiriert von Stellaris' Planetenansicht:

```javascript
class IsoCameraController {
  /**
   * @param {PerspectiveCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {object} [opts]
   * @param {number} [opts.fov=45]           Sichtfeld
   * @param {number} [opts.elevation=30]     Kamera-Elevation in Grad
   * @param {number} [opts.minZoom=3]        Minimale Zoom-Distanz
   * @param {number} [opts.maxZoom=40]       Maximale Zoom-Distanz
   * @param {number} [opts.panSpeed=0.015]   Pan-Geschwindigkeit
   * @param {number} [opts.rotateSpeed=0.3]  Rotations-Geschwindigkeit
   */
  constructor(camera, canvas, opts = {}) {
    this._camera    = camera;
    this._canvas    = canvas;
    this._elevation = opts.elevation ?? 30;   // Grad
    this._azimuth   = opts.azimuth   ?? 45;   // Grad (isometrische Startposition)
    this._distance  = opts.distance  ?? 15;
    this._target    = { x: 0, y: 0, z: 0 };   // Fokuspunkt
    this._minZoom   = opts.minZoom   ?? 3;
    this._maxZoom   = opts.maxZoom   ?? 40;

    this._registerInputHandlers();
  }

  _updateCamera() {
    const elRad = (this._elevation * Math.PI) / 180;
    const azRad = (this._azimuth   * Math.PI) / 180;

    const camX = this._target.x + this._distance * Math.cos(elRad) * Math.sin(azRad);
    const camY = this._target.y + this._distance * Math.sin(elRad);
    const camZ = this._target.z + this._distance * Math.cos(elRad) * Math.cos(azRad);

    this._camera.position.set(camX, camY, camZ);
    this._camera.lookAt(this._target.x, this._target.y, this._target.z);
  }

  /** Mouse-Wheel: Zoom */
  _onWheel(e) {
    this._distance = Math.max(this._minZoom, Math.min(this._maxZoom,
      this._distance * (1 + e.deltaY * 0.001)));
    this._updateCamera();
  }

  /** Right-Mouse-Drag: Rotate Azimuth */
  /** Middle-Mouse-Drag: Pan Target */
  /** Left-Mouse-Click: Pick Slot */
}
```

### 8.2 View-Projection-Matrix-Upload

```javascript
// Uniform buffer (GridFrameUniforms): 80 Bytes
// viewProj (64B) + cameraPos (12B) + time (4B) + tileSize (4B) + ...

_updateFrameUniforms() {
  const mat = this._camera.viewProjectionMatrix; // Matrix4
  const buf = this._frameUniformData; // Float32Array(20)
  buf.set(mat.elements, 0);  // viewProj 16 floats at offset 0
  buf[16] = this._camera.position.x;
  buf[17] = this._camera.position.y;
  buf[18] = this._camera.position.z;
  buf[19] = this._time;
  this._frameUniformBuffer.update(buf);
}
```

---

## 9. Interaktion (Picking & Selection)

### 9.1 GPU-Picking-Pass

Der Picking-Pass rendert jeden Slot mit einer einzigartigen Farbe (codiert den Slot-Index). Bei Mausbewegung wird ein einzelner Pixel ausgelesen:

```javascript
async pickSlotAtScreenPos(screenX, screenY) {
  // 1. Render picking pass into R8G8B8A8 texture
  const pickingEncoder = this._device.createCommandEncoder();
  this._renderPickingPass(pickingEncoder);
  this._device.queue.submit([pickingEncoder.finish()]);

  // 2. Copy single pixel to readback buffer
  const readbackEncoder = this._device.createCommandEncoder();
  readbackEncoder.copyTextureToBuffer(
    { texture: this._pickingTexture, origin: { x: screenX, y: screenY, z: 0 } },
    { buffer: this._pickingReadbackBuffer, bytesPerRow: 256 },
    { width: 1, height: 1 }
  );
  this._device.queue.submit([readbackEncoder.finish()]);

  // 3. Map and read pixel
  await this._pickingReadbackBuffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(this._pickingReadbackBuffer.getMappedRange());
  const slotIdx = bytes[0] | (bytes[1] << 8);
  this._pickingReadbackBuffer.unmap();

  if (bytes[2] < 100) return null;  // not our picking marker
  return slotIdx < this._grid.slots.length ? slotIdx : null;
}
```

### 9.2 Click-to-Select Workflow

```javascript
canvas.addEventListener('click', async (e) => {
  const rect   = canvas.getBoundingClientRect();
  const slotIdx = await renderer.pickSlotAtScreenPos(
    Math.floor(e.clientX - rect.left),
    Math.floor(e.clientY - rect.top)
  );
  if (slotIdx !== null) {
    const slot = grid.slots[slotIdx];
    emit('colony:slot:selected', { slot, col: slot.col, row: slot.row });
    renderer.setSelectedSlot(slotIdx);
  }
});
```

### 9.3 Hover (Mousemove — Throttled)

Hover-Detection läuft **nicht** per Frame (zu teuer für GPU-Readback), sondern throttled auf 60ms:

```javascript
let hoverTimeout = null;
canvas.addEventListener('mousemove', (e) => {
  if (hoverTimeout) return;
  hoverTimeout = setTimeout(async () => {
    hoverTimeout = null;
    const rect = canvas.getBoundingClientRect();
    const slotIdx = await renderer.pickSlotAtScreenPos(
      Math.floor(e.clientX - rect.left),
      Math.floor(e.clientY - rect.top)
    );
    renderer.setHoveredSlot(slotIdx);
  }, 60);
});
```

---

## 10. Animationen & Building-States

### 10.1 Construction-Animation

Wenn ein Gebäude gebaut wird (`SlotState.CONSTRUCTING`), erscheint es mit einem **Scale-in + Glow-Effekt**:

```javascript
class BuildingAnimation {
  constructor(type) {
    this.type = type;
    this.phase = 'constructing';  // 'constructing' | 'idle' | 'damaged'
    this.progress = 0.0;          // Construction progress 0→1
    this.scaleY   = 0.0;          // Y-scale: animiert von 0→1
    this.emissive = 1.0;          // Glow-Intensität
    this.alpha    = 0.0;          // Transparenz: 0→1
  }

  tick(dt, buildProgress) {
    this.progress = buildProgress;
    if (this.phase === 'constructing') {
      // Scale-in: Gebäude wächst langsam empor
      this.scaleY = Math.min(1.0, this.scaleY + dt * 0.3);
      this.alpha  = Math.min(1.0, this.alpha  + dt * 0.5);
      // Emissive pulsiert mit Baufortschritt
      this.emissive = 0.5 + 0.5 * Math.sin(Date.now() * 0.003);
      if (buildProgress >= 1.0) {
        this.phase   = 'idle';
        this.scaleY  = 1.0;
        this.alpha   = 1.0;
        this.emissive = 0.0;
      }
    }
  }
}
```

### 10.2 Smoke-Emitter (Partikel-Integration)

Aktive Gebäude emittieren Rauch aus ihren Schloten, indem die `GPUParticleSystem`-Infrastruktur (bereits implementiert) genutzt wird:

```javascript
// Smoke emit points aus building_json.animations.idle.emitPoints
_updateSmokeEmitters(dt) {
  for (const slot of this._grid.slots) {
    if (slot.state !== SlotState.OCCUPIED) continue;
    const buildingDef = this._meshLibrary.getDefinition(slot.buildingType);
    const idleAnim = buildingDef?.animations?.idle;
    if (!idleAnim || idleAnim.type !== 'smoke_emit') continue;

    const slotWorldPos = this._slotWorldPos(slot.col, slot.row);
    for (const emitPt of idleAnim.emitPoints) {
      this._particleSystem.emit({
        position: [
          slotWorldPos.x + emitPt.pos[0],
          slotWorldPos.y + emitPt.pos[1],
          slotWorldPos.z + emitPt.pos[2],
        ],
        velocity: [0, 0.3, 0],
        spread: 0.1,
        color:  emitPt.color,
        rate:   emitPt.rate,
        lifetime: 3.0,
        size:   0.15,
      });
    }
  }
}
```

---

## 11. LOD-System

### 11.1 LOD-Selektierung

Jedes Gebäude-JSON definiert bis zu 3 LOD-Stufen. Die aktive LOD-Stufe wird pro Typ berechnet (alle Instanzen eines Typs nutzen dieselbe LOD):

```javascript
_getLodLevel(buildingType) {
  // Nutze die durchschnittliche Kamera-Distanz zu den Instanzen dieses Typs
  const batch = this._buildingBatches.get(buildingType);
  if (!batch || batch.liveCount === 0) return 0;

  // Kamera-Distanz zum Grid-Zentrum (konservative Näherung)
  const dist = this._camera.distanceTo(this._gridCenter);

  const def = this._meshLibrary.getDefinition(buildingType);
  for (let lod = 0; lod < def.lods.length; lod++) {
    if (dist <= def.lods[lod].maxDistance) return lod;
  }
  return def.lods.length - 1;
}
```

### 11.2 LOD-Übergänge

LOD-Wechsel werden weich geblendet via `alpha`-Interpolation:

```javascript
// LOD-Blend: Alpha bleibt 1.0 außer bei LOD-Wechsel (kurze 200ms Überblendung)
// Implementiert als simplen Zeitstempel-Vergleich pro Gebäudetyp
```

---

## 12. Integration in ViewportManager / PiP

Das Colony-Grid-Fenster erscheint als **PiP-Viewport** (wie andere WM-Windows), managed durch den bestehenden `ViewportManager`:

```javascript
// Registrierung als PiP-Viewport (in game.js ColonyGridController)
class ColonyGridController {
  constructor(wm, renderer) {
    this._wm = wm;
    this._gridRenderer = null;
    this._pipId = null;
  }

  async openForColony(colonyId) {
    // API-Daten laden
    const apiData = await API.buildings(colonyId);
    const grid = gridFromApiResponse(apiData);

    // Canvas für den Renderer erstellen (im WM-Fenster)
    const canvas = this._wm.getWindowCanvas('colony_grid');

    // Renderer initialisieren
    this._gridRenderer = new ColonyGridRenderer(window._gpuDevice, canvas, {
      tileSize: 1.0,
      enableSSAO: true,
      enableBloom: true,
    });
    await this._gridRenderer.init();
    this._gridRenderer.loadGrid(grid, apiData);

    // PiP registrieren
    this._pipId = ViewportManager.registerPip({
      canvas,
      rect: { x: 200, y: 100, width: 800, height: 600 },
      scene: null,   // ColonyGridRenderer manages its own scene
      camera: this._gridRenderer.camera,
      renderFn: (dt) => this._gridRenderer.render(dt),
    });

    // Slot-Klick → Baumenü öffnen
    canvas.addEventListener('click', async (e) => {
      const rect = canvas.getBoundingClientRect();
      const slotIdx = await this._gridRenderer.pickSlotAtScreenPos(
        Math.floor(e.clientX - rect.left),
        Math.floor(e.clientY - rect.top)
      );
      if (slotIdx !== null) this._onSlotClicked(grid.slots[slotIdx]);
    });
  }

  _onSlotClicked(slot) {
    if (slot.state === SlotState.EMPTY) {
      this._wm.open('build_menu', { slot, colonyId: this._colonyId });
    } else if (slot.state === SlotState.OCCUPIED) {
      this._wm.open('building_detail', { slot });
    }
  }
}
```

---

## 13. Post-Processing für das Grid

### 13.1 EffectComposer-Konfiguration

Das Colony-Grid nutzt den bestehenden `EffectComposer` mit angepassten Parametern:

```javascript
_initPostFx() {
  this._composer = new EffectComposer(this._device, this._canvas.width, this._canvas.height);

  // SSAO: leichte Schatten unter Gebäuden
  this._composer.addPass(new SSAOPass({
    radius:    0.3,
    bias:      0.01,
    intensity: 0.6,
    kernelSize: 16,
  }));

  // Bloom: Construction-Glow + Emissive-Materialien
  this._composer.addPass(new BloomPass({
    threshold: 0.7,
    strength:  0.4,
    radius:    0.3,
  }));

  // Optional: leichte Vignette für Fokus auf Grid-Zentrum
  this._composer.addPass(new VignettePass({
    darkness: 0.3,
    falloff:  0.6,
  }));
}
```

---

## 14. Datei-Struktur & Exports

### 14.1 Neue Dateien

```
js/engine/colony/
├── ColonyGridRenderer.js      — Haupt-Renderer-Klasse (700-800 Zeilen)
├── BuildingMeshLibrary.js     — JSON-Loader + Geometrie-Baking (300 Zeilen)
├── ColonyGrid.js              — Datenmodell (GridSlot, ColonyGrid, SlotState)
├── IsoCameraController.js     — Isometrische Kamera-Steuerung (200 Zeilen)
├── BuildingAnimation.js       — Animations-State-Machine (150 Zeilen)
└── shaders/
    ├── building_grid.wgsl     — Ground Tiles + Slot-Overlay
    ├── building_mesh.wgsl     — 3D-Gebäude-Instanced-Shader
    └── building_pick.wgsl     — GPU-Picking-Pass

data/buildings/
├── alloy_foundry.building.json
├── metal_mine.building.json
├── research_lab.building.json
├── hydroponic_farm.building.json
├── shipyard.building.json
├── fusion_reactor.building.json
├── barracks.building.json
├── ... (ein JSON pro BuildingType)

tests/js/
└── colony-grid.test.js        — Vitest-Tests (ColonyGrid, BuildingMeshLibrary, Shader-Logik)
```

### 14.2 Exports in `js/engine/index.js`

```javascript
// Neue Exports für Colony Grid System:
ColonyGridRenderer, BuildingMeshLibrary,
ColonyGrid, GridSlot, SlotState,
IsoCameraController, BuildingAnimation,
```

---

## 15. Test-Strategie

### 15.1 Vitest-Tests (kein GPU erforderlich)

Tests folgen dem bestehenden Muster aus `tests/webgpu/game-systems.test.js` mit `MockRenderer`:

```javascript
// tests/js/colony-grid.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { ColonyGrid, GridSlot, SlotState } from '../../js/engine/colony/ColonyGrid.js';
import { BuildingMeshLibrary } from '../../js/engine/colony/BuildingMeshLibrary.js';
import { BuildingMeshBaker }   from '../../js/engine/colony/BuildingMeshLibrary.js';

describe('ColonyGrid', () => {
  it('creates grid with correct dimensions', () => {
    const grid = new ColonyGrid(8, 6);
    expect(grid.cols).toBe(8);
    expect(grid.rows).toBe(6);
    expect(grid.slots.length).toBe(48);
  });

  it('slot world positions are correct', () => {
    const grid = new ColonyGrid(4, 4);
    const slot = grid.getSlot(2, 1);
    expect(slot.col).toBe(2);
    expect(slot.row).toBe(1);
  });

  it('slot state transitions are valid', () => {
    const grid = new ColonyGrid(3, 3);
    const slot = grid.getSlot(1, 1);
    expect(slot.state).toBe(SlotState.EMPTY);
    slot.state = SlotState.CONSTRUCTING;
    expect(slot.state).toBe(SlotState.CONSTRUCTING);
  });
});

describe('BuildingMeshBaker', () => {
  it('bakes box primitive correctly', () => {
    const geom = BuildingMeshBaker.bakeBox({ size: [1, 1, 1], offset: [0, 0, 0] });
    expect(geom.positions.length).toBe(24 * 3);  // 24 vertices × 3 floats
    expect(geom.indices.length).toBe(36);          // 6 faces × 2 triangles × 3 indices
  });

  it('merges multiple primitives into one geometry', () => {
    const merged = BuildingMeshBaker.merge([
      BuildingMeshBaker.bakeBox({ size: [1, 0.4, 1],  offset: [0, 0.2, 0] }),
      BuildingMeshBaker.bakeBox({ size: [0.6, 0.15, 0.6], offset: [0, 0.575, 0] }),
    ]);
    expect(merged.positions.length).toBeGreaterThan(0);
    expect(merged.indices.length).toBeGreaterThan(0);
  });

  it('validates building JSON schema', () => {
    const valid = BuildingMeshLibrary.validateSchema({ id: 'test', lods: [], materials: {} });
    expect(valid.ok).toBe(true);
  });
});

describe('SlotInstanceBuffer', () => {
  it('packs slot data correctly into float32 buffer', () => {
    const grid = new ColonyGrid(2, 2);
    grid.getSlot(0, 0).state = SlotState.OCCUPIED;
    const buf = new Float32Array(4 * 16);
    packSlotInstanceBuffer(grid, buf, 1.0);
    // slot 0 at world (0.5, 0, 0.5)
    expect(buf[0]).toBeCloseTo(0.5);  // worldX
    expect(buf[2]).toBeCloseTo(0.5);  // worldZ
    expect(buf[3]).toBe(SlotState.OCCUPIED);
  });
});
```

---

## 16. Implementierungs-Phasen

### Phase W1 — Fundament (2–3 Tage)

- [ ] `js/engine/colony/ColonyGrid.js` — Datenmodell (GridSlot, ColonyGrid, SlotState)
- [ ] `js/engine/colony/BuildingMeshLibrary.js` — JSON-Loader + Primitiv-Baker
- [ ] Erste `data/buildings/*.building.json` (5 Typen: metal_mine, research_lab, habitat, solar_plant, shipyard)
- [ ] `tests/js/colony-grid.test.js` — Unit-Tests für Datenmodell und Baker

### Phase W2 — Ground Tile Renderer (2–3 Tage)

- [ ] `building_grid.wgsl` — Ground-Tile-Shader mit Slot-State-Overlay
- [ ] `js/engine/colony/ColonyGridRenderer.js` (Skeleton) — Init + Ground-Tile-Pass
- [ ] Slot-Instance-Buffer + GPU-Upload-Logik
- [ ] `IsoCameraController.js` — Maus-Zoom/Pan/Rotate
- [ ] Integration in ViewportManager als PiP

### Phase W3 — 3D-Gebäude (3–4 Tage)

- [ ] `building_mesh.wgsl` — Building-Mesh-Shader
- [ ] `BuildingInstanceBatch` — Instanced-Buffer pro Gebäudetyp
- [ ] `BuildingMeshLibrary._uploadToGPU()` — Vertex/Index-Buffer auf GPU hochladen
- [ ] `ColonyGridRenderer._renderBuildingMeshes()` — Instanced Draw Calls
- [ ] Alle 24+ `*.building.json` Dateien erstellen

### Phase W4 — Interaktion & Animation (2–3 Tage)

- [ ] `building_pick.wgsl` + `pickSlotAtScreenPos()` — GPU-Picking
- [ ] Click-to-Select + Hover-Highlight
- [ ] `BuildingAnimation.js` — Construction-Scale-in + Glow
- [ ] Smoke-Emitter-Integration (GPUParticleSystem)
- [ ] Placement-Preview (Ghost-Gebäude über Hover-Slot)

### Phase W5 — Post-FX & Polish (1–2 Tage)

- [ ] EffectComposer-Konfiguration (SSAO + Bloom + Vignette)
- [ ] LOD-Wechsel-Blending
- [ ] `ColonyGridController` in game.js (WM-Integration)
- [ ] Terrain-Höhenvarianz (optionaler Heightmap-Pass)

### Phase W6 — Tests & Optimierung (2 Tage)

- [ ] Vollständige Vitest-Test-Suite (ColonyGrid + Shader-Logik + Baker)
- [ ] Performance-Profiling (Ziel: 60 FPS bei 256 Slots + 100 Gebäuden)
- [ ] CPU→GPU-Upload optimieren (Dirty-Flag-System: nur geänderte Slots neu uploadieren)
- [ ] WebGL-Fallback sicherstellen (BuildingMeshLibrary → Canvas2D-Fallback)

**Gesamt-Estimate:** ~14–17 Entwicklertage für vollständige WebGPU-Implementierung

---

## Anhang A — Vollständiger Render-Loop (Pseudo-Code)

```
Jeder Frame:
  1. camera.update(dt)                    ← Kamera-Position berechnen
  2. _updateFrameUniforms()              ← viewProj + time in Uniform-Buffer
  3. FOR each slot in grid:
       IF slot.dirty: rebuildInstanceSlot() ← Nur geänderte Slots aktualisieren
  4. gpuSlotBuffer.update(instanceData)  ← CPU→GPU-Transfer
  5. FOR each buildingType:
       batch.clear()
       FOR each slot WITH this buildingType:
         animation.tick(dt, slot.progress)
         batch.addInstance(slot.worldPos, state, tint, animation.emissive, animation.alpha)
       batch.uploadToGPU()
  6. smokeEmitters.update(dt)            ← GPUParticleSystem-Emitter
  7. ENCODE COMMAND BUFFER:
     a. Pass 1: drawIndexed(quadIdx, slotCount)   ← Ground Tiles
     b. Pass 2: FOR each type:
                  drawIndexed(buildingIdx, batch.liveCount)  ← Building Meshes
     c. Pass 3: Overlay (Progress-Bars, Selection-Outline)
  8. effectComposer.render(encoder)      ← SSAO + Bloom
  9. device.queue.submit(commandBuffer)
```

---

## Anhang B — Performance-Budgets

| Kategorie | Budget | Begründung |
|---|---|---|
| Max Slots | 256 (16×16) | Typische Kolonie-Größe; erweiterbar durch LOD |
| Max Gebäude-Instanzen gesamt | 200 | Selten alle Slots belegt |
| Slot-Buffer-Upload/Frame | ≤ 16 KB | 256 Slots × 64 Bytes, nur wenn dirty |
| Building-Instance-Upload/Frame | ≤ 48 KB | 200 Instanzen × 48 Bytes pro Typ |
| Vertex-Count Ground Tiles | 6 × 256 = 1.536 | Trivial |
| Vertex-Count Buildings (LOD2) | ≤ 50.000 | 200 inst. × 250 Vtx im LOD2 |
| Vertex-Count Buildings (LOD0) | ≤ 200.000 | 200 inst. × 1.000 Vtx im LOD0 |
| Picking-Pass Overhead | 1× pro 60ms | Nur bei Mausbewegung ausgelöst |
| Ziel-FPS | 60 FPS | Bei 256 Slots + 200 Gebäuden, inkl. SSAO+Bloom |

---

*Dokument-Ende · GalaxyQuest Colony Building WebGPU Design v1.0 · Stand 2026-04-01*
