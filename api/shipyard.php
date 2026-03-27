<?php
/**
 * Shipyard API
 * GET  /api/shipyard.php?action=list&planet_id=X
 * POST /api/shipyard.php?action=build  body: {planet_id, type, count}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $pid = (int)($_GET['planet_id'] ?? 0);
        $db  = get_db();
        verify_planet_ownership($db, $pid, $uid);

        $rows = $db->prepare('SELECT type, count FROM ships WHERE planet_id = ?');
        $rows->execute([$pid]);
        $ships = [];
        foreach ($rows->fetchAll() as $r) {
            $ships[$r['type']] = (int)$r['count'];
        }
        // Ensure all types are listed
        $allTypes = array_keys(SHIP_STATS);
        $result = [];
        foreach ($allTypes as $type) {
            $result[] = [
                'type'  => $type,
                'count' => $ships[$type] ?? 0,
                'cost'  => ship_cost($type),
                'cargo' => ship_cargo($type),
                'speed' => ship_speed($type),
            ];
        }
        json_ok(['ships' => $result]);
        break;

    case 'build':
        only_method('POST');
        verify_csrf();
        $body  = get_json_body();
        $pid   = (int)($body['planet_id'] ?? 0);
        $type  = $body['type'] ?? '';
        $count = max(1, (int)($body['count'] ?? 1));
        $db    = get_db();
        verify_planet_ownership($db, $pid, $uid);

        if (!isset(SHIP_STATS[$type])) {
            json_error('Unknown ship type.');
        }

        // Shipyard required
        $syLevel = get_building_level($db, $pid, 'shipyard');
        if ($syLevel < 1) {
            json_error('A Shipyard is required to build ships.');
        }

        update_planet_resources($db, $pid);
        $cost = ship_cost($type);
        $totalCost = [
            'metal'     => $cost['metal']     * $count,
            'crystal'   => $cost['crystal']   * $count,
            'deuterium' => $cost['deuterium'] * $count,
        ];

        $planet = $db->prepare('SELECT metal, crystal, deuterium FROM planets WHERE id = ?');
        $planet->execute([$pid]);
        $res = $planet->fetch();

        if ($res['metal'] < $totalCost['metal']
            || $res['crystal'] < $totalCost['crystal']
            || $res['deuterium'] < $totalCost['deuterium']) {
            json_error('Insufficient resources.');
        }

        $db->prepare(
            'UPDATE planets SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
             WHERE id = ?'
        )->execute([$totalCost['metal'], $totalCost['crystal'], $totalCost['deuterium'], $pid]);

        $db->prepare(
            'INSERT INTO ships (planet_id, type, count) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE count = count + ?'
        )->execute([$pid, $type, $count, $count]);

        json_ok(['built' => $count, 'type' => $type]);
        break;

    default:
        json_error('Unknown action');
}
