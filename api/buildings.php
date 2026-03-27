<?php
/**
 * Buildings API
 * GET  /api/buildings.php?action=list&colony_id=X
 * POST /api/buildings.php?action=upgrade  body: {colony_id, type}
 * POST /api/buildings.php?action=finish   body: {colony_id}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid    = require_auth();

    switch ($action) {
        case 'list':
            only_method('GET');
            $cid = (int)($_GET['colony_id'] ?? 0);
            $db  = get_db();
            verify_colony_ownership($db, $cid, $uid);
            update_colony_resources($db, $cid);

            $planetStmt = $db->prepare(
                'SELECT p.galaxy, p.`system`, p.position, p.type, p.planet_class, p.diameter,
                        p.in_habitable_zone, p.temp_min, p.temp_max,
                        c.colony_type, c.name
                 FROM colonies c
                 JOIN planets p ON p.id = c.planet_id
                 WHERE c.id = ? LIMIT 1'
            );
            $planetStmt->execute([$cid]);
            $planet = $planetStmt->fetch() ?: [];

            $rows = $db->prepare(
                'SELECT type, level, upgrade_end FROM buildings WHERE colony_id = ? ORDER BY type'
            );
            $rows->execute([$cid]);
            $buildings = [];
            $defs = building_definitions();
            foreach ($rows->fetchAll() as $r) {
                $next = (int)$r['level'] + 1;
                $cost = building_cost($r['type'], $next);
                $meta = $defs[(string)$r['type']] ?? ['category' => 'other', 'label' => fmt_name((string)$r['type']), 'icon' => '🏗', 'zone' => 'surface', 'footprint' => 1, 'class_key' => 'flex'];
                $buildings[] = [
                    'type'        => $r['type'],
                    'level'       => (int)$r['level'],
                    'upgrade_end' => $r['upgrade_end'],
                    'next_cost'   => $cost,
                    'meta'        => $meta,
                ];
            }

            $shipStmt = $db->prepare('SELECT type, count FROM ships WHERE colony_id = ?');
            $shipStmt->execute([$cid]);
            $ships = [];
            foreach ($shipStmt->fetchAll() as $shipRow) {
                $ships[(string)$shipRow['type']] = (int)$shipRow['count'];
            }

            $layout = colony_layout_profile($planet);
            json_ok([
                'buildings' => $buildings,
                'planet' => $planet,
                'layout' => $layout,
                'orbital_facilities' => summarize_orbital_facilities($buildings, $ships),
            ]);
            break;

        case 'upgrade':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $cid  = (int)($body['colony_id'] ?? 0);
            $type = (string)($body['type'] ?? '');
            $db   = get_db();
            verify_colony_ownership($db, $cid, $uid);
            update_colony_resources($db, $cid);

            $busy = $db->prepare(
                'SELECT id FROM buildings WHERE colony_id = ? AND upgrade_end IS NOT NULL'
            );
            $busy->execute([$cid]);
            if ($busy->fetch()) {
                json_error('Another building is already under construction.');
            }

            $bRow = $db->prepare('SELECT level FROM buildings WHERE colony_id = ? AND type = ?');
            $bRow->execute([$cid, $type]);
            $building = $bRow->fetch();
            if (!$building) {
                json_error('Building not found.');
            }

            $nextLevel = (int)$building['level'] + 1;
            $cost      = building_cost($type, $nextLevel);

            $colony = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ?');
            $colony->execute([$cid]);
            $res = $colony->fetch();

            if ($res['metal'] < $cost['metal']
                || $res['crystal'] < $cost['crystal']
                || $res['deuterium'] < $cost['deuterium']) {
                json_error('Insufficient resources.');
            }

            $rLevel = (int)(get_building_level($db, $cid, 'robotics_factory') ?? 0);
            $nLevel = (int)(get_building_level($db, $cid, 'nanite_factory') ?? 0);
            $secs   = building_build_time($cost, $rLevel, $nLevel);

            $manager = get_colony_leader($db, $cid, 'colony_manager');
            if ($manager) {
                $secs = leader_build_time($secs, (int)$manager['skill_construction']);
            }

            $end = date('Y-m-d H:i:s', time() + $secs);

            $db->prepare(
                'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
            )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);

            $db->prepare(
                'UPDATE buildings SET upgrade_end=? WHERE colony_id=? AND type=?'
            )->execute([$end, $cid, $type]);

            json_ok(['upgrade_end' => $end, 'duration_secs' => $secs]);
            break;

        case 'finish':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $cid  = (int)($body['colony_id'] ?? 0);
            $db   = get_db();
            verify_colony_ownership($db, $cid, $uid);
            complete_upgrades($db, $cid);
            json_ok();
            break;

        default:
            json_error('Unknown action');
    }
}

// Helpers
function verify_colony_ownership(PDO $db, int $colonyId, int $userId): void {
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $userId]);
    if (!$stmt->fetch()) {
        json_error('Colony not found', 404);
    }
}

function get_building_level(PDO $db, int $colonyId, string $type): int {
    $stmt = $db->prepare('SELECT level FROM buildings WHERE colony_id = ? AND type = ?');
    $stmt->execute([$colonyId, $type]);
    $row = $stmt->fetch();
    return $row ? (int)$row['level'] : 0;
}

function complete_upgrades(PDO $db, int $colonyId): void {
    $due = $db->prepare(
        'SELECT type, level FROM buildings
         WHERE colony_id = ? AND upgrade_end IS NOT NULL AND upgrade_end <= NOW()'
    );
    $due->execute([$colonyId]);

    foreach ($due->fetchAll() as $row) {
        $db->prepare(
            'UPDATE buildings SET level=level+1, upgrade_end=NULL WHERE colony_id=? AND type=?'
        )->execute([$colonyId, $row['type']]);
    }

    $owner = $db->prepare('SELECT user_id FROM colonies WHERE id = ?');
    $owner->execute([$colonyId]);
    $uid = $owner->fetchColumn();
    if ($uid) {
        check_and_update_achievements($db, (int)$uid);
    }
}

function fmt_name(string $type): string {
    return ucwords(str_replace('_', ' ', $type));
}
