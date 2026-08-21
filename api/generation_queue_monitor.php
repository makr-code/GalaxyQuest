<?php
/**
 * Generation Queue Monitoring API
 * Returns list of all jobs for monitoring dashboard
 * 
 * GET /api/generation_queue_monitor.php?action=list_all
 * GET /api/generation_queue_monitor.php?action=stats
 * GET /api/generation_queue_monitor.php?action=jobs&mode=text|image|hybrid&status=pending|processing|completed|failed
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    try {
        $action = $_GET['action'] ?? 'list_all';
        $mode = $_GET['mode'] ?? null;
        $status = $_GET['status'] ?? null;
        
        $db = get_db();
        
        switch ($action) {
            case 'list_all':
                listAllJobs($db);
                break;
                
            case 'stats':
                getStats($db);
                break;
                
            case 'jobs':
                getFilteredJobs($db, $mode, $status);
                break;
                
            default:
                json_error('Invalid action', 400);
        }
        
    } catch (\Exception $e) {
        error_log("Generation Queue Monitor error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}

function listAllJobs($db): void {
    $stmt = $db->prepare(<<<'SQL'
        SELECT 
            id,
            prompt_text,
            input_mode,
            status,
            generation_id,
            created_at,
            updated_at,
            CASE 
                WHEN status = 'completed' THEN 100
                WHEN status = 'processing' THEN LEAST(95, 20 + (TIMESTAMPDIFF(SECOND, created_at, NOW()) / 300 * 75))
                WHEN status = 'pending' THEN 5
                ELSE 0
            END as progress
        FROM generation_queue
        ORDER BY created_at DESC
        LIMIT 500
SQL);
    $stmt->execute();
    $jobs = $stmt->fetchAll(\PDO::FETCH_ASSOC);
    
    json_ok([
        'success' => true,
        'total' => count($jobs),
        'jobs' => $jobs
    ]);
}

function getStats($db): void {
    $db->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
    
    // Overall stats
    $overall = $db->query(<<<'SQL'
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM generation_queue
SQL)->fetch();
    
    // By mode
    $byMode = $db->query(<<<'SQL'
        SELECT 
            input_mode,
            COUNT(*) as count
        FROM generation_queue
        GROUP BY input_mode
SQL)->fetchAll();
    
    // Average processing time (for completed jobs)
    $avgTime = $db->query(<<<'SQL'
        SELECT 
            AVG(TIMESTAMPDIFF(SECOND, created_at, updated_at)) as avg_seconds
        FROM generation_queue
        WHERE status = 'completed'
SQL)->fetch();
    
    $stats = [
        'overall' => $overall,
        'by_mode' => array_column($byMode, 'count', 'input_mode'),
        'avg_processing_seconds' => (int)($avgTime['avg_seconds'] ?? 0),
        'timestamp' => date('c')
    ];
    
    json_ok([
        'success' => true,
        'stats' => $stats
    ]);
}

function getFilteredJobs($db, ?string $mode, ?string $status): void {
    $query = 'SELECT id, prompt_text, input_mode, status, generation_id, created_at, updated_at FROM generation_queue WHERE 1=1';
    $params = [];
    
    if ($mode) {
        $query .= ' AND input_mode = ?';
        $params[] = $mode;
    }
    
    if ($status) {
        $query .= ' AND status = ?';
        $params[] = $status;
    }
    
    $query .= ' ORDER BY created_at DESC LIMIT 100';
    
    $stmt = $db->prepare($query);
    $stmt->execute($params);
    $jobs = $stmt->fetchAll(\PDO::FETCH_ASSOC);
    
    json_ok([
        'success' => true,
        'total' => count($jobs),
        'filter' => ['mode' => $mode, 'status' => $status],
        'jobs' => $jobs
    ]);
}
