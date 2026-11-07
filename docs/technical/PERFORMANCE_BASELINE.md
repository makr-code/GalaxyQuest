## Performance Baseline & Budgets

Dokumentation der Baseline-Metriken und Performance-Budgets für GalaxyQuest (2026-03-29).

> **Historische Messung, keine aktuelle Abnahme:** Die Desktopwerte unten stammen aus einem Bericht vom 29. März 2026 und sind nicht als Messung des aktuellen Checkouts oder als CI-Regression-Gate verifiziert. `GQPerformanceBudget` ist ein Laufzeitmonitor; sein Status allein belegt weder diese Messwerte noch eine Release-Freigabe.

### Baseline Measurement Environment

**Hardware Specification:**
- CPU: Intel i7-12700K (12 cores, 3.6-5.0 GHz)
- GPU: NVIDIA RTX 3080 (10 GB VRAM)
- RAM: 32 GB (available)
- Display: 1920×1080 @ 60 Hz
- Network: 100 Mbps (stable, < 2ms latency)

**Browser Configuration:**
- Chrome / Chromium 120+
- Hardware Acceleration: Enabled
- V-Sync: Enabled (capped to 60 FPS)

**Measurement Method:**
- Duration: 60 second steady-state session
- Three.js `renderer.info` for draw calls & triangles
- `performance.now()` for frame timing
- Window size: 60-frame rolling average

---

### Phase 4: Flight & Telemetry Baseline

**Galaxy 3D Renderer (Full Quality LOD)**

| Metric | Target | Baseline | Threshold |
|---|---|---|---|
| **FPS** | 59-60 | 59.8 | ≥ 50 (regression) |
| **Frame Time (avg)** | 16.5-17.5 ms | 16.7 ms | ≤ 25 ms |
| **Frame Time (max spike)** | < 20 ms | 19.2 ms | ≤ 30 ms |
| **Draw Calls (LOD0)** | 2000-3200 | 2840 | ≤ 5000 |
| **Triangles** | 4-8 M | 5.2 M | ≤ 12 M |
| **Geometry Cache** | 120-180 MB | 156 MB | ≤ 256 MB |
| **Texture Cache** | 80-140 MB | 118 MB | ≤ 200 MB |
| **Total Memory** | 200-320 MB | 274 MB | ≤ 350 MB |

**Use Case: Homeworld Cinematic Flight**
- Start: Earth system, camera ~5000 LY away
- Target: Alpha Centauri, ~4.37 LY away
- Duration: 8 seconds
- Trajectory: physics-based approach with gravity
- Result: 480 frames @ avg 16.7 ms = 99.96% frame rate compliance

**Use Case: Search System Pan**
- Full galaxy rotation (360°) around Z-axis
- 15 stars in viewport
- 2000-3200 visible system meshes (LOD cascade)
- Result: steady 59-60 FPS, no frame drops

---

### Phase 4: Auth Background Starfield

**Starfield Renderer (Low-Intensity Animation)**

| Metric | Target | Baseline | Threshold |
|---|---|---|---|
| **FPS** | 55-60 | 57.2 | ≥ 50 |
| **Frame Time (avg)** | 17.5-18 ms | 17.8 ms | ≤ 25 ms |
| **Draw Calls** | 800-1200 | 1040 | ≤ 2000 |
| **Memory** | 30-50 MB | 41 MB | ≤ 100 MB |

**Use Case: Continuous Background Animation**
- 2600 stars rendered with parallax
- No mouse interaction
- Runs for entire auth session (avg 5-10 min)
- Result: stable memory, no leaks detected

---

### Laufzeit-Monitoring und Grenzwerte

`GQPerformanceBudget.THRESHOLDS` definiert Laufzeit-Grenzwerte. Der WebGPU-Renderer aktualisiert den Monitor pro Frame und stellt Messwerte/Status über seine Renderstatistik bereit. Das ist kein automatischer CI-Gate und löst für sich allein keinen Alert aus.

