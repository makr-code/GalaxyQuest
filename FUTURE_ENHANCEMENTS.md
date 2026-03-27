# GalaxyQuest — Future Enhancements

> Structured roadmap of planned improvements, open questions, and long-term vision.  
> Status: **living document** — update when items are started or completed.  
> See also: [ARCHITECTURE.md](ARCHITECTURE.md) for extension points.

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Implemented |
| 🚧 | In progress / partially done |
| 🎯 | High priority — next to implement |
| 💡 | Good idea, medium priority |
| 🔭 | Long-term / research-stage |
| ❓ | Needs design decision before starting |

---

## Phase 1 — Core Gameplay Loop (✅ Done)

These items are fully implemented and shipped:

- ✅ User auth with CSRF, session protection, newbie shield
- ✅ Procedural galaxy: 9 galaxies × 499 systems, deterministic, scientific
- ✅ Colony hierarchy: StarSystem → Planet → Colony → Buildings
- ✅ 22 building types in 8 categories
- ✅ 16 research technologies
- ✅ 16 ship types, shipyard construction queue
- ✅ 5 fleet missions: Attack · Transport · Colonize · Spy · Harvest
- ✅ 3D Newtonian fleet movement (x/y/z ly coordinates, speed_ly/h)
- ✅ Combat with tech levels, commander skill, shield penetration, per-side casualties
- ✅ Population · Food · Happiness · Public Services economy
- ✅ Rare-earth deposits (finite, class-dependent richness)
- ✅ Leader system: Colony Manager · Fleet Commander · Science Director (AI autonomy)
- ✅ NPC factions: Empire · Guild · Collective · Pirates · Precursors
- ✅ Faction diplomacy, trade offers, faction quests, pirate raids
- ✅ Achievements (15) with dark-matter rewards
- ✅ Leaderboard, in-game messaging, battle reports, spy reports
- ✅ Floating window manager UI (drag, resize, minimize, persist)

---

## Phase 2 — Depth & Polish 🎯

_Short-term: these add meaningful depth with contained scope._

### 2.1 Real-time Fleet Tracking
**Priority:** 🎯  
**Effort:** Small

The fleet progress bar in the Overview window currently shows the static progress at render time. It should count down live without a page reload.

- Add a `setInterval` in `renderOverview()` / the fleet list section that reads `_GQ_fleets` and recomputes `fleet_current_position()` client-side every second.
- Display current 3D coordinates and ETA countdown ticking in real time.
- On arrival (progress ≥ 1.0), trigger `loadOverview()` automatically.

### 2.2 Building & Research Queue Countdown Timers
**Priority:** 🎯  
**Effort:** Small

Buildings and research show a static "⏳ finishing at …" timestamp. They should count down.

- The `data-end` attributes are already emitted on busy cards.
- Add a shared `startCountdownTimers()` function called after every render that queries `[data-end]` and updates innerHTML every second.
- When a timer reaches zero, auto-call `renderBuildings()` / `renderResearch()`.

### 2.3 Galaxy Map: 2D Sector View with Colony Markers
**Priority:** 🎯  
**Effort:** Medium

The current galaxy window shows a raw JSON dump. Replace with:

- A `<canvas>` 2D top-down projection of the current galaxy (use x/y from `star_systems`).
- Each system drawn as a dot; dot colour = star spectral class; size = luminosity.
- Player colonies highlighted; faction territory shaded; hovering shows system name.
- Click to navigate to system detail (existing `renderGalaxyWindow` logic).
- Mini-map inset for the full galaxy.

**Design note:** star coordinates are already stored as `x_ly / y_ly / z_ly` in `star_systems`. For the 2D map, project to x/y and let the user toggle between x/y and x/z planes.

### 2.4 Espionage: Spy Report UI Window
**Priority:** 🎯  
**Effort:** Small

Spy reports are stored in `spy_reports` but there is no dedicated UI window for them.

- Add `GET /api/fleet.php?action=spy_reports` endpoint listing the player's own reports.
- Add a `🔍 Intel` nav button and WM window that lists reports newest-first.
- Each report expands to show: resources, welfare bars, ships, leaders, deposits — formatted identically to the colony overview cards.

