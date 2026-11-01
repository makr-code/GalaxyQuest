<?php

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
require_once __DIR__ . '/lib/HealthProbe.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'] ?? '';
$response = \GalaxyQuest\Health\HealthProbe::response(is_string($path) ? $path : '', $method, static function (): void {
    \GalaxyQuest\Health\HealthProbe::assertReadyWithinDeadline(__DIR__);
});

http_response_code($response['code']);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if ($response['code'] === 405) {
    header('Allow: GET, HEAD');
}
if ($response['code'] === 503) {
    header('Retry-After: 5');
}
if ($method !== 'HEAD') {
    echo json_encode(['status' => $response['status']], JSON_THROW_ON_ERROR) . "\n";
}
