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
 *   --dry-run          Read due entries and log intent without claiming or writing.
 * Limits apply before claiming; finish an already claimed batch even beyond
 * the soft deadline so normal limit exits do not strand processing entries.
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
require_once $repoRoot . '/lib/projection_runtime.php';
require_once $repoRoot . '/lib/empire_scores.php';
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    if (array_slice($argv ?? [], 1) === ['--help']) {
        fwrite(STDOUT, projection_worker_usage());
        exit(0);
    }
    try {
        parse_worker_args($argv ?? []);
    } catch (InvalidArgumentException $e) {
        fwrite(STDERR, '[projector:user] FATAL: ' . $e->getMessage() . "\n");
        exit(1);
    }
}
require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/api/game_engine.php';
require_once $repoRoot . '/api/achievements.php';
require_once $repoRoot . '/api/projection.php';
// projection.php already requires lib/projection_runtime.php

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {

try {
    $workerArgs = parse_worker_args(
        $argv ?? [],
        defined('PROJECTION_BATCH_SIZE') ? (int)PROJECTION_BATCH_SIZE : 50
    );
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, '[projector:user] FATAL: ' . $e->getMessage() . "\n");
    exit(1);
}
$batchSize    = $workerArgs['batch'];
$retryBackoff = defined('PROJECTION_RETRY_BACKOFF_SECONDS') ? (int)PROJECTION_RETRY_BACKOFF_SECONDS : 30;

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

// Validate canonical storage before claiming queue entries.
try {
    require_once $repoRoot . '/lib/GalaxySchema.php';
    \GalaxyQuest\Schema\GalaxySchema::assertProjectionQueue($db);
    \GalaxyQuest\Schema\GalaxySchema::assertUserProjection($db);
    \GalaxyQuest\Schema\GalaxySchema::assertProjectionTransactions($db, 'projection_user_overview');
} catch (PDOException | RuntimeException $e) {
    fwrite(STDERR, '[projector:user] FATAL: schema preflight failed: ' . $e->getMessage() . "\n");
    exit(1);
}

// ── Claim and process batches ─────────────────────────────────────────────────

$processed  = 0;
$skipped    = 0;
$errors     = 0;
$totalItems = 0;

try {
    $limit = $maxItems > 0 ? min($batchSize, $maxItems) : $batchSize;
    if ($maxSeconds > 0 && (microtime(true) - $workerStart) >= $maxSeconds) {
        $dueRows = [];
    } elseif ($dryRun) {
        $stmt = $db->prepare(
            "SELECT id, entity_id, attempts FROM projection_dirty_queue
             WHERE entity_type = 'user' AND status = 'queued' AND next_attempt_at <= NOW()
             ORDER BY next_attempt_at ASC LIMIT " . (int)$limit
        );
        $stmt->execute();
        $dueRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $dueRows = claim_batch($db, 'user', $limit);
    }
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
        $payload = build_live_overview_payload($db, $userId);

        $completed = complete_projection_claim(
            $db,
            $queueId,
            $row['claim_token'],
            static function (PDO $connection) use ($userId, $payload): void {
                write_user_overview_projection($connection, $userId, $payload, true);
            },
        );
        if (!$completed) {
            $skipped++;
            continue;
        }

        $durationMs = (int)round((microtime(true) - $userStart) * 1000);
        error_log(sprintf('[projector:user] done  user=%d  duration_ms=%d', $userId, $durationMs));
        $processed++;

    } catch (Throwable $e) {
        $errors++;
        if ($db->inTransaction()) {
            fwrite(STDERR, '[projector:user] FATAL: completion transaction not recovered: ' . $e->getMessage() . "\n");
            exit(1);
        }
        mark_failed($db, $queueId, $attempt, $e->getMessage(), $retryBackoff, $row['claim_token']);
        error_log(sprintf('[projector:user] error  user=%d  err=%s', $userId, $e->getMessage()));
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

$totalMs = (int)round((microtime(true) - $workerStart) * 1000);
error_log(sprintf(
    '[projector:user] finish  processed=%d  errors=%d  skipped=%d  duration_ms=%d',
    $processed, $errors, $skipped, $totalMs,
));

exit($errors > 0 ? 2 : 0);

} // end if (running as main script)
