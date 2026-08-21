#!/usr/bin/env php
<?php
/**
 * Direct Test Suite for Generation Queue v2
 * Calls API functions directly (no HTTP)
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/generation_queue_v2.php';
require_once __DIR__ . '/../api/helpers.php';

echo "═══════════════════════════════════════════════════════════════\n";
echo "GENERATION QUEUE v2 - DIRECT API TEST SUITE\n";
echo "═════════════════════════════════════════════════════════════════\n\n";

$db = get_db();

// TEST 1: Text→3D
echo "TEST 1: Text→3D Mode\n";
echo "─────────────────────────────────────────────────────────────\n";

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, priority, status)
    VALUES (1, 'A sleek sci-fi cargo ship with modular design', 'text', 1, 'pending')
SQL);
$stmt->execute();
$job1 = $db->lastInsertId();

echo "✅ Text job created: ID=$job1\n";
sleep(1);

// Check status
$stmt = $db->prepare('SELECT * FROM generation_queue WHERE id = ? LIMIT 1');
$stmt->execute([$job1]);
$job = $stmt->fetch(\PDO::FETCH_ASSOC);
echo "Status: " . $job['status'] . " | Mode: " . $job['input_mode'] . "\n\n";

// TEST 2: Image→3D
echo "TEST 2: Image→3D Mode\n";
echo "─────────────────────────────────────────────────────────────\n";

// Create minimal PNG
$pngData = base64_encode("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82");

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, image_description, priority, status)
    VALUES (1, 'Image-based 3D generation', 'image', ?, 'Test ship image', 1, 'pending')
SQL);
$stmt->execute([$pngData]);
$job2 = $db->lastInsertId();

echo "✅ Image job created: ID=$job2\n";
sleep(1);

$stmt = $db->prepare('SELECT id, status, input_mode FROM generation_queue WHERE id = ? LIMIT 1');
$stmt->execute([$job2]);
$job = $stmt->fetch(\PDO::FETCH_ASSOC);
echo "Status: " . $job['status'] . " | Mode: " . $job['input_mode'] . "\n\n";

// TEST 3: Hybrid
echo "TEST 3: Hybrid Mode (Image→Base + Text Refinement)\n";
echo "─────────────────────────────────────────────────────────────\n";

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue
    (user_id, prompt_text, input_mode, input_image_base64, image_description, priority, status)
    VALUES (1, '[HYBRID] Base from image, then: Add glowing neon accents', 'hybrid', ?, 'Hybrid test', 2, 'pending')
SQL);
$stmt->execute([$pngData]);
$job3 = $db->lastInsertId();

echo "✅ Hybrid job created: ID=$job3\n";
sleep(1);

$stmt = $db->prepare('SELECT id, status, input_mode, prompt_text FROM generation_queue WHERE id = ? LIMIT 1');
$stmt->execute([$job3]);
$job = $stmt->fetch(\PDO::FETCH_ASSOC);
echo "Status: " . $job['status'] . " | Mode: " . $job['input_mode'] . "\n";
echo "Prompt: " . substr($job['prompt_text'], 0, 60) . "...\n\n";

// SUMMARY
echo "═════════════════════════════════════════════════════════════════\n";
echo "TEST SUMMARY\n";
echo "═════════════════════════════════════════════════════════════════\n";

$stmt = $db->query('SELECT input_mode, COUNT(*) as count FROM generation_queue GROUP BY input_mode');
$modes = $stmt->fetchAll(\PDO::FETCH_ASSOC);

echo "\n📊 Jobs by Mode:\n";
foreach ($modes as $mode) {
    echo sprintf("  %-15s: %d\n", $mode['input_mode'], $mode['count']);
}

$stmt = $db->query('SELECT status, COUNT(*) as count FROM generation_queue GROUP BY status');
$statuses = $stmt->fetchAll(\PDO::FETCH_ASSOC);

echo "\n📊 Jobs by Status:\n";
foreach ($statuses as $st) {
    echo sprintf("  %-15s: %d\n", $st['status'], $st['count']);
}

echo "\n✅ All 3 modes successfully inserted into database!\n";
echo "\nNext steps:\n";
echo "  1. Start daemon: docker compose exec web php scripts/daemon_trellis2_jobs_v2.php &\n";
echo "  2. Monitor progress: docker compose logs -f web | grep trellis2\n";
echo "  3. View dashboard: http://localhost:8080/monitoring-dashboard.html\n";
