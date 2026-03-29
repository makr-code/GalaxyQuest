<?php

declare(strict_types=1);

/**
 * Admin stats endpoint integration smoke test.
 *
 * Run inside web container:
 *   php scripts/test_admin_stats_endpoint.php
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
out('=== Admin Stats Endpoint Smoke Test ===');
out('Timestamp: ' . date('c'));

$adminUser = 'admin_stats_' . bin2hex(random_bytes(4));
$adminMail = $adminUser . '@example.com';
$adminPass = 'AdminStats!123';
$adminHash = password_hash($adminPass, PASSWORD_BCRYPT);
$adminId = 0;
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$statsUrl = 'http://127.0.0.1/api/v1/admin_stats.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$adminUser, $adminMail, $adminHash]);
    $adminId = (int)$db->lastInsertId();

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        $hasFailure = true;
        fail('CSRF token request failed (status=' . $csrfResp['status'] . ')');
        throw new RuntimeException('Missing CSRF');
    }
    pass('CSRF token fetched');

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $adminUser,
        'password' => $adminPass,
        'remember' => false,
    ], $cookies, $csrf);

    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('Admin login failed (status=' . $loginResp['status'] . ')');
        throw new RuntimeException('Cannot continue without admin session');
    }
    pass('Admin login works');

    $statsResp = http_json('GET', $statsUrl, null, $cookies);
    if ($statsResp['status'] !== 200 || ($statsResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('admin_stats endpoint failed (status=' . $statsResp['status'] . ')');
    } else {
        $payload = $statsResp['json'];
        $required = ['users', 'colonies', 'fleets', 'npc_ticks', 'faction_event', 'config'];
        $missing = [];
        foreach ($required as $k) {
            if (!array_key_exists($k, $payload)) {
                $missing[] = $k;
            }
        }
        if ($missing) {
            $hasFailure = true;
            fail('admin_stats payload missing keys: ' . implode(', ', $missing));
        } else {
            pass('admin_stats payload shape is valid');
        }
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    if ($adminId > 0) {
        try {
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$adminId]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$adminId]);
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
