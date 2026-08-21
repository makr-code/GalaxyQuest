<?php
/**
 * TRELLIS2 Background Daemon
 * Processes generation_queue jobs asynchronously
 * 
 * Usage: php api/generation_queue_daemon.php [--max-jobs N] [--once]
 * --once: Process one batch and exit (for testing)
 * --max-jobs: Max jobs to process per cycle (default: 5)
 */

require_once __DIR__ . '/helpers.php';

const DEFAULT_MAX_JOBS = 5;
const TRELLIS2_TIMEOUT = 600;  // 10 minutes
const POLL_INTERVAL = 5;       // seconds between cycles
const JOB_TIMEOUT = 600;       // Mark job failed after 10 minutes

$maxJobs = DEFAULT_MAX_JOBS;
$oneShot = false;

// Parse CLI arguments
foreach ($argv as $arg) {
    if ($arg === '--once') {
        $oneShot = true;
    } elseif (str_starts_with($arg, '--max-jobs=')) {
        $maxJobs = (int)substr($arg, 11);
    }
}

$running = true;
$cycle = 0;

// Signal handlers for graceful shutdown
if (function_exists('pcntl_signal')) {
    pcntl_signal(SIGTERM, function () use (&$running) {
        error_log('[DAEMON] SIGTERM received, graceful shutdown...');
        $running = false;
    });
    pcntl_signal(SIGINT, function () use (&$running) {
        error_log('[DAEMON] SIGINT received, graceful shutdown...');
        $running = false;
    });
}

error_log('[DAEMON] Starting TRELLIS2 generation daemon (max_jobs=' . $maxJobs . ', oneShot=' . ($oneShot ? 'true' : 'false') . ')');

while ($running) {
    $cycle++;
    error_log("[DAEMON] Cycle $cycle");
    
    try {
        $db = get_db();
        
        // 1. Find queued jobs
        $stmt = $db->prepare(<<<'SQL'
            SELECT id, user_id, vessel_design_id, prompt_text, priority
            FROM generation_queue
            WHERE status = 'queued'
            ORDER BY priority DESC, created_at ASC
            LIMIT ?
        SQL);
        $stmt->execute([$maxJobs]);
        $queuedJobs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        if (empty($queuedJobs)) {
            error_log("[DAEMON] No queued jobs found");
        } else {
            error_log("[DAEMON] Found " . count($queuedJobs) . " queued job(s)");
        }
        
        // 2. Process each job
        foreach ($queuedJobs as $job) {
            processJob($db, $job);
        }
        
        // 3. Check processing jobs for completion
        $stmt = $db->prepare(<<<'SQL'
            SELECT id, prompt_text, error_message, started_at
            FROM generation_queue
            WHERE status = 'processing'
            LIMIT 20
        SQL);
        $stmt->execute([]);
        $processingJobs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        foreach ($processingJobs as $job) {
            checkJobCompletion($db, $job);
        }
        
        // 4. Mark jobs as failed if timeout exceeded
        $stmt = $db->prepare(<<<'SQL'
            UPDATE generation_queue
            SET status = 'failed',
                error_message = 'Generation timeout (>10 minutes)',
                completed_at = NOW()
            WHERE status = 'processing'
            AND started_at IS NOT NULL
            AND TIMESTAMPDIFF(SECOND, started_at, NOW()) > ?
        SQL);
        $stmt->execute([JOB_TIMEOUT]);
        $timedOut = $stmt->rowCount();
        if ($timedOut > 0) {
            error_log("[DAEMON] Marked $timedOut job(s) as failed due to timeout");
        }
        
        if ($oneShot) {
            error_log('[DAEMON] One-shot mode, exiting');
            break;
        }
        
        error_log("[DAEMON] Cycle $cycle complete, sleeping {$POLL_INTERVAL}s");
        sleep(POLL_INTERVAL);
        
    } catch (\Exception $e) {
        error_log('[DAEMON] ERROR: ' . $e->getMessage());
        error_log('[DAEMON] Traceback: ' . $e->getTraceAsString());
        sleep(5);  // Back off on error
    }
}

