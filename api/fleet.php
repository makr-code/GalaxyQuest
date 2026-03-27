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
require_once __DIR__ . '/planet_helper.php';

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
            $f['ships']   = json_decode($f['ships_json'], true);
            unset($f['ships_json']);
            $f['current_pos'] = fleet_current_position($f);
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

    // ── 3-D Newtonian movement ──────────────────────────────────────────────
    [$ox, $oy, $oz] = get_system_3d_coords($db, $origin['galaxy'], $origin['system']);
    [$tx, $ty, $tz] = get_system_3d_coords($db, $tg, $ts);
    $distLy   = fleet_3d_distance($ox, $oy, $oz, $tx, $ty, $tz);
    $speedLyH = fleet_speed_ly_h($shipsToSend);

    // Check for fleet commander bonus on origin colony
    $commander = get_colony_leader($db, $originCid, 'fleet_commander');
    if ($commander) {
        $speedLyH = leader_fleet_speed($speedLyH, (int)$commander['skill_navigation']);
    }

    // Use 3-D travel time when coords are available (distLy > 0), else fall back to grid
    if ($distLy > 0) {
        $travel = fleet_travel_time_3d($distLy, $speedLyH);
    }
    // ── end 3-D ────────────────────────────────────────────────────────────

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
                             origin_x_ly, origin_y_ly, origin_z_ly,
                             target_x_ly, target_y_ly, target_z_ly,
                             speed_ly_h, distance_ly,
                             departure_time, arrival_time, return_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$uid, $originCid, $tg, $ts, $tp, $mission,
                json_encode($shipsToSend), $cMetal, $cCrys, $cDeut,
                $ox, $oy, $oz, $tx, $ty, $tz, $speedLyH, $distLy,
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
        'harvest'   => harvest_resources($db, $fleet, $ships),
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
    $tgt = $db->prepare(
        'SELECT c.id, c.user_id, c.metal, c.crystal, c.deuterium, c.rare_earth
         FROM colonies c JOIN planets p ON p.id=c.planet_id
         WHERE p.galaxy=? AND p.system=? AND p.position=?'
    );
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();

    if (!$target || (int)$target['user_id'] === (int)$fleet['user_id']) {
        $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
        $retTime = date('Y-m-d H:i:s', time() + $travel);
        $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=? WHERE id=?')
           ->execute([$retTime, $retTime, $fleet['id']]);
        return;
    }

    // ── Attacker stats — weapons tech + fleet commander bonus ──────────────
    $wpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $wpnRow->execute([$fleet['user_id']]);
    $atkWpnLevel = (int)($wpnRow->fetchColumn() ?? 0);

    $atkShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $atkShldRow->execute([$fleet['user_id']]);
    $atkShldLevel = (int)($atkShldRow->fetchColumn() ?? 0);

    // Fleet commander attack bonus (+2% per skill_attack level)
    $cmdRow = $db->prepare('SELECT skill_attack FROM leaders WHERE fleet_id=? AND role=\'fleet_commander\' LIMIT 1');
    $cmdRow->execute([$fleet['id']]);
    $cmd = $cmdRow->fetch();
    $cmdBonus = $cmd ? (1.0 + (int)$cmd['skill_attack'] * 0.02) : 1.0;

    $atkMulti = (1.0 + $atkWpnLevel * 0.1) * $cmdBonus;
    $atkAtk   = 0; $atkHull = 0; $atkShield = 0;
    foreach ($ships as $type => $cnt) {
        $s = SHIP_STATS[$type] ?? [];
        $atkAtk    += (($s['attack'] ?? 0) * $cnt) * $atkMulti;
        $atkHull   += ($s['hull']   ?? 0) * $cnt;
        $atkShield += (($s['shield'] ?? 0) * $cnt) * (1.0 + $atkShldLevel * 0.1);
    }

    // ── Defender stats — weapons + shielding tech ──────────────────────────
    $defWpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $defWpnRow->execute([$target['user_id']]);
    $defWpnLevel  = (int)($defWpnRow->fetchColumn()  ?? 0);

    $defShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $defShldRow->execute([$target['user_id']]);
    $defShldLevel = (int)($defShldRow->fetchColumn() ?? 0);

    $defShips = $db->prepare('SELECT type, count FROM ships WHERE colony_id=?');
    $defShips->execute([$target['id']]);
    $defFleet = []; $defHull = 0; $defAtk = 0; $defShield = 0;
    foreach ($defShips->fetchAll() as $r) {
        $defFleet[$r['type']] = (int)$r['count'];
        $s = SHIP_STATS[$r['type']] ?? [];
        $defAtk    += (($s['attack'] ?? 0) * $r['count']) * (1.0 + $defWpnLevel  * 0.1);
        $defHull   += ($s['hull']   ?? 0) * $r['count'];
        $defShield += (($s['shield'] ?? 0) * $r['count']) * (1.0 + $defShldLevel * 0.1);
    }

    // ── Combat resolution ──────────────────────────────────────────────────
    // Attacker must penetrate defender's shields then hull
    $atkEffectiveDmg = max(0, $atkAtk - $defShield * 0.5);
    $defEffectiveDmg = max(0, $defAtk - $atkShield * 0.5);

    // Multiple rounds (simplified): attacker wins if it deals > 50% of defender's HP
    $attackerWins = $atkEffectiveDmg > ($defHull * 0.5 + $defShield * 0.2);

    // ── Losses ────────────────────────────────────────────────────────────
    $atkLossFraction = $defEffectiveDmg > 0
        ? min(0.9, $defEffectiveDmg / max(1, $atkHull + $atkShield))
        : 0.0;
    $defLossFraction = $attackerWins ? min(0.9, $atkEffectiveDmg / max(1, $defHull + $defShield)) : 0.3;

    $atkSurvivors = []; $atkLostShips = [];
    foreach ($ships as $type => $cnt) {
        $lost = (int)round($cnt * $atkLossFraction);
        $atkLostShips[$type]   = $lost;
        $atkSurvivors[$type]   = $cnt - $lost;
    }
    $defLostShips = [];
    foreach ($defFleet as $type => $cnt) {
        $lost = (int)round($cnt * $defLossFraction);
        $defLostShips[$type] = $lost;
        if ($lost > 0) {
            $db->prepare('UPDATE ships SET count=GREATEST(0,count-?) WHERE colony_id=? AND type=?')
               ->execute([$lost, $target['id'], $type]);
        }
    }

    // ── Loot ──────────────────────────────────────────────────────────────
    $lootM = $lootC = $lootD = $lootRE = 0.0;
    if ($attackerWins) {
        $cap   = array_sum(array_map(fn($t,$c)=>ship_cargo($t)*$c,
                           array_keys($atkSurvivors), $atkSurvivors));
        $lootM = min((float)$target['metal']      * 0.5, $cap);     $cap -= $lootM;
        $lootC = min((float)$target['crystal']    * 0.5, $cap);     $cap -= $lootC;
        $lootD = min((float)$target['deuterium']  * 0.5, $cap);     $cap -= $lootD;
        $lootRE= min((float)($target['rare_earth'] ?? 0) * 0.3, $cap);
        $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?,
                                          deuterium=deuterium-?, rare_earth=rare_earth-? WHERE id=?')
           ->execute([$lootM, $lootC, $lootD, $lootRE, $target['id']]);

        // Happiness impact on looted colony
        $db->prepare('UPDATE colonies SET happiness=GREATEST(0, happiness-20) WHERE id=?')
           ->execute([$target['id']]);
    }

    // ── Update attacker's surviving ships ──────────────────────────────────
    foreach ($atkLostShips as $type => $lost) {
        if ($lost > 0) {
            $db->prepare('UPDATE ships SET count=GREATEST(0,count-?) WHERE colony_id=? AND type=?')
               ->execute([$lost, $fleet['origin_colony_id'], $type]);
        }
    }

    // ── Battle report ─────────────────────────────────────────────────────
    $report = [
        'attacker_ships'    => $ships,
        'attacker_survivors'=> $atkSurvivors,
        'attacker_lost'     => $atkLostShips,
        'defender_ships'    => $defFleet,
        'defender_lost'     => $defLostShips,
        'attacker_wins'     => $attackerWins,
        'loot'              => ['metal'=>$lootM,'crystal'=>$lootC,'deuterium'=>$lootD,'rare_earth'=>$lootRE],
        'tech'              => ['atk_wpn'=>$atkWpnLevel,'atk_shld'=>$atkShldLevel,
                                'def_wpn'=>$defWpnLevel,'def_shld'=>$defShldLevel],
    ];
    $db->prepare('INSERT INTO battle_reports (attacker_id,defender_id,planet_id,report_json)
                  VALUES (?,?,?,?)')
       ->execute([$fleet['user_id'], $target['user_id'], $target['id'], json_encode($report)]);
    check_and_update_achievements($db, (int)$fleet['user_id']);

    // ── Diplomacy impact: attacking a faction NPC degrades standing ────────
    $defNpc = $db->prepare('SELECT is_npc FROM users WHERE id=?');
    $defNpc->execute([$target['user_id']]);
    $defUser = $defNpc->fetch();
    if ($defUser && $defUser['is_npc']) {
        // Find which faction this NPC belongs to (look up by faction colonies)
        // Simplified: just degrade pirate standing if attacking NPC
        require_once __DIR__ . '/factions.php';
        // TODO: link NPC users to faction — for now skip
    }

    // ── Messages ─────────────────────────────────────────────────────────
    $lootStr = "Metal:{$lootM} Crystal:{$lootC} Deut:{$lootD}" . ($lootRE > 0 ? " RE:{$lootRE}" : '');
    $atkMsg  = $attackerWins
        ? "⚔ VICTORY at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}]! "
          . "Looted: {$lootStr}."
        : "💀 DEFEAT at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}].";
    $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
       ->execute([$fleet['user_id'], 'Battle Report', $atkMsg]);
    $defMsg = $attackerWins
        ? "Your colony at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}] was attacked and defeated! Lost: {$lootStr}."
        : "Attack on your colony at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}] was repelled!";
    $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
       ->execute([$target['user_id'], 'Colony Attacked', $defMsg]);

    // ── Return fleet ──────────────────────────────────────────────────────
    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare(
        'UPDATE fleets SET returning=1, arrival_time=?, return_time=?,
                           cargo_metal=?, cargo_crystal=?, cargo_deuterium=?, ships_json=?
         WHERE id=?'
    )->execute([$retTime, $retTime, $lootM, $lootC, $lootD, json_encode($atkSurvivors), $fleet['id']]);
}

