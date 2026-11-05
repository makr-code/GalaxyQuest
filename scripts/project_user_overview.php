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
        // Build the full overview payload (without session side-effects like NPC tick).
        $payload = build_live_overview_payload($db, $userId, false);

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
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM wars
         WHERE (attacker_user_id = ? OR defender_user_id = ?) AND status = 'active'"
    );
    $stmt->execute([$uid, $uid]);
    $warCount = (int)$stmt->fetchColumn();

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
        'SELECT COUNT(*)
         FROM npc_factions f
         LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
         WHERE COALESCE(d.standing, f.base_diplomacy, 0) > 0'
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
 * Compute all 7 empire category scores without persisting them.
 *
 * @return array{economy:int,military:int,research:int,growth:int,stability:int,diplomacy:int,espionage:int,total:int}
 */
function calc_empire_scores(PDO $db, int $uid): array
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

    return compact('economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage', 'total');
}

/**
 * Compute and persist all 7 empire category scores.
 *
 * @return array{economy:int,military:int,research:int,growth:int,stability:int,diplomacy:int,espionage:int,total:int}
 */
function calc_and_store_empire_scores(PDO $db, int $uid): array
{
    $scores = calc_empire_scores($db, $uid);

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
    )->execute([
        $uid,
        $scores['economy'],
        $scores['military'],
        $scores['research'],
        $scores['growth'],
        $scores['stability'],
        $scores['diplomacy'],
        $scores['espionage'],
        $scores['total'],
    ]);

    return $scores;
}
