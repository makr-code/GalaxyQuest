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
**Status:** ✅ Implemented  
**Effort:** Small

✅ Fleet progress bars update live every second via the countdown ticker.  
✅ 3D current position (x/y/z ly) is rendered per fleet row.  
✅ On arrival (progress ≥ 1.0), the ticker auto-calls `loadOverview()` + `WM.refresh('fleet')` (guarded per arr-timestamp to fire only once, as SSE fallback when the EventSource is unavailable).

### 2.2 Building & Research Queue Countdown Timers
**Priority:** 🎯  
**Status:** ✅ Implemented  
**Effort:** Small

✅ `[data-end]` spans update every second via the countdown ticker.  
✅ `[data-start][data-end]` progress bars animate live (buildings, research, shipyard queue).  
✅ When a timer hits `00:00:00`, the ticker calls `WM.refresh(windowId)` for the containing window (debounced 8 s per window to prevent flood on multiple simultaneous completions).

### 2.3 Galaxy Map: 2D Sector View with Colony Markers
**Priority:** 🎯  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ New `GalaxyMap2DController` class with full 2D canvas rendering.  
✅ Features:
   - Top-down x/y projection from `star_systems` coordinates
   - Spectral class → color mapping: O(blue), B(violet), A(gray), F(white), G(yellow), K(orange), M(red)
   - Star size based on luminosity (log scale)
   - Player colonies highlighted with green rings
   - Grid background for spatial reference
   - Mini-map inset (top-right corner) showing full galaxy overview
   - Hover cards showing system name & spectral class
   - Click to navigate to system details / enter 3D view
✅ Tab-based UI: Toggle between 3D View (existing WebGL renderer) and 2D Map  
✅ Canvas auto-sizing and DPI-aware scaling  
✅ Integrated into Galaxy window with smooth tab switching

### 2.4 Espionage: Spy Report UI Window
**Priority:** 🎯  
**Status:** ✅ Implemented  
**Effort:** Small

✅ `GET /api/reports.php?action=spy_reports` endpoint listing the player's own reports (newest-first, limit 50).  
✅ `🔍 Intel` WM window with `IntelController` class: full spy-report card rendering (resources, welfare bars, ships, leaders, deposits) + combat history + matchup-scan form.  
✅ `API.spyReports()` in api.js with 10 s TTL cache.

### 2.5 Trade Route System (Player-to-Player)
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ Trade routes table created: `origin_colony_id`, `target_colony_id`, `cargo_json`, `interval_hours`, `last_dispatch`, `is_active`.  
✅ API endpoints:  
   - `GET /api/trade.php?action=list` — list all user's trade routes with next dispatch time  
   - `POST /api/trade.php?action=create` — create/update trade route  
   - `POST /api/trade.php?action=delete` — delete route  
   - `POST /api/trade.php?action=toggle` — pause/resume route  
✅ Auto-dispatch logic: on every `/api/trade.php` call, checks routes where `last_dispatch + interval < NOW()` and auto-sends a fleet with cargo.  
✅ UI: Trade Routes window showing active routes with pause/resume/delete buttons, next dispatch time.  
✅ Route creation shows simple dialog with API command for manual creation (can be extended with UI form later).

### 2.6 Research Prerequisites
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Small

✅ `RESEARCH_PREREQS` constant in `game_engine.php` defines a 4-tier dependency tree (16 techs, base → Tier 3).  
✅ `check_research_prereqs()` validates user levels against prereqs; `api/research.php` enforces the check on `action=research`.  
✅ API response includes `can_research` + `missing_prereqs`; `renderResearch()` shows locked techs greyed out with "Requires: …" hint.

### 2.7 Colony Specialisation Bonuses (Wire colony_type)
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Small