function colonize_planet(PDO $db, array $fleet, array $ships): void {
    $planetId = ensure_planet($db, (int)$fleet['target_galaxy'],
                              (int)$fleet['target_system'], (int)$fleet['target_position']);

    // Check if already colonised
    $cRow = $db->prepare('SELECT id FROM colonies WHERE planet_id=?');
    $cRow->execute([$planetId]);
    if ($cRow->fetch()) {
        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
           ->execute([$fleet['user_id'], 'Colonisation Failed', 'Position already occupied.']);
    } else {
        // Get planet info for starting resources
        $pInfo = $db->prepare('SELECT planet_class, richness_metal, deposit_metal FROM planets WHERE id=?');
        $pInfo->execute([$planetId]);
        $pData = $pInfo->fetch();

        $db->prepare(
            'INSERT INTO colonies (planet_id, user_id, name, metal, crystal, deuterium,
                                   food, population, max_population, happiness, last_update)
             VALUES (?, ?, ?, 500, 300, 100, 200, 100, 500, 70, NOW())'
        )->execute([
            $planetId, $fleet['user_id'],
            'Colony ['.$fleet['target_galaxy'].':'.$fleet['target_system'].':'.$fleet['target_position'].']',
        ]);
        $colonyId = (int)$db->lastInsertId();

        // Seed all building types at level 0 (metal_mine, solar_plant start at 1)
        $starterLevels = ['metal_mine' => 1, 'crystal_mine' => 0, 'deuterium_synth' => 0,
            'rare_earth_drill' => 0, 'solar_plant' => 1, 'fusion_reactor' => 0,
            'hydroponic_farm' => 0, 'food_silo' => 0, 'habitat' => 0,
            'hospital' => 0, 'school' => 0, 'security_post' => 0,
            'robotics_factory' => 0, 'shipyard' => 0, 'metal_storage' => 0,
            'crystal_storage' => 0, 'deuterium_tank' => 0, 'research_lab' => 0,
            'missile_silo' => 0, 'nanite_factory' => 0, 'terraformer' => 0, 'colony_hq' => 0];
        foreach ($starterLevels as $bType => $lv) {
            $db->prepare('INSERT IGNORE INTO buildings (colony_id,type,level) VALUES (?,?,?)')
               ->execute([$colonyId, $bType, $lv]);
        }

        $pClass = $pData['planet_class'] ?? 'terrestrial';
        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
           ->execute([$fleet['user_id'], 'Colony Established',
               "Colony established at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}]! "
               . "Planet type: {$pClass}. Initial food: 200, population: 100."]);
        check_and_update_achievements($db, (int)$fleet['user_id']);
    }

    // Return without colony ship
    unset($ships['colony_ship']);
    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=?, ships_json=? WHERE id=?')
       ->execute([$retTime, $retTime, json_encode($ships), $fleet['id']]);
}