### 2.5 Trade Route System (Player-to-Player)
**Priority:** 💡  
**Effort:** Medium

Currently transport fleets are one-shot. A persistent trade route would automate recurring supply runs.

- New `trade_routes` table: `origin_colony_id`, `target_colony_id`, `cargo_json`, `interval_hours`, `last_dispatch`.
- `GET /api/trade.php?action=list` + `POST action=create/delete`.
- On overview load: check routes where `last_dispatch + interval < NOW()` and auto-send a fleet.
- UI: Trade Routes window showing active routes with pause/resume/delete buttons.

### 2.6 Research Prerequisites
**Priority:** 💡  
**Effort:** Small

Currently all 16 technologies are available from level 0. A prerequisite tree adds strategic depth.

- Add a `RESEARCH_PREREQS` constant in `game_engine.php` (e.g., `hyperspace_drive` requires `impulse_drive` lv 5).
- `api/research.php` checks prereqs before starting.
- `renderResearch()` shows locked techs greyed out with the required prereq shown.

### 2.7 Colony Specialisation Bonuses (Wire colony_type)
**Priority:** 💡  
**Effort:** Small

`colonies.colony_type` (mining / industrial / research / agricultural / military / balanced) is stored but not yet applied to production formulas.

- In `update_colony_resources()`, read `colony_type` and apply multipliers:
  - `mining`: +20% metal/crystal/deuterium/rare_earth production
  - `agricultural`: +30% food, +15% happiness
  - `research`: −15% research time
  - `industrial`: −10% build time, −10% ship build cost
  - `military`: +10% ship attack, +5% shield
  - `balanced`: no bonus, no penalty

### 2.8 Recall Fleet: Return Cargo
**Priority:** 💡  
**Effort:** Tiny

When a fleet is recalled mid-transport, its `cargo_*` columns hold resources that should be returned to the origin colony on arrival. Currently `recall_fleet` doesn't deliver cargo.

- In `return_fleet_to_origin()`, check if `fleet.cargo_metal > 0` etc. and `UPDATE colonies SET metal = metal + ? …` for the origin colony.

---

## Phase 3 — Multiplayer & Social 💡

_These require more design and affect multiple subsystems._

### 3.1 Alliance System
**Priority:** 💡  
**Effort:** Large

- New tables: `alliances` (id, name, tag, leader_user_id, created_at), `alliance_members` (alliance_id, user_id, role, joined_at).
- Alliance diplomacy: NAP · Alliance · War declarations stored in `alliance_relations`.
- Alliance chat: shared message board.
- Shared intel: spy reports visible to all alliance members.
- `leaderboard` extended with alliance ranking.
- **Design question ❓**: Should alliances share resource pools, or just information and non-aggression?

### 3.2 Real-time Push Notifications (Server-Sent Events)
**Priority:** 💡  
**Effort:** Medium

Currently the client polls every 60 seconds. Replace with SSE for:
- Fleet arrival notifications
- Incoming attack warnings
- New messages badge update

```php
// api/events.php
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
// ... SELECT messages/fleets changed since last seen timestamp
// data: {"type":"fleet_arrived","fleet_id":42}
```

**Deployment note**: SSE keeps a PHP process open. Works on PHP-FPM but may need `max_execution_time = 0` and FPM pool tuning.

### 3.3 Player-to-Player Trading
**Priority:** 💡  
**Effort:** Medium

- `trade_proposals` table: initiator, target, offer_json, request_json, status, expires_at.
- `POST /api/trade.php?action=propose` — send offer.
- `POST /api/trade.php?action=accept|reject` — respond.
- Atomic resource swap on accept (transaction).
- UI: Trade Inbox in Messages window.

### 3.4 War Declarations & Territory
**Priority:** 🔭  
**Effort:** Large

