<?php
// api/trade.php — Trade routes: automated recurring transport
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/economy_flush.php';
require_once __DIR__ . '/economy_runtime.php';

header('Content-Type: application/json; charset=utf-8');

$uid = require_auth();
$db  = get_db();
$action = $_GET['action'] ?? '';

const TRADE_COLONY_RESOURCES = ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'];

if (!function_exists('normalize_angle_rad')) {
    function normalize_angle_rad(float $angle): float {
        $twoPi = 2.0 * M_PI;
        $angle = fmod($angle, $twoPi);
        if ($angle < 0) {
            $angle += $twoPi;
        }
        return $angle;
    }
}

if (!function_exists('galactic_polar_from_cartesian')) {
    function galactic_polar_from_cartesian(float $x, float $y, float $z): array {
        $radius = hypot($x, $y);
        $theta = $radius > 0.0 ? normalize_angle_rad(atan2($y, $x)) : 0.0;
        return [
            'radius_ly' => round($radius, 2),
            'theta_rad' => round($theta, 6),
            'height_ly' => round($z, 2),
        ];
    }
}

// Dispatch any trade routes due this session
check_and_dispatch_trade_routes($db, $uid);

match ($action) {
    'list'            => action_list($db, $uid),
    'create'          => action_create($db, $uid),
    'delete'          => action_delete($db, $uid),
    'toggle'          => action_toggle($db, $uid),
    'list_suggestions' => action_list_suggestions($db, $uid),
    'apply_suggestion' => action_apply_suggestion($db, $uid),
    'list_proposals'  => action_list_proposals($db, $uid),
    'propose'         => action_propose($db, $uid),
    'accept'          => action_accept($db, $uid),
    'reject'          => action_reject($db, $uid),
    'cancel'          => action_cancel($db, $uid),
    default           => json_error('Unknown action: ' . $action, 400),
};

function normalize_trade_cargo_payload(array $input): array {
    $payload = [];

    if (isset($input['cargo']) && is_array($input['cargo'])) {
        foreach ($input['cargo'] as $resource => $qty) {
            $key = trim((string)$resource);
            $val = max(0.0, (float)$qty);
            if ($key !== '' && $val > 0) {
                $payload[$key] = round($val, 4);
            }
        }
    }

    // Legacy compatibility
    $legacy = [
        'metal' => (float)($input['cargo_metal'] ?? 0),
        'crystal' => (float)($input['cargo_crystal'] ?? 0),
        'deuterium' => (float)($input['cargo_deuterium'] ?? 0),
        'rare_earth' => (float)($input['cargo_rare_earth'] ?? 0),
        'food' => (float)($input['cargo_food'] ?? 0),
    ];
    foreach ($legacy as $resource => $qty) {
        $qty = max(0.0, $qty);
        if ($qty > 0) {
            $payload[$resource] = round(($payload[$resource] ?? 0.0) + $qty, 4);
        }
    }

    return $payload;
}

function decode_trade_route_payload(array $route): array {
    $raw = $route['cargo_payload'] ?? null;
    if (is_string($raw) && trim($raw) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            return normalize_trade_cargo_payload(['cargo' => $decoded]);
        }
    }

    return normalize_trade_cargo_payload([
        'cargo_metal' => (float)($route['cargo_metal'] ?? 0),
        'cargo_crystal' => (float)($route['cargo_crystal'] ?? 0),
        'cargo_deuterium' => (float)($route['cargo_deuterium'] ?? 0),
        'cargo_rare_earth' => 0,
        'cargo_food' => 0,
    ]);
}

function encode_trade_payload_json(array $payload): string {
    return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '{}';
}

function extract_primary_cargo(array $payload): array {
    return [
        'metal' => (float)($payload['metal'] ?? 0),
        'crystal' => (float)($payload['crystal'] ?? 0),
        'deuterium' => (float)($payload['deuterium'] ?? 0),
    ];
}

function total_trade_cargo_units(array $payload): float {
    $total = 0.0;
    foreach ($payload as $qty) {
        $total += max(0.0, (float)$qty);
    }
    return $total;
}

// ─── Action handlers ──────────────────────────────────────────────────────────

