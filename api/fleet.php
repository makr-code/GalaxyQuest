<?php
/**
 * Fleet API
 * GET  /api/fleet.php?action=list
 * POST /api/fleet.php?action=send   body: {origin_colony_id, target_galaxy, target_system, target_position, mission, ships:{type:count,...}, cargo:{metal,crystal,deuterium}}
 * POST /api/fleet.php?action=recall body: {fleet_id}
 * GET  /api/fleet.php?action=check  (process arrivals – called by client polling)
 * POST /api/fleet.php?action=simulate_battle body: {attacker_fleet_id, target_colony_id?, deterministic_seed?, iterations?}
 * POST /api/fleet.php?action=matchup_scan body: {attacker_fleet_id, target_colony_ids?, target_colony_id?, deterministic_seed?, iterations?}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/planet_helper.php';
require_once __DIR__ . '/projection.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/shipyard_queue.php';

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
                    f.stealth_until, f.hull_damage_pct,
                    cb.galaxy_index AS origin_galaxy, cb.system_index AS origin_system, cb.position AS origin_position
             FROM fleets f
             JOIN colonies c ON c.id = f.origin_colony_id
               JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE f.user_id = ? ORDER BY f.arrival_time ASC'
        );
        $stmt->execute([$uid]);
        $fleets = [];
        foreach ($stmt->fetchAll() as $f) {
            $f['ships']   = json_decode($f['ships_json'], true);
            unset($f['ships_json']);
            $f['current_pos'] = fleet_current_position($f);
            // Compute remaining stealth seconds for frontend
            $f['stealth_remaining_s'] = ($f['stealth_until'] && strtotime((string)$f['stealth_until']) > time())
                ? strtotime((string)$f['stealth_until']) - time()
                : 0;
            $fleets[] = $f;
        }
        json_ok(['fleets' => $fleets]);
        break;

    case 'send':
        only_method('POST');
        verify_csrf();
        send_fleet(get_db(), $uid, get_json_body());
        break;

    case 'wormholes':
        only_method('GET');
        list_wormholes(get_db(), $uid, (int)($_GET['origin_colony_id'] ?? 0));
        break;

    case 'ftl_status':
        only_method('GET');
        list_ftl_status(get_db(), $uid);
        break;

    case 'ftl_map':
        only_method('GET');
        list_ftl_map(get_db(), $uid);
        break;

    case 'reset_ftl_cooldown':
        // Spend 50 DM to immediately reset the Vor'Tak K-F recharge cooldown.
        only_method('POST');
        verify_csrf();
        reset_ftl_cooldown(get_db(), $uid);
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

    case 'simulate_battle':
        only_method('POST');
        verify_csrf();
        simulate_battle_preview(get_db(), $uid, get_json_body());
        break;

    case 'matchup_scan':
        only_method('POST');
        verify_csrf();
        matchup_scan(get_db(), $uid, get_json_body());
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
    $useWormhole = !empty($body['use_wormhole']);

    if (!in_array($mission, ['attack','transport','colonize','harvest','spy','survey'], true)) {
        json_error('Invalid mission type.');
    }
    if ($tg < 1 || $tg > GALAXY_MAX || $ts < 1 || $ts > galaxy_system_limit()
        || $tp < 1 || $tp > POSITION_MAX) {
        json_error('Target coordinates out of range.');
    }

    // Verify colony ownership and get coordinates
    $colStmt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium, c.user_id,
                 cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
            FROM colonies c
            JOIN celestial_bodies cb ON cb.id = c.body_id
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
            "SELECT u.pvp_mode, u.protection_until, u.control_type
             FROM colonies c
                         JOIN celestial_bodies cb ON cb.id = c.body_id
             JOIN users u ON u.id = c.user_id
                             WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?'
        );
        $tgtRow->execute([$tg, $ts, $tp]);
        $tgtUser = $tgtRow->fetch();
        if ($tgtUser && (string)($tgtUser['control_type'] ?? 'human') === 'human') {
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
    complete_ship_build_queue($db, $originCid);

    // Validate & collect ships
    $shipsToSend = [];
    foreach ($ships as $type => $count) {
        $count = (int)$count;
        if ($count <= 0 || !ship_exists_runtime($type, $db)) continue;
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

    // ── Vor'Tak Carrier bonus: +30% cargo capacity when carrier is in fleet ──
    $ftlTypeEarly = get_user_ftl_type($db, $uid);
    if ($ftlTypeEarly === 'vor_tak' && ($shipsToSend['carrier'] ?? 0) > 0) {
        $cap = (int)($cap * 1.3);
    }

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

    if ($useWormhole) {
        $wormhole = resolve_wormhole_route(
            $db,
            $uid,
            (int)$origin['galaxy'],
            (int)$origin['system'],
            $tg,
            $ts
        );
        if (!$wormhole) {
            json_error('No active wormhole route available for this jump.');
        }
        $travel = 30;
        $distLy = 0.0;
        $speedLyH = max($speedLyH, 999999.0);
        consume_wormhole_jump($db, (int)$wormhole['id']);
    }

    // ── Faction FTL mechanics ────────────────────────────────────────────────
    // Only apply when not already using a wormhole jump.
    $stealthUntil   = null; // Set by Vel'Ar for stealth window
    $hullDamagePct  = 0;    // Set by Kryl'Tha for hull degradation
    if (!$useWormhole) {
        $ftlType = get_user_ftl_type($db, $uid);

        switch ($ftlType) {

            // ── Vor'Tak: Kearny-Fuchida Jump Drive ───────────────────────────
            // Max 30 LY per jump, 72h recharge cooldown, instantaneous transit.
            case 'vor_tak':
                $cooldownRow = $db->prepare('SELECT ftl_cooldown_until FROM users WHERE id = ? LIMIT 1');
                $cooldownRow->execute([$uid]);
                $cooldownUntil = $cooldownRow->fetchColumn();
                if ($cooldownUntil && strtotime((string)$cooldownUntil) > time()) {
                    json_error('K-F Drive recharging. Ready at: ' . $cooldownUntil);
                }
                if ($distLy > 30.0 && $distLy > 0.0) {
                    json_error('K-F Drive range exceeded: max 30 LY per jump (distance: ' . round($distLy, 2) . ' LY).');
                }
                // Instantaneous jump: 30 s transit
                $travel   = 30;
                $speedLyH = 999999.0;
                $distLy   = max($distLy, 0.0);
                // Set 72h cooldown (scaled by GAME_SPEED so faster servers scale correctly)
                $cooldownSec = max(60, (int)(72 * 3600 / GAME_SPEED));
                $db->prepare('UPDATE users SET ftl_cooldown_until = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?')
                   ->execute([$cooldownSec, $uid]);
                break;

            // ── Syl'Nar: Resonance Gate Network ─────────────────────────────
            // Requires a pre-built gate between origin and target system.
            case 'syl_nar':
                $gate = resolve_syl_nar_gate(
                    $db, $uid,
                    (int)$origin['galaxy'], (int)$origin['system'],
                    $tg, $ts
                );
                if (!$gate) {
                    json_error("No active Syl'Nar gate on this route. Build one first (send a survey mission from origin to target system).");
                }
                $travel   = 10;
                $speedLyH = 999999.0;
                $distLy   = 0.0;
                break;

            // ── Vel'Ar: Blind Quantum Jump ───────────────────────────────────
            // Instantaneous but arrival coordinates scatter by 0.5% of distance.
            // OD-5: After scatter, snap to the nearest real star system (not just
            //        raw coordinate shift) for cleaner gameplay resolution.
            // Stealth window: fleet invisible to enemies for 60 s after arrival.
            case 'vel_ar':
                if ($distLy > 0.0) {
                    $scatter = $distLy * 0.005; // 0.5% of distance
                    // Apply random spherical scatter to target coordinates
                    $phi   = lcg_value() * 2.0 * M_PI;
                    $theta = acos(2.0 * lcg_value() - 1.0);
                    $tx   += $scatter * sin($theta) * cos($phi);
                    $ty   += $scatter * sin($theta) * sin($phi);
                    $tz   += $scatter * cos($theta);

                    // OD-5: snap to nearest star system within the same galaxy
                    $snapStmt = $db->prepare(
                        'SELECT galaxy_index, system_index, x_ly, y_ly, z_ly,
                                SQRT(POW(x_ly-?,2)+POW(y_ly-?,2)+POW(z_ly-?,2)) AS dist
                           FROM star_systems
                          WHERE galaxy_index = ?
                          ORDER BY dist ASC
                          LIMIT 1'
                    );
                    $snapStmt->execute([$tx, $ty, $tz, $tg]);
                    $snap = $snapStmt->fetch();
                    if ($snap) {
                        $tg = (int)$snap['galaxy_index'];
                        $ts = (int)$snap['system_index'];
                        $tx = (float)$snap['x_ly'];
                        $ty = (float)$snap['y_ly'];
                        $tz = (float)$snap['z_ly'];
                        // Recompute target_position (planet 1 by default on scatter)
                        $tp = 1;
                    }
                }
                $travel     = 30;
                $speedLyH   = 999999.0;
                $distLy     = 0.0;
                // Stealth: 60 s window starting at arrival (arrival = now + $travel)
                // $stealthUntil is finalized after $arrival is computed below.
                $stealthUntil = '__vel_ar__'; // placeholder; resolved after $arrival is set
                break;

            // ── Zhareen: Crystal Resonance Channel ───────────────────────────
            // Requires a charted resonance node at the target system.
            case 'zhareen':
                $node = get_zhareen_node($db, $uid, $tg, $ts);
                if (!$node) {
                    json_error('No resonance node charted at target system. Send a survey mission first.');
                }
                if ($node['cooldown_until'] && strtotime((string)$node['cooldown_until']) > time()) {
                    json_error('Resonance node cooling down. Ready at: ' . $node['cooldown_until']);
                }
                $travel   = 60;
                $speedLyH = 999999.0;
                $distLy   = 0.0;
                // Apply 30-min node cooldown
                $db->prepare('UPDATE ftl_resonance_nodes SET cooldown_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE id = ?')
                   ->execute([$node['id']]);
                break;

            // ── Aereth: Alcubierre Warp ───────────────────────────────────────
            // Density-dependent speed bonus: +50% in core galaxies, -30% in rim.
            case 'aereth':
            default:
                if ($distLy > 0.0) {
                    $originGalaxy = (int)$origin['galaxy'];
                    if ($originGalaxy <= 3) {
                        // Galactic core: dense plasma → speed bonus
                        $speedLyH *= 1.5;
                    } elseif ($originGalaxy >= 7) {
                        // Galactic rim: sparse medium → speed penalty
                        $speedLyH *= 0.7;
                    }
                    $travel = fleet_travel_time_3d($distLy, $speedLyH);
                }
                break;

            // ── Kryl'Tha: Swarm Tunnel ────────────────────────────────────────
            // Travel time scales with fleet size; hard cap at 50 ships per jump.
            // Hull takes 10% damage after every swarm-tunnel jump.
            case 'kryl_tha':
                $totalShips = array_sum($shipsToSend);
                if ($totalShips > 50) {
                    json_error('Swarm Tunnel overloaded: maximum 50 ships per FTL jump (sent: ' . $totalShips . ').');
                }
                // sizeFactor: 1.0 at 1 ship → 1.5 at 50 ships
                $sizeFactor    = 1.0 + ($totalShips - 1) / 100.0;
                $travel        = max(30, (int)round($travel * $sizeFactor));
                $hullDamagePct = 10; // 10% hull degradation per jump
                break;
        }
    }
    // ── end Faction FTL mechanics ────────────────────────────────────────────
    // ── end 3-D ────────────────────────────────────────────────────────────

    $now        = time();
    $arrival    = date('Y-m-d H:i:s', $now + $travel);
    $returnT    = date('Y-m-d H:i:s', $now + $travel * 2);
    $departure  = date('Y-m-d H:i:s', $now);

    // Resolve Vel'Ar stealth: starts at arrival, lasts 60 s
    if ($stealthUntil === '__vel_ar__') {
        $stealthUntil = date('Y-m-d H:i:s', $now + $travel + 60);
    }

    foreach ($shipsToSend as $type => $cnt) {
        $db->prepare('UPDATE ships SET count=count-? WHERE colony_id=? AND type=?')
           ->execute([$cnt, $originCid, $type]);
    }
    $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?')
       ->execute([$cMetal, $cCrys, $cDeut, $originCid]);

    $originPolar = galactic_polar_from_cartesian($ox, $oy, $oz);
    $targetPolar = galactic_polar_from_cartesian($tx, $ty, $tz);

    $db->prepare(
        'INSERT INTO fleets (user_id, origin_colony_id, target_galaxy, target_system,
                             target_position, mission, ships_json,
                             cargo_metal, cargo_crystal, cargo_deuterium,
                             origin_x_ly, origin_y_ly, origin_z_ly,
                             origin_radius_ly, origin_theta_rad, origin_height_ly,
                             target_x_ly, target_y_ly, target_z_ly,
                             target_radius_ly, target_theta_rad, target_height_ly,
                             speed_ly_h, distance_ly,
                             departure_time, arrival_time, return_time,
                             stealth_until, hull_damage_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$uid, $originCid, $tg, $ts, $tp, $mission,
                json_encode($shipsToSend), $cMetal, $cCrys, $cDeut,
                $ox, $oy, $oz,
                $originPolar['radius_ly'], $originPolar['theta_rad'], $originPolar['height_ly'],
                $tx, $ty, $tz,
                $targetPolar['radius_ly'], $targetPolar['theta_rad'], $targetPolar['height_ly'],
                $speedLyH, $distLy,
                $departure, $arrival, $returnT,
                $stealthUntil, $hullDamagePct]);

    enqueue_dirty_user($db, $uid, 'fleet_sent');
    json_ok(['fleet_id' => (int)$db->lastInsertId(), 'arrival_time' => $arrival]);
}

function list_wormholes(PDO $db, int $uid, int $originColonyId): never {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS wormholes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            endpoint_a_galaxy INT NOT NULL,
            endpoint_a_system INT NOT NULL,
            endpoint_b_galaxy INT NOT NULL,
            endpoint_b_system INT NOT NULL,
            stability INT NOT NULL DEFAULT 100,
            cooldown_until DATETIME DEFAULT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            is_permanent TINYINT(1) NOT NULL DEFAULT 0,
            label VARCHAR(80) DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_wormholes_a (endpoint_a_galaxy, endpoint_a_system),
            INDEX idx_wormholes_b (endpoint_b_galaxy, endpoint_b_system)
        ) ENGINE=InnoDB'
    );
    try {
        $colCheck = $db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'wormholes'
               AND COLUMN_NAME = 'is_permanent'"
        );
        $hasPermanentCol = (int)($colCheck ? $colCheck->fetchColumn() : 0) > 0;
        if (!$hasPermanentCol) {
            $db->exec('ALTER TABLE wormholes ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
        }
    } catch (Throwable $e) {
        // ignore on restricted/legacy setups; query path will still work on modern MySQL
    }

    $db->exec(
        'CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
            user_id INT NOT NULL PRIMARY KEY,
            source_quest_code VARCHAR(64) DEFAULT NULL,
            unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB'
    );

    $origin = null;
    if ($originColonyId > 0) {
        $originStmt = $db->prepare(
              'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`
             FROM colonies c
               JOIN celestial_bodies cb ON cb.id = c.body_id
             WHERE c.id = ? AND c.user_id = ?'
        );
        $originStmt->execute([$originColonyId, $uid]);
        $origin = $originStmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    $theoryStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "wormhole_theory" LIMIT 1');
    $theoryStmt->execute([$uid]);
    $theoryLevel = (int)($theoryStmt->fetchColumn() ?: 0);

    $unlockStmt = $db->prepare('SELECT 1 FROM user_wormhole_unlocks WHERE user_id = ? LIMIT 1');
    $unlockStmt->execute([$uid]);
    $hasPermanentUnlock = (bool)$unlockStmt->fetchColumn();

    $stmt = $db->query(
        'SELECT id, endpoint_a_galaxy, endpoint_a_system,
                endpoint_b_galaxy, endpoint_b_system,
                stability, cooldown_until, is_active, is_permanent, label
         FROM wormholes
         WHERE is_active = 1
         ORDER BY id ASC
         LIMIT 200'
    );
    $wormholes = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $isPermanent = (int)($row['is_permanent'] ?? 0) === 1;
        $unlockOk = !$isPermanent || $hasPermanentUnlock;
        $available = ((int)$row['stability'] >= 10)
            && (!$row['cooldown_until'] || strtotime((string)$row['cooldown_until']) <= time())
            && ($theoryLevel >= 5)
            && $unlockOk;

        if ($origin) {
            $matchesOrigin = (
                ((int)$row['endpoint_a_galaxy'] === (int)$origin['galaxy'] && (int)$row['endpoint_a_system'] === (int)$origin['system'])
                || ((int)$row['endpoint_b_galaxy'] === (int)$origin['galaxy'] && (int)$row['endpoint_b_system'] === (int)$origin['system'])
            );
            if (!$matchesOrigin) {
                continue;
            }
        }

        $wormholes[] = [
            'id' => (int)$row['id'],
            'a' => ['galaxy' => (int)$row['endpoint_a_galaxy'], 'system' => (int)$row['endpoint_a_system']],
            'b' => ['galaxy' => (int)$row['endpoint_b_galaxy'], 'system' => (int)$row['endpoint_b_system']],
            'stability' => (int)$row['stability'],
            'cooldown_until' => $row['cooldown_until'],
            'label' => $row['label'],
            'is_permanent' => $isPermanent,
            'requires_unlock' => $isPermanent,
            'unlocked' => !$isPermanent || $hasPermanentUnlock,
            'available' => $available,
        ];
    }

    json_ok([
        'wormholes' => $wormholes,
        'wormhole_theory_level' => $theoryLevel,
        'permanent_unlock' => $hasPermanentUnlock,
        'can_jump' => $theoryLevel >= 5,
    ]);
}

function list_ftl_status(PDO $db, int $uid): never {
    $ftlType = get_user_ftl_type($db, $uid);

    // Vor'Tak cooldown
    $cooldownRow = $db->prepare('SELECT ftl_cooldown_until FROM users WHERE id = ? LIMIT 1');
    $cooldownRow->execute([$uid]);
    $cooldownUntil = $cooldownRow->fetchColumn() ?: null;
    $cooldownRemaining = 0;
    if ($cooldownUntil && strtotime((string)$cooldownUntil) > time()) {
        $cooldownRemaining = strtotime((string)$cooldownUntil) - time();
    }

    // Syl'Nar gates
    $gates = [];
    try {
        $gateStmt = $db->prepare(
            'SELECT id, galaxy_a, system_a, galaxy_b, system_b, is_active, health, created_at
               FROM ftl_gates WHERE owner_user_id = ? ORDER BY created_at DESC'
        );
        $gateStmt->execute([$uid]);
        $gates = $gateStmt->fetchAll();
    } catch (\Throwable) { /* table not yet migrated */ }

    // Zhareen resonance nodes
    $nodes = [];
    try {
        $nodeStmt = $db->prepare(
            'SELECT id, galaxy, `system`, discovered_at, cooldown_until
               FROM ftl_resonance_nodes WHERE owner_user_id = ? ORDER BY discovered_at DESC'
        );
        $nodeStmt->execute([$uid]);
        $rawNodes = $nodeStmt->fetchAll();
        foreach ($rawNodes as $n) {
            $nodeCooldownRem = 0;
            if ($n['cooldown_until'] && strtotime($n['cooldown_until']) > time()) {
                $nodeCooldownRem = strtotime($n['cooldown_until']) - time();
            }
            $nodes[] = array_merge($n, ['cooldown_remaining_s' => $nodeCooldownRem]);
        }
    } catch (\Throwable) { /* table not yet migrated */ }

    json_ok([
        'ftl_drive_type'        => $ftlType,
        'ftl_cooldown_until'    => $cooldownUntil,
        'ftl_cooldown_remaining_s' => $cooldownRemaining,
        'ftl_ready'             => $cooldownRemaining === 0,
        'gates'                 => $gates,
        'resonance_nodes'       => $nodes,
    ]);
}

