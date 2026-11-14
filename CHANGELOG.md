# Changelog

All notable changes to GalaxyQuest are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Sprint 1.2: Technische Schulden abbauen

### Fixed — Isolated MySQL physical transport acceptance

- Fresh MySQL 8.4.11 acceptance exposed a real schema mismatch: the historical
  fleet mission ENUM rejected `return`, rolling back every delivery. Append-only
  `migrate_trader_transport_return_v1.sql` adds that mission; its guarded down
  refuses to discard ships still returning. Historical SQL remains unchanged.
- The full isolated standing-order suite passes **21 tests / 1,372 assertions**
  after applying and verifying the complete canonical manifest. Three new
  regressions cover last-owned-carrier races, capacity-limited partial fills,
  held acquired cargo waiting for a real ship return, repeated delivery/return
  claims, same-source/trader owner locks with stale REPEATABLE READ snapshots,
  participant-only outbound/empty-return projection and primary/processed
  DECIMAL stock with exact cents escrow. One endowed ship remains one ship;
  no carrier, cargo or payment is fabricated by retries.
- Latest focused SQLite route/projection/ledger/scenario validation passes
  **55 tests / 9,295 assertions**, with the existing PHPUnit deprecation
  untouched. No live database, migration, binding, SMTP, scheduler, deployment,
  user-container change, bundle-budget change or commit.

### Added — Gross economy accounting and physical-transport acceptance

- Seven-day in-memory scenario: two explicitly endowed NPC colonies, one
  human and an existing trader produce 147 standing orders and 87 completed
  funded deliveries (2,529 metal, 48 steel alloy); 500,000 total credits remain
  conserved with zero tax. Duplicate hourly calls, ignored/expired requests,
  bounded backlog, four-day catch-up, transaction retry, delayed delivery and
  funded construction completion are exercised without live services.
- A paired human-funded order changes the next shipment from 208 to 1 metal.
  A new seven-day branch balances every catalog good from actual simulator gross
  quantities, initial physical stocks, 50 metal in sell escrow and 100 metal in
  flight. Final holdings: 3,241.530075 metal, 1,325.747184 steel alloy,
  38.315408 electronics components, 0.499625 consumer goods, 1,000 food.
  Actual recipe inputs, outputs, population use, storage blocking and starvation
  are exercised; no rate×duration proxy or interchangeable raw/manufactured mass.
- Four-day offline settlement includes a fully elapsed two-hour metal event:
  691.691659 first-day output includes 34.649002 additional historical metal.
  Later steps exclude expired modifiers; one deadline-boundary acceptance is
  rejected and another ignored offer expires through the persisted hourly path.
  Current-window-only decisions, duplicate notifications, bounded catch-up and
  exactly-once late delivery are verified together.
- A positive NPC chain switches metallurgy to efficient (1.7 metal/output) and
  queues a level-1 hydroponic farm for 300 metal, 150 crystal and 50 deuterium.
  No output precedes its 648-second ETA; the remaining hour produces 10.66 food.
  The next hour does not repeat the method/build. Food reserve, actual goods,
  order escrow and finite construction/order budgets remain authoritative.
- Instant ledger `exchange()` is disabled. Real funded transports require
  existing trader-owned cargo ships at a source-system depot; capacity bounds
  acquisition, departure debits ships, arrival delivers/pays once, and the empty
  return fleet refunds ships only after its timer. No ships/depots are granted.
  The shared raw-production context now uses gross rates before the real step's
  storage clamp, rather than clamping an already constrained overview estimate.
- Nine SQLite scenario tests pass (8,857 assertions); the combined focused
  NPC/world/request/route/ledger run passes 132 tests / 10,348 assertions.
  The pre-existing GalaxyNews PHPUnit metadata deprecation remains untouched.
  Touched PHP syntax and runtime PHPStan pass.
  The earlier isolated MySQL seven-day result (850 assertions) predates physical
  transport; the subsequent isolated acceptance above validates real ship/escrow
  locking and representable four-decimal stock writes, not a cross-database
  equality proof for every simulator gross-flow rounding step.
  No automatic faction-world provisioning,
  live migration, SMTP delivery, scheduler activation, deployment or agent commit.

### Added — Bounded NPC economic production choices

- Explicitly bound NPC actors now evaluate actual recipe/raw-production forecasts
  and may execute one method adjustment and one affordable player-style queued
  construction per UTC hour, sharing standing-order idempotency and finite budget.
  Survival food/energy and manufactured-input bottlenecks use actual population,
  research, input/energy/storage limits and a stable improvement threshold.
- Shared construction guards preserve player costs, discounts, research,
  slots/class capacity and ledger affordability. Active queues prevent duplicate
  capacity; food reserves and existing stock/credit escrow remain protected.
  Market-valued construction resources and new buy escrow share the policy cap;
  valuation neither grants resources nor charges fictitious credits.
- Decision preview is now strictly read-only, including due queues and stale
  cursors. Existing CLI diagnostics show needs, methods/levels, costs, reservations,
  executed/deferred reasons and window. Database failures roll back the complete
  actor decision. No new migration, automatic activation, provisioning, research/
  combat autonomy, SMTP, scheduler or rollout; completion remains on demand.
- Verified 89 targeted SQLite tests / 755 assertions (one existing PHPUnit
  deprecation), plus five isolated MySQL tests / 84 assertions covering queue/
  idempotency/savepoint and CLI cases.
  Affected PHPStan uses the unchanged baseline.

### Added — Voluntary NPC surplus purchase invitations

- The existing bounded invitation selection now also offers policy-reserved NPC
  surplus. Player acceptance reserves the displayed maximum credits and moves
  existing NPC stock into a private pair; delivery still requires normal delayed
  trader routes. Decline or expiry is free. Both directions share the existing caps.
- Append-only `migrate_economy_request_purchase_v1.sql` preserves historical supply
  semantics; its guarded down refuses to discard purchase history. Deploy after
  the original request migration and explicitly bind eligible NPC profiles.

### Added — Voluntary timed player supply requests

- Existing hourly NPC economy now invites eligible players to supply exact
  whole catalog goods from their own same-galaxy colonies against actual funded
  NPC buy orders. Immutable cent terms, capped absolute deadlines, deterministic
  bounded selection and deduplicated in-game/outbox notifications; email opt-out
  is respected. Ignoring or declining costs nothing, reserves nothing and does
  not stop autonomous NPC trading.
- Atomic CSRF-protected acceptance revalidates backing and creates an exact
  private reciprocal standing-order pair, moving rather than minting NPC escrow.
  Duplicate acceptance never repeats reservation; unavailable backing returns
  409 without player spending. Existing traders fulfil later, not instantly.
  Explicit cancellation releases only both unallocated residuals, never flight
  backing; NPC upkeep does not silently cancel accepted pairs.
- Pure owned-colony request reads, persisted hourly expiry, actionable safe-DOM
  market UI and append-only `migrate_economy_requests_v1.sql` with guarded down.
  No advice/reputation mandates, new scheduler, world funding,
  NPC activation, live migration or actual test SMTP delivery.
- Verified 65 targeted PHP tests / 838 assertions (51 SQLite economy/notification
  regressions plus 14 isolated MySQL funded-order regressions, including final-
  budget races, duplicate acceptance and guarded migration down/up), and 54 JS
  market/legacy-proposal tests. Affected PHPStan, PHP syntax, ESLint and append-only
  migration-history checks pass.

### Added — Opt-in autonomous NPC colony standing orders

- Existing hourly NPC account decisions now support explicitly bound NPC-owned
  colonies with production/class/recipe-driven food/input reserves and finite
  buy escrow or measured sell surplus through the ordinary standing-order ledger.
  UTC-window summaries and effects commit atomically, including force/retry
  protection, deterministic priorities, four-operation and actual-credit caps.
  Existing reservations/transit purchases prevent duplicate offers; conservative
  24-hour refresh cancels only residual commitments. Catch-up defers stale orders.
- Append-only `migrate_npc_economy_orders_v1.sql` registers persistent opt-in
  profile/window/order metadata without funding or provisioning seeds.
  `scripts/npc_economy.php` supplies explicit-target offline bind, rollback
  preview and read-only diagnostics; activation requires an existing
  non-authenticating `npc_engine` owner and existing credits.
- Bound actors bypass legacy multi-round build/research/ship actions; unbound
  actors retain them. No scheduler, periodic production scan, LLM dependency,
  human consent changes, faction/species coupling or automatic world creation.
  Existing funded traders and timed routes are still required for exchange;
  additional building choices and player deadlines remain out of scope.
- Verified **78 targeted tests / 1,410 assertions** on PHP 8.2.35, including
  14 autonomous SQLite regressions and 10 isolated MySQL 8.4.11 regressions
  (three new CLI/window/current-ownership rollback cases). Two NPC colonies
  exchange primary/manufactured goods over deterministic decision windows
  through real funded routes; in-flight obligations and reserve protection
  remain intact. Affected PHPStan and PHP syntax checks pass; no live rollout.

### Added — Funded voluntary NPC standing orders

- Explicit finite standing buy/sell orders in the market API and German UI,
  separate from instant market-maker trading; default NPC access is disabled.
  Buying reserves the complete budget; selling reserves physical catalog goods.
  Authenticated CSRF POST create/cancel and pure owned-colony GET list;
  cancellation refunds only unallocated residuals, exactly once.
- NPC routes use backed order pairs and contract ask/bid prices. Acquisition
  pays the seller from trader capital and earmarks buyer escrow on the route;
  atomic delivery pays the NPC from that escrow without minting money.
  Cancelled in-flight orders remain payable; deterministic participant locks,
  replay and rollback tests cover conservation, same-owner and all cargo classes.
- Append-only `sql/migrate_standing_trade_orders_v1.sql`; no default orders,
  NPC colonies, seeded goods/credits or scheduler changes.
  Unfunded legacy planning fails safely; acquired/in-transit legacy routes
  retain cargo/history in explicit quarantine pending operator reconciliation.
- MySQL 8.4.11 certification adds executable canonical-migration/subprocess
  regressions for finite reservations, cancellation/acquisition races, partial
  fills, reverse/same-owner routes, concurrent completion/ordinary-arrival
  exclusion, savepoint rollback and outer REPEATABLE READ stale snapshots.
  Ledger reads now use current locking reads after participant locks and
  revalidate ownership; delivery verifies linked order ownership and quarantines
  missing endpoints/orders without losing committed cargo or escrow.
  Verified targeted run: 24 tests / 960 assertions, including seven focused
  MySQL integration regressions; affected PHPStan and PHP syntax checks pass.
