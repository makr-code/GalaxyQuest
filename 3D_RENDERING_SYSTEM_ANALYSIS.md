# GalaxyQuest 3D/Rendering System - Comprehensive Analysis

**Date:** 2026-08-01  
**Scope:** Complete inventory of 3D geometry, particle systems, shaders, textures, and TRELLIS2 integration

---

## 1. 3D GEOMETRY & SHIP GENERATION

### 1.1 TRELLIS2 Integration (Microsoft AI 3D Generation)

#### Scripts & Tools
- **[scripts/trellis2_link.ps1](scripts/trellis2_link.ps1)** — Git submodule linking for TRELLIS2 repo
  - `UseSubmodule` mode: links repo to `tools/trellis2`
  - `Update` mode: pulls latest changes
  
- **[scripts/trellis2_generate.ps1](scripts/trellis2_generate.ps1)** — CLI generation wrapper
  - Modes: `text` (text-to-3D), `image` (image-to-3D)
  - Output: GLB + MP4 preview in `generated/trellis2/`
  - Configurable: seed, sampler steps, classifier-free guidance, texture size
  
- **[scripts/trellis2_generate.py](scripts/trellis2_generate.py)** — Python backend (primary)
  - Imports: `TrellisImageTo3DPipeline`, `TrellisTextTo3DPipeline`
  - Quality checks: `trimesh` mesh inspection, triangle/vertex counts, bbox validation
  - Output artifacts: GLB + `_quality.json` sidecar with metadata
  - Uses HuggingFace model selection: `microsoft/TRELLIS-text-base`, `microsoft/TRELLIS-image-large`
  
- **[scripts/trellis2_import.ps1](scripts/trellis2_import.ps1)** — Asset import to GQ naming convention
  - Naming: `{assettype}_{faction}_{variant}_{slot}_trellis2_dev.glb`
  - Target dir: `generated/trellis2/imported/{assettype}/`
  - Copies quality sidecar if present
  - Logging: `generated/trellis2/import_log.jsonl`
  
- **[scripts/trellis2_webapp.ps1](scripts/trellis2_webapp.ps1)** — Interactive WebUI
  - Modes: `image` (port 7860), `text` (port 7861)
  - Runs TRELLIS2 Gradio app in Docker
  - Useful for iterative design
  
- **[scripts/trellis2_setup.ps1](scripts/trellis2_setup.ps1)** — Full environment setup
  - WSL2 recommended (native Windows conda support limited)
  - Downloads models from HuggingFace
  - Creates conda environment with dependencies
  
- **[scripts/trellis2_download_models.py](scripts/trellis2_download_models.py)** — Standalone model downloader
  - Requires only `huggingface_hub` library
  - Cache-aware: respects HF_HOME environment variable

#### Supported Models
| Model | Purpose | Supported Output |
|-------|---------|------------------|
| `microsoft/TRELLIS-text-base` | Text→3D generation | mesh + gaussian splatting |
| `microsoft/TRELLIS-image-large` | Image→3D generation | mesh + gaussian splatting |

#### Output Format
- **GLB (GL Transmission Format)** — Compressed 3D binary
  - Contains: mesh geometry, materials, textures, metadata
  - Quality check: triangle count (target < 150k for dev assets)
  - File size: typically 2-20 MB for game-ready models
- **Quality Sidecar** — `{name}_quality.json`
  - Fields: `triangles`, `vertices`, `bounding_box`, `file_size_kb`, `issues[]`

