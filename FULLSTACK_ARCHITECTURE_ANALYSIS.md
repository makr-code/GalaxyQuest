# FULLSTACK_ARCHITECTURE_ANALYSIS.md
## GalaxyQuest – Umfassender Architektur-Audit
### Fokus: Separation of Concerns über alle Schichten

**Report Date:** 2026-08-01  
**Scope:** Frontend (HTML/CSS/JS), Backend (PHP/Python), Database, Cross-Layer Integration  
**Target Audience:** Architecture Team, Senior Engineers

---

## EXECUTIVE SUMMARY

GalaxyQuest ist ein **ambitioniertes Multi-Layer Game Engineering Project** mit **hochkomplexer Architektur**, die unter dem Gewicht ihrer eigenen Komplexität leidet. Das Projekt zeigt sowohl brilliante Designentscheidungen (EventBus, Projections, pydantic validation) als auch kritische **Separation of Concerns (SOC) Violations**, die die Wartbarkeit, Testability und Performance gefährden.

### TOP 5 KRITISCHE PROBLEME

| Priorität | Problem | Scope | Impact | Effort |
|-----------|---------|-------|--------|--------|
| 🔴 P1 | **JavaScript Monolith** – 300+ Dateien ohne klare Layer-Trennung | Frontend | High coupling, Low testability | High |
| 🔴 P1 | **API Chaos** – 70+ action-basierte Endpoints, keine REST-Struktur | Backend | Unmaintainable, Inconsistent contracts | High |
| 🔴 P1 | **State Management Anarchy** – localStorage + Session + Projections + Memory | Cross-Layer | Race conditions, Sync bugs, Silent failures | High |
| 🟠 P2 | **CSS Spaghetti** – 12 CSS-Dateien, fragmente überall verteilt | Frontend | Maintenance nightmare, Regressions | Medium |
| 🟠 P2 | **Error Handling Asymmetrie** – PHP robust, JS adhoc, Python missing | Cross-Layer | Silent failures, Bad UX | Medium |

### QUICK WINS (sofort implementierbar)

1. ✅ **Module Bundler Konfiguration** – Webpack/Vite Groups mit `--entry-points` zur LOC-Reduzierung
2. ✅ **API Versioning v2** – Einführung strukturierter REST-Routes (`/api/v2/{resource}/{action}`)
3. ✅ **CSS Token Inheritance** – Alle scattered styles in `design-tokens.css` konsol, dann Cleanup
4. ✅ **State Sync Contract** – Definiere: Frontend (Memory) ← → Backend (DB), kein Hybrid
5. ✅ **Error Boundary UI** – React-Style Error Handling mit User Feedback

### SCORING SUMMARY (Durchschnitt pro Schicht)

| Layer | Cohesion | Coupling | Testability | Reusability | Maintainability | **AVG** |
|-------|----------|----------|-------------|-------------|-----------------|--------|
| **HTML Layer** | 7 | 4 | 6 | 7 | 6 | **6.0** |
| **CSS Layer** | 4 | 7 | 3 | 2 | 3 | **3.8** |
| **JS Frontend** | 3 | 8 | 2 | 2 | 3 | **3.6** |
| **PHP API** | 4 | 8 | 3 | 3 | 4 | **4.4** |
| **Python Services** | 8 | 5 | 7 | 8 | 8 | **7.2** |
| **Database Layer** | 6 | 5 | 4 | 5 | 5 | **5.0** |
| **Cross-Layer** | 2 | 9 | 2 | 1 | 2 | **3.2** |
| **OVERALL** | — | — | — | — | — | **4.6/10** |

---

## 1. FRONTEND ANALYSIS

### 1.1 HTML-Layer

#### Dateistruktur & Entry Point

```
index.html                    [MAIN entry point, 850+ LOC]
├─ Template Variables ({{buildnr}}, {{build_date}})
├─ css/ links (12 stylesheets)
├─ SVG icon references (gfx/icons/mono/*.svg)
├─ <section> tags
│  ├─ #wm-galaxy-section       [Galaxy 3D background]
│  ├─ #auth-section            [Auth forms: login, register, dev]
│  ├─ #prolog-section          [Narrative onboarding]
│  ├─ #topbar-section          [Game UI: nav, player, user menu]
│  ├─ #resource-section        [Resource bar]
│  ├─ Window Manager sections  [Docked windows for game modules]
│  └─ Footer sections          [Copyright, links]
└─ <script> tags (inline boot logic + async loader)
    ├─ auth-boot-assets.js     [Loads auth-phase scripts]
    ├─ boot-manifest.js        [Defines 300+ game-phase scripts]
    └─ on-demand loaders       [Window-specific scripts]
```

**HTML Observations:**

- ✅ **Semantic HTML:** Good use of `<section>`, `<nav>`, `<header>`, `<button>` with `role` attributes
- ✅ **Accessibility:** ARIA-labels, `aria-live="polite"`, `aria-expanded`, tabindex management
- ✅ **Data Coupling:** Uses `data-win`, `data-tab`, `data-resource` attributes (loose coupling to JS)
- ⚠️ **Template Rendering:** PHP-based variable substitution (`{{buildnr}}`) — works but creates tight coupling to index.php
- ❌ **No Clear Separation:** HTML defines UI structure, BUT business data (faction colors, resource types) hardcoded or fetched async

#### Issues & Violations

1. **Inline Styles:** Game-guide-panel styles (inline `<style>` tag) instead of design-tokens.css
2. **Hardcoded Constants:** Resource types (metal, crystal) duplicated in HTML `data-resource` vs JS logic
3. **Mixed Concerns:** HTML defines UI containers AND navigation behavior (e.g., `data-win` triggers window open)

**Recommendation:** Extract inline styles to CSS module; use data-driven UI (JSON config for resources, nav items).

---

### 1.2 CSS-Layer

#### File Structure & Architecture

```
css/
├─ design-tokens.css       [CSS custom properties: colors, shadows, transitions]
├─ animations.css          [Keyframes, animation utilities]
├─ utilities.css           [Single-purpose classes: .hidden, .sr-only, .text-center]
├─ style.css               [Main stylesheet: ~2000 LOC, layout, forms, UI]
├─ wm.css                  [Window Manager layout & dragging]
├─ gqwm.css                [Game-specific WM extensions]
├─ prolog.css              [Prologue/narrative UI]
├─ diplomacy.css           [Diplomacy panel styles]
├─ advanced-rendering.css  [WebGL/WebGPU visual effects]
├─ npc_dialogue_panel.css  [NPC chat UI]
├─ viewport-overlay.css    [Overlay UI elements]
└─ isometric-modules.css   [Isometric 3D module visualization]
```

**Design System Assessment:**

```css
/* ✅ GOOD: Token-based approach */
:root {
  --bg-deep: #050a1a;
  --accent-blue: #3aa0ff;
  --shadow: 0 4px 24px rgba(0,0,0,0.6);
  --duration-fast: 150ms;
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}

/* ✅ GOOD: Semantic color naming */
--text-primary, --text-secondary, --text-muted

/* ✅ GOOD: Elevation system */
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl

/* ⚠️ PROBLEM: Inconsistent feature-specific tokens */
--neon-blue, --neon-cyan, --neon-purple  (why not --accent-*?)
--glow-intense-*  (multiple glow definitions)

/* ❌ PROBLEM: No spacing/sizing scale */
/* No standardized --space-8, --space-16, --space-24 */
/* CSS uses hardcoded px: padding: 10px, 12px, 16px, 20px... */
```

