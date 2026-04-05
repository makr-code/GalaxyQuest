<?php

declare(strict_types=1);

/**
 * Economy endpoint integration smoke test.
 *
 * Run inside web container:
 *   php scripts/test_economy_endpoint_smoke.php
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

function has_keys(array $payload, array $required): array {
    $missing = [];
    foreach ($required as $key) {
        if (!array_key_exists($key, $payload)) {
            $missing[] = $key;
        }
    }
    return $missing;
}

$db = get_db();
$hasFailure = false;
out('=== Economy Endpoint Smoke Test ===');
out('Timestamp: ' . date('c'));

$username = 'eco_smoke_' . bin2hex(random_bytes(4));
$email    = $username . '@example.com';
$password = 'Economy!123';
$passwordHash = password_hash($password, PASSWORD_BCRYPT);
$userId = 0;
$cookies = [];

$authBase    = 'http://127.0.0.1/api/v1/auth.php';
$economyBase = 'http://127.0.0.1/api/economy.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $passwordHash]);
    $userId = (int) $db->lastInsertId();

    // ---- CSRF ----
    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string) ($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        $hasFailure = true;
        fail('CSRF token request failed (status=' . $csrfResp['status'] . ')');
        throw new RuntimeException('Missing CSRF token');
    }
    pass('CSRF token fetched');

    // ---- Login ----
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

    // ---- get_policy ----
    $policyResp = http_json('GET', $economyBase . '?action=get_policy', null, $cookies);
    if ($policyResp['status'] !== 200 || ($policyResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_policy failed (status=' . $policyResp['status'] . ')');
    } else {
        $missing = has_keys($policyResp['json'], ['global_policy', 'taxes', 'subsidies']);
        if ($missing) {
            $hasFailure = true;
            fail('get_policy payload missing keys: ' . implode(', ', $missing));
        } else {
            $taxes = $policyResp['json']['taxes'];
            $subsidies = $policyResp['json']['subsidies'];
            if (!is_array($taxes) || !array_key_exists('income', $taxes)) {
                $hasFailure = true;
                fail('get_policy taxes.income missing');
            } elseif (!is_array($subsidies) || !array_key_exists('agriculture', $subsidies)) {
                $hasFailure = true;
                fail('get_policy subsidies.agriculture missing');
            } else {
                pass('get_policy payload shape is valid');
            }
        }
    }

    // ---- set_policy ----
    $setPolicyResp = http_json('POST', $economyBase . '?action=set_policy', ['policy' => 'free_market'], $cookies, $csrf);
    if ($setPolicyResp['status'] !== 200 || ($setPolicyResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('set_policy failed (status=' . $setPolicyResp['status'] . ')');
    } else {
        if (($setPolicyResp['json']['global_policy'] ?? '') !== 'free_market') {
            $hasFailure = true;
            fail('set_policy returned wrong global_policy value');
        } else {
            pass('set_policy works');
        }
    }

    // ---- set_tax ----
    $setTaxResp = http_json('POST', $economyBase . '?action=set_tax', ['type' => 'income', 'rate' => 0.15], $cookies, $csrf);
    if ($setTaxResp['status'] !== 200 || ($setTaxResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('set_tax failed (status=' . $setTaxResp['status'] . ')');
    } else {
        $returnedRate = (float) ($setTaxResp['json']['rate'] ?? -1.0);
        if (abs($returnedRate - 0.15) > 0.001) {
            $hasFailure = true;
            fail('set_tax returned unexpected rate: ' . $returnedRate);
        } else {
            pass('set_tax works');
        }
    }

    // ---- set_subsidy ----
    $setSubsidyResp = http_json('POST', $economyBase . '?action=set_subsidy', ['sector' => 'agriculture', 'enabled' => true], $cookies, $csrf);
    if ($setSubsidyResp['status'] !== 200 || ($setSubsidyResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('set_subsidy failed (status=' . $setSubsidyResp['status'] . ')');
    } else {
        if (($setSubsidyResp['json']['sector'] ?? '') !== 'agriculture' || ($setSubsidyResp['json']['enabled'] ?? null) !== true) {
            $hasFailure = true;
            fail('set_subsidy returned unexpected payload');
        } else {
            pass('set_subsidy works');
        }
    }

    // ---- get_overview (no colonies expected for fresh user, but must respond 200) ----
    $overviewResp = http_json('GET', $economyBase . '?action=get_overview', null, $cookies);
    if ($overviewResp['status'] !== 200 || ($overviewResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_overview failed (status=' . $overviewResp['status'] . ')');
    } else {
        if (!array_key_exists('colonies', $overviewResp['json']) || !is_array($overviewResp['json']['colonies'])) {
            $hasFailure = true;
            fail('get_overview payload missing colonies[]');
        } else {
            pass('get_overview payload shape is valid (colonies=' . count($overviewResp['json']['colonies']) . ')');
        }
    }

    // ---- get_pop_classes (empire-wide) ----
    $popResp = http_json('GET', $economyBase . '?action=get_pop_classes', null, $cookies);
    if ($popResp['status'] !== 200 || ($popResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_pop_classes failed (status=' . $popResp['status'] . ')');
    } else {
        if (!array_key_exists('pop_classes', $popResp['json'])) {
            $hasFailure = true;
            fail('get_pop_classes payload missing pop_classes key');
        } else {
            pass('get_pop_classes payload shape is valid');
        }
    }

    // ---- invalid action must return 400 ----
    $badResp = http_json('GET', $economyBase . '?action=nonexistent_action', null, $cookies);
    if ($badResp['status'] !== 400) {
        $hasFailure = true;
        fail('invalid action should return 400 but got ' . $badResp['status']);
    } else {
        pass('invalid action returns 400');
    }

} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    if ($userId > 0) {
        try {
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM economy_policies WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
        } catch (Throwable $cleanupErr) {
            out('[INFO] Cleanup warning: ' . $cleanupErr->getMessage());
        }
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
