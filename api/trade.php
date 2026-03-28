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
            op.galaxy AS origin_galaxy, op.system AS origin_system, op.position AS origin_pos,
            tp.galaxy AS target_galaxy, tp.system AS target_system, tp.position AS target_pos
        FROM trade_routes tr
        JOIN colonies oc ON oc.id = tr.origin_colony_id
        JOIN colonies tc ON tc.id = tr.target_colony_id
        JOIN planets op ON op.id = oc.planet_id
        JOIN planets tp ON tp.id = tc.planet_id
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
    
    // Fetch origin colony data
    $stmt = $db->prepare(<<<SQL
        SELECT c.id, c.planet_id, c.metal, c.crystal, c.deuterium,
               p.galaxy, p.system, p.position,
               s.x_ly AS origin_x, s.y_ly AS origin_y, s.z_ly AS origin_z
        FROM colonies c
        JOIN planets p ON p.id = c.planet_id
        LEFT JOIN star_systems s ON s.galaxy_index = p.galaxy AND s.system_index = p.system
        WHERE c.id = ? AND c.user_id = ?
    SQL);
    $stmt->execute([$originColonyId, $uid]);
    $origin = $stmt->fetch();
    
    if (!$origin) {
        return;  // Colony no longer exists
    }
    
    // Check if origin has enough cargo resources
    if ((float)$origin['metal'] < $cargoMetal
        || (float)$origin['crystal'] < $cargoCrystal
        || (float)$origin['deuterium'] < $cargoDeuterium
    ) {
        return;  // Not enough resources, skip dispatch
    }
    
    // Fetch target colony/planet
    $stmt = $db->prepare(<<<SQL
        SELECT c.id, p.galaxy, p.system, p.position,
               s.x_ly AS target_x, s.y_ly AS target_y, s.z_ly AS target_z
        FROM colonies c
        JOIN planets p ON p.id = c.planet_id
        LEFT JOIN star_systems s ON s.galaxy_index = p.galaxy AND s.system_index = p.system
        WHERE c.id = ?
    SQL);
    $stmt->execute([$targetColonyId]);
    $target = $stmt->fetch();
    
    if (!$target) {
        return;  // Target colony no longer exists
    }
    
    $targetGalaxy = (int)$target['galaxy'];
    $targetSystem = (int)$target['system'];
    $targetPos = (int)$target['position'];
    
    // Determine coordinates
    $originX = $origin['origin_x'] ?? 0;
    $originY = $origin['origin_y'] ?? 0;
    $originZ = $origin['origin_z'] ?? 0;
    $targetX = $target['target_x'] ?? 0;
    $targetY = $target['target_y'] ?? 0;
    $targetZ = $target['target_z'] ?? 0;
    
    // Calculate distance
    $dx = $targetX - $originX;
    $dy = $targetY - $originY;
    $dz = $targetZ - $originZ;
    $distance = sqrt($dx * $dx + $dy * $dy + $dz * $dz);
    $distance = max(0.1, $distance);  // Avoid division by zero
    
    // Fleet speed: cargo ships travel at 2 ly/h (base speed)
    $speed = 2.0;
    $travelSecs = (int)ceil(($distance / $speed) * 3600);
    
    // Create fleet with single cargo ship type
    // Use 'cargo_freighter' or similar; if not available, use generic 'transport'
    $shipsJson = json_encode(['cargo_freighter' => 1]);
    
    $depTime = date('Y-m-d H:i:s');
    $arrTime = date('Y-m-d H:i:s', time() + $travelSecs);
    
    // Deduct cargo from origin colony
    $stmt = $db->prepare(<<<SQL
        UPDATE colonies
        SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
        WHERE id = ?
    SQL);
    $stmt->execute([$cargoMetal, $cargoCrystal, $cargoDeuterium, $originColonyId]);
    
    // Create fleet record
    $stmt = $db->prepare(<<<SQL
        INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
             origin_x_ly, origin_y_ly, origin_z_ly,
             target_x_ly, target_y_ly, target_z_ly,
             speed_ly_h, distance_ly, departure_time, arrival_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?)
    SQL);
    $stmt->execute([
        $uid, $originColonyId, $targetGalaxy, $targetSystem, $targetPos,
        'transport', $shipsJson, $cargoMetal, $cargoCrystal, $cargoDeuterium,
        $originX, $originY, $originZ,
        $targetX, $targetY, $targetZ,
        $speed, $distance, $depTime, $arrTime,
    ]);
    
    // Mark dispatch time
    $stmt = $db->prepare('UPDATE trade_routes SET last_dispatch = NOW() WHERE id = ?');
    $stmt->execute([$routeId]);
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
        // Lock the row for update
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

        // Verify initiator still has enough (on best-funded colony)
        if ($offerMetal + $offerCrys + $offerDeut > 0) {
            $stmt = $db->prepare('SELECT SUM(metal) AS tm, SUM(crystal) AS tc, SUM(deuterium) AS td FROM colonies WHERE user_id = ?');
            $stmt->execute([$initId]);
            $res = $stmt->fetch(PDO::FETCH_ASSOC);
            if ((float)$res['tm'] < $offerMetal || (float)$res['tc'] < $offerCrys || (float)$res['td'] < $offerDeut) {
                $db->rollBack();
                json_error('Initiator no longer has enough resources.', 400);
            }
        }
        // Verify acceptor (target) still has enough
        if ($reqMetal + $reqCrys + $reqDeut > 0) {
            $stmt = $db->prepare('SELECT SUM(metal) AS tm, SUM(crystal) AS tc, SUM(deuterium) AS td FROM colonies WHERE user_id = ?');
            $stmt->execute([$uid]);
            $res = $stmt->fetch(PDO::FETCH_ASSOC);
            if ((float)$res['tm'] < $reqMetal || (float)$res['tc'] < $reqCrys || (float)$res['td'] < $reqDeut) {
                $db->rollBack();
                json_error('You do not have enough resources to fulfil this proposal.', 400);
            }
        }

        // Helper: deduct from colonies of a user (largest colony first)
        $deduct = function(PDO $db, int $userId, float $metal, float $crystal, float $deut): void {
            if ($metal + $crystal + $deut <= 0) return;
            $stmt = $db->prepare('SELECT id, metal, crystal, deuterium FROM colonies WHERE user_id = ? ORDER BY (metal+crystal+deuterium) DESC');
            $stmt->execute([$userId]);
            $upd = $db->prepare('UPDATE colonies SET metal=?, crystal=?, deuterium=? WHERE id=?');
            foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $col) {
                if ($metal <= 0 && $crystal <= 0 && $deut <= 0) break;
                $take_m = min($metal,   (float)$col['metal']);
                $take_c = min($crystal, (float)$col['crystal']);
                $take_d = min($deut,    (float)$col['deuterium']);
                $upd->execute([
                    (float)$col['metal']     - $take_m,
                    (float)$col['crystal']   - $take_c,
                    (float)$col['deuterium'] - $take_d,
                    (int)$col['id'],
                ]);
                $metal    -= $take_m;
                $crystal  -= $take_c;
                $deut     -= $take_d;
            }
        };

        // Helper: credit to main (largest) colony of a user
        $credit = function(PDO $db, int $userId, float $metal, float $crystal, float $deut): void {
            if ($metal + $crystal + $deut <= 0) return;
            $stmt = $db->prepare('SELECT id FROM colonies WHERE user_id = ? ORDER BY (metal+crystal+deuterium) DESC LIMIT 1');
            $stmt->execute([$userId]);
            $colId = (int)$stmt->fetchColumn();
            if (!$colId) return;
            $db->prepare('UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+? WHERE id=?')
               ->execute([$metal, $crystal, $deut, $colId]);
        };

        // Execute the swap
        $deduct($db, $initId, $offerMetal, $offerCrys,  $offerDeut);   // initiator gives offer
        $deduct($db,   $uid,  $reqMetal,   $reqCrys,    $reqDeut);     // acceptor gives request
        $credit($db,   $uid,  $offerMetal, $offerCrys,  $offerDeut);   // acceptor receives offer
        $credit($db, $initId, $reqMetal,   $reqCrys,    $reqDeut);     // initiator receives request

        $db->prepare("UPDATE trade_proposals SET status='accepted' WHERE id=?")->execute([$proposalId]);
        $db->commit();

        json_ok(['accepted' => true]);
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
