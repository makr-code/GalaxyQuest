# Projection Runtime – Monitoring & Runbook

**Scope:** Shared Projector Runtime introduced in Phase 3 of the Hybrid DB Read-Model initiative.  
Covers both Phase 1 (User-Overview) and Phase 2 (System-Snapshots) workers.

---

## Architecture overview

```
Write path (game.php / fleet.php / …)
    │  enqueue_projection_dirty() / enqueue_dirty_user()
    ▼
projection_dirty_queue  (status: queued → processing → deleted | failed)
    │  claim_batch()  [lib/projection_runtime.php]
    ▼
Worker process
    ├─ scripts/project_user_overview.php   (entity_type='user')
    └─ scripts/project_system_snapshots.php (entity_type='system')
    │  mark_done() / mark_failed()
    ▼
Read-model tables
    ├─ projection_user_overview
    └─ projection_system_snapshot
```

---

## Key metrics

### Worker startup and operating limits

Apply the canonical migration manifest and verify the candidate before starting
[the user worker](../../scripts/project_user_overview.php) or
[the system worker](../../scripts/project_system_snapshots.php). Bootstrap checks
queue/read-model column names without DDL; missing columns are fatal (stderr,
exit 1) before any queue claim. System snapshots use `(galaxy, system_index)`;
legacy `system_id`-only tables require reviewed append-only conversion, not
automatic recreation. Guards are not full type/index/foreign-key schema diffs.

```bash
php scripts/project_user_overview.php --dry-run --max-items=10
php scripts/project_system_snapshots.php --dry-run --max-items=10
php scripts/project_system_snapshots.php --batch=50 --max-items=20 --max-seconds=30
php scripts/project_system_snapshots.php --help
```

- Dry runs read due `queued` rows without claims or writes; SELECT-only is enough.
  They log intent, not a successful projection build or persistence check.
- `--max-items` caps the batch before claiming. The soft `--max-seconds` deadline
  is checked before claiming; a claimed batch is finished even beyond that
  deadline. It is not a hard process/SQL timeout.
- System batch default is `PROJECTION_SYSTEM_BATCH_SIZE` (200), user default is
  `PROJECTION_BATCH_SIZE` (50). Explicit `--batch=50` overrides either configured
  default. Options must appear once, numeric options use `--name=value`, and
  numbers must fit `PHP_INT_MAX`. Leading zeros are accepted; batch must be
  positive, time/item limits nonnegative. Unknown/positional/duplicate arguments,
  whitespace, signs, fractional values and overflow fail before configuration
  loading with stderr diagnostics and exit 1. Batch zero no longer clamps to 1.
  Nonpositive configured batch defaults also fail explicitly before DB access.
- Standalone `--help` exits 0 without loading configuration or connecting to
  a database. Combining help with another option (or duplicate help) is invalid.
  Audit cron/supervisor invocations for formerly ignored flags before rollout.
- Workers use strict projection reads/writes and JSON encoding. Missing stars
  legitimately produce no snapshot; source-query errors or denied snapshot
  writes enter retry handling rather than deleting the queue row as successful.
  Request-side best-effort helpers retain their default behavior.
- Exit 0 means a successful/empty run; exit 1 means bootstrap/claim failure;
  exit 2 means recorded item failures. Failure to record retries can still abort
  the process; inspect stderr and queue state rather than relying on a finish log.

**Persistence boundary:** both workers build payloads first, then lock the
matching processing row/token with `SELECT ... FOR UPDATE`. Only its current
owner executes the strict read-model writer and queue DELETE on the same PDO
connection and commits them together. Missing/superseded claims skip the writer
and increment `skipped`, not `processed`. Write/ack failures roll back both;
unrecovered transactions abort the worker before recording a retry.
Preflight requires InnoDB for the queue and read-model, including dry runs;
nontransactional/custom storage is rejected without automatic conversion.

