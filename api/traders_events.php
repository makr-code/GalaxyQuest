<?php
/**
 * api/traders_events.php - Event-driven Traders System
 * 
 * Trader lifecycle triggered by external events (player actions, game loop, etc)
 * No background daemon - all events explicit and synchronous
 * 
 * Events:
 *   - market_update: Recalculate supply/demand (called every game tick)
 *   - opportunity_scan: Find new trade opportunities (called after market updates)
 *   - trader_decisions: Let traders make autonomous decisions (called after opportunities)
 *   - route_process: Advance all routes through lifecycle (called each game tick)
 *   - route_create: Manually create a trader route
 *   - route_complete: Manually complete a route (for testing)
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/market_analysis.php';

header('Content-Type: application/json; charset=utf-8');

$event = $_GET['event'] ?? $_POST['event'] ?? '';
$uid   = require_auth();
$db    = get_db();

if (!is_admin_user($db, $uid)) {
    json_error('Admin access required.', 403);
}

try {
    match ($event) {
        'market_update'     => event_market_update($db),
        'opportunity_scan'  => event_opportunity_scan($db),
        'trader_decisions'  => event_trader_decisions($db),
        'route_process'     => event_route_process($db),
        'route_create'      => event_route_create($db),
        'route_complete'    => event_route_complete($db),
        'game_tick'         => event_game_tick($db),
        'status'            => event_status($db),
        default => json_error("Unknown event: $event", 400),
    };
} catch (Throwable $e) {
    error_log("traders_events.php error: " . $e->getMessage());
    json_error($e->getMessage(), 500);
}

/**
 * EVENT: market_update
 * POST /api/traders_events.php?event=market_update
 * 
 * Recalculate supply/demand for all systems based on current production/consumption
 */
