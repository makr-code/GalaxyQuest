<?php
/**
 * scripts/traders_init_complete.php
 * 
 * One-shot initialization and end-to-end test of the entire Traders System
 * Usage: php scripts/traders_init_complete.php
 */

declare(strict_types=1);

define('IS_CLI', true);
define('SKIP_AUTH', true);

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../api/helpers.php';
require_once __DIR__ . '/../../api/market_analysis.php';

$db = get_db();

echo "\n╔═══════════════════════════════════════════════════════════════════╗\n";
echo "║  GalaxyQuest Traders System - Complete E2E Initialization & Test  ║\n";
echo "╚═══════════════════════════════════════════════════════════════════╝\n\n";

try {
    echo "STEP 1: Verify Database Schema\n";
    echo str_repeat("─", 60) . "\n";
    
    $tables = ['npc_traders', 'trader_routes', 'trader_transactions', 'market_supply_demand', 'trade_opportunities'];
    foreach ($tables as $table) {
        $exists = $db->query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='galaxyquest' AND TABLE_NAME='$table'")->fetch();
        echo $exists ? "  ✓ $table\n" : "  ✗ $table\n";
    }
    
    echo "\nSTEP 2: Initialize Test Traders\n";
    echo str_repeat("─", 60) . "\n";
    
    $factions = $db->query('SELECT id, name, code FROM npc_factions LIMIT 5')->fetchAll(PDO::FETCH_ASSOC);
    $traderCount = 0;

    $hasFactionColoniesTable = (bool)$db->query(
        "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA='galaxyquest' AND TABLE_NAME='faction_colonies'"
    )->fetchColumn();

    $hasLegacyColonyFactionColumn = (bool)$db->query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='galaxyquest' AND TABLE_NAME='colonies' AND COLUMN_NAME='faction_id'"
    )->fetchColumn();

    $colonyByFactionStmt = null;
    if ($hasFactionColoniesTable) {
        $colonyByFactionStmt = $db->prepare(
            'SELECT c.id
             FROM colonies c
             JOIN faction_colonies fc ON fc.colony_id = c.id
             WHERE fc.faction_id = ?
             LIMIT 1'
        );
    }

    $legacyColonyByFactionStmt = null;
    if ($hasLegacyColonyFactionColumn) {
        $legacyColonyByFactionStmt = $db->prepare('SELECT id FROM colonies WHERE faction_id = ? LIMIT 1');
    }
    
    foreach ($factions as $faction) {
        $colony = null;

        if ($colonyByFactionStmt) {
            $colonyByFactionStmt->execute([(int)$faction['id']]);
            $colony = $colonyByFactionStmt->fetch(PDO::FETCH_ASSOC);
        }

        if (!$colony && $legacyColonyByFactionStmt) {
            $legacyColonyByFactionStmt->execute([(int)$faction['id']]);
            $colony = $legacyColonyByFactionStmt->fetch(PDO::FETCH_ASSOC);
        }

        if (!$colony) {
            $colony = $db->query('SELECT id FROM colonies ORDER BY id ASC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
        }

        if (!$colony) continue;
        
        $codeSlug = preg_replace('/[^a-z0-9]/i', '', (string)$faction['code']);
        $codeSlug = strtolower((string)$codeSlug);
        $codeSlug = substr($codeSlug ?: 'fac', 0, 10);
        $username = sprintf('bt_%s_%s', $codeSlug, substr(uniqid('', true), -8));
        $password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
        
        $db->prepare('INSERT INTO users (username, email, password_hash, control_type, auth_enabled, created_at)
                     VALUES (?, ?, ?, "npc_engine", 0, NOW())')
           ->execute([$username, $username . '@bots.local', $password]);
        
        $userId = (int)$db->lastInsertId();
        
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
        
        $db->prepare('INSERT INTO npc_traders (faction_id, name, user_id, base_colony_id, capital_credits, strategy, max_fleets, active_fleets, total_profit)
                     VALUES (?, ?, ?, ?, ?, "profit_max", ?, 0, 0)')
           ->execute([$faction['id'], "Trader-" . $faction['code'], $userId, $colony['id'], $capital, $maxFleets]);
        
        $traderCount++;
        echo "  ✓ {$faction['name']}: Capital=$capital, Max Fleets=$maxFleets\n";
    }
    
    echo "\nCreated $traderCount traders\n\n";
    
    echo "STEP 3: Simulate Market Events\n";
    echo str_repeat("─", 60) . "\n";
    
    echo "  1. Updating supply/demand... ";
    update_supply_demand_table($db);
    $sdCount = (int)$db->query('SELECT COUNT(*) FROM market_supply_demand')->fetchColumn();
    echo "($sdCount records)\n";
    
    echo "  2. Finding trade opportunities... ";
    find_and_rank_trade_opportunities($db, 15.0);
    $oppCount = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
    echo "($oppCount opportunities)\n\n";
    
    echo "STEP 4: Create Sample Routes\n";
    echo str_repeat("─", 60) . "\n";
    
    $traders = $db->query('SELECT id, capital_credits FROM npc_traders LIMIT 3')->fetchAll(PDO::FETCH_ASSOC);
    $routesCreated = 0;
    
    foreach ($traders as $trader) {
        $opp = $db->query('SELECT source_system, target_system, resource_type, source_price, actual_qty, net_profit_per_unit
                          FROM trade_opportunities WHERE profit_margin >= 15 AND expires_at > NOW() ORDER BY profit_margin DESC LIMIT 1')
           ->fetch(PDO::FETCH_ASSOC);
        
        if ($opp) {
            $srcCol = $db->query("SELECT MIN(id) as id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE cb.system_index = {$opp['source_system']}")
               ->fetchColumn();
            $tgtCol = $db->query("SELECT MIN(id) as id FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE cb.system_index = {$opp['target_system']}")
               ->fetchColumn();
            
            if ($srcCol && $tgtCol) {
                $qty = (int)min((float)$opp['actual_qty'], floor($trader['capital_credits'] / ((float)$opp['source_price'] + 10)));
                if ($qty > 0) {
                    $db->prepare('INSERT INTO trader_routes (trader_id, source_colony_id, target_colony_id, resource_type, quantity_planned, expected_profit, status)
                                VALUES (?, ?, ?, ?, ?, ?, "planning")')
                       ->execute([$trader['id'], $srcCol, $tgtCol, $opp['resource_type'], $qty, $qty * (float)$opp['net_profit_per_unit'] * 0.9]);
                    $routesCreated++;
                }
            }
        }
    }
    
    echo "  ✓ Created $routesCreated sample routes\n\n";
    
    echo "STEP 5: Process Routes Through Lifecycle\n";
    echo str_repeat("─", 60) . "\n";
    
    $routes = $db->query('SELECT tr.id, tr.trader_id, tr.source_colony_id, tr.target_colony_id, tr.resource_type, tr.quantity_planned, tr.status, t.capital_credits
                         FROM trader_routes tr JOIN npc_traders t ON t.id = tr.trader_id WHERE tr.status = "planning" LIMIT 5');
    
    $processed = 0;
    foreach ($routes->fetchAll(PDO::FETCH_ASSOC) as $route) {
        try {
            $routeId = (int)$route['id'];
            $traderId = (int)$route['trader_id'];
            $sourceColId = (int)$route['source_colony_id'];
            $resourceType = $route['resource_type'];
            $qty = (float)$route['quantity_planned'];
            
            // PLANNING → ACQUIRING
            echo "  Route $routeId: PLANNING → ACQUIRING... ";
            
            $sysStmt = $db->query("SELECT cb.galaxy_index, ss.system_index FROM colonies c
                                  JOIN celestial_bodies cb ON cb.id = c.body_id JOIN star_systems ss
                                  ON ss.galaxy_index = cb.galaxy_index AND ss.system_index = cb.system_index
                                  WHERE c.id = $sourceColId LIMIT 1");
            [$galaxy, $system] = $sysStmt->fetch(PDO::FETCH_NUM);
            
            $price = compute_system_price($db, (int)$galaxy, (int)$system, $resourceType);
            $col = $db->query("SELECT $resourceType as qty FROM colonies WHERE id = $sourceColId")->fetch();
            $available = (float)$col['qty'];
            
            $canAfford = (int)floor($route['capital_credits'] / $price);
            $acquired = (int)min($qty, $available, $canAfford);
            
            if ($acquired > 0) {
                $db->prepare("UPDATE colonies SET $resourceType = $resourceType - ? WHERE id = ?")->execute([$acquired, $sourceColId]);
                $db->prepare('UPDATE npc_traders SET capital_credits = capital_credits - ? WHERE id = ?')
                   ->execute([$acquired * $price, $traderId]);
                $db->prepare('UPDATE trader_routes SET status = ?, quantity_acquired = ?, price_paid = ?, updated_at = NOW() WHERE id = ?')
                   ->execute(['acquiring', $acquired, $price, $routeId]);
                
                echo "✓ Acquired $acquired units\n";
                $processed++;
            } else {
                echo "✗ Failed (not enough available)\n";
            }
        } catch (Throwable $e) {
            echo "✗ Error: " . $e->getMessage() . "\n";
        }
    }
    
    echo "\nProcessed $processed routes\n\n";
    
    echo "STEP 6: Final Summary\n";
    echo str_repeat("─", 60) . "\n";
    
    $summary = $db->query('SELECT COUNT(DISTINCT trader_id) as traders, COUNT(*) as total_routes,
                          SUM(CASE WHEN status="completed" THEN 1 ELSE 0 END) as completed,
                          SUM(CASE WHEN status NOT IN ("completed", "failed") THEN 1 ELSE 0 END) as active,
                          SUM(CASE WHEN status="completed" THEN actual_profit ELSE 0 END) as profit
                         FROM trader_routes')->fetch(PDO::FETCH_ASSOC);
    
    echo "Traders: {$summary['traders']}\n";
    echo "Routes: {$summary['total_routes']} (✓ {$summary['completed']} completed, ⏳ {$summary['active']} active)\n";
    echo "Total Profit: " . number_format((float)($summary['profit'] ?? 0), 2) . " credits\n";
    
    echo "\n" . str_repeat("═", 60) . "\n";
    echo "✓ TRADERS SYSTEM FULLY INITIALIZED\n";
    echo str_repeat("═", 60) . "\n\n";
    
} catch (Throwable $e) {
    echo "\n✗ ERROR: " . $e->getMessage() . "\n";
    exit(1);
}
