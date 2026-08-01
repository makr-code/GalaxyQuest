<?php
$response = @file_get_contents('http://comfyui:8188/invalid/endpoint');
$data = json_decode($response, true);

echo "Response null? " . ($response === null ? "YES" : "NO") . "\n";
echo "Response length: " . strlen($response ?? "") . "\n";
echo "Data error set? " . (isset($data['error']) ? "YES" : "NO") . "\n";
echo "Data: " . json_encode($data) . "\n";
