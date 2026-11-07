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
    exit;
}

try {
    $options = simulation_tick_request_options($body, $uid);
} catch (InvalidArgumentException $error) {
    json_error($error->getMessage(), 400);
}

$scope = $options['scope'];
$force = $options['force'];

if ($scope === 'global') {
    if (!is_admin_user($db, $uid)) {
        json_error('Admin privileges required for global simulation ticks.', 403);
        exit;
    }
    $result = simulation_tick_global($db, $force);
    $response = simulation_runtime_public_response($result);
    json_response($response, $response['success'] ? 200 : 500);
    exit;
}

$targetUserId = $options['user_id'];
if ($targetUserId !== $uid && !is_admin_user($db, $uid)) {
    json_error('Cannot run simulation tick for another user.', 403);
    exit;
}

$result = simulation_tick_user($db, $targetUserId, $force);
$response = simulation_runtime_public_response($result);
json_response($response, $response['success'] ? 200 : 500);
