#!/usr/bin/env php
<?php
/**
 * Test ComfyUI API connectivity
 */

echo "[Test] Checking ComfyUI API on http://comfyui:8188\n";

$ch = curl_init('http://comfyui:8188/api/prompt');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'prompt' => ['1' => ['inputs' => ['test'], 'class_type' => 'CheckpointLoaderSimple']],
        'client_id' => 'test_connection'
    ]),
    CURLOPT_VERBOSE => true,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
$errCode = curl_errno($ch);
curl_close($ch);

echo "[API Response]\n";
echo "HTTP Code: $httpCode\n";
echo "Error: $err (Code: $errCode)\n";
echo "Response:\n";
echo $response ? substr($response, 0, 500) : "(empty)\n";
