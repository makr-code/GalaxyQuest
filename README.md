# GalaxyQuest

[![CI/CD Pipeline](https://github.com/makr-code/GalaxyQuest/actions/workflows/ci.yml/badge.svg)](https://github.com/makr-code/GalaxyQuest/actions/workflows/ci.yml)

> **A browser-based, multiplayer space-strategy game** — persistent galaxy, Newtonian fleet movement, planetary economies, NPC factions, and AI-driven leaders. The frontend is built with Vite and the backend uses PHP and MySQL.

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

Setup also creates persistent faction capitals/NPC footholds, their engine-controlled
owners and starter assets. Placements for the 19 lore factions are explicit in
[faction_homeworlds.json](config/faction_homeworlds.json) and currently marked as
provisional. Other DB/PvE factions receive deterministic footholds. Existing worlds
and spent resources are preserved on reruns; occupied locations are never taken over.
See [setup behavior and verification](docs/technical/REALITY_CHECK_2026-10-29.md#fraktionshauptwelten-als-setup-voraussetzung).

On an **already migrated** database, preview or ensure just these homeworlds without
the global galaxy warmup:

```bash
docker compose exec -T web php setup.php --homeworlds-only --dry-run
docker compose exec -T web php setup.php --homeworlds-only
```

If you changed galaxy generation and want a full regeneration of cached systems:

```bash
docker compose exec -T web php setup.php --regen-galaxy
```

For a non-Docker setup, see [Manual Installation](#manual-installation).

Gameplay and systems design:
- [Gameplay Data Model & Mechanics](docs/gamedesign/GAMEPLAY_DATA_MODEL.md)

Developer 3D tooling:
- [TRELLIS2 Dev Toolset](docs/technical/TRELLIS2_DEV_TOOLSET.md)

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
POST /api/glossary.php?action=generate
X-CSRF-Token: <token>
Content-Type: application/json

{"term":"white_dwarf"}

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

Current implementation status and verification limits: [Reality Check (29 October 2026)](docs/technical/REALITY_CHECK_2026-10-29.md).
Path to production readiness: [ROADMAP.md](ROADMAP.md), based on the [Production Readiness Audit (31 October 2026)](docs/technical/PRODUCTION_AUDIT_2026-10-31.md).

### Vanilla JavaScript and ES Modules

The frontend uses HTML5, CSS3 and vanilla JavaScript ES modules, with PHP 8 and PDO on the backend. The active page entry point is `js/main.js`, loaded by `index.html`; it composes the authentication and renderer runtimes, then initializes the game domains after authentication succeeds and exposes the public runtime through `window.GQGame`.

- **No UI framework** — application UI and runtime behavior are implemented in project modules.
- **Build and test tooling exists** — Vite, Vitest and Playwright are configured in `package.json`; the project is not dependency-free.
- **Deployment must serve the module graph and assets correctly** — Docker/PHP setup remains available, while Vite provides development and build commands.

#### Local Vite + PHP development

`npm run vite:dev` serves the frontend on `http://127.0.0.1:8080` and proxies
PHP requests (including registration, sessions, portraits and narration) to
`http://127.0.0.1:8081`. The PHP backend must be running separately, serving
this repository with its configured MySQL database. Vite does not execute PHP.
Port 8080 is strict so a conflict does not silently open a different frontend.
The Compose Apache service binds to `127.0.0.1:8081`; start the existing backend
services with `docker compose up -d --no-build db tts web`, then run Vite.

To use Apache directly at `http://localhost:8081`, run `npm run vite:build`
in the repository first. The Compose bind mount hides the frontend built into
the image; Apache therefore serves the local `dist/index.html` and resolves
`/assets/` URLs from `dist/assets/`. Rebuild after frontend changes, or use
the Vite server on port 8080 for live development. Keep the source `index.html`
unchanged rather than overwriting it with the build output.

For another PHP backend, set `GQ_PHP_BACKEND_URL` in the shell or in the local
Vite `.env.local` file, then restart Vite. Keep database credentials on the PHP
server, not in `VITE_*` variables. An unavailable backend returns a JSON 502
with a setup hint rather than serving PHP source or a misleading HTML response.
The development audio catalogue remains available directly from Vite.

#### Playable registration drafts

The character review now enters an isolated, server-persisted draft command
level instead of closing the registration. It uses the existing start-world
renderer and offers local building upgrades, research, basic ship construction
and probe surveys within the private system. Shared galaxy APIs still require a
confirmed user session; drafts create no public users, colonies, fleets or
market entries.

Draft gameplay has no server-side expiry. The browser retains an HttpOnly
draft-owner cookie for returning to the same draft after its PHP session ends.
Keep this browser cookie: before confirmation there is no account login or
cross-device recovery. Main-menu Resume and page reload restore server progress.
Progress settles on demand using the shared economy simulation, cost and
duration functions, not a background tick engine. Each refresh catches up at
most one offline day; further refreshes catch up longer absences before orders
or confirmation. The isolated draft does not include shared trade, PvP,
alliances, colonization or advanced ship designs.

Apply the canonical migrations, including `migrate_registration_play_v1.sql`
and its economy/ship-queue prerequisites, before enabling this flow. The
`registration_play` table stores private progress; no password hashes or
confirmation tokens are returned in its public state response.

Login name, email and a password are optional until the player chooses permanent
registration in the draft command level. Local Docker development simulates
delivery through Mailpit (`docker compose up -d --no-build mailpit web`).
Open the email at `http://localhost:8025` and follow its confirmation link.
The email body contains only this link, never a numeric code. Links expire after
24 hours, are single-use and may be resent after one minute (invalidating
the previous link). Only a SHA-256 hash of the random 256-bit token is stored.
The link works in another browser without a draft-owner cookie. Its token is
carried in the URL fragment, removed from browser history on startup and submitted
via a CSRF-protected POST; a plain HTTP GET does not activate an account.
Set `REGISTRATION_PUBLIC_URL` to the externally reachable application root
(default `http://localhost:8081` in development); links never use the request Host.
Apache routes legacy `index.html` links (including logout) through the same
bundled entry as `/`, so returning to login does not load unbundled source.
Previously sent numeric codes no longer work; request a new email.
Code-based administrator 2FA is a separate, future authentication concern, not
part of email validation. Existing 2FA functionality is unchanged.
A delivery or confirmation failure leaves the
playable draft intact. This is deliberately **not production email delivery**:
the adapter is enabled only for `APP_ENV=dev` with `REGISTRATION_MAILPIT_URL`.

Successful confirmation atomically creates the user and reserved colony,
transfers stocks, population, research, ships and paid pending queues, archives
the draft dossier/portrait and survey progress, and then enters the existing
authenticated game shell. A failed promotion rolls back; it cannot reset or
partially publish a draft. Raw `register`/`register_complete` calls remain
disabled to prevent bypassing email confirmation.

The login name can differ from the Commander dossier, allowing an already-taken
account name to be corrected without replacing the playable world.

### Server-authoritative UI migration

The start-screen radio and in-game topbar share one audio manager and playlist.
Playback and pause position survive login without recreating audio decks.
Selected track, pause preference, mute and music volume are also restored after
the logout page reload. Both players observe `gq:audio-state`; the topbar
also offers the shared track selector, previous/next controls and an
Escape-dismissable keyboard-accessible player menu. Playback failures are
shown on both surfaces, and browser autoplay restrictions remain respected.

The authenticated ES-module entry now awaits session validation and
`api/game.php?action=overview` before showing the game shell. It no longer boots
the twelve prototype domains against fake repositories or a logging-only event
bus. `js/engine/runtime/server-game-session.js` owns the overview read model;
`window.GQGame.domains.overview` exposes `refresh()`, `getState()`,
`getColony()` and `selectColony(id)`. Snapshots are defensive copies.
The existing registered event bus publishes `overview:updated` after refresh
and selection changes. The colony picker and resource HUD display server
values, including zero and negative energy, without running a client economy.

Refresh is explicit, coalesces concurrent requests, and reports failures rather
than inventing empty state. Logout/session expiry clears account data and UI
bindings, aborts active overview requests and rejects stale responses.
The shared module API reuses the existing transport (timeouts, GET-only retries,
versioned endpoints) and CSRF-session helpers. Mutations are never retried by
the transport.

Buildings and research now use server-backed domain adapters and the existing
window manager. Open them from the Colony dropdown or the mobile-accessible
development shortcuts beside the HUD. Lists show server levels, base costs,
prerequisites, research end times and the construction queue. The list actions
are GET-only; use **Fällige Aufträge abschließen** to explicitly submit the
canonical `finish` POST. Starting an order uses `upgrade`/`research` POST with
CSRF. No client-side cost, duration or completion simulation is used.
With the on-demand engine enabled, a server settlement may itself complete due
construction; opening a window never sends an extra frontend completion POST.
Server-side overview/resource caches are invalidated after successful commands
so the HUD can display the actual remaining resources immediately.

Colony changes discard old lists and abort obsolete GET requests; late replies
cannot replace the selected colony. Double submissions are blocked per domain.
If a command succeeds but refreshing fails, the UI says the command was
accepted and asks for a refresh, never automatically resubmitting it.
Logout closes these windows, removes subscriptions and aborts active requests.
The new interfaces are `window.GQGame.domains.buildings` and `.research`.

The economy window now reads `api/colony_economy.php?action=snapshot` and
`api/economy.php?action=get_policy`, exposed through
`window.GQGame.domains.economy`. It shows actual stock, storage, population
classes, shortages and the last settled production/consumption rates. Missing
rates are shown as an em dash, never estimated by the browser. The server
snapshot also exposes production methods (including explicit standard defaults)
and storage capacities.

Empire-wide policy, taxes and subsidies use explicit CSRF-protected POSTs.
Production-method changes use the canonical colony economy `set_method` action.
Each setting is saved separately; prerequisites and resource availability are
checked by PHP. Tax values are sent as fractions, while controls display
percentages and honor the schema's supported precision. Integer-percent legacy
schemas and fractional schemas use the same normalized values in the UI and
simulation, including 0% and 1%. Economy settlement/commands invalidate affected
overview/resource/building caches and mark enabled overview projections stale.
The first policy write preserves the previously effective defaults for all
other settings instead of accidentally adopting different legacy schema defaults.
The economy and construction adapters share colony-switch, request-cancellation,
duplicate-command and logout handling; no scheduler or client economy is added.

The new economy window requires `ON_DEMAND_ECONOMY_ENABLED=1`. Apply/verify
`migrate_economy_on_demand_v1.sql` and its prerequisite building/queue migrations
before enabling it. Docker Compose passes this flag from the local `.env`
(default remains **0** for unconfigured environments). After changing the local
flag, recreate only the web service with `docker compose up -d --no-deps web`.
When disabled, the UI explicitly reports the unavailable engine rather than
substituting legacy or fabricated data.

This is **not completion of the full UI migration**.

The start-menu galaxy and authenticated playing field are the same scene,
canvas and WebGPU renderer. Login stops the public read-only tour and transfers
control without disposing the renderer. The player view replaces the catalog
with authenticated `api/galaxy.php?action=stars` data and reads systems through
the fog-of-war-filtered `action=system` endpoint. Decorative public stars remain
visual-only and cannot be selected as game systems.
`window.GQGame.domains.galaxy` provides explicit map refresh, galaxy/system
navigation and home-system selection. The field supports pointer selection,
dragging, zoom controls, coordinate entry, searchable loaded systems, planet
selection and management links for owned colonies only. Switching the active
colony follows its system. Stale navigation requests are aborted/discarded.
Logout removes player data and interactions and returns the same renderer to
the public menu view. Missing WebGPU is reported explicitly; server navigation
remains usable instead of displaying invented game state.

The galaxy canvas fills the complete viewport, including behind UI controls.
Only a compact command/audio dock and collapsed navigation entry stay visible.
The command menu contains colony selection, resources and development actions;
map navigation and search expand separately. System details appear on selection.
All menus and development windows are overlays and never reserve canvas space.
The legacy permanent top/resource bars and bottom taskbar are not shown in this
layout. The window list is inside the command menu, so minimized windows remain
recoverable. Command overlays close with Escape, their close button or an outside
pointer action; logout restores the original DOM locations and menu view.

The authenticated canvas uses a scale-aware orbit target, not distance from the
galaxy origin. Left-drag rotates, right/middle-drag or Shift+drag pans, and the
wheel zooms with surface collision limits. Double-click a star to enter its
server-loaded system, then a planet to approach it; double-click again or zoom
closer to enter a visible colony. Outward zoom and Escape return through the
hierarchy; Home recenters the current level. Arrow keys rotate (Shift pans).
On touch screens, one finger rotates and a tap selects; two fingers pan and
pinch to zoom on the same canvas, including the live colony/building camera.
Multi-touch gestures never select objects on release. Pointer cancellation,
capture loss and logout clear the active contacts without triggering actions.
Collapsed Navigation > Kamerasteuerung provides help and camera buttons.
The compact view path exposes only current/ancestor levels. Ancestor buttons
use the existing reverse transitions, prevent repeated submissions, and restore
keyboard control to the canvas. The path is hidden at galaxy level.
Clicking a planet reveals a compact context from the current canonical system
data, with approach and (for owned colonies only) surface/management actions.
Selection survives same-system refreshes, clears on system changes or explicitly,
and is hidden while the native colony/building context is active. Management
uses the same validated building-window request as the surface HUD.
System details offer explicit planet/colony focus buttons. Planet approach and
the full colony surface use the existing `SeamlessZoomOrchestrator`,
`PersistentBodyPlanetApproachRenderer` and `ColonySurfaceLevelWebGPU`: streamed
terrain, saved buildings, construction VFX, cosmetic population and building
detail. The shared starfield frame hook drives all levels without another device,
canvas or animation loop. Own-colony building/economy snapshots come from the
canonical APIs; foreign surface data is not requested. Navigation away or logout
aborts pending entry and disposes level resources without destroying the shared
renderer. The same renderer, GPU device and canvas are retained at every scale.
System entry and return flights use that existing frame loop, preserving the
previous galaxy/system framing when backing out. Manual camera input cancels a
flight immediately. Colony-to-orbit navigation reverses the surface/planet
blend before freeing the surface resources. Reduced-motion preferences skip
these camera animations.
The native colony HUD starts collapsed to keep the surface unobstructed. It
provides saved-building inspection, building focus/return, snapshot refresh and
the authoritative building-management window. Surface mouse/keyboard controls
and the navigation helpers operate on that same live surface camera.
A building click reveals its surface context. Separate focus and management
actions either approach the selected building in the live scene or open its
highlighted canonical building card, with keyboard focus after loading.
Selection can be cleared in the building window and is reset on colony changes.
Accepted server building/research/economy commands refresh only the matching
visible colony surface, even if the overview refresh fails. Rejected commands
do not refresh or fabricate visual progress. Updated snapshots preserve the
current camera, selection and building-detail scene; pending reads are
cancelled on departure or logout. Hidden-tab changes refresh on return to the
tab. No polling loop or client-side construction completion is used.
Persistent terrain requires the existing additive migration
[`sql/migrate_body_terrain_v1.sql`](sql/migrate_body_terrain_v1.sql); missing
terrain is reported explicitly as a procedural preview, not persisted success.

The fleet overlay lists account-wide canonical missions, ships, cargo and
server arrival times. Origin/target actions open the existing galaxy playing
field. Recall and explicit due-arrival processing use CSRF-protected commands;
opening or refreshing the list never processes arrivals. Accepted commands
refresh the authoritative overview and fleet list. Failed refreshes retain
the last confirmed data, disable further commands until a successful read,
and explicitly instruct the player not to resubmit an accepted command.
Logout cancels pending fleet reads/commands and removes the overlay.

Running missions also expose clickable endpoint badges on the shared galaxy
and system map, grouped per loaded star or planet. The compact selection shows
canonical ships, cargo, direction and server arrival time, with map navigation,
recall and explicit arrival processing. Badges follow the existing shared
renderer frame hook and camera projection; off-screen, unloaded and surface-level
endpoints are not fabricated. They indicate origin/target, not a simulated
in-flight position or a common transit path. Target picking hides these badges
so they cannot intercept destination clicks. Reads do not process arrivals,
stale data disables commands, and logout removes markers and frame subscriptions.

Fleet commands are point-and-click on the galaxy playing field, not a separate
launch window. Click an owned planet and choose "Flotte hier auswählen" to
select its stationed inventory. The compact map overlay provides ships,
mission and optional cargo. "Ziel im Spielfeld wählen" arms target selection:
click a star to enter its system, then click a planet to set the destination.
Picking only selects a target; dispatch still requires explicit confirmation.
Escape cancels target picking without changing the existing order or camera.
Planet context can also set the destination without changing the origin.
Coordinate inputs remain collapsed as a keyboard alternative.
The inventory includes standard ships and blueprints. Launch uses the existing CSRF-protected
send command; capacity, fuel, prerequisites and ETA remain server-authoritative.
Successful dispatch invalidates the origin shipyard and overview caches before
acknowledging, so the subsequent inventory read cannot reuse pre-launch counts.
Accepted launches clear selected ships/cargo before refreshing, including on
refresh failure, and require a fresh inventory before further launches.
Rejected launches preserve the draft. Changing origin clears the draft and
cancels obsolete inventory reads. Transit is not a generic standard flight:
the overlay reads the account's authoritative `ftl_status` and displays the
existing Vor'Tak K-F, Syl'Nar gate, Vel'Ar quantum, Zhareen resonance,
Aereth warp or Kryl'Tha swarm profile. Cooldown is a server snapshot, not a
local countdown or route-clearance promise. Range, gates/nodes, scatter,
damage and final ETA are applied by the existing server faction-drive rules,
never recreated as a client simulation. Unknown/failed transit reads block
dispatch with an explicit error. Manual wormhole override is not yet exposed.

The authoritative shipyard overlay is accessible from the command menu, an
owned planet's context and fleet composition. It reads the standard catalog,
existing blueprints, stationed counts and build queue from `shipyard.php`.
Build orders and explicit due-build completion use CSRF-protected POSTs;
opening or refreshing never completes builds. Listed costs are base costs,
not client-calculated quotes: colony bonuses, prerequisites and final duration
remain server decisions. Accepted orders clear quantity drafts and require
a fresh list before another command if refresh fails. Rejections preserve
the draft, colony changes clear it, and logout aborts outstanding work.
Shipyard acceptance and processed fleet arrivals invalidate fleet-composition
inventory, while dispatch invalidates the displayed shipyard inventory.
Completed ships can be selected through the existing map fleet controller.
Blueprint design, individual-vessel repair and decommissioning are not yet
migrated into this overlay.

The market overlay reads local colony prices, a subsequent canonical stock
snapshot and the last 20 account-wide transactions. The command menu and economy
panel open the same overlay. Buy/sell use CSRF POSTs with captured colony, good
and positive decimal quantity. Prices are snapshots, not quotes; tax, policy,
credits and storage validation stay on the server. Price reads can settle
on-demand production but never initiate trades. Accepted trades clear the
quantity before refreshing and invalidate overview/resource caches in both
economy modes. Failed refreshes retain the confirmed data and lock further
trades until a fresh read; rejected orders preserve their draft. Colony changes
and logout clear private drafts and cancel obsolete work.

The population/supply overlay shares the canonical economy domain and its
snapshot; it does not read the legacy tick-based population status or post
legacy wage/culture/safety policy. Command menu, population resource button,
economy panel and owned planet context open the same view. It shows population
classes, capacity, satisfaction, workplace occupancy and measured supply gaps;
missing metrics are shown as unavailable rather than healthy zeroes. A gap
opens the selected colony's market with its good preselected, but no quantity
or trade is generated. Unavailable goods are explicitly reported and cannot
silently become another purchase. Accepted trades refresh an open supply view.
Reads remain on-demand, without polling or client growth simulation.
The compact command/audio dock and its drawer stay above the current game-window
stack, updated by window-focus events without polling. Selecting a game window
closes the drawer, so navigation remains accessible without hiding that window.
While management windows are open, the dock offers "Spielfeld" to minimize them
as a group. "Fenster (n)" restores only that group in its former stacking order,
using the window manager's restore operation without re-rendering, reads or
commands. Existing quantity drafts and pending commands survive. Previously
minimized windows stay minimized; manually restored or closed group members are
removed from the remembered group. Closing the last window hides this contextual
control. The galaxy canvas, camera and point-and-click fleet overlay are not
minimized or reset. Logout removes the control and its in-memory group.

Resource buttons open the same authoritative overlays: raw goods select their
economy stock details, population and happiness open supply, and energy shows its
signed server balance (not a stored/tradable good). Stock-table names also select
details, including processed goods. Selection is highlighted and keyboard-focused
after loading, without stealing focus on later reads; colony changes and the
generic economy entry clear it. Missing measurements remain explicitly unavailable,
not inferred from the overview or replaced with zero. A stock's market action
preselects only the colony and good; the market checks availability and still
requires quantity and explicit confirmation. Read errors block this handoff until
recovery. Dark Matter is a read-only account balance, not an inactive shop button.

Advanced population policy commands,
general window navigation and advanced renderer-selection integration still need migration.
The old client-only domain controllers remain outside the authenticated boot
until backed by canonical server commands. Rendering remains Three.js/WebGPU;
game rules and on-demand progression remain authoritative in PHP.

Returning players see **Fortsetzen** instead of Login after the server validates
their session or persistent login cookie. Password login defaults to
"Auf diesem Gerät angemeldet bleiben"; successful email confirmation also issues
the existing `gq_remember` cookie, including a retry after cookie-storage failure.
It lasts `REMEMBER_ME_DAYS` (30 by default), is HttpOnly, SameSite=Lax and Secure
over HTTPS. Only a selector and random validator go in the cookie; the database
stores the validator hash. Session restoration rotates the validator. The start
screen never trusts a local flag or enters the galaxy without an explicit click.
Logging out revokes the persistent tokens and clears both cookies; expired or
revoked cookies fall back to Login. Private drafts retain their separate owner
cookie and do not receive an authenticated account cookie before confirmation.
Cookie issuance errors are logged and surfaced, not silently reported as a
successful persistent login.

Persistent login HTTP tests use an isolated disposable MySQL database:
`GQ_REMEMBER_MYSQL_TESTS=1` enables
`tests/Integration/RememberLoginTest.php`. Optional `GQ_REMEMBER_TEST_USER` and
`GQ_REMEMBER_TEST_PASSWORD` supply a test-only database creator; the configured
application user is otherwise used. The test removes its database, server and
session files on completion; it does not modify the live game database.

Focused tests: `npx vitest run tests/js/draft-world.test.js
tests/js/registration-prologue.test.js tests/js/start-screen.test.js` and
`$env:GQ_BASE_URL='http://localhost:8081'; npx playwright test draft-world.spec.js`
in PowerShell.
The MySQL lifecycle test (`tests/Integration/RegistrationPlayTest.php`) requires
`GQ_DRAFT_PLAY_MYSQL_DSN` pointing to an **empty disposable** database named
`gq_draft_play_*`, with matching `DB_NAME`, `DB_USER` and `DB_PASS`; never use
the live database. It checks isolation, persistence, mail failure, code
validation and atomic progress transfer.

### Server-authoritative, elapsed-time production

Colony production is calculated from elapsed time rather than a continuously
running game loop. Fleet arrivals and NPC updates are still resolved lazily on
requests:

- Every API call that touches a colony first calls `update_colony_resources($db, $colonyId)`, which calculates exactly how much was produced/consumed since `last_update` using elapsed-time arithmetic.
- Fleet arrivals are resolved lazily the first time any request reads fleet state (`check_arrivals`).
- NPC AI runs a single rate-limited tick (max once per 5 minutes) on each overview load.

This avoids requiring a dedicated simulation worker for those paths, but
request-time simulation and concurrent updates still need operational controls
before production use.

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

---

## Contributing

### Local Development Artifacts

When running tests and development scripts, the following temporary files are **automatically created and should never be committed**. They are listed in `.gitignore` and are safe to ignore:

#### Test Session Cookies
- `.gq_cookies.txt` – Main test session authentication cookies
- `.gq_diag_cookies.txt` – Diagnostic test session cookies
- `.tmp-*.cookies.txt` – Temporary authentication files created by PowerShell E2E tests:
  - `.tmp-leader-e2e.cookies.txt`
  - `.tmp-leader-roles-e2e.cookies.txt`
  - `.tmp-register-profile-*.cookies.txt`
  - `.tmp-logout-test.cookies.txt`
  - `.tmp-faction-dialog.cookies.txt`
  - And similar test-specific variants
- `.tmp_system_test_cookies.txt` – System test authentication file

**Note:** These cookie files are created by test scripts (e.g., `scripts/test_leader_e2e.ps1`) and contain local session data only relevant to the running instance. They **never contain sensitive production data** and are automatically cleaned up by test setup routines.

#### Other Temporary Artifacts
- `*.tmp` – General temporary files
- `*.swp`, `*.swo` – Text editor swap files
- `*.pyc`, `__pycache__/` – Python cache files

**Best practice:** Verify these files are ignored in your Git status before committing. They should never appear in `git status`.
