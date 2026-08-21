#!/usr/bin/env php
<?php
/**
 * Quick test: Try to submit one job manually
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

echo "\n=== DAEMON TEST ===\n";
echo "Starting daemon test...\n\n";

try {
    $db = get_db();
    echo "✅ Database connection OK\n";
    
    // Get pending jobs
    $stmt = $db->prepare(<<<'SQL'
        SELECT id, prompt_text, input_mode, input_image_base64
        FROM generation_queue 
        WHERE status = 'pending'
        LIMIT 3
SQL);
    $stmt->execute();
    $pending = $stmt->fetchAll(\PDO::FETCH_ASSOC);
    
    echo "✅ Found " . count($pending) . " pending jobs\n\n";
    
    foreach ($pending as $job) {
        echo "Processing Job ID: {$job['id']} | Mode: {$job['input_mode']}\n";
        echo "  Prompt: " . substr($job['prompt_text'], 0, 50) . "...\n";
        
        // Try to call TRELLIS2
        $trellis2_url = 'http://trellis2:7862';
        
        if ($job['input_mode'] === 'text') {
            echo "  → Calling TRELLIS2 text_to_3d endpoint...\n";
            $ch = curl_init("{$trellis2_url}/gradio_api/call/text_to_3d");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_POSTFIELDS => json_encode(['data' => [$job['prompt_text'], 8, 1]]),
            ]);
            $response = curl_exec($ch);
            $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);
            
            echo "    HTTP Code: $httpcode\n";
            if ($error) {
                echo "    ❌ Curl Error: $error\n";
            } else {
                echo "    ✅ Response: " . substr($response, 0, 100) . "...\n";
            }
        } else if ($job['input_mode'] === 'image') {
            echo "  → Would call image_to_3d with base64 data\n";
        } else {
            echo "  → Hybrid mode: Would process image first\n";
        }
        echo "\n";
    }
    
} catch (Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString() . "\n";
}

echo "\n=== END TEST ===\n";