- Players (or alliances) can formally declare war / peace, enabling PvP without the `pvp_mode` toggle.
- Galaxy territory visualisation: sectors coloured by dominant alliance.
- Blockade mechanic: fleet in orbit prevents departing fleets from leaving a colony.

---

## Phase 4 — AI & Simulation Depth 💡

### 4.1 NPC Player Accounts (Bots)
**Priority:** 💡  
**Effort:** Large

`users.is_npc` column already exists. Extend `npc_ai.php` to run full player-side AI:

- `npc_ai_tick()` for NPC users: upgrade buildings, queue research, build ships, send fleets.
- Difficulty tiers: Beginner bots use suboptimal strategies; Elite bots prioritise mining → research → fleet.
- NPC accounts seeded with a homeworld colony on DB install.
- Bots attack weak player colonies when standing < −50 with the Empire/Pirates faction.

**Design note ❓**: NPC ticks should be global (not per-user-request). Consider a dedicated `/api/npc_tick.php` endpoint called by a cron job every 5–15 minutes.

### 4.2 Fleet Commander Active Decisions
**Priority:** 💡  
**Effort:** Medium

Currently fleet commanders only apply passive bonuses. With full autonomy they should:

- Recall fleets when origin colony is under attack.
- Auto-select best ships for mission type (fighters for attack, cargo ships for transport).
- Route around hostile territory (requires faction war state awareness).

### 4.3 Dynamic Faction Events
**Priority:** 💡  
**Effort:** Medium

Add time-limited galaxy-wide events driven by faction state:

- **Galactic War**: Empire vs. Precursors — players can side with either, PvP attacks on enemy side give standing bonus.
- **Trade Boom**: Guild doubles trade offer values for 24 hours.
- **Pirate Surge**: Pirate aggression ×2 for 12 hours; defending successfully gives large standing gain.

Events stored in an `npc_events` table with `starts_at`, `ends_at`, `type`, `params_json`.

### 4.4 Planetary Events & Anomalies
**Priority:** 🔭  
**Effort:** Medium

Random (seeded by time + planet id) events that affect a specific colony:

- Solar flare: energy −30% for 2 hours
- Mineral vein found: +20% metal production for 6 hours
- Disease outbreak: happiness −25 until hospital lv 3 built
- Archaeological find: +500 dark matter one-time reward (requires Science Collective standing ≥ 20)

---

## Phase 5 — Content Expansion 🔭

### 5.1 Extended Research Tree

Current 16 technologies cover propulsion, weapons, and basic infrastructure. Planned additions:

| Tech | Effect |
|---|---|
| `nano_materials` | −15% building material cost |
| `genetic_engineering` | +25% food production, +10% max population |
| `quantum_computing` | −20% research time |
| `dark_energy_tap` | Fusion reactor produces dark matter |
| `wormhole_theory` | Enables wormhole beacons (Phase 5.3) |
| `terraforming_tech` | Prerequisite for Terraformer building; increases temperature tolerance |
| `stealth_tech` | Fleet invisible to spy probes below level 8 |

### 5.2 Additional Ship Types

| Ship | Role |
|---|---|
| Frigate | Fast scout; cheaper cruiser alternative |
| Carrier | Carries fighters; adds fighter wing mechanic |
| Mining Drone | Unmanned; carries only minerals; very slow |
| Hospital Ship | Restores colony happiness passively when in orbit |
| Science Vessel | Provides +10% research speed to assigned colony |

### 5.3 Wormhole Network
**Priority:** 🔭

- `wormholes` table: two endpoints (galaxy+system), stability (0–100), cooldown.
- Fleets with `wormhole_theory` lv 5 can use a wormhole to jump instantly between endpoints.
- Stability decreases with use; regenerates over time.
- Ancient Precursor quests unlock permanent wormhole beacons.

### 5.4 Megastructures
**Priority:** 🔭

Very late-game, alliance-level constructions:

| Structure | Cost | Effect |
|---|---|---|
| Dyson Sphere | 10B metal, 5B crystal | ×10 energy for the entire system |
| Ring World | 50B all resources | +10 million max population |
| Gravity Well Generator | 1B all + graviton_tech lv 10 | Captures debris fields automatically |
| Ansible Array | 5B crystal | Enables instant messaging across galaxies |

