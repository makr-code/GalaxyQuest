<?php
declare(strict_types=1);

/**
 * Wireframe Geometry Editor API Endpoints
 * Stores and manages wireframe geometry (vertices, edges, faces) for ship designs
 * 
 * Endpoints:
 *   POST   /api/wireframe_designs              – Create/save wireframe design
 *   GET    /api/wireframe_designs/{id}         – Load wireframe design
 *   DELETE /api/wireframe_designs/{id}         – Delete wireframe design
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Error handling
set_error_handler(function ($errno, $errstr) {
    error_log("[WIREFRAME_API] $errstr");
    http_response_code(500);
    echo json_encode(['error' => 'Internal server error', 'code' => $errno]);
    exit(1);
});

set_exception_handler(function (Throwable $e) {
    error_log("[WIREFRAME_API_EXCEPTION] " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
    exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

$root_dir = dirname(__DIR__);
require_once $root_dir . '/api/helpers.php';

// Get current user (from session)
$user_id = current_user_id();

// For development/testing: use demo user if no session
if (!$user_id && isset($_SERVER['HTTP_X_DEMO_USER'])) {
    $user_id = $_SERVER['HTTP_X_DEMO_USER'];
} elseif (!$user_id) {
    // Allow unauthenticated in development mode
    $user_id = 'anonymous_' . bin2hex(random_bytes(4));
}

if (!$user_id) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit(1);
}

// Database connection
try {
    $db = get_db();
} catch (Exception $e) {
    http_response_code(503);
    echo json_encode(['error' => 'Database unavailable']);
    exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];
$path = $_SERVER['REQUEST_URI'];

// Extract path after /api/ and remove .php extension if present
$path = preg_replace('#\.php(?:\?.*)?$#', '', $path);

// Extract path after /api/
if (preg_match('#^/api/wireframe_designs(?:/(.+))?$#', $path, $m)) {
    $id = $m[1] ?? null;
} else {
    http_response_code(404);
    echo json_encode(['error' => 'Invalid path: ' . $path]);
    exit(1);
}

// Route matching
if ($method === 'POST' && !$id) {
    handleSaveWireframeDesign($db, $user_id);
} elseif ($method === 'GET' && $id) {
    handleLoadWireframeDesign($db, $user_id, $id);
} elseif ($method === 'DELETE' && $id) {
    handleDeleteWireframeDesign($db, $user_id, $id);
} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/wireframe_designs
 * Save or create a wireframe design with geometry data
 */
function handleSaveWireframeDesign(\PDO $db, string $user_id): void {
    // Try to get JSON body - fallback to $_REQUEST if php://input is empty
    $input = file_get_contents('php://input');
    $body = json_decode($input, true);
    
    // Debug log
    if (!$body) {
        error_log('[WIREFRAME_API] Empty body from php://input, trying $_REQUEST');
        $body = $_REQUEST;
    }
    
    if (!$body || !isset($body['name']) || empty($body['name'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required field: name', 'received_body' => $body]);
        exit(1);
    }

    try {
        // Generate unique design ID
        $design_id = 'wd_' . bin2hex(random_bytes(8));
        
        // Prepare geometry data
        $geometry_data = json_encode([
            'vertices' => $body['vertices'] ?? [],
            'edges' => $body['edges'] ?? [],
            'faces' => $body['faces'] ?? [],
            'components' => $body['components'] ?? []
        ]);
        
        // If updating existing design, use provided ID
        if (!empty($body['design_id'])) {
            $design_id = $body['design_id'];
            
            // Check ownership
            $stmt = $db->prepare('SELECT user_id FROM vessel_designs WHERE design_id = ?');
            $stmt->execute([$design_id]);
            $existing = $stmt->fetch();
            
            if ($existing && $existing['user_id'] !== $user_id) {
                http_response_code(403);
                echo json_encode(['error' => 'Forbidden: Design not owned by user']);
                exit(1);
            }
        }
        
        // Save to vessel_designs table
        $stmt = $db->prepare(<<<'SQL'
            INSERT INTO vessel_designs 
            (design_id, user_id, design_name, description, geometry_data, wireframe_source, customizations)
            VALUES (?, ?, ?, ?, ?, 'manual', '{}')
            ON DUPLICATE KEY UPDATE
                design_name = ?,
                description = ?,
                geometry_data = ?,
                updated_at = NOW()
        SQL);
        
        $stmt->execute([
            $design_id,
            $user_id,
            $body['name'],
            $body['description'] ?? '',
            $geometry_data,
            $body['name'],
            $body['description'] ?? '',
            $geometry_data
        ]);
        
        http_response_code(201);
        echo json_encode([
            'id' => $design_id,
            'name' => $body['name'],
            'vertex_count' => count($body['vertices'] ?? []),
            'edge_count' => count($body['edges'] ?? []),
            'face_count' => count($body['faces'] ?? []),
            'created_at' => date('c')
        ]);
        
    } catch (Exception $e) {
        error_log('[WIREFRAME_API] Save failed: ' . $e->getMessage());
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * GET /api/wireframe_designs/{id}
 * Load wireframe design geometry
 */
function handleLoadWireframeDesign(\PDO $db, string $user_id, string $design_id): void {
    try {
        $stmt = $db->prepare(<<<'SQL'
            SELECT design_id, user_id, design_name, description, geometry_data, created_at, updated_at
            FROM vessel_designs
            WHERE design_id = ? AND user_id = ?
        SQL);
        
        $stmt->execute([$design_id, $user_id]);
        $design = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        if (!$design) {
            http_response_code(404);
            echo json_encode(['error' => 'Design not found']);
            exit(1);
        }
        
        // Parse geometry data
        $geometry = json_decode($design['geometry_data'], true) ?? [
            'vertices' => [],
            'edges' => [],
            'faces' => [],
            'components' => []
        ];
        
        http_response_code(200);
        echo json_encode([
            'id' => $design['design_id'],
            'name' => $design['design_name'],
            'description' => $design['description'],
            'geometry' => $geometry,
            'created_at' => $design['created_at'],
            'updated_at' => $design['updated_at']
        ]);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}

/**
 * DELETE /api/wireframe_designs/{id}
 * Delete a wireframe design
 */
function handleDeleteWireframeDesign(\PDO $db, string $user_id, string $design_id): void {
    try {
        // Check ownership
        $stmt = $db->prepare('SELECT user_id FROM vessel_designs WHERE design_id = ?');
        $stmt->execute([$design_id]);
        $design = $stmt->fetch();
        
        if (!$design) {
            http_response_code(404);
            echo json_encode(['error' => 'Design not found']);
            exit(1);
        }
        
        if ($design['user_id'] !== $user_id) {
            http_response_code(403);
            echo json_encode(['error' => 'Forbidden']);
            exit(1);
        }
        
        // Delete design
        $stmt = $db->prepare('DELETE FROM vessel_designs WHERE design_id = ?');
        $stmt->execute([$design_id]);
        
        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Design deleted']);
        
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
}
