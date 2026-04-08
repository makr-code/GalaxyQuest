<?php
/**
 * 3D Model Descriptor API
 *
 * GET /api/model_gen.php?type=stargate
 *
 * Returns a JSON model descriptor from the models/ directory.
 * Descriptors define Three.js scene-graphs built from geometric primitives
 * which are instantiated by the frontend ModelRegistry.
 *
 * Security: Only alphanumeric + underscore type names allowed; the models/
 * directory is strictly bounded. No directory traversal is possible.
 */
require_once __DIR__ . '/helpers.php';

only_method('GET');
require_auth();

$type = preg_replace('/[^a-z0-9_]/i', '', (string)($_GET['type'] ?? ''));
if ($type === '') {
    http_response_code(400);
    json_err('type parameter is required.');
    exit;
}

// Strict allow-list of model types (must match models/*.json filename stems)
const ALLOWED_MODEL_TYPES = [
    'stargate',
    'relay_station',
    'jump_inhibitor',
    'deep_space_radar',
    'space_station',
    'transport_shuttle',
    // Ship hull models (used by shipyard hangar viewer)
    'ship_corvette',
    'ship_frigate',
    'ship_destroyer',
    'ship_cruiser',
];

if (!in_array($type, ALLOWED_MODEL_TYPES, true)) {
    http_response_code(404);
    json_err("Unknown model type: {$type}");
    exit;
}

$modelDir  = realpath(__DIR__ . '/../models');
$modelFile = $modelDir . DIRECTORY_SEPARATOR . $type . '.json';

// Extra paranoia: ensure resolved path is inside models/
if ($modelDir === false || !str_starts_with(realpath($modelFile) ?: '', $modelDir)) {
    http_response_code(404);
    json_err('Model file not found.');
    exit;
}

if (!is_file($modelFile) || !is_readable($modelFile)) {
    http_response_code(404);
    json_err("Model descriptor not found for type: {$type}");
    exit;
}

$descriptor = file_get_contents($modelFile);
$parsed     = json_decode($descriptor, true);
if (!is_array($parsed)) {
    http_response_code(500);
    json_err('Malformed model descriptor.');
    exit;
}

// Cache-friendly (models change rarely)
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: public, max-age=3600');
echo json_encode($parsed, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
exit;
