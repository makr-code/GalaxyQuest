# Headless Simulation Engine (Phase 1 Slice)

This introduces an explicit simulation runtime path independent from frontend rendering.

Body-bound resource profiles and the staged inventory capture are documented in
[Body resource foundation](BODY_RESOURCE_FOUNDATION.md). They do not yet change the
economy tick or activate a second resource writer.

Colony stockpiles still settle **on demand**, not through a new periodic engine;
see [Colony on-demand economy](COLONY_ON_DEMAND_ECONOMY.md).

## What is included

- Runtime orchestrator: `api/simulation_runtime.php`
- Manual trigger endpoint: `api/simulation_tick.php`
- Scheduler entry point: `scripts/run_simulation_tick.php`
- Strategic AI decision queue runtime: `api/npc_ai_decision_queue.php`
- Strategic AI queue worker entry point: `scripts/process_npc_ai_decision_queue.php`
- Canonical event taxonomy: `config/simulation_event_taxonomy.json`
- Deterministic shard locator: `src/Simulation/Domain/ShardLocator.php`

## Runtime mode

- Single persistent galaxy mode remains active.
- Flexible tick cadence is supported via scheduler frequency + cooldowns.
- Overview GETs never execute simulation side-effects. The legacy
  `SIMULATION_TICK_ON_READ_ENABLED` setting has been retired; changing it in an
  environment file has no effect.
- `build_live_overview_payload()` is read-only with respect to simulation and
  achievement/faction-pressure ticks; the former opt-in side-effect switch has
  been removed. Colony resource settlement remains a separate lazy-read contract.
- Simulation runs only through the explicit HTTP or CLI trigger paths below.
- Per-user NPC ticks only process that user's faction/diplomacy state. Global
  NPC accounts, faction events, scenarios, colony events, and wormhole
  maintenance run as a separate `npc_world` global subsystem under the global
  advisory lock; trader lifecycle remains its own global subsystem.
- Each NPC player account tick commits its research/build/ship/fleet mutations
  and per-account completion timestamp atomically. If a later account fails in
  the global batch, a normal retry skips accounts already committed within the
  three-minute interval; explicit force runs still bypass that per-account
  cooldown.
- The NPC controller's manual `run_once` action uses the same per-user
  simulation lock and failure response contract. A busy lock is reported as a
  skipped tick rather than a successful execution.
- The manual pirate-faction tick uses that same per-user advisory lock, so it
  cannot overlap the normal per-user NPC tick; lock contention is reported as
  an unexecuted skip.
- The administrative trader `game_tick` cycle uses the global advisory lock,
  preventing its route and market mutations from overlapping the scheduled
  global trader subsystem.
- The separate `traders.php?action=process_trader_tick` action uses that same
  global lock, so it cannot overlap route transitions or trader decisions from
  another global tick.
- All individual administrative trader mutation events (market update,
  opportunity scan, decisions, route processing, route creation, and manual
  completion) share that lock as well. Their responses distinguish executed
  work from a lock-busy skip.
- The on-demand fleet-arrival sweep uses its own advisory lock because one
  authenticated POST processes due arrivals across all users; concurrent checks
  are skipped rather than processing the same due-fleet snapshot in parallel.
- Arrival workers re-read and lock each due fleet inside its processing
  transaction. Fleet recall takes the same row lock and rechecks arrival state,
  so recall and arrival cannot both apply conflicting transitions.
- Manual autonomous leader actions use the same per-user advisory lock as the
  user simulation tick; busy-lock responses are shown as skipped in the UI.
- Global ticks and each user tick are serialized by a MySQL connection-scoped
  advisory lock. If the same scope is already running, a concurrent invocation
  returns `executed: false` with `reason: lock_busy`; the scheduler may retry on
  its next run. This prevents overlapping workers but is not a durable lease,
  crash-recovery protocol, or idempotent tick ledger.
- Successful global and user tick cooldowns start at completion, not at tick
  start, so a long-running tick cannot consume its own cooldown while executing.
- The overview still performs lazy colony-resource settlement from `last_update`;
  this on-demand economy accounting is separate from simulation ticks.
- Each executed global/user subsystem emits `duration_ms`, `lag_seconds`
  (seconds since its previous attempt; `null` on the first attempt), `ok` and
  `error_count` in the result and a `[simulation_metrics]` structured log entry.
  Metrics are persisted in `app_state`; per-user timestamps are isolated by
  user. Retention, dashboards and alerts are not included.
