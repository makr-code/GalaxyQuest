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
    json_error('type parameter is required.', 400);
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
    json_error("Unknown model type: {$type}", 404);
}

$modelDir  = realpath(__DIR__ . '/../models');
$modelFile = $modelDir . DIRECTORY_SEPARATOR . $type . '.json';

// Extra paranoia: ensure resolved path is inside models/
if ($modelDir === false || !str_starts_with(realpath($modelFile) ?: '', $modelDir)) {
    json_error('Model file not found.', 404);
}

if (!is_file($modelFile) || !is_readable($modelFile)) {
    json_error("Model descriptor not found for type: {$type}", 404);
}

$descriptor = file_get_contents($modelFile);
if ($descriptor === false) {
    json_error('Unable to read model descriptor.', 500);
}
$parsed     = json_decode($descriptor, true);
if (!is_array($parsed)) {
    json_error('Malformed model descriptor.', 500);
}

// Cache-friendly (models change rarely)
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: public, max-age=3600');
echo json_encode($parsed, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
exit;
