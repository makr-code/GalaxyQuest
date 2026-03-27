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

For a non-Docker setup, see [Manual Installation](#manual-installation).

---

## Feature Overview

| Area | Status |
|---|---|
| 🔐 Auth (register / login / CSRF / session) | ✅ |
| 🌌 Procedural spiral galaxy (deterministic, configurable, default 25,000 systems in galaxy 1) | ✅ |
| 🌍 Scientific planet generation (Kopparapu HZ, Kepler periods, IMF star types) | ✅ |
| 🏗 Colony hierarchy: Galaxy → System → Planet → Colony → Buildings | ✅ |
| ⛏ 22 building types across 8 categories | ✅ |
| 🔬 16 research technologies | ✅ |
| 🚀 16 ship types | ✅ |
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

---

## Architecture & Design Decisions

### No Framework, No Build Step

The frontend is plain HTML5 + CSS3 + vanilla JS (ES2020). The backend is plain PHP 8 with PDO. This was a deliberate choice:

- **Zero deploy friction** — copy files, create DB, done.
- **No transpiler, bundler, or package manager** — `index.html` and `game.html` are self-contained.
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
├── index.html              # Login / register page
├── game.html               # Main game UI (window manager shell)
├── css/
│   └── style.css           # Dark space-themed UI (~835 lines)
├── js/
│   ├── wm.js               # Floating window manager
│   ├── starfield.js        # Animated star background (canvas)
│   ├── auth.js             # Login / register
│   ├── api.js              # All API calls in one place
│   └── game.js             # Game UI: all window renderers (~1 300 lines)
├── api/
│   ├── helpers.php         # Shared request/response, auth, CSRF
│   ├── game_engine.php     # Formulas, constants, colony tick (~700 lines)
│   ├── planet_helper.php   # ensure_planet(), DEPOSIT_UNLIMITED
│   ├── galaxy_gen.php      # Deterministic galaxy generator (~710 lines)
│   ├── auth.php            # Register / login / logout
│   ├── game.php            # Overview, resources, rename, leaderboard
│   ├── buildings.php       # List / upgrade / finish buildings
│   ├── research.php        # List / start / finish research
│   ├── shipyard.php        # List ships / build
│   ├── fleet.php           # Send / list / recall; battle/spy/colonize/harvest
│   ├── galaxy.php          # Galaxy map, system view, star system cache
│   ├── factions.php        # Faction list, trade, quests, diplomacy
│   ├── leaders.php         # Hire / assign / autonomy / AI tick
│   ├── npc_ai.php          # NPC faction tick (trade gen, raids, decay)
│   ├── achievements.php    # Achievement detection and rewards
│   └── messages.php        # In-game messaging
├── config/
│   ├── config.php          # Game constants and DB credentials
│   └── db.php              # PDO singleton factory
└── sql/
    ├── schema.sql          # Full schema (19 tables) — use for fresh install
    └── migrate_v2.sql      # ALTER TABLE migrations — use for upgrade
```

---

## Database Schema (19 tables)

```
users               – accounts, rank, dark matter, protection, NPC flag
star_systems        – cached star properties + 3D coords (ly)
planets             – astronomical data, richness × 4, deposits × 4
colonies            – player base: resources × 5, food, population, happiness
buildings           – type + level per colony
research            – type + level per user
ships               – type + count per colony
fleets              – 3D origin/target coords, mission, cargo, ships_json
leaders             – role, skills, autonomy, colony/fleet assignment
messages            – inbox
battle_reports      – attacker/defender/loot/tech JSON + composite indexes
spy_reports         – target resources/welfare/ships/leaders JSON
npc_factions        – 5 seeded factions with archetype parameters
diplomacy           – per-user standing (−100 → +100) per faction
trade_offers        – AI-generated, timed, per-faction
faction_quests      – 8 seeded quests (kill/deliver/explore/build/research/spy)
user_faction_quests – active/completed quest instances per user
achievements        – 15 milestone definitions
user_achievements   – completion + reward-claimed state per user
```

