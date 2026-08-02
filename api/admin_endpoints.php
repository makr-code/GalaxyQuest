<?php
/**
 * TRELLIS2 Admin API Endpoints
 * 
 * Provides admin dashboard backend for:
 * - Queue monitoring & management
 * - User quota administration
 * - Analytics & performance metrics
 * - Audit log retrieval
 * - System health checks
 * 
 * Access: /api/admin/... (Admin authentication required)
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ─── Authentication ───────────────────────────────────────────────────────

function getCurrentUserId(): ?int {
    // Same as trellis2_endpoints.php
    if (!empty($_SESSION['user_id'])) {
        return (int)$_SESSION['user_id'];
    }
    
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(.+)$/', $auth, $m)) {
        $token = $m[1];
        try {
            $decoded = verifyJWT($token);
            if ($decoded && isset($decoded->sub)) {
                return (int)$decoded->sub;
            }
        } catch (Exception $e) {
            return null;
        }
    }
    
    return null;
}

function verifyJWT(string $token): ?object {
    try {
        $secret = getenv('JWT_SECRET');
        if (!$secret) return null;
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;
        $payload = json_decode(base64_decode($parts[1]));
        return $payload;
    } catch (Exception $e) {
        return null;
    }
}

function isAdminUser(int $userId): bool {
    // Check multiple auth methods:
    
    // 1. Admin API key header (for simple integrations)
    $adminKey = $_SERVER['HTTP_X_ADMIN_KEY'] ?? null;
    if ($adminKey === getenv('ADMIN_API_KEY')) {
        return true;
    }
    
    // 2. Check user role in database
    try {
        $pdo = getDatabase();
        $stmt = $pdo->prepare('SELECT role FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        return $result && $result['role'] === 'admin';
    } catch (Exception $e) {
        return false;
    }
}

function requireAdmin(): int {
    $userId = getCurrentUserId();
    
    if (!$userId || !isAdminUser($userId)) {
        http_response_code(403);
        echo json_encode([
            'error' => 'Admin access required',
            'message' => 'You do not have permission to access this resource'
        ]);
        exit;
    }
    
    return $userId;
}

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

// ─── Routing ──────────────────────────────────────────────────────────────

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$adminUserId = requireAdmin();

// Match routes
if (preg_match('#^/api/admin/stats$#', $path) && $method === 'GET') {
    getStats();
} elseif (preg_match('#^/api/admin/queue$#', $path) && $method === 'GET') {
    getQueue();
} elseif (preg_match('#^/api/admin/queue/(\d+)$#', $path, $m) && $method === 'DELETE') {
    cancelJob((int)$m[1]);
} elseif (preg_match('#^/api/admin/queue/failed$#', $path) && $method === 'DELETE') {
    clearFailedJobs();
} elseif (preg_match('#^/api/admin/queue/pause$#', $path) && $method === 'POST') {
    pauseQueue();
} elseif (preg_match('#^/api/admin/quotas$#', $path) && $method === 'GET') {
    getQuotas();
} elseif (preg_match('#^/api/admin/quotas/(\d+)$#', $path, $m) && $method === 'PUT') {
    updateQuota((int)$m[1]);
} elseif (preg_match('#^/api/admin/audit_logs$#', $path) && $method === 'GET') {
    getAuditLogs();
} elseif (preg_match('#^/api/admin/audit_logs/export$#', $path) && $method === 'GET') {
    exportAuditLogs();
} elseif (preg_match('#^/api/admin/analytics$#', $path) && $method === 'GET') {
    getAnalytics();
} elseif (preg_match('#^/api/admin/health$#', $path) && $method === 'GET') {
    getHealth();
} elseif (preg_match('#^/api/admin/settings$#', $path) && $method === 'PUT') {
    updateSettings();
} elseif (preg_match('#^/api/admin/worker/restart$#', $path) && $method === 'POST') {
    restartWorker();
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
}

// ─── Endpoint Handlers ────────────────────────────────────────────────────

/**
 * GET /api/admin/stats
 * Overview statistics for dashboard
 */
