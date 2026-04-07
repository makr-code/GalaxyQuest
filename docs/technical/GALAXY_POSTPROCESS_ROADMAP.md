# Galaxy Post-Processing Effects Roadmap

## Vision
Progressively enhance the visual fidelity of the galaxy renderer with post-processing effects that echo astrophotography and cinematography techniques.

---

## Phase 1: Core Post-Processing Infrastructure 🔧
**Objective:** Set up EffectComposer + RenderPass foundation
**Status:** ✅ COMPLETED (2026-03-28)

- [x] Add EffectComposer library (local implementation)
- [x] Replace direct renderer.render() with EffectComposer pipeline
- [x] Implement RenderPass (main scene render)
- [x] Implement CopyShader pass (fallback/display)
- [x] Implement ShaderPass (generic shader application)
- [x] Implement UnrealBloomPass (multi-pass bloom effect)
- [x] Boot-test to confirm composer renders correctly

**Files Created:** 
  - `js/three-EffectComposer.js` (v55) — EffectComposer + pass pipeline
  - `js/three-RenderPass.js` (v55) — Render scene to texture
  - `js/three-ShaderPass.js` (v55) — Apply arbitrary shaders
  - `js/three-CopyShader.js` (v55) — Texture copy + display
  - `js/three-UnrealBloomPass.js` (v55) — Multi-pass bloom system
  - `js/post-effects.js` (v55) — PostEffectsManager unified API

**Files Modified:** 
  - `index.html` — Updated boot scripts to load local PostProcessing files
  - `js/starfield.js` (v56) — Integrated PostEffectsManager + resize handling
  - `js/galaxy3d.js` (v50) — Integrated PostEffectsManager + resize handling

---

## Phase 2: Top 3 Priority Effects ⭐⭐⭐
**Status:** ✅ IMPLEMENTATION COMPLETE (2026-03-28), 🟡 AWAITING VISUAL VALIDATION

### 2a. Bloom / Glow (UnrealBloomPass)
**Difficulty:** Medium | **Visual Impact:** 10/10 | **Performance Cost:** Medium
**Status:** ✅ Implemented & Active

- [x] Implement UnrealBloomPass with high-pass + 2x Gaussian blur + composite
- [x] Configure: threshold 0.8, strength 1.2, radius 0.6
- [x] Applied to both starfield.js + galaxy3d.js
- [x] Integrated into EffectComposer pipeline
- [x] Runtime parameter control API (setBloomStrength, setBloomThreshold, etc.)
- [ ] Visual validation on real hardware
- [ ] Performance profiling (target 60 FPS)
- [ ] Optional: parameter tuning UI panel

**Pass Pipeline:** ReadBuffer → HighPassFilter → HBlur → VBlur → Composite → WriteBuffer

---

### 2b. Vignette (Custom Shader)
**Difficulty:** Easy | **Visual Impact:** 7/10 | **Performance Cost:** Negligible
**Status:** ✅ Implemented & Active

- [x] Create custom vignette ShaderPass (smoothstep curve)
- [x] Configure: darkness 0.5, falloff 2.0
- [x] Applied to starfield.js + galaxy3d.js
- [x] Integrated into EffectComposer pipeline
- [x] Runtime uniform control (setVignetteDarkness, enableVignette, etc.)
- [ ] Verify subtle appearance (should complement galaxy, not overwhelm)
- [ ] Optional: auth vs gameplay context-specific settings

**Shader Logic:** Radial distance-based darkening from screen edges

---

### 2c. Chromatic Aberration (Channel Shift)
**Difficulty:** Easy | **Visual Impact:** 6/10 | **Performance Cost:** Negligible
**Status:** ✅ Implemented & Active

- [x] Create custom RGB-channel offset ShaderPass
- [x] Configure: power 0.3, radial from screen center
- [x] Applied to starfield.js + galaxy3d.js
- [x] Integrated into EffectComposer pipeline
- [x] Resolution-aware uniform bindings
- [x] Runtime control API (setChromaticPower, enableChromatic)
- [ ] Verify color fringing on bright stars/core
- [ ] Tune power value (current: 0.3 — may be too subtle or too strong)

---

## Phase 3: Depth & Atmosphere Effects ✨

### 3a. Depth of Field (tiltshift / focus)
**Difficulty:** Hard | **Visual Impact:** 8/10 | **Performance Cost:** High

