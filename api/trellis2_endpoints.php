<?php
declare(strict_types=1);

/**
 * TRELLIS2 Asset Management API Endpoints
 * RESTful API for design creation, generation queueing, and status polling
 * 
 * Endpoints:
 *   POST   /api/vessel_designs              – Create design
 *   GET    /api/vessel_designs/{id}         – Get design + metadata
 *   POST   /api/vessel_designs/{id}/generate – Queue generation
 *   GET    /api/generation_queue/{id}       – Poll queue status
 *   GET    /api/asset_generations/{id}      – Get completed generation
 *   GET    /api/user/quota                  – Get user quota
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Error handling
set_error_handler(function ($errno, $errstr) {
    error_log("[API_ERROR] $errstr");
    http_response_code(500);
    echo json_encode(['error' => 'Internal server error', 'code' => $errno]);
    exit(1);
});

set_exception_handler(function (Throwable $e) {
    error_log("[API_EXCEPTION] " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
    exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

$root_dir = dirname(__DIR__);
require_once $root_dir . '/api/trellis2_asset_manager.php';

// Get current user (from session or auth header)
$user_id = getCurrentUserId();
if (!$user_id) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit(1);
}

// Database connection
try {
    $pdo = getDatabase();
} catch (Exception $e) {
    http_response_code(503);
    echo json_encode(['error' => 'Database unavailable']);
    exit(1);
}

$manager = new TRELLIS2AssetManager($pdo);

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = str_replace('/api/', '', $path);

// Route matching
if ($method === 'POST' && $path === 'vessel_designs') {
    handleCreateDesign($manager, $user_id);
} elseif ($method === 'GET' && preg_match('#^vessel_designs/(\d+)$#', $path, $m)) {
    handleGetDesign($manager, $user_id, (int)$m[1]);
} elseif ($method === 'POST' && preg_match('#^vessel_designs/(\d+)/generate$#', $path, $m)) {
    handleQueueGeneration($manager, $user_id, (int)$m[1]);
} elseif ($method === 'GET' && preg_match('#^generation_queue/(\d+)$#', $path, $m)) {
    handleGetQueueStatus($manager, $user_id, (int)$m[1]);
} elseif ($method === 'GET' && preg_match('#^asset_generations/(\d+)$#', $path, $m)) {
    handleGetGeneration($manager, $user_id, (int)$m[1]);
} elseif ($method === 'GET' && $path === 'user/quota') {
    handleGetQuota($manager, $user_id);
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Not found']);
    exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/vessel_designs
 * Create a new vessel design
 * 
 * Body:
 *   species_code (string): 'vortak', 'sylnar', 'aereth', etc.
 *   design_name (string): User-facing name
 *   customizations (object): {slider_name: value, ...}
 *   description (string, optional): Design description
 * 
 * Response:
 *   id (int): Design ID
 *   design_json_path (string): Path to saved JSON
 *   design_json_hash (string): SHA-256 hash
 */
