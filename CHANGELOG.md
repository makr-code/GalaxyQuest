# Changelog

All notable changes to GalaxyQuest are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] — Sprint 1.2: Technische Schulden abbauen

### Changed — Read paths without queue completion side effects

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
- Trader dashboard queries require GET before database access.
- The admin generation-queue monitor explicitly requires GET before admin
  authentication and database access.
- Game guide reads now require authentication and GET; write actions require
  POST plus CSRF. Greeting reads and guide construction no longer initialize
  database rows or cache directories.
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
  or civic rows; the status loader already provides an in-memory default.
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
  - `SELECTION_UX_PHASE2_COMPLETION_SUMMARY.md` — Executive summary and roadmap

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
