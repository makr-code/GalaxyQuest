<?php
/**
 * Hybrid Read-Model – Phase 1: User-Overview Projection + Dirty Queue
 *
 * Provides:
 *  - enqueue_dirty_user()             Idempotent dirty-queue insertion for a user.
 *  - read_user_overview_projection()  Returns a fresh projection payload or null.
 *  - write_user_overview_projection() Atomically persists a projection payload.
 *  - build_live_overview_payload()    Full live computation of the overview payload.
 *
 * Since Phase 3 the queue write is handled by enqueue_projection_dirty() from
 * lib/projection_runtime.php.  enqueue_dirty_user() is kept as a thin wrapper
 * so all existing call-sites continue to work without modification.
 *
 * Logging conventions (stderr-safe, visible in error_log):
 *  [projection] hit   user=<id>  age=<s>s
 *  [projection] miss  user=<id>  reason=<reason>
 *  [projection] write user=<id>  v=<version>
 *  [projection_runtime] enqueue  entity=user/<id>  reason=<reason>
 */

require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/../lib/projection_runtime.php';

/**
 * Enqueue a user into the shared dirty queue so the projector worker knows to
 * re-compute their overview projection.
 *
 * Thin wrapper around enqueue_projection_dirty() from lib/projection_runtime.php
 * that fixes entity_type='user' for backward compatibility.
 */
function enqueue_dirty_user(PDO $db, int $userId, string $reason = ''): void
{
    enqueue_projection_dirty($db, 'user', $userId, $reason);
}

/**
 * Read the stored projection for a user.
 *
 * Returns the decoded payload array on a cache-hit (projection exists,
 * stale_flag = 0, age ≤ PROJECTION_OVERVIEW_MAX_AGE_SECONDS).
 * Returns null on any miss so the caller falls back to live computation.
 */
function read_user_overview_projection(PDO $db, int $userId): ?array
{
    $maxAge = defined('PROJECTION_OVERVIEW_MAX_AGE_SECONDS')
        ? (int)PROJECTION_OVERVIEW_MAX_AGE_SECONDS
        : 120;

    try {
        $stmt = $db->prepare(
            'SELECT payload_json, stale_flag, updated_at
             FROM projection_user_overview
             WHERE user_id = ?'
        );
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log(sprintf('[projection] read_error user=%d  err=%s', $userId, $e->getMessage()));
        return null;
    }

    if (!$row) {
        error_log(sprintf('[projection] miss user=%d  reason=not_found', $userId));
        return null;
    }
    if ((int)$row['stale_flag'] !== 0) {
        error_log(sprintf('[projection] miss user=%d  reason=stale_flag', $userId));
        return null;
    }

    $ageSeconds = max(0, time() - strtotime((string)$row['updated_at']));
    if ($ageSeconds > $maxAge) {
        error_log(sprintf('[projection] miss user=%d  reason=too_old  age=%ds', $userId, $ageSeconds));
        return null;
    }

    $payload = json_decode((string)$row['payload_json'], true);
    if (!is_array($payload)) {
        error_log(sprintf('[projection] miss user=%d  reason=json_corrupt', $userId));
        return null;
    }

    error_log(sprintf('[projection] hit user=%d  age=%ds', $userId, $ageSeconds));
    return $payload;
}

/**
 * Atomically write (insert or replace) a projection payload for a user.
 * Increments the version counter and records the current unix timestamp as
 * source_tick.  Also clears stale_flag.
 */
function write_user_overview_projection(PDO $db, int $userId, array $payload): void
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tick = time();

    try {
        $db->prepare(
            'INSERT INTO projection_user_overview
                 (user_id, payload_json, version, updated_at, source_tick, stale_flag)
             VALUES (?, ?, 1, NOW(), ?, 0)
             ON DUPLICATE KEY UPDATE
                 payload_json = VALUES(payload_json),
                 version      = version + 1,
                 updated_at   = NOW(),
                 source_tick  = VALUES(source_tick),
                 stale_flag   = 0'
        )->execute([$userId, $json, $tick]);
        error_log(sprintf('[projection] write user=%d', $userId));
    } catch (Throwable $e) {
        error_log(sprintf('[projection] write_error user=%d  err=%s', $userId, $e->getMessage()));
    }
}

/**
 * Mark a user's projection as stale without deleting it.
 * This is lighter than re-projecting immediately and lets the worker handle it.
 */
