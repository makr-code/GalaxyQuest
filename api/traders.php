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
require_once __DIR__ . '/simulation_runtime.php';
require_once __DIR__ . '/../src/Economy/StandingOrders.php';

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
        json_error('Trader service unavailable', 503);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/traders.php?action=list_opportunities&min_margin=15&limit=20
 * 
 * Returns ranked list of profitable trade opportunities.
 */
function action_list_opportunities(PDO $db): never {
    only_method('GET');
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
    only_method('GET');
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
    only_method('GET');
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
            tr.funding_status,tr.source_order_id,tr.target_order_id,tr.buyer_escrow_cents,
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
            'is_due'            => $route['funding_status'] !== 'quarantined'
                && ($statusValue === 'planning' || $statusValue === 'delivering'),
            'source_colony'     => (string)$route['source_colony'],
            'target_colony'     => (string)$route['target_colony'],
            'resource_type'     => (string)$route['resource_type'],
            'status'            => $statusValue,
            'funding_status'    => (string)$route['funding_status'],
            'source_order_id'   => $route['source_order_id'] === null ? null : (int)$route['source_order_id'],
            'target_order_id'   => $route['target_order_id'] === null ? null : (int)$route['target_order_id'],
            'buyer_escrow_cents' => (int)$route['buyer_escrow_cents'],
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
    only_method('GET');
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
 * Execute trader actions under the same global lock as the full trader cycle.
 */
function action_process_trader_tick(PDO $db): never {
    only_method('POST');
    verify_csrf();

    try {
        $result = simulation_runtime_with_scope_lock(
            $db,
            'global',
            '',
            static function () use ($db): array {
                try {
                    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
                        $db->exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
                    }
                    $db->beginTransaction();

                    $stats = [
                        'routes_processed' => 0,
                        'routes_completed' => 0,
                        'routes_failed' => 0,
                        'routes_quarantined' => 0,
                        'new_opportunities' => 0,
                        'traders_made_decisions' => 0,
                        'total_profit_generated' => 0.0,
                        'duration_ms' => 0,
                    ];

                    $t0 = microtime(true);

                    $transitionStats = process_route_transitions($db);
                    $stats = array_merge($stats, $transitionStats);
                    recalculate_supply_demand($db);
                    $stats['new_opportunities'] = find_and_rank_opportunities($db);
                    $stats['traders_made_decisions'] = execute_trader_decisions($db);

                    $db->commit();
                    $stats['duration_ms'] = (int)((microtime(true) - $t0) * 1000);

                    return [
                        'executed' => true,
                        'status' => 'ok',
                        'message' => 'Trader tick completed',
                        'timestamp' => date('Y-m-d H:i:s'),
                        'stats' => $stats,
                    ];
                } catch (Throwable $e) {
                    if ($db->inTransaction()) {
                        $db->rollBack();
                    }
                    throw $e;
                }
            }
        );
        json_ok($result);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
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
    only_method('POST');
    verify_csrf();

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
 * Advance routes through every immediately-available state in one locked pass.
 * A route stops in transit until its persisted arrival timestamp is due.
 */
function process_route_transitions(PDO $db, ?int $now = null): array {
    trader_return_transports($db, $now ?? time());
    $stats = [
        'routes_processed' => 0,
        'routes_completed' => 0,
        'routes_failed' => 0,
        'routes_quarantined' => 0,
        'total_profit_generated' => 0.0,
    ];

    $routesStmt = $db->query(
        "SELECT id FROM trader_routes WHERE status IN ('planning', 'acquiring', 'in_transit', 'delivering') "
        . "AND funding_status <> 'quarantined' "
        . 'ORDER BY updated_at ASC'
    );
    foreach ($routesStmt->fetchAll(PDO::FETCH_COLUMN) as $routeId) {
        $stats['routes_processed']++;
        process_single_route_transition($db, ['id' => (int)$routeId], $now);

        $finalStmt = $db->prepare('SELECT status, actual_profit,funding_status FROM trader_routes WHERE id = ?');
        $finalStmt->execute([(int)$routeId]);
        $final = $finalStmt->fetch(PDO::FETCH_ASSOC) ?: [];
        if (($final['funding_status'] ?? '') === 'quarantined') {
            $stats['routes_quarantined']++;
        } elseif (($final['status'] ?? '') === 'completed') {
            $stats['routes_completed']++;
            $stats['total_profit_generated'] += (float)($final['actual_profit'] ?? 0);
        } elseif (($final['status'] ?? '') === 'failed') {
            $stats['routes_failed']++;
        }
    }

    return $stats;
}

/**
 * Advance one freshly-read route atomically. The supplied snapshot is only used
 * for its id; callers cannot act on a stale status or stale financial values.
 */
function process_single_route_transition(PDO $db, array $route, ?int $now = null): void {
    $routeId = (int)($route['id'] ?? 0);
    if ($routeId <= 0) {
        return;
    }

    trader_route_transaction($db, $routeId, static function () use ($db, $routeId, $now): void {
        $initial = trader_route_read($db, $routeId, false);
        if (!$initial || !trader_route_is_active((string)$initial['status'])) {
            return;
        }
        $participantTrader = trader_trader_read($db, (int)$initial['trader_id'], false);
        $initial['trader_user_id'] = $participantTrader['user_id'] ?? null;

        // Lock all participants before any colony, route, trader or order lock.
        trader_route_lock_owners($db, $initial);
        $now ??= time();
        if (($initial['funding_status'] ?? 'legacy') === 'quarantined') {
            return;
        }
        if (($initial['funding_status'] ?? 'legacy') === 'legacy') {
            $current = trader_route_read($db, $routeId, true);
            if (!$current || !trader_route_is_active((string)$current['status'])) {
                return;
            }
            foreach (['source', 'target'] as $endpoint) {
                if (($current[$endpoint]['user_id'] ?? null) !== ($initial[$endpoint]['user_id'] ?? null)) {
                    throw new RuntimeException('Trader endpoint ownership changed while participant locks were acquired.');
                }
            }
            if ($current['status'] === 'planning' && (float)$current['quantity_acquired'] === 0.0) {
                trader_route_fail($db, $current);
            } else {
                $db->prepare("UPDATE trader_routes SET funding_status='quarantined',updated_at=? WHERE id=?")
                    ->execute([date('Y-m-d H:i:s'), $routeId]);
                error_log('Unfunded legacy trader route quarantined: ' . $routeId);
            }
            return;
        }

        $initialArrival = trader_route_arrival_time($initial);
        $mustSettleSource = $initial['status'] === 'planning';
        $mustSettleTarget = $initial['status'] === 'delivering' || ($initial['status'] === 'in_transit'
            && $initialArrival !== null
            && $initialArrival <= $now);
        $colonies = [];
        if ($mustSettleSource) {
            $colonies[] = (int)$initial['source_colony_id'];
            $colonies[] = (int)$initial['target_colony_id'];
        }
        if ($mustSettleTarget) {
            $colonies[] = (int)$initial['target_colony_id'];
        }
        if (!trader_route_settle_colonies($db, $colonies, $now)) {
            return;
        }

        $current = trader_route_read($db, $routeId, true);
        if (!$current || !trader_route_is_active((string)$current['status'])) {
            return;
        }
        if (!array_key_exists(
            (string)$current['resource_type'],
            \GalaxyQuest\Economy\ColonyEconomySimulation::PRICES
        )) {
            if ($current['status'] === 'planning') {
                trader_route_fail($db, $current);
                return;
            }
            throw new RuntimeException('An acquired trader route references a good outside the economy catalog.');
        }

        $trader = trader_trader_read($db, (int)$current['trader_id'], true);
        if (!$trader) {
            trader_route_fail($db, $current);
            return;
        }
        if ($initial['trader_user_id'] !== null
            && (int)$trader['user_id'] !== (int)$initial['trader_user_id']) {
            throw new RuntimeException('Trader account changed while participant locks were acquired.');
        }
        if ($current['funding_status'] === 'backed') {
            $orders = new \GalaxyQuest\Economy\StandingOrders($db);
            foreach (['source', 'target'] as $endpoint) {
                try {
                    $order = $orders->read(
                        (int)$current[$endpoint . '_order_id'],
                        (int)($current[$endpoint]['user_id'] ?? 0),
                        true
                    );
                } catch (DomainException $error) {
                    if ($error->getCode() !== 404) {
                        throw $error;
                    }
                    trader_route_fail($db, $current);
                    return;
                }
                if ((int)$order['colony_id'] !== (int)$current[$endpoint . '_colony_id']
                    || $order['good_type'] !== $current['resource_type']
                    || $order['side'] !== ($endpoint === 'source' ? 'sell' : 'buy')) {
                    trader_route_fail($db, $current);
                    return;
                }
            }
        }

        for ($step = 0; $step < 4; $step++) {
            $before = (string)$current['status'];
            if ($before === 'planning') {
                $current = trader_route_acquire($db, $current, $trader, $now);
            } elseif ($before === 'acquiring') {
                $current = trader_route_launch($db, $current, $trader, $now);
            } elseif ($before === 'in_transit') {
                $current = trader_route_deliver_if_due($db, $current, $now);
            } elseif ($before === 'delivering') {
                trader_route_complete($db, $current, $trader, $now);
                return;
            } else {
                return;
            }

            if (!trader_route_is_active((string)$current['status']) || $current['status'] === $before) {
                return;
            }
        }
    });
}

const NPC_TRADER_LOGISTICS_SPEED_LY_H = 100.0;
const NPC_TRADER_CARGO_CAPACITY = 10000;

function trader_route_lock_owners(PDO $db, array $route): void
{
    $suffix = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $owners = [];
    $colonies = [];
    // Fleet insertion also checks the trader account FK; lock that account
    // before colonies/trader rows, including against concurrent account deletion.
    if (!empty($route['trader_user_id'])) {
        $owners[] = (int)$route['trader_user_id'];
    }
    foreach (['source', 'target'] as $key) {
        if ($route[$key]) {
            $owners[] = (int)$route[$key]['user_id'];
            $colonies[] = (int)$route[$key]['id'];
        }
    }
    sort($owners, SORT_NUMERIC);
    sort($colonies, SORT_NUMERIC);
    foreach (array_unique($owners) as $owner) {
        $db->prepare('SELECT id FROM users WHERE id=?' . $suffix)->execute([$owner]);
    }
    foreach (array_unique($colonies) as $colony) {
        $statement = $db->prepare('SELECT user_id FROM colonies WHERE id=?' . $suffix);
        $statement->execute([$colony]);
        $owner = $statement->fetchColumn();
        foreach (['source', 'target'] as $key) {
            if ($route[$key] && (int)$route[$key]['id'] === $colony
                && ($owner === false || (int)$owner !== (int)$route[$key]['user_id'])) {
                throw new RuntimeException('Colony owner changed before route locks were acquired.');
            }
        }
    }
}

function trader_route_transaction(PDO $db, int $routeId, callable $operation): void
{
    static $sequence = 0;
    $outer = $db->inTransaction();
    $savepoint = 'trader_route_' . $routeId . '_' . ++$sequence;
    if ($outer) {
        $db->exec('SAVEPOINT ' . $savepoint);
    } else {
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql') {
            $db->exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        }
        $db->beginTransaction();
    }

    try {
        $operation();
        if ($outer) {
            $db->exec('RELEASE SAVEPOINT ' . $savepoint);
        } else {
            $db->commit();
        }
    } catch (Throwable $error) {
        if ($outer && $db->inTransaction()) {
            $db->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
            $db->exec('RELEASE SAVEPOINT ' . $savepoint);
        } elseif ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $error;
    }
}

function trader_route_read(PDO $db, int $routeId, bool $lock): ?array
{
    $suffix = $lock && $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $statement = $db->prepare('SELECT * FROM trader_routes WHERE id = ?' . $suffix);
    $statement->execute([$routeId]);
    $route = $statement->fetch(PDO::FETCH_ASSOC);
    if (!$route) {
        return null;
    }
    $owner = $db->prepare(
        'SELECT c.id, c.user_id, cb.galaxy_index, cb.system_index, cb.position '
        . 'FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE c.id = ?' . $suffix
    );
    $owner->execute([(int)$route['source_colony_id']]);
    $route['source'] = $owner->fetch(PDO::FETCH_ASSOC) ?: null;
    $owner->execute([(int)$route['target_colony_id']]);
    $route['target'] = $owner->fetch(PDO::FETCH_ASSOC) ?: null;

    $route['fleet_arrival'] = null;
    if (!empty($route['fleet_id'])) {
        $fleet = $db->prepare('SELECT arrival_time FROM fleets WHERE id = ?' . $suffix);
        $fleet->execute([(int)$route['fleet_id']]);
        $route['fleet_arrival'] = $fleet->fetchColumn() ?: null;
    }
    return $route;
}

function trader_trader_read(PDO $db, int $traderId, bool $lock): ?array
{
    $suffix = $lock && $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $statement = $db->prepare('SELECT * FROM npc_traders WHERE id = ?' . $suffix);
    $statement->execute([$traderId]);
    return $statement->fetch(PDO::FETCH_ASSOC) ?: null;
}

function trader_route_is_active(string $status): bool
{
    return in_array($status, ['planning', 'acquiring', 'in_transit', 'delivering'], true);
}

function trader_route_arrival_time(array $route): ?int
{
    $arrival = $route['arrival_at'] ?: ($route['fleet_arrival'] ?? null);
    if (!is_string($arrival) || $arrival === '') {
        return null;
    }
    $timestamp = strtotime($arrival);
    return $timestamp === false ? null : $timestamp;
}

function trader_route_settle_colonies(PDO $db, array $colonyIds, ?int $now = null): bool
{
    $colonies = [];
    foreach (array_unique($colonyIds) as $colonyId) {
        $owner = $db->prepare('SELECT user_id FROM colonies WHERE id = ?');
        $owner->execute([(int)$colonyId]);
        $userId = $owner->fetchColumn();
        if ($userId !== false) {
            $colonies[] = ['colony_id' => (int)$colonyId, 'user_id' => (int)$userId];
        }
    }
    usort($colonies, static fn(array $a, array $b): int =>
        [$a['user_id'], $a['colony_id']] <=> [$b['user_id'], $b['colony_id']]
    );

    $economy = new \GalaxyQuest\Economy\OnDemandEconomy($db);
    $caughtUp = true;
    foreach ($colonies as $colony) {
        $snapshot = $economy->settle($colony['colony_id'], $colony['user_id'], $now, true);
        if ($snapshot['economy']['pending_seconds'] >= \GalaxyQuest\Economy\ColonyEconomySimulation::STEP_SECONDS) {
            $caughtUp = false;
        }
    }
    return $caughtUp;
}

function trader_route_fail(PDO $db, array $route): void
{
    if (!trader_route_is_active((string)$route['status'])) {
        return;
    }
    if ((float)$route['quantity_acquired'] > 0 || (int)($route['buyer_escrow_cents'] ?? 0) > 0) {
        $db->prepare("UPDATE trader_routes SET funding_status='quarantined',updated_at=? WHERE id=?")
            ->execute([date('Y-m-d H:i:s'), (int)$route['id']]);
        error_log('Trader route with cargo/obligation quarantined: ' . (int)$route['id']);
        return;
    }
    $update = $db->prepare(
        "UPDATE trader_routes SET status = 'failed', updated_at = ? WHERE id = ? "
        . "AND status IN ('planning','acquiring','in_transit','delivering')"
    );
    $update->execute([date('Y-m-d H:i:s'), (int)$route['id']]);
    if ($update->rowCount() === 1) {
        trader_route_release_fleet_slot($db, (int)$route['trader_id']);
    }
}

function trader_route_release_fleet_slot(PDO $db, int $traderId): void
{
    $db->prepare(
        'UPDATE npc_traders SET active_fleets = '
        . 'CASE WHEN active_fleets > 0 THEN active_fleets - 1 ELSE 0 END '
        . 'WHERE id = ?'
    )->execute([$traderId]);
}

function trader_route_acquire(PDO $db, array $route, array $trader, ?int $now = null): array
{
    $source = $route['source'];
    if (!$source || !$route['target'] || (int)$route['source_colony_id'] === (int)$route['target_colony_id']) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    $good = (string)$route['resource_type'];
    if (!array_key_exists($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRICES)) {
        throw new RuntimeException('Trader route cargo is outside the economy catalog.');
    }
    $planned = (float)$route['quantity_planned'];
    $capital = (float)$trader['capital_credits'];
    if (!is_finite($planned) || $planned <= 0 || !is_finite($capital) || $capital <= 0) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }

    $sourceColonyId = (int)$route['source_colony_id'];
    $orders = new \GalaxyQuest\Economy\StandingOrders($db);
    $ids = [(int)($route['source_order_id'] ?? 0), (int)($route['target_order_id'] ?? 0)];
    sort($ids, SORT_NUMERIC);
    $locked = [];
    foreach ($ids as $id) {
        $owner = $id === (int)$route['source_order_id'] ? (int)$source['user_id'] : (int)$route['target']['user_id'];
        $locked[$id] = $orders->read($id, $owner, true);
    }
    $sell = $locked[(int)$route['source_order_id']];
    $buy = $locked[(int)$route['target_order_id']];
    if ($sell['side'] !== 'sell' || $buy['side'] !== 'buy'
        || $sell['good_type'] !== $good || $buy['good_type'] !== $good
        || (int)$sell['colony_id'] !== $sourceColonyId
        || (int)$buy['colony_id'] !== (int)$route['target_colony_id']
        || $sell['status'] !== 'active' || $buy['status'] !== 'active'
        || (!empty($sell['paired_order_id']) && (int)$sell['paired_order_id'] !== (int)$buy['id'])
        || (!empty($buy['paired_order_id']) && (int)$buy['paired_order_id'] !== (int)$sell['id'])
        || (int)$buy['limit_price_cents'] <= (int)$sell['limit_price_cents']) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    $orders->assertPolicy((int)$buy['user_id'], 'buy');
    if ((int)$source['galaxy_index'] !== (int)$route['target']['galaxy_index']) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    $askCents = (int)$sell['limit_price_cents'];
    $bidCents = (int)$buy['limit_price_cents'];
    $capitalCents = \GalaxyQuest\Economy\StandingOrders::capitalCents($trader['capital_credits']);
    $acquired = (int)min(
        floor($planned), (int)$sell['quantity_remaining'], (int)$buy['quantity_remaining'],
        intdiv((int)$buy['escrow_cents'], $bidCents), intdiv($capitalCents, $askCents),
        NPC_TRADER_CARGO_CAPACITY,
        trader_transport_depot($db, $source, (int)$trader['user_id'])['capacity'] ?? 0
    );
    if ($acquired <= 0) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    $price = $askCents / 100;
    $cost = \GalaxyQuest\Economy\StandingOrders::money($acquired * $askCents);
    $obligation = $acquired * $bidCents;
    foreach ([$sell, $buy] as $order) {
        $remaining = (int)$order['quantity_remaining'] - $acquired;
        $escrow = (int)$order['escrow_cents'] - ($order['side'] === 'buy' ? $obligation : 0);
        $update = $db->prepare(
            'UPDATE economy_standing_orders SET quantity_remaining=?,escrow_cents=?,status=? '
            . "WHERE id=? AND status='active' AND quantity_remaining=? AND escrow_cents=?"
        );
        $update->execute([
            $remaining, $escrow, $remaining === 0 ? 'filled' : 'active', (int)$order['id'],
            (int)$order['quantity_remaining'], (int)$order['escrow_cents'],
        ]);
        if ($update->rowCount() !== 1) {
            throw new RuntimeException('Standing order changed during acquisition.');
        }
    }
    $debit = $db->prepare(
        'UPDATE npc_traders SET capital_credits = capital_credits - ? '
        . 'WHERE id = ? AND capital_credits >= ?'
    );
    $debit->execute([$cost, (int)$trader['id'], $cost]);
    if ($debit->rowCount() !== 1) {
        throw new RuntimeException('Trader capital changed before acquisition.');
    }
    $payment = $db->prepare('UPDATE users SET credits=credits+? WHERE id=?');
    $payment->execute([$cost, (int)$source['user_id']]);
    if ($payment->rowCount() !== 1) {
        throw new RuntimeException('Seller payment could not be recorded.');
    }
    $db->prepare(
        "INSERT INTO trader_transactions "
        . "(trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits, source_colony_id) "
        . "VALUES (?, ?, 'bought', ?, ?, ?, ?, ?)"
    )->execute([
        (int)$trader['id'], (int)$route['id'], $good, $acquired, $price, $cost, $sourceColonyId,
    ]);
    $routeUpdate = $db->prepare(
        "UPDATE trader_routes SET status = 'acquiring', quantity_acquired = ?, price_paid = ?, updated_at = ?, "
        . 'price_sold=?,buyer_escrow_cents=? '
        . 'WHERE id = ? AND status = \'planning\''
    );
    $routeUpdate->execute([$acquired, $price, gmdate('Y-m-d H:i:s', $now ?? time()), $bidCents / 100, $obligation, (int)$route['id']]);
    if ($routeUpdate->rowCount() !== 1) {
        throw new RuntimeException('Trader route changed before acquisition was recorded.');
    }

    $route['status'] = 'acquiring';
    $route['quantity_acquired'] = $acquired;
    $route['price_paid'] = $price;
    $route['price_sold'] = $bidCents / 100;
    $route['buyer_escrow_cents'] = $obligation;
    return $route;
}