- The unreleased standing-order migration adds quantity/escrow checks and unique
  fleet binding, and prevents trader/account deletion from cascading away funded
  routes. Historical orders/routes intentionally block parent deletion; no
  destructive rollback/refund workflow or production rollout is included.

### Added — Hourly world tick: world events and e-mail digests

- The existing global simulation tick is the flat hourly tick engine:
  `SIMULATION_GLOBAL_TICK_COOLDOWN_SECONDS` now defaults to `3600` and is
  aligned to `floor(unix/3600)` windows; missed windows are not replayed.
- New `world_events` subsystem rolls a small, deterministically seeded catalog
  (supply shock, demand boom, trade disruption, windfall discovery) once per
  window (`src/Economy/WorldEvents.php`, `src/Simulation/HourlyWindow.php`).
  Active events modify on-demand price quotes and, time-bounded per settle
  step, colony production; they are exposed in `market.php` (`get_prices`
  `world_events`, `get_active_events`) and listed in the market window.
- Affected players get one in-game message and one digest e-mail per window
  via the new transactional `mail_outbox` (subsystem `mail_outbox`, advisory,
  last step; backoff, `skipped` without transport; CLI
  `scripts/send_mail_outbox.php`). SMTP/Mailpit delivery moved to
  `lib/Mailer.php`; registration mail behavior is unchanged.
- `users.email_notifications` opt-out with `game.php?action=notification_settings`
  / `set_email_notifications` and a commander-menu toggle.
- Migration `sql/migrate_world_events_v1.sql` (`world_events`, `mail_outbox`,
  `users.email_notifications`).
- `docker-compose.yml` gains a `scheduler` service (global tick every 300 s);
  cron for production is documented only.

### Changed — Tick-frequency-independent world subsystems

- NPC player accounts catch up one decision round per elapsed 15 min (max 4).
- Faction and colony event rolls use `1-(1-p)^(elapsed/period)` with a 2-h cap
  and seeded per-window randomness; colony events no longer use `ORDER BY RAND()`.
- Wormhole stability regenerates +2 per elapsed 10 min (cap 24 h) instead of
  +2 per call.

### Removed — Client-side economy simulation

- Removed: unused client-side economy simulation (EconomySimulation.js), WebGPU
  economy compute (EconomyComputeEngine.js, economy_tick.wgsl),
  RuntimeEconomyController/RuntimeEconomyFlowController and the experimental JS
  economy/market domains with their tests; frontend renders server read models
  (server-economy-domain.js, server-market-domain.js); migration guide archived
  to docs/archive/.

### Removed — Legacy colony economy and `ON_DEMAND_ECONOMY_ENABLED`

- The on-demand ledger (`src/Economy/OnDemandEconomy.php`) is now the only
  colony economy path. The `ON_DEMAND_ECONOMY_ENABLED` flag and all legacy
  branches were removed from config, API handlers and fleet launch.
- Removed `api/economy_flush.php` (lazy flush and legacy market formulas) and the
  `economy_production` / `economy_population` subsystems of the global simulation
  tick; there is no periodic economy tick. Still-used constants and
  `get_policy_good_multipliers()` moved to `api/economy_runtime.php` /
  `api/economy.php`.
- Removed the broken `scripts/traders_background_job.php`; traders run via
  `scripts/run_simulation_tick.php --scope=global`.
- The legacy pop-policy endpoint now responds with HTTP 503.
- Deployments must apply all pending migrations (incl.
  `sql/migrate_economy_on_demand_v1.sql`) before upgrading.

### Fixed — On-demand economy concurrency

- Top-level MySQL ledger transactions use `READ COMMITTED`, so concurrent
  research starts and credit/stock guards can no longer evaluate a stale
  snapshot taken before the user lock was acquired.

### Added — Time-based NPC trader logistics

- NPC routes now advance through acquisition, launch, due delivery, and sale
  within one processing pass; persisted arrival schedules replace the old
  step-count delay. Stale/repeated route callers are re-read under row locks,
  route mutations roll back together on errors, and trader-owned fleets bypass
  ordinary fleet-arrival resolution.
- The OnDemandEconomy catalog now drives route goods and opportunity scans,
  including all primary and processed goods. Source/destination colonies settle
  before inventory changes; route fleets use the existing 3-D travel helpers at
  the explicit NPC logistics speed of 100 ly/h.
- Counterparty permissions and balanced payments are now supplied by the funded
  standing-order block above; older unfunded routes are not grandfathered into
  player consent.

### Changed — Start-page galaxy flight tour

- The read-only start-page flight now circles the system, star, selected planet,
  and moon before continuing, then performs lateral fly-bys past deterministic
  preview asteroids and a clearly marked preview survey ship.
- Asteroids and the ship are created only in the flight-tour scene; they do not
  represent or mutate live galaxy or player-fleet state.
- Camera orbit and fly-by maneuvers remain part of the existing abortable,
  resumable spatial navigation path; completed maneuvers now persist the
  camera's actual final position so a resumed tour cannot snap back to the
  pre-orbit arrival point.
- Tour approaches now frame bodies and ships by apparent size and route around
  intervening bodies; interactive planet zoom distances remain unchanged.
- Persisted planet-ring profiles now reach both the start-page flight preview
  and the regular in-game system payload, and are drawn as inclined,
  composition-tinted annuli in the active WebGPU scene.
- The in-game system payload now includes up to two deterministic asteroid-belt
  descriptors for suitable planetary gaps. The WebGPU renderer samples each
  belt with a 512-particle scene-wide cap and distance-based LOD; belts remain
  visual data and do not create resource-bearing celestial-body records.

### Fixed — Renderer ownership and disposal

- Fleet endpoint frame observers now invalidate captured callbacks before
  attempting hook removal. Stale callbacks cannot publish after remove/dispose,
  even when removal fails. A failing initial projection rolls back its hook
  registration and reports cleanup failures together. Failed removal remains
  retryable through the returned disposer or repeated adapter destruction.
  Per-frame projection failures disable the observer and are reported once.

- Galaxy camera-move frame hooks now invalidate captured callbacks before
  attempting removal. Superseded or disposed moves cannot mutate camera state,
  even when hook removal fails. Invalid frame deltas and pose/update failures stop
  the move and report the error rather than repeating on subsequent frames.

- Colony bridge camera controls and snapshot refresh now require a live colony or
  building view outside transitions. UI events arriving during exit or after a
  renderer replacement/disposal are ignored rather than reaching stale instances.

- Owner abort signals now close initialized colony zoom runtimes and cancel
  pending flights without another frame. Disposal and initialization failure
  remove the abort listener; abort cleanup errors use the configured error
  callback. Explicit galaxy teardown disposes before aborting the owner signal,
  preserving synchronous cleanup error propagation.

- Colony bridge back/ancestor navigation now invalidates pending surface loads,
  preventing late responses from reopening a departed view. Refused overlapping
  approaches preserve the accepted flight and revision. Surface entry requires a
  confirmed planet prerequisite and an idle transition; return payloads are only
  committed after successful entry. Browser and GPU-ownership regressions cover
  cancellation and fresh retry.

- Active camera flights now reject invalid frame times instead of hanging or
  producing invalid poses. Driver position/target/control updates run before
  flight success is committed; their failures reject the pending promise even
  on the final frame. Reentrant disposal/replacement stops further camera writes.
  Missing active driver contexts now report an explicit error.

- Planet/building flight setup now validates inputs and control points before
  replacing a running flight. Failed setup preserves its pending promise,
  progress and callbacks; non-finite endpoints, duration and blur are rejected.
  Setup target providers cannot resurrect disposed flights or overwrite a newer
  reentrant flight. Options/colliders are snapshotted while live targets remain live.

- Camera flight callback failures now reject the waiting transition and propagate
  to the frame caller, including failures on the completion frame. Flight success
  waits for all frame calculations and effects. Completion/failure releases target,
  collider and effect references; callbacks no longer leak into subsequent flights.
  Reentrant cancellation/replacement stops the retired frame's remaining effects.

- Replacing an active renderer now detaches it from rendering and navigation,
  clears camera state and cancels pending flights without publishing a stale
  entry. Building depth uses its surface registration. Cleanup attempts remain
  independent on errors; invalid registrations preserve the live view.
  The colony bridge reports cancelled entry as unsuccessful. Real renderer
  GPU-ownership tests and browser wrapper remount cycles cover replacement.

- Pending scene preloads and view transitions now verify cached renderer identity
  after initialization, outgoing exit and incoming entry. Replaced instances
  cannot consume late scene data or become active again; replacement registrations
  remain usable, including after a retired initialization fails.
  Camera/colony fixtures now use actual registry registrations.

- Full view transitions now stop after disposal triggered by exit notifications,
  transition-source setup, navigation binding or backend activation. Closing
  during these callbacks cannot rebind/enter a disposed view or start a camera
  flight after its cancellation, leaving a navigation promise pending.
  Browser wrapper cycles also cover closing from exit notifications.

- Live building-detail transitions now use transition-error cleanup for camera
  and event callback failures, releasing the shared surface under its actual
  colony registry level and allowing a fresh retry. Invalid/foreign building
  targets are validated before mutation and preserve the usable surface.
  Disposal from an exit callback cannot republish building depth.

- Renderer navigation bindings now belong to a specific view entry. Retained
  handlers cannot navigate or emit slot selections after exit/re-entry, during
  a transition or after disposal. Failed incoming initialization preserves the
  current view's valid bindings; live building-detail navigation still reuses
  the colony surface without additional GPU allocations.

- Renderer-triggered building, landing and back navigation now routes rejected
  transitions through the orchestrator's configured `onError` callback, wired
  to the colony bridge and game-view recovery. DOM callbacks no longer leave
  transition failures unobserved. Direct zoom calls keep rejecting to callers;
  without an error callback renderer navigation also retains its rejection.

- Orchestrator event dispatch now notifies a stable listener snapshot and
  reports aggregated callback failures instead of silently swallowing them.
  Its owned RAF loop disposes and surfaces render/cleanup failures rather than
  continuing indefinitely; disposal during a frame cannot schedule another RAF.

- Orchestrator initialization is shared across concurrent/repeated callers,
  preventing duplicate backend initialization and frame hooks. Factory-created
  backends are owned and disposed, including when creation resolves after
  teardown; injected backends remain borrowed. Disposal clears backend/canvas/
  option references and cannot restart a late RAF loop.

