#!/usr/bin/env php
<?php
/**
 * Projector Worker – User-Overview Projection (Phase 1)
 *
 * Reads due entries from projection_dirty_queue (entity_type='user'), re-computes
 * the overview payload for each affected user and persists the result atomically
 * in projection_user_overview.
 *
 * Uses the shared Projector Runtime from lib/projection_runtime.php for batch
 * claiming, retry/backoff and dead-letter handling.
 *
 * Designed to run as a cron job or a supervised loop, e.g.:
 *   # Every 30 seconds via cron (approximate):
 *   * * * * * php /var/www/scripts/project_user_overview.php
 *   * * * * * sleep 30; php /var/www/scripts/project_user_overview.php
 *
 *   # Or as a supervised loop:
 *   while true; do php scripts/project_user_overview.php; sleep 30; done
 *
 * CLI options (all optional):
 *   --batch=N          Max dirty-queue entries to process per run (default 50).
 *   --max-seconds=N    Soft wall-clock limit; stop claiming after N seconds (default 0 = no limit).
 *   --max-items=N      Stop after projecting N users total (default 0 = no limit).
 *   --dry-run          Claim batch and log intent but skip all writes.
 *
 * Exit codes:
 *   0 – ran successfully (batch may have been empty)
 *   1 – fatal bootstrap error
 *   2 – partial success: at least one item failed
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(1);
}

$repoRoot = dirname(__DIR__);
require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/api/game_engine.php';
require_once $repoRoot . '/api/achievements.php';
require_once $repoRoot . '/api/projection.php';
// projection.php already requires lib/projection_runtime.php

// ── Bootstrap ─────────────────────────────────────────────────────────────────

$workerArgs   = parse_worker_args($argv);
$batchSize    = defined('PROJECTION_BATCH_SIZE')            ? (int)PROJECTION_BATCH_SIZE            : 50;
$retryBackoff = defined('PROJECTION_RETRY_BACKOFF_SECONDS') ? (int)PROJECTION_RETRY_BACKOFF_SECONDS : 30;

// CLI flags override config defaults.
if ($workerArgs['batch'] !== 50) {
    $batchSize = $workerArgs['batch'];
}
$maxSeconds = $workerArgs['max-seconds'];
$maxItems   = $workerArgs['max-items'];
$dryRun     = $workerArgs['dry-run'];

$workerStart = microtime(true);

error_log(sprintf(
    '[projector:user] start  batch_size=%d  max_seconds=%d  max_items=%d  dry_run=%s',
    $batchSize, $maxSeconds, $maxItems, $dryRun ? 'yes' : 'no',
));

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, '[projector:user] FATAL: cannot connect to DB: ' . $e->getMessage() . "\n");
    exit(1);
}

// Ensure the required tables exist (idempotent – handles pre-migration deploys).
try {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS projection_dirty_queue (
            id              BIGINT        NOT NULL AUTO_INCREMENT,
            entity_type     VARCHAR(40)   NOT NULL DEFAULT \'user\',
            entity_id       INT           NOT NULL,
            event_type      VARCHAR(60)   NOT NULL DEFAULT \'\',
            reason          VARCHAR(120)  NOT NULL DEFAULT \'\',
            payload_json    TEXT          DEFAULT NULL,
            status          ENUM(\'queued\',\'processing\',\'done\',\'failed\') NOT NULL DEFAULT \'queued\',
            enqueued_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            attempts        SMALLINT      NOT NULL DEFAULT 0,
            last_error      TEXT          DEFAULT NULL,
            next_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            processed_at    DATETIME      DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_dirty_entity    (entity_type, entity_id),
            INDEX idx_dirty_status_next     (status, next_attempt_at),
            INDEX idx_dirty_entity_id       (entity_id),
            INDEX idx_dirty_event_created   (event_type, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS projection_user_overview (
            user_id      INT          NOT NULL,
            payload_json LONGTEXT     NOT NULL,
            version      BIGINT       NOT NULL DEFAULT 0,
            updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                         ON UPDATE CURRENT_TIMESTAMP,
            source_tick  BIGINT       NOT NULL DEFAULT 0,
            stale_flag   TINYINT(1)   NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id),
            INDEX idx_proj_overview_stale   (stale_flag),
            INDEX idx_proj_overview_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
} catch (Throwable $e) {
    // Non-fatal: tables may already exist; the real migration creates them.
    error_log('[projector:user] table_ensure_warning: ' . $e->getMessage());
}

// ── Claim and process batches ─────────────────────────────────────────────────

$processed  = 0;
$errors     = 0;
$totalItems = 0;

try {
    $dueRows = claim_batch($db, 'user', $batchSize);
} catch (Throwable $e) {
    fwrite(STDERR, '[projector:user] FATAL: claim_batch failed: ' . $e->getMessage() . "\n");
    exit(1);
}

if (empty($dueRows)) {
    error_log('[projector:user] empty');
    exit(0);
}

// ── Process each dirty user ───────────────────────────────────────────────────

foreach ($dueRows as $row) {
    // Respect soft limits.
    if ($maxItems > 0 && $totalItems >= $maxItems) {
        break;
    }
    if ($maxSeconds > 0 && (microtime(true) - $workerStart) >= $maxSeconds) {
        break;
    }

    $queueId = (int)$row['id'];
    $userId  = (int)$row['entity_id'];
    $attempt = (int)$row['attempts'] + 1;
    $totalItems++;

    error_log(sprintf('[projector:user] processing  user=%d  attempt=%d', $userId, $attempt));

    if ($dryRun) {
        error_log(sprintf('[projector:user] dry_run  user=%d  (skipping write)', $userId));
        $processed++;
        continue;
    }

    $userStart = microtime(true);

    try {
        // Build the full overview payload (without session side-effects like NPC tick).
        $payload = build_live_overview_payload($db, $userId, false);

        // Persist the projection atomically.
        write_user_overview_projection($db, $userId, $payload);

        // Remove from dirty queue on success.
        mark_done($db, $queueId);

        $durationMs = (int)round((microtime(true) - $userStart) * 1000);
        error_log(sprintf('[projector:user] done  user=%d  duration_ms=%d', $userId, $durationMs));
        $processed++;

    } catch (Throwable $e) {
        $errors++;
        mark_failed($db, $queueId, $attempt, $e->getMessage(), $retryBackoff);
        error_log(sprintf('[projector:user] error  user=%d  err=%s', $userId, $e->getMessage()));
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

$totalMs = (int)round((microtime(true) - $workerStart) * 1000);
error_log(sprintf(
    '[projector:user] finish  processed=%d  errors=%d  duration_ms=%d',
    $processed, $errors, $totalMs,
));

exit($errors > 0 ? 2 : 0);
