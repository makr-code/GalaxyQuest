<?php

declare(strict_types=1);

/**
 * War attrition goal smoke test.
 *
 * Verifies:
 * - attrition goals increase score when enemy exhaustion is higher
 * - get_status exposes enriched goal progress payload for attrition
 *
 * Run inside web container:
 *   php scripts/test_war_attrition_goal_smoke.php
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';

function out(string $line = ''): void { echo $line . PHP_EOL; }
function pass(string $label): void { out('[PASS] ' . $label); }
function fail(string $label): void { out('[FAIL] ' . $label); }

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
    if ($cookie !== '') $headers[] = 'Cookie: ' . $cookie;
    if ($csrf !== null && $csrf !== '') $headers[] = 'X-CSRF-Token: ' . $csrf;

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
        if (is_array($decoded)) $json = $decoded;
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
    $password = 'WarAttr!123';
    $hash = password_hash($password, PASSWORD_BCRYPT);

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, control_type, auth_enabled)
         VALUES (?, ?, ?, "human", 1)'
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
out('=== War Attrition Goal Smoke Test ===');
out('Timestamp: ' . date('c'));

$attUid = 0;
$defUid = 0;
$warId = 0;
$prevTick = 0;
$remAttKey = null;
$prevRemAtt = 0;

try {
    ensure_app_state_table($db);
    $prevTick = app_state_get_int($db, 'war_runtime:last_tick', 0);

    $att = create_and_login_user($db, 'war_attr_att');
    $def = create_and_login_user($db, 'war_attr_def');
    $attUid = (int)$att['uid'];
    $defUid = (int)$def['uid'];

    $db->prepare(
        'INSERT INTO wars
            (attacker_user_id, defender_user_id, status, war_score_att, war_score_def, exhaustion_att, exhaustion_def, casus_belli)
         VALUES (?, ?, "active", 0, 0, 0, 90, "attrition_smoke")'
    )->execute([$attUid, $defUid]);
    $warId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO war_goals (war_id, side, goal_type, target_id, target_value, score_value)
         VALUES (?, "attacker", "attrition", NULL, NULL, 15)'
    )->execute([$warId]);

    app_state_set_int($db, 'war_runtime:last_tick', time() - 86400);
    $remAttKey = 'war_goal:rem_milli:' . $warId . ':att';
    $prevRemAtt = app_state_get_int($db, $remAttKey, 0);

    $runtime = process_war_runtime_tick($db, true);
    if (($runtime['processed'] ?? false) !== true) {
        throw new RuntimeException('war runtime tick did not process');
    }
    pass('war runtime tick executed');

    $rowStmt = $db->prepare('SELECT war_score_att FROM wars WHERE id = ? LIMIT 1');
    $rowStmt->execute([$warId]);
    $warScoreAtt = (int)$rowStmt->fetchColumn();
    if ($warScoreAtt <= 0) {
        $hasFailure = true;
        fail('attrition goal did not increase attacker war_score');
    } else {
        pass('attrition goal increased attacker war_score');
    }

    $status = http_json('GET', 'http://127.0.0.1/api/war.php?action=get_status&war_id=' . $warId, null, $att['cookies']);
    if ($status['status'] !== 200 || ($status['json']['success'] ?? false) !== true) {
        throw new RuntimeException('get_status failed: ' . $status['body']);
    }
    $goals = $status['json']['goals'] ?? [];
    if (!is_array($goals) || count($goals) < 1) {
        throw new RuntimeException('get_status returned no goals');
    }

    $goal = $goals[0];
    $progress = $goal['progress'] ?? null;
    if (!is_array($progress)) {
        $hasFailure = true;
        fail('attrition goal missing progress payload');
    } else {
        if (($progress['status'] ?? '') !== 'advantage') {
            $hasFailure = true;
            fail('attrition progress status expected advantage');
        } else {
            pass('attrition progress status is advantage');
        }

        if ((float)($progress['score_rate_per_day'] ?? 0.0) <= 0.0) {
            $hasFailure = true;
            fail('attrition progress score_rate_per_day should be > 0');
        } else {
            pass('attrition progress exposes positive score_rate_per_day');
        }

        if ((float)($progress['current_value'] ?? 0.0) <= 0.0) {
            $hasFailure = true;
            fail('attrition progress current_value should reflect exhaustion gap');
        } else {
            pass('attrition progress current_value reflects exhaustion gap');
        }
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        if ($remAttKey !== null) {
            app_state_set_int($db, $remAttKey, $prevRemAtt);
        }
        app_state_set_int($db, 'war_runtime:last_tick', $prevTick);
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

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
        if ($attUid > 0) $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attUid]);
        if ($defUid > 0) $db->prepare('DELETE FROM users WHERE id = ?')->execute([$defUid]);
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