```javascript
{
  fpsMinimum: 50,              // DROP BELOW = REGRESSION
  frameTimeMaxMs: 25,
  cpuSubmissionMaxMs: 12,
  gpuTimeMaxMs: 20,
  drawCallsMax: 5000,
  triangleCountMax: 12_000_000,
  totalCacheMB: 350,
  ownedBufferMaxBytes: 128 * 1048576,
}
```

The monitor evaluates only available samples; missing values are not counted as violations. In the current WebGPU renderer, owned-buffer bytes cover a subset of allocations and `memoryBytes` is passed as `null`, so the monitor does not measure total VRAM/cache usage there. Violations are retained in the monitor's in-memory regression list; this does not establish server-side session logging or alert delivery.

---

### Memory Profiling Notes

**Geometry Cache** (GQGeometryManager):
- Typical system mesh: 2-8 MB (depends on LOD)
- Galaxy with ~100 visible systems: 120-160 MB
- LOD mechanism reduces cache during pan (working as designed)

**Texture Cache** (GQTextureManager):
- Star textures: ~1-2 MB per unique type
- System glow textures: ~4-6 MB
- Background starfield: ~8 MB
- Typical active set: 80-140 MB

**Three.js Internal:**
- Shader cache: ~10-15 MB
- Renderer state: ~5 MB
- Total Three.js overhead: ~20-25 MB

**Expected Range:** 200-350 MB under normal operation

---

### Performance Budget Monitoring

**Integration Points:**

1. **GalaxyRendererCore initialization:**
   ```javascript
   const budgetMonitor = window.GQPerformanceBudget.createMonitor(
     this.renderer,
     { sampleIntervalMs: 16, windowSize: 60 }
   );
   ```

2. **Main render loop (each frame):**
   ```javascript
   budgetMonitor.update(); // Collects metrics every ~16ms
   ```

3. **Status access:** A caller can read `getMetrics()` and `getStatus()` from the monitor. No backend logging or alert callback is implied by these methods.

---

### Historical Baselines

| Date | FPS | Frame Time | Draw Calls | Memory | Status |
|---|---|---|---|---|---|
| 2026-03-29 | 59.8 | 16.7 ms | 2840 | 274 MB | Historical report; not re-measured |

---

### Known Limitations & Caveats

1. **Mobile/Tablet:** Baseline measured on desktop only. Mobile devices may achieve 30-45 FPS due to GPU/CPU differences.

2. **Streaming impact:** First-time load of large galaxy maps may spike draw calls & memory temporarily (< 5 sec). This is expected and not a regression.

3. **Double-buffering:** Frame time measured per-frame includes both CPU & GPU time. GPU stalls can cause variance.

4. **LOD thresholds:** Draw calls scale linearly with viewport complexity. Thresholds assume 1920×1080 viewport.

5. **Browser variance:** Chrome, Firefox, Safari may show ±5-10% variance on same hardware due to JavaScript engine differences.

---

### Future Tuning Opportunities

1. **GPU texture compression:** Could reduce texture cache from 118 MB → ~40 MB (using BC7/ASTC).

2. **Geometry instancing:** Star mesh rendering could use instanced draws (reduce draw calls ~40%).

3. **Compute shader LOD:** Offload LOD cascade to GPU (reduce CPU overhead).

4. **Streaming prefetch:** Predictive chunk loading during cinematic flights.

5. **Memory pooling:** Pre-allocate geometry/texture buffers to reduce allocation overhead.

---

### Related Files

- [ROADMAP.md](ROADMAP.md) — Phase 5 QA gates
- [../../js/telemetry/performance-budget.js](../../js/telemetry/performance-budget.js) — Runtime monitor implementation
- [../../js/rendering/Galaxy3DRendererWebGPU.js](../../js/rendering/Galaxy3DRendererWebGPU.js) — WebGPU monitor integration
- [../../js/telemetry/space-camera-flight-driver.js](../../js/telemetry/space-camera-flight-driver.js) — Flight telemetry source