**CSS Architecture Issues:**

| Issue | Severity | Location | Impact |
|-------|----------|----------|--------|
| **BEM/SMACSS not enforced** | 🔴 | All files | Class naming chaos: `.btn`, `.button`, `.btn-primary`, `.btn-danger` (no pattern) |
| **Component CSS scattered** | 🔴 | Multiple files | NPC dialog styles in `npc_dialogue_panel.css` + inline `<style>` tags in components |
| **No CSS-in-JS discipline** | 🟠 | `index.html` | `<style>` blocks for game-guide-panel, auth panels — hard to maintain |
| **Responsive design ad-hoc** | 🟠 | style.css | Media queries exist, but no mobile-first strategy documented |
| **No CSS Modules/Scoping** | 🔴 | All | Global namespace pollution; utility classes too generic |
| **Color usage inconsistent** | 🟠 | Multiple | `#4fbf73` hardcoded in styles instead of `--accent-green` |
| **Unused CSS accumulation** | 🔴 | style.css | Historic styles from old features still present |

**Recommendation:** Migrate to CSS Modules + Atomic Design; create spacing scale (`--space-*`); enforce BEM naming; move inline styles to design-tokens.

---

### 1.3 Session & Cookie Management

#### Storage Strategy

| Storage Type | Usage | Lifetime | Data Examples |
|--------------|-------|----------|---|
| **localStorage** | Persistent UI state | Browser restart | `gq_boot_trace`, `player_id`, `blueprint-slots`, `adv-rendering-colorblind`, `gq_last_title_track` |
| **sessionStorage** | Single-session data | Tab close | `gq_tts_url_cache`, prolog progress |
| **Cookies** | Auth persistence | Session lifetime | `gq_remember` (1 week), PHPSESSID |
| **Backend Session ($_SESSION)** | Server-side auth state | SESSION_LIFETIME (~1h) | `user_id`, `csrf_token`, TOTP status |
| **IndexedDB** | Future cache layer | — | Not currently used |

#### Auth Token Flow

```
index.html (load)
  ↓
auth.js (bootstrap)
  ↓
fetch /api/auth.php?action=me
  ├─ If logged in (PHPSESSID + $_SESSION['user_id'])
  │   ↓
  │   boot-manifest.js (load 300+ game scripts)
  │   ↓
  │   fetch /api/game.php?action=overview
  │       (cached: gq_cache_get('game_overview', ['uid' => $uid]))
  │   ↓
  │   Hydrate UI + DOM
  │
  └─ If not logged in
      ↓
      Show login form + register flow
```

#### Issues & Violations

1. **No CSRF Token Refresh**
   ```javascript
   // ❌ PROBLEM: CSRF token fetched once, never refreshed
   const token = await fetch('/api/auth.php?action=csrf').then(r => r.json());
   // If session expires mid-game, token becomes invalid
   // Forms fail silently or with generic "CSRF mismatch" error
   ```

2. **localStorage Leakage**
   ```javascript
   // ⚠️ PROBLEM: Player ID stored in localStorage
   const playerId = localStorage.getItem('player_id') || '1';
   // If user A logs out, User B on same browser gets User A's player ID
   // Cross-tab race conditions possible
   ```

3. **No Session Timeout UI**
   ```
   // ⚠️ PROBLEM: Session expires, but UI keeps running
   // API calls start returning 401, but user isn't notified
   // Game appears frozen; user refreshes page
   ```

4. **No State Versioning**
   ```javascript
   // ❌ PROBLEM: localStorage data format changes break restore
   // Old: localStorage.setItem('blueprint-slots', JSON.stringify([...]))
   // New: structure changes, but migration not implemented
   // User loads game with old data → parsing fails → feature breaks
   ```

**Recommendations:**
- Implement automatic CSRF token refresh (fetch new token on 403)
- Use sessionStorage for player ID (expires on tab close)
- Add heartbeat API call (`/api/auth.php?action=heartbeat`) to detect session expiry
- Implement localStorage versioning & migration strategy

---

### 1.4 State & Restore Architecture

#### Current State Management Model

```javascript
/* DECENTRALIZED STATE ACROSS MULTIPLE LAYERS */

// Layer 1: Window Properties (UI State)
window.__GQ_AUTH_READY = { initialized, loginBound, startedAt }
window.__GQ_BOOT_PROBE = { log() }
window.__GQ_ASSET_VERSIONS = { audio: '...', gqui: '...' }

// Layer 2: localStorage (Persistent User Preferences)
localStorage.gq_boot_trace = '1'
localStorage.player_id = '123'
localStorage.blueprint-slots = JSON.stringify([...])
localStorage['gq:rendererHint'] = 'webgpu|webgl2|auto'

// Layer 3: sessionStorage (Tab-local Prolog State)
sessionStorage.gq_tts_url_cache = '...'
sessionStorage.prolog_progress = JSON.stringify({...})

// Layer 4: Backend Session ($_SESSION)
$_SESSION['user_id'] = 123
$_SESSION['csrf_token'] = '...'
$_SESSION['totp_enabled'] = false

// Layer 5: Database Cache (Projections)
projection_system_snapshot       # Materialized view of game state
projection_user_overview         # Pre-computed player overview

// Layer 6: Memory (Runtime JS Objects)
window.gameState = { ... }       # NOT standardized
window.fleet = { ... }           # Ad-hoc module state
```

#### Boot Sequence & Hydration

```
1. index.html loads
   └─ Creates <script> tags for auth-boot-assets.js

2. auth-boot-assets.js runs (EARLY)
   ├─ Check localStorage.player_id
   ├─ Load CSS (design-tokens, animations, utilities, style)
   ├─ Load JS (audio.js, gq-ui.js, wm.js, gqwm.js)
   ├─ Set window.__GQ_AUTH_READY
   └─ Call loadScript(AUTH_LAST_TITLE_TRACK_KEY) if exists

3. auth.js bootstrap runs (INLINE in index.html)
   ├─ Fetch /api/auth.php?action=me
   │  └─ If 200 → user logged in
   │      ├─ Show auth-login-confirm-section
   │      ├─ Load boot-manifest.js (THIS IS THE BIG LOAD)
   │      └─ Load 300+ game-phase scripts (parallel/async)
   │
   └─ If 401/403 → user not logged in
       └─ Show login/register form

4. boot-manifest.js generates <script> tags for:
   ├─ js/engine/**
   ├─ js/network/**
   ├─ js/runtime/**
   ├─ js/components/**
   └─ Game-specific modules (war, economy, fleet, etc.)

5. Scripts execute (parallel)
   ├─ Each module initializes (side effects!)
   ├─ EventBus listeners registered
   ├─ GameEngine.start() called
   ├─ Fetch /api/game.php?action=overview (cached if available)
   └─ Render DOM from fetched data

6. Window Manager launches
   ├─ Position/size from localStorage (wm_pos_<id>)
   ├─ Load first panels (colony overview, fleet)
   └─ User interaction starts
```

**State Recovery Issues:**

| Scenario | Problem | Current Handling |
|----------|---------|------------------|
| **Browser crash during game** | Player had unsaved changes | None — restart loads from last DB projection |
| **Network goes offline** | API calls fail silently | EventBus listeners don't know about failure |
| **localStorage corrupted** | Player preferences unusable | JSON.parse() throws, catch missing → blank state |
| **Session expired mid-game** | User still sees old data | No refresh prompt; API returns 401, ignored by many handlers |
| **Slow network (3G)** | 300+ scripts + CSS fail to load | Timeout after 60s, shows "Systemcheck laeuft..." forever |
| **Two tabs open** | State diverges between tabs | No sync mechanism; last write wins (chaos) |