/**
 * Reset Vor'Tak FTL cooldown immediately by spending 50 Dark Matter.
 * Safe for all drive types: non-Vor'Tak users just get an error.
 */
function reset_ftl_cooldown(PDO $db, int $uid): never {
    $COOLDOWN_RESET_COST = 50;

    $uRow = $db->prepare('SELECT ftl_drive_type, ftl_cooldown_until, dark_matter FROM users WHERE id = ? LIMIT 1');
    $uRow->execute([$uid]);
    $u = $uRow->fetch();
    if (!$u) { json_error('User not found.'); }

    if ($u['ftl_drive_type'] !== 'vor_tak') {
        json_error('FTL cooldown reset is only available for Vor\'Tak K-F drives.');
    }
    if (!$u['ftl_cooldown_until'] || strtotime((string)$u['ftl_cooldown_until']) <= time()) {
        json_error('FTL drive is not on cooldown.');
    }
    if ((int)$u['dark_matter'] < FTL_COOLDOWN_RESET_COST) {
        json_error('Insufficient Dark Matter. Cost: ' . FTL_COOLDOWN_RESET_COST . ' DM, you have: ' . $u['dark_matter'] . ' DM.');
    }

    $db->prepare('UPDATE users SET ftl_cooldown_until = NULL, dark_matter = dark_matter - ? WHERE id = ?')
       ->execute([FTL_COOLDOWN_RESET_COST, $uid]);

    json_ok([
        'message'  => 'FTL cooldown reset. Drive ready to jump.',
        'dm_spent' => FTL_COOLDOWN_RESET_COST,
    ]);
}

/**
 * Returns all FTL infrastructure visible to this player:
 *  - Their own gates with 3-D endpoint coordinates
 *  - Their own resonance nodes with 3-D coordinates
 * Used by the galaxy-window overlay to render FTL infrastructure markers.
 */
