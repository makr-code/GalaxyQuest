# GalaxyQuest — Architecture

> A technical reference for contributors and maintainers.  
> For the high-level "what", see [README.md](../../README.md).  
> For the "what's next", see [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md).  
> For the game engine specifically, see [webgpu_architecture.md](webgpu_architecture.md).
> For staging/production infrastructure and delivery, see [Plesk deployment](PLESK_DEPLOYMENT.md).

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

The start-page system log shares its host with the game console. Its status line
shows the latest log entry, not an aggregated health check; warnings and errors
retain their textual severity. Errors open the log without moving focus and
are announced through a dedicated polite live region. The log itself is
keyboard-focusable and does not announce every incoming line. Both the early
boot fallback and the optional terminal logger follow new entries only while
the reader is already near the bottom. On logger takeover, the bounded fallback
history is imported into the current session before the logger renders it.
The game's window-manager console retains its own controls and lifecycle.

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

### Earth geography inspection fixture

The development-only [Earth reference](../../tools/earth-reference.html)
uses local NOAA ETOPO1 ice-surface heights/bathymetry (default) or selectable
public-domain Natural Earth 1:110m land and lake GeoJSON.
One geographic polygon source drives triangulated continent/lake meshes,
coastline overlays, a 2048 x 1024 color raster and CPU location queries.
Separate geometry-only, texture-only and combined views expose discrepancies
instead of concealing them under procedural noise. WebGPU is required; failure
is reported rather than silently selecting another backend.

The reference uses Greenwich +X, north +Y, east -Z. It conjugates the shared
production rotation basis by a Z reflection to preserve prograde rotation
without mirroring continents; production terrain coordinates are unchanged.
Rotation is opt-in, sidereal and real-time (23.9344696 hours, 23.43928-degree
tilt), starting at a fixed J2000 reference instant. This is not a precise
Earth ephemeris. The shared `PlanetLivingWorld.bodyOrientation` computes
orientation analytically, without adding an economy tick or scheduler.

The default view uses the real `PersistentBodyPlanetApproachRenderer` with an
opt-in, backend-only authored-geography adapter. Shared body material, water
normal, lighting, cloud turbulence and atmosphere-rim shaders remain in use.
Only that shader variant adds authored texture/options bindings; ordinary
procedural planets retain signed-height material boundaries. Geometry-only
uses mesh material classification, while texture-only uses the raster mask,
so their comparison does not simply compare the same mask with itself.
An external projection/scale and fixed-time clock preserve the reference
camera and epoch. The adapter reuses production orbital LOD thresholds and
hysteresis; its CPU mesh LRU is bounded to 32 MiB. The renderer owns uploaded
mesh buffers but borrows the adapter's texture/options resources and device.

ETOPO1 is vendored as a checksum-pinned 721 x 361, 0.5-degree Int16 metre
grid, subsampled from the original one-arc-minute source. One bilinear
sampler drives geometry, height colors and sea classification. Geometry-only
uses the production signed-height mask; texture-only samples the height-derived
color/mask raster on a unit sphere. Exaggeration (1..40x) changes geometry only;
the source heights and colors remain unchanged. The sea datum (-500..500 m)
clamps displayed vertices; disabling the sea exposes measured seafloor and
disables liquid material classification. This is a coarse elevation threshold,
not a hydrological flood or lake model. Dateline endpoint rounding and polar
convergence are reconciled during sampling without rewriting the source.
ETOPO and vector coastlines are separate modes, not inconsistently combined.

In Natural-Earth mode, ice/tropical/temperate/desert colors remain schematic
masks, not measured climate or satellite imagery. Continents have constant
exaggerated relief and lakes are overlaid water surfaces. The separate
selectable baseline uses Three.js materials and a translucent atmosphere
shell; production mode uses its real rim contribution and procedural clouds.
The baseline remains a polygon reference without DEM, with relief controls
disabled. ETOPO is too coarse for local peaks or exact shores; no measured
cloud/weather dataset is supplied. Orbital
distance filtering intentionally suppresses metre-scale water waves.
This tests the production orbital shaders with authored geography, not the
procedural geological generator, terrain streaming, coastal refinement,
gameplay surface picking, colony building meshes or economic simulation.
ETOPO inspection additionally supplies a backend-owned optional `surfacePlan()`
to the real planet renderer, reusing the existing colony planner, uniform
buffer and living-surface shader. Twelve explicitly synthetic named-city
fixtures expose night emission, with DEM-based flooded-anchor exclusion and
shared water masking. A power-only toggle preserves daytime urban footprints;
unlit/diagnostic modes suppress emission, and geometry-only/vector/baseline
views have no reference settlements. No gameplay state or additional GPU
resources are introduced. Authored appearance alone uses radial day/night
ambient attenuation (0.3 to 0.003 in linear light) and a narrow direct-light
terminator gate; ordinary procedural planet lighting stays unchanged.
An independent synthetic development timeline (years 0-200, 12 million to
120 billion people, default 120 million) feeds the same colony planner.
Its square-root population radius law grows both daytime urban footprints
and night-time luminous area continuously, retaining seeded districts, dark
gaps and a hierarchical road pattern. The future range previews nearby centres
merging into metropolitan regions. This represents area growth, not diurnal migration
or an authoritative population simulation. Optional 60-second playback uses
the existing frame loop, pauses for visibility/reduced-motion/animation policy
and non-shaded views, clamps at the end, and updates only colony uniforms.
Manual timeline scrubbing remains available with reduced motion.
Reference residential/agriculture/industry/trade/science/mixed selectors feed
synthetic completed-building snapshots through the shared production planner;
they are not new authoritative colony types or economic bonuses.

In production ETOPO mode, point inspection raycasts the actual uploaded
triangle mesh through the current camera projection and inverse physical
orientation. The nearest hit yields coordinates, source metres, expected
sea-clamped height and an un-exaggerated mesh height. The difference explicitly
includes LOD/chord interpolation, not just source-data error. Texture-only
does not report a relief error. Pointer drags do not select; changed settings
clear snapshots, and misses are visible. This is reference-only inspection,
not authoritative gameplay picking or a validation of production colony picks.

The reference-only ETOPO detail selector defaults to production automatic
LOD, with fixed 32/64/128/180-row alternatives for reproducible comparisons.
The 180-row mesh uses 1-degree cells (129,600 triangles, about 17.8 MiB of
vertices), within the existing 32 MiB CPU LRU budget. Fixed detail does not
alter production thresholds, vector meshes or the 0.5-degree source raster;
automatic hysteresis retains a separate valid production resolution.
Point snapshots include their mesh resolution. Lower error at a sampled
mesh vertex is not a guarantee of higher source accuracy or monotonic
improvement between vertices.