function mark_projection_stale(PDO $db, int $userId): void
{
    try {
        $db->prepare(
            'UPDATE projection_user_overview SET stale_flag = 1 WHERE user_id = ?'
        )->execute([$userId]);
    } catch (Throwable $e) {
        error_log(sprintf('[projection] stale_error user=%d  err=%s', $userId, $e->getMessage()));
    }
}

/**
 * Build the full live overview payload for a user.
 *
 * This is the authoritative computation that matches the
 * game.php?action=overview response structure exactly.
 * It runs update_all_colonies() to keep resource counts fresh.
 *
 * When $runSessionSideEffects is true (default), achievements and the NPC
 * AI tick are also executed – use false in the projector worker to avoid
 * running session-scoped logic outside a user request.
 *
 * @param PDO  $db
 * @param int  $uid
 * @param bool $runSessionSideEffects  true = run achievements + NPC tick
 * @return array  The overview payload (same structure as the HTTP response body)
 */
function build_live_overview_payload(PDO $db, int $uid, bool $runSessionSideEffects = true): array
{
    // ── Offline-progress: snapshot before resource update ─────────────────────
    $offlineBeforeStmt = $db->prepare(
        'SELECT id, name, last_update, metal, crystal, deuterium, rare_earth, food, population,
                energy, max_population, happiness, public_services
         FROM colonies WHERE user_id = ? ORDER BY id ASC'
    );
    $offlineBeforeStmt->execute([$uid]);
    $offlineBeforeRows = $offlineBeforeStmt->fetchAll();
    $offlineBeforeById = [];
    foreach ($offlineBeforeRows as $row) {
        $offlineBeforeById[(int)$row['id']] = $row;
    }

    update_all_colonies($db, $uid);

    $offlineAfterStmt = $db->prepare(
        'SELECT id, name, last_update, metal, crystal, deuterium, rare_earth, food, population,
                energy, max_population, happiness, public_services
         FROM colonies WHERE user_id = ? ORDER BY id ASC'
    );
    $offlineAfterStmt->execute([$uid]);
    $offlineAfterRows = $offlineAfterStmt->fetchAll();

    $offlineEntries     = [];
    $offlineTotals      = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0, 'rare_earth' => 0.0, 'food' => 0.0, 'population' => 0];
    $offlineMaxElapsed  = 0;
    $offlineRateTotals  = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0, 'rare_earth' => 0.0, 'food' => 0.0, 'population' => 0.0];
    $economyStatusTotals = ['stable' => 0, 'watch' => 0, 'strain' => 0];
    $riskThresholds = [
        'food_rate_watch'         => -12.0,
        'food_rate_strain'        => -28.0,
        'food_per_capita_watch'   =>   1.35,
        'food_per_capita_strain'  =>   0.95,
        'energy_watch'            =>  -8.0,
        'energy_strain'           => -22.0,
        'welfare_watch'           =>  50.0,
        'welfare_strain'          =>  38.0,
    ];
    $topRisks       = [];
    $economyAverages = ['happiness_sum' => 0.0, 'services_sum' => 0.0, 'welfare_sum' => 0.0, 'count' => 0];

    foreach ($offlineAfterRows as $after) {
        $cid    = (int)$after['id'];
        $before = $offlineBeforeById[$cid] ?? null;
        if (!$before) {
            continue;
        }
        $beforeTs = strtotime((string)($before['last_update'] ?? ''));
        $elapsed  = is_int($beforeTs) ? max(0, time() - $beforeTs) : 0;
        if ($elapsed <= 0) {
            continue;
        }

        $deltaMetal      = (float)$after['metal']      - (float)$before['metal'];
        $deltaCrystal    = (float)$after['crystal']    - (float)$before['crystal'];
        $deltaDeut       = (float)$after['deuterium']  - (float)$before['deuterium'];
        $deltaRare       = (float)$after['rare_earth'] - (float)$before['rare_earth'];
        $deltaFood       = (float)$after['food']       - (float)$before['food'];
        $deltaPopulation = (int)$after['population']   - (int)$before['population'];
        $hourFactor      = $elapsed > 0 ? (3600 / $elapsed) : 0;
        $riskHourFactor  = 3600 / max(1200, $elapsed);

        $rateMetal      = $deltaMetal      * $hourFactor;
        $rateCrystal    = $deltaCrystal    * $hourFactor;
        $rateDeut       = $deltaDeut       * $hourFactor;
        $rateRare       = $deltaRare       * $hourFactor;
        $rateFood       = $deltaFood       * $hourFactor;
        $ratePopulation = $deltaPopulation * $hourFactor;
        $riskRateFood   = $deltaFood       * $riskHourFactor;

        $populationNow  = max(1, (int)($after['population']      ?? 0));
        $foodNow        = (float)($after['food']                  ?? 0);
        $energyNow      = (float)($after['energy']                ?? 0);
        $happinessNow   = (float)($after['happiness']             ?? 0);
        $servicesNow    = (float)($after['public_services']       ?? 0);
        $foodPerCapita  = $foodNow / $populationNow;
        $welfare        = ($happinessNow + $servicesNow) / 2;

        $riskFlags = [];
        $riskScore = 0;
        if ($riskRateFood <= $riskThresholds['food_rate_strain']) {
            $riskFlags[] = 'food_decline'; $riskScore += 3;
        } elseif ($riskRateFood <= $riskThresholds['food_rate_watch']) {
            $riskFlags[] = 'food_decline'; $riskScore += 1;
        }
        if ($foodPerCapita <= $riskThresholds['food_per_capita_strain']) {
            $riskFlags[] = 'low_food_buffer'; $riskScore += 3;
        } elseif ($foodPerCapita <= $riskThresholds['food_per_capita_watch']) {
            $riskFlags[] = 'low_food_buffer'; $riskScore += 1;
        }
        if ($energyNow <= $riskThresholds['energy_strain']) {
            $riskFlags[] = 'energy_deficit'; $riskScore += 3;
        } elseif ($energyNow <= $riskThresholds['energy_watch']) {
            $riskFlags[] = 'energy_deficit'; $riskScore += 1;
        }
        if ($welfare <= $riskThresholds['welfare_strain']) {
            $riskFlags[] = 'low_welfare'; $riskScore += 3;
        } elseif ($welfare <= $riskThresholds['welfare_watch']) {
            $riskFlags[] = 'low_welfare'; $riskScore += 1;
        }

        $statusCode  = 'stable';
        if ($riskScore >= 5)      { $statusCode = 'strain'; }
        elseif ($riskScore >= 1)  { $statusCode = 'watch'; }
        $statusLabel = $statusCode === 'stable' ? 'Stable' : ($statusCode === 'strain' ? 'Strained' : 'Watch');

        $offlineTotals['metal']      += $deltaMetal;
        $offlineTotals['crystal']    += $deltaCrystal;
        $offlineTotals['deuterium']  += $deltaDeut;
        $offlineTotals['rare_earth'] += $deltaRare;
        $offlineTotals['food']       += $deltaFood;
        $offlineTotals['population'] += $deltaPopulation;
        $offlineMaxElapsed            = max($offlineMaxElapsed, $elapsed);
        $offlineRateTotals['metal']      += $rateMetal;
        $offlineRateTotals['crystal']    += $rateCrystal;
        $offlineRateTotals['deuterium']  += $rateDeut;
        $offlineRateTotals['rare_earth'] += $rateRare;
        $offlineRateTotals['food']       += $rateFood;
        $offlineRateTotals['population'] += $ratePopulation;
        $economyStatusTotals[$statusCode] += 1;
        $economyAverages['happiness_sum'] += $happinessNow;
        $economyAverages['services_sum']  += $servicesNow;
        $economyAverages['welfare_sum']   += $welfare;
        $economyAverages['count']         += 1;
        if ($riskScore > 0) {
            $topRisks[] = [
                'colony_id'          => $cid,
                'colony_name'        => (string)($after['name'] ?? $before['name'] ?? ('Colony #' . $cid)),
                'status'             => $statusCode,
                'risk_score'         => $riskScore,
                'risk_flags'         => $riskFlags,
                'welfare'            => round($welfare, 1),
                'food_per_capita'    => round($foodPerCapita, 2),
                'energy'             => round($energyNow, 2),
                'food_rate_per_hour' => round($riskRateFood, 2),
            ];
        }

        $offlineEntries[] = [
            'colony_id'   => $cid,
            'colony_name' => (string)($after['name'] ?? $before['name'] ?? ('Colony #' . $cid)),
            'elapsed_seconds' => $elapsed,
            'delta' => [
                'metal'      => round($deltaMetal, 2),
                'crystal'    => round($deltaCrystal, 2),
                'deuterium'  => round($deltaDeut, 2),
                'rare_earth' => round($deltaRare, 2),
                'food'       => round($deltaFood, 2),
                'population' => $deltaPopulation,
            ],
            'rates_per_hour' => [
                'metal'      => round($rateMetal, 2),
                'crystal'    => round($rateCrystal, 2),
                'deuterium'  => round($rateDeut, 2),
                'rare_earth' => round($rateRare, 2),
                'food'       => round($rateFood, 2),
                'population' => round($ratePopulation, 2),
            ],
            'status' => [
                'code'           => $statusCode,
                'label'          => $statusLabel,
                'risk_flags'     => $riskFlags,
                'welfare'        => round($welfare, 1),
                'food_per_capita'=> round($foodPerCapita, 2),
                'energy'         => round($energyNow, 2),
            ],
        ];
    }

    $avgCount = max(1, (int)$economyAverages['count']);
    usort($topRisks, static function (array $a, array $b): int {
        return ($b['risk_score'] <=> $a['risk_score'])
            ?: (($a['welfare'] ?? 100) <=> ($b['welfare'] ?? 100));
    });
    $economySnapshot = [
        'status_counts'       => $economyStatusTotals,
        'avg_happiness'       => round($economyAverages['happiness_sum'] / $avgCount, 1),
        'avg_public_services' => round($economyAverages['services_sum']  / $avgCount, 1),
        'avg_welfare'         => round($economyAverages['welfare_sum']   / $avgCount, 1),
        'risk_thresholds'     => $riskThresholds,
        'top_risks'           => array_slice($topRisks, 0, 4),
        'net_rates_per_hour'  => [
            'metal'      => round($offlineRateTotals['metal'],      2),
            'crystal'    => round($offlineRateTotals['crystal'],    2),
            'deuterium'  => round($offlineRateTotals['deuterium'],  2),
            'rare_earth' => round($offlineRateTotals['rare_earth'], 2),
            'food'       => round($offlineRateTotals['food'],       2),
            'population' => round($offlineRateTotals['population'], 2),
        ],
    ];

    $offlineReport = [
        'had_offline_time'   => !empty($offlineEntries),
        'max_elapsed_seconds'=> $offlineMaxElapsed,
        'totals' => [
            'metal'      => round($offlineTotals['metal'],      2),
            'crystal'    => round($offlineTotals['crystal'],    2),
            'deuterium'  => round($offlineTotals['deuterium'],  2),
            'rare_earth' => round($offlineTotals['rare_earth'], 2),
            'food'       => round($offlineTotals['food'],       2),
            'population' => (int)$offlineTotals['population'],
        ],
        'rates_per_hour' => $economySnapshot['net_rates_per_hour'],
        'economy'        => $economySnapshot,
        'colonies'       => $offlineEntries,
    ];

    // ── Session side-effects (achievements + NPC tick) ─────────────────────────
    if ($runSessionSideEffects) {
        check_and_update_achievements($db, $uid);
        require_once __DIR__ . '/npc_ai.php';
        try { npc_ai_tick($db, $uid); } catch (Throwable $e) { error_log('npc_ai_tick error: ' . $e->getMessage()); }
    }

    // ── Politics runtime ──────────────────────────────────────────────────────
    $politicsRuntime = [
        'effects'         => empire_dynamic_effects($db, $uid),
        'pressure_events' => apply_faction_pressure_situations($db, $uid),
    ];

    // ── User meta ─────────────────────────────────────────────────────────────
    $metaStmt = $db->prepare(
        'SELECT dark_matter, rank_points, protection_until, vacation_mode, pvp_mode
         FROM users WHERE id = ?'
    );
    $metaStmt->execute([$uid]);
    $meta = $metaStmt->fetch();

    $badgeStmt = $db->prepare(
        'SELECT COUNT(*) FROM user_achievements
         WHERE user_id = ? AND completed = 1 AND reward_claimed = 0'
    );
    $badgeStmt->execute([$uid]);
    $meta['unclaimed_quests'] = (int)$badgeStmt->fetchColumn();

    // ── Colonies with planet data ──────────────────────────────────────────────
    $colStmt = $db->prepare(
        'SELECT c.id, c.name, c.colony_type, c.metal, c.crystal, c.deuterium,
                c.rare_earth, c.food, c.energy, c.population, c.max_population,
                c.happiness, c.public_services, c.is_homeworld, c.last_update,
                p.id AS planet_id, p.galaxy, p.`system`, p.position,
                p.type AS planet_type, p.planet_class, p.diameter,
                p.temp_min, p.temp_max, p.in_habitable_zone, p.semi_major_axis_au,
                p.orbital_period_days, p.surface_gravity_g, p.atmosphere_type,
                p.richness_metal, p.richness_crystal, p.richness_deuterium, p.richness_rare_earth,
                p.deposit_metal, p.deposit_crystal, p.deposit_deuterium, p.deposit_rare_earth
         FROM colonies c
         JOIN planets p ON p.id = c.planet_id
         WHERE c.user_id = ?
         ORDER BY c.is_homeworld DESC, c.id ASC'
    );
    $colStmt->execute([$uid]);
    $colonies = $colStmt->fetchAll();

    // ── Assigned leaders per colony ───────────────────────────────────────────
    $leadStmt = $db->prepare(
        'SELECT id, colony_id, name, role, level, autonomy, last_action
         FROM leaders WHERE user_id = ? AND colony_id IS NOT NULL'
    );
    $leadStmt->execute([$uid]);
    $leadersByColony = [];
    foreach ($leadStmt->fetchAll() as $l) {
        $leadersByColony[(int)$l['colony_id']][] = $l;
    }
    foreach ($colonies as &$col) {
        $col['layout']  = colony_layout_profile($col);
        $col['leaders'] = $leadersByColony[(int)$col['id']] ?? [];
    }
    unset($col);

    // ── Active planetary events per colony ────────────────────────────────────
    $colonyEventsByColony = [];
    try {
        $ceStmt = $db->prepare(
            'SELECT colony_id, event_type, started_at, expires_at
             FROM colony_events
             WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)
               AND expires_at > NOW()'
        );
        $ceStmt->execute([$uid]);
        foreach ($ceStmt->fetchAll() as $ce) {
            $expiry = strtotime($ce['expires_at']);
            $colonyEventsByColony[(int)$ce['colony_id']] = [
                'type'        => $ce['event_type'],
                'started_at'  => $ce['started_at'],
                'expires_at'  => $ce['expires_at'],
                'ends_in_min' => max(0, (int)round(($expiry - time()) / 60)),
            ];
        }
    } catch (Throwable $e) { /* pre-migration: table may not exist */ }
    foreach ($colonies as &$col) {
        $col['active_event'] = $colonyEventsByColony[(int)$col['id']] ?? null;
    }
    unset($col);

    // ── Fleets ────────────────────────────────────────────────────────────────
    $fleetStmt = $db->prepare(
        'SELECT f.id, f.mission, f.origin_colony_id,
                f.target_galaxy, f.target_system, f.target_position,
                f.ships_json,
                f.cargo_metal, f.cargo_crystal, f.cargo_deuterium,
                f.origin_x_ly, f.origin_y_ly, f.origin_z_ly,
                f.target_x_ly, f.target_y_ly, f.target_z_ly,
                f.speed_ly_h, f.distance_ly,
                f.departure_time, f.arrival_time, f.return_time, f.returning,
                p.galaxy AS origin_galaxy, p.`system` AS origin_system, p.position AS origin_position
         FROM fleets f
         JOIN colonies c ON c.id = f.origin_colony_id
         JOIN planets  p ON p.id = c.planet_id
         WHERE f.user_id = ? ORDER BY f.arrival_time ASC'
    );
    $fleetStmt->execute([$uid]);
    $fleets = [];
    foreach ($fleetStmt->fetchAll() as $f) {
        $ships = json_decode((string)$f['ships_json'], true);
        $f['ships']   = is_array($ships) ? $ships : [];
        $f['vessels'] = vessel_manifest($f['ships']);
        unset($f['ships_json']);
        $f['current_pos'] = fleet_current_position($f);
        $fleets[] = $f;
    }

    // ── Unread messages ───────────────────────────────────────────────────────
    $unreadStmt = $db->prepare('SELECT COUNT(*) FROM messages WHERE receiver_id=? AND is_read=0');
    $unreadStmt->execute([$uid]);

    // ── Recent battle reports (last 5) ────────────────────────────────────────
    $battleStmt = $db->prepare(
        'SELECT br.id, br.created_at, br.report_json,
                u.username AS defender_name
         FROM battle_reports br
         JOIN users u ON u.id = br.defender_id
         WHERE br.attacker_id = ?
         ORDER BY br.created_at DESC LIMIT 5'
    );
    $battleStmt->execute([$uid]);
    $battles = [];
    foreach ($battleStmt->fetchAll() as $b) {
        $b['report'] = json_decode($b['report_json'], true);
        unset($b['report_json']);
        $battles[] = $b;
    }

    return [
        'user_meta'        => $meta,
        'offline_progress' => $offlineReport,
        'politics'         => $politicsRuntime,
        'colonies'         => $colonies,
        'fleets'           => $fleets,
        'battles'          => $battles,
        'unread_msgs'      => (int)$unreadStmt->fetchColumn(),
    ];
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 2 – System-Snapshot Projection
// ════════════════════════════════════════════════════════════════════════════

