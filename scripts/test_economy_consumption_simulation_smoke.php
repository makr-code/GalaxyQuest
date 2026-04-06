<?php

declare(strict_types=1);

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
    if (!$headers) {
        return 0;
    }
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', (string)$headers[0], $m)) {
        return (int)$m[1];
    }
    return 0;
}

function parse_cookies(array $headers): array {
    $cookies = [];
    foreach ($headers as $line) {
        if (stripos($line, 'Set-Cookie:') !== 0) {
            continue;
        }
        $pair = explode(';', trim(substr($line, 11)), 2)[0] ?? '';
        if ($pair === '' || strpos($pair, '=') === false) {
            continue;
        }
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

function http_json(string $method, string $url, ?array $payload, array &$cookies, ?string $csrf = null): array {
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
            'timeout' => 10,
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
out('=== Economy Consumption Simulation Smoke Test ===');
out('Timestamp: ' . date('c'));

$username = 'econsim_' . bin2hex(random_bytes(4));
$email = $username . '@example.com';
$password = 'EconSim!12345';
$userId = 0;
$bodyId = 0;
$colonyId = 0;
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$economyBase = 'http://127.0.0.1/api/economy.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, password_hash($password, PASSWORD_BCRYPT)]);
    $userId = (int)$db->lastInsertId();

    $db->prepare(<<<SQL
        INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize, diameter_km)
        VALUES (?, ?, ?, ?, 'planet', 'star', ?, 1, 12000)
    SQL)->execute(['smoke_econsim_body_' . bin2hex(random_bytes(4)), 2, 202, 4, 'Consumption Test Body']);
    $bodyId = (int)$db->lastInsertId();

    $db->prepare(<<<SQL
        INSERT INTO colonies
            (body_id, user_id, name, colony_type, metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
        VALUES (?, ?, ?, 'agricultural', 12000, 9000, 6000, 1500, 8000, 0,
                2400, 3200, 72, 45, DATE_SUB(NOW(), INTERVAL 2 HOUR))
    SQL)->execute([$bodyId, $userId, 'Consumption Test Colony']);
    $colonyId = (int)$db->lastInsertId();

    $buildingStmt = $db->prepare('INSERT INTO buildings (colony_id, type, level, upgrade_end) VALUES (?, ?, ?, NULL)');
    foreach ([
        'metal_mine' => 6,
        'crystal_mine' => 5,
        'deuterium_synth' => 4,
        'solar_plant' => 7,
        'hydroponic_farm' => 8,
        'food_silo' => 4,
        'habitat' => 6,
        'hospital' => 3,
        'school' => 3,
        'security_post' => 2,
    ] as $type => $level) {
        $buildingStmt->execute([$colonyId, $type, $level]);
    }

    $db->prepare(
        'INSERT INTO economy_processed_goods
         (colony_id, good_type, quantity, capacity, production_rate_per_hour, consumption_rate_per_hour, last_calculated_at)
         VALUES (?, ?, 100, 5000, 0, 0, DATE_SUB(NOW(), INTERVAL 2 HOUR))'
    )->execute([$colonyId, 'consumer_goods']);

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        $hasFailure = true;
        fail('CSRF token request failed');
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
        fail('Login failed');
        throw new RuntimeException('Cannot continue without login');
    }
    pass('Login works');

    $overviewResp = http_json('GET', $economyBase . '?action=get_overview&colony_id=' . $colonyId, null, $cookies);
    if ($overviewResp['status'] !== 200 || ($overviewResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_overview failed');
        throw new RuntimeException('Overview request failed');
    }

    $colonies = (array)($overviewResp['json']['colonies'] ?? []);
    if (count($colonies) !== 1) {
        $hasFailure = true;
        fail('Expected exactly one colony in overview');
        throw new RuntimeException('Unexpected colony count');
    }

    $overview = $colonies[0];
    $production = (array)($overview['production'] ?? []);
    $consumption = (array)($overview['consumption'] ?? []);
    $welfare = (array)($overview['welfare'] ?? []);
    $storage = (array)($overview['storage'] ?? []);
    $buildingLevels = (array)($overview['building_levels'] ?? []);

    if (($production['metal_per_hour'] ?? 0) > 0) {
        pass('Metal production is exposed and positive');
    } else {
        $hasFailure = true;
        fail('Metal production missing or non-positive');
    }

    if (($production['food_per_hour'] ?? 0) > ($consumption['food_per_hour'] ?? 0)) {
        pass('Food production exceeds food consumption');
    } else {
        $hasFailure = true;
        fail('Food production does not cover food consumption');
    }

    if (($consumption['energy_required_per_hour'] ?? -1) >= 0) {
        pass('Energy consumption is exposed');
    } else {
        $hasFailure = true;
        fail('Energy consumption missing');
    }

    if (($welfare['food_coverage'] ?? 0) > 0) {
        pass('Food coverage is exposed');
    } else {
        $hasFailure = true;
        fail('Food coverage missing');
    }

    if (($welfare['productivity_multiplier'] ?? 0) > 0) {
        pass('Productivity multiplier is positive');
    } else {
        $hasFailure = true;
        fail('Productivity multiplier missing');
    }

    if (($welfare['population_capacity'] ?? 0) >= (int)($overview['population'] ?? 0)) {
        pass('Population capacity is consistent');
    } else {
        $hasFailure = true;
        fail('Population capacity inconsistent');
    }

    if (($storage['food'] ?? 0) > 0 && ($buildingLevels['hydroponic_farm'] ?? 0) === 8) {
        pass('Storage and building levels are exposed');
    } else {
        $hasFailure = true;
        fail('Storage or building levels missing');
    }

    $productionResp = http_json('GET', $economyBase . '?action=get_production&colony_id=' . $colonyId, null, $cookies);
    if ($productionResp['status'] !== 200 || ($productionResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_production failed');
        throw new RuntimeException('Production request failed');
    }

    $productionPayload = (array)$productionResp['json'];
    if (($productionPayload['raw_production']['food_per_hour'] ?? 0) > 0) {
        pass('get_production returns raw production metrics');
    } else {
        $hasFailure = true;
        fail('get_production raw production missing');
    }

    if (isset($productionPayload['raw_consumption']['processed_goods_per_hour']['consumer_goods'])) {
        pass('Processed-goods consumption is exposed');
    } else {
        $hasFailure = true;
        fail('Processed-goods consumption missing');
    }

    if (array_key_exists('consumer_goods', (array)($productionPayload['goods'] ?? []))) {
        pass('Processed goods stock is included');
    } else {
        $hasFailure = true;
        fail('Processed goods stock missing');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($userId > 0) {
            $db->prepare('DELETE FROM economy_processed_goods WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM economy_pop_classes WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM economy_production_methods WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM buildings WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM colonies WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
        }
        if ($bodyId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$bodyId]);
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