**Recommendations:**
- Implement `StateManager` class with versioning & migration
- Create `restore()` lifecycle hook before any module initialization
- Add network status API (`/health` + heartbeat) to detect outages
- Implement localStorage versioning: `{ version: 2, data: {...} }`
- Use SharedWorker for cross-tab state sync

---

### 1.5 JavaScript Architecture Assessment

#### LOC & Module Breakdown

```
js/
├─ admin/                  (~20 files)      [Dev tools, diagnostics]
├─ components/             (~30 files)      [UI components: panels, buttons]
├─ engine/                 (~150 files)     [Core engine: rendering, physics, vfx]
├─ features/               (~20 files)      [Feature-specific logic]
├─ legacy/                 (~10 files)      [Deprecated code, compatibility shims]
├─ network/                (~15 files)      [API calls, auth]
├─ packages/               (~20 files)      [Third-party code, Three.js, D3]
├─ rendering/              (~15 files)      [Renderer abstraction]
├─ runtime/                (~20 files)      [Event loop, window manager]
├─ services/               (~15 files)      [Singletons: cache, sound, etc.]
├─ systems/                (~20 files)      [Game systems: colony, war, etc.]
├─ telemetry/              (~5 files)       [Analytics, tracing]
├─ tests/                  (~10 files)      [Unit/integration tests]
├─ ui/                     (~20 files)      [UI framework: gq-ui.js]
└─ vendor/                 (~5 files)       [Bundled libs]
```

**Total: ~350+ JS files, ~50,000+ LOC (est.)**

#### Coupling Analysis

```javascript
// ❌ EXAMPLE 1: Tight coupling — View depends on Model
// js/components/colony-overview.js
class ColonyOverviewPanel {
  constructor(colonyId) {
    this.colonyId = colonyId;
    this.ui = new ColonyOverviewUI(); // Tightly coupled
    
    // Directly fetch from API (not decoupled)
    fetch(`/api/game.php?action=resources&colony_id=${colonyId}`)
      .then(r => r.json())
      .then(data => this.ui.render(data)); // No error boundary
  }
  
  update() {
    // Directly calls API (no service abstraction)
    fetch('/api/buildings.php')
      .then(r => r.json())
      .then(/* mix of logic + rendering */);
  }
}

// ⚠️ EXAMPLE 2: EventBus used (good!), but inconsistently
// js/engine/game/EconomySimulation.js
class EconomySimulation {
  constructor(bus) {
    this.bus = bus;
    this.bus.on('tick', dt => this.step(dt)); // Decoupled!
  }
  
  step(dt) {
    // BUT: Still does direct API calls
    fetch('/api/economy_runtime.php') // Should emit event instead
      .then(/* ... */);
  }
}

// ❌ EXAMPLE 3: Global state pollution
window.gameState = { ... }      // Where is this defined?
window.fleet = { ... }          // Multiple modules create globals
window.player = { ... }         // No centralized State Manager

// Bad: Multiple modules modify same global
fleet.units.push(new Unit());   // Who called this? No tracking.
```

#### Testability Issues

| Module Type | Testability | Example | Problems |
|-------------|-------------|---------|----------|
| **Components** | 🔴 Low | `ColonyOverviewPanel` | Requires DOM, API mocking, EventBus setup |
| **Engine** | 🟠 Medium | `GameEngine` | Depends on RendererFactory, which needs WebGL context |
| **Systems** | 🟠 Medium | `EconomySimulation` | Needs EventBus + API layer + stateful fixtures |
| **Services** | 🟢 High | `AudioService` | Good abstractions, mostly pure functions |
| **Network** | 🟠 Medium | `auth.js` | Hard to mock `/api/` without fetch stubbing |

#### Missing Infrastructure

```javascript
// ❌ NO: Dependency Injection
// Every component creates its own dependencies
const panel = new ColonyPanel(colonyId); // Hard to inject mock API

// ❌ NO: Service Locator
// No centralized registry of services
// window.audioService, window.cacheService defined ad-hoc

// ❌ NO: Error Boundaries
// No top-level error handler for component trees
// Errors propagate, UI goes blank

// ❌ NO: Suspense/Loading States
// No standard way to show "loading..." during async operations
// Each component implements own spinner/retry logic

// ✅ GOOD: EventBus exists
// BUT used inconsistently (some modules use it, others don't)

// ✅ GOOD: Asset versioning
// window.GQResolveAssetVersion() + version params in URLs
```

**Recommendation:** Introduce simple DI pattern; use `class Injector { static register(name, fn) }` or use esbuild plugin to tree-shake unused code.

---

## 2. BACKEND ANALYSIS

### 2.1 PHP API Architecture

#### API Structure Overview

```
api/
├─ Core Endpoints (Auth, Game)
│  ├─ auth.php                    [Login, register, 2FA, CSRF]
│  ├─ game.php                    [Overview, resources, settings]
│  ├─ health-check (implied)      [Status probes]
│
├─ Game Systems (Business Logic)
│  ├─ colony.php, buildings.php   [Colony management]
│  ├─ fleet.php, shipyard.php     [Military]
│  ├─ research.php                [Tech tree]
│  ├─ economy.php, market.php     [Economy + trading]
│  ├─ war.php, conflict.php       [Warfare]
│  ├─ factions.php                [Faction data]
│  ├─ leaders.php                 [Leader management]
│  ├─ diplomacy.php               [Diplomacy + relations]
│  ├─ pirates.php                 [Pirate encounters]
│  ├─ trade.php, traders.php      [Trade routes]
│  ├─ messages.php, events.php    [Notifications]
│  ├─ achievements.php            [Achievement tracking]
│  ├─ quests.php (implied)        [Quest system]
│
├─ NPC & AI
│  ├─ npc_ai.php                  [NPC behavior]
│  ├─ npc_controller.php          [NPC management]
│  ├─ npc_llm_controller.php      [LLM integration]
│  ├─ npc_chat_integration.php    [Chat/dialogue]
│  ├─ npc_quest_*.php             [Quest generation]
│
├─ Admin & Utilities
│  ├─ admin_stats.php             [System stats]
│  ├─ admin_users.php             [User management]
│  ├─ cache_diagnostics.php       [Cache inspection]
│  ├─ cache_invalidation.php      [Cache clearing]
│  ├─ cache_metrics.php           [Cache statistics]
│  ├─ projection.php (implied)    [Materialized views]
│  ├─ galaxy_seed.php             [Galaxy generation]
│  ├─ game_engine.php             [Simulation engine]
│
├─ External Services
│  ├─ tts.php, tts_client.php     [Text-to-speech]
│  ├─ llm.php, ollama.php         [LLM inference]
│  ├─ swarmui_client.php          [3D asset generation]
│  ├─ textures*.php               [Texture AI]
│
└─ Helpers & Config
   ├─ helpers.php                 [Shared functions: auth, errors, cache, DB]
   ├─ cache.php                   [Caching layer]
   └─ v1/                         [RESTful API v2 preview]
```

**Total: ~70 PHP files, mixed action-based dispatching**

#### Current API Pattern (Anti-pattern)

