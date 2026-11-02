<?php

declare(strict_types=1);

use GalaxyQuest\Economy\OnDemandEconomy;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

$uid = require_auth();
if (!ON_DEMAND_ECONOMY_ENABLED) {
    json_error('On-demand economy is disabled. Apply its migration before enabling it.', 503);
}
$action = (string)($_GET['action'] ?? 'snapshot');
$service = new OnDemandEconomy(get_db());
try {
    if ($action === 'macro') {
        only_method('GET');
        $galaxy = isset($_GET['galaxy']) ? filter_var($_GET['galaxy'], FILTER_VALIDATE_INT) : null;
        $system = isset($_GET['system']) ? filter_var($_GET['system'], FILTER_VALIDATE_INT) : null;
        if (
            $galaxy === false || $system === false
            || ($galaxy !== null && ($galaxy < 1 || $galaxy > GALAXY_MAX))
            || ($system !== null && ($system < 1 || $system > SYSTEM_MAX))
        ) {
            json_error('Invalid market scope.', 400);
        }
        json_ok(['market' => $service->market($galaxy, $system)]);
    }
    if ($action === 'snapshot') {
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $snapshot = $service->settle($cid, $uid);
        json_ok($snapshot);
    }
    only_method('POST');
    verify_csrf();
    $body = get_json_body();
    $cid = filter_var($body['colony_id'] ?? null, FILTER_VALIDATE_INT);
    if ($cid === false || $cid < 1) {
        json_error('Invalid colony_id.', 400);
    }
    if ($action === 'build') {
        $slot = null;
        if (isset($body['slot_x']) || isset($body['slot_y'])) {
            $x = filter_var($body['slot_x'] ?? null, FILTER_VALIDATE_INT);
            $y = filter_var($body['slot_y'] ?? null, FILTER_VALIDATE_INT);
            if ($x === false || $y === false) {
                json_error('Both integer slot coordinates are required.', 400);
            }
            $slot = [$x, $y];
        }
        if (!is_string($body['building_type'] ?? null)) {
            json_error('building_type required.', 400);
        }
        json_ok($service->queue($cid, $uid, $body['building_type'], $slot));
    }
    if ($action === 'buy' || $action === 'sell') {
        $quantity = $body['quantity'] ?? null;
        if (!is_string($body['good_type'] ?? null) || !is_numeric($quantity)) {
            json_error('good_type and numeric quantity required.', 400);
        }
        json_ok($service->exchange($cid, $uid, $body['good_type'], (float)$quantity, $action === 'buy'));
    }
    if ($action === 'set_method') {
        if (!is_string($body['building_type'] ?? null) || !is_string($body['method'] ?? null)) {
            json_error('building_type and method required.', 400);
        }
        $service->method($cid, $uid, $body['building_type'], $body['method']);
        json_ok();
    }
    json_error('Unknown economy action.', 404);
} catch (DomainException $error) {
    json_error($error->getMessage(), $error->getCode() ?: 400);
}
