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
require_once __DIR__ . '/simulation_runtime.php';
if (!defined('TRADERS_LIB_MODE')) {
    define('TRADERS_LIB_MODE', true);
}
require_once __DIR__ . '/traders.php';

header('Content-Type: application/json; charset=utf-8');

$event = $_GET['event'] ?? $_POST['event'] ?? '';
$uid   = require_auth();
$db    = get_db();

if (!is_admin_user($db, $uid)) {
    json_error('Admin access required.', 403);
}

$readEvents = ['status'];
$writeEvents = [
    'market_update',
    'opportunity_scan',
    'trader_decisions',
    'route_process',
    'route_create',
    'route_complete',
    'game_tick',
];
if (in_array($event, $readEvents, true)) {
    only_method('GET');
} elseif (in_array($event, $writeEvents, true)) {
    only_method('POST');
    verify_csrf();
} else {
    json_error("Unknown event: $event", 400);
}

try {
    if ($event === 'status') {
        event_status($db);
    }
    if ($event === 'game_tick') {
        event_game_tick($db);
    }

    switch ($event) {
        case 'market_update':
            event_market_update($db);
            // Event handlers terminate the request.
        case 'opportunity_scan':
            event_opportunity_scan($db);
            // Event handlers terminate the request.
        case 'trader_decisions':
            event_trader_decisions($db);
            // Event handlers terminate the request.
        case 'route_process':
            event_route_process($db);
            // Event handlers terminate the request.
        case 'route_create':
            event_route_create($db);
            // Event handlers terminate the request.
        case 'route_complete':
            event_route_complete($db);
            // Event handlers terminate the request.
        default:
            json_error("Unknown event: $event", 400);
    }
} catch (Throwable $e) {
    error_log("traders_events.php error: " . $e->getMessage());
    json_error('Trader event service unavailable', 503);
}

/**
 * @param callable(): array<string, mixed> $operation
 */
function event_with_global_simulation_lock(PDO $db, callable $operation): never
{
    $result = simulation_runtime_with_scope_lock(
        $db,
        'global',
        '',
        static function () use ($operation): array {
            return ['executed' => true] + $operation();
        }
    );
    json_ok($result);
}

/**
 * EVENT: market_update
 * POST /api/traders_events.php?event=market_update
 * 
 * Recalculate supply/demand for all systems based on current production/consumption
 */
