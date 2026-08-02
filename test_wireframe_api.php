<?php
// Test wireframe API
error_reporting(E_ALL);
ini_set('display_errors', '1');

$payload = json_encode([
    'name' => 'Test Design',
    'description' => 'Test wireframe',
    'vertices' => [['id' => 'v0', 'position' => ['x' => 0, 'y' => 0, 'z' => 0], 'components' => []]],
    'edges' => [],
    'faces' => [],
    'components' => []
]);

echo "=== Test Wireframe API ===\n";
echo "Payload: " . $payload . "\n\n";

// Test 1: Direct vessel_designs
echo "Test 1: POST /api/vessel_designs.php?wireframe=1\n";
$ctx = stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/json',
        'content' => $payload
    ]
]);
$result = @file_get_contents('http://localhost:8080/api/vessel_designs.php?wireframe=1', false, $ctx);
echo "Response: " . ($result ? substr($result, 0, 200) : '(empty)') . "\n\n";

// Test 2: Rewritten path
echo "Test 2: POST /api/wireframe_designs (rewritten)\n";
$result = @file_get_contents('http://localhost:8080/api/wireframe_designs', false, $ctx);
echo "Response: " . ($result ? substr($result, 0, 200) : '(empty)') . "\n\n";
?>
