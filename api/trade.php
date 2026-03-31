<?php
// api/trade.php — Trade routes: automated recurring transport
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');

$uid = require_auth();
$db  = get_db();
$action = $_GET['action'] ?? '';

// Dispatch any trade routes due this session
check_and_dispatch_trade_routes($db, $uid);

match ($action) {
    'list'            => action_list($db, $uid),
    'create'          => action_create($db, $uid),
    'delete'          => action_delete($db, $uid),
    'toggle'          => action_toggle($db, $uid),
    'list_proposals'  => action_list_proposals($db, $uid),
    'propose'         => action_propose($db, $uid),
    'accept'          => action_accept($db, $uid),
    'reject'          => action_reject($db, $uid),
    'cancel'          => action_cancel($db, $uid),
    default           => json_error('Unknown action: ' . $action, 400),
};

// ─── Action handlers ──────────────────────────────────────────────────────────

function action_list(PDO $db, int $uid): never {
    $stmt = $db->prepare(<<<SQL
        SELECT
            tr.id, tr.origin_colony_id, tr.target_colony_id,
            tr.cargo_metal, tr.cargo_crystal, tr.cargo_deuterium,
            tr.interval_hours, tr.last_dispatch, tr.is_active,
            tr.created_at, tr.updated_at,
            oc.name AS origin_name, oc.user_id,
            tc.name AS target_name, tc.user_id AS target_user_id,
            ob.galaxy_index AS origin_galaxy, ob.system_index AS origin_system, ob.position AS origin_pos,
            tb.galaxy_index AS target_galaxy, tb.system_index AS target_system, tb.position AS target_pos
        FROM trade_routes tr
        JOIN colonies oc ON oc.id = tr.origin_colony_id
        JOIN colonies tc ON tc.id = tr.target_colony_id
        JOIN celestial_bodies ob ON ob.id = oc.body_id
        JOIN celestial_bodies tb ON tb.id = tc.body_id
        WHERE tr.user_id = ?
        ORDER BY tr.created_at DESC
    SQL);
    $stmt->execute([$uid]);
    $routes = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Enrich with next dispatch time
    foreach ($routes as &$route) {
        if ($route['last_dispatch']) {
            $lastTs = strtotime($route['last_dispatch']);
            $nextTs = $lastTs + ($route['interval_hours'] * 3600);
            $route['next_dispatch'] = date('Y-m-d H:i:s', $nextTs);
            $route['is_due'] = time() >= $nextTs && $route['is_active'];
        } else {
            $route['next_dispatch'] = date('Y-m-d H:i:s', time() + ($route['interval_hours'] * 3600));
            $route['is_due'] = $route['is_active'];  // Never dispatched, so due immediately
        }
    }
    
    json_ok(['trade_routes' => array_map(function ($r) {
        return [
            'id' => (int)$r['id'],
            'origin_colony_id' => (int)$r['origin_colony_id'],
            'target_colony_id' => (int)$r['target_colony_id'],
            'origin_name' => $r['origin_name'],
            'target_name' => $r['target_name'],
            'origin' => [
                'galaxy' => (int)$r['origin_galaxy'],
                'system' => (int)$r['origin_system'],
                'position' => (int)$r['origin_pos'],
            ],
            'target' => [
                'galaxy' => (int)$r['target_galaxy'],
                'system' => (int)$r['target_system'],
                'position' => (int)$r['target_pos'],
            ],
            'cargo' => [
                'metal' => (float)$r['cargo_metal'],
                'crystal' => (float)$r['cargo_crystal'],
                'deuterium' => (float)$r['cargo_deuterium'],
            ],
            'interval_hours' => (int)$r['interval_hours'],
            'is_active' => (bool)$r['is_active'],
            'last_dispatch' => $r['last_dispatch'],
            'next_dispatch' => $r['next_dispatch'],
            'is_due' => (bool)$r['is_due'],
        ];
    }, $routes)]);
}

