<?php
/**
 * api/traders_dashboard.php — Traders System Dashboard API
 * 
 * Provides real-time trader status, route tracking, and market insights
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? '';
$db = get_db();

try {
    match ($action) {
        'trader_status'       => action_trader_status($db),
        'route_summary'       => action_route_summary($db),
        'leaderboard'         => action_leaderboard($db),
        'market_snapshot'     => action_market_snapshot($db),
        'trader_history'      => action_trader_history($db),
        'opportunity_alerts'  => action_opportunity_alerts($db),
        default => json_error("Unknown action: $action", 400),
    };
} catch (Throwable $e) {
    error_log("traders_dashboard.php error: " . $e->getMessage());
    json_error($e->getMessage(), 500);
}

/**
 * GET /api/traders_dashboard.php?action=trader_status&trader_id=1
 * Returns comprehensive trader profile with statistics
 */
function action_trader_status(PDO $db): never {
    $traderId = (int)($_GET['trader_id'] ?? 0);
    if (!$traderId) {
        json_error('trader_id required', 400);
    }
    
    $trader = $db->prepare(<<<SQL
        SELECT 
            t.id, t.name, t.faction_id, t.strategy, t.specialization,
            t.capital_credits, t.total_profit, t.max_fleets, t.active_fleets,
            COUNT(DISTINCT CASE WHEN tr.status != 'completed' AND tr.status != 'failed' THEN tr.id END) as active_routes,
            COUNT(DISTINCT CASE WHEN tr.status = 'completed' THEN tr.id END) as completed_routes,
            COUNT(DISTINCT CASE WHEN tr.status = 'failed' THEN tr.id END) as failed_routes,
            SUM(CASE WHEN tr.status = 'completed' THEN tr.actual_profit ELSE 0 END) as realized_profit,
            SUM(CASE WHEN tr.status != 'completed' AND tr.status != 'failed' THEN tr.expected_profit ELSE 0 END) as pending_profit,
            AVG(CASE WHEN tr.status = 'completed' THEN tr.actual_profit ELSE NULL END) as avg_profit_per_route,
            f.name as faction_name
        FROM npc_traders t
        LEFT JOIN trader_routes tr ON tr.trader_id = t.id
        LEFT JOIN npc_factions f ON f.id = t.faction_id
        WHERE t.id = ?
        GROUP BY t.id
    SQL);
    $trader->execute([$traderId]);
    $data = $trader->fetch(PDO::FETCH_ASSOC);
    
    if (!$data) {
        json_error("Trader not found", 404);
    }
    
    // Get active routes
    $routes = $db->prepare(<<<SQL
        SELECT 
            id, source_colony_id, target_colony_id, resource_type, status,
            quantity_planned, quantity_acquired, quantity_delivered,
            price_paid, price_sold, expected_profit, actual_profit,
            TIMESTAMPDIFF(MINUTE, NOW(), arrival_at) as arrival_in_minutes
        FROM trader_routes
        WHERE trader_id = ? AND status NOT IN ('completed', 'failed')
        ORDER BY updated_at DESC
        LIMIT 10
    SQL);
    $routes->execute([$traderId]);
    
    json_ok([
        'trader' => [
            'id' => (int)$data['id'],
            'name' => $data['name'],
            'faction' => $data['faction_name'],
            'strategy' => $data['strategy'],
            'specialization' => $data['specialization'],
        ],
        'finances' => [
            'capital' => (float)$data['capital_credits'],
            'total_profit' => (float)$data['total_profit'],
            'realized_profit' => (float)($data['realized_profit'] ?: 0),
            'pending_profit' => (float)($data['pending_profit'] ?: 0),
        ],
        'capacity' => [
            'max_fleets' => (int)$data['max_fleets'],
            'active_fleets' => (int)$data['active_fleets'],
            'available_slots' => max(0, (int)$data['max_fleets'] - (int)$data['active_fleets']),
        ],
        'statistics' => [
            'active_routes' => (int)($data['active_routes'] ?: 0),
            'completed_routes' => (int)($data['completed_routes'] ?: 0),
            'failed_routes' => (int)($data['failed_routes'] ?: 0),
            'success_rate' => array_sum([0, (int)($data['completed_routes'] ?: 0)]) > 0 
                ? round((int)($data['completed_routes'] ?: 0) / (array_sum([0, (int)($data['completed_routes'] ?: 0), (int)($data['failed_routes'] ?: 0)])) * 100, 1)
                : 0,
            'avg_profit' => (float)($data['avg_profit_per_route'] ?: 0),
        ],
        'active_routes' => $routes->fetchAll(PDO::FETCH_ASSOC),
    ]);
}