/**
 * Encode a (galaxy, system_index) pair into a single integer for use as
 * entity_id in the dirty queue.
 *
 * Encoding: galaxy * 100_000 + system_index
 * Safe for GALAXY_MAX=9, SYSTEM_MAX=25000 (max value = 925 000, fits INT).
 */
function system_dirty_entity_id(int $galaxy, int $systemIndex): int
{
    return $galaxy * 100_000 + $systemIndex;
}

/**
 * Decode a system entity_id back into [galaxy, system_index].
 *
 * @return array{galaxy:int,system_index:int}
 */
function system_dirty_decode(int $entityId): array
{
    return [
        'galaxy'       => intdiv($entityId, 100_000),
        'system_index' => $entityId % 100_000,
    ];
}

/**
 * Idempotently enqueue a (galaxy, system_index) pair into the dirty queue.
 *
 * Duplicate entries are coalesced via ON DUPLICATE KEY UPDATE so that rapid
 * successive writes produce exactly one queue entry with a refreshed
 * enqueued_at and zeroed attempts counter.
 *
 * Errors are swallowed – dirty-queue failures must never interrupt a write path.
 */
function enqueue_dirty_system(PDO $db, int $galaxy, int $systemIndex, string $reason = ''): void
{
    $entityId = system_dirty_entity_id($galaxy, $systemIndex);
    try {
        $db->prepare(
            'INSERT INTO projection_dirty_queue
                 (entity_type, entity_id, reason, enqueued_at, attempts, next_attempt_at)
             VALUES (\'system\', ?, ?, NOW(), 0, NOW())
             ON DUPLICATE KEY UPDATE
                 reason          = VALUES(reason),
                 enqueued_at     = NOW(),
                 attempts        = 0,
                 last_error      = NULL,
                 next_attempt_at = NOW()'
        )->execute([$entityId, $reason]);
        error_log(sprintf('[projection] enqueue system=%d:%d  reason=%s', $galaxy, $systemIndex, $reason));
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] enqueue_system_error galaxy=%d system=%d  err=%s',
            $galaxy, $systemIndex, $e->getMessage()
        ));
    }
}