/** Only existing trader-owned ships already stationed in the source system may load. */
function trader_transport_depot(PDO $db, array $source, int $owner): ?array
{
    $suffix = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $statement = $db->prepare(
        'SELECT c.id,s.type,s.count FROM colonies c JOIN celestial_bodies b ON b.id=c.body_id '
        . 'JOIN ships s ON s.colony_id=c.id WHERE c.user_id=? AND b.galaxy_index=? AND b.system_index=? '
        . "AND s.type IN ('large_cargo','small_cargo') AND s.count>0 ORDER BY c.id,s.type" . $suffix
    );
    $statement->execute([$owner, $source['galaxy_index'], $source['system_index']]);
    $depots = [];
    foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $cid = (int)$row['id'];
        $depots[$cid]['colony_id'] = $cid;
        $depots[$cid]['ships'][$row['type']] = (int)$row['count'];
        $depots[$cid]['capacity'] = ($depots[$cid]['capacity'] ?? 0)
            + (int)$row['count'] * ship_cargo($row['type']);
    }
    $best = null;
    foreach ($depots as $depot) {
        if ($best === null || $depot['capacity'] > $best['capacity']) {
            $best = $depot;
        }
    }
    return $best;
}

function trader_route_launch(PDO $db, array $route, array $trader, ?int $now = null): array
{
    $acquired = (float)$route['quantity_acquired'];
    $source = $route['source'];
    $target = $route['target'];
    if ($acquired <= 0) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    if (!$source || !$target || (int)$trader['user_id'] <= 0) {
        throw new RuntimeException('Acquired goods cannot be launched without valid route endpoints and trader owner.');
    }
    $depot = trader_transport_depot($db, $source, (int)$trader['user_id']);
    if ($depot === null || $depot['capacity'] < $acquired) {
        // Previously acquired cargo remains backed and waits, never teleports.
        return $route;
    }
    $ships = [];
    $remaining = $acquired;
    foreach ($depot['ships'] as $type => $available) {
        $count = min($available, (int)ceil(max(0, $remaining) / ship_cargo($type)));
        if ($count < 1) {
            continue;
        }
        $debit = $db->prepare('UPDATE ships SET count=count-? WHERE colony_id=? AND type=? AND count>=?');
        $debit->execute([$count, $depot['colony_id'], $type, $count]);
        if ($debit->rowCount() !== 1) {
            throw new RuntimeException('Transport ships changed before departure.');
        }
        $ships[$type] = $count;
        $remaining -= $count * ship_cargo($type);
    }

    $origin = get_system_3d_coords($db, (int)$source['galaxy_index'], (int)$source['system_index']);
    $destination = get_system_3d_coords($db, (int)$target['galaxy_index'], (int)$target['system_index']);
    $distance = fleet_3d_distance(
        (float)$origin[0],
        (float)$origin[1],
        (float)$origin[2],
        (float)$destination[0],
        (float)$destination[1],
        (float)$destination[2]
    );
    $departedAt = $now ?? time();
    $arrivalTimestamp = $departedAt + fleet_travel_time_3d($distance, NPC_TRADER_LOGISTICS_SPEED_LY_H);
    $departureAt = date('Y-m-d H:i:s', $departedAt);
    $arrivalAt = date('Y-m-d H:i:s', $arrivalTimestamp);
    $cargo = json_encode([(string)$route['resource_type'] => $acquired], JSON_THROW_ON_ERROR);

    $fleet = $db->prepare(<<<SQL
        INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium, cargo_payload,
             origin_x_ly, origin_y_ly, origin_z_ly, target_x_ly, target_y_ly, target_z_ly,
             speed_ly_h, distance_ly, departure_time, arrival_time)
        VALUES (?, ?, ?, ?, ?, 'transport', ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    SQL);
    $fleet->execute([
        (int)$trader['user_id'],
        $depot['colony_id'],
        (int)$target['galaxy_index'],
        (int)$target['system_index'],
        (int)$target['position'],
        json_encode($ships, JSON_THROW_ON_ERROR),
        $cargo,
        $origin[0],
        $origin[1],
        $origin[2],
        $destination[0],
        $destination[1],
        $destination[2],
        NPC_TRADER_LOGISTICS_SPEED_LY_H,
        $distance,
        $departureAt,
        $arrivalAt,
    ]);
    $fleetId = (int)$db->lastInsertId();
    $routeUpdate = $db->prepare(
        "UPDATE trader_routes SET fleet_id = ?, status = 'in_transit', departure_at = ?, "
        . 'arrival_at = ?, updated_at = ? WHERE id = ? AND status = \'acquiring\''
    );
    $routeUpdate->execute([$fleetId, $departureAt, $arrivalAt, $departureAt, (int)$route['id']]);
    if ($routeUpdate->rowCount() !== 1) {
        throw new RuntimeException('Trader route changed before departure was recorded.');
    }

    $route['fleet_id'] = $fleetId;
    $route['status'] = 'in_transit';
    $route['departure_at'] = $departureAt;
    $route['arrival_at'] = $arrivalAt;
    $route['fleet_arrival'] = $arrivalAt;
    return $route;
}

