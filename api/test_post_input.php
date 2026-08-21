<?php
$body = json_decode(file_get_contents('php://input'), true);
echo "Received input_mode: " . ($body['input_mode'] ?? 'NOT SET') . PHP_EOL;
echo "Received body: " . json_encode($body, JSON_PRETTY_PRINT) . PHP_EOL;