- [ ] Implement multi-pass DOF (2-3 render-to-texture passes)
- [ ] Configure focus plane + blur range
- [ ] Test with galaxy at various distances
- [ ] Make optional (performance gate)

**Expected:** Pseudo-3D Tiefenwirkung. Vordergrund scharf, Hintergrund verschwimmt.

---

### 3b. Volumetric Dust/Nebula Layers
**Difficulty:** Medium | **Visual Impact:** 7/10 | **Performance Cost:** Low-Medium
**Status:** ✅ IMPLEMENTED (2026-04)

- [x] Generate procedural nebula textures (FBM/value noise — dustlayer.wgsl)
- [x] 3 semi-transparent animated layers (foreground / mid / background)
- [x] Slow scroll at different speeds for parallax effect
- [x] Per-layer colour tint + opacity control
- [x] `DustLayerPass.js` with `buildParamBlock()`, `update(dt)`, and `masterOpacity`
- [x] 26 unit tests in `tests/js/dustlayerpass.test.js`

**Files Created:** `js/engine/post-effects/passes/DustLayerPass.js`, `js/engine/post-effects/shaders/dustlayer.wgsl`

---

### 3c. Motion Blur
**Difficulty:** Medium | **Visual Impact:** 6/10 | **Performance Cost:** Medium
**Status:** ✅ IMPLEMENTED (2026-04)

- [x] Velocity-based accumulation: samples along NDC camera displacement vector
- [x] Velocity-threshold gate (blur skipped when camera is near-static)
- [x] `setVelocity(ndcDeltaX, ndcDeltaY)` API for per-frame velocity supply
- [x] `maxSamples` (2–8) scales with velocity magnitude
- [x] `MotionBlurPass.js` with `buildParamBlock()` (8 floats)
- [x] 22 unit tests in `tests/js/motionblurpass.test.js`

**Files Created:** `js/engine/post-effects/passes/MotionBlurPass.js`, `js/engine/post-effects/shaders/motionblur.wgsl`

---

## Phase 4: Advanced Cinematography 🎬

### 4a. Tone Mapping (Reinhard / ACES)
**Difficulty:** Easy | **Visual Impact:** 5/10 | **Performance Cost:** Negligible
**Status:** ✅ IMPLEMENTED (2026-04)

- [x] `ToneMappingPass.js` with Reinhard + ACES operators
- [x] `ToneMappingMode` enum (REINHARD=0, ACES=1)
- [x] `exposure` pre-multiplier for per-scene brightness
- [x] sRGB gamma correction (x^(1/2.2)) after mapping
- [x] `buildParamBlock()` (4 floats, std140-aligned)
- [x] 18 unit tests in `tests/js/tonemappingpass.test.js`

**Files Created:** `js/engine/post-effects/passes/ToneMappingPass.js`, `js/engine/post-effects/shaders/tonemapping.wgsl`

---

### 4b. Lens Flare (on-hover starfield feature)
**Difficulty:** Medium | **Visual Impact:** 7/10 | **Performance Cost:** Low (sprite-based)
**Status:** ✅ IMPLEMENTED (2026-04)

- [x] Multi-element procedural flare: starburst, glow disc, 1–4 ghost discs, streak halo
- [x] Ghost discs reflected along lens axis (screen-centre direction) — authentic optics
- [x] Up to 8 simultaneous sources (`MAX_FLARE_SOURCES=8`)
- [x] `addSource(ndcX, ndcY, intensity, colorHex)` returns unique ID
- [x] `updateSourcePosition(id, x, y)` for live camera-pan tracking
- [x] `removeSource(id)` / `clearSources()` for lifecycle management
- [x] `LensFlarePass.js` with `buildParamBlock()` (68 floats)
- [x] 31 unit tests in `tests/js/lensflarepass.test.js`

**Files Created:** `js/engine/post-effects/passes/LensFlarePass.js`, `js/engine/post-effects/shaders/lensflare.wgsl`

---

### 4c. Atmospheric Glow Halo
**Difficulty:** Medium | **Visual Impact:** 6/10 | **Performance Cost:** Low

- [ ] Add glow corona around core
- [ ] Animate corona size sinusoidally
- [ ] Color: vary with time (orange → yellow → white cycles)
- [ ] Layer under disk + stars

**Expected:** Pulsierender Halo um Black-Hole-Core. Lebendige, atemende Atmosphäre.

---