function action_create(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $originColonyId = (int)($body['origin_colony_id'] ?? 0);
    $targetColonyId = (int)($body['target_colony_id'] ?? 0);
    $cargoMetal = (float)($body['cargo_metal'] ?? 0);
    $cargoCrystal = (float)($body['cargo_crystal'] ?? 0);
    $cargoDeuterium = (float)($body['cargo_deuterium'] ?? 0);
    $intervalHours = (int)($body['interval_hours'] ?? 24);
    
    if ($originColonyId <= 0 || $targetColonyId <= 0 || $intervalHours <= 0) {
        json_error('Invalid colony IDs or interval.', 400);
    }
    
    if ($cargoMetal <= 0 && $cargoCrystal <= 0 && $cargoDeuterium <= 0) {
        json_error('Cargo must be specified.', 400);
    }
    
    // Verify ownership of both colonies
    $stmt = $db->prepare('SELECT user_id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$originColonyId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('You don\'t own the origin colony.', 403);
    }
    
    $stmt->execute([$targetColonyId, $uid]);
    if (!$stmt->fetchColumn()) {
        json_error('You don\'t own the target colony.', 403);
    }
    
    // Create trade route (UNIQUE key prevents duplicates)
    $stmt = $db->prepare(<<<SQL
        INSERT INTO trade_routes
            (user_id, origin_colony_id, target_colony_id, cargo_metal, cargo_crystal, cargo_deuterium, interval_hours)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            cargo_metal = VALUES(cargo_metal),
            cargo_crystal = VALUES(cargo_crystal),
            cargo_deuterium = VALUES(cargo_deuterium),
            interval_hours = VALUES(interval_hours),
            is_active = 1,
            updated_at = CURRENT_TIMESTAMP
    SQL);
    $stmt->execute([$uid, $originColonyId, $targetColonyId, $cargoMetal, $cargoCrystal, $cargoDeuterium, $intervalHours]);
    
    $routeId = (int)$db->lastInsertId();
    if ($routeId === 0) {
        // Already existed, fetch the updated row
        $stmt = $db->prepare('SELECT id FROM trade_routes WHERE user_id = ? AND origin_colony_id = ? AND target_colony_id = ?');
        $stmt->execute([$uid, $originColonyId, $targetColonyId]);
        $routeId = (int)$stmt->fetchColumn();
    }
    
    json_ok(['trade_route_id' => $routeId]);
}

function action_delete(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $routeId = (int)($body['route_id'] ?? 0);
    
    if ($routeId <= 0) {
        json_error('Invalid route ID.', 400);
    }
    
    $stmt = $db->prepare('DELETE FROM trade_routes WHERE id = ? AND user_id = ?');
    $stmt->execute([$routeId, $uid]);
    
    if ($stmt->rowCount() === 0) {
        json_error('Trade route not found.', 404);
    }
    
    json_ok(['deleted' => true]);
}

function action_toggle(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $routeId = (int)($body['route_id'] ?? 0);
    
    if ($routeId <= 0) {
        json_error('Invalid route ID.', 400);
    }
    
    // Fetch current state
    $stmt = $db->prepare('SELECT is_active FROM trade_routes WHERE id = ? AND user_id = ?');
    $stmt->execute([$routeId, $uid]);
    $route = $stmt->fetch();
    
    if (!$route) {
        json_error('Trade route not found.', 404);
    }
    
    // Toggle and update
    $newState = $route['is_active'] ? 0 : 1;
    $stmt = $db->prepare('UPDATE trade_routes SET is_active = ? WHERE id = ?');
    $stmt->execute([$newState, $routeId]);
    
    json_ok(['is_active' => (bool)$newState]);
}

// ─── Auto-dispatch logic ──────────────────────────────────────────────────────

function check_and_dispatch_trade_routes(PDO $db, int $uid): void {
    $stmt = $db->prepare(<<<SQL
        SELECT * FROM trade_routes
        WHERE user_id = ? AND is_active = 1
        AND (
            last_dispatch IS NULL
            OR DATE_ADD(last_dispatch, INTERVAL interval_hours HOUR) <= NOW()
        )
    SQL);
    $stmt->execute([$uid]);
    
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $route) {
        dispatch_trade_fleet($db, $route);
    }
}

