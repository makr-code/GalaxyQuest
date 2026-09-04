# Headless Simulation Engine (Phase 1 Slice)

This introduces an explicit simulation runtime path independent from frontend rendering.

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
- Simulation side-effects on overview reads are now feature-flagged:
  - `SIMULATION_TICK_ON_READ_ENABLED=0` (default, recommended)
  - `SIMULATION_TICK_ON_READ_ENABLED=1` (legacy compatibility)

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
