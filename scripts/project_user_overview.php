#!/usr/bin/env php
<?php
/**
 * Projector Worker – User-Overview Projection (Phase 1)
 *
 * Reads fällige entries from projection_dirty_queue, re-computes the overview
 * payload for each affected user and persists the result atomically in
 * projection_user_overview.
 *
 * Designed to run as a cron job or a supervised loop, e.g.:
 *   # Every 30 seconds via cron (approximate):
 *   * * * * * php /var/www/scripts/project_user_overview.php
 *   * * * * * sleep 30; php /var/www/scripts/project_user_overview.php
 *
 *   # Or as a supervised loop:
 *   while true; do php scripts/project_user_overview.php; sleep 30; done
 *
 * Exit codes:
 *   0 – ran successfully (batch may have been empty)
 *   1 – fatal bootstrap error
 *
 * Environment / config variables (from config/config.php):
 *   PROJECTION_BATCH_SIZE            Max users to process per run (default 50)
 *   PROJECTION_RETRY_BACKOFF_SECONDS Base back-off seconds after a failure (default 30)
 *
 * Observability (written to error_log / stderr):
 *   [projector] start  batch_size=<n>
 *   [projector] processing  user=<id>  attempt=<n>
 *   [projector] done    user=<id>  duration_ms=<ms>
 *   [projector] error   user=<id>  err=<msg>  next_attempt=<datetime>
 *   [projector] finish  processed=<n>  errors=<n>  duration_ms=<total_ms>
 *   [projector] empty   (nothing in queue)
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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

$batchSize    = defined('PROJECTION_BATCH_SIZE')            ? (int)PROJECTION_BATCH_SIZE            : 50;
$retryBackoff = defined('PROJECTION_RETRY_BACKOFF_SECONDS') ? (int)PROJECTION_RETRY_BACKOFF_SECONDS : 30;

$workerStart = microtime(true);

error_log(sprintf('[projector] start  batch_size=%d', $batchSize));

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, '[projector] FATAL: cannot connect to DB: ' . $e->getMessage() . "\n");
    exit(1);
}

// Ensure the required tables exist (idempotent – handles pre-migration deploys).
try {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS projection_dirty_queue (
            id              BIGINT        NOT NULL AUTO_INCREMENT,
            entity_type     VARCHAR(40)   NOT NULL DEFAULT \'user\',
            entity_id       INT           NOT NULL,
            reason          VARCHAR(120)  NOT NULL DEFAULT \'\',
            enqueued_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            attempts        SMALLINT      NOT NULL DEFAULT 0,
            last_error      TEXT          DEFAULT NULL,
            next_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_dirty_entity  (entity_type, entity_id),
            INDEX idx_dirty_next_attempt  (next_attempt_at),
            INDEX idx_dirty_entity_id     (entity_id)
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
    error_log('[projector] table_ensure_warning: ' . $e->getMessage());
}

// ── Fetch due dirty-queue entries ─────────────────────────────────────────────

$dueStmt = $db->prepare(
    'SELECT id, entity_id, attempts
     FROM projection_dirty_queue
     WHERE entity_type = \'user\'
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC
     LIMIT ' . $batchSize
);
$dueStmt->execute();
$dueRows = $dueStmt->fetchAll(PDO::FETCH_ASSOC);

if (empty($dueRows)) {
    error_log('[projector] empty');
    exit(0);
}

// ── Process each dirty user ───────────────────────────────────────────────────

$processed = 0;
$errors    = 0;

foreach ($dueRows as $row) {
    $queueId = (int)$row['id'];
    $userId  = (int)$row['entity_id'];
    $attempt = (int)$row['attempts'] + 1;

    error_log(sprintf('[projector] processing  user=%d  attempt=%d', $userId, $attempt));

    $userStart = microtime(true);

    try {
        // Build the full overview payload (without session side-effects like NPC tick).
        $payload = build_live_overview_payload($db, $userId, false);

        // Persist the projection atomically.
        write_user_overview_projection($db, $userId, $payload);

        // Remove from dirty queue on success.
        $db->prepare('DELETE FROM projection_dirty_queue WHERE id = ?')->execute([$queueId]);

        $durationMs = (int)round((microtime(true) - $userStart) * 1000);
        error_log(sprintf('[projector] done    user=%d  duration_ms=%d', $userId, $durationMs));
        $processed++;

    } catch (Throwable $e) {
        $errors++;
        $errMsg     = $e->getMessage();
        $backoffSec = $retryBackoff * (1 << min($attempt - 1, 6)); // exponential cap at ~32× base
        $nextAttempt = date('Y-m-d H:i:s', time() + $backoffSec);

        $db->prepare(
            'UPDATE projection_dirty_queue
             SET attempts        = ?,
                 last_error      = ?,
                 next_attempt_at = ?
             WHERE id = ?'
        )->execute([$attempt, $errMsg, $nextAttempt, $queueId]);

        error_log(sprintf(
            '[projector] error   user=%d  err=%s  next_attempt=%s',
            $userId, $errMsg, $nextAttempt
        ));
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

$totalMs = (int)round((microtime(true) - $workerStart) * 1000);
error_log(sprintf(
    '[projector] finish  processed=%d  errors=%d  duration_ms=%d',
    $processed, $errors, $totalMs
));

exit($errors > 0 ? 2 : 0);
