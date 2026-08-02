<?php
/**
 * Vessel Designs API
 * Manages ship design storage and generation queue
 * 
 * POST   /api/vessel_designs                    – Create new design
 * POST   /api/vessel_designs/{id}/generate      – Queue generation
 * GET    /api/vessel_designs/{id}               – Get design details
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

// ────────────────────────────────────────────────────────────────────────────

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    
    try {
        // Parse request path
        $method = $_SERVER['REQUEST_METHOD'];
        $requestUri = $_SERVER['REQUEST_URI'] ?? '';
        
        // Remove query string
        $path = preg_replace('/\?.*/', '', $requestUri);
        
        // Extract parts after /api/vessel_designs
        preg_match('#/api/vessel_designs(?:/([a-f0-9]+))?(?:/([a-z_]+))?#', $path, $matches);
        $designId = $matches[1] ?? null;
        $action = $matches[2] ?? null;
        
        // Handle CREATE new design: POST /api/vessel_designs
        if ($method === 'POST' && !$designId && !$action) {
            only_method('POST');
            $uid = current_user_id() ?? 'demo_' . bin2hex(random_bytes(4));
            
            $db = get_db();
            $body = json_decode(file_get_contents('php://input'), true);
            
            // Tables are already initialized via SQL script
            // No CREATE TABLE needed here
            
            $newDesignId = bin2hex(random_bytes(8));
            $speciesCode = $body['species_code'] ?? '';
            $designName = $body['design_name'] ?? 'Untitled Design';
            $customizations = json_encode($body['customizations'] ?? []);
            $description = $body['description'] ?? '';
            
            $stmt = $db->prepare(<<<'SQL'
                INSERT INTO vessel_designs (design_id, user_id, faction_code, design_name, customizations, description)
                VALUES (?, ?, ?, ?, ?, ?)
            SQL);
            $stmt->execute([$newDesignId, $uid, $speciesCode, $designName, $customizations, $description]);
            
            json_ok([
                'id' => $newDesignId,
                'design_name' => $designName,
                'created_at' => date('c'),
            ]);
            return;
        }
        
        // Handle QUEUE generation: POST /api/vessel_designs/{id}/generate
        if ($method === 'POST' && $designId && $action === 'generate') {
            only_method('POST');
            $uid = current_user_id() ?? 'demo_' . bin2hex(random_bytes(4));
            
            $db = get_db();
            $body = json_decode(file_get_contents('php://input'), true);
            
            // Tables are already initialized via SQL script
            
            $queueId = bin2hex(random_bytes(8));
            $promptText = $body['prompt_text'] ?? '';
            $priority = (int)($body['priority'] ?? 0);
            
            $stmt = $db->prepare(<<<'SQL'
                INSERT INTO generation_queue (queue_id, design_id, user_id, prompt_text, status, priority)
                VALUES (?, ?, ?, ?, 'pending', ?)
            SQL);
            $stmt->execute([$queueId, $designId, $uid, $promptText, $priority]);
            
            // For demo: immediately assign generation ID
            $generationId = bin2hex(random_bytes(8));
            $stmt = $db->prepare('UPDATE generation_queue SET status = ?, generation_id = ? WHERE queue_id = ?');
            $stmt->execute(['processing', $generationId, $queueId]);
            
            json_ok([
                'queue_id' => $queueId,
                'generation_id' => $generationId,
                'status' => 'queued',
            ]);
            return;
        }
        
        // Handle GET design: GET /api/vessel_designs/{id}
        if ($method === 'GET' && $designId && !$action) {
            only_method('GET');
            $uid = current_user_id() ?? 'demo_' . bin2hex(random_bytes(4));
            
            $db = get_db();
            $stmt = $db->prepare(<<<'SQL'
                SELECT * FROM vessel_designs 
                WHERE design_id = ? AND user_id = ? 
                LIMIT 1
            SQL);
            $stmt->execute([$designId, $uid]);
            $design = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$design) {
                json_error('Design not found', 404);
                return;
            }
            
            $design['customizations'] = json_decode($design['customizations'] ?? '{}', true);
            json_ok($design);
            return;
        }
        
        json_error('Invalid request', 400);
        
    } catch (\Exception $e) {
        error_log("VesselDesigns error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}
?>
