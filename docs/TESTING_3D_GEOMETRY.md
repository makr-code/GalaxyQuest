# 3D Geometry & Particle Systems Testing Guide

## Overview

Comprehensive test suite for AI-generated 3D ship geometry, particle effects, and texture systems in GalaxyQuest. Tests cover:

- ✅ **TRELLIS2 Integration**: Geometry generation, quality validation, asset import
- ✅ **Particle Systems**: CPU/GPU pools, emitters (BURST/CONTINUOUS), combat FX
- ✅ **Texture Generation**: Procedural (FBM), AI-generated (ComfyUI), caching
- ✅ **Performance**: Quality tiers, rendering budgets, memory constraints
- ✅ **Integration**: End-to-end pipeline validation

## Test Files

### Unit Tests

| File | Coverage | Scenarios |
|------|----------|-----------|
| `tests/unit/3d-geometry-trellis2.test.js` | 285 lines | 20 test cases |
| `tests/unit/particle-systems.test.js` | 420 lines | 32 test cases |
| `tests/unit/texture-systems.test.js` | 380 lines | 28 test cases |
| **Total Unit Tests** | **1,085 lines** | **80 test cases** |

### Integration Tests

| File | Coverage | Scenarios |
|------|----------|-----------|
| `tests/integration/3d-asset-pipeline.test.js` | 390 lines | 24 test cases |

## Quick Start

### Run All Tests
```bash
npm run test:js

# Or use the dedicated script
./scripts/test-3d-geometry.ps1 -TestType all
```

### Run Unit Tests Only
```bash
./scripts/test-3d-geometry.ps1 -TestType unit
```

### Run Integration Tests Only
```bash
./scripts/test-3d-geometry.ps1 -TestType integration
```

### Watch Mode (Auto-rerun on changes)
```bash
./scripts/test-3d-geometry.ps1 -TestType all -Watch
```

### Generate Coverage Report
```bash
./scripts/test-3d-geometry.ps1 -TestType all -Coverage
```

### Verbose Output
```bash
./scripts/test-3d-geometry.ps1 -TestType all -Verbose
```

## Test Categories

### 1. 3D Geometry (TRELLIS2)

**File**: `tests/unit/3d-geometry-trellis2.test.js`

Tests AI-generated ship geometry validation and import pipeline.

#### Quality Budget Validation
```javascript
TRELLIS2Validator.validate(asset, 'corvette', 'medium')
// Returns: { valid: bool, errors: [], warnings: [] }
```

**Test Coverage**:
- ✅ GLB asset structure (metadata, materials, textures)
- ✅ Triangle budget enforcement per ship class
- ✅ Bone count limits (rigged models)
- ✅ Material slot validation (baseColor, roughness, etc.)
- ✅ Bounding box validity checks
- ✅ Multi-tier quality selection (low/medium/high)
- ✅ Three.js + WebGPU compatibility
- ✅ Import pipeline error handling

#### Quality Budgets
| Ship Class | Low | Medium | High | Max Bones |
|-----------|-----|--------|------|-----------|
| Fighter | 1.5K | 2.25K | 3K | 8 |
| Corvette | 6K | 6K | 8K | 16 |
| Freighter | 11K | 11K | 15K | 24 |
| Capital | 12.5K | 18.75K | 25K | 32 |

### 2. Particle Systems

**File**: `tests/unit/particle-systems.test.js`

Tests particle pool allocation, emitter behavior, and rendering performance.

#### Particle Pool
```javascript
const pool = new ParticlePool(4096); // Default max particles

// Spawn particle: position, velocity, color, lifetime
pool.spawn([0,0,0], [1,0,0], [1,1,1,1], 2.0);

// Update physics each frame
pool.update(0.016); // ~60 FPS
```

**Test Coverage**:
- ✅ Memory allocation (64 bytes/particle default)
- ✅ Physics simulation (velocity, gravity, acceleration)
- ✅ Lifecycle management (spawn, age, death)
- ✅ Color interpolation + alpha fading
- ✅ BURST mode (instant particles)
- ✅ CONTINUOUS mode (over time)
- ✅ Combat FX scenarios (weapon fire, explosions, shields)
- ✅ Performance under load (1000+ particles)

