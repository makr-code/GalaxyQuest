<?php

declare(strict_types=1);

/**
 * Generic trade delivery smoke test.
 *
 * Validates full path:
 * create route with cargo payload -> auto-dispatch -> fleet arrival processing
 * -> processed goods delivered to target colony.
 *
 * Run inside web container:
 *   php scripts/test_trade_generic_delivery_smoke.php
 */

require_once __DIR__ . '/../api/helpers.php';

function out(string $line = ''): void {
    echo $line . PHP_EOL;
}

function pass(string $label): void {
    out('[PASS] ' . $label);
}

function fail(string $label): void {
    out('[FAIL] ' . $label);
}

function parse_status(array $headers): int {
    if (!$headers) return 0;
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', (string)$headers[0], $m)) {
        return (int)$m[1];
    }
    return 0;
}

function parse_cookies(array $headers): array {
    $cookies = [];
    foreach ($headers as $line) {
        if (stripos($line, 'Set-Cookie:') !== 0) continue;
        $pair = explode(';', trim(substr($line, 11)), 2)[0] ?? '';
        if ($pair === '' || strpos($pair, '=') === false) continue;
        [$k, $v] = explode('=', $pair, 2);
        $cookies[trim($k)] = trim($v);
    }
    return $cookies;
}

function cookie_header(array $jar): string {
    $parts = [];
    foreach ($jar as $k => $v) {
        $parts[] = $k . '=' . $v;
    }
    return implode('; ', $parts);
}

/** @return array{status:int,json:array,body:string} */
function http_json(string $method, string $url, ?array $payload, array &$cookies, ?string $csrf = null, int $timeoutSeconds = 10): array {
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
    ];

    $cookie = cookie_header($cookies);
    if ($cookie !== '') {
        $headers[] = 'Cookie: ' . $cookie;
    }
    if ($csrf !== null && $csrf !== '') {
        $headers[] = 'X-CSRF-Token: ' . $csrf;
    }

    $opts = [
        'http' => [
            'method' => strtoupper($method),
            'ignore_errors' => true,
            'timeout' => max(5, $timeoutSeconds),
            'header' => implode("\r\n", $headers) . "\r\n",
        ],
    ];

    if ($payload !== null) {
        $opts['http']['content'] = json_encode($payload);
    }

    $ctx = stream_context_create($opts);
    $body = @file_get_contents($url, false, $ctx);
    $respHeaders = $http_response_header ?? [];

    $cookies = array_merge($cookies, parse_cookies($respHeaders));

    $json = [];
    if (is_string($body) && $body !== '') {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $json = $decoded;
        }
    }

    return [
        'status' => parse_status($respHeaders),
        'json' => $json,
        'body' => is_string($body) ? $body : '',
    ];
}

$db = get_db();
$hasFailure = false;
out('=== Trade Generic Delivery Smoke Test ===');
out('Timestamp: ' . date('c'));

$username = 'trade_delivery_' . bin2hex(random_bytes(4));
$email = $username . '@example.com';
$password = 'TradeDelivery!123';
$passwordHash = password_hash($password, PASSWORD_BCRYPT);

