<?php

declare(strict_types=1);

/**
 * Generic trade suggestions + apply_suggestion smoke test.
 *
 * Run inside web container:
 *   php scripts/test_trade_suggestions_generic_smoke.php
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
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', (string) $headers[0], $m)) {
        return (int) $m[1];
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
        if (is_array($decoded)) $json = $decoded;
    }

    return [
        'status' => parse_status($respHeaders),
        'json' => $json,
        'body' => is_string($body) ? $body : '',
    ];
}

$db = get_db();
$hasFailure = false;
out('=== Trade Suggestions Generic Smoke Test ===');
out('Timestamp: ' . date('c'));

$username = 'trade_generic_' . bin2hex(random_bytes(4));
$email = $username . '@example.com';
$password = 'TradeGeneric!123';
$passwordHash = password_hash($password, PASSWORD_BCRYPT);

$userId = 0;
$bodyAId = 0;
$bodyBId = 0;
$colonyAId = 0;
$colonyBId = 0;
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$tradeBase = 'http://127.0.0.1/api/trade.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $passwordHash]);
    $userId = (int) $db->lastInsertId();

    $bodyIns = $db->prepare(<<<SQL
        INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position,
             body_type, parent_body_type, name, can_colonize)
        VALUES (?, ?, ?, ?, 'planet', 'star', ?, 1)
    SQL);

    $uidA = 'smoke_trade_body_a_' . bin2hex(random_bytes(4));
    $uidB = 'smoke_trade_body_b_' . bin2hex(random_bytes(4));
    $bodyIns->execute([$uidA, 1, 101, 1, 'Smoke Body A']);
    $bodyAId = (int) $db->lastInsertId();
    $bodyIns->execute([$uidB, 1, 102, 2, 'Smoke Body B']);
    $bodyBId = (int) $db->lastInsertId();

    $colIns = $db->prepare(<<<SQL
        INSERT INTO colonies
            (body_id, user_id, name, colony_type, metal, crystal, deuterium, rare_earth, food, energy,
             population, max_population, happiness, public_services, last_update)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 2 HOUR))
    SQL);

    $colIns->execute([$bodyAId, $userId, 'Source Colony', 'agricultural', 8000, 1500, 1200, 1200, 12000, 0, 2500, 4200, 82, 55]);
    $colonyAId = (int) $db->lastInsertId();
    $colIns->execute([$bodyBId, $userId, 'Target Colony', 'industrial', 250, 1400, 700, 50, 15, 0, 5200, 6200, 34, 18]);
    $colonyBId = (int) $db->lastInsertId();

    $buildingStmt = $db->prepare('INSERT INTO buildings (colony_id, type, level, upgrade_end) VALUES (?, ?, ?, NULL)');
    foreach ([
        'hydroponic_farm' => 8,
        'food_silo' => 4,
        'solar_plant' => 5,
        'habitat' => 4,
        'hospital' => 2,
        'school' => 2,
        'security_post' => 2,
    ] as $type => $level) {
        $buildingStmt->execute([$colonyAId, $type, $level]);
    }
    foreach ([
        'solar_plant' => 1,
        'fusion_reactor' => 1,
        'food_silo' => 1,
        'habitat' => 2,
        'hospital' => 1,
        'school' => 1,
        'security_post' => 1,
    ] as $type => $level) {
        $buildingStmt->execute([$colonyBId, $type, $level]);
    }

    $db->prepare(<<<SQL
        INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
        VALUES (?, 'steel_alloy', 4200.0, 5000.0)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), capacity = VALUES(capacity)
    SQL)->execute([$colonyAId]);

    $db->prepare(<<<SQL
        INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
        VALUES (?, 'steel_alloy', 50.0, 5000.0)
        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), capacity = VALUES(capacity)
    SQL)->execute([$colonyBId]);

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string) ($csrfResp['json']['token'] ?? '');
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

    $suggestResp = http_json('GET', $tradeBase . '?action=list_suggestions&limit=20&interval_hours=24', null, $cookies);
    if ($suggestResp['status'] !== 200 || ($suggestResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('list_suggestions failed (status=' . $suggestResp['status'] . ')');
        throw new RuntimeException('list_suggestions failed');
    }

    $suggestions = $suggestResp['json']['suggestions'] ?? [];
    if (!is_array($suggestions) || !$suggestions) {
        $hasFailure = true;
        fail('list_suggestions returned no suggestions');
        throw new RuntimeException('No suggestions returned');
    }
    pass('list_suggestions returns suggestions');

    // Suggestions are expected to be ordered by server-side priority score descending.
    $isPrioritySorted = true;
    for ($i = 1; $i < count($suggestions); $i++) {
        $prev = (float)($suggestions[$i - 1]['priority_score'] ?? 0.0);
        $curr = (float)($suggestions[$i]['priority_score'] ?? 0.0);
        if ($curr > $prev + 0.000001) {
            $isPrioritySorted = false;
            break;
        }
    }
    if (!$isPrioritySorted) {
        $hasFailure = true;
        fail('list_suggestions is not sorted by priority_score desc');
    } else {
        pass('list_suggestions is sorted by priority_score desc');
    }

    $steelSuggestion = null;
    foreach ($suggestions as $s) {
        if (($s['resource_type'] ?? '') === 'steel_alloy') {
            $steelSuggestion = $s;
            break;
        }
    }

    if (!$steelSuggestion) {
        $hasFailure = true;
        fail('No steel_alloy suggestion found (generic goods path)');
        throw new RuntimeException('No steel_alloy suggestion');
    }

    $foodSuggestion = null;
    foreach ($suggestions as $s) {
        if (($s['resource_type'] ?? '') === 'food' && (int)($s['target_colony_id'] ?? 0) === $colonyBId) {
            $foodSuggestion = $s;
            break;
        }
    }

    if (!$foodSuggestion) {
        $hasFailure = true;
        fail('No food suggestion found for welfare shortage path');
        throw new RuntimeException('No food suggestion');
    }
    pass('food suggestion found');

    $foodPriorityOk = (($foodSuggestion['priority'] ?? '') === 'critical' || ($foodSuggestion['priority'] ?? '') === 'high')
        && (($foodSuggestion['priority_multiplier'] ?? 0) > 1.0)
        && (($foodSuggestion['reason'] ?? '') === 'welfare-shortage')
        && ((float)($foodSuggestion['target_welfare']['food_coverage'] ?? 0.0) < 1.0);

    if (!$foodPriorityOk) {
        $hasFailure = true;
        fail('food suggestion was not welfare-prioritized as expected');
    } else {
        pass('food suggestion reflects welfare shortage priority');
    }

    $missingKeys = [];
    foreach (['priority', 'priority_score', 'matching_score', 'cargo'] as $k) {
        if (!array_key_exists($k, $steelSuggestion)) {
            $missingKeys[] = $k;
        }
    }
    if ($missingKeys) {
        $hasFailure = true;
        fail('Suggestion missing keys: ' . implode(', ', $missingKeys));
    } else {
        pass('suggestion includes priority fields');
    }

    $applyResp = http_json('POST', $tradeBase . '?action=apply_suggestion', [
        'origin_colony_id' => (int)($steelSuggestion['origin_colony_id'] ?? $colonyAId),
        'target_colony_id' => (int)($steelSuggestion['target_colony_id'] ?? $colonyBId),
        'cargo' => (array)($steelSuggestion['cargo'] ?? ['steel_alloy' => 100]),
        'interval_hours' => 24,
    ], $cookies, $csrf);

    if ($applyResp['status'] !== 200 || ($applyResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('apply_suggestion failed (status=' . $applyResp['status'] . ')');
        throw new RuntimeException('apply_suggestion failed');
    }

    $routeId = (int)($applyResp['json']['trade_route_id'] ?? 0);
    if ($routeId <= 0) {
        $hasFailure = true;
        fail('apply_suggestion returned invalid trade_route_id');
        throw new RuntimeException('Invalid trade_route_id');
    }
    pass('apply_suggestion created/updated route');

    $routeStmt = $db->prepare('SELECT cargo_payload FROM trade_routes WHERE id = ? AND user_id = ?');
    $routeStmt->execute([$routeId, $userId]);
    $payloadRaw = (string)($routeStmt->fetchColumn() ?: '');
    $payload = json_decode($payloadRaw, true);

    if (!is_array($payload) || (float)($payload['steel_alloy'] ?? 0.0) <= 0.0) {
        $hasFailure = true;
        fail('trade_routes.cargo_payload missing steel_alloy quantity');
    } else {
        pass('route persisted generic cargo_payload');
    }

    // Also verify mixed colony-resource + processed-good payload persists correctly.
    $applyMixedResp = http_json('POST', $tradeBase . '?action=apply_suggestion', [
        'origin_colony_id' => $colonyAId,
        'target_colony_id' => $colonyBId,
        'cargo' => [
            'food' => 75,
            'steel_alloy' => 125,
        ],
        'interval_hours' => 12,
    ], $cookies, $csrf);

    if ($applyMixedResp['status'] !== 200 || ($applyMixedResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('apply_suggestion mixed payload failed (status=' . $applyMixedResp['status'] . ')');
        throw new RuntimeException('apply_suggestion mixed payload failed');
    }

    $mixedRouteId = (int)($applyMixedResp['json']['trade_route_id'] ?? 0);
    if ($mixedRouteId <= 0) {
        $hasFailure = true;
        fail('apply_suggestion mixed payload returned invalid trade_route_id');
        throw new RuntimeException('Invalid mixed trade_route_id');
    }

    $mixedStmt = $db->prepare('SELECT cargo_payload, interval_hours FROM trade_routes WHERE id = ? AND user_id = ?');
    $mixedStmt->execute([$mixedRouteId, $userId]);
    $mixedRow = $mixedStmt->fetch(PDO::FETCH_ASSOC) ?: [];
    $mixedPayload = json_decode((string)($mixedRow['cargo_payload'] ?? '{}'), true);
    $mixedInterval = (int)($mixedRow['interval_hours'] ?? 0);

    $mixedOk = is_array($mixedPayload)
        && (float)($mixedPayload['food'] ?? 0.0) >= 75.0
        && (float)($mixedPayload['steel_alloy'] ?? 0.0) >= 125.0
        && $mixedInterval === 12;

    if (!$mixedOk) {
        $hasFailure = true;
        fail('mixed payload route did not persist expected cargo/interval');
    } else {
        pass('apply_suggestion persists mixed colony + generic payload');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($userId > 0) {
            $db->prepare('DELETE FROM trade_routes WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM economy_processed_goods WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
            $db->prepare('DELETE FROM buildings WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)')->execute([$userId]);
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
