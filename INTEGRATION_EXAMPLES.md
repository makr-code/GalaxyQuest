/**
 * INTEGRATION_EXAMPLES.md
 *
 * Practical examples for integrating the new 3D engine features into GalaxyQuest.
 * Each section shows how to use a new system in real code contexts.
 */

# Integration Examples: Advanced 3D Engine Features

## 1. LOD Manager Integration

### In GameEngine.js

```javascript
// In GameEngine.constructor()
const { LODConfig } = require('./lod/LODConfig.js');
const { LODManager } = require('./lod/LODManager.js');

this._lodConfig = new LODConfig();
this._lodManager = new LODManager(this._lodConfig, { enableMetrics: true });

// In GameEngine.start()
// Register all rendered ships and objects with LOD manager
this.events.on('render:frame', (frame) => {
  // Get all visible objects from scene
  const ships = this.getVisibleShips(); // Your method
  for (const ship of ships) {
    if (!this._lodManager.getObjectLODInfo(ship.id)) {
      this._lodManager.registerObject(
        ship.id,
        ship.mesh,
        'ship',  // model type
        ship.position
      );
    }
  }
});

// In GameEngine._onUpdate(deltaTime)
// Update LOD state based on camera position
const fps = this.performanceMonitor.getAverageFPS();
this._lodManager.update(deltaTime, this.camera.position, fps);

// In GameEngine._onRender()
// Apply LOD visual state
for (const [id, lodObj] of this._lodManager.getObjects()) {
  if (lodObj.currentLOD.culled) {
    lodObj.mesh.visible = false;
  } else if (!lodObj.currentLOD.usesBillboard) {
    lodObj.mesh.visible = true;
    // Optionally swap mesh variants here
  } else {
    // Render as 2D billboard
    this._renderBillboard(lodObj);
  }
}

// Optional: Log metrics
const metrics = this._lodManager.getMetrics();
console.log('LOD Stats:', {
  objects: metrics.totalObjects,
  triangles: metrics.trianglesRendered,
  avgQuality: (metrics.averageQuality * 100).toFixed(1) + '%',
});
```

---

## 2. Post-Processing Pipeline Integration

### In GameEngine.js

```javascript
// In GameEngine.constructor()
const { EffectComposer } = require('./post-effects/EffectComposer.js');
const { RenderPass } = require('./post-effects/passes/RenderPass.js');
const { DynamicBloomPass } = require('./post-effects/passes/DynamicBloomPass.js');
const { HDRTonemappingPass } = require('./post-effects/passes/HDRTonemappingPass.js');
const { MotionVectorPass } = require('./post-effects/passes/MotionVectorPass.js');
const { DepthOfFieldPass } = require('./post-effects/passes/DepthOfFieldPass.js');

// Create effect composer
this.effectComposer = new EffectComposer(this.renderer, width, height);

// Build post-processing pipeline in order
const renderPass = new RenderPass(this.scene, this.camera);
this.effectComposer.addPass(renderPass);

// Base scene rendering

// Optional: Dynamic bloom for HDR
const bloomPass = new DynamicBloomPass({
  threshold: 0.85,
  strength: 0.6,
  radius: 1.5,
  adaptiveThreshold: true,
});
this.effectComposer.addPass(bloomPass);

// Optional: Motion blur
const motionBlurPass = new MotionVectorPass({
  blurScale: 1.0,
  sampleCount: 12,
  maxMotionBlur: 20,
});
this.effectComposer.addPass(motionBlurPass);

// HDR tone-mapping (should be near end)
const tonemapPass = new HDRTonemappingPass({
  tonemappingMode: 'ACES',
  exposure: 1.0,
  saturation: 1.0,
  gamma: 2.2,
});
this.effectComposer.addPass(tonemapPass);

// Optional: Depth of field
const dofPass = new DepthOfFieldPass({
  focalDistance: 1000,
  focalLength: 50,
  aperture: 2.8,
  maxBlur: 25,
});
dofPass.enabled = false;  // Disabled by default
this.effectComposer.addPass(dofPass);

// In GameEngine._onRender()
this.effectComposer.render();

// Optional: UI controls for effects
setupEffectsUI() {
  document.getElementById('bloom-strength-slider').addEventListener('change', (e) => {
    const bloomPass = this.effectComposer._passes.find(p => p instanceof DynamicBloomPass);
    if (bloomPass) bloomPass.setStrength(parseFloat(e.target.value));
  });

  document.getElementById('exposure-slider').addEventListener('change', (e) => {
    const tonemapPass = this.effectComposer._passes.find(p => p instanceof HDRTonemappingPass);
    if (tonemapPass) tonemapPass.setExposure(parseFloat(e.target.value));
  });

  document.getElementById('tonemapping-mode').addEventListener('change', (e) => {
    const tonemapPass = this.effectComposer._passes.find(p => p instanceof HDRTonemappingPass);
    if (tonemapPass) tonemapPass.setTonemappingMode(e.target.value);
  });
}
```

