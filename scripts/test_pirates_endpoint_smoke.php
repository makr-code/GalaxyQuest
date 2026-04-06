<?php

declare(strict_types=1);

/**
 * Pirates endpoint integration smoke test.
 *
 * Run inside web container:
 *   php scripts/test_pirates_endpoint_smoke.php
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
out('=== Pirates Endpoint Smoke Test ===');
out('Timestamp: ' . date('c'));

$username = 'pirate_smoke_' . bin2hex(random_bytes(4));
$email = $username . '@example.com';
$password = 'Pirates!123';
$passwordHash = password_hash($password, PASSWORD_BCRYPT);
$userId = 0;
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$piratesBase = 'http://127.0.0.1/api/pirates.php';

try {
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, is_admin, protection_until)
         VALUES (?, ?, ?, 0, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $passwordHash]);
    $userId = (int) $db->lastInsertId();

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

    $statusResp = http_json('GET', $piratesBase . '?action=status', null, $cookies);
    if ($statusResp['status'] !== 200 || ($statusResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('status action failed (status=' . $statusResp['status'] . ')');
    } else {
        $missing = has_keys($statusResp['json'], ['factions', 'summary']);
        if ($missing) {
            $hasFailure = true;
            fail('status payload missing keys: ' . implode(', ', $missing));
        } else {
            pass('status payload shape is valid');
        }
    }

    $raidsResp = http_json('GET', $piratesBase . '?action=recent_raids&limit=5', null, $cookies);
    if ($raidsResp['status'] !== 200 || ($raidsResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('recent_raids action failed (status=' . $raidsResp['status'] . ')');
    } else {
        if (!array_key_exists('raids', $raidsResp['json']) || !is_array($raidsResp['json']['raids'])) {
            $hasFailure = true;
            fail('recent_raids payload missing raids[]');
        } else {
            pass('recent_raids payload shape is valid');
        }
    }

    $forecastResp = http_json('GET', $piratesBase . '?action=forecast', null, $cookies);
    if ($forecastResp['status'] !== 200 || ($forecastResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('forecast action failed (status=' . $forecastResp['status'] . ')');
    } else {
        $forecast = $forecastResp['json']['forecast'] ?? null;
        if (!is_array($forecast)) {
            $hasFailure = true;
            fail('forecast payload missing forecast object');
        } else {
            $missing = has_keys($forecast, ['risk_index', 'risk_level', 'raids_last_24h', 'recommended_action']);
            if ($missing) {
                $hasFailure = true;
                fail('forecast object missing keys: ' . implode(', ', $missing));
            } else {
                pass('forecast payload shape is valid');
            }
        }
    }

    $tickResp = http_json('POST', $piratesBase . '?action=run_tick', [], $cookies, $csrf, 180);
    if ($tickResp['status'] !== 200 || ($tickResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('run_tick action failed (status=' . $tickResp['status'] . ')');
    } else {
        $missing = has_keys($tickResp['json'], ['message', 'new_raids_last_24h_delta']);
        if ($missing) {
            $hasFailure = true;
            fail('run_tick payload missing keys: ' . implode(', ', $missing));
        } else {
            pass('run_tick payload shape is valid');
        }
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    if ($userId > 0) {
        try {
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM messages WHERE receiver_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM diplomacy WHERE user_id = ?')->execute([$userId]);
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
