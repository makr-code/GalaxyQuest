# WebGPU Engine Architecture — GalaxyQuest

> **Version:** Phase 0  
> **Basiert auf:** Three.js (MIT), Babylon.js (Apache 2.0), WebGPU Samples (Apache 2.0), PlayCanvas (MIT), OSG.JS (MIT)

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
