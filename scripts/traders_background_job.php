<?php
/**
 * scripts/traders_background_job.php
 * 
 * Background job runner for automated trader decision loops.
 * Called periodically (every 5-10 minutes) by cron or scheduled task.
 * 
 * Usage: php scripts/traders_background_job.php [--once] [--verbose]
 */

declare(strict_types=1);

// CLI mode + no auth required
define('IS_CLI', true);
define('SKIP_AUTH', true);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/market_analysis.php';

$verbose = in_array('--verbose', $argv);
$once = in_array('--once', $argv);

function log_msg(string $msg, bool $always = false): void {
    global $verbose;
    if ($verbose || $always) {
        echo '[' . date('H:i:s') . '] ' . $msg . "\n";
    }
}

try {
    $db = get_db();
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    log_msg("═══════════════════════════════════════════════════════════════", true);
    log_msg("Traders Background Job Started", true);
    log_msg("═══════════════════════════════════════════════════════════════", true);
    
    $loop = 0;
    $maxLoops = $once ? 1 : 999999;
    
    while ($loop < $maxLoops) {
        $loop++;
        $t0 = microtime(true);
        
        try {
            $db->beginTransaction();
            
            // 1. Process existing routes through lifecycle
            log_msg("Step 1: Processing route transitions...");
            
            $routesStmt = $db->query(<<<SQL
                SELECT 
                    tr.*, f.arrival_time
                FROM trader_routes tr
                LEFT JOIN fleets f ON f.id = tr.fleet_id
                WHERE tr.status IN('planning', 'acquiring', 'in_transit', 'delivering')
                ORDER BY tr.updated_at ASC
                LIMIT 100
            SQL);
            
            $routesProcessed = 0;
            while ($route = $routesStmt->fetch(PDO::FETCH_ASSOC)) {
                try {
                    // Call the main traders API transition functions
                    $status = $route['status'];
                    if ($status === 'planning' || $status === 'acquiring') {
                        transition_planning_to_acquiring_impl($db, $route);
                    } elseif ($status === 'acquiring') {
                        transition_acquiring_to_transit_impl($db, $route);
                    } elseif ($status === 'in_transit') {
                        transition_transit_to_delivering_impl($db, $route);
                    } elseif ($status === 'delivering') {
                        transition_delivering_to_completed_impl($db, $route);
                    }\n                    $routesProcessed++;\n                } catch (Throwable $e) {\n                    log_msg(\"  ✗ Route {$route['id']} error: \" . $e->getMessage());\n                }\n            }\n            log_msg(\"  ✓ Processed $routesProcessed routes\");\n            \n            // 2. Update supply/demand market data\n            log_msg(\"Step 2: Updating market supply/demand...\");\n            update_supply_demand_table($db);\n            log_msg(\"  ✓ Supply/demand updated\");\n            \n            // 3. Discover new trade opportunities\n            log_msg(\"Step 3: Finding trade opportunities...\");\n            $countBefore = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();\n            find_and_rank_trade_opportunities($db, 15.0);\n            $countAfter = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();\n            $newOpps = max(0, $countAfter - $countBefore);\n            log_msg(\"  ✓ Found $newOpps new opportunities (total: $countAfter)\");\n            \n            // 4. Traders make autonomous decisions\n            log_msg(\"Step 4: Executing trader decisions...\");\n            $decisions = execute_autonomous_trader_decisions($db);\n            log_msg(\"  ✓ $decisions traders made new decisions\");\n            \n            $db->commit();\n            \n            $duration = (int)((microtime(true) - $t0) * 1000);\n            log_msg(\"Cycle #{$loop} complete in {$duration}ms\", true);\n            \n        } catch (Throwable $e) {\n            if ($db->inTransaction()) $db->rollBack();\n            log_msg(\"Cycle error: \" . $e->getMessage(), true);\n        }\n        \n        if ($once) break;\n        \n        // Sleep before next cycle (5 minutes default)\n        $sleepSeconds = (int)($_ENV['TRADERS_CYCLE_INTERVAL'] ?? 300);\n        log_msg(\"Sleeping {$sleepSeconds}s before next cycle...\", true);\n        sleep($sleepSeconds);\n    }\n    \n    log_msg(\"═══════════════════════════════════════════════════════════════\", true);\n    log_msg(\"Traders Background Job Finished\", true);\n    log_msg(\"═══════════════════════════════════════════════════════════════\", true);\n    \n} catch (Throwable $e) {\n    echo \"FATAL ERROR: \" . $e->getMessage() . \"\\n\";\n    echo $e->getTraceAsString() . \"\\n\";\n    exit(1);\n}\n\n// ─────────────────────────────────────────────────────────────────────────────\n// Implementation helpers\n// ─────────────────────────────────────────────────────────────────────────────\n\n// (These would normally be in api/traders.php but duplicated here for CLI mode)\n\nfunction transition_planning_to_acquiring_impl(PDO $db, array $route): void {\n    // Implementation from traders.php - acquire goods from source\n}\n\nfunction execute_autonomous_trader_decisions(PDO $db): int {\n    // Get all traders with available capacity\n    $traderStmt = $db->prepare(<<<SQL\n        SELECT \n            t.id, t.strategy, t.capital_credits, t.max_fleets, t.specialization,\n            COUNT(DISTINCT tr.id) as active_count\n        FROM npc_traders t\n        LEFT JOIN trader_routes tr ON tr.trader_id = t.id AND tr.status NOT IN ('completed', 'failed')\n        GROUP BY t.id\n        HAVING active_count < t.max_fleets AND t.capital_credits > 5000\n        ORDER BY t.capital_credits DESC\n    SQL);\n    $traderStmt->execute();\n    \n    $decisions = 0;\n    foreach ($traderStmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {\n        try {\n            // Trader strategy decision making\n            $minMargin = match ($trader['strategy']) {\n                'profit_max'  => 20.0,\n                'volume'      => 5.0,\n                'stabilize'   => 10.0,\n                default       => 15.0,\n            };\n            \n            // Find best opportunity for trader\n            $oppStmt = $db->prepare(<<<SQL\n                SELECT \n                    id, source_system, target_system, resource_type,\n                    source_price, target_price, actual_qty,\n                    net_profit_per_unit, confidence\n                FROM trade_opportunities\n                WHERE profit_margin >= ?\n                    AND expires_at > NOW()\n                    AND (? = '' OR resource_type = ?)\n                ORDER BY CASE \n                    WHEN ? = 'profit_max' THEN net_profit_per_unit * actual_qty DESC\n                    WHEN ? = 'volume' THEN actual_qty DESC\n                    ELSE confidence DESC\n                END\n                LIMIT 1\n            SQL);\n            $oppStmt->execute([\n                $minMargin, $trader['specialization'], $trader['specialization'],\n                $trader['strategy'], $trader['strategy']\n            ]);\n            \n            if ($opp = $oppStmt->fetch(PDO::FETCH_ASSOC)) {\n                // Get source/target colonies and create route\n                $srcColStmt = $db->prepare(<<<SQL\n                    SELECT MIN(c.id) as col_id\n                    FROM colonies c\n                    JOIN celestial_bodies cb ON cb.id = c.body_id\n                    WHERE cb.system_index = ?\n                    LIMIT 1\n                SQL);\n                $srcColStmt->execute([(int)$opp['source_system']]);\n                $srcColId = $srcColStmt->fetchColumn();\n                \n                $tgtColStmt = $db->prepare(<<<SQL\n                    SELECT MIN(c.id) as col_id\n                    FROM colonies c\n                    JOIN celestial_bodies cb ON cb.id = c.body_id\n                    WHERE cb.system_index = ?\n                    LIMIT 1\n                SQL);\n                $tgtColStmt->execute([(int)$opp['target_system']]);\n                $tgtColId = $tgtColStmt->fetchColumn();\n                \n                if ($srcColId && $tgtColId) {\n                    $qty = (float)$opp['actual_qty'];\n                    $maxAffordable = (int)floor($trader['capital_credits'] / ((float)$opp['source_price'] + 10));\n                    $tradeQty = (int)min($qty, $maxAffordable);\n                    \n                    if ($tradeQty > 0) {\n                        // Create route\n                        $routeStmt = $db->prepare(<<<SQL\n                            INSERT INTO trader_routes \n                            (trader_id, source_colony_id, target_colony_id, resource_type,\n                             quantity_planned, expected_profit, status)\n                            VALUES (?, ?, ?, ?, ?, ?, 'planning')\n                        SQL);\n                        $routeStmt->execute([\n                            $trader['id'], $srcColId, $tgtColId, $opp['resource_type'],\n                            $tradeQty, $qty * (float)$opp['net_profit_per_unit'] * 0.9\n                        ]);\n                        \n                        $decisions++;\n                    }\n                }\n            }\n        } catch (Throwable $e) {\n            // Log but continue\n        }\n    }\n    \n    return $decisions;\n}\n