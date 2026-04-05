<?php

declare(strict_types=1);

/**
 * War runtime forced-peace smoke test.
 *
 * Verifies that the overview-triggered runtime tick applies passive exhaustion
 * and ends wars automatically at forced-peace threshold.
 *
 * Run inside web container:
 *   php scripts/test_war_forced_peace_tick_smoke.php
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';

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
function http_json(string $method, string $url, ?array $payload, array &$cookies, ?string $csrf = null, int $timeoutSeconds = 20): array {
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
            'timeout' => max(10, $timeoutSeconds),
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

function table_exists(PDO $db, string $table): bool {
    $st = $db->prepare(
        'SELECT 1
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         LIMIT 1'
    );
    $st->execute([$table]);
    return (bool)$st->fetchColumn();
}

/** @return array{uid:int,cookies:array,csrf:string} */
function create_and_login_user(PDO $db, string $prefix): array {
    $username = $prefix . '_' . bin2hex(random_bytes(4));
    $email = $username . '@example.com';
    $password = 'WarTick!123';
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
        throw new RuntimeException('Failed to fetch CSRF token for ' . $username);
    }

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $username,
        'password' => $password,
        'remember' => false,
    ], $cookies, $csrf);

    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Login failed for ' . $username . ' (status=' . $loginResp['status'] . ')');
    }

    return [
        'uid' => $uid,
        'cookies' => $cookies,
        'csrf' => $csrf,
    ];
}

$db = get_db();
$hasFailure = false;

out('=== War Forced Peace Tick Smoke Test ===');
out('Timestamp: ' . date('c'));

$attackerUid = 0;
$defenderUid = 0;
$warId = 0;
$stateKey = 'war_runtime:last_tick';
$previousTick = null;

try {
    foreach (['wars', 'war_goals', 'peace_offers'] as $table) {
        if (!table_exists($db, $table)) {
            throw new RuntimeException('War schema missing. Run sql/migrate_combat_v1_wars.sql first.');
        }
    }

    ensure_app_state_table($db);
    $previousTick = app_state_get_int($db, $stateKey, 0);

    $attacker = create_and_login_user($db, 'wartick_att');
    $defender = create_and_login_user($db, 'wartick_def');
    $attackerUid = (int)$attacker['uid'];
    $defenderUid = (int)$defender['uid'];

    $db->prepare(
        'INSERT INTO wars
            (attacker_user_id, defender_user_id, status, war_score_att, war_score_def, exhaustion_att, exhaustion_def, casus_belli)
         VALUES (?, ?, "active", 0, 0, 99.7, 1.0, "smoke_test")'
    )->execute([$attackerUid, $defenderUid]);
    $warId = (int)$db->lastInsertId();

    // Make runtime tick think one day elapsed.
    app_state_set_int($db, $stateKey, time() - 86400);

    $runtime = process_war_runtime_tick($db, true);
    if (($runtime['processed'] ?? false) !== true) {
        $hasFailure = true;
        fail('war runtime tick did not process');
        throw new RuntimeException('War runtime tick failed to process.');
    }
    pass('war runtime tick executed');

    $warRowStmt = $db->prepare('SELECT status, ended_reason, exhaustion_att FROM wars WHERE id = ? LIMIT 1');
    $warRowStmt->execute([$warId]);
    $war = $warRowStmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($war)) {
        $hasFailure = true;
        fail('war row missing after tick');
    } else {
        if (($war['status'] ?? '') !== 'ended') {
            $hasFailure = true;
            fail('war was not ended by forced peace tick');
        } elseif (($war['ended_reason'] ?? '') !== 'forced_peace_exhaustion') {
            $hasFailure = true;
            fail('unexpected ended_reason: ' . (string)($war['ended_reason'] ?? 'null'));
        } else {
            pass('forced peace ended the war at exhaustion threshold');
        }

        if ((float)($war['exhaustion_att'] ?? 0.0) < 100.0) {
            $hasFailure = true;
            fail('exhaustion_att did not reach forced-peace threshold');
        } else {
            pass('passive exhaustion delta was applied');
        }
    }

    if ((int)($runtime['forced_peace'] ?? 0) < 1) {
        $hasFailure = true;
        fail('runtime diagnostics expected forced_peace >= 1');
    } else {
        pass('runtime diagnostics show forced peace transition');
    }

    if (!array_key_exists('goal_score_delta_att', $runtime) || !array_key_exists('goal_score_delta_def', $runtime)) {
        $hasFailure = true;
        fail('runtime diagnostics missing goal score delta fields');
    } else {
        pass('runtime diagnostics include goal score delta fields');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($warId > 0) {
            $db->prepare('DELETE FROM war_goals WHERE war_id = ?')->execute([$warId]);
            $db->prepare('DELETE FROM peace_offers WHERE war_id = ?')->execute([$warId]);
            $db->prepare('DELETE FROM wars WHERE id = ?')->execute([$warId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($attackerUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attackerUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($defenderUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$defenderUid]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($previousTick !== null) {
            app_state_set_int($db, $stateKey, (int)$previousTick);
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
