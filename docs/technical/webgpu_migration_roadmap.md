# WebGPU Migration Roadmap — GalaxyQuest

> **Ziel:** Graduelle Migration von Three.js WebGL zu eigener WebGPU-Engine  
> **Strategie:** Parallelbetrieb — bestehender Code läuft unverändert weiter

---

## Phasenübersicht

| Phase | Zeitraum | Milestone | Status |
|---|---|---|---|
| **Phase 0** | Woche 1 | Architektur + Skeleton | ✅ Erledigt |
| **Phase 1** | Woche 2–3 | WebGPU Core (Device, Buffer, Texture) | ✅ Erledigt |
| **Phase 2** | Woche 4–5 | Scene Graph + Camera | ✅ Erledigt |
| **Phase 3** | Woche 6–7 | Post-Effects Migration (WGSL) | ✅ Erledigt |
| **Phase 4** | Woche 8–9 | Galaxy3D + Starfield Integration | ⏳ Nächste |
| **Phase 5** | Woche 10+ | GPU-Physics (NPC AI + Flotten) | 🔧 In Arbeit |

### Technische Verbesserungen (abgeschlossen)

| # | Verbesserung | Datei(en) | Status |
|---|---|---|---|
| 1 | `localStorage gq:rendererHint` in RendererFactory | `js/engine/core/RendererFactory.js` | ✅ |
| 2 | ComputePass vollständig + `dispatchCompute()` | `ComputePass.js`, `WebGPURenderer.js` | ✅ |
| 3 | GPU-Profiling via Timestamp Queries | `js/engine/utils/WebGPUProfiler.js` | ✅ |
| 4 | Double-Buffering für async Physics Readback | `js/engine/webgpu/WebGPUPhysics.js` | ✅ |
| 5 | WebGPUResourcePool in EffectComposer integriert | `js/engine/post-effects/EffectComposer.js` | ✅ |
| 6 | SSAO in PostFxController + GameEngine (tier=high) | `PostFxController.js`, `GameEngine.js` | ✅ |
| 7 | Shader-Fehler via EventBus + DOM CustomEvent | `js/engine/webgpu/WebGPUShader.js` | ✅ |
| 8 | Device-Loss: expon. Backoff + `onLost`-Callback | `js/engine/core/WebGPURenderer.js` | ✅ |
| 11 | Dev-Overlay (Renderer-Auswahl + GPU-Stats) | `js/engine/utils/GpuDevOverlay.js` | ✅ |
| 12 | QualityManager (zentrales Tier-basiertes Schalten) | `js/engine/utils/QualityManager.js` | ✅ |

---

## Phase 0 — Architektur & Skeleton ✅

**Ziele:**
- Engine-Ordnerstruktur anlegen
- Abstraction Layer (IGraphicsRenderer) definieren
- RendererFactory mit Auto-Detektion
- Alle Skeleton-Dateien mit Attributions-Headers
- WGSL Post-Effect-Shader (bloom, vignette, chromatic)
- GPU-Physics Skeleton mit vollständigem WGSL Compute-Shader
- Dokumentation

**Deliverables:**
```
js/engine/                    ← Neue Engine-Struktur
js/engine-compat.js           ← Kompatibilitäts-Brücke
js/galaxy3d-webgpu.js         ← Galaxy3D WebGPU Layer
js/starfield-webgpu.js        ← Starfield WebGPU Layer
docs/                         ← Vollständige Dokumentation
tests/webgpu/                 ← Test-Suite
```

---

## Phase 1 — WebGPU Core ✅

**Fokus:** Vollfunktionaler WebGPU Buffer + Texture + Shader Stack

**Tasks:**
- [x] `WebGPUDevice.js` — vollständiger Lifecycle + Device-Loss-Recovery
- [x] `WebGPUBuffer.js` — Vertex/Index/Uniform/Storage mit Streaming-Support
- [x] `WebGPUTexture.js` — 2D, Cubemap, Rendertargets, Mip-Generation
- [x] `WebGPUShader.js` — Pipeline-Cache, Compilation Error Reporting
- [x] `WebGPURenderPass.js` — Depth-Pass, Multi-Target
- [x] `WebGPUResourcePool.js` — Buffer + Texture Pooling aktiv schalten
- [x] Tests: `buffer.test.js`, `texture.test.js` mit echten Mock-GPUs

**Akzeptanzkriterien:**
- Triangle rendert auf WebGPU-Canvas
- Buffer-Roundtrip (upload → readback) korrekt
- Fallback zu Three.js bei `navigator.gpu === undefined`

---

## Phase 2 — Scene Graph & Camera ✅

**Fokus:** Vollständige Scene-Hierarchie für Galaxy + System View

**Tasks:**
- [x] `SceneGraph.js` — Frustum Culling aktivieren (optionaler camera-Parameter, SceneNode.bounds)
- [x] `Camera.js` — Frustum-Klasse + `_updateFrustum()` bei update()/lookAt(); SpaceCamera-Integration via FollowCamera
- [x] `Transform.js` — Parent-Chain mit Dirty-Tracking
- [x] `Geometry.js` — `uploadToGPU(device, {WebGPUBuffer, BufferType})` Methode
- [x] `Material.js` — Pipeline-Binding vollständig (via WebGPURenderer)
- [x] `Light.js` — `buildLightUniformBlock(lights)` für bis zu 8 Lichter (Float32Array)
- [x] Tests: `scene.test.js` — Frustum, SceneGraph-Culling, LightUniformBlock, Geometry-Upload (40 Tests)

**Akzeptanzkriterien:**
- Galaxy-Sternfeld rendert auf WebGPU (mindestens 9000 Punkte @ 60 FPS)
- Camera-Movement per Maus korrekt

