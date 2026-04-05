<?php

declare(strict_types=1);

/**
 * NPC battle diplomacy smoke test.
 *
 * Verifies that attacking an npc_engine colony applies diplomacy penalty
 * to the corresponding faction and increments attacks_against.
 *
 * Run inside web container:
 *   php scripts/test_npc_battle_diplomacy_smoke.php
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
            'timeout' => 15,
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

function table_exists(PDO $db, string $name): bool {
    $st = $db->prepare(
        'SELECT 1 FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1'
    );
    $st->execute([$name]);
    return (bool)$st->fetchColumn();
}

function column_exists(PDO $db, string $table, string $column): bool {
    $st = $db->prepare(
        'SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1'
    );
    $st->execute([$table, $column]);
    return (bool)$st->fetchColumn();
}

function map_npc_to_faction(PDO $db, int $npcUserId, int $npcColonyId, int $factionId): bool {
    if (table_exists($db, 'npc_traders')) {
        $attempts = [
            [
                'sql' => 'INSERT INTO npc_traders
                          (faction_id, name, user_id, base_colony_id, capital_credits, strategy, max_fleets, active_fleets, total_profit)
                          VALUES (?, ?, ?, ?, 50000, "profit_max", 1, 0, 0)',
                'args' => [$factionId, 'bt_npc_trader_' . $npcUserId, $npcUserId, $npcColonyId],
            ],
            [
                'sql' => 'INSERT INTO npc_traders
                          (faction_id, name, user_id, capital_credits, strategy)
                          VALUES (?, ?, ?, 50000, "profit_max")',
                'args' => [$factionId, 'bt_npc_trader_' . $npcUserId, $npcUserId],
            ],
            [
                'sql' => 'INSERT INTO npc_traders (faction_id, name, user_id) VALUES (?, ?, ?)',
                'args' => [$factionId, 'bt_npc_trader_' . $npcUserId, $npcUserId],
            ],
        ];

        foreach ($attempts as $try) {
            try {
                $db->prepare($try['sql'])->execute($try['args']);
                return true;
            } catch (Throwable) {
                // Try next insert variant.
            }
        }
    }

    if (table_exists($db, 'faction_colonies')) {
        $attempts = [
            [
                'sql' => 'INSERT INTO faction_colonies (faction_id, colony_id) VALUES (?, ?)',
                'args' => [$factionId, $npcColonyId],
            ],
            [
                'sql' => 'INSERT INTO faction_colonies (faction_id, colony_id, user_id) VALUES (?, ?, ?)',
                'args' => [$factionId, $npcColonyId, $npcUserId],
            ],
        ];
        foreach ($attempts as $try) {
            try {
                $db->prepare($try['sql'])->execute($try['args']);
                return true;
            } catch (Throwable) {
                // Try next insert variant.
            }
        }
    }

    if (column_exists($db, 'users', 'faction_id')) {
        $db->prepare('UPDATE users SET faction_id = ? WHERE id = ?')->execute([$factionId, $npcUserId]);
        return true;
    }

    return false;
}

$db = get_db();
$hasFailure = false;
out('=== NPC Battle Diplomacy Smoke Test ===');
out('Timestamp: ' . date('c'));

$attackerId = 0;
$defenderId = 0;
$attackerBodyId = 0;
$defenderBodyId = 0;
$attackerColonyId = 0;
$defenderColonyId = 0;
$fleetId = 0;
$factionId = 0;

$cookies = [];

$authBase = 'http://127.0.0.1/api/v1/auth.php';
$fleetUrl = 'http://127.0.0.1/api/v1/fleet.php';

$atkUser = 'bt_atk_' . bin2hex(random_bytes(4));
$atkMail = $atkUser . '@example.com';
$atkPass = 'BattleDipl!123';
$npcUser = 'bt_npc_' . bin2hex(random_bytes(4));
$npcMail = $npcUser . '@example.com';

try {
    $atkHash = password_hash($atkPass, PASSWORD_BCRYPT);
    $npcHash = password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT);

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, control_type, auth_enabled)
         VALUES (?, ?, ?, "human", 1)'
    )->execute([$atkUser, $atkMail, $atkHash]);
    $attackerId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO users (username, email, password_hash, control_type, auth_enabled)
         VALUES (?, ?, ?, "npc_engine", 0)'
    )->execute([$npcUser, $npcMail, $npcHash]);
    $defenderId = (int)$db->lastInsertId();

    $galaxy = 1;
    $system = random_int(200, 899);
    $atkPos = random_int(41, 49);
    $defPos = random_int(51, 59);

    $atkBodyUid = 'bt-body-atk-' . $attackerId . '-' . time();
    $defBodyUid = 'bt-body-npc-' . $defenderId . '-' . time();

    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize)
         VALUES (?, ?, ?, ?, "planet", "star", ?, 1)'
    )->execute([$atkBodyUid, $galaxy, $system, $atkPos, 'BT Attacker Planet']);
    $attackerBodyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO celestial_bodies
            (body_uid, galaxy_index, system_index, position, body_type, parent_body_type, name, can_colonize)
         VALUES (?, ?, ?, ?, "planet", "star", ?, 1)'
    )->execute([$defBodyUid, $galaxy, $system, $defPos, 'BT NPC Planet']);
    $defenderBodyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO colonies (body_id, user_id, name, is_homeworld, metal, crystal, deuterium, colony_type)
         VALUES (?, ?, "BT Attacker Colony", 1, 10000, 10000, 10000, "military")'
    )->execute([$attackerBodyId, $attackerId]);
    $attackerColonyId = (int)$db->lastInsertId();

    $db->prepare(
        'INSERT INTO colonies (body_id, user_id, name, is_homeworld, metal, crystal, deuterium, colony_type)
         VALUES (?, ?, "BT NPC Colony", 1, 10000, 10000, 10000, "balanced")'
    )->execute([$defenderBodyId, $defenderId]);
    $defenderColonyId = (int)$db->lastInsertId();

    $db->prepare('INSERT INTO ships (colony_id, type, count) VALUES (?, "light_fighter", 3)')
       ->execute([$attackerColonyId]);

    $facStmt = $db->prepare('SELECT id FROM npc_factions WHERE code = ? LIMIT 1');
    $facStmt->execute(['pirates']);
    $factionId = (int)($facStmt->fetchColumn() ?: 0);
    if ($factionId <= 0) {
        throw new RuntimeException('Missing pirates faction seed.');
    }

    if (!map_npc_to_faction($db, $defenderId, $defenderColonyId, $factionId)) {
        throw new RuntimeException('Could not map NPC user to a faction (no compatible schema path).');
    }

    $db->prepare(
        'INSERT INTO diplomacy (user_id, faction_id, standing, attacks_against)
         VALUES (?, ?, 10, 0)
         ON DUPLICATE KEY UPDATE standing = VALUES(standing), attacks_against = VALUES(attacks_against)'
    )->execute([$attackerId, $factionId]);

    $departure = date('Y-m-d H:i:s', time() - 180);
    $arrival = date('Y-m-d H:i:s', time() - 60);

    $db->prepare(
        'INSERT INTO fleets
            (user_id, origin_colony_id, target_galaxy, target_system, target_position,
             mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium,
             departure_time, arrival_time, return_time, returning)
         VALUES (?, ?, ?, ?, ?, "attack", ?, 0, 0, 0, ?, ?, NULL, 0)'
    )->execute([
        $attackerId,
        $attackerColonyId,
        $galaxy,
        $system,
        $defPos,
        json_encode(['light_fighter' => 1]),
        $departure,
        $arrival,
    ]);
    $fleetId = (int)$db->lastInsertId();

    $csrfResp = http_json('GET', $authBase . '?action=csrf', null, $cookies);
    $csrf = (string)($csrfResp['json']['token'] ?? '');
    if ($csrfResp['status'] !== 200 || $csrf === '') {
        throw new RuntimeException('Failed to fetch CSRF token.');
    }

    $loginResp = http_json('POST', $authBase . '?action=login', [
        'username' => $atkUser,
        'password' => $atkPass,
        'remember' => false,
    ], $cookies, $csrf);
    if ($loginResp['status'] !== 200 || (bool)($loginResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('Login failed for attacker user.');
    }

    $checkResp = http_json('GET', $fleetUrl . '?action=check', null, $cookies);
    if ($checkResp['status'] !== 200 || (bool)($checkResp['json']['success'] ?? false) !== true) {
        throw new RuntimeException('fleet.php?action=check failed: HTTP ' . $checkResp['status']);
    }

    $dip = $db->prepare('SELECT standing, attacks_against FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1');
    $dip->execute([$attackerId, $factionId]);
    $dipRow = $dip->fetch(PDO::FETCH_ASSOC) ?: [];

    $standing = (int)($dipRow['standing'] ?? 0);
    $attacks = (int)($dipRow['attacks_against'] ?? 0);

    if ($standing === 5) {
        pass('Diplomacy standing reduced by -5 after NPC colony attack');
    } else {
        fail('Unexpected standing value: expected 5, got ' . $standing);
        $hasFailure = true;
    }

    if ($attacks >= 1) {
        pass('attacks_against counter incremented');
    } else {
        fail('attacks_against was not incremented');
        $hasFailure = true;
    }
} catch (Throwable $e) {
    fail('Test aborted: ' . $e->getMessage());
    $hasFailure = true;
} finally {
    try {
        if ($fleetId > 0) {
            $db->prepare('DELETE FROM fleets WHERE id = ?')->execute([$fleetId]);
        }
        if ($attackerId > 0 && $factionId > 0) {
            $db->prepare('DELETE FROM diplomacy WHERE user_id = ? AND faction_id = ?')->execute([$attackerId, $factionId]);
        }

        if ($defenderColonyId > 0 && table_exists($db, 'faction_colonies')) {
            try {
                $db->prepare('DELETE FROM faction_colonies WHERE colony_id = ?')->execute([$defenderColonyId]);
            } catch (Throwable) {
                // Ignore cleanup issues for optional schema variants.
            }
        }
        if ($defenderId > 0 && table_exists($db, 'npc_traders')) {
            try {
                $db->prepare('DELETE FROM npc_traders WHERE user_id = ?')->execute([$defenderId]);
            } catch (Throwable) {
                // Ignore cleanup issues for optional schema variants.
            }
        }

        if ($attackerId > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$attackerId]);
        }
        if ($defenderId > 0) {
            $db->prepare('DELETE FROM users WHERE id = ?')->execute([$defenderId]);
        }

        if ($attackerBodyId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$attackerBodyId]);
        }
        if ($defenderBodyId > 0) {
            $db->prepare('DELETE FROM celestial_bodies WHERE id = ?')->execute([$defenderBodyId]);
        }
    } catch (Throwable) {
        // Best-effort cleanup.
    }
}

if ($hasFailure) {
    out('RESULT: FAIL');
    exit(1);
}

out('RESULT: PASS');
exit(0);