```php
// ❌ PROBLEM: Action-based routing, not REST
GET  /api/game.php?action=overview
GET  /api/game.php?action=resources&colony_id=X
POST /api/game.php?action=rename_colony
POST /api/fleet.php?action=move_fleet
POST /api/research.php?action=start_research

// ✅ WHAT IT SHOULD BE (REST):
GET    /api/v2/game/overview
GET    /api/v2/game/resources?colony_id=X
PATCH  /api/v2/colonies/{id}      [rename, set_type, etc.]
POST   /api/v2/fleets/{id}/move
POST   /api/v2/research/start

// ❌ PROBLEM: No clear response format
// game.php returns: { success: true, data: {...} }
// fleet.php returns: { status: 'ok', fleet: {...} }
// war.php returns: { error: null, result: {...} }
// ✓ No consistency!

// ✓ GOOD: Error handling is structured
gq_api_handle_uncaught_throwable()  [Global exception handler]

// ❌ BUT: Input validation is ad-hoc
$cid = (int)($_GET['colony_id'] ?? 0);  [Manual casting, no schema]
// Should be: $validated = validate($request, ColonySchema)

// ❌ PROBLEM: Business logic mixed with HTTP handling
// api/economy.php
function handle_economy() {
  $db = get_db();
  $uid = require_auth();
  
  // Direct SQL instead of repository pattern
  $result = $db->prepare('SELECT * FROM economy_goods WHERE uid=?');
  $result->execute([$uid]);
  
  // Mixed concerns:
  $data = [];
  foreach ($result as $row) {
    // Transform row to API format (mixing data + presentation)
    $data[] = [
      'id' => $row['id'],
      'type' => $row['type'],
      'value' => $row['value'] * 1.1  // Business logic inline!
    ];
  }
  
  json_ok($data);  // Response formatting
}
```

#### Layer Separation Issues

```
CURRENT ARCHITECTURE (COUPLED)
┌─────────────────────────────────────────────────────────────┐
│ api/game.php (HTTP layer + Business logic + DB access)     │
│ ├─ Route dispatcher: switch($_GET['action'])               │
│ ├─ Auth check: require_auth()                              │
│ ├─ DB queries: $db->prepare(...)->execute(...)             │
│ ├─ Business logic: compute, validate, transform            │
│ ├─ Response formatting: json_ok($data)                     │
│ └─ Error handling: try/catch (handled by global handler)   │
└─────────────────────────────────────────────────────────────┘

PROBLEMS:
- Hard to unit test (requires full DB, auth)
- Hard to reuse (logic buried in HTTP handler)
- Hard to cache (cache layer separate from business logic)
- Hard to monitor (no clear entry/exit points)

DESIRED ARCHITECTURE
┌─────────────────────────────────────────────────────────────┐
│ HTTP Layer (api/v2/game/overview)                          │
│ ├─ Route matching                                          │
│ ├─ Auth extraction                                         │
│ └─ Delegates to:                                           │
├───────────────────────────────────────────────────────────┤
│ Application/Service Layer (GameService::getOverview)      │
│ ├─ Authorization check                                     │
│ ├─ Validation                                             │
│ ├─ Orchestration                                          │
│ └─ Delegates to:                                          │
├───────────────────────────────────────────────────────────┤
│ Domain/Business Layer (GameModel, EconomyService)         │
│ ├─ Pure business logic                                     │
│ ├─ Delegates to:                                          │
├───────────────────────────────────────────────────────────┤
│ Persistence Layer (GameRepository)                        │
│ ├─ DB access (queries, transactions)                      │
│ ├─ Caching                                                │
│ └─ Returns domain objects                                 │
└────────────────────────────────────────────────────────────┘
```

#### Response Format Inconsistency

| Endpoint | Success Response | Error Response |
|----------|---|---|
| auth.php | `{ success: true, data: {...} }` | `{ success: false, error: "msg", code: "ERR_X" }` |
| game.php | `{ success: true, ...payload }` | HTTP 500 + JSON error |
| fleet.php | `{ status: 'ok', fleet: {...} }` | `{ status: 'error', message: "..." }` |
| war.php | `{ success: true, result: {...} }` | `{ success: false, error: null }` |
| economy.php | `{ economy: {...} }` | HTTP error code |

**Recommendation:** Adopt consistent envelope:
```json
{
  "success": true/false,
  "data": {...},        // or null if error
  "error": {
    "code": "E_COLONY_NOT_FOUND",
    "message": "Colony with ID 999 not found",
    "details": {...}
  },
  "meta": {
    "timestamp": "2026-08-01T...",
    "version": "v2.1.3"
  }
}
```

---

### 2.2 Python TTS Service

#### Structure & Patterns

```python
# ✅ GOOD: Clean separation of concerns
tts_service/
├─ main.py              [FastAPI app, route handlers]
├─ config.py            [Configuration (pydantic-settings)]
├─ models.py            [Request/response models (pydantic)]
├─ auth.py              [Authentication logic]
├─ cache.py             [Caching layer]
├─ engines/             [TTS implementation modules]
│  ├─ __init__.py       [Factory pattern]
│  ├─ piper.py          [Piper engine]
│  └─ xtts.py           [Coqui XTTS engine]
└─ tests/               [Unit tests]

# ✅ Excellent patterns:
- pydantic for validation: SynthesiseRequest, TTSSettings
- FastAPI dependency injection: check_secret(Header(...))
- async/await for I/O-heavy TTS synthesis
- Structured logging via structlog
- Cache abstraction (AudioCache)
- Factory pattern for engine selection

# Structure:
@app.post("/synthesize")
async def synthesize(
    request: SynthesiseRequest,      # ✅ Validated model
    x_tts_key: str = Header(...)     # ✅ Dependency injection
):
    engine = create_engine(config.engine)
    result = await engine.synthesize(request.text)
    cache.set(request.voice, result)
    return {"audio": result}
```

**Python Assessment: 8/10** — Clean architecture, but small scope. Good patterns for scaling.

---

### 2.3 Database Schema

#### Current State

- **~70 migration files** (incremental development pattern)
- **Multiple migration phases:** v1 (initial), v2 (refinements), v3 (new systems)
- **Schema size:** ~150+ tables (estimated from migration names)
- **No schema versioning doc** (must reverse-engineer from SQL files)

#### Schema Layers (from migrations)

| Layer | Purpose | Tables (Examples) |
|-------|---------|---|
| **Core Game** | Planets, colonies, resources | galaxies, systems, planets, sectors, colonies |
| **Players & Auth** | User accounts, sessions, RBAC | players, users, admin_users, sessions |
| **Economy** | Resources, trade, markets | colony_resources, economy_goods, market_analysis, trade_proposals, traders, traders_events |
| **Military** | Fleets, ships, combat | vessel_blueprints, fleet_templates, wars, combat_modifiers, combat_reports |
| **Research** | Tech trees, upgrades | research_trees, research_statuses, technology |
| **Diplomacy** | Relations, alliances, agreements | faction_relations, alliances, diplomatic_plays, faction_agreements |
| **NPCs** | AI players, behavior, quests | npc_llm_decision_log, npc_quest_*, npc_chat_* |
| **Events & Situations** | Game events, global state | situations, situation_states, events, updates |
| **Projections** | Materialized views (caching) | projection_system_snapshot, projection_user_overview |
| **Cache** | HTTP response cache (may be Redis) | (managed by gq_cache_* functions) |

#### Issues & Violations

