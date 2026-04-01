# [FEATURE] Post-Processing Phasen 3–5: Depth of Field, Volumetric Dust, Motion Blur, Tone Mapping & Enhancements

**Labels:** `feature`, `engine`, `webgpu`, `rendering`, `post-processing`  
**Milestone:** Post-Processing v2.0  
**Referenz:** `docs/technical/GALAXY_POSTPROCESS_ROADMAP.md` – Phase 3–5  
**Abhängigkeit:** Phase 1+2 (Bloom, Vignette, Chromatic Aberration) bereits vollständig implementiert ✅

---

## Zusammenfassung

Implementierung der verbleibenden Post-Processing-Effekte für den Galaxy-Renderer: Depth of Field (Phase 3a), Volumetric Dust/Nebula-Layer (3b), Motion Blur (3c), Tone Mapping (4a), Lens Flares (4b), Atmospheric Glow Halo (4c) und Star Scintillation (5). Jeder Effekt als eigenständiger `Pass` im bestehenden `EffectComposer`.

---

## Architektur-Kontext

Bestehende Infrastruktur (vollständig implementiert, **nicht anfassen**):
- `js/engine/post-effects/EffectComposer.js` – Ping-Pong RT, `addPass()`, `removePass()`
- `js/engine/post-effects/passes/BloomPass.js` – `buildParamBlock(): Float32Array`
- `js/engine/post-effects/passes/VignettePass.js`
- `js/engine/post-effects/passes/ChromaticPass.js`
- `js/engine/post-effects/passes/SSAOPass.js`

Jeder neue Pass folgt demselben Muster: `buildParamBlock()` → `Float32Array` für GPU-Uniforms, `render(encoder, input, output)`, `setEnabled(bool)`.

---

## Akzeptanzkriterien – Phase 3a: Depth of Field

**Schwierigkeit:** Hoch | **Visual Impact:** 8/10 | **Performance:** Hoch  
**Performance-Gate:** DOF nur auf High/Ultra Qualitätsprofil aktiv (Graceful Degradation)

- [ ] `js/engine/post-effects/passes/DepthOfFieldPass.js` (neuer Pass):
  - **Render-Strategie:** 3-Pass-Implementierung:
    1. CoC-Pass (Circle of Confusion): Berechnet Unschärfestärke pro Pixel aus Tiefe
    2. Blur-Pass Near: Gaussian Blur auf Pixel mit CoC > 0 (nahe Objekte)
    3. Blur-Pass Far: Gaussian Blur auf Pixel mit CoC < 0 (ferne Objekte)
  - `buildParamBlock()`:
    ```js
    // Float32Array[4]: [focusDistance, focusRange, nearBlurAmount, farBlurAmount]
    buildParamBlock(): Float32Array
    ```
  - Default-Konfiguration für Galaxie-Ansicht:
    - `focusDistance = 500.0` (Galaxie-Kerne im Fokus)
    - `focusRange = 300.0`
    - `nearBlurAmount = 2.0`
    - `farBlurAmount = 4.0`
  - API: `setFocusDistance(d)`, `setFocusRange(r)`, `setBlurAmount(near, far)`, `setEnabled(bool)`
- [ ] Depth-Buffer-Zugriff: Pass erhält zusätzlichen `depthTexture`-Input
- [ ] Tests in `tests/js/post-effects.test.js` (erweitern):
  - `testDOFPassBuildParamBlock()` – korrekte Float32Array-Länge
  - `testDOFPassDisabled()` – kein Effekt wenn disabled

---

## Akzeptanzkriterien – Phase 3b: Volumetric Dust/Nebula-Layer

**Schwierigkeit:** Mittel | **Visual Impact:** 7/10 | **Performance:** Niedrig-Mittel

- [ ] `js/engine/post-effects/passes/VolumetricDustPass.js` (neuer Pass):
  - **Render-Strategie:** 2–3 halbtransparente Quad-Schichten (Layer) mit Perlin-Noise-Textur
  - Jeder Layer: separate Farbe, Opazität, Skalierung und Animations-Geschwindigkeit
  - Default 3 Layer (konfigurierbar):
    ```js
    defaultLayers: [
      { color: [0.3, 0.4, 0.8], opacity: 0.12, scale: 2.0, speed: 0.001 },  // Blau-Nebel
      { color: [0.8, 0.3, 0.4], opacity: 0.08, scale: 4.0, speed: 0.0005 }, // Rot-Nebel
      { color: [0.9, 0.8, 0.4], opacity: 0.06, scale: 8.0, speed: 0.0008 }, // Gelb-Staub
    ]
    ```
  - `buildParamBlock()`: `Float32Array[4 * maxLayers + 4]` (Layer-Daten + globale Uniforms)
  - Prozeduraler Perlin-Noise (WGSL-Implementierung, kein Texture-Asset nötig):
    - `permute()` + `fade()` + `lerp()` als WGSL-Hilfsfunktionen (2D-Perlin)
  - `time`-Uniform → langsame Animation (Parallax-Verschiebung je Layer)
  - API: `setLayerCount(n)`, `setLayerColor(i, r, g, b)`, `setLayerOpacity(i, alpha)`, `setEnabled(bool)`