The authored Earth material variant optionally binds a 1024 x 512 linear
`rgba16float` slope/roughness/F0 map plus appearance options. Physical
0.5-degree ETOPO height differences reconstruct canonical east/north normals;
water is flattened, longitude wraps and polar gradients remain finite.
Eleven averaged mip levels filter these values without sRGB conversion.
Bump strength is independent of mesh exaggeration and does not change
geography or picking. Albedo can switch between height colors and explicitly
schematic climate/rock colors without changing the DEM water mask.
Roughness and dielectric F0 are material assumptions, not measured maps.
The shared GGX helper accepts supplied F0; default `gqDirect` retains 0.04.
Ordinary planets and adapters without appearance resources keep their
existing shader bindings. Unlit albedo, canonical normal, roughness and F0
diagnostics isolate maps from lighting/clouds.
An opt-in city-material diagnostic scope keeps those terrain-only defaults.
It returns after `gqLivingSurface` to expose composed albedo, canonical shading
normals and roughness, without emission, lighting, clouds or rim tint.
F0 still reports the authored dielectric value. The adapter packs this flag
in the previously unused `appearanceOptions.cloud.w`; buffer sizes and normal
shaded output are unchanged. The control is disabled outside ETOPO material
diagnostics and geometry-only views never receive a colony plan. Switching
back restores terrain-only diagnostics exactly. Diagnostic playback remains
paused, so the selected snapshot can be inspected reproducibly.

An adapter-owned WebGPU fullscreen sky draws before the body, on the same
device/pass without depth writes. Inverse camera projection anchors seeded
stars and a light-aligned solar glow; an illustrative spherical limb halo
follows the atmosphere toggle. Neither a real star catalogue nor physical
atmospheric scattering is claimed. Shared cloud turbulence supplies shell-mode
projected shade and legacy-mode local surface shade in the authored variant.
The Earth adapter also offers an opt-in metre-scale Berlin quarter through
`earth-reference-city.js`. It builds at most 576 fixed 60 m parcels from a
conservative core-population snapshot, with physical footprint/height values
converted by the Earth radius in metres. Five radial mesh intersections per
building anchor a foundation to the actual drawn triangles, excluding water.
This is a bounded cosmetic geometry sample, not the existing managed-colony
layout rescaled or a full demographic city simulation. A lazy instanced
pipeline uses the existing depth pass before clouds and skips subpixel
buildings in orbit; no extra canvas, scheduler or server persistence is added.
The inspection button targets the local surface from 2 km height; region
navigation restores the original orbit camera. Externally supplied projection
matrices now retain their actual eye distance for consistent close shading,
while automatically framed cameras preserve their previous bounds.
A phase control exposes the existing 120-second loop; pause/reduced-motion
policy and orbital water-normal distance filtering remain effective.
The adapter owns the additional texture/uniform/sky resources and disposes
them without destroying the borrowed device.

The optional `earth-reference-mine.js` reference excavates an approximately
4 by 3 km synthetic Lausitz basin directly into the Earth mesh: eight 30 m
terraced stages reach a 240 m floor, independently of relief exaggeration.
A fixed seed varies the rim. Local adaptive subdivision retains original
triangle planes outside the pit; the existing 32 MiB mesh/cache limits still
apply. Flooded reference anchors are excluded. Excavation uses existing
terrain buffers/pass, with strata vertex colours, geometric normals and
rough materials overriding authored DEM detail. Default map diagnostics
remain unchanged; composed diagnostics include the excavation material.
The inspection camera targets the actual floor from 5 km with an adaptive near
plane, restoring globe navigation on region/reset. The reference adjusts
clipping every frame to one percent of navigation-target distance, bounded
between 1 m and 0.01 Earth radii. Keeping the original 1 m close-inspection
near plane during free zoom back into orbit otherwise collapses 24-bit
front/back depth and produces black triangle artifacts. GPU regression
coverage reproduces that failed depth configuration and checks automatic
recovery against the normal orbital clip range.
The shared planet-approach fragment shader also rescales each world-position
derivative before its cross product, then normalizes the result. A fixed
absolute area floor previously collapsed small-face normals towards zero,
changing lighting and eligibility as the camera approached. Degenerate
derivatives use the interpolated unit normal instead. A scalar GPU probe
checks unit length and direction over four derivative scales and zero area.
This is a fixed cosmetic
sample, not actual mine survey data, geology, groundwater, machinery, ramps
or an economy-driven extraction lifecycle. No server persistence is added.

Authored Earth clouds default to a separate analytic spherical sheet.
The renderer's backend-only foreground hook draws it after terrain, with
projected fragment depth, a `less` depth test, no depth writes and
premultiplied display-space blending into the existing unorm target.
The shared cloud noise, seed, canonical body basis, phase and motion/effect
policy remain authoritative for its appearance; no extra frame loop or
cloud mesh is allocated. The 12 km radius offset is independent of terrain
exaggeration; 80/200 km are inspection-only offsets. Exaggerated terrain may
pierce the layer and is correctly depth-tested. A legacy surface-only
comparison remains selectable without drawing both white-cloud layers.
Diagnostics suppress clouds; this is not volumetric weather.
Cloud morphology now combines continuous seeded 3D lattice fields at three
scales: large weather envelopes, rounded billows and fine edge erosion.
A smoothly weighted warped ribbon field introduces elongated frontal bands
within those envelopes instead of the previous two periodic sine products.
The existing looped domain warp deforms all scales together. Each scale fades
before aliasing; unresolved density still converges to 0.5. Cartesian sampling
avoids longitude seams and polar singularities. The shared field is used by
orbital/cloud-shell shading, projected shadows and the managed-colony sky.
The Earth sheet converts coverage to opacity with `1-exp(-2*coverage)` and
varies daylight brightness with thickness, keeping premultiplied blending.
No new GPU resources or persisted weather state are required.
This improves cloud-field morphology, not physical geometry: the cloud sheet
still has one altitude, without volumetric towers, multilayer cirrus,
meteorological circulation or geographically calibrated precipitation.
The Earth cloud sheet also samples coverage a short distance toward the sun
in the spherical tangent direction. Denser sunward neighbours attenuate the
daylight tone through a bounded optical-relief helper (factor 0.55 to 1),
strongest for oblique light and zero directly overhead. The extra sample is
skipped for clear/deep-night pixels, unlit mode and unresolved detail.
Both sample footprints are computed before intersection discard; the displaced
sample is transformed into the same canonical frame as the visible density.
Relief changes RGB only, never alpha, depth, silhouettes or projected terrain
shadows, and cannot brighten clouds beyond their unoccluded tone. Distant
relief fades smoothly to flat shading. This is illustrative local occlusion
on a single sheet, not volumetric self-shadowing or measured cloud thickness.
GPU checks compare against an otherwise identical flat cloud shader, require
daylight darkening without brightened pixels, and exact unlit equivalence.
The adapter owns the additional uniform buffer.
Manual world-space sun azimuth/elevation feed a single normalized direction
to terrain/specular shading, cloud day/night brightness and sky sun/halo.
These controls do not imply geographic solar coordinates or an ephemeris;
the separate baseline retains its fixed original light.

An optional solar-atmosphere comparison (default on in the reference) uses
the shared `gqOrbitalAtmosphere` tint/weight helper for both authored surface
rim and external halo. Radial sun cosine selects blue daylight, warm
twilight and zero deep-night contribution. The legacy comparison restores
the previous rim/halo behavior; the master toggle and diagnostics still
suppress atmosphere. The helper is an artistic approximation, not an optical
Rayleigh/Mie integrator, computed sunset or refractive model. No bindings,
resources or normal production-planet rim behavior change.