function list_ftl_map(PDO $db, int $uid): never {
    $gates = [];
    try {
        $gateStmt = $db->prepare(
            'SELECT id, galaxy_a, system_a, galaxy_b, system_b, is_active, health
               FROM ftl_gates WHERE owner_user_id = ? AND is_active = 1 AND health > 0'
        );
        $gateStmt->execute([$uid]);
        foreach ($gateStmt->fetchAll() as $g) {
            [$ax, $ay, $az] = get_system_3d_coords($db, (int)$g['galaxy_a'], (int)$g['system_a']);
            [$bx, $by, $bz] = get_system_3d_coords($db, (int)$g['galaxy_b'], (int)$g['system_b']);
            $gates[] = [
                'id'       => (int)$g['id'],
                'galaxy_a' => (int)$g['galaxy_a'], 'system_a' => (int)$g['system_a'],
                'galaxy_b' => (int)$g['galaxy_b'], 'system_b' => (int)$g['system_b'],
                'health'   => (int)$g['health'],
                'a'        => ['x' => $ax, 'y' => $ay, 'z' => $az],
                'b'        => ['x' => $bx, 'y' => $by, 'z' => $bz],
            ];
        }
    } catch (\Throwable) { /* table not yet migrated */ }

    $nodes = [];
    try {
        $nodeStmt = $db->prepare(
            'SELECT id, galaxy, `system`, cooldown_until
               FROM ftl_resonance_nodes WHERE owner_user_id = ?'
        );
        $nodeStmt->execute([$uid]);
        foreach ($nodeStmt->fetchAll() as $n) {
            [$nx, $ny, $nz] = get_system_3d_coords($db, (int)$n['galaxy'], (int)$n['system']);
            $cooldownRem = ($n['cooldown_until'] && strtotime((string)$n['cooldown_until']) > time())
                ? strtotime((string)$n['cooldown_until']) - time()
                : 0;
            $nodes[] = [
                'id'               => (int)$n['id'],
                'galaxy'           => (int)$n['galaxy'],
                'system'           => (int)$n['system'],
                'cooldown_until'   => $n['cooldown_until'],
                'cooldown_remaining_s' => $cooldownRem,
                'pos'              => ['x' => $nx, 'y' => $ny, 'z' => $nz],
            ];
        }
    } catch (\Throwable) { /* table not yet migrated */ }

    json_ok(['gates' => $gates, 'resonance_nodes' => $nodes]);
}

function resolve_wormhole_route(PDO $db, int $uid, int $originGalaxy, int $originSystem, int $targetGalaxy, int $targetSystem): ?array {
    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS wormholes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                endpoint_a_galaxy INT NOT NULL,
                endpoint_a_system INT NOT NULL,
                endpoint_b_galaxy INT NOT NULL,
                endpoint_b_system INT NOT NULL,
                stability INT NOT NULL DEFAULT 100,
                cooldown_until DATETIME DEFAULT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                is_permanent TINYINT(1) NOT NULL DEFAULT 0,
                label VARCHAR(80) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_wormholes_a (endpoint_a_galaxy, endpoint_a_system),
                INDEX idx_wormholes_b (endpoint_b_galaxy, endpoint_b_system)
            ) ENGINE=InnoDB'
        );
        $colCheck = $db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'wormholes'
               AND COLUMN_NAME = 'is_permanent'"
        );
        $hasPermanentCol = (int)($colCheck ? $colCheck->fetchColumn() : 0) > 0;
        if (!$hasPermanentCol) {
            $db->exec('ALTER TABLE wormholes ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
        }
        $db->exec(
            'CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
                user_id INT NOT NULL PRIMARY KEY,
                source_quest_code VARCHAR(64) DEFAULT NULL,
                unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB'
        );
    } catch (Throwable $e) {
        return null;
    }

    $theoryStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "wormhole_theory" LIMIT 1');
    $theoryStmt->execute([$uid]);
    $theoryLevel = (int)($theoryStmt->fetchColumn() ?: 0);
    if ($theoryLevel < 5) {
        return null;
    }

    $unlockStmt = $db->prepare('SELECT 1 FROM user_wormhole_unlocks WHERE user_id = ? LIMIT 1');
    $unlockStmt->execute([$uid]);
    $hasPermanentUnlock = (bool)$unlockStmt->fetchColumn();

    $stmt = $db->prepare(
        'SELECT *
         FROM wormholes
                 WHERE is_active = 1
           AND stability >= 10
           AND (cooldown_until IS NULL OR cooldown_until <= NOW())
                     AND (is_permanent = 0 OR ? = 1)
           AND (
                (endpoint_a_galaxy = ? AND endpoint_a_system = ? AND endpoint_b_galaxy = ? AND endpoint_b_system = ?)
             OR (endpoint_b_galaxy = ? AND endpoint_b_system = ? AND endpoint_a_galaxy = ? AND endpoint_a_system = ?)
           )
         ORDER BY stability DESC, id ASC
         LIMIT 1'
    );
    $stmt->execute([
        $hasPermanentUnlock ? 1 : 0,
        $originGalaxy, $originSystem, $targetGalaxy, $targetSystem,
        $originGalaxy, $originSystem, $targetGalaxy, $targetSystem,
    ]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function consume_wormhole_jump(PDO $db, int $wormholeId): void {
    $db->prepare(
        'UPDATE wormholes
         SET stability = GREATEST(0, stability - 5),
             cooldown_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)
         WHERE id = ?'
    )->execute([$wormholeId]);
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

    $userId  = (int)$fleet['user_id'];
    $tg      = (int)$fleet['target_galaxy'];
    $ts      = (int)$fleet['target_system'];
    // Estimate return time (same travel duration) for active-visibility window
    $travelSec = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $retTime   = date('Y-m-d H:i:s', time() + $travelSec);

    match ($fleet['mission']) {
        'transport' => deliver_resources($db, $fleet, $ships),
        'attack'    => resolve_battle($db, $fleet, $ships),
        'colonize'  => colonize_planet($db, $fleet, $ships),
        'spy'       => create_spy_report($db, $fleet, $ships),
        'harvest'   => harvest_resources($db, $fleet, $ships),
        'survey'    => complete_survey_mission($db, $fleet, $ships),
        default     => return_fleet_to_origin($db, $fleet, $ships),
    };

    // FoW: record/extend active visibility for the target system.
    // The ON DUPLICATE KEY logic in touch_system_visibility preserves 'own' if already set.
    touch_system_visibility($db, $userId, $tg, $ts, 'active', $retTime, null);
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
    enqueue_dirty_user($db, (int)$fleet['user_id'], 'fleet_returned');
}

function deliver_resources(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare('SELECT c.id, c.user_id FROM colonies c JOIN celestial_bodies cb ON cb.id=c.body_id WHERE cb.galaxy_index=? AND cb.system_index=? AND cb.position=?');
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();
    if ($target) {
        $db->prepare('UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+? WHERE id=?')
           ->execute([$fleet['cargo_metal'], $fleet['cargo_crystal'], $fleet['cargo_deuterium'], $target['id']]);
        // Mark the receiving user dirty (different user for inter-player transports)
        if ((int)$target['user_id'] !== (int)$fleet['user_id']) {
            enqueue_dirty_user($db, (int)$target['user_id'], 'resources_received');
        }
    }
    $travel  = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=?, cargo_metal=0, cargo_crystal=0, cargo_deuterium=0 WHERE id=?')
       ->execute([$retTime, $retTime, $fleet['id']]);
    enqueue_dirty_user($db, (int)$fleet['user_id'], 'fleet_delivered');
}