✅ All 6 colony types apply their bonuses:  
- `mining`: +20% metal/crystal/deuterium/rare_earth (`update_colony_resources`)  
- `agricultural`: +30% food production, +15% happiness (`update_colony_resources`)  
- `research`: −15% research time (`api/research.php action=research`)  
- `industrial`: −10% building time (`api/buildings.php`), −10% ship build cost (`api/shipyard.php`)  
- `military`: +10% attack, +5% shield for fleets departing that colony (`api/fleet.php resolve_battle`)  
- `balanced`: no bonus/penalty

### 2.8 Recall Fleet: Return Cargo
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Tiny

When a fleet is recalled mid-transport, its `cargo_*` columns are returned to the origin colony on arrival. The `return_fleet_to_origin()` function in `api/fleet.php` handles this.

---

## Phase 3 — Multiplayer & Social 💡

_These require more design and affect multiple subsystems._

### 3.1 Alliance System
**Priority:** ✅ Done  
**Effort:** Large

✅ `alliances`, `alliance_members`, `alliance_relations`, `alliance_messages` tables created dynamically via `ensure_alliance_schema()` in `api/alliances.php`.  
✅ Full membership lifecycle: create, join, leave, disband, remove_member, set_role (leader / diplomat / officer / member).  
✅ Alliance treasury: contribute resources from homeworld, withdraw to leader's homeworld (officer+).  
✅ Diplomacy: declare_war, declare_nap (with expiry), declare_alliance, revoke_relation, set_relation.  
✅ War map: `action=war_map` returns colony positions colour-coded as own / war / neutral for the active alliance.  
✅ Alliance chat: `get_messages` / `send_message` (last 100 messages, member-only).  
✅ Shared intel: `api/reports.php?action=spy_reports` now includes all reports from alliance members when the requesting user is in an alliance; response includes `alliance_shared: true` flag.  
✅ Leaderboard extended: `[TAG]` badge shown per player in the Leaderboard window (API joined to `alliances` via `alliance_members`).  
✅ Frontend: full `AlliancesController` class in `game.js` — list, view, create, join, chat, contribute, diplomacy, member management dialogs.

### 3.2 Real-time Push Notifications (Server-Sent Events)
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ `api/events.php` streams events over long-lived HTTP connection.  
✅ Events: `connected`, `new_messages`, `fleet_arrived`, `fleet_returning`, `incoming_attack`, `reconnect`.  
✅ Client auto-reconnects with exponential backoff.  
✅ Session lock released immediately (`session_write_close`) so other requests are not blocked.  
✅ Background polling intervals reduced from 12/30 s to 30/60 s as fallback.

_Original description:_ The client polls every 60 seconds. Replace with SSE for:
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
**Status:** ✅ Implemented  
**Effort:** Medium

✅ `trade_proposals` table with lifecycle states (`pending`, `accepted`, `rejected`, `cancelled`, `expired`).  
✅ API endpoints implemented in `api/trade.php`:  
   - `GET /api/trade.php?action=list_proposals`  
   - `POST /api/trade.php?action=propose|accept|reject|cancel`  
✅ Accept flow validates resources, creates transport fleets for offer/request legs, and finalizes atomically in one DB transaction.  
✅ UI implemented via `TradeProposalsController` in `js/game.js` with Inbox/Outbox tabs and accept/reject/cancel actions.

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
**Status:** ✅ Implemented  
**Effort:** Large

✅ Global bot tick implemented in `npc_player_accounts_tick_global()` with app-state cooldown and bounded batch processing.  
✅ Per-account strategy tick (`npc_player_account_tick`) performs building upgrades, research starts, ship production, and fleet actions.  
✅ Colony-type-aware priorities are active (e.g. research/military/industrial focus trees).  
✅ Fleet actions include expansion and logistics routines (colonization + balancing transports).  
✅ Integrated into normal gameplay traffic via `npc_ai_tick()`.

_Follow-up:_ A dedicated scheduler/cron endpoint can still be added later to decouple ticks from player traffic.

