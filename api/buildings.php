<?php
/**
 * Buildings API
 * GET  /api/buildings.php?action=list&colony_id=X
 * POST /api/buildings.php?action=upgrade  body: {colony_id, type}
 * POST /api/buildings.php?action=finish   body: {colony_id}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
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
            $cacheKeyParams = ['uid' => $uid, 'cid' => $cid];
            $cached = gq_cache_get('buildings_list', $cacheKeyParams);
            if (is_array($cached) && isset($cached['buildings'])) {
                json_ok($cached);
            }
            ensure_building_upgrade_queue_table($db);
            complete_upgrades($db, $cid);
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

            $queueStmt = $db->prepare(
                'SELECT id, building_type, target_level, cost_metal, cost_crystal, cost_deuterium,
                        duration_secs, queued_at, started_at, eta, status
                 FROM building_upgrade_queue
                 WHERE colony_id = ? AND status IN (\'queued\', \'running\')
                 ORDER BY id ASC'
            );
            $queueStmt->execute([$cid]);
            $queueRows = [];
            foreach ($queueStmt->fetchAll() as $q) {
                $queueRows[] = [
                    'id' => (int)$q['id'],
                    'type' => (string)$q['building_type'],
                    'target_level' => (int)$q['target_level'],
                    'status' => (string)$q['status'],
                    'queued_at' => $q['queued_at'],
                    'started_at' => $q['started_at'],
                    'eta' => $q['eta'],
                    'duration_secs' => (int)$q['duration_secs'],
                    'cost' => [
                        'metal' => (int)$q['cost_metal'],
                        'crystal' => (int)$q['cost_crystal'],
                        'deuterium' => (int)$q['cost_deuterium'],
                    ],
                ];
            }

            // Attach upgrade_start from running queue entry so frontend can render live progress
            $runningByType = [];
            foreach ($queueRows as $q) {
                if ($q['status'] === 'running') {
                    $runningByType[$q['type']] = $q['started_at'];
                }
            }
            foreach ($buildings as &$b) {
                $b['upgrade_start'] = $runningByType[$b['type']] ?? null;
            }
            unset($b);

            $payload = [
                'buildings' => $buildings,
                'planet' => $planet,
                'layout' => $layout,
                'orbital_facilities' => summarize_orbital_facilities($buildings, $ships),
                'upgrade_queue' => $queueRows,
            ];
            gq_cache_set('buildings_list', $cacheKeyParams, $payload, CACHE_TTL_DEFAULT);
            json_ok($payload);
            break;

        case 'upgrade':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $cid  = (int)($body['colony_id'] ?? 0);
            $type = (string)($body['type'] ?? '');
            $db   = get_db();
            verify_colony_ownership($db, $cid, $uid);
            ensure_building_upgrade_queue_table($db);
            complete_upgrades($db, $cid);
            update_colony_resources($db, $cid);

            $bRow = $db->prepare('SELECT level FROM buildings WHERE colony_id = ? AND type = ?');
            $bRow->execute([$cid, $type]);
            $building = $bRow->fetch();
            if (!$building) {
                json_error('Building not found.');
            }

            $pendingCountStmt = $db->prepare(
                'SELECT COUNT(*) FROM building_upgrade_queue
                 WHERE colony_id = ? AND building_type = ? AND status IN (\'queued\', \'running\')'
            );
            $pendingCountStmt->execute([$cid, $type]);
            $pendingCount = (int)$pendingCountStmt->fetchColumn();

            $nextLevel = (int)$building['level'] + $pendingCount + 1;
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
            
            // Apply colony-type building time bonus (industrial colony −10%)
            $colonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
            $colonyStmt->execute([$cid]);
            $colonyRow = $colonyStmt->fetch();
            if ($colonyRow && $colonyRow['colony_type'] === 'industrial') {
                $secs = max(1, (int)round($secs * 0.9));
            }

            $db->prepare(
                'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
            )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);

            $db->prepare(
                'INSERT INTO building_upgrade_queue
                 (colony_id, building_type, target_level, cost_metal, cost_crystal, cost_deuterium,
                  duration_secs, queued_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), \'queued\')'
            )->execute([
                $cid,
                $type,
                $nextLevel,
                (int)$cost['metal'],
                (int)$cost['crystal'],
                (int)$cost['deuterium'],
                $secs,
            ]);
            $queueId = (int)$db->lastInsertId();

            gq_cache_delete('buildings_list', ['uid' => $uid, 'cid' => $cid]);

            start_next_building_upgrade($db, $cid);

            $activeStmt = $db->prepare(
                'SELECT building_type, eta FROM building_upgrade_queue
                 WHERE colony_id = ? AND status = \'running\'
                 ORDER BY id ASC LIMIT 1'
            );
            $activeStmt->execute([$cid]);
            $active = $activeStmt->fetch() ?: null;

            $positionStmt = $db->prepare(
                'SELECT COUNT(*) FROM building_upgrade_queue
                 WHERE colony_id = ? AND status IN (\'queued\', \'running\') AND id <= ?'
            );
            $positionStmt->execute([$cid, $queueId]);
            $queuePosition = (int)$positionStmt->fetchColumn();

            $db->prepare(
                'UPDATE buildings SET upgrade_end=? WHERE colony_id=? AND type=?'
            )->execute([$active['eta'] ?? null, $cid, $active['building_type'] ?? $type]);

            json_ok([
                'queued' => true,
                'queue_id' => $queueId,
                'queue_position' => $queuePosition,
                'type' => $type,
                'target_level' => $nextLevel,
                'duration_secs' => $secs,
                'upgrade_end' => $active['eta'] ?? null,
                'active_type' => $active['building_type'] ?? null,
            ]);
            break;

        case 'finish':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $cid  = (int)($body['colony_id'] ?? 0);
            $db   = get_db();
            verify_colony_ownership($db, $cid, $uid);
            ensure_building_upgrade_queue_table($db);
            complete_upgrades($db, $cid);
            gq_cache_delete('buildings_list', ['uid' => $uid, 'cid' => $cid]);
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

function ensure_building_upgrade_queue_table(PDO $db): void {
    static $ready = false;
    if ($ready) return;
    $db->exec(
        'CREATE TABLE IF NOT EXISTS building_upgrade_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            colony_id INT NOT NULL,
            building_type VARCHAR(64) NOT NULL,
            target_level INT NOT NULL,
            cost_metal INT NOT NULL DEFAULT 0,
            cost_crystal INT NOT NULL DEFAULT 0,
            cost_deuterium INT NOT NULL DEFAULT 0,
            duration_secs INT NOT NULL,
            queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME DEFAULT NULL,
            eta DATETIME DEFAULT NULL,
            status ENUM(\'queued\',\'running\',\'done\',\'cancelled\') NOT NULL DEFAULT \'queued\',
            FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
            INDEX idx_buq_colony_status (colony_id, status),
            INDEX idx_buq_eta (eta)
        ) ENGINE=InnoDB'
    );
    $ready = true;
}

function start_next_building_upgrade(PDO $db, int $colonyId): ?array {
    $busyStmt = $db->prepare(
        'SELECT id FROM buildings WHERE colony_id = ? AND upgrade_end IS NOT NULL LIMIT 1'
    );
    $busyStmt->execute([$colonyId]);
    if ($busyStmt->fetch()) {
        return null;
    }

    $nextStmt = $db->prepare(
        'SELECT id, building_type, duration_secs
         FROM building_upgrade_queue
         WHERE colony_id = ? AND status = \'queued\'
         ORDER BY id ASC LIMIT 1'
    );
    $nextStmt->execute([$colonyId]);
    $next = $nextStmt->fetch();
    if (!$next) {
        return null;
    }

    $buildingExistsStmt = $db->prepare(
        'SELECT id FROM buildings WHERE colony_id = ? AND type = ? LIMIT 1'
    );
    $buildingExistsStmt->execute([$colonyId, $next['building_type']]);
    if (!$buildingExistsStmt->fetch()) {
        $db->prepare('UPDATE building_upgrade_queue SET status=\'cancelled\' WHERE id=?')
            ->execute([(int)$next['id']]);
        return start_next_building_upgrade($db, $colonyId);
    }

    $etaTs = time() + max(1, (int)$next['duration_secs']);
    $eta = date('Y-m-d H:i:s', $etaTs);

    $db->prepare(
        'UPDATE building_upgrade_queue
         SET status=\'running\', started_at=NOW(), eta=?
         WHERE id=?'
    )->execute([$eta, (int)$next['id']]);

    $db->prepare(
        'UPDATE buildings SET upgrade_end=? WHERE colony_id=? AND type=?'
    )->execute([$eta, $colonyId, $next['building_type']]);

    return [
        'queue_id' => (int)$next['id'],
        'building_type' => (string)$next['building_type'],
        'eta' => $eta,
        'duration_secs' => (int)$next['duration_secs'],
    ];
}

function complete_upgrades(PDO $db, int $colonyId): void {
    ensure_building_upgrade_queue_table($db);

    $due = $db->prepare(
        'SELECT type, level FROM buildings
         WHERE colony_id = ? AND upgrade_end IS NOT NULL AND upgrade_end <= NOW()'
    );
    $due->execute([$colonyId]);

    $completedTypes = [];

    foreach ($due->fetchAll() as $row) {
        $db->prepare(
            'UPDATE buildings SET level=level+1, upgrade_end=NULL WHERE colony_id=? AND type=?'
        )->execute([$colonyId, $row['type']]);
        $completedTypes[] = (string)$row['type'];
    }

    if (!empty($completedTypes)) {
        foreach ($completedTypes as $completedType) {
            $db->prepare(
                'UPDATE building_upgrade_queue
                 SET status=\'done\'
                 WHERE colony_id=? AND building_type=? AND status=\'running\'
                 ORDER BY id ASC LIMIT 1'
            )->execute([$colonyId, $completedType]);
        }
    }

    start_next_building_upgrade($db, $colonyId);

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
