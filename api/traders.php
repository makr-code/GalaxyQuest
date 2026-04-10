<?php
/**
 * api/traders.php — NPC Traders System
 * 
 * Handles supply/demand analysis, trade opportunity detection,
 * and autonomous NPC trader management.
 * 
 * Actions:
 *   list_opportunities      — Available trade routes by profit margin
 *   list_traders            — Active NPC traders + statistics
 *   list_routes             — Current trader routes with status
 *   market_analysis         — Supply/demand for a system
 *   process_trader_tick     — Execute periodic trader actions
 *   create_trader           — (Admin) Start new NPC trader
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/market_analysis.php';

// When included as a library (e.g. from npc_ai.php), skip HTTP dispatch.
if (!defined('TRADERS_LIB_MODE')) {
    header('Content-Type: application/json; charset=utf-8');

    $action = $_GET['action'] ?? '';
    $uid    = require_auth();
    $db     = get_db();

    try {
        match ($action) {
            'list_opportunities'   => action_list_opportunities($db),
            'list_traders'         => action_list_traders($db),
            'list_routes'          => action_list_routes($db),
            'market_analysis'      => action_market_analysis($db),
            'process_trader_tick'  => action_process_trader_tick($db),
            'create_trader'        => action_create_trader($db),
            default => json_error("Unknown action: $action", 400),
        };
    } catch (Throwable $e) {
        error_log("traders.php error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/traders.php?action=list_opportunities&min_margin=15&limit=20
 * 
 * Returns ranked list of profitable trade opportunities.
 */
function action_list_opportunities(PDO $db): never {
    $minMargin = (float)($_GET['min_margin'] ?? 10);  // minimum 10% profit
    $limit     = (int)($_GET['limit'] ?? 50);
    
    $stmt = $db->prepare(<<<SQL
        SELECT 
            id, source_system, target_system, resource_type,
            source_price, target_price, profit_margin,
            available_qty, demand_qty, actual_qty,
            net_profit_per_unit, confidence,
            TIMESTAMPDIFF(MINUTE, NOW(), expires_at) as minutes_remaining
        FROM trade_opportunities
        WHERE profit_margin >= ? AND expires_at > NOW()
        ORDER BY profit_margin DESC, confidence DESC
        LIMIT ?
    SQL);
    $stmt->execute([$minMargin, $limit]);
    
    $opportunities = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $opp) {
        $opportunities[] = [
            'id'                  => (int)$opp['id'],
            'source_system'       => (int)$opp['source_system'],
            'target_system'       => (int)$opp['target_system'],
            'resource_type'       => (string)$opp['resource_type'],
            'source_price'        => (float)$opp['source_price'],
            'target_price'        => (float)$opp['target_price'],
            'profit_margin_pct'   => (float)$opp['profit_margin'],
            'available_qty'       => (float)$opp['available_qty'],
            'demand_qty'          => (float)$opp['demand_qty'],
            'trade_qty'           => (float)$opp['actual_qty'],
            'profit_per_unit'     => (float)$opp['net_profit_per_unit'],
            'total_profit_est'    => (float)$opp['actual_qty'] * (float)$opp['net_profit_per_unit'],
            'confidence'          => (float)$opp['confidence'],
            'minutes_remaining'   => (int)$opp['minutes_remaining'],
        ];
    }
    
    json_ok([
        'count'            => count($opportunities),
        'opportunities'    => $opportunities,
        'min_margin_pct'   => $minMargin,
    ]);
}

/**
 * GET /api/traders.php?action=list_traders
 * 
 * Returns all active NPC traders with profitability stats.
 */