- Zoom-level renderers now dispose only renderer instances they created; shared
  orchestrator backends remain owned by the bootstrap caller.
- Registry replacement and cleanup dispose cached views, attempt all cleanup
  operations, and report aggregated failures. Cancelled asynchronous renderer
  initialization can no longer republish an already-disposed shared instance.
- `GQAudioManager.dispose()` now idempotently stops active media, detaches its
  event listeners, clears delayed SFX and fade work, stops procedural
  oscillators, and closes its owned `AudioContext`; cleanup failures are
  surfaced as an aggregate error.
- Audio teardown now removes media sources and reloads the elements to release
  their buffers, deduplicates external TTS tracking, and shares pending context
  shutdown (including failures) between all disposal callers.
- CI now runs browser lifecycle regressions with real media and audio contexts
  over eight cycles, checking native listener removal via Chromium DevTools;
  sixteen zoom cycles also check borrowed-backend ownership, frame hooks and
  RAF cancellation without requiring a GPU.
- In-game galaxy teardown now clears spatial-label callbacks, releases mouse
  and touch captures, and attempts all cleanup and menu-return steps even if
  an observer or zoom renderer fails. Observer unsubscribe is idempotent.
- Colony zoom removes its published global even when disposal fails; rendering
  and cleanup failures are reported together. CI also exercises eight mounts
  of the actual galaxy adapter and spatial scene with an injected renderer,
  checking native canvas listeners and frame hooks, including failed teardown.
- Colony surface exit/disposal now releases a pointer capture owned by an
  unfinished drag. Resource-contract tests run the real planet/surface classes
  through six game-bridge lifecycles and require exactly-once destruction of
  every allocated buffer/texture without destroying the borrowed device.
- A native WebGPU counterpart is wired into the shader-validation workflow on
  `develop`/`main` zoom changes, with missing adapters treated as CI failures.
  Native GPU execution remains unverified on local machines without an adapter.
- Planet and colony disposal now use synchronous view cleanup instead of
  discarding an asynchronous exit promise. Stream, input and GPU destruction
  failures are aggregated after all remaining cleanup attempts; failed terrain
  cache destruction no longer prevents later entries from being released.
- Failed input cleanup during colony departure bypasses the animation and
  completes teardown immediately, reporting the original failure.
- Pending planet/colony entries no longer reactivate a view after a newer
  entry, exit or disposal. Late colony initialization cannot restore disposed
  scene resources; disposal rejects subsequent initialization and entry.
- Superseded colony departure animations settle their waiting callers without
  clearing newer view resources or leaving overwritten animation promises pending.
- Scene preloading and zoom transitions now share pending level initialization.
  Failed initialization evicts and disposes the partial renderer immediately,
  preserving the registration for a fresh retry and the previously active view.
  Cleanup failures are reported together with the initialization error.
- Exited views are no longer rendered while the next view's entry is pending.
  Failed exits, entries and camera flights release failed cached instances,
  clear active zoom/camera state and preserve registrations for retry.
  Partial colony HUD, input and GPU resources are disposed immediately;
  cleanup and backend-reset failures are aggregated with the transition error.
- The game adapter now restores system camera controls when zoom setup fails
  or a failed transition leaves no active view. Recovery still frames the
  system if zoom disposal fails, reporting both causes afterward.
  Data-loading failures preserve an existing usable view, and obsolete
  ancestor-navigation failures cannot reset a newer planet selection.
  The Chromium lifecycle gate also checks recovery and a fresh zoom mount.
- Rendering failures now attempt both disposal and system return before reporting
  all failures together. A throwing return callback no longer hides the original
  render error; a throwing error reporter propagates both causes.
  Pending camera flights and colony entries settle during this cleanup even
  when system recovery fails, and disposed frame hooks cannot report twice.
- Terrain requests now recheck cancellation after CSRF body decoding and before
  posting, preventing late token responses from starting work after disposal.
  Terrain disposal releases manifest, token, LOD planning and CPU caches before
  aborting the request, so cancellation errors cannot retain those resources.
- Superseded colony snapshot responses are discarded before body decoding and
  checked again afterward. Legacy building fallback failures and unsuccessful
  responses now update the HUD and existing error channel instead of failing
  silently; late fallback failures cannot alter a re-entered view.
- Terminal planet/colony disposal now clears retained scene snapshots,
  navigation callbacks, terrain/material references and colony CPU geometry,
  including when GPU cleanup fails. Terrain streams release their view callback
  and the bridge clears its current payload. Normal exit retains reusable scene
  data; disposed renderers reject new data and navigation bindings.

### Changed — Read paths without queue completion side effects

- Selecting an owned colony as a fleet origin now enters 3D target picking
  immediately. The mission and ship/cargo composition remain an explicit
  confirmation step, and dispatch continues through the server-authoritative
  fleet API.
- Fleet dispatch now shows a three-step progress indicator, clearer target
  picking instructions, and a direct keyboard coordinate-entry alternative.
  Launch remains disabled until a complete destination is selected.
- Fleet composition includes local actions to select all currently available
  ships or clear the ship selection. These only edit the draft; dispatch still
  requires the explicit server-checked launch action.
- Per-ship plus/minus controls now adjust draft quantities within the loaded
  inventory limit and expose labeled, touch-sized actions.
- Each ship type also has an individual maximum-selection action, allowing
  focused composition without selecting every available ship type.
- The launch action remains disabled until a complete destination and at least
  one valid ship are selected. Missing ship selection is explained inline and
  blocked before an unnecessary API request; server validation remains final.
- Mission selection now displays concise, mission-specific guidance for
  transport, attack, espionage, colonization, harvesting, and surveys, while
  leaving mission eligibility and outcomes to server rules.
- Fleet origin can now be changed from the command overlay by picking another
  owned colony in the 3D scene. The flow resumes target selection after the
  origin change, supports Escape cancellation, and sends no command while
  picking.
- The planned route now includes the selected system and planet names for
  3D-picked destinations alongside coordinates. Editing coordinates clears
  the display name to avoid showing stale location details.
- Origin picking now also offers an accessible list of the player's own
  colonies, labeled with names and coordinates, as an alternative to selecting
  the colony in the 3D scene.
- Target picking now lists planets from the currently open star system as
  accessible, touch-sized actions. Players can use the list or direct 3D
  picking; coordinates remain available for other systems.
- Fleet target picking now omits system entries without a positive safe-integer
  planet position and ignores invalid direct scene selections. Malformed
  location data can no longer create an unusable fleet destination.
- The in-system target picker now offers a direct, keyboard-accessible switch to
  coordinate entry. It preserves any existing destination draft and focuses
  the galaxy field without issuing a fleet command.
- The route preview now keeps a one-action destination-clear control available
  for partially entered coordinates as well as complete targets. Clearing the
  target leaves the selected ships, mission, and cargo unchanged.
- Origin picking now has a visible cancel action in addition to Escape.
  Cancelling returns keyboard focus to the origin control; target-picker
  cancellation likewise restores focus to its route action.
- The fleet-command step indicator now tracks live coordinate validity:
  incomplete or out-of-range destinations keep the target step active, and
  only a valid destination advances to fleet review.
- While the target picker navigates to another star system, it now replaces
  the old system's planet actions with an explicit loading status. This avoids
  presenting stale destinations during the server read.
- Target-picking instructions now distinguish double-clicking a system in the
  3D scene from single-selection in the system list, matching the actual
  navigation controls.
- If system navigation fails during target picking, old-system planet actions
  remain hidden and the picker surfaces the server error with coordinate-entry
  and alternate-system guidance.
- The fleet-order progress indicator now correctly marks origin selection as
  the active step when changing the origin mid-draft.
- The 3D destination picker is now placed inside the route's destination card
  and changes its label to "change destination" once a target has been chosen.
- A selected destination can be explicitly removed from the draft without
  discarding the origin or fleet composition; dispatch stays disabled until a
  new complete destination is selected.
- Origin changes are now initiated directly from the route's origin card, so
  source and destination controls both sit with their corresponding endpoint.
- The fleet draft summary now shows the total number of valid selected ships
  and flags invalid quantities without estimating cargo capacity or clearance.
- Each ship card now shows its selected quantity against available stock and
  flags invalid quantities locally, including after quick-selection actions.
- Each ship type now has a dedicated clear-selection action that can also
  recover invalid quantities without affecting other selected types or cargo.
- Cargo can now be cleared from the draft with one local action while keeping
  the route, mission, and selected ships unchanged.
- Each cargo resource can now be cleared independently, including to recover
  from an invalid value without changing the other resources.
- Invalid cargo quantities now disable launch with an inline explanation and
  recover immediately when corrected; server validation remains authoritative.
- Invalid quantities for any ship type now also disable launch even when other
  ships are valid, with a specific inline inventory/integer correction hint.
- Ship quantity inputs now expose invalid state and link to a precise,
  screen-reader-readable range or whole-number hint.
- Cargo inputs now expose invalid values accessibly and link to a concise
  non-negative-number hint that clears as soon as the value is corrected.
- Clearing all cargo now also synchronizes each resource's clear-button state.
- The mission selector now references its live mission-specific description
  for assistive technologies.
- Target coordinate entry now validates the same integer ranges as the server,
  marks invalid fields accessibly, and blocks dispatch until corrected.
- Partial coordinate targets now explain that galaxy, system, and position
  must all be provided before dispatch can be enabled.
- Missing coordinate fields in a partially entered target are now marked
  invalid and linked to that completion hint.
- Selecting an origin from the accessible colony list now focuses the 3D scene
  for the following target-picking step.
- Starting target picking from the route card now also focuses the 3D scene;
  cancelling returns focus to the command overlay.
- Cancelling origin or target picking now returns keyboard focus to the
  corresponding route action.
- The origin picker now distinguishes an empty owned-colony list from session
  data that is not currently available.
- Changing the origin now preserves the destination, mission, and cargo draft
  while clearing ship quantities tied to the previous colony's inventory.
- Multi-mode generation queue status GETs no longer scan generated files or
  persist completion state. Queue creation requires authentication and CSRF;
  status reads require authentication and are scoped to the owning user.
- The legacy generation queue no longer falls back to user 1; creation is
  authenticated and CSRF-protected, and status reads are owner-scoped.
- Terrain GETs no longer persist manifests, compatibility upgrades, or tiles.
  The WebGPU terrain client materializes cached terrain through authenticated,
  CSRF-protected POST requests.
