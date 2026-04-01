# WebGPU Implementation Guide — GalaxyQuest

> **Zielgruppe:** Entwickler, die an Phase 1+ arbeiten  
> **Voraussetzung:** Phase 0 (Skeleton) ist gemergt

---

## 1. Quick Start

### WebGPU-Renderer initialisieren

```javascript
import { RendererFactory } from './js/engine/core/RendererFactory.js';

const canvas   = document.getElementById('my-canvas');
const renderer = await RendererFactory.create(canvas, {
  hint: 'auto',  // 'webgpu' | 'webgl2' | 'auto'
  onFallback(reason) {
    console.info('Renderer fallback:', reason);
  },
});

// Capabilities prüfen
const caps = renderer.getCapabilities();
console.log('WebGPU active:', caps.webgpu);
console.log('Compute shaders:', caps.computeShaders);
```

### Ohne Module (globale Scripts)

```html
<script src="js/engine/core/GraphicsContext.js"></script>
<script src="js/engine/core/WebGPURenderer.js"></script>
<script src="js/engine/core/WebGLRenderer.js"></script>
<script src="js/engine/core/RendererFactory.js"></script>
<script src="js/engine-compat.js"></script>
<script>
  window.addEventListener('gq:rendererReady', ({ detail }) => {
    console.log('Backend:', detail.backend); // 'webgpu' or 'webgl2'
  });
  GQEngineCompat.getRenderer(canvas);
</script>
```

---

## 2. Buffer erstellen

```javascript
import { WebGPUBuffer, BufferType, BufferUsage } from './js/engine/webgpu/WebGPUBuffer.js';

// Vertex Buffer (static)
const positions = new Float32Array([0,0,0, 1,0,0, 0.5,1,0]);
const vBuf = new WebGPUBuffer(device, BufferType.VERTEX, positions, BufferUsage.STATIC);

// Uniform Buffer (dynamic — updated each frame)
const uniformData = new Float32Array(16); // mat4
const uBuf = new WebGPUBuffer(device, BufferType.UNIFORM, uniformData, BufferUsage.DYNAMIC);

// Update per frame:
uBuf.update(newMatrixData);

// Aufräumen:
vBuf.destroy();
uBuf.destroy();
```

---

## 3. Textur laden

```javascript
import { WebGPUTexture } from './js/engine/webgpu/WebGPUTexture.js';
import { TextureLoader } from './js/engine/loaders/TextureLoader.js';

// Direkter Weg:
const tex = new WebGPUTexture(device, {
  width: 512, height: 512,
  format: 'rgba8unorm',
  mipMaps: true,
  renderTarget: false,
});
tex.uploadImage(imageBitmap);

// Via Loader:
const loader = new TextureLoader(renderer);
const planetTex = await loader.load('gfx/planet_earth.png');
```

---

## 4. GPU-Physics für Flotten

### Integration mit SpacePhysicsEngine

```javascript
import { WebGPUPhysics } from './js/engine/webgpu/WebGPUPhysics.js';

// Einmalig initialisieren:
const gpuPhysics = new WebGPUPhysics(device, {
  gravitationalConstant: 9.5e-4,
  softening: 180,
  maxAcceleration: 420,
});
gpuPhysics.init();

// Game Loop:
function onUpdate(dt) {
  // 1. Thrust-Werte aus Spiellogik setzen (in CPU engine.bodies)
  fleet.forEach(ship => {
    const body = engine.bodies.get(ship.bodyId);
    body.thrust = ship.currentThrust;
  });

  // 2. CPU→GPU Upload (nur wenn Körper hinzugefügt/entfernt wurden)
  gpuPhysics.uploadBodies(engine.bodies);

  // 3. GPU Schritt (non-blocking dispatch)
  gpuPhysics.step(dt);

  // 4. Async Readback (positions/velocities zurück ins JS-Objekt)
  gpuPhysics.readback(engine.bodies).then(() => {
    // Positionen sind jetzt aktuell
    fleet.forEach(ship => ship.syncFromBody(engine.bodies.get(ship.bodyId)));
  });
}
```

### Wann GPU-Physics sinnvoll ist

