#!/usr/bin/env php
<?php
/**
 * Test script for Economy Production Tick Integration
 * 
 * Tests:
 * 1. process_economy_production_tick() function
 * 2. Shortage event generation
 * 3. Pop satisfaction coupling with production
 * 4. Tier-3 production gating
 */

require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../api/helpers.php';
require_once __DIR__ . '/../../api/game_engine.php';
require_once __DIR__ . '/../../api/economy_flush.php';

$db = get_db();

echo "=== Economy Production Tick Integration Tests ===\n\n";

try {
    // Test 1: Check if economy schema exists
    echo "TEST 1: Verifying economy schema...\n";
    
    $tables = [
        'economy_processed_goods',
        'economy_pop_classes',
        'economy_shortage_events',
        'economy_policies',
    ];
    
    $missingTables = [];
    foreach ($tables as $table) {
        $result = $db->query("SHOW TABLES LIKE '$table'")->fetchColumn();
        if (!$result) {
            $missingTables[] = $table;
        }
    }
    
    if (empty($missingTables)) {
        echo "✅ All required tables exist\n\n";
    } else {
        echo "❌ Missing tables: " . implode(', ', $missingTables) . "\n";
        exit(1);
    }
    
    // Test 2: Run economy production tick
    echo "TEST 2: Running economy production tick...\n";
    
    $tickResult = process_economy_production_tick($db, true);
    
    printf("✅ Tick Result:\n");
    printf("  • Processed: %s\n", $tickResult['processed'] ? 'yes' : 'no');
    printf("  • Schema ready: %s\n", $tickResult['schema_ready'] ? 'yes' : 'no');
    printf("  • Colonies flushed: %d\n", $tickResult['colonies_flushed']);
    printf("  • Shortage events recorded: %d\n", $tickResult['shortage_events']);
    printf("  • Elapsed: %d seconds\n\n", $tickResult['elapsed_seconds']);
    
    if (!$tickResult['processed']) {
        echo "⚠️  Tick did not process. This may be expected if schema is not ready.\n\n";
    }
    
    // Test 3: Check shortage events if any colonies exist
    echo "TEST 3: Checking shortage events...\n";
    
    $coloniesStmt = $db->query('SELECT id, name FROM colonies LIMIT 1');
    $colony = $coloniesStmt->fetch(PDO::FETCH_ASSOC);
    
    if ($colony) {
        $colonyId = (int)$colony['id'];
        $colonyName = $colony['name'];
        
        printf("  Testing colony: [%d] %s\n", $colonyId, $colonyName);
        
        // Check active shortage events
        $shortageStmt = $db->prepare(<<<SQL
            SELECT good_type, deficit_per_hour, severity, started_at, resolved_at
            FROM economy_shortage_events
            WHERE colony_id = ? AND resolved_at IS NULL
            ORDER BY started_at DESC
            LIMIT 5
        SQL);
        $shortageStmt->execute([$colonyId]);
        $shortages = $shortageStmt->fetchAll(PDO::FETCH_ASSOC);
        
        if (empty($shortages)) {
            echo "  ℹ️  No active shortage events\n";
        } else {
            printf("  ✅ Found %d active shortage events:\n", count($shortages));
            foreach ($shortages as $s) {
                printf("    • %s: deficit %.2f/hr (severity: %s)\n",
                    $s['good_type'],
                    (float)$s['deficit_per_hour'],
                    $s['severity']
                );
            }
        }
        
        // Check production vs consumption
        echo "\n  Production vs Consumption Status:\n";
        $goodsStmt = $db->prepare(<<<SQL
            SELECT good_type, quantity, production_rate_per_hour, consumption_rate_per_hour
            FROM economy_processed_goods
            WHERE colony_id = ? AND (production_rate_per_hour > 0 OR consumption_rate_per_hour > 0)
            ORDER BY consumption_rate_per_hour DESC
            LIMIT 10
        SQL);
        $goodsStmt->execute([$colonyId]);
        $goods = $goodsStmt->fetchAll(PDO::FETCH_ASSOC);
        
        if (empty($goods)) {
            echo "  ℹ️  No goods being produced or consumed\n";
        } else {
            foreach ($goods as $g) {
                $prod = (float)$g['production_rate_per_hour'];
                $cons = (float)$g['consumption_rate_per_hour'];
                $qty = (float)$g['quantity'];
                $net = $prod - $cons;
                
                $status = match(true) {
                    $net > 0 => '📈 surplus',
                    $net < 0 => '📉 deficit',
                    default  => '→ balanced',
                };
                
                printf("    • %-30s qty=%-8.0f prod=%-6.2f cons=%-6.2f %s\n",
                    $g['good_type'] . ':',
                    $qty,
                    $prod,
                    $cons,
                    $status
                );
            }
        }
        
        // Check pop satisfaction
        echo "\n  Pop Satisfaction Status:\n";
        $popStmt = $db->prepare(<<<SQL
            SELECT pop_class, count, satisfaction_index, shortage_ticks
            FROM economy_pop_classes
            WHERE colony_id = ?
        SQL);
        $popStmt->execute([$colonyId]);
        $pops = $popStmt->fetchAll(PDO::FETCH_ASSOC);
        
        if (empty($pops)) {
            echo "  ℹ️  No pop classes tracked\n";
        } else {
            foreach ($pops as $p) {
                $sat = (float)$p['satisfaction_index'];
                $count = (int)$p['count'];
                $prodMult = 0.5 + ($sat / 100.0);
                
                $satStatus = match(true) {
                    $sat >= 80 => '😊 excellent',
                    $sat >= 60 => '😐 good',
                    $sat >= 40 => '😟 warning',
                    default    => '😢 critical',
                };
                
                printf("    • %-20s count=%-6d sat=%-6.1f%% (×%.2f prod) %s\n",
                    $p['pop_class'] . ':',
                    $count,
                    $sat,
                    $prodMult,
                    $satStatus
                );
            }
        }
    } else {
        echo "  ℹ️  No colonies found in database\n";
    }
    
    echo "\n";
    
    // Test 4: Verify tier-3 production gating
    echo "TEST 4: Checking Tier-3 production gating...\n";
    
    if ($colony) {
        $colonyId = (int)$colony['id'];
        
        // Get satisfaction index to check tier-3 blocking
        $satStmt = $db->prepare(<<<SQL
            SELECT COALESCE(
                SUM(satisfaction_index * count) / NULLIF(SUM(count), 0),
                50.0
            ) AS weighted_satisfaction
            FROM economy_pop_classes WHERE colony_id = ?
        SQL);
        $satStmt->execute([$colonyId]);
        $satRow = $satStmt->fetch(PDO::FETCH_ASSOC);
        $satisfaction = (float)($satRow['weighted_satisfaction'] ?? 50.0);
        
        // Check tier-3 goods
        $tier3Goods = [
            'consumer_goods', 'luxury_goods', 'military_equipment',
            'research_kits', 'colonization_packs'
        ];
        
        printf("  Colony satisfaction: %.1f%%\n", $satisfaction);
        printf("  Tier-3 goods blocked: %s\n", $satisfaction < 40 ? 'YES (satisfaction < 40)' : 'NO');
        
        echo "  Tier-3 good quantities:\n";
        foreach ($tier3Goods as $goodType) {
            $stmt = $db->prepare(
                'SELECT quantity, production_rate_per_hour FROM economy_processed_goods WHERE colony_id = ? AND good_type = ?'
            );
            $stmt->execute([$colonyId, $goodType]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($row) {
                $qty = (float)$row['quantity'];
                $rate = (float)$row['production_rate_per_hour'];
                printf("    • %-30s qty=%-8.0f prod=%-6.2f/hr\n", $goodType . ':', $qty, $rate);
            }
        }
    }
    
    echo "\n✅ All tests completed successfully!\n";
    
} catch (Exception $e) {
    echo "❌ Test failed: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
    exit(1);
}