- Procedural texture GETs now read existing cache files or render response
  bytes in memory; cache misses no longer create directories, lock files, or
  persistent texture files.
- Market buy and sell mutations explicitly require POST before CSRF
  verification; price, history, and event reads remain GET-only.
- Trader event dispatch now allows GET only for status and requires POST plus
  CSRF for market updates, scans, decisions, route mutations, and game ticks.
- Trader opportunity, trader, route, and market-analysis reads now explicitly
  require GET.
- Trader list and status handlers were traced through their helper calls:
  supply/demand recalculation (which settles legacy production), opportunity
  cleanup, and route processing remain behind explicit POST/background paths.
- Alliance-war list/status and diplomatic-play trust/threat reads were traced
  through their SQL helpers; expired peace offers remain response projections,
  and these GET paths do not persist alliance or diplomacy state.
- NPC controller status/summary/decision reads and their diagnostics helpers
  remain read-only. The signed NPC worker API rejects GET before opening the
  database or consuming replay-protection nonces; claim/completion stays POST.
- Galaxy visibility expiry is now projected as stale by the GET helper without
  updating `player_system_visibility`. Targeted deterministic system/planet
  materialization remains a documented lazy-catalog behavior; system detail
  views still record visit intel for fog-of-war.
- Fleet and FTL list/status/map GETs were traced through their route and
  coordinate helpers; they do not advance arrivals, consume wormhole stability,
  mutate cooldowns, or write travel state. Arrival handling remains explicit
  POST plus CSRF.
- Persistent terrain manifest and tile endpoints were traced through
  `BodyTerrain`: GETs may compute uncached terrain in memory but do not persist
  manifests, tile rows, or legacy manifest upgrades. Cache persistence is
  POST+CSRF; planet materialization remains within fleet arrival missions.
- Trader dashboard queries require GET before database access.
- The admin generation-queue monitor explicitly requires GET before admin
  authentication and database access.
- Game guide reads now require authentication and GET; write actions require
  POST plus CSRF. Greeting reads and guide construction no longer initialize
  database rows or cache directories.
- Game guide direct-help eligibility now reads its persisted usage counter;
  NPC behavior-script and context readers treat only missing optional tables
  as fallbacks and propagate other database errors.
- Tutorial checkpoint writes and contextual NPC quest generation no longer
  report success or empty results when database operations fail; optional NPC
  trigger reads fall back only when their table is absent. The existing
  contextual-trigger column/query mismatches against the canonical schema
  remain an open feature/schema task.
- Autonomous fleet-command hostility checks now propagate database errors
  instead of interpreting failed alliance/war lookups as safe territory.
- NPC PvE decision cooldown checks now propagate database failures and fail
  closed on malformed decision timestamps instead of bypassing the cooldown.
- NPC async-queue schema probes no longer collapse database errors into
  "queue unavailable" (and a synchronous LLM fallback); metadata is checked
  per supplied connection rather than cached across connections.
- NPC trader ticks check their optional schema before consuming the global
  cooldown; only a genuinely missing table is skipped. Worker nonce-table
  probes now propagate backend failures rather than misreporting missing
  schema.
- NPC faction ticks no longer turn behavior-script database failures into an
  LLM or default-action fallback.
- Planetary event ticks only consume their cooldown after successful processing;
  inserting an event, its one-time reward, and its player message is atomic, and
  duplicate event attempts do not grant duplicate rewards. The message insert
  now matches the canonical `messages` schema.
- Global faction-event expiry/revert or activation, state updates, faction
  modifiers, and broadcast messages now share one transaction/savepoint, so a
  failed phase cannot leave a partially applied galaxy-wide event.
- Daily faction-quest generation no longer hides faction/template/insert
  failures or consumes its 24-hour cooldown after a partial run. The whole
  generation batch now rolls back atomically on failure; quest-template YAML
  fallback is limited to a missing optional template table.
- NPC behavior context and contextual quest checks now query canonical user,
  diplomacy, colony, and battle-report data instead of obsolete inventory,
  standing, threat, or trade-offer columns. Contextual quest writes use the
  canonical quest shape and commit with their audit log atomically. Amount
  scaling no longer inflates standing or rank-point rewards. Trade-route
  disruption remains disabled because no persisted disruption event exists;
  contextual triggers remain unwired pending lifecycle acceptance.
- The global NPC-account tick now writes its cooldown only after every selected
  NPC account succeeds. A failed account query is no longer treated as an empty
  successful tick.
- Per-user NPC, trader, and wormhole cooldowns are now recorded only after their
  corresponding core work succeeds. Trader route and decision handlers rethrow
  database errors instead of marking routes failed or silently skipping decisions.
  Trader route processing and wormhole regeneration now commit their state and
  cooldown together, rolling back partial work on failure.
- Scenario-engine ticks now commit scenario resolution/seeding/start and the
  hourly cooldown atomically. Database errors in scenario reads, conditions,
  starts, and effects propagate to simulation metrics instead of being treated
  as ineligible scenarios or logged-and-continued success.
- Scenario YAML read/parse failures now abort and roll back the tick rather than
  silently skipping a scenario and consuming the hourly cooldown. Non-database
  failures in scenario resolution, starts, conditions, and effects also propagate.
- Simulation subsystem run timestamps are now written only after a successful
  subsystem execution, and global/user simulation cooldowns advance only when
  every subsystem in that tick succeeds.
- The simulation tick CLI now rejects unknown, duplicate, malformed, and
  contradictory options before loading application configuration or connecting
  to the database. Isolated help and valid global/user options remain supported.
- Simulation workers now report `GET_LOCK()` errors explicitly: only a `0`
  result means another worker owns the lock; `NULL` and unexpected values fail
  the tick before any simulation operation runs.
- The simulation tick HTTP endpoint now rejects unknown scopes, malformed
  user IDs, conflicting global/user options, and non-boolean `force` values
  with HTTP 400 instead of silently coercing them into a different request.
- Failed simulation subsystems now produce an HTTP 500 or CLI exit code 2
  rather than a success-shaped response. Lock/cooldown skips remain normal
  results, and public responses no longer include raw subsystem exception text.
- The global simulation no longer reprocesses unread "Pirate Raid!" messages as
  new raids. NPC faction ticks already apply raid effects before sending those
  notifications; repeated interpretation could apply additional random damage.
  Resolution is disabled until a dedicated idempotent raid queue exists.
- War attrition is disabled until an authoritative war-party troop inventory
  exists. The previous tick recorded fixed placeholder losses without reading
  or changing actual combat units, so it now performs no writes instead of
  reporting fictitious attrition.
- Global NPC accounts, faction events, scenarios, colony events, and wormhole
  maintenance now run as one `npc_world` subsystem under the global simulation
  lock. Per-user NPC ticks no longer invoke those shared world mutations.
- The NPC controller's manual `run_once` action now uses the per-user
  simulation lock and reports busy-lock skips instead of claiming the tick ran;
  both settings panels show skipped runs as informational notices.
- NPC player account actions now commit per account with a matching completion
  marker. If a later account fails, a normal global retry skips accounts already
  committed during the three-minute cooldown; forced runs still bypass it.
- Successful global and per-user simulation cooldowns now start when execution
  completes, rather than at tick start, so long ticks cannot consume their own
  cooldown while they are still running.
- The live overview payload builder no longer exposes a legacy switch that
  could run simulation, achievement, or faction-pressure mutations. Those
  actions remain on explicit tick/mutation paths.
- Manual pirate-faction ticks now use the per-user simulation advisory lock;
  lock contention is returned as an unexecuted skip and shown informationally.
- The administrative trader full-cycle action now shares the global simulation
  advisory lock, preventing overlap with scheduled trader route processing.
- The separate trader action tick now shares that global lock, preventing its
  route transitions and trader decisions from overlapping other global ticks.
- All individual administrative trader mutation events now share the same lock;
  successful responses identify execution, while lock contention returns a
  skipped result without running the mutation.
- The on-demand fleet-arrival sweep now uses its own advisory lock to prevent
  parallel requests from processing the same due-fleet set simultaneously.
- Fleet recalls and arrival processing now lock and recheck the same fleet row
  transactionally, preventing a recall from racing with a stale due-arrival
  snapshot.
- Situation progress ticks now lock active rows inside a transaction before
  calculating progress, preventing concurrent requests from applying elapsed
  time more than once.
- Situation approach changes and manual resolution now lock the same row while
  validating status and applying updates, preventing stale concurrent writes
  against an in-flight progress tick or resolution.
- Ship-build completion now locks its colony row and commits queue completion,
  ship creation, and starting the next queue item atomically, preventing
  concurrent actions from granting the same completed build twice.
- Combat previews now include due ship builds through a read-only projection
  instead of completing the authoritative shipyard queue as a side effect.
- Manual autonomous leader actions now share the per-user simulation advisory
  lock; lock contention is reported as a skip instead of running concurrently.
- Game guide browser requests now use the same-origin session cookie and fetch
  a CSRF token when one is not already available; legacy bearer-token headers
  are no longer sent.
- Registration catalog, preview, and status GETs no longer initialize the
  registration-owner session value; draft mutations initialize it on POST.
- Audited faction relation/event and colonization read paths: faction dialogue
  effects remain POST-only, and colonization GET handlers plus sprawl/edict
  read helpers do not persist state.
- Trade route and goods-flow/suggestion reads now explicitly require GET;
  route, proposal, and suggestion mutations explicitly require POST before CSRF.
- Market price/history/event reads and market mutations enforce GET/POST
  respectively. A colony-scoped price GET settles only after verifying colony
  ownership; regional price projections read the last-settled market snapshot.
- Building and shipyard queue list GETs were rechecked: they display queue
  state without completing items or advancing the next queue entry. Resource
  settlement remains separate from queue completion.
- Spy and battle report GETs were rechecked: handlers and report-hydration
  helpers read/transform data without persisting state.
- The colony-economy macro GET reads the last-settled market projection only;
  the owner-scoped snapshot GET remains the explicit lazy-settlement contract.
- Legacy economy overview and production GETs now invoke that owner-scoped
  settlement once per colony when the on-demand economy is enabled; the
  tick-based settlement helpers remain in the disabled legacy branch.
- Shipyard and building list GETs were rechecked through their queue helpers:
  expired work is not completed or advanced while reading. The vessel list no
  longer turns arbitrary database failures into a successful empty response;
  canonical schema checks and query errors now propagate explicitly.