| Szenario | CPU (JS) | GPU (WebGPU) |
|---|---|---|
| < 50 Körper | ✅ Optimal | Overhead zu hoch |
| 50–500 Körper | ⚠️ Merklicher Overhead | ✅ Optimal |
| > 500 Körper | ❌ Engpass | ✅ Stark empfohlen |

---

## 5. WGSL Shader schreiben

### Mindest-Template

```wgsl
// mein-shader.wgsl
@group(0) @binding(0) var<uniform> params: MyParams;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var inputSmp: sampler;

struct MyParams { strength: f32, }

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0)       uv:  vec2<f32>,
}

@vertex fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
  // Screen quad aus vertex_index (kein Vertex-Buffer nötig)
  var pos = array<vec2<f32>,6>(
    vec2(-1,-1), vec2(1,-1), vec2(1,1),
    vec2(-1,-1), vec2(1, 1), vec2(-1,1)
  );
  var out: VSOut;
  out.pos = vec4<f32>(pos[idx], 0.0, 1.0);
  out.uv  = pos[idx] * 0.5 + 0.5;
  return out;
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let col = textureSample(inputTex, inputSmp, in.uv);
  return col * params.strength;
}
```

### Shader laden und preprocessen

```javascript
import { ShaderLoader } from './js/engine/loaders/ShaderLoader.js';

const src = await ShaderLoader.load(
  'js/engine/post-effects/shaders/bloom.wgsl',
  { WORKGROUP_SIZE: 64 }  // #define Substitutionen
);
```

---

## 6. ResourceTracker nutzen (Memory Leaks vermeiden)

```javascript
import { ResourceTracker } from './js/engine/utils/ResourceTracker.js';

const tracker = new ResourceTracker();

// Jedes GPU-Objekt tracken:
const buf = tracker.track(new WebGPUBuffer(device, ...));
const tex = tracker.track(new WebGPUTexture(device, ...));

// Bei Scene-Wechsel / Component-Destroy:
tracker.disposeAll();

// Im Debug-Modus: auf Leaks prüfen:
if (process.env.NODE_ENV === 'development') {
  window.addEventListener('beforeunload', () => tracker.report());
}
```

---

## 7. Performance-Monitoring

```javascript
import { PerformanceMonitor } from './js/engine/utils/PerformanceMonitor.js';

const monitor = new PerformanceMonitor({
  sampleWindow:     60,   // Frames für FPS-Durchschnitt
  warnThresholdFps: 30,   // Warnung wenn unter dieser Grenze
});

// Im Animation Loop:
function render(ts) {
  monitor.tick(ts);

  if (monitor.fps < 30) {
    // Qualität reduzieren: Post-Effects deaktivieren, etc.
    effectComposer.removePass(bloomPass);
  }

  const { fps, frameTimeMs } = monitor.stats();
  hud.updateFps(fps, frameTimeMs);

  requestAnimationFrame(render);
}
```

---

## 8. Renderer forcieren (Dev-Mode)

```javascript
// In der Browser-Console:
GQEngineCompat.setHint('webgpu');   // WebGPU erzwingen
GQEngineCompat.setHint('webgl2');   // WebGL2 erzwingen
GQEngineCompat.setHint('auto');     // Auto (default)
// dann: location.reload()

// Aktuellen Backend prüfen:
console.log(GQEngineCompat.isWebGPU); // true/false
```

---

## 9. Häufige Fehler

### "WebGPU not supported"
→ Browser unterstützt kein WebGPU. RendererFactory fällt automatisch auf WebGL2 zurück.

### "No WebGPU adapter found"
→ Kein kompatibles GPU im System. Kann auf VMs oder CI-Servern passieren.

### Buffer-Update nach Destroy
→ `ResourceTracker` verwenden — schützt vor Use-After-Free.

### Shader Compilation Error
→ WGSL ist streng typisiert. Fehler erscheinen in der Browser-Console mit exakter Zeile.
→ `WebGPUShader.js` cached failed pipelines NICHT — nach Fix werden sie neu kompiliert.

### Performance-Problem nach Migration
→ `PerformanceMonitor` aktivieren + `WebGPUCapabilities.tier` prüfen.
→ Auf `'low'`-Tier Post-Effects deaktivieren.
