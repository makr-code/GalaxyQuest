#!/usr/bin/env php
<?php
/**
 * Check registered nodes in ComfyUI
 */

$url = 'http://comfyui:8188/api/nodeinfo';

try {
    $response = file_get_contents($url);
    $data = json_decode($response, true);
    
    if (!$data) {
        echo "[ERROR] Failed to parse nodeinfo JSON\n";
        exit(1);
    }
    
    $allNodes = array_keys($data);
    $trellis_nodes = array_filter($allNodes, function($k) { return stripos($k, 'trellis') !== false; });
    
    echo "[OK] ComfyUI has " . count($allNodes) . " nodes registered\n";
    echo "[OK] TRELLIS2 nodes found: " . count($trellis_nodes) . "\n";
    
    if (count($trellis_nodes) > 0) {
        echo "\nFirst 10 TRELLIS2 nodes:\n";
        foreach (array_slice($trellis_nodes, 0, 10) as $node) {
            echo "  - $node\n";
        }
    } else {
        echo "\n[WARNING] No TRELLIS2 nodes found! Custom nodes may not be loaded.\n";
        echo "\nFirst 10 registered nodes:\n";
        foreach (array_slice($allNodes, 0, 10) as $node) {
            echo "  - $node\n";
        }
    }
    
} catch (Exception $e) {
    echo "[ERROR] Failed to retrieve nodeinfo: " . $e->getMessage() . "\n";
}