/**
 * GET /api/traders_dashboard.php?action=route_summary
 * Aggregated stats for all active routes
 */
function action_route_summary(PDO $db): never {
    $summary = $db->query(<<<SQL
        SELECT 
            status,
            COUNT(*) as count,
            SUM(quantity_acquired) as total_qty,
            AVG(actual_profit) as avg_profit,
            SUM(CASE WHEN status='completed' THEN actual_profit ELSE 0 END) as total_profit
        FROM trader_routes
        WHERE status IN('acquiring', 'in_transit', 'delivering', 'completed')
        GROUP BY status
    SQL)->fetchAll(PDO::FETCH_ASSOC);
    
    $totals = $db->query(<<<SQL
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
            SUM(actual_profit) as total_profit
        FROM trader_routes
    SQL)->fetch(PDO::FETCH_ASSOC);
    
    json_ok([
        'by_status' => $summary,
        'totals' => [
            'total_routes' => (int)$totals['total'],
            'completed' => (int)$totals['completed'],
            'failed' => (int)$totals['failed'],
            'total_profit' => (float)($totals['total_profit'] ?: 0),
        ],
    ]);
}

/**
 * GET /api/traders_dashboard.php?action=leaderboard&limit=10
 * Top traders by profit, volume, success rate
 */
function action_leaderboard(PDO $db): never {
    $limit = (int)($_GET['limit'] ?? 10);
    
    $byProfit = $db->prepare(<<<SQL
        SELECT id, name, total_profit, capital_credits
        FROM npc_traders
        WHERE total_profit > 0
        ORDER BY total_profit DESC
        LIMIT ?
    SQL);
    $byProfit->execute([$limit]);
    
    json_ok([
        'by_profit' => $byProfit->fetchAll(PDO::FETCH_ASSOC),
        'generated_at' => date('Y-m-d H:i:s'),
    ]);
}

/**
 * GET /api/traders_dashboard.php?action=market_snapshot
 * Current supply/demand state across systems
 */
function action_market_snapshot(PDO $db): never {
    $systems = $db->query(<<<SQL
        SELECT 
            galaxy_index, system_index, resource_type,
            available_supply, desired_demand, net_balance,
            updated_at
        FROM market_supply_demand
        WHERE updated_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ORDER BY ABS(net_balance) DESC
        LIMIT 50
    SQL)->fetchAll(PDO::FETCH_ASSOC);
    
    json_ok([
        'systems' => $systems,
        'snapshot_time' => date('Y-m-d H:i:s'),
    ]);
}

/**
 * GET /api/traders_dashboard.php?action=trader_history&trader_id=1&days=7
 * Historical trader performance
 */
function action_trader_history(PDO $db): never {
    $traderId = (int)($_GET['trader_id'] ?? 0);
    $days = (int)($_GET['days'] ?? 7);
    
    if (!$traderId) {
        json_error('trader_id required', 400);
    }
    
    $history = $db->prepare(<<<SQL
        SELECT 
            DATE(delivered_at) as date,
            COUNT(*) as routes_completed,
            SUM(quantity_delivered) as total_qty,
            SUM(actual_profit) as daily_profit
        FROM trader_routes
        WHERE trader_id = ? AND status = 'completed' AND delivered_at > DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(delivered_at)
        ORDER BY date DESC
    SQL);
    $history->execute([$traderId, $days]);
    
    json_ok([
        'trader_id' => $traderId,
        'period_days' => $days,
        'daily_summary' => $history->fetchAll(PDO::FETCH_ASSOC),
    ]);
}

/**
 * GET /api/traders_dashboard.php?action=opportunity_alerts&threshold=20
 * High-profit opportunities requiring immediate trader attention
 */
function action_opportunity_alerts(PDO $db): never {
    $threshold = (float)($_GET['threshold'] ?? 20.0);
    
    $alerts = $db->prepare(<<<SQL
        SELECT 
            id, source_system, target_system, resource_type,
            profit_margin, actual_qty, confidence,
            TIMESTAMPDIFF(MINUTE, NOW(), expires_at) as minutes_remaining
        FROM trade_opportunities
        WHERE profit_margin >= ? AND expires_at > NOW()
        ORDER BY profit_margin DESC, confidence DESC
        LIMIT 20
    SQL);
    $alerts->execute([$threshold]);
    $rows = $alerts->fetchAll(PDO::FETCH_ASSOC);
    
    json_ok([
        'threshold_margin' => $threshold,
        'alerts' => $rows,
        'alert_count' => count($rows),
    ]);
}
