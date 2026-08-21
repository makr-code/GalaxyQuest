#!/usr/bin/env php
<?php
/**
 * Test Suite 2: Create fresh jobs and monitor daemon processing
 */

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();

echo "\n╔════════════════════════════════════════════════════════════╗\n";
echo "║  TEST SUITE 2: Fresh Jobs + Daemon Monitoring              ║\n";
echo "╚════════════════════════════════════════════════════════════╝\n\n";

// DELETE old test jobs
echo "Cleaning up old test jobs...";
$db->exec("DELETE FROM generation_queue WHERE id >= 100");
echo " ✅\n\n";

// CREATE 3 fresh jobs
$jobs = [];

echo "Creating Test Jobs:\n";
echo "─────────────────────────────────────────────────────\n";

// Job 1: Text
$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, priority, status)
    VALUES (1, 'A sleek sci-fi cargo ship with blue neon accents', 'text', 1, 'pending')
SQL);
$stmt->execute();
$jobs['text'] = $db->lastInsertId();
echo "✓ Text→3D job created: ID={$jobs['text']}\n";

// Job 2: Image
$png = base64_encode("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82");
$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, priority, status)
    VALUES (1, 'Image-based 3D generation', 'image', ?, 2, 'pending')
SQL);
$stmt->execute([$png]);
$jobs['image'] = $db->lastInsertId();
echo "✓ Image→3D job created: ID={$jobs['image']}\n";

// Job 3: Hybrid
$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, priority, status)
    VALUES (1, '[HYBRID] Base from image, then: Add glowing crystal formation', 'hybrid', ?, 3, 'pending')
SQL);
$stmt->execute([$png]);
$jobs['hybrid'] = $db->lastInsertId();
echo "✓ Hybrid job created: ID={$jobs['hybrid']}\n\n";

// Monitor loop (60 seconds max)
echo "Monitoring job progression (60 second timeout):\n";
echo "─────────────────────────────────────────────────────\n\n";

$maxIterations = 12;  // 12 × 5 sec = 60 sec
for ($i = 0; $i < $maxIterations; $i++) {
    sleep(5);
    
    echo "Check #$i: ";
    $stmt = $db->query(<<<'SQL'
        SELECT id, status, input_mode, updated_at 
        FROM generation_queue 
        WHERE id IN (100, 101, 102) 
        ORDER BY id
SQL);
    $current = $stmt->fetchAll(\PDO::FETCH_ASSOC);
    
    foreach ($current as $row) {
        $statusIcon = match($row['status']) {
            'pending' => '⏳',
            'processing' => '⚙️',
            'completed' => '✅',
            'failed' => '❌',
            default => '❓'
        };
        echo $statusIcon . " ";
    }
    echo "\n";
    
    // Check if any completed
    $completed = count(array_filter($current, fn($r) => $r['status'] === 'completed'));
    if ($completed > 0) {
        echo "\n  ✅ At least one job completed! Progress: " . $completed . "/3\n";
        break;
    }
}

echo "\n─────────────────────────────────────────────────────\n";
echo "Final Status:\n";
$stmt = $db->query(<<<'SQL'
    SELECT status, input_mode, COUNT(*) as count 
    FROM generation_queue 
    WHERE id IN (100, 101, 102)
    GROUP BY status, input_mode
SQL);
foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
    printf("  %s: %d (%s mode)\n", $row['status'], $row['count'], $row['input_mode']);
}

echo "\n✅ Test Suite 2 Complete\n";