$userId = 0;
$bodyAId = 0;
$bodyBId = 0;
$colonyAId = 0;
$colonyBId = 0;
$routeId = 0;
$fleetId = 0;
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$tradeBase = 'http://127.0.0.1/api/trade.php';
$fleetBase = 'http://127.0.0.1/api/fleet.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $passwordHash]);
    $userId = (int)$db->lastInsertId();

    $bodyIns = $db->prepare(<<<SQL
        INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize)
        VALUES (?, ?, ?, ?, 'planet', 'star', ?, 1)
    SQL);

    $uidA = 'smoke_trade_deliv_body_a_' . bin2hex(random_bytes(4));
    $uidB = 'smoke_trade_deliv_body_b_' . bin2hex(random_bytes(4));
    $bodyIns->execute([$uidA, 1, 121, 1, 'Smoke Delivery A']);
    $bodyAId = (int)$db->lastInsertId();
    $bodyIns->execute([$uidB, 1, 122, 2, 'Smoke Delivery B']);
    $bodyBId = (int)$db->lastInsertId();

    $colIns = $db->prepare(<<<SQL
        INSERT INTO colonies
            (body_id, user_id, name, colony_type, metal, crystal, deuterium, rare_earth, food, population)
        VALUES (?, ?, ?, 'industrial', ?, ?, ?, ?, ?, ?)
    SQL);

    $colIns->execute([$bodyAId, $userId, 'Delivery Source', 5000, 2500, 2200, 900, 700, 1800]);
    $colonyAId = (int)$db->lastInsertId();
    $colIns->execute([$bodyBId, $userId, 'Delivery Target', 900, 1200, 400, 100, 250, 1400]);
    $colonyBId = (int)$db->lastInsertId();

    $db->prepare(<<<SQL
        INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
        VALUES (?, 'steel_alloy', 1000.0, 5000.0)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
    SQL)->execute([$colonyAId]);

    $db->prepare(<<<SQL
        INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
        VALUES (?, 'steel_alloy', 0.0, 5000.0)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
    SQL)->execute([$colonyBId]);

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        $hasFailure = true;
        fail('CSRF token request failed (status=' . $csrfResp['status'] . ')');
        throw new RuntimeException('Missing CSRF token');
    }
    pass('CSRF token fetched');

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $username,
        'password' => $password,
        'remember' => false,
    ], $cookies, $csrf);

    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('Login failed (status=' . $loginResp['status'] . ')');
        throw new RuntimeException('Cannot continue without authenticated session');
    }
    pass('Login works');

    $createResp = http_json('POST', $tradeBase . '?action=create', [
        'origin_colony_id' => $colonyAId,
        'target_colony_id' => $colonyBId,
        'cargo' => ['steel_alloy' => 120],
        'interval_hours' => 1,
    ], $cookies, $csrf);

    if ($createResp['status'] !== 200 || ($createResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('trade route create failed (status=' . $createResp['status'] . ')');
        throw new RuntimeException('Route create failed');
    }
    $routeId = (int)($createResp['json']['trade_route_id'] ?? 0);
    if ($routeId <= 0) {
        $hasFailure = true;
        fail('trade route id missing');
        throw new RuntimeException('Invalid route id');
    }
    pass('Trade route created');

    // Trigger auto-dispatch (check_and_dispatch_trade_routes runs before action handler)
    $listResp = http_json('GET', $tradeBase . '?action=list', null, $cookies);
    if ($listResp['status'] !== 200 || ($listResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('trade list failed after create (status=' . $listResp['status'] . ')');
        throw new RuntimeException('Trade list failed');
    }

    $fleetStmt = $db->prepare('SELECT id, cargo_payload FROM fleets WHERE user_id = ? AND mission = "transport" ORDER BY id DESC LIMIT 1');
    $fleetStmt->execute([$userId]);
    $fleet = $fleetStmt->fetch(PDO::FETCH_ASSOC);
    if (!$fleet) {
        $hasFailure = true;
        fail('No dispatched fleet found');
        throw new RuntimeException('No fleet dispatched');
    }

    $fleetId = (int)$fleet['id'];
    $fleetPayload = json_decode((string)($fleet['cargo_payload'] ?? '{}'), true);
    if (!is_array($fleetPayload) || (float)($fleetPayload['steel_alloy'] ?? 0.0) <= 0.0) {
        $hasFailure = true;
        fail('Fleet cargo_payload missing steel_alloy');
    } else {
        pass('Fleet dispatched with generic cargo_payload');
    }

    // Force arrival and process
    $db->prepare('UPDATE fleets SET arrival_time = DATE_SUB(NOW(), INTERVAL 2 SECOND) WHERE id = ?')->execute([$fleetId]);
    $checkResp = http_json('GET', $fleetBase . '?action=check', null, $cookies);
    if ($checkResp['status'] !== 200 || ($checkResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('fleet check failed (status=' . $checkResp['status'] . ')');
        throw new RuntimeException('Fleet check failed');
    }
    pass('Fleet arrival processing triggered');

    $targetQtyStmt = $db->prepare('SELECT quantity FROM economy_processed_goods WHERE colony_id = ? AND good_type = ?');
    $targetQtyStmt->execute([$colonyBId, 'steel_alloy']);
    $targetQty = (float)($targetQtyStmt->fetchColumn() ?: 0.0);
    if ($targetQty < 120.0) {
        $hasFailure = true;
        fail('Target colony did not receive expected steel_alloy payload (qty=' . $targetQty . ')');
    } else {
        pass('Target colony received generic goods delivery');
    }

    $returnStmt = $db->prepare('SELECT returning FROM fleets WHERE id = ?');
    $returnStmt->execute([$fleetId]);
    $isReturning = (int)($returnStmt->fetchColumn() ?: 0);
    if ($isReturning !== 1) {
        $hasFailure = true;
        fail('Fleet not in returning state after delivery');
    } else {
        pass('Fleet switched to returning state');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($userId > 0) {
            $db->prepare('DELETE FROM fleets WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM trade_routes WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM economy_processed_goods WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM colonies WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
        }
        if ($bodyAId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$bodyAId]);
        }
        if ($bodyBId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$bodyBId]);
        }
    } catch (Throwable $cleanupErr) {
        out('[INFO] Cleanup warning: ' . $cleanupErr->getMessage());
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
