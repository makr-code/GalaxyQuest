#!/usr/bin/env php
<?php
/**
 * Test ComfyUI workflow generation
 */
require_once __DIR__ . '/../api/comfyui_workflow_builder.php';

echo "[Test] Generating text-to-3D workflow\n";
$workflow = ComfyUIWorkflowBuilder::buildTextTo3DWorkflow("A shiny red sphere");
echo "Workflow nodes: " . count($workflow) . "\n";

// Check structure
foreach ($workflow as $nodeId => $node) {
    echo "  Node $nodeId: " . ($node['class_type'] ?? 'unknown') . "\n";
    if (is_array($node['inputs'] ?? null)) {
        echo "    Inputs is dict: " . (count($node['inputs']) . " keys\n");
        foreach ($node['inputs'] as $k => $v) {
            if (is_array($v)) {
                echo "      $k: [node_ref]\n";
            } else {
                echo "      $k: " . substr("$v", 0, 30) . "\n";
            }
        }
    }
}

echo "\n[Test] Submitting to ComfyUI API\n";
$ch = curl_init('http://comfyui:8188/api/prompt');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'prompt' => $workflow,
        'client_id' => 'test_' . uniqid()
    ]),
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
curl_close($ch);

echo "HTTP Code: $httpCode\n";
echo "Error: $err\n";
echo "Response: " . substr($response, 0, 200) . "\n";

if ($httpCode === 200) {
    $result = json_decode($response, true);
    echo "\n[OK] Workflow submitted! Prompt ID: " . ($result['prompt_id'] ?? 'N/A') . "\n";
} else {
    echo "\n[ERROR] Workflow submission failed\n";
}