function create_spy_report(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium, c.rare_earth, c.food,
                c.population, c.max_population, c.happiness, c.public_services, c.energy,
                p.planet_class, p.diameter, p.in_habitable_zone,
                p.deposit_metal, p.deposit_crystal, p.deposit_deuterium, p.deposit_rare_earth,
                p.richness_metal, p.richness_crystal,
                u.username
         FROM colonies c
         JOIN planets  p ON p.id = c.planet_id
         JOIN users    u ON u.id = c.user_id
         WHERE p.galaxy=? AND p.system=? AND p.position=?'
    );
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();

    if (!$target) {
        // Uninhabited — still report planet geology if it exists
        $pRow = $db->prepare(
            'SELECT planet_class, in_habitable_zone, deposit_metal, deposit_crystal,
                    deposit_deuterium, deposit_rare_earth, richness_metal, richness_crystal,
                    richness_deuterium, richness_rare_earth
             FROM planets WHERE galaxy=? AND system=? AND position=?'
        );
        $pRow->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
        $pData = $pRow->fetch();

        $report = [
            'status'       => 'uninhabited',
            'planet'       => $pData ?: null,
        ];
    } else {
        // Fetch defender's assigned leaders
        $lRow = $db->prepare('SELECT name, role, level FROM leaders WHERE colony_id=?');
        $lRow->execute([$target['id']]);
        $leaders = $lRow->fetchAll();

        // Fetch defender's ships
        $sRow = $db->prepare('SELECT type, count FROM ships WHERE colony_id=? AND count > 0');
        $sRow->execute([$target['id']]);
        $defShips = [];
        foreach ($sRow->fetchAll() as $r) { $defShips[$r['type']] = (int)$r['count']; }

        $report = [
            'status'       => 'inhabited',
            'owner'        => $target['username'],
            'resources'    => [
                'metal'      => (float)$target['metal'],
                'crystal'    => (float)$target['crystal'],
                'deuterium'  => (float)$target['deuterium'],
                'rare_earth' => (float)$target['rare_earth'],
                'food'       => (float)$target['food'],
            ],
            'welfare'      => [
                'population'     => (int)$target['population'],
                'max_population' => (int)$target['max_population'],
                'happiness'      => (int)$target['happiness'],
                'public_services'=> (int)$target['public_services'],
                'energy'         => (int)$target['energy'],
            ],
            'planet'       => [
                'planet_class'       => $target['planet_class'],
                'in_habitable_zone'  => (bool)$target['in_habitable_zone'],
                'deposit_metal'      => $target['deposit_metal'],
                'deposit_crystal'    => $target['deposit_crystal'],
                'deposit_rare_earth' => $target['deposit_rare_earth'],
                'richness_metal'     => $target['richness_metal'],
                'richness_crystal'   => $target['richness_crystal'],
            ],
            'ships'        => $defShips,
            'leaders'      => $leaders,
        ];
    }

    $db->prepare('INSERT INTO spy_reports (owner_id, target_planet_id, report_json) VALUES (?,?,?)')
       ->execute([$fleet['user_id'], $target['id'] ?? null, json_encode($report)]);
    check_and_update_achievements($db, (int)$fleet['user_id']);

    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=? WHERE id=?')
       ->execute([$retTime, $retTime, $fleet['id']]);
}

