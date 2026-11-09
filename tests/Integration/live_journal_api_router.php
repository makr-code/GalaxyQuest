<?php

declare(strict_types=1);

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if ($path === '/api/v1/live_battle_journal.php') {
    require __DIR__ . '/../../api/live_battle_journal.php';
    return true;
}
http_response_code(404);