function trader_route_deliver_if_due(PDO $db, array $route, ?int $now = null): array
{
    $fleetId = (int)($route['fleet_id'] ?? 0);
    $arrival = trader_route_arrival_time($route);
    if ($fleetId <= 0 || (float)$route['quantity_acquired'] <= 0 || $arrival === null) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    if ($arrival > ($now ?? time())) {
        return $route;
    }

    $suffix = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
    $fleetStmt = $db->prepare('SELECT * FROM fleets WHERE id = ?' . $suffix);
    $fleetStmt->execute([$fleetId]);
    $fleet = $fleetStmt->fetch(PDO::FETCH_ASSOC);
    if (!$fleet) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }

    $good = (string)$route['resource_type'];
    if (!array_key_exists($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRICES)) {
        throw new RuntimeException('In-transit trader cargo is outside the economy catalog.');
    }
    $cargo = json_decode((string)$fleet['cargo_payload'], true);
    if (!is_array($cargo) || count($cargo) !== 1 || !is_numeric($cargo[$good] ?? null)
        || (float)$cargo[$good] !== (float)$route['quantity_acquired']) {
        trader_route_fail($db, $route);
        $route['status'] = 'failed';
        return $route;
    }
    (new \GalaxyQuest\Economy\OnDemandEconomy($db))->receive(
        (int)$route['target_colony_id'],
        [$good => (float)$route['quantity_acquired']],
        $now
    );
    $returnAt = ($now ?? time()) + fleet_travel_time_3d(
        (float)$fleet['distance_ly'], (float)$fleet['speed_ly_h']
    );
    $db->prepare("UPDATE fleets SET mission='return',cargo_payload='{}',return_time=? WHERE id=?")
        ->execute([gmdate('Y-m-d H:i:s', $returnAt), $fleetId]);
    $scheduledArrival = $route['arrival_at'] ?: ($route['fleet_arrival'] ?? null);
    $routeUpdate = $db->prepare(
        "UPDATE trader_routes SET status = 'delivering', arrival_at = ?, updated_at = ? "
        . 'WHERE id = ? AND status = \'in_transit\''
    );
    $routeUpdate->execute([$scheduledArrival, gmdate('Y-m-d H:i:s', $now ?? time()), (int)$route['id']]);
    if ($routeUpdate->rowCount() !== 1) {
        throw new RuntimeException('Trader route changed before arrival was recorded.');
    }
    $route['status'] = 'delivering';
    $route['arrival_at'] = $scheduledArrival;
    return $route;
}