**Remaining reliability limits:** source payload building is outside the
completion transaction and is not a consistent multi-query source snapshot.
Request-side writers and unrelated gameplay side effects are not fenced by
this worker boundary. Crash recovery still needs operator intervention for
stuck processing rows; there is no expiring lease or exactly-once delivery
guarantee. Normal limits no longer abandon part of a claimed batch, but crashes
can. Connection loss during commit has an uncertain outcome; inspect durable
queue/read-model state, do not infer rollback from a lost response.

Local acceptance: 1,114 PHP unit tests / 5,503 assertions and three real MySQL
tests / 400 assertions, including complete 71-migration fresh-install/verify/no-op,
actual CLI dry runs and bootstrap failures, canonical system payload/version/
stale behavior, user claim cap under failure and denied-write retry/recovery.
The original system-worker syntax failure was reproduced and repaired.
PHPStan and PHPCS pass without baseline changes. This does not certify complete
user live-overview generation, crash recovery, production restore or remote CI.

Follow-up CLI acceptance: 1,215 PHP unit tests / 6,240 assertions, including
101 added parser/subprocess cases. Copied actual worker scripts are executed
with a configuration trap to prove invalid arguments and help do not load it.
Exact `PHP_INT_MAX` and one-above-boundary cases are covered. Two focused real
MySQL tests / 121 assertions preserve dry-run, claim cap, schema preflight,
canonical system writes and retry behavior with strict parsing.
PHPStan/PHPCS and release/migration-history gates pass; no full fresh-install,
image/browser or crash-recovery acceptance was repeated in this CLI-only block.

Claim-token follow-up acceptance: 1,221 unit tests / 6,261 assertions; five real
MySQL cases / 477 assertions include complete 72-migration fresh-install/verify/
no-op, populated queue migration/replay, actual CLI and replacement-claim
ordering. The final expanded user/system ordering and dead-letter revival case
also passes separately (one test / 52 assertions). PHPStan/PHPCS, release metadata
and 47 history tests pass without baseline additions. This is local queue-only
evidence, not snapshot-write fencing, concurrent crash recovery or a new
image/browser/production sign-off.

Atomic completion follow-up: 1,234 unit tests / 6,321 assertions and four real
MySQL cases / 254 assertions cover both writers, stale-claim write suppression,
rollback after a write, invisible uncommitted versions, producer lock contention,
duplicate completion and no-write completion. Actual system CLI DELETE denial
retains the exact old snapshot/version/stale flag, records retry and later
commits once; actual worker preflight rejects MyISAM without claiming rows.
Unit coverage includes caller transactions, write/ack/commit failures and
preserving the original error if rollback itself fails. No new schema migration,
complete fresh-install, image/browser or process-crash acceptance is claimed.

| Metric | Query | Alert threshold |
|--------|-------|-----------------|
| **Queue depth** | `SELECT entity_type, COUNT(*) FROM projection_dirty_queue WHERE status='queued' GROUP BY entity_type` | > 500 per type |
| **Dead-letter count** | `SELECT entity_type, COUNT(*) FROM projection_dirty_queue WHERE status='failed' GROUP BY entity_type` | > 0 (any) |
| **Currently processing** | `SELECT entity_type, COUNT(*) FROM projection_dirty_queue WHERE status='processing' GROUP BY entity_type` | Stuck > 10 min |
| **Processing rate** | Worker logs `[projector:*] finish processed=N` per run | < 1 item/run for 5+ runs |
| **Error ratio** | `errors / (processed + errors)` from finish log lines | > 10 % |
| **p95 processing lag** | `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS lag_s FROM projection_dirty_queue WHERE status='queued' ORDER BY created_at ASC` | > 300 s |

### Monitoring SQL – full dashboard snapshot

