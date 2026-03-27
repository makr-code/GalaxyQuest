<?php
/**
 * Fleet API
 * GET  /api/fleet.php?action=list
 * POST /api/fleet.php?action=send  body: {origin_planet_id, target_galaxy, target_system, target_position, mission, ships:{type:count,...}, cargo:{metal,crystal,deuterium}}
 * POST /api/fleet.php?action=recall  body: {fleet_id}
 * GET  /api/fleet.php?action=check   (process arrivals)
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';
require_once __DIR__ . '/achievements.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $db = get_db();
        process_fleet_arrivals($db);
        $stmt = $db->prepare(
            'SELECT id, mission, origin_planet_id, target_galaxy, target_system, target_position,
                    ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
                    departure_time, arrival_time, return_time, returning
             FROM fleets WHERE user_id = ? ORDER BY arrival_time ASC'
        );
        $stmt->execute([$uid]);
        $fleets = [];
        foreach ($stmt->fetchAll() as $f) {
            $f['ships'] = json_decode($f['ships_json'], true);
            unset($f['ships_json']);
            $fleets[] = $f;
        }
        json_ok(['fleets' => $fleets]);
        break;

    case 'send':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $db   = get_db();
        send_fleet($db, $uid, $body);
        break;

    case 'recall':
        only_method('POST');
        verify_csrf();
        $body    = get_json_body();
        $fleetId = (int)($body['fleet_id'] ?? 0);
        $db      = get_db();
        recall_fleet($db, $uid, $fleetId);
        break;

    case 'check':
        only_method('GET');
        $db = get_db();
        process_fleet_arrivals($db);
        json_ok();
        break;

    default:
        json_error('Unknown action');
}

// ─── Fleet send ──────────────────────────────────────────────────────────────

function send_fleet(PDO $db, int $uid, array $body): never {
    $originId = (int)($body['origin_planet_id']  ?? 0);
    $tg       = (int)($body['target_galaxy']      ?? 0);
    $ts       = (int)($body['target_system']      ?? 0);
    $tp       = (int)($body['target_position']    ?? 0);
    $mission  = $body['mission']                   ?? 'transport';
    $ships    = $body['ships']                     ?? [];
    $cargo    = $body['cargo']                     ?? [];

    $allowedMissions = ['attack', 'transport', 'colonize', 'harvest', 'spy'];
    if (!in_array($mission, $allowedMissions, true)) {
        json_error('Invalid mission type.');
    }
    if ($tg < 1 || $tg > GALAXY_MAX || $ts < 1 || $ts > SYSTEM_MAX
        || $tp < 1 || $tp > POSITION_MAX) {
        json_error('Target coordinates out of range.');
    }

    // ── PvP / protection guard ──────────────────────────────────────────────
    if ($mission === 'attack') {
        // Check whether the attacker has PvP enabled
        $atkRow = $db->prepare('SELECT pvp_mode, protection_until FROM users WHERE id = ?');
        $atkRow->execute([$uid]);
        $atkUser = $atkRow->fetch();

        if ($atkUser['protection_until'] && strtotime($atkUser['protection_until']) > time()) {
            json_error('You are under newbie protection and cannot launch attacks yet.');
        }

        // Check target planet owner
        $tgtRow = $db->prepare(
            'SELECT u.pvp_mode, u.protection_until, u.is_npc
             FROM planets p JOIN users u ON u.id = p.user_id
             WHERE p.galaxy = ? AND p.system = ? AND p.position = ?'
        );
        $tgtRow->execute([$tg, $ts, $tp]);
        $tgtUser = $tgtRow->fetch();

        if ($tgtUser && !$tgtUser['is_npc']) {
            // Target is a real player
            if (!$atkUser['pvp_mode']) {
                json_error('Enable PvP mode in your overview to attack other players.');
            }
            if (!$tgtUser['pvp_mode']) {
                json_error('Target player has PvP mode disabled and cannot be attacked.');
            }
            if ($tgtUser['protection_until'] && strtotime($tgtUser['protection_until']) > time()) {
                json_error('Target player is under newbie protection.');
            }
        }
    }

    verify_planet_ownership($db, $originId, $uid);
    update_planet_resources($db, $originId);

    // Validate ships
    $shipsToSend = [];
    foreach ($ships as $type => $count) {
        $count = (int)$count;
        if ($count <= 0 || !isset(SHIP_STATS[$type])) continue;
        // Check availability
        $stmt = $db->prepare('SELECT count FROM ships WHERE planet_id = ? AND type = ?');
        $stmt->execute([$originId, $type]);
        $row = $stmt->fetch();
        if (!$row || (int)$row['count'] < $count) {
            json_error("Not enough $type ships available.");
        }
        $shipsToSend[$type] = $count;
    }
    if (empty($shipsToSend)) {
        json_error('No ships selected.');
    }

    // Cargo
    $cargoMetal     = max(0.0, (float)($cargo['metal']     ?? 0));
    $cargoCrystal   = max(0.0, (float)($cargo['crystal']   ?? 0));
    $cargoDeuterium = max(0.0, (float)($cargo['deuterium'] ?? 0));

    // Check cargo capacity
    $totalCargo = 0;
    foreach ($shipsToSend as $type => $cnt) {
        $totalCargo += ship_cargo($type) * $cnt;
    }
    if ($cargoMetal + $cargoCrystal + $cargoDeuterium > $totalCargo) {
        json_error('Cargo exceeds fleet capacity.');
    }

    // Check resources for cargo
    $planetRes = $db->prepare('SELECT metal, crystal, deuterium FROM planets WHERE id = ?');
    $planetRes->execute([$originId]);
    $res = $planetRes->fetch();
    if ($res['metal'] < $cargoMetal || $res['crystal'] < $cargoCrystal
        || $res['deuterium'] < $cargoDeuterium) {
        json_error('Insufficient resources for cargo.');
    }

    // Origin coordinates
    $originCoord = $db->prepare('SELECT galaxy, system, position FROM planets WHERE id = ?');
    $originCoord->execute([$originId]);
    $oc = $originCoord->fetch();

    $distance    = coordinate_distance($oc['galaxy'], $oc['system'], $oc['position'], $tg, $ts, $tp);
    $speed       = fleet_speed($shipsToSend);
    $travelSecs  = fleet_travel_time($distance, $speed);
    $now         = time();
    $arrivalTime = date('Y-m-d H:i:s', $now + $travelSecs);
    $returnTime  = date('Y-m-d H:i:s', $now + $travelSecs * 2);
    $departure   = date('Y-m-d H:i:s', $now);

    // Deduct ships and cargo
    foreach ($shipsToSend as $type => $cnt) {
        $db->prepare(
            'UPDATE ships SET count = count - ? WHERE planet_id = ? AND type = ?'
        )->execute([$cnt, $originId, $type]);
    }
    $db->prepare(
        'UPDATE planets SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
         WHERE id = ?'
    )->execute([$cargoMetal, $cargoCrystal, $cargoDeuterium, $originId]);

    $db->prepare(
        'INSERT INTO fleets (user_id, origin_planet_id, target_galaxy, target_system,
                             target_position, mission, ships_json,
                             cargo_metal, cargo_crystal, cargo_deuterium,
                             departure_time, arrival_time, return_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $uid, $originId, $tg, $ts, $tp, $mission,
        json_encode($shipsToSend),
        $cargoMetal, $cargoCrystal, $cargoDeuterium,
        $departure, $arrivalTime, $returnTime,
    ]);
    $fleetId = (int)$db->lastInsertId();

    json_ok(['fleet_id' => $fleetId, 'arrival_time' => $arrivalTime]);
}

// ─── Recall ──────────────────────────────────────────────────────────────────

function recall_fleet(PDO $db, int $uid, int $fleetId): never {
    $stmt = $db->prepare(
        'SELECT * FROM fleets WHERE id = ? AND user_id = ? AND returning = 0'
    );
    $stmt->execute([$fleetId, $uid]);
    $fleet = $stmt->fetch();
    if (!$fleet) {
        json_error('Fleet not found or already returning.', 404);
    }

    $now         = time();
    $departure   = strtotime($fleet['departure_time']);
    $arrival     = strtotime($fleet['arrival_time']);
    $elapsed     = $now - $departure;
    $totalTime   = $arrival - $departure;
    $returnSecs  = max(1, $elapsed);     // same travel time as elapsed
    $returnTime  = date('Y-m-d H:i:s', $now + $returnSecs);

    $db->prepare(
        'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?'
    )->execute([$returnTime, $returnTime, $fleetId]);

    json_ok(['return_time' => $returnTime]);
}

// ─── Process arrivals ─────────────────────────────────────────────────────────

function process_fleet_arrivals(PDO $db): void {
    $due = $db->prepare(
        'SELECT * FROM fleets WHERE arrival_time <= NOW() ORDER BY arrival_time ASC'
    );
    $due->execute();
    foreach ($due->fetchAll() as $fleet) {
        handle_fleet_arrival($db, $fleet);
    }
}

function handle_fleet_arrival(PDO $db, array $fleet): void {
    $ships = json_decode($fleet['ships_json'], true) ?? [];

    if ($fleet['returning']) {
        // Return to origin
        return_fleet_to_origin($db, $fleet, $ships);
        return;
    }

    switch ($fleet['mission']) {
        case 'transport':
            deliver_resources($db, $fleet, $ships);
            break;
        case 'attack':
            resolve_battle($db, $fleet, $ships);
            break;
        case 'colonize':
            colonize_planet($db, $fleet, $ships);
            break;
        case 'spy':
            create_spy_report($db, $fleet, $ships);
            break;
        case 'harvest':
            harvest_debris($db, $fleet, $ships);
            break;
        default:
            return_fleet_to_origin($db, $fleet, $ships);
    }
}

function return_fleet_to_origin(PDO $db, array $fleet, array $ships): void {
    $oPid = (int)$fleet['origin_planet_id'];
    // Return ships
    foreach ($ships as $type => $cnt) {
        $db->prepare(
            'INSERT INTO ships (planet_id, type, count) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE count = count + ?'
        )->execute([$oPid, $type, $cnt, $cnt]);
    }
    // Return cargo
    $db->prepare(
        'UPDATE planets SET metal = metal + ?, crystal = crystal + ?, deuterium = deuterium + ?
         WHERE id = ?'
    )->execute([
        $fleet['cargo_metal'], $fleet['cargo_crystal'], $fleet['cargo_deuterium'], $oPid
    ]);
    $db->prepare('DELETE FROM fleets WHERE id = ?')->execute([$fleet['id']]);
}

function deliver_resources(PDO $db, array $fleet, array $ships): void {
    // Find target planet
    $stmt = $db->prepare(
        'SELECT id FROM planets WHERE galaxy = ? AND system = ? AND position = ?'
    );
    $stmt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $stmt->fetch();

    if ($target) {
        $db->prepare(
            'UPDATE planets SET metal = metal + ?, crystal = crystal + ?, deuterium = deuterium + ?
             WHERE id = ?'
        )->execute([
            $fleet['cargo_metal'], $fleet['cargo_crystal'], $fleet['cargo_deuterium'],
            $target['id']
        ]);
        // If it's the owner's planet, ships stay; else ships return
    }

    // Fleet returns (with empty cargo if delivered, or with cargo if no target)
    $returnSecs = (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time']));
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    if ($target) {
        $db->prepare(
            'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ?,
                               cargo_metal = 0, cargo_crystal = 0, cargo_deuterium = 0
             WHERE id = ?'
        )->execute([$returnTime, $returnTime, $fleet['id']]);
    } else {
        $db->prepare(
            'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?'
        )->execute([$returnTime, $returnTime, $fleet['id']]);
    }
}

function resolve_battle(PDO $db, array $fleet, array $ships): void {
    // Simplified battle: total attack vs total hull
    $stmt = $db->prepare(
        'SELECT p.*, p.user_id AS defender_id
         FROM planets p
         WHERE p.galaxy = ? AND p.system = ? AND p.position = ?'
    );
    $stmt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $stmt->fetch();

    if (!$target || (int)$target['defender_id'] === (int)$fleet['user_id']) {
        // No target or own planet – return fleet
        $returnSecs = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
        $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
        $db->prepare(
            'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?'
        )->execute([$returnTime, $returnTime, $fleet['id']]);
        return;
    }

    // Attacker stats
    $atkAttack = $atkHull = 0;
    foreach ($ships as $type => $cnt) {
        $s = SHIP_STATS[$type] ?? [];
        $atkAttack += ($s['attack'] ?? 0) * $cnt;
        $atkHull   += ($s['hull']   ?? 0) * $cnt;
    }

    // Defender ships
    $defShips = $db->prepare('SELECT type, count FROM ships WHERE planet_id = ?');
    $defShips->execute([$target['id']]);
    $defFleet = [];
    foreach ($defShips->fetchAll() as $r) {
        $defFleet[$r['type']] = (int)$r['count'];
    }
    $defAttack = $defHull = 0;
    foreach ($defFleet as $type => $cnt) {
        $s = SHIP_STATS[$type] ?? [];
        $defAttack += ($s['attack'] ?? 0) * $cnt;
        $defHull   += ($s['hull']   ?? 0) * $cnt;
    }

    // Outcome: attacker wins if attack > 50% of defender hull
    $attackerWins = $atkAttack > ($defHull * 0.5);

    $lootMetal = $lootCrystal = $lootDeuterium = 0;
    if ($attackerWins) {
        // Loot up to 50% of resources, capped by fleet cargo capacity
        $fleetCargo = array_sum(array_map(
            fn($t, $c) => ship_cargo($t) * $c,
            array_keys($ships), $ships
        ));
        $lootMetal     = min((float)$target['metal']     * 0.5, $fleetCargo);
        $remaining     = $fleetCargo - $lootMetal;
        $lootCrystal   = min((float)$target['crystal']   * 0.5, $remaining);
        $remaining    -= $lootCrystal;
        $lootDeuterium = min((float)$target['deuterium'] * 0.5, $remaining);

        $db->prepare(
            'UPDATE planets SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
             WHERE id = ?'
        )->execute([$lootMetal, $lootCrystal, $lootDeuterium, $target['id']]);

        // Destroy 30% of defender ships
        foreach ($defFleet as $type => $cnt) {
            $destroyed = (int)round($cnt * 0.3);
            if ($destroyed > 0) {
                $db->prepare(
                    'UPDATE ships SET count = GREATEST(0, count - ?) WHERE planet_id = ? AND type = ?'
                )->execute([$destroyed, $target['id'], $type]);
            }
        }
    }

    // Build report
    $report = [
        'attacker_ships'  => $ships,
        'defender_ships'  => $defFleet,
        'attacker_wins'   => $attackerWins,
        'loot'            => ['metal' => $lootMetal, 'crystal' => $lootCrystal, 'deuterium' => $lootDeuterium],
    ];
    $db->prepare(
        'INSERT INTO battle_reports (attacker_id, defender_id, planet_id, report_json)
         VALUES (?, ?, ?, ?)'
    )->execute([$fleet['user_id'], $target['defender_id'], $target['id'], json_encode($report)]);

    // Check combat achievements for attacker
    check_and_update_achievements($db, (int)$fleet['user_id']);

    // Message both players
    $msgBody = $attackerWins
        ? "Your fleet attacked [" . $fleet['target_galaxy'] . ':' . $fleet['target_system'] . ':' . $fleet['target_position'] . "] and WON. Looted: {$lootMetal} metal, {$lootCrystal} crystal, {$lootDeuterium} deuterium."
        : "Your fleet attacked [" . $fleet['target_galaxy'] . ':' . $fleet['target_system'] . ':' . $fleet['target_position'] . "] but LOST.";
    $db->prepare(
        'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
    )->execute([$fleet['user_id'], 'Battle Report', $msgBody]);

    // Return fleet
    $returnSecs = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    $db->prepare(
        'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ?,
                           cargo_metal = ?, cargo_crystal = ?, cargo_deuterium = ?
         WHERE id = ?'
    )->execute([$returnTime, $returnTime, $lootMetal, $lootCrystal, $lootDeuterium, $fleet['id']]);
}

function colonize_planet(PDO $db, array $fleet, array $ships): void {
    // Check if position is free
    $stmt = $db->prepare(
        'SELECT id FROM planets WHERE galaxy = ? AND system = ? AND position = ?'
    );
    $stmt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $existing = $stmt->fetch();

    if ($existing) {
        // Cannot colonize – return
        $db->prepare(
            'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
        )->execute([
            $fleet['user_id'],
            'Colonization Failed',
            'The target position [' . $fleet['target_galaxy'] . ':' . $fleet['target_system'] . ':' . $fleet['target_position'] . '] is already occupied.'
        ]);
    } else {
        // Create colony
        $db->prepare(
            'INSERT INTO planets (user_id, name, galaxy, system, position, type, is_homeworld,
                                  metal, crystal, deuterium, last_update)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NOW())'
        )->execute([
            $fleet['user_id'],
            'Colony [' . $fleet['target_galaxy'] . ':' . $fleet['target_system'] . ':' . $fleet['target_position'] . ']',
            $fleet['target_galaxy'],
            $fleet['target_system'],
            $fleet['target_position'],
            'terrestrial',
        ]);
        $newPlanetId = (int)$db->lastInsertId();

        // Seed default buildings level 0
        foreach (array_keys(BUILDING_BASE_COST) as $bType) {
            $db->prepare(
                'INSERT IGNORE INTO buildings (planet_id, type, level) VALUES (?, ?, 0)'
            )->execute([$newPlanetId, $bType]);
        }

        // Remove colony ship from fleet
        unset($ships['colony_ship']);
        $db->prepare(
            'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
        )->execute([
            $fleet['user_id'],
            'Colony Established',
            'You have successfully colonized [' . $fleet['target_galaxy'] . ':' . $fleet['target_system'] . ':' . $fleet['target_position'] . ']!'
        ]);

        // Check expansion achievements
        check_and_update_achievements($db, (int)$fleet['user_id']);
    }

    // Return remaining ships (excluding consumed colony ship)
    $returnSecs = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    $db->prepare(
        'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ?, ships_json = ?
         WHERE id = ?'
    )->execute([$returnTime, $returnTime, json_encode($ships), $fleet['id']]);
}

function create_spy_report(PDO $db, array $fleet, array $ships): void {
    $stmt = $db->prepare(
        'SELECT p.*, u.username
         FROM planets p JOIN users u ON u.id = p.user_id
         WHERE p.galaxy = ? AND p.system = ? AND p.position = ?'
    );
    $stmt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $stmt->fetch();

    $report = $target
        ? ['metal' => $target['metal'], 'crystal' => $target['crystal'],
           'deuterium' => $target['deuterium'], 'owner' => $target['username']]
        : ['error' => 'No planet at target coordinates'];

    $db->prepare(
        'INSERT INTO spy_reports (owner_id, target_planet_id, report_json)
         VALUES (?, ?, ?)'
    )->execute([$fleet['user_id'], $target['id'] ?? null, json_encode($report)]);

    check_and_update_achievements($db, (int)$fleet['user_id']);

    $returnSecs = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    $db->prepare(
        'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?'
    )->execute([$returnTime, $returnTime, $fleet['id']]);
}

function harvest_debris(PDO $db, array $fleet, array $ships): void {
    // No debris field mechanic for simplicity – just return
    $returnSecs = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    $db->prepare(
        'UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?'
    )->execute([$returnTime, $returnTime, $fleet['id']]);
}
