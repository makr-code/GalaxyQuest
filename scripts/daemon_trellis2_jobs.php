#!/usr/bin/env php
<?php
/**
 * TRELLIS2 Background Daemon
 * Runs continuously and processes jobs every 30 seconds
 * 
 * Start: docker compose exec -d web php scripts/daemon_trellis2_jobs.php
 * Stop: docker compose exec web pkill -f daemon_trellis2_jobs.php
 */

declare(strict_types=1);

set_time_limit(0);  // No timeout
ignore_user_abort(true);  // Keep running even if client disconnects

require_once __DIR__ . '/../api/helpers.php';

$TRELLIS2_URL = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';
$POLL_INTERVAL = 30;  // Process every 30 seconds

error_log("[TRELLIS2 Daemon] Started at " . date('c'));

$iteration = 0;

while (true) {
    $iteration++;
    
    try {
        $db = get_db();
        
        // Step 1: Submit pending jobs
        submitPendingJobs($db, $TRELLIS2_URL);
        
        // Step 2: Check for completed jobs
        checkProcessingJobs($db);
        
        error_log("[TRELLIS2 Daemon] Iteration $iteration completed at " . date('c'));
        
    } catch (Exception $e) {
        error_log("[TRELLIS2 Daemon] Error: " . $e->getMessage());
    }
    
    // Sleep before next iteration
    sleep($POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────

function submitPendingJobs(PDO $db, string $trellis2Url): void {
    $stmt = $db->prepare('SELECT queue_id, prompt_text, metadata FROM generation_queue WHERE status = "pending" LIMIT 5');
    $stmt->execute();
    $pending = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (!empty($pending)) {
        error_log("[Submit] Processing " . count($pending) . " pending jobs");
    }
    
    foreach ($pending as $job) {
        $queueId = $job['queue_id'];
        $prompt = $job['prompt_text'];
        
        $eventId = submitToTrellis2($trellis2Url, $prompt);
        
        if (!$eventId) {
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['failed', $queueId]);
            continue;
        }
        
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $metadata['trellis2_event_id'] = $eventId;
        $metadata['submitted_at'] = date('c');
        
        $stmt = $db->prepare('UPDATE generation_queue SET status = ?, metadata = ?, updated_at = NOW() WHERE queue_id = ?');
        $stmt->execute(['processing', json_encode($metadata), $queueId]);
        
        error_log("[Submit] Job $queueId → $eventId");
    }
}

function checkProcessingJobs(PDO $db): void {
    $stmt = $db->prepare('SELECT queue_id, design_id, user_id, metadata FROM generation_queue WHERE status = "processing" LIMIT 10');
    $stmt->execute();
    $processing = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    foreach ($processing as $job) {
        $queueId = $job['queue_id'];
        $metadata = json_decode($job['metadata'] ?? '{}', true);
        $eventId = $metadata['trellis2_event_id'] ?? null;
        $submittedTime = strtotime($metadata['submitted_at'] ?? date('c', time() - 300));
        $elapsedSec = time() - $submittedTime;
        
        $glbPath = tryFindGeneratedGLB($queueId, $eventId);
        
        if ($glbPath) {
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
                    json_encode(['source' => 'trellis2', 'trellis2_event_id' => $eventId, 'elapsed_seconds' => $elapsedSec])
                ]);
                
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, generation_id = ?, updated_at = NOW() WHERE queue_id = ?');
                $stmt->execute(['completed', $generationId, $queueId]);
                
                error_log("[Complete] Job $queueId completed in ${elapsedSec}s");
            } catch (Exception $e) {
                error_log("[Complete] Failed to save $queueId: " . $e->getMessage());
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
                $stmt->execute(['failed', $queueId]);
            }
        } elseif ($elapsedSec > 600) {
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
            $stmt->execute(['failed', $queueId]);
            error_log("[Timeout] Job $queueId timed out after ${elapsedSec}s");
        }
    }
}

function submitToTrellis2(string $trellis2Url, string $prompt): ?string {
    $endpoint = $trellis2Url . '/gradio_api/call/text_to_3d';
    $payload = ['data' => [$prompt, 30, mt_rand(0, 2147483647)]];
    
    $ch = curl_init($endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $data = json_decode($response, true);
        return $data['event_id'] ?? null;
    }
    
    return null;
}

function tryFindGeneratedGLB(?string $queueId, ?string $eventId): ?string {
    $dir = __DIR__ . '/../generated/trellis2';
    if (!is_dir($dir)) return null;
    
    $files = glob($dir . '/*.glb');
    if (empty($files)) return null;
    
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
    
    foreach ($files as $file) {
        if (filesize($file) > 1024 && time() - filemtime($file) < 600) {
            $basename = basename($file);
            if ($queueId && strpos($basename, $queueId) === false) {
                $newPath = $dir . '/' . substr($queueId, 0, 8) . '_' . $basename;
                @rename($file, $newPath);
                return '/generated/trellis2/' . basename($newPath);
            }
            return '/generated/trellis2/' . $basename;
        }
    }
    
    return null;
}