function action_list(PDO $db, int $uid): never {
    $stmt = $db->prepare(<<<SQL
        SELECT
            tr.id, tr.origin_colony_id, tr.target_colony_id,
            tr.cargo_metal, tr.cargo_crystal, tr.cargo_deuterium,
            tr.cargo_payload,
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
        $payload = decode_trade_route_payload($r);
        $primary = extract_primary_cargo($payload);
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
                'metal' => (float)$primary['metal'],
                'crystal' => (float)$primary['crystal'],
                'deuterium' => (float)$primary['deuterium'],
            ],
            'cargo_payload' => $payload,
            'interval_hours' => (int)$r['interval_hours'],
            'is_active' => (bool)$r['is_active'],
            'last_dispatch' => $r['last_dispatch'],
            'next_dispatch' => $r['next_dispatch'],
            'is_due' => (bool)$r['is_due'],
        ];
    }, $routes)]);
}

function action_create(PDO $db, int $uid): never {
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $originColonyId = (int)($body['origin_colony_id'] ?? 0);
    $targetColonyId = (int)($body['target_colony_id'] ?? 0);
    $payload = normalize_trade_cargo_payload($body);
    $intervalHours = (int)($body['interval_hours'] ?? 24);
    
    if ($originColonyId <= 0 || $targetColonyId <= 0 || $intervalHours <= 0) {
        json_error('Invalid colony IDs or interval.', 400);
    }
    if ($originColonyId === $targetColonyId) {
        json_error('Origin and target colony cannot be the same.', 400);
    }
    
    if (!$payload) {
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

    $routeId = upsert_trade_route(
        $db,
        $uid,
        $originColonyId,
        $targetColonyId,
        $payload,
        $intervalHours
    );
    
    json_ok(['trade_route_id' => $routeId]);
}

function action_delete(PDO $db, int $uid): never {
    verify_csrf();
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
    verify_csrf();
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

    function action_list_suggestions(PDO $db, int $uid): never {
        $limit = min(20, max(1, (int)($_GET['limit'] ?? 10)));
        $intervalHours = min(168, max(1, (int)($_GET['interval_hours'] ?? 24)));

        $colonies = fetch_trade_user_colony_nodes($db, $uid);
        if (count($colonies) < 2) {
            json_ok(['suggestions' => []]);
        }

        $suggestions = build_trade_balance_suggestions($db, $uid, $colonies, $intervalHours, $limit);
        json_ok(['suggestions' => $suggestions]);
    }

    function action_apply_suggestion(PDO $db, int $uid): never {
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?? [];

        $originColonyId = (int)($body['origin_colony_id'] ?? 0);
        $targetColonyId = (int)($body['target_colony_id'] ?? 0);
        $payload = normalize_trade_cargo_payload($body);
        $intervalHours = min(168, max(1, (int)($body['interval_hours'] ?? 24)));

        if ($originColonyId <= 0 || $targetColonyId <= 0 || $originColonyId === $targetColonyId) {
            json_error('Invalid colony IDs.', 400);
        }
        if (!$payload) {
            json_error('Cargo must be specified.', 400);
        }

        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$originColonyId, $uid]);
        if (!$stmt->fetchColumn()) {
            json_error('You do not own the origin colony.', 403);
        }
        $stmt->execute([$targetColonyId, $uid]);
        if (!$stmt->fetchColumn()) {
            json_error('You do not own the target colony.', 403);
        }

        $routeId = upsert_trade_route(
            $db,
            $uid,
            $originColonyId,
            $targetColonyId,
            $payload,
            $intervalHours
        );

        json_ok([
            'trade_route_id' => $routeId,
            'applied' => true,
        ]);
    }

    function upsert_trade_route(PDO $db, int $uid, int $originColonyId, int $targetColonyId, array $payload, int $intervalHours): int {
        $primary = extract_primary_cargo($payload);
        $payloadJson = encode_trade_payload_json($payload);

        $stmt = $db->prepare(<<<SQL
            INSERT INTO trade_routes
                (user_id, origin_colony_id, target_colony_id,
                 cargo_metal, cargo_crystal, cargo_deuterium, cargo_payload, interval_hours)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                cargo_metal = VALUES(cargo_metal),
                cargo_crystal = VALUES(cargo_crystal),
                cargo_deuterium = VALUES(cargo_deuterium),
                cargo_payload = VALUES(cargo_payload),
                interval_hours = VALUES(interval_hours),
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP
        SQL);
        $stmt->execute([
            $uid,
            $originColonyId,
            $targetColonyId,
            $primary['metal'],
            $primary['crystal'],
            $primary['deuterium'],
            $payloadJson,
            $intervalHours,
        ]);

        $routeId = (int)$db->lastInsertId();
        if ($routeId > 0) {
            return $routeId;
        }

        $stmt = $db->prepare('SELECT id FROM trade_routes WHERE user_id = ? AND origin_colony_id = ? AND target_colony_id = ?');
        $stmt->execute([$uid, $originColonyId, $targetColonyId]);
        return (int)$stmt->fetchColumn();
    }

    function fetch_trade_user_colony_nodes(PDO $db, int $uid): array {
        $stmt = $db->prepare(<<<SQL
            SELECT c.id, c.user_id, c.name, c.metal, c.crystal, c.deuterium,
                     c.rare_earth, c.food,
                 cb.galaxy_index AS galaxy, cb.system_index AS system_index, cb.position,
                   COALESCE(s.x_ly, 0) AS x_ly,
                   COALESCE(s.y_ly, 0) AS y_ly,
                   COALESCE(s.z_ly, 0) AS z_ly
            FROM colonies c
            JOIN celestial_bodies cb ON cb.id = c.body_id
            LEFT JOIN star_systems s ON s.galaxy_index = cb.galaxy_index AND s.system_index = cb.system_index
            WHERE c.user_id = ?
            ORDER BY c.id ASC
        SQL);
        $stmt->execute([$uid]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    function build_trade_colony_runtime_profiles(PDO $db, array $colonies): array {
        $profiles = [];
        foreach ($colonies as $colony) {
            $colonyId = (int)$colony['id'];
            update_colony_resources($db, $colonyId);
            flush_colony_production($db, $colonyId);
            $runtimeRow = fetch_colony_runtime_row($db, $colonyId);
            if (!$runtimeRow) {
                continue;
            }
            $profiles[$colonyId] = build_colony_consumption_snapshot($db, $runtimeRow);
        }
        return $profiles;
    }

    function trade_runtime_processed_consumption(array $runtimeProfile, string $resource): float {
        return max(0.0, (float)($runtimeProfile['consumption']['processed_goods_per_hour'][$resource] ?? 0.0));
    }

    function trade_colony_resource_reserve(array $colony, array $runtimeProfiles, string $resource, int $intervalHours): float {
        $colonyId = (int)$colony['id'];
        $runtime = $runtimeProfiles[$colonyId] ?? null;
        if (!$runtime) {
            return 0.0;
        }

        $reserveWindow = max(24, $intervalHours * 2);
        if ($resource === 'food') {
            $foodCons = (float)($runtime['consumption']['food_per_hour'] ?? 0.0);
            return max(100.0, $foodCons * $reserveWindow);
        }

        $processedCons = trade_runtime_processed_consumption($runtime, $resource);
        if ($processedCons > 0.0) {
            return max(25.0, $processedCons * max(24, $intervalHours * 3));
        }

        if ($resource === 'deuterium') {
            $energyBalance = (float)($runtime['welfare']['energy_balance'] ?? 0.0);
            $energyPressure = max(0.0, -$energyBalance);
            return max(50.0, 25.0 + ($energyPressure * 2.0));
        }

        return 0.0;
    }

    function trade_colony_welfare_priority_multiplier(array $colony, array $runtimeProfiles, string $resource): float {
        $colonyId = (int)$colony['id'];
        $runtime = $runtimeProfiles[$colonyId] ?? null;
        if (!$runtime) {
            return 1.0;
        }

        $happiness = (float)($runtime['welfare']['happiness'] ?? 70.0);
        $foodCoverage = (float)($runtime['welfare']['food_coverage'] ?? 1.0);
        $energyBalance = (float)($runtime['welfare']['energy_balance'] ?? 0.0);

        $multiplier = 1.0;
        if ($resource === 'food') {
            if ($foodCoverage < 1.0) {
                $multiplier += (1.0 - $foodCoverage) * 3.0;
            }
            if ($happiness < 55.0) {
                $multiplier += (55.0 - $happiness) / 30.0;
            }
        } elseif (trade_runtime_processed_consumption($runtime, $resource) > 0.0) {
            if ($happiness < 65.0) {
                $multiplier += (65.0 - $happiness) / 35.0;
            }
            if ($foodCoverage < 0.9) {
                $multiplier += (0.9 - $foodCoverage) * 1.5;
            }
        } elseif ($resource === 'deuterium' && $energyBalance < 0.0) {
            $multiplier += min(2.0, abs($energyBalance) / 100.0);
        }

        return max(1.0, round($multiplier, 4));
    }

    function fetch_trade_user_processed_goods(PDO $db, int $uid): array {
        $stmt = $db->prepare(<<<SQL
            SELECT epg.colony_id, epg.good_type, epg.quantity
            FROM economy_processed_goods epg
            JOIN colonies c ON c.id = epg.colony_id
            WHERE c.user_id = ? AND epg.quantity > 0
        SQL);
        $stmt->execute([$uid]);

        $goodsByColony = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $colonyId = (int)$row['colony_id'];
            $goodType = (string)$row['good_type'];
            $qty = (float)$row['quantity'];
            if (!isset($goodsByColony[$colonyId])) {
                $goodsByColony[$colonyId] = [];
            }
            $goodsByColony[$colonyId][$goodType] = $qty;
        }

        return $goodsByColony;
    }

    function trade_colony_resource_qty(array $colony, array $goodsByColony, string $resource): float {
        if (in_array($resource, TRADE_COLONY_RESOURCES, true)) {
            return max(0.0, (float)($colony[$resource] ?? 0.0));
        }

        $colonyId = (int)$colony['id'];
        return max(0.0, (float)($goodsByColony[$colonyId][$resource] ?? 0.0));
    }

    function classify_trade_suggestion_priority(float $pressure): string {
        if ($pressure > 25000.0) {
            return 'critical';
        }
        if ($pressure > 8000.0) {
            return 'high';
        }
        return 'normal';
    }

    function build_trade_balance_suggestions(PDO $db, int $uid, array $colonies, int $intervalHours, int $limit): array {
        $goodsByColony = fetch_trade_user_processed_goods($db, $uid);
        $runtimeProfiles = build_trade_colony_runtime_profiles($db, $colonies);
        $resourceSet = array_fill_keys(TRADE_COLONY_RESOURCES, true);
        foreach ($goodsByColony as $goods) {
            foreach (array_keys($goods) as $goodType) {
                $resourceSet[(string)$goodType] = true;
            }
        }

        $resources = array_keys($resourceSet);
        $suggestions = [];

        foreach ($resources as $resource) {
            $total = 0.0;
            foreach ($colonies as $colony) {
                $total += trade_colony_resource_qty($colony, $goodsByColony, $resource);
            }
            $avg = count($colonies) > 0 ? ($total / count($colonies)) : 0.0;
            if ($avg <= 0.0) {
                continue;
            }
            $threshold = max(100.0, $avg * 0.15);

            $sources = [];
            $targets = [];
            foreach ($colonies as $colony) {
                $qty = trade_colony_resource_qty($colony, $goodsByColony, $resource);
                $reserve = trade_colony_resource_reserve($colony, $runtimeProfiles, $resource, $intervalHours);
                $surplus = max($qty - $avg, max(0.0, $qty - $reserve));
                $deficit = max($avg - $qty, max(0.0, $reserve - $qty));
                if ($surplus > $threshold) {
                    $sources[] = ['colony' => $colony, 'surplus' => $surplus];
                }
                if ($deficit > $threshold) {
                    $targets[] = ['colony' => $colony, 'deficit' => $deficit];
                }
            }

            usort($sources, fn($a, $b) => $b['surplus'] <=> $a['surplus']);
            usort($targets, fn($a, $b) => $b['deficit'] <=> $a['deficit']);

            foreach ($targets as $targetEntry) {
                $bestSourceIndex = null;
                $bestScore = -1.0;
                $bestTransfer = 0.0;
                $bestProfile = null;

                foreach ($sources as $sourceIndex => $sourceEntry) {
                    $sourceColony = $sourceEntry['colony'];
                    $targetColony = $targetEntry['colony'];
                    if ((int)$sourceColony['id'] === (int)$targetColony['id']) {
                        continue;
                    }

                    $transferQty = min((float)$sourceEntry['surplus'], (float)$targetEntry['deficit']);
                    if ($transferQty <= 0) {
                        continue;
                    }

                    $cargo = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0, 'rare_earth' => 0.0, 'food' => 0.0];
                    $cargo[$resource] = $transferQty;
                    $profile = estimate_trade_transport_profile($sourceColony, $targetColony, $cargo);

                    if ($resource === 'deuterium') {
                        $maxTransfer = max(0.0, (float)$sourceColony['deuterium'] - ($avg + (float)$profile['fuel_cost_deuterium']));
                        $transferQty = min($transferQty, $maxTransfer);
                        if ($transferQty <= 0) {
                            continue;
                        }
                        $cargo[$resource] = $transferQty;
                        $profile = estimate_trade_transport_profile($sourceColony, $targetColony, $cargo);
                    }

                    $score = $transferQty / max(1.0, (float)$profile['distance_ly']);
                    if ($score > $bestScore) {
                        $bestScore = $score;
                        $bestSourceIndex = $sourceIndex;
                        $bestTransfer = $transferQty;
                        $bestProfile = $profile;
                    }
                }

                if ($bestSourceIndex === null || $bestTransfer <= 0 || $bestProfile === null) {
                    continue;
                }

                $sourceColony = $sources[$bestSourceIndex]['colony'];
                $targetColony = $targetEntry['colony'];
                $sources[$bestSourceIndex]['surplus'] -= $bestTransfer;

                $cargo = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0, 'rare_earth' => 0.0, 'food' => 0.0];
                $cargo[$resource] = round($bestTransfer, 2);

                $existingStmt = $db->prepare('SELECT id, is_active FROM trade_routes WHERE user_id = ? AND origin_colony_id = ? AND target_colony_id = ? LIMIT 1');
                $existingStmt->execute([$uid, (int)$sourceColony['id'], (int)$targetColony['id']]);
                $existingRoute = $existingStmt->fetch(PDO::FETCH_ASSOC) ?: null;

                $sourceSurplusBefore = round((float)$sources[$bestSourceIndex]['surplus'] + $bestTransfer, 2);
                $targetDeficitBefore = round((float)$targetEntry['deficit'], 2);
                $pressure = max($sourceSurplusBefore, $targetDeficitBefore);
                $targetPriorityMultiplier = trade_colony_welfare_priority_multiplier($targetColony, $runtimeProfiles, $resource);
                $priority = classify_trade_suggestion_priority((float)($pressure * $targetPriorityMultiplier));
                $priorityScore = round((($bestScore * 1000.0) + ($pressure * 0.02)) * $targetPriorityMultiplier, 3);
                $reason = $targetPriorityMultiplier > 1.15 ? 'welfare-shortage' : 'stock-imbalance';
                $targetRuntime = $runtimeProfiles[(int)$targetColony['id']] ?? [];
                $targetQty = trade_colony_resource_qty($targetColony, $goodsByColony, $resource);
                $sourceQty = trade_colony_resource_qty($sourceColony, $goodsByColony, $resource);
                $targetReserve = trade_colony_resource_reserve($targetColony, $runtimeProfiles, $resource, $intervalHours);
                $sourceReserve = trade_colony_resource_reserve($sourceColony, $runtimeProfiles, $resource, $intervalHours);
                $reasonDetails = [
                    'target_qty' => round($targetQty, 2),
                    'target_reserve' => round($targetReserve, 2),
                    'target_shortage' => round(max(0.0, $targetReserve - $targetQty), 2),
                    'source_qty' => round($sourceQty, 2),
                    'source_reserve' => round($sourceReserve, 2),
                    'transfer_qty' => round($bestTransfer, 2),
                ];
                if ($resource === 'food') {
                    $reasonDetails['target_food_per_hour'] = round((float)($targetRuntime['consumption']['food_per_hour'] ?? 0.0), 2);
                    $reasonDetails['target_food_coverage'] = round((float)($targetRuntime['welfare']['food_coverage'] ?? 1.0), 4);
                    $reasonDetails['reserve_window_hours'] = max(24, $intervalHours * 2);
                } elseif (trade_runtime_processed_consumption($targetRuntime, $resource) > 0.0) {
                    $reasonDetails['target_processed_consumption_per_hour'] = round(trade_runtime_processed_consumption($targetRuntime, $resource), 4);
                    $reasonDetails['reserve_window_hours'] = max(24, $intervalHours * 3);
                }

                $suggestions[] = [
                    'origin_colony_id' => (int)$sourceColony['id'],
                    'origin_name' => (string)$sourceColony['name'],
                    'target_colony_id' => (int)$targetColony['id'],
                    'target_name' => (string)$targetColony['name'],
                    'cargo' => $cargo,
                    'resource_type' => $resource,
                    'interval_hours' => $intervalHours,
                    'estimated_distance_ly' => round((float)$bestProfile['distance_ly'], 2),
                    'estimated_fuel_cost_deuterium' => round((float)$bestProfile['fuel_cost_deuterium'], 2),
                    'source_surplus_before' => $sourceSurplusBefore,
                    'target_deficit_before' => $targetDeficitBefore,
                    'priority' => $priority,
                    'priority_score' => $priorityScore,
                    'priority_multiplier' => $targetPriorityMultiplier,
                    'matching_score' => round($bestScore, 5),
                    'existing_route_id' => $existingRoute ? (int)$existingRoute['id'] : null,
                    'existing_route_active' => $existingRoute ? (bool)$existingRoute['is_active'] : false,
                    'reason' => $reason,
                    'reason_details' => $reasonDetails,
                    'target_welfare' => [
                        'food_coverage' => (float)($targetRuntime['welfare']['food_coverage'] ?? 1.0),
                        'energy_balance' => (float)($targetRuntime['welfare']['energy_balance'] ?? 0.0),
                        'happiness' => (int)($targetRuntime['welfare']['happiness'] ?? 70),
                    ],
                ];
            }
        }

        usort($suggestions, function ($a, $b) {
            $scoreCmp = ((float)$b['priority_score']) <=> ((float)$a['priority_score']);
            if ($scoreCmp !== 0) {
                return $scoreCmp;
            }

            return array_sum($b['cargo']) <=> array_sum($a['cargo']);
        });

        return array_slice($suggestions, 0, $limit);
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
    $payload = decode_trade_route_payload($route);
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
                $payload,
            ['reason' => 'trade-route']
        );
        $stmt = $db->prepare('UPDATE trade_routes SET last_dispatch = NOW() WHERE id = ?');
        $stmt->execute([$routeId]);
        $db->commit();
    } catch (Throwable $_) {
        $db->rollBack();
        error_log("dispatch_trade_fleet routeId={$routeId}: " . $_->getMessage());
        return;
    }
}