Shell-mode shadows intersect a directional sun ray from each actual terrain
fragment with the cloud sphere. The shared canonical noise, seed, phase and
projected derivatives determine density at that intersection; cloud height
and solar angle therefore change the shadow offset. The expanded 32-byte
appearance uniform holds material flags plus cloud radius/shadow flags,
without new bindings or shadow maps. Transmission `1 - 0.55 * density`
attenuates only direct GGX sunlight, including specular. Ambient and emission
are unchanged. Night/near-terminator weights fade to zero and terrain at/above
the shell is excluded. Cloud-off, unlit and diagnostic comparisons suppress
shadows; the legacy surface comparison retains its original local shade.
This is a single-sheet appearance approximation, not volumetric optical
transport, a finite-sun penumbra model or terrain self-shadowing.

See [source hashes, limitations and validation](../../tools/data/earth/README.md).
The browser contract compares actual geometric and textured land/water pixels
across six globe views, excluding a two-pixel boundary footprint, and checks
east/north projection, layer controls, rotation and disposal.

### Terrain material boundaries in persistent WebGPU views

The persistent planet approach and colony terrain classify water, lava and snow
from interpolated signed elevations, not interpolated numeric material IDs.
Each terrain vertex carries height relative to the manifest sea level and
snowline, plus body-wide liquid/snow flags. The shared body material evaluates
these boundaries in the fragment shader with a derivative-based, approximately
one-pixel antialiasing band. Flat surfaces exactly at a threshold retain the
dry/unfrozen classification. Snow is suppressed under liquid, avoiding phantom
intermediate materials on triangles that connect land and water.
Classification uses geological height before city grading, so preparing a city
floor cannot move the canonical coastline. The local non-persistent terrain
fallback retains its existing graded-height and -0.5 sea-level convention.

Boundary masks blend PBR albedo, roughness and lava emission independently of
filtered procedural microdetail. This is not a global sharpening postprocess.
Water coverage also blends the perturbed rock micro-normal back to the
canonical geometric normal, then normalizes it. Both persistent renderers
pass that normal in the same canonical frame as their PBR lighting. Fully
submerged fragments therefore no longer inherit terrestrial noise in water
highlights; partially covered coast fragments interpolate with the same
antialiasing mask as color and roughness. Dry ground, ice and lava retain
their existing micro-normal detail, with water roughness 0.16, ice roughness
0.38 and the base lava emission unchanged.
The persistent orbital and city renderers then add seeded, two-scale moving
water normals in that same canonical frame, excluding explicit prepared
foundations. Smooth procedural gradients follow a repeatable 120-second loop;
pixel-footprint and projected-detail filtering suppress unresolved ripples.
The existing render callbacks advance a separate bounded phase, including
orbital backdrops. Live reduced-motion settings freeze/resume that phase;
hidden views do not advance it, and disabled VFX or reduced-flash settings
use calm water. Time and enable flags occupy previously unused material
uniform padding, keeping the 112-byte layout and resource count unchanged.
These are visual normal waves, not displaced water geometry or fluid physics:
no timers, textures or simulation are added, and terrain triangles stay intact.
Lava coverage in these two persistent renderers also receives slowly drifting,
seeded triplanar emission detail at 32 m and 8 m scales. The same canonical
anchor split, bounded phase and enable flag keep it aligned with local/orbital
coordinates and apply the existing reduced-motion freeze/resume, visibility,
VFX-off and reduced-flash behavior. Pixel-footprint and projected-detail
filtering restore the base emission when unresolved; prepared foundations
exclude the effect. The modulation is bounded to +/-18 percent of the base
lava emission, weighted by antialiased lava coverage, without altering its
color ratio, surface albedo, normals, roughness or metallic value. There are
no added lights, particles, timers, geometry or resource allocations; this is
visual glow advection, not lava flow simulation or a fire/damage system.
Local industrial building profiles in the city renderer now emit seeded smoke
puffs rather than additive amber particles. Each puff rises and drifts over an
eight-second lifetime, expands and fades smoothly to zero at birth/death.
Body terrain seed and stable building coordinates/type preserve puff identity
across snapshot rebuilds; no damage or fire status is inferred from industry.
Construction, power, research and other existing particle profiles retain
their additive rendering. Smoke uses soft radial coverage and standard alpha
blending in a separate pipeline/draw range of the same view-owned vertex
buffer (40 bytes/vertex). Existing emitter/quality limits and the 900-particle
ceiling remain; there are no textures, lights, timers or extra render passes.
The existing city frame callback advances particle motion; live reduced-motion
freezes/resumes it, while hidden/off VFX suppress opacity. Runtime building
slot mapping preserves activity/power/visibility/effect state, so disabled
buildings do not acquire active industrial plumes. Rebuilds remove stale
emitters and exit/disposal releases their buffer. This is decorative local
smoke, not atmospheric transport or a damage/fire simulation; satellite
proxies, the orbital view and map-based paths have no new smoke emitters.
Unit tests cover seeded rebuilds, state gates, live motion policy, bounded
particle counts, separate alpha/additive draw ranges and buffer teardown.
A GPU readback verifies soft edges, darkening rather than additive glow,
transparent disabled output and the unchanged shape of non-smoke particles.

Persistent orbital clouds and the city's cloud shell/crossing veil now share
a seeded three-dimensional, domain-warped density function. A bounded
120-second circular drift plus slow harmonic warping deforms the cloud mass
rather than merely translating a fixed image. Orbital sampling uses canonical
body direction instead of longitude/latitude texture coordinates, removing
the longitude wrap discontinuity. The city shell/veil retain their existing
local scales and cloud-altitude/fog rules; this is not a continuous global
weather simulation or matching storm geography between views.
Broad and fine density detail fade by pixel footprint, with shell derivatives
evaluated before ray-intersection discards. Both paths reuse the existing
surface-animation phase: reduced motion freezes/resumes drift and deformation,
reduced flash uses a fixed phase, and hidden/off VFX suppress cloud coverage.
The city phase no longer follows the unconditionally advancing camera clock.
Orbital cloud coverage now honors the same atmosphere absence/strength and
explicit coverage metadata as the city, including airless bodies and zero
coverage. Atmospheric haze remains separate. City seed occupies existing
camera padding; orbital coverage/strength use existing uniform components.
No textures, timers, geometry, render passes or buffers are added.
GPU readbacks measure deformation beyond rigid translation, deterministic
seed/phase output, temporal-loop and spatial continuity, bounded density,
zero coverage and minification. Renderer tests check live policy changes,
phase uploads and atmosphere/coverage gates in both paths.

