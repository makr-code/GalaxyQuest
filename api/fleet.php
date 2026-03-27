<?php
/**
 * Fleet API
 * GET  /api/fleet.php?action=list
 * POST /api/fleet.php?action=send   body: {origin_colony_id, target_galaxy, target_system, target_position, mission, ships:{type:count,...}, cargo:{metal,crystal,deuterium}}
 * POST /api/fleet.php?action=recall body: {fleet_id}
 * GET  /api/fleet.php?action=check  (process arrivals – called by client polling)
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
            'SELECT f.id, f.mission, f.origin_colony_id,
                    f.target_galaxy, f.target_system, f.target_position,
                    f.ships_json, f.cargo_metal, f.cargo_crystal, f.cargo_deuterium,
                    f.departure_time, f.arrival_time, f.return_time, f.returning,
                    p.galaxy AS origin_galaxy, p.system AS origin_system, p.position AS origin_position
             FROM fleets f
             JOIN colonies c ON c.id = f.origin_colony_id
             JOIN planets  p ON p.id = c.planet_id
             WHERE f.user_id = ? ORDER BY f.arrival_time ASC'
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
        send_fleet(get_db(), $uid, get_json_body());
        break;

    case 'recall':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        recall_fleet(get_db(), $uid, (int)($body['fleet_id'] ?? 0));
        break;

    case 'check':
        only_method('GET');
        process_fleet_arrivals(get_db());
        json_ok();
        break;

    default:
        json_error('Unknown action');
}

// ─── Send ─────────────────────────────────────────────────────────────────────

function send_fleet(PDO $db, int $uid, array $body): never {
    $originCid = (int)($body['origin_colony_id'] ?? 0);
    $tg        = (int)($body['target_galaxy']    ?? 0);
    $ts        = (int)($body['target_system']    ?? 0);
    $tp        = (int)($body['target_position']  ?? 0);
    $mission   = $body['mission'] ?? 'transport';
    $ships     = $body['ships']   ?? [];
    $cargo     = $body['cargo']   ?? [];

    if (!in_array($mission, ['attack','transport','colonize','harvest','spy'], true)) {
        json_error('Invalid mission type.');
    }
    if ($tg < 1 || $tg > GALAXY_MAX || $ts < 1 || $ts > SYSTEM_MAX
        || $tp < 1 || $tp > POSITION_MAX) {
        json_error('Target coordinates out of range.');
    }

    // Verify colony ownership and get coordinates
    $colStmt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium, c.user_id,
                p.galaxy, p.system, p.position
         FROM colonies c JOIN planets p ON p.id = c.planet_id
         WHERE c.id = ? AND c.user_id = ?'
    );
    $colStmt->execute([$originCid, $uid]);
    $origin = $colStmt->fetch();
    if (!$origin) { json_error('Colony not found.', 404); }

    // PvP guard for attack missions
    if ($mission === 'attack') {
        $atkRow = $db->prepare('SELECT pvp_mode, protection_until FROM users WHERE id = ?');
        $atkRow->execute([$uid]);
        $atkUser = $atkRow->fetch();
        if ($atkUser['protection_until'] && strtotime($atkUser['protection_until']) > time()) {
            json_error('You are under newbie protection and cannot launch attacks.');
        }
        $tgtRow = $db->prepare(
            'SELECT u.pvp_mode, u.protection_until, u.is_npc
             FROM colonies c
             JOIN planets p ON p.id = c.planet_id
             JOIN users u ON u.id = c.user_id
             WHERE p.galaxy = ? AND p.system = ? AND p.position = ?'
        );
        $tgtRow->execute([$tg, $ts, $tp]);
        $tgtUser = $tgtRow->fetch();
        if ($tgtUser && !$tgtUser['is_npc']) {
            if (!$atkUser['pvp_mode']) {
                json_error('Enable PvP mode to attack other players.');
            }
            if (!$tgtUser['pvp_mode']) {
                json_error('Target player has PvP disabled.');
            }
            if ($tgtUser['protection_until'] && strtotime($tgtUser['protection_until']) > time()) {
                json_error('Target player is under newbie protection.');
            }
        }
    }

    update_colony_resources($db, $originCid);

    // Validate & collect ships
    $shipsToSend = [];
    foreach ($ships as $type => $count) {
        $count = (int)$count;
        if ($count <= 0 || !isset(SHIP_STATS[$type])) continue;
        $row = $db->prepare('SELECT count FROM ships WHERE colony_id = ? AND type = ?');
        $row->execute([$originCid, $type]);
        $available = $row->fetch();
        if (!$available || (int)$available['count'] < $count) {
            json_error("Not enough $type available.");
        }
        $shipsToSend[$type] = $count;
    }
    if (empty($shipsToSend)) { json_error('No ships selected.'); }

    // Cargo
    $cMetal = max(0.0, (float)($cargo['metal']     ?? 0));
    $cCrys  = max(0.0, (float)($cargo['crystal']   ?? 0));
    $cDeut  = max(0.0, (float)($cargo['deuterium'] ?? 0));
    $cap    = array_sum(array_map(fn($t, $c) => ship_cargo($t) * $c, array_keys($shipsToSend), $shipsToSend));
    if ($cMetal + $cCrys + $cDeut > $cap) { json_error('Cargo exceeds fleet capacity.'); }
    if ($origin['metal'] < $cMetal || $origin['crystal'] < $cCrys || $origin['deuterium'] < $cDeut) {
        json_error('Insufficient resources for cargo.');
    }

    $dist       = coordinate_distance($origin['galaxy'], $origin['system'], $origin['position'], $tg, $ts, $tp);
    $speed      = fleet_speed($shipsToSend);
    $travel     = fleet_travel_time($dist, $speed);
    $now        = time();
    $arrival    = date('Y-m-d H:i:s', $now + $travel);
    $returnT    = date('Y-m-d H:i:s', $now + $travel * 2);
    $departure  = date('Y-m-d H:i:s', $now);

    foreach ($shipsToSend as $type => $cnt) {
        $db->prepare('UPDATE ships SET count=count-? WHERE colony_id=? AND type=?')
           ->execute([$cnt, $originCid, $type]);
    }
    $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?')
       ->execute([$cMetal, $cCrys, $cDeut, $originCid]);

    $db->prepare(
        'INSERT INTO fleets (user_id, origin_colony_id, target_galaxy, target_system,
                             target_position, mission, ships_json,
                             cargo_metal, cargo_crystal, cargo_deuterium,
                             departure_time, arrival_time, return_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$uid, $originCid, $tg, $ts, $tp, $mission,
                json_encode($shipsToSend), $cMetal, $cCrys, $cDeut,
                $departure, $arrival, $returnT]);

    json_ok(['fleet_id' => (int)$db->lastInsertId(), 'arrival_time' => $arrival]);
}

// ─── Recall ───────────────────────────────────────────────────────────────────

function recall_fleet(PDO $db, int $uid, int $fleetId): never {
    $stmt = $db->prepare('SELECT * FROM fleets WHERE id=? AND user_id=? AND returning=0');
    $stmt->execute([$fleetId, $uid]);
    $fleet = $stmt->fetch();
    if (!$fleet) { json_error('Fleet not found or already returning.', 404); }

    $elapsed    = time() - strtotime($fleet['departure_time']);
    $returnSecs = max(1, $elapsed);
    $returnTime = date('Y-m-d H:i:s', time() + $returnSecs);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=? WHERE id=?')
       ->execute([$returnTime, $returnTime, $fleetId]);
    json_ok(['return_time' => $returnTime]);
}

// ─── Arrival processing ───────────────────────────────────────────────────────

function process_fleet_arrivals(PDO $db): void {
    $due = $db->prepare('SELECT * FROM fleets WHERE arrival_time <= NOW() ORDER BY arrival_time ASC');
    $due->execute();
    foreach ($due->fetchAll() as $fleet) { handle_fleet_arrival($db, $fleet); }
}

function handle_fleet_arrival(PDO $db, array $fleet): void {
    $ships = json_decode($fleet['ships_json'], true) ?? [];
    if ($fleet['returning']) { return_fleet_to_origin($db, $fleet, $ships); return; }
    match ($fleet['mission']) {
        'transport' => deliver_resources($db, $fleet, $ships),
        'attack'    => resolve_battle($db, $fleet, $ships),
        'colonize'  => colonize_planet($db, $fleet, $ships),
        'spy'       => create_spy_report($db, $fleet, $ships),
        default     => return_fleet_to_origin($db, $fleet, $ships),
    };
}

function return_fleet_to_origin(PDO $db, array $fleet, array $ships): void {
    $cid = (int)$fleet['origin_colony_id'];
    foreach ($ships as $type => $cnt) {
        $db->prepare('INSERT INTO ships (colony_id,type,count) VALUES (?,?,?) ON DUPLICATE KEY UPDATE count=count+?')
           ->execute([$cid, $type, $cnt, $cnt]);
    }
    $db->prepare('UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+? WHERE id=?')
       ->execute([$fleet['cargo_metal'], $fleet['cargo_crystal'], $fleet['cargo_deuterium'], $cid]);
    $db->prepare('DELETE FROM fleets WHERE id=?')->execute([$fleet['id']]);
}

function deliver_resources(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare('SELECT c.id FROM colonies c JOIN planets p ON p.id=c.planet_id WHERE p.galaxy=? AND p.system=? AND p.position=?');
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();
    if ($target) {
        $db->prepare('UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+? WHERE id=?')
           ->execute([$fleet['cargo_metal'], $fleet['cargo_crystal'], $fleet['cargo_deuterium'], $target['id']]);
    }
    $travel  = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=?, cargo_metal=0, cargo_crystal=0, cargo_deuterium=0 WHERE id=?')
       ->execute([$retTime, $retTime, $fleet['id']]);
}

function resolve_battle(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare('SELECT c.id, c.user_id, c.metal, c.crystal, c.deuterium FROM colonies c JOIN planets p ON p.id=c.planet_id WHERE p.galaxy=? AND p.system=? AND p.position=?');
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();

    if (!$target || (int)$target['user_id'] === (int)$fleet['user_id']) {
        $travel  = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
        $retTime = date('Y-m-d H:i:s', time() + $travel);
        $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=? WHERE id=?')->execute([$retTime, $retTime, $fleet['id']]);
        return;
    }

    $atkAtk = $atkHull = 0;
    foreach ($ships as $type => $cnt) { $s=SHIP_STATS[$type]??[]; $atkAtk+=($s['attack']??0)*$cnt; $atkHull+=($s['hull']??0)*$cnt; }

    $defShips = $db->prepare('SELECT type,count FROM ships WHERE colony_id=?');
    $defShips->execute([$target['id']]);
    $defFleet = []; $defHull = 0;
    foreach ($defShips->fetchAll() as $r) { $defFleet[$r['type']]=(int)$r['count']; $s=SHIP_STATS[$r['type']]??[]; $defHull+=($s['hull']??0)*$r['count']; }

    $attackerWins = $atkAtk > ($defHull * 0.5);
    $lootM = $lootC = $lootD = 0.0;
    if ($attackerWins) {
        $cap   = array_sum(array_map(fn($t,$c)=>ship_cargo($t)*$c, array_keys($ships), $ships));
        $lootM = min((float)$target['metal']*0.5, $cap);   $cap -= $lootM;
        $lootC = min((float)$target['crystal']*0.5, $cap); $cap -= $lootC;
        $lootD = min((float)$target['deuterium']*0.5, $cap);
        $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?')->execute([$lootM,$lootC,$lootD,$target['id']]);
        foreach ($defFleet as $type => $cnt) {
            $d=(int)round($cnt*0.3);
            if ($d>0) $db->prepare('UPDATE ships SET count=GREATEST(0,count-?) WHERE colony_id=? AND type=?')->execute([$d,$target['id'],$type]);
        }
    }

    $report=['attacker_ships'=>$ships,'defender_ships'=>$defFleet,'attacker_wins'=>$attackerWins,'loot'=>['metal'=>$lootM,'crystal'=>$lootC,'deuterium'=>$lootD]];
    $db->prepare('INSERT INTO battle_reports (attacker_id,defender_id,planet_id,report_json) VALUES (?,?,?,?)')->execute([$fleet['user_id'],$target['user_id'],$target['id'],json_encode($report)]);
    check_and_update_achievements($db, (int)$fleet['user_id']);

    $msg = $attackerWins ? "Victory at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}]! Looted: {$lootM}M {$lootC}C {$lootD}D." : "Defeat at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}].";
    $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')->execute([$fleet['user_id'],'Battle Report',$msg]);

    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time()+$travel);
    $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=?,cargo_metal=?,cargo_crystal=?,cargo_deuterium=? WHERE id=?')->execute([$retTime,$retTime,$lootM,$lootC,$lootD,$fleet['id']]);
}

function colonize_planet(PDO $db, array $fleet, array $ships): void {
    // Ensure planet record exists at target coords
    $pStmt = $db->prepare('SELECT id FROM planets WHERE galaxy=? AND system=? AND position=?');
    $pStmt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $planet = $pStmt->fetch();

    $occupied = false;
    if ($planet) {
        $cStmt = $db->prepare('SELECT id FROM colonies WHERE planet_id=?');
        $cStmt->execute([$planet['id']]);
        $occupied = (bool)$cStmt->fetch();
    }

    if ($occupied) {
        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')->execute([$fleet['user_id'],'Colonization Failed','Position already occupied.']);
    } else {
        if (!$planet) {
            $db->prepare('INSERT INTO planets (galaxy,system,position,type) VALUES (?,?,?,\'terrestrial\')')->execute([$fleet['target_galaxy'],$fleet['target_system'],$fleet['target_position']]);
            $planetId = (int)$db->lastInsertId();
        } else {
            $planetId = (int)$planet['id'];
        }

        $db->prepare('INSERT INTO colonies (planet_id,user_id,name,metal,crystal,deuterium,last_update) VALUES (?,?,?,0,0,0,NOW())')->execute([$planetId,$fleet['user_id'],'Colony ['.$fleet['target_galaxy'].':'.$fleet['target_system'].':'.$fleet['target_position'].']']);
        $colonyId = (int)$db->lastInsertId();

        foreach (array_keys(BUILDING_BASE_COST) as $bType) {
            $db->prepare('INSERT IGNORE INTO buildings (colony_id,type,level) VALUES (?,?,0)')->execute([$colonyId,$bType]);
        }

        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')->execute([$fleet['user_id'],'Colony Established','Colony established at ['.$fleet['target_galaxy'].':'.$fleet['target_system'].':'.$fleet['target_position'].']!']);
        check_and_update_achievements($db, (int)$fleet['user_id']);
    }

    unset($ships['colony_ship']);
    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time()+$travel);
    $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=?,ships_json=? WHERE id=?')->execute([$retTime,$retTime,json_encode($ships),$fleet['id']]);
}

function create_spy_report(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare('SELECT c.id,c.metal,c.crystal,c.deuterium,u.username FROM colonies c JOIN planets p ON p.id=c.planet_id JOIN users u ON u.id=c.user_id WHERE p.galaxy=? AND p.system=? AND p.position=?');
    $tgt->execute([$fleet['target_galaxy'],$fleet['target_system'],$fleet['target_position']]);
    $target = $tgt->fetch();
    $report = $target ? ['metal'=>$target['metal'],'crystal'=>$target['crystal'],'deuterium'=>$target['deuterium'],'owner'=>$target['username']] : ['error'=>'Empty coordinates'];
    $db->prepare('INSERT INTO spy_reports (owner_id,target_planet_id,report_json) VALUES (?,?,?)')->execute([$fleet['user_id'],$target['id']??null,json_encode($report)]);
    check_and_update_achievements($db,(int)$fleet['user_id']);
    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time()+$travel);
    $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=? WHERE id=?')->execute([$retTime,$retTime,$fleet['id']]);
}
