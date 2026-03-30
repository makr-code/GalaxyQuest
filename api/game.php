<?php
/**
 * Game data API
 * GET  /api/game.php?action=overview
 * GET  /api/game.php?action=resources&colony_id=X
 * GET  /api/game.php?action=health
 * POST /api/game.php?action=pvp_toggle
 * POST /api/game.php?action=rename_colony   body: {colony_id, name}
 * POST /api/game.php?action=set_colony_type body: {colony_id, colony_type}
 * POST /api/game.php?action=set_ftl_drive   body: {ftl_drive_type}
 * GET  /api/game.php?action=leaderboard
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/buildings.php';   // verify_colony_ownership
require_once __DIR__ . '/galaxy_seed.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {

    // ── Overview ──────────────────────────────────────────────────────────────
    case 'overview':
        only_method('GET');
        $db = get_db();
        $overviewCacheKey = ['uid' => $uid];
        $cachedOverview = gq_cache_get('game_overview', $overviewCacheKey);
        if (is_array($cachedOverview) && isset($cachedOverview['user_meta'])) {
            json_ok($cachedOverview);
        }

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

        $offlineEntries = [];
        $offlineTotals = [
            'metal' => 0.0,
            'crystal' => 0.0,
            'deuterium' => 0.0,
            'rare_earth' => 0.0,
            'food' => 0.0,
            'population' => 0,
        ];
        $offlineMaxElapsed = 0;
        $offlineRateTotals = [
            'metal' => 0.0,
            'crystal' => 0.0,
            'deuterium' => 0.0,
            'rare_earth' => 0.0,
            'food' => 0.0,
            'population' => 0.0,
        ];
        $economyStatusTotals = [
            'stable' => 0,
            'watch' => 0,
            'strain' => 0,
        ];
        $riskThresholds = [
            'food_rate_watch' => -12.0,
            'food_rate_strain' => -28.0,
            'food_per_capita_watch' => 1.35,
            'food_per_capita_strain' => 0.95,
            'energy_watch' => -8.0,
            'energy_strain' => -22.0,
            'welfare_watch' => 50.0,
            'welfare_strain' => 38.0,
        ];
        $topRisks = [];
        $economyAverages = [
            'happiness_sum' => 0.0,
            'services_sum' => 0.0,
            'welfare_sum' => 0.0,
            'count' => 0,
        ];
        foreach ($offlineAfterRows as $after) {
            $cid = (int)$after['id'];
            $before = $offlineBeforeById[$cid] ?? null;
            if (!$before) {
                continue;
            }
            $beforeTs = strtotime((string)($before['last_update'] ?? ''));
            $elapsed = is_int($beforeTs) ? max(0, time() - $beforeTs) : 0;
            if ($elapsed <= 0) {
                continue;
            }

            $deltaMetal = (float)$after['metal'] - (float)$before['metal'];
            $deltaCrystal = (float)$after['crystal'] - (float)$before['crystal'];
            $deltaDeut = (float)$after['deuterium'] - (float)$before['deuterium'];
            $deltaRare = (float)$after['rare_earth'] - (float)$before['rare_earth'];
            $deltaFood = (float)$after['food'] - (float)$before['food'];
            $deltaPopulation = (int)$after['population'] - (int)$before['population'];
            $hourFactor = $elapsed > 0 ? (3600 / $elapsed) : 0;
            $riskHourFactor = 3600 / max(1200, $elapsed);

            $rateMetal = $deltaMetal * $hourFactor;
            $rateCrystal = $deltaCrystal * $hourFactor;
            $rateDeut = $deltaDeut * $hourFactor;
            $rateRare = $deltaRare * $hourFactor;
            $rateFood = $deltaFood * $hourFactor;
            $ratePopulation = $deltaPopulation * $hourFactor;
            $riskRateFood = $deltaFood * $riskHourFactor;

            $populationNow = max(1, (int)($after['population'] ?? 0));
            $foodNow = (float)($after['food'] ?? 0);
            $energyNow = (float)($after['energy'] ?? 0);
            $happinessNow = (float)($after['happiness'] ?? 0);
            $servicesNow = (float)($after['public_services'] ?? 0);
            $foodPerCapita = $foodNow / $populationNow;
            $welfare = ($happinessNow + $servicesNow) / 2;

            $riskFlags = [];
            $riskScore = 0;
            if ($riskRateFood <= $riskThresholds['food_rate_strain']) {
                $riskFlags[] = 'food_decline';
                $riskScore += 3;
            } elseif ($riskRateFood <= $riskThresholds['food_rate_watch']) {
                $riskFlags[] = 'food_decline';
                $riskScore += 1;
            }
            if ($foodPerCapita <= $riskThresholds['food_per_capita_strain']) {
                $riskFlags[] = 'low_food_buffer';
                $riskScore += 3;
            } elseif ($foodPerCapita <= $riskThresholds['food_per_capita_watch']) {
                $riskFlags[] = 'low_food_buffer';
                $riskScore += 1;
            }
            if ($energyNow <= $riskThresholds['energy_strain']) {
                $riskFlags[] = 'energy_deficit';
                $riskScore += 3;
            } elseif ($energyNow <= $riskThresholds['energy_watch']) {
                $riskFlags[] = 'energy_deficit';
                $riskScore += 1;
            }
            if ($welfare <= $riskThresholds['welfare_strain']) {
                $riskFlags[] = 'low_welfare';
                $riskScore += 3;
            } elseif ($welfare <= $riskThresholds['welfare_watch']) {
                $riskFlags[] = 'low_welfare';
                $riskScore += 1;
            }

            $statusCode = 'stable';
            if ($riskScore >= 5) {
                $statusCode = 'strain';
            } elseif ($riskScore >= 1) {
                $statusCode = 'watch';
            }
            $statusLabel = $statusCode === 'stable'
                ? 'Stable'
                : ($statusCode === 'strain' ? 'Strained' : 'Watch');

            $offlineTotals['metal'] += $deltaMetal;
            $offlineTotals['crystal'] += $deltaCrystal;
            $offlineTotals['deuterium'] += $deltaDeut;
            $offlineTotals['rare_earth'] += $deltaRare;
            $offlineTotals['food'] += $deltaFood;
            $offlineTotals['population'] += $deltaPopulation;
            $offlineMaxElapsed = max($offlineMaxElapsed, $elapsed);
            $offlineRateTotals['metal'] += $rateMetal;
            $offlineRateTotals['crystal'] += $rateCrystal;
            $offlineRateTotals['deuterium'] += $rateDeut;
            $offlineRateTotals['rare_earth'] += $rateRare;
            $offlineRateTotals['food'] += $rateFood;
            $offlineRateTotals['population'] += $ratePopulation;
            $economyStatusTotals[$statusCode] += 1;
            $economyAverages['happiness_sum'] += $happinessNow;
            $economyAverages['services_sum'] += $servicesNow;
            $economyAverages['welfare_sum'] += $welfare;
            $economyAverages['count'] += 1;
            if ($riskScore > 0) {
                $topRisks[] = [
                    'colony_id' => $cid,
                    'colony_name' => (string)($after['name'] ?? $before['name'] ?? ('Colony #' . $cid)),
                    'status' => $statusCode,
                    'risk_score' => $riskScore,
                    'risk_flags' => $riskFlags,
                    'welfare' => round($welfare, 1),
                    'food_per_capita' => round($foodPerCapita, 2),
                    'energy' => round($energyNow, 2),
                    'food_rate_per_hour' => round($riskRateFood, 2),
                ];
            }

            $offlineEntries[] = [
                'colony_id' => $cid,
                'colony_name' => (string)($after['name'] ?? $before['name'] ?? ('Colony #' . $cid)),
                'elapsed_seconds' => $elapsed,
                'delta' => [
                    'metal' => round($deltaMetal, 2),
                    'crystal' => round($deltaCrystal, 2),
                    'deuterium' => round($deltaDeut, 2),
                    'rare_earth' => round($deltaRare, 2),
                    'food' => round($deltaFood, 2),
                    'population' => $deltaPopulation,
                ],
                'rates_per_hour' => [
                    'metal' => round($rateMetal, 2),
                    'crystal' => round($rateCrystal, 2),
                    'deuterium' => round($rateDeut, 2),
                    'rare_earth' => round($rateRare, 2),
                    'food' => round($rateFood, 2),
                    'population' => round($ratePopulation, 2),
                ],
                'status' => [
                    'code' => $statusCode,
                    'label' => $statusLabel,
                    'risk_flags' => $riskFlags,
                    'welfare' => round($welfare, 1),
                    'food_per_capita' => round($foodPerCapita, 2),
                    'energy' => round($energyNow, 2),
                ],
            ];
        }

        $avgCount = max(1, (int)$economyAverages['count']);
        usort($topRisks, static function (array $a, array $b): int {
            return ($b['risk_score'] <=> $a['risk_score'])
                ?: (($a['welfare'] ?? 100) <=> ($b['welfare'] ?? 100));
        });
        $economySnapshot = [
            'status_counts' => $economyStatusTotals,
            'avg_happiness' => round($economyAverages['happiness_sum'] / $avgCount, 1),
            'avg_public_services' => round($economyAverages['services_sum'] / $avgCount, 1),
            'avg_welfare' => round($economyAverages['welfare_sum'] / $avgCount, 1),
            'risk_thresholds' => $riskThresholds,
            'top_risks' => array_slice($topRisks, 0, 4),
            'net_rates_per_hour' => [
                'metal' => round($offlineRateTotals['metal'], 2),
                'crystal' => round($offlineRateTotals['crystal'], 2),
                'deuterium' => round($offlineRateTotals['deuterium'], 2),
                'rare_earth' => round($offlineRateTotals['rare_earth'], 2),
                'food' => round($offlineRateTotals['food'], 2),
                'population' => round($offlineRateTotals['population'], 2),
            ],
        ];

        $offlineReport = [
            'had_offline_time' => !empty($offlineEntries),
            'max_elapsed_seconds' => $offlineMaxElapsed,
            'totals' => [
                'metal' => round($offlineTotals['metal'], 2),
                'crystal' => round($offlineTotals['crystal'], 2),
                'deuterium' => round($offlineTotals['deuterium'], 2),
                'rare_earth' => round($offlineTotals['rare_earth'], 2),
                'food' => round($offlineTotals['food'], 2),
                'population' => (int)$offlineTotals['population'],
            ],
            'rates_per_hour' => $economySnapshot['net_rates_per_hour'],
            'economy' => $economySnapshot,
            'colonies' => $offlineEntries,
        ];

        check_and_update_achievements($db, $uid);
        // NPC AI tick (rate-limited internally to once per 5 minutes)
        require_once __DIR__ . '/npc_ai.php';
        try { npc_ai_tick($db, $uid); } catch (Throwable $e) { error_log('npc_ai_tick error: ' . $e->getMessage()); }

        $politicsRuntime = [
            'effects' => empire_dynamic_effects($db, $uid),
            'pressure_events' => apply_faction_pressure_situations($db, $uid),
        ];

        // User meta
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

        // Colonies with their planet data
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

        // Assigned leaders per colony
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
            $col['layout'] = colony_layout_profile($col);
            $col['leaders'] = $leadersByColony[(int)$col['id']] ?? [];
        }
        unset($col);

        // Active planetary events per colony
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
                    'type'       => $ce['event_type'],
                    'started_at' => $ce['started_at'],
                    'expires_at' => $ce['expires_at'],
                    'ends_in_min' => max(0, (int)round(($expiry - time()) / 60)),
                ];
            }
        } catch (Throwable $e) { /* pre-migration: no table */ }
        foreach ($colonies as &$col) {
            $col['active_event'] = $colonyEventsByColony[(int)$col['id']] ?? null;
        }
        unset($col);


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
            $f['ships'] = is_array($ships) ? $ships : [];
            $f['vessels'] = vessel_manifest($f['ships']);
            unset($f['ships_json']);
            $f['current_pos'] = fleet_current_position($f);
            $fleets[] = $f;
        }

        // Unread messages
        $unreadStmt = $db->prepare('SELECT COUNT(*) FROM messages WHERE receiver_id=? AND is_read=0');
        $unreadStmt->execute([$uid]);

        // Recent battle reports (last 5)
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

        $payload = [
            'user_meta'   => $meta,
            'offline_progress' => $offlineReport,
            'politics' => $politicsRuntime,
            'colonies'    => $colonies,
            'fleets'      => $fleets,
            'battles'     => $battles,
            'unread_msgs' => (int)$unreadStmt->fetchColumn(),
        ];
        gq_cache_set('game_overview', $overviewCacheKey, $payload, CACHE_TTL_OVERVIEW);
        json_ok($payload);
        break;

    // ── Colony resources refresh ───────────────────────────────────────────────
    case 'resources':
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $db  = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $resourceCacheKey = ['uid' => $uid, 'cid' => $cid];
        $cachedResources = gq_cache_get('game_resources', $resourceCacheKey);
        if (is_array($cachedResources) && isset($cachedResources['resources'])) {
            json_ok($cachedResources);
        }
        update_colony_resources($db, $cid);
        $row = $db->prepare('SELECT metal, crystal, deuterium, rare_earth, food, energy,
                                    population, max_population, happiness, public_services
                             FROM colonies WHERE id=?');
        $row->execute([$cid]);
        $payload = ['resources' => $row->fetch()];
        gq_cache_set('game_resources', $resourceCacheKey, $payload, CACHE_TTL_OVERVIEW);
        json_ok($payload);
        break;

    // ── Foreign colony intel / sector overview ───────────────────────────────
    case 'planet_intel':
        only_method('GET');
        $g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
        $s = max(1, min(galaxy_system_limit(), (int)($_GET['system'] ?? 1)));
        $p = max(1, min(15, (int)($_GET['position'] ?? 1)));
        $db = get_db();

        $stmt = $db->prepare(
            'SELECT p.id, p.galaxy, p.`system`, p.position, p.planet_class,
                    p.habitability_score, p.life_friendliness,
                    c.id AS colony_id, c.name AS colony_name, c.colony_type,
                    c.population, c.max_population, c.happiness, c.public_services, c.energy,
                    u.id AS owner_id, u.username AS owner_name
             FROM planets p
             LEFT JOIN colonies c ON c.planet_id = p.id
             LEFT JOIN users u ON u.id = c.user_id
             WHERE p.galaxy = ? AND p.`system` = ? AND p.position = ?
             LIMIT 1'
        );
        $stmt->execute([$g, $s, $p]);
        $planet = $stmt->fetch();
        if (!$planet) {
            json_ok([
                'intel' => null,
                'territory' => territory_factions_for_galaxy($db, $uid, $g),
                'diplomacy_hint' => 'Unkartierter Randbereich. Keine belastbaren diplomatischen Hinweise verfügbar.',
            ]);
            break;
        }

        $latestScan = null;
        if (!empty($planet['id'])) {
            $scanStmt = $db->prepare(
                'SELECT id, created_at, report_json
                 FROM spy_reports
                 WHERE owner_id = ? AND target_planet_id = ?
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1'
            );
            $scanStmt->execute([$uid, (int)$planet['id']]);
            $latestScan = $scanStmt->fetch();
        }

        $scanPayload = null;
        if ($latestScan && !empty($latestScan['report_json'])) {
            $scanPayload = json_decode((string)$latestScan['report_json'], true);
            if (!is_array($scanPayload)) {
                $scanPayload = null;
            }
        }

        $territory = territory_factions_for_galaxy($db, $uid, $g);
        $threat = compute_planet_threat($planet, $scanPayload, $territory);

        json_ok([
            'intel' => [
                'planet_id' => (int)($planet['id'] ?? 0),
                'colony_id' => (int)($planet['colony_id'] ?? 0),
                'owner_id' => (int)($planet['owner_id'] ?? 0),
                'owner_name' => $planet['owner_name'] ?? null,
                'colony_name' => $planet['colony_name'] ?? null,
                'colony_type' => $planet['colony_type'] ?? null,
                'threat' => $threat,
                'latest_scan_at' => $latestScan['created_at'] ?? null,
                'latest_scan' => summarize_scan_payload($scanPayload),
            ],
            'territory' => $territory,
            'diplomacy_hint' => build_diplomacy_hint($territory, $threat),
        ]);
        break;

    // ── Health / integrity snapshot ────────────────────────────────────────────
    case 'health':
        only_method('GET');
        $db = get_db();
        ensure_star_system_columns($db);

        $meta = [
            'star_systems_total' => 0,
            'star_systems_missing_metadata' => 0,
            'planets_total' => 0,
            'timestamp_utc' => gmdate('c'),
        ];

        $meta['star_systems_total'] = (int)$db
            ->query('SELECT COUNT(*) FROM star_systems')
            ->fetchColumn();
        $meta['star_systems_missing_metadata'] = (int)$db
            ->query('SELECT COUNT(*) FROM star_systems WHERE COALESCE(catalog_name, "") = "" OR COALESCE(planet_count, 0) = 0')
            ->fetchColumn();
        $meta['planets_total'] = (int)$db
            ->query('SELECT COUNT(*) FROM planets')
            ->fetchColumn();

        json_ok([
            'health' => [
                'ok' => $meta['star_systems_missing_metadata'] === 0,
                'checks' => $meta,
            ],
        ]);
        break;

    // ── Rename colony ─────────────────────────────────────────────────────────
    case 'rename_colony':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['colony_id'] ?? 0);
        $name = trim($body['name'] ?? '');
        if (!preg_match('/^[\w\s\-\.]{2,48}$/u', $name)) {
            json_error('Colony name must be 2–48 characters.');
        }
        $db = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $db->prepare('UPDATE colonies SET name=? WHERE id=?')->execute([$name, $cid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => $cid]);
        json_ok(['name' => $name]);
        break;

    // ── Set colony type / specialisation ─────────────────────────────────────
    case 'set_colony_type':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['colony_id'] ?? 0);
        $type = $body['colony_type'] ?? '';
        $valid = ['balanced','mining','industrial','research','agricultural','military'];
        if (!in_array($type, $valid, true)) { json_error('Invalid colony type.'); }
        $db = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $db->prepare('UPDATE colonies SET colony_type=? WHERE id=?')->execute([$type, $cid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        json_ok(['colony_type' => $type]);
        break;

    // ── PvP toggle ────────────────────────────────────────────────────────────
    case 'pvp_toggle':
        only_method('POST');
        verify_csrf();
        $db   = get_db();
        $uRow = $db->prepare('SELECT pvp_mode, protection_until FROM users WHERE id=?');
        $uRow->execute([$uid]);
        $u = $uRow->fetch();
        if ($u['protection_until'] && strtotime($u['protection_until']) > time()) {
            json_error('Cannot enable PvP while under newbie protection.');
        }
        $new = $u['pvp_mode'] ? 0 : 1;
        $db->prepare('UPDATE users SET pvp_mode=? WHERE id=?')->execute([$new, $uid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        json_ok(['pvp_mode' => $new]);
        break;

    // ── Leaderboard ───────────────────────────────────────────────────────────
    case 'leaderboard':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT u.id, u.username, u.rank_points, u.dark_matter,
                    COUNT(DISTINCT c.id) AS planet_count,
                    COALESCE(SUM(c.metal + c.crystal + c.deuterium), 0) AS total_resources,
                    a.tag AS alliance_tag, a.name AS alliance_name
             FROM users u
             LEFT JOIN colonies c ON c.user_id = u.id
             LEFT JOIN alliance_members am ON am.user_id = u.id
             LEFT JOIN alliances a ON a.id = am.alliance_id
             WHERE u.is_npc = 0
             GROUP BY u.id, u.username, u.rank_points, u.dark_matter, a.tag, a.name
             ORDER BY u.rank_points DESC, planet_count DESC
             LIMIT 50'
        );
        $stmt->execute();
        json_ok(['leaderboard' => $stmt->fetchAll()]);
        break;

    // ── FTL Drive Selection ───────────────────────────────────────────────────
    // First selection is free (when still on default 'aereth').
    // Changing an already-chosen drive costs 200 DM.
    case 'set_ftl_drive':
        only_method('POST');
        verify_csrf();
        $body  = get_json_body();
        $drive = $body['ftl_drive_type'] ?? '';
        $validDrives = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'zhareen', 'kryl_tha'];
        if (!in_array($drive, $validDrives, true)) {
            json_error('Invalid FTL drive type.');
        }
        $db   = get_db();
        $uRow = $db->prepare('SELECT ftl_drive_type, dark_matter FROM users WHERE id = ? LIMIT 1');
        $uRow->execute([$uid]);
        $u = $uRow->fetch();
        if (!$u) { json_error('User not found.'); }
        $current = $u['ftl_drive_type'];
        if ($current === $drive) {
            json_ok(['ftl_drive_type' => $drive, 'message' => 'Drive unchanged.']);
            break;
        }
        $CHANGE_COST = 200; // DM cost to change after initial selection
        $isInitial   = ($current === 'aereth'); // default → first real selection is free
        if (!$isInitial) {
            if ((int)$u['dark_matter'] < $CHANGE_COST) {
                json_error("Changing FTL drive costs {$CHANGE_COST} Dark Matter. You have {$u['dark_matter']} DM.");
            }
            $db->prepare('UPDATE users SET dark_matter = dark_matter - ? WHERE id = ?')
               ->execute([$CHANGE_COST, $uid]);
        }
        $db->prepare('UPDATE users SET ftl_drive_type = ?, ftl_cooldown_until = NULL WHERE id = ?')
           ->execute([$drive, $uid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        $dmSpent = $isInitial ? 0 : $CHANGE_COST;
        json_ok([
            'ftl_drive_type' => $drive,
            'dm_spent'       => $dmSpent,
            'message'        => $isInitial
                ? "FTL drive set to {$drive}. Welcome to your faction!"
                : "FTL drive changed to {$drive}. {$CHANGE_COST} DM spent.",
        ]);
        break;

    default:
        json_error('Unknown action');
}

function territory_factions_for_galaxy(PDO $db, int $uid, int $galaxy): array
{
    $factionIds = $db->query('SELECT id, base_diplomacy FROM npc_factions')->fetchAll();
    if ($factionIds) {
        $insert = $db->prepare('INSERT IGNORE INTO diplomacy (user_id, faction_id, standing) VALUES (?, ?, ?)');
        foreach ($factionIds as $factionRow) {
            $insert->execute([$uid, (int)$factionRow['id'], (int)$factionRow['base_diplomacy']]);
        }
    }

    $stmt = $db->prepare(
        'SELECT f.id, f.code, f.name, f.faction_type, f.power_level, f.color, f.icon,
                f.home_galaxy_min, f.home_galaxy_max,
                COALESCE(d.standing, f.base_diplomacy) AS standing
         FROM npc_factions f
         LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
         WHERE ? BETWEEN f.home_galaxy_min AND f.home_galaxy_max
         ORDER BY f.power_level DESC, f.id ASC'
    );
    $stmt->execute([$uid, $galaxy]);
    $rows = $stmt->fetchAll();

    $territory = [];
    foreach ($rows as $row) {
        $gov = get_faction_government($db, (int)$row['id']);
        $territory[] = [
            'id' => (int)$row['id'],
            'code' => (string)$row['code'],
            'name' => (string)$row['name'],
            'type' => (string)$row['faction_type'],
            'power_level' => (int)$row['power_level'],
            'color' => (string)$row['color'],
            'icon' => (string)$row['icon'],
            'standing' => (int)$row['standing'],
            'home_galaxy_min' => (int)$row['home_galaxy_min'],
            'home_galaxy_max' => (int)$row['home_galaxy_max'],
            'government' => [
                'form' => (string)($gov['government_form'] ?? ''),
                'label' => (string)($gov['form_label'] ?? 'Herrschaftsform'),
                'icon' => (string)($gov['form_icon'] ?? '🏳'),
                'color' => (string)($gov['form_color'] ?? $row['color']),
            ],
        ];
    }
    return $territory;
}

function summarize_scan_payload(?array $scanPayload): ?array
{
    if (!$scanPayload) {
        return null;
    }

    $ships = is_array($scanPayload['ships'] ?? null) ? $scanPayload['ships'] : [];
    $leaders = is_array($scanPayload['leaders'] ?? null) ? $scanPayload['leaders'] : [];
    $resources = is_array($scanPayload['resources'] ?? null) ? $scanPayload['resources'] : [];
    $welfare = is_array($scanPayload['welfare'] ?? null) ? $scanPayload['welfare'] : [];

    return [
        'status' => (string)($scanPayload['status'] ?? 'unknown'),
        'ship_count' => array_sum(array_map('intval', $ships)),
        'combat_power_estimate' => estimate_ship_threat($ships),
        'leader_count' => count($leaders),
        'resource_total' => (float)(($resources['metal'] ?? 0) + ($resources['crystal'] ?? 0) + ($resources['deuterium'] ?? 0)),
        'population' => (int)($welfare['population'] ?? 0),
        'happiness' => (int)($welfare['happiness'] ?? 0),
    ];
}

function compute_planet_threat(array $planet, ?array $scanPayload, array $territory): array
{
    $scanSummary = summarize_scan_payload($scanPayload);
    $territoryPressure = 0;
    foreach ($territory as $faction) {
        $territoryPressure += max(0, (int)$faction['power_level']) / 1500;
        if ((int)$faction['standing'] < -20) {
            $territoryPressure += 8;
        }
    }

    $score = 6 + $territoryPressure;
    $score += min(35, (int)round(((int)($planet['population'] ?? 0)) / 250));
    $score += max(0, 12 - (int)round(((int)($planet['happiness'] ?? 0)) / 8));
    if ($scanSummary) {
        $score += min(40, (int)round(($scanSummary['combat_power_estimate'] ?? 0) / 250));
        $score += min(15, (int)round(($scanSummary['ship_count'] ?? 0) / 3));
        $score += min(8, (int)($scanSummary['leader_count'] ?? 0) * 2);
    } else {
        $score += 10;
    }

    $level = 'low';
    $label = 'Niedrig';
    if ($score >= 85) {
        $level = 'extreme';
        $label = 'Extrem';
    } elseif ($score >= 60) {
        $level = 'high';
        $label = 'Hoch';
    } elseif ($score >= 35) {
        $level = 'medium';
        $label = 'Mittel';
    }

    return [
        'score' => (int)round($score),
        'level' => $level,
        'label' => $label,
    ];
}

function estimate_ship_threat(array $ships): int
{
    $defs = ship_definitions();
    $total = 0;
    foreach ($ships as $type => $count) {
        $def = $defs[(string)$type] ?? null;
        if (!$def) {
            continue;
        }
        $attack = (float)($def['attack'] ?? 0);
        $shield = (float)($def['shield'] ?? 0);
        $hull = (float)($def['hull'] ?? 0);
        $total += (int)round(((int)$count) * ($attack + ($shield * 0.5) + ($hull / 1200)));
    }
    return $total;
}

function build_diplomacy_hint(array $territory, array $threat): string
{
    if (!$territory) {
        return 'Kein etablierter Machtblock in diesem Sektor erfasst. Aufklärung empfohlen.';
    }

    $friendly = array_values(array_filter($territory, static fn(array $f): bool => (int)$f['standing'] >= 20));
    $hostile = array_values(array_filter($territory, static fn(array $f): bool => (int)$f['standing'] <= -20));

    if ($threat['level'] === 'extreme' || $threat['level'] === 'high') {
        if ($hostile) {
            return 'Militärischer Druck in diesem Sektor ist erhöht. Erst aufklären, dann nur mit Eskorte oder Schlagflotte operieren.';
        }
        return 'Die Kolonie wirkt stark gesichert. Spionage oder Probeangriff vor jeder größeren Operation einplanen.';
    }
    if ($friendly) {
        return 'Diplomatische Lage im Sektor ist stabil. Handel oder begrenzte Präsenz sind wahrscheinlicher als sofortige Eskalation.';
    }
    return 'Gemischte diplomatische Lage. Erst letzte Aufklärung sichern und Flottenprofil an die Missionsart anpassen.';
}