function event_market_update(PDO $db): never {
    try {
        $t0 = microtime(true);
        
        // Delete outdated entries
        $db->prepare('DELETE FROM market_supply_demand WHERE updated_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)')
           ->execute();
        
        // Recalculate and populate
        update_supply_demand_table($db);
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'event' => 'market_update',
            'status' => 'success',
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        error_log("market_update error: " . $e->getMessage());
        json_error("Market update failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: opportunity_scan
 * POST /api/traders_events.php?event=opportunity_scan
 * 
 * Find and rank profitable trade opportunities
 */
function event_opportunity_scan(PDO $db): never {
    try {
        $t0 = microtime(true);
        
        // Delete expired
        $db->prepare('DELETE FROM trade_opportunities WHERE expires_at < NOW()')->execute();
        
        // Find new opportunities
        $countBefore = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
        find_and_rank_trade_opportunities($db, 15.0);
        $countAfter = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'event' => 'opportunity_scan',
            'status' => 'success',
            'new_opportunities' => max(0, $countAfter - $countBefore),
            'total_opportunities' => $countAfter,
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        error_log("opportunity_scan error: " . $e->getMessage());
        json_error("Opportunity scan failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: trader_decisions
 * POST /api/traders_events.php?event=trader_decisions
 * 
 * Let traders autonomously make decisions based on available opportunities
 */
function event_trader_decisions(PDO $db): never {
    try {
        $t0 = microtime(true);
        
        $decisionsCount = 0;
        
        // Get all traders with capacity
        $traderStmt = $db->prepare(<<<SQL
            SELECT 
                t.id, t.strategy, t.capital_credits, t.max_fleets, t.specialization,
                COUNT(DISTINCT tr.id) as active_routes
            FROM npc_traders t
            LEFT JOIN trader_routes tr ON tr.trader_id = t.id 
                AND tr.status NOT IN ('completed', 'failed')
            GROUP BY t.id
            HAVING t.capital_credits > 5000 AND active_routes < t.max_fleets
            ORDER BY t.capital_credits DESC, RAND()
            LIMIT 20
        SQL);
        $traderStmt->execute();
        
        foreach ($traderStmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {
            try {
                $decided = execute_single_trader_decision($db, $trader);
                if ($decided) $decisionsCount++;
            } catch (Throwable $e) {
                error_log("Trader {$trader['id']} decision error: " . $e->getMessage());
            }
        }
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'event' => 'trader_decisions',
            'status' => 'success',
            'decisions_made' => $decisionsCount,
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        error_log("trader_decisions error: " . $e->getMessage());
        json_error("Trader decisions failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: route_process
 * POST /api/traders_events.php?event=route_process
 * 
 * Advance all routes through their lifecycle one step (PLANNING → ACQUIRING → IN_TRANSIT → DELIVERING → COMPLETED)
 */
function event_route_process(PDO $db): never {
    try {
        $t0 = microtime(true);
        
        $stats = [
            'processed' => 0,
            'completed' => 0,
            'failed' => 0,
            'profit' => 0.0,
        ];
        
        // Get all active routes
        $routesStmt = $db->prepare(<<<SQL
            SELECT 
                tr.id, tr.trader_id, tr.fleet_id,
                tr.source_colony_id, tr.target_colony_id,
                tr.resource_type, tr.status,
                tr.quantity_planned, tr.quantity_acquired, tr.quantity_delivered,
                tr.price_paid, tr.price_sold,
                tr.expected_profit, tr.departure_at, tr.arrival_at,
                f.arrival_time
            FROM trader_routes tr
            LEFT JOIN fleets f ON f.id = tr.fleet_id
            WHERE tr.status IN ('planning', 'acquiring', 'in_transit', 'delivering')
            ORDER BY tr.updated_at ASC
            LIMIT 100
        SQL);
        $routesStmt->execute();
        
        foreach ($routesStmt->fetchAll(PDO::FETCH_ASSOC) as $route) {
            try {
                $route_id = (int)$route['id'];
                
                match ($route['status']) {
                    'planning' => route_transition_planning($db, $route),
                    'acquiring' => route_transition_acquiring($db, $route),
                    'in_transit' => route_transition_transit($db, $route),
                    'delivering' => route_transition_delivering($db, $route),
                    default => null,
                };
                
                $stats['processed']++;
                
                // Check final status
                $final = $db->prepare('SELECT status, actual_profit FROM trader_routes WHERE id = ?');
                $final->execute([$route_id]);
                $finalData = $final->fetch(PDO::FETCH_ASSOC);
                
                if ($finalData['status'] === 'completed') {
                    $stats['completed']++;
                    $stats['profit'] += (float)($finalData['actual_profit'] ?? 0);
                } elseif ($finalData['status'] === 'failed') {
                    $stats['failed']++;
                }
                
            } catch (Throwable $e) {
                error_log("Route {$route['id']} transition error: " . $e->getMessage());
                $stats['failed']++;
                $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')
                   ->execute(['failed', (int)$route['id']]);
            }
        }
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'event' => 'route_process',
            'status' => 'success',
            'stats' => $stats,
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        error_log("route_process error: " . $e->getMessage());
        json_error("Route processing failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: route_create (Manual)
 * POST /api/traders_events.php?event=route_create
 * Body: {trader_id, source_colony_id, target_colony_id, resource_type, quantity}
 */
function event_route_create(PDO $db): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    
    $traderId = (int)($body['trader_id'] ?? 0);
    $srcColId = (int)($body['source_colony_id'] ?? 0);
    $tgtColId = (int)($body['target_colony_id'] ?? 0);
    $resourceType = (string)($body['resource_type'] ?? '');
    $qty = (float)($body['quantity'] ?? 0);
    
    if (!$traderId || !$srcColId || !$tgtColId || !$resourceType || $qty <= 0) {
        json_error('Missing or invalid parameters', 400);
    }
    
    try {
        $routeStmt = $db->prepare(<<<SQL
            INSERT INTO trader_routes
            (trader_id, source_colony_id, target_colony_id, resource_type, quantity_planned, status)
            VALUES (?, ?, ?, ?, ?, 'planning')
        SQL);
        $routeStmt->execute([$traderId, $srcColId, $tgtColId, $resourceType, $qty]);
        
        $routeId = (int)$db->lastInsertId();
        
        json_ok([
            'event' => 'route_create',
            'status' => 'success',
            'route_id' => $routeId,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        json_error("Route creation failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: route_complete (Testing only)
 * POST /api/traders_events.php?event=route_complete
 * Body: {route_id, completed}
 */
function event_route_complete(PDO $db): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $routeId = (int)($body['route_id'] ?? 0);
    
    if (!$routeId) {
        json_error('route_id required', 400);
    }
    
    try {
        $route = $db->prepare('SELECT * FROM trader_routes WHERE id = ?');
        $route->execute([$routeId]);
        $routeData = $route->fetch(PDO::FETCH_ASSOC);
        
        if (!$routeData) {
            json_error("Route not found", 404);
        }
        
        // Complete the route
        $profit = ((float)$routeData['quantity_acquired'] ?? 0) * 50; // Random profit for test
        
        $db->prepare(<<<SQL
            UPDATE trader_routes
            SET status = 'completed',
                quantity_delivered = quantity_acquired,
                price_sold = 100.0,
                actual_profit = ?,
                delivered_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
        SQL)->execute([$profit, $routeId]);
        
        // Update trader capital
        $db->prepare('UPDATE npc_traders SET total_profit = total_profit + ? WHERE id = ?')
           ->execute([$profit, $routeData['trader_id']]);
        
        json_ok([
            'event' => 'route_complete',
            'status' => 'success',
            'route_id' => $routeId,
            'profit' => $profit,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        json_error("Route completion failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: game_tick (Full Cycle)
 * POST /api/traders_events.php?event=game_tick
 * 
 * Called once per game tick - orchestrates all sub-events
 */
function event_game_tick(PDO $db): never {
    try {
        $t0 = microtime(true);
        
        // Run all events in sequence
        $db->beginTransaction();
        
        update_supply_demand_table($db);
        find_and_rank_trade_opportunities($db, 15.0);
        
        $decisionsCount = 0;
        $traderStmt = $db->prepare(<<<SQL
            SELECT t.id, t.strategy, t.capital_credits, t.max_fleets, t.specialization,
                   COUNT(DISTINCT tr.id) as active_routes
            FROM npc_traders t
            LEFT JOIN trader_routes tr ON tr.trader_id = t.id 
                AND tr.status NOT IN ('completed', 'failed')
            GROUP BY t.id
            HAVING t.capital_credits > 5000 AND active_routes < t.max_fleets
        SQL);
        $traderStmt->execute();
        
        foreach ($traderStmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {
            if (execute_single_trader_decision($db, $trader)) {
                $decisionsCount++;
            }
        }
        
        // Process routes
        $routesStmt = $db->query(<<<SQL
            SELECT tr.id, tr.status, tr.trader_id, tr.fleet_id, tr.source_colony_id, tr.target_colony_id,
                   tr.resource_type, tr.quantity_planned, tr.quantity_acquired, tr.price_paid,
                   f.arrival_time
            FROM trader_routes tr
            LEFT JOIN fleets f ON f.id = tr.fleet_id
            WHERE tr.status IN ('planning', 'acquiring', 'in_transit', 'delivering')
            LIMIT 50
        SQL);
        
        $routesProcessed = 0;
        foreach ($routesStmt->fetchAll(PDO::FETCH_ASSOC) as $route) {
            try {
                match ($route['status']) {
                    'planning' => route_transition_planning($db, $route),
                    'acquiring' => route_transition_acquiring($db, $route),
                    'in_transit' => route_transition_transit($db, $route),
                    'delivering' => route_transition_delivering($db, $route),
                    default => null,
                };
                $routesProcessed++;
            } catch (Throwable $e) {
                error_log("Route {$route['id']} error: " . $e->getMessage());
            }
        }
        
        $db->commit();
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'event' => 'game_tick',
            'status' => 'success',
            'decisions' => $decisionsCount,
            'routes_processed' => $routesProcessed,
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log("game_tick error: " . $e->getMessage());
        json_error("Game tick failed: " . $e->getMessage(), 500);
    }
}

/**
 * EVENT: status (Get System Status)
 * GET /api/traders_events.php?event=status
 */
function event_status(PDO $db): never {
    $traders = (int)$db->query('SELECT COUNT(*) FROM npc_traders')->fetchColumn();
    $routes = (int)$db->query('SELECT COUNT(*) FROM trader_routes')->fetchColumn();
    $activeRoutes = (int)$db->query('SELECT COUNT(*) FROM trader_routes WHERE status NOT IN ("completed", "failed")')->fetchColumn();
    $opps = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities WHERE expires_at > NOW()')->fetchColumn();
    
    $totalProfit = $db->query('SELECT SUM(actual_profit) FROM trader_routes WHERE status = "completed"')->fetchColumn();
    
    json_ok([
        'event' => 'status',
        'traders' => $traders,
        'routes' => [
            'total' => $routes,
            'active' => $activeRoutes,
        ],
        'opportunities' => $opps,
        'total_profit' => (float)($totalProfit ?? 0),
        'timestamp' => date('Y-m-d H:i:s'),
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────────────────

function execute_single_trader_decision(PDO $db, array $trader): bool {
    $minMargin = match ($trader['strategy']) {
        'profit_max'  => 20.0,
        'volume'      => 5.0,
        'stabilize'   => 10.0,
        default       => 15.0,
    };
    
    $oppStmt = $db->prepare(<<<SQL
        SELECT id, source_system, target_system, resource_type,
               source_price, target_price, actual_qty, net_profit_per_unit
        FROM trade_opportunities
        WHERE profit_margin >= ? AND expires_at > NOW()
            AND (? = '' OR resource_type = ?)
        ORDER BY
            CASE WHEN ? = 'profit_max' THEN net_profit_per_unit * actual_qty ELSE 0 END DESC,
            CASE WHEN ? = 'volume' THEN actual_qty ELSE 0 END DESC,
            confidence DESC,
            RAND()
        LIMIT 1
    SQL);
    $oppStmt->execute([$minMargin, $trader['specialization'], $trader['specialization'],
                       $trader['strategy'], $trader['strategy']]);
    
    if (!$opp = $oppStmt->fetch(PDO::FETCH_ASSOC)) {
        return false;
    }
    
    // Get source/target colonies
    $srcCol = $db->prepare('SELECT MIN(id) as id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE cb.system_index = ?');
    $srcCol->execute([(int)$opp['source_system']]);
    $srcColId = $srcCol->fetchColumn();
    
    $tgtCol = $db->prepare('SELECT MIN(id) as id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE cb.system_index = ?');
    $tgtCol->execute([(int)$opp['target_system']]);
    $tgtColId = $tgtCol->fetchColumn();
    
    if (!$srcColId || !$tgtColId) {
        return false;
    }
    
    $maxAffordable = (int)floor($trader['capital_credits'] / ((float)$opp['source_price'] + 10));
    $qty = (int)min((float)$opp['actual_qty'], $maxAffordable);
    
    if ($qty <= 0) {
        return false;
    }
    
    $routeStmt = $db->prepare(<<<SQL
        INSERT INTO trader_routes (trader_id, source_colony_id, target_colony_id, resource_type,
                                   quantity_planned, expected_profit, status)
        VALUES (?, ?, ?, ?, ?, ?, 'planning')
    SQL);
    $routeStmt->execute([
        $trader['id'], $srcColId, $tgtColId, $opp['resource_type'],
        $qty, $qty * (float)$opp['net_profit_per_unit'] * 0.9
    ]);
    
    return true;
}

function route_transition_planning(PDO $db, array $route): void {
    // PLANNING → ACQUIRING: Acquire goods from source
    $routeId = (int)$route['id'];
    $sourceColId = (int)$route['source_colony_id'];
    $resourceType = (string)$route['resource_type'];
    $qtyPlanned = (float)$route['quantity_planned'];
    $traderId = (int)$route['trader_id'];
    
    $trader = $db->prepare('SELECT capital_credits FROM npc_traders WHERE id = ?');
    $trader->execute([$traderId]);
    $traderCap = (float)($trader->fetchColumn() ?? 0);
    
    if ($traderCap <= 0) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')->execute(['failed', $routeId]);
        return;
    }
    
    // Get available inventory
    $sysStmt = $db->prepare('
        SELECT cb.galaxy_index, ss.system_index
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
        WHERE c.id = ? LIMIT 1
    ');
    $sysStmt->execute([$sourceColId]);
    [$galaxy, $system] = $sysStmt->fetch(PDO::FETCH_NUM) ?: [1, 0];
    
    $pricePerUnit = compute_system_price($db, (int)$galaxy, (int)$system, $resourceType);
    
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'], true)) {
        $colStmt = $db->prepare("SELECT $resourceType as qty FROM colonies WHERE id = ?");
        $colStmt->execute([$sourceColId]);
        $available = (float)($colStmt->fetchColumn() ?: 0);
    } else {
        flush_colony_production($db, $sourceColId);
        $colStmt = $db->prepare('SELECT quantity FROM economy_processed_goods WHERE colony_id = ? AND good_type = ?');
        $colStmt->execute([$sourceColId, $resourceType]);
        $available = (float)($colStmt->fetchColumn() ?: 0);
    }
    
    $canAfford = (int)floor($traderCap / $pricePerUnit);
    $acquired = (int)min($qtyPlanned, $available, $canAfford);
    
    if ($acquired <= 0) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')->execute(['failed', $routeId]);
        return;
    }
    
    // Deduct inventory and capital
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'], true)) {
        $db->prepare("UPDATE colonies SET $resourceType = $resourceType - ? WHERE id = ?")
           ->execute([$acquired, $sourceColId]);
    } else {
        $db->prepare('UPDATE economy_processed_goods SET quantity = quantity - ? WHERE colony_id = ? AND good_type = ?')
           ->execute([$acquired, $sourceColId, $resourceType]);
    }
    $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits - ? WHERE id = ?')
       ->execute([$acquired * $pricePerUnit, $traderId]);
    
    // Log transaction
    $db->prepare('INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits)
                 VALUES (?, ?, "bought", ?, ?, ?, ?)')
       ->execute([$traderId, $routeId, $resourceType, $acquired, $pricePerUnit, $acquired * $pricePerUnit]);
    
    // Transition to ACQUIRING
    $db->prepare('UPDATE trader_routes SET status = ?, quantity_acquired = ?, price_paid = ?, updated_at = NOW() WHERE id = ?')
       ->execute(['acquiring', $acquired, $pricePerUnit, $routeId]);
}

function route_transition_acquiring(PDO $db, array $route): void {
    // ACQUIRING → IN_TRANSIT: Create fleet with cargo
    $routeId = (int)$route['id'];
    $traderId = (int)$route['trader_id'];
    $sourceColId = (int)$route['source_colony_id'];
    $targetColId = (int)$route['target_colony_id'];
    $acquired = (float)$route['quantity_acquired'];
    
    if (!$acquired || $acquired <= 0) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')->execute(['failed', $routeId]);
        return;
    }
    
    // Get trader user
    $traderUser = $db->prepare('SELECT user_id FROM npc_traders WHERE id = ?');
    $traderUser->execute([$traderId]);
    $userId = (int)$traderUser->fetchColumn();
    
    if (!$userId) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')->execute(['failed', $routeId]);
        return;
    }
    
    // Create fleet
    $fleetStmt = $db->prepare(<<<SQL
        INSERT INTO fleets 
        (user_id, origin_colony_id, target_galaxy, target_system, target_position,
         mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
         origin_x_ly, origin_y_ly, origin_z_ly,
         target_x_ly, target_y_ly, target_z_ly,
         speed_ly_h, distance_ly,
         departure_time, arrival_time)
        SELECT 
            ?, ?, cb_tgt.galaxy_index, cb_tgt.system_index, cb_tgt.position,
            'transport', '{}',
            CASE WHEN ? = 'metal' THEN ? ELSE 0 END,
            CASE WHEN ? = 'crystal' THEN ? ELSE 0 END,
            CASE WHEN ? = 'deuterium' THEN ? ELSE 0 END,
            COALESCE(ss_src.x_ly, 0), COALESCE(ss_src.y_ly, 0), COALESCE(ss_src.z_ly, 0),
            COALESCE(ss_tgt.x_ly, 0), COALESCE(ss_tgt.y_ly, 0), COALESCE(ss_tgt.z_ly, 0),
            100.0, 50.0,
            NOW(), DATE_ADD(NOW(), INTERVAL 300 MINUTE)
        FROM colonies c_src
        JOIN celestial_bodies cb_src ON cb_src.id = c_src.body_id
        JOIN star_systems ss_src ON ss_src.galaxy_index = cb_src.galaxy_index AND ss_src.system_index = cb_src.system_index
        JOIN colonies c_tgt ON c_tgt.id = ?
        JOIN celestial_bodies cb_tgt ON cb_tgt.id = c_tgt.body_id
        JOIN star_systems ss_tgt ON ss_tgt.galaxy_index = cb_tgt.galaxy_index AND ss_tgt.system_index = cb_tgt.system_index
        WHERE c_src.id = ?
    SQL);
    $fleetStmt->execute([
        $userId,
        $sourceColId,
        $route['resource_type'],
        $acquired,
        $route['resource_type'],
        $acquired,
        $route['resource_type'],
        $acquired,
        $targetColId,
        $sourceColId,
    ]);
    $fleetId = (int)$db->lastInsertId();
    
    // Link fleet to route and transition
    $db->prepare('UPDATE trader_routes SET fleet_id = ?, status = ?, departure_at = NOW(), updated_at = NOW() WHERE id = ?')
       ->execute([$fleetId, 'in_transit', $routeId]);
}

function route_transition_transit(PDO $db, array $route): void {
    // IN_TRANSIT → DELIVERING: Check fleet arrival
    $routeId = (int)$route['id'];
    $fleetId = (int)($route['fleet_id'] ?: 0);
    
    if (!$fleetId) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')->execute(['failed', $routeId]);
        return;
    }
    
    // Check if arrived
    $fleet = $db->prepare('SELECT arrival_time FROM fleets WHERE id = ? AND arrival_time <= NOW()');
    $fleet->execute([$fleetId]);
    
    if (!$fleet->fetch()) {
        return; // Not yet arrived
    }
    
    // Delete fleet and transition route
    $db->prepare('DELETE FROM fleets WHERE id = ?')->execute([$fleetId]);
    $db->prepare('UPDATE trader_routes SET status = ?, arrival_at = NOW(), updated_at = NOW() WHERE id = ?')
       ->execute(['delivering', $routeId]);
}

function route_transition_delivering(PDO $db, array $route): void {
    // DELIVERING → COMPLETED: Execute sale
    $routeId = (int)$route['id'];
    $traderId = (int)$route['trader_id'];
    $targetColId = (int)$route['target_colony_id'];
    $resourceType = (string)$route['resource_type'];
    $acquired = (float)$route['quantity_acquired'];
    $pricePaid = (float)$route['price_paid'];
    
    // Get target system price
    $tgtSys = $db->prepare('
        SELECT cb.galaxy_index, ss.system_index
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
        WHERE c.id = ? LIMIT 1
    ');
    $tgtSys->execute([$targetColId]);
    [$tgtGalaxy, $tgtSystem] = $tgtSys->fetch(PDO::FETCH_NUM) ?: [1, 0];
    
    $priceSold = compute_system_price($db, (int)$tgtGalaxy, (int)$tgtSystem, $resourceType);
    
    // Deliver goods to colony
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'], true)) {
        $db->prepare("UPDATE colonies SET $resourceType = $resourceType + ? WHERE id = ?")
           ->execute([$acquired, $targetColId]);
    } else {
        $db->prepare(<<<SQL
            INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
            VALUES (?, ?, ?, 5000.0)
            ON DUPLICATE KEY UPDATE quantity = quantity + ?
        SQL)->execute([$targetColId, $resourceType, $acquired, $acquired]);
    }
    
    $revenueTotal = $acquired * $priceSold;
    $profit = $revenueTotal - ($acquired * $pricePaid);
    
    // Credit trader
    $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits + ?, total_profit = total_profit + ? WHERE id = ?')
       ->execute([$revenueTotal, $profit, $traderId]);
    
    // Log transaction
    $db->prepare('INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits)
                 VALUES (?, ?, "sold", ?, ?, ?, ?)')
       ->execute([$traderId, $routeId, $resourceType, $acquired, $priceSold, $revenueTotal]);
    
    // Complete route
    $db->prepare(<<<SQL
        UPDATE trader_routes 
        SET status = 'completed',
            quantity_delivered = ?,
            price_sold = ?,
            actual_profit = ?,
            delivered_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
    SQL)->execute([$acquired, $priceSold, $profit, $routeId]);

    $db->prepare('UPDATE npc_traders SET active_fleets = GREATEST(0, active_fleets - 1) WHERE id = ?')
       ->execute([$traderId]);
}
