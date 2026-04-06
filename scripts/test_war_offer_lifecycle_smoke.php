<?php

declare(strict_types=1);

/**
 * War peace-offer lifecycle smoke test.
 *
 * Covers:
 * - reject path (respond_peace accept=false)
 * - expiry path (expired offers get marked via get_status)
 *
 * Run inside web container:
 *   php scripts/test_war_offer_lifecycle_smoke.php
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
            'timeout' => 20,
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

/** @return array{uid:int,cookies:array,csrf:string} */
function create_and_login_user(PDO $db, string $prefix): array {
    $username = $prefix . '_' . bin2hex(random_bytes(4));
    $email = $username . '@example.com';
    $password = 'WarOffer!123';
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, control_type, auth_enabled, protection_until)
         VALUES (?, ?, ?, "human", 1, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$username, $email, $hash]);
    $uid = (int)$db->lastInsertId();

    $cookies = [];
    $authBase = 'http://127.0.0.1/api/v1/auth.php';
    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        throw new RuntimeException('Failed CSRF for ' . $username);
    }

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $username,
        'password' => $password,
        'remember' => false,
    ], $cookies, $csrf);
    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Login failed for ' . $username);
    }

    return ['uid' => $uid, 'cookies' => $cookies, 'csrf' => $csrf];
}

$db = get_db();
$hasFailure = false;

out('=== War Offer Lifecycle Smoke Test ===');
out('Timestamp: ' . date('c'));

$attUid = 0;
$defUid = 0;
$warId = 0;
$offerReject = 0;
$offerExpire = 0;

try {
    $att = create_and_login_user($db, 'war_offer_att');
    $def = create_and_login_user($db, 'war_offer_def');
    $attUid = (int)$att['uid'];
    $defUid = (int)$def['uid'];

    $base = 'http://127.0.0.1/api/war.php';

    $declare = http_json('POST', $base . '?action=declare', [
        'target_user_id' => $defUid,
        'casus_belli' => 'offer_lifecycle_test',
    ], $att['cookies'], $att['csrf']);
    if ($declare['status'] !== 200 || ($declare['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Declare failed: ' . $declare['body']);
    }
    $warId = (int)($declare['json']['war_id'] ?? 0);
    if ($warId <= 0) {
        throw new RuntimeException('Declare returned invalid war_id');
    }
    pass('declare works');

    $offer1 = http_json('POST', $base . '?action=offer_peace', [
        'war_id' => $warId,
        'terms' => [['type' => 'white_peace']],
    ], $att['cookies'], $att['csrf']);
    if ($offer1['status'] !== 200 || ($offer1['json']['success'] ?? false) !== true) {
        throw new RuntimeException('offer_peace #1 failed: ' . $offer1['body']);
    }
    $offerReject = (int)($offer1['json']['offer_id'] ?? 0);
    if ($offerReject <= 0) {
        throw new RuntimeException('offer_peace #1 missing offer_id');
    }

    $reject = http_json('POST', $base . '?action=respond_peace', [
        'offer_id' => $offerReject,
        'accept' => false,
    ], $def['cookies'], $def['csrf']);
    if ($reject['status'] !== 200 || ($reject['json']['success'] ?? false) !== true) {
        throw new RuntimeException('respond_peace reject failed: ' . $reject['body']);
    }
    if (($reject['json']['war_status'] ?? '') !== 'active' || ($reject['json']['new_state'] ?? '') !== 'offer_rejected') {
        throw new RuntimeException('reject response did not keep war active');
    }
    pass('respond_peace reject keeps war active');

    $offer2 = http_json('POST', $base . '?action=offer_peace', [
        'war_id' => $warId,
        'terms' => [['type' => 'white_peace']],
    ], $att['cookies'], $att['csrf']);
    if ($offer2['status'] !== 200 || ($offer2['json']['success'] ?? false) !== true) {
        throw new RuntimeException('offer_peace #2 failed: ' . $offer2['body']);
    }
    $offerExpire = (int)($offer2['json']['offer_id'] ?? 0);
    if ($offerExpire <= 0) {
        throw new RuntimeException('offer_peace #2 missing offer_id');
    }

    // Force expiry in DB, then trigger status maintenance path.
    $db->prepare('UPDATE peace_offers SET expires_at = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE id = ?')
       ->execute([$offerExpire]);

    $status = http_json('GET', $base . '?action=get_status&war_id=' . $warId, null, $att['cookies']);
    if ($status['status'] !== 200 || ($status['json']['success'] ?? false) !== true) {
        throw new RuntimeException('get_status failed: ' . $status['body']);
    }

    $offers = $status['json']['peace_offers'] ?? [];
    if (!is_array($offers)) {
        throw new RuntimeException('get_status missing peace_offers[]');
    }

    $seenRejected = false;
    $seenExpired = false;
    foreach ($offers as $o) {
        $id = (int)($o['id'] ?? 0);
        $st = (string)($o['status'] ?? '');
        if ($id === $offerReject && $st === 'rejected') {
            $seenRejected = true;
        }
        if ($id === $offerExpire && $st === 'expired') {
            $seenExpired = true;
        }
    }

    if (!$seenRejected) {
        $hasFailure = true;
        fail('rejected offer not reflected in get_status');
    } else {
        pass('get_status contains rejected offer');
    }

    if (!$seenExpired) {
        $hasFailure = true;
        fail('expired offer not reflected in get_status');
    } else {
        pass('get_status contains expired offer');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($warId > 0) {
            $db->prepare('DELETE FROM peace_offers WHERE war_id = ?')->execute([$warId]);
            $db->prepare('DELETE FROM war_goals WHERE war_id = ?')->execute([$warId]);
            $db->prepare('DELETE FROM wars WHERE id = ?')->execute([$warId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($attUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($defUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$defUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
