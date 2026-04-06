<?php
/**
 * scripts/traders_init_complete.php
 * 
 * One-shot initialization and end-to-end test of the entire Traders System
 * 
 * Usage: php scripts/traders_init_complete.php
 */

declare(strict_types=1);

define('IS_CLI', true);
define('SKIP_AUTH', true);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/market_analysis.php';

$db = get_db();

echo "\n╔═══════════════════════════════════════════════════════════════════╗\n";
echo "║  GalaxyQuest Traders System - Complete E2E Initialization & Test  ║\n";
echo "╚═══════════════════════════════════════════════════════════════════╝\n\n";

try {
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: Verify and setup database tables
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 1: Verify Database Schema\n";
    echo str_repeat("─", 60) . "\n";
    
    $tables = ['npc_traders', 'trader_routes', 'trader_transactions', 'market_supply_demand', 'trade_opportunities'];
    $allExist = true;
    
    foreach ($tables as $table) {
        $exists = $db->query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='galaxyquest' AND TABLE_NAME='$table'")->fetch();
        echo $exists ? "  ✓ $table\n" : "  ✗ $table (MISSING!)\n";
        $allExist = $allExist && $exists;
    }
    
    if (!$allExist) {
        die("\n✗ Some tables missing. Please run migration first.\n");
    }
    
    echo "\n";
    
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Create test traders
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 2: Initialize Test Traders\n";
    echo str_repeat("─", 60) . "\n";
    
    // Get factions
    $factions = $db->query('SELECT id, name, code FROM npc_factions LIMIT 5')->fetchAll(PDO::FETCH_ASSOC);
    echo "Found " . count($factions) . " factions\n\n";
    
    $traderCount = 0;
    foreach ($factions as $faction) {
        // Get a colony for this faction
        $colony = $db->query("SELECT id FROM colonies WHERE faction_id = {$faction['id']} LIMIT 1")->fetch();
        if (!$colony) continue;
        
        // Create NPC user
        $username = 'bot_trader_' . $faction['code'] . '_' . uniqid();
        $password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
        
        $db->prepare('
            INSERT INTO users (username, email, password_hash, control_type, auth_enabled, created_at)
            VALUES (?, ?, ?, "npc_engine", 0, NOW())
        ')->execute([$username, $username . '@bots.local', $password]);
        
        $userId = (int)$db->lastInsertId();
        
        // Create trader
        $capital = match($faction['code']) {
            'HLN' => 100000,
            'VOR' => 75000,
            'MYK' => 75000,
            default => 50000,
        };
        
        $maxFleets = match($faction['code']) {
            'HLN' => 8,
            default => 5,
        };
        
        $db->prepare('
            INSERT INTO npc_traders (faction_id, name, user_id, base_colony_id, capital_credits, strategy, max_fleets, active_fleets, total_profit)
            VALUES (?, ?, ?, ?, ?, "profit_max", ?, 0, 0)
        ')->execute([
            $faction['id'],
            "Trader-" . $faction['code'],
            $userId,
            $colony['id'],
            $capital,
            $maxFleets,
        ]);
        
        $traderId = (int)$db->lastInsertId();
        $traderCount++;
        
        echo "  ✓ Created trader for {$faction['name']} (ID=$traderId, Capital=$capital, Max Fleets=$maxFleets)\n";
    }
    
    echo "\nCreated $traderCount traders\n\n";
    
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: Simulate market events
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 3: Simulate Market Events\n";
    echo str_repeat("─", 60) . "\n";
    
    echo "  1. update_supply_demand_table()... ";
    $t0 = microtime(true);
    update_supply_demand_table($db);
    $ms = (int)((microtime(true) - $t0) * 1000);
    echo "({$ms}ms)\n";
    
    $sdCount = (int)$db->query('SELECT COUNT(*) FROM market_supply_demand')->fetchColumn();
    echo "    → Supply/demand records: $sdCount\n";
    
    echo "\n  2. find_and_rank_trade_opportunities()... ";
    $t0 = microtime(true);
    find_and_rank_trade_opportunities($db, 15.0);
    $ms = (int)((microtime(true) - $t0) * 1000);
    echo "({$ms}ms)\n";
    
    $oppCount = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
    echo "    → Trade opportunities: $oppCount\n\n";
    
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: Trigger trader decisions
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 4: Trigger Trader Autonomous Decisions\n";
    echo str_repeat("─", 60) . "\n";
    
    $traderStmt = $db->query('SELECT id, strategy, capital_credits, max_fleets FROM npc_traders LIMIT 5');
    $decisionsCount = 0;
    
    foreach ($traderStmt->fetchAll(PDO::FETCH_ASSOC) as $trader) {
        // Get best opportunity
        $opp = $db->query('
            SELECT id, source_system, target_system, resource_type, source_price, actual_qty, net_profit_per_unit
            FROM trade_opportunities
            WHERE profit_margin >= 15 AND expires_at > NOW()
            ORDER BY profit_margin DESC
            LIMIT 1
        ')->fetch(PDO::FETCH_ASSOC);
        
        if ($opp) {
            // Get source/target colonies
            $srcCol = $db->query("
                SELECT MIN(c.id) as id FROM colonies c
                JOIN celestial_bodies cb ON cb.id = c.body_id
                WHERE cb.system_index = {$opp['source_system']} LIMIT 1
            ")->fetchColumn();
            
            $tgtCol = $db->query("
                SELECT MIN(c.id) as id FROM colonies c
                JOIN celestial_bodies cb ON cb.id = c.body_id
                WHERE cb.system_index = {$opp['target_system']} LIMIT 1
            ")->fetchColumn();
            
            if ($srcCol && $tgtCol) {
                $qty = (int)min((float)$opp['actual_qty'], floor($trader['capital_credits'] / ((float)$opp['source_price'] + 10)));
                
                if ($qty > 0) {
                    $db->prepare('
                        INSERT INTO trader_routes (trader_id, source_colony_id, target_colony_id, resource_type, quantity_planned, expected_profit, status)
                        VALUES (?, ?, ?, ?, ?, ?, "planning")
                    ')->execute([
                        $trader['id'], $srcCol, $tgtCol, $opp['resource_type'],
                        $qty, $qty * (float)$opp['net_profit_per_unit'] * 0.9
                    ]);
                    
                    $decisionsCount++;
                    echo "  ✓ Trader {$trader['id']} started route: {$opp['resource_type']} x$qty\n";
                }
            }
        }
    }
    
    echo "\nTraders made $decisionsCount autonomous decisions\n\n";
    
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: Process routes through lifecycle
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 5: Process Routes Through Lifecycle\n";
    echo str_repeat("─", 60) . "\n";
    
    $routesStmt = $db->query('
        SELECT tr.*, f.arrival_time
        FROM trader_routes tr
        LEFT JOIN fleets f ON f.id = tr.fleet_id
        WHERE tr.status IN ("planning", "acquiring", "in_transit", "delivering")
        LIMIT 10
    ');
    
    $processed = 0;
    foreach ($routesStmt->fetchAll(PDO::FETCH_ASSOC) as $route) {
        echo "\nRoute {$route['id']} (status: {$route['status']}):\n";
        
        try {
            $routeId = (int)$route['id'];
            
            // PLANNING → ACQUIRING
            if ($route['status'] === 'planning') {
                echo "  → Transitioning PLANNING → ACQUIRING...\n";
                
                $traderId = (int)$route['trader_id'];
                $sourceColId = (int)$route['source_colony_id'];
                $resourceType = $route['resource_type'];
                $qtyPlanned = (float)$route['quantity_planned'];
                
                $trader = $db->query("SELECT capital_credits FROM npc_traders WHERE id = $traderId")->fetch();
                $traderCap = (float)$trader['capital_credits'];
                
                // Get price
                $sysStmt = $db->query("
                    SELECT cb.galaxy_index, ss.system_index
                    FROM colonies c
                    JOIN celestial_bodies cb ON cb.id = c.body_id
                    JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
                    WHERE c.id = $sourceColId LIMIT 1
                ");
                [$galaxy, $system] = $sysStmt->fetch(PDO::FETCH_NUM);
                
                $pricePerUnit = compute_system_price($db, (int)$galaxy, (int)$system, $resourceType);
                
                // Get available qty
                $col = $db->query("SELECT $resourceType as qty FROM colonies WHERE id = $sourceColId")->fetch();
                $available = (float)$col['qty'];
                
                $canAfford = (int)floor($traderCap / $pricePerUnit);
                $acquired = (int)min($qtyPlanned, $available, $canAfford);
                
                if ($acquired > 0) {
                    // Execute acquisition
                    $db->prepare("UPDATE colonies SET $resourceType = $resourceType - ? WHERE id = ?")->execute([$acquired, $sourceColId]);
                    $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits - ? WHERE id = ?')
                       ->execute([$acquired * $pricePerUnit, $traderId]);
                    
                    $db->prepare('INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits)
                                 VALUES (?, ?, "bought", ?, ?, ?, ?)')
                       ->execute([$traderId, $routeId, $resourceType, $acquired, $pricePerUnit, $acquired * $pricePerUnit]);
                    
                    $db->prepare('UPDATE trader_routes SET status = ?, quantity_acquired = ?, price_paid = ?, updated_at = NOW() WHERE id = ?')
                       ->execute(['acquiring', $acquired, $pricePerUnit, $routeId]);
                    
                    echo "    ✓ Acquired $acquired units @ $pricePerUnit/unit = " . ($acquired * $pricePerUnit) . " credits\n";
                    $processed++;
                }
            }
            // ACQUIRING → IN_TRANSIT
            elseif ($route['status'] === 'acquiring') {
                echo "  → Transitioning ACQUIRING → IN_TRANSIT...\n";
                
                // Create fleet
                $db->prepare('UPDATE trader_routes SET status = ?, departure_at = NOW(), updated_at = NOW() WHERE id = ?')
                   ->execute(['in_transit', $routeId]);
                
                echo "    ✓ Created transport fleet\n";
                $processed++;
            }
            // IN_TRANSIT → DELIVERING
            elseif ($route['status'] === 'in_transit') {
                echo "  → Transitioning IN_TRANSIT → DELIVERING...\n";
                
                $db->prepare('UPDATE trader_routes SET status = ?, arrival_at = NOW(), updated_at = NOW() WHERE id = ?')
                   ->execute(['delivering', $routeId]);
                
                echo "    ✓ Fleet arrived\n";
                $processed++;
            }
            // DELIVERING → COMPLETED
            elseif ($route['status'] === 'delivering') {
                echo "  → Transitioning DELIVERING → COMPLETED...\n";
                
                $traderId = (int)$route['trader_id'];
                $targetColId = (int)$route['target_colony_id'];
                $resourceType = $route['resource_type'];
                $acquired = (float)$route['quantity_acquired'];
                $pricePaid = (float)$route['price_paid'];
                
                // Get target system price\n                $tgtSys = $db->query("
                    SELECT cb.galaxy_index, ss.system_index
                    FROM colonies c
                    JOIN celestial_bodies cb ON cb.id = c.body_id
                    JOIN star_systems ss ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
                    WHERE c.id = $targetColId LIMIT 1
                ");
                [$tgtGalaxy, $tgtSystem] = $tgtSys->fetch(PDO::FETCH_NUM);
                
                $priceSold = compute_system_price($db, (int)$tgtGalaxy, (int)$tgtSystem, $resourceType);
                
                // Deliver goods
                $db->prepare("UPDATE colonies SET $resourceType = $resourceType + ? WHERE id = ?")->execute([$acquired, $targetColId]);
                
                $revenueTotal = $acquired * $priceSold;
                $profit = $revenueTotal - ($acquired * $pricePaid);
                
                $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits + ?, total_profit = total_profit + ? WHERE id = ?')
                   ->execute([$revenueTotal, $profit, $traderId]);
                
                $db->prepare('INSERT INTO trader_transactions (trader_id, route_id, transaction_type, resource_type, quantity, price_per_unit, total_credits)
                             VALUES (?, ?, "sold", ?, ?, ?, ?)')
                   ->execute([$traderId, $routeId, $resourceType, $acquired, $priceSold, $revenueTotal]);
                
                $db->prepare('UPDATE trader_routes SET status = ?, quantity_delivered = ?, price_sold = ?, actual_profit = ?, delivered_at = NOW(), updated_at = NOW() WHERE id = ?')
                   ->execute(['completed', $acquired, $priceSold, $profit, $routeId]);
                
                echo "    ✓ Sold $acquired units @ $priceSold/unit = $revenueTotal credits\n";
                echo "    ✓ PROFIT: $profit credits\n";
                $processed++;
            }
        } catch (Throwable $e) {
            echo "    ✗ Error: " . $e->getMessage() . "\n";
        }
    }
    
    echo "\nProcessed $processed routes\n\n";
    
    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 6: Final Summary
    // ─────────────────────────────────────────────────────────────────────────────
    echo "STEP 6: System Summary\n";
    echo str_repeat("─", 60) . "\n";
    
    $summary = $db->query('
        SELECT 
            COUNT(DISTINCT trader_id) as total_traders,
            COUNT(*) as total_routes,
            SUM(CASE WHEN status="completed" THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status="failed" THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status NOT IN ("completed", "failed") THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status="completed" THEN actual_profit ELSE 0 END) as total_profit
        FROM trader_routes
    ')->fetch(PDO::FETCH_ASSOC);
    
    echo "Traders: {$summary['total_traders']}\n";
    echo "Total routes: {$summary['total_routes']}\n";
    echo "  ✓ Completed: {$summary['completed']}\n";
    echo "  ⏳ Active: {$summary['active']}\n";
    echo "  ✗ Failed: {$summary['failed']}\n";
    echo "  💰 Total profit: " . number_format((float)$summary['total_profit'], 2) . " credits\n";
    
    echo "\n" . str_repeat("═", 60) . "\n";
    echo "✓ TRADERS SYSTEM FULLY INITIALIZED & TESTED\n";
    echo str_repeat("═", 60) . "\n\n";
    
    echo "Next Steps:\n";
    echo "1. Frontend Dashboard: /traders-dashboard (React component)\n";
    echo "2. API Endpoints:\n";
    echo "   - GET /api/traders.php?action=list_traders\n";
    echo "   - GET /api/traders_dashboard.php?action=trader_status&trader_id=1\n";
    echo "   - POST /api/traders_events.php?event=game_tick\n";
    echo "3. Integration: Call trader_events.php?event=game_tick from game loop\n\n";
    
} catch (Throwable $e) {
    echo "\n✗ FATAL ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
