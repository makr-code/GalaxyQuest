#!/usr/bin/env php
<?php
/**
 * Projector Worker – System-Snapshot Projection (Phase 2)
 *
 * Reads due 'system' entries from projection_dirty_queue, re-computes the
 * system snapshot payload for each affected (galaxy, system_index) pair and
 * persists the result atomically in projection_system_snapshot.
 *
 * Designed to run as a cron job or a supervised loop, e.g.:
 *   # Every minute via cron:
 *   * * * * * php /var/www/scripts/project_system_snapshots.php
 *
 *   # Or as a supervised loop:
 *   while true; do php scripts/project_system_snapshots.php; sleep 30; done
 *
 * Exit codes:
 *   0 – ran successfully (batch may have been empty)
 *   1 – fatal bootstrap error
 *
 * Environment / config variables (from config/config.php):
 *   PROJECTION_SYSTEM_BATCH_SIZE       Max systems to process per run (default 200)
 *   PROJECTION_RETRY_BACKOFF_SECONDS   Base back-off seconds after a failure (default 30)
 *
 * Observability (written to error_log / stderr):
 *   [projector-sys] start  batch_size=<n>
 *   [projector-sys] processing  galaxy=<g> system=<s>  attempt=<n>
 *   [projector-sys] done    galaxy=<g> system=<s>  duration_ms=<ms>
 *   [projector-sys] error   galaxy=<g> system=<s>  err=<msg>  next_attempt=<datetime>
 *   [projector-sys] finish  processed=<n>  errors=<n>  duration_ms=<total_ms>
 *   [projector-sys] empty   (nothing in queue)
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
require_once $repoRoot . '/api/projection.php';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

$batchSize    = defined('PROJECTION_SYSTEM_BATCH_SIZE')     ? (int)PROJECTION_SYSTEM_BATCH_SIZE     : 200;
$retryBackoff = defined('PROJECTION_RETRY_BACKOFF_SECONDS') ? (int)PROJECTION_RETRY_BACKOFF_SECONDS : 30;

$workerStart = microtime(true);

error_log(sprintf('[projector-sys] start  batch_size=%d', $batchSize));

try {
    $db = get_db();
} catch (Throwable $e) {
    fwrite(STDERR, '[projector-sys] FATAL: cannot connect to DB: ' . $e->getMessage() . "\n");
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
        'CREATE TABLE IF NOT EXISTS projection_system_snapshot (
            galaxy            INT          NOT NULL,
            system_index      INT          NOT NULL,
            payload_json      LONGTEXT     NOT NULL,
            owner_user_id     INT          NOT NULL DEFAULT 0,
            colony_count      INT          NOT NULL DEFAULT 0,
            colony_population BIGINT       NOT NULL DEFAULT 0,
            version           BIGINT       NOT NULL DEFAULT 0,
            updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
            source_tick       BIGINT       NOT NULL DEFAULT 0,
            stale_flag        TINYINT(1)   NOT NULL DEFAULT 0,
            PRIMARY KEY (galaxy, system_index),
            INDEX idx_pss_owner   (galaxy, owner_user_id),
            INDEX idx_pss_stale   (stale_flag),
            INDEX idx_pss_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
} catch (Throwable $e) {
    // Non-fatal: tables may already exist from the migration.
    error_log('[projector-sys] table_ensure_warning: ' . $e->getMessage());
}

// ── Fetch batch ───────────────────────────────────────────────────────────────

try {
    $batchStmt = $db->prepare(
        'SELECT id, entity_id, attempts
         FROM projection_dirty_queue
         WHERE entity_type = \'system\'
           AND next_attempt_at <= NOW()
         ORDER BY next_attempt_at ASC
         LIMIT ?'
    );
    $batchStmt->execute([$batchSize]);
    $batch = $batchStmt->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    fwrite(STDERR, '[projector-sys] FATAL: cannot fetch batch: ' . $e->getMessage() . "\n");
    exit(1);
}

if (count($batch) === 0) {
    error_log('[projector-sys] empty');
    exit(0);
}

// ── Process entries ───────────────────────────────────────────────────────────

$processed = 0;
$errors    = 0;

foreach ($batch as $entry) {
    $queueId  = (int)$entry['id'];
    $entityId = (int)$entry['entity_id'];
    $attempts = (int)$entry['attempts'];

    ['galaxy' => $galaxy, 'system_index' => $systemIndex] = system_dirty_decode($entityId);

    error_log(sprintf(
        '[projector-sys] processing  galaxy=%d system=%d  attempt=%d',
        $galaxy, $systemIndex, $attempts + 1
    ));

    $t0 = microtime(true);

    try {
        // Check that the star_systems row actually exists before projecting.
        $existsStmt = $db->prepare(
            'SELECT id FROM star_systems WHERE galaxy_index = ? AND system_index = ? LIMIT 1'
        );
        $existsStmt->execute([$galaxy, $systemIndex]);
        if (!$existsStmt->fetch()) {
            // System not generated yet – remove from queue (will be re-enqueued on access).
            $db->prepare('DELETE FROM projection_dirty_queue WHERE id = ?')->execute([$queueId]);
            error_log(sprintf(
                '[projector-sys] skip  galaxy=%d system=%d  reason=star_not_found',
                $galaxy, $systemIndex
            ));
            continue;
        }

        $payload = build_system_snapshot_payload($db, $galaxy, $systemIndex);

        if ($payload === null) {
            // build_system_snapshot_payload returned null – star not ready.
            $db->prepare('DELETE FROM projection_dirty_queue WHERE id = ?')->execute([$queueId]);
            error_log(sprintf(
                '[projector-sys] skip  galaxy=%d system=%d  reason=payload_null',
                $galaxy, $systemIndex
            ));
            continue;
        }

        write_system_snapshot($db, $galaxy, $systemIndex, $payload);

        // Remove from dirty queue on success.
        $db->prepare('DELETE FROM projection_dirty_queue WHERE id = ?')->execute([$queueId]);

        $durationMs = (int)round((microtime(true) - $t0) * 1000);
        error_log(sprintf(
            '[projector-sys] done  galaxy=%d system=%d  duration_ms=%d',
            $galaxy, $systemIndex, $durationMs
        ));

        $processed++;
    } catch (Throwable $e) {
        $errors++;
        $newAttempts = $attempts + 1;
        // Exponential back-off capped at 1 hour.
        $backoffSecs = min(3600, $retryBackoff * (2 ** min($newAttempts - 1, 6)));
        $nextAttempt = date('Y-m-d H:i:s', time() + $backoffSecs);

        try {
            $db->prepare(
                'UPDATE projection_dirty_queue
                 SET attempts        = ?,
                     last_error      = ?,
                     next_attempt_at = ?
                 WHERE id = ?'
            )->execute([$newAttempts, $e->getMessage(), $nextAttempt, $queueId]);
        } catch (Throwable $ue) {
            error_log('[projector-sys] queue_update_error: ' . $ue->getMessage());
        }

        error_log(sprintf(
            '[projector-sys] error  galaxy=%d system=%d  err=%s  next_attempt=%s',
            $galaxy, $systemIndex, $e->getMessage(), $nextAttempt
        ));
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

$totalMs = (int)round((microtime(true) - $workerStart) * 1000);
error_log(sprintf(
    '[projector-sys] finish  processed=%d  errors=%d  duration_ms=%d',
    $processed, $errors, $totalMs
));

exit(0);
