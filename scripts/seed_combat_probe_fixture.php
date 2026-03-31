<?php

declare(strict_types=1);

/**
 * Seed a ready-to-use combat probe fixture.
 *
 * Output JSON:
 * - fleet_id
 * - attacker_user_id
 * - attacker_colony_id
 * - target_colony_id
 * - target_user_id
 *
 * Usage:
 *   php scripts/seed_combat_probe_fixture.php
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/planet_helper.php';

function ensure_user(PDO $db, string $username, bool $isNpc): int {
    $stmt = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $id = $stmt->fetchColumn();
    if ($id !== false) {
        return (int)$id;
    }

    $email = $username . '@fixture.local';
    $password = password_hash(bin2hex(random_bytes(10)), PASSWORD_BCRYPT);
    $db->prepare(
           'INSERT INTO users (username, email, password_hash, control_type, auth_enabled, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())'
        )->execute([$username, $email, $password, $isNpc ? 'npc_engine' : 'human', $isNpc ? 0 : 1]);

    return (int)$db->lastInsertId();
}

function find_free_position(PDO $db): array {
    $check = $db->prepare(
        'SELECT c.id
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?
         LIMIT 1'
    );

    $systemLimit = function_exists('galaxy_system_limit') ? galaxy_system_limit() : 499;

    for ($attempt = 0; $attempt < 100; $attempt++) {
        $g = random_int(1, GALAXY_MAX);
        $s = random_int(1, max(1, $systemLimit));
        $p = random_int(1, POSITION_MAX);
        $check->execute([$g, $s, $p]);
        if (!$check->fetch()) {
            return [$g, $s, $p];
        }
    }

    for ($g = 1; $g <= GALAXY_MAX; $g++) {
        for ($s = 1; $s <= $systemLimit; $s++) {
            for ($p = 1; $p <= POSITION_MAX; $p++) {
                $check->execute([$g, $s, $p]);
                if (!$check->fetch()) {
                    return [$g, $s, $p];
                }
            }
        }
    }

    throw new RuntimeException('No free planet position found.');
}

function ensure_planet_body_fixture(PDO $db, int $g, int $s, int $p, int $planetId): int {
    $bodyUid = sprintf('legacy-p-%d-%d-%d', $g, $s, $p);
    $stmt = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $stmt->execute([$bodyUid]);
    $bodyId = (int)($stmt->fetchColumn() ?: 0);
    if ($bodyId > 0) {
        return $bodyId;
    }
    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
             name, planet_class, can_colonize, payload_json)
         VALUES (?, ?, ?, ?, \'planet\', \'star\', ?, \'terrestrial\', 1, JSON_OBJECT(\'legacy_planet_id\', ?))'
    )->execute([$bodyUid, $g, $s, $p, 'Planet ' . $p, $planetId]);
    return (int)$db->lastInsertId();
}

function ensure_colony_with_ships(PDO $db, int $userId, string $name, array $ships, string $colonyType = 'balanced'): int {
    $stmt = $db->prepare('SELECT id FROM colonies WHERE user_id = ? ORDER BY id ASC LIMIT 1');
    $stmt->execute([$userId]);
    $colonyId = $stmt->fetchColumn();

    if ($colonyId === false) {
        [$g, $s, $p] = find_free_position($db);
        $planetId = ensure_planet($db, $g, $s, $p);
        $bodyId = ensure_planet_body_fixture($db, $g, $s, $p, $planetId);

        $db->prepare(
            'INSERT INTO colonies
                (planet_id, body_id, user_id, name, colony_type, is_homeworld,
                 metal, crystal, deuterium, rare_earth, food, energy,
                 population, max_population, happiness, public_services, last_update)
             VALUES (?, ?, ?, ?, ?, 1, 5000, 5000, 3000, 50, 500, 100, 500, 1500, 75, 40, NOW())'
        )->execute([$planetId, $bodyId, $userId, $name, $colonyType]);
        $colonyId = (int)$db->lastInsertId();

        $buildings = [
            'metal_mine' => 3,
            'crystal_mine' => 3,
            'deuterium_synth' => 2,
            'solar_plant' => 3,
            'shipyard' => 2,
            'research_lab' => 2,
            'colony_hq' => 1,
        ];
        $bStmt = $db->prepare(
            'INSERT INTO buildings (colony_id, type, level)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE level = VALUES(level)'
        );
        foreach ($buildings as $type => $level) {
            $bStmt->execute([$colonyId, $type, $level]);
        }
    } else {
        $colonyId = (int)$colonyId;
    }

    $shipStmt = $db->prepare(
        'INSERT INTO ships (colony_id, type, count)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE count = GREATEST(count, VALUES(count))'
    );
    foreach ($ships as $type => $count) {
        $shipStmt->execute([$colonyId, $type, (int)$count]);
    }

    return $colonyId;
}

function get_colony_coords(PDO $db, int $colonyId): array {
    $stmt = $db->prepare(
        'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.id = ?
         LIMIT 1'
    );
    $stmt->execute([$colonyId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Colony not found for coordinates lookup: ' . $colonyId);
    }
    return [(int)$row['galaxy'], (int)$row['system'], (int)$row['position']];
}

function create_probe_fleet(PDO $db, int $userId, int $originColonyId, int $targetColonyId): int {
    [$tg, $ts, $tp] = get_colony_coords($db, $targetColonyId);

    $ships = [
        'light_fighter' => 12,
        'heavy_fighter' => 6,
        'cruiser' => 3,
    ];

    $departure = date('Y-m-d H:i:s');
    $arrival = date('Y-m-d H:i:s', time() + 600);
    $returnT = date('Y-m-d H:i:s', time() + 1200);

    $db->prepare(
        'INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
             departure_time, arrival_time, return_time, returning)
         VALUES (?, ?, ?, ?, ?, \'attack\', ?, 0, 0, 0, ?, ?, ?, 0)'
    )->execute([
        $userId,
        $originColonyId,
        $tg,
        $ts,
        $tp,
        json_encode($ships, JSON_UNESCAPED_SLASHES),
        $departure,
        $arrival,
        $returnT,
    ]);

    return (int)$db->lastInsertId();
}

$db = get_db();

$attackerUserId = ensure_user($db, 'gq_combat_attacker', false);
$defenderUserId = ensure_user($db, 'gq_combat_defender_npc', true);

$attackerColonyId = ensure_colony_with_ships($db, $attackerUserId, 'Probe Attack Base', [
    'light_fighter' => 30,
    'heavy_fighter' => 12,
    'cruiser' => 5,
    'small_cargo' => 5,
], 'military');

$targetColonyId = ensure_colony_with_ships($db, $defenderUserId, 'Probe Defense Base', [
    'light_fighter' => 26,
    'heavy_fighter' => 10,
    'cruiser' => 4,
], 'military');

$fleetId = create_probe_fleet($db, $attackerUserId, $attackerColonyId, $targetColonyId);

echo json_encode([
    'success' => true,
    'fleet_id' => $fleetId,
    'attacker_user_id' => $attackerUserId,
    'attacker_colony_id' => $attackerColonyId,
    'target_colony_id' => $targetColonyId,
    'target_user_id' => $defenderUserId,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
