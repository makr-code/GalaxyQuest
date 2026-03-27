<?php
/**
 * Game data API – overview, planets list, resource update
 * GET  /api/game.php?action=overview
 * GET  /api/game.php?action=planets
 * GET  /api/game.php?action=resources&planet_id=X
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'overview':
        only_method('GET');
        $db = get_db();
        update_all_planets($db, $uid);

        // Planets
        $planets = $db->prepare(
            'SELECT id, name, galaxy, system, position, type, diameter,
                    temp_min, temp_max, metal, crystal, deuterium, energy,
                    is_homeworld, last_update
             FROM planets WHERE user_id = ? ORDER BY is_homeworld DESC, id ASC'
        );
        $planets->execute([$uid]);
        $planetRows = $planets->fetchAll();

        // Fleets
        $fleets = $db->prepare(
            'SELECT id, mission, target_galaxy, target_system, target_position,
                    ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
                    departure_time, arrival_time, return_time, returning
             FROM fleets WHERE user_id = ? ORDER BY arrival_time ASC'
        );
        $fleets->execute([$uid]);
        $fleetRows = $fleets->fetchAll();
        foreach ($fleetRows as &$f) {
            $f['ships'] = json_decode($f['ships_json'], true);
            unset($f['ships_json']);
        }
        unset($f);

        // Unread messages
        $unread = $db->prepare('SELECT COUNT(*) AS cnt FROM messages WHERE receiver_id = ? AND is_read = 0');
        $unread->execute([$uid]);
        $unreadCount = (int)$unread->fetchColumn();

        json_ok([
            'planets'       => $planetRows,
            'fleets'        => $fleetRows,
            'unread_msgs'   => $unreadCount,
        ]);
        break;

    case 'planets':
        only_method('GET');
        $db = get_db();
        update_all_planets($db, $uid);
        $stmt = $db->prepare(
            'SELECT id, name, galaxy, system, position, type, metal, crystal,
                    deuterium, energy, is_homeworld
             FROM planets WHERE user_id = ? ORDER BY is_homeworld DESC, id ASC'
        );
        $stmt->execute([$uid]);
        json_ok(['planets' => $stmt->fetchAll()]);
        break;

    case 'resources':
        only_method('GET');
        $pid = (int)($_GET['planet_id'] ?? 0);
        $db  = get_db();
        // Verify ownership
        $row = $db->prepare('SELECT id FROM planets WHERE id = ? AND user_id = ?');
        $row->execute([$pid, $uid]);
        if (!$row->fetch()) {
            json_error('Planet not found', 404);
        }
        update_planet_resources($db, $pid);
        $planet = $db->prepare(
            'SELECT metal, crystal, deuterium, energy FROM planets WHERE id = ?'
        );
        $planet->execute([$pid]);
        json_ok(['resources' => $planet->fetch()]);
        break;

    case 'leaderboard':
        only_method('GET');
        $db = get_db();
        $stmt = $db->prepare(
            'SELECT u.id, u.username,
                    COUNT(p.id) AS planet_count,
                    COALESCE(SUM(p.metal + p.crystal + p.deuterium), 0) AS total_resources
             FROM users u
             LEFT JOIN planets p ON p.user_id = u.id
             GROUP BY u.id, u.username
             ORDER BY planet_count DESC, total_resources DESC
             LIMIT 50'
        );
        $stmt->execute();
        json_ok(['leaderboard' => $stmt->fetchAll()]);
        break;

    default:
        json_error('Unknown action');
}
