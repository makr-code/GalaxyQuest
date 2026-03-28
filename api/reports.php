<?php

/**
 * GalaxyQuest Intelligence & Reports API
 * Handles spy reports, battle reports, and other intel.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../config/db.php';

$action = $_GET['action'] ?? 'list';
$uid    = (int)(session_value('user_id') ?? 0);

if (!$uid) json_error('Unauthorized', 401);

match ($action) {
    'spy_reports' => action_spy_reports($uid),
    'battle_reports' => action_battle_reports($uid),
    default => json_error('Unknown action', 400),
};

function action_spy_reports(int $uid): never {
    only_method('GET');
    $db = get_db();
    
    $stmt = $db->prepare(
        'SELECT id, target_planet_id, report_json, created_at
         FROM spy_reports
         WHERE owner_id = ?
         ORDER BY created_at DESC
         LIMIT 100'
    );
    $stmt->execute([$uid]);
    
    $reports = [];
    foreach ($stmt->fetchAll() as $row) {
        $reports[] = [
            'id'              => (int)$row['id'],
            'target_planet_id'=> $row['target_planet_id'] ? (int)$row['target_planet_id'] : null,
            'report'          => json_decode((string)($row['report_json'] ?? '{}'), true),
            'created_at'      => $row['created_at'],
        ];
    }
    
    json_ok(['spy_reports' => $reports]);
}

function action_battle_reports(int $uid): never {
    only_method('GET');
    $db = get_db();
    
    $stmt = $db->prepare(
        'SELECT id, planet_id, report_json, created_at,
                CASE WHEN attacker_id = ? THEN \'attacker\' ELSE \'defender\' END AS role
         FROM battle_reports
         WHERE attacker_id = ? OR defender_id = ?
         ORDER BY created_at DESC
         LIMIT 100'
    );
    $stmt->execute([$uid, $uid, $uid]);
    
    $reports = [];
    foreach ($stmt->fetchAll() as $row) {
        $reports[] = [
            'id'        => (int)$row['id'],
            'planet_id' => $row['planet_id'] ? (int)$row['planet_id'] : null,
            'role'      => $row['role'],
            'report'    => json_decode((string)($row['report_json'] ?? '{}'), true),
            'created_at'=> $row['created_at'],
        ];
    }
    
    json_ok(['battle_reports' => $reports]);
}