function dispatch_trade_fleet(PDO $db, array $route): void {
    $uid = (int)$route['user_id'];
    $originColonyId = (int)$route['origin_colony_id'];
    $targetColonyId = (int)$route['target_colony_id'];
    $cargoMetal = (float)$route['cargo_metal'];
    $cargoCrystal = (float)$route['cargo_crystal'];
    $cargoDeuterium = (float)$route['cargo_deuterium'];
    $routeId = (int)$route['id'];

    $origin = load_trade_colony_node($db, $originColonyId, $uid);
    $target = load_trade_colony_node($db, $targetColonyId, null);
    if (!$origin || !$target) {
        return;
    }

    $db->beginTransaction();
    try {
        launch_trade_transport_fleet(
            $db,
            $uid,
            $origin,
            $target,
            [
                'metal' => $cargoMetal,
                'crystal' => $cargoCrystal,
                'deuterium' => $cargoDeuterium,
            ],
            ['reason' => 'trade-route']
        );
        $stmt = $db->prepare('UPDATE trade_routes SET last_dispatch = NOW() WHERE id = ?');
        $stmt->execute([$routeId]);
        $db->commit();
    } catch (Throwable $_) {
        $db->rollBack();
        return;
    }
}

function load_trade_colony_node(PDO $db, int $colonyId, ?int $userId = null): ?array {
    $sql = <<<SQL
        SELECT c.id, c.user_id, c.name, c.metal, c.crystal, c.deuterium,
             cb.galaxy_index AS galaxy, cb.system_index AS system, cb.position,
               COALESCE(s.x_ly, 0) AS x_ly,
               COALESCE(s.y_ly, 0) AS y_ly,
               COALESCE(s.z_ly, 0) AS z_ly
        FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         LEFT JOIN star_systems s ON s.galaxy_index = cb.galaxy_index AND s.system_index = cb.system_index
        WHERE c.id = ?
    SQL;
    if ($userId !== null) {
        $sql .= ' AND c.user_id = ?';
    }
    $stmt = $db->prepare($sql);
    $params = [$colonyId];
    if ($userId !== null) {
        $params[] = $userId;
    }
    $stmt->execute($params);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function pick_trade_target_colony(PDO $db, int $userId): ?array {
    $stmt = $db->prepare(<<<SQL
        SELECT c.id
        FROM colonies c
        WHERE c.user_id = ?
        ORDER BY (c.metal + c.crystal + c.deuterium) DESC, c.id ASC
        LIMIT 1
    SQL);
    $stmt->execute([$userId]);
    $colonyId = (int)$stmt->fetchColumn();
    if ($colonyId <= 0) {
        return null;
    }
    return load_trade_colony_node($db, $colonyId, $userId);
}

function estimate_trade_transport_profile(array $origin, array $target, array $cargo): array {
    $metal = max(0.0, (float)($cargo['metal'] ?? 0));
    $crystal = max(0.0, (float)($cargo['crystal'] ?? 0));
    $deuterium = max(0.0, (float)($cargo['deuterium'] ?? 0));
    $totalCargo = $metal + $crystal + $deuterium;

    $dx = (float)$target['x_ly'] - (float)$origin['x_ly'];
    $dy = (float)$target['y_ly'] - (float)$origin['y_ly'];
    $dz = (float)$target['z_ly'] - (float)$origin['z_ly'];
    $distance = max(0.1, sqrt($dx * $dx + $dy * $dy + $dz * $dz));
    $speed = 2.0;
    $travelSecs = (int)ceil(($distance / $speed) * 3600);
    $fuelCost = (float)max(5, ceil(($distance * 0.35) + ($totalCargo / 20000)));

    return [
        'distance_ly' => $distance,
        'speed_ly_h' => $speed,
        'travel_seconds' => $travelSecs,
        'fuel_cost_deuterium' => $fuelCost,
        'total_cargo' => $totalCargo,
    ];
}

function pick_trade_source_for_target(PDO $db, int $userId, array $target, array $cargo): ?array {
    $stmt = $db->prepare(<<<SQL
        SELECT c.id
        FROM colonies c
        WHERE c.user_id = ?
          AND c.metal >= ?
          AND c.crystal >= ?
          AND c.deuterium >= ?
        ORDER BY (c.metal + c.crystal + c.deuterium) DESC, c.id ASC
    SQL);
    $stmt->execute([
        $userId,
        max(0.0, (float)($cargo['metal'] ?? 0)),
        max(0.0, (float)($cargo['crystal'] ?? 0)),
        max(0.0, (float)($cargo['deuterium'] ?? 0)),
    ]);

    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $colonyId) {
        $origin = load_trade_colony_node($db, (int)$colonyId, $userId);
        if (!$origin) {
            continue;
        }
        $profile = estimate_trade_transport_profile($origin, $target, $cargo);
        if ((float)$origin['deuterium'] >= max(0.0, (float)($cargo['deuterium'] ?? 0)) + (float)$profile['fuel_cost_deuterium']) {
            return $origin;
        }
    }

    return null;
}

