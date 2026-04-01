# WebGL Engine Analysis — GalaxyQuest

> **Status:** Phase 0 complete — Basis-Analyse & Migration-Vorbereitung  
> **Datum:** 2026-03-30

---

## 1. Ist-Stand der WebGL/Three.js Implementierung

### 1.1 Renderer-Architektur

| Datei | Rolle | Status |
|---|---|---|
| `js/galaxy-renderer-core.js` | Primärer Galaxy-Renderer (Three.js) | ✅ Aktiv |
| `js/galaxy3d.js` | Alter Renderer | ⚠️ Deprecated (2026-03-29) |
| `js/starfield.js` | Auth-Hintergrund (Three.js) | ✅ Aktiv |
| `js/post-effects.js` | PostEffectsManager (EffectComposer) | ⚠️ Deaktiviert (2026-03-29) |
| `js/space-physics-engine.js` | Newtonian Physics (CPU) | ✅ Aktiv |

### 1.2 Verwendete Three.js-Version

```
three@0.160.0 (CDN: cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js)
```

### 1.3 Aktive Rendering-Features

- **ShaderMaterial** mit Custom GLSL für Sterne (spektrale Farben, Doppler-Shift, Colony-Rendering)
- **Points** + **BufferGeometry** für Sternfeld (bis ~9000 Sterne)
- **PerspectiveCamera** mit eigenen OrbitControls
- **AdditiveBlending** für Star-Glow-Effekte
- **Scene-Hierarchie:** World → Galaxy / System Frame Groups
- **Procedural Textures** (DataTexture / Canvas) für Sternoberflächen
- **Post-Processing:** Bloom + Vignette + ChromaticAberration via EffectComposer (aktuell deaktiviert)

### 1.4 Physics-Engine (SpacePhysicsEngine)

Newtonian N-body Simulation in `js/space-physics-engine.js`:

```javascript
// API:
const engine = GQSpacePhysicsEngine.create({ gravitationalConstant: 9.5e-4 });
const body   = engine.createBody({ mass: 1, position: {x,y,z}, velocity: {x,y,z} });
engine.stepBody(body, dtSeconds, { gravitySources: [...], thrust: {x,y,z} });
```

**Berechnungsmodell:**
- Softened Gravity: `F = G·m / (r² + ε²)^(3/2)` (verhindert Singularitäten)
- Drag / Velocity-Damping
- Thrust-Integration (Leapfrog-Approximation)
- Speed-Capping (`maxSpeed`)

**Nutzung:**
- `js/trajectory-planner.js` — Orbitalplanung
- `js/space-camera-flight-driver.js` — Kameraflug
- `js/space-flight-hud-engine.js` — Flug-HUD

**Kritische Beobachtung:** Die N-body Gravitation ist **O(N²)** und läuft rein auf der CPU. Bei >100 gleichzeitigen Körpern (NPCs, Flotten) wird dieser Engpass messbar sein.

---

## 2. Framework-Vergleich (Wikipedia: List of WebGL Frameworks)

Basierend auf: https://en.wikipedia.org/wiki/List_of_WebGL_frameworks

| Framework | Lizenz | WebGL Version | WebXR | Physics | Relevanz für GQ |
|---|---|---|---|---|---|
| **Three.js** *(aktuell)* | MIT | Native 2.0 | ✅ | ❌ | ⭐⭐⭐⭐⭐ — bereits genutzt, WebGPU-Renderer seit r156 |
| **Babylon.js** | Apache 2.0 | Native 1.0+2.0 | ✅ | ✅ | ⭐⭐⭐⭐ — beste WebGPU-Unterstützung, Inspiration für Shader-System |
| **PlayCanvas** | MIT (Engine) | Native 1.0+2.0 | ✅ | ✅ | ⭐⭐⭐ — gutes Render-Pipeline-Design, Cloud-Editor proprietär |
| **A-Frame** | MIT | Native 2.0 | ✅ | ❌ | ⭐⭐ — Entity-Component-Architektur als Inspiration |
| **OSG.JS** | MIT | Native 1.0 | ✅ | ❌ | ⭐⭐⭐ — Scene-Graph-Konzepte für GQ übernommen |
| **Away3D** | Apache 2.0 | Flash→TS | ❌ | ✅ | ⭐⭐ — Animations-System Inspiration |
| **CopperLicht** | zlib | Native 1.0 | ❌ | ✅ | ⭐⭐ — WebGL Game-Engine-Muster |
| **LayaAir** | Open Source | Native 1.0 | ❌ | ❌ | ⭐ — Mobile-fokussiert, wenig relevant |
| **JanusWeb** | MIT | Native 1.0 | ✅ | ✅ | ⭐ — Kollaborative 3D Welt |
| **Sketchfab** | Proprietär | Native 1.0+2.0 | ✅ | ❌ | ❌ — Proprietär, nicht adaptierbar |
| **Verge3D** | Proprietär | Native 1.0+2.0 | ✅ | ✅ | ❌ — Proprietär |
| **Unity (WebGL)** | Proprietär | WASM/2.0 | ✅ | ✅ | ❌ — Proprietär |
| **Clara.io** | Freemium | Native 1.0+2.0 | ✅ | ✅ | ❌ — Cloud-abhängig |

