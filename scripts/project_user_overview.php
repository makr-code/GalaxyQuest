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

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {

$workerArgs   = parse_worker_args($argv ?? []);
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

} // end if (running as main script)

// ── Empire Category Score Functions ───────────────────────────────────────────

/**
 * Clamp a float/int value to an integer in range [0, 100].
 */
function clamp_score(float $value): int
{
    return (int)max(0, min(100, round($value)));
}

/**
 * Economy score: based on total colony resource stockpiles vs a baseline.
 * Sums metal + crystal + deuterium per colony; 20 000 total → 100.
 */
function calc_economy_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(metal + crystal + deuterium), 0)
         FROM colonies WHERE user_id = ?'
    );
    $stmt->execute([$uid]);
    return clamp_score((float)$stmt->fetchColumn() / 200.0);
}

/**
 * Military score: based on total ship count across all non-returning fleets.
 * 1 000 ships → 100.
 */
function calc_military_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT ships_json FROM fleets WHERE user_id = ? AND `returning` = 0'
    );
    $stmt->execute([$uid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $totalShips = 0;
    foreach ($rows as $row) {
        $ships = json_decode((string)($row['ships_json'] ?? '{}'), true);
        if (!is_array($ships)) {
            continue;
        }
        foreach ($ships as $count) {
            $totalShips += max(0, (int)$count);
        }
    }
    return clamp_score($totalShips / 10.0);
}

/**
 * Research score: based on number of research colonies + total colony count.
 * Each research colony = 20 pts; each colony = 3 pts.
 */
function calc_research_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        "SELECT
             COUNT(*) AS total_colonies,
             SUM(CASE WHEN colony_type = 'research' THEN 1 ELSE 0 END) AS research_colonies
         FROM colonies WHERE user_id = ?"
    );
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0;
    }
    $score = ((int)$row['research_colonies'] * 20) + ((int)$row['total_colonies'] * 3);
    return clamp_score((float)$score);
}

/**
 * Growth score: based on total population across all colonies.
 * 10 000 population → 100.
 */
function calc_growth_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(population), 0) FROM colonies WHERE user_id = ?'
    );
    $stmt->execute([$uid]);
    return clamp_score((float)$stmt->fetchColumn() / 100.0);
}

/**
 * Stability score: inverse of active war count + average colony energy balance.
 * No wars and all colonies energy-positive → 100.
 */
function calc_stability_score(PDO $db, int $uid): int
{
    $warCount = 0;
    try {
        $stmt = $db->prepare(
            "SELECT COUNT(*) FROM wars
             WHERE (attacker_id = ? OR defender_id = ?) AND status = 'active'"
        );
        $stmt->execute([$uid, $uid]);
        $warCount = (int)$stmt->fetchColumn();
    } catch (Throwable $ignored) {
        // wars table may not exist in all environments
    }

    $stmt2 = $db->prepare(
        'SELECT COALESCE(AVG(energy_balance), 0) FROM colonies WHERE user_id = ?'
    );
    $stmt2->execute([$uid]);
    $avgEnergy = (float)$stmt2->fetchColumn();

    $warPenalty    = min(100, $warCount * 20);
    $energyBonus   = clamp_score(50.0 + $avgEnergy);
    return clamp_score((float)($energyBonus - $warPenalty));
}

/**
 * Diplomacy score: based on count of positive faction standings.
 * Each standing > 0 counts as +10 pts, clamped to 100.
 */
function calc_diplomacy_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM diplomacy WHERE user_id = ? AND standing > 0'
    );
    $stmt->execute([$uid]);
    $positiveCount = (int)$stmt->fetchColumn();
    return clamp_score($positiveCount * 10.0);
}

/**
 * Espionage score: based on espionage agent count × average skill level.
 * 10 agents at skill 10 → 100.
 */
function calc_espionage_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) AS agent_count, COALESCE(AVG(skill_level), 0) AS avg_skill
         FROM espionage_agents WHERE user_id = ? AND status != 'retired'"
    );
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0;
    }
    return clamp_score((float)$row['agent_count'] * (float)$row['avg_skill']);
}

/**
 * Compute all 7 empire category scores and upsert into empire_category_scores.
 * Returns the scores array.
 *
 * @return array{economy:int,military:int,research:int,growth:int,stability:int,diplomacy:int,espionage:int,total:int}
 */
function calc_and_store_empire_scores(PDO $db, int $uid): array
{
    $economy   = calc_economy_score($db, $uid);
    $military  = calc_military_score($db, $uid);
    $research  = calc_research_score($db, $uid);
    $growth    = calc_growth_score($db, $uid);
    $stability = calc_stability_score($db, $uid);
    $diplomacy = calc_diplomacy_score($db, $uid);
    $espionage = calc_espionage_score($db, $uid);

    // Simple equal-weight total (max 700 → normalise to 0–700)
    $total = $economy + $military + $research + $growth + $stability + $diplomacy + $espionage;

    $db->prepare(
        'INSERT INTO empire_category_scores
             (user_id, score_economy, score_military, score_research,
              score_growth, score_stability, score_diplomacy, score_espionage,
              total_score, calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
             score_economy   = VALUES(score_economy),
             score_military  = VALUES(score_military),
             score_research  = VALUES(score_research),
             score_growth    = VALUES(score_growth),
             score_stability = VALUES(score_stability),
             score_diplomacy = VALUES(score_diplomacy),
             score_espionage = VALUES(score_espionage),
             total_score     = VALUES(total_score),
             calculated_at   = NOW()'
    )->execute([$uid, $economy, $military, $research, $growth, $stability, $diplomacy, $espionage, $total]);

    return compact('economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage', 'total');
}
