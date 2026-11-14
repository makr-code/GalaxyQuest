<?php
/**
 * Buildings API
 * GET  /api/buildings.php?action=list&colony_id=X
 * POST /api/buildings.php?action=upgrade  body: {colony_id, type}
 * POST /api/buildings.php?action=finish   body: {colony_id}
 */
use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Terrain\BodyDevelopment;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/../lib/BodyDevelopment.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid    = require_auth();

    switch ($action) {
        case 'list':
            only_method('GET');
            $cid = (int)($_GET['colony_id'] ?? 0);
            $db  = get_db();
            verify_colony_ownership($db, $cid, $uid);
            ensure_building_upgrade_queue_table($db);
            update_colony_resources($db, $cid);

            $planetStmt = $db->prepare(
                'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position,
                    c.body_id, c.population, p.type, p.planet_class, p.diameter,
                        p.in_habitable_zone, p.temp_min, p.temp_max,
                        c.colony_type, c.name
                 FROM colonies c
                 JOIN celestial_bodies cb ON cb.id = c.body_id
                 LEFT JOIN planets p ON p.id = c.planet_id
                 WHERE c.id = ? LIMIT 1'
            );
            $planetStmt->execute([$cid]);
            $planet = $planetStmt->fetch() ?: [];

            $rows = $db->prepare(
                'SELECT type, level, upgrade_end FROM buildings WHERE colony_id = ? ORDER BY type'
            );
            $rows->execute([$cid]);
            $buildings = [];
            $nanoStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "nano_materials" LIMIT 1');
            $nanoStmt->execute([$uid]);
            $nanoLevel = (int)($nanoStmt->fetchColumn() ?: 0);
            $defs = building_definitions();
            foreach ($rows->fetchAll() as $r) {
                $next = (int)$r['level'] + 1;
                $cost = building_cost($r['type'], $next);
                if ($nanoLevel >= 1) {
                    $cost['metal'] = (int)round($cost['metal'] * 0.85);
                    $cost['crystal'] = (int)round($cost['crystal'] * 0.85);
                    $cost['deuterium'] = (int)round($cost['deuterium'] * 0.85);
                }
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
                'body_development' => BodyDevelopment::enabled()
                    ? BodyDevelopment::read($db, (int)$planet['body_id']) : null,
                'buildings' => $buildings,
                'planet' => $planet,
                'layout' => $layout,
                'orbital_facilities' => summarize_orbital_facilities($buildings, $ships),
                'upgrade_queue' => $queueRows,
            ];
            json_ok($payload);
            break;

        case 'upgrade':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $cid  = (int)($body['colony_id'] ?? 0);
            $type = (string)($body['type'] ?? '');
            $db   = get_db();
            try {
                $queued = (new OnDemandEconomy($db))->queue($cid, $uid, $type);
            } catch (DomainException $error) {
                json_error($error->getMessage(), $error->getCode() ?: 400);
            }
            gq_cache_delete('buildings_list', ['uid' => $uid, 'cid' => $cid]);
            gq_cache_delete('game_overview', ['uid' => $uid]);
            gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => $cid]);
            json_ok($queued);
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
            gq_cache_delete('game_overview', ['uid' => $uid]);
            gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => $cid]);
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

function ensure_building_upgrade_queue_table(PDO $db): void
{
    require_once __DIR__ . '/../lib/GalaxySchema.php';
    \GalaxyQuest\Schema\GalaxySchema::assertBuildingQueue($db);
}

function complete_upgrades(PDO $db, int $colonyId): void {
    (new OnDemandEconomy($db))->settle($colonyId);
}

function fmt_name(string $type): string {
    return ucwords(str_replace('_', ' ', $type));
}