| Issue | Example | Impact |
|-------|---------|--------|
| **No enforced consistency** | `CREATE TABLE IF NOT EXISTS` in every migration | Can fail silently if table already exists differently |
| **Soft deletes missing** | No `deleted_at` column in most tables | Data loss on delete, can't audit deletions |
| **Audit logging minimal** | No systematic tracking of who/what/when changed | Compliance risk, hard to debug |
| **Foreign keys not enforced** | Migrations define FKs, but PHP code doesn't rely on them | Orphaned records possible |
| **No transaction demarcation docs** | Which operations are multi-table? | Risk of partial updates |
| **Projection staleness** | `projection_*` tables updated async, can lag | UI shows stale data |
| **No data versioning** | Blueprint/ship data changes, old records unclear | Ambiguous historical data |

**Recommendations:**
- Add `created_at`, `updated_at`, `deleted_at` to all tables
- Implement audit trail (shadow table or audit_log table)
- Document transactional boundaries (which operations must be atomic)
- Migrate to enforced foreign keys where safe

---

## 3. CROSS-LAYER ANALYSIS

### 3.1 Data Flow Architecture

#### Request/Response Lifecycle

```
USER ACTION (click, submit)
  ↓
JavaScript Handler (js/components/*)
  ├─ Validate input locally (if at all) ⚠️
  ├─ Emit EventBus event ('game:action')
  └─ Fetch API
     GET|POST /api/endpoint.php?action=X
        ↓
     PHP Handler (api/endpoint.php)
        ├─ Validate input (manual casting) ⚠️
        ├─ Check auth (require_auth())
        ├─ Check cache (gq_cache_get)
        ├─ Query DB or call external service
        ├─ Format response (custom per endpoint) ❌
        └─ Echo JSON + exit
        ↓
     JS receives response
        ├─ Check response.success or response.status ⚠️ inconsistent
        ├─ Update component state
        ├─ Emit EventBus event ('game:action-complete')
        ├─ Re-render DOM
        └─ Show success/error toast (if implemented) ⚠️

PROBLEMS AT EACH STAGE:
1. Input validation not standardized (frontend + backend)
2. Response formats inconsistent
3. Error handling scattered (no unified error recovery)
4. No request tracing (hard to debug)
5. Cache invalidation ad-hoc
```

#### Silent Failures

| Scenario | Current Behavior | User Impact |
|----------|---|---|
| API returns 401 (session expired) | Many endpoints ignore it, show cached data | User thinks they're still logged in |
| Network timeout after 60s | Request abandons, component spins forever | Frozen UI, user force-refreshes |
| DB query fails (e.g., constraint violation) | PHP returns generic 500 error | No hint what went wrong |
| Cache key collision | gq_cache_get returns wrong data | Wrong data silently served |
| Concurrent updates (2 tabs) | Last write wins, no conflict detection | Data loss or inconsistency |

---

### 3.2 Authentication & Authorization Flow

#### Login Flow

```
1. User enters credentials
2. POST /api/auth.php?action=login
   ├─ Validate username/password (bcrypt check)
   ├─ Check if TOTP enabled
   │  ├─ If no: Set $_SESSION['user_id'], return success
   │  └─ If yes: Return challenge prompt, set $_SESSION['totp_temp']
   │
   ├─ If 2FA required: Show /api/auth.php?action=totp_login_challenge
   │  ├─ User enters 6-digit code
   │  ├─ POST /api/auth.php?action=totp_login_challenge
   │  └─ If valid: Set $_SESSION['user_id']
   │
   └─ Set PHPSESSID cookie (httponly, SameSite=Strict)

3. auth.js detects login success
   ├─ Fetch /api/auth.php?action=me (verify session)
   └─ Load boot-manifest.js

4. Game boots, user can play
```

#### Authorization Issues

| Issue | Risk | Current Handling |
|-------|------|---|
| **No resource ownership checks before expensive ops** | User can request compute-heavy simulations for other players' colonies | Manual checks in each endpoint (verify_colony_ownership) — easy to miss |
| **No rate limiting per user** | Attacker spams /api/economy_flush.php 1000x/sec | None — server resources exhausted |
| **No permission scoping** | Admin accidentally has same endpoints as player | Implicit (handled by checks) — hard to audit |
| **CSRF token not refreshed** | If token leaked, attacker can perform actions | Token fetched once, never refreshed during session |
| **No capability-based tokens** | Backend relies on session for all auth | If session stolen, attacker has full access |

**Recommendations:**
- Implement JWT with short expiry (30 min) + refresh tokens
- Add per-route permission decorator: `@require_permission('colony:read')`
- Implement rate limiting middleware (e.g., `1000 requests/hour per user`)
- Add request signing (X-Signature header) for non-GET requests

---

### 3.3 State Synchronization Strategy

#### Current Architecture (Fragmented)

```
THREE COMPETING STATE SOURCES:

1. FRONTEND (Memory)
   └─ window.gameState, window.fleet, window.colony
   └─ Pros: Fast, responsive
   └─ Cons: Lost on page refresh, diverges from server
   └─ Used by: UI rendering, animations, game loop

2. FRONTEND (LocalStorage/SessionStorage)
   └─ UI state: window positions, preferences
   └─ Pros: Persists across tabs
   └─ Cons: Limited space, no encryption, can be cleared by browser
   └─ Used by: Window manager positions, boot settings

3. BACKEND (Database + Session)
   └─ Source of truth: all game state
   └─ Pros: Persistent, single source
   └─ Cons: Requires API round-trip (latency), eventual consistency
   └─ Used by: Save/load, multiplayer sync, persistence

CONFLICT RESOLUTION:
  Backend expires session
  ↓
  Frontend shows cached data
  ↓
  API calls start returning 401
  ↓
  Some handlers check status, others ignore it
  ↓
  UI in inconsistent state
```

#### Sync Strategy Recommendations

```
OPTION A: Client-Source-of-Truth (Optimistic Updates)
  ┌─────────────────┐
  │  Local State    │
  │  (Memory)       │
  └────────┬────────┘
           │
           ├─ Render UI (instant)
           │
           ├─ Send to Backend
           │  (async, background)
           │
           └─ If conflict detected:
              ├─ Rollback optimistic update
              ├─ Show conflict dialog
              └─ Request user input

OPTION B: Server-Source-of-Truth (Conservative)
  ┌──────────────┐
  │  User Action │
  └───────┬──────┘
          │
          ├─ Send to Backend
          │
          ├─ Wait for response (loading UI)
          │
          ├─ Update Local State
          │
          └─ Render UI

OPTION C: Hybrid (Recommended)
  ┌─────────────────────────────────────┐
  │ Critical state (resources, fleet)   │
  │ → Server-source (conservative)      │
  │ Non-critical (UI positions, themes) │
  │ → Local-source (optimistic)         │
  └─────────────────────────────────────┘
```

**Current State:** Hybrid but undocumented and fragile.

---

### 3.4 Caching Strategy

#### Multi-Layer Cache

```
Layer 1: Browser Cache (HTTP headers)
  GET /api/game.php?action=overview
  Response Headers: Cache-Control: public, max-age=30
  └─ Browser caches for 30 seconds

Layer 2: PHP Session Cache (in-process or Redis)
  gq_cache_get('game_overview', ['uid' => $uid])
  gq_cache_set('game_overview', ['uid' => $uid], $data, TTL)
  └─ Cached per user, keyed by user_id + action

Layer 3: Database Query Cache (implied)
  PROJECTION_OVERVIEW_ENABLED flag
  └─ Materialized view: projection_user_overview
  └─ Pre-computed, updated async

Layer 4: Frontend Cache (localStorage + memory)
  localStorage.getItem('blueprint-slots')
  window.fleetCache = {...}
  └─ Manual cache management
```

