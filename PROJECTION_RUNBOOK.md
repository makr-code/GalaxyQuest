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
-- Reset stuck processing rows to queued
UPDATE projection_dirty_queue
   SET status = 'queued', next_attempt_at = NOW()
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

1. Run `sql/migrate_projection_user_overview_v1.sql` (Phase 1 – creates base tables).
2. Run `sql/migrate_projection_runtime_v2.sql` (Phase 3 – standardises schema, adds Phase 2 table).
3. Deploy workers; verify via monitoring queries above.