function action_list_traders(PDO $db): never {
    $stmt = $db->prepare(<<<SQL
        SELECT 
            t.id, t.faction_id, t.name, t.base_colony_id,
            t.capital_credits, t.total_profit, t.active_fleets, t.max_fleets,
            t.strategy, t.specialization,
            nf.name as faction_name,
            COUNT(DISTINCT tr.fleet_id) as active_routes,
            SUM(IF(tr.actual_profit IS NOT NULL, tr.actual_profit, 0)) as sessions_profit
        FROM npc_traders t
        LEFT JOIN npc_factions nf ON nf.id = t.faction_id
        LEFT JOIN trader_routes tr ON tr.trader_id = t.id
        GROUP BY t.id
        ORDER BY t.total_profit DESC
    SQL);
    $stmt->execute();
    
    $traders = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {
        $traders[] = [
            'id'                => (int)$trader['id'],
            'faction_id'        => (int)$trader['faction_id'],
            'faction_name'      => (string)$trader['faction_name'],
            'name'              => (string)$trader['name'],
            'base_colony_id'    => (int)$trader['base_colony_id'],
            'capital_credits'   => (float)$trader['capital_credits'],
            'total_profit'      => (float)$trader['total_profit'],
            'active_fleets'     => (int)$trader['active_fleets'],
            'max_fleets'        => (int)$trader['max_fleets'],
            'strategy'          => (string)$trader['strategy'],
            'specialization'    => (string)$trader['specialization'] ?? 'none',
            'active_routes'     => (int)$trader['active_routes'],
            'session_profit'    => (float)$trader['sessions_profit'],
        ];
    }
    
    json_ok([
        'traders' => $traders,
        'count'   => count($traders),
    ]);
}

/**
 * GET /api/traders.php?action=list_routes&status=in_transit
 * 
 * Returns current trader routes with status and progress.
 */
function action_list_routes(PDO $db): never {
    $status = $_GET['status'] ?? null;
    
    $query = <<<SQL
        SELECT 
            tr.id, tr.trader_id, tr.fleet_id,
            tr.source_colony_id, tr.target_colony_id,
            tr.resource_type, tr.status,
            tr.quantity_planned, tr.quantity_acquired, tr.quantity_delivered,
            tr.price_paid, tr.price_sold,
            tr.expected_profit, tr.actual_profit,
            tr.departure_at, tr.arrival_at, tr.delivered_at,
            sc.name as source_colony, tc.name as target_colony,
            scb.galaxy_index as source_galaxy_index,
            scb.system_index as source_system_index,
            tcb.galaxy_index as target_galaxy_index,
            tcb.system_index as target_system_index,
            nt.name as trader_name,
            f.id as fleet_id, f.distance_ly
        FROM trader_routes tr
        JOIN colonies sc ON sc.id = tr.source_colony_id
        JOIN colonies tc ON tc.id = tr.target_colony_id
        JOIN celestial_bodies scb ON scb.id = sc.body_id
        JOIN celestial_bodies tcb ON tcb.id = tc.body_id
        JOIN npc_traders nt ON nt.id = tr.trader_id
        LEFT JOIN fleets f ON f.id = tr.fleet_id
        WHERE 1=1
    SQL;
    
    $params = [];
    if ($status) {
        $query .= ' AND tr.status = ?';
        $params[] = $status;
    }
    
    $query .= ' ORDER BY tr.updated_at DESC LIMIT 100';
    
    $stmt = $db->prepare($query);
    $stmt->execute($params);
    
    $routes = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $route) {
        $statusValue = (string)$route['status'];
        $isActive = !in_array($statusValue, ['completed', 'failed'], true);

        $routes[] = [
            'id'                => (int)$route['id'],
            'trader_id'         => (int)$route['trader_id'],
            'trader_name'       => (string)$route['trader_name'],
            'fleet_id'          => (int)$route['fleet_id'],
            'origin'            => [
                'galaxy' => (int)$route['source_galaxy_index'],
                'system' => (int)$route['source_system_index'],
            ],
            'target'            => [
                'galaxy' => (int)$route['target_galaxy_index'],
                'system' => (int)$route['target_system_index'],
            ],
            'interval_hours'    => 12,
            'is_active'         => $isActive,
            'is_due'            => $statusValue === 'planning' || $statusValue === 'delivering',
            'source_colony'     => (string)$route['source_colony'],
            'target_colony'     => (string)$route['target_colony'],
            'resource_type'     => (string)$route['resource_type'],
            'status'            => $statusValue,
            'quantity'          => [
                'planned'   => (float)$route['quantity_planned'],
                'acquired'  => (float)$route['quantity_acquired'],
                'delivered' => (float)$route['quantity_delivered'],
            ],
            'prices'            => [
                'paid'      => (float)$route['price_paid'],
                'sold'      => (float)$route['price_sold'],
            ],
            'profit'            => [
                'expected'  => (float)$route['expected_profit'],
                'actual'    => $route['actual_profit'] ? (float)$route['actual_profit'] : null,
            ],
            'timeline'          => [
                'departure'  => $route['departure_at'],
                'arrival'    => $route['arrival_at'],
                'delivered'  => $route['delivered_at'],
            ],
            'distance_ly'       => $route['distance_ly'] ? (float)$route['distance_ly'] : null,
        ];
    }
    
    json_ok([
        'routes' => $routes,
        'count'  => count($routes),
    ]);
}

