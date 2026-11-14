<?php

declare(strict_types=1);

use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\ResourceLedger;
use GalaxyQuest\Combat\FleetDispatchReceipt;

/**
 * @param array<string, mixed> $body
 * @return array{fleet_id: int, arrival_time: string}
 */
function launch_fleet_dispatch(PDO $db, int $uid, array $body): array
{
    require_once __DIR__ . '/../src/Economy/ResourceLedger.php';
    require_once __DIR__ . '/../api/shipyard_queue.php';
    require_once __DIR__ . '/../api/cache.php';
    require_once __DIR__ . '/../api/projection.php';
    require_once __DIR__ . '/../src/Combat/FleetDispatchReceipt.php';
    $requestId = FleetDispatchReceipt::requestKey($body);
    $fingerprint = $requestId === null ? null : FleetDispatchReceipt::fingerprint($body);
    $originCid = (int)($body['origin_colony_id'] ?? 0);
    $result = (new ResourceLedger($db))->transactionWithColony(
        $originCid,
        $uid,
        static function () use ($db, $uid, $body, $requestId, $fingerprint): array {
            $receipts = new FleetDispatchReceipt($db);
            if ($requestId !== null) {
                $replay = $receipts->replay($uid, $requestId, $fingerprint);
                if ($replay !== null) {
                    return $replay;
                }
            }
            $result = launch_fleet_dispatch_locked($db, $uid, $body);
            if ($requestId !== null) {
                $receipts->record($uid, $requestId, $fingerprint, $result);
            }
            return $result;
        }
    );
    gq_cache_delete('shipyard_list', ['uid' => $uid, 'cid' => $originCid]);
    gq_cache_delete('game_overview', ['uid' => $uid]);
    return $result;
}

/**
 * @param array<string, mixed> $body
 * @return array{fleet_id: int, arrival_time: string}
 */