```sql
-- Queue depth by status and entity type
SELECT entity_type, status, COUNT(*) AS cnt
  FROM projection_dirty_queue
 GROUP BY entity_type, status
 ORDER BY entity_type, status;

-- Oldest queued entry per type (processing lag indicator)
SELECT entity_type,
       MIN(created_at)                                    AS oldest_queued_at,
       TIMESTAMPDIFF(SECOND, MIN(created_at), NOW())      AS lag_seconds
  FROM projection_dirty_queue
 WHERE status = 'queued'
 GROUP BY entity_type;

-- Dead-letter entries
SELECT id, entity_type, entity_id, reason, attempts, last_error, updated_at
  FROM projection_dirty_queue
 WHERE status = 'failed'
 ORDER BY updated_at DESC
 LIMIT 50;
```

---

## Runbook

### Stuck queue (no progress despite entries)

**Failure/enqueue ordering:** retry and dead-letter updates only affect rows
still in `processing`. If a producer requeues a row before failure handling,
its new payload/reason, zero attempts, cleared error and immediate schedule
remain unchanged. The worker logs
`[projection_runtime] failure_skipped queue_id=... reason=claim_mismatch`
instead of reporting a retry/dead-letter transition that did not occur.
An item failure still contributes to the worker's exit 2/error count.
Already queued/failed/deleted rows are also left unchanged by duplicate failures.

Migration 72 adds mandatory claim-token fencing for queue transitions. Each
claimed batch receives a fresh random token; acknowledgement/retry/dead-letter
must match both processing status and that token. A new enqueue clears it and
a replacement claim changes it, preventing the old worker from deleting or
rescheduling the new claim. Zero-row acknowledgement logs `done_skipped`.
Both user and system producers reset status/tokens; failed rows can be revived
by new events. Tokens are cleared on retry/dead-letter.

**Current workers also fence publication:** `complete_projection_claim()` locks
ownership before invoking the writer and commits write/ack together. An old
claim cannot publish an obsolete worker snapshot. Use `completion_committed`
and the worker's `processed` count for successful completion; `completion_skipped`
and `skipped` mean no publication. Existing low-level `write`/`done` logs describe
SQL executed inside the transaction, not a durable commit.
Producers may wait briefly for the queue lock during completion; normal producer
enqueue after commit creates a fresh event. Keep payload building outside that
lock and investigate lock timeouts/deadlocks rather than blindly increasing limits.
Stop all older workers before deploying this boundary; token-only older workers
still write unfenced snapshots. Expiring leases and source/outbox atomicity remain
open, and exit 0 does not establish exactly-once delivery.

Local follow-up acceptance: the old retry overwrite was reproduced on MySQL;
three focused MySQL tests / 152 assertions now pass, including the real worker
CLI lifecycle. Full PHP unit suite: 1,218 tests / 6,249 assertions. PHPStan and
PHPCS pass without baseline changes. Tests cover distinct producer/worker
connections with deterministic interleaving, retry/dead-letter preservation,
rollback, dead-letter revival by a new event and deleted-row no-op. No parallel
reclaim/crash, full fresh-install or production acceptance is claimed.

**Symptoms:** Queue depth grows; worker finish logs show `processed=0` consistently.

**Diagnosis:**
```bash
# Check recent worker log output
grep '\[projector:' /var/log/php_errors.log | tail -50

# Check for stuck processing rows (may indicate crashed worker)
mysql -e "SELECT id, entity_type, entity_id, attempts, updated_at
          FROM projection_dirty_queue
          WHERE status='processing'
          AND updated_at < NOW() - INTERVAL 10 MINUTE;"
```

**Remediation:**
```sql
-- Stop all workers first; review and select affected ids before recovery.
UPDATE projection_dirty_queue
   SET status = 'queued', claim_token = NULL, next_attempt_at = NOW()
 WHERE status = 'processing'
   AND updated_at < NOW() - INTERVAL 10 MINUTE;
```

Then restart the worker and monitor.

---

### Poison message (dead-letter / status=failed)

