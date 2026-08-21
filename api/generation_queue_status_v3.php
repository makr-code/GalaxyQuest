<?php
/**
 * Generation Queue Status API v3
 * 
 * GET /api/generation_queue_status_v3.php?queue_id=123
 * Returns: {ok: bool, job: {...}, status: string, progress: float, elapsed_seconds: int}
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json');

try {
    $queueId = $_GET['queue_id'] ?? null;
    
    if (!$queueId || !is_numeric($queueId)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Missing or invalid queue_id']);
        exit;
    }
    
    $db = get_db();
    
    // ─────────────────────────────────────────────────────────────────────────────
    // Fetch job from queue
    // ─────────────────────────────────────────────────────────────────────────────
    
    $stmt = $db->prepare(<<<'SQL'
        SELECT 
            id,
            user_id,
            prompt_text,
            input_mode,
            status,
            metadata,
            created_at,
            started_at,
            completed_at,
            error_message,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) as elapsed_seconds,
            TIMESTAMPDIFF(SECOND, created_at, COALESCE(completed_at, NOW())) as total_duration
        FROM generation_queue
        WHERE id = ?
SQL);
    
    $stmt->execute([(int)$queueId]);
    $job = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$job) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => "Job $queueId not found"]);
        exit;
    }
    
    // ─────────────────────────────────────────────────────────────────────────────
    // Parse metadata
    // ─────────────────────────────────────────────────────────────────────────────
    
    $metadata = json_decode($job['metadata'] ?? '{}', true) ?? [];
    $jobType = $metadata['job_type'] ?? 'trellis2';
    $trellis2EventId = $metadata['trellis2_event_id'] ?? null;
    $comfyuiPromptId = $metadata['comfyui_prompt_id'] ?? null;
    $generationType = $metadata['type'] ?? 'unknown';
    
    // ─────────────────────────────────────────────────────────────────────────────
    // Calculate progress based on status
    // ─────────────────────────────────────────────────────────────────────────────
    
    $progress = 0.0;
    $progressLabel = '';
    
    switch ($job['status']) {
        case 'pending':
            $progress = 0.0;
            $progressLabel = 'Waiting in queue...';
            break;
        case 'processing':
            // Linear estimate based on elapsed time
            // Typical generation: 30-120 seconds
            $elapsed = (int)$job['elapsed_seconds'];
            $progress = min(0.95, $elapsed / 120.0);  // Cap at 95%
            $progressLabel = 'Generating 3D model...';
            break;
        case 'completed':
            $progress = 1.0;
            $progressLabel = 'Complete!';
            break;
        case 'failed':
            $progress = -1.0;  // Negative indicates failure
            $progressLabel = 'Failed: ' . ($job['error_message'] ?? 'Unknown error');
            break;
    }
    
    http_response_code(200);
    echo json_encode([
        'ok' => true,
        'queue_id' => (int)$job['id'],
        'user_id' => (int)$job['user_id'],
        'status' => $job['status'],
        'progress' => round($progress, 3),
        'progress_label' => $progressLabel,
        'job_type' => $jobType,
        'input_mode' => $job['input_mode'],
        'generation_type' => $generationType,
        'trellis2_event_id' => $trellis2EventId,
        'comfyui_prompt_id' => $comfyuiPromptId,
        'elapsed_seconds' => (int)$job['elapsed_seconds'],
        'total_duration_seconds' => (int)$job['total_duration'],
        'created_at' => $job['created_at'],
        'started_at' => $job['started_at'],
        'completed_at' => $job['completed_at'],
        'error_message' => $job['error_message'],
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