The alternate map-based Three.js/WebGPU approach paths still use static water
and lava.
An actual GPU float readback checks normalized normals, half-covered
transitions, albedo, roughness, metallic and emission separately, including
measurable dry-ground microdetail, deterministic repeated renders, moving
water, loop repeatability, filtering and unchanged non-target materials.
It separately measures lava motion, seeded spatial variation, loop-boundary
continuity, half-covered emission blending, anchor invariance, bounded
emission/color ratios and preservation of all non-emission material channels.
Terrain vertices now occupy 48 bytes (12 floats); the bounded terrain LRU grows
proportionally from 8 to 12 MiB to retain equivalent cached LOD coverage.
The canonical orbital sphere selects 32 by 64, 64 by 128 or 128 by 256 cells
from projected diameter, with 15% hysteresis around 256/768-pixel thresholds.
At the closest level, liquid-world coast edges with significant midpoint
geological-height error are ranked and up to 8,192 receive one subdivision.
Both neighboring triangles share each split, including longitude seams and
poles; one/two/three-edge triangulation avoids T-junctions. This adds detail
where linear elevation interpolation is least accurate without evaluating the
entire generator per fragment. Final 48-byte GPU vertices are limited to
12 MiB. Zoom-level changes replace/destroy the old buffer; ordinary frames and
small threshold oscillations reuse it. Picking consumes the same refined
vertex layout. Seeds and server terrain data are unchanged.

Coast shape still follows the sampled mesh; this is not per-fragment evaluation
of the entire geological generator. Authored GeoJSON region colors retain
their explicit transition widths. The real WebGPU coast
fixture checks at most two transitional pixels and less than one pixel of
sea-level displacement, along with liquid/snow exclusivity, flat thresholds
and deterministic output.

The separate map-based planet approach (native WebGPU and Three.js standard
material) now separates dry surface detail from a continuous public geography
map. `GQPlanetTexturePipeline.terrainRelief()` samples a deterministic spherical
field, continuous across longitude and constant at the poles, rather than
deriving land boundaries from the old decorrelated per-texel bump noise.
`PlanetLivingWorld` samples it at texel centers into a linear, non-sRGB
geography texture. Color/cloud/night maps retain their 64/128/256 width
policy; geography independently uses 256/512/1024 by 128/256/512 texels.
Elevation is rounded to 16-bit UNORM and packed high-byte/low-byte into RG
of an ordinary `rgba8unorm`/Three.js no-color-space texture. Both shaders
decode the filtered channels with `dot(rg, vec2(256/257, 1/257))`.
Because that operation is linear, filtering commutes with decoding even
across byte carries; no integer rounding may be applied after sampling.
This needs no float-texture features, extra samplers or additional textures.
Both shaders interpolate elevation first, then classify water and polar ice
with derivative-sized antialiasing. Water color/specularity or roughness and
ice color are applied after classification, not bilinearly blurred together
as already-classified color texels. Candidate night lights remain public;
the fragment masks suppress them over water/ice and existing view uniforms
still control actual activity. Cloud motion is independent.

Each map renderer owns four textures (dry color, clouds, candidate night
lights, geography) and frees all four on replacement/exit/disposal. The CPU
LRU still holds at most eight public bundles, never ownership/economic state.
Maximum retained CPU map bytes are 20 MiB across eight high-quality bundles;
one high-quality renderer uploads 2.375 MiB of texels in its four textures,
excluding driver overhead and uniforms. The preview-only surface color map
is retained on the CPU but not uploaded. Replacements free the old textures.
The map descriptor is versioned `planet-pipeline-4` to distinguish the new
precision/layout. This is a deliberate visual change in the legacy approach,
not a change to persistent canonical terrain, colony locations or gameplay.
The old CanvasTexture/server-texture pipeline remains byte-compatible; the
map approach's spherical field is not a second authoritative terrain model.
Finite map resolution and bilinear reconstruction still limit shape accuracy
even when the fragment boundary itself is sharp. The spherical field and its
seeds do not change with this precision upgrade. Tests compare interpolated
geography with the exact field across three seeds (at least 80% lower mean
absolute error than the old low-resolution 8-bit map), check 16-bit rounding,
byte carries, cache bytes and actual upload dimensions. Production WebGPU and
Three.js shader readbacks check at most two transitional coastline pixels,
projected threshold position and distinct coverage for sea-level changes of
0.00005, below the old 1/255 elevation step. The Three.js coast measurement
excludes the mesh's multisampled silhouette; its projection tolerance is
three pixels versus one for the native analytic sphere.

### Seeded settlement and economic surface presentation

`js/rendering/colony-surface-plan.js` adds a versioned, deterministic visual
read model to the persistent WebGPU planet approach and colony surface. It
samples 768 equal-area spherical candidates against the existing canonical
terrain, rejects water, steep ground and unsuitable ice/high-altitude regions,
and selects at most 12 geographically separated anchors. Persisted valley-dome
sites remain primary. Candidate identity depends on terrain seed and generator
version, never on camera, owner, population or economic specialization.
There is no new economy tick, scheduler, resource deposit or gameplay building.

Population activates a stable prefix of anchors (one at up to 1,999 inhabitants,
then one additional region per population doubling, capped at 12).
Without persisted development enabled, the count is derived only from the
current snapshot and shrinking population deactivates satellites. With
`BODY_DEVELOPMENT_ENABLED=1`, the server retains a body-wide high-water mark;
anchors above the current active count remain present as visitable ruins.
Existing managed buildings remain in the primary city with unchanged selection
keys, levels and gameplay effects. Its local terrain frame points at the same
canonical primary anchor seen from orbit. The geographic candidate list is
reused until the manifest changes; snapshot updates only rebuild development.

The surface HUD's settlement selector visits active satellites in their own
canonical terrain frames. Each visited satellite creates one bounded instanced
decorative city (8 by 8 fixed lots, at most 64 occupied lots and fewer than 512
cuboid parts). Independent per-lot hashes keep houses stable during population
growth and ownership changes. Economic lots show agricultural rows/greenhouses,
extraction rigs or industrial halls from the existing capacity mix.
Ice/rock/lava satellites receive a visual shelter; the primary persisted valley
dome is not relocated or reused as the satellite's geographic anchor.

Only the selected site's detailed geometry is resident. Switching sites
releases the old instance/terrain buffers without creating new pipelines or
duplicating the building inventory. Satellite views contain no authoritative
building slots, building detail selection, production VFX or invented people.
The Buildings action can still open colony-wide management. Switching is
disabled while inspecting a primary building. Site changes reset the local
camera without inventing a flight through the planet; return to orbit and
re-entry preserve the selection. Snapshot updates retain a still-active site;
if population decline deactivates it without history, the HUD explicitly reports
the return to the primary site. With history, the selected site remains in view
and switches to ruins instead. An unknown direct selection request throws.

Built, non-orbital farm/hydroponics, extraction and industrial levels determine
mixed land-use proportions. Construction with no completed level contributes
no capacity. Farms use field parcels, extraction uses terraced color bands,
and industry uses sealed/darkened ground; urban blocks and activity/damage-aware
night lights share those anchors. Procedural shader masks modify albedo,
roughness and emission without baking private state into public terrain caches.
The completed colony-wide sector capacity is distributed over active anchors
using positive geographic suitability weights: flat temperate lowlands favor
outdoor agriculture, elevated/rough terrain favors extraction, and flat sites
near the primary favor industry. On non-agricultural biomes, flat terrain
instead favors protected cultivation; this does not enable outdoor fields.
These are visual suitability proxies, not soil, ore deposits, actual freight
accessibility or production modifiers. Primary proximity is geographic only;
it does not imply a passable regional road. The persisted valley floor is
treated as a prepared flat site.

