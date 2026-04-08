# GalaxyQuest Boot System Architecture

**Document Version:** 20260408p1  
**Last Updated:** April 8, 2026  
**Maintainer:** GalaxyQuest DevOps

---

## Table of Contents

1. [Overview](#overview)
2. [Boot Phases](#boot-phases)
3. [Version Tracking System](#version-tracking-system)
4. [Package Bundles & Fallback](#package-bundles--fallback)
5. [Critical Concepts](#critical-concepts)
6. [Troubleshooting](#troubleshooting)
7. [Best Practices](#best-practices)

---

## Overview

The GalaxyQuest boot system is a **multi-phase, hierarchical script loader** designed for:

- **Resilience**: Graceful fallback when bundles/CDN assets fail
- **Performance**: Version-aware caching to minimize redundant downloads
- **Debuggability**: Comprehensive logging and version drift detection
- **Compatibility**: Support for both WebGL and WebGPU renderers

### High-Level Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. HTML HEAD: Direct Boot Scripts (via <script> tags)  │
│    - boot-manifest.js                                   │
│    - boot-assets.js                                     │
│    - terminal.js, starfield.js, auth.js                │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Auth & User Flow                                     │
│    - Load core runtime (wm, gqui, THREE.js, etc.)     │
│    - Authenticate user & establish session             │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ 3. Package Bundle Loading Phase                         │
│    - Attempt to load .js.gz compressed bundles         │
│    - Per-bundle error handling (don't fail all)        │
│    - Fallback to single uncompressed scripts           │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Runtime Modules & Controllers                        │
│    - Load UI controllers (lazy via RequireRuntimeAPI)  │
│    - Initialize game engine & renderers                │
│    - Ready for gameplay                                │
└─────────────────────────────────────────────────────────┘
```

---

## Boot Phases

### Phase 0: Direct Boot Scripts (Synchronous, Blocking)

**Location:** `index.html` `<head>` section  
**Files:**
- `js/runtime/boot-manifest.js?v={version}`
- `js/runtime/boot-assets.js?v={version}`
- `js/ui/terminal.js?v={version}`
- `js/rendering/starfield.js?v={version}`
- `js/ui/prolog.js?v={version}`
- `js/network/auth.js?v={version}`

**Purpose:**
- Initialize window globals (`__GQ_BOOT`, `__GQ_ASSET_VERSIONS`)
- Display login UI immediately
- Validate cache versions

**Example:**
```html
<script src="js/runtime/boot-manifest.js?v=20260408p3"></script>
```

**Version Query String:**
- Used to **cache-bust** and signal freshness to browser
- Mismatch between query string and manifest `bootManifest` property = "version drift"
- Drift should be investigated/corrected (see [Troubleshooting](#troubleshooting))

---

### Phase 1: Core Runtime Loading (After Auth)

**Triggered by:** `auth.js` after user successfully logs in  
**Entry Point:** `bootGameRuntime()` in `auth.js:1330`

**Scripts Loaded (from `boot-manifest.js`):**
```javascript
// Window Manager & UI
js/runtime/wm.js
js/runtime/wm-widgets.js
js/runtime/gqwm.js

// Networking & DB
js/network/api.js
js/network/binary-decoder*.js
js/runtime/galaxy-db.js
js/runtime/galaxy-model.js

// Audio & Three.js Runtime
js/runtime/audio.js
js/runtime/tts.js
THREE.min.js (CDN)

// Graphics Core After THREE.js
js/engine/core/WebGLTexture3DPatch.js  ← Lazy, non-blocking
js/engine/core/GraphicsContext.js
js/engine/core/WebGLRenderer.js
js/engine/core/RendererFactory.js

// Event System
js/engine/EventBus.js
js/engine/GameLoop.js

// ... (50+ additional modules)
```

**Key Concept:** THREE.js is loaded **before** both WebGL and WebGPU renderers, ensuring compatibility checks work.

---

### Phase 2: Package Bundle Loading (Per-Bundle Error Handling)

**Entry Point:** `bootGameRuntime()` line ~1340 in `auth.js`  
**Function:** `loadBootAsset()` → `loadGzipPackage()`

#### Bundle Files (in `js/packages/` directory):
```
game.boot.bundle.engine-core.js.gz     (~39KB)
game.boot.bundle.runtime.js.gz         (~155KB)
game.boot.bundle.network.js.gz         (~22KB)
game.boot.bundle.rendering.js.gz       (~74KB)
game.boot.bundle.telemetry.js.gz       (~12KB)
game.boot.bundle.ui.js.gz              (~4KB)
game.boot.bundle.tests.js.gz           (~8KB)
game.boot.bundle.legacy.js.gz          (~2KB)
```

#### Bundle Load Strategy:

```javascript
// Pseudocode from auth.js:1340+
for each bundle in packageBundles {
  try {
    // 1. HEAD request: verify bundle exists on server
    const headCheck = await fetch(url, { method: 'HEAD', ...opts });
    if (!headCheck.ok) throw new Error(`status ${headCheck.status}`);
    
    // 2. GET request: download & decompress
    const response = await fetch(url, { cache: cacheStrategy, ...opts });
    const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
    const code = await new Response(decompressed).text();
    
    // 3. Inline as <script>
    const script = document.createElement('script');
    script.text = code + `\n//# sourceURL=${url}`;
    document.body.appendChild(script);
    
    bundlesLoaded += 1;
  } catch (err) {
    bundlesFailed += 1;
    authLog('warn', `Bundle ${url} failed`, err.message);
    // IMPORTANT: Continue to next bundle (don't stop entire boot)
  }
}

if (bundlesLoaded === 0 && bundlesFailed > 0) {
  authLog('warn', `All ${bundlesFailed} bundles failed, loading single scripts exclusively`);
}
```

#### Cache Strategy Selection:

```javascript
function getPackageCacheStrategy() {
  const isDev = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.includes('dev.')
  );
  return isDev ? 'no-store' : 'default';
}
```

- **Development**: `no-store` → always fetch fresh
- **Production**: `default` → respect browser cache (faster)

#### Single-Script Fallback:

If any/all bundles fail, the system loads individual uncompressed scripts:

```javascript
// bootScriptsControllers, bootScriptsRuntimeFoundation, etc.
// All 50+ scripts listed individually in boot-manifest.js
```

**Advantage:** Bundles are optional optimization; single scripts guarantee full functionality.

---

### Phase 3: Runtime Modules & Lazy Loading

**Triggered by:** Game controller initialization  
**Entry Point:** `RequireRuntimeAPI()` (game.js:4374)

**Process:**
```javascript
// Example from RuntimeSocialControllersBootstrap
const colonizationCtrl = requireRuntimeAPI('GQRuntimeColonizationController');
// If not loaded: throws error
// If loaded: returns the controller instance
```

**Lazy Runtime Modules (in `boot-manifest.js` line 312+):**
```
js/engine/runtime/RuntimeColonizationController.js
js/engine/runtime/RuntimeEmpireCategoriesPanel.js
js/engine/runtime/RuntimeEspionageController.js
js/engine/runtime/RuntimeConflictDashboard.js
... (30+ controller modules)
```

---

## Version Tracking System

### Version String Format

```
YYYYMMDDpN
20260408p1  ← April 8, 2026, patch 1
```

### Where Versions Live

**1. `boot-manifest.js` (source of truth)**
```javascript
const V = Object.freeze({
  bootManifest: '20260408p3',  // This file's version
  auth: '20260404p111',        // auth.js version
  runtime: '20260408p4',       // runtime bootstrap modules
  ... (50+ version keys)
});
```

**2. `index.html` query strings (deployment cache-busters)**
```html
<!-- Should match boot-manifest.js versions -->
<script src="js/runtime/boot-manifest.js?v=20260408p3"></script>
<script src="js/network/auth.js?v=20260404p111"></script>
```

**3. `boot-manifest.js` asset version registry**
```javascript
const assetVersions = Object.freeze({
  textureManager: '20260404p50',
  geometryManager: '20260404p50',
  galaxyRendererCore: '20260404p118'
});
```

### Version Drift Detection

The boot system logs a warning if query strings in `index.html` don't match manifest declarations:

```javascript
// From auth.js:1307 (version audit)
if (declared !== actual) {
  authLog('warn', 'Direct boot script version drift', 
    `src: ${src}, declared: ${declared}, actual: ${actual}`);
}
```

**When This Happens:**
- Old browser cache + new manifest = stale manifest loaded
- Deploy didn't update `index.html` query strings
- Manual testing with hardcoded URLs

**How to Fix:**
1. Update `index.html` query strings to match `boot-manifest.js` values
2. Or, increment `bootManifest` version and redeploy (full refresh)

---

## Package Bundles & Fallback

### Why Bundles?

- **Compression**: .js.gz reduces bandwidth by ~70%
- **Speed**: Single decompression vs. 50+ HTTP requests
- **CDN-friendly**: Can be pre-minified and cached long-term

### Why Per-Bundle Error Handling?

**Old Approach (all-or-nothing):**
```javascript
try {
  load bundle1
  load bundle2
  load bundle3
} catch (err) {
  // ONE failure → restart with 50+ single scripts
}
```

**Problem:** If bundle3 temporarily unavailable = full reload overhead

**New Approach (per-bundle):**
```javascript
for each bundle {
  try { load } catch { log & continue }
}
if (some loaded) { report & proceed }
else { fall back to single scripts }
```

**Benefit:** Partial bundle availability tolerated; only full failure triggers fallback

### Availability Check (HEAD Request)

Before downloading a large .js.gz file, send a HEAD to check HTTP status:

```javascript
const headCheck = await fetch(key, { method: 'HEAD', cache: cacheStrategy });
if (!headCheck.ok) {
  throw new Error(`bundle not available on server (status ${headCheck.status})`);
}
```

**Saves time:** Quick 404 detection vs. 5-10 sec wasted on timeout.

---

## Critical Concepts

### 1. WebGLTexture3DPatch (Lazy Loading)

**File:** `js/engine/core/WebGLTexture3DPatch.js`  
**Purpose:** Suppress harmless `texImage3D` FLIP_Y warnings from THREE.js

**Why Lazy?**
- Loaded after THREE.js (when it exists)
- Patches `console.warn` to filter 3D texture warnings
- Doesn't run during early boot (no interference)

**Implementation:**
```javascript
// Hooked into canvas.getContext
if (contextType === 'webgl' || contextType === 'webgl2') {
  ensurePatchApplied();  // Patches console.warn on first WebGL use
}
```

**Filter Regex:**
```javascript
// Only suppress texImage3D/pixelStorei 3D texture warnings
if (/texImage3D/.test(msg) && /FLIP_Y|PREMULTIPLY_ALPHA/.test(msg)) {
  return;  // Drop it
}
// All other warnings pass through
```

### 2. Boot-Time Globals

The boot system sets up global objects on `window`:

```javascript
// In boot-manifest.js
window.GQ_ASSETS_MANIFEST_VERSION = 2;
window.__GQ_ASSET_VERSIONS = { ... };
window.__GQ_DIRECT_BOOT_SCRIPTS = [ ... ];
window.__GQ_BOOT = {
  packageBundles: [ ... ],
  gameScripts: [ ... ],
  preloadAssets: [ ... ]
};
```

**Important:** These globals drive the entire boot flow. If missing = boot failure.

### 3. RequireRuntimeAPI Pattern

Controllers use a lazy-loading pattern:

```javascript
// In bootstrap code
const controller = requireRuntimeAPI('GQRuntimeSocialControllersBootstrap');
// This checks:
// 1. window.GQRuntime_SocialControllersBootstrap exists
// 2. It has the expected interface
// 3. Otherwise throws error
```

---

## Troubleshooting

### Issue 1: "GQRuntimeXXX is required but not available"

**Symptom:**
```
Error: [runtime/game] GQRuntimeColonizationController is required but not available.
```

**Root Cause:**
- Runtime controller file exists but **not listed in boot-manifest.js**
- Or, bundled in compressed package but decompress failed silently

**Diagnosis:**
1. Check `boot-manifest.js` line 312+ (`bootScriptsControllers`)
2. Verify the module path is registered
3. Check browser console for bundle decompress errors

**Fix:**
```javascript
// In boot-manifest.js bootScriptsControllers array
.concat(localScripts([
  'js/engine/runtime/RuntimeColonizationController.js',  // ADD THIS LINE
  'js/engine/runtime/RuntimeEmpireCategoriesPanel.js',
  // ...
], V.runtime))
```

Then increment `V.bootManifest` version.

---

### Issue 2: Version Drift Warnings

**Symptom:**
```
[GQ Boot] Direct boot script version drift: src=js/runtime/boot-manifest.js, 
declared=20260408p3, actual=20260406p4
```

**Root Cause:**
- Manual or partial deployment
- Browser cache serving stale manifest
- `index.html` query strings not updated

**Diagnosis:**
1. Compare `index.html` query strings to `boot-manifest.js` V object
2. Look for mismatch in version numbers

**Fix:**
```html
<!-- In index.html -->
<!-- BEFORE: -->
<script src="js/runtime/boot-manifest.js?v=20260406p4"></script>

<!-- AFTER: -->
<script src="js/runtime/boot-manifest.js?v=20260408p3"></script>
```

Ensure all query strings match `boot-manifest.js` versions.

---

### Issue 3: texImage3D Warnings Flooding Console

**Symptom:**
```
[Chromium] texImage3D with FLIP_Y set on non-2D texture
           (15x repeated)
```

**Root Cause:**
- THREE.js WebGLTextures.js sets FLIP_Y even for 3D textures
- Harmless warning (doesn't affect rendering)

**Diagnosis:**
1. Check if `WebGLTexture3DPatch.js` is loaded (search console on first WebGL canvas.getContext)
2. If patch not applied: check boot-manifest.js for WebGLTexture3DPatch entry

**Fix:**
- Patch is automatic (lazy-loaded on first WebGL context)
- If still appearing: ensure patch regex matches your warning message
- User can suppress in console: `window.__GQ_DEBUG_WEBGL_WARNINGS = false`

---

### Issue 4: E2E Tests Failing with Timeout

**Symptom:**
```
Error: expect(locator).toBeVisible() failed
Locator: #topbar-section
Expected: visible, Received: hidden (timeout 30000ms)
```

**Root Cause:**
- Multiple Playwright workers logging in simultaneously
- Backend DB connection exhaustion
- Login requests race condition

**Diagnosis:**
1. Check test command for `--workers` flag
2. Confirm it's NOT using default parallel workers (which is 2-4)

**Fix:**
```json
// In package.json
"test:e2e:smoke:renderer+viewflow": "playwright test ... --workers=1 --reporter=line"
```

Sequential execution (1 worker) prevents backend contention.

---

## Best Practices

### For Boot System Developers

1. **Test All Paths**
   - Boot with all bundles available
   - Boot with NO bundles (single-script path)
   - Boot with PARTIAL bundles (1-2 fail, others succeed)

2. **Version Increment Discipline**
   - Change only the patch number (p1 → p2) for minor fixes
   - Include affected file in commit message: "boot-manifest.js v20260408p4"
   - Always update `index.html` query strings when bumping manifest version

3. **Per-Module Error Handling**
   - Don't let one script failure kill entire phase
   - Use try/catch around optional controllers
   - Log warnings, but continue boot

4. **Lazy Loading Guidelines**
   - Load after dependencies exist (e.g., patch AFTER THREE.js)
   - Hook into events/APIs to trigger on first use
   - Avoid patching `console` globally; filter specific message patterns

### For Gameplay Developers

1. **New Runtime Controllers**
   - Create file in `js/engine/runtime/RuntimeXxxController.js`
   - Register in `boot-manifest.js` bootScriptsControllers array
   - Increment `V.bootManifest` version
   - Use `requireRuntimeAPI('GQRuntimeXxxController')` to access

2. **New Game Modules**
   - Add to appropriate section in `boot-manifest.js` (Core, Controllers, etc.)
   - Use `localScript(path, version)` helper for versioning
   - Default version: `V.runtime` or `V.assetCore` unless module-specific

3. **Testing New Boot Path**
   ```bash
   npm run test:e2e:renderer-smoke      # Single test
   npm run test:e2e:smoke:renderer+viewflow  # Multi-test (sequential)
   ```

### For DevOps / Deployment

1. **Cache Busting Strategy**
   - Increment patch version in `boot-manifest.js`
   - Update query strings in `index.html`
   - Deploy both atomically (single commit)

2. **Monitoring**
   - Watch browser console for version drift warnings
   - Monitor bundle availability (HEAD request failures)
   - Alert on missing runtime controllers

3. **Rollback**
   - Boot system is backward-compatible with single scripts
   - If CDN unavailable: single-script fallback works transparently
   - No special DB migrations needed (boot is read-only)

---

## Reference: Key Files

| File | Purpose | Maintainer |
|------|---------|-----------|
| `index.html` | Entry point, direct boot scripts | DevOps/Frontend |
| `js/runtime/boot-manifest.js` | Version & script registry | Frontend |
| `js/network/auth.js` | Bootgame flow & bundle loading | Frontend |
| `js/engine/core/WebGLTexture3DPatch.js` | THREE.js console warning filter | Rendering |
| `package.json` | npm scripts & E2E config | DevOps |
| `playwright.config.js` | Playwright test setup | QA |

---

## Appendix: Boot-Manifest Structure

### Boot Phases (Order Matters!)

```javascript
bootScriptsCore              // Always loaded first (WM, DB, THREE.js)
bootScriptsRuntimeFoundation // Runtime core (lifecycle, features)
bootScriptsTelemetry         // Analytics & logging
bootScriptsUI                // UI frameworks & components
bootScriptsControllers       // Game controllers (50+)
bootScriptsOther             // Misc & polyfills
```

### Version Numbering Convention

- `20260408p1` = April 8, 2026, version 1 (initial)
- `20260408p2` = April 8, same day, version 2 (hotfix)
- `20260409p1` = April 9, new day, version 1 (reset)

**Rationale:** Date-coded for human readability; patch number for same-day iterations.

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 20260408p1 | April 8, 2026 | Initial documentation; covers boot phases, version tracking, bundle fallback, troubleshooting |

---

**End of Document**
