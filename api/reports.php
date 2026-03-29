<?php

/**
 * GalaxyQuest Intelligence & Reports API
 * Handles spy reports, battle reports, and other intel.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../config/db.php';

$action = $_GET['action'] ?? 'list';
$uid    = require_auth();

if (!$uid) json_error('Unauthorized', 401);

match ($action) {
    'spy_reports' => action_spy_reports($uid),
    'battle_reports' => action_battle_reports($uid),
    'battle_detail' => action_battle_detail($uid),
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

    if (battle_reports_has_combat_meta_columns($db)) {
        $stmt = $db->prepare(
            'SELECT id, planet_id, report_json, created_at, battle_seed, report_version,
                    attacker_power_rating, defender_power_rating, dice_variance_index,
                    CASE WHEN attacker_id = ? THEN \'attacker\' ELSE \'defender\' END AS role
             FROM battle_reports
             WHERE attacker_id = ? OR defender_id = ?
             ORDER BY created_at DESC
             LIMIT 100'
        );
        $stmt->execute([$uid, $uid, $uid]);
    } else {
        $stmt = $db->prepare(
            'SELECT id, planet_id, report_json, created_at,
                    CASE WHEN attacker_id = ? THEN \'attacker\' ELSE \'defender\' END AS role
             FROM battle_reports
             WHERE attacker_id = ? OR defender_id = ?
             ORDER BY created_at DESC
             LIMIT 100'
        );
        $stmt->execute([$uid, $uid, $uid]);
    }
    
    $reports = [];
    foreach ($stmt->fetchAll() as $row) {
        $decodedReport = hydrate_battle_report_payload(json_decode((string)($row['report_json'] ?? '{}'), true));
        $meta = normalize_battle_report_meta($row);
        $reports[] = [
            'id'        => (int)$row['id'],
            'planet_id' => $row['planet_id'] ? (int)$row['planet_id'] : null,
            'role'      => $row['role'],
            'report'    => $decodedReport,
            'meta'      => $meta,
            'simulation_context' => build_battle_simulation_context($decodedReport, $meta),
            'created_at'=> $row['created_at'],
        ];
    }
    
    json_ok(['battle_reports' => $reports]);
}

function action_battle_detail(int $uid): never {
    only_method('GET');
    $db = get_db();

    $reportId = (int)($_GET['id'] ?? 0);
    if ($reportId <= 0) {
        json_error('id is required', 400);
    }

    if (battle_reports_has_combat_meta_columns($db)) {
        $stmt = $db->prepare(
            'SELECT id, attacker_id, defender_id, planet_id, report_json, created_at,
                    battle_seed, report_version, attacker_power_rating, defender_power_rating,
                    dice_variance_index, explainability_json,
                    CASE WHEN attacker_id = ? THEN \'attacker\' ELSE \'defender\' END AS role
             FROM battle_reports
             WHERE id = ? AND (attacker_id = ? OR defender_id = ?)
             LIMIT 1'
        );
        $stmt->execute([$uid, $reportId, $uid, $uid]);
    } else {
        $stmt = $db->prepare(
            'SELECT id, attacker_id, defender_id, planet_id, report_json, created_at,
                    CASE WHEN attacker_id = ? THEN \'attacker\' ELSE \'defender\' END AS role
             FROM battle_reports
             WHERE id = ? AND (attacker_id = ? OR defender_id = ?)
             LIMIT 1'
        );
        $stmt->execute([$uid, $reportId, $uid, $uid]);
    }
    $row = $stmt->fetch();

    if (!$row) {
        json_error('Battle report not found.', 404);
    }

    $decodedReport = hydrate_battle_report_payload(json_decode((string)($row['report_json'] ?? '{}'), true));
    $meta = normalize_battle_report_meta($row);

    json_ok([
        'battle_report' => [
            'id' => (int)$row['id'],
            'attacker_id' => (int)$row['attacker_id'],
            'defender_id' => (int)$row['defender_id'],
            'planet_id' => $row['planet_id'] ? (int)$row['planet_id'] : null,
            'role' => (string)$row['role'],
            'report' => $decodedReport,
            'meta' => $meta,
            'simulation_context' => build_battle_simulation_context($decodedReport, $meta),
            'created_at' => $row['created_at'],
        ],
    ]);
}

function build_battle_simulation_context(array $report, array $meta): array {
    $power = $report['power_rating'] ?? null;
    if (!is_array($power)) {
        $power = [
            'attacker' => $meta['attacker_power_rating'] ?? null,
            'defender' => $meta['defender_power_rating'] ?? null,
        ];
    }

    $diceVariance = $report['dice_variance_index'] ?? ($meta['dice_variance_index'] ?? null);
    $seed = $report['seed'] ?? ($meta['battle_seed'] ?? null);
    $version = $report['version'] ?? ($meta['report_version'] ?? null);

    return [
        'seed' => is_string($seed) ? $seed : null,
        'version' => is_numeric($version) ? (int)$version : null,
        'dice_variance_index' => is_numeric($diceVariance) ? (float)$diceVariance : null,
        'power_rating' => [
            'attacker' => isset($power['attacker']) && is_numeric($power['attacker']) ? (int)$power['attacker'] : null,
            'defender' => isset($power['defender']) && is_numeric($power['defender']) ? (int)$power['defender'] : null,
        ],
        'attacker_wins' => isset($report['attacker_wins']) ? (bool)$report['attacker_wins'] : null,
        'round_count' => isset($report['rounds']) && is_array($report['rounds']) ? count($report['rounds']) : 0,
    ];
}

function normalize_battle_report_meta(array $row): array {
    return [
        'battle_seed' => $row['battle_seed'] ?? null,
        'report_version' => isset($row['report_version']) ? (int)$row['report_version'] : null,
        'attacker_power_rating' => isset($row['attacker_power_rating']) ? (int)$row['attacker_power_rating'] : null,
        'defender_power_rating' => isset($row['defender_power_rating']) ? (int)$row['defender_power_rating'] : null,
        'dice_variance_index' => isset($row['dice_variance_index']) ? (float)$row['dice_variance_index'] : null,
    ];
}

function hydrate_battle_report_payload($decodedReport): array {
    $report = is_array($decodedReport) ? $decodedReport : [];

    if (!isset($report['modifier_breakdown']) && isset($report['combat_modifiers']) && is_array($report['combat_modifiers'])) {
        $report['modifier_breakdown'] = build_modifier_breakdown_from_totals($report['combat_modifiers']);
    }

    if (!isset($report['rounds']) || !is_array($report['rounds'])) {
        $report['rounds'] = [];
    }

    return $report;
}

function build_modifier_breakdown_from_totals(array $combatMods): array {
    $result = ['attacker' => [], 'defender' => []];

    foreach (['attacker', 'defender'] as $side) {
        $sideMods = is_array($combatMods[$side] ?? null) ? $combatMods[$side] : [];
        foreach ($sideMods as $key => $payload) {
            $parts = explode('.', (string)$key);
            $domain = implode('.', array_slice($parts, 0, 3));
            if ($domain === '') {
                $domain = 'combat.misc';
            }

            if (!isset($result[$side][$domain])) {
                $result[$side][$domain] = ['add_flat' => 0.0, 'add_pct' => 0.0, 'mult' => 1.0];
            }

            $result[$side][$domain]['add_flat'] += (float)($payload['add_flat'] ?? 0.0);
            $result[$side][$domain]['add_pct'] += (float)($payload['add_pct'] ?? 0.0);
            $result[$side][$domain]['mult'] *= (float)($payload['mult'] ?? 1.0);
        }

        foreach ($result[$side] as $domain => $payload) {
            $result[$side][$domain] = [
                'add_flat' => (float)round((float)$payload['add_flat'], 4),
                'add_pct' => (float)round((float)$payload['add_pct'], 4),
                'mult' => (float)round((float)$payload['mult'], 4),
            ];
        }
    }

    return $result;
}

function battle_reports_has_combat_meta_columns(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
           AND COLUMN_NAME IN (\'battle_seed\', \'report_version\', \'attacker_power_rating\', \'defender_power_rating\', \'dice_variance_index\')'
    );
    $stmt->execute(['battle_reports']);
    $cached = ((int)$stmt->fetchColumn() >= 5);
    return $cached;
}
