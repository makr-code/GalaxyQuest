# GalaxyQuest — Architecture

> A technical reference for contributors and maintainers.  
> For the high-level "what", see [README.md](../../README.md).  
> For the "what's next", see [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md).  
> For the game engine specifically, see [webgpu_architecture.md](webgpu_architecture.md).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Request Lifecycle & Data Flow](#2-request-lifecycle--data-flow)
   - 2.1 [Request Lifecycle](#21-request-lifecycle)
   - 2.2 [Data Flow](#22-data-flow)
   - 2.3 [Gameflow: Tick-Based vs. Event-Driven](#23-gameflow-tick-based-vs-event-driven)
3. [Directory & Module Map](#3-directory--module-map)
4. [Backend Architecture](#4-backend-architecture)
   - 4.1 [Entry Points & Routing](#41-entry-points--routing)
   - 4.2 [Authentication & Session](#42-authentication--session)
   - 4.3 [Database Layer](#43-database-layer)
   - 4.4 [Game Engine (`game_engine.php`)](#44-game-engine-game_enginephp)
   - 4.5 [Tick-free Resource Model](#45-tick-free-resource-model)
   - 4.6 [Galaxy Generator (`galaxy_gen.php`)](#46-galaxy-generator-galaxy_genphp)
   - 4.7 [Fleet & Mission System](#47-fleet--mission-system)
   - 4.8 [NPC AI Architecture](#48-npc-ai-architecture)
   - 4.9 [Leader AI (`leaders.php`)](#49-leader-ai-leadersphp)
   - 4.10 [LLM Integration](#410-llm-integration)
   - 4.11 [FTL Drive System](#411-ftl-drive-system)
   - 4.12 [Politics & Empire Profile](#412-politics--empire-profile)
   - 4.13 [Alliance System](#413-alliance-system)
   - 4.14 [Projection Runtime](#414-projection-runtime)
   - 4.15 [TOTP / 2FA](#415-totp--2fa)
   - 4.16 [RBAC](#416-rbac)
5. [Frontend Architecture](#5-frontend-architecture)
   - 5.1 [Entry Point & Boot Loader](#51-entry-point--boot-loader)
   - 5.2 [Window Manager (`wm.js`)](#52-window-manager-wmjs)
   - 5.3 [API Client (`api.js`)](#53-api-client-apijs)
   - 5.4 [Game Controller (`game.js`)](#54-game-controller-gamejs)
   - 5.5 [GQUI DOM Builder (`gq-ui.js`)](#55-gqui-dom-builder-gq-uijs)
   - 5.6 [Galaxy Renderer](#56-galaxy-renderer)
   - 5.7 [TTS & Audio System](#57-tts--audio-system)
6. [WebGPU Game Engine](#6-webgpu-game-engine)
   - 6.1 [GameEngine & GameLoop](#61-gameengine--gameloop)
   - 6.2 [Renderer Abstraction](#62-renderer-abstraction)
   - 6.3 [Scene Graph](#63-scene-graph)
   - 6.4 [Post-Processing Pipeline](#64-post-processing-pipeline)
   - 6.5 [FX System](#65-fx-system)
   - 6.6 [Game Systems (JS)](#66-game-systems-js)
   - 6.7 [ViewportManager & PiP](#67-viewportmanager--pip)
   - 6.8 [SeamlessZoom System](#68-seamlesszoom-system)
7. [Database Schema](#7-database-schema)
   - 7.1 [Entity Relationships](#71-entity-relationships)
   - 7.2 [Table Reference](#72-table-reference)
   - 7.3 [Conventions](#73-conventions)
8. [Security Model](#8-security-model)
9. [Configuration Reference](#9-configuration-reference)
10. [Testing Infrastructure](#10-testing-infrastructure)
11. [Extension Points](#11-extension-points)

---

## 1. System Overview

```
Browser
  │  HTTP (JSON REST over PHP sessions)
  │  Binary galaxy data (compressed)
  ▼
┌────────────────────────────────────────┐
│  Apache / Nginx / PHP built-in server  │
│  (document root = project root)        │
└────────────────┬───────────────────────┘
                 │
        ┌────────▼──────────────┐
        │  index.html           │  unified auth + game shell
        │  js/runtime/boot-loader.js  – bundle loader
        └────────┬──────────────┘
                 │ fetch() JSON calls + binary (gzip)
        ┌────────▼─────────────────────────────────────────────┐
        │  api/*.php  (one file per domain)                     │
        │                                                       │
        │  helpers.php    ──► session, CSRF, JSON utils         │
        │  config/db.php  ──► PDO singleton                     │
        │  game_engine.php──► formulas & constants              │
        │  lib/projection_runtime.php ──► async projection queue│
        └───────────────────────────────┬───────────────────────┘
                                        │ PDO
                                ┌───────▼──────┐
                                │  MySQL 8.0+  │
                                │  (~70 tables)│
                                └──────────────┘
                                        │
                               ┌────────▼──────────┐
                               │  scripts/          │
                               │  Projection workers│
                               │  (CLI PHP, cron)   │
                               └────────────────────┘
```

There is **no application framework**, no ORM, and no message queue. The core game loop
is pull-based and computed on demand. Background processing uses a lightweight projection
queue in the database (see [§4.14](#414-projection-runtime)).

---

## 2. Request Lifecycle & Data Flow

### 2.1 Request Lifecycle

```
1. Browser sends  GET /api/game.php?action=overview
   + Cookie: PHPSESSID=...
   + Header: X-CSRF-Token: <token>    (POST requests only)

2. PHP receives request
   ├─ helpers.php: session_start_secure() — enforces session lifetime
   ├─ helpers.php: require_auth()        — reads $_SESSION['user_id'], 401 if missing
   └─ helpers.php: verify_csrf()         — validates token on POST/PUT/DELETE

3. api/game.php switch($action):
   ├─ update_all_colonies($db, $uid)     — lazy resource tick for all colonies
   ├─ npc_ai_tick($db, $uid)             — NPC faction tick (rate-limited 5 min)
   ├─ SELECT colonies + planets JOIN     — fetch fresh colony state
   ├─ SELECT fleets                      — check_arrivals() resolves overdue fleets
   └─ json_ok([...])                     — sends {"success":true, ...} with 200

4. Browser receives JSON
   └─ game.js: stores in window._GQ_*, updates resource bar, re-renders open windows
```

Every API endpoint returns either:
- `{"success": true, ...extra fields}` with HTTP 200
- `{"success": false, "error": "message"}` with HTTP 4xx/5xx

---

### 2.2 Data Flow

GalaxyQuest uses three distinct data channels between browser and server.

#### A. JSON REST — overview & mutations

The core game state travels as JSON via synchronous `fetch()` calls. `loadOverview()`
is the heartbeat of the game UI — called on page load, after every mutation, and on a
**60-second polling interval**:

```
game.js: loadOverview()
  ─► GET /api/game.php?action=overview
       │
       ├─ update_all_colonies()   — lazy resource catch-up for all user colonies
       ├─ npc_ai_tick()           — NPC faction behaviour (rate-limited ≤5 min)
       ├─ check_arrivals()        — resolves all overdue fleets
       └─ JSON response: { colonies[], fleets[], meta{} }
       │
  ◄── game.js stores in window._GQ_* globals
       └─ re-renders all open WM windows via WM.refresh()
```

There is no WebSocket or push mechanism for the main game state — the polling model
keeps the PHP backend fully stateless between requests.

#### B. Binary Galaxy Data — star map bootstrap

Galaxy star data is delivered as a gzip-compressed binary stream, decoded
client-side, and cached in IndexedDB for subsequent sessions:

```
game.js: loadGalaxyStars3D()
  │
  ├─ 1. Check IndexedDB cache (binary-decoder-v3 range key)
  │       Hit  ──► decode instantly + apply to renderer
  │       Miss ──►
  │
  ├─ 2. GET /api/galaxy.php?action=bootstrap  (gzip binary)
  │       └─ binary-decoder-v3.js decodes delta-encoded star records
  │
  └─ 3. Persist decoded records to IndexedDB for next session
```

Binary protocol versions:

| Version | Server endpoint | Client decoder | Notes |
|---|---|---|---|
| V1 | `api/compression.php` | `js/network/binary-decoder.js` | Full snapshot |
| V2 | `api/compression-v2.php` | `js/network/binary-decoder-v2.js` | Structured binary |
| V3 | `api/compression-v3.php` | `js/network/binary-decoder-v3.js` | Delta-encoded; current default |

See [DELTA_ENCODING_V3.md](DELTA_ENCODING_V3.md) and [BINARY_ENCODING_V2.md](BINARY_ENCODING_V2.md).

#### C. SSE — spoken fleet alerts

A `Server-Sent Events` connection (`EventSource`) delivers real-time spoken alerts
for fleet events. The TTS service converts text to MP3 on demand:

```
game.js: initSSE()
  ─► EventSource /api/sse.php
       │
       ├─ fleet_arrived   ──► GQTTS.speak("Fleet arrived at …")
       ├─ fleet_returning ──► GQTTS.speak("Fleet returning …")
       └─ incoming_attack ──► GQTTS.speak("Incoming attack …")
                               └─ GQAudioManager plays on TTS channel
```

SSE is used **exclusively** for real-time TTS notifications. All other state
synchronisation uses polling. See [§5.7](#57-tts--audio-system) and
[TTS_SYSTEM_DESIGN.md](TTS_SYSTEM_DESIGN.md).

---

### 2.3 Gameflow: Tick-Based vs. Event-Driven

GalaxyQuest combines two fundamentally different timing models that operate at
different layers of the stack.

#### Backend — lazy resource model + rate-limited AI ticks

| Layer | Model | Trigger | Implementation |
|---|---|---|---|
| Colony resources | **Lazy / tick-free** | Every API read | `update_colony_resources()` in `game_engine.php` |
| Fleet arrivals | **Lazy** | Every `fleet.php?action=list` | `process_fleet_arrivals()` |
| NPC faction AI | **Rate-limited tick** | ≤5 min per user | `npc_ai_tick()` in `npc_ai.php` |
| NPC player accounts | **Rate-limited tick** | ≤3 min globally | `npc_player_accounts_tick_global()` |
| Faction / colony events | **Rate-limited tick** | Inside NPC tick | `faction_events_tick_global()`, `colony_events_tick_global()` |
| Wormhole maintenance | **Rate-limited tick** | Inside NPC tick | `wormhole_regeneration_tick_global()` |
| Leader AI | **On-demand** | Player-triggered | `POST /api/leaders.php?action=ai_tick` |
| Background projections | **Worker / cron** | CLI batch | `scripts/project_*.php` via projection queue |

Key insight: **there is no server-side cron job for resource advancement.** Resources
accumulate passively and are computed lazily on first read. NPC AI ticks are
piggy-backed onto active player traffic — avoiding idle-server load entirely.

#### Frontend UI — event-driven with polling heartbeat

```
User action  ──►  API.someCall()  ──►  PHP endpoint
                                         │
                               ◄── JSON response
                                         │
                              game.js calls loadOverview()
                                         │
                              Re-renders all open WM windows
```

The UI is **purely event-driven**: every mutation immediately calls `loadOverview()`
to refresh authoritative server state. A 60-second `setInterval` keeps the resource
bar current even when the player is idle.

#### Frontend Engine — fixed-step physics loop + EventBus

The WebGPU engine uses a classic **fixed-step accumulator** (Glenn Fiedler pattern):

```
GameLoop (RAF)
  ├── onFixedUpdate(dt=1/60 s) ──► PhysicsEngine.step()          [60 Hz physics]
  │                             ──► SystemRegistry [PHYSICS prio=100]
  ├── onUpdate(dt, alpha)       ──► SystemRegistry [non-physics]
  └── onRender(alpha)           ──► SceneGraph → Renderer → EffectComposer
```

- Physics runs at a constant 60 Hz regardless of render frame rate.
- `alpha` (interpolation factor 0–1) is passed to the render step for smooth motion.
- `maxDt = 0.25 s` clamps spiral-of-death when the tab is backgrounded.

Decoupled subsystem communication uses the **EventBus** (synchronous pub/sub):

```javascript
engine.events.on('physics:step', ({ dt }) => { /* handler */ });
engine.events.emit('render:frame', { alpha });
```

The **SystemRegistry** executes all registered systems each frame in priority order:

| Priority | Slot | Purpose |
|---|---|---|
| 0 | INPUT | Input handling |
| 100 | PHYSICS | PhysicsEngine, collision |
| 200 | AI | NPC behaviour, combat AI |
| 300 | ANIMATION | Tweens, skeletal animation |
| 400 | CAMERA | Follow-camera, CameraFlightPath |
| 500 | SCENE | SceneGraph update |
| 600 | RENDER | Renderer |
| 700 | POSTFX | Post-processing, UI overlays |
| 900 | CLEANUP | Deferred destroy |

**Summary**: backend is lazy/tick-free for resources and rate-limited for AI;
frontend UI is event-driven with a polling heartbeat; rendering engine is
fixed-step tick-based with event-driven subsystem communication via EventBus.

---

## 3. Directory & Module Map

```
/
├── index.html                 Unified shell (auth + game sections)
│
├── config/
│   ├── config.php             Global constants (DB creds, game parameters)
│   ├── db.php                 PDO singleton factory
│   ├── llm_profiles.yaml      LLM prompt profiles (authoring)
│   └── llm_profiles.json      LLM prompt profiles (runtime)
│
├── css/
│   └── style.css              ~900 lines; CSS custom properties for theming;
│                              windows, resource bars, faction cards, battle log
│
├── js/
│   ├── legacy/                Deprecated modules (galaxy3d.js, engine-compat.js)
│   ├── network/               API client, binary decoders, auth background
│   │   ├── api.js             Thin fetch wrapper with concurrency management
│   │   ├── api-contracts.js   DTO contract validators
│   │   ├── binary-decoder.js  V1 binary galaxy data decoder
│   │   ├── binary-decoder-v2.js  V2 binary protocol decoder
│   │   └── binary-decoder-v3.js  V3 delta-encoded binary decoder
│   ├── rendering/             Galaxy 3D rendering layer
│   │   ├── galaxy-renderer-core.js    Main renderer (Three.js + WebGPU overlay)
│   │   ├── galaxy-renderer-events.js  Event bindings for renderer
│   │   ├── galaxy-renderer-config.js  Renderer configuration
│   │   ├── galaxy-camera-controller.js  Camera control
│   │   ├── material-factory.js        Material creation
│   │   ├── geometry-manager.js        Geometry management
│   │   ├── texture-manager.js         Texture management
│   │   ├── light-rig-manager.js       Lighting setup
│   │   ├── post-effects.js            Post-processing integration
│   │   ├── starfield-webgpu.js        WebGPU starfield renderer
│   │   └── planet-textures.js         Procedural planet textures
│   ├── runtime/               Core game runtime (legacy position)
│   │   ├── game.js            Main game UI controller
│   │   ├── wm.js              Floating window manager
│   │   ├── audio.js           Audio engine
│   │   ├── galaxy-model.js    Galaxy data model
│   │   ├── galaxy-db.js       Galaxy data access layer
│   │   ├── model_registry.js  Client-side model registry
│   │   └── boot-loader.js     Bundle loader
│   ├── telemetry/             Performance monitoring and telemetry
│   │   ├── space-physics-engine.js      CPU physics engine
│   │   ├── trajectory-planner.js        Fleet trajectory planning
│   │   ├── space-flight-hud-engine.js   HUD for flight mode
│   │   ├── space-camera-flight-driver.js Flight camera driver
│   │   ├── space-flight-telemetry-schema.js  Telemetry schema
│   │   └── performance-budget.js        Client-side perf budget
│   ├── ui/                    UI components
│   │   ├── gq-ui.js           GQUI fluent DOM builder
│   │   ├── glossary.js        Scientific glossary UI
│   │   ├── settings-panel.js  Settings panel
│   │   ├── settings-2fa.js    2FA configuration UI
│   │   ├── terminal.js        Debug terminal
│   │   ├── hr-diagram.js      HR diagram visualisation
│   │   ├── star-tooltip.js    Star tooltip overlay
│   │   ├── system-info-panel.js  System information panel
│   │   ├── ui-kit.js          Reusable UI components
│   │   └── admin-users.js     Admin user management UI
│   ├── engine/                WebGPU game engine (see §6)
│   │   ├── index.js           Engine main export
│   │   ├── GameEngine.js      Top-level engine coordinator
│   │   ├── GameLoop.js        RAF + fixed-step accumulator
│   │   ├── EventBus.js        Decoupled pub/sub events
│   │   ├── SystemRegistry.js  Ordered update pipeline
│   │   ├── AssetRegistry.js   Asset cache + preloading
│   │   ├── ViewportManager.js PiP viewport manager
│   │   ├── constants.js       Engine constants
│   │   ├── core/              Renderer core + abstraction
│   │   ├── webgpu/            WebGPU wrappers
│   │   ├── scene/             Scene graph, camera, geometry
│   │   ├── math/              Vector, Matrix, Quaternion, MathUtils
│   │   ├── loaders/           Asset loaders
│   │   ├── utils/             Performance monitor, resource tracker
│   │   ├── post-effects/      Post-processing pipeline
│   │   ├── fx/                Combat, environment, particle FX
│   │   └── game/              BattleSimulator, ColonySimulation, etc.
│   └── packages/              Pre-built bundles (game.boot.bundle.*.js.gz)
│
├── api/
│   ├── helpers.php            Foundation: session, auth guard, CSRF, JSON utils
│   ├── game_engine.php        Pure functions + constants
│   ├── planet_helper.php      ensure_planet() lazy insertion
│   ├── galaxy_gen.php         Deterministic star system generator
│   ├── galaxy_seed.php        Seeded RNG utilities
│   │
│   ├── auth.php               register / login / logout / me / csrf
│   ├── game.php               overview / resources / rename_colony / set_colony_type /
│   │                          set_ftl_drive / leaderboard / pvp_toggle
│   ├── buildings.php          list / upgrade / finish
│   ├── research.php           list / research / finish
│   ├── shipyard.php           list / build / vessel blueprints
│   ├── shipyard_queue.php     Vessel build queue management
│   ├── fleet.php              send / list / recall / FTL-related missions
│   ├── galaxy.php             system view / star_system cache / bootstrap
│   ├── factions.php           list / trade_offers / accept_trade / quests
│   ├── faction_relations.php  Faction species + relations data
│   ├── faction_validation.php Faction data validation
│   ├── leaders.php            list / hire / assign / autonomy / dismiss / ai_tick
│   ├── npc_ai.php             npc_ai_tick(), NPC FTL logic
│   ├── npc_controller.php     NPC PvE encounter controller
│   ├── npc_llm_controller.php NPC behaviour driven by LLM
│   ├── politics.php           catalog / presets / status / configure / apply_preset
│   ├── alliances.php          list / details / create / join / manage / diplomacy
│   ├── achievements.php       list / claim + check_and_update_achievements()
│   ├── messages.php           list / send / read / delete
│   ├── trade.php              Trade system endpoints
│   ├── events.php             Planetary/global event system
│   ├── situations.php         Situation and crisis system
│   ├── reports.php            Battle/spy report aggregation
│   ├── totp.php               TOTP 2FA management
│   ├── projection.php         Projection endpoint (triggers workers)
│   ├── glossary.php           Scientific glossary + LLM RAG definitions
│   ├── ollama.php             Ollama LLM proxy
│   ├── ollama_client.php      Ollama HTTP client
│   ├── llm.php                Central LLM gateway
│   ├── audio.php              Audio asset proxy
│   ├── cache.php              Server-side cache management
│   ├── admin_stats.php        Admin statistics dashboard
│   ├── admin_users.php        Admin user management
│   ├── perf_telemetry.php     Client performance telemetry collector
│   ├── compression.php        Compression V1 (gzip galaxy data)
│   ├── compression-v2.php     Binary encoding V2
│   ├── compression-v3.php     Binary encoding V3 (delta)
│   ├── model_gen.php          AI model generation proxy
│   ├── character_profile_generator.php  LLM-driven character profiles
│   └── llm_soc/               LLM Separation-of-Concerns modules
│       ├── PromptCatalogRepository.php  Prompt profile CRUD
│       ├── LlmPromptService.php         Prompt assembly + LLM dispatch
│       └── LlmRequestLogRepository.php  Request audit log
│
├── lib/
│   ├── projection_runtime.php  Shared projection queue runtime
│   └── template-renderer.php   PHP template rendering helpers
│
├── scripts/
│   └── project_user_overview.php  Projection worker: user overviews
│   └── project_system_snapshots.php  Projection worker: system snapshots
│
├── sql/
│   ├── schema.sql             Full schema for fresh install
│   ├── migrate_v2.sql         First schema migration
│   └── migrate_*.sql          ~30 subsequent migrations
│
└── tests/
    ├── Unit/                  PHPUnit unit tests (backend)
    ├── e2e/                   Playwright end-to-end tests
    ├── js/                    Vitest unit tests (frontend/engine)
    └── webgpu/                WebGPU-specific tests
```

---

## 4. Backend Architecture

### 4.1 Entry Points & Routing

Each `api/*.php` file is its own entry point. Routing within a file is done with a
`switch ($action)` or `match ($action)` block where `$action = $_GET['action'] ?? ''`.

- No central router — adding a new endpoint means adding a `case` to the right file.
- URLs are stable and human-readable: `api/fleet.php?action=send`.
- `require_once` shares code between entry points; no autoloader needed at this scale.

### 4.2 Authentication & Session

```php
// helpers.php
function require_auth(): int {
    session_start_secure();           // enforces SESSION_LIFETIME, SameSite=Lax
    $uid = current_user_id();
    if (!$uid) json_error('Unauthorised', 401);
    return $uid;
}
```

- **Sessions** are PHP native (`$_SESSION['user_id']`).
- **CSRF** tokens stored in `$_SESSION['csrf_token']`; validated via `X-CSRF-Token` header on every state-mutating request.
- **Passwords** use `password_hash(…, PASSWORD_BCRYPT)` / `password_verify`.
- **Remember-me** tokens stored in the `remember_tokens` table with expiry.
- **TOTP 2FA** is optional; see [§4.15](#415-totp--2fa).
- **Newbie protection** via `protection_until DATETIME` on `users`; attack missions check server-side.
- **Login throttling** via `login_attempts` table (see [§8](#8-security-model)).

### 4.3 Database Layer

```php
// config/db.php
function get_db(): PDO {
    static $pdo = null;          // one connection per PHP process (FPM worker)
    if ($pdo === null) { … }
    return $pdo;
}
```

- All queries use PDO prepared statements — no string interpolation of user input.
- `PDO::FETCH_ASSOC` everywhere.
- Dynamic column names validated against explicit allowlists before use in SQL.
- No ORM; SQL is written directly for full clarity.

### 4.4 Game Engine (`game_engine.php`)

`game_engine.php` is a **pure-function library** with no side effects, except for
`update_colony_resources()` which is the single allowed DB-writing function in this file.

Key function groups:

| Group | Functions |
|---|---|
| Resource production | `metal_production`, `crystal_production`, `deuterium_production`, `food_production`, `rare_earth_production` |
| Energy | `solar_energy`, `fusion_energy` |
| Population / welfare | `compute_happiness`, `compute_public_services`, `happiness_productivity`, `population_growth`, `habitat_capacity` |
| Storage | `storage_cap`, `food_storage_cap` |
| Build economics | `building_cost`, `building_build_time`, `research_cost`, `research_time`, `ship_cost` |
| Fleet / 3D physics | `fleet_speed_ly_h`, `fleet_3d_distance`, `fleet_travel_time_3d`, `fleet_current_position`, `get_system_3d_coords` |
| Leader bonuses | `leader_production_bonus`, `leader_build_time`, `leader_research_time`, `leader_fleet_speed`, `leader_combat_attack` |
| Colony tick | `update_colony_resources`, `update_all_colonies` |
| FTL speed | `ftl_adjusted_speed` (applies FTL drive type bonuses) |

All cost formulas follow:
```
cost(level) = base_cost × factor^(level − 1)
```

### 4.5 Tick-free Resource Model

There is **no cron job** and **no scheduled task** for resource production. Accumulation is
computed lazily on every read:

```php
function update_colony_resources(PDO $db, int $colonyId): void {
    // 1. Read colony row (building levels, last_update, deposits, welfare state)
    // 2. Compute deltaH = (now − last_update) in hours
    // 3. Compute per-hour production rates (richness × efficiency × happiness × leader bonus)
    // 4. Clamp by storage caps and remaining deposits
    // 5. Run food/population/happiness/public_services calculations
    // 6. Write new colony state + deplete planet deposits
}
```

This function is called at the start of every API action that touches a colony.
**Implication**: a colony that has not been visited for days will "catch up" instantly on next access. Storage caps prevent infinite accumulation.

### 4.6 Galaxy Generator (`galaxy_gen.php`)

The generator is **fully deterministic** and **stateless** — the same `(galaxyIdx, systemIdx)`
always produces the same output.

```
generate_star_system(galaxy, system)
  ├─ galactic_position()       → x,y,z in light-years (log-spiral arms)
  ├─ pick_spectral_type()      → O/B/A/F/G/K/M/WD/NS from Kroupa IMF + seeded RNG
  ├─ habitable_zone_au()       → [inner, outer] via Kopparapu 2013
  ├─ frost_line_au()           → 2.7 × √L_solar
  └─ generate_planets()
       ├─ log-normal semi-major axis distribution per slot
       ├─ Kepler period (T² ∝ a³/M)
       ├─ classify_planet()    → 9 classes from (a, T_eq, mass)
       ├─ atmosphere_type()    → 7 atmosphere types
       └─ derive_planet_deposits() → richness × 4 + deposits × 4 from planet class
```

Star system rows cached in `star_systems` on first access. Planet rows created lazily via
`ensure_planet()` in `planet_helper.php` — only when a fleet visits the coordinates.

**Seeded RNG** (`gen_rand(int ...$seeds)`): Uses `sin(sum_of_seeds) × large_prime` to get
a float in [0,1]. Not cryptographic, but deterministic with no shared state.

### 4.7 Fleet & Mission System

Fleet lifecycle:

```
send (api/fleet.php)
  │  validate mission, ships, coords, PvP flags, origin colony ownership
  │  compute 3D distance and travel time (FTL-adjusted speed)
  │  INSERT fleets row (origin/target x,y,z, ships_json, cargo_json, speed_ly_h, ftl_boost)
  │
  ▼
in-transit (stored in DB, resolved lazily)
  │
  ▼
process_fleet_arrivals() — called on every /api/fleet.php?action=list
  │  SELECT fleets WHERE arrival_time <= NOW() AND returning = 0
  │  handle_fleet_arrival() dispatches to mission resolver:
  │
  ├─ transport     → deliver_resources()    – move cargo to target colony
  ├─ attack        → resolve_battle()       – tech/skill combat, loot, casualties
  ├─ colonize      → colonize_planet()      – ensure_planet(), INSERT colony + buildings
  ├─ spy           → create_spy_report()    – full welfare/ship/leader report
  ├─ harvest       → harvest_resources()    – mine deposits up to cargo cap
  ├─ survey        → survey_for_ftl_gate()  – FTL gate site surveys (Syl'Nar drive)
  └─ ftl_jump      → ftl_jump_resolver()    – Vel'Ar snap-to-nearest-star jump
  │
  ▼
returning = 1, new arrival_time = now + travel_time
  │
  ▼
return_fleet_to_origin() on second arrival — deposit cargo, delete fleet row
```

3D position at any time:
```php
$progress = ($now − $departure) / $travelTimeSecs;   // 0.0 → 1.0
$pos = [
  'x' => $origin_x + ($target_x − $origin_x) * $progress,
  'y' => $origin_y + ($target_y − $origin_y) * $progress,
  'z' => $origin_z + ($target_z − $origin_z) * $progress,
];
```

### 4.8 NPC AI Architecture

The NPC AI is a multi-tier system combining fast rule-based decisions with optional
LLM-guided steering. All logic is triggered opportunistically by active player traffic
— no dedicated background process is required.

#### Tier 1 — Rule-Based Faction Tick (`npc_ai.php`)

`npc_ai_tick($db, $userId)` is called on every overview load, rate-limited to
**once per 5 minutes** per user via `users.last_npc_tick`.

```
npc_ai_tick($db, $userId)
  │
  ├─ foreach faction:
  │   ├─ [LLM path] npc_pve_llm_controller_try()     — if enabled + cooldown ready
  │   │     handled=true → skip rule path for this faction
  │   │
  │   ├─ trade_willingness ≥ 30  →  generate_trade_offer()  (if < 2 active offers)
  │   │     resource pairs: metal/crystal/deuterium/rare_earth/food
  │   │     faction-type preferences (trade/science/pirate/military)
  │   │
  │   └─ faction_type='pirate' AND aggression ≥ 70 AND standing < −20
  │       → maybe_pirate_raid()   steal ≤5% metal + ≤5% crystal, −3 standing
  │
  ├─ Diplomacy decay: standing ±1 toward faction.base_diplomacy per tick
  │     (only if |standing − base| > 5)
  │
  ├─ npc_player_accounts_tick_global()   — NPC user accounts (≤3 min cooldown)
  ├─ faction_events_tick_global()        — galactic war / trade boom / pirate surge
  ├─ colony_events_tick_global()         — solar flare / mineral vein / disease
  └─ wormhole_regeneration_tick_global() — stability regen + cooldown clear
```

#### Tier 2 — LLM-Guided PvE Controller (`npc_llm_controller.php`)

When `NPC_LLM_CONTROLLER_ENABLED=true`, each faction may receive an LLM-generated
decision before the rule-based path runs. The controller builds a player-state
snapshot, calls Ollama, parses JSON, checks confidence, and executes the action:

```
npc_pve_llm_controller_try($db, $userId, $faction)
  │
  ├─ Check cooldown (NPC_LLM_CONTROLLER_COOLDOWN_SECONDS, default ≥60 s)
  ├─ Build player snapshot (colonies, fleets, standing, recent events)
  ├─ Build prompt → ollama_generate(prompt, temperature=0.2, num_predict=220)
  │
  ├─ Parse JSON decision: { action, confidence, reasoning }
  │     Actions: 'offer_trade' | 'send_warning' | 'raid' | 'peace_offer' | 'none'
  │
  ├─ confidence < NPC_LLM_CONTROLLER_MIN_CONFIDENCE → skip execution, log only
  │
  ├─ Execute action (trade offer / in-game message / standing change)
  └─ Log to npc_llm_decision_log (action, confidence, standing delta, raw output)
```

If Ollama is unavailable or returns invalid JSON, the controller falls back
gracefully to the rule-based path.

#### Tier 3 — NPC Player Accounts (`npc_player_accounts_tick_global`)

NPC "player" accounts (`users.control_type = 'npc_engine'`) simulate competing
civilisations. Each account receives one build action, one research action, and one
ship action per global tick (≤3 min cooldown, stored in `app_state`):

```
npc_player_account_tick($db, $npcUserId)
  ├─ ensure_user_character_profile()   — LLM-generated personality (if missing)
  ├─ npc_assign_ftl_drive()            — assign faction FTL if still on default
  ├─ Finish due research
  ├─ Start cheapest affordable research (if none active)
  ├─ Upgrade cheapest affordable building (if none active)
  └─ Build ships to maintain a target fleet strength
```

NPC ships can be equipped with FTL drives (`npc_assign_ftl_drive()` — migration v12).

### 4.9 Leader AI (`leaders.php`)

```
run_ai_tick($db, $userId)  — triggered by POST /api/leaders.php?action=ai_tick
  │
  ├─ foreach leader WHERE autonomy ≥ 2:
  │   ├─ role = 'colony_manager'   → ai_colony_manager_tick()
  │   │     SELECT buildings ORDER BY level ASC; find cheapest affordable upgrade
  │   │     POST upgrade action; award leader 10 XP
  │   │
  │   └─ role = 'science_director' → ai_science_director_tick()
  │         check no active research; find cheapest affordable tech
  │         start research; award leader 10 XP
  │
  └─ leader_award_xp(): XP → level up at 100 XP × level threshold
```

Fleet commanders apply their skill passively (speed bonus in `fleet_speed_ly_h()`,
attack bonus in `resolve_battle()`).

### 4.10 LLM Integration

GalaxyQuest embeds a local LLM gateway via Ollama for several AI-driven features.

#### Use cases

| Feature | Endpoint | Notes |
|---|---|---|
| Scientific glossary | `GET /api/glossary.php?action=generate&term=…` | Ollama + Wikipedia RAG |
| Character profiles | `api/character_profile_generator.php` | Backstories for leaders and NPC users |
| NPC PvE decisions | `api/npc_llm_controller.php` | LLM-guided faction behaviour (see §4.8) |
| Leader marketplace | `api/llm.php` | AI-generated leader personalities |
| NPC chat sessions | `api/llm.php?action=chat_npc` | Per-faction dialogue with session history |
| Iron Fleet briefings | `api/llm.php?action=iron_fleet_compose` | Mini-faction prompt variable composition |

#### Separation-of-Concerns modules (`api/llm_soc/`)

| Module | Responsibility |
|---|---|
| `PromptCatalogRepository.php` | CRUD for prompt profiles in `llm_prompt_profiles` table; merges file + DB profiles |
| `LlmPromptService.php` | Prompt template rendering (`{{token}}` substitution), Ollama dispatch, response parsing |
| `LlmRequestLogRepository.php` | Audit log in `llm_request_log` table |
| `FactionSpecLoader.php` | Loads faction YAML specs (`fractions/<code>/spec.yaml`) for prompt variable injection |
| `NpcChatSessionRepository.php` | Stores/loads NPC chat sessions as JSON files in `generated/npc_chats/` |
| `IronFleetPromptVarsComposer.php` | Loads Iron Fleet mini-faction YAML specs → flat `{{token}}` vars for `LlmPromptService` |

#### NPC Chat Session system

Players can hold multi-turn conversations with faction NPCs. Sessions are persisted
as JSON files (`generated/npc_chats/u_{uid}/{faction_code}/{npc_slug}/session_{id}.json`)
and tracked in the `npc_chat_sessions` DB table.

```
POST /api/llm.php?action=chat_npc
  │  { faction_code, npc_slug, message }
  │
  ├─ FactionSpecLoader: load faction YAML → npc roster
  ├─ NpcChatSessionRepository: load or create session
  ├─ LlmPromptService: render system prompt + history + user message
  ├─ ollama_generate()
  └─ Append assistant reply to session file; return reply

POST /api/llm.php?action=close_npc_session
  └─ Generate LLM summary of the conversation; store in session JSON
```

Client API: `API.chatNpc(factionCode, npcSlug, message)` and
`API.closeNpcSession(factionCode, npcSlug)` in `js/network/api.js`.

#### Iron Fleet prompt composition

`IronFleetPromptVarsComposer` loads `fractions/iron_fleet/spec.json` and up to 6
mini-faction YAML files (`parade`, `pr`, `tech`, `clan`, `archive`, `shadow`),
then merges them into a flat `{{token}}` variable map consumed by `LlmPromptService`.

```
GET /api/llm.php?action=iron_fleet_vars       — return available token map
POST /api/llm.php?action=iron_fleet_compose   — render full briefing prompt
```

#### Configuration

Prompt profiles are defined in `config/llm_profiles.yaml` (authoring) and compiled
to `config/llm_profiles.json` (runtime). The central orchestration endpoint is
`api/llm.php`.

**Fallback chain**: Ollama timeout → cached definition → static definition.

### 4.11 FTL Drive System

Five FTL drive types provide distinct playstyle advantages:

| Drive | Faction | Effect |
|---|---|---|
| Vel'Ar OD-5 | Vel'Ar | Snap-to-nearest-star jumps; stealth mode |
| Kryl'Tha Mk-II | Kryl'Tha | Speed bonus at the cost of hull damage |
| Vor'Tak FC-1 | Vor'Tak | Carrier/mothership bonus (+20% fleet cohesion) |
| Syl'Nar GK-3 | Syl'Nar | FTL gate construction via survey missions |
| Xar'Vel RN-7 | Xar'Vel | FTL resonance node network; range boosts |

Key tables: `ftl_gates`, `ftl_resonance_nodes`, `users.ftl_drive_type`, `users.ftl_cooldown_until`.

Player APIs: `game.php?action=set_ftl_drive` (free or 200 DM),
`fleet.php?action=reset_ftl_cooldown` (50 DM).

See [FTL_DRIVE_DESIGN.md](../gamedesign/FTL_DRIVE_DESIGN.md) for the full design specification.

### 4.12 Politics & Empire Profile

`api/politics.php` manages the empire's political identity:

```
GET  /api/politics.php?action=catalog     → list species, government forms, civics
GET  /api/politics.php?action=presets     → preset empire configurations
GET  /api/politics.php?action=status      → current empire profile
POST /api/politics.php?action=configure   → set species + government + civics
POST /api/politics.php?action=apply_preset
```

Tables: `species_profiles`, `government_forms`, `government_civics`,
`user_empire_profile`, `user_empire_civics`, `user_empire_modifiers`,
`user_empire_profile`, `faction_tech_affinities`, `faction_approval_history`.

Species and government choices produce `user_empire_modifiers` rows that are consumed
by production and combat formulas.

### 4.13 Alliance System

`api/alliances.php` provides guild/alliance management:

- Create, join, accept members, kick members
- Alliance diplomacy (war/peace declarations between alliances)
- Alliance-internal messaging (`alliance_messages`)
- `alliance_members` (roles: `founder`, `officer`, `member`)
- `alliance_relations` (war / peace / neutral per pair)

### 4.14 Projection Runtime

`lib/projection_runtime.php` is a lightweight background-processing framework used when
a resource is expensive to compute on every API call:

```
Queue lifecycle:
  queued → processing → (deleted on success)
                      → queued (retry after exponential backoff)
                      → failed (dead-letter after PROJECTION_MAX_ATTEMPTS)

Key functions:
  enqueue_projection_dirty()  — idempotent enqueue with UPSERT coalescing
  claim_batch()               — worker-safe claiming (SELECT … FOR UPDATE in transaction)
  mark_done()                 — remove successfully processed entry
  mark_failed()               — apply backoff or promote to dead-letter
```

Workers: `scripts/project_user_overview.php`, `scripts/project_system_snapshots.php`

Workers accept `--batch`, `--max-seconds`, `--max-items`, `--dry-run` CLI flags.

### 4.15 TOTP / 2FA

`api/totp.php` manages optional TOTP two-factor authentication:

- `POST /api/totp.php?action=generate` — generate TOTP secret + QR code
- `POST /api/totp.php?action=verify`   — verify OTP code to activate 2FA
- `POST /api/totp.php?action=disable`  — disable 2FA (requires OTP confirmation)

Pending sessions stored in `totp_pending_sessions`; active secrets stored on `users.totp_secret`.
The frontend settings panel includes a 2FA configuration UI in `js/ui/settings-2fa.js`.

### 4.16 RBAC

`sql/migrate_rbac_v1.sql` adds a role-based access control layer:

Tables: `rbac_groups`, `rbac_profiles`, `rbac_group_profiles`, `rbac_user_groups`.

RBAC is currently used for the admin panel (`api/admin_stats.php`, `api/admin_users.php`)
to distinguish regular users from administrators without touching the `users` table schema.

---

## 5. Frontend Architecture

### 5.1 Entry Point & Boot Loader

`index.html` is the single-page application shell. It contains both the auth section and
the game section in the same HTML file; sections are toggled by JavaScript after login.

`js/runtime/boot-loader.js` loads pre-built bundles from `js/packages/`:

| Bundle | Contents |
|---|---|
| `game.boot.bundle.js.gz` | Main bundle |
| `game.boot.bundle.engine-core.js.gz` | WebGPU engine core |
| `game.boot.bundle.network.js.gz` | API client + binary decoders |
| `game.boot.bundle.rendering.js.gz` | Galaxy renderer |
| `game.boot.bundle.ui.js.gz` | UI components |
| `game.boot.bundle.telemetry.js.gz` | Telemetry + physics |
| `game.boot.bundle.legacy.js.gz` | Legacy modules |
| `game.boot.bundle.tests.js.gz` | Test helpers |

### 5.2 Window Manager (`wm.js`)

`js/runtime/wm.js` — floating window system. Depends on GQUI (`gq-ui.js`) for DOM construction.

```javascript
WM.open(id)     // Create or focus a named floating window
WM.close(id)    // Close and destroy a window
WM.refresh(id)  // Re-call onRender() for an open window
WM.body(id)     // Return the .window-body element for a window
```

Each window is a `<div class="wm-window">` with:
- Drag handle (`.window-titlebar`) — `mousedown` → `mousemove` on `document`
- Minimize button → collapses to taskbar in `#taskbar`
- Close button → removes from DOM

Window position/size persisted in `localStorage` as `wm_pos_<id>`.  
Z-index management: clicking any window calls `bringToFront(el)` — sets z-index to `++zCounter`.

### 5.3 API Client (`api.js`)

`js/network/api.js` — thin fetch wrapper with concurrency management.

```javascript
// Concurrency caps per request class:
// auth:2, overview:1, stars:1, binary:2, mutation:2
const API = (() => {
  const get  = (url)       => fetch(url, { credentials:'include' }).then(r => r.json());
  const post = (url, body) => fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  }).then(r => r.json());
  // ~50 methods total covering all API endpoints
})();
```

The CSRF token is fetched once on page load via `GET /api/auth.php?action=csrf`.

Binary galaxy data is fetched via `api/galaxy.php?action=bootstrap` and decoded by
`js/network/binary-decoder-v3.js` (delta-compressed binary protocol).

`js/network/api-contracts.js` provides DTO schema validators for all server responses.

### 5.4 Game Controller (`game.js`)

`js/runtime/game.js` — main game UI controller. Structured as a single async IIFE.

```javascript
let colonies      = [];          // array of colony objects from overview
let currentColony = null;        // selected colony (for Buildings, Research, etc.)
window._GQ_meta   = {};          // user meta (dark matter, rank, protection)
window._GQ_fleets = [];          // fleet list from last overview
window._GQ_battles = [];         // recent battle reports
```

**Render pattern** — every window has an `async renderXxx()` function:
```javascript
async function renderBuildings() {
  const root = WM.body('buildings');
  if (!root) return;
  const data = await API.buildings(currentColony.id);
  root.innerHTML = buildHtml(data);    // render HTML string
  // attach event listeners
}
```

`loadOverview()` is the heartbeat — runs on page load, after state-changing actions,
and on a 60-second polling interval.

### 5.5 GQUI DOM Builder (`gq-ui.js`)

`js/ui/gq-ui.js` exposes `window.GQUI`, a fluent DOM builder used throughout the game
UI instead of raw `innerHTML` string construction.

```javascript
// Fluent API
GQUI.div({ class: 'panel' }, [
  GQUI.strong('Title'),
  GQUI.btn('Click me', handler),
]);

// Utilities
GQUI.clearNode(el)         // remove all children
GQUI.mount(el, children)   // append children to element
GQUI.setStatus(el, msg)    // set a status message
```

The ShipyardController is a primary consumer — it builds the entire shipyard UI via GQUI
with no `innerHTML` string construction.

### 5.6 Galaxy Renderer

`js/rendering/galaxy-renderer-core.js` renders the 3D galaxy map.

```
galaxy-renderer-core.js  (main renderer)
  ├── Three.js scene + WebGPU overlay (via engine-compat.js bridge)
  ├── galaxy-camera-controller.js  — orbit + zoom controls
  ├── light-rig-manager.js         — star light rigs
  ├── texture-manager.js           — texture cache
  ├── material-factory.js          — procedural planet/star materials
  ├── geometry-manager.js          — instanced geometry pools
  ├── post-effects.js              — Three.js UnrealBloomPass + ShaderPass
  └── setFtlInfrastructure()       — renders FTL gates + resonance nodes as 3D overlay
```

**Legacy renderer** (`js/legacy/galaxy3d.js`) is deprecated (since 2026-03-29) and will
be removed after the migration period.

### 5.7 TTS & Audio System

GalaxyQuest ships a fully integrated text-to-speech pipeline for spoken in-game
notifications.

#### Architecture

```
Browser                      Docker network
────────                     ──────────────
game.js initSSE()
  └─ EventSource /api/sse.php
       fleet_arrived / fleet_returning / incoming_attack
         └─► js/runtime/tts.js  (window.GQTTS)
               └─ GET /api/tts.php?text=…&voice=…
                    └─ api/tts_client.php
                         └─ POST http://tts:5500/synthesize  (FastAPI)
                              └─ Piper / XTTS engine → MP3 bytes
                                   └─ cached in cache/tts/<hash>.mp3
                                        └─ returned to browser
                                             └─ GQAudioManager.playTtsAudio(mp3Blob)
```

#### GQAudioManager channels (`js/runtime/audio.js`)

`GQAudioManager` (exposed as `window.GQAudio`) manages **4 independent audio channels**:

| Channel | Methods | Purpose |
|---|---|---|
| `music` | `playMusic`, `setMusicVolume`, `setMusicMuted` | Background music tracks |
| `sfx` | `playSfx`, `setSfxVolume`, `setSfxMuted` | Sound effects |
| `teaser` | `playTeaser`, `setTeaserVolume`, `setTeaserMuted` | Teaser / ambient clips |
| `tts` | `playTtsAudio`, `setTtsVolume`, `setTtsMuted` | Spoken TTS alerts |

`duckMusicForTts()` applies a stronger volume-duck to the music channel while TTS
speech is playing, then restores the level automatically.

#### TTS service configuration

| Config key | Default | Effect |
|---|---|---|
| `TTS_ENABLED` | `false` | Master on/off switch |
| `TTS_SERVICE_URL` | `http://tts:5500` | FastAPI TTS service URL |
| `TTS_DEFAULT_VOICE` | — | Default Piper/XTTS voice identifier |

See [TTS_SYSTEM_DESIGN.md](TTS_SYSTEM_DESIGN.md) for the full design specification.

---

## 6. WebGPU Game Engine

The engine (`js/engine/`) is a self-contained WebGPU/WebGL2 game engine used for
the 3D space view, combat sequences, and particle systems.

### 6.1 GameEngine & GameLoop

```
GameEngine (top-level coordinator)
  ├── GameLoop          ← RAF, fixed-step accumulator (default 1/60 s)
  │     ├── onFixedUpdate → PhysicsEngine.step()
  │     │                 → SystemRegistry.update(dt) [PHYSICS priority]
  │     ├── onUpdate    → SystemRegistry.update(dt) [non-physics]
  │     └── onRender    → SceneGraph.update()
  │                     → Renderer.render(scene, camera)
  │                     → EffectComposer.render()
  │                     → PerformanceMonitor.tick()
  ├── EventBus          ← pub/sub: 'engine:start', 'engine:stop', 'engine:resize',
  │                               'physics:step', 'render:frame', 'asset:loaded'
  ├── SystemRegistry    ← ordered update pipeline (priority-based)
  └── AssetRegistry     ← preload + cache (textures, shaders, geometry)
```

```javascript
// Usage
const engine = await GameEngine.create(canvas, {
  renderer: 'auto',    // 'webgpu' | 'webgl2' | 'auto'
  physics:  'auto',    // 'cpu'    | 'gpu'    | 'auto'
  fixedStep: 1/60,
});
engine.events.on('render:frame', ({ alpha }) => myHUD.update(alpha));
engine.start();
```

### 6.2 Renderer Abstraction

```
IGraphicsRenderer (interface)
  ├── WebGPURenderer    — primary; uses WebGPU API directly
  └── WebGLRenderer     — fallback; wraps Three.js

RendererFactory.create(canvas, 'auto')
  └── negotiates best available backend at runtime
```

WebGPU backend modules (`js/engine/webgpu/`):

| Module | Purpose |
|---|---|
| `WebGPUDevice` | Device + queue acquisition |
| `WebGPUBuffer` | Buffer allocation (vertex, index, uniform, storage) |
| `WebGPUTexture` | Texture management |
| `WebGPUShader` | WGSL shader compilation + caching |
| `WebGPURenderPass` | Render pass descriptor builder |
| `WebGPUCompute` | Compute pass for GPU particles and physics |
| `WebGPUResourcePool` | GPU resource pooling + leak detection |
| `WebGPUPhysics` | N-body gravity + velocity integration (WGSL compute) |

### 6.3 Scene Graph

```
SceneGraph
  └── SceneNode (position, rotation, scale via Transform)
        ├── Geometry  (vertex / index / UV buffers)
        ├── Material  (shader, textures, uniforms)
        └── [children…]
```

Camera types: `PerspectiveCamera`, `OrthographicCamera`, `FollowCamera` (orbit mode).  
`CameraManager` manages multiple cameras and active-camera switching.  
Light types: `AmbientLight`, `DirectionalLight`, `PointLight`.

Math library (`js/engine/math/`): `Vector2`, `Vector3`, `Vector4`, `Matrix4`,
`Quaternion`, `MathUtils`.

### 6.4 Post-Processing Pipeline

```
EffectComposer (ping-pong render targets)
  ├── RenderPass      — renders scene to off-screen RT
  ├── BloomPass       — threshold → blur → additive blend; WGSL
  ├── VignettePass    — radial darkening; WGSL
  ├── ChromaticPass   — chromatic aberration; WGSL
  ├── SSAOPass        — screen-space ambient occlusion; WGSL (64-sample kernel)
  └── ComputePass     — generic GPU compute post-effect
```

`PostFxController` manages pass add/remove, parameter editing, and serialisation.  
`PostFxParamMeta` provides UI metadata for each pass's uniform parameters.  
All passes implement `buildParamBlock()` returning a `Float32Array` for GPU uniforms.

### 6.5 FX System

Combat FX (`js/engine/fx/`):

| Class | Purpose |
|---|---|
| `CombatFX` | High-level combat effects (weapon beams, explosions, shield impacts) |
| `ParticleSystem` | CPU particle pool with dynamic `PointLight` support |
| `ParticleEmitter` | Emitter descriptor (shape, rate, lifetime, colour gradient) |
| `GPUParticleSystem` | GPU compute particles (`particles.wgsl`); CPU fallback |
| `BeamEffect` | Instanced capsule beams (`beam.wgsl`) for laser/plasma weapons |
| `VoxelDebris` | Box-chunk pool for ship destruction debris (`SHIP_DESTRUCTION`) |
| `EnvironmentFX` | Ambient environment effects (nebulae, dust, god rays, lens flares) |
| `DebrisSimulator` | Debris field simulation |
| `VolumetricScatter` | Volumetric light scattering |

`EnvironmentFX` types: `DebrisField`, `DebrisCloud`, `PlasmaCloud`, `NebulaVolume`,
`SpaceDust`, `GodRay`, `LensFlare`, `HeatDistortion`, `EmpPulse`, `Corona`,
`PlasmaTorrent`, `GravLensing`, `RadiationZone`.

WGSL shaders: `particles.wgsl`, `beam.wgsl`, `nebula.wgsl` (fBm raymarched volume),
`godray.wgsl` (radial blur).

### 6.6 Game Systems (JS)

Pure-logic game systems in `js/engine/game/` (no GPU dependency; fully testable):

| Class | Purpose |
|---|---|
| `BattleSimulator` | Deterministic round-based fleet combat |
| `BattleFleet` | Fleet wrapper with `ShipClass` composition |
| `BattleReport` | Serialisable combat outcome |
| `ColonySimulation` | Colony resource management, pop jobs, building yields |
| `Colony` | Individual colony with garrison, welfare, type bonuses |
| `ResearchTree` | Technology tree with `ResearchCategory` and `CivAffinity` |
| `FleetFormation` | Formation patterns (`Wing`, `Maneuver`, `FormationShape`) |
| `EventSystem` | Game event engine with `Journal` and `JournalStatus` |

`BattleSimulator.simulate()` uses rapid-fire mechanics, shield regen, and simultaneous fire.  
`ColonySimulation.invade(id, troops, opts)` returns an `InvasionReport` (SUCCESS / REPELLED / DRAW).

### 6.7 ViewportManager & PiP

`ViewportManager` manages multiple viewports in a single canvas including a
Picture-in-Picture (PiP) sub-pass rendered directly on the main swap-chain texture.

```javascript
// PiP rendering uses GPURenderPassDescriptor with loadOp:'load'
// + setViewport/setScissorRect on the main swap-chain texture.
// PIP_DEFAULTS.headerHeight = 22  (22 px title bar — single source of truth)
```

### 6.8 SeamlessZoom System

`js/engine/zoom/` implements a seamless camera-zoom system that transitions between
five distinct spatial scales — from the full galaxy view down to individual objects —
with animated camera flight paths between levels.

#### Zoom levels

| Level | Constant | Camera distance | Renderer pair |
|---|---|---|---|
| 0 | `ZOOM_LEVEL.GALAXY` | 145–2400 | GalaxyLevelWebGPU / GalaxyLevelThreeJS |
| 1 | `ZOOM_LEVEL.SYSTEM` | 50–145 | SystemLevelWebGPU / SystemLevelThreeJS |
| 2 | `ZOOM_LEVEL.PLANET_APPROACH` | 12–50 | PlanetApproachLevelWebGPU / ThreeJS (fly-in) |
| 3 | `ZOOM_LEVEL.COLONY_SURFACE` | 3–12 | ColonySurfaceLevelWebGPU / ThreeJS |
| 4 | `ZOOM_LEVEL.OBJECT_APPROACH` | 0–3 | ObjectApproachLevelWebGPU / ThreeJS |

#### Key classes (`js/engine/zoom/`)

| Class | Purpose |
|---|---|
| `SeamlessZoomOrchestrator` | Top-level coordinator; owns RendererRegistry; drives level transitions |
| `RendererRegistry` | Stores registered `{webgpu, threejs}` renderer pairs per zoom level |
| `CameraFlightPath` | Animates camera from current position to target for level-2 fly-in |
| `IZoomLevelRenderer` | Interface contract implemented by every level renderer |

#### Transition flow

```
zoomToTarget(target, opts)
  │  guard: reject concurrent transitions
  │
  ├─ exitLevel(current)       — tear down current level renderer
  ├─ CameraFlightPath.fly()   — animated camera move (level 2 only)
  ├─ enterLevel(target.spatialDepth)  — activate new level renderer
  └─ emit 'enterLevel' / 'exitLevel' events on the orchestrator
```

`SPATIAL_DEPTH` (0–4) on a scene-graph target node determines the zoom level
automatically — no manual level specification needed in most call sites.

Usage in `game.js`:
```javascript
orchestrator.zoomToTarget(selectedStar, { animate: true });
```

---

## 7. Database Schema

### 7.1 Entity Relationships

```
users ─┬──────────────────── colonies ──── buildings
       │                         │
       │                         └────────── ships
       │                         │
       │                         └────────── fleets (origin)
       │                     planets
       │                         │
       │                    star_systems
       │                    celestial_bodies
       │                    binary_systems
       │
       ├─── research
       ├─── fleets (owner)
       ├─── leaders ────────── colonies (assigned_to)
       │               └────── fleets (fleet_id)
       │               └────── leader_marketplace
       │
       ├─── messages
       ├─── battle_reports (attacker / defender)
       ├─── spy_reports
       │
       ├─── diplomacy ─────── npc_factions ── trade_offers
       │                              └────── faction_quests
       │                              └────── faction_species
       │                              └────── faction_tech_affinities
       ├─── user_faction_quests
       ├─── user_faction_state
       ├─── faction_approval_history
       │
       ├─── alliances ──── alliance_members ── users
       │             └──── alliance_relations
       │             └──── alliance_messages
       │
       ├─── user_achievements ─── achievements
       ├─── user_empire_profile
       ├─── user_empire_civics
       ├─── user_empire_modifiers
       │
       ├─── ftl_gates
       ├─── ftl_resonance_nodes
       │
       ├─── wormholes
       ├─── user_wormhole_unlocks
       │
       ├─── situation_states ──── situation_stage_log
       ├─── colony_events
       ├─── trade_routes
       ├─── trade_proposals
       │
       ├─── user_character_profiles
       ├─── user_combat_modifiers
       ├─── combat_modifiers
       │
       ├─── rbac_user_groups ── rbac_groups ── rbac_group_profiles ── rbac_profiles
       ├─── login_attempts
       ├─── remember_tokens
       ├─── totp_pending_sessions
       │
       ├─── vessel_blueprints ── vessel_blueprint_modules ── modules
       │                   └──── hull_module_compatibility ── vessel_hulls
       │                   └──── module_groups
       ├─── built_vessels
       ├─── fleet_vessel_assignments
       │
       ├─── llm_prompt_profiles
       ├─── llm_request_log
       ├─── npc_llm_decision_log
       │
       ├─── projection_dirty_queue
       ├─── projection_user_overview
       ├─── projection_system_snapshot
       │
       ├─── advisor_hints
       ├─── app_state
       ├─── galaxies
       └─── player_system_visibility
```

### 7.2 Table Reference

Core tables:

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `username`, `password_hash`, `dark_matter`, `rank_points`, `pvp_mode`, `protection_until`, `ftl_drive_type`, `ftl_cooldown_until`, `totp_secret` | Central user record |
| `star_systems` | `galaxy_index`, `system_index`, `x_ly`, `y_ly`, `z_ly` | Cached from generator |
| `planets` | `galaxy`, `system`, `position`, `planet_class`, richness ×4, deposits ×4 | Lazy via `ensure_planet()` |
| `celestial_bodies` | `star_system_id`, `body_type`, orbital parameters | Moons, asteroid belts |
| `binary_systems` | Links two `star_systems` as a gravitational binary | Added in unified bodies migration |
| `colonies` | `planet_id`, `user_id`, resources, welfare state, `last_update` | One per planet max |
| `buildings` | `colony_id`, `type`, `level`, `upgrade_end` | `UNIQUE(colony_id, type)` |
| `building_upgrade_queue` | Queued upgrades (vessel blueprint module system) | |
| `research` | `user_id`, `type`, `level`, `research_end` | `UNIQUE(user_id, type)` |
| `ships` | `colony_id`, `type`, `count` | `UNIQUE(colony_id, type)` |
| `fleets` | `user_id`, origin/target 3D coords, `mission`, `ships_json`, cargo, timestamps | `ships_json = {"light_fighter":10}` |

Vessel blueprint tables (see [VESSEL_MODULE_BLUEPRINT_DESIGN.md](../gamedesign/VESSEL_MODULE_BLUEPRINT_DESIGN.md)):

| Table | Notes |
|---|---|
| `vessel_hulls` | Base hull definitions with stats |
| `modules` | Ship module definitions |
| `module_groups` | Logical groups for slot restrictions |
| `hull_module_compatibility` | Which modules fit which hulls |
| `vessel_blueprints` | User-saved designs |
| `vessel_blueprint_modules` | Module instances per blueprint |
| `built_vessels` | Constructed vessels in fleet |
| `fleet_vessel_assignments` | Fleet ↔ vessel mapping |

Politics tables: `species_profiles`, `government_forms`, `government_civics`,
`user_empire_profile`, `user_empire_civics`, `user_empire_modifiers`,
`faction_tech_affinities`, `faction_approval_history`.

### 7.3 Conventions

- **Primary keys**: `INT AUTO_INCREMENT`, always named `id`.
- **Foreign keys**: `ON DELETE CASCADE` everywhere — deleting a user removes all their data.
- **Timestamps**: `DATETIME` (not `TIMESTAMP`) stored as UTC.
- **Resource amounts**: `DECIMAL(20,4)` — fractional production, no float rounding drift.
- **JSON columns**: `TEXT` + `json_encode`/`json_decode` — no `JSON` type, for MariaDB compat.
- **Migrations**: `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` — idempotent.
- **Migrations naming**: `migrate_<feature>_v<N>.sql` — run in order via `setup.php`.

---

## 8. Security Model

| Threat | Mitigation |
|---|---|
| SQL injection | All queries use PDO prepared statements |
| CSRF | `X-CSRF-Token` header validated on every POST; token bound to session |
| Session fixation | `session_regenerate_id(true)` on login |
| Password storage | `password_hash(…, PASSWORD_BCRYPT)` |
| Ownership bypass | `verify_colony_ownership($db, $cid, $uid)` before every colony operation |
| Attacking self | `resolve_battle()` returns early if `target.user_id === fleet.user_id` |
| Integer overflow | Resource amounts stored as `DECIMAL(20,4)`; PHP uses `(float)` casts |
| Resource column injection | Dynamic column names validated against explicit allowlists |
| XSS | User strings escaped with `esc()` (`htmlspecialchars` wrapper) before DOM insertion |
| Newbie griefing | `protection_until` column; attack missions blocked for protected players |
| PvP opt-in | `pvp_mode` flag; attacks on `pvp_mode=0` players return an error |
| Brute-force login | `login_attempts` table — tracks per-IP attempts; lockout after threshold |
| 2FA | Optional TOTP (`totp_pending_sessions`, `users.totp_secret`) |
| Admin access | RBAC (`rbac_groups`, `rbac_profiles`) restricts admin panel endpoints |
| Remember-me token | Stored hashed in `remember_tokens`; server-side revocation supported |

**Not yet hardened** (see [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md)):
- `Content-Security-Policy` header
- Account lockout UI feedback

---

## 9. Configuration Reference

All constants in `config/config.php`:

| Constant | Type | Default | Effect |
|---|---|---|---|
| `DB_HOST` | string | `localhost` | MySQL host |
| `DB_PORT` | int | `3306` | MySQL port |
| `DB_NAME` | string | `galaxyquest` | Database name |
| `DB_USER` | string | — | DB username |
| `DB_PASS` | string | — | DB password |
| `DB_CHARSET` | string | `utf8mb4` | Connection charset |
| `GAME_SPEED` | float | `1` | Multiplies all production rates and travel speed |
| `GALAXY_MAX` | int | `9` | Number of playable galaxies |
| `SYSTEM_MAX` | int | `499` | Star systems per galaxy |
| `POSITION_MAX` | int | `15` | Planet slots per system |
| `SESSION_LIFETIME` | int | `3600` | Session idle timeout (seconds) |
| `CSRF_TOKEN_LENGTH` | int | `32` | CSRF token byte length |
| `PROJECTION_MAX_ATTEMPTS` | int | `10` | Projection queue retry limit |

LLM configuration via environment variables:

| Variable | Default | Effect |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `mistral` | Default LLM model |

---

## 10. Testing Infrastructure

| Layer | Framework | Location | Notable counts |
|---|---|---|---|
| PHP Unit | PHPUnit | `tests/Unit/` | 9+ test classes; 130 assertions (Iron Fleet, NPC chat, YAML parser, …) |
| JS Engine | Vitest | `tests/js/` | audio (45), TTS (28), prolog (37), runtime-quests (16), seamless-zoom (66), + post-FX / FX tests |
| WebGPU | Vitest | `tests/webgpu/` | game-systems.test.js; 20 pre-existing failures in webgl-renderer.test.js (mock issue) |
| End-to-End | Playwright | `tests/e2e/` | Browser E2E registration, login, colony, fleet flows |

**Run tests:**
```bash
# PHP unit tests
docker compose exec web vendor/bin/phpunit

# JavaScript tests (no GPU required — uses MockRenderer)
npm test

# End-to-end tests
npx playwright test
```

**Vitest config**: `vitest.config.mjs`  
**Playwright config**: `playwright.config.js`  
**PHPUnit config**: `phpunit.xml`

---

## 11. Extension Points

### Adding a new building type

1. Add to `BUILDING_BASE_COST` and `BUILDING_COST_FACTOR` in `game_engine.php`.
2. If it produces a resource, add a production function and wire into `update_colony_resources()`.
3. Add `BUILDING_META` entry in `renderBuildings()` in `game.js` (icon, category, description).
4. Add to `$starterLevels` in `colonize_planet()` and `$defaultBuildings` in `auth.php`.

### Adding a new research technology

1. Add to `RESEARCH_BASE_COST` in `game_engine.php`.
2. If it has a combat/production effect, wire into the relevant formula function.
3. No frontend change needed — research renders generically.

### Adding a new ship type

1. Add to `SHIP_STATS` in `game_engine.php`.
2. No other change needed — shipyard renders generically.

### Adding a new fleet mission

1. Add to the `mission ENUM` in `schema.sql` and create a migration.
2. Add a `case` in the `match ($fleet['mission'])` block in `fleet.php`.
3. Implement the resolver function in `fleet.php`.
4. Add a radio button to the mission selector in `renderFleetForm()` in `game.js`.

### Adding a new NPC faction

1. `INSERT INTO npc_factions` in `schema.sql` (and run via migration).
2. Add faction-specific quest seeds to `faction_quests` if desired.
3. No code changes needed — factions render generically.

### Adding a new achievement

1. `INSERT INTO achievements` in `schema.sql`.
2. Add detection logic to `check_and_update_achievements()` in `achievements.php`.

### Adding a new post-processing pass

1. Create a class in `js/engine/post-effects/passes/` implementing `buildParamBlock()`.
2. Export from `js/engine/index.js`.
3. Add to `EffectComposer` via `addPass()`.

### Adding a new game event type

1. Define the event in `js/engine/game/EventSystem.js` using `defineEvent()`.
2. Use `EventSystem.fire()` to trigger it from game logic.
3. Optionally define a `Journal` entry with `defineJournalEntry()` for persistent tracking.

### Theming / reskinning

All colours are CSS custom properties in `:root` in `css/style.css`. A complete visual
retheme requires only changing `--bg-*`, `--accent`, `--text-*`, `--border` variables.
