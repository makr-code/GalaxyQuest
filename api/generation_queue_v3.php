<?php
/**
 * Generation Queue API v3 - Dual-Mode Submission (TRELLIS2 + ComfyUI)
 * 
 * Submits jobs to background daemon with explicit job_type routing.
 * Supports three generation modes: text, image, hybrid
 * Supports two backends: trellis2 (legacy Gradio), comfyui (node-based workflows)
 * 
 * Endpoints:
 *  - POST /api/generation_queue_v3.php
 *    Parameters: mode, job_type, prompt, image_base64, refinement_prompt
 *    Returns: {ok: bool, queue_id: int, job_type: string, status: string}
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json');

// ─────────────────────────────────────────────────────────────────────────────
// Request Handler
// ─────────────────────────────────────────────────────────────────────────────

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
        exit;
    }
    
    $payload = json_decode(file_get_contents('php://input'), true);
    
    if (!$payload) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Invalid JSON payload']);
        exit;
    }
    
    $mode = $payload['mode'] ?? 'text';           // text, image, hybrid
    $jobType = $payload['job_type'] ?? 'comfyui'; // trellis2, comfyui
    $prompt = $payload['prompt'] ?? null;
    $imageBase64 = $payload['image_base64'] ?? null;
    $refinementPrompt = $payload['refinement_prompt'] ?? null;
    $userId = $payload['user_id'] ?? 1;           // Default to user 1 for testing
    
    // Validation
    if (!in_array($mode, ['text', 'image', 'hybrid'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => "Invalid mode: $mode"]);
        exit;
    }
    
    if (!in_array($jobType, ['trellis2', 'comfyui'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => "Invalid job_type: $jobType"]);
        exit;
    }
    
    if ($mode === 'text' && empty($prompt)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Prompt required for text mode']);
        exit;
    }
    
    if (in_array($mode, ['image', 'hybrid']) && empty($imageBase64)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Image base64 required for image/hybrid modes']);
        exit;
    }
    
    // ─────────────────────────────────────────────────────────────────────────────
    // Build prompt text based on mode
    // ─────────────────────────────────────────────────────────────────────────────
    
    $promptText = '';
    switch ($mode) {
        case 'text':
            $promptText = $prompt;
            break;
        case 'image':
            $promptText = "[IMAGE_MODE] Generate 3D from image";
            break;
        case 'hybrid':
            $promptText = "[HYBRID] Base from image, then: " . ($refinementPrompt ?: 'Enhance details');
            break;
    }
    
    // ─────────────────────────────────────────────────────────────────────────────
    // Submit to database
    // ─────────────────────────────────────────────────────────────────────────────
    
    $db = get_db();
    
    $metadata = [
        'job_type' => $jobType,
        'submitted_at' => date('c'),
        'user_ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
    ];
    
    if ($mode === 'hybrid') {
        $metadata['refinement_prompt'] = $refinementPrompt;
    }
    
    $stmt = $db->prepare(<<<'SQL'
        INSERT INTO generation_queue 
        (user_id, prompt_text, input_mode, input_image_base64, metadata, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
SQL);
    
    $success = $stmt->execute([
        (int)$userId,
        $promptText,
        $mode,
        $imageBase64,
        json_encode($metadata),
        'pending',
    ]);
    
    if (!$success) {
        http_response_code(500);
        echo json_encode([
            'ok' => false,
            'error' => 'Failed to insert job into queue',
            'db_error' => $db->errorInfo()[2] ?? 'unknown'
        ]);
        exit;
    }
    
    $queueId = $db->lastInsertId();
    
    http_response_code(200);
    echo json_encode([
        'ok' => true,
        'queue_id' => (int)$queueId,
        'job_type' => $jobType,
        'mode' => $mode,
        'status' => 'pending',
        'message' => "Job $queueId submitted to daemon (type: $jobType, mode: $mode)"
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
        'file' => basename($e->getFile()),
        'line' => $e->getLine()
    ]);
}
