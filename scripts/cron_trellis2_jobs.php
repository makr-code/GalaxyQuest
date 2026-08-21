<?php
/**
 * Cron Job Processor - Run every 30 seconds
 * Coordinates TRELLIS2 job submission and completion tracking
 * 
 * Setup cron:
 * * * * * * php /var/www/html/scripts/cron_trellis2_jobs.php >/dev/null 2>&1
 * * * * * * sleep 30 && php /var/www/html/scripts/cron_trellis2_jobs.php >/dev/null 2>&1
 * 
 * Or run manually: php scripts/cron_trellis2_jobs.php
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

$db = get_db();
$TRELLIS2_URL = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';

// Get lock file to prevent concurrent execution
$lockFile = '/tmp/trellis2_cron.lock';
$lockTimeout = 60; // Release lock after 60 seconds

// Check if another process is running
if (file_exists($lockFile)) {
    $lockAge = time() - filemtime($lockFile);
    if ($lockAge < $lockTimeout) {
        exit(0);  // Another process is running, skip
    }
    @unlink($lockFile);  // Stale lock, remove it
}

// Create lock
touch($lockFile);

try {
    // Step 1: Submit any pending jobs
    submitPendingJobs($db, $TRELLIS2_URL);
    
    // Step 2: Check for completed jobs
    checkProcessingJobs($db);
    
} finally {
    // Release lock
    @unlink($lockFile);
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

function submitPendingJobs(PDO $db, string $trellis2Url): void {
    $stmt = $db->prepare('
        SELECT queue_id, design_id, prompt_text, user_id, metadata
        FROM generation_queue
        WHERE status = "pending"
        LIMIT 5
    ');
    $stmt->execute();
    $pending = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($pending as $job) {
        $queueId = $job['queue_id'];
        $prompt = $job['prompt_text'];
        
        // Submit to TRELLIS2
        $eventId = submitToTrellis2($trellis2Url, $prompt);
        
        if (!$eventId) {
            // Mark as failed if submission fails
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['failed', $queueId]);
            continue;
        }
        
        // Update with event_id and mark as processing
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $metadata['trellis2_event_id'] = $eventId;
        $metadata['submitted_at'] = date('c');
        
        $stmt = $db->prepare('UPDATE generation_queue SET status = ?, metadata = ?, updated_at = NOW() WHERE queue_id = ?');
        $stmt->execute(['processing', json_encode($metadata), $queueId]);
    }
}

function checkProcessingJobs(PDO $db): void {
    $stmt = $db->prepare('
        SELECT queue_id, design_id, user_id, metadata
        FROM generation_queue
        WHERE status = "processing"
        LIMIT 10
    ');
    $stmt->execute();
    $processing = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($processing as $job) {
        $queueId = $job['queue_id'];
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $eventId = $metadata['trellis2_event_id'] ?? null;
        $submittedTime = strtotime($metadata['submitted_at'] ?? date('c', time() - 300));
        $elapsedSec = time() - $submittedTime;
        
        // Check for completion
        $glbPath = tryFindGeneratedGLB($queueId, $eventId);
        
        if ($glbPath) {
            // Completed!
            $generationId = bin2hex(random_bytes(8));
            
            try {
                $stmt = $db->prepare(<<<'SQL'
                    INSERT INTO asset_generations 
                    (generation_id, user_id, design_id, queue_id, model_path, status, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                SQL);
                $stmt->execute([
                    $generationId,
                    $job['user_id'],
                    $job['design_id'],
                    $queueId,
                    $glbPath,
                    'completed',
                    json_encode([
                        'source' => 'trellis2',
                        'trellis2_event_id' => $eventId,
                        'processing_time_seconds' => $elapsedSec
                    ])
                ]);
                
                // Update queue
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, generation_id = ?, updated_at = NOW() WHERE queue_id = ?');
                $stmt->execute(['completed', $generationId, $queueId]);
            } catch (Exception $e) {
                error_log("[TRELLIS2 Cron] Failed to save asset: " . $e->getMessage());
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
                $stmt->execute(['failed', $queueId]);
            }
        } elseif ($elapsedSec > 600) {
            // Timeout
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['failed', $queueId]);
        }
    }
}

function submitToTrellis2(string $trellis2Url, string $prompt): ?string {
    $callEndpoint = $trellis2Url . '/gradio_api/call/text_to_3d';
    
    $payload = ['data' => [$prompt, 30, mt_rand(0, 2147483647)]];
    
    $ch = curl_init($callEndpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        return $data['event_id'] ?? null;
    }
    
    return null;
}

function tryFindGeneratedGLB(?string $queueId, ?string $eventId): ?string {
    $generatedDir = __DIR__ . '/../generated/trellis2';
    
    if (!is_dir($generatedDir)) {
        return null;
    }
    
    $glbFiles = glob($generatedDir . '/*.glb');
    if (empty($glbFiles)) {
        return null;
    }
    
    usort($glbFiles, fn($a, $b) => filemtime($b) - filemtime($a));
    
    foreach ($glbFiles as $file) {
        $size = filesize($file);
        $mtime = filemtime($file);
        $ageSec = time() - $mtime;
        
        if ($ageSec < 600 && $size > 1024) {
            $basename = basename($file);
            
            if ($queueId && strpos($basename, $queueId) === false) {
                $newName = substr($queueId, 0, 8) . '_' . $basename;
                $newPath = $generatedDir . '/' . $newName;
                if (@rename($file, $newPath)) {
                    return '/generated/trellis2/' . $newName;
                }
            }
            
            return '/generated/trellis2/' . $basename;
        }
    }
    
    return null;
}