---

## 3. Impact Decal Manager Integration

### In CombatFX.js

```javascript
const { ImpactDecalManager } = require('../lod/../fx/ImpactDecalManager.js');

class CombatFX {
  constructor(scene) {
    this.scene = scene;
    this.decalManager = new ImpactDecalManager({ 
      scene,
      maxDecals: 500,
    });
  }

  // When a weapon impacts a target
  onWeaponImpact(impactPoint, impactNormal, impactIntensity, targetObject) {
    // Create decal at impact point
    const position = impactPoint.clone();
    const rotation = this._getNormalAsQuaternion(impactNormal);
    const scale = this._getDecalScale(impactIntensity);

    let decalType = 'impact';
    if (impactIntensity > 100) {
      decalType = 'explosion';  // Large impact
    } else if (impactIntensity > 50) {
      decalType = 'burn';  // Medium impact
    }

    const decalId = this.decalManager.addDecal(
      position,
      rotation,
      scale,
      decalType,
      {
        lifespan: 10000 + impactIntensity * 10,  // Longer lifespan for intense impacts
        fadeOutStart: 2000,  // Start fading 2 seconds before expiration
      }
    );

    return decalId;
  }

  // When an explosion occurs
  onExplosion(center, radius, intensity) {
    // Create circular decal pattern
    const decalCount = Math.ceil(intensity / 20);
    const angleStep = (Math.PI * 2) / decalCount;

    for (let i = 0; i < decalCount; i++) {
      const angle = angleStep * i;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;

      this.decalManager.addDecal(
        new THREE.Vector3(x, center.y, z),
        new THREE.Quaternion(),
        new THREE.Vector3(radius * 0.3, radius * 0.3, 1),
        'explosion',
        { lifespan: 15000, fadeOutStart: 3000 }
      );
    }
  }

  update(deltaTime) {
    this.decalManager.update(deltaTime);

    // Log stats
    const stats = this.decalManager.getStats();
    if (stats.activeDecals > 400) {
      console.warn('High decal load:', stats.activeDecals);
    }
  }

  dispose() {
    this.decalManager.dispose();
  }

  _getNormalAsQuaternion(normal) {
    const up = new THREE.Vector3(0, 1, 0);
    if (normal.dot(up) > 0.99) {
      up.set(0, 0, 1);
    }
    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    return quat;
  }

  _getDecalScale(intensity) {
    const scale = Math.sqrt(intensity) * 2;
    return new THREE.Vector3(scale, scale, 1);
  }
}
```

---

## 4. Cinematic Camera Integration

### In MissionController.js

