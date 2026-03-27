<?php
/**
 * Game data API
 * GET  /api/game.php?action=overview
 * GET  /api/game.php?action=resources&colony_id=X
 * GET  /api/game.php?action=health
 * POST /api/game.php?action=pvp_toggle
 * POST /api/game.php?action=rename_colony   body: {colony_id, name}
 * POST /api/game.php?action=set_colony_type body: {colony_id, colony_type}
 * GET  /api/game.php?action=leaderboard
 */
require_once __DIR__ . '/helpers.php';
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
        update_all_colonies($db, $uid);
        check_and_update_achievements($db, $uid);
        // NPC AI tick (rate-limited internally to once per 5 minutes)
        require_once __DIR__ . '/npc_ai.php';
        try { npc_ai_tick($db, $uid); } catch (Throwable $e) { error_log('npc_ai_tick error: ' . $e->getMessage()); }

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

        // Fleets
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

        json_ok([
            'user_meta'   => $meta,
            'colonies'    => $colonies,
            'fleets'      => $fleets,
            'battles'     => $battles,
            'unread_msgs' => (int)$unreadStmt->fetchColumn(),
        ]);
        break;

    // ── Colony resources refresh ───────────────────────────────────────────────
    case 'resources':
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $db  = get_db();
        verify_colony_ownership($db, $cid, $uid);
        update_colony_resources($db, $cid);
        $row = $db->prepare('SELECT metal, crystal, deuterium, rare_earth, food, energy,
                                    population, max_population, happiness, public_services
                             FROM colonies WHERE id=?');
        $row->execute([$cid]);
        json_ok(['resources' => $row->fetch()]);
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
        json_ok(['pvp_mode' => $new]);
        break;

    // ── Leaderboard ───────────────────────────────────────────────────────────
    case 'leaderboard':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT u.id, u.username, u.rank_points, u.dark_matter,
                    COUNT(DISTINCT c.id) AS planet_count,
                    COALESCE(SUM(c.metal + c.crystal + c.deuterium), 0) AS total_resources
             FROM users u
             LEFT JOIN colonies c ON c.user_id = u.id
             WHERE u.is_npc = 0
             GROUP BY u.id, u.username, u.rank_points, u.dark_matter
             ORDER BY u.rank_points DESC, planet_count DESC
             LIMIT 50'
        );
        $stmt->execute();
        json_ok(['leaderboard' => $stmt->fetchAll()]);
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
