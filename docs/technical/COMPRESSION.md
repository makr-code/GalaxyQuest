# Progressive System Loading + Data Compression

> **Historical design note:** Timing and bandwidth figures below are unverified estimates, not current measurements. The old renderer path has moved; the current client defaults to JSON, and optional binary formats do not establish an active binary-decoder path.

## Progressive Rendering

The older `js/legacy/galaxy3d.js` and `js/rendering/galaxy-renderer-core.js` contain phased system-refinement code. The timings below are illustrative and have not been re-measured on the current renderer.

**Historical problem statement:** System entry was described as janky because all 3D assets and textures loaded at once.

**Solution:** 4-phase lazy loading per planet:

```
T=0ms      Phase 0: Orbits + Star + Planet Spheres (flat color)
           → systemPlanetEntries built, animation starts
           → Fleets rendered immediately
           
T=50-100ms Phase 1: Planet 0 texture canvas-gen + material swap
T=100-150ms Phase 1: Planet 1 texture gen...
T=150-200ms Phase 1: Planet 2 texture gen...

T=...+10ms Phase 2: Atmosphere shells per planet
T=...+10ms Phase 3: Cloud shells per planet
```

**Implementation:**
- `_buildSystemPhase0()` – Quick baseline (geometry, no textures)
- `_queueSystemRefinement()` – Build task queue (50ms staggered per planet)
- `_processSystemRefinementQueue()` – Async texture gen in tasks
- Cleanup: `exitSystemView()` cancels pending tasks

**Historical estimate:** Initial system rendering was described as immediate, with refinement in ~200–500 ms; this is not a current measured result.

---

## Data Compression

**Historical problem statement:** System API responses were estimated at 50–200 KB JSON.

**Available mechanisms:** gzip, optional field trimming, and optional binary encoders.

### Tier 1: Gzip
- `gzip` header + `ob_gzhandler`
- `api/galaxy.php` calls `enable_response_gzip()`; gzip is emitted when supported by the request/server response path.
- Reduction percentages and typical payload sizes in this document are historical estimates, not current measurements.

### Tier 2: Payload Trimming (Optional)
- System payload trimming is opt-in with `?trim=1`; no trimming is applied automatically by the endpoint.

### Tier 3: Optional Binary Encodings
- Server encoders for V1, V2, and V3 are implemented and can be requested explicitly for system payloads.
- JSON remains the endpoint default. The binary decoder script tags in `index.html` are commented out; do not assume normal browser clients consume these formats.

---

## Usage

### From JS
```javascript
// System responses use JSON by default.
const payload = await fetch('api/galaxy.php?galaxy=1&system=1').then(r => r.json());

// Explicitly request a trimmed system payload:
const trimmedPayload = await fetch('api/galaxy.php?galaxy=1&system=1&trim=1').then(r => r.json());
```

### From PHP
```php
enable_response_gzip(); // Add to any API endpoint

// Optional trimming
$response = trim_system_payload_for_transit($payload);
```

---

## Historical Bandwidth Estimates — Not Benchmarked

| Format | Size | Time (5G) | Notes |
|--------|------|----------|-------|
| Full JSON | 120 KB | 156 ms | Historical estimate |
| + Gzip | 16 KB | 21 ms | Historical estimate |
| + Trim | 10 KB | 13 ms | Historical estimate |
| Binary | 4 KB | 5 ms | Historical estimate; normal client decoding not established |

These values are not a current benchmark or a verified reduction percentage.

---

## Future Work

1. **Delta API** (`?since_ts=1234567890`)
   - Only fleet/colony changes since last fetch
   - Reduces payload for live updates

2. **GraphQL Variant** (`POST /api/graphql`)
   - Client picks exact fields needed
   - 20-30% smaller than REST trim