#### Key Files (Design Templates)
- **[docs/gamedesign/FACTION_3D_GENERATION_EXAMPLES.md](docs/gamedesign/FACTION_3D_GENERATION_EXAMPLES.md)** — Faction-specific prompts
- **[docs/gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md](docs/gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md)** — Design language (EGL v1)
  - Allowed geometries: `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `TorusGeometry`, `RingGeometry`, `OctahedronGeometry`
  - Budget: ships 8-28 primitives, stations 18-64 primitives
  - Metadata: `gqModelSemantics` with `factionCode`, `objectClass`, `archetype`, `silhouetteTags`, `signatureParts`
  
---

### 1.2 Three.js Model Format (EGL 1.0)

#### Schema & Structure
- **[models/README.md](models/README.md)** — Complete format specification
- Format: Three.js Object JSON (metadata.type = "Object")
- Parsed by `THREE.ObjectLoader` at runtime

#### JSON Schema
```json
{
  "metadata": { "version": 4.6, "type": "Object" },
  "modelId": "ship_cruiser",
  "label": "Cruiser Class",
  "version": 1,
  "scale": 1,
  "lod": { "segments_full": 24, "segments_low": 10 },
  "images": [],
  "textures": [],
  "geometries": [
    { "uuid": "geo_hull", "type": "CylinderGeometry", "radiusTop": 0.2, "radiusBottom": 0.6, "height": 3.1, "radialSegments": 10 }
  ],
  "materials": [
    { "uuid": "mat_hull", "type": "MeshStandardMaterial", "color": 0x4A4A4A, "metalness": 0.7, "roughness": 0.4 }
  ],
  "animations": [
    { "name": "idle_spin", "duration": 4, "tracks": [...] }
  ],
  "object": {
    "uuid": "obj_root",
    "type": "Group",
    "children": [
      { "uuid": "mesh_hull", "type": "Mesh", "geometry": "geo_hull", "material": "mat_hull" }
    ]
  }
}
```

#### Available Models (13 Faction Starter Pack)
- **[models/faction_starter/](models/faction_starter/)** — Pre-built faction models
- Core models in root:
  - `stargate.json` — Stargate installations
  - `relay_station.json` — Comms hubs
  - `jump_inhibitor.json` — Inhibitor platforms
  - `deep_space_radar.json` — Sensor arrays
  - `space_station.json` — Hub stations
  - `transport_shuttle.json` — NPC transport
  - `ship_frigate.json`, `ship_cruiser.json`, `ship_destroyer.json` — Ship classes
  - `faction_lit_reference.json` — Reference with lighting maps

#### Animation Metadata
- Location: `object.userData.gqAnimations`
- Two types:
  1. **Native Three.js AnimationClip** — Top-level `animations[]` array, used by `AnimationMixer`
  2. **Runtime custom animations** — `gqAnimations` descriptors with `type: "linear"` or `type: "sine"`
- Naming convention:
  - `idle_*` — Passive ambient motion
  - `active_*` — Operational mode
  - `alert_*` — Threat/critical visuals

---

### 1.3 Procedural Geometry Generation

#### Legacy Three.js Implementation
- **[js/legacy/galaxy3d.js](js/legacy/galaxy3d.js)** (lines 2195-2260)
  - `_proceduralVesselGeometry(vesselType, seed)` — Lathe-based ships
    - Families: `heavy`, `light`, `cargo`, `frigate`
    - Uses `THREE.LatheGeometry` with parametric curve points
    - Cached: `vesselGeometryCache` (key: `{family}:{seed % 11}`)
  - `_buildFleetFormationEntry()` — Fleet mesh composition
  - `_buildJet()` — Relativistic jet particle geometry (North/South jets on black holes)
  - `_buildAmbientTraffic()` — Transport shuttle orbits

#### Procedural Methods (AdvancedRenderingTests)
- **[js/engine/AdvancedRenderingTests.js](js/engine/AdvancedRenderingTests.js)** — Test suite
  - `generateProceduralAsteroid(seed, scale, complexity)`
  - `generateDebrisField()`
  - Methods exist but are stubs; intended for Phase 3+ expansion

---

### 1.4 Asset Loading & Import

#### GeometryLoader (Stub for Phase 2+)
- **[js/engine/loaders/GeometryLoader.js](js/engine/loaders/GeometryLoader.js)**
  - Static method: `GeometryLoader.loadJSON(url)`
  - Expected JSON: `{ positions: [], normals: [], uvs: [], indices: [] }`
  - Currently minimal; GLTF/OBJ support deferred to Phase 2

#### API Entry Point
- **[api/model_gen.php](api/model_gen.php)** — Model serving endpoint
  - Query param: `?type=<modelId>`
  - Returns Three.js Object JSON
  - Caches loaded models in memory

---

## 2. PARTICLE SYSTEMS

### 2.1 CPU Particle System (Primary)

#### Core Implementation
- **[js/engine/fx/ParticleSystem.js](js/engine/fx/ParticleSystem.js)** (Primary)
  - Pool-based allocation (default 4096 particles)
  - Supports emitter attachment + dynamic PointLights
  - Per-particle data: position, velocity, color, size, lifetime, age
  - Methods:
    - `addEmitter(emitter)` — Register ParticleEmitter
    - `addDynamicLight(light, duration)` — Flash light (10% ramp-up, 90% decay)
    - `update(dt)` — Drive simulation
    - `render()` — Pass to renderer

#### GPU Compute Path (Phase FX-2/5)
- **[js/engine/fx/GPUParticleSystem.js](js/engine/fx/GPUParticleSystem.js)**
  - Buffer layout: 16 floats per particle (64 bytes)
  - Fields: position (3), lifetime, velocity (3), age, color (3), size (1), active (1), pad (3)
  - Constants: `FP_PX`, `FP_VX`, `FP_CR`, `FP_ACTIVE`, etc. (offsets for direct buffer access)
  - Compute shader path via WebGPU (when available)
  - CPU fallback mirrors shader logic

### 2.2 Particle Emitter

#### Configuration
- **[js/engine/fx/ParticleEmitter.js](js/engine/fx/ParticleEmitter.js)**
  - Modes: `BURST` (instant), `CONTINUOUS` (steady rate)
  - Config: position, direction, spread cone, count, lifetime, speed, colors (start/end), sizes (start/end), gravity, drag, duration
  - Per-tick: `tick(dt)` returns particle count to spawn
  - Introspects: `done` property

#### Usage Examples (CombatFX)
```javascript
// Weapon fire burst
emitter = new ParticleEmitter({
  mode: EmitterMode.BURST,
  position: { x: 0, y: 0, z: 0 },
  count: 30,
  lifetime: 1.0,
  speed: 8,
  colorStart: 0xffff00,
  colorEnd: 0x000000,
  duration: 0
});
particleSystem.addEmitter(emitter);
```

### 2.3 Combat FX Manager

#### High-Level API
- **[js/engine/fx/CombatFX.js](js/engine/fx/CombatFX.js)**
  - Weapon types: `LASER`, `PLASMA`, `MISSILE`, `RAILGUN`
  - Effects:
    - `spawnWeaponFire()` — Muzzle flash + projectile trail
    - `spawnImpactExplosion()` — Hit detonation
    - `spawnShieldImpact()` — Energy ripple
    - `spawnBeam()` — Continuous beam (capsule geometry)
    - `spawnShockwave()` — Blast wave
  - Integrates with ParticleSystem + EnvironmentFX

### 2.4 Environment FX

#### Debris & Volume Effects
- **[js/engine/fx/EnvironmentFX.js](js/engine/fx/EnvironmentFX.js)**
  - `spawnDebrisCloud(position, radius)` — Debris particles + volumetric cloud
  - `spawnPlasmaTorrent()` — Plasma column effect
  - `spawnEmpPulse()` — EMP pulse visual
  - `spawnCorona()` — Glow corona
  - Cloud volumes stored for volumetric rendering pass

### 2.5 Specialized FX Systems

#### Warp/Hyperspace
- **[js/engine/fx/WarpFX.js](js/engine/fx/WarpFX.js)**
  - Warp phases: `IDLE`, `CHARGING`, `ACTIVE`, `COOLDOWN`
  - Starfield distortion effect
  - Color/scale animation during jump sequence

#### Voxel Debris (Phase FX-4)
- **[js/engine/fx/VoxelDebris.js](js/engine/fx/VoxelDebris.js)**
  - Instanced cube meshes for ship destruction
  - Chunk pool for reuse
  - Gravity + collision simulation

---

## 3. SHADER SYSTEMS

### 3.1 WebGPU Compute Shaders (WGSL)

#### Particle Simulation
- **[js/engine/fx/shaders/particles.wgsl](js/engine/fx/shaders/particles.wgsl)**
  - Compute shader for GPU particle simulation
  - Structs: `Particle` (16 floats), `SimParams`
  - Bindings: storage buffer (read_write), uniform buffer
  - Dispatch: `ceil(particleCount / 64)` workgroups
  - Physics: position += velocity × dt, velocity *= drag, gravity

#### Post-Effects (WGSL)
- **[js/engine/post-effects/shaders/volscatter.wgsl](js/engine/post-effects/shaders/volscatter.wgsl)** — Volumetric scattering
- **[js/engine/post-effects/shaders/starscintillation.wgsl](js/engine/post-effects/shaders/starscintillation.wgsl)** — Star twinkle
- **[js/engine/post-effects/shaders/ssao.wgsl](js/engine/post-effects/shaders/ssao.wgsl)** — Screen-space ambient occlusion
- **[js/engine/post-effects/shaders/filmgrain.wgsl](js/engine/post-effects/shaders/filmgrain.wgsl)** — Analog noise
- **[js/engine/post-effects/shaders/motionblur.wgsl](js/engine/post-effects/shaders/motionblur.wgsl)** — Temporal blur
- **[js/engine/post-effects/shaders/lensflare.wgsl](js/engine/post-effects/shaders/lensflare.wgsl)** — Lens artifacts
- **[js/engine/post-effects/shaders/jetlighting.wgsl](js/engine/post-effects/shaders/jetlighting.wgsl)** — Jet glow overlay
- **[js/engine/post-effects/shaders/diskrotationparallax.wgsl](js/engine/post-effects/shaders/diskrotationparallax.wgsl)** — Parallax mapping

#### VFX Shaders
- **[js/engine/fx/shaders/warp.wgsl](js/engine/fx/shaders/warp.wgsl)** — Hyperspace distortion
- **[js/engine/fx/shaders/nebula.wgsl](js/engine/fx/shaders/nebula.wgsl)** — Nebula procedural
- **[js/engine/fx/shaders/godray.wgsl](js/engine/fx/shaders/godray.wgsl)** — Light shafts
- **[js/engine/fx/shaders/beam.wgsl](js/engine/fx/shaders/beam.wgsl)** — Weapon beam geometry
- **[js/engine/fx/shaders/debris.wgsl](js/engine/fx/shaders/debris.wgsl)** — Debris simulation
- **[js/engine/fx/shaders/starfield.wgsl](js/engine/fx/shaders/starfield.wgsl)** — Star rendering

### 3.2 Three.js ShaderMaterial (GLSL)

#### Star Rendering
- **[js/legacy/galaxy3d.js](js/legacy/galaxy3d.js)** (lines 3766-3820)
  - Uniforms: `uPointScale`, `uCameraVel`, `uDopplerStrength`, `uHeartbeatPhase`, `uHeartbeatStrength`
  - Vertex attrs: `aColor`, `aSize`, `aEmpire`
  - Additive blending + point sprites

#### Jet Effects
- **[js/legacy/galaxy3d.js](js/legacy/galaxy3d.js)** (lines 691-760)
  - Uniforms: `uTime`, `uDir`, `uJetLength`
  - Particle acceleration outward in narrow cone
  - Additive blending + discard in fragment shader

#### Lens Flare
- **[js/legacy/galaxy3d.js](js/legacy/galaxy3d.js)** (lines 417-520)
  - Glow shader with logarithmic spiral arms (4-arm pattern)
  - Disk glow using canvas texture
  - Diffraction glow layers

### 3.3 Post-Effects Pipeline (Three.js)

#### EffectComposer Integration
- **[js/rendering/post-effects.js](js/rendering/post-effects.js)**
  - Composer setup: base render pass → bloom → vignette → chromatic aberration → copy
  - Passes array: `{ render, bloom, vignette, chromatic, copy }`
  - Pixel ratio: Math.min(dpr, 2)

#### Post-Effect Passes (Stubs/Implementations)
- **[js/engine/post-effects/passes/](js/engine/post-effects/passes/)**
  - `BloomPass.js` — Bloom effect
  - `VignettePass.js` — Edge darkening
  - `ChromaticAberrationPass.js` — RGB separation
  - `MotionBlurPass.js` — Temporal blur
  - `FilmGrainPass.js` — Analog noise
  - `DepthOfFieldPass.js` — Focus blur
  - `VolumetricDustPass.js` — Volumetric lighting
  - `SSAOPass.js` — Ambient occlusion
  - `JetLightingPass.js` — Jet overlay lighting

#### ShaderPass Wrapper
- **[js/rendering/three-ShaderPass.js](js/rendering/three-ShaderPass.js)**
  - Generic pass for applying arbitrary shaders to textures
  - Used by bloom, vignette, film grain, etc.

---

## 4. TEXTURE SYSTEMS

### 4.1 Procedural Planet Textures

#### Pipeline
- **[js/rendering/planet-textures.js](js/rendering/planet-textures.js)** (Complete implementation)
  - Class: `GQPlanetTexturePipeline`
  - Canvas-based texture generation (256×256 or configurable)
  - Descriptor-driven: faction, climate, age, habitability
  - Output: Three.js CanvasTexture

#### Features
- Perlin noise + FBM (fractional Brownian motion)
- City lights (night emission from albedo)
- Cloud layers with variance
- Atmosphere shell with Fresnel rim-lighting
- Biome-specific coloring (rocky, icy, volcanic, alien)

#### Shader Patching
- Night emission via `onBeforeCompile` shader patches
- Custom uniforms: `gqLightWorldPos`, `gqNightEmissionStrength`, `gqCityMap`, `gqCityTint`
- Fragment shader modification for emissive channels

### 4.2 AI-Generated Textures (ComfyUI Integration)

#### Backend API
- **[api/textures-ai.php](api/textures-ai.php)**
  - Endpoint: POST `/api/textures-ai.php?action=generate`
  - Body: `{ descriptor: {...}, cache: true }`
  - Returns: Base64 PNG + quality metadata
  - Caching: SHA256 key, LRU eviction
  - Fallback: Procedural texture on error

#### Configuration (.env)
```bash
COMFYUI_ENABLED=1
COMFYUI_BASE_URL=http://comfyui:8188
COMFYUI_MODEL=sdxl  # or sd15
COMFYUI_TEXTURE_SIZE=512
COMFYUI_DIFFUSION_STEPS=30
COMFYUI_GUIDANCE_SCALE=8.5
COMFYUI_CACHE_MODE=disk
```

#### ComfyUI Workflows
- **[ai/comfyui_workflows/templates.json](ai/comfyui_workflows/templates.json)**
  - Workflow templates for spaceship hulls, planet surfaces, atmospheric effects
  - Each template: node graph with CLIPTextEncode, KSampler, VAEDecode, SaveImage

#### Frontend Integration
- **[js/admin/texture-admin-ui.js](js/admin/texture-admin-ui.js)**
  - Admin panel for cache management
  - Clear cache, list cached items, refresh

### 4.3 Texture Management

#### TextureLoader & Caching
- Expected: `js/engine/loaders/TextureLoader.js` (stub)
- Currently: Three.js native `TextureLoader` via GLB import or canvas generation

#### WebGPU Texture Handling
- **[js/engine/webgpu/WebGPUTexture.js](js/engine/webgpu/WebGPUTexture.js)**
  - Class: `WebGPUTexture`
  - Supports: 2D, 3D, cubemap, renderable textures
  - Mip-gen WGSL shader for mipmapping

---

## 5. RENDERING BACKENDS

### 5.1 Three.js Renderer (WebGL2)

#### Main Galaxy Renderer
- **[js/legacy/galaxy3d.js](js/legacy/galaxy3d.js)**
  - Class: `Galaxy3DRenderer`
  - Canvas setup: `THREE.WebGLRenderer` with anti-aliasing, shadow maps
  - Scene graph: groups for stars, planets, fleets, orbits, jets, special bodies
  - Render loop: updates emitters, lights, camera, renders via composer

#### Specialized Renderers
- **[js/ui/ShipHangarViewer.js](js/ui/ShipHangarViewer.js)** — Ship inspection
  - Three.js scene with lighting + shadow setup
  - Model loading + animation clip playback
  - Engine effect rendering (cone glow)

- **[js/rendering/ApproachViewRenderer.js](js/rendering/ApproachViewRenderer.js)** — Planet approach
  - Particle effects during descent
  - Atmospheric clouds + planet mesh
  - Dynamic lighting

### 5.2 WebGPU Renderer (Native)

#### Interactive WebGPU Galaxy Renderer
- **[js/rendering/Galaxy3DRendererWebGPU.js](js/rendering/Galaxy3DRendererWebGPU.js)** (4400+ lines)
  - Class: `Galaxy3DRendererWebGPU`
  - Hardware acceleration: GPU compute, GPU rendering
  - Backend: native WebGPU device with render/compute pipelines
  - Features:
    - Instanced star rendering
    - Planet hero pass + corona
    - Orbit rendering (ellipse parametrization)
    - Overlay context (2D canvas for trade routes, etc.)
    - Particle rendering stub

#### WebGPU Facade Fallback
- **[js/legacy/galaxy3d-webgpu.js](js/legacy/galaxy3d-webgpu.js)**
  - Factory: selects WebGPU or Three.js based on availability
  - Delegated interface: maps API calls to appropriate renderer

#### WebGPU Starfield
- **[js/rendering/starfield-webgpu.js](js/rendering/starfield-webgpu.js)**
  - Procedural star field generation
  - Starfield layers with parallax

### 5.3 Zoom Level Renderers

#### Three.js Levels
- **[js/engine/zoom/levels/GalaxyLevelThreeJS.js](js/engine/zoom/levels/GalaxyLevelThreeJS.js)** — Galaxy view
- **[js/engine/zoom/levels/SystemLevelThreeJS.js](js/engine/zoom/levels/SystemLevelThreeJS.js)** — System view
- **[js/engine/zoom/levels/ColonyBuildingLevelThreeJS.js](js/engine/zoom/levels/ColonyBuildingLevelThreeJS.js)** — Colony inspection
- **[js/engine/zoom/levels/PlanetApproachLevelThreeJS.js](js/engine/zoom/levels/PlanetApproachLevelThreeJS.js)** — Approach sequence

#### WebGPU Levels
- **[js/engine/zoom/levels/GalaxyLevelWebGPU.js](js/engine/zoom/levels/GalaxyLevelWebGPU.js)**
- **[js/engine/zoom/levels/SystemLevelWebGPU.js](js/engine/zoom/levels/SystemLevelWebGPU.js)**
- **[js/engine/zoom/levels/ColonyBuildingLevelWebGPU.js](js/engine/zoom/levels/ColonyBuildingLevelWebGPU.js)**

---

## 6. EXISTING TEST COVERAGE

### 6.1 Unit Tests (Vitest)

#### Rendering Tests
| File | Coverage | Key Tests |
|------|----------|-----------|
| `tests/js/ship-hangar-viewer.test.js` | ✅ Ship model loading, animation, material setup | Model cloning, animation playback, lighting |
| `tests/js/system-special-bodies.test.js` | ✅ Procedural debris/Dyson meshes | Debris particles, swarm distribution, seeding |
| `tests/js/galaxy3d-webgpu-overlay.test.js` | ✅ Trade route overlay rendering | Deduplication, line drawing |
| `tests/js/galaxy3d-webgpu-facade.test.js` | ✅ Backend selection logic | WebGPU fallback to Three.js |
| `tests/webgpu/galaxy-webgpu-renderer.test.js` | ✅ WebGPU renderer API surface | Delegation, method forwarding |
| `tests/webgpu/regression.test.js` | ✅ API parity (WebGPU vs WebGL) | Method lists, getter/setter validation |
| `tests/webgpu/compute.test.js` | ✅ WebGPU compute passes | Workgroup sizes, dispatch |
| `tests/webgpu/render-pipeline.test.js` | ✅ Pipeline compilation | Geometry upload, material caching |
| `tests/webgpu/webgpu-shader-module.test.js` | ✅ Shader compilation + cache | Cache deduplication |
| `tests/js/post-effects.test.js` | ✅ Post-effect passes | Pass enabling/disabling, render dispatch |
| `tests/js/advanced-rendering-ui.test.js` | ✅ Rendering UI (stubs) | Rendering tests framework |
| `tests/js/fx-phases-2-5.test.js` | ✅ Particle & FX systems | Emitter behavior, GPU paths |
| `tests/js/debris-manager.test.js` | ✅ Debris lifecycle | Chunk allocation, pooling |
| `tests/js/isometric-modules.test.js` | ✅ Module rendering (stubs) | Render dispatch for module types |

#### WebGPU Validation
- **[tests/e2e/webgpu-shader-validation.spec.js](tests/e2e/webgpu-shader-validation.spec.js)**
  - Hardware-in-loop CI: validates all WGSL shaders compile on actual GPU
  - Builds shader catalogue from `js/engine/fx/shaders/*.wgsl` + `js/engine/post-effects/shaders/*.wgsl`
  - Reports `compilationInfo()` errors for each shader

### 6.2 Integration Tests (E2E / Playwright)

| Test | File | Coverage |
|------|------|----------|
| Galaxy rotation animation | `tests/e2e/galaxy-rotation.spec.js` | Three.js renderer init, disk glow shader |
| System enter (procedural generation) | `tests/e2e/system-enter-renderer.spec.js` | Procedural mesh generation, LOD |
| Trade route overlay | `tests/e2e/trade-route-overlay.spec.js` | Overlay context, line drawing |
| View flow (zoom levels) | `tests/e2e/view-flow.spec.js` | Zoom level transitions, camera animation |

### 6.3 Test Infrastructure

#### Mocking
- Three.js mock stubs in test files (Vector3, Mesh, Material, Geometry, etc.)
- WebGPU device mocks for compute/render pipeline tests
- Canvas/context mocks for 2D overlay

#### Helpers
- `makeThreeStub()` — Build minimal Three.js environment
- `makeCanvas()`, `makeContainer()` — DOM setup
- `makeReadyRenderer()` — Instantiate renderer with WebGPU or Three.js fallback

#### Test Runners
- **Vitest** — Unit tests (faster)
- **Playwright** — E2E tests (browser automation)

---

## 7. DEPENDENCIES

### Core Graphics Libraries
- **Three.js** — Primary 3D renderer (WebGL2 backend)
  - Modules: Scene, Camera, Renderer, Mesh, Material, Shader, EffectComposer, etc.
  - Version: Pinned in `package.json`

- **WebGPU** — Next-gen GPU API (native interactive renderer)
  - Fallback to Three.js if unavailable
  - Compute shaders via WGSL language

- **Dexie.js** — IndexedDB wrapper (local caching for textures, geometry)

- **Tone.js** — Audio synthesis (not directly related to 3D, but used in FX context)

### Build Tools
- **Vite** — Module bundler (vite.config.js)
- **Vitest** — Test runner (vitest.config.mjs)
- **Playwright** — E2E test framework (playwright.config.js)

### Python Tools
- **TRELLIS2** — AI 3D generation
  - Submodule: `tools/trellis2/`
  - Deps: `torch`, `diffusers`, `transformers`, `trimesh`, `imageio`

- **ComfyUI** — Texture generation backend (Docker service)
  - Config: `docker-compose.yml`

---

## 8. API ENTRY POINTS

### Testing & Debugging

#### Advanced Rendering Tests
- **[js/engine/AdvancedRenderingTests.js](js/engine/AdvancedRenderingTests.js)**
  - Static methods for test harness:
    - `runAllTests(gameEngine)` → Promise<results>
    - `_testLODSystem()`, `_testPostProcessingPipeline()`, `_testDecalSystem()`, `_testCinematicCamera()`, `_testProceduralMeshes()`

#### Model Loading
- `api/model_gen.php?type=<modelId>` — Fetch Three.js Object JSON

#### Texture API
- `api/textures-ai.php?action=generate` — AI-generated texture

#### Health Checks
- Docker services: `http://comfyui:8188/health` (ComfyUI)
- Ollama: `http://ollama:11434/api/version` (LLM fallback)

---

## 9. BUILD & RUN COMMANDS

### TRELLIS2 Tasks
```bash
# Link submodule
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1 -UseSubmodule

# Generate ship (text-to-3D)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_generate.ps1 `
  -Mode text -Prompt "a modular hard-surface sci-fi cargo ship"

# WebApp (interactive)
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_webapp.ps1 -Mode text -Port 7861

# Import asset
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_import.ps1 `
  -SourceGlb "generated/trellis2/ship_text.glb" `
  -AssetType "ship" -Faction "vor_tak" -Variant "heavy"
```

### Test Commands
```bash
# All rendering tests
npm run test:js
npm run test:webgpu

# E2E tests
npx playwright test tests/e2e/webgpu-shader-validation.spec.js

# ShaderValidation (CI mode)
GQ_WEBGPU_SHADER_CI=1 npx playwright test tests/e2e/webgpu-shader-validation.spec.js
```

### Docker
```bash
# AI textures + ComfyUI
docker compose --profile ai-creative up -d

# Check ComfyUI
curl http://localhost:8188/health
```

---

## 10. KEY GAPS & OPPORTUNITIES FOR TESTING

### High-Priority Test Gaps
1. **TRELLIS2 Quality Validation** — No automated tests for GLB output quality, triangle budgets, bbox validation
2. **Particle Pool Stress Tests** — No tests for high-emission scenarios (1000+ particles/frame)
3. **Shader Compilation Edge Cases** — Limited coverage of shader error conditions
4. **Cross-Renderer Behavior** — Limited parity tests between WebGPU and Three.js FX
5. **Animation System** — No tests for AnimationMixer + gqAnimations coexistence
6. **LOD Switching** — No tests for LOD distance thresholds + mesh swapping
7. **Memory Leaks** — No long-running stability tests
8. **Procedural Generation Consistency** — No seed-based reproducibility tests
9. **ComfyUI Fallback** — Limited error handling + fallback logic validation
10. **Zoom Level Transitions** — Limited tests for renderer swapping during zoom

### Recommended Test Suite Structure
```
tests/3d-rendering/
  ├── trellis2/
  │   ├── quality-validation.test.js
  │   ├── glb-parsing.test.js
  │   └── asset-import.test.js
  ├── particles/
  │   ├── emitter-stress.test.js
  │   ├── pool-lifecycle.test.js
  │   └── gpu-compute-fallback.test.js
  ├── shaders/
  │   ├── compilation-errors.test.js
  │   ├── uniform-binding.test.js
  │   └── shader-replacement.test.js
  ├── geometry/
  │   ├── procedural-consistency.test.js
  │   ├── model-loading.test.js
  │   └── lod-switching.test.js
  └── integration/
      ├── renderer-parity.test.js
      ├── cross-backend-effects.test.js
      └── zoom-level-transitions.test.js
```

---

**End of Analysis** — Use this as a comprehensive reference for building test suites, debugging issues, and extending 3D/rendering systems in GalaxyQuest.