### 4.2 Fleet Commander Active Decisions
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ Passive commander combat/speed bonuses are active.  
✅ `ai_fleet_commander_tick()` includes active autonomy actions:
- Defensive recall when hostile attack fleets are inbound to the home colony.
- Auto-intercept launch with fighter-heavy mission composition.
- Auto-scout toward nearby stale/unseen systems with hostile-territory filtering.
- Auto-logistics transport to weaker sibling colonies using cargo-heavy ship selection.
- Early recall of returning empty fleets for faster reinforcement.

### 4.3 Dynamic Faction Events
**Priority:** 💡  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ Global timed events implemented in `faction_events_tick_global()` (`api/npc_ai.php`) with cooldown + duration handling.  
✅ Event set implemented:
- **Galactic War**
- **Trade Boom**
- **Pirate Surge**
✅ Effects are applied/reverted on `npc_factions` stats and surfaced to players via in-game messages.  
✅ Active event payload is exposed via `api/factions.php` (`active_event`) for UI rendering.

_Note:_ Current implementation persists global event state via `app_state` keys (not an `npc_events` table).

### 4.4 Planetary Events & Anomalies
**Priority:** 🔭  
**Status:** ✅ Implemented  
**Effort:** Medium

✅ Planetary events are generated globally via `colony_events_tick_global()` (`api/npc_ai.php`) and persisted in `colony_events`.  
✅ Active event state is surfaced in overview payloads and rendered in the colony UI banner.  
✅ Implemented event effects:

- Solar flare: energy production −30% for 2 hours
- Mineral vein found: +20% metal production for 6 hours
- Disease outbreak: happiness −25 until Hospital lv 3 (then auto-cleared)
- Archaeological find: +500 dark matter one-time reward (requires Science Collective standing ≥ 20)

---

## Phase 5 — Content Expansion 🔭

### 5.1 Extended Research Tree
**Status:** ✅ Done

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

✅ All new research types available in backend cost/prereq model and seeded for new/existing users.  
✅ Gameplay hooks wired:
   - `nano_materials`: building material costs −15%
   - `genetic_engineering`: +25% food production, +10% max population
   - `quantum_computing`: −20% research time
   - `dark_energy_tap`: fusion reactor yields dark matter over time
   - `terraforming_tech`: required for Terraformer, plus temperature tolerance uplift for deuterium output
   - `stealth_tech`: fleet intel hidden in spy reports until attacker has espionage tech lv8
   - `wormhole_theory`: fully integrated — gates wormhole jump eligibility in `api/fleet.php`, surfaced in wormhole UI via `wormhole_theory_level` field, seeded by auth/setup/NPC-AI; Phase 5.3 wormhole system is the runtime effect.

### 5.2 Additional Ship Types
**Status:** ✅ Done

| Ship | Stats (cost / cargo / speed / attack–shield–hull) | Special |
|---|---|---|
| Frigate | 9k metal · 4k crystal · 1k deut / 200 / 20 000 / 180–35–10k | Fast mid-game scout; cheaper cruiser alternative |
| Carrier | 80k metal · 60k crystal · 25k deut / 800 / 5 000 / 800–1500–250k | Capital ship; 12 `fighter_wing_slots` (future wing mechanic) |
| Mining Drone | 12k metal · 2k crystal · 1.5k deut / 55 000 / 300 / 0–5–6k | High-cargo bulk freighter; essentially no combat ability |
| Hospital Ship | 20k metal · 25k crystal · 8k deut / 200 / 4 000 / 0–150–18k | +8 happiness per ship docked at colony (max 3, +24 total) |
| Science Vessel | 25k metal · 35k crystal · 12k deut / 100 / 5 000 / 0–80–12k | −10% research time per vessel docked (max 3, −30% total) |

✅ All 5 ships added to `SHIP_STATS` in `api/game_engine.php` → automatically appear in shipyard list.  
✅ Hospital Ship passive orbit effect wired in `update_colony_resources()` (happiness += 8 × ships, capped at 3).  
✅ Science Vessel research time reduction wired in `api/research.php` `action=research` (−10% × vessels, capped at 3).

### 5.3 Wormhole Network
**Priority:** 🔭
**Status:** ✅ Implemented