/**
 * Read a stored system snapshot.
 *
 * Returns the decoded payload array on a cache-hit (snapshot present,
 * stale_flag = 0, age ≤ PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS).
 * Returns null on any miss so the caller falls back to the live query.
 */
function read_system_snapshot(PDO $db, int $galaxy, int $systemIndex): ?array
{
    $maxAge = defined('PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS')
        ? (int)PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS
        : 300;

    try {
        $stmt = $db->prepare(
            'SELECT payload_json, stale_flag, updated_at
             FROM projection_system_snapshot
             WHERE galaxy = ? AND system_index = ?'
        );
        $stmt->execute([$galaxy, $systemIndex]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] read_system_error galaxy=%d system=%d  err=%s',
            $galaxy, $systemIndex, $e->getMessage()
        ));
        return null;
    }

    if (!$row) {
        error_log(sprintf('[projection] system_miss galaxy=%d system=%d  reason=not_found', $galaxy, $systemIndex));
        return null;
    }
    if ((int)$row['stale_flag'] !== 0) {
        error_log(sprintf('[projection] system_miss galaxy=%d system=%d  reason=stale_flag', $galaxy, $systemIndex));
        return null;
    }

    $ageSeconds = max(0, time() - strtotime((string)$row['updated_at']));
    if ($ageSeconds > $maxAge) {
        error_log(sprintf(
            '[projection] system_miss galaxy=%d system=%d  reason=too_old  age=%ds',
            $galaxy, $systemIndex, $ageSeconds
        ));
        return null;
    }

    $payload = json_decode((string)$row['payload_json'], true);
    if (!is_array($payload)) {
        error_log(sprintf(
            '[projection] system_miss galaxy=%d system=%d  reason=json_corrupt',
            $galaxy, $systemIndex
        ));
        return null;
    }

    error_log(sprintf('[projection] system_hit galaxy=%d system=%d  age=%ds', $galaxy, $systemIndex, $ageSeconds));
    return $payload;
}

