<?php

declare(strict_types=1);

$sessionIds = explode(',', (string)getenv('GQ_RESOURCE_API_TEST_SESSION_IDS'));
$sessionId = $_COOKIE['PHPSESSID'] ?? '';
if (!in_array($sessionId, $sessionIds, true)) {
    http_response_code(401);
    exit;
}

session_id($sessionId);
session_start();
$_SESSION['user_id'] = 7;
$_SESSION['csrf_token'] = 'gq-market-test-csrf';
session_write_close();
