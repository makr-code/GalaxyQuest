# WebGPU Engine Architecture — GalaxyQuest

> **Version:** Phase 0  
> **Basiert auf:** Three.js (MIT), Babylon.js (Apache 2.0), WebGPU Samples (Apache 2.0), PlayCanvas (MIT), OSG.JS (MIT)

## Opt-in Babylon colony evaluation (not a production migration)

The diagrams below describe engine components, **not** a guarantee that every
game renderer obeys `IGraphicsRenderer`. Native zoom classes still use browser
globals and shared GPU devices; the legacy game renderer also owns Three.js
objects directly. `RendererFactory` and the normal game entry are unchanged.

WebGPU provides rasterization and compute within negotiated adapter/device
limits. It does **not** expose native ray-tracing pipelines, mesh shaders or a
portable sparse/virtual-texture residency API. Do not assume these features from
desktop GPU marketing or Babylon support on other platforms. Optional features
(including timestamp queries and float texture filtering) must be requested and
checked; this evaluation does not measure GPU execution time.

### Launch, build and compare

```sh
npm ci
npm run vite:dev
# Open http://127.0.0.1:8080/tools/babylon-colony-evaluation.html
npm run vite:build:evaluation
npm run vite:preview:evaluation
# Built page: http://127.0.0.1:4174/tools/babylon-colony-evaluation.html
```

The separate config explicitly builds the HTML entry into `dist-evaluation`;
default Vite builds only the normal game entry. Babylon 9.33.1 and its compiler
assets come from the pinned npm package, loaded lazily, never a CDN. Nothing
initializes until **Load / switch renderer** is pressed.

1. Load Babylon WebGPU-first, leave the camera still, then capture and export.
   The status and JSON identify WebGL fallback; never compare it as WebGPU.
2. Switch to **Existing native colony WebGPU** and capture the identical
   `colony-grid-v1` input (64 slots, fixed 960 × 600 buffer). Switching disposes
   the old owner and replaces the canvas. A WebGPU initialization failure also
   replaces the canvas before Babylon WebGL claims its context.
3. Optionally select explicit Babylon WebGL. Unsupported native WebGPU produces
   a visible error, not a fabricated baseline. Drag/wheel/right-drag navigate
   Babylon's lit scene; picking reports only slot IDs. Blue emissive pulses are
   an evaluation effect, not a claim of native particle-effect parity.

The native colony class is used unmodified with its actual interface dependency
loaded first. Its simplified projection ignores the navigation camera and some
building properties, so same-data results are **not visual-equivalence results**.
Do not treat this synthetic scene as a galaxy/dense-system workload.

### Live-game galaxy, dense-system and colony baselines

These scenes need the real runtime, loaded assets, account and active view, not
an invented standalone approximation. The implemented opt-in capture API wraps
an existing synchronous render boundary without adding another render loop:

```js
const { captureLiveBaseline } = await import('/js/evaluation/benchmark.js');
// Obtain the active instance in DevTools (store the renderer local as temp1).
// Galaxy3DRendererWebGPU: temp1._renderFrame, temp1._canvas.
// Legacy Galaxy3DRenderer: temp1._animate, temp1.renderer.domElement.
// Active native colony zoom instance: temp1.render; pass its owning canvas.
const run = captureLiveBaseline({
  target: temp1, method: '_renderFrame', canvas: temp1._canvas,
  scene: 'galaxy', backend: 'native-webgpu',
  sceneMetadata: { scenario: 'describe save/seed, counts, quality, camera, active view here' },
  warmup: 60, samples: 240, timeoutMs: 30000,
});
const baseline = await run.promise; // run.cancel() aborts and restores the method
copy(JSON.stringify(baseline, null, 2)); // DevTools helper; save as JSON
```

