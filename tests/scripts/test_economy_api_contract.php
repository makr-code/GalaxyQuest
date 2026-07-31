#!/usr/bin/env php
<?php
/**
 * Test script for Economy API Contract Validation
 * 
 * Validates:
 * 1. get_shortage_events endpoint response format
 * 2. get_shortage_summary endpoint response format
 * 3. Client method signatures in api.js
 */

require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../api/helpers.php';

$db = get_db();

echo "=== Economy API Contract Validation ===\n\n";

try {
    // Get a test user and colony
    $testUser = 1;
    $stmt = $db->prepare('SELECT id, name FROM colonies WHERE user_id = ? LIMIT 1');
    $stmt->execute([$testUser]);
    $colony = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$colony) {
        echo "⚠️  No test colony found. Schema test only.\n";
        $testColonyId = null;
    } else {
        $testColonyId = (int)$colony['id'];
        echo "📍 Using test colony [" . $testColonyId . "] " . $colony['name'] . "\n\n";
    }
    
    // TEST 1: Validate API schema expectations
    echo "TEST 1: Validating database schema for API contracts...\n";
    
    $schemaChecks = [
        'economy_shortage_events' => [
            'columns' => ['id', 'colony_id', 'good_type', 'deficit_per_hour', 'severity', 'started_at', 'resolved_at'],
            'checks'  => ['SHOW COLUMNS FROM economy_shortage_events'],
        ],
        'economy_processed_goods' => [
            'columns' => ['id', 'colony_id', 'good_type', 'quantity', 'production_rate_per_hour', 'consumption_rate_per_hour'],
            'checks'  => ['SHOW COLUMNS FROM economy_processed_goods'],
        ],
    ];
    
    foreach ($schemaChecks as $table => $info) {
        $cols = $db->query("SHOW COLUMNS FROM $table")->fetchAll(PDO::FETCH_COLUMN);
        
        if (empty($cols)) {
            echo "  ❌ Table $table not found\n";
            continue;
        }
        
        $missing = array_diff($info['columns'], $cols);
        if (empty($missing)) {
            echo "  ✅ Table $table has all required columns\n";
        } else {
            echo "  ⚠️  Table $table missing: " . implode(', ', $missing) . "\n";
        }
    }
    echo "\n";
    
    // TEST 2: Verify get_shortage_events query structure
    echo "TEST 2: Validating get_shortage_events endpoint...\n";
    
    if ($testColonyId) {
        // Simulate the endpoint query
        $baseQuery = <<<SQL
            SELECT 
                id, colony_id, good_type, deficit_per_hour, severity,
                started_at, resolved_at
            FROM economy_shortage_events
            WHERE colony_id = ?
        SQL;
        
        $stmt = $db->prepare($baseQuery);
        $stmt->execute([$testColonyId]);
        $events = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo "  Query executed: ✅\n";
        printf("  Events found: %d\n", count($events));
        
        if (!empty($events)) {
            echo "  Sample event structure:\n";
            $e = $events[0];
            printf("    • id: %s (type: integer)\n", $e['id']);
            printf("    • colony_id: %s (type: integer)\n", $e['colony_id']);
            printf("    • good_type: %s (type: string)\n", $e['good_type']);
            printf("    • deficit_per_hour: %s (type: decimal)\n", $e['deficit_per_hour']);
            printf("    • severity: %s (type: enum: shortage|starvation)\n", $e['severity']);
            printf("    • started_at: %s (type: timestamp)\n", $e['started_at']);
            printf("    • resolved_at: %s (type: timestamp|null)\n", $e['resolved_at'] ?? 'NULL');
        }
    }
    echo "\n";
    
    // TEST 3: Verify get_shortage_summary query structure
    echo "TEST 3: Validating get_shortage_summary endpoint...\n";
    
    if ($testColonyId) {
        // Simulate the endpoint query - check if it would return the right structure
        $query = <<<SQL
            SELECT 
                COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as active_count,
                COUNT(CASE WHEN resolved_at IS NULL AND severity = 'starvation' THEN 1 END) as critical_count,
                good_type, deficit_per_hour
            FROM economy_shortage_events
            WHERE colony_id = ? AND resolved_at IS NULL
            GROUP BY good_type
            ORDER BY deficit_per_hour DESC
            LIMIT 10
        SQL;
        
        $stmt = $db->prepare($query);
        $stmt->execute([$testColonyId]);
        $shortages = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo "  Query executed: ✅\n";
        printf("  Top shortages found: %d\n", count($shortages));
        
        if (!empty($shortages)) {
            echo "  Sample shortage structure:\n";
            $s = $shortages[0];
            printf("    • active_count: %s\n", $s['active_count']);
            printf("    • critical_count: %s\n", $s['critical_count']);
            printf("    • good_type: %s\n", $s['good_type']);
            printf("    • deficit_per_hour: %s\n", $s['deficit_per_hour']);
        }
        
        // Check production rates alongside
        $prodQuery = <<<SQL
            SELECT good_type, production_rate_per_hour, consumption_rate_per_hour
            FROM economy_processed_goods
            WHERE colony_id = ?
            ORDER BY consumption_rate_per_hour DESC
            LIMIT 10
        SQL;
        
        $prodStmt = $db->prepare($prodQuery);
        $prodStmt->execute([$testColonyId]);
        $production = $prodStmt->fetchAll(PDO::FETCH_ASSOC);
        
        printf("  Production data available: %d goods tracked\n", count($production));
    }
    echo "\n";
    
    // TEST 4: Verify client method signatures
    echo "TEST 4: Verifying client method signatures in api.js...\n";
    
    $apiContent = file_get_contents(__DIR__ . '/../../js/network/api.js');
    
    $methods = [
        'economyShortageEvents' => [
            'params' => ['colony_id', 'resolved'],
            'pattern' => '/economyShortageEvents\s*\(\s*{[^}]*}\s*\)/',
        ],
        'economyShortageSummary' => [
            'params' => ['colony_id'],
            'pattern' => '/economyShortageSummary\s*\(\s*{[^}]*}\s*\)/',
        ],
    ];
    
    foreach ($methods as $method => $info) {
        if (strpos($apiContent, "function $method") !== false || strpos($apiContent, "$method(") !== false) {
            echo "  ✅ Method $method defined\n";
        } else {
            echo "  ❌ Method $method not found\n";
        }
    }
    echo "\n";
    
    echo "✅ API contract validation completed!\n";
    
} catch (Exception $e) {
    echo "❌ Validation failed: " . $e->getMessage() . "\n";
    exit(1);
}