Each sector's regional capacity sums to its original completed-building
capacity; each active site's normalized mix drives the shared GPU land-use
masks, decorative satellite modules and localized orbital/English surface
labels. Sites below 50% dominance are labelled mixed economy. The primary's
authoritative building inventory stays untouched even if its visual region
favors another sector. Regional extents use local capacity relative to the
active-site average; freight corridor coloring uses endpoint regional mixes.
Growth or economic snapshots may redistribute the mix, but never relocate
anchors, roads or residential lots. Ruins receive zero capacity and no
specialization label; recovery recomputes the same distribution for the same
inputs. No historical economic specialization is invented.

Water/lava materials, steep surfaces and explicit terrain-region overrides are
protected. Outdoor agriculture is restricted to terran/ocean biomes; protected
hydroponic buildings remain part of the existing city geometry on other worlds.
Detail is footprint-filtered rather than independently randomized per zoom.
The shared material adds seeded crop parcels with alternating row orientation
and darker boundary strips, elliptical quarry pits with bench bands, and
industrial roof/yard/loading-strip patterns. Each sector also modifies
roughness: rough field margins and quarry floors contrast with smoother
industrial roofs. These are albedo/roughness cues only, not terrain excavation,
normal displacement, extra meshes or independently selectable buildings.
Economic detail emits no new light and does not change weather, production
or the protected cultivation rules.

Outdoor crop canopies also receive restrained traveling wind-light bands,
with seed/site-specific direction and phase. This is a maximum eight-percent
linear-albedo modulation inside existing field margins, not moving parcel
borders, individual stalk geometry or a physical wind simulation. It reuses
the water material's bounded 120-second phase and enable flag, so the existing
orbital/city callbacks, backdrops, live reduced-motion freeze/resume, visibility,
VFX-off and reduced-flash gates apply without new clocks or resources.
Fine-detail footprint filtering fades the bands before they become subpixel.
Roughness, normals, emission, mining, industry, urban cores, ruins and sealed
cultivation are unchanged; existing water/ice/lava, region and slope exclusion
continues to apply. The alternate map-based approach paths have no field wind.

Parcel coordinates use each anchor's canonical tangent frame and a
seed/site-ID hash. Parcel angular scale is derived from body radius
(`12 / radius_km`, bounded to 0.0002–0.006 radians), not current urban radius
or population. Consequently growth, ownership and sector-capacity changes
do not slide the parcel grid; the chosen scale is a bounded visual proxy,
not surveyed field dimensions. Fine crop rows and quarry benches fade before
the parcel structure; unresolved parcels converge to fixed sector averages
for both color and roughness. Orbit and city use the same function and
uniform layout, with no extra resource allocation or render pass.
Regional economic extents grow with built capacity and are bounded in angular
size. Urban masks use world-sized parcels and analytically filtered street
coverage rather than enlarging unresolved city cores to solid light disks;
these regional proxies are not a physical building-area or resource-deposit
measurement.

Both views use the same bounded 26,112-byte view-owned uniform buffer
(12 sites, a road header and at most 64 road segments, followed by
16 facility districts and at most 384 facility components).
Each region packs six aligned vec4s (centre/radius, landscape, tangent/seed,
regional production economy, urban specialization, nearby infill target),
followed by seven cosmetic urban nuclei (direction and signed radius).
The existing farm/mine/industry capacity allocation is unchanged. Completed
ground trade/market/logistics and research/science buildings additionally
contribute normalized civic weights; orbital and zero-level buildings do not.
These weights affect only visual density, block scale, street intensity and
light palette: sparse agricultural settlements, broad industrial blocks and
warm lighting, trade-lit arterials, cooler science districts. Power/activity,
damage and ruin gating still control actual emission. No shader-side economy
or population simulation is introduced.

`FACILITY_VERSION = 1` adds a fixed primary-site district from completed
authorized building rows, without changing the existing city/road offsets.
Sixteen distinct families cover fields, hydroponics, halls, warehouses,
tanks, silos, solar, fusion, research, nanotechnology, health, education,
administration, security, terraforming and drilling. Orbital/star-orbit rows
are excluded; habitats and open pits keep their existing representations.
Processing recipe types map to appropriate families. Each family has one
seed-stable plot; completed levels activate up to three fixed modules rather
than scaling buildings or implying a real facility count. No new history,
timer, server field or client-authoritative economy is introduced.

The shared material shader uses these components' actual metre footprints,
class-specific rows and perimeter lighting. Night/power gating affects
emission, not land use, and unresolved components fade. The production
planet-approach path lazily draws matching instanced boxes, gabled roofs,
cylinders and tilted panels through `colony-facility-geometry.js` in the
existing depth pass before clouds. Five intersections with the actual mesh
anchor each solid and reject water, lava, authored regions and steep ground.
Flat fields/roads stay terrain-conforming material patches. Instance storage
is bounded to 36 KiB, cached by mesh and component plan and released on exit.
The Earth inspector exposes synthetic per-family stock and 1/8 km views;
default-off controls preserve previous fixtures. Diagnostics omit solids.
This district layer does not replace interactive colony slots or satellite
architecture: colony surface views share the footprint shader but retain
their existing local building models. This ground layer adds no orbital model,
transparent greenhouse optics, building self-shadowing or physical
terraforming/environment simulation.

#### Physical cosmetic orbital objects

The shared production planet-approach renderer additionally uses
`colony-orbitals.js` for orbital shipyards, defence stations (`missile_silo`)
and solar satellites. It consumes the existing authorized `orbital_facilities`
summary (an explicit empty summary clears stale embedded stock); completed
building rows are a fallback for shipyards/defence only. Queues and
`star_orbit` installations never become planet-orbit objects. The native
game's existing authorized planet loader already supplies this summary;
surface snapshot refreshes now retain it for the return to planet view.
There is no new station gameplay type, API, persistence or client authority.

The equatorial synchronous radius is `cbrt(GM * (period / (2*pi))^2)`,
using catalogue `mass_earth` and the same signed sidereal rotation descriptor
as the planet. An object fixed in body coordinates therefore follows actual
planet rotation, including retrograde spin and axial tilt. In this context
“geostationary” specifically refers to Earth; other bodies are synchronous.
Absent mass/radius yields an explicit unavailable reason, never an invented
physical orbit. Zero rotation, tidal locking, an intersecting/overly distant
synchronous orbit or an optional Hill bound instead select a genuinely
Keplerian low orbit with the correct relative-to-body angular motion.
The low orbit clears the conservative solid/shape bound plus at least 200 km
or 8% body radius. The visualization limits synchronous radius to 32 body
radii, or one third of an explicitly supplied Hill radius, whichever is less;
if no clear orbit remains, it is unavailable. These are isolated two-body
visual ephemerides, not an N-body stability or collision simulation.