---

## Phase 3 — Post-Effects Migration ✅

**Fokus:** Bloom / Vignette / ChromaticAberration via WGSL

**Tasks:**
- [x] `EffectComposer.js` — Ping-Pong Render Targets aktiv schalten
- [x] `BloomPass.js` — render() dispatcht `renderer.runBloomPass(pass, src, dst)` (bloom.wgsl Two-Pass bereit)
- [x] `VignettePass.js` — render() dispatcht `renderer.runVignettePass(pass, src, dst)`
- [x] `ChromaticPass.js` — render() dispatcht `renderer.runChromaticPass(pass, src, dst)`
- [x] WebGL-Fallback: EffectComposer akzeptiert beliebigen IGraphicsRenderer (WebGL + WebGPU)
- [x] Performance-Gate: Post-Effects nur wenn FPS ≥ 45 (GameEngine._onRender, POST_FX_MIN_FPS=45)

**Akzeptanzkriterien:**
- Optisch identisches Ergebnis mit WebGL (visueller Diff < 1%)
- Performance ≥ 60 FPS auf Mid-Range GPU (GTX 1060 / RX 580)

---

## Phase 4 — Galaxy3D + Starfield Integration

**Fokus:** Vollständige Integration der neuen Engine in das laufende Spiel

**Tasks:**
- [ ] `Galaxy3DRendererWebGPU.js` — vollständige WebGPU-Implementierung
- [ ] `StarfieldWebGPU.js` — Auth-Screen auf WebGPU
- [x] `engine-compat.js` / `RendererFactory.js` — `localStorage gq:rendererHint` + Dev-Overlay (`GpuDevOverlay.js`)
- [ ] Regressionstests: Side-by-Side Canvas-Vergleich (WebGPU vs WebGL)

**Akzeptanzkriterien:**
- Kein sichtbarer Unterschied zum bestehenden Three.js-Renderer
- Spiel vollständig spielbar auf WebGPU-Pfad
- Zero Breaking Changes für bestehenden Spiel-Code

---

## Phase 5 — GPU-Physics (NPC AI + Flotten)

**Fokus:** O(N²) Gravity auf GPU auslagern — skaliert auf 1000+ Körper

**Architektur:**

```
JS: SpacePhysicsEngine (CPU — Autoritativ)
     ↓ uploadBodies()
GPU: WebGPUPhysics.js (Compute Shader — Parallelisiert)
     - N-body Gravity: O(N²/W) mit W=64 Workgroup-Parallelismus
     - Velocity Integration + Drag in einem Pass
     ↓ readback() (async, double-buffered → 0-frame-block)
JS: Reconcile positions/velocities
```

**WGSL Compute-Shader-Pipeline:**
```
@workgroup_size(64)
cs_main() {
  grav = gravity_accel(pos, idx)   // N-body parallel
  vel  = vel + (grav + thrust) * dt
  vel *= drag_factor
  pos  = pos + vel * dt
}
```

**Skalierungsziel:**

| N Bodies | CPU (JS) | GPU (WebGPU) | Speedup |
|---|---|---|---|
| 50       | ~0.1ms   | ~0.05ms      | 2×      |
| 500      | ~10ms    | ~0.5ms       | 20×     |
| 5000     | ~1000ms  | ~5ms         | 200×    |

**Tasks:**
- [x] `WebGPUPhysics.js` — Double-Buffering für Async Readback (kein Frame-Blocking)
- [x] `ComputePass.js` — vollständig mit `dispatchCompute()` verdrahtet
- [ ] `SpacePhysicsEngine` — Hybrid-Mode (CPU+GPU mit Sync-Point)
- [ ] NPC-Pathfinding als separater Compute-Pass
- [ ] `WebGPUPhysics.js` — WGSL Shader final testen mit echtem GPU

---

## Fallback-Strategie

```
Browser-Start
     │
     ▼
navigator.gpu vorhanden?
     │ YES                    NO
     ▼                        ▼
Adapter verfügbar?      WebGL2 (Three.js)
     │ YES     NO             │
     ▼         ▼              ▼
WebGPU       WebGL2      Spiel läuft ✅
```

Konfiguration via `localStorage`:
```javascript
localStorage.setItem('gq:rendererHint', 'webgpu');  // erzwinge WebGPU
localStorage.setItem('gq:rendererHint', 'webgl2');  // erzwinge WebGL2
localStorage.setItem('gq:rendererHint', 'auto');    // auto (default)
```

---

## Browser-Kompatibilität

| Browser | WebGPU | WebGL2 | Fallback |
|---|---|---|---|
| Chrome 113+ | ✅ | ✅ | Nicht nötig |
| Edge 113+ | ✅ | ✅ | Nicht nötig |
| Firefox 119+ | ✅ (flag) | ✅ | WebGL2 by default |
| Safari 17.4+ | 🔬 Experimental | ✅ | WebGL2 |
| Ältere Browser | ❌ | ✅ | WebGL2 |

---

## Performance-Ziele

| Szene | Ziel-FPS | GPU-Budget | Renderer |
|---|---|---|---|
| Galaxy-View (9000 Sterne) | 60+ | 16ms/frame | WebGPU primary |
| System-View (Planeten) | 60+ | 16ms/frame | WebGPU primary |
| Auth-Starfield | 60+ | 8ms/frame | WebGPU primary |
| Niedrig-End Fallback | 30+ | 33ms/frame | WebGL2 |
| GPU-Physics (500 NPCs) | Async | <5ms | WebGPU Compute |

**Memory-Budget:**
- GPU: < 256 MB (Galaxy + Effekte)
- CPU: < 64 MB (Physik-Zustand, Geometrie-Cache)