#### Issues & Violations

| Layer | Issue | Impact |
|-------|-------|--------|
| Browser Cache | Cache-Control headers inconsistent across endpoints | Stale data served to users |
| PHP Cache | Cache invalidation ad-hoc (called after mutations) | Missing some invalidations, stale data in production |
| Projection Cache | Async updates (not transactional with mutation) | Read projection, while mutation in-flight → inconsistency |
| Frontend Cache | No versioning, no expiry | Stale data persisted across sessions |

**Recommendations:**
- Implement cache versioning: `v=20260801:overview`
- Add cache invalidation events to mutation handlers
- Use cache-busting headers: `Cache-Control: max-age=0, must-revalidate`
- Implement SWR (stale-while-revalidate) for non-critical data

---

### 3.5 Error Handling & Recovery

#### Current Error Handling by Layer

```
JAVASCRIPT:
  ❌ Ad-hoc try/catch blocks
  ❌ No global error handler (Error Boundary)
  ❌ Toast/Modal for errors (sometimes, inconsistent)
  ❌ No automatic retry logic
  
  Example:
    try {
      const data = await fetch(...).then(r => r.json());
      this.render(data);  // What if render throws?
    } catch (e) {
      console.error(e);   // User never sees error!
    }

PHP:
  ✅ Global exception handler (helpers.php)
  ✅ Error codes included in response
  ✅ HTTP status codes correct (mostly)
  ❌ No logging to centralized system (only error_log)
  
  Example:
    set_exception_handler(function (Throwable $e): void {
      gq_api_handle_uncaught_throwable($e);
    });
    
    // Returns JSON with error code
    json_encode(['success' => false, 'error' => 'msg', 'code' => 'E_INTERNAL'])

PYTHON (TTS):
  ✅ Structured logging (structlog)
  ✅ Pydantic validation (prevents bad input)
  ❌ No circuit breaker (if TTS fails, requests queue up)
  ✅ Timeouts configured

DATABASE:
  ❌ No automatic rollback on error (developers must handle)
  ❌ No deadlock detection + retry
  ❌ Constraint violations → generic DB error
```

#### Error Recovery Mechanisms

| Scenario | Current Behavior | Recommended |
|----------|---|---|
| API timeout | Request hangs forever, user clicks again | Timeout + retry with exponential backoff |
| API 429 (rate limited) | Request fails, user not informed | Show "too many requests" message, queue for retry |
| DB constraint violation | Generic 500 error | Return specific error code: `E_DUPLICATE_COLONY_NAME` |
| Concurrent write conflict | Last write wins | Detect conflict, return 409 with merge strategy |
| Network offline | Requests fail silently | Queue mutations for sync when online |

---

## 4. MODULARITY ASSESSMENT

### Scoring Methodology

```
COHESION (1-10): Do related things stay together?
  10 = Perfect: module has single, clear purpose
   5 = Mixed: module handles 2-3 related concerns
   1 = Terrible: module handles unrelated things

COUPLING (1-10): Does module depend on others?
  10 = No dependencies (pure functions, utilities)
   5 = Medium: depends on 3-5 other modules
   1 = Terrible: depends on everything, circular dependencies

TESTABILITY (1-10): Can module be unit tested?
  10 = Yes: pure functions, injectable dependencies
   5 = Maybe: requires mocking some external services
   1 = No: requires full system setup, DB, API

REUSABILITY (1-10): Can module be used in other projects?
  10 = Yes: no GalaxyQuest-specific logic
   5 = Maybe: small refactor needed
   1 = No: tightly coupled to game logic

MAINTAINABILITY (1-10): How easy to understand + modify?
  10 = Clear code, good docs, obvious intent
   5 = Moderate: need to understand context
   1 = Terrible: undocumented, obscure logic
```

### Frontend Scores

#### HTML Layer: **6.0/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 7 | Good semantic structure, but mixes template rendering with business logic |
| Coupling | 4 | Tightly coupled to CSS files, PHP template renderer, JS via data-* attributes |
| Testability | 6 | Can test DOM structure, but hard to test without full environment |
| Reusability | 7 | HTML structure could be used for other games, but faction-specific |
| Maintainability | 6 | Well-organized sections, but no style guide or component system |

#### CSS Layer: **3.8/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 4 | Design tokens defined, but many scattered styles in multiple files |
| Coupling | 7 | Highly coupled: inline styles, hardcoded colors, no clear dependencies |
| Testability | 3 | No CSS testing framework, hard to verify visual consistency |
| Reusability | 2 | CSS too specific to GalaxyQuest (faction colors, game-specific layouts) |
| Maintainability | 3 | No single source of truth for colors/spacing, historic styles unmaintained |

#### JavaScript Frontend: **3.6/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 3 | 300+ files, unclear module boundaries, mixed concerns (UI + logic + rendering) |
| Coupling | 8 | Very high: components directly call APIs, no abstraction layer, hardcoded dependencies |
| Testability | 2 | Hard to unit test: requires DOM, EventBus setup, API mocking, renderer context |
| Reusability | 2 | Tightly coupled to game logic, would require major refactor for other projects |
| Maintainability | 3 | Large codebase, no clear patterns, hard to find where things are defined |

---

### Backend Scores

#### PHP API Layer: **4.4/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 4 | 70 files, each handles multiple actions (low cohesion within files) |
| Coupling | 8 | HTTP handlers + business logic + DB access = high coupling |
| Testability | 3 | Requires full app setup, DB, auth, mocking is complex |
| Reusability | 3 | Business logic buried in HTTP handlers, hard to extract for other uses |
| Maintainability | 4 | Action-based dispatch hard to follow, no clear architecture |

#### Python TTS Service: **7.2/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 8 | Clear separation: config → models → service → engines |
| Coupling | 5 | Depends on FastAPI, pydantic, external TTS engines (reasonable) |
| Testability | 7 | Good: can mock engines, test endpoints with test client |
| Reusability | 8 | Could be used in other projects, minimal GalaxyQuest coupling |
| Maintainability | 8 | Well-structured, good patterns, easy to understand |

#### Database Layer: **5.0/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 6 | Schema organized by feature (game, economy, military), but tables sometimes spread |
| Coupling | 5 | Foreign keys connect tables, but enforcement is loose |
| Testability | 4 | Requires full DB setup for integration tests |
| Reusability | 5 | Generic game tables, but projection tables are GalaxyQuest-specific |
| Maintainability | 5 | 70 migrations hard to follow, no schema documentation |

---

### Cross-Layer Scores

#### Data Flow: **3.2/10**

| Metric | Score | Comment |
|--------|-------|---------|
| Cohesion | 2 | No unified data flow, fragmented (localStorage + session + DB) |
| Coupling | 9 | Everything coupled to everything: frontend→API→DB + caching layers |
| Testability | 2 | Hard to test end-to-end, many moving parts |
| Reusability | 1 | Specific to GalaxyQuest, would need complete redesign for other projects |
| Maintainability | 2 | Hard to follow data flow, many edge cases, silent failures |

---

## 5. SOC VIOLATIONS CATALOG

### Critical Violations (🔴 P1)