- [ ] WGSL-Datei: `js/engine/post-effects/shaders/volumetric_dust.wgsl`
- [ ] Tests:
  - `testVolumetricDustPassLayers()` – 3 Default-Layer korrekt konfiguriert
  - `testPerlinNoiseDeterministic()` – gleicher Input → gleicher Output

---

## Akzeptanzkriterien – Phase 3c: Motion Blur

**Schwierigkeit:** Mittel | **Visual Impact:** 6/10 | **Performance:** Mittel  
**Performance-Gate:** Nur aktiv wenn Kamera-Geschwindigkeit > Threshold (kein konstanter Effekt)

- [ ] `js/engine/post-effects/passes/MotionBlurPass.js` (neuer Pass):
  - **Render-Strategie:** Accumulation Buffer (2–4 vorherige Frames)
    - Ping-Pong zwischen aktuellem Frame + History-Buffer
    - Blend: `current * 0.7 + history * 0.3` (konfigurierbar)
  - `buildParamBlock()`: `Float32Array[4]` – `[blendFactor, velocityThreshold, sampleCount, enabled]`
  - Velocity-Gate: Kamera-Bewegungsgeschwindigkeit aus `GalaxyCameraController` auslesen
    - Unter `velocityThreshold` → Effekt deaktiviert (kein unnötiger GPU-Aufwand)
    - Über Threshold → Effekt aktiv mit linearer Intensitäts-Skalierung
  - API: `setBlendFactor(f)`, `setVelocityThreshold(t)`, `setSampleCount(n)`, `setEnabled(bool)`
  - Kamera-Velocity-Interface: `MotionBlurPass.updateCameraVelocity(vel: number)` – aufgerufen aus Galaxy-Renderer-Loop
- [ ] WGSL-Datei: `js/engine/post-effects/shaders/motion_blur.wgsl`
- [ ] Tests:
  - `testMotionBlurPassLowVelocityInactive()` – Velocity < Threshold → blend=0
  - `testMotionBlurPassHighVelocityActive()` – Velocity > Threshold → blend > 0

---

## Akzeptanzkriterien – Phase 4a: Tone Mapping

**Schwierigkeit:** Einfach | **Visual Impact:** 5/10 | **Performance:** Vernachlässigbar

- [ ] `js/engine/post-effects/passes/ToneMappingPass.js` (neuer Pass):
  - Unterstützt 2 Kurven (konfigurierbar):
    - `REINHARD`: `color / (color + 1.0)` (weich, natürlich)
    - `ACES`: ACES-Filmic-Kurve (kinematisch, höherer Kontrast)
  - `buildParamBlock()`: `Float32Array[4]` – `[exposure, mode (0=Reinhard/1=ACES), gamma, enabled]`
  - Default: `ACES`, Exposure: 1.0, Gamma: 2.2
  - API: `setMode('REINHARD'|'ACES')`, `setExposure(e)`, `setGamma(g)`, `setEnabled(bool)`
- [ ] WGSL: Inline in Pass-Datei (keine separate .wgsl nötig, kurzer Shader)
- [ ] Als **letzter Pass** vor Display-Output in `EffectComposer` hinzufügen
- [ ] Tests:
  - `testReinhardCurveClamps()` – sehr helle Pixel werden nicht blown-out
  - `testACESHighContrast()` – ACES-Output höherer Kontrast als Reinhard

---

## Akzeptanzkriterien – Phase 4b: Lens Flares

**Schwierigkeit:** Mittel | **Visual Impact:** 7/10 | **Performance:** Niedrig (Sprite-basiert)

- [ ] `js/engine/post-effects/passes/LensFlarePass.js` (neuer Pass):
  - Sprite-basiert (kein echtes Ray-Tracing): 3 Flare-Elemente pro Lichtquelle:
    1. Starburst-Sprite (helles Kreuz-Muster um Stern)
    2. Lens-Ghost (kleinerer, versetzter Kreis in Richtung Bildmitte)
    3. Streak-Rays (4 radiale Streifen)
  - Programmatisch generierte Sprites (keine Textur-Assets nötig):
    - Starburst: Radiales Gradient-Muster in WGSL
    - Ghost: Gaussscher Kreis mit Farbversatz
  - `setFlarePositions(positions: [{screenX, screenY, intensity, color}])` – aufgerufen aus Galaxy-Renderer wenn Stern selected/hovered
  - `buildParamBlock()`: `Float32Array[8 * maxFlares]`
  - Okklusions-Test: Flare wird ausgeblendet wenn Stern durch UI-Element verdeckt
  - API: `addFlare(pos)`, `removeFlare(id)`, `setEnabled(bool)`