/**
 * Harvest mission: mine resources from an uninhabited planet deposit.
 * Uses cargo capacity of the fleet; depletes planet deposits.
 */
function harvest_resources(PDO $db, array $fleet, array $ships): void {
    // Check the target is uninhabited
    $pRow = $db->prepare(
        'SELECT p.id, p.deposit_metal, p.deposit_crystal, p.deposit_deuterium, p.deposit_rare_earth,
                p.richness_metal, p.richness_crystal, p.richness_deuterium, p.richness_rare_earth
         FROM planets p
         WHERE p.galaxy=? AND p.system=? AND p.position=?'
    );
    $pRow->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $planet = $pRow->fetch();

    // If no planet yet, ensure it
    if (!$planet) {
        $pid    = ensure_planet($db, (int)$fleet['target_galaxy'],
                               (int)$fleet['target_system'], (int)$fleet['target_position']);
        $pRow->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
        $planet = $pRow->fetch();
    }

    if (!$planet) {
        $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
        $retTime = date('Y-m-d H:i:s', time() + $travel);
        $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=? WHERE id=?')
           ->execute([$retTime, $retTime, $fleet['id']]);
        return;
    }

    // Is it colonised?
    $colonised = $db->prepare('SELECT id FROM colonies WHERE planet_id=?');
    $colonised->execute([$planet['id']]);
    if ($colonised->fetch()) {
        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
           ->execute([$fleet['user_id'], 'Harvest Failed', 'Target planet is already colonised — use transport instead.']);
        $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
        $retTime = date('Y-m-d H:i:s', time() + $travel);
        $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=? WHERE id=?')
           ->execute([$retTime, $retTime, $fleet['id']]);
        return;
    }

    // Cargo capacity
    $cap = array_sum(array_map(fn($t,$c)=>ship_cargo($t)*$c, array_keys($ships), $ships));
    if ($cap <= 0) {
        $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
        $retTime = date('Y-m-d H:i:s', time() + $travel);
        $db->prepare('UPDATE fleets SET returning=1,arrival_time=?,return_time=? WHERE id=?')
           ->execute([$retTime, $retTime, $fleet['id']]);
        return;
    }

    // Harvest equal shares of each available resource, capped by deposit and cargo
    $resources = ['metal' => 'richness_metal', 'crystal' => 'richness_crystal',
                  'deuterium' => 'richness_deuterium', 'rare_earth' => 'richness_rare_earth'];
    $harvested = ['metal' => 0, 'crystal' => 0, 'deuterium' => 0, 'rare_earth' => 0];
    $remaining_cap = $cap;

    foreach ($resources as $res => $richKey) {
        $deposit  = (int)($planet['deposit_'.$res] ?? 0);
        if ($deposit === 0) continue; // depleted
        $maxHarvest = ($deposit === -1) ? $remaining_cap / 4 : min($deposit, $remaining_cap / 4);
        $amount   = min($remaining_cap, (int)round($maxHarvest * ($planet[$richKey] ?? 1.0)));
        $harvested[$res] = $amount;
        $remaining_cap  -= $amount;
    }

    // Deplete deposits
    $pid = $planet['id'];
    if ($harvested['metal']      > 0 && $planet['deposit_metal']      > 0)
        $db->prepare('UPDATE planets SET deposit_metal=GREATEST(0,deposit_metal-?) WHERE id=?')
           ->execute([$harvested['metal'], $pid]);
    if ($harvested['crystal']    > 0 && $planet['deposit_crystal']    > 0)
        $db->prepare('UPDATE planets SET deposit_crystal=GREATEST(0,deposit_crystal-?) WHERE id=?')
           ->execute([$harvested['crystal'], $pid]);
    if ($harvested['deuterium']  > 0 && (int)$planet['deposit_deuterium']  !== -1 && $planet['deposit_deuterium'] > 0)
        $db->prepare('UPDATE planets SET deposit_deuterium=GREATEST(0,deposit_deuterium-?) WHERE id=?')
           ->execute([$harvested['deuterium'], $pid]);
    if ($harvested['rare_earth'] > 0 && $planet['deposit_rare_earth'] > 0)
        $db->prepare('UPDATE planets SET deposit_rare_earth=GREATEST(0,deposit_rare_earth-?) WHERE id=?')
           ->execute([$harvested['rare_earth'], $pid]);

    $msg = "Harvest complete at [{$fleet['target_galaxy']}:{$fleet['target_system']}:{$fleet['target_position']}]: "
         . "{$harvested['metal']} metal, {$harvested['crystal']} crystal, "
         . "{$harvested['deuterium']} deuterium, {$harvested['rare_earth']} rare earth.";
    $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
       ->execute([$fleet['user_id'], 'Harvest Complete', $msg]);

    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare(
        'UPDATE fleets SET returning=1, arrival_time=?, return_time=?,
                           cargo_metal=?, cargo_crystal=?, cargo_deuterium=?
         WHERE id=?'
    )->execute([$retTime, $retTime, $harvested['metal'], $harvested['crystal'],
                $harvested['deuterium'], $fleet['id']]);
}