function launch_trade_transport_fleet(PDO $db, int $userId, array $origin, array $target, array $cargo, array $options = []): array {
    $metal = max(0.0, (float)($cargo['metal'] ?? 0));
    $crystal = max(0.0, (float)($cargo['crystal'] ?? 0));
    $deuterium = max(0.0, (float)($cargo['deuterium'] ?? 0));
    $profile = estimate_trade_transport_profile($origin, $target, $cargo);
    $fuelCost = (float)$profile['fuel_cost_deuterium'];

    if ((float)$origin['metal'] < $metal
        || (float)$origin['crystal'] < $crystal
        || (float)$origin['deuterium'] < ($deuterium + $fuelCost)
    ) {
        throw new RuntimeException('Origin colony cannot cover cargo and freight fuel.');
    }

    $depTime = date('Y-m-d H:i:s');
    $arrTime = date('Y-m-d H:i:s', time() + (int)$profile['travel_seconds']);
    $shipsJson = json_encode(['cargo_freighter' => 1], JSON_UNESCAPED_SLASHES);

    $stmt = $db->prepare(<<<SQL
        UPDATE colonies
        SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
        WHERE id = ?
    SQL);
    $stmt->execute([$metal, $crystal, $deuterium + $fuelCost, (int)$origin['id']]);

    $originPolar = galactic_polar_from_cartesian((float)$origin['x_ly'], (float)$origin['y_ly'], (float)$origin['z_ly']);
    $targetPolar = galactic_polar_from_cartesian((float)$target['x_ly'], (float)$target['y_ly'], (float)$target['z_ly']);

    $stmt = $db->prepare(<<<SQL
        INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
             origin_x_ly, origin_y_ly, origin_z_ly,
             origin_radius_ly, origin_theta_rad, origin_height_ly,
             target_x_ly, target_y_ly, target_z_ly,
             target_radius_ly, target_theta_rad, target_height_ly,
             speed_ly_h, distance_ly, departure_time, arrival_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?)
    SQL);
    $stmt->execute([
        $userId,
        (int)$origin['id'],
        (int)$target['galaxy'],
        (int)$target['system'],
        (int)$target['position'],
        'transport',
        $shipsJson,
        $metal,
        $crystal,
        $deuterium,
        (float)$origin['x_ly'],
        (float)$origin['y_ly'],
        (float)$origin['z_ly'],
        $originPolar['radius_ly'],
        $originPolar['theta_rad'],
        $originPolar['height_ly'],
        (float)$target['x_ly'],
        (float)$target['y_ly'],
        (float)$target['z_ly'],
        $targetPolar['radius_ly'],
        $targetPolar['theta_rad'],
        $targetPolar['height_ly'],
        (float)$profile['speed_ly_h'],
        (float)$profile['distance_ly'],
        $depTime,
        $arrTime,
    ]);

    $labelParts = [];
    if ($metal > 0) $labelParts[] = 'Metal';
    if ($crystal > 0) $labelParts[] = 'Crystal';
    if ($deuterium > 0) $labelParts[] = 'Deuterium';

    return [
        'fleet_id' => (int)$db->lastInsertId(),
        'origin_colony_id' => (int)$origin['id'],
        'origin_name' => (string)($origin['name'] ?? ('Colony #' . $origin['id'])),
        'target_colony_id' => (int)$target['id'],
        'target_name' => (string)($target['name'] ?? ('Colony #' . $target['id'])),
        'arrival_time' => $arrTime,
        'distance_ly' => round((float)$profile['distance_ly'], 2),
        'fuel_cost_deuterium' => $fuelCost,
        'resource_label' => implode('/', $labelParts) ?: 'Transport',
        'reason' => (string)($options['reason'] ?? 'trade'),
    ];
}

// ─── Trade Proposal handlers ─────────────────────────────────────────────────