- Pirate status, recent-raid, forecast, countermeasure, and contract-list GETs
  were traced through their helpers and remain read-only. Pirate faction ticks
  are restricted to the explicit POST action, which verifies CSRF before
  loading factions.
- The colony-resources GET settles an owned colony once from `last_update` on
  cache miss; ownership is verified before lookup, while cache hits return
  without settlement. This remains a lazy economy read, not a simulation tick.
- Game health and leaderboard GETs were traced through their helpers. The
  health route's star-schema guard reads metadata only; neither route writes
  game state or runs a simulation tick.
- War status, active-war list, supply status, intelligence, and goal-progress
  GETs and their shared query/projection helpers were rechecked as read-only.
  Expired peace offers remain projected in responses, not persisted on reads.
- The Ollama status GET only requests the local model catalog through `/api/tags`;
  it does not invoke chat/generation or persist state.
- Ship-component prompt and geometry/texture reference endpoints now explicitly
  enforce GET; all responses are assembled from the in-memory prompt catalog,
  with no file, database, or generation writes.
- TRELLIS2 runtime monitoring now requires an authenticated admin GET before
  making service, database, or container-stat queries; queue reporting stays
  read-only.
- Texture-admin cache listing and statistics were traced through their file
  scans: they do not mutate cache files, and listing failures now return an
  explicit error instead of appearing as an empty cache.
- Authenticated user-quota reads no longer report free-tier defaults as a
  successful result when the quota database query fails; they return an
  explicit service-unavailable response.
- TRELLIS2 queue-status reads are owner-scoped in SQL and now include terminal
  jobs; queue position/count are calculated over the active queue, and database
  errors no longer masquerade as missing jobs.
- TRELLIS2 user-quota reads now select every field consumed by the endpoint,
  apply defaults for missing quota rows, guard zero storage limits, and return
  an explicit unavailable response for database or missing-view failures.
- TRELLIS2 design GETs now scope the database lookup to the authenticated
  owner before returning data and no longer read the unexposed design JSON
  file; database failures are distinct from not-found responses.
- TRELLIS2 asset-generation GETs now apply owner filtering in SQL and keep
  terminal statuses readable; database errors return an explicit unavailable
  response instead of a misleading not-found result.
- TRELLIS2 design-list and generation-history manager reads now enforce owner
  boundaries across joined records, filter deleted rows, and clamp pagination
  to a bounded range without mutating state.
- Generation queue v2/v3 polling now explicitly rejects unsupported methods
  and returns generic service errors for database failures rather than
  exposing exception details to clients.
- The admin generation-queue monitor now logs internal exceptions but returns
  a generic error response instead of exposing database exception messages.
- Texture-AI status/queue GETs no longer create cache or lock directories
  during service construction; directory creation is deferred to cache-miss
  generation requests.
- TRELLIS2 queue-status reads now select the generation ID and failure message
  already exposed by the endpoint; implementation notes reflect the current
  owner-scoped manager method signatures.
- TRELLIS2 REST writes now enforce POST and session-backed CSRF before dispatch;
  read routes enforce GET explicitly, while authenticated API-key clients retain
  their header-based non-cookie flow.
- Economy read handlers now explicitly require GET, while every policy,
  production-method, and population-policy mutation requires POST plus CSRF.
  The population-class GET validates its method before performing lazy settlement.
- Population-policy mutation now parses the JSON body used by its browser API
  client instead of reading form-only `$_POST` fields.
- TOTP setup already required POST and CSRF before storing a pending secret;
  its stale GET documentation is corrected and the route contract is tested.
- Authentication GETs (`csrf`, `me`, dev-tools status, TOTP status, and
  registration reads) were traced through their handlers. They do not tick or
  mutate gameplay state; CSRF session initialization and remember-me auto-login
  session/token rotation are intentional authentication lifecycle writes.
  Remember-me rotation on `me` is covered by the cookie integration test.
- Research list GETs and prerequisite evaluation were rechecked as read-only;
  due research completion remains behind explicit POST plus CSRF.
- Server announcement listing, user quota, and admin statistics GETs were
  rechecked: they read database state without persisting or deleting data.
- Situation lists and NPC-controller status/summary/decision reads were
  rechecked as non-ticking; situation and NPC ticks remain explicit POST actions.
- Cache-diagnostics summary, scope, hook, and system-info GETs were rechecked
  as read-only; cache clearing and metrics resets require POST plus CSRF.
- Generation-queue polling and admin monitor GETs were rechecked as read-only;
  status reads remain scoped to the owning user, and the monitor is GET-only.
- Audio catalogs, TTS status/voice listing, and the LLM profile catalog were
  rechecked as read-only; TTS synthesis remains POST plus CSRF.
- Leader listings, marketplace reads, advisor hints, and alliance list/detail/
  relation/message reads do not generate, refresh, or mutate game state.
  Marketplace refresh and advisor analysis remain explicit POST+CSRF actions.
- Agreement and diplomatic-play list reads, faction relation/graph reads, and
  generated diplomacy-event reads were rechecked as non-persisting GETs.
- Message user-search/inbox and glossary definition GETs do not change state;
  marking messages read and glossary generation remain explicit POST actions.
- Achievement list GET reads progress without seeding or re-evaluating it; its
  optional read-through cache fill is separate from durable game-state writes.
- SSE event polling and Prometheus metrics collection use read-only queries and
  now reject non-GET requests explicitly.
- Documented and regression-tested the intentional overview GET exception:
  only a live-cache miss settles owned colony resources from `last_update`;
  this does not execute simulation ticks or persist the durable projection.
- Admin user list/detail and TRELLIS2 admin stats, queue, quota, audit-log,
  analytics, and health reads were verified as non-mutating; CSV export writes
  only to the response stream.
- Shipyard faction-affinity reads now degrade only when the optional v3
  migration table is missing; other database failures propagate instead of
  silently removing affinity data from module lists and calculations.
- TRELLIS2 API-key verification now logs database failures and returns HTTP
  503 instead of conflating backend failures with invalid credentials (401).
- The `auth.php?action=me` faction-quest badge treats only a missing optional
  migration table as empty; other database failures now propagate to the API
  error handler rather than returning an incomplete badge as success.
- Cache-diagnostics admin authorization no longer converts database errors to
  a non-admin result (403); failures now reach the API error handler, while
  successfully queried non-admin users remain forbidden.
- The fog-of-war schema probe no longer converts arbitrary database errors
  into the legacy full-visibility fallback. Genuine absence of the optional
  table still retains the documented legacy behavior.
- Galaxy owner-color schema detection now propagates database failures instead
  of silently dropping player empire colors; an actually absent optional
  column still uses the established default color.
- Politics status no longer masks arbitrary database failures as neutral
  species, government, civic, faction, or unrest effects. Only missing
  optional tables retain the documented neutral fallback.
- The SSE world-event reader ignores only a genuinely missing optional
  migration table; other database failures reach the stream's existing
  poll-error logger instead of silently omitting world events.
- Prometheus metrics collection logs backend failure details server-side and
  emits a generic error comment plus `trellis2_database_connected 0`, not the
  raw exception message.
- Ship-designer catalogs, base-asset/avatar reads, and vessel/wireframe design
  loads are GET-only and do not persist game data; base-asset read-through cache
  filling is non-durable. The prompt-generation method documentation was aligned
  with its POST handler.
- Faction-validation debug reports now explicitly reject non-GET requests and
  read the YAML source without persistent side effects.
- Registration catalog/preview/draft-status and portrait status/image service
  paths were traced through their repositories: they read only, do not create
  an owner token, and project expired portrait leases without updating rows.
- Removed an `INSERT IGNORE` diplomacy backfill from the planet-intel GET
  helper; missing standing rows now use the existing `COALESCE` default only.
- Building and shipyard queue completion no longer runs inside list GETs.
  The runtime invokes dedicated CSRF-protected POST actions before refreshing
  those lists; lazy colony resource settlement remains a separate contract.
- Colony building layout and slot-info GETs no longer settle economy or
  complete due upgrades; their API client now calls an explicit CSRF-protected
  settlement POST before reading.
- Single-player and alliance-war status GETs now report expired peace offers
  through read-only SQL projections instead of updating offer rows; POST
  handling retains persistence where needed.
- Trade-proposal list GETs now project expired status without globally
  updating proposal rows; proposal actions still validate expiry.
- Achievement progress is checked through its existing CSRF-protected POST
  before the quests view reads the list; the list GET itself is read-only.
- Leader marketplace candidate generation now uses a CSRF-protected POST,
  serialized by the user row; marketplace listing GETs only read active rows.
- Colonization sprawl status now calculates its response without writing the
  persistent sprawl cache from a GET request.
- Faction and faction-quest list GETs no longer backfill diplomacy or quest
  seed rows; existing read fallbacks and migration-seeded quest content remain.
- Politics catalog, preset, and status GETs no longer create default profile
  or civic rows; the status loader provides an in-memory default only when no
  profile row exists. Politics database errors now propagate to the API's
  explicit generic error handler instead of appearing as empty/default data.
- Empire stability-score GETs now query the canonical war participant columns.
  The former query used nonexistent column names and swallowed the SQL failure,
  incorrectly reporting active-war penalties as zero; required schema failures
  now propagate instead of appearing as a valid score.
- Empire diplomacy scores now use the same effective standing as faction
  reads: persisted player standings override each faction's base standing, and
  missing player rows inherit that base instead of being omitted.
- Ship-designer faction-template GETs no longer convert missing or unreadable
  faction specs into a successful empty response; the existing API error
  handler now reports the invalid/unavailable faction explicitly.
- Ship-designer base-asset GETs may populate the existing file-backed
  read-through cache for 3600 seconds. This is a persistent cache write, not a
  database/game-state mutation; the roadmap now records that distinction.
- Achievement-list reads no longer hide faction-quest query failures as an
  apparently successful list with missing quests; database errors propagate
  through the API error handler.
- Game-guide tutorial-progress GETs no longer translate database failures
  into a successful empty progress list.
- LLM prompt-catalog reads no longer hide database query failures as an
  apparently successful file-only catalog.
- NPC-controller status reads no longer report zero cooldown/decision counts
  when their database queries fail.
- Trader-dashboard GET failures are logged without returning exception details
  to the client; the endpoint responds with a generic 503.
- NPC-trader endpoint failures likewise return a generic 503, while periodic
  tick and trader creation remain POST+CSRF-only.
- Legacy generation-queue polling and creation log backend exceptions without
  exposing database details; unavailable queue service returns HTTP 503.