function launch_fleet_dispatch_locked(PDO $db, int $uid, array $body): array
{
    $originCid = (int)($body['origin_colony_id'] ?? 0);
    $tg        = (int)($body['target_galaxy']    ?? 0);
    $ts        = (int)($body['target_system']    ?? 0);
    $tp        = (int)($body['target_position']  ?? 0);
    $mission   = $body['mission'] ?? 'transport';
    $ships     = $body['ships']   ?? [];
    $cargo     = $body['cargo']   ?? [];
    $useWormhole = !empty($body['use_wormhole']);

    if (!in_array($mission, ['attack','transport','colonize','harvest','spy','survey'], true)) {
        throw new DomainException('Invalid mission type.');
    }
    if (!is_array($ships) || !is_array($cargo)) {
        throw new DomainException('Ships and cargo must be objects.', 400);
    }
    if (
        $tg < 1 || $tg > GALAXY_MAX || $ts < 1 || $ts > galaxy_system_limit()
        || $tp < 1 || $tp > POSITION_MAX
    ) {
        throw new DomainException('Target coordinates out of range.');
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
    if (!$origin) {
        throw new DomainException('Colony not found.', 404);
    }

    if ($mission === 'attack') {
        validate_fleet_attack_policy($db, $uid, $tg, $ts, $tp);
    }

    update_colony_resources($db, $originCid);
    complete_ship_build_queue($db, $originCid);
    $colStmt->execute([$originCid, $uid]);
    $origin = $colStmt->fetch();
    if (!$origin) {
        throw new DomainException('Colony not found.', 404);
    }

    // Validate & collect ships
    $shipsToSend = [];
    foreach ($ships as $type => $count) {
        if (!is_string($type) || !is_numeric($count) || !is_finite((float)$count)) {
            throw new DomainException('Invalid ship composition.', 400);
        }
        $count = (int)$count;
        if ($count <= 0 || !ship_exists_runtime($type, $db)) {
            continue;
        }
        $row = $db->prepare('SELECT count FROM ships WHERE colony_id = ? AND type = ?');
        $row->execute([$originCid, $type]);
        $available = $row->fetch();
        if (!$available || (int)$available['count'] < $count) {
            throw new DomainException("Not enough $type available.", 409);
        }
        $shipsToSend[$type] = $count;
    }
    if (empty($shipsToSend)) {
        throw new DomainException('No ships selected.');
    }

    // Cargo
    foreach (['metal', 'crystal', 'deuterium'] as $resource) {
        if (isset($cargo[$resource]) && (!is_numeric($cargo[$resource]) || !is_finite((float)$cargo[$resource]))) {
            throw new DomainException('Invalid cargo quantity.', 400);
        }
    }
    $cMetal = max(0.0, (float)($cargo['metal']     ?? 0));
    $cCrys  = max(0.0, (float)($cargo['crystal']   ?? 0));
    $cDeut  = max(0.0, (float)($cargo['deuterium'] ?? 0));
    $cap    = array_sum(array_map(fn($t, $c) => ship_cargo($t) * $c, array_keys($shipsToSend), $shipsToSend));

    // ── Vor'Tak Carrier bonus: +30% cargo capacity when carrier is in fleet ──
    $ftlTypeEarly = get_user_ftl_type($db, $uid);
    if ($ftlTypeEarly === 'vor_tak' && ($shipsToSend['carrier'] ?? 0) > 0) {
        $cap = (int)($cap * 1.3);
    }

    if ($cMetal + $cCrys + $cDeut > $cap) {
        throw new DomainException('Cargo exceeds fleet capacity.');
    }
    if ($origin['metal'] < $cMetal || $origin['crystal'] < $cCrys || $origin['deuterium'] < $cDeut) {
        throw new DomainException('Insufficient resources for cargo.');
    }

    $dist = coordinate_distance(
        (int)$origin['galaxy'],
        (int)$origin['system'],
        (int)$origin['position'],
        $tg,
        $ts,
        $tp
    );
    $speed      = fleet_speed($shipsToSend);
    $travel     = fleet_travel_time($dist, $speed);

    // ── 3-D Newtonian movement ──────────────────────────────────────────────
    [$ox, $oy, $oz] = get_system_3d_coords($db, (int)$origin['galaxy'], (int)$origin['system']);
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

    $wormhole = null;
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
            throw new DomainException('No active wormhole route available for this jump.');
        }
        $travel = 30;
        $distLy = 0.0;
        $speedLyH = max($speedLyH, 999999.0);
    }

    // ── Faction FTL mechanics ────────────────────────────────────────────────
    // Only apply when not already using a wormhole jump.
    $stealthUntil   = null; // Set by Vel'Ar for stealth window
    $hullDamagePct  = 0;    // Set by Kryl'Tha for hull degradation
    $ftlCooldownSec = null;
    $resonanceNodeId = null;
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
                    throw new DomainException('K-F Drive recharging. Ready at: ' . $cooldownUntil);
                }
                if ($distLy > 30.0 && $distLy > 0.0) {
                    throw new DomainException(
                        'K-F Drive range exceeded: max 30 LY per jump (distance: ' . round($distLy, 2) . ' LY).'
                    );
                }
                // Instantaneous jump: 30 s transit
                $travel   = 30;
                $speedLyH = 999999.0;
                $distLy   = max($distLy, 0.0);
                // Set 72h cooldown (scaled by GAME_SPEED so faster servers scale correctly)
                $cooldownSec = max(60, (int)(72 * 3600 / GAME_SPEED));
                $ftlCooldownSec = $cooldownSec;
                break;

            // ── Syl'Nar: Resonance Gate Network ─────────────────────────────
            // Requires a pre-built gate between origin and target system.
            case 'syl_nar':
                $gate = resolve_syl_nar_gate(
                    $db,
                    $uid,
                    (int)$origin['galaxy'],
                    (int)$origin['system'],
                    $tg,
                    $ts
                );
                if (!$gate) {
                    throw new DomainException(
                        "No active Syl'Nar gate on this route. Build one first"
                        . " (send a survey mission from origin to target system)."
                    );
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
                    throw new DomainException(
                        'No resonance node charted at target system. Send a survey mission first.'
                    );
                }
                if ($node['cooldown_until'] && strtotime((string)$node['cooldown_until']) > time()) {
                    throw new DomainException(
                        'Resonance node cooling down. Ready at: ' . $node['cooldown_until']
                    );
                }
                $travel   = 60;
                $speedLyH = 999999.0;
                $distLy   = 0.0;
                // Apply 30-min node cooldown
                $resonanceNodeId = (int)$node['id'];
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
                    throw new DomainException(
                        'Swarm Tunnel overloaded: maximum 50 ships per FTL jump (sent: ' . $totalShips . ').'
                    );
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

    if ($mission === 'attack') {
        validate_fleet_attack_policy($db, $uid, $tg, $ts, $tp);
    }

    $now        = time();
    $arrival    = date('Y-m-d H:i:s', $now + $travel);
    $returnT    = date('Y-m-d H:i:s', $now + $travel * 2);
    $departure  = date('Y-m-d H:i:s', $now);

    // Resolve Vel'Ar stealth: starts at arrival, lasts 60 s
    if ($stealthUntil === '__vel_ar__') {
        $stealthUntil = date('Y-m-d H:i:s', $now + $travel + 60);
    }

    $dispatch = function () use (
        $db,
        $uid,
        $originCid,
        $tg,
        $ts,
        $tp,
        $mission,
        $shipsToSend,
        $cMetal,
        $cCrys,
        $cDeut,
        $ox,
        $oy,
        $oz,
        $tx,
        $ty,
        $tz,
        $speedLyH,
        $distLy,
        $departure,
        $arrival,
        $returnT,
        $stealthUntil,
        $hullDamagePct,
        $useWormhole,
        $wormhole,
        $ftlCooldownSec,
        $resonanceNodeId
    ): int {
        foreach ($shipsToSend as $type => $cnt) {
            $reservation = $db->prepare(
                'UPDATE ships SET count = count - ? WHERE colony_id = ? AND type = ? AND count >= ?'
            );
            $reservation->execute([$cnt, $originCid, $type, $cnt]);
            if ($reservation->rowCount() !== 1) {
                throw new DomainException('Ships are no longer available.', 409);
            }
        }

        if ($useWormhole) {
            consume_wormhole_jump($db, (int)$wormhole['id']);
        }
        if ($ftlCooldownSec !== null) {
            $cooldown = $db->prepare(
                'UPDATE users
                 SET ftl_cooldown_until = DATE_ADD(NOW(), INTERVAL ? SECOND)
                 WHERE id = ? AND (ftl_cooldown_until IS NULL OR ftl_cooldown_until <= NOW())'
            );
            $cooldown->execute([$ftlCooldownSec, $uid]);
            if ($cooldown->rowCount() !== 1) {
                throw new DomainException('K-F Drive recharging. Refresh and retry.', 409);
            }
        }
        if ($resonanceNodeId !== null) {
            $cooldown = $db->prepare(
                'UPDATE ftl_resonance_nodes
                 SET cooldown_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
                 WHERE id = ? AND (cooldown_until IS NULL OR cooldown_until <= NOW())'
            );
            $cooldown->execute([$resonanceNodeId]);
            if ($cooldown->rowCount() !== 1) {
                throw new DomainException('Resonance node cooling down. Refresh and retry.', 409);
            }
        }

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
                    json_encode($shipsToSend, JSON_THROW_ON_ERROR), $cMetal, $cCrys, $cDeut,
                    $ox, $oy, $oz,
                    $originPolar['radius_ly'], $originPolar['theta_rad'], $originPolar['height_ly'],
                    $tx, $ty, $tz,
                    $targetPolar['radius_ly'], $targetPolar['theta_rad'], $targetPolar['height_ly'],
                    $speedLyH, $distLy,
                    $departure, $arrival, $returnT,
                    $stealthUntil, $hullDamagePct]);

        return (int)$db->lastInsertId();
    };
    $fleetId = (new OnDemandEconomy($db))->spend(
        $originCid,
        $uid,
        ['metal' => $cMetal, 'crystal' => $cCrys, 'deuterium' => $cDeut],
        $dispatch
    );
    enqueue_dirty_user($db, $uid, 'fleet_sent');
    return ['fleet_id' => $fleetId, 'arrival_time' => $arrival];
}