function action_list_proposals(PDO $db, int $uid): never {
    // Auto-expire stale proposals
    $db->prepare('UPDATE trade_proposals SET status = \'expired\'
                  WHERE status = \'pending\' AND expires_at <= NOW()')
       ->execute();

    $stmt = $db->prepare(<<<SQL
        SELECT tp.*,
               ui.username AS initiator_name,
               ut.username AS target_name
        FROM trade_proposals tp
        JOIN users ui ON ui.id = tp.initiator_id
        JOIN users ut ON ut.id = tp.target_id
        WHERE (tp.initiator_id = ? OR tp.target_id = ?)
          AND tp.status IN ('pending','accepted','rejected','cancelled','expired')
        ORDER BY tp.created_at DESC
        LIMIT 100
    SQL);
    $stmt->execute([$uid, $uid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    json_ok(['proposals' => array_map(fn($r) => [
        'id'               => (int)$r['id'],
        'initiator_id'     => (int)$r['initiator_id'],
        'initiator_name'   => $r['initiator_name'],
        'target_id'        => (int)$r['target_id'],
        'target_name'      => $r['target_name'],
        'offer'            => [
            'metal'      => (float)$r['offer_metal'],
            'crystal'    => (float)$r['offer_crystal'],
            'deuterium'  => (float)$r['offer_deuterium'],
        ],
        'request'          => [
            'metal'      => (float)$r['request_metal'],
            'crystal'    => (float)$r['request_crystal'],
            'deuterium'  => (float)$r['request_deuterium'],
        ],
        'message'          => $r['message'],
        'status'           => $r['status'],
        'expires_at'       => $r['expires_at'],
        'created_at'       => $r['created_at'],
        'is_mine'          => (int)$r['initiator_id'] === $uid,
    ], $rows)]);
}

function action_propose(PDO $db, int $uid): never {
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $targetId      = (int)($body['target_id'] ?? 0);
    $offerMetal    = max(0.0, (float)($body['offer_metal'] ?? 0));
    $offerCrystal  = max(0.0, (float)($body['offer_crystal'] ?? 0));
    $offerDeut     = max(0.0, (float)($body['offer_deuterium'] ?? 0));
    $reqMetal      = max(0.0, (float)($body['request_metal'] ?? 0));
    $reqCrystal    = max(0.0, (float)($body['request_crystal'] ?? 0));
    $reqDeut       = max(0.0, (float)($body['request_deuterium'] ?? 0));
    $message       = mb_substr(trim($body['message'] ?? ''), 0, 500);
    $expireDays    = max(1, min(7, (int)($body['expire_days'] ?? 2)));

    if ($targetId <= 0 || $targetId === $uid) {
        json_error('Invalid target player.', 400);
    }
    if ($offerMetal + $offerCrystal + $offerDeut <= 0
        && $reqMetal + $reqCrystal + $reqDeut <= 0) {
        json_error('Proposal must offer or request at least one resource.', 400);
    }

    // Verify target exists
    $stmt = $db->prepare('SELECT id FROM users WHERE id = ?');
    $stmt->execute([$targetId]);
    if (!$stmt->fetchColumn()) {
        json_error('Target player not found.', 404);
    }

    // Check initiator has enough resources on any colony
    if ($offerMetal + $offerCrystal + $offerDeut > 0) {
        $stmt = $db->prepare(<<<SQL
            SELECT SUM(metal) AS tm, SUM(crystal) AS tc, SUM(deuterium) AS td
            FROM colonies WHERE user_id = ?
        SQL);
        $stmt->execute([$uid]);
        $res = $stmt->fetch(PDO::FETCH_ASSOC);
        if ((float)$res['tm'] < $offerMetal
            || (float)$res['tc'] < $offerCrystal
            || (float)$res['td'] < $offerDeut) {
            json_error('Not enough resources to offer.', 400);
        }
    }

    $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expireDays} days"));

    $stmt = $db->prepare(<<<SQL
        INSERT INTO trade_proposals
            (initiator_id, target_id,
             offer_metal, offer_crystal, offer_deuterium,
             request_metal, request_crystal, request_deuterium,
             message, status, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    SQL);
    $stmt->execute([
        $uid, $targetId,
        $offerMetal, $offerCrystal, $offerDeut,
        $reqMetal, $reqCrystal, $reqDeut,
        $message, $expiresAt,
    ]);

    json_ok(['proposal_id' => (int)$db->lastInsertId()]);
}

function action_accept(PDO $db, int $uid): never {
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $proposalId = (int)($body['proposal_id'] ?? 0);
    if ($proposalId <= 0) json_error('Invalid proposal ID.', 400);

    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
            'SELECT * FROM trade_proposals WHERE id = ? AND target_id = ? AND status = \'pending\' FOR UPDATE'
        );
        $stmt->execute([$proposalId, $uid]);
        $p = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$p) {
            $db->rollBack();
            json_error('Proposal not found or not available.', 404);
        }
        if (strtotime($p['expires_at']) < time()) {
            $db->prepare('UPDATE trade_proposals SET status = \'expired\' WHERE id = ?')->execute([$proposalId]);
            $db->commit();
            json_error('Proposal has expired.', 400);
        }

        $initId      = (int)$p['initiator_id'];
        $offerMetal  = (float)$p['offer_metal'];
        $offerCrys   = (float)$p['offer_crystal'];
        $offerDeut   = (float)$p['offer_deuterium'];
        $reqMetal    = (float)$p['request_metal'];
        $reqCrys     = (float)$p['request_crystal'];
        $reqDeut     = (float)$p['request_deuterium'];
        $deliveries = [];

        if ($offerMetal + $offerCrys + $offerDeut > 0) {
            $targetColony = pick_trade_target_colony($db, $uid);
            if (!$targetColony) {
                $db->rollBack();
                json_error('Zielspieler hat keine empfangsbereite Kolonie.', 400);
            }
            $sourceColony = pick_trade_source_for_target($db, $initId, $targetColony, [
                'metal' => $offerMetal,
                'crystal' => $offerCrys,
                'deuterium' => $offerDeut,
            ]);
            if (!$sourceColony) {
                $db->rollBack();
                json_error('Initiator kann Angebot derzeit nicht per Transport absichern.', 400);
            }
            $deliveries[] = launch_trade_transport_fleet(
                $db,
                $initId,
                $sourceColony,
                $targetColony,
                [
                    'metal' => $offerMetal,
                    'crystal' => $offerCrys,
                    'deuterium' => $offerDeut,
                ],
                ['reason' => 'proposal-offer']
            );
        }

        if ($reqMetal + $reqCrys + $reqDeut > 0) {
            $targetColony = pick_trade_target_colony($db, $initId);
            if (!$targetColony) {
                $db->rollBack();
                json_error('Initiator hat keine empfangsbereite Kolonie.', 400);
            }
            $sourceColony = pick_trade_source_for_target($db, $uid, $targetColony, [
                'metal' => $reqMetal,
                'crystal' => $reqCrys,
                'deuterium' => $reqDeut,
            ]);
            if (!$sourceColony) {
                $db->rollBack();
                json_error('Deine Seite kann die Gegenleistung derzeit nicht per Transport absichern.', 400);
            }
            $deliveries[] = launch_trade_transport_fleet(
                $db,
                $uid,
                $sourceColony,
                $targetColony,
                [
                    'metal' => $reqMetal,
                    'crystal' => $reqCrys,
                    'deuterium' => $reqDeut,
                ],
                ['reason' => 'proposal-request']
            );
        }

        $db->prepare("UPDATE trade_proposals SET status='accepted' WHERE id=?")->execute([$proposalId]);
        $db->commit();

        json_ok([
            'accepted' => true,
            'deliveries' => $deliveries,
            'message' => 'Trade accepted. Cargo fleets are now in transit.',
        ]);
    } catch (Throwable $e) {
        $db->rollBack();
        json_error('Trade failed: ' . $e->getMessage(), 500);
    }
}

function action_reject(PDO $db, int $uid): never {
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $proposalId = (int)($body['proposal_id'] ?? 0);
    if ($proposalId <= 0) json_error('Invalid proposal ID.', 400);

    $stmt = $db->prepare(
        "UPDATE trade_proposals SET status='rejected' WHERE id=? AND target_id=? AND status='pending'"
    );
    $stmt->execute([$proposalId, $uid]);
    if ($stmt->rowCount() === 0) json_error('Proposal not found or already resolved.', 404);

    json_ok(['rejected' => true]);
}

function action_cancel(PDO $db, int $uid): never {
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $proposalId = (int)($body['proposal_id'] ?? 0);
    if ($proposalId <= 0) json_error('Invalid proposal ID.', 400);

    $stmt = $db->prepare(
        "UPDATE trade_proposals SET status='cancelled' WHERE id=? AND initiator_id=? AND status='pending'"
    );
    $stmt->execute([$proposalId, $uid]);
    if ($stmt->rowCount() === 0) json_error('Proposal not found or already resolved.', 404);

    json_ok(['cancelled' => true]);
}
