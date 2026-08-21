<?php
/**
 * Generation Queue API v2
 * Supports three generation modes:
 * 1. text: Text → 3D
 * 2. image: Image → 3D  
 * 3. hybrid: Image → Base 3D, then refine with text prompt
 * 
 * GET /api/generation_queue_v2?queue_id=...   – Get job status
 * POST /api/generation_queue_v2                 – Create new job
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/**
 * Call TRELLIS2 Text→3D endpoint
 */
function callTrellis2Text(string $prompt): ?string {
    $trellis2_url = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';
    $call_endpoint = $trellis2_url . '/gradio_api/call/text_to_3d';
    
    try {
        $payload = [
            'data' => [
                $prompt,
                30,
                mt_rand(0, 2147483647)
            ]
        ];
        
        $ch = curl_init($call_endpoint);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode !== 200) {
            error_log("TRELLIS2 text_to_3d failed (HTTP $httpCode)");
            return null;
        }
        
        $data = json_decode($response, true);
        $eventId = $data['event_id'] ?? null;
        
        if (!$eventId) {
            error_log("TRELLIS2 no event_id in text_to_3d response");
            return null;
        }
        
        return $eventId;
    } catch (\Exception $e) {
        error_log("callTrellis2Text error: " . $e->getMessage());
        return null;
    }
}

/**
 * Call TRELLIS2 Image→3D endpoint
 */
function callTrellis2Image(string $imageBase64): ?string {
    $trellis2_url = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';
    $call_endpoint = $trellis2_url . '/gradio_api/call/image_to_3d';
    
    try {
        // Save image to temporary file
        $tmpFile = '/tmp/trellis2_image_' . bin2hex(random_bytes(8)) . '.png';
        $imageData = base64_decode($imageBase64);
        file_put_contents($tmpFile, $imageData);
        
        // Send file to TRELLIS2
        $payload = [
            'data' => [
                [
                    'name' => basename($tmpFile),
                    'data' => $imageBase64  // Send as data URI
                ],
                30,
                mt_rand(0, 2147483647)
            ]
        ];
        
        $ch = curl_init($call_endpoint);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        @unlink($tmpFile);  // Clean up temp file
        
        if ($httpCode !== 200) {
            error_log("TRELLIS2 image_to_3d failed (HTTP $httpCode)");
            return null;
        }
        
        $data = json_decode($response, true);
        $eventId = $data['event_id'] ?? null;
        
        if (!$eventId) {
            error_log("TRELLIS2 no event_id in image_to_3d response");
            return null;
        }
        
        return $eventId;
    } catch (\Exception $e) {
        error_log("callTrellis2Image error: " . $e->getMessage());
        return null;
    }
}

/**
 * Try to find a recently generated GLB file
 */
function tryFindGeneratedGLB(?string $queueId, ?string $eventId): ?string {
    if (!$eventId) return null;
    
    $glbDir = '/var/www/html/generated/trellis2';
    if (!is_dir($glbDir)) return null;
    
    $files = scandir($glbDir, SCANDIR_SORT_DESCENDING);
    if (!$files) return null;
    
    $cutoff = time() - 600;  // Last 10 minutes
    
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        if (!str_ends_with($file, '.glb')) continue;
        
        $filePath = $glbDir . '/' . $file;
        $filesize = @filesize($filePath);
        $mtime = @filemtime($filePath);
        
        if ($filesize > 1000 && $mtime > $cutoff) {
            return '/generated/trellis2/' . $file;
        }
    }
    
    return null;
}

/**
 * Create a minimal procedural GLB (fallback)
 */
