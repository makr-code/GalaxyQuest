# GalaxyQuest — Architecture

> A technical reference for contributors and maintainers.  
> For the high-level "what", see [README.md](README.md).  
> For the "what's next", see [FUTURE_ENHANCEMENTS.md](FUTURE_ENHANCEMENTS.md).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Directory & Module Map](#3-directory--module-map)
4. [Backend Architecture](#4-backend-architecture)
   - 4.1 [Entry Points & Routing](#41-entry-points--routing)
   - 4.2 [Authentication & Session](#42-authentication--session)
   - 4.3 [Database Layer](#43-database-layer)
   - 4.4 [Game Engine (`game_engine.php`)](#44-game-engine-game_enginephp)
   - 4.5 [Tick-free Resource Model](#45-tick-free-resource-model)
   - 4.6 [Galaxy Generator (`galaxy_gen.php`)](#46-galaxy-generator-galaxy_genphp)
   - 4.7 [Fleet & Mission System](#47-fleet--mission-system)
   - 4.8 [NPC Faction AI (`npc_ai.php`)](#48-npc-faction-ai-npc_aiphp)
   - 4.9 [Leader AI (`leaders.php`)](#49-leader-ai-leadersphp)
5. [Frontend Architecture](#5-frontend-architecture)
   - 5.1 [Window Manager (`wm.js`)](#51-window-manager-wmjs)
   - 5.2 [API Client (`api.js`)](#52-api-client-apijs)
   - 5.3 [Game Controller (`game.js`)](#53-game-controller-gamejs)
6. [Database Schema](#6-database-schema)
   - 6.1 [Entity Relationships](#61-entity-relationships)
   - 6.2 [Table Reference](#62-table-reference)
   - 6.3 [Conventions](#63-conventions)
7. [Security Model](#7-security-model)
8. [Configuration Reference](#8-configuration-reference)
9. [Extension Points](#9-extension-points)

---

## 1. System Overview

```
Browser
  │  HTTP (JSON REST over PHP sessions)
  ▼
┌────────────────────────────────────────┐
│  Apache / Nginx / PHP built-in server  │
│  (document root = project root)        │
└────────────────┬───────────────────────┘
                 │
        ┌────────▼────────┐
        │  index.html     │  unified auth + game shell
        └────────┬────────┘
                 │ fetch() JSON calls
        ┌────────▼────────────────────────────────────┐
        │  api/*.php  (one file per domain)            │
        │                                              │
        │  helpers.php ──► session, CSRF, JSON utils   │
        │  config/db.php ─► PDO singleton              │
        │  game_engine.php ─► formulas & constants     │
        └────────────────────────────┬────────────────┘
                                     │ PDO
                             ┌───────▼──────┐
                             │  MySQL 8.0+  │
                             │  (19 tables) │
                             └──────────────┘
```

There is **no application framework**, no ORM, no message queue, and no background process. Everything is pull-based and computed on demand.

---

## 2. Request Lifecycle

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

## 3. Directory & Module Map

```
/
├── index.html              Unified shell (auth + game sections)
│
├── config/
│   ├── config.php          Global constants (DB creds, game parameters)
│   └── db.php              PDO singleton factory
│
├── css/
│   └── style.css           ~835 lines; CSS custom properties for theming;
│                           all UI components including WM windows, welfare bars,
│                           faction cards, battle log, building categories
│
├── js/
│   ├── starfield.js        Canvas animated background (purely decorative)
│   ├── auth.js             Login/register form handlers → api/auth.php
│   ├── wm.js               Floating window manager (~298 lines, no deps)
│   ├── api.js              Thin fetch wrapper; all API calls in one place (~98 lines)
│   └── game.js             All game window renderers (~1 300 lines)
│
├── api/
│   ├── helpers.php         Foundation: session, auth guard, CSRF, JSON utils
│   ├── game_engine.php     Pure functions + constants (no side effects except update_colony_resources)
│   ├── planet_helper.php   ensure_planet(): lazy planet DB insertion with deposits
│   ├── galaxy_gen.php      Deterministic star system generator (purely functional)
│   │
│   ├── auth.php            register / login / logout / me / csrf
│   ├── game.php            overview / resources / rename_colony / set_colony_type /
│   │                       leaderboard / pvp_toggle
│   ├── buildings.php       list / upgrade / finish
│   ├── research.php        list / research / finish
│   ├── shipyard.php        list / build
│   ├── fleet.php           send / list / recall  +  mission resolvers
│   ├── galaxy.php          system view + star_system cache + ensure_planet
│   ├── factions.php        list / trade_offers / accept_trade /
│   │                       quests / start_quest / check_quests / claim_quest
│   ├── leaders.php         list / hire / assign / autonomy / dismiss / ai_tick
│   ├── npc_ai.php          npc_ai_tick() — trade gen, pirate raids, standing decay
│   ├── achievements.php    list / claim  +  check_and_update_achievements()
│   └── messages.php        list / send / read / delete
│
└── sql/
    ├── schema.sql          Full schema for fresh install (19 tables + seed data)
    └── migrate_v2.sql      ALTER TABLE / CREATE TABLE IF NOT EXISTS for upgrades
```

---

## 4. Backend Architecture

### 4.1 Entry Points & Routing

Each `api/*.php` file is its own entry point. Routing within a file is done with a `switch ($action)` block where `$action = $_GET['action'] ?? ''`. This means:

- No central router — adding a new endpoint means adding a `case` to the right file.
- URLs are stable and human-readable: `api/fleet.php?action=send`.
- PHP's `require_once` used to share code between entry points; no autoloader needed at this scale.

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
- **CSRF** tokens are stored in `$_SESSION['csrf_token']` and validated on every state-mutating request via `X-CSRF-Token` header.
- **Passwords** use `password_hash(…, PASSWORD_BCRYPT)` / `password_verify`.
- **Newbie protection** is a `protection_until DATETIME` column on `users`; attack missions check it server-side.

### 4.3 Database Layer

```php
// config/db.php
function get_db(): PDO {
    static $pdo = null;          // one connection per PHP process (FPM worker)
    if ($pdo === null) { … }
    return $pdo;
}
```

- **All** queries use PDO prepared statements — no string interpolation of user input.
- `PDO::FETCH_ASSOC` everywhere; no PDOStatement magic objects leaked to callers.
- Dynamic column names (resource types in `factions.php`) use explicit allowlists in the source.
- No ORM; SQL is written directly for full clarity and debuggability.

### 4.4 Game Engine (`game_engine.php`)

`game_engine.php` is a **pure-function library** — it defines formulas and constants and has no side effects, except for `update_colony_resources()` which is the single allowed DB-writing function in this file.

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

All cost formulas follow:

```
cost(level) = base_cost × factor^(level − 1)
```

where `base_cost` and `factor` are keyed in `BUILDING_BASE_COST` / `BUILDING_COST_FACTOR`.

### 4.5 Tick-free Resource Model

There is **no cron job** and **no scheduled task**. Resource accumulation is computed lazily on every read:

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

This function is called at the start of every API action that touches a colony:
- `api/buildings.php` `list` / `upgrade`
- `api/research.php` `list` / `research`
- `api/shipyard.php` `list` / `build`
- `api/game.php` `overview` / `resources` (via `update_all_colonies`)
- `api/fleet.php` on fleet arrival

**Implication**: a colony that has not been visited for days will "catch up" instantly on next access. Storage caps prevent infinite accumulation.

### 4.6 Galaxy Generator (`galaxy_gen.php`)

The generator is **fully deterministic** and **stateless** — the same `(galaxyIdx, systemIdx)` always produces the same output.

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

Star system rows are cached in `star_systems` on first access. Planet rows are created **lazily** via `ensure_planet()` in `planet_helper.php` — only when a fleet actually visits the coordinates.

**Seeded RNG** (`gen_rand(int ...$seeds)`): Uses `sin(sum_of_seeds) × large_prime` to get a float in [0,1]. Not cryptographic, but sufficient for deterministic game generation with no shared state.

### 4.7 Fleet & Mission System

Fleet lifecycle:

```
send (api/fleet.php)
  │  validate mission, ships, coords, PvP flags, origin colony ownership
  │  compute 3D distance and travel time
  │  INSERT fleets row (origin/target x,y,z, ships_json, cargo_json, speed_ly_h)
  │
  ▼
in-transit (stored in DB, resolved lazily)
  │
  ▼
process_fleet_arrivals() — called on every /api/fleet.php?action=list
  │  SELECT fleets WHERE arrival_time <= NOW() AND returning = 0
  │  handle_fleet_arrival() dispatches to mission resolver:
  │
  ├─ transport   → deliver_resources()    – move cargo to target colony
  ├─ attack      → resolve_battle()       – tech/skill combat, loot, casualties
  ├─ colonize    → colonize_planet()      – ensure_planet(), INSERT colony + buildings
  ├─ spy         → create_spy_report()    – full welfare/ship/leader report
  └─ harvest     → harvest_resources()   – mine deposits up to cargo cap
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

### 4.8 NPC Faction AI (`npc_ai.php`)

Called once per overview load, rate-limited to once per 5 minutes per user via `users.last_npc_tick`.

```
npc_ai_tick($db, $userId)
  │
  ├─ foreach faction:
  │   ├─ trade_willingness ≥ 30  →  generate_trade_offer() if < 2 active offers
  │   └─ faction_type = 'pirate' AND aggression ≥ 70 AND standing < −20
  │       → maybe_pirate_raid()   steal ≤5% metal/crystal, send message, −3 standing
  │
  └─ Diplomacy decay: standing nudges ±1 toward faction.base_diplomacy
     (only if |standing − base| > 5)
```

Trade offers are generated with faction-appropriate resource pairs (e.g., Guild prefers crystal/deuterium trades, Pirates prefer metal). They expire after 24 hours.

### 4.9 Leader AI (`leaders.php`)

```
run_ai_tick($db, $userId)  — triggered by POST /api/leaders.php?action=ai_tick
  │
  ├─ foreach leader WHERE autonomy ≥ 2:
  │   ├─ role = 'colony_manager'   → ai_colony_manager_tick()
  │   │     SELECT buildings ORDER BY level ASC; find cheapest affordable upgrade
  │   │     if colony.metal ≥ cost.metal AND colony.crystal ≥ cost.crystal …
  │   │         POST upgrade action; award leader 10 XP
  │   │
  │   └─ role = 'science_director' → ai_science_director_tick()
  │         check no active research; find cheapest affordable tech
  │         start research; award leader 10 XP
  │
  └─ leader_award_xp(): XP → level up at 100 XP × level threshold
```

Fleet commanders do not have a periodic AI tick currently — they apply their skill passively (speed bonus in `fleet_speed_ly_h()`, attack bonus in `resolve_battle()`).

---

## 5. Frontend Architecture

### 5.1 Window Manager (`wm.js`)

~298 lines, no external dependencies.

```javascript
WM.register(id, { title, w, h, onRender })
// Registers a window blueprint — does not create DOM yet.

WM.open(id)
// Creates the window DOM, appends to #desktop, calls onRender().
// If already open, focuses it (brings to front).

WM.refresh(id)
// Re-calls onRender() for an already-open window.

WM.body(id)
// Returns the .window-body element for a window by id.
```

Each window is a `<div class="wm-window">` with:
- Drag handle (`.window-titlebar`) — `mousedown` → `mousemove` on `document`
- Resize handle (`.window-resize`) — bottom-right corner
- Minimize button → collapses to taskbar entry in `#taskbar`
- Close button → removes from DOM

Window position/size persisted in `localStorage` as `wm_pos_<id>`.

Z-index management: clicking any window calls `bringToFront(el)` which sets its z-index to `++zCounter` (starts at 100).

### 5.2 API Client (`api.js`)

```javascript
const API = (() => {
  const get  = (url)       => fetch(url, { credentials:'include' }).then(r => r.json());
  const post = (url, body) => fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  }).then(r => r.json());

  return {
    overview:    () => get('api/game.php?action=overview'),
    sendFleet:   (p) => post('api/fleet.php?action=send', p),
    // … ~40 methods total
  };
})();
```

The CSRF token is fetched once on page load via `GET /api/auth.php?action=csrf` and stored in the closure. All POST calls include it automatically.

### 5.3 Game Controller (`game.js`)

Structured as a single IIFE with ~1 300 lines. Top-level state:

```javascript
let colonies     = [];          // array of colony objects from overview
let currentColony = null;       // selected colony (for Buildings, Research, etc.)
window._GQ_meta    = {};        // user meta (dark matter, rank, protection)
window._GQ_fleets  = [];        // fleet list from last overview
window._GQ_battles = [];        // recent battle reports from last overview
```

**Render pattern** — every window has an `async renderXxx()` function:

```javascript
async function renderBuildings() {
  const root = WM.body('buildings');
  if (!root) return;
  if (!currentColony) { root.innerHTML = '…'; return; }

  const data = await API.buildings(currentColony.id);
  root.innerHTML = buildHtml(data);

  root.querySelectorAll('.upgrade-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const r = await API.upgrade(currentColony.id, btn.dataset.type);
      if (r.success) { showToast(…); renderBuildings(); }
    })
  );
}
```

Pattern: fetch → render HTML string → attach event listeners → on success re-render.

**`loadOverview()`** is the heartbeat — it runs on page load, after every action that changes colony state, and on a 60-second polling interval.

---

## 6. Database Schema

### 6.1 Entity Relationships

```
users ─┬─────────────────── colonies ──── buildings
       │                        │
       │                        └────────── ships
       │                        │
       │                        └────────── fleets (origin)
       │                    planets
       │                        │
       │                   star_systems
       │
       ├─── research
       ├─── fleets (owner)
       ├─── leaders ─────────── colonies (assigned_to)
       │                └────── fleets (fleet_id)
       │
       ├─── messages
       ├─── battle_reports (attacker / defender)
       ├─── spy_reports
       ├─── diplomacy ─────── npc_factions ── trade_offers
       │                              └────── faction_quests
       ├─── user_faction_quests
       └─── user_achievements ─── achievements
```

### 6.2 Table Reference

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `username`, `password_hash`, `dark_matter`, `rank_points`, `pvp_mode`, `protection_until`, `is_npc`, `last_npc_tick` | `is_npc=1` reserved for future NPC player accounts |
| `star_systems` | `galaxy_index`, `system_index`, `x_ly`, `y_ly`, `z_ly`, spectral params | Cached from generator; `UNIQUE(galaxy_index, system_index)` |
| `planets` | `galaxy`, `system`, `position`, `planet_class`, richness ×4, deposits ×4, orbital params | `deposit_* = −1` means unlimited; `UNIQUE(galaxy,system,position)` |
| `colonies` | `planet_id`, `user_id`, `metal`, `crystal`, `deuterium`, `rare_earth`, `food`, `energy`, `population`, `max_population`, `happiness`, `public_services`, `last_update` | One per planet max |
| `buildings` | `colony_id`, `type`, `level`, `upgrade_end` | `UNIQUE(colony_id, type)` |
| `research` | `user_id`, `type`, `level`, `research_end` | `UNIQUE(user_id, type)` |
| `ships` | `colony_id`, `type`, `count` | `UNIQUE(colony_id, type)` |
| `fleets` | `user_id`, `origin_colony_id`, `origin_x/y/z_ly`, `target_x/y/z_ly`, `speed_ly_h`, `distance_ly`, `mission`, `ships_json`, `cargo_*`, `departure_time`, `arrival_time`, `returning` | `ships_json` = `{"light_fighter":10}` |
| `leaders` | `user_id`, `colony_id`, `fleet_id`, `role`, `level`, `skill_*`, `autonomy`, `xp`, `last_action` | `role` ∈ colony_manager / fleet_commander / science_director |
| `npc_factions` | `code`, `faction_type`, `aggression`, `trade_willingness`, `base_diplomacy` | 5 rows seeded at install |
| `diplomacy` | `user_id`, `faction_id`, `standing` | −100..+100 |
| `trade_offers` | `faction_id`, offer/request resource+amount, `valid_until`, `claims_count` | AI-generated |
| `faction_quests` | `faction_id`, `quest_type`, `requirements_json`, rewards | 8 seeded |
| `user_faction_quests` | `user_id`, `faction_quest_id`, `status`, `progress_json` | status ∈ active/completed/failed/claimed |
| `battle_reports` | `attacker_id`, `defender_id`, `planet_id`, `report_json` | Indexed on `(attacker_id, created_at)` |
| `spy_reports` | `owner_id`, `target_planet_id`, `report_json` | report includes welfare, ships, leaders |

### 6.3 Conventions

- **Primary keys**: `INT AUTO_INCREMENT`, always named `id`.
- **Foreign keys**: `ON DELETE CASCADE` everywhere — deleting a user removes all their data.
- **Timestamps**: `DATETIME` (not `TIMESTAMP`) to avoid timezone surprises; stored as UTC.
- **Resource amounts**: `DECIMAL(20,4)` — allows fractional production and large totals without float rounding drift.
- **JSON columns**: `TEXT` + `json_encode`/`json_decode` — no `JSON` type, for MariaDB compatibility.
- **Migrations**: `sql/migrate_v2.sql` uses `ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` to be idempotent.

---

## 7. Security Model

| Threat | Mitigation |
|---|---|
| SQL injection | All queries use PDO prepared statements |
| CSRF | `X-CSRF-Token` header validated on every POST; token bound to session |
| Session fixation | `session_regenerate_id(true)` on login |
| Password storage | `password_hash(…, PASSWORD_BCRYPT)` |
| Ownership bypass | `verify_colony_ownership($db, $cid, $uid)` checked before every colony operation |
| Attacking self | `resolve_battle()` returns early if `target.user_id === fleet.user_id` |
| Integer overflow | Resource amounts stored as `DECIMAL(20,4)`; PHP uses `(float)` casts |
| Resource column injection | Dynamic column names (`$req['resource']`) validated against an explicit allowlist before use in SQL |
| XSS | All user-supplied strings escaped with `esc()` (a `htmlspecialchars` wrapper) before innerHTML insertion |
| Newbie griefing | `protection_until` column; attack missions blocked if target is protected |
| PvP opt-in | `pvp_mode` flag; attacks on players with `pvp_mode=0` return an error |

**Not yet hardened** (see FUTURE_ENHANCEMENTS.md):
- Rate limiting on auth endpoints
- `Content-Security-Policy` header
- Account lockout after failed login attempts

---

## 8. Configuration Reference

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

Derived game constants (in `game_engine.php`):

| Constant | Value | Meaning |
|---|---|---|
| `FLEET_SPEED_FACTOR` | `0.2` | ly/h per unit of base ship speed |
| `DEPOSIT_UNLIMITED` | `−1` | Sentinel for inexhaustible deposits |

---

## 9. Extension Points

### Adding a new building type

1. Add to `BUILDING_BASE_COST` and `BUILDING_COST_FACTOR` in `game_engine.php`.
2. If it produces a resource, add a production function and wire it into `update_colony_resources()`.
3. Add `BUILDING_META` entry in the `renderBuildings()` function in `game.js` (icon, category, description).
4. Add to `$starterLevels` in `colonize_planet()` and `$defaultBuildings` in `auth.php`.

### Adding a new research technology

1. Add to `RESEARCH_BASE_COST` in `game_engine.php`.
2. If it has a combat/production effect, wire it into the relevant function.
3. No frontend change needed — research renders generically.

### Adding a new ship type

1. Add to `SHIP_STATS` in `game_engine.php`.
2. No other change needed — shipyard renders generically.

### Adding a new fleet mission

1. Add to the `mission ENUM` in `schema.sql` and `migrate_v2.sql`.
2. Add a `case` in the `match ($fleet['mission'])` block in `fleet.php`.
3. Implement the resolver function in `fleet.php`.
4. Add a radio button to the mission selector in `renderFleetForm()` in `game.js`.

### Adding a new NPC faction

1. `INSERT INTO npc_factions` in `schema.sql` (and run it manually or via migration).
2. Optionally add faction-specific quest seeds in `faction_quests`.
3. No code changes needed — factions render generically.

### Adding a new achievement

1. `INSERT INTO achievements` in `schema.sql`.
2. Add detection logic to `check_and_update_achievements()` in `achievements.php`.

### Theming / reskinning

All colours are CSS custom properties in `:root` in `style.css`. A complete visual retheme requires only changing the `--bg-*`, `--accent`, `--text-*`, `--border` variables.