- A failed subsystem makes the tick response fail (HTTP 500 / CLI exit code 2);
  raw exception messages are not returned to callers. Lock-busy and cooldown
  skips remain successful non-executions.
- Pirate raid messages are notifications for raids already applied by the NPC
  faction tick, not pending events. The global simulation does not replay them;
  raid resolution remains unavailable until a dedicated, idempotent event queue
  is implemented.
- War attrition is currently disabled: no canonical war-party troop inventory
  exists, so the former tick's fixed `rate × 10` loss figures did not represent
  real units and were not applied to combat state. The tick remains a no-op until
  losses can be calculated from and committed against authoritative unit counts.

## Trigger ticks

### CLI (scheduler-friendly)

```bash
php scripts/run_simulation_tick.php --scope=global
php scripts/run_simulation_tick.php --scope=user --user=123
php scripts/run_simulation_tick.php --scope=global --force
```

### HTTP (manual/admin)

```http
POST /api/simulation_tick.php?action=run
X-CSRF-Token: <token>
Content-Type: application/json

{"scope":"global","force":false}
```

`scope=global` requires admin privileges. `scope=user` defaults to the current user.

## Async strategic AI queue (Python-worker compatible)

- Queue table migration: `sql/migrate_npc_ai_decision_queue_v1.sql`
- Feature flag: `NPC_LLM_ASYNC_QUEUE_ENABLED=1`
- Retry backoff: `NPC_LLM_ASYNC_QUEUE_RETRY_BACKOFF_SECONDS` (default 120s)
- During NPC tick, strategic LLM decisions are enqueued (non-blocking) when enabled.
- If queue is disabled/unavailable, runtime falls back to existing synchronous LLM behavior.
- Queue payload includes `lore_lock=true` to preserve lore-safe decision context.

### Worker execution

```bash
php scripts/process_npc_ai_decision_queue.php
php scripts/process_npc_ai_decision_queue.php --limit=50
```

This worker contract is intentionally simple so a Python AI worker can later replace or co-run the processor while keeping MySQL queue semantics.

### Python reference worker

```bash
python3 scripts/npc_ai_worker_client.py --once
python3 scripts/npc_ai_worker_client.py
```

Environment variables:

- `NPC_AI_WORKER_API_BASE_URL`
- `NPC_AI_WORKER_SHARED_SECRET`
- `NPC_AI_WORKER_WORKER_ID`
- `NPC_AI_WORKER_CLAIM_LIMIT`
- `NPC_AI_WORKER_POLL_INTERVAL_SECONDS`
- `NPC_AI_WORKER_REQUEST_TIMEOUT_SECONDS`

## External Python worker HTTP contract (signed)

- Endpoint: `POST /api/npc_ai_worker.php?action=claim|complete`
- Feature flag: `NPC_AI_WORKER_API_ENABLED=1`
- Shared secret: `NPC_AI_WORKER_SHARED_SECRET`
- Required headers:
  - `X-Worker-Id`: worker identifier (`[a-zA-Z0-9:_-]{3,64}`)
  - `X-Worker-Timestamp`: unix seconds
  - `X-Worker-Nonce`: unique nonce per request
  - `X-Worker-Signature`: `hex(hmac_sha256(canonical, shared_secret))`
- Canonical string:
  - `<worker_id>\n<timestamp>\n<nonce>\n<raw_json_body>`
- Replay protection:
  - Nonce is single-use (stored in `npc_ai_worker_nonce`)
  - Timestamp drift must be within `NPC_AI_WORKER_SIGNATURE_MAX_SKEW_SECONDS`

### Claim request

Body:

```json
{"limit": 20}
```

Response:

```json
{
  "success": true,
  "worker_id": "py-worker-1",
  "claimed": 1,
  "jobs": [
    {
      "queue_id": 123,
      "user_id": 77,
      "faction_id": 4,
      "attempts": 1,
      "max_attempts": 3,
      "payload": {"lore_lock": true},
      "claim_token": "..."
    }
  ]
}
```

### Complete request

Body:

```json
{
  "queue_id": 123,
  "claim_token": "...",
  "ok": true,
  "result": {"handled": true, "reason": "standing_updated"},
  "error_message": ""
}
```

`claim_token` + `worker_id` ownership is validated server-side; expired/invalid claims are rejected.
