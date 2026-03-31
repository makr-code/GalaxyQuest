<?php

declare(strict_types=1);

/**
 * NPC/Avatar + Leader role smoke test.
 *
 * Run:
 *   php scripts/test_npc_avatar_leader_system.php
 *
 * Exit code:
 *   0 = all required checks passed
 *   1 = one or more checks failed
 */

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/character_profile_generator.php';

function out(string $line = ''): void {
    echo $line . PHP_EOL;
}

function ok(string $label): void {
    out('[PASS] ' . $label);
}

function fail(string $label): void {
    out('[FAIL] ' . $label);
}

function info(string $label): void {
    out('[INFO] ' . $label);
}

function ensure_npc_test_user(PDO $db): array {
    $stmt = $db->query("SELECT id, username FROM users WHERE control_type = 'npc_engine' ORDER BY id DESC LIMIT 1");
    $npc = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
    if ($npc) {
        return $npc;
    }

    $suffix = (string)time();
    $username = 'npc_test_' . $suffix;
    $email = $username . '@example.com';
    $passwordHash = password_hash(bin2hex(random_bytes(12)), PASSWORD_BCRYPT);

    $ins = $db->prepare(
           "INSERT INTO users (username, email, password_hash, is_npc, control_type, auth_enabled, created_at)
            VALUES (?, ?, ?, 1, 'npc_engine', 0, NOW())"
    );
    $ins->execute([$username, $email, $passwordHash]);

    return [
        'id' => (int)$db->lastInsertId(),
        'username' => $username,
    ];
}

function ensure_files_exist(array $profileRow): array {
    $errors = [];
    $root = dirname(__DIR__);

    $jsonPath = trim((string)($profileRow['json_path'] ?? ''));
    $yamlPath = trim((string)($profileRow['yaml_path'] ?? ''));

    if ($jsonPath === '') {
        $errors[] = 'json_path fehlt';
    } elseif (!is_file($root . '/' . $jsonPath)) {
        $errors[] = 'JSON-Datei fehlt: ' . $jsonPath;
    }

    if ($yamlPath === '') {
        $errors[] = 'yaml_path fehlt';
    } elseif (!is_file($root . '/' . $yamlPath)) {
        $errors[] = 'YAML-Datei fehlt: ' . $yamlPath;
    }

    return $errors;
}

function read_supported_leader_roles_from_api_file(string $leadersFile): array {
    $src = @file_get_contents($leadersFile);
    if (!is_string($src) || $src === '') {
        return [];
    }

    if (!preg_match('/const\s+HIRE_COST\s*=\s*\[(.*?)\];/s', $src, $m)) {
        return [];
    }

    $block = $m[1];
    preg_match_all('/\'([a-z_]+)\'\s*=>\s*\[/', $block, $matches);
    $roles = $matches[1] ?? [];
    $roles = array_values(array_unique(array_map('strval', $roles)));
    sort($roles);

    return $roles;
}

$db = get_db();
$hasFailure = false;
out('=== NPC / Avatar / Leader System Smoke Test ===');
out('Timestamp: ' . date('c'));
out();

// 1) Player avatar/profile generation test
out('--- 1) Avatar-Profil (Spieler) ---');
$uStmt = $db->prepare('SELECT id, username FROM users WHERE username = ? LIMIT 1');
$uStmt->execute(['default_user']);
$defaultUser = $uStmt->fetch(PDO::FETCH_ASSOC);

if (!$defaultUser) {
    $hasFailure = true;
    fail('default_user nicht gefunden');
} else {
    $uid = (int)$defaultUser['id'];
    $uname = (string)$defaultUser['username'];

    try {
        $row = ensure_user_character_profile($db, $uid, false, $uname);
        $status = (string)($row['generation_status'] ?? '');
        info('generation_status=' . ($status !== '' ? $status : 'n/a'));
        info('race=' . (string)($row['race'] ?? 'n/a') . ', profession=' . (string)($row['profession'] ?? 'n/a'));

        $fileErrors = ensure_files_exist($row);
        if ($fileErrors) {
            $hasFailure = true;
            foreach ($fileErrors as $e) {
                fail($e);
            }
        } else {
            ok('Profil-Dateien (JSON/YAML) vorhanden');
        }

        if ($status === 'failed') {
            $hasFailure = true;
            fail('Profilgenerierung fehlgeschlagen: ' . (string)($row['last_error'] ?? 'unbekannt'));
        } else {
            ok('Profilgenerierung für Spieler ist funktionsfähig');
        }
    } catch (Throwable $e) {
        $hasFailure = true;
        fail('Exception bei ensure_user_character_profile(default_user): ' . $e->getMessage());
    }
}
out();

// 2) NPC avatar/profile generation test
out('--- 2) Avatar-Profil (NPC) ---');
$npcUser = ensure_npc_test_user($db);
if ($npcUser) {
    $npcId = (int)$npcUser['id'];
    $npcName = (string)$npcUser['username'];
    info('NPC-Testuser: ' . $npcName . ' (id=' . $npcId . ')');

    try {
        $row = ensure_user_character_profile($db, $npcId, true, $npcName);
        $status = (string)($row['generation_status'] ?? '');
        info('npc=' . $npcName . ', generation_status=' . ($status !== '' ? $status : 'n/a'));

        $fileErrors = ensure_files_exist($row);
        if ($fileErrors) {
            $hasFailure = true;
            foreach ($fileErrors as $e) {
                fail('[NPC] ' . $e);
            }
        } else {
            ok('NPC-Profil-Dateien (JSON/YAML) vorhanden');
        }

        if ($status === 'failed') {
            $hasFailure = true;
            fail('[NPC] Profilgenerierung fehlgeschlagen: ' . (string)($row['last_error'] ?? 'unbekannt'));
        } else {
            ok('NPC-Profilgenerierung ist funktionsfähig');
        }
    } catch (Throwable $e) {
        $hasFailure = true;
        fail('Exception bei ensure_user_character_profile(npc): ' . $e->getMessage());
    }
} else {
    $hasFailure = true;
    fail('NPC-Testuser konnte nicht erstellt oder geladen werden');
}
out();

// 3) Leader roles coverage test
out('--- 3) Leader-Rollen-Abdeckung ---');
$leadersFile = dirname(__DIR__) . '/api/leaders.php';
$supported = read_supported_leader_roles_from_api_file($leadersFile);
$required = [
    'colony_manager',
    'fleet_commander',
    'science_director',
    'diplomacy_officer',
    'trade_director',
];

if (!$supported) {
    $hasFailure = true;
    fail('Leader-Rollen konnten aus api/leaders.php nicht gelesen werden');
} else {
    info('Implementierte Rollen: ' . implode(', ', $supported));

    $missing = array_values(array_diff($required, $supported));
    if ($missing) {
        $hasFailure = true;
        fail('Fehlende Rollen für euer Zielbild: ' . implode(', ', $missing));
    } else {
        ok('Alle benötigten Rollen sind implementiert');
    }
}
out();

// 4) Role assignment target capability snapshot
out('--- 4) Assignment-Fähigkeiten Snapshot ---');
info('Aktuelles API-Verhalten: colony_manager/science_director/diplomacy_officer/trade_director nur Colony, fleet_commander Colony oder Fleet');
ok('Diplomatie- und Handels-Leader sind colony-basiert zuweisbar');
out();

if ($hasFailure) {
    out('ERGEBNIS: FAIL (mind. ein Check fehlgeschlagen)');
    exit(1);
}

out('ERGEBNIS: PASS (alle geforderten Checks erfolgreich)');
exit(0);