- [ ] WGSL-Datei: `js/engine/post-effects/shaders/lens_flare.wgsl`
- [ ] Integration in `js/galaxy-renderer-core.js`:
  - Bei Stern-Hover/-Select: `lensFlarePass.addFlare(screenPos, intensity)`
  - Bei Deselect: `lensFlarePass.removeFlare(id)`

---

## Akzeptanzkriterien – Phase 4c: Atmospheric Glow Halo

**Schwierigkeit:** Mittel | **Visual Impact:** 6/10 | **Performance:** Niedrig

- [ ] `js/engine/post-effects/passes/CoronaPass.js` (neuer Pass):
  - Pulsierender Halo um galaktischen Core:
    - Glow-Radius: sinusoidale Animation (2–4 Einheiten Amplitude, 0.1 Hz)
    - Farbzyklus: Orange → Gelb → Weiß → Orange (Periode: 20 Sekunden)
    - Mehrere konzentrische Glow-Ringe (3–5 Ringe, jeder leicht versetzt/skaliert)
  - `buildParamBlock()`: `Float32Array[8]` – `[centerX, centerY, baseRadius, pulseAmp, cycleSpeed, colorPhase, intensity, enabled]`
  - Core-Position aus Galaxy-Renderer übernehmen (`setCoreScreenPos(x, y)`)
  - API: `setPulseAmplitude(a)`, `setColorCycleSpeed(s)`, `setIntensity(i)`, `setEnabled(bool)`
- [ ] WGSL-Datei: `js/engine/post-effects/shaders/corona.wgsl`
- [ ] Tests:
  - `testCoronaColorCycle()` – nach halber Periode andere Farbe als Start

---

## Akzeptanzkriterien – Phase 5: Star Scintillation

**Schwierigkeit:** Einfach | **Visual Impact:** 3/10 | **Performance:** Vernachlässigbar

- [ ] `js/engine/post-effects/passes/ScintillationPass.js` (neuer Pass):
  - Leichtes Alpha-Flackern heller Sterne (variation pro Frame basierend auf Position + Zeit)
  - Nur auf Pixel mit Luminanz > 0.85 (keine dunklen Bereiche beeinflussen)
  - Variationsamplitiude: ±5 % Alpha (sehr subtil)
  - `buildParamBlock()`: `Float32Array[4]` – `[threshold, amplitude, frequency, enabled]`
- [ ] WGSL: Inline in Pass (kurzer Shader)

---

## UI-Konfiguration (alle Phasen)

- [ ] Developer-Settings-Panel in `js/game.js` um Post-Processing-Sektion erweitern (bereits Bloom/Vignette/Chromatic vorhanden):
  - Toggle für jeden neuen Effekt
  - Slider für Hauptparameter (DOF Focus, Dust Opacity, Motion Blur Blend, Tone Mapping Mode)
  - Nur sichtbar in Dev-Modus
- [ ] `postProcessConfig`-Objekt in `js/galaxy-renderer-core.js` um neue Effekte erweitern

---

## Performance-Ziele

| Effekt | Max FPS-Impact | GPU Memory | Qualitäts-Gate |
|--------|----------------|-----------|----------------|
| Depth of Field | −15 bis −25 | +128 MB | Nur High/Ultra |
| Volumetric Dust | −2 bis −3 | +32 MB | Alle (toggle) |
| Motion Blur | −8 bis −12 | +64 MB | Mid+ |
| Tone Mapping | −0 | +1 MB | Immer aktiv |
| Lens Flares | −1 | +4 MB | Alle (toggle) |
| Corona | −1 | +4 MB | Alle (toggle) |
| Scintillation | −0 | +1 MB | Alle (toggle) |

**Ziel:** ≥ 58 FPS auf Mid-Range GPU (2 GB VRAM) mit allen nicht-High-Effekten aktiv.

---

## Tests

- [ ] `tests/js/post-effects.test.js` (Erweiterung – bestehende 78 Tests behalten):
  - Je neuer Pass mind. 3 Tests: `buildParamBlock()`, `setEnabled()`, Parametervalidierung
  - `testEffectComposerNewPasses()` – alle neuen Passes korrekt in Composer-Pipeline integriert
  - Gesamt nach diesem Issue: ≥ 100 Tests

---

## Estimate

| Phase | Aufwand |
|-------|---------|
| 3a – Depth of Field | 2–3 Tage |
| 3b – Volumetric Dust | 1–2 Tage |
| 3c – Motion Blur | 1–2 Tage |
| 4a – Tone Mapping | 0.5 Tage |
| 4b – Lens Flares | 1–2 Tage |
| 4c – Corona | 1 Tag |
| 5 – Scintillation | 0.5 Tage |
| Tests + UI | 1 Tag |
| **Gesamt** | **~9–14 Tage** |
