<?php
/**
 * Game data API
 * GET  /api/game.php?action=overview
 * GET  /api/game.php?action=resources&colony_id=X
 * POST /api/game.php?action=pvp_toggle
 * POST /api/game.php?action=rename_colony   body: {colony_id, name}
 * POST /api/game.php?action=set_colony_type body: {colony_id, colony_type}
 * GET  /api/game.php?action=leaderboard
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/buildings.php';   // verify_colony_ownership

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {

    // ── Overview ──────────────────────────────────────────────────────────────
    case 'overview':
        only_method('GET');
        $db = get_db();
        update_all_colonies($db, $uid);
        check_and_update_achievements($db, $uid);

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
                    c.energy, c.is_homeworld, c.last_update,
                    p.id AS planet_id, p.galaxy, p.system, p.position,
                    p.type AS planet_type, p.planet_class, p.diameter,
                    p.temp_min, p.temp_max, p.in_habitable_zone, p.semi_major_axis_au,
                    p.orbital_period_days, p.surface_gravity_g, p.atmosphere_type
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
            $col['leaders'] = $leadersByColony[(int)$col['id']] ?? [];
        }
        unset($col);

        // Fleets
        $fleetStmt = $db->prepare(
            'SELECT f.id, f.mission, f.origin_colony_id,
                    f.target_galaxy, f.target_system, f.target_position,
                    f.cargo_metal, f.cargo_crystal, f.cargo_deuterium,
                    f.origin_x_ly, f.origin_y_ly, f.origin_z_ly,
                    f.target_x_ly, f.target_y_ly, f.target_z_ly,
                    f.speed_ly_h, f.distance_ly,
                    f.departure_time, f.arrival_time, f.return_time, f.returning,
                    p.galaxy AS origin_galaxy, p.system AS origin_system, p.position AS origin_position
             FROM fleets f
             JOIN colonies c ON c.id = f.origin_colony_id
             JOIN planets  p ON p.id = c.planet_id
             WHERE f.user_id = ? ORDER BY f.arrival_time ASC'
        );
        $fleetStmt->execute([$uid]);
        $fleets = [];
        foreach ($fleetStmt->fetchAll() as $f) {
            $f['current_pos'] = fleet_current_position($f);
            $fleets[] = $f;
        }

        // Unread messages
        $unreadStmt = $db->prepare('SELECT COUNT(*) FROM messages WHERE receiver_id=? AND is_read=0');
        $unreadStmt->execute([$uid]);

        json_ok([
            'user_meta'   => $meta,
            'colonies'    => $colonies,
            'fleets'      => $fleets,
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
        $row = $db->prepare('SELECT metal, crystal, deuterium, energy FROM colonies WHERE id=?');
        $row->execute([$cid]);
        json_ok(['resources' => $row->fetch()]);
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