/** Completed sales retain their real ships until the return flight reaches its depot. */
function trader_return_transports(PDO $db, int $now): void
{
    $statement = $db->prepare(
        "SELECT r.id FROM trader_routes r JOIN fleets f ON f.id=r.fleet_id "
        . "WHERE r.status='completed' AND f.mission='return' AND f.return_time<=? ORDER BY r.id"
    );
    $statement->execute([gmdate('Y-m-d H:i:s', $now)]);
    foreach ($statement->fetchAll(PDO::FETCH_COLUMN) as $id) {
        trader_route_transaction($db, (int)$id, static function () use ($db, $id, $now): void {
            $suffix = $db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $query = $db->prepare(
                "SELECT f.* FROM fleets f JOIN trader_routes r ON r.fleet_id=f.id "
                . "WHERE r.id=? AND r.status='completed' AND f.mission='return' AND f.return_time<=?" . $suffix
            );
            $query->execute([$id, gmdate('Y-m-d H:i:s', $now)]);
            $fleet = $query->fetch(PDO::FETCH_ASSOC);
            if (!$fleet) {
                return;
            }
            $owner = $db->prepare('SELECT user_id FROM colonies WHERE id=?' . $suffix);
            $owner->execute([$fleet['origin_colony_id']]);
            if ((int)$owner->fetchColumn() !== (int)$fleet['user_id']) {
                return;
            }
            $ships = json_decode($fleet['ships_json'], true, 512, JSON_THROW_ON_ERROR);
            foreach ($ships as $type => $count) {
                $db->prepare('UPDATE ships SET count=count+? WHERE colony_id=? AND type=?')
                    ->execute([$count, $fleet['origin_colony_id'], $type]);
            }
            $db->prepare('DELETE FROM fleets WHERE id=?')->execute([$fleet['id']]);
            $db->prepare('UPDATE trader_routes SET fleet_id=NULL WHERE id=?')->execute([$id]);
        });
    }
}

