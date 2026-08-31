<?php

declare(strict_types=1);

/**
 * Headless simulation tick endpoint.
 *
 * POST /api/simulation_tick.php?action=run
 * body: { scope?: "global"|"user", user_id?: int, force?: bool }
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/simulation_runtime.php';

only_method('POST');
verify_csrf();

$uid = require_auth();
$db = get_db();
$body = get_json_body();
$action = strtolower(trim((string)($_GET['action'] ?? 'run')));

if ($action !== 'run') {
    json_error('Unknown action', 404);
}

$scope = strtolower(trim((string)($body['scope'] ?? 'user')));
$force = !empty($body['force']);

if ($scope === 'global') {
    if (!is_admin_user($db, $uid)) {
        json_error('Admin privileges required for global simulation ticks.', 403);
    }
    $result = simulation_tick_global($db, $force);
    json_ok(['simulation' => $result]);
}

$targetUserId = (int)($body['user_id'] ?? $uid);
if ($targetUserId !== $uid && !is_admin_user($db, $uid)) {
    json_error('Cannot run simulation tick for another user.', 403);
}

$result = simulation_tick_user($db, $targetUserId, $force);
json_ok(['simulation' => $result]);

