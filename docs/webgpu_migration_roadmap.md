# WebGPU Migration Roadmap — GalaxyQuest

> **Ziel:** Graduelle Migration von Three.js WebGL zu eigener WebGPU-Engine  
> **Strategie:** Parallelbetrieb — bestehender Code läuft unverändert weiter

---

## Phasenübersicht

| Phase | Zeitraum | Milestone | Status |
|---|---|---|---|
| **Phase 0** | Woche 1 | Architektur + Skeleton | ✅ Dieses PR |
| **Phase 1** | Woche 2–3 | WebGPU Core (Device, Buffer, Texture) | ⏳ Nächste |
| **Phase 2** | Woche 4–5 | Scene Graph + Camera | ⏳ Nächste |
| **Phase 3** | Woche 6–7 | Post-Effects Migration (WGSL) | ⏳ Nächste |
| **Phase 4** | Woche 8–9 | Galaxy3D + Starfield Integration | ⏳ Nächste |
| **Phase 5** | Woche 10+ | GPU-Physics (NPC AI + Flotten) | 🔭 Zukunft |

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

## Phase 1 — WebGPU Core

**Fokus:** Vollfunktionaler WebGPU Buffer + Texture + Shader Stack

**Tasks:**
- [ ] `WebGPUDevice.js` — vollständiger Lifecycle + Device-Loss-Recovery
- [ ] `WebGPUBuffer.js` — Vertex/Index/Uniform/Storage mit Streaming-Support
- [ ] `WebGPUTexture.js` — 2D, Cubemap, Rendertargets, Mip-Generation
- [ ] `WebGPUShader.js` — Pipeline-Cache, Compilation Error Reporting
- [ ] `WebGPURenderPass.js` — Depth-Pass, Multi-Target
- [ ] `WebGPUResourcePool.js` — Buffer + Texture Pooling aktiv schalten
- [ ] Tests: `buffer.test.js`, `texture.test.js` mit echten Mock-GPUs

**Akzeptanzkriterien:**
- Triangle rendert auf WebGPU-Canvas
- Buffer-Roundtrip (upload → readback) korrekt
- Fallback zu Three.js bei `navigator.gpu === undefined`

---

## Phase 2 — Scene Graph & Camera

**Fokus:** Vollständige Scene-Hierarchie für Galaxy + System View

**Tasks:**
- [ ] `SceneGraph.js` — Frustum Culling aktivieren
- [ ] `Camera.js` — ViewMatrix-Update an SpaceCamera-Integration anbinden
- [ ] `Transform.js` — Parent-Chain mit Dirty-Tracking
- [ ] `Geometry.js` — GPU-Buffer-Upload via WebGPUBuffer
- [ ] `Material.js` — Pipeline-Binding vollständig
- [ ] `Light.js` — Uniform-Buffer für bis zu 8 Lichter

**Akzeptanzkriterien:**
- Galaxy-Sternfeld rendert auf WebGPU (mindestens 9000 Punkte @ 60 FPS)
- Camera-Movement per Maus korrekt

---

## Phase 3 — Post-Effects Migration

**Fokus:** Bloom / Vignette / ChromaticAberration via WGSL

**Tasks:**
- [ ] `EffectComposer.js` — Ping-Pong Render Targets aktiv schalten
- [ ] `BloomPass.js` — bloom.wgsl Two-Pass Implementierung
- [ ] `VignettePass.js` — vignette.wgsl Implementierung
- [ ] `ChromaticPass.js` — chromatic.wgsl Implementierung
- [ ] WebGL-Fallback: vorhandene Three.js EffectComposer-Pipeline reaktivieren
- [ ] Performance-Gate: Post-Effects nur wenn FPS ≥ 45

**Akzeptanzkriterien:**
- Optisch identisches Ergebnis mit WebGL (visueller Diff < 1%)
- Performance ≥ 60 FPS auf Mid-Range GPU (GTX 1060 / RX 580)

---

## Phase 4 — Galaxy3D + Starfield Integration

**Fokus:** Vollständige Integration der neuen Engine in das laufende Spiel

**Tasks:**
- [ ] `Galaxy3DRendererWebGPU.js` — vollständige WebGPU-Implementierung
- [ ] `StarfieldWebGPU.js` — Auth-Screen auf WebGPU
- [ ] `engine-compat.js` — Umschalt-UI im Dev-Modus
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
     ↓ readback() (async, 0-copy)
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
- [ ] `WebGPUPhysics.js` — WGSL Shader final testen mit echtem GPU
- [ ] `SpacePhysicsEngine` — Hybrid-Mode (CPU+GPU mit Sync-Point)
- [ ] `ComputePass.js` — Integration in EffectComposer-Pipeline
- [ ] NPC-Pathfinding als separater Compute-Pass
- [ ] Async Readback ohne Frame-Blocking (Double-Buffering)

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