```javascript
const { CinematicCamera } = require('../engine/scene/CinematicCamera.js');

class MissionIntro {
  constructor(camera, scene) {
    this.cinematicCamera = new CinematicCamera(camera);
    this.setupIntroCinematic();
  }

  setupIntroCinematic() {
    // Define camera path for mission opening
    const keyframes = [
      {
        time: 0,
        position: new THREE.Vector3(0, 500, -1500),
        target: new THREE.Vector3(0, 0, 0),
        fov: 30,
        easing: 'ease-out-cubic',
      },
      {
        time: 3,
        position: new THREE.Vector3(1000, 300, -500),
        target: new THREE.Vector3(500, 0, 500),
        fov: 45,
        easing: 'ease-in-out-cubic',
      },
      {
        time: 6,
        position: new THREE.Vector3(500, 200, 1000),
        target: new THREE.Vector3(0, -100, 0),
        fov: 60,
        easing: 'ease-in-cubic',
      },
      {
        time: 9,
        position: new THREE.Vector3(0, 400, -1000),
        target: new THREE.Vector3(0, 0, 0),
        fov: 50,
        easing: 'linear',
      },
    ];

    this.cinematicCamera.addKeyframes(keyframes);
  }

  playIntro() {
    this.cinematicCamera.play();
  }

  onUpdate(deltaTime) {
    this.cinematicCamera.update(deltaTime);

    // Check if cinematic finished
    if (!this.cinematicCamera.isPlaying()) {
      this.onIntroCinematicComplete();
    }
  }

  onIntroCinematicComplete() {
    console.log('Intro cinematic finished');
    // Switch to gameplay camera
    this.gameEngine.camera.position.copy(this.cinematicCamera._baseCamera.position);
  }

  skipIntro() {
    this.cinematicCamera.stop();
    this.onIntroCinematicComplete();
  }
}
```

---

## 5. Procedural Mesh Generation Integration

### In AsteroidSpawner.js

```javascript
const { ProceduralMeshGenerator } = require('../engine/procedural/ProceduralMeshGenerator.js');

class AsteroidSpawner {
  constructor(scene) {
    this.scene = scene;
    this.meshGenerator = new ProceduralMeshGenerator();
    this.asteroids = new Map();
  }

  spawnAsteroid(id, position, scale = 100) {
    // Generate unique procedural geometry
    const geometry = this.meshGenerator.generateAsteroid({
      seed: Math.hash(id),  // Deterministic seed based on ID
      scale: scale,
      complexity: 2 + Math.random() * 2,  // Complexity 2-4
      fracture: true,
    });

    // Create material
    const material = new THREE.MeshStandardMaterial({
      color: 0x8B7355,
      metalness: 0.3,
      roughness: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.scene.add(mesh);
    this.asteroids.set(id, {
      mesh,
      geometry,
      position: position.clone(),
    });

    return mesh;
  }

  spawnDebrisField(centerPos, count = 20, scale = 50) {
    const debris = this.meshGenerator.generateDebrisField({
      count,
      scale,
      seed: Math.random(),
    });

    const meshes = [];
    for (const piece of debris) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x5A4A3A,
        roughness: 0.9,
      });

      const mesh = new THREE.Mesh(piece.geometry, material);
      mesh.position.copy(centerPos).add(piece.position);
      mesh.rotation.set(piece.rotation.x, piece.rotation.y, piece.rotation.z);

      this.scene.add(mesh);
      meshes.push(mesh);
    }

    return meshes;
  }

  getMemoryStats() {
    return this.meshGenerator.getCacheStats();
  }

  dispose() {
    this.asteroids.forEach(ast => {
      ast.geometry?.dispose();
      ast.mesh?.material?.dispose();
      this.scene.remove(ast.mesh);
    });
    this.asteroids.clear();
    this.meshGenerator.clearCache();
  }
}
```

---

## 6. Visual Settings UI

### In SettingsPanel.js

