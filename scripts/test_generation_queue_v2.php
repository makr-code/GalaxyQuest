#!/usr/bin/env php
<?php
/**
 * Generation Queue v2 - Multi-Mode Test Suite
 * Tests all three modes: text, image, hybrid
 * 
 * Usage: php scripts/test_generation_queue_v2.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

echo "═══════════════════════════════════════════════════════════════\n";
echo "GENERATION QUEUE v2 - MULTI-MODE TEST SUITE\n";
echo "═══════════════════════════════════════════════════════════════\n\n";

$db = get_db();
$apiUrl = 'http://localhost:8080/api/generation_queue_v2.php';  // ← LOKAL TESTEN
$userId = 1;

// Test 1: Text → 3D
echo "TEST 1: Text → 3D Generation\n";
echo "─────────────────────────────────────────────────────────────\n";

$payload = [
    'input_mode' => 'text',
    'prompt_text' => 'A sleek sci-fi cargo ship with modular design',
    'design_id' => 'design_001',
    'priority' => 1
];

echo "Payload: " . json_encode($payload, JSON_PRETTY_PRINT) . "\n";

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
echo "Response: " . json_encode($result, JSON_PRETTY_PRINT) . "\n\n";

if ($result['success'] ?? false) {
    $queueId1 = $result['queue_id'];
    echo "✅ Text mode job created: $queueId1\n";
    sleep(2);
    
    // Check status
    $checkUrl = $apiUrl . '?queue_id=' . $queueId1;
    $ch = curl_init($checkUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $status = json_decode(curl_exec($ch), true);
    curl_close($ch);
    echo "Status: " . $status['status'] . " (Progress: " . $status['progress'] . "%)\n\n";
} else {
    echo "❌ Text mode failed\n\n";
    $queueId1 = null;
}

// Test 2: Create fake image for Image → 3D
echo "TEST 2: Image → 3D Generation\n";
echo "─────────────────────────────────────────────────────────────\n";

// Create a simple 1x1 red PNG
$pngData = base64_encode("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82");

$payload = [
    'input_mode' => 'image',
    'image_base64' => $pngData,
    'image_description' => 'A small red square for testing',
    'design_id' => 'design_002',
    'priority' => 1
];

echo "Payload (truncated): " . json_encode([
    'input_mode' => 'image',
    'image_base64' => '(base64_data)',
    'image_description' => $payload['image_description'],
    'design_id' => $payload['design_id']
], JSON_PRETTY_PRINT) . "\n";

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
echo "Response: " . json_encode($result, JSON_PRETTY_PRINT) . "\n\n";

if ($result['success'] ?? false) {
    $queueId2 = $result['queue_id'];
    echo "✅ Image mode job created: $queueId2\n";
    sleep(2);
    
    $checkUrl = $apiUrl . '?queue_id=' . $queueId2;
    $ch = curl_init($checkUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $status = json_decode(curl_exec($ch), true);
    curl_close($ch);
    echo "Status: " . $status['status'] . " (Input Mode: " . $status['input_mode'] . ")\n\n";
} else {
    echo "❌ Image mode failed\n\n";
    $queueId2 = null;
}

// Test 3: Hybrid Mode (Image → Base 3D + Text Refinement)
echo "TEST 3: Hybrid Mode (Image → 3D + Text Refinement)\n";
echo "─────────────────────────────────────────────────────────────\n";

$payload = [
    'input_mode' => 'hybrid',
    'image_base64' => $pngData,
    'image_description' => 'Base image: rough spaceship silhouette',
    'refinement_prompt' => 'Make it more futuristic with neon accents and glowing panels',
    'design_id' => 'design_003',
    'priority' => 2
];

echo "Payload (truncated): " . json_encode([
    'input_mode' => 'hybrid',
    'image_base64' => '(base64_data)',
    'image_description' => $payload['image_description'],
    'refinement_prompt' => $payload['refinement_prompt'],
    'design_id' => $payload['design_id']
], JSON_PRETTY_PRINT) . "\n";

$ch = curl_init($apiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
echo "Response: " . json_encode($result, JSON_PRETTY_PRINT) . "\n\n";

if ($result['success'] ?? false) {
    $queueId3 = $result['queue_id'];
    echo "✅ Hybrid mode job created: $queueId3\n";
    sleep(2);
    
    $checkUrl = $apiUrl . '?queue_id=' . $queueId3;
    $ch = curl_init($checkUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $status = json_decode(curl_exec($ch), true);
    curl_close($ch);
    echo "Status: " . $status['status'] . " (Input Mode: " . $status['input_mode'] . ")\n\n";
} else {
    echo "❌ Hybrid mode failed\n\n";
    $queueId3 = null;
}

// Summary
echo "═══════════════════════════════════════════════════════════════\n";
echo "TEST SUMMARY\n";
echo "═════════════════════════════════════════════════════════════════\n";

$stmt = $db->prepare('SELECT input_mode, COUNT(*) as count FROM generation_queue GROUP BY input_mode');
$stmt->execute();
$modes = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($modes as $mode) {
    echo sprintf("%-15s: %d jobs\n", $mode['input_mode'], $mode['count']);
}

$stmt = $db->prepare('SELECT status, COUNT(*) as count FROM generation_queue GROUP BY status');
$stmt->execute();
$statuses = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "\nStatus Distribution:\n";
foreach ($statuses as $stat) {
    echo sprintf("%-15s: %d jobs\n", $stat['status'], $stat['count']);
}

echo "\nCreated Queue IDs:\n";
if ($queueId1) echo "  - Text mode:   $queueId1\n";
if ($queueId2) echo "  - Image mode:  $queueId2\n";
if ($queueId3) echo "  - Hybrid mode: $queueId3\n";

echo "\n✅ Test suite completed!\n";
