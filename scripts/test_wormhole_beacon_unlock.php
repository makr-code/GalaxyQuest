<?php

declare(strict_types=1);

/**
 * Wormhole beacon unlock integration smoke test.
 *
 * Verifies:
 * 1) Permanent beacon routes are locked before quest claim.
 * 2) Claiming precursor_wormhole_beacon grants unlock.
 * 3) Permanent beacon routes become available afterward.
 *
 * Run inside web container:
 *   php scripts/test_wormhole_beacon_unlock.php
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
            'timeout' => 12,
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

function find_wormhole(array $wormholes, bool $permanent): ?array {
    foreach ($wormholes as $w) {
        if ((bool)($w['is_permanent'] ?? false) === $permanent) {
            return $w;
        }
    }
    return null;
}

$db = get_db();
$hasFailure = false;
out('=== Wormhole Beacon Unlock Smoke Test ===');
out('Timestamp: ' . date('c'));

$testUser = 'wh_beacon_' . bin2hex(random_bytes(4));
$testMail = $testUser . '@example.com';
$testPass = 'BeaconUnlock!123';
$uid = 0;
$planetId = 0;
$colonyId = 0;

$tempNormalLabel = 'Test Non-Permanent Route';
$tempPermLabel = 'Test Permanent Route';
$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$fleetUrl = 'http://127.0.0.1/api/v1/fleet.php';
$factionsUrl = 'http://127.0.0.1/api/v1/factions.php';

try {
    // Ensure unlock table exists for both old/new DBs.
    $db->exec(
        'CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
            user_id INT NOT NULL PRIMARY KEY,
            source_quest_code VARCHAR(64) DEFAULT NULL,
            unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB'
    );
    $colCheck = $db->query(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'wormholes'
           AND COLUMN_NAME = 'is_permanent'"
    );
    $hasPermanentCol = (int)($colCheck ? $colCheck->fetchColumn() : 0) > 0;
    if (!$hasPermanentCol) {
        $db->exec('ALTER TABLE wormholes ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
    }

    // Create test user and a colony exactly on system 1:120 (wormhole endpoint).
    $hash = password_hash($testPass, PASSWORD_BCRYPT);
    $db->prepare(
        'INSERT INTO users (username, email, password_hash, protection_until)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))'
    )->execute([$testUser, $testMail, $hash]);
    $uid = (int)$db->lastInsertId();

    $pos = 90 + random_int(1, 9);
    $db->prepare(
        'INSERT INTO planets (galaxy, `system`, position, type, planet_class, diameter, temp_min, temp_max)
         VALUES (1, 120, ?, "terrestrial", "rocky", 11000, -20, 40)'
    )->execute([$pos]);
    $planetId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO colonies (planet_id, user_id, name, is_homeworld)
         VALUES (?, ?, "Beacon Test Colony", 1)'
    )->execute([$planetId, $uid]);
    $colonyId = (int)$db->lastInsertId();

    $db->prepare('INSERT INTO research (user_id, type, level) VALUES (?, "wormhole_theory", 5) ON DUPLICATE KEY UPDATE level=VALUES(level)')
       ->execute([$uid]);

    $precursorFactionId = (int)$db->query("SELECT id FROM npc_factions WHERE code='precursors' LIMIT 1")->fetchColumn();
    if ($precursorFactionId <= 0) {
        throw new RuntimeException('Missing precursor faction seed.');
    }

    $db->prepare(
        'INSERT IGNORE INTO faction_quests
            (faction_id, code, title, description, quest_type, requirements_json,
             reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
             reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $precursorFactionId,
        'precursor_wormhole_beacon',
        'Unlock the Ancient Beacon',
        'Decode precursor harmonics and stabilize an ancient beacon lattice to unlock permanent wormhole corridors.',
        'research',
        '{"tech":"wormhole_theory","level":5}',
        15000,
        12000,
        9000,
        0,
        500,
        180,
        18,
        80,
        'epic',
        0,
    ]);

    $db->prepare(
        'INSERT INTO diplomacy (user_id, faction_id, standing)
         VALUES (?, ?, 100)
         ON DUPLICATE KEY UPDATE standing=VALUES(standing)'
    )->execute([$uid, $precursorFactionId]);

    // Temporary deterministic routes for assertions.
    $db->prepare('DELETE FROM wormholes WHERE label IN (?, ?)')->execute([$tempNormalLabel, $tempPermLabel]);
    $db->prepare(
        'INSERT INTO wormholes
            (endpoint_a_galaxy, endpoint_a_system, endpoint_b_galaxy, endpoint_b_system,
             stability, cooldown_until, is_active, is_permanent, label)
         VALUES (1,120,1,121,100,NULL,1,0,?)'
    )->execute([$tempNormalLabel]);
    $db->prepare(
        'INSERT INTO wormholes
            (endpoint_a_galaxy, endpoint_a_system, endpoint_b_galaxy, endpoint_b_system,
             stability, cooldown_until, is_active, is_permanent, label)
         VALUES (1,120,1,260,100,NULL,1,1,?)'
    )->execute([$tempPermLabel]);

    // Auth bootstrap.
    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        throw new RuntimeException('Failed to fetch CSRF token.');
    }

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $testUser,
        'password' => $testPass,
        'remember' => false,
    ], $cookies, $csrf);
    if ($loginResp['status'] !== 200 || ($loginResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Login failed for test user.');
    }

    // Refresh CSRF after login/session state changes.
    $csrfAfterLogin = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfAfterLogin['json']['token'] ?? $csrf);

    // Before claim: permanent should be locked, normal should be available.
    $beforeResp = http_json('GET', $fleetUrl . '?action=wormholes&origin_colony_id=' . $colonyId, null, $cookies);
    if ($beforeResp['status'] !== 200 || ($beforeResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Wormhole listing failed before claim.');
    }
    $beforeWormholes = $beforeResp['json']['wormholes'] ?? [];
    $beforePerm = null;
    $beforeNormal = null;
    foreach ($beforeWormholes as $w) {
        if (($w['label'] ?? '') === $tempPermLabel) $beforePerm = $w;
        if (($w['label'] ?? '') === $tempNormalLabel) $beforeNormal = $w;
    }

    if (!$beforePerm || ($beforePerm['unlocked'] ?? true) || ($beforePerm['available'] ?? true)) {
        $hasFailure = true;
        fail('Permanent route should be locked/unavailable before claim.');
    } else {
        pass('Permanent route is locked before claim.');
    }

    if (!$beforeNormal || !($beforeNormal['available'] ?? false)) {
        $hasFailure = true;
        fail('Non-permanent route should be available before claim.');
    } else {
        pass('Non-permanent route is available before claim.');
    }

    $questId = (int)$db->query("SELECT id FROM faction_quests WHERE code='precursor_wormhole_beacon' LIMIT 1")->fetchColumn();
    if ($questId <= 0) {
        throw new RuntimeException('Missing precursor_wormhole_beacon quest seed.');
    }

    $startResp = http_json('POST', $factionsUrl . '?action=start_quest', ['faction_quest_id' => $questId], $cookies, $csrf);
    if ($startResp['status'] !== 200 || ($startResp['json']['success'] ?? false) !== true) {
        $err = (string)($startResp['json']['error'] ?? 'unknown error');
        throw new RuntimeException('Failed to start beacon quest: HTTP ' . $startResp['status'] . ' - ' . $err);
    }

    $checkResp = http_json('POST', $factionsUrl . '?action=check_quests', [], $cookies, $csrf);
    if ($checkResp['status'] !== 200 || ($checkResp['json']['success'] ?? false) !== true) {
        $err = (string)($checkResp['json']['error'] ?? 'unknown error');
        throw new RuntimeException('Failed to check quests: HTTP ' . $checkResp['status'] . ' - ' . $err);
    }

    $uqidStmt = $db->prepare(
        'SELECT id FROM user_faction_quests
         WHERE user_id = ? AND faction_quest_id = ? AND status = "completed"
         ORDER BY id DESC LIMIT 1'
    );
    $uqidStmt->execute([$uid, $questId]);
    $uqid = (int)($uqidStmt->fetchColumn() ?: 0);
    if ($uqid <= 0) {
        throw new RuntimeException('Quest did not transition to completed.');
    }

    $claimResp = http_json('POST', $factionsUrl . '?action=claim_quest', ['user_quest_id' => $uqid], $cookies, $csrf);
    if ($claimResp['status'] !== 200 || ($claimResp['json']['success'] ?? false) !== true) {
        $err = (string)($claimResp['json']['error'] ?? 'unknown error');
        throw new RuntimeException('Failed to claim beacon quest reward: HTTP ' . $claimResp['status'] . ' - ' . $err);
    }

    $unlockStmt = $db->prepare('SELECT 1 FROM user_wormhole_unlocks WHERE user_id = ? LIMIT 1');
    $unlockStmt->execute([$uid]);
    if (!(bool)$unlockStmt->fetchColumn()) {
        $hasFailure = true;
        fail('Unlock row was not created on quest claim.');
    } else {
        pass('Unlock row created after quest claim.');
    }

    $afterResp = http_json('GET', $fleetUrl . '?action=wormholes&origin_colony_id=' . $colonyId, null, $cookies);
    if ($afterResp['status'] !== 200 || ($afterResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Wormhole listing failed after claim.');
    }
    $afterPerm = null;
    foreach (($afterResp['json']['wormholes'] ?? []) as $w) {
        if (($w['label'] ?? '') === $tempPermLabel) {
            $afterPerm = $w;
            break;
        }
    }
    if (!$afterPerm || !($afterPerm['unlocked'] ?? false) || !($afterPerm['available'] ?? false)) {
        $hasFailure = true;
        fail('Permanent route should be unlocked/available after claim.');
    } else {
        pass('Permanent route is unlocked and available after claim.');
    }
} catch (Throwable $e) {
    $hasFailure = true;
    fail('Unhandled exception: ' . $e->getMessage());
} finally {
    try {
        $db->prepare('DELETE FROM wormholes WHERE label IN (?, ?)')->execute([$tempNormalLabel, $tempPermLabel]);
    } catch (Throwable $e) {}

    if ($uid > 0) {
        try {
            $db->prepare('DELETE FROM remember_tokens WHERE user_id = ?')->execute([$uid]);
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
        } catch (Throwable $e) {}
    }

    if ($planetId > 0) {
        try {
            $db->prepare('DELETE FROM planets WHERE id = ?')->execute([$planetId]);
        } catch (Throwable $e) {}
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
