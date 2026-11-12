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
    echo json_encode(['error' => 'Internal server error']);
    exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

$root_dir = dirname(__DIR__);
require_once $root_dir . '/api/helpers.php';

$user_id = require_auth();
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'DELETE'], true)) {
    verify_csrf();
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
function handleSaveWireframeDesign(\PDO $db, int $user_id): void
{
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
        // Prepare geometry data
        $geometry_data = json_encode([
            'vertices' => $body['vertices'] ?? [],
            'edges' => $body['edges'] ?? [],
            'faces' => $body['faces'] ?? [],
            'components' => $body['components'] ?? []
        ]);
        
        if (!empty($body['design_id'])) {
            $design_id = $body['design_id'];
            $stmt = $db->prepare(<<<'SQL'
                UPDATE vessel_designs
                SET design_name = ?, description = ?, geometry_data = ?, updated_at = NOW()
                WHERE design_id = ? AND user_id = ?
            SQL);
            $stmt->execute([$body['name'], $body['description'] ?? '', $geometry_data, $design_id, $user_id]);
            if ($stmt->rowCount() === 0) {
                $check = $db->prepare('SELECT 1 FROM vessel_designs WHERE design_id = ? AND user_id = ?');
                $check->execute([$design_id, $user_id]);
                if (!$check->fetchColumn()) {
                    http_response_code(404);
                    echo json_encode(['error' => 'Design not found']);
                    return;
                }
            }
        } else {
            $design_id = 'wd_' . bin2hex(random_bytes(6));
            $stmt = $db->prepare(<<<'SQL'
                INSERT INTO vessel_designs
                (design_id, user_id, design_name, description, geometry_data, wireframe_source, customizations)
                VALUES (?, ?, ?, ?, ?, 'manual', '{}')
            SQL);
            $stmt->execute([$design_id, $user_id, $body['name'], $body['description'] ?? '', $geometry_data]);
        }
        
        http_response_code(201);
        echo json_encode([
            'id' => $design_id,
            'name' => $body['name'],
            'vertex_count' => count($body['vertices'] ?? []),
            'edge_count' => count($body['edges'] ?? []),
            'face_count' => count($body['faces'] ?? []),
            'created_at' => date('c')
        ]);
        
    } catch (Throwable $e) {
        error_log('[WIREFRAME_API] Save failed: ' . $e->getMessage());
        http_response_code(503);
        echo json_encode(['error' => 'Unable to save wireframe design']);
    }
}

/**
 * GET /api/wireframe_designs/{id}
 * Load wireframe design geometry
 */
function handleLoadWireframeDesign(\PDO $db, int $user_id, string $design_id): void
{
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
            return;
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
        
    } catch (Throwable $e) {
        error_log('[WIREFRAME_API] Load failed: ' . $e->getMessage());
        http_response_code(503);
        echo json_encode(['error' => 'Unable to load wireframe design']);
    }
}

/**
 * DELETE /api/wireframe_designs/{id}
 * Delete a wireframe design
 */
function handleDeleteWireframeDesign(\PDO $db, int $user_id, string $design_id): void
{
    try {
        $stmt = $db->prepare('DELETE FROM vessel_designs WHERE design_id = ? AND user_id = ?');
        $stmt->execute([$design_id, $user_id]);
        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['error' => 'Design not found']);
            return;
        }
        
        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Design deleted']);
        
    } catch (Throwable $e) {
        error_log('[WIREFRAME_API] Delete failed: ' . $e->getMessage());
        http_response_code(503);
        echo json_encode(['error' => 'Unable to delete wireframe design']);
    }
}
