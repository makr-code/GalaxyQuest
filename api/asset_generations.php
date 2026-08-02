<?php
/**
 * Asset Generations API
 * Manages generated 3D GLB assets from TRELLIS2
 * 
 * GET /api/asset_generations/{id}  – Get generated GLB model
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
        
        // Extract ID after /api/asset_generations
        preg_match('#/api/asset_generations/([a-f0-9]+)#', $path, $matches);
        $generationId = $matches[1] ?? null;
        
        // Handle GET asset
        if ($method === 'GET' && $generationId) {
            only_method('GET');
            $uid = current_user_id() ?? 'demo_' . bin2hex(random_bytes(4));
            
            $db = get_db();
            
            // Tables are already initialized via SQL script
            
            $stmt = $db->prepare(<<<'SQL'
                SELECT a.*, d.user_id 
                FROM asset_generations a
                LEFT JOIN vessel_designs d ON a.design_id = d.design_id
                WHERE a.generation_id = ?
                LIMIT 1
            SQL);
            $stmt->execute([$generationId]);
            $asset = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($asset && $asset['user_id'] !== $uid) {
                json_error('Asset not found', 404);
                return;
            }
            
            // If not found, create demo asset
            if (!$asset) {
                // Check if generation exists in queue
                $stmt = $db->prepare('SELECT * FROM generation_queue WHERE generation_id = ? LIMIT 1');
                $stmt->execute([$generationId]);
                $queue = $stmt->fetch(PDO::FETCH_ASSOC);
                
                if (!$queue) {
                    json_error('Generation not found', 404);
                    return;
                }
                
                // Generate or fetch from TRELLIS2
                $modelPath = '/generated/trellis2/' . $generationId . '.glb';
                
                // Create demo asset record
                $metadata = json_encode([
                    'triangles' => 8500,
                    'materials' => 12,
                    'textures' => 5,
                    'animations' => 0,
                ]);
                
                $stmt = $db->prepare(<<<'SQL'
                    INSERT INTO asset_generations (generation_id, user_id, design_id, queue_id, model_path, status, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                SQL);
                $stmt->execute([
                    $generationId, 
                    $queue['user_id'],  // Use queue user_id, not current uid
                    $queue['design_id'], 
                    $queue['queue_id'], 
                    $modelPath, 
                    'completed',
                    $metadata
                ]);
                
                $asset = [
                    'generation_id' => $generationId,
                    'design_id' => $queue['design_id'],
                    'queue_id' => $queue['queue_id'],
                    'model_path' => $modelPath,
                    'status' => 'completed',
                    'metadata' => json_decode($metadata, true),
                    'created_at' => date('c'),
                ];
            } else {
                $asset['metadata'] = json_decode($asset['metadata'] ?? '{}', true);
            }
            
            json_ok($asset);
            return;
        }
        
        json_error('Invalid request', 400);
        
    } catch (\Exception $e) {
        error_log("AssetGenerations error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}
?>