- `wormholes` table: two endpoints (galaxy+system), stability (0–100), cooldown.
- Fleets with `wormhole_theory` lv 5 can use a wormhole to jump instantly between endpoints.
- Stability decreases with use; regenerates over time.
- Ancient Precursor quests unlock permanent wormhole beacons.

Implemented in this phase:
- ✅ `wormholes` schema + migration baseline created.
- ✅ Fleet API supports wormhole route discovery (`action=wormholes`) and jump-enabled launch (`use_wormhole` in send payload).
- ✅ Jump gating requires `wormhole_theory` lv5 + active route + stability/cooldown checks.
- ✅ Using a wormhole applies stability drain and cooldown.
- ✅ Global maintenance tick regenerates stability over time and clears expired cooldowns.
- ✅ Dedicated Wormhole UI window is available (route status + one-click Fleet prefill for jump targets).
- ✅ Quest-based permanent beacon unlock is wired via Precursor faction quest rewards.

### 5.4 Faction-Specific FTL Drive System
**Priority:** ✅ Done  
**Status:** ✅ Fully Implemented (Phase 1–5, 2026-03-30) — see [FTL_DRIVE_DESIGN.md](FTL_DRIVE_DESIGN.md)

Each of the 6 main factions gets a unique FTL drive with distinct gameplay mechanics:

| Faction | Drive | Key Mechanic |
|---|---|---|
| Vor'Tak | Kearny-Fuchida Jump Drive (BattleTech) | Fixed jump points, 72h recharge cooldown, max 30 LY |
| Syl'Nar | Resonance Gate Network | Buildable gates, instant travel, gates destructible |
| Vel'Ar | Blind Quantum Jump | Instant but with arrival scatter → snap to nearest system, 60s stealth on arrival |
| Zhareen | Crystal Resonance Channel | Survey-charted nodes, mass-independent speed |
| Aereth | Alcubierre Warp | Density-dependent speed bonus in galactic core |
| Kryl'Tha | Swarm Tunnel | Fleet-size-dependent travel time, max 50 ships, −10% hull on arrival |

✅ Implemented:
- All 6 drive behaviours in `api/fleet.php` (speed, cooldown, scatter, stealth, gates, resonance nodes, swarm scaling)
- `users.ftl_drive_type` + `ftl_cooldown_until` columns; `ftl_gates`, `ftl_resonance_nodes` tables (migrations v10–v12)
- FTL status API (`fleet.php?action=ftl_status`), map overlay API (`action=ftl_map`)
- FTL selection API (`game.php?action=set_ftl_drive`) — first selection free, switch costs 200 DM
- Settings-UI: 6-faction drive-selection panel with live cost feedback
- Vor'Tak cooldown DM-reset: `fleet.php?action=reset_ftl_cooldown` (50 DM) + UI button in fleet panel
- OD-5: Vel'Ar scatter now snaps to nearest real `star_system` via proximity SQL query
- OD-3: NPC faction FTL assignment via migration v12 + `npc_assign_ftl_drive()` runtime in `npc_player_account_tick()`
- 3D galaxy map overlay: gates and resonance nodes rendered via `setFtlInfrastructure()` in `galaxy-renderer-core.js`

### 5.5 Megastructures
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
**Priority:** ✅ Done  
**Effort:** Small

- ✅ `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` headers added via `send_security_headers()` in `api/helpers.php` — called automatically from `json_response()`.
- ✅ Login rate-limiting in `handle_login()` (`api/auth.php`): tracks failed attempts per IP (SHA-256 hashed) in `login_attempts` DB table (`sql/migrate_security_v1.sql`, initdb `014`).
- ✅ Account lockout after `LOGIN_MAX_ATTEMPTS` (10) consecutive failures — 30-minute cooldown (`LOGIN_LOCKOUT_SECONDS`); configurable via env vars.
- ✅ `positive_int()` helper added to `api/helpers.php` — validates and casts `$_GET`/`$_POST` integers, rejects zero/negative values.