#### Combat FX Scenarios
```javascript
// Weapon fire (tight spread, short lifetime)
emitter.velocity = { speed: 50, spread: 0.2 };
emitter.particleLifetime = 0.1;
emitter.burst(20);

// Explosion (wide spread, longer lifetime)
emitter.velocity = { speed: 30, spread: Math.PI * 2 };
emitter.particleLifetime = 2.0;
emitter.burst(200);

// Engine thrust (continuous, positioned emitter)
emitter.mode = 'continuous';
emitter.particlesPerSecond = 500;
emitter.particleLifetime = 0.2;
```

### 3. Texture Systems

**File**: `tests/unit/texture-systems.test.js`

Tests procedural texture generation, AI texture generation via ComfyUI, and caching.

#### Procedural Textures (FBM)
```javascript
const generator = new ProceduralTextureGenerator(seed);

// Generate planet surface
const albedo = generator.generatePlanetAlbedo(512, 'earth');
// Returns: { type, size, data: Uint8Array, colorScheme }

// Generate normal map from albedo
const normal = generator.generateNormalMap(albedo);
```

**Color Schemes**:
- `'earth'`: Blue oceans, green continents, snow peaks
- `'desert'`: Sand dunes, rock formations
- `'ice'`: Glaciers, frozen terrain

#### AI Texture Generation (ComfyUI)
```javascript
const aiGen = new AITextureGenerator();

// Generate single texture
const texture = await aiGen.generateTexture(
  'metal hull with corrosion',
  'baseColor',
  'high'
);

// Generate complete material set
const materials = await aiGen.generateMaterialSet(
  'space ship hull',
  'medium'
);
```

**Quality Tiers**:
| Tier | Resolution | Steps | Steps |
|------|------------|-------|--------|
| Low | 512x512 | 20 | 7.5 |
| Medium | 1024x1024 | 30 | 7.5 |
| High | 2048x2048 | 50 | 8.0 |

**Test Coverage**:
- ✅ Procedural generation (FBM, color mapping)
- ✅ Normal map derivation (Sobel filter)
- ✅ AI texture generation (ComfyUI workflow)
- ✅ Material set generation (PBR slots)
- ✅ Texture caching with LRU eviction
- ✅ Memory budget management
- ✅ Quality tier scaling
- ✅ Shader validation (WGSL, GLSL)

### 4. Pipeline Integration

**File**: `tests/integration/3d-asset-pipeline.test.js`

End-to-end workflow: TRELLIS2 → ComfyUI → Validation → Rendering.

#### Complete Asset Generation
```javascript
const pipeline = new AssetPipeline();

const result = await pipeline.generateShipAsset(
  'sleek fighter with engine nacelles',
  'fighter',
  'medium'
);

// Result structure:
// {
//   success: bool,
//   asset: {
//     id, name, class, geometry, textures, materials, metadata
//   },
//   steps: [
//     { name, input, output },
//     { name, input, output },
//     ...
//   ]
// }
```

**Pipeline Steps**:
1. **TRELLIS2 Geometry Generation**
   - Input: prompt, ship class, quality tier
   - Output: triangles, bones, materials, bounding box

2. **ComfyUI Texture Generation**
   - Input: prompt, quality tier
   - Output: baseColor, roughness, normal, metallic (2048×2048 max)

3. **Asset Validation**
   - Geometry checks: triangles, bones, bbox validity
   - Texture checks: required slots, resolution limits
   - Material hierarchy validation

4. **Asset Import**
   - Register in asset registry
   - Build material definitions
   - Generate metadata (timestamp, validation result)

**Test Coverage**:
- ✅ Full pipeline execution
- ✅ Quality tier scaling
- ✅ Rendering with particles
- ✅ Performance budget validation
- ✅ Multi-ship battle scenarios
- ✅ Batch asset generation
- ✅ Error recovery
- ✅ Asset storage/retrieval

#### Performance Budgets
```javascript
const budget = PerformanceBudget.BUDGETS['corvette'];
// {
//   triangles: 8000,
//   materials: 4,
//   particlesPerShip: 100,
//   memoryMB: 64,
//   targetFPS: 60
// }
```

## Example Test Runs

