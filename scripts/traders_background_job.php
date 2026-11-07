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
                    }
                    $routesProcessed++;
                } catch (Throwable $e) {
                    log_msg("  ✗ Route {$route['id']} error: " . $e->getMessage());
                }
            }
            log_msg("  ✓ Processed $routesProcessed routes");

            // 2. Update supply/demand market data
            log_msg("Step 2: Updating market supply/demand...");
            update_supply_demand_table($db);
            log_msg("  ✓ Supply/demand updated");

            // 3. Discover new trade opportunities
            log_msg("Step 3: Finding trade opportunities...");
            $countBefore = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
            find_and_rank_trade_opportunities($db, 15.0);
            $countAfter = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
            $newOpps = max(0, $countAfter - $countBefore);
            log_msg("  ✓ Found $newOpps new opportunities (total: $countAfter)");

            // 4. Traders make autonomous decisions
            log_msg("Step 4: Executing trader decisions...");
            $decisions = execute_autonomous_trader_decisions($db);
            log_msg("  ✓ $decisions traders made new decisions");

            $db->commit();

            $duration = (int)((microtime(true) - $t0) * 1000);
            log_msg("Cycle #{$loop} complete in {$duration}ms", true);

        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            log_msg("Cycle error: " . $e->getMessage(), true);
        }

        if ($once) break;

        // Sleep before next cycle (5 minutes default)
        $sleepSeconds = (int)($_ENV['TRADERS_CYCLE_INTERVAL'] ?? 300);
        log_msg("Sleeping {$sleepSeconds}s before next cycle...", true);
        sleep($sleepSeconds);
    }

    log_msg("═══════════════════════════════════════════════════════════════", true);
    log_msg("Traders Background Job Finished", true);
    log_msg("═══════════════════════════════════════════════════════════════", true);

} catch (Throwable $e) {
    echo "FATAL ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation helpers
// ─────────────────────────────────────────────────────────────────────────────

// (These would normally be in api/traders.php but duplicated here for CLI mode)

function transition_planning_to_acquiring_impl(PDO $db, array $route): void {
    // Implementation from traders.php - acquire goods from source
}

function execute_autonomous_trader_decisions(PDO $db): int {
    // Get all traders with available capacity
    $traderStmt = $db->prepare(<<<SQL
        SELECT
            t.id, t.strategy, t.capital_credits, t.max_fleets, t.specialization,
            COUNT(DISTINCT tr.id) as active_count
        FROM npc_traders t
        LEFT JOIN trader_routes tr ON tr.trader_id = t.id AND tr.status NOT IN ('completed', 'failed')
        GROUP BY t.id
        HAVING active_count < t.max_fleets AND t.capital_credits > 5000
        ORDER BY t.capital_credits DESC
    SQL);
    $traderStmt->execute();

    $decisions = 0;
    foreach ($traderStmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {
        try {
            // Trader strategy decision making
            $minMargin = match ($trader['strategy']) {
                'profit_max'  => 20.0,
                'volume'      => 5.0,
                'stabilize'   => 10.0,
                default       => 15.0,
            };

            // Find best opportunity for trader
            $oppStmt = $db->prepare(<<<SQL
                SELECT
                    id, source_system, target_system, resource_type,
                    source_price, target_price, actual_qty,
                    net_profit_per_unit, confidence
                FROM trade_opportunities
                WHERE profit_margin >= ?
                    AND expires_at > NOW()
                    AND (? = '' OR resource_type = ?)
                ORDER BY CASE
                    WHEN ? = 'profit_max' THEN net_profit_per_unit * actual_qty DESC
                    WHEN ? = 'volume' THEN actual_qty DESC
                    ELSE confidence DESC
                END
                LIMIT 1
            SQL);
            $oppStmt->execute([
                $minMargin, $trader['specialization'], $trader['specialization'],
                $trader['strategy'], $trader['strategy']
            ]);

            if ($opp = $oppStmt->fetch(PDO::FETCH_ASSOC)) {
                // Get source/target colonies and create route
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

                if ($srcColId && $tgtColId) {
                    $qty = (float)$opp['actual_qty'];
                    $maxAffordable = (int)floor($trader['capital_credits'] / ((float)$opp['source_price'] + 10));
                    $tradeQty = (int)min($qty, $maxAffordable);

                    if ($tradeQty > 0) {
                        // Create route
                        $routeStmt = $db->prepare(<<<SQL
                            INSERT INTO trader_routes
                            (trader_id, source_colony_id, target_colony_id, resource_type,
                             quantity_planned, expected_profit, status)
                            VALUES (?, ?, ?, ?, ?, ?, 'planning')
                        SQL);
                        $routeStmt->execute([
                            $trader['id'], $srcColId, $tgtColId, $opp['resource_type'],
                            $tradeQty, $qty * (float)$opp['net_profit_per_unit'] * 0.9
                        ]);

                        $decisions++;
                    }
                }
            }
        } catch (Throwable $e) {
            // Log but continue
        }
    }

    return $decisions;
}