Each class has four fixed seed/identity slots (12 representatives total).
Growth activates slots without relocating or enlarging earlier models;
this cap is a cosmetic stock sample, not the actual installation count.
Distinct metre-scale geometry includes satellite buses/panels/antennas,
station hubs/habitats/launchers, and open shipyard rails/gantries/service
spines. Active shipyards have a bounded 120-second local service-shuttle
loop, explicitly unrelated to authoritative fleets, cargo or surface flights.
Reduced motion freezes that service pose and low-orbit ephemeris; body
rotation retains its existing independent physical clock policy.

Solids use the existing depth pass, physical body orientation and sunlight,
with a simple spherical planet-umbra test (no penumbra, moon or self shadows).
Subpixel meshes disappear instead of silently growing. A native orbital
selector provides tracked close inspection and return to planet overview,
labelled with orbit mode/altitude; unavailable physics is visible there.
The same instance renderer as facilities owns at most 256 records (24 KiB)
plus a 128-byte frame, reuses storage for moving traffic, allocates only when
resolved, and releases owned resources on exit/disposal, never the device.
The Earth reference has default-off synthetic orbital stock and per-class
1.4 km inspection cameras; it executes this exact production path.

The shared `gqUrbanStructure` uses a fixed seed/site tangent grid, low-frequency
irregular district occupancy, dense centres, radial arterials, district roads,
fine block streets and window clusters. Fine structure converges to an area
average before it aliases; coarse arteries retain filtered coverage.
Day albedo and night emission use the same built footprint. Overlapping city
lights form a component-wise maximum union, not additive overlapping halos.
All shading is still clipped by existing water/ice/region/slope masks.
Seed/parcel coordinates do not change with ownership or population.
`URBAN_STRUCTURE_VERSION = 5` also increases occupancy and lit windows inside
existing cores as their radius grows relative to fixed parcel size. This is
a continuous, snapshot-derived development proxy, not elapsed age or a history
of individual buildings. Trade/science strengthen central infill, agriculture
reduces it, and fixed seeded open spaces retain dark gaps. Streets and parcel
identities never reroll. The filtered lighting average includes densification
at distant views. The version is exposed by the CPU plan without changing
foundation identities, population allocation, uniforms or persistence.
Fixed smooth district preference fields now modulate trade, science and
industry within each city. Economic weights determine their strength; absent
sectors remain absent. Science and industry favour complementary quarters,
with local window/hall lighting and warm/cool lamp mixtures. Trade modulates
arterials and central density. The fields depend on city seed and fixed
parcel coordinates, not radius, population, ownership or render time.
Child cities evaluate their own seeds and contribute their own coloured
emission to the existing maximum union; ruins never contribute emission.
Unresolved preferences converge to the supplied economic mix before aliasing.
This is cosmetic specialization, not district employment or sector allocation;
the authoritative resource and population budgets remain unchanged.
The same sample supplies linear daytime roof albedo and roughness: industrial
hall lots have smoother roofs, science quarters use lighter surfaces and
trade quarters a cooler commercial palette. Dark, rough streets remain on
the same parcel grid. Lot and street detail converge to fixed averages before
aliasing; district preferences use the same distance filter as night lighting.
At overlaps, the strongest built coverage selects the entire material sample,
including child cities, rather than combining unrelated colour and roughness.
Ruined footprints are darker and rougher but keep the same parcels.
Power and solar direction do not change these material values or built masks.
Dielectric F0 remains unchanged: this is a roof-material
proxy, not extruded buildings or a metallic city. No texture, uniform field,
render pass or server record is added.
Analytic roof slopes now perturb only the final shading normal inside built
coverage. Smooth low-pitch profiles use the same rotated parcel coordinates;
industrial halls favour a stronger, mostly single-axis pitch, while science
quarters reduce it. Roof interiors exclude streets and slopes fade out before
their parcel frequency aliases. The slope is rotated back to canonical body
space, projected onto the input normal's tangent plane and normalized.
Overlaps select the slope with the winning roof material, including children;
ruins retain only one quarter of their slope. Eligibility, night-light gating,
terrain geometry, picking and population footprints still use the original
terrain normal, so roof detail cannot alter coast/slope masks or light the
night hemisphere. This is bounded cosmetic normal detail, not roof geometry,
height displacement, self-shadowing or measured building heights.

At theoretical populations above one billion inhabitants per centre, the
previous 0.025-radian radius cap relaxes continuously toward 0.35 radians;
ordinary small-population radii retain their old bounds. Nearby active
centres (chord separation below 0.35) receive deterministic nearest-neighbour
urban infill when their combined radii approach the gap. Infill widens
smoothly with growth; ruined or remote centres never receive a link.
`gqUrbanInfill` projects each link into a fixed tangent strip with
seeded lateral bends and three-parcel-wide districts. District identities
and activation thresholds stay fixed as width/pressure increases; thresholds
favor the existing centres before the middle of the gap. Smooth occupancy
and width transitions produce an expanding patchwork rather than turning
the whole inter-city capsule on at once. Parcel-edge gaps fade to an area
average when unresolved. The same helper connects an active child nucleus
to its parent using their existing radii, with no additional uniform fields.
Zero-width, coincident, remote and back-hemisphere strips contribute nothing;
geometry rejection precedes noise evaluation. Ruined children cannot generate
new infill. Existing water/region/slope masks still clip all built area and
lighting, and the same mask contributes to day albedo and night emission.
This only models local development potential: it is not barrier-aware routing,
does not guarantee a connected land route and does not add road infrastructure.
`URBAN_INFILL_VERSION` separately versions this reconstructible visual pattern
without changing `URBAN_VERSION`, city seeds or founding identities.
This is a clipped visual land-use proxy, not a navigable terrain-validated
road, persisted municipality merger, or globe-wide ecumenopolis simulation.
Existing routed regional roads and freight remain separate and suppressed
inside urban cores. There is no additional texture, pass, scheduler or
per-city GPU allocation.

#### Reconstructible cosmetic foundations

The twelve regions are no longer the limit on visible city centres:
`urbanCandidates()` deterministically samples up to seven further suitable
sites around each region, for at most 96 total centres. Candidate pools are
cached with public geography; seed, region ID and the separate `URBAN_VERSION`
determine fixed identities, directions and founding-pressure thresholds.
Sites are checked against the canonical terrain sampler for water, slope and
excluded regions (ETOPO uses its DEM in the inspector). Failed placement
attempts are bounded and never fall back to an unchecked point. Candidate
ordinal/seed slots stay fixed even if another candidate is unavailable.
These are a bounded visual proxy, not a fully simulated planetary city census.
Existing markers and managed-city navigation still select the twelve regions;
new local nuclei are cosmetic districts, not new authoritative colonies.

Current population is distributed conservatively between regions using
continuous founding-pressure weights, then divided into rural residents
(12%, up to 45% on an agricultural world), an older core and younger nuclei.
A nucleus receives 6% of marginal urban population above its fixed threshold,
not an equal share of all existing inhabitants. At most seven such shares
leave the older core with a positive growth rate. New foundations start at
zero size and grow continuously; existing centres retain their IDs/grid and
do not shrink merely because a new region or nucleus is founded.
The cosmetic allocation obeys
`sum(urban populations) + ruralPopulation + unallocatedPopulation = population`;
the final term is explicit when no suitable region exists. Sector production
capacities remain allocated exactly as before and are not multiplied by cities.

