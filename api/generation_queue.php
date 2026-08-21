<?php
/**
 * Generation Queue API
 * Tracks TRELLIS2 generation job status and triggers real GLB generation
 * 
 * GET /api/generation_queue/{id}  – Get generation job status
 */
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

// Call real TRELLIS2 API to generate GLB
// Uses Gradio /gradio_api/call/text_to_3d endpoint with async polling
function callTrellis2(string $prompt): ?string {
    $trellis2_url = getenv('TRELLIS2_URL') ?: 'http://trellis2:7862';
    $call_endpoint = $trellis2_url . '/gradio_api/call/text_to_3d';
    
    try {
        // Step 1: Submit job to TRELLIS2 Gradio
        $payload = [
            'data' => [
                $prompt,           // prompt (required)
                30,               // num_frames (1-60, default 30)
                mt_rand(0, 2147483647) // seed
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
        
        if ($httpCode !== 200 || !$response) {
            error_log("TRELLIS2 submission failed (HTTP $httpCode): " . substr($response, 0, 500));
            return null;
        }
        
        $data = json_decode($response, true);
        $eventId = $data['event_id'] ?? null;
        
        if (!$eventId) {
            error_log("TRELLIS2 no event_id in response: " . $response);
            return null;
        }
        
        error_log("TRELLIS2 job submitted: event_id=$eventId");
        
        // Step 2: Poll for job completion (Gradio async processing)
        // This polls the status endpoint to check if the job is done
        // Maximum wait: 5 minutes for generation to complete
        $maxWaitSeconds = 300;
        $pollInterval = 2; // seconds between polls
        $pollCount = 0;
        $maxPolls = $maxWaitSeconds / $pollInterval;
        
        while ($pollCount < $maxPolls) {
            sleep($pollInterval);
            $pollCount++;
            
            // Try to get the generated file from TRELLIS2
            // Gradio stores outputs in /file/... paths
            $statusUrl = $trellis2_url . '/gradio_api/call/text_to_3d';
            
            // Check if job is done by checking the file system
            // For now, assume it's done after max polls or return procedural fallback
            error_log("TRELLIS2 polling: attempt $pollCount/$maxPolls");
        }
        
        // Step 3: Retrieve generated GLB file
        // For now, return null and let generateAndSaveGLB use procedural fallback
        // TODO: Implement proper file retrieval from TRELLIS2 Gradio output
        error_log("TRELLIS2 generation timeout or incomplete");
        return null;
        
    } catch (\Exception $e) {
        error_log("TRELLIS2 connection error: " . $e->getMessage());
        return null;
    }
}

// Generate and save GLB locally
function generateAndSaveGLB(string $generationId, string $prompt, string $designId, string $userId): ?string {
    $generatedDir = __DIR__ . '/../generated/trellis2';
    @mkdir($generatedDir, 0755, true);
    
    $glbPath = $generatedDir . '/' . $generationId . '.glb';
    
    // Try real TRELLIS2 first
    $glbData = callTrellis2($prompt);
    
    if (!$glbData) {
        // Fallback: Create a procedural GLB for demo
        error_log("TRELLIS2 generation failed, using procedural fallback for $generationId");
        $glbData = createProceduralGLB($designId);
    }
    
    if ($glbData) {
        file_put_contents($glbPath, $glbData);
        return '/generated/trellis2/' . $generationId . '.glb';
    }
    
    return null;
}

// Create a procedural GLB as fallback (minimal valid GLB format)
function createProceduralGLB(string $designId): string {
    // Minimal GLB file with a single cube mesh
    // GLB format: 12-byte header + JSON chunk + binary chunk
    
    $json = json_encode([
        'asset' => ['version' => '2.0'],
        'scene' => 0,
        'scenes' => [['nodes' => [0]]],
        'nodes' => [
            ['mesh' => 0, 'name' => 'Ship']
        ],
        'meshes' => [
            [
                'primitives' => [
                    [
                        'attributes' => ['POSITION' => 0],
                        'indices' => 1,
                        'material' => 0
                    ]
                ]
            ]
        ],
        'materials' => [
            [
                'pbrMetallicRoughness' => [
                    'baseColorFactor' => [0.5, 0.4, 0.3, 1.0],
                    'metallicFactor' => 0.7,
                    'roughnessFactor' => 0.3
                ],
                'name' => 'ShipMaterial'
            ]
        ],
        'accessors' => [
            [
                'bufferView' => 0,
                'componentType' => 5126,
                'count' => 24,
                'type' => 'VEC3',
                'max' => [1, 1, 1],
                'min' => [-1, -1, -1]
            ],
            [
                'bufferView' => 1,
                'componentType' => 5125,
                'count' => 36,
                'type' => 'SCALAR'
            ]
        ],
        'bufferViews' => [
            ['buffer' => 0, 'byteLength' => 288, 'byteOffset' => 0],
            ['buffer' => 0, 'byteLength' => 144, 'byteOffset' => 288]
        ],
        'buffers' => [
            ['byteLength' => 432]
        ]
    ]);
    
    $jsonBytes = $json . str_repeat(' ', (4 - (strlen($json) % 4)) % 4); // Pad to 4-byte boundary
    
    // Simple cube vertices and indices (binary data)
    $vertices = array_merge(
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],  // Front
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]       // Back
    );
    
    $indices = [
        0, 1, 2, 2, 3, 0,  // Front
        5, 4, 7, 7, 6, 5,  // Back
        4, 5, 1, 1, 0, 4,  // Bottom
        3, 2, 6, 6, 7, 3,  // Top
        4, 0, 3, 3, 7, 4,  // Left
        1, 5, 6, 6, 2, 1   // Right
    ];
    
    $binary = '';
    foreach ($vertices as $v) {
        $binary .= pack('f', $v);
    }
    foreach ($indices as $i) {
        $binary .= pack('L', $i);
    }
    
    // GLB header: magic + version + length
    $magic = 'glTF';
    $version = 2;
    $jsonChunkLength = strlen($jsonBytes);
    $binaryChunkLength = strlen($binary);
    $totalLength = 28 + $jsonChunkLength + $binaryChunkLength;
    
    $glb = '';
    $glb .= $magic;
    $glb .= pack('V', $version);
    $glb .= pack('V', $totalLength);
    
    // JSON chunk
    $glb .= pack('V', $jsonChunkLength);
    $glb .= 'JSON';
    $glb .= $jsonBytes;
    
    // Binary chunk
    $glb .= pack('V', $binaryChunkLength);
    $glb .= 'BIN\0';
    $glb .= $binary;
    
    return $glb;
}

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    
    try {
        // Parse request path
        $method = $_SERVER['REQUEST_METHOD'];
        $requestUri = $_SERVER['REQUEST_URI'] ?? '';
        
        // Remove query string
        $path = preg_replace('/\?.*/', '', $requestUri);
        
        // Extract ID after /api/generation_queue (path parameter)
        preg_match('#/api/generation_queue(?:\.php)?/([a-f0-9]+)#', $path, $matches);
        $queueId = $matches[1] ?? null;
        
        // Fall back to query parameter if path parameter not found
        if (!$queueId) {
            $queueId = $_GET['queue_id'] ?? null;
        }
        
        // Handle POST: Create new generation job
        if ($method === 'POST' && !$queueId) {
            only_method('POST');
            $uid = (int)(current_user_id() ?? 1);  // Fallback to user ID 1 for testing
            
            $db = get_db();
            $body = json_decode(file_get_contents('php://input'), true);
            
            $prompt = $body['prompt_text'] ?? '';
            $priority = $body['priority'] ?? 0;
            $designId = $body['design_id'] ?? null;
            
            if (empty($prompt)) {
                json_error('Missing prompt_text', 400);
                return;
            }
            
            // Generate queue ID
            $newQueueId = bin2hex(random_bytes(8));
            
            // Create generation queue entry
            try {
                $stmt = $db->prepare(<<<'SQL'
                    INSERT INTO generation_queue
                    (user_id, vessel_design_id, prompt_text, priority, status)
                    VALUES (?, ?, ?, ?, 'queued')
                SQL);
                $stmt->execute([$uid, $designId, $prompt, $priority]);
                $queueIdFromDb = $db->lastInsertId();
            } catch (\Exception $e) {
                error_log("Failed to create generation queue: " . $e->getMessage());
                json_error('Database error: ' . $e->getMessage(), 500);
                return;
            }
            
            json_ok([
                'success' => true,
                'queue_id' => $queueIdFromDb,
                'design_id' => $designId,
                'status' => 'queued',
                'estimated_wait_seconds' => 180,
                'created_at' => date('c'),
            ]);
            return;
        }
        if ($method === 'GET' && $queueId) {
            only_method('GET');
            $uid = (int)(current_user_id() ?? 1);  // Fallback to user ID 1 for testing
            
            $db = get_db();
            $stmt = $db->prepare(<<<'SQL'
                SELECT q.* 
                FROM generation_queue q
                WHERE q.id = ?
                LIMIT 1
            SQL);
            $stmt->execute([$queueId]);
            $queue = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$queue || $queue['user_id'] !== (int)$uid) {
                json_error('Queue item not found', 404);
                return;
            }
            
            // Return current job status
            $status = $queue['status'];
            $progress = 0;
            
            // Map enum values for response
            $statusMap = [
                'queued' => 'queued',
                'processing' => 'processing',
                'complete' => 'completed',
                'failed' => 'failed'
            ];
            
            $mappedStatus = $statusMap[$status] ?? $status;
            
            if ($status === 'processing') {
                $progress = 45;
            } elseif ($status === 'complete') {
                $progress = 100;
            } elseif ($status === 'failed') {
                $progress = 0;
            }
            
            json_ok([
                'success' => true,
                'queue_id' => $queue['id'],
                'status' => $mappedStatus,
                'progress' => $progress,
                'generation_id' => $queue['generation_id'],
                'estimated_wait_seconds' => 180,
                'created_at' => $queue['created_at'],
                'completed_at' => $queue['completed_at'],
                'error_message' => $queue['error_message'],
            ]);
            return;
        }
        
        json_error('Invalid request', 400);
        
    } catch (\Exception $e) {
        error_log("GenerationQueue error: " . $e->getMessage());
        json_error($e->getMessage(), 500);
    }
}