1. **JavaScript Monolith**
   - File: `js/**/*.js` (300+ files)
   - Problem: No clear separation between UI layer, business logic, rendering, networking
   - Example: `ColonyOverviewPanel` component does: API calls + data transformation + DOM manipulation
   - Fix: Separate into `ColonyAPI` (network), `ColonyModel` (business logic), `ColonyUI` (rendering)

2. **API Action-Based Routing**
   - File: `api/game.php`, `api/fleet.php`, etc.
   - Problem: All business logic in one file, no separation of concerns
   - Example: `game.php` handles overview, resources, rename, all in one file
   - Fix: Migrate to RESTful structure: `/api/v2/colonies/{id}` with separate handlers

3. **State Management Chaos**
   - Files: `index.html`, `js/network/auth.js`, `api/game.php`, many others
   - Problem: State lives in localStorage, sessionStorage, $_SESSION, window globals, DB projections
   - Example: Player ID in localStorage (security risk), no synchronization mechanism
   - Fix: Implement `StateManager` with clear ownership (frontend memory OR backend session, not both)

4. **Error Handling Asymmetry**
   - Files: `js/**/*.js`, `api/helpers.php`, `tts_service/main.py`
   - Problem: JS errors silently disappear, PHP has global handler, Python has structured logging
   - Example: Fetch fails with 401, JS ignores it, UI shows stale data
   - Fix: Implement unified error boundary pattern across all layers

5. **Database Migrations Without Versioning**
   - File: `sql/migrate_*.sql` (70+ files)
   - Problem: No central migration registry, idempotency not guaranteed
   - Example: If migration V1 creates table, and V2 doesn't create IF NOT EXISTS, V2 fails on replay
   - Fix: Use proper migration framework (Alembic, Flyway) with checksums

---

### Major Violations (🟠 P2)

6. **CSS Not Component-Based**
   - Files: `css/*.css` (12 files)
   - Problem: Styles scattered across files, no clear ownership
   - Example: NPC dialog styles in both `npc_dialogue_panel.css` and inline `<style>` tags
   - Fix: Migrate to CSS Modules or Styled Components

7. **No Input Validation Layer**
   - Files: All API files, JS components
   - Problem: Validation duplicated (manual in PHP, minimal in JS)
   - Example: `$cid = (int)($_GET['colony_id'] ?? 0)` vs pydantic model in Python
   - Fix: Create Validator class (PHP) with same schema as frontend

8. **Cache Invalidation Manual & Inconsistent**
   - Files: `api/cache.php`, `api/cache_invalidation.php`, many endpoints
   - Problem: Each endpoint manually invalidates cache, easy to miss
   - Example: Update colony building, but forget to invalidate building list cache
   - Fix: Implement automatic cache invalidation via mutation events

9. **No Request Tracing**
   - Files: All API files, `js/**/*.js`
   - Problem: Hard to debug cross-layer issues
   - Example: User reports broken build, no way to trace request → API → DB without log hunting
   - Fix: Add distributed tracing (X-Request-ID header, correlation logging)

10. **Projection Cache Eventual Consistency**
    - Files: `api/projection.php`, various endpoints
    - Problem: Materialized views updated async, can serve stale data
    - Example: Player A builds colony, Player B sees it 5 seconds later
    - Fix: Use write-through cache or event-driven invalidation

---

### Minor Violations (🟡 P3)

11. **No Dependency Injection Framework**
12. **Hard to Mock External Services**
13. **No API Documentation (OpenAPI/Swagger)**
14. **No Type Hints in PHP** (where reusable)
15. **Circular Dependencies Possible**

---

## 6. QUICK WINS

### Win #1: CSS Token Consolidation (2-4 hours)

**Problem:** 12 CSS files, each defining styles independently, hardcoded colors everywhere.

**Action:**
1. Move all standalone styles from feature files into `design-tokens.css`
2. Create BEM-based class naming: `.panel__header`, `.panel__content`
3. Verify all color usages via grep: Search for `#[0-9a-f]{6}`, replace with token variable
4. Remove inline `<style>` tags from components

**Before:**
```css
/* style.css */
.game-guide-panel { background: rgba(15, 25, 45, 0.95); border: 2px solid #4fbf73; }

/* npc_dialogue_panel.css */
.dialogue-panel { background: #0d1b2e; border: 1px solid #2a6496; }

/* index.html */
<style>
  #game-guide-panel { background: linear-gradient(135deg, rgba(15, 25, 45, 0.95) 0%, ...); }
</style>
```

**After:**
```css
/* design-tokens.css */
:root {
  --panel-bg: rgba(15, 25, 45, 0.95);
  --panel-border: 2px solid var(--accent-green);
  --panel-gradient: linear-gradient(135deg, var(--bg-deep) 0%, var(--bg-panel) 100%);
}

/* component.css */
.panel { background: var(--panel-bg); border: var(--panel-border); }
.panel--game-guide { background: var(--panel-gradient); }
```

**Impact:** 30-40% reduction in CSS duplication, easier maintenance.

---

### Win #2: API Response Standardization (3-6 hours)

**Problem:** Inconsistent response formats across endpoints.

**Action:**
1. Create `ApiResponse` helper class:
   ```php
   class ApiResponse {
     public static function success($data, $meta = []) {
       return json_encode(['success' => true, 'data' => $data, 'meta' => $meta]);
     }
     public static function error($code, $message, $details = []) {
       return json_encode(['success' => false, 'error' => compact('code', 'message', 'details')]);
     }
   }
   ```

2. Replace all `json_ok($data)` calls with `ApiResponse::success($data)`
3. Replace all error responses with `ApiResponse::error('E_CODE', 'message')`
4. Add automated test to verify consistency

**Impact:** Simpler JS error handling, clearer error codes for debugging.

---

### Win #3: Session Timeout Detection (2-3 hours)

**Problem:** Session expires, UI keeps running with stale data.

**Action:**
1. Add heartbeat endpoint: `GET /api/health/heartbeat` (returns 200 if auth valid, 401 if expired)
2. Poll every 5 minutes from JS
3. On 401, show modal: "Session expired. Reload page?"
4. Optional: Auto-reload with redirect to login

**Before:**
```javascript
// API call silently fails, user doesn't know
fetch('/api/game.php?action=overview')
  .then(r => r.json())
  .then(data => { /* never called if 401 */ });
```

**After:**
```javascript
// Heartbeat detects expiry
setInterval(async () => {
  const health = await fetch('/api/health/heartbeat');
  if (!health.ok) {
    showModal('Session expired. Reload?', () => location.reload());
  }
}, 5 * 60 * 1000);
```

**Impact:** Better UX, fewer "game is frozen" support tickets.

---

### Win #4: State Management Clarity (4-8 hours)

**Problem:** State scattered across localStorage, session, memory, DB.

**Action:**
1. Create `StateManager` class:
   ```javascript
   class StateManager {
     constructor() {
       this.memory = {};      // Runtime state
       this.version = 2;      // Schema version
     }
     
     restore() {
       const saved = localStorage.getItem('gq:state');
       if (!saved) return;
       const { version, data } = JSON.parse(saved);
       if (version !== this.version) {
         // Run migrations
         data = this.migrate(data, version, this.version);
       }
       this.memory = data;
     }
     
     save() {
       localStorage.setItem('gq:state', JSON.stringify({
         version: this.version,
         data: this.memory
       }));
     }
   }
   ```

2. Clear rule: Frontend manages UI state (positions, themes), backend manages game state (colonies, resources)
3. Remove player_id from localStorage (use session)