**Symptoms:** One or more rows in `status='failed'` with `attempts >= PROJECTION_MAX_ATTEMPTS`.

**Diagnosis:**
```sql
SELECT id, entity_type, entity_id, reason, attempts, last_error, created_at
  FROM projection_dirty_queue
 WHERE status = 'failed'
 ORDER BY updated_at DESC;
```

**Options:**

1. **Re-queue for retry** (fix root cause first):
```sql
UPDATE projection_dirty_queue
   SET status = 'queued', attempts = 0, last_error = NULL,
       next_attempt_at = NOW()
 WHERE status = 'failed'
   AND id = <id>;
```

2. **Discard** (entity no longer relevant):
```sql
DELETE FROM projection_dirty_queue WHERE status = 'failed' AND id = <id>;
```

3. **Bulk re-queue after a fix**:
```sql
UPDATE projection_dirty_queue
   SET status = 'queued', attempts = 0, last_error = NULL,
       next_attempt_at = NOW()
 WHERE status = 'failed';
```

---

### Backlog drain (burst write created large queue)

**Symptoms:** `projection_dirty_queue` contains thousands of `queued` rows after a bulk operation.

**Remediation:**
```bash
# Run worker with higher batch size to drain faster
php scripts/project_user_overview.php --batch=200 --max-seconds=300

# Or run multiple sequential batches
for i in $(seq 1 10); do
  php scripts/project_user_overview.php --batch=100
done
```

**Dry-run first to estimate load:**
```bash
php scripts/project_user_overview.php --batch=100 --dry-run
```

---

### Coalescing verification

To confirm burst writes are being coalesced (only one queue entry per entity):

```sql
SELECT entity_type, entity_id, COUNT(*) AS cnt
  FROM projection_dirty_queue
 GROUP BY entity_type, entity_id
HAVING cnt > 1;
```

This should always return 0 rows due to the `UNIQUE KEY uniq_dirty_entity`.

---

## Worker CLI reference

Both `project_user_overview.php` and `project_system_snapshots.php` accept:

| Flag | Default | Description |
|------|---------|-------------|
| `--batch=N` | 50 | Max queue entries to claim per run |
| `--max-seconds=N` | 0 (no limit) | Soft wall-clock time limit |
| `--max-items=N` | 0 (no limit) | Max items to process across all batches |
| `--dry-run` | false | Log intent but skip all writes |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success (queue may have been empty) |
| 1 | Fatal error (DB connection failure etc.) |
| 2 | Partial success (≥ 1 item failed) |

---

## Configuration constants (`config/config.php`)

| Constant | Default | Description |
|----------|---------|-------------|
| `PROJECTION_BATCH_SIZE` | 50 | Default batch size when no `--batch` flag given |
| `PROJECTION_RETRY_BACKOFF_SECONDS` | 30 | Base backoff; doubles per attempt (capped at 64×) |
| `PROJECTION_MAX_ATTEMPTS` | 10 | Attempts before promotion to dead-letter |
| `PROJECTION_OVERVIEW_ENABLED` | 0 | Feature flag: use projection cache for overview API |
| `PROJECTION_OVERVIEW_MAX_AGE_SECONDS` | 120 | Max projection age before API falls back to live |

---

## Migration order for new deployments

1. Stop all old workers and pause producers; mixed old/new workers are unsafe.
2. Apply the complete canonical manifest using `php scripts/migrate.php up`,
   then `php scripts/migrate.php verify`. This includes the base user queue,
   canonical system snapshot, runtime v2 and migration 72 claim-token column.
3. Deploy matching producers/workers. With every worker stopped, inspect legacy
   processing rows (null tokens) and selectively requeue reviewed ids. Do not
   automatically reset a row while its owner might still be writing a snapshot.
4. Run read-only dry runs, resume producers/workers, and verify monitoring.
   There is no automatic lease recovery or destructive down migration. Preserve
   the additive column on application rollback; review interrupted DDL/custom
   schemas separately.
