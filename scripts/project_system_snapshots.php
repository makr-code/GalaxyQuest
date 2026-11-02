#!/usr/bin/env php
<?php
/**
 * Project canonical (galaxy, system_index) snapshots from the shared dirty queue.
 *
 * CLI: --batch=N --max-seconds=N --max-items=N --dry-run
 * Dry runs read due entries without claiming or writing. Limits apply before
 * claiming; an already claimed batch is finished even beyond the soft deadline.
 * Exit codes: 0 = success/empty, 1 = bootstrap failure, 2 = item failures.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$repoRoot = dirname(__DIR__);
require_once $repoRoot . '/lib/projection_runtime.php';
if (array_slice($argv, 1) === ['--help']) {
    fwrite(STDOUT, projection_worker_usage());
    exit(0);
}
try {
    parse_worker_args($argv);
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, '[projector:system] FATAL: ' . $e->getMessage() . "\n");
    exit(1);
}
require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/api/game_engine.php';
require_once $repoRoot . '/api/projection.php';
require_once $repoRoot . '/lib/GalaxySchema.php';

try {
    $workerArgs = parse_worker_args(
        $argv,
        defined('PROJECTION_SYSTEM_BATCH_SIZE') ? (int)PROJECTION_SYSTEM_BATCH_SIZE : 200
    );
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, '[projector:system] FATAL: ' . $e->getMessage() . "\n");
    exit(1);
}
$batchSize = $workerArgs['batch'];
$retryBackoff = defined('PROJECTION_RETRY_BACKOFF_SECONDS') ? (int)PROJECTION_RETRY_BACKOFF_SECONDS : 30;
$maxSeconds = $workerArgs['max-seconds'];
$maxItems = $workerArgs['max-items'];
$dryRun = $workerArgs['dry-run'];
$workerStart = microtime(true);

error_log(sprintf(
    '[projector:system] start  batch_size=%d  max_seconds=%d  max_items=%d  dry_run=%s',
    $batchSize, $maxSeconds, $maxItems, $dryRun ? 'yes' : 'no',
));

try {
    $db = get_db();
    \GalaxyQuest\Schema\GalaxySchema::assertProjectionQueue($db);
    \GalaxyQuest\Schema\GalaxySchema::assertSystemProjection($db);
    \GalaxyQuest\Schema\GalaxySchema::assertProjectionTransactions($db, 'projection_system_snapshot');
} catch (PDOException | RuntimeException $e) {
    fwrite(STDERR, '[projector:system] FATAL: bootstrap failed: ' . $e->getMessage() . "\n");
    exit(1);
}

try {
    $limit = $maxItems > 0 ? min($batchSize, $maxItems) : $batchSize;
    if ($maxSeconds > 0 && (microtime(true) - $workerStart) >= $maxSeconds) {
        $dueRows = [];
    } elseif ($dryRun) {
        $stmt = $db->prepare(
            "SELECT id, entity_id, attempts FROM projection_dirty_queue
             WHERE entity_type = 'system' AND status = 'queued' AND next_attempt_at <= NOW()
             ORDER BY next_attempt_at ASC LIMIT " . (int)$limit
        );
        $stmt->execute();
        $dueRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } else {
        $dueRows = claim_batch($db, 'system', $limit);
    }
} catch (PDOException | RuntimeException $e) {
    fwrite(STDERR, '[projector:system] FATAL: queue read/claim failed: ' . $e->getMessage() . "\n");
    exit(1);
}

if ($dueRows === []) {
    error_log('[projector:system] empty');
    exit(0);
}

$processed = 0;
$skipped = 0;
$errors = 0;
foreach ($dueRows as $row) {
    $queueId = (int)$row['id'];
    $attempt = (int)$row['attempts'] + 1;
    ['galaxy' => $galaxy, 'system_index' => $systemIndex] = system_dirty_decode((int)$row['entity_id']);
    error_log(sprintf('[projector:system] processing  galaxy=%d system=%d', $galaxy, $systemIndex));

    if ($dryRun) {
        error_log(sprintf('[projector:system] dry_run  galaxy=%d system=%d', $galaxy, $systemIndex));
        $processed++;
        continue;
    }

    try {
        $payload = build_system_snapshot_payload($db, $galaxy, $systemIndex, true);
        if ($payload === null) {
            error_log(sprintf('[projector:system] skip  galaxy=%d system=%d  reason=star_not_ready', $galaxy, $systemIndex));
        }
        $completed = complete_projection_claim(
            $db,
            $queueId,
            $row['claim_token'],
            static function (PDO $connection) use ($galaxy, $systemIndex, $payload): void {
                if ($payload !== null) {
                    write_system_snapshot($connection, $galaxy, $systemIndex, $payload, true);
                }
            },
        );
        if (!$completed) {
            $skipped++;
            continue;
        }
        $processed++;
    } catch (Throwable $e) {
        $errors++;
        if ($db->inTransaction()) {
            fwrite(STDERR, '[projector:system] FATAL: completion transaction not recovered: ' . $e->getMessage() . "\n");
            exit(1);
        }
        mark_failed($db, $queueId, $attempt, $e->getMessage(), $retryBackoff, $row['claim_token']);
        error_log(sprintf('[projector:system] error  galaxy=%d system=%d  err=%s', $galaxy, $systemIndex, $e->getMessage()));
    }
}

error_log(sprintf(
    '[projector:system] finish  processed=%d  errors=%d  skipped=%d  duration_ms=%d',
    $processed, $errors, $skipped, (int)round((microtime(true) - $workerStart) * 1000),
));
exit($errors > 0 ? 2 : 0);