error_log('[DAEMON] Daemon exited gracefully');

/**
 * Submit a queued job to TRELLIS2 and mark as processing
 */
function processJob($db, $job) {
    $jobId = $job['id'];
    $prompt = $job['prompt_text'];
    
    error_log("[JOB $jobId] Processing: $prompt");
    
    try {
        // Call TRELLIS2 Gradio API
        // Expected response: {"session_hash": "...", "data": [...]}
        $trellis2Url = getenv('TRELLIS2_URL') ?: 'http://galaxyquest-trellis2:7862';
        $endpoint = "$trellis2Url/gradio_api/call/text_to_3d";
        
        error_log("[JOB $jobId] POST to $endpoint");
        
        $payload = json_encode([
            'data' => [
                $prompt,           // prompt
                20,                // num_frames
                42                 // seed
            ]
        ]);
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $endpoint);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($curlError) {
            throw new \Exception("CURL error: $curlError");
        }
        
        if ($httpCode !== 200) {
            throw new \Exception("HTTP $httpCode: $response");
        }
        
        $data = json_decode($response, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \Exception("Invalid JSON response: " . json_last_error_msg());
        }
        
        // Extract event_id from response
        $eventId = $data['event_id'] ?? null;
        if (!$eventId) {
            throw new \Exception("No event_id in response: " . json_encode($data));
        }
        
        error_log("[JOB $jobId] Submitted to TRELLIS2, event_id=$eventId");
        
        // Update job status to 'processing' and store event_id
        $stmt = $db->prepare(<<<'SQL'
            UPDATE generation_queue
            SET status = 'processing',
                started_at = NOW(),
                error_message = ?
            WHERE id = ?
        SQL);
        $stmt->execute([$eventId, $jobId]);
        
        error_log("[JOB $jobId] Updated to status='processing', event_id stored in error_message field");
        
    } catch (\Exception $e) {
        error_log("[JOB $jobId] ERROR: " . $e->getMessage());
        
        // Mark job as failed
        $stmt = $db->prepare(<<<'SQL'
            UPDATE generation_queue
            SET status = 'failed',
                error_message = ?,
                completed_at = NOW()
            WHERE id = ?
        SQL);
        $stmt->execute([$e->getMessage(), $jobId]);
    }
}

/**
 * Check if a processing job's GLB file has been generated
 */
function checkJobCompletion($db, $job) {
    $jobId = $job['id'];
    $eventId = $job['error_message'];  // We stored event_id here
    $prompt = $job['prompt_text'];
    
    // Look for any .glb file in /generated/trellis2/
    // For now, we'll check if ANY recent GLB exists (simple heuristic)
    $genDir = __DIR__ . '/../generated/trellis2';
    if (!is_dir($genDir)) {
        return;
    }
    
    $glbFiles = glob("$genDir/*.glb");
    if (empty($glbFiles)) {
        return;  // No files yet
    }
    
    // Sort by modification time, newest first
    usort($glbFiles, function ($a, $b) {
        return filemtime($b) - filemtime($a);
    });
    
    // Check most recent GLB for valid size (> 1KB means real model)
    $latestGlb = $glbFiles[0];
    $size = filesize($latestGlb);
    $mtime = filemtime($latestGlb);
    $ageSec = time() - $mtime;
    
    // If file is recent (< 2 minutes old) and > 1KB, it's probably our job
    if ($ageSec < 120 && $size > 1024) {
        error_log("[JOB $jobId] Found GLB file: $latestGlb (" . number_format($size) . " bytes, age={$ageSec}s)");
        
        // Mark as complete
        $stmt = $db->prepare(<<<'SQL'
            UPDATE generation_queue
            SET status = 'complete',
                completed_at = NOW(),
                error_message = ?
            WHERE id = ?
        SQL);
        $relativePath = str_replace(__DIR__ . '/../', '', $latestGlb);
        $stmt->execute(["Completed: $relativePath", $jobId]);
        
        error_log("[JOB $jobId] Marked as complete");
    }
}