function resolve_battle(PDO $db, array $fleet, array $ships): void {
    $tgt = $db->prepare(
        'SELECT c.id, c.body_id, c.user_id, c.metal, c.crystal, c.deuterium, c.rare_earth
         FROM colonies c JOIN celestial_bodies cb ON cb.id=c.body_id
            WHERE cb.galaxy_index=? AND cb.system_index=? AND cb.position=?'
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

    // Kryl'Tha hull damage penalty: directly reduces the attacker's attack multiplier
    $hullMalus = max(0, min(100, (int)($fleet['hull_damage_pct'] ?? 0)));
    if ($hullMalus > 0) {
        $atkMulti *= (1.0 - $hullMalus / 100.0);
    }
    $atkProfile = compute_energy_combat_profile($ships, $db);
    $atkEnergy = $atkProfile['attack_energy'] * $atkMulti;
    $atkKinetic = $atkProfile['attack_kinetic'] * $atkMulti;
    $atkAtk = $atkEnergy + $atkKinetic;
    $atkHull = $atkProfile['hull'];
    $atkShield = $atkProfile['shield'] * (1.0 + $atkShldLevel * 0.1);
    
    // Apply attacker's colony-type military bonus (+10% attack, +5% shield)
    $atkColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $atkColonyStmt->execute([(int)$fleet['origin_colony_id']]);
    $atkCol = $atkColonyStmt->fetch();
    if ($atkCol && $atkCol['colony_type'] === 'military') {
        $atkEnergy *= 1.1;
        $atkKinetic *= 1.1;
        $atkAtk = $atkEnergy + $atkKinetic;
        $atkShield *= 1.05;
    }

    // ── Defender stats — weapons + shielding tech ──────────────────────────
    $defWpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $defWpnRow->execute([$target['user_id']]);
    $defWpnLevel  = (int)($defWpnRow->fetchColumn()  ?? 0);

    $defShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $defShldRow->execute([$target['user_id']]);
    $defShldLevel = (int)($defShldRow->fetchColumn() ?? 0);

    complete_ship_build_queue($db, (int)$target['id']);
    $defShips = $db->prepare('SELECT type, count FROM ships WHERE colony_id=?');
    $defShips->execute([$target['id']]);
    $defFleet = [];
    foreach ($defShips->fetchAll() as $r) {
        $defFleet[$r['type']] = (int)$r['count'];
    }
    $defProfile = compute_energy_combat_profile($defFleet, $db);
    $defEnergy = $defProfile['attack_energy'] * (1.0 + $defWpnLevel * 0.1);
    $defKinetic = $defProfile['attack_kinetic'] * (1.0 + $defWpnLevel * 0.1);
    $defAtk = $defEnergy + $defKinetic;
    $defHull = $defProfile['hull'];
    $defShield = $defProfile['shield'] * (1.0 + $defShldLevel * 0.1);
    
    // Apply defender's colony-type military bonus (+10% attack, +5% shield)
    $defColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $defColonyStmt->execute([(int)$target['id']]);
    $defCol = $defColonyStmt->fetch();
    if ($defCol && $defCol['colony_type'] === 'military') {
        $defEnergy *= 1.1;
        $defKinetic *= 1.1;
        $defAtk = $defEnergy + $defKinetic;
        $defShield *= 1.05;
    }

    $combatMods = load_combat_modifier_totals($db, (int)$fleet['user_id'], (int)$target['user_id']);

    $atkDamageAll = combat_modifier_scalar($combatMods['attacker'], 'combat.damage.all');
    $defDamageAll = combat_modifier_scalar($combatMods['defender'], 'combat.damage.all');
    $atkEnergy = max(0.0, $atkEnergy * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.energy'));
    $atkKinetic = max(0.0, $atkKinetic * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.kinetic'));
    $defEnergy = max(0.0, $defEnergy * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.energy'));
    $defKinetic = max(0.0, $defKinetic * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.kinetic'));
    $atkAtk = $atkEnergy + $atkKinetic;
    $defAtk = $defEnergy + $defKinetic;
    $atkShield = max(0.0, $atkShield * combat_modifier_scalar($combatMods['attacker'], 'combat.shield.capacity'));
    $defShield = max(0.0, $defShield * combat_modifier_scalar($combatMods['defender'], 'combat.shield.capacity'));
    $atkHull   = max(0.0, $atkHull * combat_modifier_scalar($combatMods['attacker'], 'combat.hull.integrity'));
    $defHull   = max(0.0, $defHull * combat_modifier_scalar($combatMods['defender'], 'combat.hull.integrity'));

    $atkBudget = compute_energy_budget($atkProfile, $combatMods['attacker']);
    $defBudget = compute_energy_budget($defProfile, $combatMods['defender']);

    // ── Combat resolution ──────────────────────────────────────────────────
    $battleSeed = hash('sha256', implode('|', [
        'battle',
        (int)$fleet['id'],
        (int)$fleet['user_id'],
        (int)$target['user_id'],
        (int)$fleet['target_galaxy'],
        (int)$fleet['target_system'],
        (int)$fleet['target_position'],
    ]));

    $atkDiceMult = 0.9 + battle_rng_float($battleSeed, 'atk_dmg') * 0.2;
    $defDiceMult = 0.9 + battle_rng_float($battleSeed, 'def_dmg') * 0.2;

    $outcome = battle_preview_outcome(
        $atkAtk,
        $defAtk,
        $atkShield,
        $defShield,
        $atkHull,
        $defHull,
        $battleSeed,
        [
            'atk_energy' => $atkEnergy,
            'atk_kinetic' => $atkKinetic,
            'def_energy' => $defEnergy,
            'def_kinetic' => $defKinetic,
            'atk_weapon_factor' => $atkBudget['weapon_factor'],
            'def_weapon_factor' => $defBudget['weapon_factor'],
            'atk_shield_factor' => $atkBudget['shield_factor'],
            'def_shield_factor' => $defBudget['shield_factor'],
        ]
    );

    $atkDiceMult = (float)$outcome['atk_dice_mult'];
    $defDiceMult = (float)$outcome['def_dice_mult'];
    $atkEffectiveDmg = (float)$outcome['atk_effective_dmg'];
    $defEffectiveDmg = (float)$outcome['def_effective_dmg'];

    $diceVarianceIndex = (float)round((abs($atkDiceMult - 1.0) + abs($defDiceMult - 1.0)) / 2.0, 4);

    $attackerPowerRating = (int)round($atkAtk + $atkShield * 0.2 + $atkHull * 0.1);
    $defenderPowerRating = (int)round($defAtk + $defShield * 0.2 + $defHull * 0.1);

    $attackerWins = (bool)$outcome['attacker_wins'];

    // ── Losses ────────────────────────────────────────────────────────────
    $atkLossFraction = (float)$outcome['atk_loss_fraction'];
    $defLossFraction = (float)$outcome['def_loss_fraction'];
    $battleRounds = build_battle_rounds_summary(
        $atkAtk,
        $defAtk,
        $atkShield,
        $defShield,
        $atkHull,
        $defHull,
        $atkDiceMult,
        $defDiceMult,
        $attackerWins,
        $atkLossFraction,
        $defLossFraction
    );

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
        'version'           => 1,
        'seed'              => $battleSeed,
        'dice_variance_index' => $diceVarianceIndex,
        'power_rating'      => ['attacker' => $attackerPowerRating, 'defender' => $defenderPowerRating],
        'energy_context'    => [
            'attacker' => $atkBudget,
            'defender' => $defBudget,
        ],
        'damage_channels'   => [
            'attacker' => ['energy' => (float)round($atkEnergy, 2), 'kinetic' => (float)round($atkKinetic, 2)],
            'defender' => ['energy' => (float)round($defEnergy, 2), 'kinetic' => (float)round($defKinetic, 2)],
        ],
        'combat_modifiers'  => $combatMods,
        'modifier_breakdown'=> build_battle_modifier_breakdown($combatMods),
        'rounds'            => $battleRounds,
        'attacker_ships'    => $ships,
        'attacker_survivors'=> $atkSurvivors,
        'attacker_lost'     => $atkLostShips,
        'defender_ships'    => $defFleet,
        'defender_lost'     => $defLostShips,
        'attacker_wins'     => $attackerWins,
        'loot'              => ['metal'=>$lootM,'crystal'=>$lootC,'deuterium'=>$lootD,'rare_earth'=>$lootRE],
        'tech'              => ['atk_wpn'=>$atkWpnLevel,'atk_shld'=>$atkShldLevel,
                                'def_wpn'=>$defWpnLevel,'def_shld'=>$defShldLevel],
        'explainability'    => [
            'top_factors' => [
                ['factor' => 'attack_power_delta', 'impact_pct' => (float)round(compute_relative_impact($attackerPowerRating, $defenderPowerRating), 2)],
                ['factor' => 'shield_pressure', 'impact_pct' => (float)round(compute_relative_impact($atkShield, $defShield), 2)],
                ['factor' => 'dice_variance', 'impact_pct' => (float)round($diceVarianceIndex * 100.0, 2)],
            ],
        ],
    ];

    $reportJson = json_encode($report);
    if (battle_reports_has_combat_meta_columns($db)) {
        $db->prepare(
            'INSERT INTO battle_reports
                (attacker_id, defender_id, body_id, report_json, battle_seed, report_version,
                 attacker_power_rating, defender_power_rating, dice_variance_index, explainability_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $fleet['user_id'],
            $target['user_id'],
            $target['body_id'],
            $reportJson,
            $battleSeed,
            1,
            $attackerPowerRating,
            $defenderPowerRating,
            $diceVarianceIndex,
            json_encode($report['explainability']),
        ]);
    } else {
         $db->prepare('INSERT INTO battle_reports (attacker_id,defender_id,body_id,report_json)
                      VALUES (?,?,?,?)')
            ->execute([$fleet['user_id'], $target['user_id'], $target['body_id'], $reportJson]);
    }
    check_and_update_achievements($db, (int)$fleet['user_id']);

    // ── Diplomacy impact: attacking a faction NPC degrades standing ────────
    $defNpc = $db->prepare("SELECT control_type FROM users WHERE id=?");
    $defNpc->execute([$target['user_id']]);
    $defUser = $defNpc->fetch();
    if ($defUser && (string)($defUser['control_type'] ?? 'human') === 'npc_engine') {
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
    enqueue_dirty_user($db, (int)$fleet['user_id'], 'battle_resolved');
    enqueue_dirty_user($db, (int)$target['user_id'], 'colony_attacked');
    // Phase 2: invalidate system snapshot for the battle target system.
    enqueue_dirty_system($db, (int)$fleet['target_galaxy'], (int)$fleet['target_system'], 'battle_resolved');
}

function simulate_battle_preview(PDO $db, int $uid, array $body): never {
    $attackerFleetId = (int)($body['attacker_fleet_id'] ?? 0);
    $targetColonyId  = (int)($body['target_colony_id'] ?? 0);
    $iterations       = max(1, min(2000, (int)($body['iterations'] ?? 1)));
    $deterministicSeed = trim((string)($body['deterministic_seed'] ?? ''));
    if ($deterministicSeed !== '') {
        $deterministicSeed = preg_replace('/[^a-zA-Z0-9_\-]/', '', $deterministicSeed) ?? '';
        $deterministicSeed = substr($deterministicSeed, 0, 64);
    }

    if ($attackerFleetId <= 0) {
        json_error('attacker_fleet_id is required.');
    }

    $fleetStmt = $db->prepare('SELECT * FROM fleets WHERE id = ? AND user_id = ? LIMIT 1');
    $fleetStmt->execute([$attackerFleetId, $uid]);
    $fleet = $fleetStmt->fetch();
    if (!$fleet) {
        json_error('Attacker fleet not found.', 404);
    }

    $ships = json_decode((string)($fleet['ships_json'] ?? '{}'), true) ?: [];
    if (empty($ships)) {
        json_error('Attacker fleet has no ships.');
    }

    if ($targetColonyId > 0) {
        $targetStmt = $db->prepare('SELECT id, user_id, metal, crystal, deuterium, rare_earth FROM colonies WHERE id = ? LIMIT 1');
        $targetStmt->execute([$targetColonyId]);
    } else {
        $targetStmt = $db->prepare(
            'SELECT c.id, c.user_id, c.metal, c.crystal, c.deuterium, c.rare_earth
               FROM colonies c JOIN celestial_bodies cb ON cb.id=c.body_id
               WHERE cb.galaxy_index=? AND cb.system_index=? AND cb.position=?
             LIMIT 1'
        );
        $targetStmt->execute([(int)$fleet['target_galaxy'], (int)$fleet['target_system'], (int)$fleet['target_position']]);
    }
    $target = $targetStmt->fetch();

    if (!$target) {
        json_error('Target colony not found.', 404);
    }
    if ((int)$target['user_id'] === (int)$fleet['user_id']) {
        json_error('Cannot simulate combat against own colony.');
    }

    $wpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $wpnRow->execute([$fleet['user_id']]);
    $atkWpnLevel = (int)($wpnRow->fetchColumn() ?? 0);

    $atkShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $atkShldRow->execute([$fleet['user_id']]);
    $atkShldLevel = (int)($atkShldRow->fetchColumn() ?? 0);

    $cmdRow = $db->prepare('SELECT skill_attack FROM leaders WHERE fleet_id=? AND role=\'fleet_commander\' LIMIT 1');
    $cmdRow->execute([$fleet['id']]);
    $cmd = $cmdRow->fetch();
    $cmdBonus = $cmd ? (1.0 + (int)$cmd['skill_attack'] * 0.02) : 1.0;

    $atkMulti = (1.0 + $atkWpnLevel * 0.1) * $cmdBonus;
    $atkProfile = compute_energy_combat_profile($ships, $db);
    $atkEnergy = $atkProfile['attack_energy'] * $atkMulti;
    $atkKinetic = $atkProfile['attack_kinetic'] * $atkMulti;
    $atkAtk = $atkEnergy + $atkKinetic;
    $atkHull = $atkProfile['hull'];
    $atkShield = $atkProfile['shield'] * (1.0 + $atkShldLevel * 0.1);

    $atkColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $atkColonyStmt->execute([(int)$fleet['origin_colony_id']]);
    $atkCol = $atkColonyStmt->fetch();
    if ($atkCol && $atkCol['colony_type'] === 'military') {
        $atkEnergy *= 1.1;
        $atkKinetic *= 1.1;
        $atkAtk = $atkEnergy + $atkKinetic;
        $atkShield *= 1.05;
    }

    $defWpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $defWpnRow->execute([$target['user_id']]);
    $defWpnLevel = (int)($defWpnRow->fetchColumn() ?? 0);

    $defShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $defShldRow->execute([$target['user_id']]);
    $defShldLevel = (int)($defShldRow->fetchColumn() ?? 0);

    complete_ship_build_queue($db, (int)$target['id']);
    $defShipsStmt = $db->prepare('SELECT type, count FROM ships WHERE colony_id=?');
    $defShipsStmt->execute([$target['id']]);
    $defFleet = [];
    foreach ($defShipsStmt->fetchAll() as $r) {
        $defFleet[$r['type']] = (int)$r['count'];
    }
    $defProfile = compute_energy_combat_profile($defFleet, $db);
    $defEnergy = $defProfile['attack_energy'] * (1.0 + $defWpnLevel * 0.1);
    $defKinetic = $defProfile['attack_kinetic'] * (1.0 + $defWpnLevel * 0.1);
    $defAtk = $defEnergy + $defKinetic;
    $defHull = $defProfile['hull'];
    $defShield = $defProfile['shield'] * (1.0 + $defShldLevel * 0.1);

    $defColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $defColonyStmt->execute([(int)$target['id']]);
    $defCol = $defColonyStmt->fetch();
    if ($defCol && $defCol['colony_type'] === 'military') {
        $defEnergy *= 1.1;
        $defKinetic *= 1.1;
        $defAtk = $defEnergy + $defKinetic;
        $defShield *= 1.05;
    }

    $combatMods = load_combat_modifier_totals($db, (int)$fleet['user_id'], (int)$target['user_id']);
    $atkDamageAll = combat_modifier_scalar($combatMods['attacker'], 'combat.damage.all');
    $defDamageAll = combat_modifier_scalar($combatMods['defender'], 'combat.damage.all');
    $atkEnergy = max(0.0, $atkEnergy * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.energy'));
    $atkKinetic = max(0.0, $atkKinetic * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.kinetic'));
    $defEnergy = max(0.0, $defEnergy * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.energy'));
    $defKinetic = max(0.0, $defKinetic * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.kinetic'));
    $atkAtk = $atkEnergy + $atkKinetic;
    $defAtk = $defEnergy + $defKinetic;
    $atkShield = max(0.0, $atkShield * combat_modifier_scalar($combatMods['attacker'], 'combat.shield.capacity'));
    $defShield = max(0.0, $defShield * combat_modifier_scalar($combatMods['defender'], 'combat.shield.capacity'));
    $atkHull = max(0.0, $atkHull * combat_modifier_scalar($combatMods['attacker'], 'combat.hull.integrity'));
    $defHull = max(0.0, $defHull * combat_modifier_scalar($combatMods['defender'], 'combat.hull.integrity'));

    $atkBudget = compute_energy_budget($atkProfile, $combatMods['attacker']);
    $defBudget = compute_energy_budget($defProfile, $combatMods['defender']);

    $baseSeed = $deterministicSeed !== ''
        ? hash('sha256', $deterministicSeed)
        : hash('sha256', implode('|', [
            'simulate',
            (int)$fleet['id'],
            (int)$fleet['user_id'],
            (int)$target['user_id'],
        ]));

    $wins = 0;
    $sumDiceVariance = 0.0;
    $sumAtkLoss = 0.0;
    $sumDefLoss = 0.0;
    $firstOutcome = null;

    for ($i = 1; $i <= $iterations; $i++) {
        $iterSeed = hash('sha256', $baseSeed . '|iter|' . $i);
        $outcome = battle_preview_outcome(
            $atkAtk,
            $defAtk,
            $atkShield,
            $defShield,
            $atkHull,
            $defHull,
            $iterSeed,
            [
                'atk_energy' => $atkEnergy,
                'atk_kinetic' => $atkKinetic,
                'def_energy' => $defEnergy,
                'def_kinetic' => $defKinetic,
                'atk_weapon_factor' => $atkBudget['weapon_factor'],
                'def_weapon_factor' => $defBudget['weapon_factor'],
                'atk_shield_factor' => $atkBudget['shield_factor'],
                'def_shield_factor' => $defBudget['shield_factor'],
            ]
        );
        if ($firstOutcome === null) {
            $firstOutcome = $outcome;
        }
        if (!empty($outcome['attacker_wins'])) {
            $wins++;
        }
        $sumDiceVariance += (float)$outcome['dice_variance_index'];
        $sumAtkLoss += (float)$outcome['atk_loss_fraction'];
        $sumDefLoss += (float)$outcome['def_loss_fraction'];
    }

    $firstOutcome = $firstOutcome ?? battle_preview_outcome(
        $atkAtk,
        $defAtk,
        $atkShield,
        $defShield,
        $atkHull,
        $defHull,
        $baseSeed,
        [
            'atk_energy' => $atkEnergy,
            'atk_kinetic' => $atkKinetic,
            'def_energy' => $defEnergy,
            'def_kinetic' => $defKinetic,
            'atk_weapon_factor' => $atkBudget['weapon_factor'],
            'def_weapon_factor' => $defBudget['weapon_factor'],
            'atk_shield_factor' => $atkBudget['shield_factor'],
            'def_shield_factor' => $defBudget['shield_factor'],
        ]
    );

    json_ok([
        'simulation' => [
            'seed' => $baseSeed,
            'iterations' => $iterations,
            'attacker_wins_estimate' => (bool)$firstOutcome['attacker_wins'],
            'attacker_winrate_estimate' => (float)round($wins / max(1, $iterations), 4),
            'dice_variance_index' => (float)round($firstOutcome['dice_variance_index'], 4),
            'dice_variance_avg' => (float)round($sumDiceVariance / max(1, $iterations), 4),
            'power_rating' => [
                'attacker' => (int)round($atkAtk + $atkShield * 0.2 + $atkHull * 0.1),
                'defender' => (int)round($defAtk + $defShield * 0.2 + $defHull * 0.1),
            ],
            'expected_loss_fraction' => [
                'attacker' => (float)round($firstOutcome['atk_loss_fraction'], 4),
                'defender' => (float)round($firstOutcome['def_loss_fraction'], 4),
            ],
            'expected_loss_fraction_avg' => [
                'attacker' => (float)round($sumAtkLoss / max(1, $iterations), 4),
                'defender' => (float)round($sumDefLoss / max(1, $iterations), 4),
            ],
            'combat_modifiers' => $combatMods,
        ],
    ]);
}

function matchup_scan(PDO $db, int $uid, array $body): never {
    $attackerFleetId = (int)($body['attacker_fleet_id'] ?? 0);
    $iterations = max(1, min(2000, (int)($body['iterations'] ?? 200)));
    $deterministicSeed = trim((string)($body['deterministic_seed'] ?? ''));
    if ($deterministicSeed !== '') {
        $deterministicSeed = preg_replace('/[^a-zA-Z0-9_\-]/', '', $deterministicSeed) ?? '';
        $deterministicSeed = substr($deterministicSeed, 0, 64);
    }

    if ($attackerFleetId <= 0) {
        json_error('attacker_fleet_id is required.');
    }

    $fleetStmt = $db->prepare('SELECT * FROM fleets WHERE id = ? AND user_id = ? LIMIT 1');
    $fleetStmt->execute([$attackerFleetId, $uid]);
    $fleet = $fleetStmt->fetch();
    if (!$fleet) {
        json_error('Attacker fleet not found.', 404);
    }

    $ships = json_decode((string)($fleet['ships_json'] ?? '{}'), true) ?: [];
    if (empty($ships)) {
        json_error('Attacker fleet has no ships.');
    }

    $targetIds = [];
    $targetIdsRaw = $body['target_colony_ids'] ?? [];
    if (is_array($targetIdsRaw)) {
        foreach ($targetIdsRaw as $tid) {
            $id = (int)$tid;
            if ($id > 0) {
                $targetIds[] = $id;
            }
        }
    }
    $singleTarget = (int)($body['target_colony_id'] ?? 0);
    if ($singleTarget > 0) {
        $targetIds[] = $singleTarget;
    }
    $targetIds = array_values(array_unique($targetIds));

    if (empty($targetIds)) {
        $fallback = resolve_preview_target_colony($db, $fleet, 0);
        if (!$fallback) {
            json_error('No valid targets found for matchup scan.', 404);
        }
        $targetIds = [(int)$fallback['id']];
    }

    $attackerBase = compute_preview_attacker_stats($db, $fleet, $ships);
    $baseSeed = $deterministicSeed !== ''
        ? hash('sha256', $deterministicSeed)
        : hash('sha256', implode('|', ['matchup_scan', (int)$fleet['id'], (int)$fleet['user_id']]));

    $results = [];
    foreach ($targetIds as $targetId) {
        $target = resolve_preview_target_colony($db, $fleet, (int)$targetId);
        if (!$target) {
            $results[] = ['target_colony_id' => (int)$targetId, 'error' => 'target_not_found'];
            continue;
        }
        if ((int)$target['user_id'] === (int)$fleet['user_id']) {
            $results[] = ['target_colony_id' => (int)$target['id'], 'error' => 'own_colony_not_allowed'];
            continue;
        }

        $defenderBase = compute_preview_defender_stats($db, $target);
        $combatMods = load_combat_modifier_totals($db, (int)$fleet['user_id'], (int)$target['user_id']);

        $atkDamageAll = combat_modifier_scalar($combatMods['attacker'], 'combat.damage.all');
        $defDamageAll = combat_modifier_scalar($combatMods['defender'], 'combat.damage.all');
        $atkEnergy = max(0.0, $attackerBase['attack_energy'] * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.energy'));
        $atkKinetic = max(0.0, $attackerBase['attack_kinetic'] * $atkDamageAll * combat_modifier_scalar($combatMods['attacker'], 'combat.damage.kinetic'));
        $defEnergy = max(0.0, $defenderBase['attack_energy'] * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.energy'));
        $defKinetic = max(0.0, $defenderBase['attack_kinetic'] * $defDamageAll * combat_modifier_scalar($combatMods['defender'], 'combat.damage.kinetic'));
        $atkAtk = $atkEnergy + $atkKinetic;
        $defAtk = $defEnergy + $defKinetic;
        $atkShield = max(0.0, $attackerBase['shield'] * combat_modifier_scalar($combatMods['attacker'], 'combat.shield.capacity'));
        $defShield = max(0.0, $defenderBase['shield'] * combat_modifier_scalar($combatMods['defender'], 'combat.shield.capacity'));
        $atkHull = max(0.0, $attackerBase['hull'] * combat_modifier_scalar($combatMods['attacker'], 'combat.hull.integrity'));
        $defHull = max(0.0, $defenderBase['hull'] * combat_modifier_scalar($combatMods['defender'], 'combat.hull.integrity'));

        $atkBudget = compute_energy_budget($attackerBase['energy_profile'] ?? [], $combatMods['attacker']);
        $defBudget = compute_energy_budget($defenderBase['energy_profile'] ?? [], $combatMods['defender']);

        $wins = 0;
        $sumDiceVariance = 0.0;
        $sumAtkLoss = 0.0;
        $sumDefLoss = 0.0;

        for ($i = 1; $i <= $iterations; $i++) {
            $iterSeed = hash('sha256', $baseSeed . '|target|' . (int)$target['id'] . '|iter|' . $i);
            $outcome = battle_preview_outcome(
                $atkAtk,
                $defAtk,
                $atkShield,
                $defShield,
                $atkHull,
                $defHull,
                $iterSeed,
                [
                    'atk_energy' => $atkEnergy,
                    'atk_kinetic' => $atkKinetic,
                    'def_energy' => $defEnergy,
                    'def_kinetic' => $defKinetic,
                    'atk_weapon_factor' => $atkBudget['weapon_factor'],
                    'def_weapon_factor' => $defBudget['weapon_factor'],
                    'atk_shield_factor' => $atkBudget['shield_factor'],
                    'def_shield_factor' => $defBudget['shield_factor'],
                ]
            );
            if (!empty($outcome['attacker_wins'])) {
                $wins++;
            }
            $sumDiceVariance += (float)$outcome['dice_variance_index'];
            $sumAtkLoss += (float)$outcome['atk_loss_fraction'];
            $sumDefLoss += (float)$outcome['def_loss_fraction'];
        }

        $results[] = [
            'target_colony_id' => (int)$target['id'],
            'target_user_id' => (int)$target['user_id'],
            'iterations' => $iterations,
            'attacker_winrate_estimate' => (float)round($wins / max(1, $iterations), 4),
            'dice_variance_avg' => (float)round($sumDiceVariance / max(1, $iterations), 4),
            'expected_loss_fraction_avg' => [
                'attacker' => (float)round($sumAtkLoss / max(1, $iterations), 4),
                'defender' => (float)round($sumDefLoss / max(1, $iterations), 4),
            ],
            'power_rating' => [
                'attacker' => (int)round($atkAtk + $atkShield * 0.2 + $atkHull * 0.1),
                'defender' => (int)round($defAtk + $defShield * 0.2 + $defHull * 0.1),
            ],
        ];
    }

    $ranking = array_values(array_filter($results, static fn(array $r): bool => isset($r['attacker_winrate_estimate'])));
    usort($ranking, static fn(array $a, array $b): int => ($b['attacker_winrate_estimate'] <=> $a['attacker_winrate_estimate']));

    json_ok([
        'scan' => [
            'fleet_id' => (int)$fleet['id'],
            'iterations' => $iterations,
            'seed' => $baseSeed,
            'targets_scanned' => count($results),
            'results' => $results,
            'ranking' => $ranking,
        ],
    ]);
}

function resolve_preview_target_colony(PDO $db, array $fleet, int $targetColonyId): ?array {
    if ($targetColonyId > 0) {
        $stmt = $db->prepare('SELECT id, user_id, metal, crystal, deuterium, rare_earth FROM colonies WHERE id = ? LIMIT 1');
        $stmt->execute([$targetColonyId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    $stmt = $db->prepare(
        'SELECT c.id, c.user_id, c.metal, c.crystal, c.deuterium, c.rare_earth
            FROM colonies c JOIN celestial_bodies cb ON cb.id=c.body_id
            WHERE cb.galaxy_index=? AND cb.system_index=? AND cb.position=?
         LIMIT 1'
    );
    $stmt->execute([(int)$fleet['target_galaxy'], (int)$fleet['target_system'], (int)$fleet['target_position']]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function compute_preview_attacker_stats(PDO $db, array $fleet, array $ships): array {
    $wpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $wpnRow->execute([$fleet['user_id']]);
    $atkWpnLevel = (int)($wpnRow->fetchColumn() ?? 0);

    $atkShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $atkShldRow->execute([$fleet['user_id']]);
    $atkShldLevel = (int)($atkShldRow->fetchColumn() ?? 0);

    $cmdRow = $db->prepare('SELECT skill_attack FROM leaders WHERE fleet_id=? AND role=\'fleet_commander\' LIMIT 1');
    $cmdRow->execute([$fleet['id']]);
    $cmd = $cmdRow->fetch();
    $cmdBonus = $cmd ? (1.0 + (int)$cmd['skill_attack'] * 0.02) : 1.0;

    $atkMulti = (1.0 + $atkWpnLevel * 0.1) * $cmdBonus;
    $profile = compute_energy_combat_profile($ships, $db);
    $atkEnergy = $profile['attack_energy'] * $atkMulti;
    $atkKinetic = $profile['attack_kinetic'] * $atkMulti;
    $atkAtk = $atkEnergy + $atkKinetic;
    $atkHull = $profile['hull'];
    $atkShield = $profile['shield'] * (1.0 + $atkShldLevel * 0.1);

    $atkColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $atkColonyStmt->execute([(int)$fleet['origin_colony_id']]);
    $atkCol = $atkColonyStmt->fetch();
    if ($atkCol && $atkCol['colony_type'] === 'military') {
        $atkEnergy *= 1.1;
        $atkKinetic *= 1.1;
        $atkAtk = $atkEnergy + $atkKinetic;
        $atkShield *= 1.05;
    }

    return [
        'atk' => $atkAtk,
        'attack_energy' => $atkEnergy,
        'attack_kinetic' => $atkKinetic,
        'shield' => $atkShield,
        'hull' => $atkHull,
        'fleet' => $ships,
        'energy_profile' => $profile,
    ];
}

function compute_preview_defender_stats(PDO $db, array $target): array {
    $defWpnRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $defWpnRow->execute([$target['user_id']]);
    $defWpnLevel = (int)($defWpnRow->fetchColumn() ?? 0);

    $defShldRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $defShldRow->execute([$target['user_id']]);
    $defShldLevel = (int)($defShldRow->fetchColumn() ?? 0);

    complete_ship_build_queue($db, (int)$target['id']);
    $defShipsStmt = $db->prepare('SELECT type, count FROM ships WHERE colony_id=?');
    $defShipsStmt->execute([$target['id']]);
    $defFleet = [];
    foreach ($defShipsStmt->fetchAll() as $r) {
        $defFleet[(string)$r['type']] = (int)$r['count'];
    }
    $profile = compute_energy_combat_profile($defFleet, $db);
    $defEnergy = $profile['attack_energy'] * (1.0 + $defWpnLevel * 0.1);
    $defKinetic = $profile['attack_kinetic'] * (1.0 + $defWpnLevel * 0.1);
    $defAtk = $defEnergy + $defKinetic;
    $defHull = $profile['hull'];
    $defShield = $profile['shield'] * (1.0 + $defShldLevel * 0.1);

    $defColonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $defColonyStmt->execute([(int)$target['id']]);
    $defCol = $defColonyStmt->fetch();
    if ($defCol && $defCol['colony_type'] === 'military') {
        $defEnergy *= 1.1;
        $defKinetic *= 1.1;
        $defAtk = $defEnergy + $defKinetic;
        $defShield *= 1.05;
    }

    return [
        'atk' => $defAtk,
        'attack_energy' => $defEnergy,
        'attack_kinetic' => $defKinetic,
        'shield' => $defShield,
        'hull' => $defHull,
        'fleet' => $defFleet,
        'energy_profile' => $profile,
    ];
}

function battle_preview_outcome(
    float $atkAtk,
    float $defAtk,
    float $atkShield,
    float $defShield,
    float $atkHull,
    float $defHull,
    string $battleSeed,
    ?array $advanced = null
): array {
    $atkDiceMult = 0.9 + battle_rng_float($battleSeed, 'atk_dmg') * 0.2;
    $defDiceMult = 0.9 + battle_rng_float($battleSeed, 'def_dmg') * 0.2;

    if (is_array($advanced)) {
        $atkEnergy = max(0.0, (float)($advanced['atk_energy'] ?? 0.0)) * max(0.0, (float)($advanced['atk_weapon_factor'] ?? 1.0));
        $atkKinetic = max(0.0, (float)($advanced['atk_kinetic'] ?? 0.0)) * max(0.0, (float)($advanced['atk_weapon_factor'] ?? 1.0));
        $defEnergy = max(0.0, (float)($advanced['def_energy'] ?? 0.0)) * max(0.0, (float)($advanced['def_weapon_factor'] ?? 1.0));
        $defKinetic = max(0.0, (float)($advanced['def_kinetic'] ?? 0.0)) * max(0.0, (float)($advanced['def_weapon_factor'] ?? 1.0));

        $atkShieldFactor = max(0.0, (float)($advanced['atk_shield_factor'] ?? 1.0));
        $defShieldFactor = max(0.0, (float)($advanced['def_shield_factor'] ?? 1.0));

        $atkEnergyRaw = $atkEnergy * $atkDiceMult;
        $atkKineticRaw = $atkKinetic * $atkDiceMult;
        $defEnergyRaw = $defEnergy * $defDiceMult;
        $defKineticRaw = $defKinetic * $defDiceMult;

        $defShieldVsEnergy = $defShield * 1.30 * $defShieldFactor;
        $defShieldVsKinetic = $defShield * 0.75 * $defShieldFactor;
        $atkShieldVsEnergy = $atkShield * 1.30 * $atkShieldFactor;
        $atkShieldVsKinetic = $atkShield * 0.75 * $atkShieldFactor;

        $atkLeakEnergy = max(0.0, $atkEnergyRaw - $defShieldVsEnergy);
        $atkLeakKinetic = max(0.0, $atkKineticRaw - $defShieldVsKinetic);
        $defLeakEnergy = max(0.0, $defEnergyRaw - $atkShieldVsEnergy);
        $defLeakKinetic = max(0.0, $defKineticRaw - $atkShieldVsKinetic);

        $atkEffectiveDmg = max(0.0, $atkLeakEnergy * 1.15 + $atkLeakKinetic * 1.20);
        $defEffectiveDmg = max(0.0, $defLeakEnergy * 1.15 + $defLeakKinetic * 1.20);
    } else {
        $atkEffectiveDmg = max(0, ($atkAtk - $defShield * 0.5) * $atkDiceMult);
        $defEffectiveDmg = max(0, ($defAtk - $atkShield * 0.5) * $defDiceMult);
    }
    $attackerWins = $atkEffectiveDmg > ($defHull * 0.5 + $defShield * 0.2);

    $atkLossFraction = $defEffectiveDmg > 0
        ? min(0.9, $defEffectiveDmg / max(1, $atkHull + $atkShield))
        : 0.0;
    $defLossFraction = $attackerWins ? min(0.9, $atkEffectiveDmg / max(1, $defHull + $defShield)) : 0.3;

    return [
        'attacker_wins' => $attackerWins,
        'atk_loss_fraction' => (float)$atkLossFraction,
        'def_loss_fraction' => (float)$defLossFraction,
        'atk_effective_dmg' => (float)$atkEffectiveDmg,
        'def_effective_dmg' => (float)$defEffectiveDmg,
        'atk_dice_mult' => (float)$atkDiceMult,
        'def_dice_mult' => (float)$defDiceMult,
        'dice_variance_index' => (float)((abs($atkDiceMult - 1.0) + abs($defDiceMult - 1.0)) / 2.0),
    ];
}

function compute_energy_combat_profile(array $fleetShips, PDO $db): array {
    $profile = [
        'attack_energy' => 0.0,
        'attack_kinetic' => 0.0,
        'shield' => 0.0,
        'hull' => 0.0,
        'reactor_output' => 0.0,
        'capacitor_capacity' => 0.0,
        'weapon_drain' => 0.0,
        'shield_drain' => 0.0,
        'upkeep' => 0.0,
        'weapon_efficiency_base' => 1.0,
        'shield_efficiency_base' => 1.0,
    ];

    $weightedWeaponEff = 0.0;
    $weightedShieldEff = 0.0;
    $weightSum = 0.0;

    foreach ($fleetShips as $type => $countRaw) {
        $count = max(0, (int)$countRaw);
        if ($count <= 0) {
            continue;
        }
        $ship = ship_runtime_definition((string)$type, $db) ?? [];
        $attack = (float)($ship['attack'] ?? 0.0);
        $shield = (float)($ship['shield'] ?? 0.0);
        $hull = (float)($ship['hull'] ?? 0.0);

        $energyShare = (float)($ship['attack_energy_share'] ?? 0.5);
        $energyShare = clampf($energyShare, 0.1, 0.9);
        $kineticShare = 1.0 - $energyShare;

        $profile['attack_energy'] += $attack * $energyShare * $count;
        $profile['attack_kinetic'] += $attack * $kineticShare * $count;
        $profile['shield'] += $shield * $count;
        $profile['hull'] += $hull * $count;

        $profile['reactor_output'] += (float)($ship['reactor_output'] ?? max(8.0, ($attack + $shield) * 0.30)) * $count;
        $profile['capacitor_capacity'] += (float)($ship['capacitor_capacity'] ?? max(4.0, $shield * 0.25)) * $count;
        $profile['weapon_drain'] += (float)($ship['weapon_energy_drain'] ?? max(6.0, $attack * 0.22)) * $count;
        $profile['shield_drain'] += (float)($ship['shield_energy_drain'] ?? max(4.0, $shield * 0.18)) * $count;
        $profile['upkeep'] += (float)($ship['energy_upkeep'] ?? max(2.0, ($attack + $shield + $hull) * 0.03)) * $count;

        $weight = max(1.0, $attack + $shield + $hull);
        $weightedWeaponEff += (float)($ship['weapon_efficiency'] ?? 1.0) * $weight;
        $weightedShieldEff += (float)($ship['shield_efficiency'] ?? 1.0) * $weight;
        $weightSum += $weight;
    }

    if ($weightSum > 0.0) {
        $profile['weapon_efficiency_base'] = $weightedWeaponEff / $weightSum;
        $profile['shield_efficiency_base'] = $weightedShieldEff / $weightSum;
    }

    return $profile;
}

function compute_energy_budget(array $profile, array $sideMods): array {
    $generationScalar = combat_modifier_scalar($sideMods, 'combat.energy.generation');
    $upkeepScalar = combat_modifier_scalar($sideMods, 'combat.energy.upkeep');
    $weaponEffScalar = combat_modifier_scalar($sideMods, 'combat.energy.weapon_efficiency');
    $shieldEffScalar = combat_modifier_scalar($sideMods, 'combat.energy.shield_efficiency');
    $shieldAllocScalar = combat_modifier_scalar($sideMods, 'combat.energy.shield_allocation_cap');

    $reactor = max(0.0, (float)($profile['reactor_output'] ?? 0.0) * $generationScalar);
    $capacitor = max(0.0, (float)($profile['capacitor_capacity'] ?? 0.0));
    $upkeep = max(0.0, (float)($profile['upkeep'] ?? 0.0) * $upkeepScalar);

    $weaponEff = clampf((float)($profile['weapon_efficiency_base'] ?? 1.0) * $weaponEffScalar, 0.60, 1.40);
    $shieldEff = clampf((float)($profile['shield_efficiency_base'] ?? 1.0) * $shieldEffScalar, 0.60, 1.40);

    $available = max(0.0, $reactor + 0.35 * $capacitor - $upkeep);
    $shieldAllocCap = clampf(0.70 * $shieldAllocScalar, 0.30, 0.90);
    $energyShield = min($available * $shieldAllocCap, $available * 0.45);
    $energyWeapon = max(0.0, $available - $energyShield);

    $weaponDrain = max(1.0, (float)($profile['weapon_drain'] ?? 1.0));
    $shieldDrain = max(1.0, (float)($profile['shield_drain'] ?? 1.0));

    $weaponFactor = clampf(($energyWeapon * $weaponEff) / $weaponDrain, 0.0, 1.0);
    $shieldFactor = clampf(($energyShield * $shieldEff) / $shieldDrain, 0.0, 1.0);

    return [
        'available' => (float)round($available, 2),
        'energy_weapon' => (float)round($energyWeapon, 2),
        'energy_shield' => (float)round($energyShield, 2),
        'weapon_efficiency' => (float)round($weaponEff, 4),
        'shield_efficiency' => (float)round($shieldEff, 4),
        'weapon_factor' => (float)round($weaponFactor, 4),
        'shield_factor' => (float)round($shieldFactor, 4),
    ];
}

function clampf(float $value, float $min, float $max): float {
    return max($min, min($max, $value));
}

function battle_rng_float(string $seed, string $key): float {
    $hash = hash('sha256', $seed . '|' . $key);
    $num = hexdec(substr($hash, 0, 8));
    return $num / 4294967295.0;
}

function compute_relative_impact(float $a, float $b): float {
    $den = max(1.0, abs($a) + abs($b));
    return abs($a - $b) / $den * 100.0;
}

function build_battle_rounds_summary(
    float $attackerAttack,
    float $defenderAttack,
    float $attackerShield,
    float $defenderShield,
    float $attackerHull,
    float $defenderHull,
    float $attackerDiceMult,
    float $defenderDiceMult,
    bool $attackerWins,
    float $attackerLossFraction,
    float $defenderLossFraction
): array {
    $roundWeights = [0.42, 0.35, 0.23];
    $remainingAttackerIntegrity = max(1.0, $attackerShield + $attackerHull);
    $remainingDefenderIntegrity = max(1.0, $defenderShield + $defenderHull);
    $rounds = [];

    foreach ($roundWeights as $index => $weight) {
        $attackerPressure = max(0.0, $attackerAttack * $attackerDiceMult * $weight);
        $defenderPressure = max(0.0, $defenderAttack * $defenderDiceMult * $weight);

        $remainingDefenderIntegrity = max(0.0, $remainingDefenderIntegrity - ($attackerPressure * (1.0 - $defenderLossFraction * 0.25)));
        $remainingAttackerIntegrity = max(0.0, $remainingAttackerIntegrity - ($defenderPressure * (1.0 - $attackerLossFraction * 0.25)));

        $rounds[] = [
            'round' => $index + 1,
            'attacker_pressure' => (float)round($attackerPressure, 2),
            'defender_pressure' => (float)round($defenderPressure, 2),
            'attacker_integrity_remaining' => (float)round($remainingAttackerIntegrity, 2),
            'defender_integrity_remaining' => (float)round($remainingDefenderIntegrity, 2),
            'swing' => $attackerPressure >= $defenderPressure ? 'attacker' : 'defender',
        ];
    }

    if ($rounds) {
        $lastIndex = count($rounds) - 1;
        $rounds[$lastIndex]['decisive'] = true;
        $rounds[$lastIndex]['outcome'] = $attackerWins ? 'attacker' : 'defender';
    }

    return $rounds;
}

function build_battle_modifier_breakdown(array $combatMods): array {
    $result = ['attacker' => [], 'defender' => []];

    foreach (['attacker', 'defender'] as $side) {
        $sideMods = is_array($combatMods[$side] ?? null) ? $combatMods[$side] : [];
        foreach ($sideMods as $key => $payload) {
            $parts = explode('.', (string)$key);
            $domain = implode('.', array_slice($parts, 0, 3));
            if ($domain === '') {
                $domain = 'combat.misc';
            }

            if (!isset($result[$side][$domain])) {
                $result[$side][$domain] = ['add_flat' => 0.0, 'add_pct' => 0.0, 'mult' => 1.0];
            }

            $result[$side][$domain]['add_flat'] += (float)($payload['add_flat'] ?? 0.0);
            $result[$side][$domain]['add_pct'] += (float)($payload['add_pct'] ?? 0.0);
            $result[$side][$domain]['mult'] *= (float)($payload['mult'] ?? 1.0);
        }

        foreach ($result[$side] as $domain => $payload) {
            $result[$side][$domain] = [
                'add_flat' => (float)round((float)$payload['add_flat'], 4),
                'add_pct' => (float)round((float)$payload['add_pct'], 4),
                'mult' => (float)round((float)$payload['mult'], 4),
            ];
        }
    }

    return $result;
}

function battle_reports_has_combat_meta_columns(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
           AND COLUMN_NAME IN (\'battle_seed\', \'report_version\', \'attacker_power_rating\', \'defender_power_rating\', \'dice_variance_index\', \'explainability_json\')'
    );
    $stmt->execute(['battle_reports']);
    $cached = ((int)$stmt->fetchColumn() >= 6);
    return $cached;
}

function load_combat_modifier_totals(PDO $db, int $attackerUserId, int $defenderUserId): array {
    if (!combat_modifiers_tables_exist($db)) {
        return ['attacker' => [], 'defender' => []];
    }

    return [
        'attacker' => load_user_combat_modifiers($db, $attackerUserId),
        'defender' => load_user_combat_modifiers($db, $defenderUserId),
    ];
}

function load_user_combat_modifiers(PDO $db, int $userId): array {
    $stmt = $db->prepare(
        'SELECT cm.modifier_key, cm.operation, cm.value
         FROM user_combat_modifiers ucm
         JOIN combat_modifiers cm ON cm.id = ucm.combat_modifier_id
         WHERE ucm.user_id = ?
           AND cm.active = 1
           AND (cm.starts_at IS NULL OR cm.starts_at <= NOW())
           AND (cm.expires_at IS NULL OR cm.expires_at >= NOW())'
    );
    $stmt->execute([$userId]);

    $totals = [];
    foreach ($stmt->fetchAll() as $row) {
        $key = (string)($row['modifier_key'] ?? '');
        if ($key === '') {
            continue;
        }
        $op = (string)($row['operation'] ?? 'add_pct');
        $value = (float)($row['value'] ?? 0);

        if (!isset($totals[$key])) {
            $totals[$key] = ['add_flat' => 0.0, 'add_pct' => 0.0, 'mult' => 1.0];
        }

        if ($op === 'mult') {
            $totals[$key]['mult'] *= $value;
        } elseif ($op === 'add_flat') {
            $totals[$key]['add_flat'] += $value;
        } else {
            $totals[$key]['add_pct'] += $value;
        }
    }

    return $totals;
}

function combat_modifier_scalar(array $modTotals, string $prefix): float {
    $key = $prefix . '.add_pct';
    $multKey = $prefix . '.mult';

    $addPct = isset($modTotals[$key]) ? (float)($modTotals[$key]['add_pct'] ?? 0.0) : 0.0;
    $mult = isset($modTotals[$multKey]) ? (float)($modTotals[$multKey]['mult'] ?? 1.0) : 1.0;

    return max(0.0, (1.0 + $addPct) * $mult);
}

function combat_modifiers_tables_exist(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (\'combat_modifiers\', \'user_combat_modifiers\')'
    );
    $stmt->execute();
    $cached = ((int)$stmt->fetchColumn() >= 2);
    return $cached;
}

function colonize_planet(PDO $db, array $fleet, array $ships): void {
    $planetId = ensure_planet($db, (int)$fleet['target_galaxy'],
                              (int)$fleet['target_system'], (int)$fleet['target_position']);
    $bodyUid = sprintf('legacy-p-%d-%d-%d', (int)$fleet['target_galaxy'], (int)$fleet['target_system'], (int)$fleet['target_position']);
    $bodyLookup = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $bodyLookup->execute([$bodyUid]);
    $bodyId = (int)($bodyLookup->fetchColumn() ?: 0);
    if ($bodyId <= 0) {
        $db->prepare(
            'INSERT INTO celestial_bodies
                (body_uid, galaxy_index, system_index, position, body_type, parent_body_type,
                 name, planet_class, can_colonize, payload_json)
             VALUES (?, ?, ?, ?, \'planet\', \'star\', ?, \'terrestrial\', 1, JSON_OBJECT(\'legacy_planet_id\', ?))'
        )->execute([
            $bodyUid,
            (int)$fleet['target_galaxy'],
            (int)$fleet['target_system'],
            (int)$fleet['target_position'],
            'Planet ' . (int)$fleet['target_position'],
            $planetId,
        ]);
        $bodyId = (int)$db->lastInsertId();
    }

    // Check if already colonised
    $cRow = $db->prepare('SELECT id FROM colonies WHERE body_id=?');
    $cRow->execute([$bodyId]);
    if ($cRow->fetch()) {
        $db->prepare('INSERT INTO messages (receiver_id,subject,body) VALUES (?,?,?)')
           ->execute([$fleet['user_id'], 'Colonisation Failed', 'Position already occupied.']);
    } else {
        // Get planet info for starting resources
        $pInfo = $db->prepare('SELECT planet_class, richness_metal, deposit_metal FROM planets WHERE id=?');
        $pInfo->execute([$planetId]);
        $pData = $pInfo->fetch();

        $db->prepare(
            'INSERT INTO colonies (planet_id, body_id, user_id, name, metal, crystal, deuterium,
                                   food, population, max_population, happiness, last_update)
             VALUES (?, ?, ?, ?, 500, 300, 100, 200, 100, 500, 70, NOW())'
        )->execute([
            $planetId, $bodyId, $fleet['user_id'],
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
        // FoW: permanent own-visibility for newly colonised system
        touch_system_visibility($db, (int)$fleet['user_id'], (int)$fleet['target_galaxy'], (int)$fleet['target_system'], 'own', null, null);
        // Phase 2: invalidate system snapshot so the projector rebuilds it.
        enqueue_dirty_system($db, (int)$fleet['target_galaxy'], (int)$fleet['target_system'], 'colony_established');
    }

    // Return without colony ship
    unset($ships['colony_ship']);
    $travel  = max(1,(int)(strtotime($fleet['arrival_time'])-strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=?, ships_json=? WHERE id=?')
       ->execute([$retTime, $retTime, json_encode($ships), $fleet['id']]);
}

function create_spy_report(PDO $db, array $fleet, array $ships): void {
    $attackerEspionageLevel = 0;
    try {
        $atkEspStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "espionage_tech" LIMIT 1');
        $atkEspStmt->execute([(int)$fleet['user_id']]);
        $attackerEspionageLevel = (int)($atkEspStmt->fetchColumn() ?: 0);
    } catch (Throwable $e) {
        $attackerEspionageLevel = 0;
    }

    $tgt = $db->prepare(
        'SELECT c.id, c.body_id, c.metal, c.crystal, c.deuterium, c.rare_earth, c.food,
                c.population, c.max_population, c.happiness, c.public_services, c.energy,
                p.planet_class, p.diameter, p.in_habitable_zone,
            p.composition_family, p.dominant_surface_material, p.surface_pressure_bar,
            p.water_state, p.methane_state, p.ammonia_state, p.dominant_surface_liquid,
            p.radiation_level, p.habitability_score, p.life_friendliness, p.species_affinity_json,
                p.deposit_metal, p.deposit_crystal, p.deposit_deuterium, p.deposit_rare_earth,
                p.richness_metal, p.richness_crystal,
                u.username
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         LEFT JOIN planets  p ON p.id = c.planet_id
         JOIN users    u ON u.id = c.user_id
            WHERE cb.galaxy_index=? AND cb.system_index=? AND cb.position=?'
    );
    $tgt->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
    $target = $tgt->fetch();

    if (!$target) {
        // Uninhabited — still report planet geology if it exists
        $pRow = $db->prepare(
            'SELECT planet_class, in_habitable_zone, deposit_metal, deposit_crystal,
                    deposit_deuterium, deposit_rare_earth, richness_metal, richness_crystal,
                    richness_deuterium, richness_rare_earth, composition_family,
                    dominant_surface_material, surface_pressure_bar, water_state,
                    methane_state, ammonia_state, dominant_surface_liquid,
                    radiation_level, habitability_score, life_friendliness, species_affinity_json
               FROM planets WHERE galaxy=? AND `system`=? AND position=?'
        );
        $pRow->execute([$fleet['target_galaxy'], $fleet['target_system'], $fleet['target_position']]);
        $pData = $pRow->fetch();

        $report = [
            'status'       => 'uninhabited',
            'planet'       => $pData ?: null,
        ];
    } else {
        $defenderStealthLevel = 0;
        try {
            $defStealthStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "stealth_tech" LIMIT 1');
            $defStealthStmt->execute([(int)$target['user_id']]);
            $defenderStealthLevel = (int)($defStealthStmt->fetchColumn() ?: 0);
        } catch (Throwable $e) {
            $defenderStealthLevel = 0;
        }

        $stealthMasked = ($defenderStealthLevel >= 1 && $attackerEspionageLevel < 8);

        // Fetch defender's assigned leaders
        $lRow = $db->prepare('SELECT name, role, level FROM leaders WHERE colony_id=?');
        $lRow->execute([$target['id']]);
        $leaders = $lRow->fetchAll();

        // Fetch defender's ships
        complete_ship_build_queue($db, (int)$target['id']);
        $sRow = $db->prepare('SELECT type, count FROM ships WHERE colony_id=? AND count > 0');
        $sRow->execute([$target['id']]);
        $defShips = [];
        foreach ($sRow->fetchAll() as $r) { $defShips[$r['type']] = (int)$r['count']; }

        $report = [
            'status'       => 'inhabited',
            'owner'        => $target['username'],
            'stealth_masked' => $stealthMasked,
            'stealth_note' => $stealthMasked
                ? 'Stealth signature active: Fleet intel is hidden until Espionage Tech Lv8.'
                : null,
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
                'composition_family' => $target['composition_family'],
                'dominant_surface_material' => $target['dominant_surface_material'],
                'surface_pressure_bar' => (float)$target['surface_pressure_bar'],
                'water_state' => $target['water_state'],
                'methane_state' => $target['methane_state'],
                'ammonia_state' => $target['ammonia_state'],
                'dominant_surface_liquid' => $target['dominant_surface_liquid'],
                'radiation_level' => $target['radiation_level'],
                'habitability_score' => (int)$target['habitability_score'],
                'life_friendliness' => $target['life_friendliness'],
                'species_affinity' => json_decode((string)($target['species_affinity_json'] ?? '[]'), true),
                'deposit_metal'      => $target['deposit_metal'],
                'deposit_crystal'    => $target['deposit_crystal'],
                'deposit_rare_earth' => $target['deposit_rare_earth'],
                'richness_metal'     => $target['richness_metal'],
                'richness_crystal'   => $target['richness_crystal'],
            ],
            'ships'        => $stealthMasked ? [] : $defShips,
            'leaders'      => $stealthMasked ? [] : $leaders,
        ];
    }

     $db->prepare('INSERT INTO spy_reports (owner_id, target_body_id, report_json) VALUES (?,?,?)')
         ->execute([$fleet['user_id'], $target['body_id'] ?? null, json_encode($report)]);
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
            WHERE p.galaxy=? AND p.`system`=? AND p.position=?'
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
    $bodyUid = sprintf('legacy-p-%d-%d-%d', (int)$fleet['target_galaxy'], (int)$fleet['target_system'], (int)$fleet['target_position']);
    $bodyLookup = $db->prepare('SELECT id FROM celestial_bodies WHERE body_uid = ? LIMIT 1');
    $bodyLookup->execute([$bodyUid]);
    $targetBodyId = (int)($bodyLookup->fetchColumn() ?: 0);
    $colonised = $db->prepare('SELECT id FROM colonies WHERE body_id=?');
    $colonised->execute([$targetBodyId]);
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

// ─── Survey mission (Zhareen FTL node discovery) ──────────────────────────────

/**
 * Survey mission: fleet travels to a target system and charts a Zhareen
 * resonance node there (or any standard system survey for other factions).
 * On arrival the node is registered; fleet returns normally.
 */
function complete_survey_mission(PDO $db, array $fleet, array $ships): void {
    $uid = (int)$fleet['user_id'];
    $tg  = (int)$fleet['target_galaxy'];
    $ts  = (int)$fleet['target_system'];
    $og  = 1; // default; resolved from origin colony below
    $os  = 1;

    // Derive origin system from origin_colony_id
    $originRow = $db->prepare(
        'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.id = ? LIMIT 1'
    );
    $originRow->execute([(int)$fleet['origin_colony_id']]);
    $originPlanet = $originRow->fetch();
    $og = $originPlanet ? (int)$originPlanet['galaxy'] : $og;
    $os = $originPlanet ? (int)$originPlanet['system']  : $os;

    $ftlType = get_user_ftl_type($db, $uid);

    if ($ftlType === 'zhareen') {
        // Zhareen: chart a resonance node at the target system
        try {
            $db->prepare(
                'INSERT INTO ftl_resonance_nodes (owner_user_id, galaxy, `system`, discovered_at)
                  VALUES (?, ?, ?, NOW())
                  ON DUPLICATE KEY UPDATE discovered_at = NOW()'
            )->execute([$uid, $tg, $ts]);
            $nodeMsg = "Resonance node charted at [{$tg}:{$ts}]. Zhareen FTL channel now available.";
        } catch (\Throwable $e) {
            $nodeMsg = "Survey complete at [{$tg}:{$ts}]. (Node registration failed: " . $e->getMessage() . ')';
        }
    } elseif ($ftlType === 'syl_nar') {
        // Syl'Nar: build a gate from origin system to target system
        try {
            // Only create if no active gate already exists on this route
            $existing = resolve_syl_nar_gate($db, $uid, $og, $os, $tg, $ts);
            if ($existing) {
                $nodeMsg = "Syl'Nar Gate already active on route [{$og}:{$os}] ↔ [{$tg}:{$ts}].";
            } else {
                $db->prepare(
                    'INSERT INTO ftl_gates (owner_user_id, galaxy_a, system_a, galaxy_b, system_b)
                      VALUES (?, ?, ?, ?, ?)'
                )->execute([$uid, $og, $os, $tg, $ts]);
                $nodeMsg = "Syl'Nar Gate established: [{$og}:{$os}] ↔ [{$tg}:{$ts}]. FTL transit now available.";
            }
        } catch (\Throwable $e) {
            $nodeMsg = "Survey complete at [{$tg}:{$ts}]. (Gate installation failed: " . $e->getMessage() . ')';
        }
    } else {
        $nodeMsg = "Survey complete at [{$tg}:{$ts}]. No FTL infrastructure installed (drive: {$ftlType}).";
    }

    $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
       ->execute([$uid, 'Survey Complete', $nodeMsg]);

    $travel  = max(1, (int)(strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])));
    $retTime = date('Y-m-d H:i:s', time() + $travel);
    $db->prepare('UPDATE fleets SET returning=1, arrival_time=?, return_time=? WHERE id=?')
       ->execute([$retTime, $retTime, $fleet['id']]);
}