### Validate Fighter Geometry
```javascript
import { TRELLIS2Validator } from './3d-geometry-trellis2.test.js';

const asset = new MockGLBAsset('fighter-001', 2500);
const result = TRELLIS2Validator.validate(asset, 'fighter', 'high');

if (result.valid) {
  console.log('✓ Fighter geometry valid');
} else {
  console.error('✗ Errors:', result.errors);
  console.error('✗ Warnings:', result.warnings);
}
```

### Simulate Combat Particles
```javascript
import { ParticlePool, ParticleEmitter } from './particle-systems.test.js';

const pool = new ParticlePool(2000);
const emitter = new ParticleEmitter(pool, [0, 0, 0], 'burst');

// Weapon fire effect
emitter.velocity = { speed: 50, spread: 0.1 };
emitter.burst(20);

for (let frame = 0; frame < 60; frame++) {
  pool.update(0.016);
  console.log(`Frame ${frame}: ${pool.activeCount} particles`);
}
```

### Generate Planet Texture
```javascript
import { ProceduralTextureGenerator } from './texture-systems.test.js';

const gen = new ProceduralTextureGenerator(12345);
const albedo = gen.generatePlanetAlbedo(1024, 'earth');
const normal = gen.generateNormalMap(albedo);

console.log(`✓ Generated ${albedo.size}×${albedo.size} planet texture`);
```

### Full Asset Pipeline
```javascript
import { AssetPipeline } from './3d-asset-pipeline.test.js';

const pipeline = new AssetPipeline();

const result = await pipeline.generateShipAsset(
  'modular cargo freighter',
  'freighter',
  'high'
);

if (result.success) {
  console.log('✓ Asset generated:', result.asset.id);
  result.steps.forEach(step => {
    console.log(`  ✓ ${step.name}`);
  });
} else {
  console.error('✗ Pipeline failed:', result.error);
}
```

## Performance Expectations

### Test Execution Time
- **Unit Tests**: ~500ms (80 test cases)
- **Integration Tests**: ~800ms (24 test cases)
- **Full Suite**: ~1.3s (104 test cases)

### Particle System Performance
- **CPU Pool**: 4096 particles @ 60 FPS
- **1000+ particles/frame**: <100ms update time
- **GPU Pool**: WebGPU compute dispatch for 10K+ particles

### Texture Generation
- **Procedural (256-1024px)**: ~10-50ms per texture
- **AI Generation (ComfyUI)**: ~100-500ms per texture
- **Cache Hit**: <1ms (LRU retrieval)

## Debugging

### Enable Verbose Logging
```bash
./scripts/test-3d-geometry.ps1 -TestType all -Verbose
```

### Run Single Test File
```bash
npx vitest run tests/unit/particle-systems.test.js
```

### Run Specific Test Case
```bash
npx vitest run -t "should spawn particles in BURST mode"
```

### Debug with Node Inspector
```bash
node --inspect-brk node_modules/vitest/vitest.mjs run tests/unit/particle-systems.test.js
```

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run 3D Geometry Tests
  run: npm run test:js -- tests/unit/3d-geometry-trellis2.test.js

- name: Run Particle System Tests
  run: npm run test:js -- tests/unit/particle-systems.test.js

- name: Run Full Pipeline Tests
  run: npm run test:js -- tests/integration/3d-asset-pipeline.test.js

- name: Generate Coverage
  run: npm run test:js -- --coverage
```

## Future Enhancements

- [ ] GPU particle system tests (WebGPU)
- [ ] Shader compilation validation suite
- [ ] Cross-renderer (Three.js ↔ WebGPU) parity tests
- [ ] Memory profiling under sustained load
- [ ] Battle simulation performance benchmarks
- [ ] TRELLIS2 quality metrics validation (LOD levels)
- [ ] Texture memory budget enforcement
- [ ] VFX interaction tests (particles + post-effects)
- [ ] Mobile performance tier validation
- [ ] Asset streaming + culling tests

## References

- **js/engine/runtime/domains/fleet/models/**: Ship registry, quality budgets
- **js/rendering/ParticleSystem.js**: CPU particle implementation
- **js/rendering/ProceduralTextures.js**: FBM texture generation
- **api/textures-ai.php**: ComfyUI texture integration
- **scripts/trellis2_*.ps1**: TRELLIS2 CLI tools

## Support

For issues or questions:
1. Check test output for specific failures
2. Review corresponding test file for logic
3. Validate actual implementation against test expectations
4. Run with `-Verbose` for detailed debugging
