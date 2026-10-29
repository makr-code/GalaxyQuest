<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/API/GetNewSession') {
    header('Content-Type: application/json');
    echo json_encode(['session_id' => 'isolated-portrait-fixture']);
} elseif ($path === '/API/GenerateText2Image') {
    $body = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    if (($body['width'] ?? null) !== 768 || ($body['height'] ?? null) !== 1024
        || !str_contains($body['prompt'] ?? '', "race: Vor'Tak")
        || !str_contains($body['prompt'] ?? '', 'Scaly reptilian skin')) {
        http_response_code(400);
        echo json_encode(['error' => 'Expected canonical Vor Tak morphology and portrait dimensions.']);
        exit;
    }
    header('Content-Type: application/json');
    echo json_encode(['images' => ['portrait.png']]);
} elseif ($path === '/portrait.png') {
    $chunk = static fn(string $type, string $data): string =>
        pack('N', strlen($data)) . $type . $data . pack('N', crc32($type . $data));
    header('Content-Type: image/png');
    echo "\x89PNG\r\n\x1a\n"
        . $chunk('IHDR', pack('NNCCCCC', 768, 1024, 8, 2, 0, 0, 0))
        . $chunk('IDAT', gzcompress(str_repeat("\0" . str_repeat("\x40\x80\xc0", 768), 1024)))
        . $chunk('IEND', '');
} else {
    http_response_code(404);
}
