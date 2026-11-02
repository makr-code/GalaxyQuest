# WebGPU Engine Architecture — GalaxyQuest

> **Version:** Phase 0  
> **Basiert auf:** Three.js (MIT), Babylon.js (Apache 2.0), WebGPU Samples (Apache 2.0), PlayCanvas (MIT), OSG.JS (MIT)

## Rendering direction: Three.js / WebGPU

GalaxyQuest continues with Three.js and the existing native WebGPU paths.
Babylon.js remains an implementation reference; the isolated comparison below
is a development tool, not a migration target or a production backend.

The implementation priorities are deliberately bounded:

- **Measure first:** distinguish frame cadence, synchronous CPU submission time,
  optional GPU execution time and memory accounting. Unsupported measurements
  remain unknown, not zero. Three.js geometry/texture counts are not byte sizes.
- **Residency before world size:** load only needed partitions, bound concurrent
  work and resident data, reject stale results after navigation, and unload through
  the owner that acquired the resources.
- **Visibility before complexity:** retain instancing, cull conservatively, and
  preserve stable selection identities when choosing visible detail. LOD and
  streaming must not alter authoritative game state.
- **Asset and lighting consistency:** use glTF 2.0 / GLB for imported scenes,
  declared detail levels, capability-configured compressed texture loaders and
  consistent PBR color/data texture conventions. Existing procedural descriptors
  remain a compatibility path; assets are not silently converted at runtime.
- **Explicit pass ownership:** declare dependencies where required; keep legacy
  insertion order where none are declared. Render targets must be released on
  resize and disposal, with no read/write feedback.

Full global illumination and GPU occlusion are deferred until repeatable target
scene measurements justify them. Native WebGPU shading is not automatically
equivalent to Three.js PBR merely because both render the same model.

### Native galaxy budgets and GPU partitions

The active `Galaxy3DRendererWebGPU` loads the existing performance monitor and
GPU profiler lazily. Its debug snapshot exposes `performance` and
`performanceStatus`; constructor `performanceBudget` options configure rolling
window sampling and threshold overrides. This scope is **native-main-pass**:
CPU time covers preparation/submission, not subsequent 2D overlays or frame hooks.
Frame intervals include browser scheduling. GPU samples cover that render pass
only, using standard pass `timestampWrites` when `timestamp-query` was enabled
on the device; `gpuTimestamps: false` disables the optional feature.
Readback is asynchronous and sampled every 60 frames, never awaited by the loop.

Metrics are numeric or null. Three.js geometry/texture statistics remain counts.
Actual owned buffer bytes are reported separately from unknown total VRAM;
`memoryBytes` must be supplied by a trustworthy accounting source before a total
memory threshold can be evaluated. Thresholds are configurable targets, not
claims about measured reference hardware. Rolling samples and regression history
are bounded.

Star GPU data is partitioned spatially into units of at most 2,048 stars.
Only conservatively intersecting viewport partitions become GPU-resident.
`starResidencyMaxBytes` defaults to 16 MiB, bounded between 57,344 bytes and
128 MiB. Under pressure, selected/hovered partitions and the viewport center
take priority. Replaced and invisible allocations are destroyed; re-entry uploads
from the retained CPU catalog. Packed sprites still use one instanced draw, carry
their original selection indices and retain source blending order.

This is **GPU partition residency**, not complete server-side World Partition:
the CPU star catalog remains resident and network loading is unchanged.
Prepared model LODs and system asset streaming remain separate concerns.

### Colony view residency

Both colony renderers release owned scene resources on `exit()` and reconstruct
them on `enter()` from the latest retained game data. Native WebGPU releases slot
and VFX buffers while retaining its pipelines and borrowed device/context.
Three.js releases scene geometries, materials and instanced-mesh buffers, retaining
the renderer/camera rather than creating another canvas context.

Updates arriving after exit retain CPU data without reallocating scene resources.
Re-entry preserves layout, ownership, selection metadata and upgrade transitions.
Empty updates clear old geometry/buffers and VFX statistics; repeated exit/disposal
does not release resources twice. Initial eager loading remains compatible.
This lifecycle does not implement network partitioning, unload the entire CPU
catalog or measure physical GPU memory.

### Postprocessing dependency contract

The existing `EffectComposer` accepts optional pass metadata: a unique nonempty
`id`, `after` (registered predecessors; disabled providers are ignored) and
`requires` (registered predecessors that must be enabled). Both dependency lists
contain pass IDs and affect execution order, **not** named texture bindings.
Unannotated chains retain insertion order and existing truthy `enabled` behavior.
Ready passes use insertion order as a stable tie-breaker.

The composer validates metadata, missing providers and enabled dependency cycles
before submitting a frame. Disabled consumers do not enforce their dependencies.
Source/destination texture aliasing is rejected before dispatch. Resize allocates
replacement targets first, then releases old targets to their original pool with
their original dimensions. Disposal releases targets and passes exactly once,
attempting remaining cleanup even if a resource throws.

### Shared Three.js assets, materials and lighting

The model registry accepts the existing procedural descriptors and imported
glTF/GLB descriptors. An imported descriptor supplies `model_url`, or authored
`lods` containing `model_url` and finite `distance` values: the first distance is
zero and subsequent distances strictly increase. Multiple levels use Three.js
`LOD`; this is prepared geometry selection, not runtime mesh simplification or
per-level network streaming. Imported geometry retains glTF material semantics.

`configureAssetLoaders` can inject a GLTF loader and an existing KTX2 loader. The
KTX2 loader must already have its transcoder path and renderer support configured;
no transcoder CDN, GPU format guess or runtime texture compression is introduced.
Without that configuration, use ordinary glTF-supported textures. Color and
emissive textures use sRGB; normal, roughness, metalness and other data maps use
no color-space conversion. Role-specific texture sharing must not change another
consumer's color interpretation: mismatched borrowed textures are cloned, and the
material factory releases only those owned clones. Clones are shared per role
and released when their last factory-created material is disposed; factory
shutdown also releases any remaining clones.