function validate_fleet_attack_policy(PDO $db, int $uid, int $tg, int $ts, int $tp): void
{
    $atkRow = $db->prepare('SELECT pvp_mode, protection_until FROM users WHERE id = ?');
    $atkRow->execute([$uid]);
    $atkUser = $atkRow->fetch();
    if (!$atkUser) {
        throw new DomainException('User not found.', 404);
    }
    if ($atkUser['protection_until'] && strtotime($atkUser['protection_until']) > time()) {
        throw new DomainException('You are under newbie protection and cannot launch attacks.');
    }
    $tgtRow = $db->prepare(
        "SELECT u.pvp_mode, u.protection_until, u.control_type
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         JOIN users u ON u.id = c.user_id
         WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?"
    );
    $tgtRow->execute([$tg, $ts, $tp]);
    $tgtUser = $tgtRow->fetch();
    if ($tgtUser && (string)($tgtUser['control_type'] ?? 'human') === 'human') {
        if (!$atkUser['pvp_mode']) {
            throw new DomainException('Enable PvP mode to attack other players.');
        }
        if (!$tgtUser['pvp_mode']) {
            throw new DomainException('Target player has PvP disabled.');
        }
        if ($tgtUser['protection_until'] && strtotime($tgtUser['protection_until']) > time()) {
            throw new DomainException('Target player is under newbie protection.');
        }
    }
}

function resolve_wormhole_route(
    PDO $db,
    int $uid,
    int $originGalaxy,
    int $originSystem,
    int $targetGalaxy,
    int $targetSystem
): ?array {
    require_once __DIR__ . '/../lib/GalaxySchema.php';
    \GalaxyQuest\Schema\GalaxySchema::assertWormholes($db);
    \GalaxyQuest\Schema\GalaxySchema::assertWormholeUnlocks($db);

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

function consume_wormhole_jump(PDO $db, int $wormholeId): void
{
    $update = $db->prepare(
        'UPDATE wormholes
         SET stability = GREATEST(0, stability - 5),
             cooldown_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)
         WHERE id = ? AND is_active = 1 AND stability >= 10
           AND (cooldown_until IS NULL OR cooldown_until <= NOW())'
    );
    $update->execute([$wormholeId]);
    if ($update->rowCount() !== 1) {
        throw new DomainException('Wormhole route is no longer available.', 409);
    }
}