function load_trade_colony_node(PDO $db, int $colonyId, ?int $userId = null): ?array {
    $sql = <<<SQL
        SELECT c.id, c.user_id, c.name, c.metal, c.crystal, c.deuterium,
                         cb.galaxy_index AS galaxy, cb.system_index AS system_index, cb.position,
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
    $totalCargo = total_trade_cargo_units($cargo);

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
    $payload = normalize_trade_cargo_payload(['cargo' => $cargo]);
    if (!$payload) {
        throw new RuntimeException('Transport payload is empty.');
    }

    $primary = extract_primary_cargo($payload);
    $metal = $primary['metal'];
    $crystal = $primary['crystal'];
    $deuterium = $primary['deuterium'];
    $profile = estimate_trade_transport_profile($origin, $target, $cargo);
    $fuelCost = (float)$profile['fuel_cost_deuterium'];

    reserve_trade_payload_from_origin($db, (int)$origin['id'], $payload, $fuelCost);

    $depTime = date('Y-m-d H:i:s');
    $arrTime = date('Y-m-d H:i:s', time() + (int)$profile['travel_seconds']);
    $shipsJson = json_encode(['cargo_freighter' => 1], JSON_UNESCAPED_SLASHES);

    $originPolar = galactic_polar_from_cartesian((float)$origin['x_ly'], (float)$origin['y_ly'], (float)$origin['z_ly']);
    $targetPolar = galactic_polar_from_cartesian((float)$target['x_ly'], (float)$target['y_ly'], (float)$target['z_ly']);
    $payloadJson = encode_trade_payload_json($payload);

    $stmt = $db->prepare(<<<SQL
        INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium, cargo_payload,
             origin_x_ly, origin_y_ly, origin_z_ly,
             origin_radius_ly, origin_theta_rad, origin_height_ly,
             target_x_ly, target_y_ly, target_z_ly,
             target_radius_ly, target_theta_rad, target_height_ly,
             speed_ly_h, distance_ly, departure_time, arrival_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
        (int)$target['system_index'],
        (int)$target['position'],
        'transport',
        $shipsJson,
        $metal,
        $crystal,
        $deuterium,
        $payloadJson,
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
    foreach ($payload as $resource => $qty) {
        if ($qty > 0) {
            $labelParts[] = ucfirst(str_replace('_', ' ', (string)$resource));
        }
    }

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
        'cargo_payload' => $payload,
    ];
}

