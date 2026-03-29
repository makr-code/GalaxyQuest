<?php

declare(strict_types=1);

/**
 * Auth login rate-limit / lockout integration smoke test.
 *
 * Run inside web container:
 *   php scripts/test_auth_rate_limit.php
 *
 * Expected behavior:
 * - First LOGIN_MAX_ATTEMPTS invalid logins => HTTP 401
 * - Next invalid login => HTTP 429 (locked)
 * - After clearing lock row + valid login => HTTP 200 and lock row removed
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

function info(string $label): void {
    out('[INFO] ' . $label);
}

function ensure_login_attempts_table(PDO $db): void {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS login_attempts (
            ip_hash          VARCHAR(64)   NOT NULL PRIMARY KEY,
            attempt_count    INT UNSIGNED  NOT NULL DEFAULT 0,
            first_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
            locked_until     DATETIME      NULL     DEFAULT NULL,
            INDEX idx_locked_until (locked_until)
        ) ENGINE=InnoDB'
    );
}

function parse_status_code(array $headers): int {
    if (!$headers) return 0;
    if (preg_match('/HTTP\/\d(?:\.\d)?\s+(\d{3})/', (string)$headers[0], $m)) {
        return (int)$m[1];
    }
    return 0;
}

function parse_set_cookie(array $headers): array {
    $cookies = [];
    foreach ($headers as $line) {
        if (stripos($line, 'Set-Cookie:') !== 0) continue;
        $raw = trim(substr($line, strlen('Set-Cookie:')));
        $pair = explode(';', $raw, 2)[0] ?? '';
        if ($pair === '' || strpos($pair, '=') === false) continue;
        [$k, $v] = explode('=', $pair, 2);
        $cookies[trim($k)] = trim($v);
    }
    return $cookies;
}

function build_cookie_header(array $cookies): string {
    if (!$cookies) return '';
    $parts = [];
    foreach ($cookies as $k => $v) {
        $parts[] = $k . '=' . $v;
    }
    return implode('; ', $parts);
}

/**
 * @return array{status:int,headers:array,body:string,json:array}
 */
function http_json(string $method, string $url, ?array $payload, array &$cookieJar, ?string $csrf = null): array {
    $headers = [
        'Accept: application/json',
        'Content-Type: application/json',
    ];

    $cookieHeader = build_cookie_header($cookieJar);
    if ($cookieHeader !== '') {
        $headers[] = 'Cookie: ' . $cookieHeader;
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

    $cookieJar = array_merge($cookieJar, parse_set_cookie($respHeaders));

    $json = [];
    if (is_string($body) && $body !== '') {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $json = $decoded;
        }
    }

    return [
        'status' => parse_status_code($respHeaders),
        'headers' => $respHeaders,
        'body' => is_string($body) ? $body : '',
        'json' => $json,
    ];
}

$db = get_db();
$hasFailure = false;
out('=== Auth Rate Limit / Lockout Smoke Test ===');
out('Timestamp: ' . date('c'));

$baseUrl = 'http://127.0.0.1/api/v1/auth.php';
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
$ipHash = hash('sha256', $clientIp);

$username = 'rl_test_' . bin2hex(random_bytes(4));
$email = $username . '@example.com';
$password = 'RateLimit!123';
$passwordHash = password_hash($password, PASSWORD_BCRYPT);

$cookieJar = [];
$userId = 0;

try {
    ensure_login_attempts_table($db);

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, protection_until)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $passwordHash]);
    $userId = (int)$db->lastInsertId();
    info('Created test user: ' . $username . ' (id=' . $userId . ')');

    $csrfResp = http_json('GET', $baseUrl . '?action=csrf', null, $cookieJar);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        $hasFailure = true;
        fail('CSRF fetch failed (status=' . $csrfResp['status'] . ')');
        throw new RuntimeException('Cannot continue without CSRF token');
    }
    pass('Fetched CSRF token via versioned endpoint');

    $maxAttempts = max(1, (int)LOGIN_MAX_ATTEMPTS);
    info('Configured LOGIN_MAX_ATTEMPTS=' . $maxAttempts . ', LOGIN_LOCKOUT_SECONDS=' . (int)LOGIN_LOCKOUT_SECONDS);

    for ($i = 1; $i <= $maxAttempts; $i++) {
        $resp = http_json('POST', $baseUrl . '?action=login', [
            'username' => $username,
            'password' => 'wrong_password_' . $i,
            'remember' => false,
        ], $cookieJar, $csrf);

        if ($resp['status'] !== 401) {
            $hasFailure = true;
            fail('Attempt #' . $i . ' expected 401, got ' . $resp['status']);
            break;
        }
    }
    if (!$hasFailure) {
        pass('First ' . $maxAttempts . ' failed logins returned HTTP 401');
    }

    $lockedResp = http_json('POST', $baseUrl . '?action=login', [
        'username' => $username,
        'password' => 'still_wrong',
        'remember' => false,
    ], $cookieJar, $csrf);

    if ($lockedResp['status'] !== 429) {
        $hasFailure = true;
        fail('Expected lockout HTTP 429 after threshold, got ' . $lockedResp['status']);
    } else {
        pass('Lockout enforced with HTTP 429 after threshold exceeded');
    }

    $row = $db->prepare('SELECT attempt_count, locked_until FROM login_attempts WHERE ip_hash = ? LIMIT 1');
    $row->execute([$ipHash]);
    $attempt = $row->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        $hasFailure = true;
        fail('No login_attempts row found for client IP hash');
    } elseif ((int)$attempt['attempt_count'] < $maxAttempts) {
        $hasFailure = true;
        fail('attempt_count too low: ' . (int)$attempt['attempt_count']);
    } elseif (empty($attempt['locked_until'])) {
        $hasFailure = true;
        fail('locked_until is empty after lockout threshold');
    } else {
        pass('DB lockout state persisted in login_attempts');
    }

    // Clear lock row, then verify successful login clears state.
    $db->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);

    $okResp = http_json('POST', $baseUrl . '?action=login', [
        'username' => $username,
        'password' => $password,
        'remember' => false,
    ], $cookieJar, $csrf);

    if ($okResp['status'] !== 200 || ($okResp['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('Valid login failed after clearing lock row (status=' . $okResp['status'] . ')');
    } else {
        pass('Valid login succeeds (HTTP 200)');
    }

    $checkClear = $db->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ?');
    $checkClear->execute([$ipHash]);
    if ((int)$checkClear->fetchColumn() !== 0) {
        $hasFailure = true;
        fail('login_attempts row not cleared after successful login');
    } else {
        pass('login_attempts row cleared after successful login');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    if ($userId > 0) {
        try {
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$userId]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
        } catch (Throwable $cleanupErr) {
            info('Cleanup warning: ' . $cleanupErr->getMessage());
        }
    }
    try {
        $db->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);
    } catch (Throwable $cleanupErr) {
        info('Cleanup warning: ' . $cleanupErr->getMessage());
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
