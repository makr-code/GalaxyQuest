{{php
/**
 * API Dispatcher
 * Routes API requests to appropriate handlers
 */

// Determine the requested API endpoint
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = str_replace('/api/', '', $path);
$parts = explode('/', trim($path, '/'));

// Route: /api/user/quota -> user_quota
// Route: /api/admin/stats -> admin_stats
// Route: /api/vessel_designs -> trellis2_endpoints (TRELLIS2 specific)
// Route: /api/metrics.php -> metrics.php

// Remove .php extension if present
$endpoint = str_replace('.php', '', $parts[0] ?? '');

// Determine handler file
$handlers = [
    'user' => 'api/user_quota.php',
    'admin' => 'api/admin_stats.php',
    'metrics' => 'api/metrics.php',
    'vessel_designs' => 'api/trellis2_endpoints.php',
    'generation_queue' => 'api/trellis2_endpoints.php',
];

// Check if it's a TRELLIS2 request
if (in_array($endpoint, ['vessel_designs', 'generation_queue'])) {
    require_once __DIR__ . '/api/trellis2_endpoints.php';
} elseif ($endpoint === 'user' && isset($parts[1])) {
    // /api/user/quota
    require_once __DIR__ . '/api/user_quota.php';
} elseif ($endpoint === 'admin' && isset($parts[1])) {
    // /api/admin/stats
    require_once __DIR__ . '/api/admin_stats.php';
} elseif ($endpoint === 'metrics') {
    require_once __DIR__ . '/api/metrics.php';
} else {
    // Unknown endpoint
    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Endpoint not found: ' . $path]);
    exit(1);
}
?>