/**
 * GET /api/traders.php?action=market_analysis&system=1
 * 
 * Returns supply/demand analysis for a system.
 */
function action_market_analysis(PDO $db): never {
    $system = (int)($_GET['system'] ?? 1);
    $galaxy = (int)($_GET['galaxy'] ?? 1);
    
    $stmt = $db->prepare(<<<SQL
        SELECT 
            resource_type,
            production_per_hour, consumption_per_hour,
            available_supply, desired_demand,
            net_balance,
            updated_at
        FROM market_supply_demand
        WHERE galaxy_index = ? AND system_index = ?
        ORDER BY ABS(net_balance) DESC
    SQL);
    $stmt->execute([$galaxy, $system]);
    
    $analysis = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $prod    = (float)$row['production_per_hour'];
        $cons    = (float)$row['consumption_per_hour'];
        $supply  = (float)$row['available_supply'];
        $demand  = (float)$row['desired_demand'];
        $balance = (float)$row['net_balance'];
        
        $analysis[] = [
            'resource_type'   => (string)$row['resource_type'],
            'production'      => $prod,
            'consumption'     => $cons,
            'net_production'  => $prod - $cons,
            'available'       => $supply,
            'demanded'        => $demand,
            'net_balance'     => $balance,
            'status'          => $balance > 0 ? 'surplus' : ($balance < 0 ? 'deficit' : 'balanced'),
            'updated_at'      => (string)$row['updated_at'],
        ];
    }
    
    json_ok([
        'system'        => $system,
        'galaxy'        => $galaxy,
        'resources'     => $analysis,
        'count'         => count($analysis),
    ]);
}

/**
 * POST /api/traders.php?action=process_trader_tick
 * 
 * Execute periodic trader actions (transitions, acquisitions, deliveries).
 * Called periodically via background job.
 */
