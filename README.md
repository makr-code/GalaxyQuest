# GalaxyQuest

> **A browser-based, multiplayer space-strategy game** — persistent galaxy, Newtonian fleet movement, planetary economies, NPC factions, and AI-driven leaders. No build step, no framework, no dependencies.

---

## Quick Start

```bash
# Docker Desktop
docker compose up --build

# App: http://localhost:8080
# MySQL: localhost:3307  (user: galaxyquest_user / password: galaxyquest_dev)
```

Full installation notes: [→ Installation](#installation)

Unified server setup (schema + migrations + bootstrap):

```bash
docker compose exec -T web php setup.php
```

If you changed galaxy generation and want a full regeneration of cached systems:

```bash
docker compose exec -T web php setup.php --regen-galaxy
```

For a non-Docker setup, see [Manual Installation](#manual-installation).

Gameplay and systems design:
- [Gameplay Data Model & Mechanics](docs/gamedesign/GAMEPLAY_DATA_MODEL.md)

### Scientific Glossary with LLM + Wikipedia RAG

The in-game glossary now uses **Ollama LLM with Wikipedia as Retrieval-Augmented Generation (RAG)** context for dynamic, scientifically-enhanced definitions.

**Features:**
- 🤖 **AI-Enhanced Definitions** – Ollama generates contextual explanations from Wikipedia excerpts
- 💾 **Smart Caching** – 5-day TTL for generated definitions (50ms cache hits)
- 🔄 **Toggle UI** – Switch between Static ↔️ AI definitions in the modal
- 📊 **Multi-Model Support** – Supports Mistral, Neural-Chat, Llama2, Phi

**Getting Started:**
```bash
# Install & start Ollama
ollama pull mistral
ollama serve

# GalaxyQuest detects Ollama on localhost:11434 automatically
# Optional: Set environment variables
export OLLAMA_URL=http://localhost:11434
export OLLAMA_MODEL=mistral
```

Full setup guide: [→ OLLAMA_SETUP.md](docs/technical/OLLAMA_SETUP.md)

**API Endpoint:**
```bash
GET /api/glossary.php?action=generate&term=white_dwarf

# Response includes Wikipedia-contextualized definition
{
  "term": "White Dwarf",
  "short": "...",
  "full": "...",
  "source": "ollama_rag",
  "generated_at": "2026-03-28T..."
}
```

**Fallback Behavior:**
- Ollama unavailable → Uses static definitions (no delay)
- Wikipedia unreachable → LLM works without RAG context
- LLM timeout (>30s) → Shows cached or static definition

### Local LLM (Ollama, Developer)

GalaxyQuest now provides a central local LLM gateway so every module can use the same Ollama runtime.

Separation-of-concerns extension (data model + backend + frontend):

- Prompt profiles are defined in:
  - `config/llm_profiles.yaml` (authoring)
  - `config/llm_profiles.json` (runtime source)
- SoC backend modules:
  - `api/llm_soc/PromptCatalogRepository.php`
  - `api/llm_soc/LlmPromptService.php`
  - `api/llm_soc/LlmRequestLogRepository.php`
- Orchestration endpoint:
  - `api/llm.php`

Apply LLM SoC migration:

```bash
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/migrate_llm_soc_v1.sql
```

Environment variables:

- `OLLAMA_ENABLED` (`1` in dev by default, `0` in production by default)
- `OLLAMA_LOCAL_ONLY` (`1` by default, only allows localhost/127.0.0.1/::1)
- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `OLLAMA_DEFAULT_MODEL` (default `llama3.1:8b`)
- `OLLAMA_TIMEOUT_SECONDS` (default `45`)

Backend endpoint:

- `GET api/ollama.php?action=status`
- `POST api/ollama.php?action=chat`
- `POST api/ollama.php?action=generate`

SoC profile endpoint:

- `GET api/llm.php?action=catalog`
- `POST api/llm.php?action=compose`
- `POST api/llm.php?action=chat_profile`

<img width="1920" height="1020" alt="Screenshot 2026-03-30 213139" src="https://github.com/user-attachments/assets/e5ad5350-8da8-4999-b597-e5344b49ce98" />

### NPC / PvE Controller (LLM-Integrated)

GalaxyQuest can optionally steer non-player factions via an LLM-assisted PvE controller.

Implementation:

- Tick integration: `api/npc_ai.php`
- LLM controller module: `api/npc_llm_controller.php`
- Optional decision diagnostics table: `sql/migrate_npc_pve_controller_v1.sql`
- Optional observability index migration: `sql/migrate_npc_pve_controller_v2.sql`

Enable via environment:

- `NPC_LLM_CONTROLLER_ENABLED` (`0` by default)
- `NPC_LLM_CONTROLLER_TIMEOUT_SECONDS` (default `8`)
- `NPC_LLM_CONTROLLER_COOLDOWN_SECONDS` (default `900`)
- `NPC_LLM_CONTROLLER_MIN_CONFIDENCE` (default `0.55`)

Apply optional diagnostics migration:

```bash
Get-Content -Raw sql/migrate_npc_pve_controller_v1.sql | docker compose exec -T db mysql -uroot -proot galaxyquest
```

Apply optional observability index migration:

```bash
Get-Content -Raw sql/migrate_npc_pve_controller_v2.sql | docker compose exec -T db mysql -uroot -proot galaxyquest
```

Behavior:

- If enabled, each NPC faction can emit one LLM decision per cooldown window.
- Supported actions: `trade_offer`, `raid`, `diplomacy_shift`, `send_message`, `none`.
- If LLM is disabled, times out, or returns invalid/low-confidence output, the classic deterministic NPC logic remains active.

Diagnostics / control API:

- `GET api/npc_controller.php?action=status`
- `GET api/npc_controller.php?action=summary&hours=24&faction_id=0`
- `GET api/npc_controller.php?action=decisions&limit=20&faction_id=0`
- `POST api/npc_controller.php?action=run_once`

Frontend usage (available globally):

```javascript
const status = await GQ_LLM.status();
const answer = await GQ_LLM.chat({
  system: 'You are the GalaxyQuest strategy assistant.',
  prompt: 'Bewerte meine aktuelle Flottenroute kurz.',
});
console.log(answer.text);
```

Profile-based usage:

```javascript
const profiles = await GQ_LLM.profiles();
const composed = await GQ_LLM.compose({
  profile_key: 'fleet_route_assistant',
  input_vars: {
    origin: '[1:100:7]',
    target: '[1:110:4]',
    mission: 'attack',
    fleet_summary: '8 cruisers, 12 heavy fighters',
    context: 'Enemy anti-shield tech level 2',
  },
});

const result = await GQ_LLM.chatProfile({
  profile_key: 'fleet_route_assistant',
  input_vars: {
    origin: '[1:100:7]',
    target: '[1:110:4]',
    mission: 'attack',
    fleet_summary: '8 cruisers, 12 heavy fighters',
  },
});
console.log(result.text);
```

### Data Model Test (Generic Data)

To test the gameplay data model with deterministic generic data:

1. Apply migration

```bash
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/migrate_gameplay_model_v1.sql
```

2. Seed generic test data

```bash
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/test_gameplay_model_seed.sql
```

3. Run smoke checks

```bash
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/test_gameplay_model_checks.sql
```

Expected: each check row returns `status = OK`.

### Security + Observability API Smoke Tests

Run auth lockout/rate-limit integration smoke test:

```bash
docker compose exec -T web php scripts/test_auth_rate_limit.php
```

Run admin stats endpoint integration smoke test:

```bash
docker compose exec -T web php scripts/test_admin_stats_endpoint.php
```

Run wormhole beacon unlock integration smoke test:

```bash
docker compose exec -T web php scripts/test_wormhole_beacon_unlock.php
```

Expected: all scripts print `RESULT: PASS` and exit with code `0`.

### PHPUnit Unit Tests (Game Engine Pure Functions)

One-time in container (download local runner):

```bash
docker compose exec -T web sh -lc "curl -fsSL https://phar.phpunit.de/phpunit-10.phar -o /var/www/html/tools/phpunit.phar"
```

Run unit tests:

```bash
docker compose exec -T web php /var/www/html/tools/phpunit.phar -c /var/www/html/phpunit.xml
```

Current suite: `tests/Unit/GameEnginePureFunctionsTest.php` (resource production, cost/time formulas, layout profile).

### Frontend JavaScript Unit Tests (Vitest)

Install dependencies (one-time):

```bash
npm install
```

Run JS unit tests:

```bash
npm run test:unit:js
```

Current suite:

- `tests/js/wm.test.js` (WM window lifecycle)
- `tests/js/api.test.js` (API call wrapper / versioned endpoint mapping)

### Frontend JS Optimization (PHP, Uglify + Gzip)

The project now uses a PHP-based optimization build focused on uglified + gzip-compressed JavaScript assets.

Generate optimized runtime assets (default):

```bash
docker compose exec -T web php scripts/build_minified_js.php
```

Optional clean rebuild:

```bash
docker compose exec -T web php scripts/build_minified_js.php --clean
```

Optional variants:

```bash
# Keep uncompressed .ugl.js files as well
docker compose exec -T web php scripts/build_minified_js.php --keep-uncompressed

# Build extra variants (min + uglify + gzip/brotli when available)
docker compose exec -T web php scripts/build_minified_js.php --all --clean
```

Result:

- Runtime build generates `js/*.ugl.js.gz` artifacts.
- `index.html` (unified shell) loads auth and game runtime assets.
- Optional: Brotli artifacts (`*.br`) are generated when the PHP Brotli extension is available and enabled via CLI option.

<img width="1920" height="1020" alt="Screenshot 2026-03-30 213050" src="https://github.com/user-attachments/assets/fd60806d-42aa-4976-b446-c072ee0663b1" />

### Politics Model (Factions + Species + Government)

Stellaris-inspired model with dynamic benefits/malus is available via:

- species catalog (`species_profiles`)
- government forms (`government_forms`)
- civics (`government_civics`)
- per-user profile (`user_empire_profile`, `user_empire_civics`)
- dynamic runtime effects in colony tick (resource/food/growth/happiness/public services)

Apply migration:

```bash
Get-Content -Raw sql/migrate_politics_model_v1.sql | docker compose exec -T db mysql -uroot -proot galaxyquest
```

Optional tuning env vars:

- POLITICS_MAX_CIVICS (default 2)
- POLITICS_UNREST_TRIGGER_APPROVAL (default 45)
- POLITICS_UNREST_RECOVERY_APPROVAL (default 62)
- POLITICS_UNREST_PROGRESS_PER_HOUR (default 1.0)

Seed generic politics test data:

```bash
Get-Content -Raw sql/test_politics_model_seed.sql | docker compose exec -T db mysql -uroot -proot galaxyquest
```

Run politics smoke checks:

```bash
Get-Content -Raw sql/test_politics_model_checks.sql | docker compose exec -T db mysql -uroot -proot galaxyquest
```

API endpoints:

- `GET api/politics.php?action=catalog`
- `GET api/politics.php?action=presets`
- `GET api/politics.php?action=status`
- `POST api/politics.php?action=configure`
- `POST api/politics.php?action=apply_preset`

Overview payload now includes a politics runtime snapshot:

- `GET api/game.php?action=overview` includes `politics.effects` and `politics.pressure_events`.

---

<img width="1920" height="1020" alt="Screenshot 2026-03-30 212958" src="https://github.com/user-attachments/assets/96a05ced-d333-4779-9ac8-b93d793a5121" />

## Feature Overview

| Area | Status |
|---|---|
| 🔐 Auth (register / login / CSRF / session / 2FA TOTP / RBAC) | ✅ |
| 🌌 Procedural spiral galaxy (deterministic, configurable, default 25,000 systems in galaxy 1) | ✅ |
| 🌍 Scientific planet generation (Kopparapu HZ, Kepler periods, IMF star types, binary stars) | ✅ |
| 🏗 Colony hierarchy: Galaxy → System → Planet → Colony → Buildings | ✅ |
| ⛏ 22 building types across 8 categories (async upgrade queue) | ✅ |
| 🔬 16 research technologies | ✅ |
| 🚀 16 ship types (vessel blueprints + module system) | ✅ |
| 🛸 Fleet dispatch: Attack · Transport · Colonize · Spy · Harvest | ✅ |
| 🧮 3D Newtonian fleet movement (x/y/z light-year coords, speed_ly/h) | ✅ |
| ⚔ Combat with tech/commander bonuses, shield penetration, per-side casualties | ✅ |
| 🌾 Food · 👥 Population · 😊 Happiness · 🏥 Public Services economy | ✅ |
| 💜 Rare-earth deposits (finite, class-dependent) | ✅ |
| 👤 Leader system: Colony Manager · Fleet Commander · Science Director | ✅ |
| 🤖 Leader AI autonomy (suggest / full-auto) | ✅ |
| 🌐 NPC factions: Empire · Guild · Collective · Pirates · Precursors | ✅ |
| 🤝 Diplomacy standing per faction (−100 war ↔ +100 allied) | ✅ |
| 💱 Faction trade offers (AI-generated, timed) | ✅ |
| 📋 Faction quests (8 seeded, 5 difficulty tiers) | ✅ |
| 🏴‍☠ Pirate raids on unprotected colonies | ✅ |
| 🏆 Achievements (15, auto-detected) | ✅ |
| 📨 In-game messaging | ✅ |
| 🖥 Floating window manager (drag · resize · minimize · persist position) | ✅ |
| 🚄 FTL Drive System (5 faction drives: Vor'Tak / Vel'Ar / Syl'Nar / Kryl'Tha / OD-5, FTL gates, resonance nodes) | ✅ |
| 🌀 Wormholes (stable/unstable pairs, per-user beacon unlocks) | ✅ |
| 🏙 Colonization system (Empire Sprawl, sectors + governors, 6 colony types, invasion & defense) | ✅ |
| 💹 Advanced Economy (T2–T5 goods, 18 good types, pop classes COLONIST→TRANSCENDENT, galactic market) | ✅ |
| 🛣 Trade routes (permanent inter-colony routes) | ✅ |
| 🤝 Alliance system (membership, inter-alliance relations, alliance messaging) | ✅ |
| 🗺 Politics model (species profiles, government forms, civics, dynamic colony effects) | ✅ |
| 🌫 Fog of war (visibility per user, homeworld reveal on registration) | ✅ |
| 🎇 Planetary & colony events (event log, journal system, random event firing) | ✅ |
| 🖼 WebGPU rendering engine (SceneGraph, GameLoop, EventBus, WebGPU abstraction layer) | ✅ |
| 🔭 3D galaxy renderer (spiral arms, HR diagram, FTL overlay, system camera) | ✅ |
| ✨ Post-processing pipeline (Bloom, Vignette, Chromatic Aberration, SSAO, ping-pong RT) | ✅ |
| 💥 Combat FX (GPU particle system, beam effects, voxel debris, environment FX) | ✅ |
| 📡 Projection runtime (async dirty-queue workers for user overview + system snapshots) | ✅ |
| 📊 Performance telemetry (PerformanceMonitor, ResourceTracker, ShaderCompiler metrics) | ✅ |
| 🚀 WebGPU interactive galaxy renderer (Galaxy3DRendererWebGPU, WGSL shaders, fallback chain) | ✅ |

---

## WebGPU Renderer

GalaxyQuest uses **WebGPU as the primary rendering backend** for the interactive galaxy and system views, with an automatic fallback to WebGL2 (via Three.js) for unsupported browsers.

### Browser Support

| Browser | WebGPU | Fallback |
|---|---|---|
| Chrome 113+ | ✅ WebGPU native | – |
| Edge 113+ | ✅ WebGPU native | – |
| Firefox 119+ (`dom.webgpu.enabled=true`) | ✅ WebGPU native | – |
| Safari 17.4+ (experimental) | 🔬 WebGPU experimental | WebGL2 |
| All other browsers | ❌ | ✅ WebGL2 via Three.js |

### Feature Detection & Error Handling

The renderer automatically detects WebGPU support at startup:

- **WebGPU available** → `Galaxy3DRendererWebGPU` initialises with full interactive star-point rendering, mouse interaction, zoom/pan/orbit, camera animation, and a WGSL shader pipeline.
- **WebGPU unavailable** → Falls back silently to the Three.js WebGL2 renderer (`Galaxy3DRenderer`), which provides the same game features on older browsers.
- **Neither available** → A user-friendly warning is logged to the browser console with upgrade guidance.

### Renderer Hint (Developer Override)

You can force a specific backend via `localStorage`:

```javascript
localStorage.setItem('gq:rendererHint', 'webgpu');   // Force WebGPU
localStorage.setItem('gq:rendererHint', 'webgl2');   // Force WebGL2
localStorage.setItem('gq:rendererHint', 'auto');     // Auto-detect (default)
```

### Architecture

```
Galaxy3DRendererWebGPU      ← Interactive WebGPU renderer (primary)
  └─ WGSL star-point shader (vs_main + fs_main)
  └─ Hover/click/dblclick star hit-testing (CPU-side, NDC space)
  └─ Smooth camera with pan/zoom animation
  └─ device.lost recovery path

galaxy3d-webgpu.js (facade) ← Selects backend at runtime
  ├─ Galaxy3DRendererWebGPU (WebGPU path, interactive)
  ├─ StarfieldWebGPU         (WebGPU path, non-interactive auth screen)
  └─ Galaxy3DRenderer        (Three.js WebGL2 fallback)

engine-compat.js            ← Low-level RendererFactory bridge
  ├─ WebGPURenderer          (js/engine/core/)
  └─ WebGLRenderer           (js/engine/core/)
```

### Local Development

Verify WebGPU is active by opening the browser console and looking for:

```
[gq:render-telemetry] { type: "backend-active", backend: "webgpu", ... }
```

Or check the renderer hint stored in localStorage:

```javascript
window.__GQ_ACTIVE_RENDERER_BACKEND  // → "webgpu" | "webgl2"
window.__GQ_RENDER_TELEMETRY         // → array of render events
```

---

## Architecture & Design Decisions

### No Framework, No Build Step

The frontend is plain HTML5 + CSS3 + vanilla JS (ES2020). The backend is plain PHP 8 with PDO. This was a deliberate choice:

- **Zero deploy friction** — copy files, create DB, done.
- **No transpiler, bundler, or package manager** — `index.html` is a unified self-contained shell.
- **Full control** — every byte of the stack is readable without tooling.

The only "framework" is a ~300-line home-grown **Window Manager** (`js/wm.js`) that gives the UI a desktop metaphor (draggable floating windows, taskbar, localStorage position persistence).

### Server-authoritative, Tick-free

There is no server-side game loop or cron job. Instead:

- Every API call that touches a colony first calls `update_colony_resources($db, $colonyId)`, which calculates exactly how much was produced/consumed since `last_update` using elapsed-time arithmetic.
- Fleet arrivals are resolved lazily the first time any request reads fleet state (`check_arrivals`).
- NPC AI runs a single rate-limited tick (max once per 5 minutes) on each overview load.

This makes the game trivially deployable on shared hosting with no background process.

### 5-Level Hierarchy

```
Universe
  └─ Galaxy  (1–9, spiral arm structure)
    └─ StarSystem  (configurable per galaxy; default bootstrap seeds 25,000 in galaxy 1)
            └─ Planet  (scientific properties, finite deposits)
                 └─ Colony  (player base: resources, population, buildings)
```

Planets are **purely astronomical** objects (orbital mechanics, temperature, atmosphere). Colonies are the player layer on top. A planet can exist without a colony (uninhabited, harvestable) and a colony cannot exist without a planet.

### Deterministic Galaxy Generation

`api/galaxy_gen.php` produces a fully deterministic star system from just `(galaxyIdx, systemIdx)`:

- Star type drawn from the **Kroupa Initial Mass Function** using a seeded PRNG.
- Habitable zone calculated via **Kopparapu et al. (2013)** runaway-greenhouse / maximum-greenhouse limits.
- Planet orbital semi-major axes placed by a log-normal distribution; periods via **Kepler's third law**.
- 9 planet classes (Terrestrial, Super-Earth, Ocean, Desert, Ice, Gas Giant, Ice Giant, Lava, Barren) assigned by temperature and mass.

Star system metadata and generated planets can be pre-seeded into the database. The default bootstrap fills galaxy 1 with 25,000 cached systems and their generated planets, then each newly registered user seeds another 50 nearby systems around the homeworld region.

### Resource Economy

Each planet's **richness** multipliers and **finite deposits** are derived from planet class at first insertion:

| Planet Class | Metal | Crystal | Deuterium | Rare Earth |
|---|---|---|---|---|
| Lava | ×1.8 | ×0.9 | ×0.2 | ×2.0 |
| Barren | ×1.4 | ×1.3 | ×0.7 | ×1.5 |
| Terrestrial (HZ) | ×1.2 | ×1.1 | ×1.3 | ×0.8 |
| Ice | ×0.6 | ×1.8 | ×1.4 | ×1.0 |
| Gas Giant | ×0.3 | ×0.2 | ×2.0 (∞) | ×0.1 |

Deposits are **depleted by mining** over time. A gas giant's deuterium is flagged `−1` (unlimited).

The **productivity chain** is:
```
Energy plants → mine efficiency
Hydroponic farms → food → population coverage → food_coverage ratio
Hospital + School + Security Post → public_services index (0–100)
food_coverage + energy_balance + public_services → happiness (0–100)
happiness → productivity multiplier (0.5× at 0% → 1.25× at 100%)
productivity × richness × mine_level → actual hourly output
```

### Newtonian Fleet Movement

Each fleet stores absolute 3D coordinates in light-years (`origin_x/y/z_ly`, `target_x/y/z_ly`, `distance_ly`, `speed_ly_h`). The current position is interpolated linearly at any point in time:

```
progress = (now − departure) / travel_time_seconds   [0.0 → 1.0]
pos = origin + (target − origin) × progress
```

Speed is derived from the slowest ship in the fleet and scaled by the fleet commander's navigation skill bonus. The UI shows a progress bar with ETA and current coordinates.

### Leader / AI System

Three assignable leader roles per entity:

| Role | Entity | AI behaviour (autonomy = full-auto) |
|---|---|---|
| Colony Manager | Colony | Queues cheapest affordable building upgrade each tick |
| Science Director | Colony | Starts next available research when lab is free |
| Fleet Commander | Fleet | +2% attack per skill level; auto-recalls idle fleets |

Leaders gain XP on task completion, level up, and can be dismissed. When `autonomy = 0` the player retains full manual control.

### NPC Faction AI

Five seeded factions with distinct archetypes:

| Faction | Type | Aggression | Trade |
|---|---|---|---|
| ⚔ Galactic Empire | military | 70 | 20 |
| 💰 Merchant Guild | trade | 10 | 90 |
| 🔬 Science Collective | science | 20 | 60 |
| 💀 Pirate Clans | pirate | 90 | 40 |
| 🌀 Ancient Precursors | ancient | 30 | 30 |

On each overview load (rate-limited to once per 5 minutes per user) the NPC AI tick:
1. Generates new timed trade offers for factions willing to trade.
2. Checks if pirates should raid an unprotected non-homeworld colony.
3. Decays diplomatic standing slowly toward each faction's base value.

### Combat Resolution

Battle is resolved server-side at fleet arrival:

```
attacker_effective_dmg = (attack × (1 + weapons_tech × 0.1) × commander_bonus) − defender_shield × 0.5
defender_effective_dmg = defender_attack − attacker_shield × 0.5
attacker_wins = attacker_effective_dmg > defender_hull × 0.5 + defender_shield × 0.2
loss_fraction  = effective_incoming_dmg / (hull + shield)   [capped at 90%]
```

Winners loot up to 50% of metal/crystal/deuterium and 30% of rare earth (capped by surviving fleet cargo). Defeated colony loses 20 happiness. Both sides receive a detailed in-game message.

---

## Installation

### Docker Desktop (recommended for development)

Requirements:
- Docker Desktop with Compose enabled
- VS Code PHP Debug extension if you want step debugging

```bash
# Start web + database
docker compose up --build

# Stop the stack
docker compose down

# Stop and remove the database volume as well
docker compose down -v
```

What this setup gives you:
- Apache + PHP 8.2 in a web container
- MySQL 8.4 in a separate container
- Automatic schema import on first database startup
- Xdebug preconfigured for Docker Desktop via `host.docker.internal:9003`
- Live code editing through a bind mount of the project directory

Debugging in VS Code:
1. Install the PHP Debug extension.
2. Start the stack with `docker compose up --build`.
3. Open the Run and Debug view and select `Listen for Xdebug (Docker)`.
4. Set a breakpoint in any PHP file and trigger the corresponding request in the browser.

Workspace helpers:
- `.vscode/tasks.json` includes `Docker: Up`, `Docker: Down`, `Docker: Reset DB`, `Docker: Logs`, `Docker: Rebuild Web`, and `Docker: Bootstrap Galaxy`.
- `.vscode/tasks.json` also includes test helpers: `Test: API Smoke Suite`, `Test: Full Regression Suite`, and `Test: Fresh DB + Full Regression`.
- Test helpers are backed by `scripts/test_full_regression.ps1` (`-ApiOnly` or `-FreshReset`) so the flow is defined in one place.
- `.vscode/extensions.json` recommends the PHP Debug and Docker extensions.

Notes:
- The app is served at `http://localhost:8080`.
- MySQL is exposed on port `3307` to avoid conflicts with a local server.
- The schema in `sql/schema.sql` is only imported when the named Docker volume is empty.
- If you need a clean database, run `docker compose down -v` and start again.
- To force the full base galaxy into the database after startup, run `Docker: Bootstrap Galaxy` or `docker compose exec -T web php scripts/bootstrap_galaxy.php`.

### Manual Installation

### Requirements
- PHP 8.0+ with `pdo_mysql`
- MySQL 8.0+ (or MariaDB 10.6+)
- Any web server (Apache with `.htaccess`, Nginx, Caddy, PHP built-in server)

### Steps

```bash
# 1. Database
mysql -u root -p -e "CREATE DATABASE galaxyquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p galaxyquest < sql/schema.sql

# Existing installation? Run the incremental migration instead:
mysql -u root -p galaxyquest < sql/migrate_v2.sql

# 2. Config
cp config/config.php.example config/config.php
# Set DB_HOST, DB_NAME, DB_USER, DB_PASS, GAME_SPEED as needed

# 3a. Apache — .htaccess is included, just enable mod_rewrite
# 3b. Nginx
server {
    root /var/www/galaxyquest;
    index index.html;
    location ~ \.php$ { fastcgi_pass unix:/run/php/php8.0-fpm.sock; include fastcgi_params; fastcgi_param SCRIPT_FILENAME $request_filename; }
}

# 3c. PHP built-in server (development only)
php -S localhost:8080
```

### Configuration (`config/config.php`)

The config file also supports environment-variable overrides. That means the Docker setup can inject database credentials without requiring a separate local config edit.

| Constant | Default | Description |
|---|---|---|
| `GAME_SPEED` | `1` | Global speed multiplier (higher = faster production) |
| `GALAXY_MAX` | `9` | Number of galaxies |
| `SYSTEM_MAX` | `499` | Legacy fallback only; runtime uses `config/galaxy_config.json` when present |
| `POSITION_MAX` | `15` | Planet slots per system |
| `SESSION_LIFETIME` | `3600` | Session cookie lifetime in seconds |

---

## Project Structure

```
/
├── index.html                  # Unified auth + game shell (single-page app, section-based routing)
├── css/
│   └── style.css               # Dark space-themed UI
├── js/
│   ├── game.js                 # Game UI layer (window controllers)
│   ├── api.js                  # All API calls in one place
│   ├── wm.js                   # Floating window manager
│   ├── auth.js                 # Login / register
│   ├── gq-ui.js                # Fluent DOM builder (GQUI)
│   ├── boot-loader.js          # Engine module bootstrapper
│   ├── engine/                 # WebGPU game engine
│   │   ├── GameEngine.js       # Engine entry point
│   │   ├── GameLoop.js         # Render + update loop
│   │   ├── EventBus.js         # Global event bus
│   │   ├── ViewportManager.js  # PiP viewport management
│   │   ├── game/               # Simulation systems (pure JS, no GPU)
│   │   │   ├── BattleSimulator.js      # Round-based fleet combat
│   │   │   ├── ColonySimulation.js     # Colony economy + invasion
│   │   │   ├── EconomySimulation.js    # T2–T5 goods, pop classes, market
│   │   │   ├── EventSystem.js          # Events + journal
│   │   │   ├── FleetFormation.js       # Fleet formation patterns
│   │   │   └── ResearchTree.js         # Tech tree
│   │   ├── fx/                 # Visual effects
│   │   │   ├── CombatFX.js             # Weapon/explosion/shield-impact presets
│   │   │   ├── GPUParticleSystem.js    # GPU compute particles + CPU fallback
│   │   │   ├── BeamEffect.js           # Instanced capsule beam rendering
│   │   │   ├── VoxelDebris.js          # Box-chunk debris pool (ship destruction)
│   │   │   ├── EnvironmentFX.js        # Nebulae, god rays, plasma clouds
│   │   │   └── shaders/        # WGSL shader source files
│   │   ├── post-effects/       # Post-processing pipeline
│   │   │   ├── EffectComposer.js       # Ping-pong render target composer
│   │   │   └── passes/         # BloomPass, VignettePass, ChromaticPass, SSAOPass
│   │   ├── webgpu/             # WebGPU abstraction layer
│   │   │   ├── WebGPUDevice.js / WebGPURenderer.js / WebGPUBuffer.js …
│   │   ├── scene/              # SceneGraph, Camera, Geometry, Material, Light
│   │   ├── math/               # Vector2/3/4, Matrix4, Quaternion
│   │   └── loaders/            # GeometryLoader, ShaderLoader, TextureLoader
│   ├── rendering/              # Galaxy 3D renderer
│   │   ├── Galaxy3DRendererWebGPU.js   # Interactive WebGPU galaxy renderer (primary)
│   │   ├── galaxy-renderer-core.js     # Three.js WebGL2 galaxy renderer (fallback)
│   │   ├── starfield-webgpu.js         # WebGPU non-interactive auth-screen starfield
│   │   ├── galaxy-renderer-config.js   # Renderer settings
│   │   └── post-effects.js             # Post-processing integration
│   ├── ui/                     # Standalone UI components
│   │   ├── settings-panel.js   # Settings + FTL panel
│   │   ├── glossary.js         # Scientific glossary modal
│   │   ├── terminal.js         # In-game terminal
│   │   └── system-info-panel.js
│   ├── network/                # API contracts + binary decoders (v2/v3)
│   ├── runtime/                # Space physics engine, flight HUD, trajectory planner
│   └── telemetry/              # PerformanceMonitor, ResourceTracker, ShaderCompiler
├── api/                        # PHP REST endpoints (30+ files)
│   ├── helpers.php             # Shared request/response, auth, CSRF
│   ├── game_engine.php         # Formulas, constants, colony tick
│   ├── galaxy_gen.php          # Deterministic galaxy generator
│   ├── auth.php                # Register / login / logout / TOTP 2FA
│   ├── game.php                # Overview, resources, rename, leaderboard, FTL drive
│   ├── fleet.php               # Fleets, FTL cooldown, combat, colonize, harvest
│   ├── economy.php             # Advanced economy simulation
│   ├── market.php              # Galactic market
│   ├── colonization.php        # Empire Sprawl, sectors, governors (14 endpoints)
│   ├── politics.php            # Species, government forms, civics
│   ├── alliances.php           # Alliance management
│   ├── trade.php               # Trade routes
│   ├── events.php              # Planetary / colony events
│   ├── projection.php          # Projection queue API
│   ├── ollama.php              # Ollama LLM gateway
│   ├── llm.php                 # LLM SoC prompt catalog
│   ├── npc_ai.php              # NPC faction tick (trade gen, raids, decay)
│   ├── npc_controller.php      # NPC/PvE diagnostics + control API
│   └── (+ buildings, research, shipyard, factions, leaders, achievements, messages, …)
├── lib/
│   └── projection_runtime.php  # Projection queue + worker helpers
├── config/
│   ├── config.php              # Game constants and DB credentials
│   ├── db.php                  # PDO singleton factory
│   ├── galaxy_config.json      # Per-galaxy system counts
│   ├── llm_profiles.yaml       # LLM prompt profile authoring
│   └── llm_profiles.json       # LLM prompt profile runtime source
├── sql/
│   ├── schema.sql              # Full schema (35 tables) — use for fresh install
│   ├── migrate_v2.sql          # Base ALTER TABLE migrations
│   └── migrate_*.sql           # Incremental feature migrations (v3–v12+)
├── scripts/                    # CLI utilities, seeding scripts, build helpers
├── tests/
│   ├── Unit/                   # PHPUnit tests (pure PHP game-engine functions)
│   ├── js/                     # Vitest unit tests (engine systems, 300+ tests)
│   └── e2e/                    # Playwright end-to-end tests
└── docs/                       # All project documentation
    ├── INDEX.md                # Documentation navigation index
    ├── technical/              # Architecture, WebGPU engine, performance, roadmap
    ├── gamedesign/             # Game design documents and balancing
    └── lore/                   # Faction lore, art prompts, LORA training
```

→ Full documentation index: [docs/INDEX.md](docs/INDEX.md)

---

## Database Schema (35 tables)

```
users                  – accounts, rank, dark matter, protection, TOTP secret, RBAC role
user_character_profiles – AI-generated character portrait URLs and biography text
remember_tokens        – persistent "remember me" login tokens
app_state              – key/value game-state store (server-side flags)
star_systems           – cached star properties + 3D coords (ly), orbital polar coords
binary_systems         – binary star pair definitions
planets                – astronomical data, richness × 4, finite deposits × 4
colonies               – player base: resources × 5, food, population, happiness, colony type
buildings              – type + level per colony
building_upgrade_queue – async upgrade queue with scheduled finish timestamps
research               – type + level per user
ships                  – type + count per colony
fleets                 – 3D origin/target coords, mission, cargo, ships_json, FTL state
celestial_bodies       – moons, asteroids, unified body catalog
wormholes              – wormhole pairs + stability, traversal cooldown
user_wormhole_unlocks  – per-user beacon unlock state
ftl_gates              – player-built FTL gate locations
ftl_resonance_nodes    – FTL resonance network nodes
leaders                – role, skills, autonomy, colony/fleet assignment
messages               – inbox (player ↔ player + system messages)
battle_reports         – attacker/defender/loot/tech JSON + composite indexes
spy_reports            – target resources/welfare/ships/leaders JSON
npc_factions           – 5 seeded factions with archetype parameters
diplomacy              – per-user standing (−100 war ↔ +100 allied) per faction
trade_offers           – AI-generated, timed, per-faction trade proposals
faction_quests         – 8 seeded quests (kill/deliver/explore/build/research/spy)
user_faction_quests    – active/completed quest instances per user
trade_routes           – permanent player trade routes between colonies
alliances              – player alliance entities
alliance_members       – per-player alliance membership + role
alliance_relations     – inter-alliance diplomatic standing
alliance_messages      – alliance-internal messaging
achievements           – 15 milestone definitions
user_achievements      – completion + reward-claimed state per user
colony_events          – active planetary / colony event log
```

