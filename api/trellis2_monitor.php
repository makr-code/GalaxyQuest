<?php
/**
 * TRELLIS2 Runtime Monitoring API
 * Provides real-time metrics about TRELLIS2 service health and performance
 * 
 * GET /api/trellis2_monitor.php
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

// Get TRELLIS2 endpoint
$trellis2_url = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';

$monitoring = [
    'timestamp' => date('c'),
    'service' => [
        'status' => 'unknown',
        'reachable' => false,
        'response_time_ms' => 0,
        'version' => null,
    ],
    'gpu' => [
        'available' => false,
        'memory_used_mb' => 0,
        'memory_total_mb' => 0,
        'utilization_percent' => 0,
        'device_name' => null,
    ],
    'queue' => [
        'pending_jobs' => 0,
        'processing_jobs' => 0,
        'completed_jobs' => 0,
        'failed_jobs' => 0,
        'total_queued' => 0,
    ],
    'jobs' => [],
    'errors' => [],
];

// ───────────────────────────────────────────────────────────────────
// 1. Check TRELLIS2 Service Health
// ───────────────────────────────────────────────────────────────────

$start = microtime(true);
$response = @file_get_contents($trellis2_url, false, stream_context_create([
    'http' => ['timeout' => 3]
]));
$elapsed = (microtime(true) - $start) * 1000;

if ($response !== false) {
    $monitoring['service']['reachable'] = true;
    $monitoring['service']['response_time_ms'] = round($elapsed, 2);
    
    // Try to get Gradio info
    $infoUrl = $trellis2_url . '/gradio_api/info/';
    $infoResponse = @file_get_contents($infoUrl, false, stream_context_create([
        'http' => ['timeout' => 3]
    ]));
    
    if ($infoResponse !== false) {
        $info = json_decode($infoResponse, true);
        $monitoring['service']['status'] = 'healthy';
        
        // Count endpoints
        if (isset($info['named_endpoints'])) {
            $monitoring['service']['version'] = 'Gradio ' . ($info['version'] ?? 'unknown');
        }
    } else {
        $monitoring['service']['status'] = 'degraded';
        $monitoring['errors'][] = 'Could not fetch Gradio API info';
    }
} else {
    $monitoring['service']['status'] = 'offline';
    $monitoring['errors'][] = 'TRELLIS2 service unreachable at ' . $trellis2_url;
}

// ───────────────────────────────────────────────────────────────────
// 2. Check Database Queue Status
// ───────────────────────────────────────────────────────────────────

try {
    require_once __DIR__ . '/helpers.php';
    $db = get_db();
    
    $stmt = $db->query(<<<'SQL'
        SELECT 
            status,
            COUNT(*) as count
        FROM generation_queue
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY status
    SQL);
    
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $status = strtolower($row['status']);
        $count = (int)$row['count'];
        
        if ($status === 'pending') {
            $monitoring['queue']['pending_jobs'] = $count;
        } elseif ($status === 'processing') {
            $monitoring['queue']['processing_jobs'] = $count;
        } elseif ($status === 'completed') {
            $monitoring['queue']['completed_jobs'] = $count;
        } elseif ($status === 'failed') {
            $monitoring['queue']['failed_jobs'] = $count;
        }
    }
    
    $monitoring['queue']['total_queued'] = 
        $monitoring['queue']['pending_jobs'] + 
        $monitoring['queue']['processing_jobs'] + 
        $monitoring['queue']['failed_jobs'];
    
    // Get recent jobs (last 5)
    $stmt = $db->query(<<<'SQL'
        SELECT 
            queue_id,
            prompt_text,
            status,
            priority,
            created_at,
            updated_at
        FROM generation_queue
        ORDER BY updated_at DESC
        LIMIT 5
    SQL);
    
    $monitoring['jobs'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
} catch (Exception $e) {
    $monitoring['errors'][] = 'Database error: ' . $e->getMessage();
    $monitoring['queue']['status'] = 'unavailable';
}

// ───────────────────────────────────────────────────────────────────
// 3. Try to get GPU info from TRELLIS2 via container inspection
// ───────────────────────────────────────────────────────────────────

// Parse Docker container stats if available
if (function_exists('shell_exec')) {
    @exec('docker stats galaxyquest-trellis2 --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null', $output);
    
    if (!empty($output)) {
        // Parse memory usage (e.g., "512MB / 12GB")
        foreach ($output as $line) {
            if (preg_match('/(\d+\.?\d*)(MB|GB)\s*\/\s*(\d+\.?\d*)(MB|GB)/', $line, $m)) {
                $used = (float)$m[1];
                $total = (float)$m[3];
                
                // Convert to MB if GB
                if ($m[2] === 'GB') $used *= 1024;
                if ($m[4] === 'GB') $total *= 1024;
                
                $monitoring['gpu']['memory_used_mb'] = (int)$used;
                $monitoring['gpu']['memory_total_mb'] = (int)$total;
                $monitoring['gpu']['utilization_percent'] = (int)round(($used / $total) * 100);
                $monitoring['gpu']['available'] = true;
                break;
            }
        }
    }
}

// If we couldn't get GPU info, provide defaults
if (!$monitoring['gpu']['available']) {
    $monitoring['gpu']['device_name'] = 'NVIDIA (info unavailable)';
}

// ───────────────────────────────────────────────────────────────────
// Response
// ───────────────────────────────────────────────────────────────────

http_response_code(200);
echo json_encode($monitoring, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