function reserve_trade_payload_from_origin(PDO $db, int $originColonyId, array $payload, float $fuelCost): void {
    $stmt = $db->prepare('SELECT metal, crystal, deuterium, rare_earth, food FROM colonies WHERE id = ? FOR UPDATE');
    $stmt->execute([$originColonyId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Origin colony not found.');
    }

    $metalNeed = (float)($payload['metal'] ?? 0.0);
    $crystalNeed = (float)($payload['crystal'] ?? 0.0);
    $deutNeed = (float)($payload['deuterium'] ?? 0.0) + $fuelCost;
    $rareEarthNeed = (float)($payload['rare_earth'] ?? 0.0);
    $foodNeed = (float)($payload['food'] ?? 0.0);

    if ((float)$row['metal'] < $metalNeed
        || (float)$row['crystal'] < $crystalNeed
        || (float)$row['deuterium'] < $deutNeed
        || (float)$row['rare_earth'] < $rareEarthNeed
        || (float)$row['food'] < $foodNeed
    ) {
        throw new RuntimeException('Origin colony cannot cover cargo and freight fuel.');
    }

    $needsFlush = false;
    foreach ($payload as $resource => $qty) {
        if (!in_array($resource, TRADE_COLONY_RESOURCES, true) && max(0.0, (float)$qty) > 0) {
            $needsFlush = true;
            break;
        }
    }
    if ($needsFlush) {
        flush_colony_production($db, $originColonyId);
    }

    foreach ($payload as $resource => $qty) {
        $qty = max(0.0, (float)$qty);
        if ($qty <= 0 || in_array($resource, TRADE_COLONY_RESOURCES, true)) {
            continue;
        }

        $gStmt = $db->prepare('SELECT quantity FROM economy_processed_goods WHERE colony_id = ? AND good_type = ? FOR UPDATE');
        $gStmt->execute([$originColonyId, $resource]);
        $available = (float)($gStmt->fetchColumn() ?: 0.0);
        if ($available < $qty) {
            throw new RuntimeException('Origin colony lacks processed goods: ' . $resource);
        }
    }

    $db->prepare(<<<SQL
        UPDATE colonies
        SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?,
            rare_earth = rare_earth - ?, food = food - ?
        WHERE id = ?
    SQL)->execute([$metalNeed, $crystalNeed, $deutNeed, $rareEarthNeed, $foodNeed, $originColonyId]);

    foreach ($payload as $resource => $qty) {
        $qty = max(0.0, (float)$qty);
        if ($qty <= 0 || in_array($resource, TRADE_COLONY_RESOURCES, true)) {
            continue;
        }

        $db->prepare('UPDATE economy_processed_goods SET quantity = GREATEST(0, quantity - ?) WHERE colony_id = ? AND good_type = ?')
           ->execute([$qty, $originColonyId, $resource]);
    }
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
