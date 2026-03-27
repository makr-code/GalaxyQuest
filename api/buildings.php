<?php
/**
 * Buildings API
 * GET  /api/buildings.php?action=list&planet_id=X
 * POST /api/buildings.php?action=upgrade  body: {planet_id, type}
 * POST /api/buildings.php?action=cancel   body: {planet_id, type}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $pid = (int)($_GET['planet_id'] ?? 0);
        $db  = get_db();
        verify_planet_ownership($db, $pid, $uid);
        update_planet_resources($db, $pid);

        $rows = $db->prepare(
            'SELECT type, level, upgrade_end FROM buildings WHERE planet_id = ? ORDER BY type'
        );
        $rows->execute([$pid]);
        $buildings = [];
        foreach ($rows->fetchAll() as $r) {
            $next = $r['level'] + 1;
            $cost = building_cost($r['type'], $next);
            $buildings[] = [
                'type'         => $r['type'],
                'level'        => (int)$r['level'],
                'upgrade_end'  => $r['upgrade_end'],
                'next_cost'    => $cost,
            ];
        }
        json_ok(['buildings' => $buildings]);
        break;

    case 'upgrade':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $pid  = (int)($body['planet_id'] ?? 0);
        $type = $body['type'] ?? '';
        $db   = get_db();
        verify_planet_ownership($db, $pid, $uid);
        update_planet_resources($db, $pid);

        // Check no other upgrade in progress
        $busy = $db->prepare(
            'SELECT id FROM buildings WHERE planet_id = ? AND upgrade_end IS NOT NULL'
        );
        $busy->execute([$pid]);
        if ($busy->fetch()) {
            json_error('Another building is already under construction.');
        }

        $bRow = $db->prepare('SELECT level FROM buildings WHERE planet_id = ? AND type = ?');
        $bRow->execute([$pid, $type]);
        $building = $bRow->fetch();
        if (!$building) {
            json_error('Building not found.');
        }

        $nextLevel = (int)$building['level'] + 1;
        $cost = building_cost($type, $nextLevel);

        // Verify resources
        $planet = $db->prepare('SELECT metal, crystal, deuterium FROM planets WHERE id = ?');
        $planet->execute([$pid]);
        $res = $planet->fetch();

        if ($res['metal'] < $cost['metal'] || $res['crystal'] < $cost['crystal']
            || $res['deuterium'] < $cost['deuterium']) {
            json_error('Insufficient resources.');
        }

        // Get robotics & nanite levels
        $rLevel = (int)(get_building_level($db, $pid, 'robotics_factory') ?? 0);
        $nLevel = (int)(get_building_level($db, $pid, 'nanite_factory')   ?? 0);
        $secs   = building_build_time($cost, $rLevel, $nLevel);
        $end    = date('Y-m-d H:i:s', time() + $secs);

        // Deduct resources
        $db->prepare(
            'UPDATE planets SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
             WHERE id = ?'
        )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $pid]);

        // Set upgrade end
        $db->prepare(
            'UPDATE buildings SET upgrade_end = ? WHERE planet_id = ? AND type = ?'
        )->execute([$end, $pid, $type]);

        json_ok(['upgrade_end' => $end, 'duration_secs' => $secs]);
        break;

    case 'finish':
        // Called by cron or client polling – completes any finished upgrades
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $pid  = (int)($body['planet_id'] ?? 0);
        $db   = get_db();
        verify_planet_ownership($db, $pid, $uid);
        complete_upgrades($db, $pid);
        json_ok();
        break;

    default:
        json_error('Unknown action');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verify_planet_ownership(PDO $db, int $planetId, int $userId): void {
    $stmt = $db->prepare('SELECT id FROM planets WHERE id = ? AND user_id = ?');
    $stmt->execute([$planetId, $userId]);
    if (!$stmt->fetch()) {
        json_error('Planet not found', 404);
    }
}

function get_building_level(PDO $db, int $planetId, string $type): int {
    $stmt = $db->prepare('SELECT level FROM buildings WHERE planet_id = ? AND type = ?');
    $stmt->execute([$planetId, $type]);
    $row = $stmt->fetch();
    return $row ? (int)$row['level'] : 0;
}

function complete_upgrades(PDO $db, int $planetId): void {
    $due = $db->prepare(
        'SELECT type, level FROM buildings
         WHERE planet_id = ? AND upgrade_end IS NOT NULL AND upgrade_end <= NOW()'
    );
    $due->execute([$planetId]);
    foreach ($due->fetchAll() as $row) {
        $db->prepare(
            'UPDATE buildings SET level = level + 1, upgrade_end = NULL
             WHERE planet_id = ? AND type = ?'
        )->execute([$planetId, $row['type']]);
    }
}