## Phase 5: Optional Enhancements 🌟
**Status:** ✅ IMPLEMENTED (2026-04)

- [x] **Star Scintillation:** Twinkle effect — `StarScintillationPass.js` + `starscintillation.wgsl`; luminance-threshold hash noise modulates bright pixels; 20 unit tests
- [x] **Disk Rotation Parallax:** Closer layers rotate faster — `DiskRotationParallaxPass.js` + `diskrotationparallax.wgsl`; Keplerian innerVelocity/outerVelocity UV warp; 22 unit tests
- [x] **Jet Lighting:** Directional light affecting jets dynamically — `JetLightingPass.js` + `jetlighting.wgsl`; up to 4 AGN/black-hole jet sources with narrow-core + wide-penumbra model; 35 unit tests
- [x] **Color Grading:** Analytical Brightness/Contrast/Saturation/HueShift — `ColorGradingPass.js` + `colorgrading.wgsl`; LGG model (DaVinci Resolve style); 17 unit tests
- [x] **Film Grain:** Temporal hash noise overlay — `FilmGrainPass.js` + `filmgrain.wgsl`; luminance-weighted grain, intensity/speed/size controls; 20 unit tests

---

## Implementation Order (Recommended)

```
Week 1:
  1. Set up EffectComposer infrastructure (Phase 1)
  2. Implement Bloom (Phase 2a)
  
Week 2:
  3. Implement Vignette (Phase 2b)
  4. Implement Chromatic Aberration (Phase 2c)
  
Week 3:
  5. Volumetric Dust Layers (Phase 3b) — easier than DOF
  
Week 4+:
  6. DOF, Motion Blur, Tone Mapping (Phase 3/4)
  7. Polish + UI controls
```

---

## Performance Targets

| Effect | FPS Impact | GPU Memory | Notes |
|---|---|---|---|
| Bloom | -5 to -10 | +64MB | Only on high-end GPUs |
| Vignette | -0 | +1MB | Negligible |
| Chrom. Aberration | -0 | +1MB | Negligible |
| Dust Layers | -2 to -3 | +32MB | Can be toggled |
| DOF | -15 to -25 | +128MB | Gate with quality setting |
| Motion Blur | -8 to -12 | +64MB | Gate with velocity threshold |

**Target:** Maintain 60 FPS on mid-range GPUs (2GB VRAM)

---

## Config Strategy

Each effect will have adjustable parameters in a config object:

```javascript
const postProcessConfig = {
  bloom: {
    enabled: true,
    threshold: 0.8,
    strength: 1.2,
    radius: 0.6,
  },
  vignette: {
    enabled: true,
    darkness: 0.5,
    falloff: 2.0,
  },
  chromaticAberration: {
    enabled: true,
    power: 0.3,
    direction: [0.5, 0.5],
  },
  // ... more effects
};
```

UI will allow toggling + fine-tuning (dev mode).

---

## Success Criteria

- ✅ All Phase 2 effects implemented + visually working
- ✅ FPS maintained >58 on target GPU
- ✅ Visual consistency between starfield + gameplay galaxy
- ✅ User perceives galaxy as "premium AAA-quality"
- ✅ No major artifacts or visual bugs

---

**Last Updated:** 2026-03-28  
**Status:** 🟡 Phase 1 Complete ✅ | Phase 2 (Top 3) Ready for Fine-Tuning ✨

---

## Implementation Notes

### PostEffectsManager API
The new `PostEffectsManager` class provides a clean API for both starfield and galaxy3d:

```javascript
// Init (automatic in constructors)
const postEffects = new PostEffectsManager(renderer, scene, camera);

// Render (replaces direct renderer.render())
postEffects.render();

// Resize (on window resize)
postEffects.resize(width, height);

// Adjust parameters on-the-fly
postEffects.setBloomStrength(1.5);
postEffects.setVignetteDarkness(0.6);
postEffects.setChromaticPower(0.25);

// Toggle effects
postEffects.enableBloom(true/false);
postEffects.enableVignette(true/false);
postEffects.enableChromatic(true/false);
```

### Next Steps (Top 3 Fine-Tuning)

1. **Test all three effects** on both starfield + galaxy3d
2. **Adjust base parameters** if visual appearance differs from expectations
3. **Profile performance** — ensure 60 FPS maintained
4. **Add UI controls** (optional) for in-game tweaking
5. **Commit & deploy** Phase 2 completion