- Faction-quest seed backfill no longer suppresses database/schema failures
  during quest actions.
- Glossary RAG failures are logged without exposing exception details in the
  API response.
- Trader-event status failures are logged and returned as a generic HTTP 503,
  rather than exposing database exception details.
- Vessel-design endpoint failures now catch all throwables and return a generic
  HTTP 503 without exposing backend details.
- Generation-queue v3 submission logs database failures but returns only a
  generic service-unavailable response.
- NPC chat logs Ollama/backend failures without forwarding their details;
  invalid agent types remain client errors.
- TRELLIS2 admin read endpoints log backend exceptions and return specific but
  non-sensitive failure messages instead of raw exception details.
- Wireframe API handlers log exceptions and return generic operation failures,
  never raw exception text.
- Texture-admin handlers, including the list/cache-statistics GETs, now log
  exceptions without returning backend details to the client.
- Texture-AI status and queue GET handlers also map all throwables to their
  logged, generic service-unavailable responses.
- Production roadmap records the deferred TRELLIS2 refinement job-contract
  mismatch: creation writes `trellis2_refinement_jobs`, but polling/finalization
  read `trellis2_generation_queue`, and no refinement-table migration exists.
- Read-only alliance and situation schema guards remain before request dispatch.
  Regression contracts verify guard placement and prohibit runtime DDL there;
  broader app-user DDL denial and schema-diff evidence remain open.
- Trader tick and trader creation actions now reject non-POST requests and
  verify CSRF before beginning mutations. Scheduling the HTTP tick remains
  deferred until the separate worker lease/idempotency work is complete.
- Opening a message now marks it as read through a CSRF-protected POST rather
  than a GET; the update is constrained to the authenticated recipient.
- Diplomatic-play list and trust/threat reads are GET-only, while propose,
  counter, mobilize, and resolve actions now require POST and CSRF validation.
- Faction-relations standing and trust/threat GETs no longer insert default
  diplomacy rows; missing standings retain the faction's base default and
  trust/threat reads return neutral in-memory defaults.
- Empire score GETs now calculate live scores without persisting them;
  persistence remains separated in the dedicated write helper.
- Espionage mission-result retrieval now uses POST with CSRF because it may
  release a completed agent; the release is constrained to that user's agent
  and the requested mission. Agent hiring and mission assignment also verify
  CSRF.
- Economy policy reads no longer insert default policy rows; write actions
  retain explicit initialization. On-demand colony settlement is unchanged.
- Global and per-user simulation ticks now serialize through MySQL advisory
  locks; overlapping runs skip the scope, while durable leases and idempotent
  tick records remain open.
- Galaxy read requests no longer advance the global seed batch or initialize
  faction defaults; requested star systems remain lazily materialized.
- Glossary generation now uses POST with CSRF; static definition reads remain
  GET-only.
- Faction-agreement list and catalogue actions are GET-only; proposing,
  responding to, and cancelling agreements now require POST and CSRF.
- TRELLIS2 generation-status GETs no longer download or persist completed GLB
  outputs. A completed job is finalized through a dedicated CSRF-protected POST.
- Overview GETs no longer persist the durable user projection; the dedicated
  projector worker owns that write. The short-lived response cache remains a
  performance optimization. Overview payload computation also defaults to no
  simulation side effects; simulation ticks remain available through explicit
  POST+CSRF actions and the dedicated CLI tick runner.
- Asset-generation GETs now route through the authenticated read endpoint;
  the legacy handler that created asset records while serving a GET is retired.
- TRELLIS2 asset-manager construction no longer creates storage directories;
  directory and design-file creation happens only in the explicit design write.
- Registration narration GETs only serve unexpired cached audio. Cache misses
  synthesize through a CSRF-protected POST, and the onboarding client now uses
  that write method.
- Performance telemetry GETs no longer prune old files; retention pruning runs
  only after a telemetry event is successfully ingested through POST.
- Expired file-cache reads now return misses without deleting cache files or
  rewriting index files; cache index queries filter stale entries in memory.
- Alliance API actions now enforce GET for reads and POST plus CSRF for every
  state-changing action before dispatch.
- Pirate defense-budget updates and contract proposals now verify CSRF before
  reading request data or performing database work.
- War supply-route creation now verifies CSRF after the POST guard and before
  reading request data.
- Enhanced ship-designer customization and TRELLIS2 refinement now verify CSRF;
  the browser client sends its same-origin session token for both operations.
- TRELLIS2 hull, component, and avatar generation now verify CSRF before
  reading request bodies; the integration guide documents the session contract.
- Vessel design creation and generation queueing, plus telemetry ingestion, now
  verify CSRF before reading or persisting request data; designer clients send
  the session token with same-origin credentials.
- AI texture generation and admin cache mutations now use POST+CSRF instead of
  GET; progressive high-resolution upgrades return a request descriptor, and
  texture/admin clients submit generation parameters in JSON bodies.
- The legacy v3 generation queue now requires CSRF for job creation and scopes
  status reads to the authenticated job owner.

### Added — Release metadata quality gate

- `npm run check:release-metadata` validates SemVer in `VERSION.txt` and
  its exact mirrors in `package.json` and `package-lock.json`.
- Tagged metadata preparation requires matching `v<version>` and one dated
  changelog section with real change notes; validated notes are uploaded
  for operator review, without publishing a release or deploying.
- The existing `1.0.0` version is historical metadata, not a production-readiness
  claim. No released `1.0.0` changelog or tag has been invented.

### Retired — Destructive ship-designer initializers

- The legacy PHP initializer and standalone SQL reset no longer drop/recreate
  ship-design, generation-queue or asset tables. Both fail explicitly without
  accessing/changing the database.
- Existing MySQL tables/definitions/rows are preserved in regression coverage.
  Ship-designer persistence remains unsupported until a canonical schema
  migration and API/worker acceptance resolve conflicting legacy definitions.

### Changed — Image publication gates

- Main-branch image publication now waits for all main CI lint, test and E2E
  jobs and scans its local image candidate before registry authentication.
- Trivy HIGH/CRITICAL vulnerability and secret findings block publication,
  including unfixed vulnerabilities. Only the verified, scanned image ID is
  tagged and pushed; there is no second build between scan and publication.
- This hardens the existing development-image path, not a production release
  approval. Live registry evidence and staging/signature/SBOM gates remain open.

### Changed — Docker build context hygiene

- Docker `COPY .` no longer includes local environment material, known session
  dumps, reports, host dependencies or mutable audio/texture caches.
- Required backend/frontend configuration, deployment models, SVG fallbacks
  and legacy gzip bundles are retained.
- A synthetic real-Docker context gate and negative policy regressions verify
  these boundaries in CI without copying actual secrets or publishing images.

### Changed — Fleet arrival processing

- Fleet listing is read-only. Due arrivals are processed through the
  CSRF-protected `POST fleet.php?action=check` endpoint when the resource-scan
  overview requests fleet data.
- Fleet delivery smoke checks now use the explicit POST mutation path.

### Changed — Trade route dispatch

- Trade read requests no longer dispatch due routes. The trade-routes view uses
  an explicit CSRF-protected `POST trade.php?action=dispatch_due` request and
  then reloads the route list without cache.
- Dispatch results report dispatched, skipped and failed route counts.

### Changed — Overview simulation ticks

- Overview GETs always suppress simulation side-effects; the legacy
  `SIMULATION_TICK_ON_READ_ENABLED` setting was removed.
- Explicit HTTP/CLI simulation triggers and lazy colony-resource settlement
  remain separate paths.

### Fixed — Simulation tick failure propagation

- War, attrition, legacy population-satisfaction, pirate-raid and production
  ticks now roll back partial database changes and propagate failures to the
  simulation runtime instead of reporting failed work as successful.
- War-goal progress and war-schema probes no longer hide database failures;
  schema availability is checked against the current connection.
- The per-user NPC cooldown is written only after every global subsystem
  succeeds; global subsystem exceptions now reach the simulation failure path.

### Changed — Daily NPC quest schema alignment

- Added an append-only migration for daily quest offer state, template
  references, generator metadata, and nullable-user global generation logs.
- Daily quest generation now stores canonical requirements and rewards, maps
  supported templates to the quest engine's enum, expires unstarted offers
  after 24 hours, and propagates log/database failures.
- Faction quest discovery and start actions exclude expired offers. The
  generator remains intentionally unwired to automatic production ticks pending
  explicit trigger and end-to-end acceptance.

### Added — Simulation tick metrics

- Each executed simulation subsystem reports duration, time since its previous
  attempt, status and error count in the tick result and structured logs.
- Per-user subsystem timestamps are isolated by user; the first attempt reports
  unknown lag. Metrics retention, dashboards and production alerts remain open.

### Changed — Atomic legacy building upgrades

- Legacy building upgrades now lock the owned colony, conditionally debit
  available resources and commit the queue mutation in the same transaction.
- A stale upgrade level caused by a concurrent request is rejected and rolled
  back. Legacy research starts now use the same ledger and lock the user before
  the colony, preventing concurrent starts across separate colonies and
  rolling back debits if the research state changed. The on-demand economy
  path is unchanged. Legacy ship builds now atomically debit resources, add
  their queue entry and start the next queue item under the colony lock; the
  on-demand shipyard path is unchanged. Legacy fleet launches now atomically
  debit cargo, reserve ships and insert the fleet; FTL and wormhole cooldowns
  are committed with a successful launch. Legacy trade deliveries now debit
  cargo/fuel with the ledger, conditionally reserve processed goods and cargo
  ships, and lock due routes to prevent duplicate dispatch. Legacy market
  purchases and sales now use the ledger's user/colony transaction lock,
  conditional credit and stock updates, capacity checks and atomic market
  records. The on-demand market path remains unchanged.

### Added — Resource mutation concurrency coverage

- CI now runs real MySQL tests with synchronized PHP workers. They verify an
  actual InnoDB lock wait for competing spends and prove that the account lock
  serializes research-like reservations across different colonies. Only one
  coupled mutation commits in each race; rejected mutations roll back.
- Separate HTTP/MySQL race tests cover legacy fleet launches competing for a
  shared ship inventory, shipyard orders competing for a shared resource
  budget, building upgrades, market purchases/sales, and research starts
  across two colonies, plus concurrent dispatch of the same due trade route.
  Requests use independent authenticated sessions and CSRF tokens and prove
  actual InnoDB account-lock waits. Assertions verify single commits and
  rollback of losing resource/ship reservations; competing trade dispatches
  create one fleet, reserve cargo/fuel/freighter once and update `last_dispatch`
  once. The market tests also caught and fixed constants being initialized
  after request dispatch.

