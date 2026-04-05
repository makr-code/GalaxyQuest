<?php
/**
 * Test Trader Tick System
 */

// Silence auth requirement
define('SKIP_AUTH', true);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/market_analysis.php';
require_once __DIR__ . '/../api/traders.php';

try {
    $db = new PDO('mysql:host=db;dbname=galaxyquest', 'root', 'root');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    echo "=== Trader System Status ===\n";
    
    // 1. Check factions exist  
    $factionCount = (int)$db->query('SELECT COUNT(*) FROM npc_factions')->fetchColumn();
    echo "Factions: $factionCount\n";
    
    // 2. Check traders exist
    $traderCount = (int)$db->query('SELECT COUNT(*) FROM npc_traders')->fetchColumn();
    echo "Traders: $traderCount\n";
    
    // 3. Check colonies exist
    $colonyCount = (int)$db->query('SELECT COUNT(*) FROM colonies')->fetchColumn();
    echo "Colonies: $colonyCount\n";
    
    // 4. Check supply/demand data
    $supplyCount = (int)$db->query('SELECT COUNT(*) FROM market_supply_demand')->fetchColumn();
    echo "Supply/Demand records: $supplyCount\n";
    
    // 5. Check opportunities
    $oppCount = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
    echo "Trade Opportunities: $oppCount\n";
    
    echo "\n=== Initializing Traders System ===\n";
    
    if ($traderCount === 0) {
        // Create traders for each faction
        $factionRes = $db->query('SELECT id, name, code FROM npc_factions LIMIT 10');
        foreach ($factionRes->fetchAll(PDO::FETCH_ASSOC) as $faction) {
            // Get first colony for faction
            $colRes = $db->prepare('SELECT id FROM colonies WHERE faction_id = ? LIMIT 1');
            $colRes->execute([$faction['id']]);
            $colId = $colRes->fetchColumn();
            
            if ($colId) {
                // Create NPC user
                $username = 'bot_trader_' . $faction['code'] . '_' . uniqid();
                $email = $username . '@bots.local';
                $password = password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT);
                
                $userStmt = $db->prepare('
                    INSERT INTO users (username, email, password_hash, control_type, auth_enabled, created_at)
                    VALUES (?, ?, ?, "npc_engine", 0, NOW())
                ');
                $userStmt->execute([$username, $email, $password]);
                $userId = $db->lastInsertId();
                
                // Create trader
                $traderStmt = $db->prepare('
                    INSERT INTO npc_traders (faction_id, name, user_id, base_colony_id, capital_credits, strategy, max_fleets, specialization)
                    VALUES (?, ?, ?, ?, ?, ?, ?, null)
                ');
                
                $capital = match($faction['code']) {
                    'HLN' => 75000,
                    'VOR', 'MYK' => 50000,
                    default => 25000,
                };
                
                $maxFleets = match($faction['code']) {
                    'HLN' => 5,
                    default => 3,
                };
                
                $traderStmt->execute([
                    $faction['id'],
                    "Trader-" . $faction['code'],
                    $userId,
                    $colId,
                    $capital,
                    'profit_max',
                    $maxFleets,
                ]);
                
                echo "Created trader for {$faction['name']} (id={$db->lastInsertId()})\n";
            }
        }
    }
    
    // Update supply/demand
    echo "\n=== Updating Supply/Demand ===\n";
    update_supply_demand_table($db);
    echo "Supply/demand updated\n";
    
    // Find opportunities
    echo "\n=== Finding Opportunities ===\n";
    find_and_rank_trade_opportunities($db, 15.0);
    
    $newOppCount = (int)$db->query('SELECT COUNT(*) FROM trade_opportunities')->fetchColumn();
    echo "Found " . ($newOppCount - $oppCount) . " new opportunities (total: $newOppCount)\n";
    
    // Show sample opportunities
    echo "\n=== Sample Opportunities ===\n";
    $samples = $db->query('
        SELECT id, resource_type, profit_margin, actual_qty, confidence
        FROM trade_opportunities
        ORDER BY profit_margin DESC
        LIMIT 5
    ')->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($samples as $opp) {
        printf("  ID #%d: %s | Margin: %.1f%% | Qty: %.0f | Conf: %.0f%%\n",
            $opp['id'], $opp['resource_type'], $opp['profit_margin'], 
            $opp['actual_qty'], $opp['confidence']
        );
    }
    
    echo "\n✓ Trader system ready!\n";
    
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