function event_market_update(PDO $db): never {
    event_with_global_simulation_lock($db, static function () use ($db): array {
        $t0 = microtime(true);
        $db->prepare('DELETE FROM market_supply_demand WHERE updated_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)')
           ->execute();
        update_supply_demand_table($db);

        return [
            'event' => 'market_update',
            'status' => 'success',
            'duration_ms' => (int)((microtime(true) - $t0) * 1000),
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    });
}

/**
 * EVENT: opportunity_scan
 * POST /api/traders_events.php?event=opportunity_scan
 * 
 * Find and rank profitable trade opportunities
 */
function event_opportunity_scan(PDO $db): never {
    event_with_global_simulation_lock($db, static function () use ($db): array {
        $t0 = microtime(true);
        $db->prepare('DELETE FROM trade_opportunities WHERE expires_at < NOW()')->execute();
        $countBefore = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
        find_and_rank_trade_opportunities($db, 15.0);
        $countAfter = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();

        return [
            'event' => 'opportunity_scan',
            'status' => 'success',
            'new_opportunities' => max(0, $countAfter - $countBefore),
            'total_opportunities' => $countAfter,
            'duration_ms' => (int)((microtime(true) - $t0) * 1000),
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    });
}

/**
 * EVENT: trader_decisions
 * POST /api/traders_events.php?event=trader_decisions
 * 
 * Let traders autonomously make decisions based on available opportunities
 */
function event_trader_decisions(PDO $db): never {
    event_with_global_simulation_lock($db, static function () use ($db): array {
        $t0 = microtime(true);
        $decisionsCount = 0;
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

        return [
            'event' => 'trader_decisions',
            'status' => 'success',
            'decisions_made' => $decisionsCount,
            'duration_ms' => (int)((microtime(true) - $t0) * 1000),
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    });
}

/**
 * EVENT: route_process
 * POST /api/traders_events.php?event=route_process
 * 
 * Advance all routes through their lifecycle one step (PLANNING → ACQUIRING → IN_TRANSIT → DELIVERING → COMPLETED)
 */
function event_route_process(PDO $db): never {
    event_with_global_simulation_lock($db, static function () use ($db): array {
        $t0 = microtime(true);
        $stats = process_route_transitions($db);

        return [
            'event' => 'route_process',
            'status' => 'success',
            'stats' => [
                'processed' => $stats['routes_processed'],
                'completed' => $stats['routes_completed'],
                'failed' => $stats['routes_failed'],
                'profit' => $stats['total_profit_generated'],
            ],
            'duration_ms' => (int)((microtime(true) - $t0) * 1000),
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    });
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
    
    if (
        !$traderId || !$srcColId || !$tgtColId || !$resourceType || $qty <= 0
        || !array_key_exists($resourceType, \GalaxyQuest\Economy\ColonyEconomySimulation::PRICES)
    ) {
        json_error('Missing or invalid parameters', 400);
    }
    
    event_with_global_simulation_lock(
        $db,
        static function () use ($db, $traderId, $srcColId, $tgtColId, $resourceType, $qty): array {
            $routeStmt = $db->prepare(<<<SQL
                INSERT INTO trader_routes
                (trader_id, source_colony_id, target_colony_id, resource_type, quantity_planned, status)
                VALUES (?, ?, ?, ?, ?, 'planning')
            SQL);
            $routeStmt->execute([$traderId, $srcColId, $tgtColId, $resourceType, $qty]);

            $routeId = (int)$db->lastInsertId();
            $db->prepare('UPDATE npc_traders SET active_fleets = active_fleets + 1 WHERE id = ?')
               ->execute([$traderId]);

            return [
                'event' => 'route_create',
                'status' => 'success',
                'route_id' => $routeId,
                'timestamp' => date('Y-m-d H:i:s'),
            ];
        }
    );
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

    $route = $db->prepare('SELECT 1 FROM trader_routes WHERE id = ?');
    $route->execute([$routeId]);
    if ($route->fetchColumn() === false) {
        json_error('Route not found', 404);
    }
    
    event_with_global_simulation_lock($db, static function () use ($db, $routeId): array {
        $route = $db->prepare('SELECT * FROM trader_routes WHERE id = ?');
        $route->execute([$routeId]);
        $routeData = $route->fetch(PDO::FETCH_ASSOC);
        
        if (!$routeData) {
            throw new RuntimeException('Trader route disappeared while acquiring the simulation lock.');
        }
        
        process_single_route_transition($db, $routeData);
        $fresh = $db->prepare('SELECT status, actual_profit FROM trader_routes WHERE id = ?');
        $fresh->execute([$routeId]);
        $result = $fresh->fetch(PDO::FETCH_ASSOC) ?: [];
        $profit = (float)($result['actual_profit'] ?? 0);

        return [
            'event' => 'route_complete',
            'status' => (string)($result['status'] ?? 'missing'),
            'route_id' => $routeId,
            'profit' => $profit,
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    });
}

/**
 * EVENT: game_tick (Full Cycle)
 * POST /api/traders_events.php?event=game_tick
 * 
 * Called once per game tick - orchestrates all sub-events
 */
function event_game_tick(PDO $db): never {
    event_with_global_simulation_lock(
        $db,
        static fn(): array => event_game_tick_run($db)
    );
}

/**
 * Execute the manual trader cycle while the global simulation lock is held.
 *
 * @return array{executed:bool,event:string,status:string,decisions:int,routes_processed:int,duration_ms:int,timestamp:string}
 */
function event_game_tick_run(PDO $db): array
{
    try {
        $t0 = microtime(true);
        
        // Run all events in sequence
        $db->beginTransaction();
        update_supply_demand_table($db);
        find_and_rank_trade_opportunities($db, 15.0);
        $decisionsCount = execute_trader_decisions($db);
        $routeStats = process_route_transitions($db);
        $db->commit();
        
        $duration = (int)((microtime(true) - $t0) * 1000);
        
        return [
            'executed' => true,
            'event' => 'game_tick',
            'status' => 'success',
            'decisions' => $decisionsCount,
            'routes_processed' => $routeStats['routes_processed'],
            'duration_ms' => $duration,
            'timestamp' => date('Y-m-d H:i:s'),
        ];
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
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
    return execute_trader_strategy($db, $trader);
}