function action_process_trader_tick(PDO $db): never {
    try {
        $db->beginTransaction();
        
        $stats = [
            'routes_processed' => 0,
            'routes_completed' => 0,
            'routes_failed' => 0,
            'new_opportunities' => 0,
            'traders_made_decisions' => 0,
            'total_profit_generated' => 0.0,
            'duration_ms' => 0,
        ];
        
        $t0 = microtime(true);
        
        // 1. Advance routes through their lifecycle
        $transitionStats = process_route_transitions($db);
        $stats = array_merge($stats, $transitionStats);
        
        // 2. Recalculate supply/demand
        recalculate_supply_demand($db);
        
        // 3. Find and update trade opportunities
        $newOpps = find_and_rank_opportunities($db);
        $stats['new_opportunities'] = $newOpps;
        
        // 4. Let traders make decisions (acquire new routes if profitable)
        $decisions = execute_trader_decisions($db);
        $stats['traders_made_decisions'] = $decisions;
        
        $db->commit();
        
        $stats['duration_ms'] = (int)((microtime(true) - $t0) * 1000);
        
        json_ok([
            'status' => 'ok',
            'message' => 'Trader tick completed',
            'timestamp' => date('Y-m-d H:i:s'),
            'stats' => $stats,
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log("trader_tick error: " . $e->getMessage());
        json_error("Trader tick failed: " . $e->getMessage(), 500);
    }
}

/**
 * POST /api/traders.php?action=create_trader (Admin only)
 * 
 * Initialize a new NPC trader for a faction.
 */
function action_create_trader(PDO $db): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $faction_id = (int)($body['faction_id'] ?? 0);
    $base_colony_id = (int)($body['base_colony_id'] ?? 0);
    
    if ($faction_id <= 0 || $base_colony_id <= 0) {
        json_error('faction_id and base_colony_id required', 400);
    }
    
    // Create NPC user for trader if not exists
    $userStmt = $db->prepare(
        'SELECT id FROM users WHERE username = ? LIMIT 1'
    );
    $userStmt->execute(['trader_bot_faction_' . $faction_id]);
    $trader_uid = $userStmt->fetchColumn();
    
    if (!$trader_uid) {
        $trader_uid = create_trader_bot_user($db, $faction_id);
    }
    
    $trader_name = 'Trader-' . uniqid('T');
    
    $stmt = $db->prepare(<<<SQL
        INSERT INTO npc_traders 
        (faction_id, name, user_id, base_colony_id, capital_credits, strategy)
        VALUES (?, ?, ?, ?, ?, 'profit_max')
    SQL);
    $stmt->execute([$faction_id, $trader_name, $trader_uid, $base_colony_id]);
    
    $trader_id = (int)$db->lastInsertId();
    
    json_ok([
        'trader_id' => $trader_id,
        'name'      => $trader_name,
        'base_colony_id' => $base_colony_id,
        'faction_id' => $faction_id,
        'message' => 'Trader created',
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a bot NPC user for trader operations.
 */
function create_trader_bot_user(PDO $db, int $faction_id): int {
    $faction_code = $db->prepare('SELECT code FROM npc_factions WHERE id = ?');
    $faction_code->execute([$faction_id]);
    $code = $faction_code->fetchColumn() ?: 'unknown';
    
    $username = 'bot_trader_' . $code . '_' . uniqid();
    $email    = $username . '@bots.local';
    $password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
    
    $stmt = $db->prepare(<<<SQL
        INSERT INTO users 
        (username, email, password_hash, control_type, auth_enabled, created_at)
        VALUES (?, ?, ?, 'npc_engine', 0, NOW())
    SQL);
    $stmt->execute([$username, $email, $password]);
    
    return (int)$db->lastInsertId();
}

/**
 * Advance trader routes through their lifecycle:
 *   planning → acquiring → in_transit → delivering → completed
 * 
 * State machine logic:
 *  1. planning: Try to acquire goods from source. If successful, move to acquiring.
 *  2. acquiring: Once enough acquired, create fleet and move to in_transit.
 *  3. in_transit: Wait for fleet to arrive, then move to delivering.
 *  4. delivering: Execute sale at destination, calculate profit, mark completed.
 */
function process_route_transitions(PDO $db): array {
    $stats = [
        'routes_processed' => 0,
        'routes_completed' => 0,
        'routes_failed' => 0,
        'total_profit_generated' => 0.0,
    ];
    
    // Get all active routes (not completed/failed)
    $routesStmt = $db->prepare(<<<SQL
        SELECT 
            tr.id, tr.trader_id, tr.fleet_id,
            tr.source_colony_id, tr.target_colony_id,
            tr.resource_type, tr.status,
            tr.quantity_planned, tr.quantity_acquired, tr.quantity_delivered,
            tr.price_paid, tr.price_sold,
            tr.expected_profit, tr.departure_at, tr.arrival_at,
            f.arrival_time as fleet_arrival,
            nt.capital_credits, nt.total_profit
        FROM trader_routes tr
        JOIN npc_traders nt ON nt.id = tr.trader_id
        LEFT JOIN fleets f ON f.id = tr.fleet_id
        WHERE tr.status IN ('planning', 'acquiring', 'in_transit', 'delivering')
        ORDER BY tr.updated_at ASC
    SQL);
    $routesStmt->execute();
    $routes = $routesStmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($routes as $route) {
        try {
            $stats['routes_processed']++;
            process_single_route_transition($db, $route);

            $finalStmt = $db->prepare('SELECT status, actual_profit FROM trader_routes WHERE id = ?');
            $finalStmt->execute([(int)$route['id']]);
            $final = $finalStmt->fetch(PDO::FETCH_ASSOC) ?: [];

            if (($final['status'] ?? '') === 'completed') {
                $stats['routes_completed']++;
                $stats['total_profit_generated'] += (float)($final['actual_profit'] ?? 0);
            } elseif (($final['status'] ?? '') === 'failed') {
                $stats['routes_failed']++;
            }
        } catch (Throwable $e) {
            error_log("Route transition error #{$route['id']}: " . $e->getMessage());
            // Mark route as failed and continue
            $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')
               ->execute(['failed', (int)$route['id']]);
            $db->prepare('UPDATE npc_traders SET active_fleets = GREATEST(0, active_fleets - 1) WHERE id = ?')
               ->execute([(int)$route['trader_id']]);
            $stats['routes_failed']++;
        }
    }

    return $stats;
}

/**
 * Process a single route's state transition.
 */
function process_single_route_transition(PDO $db, array $route): void {
    $routeId = (int)$route['id'];
    $status  = (string)$route['status'];
    $traderId = (int)$route['trader_id'];
    
    match ($status) {
        'planning'   => transition_planning_to_acquiring($db, $route),
        'acquiring'  => transition_acquiring_to_transit($db, $route),
        'in_transit' => transition_transit_to_delivering($db, $route),
        'delivering' => transition_delivering_to_completed($db, $route),
    };
}

/**
 * PLANNING → ACQUIRING: Buy goods from source colony.
 */
function transition_planning_to_acquiring(PDO $db, array $route): void {
    $routeId = (int)$route['id'];
    $traderId = (int)$route['trader_id'];
    $sourceColId = (int)$route['source_colony_id'];
    $resourceType = (string)$route['resource_type'];
    $qtyPlanned = (float)$route['quantity_planned'];
    $traderCap = (float)$route['capital_credits'];
    
    // Get available inventory at source
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'])) {
        // Primary resource
        $colStmt = $db->prepare(
            "SELECT $resourceType as qty FROM colonies WHERE id = ?"
        );
        $colStmt->execute([$sourceColId]);
        $available = (float)($colStmt->fetchColumn() ?: 0);
    } else {
        // Processed good — flush lazy accumulation first so stock is accurate
        flush_colony_production($db, $sourceColId);
        $colStmt = $db->prepare(
            'SELECT quantity FROM economy_processed_goods WHERE colony_id = ? AND good_type = ?'
        );
        $colStmt->execute([$sourceColId, $resourceType]);
        $available = (float)($colStmt->fetchColumn() ?: 0);
    }
    
    // Acquire as much as possible (capped by availability and capital)
    $sysStmt = $db->prepare(<<<SQL
        SELECT cb.galaxy_index, ss.system_index
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
        WHERE c.id = ?
        LIMIT 1
    SQL);
    $sysStmt->execute([$sourceColId]);
    [$galaxy, $system] = $sysStmt->fetch(PDO::FETCH_NUM) ?: [1, 0];
    $pricePerUnit = compute_system_price($db, (int)$galaxy, (int)$system, $resourceType);
    $canAfford = (int)floor($traderCap / $pricePerUnit);
    $acquired = (int)min($qtyPlanned, $available, $canAfford);
    
    if ($acquired <= 0) {
        // Can't afford or nothing available → mark failed
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')
           ->execute(['failed', $routeId]);
        return;
    }
    
    // Deduct from source colony inventory
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'])) {
        $db->prepare("UPDATE colonies SET $resourceType = $resourceType - ? WHERE id = ?")
           ->execute([$acquired, $sourceColId]);
    } else {
        $db->prepare('UPDATE economy_processed_goods SET quantity = quantity - ? WHERE colony_id = ? AND good_type = ?')
           ->execute([$acquired, $sourceColId, $resourceType]);
    }
    
    // Deduct from trader capital
    $costTotal = $acquired * $pricePerUnit;
    $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits - ? WHERE id = ?')
       ->execute([$costTotal, $traderId]);
    
    // Log transaction
    $db->prepare(<<<SQL
        INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits, source_colony_id)
        VALUES (?, ?, 'bought', ?, ?, ?, ?, ?)
    SQL)->execute([
        $traderId, $routeId, $resourceType,
        $acquired, $pricePerUnit, $costTotal, $sourceColId
    ]);
    
    // Update route and move to acquiring
    $db->prepare(<<<SQL
        UPDATE trader_routes 
        SET status = 'acquiring', 
            quantity_acquired = ?,
            price_paid = ?,
            updated_at = NOW()
        WHERE id = ?
    SQL)->execute([$acquired, $pricePerUnit, $routeId]);
}

/**
 * ACQUIRING → IN_TRANSIT: Launch fleet with goods to target.
 */
function transition_acquiring_to_transit(PDO $db, array $route): void {
    $routeId = (int)$route['id'];
    $traderId = (int)$route['trader_id'];
    $sourceColId = (int)$route['source_colony_id'];
    $targetColId = (int)$route['target_colony_id'];
    $resourceType = (string)$route['resource_type'];
    $acquired = (float)$route['quantity_acquired'];
    
    if ($acquired <= 0) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')
           ->execute(['failed', $routeId]);
        return;
    }
    
    // Get trader NPC user for fleet ownership
    $traderStmt = $db->prepare('SELECT user_id FROM npc_traders WHERE id = ?');
    $traderStmt->execute([$traderId]);
    $traderUserId = (int)$traderStmt->fetchColumn();
    if (!$traderUserId) {
        throw new Exception("Trader user not found for trader $traderId");
    }
    
    // Create transport fleet (empty ship, cargo only)
    // Construct minimal cargo for trade fleet
    $cargoMeta = json_encode(['trader_route_id' => $routeId]);
    
    $fleetStmt = $db->prepare(<<<SQL
        INSERT INTO fleets 
        (user_id, origin_colony_id, target_galaxy, target_system, target_position,
         mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
         origin_x_ly, origin_y_ly, origin_z_ly,
         target_x_ly, target_y_ly, target_z_ly,
         speed_ly_h, distance_ly,
         departure_time, arrival_time, return_time)
        SELECT 
            ?, ?, cb_tgt.galaxy_index, cb_tgt.system_index, cb_tgt.position,
            'transport', '{}',
            CASE WHEN ? = 'metal' THEN ? ELSE 0 END,
            CASE WHEN ? = 'crystal' THEN ? ELSE 0 END,
            CASE WHEN ? = 'deuterium' THEN ? ELSE 0 END,
            COALESCE(ss_src.x_ly, 0), COALESCE(ss_src.y_ly, 0), COALESCE(ss_src.z_ly, 0),
            COALESCE(ss_tgt.x_ly, 0), COALESCE(ss_tgt.y_ly, 0), COALESCE(ss_tgt.z_ly, 0),
            100.0, 50.0,
            NOW(), DATE_ADD(NOW(), INTERVAL 300 MINUTE), DATE_ADD(NOW(), INTERVAL 600 MINUTE)
        FROM colonies c_src
        JOIN celestial_bodies cb_src ON cb_src.id = c_src.body_id
        JOIN star_systems ss_src ON ss_src.galaxy_index = cb_src.galaxy_index AND ss_src.system_index = cb_src.system_index
        JOIN colonies c_tgt ON c_tgt.id = ?
        JOIN celestial_bodies cb_tgt ON cb_tgt.id = c_tgt.body_id
        JOIN star_systems ss_tgt ON ss_tgt.galaxy_index = cb_tgt.galaxy_index AND ss_tgt.system_index = cb_tgt.system_index
        WHERE c_src.id = ?
    SQL);
    
    $params = [
        $traderUserId, $sourceColId, $resourceType, $acquired, $resourceType, $acquired, $resourceType, $acquired,
        $targetColId, $sourceColId
    ];
    $fleetStmt->execute($params);
    $fleetId = (int)$db->lastInsertId();
    
    // Link fleet to route
    $db->prepare('UPDATE trader_routes SET fleet_id = ?, status = ?, departure_at = NOW(), updated_at = NOW() WHERE id = ?')
       ->execute([$fleetId, 'in_transit', $routeId]);
}