---

## Phase 6 — Technical Quality

### 6.1 Security Hardening
**Priority:** 🎯  
**Effort:** Small

- Add `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` headers in `.htaccess` / `helpers.php`.
- Rate-limit auth endpoints (`/api/auth.php?action=login`) — track failed attempts in DB or APCu.
- Account lockout after 10 consecutive failed logins (30-minute cooldown).
- Validate that all `$_GET` / `$_POST` integers are actually positive integers (use a `positive_int()` helper).

### 6.2 Test Coverage
**Priority:** 💡  
**Effort:** Medium

- Add PHPUnit tests for `game_engine.php` pure functions (resource production, build costs, population growth).
- Add integration tests for key API actions using an in-memory SQLite test DB.
- Add JS tests (Vitest or similar) for `wm.js` window lifecycle and `api.js` call wrappers.

### 6.3 API Versioning
**Priority:** 🔭  
**Effort:** Small

Prefix all API URLs with `/api/v1/` now to avoid breaking clients when the API evolves. Add a `config/api_version.php` that `helpers.php` validates.

### 6.4 Observability
**Priority:** 💡  
**Effort:** Small

- Log slow queries (> 500 ms) to `error_log`.
- Add an `admin/stats.php` endpoint (admin-only) showing: active users, colonies, fleets in motion, NPC tick lag.
- Optional: emit OpenTelemetry spans via a PHP SDK for production deployments.

### 6.5 Mobile / Responsive Layout
**Priority:** 💡  
**Effort:** Medium

The WM desktop is not usable on small screens. Options:

- **Progressive enhancement**: detect viewport < 800px; replace WM windows with a tab-based single-column layout.
- The existing CSS custom properties make theming straightforward; the layout change requires a parallel render path in `game.js`.

---

## Open Design Questions ❓

1. **Alliance resource pools**: Should alliances be able to contribute to a shared stockpile for alliance megastructures? Or purely diplomatic/military?

2. **Galaxy reset / seasons**: Should the galaxy reset periodically (monthly season) with rankings saved, to keep the game fresh? Or persistent forever?

3. **Dark matter economy**: Currently DM is only spent on… nothing yet. Should it buy premium leaders, accelerate builds, or unlock cosmetic skins?

4. **Fleet size limits**: Should there be a max fleet size per dispatch to prevent late-game one-shot empires? Or let research (Computer Tech) raise the cap?

5. **Offline protection**: Currently there is only the timed newbie shield. Should there be a vacation mode that pauses all activity? (`vacation_mode` column exists but is not enforced.)

6. **NPC faction territory**: Should factions own star systems with NPC colonies that players can attack? This would require NPC user accounts and a colony seeder.

7. **Diplomacy actions**: Currently standing only changes passively (quests, raids, trade). Should players be able to spend dark matter to repair standing? Or send gifts (resources) to a faction?

---

## Backlog (Unordered)

- [ ] Colony rename history log
- [ ] Fleet name / custom labels
- [ ] Debris field mechanic (resources from destroyed ships, collectible by recycler)
- [ ] Moon slots (1 per planet, smaller, no temperature bonus, military structures only)
- [ ] Dark matter mine (requires graviton_tech lv 5, very slow production)
- [ ] Spy counter-intelligence (chance to detect and destroy incoming probes)
- [ ] Battle simulator UI (preview expected outcome before sending fleet)
- [ ] Building demolish (refunds 50% of resources, frees up colony_hq capacity)
- [ ] Commander portrait / avatar selection
- [ ] Faction reputation titles (e.g. "Guild Associate", "Pirate Blood Brother")
- [ ] Cross-galaxy fleet routing with waypoints
- [ ] Export planet data as JSON (for player tooling / spreadsheets)
- [ ] Dark theme / light theme toggle
- [ ] Keyboard shortcuts for common actions (B = open Buildings, R = Research, etc.)
- [ ] Internationalisation (i18n) — German + English at minimum
