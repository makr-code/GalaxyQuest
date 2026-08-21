#!/usr/bin/env php
<?php
/**
 * Monitor Dual-Mode Job Status
 * 
 * Usage:
 *  docker compose exec web php scripts/check_dual_mode_jobs.php [queue_id]
 * 
 * Examples:
 *  docker compose exec web php scripts/check_dual_mode_jobs.php 15
 *  docker compose exec web php scripts/check_dual_mode_jobs.php all
 */

declare(strict_types=1);

require_once __DIR__ . '/../api/helpers.php';

$queueIdArg = $argv[1] ?? 'all';

error_log("═══════════════════════════════════════════════════════════════════");
error_log("Dual-Mode Job Status Monitor");
error_log("═══════════════════════════════════════════════════════════════════\n");

$db = get_db();

if ($queueIdArg === 'all') {
    // ─────────────────────────────────────────────────────────────────────────────
    // Show all recent jobs
    // ─────────────────────────────────────────────────────────────────────────────
    
    $stmt = $db->query(<<<'SQL'
        SELECT 
            id,
            prompt_text,
            input_mode,
            status,
            metadata,
            created_at,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) as elapsed_seconds
        FROM generation_queue
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ORDER BY id DESC
        LIMIT 20
SQL);
    
    $jobs = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    if (empty($jobs)) {
        error_log("No jobs found in last hour.");
        exit(1);
    }
    
    error_log(sprintf("%-5s %-40s %-10s %-12s %-8s %-10s", 'ID', 'Prompt', 'Mode', 'Status', 'Type', 'Elapsed'));
    error_log("─────────────────────────────────────────────────────────────────────────────\n");
    
    foreach ($jobs as $job) {
        $metadata = json_decode($job['metadata'] ?? '{}', true) ?? [];
        $jobType = $metadata['job_type'] ?? 'trellis2';
        $promptShort = substr($job['prompt_text'], 0, 40);
        $statusEmoji = match ($job['status']) {
            'pending' => '⏳',
            'processing' => '⚙️',
            'completed' => '✅',
            'failed' => '❌',
            default => '?'
        };
        
        error_log(sprintf(
            "%-5d %-40s %-10s %s %-10s %-8s %3ds",
            $job['id'],
            $promptShort,
            $job['input_mode'],
            $statusEmoji . ' ' . str_pad($job['status'], 9),
            $jobType,
            $statusEmoji,
            $job['elapsed_seconds']
        ));
    }
    
} else {
    // ─────────────────────────────────────────────────────────────────────────────
    // Show detailed status for single job
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
    
    $stmt->execute([(int)$queueIdArg]);
    $job = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$job) {
        error_log("Job not found: $queueIdArg");
        exit(1);
    }
    
    $metadata = json_decode($job['metadata'] ?? '{}', true) ?? [];
    $jobType = $metadata['job_type'] ?? 'trellis2';
    $trellis2EventId = $metadata['trellis2_event_id'] ?? null;
    $comfyuiPromptId = $metadata['comfyui_prompt_id'] ?? null;
    $submittedAt = $metadata['submitted_at'] ?? null;
    
    // Calculate progress
    $progress = 0.0;
    $progressBar = '';
    
    switch ($job['status']) {
        case 'pending':
            $progress = 0.0;
            $progressBar = '[' . str_repeat('─', 30) . '] 0%';
            break;
        case 'processing':
            $elapsed = (int)$job['elapsed_seconds'];
            $progress = min(0.95, $elapsed / 120.0);
            $filled = (int)($progress * 30);
            $progressBar = '[' . str_repeat('█', $filled) . str_repeat('─', 30 - $filled) . '] ' . sprintf("%.0f%%", $progress * 100);
            break;
        case 'completed':
            $progress = 1.0;
            $progressBar = '[' . str_repeat('█', 30) . '] 100%';
            break;
        case 'failed':
            $progress = -1.0;
            $progressBar = '[' . str_repeat('✗', 30) . '] ERROR';
            break;
    }
    
    error_log("Job ID: " . $job['id']);
    error_log("User ID: " . $job['user_id']);
    error_log("Status: " . $job['status']);
    error_log("Progress: $progressBar");
    error_log("");
    error_log("Backend Configuration:");
    error_log("├─ Job Type: $jobType");
    error_log("├─ Input Mode: " . $job['input_mode']);
    error_log("├─ TRELLIS2 Event ID: " . ($trellis2EventId ?? 'N/A'));
    error_log("├─ ComfyUI Prompt ID: " . ($comfyuiPromptId ?? 'N/A'));
    error_log("");
    error_log("Prompt:");
    error_log("└─ " . $job['prompt_text']);
    error_log("");
    error_log("Timeline:");
    error_log("├─ Submitted: " . ($submittedAt ?? 'N/A'));
    error_log("├─ Started: " . ($job['started_at'] ?? 'N/A'));
    error_log("├─ Completed: " . ($job['completed_at'] ?? 'N/A'));
    error_log("├─ Elapsed: " . $job['elapsed_seconds'] . "s");
    error_log("└─ Total Duration: " . $job['total_duration'] . "s");
    error_log("");
    
    if ($job['error_message']) {
        error_log("Error:");
        error_log("└─ " . $job['error_message']);
        error_log("");
    }
    
    if ($job['status'] === 'pending') {
        error_log("💡 Job is waiting in queue. Daemon processes jobs every 30 seconds.");
        error_log("   Run: docker compose exec web ps aux | grep daemon");
    } elseif ($job['status'] === 'processing') {
        if ($jobType === 'comfyui') {
            error_log("💡 ComfyUI is generating the model. Check ComfyUI logs:");
            error_log("   docker compose logs comfyui | tail -20");
        } else {
            error_log("💡 TRELLIS2 is generating the model. Check for GLB files:");
            error_log("   ls -lah /generated/trellis2/");
        }
    } elseif ($job['status'] === 'completed') {
        if ($jobType === 'comfyui') {
            error_log("💡 Model generated! Check output directory:");
            error_log("   ls -lah /generated/comfyui/output/");
        } else {
            error_log("💡 Model generated! Check output directory:");
            error_log("   ls -lah /generated/trellis2/");
        }
    }
}

error_log("\n═══════════════════════════════════════════════════════════════════\n");