/**
 * IN_TRANSIT → DELIVERING: Fleet arrived, execute sale.
 */
function transition_transit_to_delivering(PDO $db, array $route): void {
    $routeId = (int)$route['id'];
    $fleetId = (int)($route['fleet_id'] ?: 0);
    $targetColId = (int)$route['target_colony_id'];
    $acquired = (float)$route['quantity_acquired'];
    
    if (!$fleetId || $acquired <= 0) {
        $db->prepare('UPDATE trader_routes SET status = ? WHERE id = ?')
           ->execute(['failed', $routeId]);
        return;
    }
    
    // Check fleet arrival
    $fleetStmt = $db->prepare('SELECT arrival_time FROM fleets WHERE id = ? AND arrival_time <= NOW()');
    $fleetStmt->execute([$fleetId]);
    if (!$fleetStmt->fetch()) {
        // Fleet not arrived yet
        return;
    }
    
    // Deliver goods to target colony
    $resourceType = (string)$route['resource_type'];
    if (in_array($resourceType, ['metal', 'crystal', 'deuterium', 'rare_earth', 'food'])) {
        $db->prepare("UPDATE colonies SET $resourceType = $resourceType + ? WHERE id = ?")
           ->execute([$acquired, $targetColId]);
    } else {
        $db->prepare(<<<SQL
            INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
            VALUES (?, ?, ?, 5000.0)
            ON DUPLICATE KEY UPDATE quantity = quantity + ?
        SQL)->execute([$targetColId, $resourceType, $acquired, $acquired]);
    }
    
    // Delete fleet
    $db->prepare('DELETE FROM fleets WHERE id = ?')->execute([$fleetId]);
    
    // Move to delivering state
    $db->prepare('UPDATE trader_routes SET status = ?, arrival_at = NOW() WHERE id = ?')
       ->execute(['delivering', $routeId]);
}