No schema, migration, API field, city record, street graph, client storage,
simulation clock or additional server history write is added. The existing
manifest seed/geography, authoritative population/building snapshot and optional
`body_development.peak_population` suffice. The existing version-1
`body_development.founded_count` keeps its twelve-region contract unchanged.
When present, the high-water mark reconstructs abandoned local nuclei and their
non-emitting footprints; recovery restores the same identities. Without that
optional history only the current projection can be reconstructed.

This is a pure, versioned cosmetic read model, not an exact replay of real
foundation dates, migrations or old economic decisions. Founding thresholds
represent development pressure, not timestamped events. An economy change
can change rural allocation/district appearance; it does not reroll geography.
Identical inputs and algorithm version give identical CPU plans and uniforms
regardless of camera, ownership, frame rate or intermediate observations.
GPU pixels remain hardware-dependent; same-device replay is tested exactly.
Future candidate/foundation-algorithm changes must explicitly update
`URBAN_VERSION`; inter-city patch appearance uses `URBAN_INFILL_VERSION`.
Neither may silently change persistent geography/history semantics.

Both shared terrain shaders render the old core and the new local nuclei with
the same filtered urban structure, matching daytime footprints and night
emission. Spatially culled, bounded nucleus loops reuse the existing pass and
uniform buffer; negative radii retain ruin geometry but suppress its lights.
The maximum union allows neighbouring footprints to join without adding
population or accumulating overlapping emission. View caches are disposable
and never authoritative. `colony-urban-growth.test.js` checks conservation,
foundation continuity, dry-land placement, reconstruction and history recovery;
GPU tests measure newly illuminated areas outside the original core, dark
ruins, byte-identical reconstructed uniforms/pixels and equal elapsed playback
at different frame subdivisions.
The urban GPU test also reads the shared infill helper at four increasing
pressures: per-pixel coverage is nondecreasing, intermediate bands retain
both gaps and occupied parcels, small pressure changes remain continuous,
and seed replay is exact. Degenerate, remote and back-side strips are dark;
coarse footprints remain finite and bounded.
Orbit meshes classify water/ice using the canonical geological height sampler;
the approach no longer uses a terrain-independent smooth shell when a complete
manifest is available. The managed city accepts the same complete manifest and
uses canonical heights while persisted tiles are loading. Returning to orbit
retains the latest authorized building/population snapshot.

Orbital settlement markers are view-owned accessible DOM buttons over the shared
canvas. Their positions use the canonical body shape/solid radius and geological
height, the approach shader's Y rotation and the actual view-projection matrix.
Camera/frustum clipping and segment intersections against the rendered terrain
triangles hide rear-side sites and sites occluded by intervening composite-body
lobes. A small endpoint tolerance avoids self-occlusion on tessellated terrain.
CSS-pixel coordinates are recalculated with canvas resize/offset changes, separate
from the GPU drawing-buffer resolution. There is no additional RAF, GPU pass or
WebGPU device. Backdrop rendering never exposes active marker interactions.

Clicking a visible marker or its canvas hit area selects that stable site ID.
In the authenticated galaxy adapter this goes through `focusColony` and the
existing authorized `loadColonyData` callback, not the orbit's incomplete snapshot.
The zoom bridge carries the selected `settlement_id` and public terrain manifest
into the managed surface. Pending data reads/transitions block additional marker
navigation; superseded loads cannot re-enter an abandoned orbit. Foreign sites
remain read-only and do not initiate private building requests. Buttons/listeners
and CPU picking geometry are released on exit/disposal, including repeated
orbit/surface visits.

Regional roads use a second geography-only read model, cached alongside the
candidate sites for each view's manifest. A seed-rotated 192-node equal-area
land graph attaches sites to nearby passable nodes. Each successive candidate
finds a shortest angular path to an earlier site; future sites cannot reroute
an existing prefix. Validated shortcuts simplify the paths into bounded
great-circle segments. Growth activates matching route prefixes; ownership,
population and specialization never move their centerlines.

Routing samples canonical geological height, shape-aware slope and explicit
water/lava/ice region exclusions at intervals no larger than 0.012 radians.
Liquid-biome routes must stay above sea level and slopes must not exceed 0.35.
This is coarse regional visualization, not an engineering survey or authoritative
transport network: narrow terrain features between samples can be missed.
Shader masks additionally suppress water/lava, region overrides and steep
rendered surfaces. There are no ocean bridges, ferries or tunnels. Isolated
islands or insufficient graph resolution may leave sites unconnected; the
surface HUD reports those sites. Whole routes that exceed the 64-segment budget
are omitted with an explicit read-model status, never drawn as partial connections.
Concave composite bodies are explicitly unsupported for roads, rather than
connecting lobes through voids.

Both persistent views evaluate the same route uniforms in their existing
surface material pass. Agricultural corridors use earth-toned surfaces;
mining/industry shift them toward darker freight surfaces, with width derived
from built capacity and faint activity/damage-aware night lighting. Angular
widths and the capped screen-space visibility floor are visual proxies, not
physical road widths. Urban cores suppress the regional road overlay so it
does not pave over detailed city terrain. There are no new meshes, textures,
render passes, simulation ticks or gameplay production effects.

Regional transport uses the same material pass and road segments, with one
bounded convoy marker per active connected route. Its seed/route-ID phase
traverses the complete polyline by cumulative angular distance, including
validated detours, and reverses at endpoints over a 120-second round trip.
Shorter segment subdivisions cannot change its speed or position. Travel
speed and the capped screen-space marker size are illustrative, not physical
vehicle scale, cargo delivery times or exact surface-distance measurements.
The view's existing elapsed clock drives motion; re-entry restarts the seeded
phase. There is no timer, additional RAF, GPU pass, mesh or persistent trip.

The endpoint regions' dominant combined sector colors the marker green for
agriculture, amber for extraction or blue for industry. It is visible by day
and steadily emissive at night, without flashing. The existing
`PlanetLivingWorld.policy()` gates it in both views: scene/OS reduced motion,
disabled/off VFX and scene/planet/document visibility suppress traffic.
Missing completed economic capacity, zero population, zero activity, loss of
power or fully damaged colonies also suppress it; partial activity/damage
attenuates the marker. Ruined routes never carry traffic. Disconnected,
over-budget and unsupported routes generate none. Water/lava, region and
slope masks and urban-core suppression apply to traffic as well as roads.
At very close city scale the regional marker is hidden in the detailed urban
core; it does not invent local vehicles or duplicate authoritative inventory.
These proxies do not represent real goods, jobs, fleets or economy mutations.

Scope: satellites use regional materials at distance and bounded representative
3D geometry when visited, not additional interactive building inventories.
They are selected through the surface HUD or visible orbital markers.
Their local decorative plots are not a physical reconstruction of every
building in the regional material mask. Mining terraces do not
excavate terrain geometry. Missing economic data produces no invented
specialization. For owned colonies, initial orbit entry reads the authorized
building list on demand; other planets retain only their existing public
selection payload and trigger no private building request.
Missing/unavailable terrain leaves the existing terrain-error path in
place; a populated world without a suitable anchor is reported in the city HUD.
Legacy non-persistent Three.js/planet texture paths are unchanged.