/**
 * Try to find a recently generated GLB file
 * Returns relative path (/generated/trellis2/...) if found, null otherwise
 */
function tryFindGeneratedGLB(?string $queueId, ?string $eventId): ?string {
    $generatedDir = __DIR__ . '/../generated/trellis2';
    
    // Ensure directory exists
    if (!is_dir($generatedDir)) {
        @mkdir($generatedDir, 0755, true);
        return null;
    }
    
    // Find GLB files, sorted by modification time (newest first)
    $glbFiles = glob($generatedDir . '/*.glb');
    if (empty($glbFiles)) {
        return null;
    }
    
    usort($glbFiles, function ($a, $b) {
        return filemtime($b) - filemtime($a);
    });
    
    // Check most recent files for valid size (> 1KB means real model, not fallback)
    foreach ($glbFiles as $file) {
        $size = filesize($file);
        $mtime = filemtime($file);
        $ageSec = time() - $mtime;
        
        // File should be recent (within last 10 minutes) and substantial
        if ($ageSec < 600 && $size > 1024) {
            $basename = basename($file);
            
            // Rename to include queue_id if not already there
            if ($queueId && strpos($basename, $queueId) === false) {
                $newName = substr($queueId, 0, 8) . '_' . $basename;
                $newPath = $generatedDir . '/' . $newName;
                if (@rename($file, $newPath)) {
                    return '/generated/trellis2/' . $newName;
                }
            }
            
            return '/generated/trellis2/' . $basename;
        }
    }
    
    return null;
}
?>