/**
 * DELIVERING → COMPLETED: Sell goods, calculate profit, finish.
 */
function transition_delivering_to_completed(PDO $db, array $route): void {
    $routeId = (int)$route['id'];
    $traderId = (int)$route['trader_id'];
    $targetColId = (int)$route['target_colony_id'];
    $resourceType = (string)$route['resource_type'];
    $acquired = (float)$route['quantity_acquired'];
    $pricePaid = (float)$route['price_paid'];
    
    // Get sale price at destination
    $tgtSysStmt = $db->prepare(<<<SQL
        SELECT cb.galaxy_index, ss.system_index
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
        WHERE c.id = ?
        LIMIT 1
    SQL);
    $tgtSysStmt->execute([$targetColId]);
    [$tgtGalaxy, $tgtSystem] = $tgtSysStmt->fetch(PDO::FETCH_NUM) ?: [1, 0];
    $priceSold = compute_system_price($db, (int)$tgtGalaxy, (int)$tgtSystem, $resourceType);
    
    // Calculate profit
    $revenueTotal = $acquired * $priceSold;
    $profit = $revenueTotal - ($acquired * $pricePaid);
    
    // Add revenue back to trader capital
    $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits + ?, total_profit = total_profit + ? WHERE id = ?')
       ->execute([$revenueTotal, $profit, $traderId]);
    
    // Log transaction
    $db->prepare(<<<SQL
        INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits, target_colony_id)
        VALUES (?, ?, 'sold', ?, ?, ?, ?, ?)
    SQL)->execute([
        $traderId, $routeId, $resourceType,
        $acquired, $priceSold, $revenueTotal, $targetColId
    ]);
    
    // Mark route completed
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