For the legacy renderer use `_animate` and its actual backend, not the native
example's backend label. Navigate to a populated system and repeat with
`scene: 'dense-system'`; navigate to colony and wrap the active zoom renderer's
`render`. Attach only a method called **once per rendered frame**, not an empty
compatibility `render()` shim. Do not change view/resolution during capture.
The API preserves receiver/arguments/results and restores the original method
on completion, cancellation, timeout, hidden-tab invalidation or render failure.
It rejects async submission boundaries and duplicate attachment.

All captures discard 60 warmup calls, then sample 240 intervals and synchronous
CPU call durations (p50/p95 with linear interpolation). CPU values include only
the chosen call, not necessarily all game work; frame intervals include browser
scheduling. Neither is GPU time. Synthetic startup measures load-start through
first submission, **not first fully compiled/visible frame**; live startup is
null because the game is already running. Browser-supported JS heap snapshots
and resource timings are included; GPU memory/time, unavailable heap/device
details and unavailable resource byte counts are null (zero transfer may mean
cache reuse). Resource entries may be incomplete due to browser buffer limits.
Hidden tabs reject captures; no invalid sample set is exported. Keep real
hardware exports separate from software/headless correctness smoke runs.

### Decision gates before any wider adoption

- **Load:** compare cold/warm startup, lazy chunk and local compiler bytes;
  reject an unacceptable load regression against the current renderer.
- **Frame:** compare repeated p50/p95 at identical resolution/backend and scene;
  synthetic colony wins alone cannot justify galaxy or system migration.
- **Memory:** check supported heap deltas and repeated switch/dispose cycles;
  null GPU memory requires browser/GPU tooling, not a zero-memory claim.
- **Visual quality:** manually compare camera, terrain, selection, materials,
  lighting and colony effects; simplified native geometry is not the target
  quality bar.
- **Maintenance:** review adapter isolation, shader/debugging workflow, package
  payload, fallback/device-loss behavior and integration costs of direct Three
  and native GPU dependencies. Proceed only after explicit review of all gates;
  otherwise retain the current production renderer.

---

## 1. Übersicht

```
┌─────────────────────────────────────────────────────────────────┐
│                     GalaxyQuest Game Code                       │
│   galaxy-renderer-core.js  │  starfield.js  │  trajectory-planner│
└──────────────┬──────────────────────────────────────┬───────────┘
               │                                      │
               ▼                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                  engine-compat.js (Brücke)                      │
│   GQEngineCompat.getRenderer(canvas) → IGraphicsRenderer        │
└──────────────┬─────────────────────────────────┬────────────────┘
               │                                  │
     ┌─────────▼──────────┐          ┌────────────▼───────────┐
     │  WebGPURenderer    │          │   WebGLRenderer        │
     │  (Primary Engine)  │          │   (Three.js Wrapper)   │
     │  js/engine/core/   │          │   js/engine/core/      │
     └─────────┬──────────┘          └────────────────────────┘
               │
     ┌─────────▼──────────────────────────────────────────────┐
     │                 WebGPU Backend                         │
     │  ┌─────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  │
     │  │ Device  │  │ Buffer │  │ Texture │  │  Shader  │  │
     │  │ Queue   │  │ Pool   │  │ Manager │  │  Cache   │  │
     │  └─────────┘  └────────┘  └─────────┘  └──────────┘  │
     │  ┌─────────────────────────────────────────────────┐  │
     │  │         WebGPUPhysics (Compute Shader)           │  │
     │  │   N-body Gravity + Velocity Integration (WGSL)   │  │
     │  └─────────────────────────────────────────────────┘  │
     └────────────────────────────────────────────────────────┘
               │
     ┌─────────▼──────────────────────────────────────────────┐
     │                  Scene Graph                           │
     │  SceneGraph → SceneNode → Transform → Geometry+Material│
     │  Camera (Perspective / Orthographic)                   │
     │  Lights (Ambient / Directional / Point)                │
     └────────────────────────────────────────────────────────┘
               │
     ┌─────────▼──────────────────────────────────────────────┐
     │               Post-Processing Pipeline                 │
     │  EffectComposer (ping-pong render targets)             │
     │  RenderPass → BloomPass → VignettePass → ChromaticPass │
     │  ComputePass (NPC AI, Particle Simulation)             │
     └────────────────────────────────────────────────────────┘
```