Persistent development is opt-in after `migrate_body_development_v1.sql`.
`lib/BodyDevelopment.php` stores version 1 milestones in `body_development`,
keyed only by `celestial_bodies.id`: highest observed population, maximum
founded-prefix count (12), initialization time and last milestone observation.
Both authoritative `OnDemandEconomy::settle()` and legacy
`update_colony_resources()` observe the initial population and every existing
simulation step (including partial mutation steps), so growth followed by
starvation within one offline catch-up still founds the crossed-threshold site.
The simulation exposes an optional peak accumulator without changing its
step bounds, return state or gameplay results. These observations participate in
the owning colony transaction/savepoint. Atomic maximum upserts cannot lose a higher concurrent
observation; unchanged or declining observations issue no writes. No scheduler
or client-side persistence is introduced. This is bounded development memory,
not a per-city event journal, and cannot reconstruct peaks before activation
or population changes never observed by settlement.

Existing colonies initialize lazily from their current state, without invented
historical founding dates. Development survives ownership changes and colony
deletion/recolonization; only deletion of the celestial body cascades the history.
Threshold growth has no waiting period. Decline preserves the founded prefix as
weathered, reduced-height decorative ruins and muted orbital urban masks.
Ruined sites and their regional corridors emit no activity lights, have no
economic land-use masks, authoritative building slots, inhabitants or production.
Returning population reactivates the same canonical anchors and roads. Ruin
geometry is a deterministic representative settlement sized by the observed
population high-water mark, not a reconstruction of past building inventories
or economic specialization. The selected site's lifecycle is labelled in the
surface selector/HUD and in accessible orbital markers.

The existing surface overlay includes a named selected-region inspection
section, updated on site selection, authoritative snapshots and live visual
policy changes. It reports the normalized visual sector mix, colony activity
at that site, outdoor versus protected cultivation, actual displayed adjacent
land links (including abandoned ones), and the reason transport is disabled.
Missing founding links distinguish `no-land-route`, the segment budget and
unsupported composite-body routing; an omitted founding link does not imply
that a later site cannot have connected to this region. A primary with no
displayed links is not described as an impassable island.

Ruins expose no active economic mix or activity. The panel never allocates
local population, inventory, output or consumption and explicitly identifies
all such gameplay totals as colony-wide. Percentages describe visual land use,
not regional production shares. Inspection reuses the bounded surface read
model and existing frame hook, creates no network requests or extra timers,
and replaces DOM content only when the inspected values change. The overlay
scrolls within the viewport and stays collapsed by default in the in-game
details UI; it is disposed with the existing surface controls.

History is returned only through owner-authorized building lists/economy
snapshots; building lists bypass their legacy cache when the feature is enabled.
The loader uses the freshly settled population from the building response,
rather than an older overview population. Development never enters the public
terrain manifest/tile caches or foreign-planet reads. Invalid/cross-body/stale
history fails explicitly instead of inventing or discarding milestones.
The deployment flag defaults to zero: apply/review the canonical migration and
enable `BODY_DEVELOPMENT_ENABLED=1` only afterward. Missing schema with the flag
enabled is an error, not a silent fallback. Disable it before rollback; rollback
permanently deletes the stored development memory.

Validation: `npx vitest run tests/js/colony-surface-plan.test.js` checks spherical
spacing, geography constraints, stable growth, mixed economies and uniform
layout. `npx playwright test colony-surface-plan-webgpu.spec.js --project=chromium --workers=1`
uses a real WebGPU fallback adapter to verify distinct economic pixels,
water/region protection, night-light activity, shared orbit/city anchors,
building identity, repeated satellite visits, actual orbital marker clicks,
rotation/rear-side occlusion, high-DPI canvas resizing and exact GPU resource cleanup.
It also measures road pixels against an otherwise identical road-free material,
agricultural/freight appearance, day/night activity, water/region/steep-surface
protection and identical non-empty orbit/city route plans.
`npx vitest run tests/js/colony-regional-roads.test.js` checks deterministic
connections, land detours, isolation status, stable growth prefixes, bounded
canonical routing and the aligned uniform payload.
`npx vitest run tests/js/orbital-settlement-markers.test.js tests/js/game-colony-zoom.test.js tests/js/game-galaxy-camera.test.js`
also covers intervening-lobe occlusion, clipping, authorized loader propagation,
pending/stale navigation, non-click camera drags and detached-control cleanup.
`tests/Unit/BodyDevelopmentTest.php` and the economy persistence integration
tests cover threshold parity, initialization, decline, conquest/recolonization,
idempotency, ownership rejection and transaction rollback. Run the persistence
tests with `BODY_DEVELOPMENT_ENABLED=0` and `1`; keep
`ON_DEMAND_ECONOMY_ENABLED=0` when including the legacy persistence fixture.
`tests/Unit/ColonyEconomySimulationTest.php` verifies that an intermediate
growth threshold survives subsequent starvation and that peak observation
leaves the simulation result unchanged, including partial mutation steps.
`tests/js/colony-development-history.test.js` and the surface-controller tests
cover retained ruined-site selection and recovery; the real GPU suite also
checks unlit ruin/corridor pixels and navigates to a ruined satellite.
Surface-plan tests additionally verify regional geographic preferences,
per-sector capacity conservation, active-only redistribution, regional
architecture, endpoint freight colors and the extended site uniform layout.
Marker/HUD tests cover economic snapshot label refreshes; the real GPU fixture
compares distinct regional pixels with identical global economy and footprints.
`tests/js/colony-regional-traffic.test.js` checks multi-segment traversal,
constant angular speed, turn/junction continuity, seed/period determinism,
segment subdivision invariance, economic styles and disabled states. Real
renderer lifecycle tests verify per-frame motion, live reduced-motion policy
changes and teardown without additional GPU resources. The GPU fixture
measures moving day/night convoy pixels and checks motion/visibility gates,
ruins, water/region/slope exclusion and detailed urban-core protection.
The economic landscape GPU fixture measures seeded fine pattern differences,
field margins, quarry floor/bench variation, roof/yard roughness contrast,
repeatability and convergence to constant minified sector averages.
It also measures crop-wind motion, bounded color modulation, repeatable loop
and loop-boundary continuity, unchanged field margins/roughness and static
minified output. The production surface GPU fixture uses an actual close
field view to check motion and verifies exclusion of closed farms, ruins,
urban cores and nonagricultural/protected surfaces. The distant view stays
identical to static fields rather than aliasing the canopy bands.
The production material fixture checks all three economic sectors against
water, lava, ice, explicit region and steep-surface masks. Surface-plan tests
verify that growth and ownership preserve parcel scale/seeds without expanding
the shared uniform buffer.
`tests/js/colony-region-inspection.test.js` verifies regional-only output,
bidirectional adjacency, missing-link reasons, abandoned links, recovery and
transport-policy explanations. Surface-controller tests cover stale-label
removal, stable DOM on unchanged frames and teardown; the real GPU browser
flow inspects a satellite and its ruins and switches the OS reduced-motion
preference live.

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