function handleCreateDesign(TRELLIS2AssetManager $manager, int $user_id): void {
    $body = json_decode(file_get_contents('php://input'), true);
    
    if (!$body || !isset($body['species_code'], $body['design_name'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required fields: species_code, design_name']);
        exit(1);
    }
    
    try {
        $result = $manager->createDesign(
            user_id: $user_id,
            species_code: $body['species_code'],
            customizations: $body['customizations'] ?? [],
            design_name: $body['design_name'],
            description: $body['description'] ?? null
        );
        
        http_response_code(201);
        echo json_encode([
            'id' => $result['id'],
            'design_json_path' => $result['design_json_path'],
            'design_json_hash' => $result['design_json_hash'],
            'created_at' => date('c'),
        ]);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/vessel_designs/{id}
 * Get design details + metadata
 * 
 * Response:
 *   id, species_code, design_name, description
 *   customizations, enhancement_history
 *   latest_generation (if exists)
 *   created_at, updated_at
 */
function handleGetDesign(TRELLIS2AssetManager $manager, int $user_id, int $design_id): void {
    try {
        $design = $manager->getDesign($design_id);
        
        // Verify ownership
        if ((int)$design['user_id'] !== $user_id) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden']);
            exit(1);
        }
        
        http_response_code(200);
        echo json_encode([
            'id' => $design['id'],
            'species_code' => $design['species_code'],
            'design_name' => $design['design_name'],
            'description' => $design['description'],
            'customizations' => json_decode($design['customizations_json'], true) ?? [],
            'enhancement_history' => json_decode($design['enhancement_history_json'], true) ?? [],
            'latest_generation_id' => $design['latest_generation_id'],
            'created_at' => $design['created_at'],
            'updated_at' => $design['updated_at'],
        ]);
        
    } catch (Exception $e) {
        http_response_code(404);
        echo json_encode(['error' => 'Design not found']);
    }
}

/**
 * POST /api/vessel_designs/{id}/generate
 * Queue a generation job (with cache hit detection)
 * 
 * Body:
 *   prompt_text (string): TRELLIS2 prompt (pre-built by frontend)
 *   priority (int, optional): 0 = normal, 1 = high, -1 = low
 * 
 * Response:
 *   queue_id (int): Queue entry ID (for polling)
 *   generation_id (int, optional): If cache hit, already-completed generation
 *   estimated_wait_seconds (int): Estimated time in queue
 *   cache_hit (bool): Whether result was cached
 */
function handleQueueGeneration(TRELLIS2AssetManager $manager, int $user_id, int $design_id): void {
    $body = json_decode(file_get_contents('php://input'), true);
    
    if (!$body || !isset($body['prompt_text'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required field: prompt_text']);
        exit(1);
    }
    
    try {
        // Verify design ownership
        $design = $manager->getDesign($design_id);
        if ((int)$design['user_id'] !== $user_id) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden']);
            exit(1);
        }
        
        $prompt_text = $body['prompt_text'];
        $priority = $body['priority'] ?? 0;
        
        // Queue generation (returns queue_id or generation_id if cache hit)
        $result = $manager->queueGeneration(
            design_id: $design_id,
            prompt_text: $prompt_text,
            priority: $priority
        );
        
        http_response_code(202);
        echo json_encode([
            'queue_id' => $result['queue_id'] ?? null,
            'generation_id' => $result['generation_id'] ?? null,
            'status' => $result['status'] ?? 'queued',
            'cache_hit' => $result['cache_hit'] ?? false,
            'estimated_wait_seconds' => $result['estimated_wait_seconds'] ?? 60,
        ]);
        
    } catch (RuntimeException $e) {
        // Quota exceeded
        http_response_code(429);
        echo json_encode(['error' => $e->getMessage()]);
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/generation_queue/{id}
 * Poll generation queue status
 * 
 * Response:
 *   status: 'queued' | 'processing' | 'complete' | 'failed'
 *   queue_position (int): Position in queue (0 if processing)
 *   estimated_wait_seconds (int): Rough estimate based on queue depth
 *   generation_id (int, optional): Set when complete
 *   error_message (string, optional): If failed
 */
function handleGetQueueStatus(TRELLIS2AssetManager $manager, int $user_id, int $queue_id): void {
    try {
        $status = $manager->getQueueStatus($queue_id);
        
        // Verify ownership
        if ((int)$status['user_id'] !== $user_id) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden']);
            exit(1);
        }
        
        http_response_code(200);
        echo json_encode([
            'queue_id' => $queue_id,
            'status' => $status['status'],
            'queue_position' => $status['queue_position'] ?? 0,
            'total_in_queue' => $status['total_in_queue'] ?? 0,
            'estimated_wait_seconds' => $status['estimated_wait_seconds'] ?? 0,
            'generation_id' => $status['generation_id'] ?? null,
            'error_message' => $status['error_message'] ?? null,
        ]);
        
    } catch (Exception $e) {
        http_response_code(404);
        echo json_encode(['error' => 'Queue entry not found']);
    }
}

/**
 * GET /api/asset_generations/{id}
 * Get completed generation details
 * 
 * Response:
 *   id, generation_uuid, status
 *   glb_path: "generated/trellis2/models/{uuid}/model.glb"
 *   glb_file_size (bytes)
 *   thumbnail_path: "generated/trellis2/models/{uuid}/model.thumbnail.png"
 *   metadata (json): {width_cm, height_cm, triangle_count, ...}
 *   generation_time_ms
 *   created_at, completed_at
 */
function handleGetGeneration(TRELLIS2AssetManager $manager, int $user_id, int $generation_id): void {
    try {
        $generation = $manager->getGenerationStatus($generation_id);
        
        // Verify ownership
        if ((int)$generation['user_id'] !== $user_id) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden']);
            exit(1);
        }
        
        http_response_code(200);
        echo json_encode([
            'id' => $generation['id'],
            'generation_uuid' => $generation['generation_uuid'],
            'status' => $generation['status'],
            'glb_path' => $generation['glb_path'],
            'glb_file_size' => $generation['glb_file_size'],
            'thumbnail_path' => $generation['thumbnail_path'],
            'metadata' => json_decode($generation['metadata_json'], true) ?? [],
            'generation_time_ms' => $generation['generation_time_ms'],
            'created_at' => $generation['created_at'],
            'completed_at' => $generation['completed_at'],
        ]);
        
    } catch (Exception $e) {
        http_response_code(404);
        echo json_encode(['error' => 'Generation not found']);
    }
}

/**
 * GET /api/user/quota
 * Get current user's quota status
 * 
 * Response:
 *   storage_limit_gb, storage_used_gb, storage_remaining_gb, storage_percent_used
 *   monthly_generation_limit, monthly_generations_used, monthly_remaining
 *   priority_level: 'free' | 'supporter' | 'premium' | 'admin'
 *   design_count, generation_count
 */
function handleGetQuota(TRELLIS2AssetManager $manager, int $user_id): void {
    try {
        $quota = $manager->getUserQuota($user_id);
        
        http_response_code(200);
        echo json_encode([
            'storage_limit_gb' => $quota['storage_limit_gb'],
            'storage_used_gb' => $quota['storage_used_gb'],
            'storage_remaining_gb' => max(0, $quota['storage_limit_gb'] - $quota['storage_used_gb']),
            'storage_percent_used' => round(($quota['storage_used_gb'] / $quota['storage_limit_gb']) * 100, 1),
            'monthly_generation_limit' => $quota['monthly_generation_limit'],
            'monthly_generations_used' => $quota['monthly_generations_used'],
            'monthly_remaining' => max(0, $quota['monthly_generation_limit'] - $quota['monthly_generations_used']),
            'priority_level' => $quota['priority_level'],
            'design_count' => $quota['design_count'],
            'generation_count' => $quota['generation_count'],
        ]);
        
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current authenticated user ID
 * Supports: session, JWT, API key (adapt for your auth system)
 */
function getCurrentUserId(): ?int {
    // If user is logged in via session
    if (isset($_SESSION['user_id'])) {
        return (int)$_SESSION['user_id'];
    }
    
    // If using JWT or API key in Authorization header
    $auth_header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('#Bearer\s+(\d+)#i', $auth_header, $m)) {
        return (int)$m[1];
    }
    
    // Fallback: mock user for development
    if (getenv('APP_ENV') === 'development') {
        return 1; // Mock user
    }
    
    return null;
}

/**
 * Get PDO database connection
 */
function getDatabase(): PDO {
    static $pdo = null;
    
    if ($pdo) {
        return $pdo;
    }
    
    $host = getenv('DB_HOST') ?: 'db';
    $port = (int)(getenv('DB_PORT') ?: 3306);
    $name = getenv('DB_NAME') ?: 'galaxyquest';
    $user = getenv('DB_USER') ?: 'root';
    $pass = getenv('DB_PASS') ?: 'root';
    
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $host, $port, $name
        ),
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
    
    return $pdo;
}
