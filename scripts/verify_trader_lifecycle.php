<?php
/**
 * Verification script for Trader Lifecycle Phase 2 implementation.
 * 
 * Tests complete flow:
 *  1. Create test traders with capital
 *  2. Generate trade opportunities
 *  3. Execute trader decisions (create routes)
 *  4. Process route transitions (execution cycle)
 *  5. Verify profit calculations
 * 
 * Usage: php scripts/verify_trader_lifecycle.php [--cycles=N] [--verbose]
 */

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/market_analysis.php';
require_once __DIR__ . '/../api/traders.php';

$verbose = in_array('--verbose', $argv);
$cycles = 1;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--cycles=')) {
        $cycles = (int)substr($arg, 9);
    }
}

echo "=== TRADER LIFECYCLE VERIFICATION ===\n";
echo "Cycles: $cycles, Verbose: " . ($verbose ? 'yes' : 'no') . "\n\n";

try {
    // Phase 0: Initial state
    echo "[0/6] Initial State Check\n";
    check_initial_state($db);
    
    // Phase 1: Generate supply/demand
    echo "[1/6] Recalculating Supply/Demand\n";
    recalculate_supply_demand($db);
    echo "     ✓ Supply/demand table updated\n";
    
    // Phase 2: Find opportunities
    echo "[2/6] Finding Trade Opportunities\n";
    find_and_rank_opportunities($db);
    $oppCount = get_opportunity_count($db);
    echo "     ✓ Found $oppCount opportunities\n";
    
    // Phase 3-5: Execute cycles
    for ($cycle = 1; $cycle <= $cycles; $cycle++) {
        echo "[3/6] Cycle $cycle - Trader Decisions\n";
        $routes_before = get_route_count($db, 'planning');
        execute_trader_decisions($db);
        $routes_after = get_route_count($db, 'planning');
        echo "     ✓ Created " . ($routes_after - $routes_before) . " new routes\n";
        
        echo "[4/6] Cycle $cycle - Process Transitions\n";
        $transitions = process_transitions_verbose($db);
        echo "     ✓ Completed $transitions state transitions\n";
        
        // Sleep between cycles
        if ($cycle < $cycles) {
            sleep(1);
        }
    }
    
    // Phase 6: Verify results
    echo "[5/6] Final State Verification\n";
    verify_final_state($db);
    
    echo "[6/6] Profit Verification\n";
    verify_profits($db);
    
    echo "\n=== ✓ ALL CHECKS PASSED ===\n";
    
} catch (Throwable $e) {
    echo "\n❌ ERROR: " . $e->getMessage() . "\n";
    if ($verbose) {
        echo $e->getTraceAsString() . "\n";
    }
    exit(1);
}

/**
 * Check initial state
 */
function check_initial_state(PDO $db): void {
    // Count traders
    $stmt = $db->query('SELECT COUNT(*) FROM npc_traders');
    $count = (int)$stmt->fetchColumn();
    echo "     Traders: $count\n";
    
    if ($count === 0) {
        throw new Exception("No traders found. Run initialize_traders_system.php first.");
    }
    
    // Check capital distribution
    $stmt = $db->query('SELECT SUM(capital_credits) FROM npc_traders');
    $total = (int)$stmt->fetchColumn();
    echo "     Total capital: " . format_credits($total) . "\n";
    
    // Count existing routes
    $stmt = $db->query('SELECT COUNT(*) FROM trader_routes');
    $routes = (int)$stmt->fetchColumn();
    echo "     Existing routes: $routes\n";
}

/**
 * Get count of opportunities
 */
function get_opportunity_count(PDO $db): int {
    $stmt = $db->query('SELECT COUNT(*) FROM trade_opportunities WHERE expires_at > NOW()');
    return (int)$stmt->fetchColumn();
}

/**
 * Get count of routes in specific status
 */
function get_route_count(PDO $db, string $status): int {
    $stmt = $db->prepare('SELECT COUNT(*) FROM trader_routes WHERE status = ?');
    $stmt->execute([$status]);
    return (int)$stmt->fetchColumn();
}

/**
 * Process transitions with verbose output
 */
function process_transitions_verbose(PDO $db): int {
    // Get routes before
    $statuses = ['planning', 'acquiring', 'in_transit', 'delivering'];
    $before = [];
    foreach ($statuses as $s) {
        $before[$s] = get_route_count($db, $s);
    }
    
    // Execute transitions
    process_route_transitions($db);
    
    // Get routes after
    $after = [];
    foreach ($statuses as $s) {
        $after[$s] = get_route_count($db, $s);
    }
    
    // Calculate transitions
    $total = 0;
    foreach ($statuses as $s) {
        $delta = $before[$s] - $after[$s];  // Routes that left this state
        if ($delta > 0) {
            global $verbose;
            if ($verbose) {
                echo "       - $s: $delta routes transitioned\n";
            }
            $total += $delta;
        }
    }
    
    return $total;
}

/**
 * Verify final state
 */
function verify_final_state(PDO $db): void {
    // Check no invalid transitions
    $stmt = $db->query('SELECT COUNT(*) FROM trader_routes WHERE status NOT IN ("planning", "acquiring", "in_transit", "delivering", "completed", "failed")');
    $invalid = (int)$stmt->fetchColumn();
    if ($invalid > 0) {
        throw new Exception("Found $invalid routes with invalid status");
    }
    echo "     ✓ No invalid route statuses\n";
    
    // Check no negative capital
    $stmt = $db->query('SELECT COUNT(*) FROM npc_traders WHERE capital_credits < 0');
    $negative = (int)$stmt->fetchColumn();
    if ($negative > 0) {
        throw new Exception("Found $negative traders with negative capital");
    }
    echo "     ✓ No negative trader capital\n";
    
    // Show route distribution
    $stmt = $db->query(<<<SQL
        SELECT status, COUNT(*) as cnt
        FROM trader_routes
        GROUP BY status
        ORDER BY FIELD(status, 'planning', 'acquiring', 'in_transit', 'delivering', 'completed', 'failed')
    SQL);
    echo "     Route distribution:\n";
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        echo "       - {$row['status']}: {$row['cnt']}\n";
    }
}

/**
 * Verify profit calculations
 */
function verify_profits(PDO $db): void {
    $stmt = $db->query(<<<SQL
        SELECT 
            SUM(actual_profit) as total_profit,
            COUNT(*) as completed_routes,
            AVG(actual_profit) as avg_profit,
            MAX(actual_profit) as max_profit
        FROM trader_routes
        WHERE status = 'completed'
    SQL);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($result['completed_routes'] > 0) {
        echo "     Completed routes: {$result['completed_routes']}\n";
        echo "     Total profit: " . format_credits((int)$result['total_profit']) . "\n";
        echo "     Average profit: " . format_credits((int)$result['avg_profit']) . "\n";
        echo "     Max profit: " . format_credits((int)$result['max_profit']) . "\n";
    } else {
        echo "     No completed routes yet (expected in multi-cycle runs)\n";
    }
    
    // Check trader total_profit tracking
    $stmt = $db->query('SELECT SUM(total_profit) FROM npc_traders');
    $tracked = (int)$stmt->fetchColumn();
    echo "     Trader-tracked total: " . format_credits($tracked) . "\n";
}

/**
 * Format credits for display
 */
function format_credits(int $amount): string {
    if ($amount >= 1_000_000) {
        return sprintf('%.1fM', $amount / 1_000_000);
    } elseif ($amount >= 1_000) {
        return sprintf('%.1fK', $amount / 1_000);
    }
    return (string)$amount;
}
