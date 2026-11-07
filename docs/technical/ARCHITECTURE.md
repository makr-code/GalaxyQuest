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
   - 4.5 [On-Demand Colony Economy](#45-on-demand-colony-economy)
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
  │  Optional binary galaxy formats
  ▼
┌────────────────────────────────────────┐
│  Apache / Nginx / PHP built-in server  │
│  (document root = project root)        │
└────────────────┬───────────────────────┘
                 │
        ┌────────▼──────────────┐
        │  index.html           │  unified auth + game shell
        │  /js/main.js          – ES module entry point
        └────────┬──────────────┘
                 │ HTTP JSON (default), optional binary encoding, gzip content encoding
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
   ├─ build_live_overview_payload(...)    — assemble state without simulation ticks
   ├─ update_all_colonies($db, $uid)     — lazy on-demand colony economy settlement
   ├─ SELECT colonies + planets JOIN     — fetch colony state
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

The core game state travels as JSON via asynchronous `fetch()` calls. `loadOverview()`
is the heartbeat of the game UI — called on page load, after every mutation, and on a
**60-second polling interval**:

```
game.js: loadOverview()
  ─► GET /api/game.php?action=overview
       │
       ├─ update_all_colonies()   — on-demand economy settlement for user colonies
       ├─ no NPC or global simulation tick (side effects are disabled on reads)
       └─ JSON response: { colonies[], fleets[], meta{} }
       │
  ◄── game.js stores in window._GQ_* globals
       └─ re-renders all open WM windows via WM.refresh()
```

There is no WebSocket or push mechanism for the main game state — the polling model
keeps the PHP backend fully stateless between requests.

#### B. Galaxy Data — JSON default; optional binary encoders

The galaxy star loader uses a cache, network fetch, payload adaptation, and
renderer update. The `api/galaxy.php?action=bootstrap` action returns JSON
metadata and capability information; it is not a binary star-data response.
The endpoint's system-payload format defaults to JSON. Binary V1/V2/V3 can be
requested explicitly, but the decoder script tags in `index.html` are
commented out, so V3 is not the normal browser-client path.

Available server-side system-payload formats:

| Version | Server encoder | Client decoder | Notes |
|---|---|---|---|
| V1 | `api/compression.php` | `js/network/binary-decoder.js` | Optional legacy format |
| V2 | `api/compression-v2.php` | `js/network/binary-decoder-v2.js` | Optional structured binary |
| V3 | `api/compression-v3.php` | `js/network/binary-decoder-v3.js` | Optional delta encoding; not the JSON default or active browser default |

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

#### Backend — lazy resource settlement + explicit simulation triggers

| Layer | Model | Trigger | Implementation |
|---|---|---|---|
| Colony resources | **Lazy settlement** | Overview/resource reads and game mutations; based on `last_update` | `update_colony_resources()` in `game_engine.php` |
| Fleet arrivals | **Explicit mutation** | CSRF-protected `POST fleet.php?action=check` | `process_fleet_arrivals()` |
| Trade routes | **Explicit mutation** | CSRF-protected `POST trade.php?action=dispatch_due` | `check_and_dispatch_trade_routes()` |
| Simulation ticks | **Explicit / worker** | CSRF-protected tick API or CLI runner | `simulation_tick.php`, `scripts/run_simulation_tick.php` |
| Leader AI | **On-demand** | Player-triggered | `POST /api/leaders.php?action=ai_tick` |
| Background projections | **Worker / cron** | CLI batch | `scripts/project_*.php` via projection queue |

Key insight: **there is no periodic resource-advancement scheduler.** Colony
economy settlement is lazy and based on `last_update`; it may persist resource
accounting during overview/resource reads and mutations. Overview GETs do not run
simulation ticks, and fleet arrivals and recurring trade dispatches use explicit
CSRF-protected POST actions instead of list requests.

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

> This is a representative source inventory, not the active browser import graph. A file's presence here does not imply it is loaded by the current entry point.

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
│   │   ├── Galaxy3DRendererWebGPU.js  Native WebGPU galaxy renderer
│   │   ├── material-factory.js        Material creation
│   │   ├── geometry-manager.js        Geometry management
│   │   ├── texture-manager.js         Texture management
│   │   ├── light-rig-manager.js       Lighting setup
│   │   ├── post-effects.js            Post-processing integration
│   │   ├── starfield-webgpu.js        WebGPU starfield renderer
│   │   ├── starfield.js               WebGL starfield renderer
│   │   └── planet-textures.js         Procedural planet textures
│   ├── runtime/               Core game runtime and legacy modules
│   │   ├── game.js            Main game UI controller
│   │   ├── wm.js              Floating window manager
│   │   ├── audio.js           GQAudioManager — 4 channels: music/sfx/teaser/tts
│   │   ├── tts.js             GQTTS — text-to-speech client
│   │   ├── galaxy-model.js    Galaxy data model
│   │   ├── galaxy-db.js       Galaxy data access layer
│   │   ├── model_registry.js  Client-side model registry
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
│   └── engine/                WebGPU game engine (see §6)
│   │   ├── index.js           Engine main export
│   │   ├── GameEngine.js      Top-level engine coordinator
│   │   ├── GameLoop.js        RAF + fixed-step accumulator
│   │   ├── EventBus.js        Decoupled pub/sub events
│   │   ├── SystemRegistry.js  Ordered update pipeline (priority slots 0–900)
│   │   ├── AssetRegistry.js   Asset cache + preloading
│   │   ├── ViewportManager.js PiP viewport manager
│   │   ├── constants.js       Engine constants
│   │   ├── core/              Renderer core + abstraction (RendererFactory)
│   │   ├── webgpu/            WebGPU wrappers (Device, Buffer, Texture, Shader, …)
│   │   ├── scene/             Scene graph, camera, geometry, lights
│   │   ├── math/              Vector, Matrix, Quaternion, MathUtils
│   │   ├── loaders/           Asset loaders
│   │   ├── utils/             Performance monitor, resource tracker
│   │   ├── post-effects/      Post-processing pipeline (EffectComposer + passes)
│   │   ├── fx/                Combat, environment, particle FX; StarfieldFX; WarpFX
│   │   ├── game/              BattleSimulator, ColonySimulation, ResearchTree, etc.
│   │   ├── zoom/              SeamlessZoom system (Orchestrator, RendererRegistry, CameraFlightPath)
│   │   └── runtime/           ~140 Runtime* modules (controllers, facades, lifecycle)

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
│   ├── tts.php                TTS synthesis endpoint (proxies to tts_service)
│   ├── tts_client.php         TTS HTTP client
│   ├── sse.php                Server-Sent Events — fleet/attack spoken alerts
│   └── llm_soc/               LLM Separation-of-Concerns modules
│       ├── PromptCatalogRepository.php     Prompt profile CRUD (file + DB merge)
│       ├── LlmPromptService.php            Prompt template rendering + LLM dispatch
│       ├── LlmRequestLogRepository.php     Request audit log
│       ├── FactionSpecLoader.php           Loads faction YAML specs for prompt vars
│       ├── NpcChatSessionRepository.php    NPC chat session storage (JSON files + DB)
│       └── IronFleetPromptVarsComposer.php Iron Fleet mini-faction prompt vars
│
├── lib/
│   ├── projection_runtime.php  Shared projection queue runtime
│   ├── MiniYamlParser.php      Strict YAML-subset parser (scalars/maps/sequences)
│   └── template-renderer.php   PHP template rendering helpers
│
├── scripts/
│   └── project_user_overview.php  Projection worker: user overviews
│   └── project_system_snapshots.php  Projection worker: system snapshots
│
├── tts_service/               FastAPI TTS microservice (Piper / XTTS)
│   └── main.py                HTTP endpoint: POST /synthesize → MP3 bytes
│
├── fractions/                 Faction definition files
│   └── <faction_code>/        One folder per faction
│       ├── spec.yaml          Faction spec (authoring)
│       ├── spec.json          Faction spec (runtime)
│       └── mini_factions/     Mini-faction YAML specs (e.g. iron_fleet)
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

### 4.5 On-Demand Colony Economy

There is **no periodic resource-production scheduler**. Accumulation is
computed on demand from `last_update` when a colony action requires settlement:

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

The resource update path is called by API actions that touch a colony.
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

Star system rows are materialized on demand for the requested system/range; read
requests do not advance the global bootstrap batch or seed faction defaults.
Registration/homeworld creation may advance the explicit bootstrap process.
Planet rows are created lazily via `ensure_planet()` in `planet_helper.php` —
only when a fleet visits the coordinates.

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
LLM-guided steering. Mutating ticks run only through explicit simulation or
NPC-controller actions; overview GET requests do not execute them.

#### Tier 1 — Rule-Based Faction Tick (`npc_ai.php`)

`npc_ai_tick($db, $userId)` runs from explicit simulation/NPC-controller actions
and is rate-limited to **once per 5 minutes** per user via `users.last_npc_tick`
unless explicitly forced. The simulation HTTP endpoint requires POST and CSRF.

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
| Scientific glossary | `POST /api/glossary.php?action=generate` | CSRF-protected Ollama + Wikipedia RAG |
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

## 4.17 Galaxy Bounded Context (OOP Pattern)

### Context Overview

The Galaxy bounded context encapsulates all star system queries, range lookups, and system detail retrieval. Implemented as a proof-of-concept for the SOC/OOP migration pattern (Batches 1-6).

**Layers**:

```
┌─ Presentation Layer (HTTP)
│  └─ GalaxyController.php  — HTTP request handlers
│
├─ Application Layer (Business Logic)
│  ├─ GetStarsRangeService.php  — Range query orchestration
│  └─ GetSystemPayloadService.php  — Single system detail
│
├─ Infrastructure Layer (Database & Encoding)
│  ├─ PdoGalaxyRepository.php  — PDO queries (NO SQL in above layers)
│  └─ Encoders/
│      ├─ JsonSystemPayloadEncoder.php
│      └─ BinarySystemPayloadEncoder.php
│
└─ Domain Layer (Business Rules)
   ├─ Interfaces/
   │  ├─ GalaxyRepositoryInterface.php  — Repository contract
   │  └─ SystemPayloadEncoderInterface.php  — Encoding contract
   └─ RangeValidator.php  — Coordinate validation logic
```

### Architecture Rules (Enforced in CI)

1. **No SQL in Presentation layer** – All queries via `GalaxyRepositoryInterface`
2. **No HTTP in Domain layer** – Domain logic is framework-agnostic
3. **Interfaces before implementations** – Contracts drive design
4. **All errors via ApiError/ApiResponse** – Standardized error envelope
5. **100% type hints** – PHP `declare(strict_types=1)` required
6. **>80% test coverage** – Unit + Integration + Contract tests

### Integration Bridge: `api/galaxy.php`

Maintains backward compatibility while routing new actions to OOP layer:

The current `range` and `system_detail` actions build the read-only repository,
JSON encoder, application services, and `GalaxyController` directly in
`api/galaxy.php`. The controller receives no `RetryPolicy`; the class exists
separately but is not applied on this request path.

**Key points**:
- Composer autoloading is used when available, with a manual development fallback
- Endpoint code constructs and injects the required services; no dependency-injection container is used here
- `RetryPolicy` exists, but is not applied in the Galaxy API request path
- Procedural legacy actions and the newer read-only actions coexist in the same endpoint; this is not evidence of a zero-downtime migration or full OOP conversion

### Historical Performance Test Snapshot

`tests/Performance/GalaxyPerformanceTest.php` profiles synthetic data in an in-memory SQLite database. Its timings vary by environment; they are not production database measurements, a stable baseline, or a performance gate. Do not treat previously published p95/p99 figures as current measurements.

The test compares JSON and the PHP binary encoder for a small synthetic system, but does not establish a production format recommendation. See [ADR-005](ADR-005-Serialization-Strategy.md) for the historical rationale.

### Frontend Integration: `js/features/galaxy/`

These modules and their local cache are available in the repository, but `legacy-bridge.js` is not imported by the active `js/main.js` entry point. The example below describes an optional integration path, not the normal runtime.

```javascript
// New pattern (OOP)
const service = new GalaxyService(apiClient);
const controller = new GalaxyController(service);
await controller.loadSystemsInRange(10, 20, 5, 30);
controller.on('systemsLoaded', (systems) => updateUI(systems));

// Legacy pattern (maintained via bridge)
getSystemsInRange(10, 20, 5, 30, (err, systems) => {
    if (!err) updateUI(systems);
});
```

`GalaxyService` implements a 5-minute TTL and FIFO eviction (max 100 results). This cache is not evidence that the optional bridge is active in the normal runtime. See [ADR-004](ADR-004-Frontend-Backend-Bridge.md).

### Testing Strategy

The counts and coverage claims in this older architecture snapshot are not maintained release metrics.

| Test Type | Location | Count | Purpose |
|-----------|----------|-------|---------|
| Unit | `tests/Unit/RangeValidatorTest.php` | 9 | Business rules |
| Unit | `tests/Unit/RetryPolicyTest.php` | 15 | Retry logic |
| Integration | `tests/Integration/GalaxyIntegrationTest.php` | 6 | End-to-end with DB |
| Performance | `tests/Performance/GalaxyPerformanceTest.php` | 4 | Latency & size baseline |
| Contract | `tests/Unit/GalaxyApiContractTest.php` | 12 | API envelope structure |
| Snapshot | `tests/Unit/GalaxyEncodingSnapshotTest.php` | 6 | Encoding consistency |

The listed counts and the former `>95%` coverage claim are historical, not a current suite total or verified coverage result.

### CI Validation

See `.eslintrc.galaxy.js` and `ruleset.xml` for architecture-specific linting:

- ESLint rule: No direct `fetch()` in domain/service layers
- PHP CodeSniffer rule: No SQL in Presentation layer
- CI fails on violations (enforced on all PRs)

### Migration Playbook

To implement a new bounded context (e.g., Identity/Auth), follow the same 4-layer structure:

1. **Phase 0**: Scaffold directories, interfaces, stub implementations
2. **Phase 1**: Implement repository (real DB queries) + services + controller
3. **Phase 2**: Build frontend service/controller + legacy bridge
4. **Phase 3**: Add tests (unit → integration → contract)
5. **Phase 4**: Add CI rules, documentation, ADRs

See [`MIGRATION_PLAYBOOK.md`](MIGRATION_PLAYBOOK.md) for detailed checklist and templates.

### Known Limitations & Future Work

- **Binary encoding**: Overhead outweighs benefit for single records; useful for bulk operations (100+)
- **Circuit breaker**: Not implemented; add if external service calls needed
- **Caching**: Simple FIFO; consider LRU for production
- **Rate limiting**: Not implemented; add if bot protection needed

### Related Documentation

- [ADR-003: Retry Policy & Error Handling](ADR-003-Retry-Policy.md)
- [ADR-004: Frontend-Backend API Bridge](ADR-004-Frontend-Backend-Bridge.md)
- [ADR-005: Serialization Strategy (JSON vs Binary)](ADR-005-Serialization-Strategy.md)
- [MIGRATION_PLAYBOOK.md](MIGRATION_PLAYBOOK.md) – Template for next contexts
- [MIGRATION_PROGRESS.md](MIGRATION_PROGRESS.md) – Historical status snapshot of Batches 1-6 (last updated 2026-07-31)

---

## 5. Frontend Architecture

> **Runtime note:** `index.html` starts the app with `js/main.js` as an ES module. The legacy script tags near the end of the file are commented out; file presence or an old module inventory alone does not mean a module is loaded.

### 5.1 Entry Point and Loading

`index.html` is the application shell and loads `/js/main.js` as a module. That entry point imports `js/rendering/starfield.js` and `js/network/auth.js`.

The previously documented `js/runtime/boot-loader.js` and `js/packages/game.boot.bundle.*` inventory are not present in the current checkout and are not the active loading path.

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

### 5.3 API Client and Galaxy Formats (`api.js`)

`js/network/api.js` — thin fetch wrapper with concurrency management.

```javascript
// The optional APIQueue module defines per-class caps:
// auth:2, overview:1, stars:1, binary:2, mutation:2.
// The corresponding classic script tag in index.html is commented out;
// verify the active import path before assuming these caps apply.
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

`api/galaxy.php?action=bootstrap` returns JSON metadata. System payloads default to JSON; optional binary encoders require explicit format selection. The V1/V2/V3 decoder script tags in `index.html` are commented out, so the V3 decoder is not the normal browser-client path.

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

`playTtsAudio()` tracks actual media playback through `trackTtsAudio()`, also used
by registration narration. Music stays lowered until all audible speech clips
end, pause or fail, not merely for a fixed timeout. Track changes and short SFX
ducking cannot release the speech reduction. Restoration uses current user volume.
The player menu exposes persisted ducking enable/strength controls (enabled by
default). `duckMusicForTts()` remains available for legacy timed callers.
Master and per-channel volume/mute changes are applied to active manager-owned
SFX, teaser, and TTS clips as well as future playback.
The optional Tone.js procedural synthesizer applies gain per effect rather than
changing the shared Tone destination, and disposes completed or cancelled nodes.
The synth remains caller-owned when attached to the manager; its owner must
dispose it when detaching or tearing down the audio runtime. Disposal attempts
every active Tone node and aggregates cleanup failures; setup and playback
failures are logged rather than silently treated as successful playback.
Procedural frequencies are limited to 20 kHz and effect durations to 30 seconds
to prevent invalid or unbounded values from reaching Tone.js.
The Web Audio context used by oscillator fallbacks is resumed when a sound is
requested from a user gesture, as required by browser autoplay policy.
Music play requests are tokenized: a late media `play()` promise cannot undo a
newer pause, overwrite the result of a newer playback request, or restart a
track selected with autoplay disabled. Preparing a different track explicitly
pauses both music decks and persists the paused state.
Music volume and ducking range controls apply synchronously without entering the
pending state used for track changes, keeping sliders interactive during drags.
Oscillator fallback tones validate waveform, frequency and duration before
allocating nodes; partial startup/context failures attempt full cleanup rather
than leaving disconnected nodes or an unusable context retained.

The manager's asynchronous, idempotent `dispose()` stops both music decks and
tracked transient clips, removes owned media listeners, cancels fades and
scheduled SFX callbacks, stops procedural oscillators, and closes its
`AudioContext`. Callers that destroy the manager should await `dispose()` so
context shutdown and aggregated cleanup errors are observed.
All disposal callers receive the same promise, including a pending or failed
context shutdown. Owned media sources are removed and reloaded to release media
buffers. `trackTtsAudio()` deduplicates the same external element; disposal
removes those borrowed listeners without stopping externally owned playback.

Run `npx playwright test tests/e2e/lifecycle-resources.spec.js tests/e2e/game-view-lifecycle.spec.js --project=chromium --workers=1`
for the isolated browser lifecycle gate (also required by the smoke CI job).
It uses real `HTMLAudioElement`/`AudioContext` instances over eight cycles,
checks native listener removal through Chromium DevTools, and requires zero
pending timers/RAFs after cleanup. Sixteen zoom lifecycles exercise the actual
orchestrator and galaxy/system wrappers with an injected non-rendering backend,
checking frame-hook/RAF removal and borrowed ownership. The game-view test
mounts the actual `createGameGalaxyRenderer` adapter and `PerspectiveSpaceFlight`
scene eight times, with an injected shared renderer and zoom runtime. It checks
native canvas listener removal, endpoint-hook cleanup, label-callback release,
and return to the menu even after a zoom cleanup failure. No server, login or
physical GPU is needed. These are not GPU-memory or complete authenticated
colony mount/unmount tests; those remain separate FE-05 acceptance work.

`createGameGalaxyRenderer.destroy()` attempts all view cleanup before surfacing
an `AggregateError`. It never disposes the borrowed shared renderer. The colony
zoom bridge clears `window.__GQ_ZOOM_ORCHESTRATOR` in a `finally` block and combines
rendering and disposal failures instead of leaving its frame callback/global
alive after an error.

`tests/js/game-colony-gpu-lifecycle.test.js` runs the real game colony bridge,
persistent-body planet renderer and colony surface with tracked GPU doubles.
Six cycles include surface-to-orbit return and re-entry; every owned buffer and
texture must be destroyed exactly once at disposal. Separate regressions verify
release of surface-owned pointer captures on both exit and disposal.
Planet and colony `dispose()` are synchronous lifecycle boundaries. They share
synchronous view cleanup with the awaited `exit()` path, attempt all resource
releases, clear ownership references, and throw aggregated errors afterward.
They must not fire-and-forget an asynchronous exit promise. Terrain cache
cleanup attempts every entry even when one buffer's destruction fails.
An input cleanup failure before animated surface departure skips that animation,
completes the remaining cleanup, and rejects the awaited exit.
View generations invalidate pending entries whenever a newer entry or cleanup
begins. Colony departure interruption resolves the superseded animation waiter,
but its obsolete exit continuation cannot clear the newer view. Disposal is
terminal: subsequent initialization/entry rejects, and a pending colony
initialization skips restoring scene data after disposal.
The orchestrator shares pending level initialization between `setSceneData()`
and `zoomTo()`. Initialization failures release the specific cached instance
before rejecting; registrations remain available for a fresh retry. Registry
release checks instance identity so stale failures cannot evict a replacement.
The outgoing view is not exited before successful incoming initialization.
If partial cleanup also fails, both causes are reported as an `AggregateError`.
After the outgoing view exits, the active view reference is cleared until the
incoming entry succeeds. A transition failure after initialization leaves no
active zoom view: the failed incoming instance is released, an outgoing instance
whose exit failed is also released, flight/camera state is cleared, and the
borrowed backend's zoom-scene flag is reset. All cleanup is attempted before
the original error (or aggregated failures) is propagated. Registrations remain
available for retry. This deliberately does not re-enter the old view using a
potentially stale payload; initialization failures still preserve the old view.
The game adapter checks the zoom runtime's active level on failure. Missing
runtime initialization or an explicitly null active level triggers system
camera recovery before reporting the error. A still-active view is retained
for pre-transition data/initialization failures. System framing attempts camera
restoration even if zoom disposal fails; recovery errors are combined with the
original failure. Awaited ancestor navigation continues to reject to its caller,
but an aborted old navigation cannot restore over a newer view.
On a frame-rendering failure, the colony bridge attempts disposal and system
return independently, then reports the original error and any cleanup/return
failures together. If the error callback itself throws, its error is aggregated
with the reported failure and propagated to the frame caller. Disposal settles
pending camera/entry work before return or reporting callbacks run; a stale
frame hook cannot repeat recovery after the bridge has been disposed.
Terrain streaming checks request cancellation before CSRF acquisition, after
CSRF body decoding and before the terrain POST. Disposal clears the manifest,
CSRF token, LOD plan and CPU tile caches before aborting pending work. A throwing
abort still propagates to the caller, but cannot retain stream data or make
repeated disposal retry it. Late manifest/tile bodies cannot repopulate a
disposed stream.
Colony snapshots check active state and request generation both before HTTP
body decoding and after the awaited result. The legacy building fallback keeps
confirmed scene data, but reports request failures and unsuccessful responses
through the HUD, `GQLog` and the scene's existing `onError` callback. Superseded
or disposed reads cannot report stale fallback errors to a newer view.
Terminal disposal also releases CPU ownership: planet/colony snapshots,
navigation callbacks, terrain/material references and colony geometry are
cleared even when GPU destruction reports errors. Terrain streams clear their
view callback and the game bridge clears its current payload. A normal exit
retains scene data for re-entry; disposed renderers reject `setSceneData()` and
`setNavigationHandlers()` instead of retaining new references. These are
reference-release checks, not a measurement of browser garbage collection.

`tests/e2e/colony-gpu-lifecycle.spec.js` exercises those same render classes on a
native shared WebGPU device/context with six round trips, validation scopes and
tracked allocation/destruction. It also submits work after disposal to check
that the borrowed device remains usable. Run with `GQ_WEBGPU_SHADER_CI=1` in the
WebGPU workflow: a missing adapter fails rather than skips. Local runs without
an adapter are explicitly skipped. This fixture has no authenticated server
snapshot; it is a buffer/texture lifetime contract, not a proof of total driver
memory reclamation or the complete logged-in game lifecycle.

The zoom orchestrator shares backend initialization across repeated/concurrent
callers; failed initialization may be retried. Injected backends are borrowed,
whereas backends returned by its own renderer-factory call are owned and disposed
after view cleanup. Late factory results after disposal are disposed immediately
without installing a loop. Late injected initialization never installs a hook
or destroys the borrowed backend. Terminal disposal clears canvas, options and
backend references; late cleanup errors reject the pending initialization.

Event dispatch uses a stable listener snapshot, attempts all callbacks and
throws an `AggregateError` for callback failures. The owned RAF loop stops and
disposes the orchestrator on a rendering error, then propagates the original
error (or render/cleanup aggregate) to the browser. Shared-backend frame hooks
continue to use the colony bridge's recovery/error-reporting path. Neither
failure nor disposal during rendering may schedule another owned RAF.

Renderer-triggered building, surface and back navigation returns a promise with
an attached failure handler. When configured, orchestrator `onError` receives the
failure after transition cleanup; the game colony bridge forwards it to the
existing UI recovery/error path. Without that callback the returned promise
rejects to its caller. Direct `zoomTo()` remains rejecting regardless of this
option. A throwing error callback produces an aggregate of both errors; late
navigation failures after disposal do not notify a closed view.

Navigation bindings also check the active renderer, entry generation and
transition/disposal state. Exiting invalidates the old binding even if the same
cached renderer is subsequently re-entered. Live building-detail transitions
retain the current surface binding; failed incoming initialization before exit
does not invalidate the outgoing view's still-usable binding. Obsolete callbacks
are cancellation no-ops, not failed user navigation.

Live building-detail fast paths use the same transition-failure cleanup as full
view switches. The shared renderer is released under its colony-surface registry
key, not the virtual building level. `validateBuilding()` runs before transition
mutation so unknown/foreign targets reject without discarding the live surface;
camera or notification failures after validation clear it and permit fresh entry.
Disposal during notification prevents publication of a new building level.

Full view switches recheck disposal after synchronous external callbacks:
exit notifications, transition-source setup, navigation binding and backend
activation. A callback may close the runtime; the continuation must then stop
before binding/entering a disposed view or starting a new camera flight.
The browser wrapper lifecycle gate includes exit-callback disposal for both
shared frame hooks and owned RAF scheduling.

Pending scene preloads and full view transitions also verify registry instance
identity after asynchronous initialization/exit/entry. Replacing a registration
retires its old instance; late continuations cannot update or activate it.
Retired initialization/entry completion runs idempotent cleanup even on failure,
without evicting the replacement. This cancellation keeps the new registration
available for a subsequent transition.

Replacing an active registration also clears its active/camera references,
invalidates navigation and resolves a pending flight without publishing a late
entry event. Building detail is detached through its surface registration.
Rendering and navigation check registry identity even during reentrant disposal;
transition-source, navigation-binding and backend callbacks cannot restart a
retired renderer. Cleanup attempts flight cancellation and backend reset even if
renderer disposal fails, reporting all failures. Invalid registrations leave the
current view untouched. The colony bridge returns false for cancelled entries.
Browser wrapper cycles cover active replacement and fresh mount without taking
ownership of the borrowed backend.

Flight completion is committed only after target resolution and effect callbacks
have succeeded, including on the final frame. A callback failure clears the
flight's owned references, rejects its pending promise and throws to the frame
caller. Transition cleanup handles the rejection; the frame owner remains
responsible for reporting/recovery of synchronous failures. Successful completion
also releases target, collider and effect callbacks without losing the returned
final camera pose. Reentrant disposal/replacement invalidates the old frame before
remaining callbacks or camera publication; subsequent flights never inherit effects.

Planet and building flight setup validates options, endpoints, target resolution
and computed control points before committing state or rejecting the old flight.
Failed setup leaves the previous flight and its pending promise untouched.
Missing endpoint coordinates retain their zero default; non-finite coordinates,
duration and blur are rejected. Omitted/non-positive finite duration retains the
existing default. Options and colliders are snapshots, but the selected target
object/provider remains live. A generation check after target setup prevents
reentrant disposal or a newer flight from being overwritten by the old setup.

Active flight frames require a finite, non-negative numeric delta; zero is valid.
The existing time-unit convention remains: values up to one represent seconds,
larger values milliseconds. Invalid deltas fail through the same rejection and
cleanup path as target/effect errors. The driver uses its existing fixed 16 ms
step, but position, target and control publication now belongs to the guarded
frame transaction: success is committed only after publication succeeds.
Setter/control/look-at errors reject the flight, including on its final frame;
missing active driver context is an explicit error. Reentrant cancellation or
replacement stops remaining writes/controls updates without affecting the newer
flight. Already applied camera writes are not rolled back.

The colony bridge invalidates pending surface loads when accepting back/ancestor
navigation, even when the requested ancestor is already active. Invalid/downward
or busy navigation does not supersede accepted work. Overlapping approaches are
rejected before changing the revision or pending approach reference. Surface
loads still await an accepted approach flight, then require an idle transition
and confirmed planet entry before entering the colony. Cancelled prerequisites
cannot be bypassed. Return payloads are committed only after confirmed entry;
loader failures continue to reject to the caller without discarding a usable
view. Stale responses cancel without allocating colony resources.

Colony input forwarding (reset, rotate, pan, zoom, selection and nudge) and
snapshot refresh require an active colony/building renderer and no transition.
Late UI events during exit, after replacement, or after disposal are ignored.

The galaxy-level camera tween also owns a generation-bound shared frame hook.
Navigation/disposal invalidates that generation before removing the hook, so a
captured callback cannot write camera state after it becomes stale even if hook
removal throws. Invalid time deltas or pose/update callback failures stop the
tween and are reported once; remover failures are aggregated with the frame
failure instead of leaving a repeatedly failing callback active.

Fleet endpoint projection observers use the same explicit callback ownership:
manual removal invalidates publication before detaching, and adapter disposal
disables callbacks even if native hook removal throws. A failed synchronous
initial projection rolls back the just-installed observer and aggregates any
removal error. Reentrant disposal during hook installation does not publish an
initial snapshot.
When hook removal fails, the inactive observer remains tracked with its remover
so the caller or repeated adapter disposal can retry and release the native
reference. Per-frame projection failures disable the callback, retry removal,
and report the projection and cleanup errors once.

The colony bridge's owner AbortSignal remains bound after initialization.
Aborting disposes the runtime, clears its published global and frame hook,
cancels flights and invalidates pending entry continuations without triggering
system-return navigation. Disposal and failed initialization remove the listener.
Signal-event cleanup errors are delivered to the configured error callback;
manual disposal continues to throw cleanup errors synchronously. Galaxy teardown
detaches its runtime references and explicitly disposes before aborting its old
controller in a finally block, preserving its existing error contract.
Externally supplied data loaders retain responsibility for request cancellation;
their late results cannot reactivate a disposed runtime.

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
