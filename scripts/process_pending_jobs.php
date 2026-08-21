<?php
/**
 * IMMEDIATE: Process pending TRELLIS2 jobs (one-shot)
 * Submits pending jobs to TRELLIS2 and tracks them
 */

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();
$TRELLIS2_URL = 'http://trellis2:7862';

echo "\n📦 [TRELLIS2 Job Processor] Starting...\n\n";

// Get all pending jobs
$stmt = $db->prepare('
    SELECT queue_id, design_id, prompt_text, user_id, metadata
    FROM generation_queue
    WHERE status = "pending"
    ORDER BY created_at ASC
');
$stmt->execute();
$pending = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "🔍 Found " . count($pending) . " pending jobs\n\n";

foreach ($pending as $job) {
    $queueId = $job['queue_id'];
    $prompt = $job['prompt_text'];
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    echo "📋 Processing: $queueId\n";
    echo "   Prompt: " . substr($prompt, 0, 60) . "...\n";
    
    // Submit to TRELLIS2
    echo "   ⏳ Submitting to TRELLIS2...\n";
    
    $eventId = submitToTrellis2($TRELLIS2_URL, $prompt);
    
    if (!$eventId) {
        echo "   ❌ Failed to submit!\n";
        $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
        $stmt->execute(['failed', $queueId]);
        continue;
    }
    
    echo "   ✅ Submitted! Event ID: $eventId\n";
    
    // Mark as processing and store event_id
    $metadata = json_decode($job['metadata'] ?? '{}', true);
    $metadata['trellis2_event_id'] = $eventId;
    $metadata['submitted_at'] = date('c');
    
    $stmt = $db->prepare('UPDATE generation_queue SET status = ?, metadata = ?, updated_at = NOW() WHERE queue_id = ?');
    $stmt->execute(['processing', json_encode($metadata), $queueId]);
    
    echo "   ✅ Status updated to 'processing'\n";
}

echo "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
echo "✅ Job submission complete!\n";
echo "   Next: Run 'docker compose exec web php scripts/check_job_status.php' to poll for results\n\n";

// ─────────────────────────────────────────────────────────────────
// Helper: Submit job to TRELLIS2
// ─────────────────────────────────────────────────────────────────

function submitToTrellis2(string $trellis2Url, string $prompt): ?string {
    $callEndpoint = $trellis2Url . '/gradio_api/call/text_to_3d';
    
    $payload = [
        'data' => [
            $prompt,                       // prompt
            30,                           // num_frames
            mt_rand(0, 2147483647)       // seed
        ]
    ];
    
    $ch = curl_init($callEndpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        error_log("[ERROR] CURL: $error");
        return null;
    }
    
    if ($httpCode !== 200) {
        error_log("[ERROR] HTTP $httpCode: " . substr($response, 0, 200));
        return null;
    }
    
    $data = json_decode($response, true);
    return $data['event_id'] ?? null;
}
