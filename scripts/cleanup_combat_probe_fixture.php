<?php

declare(strict_types=1);

/**
 * Cleanup combat probe fixture data.
 *
 * Usage:
 *   php scripts/cleanup_combat_probe_fixture.php
 *   php scripts/cleanup_combat_probe_fixture.php --remove-test-mod-links=1
 */

require_once __DIR__ . '/../config/db.php';

function arg_value(array $argv, string $name): ?string {
    foreach ($argv as $arg) {
        if (str_starts_with($arg, "--{$name}=")) {
            return substr($arg, strlen($name) + 3);
        }
    }
    return null;
}

$removeModLinks = ((int)(arg_value($argv, 'remove-test-mod-links') ?? 0)) === 1;

$db = get_db();

$fixtureUsers = ['gq_combat_attacker', 'gq_combat_defender_npc'];

$idStmt = $db->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
$userIds = [];
foreach ($fixtureUsers as $username) {
    $idStmt->execute([$username]);
    $id = $idStmt->fetchColumn();
    if ($id !== false) {
        $userIds[] = (int)$id;
    }
}

$stats = [
    'fixture_users_found' => count($userIds),
    'fleets_deleted' => 0,
    'users_deleted' => 0,
    'test_modifier_links_deleted' => 0,
];

if (!empty($userIds)) {
    $in = implode(',', array_fill(0, count($userIds), '?'));

    $delFleets = $db->prepare("DELETE FROM fleets WHERE user_id IN ({$in})");
    $delFleets->execute($userIds);
    $stats['fleets_deleted'] = (int)$delFleets->rowCount();

    $delUsers = $db->prepare("DELETE FROM users WHERE id IN ({$in})");
    $delUsers->execute($userIds);
    $stats['users_deleted'] = (int)$delUsers->rowCount();
}

if ($removeModLinks) {
    $delMods = $db->prepare('DELETE FROM user_combat_modifiers WHERE granted_by = ?');
    $delMods->execute(['test_seed_v1']);
    $stats['test_modifier_links_deleted'] = (int)$delMods->rowCount();
}

echo json_encode([
    'success' => true,
    'options' => [
        'remove_test_mod_links' => $removeModLinks,
    ],
    'stats' => $stats,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