/**
 * Recalculate local supply/demand per system based on current production/consumption.
 * Calls market_analysis.php helper function.
 */
function recalculate_supply_demand(PDO $db): void {
    try {
        update_supply_demand_table($db);
    } catch (Throwable $e) {
        error_log("Supply/demand recalc error: " . $e->getMessage());
    }
}

/**
 * Find profitable trade opportunities and rank by profit margin.
 * Calls market_analysis.php helper function.
 */
function find_and_rank_opportunities(PDO $db): int {
    try {
        // Delete expired opportunities
        $db->prepare('DELETE FROM trade_opportunities WHERE expires_at <= NOW()')->execute();
        
        // Find new opportunities
        $countBefore = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
        find_and_rank_trade_opportunities($db, 15.0);  // 15% min margin
        $countAfter = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
        
        return max(0, $countAfter - $countBefore);
    } catch (Throwable $e) {
        error_log("Opportunity finder error: " . $e->getMessage());
        return 0;
    }
}

/**
 * Let traders make decisions: If capital is available and fleet slots open,
 * pick the best opportunity matching their strategy and create a new route.
 */
function execute_trader_decisions(PDO $db): int {
    $traderDecisions = 0;
    
    // Get all traders with available capacity
    $traderStmt = $db->prepare(<<<SQL
        SELECT 
            t.id, t.strategy, t.capital_credits, t.max_fleets, t.specialization,
            COUNT(DISTINCT tr.id) as active_count
        FROM npc_traders t
        LEFT JOIN trader_routes tr ON tr.trader_id = t.id AND tr.status != 'completed' AND tr.status != 'failed'
        GROUP BY t.id
        HAVING active_count < t.max_fleets AND t.capital_credits > 5000
        ORDER BY t.capital_credits DESC
    SQL);
    $traderStmt->execute();
    $traders = $traderStmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($traders as $trader) {
        try {
            if (execute_trader_strategy($db, $trader)) {
                $traderDecisions++;
            }
        } catch (Throwable $e) {
            error_log("Trader decision error (trader {$trader['id']}): " . $e->getMessage());
        }
    }

    return $traderDecisions;
}