### Für GalaxyQuest relevante Open-Source-Quellen:

**Inspiration-Quellen (kompatible Lizenzen):**
1. **Three.js (MIT):** Math-Utils, Texture-Architektur, Camera-System → direkt adaptierbar
2. **Babylon.js (Apache 2.0):** Shader-Compilation-Pattern, Render-Pass-Design, WebGPU-Engine → adaptierbar mit Apache-Header
3. **WebGPU Samples (Apache 2.0):** Device-Init, Buffer-Pattern, Compute-Examples → adaptierbar
4. **PlayCanvas Engine (MIT):** GraphicsDevice-Abstraktion, Render-Pipeline → direkt adaptierbar
5. **OSG.JS (MIT):** Scene-Graph-Hierarchie → direkt adaptierbar

---

## 3. Optimierungspotenziale im aktuellen Stand

### 3.1 Shader-Optimierungen

```javascript
// Aktuell: separate Uniforms per Frame
uniforms: {
  uHeartbeatPhase: { value: 0 },
  uCameraVel:      { value: new THREE.Vector3(0,0,0) },
  // ...10+ einzelne Uniforms
}

// Besser: Uniform Buffer Object (WebGL2/WebGPU)
// Batch-Update in einem writeBuffer()-Call
```

### 3.2 Datenfluss-Optimierungen

| Problem | Ist | Soll |
|---|---|---|
| Star-Positions-Update | Jedes Frame alle Sterne neu berechnen | Dirty-Flag + partial updates |
| Colony-Colors | Float32Array rebuild bei Änderung | Streaming Buffer (partial write) |
| Camera-Uniforms | Einzelne setValue()-Calls | Uniform Buffer Object |

### 3.3 Physics-Engpass (kritisch für Skalierung)

```
Aktuell: O(N²) CPU-Berechnung für N bodies
- 10 Körper   → 100 Operationen (OK)
- 100 Körper  → 10.000 Operationen (merklich)  
- 1000 Körper → 1.000.000 Operationen (Engpass!)
```

**Lösung:** GPU-Compute via `WebGPUPhysics.js` (siehe `js/engine/webgpu/WebGPUPhysics.js`)

---

## 4. WebGL2-Verbesserungen (kurzfristig umsetzbar)

Diese Verbesserungen können *ohne* WebGPU-Migration sofort eingespielt werden:

```javascript
// In galaxy-renderer-core.js:
const caps = renderer.capabilities;
if (caps.isWebGL2) {
  // 1. Uniform Buffer Objects für Camera-Daten
  // 2. MultiDraw-Extension für batch rendering
  // 3. Float16-Textures für Renderables
  // 4. Instanced Rendering für Repetitions
}
```

---

## 5. Migrationsempfehlung

Siehe `webgpu_migration_roadmap.md` für den vollständigen Migrationsplan.

**Kurz-Fazit:**
- Three.js bleibt als **WebGL2-Fallback** erhalten
- Neue Engine (`js/engine/`) läuft **parallel** — keine Breaking Changes
- GPU-Physics (`WebGPUPhysics.js`) ist der größte Performance-Gewinn aus Phase 5
- Post-Effects sind bereit für WebGPU-Port (WGSL-Shader bereits erstellt)