**Impact:** Cleaner state flow, easier debugging.

---

### Win #5: Error Boundary UI (3-4 hours)

**Problem:** Errors silently crash components or entire game.

**Action:**
1. Create error boundary class:
   ```javascript
   class ErrorBoundary {
     constructor(handler) {
       window.addEventListener('error', (e) => {
         console.error('[ErrorBoundary] caught:', e);
         handler(e);
       });
     }
   }
   
   const boundary = new ErrorBoundary((error) => {
     showModal(`Error: ${error.message}`, [
       { text: 'Reload Game', onClick: () => location.reload() },
       { text: 'Send Report', onClick: () => sendErrorReport(error) }
     ]);
   });
   ```

2. Wrap all top-level event handlers in try/catch

**Impact:** Users see errors instead of blank screen, easier debugging.

---

## 7. REFACTORING ROADMAP

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Establish clear layers and patterns

- [ ] **API v2 Structure**
  - Create `/api/v2/` directory with new routing
  - Migrate 5 endpoints to REST: `/api/v2/colonies/`, `/api/v2/fleets/`, etc.
  - Create `ApiResponse` and `Validator` helpers
  - Add integration tests for consistency

- [ ] **CSS Design System**
  - Move all styles to `design-tokens.css`
  - Create `.css` modules for each component (BEM naming)
  - Remove inline `<style>` tags
  - Add CSS linter (stylelint)

- [ ] **Python Service Patterns**
  - Extract TTS service pattern into reusable `BaseService` class
  - Create test framework for other Python services
  - Document patterns in ADR

**Effort:** 60-80 engineer-hours  
**Risk:** Medium (API v2 is additive, no breaking changes yet)  
**Benefit:** Foundation for further refactoring

---

### Phase 2: State & Boot (Weeks 3-4)

**Goal:** Clean state management and boot sequence

- [ ] **StateManager Implementation**
  - Create `StateManager` with versioning
  - Implement restore logic in boot sequence
  - Remove scattered localStorage calls
  - Add tests for state migration

- [ ] **Boot Sequence Documentation**
  - Create flowchart: HTML → Auth → Boot → Hydration → Game
  - Document each stage's responsibilities
  - Add logging/tracing points

- [ ] **Session & Auth Cleanup**
  - Implement CSRF token refresh
  - Add session timeout detection
  - Implement logout everywhere

**Effort:** 50-70 engineer-hours  
**Risk:** Medium (changes auth flow, needs careful testing)  
**Benefit:** Better UX, fewer hidden bugs

---

### Phase 3: JavaScript Modularity (Weeks 5-8)

**Goal:** Separate concerns in JS layer

- [ ] **API Abstraction Layer**
  - Create `GameAPI`, `FleetAPI`, etc. services
  - All network calls go through services (not direct fetch in components)
  - Implement automatic error handling + retry in service layer

- [ ] **Component Refactor**
  - Separate UI components from business logic
  - Create smart (container) vs dumb (presentational) components
  - Add dependency injection pattern

- [ ] **Testing Framework**
  - Add unit test framework (Vitest)
  - Create mock API layer for tests
  - Aim for 40% coverage (happy path + error cases)

**Effort:** 120-160 engineer-hours  
**Risk:** High (large refactor, many files affected)  
**Benefit:** Huge improvement in testability, maintainability

---

### Phase 4: Backend Refactoring (Weeks 9-12)

**Goal:** Layer separation in PHP

- [ ] **Service Layer**
  - Create `GameService`, `FleetService`, etc.
  - Move business logic from HTTP handlers to services
  - Services return domain objects (not arrays)

- [ ] **Repository Pattern**
  - Create `ColonyRepository`, `FleetRepository`, etc.
  - All DB access through repositories
  - Repositories handle transactions, caching

- [ ] **Request/Response Contracts**
  - Define strict DTO classes for each endpoint
  - Add validation at route level
  - Generate OpenAPI schema from contracts

**Effort:** 100-150 engineer-hours  
**Risk:** High (affects all endpoints)  
**Benefit:** More testable, better error messages, clearer contracts

---

### Phase 5: Cross-Layer Integration (Weeks 13-14)

**Goal:** Coherent system with clear boundaries

- [ ] **Request Tracing**
  - Add X-Request-ID to all requests
  - Correlate logs across layers
  - Create dashboard for request debugging

- [ ] **Monitoring & Alerting**
  - Add performance monitoring (Sentry)
  - Alert on error spikes, slow requests
  - Create runbook for common issues

- [ ] **Documentation & Examples**
  - Document API contracts (OpenAPI)
  - Create architecture decision records (ADRs)
  - Build code examples for common patterns

**Effort:** 40-60 engineer-hours  
**Risk:** Low (additive, no breaking changes)  
**Benefit:** Better observability, easier debugging

---

## 8. DEPENDENCIES & RECOMMENDATIONS

### Recommended Tools & Libraries

| Tool | Purpose | Why |
|------|---------|-----|
| **Webpack/Vite** | JS bundler | Tree-shake unused code, split bundles by feature |
| **Vitest** | JS testing | Fast, modular tests, great DX |
| **Playwright** | E2E testing | Test full flow, catch integration bugs |
| **PHPStan** | PHP static analysis | Catch type errors, undefined variables |
| **Psalm** | PHP static analysis | Find type mismatches, dead code |
| **Phinx** | PHP migrations | Professional migration management |
| **OpenAPI/Swagger** | API documentation | Auto-generate docs, client SDK |
| **Docker Compose** | Local development | Reproduce prod environment locally |
| **Sentry** | Error tracking | Catch production errors, track trends |

### Architecture Decision Records (ADRs) to Write

1. **ADR-001: API Versioning Strategy** (REST v2 design)
2. **ADR-002: State Management Model** (Frontend vs Backend ownership)
3. **ADR-003: Error Handling Pattern** (Unified error boundary)
4. **ADR-004: Service Layer Architecture** (DI pattern, repositories)
5. **ADR-005: Database Migration Strategy** (Versioning, idempotency)

---

## 9. CONCLUSION

### Summary

GalaxyQuest is an **ambitious, high-complexity game engineering project** with:

- ✅ **Strengths:** Good design tokens, EventBus pattern, Python service patterns, structured PHP error handling
- ❌ **Weaknesses:** Monolithic JS, action-based API routing, scattered state management, inconsistent error handling

### Overall SOC Score: **4.6/10** (Below Average)

**Meaning:** The architecture has **significant technical debt** and **low modularity**. Large changes are risky, testing is hard, onboarding new engineers is difficult.

### Priority Ranking

| Action | Impact | Effort | Priority |
|--------|--------|--------|----------|
| API v2 Standardization | High | High | 🔴 P1 |
| State Manager | High | Medium | 🔴 P1 |
| Error Boundaries | Medium | Low | 🟠 P2 |
| JS API Abstraction | High | High | 🟠 P2 |
| CSS Modularization | Medium | Medium | 🟡 P3 |

### Final Recommendation

**Start with Phase 1 (CSS + API v2 foundation).** This establishes patterns and builds confidence without breaking existing functionality. Then move to state management (Phase 2) and JS refactoring (Phase 3).

**Estimated timeline:** 30-40 weeks (teams of 3-4 engineers), with continuous delivery of working features.

---

**Report End**

*Generated: 2026-08-01 — Next audit recommended in 6 months or after Phase 2 completion*