### 6.2 Test Coverage
**Priority:** ✅ Done  
**Effort:** Medium

- ✅ PHPUnit baseline:
   - `phpunit.xml` with `tests/bootstrap.php`
   - unit suite `tests/Unit/GameEnginePureFunctionsTest.php`
   - **14 tests / 63 assertions** — all green:
     `metal_production`, `deuterium_production`, `building_cost`, `building_build_time`,
     `research_time`, `colony_layout_profile`, `research_cost` (doubling + fallback),
     `vessel_manifest` (zero-filter, sample cap), `user_empire_color` (hex validation),
     `apply_fog_of_war` (unknown strips data, own passes through),
     `building_definitions` (required keys + minimum count).
- ✅ Integration smoke test: `scripts/test_auth_rate_limit.php`
   - Exercises `POST /api/v1/auth.php?action=login` end-to-end (CSRF + session cookies)
   - Verifies threshold behavior (`401` for first `LOGIN_MAX_ATTEMPTS`, then `429` lockout)
   - Verifies lock row persistence and cleanup on successful login.
- ✅ Integration smoke test: `scripts/test_admin_stats_endpoint.php`
   - Logs in as temporary admin and validates `GET /api/v1/admin_stats.php`
   - Checks success status and required payload shape (`users`, `colonies`, `fleets`, `npc_ticks`, `faction_event`, `config`).
- ✅ JS unit tests:
   - `package.json` + `vitest.config.mjs` → `npm run test:unit:js`
   - `tests/js/wm.test.js`: window lifecycle (`register/open/body/isOpen/close`, `setTitle`)
   - `tests/js/api.test.js`: endpoint versioning (`api/*` → `api/v1/*`, absolute URL passthrough)
   - **4 tests — all green**.

### 6.3 API Versioning
**Priority:** ✅ Done  
**Effort:** Small

✅ Version config added in `config/api_version.php` (`API_VERSION`, `API_ALLOW_LEGACY`, `API_VERSION_PREFIX`) and loaded from `config/config.php`.  
✅ Frontend request pipeline in `js/api.js` now rewrites logical `api/*.php` endpoints to canonical `/api/v1/*.php` at fetch time (centralized, zero call-site churn).  
✅ Apache routing in `.htaccess` maps `/api/v1/*` to `/api/*` (`QSA,L`) for backward-compatible rollout.  
✅ `api/helpers.php` validates incoming API route version (`gq_validate_api_version_request()`), emits migration headers for legacy paths, and can be hardened to strict-only by setting `API_ALLOW_LEGACY=0`.

### 6.4 Observability
**Priority:** ✅ Done  
**Effort:** Small

- ✅ Slow-query logging: `LoggingStatement extends PDOStatement` in `config/db.php` intercepts all `execute()` calls via `PDO::ATTR_STATEMENT_CLASS`; queries exceeding `SLOW_QUERY_THRESHOLD_MS` (default 500 ms, env-configurable) are written to `error_log` with timing and query text — zero call-site changes needed.
- ✅ `GET /api/admin_stats.php` (admin-only): returns active users (15 min / 1 h windows), colony counts by type, fleets in motion / returning / pending resolve, NPC global tick lag, stalest NPC account tick age, active faction event (type, started at, ends in N seconds), and current config thresholds.

### 6.5 Mobile / Responsive Layout
**Priority:** ✅ Done  
**Effort:** Medium

✅ Progressive enhancement added in `wm.js`: viewport detection at `< 800px` toggles a `wm-mobile` mode class on the document root.  
✅ Mobile WM behavior in `style.css` (`@media (max-width: 800px)`): windows are rendered in a single-column stacked flow (`position: relative`, `width: 100%`, auto height), with scrollable desktop region.  
✅ Touch ergonomics: drag and resize interactions are disabled in mobile mode (`wm.js`) and resize handle is hidden (`style.css`).  
✅ Desktop behavior remains unchanged for wider viewports.

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