### Changed — Isolated CI smoke stack

- Smoke tests now use the built web image without a checkout mount, isolated
  Compose project identities and a database with no host port.
- Database initialization imports only the base schema; canonical migrations
  run inside the image before seeding and browser tests.
- MySQL readiness now waits for TCP rather than the temporary initialization
  socket. Smoke seeding explicitly skips full-galaxy bootstrap while retaining
  schema preflight and the user start region; default seed behavior is unchanged.
- Docker now serves the built Vite entry and hashed assets from Apache's root,
  rather than leaving the compiled entry unused under `dist`.
- HTTP liveness, disabled optional AI paths, failure logs and project-scoped
  unconditional teardown make CI failures explicit without retaining test data.

### Added — Bounded application health probes

- Public session-free `/health/live` and `/health/ready` distinguish PHP
  liveness from DB access plus complete canonical migration tracking; GET/HEAD,
  explicit failure statuses and non-cacheable minimal JSON are tested.
- Readiness is read-only and isolated behind a supervised three-second PHP CLI
  deadline, including DNS/DB stalls; credentials and exception text stay out
  of HTTP output. Gameplay DB connection behavior is unchanged.
- Docker/Compose healthchecks use liveness; CI verifies unavailable readiness
  before migrations and ready status before seed/browser tests.
- Worker health, migration checksum integrity and production observability
  remain separate gates, not implied by a successful readiness response.

### Added — Read-only migration deployment verification

- `php scripts/migrate.php verify` requires existing tracking, a complete
  canonical manifest, matching applied SQL bytes and no foreign history.
- Verification shares the migration advisory lock and checksum helper; it
  never executes migration SQL, bootstraps storage or repairs tracking.
- CI runs the gate from the image after migrations and before readiness/seed.
  Missing, pending, changed or newer-image migration history blocks deployment;
  public health snapshots and existing status behavior are unchanged.

### Added — Append-only migration history CI gate

- CI compares canonical forward migration history with the event's real base
  commit, rejecting removal/reordering and historical Git-clean SQL changes.
- New files must be readable regular forward migrations appended at the end.
  The checker parses the declarative manifest without executing PHP and never
  modifies repository or database state.
- Local Windows checkout normalization is respected; exact deployment MD5,
  down companions, schema diff and release authenticity remain separate gates.

### Changed — Star and binary schema is migration-owned

- An append-only migration adds the generator's `WD` spectral class while
  preserving canonical existing star data; no historical SQL was rewritten.
- Star/binary runtime helpers now read metadata and fail on missing schema
  rather than issuing ALTER/CREATE or caching cross-database success.
- Legacy setup and isolated seed fixtures include the widening before runtime
  access. Automatic down migration is intentionally unavailable because it
  could truncate generated white dwarfs.
- Other runtime DDL remains; this is a partial schema-ownership migration,
  not a production least-privilege or full schema-diff certification.

### Changed — Planet-science schema is migration-owned

- Eleven runtime ALTER paths are replaced by a read-only schema guard without
  cross-database caching; missing columns explicitly require migrations.
- A new append-only migration adds only absent legacy science columns with
  their original defaults and preserves existing definitions and planet data.
  Legacy setup includes the upgrade; historical forward SQL remains unchanged.
- Real MySQL tests cover partial/all-missing schemas, repeat execution and
  SELECT-only runtime access. The actual image applies/verifies 66 migrations,
  seeds the start region and passes HTTP health checks.
- No destructive down migration is provided. Other runtime DDL and production
  restore/least-privilege certification remain open.

### Changed — App-state storage is migration-owned

- State preflight reads metadata instead of creating a table on each tick/seed
  access. Missing storage fails explicitly; key defaults and integer upserts
  retain their behavior without implicit DDL transaction commits.
- An append-only migration supplies missing legacy coordination storage while
  preserving existing table definitions, state values and timestamps.
- Real MySQL tests cover SELECT-only reads, INSERT/UPDATE writes, denied writes,
  transaction rollback and migration replay. Legacy setup includes the upgrade.
- No destructive down companion is supplied: removing seed/tick state could
  repeat coordinated work. Full application DDL removal remains incomplete.

### Changed — Faction and diplomacy schema is migration-owned

- The remaining five CREATE paths in galaxy seed helpers now use read-only
  metadata guards. Missing storage fails explicitly instead of self-repair.
- An append-only migration creates the three formerly runtime-only government,
  alliance and standing tables with existing defaults and CASCADE behavior.
  Base/v2 faction/quest definitions and populated custom tables stay unchanged.
- Seed DML remains intact: real MySQL tests cover limited rights, transactions,
  repeated initialization, modified player values and foreign-key cleanup.
  Legacy setup includes the new migration; destructive down remains blocked.
- This completes DDL removal from the galaxy seed helper, not from every API
  or the full production application.

### Changed — Building and shipyard storage is migration-owned

- Three runtime CREATE statements and global ready caches are replaced by
  metadata-only guards. Existing base building storage and blueprint-v5
  vessel storage remain canonical; historical SQL is unchanged.
- A new append-only migration supplies the ship-construction queue while
  preserving paid costs, quantities, statuses and custom existing definitions.
- Missing vessel storage no longer fails silently: blueprint completion
  preflights storage before ship-count/status mutations; spawn errors propagate.
  Full completion atomicity/concurrency remains separate work.
- Real MySQL tests cover DML-only spawning, snapshots, transaction rollback,
  completion/repetition, missing storage and colony CASCADE.
  The queue has no destructive down companion.

### Changed — Account and homeworld schema preflight is read-only

- Three runtime CREATE statements for ships, messages and character profiles
  are replaced by metadata guards; canonical base/v2 already owns the storage.
  No historical SQL or migration count changes.
- Missing/incomplete schema fails before profile generation rather than
  automatically creating storage. Existing stored profiles remain unchanged
  and can be retrieved with SELECT-only rights.
- Real MySQL tests cover populated data preservation, active transactions,
  missing tables/columns and fail-before-generation behavior.
  Registration, asset-reference validity and production recovery remain
  separate gates.

### Changed — Situation storage preflight is read-only

- Two runtime CREATE statements and the global ready cache are replaced by
  metadata guards for situation states and stage history. The existing gameplay
  migration remains unchanged; no new migration is needed.
- Missing storage fails explicitly rather than bootstrapping during requests.
  Real MySQL tests retain populated state, owner-filtered reads, tick/history
  updates, transaction rollback and existing CASCADE/SET-NULL behavior.
- Full tick atomicity/concurrency and production recovery remain separate work.

### Changed — World-scenario schema preflight is migration-owned

- Three runtime CREATE statements and schema catch-and-continue fallback
  are replaced by read-only metadata guards. The canonical world-scenario
  migration and its foreign keys remain unchanged.
- Due ticks now verify storage before recording their cooldown, so missing
  schema cannot consume a one-hour tick window. Not-due behavior is retained.
- Real MySQL tests cover marker preservation, restricted rights, rollback
  and existing event retention. Later tick failures, claiming/concurrency and
  the outer optional subsystem dispatcher remain separate concerns.

### Changed — Glossary cache is migration-owned

- An append-only migration creates glossary cache storage with its original
  definition while preserving existing data and custom table definitions.
- Unreachable runtime CREATE after endpoint exits is removed. Generation
  checks schema before RAG work; missing storage cannot become a cache miss.
- Cache PDO read/write errors are logged and rethrown; valid TTL hits, expired
  misses and upserts retain their behavior. Real MySQL tests verify limited
  rights, replay, transaction rollback and expiry.
- No destructive down companion is supplied. External RAG transport/readiness
  and cache-content validation remain separate work.

### Changed — Player-alliance schema preflight is read-only

- Four runtime CREATE statements are replaced by metadata guards for alliances,
  members, relations and messages. Existing base/v2 migrations are unchanged.
- Real MySQL tests retain populated treasury/member/message data and active
  transactions with SELECT-only access; missing columns/storage fail explicitly.
  Existing CASCADE/SET-NULL relationships remain intact.
- Multi-party alliance-war runtime DDL and full production least privilege
  remain separate work.

### Changed — Multi-party alliance-war storage is migration-owned

- Three runtime CREATEs are replaced by metadata guards and an append-only
  migration preserving existing wars, sides, peace offers and custom definitions.
- Peace-offer TEXT default uses valid MySQL expression syntax without changing
  its `[]` value. Existing CASCADE and membership uniqueness are retained.
- Real MySQL tests cover fresh creation, replay, populated data, SELECT-only
  preflight and transaction/CASCADE behavior. Legacy setup includes the upgrade.
- No destructive down companion is provided; full war-action concurrency and
  production recovery remain separate gates.

### Changed — Leader marketplace schema preflight is read-only

- Marketplace CREATE and fourteen conditional profile ALTERs are replaced by
  metadata guards without global success caches. Existing canonical base and
  marketplace migrations remain unchanged; no new migration is needed.
- Missing storage fails explicitly instead of being repaired on API requests.
  Existing profile widths/defaults and hired candidate data are preserved.
- Real MySQL tests cover SELECT-only access, active transactions, retained
  data/definitions and missing storage after prior success. Hiring resource
  atomicity and full production least privilege remain separate work.

### Changed — Wormhole storage is migration-owned

- Six duplicate runtime CREATEs and two conditional ALTERs in fleet, faction
  rewards and NPC maintenance are replaced by shared metadata guards.
  Existing v8/v9 migrations and populated routes/unlocks remain unchanged.
- Missing schema propagates rather than becoming an unavailable-route result.
  A due regeneration tick checks schema before its cooldown marker; beacon
  rewards check unlock storage before resource or claimed-status changes.
- Real MySQL tests cover SELECT-only route/list bodies, research/unlock and
  stability thresholds, cooldowns, DML-only jump/regeneration/reward bodies,
  transaction rollback, retained migration data and unlock CASCADE behavior.
- Tick claims, quest/fleet concurrency and full request atomicity remain
  separate production gates.

### Fixed — Canonical projector workers and read-only bootstrap

- Removed worker bootstrap CREATEs; required queue and projection columns are
  checked before claims, with fatal exit 1 rather than warning-and-continue.
- Restored the malformed system worker using existing galaxy/system-keyed
  payload and persistence helpers and shared claim/retry/acknowledgement logic.
  Removed conflicting system-ID schema/helpers and duplicate processing loops.