function createProceduralGLB(): string {
    $json = json_encode([
        'asset' => ['version' => '2.0', 'generator' => 'GalaxyQuest'],
        'scene' => 0,
        'scenes' => [['nodes' => [0]]],
        'nodes' => [['mesh' => 0]],
        'meshes' => [['primitives' => [['attributes' => ['POSITION' => 0], 'indices' => 1]]]],
        'accessors' => [
            ['bufferView' => 0, 'componentType' => 5126, 'count' => 24, 'type' => 'VEC3'],
            ['bufferView' => 1, 'componentType' => 5125, 'count' => 36, 'type' => 'SCALAR']
        ],
        'bufferViews' => [
            ['buffer' => 0, 'byteOffset' => 0, 'byteStride' => 12],
            ['buffer' => 0, 'byteOffset' => 288]
        ],
        'buffers' => [['byteLength' => 432]]
    ]);
    
    $jsonBytes = json_encode($json, JSON_UNESCAPED_SLASHES);
    
    $vertices = [
        -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
        -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1
    ];
    $indices = [0, 1, 2, 2, 3, 0, 4, 6, 5, 6, 7, 5];
    
    $binary = '';
    foreach ($vertices as $v) {
        $binary .= pack('f', (float)$v);
    }
    foreach ($indices as $i) {
        $binary .= pack('L', (int)$i);
    }
    
    $magic = 'glTF';
    $version = 2;
    $jsonChunkLength = strlen($jsonBytes);
    $binaryChunkLength = strlen($binary);
    $totalLength = 28 + $jsonChunkLength + $binaryChunkLength;
    
    $glb = '';
    $glb .= $magic;
    $glb .= pack('V', $version);
    $glb .= pack('V', $totalLength);
    $glb .= pack('V', $jsonChunkLength);
    $glb .= 'JSON';
    $glb .= $jsonBytes;
    $glb .= pack('V', $binaryChunkLength);
    $glb .= 'BIN\0';
    $glb .= $binary;
    
    return $glb;
}

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    try {
        $method = $_SERVER['REQUEST_METHOD'];
        $queueId = $_GET['queue_id'] ?? $_POST['queue_id'] ?? null;
        
        // POST: Create new generation job
        if ($method === 'POST') {
            $uid = (int)(current_user_id() ?? 1);
            $db = get_db();
            $body = json_decode(file_get_contents('php://input'), true);
            
            $inputMode = $body['input_mode'] ?? 'text';
            $priority = (int)($body['priority'] ?? 0);
            $designId = $body['design_id'] ?? null;
            
            // Validate mode and collect inputs
            if ($inputMode === 'text') {
                $promptText = $body['prompt_text'] ?? '';
                if (empty($promptText)) {
                    json_error('Missing prompt_text for text mode', 400);
                    return;
                }
                $imageBase64 = null;
                $imageDescription = null;
            } elseif ($inputMode === 'image') {
                $imageBase64 = $body['image_base64'] ?? null;
                if (empty($imageBase64)) {
                    json_error('Missing image_base64 for image mode', 400);
                    return;
                }
                $promptText = 'Generate a 3D model from the provided image';
                $imageDescription = $body['image_description'] ?? null;
            } elseif ($inputMode === 'hybrid') {
                $imageBase64 = $body['image_base64'] ?? null;
                $refinementPrompt = $body['refinement_prompt'] ?? '';
                if (empty($imageBase64) || empty($refinementPrompt)) {
                    json_error('Missing image_base64 or refinement_prompt for hybrid mode', 400);
                    return;
                }
                $promptText = '[HYBRID] Base from image, then: ' . $refinementPrompt;
                $imageDescription = $body['image_description'] ?? null;
            } else {
                json_error("Invalid input_mode: $inputMode", 400);
                return;
            }
            
            // Insert into database
            try {
                $stmt = $db->prepare(<<<'SQL'
                    INSERT INTO generation_queue
                    (user_id, vessel_design_id, prompt_text, input_mode, input_image_base64, image_description, priority, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
SQL);
                $stmt->execute([
                    $uid,
                    $designId,
                    $promptText,
                    $inputMode,
                    $imageBase64,
                    $imageDescription,
                    $priority
                ]);
                
                $newQueueId = $db->lastInsertId();
                
                json_ok([
                    'success' => true,
                    'queue_id' => $newQueueId,
                    'input_mode' => $inputMode,
                    'status' => 'pending',
                    'estimated_wait_seconds' => 300,
                ]);
            } catch (\Exception $e) {
                error_log("DB insert failed: " . $e->getMessage());
                json_error('Database error: ' . $e->getMessage(), 500);
            }
            return;
        }
        
        // GET: Get job status
        if ($method === 'GET' && $queueId) {
            $uid = (int)(current_user_id() ?? 1);
            $db = get_db();
            
            $stmt = $db->prepare('SELECT * FROM generation_queue WHERE id = ? LIMIT 1');
            $stmt->execute([$queueId]);
            $queue = $stmt->fetch(\PDO::FETCH_ASSOC);
            
            if (!$queue) {
                json_error('Queue item not found', 404);
                return;
            }
            
            $status = $queue['status'];
            $progress = 0;
            $metadata = json_decode($queue['metadata'] ?? '{}', true);
            $eventId = $metadata['trellis2_event_id'] ?? null;
            
            // Check if processing job has completed
            if ($status === 'processing' && $eventId) {
                $glbPath = tryFindGeneratedGLB($queueId, $eventId);
                if ($glbPath) {
                    // Mark as completed
                    $generationId = $queue['generation_id'] ?? bin2hex(random_bytes(8));
                    
                    $stmt = $db->prepare(<<<'SQL'
                        UPDATE generation_queue 
                        SET status = 'completed', generation_id = ?, updated_at = NOW()
                        WHERE id = ?
SQL);
                    $stmt->execute([$generationId, $queueId]);
                    
                    $status = 'completed';
                    $progress = 100;
                }
            }
            
            // Calculate progress for processing jobs
            if ($status === 'processing') {
                $createdAt = strtotime($queue['created_at']);
                $elapsed = time() - $createdAt;
                $progress = min(95, 20 + ($elapsed / 300) * 75);
            }
            
            json_ok([
                'success' => true,
                'queue_id' => $queueId,
                'status' => $status,
                'progress' => (int)$progress,
                'input_mode' => $queue['input_mode'] ?? 'text',
                'generation_id' => $queue['generation_id'] ?? null,
                'created_at' => $queue['created_at'],
                'updated_at' => $queue['updated_at'],
            ]);
            return;
        }
        
        json_error('Invalid request', 400);
        
    } catch (\Exception $e) {
        error_log("GenerationQueue v2 error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}