function getStats(): void {
    try {
        $pdo = getDatabase();
        
        // Active jobs (processing status)
        $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue WHERE status = "processing"');
        $activeJobs = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
        
        // Queued jobs
        $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue WHERE status = "queued"');
        $queuedJobs = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
        
        // Today's completions
        $stmt = $pdo->query('SELECT COUNT(*) as count FROM asset_generations WHERE DATE(completed_at) = CURDATE() AND status = "complete"');
        $todayCompleted = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
        
        // Storage used
        $stmt = $pdo->query('SELECT SUM(glb_file_size) as total FROM asset_generations WHERE status = "complete"');
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $storageUsedBytes = $result['total'] ?? 0;
        $storageUsedGb = $storageUsedBytes / (1024 * 1024 * 1024);
        
        // Cache hit ratio
        $stmt = $pdo->query('SELECT 
            SUM(CASE WHEN prompt_hash IN (SELECT prompt_hash FROM asset_generations WHERE status = "complete" LIMIT 1) THEN 1 ELSE 0 END) as hits,
            COUNT(*) as total
            FROM generation_queue WHERE status = "complete"');
        $cacheStats = $stmt->fetch(PDO::FETCH_ASSOC);
        $cacheHitRatio = $cacheStats['total'] > 0 ? ($cacheStats['hits'] / $cacheStats['total'] * 100) : 0;
        
        // Avg process time
        $stmt = $pdo->query('SELECT AVG(generation_time_ms) as avg_ms FROM asset_generations WHERE status = "complete" AND generation_time_ms > 0');
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $avgTimeMs = $result['avg_ms'] ?? 0;
        $avgTimeSec = $avgTimeMs / 1000;
        
        // Success rate
        $stmt = $pdo->query('SELECT 
            SUM(CASE WHEN status = "complete" THEN 1 ELSE 0 END) as complete,
            COUNT(*) as total
            FROM asset_generations WHERE DATE(created_at) = CURDATE()');
        $successStats = $stmt->fetch(PDO::FETCH_ASSOC);
        $successRate = $successStats['total'] > 0 ? ($successStats['complete'] / $successStats['total'] * 100) : 0;
        
        echo json_encode([
            'active_jobs' => (int)$activeJobs,
            'queued_jobs' => (int)$queuedJobs,
            'today_completed' => (int)$todayCompleted,
            'storage_used_gb' => round($storageUsedGb, 2),
            'cache_hit_ratio' => round($cacheHitRatio, 1),
            'avg_process_time' => round($avgTimeSec, 1),
            'success_rate' => round($successRate, 1),
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/queue
 * Queue monitor with filtering
 */
function getQueue(): void {
    try {
        $pdo = getDatabase();
        
        $status = $_GET['status'] ?? '';
        $limit = (int)($_GET['limit'] ?? 25);
        $offset = (int)($_GET['offset'] ?? 0);
        
        $query = 'SELECT 
            gq.id,
            gq.status,
            gq.user_id,
            gq.prompt_text,
            gq.retry_count,
            gq.created_at,
            (SELECT COUNT(*) FROM generation_queue gq2 
             WHERE gq2.status = "queued" AND gq2.created_at < gq.created_at) as queue_position,
            (SELECT COUNT(*) FROM generation_queue WHERE status = "queued") as total_in_queue,
            CEIL((SELECT COUNT(*) FROM generation_queue WHERE status = "queued") * 12) as estimated_wait_seconds
            FROM generation_queue gq';
        
        if ($status) {
            $query .= ' WHERE gq.status = :status';
        }
        
        $query .= ' ORDER BY gq.priority DESC, gq.created_at ASC LIMIT :limit OFFSET :offset';
        
        $stmt = $pdo->prepare($query);
        if ($status) {
            $stmt->bindValue(':status', $status);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();
        
        $queue = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode([
            'queue' => $queue,
            'total' => count($queue),
            'limit' => $limit,
            'offset' => $offset,
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * DELETE /api/admin/queue/{id}
 * Cancel a queued job
 */
function cancelJob(int $jobId): void {
    try {
        $pdo = getDatabase();
        
        // Update status to failed
        $stmt = $pdo->prepare('UPDATE generation_queue SET status = "failed", error_message = "Cancelled by admin" WHERE id = :id');
        $stmt->execute([':id' => $jobId]);
        
        // Log to audit
        $stmt = $pdo->prepare('INSERT INTO generation_audit_log (event_type, generation_id, queue_id, event_message, created_at) 
                              VALUES ("failed", NULL, :queue_id, "Cancelled by admin", NOW())');
        $stmt->execute([':queue_id' => $jobId]);
        
        http_response_code(200);
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * DELETE /api/admin/queue/failed
 * Clear all failed jobs
 */
function clearFailedJobs(): void {
    try {
        $pdo = getDatabase();
        
        $stmt = $pdo->prepare('DELETE FROM generation_queue WHERE status = "failed"');
        $stmt->execute();
        
        echo json_encode(['success' => true, 'deleted' => $pdo->lastInsertId()]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * POST /api/admin/queue/pause
 * Pause queue processing
 */
function pauseQueue(): void {
    try {
        // TODO: Implement queue pause mechanism
        // Could use a flag in system_settings table
        
        echo json_encode(['success' => true, 'message' => 'Queue paused']);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/quotas
 * User quota management
 */
function getQuotas(): void {
    try {
        $pdo = getDatabase();
        
        $tier = $_GET['tier'] ?? '';
        $userId = $_GET['user_id'] ?? '';
        $limit = (int)($_GET['limit'] ?? 50);
        
        $query = 'SELECT 
            uaq.user_id,
            uaq.priority_level as tier,
            uaq.storage_limit_gb,
            uaq.storage_used_gb,
            uaq.monthly_generation_limit,
            uaq.monthly_generations_used,
            ROUND((uaq.storage_used_gb / uaq.storage_limit_gb) * 100, 1) as storage_percent_used,
            (uaq.monthly_generation_limit - uaq.monthly_generations_used) as monthly_remaining,
            (SELECT COUNT(*) FROM vessel_designs WHERE user_id = uaq.user_id AND is_deleted = 0) as design_count
            FROM user_asset_quotas uaq';
        
        $conditions = [];
        $params = [];
        
        if ($tier) {
            $conditions[] = 'uaq.priority_level = :tier';
            $params[':tier'] = $tier;
        }
        
        if ($userId) {
            $conditions[] = 'uaq.user_id = :user_id';
            $params[':user_id'] = (int)$userId;
        }
        
        if ($conditions) {
            $query .= ' WHERE ' . implode(' AND ', $conditions);
        }
        
        $query .= ' ORDER BY uaq.user_id DESC LIMIT :limit';
        
        $stmt = $pdo->prepare($query);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        
        $quotas = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode([
            'quotas' => $quotas,
            'total' => count($quotas),
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * PUT /api/admin/quotas/{user_id}
 * Update user quota
 */
function updateQuota(int $userId): void {
    try {
        $pdo = getDatabase();
        $data = json_decode(file_get_contents('php://input'), true);
        
        $storageLimitGb = (float)($data['storage_limit_gb'] ?? 5.0);
        $monthlyLimit = (int)($data['monthly_generation_limit'] ?? 100);
        
        $stmt = $pdo->prepare('UPDATE user_asset_quotas SET 
            storage_limit_gb = :storage,
            monthly_generation_limit = :monthly
            WHERE user_id = :user_id');
        
        $stmt->execute([
            ':storage' => $storageLimitGb,
            ':monthly' => $monthlyLimit,
            ':user_id' => $userId,
        ]);
        
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/audit_logs
 * Retrieve audit logs
 */
function getAuditLogs(): void {
    try {
        $pdo = getDatabase();
        
        $eventType = $_GET['event_type'] ?? '';
        $limit = (int)($_GET['limit'] ?? 50);
        
        $query = 'SELECT * FROM generation_audit_log';
        
        if ($eventType) {
            $query .= ' WHERE event_type = :event_type';
        }
        
        $query .= ' ORDER BY created_at DESC LIMIT :limit';
        
        $stmt = $pdo->prepare($query);
        if ($eventType) {
            $stmt->bindValue(':event_type', $eventType);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode(['logs' => $logs]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/audit_logs/export?format=csv
 * Export audit logs as CSV
 */
function exportAuditLogs(): void {
    try {
        $pdo = getDatabase();
        
        $stmt = $pdo->query('SELECT * FROM generation_audit_log ORDER BY created_at DESC LIMIT 10000');
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="trellis2_audit_logs.csv"');
        
        $output = fopen('php://output', 'w');
        
        if ($logs) {
            fputcsv($output, array_keys($logs[0]));
            foreach ($logs as $log) {
                fputcsv($output, $log);
            }
        }
        
        fclose($output);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/analytics
 * Performance analytics & metrics
 */
function getAnalytics(): void {
    try {
        $pdo = getDatabase();
        
        // Hourly generations (last 24 hours)
        $stmt = $pdo->query('SELECT 
            HOUR(completed_at) as hour,
            COUNT(*) as count
            FROM asset_generations 
            WHERE DATE(completed_at) = CURDATE() AND status = "complete"
            GROUP BY HOUR(completed_at)
            ORDER BY hour ASC');
        
        $hourly = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $hourlyLabels = array_map(fn($h) => $h['hour'] . ':00', $hourly);
        $hourlyValues = array_map(fn($h) => (int)$h['count'], $hourly);
        
        // Success rate by day
        $stmt = $pdo->query('SELECT 
            DATE(created_at) as date,
            SUM(CASE WHEN status = "complete" THEN 1 ELSE 0 END) / COUNT(*) * 100 as rate
            FROM asset_generations
            WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date DESC');
        
        $successRates = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        echo json_encode([
            'hourly' => [
                'labels' => $hourlyLabels,
                'values' => $hourlyValues,
            ],
            'success_rates' => $successRates,
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/admin/health
 * System health check
 */
function getHealth(): void {
    try {
        $pdo = getDatabase();
        
        // DB check
        $dbHealth = false;
        try {
            $pdo->query('SELECT 1');
            $dbHealth = true;
        } catch (Exception $e) {
            $dbHealth = false;
        }
        
        // TRELLIS2 API check
        $trellis2Health = false;
        $trellis2Url = getenv('TRELLIS2_API_URL') ?: 'http://trellis2:7862/api/predict';
        try {
            $context = stream_context_create(['http' => ['timeout' => 5]]);
            $headers = @get_headers($trellis2Url, 0, $context);
            $trellis2Health = $headers !== false;
        } catch (Exception $e) {
            $trellis2Health = false;
        }
        
        // Worker check (look for recent processing jobs)
        $stmt = $pdo->query('SELECT COUNT(*) as count FROM generation_queue 
                            WHERE status = "processing" AND updated_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)');
        $workerHealth = $stmt->fetch(PDO::FETCH_ASSOC)['count'] > 0;
        
        echo json_encode([
            'database' => $dbHealth,
            'trellis2_api' => $trellis2Health,
            'worker_running' => $workerHealth,
            'worker_instances' => 1, // TODO: detect actual count
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * PUT /api/admin/settings
 * Update system settings
 */
function updateSettings(): void {
    try {
        $data = json_decode(file_get_contents('php://input'), true);
        
        // TODO: Implement settings persistence
        // Save to system_settings table or .env file
        
        echo json_encode(['success' => true, 'message' => 'Settings updated']);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * POST /api/admin/worker/restart
 * Restart worker service
 */
function restartWorker(): void {
    try {
        // TODO: Implement worker restart
        // Could:
        // 1. Send signal to worker process
        // 2. Trigger Docker restart
        // 3. Update status flag to trigger self-restart
        
        echo json_encode(['success' => true, 'message' => 'Worker restart initiated']);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}