/**
 * Read system snapshots for a range of system indices in a single query.
 *
 * Returns an associative array keyed by system_index.  Missing, stale, or
 * expired entries are omitted so the caller can detect misses per-system.
 *
 * @return array<int,array<string,mixed>>  Keyed by system_index.
 */
function read_system_snapshot_range(PDO $db, int $galaxy, int $fromSystem, int $toSystem, int $stride = 1): array
{
    $maxAge = defined('PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS')
        ? (int)PROJECTION_SYSTEM_SNAPSHOT_MAX_AGE_SECONDS
        : 300;

    $cutoff = date('Y-m-d H:i:s', time() - $maxAge);

    try {
        $stmt = $db->prepare(
            'SELECT system_index, payload_json
             FROM projection_system_snapshot
             WHERE galaxy = ?
               AND system_index BETWEEN ? AND ?
               AND MOD(system_index - ?, ?) = 0
               AND stale_flag = 0
               AND updated_at >= ?'
        );
        $stmt->execute([$galaxy, $fromSystem, $toSystem, $fromSystem, $stride, $cutoff]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] read_system_range_error galaxy=%d from=%d to=%d  err=%s',
            $galaxy, $fromSystem, $toSystem, $e->getMessage()
        ));
        return [];
    }

    $result = [];
    foreach ($rows as $row) {
        $payload = json_decode((string)$row['payload_json'], true);
        if (is_array($payload)) {
            $result[(int)$row['system_index']] = $payload;
        }
    }
    return $result;
}