/**
 * Execute a single trader's strategy: pick opportunity and create route.
 */
function execute_trader_strategy(PDO $db, array $trader): bool {
    $traderId = (int)$trader['id'];
    $strategy = (string)$trader['strategy'];
    $capital = (float)$trader['capital_credits'];
    $spec = (string)($trader['specialization'] ?: '');
    
    // Get best opportunity matching strategy
    $minMargin = match ($strategy) {
        'profit_max'  => 20.0,   // High margin only
        'volume'      => 5.0,    // Will accept lower margins
        'stabilize'   => 10.0,   // Moderate
        default       => 15.0,
    };
    
    $orderBy = match ($strategy) {
        'profit_max' => 'net_profit_per_unit * actual_qty DESC',
        'volume'     => 'actual_qty DESC',
        default      => 'confidence DESC',
    };

    $oppStmt = $db->prepare(<<<SQL
        SELECT 
            id, source_system, target_system, resource_type,
            source_price, target_price, actual_qty,
            net_profit_per_unit, confidence
        FROM trade_opportunities
        WHERE profit_margin >= ?
            AND expires_at > NOW()
            AND (? = '' OR resource_type = ?)
        ORDER BY {$orderBy}
        LIMIT 1
    SQL);
    $oppStmt->execute([$minMargin, $spec, $spec]);
    $opp = $oppStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$opp) {
        return false;  // No suitable opportunity
    }
    
    // Get source and target colonies from opportunity systems
    $srcColStmt = $db->prepare(<<<SQL
        SELECT MIN(c.id) as col_id
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        WHERE cb.system_index = ?
        LIMIT 1
    SQL);
    $srcColStmt->execute([(int)$opp['source_system']]);
    $srcColId = $srcColStmt->fetchColumn();
    
    $tgtColStmt = $db->prepare(<<<SQL
        SELECT MIN(c.id) as col_id
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        WHERE cb.system_index = ?
        LIMIT 1
    SQL);
    $tgtColStmt->execute([(int)$opp['target_system']]);
    $tgtColId = $tgtColStmt->fetchColumn();
    
    if (!$srcColId || !$tgtColId) {
        return false;  // No valid colonies
    }
    
    $resourceType = (string)$opp['resource_type'];
    $qty = (float)$opp['actual_qty'];
    $expectedProfit = $qty * (float)$opp['net_profit_per_unit'];
    
    // Cap quantity by trader capital
    $maxAffordable = (int)floor($capital / ((float)$opp['source_price'] + 10));
    $tradeQty = (int)min($qty, $maxAffordable);
    
    if ($tradeQty <= 0) {
        return false;  // Can't afford even minimum
    }
    
    // Create trader route
    $routeStmt = $db->prepare(<<<SQL
        INSERT INTO trader_routes 
        (trader_id, source_colony_id, target_colony_id, resource_type,
         quantity_planned, expected_profit, status)
        VALUES (?, ?, ?, ?, ?, ?, 'planning')
    SQL);
    $routeStmt->execute([
        $traderId, $srcColId, $tgtColId, $resourceType,
        $tradeQty, $expectedProfit * 0.9  // Conservative estimate
    ]);
    
    // Update trader active fleet count
    $db->prepare('UPDATE npc_traders SET active_fleets = active_fleets + 1 WHERE id = ?')
       ->execute([$traderId]);

    return true;
}