```html
<!-- In HTML template -->
<div class="graphics-settings">
  <section id="lod-settings">
    <h3>Level of Detail</h3>
    <label>
      <input type="checkbox" id="lod-enabled" checked />
      Enable LOD
    </label>
    <label>
      Target FPS:
      <input type="range" id="lod-fps" min="20" max="60" value="60" />
      <span id="lod-fps-value">60</span>
    </label>
  </section>

  <section id="bloom-settings">
    <h3>Bloom & Glow</h3>
    <label>
      Strength:
      <input type="range" id="bloom-strength" min="0" max="2" step="0.1" value="0.6" />
      <span id="bloom-strength-value">0.6</span>
    </label>
    <label>
      Threshold:
      <input type="range" id="bloom-threshold" min="0.5" max="1.5" step="0.05" value="0.85" />
      <span id="bloom-threshold-value">0.85</span>
    </label>
    <label>
      <input type="checkbox" id="bloom-adaptive" checked />
      Adaptive Threshold
    </label>
  </section>

  <section id="tonemapping-settings">
    <h3>Color & Tone Mapping</h3>
    <label>
      Mode:
      <select id="tonemapping-mode">
        <option value="ACES" selected>ACES (Cinematic)</option>
        <option value="REINHARD">Reinhard (Photo)</option>
        <option value="UE4">Unreal Engine 4</option>
        <option value="LINEAR">Linear</option>
      </select>
    </label>
    <label>
      Exposure:
      <input type="range" id="exposure" min="0.1" max="3" step="0.1" value="1" />
      <span id="exposure-value">1.0</span>
    </label>
    <label>
      Color Temp (K):
      <input type="range" id="color-temp" min="2000" max="10000" step="100" value="6500" />
      <span id="color-temp-value">6500K</span>
    </label>
  </section>

  <section id="motion-blur-settings">
    <h3>Motion Effects</h3>
    <label>
      Motion Blur:
      <input type="range" id="motion-blur" min="0" max="2" step="0.1" value="1" />
      <span id="motion-blur-value">1.0</span>
    </label>
    <label>
      Depth of Field (Focal Distance):
      <input type="range" id="dof-focal" min="500" max="5000" step="100" value="1000" />
      <span id="dof-focal-value">1000</span>
    </label>
  </section>
</div>
```

```javascript
// In SettingsController.js
class SettingsController {
  constructor(gameEngine) {
    this.gameEngine = gameEngine;
    this.bindUI();
  }

  bindUI() {
    // LOD Settings
    document.getElementById('lod-enabled').addEventListener('change', (e) => {
      this.gameEngine._lodManager?.setEnabled(e.target.checked);
    });

    // Bloom Settings
    document.getElementById('bloom-strength').addEventListener('change', (e) => {
      const pass = this.gameEngine.effectComposer._passes.find(
        p => p.name === 'DynamicBloomPass'
      );
      if (pass) pass.setStrength(parseFloat(e.target.value));
      document.getElementById('bloom-strength-value').textContent = e.target.value;
    });

    // Tone Mapping
    document.getElementById('tonemapping-mode').addEventListener('change', (e) => {
      const pass = this.gameEngine.effectComposer._passes.find(
        p => p.name === 'HDRTonemappingPass'
      );
      if (pass) pass.setTonemappingMode(e.target.value);
    });

    document.getElementById('exposure').addEventListener('change', (e) => {
      const pass = this.gameEngine.effectComposer._passes.find(
        p => p.name === 'HDRTonemappingPass'
      );
      if (pass) pass.setExposure(parseFloat(e.target.value));
      document.getElementById('exposure-value').textContent = e.target.value;
    });

    // Motion Blur
    document.getElementById('motion-blur').addEventListener('change', (e) => {
      const pass = this.gameEngine.effectComposer._passes.find(
        p => p.name === 'MotionVectorPass'
      );
      if (pass) pass.setBlurScale(parseFloat(e.target.value));
      document.getElementById('motion-blur-value').textContent = e.target.value;
    });
  }
}
```

---

## Performance Monitoring

```javascript
// In PerformanceMonitor.js
class RenderQualityMonitor {
  constructor(lodManager, effectComposer) {
    this.lodManager = lodManager;
    this.effectComposer = effectComposer;
    this.metrics = {};
  }

  update(deltaTime) {
    const lodStats = this.lodManager.getMetrics();
    
    this.metrics = {
      triangles: lodStats.trianglesRendered,
      quality: (lodStats.averageQuality * 100).toFixed(1),
      lodSwitches: lodStats.lodSwitches,
      fps: this.getFPS(),
    };
  }

  getReport() {
    return `
      Rendering Stats:
      - Triangles: ${this.metrics.triangles.toLocaleString()}
      - Avg Quality: ${this.metrics.quality}%
      - LOD Switches: ${this.metrics.lodSwitches}
      - FPS: ${this.metrics.fps}
    `;
  }
}
```

---

**Last Updated**: July 30, 2026