function trader_route_complete(PDO $db, array $route, array $trader, ?int $now = null): void
{
    $target = $route['target'];
    $good = (string)$route['resource_type'];
    $quantity = (float)$route['quantity_acquired'];
    if (!$target || $quantity <= 0 || !array_key_exists($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRICES)) {
        throw new RuntimeException('Delivered trader route has invalid sale data.');
    }

    $priceSold = (float)$route['price_sold'];
    if (!is_finite($priceSold) || $priceSold <= 0) {
        throw new RuntimeException('Trader route sale price must be finite and positive.');
    }
    $revenueCents = (int)$route['buyer_escrow_cents'];
    if (($route['funding_status'] ?? 'legacy') !== 'backed' || $revenueCents <= 0
        || $revenueCents !== (int)round($quantity * $priceSold * 100)) {
        throw new RuntimeException('Trader route has no exact backed buyer obligation.');
    }
    $revenue = \GalaxyQuest\Economy\StandingOrders::money($revenueCents);
    $profitCents = $revenueCents - (int)round($quantity * (float)$route['price_paid'] * 100);
    $profit = \GalaxyQuest\Economy\StandingOrders::money($profitCents);
    $db->prepare(
        'UPDATE npc_traders SET capital_credits = capital_credits + ?, total_profit = total_profit + ? WHERE id = ?'
    )->execute([$revenue, $profit, (int)$trader['id']]);
    $db->prepare(
        "INSERT INTO trader_transactions "
        . "(trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits, target_colony_id) "
        . "VALUES (?, ?, 'sold', ?, ?, ?, ?, ?)"
    )->execute([
        (int)$trader['id'], (int)$route['id'], $good, $quantity, $priceSold, $revenue, (int)$route['target_colony_id'],
    ]);
    $routeUpdate = $db->prepare(
        "UPDATE trader_routes SET status = 'completed', quantity_delivered = ?, price_sold = ?, actual_profit = ?, "
        . "delivered_at = ?, updated_at = ?,buyer_escrow_cents=0,funding_status='settled' "
        . 'WHERE id = ? AND status = \'delivering\''
    );
    $routeUpdate->execute([
        $quantity,
        $priceSold,
        $profit,
        gmdate('Y-m-d H:i:s', $now ?? time()),
        gmdate('Y-m-d H:i:s', $now ?? time()),
        (int)$route['id'],
    ]);
    if ($routeUpdate->rowCount() !== 1) {
        throw new RuntimeException('Trader route changed before completion was recorded.');
    }
    trader_route_release_fleet_slot($db, (int)$trader['id']);
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
        } catch (PDOException $error) {
            throw $error;
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
    return (new \GalaxyQuest\Economy\OnDemandEconomy($db))->transaction(
        static function () use ($db, $trader): bool {
            $current = trader_trader_read($db, (int)$trader['id'], true);
            if (!$current || (int)$current['active_fleets'] >= (int)$current['max_fleets']) {
                return false;
            }
            // Forecasts remain advisory. Only explicit, backed contracts authorize routes.
            $statement = $db->prepare(
                'SELECT s.id source_order_id,b.id target_order_id,s.colony_id source_colony_id,'
                . 'b.colony_id target_colony_id,s.good_type,s.quantity_remaining sell_qty,'
                . 'b.quantity_remaining buy_qty,s.limit_price_cents ask,b.limit_price_cents bid,b.escrow_cents '
                . 'FROM economy_standing_orders s JOIN economy_standing_orders b ON b.good_type=s.good_type '
                . 'JOIN colonies sc ON sc.id=s.colony_id JOIN celestial_bodies sb ON sb.id=sc.body_id '
                . 'JOIN colonies bc ON bc.id=b.colony_id JOIN celestial_bodies bb ON bb.id=bc.body_id '
                . "WHERE s.side='sell' AND b.side='buy' AND s.status='active' AND b.status='active' "
                . 'AND s.quantity_remaining>0 AND b.quantity_remaining>0 AND b.escrow_cents>=b.limit_price_cents '
                . 'AND b.limit_price_cents>s.limit_price_cents AND s.colony_id<>b.colony_id '
                . 'AND (s.paired_order_id IS NULL OR s.paired_order_id=b.id) '
                . 'AND (b.paired_order_id IS NULL OR b.paired_order_id=s.id) '
                . 'AND sb.galaxy_index=bb.galaxy_index AND sb.system_index<>bb.system_index '
                . "AND (?='' OR s.good_type=?) "
                . 'ORDER BY (b.limit_price_cents-s.limit_price_cents) DESC,s.id,b.id LIMIT 20'
            );
            $specialization = (string)($trader['specialization'] ?? '');
            $statement->execute([$specialization, $specialization]);
            foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $pair) {
                if (!isset(\GalaxyQuest\Economy\ColonyEconomySimulation::PRICES[$pair['good_type']])) {
                    continue;
                }
                $quantity = min(
                    (int)$pair['sell_qty'], (int)$pair['buy_qty'], NPC_TRADER_CARGO_CAPACITY,
                    intdiv(\GalaxyQuest\Economy\StandingOrders::capitalCents($current['capital_credits']), (int)$pair['ask']),
                    intdiv((int)$pair['escrow_cents'], (int)$pair['bid'])
                );
                if ($quantity < 1) {
                    continue;
                }
                $db->prepare(
                    'INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,'
                    . 'quantity_planned,expected_profit,status,source_order_id,target_order_id,funding_status) '
                    . "VALUES (?,?,?,?,?,?,'planning',?,?,'backed')"
                )->execute([
                    (int)$current['id'], (int)$pair['source_colony_id'], (int)$pair['target_colony_id'],
                    $pair['good_type'], $quantity, $quantity * ((int)$pair['bid'] - (int)$pair['ask']) / 100,
                    (int)$pair['source_order_id'], (int)$pair['target_order_id'],
                ]);
                $db->prepare('UPDATE npc_traders SET active_fleets=active_fleets+1 WHERE id=?')
                    ->execute([(int)$current['id']]);
                return true;
            }
            return false;
        }
    );
}
