# Visual Effects System Integration Guide

## Overview

The GalaxyQuest Visual Effects system provides comprehensive particle and visual effects for:
- **Spacecraft Propulsion** (Booster/Thruster effects)
- **Stellar Bodies** (Sun glow and flare animations)
- **Engine Materials** (Emissive nozzle pulsation)
- **Post-Processing** (Bloom effects)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         VisualEffectsManager (Central Coordinator)      │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │  ThrusterFX      │  │   SunAnimator    │             │
│  ├──────────────────┤  ├──────────────────┤             │
│  │ • Ship emitters  │  │ • Star pulsation │             │
│  │ • Particle trails│  │ • Color twinkle  │             │
│  │ • Throttle ctrl  │  │ • Light modulate │             │
│  └──────────────────┘  └──────────────────┘             │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │EngineMaterialAnim│  │PostEffectsManager│             │
│  ├──────────────────┤  ├──────────────────┤             │
│  │ • Material glow  │  │ • Bloom Pass     │             │
│  │ • Pulsation      │  │ • Composer chain │             │
│  └──────────────────┘  └──────────────────┘             │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Integration Steps

### 1. Initialize VisualEffectsManager in GameEngine

In the GameEngine initialization (after ParticleSystem and Renderer setup):

```javascript
// In GameEngine._initParticles() or similar
this.visualEffects = new VisualEffectsManager({
  particleSystem: this.particleSystem,
  renderer: this.renderer,
  scene: this.scene,
  camera: this.camera,
});

// Connect post-effects
if (this.postFx instanceof PostEffectsManager) {
  this.visualEffects.setPostEffects(this.postFx);
}
```

### 2. Update in Game Loop

In GameEngine._onUpdate():

```javascript
_onUpdate(dt, alpha) {
  // ... existing code ...
  
  // Update visual effects
  if (this.visualEffects) {
    this.visualEffects.update(dt, {
      velocities: this.getShipVelocities(),
      accelerations: this.getShipAccelerations(),
      positions: this.getShipPositions(),
    });
  }
  
  // ... rest of update ...
}
```

### 3. Attach Ships to Thruster Effects

When a ship is created/spawned:

```javascript
// Get the ship model (with engines metadata)
const shipModel = await assetRegistry.loadModel(shipModelId);

// Attach thruster effects
visualEffects.attachShip(shipId, shipModel, 'ion');  // or 'chemical', 'plasma', 'exotic'
```

### 4. Update Ship State Each Frame

When ship motion changes:

```javascript
visualEffects.updateShipState(
  shipId,
  shipPosition,   // {x, y, z}
  shipVelocity,   // {x, y, z}
  shipAcceleration // {x, y, z}
);
```

### 5. Attach Suns to Star Animation

When rendering stellar bodies:

```javascript
// After creating the star mesh
const starMesh = new THREE.Mesh(starGeometry, starMaterial);
const starLight = new THREE.PointLight(starColor, intensity, distance);

visualEffects.attachSun('star_alpha_centauri', starMesh, starLight, {
  pulseFrequency: 1.2,
  baseIntensity: 0.8,
  peakIntensity: 1.6,
  enableTwinkle: true,
});
```

### 6. Detach When Removing Objects

```javascript
// When ship is destroyed
visualEffects.detachShip(shipId);

// When leaving system
visualEffects.detachSun(starId);
```

## Model Format

Ships with engine effects must define an `engines` array in their JSON model:

```json
{
  "modelId": "ship_corvette",
  "engines": [
    {
      "id": "main_engine",
      "position": { "x": 0, "y": -1.1, "z": 0 },
      "direction": { "x": 0, "y": -1, "z": 0 },
      "size": 0.28,
      "propulsionType": "ion"
    }
  ],
  ...
}
```

Fields:
- `id` — Unique engine identifier
- `position` — World-space offset from ship origin
- `direction` — Emission direction (normalized)
- `size` — Engine nozzle radius (for particle size scaling)
- `propulsionType` — One of: `chemical`, `ion`, `plasma`, `exotic`

## Propulsion Types

### Chemical (Orange/Red)
- Realistic rocket flames
- 25 particles/sec
- High drag (0.05)
- Pulsation: 2.0 Hz

### Ion (Blue/Cyan)
- Electric propulsion
- 20 particles/sec
- Low drag (0.04)
- Pulsation: 1.5 Hz