---

## 2. Renderer Abstraction Layer

### IGraphicsRenderer Interface

```javascript
// js/engine/core/GraphicsContext.js
interface IGraphicsRenderer {
  initialize(canvas: HTMLCanvasElement): Promise<void>
  getCapabilities(): RendererCapabilities
  createBuffer(type, data, usage): GPUBuffer | WebGLBufferDescriptor
  createTexture(spec): WebGPUTexture | THREE.Texture
  createShader(vertexSrc, fragmentSrc): ShaderHandle
  createRenderPass(config): RenderPassHandle
  render(scene, camera): void
  resize(width, height): void
  dispose(): void
}
```

### Capability Detection

```javascript
// RendererCapabilities
{
  webgpu:           boolean,    // true wenn WebGPU Renderer aktiv
  webgl2:           boolean,    // true wenn WebGL2 Fallback
  computeShaders:   boolean,    // immer true bei WebGPU
  float32Textures:  boolean,    // float32-filterable feature
  depthTextures:    boolean,
  maxTextureSize:   number,     // 4096 (mid) oder 8192 (high)
  maxAnisotropy:    number,
}
```

---

## 3. WebGPU Physics Engine

Das wichtigste Architektur-Highlight: **GPU-beschleunigte Physikberechnung**.

### Problem: CPU-Engpass bei N-body Simulation

```javascript
// js/space-physics-engine.js — aktuell O(N²) auf CPU
computeGravityAt(position, sources) {
  for (let i = 0; i < sources.length; i++) {
    // ... für jeden body × jeden anderen body
  }
}
```

### Lösung: WGSL Compute Shader (WebGPUPhysics.js)

```
CPU: SpacePhysicsEngine (Authoritative for Game Logic)
  ↓ uploadBodies(bodies Map)        → Pack Float32Array → GPU Storage Buffer
  ↓ step(dt)                        → Dispatch compute shader
  ↓ readback(bodies Map) [async]    → Copy results back to JS objects
```

**WGSL Compute Shader Kern:**
```wgsl
@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  // 1. N-body gravity accumulation (parallel over all bodies)
  let grav = gravity_accel(b.pos, idx);
  // 2. Velocity integration (Euler)
  var vel = b.vel + (grav + b.thrust) * params.dt;
  // 3. Drag + speed cap
  vel = vel * clamp(1.0 - b.drag * params.dt, 0.0, 1.0);
  // 4. Position update
  out.pos = b.pos + vel * params.dt;
}
```

**Buffer-Layout (64 Bytes / Body):**
```
[0..2]  position.xyz   float32×3
[3]     mass           float32
[4..6]  velocity.xyz   float32×3
[7]     drag           float32
[8..10] thrust.xyz     float32×3
[11]    maxSpeed       float32
[12]    isStatic       float32 (0|1)
[13..15] padding       float32×3
```

### Hybrid CPU+GPU Betrieb

```javascript
// Empfohlenes Nutzungsmuster in der Game-Loop:
const gpuPhysics = new WebGPUPhysics(device, engineOpts);
gpuPhysics.init();

// --- Jeden Frame: ---
gpuPhysics.uploadBodies(engine.bodies);  // nur bei Änderungen
gpuPhysics.step(dtSeconds);              // GPU dispatch (non-blocking)
// ... andere Frame-Arbeit ...
await gpuPhysics.readback(engine.bodies); // async, 0-copy
```

---

## 4. Post-Processing Pipeline

### Architektur (Ping-Pong)

```
Frame N:
  Scene → [RenderPass] → RT_A
  RT_A  → [BloomPass]  → RT_B
  RT_B  → [VignettePass] → RT_A
  RT_A  → [ChromaticPass] → Screen
```

### WGSL Shader-Design

