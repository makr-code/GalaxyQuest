# GalaxyQuest

[![CI/CD Pipeline](https://github.com/makr-code/GalaxyQuest/actions/workflows/ci.yml/badge.svg)](https://github.com/makr-code/GalaxyQuest/actions/workflows/ci.yml)

> **A browser-based, multiplayer space-strategy game** — persistent galaxy, Newtonian fleet movement, planetary economies, NPC factions, and AI-driven leaders. The frontend is built with Vite and the backend uses PHP and MySQL.

---

## Quick Start

```bash
# Docker Desktop
docker compose up --build

# App: http://localhost:8081
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
- 💾 **Smart Caching** – generated definitions are cached for 5 days; response time depends on the database/cache environment
- 🔄 **Toggle UI** – Switch between Static ↔️ AI definitions in the modal
- 🧠 **Model Configuration** – selected with `OLLAMA_DEFAULT_MODEL` (development default: `mistral`)

**Getting Started:**
```bash
# Start the Compose Ollama service and pull the configured development model
docker compose --profile ai-creative up -d ollama
docker compose exec ollama ollama pull mistral

# The web container connects to http://ollama:11434.
# The service is exposed to the host on localhost:11435 by default.
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
- A cache hit is returned before external Wikipedia/Ollama requests.
- On a cache miss, the `generate` endpoint requires Wikipedia context and a successful Ollama request; failures return an API error.
- The endpoint does not itself guarantee a static-definition fallback when generation fails.

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
- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`; Docker Compose overrides this with `http://ollama:11434`)
- `OLLAMA_DEFAULT_MODEL` (default `mistral`)
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

### Frontend JS Build

The production frontend uses Vite. `index.html` loads the ES-module entry at
`js/main.js`, and CI builds the versioned assets with `npm run vite:build`.
The former PHP/Uglify boot bundles (`*.ugl.js.gz` and
`js/packages/game.boot.bundle*.js.gz`) are not part of the production boot path
and must not be committed.

The legacy `scripts/build_minified_js.php` utility remains available for
compatibility experiments; its generated gzip output is ignored and excluded
from the production runtime.

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

Dated implementation snapshot and verification limits (29 October 2026): [Reality Check](docs/technical/REALITY_CHECK_2026-10-29.md).
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
The HUD status badge distinguishes loaded, loading, unavailable-colony and
refresh-error states; the refresh control shows its busy state and honors
reduced-motion preferences.
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
Failed 3D startup rolls back partially attached camera controls and fleet-map
hooks before offering an explicit retry. Retry applies the latest server galaxy
and selected system, without reissuing game commands or replacing a healthy
shared renderer. Obsolete startup callbacks are ignored, including after logout.
If an adapter becomes available after an initial failure, retry makes the same
canvas visible again; this is WebGPU recovery, not a switch to a legacy backend.
Colony snapshot errors remain visible while rotating or zooming. A successful
snapshot clears only its own error, not unrelated navigation failures. Leaving
the surface clears its obsolete error context and ignores late surface callbacks.
System scene updates compare the complete canonical payload, not just its server
timestamp. Changed or removed planets reach the renderer even within the same
timestamp; identical payloads leave the existing scene and camera untouched.
If refreshed server data removes the focused planet or its visible colony, the
view returns to its system and cancels/disposes the obsolete surface approach.
Valid focused planets and colonies keep their existing view.
Validated system-star data also replaces a stale sampled catalog entry, keeping
map coordinates, labels and subsequent selection consistent. Catalog-only
metadata is retained, but missing system coordinates are rejected rather than
filled from stale data. Superseded catalog replies cannot start system reads.

Registration keeps narration retries independent from pending draft operations,
so restoring a selected mentor does not block the next step. Herald focus and
selection made while the WebGPU models load are applied when the stage is ready;
leaving registration also disposes stages that finish loading afterward.
The inactive start menu fades out without enlarging the document, preventing
horizontal overflow when resuming the registration flow on a narrow screen.

The galaxy canvas fills the complete viewport, including behind UI controls.
Only a compact command/audio dock, collapsed navigation entry and a collapsible
empire outliner stay visible.
The command menu contains colony selection, resources and development actions;
map navigation and search expand separately. System details appear on selection.
All menus and development windows are overlays and never reserve canvas space.
The legacy permanent top/resource bars and bottom taskbar are not shown in this
layout. The window list is inside the command menu, so minimized windows remain
recoverable. Command overlays close with Escape, their close button or an outside
pointer action; logout restores the original DOM locations and menu view.
Escape dismissal respects foreground controls and IME composition. A handled
command-menu dismissal consumes the event so it does not also close another overlay.
Resources and the command drawer are mutually exclusive. Escape closes either
menu and returns focus to its trigger, while respecting handled events and IME
composition. Pointer actions outside each menu dismiss it without stealing focus
from the destination. Both menus start below the actual quick-access dock height,
including wrapped controls; the resource popup stays within the viewport and
both menus scroll within the remaining screen height.
The command drawer puts colony selection, refresh and data status before the
window picker. Picker actions always open, restore or focus a window, matching
the empire outliner; selecting a visible window never minimizes it. Use the
window title bar or "Spielfeld" to hide windows. Failed or unavailable window
actions keep the menu open and announce explicit feedback. Standard-layout
save/load controls remain inside the initially collapsed "Fensterlayout" disclosure.
The existing live data-status node moves out of the resource popup into the
command drawer beneath the colony context and returns to its original position
on logout. Outliner metadata, stock values and notes, management captions and
command-picker metadata use at least 12px text with explicit line spacing;
long status messages wrap within the drawer rather than expanding it.
The existing command button shows a compact text badge for loading, data errors
or a missing colony even while the drawer is closed. It references the full
existing status message for assistive technology and exposes it as a tooltip;
ready/idle states remove the badge. This mirrors DOM status changes without
additional requests, polling, duplicate live regions or automatic menu opening.
Refresh and home-system buttons have visible text labels within the command
drawer, with 44px minimum height. The active-colony selector has a visible label
and uses the available row width. Existing buttons, handlers and accessible
names remain unchanged; outside the overlay layout the action captions stay hidden.
The resource popup uses responsive labeled cards with at least 64px height,
wrapping quantities and an explicit keyboard-focus outline. German resource
names replace abbreviations; a short hint distinguishes colony stocks from
account-wide dark matter. Dark matter remains a non-interactive balance display;
the existing eight resource buttons still open their existing detail actions.
The popup names the active management colony and its coordinates above the
stocks. Existing overview events update this context without recreating resource
controls, moving focus or fetching data; no active colony produces an explicit
selection hint. Logout removes the header and its subscription.
Activating a resource moves keyboard focus to the opened economy/population
window title unless the detail view already focused a more specific target.
Closing a menu for an action first recovers focus to its visible trigger, so
unavailable destinations do not strand focus in hidden controls. Programmatic
actions preserve external focus, and logout cancels pending focus transfers.
Within the open resource popup, Up/Down moves through available resource buttons
in document order without wrapping; Home/End selects the first/last focus target,
never a resource action. Up/Down from the disclosure summary enters at the last/
first button respectively. Hidden/disabled controls and the passive dark-matter
balance are skipped; the focused button scrolls into view. Native Tab, Enter,
Space, modified shortcuts, handled events and IME composition remain unchanged.
The resource popup has a sticky heading with a labeled 44px close button,
reachable even after scrolling to the last resource. Closing returns focus to
the resource summary; scroll padding keeps keyboard-focused cards below the
sticky controls. Logout removes the toolbar and its listener.
The command drawer likewise keeps its title and 44px close button sticky while
scrolling through window and layout actions. Scroll padding leaves room for
the toolbar when keyboard focus moves through the drawer; closing still returns
focus to the command trigger without hiding management windows.

The audio menu offers "Musik bei Sprachausgabe absenken" and a strength slider.
These preferences persist in the existing audio settings. Music stays reduced
for the actual audible TTS playback, including overlapping clips and registration
narration, and returns to the current music level after pause, completion or error.
Music volume, mute and track selection remain independent of the temporary reduction.

### Developer blog: News and transmissions

The start menu displays the five latest published developer posts directly as
choices, ordered by publication time and ID. Selecting one opens its plain-text
article without autoplay. "Beitrag vorlesen" reads the complete article in
bounded sections through the shared TTS channel, including music ducking.
Stop, article changes, closing the panel or entering the game cancel narration.
Failed loads and unavailable/muted TTS show explicit messages with retry controls.

With `BLOG_SOURCE=local`, administrators use [the blog editor](developer-blog-admin.php) (also linked from
the news panel) to create/edit drafts, publish and withdraw posts. The server
requires an authenticated administrator plus CSRF for edits. Public narration
POSTs require CSRF and accept only a published post ID, version and section index,
never arbitrary speech text. MP3s use the existing TTS cache/service configuration.
Posts support 160-character titles and 3,000-character plain-text bodies,
validated server-side and counted as Unicode characters in the editor.
Display and narration share this cap; older oversized posts are returned as
bounded versions with a visible truncation notice, without changing stored text.
Drafts are never returned by the public endpoint. The editor paginates 20 posts.
The editor warns before discarding unsaved changes or leaving the page.
Publication-only edits are protected as well. A failed list refresh after saving
is explicitly distinguished from a failed save. Both editor and public article
show an approximate narration duration based on 130 words per minute, not a
guaranteed audio duration.
Post updates use an atomic revision check: stale administrator edits return
HTTP 409 without overwriting newer text or publication state. The editor keeps
the unsaved text and lets administrators reload the list before comparing
versions. Narration also checks this revision, including changes within the
same second.
The five public choices support Up/Down and Home/End for focus navigation
without selection or autoplay; Tab, Enter and Space retain native behavior.
Keyboard-started narration moves focus to Stop, then back to Read on stop,
completion or failure, unless the user has already moved focus elsewhere.

Categories and tags are edited as comma-separated slugs (a-z, 0-9, hyphens;
up to 32 characters each). Posts have 1–5 categories and 0–10 tags. Duplicate
terms are removed and case/outer whitespace normalized. Existing posts default
to category `entwicklung` without rewriting stored content. The `hero` tag
adds a visible importance badge and highlighted border in the latest-five menu
and article. It does not reorder posts, trigger autoplay or become narration text.
Taxonomy edits use the same revision and unsaved-change protection as text edits.
Public blog actions share one compact toolbar using the existing monochrome SVG
icon set with 32px targets (36px for coarse pointers), accessible labels and native
tooltips. Empty status lines take no space; article titles and taxonomy remain text.
The toolbar stays visible while scrolling through long articles. Scroll padding
keeps keyboard-focused article content below it instead of behind its buttons.
The editor retains its larger action targets.
The five choices are compact cards with a two-line title, publication date,
primary category and two-line plain-text preview (up to 140 Unicode characters).
The full title remains available as a tooltip and accessible button name;
selecting any part of the card opens the complete article without autoplay.
Selecting or refreshing an article resets only the article panel's scroll
position, so a new text never inherits the previous article's end position.

An optional **Animationsziel** in the editor links a post to an existing faction
homeworld. The public catalog exposes only faction/world names and public
system/planet coordinates, never player IDs or colony management data. Clicking
the galaxy icon explicitly starts the existing read-only flight tour at that
system and selects the homeworld planet for its approach. No new simulation or
camera engine is used. It then continues the normal tour. The settings toggle
reflects this activation and can stop it; reduced-motion and registration/game
lifecycle controls remain in effect. Merely opening or reading a post does not
start camera motion.

Deploy `sql/migrate_developer_blog_v1.sql`, `sql/migrate_developer_blog_v2.sql`
and `sql/migrate_developer_blog_v3.sql`, then `sql/migrate_developer_blog_v4.sql`
through the migration runner. The base
schema and setup path include the table, revision and taxonomy; upgrades are
replay-safe. No example posts or administrator privileges are installed.

Live verification (2026-11-06) used five temporarily published, real development
texts and the configured German Piper service, without mocking narration or
audio. All five produced playable MP3s; a two-section article advanced to the
next clip, and a short article played naturally to completion. Stop, selection
changes and closing the panel paused speech and restored music volume
(0.4 → 0.037 during speech → 0.4). Hero/normal styling and 320/360/768/1280px
layouts were checked. Test posts and their PHP audio-cache files were removed
after verification; no account privileges were changed.
This test exposed and fixed empty prosody serialization (`{}`, not `[]`) and
structured TTS validation-error decoding in the shared PHP client.

#### Headless WordPress simulation and integration

In `APP_ENV=dev`, the default blog source is now `wordpress-simulation`.
Outside development the default remains `local`. Set `BLOG_SOURCE=local` to
restore the existing editor; no database posts are overwritten or imported.
The development simulation is deliberately a small, read-only REST contract,
not a WordPress installation, account system or second production CMS.

Open [the simulated blog](api/wordpress_sim.php) or the game's News menu at
`http://localhost:8081/`. The versioned
[fixture](config/wordpress_simulation.json) contains six released game articles,
a newer blog-only `hero` article, a draft, a private post and a password-protected
post. Only the five latest eligible game articles appear in GalaxyQuest.
Edit this fixture to simulate publication, withdrawal, summary or taxonomy
changes; the next refresh/narration request reads the current data. No
administrator account or database seed is needed. The endpoint returns 404
outside development. The simulation uses the existing Docker web service
(internal HTTP port 8080); no additional container, package or daemon is needed.

Supported WordPress-compatible requests use the native `rest_route` form:

```text
/api/wordpress_sim.php?rest_route=/wp/v2/tags&slug=game-start
/api/wordpress_sim.php?rest_route=/wp/v2/categories
/api/wordpress_sim.php?rest_route=/wp/v2/posts&tags=1&per_page=5&_embed=wp:term
/api/wordpress_sim.php?rest_route=/wp/v2/posts/106&_embed=wp:term
/api/wordpress_sim.php?rest_route=/wp/v2/posts&tags=1,3&categories=10&order=asc
```

The supported subset validates `per_page` (1–100), positive `page`, term-ID
filters and string parameters rather than silently coercing bad values.
Comma-separated or array tag/category filters use OR within each taxonomy and
AND across taxonomies. `order=asc|desc` is honored; only `orderby=date` and public
`status=publish` are supported. Unsupported values return HTTP 400 with
`rest_invalid_param`; a page beyond the filtered collection returns
`rest_post_invalid_page_number`. Empty collections remain successful on page 1.
This is a deliberately bounded simulation subset, not a complete WordPress API.
Post and taxonomy collections expose `X-WP-Total` and `X-WP-TotalPages`,
counted after filtering but before pagination. Counts are not capped at 100;
only the returned page is capped. Empty collections report both totals as zero,
and single-post responses do not carry collection totals. Tests cover a
126-post tagged collection and filtered taxonomy pages without modifying live
fixtures. Counting reuses the already-filtered collection rather than issuing
another request or rendering extra article bodies.
Posts provide `_links.self`, `_links.collection` and embeddable `wp:term` links.
Linked taxonomy collections honor the `post` filter and expose only terms of
public, unprotected posts. `_embedded.wp:term` is included only for `_embed`
(empty/`1`/`true` for supported relations, or a list containing `wp:term`).
An unrelated requested relation does not implicitly embed terms. When combining
embedding with `_fields`, include both `_links` and `_embedded`; the game adapter
already does so. Requests without embedding remain ordinary post responses.
Field selection supports nested paths such as `title.rendered`,
`meta.gq_summary`, `content.protected` and embedded term slugs, for both post
details and collections. Taxonomy collections honor `_fields` too. Resource
IDs are retained; selecting a parent retains its complete value, unknown fields
are omitted, whitespace/duplicate selectors are harmless, and an empty selector
leaves the response unchanged. HTTP tests verify that partial summaries do not
include unrelated meta fields or full article bodies.

Public responses are ordinary WordPress-style JSON, not the game's success
envelope. Articles include rendered title/content, dates, status, public link,
category/tag IDs, embedded terms and `meta.gq_summary` /
`meta.gq_target_faction_code`. The blog's full text is independent of the game
summary. Original links in GalaxyQuest open the separate full article; blog
and original-article actions remain compact, labeled icons.

**GalaxyQuest contract:**
- `game-start` is required. `hero` alone never grants access; it only highlights.
- Only `publish` posts with explicitly unprotected content and excerpt qualify.
  Drafts, private/protected posts and removed tags cannot be narrated.
- `meta.gq_summary` is required, nonempty **plain text**, at most 3,000 Unicode
  characters. No HTML/full-content fallback. Titles are converted from rendered
  HTML/entities into plain text and limited to 160 characters.
- Optional `meta.gq_target_faction_code` resolves against the game's public
  homeworld catalog (for example `aereth`), never arbitrary remote coordinates.
  Invalid summaries or unknown targets produce a logged source error.
- Embedded terms provide categories and tags. The game displays at most five
  categories and ten tags, bounded to 32 characters per slug; `game-start` and
  `hero` retain priority among tags. Publication date/ID still determine order.
  Terms are matched by taxonomy (`category` / `post_tag`) as well as ID:
  a category named `hero` is not a highlight tag. Malformed taxonomy data and
  invalid publication/modification calendar dates are explicit source errors.
  All category/tag IDs referenced by a post must resolve in embedded terms.
  Missing terms, conflicting slugs for one taxonomy/ID, or a `game-start` ID
  mapped to a different slug are source errors, not silently reduced metadata.
  Identical embedded duplicates are harmless; embedding order does not change
  the displayed terms or content revision. Post term-ID order controls mapping.
- Server HTTP requests have a 2-second connect / 6-second request timeout,
  a 1 MiB streamed response limit and no redirects. REST `_fields` requests
  exclude full article bodies. The adapter examines at most the latest 100
  tagged posts to fill the five public choices; exceeding this scan limit
  without filling them is an explicit error.
- This initial integration intentionally has **no feed cache**: list refreshes
  and every narration section re-fetch source data. A content-derived revision
  catches same-second edits (409); withdrawn/ineligible posts return 404.
  Source failures return 503 with retry feedback, not stale/local substitutions.
  A detail request counts as a missing post only when HTTP 404 contains the
  WordPress code `rest_post_invalid_id`. Missing REST routes (`rest_no_route`),
  HTML 404 pages, empty successful detail responses and error objects sent with
  HTTP 200 are source errors instead, so they do not incorrectly invalidate an
  otherwise published article in the client. Both REST URL forms have HTTP
  regression coverage for these cases and recovery.
  The game's independent loading flow remains usable if the blog is down.
- External modes disable local editing instead of maintaining two redactions.
  Existing shared TTS, music ducking, keyboard controls and manual homeworld
  flights are reused unchanged.

For a real WordPress site, set these server environment values (Compose forwards
them; recreate the web container after changing environment values):

```dotenv
BLOG_SOURCE=wordpress
BLOG_WORDPRESS_REST_URL=https://blog.example.org/wp-json
BLOG_WORDPRESS_SITE_URL=https://blog.example.org
```

REST bases ending in `/wp-json` use path routes such as
`/wp-json/wp/v2/posts`; a trailing slash and WordPress installed in a subfolder
are supported. Without pretty permalinks, set the REST base to the site's
`index.php` instead: the adapter uses `?rest_route=/wp/v2/posts`. Supply the
REST **base**, not the posts endpoint or an existing query string.
Both URL forms preserve tag filters, partial fields and embedding, use the same
publication/revision checks, and retain timeouts, response limits and redirect
refusal. The local simulation continues to use its existing query-form endpoint.

The same HTTP adapter is used in both modes. The real WordPress side must expose
the two typed custom meta fields on public post REST responses (`show_in_rest`)
and validate the summary/target in its editorial plugin. Public links must use
the configured site's exact HTTP(S) origin. No WordPress credentials or shared
login are required. The actual WordPress plugin, editorial UI, webhook/cache
invalidation and production deployment are separate follow-up work.

The simulation was verified through real HTTP requests and the running browser:
five eligible cards, hero/homeworld mapping, original article, 320–1280px layouts,
and natural Piper playback with music volume `0.4 → 0.037 → 0.4`.
Temporarily removing `game-start` immediately removed the article from the game
and blocked narration with 404, while leaving its public blog original available;
the fixture was restored afterwards. Stale revisions, missing CSRF, unavailable
upstream and the development-only gate were also checked. A blog load error
does not prevent opening the login form.

Repeatable real-HTTP regressions (no database, Piper or running game required):

```powershell
docker compose exec -T -e XDEBUG_MODE=off web php vendor/bin/phpunit --do-not-cache-result tests/Integration/WordPressBlogHttpTest.php tests/Unit/WordPressBlogSourceTest.php
```

The HTTP suite starts its own loopback PHP server on a dynamically assigned port
with a disposable copy of the simulation data. It exercises the real cURL
transport: publication and same-second edits, tag withdrawal/republication,
source errors/recovery, refused connections, six-second timeout, redirect refusal,
and the exact 1 MiB response boundary (one extra byte is rejected). A multi-megabyte
blog body verifies `_fields` excludes full text from game payloads. Taxonomy
separation and malformed dates/terms have HTTP regressions as well. The server,
logs and temporary state are removed after each test; the checked-in/live fixture
is never modified. The tests also run through the existing PHPUnit Integration
suite; no opt-in environment flag or external service is needed.

When narration returns 404 (withdrawn) or 409 (changed), the displayed article
is marked stale: Read and its homeworld flight action stay disabled until a
successful list refresh. Selecting another article does not silently clear that
state. A failed refresh preserves it; transient TTS/source 503 errors remain
retryable. Keyboard focus moves from Stop to Refresh when stale content cannot
be read again. No retry or refresh autoplays the updated article.
Refreshing stops active/queued speech immediately, even if the feed request fails.
During a pending refresh, selecting an existing card cannot re-enable narration
or start a homeworld flight. The client validates unique positive post IDs,
local/WordPress revisions, actual calendar dates, target IDs and Unicode limits
(160 title / 3,000 summary characters) before replacing the displayed feed.
Malformed envelopes and credential-bearing links produce explicit errors.
Cancelled CSRF requests never proceed to a write; late responses after blog
disposal cannot mutate the old DOM, even if a transport ignores cancellation.

Refreshing also preserves keyboard focus on a retained card by post ID, even
after reordering. If that focused card disappears, focus returns to Refresh.
Focus already moved outside the cards is not stolen; restoration never selects
another article or starts audio, and uses `preventScroll`.

Four Chromium regressions exercise rejection between narration sections,
failed refresh, recovery/withdrawal, focus and independent login access:

```powershell
$env:GQ_BASE_URL='http://localhost:8081'
npm exec -- playwright test tests/e2e/developer-blog.spec.js --project=chromium --workers=1 --reporter=line
```

These browser tests use controlled API/audio doubles, not live publication
changes or Piper synthesis. They run in the existing CI browser job against the
built application; the real HTTP and Piper checks above cover the service paths.

The 4X-inspired empire outliner at the right edge lists only the account's
server-confirmed colonies. Search filters by name or coordinates. The
search matches all whitespace-separated terms in any order, ignoring case and
accents. During IME composition it retains the last committed query, including
across server refreshes; duplicate final input events do not rerender the panel.
Arrow Down/Up in search focuses the first/last visible colony without activating
it. Native Tab navigation and Enter activation remain unchanged; composition,
modifier shortcuts and empty result sets are not intercepted.
Within results, Up/Down moves between visible, enabled controls of the same
action (select or locate); Home/End jumps to its first/last result. Movement stops
at list boundaries without wrapping and never activates a colony.
The search-clear button or the no-match action "Alle Kolonien anzeigen" restores the
list locally and returns focus to search. A live result count reports visible
colonies. Escape in a nonempty search clears only the query; a second Escape
collapses the panel. Clearing search never changes the active colony or camera.
Clicking a colony name selects the active management colony through the existing session;
"Ansehen" opens its system on the map without changing the management colony.
The active colony is highlighted and exposed with `aria-pressed`. Existing
overview and galaxy events update the panel, including loading/error feedback;
mounting the outliner performs no additional reads, commands or polling.
Rows retain keyboard focus across refreshes; removed rows return focus to search.
Existing rows follow the server's colony order after updates without being
recreated. Search and focus survive reordering, and keyboard traversal uses the
updated visible order; unchanged ordering causes no row moves.
The search header stays visible while scrolling the colony list. Long colony
names wrap within their action, with the active badge on a separate line; the
focused row receives an outline without implying selection or map navigation.
A chevron indicates whether the native disclosure is open. If map loading disables
the focused "Ansehen" action, focus moves to the same colony's selection button
without selecting it; navigation controls reference the loading/error status.
Escape collapses the outliner. It hides while the command drawer is open,
moves to the bottom-right on narrow screens, and is removed on logout.
During IME composition or after a foreground control handles Escape, the outliner
stays open and retains input focus.
Its active-colony management section opens or restores the existing building,
research, population, shipyard, economy and market windows without toggling
them closed. Window visibility stays synchronized with the command picker,
and opening a window focuses its title. These shortcuts use the current
management colony, not the last system inspected on the map; they disappear
when no active colony exists. Unavailable windows show explicit feedback.
Management actions in the outliner and command picker use shared SVG icons
and compact visual tiles with short captions, tooltips and native button
semantics; decorative icons are hidden from assistive technology.
The active colony's stock diagram shows metal, crystal, deuterium, food and
rare earths with distinct icons, colours, exact values and proportional bars.
Bars compare the displayed stocks against their largest value, not storage
capacity or production trends. Missing data is explicitly unavailable rather
than zero; overview updates replace chart values without moving action focus.
The economy window now leads with resource icon cards: exact stocks, measured
storage capacity meters and paired production/consumption bars in units/hour.
The bars share an absolute rate scale; a signed net balance is shown only when
both rates are present. Missing rates are not treated as zero. Over-capacity
stocks retain their exact amount and receive a warning. Clicking a card icon
opens the existing resource details and market handoff. The full measurement
table remains available in a collapsed disclosure; policy forms and commands
are unchanged. All values describe the last confirmed snapshot, not forecasts.
Population/supply uses icon metric cards with measured population capacity,
satisfaction (0–100) and workplace occupancy (0–1) meters. Growth stays a
signed hourly value, with negative growth explicitly highlighted rather than
extrapolated. Population classes show counts and shares of the reported total;
zero totals produce zero-width bars. Unknown metrics have no fabricated meter,
over-capacity counts remain visible, and supply gaps have warning icons plus
their original rates and explicit market actions.
Construction and research use responsive icon cards with level badges,
resource cost chips and explicit running/blocked/request states. The build
queue shows target levels, server statuses and supplied ETAs; no percentage
or countdown is invented when a start time or duration is unavailable.
All start/finish commands and research prerequisite gates remain unchanged.
Fleet missions use icon route cards with labelled endpoints, a directional
outbound/return arrow, ship and cargo chips and the confirmed server arrival
time. On narrow screens the route stacks vertically. Departure time remains
available in a disclosure; no travel percentage or countdown is inferred.
Map shortcuts, recall gates and explicit arrival processing remain unchanged.
When a target has a stored reconnaissance report, the mission form also shows
the scanned hull and shield percentages that the report actually contains;
missing or out-of-range values are omitted rather than inferred.
The shipyard uses the same resource cost chips as construction/research,
with ship icon cards, confirmed inventory counts and separate blueprint
markers. Queue items expose their position, quantity, running/queued state
and supplied server ETA; missing ETAs remain explicitly pending. Costs are
base costs per ship, not a quoted order total. Quantity validation, build
commands and explicit completion remain unchanged; no local progress timer.
Docked individual vessels show current/max hull HP only when `hp_state` contains
a valid pair. Shield bars likewise require saved current and maximum shield
values; blueprint shield stats alone are not treated as remaining shields.
The market shows the selected good with a resource icon, confirmed stock
and unit-price cards, plus paired supply/demand bars on a shared relative
scale. These server values are not storage capacity or a price forecast.
Unknown stock stays unavailable. Trade history uses labelled buy/sell cards
with exact settled credits and expandable time, colony, unit price and tax
details. Trade validation and server-side settlement remain unchanged.
Fleet composition uses responsive ship inventory and cargo icon cards with
labelled numeric inputs. The species/faction transit panel highlights the
last confirmed drive readiness while retaining its server-status wording.
Map target picking, quantity limits, draft retention and launch commands are
unchanged; no generic flight time or local capacity estimate is introduced.
The fleet-domain compatibility panel does not assign default ship health;
its health bar is unavailable unless a valid 0–100 measurement is present.
The system details list uses planet icon cards with orbital positions and
explicit own-colony markers. Map focus, colony approach and management use
labelled icon actions; foreign worlds do not gain ownership-only actions.
The cards use existing canonical system and colony data without new reads.
The selected planet context uses responsive labelled icon tiles for approach,
management and fleet actions, with an explicit own/settled/unsettled status.
Ownership-only tiles remain hidden on foreign worlds, including in the tile
layout; native keyboard activation and selection-clear focus are preserved.
The loaded-system catalogue uses star icon cards with separate names and
coordinates and marks the currently selected system. Search reports the full
local match count alongside the 40-card display limit and an explicit empty
state. Navigation is disabled during reads; filtering performs no new reads.
Production-method cards display server catalogue recipes as input icon chips,
a processing arrow and a labelled output tile. Recipe quantities are not
presented as measured hourly rates or forecasts. Empty input lists are explicit;
building levels, research hints and the existing method commands remain intact.
Empire policy, taxes and subsidies use responsive icon control cards. Each
card separates its confirmed server value from the editable control. Tax
meters show the confirmed percentage on a 0–100 scale, not a local preview;
editing still requires the existing explicit save command.
Selected resource details use an icon heading and separate stock, capacity,
production/hour and consumption/hour cards. Missing measurements explicitly
remain unavailable, independently for each metric. Energy retains its signed
server balance without storage or trading; market handoff and focus are unchanged.
Shared SVG icons distinguish all 23 canonical market goods, including processed
and specialist products, across stock cards, recipes, cost chips and trade
history. Unknown identifiers use a neutral goods icon, never a planet or an
inherited object property. Text labels remain the accessible source of meaning.
Supply-gap cards identify the affected good with its resource icon and highlight
the confirmed hourly shortage with a warning symbol. Stock, production/hour and
consumption/hour use separate labelled measurements; unavailable values are not
replaced with zero. Market handoff still selects only the colony and good.
Research prerequisites use icon rows with separate required/current levels
and measured level meters, not research-time progress. Missing or invalid
levels remain explicitly unavailable without a meter. The server-provided
research permission remains authoritative; meters never unlock an order.
Fleet lists and composition share labelled mission icon badges for all six
launch missions. The composition badge follows the mission selector without
rebuilding the form or clearing inputs. Unknown server missions retain their
text with a neutral fleet icon; badges never infer permission or send orders.
Fleet missions can be filtered locally by labelled mission tiles and flight
direction. Tile counts refer to the full confirmed fleet snapshot; the result
count reflects both filters. Filters survive list updates, including zero-match
states, and reset explicitly. Filtering preserves keyboard focus and sends no
reads or orders; arrival processing still applies to the account, not the filter.
Construction and research catalogues offer independent local name/type search
and order-state filters with exact visible/total counts and an explicit reset.
Filtering preserves the current controls and keyboard focus, performs no reads,
and does not change order gates. A targeted building request clears building
filters so the requested card and its heading focus cannot be hidden.
The market offers a scrollable resource-icon goods picker with confirmed
unit prices and pressed selection states, alongside the existing native select.
Both select the same order draft; tile selection preserves quantity and returns
focus to the tile without reads or trades. Busy/stale snapshots disable the
picker with the rest of the trade form. Prices remain non-binding snapshots.
Economy separates colony resources, empire governance and colony production
into framed sections with explicit scope labels. Related management links are
grouped below an icon header. Secondary society readings and accounting notes
are collapsed; resource inspection, policy forms and server commands are unchanged.
The fleet dashboard shows account-wide mission, outbound and return counts
from the loaded server snapshot, independent of filters. Unknown initial data
has no zero-valued summary. New composition is the primary navigation action;
arrival processing has a separate labelled area and retains all command locks.
Technical processing notes are collapsed, not removed.
Population and supply use separate framed society and supply sections, an icon
header and a subdued server timestamp. Supply cards align their market actions
below measured gaps; unknown readings remain explicit. Technical explanations
are collapsed, while economy navigation remains visible. No new reads or rules.
Building and research workspaces use icon headers and framed order areas with
their explicit completion action. Current research stays visible above catalogue
filters. Project cards separate next-level costs and align actions at the bottom;
technical accounting notes are collapsed. No local time progress is calculated.
The shipyard visually separates production orders from new construction:
the framed queue owns the explicit completion action and loaded order count.
Ship cards group unit costs and align quantity/build controls at the bottom.
Technical cost and completion notes are collapsed without changing commands.
The shipyard catalogue supports local name/type search plus inventory and
blueprint filters. Exact visible/total type counts, empty-state feedback and a
reset leave the production queue visible. Filtering hides cards without
recreating quantity inputs or losing focus and never reads or builds ships.
Filters survive refreshes; a zero inventory is not interpreted as a build ban.
Market goods tiles support local case-insensitive search, treating spaces and
underscores alike. Counts and empty results refer only to visible tiles: the
selected good, quantity, details and native selector remain unchanged. Search
sits outside the trade form so Enter cannot submit an order. Refresh retains
the query; explicit resource handoffs clear it to reveal the requested good.
Fleet composition includes a live draft summary of selected ships and cargo.
Zero selections are omitted, invalid or over-inventory ship quantities are
explicitly marked, and each cargo resource remains separate. Updating inputs
does not recreate the form or send requests. The summary is not a server
confirmation or a capacity/route estimate; launch validation remains unchanged.
The fleet command overlay presents origin and draft destination as a visual
route with icons and coordinates. Keyboard coordinate edits update the route
without replacing inputs. Drive status remains visible, while explanations
and launch notes are collapsed disclosures. No global cooldown does not imply
route clearance; only the server validates launch.
Market history supports independent local goods search and buy/sell filters.
The empire outliner emphasizes the active colony with a distinct badge, tinted
row, icon and coordinates. Colony selection and map-location actions remain
separate; the management header repeats the active coordinates and keeps stock
and management shortcuts attached to that colony.
Planet and colony actions are grouped into view, fleet and colony sections.
System planet cards use explicit position labels and a compact owned-colony
badge; action tiles stay touch-sized, and hidden owner-only actions remain
hidden within the grouped layout.
The command drawer and dock use a consistent icon/label treatment. Window groups
show live open/total counts and visibly distinguish open windows; the drawer
explains its open/minimize/restore behavior without changing window commands.
The market separates its goods catalogue from a visually framed order ticket.
The ticket groups quantity with labelled, distinct buy/sell actions; price and
stock stay above the actions. A short settlement warning remains visible,
while technical price/accounting notes are available in a collapsed disclosure.
Both catalogue and ticket retain the same busy/stale command locks.
Counts explicitly refer to the loaded account-wide sample (last 20 transactions),
not complete historical totals. Filters survive refreshes; reset restores all
loaded entries. Filtering preserves trade inputs, focus and expanded settlement
details and never reads or trades.
Economy resource cards support local name/type search and negative/unknown
hourly-balance filters. A balance is known only when both production and
consumption are measured; missing rates are never interpreted as zero.
Counts cover loaded stock resources only, not the measurement table or policy
and production controls. Filters persist through refreshes without requests.
Fleet inventory supports local name/type search and a selected-only toggle,
with exact type counts, empty-state feedback and reset outside the launch form.
Hidden ships remain in the draft and summary; invalid nonzero or empty inputs
remain visible in selected-only mode for correction. Filters survive refreshes
and never fetch inventory or launch missions. Cargo and launch controls stay
visible; resetting a selected quantity to zero returns focus to search.

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
For each fleet, the map's endpoint detail shows the server's `hull_damage_pct`
as hull damage and its attack penalty. This value is not current hull integrity;
health and shield bars are shown only when the server supplies those measurements.
The fleet API always supplies this value; the client validates its integer
range before rendering. It does not derive shield or armor status, which the
current fleet contract does not provide.

Spatial object badges can be switched between WebGPU rendering (the default)
and interactive HTML buttons under "Karte & Koordinaten" > "Räumliche Badges".
HTML badges select objects on click; double-click opens a system or approaches
a planet. Enter selects, Shift+Enter performs the double-click action, and
Escape returns keyboard focus to the playing field without changing the view.
The mouse wheel also works over HTML badges, zooming toward the labelled
system or planet rather than picking the empty space behind its offset label.
It uses the same zoom limits and planet/colony transitions as the canvas.
The colony building-detail renderer shows health only when the building data
contains a valid 0–100 measurement; otherwise it reports the value as
unavailable instead of assuming full health.
Selected planet badges have a persistent highlighted border and expose
`aria-pressed`; selection updates from either canvas or badge actions.
Selected planets receive label priority, but off-screen or occluded objects
remain hidden. Hiding spatial selection markers does not clear the selection
state reported by the HTML button.
Hovering or focusing a planet badge shows the system's existing hover marker;
leaving or hiding the badge clears it. Repeating the planet action opens a visible colony, using the loaded
planet's habitation state. System badges remain navigable while a previous
system is loaded during a camera transition. Keyboard focus stays on a badge
when its content updates and returns to the galaxy canvas if the badge
disappears or its DOM overlay is hidden. Switching modes does not move focus
away from other UI controls.

Artificial-object badges can render shield, armor and hull meters from a
server-provided `combat_status` object:

```json
{
  "combat_status": {
    "shield": { "current": 75, "maximum": 100 },
    "armor": { "current": 30, "maximum": 50 },
    "hull": { "current": 900, "maximum": 1000 }
  }
}
```

Only valid `current`/`maximum` pairs are rendered; missing or invalid values
are omitted, never presented as healthy defaults. The WebGPU atlas shows
abbreviated, named bars and percentages; HTML badges expose the full metric
names and values to assistive technology. This follows the WCAG principle that
color must not be the only status cue. Existing occlusion, overlap and label
budgets remain in force to keep the 3D view readable.

This is currently a rendering contract, not yet live combat telemetry:
`api/galaxy.php?action=system` supplies facility type/level, but not
`combat_status`; `api/fleet.php?action=list` exposes fleet-level hull damage,
not per-object current shield/armor/hull values. The combat profile currently
models shield and hull, but not a separate armor pool. Until the authoritative
engine/API defines and returns those values, the corresponding meters remain
absent instead of being inferred or fabricated. Completing the data path
requires an explicit server-owned status contract and access/visibility rules.

Design references: [Three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html),
[W3C WCAG 2.2: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html),
and [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/).

Running missions also expose clickable endpoint badges on the shared galaxy
and system map, grouped per loaded star or planet. The compact selection shows
canonical ships, cargo, direction and server arrival time, with map navigation,
recall and explicit arrival processing. Badges follow the existing shared
renderer frame hook and camera projection; off-screen, unloaded and surface-level
endpoints are not fabricated. They indicate origin/target, not a simulated
in-flight position or a common transit path. Badges track camera transitions
instead of disappearing and reappearing around the flight. Target picking hides
these badges so they cannot intercept destination clicks. Reads do not process arrivals,
stale data disables commands, and logout removes markers and frame subscriptions.
If an endpoint disappears while its marker has keyboard focus, focus returns to
the persistent galaxy canvas rather than being lost with the removed marker.
When a selected fleet context refreshes during a command, focus stays on the
same available action or moves to its stable close control if that action locks.
Fleet selection handles Escape only after foreground controls: a nonempty table
search clears first without closing the selection or moving focus. An unhandled
Escape closes the selection and returns focus to the canvas; IME composition
Escape does not dismiss it.

Fleet commands are point-and-click on the galaxy playing field, not a separate
launch window. Click an owned planet and choose "Flotte hier auswählen" to
select its stationed inventory. The compact map overlay provides ships,
mission and optional cargo. "Ziel im Spielfeld wählen" arms target selection:
click a star to enter its system, then click a planet to set the destination.
Picking only selects a target; dispatch still requires explicit confirmation.
Escape cancels target picking without changing the existing order or camera.
Fleet composition and origin/target picking ignore Escape during IME composition
or when the event has already been handled. Regular picking cancellation retains
priority over camera navigation and preserves the existing order draft.
Canvas camera shortcuts likewise ignore composing and already-handled key events,
so ignored picking cancellation cannot move the camera through a second handler.
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
dispatch with an explicit error. Gate health meters appear only when the
server supplies a valid 0–100 health measurement; missing values are not
rendered or counted as healthy. Manual wormhole override is not yet exposed.

The first physics foundation is `src/Fleet/FleetTrajectory.php`: it computes
Newtonian gravity in light-years, solar masses and Julian years, and advances a
testable state with deterministic velocity-Verlet integration and a bounded
step budget. Gravity changes acceleration and therefore course and speed;
gravitational acceleration itself is independent of the ship's mass. For systems
where bodies move, the solver also supports pairwise mutual gravity with
momentum-conserving velocity-Verlet updates. It rejects overlapping bodies
rather than hiding singular forces behind an arbitrary softening constant. This
core also offers encounter-aware step sizing bounded by relative separation,
relative speed and gravitational dynamical time; the deterministic step budget
still rejects excessive integrations. Variable step sizes are an accuracy aid,
not a guarantee of long-term energy conservation. Bodies may provide a physical
collision radius in light-years; the solver checks the closest approach along
each step segment so fast bodies cannot pass through one another undetected.
Collision response (merging, bounce or damage) is deliberately outside this
trajectory core. `systemInvariants()` reports total mass, center of mass,
linear/angular momentum and kinetic, potential and total energy in the model's
documented units, allowing integrator drift to be measured in tests and future
simulation tooling. It is not yet wired into fleet dispatch or the rendered
fleet position.
Existing FTL drive contracts and transit times remain unchanged until a
versioned trajectory snapshot and compatible arrival calculation are integrated.
Powered segments additionally accept thrust in newtons, craft mass in kilograms
and an inertial thrust direction; the solver converts SI acceleration into the
same trajectory units and combines propulsion with gravity. Under equal thrust,
lower mass therefore yields greater acceleration. Ship definitions do not yet
provide authoritative masses or thrust, so this remains an explicit physics
primitive rather than an invented fleet specification. The solver can aggregate
fleet mass and thrust from an explicitly supplied per-ship physics catalog, and
rejects fleets whose nonzero ship types have no physical specification. No
catalog values are currently populated. `ship_physics_specs` is the server-side
catalog schema for mass, thrust and maximum sublight speed; the table is
intentionally not seeded with inferred game values. `FleetPhysicsCatalog`
requires a complete valid record for every ship type before returning a fleet's
specifications. Multi-body integration can also apply a constant inertial thrust
vector per body while continuing to recompute mutual gravity; such an externally
powered system is not expected to conserve its closed-system momentum or energy.
The existing dispatch and arrival behavior remains unchanged until the catalog
is populated and an explicit, arrival-compatible sublight flight contract is
defined.

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
Reads remain on-demand, without polling or client growth simulation. The legacy
`set_pop_policy` mutation is rejected while on-demand economy is enabled because
it writes the retired tick-based population model.
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
The existing window list in the command menu focuses a background window,
restores a minimized one, and minimizes only the already active window. Grouped
windows also reveal the selected tab. These actions reuse the existing content
without rendering, fetching or submitting again. Task buttons expose focus through
`aria-pressed` and the next action in their tooltip. Selecting a window closes the
menu and moves keyboard focus to its title; minimizing it returns focus to
"Kommando". Ctrl/Command selection keeps the menu open for multi-selection.

Window titlebars and action menus share the start screen's clean command
surfaces and accent borders. Edge-docked windows use a flatter, compact
menu-style header with split controls; dock groups retain scrollable tabs.
The visible titlebar action button offers docking and split-layout submenus,
detaching and resetting without rebuilding content or losing drafts.
Dragging and resizing share a captured pointer lifecycle for mouse, touch and
pen on desktop layouts. A small movement threshold prevents clicks from
undocking windows; controls and group tabs never start a window drag.
Escape, pointer cancellation, focus loss, minimizing and closing cancel the
gesture and release its listeners. Cancelled gestures restore prior geometry
and docking; only completed gestures persist their final state. Window geometry
never transitions during dragging or resizing, including reduced-motion mode.
Mobile windows
keep their existing stacked layout, and the pinned console remains pinned.

#### Standard window components

The existing `js/runtime/wm.js` / `wm-widgets.js` framework is the shared window
system (no parallel `wnd.js`). New windows can opt into standard regions via
`register({ layout: ... })`. `onRender(content, frame)` then receives the content
region, not the complete window body. Existing registrations without `layout`
retain their original behavior.

The authenticated management windows now use these components in production:
buildings, research, shipyard, economy, market, population and fleets share the
managed frame, independently scrolling content and a persistent context/status
bar through `js/ui/game-window-view.js`. Colony windows name the selected colony;
fleet management explicitly names its accountwide scope. Loading, error and
not-yet-loaded states use shared notices, with stale confirmed data kept visible
and existing command locks preserved.

Construction, running research and shipyard queues use the shared timeline with
explicit server statuses and server-formatted end times, never local countdowns.
Empty queues use shared empty notices. Ship construction quantities use native
labelled `field` controls, retaining existing form validation and command handlers.
Market goods and decimal trading quantities also use labelled fields with linked
help. An unavailable requested good gets a field-specific error and trading stays
disabled; generic command errors remain in the shared notice, not incorrectly
assigned to the quantity. Decimal input and existing buy/sell payloads are unchanged.
Accountwide market history now uses the shared table for the last 20 loaded
transactions: token search across goods, directions, quantities, credits, colony
IDs and server timestamps; a buy/sell filter; sortable columns using raw numeric
values rather than formatted credit strings. Filtering and sorting never request
additional history or trade. Search, filters, sorting and transaction-ID-keyed
settlement disclosures survive refresh; local changes preserve the trade form
and its decimal draft. The default order remains the server's transaction order.
The economy's optional measurements view uses `dataTable` with a visible caption,
column/row headings, numeric alignment, local search, stock filters and sortable
columns in a keyboard-scrollable region. Search/filter/sort state survives updates
and resource selection independently of the resource-card filters. Resource
detail buttons and explicit unknown/zero values remain intact. Its expanded state
survives data updates and resource selection via keyed `data-game-disclosure`
elements in the shared view lifecycle.
Population shortage measurements and fleet mission totals use shared `properties`
lists, preserving confirmed zeroes and explicit unknown measurements. Supply and
fleet empty states use notices; fleet direction filtering uses a labelled native
field with linked help and remains purely local. Population/fleet help and each
fleet's time details retain their expanded state through updates and local filters.
Population classes additionally offer an optional searchable/sortable measurements
table with populated/empty class filters. Counts and percentage sorting use raw
numbers. Shares always refer to the full confirmed colony population, not the
filtered subset; zero population retains finite zero shares. The visual
distribution is unchanged, and table/disclosure state survives data updates.
Fleet management also offers an optional accountwide mission table with local
search, independent mission/direction filters and sortable labels, routes, ship
totals and server arrival times. Route sorting compares numeric galaxy/system/
position coordinates; ship totals use raw counts. Missing filtered mission types
remain selectable after refresh so a zero-result filter is not silently reset.
Cards retain all existing navigation and command controls; the table issues no
orders, reads or completion estimates.
Shared view cleanup destroys nested controllers on rerender/teardown, recreates
frames after close/reopen, and restores keyed input/action focus and text selection
after updates. Busy disabled fields temporarily focus the content region; focus
returns after unlocking only if the player has not moved elsewhere. Existing
domain draft/reset rules remain authoritative.
Tables marked with a stable `data-game-table` key retain their horizontal scroll
position across view updates. Hidden/collapsed tables do not overwrite saved
positions with zero; expansion restores them after layout is available. Colony
changes reset positions, while accountwide fleet tables keep them. View teardown
clears these transient positions; nothing is persisted to player storage.
Keyed table scroll regions also retain keyboard focus across rerenders. Control
focus keys include the table key, preventing identical search/header actions in
different tables from receiving each other's focus. Collapsed tables are never
focused, and moving focus outside the view cancels pending restoration.
Table-owned actions expose stable `data-table-control` identities based on their
role and column ID. The view adapter uses these within the table scope rather
than dynamic chip text, translated labels or generated field IDs, so direction,
filter-value and caption changes do not break focus restoration.
Keyed disclosure summaries retain focus across updates, including when closed or
renamed. Only a closed disclosure's own summary remains focusable: nested content
inside a closed ancestor and filtered-out rows never receive restored focus.

Other layouts are used only where their interaction fits: no artificial
pagination without a defined result set, invented completion percentage or
master/detail split is forced onto these views. The specialized galaxy and
point-and-click fleet-composition overlays retain their existing lifecycles.

```js
WM.register('management', {
  title: 'Verwaltung', w: 760, h: 540,
  layout: {
    menuBar: { items: [{ label: 'Ansicht', items: [
      { label: 'Aktualisieren', onClick: refreshView },
    ] }] },
    toolbar: { groups: [{ items: [
      { id: 'refresh', label: 'Aktualisieren', onClick: refreshView },
    ] }] },
    sidebar: { items: [
      { id: 'colony', label: 'Kolonie', badge: 1 },
    ] },
    badges: [{ text: 'Serverdaten', tone: 'info' }],
    statusBar: { segments: [{ id: 'state', text: 'Bereit' }] },
  },
  onRender(content, frame) {
    // Populate once; subsequent reads can update the existing controls.
    if (!content.firstChild) WM.widgets.cards(content, {
      items: [{ title: 'Kolonie', body: 'Bestätigter Serverstand' }],
    });
    frame.statusBar.set('state', 'Bereit');
  },
});
```

`WM.layout(id)` returns the current frame; `WM.layout(id, options)` explicitly
replaces it. A frame exposes `content`, optional `menuBar`, `toolbar`, `sidebar`,
`statusBar`, badge controllers and `destroy()`. Standalone composition uses
`WM.widgets.frame(container, options)` with an optional `render(content)` callback.
Managed frames release their controllers when removed; adopted/preserved windows
retain their frame and drafts across close/reopen.

The shared toolkit provides `menu` (nested, portalled menus), `toolbar`,
`splitButton`, `statusBar`, `sidebar`, `badge`, `cards`, `card`, `accordion`,
`tabs`, `tree`, `list`, `split` and `masterDetail`, alongside existing help and
bottom-sheet widgets. Badges accept `neutral`, `info`, `success`, `warning` or
`danger` tones; `set(text, tone)` preserves numeric zero and uses text content.
Card grids accept `minCardWidth` and `setItems()`. Tabs render each panel lazily
once and retain form nodes on selection; arrow/Home/End navigation, unique
tab/panel IDs and roving focus are provided centrally. Accordion panels are
truly hidden when collapsed, with labelled regions and heading navigation.
Sidebars skip disabled items during keyboard navigation. Window-width container
queries stack the sidebar below 480px; content scrolls independently of toolbars
and status bars. Rendering errors propagate instead of being silently discarded.
Status bars accept `segments` (`items` remains supported) and `set()` /
`setItemText()`; live announcements are opt-in via `live: 'polite'`.

Additional management layouts are available through the same `WM.widgets` API:

| Factory | Options and controller updates |
| --- | --- |
| `breadcrumbs` | `items: [{id, label, disabled?}]`, `onSelect(item)`, `ariaLabel`; `setItems(items)`. The last entry is the current page, not an action. Also available as `layout.breadcrumbs` and `frame.breadcrumbs`. |
| `progress` | Required visible `label`, `value` (0..`max`, default `max: 100`), optional display `text`; `set({value, max, label, text})`. `value: null` or an omitted initial value means indeterminate, never zero. Invalid/out-of-range measurements throw instead of being clamped. |
| `notice` | Required `title`, `state` (`empty`, `loading`, `error`, `info`, `success`, `warning`), `message`, `actions: [{label, onClick, disabled?}]`; `set(partialOptions)`. Live copy announcements are opt-in via `live: 'polite'`; actions remain outside the live region. Text updates retain action nodes/focus. |
| `properties` | `items: [{id, label, value}]`, optional `emptyText` (default `Not available`); `setValue(id, value)` updates only that value, `setItems(items)` explicitly replaces the list. Values accept text, an element or a renderer callback. Null/undefined are unavailable; zero remains zero. |
| `stack` | `direction: 'vertical'` (default) or `'horizontal'`, `gap` in px (default 12), `wrap` (default true for horizontal stacks), `items` of text/elements/renderers; `append(content)` adds a slot without rebuilding prior controls and returns that slot. |

All return `el` and `destroy()`. Breadcrumb/property IDs must be unique.
New widgets treat strings as text, not HTML. Property label/value rows stack in
narrow containers; horizontal stacks wrap and vertical stacks preserve content
order. Use `cards` for equal-width card grids and `split` / `masterDetail` for
resizable or selectable panes rather than recreating these patterns.

```js
const column = WM.widgets.stack(content);
WM.widgets.properties(column.append(), {
  emptyText: 'Nicht bekannt',
  items: [{ id: 'stock', label: 'Lagerbestand', value: serverStock }],
});
const load = WM.widgets.progress(column.append(), {
  label: 'Serverdaten laden', value: null, text: 'Warte auf Antwort',
});
// Supply measured progress only when the server actually provides it.
load.set({ value: 3, max: 10, text: '3 / 10' });
```

Progress widgets schedule no timers or reads and simulate no game progression.
Notices expose explicit states without inventing success or retry behavior.
Callers own nested widget controllers placed in stack/property slots and must
destroy them when removing their view; stack destruction only removes its DOM.

`WM.widgets.dataTable(container, options)` adds a native table with a required
visible `caption`, `columns: [{id, label, numeric?, rowHeader?, value?, render?, sortable?, sortValue?, compare?, filter?}]`
and `items`. Cells default to `item[column.id]`; `value(item)` supplies a display
value, while `render(cell, item)` can place existing controls or actions.
Strings are text; null/undefined use `emptyValue` (default `Not available`),
and zero remains zero. `emptyText` customizes the empty row.
`rowHeader: true` renders a scoped native row heading instead of a data cell.
In table regions at least 640 px wide, a leading row heading and its column
header stay pinned during horizontal scrolling. Narrower regions leave them
unpinned to keep other columns accessible. Alternating visible rows and
hover/keyboard-focus highlighting help track values after filtering or sorting.

Sorting is opt-in per column through `sortable: true` or `compare(a, b)`, which
compares the original items and must return a finite number. Default sorting uses
natural localized text order, or raw finite numbers for `numeric` columns; missing
numbers remain last in either direction. Numeric comparison is overflow-safe
across the entire finite JavaScript number range. `sortValue(item)` supplies raw values
when `value(item)` formats numbers or the cell has a custom renderer.
Native header buttons toggle ascending/
descending sorting, then source order on the third click, with `aria-sort`.
Header tooltips and associated assistive descriptions state the next action;
`labels.nextSort(columnLabel, directionLabel)` localizes the sort action.
Switching columns starts ascending. Search and filters remain unchanged.
`setSort(id, 'ascending' | 'descending')`
reorders existing rows stably without recreating drafts or mutating input data.
`setSort(null)` restores source order.

`searchable: true` adds instant local token search (case/accent insensitive).
Search matches all tokens across cached rendered cell text, not live input drafts.
Columns may provide `searchValue(item)` or opt out with `searchable: false`.
Search and reset are integrated in the table's compact named toolbar, alongside
the result count; each column filter sits directly below its heading in `thead`.
Sort buttons remain in the same column heading. Search uses a placeholder and an
assistive label; filters retain associated labels without extra form-like label
rows. Native Tab navigation and input/select keyboard behavior remain intact.
Search and its clear button form one responsive group so they do not separate
on narrow windows. Result counts use a compact badge; removable filter/sort chips
have rounded outlines. Unsorted headings show a bidirectional arrow, while active
sorting has a highlighted border as well as a directional arrow.
Active column filters are highlighted in the header and mirrored as removable
toolbar chips. Removing one chip retains search, sorting and other filters.
The search-clear button clears only the query and returns focus to search.
Chip removal returns focus to search (or its column filter in filter-only tables).
Programmatic changes use the same fallback when a focused toolbar action becomes
hidden or disabled, before notifying `onStateChange`. External focus and actions
that remain available are left untouched.
Search-clear and reset clicks also return focus before `onStateChange`, so a
callback may deliberately move focus or replace the view without being overridden.
Localize these actions through `labels.clearSearch` and
`labels.removeFilter(columnLabel, optionLabel)`.
The toolbar also displays the active sort column/direction as a removable chip,
including on sort-only tables. Removing it restores server/source order without
clearing search or filters, preserves existing row controls and returns focus to
search (or the former sort header). Localize with `labels.ascending`,
`labels.descending`, `labels.sort(columnLabel, directionLabel)` and `labels.clearSort`.
Inactive filter-chip rows are hidden rather than reserving toolbar space.
On toolbar buttons, Left/Right moves between available actions (and search),
Home/End moves to the first/last control; horizontal navigation respects RTL.
Disabled and hidden actions are skipped. Input cursor movement, native column
selects, Tab navigation, modifier shortcuts and IME composition remain native.
Escape in a nonempty search clears only the query without leaving the field;
an empty-search Escape is left to the surrounding window.
`column.filter: {label?, options: [{value, label?}], value?: (item) => key}` adds a
labelled exact-match select; nonempty option values must be unique. Without its
own `value`, filtering uses the column value. Search and all filters combine with
AND. `setSearch(text)`, `setFilter(columnId, value)` (empty string clears) and
`reset()` are available programmatically. Visible counts and a distinct no-match
row accompany the controls. `labels` localizes `search`, `reset`, `all`,
`noMatches`, `toolbar` and `results(visible, total)`.
When loaded rows have no matches, the empty row offers `labels.reset` directly.
It restores the source order and clears search/filters without rebuilding row
controls, returning focus to search (or a column filter/table region). A genuinely
empty dataset shows only its empty message, not a misleading recovery action.
Empty messages and recovery actions stay within the visible table viewport,
including on wide tables scrolled horizontally; long messages wrap to that width.

```js
const table = WM.widgets.dataTable(container, {
  caption: 'Bestände', searchable: true,
  columns: [
    { id: 'name', label: 'Gut', sortable: true },
    { id: 'amount', label: 'Bestand', numeric: true, sortable: true,
      filter: {
        label: 'Bestandsfilter',
        options: [{ value: 'empty', label: 'Leer' }, { value: 'available', label: 'Verfügbar' }],
        value: item => item.amount === 0 ? 'empty' : 'available',
      } },
  ],
  items: [{ name: 'Metall', amount: 0 }, { name: 'Kristall', amount: 120 }],
});
```

`getState()` returns a copy of `{query, filters, sort}`; `state` restores it during
creation and `onStateChange(state)` lets views retain it across rerenders.
Identical search/filter/sort values and resetting an already-default state do not
notify callers, refilter or reorder rows. Duplicate final IME input events are
therefore processed once. Native control values still synchronize with setters;
invalid filter/sort arguments still throw even when the state would not change.
`setItems(items)` explicitly replaces all rows and retains search, filters and sort;
focus inside a replaced row returns to the keyboard-scrollable table region.
If rendering, search/filter value extraction or sorting fails, the error is thrown
without replacing existing rows, changing state or notifying `onStateChange`;
existing drafts, focus and selection remain intact.
Local search/filter updates reuse cached values and hide existing rows, while
sort reorders existing nodes. Cell controls, drafts and focus on visible rows
survive; hiding the focused row moves focus to the table region.
No data loading, pagination or gameplay selection is implied. Consumers own
controllers created inside cells. Wide tables scroll inside their own region.

`WM.widgets.field(container, {label, control, help?, error?})` wraps a caller-owned
native input/select/textarea. The visible label targets the control, existing
`aria-describedby` references are retained, and `setError(message)` adds an
associated text error plus `aria-invalid` without replacing or resetting input.
An empty error clears the widget error. Original IDs/accessibility attributes
are restored on `destroy()`; native `required`, `disabled`, values and validation
rules remain caller-owned. Hidden inputs are not supported.

`WM.widgets.formLayout(container, {legend, fields: [{id, label, control, help?,
error?}]})` composes fields in a named native fieldset. Fields use two columns
on wide containers and one below 480px. IDs and control elements must be unique.
`getField(id)` returns the individual field controller; `setErrors({id: message})`
sets a complete error map, clearing omitted fields and rejecting unknown IDs
before applying changes. It creates no nested form, submit handler, network
request or inferred validation rule. For accessible submission feedback, callers
can focus the first invalid control and/or update a shared `notice` explicitly.

```js
const quantity = document.createElement('input');
quantity.type = 'number';
quantity.required = true;
quantity.min = '1';
const fields = WM.widgets.formLayout(content, {
  legend: 'Auftrag',
  fields: [{ id: 'quantity', label: 'Menge', control: quantity, help: 'Ganze Einheiten' }],
});
// Apply errors returned by the existing authoritative command handler.
fields.setErrors({ quantity: 'Nicht ausreichend verfügbar' });
```

`WM.widgets.pagination(container, {total, pageSize, page, busy?, onChange, labels?})`
provides controlled page navigation. Page numbers are one-based; an empty
collection uses `total: 0, page: 0`. Defaults are total 0 and page size 20.
`onChange(requestedPage)` requests a change but does **not** change the displayed
page. Only `set({page, total, pageSize, busy})` confirms new state. Callers perform
their existing reads, handle errors, and set `busy: true` to block repeated input
while pending. Invalid/out-of-range combinations throw rather than silently
clamping. Update `total` and `page` together when the result set shrinks.
At most seven buttons are created regardless of collection size; distant pages
use decorative ellipses. Disabled/removed focused buttons fall back to the current
page, or to the navigation region if all controls are disabled.

Localization overrides use `labels: {navigation, previous, next, empty,
page(number), summary(page, pageCount, total)}`. Native buttons support keyboard
activation, and `aria-current="page"` marks the confirmed page. The widget neither
slices table rows nor schedules reads.

`WM.widgets.timeline(container, {ariaLabel, items})` presents an ordered sequence.
Each item requires unique `id`, visible `title`, explicit `state` (`queued`,
`active`, `complete`, `blocked`) and localized `stateLabel`. Optional `meta`
is caller-formatted text (including server timestamps); `content` accepts text,
an element or a renderer. Status is expressed as text and color, with active
steps additionally marked `aria-current="step"`. No durations, ordering or
completion states are inferred.

`setItems(items)` retains rows by ID and retains their content when the `content`
reference is unchanged, so status changes/reordering preserve embedded drafts.
Changing/removing content is an explicit replacement; focus falls back to the
timeline if its focused control is removed. Renderer errors propagate before
existing rows are changed. Callers own nested widget controllers, destroy those
they remove, and use `notice` for loading/error/empty states around the timeline.
Both factories expose `el` and `destroy()` and create no timers.

Split layouts now share one primary-pointer lifecycle for mouse, touch and pen.
Listeners exist only during a gesture and are removed on release/destruction;
Escape, pointer cancellation, lost capture and window blur restore the starting
ratio. `ariaLabel` names the focusable separator, whose value/min/max reflect
the current pane percentage. Horizontal splits use Left/Right, vertical splits
Up/Down; Home/End reach the allowed limits. Pointer, keyboard and `setRatio()`
all honor `minA`/`minB` after subtracting the divider size. If both minima cannot
fit, space is shared proportionally instead of overflowing. Ratios outside 0..1,
invalid directions and negative/nonfinite minima throw. Container resize updates
the constraints; no content is rebuilt. `onResize(ratio)` reports interactive
changes, including cancellation rollback, but not programmatic `setRatio()`.

Master/detail layouts expose optional `masterLabel`/`detailLabel` region names
and `refresh()` for explicit size synchronization where ResizeObserver is
unavailable. Below `breakpoint` the selected pane fills the layout and the other
is truly hidden; `showMaster()` / `showDetail()` retain existing content. If focus
would be hidden, it moves to the visible pane rather than remaining in invisible
controls. Above the breakpoint both panes remain visible. Rendering errors
propagate and remove partial layouts rather than leaving an empty success state.

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

Advanced population policy commands and advanced renderer-selection integration
still need migration.
While fleet dispatch or its confirmation refresh is pending, map target/origin
handoffs and repeated opening cannot replace the order or start inventory reads.
The overlay explains the temporary lock; handoffs work again after completion.
Explicit colony switching elsewhere retains the captured dispatch origin.
Opening fleet composition or completing/cancelling point-and-click target
selection focuses its stable overlay region, including across inventory renders.
Escape then closes composition and returns focus to the canvas; the first Escape
during target picking only cancels picking and preserves the composition draft.
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
- The app is served at `http://localhost:8081`.
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