/**
 * Atomically write (insert or replace) a system snapshot.
 *
 * Increments the version counter and records the current unix timestamp as
 * source_tick.  Also clears stale_flag.
 *
 * @param array<string,mixed> $payload
 */
function write_system_snapshot(PDO $db, int $galaxy, int $systemIndex, array $payload): void
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tick = time();
    $ownerUserId     = (int)($payload['colony_owner_user_id'] ?? 0);
    $colonyCount     = (int)($payload['colony_count'] ?? 0);
    $colonyPop       = (int)($payload['colony_population'] ?? 0);

    try {
        $db->prepare(
            'INSERT INTO projection_system_snapshot
                 (galaxy, system_index, payload_json, owner_user_id, colony_count, colony_population,
                  version, updated_at, source_tick, stale_flag)
             VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), ?, 0)
             ON DUPLICATE KEY UPDATE
                 payload_json      = VALUES(payload_json),
                 owner_user_id     = VALUES(owner_user_id),
                 colony_count      = VALUES(colony_count),
                 colony_population = VALUES(colony_population),
                 version           = version + 1,
                 updated_at        = NOW(),
                 source_tick       = VALUES(source_tick),
                 stale_flag        = 0'
        )->execute([$galaxy, $systemIndex, $json, $ownerUserId, $colonyCount, $colonyPop, $tick]);
        error_log(sprintf('[projection] system_write galaxy=%d system=%d', $galaxy, $systemIndex));
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] system_write_error galaxy=%d system=%d  err=%s',
            $galaxy, $systemIndex, $e->getMessage()
        ));
    }
}