The optional Three.js runtime registers the shared model registry before core
initialization, but catalog preloading runs in the background. Network requests
must not block renderer startup or its existing procedural fallback meshes.
Prepared LOD imports wait for all loads before cleaning up a failed group.
Injected GLTF loader results are borrowed by default; `ownsGltfResources: true`
explicitly transfers failure-cleanup responsibility to the registry.

Material profiles preserve their existing roughness/metalness defaults.
Descriptor `rendering.envMapIntensity` and mesh `castShadow`/`receiveShadow`
settings are optional; shadows are not globally enabled. The light-rig manager
accepts an externally supplied prefiltered PMREM `environmentMap` and optional
`environmentIntensity`. It restores the prior scene environment when relinquishing
ownership, never destroys borrowed environment textures, and releases owned
shadow resources when profiles/scenes change or the manager is disposed.

## Living-world presentation

Visual activity is derived from supplied object state and existing fleet/combat
events. It never advances colony production, resolves combat or introduces an
economic tick. On re-entry, visible effects resume from current state rather than
replaying every particle emitted while the view was absent.

### Combat event identity and bounded lifetime

`CombatVfxBridge` accepts both the legacy window events and the canonical
`sse:*` EventBus path. It deduplicates each lifecycle stage by `event_id` /
`eventId`, falling back to the server's `fleet_id`. Up to 1,024 identities are
retained for ten minutes in memory, not persisted as public asset data.
For id-less legacy payloads, only repeated delivery of the same object is
deduplicated; unrelated battles are not guessed from matching owner/target names.

At most 32 battle loops and 32 warning chains are active. Battle duration is capped
at eight seconds. `stopAll()`, document hiding and destruction cancel both
warning timeouts and battle timers; hidden arrivals are not replayed on visibility
restoration. Server return events can stop the matching fleet without a target
field. These are cosmetic firing windows, not authoritative battle simulation.

`setVisualOptions({ reducedMotion, reducedFlashes })` stops sustained firing when
either option is true; the operating-system reduced-motion preference also applies.
An initial notification pulse remains, but no repeating flash sequence is started.

## Historical opt-in Babylon colony evaluation (not a production migration)

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

Device/context loss immediately cancels any current capture and disposes its
renderer; measurement stays disabled until a fresh renderer is loaded. Automatic
Babylon recovery is disabled so replacement device resources cannot silently
enter a run. The adapter's device-loss listener uses the pinned 9.33.1 internal
device handle (no public accessor), which remains entirely inside the adapter.

The native colony class is used unmodified with its actual interface dependency
loaded first. Its simplified projection ignores the navigation camera, sets
translation y to zero, and ignores z when positioning vertices: slot rows overlap.
It also ignores some building properties, so same-data results are **not matched
visual workloads or visual-equivalence results**.
Do not treat this synthetic scene as a galaxy/dense-system workload.

The existing Playwright runner also provides a reproducible browser correctness
smoke (not a hardware performance claim). With the Vite server running:

```sh
GQ_WEBGPU_SHADER_CI=1 GQ_BASE_URL=http://127.0.0.1:8080 \
  npx playwright test tests/e2e/babylon-colony-evaluation.spec.js --project=chromium --workers=1
```

Without `GQ_WEBGPU_SHADER_CI=1`, only explicit Babylon WebGL is exercised.
Use `GQ_EVALUATION_BROWSER_PATH=/usr/bin/chromium` if the existing system Chromium
should be used instead of the Playwright-managed browser. To check the built page,
run its preview server and set `GQ_BASE_URL=http://127.0.0.1:4174`.

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
const readState = () => ({
  scene: temp1.systemMode ? 'dense-system' : 'galaxy',
  backend: temp1._backend,
  sceneKey: String(temp1._currentTarget?.id ?? 'galaxy'),
  ready: !!(temp1._device && temp1._context && temp1._pipeline && temp1._uniformBuf),
});
const run = captureLiveBaseline({
  target: temp1, method: '_renderFrame', canvas: temp1._canvas,
  scene: readState().scene, backend: readState().backend, readState,
  sceneMetadata: { scenario: 'describe save/seed, counts, quality, camera, active view here' },
  warmup: 60, samples: 240, timeoutMs: 30000,
});
const baseline = await run.promise; // run.cancel() aborts and restores the method
copy(JSON.stringify(baseline, null, 2)); // DevTools helper; save as JSON
```

For the legacy renderer use `_animate` and its actual backend, not the native
example's backend label. Adapt `readState` to the owning runtime's active scene,
stable scene/save ID, actual backend and completed readiness (legacy:
`rendererBackend` and initialized `renderer`, not the native device fields).
The callback is required and checked before and after each observed call;
scene/backend/readiness/scene-ID or canvas-resolution changes reject the capture.
A bounded sideband timer checks invariants and method replacement even if the
renderer stops producing frames; it never contributes timing samples. Optional
memory/resource APIs that throw are reported as null, not as zero or a hung run.
Navigate to a populated system and repeat with
`scene: 'dense-system'`; navigate to colony and wrap the active zoom renderer's
`render`. Attach only a method called **once per rendered frame**, not an empty
compatibility `render()` shim. Do not change view/resolution during capture.
The API preserves receiver/arguments/results and restores the original method
on completion, cancellation, timeout, hidden-tab invalidation or render failure.
It rejects async submission boundaries and duplicate attachment.
`metricSource: 'synchronous-render-call-wrapper'` identifies actual method
instrumentation. There is no independent RAF observer and no renderer-FPS claim.

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
