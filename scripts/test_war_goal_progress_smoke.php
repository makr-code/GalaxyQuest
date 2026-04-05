<?php

declare(strict_types=1);

/**
 * War goal progress smoke test.
 *
 * Verifies that annex_system goals increase war_score during runtime tick when
 * the goal-owning side controls the target system.
 *
 * Run inside web container:
 *   php scripts/test_war_goal_progress_smoke.php
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/galaxy_seed.php';
require_once __DIR__ . '/../api/game_engine.php';

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
    $headers = ['Accept: application/json', 'Content-Type: application/json'];
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
    if ($payload !== null) $opts['http']['content'] = json_encode($payload);

    $ctx = stream_context_create($opts);
    $body = @file_get_contents($url, false, $ctx);
    $respHeaders = $http_response_header ?? [];
    $cookies = array_merge($cookies, parse_cookies($respHeaders));
    $json = [];
    if (is_string($body) && $body !== '') {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) $json = $decoded;
    }

    return ['status' => parse_status($respHeaders), 'json' => $json, 'body' => is_string($body) ? $body : ''];
}

/** @return array{uid:int,cookies:array,csrf:string} */
function create_and_login_user(PDO $db, string $prefix, string $password): array {
    $username = $prefix . '_' . bin2hex(random_bytes(4));
    $email = $username . '@example.com';
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
        throw new RuntimeException('Failed CSRF/login bootstrap');
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

function out(string $line = ''): void {
    echo $line . PHP_EOL;
}

function pass(string $label): void {
    out('[PASS] ' . $label);
}

function fail(string $label): void {
    out('[FAIL] ' . $label);
}

$db = get_db();
$hasFailure = false;

out('=== War Goal Progress Smoke Test ===');
out('Timestamp: ' . date('c'));

$attUid = 0;
$defUid = 0;
$attBodyId = 0;
$defBodyId = 0;
$attColonyId = 0;
$defColonyId = 0;
$warId = 0;

$stateTickKey = 'war_runtime:last_tick';
$prevTick = 0;

$remAttKey = null;
$remDefKey = null;
$prevRemAtt = 0;
$prevRemDef = 0;
$attCookies = [];

try {
    ensure_app_state_table($db);

    $prevTick = app_state_get_int($db, $stateTickKey, 0);

    $attLogin = create_and_login_user($db, 'war_goal_att', 'WarGoal!123');
    $defLogin = create_and_login_user($db, 'war_goal_def', 'WarGoal!123');
    $attUid = (int)$attLogin['uid'];
    $defUid = (int)$defLogin['uid'];
    $attCookies = $attLogin['cookies'];

    $targetGalaxy = 2;
    $targetSystem = random_int(300, 1200);
    $attPos = random_int(4, 8);

    $attBodyUid = 'war-goal-att-' . $attUid . '-' . time();
    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize)
         VALUES (?, ?, ?, ?, "planet", "star", ?, 1)'
    )->execute([$attBodyUid, $targetGalaxy, $targetSystem, $attPos, 'War Goal Att Colony']);
    $attBodyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO colonies (body_id, user_id, name, is_homeworld, metal, crystal, deuterium, colony_type)
         VALUES (?, ?, "War Goal Att Colony", 1, 5000, 5000, 5000, "military")'
    )->execute([$attBodyId, $attUid]);
    $attColonyId = (int)$db->lastInsertId();

    // Defender has colony elsewhere, not in target system.
    $defBodyUid = 'war-goal-def-' . $defUid . '-' . time();
    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize)
         VALUES (?, ?, ?, ?, "planet", "star", ?, 1)'
    )->execute([$defBodyUid, $targetGalaxy, $targetSystem + 1, 9, 'War Goal Def Colony']);
    $defBodyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO colonies (body_id, user_id, name, is_homeworld, metal, crystal, deuterium, colony_type)
         VALUES (?, ?, "War Goal Def Colony", 1, 5000, 5000, 5000, "balanced")'
    )->execute([$defBodyId, $defUid]);
    $defColonyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO wars
            (attacker_user_id, defender_user_id, status, war_score_att, war_score_def, exhaustion_att, exhaustion_def, casus_belli)
         VALUES (?, ?, "active", 0, 0, 0, 0, "goal_progress_smoke")'
    )->execute([$attUid, $defUid]);
    $warId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO war_goals (war_id, side, goal_type, target_id, target_value, score_value)
         VALUES (?, "attacker", "annex_system", ?, ?, 20)'
    )->execute([$warId, $targetSystem, (string)$targetGalaxy]);

    // Simulate one day elapsed to produce integer score gain.
    app_state_set_int($db, $stateTickKey, time() - 86400);

    $remAttKey = 'war_goal:rem_milli:' . $warId . ':att';
    $remDefKey = 'war_goal:rem_milli:' . $warId . ':def';
    $prevRemAtt = app_state_get_int($db, $remAttKey, 0);
    $prevRemDef = app_state_get_int($db, $remDefKey, 0);

    $runtime = process_war_runtime_tick($db, true);
    if (($runtime['processed'] ?? false) !== true) {
        throw new RuntimeException('war runtime tick did not process');
    }
    pass('war runtime tick executed');

    $warRow = $db->prepare('SELECT war_score_att, war_score_def FROM wars WHERE id = ? LIMIT 1');
    $warRow->execute([$warId]);
    $war = $warRow->fetch(PDO::FETCH_ASSOC);
    if (!is_array($war)) {
        throw new RuntimeException('war row missing after tick');
    }

    $scoreAtt = (int)($war['war_score_att'] ?? 0);
    $scoreDef = (int)($war['war_score_def'] ?? 0);

    if ($scoreAtt <= 0) {
        $hasFailure = true;
        fail('attacker war_score did not increase from annex_system control');
    } else {
        pass('attacker war_score increased from annex_system control');
    }

    if ($scoreDef !== 0) {
        $hasFailure = true;
        fail('defender war_score should remain unchanged in this scenario');
    } else {
        pass('defender war_score remains unchanged');
    }

    if ((int)($runtime['goal_score_delta_att'] ?? 0) <= 0) {
        $hasFailure = true;
        fail('runtime goal_score_delta_att should be > 0');
    } else {
        pass('runtime reports positive attacker goal score delta');
    }

    if ((int)($runtime['goal_score_delta_def'] ?? 0) !== 0) {
        $hasFailure = true;
        fail('runtime goal_score_delta_def should be 0 in this scenario');
    } else {
        pass('runtime reports zero defender goal score delta');
    }

    $status = http_json('GET', 'http://127.0.0.1/api/war.php?action=get_status&war_id=' . $warId, null, $attCookies);
    if ($status['status'] !== 200 || ($status['json']['success'] ?? false) !== true) {
        $hasFailure = true;
        fail('get_status failed for annex goal progress');
    } else {
        $goals = $status['json']['goals'] ?? [];
        $progress = is_array($goals) && isset($goals[0]['progress']) && is_array($goals[0]['progress'])
            ? $goals[0]['progress']
            : null;

        if (!is_array($progress)) {
            $hasFailure = true;
            fail('annex goal missing enriched progress payload');
        } elseif (($progress['status'] ?? '') !== 'contested_controlled') {
            $hasFailure = true;
            fail('annex goal progress status expected contested_controlled');
        } else {
            pass('annex goal exposes enriched progress payload');
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
        if ($remDefKey !== null) {
            app_state_set_int($db, $remDefKey, $prevRemDef);
        }
        app_state_set_int($db, $stateTickKey, $prevTick);
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
        if ($attColonyId > 0) {
            $db->prepare('DELETE FROM colonies WHERE id = ?')->execute([$attColonyId]);
        }
        if ($defColonyId > 0) {
            $db->prepare('DELETE FROM colonies WHERE id = ?')->execute([$defColonyId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($attBodyId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$attBodyId]);
        }
        if ($defBodyId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$defBodyId]);
        }
    } catch (Throwable) {
        // Ignore cleanup failures.
    }

    try {
        if ($attUid > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attUid]);
        }
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
