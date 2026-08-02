<?php
/**
 * Generation Queue API
 * Tracks TRELLIS2 generation job status
 * 
 * GET /api/generation_queue/{id}  – Get generation job status
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    
    try {
        // Parse request path
        $method = $_SERVER['REQUEST_METHOD'];
        $requestUri = $_SERVER['REQUEST_URI'] ?? '';
        
        // Remove query string
        $path = preg_replace('/\?.*/', '', $requestUri);
        
        // Extract ID after /api/generation_queue
        preg_match('#/api/generation_queue/([a-f0-9]+)#', $path, $matches);
        $queueId = $matches[1] ?? null;
        
        // Handle GET queue status
        if ($method === 'GET' && $queueId) {
            only_method('GET');
            $uid = current_user_id() ?? 'demo_' . bin2hex(random_bytes(4));
            
            $db = get_db();
            $stmt = $db->prepare(<<<'SQL'
                SELECT q.*, d.user_id 
                FROM generation_queue q
                LEFT JOIN vessel_designs d ON q.design_id = d.design_id
                WHERE q.queue_id = ?
                LIMIT 1
            SQL);
            $stmt->execute([$queueId]);
            $queue = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$queue || $queue['user_id'] !== $uid) {
                json_error('Queue item not found', 404);
                return;
            }
            
            // Simulate job progression
            $createdTime = strtotime($queue['created_at']);
            $elapsed = time() - $createdTime;
            
            $status = $queue['status'];
            $progress = 0;
            
            if ($status === 'pending') {
                if ($elapsed > 2) {
                    $status = 'processing';
                    $progress = 30;
                }
            } elseif ($status === 'processing') {
                if ($elapsed > 5) {
                    $status = 'completed';
                    $progress = 100;
                } else {
                    $progress = min(90, 30 + (($elapsed - 2) / 3) * 60);
                }
            } elseif ($status === 'completed') {
                $progress = 100;
            }
            
            // Update status if changed
            if ($status !== $queue['status']) {
                $stmt = $db->prepare('UPDATE generation_queue SET status = ?, updated_at = NOW() WHERE queue_id = ?');
                $stmt->execute([$status, $queueId]);
            }
            
            json_ok([
                'queue_id' => $queueId,
                'design_id' => $queue['design_id'],
                'generation_id' => $queue['generation_id'],
                'status' => $status,
                'progress' => $progress,
                'created_at' => $queue['created_at'],
                'updated_at' => $queue['updated_at'],
            ]);
            return;
        }
        
        json_error('Invalid request', 400);
        
    } catch (\Exception $e) {
        error_log("GenerationQueue error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}
?>
