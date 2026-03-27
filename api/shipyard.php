<?php
/**
 * Shipyard API
 * GET  /api/shipyard.php?action=list&colony_id=X
 * POST /api/shipyard.php?action=build  body: {colony_id, type, count}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $db  = get_db();
        verify_colony_ownership($db, $cid, $uid);

        $rows = $db->prepare('SELECT type, count FROM ships WHERE colony_id = ?');
        $rows->execute([$cid]);
        $ships = [];
        foreach ($rows->fetchAll() as $r) {
            $ships[$r['type']] = (int)$r['count'];
        }
        $result = [];
        foreach (array_keys(SHIP_STATS) as $type) {
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
        $cid   = (int)($body['colony_id'] ?? 0);
        $type  = $body['type'] ?? '';
        $count = max(1, (int)($body['count'] ?? 1));
        $db    = get_db();
        verify_colony_ownership($db, $cid, $uid);

        if (!isset(SHIP_STATS[$type])) {
            json_error('Unknown ship type.');
        }
        if (get_building_level($db, $cid, 'shipyard') < 1) {
            json_error('A Shipyard building is required.');
        }

        update_colony_resources($db, $cid);
        $cost      = ship_cost($type);
        $totalCost = [
            'metal'     => $cost['metal']     * $count,
            'crystal'   => $cost['crystal']   * $count,
            'deuterium' => $cost['deuterium'] * $count,
        ];

        $colony = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ?');
        $colony->execute([$cid]);
        $res = $colony->fetch();

        if ($res['metal'] < $totalCost['metal']
            || $res['crystal'] < $totalCost['crystal']
            || $res['deuterium'] < $totalCost['deuterium']) {
            json_error('Insufficient resources.');
        }

        $db->prepare(
            'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
        )->execute([$totalCost['metal'], $totalCost['crystal'], $totalCost['deuterium'], $cid]);

        $db->prepare(
            'INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE count = count + ?'
        )->execute([$cid, $type, $count, $count]);

        json_ok(['built' => $count, 'type' => $type]);
        break;

    default:
        json_error('Unknown action');
}