### Plasma (White/Violet)
- High-energy exotic drive
- 30 particles/sec
- Medium drag (0.06)
- Pulsation: 3.0 Hz

### Exotic (Purple)
- Jump drive / warp effects
- 15 particles/sec
- Very low drag (0.03)
- Pulsation: 1.2 Hz

## LOD & Performance

Adjust particle density for LOD:

```javascript
// High detail (100% particles)
visualEffects.setParticleDensityScale(1.0);

// Medium detail (50% particles)
visualEffects.setParticleDensityScale(0.5);

// Low detail (10% particles)
visualEffects.setParticleDensityScale(0.1);

// Disable
visualEffects.setParticleDensityScale(0.0);
```

Similarly for stellar glow:

```javascript
visualEffects.setSunIntensityScale(scale);
```

## Post-Processing Integration

The PostEffectsManager is automatically enabled when:
- `postEffects: true` in quality profile features
- UnrealBloomPass is configured with optimized settings
- Bloom parameters: threshold=0.6, strength=1.8, radius=0.8

To customize:

```javascript
if (engine.postFx) {
  engine.postFx.config.bloom = {
    threshold: 0.5,  // Lower = more aggressive bloom
    strength: 2.0,   // Higher = brighter glow
    radius: 1.0,     // Larger = bigger spread
  };
}
```

## Performance Considerations

1. **GPU Compute Particles**: Automatic for WebGPU renderers
2. **CPU Fallback**: Graceful fallback for WebGL2
3. **Per-Frame Cost**:
   - ThrusterFX: O(num_ships × num_engines)
   - SunAnimator: O(num_stars)
   - Material Animation: O(num_materials)
4. **Memory**: ~64 bytes per particle (WebGPU pool)

## Debugging

Enable verbose logging:

```javascript
// Per-system
visualEffects._thrusterFX._enabled = true;
visualEffects._sunAnimator._enabled = true;

// Check active emitters
const slot = visualEffects._thrusterFX.getSlot(shipId);
console.log('Emitters:', slot.emitters.length);
console.log('Lights:', slot.lights.length);

// Monitor sun state
console.log('Active suns:', visualEffects._sunAnimator._suns.size);
```

## Examples

### Full Integration Example

```javascript
class GameScene {
  async initialize(engine) {
    this.engine = engine;
    
    // VFX manager is auto-initialized
    const vfx = engine.visualEffects;
    
    // Load a ship model
    const corvette = await engine.assets.loadModel('ship_corvette');
    
    // Spawn multiple ships
    for (let i = 0; i < 10; i++) {
      const shipId = `ship_${i}`;
      const mesh = corvette.clone();
      this.scene.add(mesh);
      
      // Attach thruster effects
      vfx.attachShip(shipId, corvette, 'ion');
    }
    
    // Load and animate a sun
    const sunGeometry = new THREE.SphereGeometry(100, 32, 32);
    const sunMaterial = engine.materialFactory.createAnimatedSunMaterial(0xffaa33);
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    const sunLight = new THREE.PointLight(0xffaa33, 5, 500);
    this.scene.add(sunMesh);
    
    vfx.attachSun('sol', sunMesh, sunLight, {
      pulseFrequency: 1.0,
      baseIntensity: 0.9,
      peakIntensity: 1.4,
      lightIntensity: 4.0,
      enableTwinkle: true,
    });
  }
  
  update(dt) {
    // Update ship physics/positions
    this.updateShipMotion(dt);
    
    // Update VFX with current state
    for (const [shipId, ship] of this.ships) {
      this.engine.visualEffects.updateShipState(
        shipId,
        ship.position,
        ship.velocity,
        ship.acceleration
      );
    }
  }
}
```

## References

- **ThrusterFX.js** — Propulsion particle effect manager
- **SunAnimator.js** — Stellar body glow animator
- **EngineMaterialAnimator.js** — Engine nozzle material animator
- **VisualEffectsManager.js** — Central coordinator
- **PostEffectsManager.js** — Bloom and post-processing
- **ParticleEmitter.js** — Particle emission configuration
- **ParticleSystem.js** — CPU particle pool
- **GPUParticleSystem.js** — WebGPU particle simulation

## License

MIT — makr-code/GalaxyQuest
