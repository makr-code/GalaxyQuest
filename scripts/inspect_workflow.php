#!/usr/bin/env php
<?php

$workflow = file_get_contents('/workspace/custom_nodes/ComfyUI-Trellis2/example_workflows/MeshOnly.json');
$data = json_decode($workflow, true);

// Show first few nodes
$nodes = array_slice($data, 0, 5, true);
foreach ($nodes as $nodeId => $nodeData) {
    echo "Node $nodeId:\n";
    echo "  class_type: " . ($nodeData['class_type'] ?? 'N/A') . "\n";
    if (isset($nodeData['inputs'])) {
        echo "  inputs type: " . gettype($nodeData['inputs']) . "\n";
        foreach ($nodeData['inputs'] as $k => $v) {
            if (is_array($v)) {
                echo "    $k: [" . implode(", ", $v) . "]\n";
            } else {
                echo "    $k: " . substr((string)$v, 0, 50) . "\n";
            }
        }
    }
    echo "\n";
}
