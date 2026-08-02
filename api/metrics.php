<?php
/**
 * TRELLIS2 Prometheus Metrics Exporter
 * 
 * Exposes metrics in Prometheus format for monitoring
 * Access: GET /metrics
 * 
 * Metrics exposed:
 * - Queue depth (jobs)
 * - Processing time (seconds)
 * - Cache hit ratio (%)
 * - User quota utilization
 * - API response times
 * - Database query performance
 */

declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');

// ─── Database Connection ──────────────────────────────────────────────────

function getDatabase(): PDO {
    static $pdo = null;
    
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            getenv('DB_HOST') ?: 'db',
            getenv('DB_PORT') ?: 3306,
            getenv('DB_NAME') ?: 'galaxyquest'
        );
        
        $pdo = new PDO(
            $dsn,
            getenv('DB_USER') ?: 'root',
            getenv('DB_PASS') ?: 'root'
        );
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }
    
    return $pdo;
}

// ─── Metrics Collection ───────────────────────────────────────────────────

$metrics = [];

try {
    $pdo = getDatabase();
    
    // ─── Queue Metrics ────────────────────────────────────────────────────
    
    // Queue depth by status
    $stmt = $pdo->query('SELECT status, COUNT(*) as count FROM generation_queue GROUP BY status');
    $queueByStatus = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    
    foreach (['queued', 'processing', 'complete', 'failed'] as $status) {
        $count = $queueByStatus[$status] ?? 0;
        $metrics[] = sprintf('trellis2_queue_count{status="%s"} %d', $status, $count);
    }
    
    // Active jobs
    $activeJobs = $queueByStatus['processing'] ?? 0;
    $metrics[] = sprintf('trellis2_active_jobs %d', $activeJobs);
    
    // Queued jobs
    $queuedJobs = $queueByStatus['queued'] ?? 0;
    $metrics[] = sprintf('trellis2_queued_jobs %d', $queuedJobs);
    
    // Failed jobs (last 24h)
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue 
                        WHERE status = "failed" AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)');
    $failedJobs24h = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $metrics[] = sprintf('trellis2_failed_jobs_24h %d', $failedJobs24h);
    
    // ─── Processing Metrics ──────────────────────────────────────────────
    
    // Average processing time (ms)
    $stmt = $pdo->query('SELECT AVG(generation_time_ms) as avg_ms FROM asset_generations 
                        WHERE status = "complete" AND generation_time_ms > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $avgProcessingMs = $result['avg_ms'] ?? 0;
    $metrics[] = sprintf('trellis2_avg_processing_ms %.2f', $avgProcessingMs);
    
    // Min/Max processing time
    $stmt = $pdo->query('SELECT MIN(generation_time_ms) as min_ms, MAX(generation_time_ms) as max_ms 
                        FROM asset_generations WHERE status = "complete" AND generation_time_ms > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $minMs = $result['min_ms'] ?? 0;
    $maxMs = $result['max_ms'] ?? 0;
    $metrics[] = sprintf('trellis2_min_processing_ms %d', $minMs);
    $metrics[] = sprintf('trellis2_max_processing_ms %d', $maxMs);
    
    // P95 processing time (approximate)
    $stmt = $pdo->query('SELECT SUBSTRING_INDEX(GROUP_CONCAT(generation_time_ms ORDER BY generation_time_ms DESC), ",", 1) as p95 
                        FROM (SELECT generation_time_ms FROM asset_generations 
                              WHERE status = "complete" AND generation_time_ms > 0
                              ORDER BY generation_time_ms DESC LIMIT 100) t');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $p95Ms = $result['p95'] ?? 0;
    $metrics[] = sprintf('trellis2_p95_processing_ms %d', $p95Ms);
    
    // ─── Cache Metrics ───────────────────────────────────────────────────
    
    // Cache hits (jobs that used cached result)
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue 
                        WHERE status = "complete" AND cached_result = 1');
    $cacheHits = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_cache_hits_total %d', $cacheHits);
    
    // Cache hit ratio (%)
    $stmt = $pdo->query('SELECT 
                        SUM(CASE WHEN cached_result = 1 THEN 1 ELSE 0 END) as hits,
                        COUNT(*) as total
                        FROM generation_queue WHERE status = "complete"');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $hitRatio = $result['total'] > 0 ? ($result['hits'] / $result['total'] * 100) : 0;
    $metrics[] = sprintf('trellis2_cache_hit_ratio %.2f', $hitRatio);
    
    // ─── Success Metrics ──────────────────────────────────────────────────
    
    // Success rate (today)
    $stmt = $pdo->query('SELECT 
                        SUM(CASE WHEN status = "complete" THEN 1 ELSE 0 END) as complete,
                        COUNT(*) as total
                        FROM generation_queue WHERE DATE(created_at) = CURDATE()');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $successRate = $result['total'] > 0 ? ($result['complete'] / $result['total'] * 100) : 0;
    $metrics[] = sprintf('trellis2_success_rate_today %.2f', $successRate);
    
    // Completion rate (jobs completed per hour)
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM asset_generations 
                        WHERE status = "complete" AND completed_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)');
    $completedLastHour = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_completions_per_hour %d', $completedLastHour);
    
    // ─── Quota Metrics ────────────────────────────────────────────────────
    
    // Total storage used (GB)
    $stmt = $pdo->query('SELECT SUM(glb_file_size) as total FROM asset_generations WHERE status = "complete"');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $storageUsedGb = ($result['total'] ?? 0) / (1024 * 1024 * 1024);
    $metrics[] = sprintf('trellis2_storage_used_gb %.2f', $storageUsedGb);
    
    // Storage quota usage (average user %)
    $stmt = $pdo->query('SELECT AVG(storage_percent_used) as avg_pct FROM user_asset_quotas WHERE storage_limit_gb > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $avgStoragePercent = $result['avg_pct'] ?? 0;
    $metrics[] = sprintf('trellis2_avg_user_storage_percent %.2f', $avgStoragePercent);
    
    // Total active users (with quota records)
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM user_asset_quotas');
    $activeUsers = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_active_users %d', $activeUsers);
    
    // Users at quota limit (>95%)
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM user_asset_quotas WHERE storage_percent_used >= 95');
    $usersAtLimit = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_users_at_storage_limit %d', $usersAtLimit);
    
    // ─── Retry Metrics ───────────────────────────────────────────────────
    
    // Total retries (jobs that were retried)
    $stmt = $pdo->query('SELECT SUM(retry_count) as total FROM generation_queue WHERE retry_count > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $totalRetries = $result['total'] ?? 0;
    $metrics[] = sprintf('trellis2_total_retries %d', $totalRetries);
    
    // Average retries per failed job
    $stmt = $pdo->query('SELECT AVG(retry_count) as avg_retries FROM generation_queue WHERE status = "failed" AND retry_count > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $avgRetries = $result['avg_retries'] ?? 0;
    $metrics[] = sprintf('trellis2_avg_retries_per_failure %.2f', $avgRetries);
    
    // ─── File Size Metrics ───────────────────────────────────────────────
    
    // Average GLB file size (MB)
    $stmt = $pdo->query('SELECT AVG(glb_file_size) as avg_bytes FROM asset_generations WHERE status = "complete" AND glb_file_size > 0');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $avgFileSizeMb = ($result['avg_bytes'] ?? 0) / (1024 * 1024);
    $metrics[] = sprintf('trellis2_avg_glb_file_size_mb %.2f', $avgFileSizeMb);
    
    // Largest GLB file (MB)
    $stmt = $pdo->query('SELECT MAX(glb_file_size) as max_bytes FROM asset_generations WHERE status = "complete"');
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $maxFileSizeMb = ($result['max_bytes'] ?? 0) / (1024 * 1024);
    $metrics[] = sprintf('trellis2_max_glb_file_size_mb %.2f', $maxFileSizeMb);
    
    // ─── Time-based Metrics (Today) ───────────────────────────────────────
    
    // Jobs created today
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue WHERE DATE(created_at) = CURDATE()');
    $jobsCreatedToday = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_jobs_created_today %d', $jobsCreatedToday);
    
    // Jobs completed today
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM asset_generations WHERE DATE(completed_at) = CURDATE() AND status = "complete"');
    $jobsCompletedToday = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_jobs_completed_today %d', $jobsCompletedToday);
    
    // ─── Database Metrics ────────────────────────────────────────────────
    
    // Database connection status (1 = ok, 0 = error)
    $metrics[] = sprintf('trellis2_database_connected 1');
    
    // Total number of vessel designs
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM vessel_designs WHERE is_deleted = 0');
    $totalDesigns = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_total_vessel_designs %d', $totalDesigns);
    
    // Total number of generations
    $stmt = $pdo->query('SELECT COUNT(*) as count FROM asset_generations');
    $totalGenerations = $stmt->fetch(PDO::FETCH_ASSOC)['count'] ?? 0;
    $metrics[] = sprintf('trellis2_total_generations %d', $totalGenerations);
    
} catch (Exception $e) {
    // If DB is unavailable, still output basic error metric
    $metrics[] = '# ERROR: ' . str_replace("\n", ' ', $e->getMessage());
    $metrics[] = 'trellis2_database_connected 0';
}

// ─── Output Metrics ────────────────────────────────────────────────────

// Prometheus comments
echo "# HELP trellis2_queue_count Number of jobs in queue by status\n";
echo "# TYPE trellis2_queue_count gauge\n";

echo "# HELP trellis2_active_jobs Number of jobs currently processing\n";
echo "# TYPE trellis2_active_jobs gauge\n";

echo "# HELP trellis2_queued_jobs Number of jobs waiting to be processed\n";
echo "# TYPE trellis2_queued_jobs gauge\n";

echo "# HELP trellis2_failed_jobs_24h Number of jobs that failed in last 24 hours\n";
echo "# TYPE trellis2_failed_jobs_24h gauge\n";

echo "# HELP trellis2_avg_processing_ms Average processing time in milliseconds\n";
echo "# TYPE trellis2_avg_processing_ms gauge\n";

echo "# HELP trellis2_cache_hit_ratio Cache hit ratio percentage\n";
echo "# TYPE trellis2_cache_hit_ratio gauge\n";

echo "# HELP trellis2_success_rate_today Success rate percentage today\n";
echo "# TYPE trellis2_success_rate_today gauge\n";

echo "# HELP trellis2_storage_used_gb Total storage used in gigabytes\n";
echo "# TYPE trellis2_storage_used_gb gauge\n";

echo "# HELP trellis2_active_users Number of active users\n";
echo "# TYPE trellis2_active_users gauge\n";

echo "# HELP trellis2_database_connected Database connection status\n";
echo "# TYPE trellis2_database_connected gauge\n";

echo "\n";

// Output all metrics
foreach ($metrics as $metric) {
    if (!str_starts_with($metric, '#')) {
        echo $metric . "\n";
    }
}

echo "\n# Generated at " . date('Y-m-d H:i:s') . "\n";