- Both dry runs now read without claiming. Item limits bound the claimed batch;
  an already claimed batch finishes past the soft time limit instead of leaving
  normal-limit exits with unprocessed rows in `processing`.
  Explicit `--batch=50` also overrides differing configured defaults.
- Workers opt into strict projection read/write failures and JSON validation.
  Request-side best-effort defaults are preserved. Failed writes cannot be
  acknowledged as completed by workers.
- Real MySQL CLI tests cover bootstrap failures, SELECT-only dry runs,
  canonical snapshot data/versioning, limited claims and denied-write retries.
  Crash leases, claim fencing and atomic snapshot/queue commits remain open.

### Changed — Projection worker CLI rejects invalid arguments

- Unknown, positional, duplicate and malformed options now fail before
  configuration/database access with stderr diagnostics and exit 1.
  Zero batch size is rejected instead of silently clamped; negative,
  fractional and overflowing values are not accepted.
- Numeric limits support exact PHP integer boundaries, leading zeros and zero
  for unlimited time/item limits. Valid options and configured batch defaults
  are preserved; invalid configured batch sizes fail explicitly.
- Standalone `--help` needs no configuration or database. Combining it with
  worker options is rejected. Update cron/supervisor arguments before rollout.
- Parser and actual CLI subprocess tests plus real MySQL worker cases pass;
  strict parsing does not provide a hard execution deadline or crash leases.

### Fixed — Projection failures preserve newly queued events

- Retry and dead-letter updates now require `status='processing'`. A new
  enqueue wins over the old worker's failure without losing its reset attempts,
  immediate retry time, payload or reason. Duplicate failures cannot revive
  dead letters or delay already queued rows.
- Zero affected rows produce `failure_skipped` diagnostics rather than a
  success-shaped retry/dead-letter log. Database errors still propagate.
- Real MySQL tests reproduce the original overwrite and cover producer/worker
  interleavings, ordinary retry/dead-letter transitions and rollback.
- This is a status guard, not claim fencing: an old worker can still interfere
  after another worker reclaims the same row. Claim tokens/leases remain open.

### Fixed — Projector queue claim-token fencing

- Append-only migration 72 adds a nullable binary-comparison claim token,
  preserving existing queue data and historical SQL.
- Both workers pass mandatory fresh claim tokens to completion/retry helpers;
  superseded claims cannot delete, retry or dead-letter replacement claims.
  Zero-row completion/failure transitions are explicitly logged as skipped.
- Both producers clear tokens on enqueue. The separate system producer now
  resets processing/failed rows to queued instead of losing newly dirty events.
- Real MySQL covers populated migration/replay, replacement-claim ordering and
  actual CLI workers. Stop old workers and deploy matching producers/workers
  after canonical migration/verify; mixed old/new workers are not safe.
- Queue-only fencing does not prevent stale snapshot writes or provide atomic
  snapshot/ack, expiring leases, exactly-once delivery or production acceptance.

### Fixed — Fenced atomic projector publication

- Both workers lock the current claim before writing and commit strict
  read-model persistence and queue acknowledgement in one InnoDB transaction.
  Superseded claims skip the writer; counters distinguish skipped from processed.
- Write/ack failures roll back both snapshot and queue. Unrecovered transactions
  stop the worker before retry; commit/rollback errors remain explicit.
- Startup rejects nontransactional queue/read-model storage without conversion.
  No new migration beyond claim-token migration 72.
- Real MySQL covers stale writers, rollback, lock contention and actual CLI
  DELETE-denial/retry/recovery. Source snapshots, gameplay/outbox atomicity,
  expiring leases and production crash/restore acceptance remain open.

### Refactored — JS-Refactoring Phase 2 (C-1, GAP_TODO)

**Domain-Subtree Migration** — `js/engine/runtime/layers/domain/`

Nine runtime modules have been migrated from the flat `js/engine/runtime/`
root into dedicated domain subtrees.  File content and global-registration
names (`window.GQRuntime*`) are unchanged; only the file paths have moved.

| New path | Module |
|---|---|
| `layers/domain/messages/RuntimeMessageSignals.js` | Unread-message signal rings |
| `layers/domain/messages/RuntimeMessageSendCommand.js` | Message send command |
| `layers/domain/messages/RuntimeMessageConsoleCommand.js` | Message console command |
| `layers/domain/messages/RuntimeMessagesController.js` | Messages window controller |
| `layers/domain/trade/RuntimeTradeProposalsController.js` | Trade proposals controller |
| `layers/domain/trade/RuntimeTradeRoutesController.js` | Trade routes controller |
| `layers/domain/trade/RuntimeTradersDashboardController.js` | Traders dashboard controller |
| `layers/domain/war/RuntimeWarController.js` | War overview controller |
| `layers/domain/pirates/RuntimePiratesController.js` | Pirates window controller |

- `js/runtime/boot-manifest.js` updated to reference new paths.
- `tests/js/runtime-module-wiring-audit.test.js` updated to scan the
  `js/engine/runtime/` tree **recursively** (was flat-directory-only).

### Added — Selection Unification Phase 1 (C-2, GAP_TODO)

**`RuntimeSelectionState.js` — `createSelectionStore()`**

A new `createSelectionStore()` factory function has been added to
`js/engine/runtime/RuntimeSelectionState.js`.  It returns a properly shaped,
mutable selection-state object — the canonical `uiState.selectionState`
structure — with all fields initialised to defined values:

```js
{
  active:         null,   // currently selected object (normalised)
  hover:          null,   // object under pointer
  multiSelection: [],     // group/cluster selection members
  group:          null,   // group descriptor { type, systems, … }
  mode:           'galaxy',
  sourceView:     'renderer',
  updatedAt:      0,
}
```

- `js/runtime/game.js` updated: `uiState.selectionState` now initialised via
  `createSelectionStore()`.  A `uiState.selection` property getter/setter
  provides backward-compatibility with existing call-sites.
- `requireRuntimeApi('GQRuntimeSelectionState', …)` extended to include
  `createSelectionStore`.
- **22 new unit tests** in `tests/js/runtime-selection-state.test.js`:
  `createSelectionStore`, `buildSelectionKey`, `normalizeRendererSelection`,
  `commitSelectionState` (hover + active), `resolveSelectionGroupMembers`,
  `getSelectionGroupHighlightedSystems`.

### Added — Selection Unification Phase 2 (C-2, GAP_TODO)

**Persistent Selection Marker Separation**

Phase 2 specification and validation complete.  Infrastructure components
validated and ready for renderer integration.

- **Marker State Independence:**
  - Persistent selection (golden marker, z-index 21, pulsing)
  - Temporary hover (blue marker, z-index 20, static)
  - Auto-clear hover on pointer-out without affecting selection
  - Layering ensures proper visual hierarchy

- **Ownership Visual Consistency:**
  - 7 faction types with distinct visual tokens
  - Color-blind safe patterns (solid, dashed, dotted, dot-dash, etc.)
  - Symbol identification (★, ✕, ○, ◆, ▽, ☠, ?)
  - WCAG 2.1 AAA contrast compliance verified

- **Accessibility Specification Complete:**
  - WCAG 2.1 compliance framework
  - Keyboard navigation (Arrow Up/Down, Enter, Escape)
  - Screen reader (ARIA) integration patterns
  - Touch-friendly targets (44x44px minimum)
  - Color-blind safe patterns + high-contrast palettes

- **New Test Coverage:**
  - **25 new integration tests** in `tests/js/selection-marker-separation.test.js`
    covering marker independence, token distinction, accessibility patterns,
    ownership visuals, and group selection states.
  - Total test coverage: **67/67 passing** (Phase 1 + Phase 2)
  - Plus existing marker tests: **129/129 selection-related tests passing**

- **New Documentation:**
  - `docs/technical/SELECTION_PHASE2_INTEGRATION_GUIDE.md` — Concrete renderer
    integration patterns for Galaxy, System, Approach, and Colony views
  - `docs/technical/SELECTION_ACCESSIBILITY_SPEC.md` — Complete accessibility
    requirements with implementation patterns
  - `docs/archive/SELECTION_UX_PHASE2_COMPLETION_SUMMARY.md` — Historical executive summary and roadmap

- **Status:**
  - ✅ Phase 2 specification complete
  - ✅ Phase 2 test-validated (47 new tests)
  - ⏳ Pending: Renderer integration (Galaxy, System, Approach, Colony)
  - ⏳ Pending: Phase 3–5 (group selection, multi-select, accessibility integration)

### Added — CI/CD Pipeline (5.5, IMPLEMENTATION_AUDIT)

New workflow: `.github/workflows/ci.yml`

Runs on every push/PR to `main`/`master`:
- **PHPUnit** — PHP unit tests (PHP 8.2 + MySQL 8.4 service)
- **Vitest** — JavaScript unit tests (Node 20, `npm ci`)
- **Playwright E2E** — End-to-end smoke test (`view-flow.spec.js`, full Docker stack)

Docker image build & push to GHCR occurs only on `push` to `main`.

### Fixed — CI/CD Pipeline Consolidation (5.5, IMPLEMENTATION_AUDIT)

Resolved duplicate `name` and `pull_request` keys, overlapping jobs, and password placeholder in `.github/workflows/ci.yml`.
- Removed duplicate `pull_request:` block (was present twice with different branches)
- Consolidated overlapping `phpunit` and `php-tests` jobs into single `phpunit` job
- Consolidated overlapping `vitest` and `js-tests` jobs into single `vitest` job
- Fixed password placeholder in Playwright E2E user-seeding step (`--****** → --******
- Fixed regex pattern in `scripts/ensure_default_e2e_user.php` to properly parse `--****** argument
- All three test suites (PHPUnit, Vitest, Playwright) now run consistently on every push/PR

### Changed — Root-Level Test Files (5.6, IMPLEMENTATION_AUDIT)

13 standalone diagnostic/smoke scripts have been moved from the project root
to `tests/scripts/` and their relative `require_once` paths updated to use
`__DIR__ . '/../../…'`.  A `tests/scripts/README.md` documents their purpose
and usage.  These scripts are **not** part of the PHPUnit suite.

---

## References

- `docs/technical/IMPLEMENTATION_AUDIT.md` §5
- `docs/technical/GAP_TODO.md` Category C
- `docs/technical/JS_REFACTOR_ZIELSTRUKTUR_TODO.md`
- `docs/technical/SELECTION_UNIFICATION_TODO.md` Phase 1