/**
 * Mark a system snapshot as stale without deleting it.
 *
 * The snapshot remains readable until the worker refreshes it; the stale_flag
 * causes read_system_snapshot() to treat it as a miss (forcing live fallback).
 */
function mark_system_snapshot_stale(PDO $db, int $galaxy, int $systemIndex): void
{
    try {
        $db->prepare(
            'UPDATE projection_system_snapshot SET stale_flag = 1
             WHERE galaxy = ? AND system_index = ?'
        )->execute([$galaxy, $systemIndex]);
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] system_stale_error galaxy=%d system=%d  err=%s',
            $galaxy, $systemIndex, $e->getMessage()
        ));
    }
}

/**
 * Compute the snapshot payload for one system.
 *
 * Returns an array with the same fields the action=stars live query produces
 * for a single star row (minus user-specific FOW data, which is applied per
 * request on top of the snapshot).
 *
 * Returns null if the star_systems row does not yet exist for the requested
 * (galaxy, system_index).
 *
 * @return array<string,mixed>|null
 */
function build_system_snapshot_payload(PDO $db, int $galaxy, int $systemIndex): ?array
{
    // Star descriptor (required – snapshot is pointless without it).
    try {
        $starStmt = $db->prepare(
            'SELECT ss.id, ss.galaxy_index, ss.system_index, ss.name,
                    COALESCE(NULLIF(ss.catalog_name, ""), ss.name) AS catalog_name,
                    ss.spectral_class, ss.subtype,
                    ss.x_ly, ss.y_ly, ss.z_ly,
                    ss.planet_count, ss.hz_inner_au, ss.hz_outer_au
             FROM star_systems ss
             WHERE ss.galaxy_index = ? AND ss.system_index = ?
             LIMIT 1'
        );
        $starStmt->execute([$galaxy, $systemIndex]);
        $star = $starStmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log(sprintf(
            '[projection] build_snapshot_error galaxy=%d system=%d  err=%s',
            $galaxy, $systemIndex, $e->getMessage()
        ));
        return null;
    }

    if (!is_array($star) || empty($star)) {
        return null;
    }

    // Colony aggregate (optional – system may be unoccupied).
    try {
        $colStmt = $db->prepare(
            'SELECT COUNT(DISTINCT c.id) AS colony_count,
                    COALESCE(SUM(c.population), 0) AS colony_population,
                    SUBSTRING_INDEX(
                        GROUP_CONCAT(
                            CAST(c.user_id AS CHAR)
                            ORDER BY COALESCE(c.population, 0) DESC, c.id ASC
                            SEPARATOR ","
                        ), ",", 1
                    ) AS colony_owner_user_id,
                    SUBSTRING_INDEX(
                        GROUP_CONCAT(
                            COALESCE(u.username, "")
                            ORDER BY COALESCE(c.population, 0) DESC, c.id ASC
                            SEPARATOR ","
                        ), ",", 1
                    ) AS colony_owner_name,
                    SUBSTRING_INDEX(
                        GROUP_CONCAT(
                            COALESCE(NULLIF(u.empire_color, ""), "#6a8cc9")
                            ORDER BY COALESCE(c.population, 0) DESC, c.id ASC
                            SEPARATOR ","
                        ), ",", 1
                    ) AS colony_owner_color
             FROM planets p
             JOIN colonies c ON c.planet_id = p.id
             LEFT JOIN users u ON u.id = c.user_id
             WHERE p.galaxy = ? AND p.`system` = ?'
        );
        $colStmt->execute([$galaxy, $systemIndex]);
        $col = $colStmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        // users table may not have empire_color yet; fall back to simpler query.
        try {
            $colStmt2 = $db->prepare(
                'SELECT COUNT(DISTINCT c.id) AS colony_count,
                        COALESCE(SUM(c.population), 0) AS colony_population,
                        SUBSTRING_INDEX(
                            GROUP_CONCAT(
                                CAST(c.user_id AS CHAR)
                                ORDER BY COALESCE(c.population, 0) DESC, c.id ASC
                                SEPARATOR ","
                            ), ",", 1
                        ) AS colony_owner_user_id,
                        SUBSTRING_INDEX(
                            GROUP_CONCAT(
                                COALESCE(u.username, "")
                                ORDER BY COALESCE(c.population, 0) DESC, c.id ASC
                                SEPARATOR ","
                            ), ",", 1
                        ) AS colony_owner_name,
                        "" AS colony_owner_color
                 FROM planets p
                 JOIN colonies c ON c.planet_id = p.id
                 LEFT JOIN users u ON u.id = c.user_id
                 WHERE p.galaxy = ? AND p.`system` = ?'
            );
            $colStmt2->execute([$galaxy, $systemIndex]);
            $col = $colStmt2->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $e2) {
            $col = false;
        }
    }

    $colonyCount     = is_array($col) ? (int)($col['colony_count'] ?? 0)     : 0;
    $colonyPop       = is_array($col) ? (int)($col['colony_population'] ?? 0) : 0;
    $ownerUserId     = is_array($col) ? (int)($col['colony_owner_user_id'] ?? 0)  : 0;
    $ownerName       = is_array($col) ? (string)($col['colony_owner_name'] ?? '')  : '';
    $ownerColor      = is_array($col) ? (string)($col['colony_owner_color'] ?? '') : '';

    return array_merge($star, [
        'colony_count'          => $colonyCount,
        'colony_population'     => $colonyPop,
        'colony_owner_user_id'  => $ownerUserId,
        'colony_owner_name'     => $ownerName,
        'colony_owner_color'    => $ownerColor,
    ]);
}
