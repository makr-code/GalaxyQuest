#!/usr/bin/env php
<?php
/**
 * Test ComfyUI vs TRELLIS2 Job Submission
 * 
 * Usage:
 *  docker compose exec web php scripts/test_dual_mode_jobs.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

error_log("═══════════════════════════════════════════════════════════════════");
error_log("ComfyUI vs TRELLIS2 Dual-Mode Job Submission Test");
error_log("═══════════════════════════════════════════════════════════════════\n");

$db = get_db();

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Submit ComfyUI Text-to-3D Job
// ─────────────────────────────────────────────────────────────────────────────

error_log("[TEST 1] ComfyUI Text-to-3D Job");
error_log("├─ Mode: text");
error_log("├─ Job Type: comfyui");
error_log("├─ Prompt: 'A shiny red metallic sphere'");

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue 
    (user_id, prompt_text, input_mode, metadata, status, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
SQL);

$metadata1 = json_encode([
    'job_type' => 'comfyui',
    'submitted_at' => date('c'),
    'test_case' => 'text_to_3d',
]);

$stmt->execute([1, 'A shiny red metallic sphere', 'text', $metadata1, 'pending']);
$job1Id = $db->lastInsertId();
error_log("└─ Result: Queue ID $job1Id ✅\n");

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Submit TRELLIS2 Text-to-3D Job (Legacy)
// ─────────────────────────────────────────────────────────────────────────────

error_log("[TEST 2] TRELLIS2 Text-to-3D Job (Legacy)");
error_log("├─ Mode: text");
error_log("├─ Job Type: trellis2");
error_log("├─ Prompt: 'A crystalline blue cube'");

$metadata2 = json_encode([
    'job_type' => 'trellis2',
    'submitted_at' => date('c'),
    'test_case' => 'text_to_3d_legacy',
]);

$stmt->execute([1, 'A crystalline blue cube', 'text', $metadata2, 'pending']);
$job2Id = $db->lastInsertId();
error_log("└─ Result: Queue ID $job2Id ✅\n");

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Submit ComfyUI Image-to-3D Job
// ─────────────────────────────────────────────────────────────────────────────

error_log("[TEST 3] ComfyUI Image-to-3D Job");
error_log("├─ Mode: image");
error_log("├─ Job Type: comfyui");
error_log("├─ Image: Sample PNG (small test image)");

// Create a minimal test PNG (1x1 red pixel)
$testPng = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
         . "\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
         . "\x00\x01\x01\x00\x05\xd4\xc1\n5\x00\x00\x00\x00IEND\xaeB`\x82";
$testImageBase64 = base64_encode($testPng);

$metadata3 = json_encode([
    'job_type' => 'comfyui',
    'submitted_at' => date('c'),
    'test_case' => 'image_to_3d',
]);

$stmt = $db->prepare(<<<'SQL'
    INSERT INTO generation_queue 
    (user_id, prompt_text, input_mode, input_image_base64, metadata, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
SQL);

$stmt->execute([1, '[IMAGE_MODE] Generate 3D from image', 'image', $testImageBase64, $metadata3, 'pending']);
$job3Id = $db->lastInsertId();
error_log("└─ Result: Queue ID $job3Id ✅\n");

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Submit ComfyUI Hybrid Job
// ─────────────────────────────────────────────────────────────────────────────

error_log("[TEST 4] ComfyUI Hybrid Job");
error_log("├─ Mode: hybrid");
error_log("├─ Job Type: comfyui");
error_log("├─ Image: Sample PNG");
error_log("├─ Refinement: 'Make it more detailed'");

$metadata4 = json_encode([
    'job_type' => 'comfyui',
    'submitted_at' => date('c'),
    'test_case' => 'hybrid',
    'refinement_prompt' => 'Make it more detailed',
]);

$stmt->execute([
    1,
    '[HYBRID] Base from image, then: Make it more detailed',
    'hybrid',
    $testImageBase64,
    $metadata4,
    'pending'
]);
$job4Id = $db->lastInsertId();
error_log("└─ Result: Queue ID $job4Id ✅\n");

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

error_log("═══════════════════════════════════════════════════════════════════");
error_log("Test Summary");
error_log("═══════════════════════════════════════════════════════════════════");
error_log("✅ ComfyUI Text-to-3D:    Job $job1Id");
error_log("✅ TRELLIS2 Text-to-3D:   Job $job2Id");
error_log("✅ ComfyUI Image-to-3D:   Job $job3Id");
error_log("✅ ComfyUI Hybrid:        Job $job4Id");
error_log("");
error_log("Daemon will process these jobs (status: pending)");
error_log("");
error_log("Check status with:");
error_log("  curl http://localhost:8080/api/generation_queue_status_v3.php?queue_id=$job1Id");
error_log("═══════════════════════════════════════════════════════════════════\n");
