<?php
require 'api/helpers.php';
$db = get_db();

$stmt = $db->query("SELECT id, input_mode, JSON_EXTRACT(metadata, '$.trellis2_event_id') as event_id, status FROM generation_queue WHERE id IN (8,9,10,11,12,13,14) ORDER BY id");
echo "\n=== Job Status & Event IDs ===\n";
foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
    $eventId = trim($row['event_id'], '"');
    printf("  ID %2d: %-6s | Event: %s | Status: %s\n", 
        $row['id'], 
        $row['input_mode'],
        $eventId ? substr($eventId, 0, 8) : 'NULL',
        $row['status']
    );
}

echo "\n=== Checking TRELLIS2 Gradio Event Status ===\n";
// Test if Gradio event endpoint works for a submitted job
$testEventId = "6ae46401400a431b8c7716e6dea8ec58"; // Job 11's event
$url = "http://trellis2:7862/gradio_api/call/text_to_3d/" . $testEventId;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_CUSTOMREQUEST => 'GET'
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

echo "URL: $url\n";
echo "HTTP Code: $httpCode\n";
if ($error) echo "Error: $error\n";
if ($response) {
    echo "Response:\n";
    echo substr($response, 0, 300) . "\n";
}

echo "\n=== Checking Generated Files ===\n";
$glbDir = '/var/www/html/generated/trellis2';
$files = @scandir($glbDir);
if ($files) {
    echo "Files in $glbDir:\n";
    foreach ($files as $f) {
        if ($f !== '.' && $f !== '..') {
            $path = "$glbDir/$f";
            $size = filesize($path);
            $mtime = filemtime($path);
            $age = time() - $mtime;
            printf("  %s (%d bytes, %d sec old)\n", $f, $size, $age);
        }
    }
} else {
    echo "Directory not found or empty\n";
}

echo "\n✅ Diagnostics complete\n";