Alle Post-Effect-Shader teilen das gleiche Vertex-Shader-Pattern:
```wgsl
// Kein Vertex-Buffer nötig — Screen-Quad aus vertex_index
@vertex fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  // 6 Vertices: 2 Triangles covering [-1,1] × [-1,1]
}
```

---

## 5. Math Library

Selbstimplementiert (inspiriert von Three.js, kompatibel mit Duck-Typing):

| Klasse | Features | Three.js Duck-Typing |
|---|---|---|
| `Vector2` | Dot, length, normalize, lerp | `.x`, `.y` kompatibel |
| `Vector3` | Cross, dot, lerp, toArray | `.x`, `.y`, `.z` kompatibel |
| `Vector4` | Homogen, RGBA | `.x`, `.y`, `.z`, `.w` kompatibel |
| `Matrix4` | Compose, Perspective, Ortho, Multiply | `.elements[16]` kompatibel |
| `Quaternion` | Slerp, setFromAxisAngle, rotateVector3 | `.x`, `.y`, `.z`, `.w` kompatibel |
| `MathUtils` | clamp, lerp, smoothstep, seededRandom | `THREE.MathUtils` kompatibel |

---

## 6. Dateistruktur

```
js/engine/
├── core/
│   ├── WebGPURenderer.js     ← IGraphicsRenderer für WebGPU
│   ├── WebGLRenderer.js      ← IGraphicsRenderer (Three.js Wrapper)
│   ├── RendererFactory.js    ← Auto-Detektion + Fallback
│   └── GraphicsContext.js    ← Interface-Definition
├── webgpu/
│   ├── WebGPUDevice.js       ← GPUAdapter/Device/Queue Lifecycle
│   ├── WebGPUBuffer.js       ← Storage Buffer Abstraktion
│   ├── WebGPUTexture.js      ← 2D/3D/Cubemap/Rendertarget
│   ├── WebGPUShader.js       ← Pipeline-Compilation + Cache
│   ├── WebGPURenderPass.js   ← Render Pass Encoder
│   ├── WebGPUCompute.js      ← Compute Dispatch + Readback
│   ├── WebGPUResourcePool.js ← Buffer/Texture Pooling
│   └── WebGPUPhysics.js      ← 🆕 GPU N-body Physics (WGSL)
├── scene/
│   ├── Camera.js             ← Perspective + Orthographic
│   ├── Transform.js          ← Hierarchical Matrix4 chains
│   ├── Geometry.js           ← Vertex/Index Buffer Daten
│   ├── Material.js           ← Shader Binding Descriptor
│   ├── Light.js              ← Ambient/Directional/Point
│   └── SceneGraph.js         ← Render-sorted Node Tree
├── post-effects/
│   ├── EffectComposer.js     ← Ping-Pong Render Targets
│   ├── passes/
│   │   ├── RenderPass.js
│   │   ├── BloomPass.js      ← Wraps bloom.wgsl
│   │   ├── VignettePass.js   ← Wraps vignette.wgsl
│   │   ├── ChromaticPass.js  ← Wraps chromatic.wgsl
│   │   └── ComputePass.js    ← Generic WGSL Compute
│   └── shaders/
│       ├── bloom.wgsl        ← Two-pass Gaussian Bloom
│       ├── vignette.wgsl     ← Radial Darkening
│       └── chromatic.wgsl    ← RGB-Channel Offset
├── math/
│   ├── Vector2/3/4.js
│   ├── Matrix4.js
│   ├── Quaternion.js
│   └── MathUtils.js
├── utils/
│   ├── WebGPUCapabilities.js ← Feature + Limit Detection
│   ├── ShaderCompiler.js     ← WGSL Preprocessor + GLSL Stub
│   ├── PerformanceMonitor.js ← FPS + GPU Memory Tracking
│   └── ResourceTracker.js   ← Memory Leak Detection
├── loaders/
│   ├── TextureLoader.js
│   ├── GeometryLoader.js
│   └── ShaderLoader.js
├── constants.js
└── index.js
```
