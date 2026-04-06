<?php
/**
 * Pirate operations API.
 *
 * GET  /api/pirates.php?action=status
 * GET  /api/pirates.php?action=recent_raids&limit=20
 * GET  /api/pirates.php?action=forecast
 * POST /api/pirates.php?action=run_tick
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/npc_ai.php';

$uid = require_auth();
$action = strtolower((string) ($_GET['action'] ?? 'status'));
$db = get_db();

switch ($action) {
    case 'status':
        only_method('GET');

        $stmt = $db->prepare(
            'SELECT nf.id, nf.code, nf.name, nf.icon, nf.aggression, nf.power_level, nf.base_diplomacy,
                    COALESCE(d.standing, nf.base_diplomacy) AS standing,
                    d.last_event, d.last_event_at
             FROM npc_factions nf
             LEFT JOIN diplomacy d ON d.user_id = ? AND d.faction_id = nf.id
             WHERE nf.faction_type = "pirate"
             ORDER BY nf.aggression DESC, nf.power_level DESC, nf.name ASC'
        );
        $stmt->execute([$uid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $raids24h = pirates_count_recent_raids($db, $uid, 24);

        $factions = array_map(static function (array $row): array {
            $standing = (int) ($row['standing'] ?? 0);
            $aggression = (int) ($row['aggression'] ?? 0);
            $powerLevel = (int) ($row['power_level'] ?? 0);

            $standingRisk = max(0, min(100, (int) round(abs(min(0, $standing)) * 1.1)));
            $aggressionRisk = max(0, min(100, $aggression));
            $powerRisk = max(0, min(100, (int) round($powerLevel / 20)));

            $threatScore = max(0, min(100, (int) round(
                ($standingRisk * 0.45) + ($aggressionRisk * 0.45) + ($powerRisk * 0.10)
            )));

            $threatLevel = match (true) {
                $threatScore >= 85 => 'critical',
                $threatScore >= 60 => 'high',
                $threatScore >= 35 => 'medium',
                default => 'low',
            };

            return [
                'id' => (int) ($row['id'] ?? 0),
                'code' => (string) ($row['code'] ?? ''),
                'name' => (string) ($row['name'] ?? ''),
                'icon' => (string) ($row['icon'] ?? ''),
                'standing' => $standing,
                'aggression' => $aggression,
                'power_level' => $powerLevel,
                'threat_score' => $threatScore,
                'threat_level' => $threatLevel,
                'last_event' => (string) ($row['last_event'] ?? ''),
                'last_event_at' => (string) ($row['last_event_at'] ?? ''),
            ];
        }, $rows);

        $maxThreat = 0;
        $highThreatCount = 0;
        foreach ($factions as $faction) {
            $score = (int) ($faction['threat_score'] ?? 0);
            if ($score > $maxThreat) $maxThreat = $score;
            if ($score >= 60) $highThreatCount++;
        }

        json_ok([
            'factions' => $factions,
            'summary' => [
                'pirate_factions' => count($factions),
                'high_threat_factions' => $highThreatCount,
                'max_threat_score' => $maxThreat,
                'raids_last_24h' => $raids24h,
            ],
        ]);
        break;

    case 'recent_raids':
        only_method('GET');

        $limit = max(1, min(100, (int) ($_GET['limit'] ?? 20)));

        $stmt = $db->prepare(
            'SELECT id, subject, body, is_read, sent_at
             FROM messages
             WHERE receiver_id = ?
               AND subject = "Pirate Raid!"
             ORDER BY sent_at DESC
             LIMIT ' . $limit
        );
        $stmt->execute([$uid]);

        json_ok([
            'raids' => $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [],
        ]);
        break;

    case 'forecast':
        only_method('GET');

        $stmt = $db->prepare(
            'SELECT COALESCE(d.standing, nf.base_diplomacy) AS standing, nf.aggression, nf.power_level
             FROM npc_factions nf
             LEFT JOIN diplomacy d ON d.user_id = ? AND d.faction_id = nf.id
             WHERE nf.faction_type = "pirate"'
        );
        $stmt->execute([$uid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $avgScore = 0.0;
        if (!empty($rows)) {
            $sum = 0.0;
            foreach ($rows as $row) {
                $standing = (int) ($row['standing'] ?? 0);
                $aggression = (int) ($row['aggression'] ?? 0);
                $powerLevel = (int) ($row['power_level'] ?? 0);

                $standingRisk = max(0, min(100, (int) round(abs(min(0, $standing)) * 1.1)));
                $aggressionRisk = max(0, min(100, $aggression));
                $powerRisk = max(0, min(100, (int) round($powerLevel / 20)));
                $sum += ($standingRisk * 0.45) + ($aggressionRisk * 0.45) + ($powerRisk * 0.10);
            }
            $avgScore = $sum / count($rows);
        }

        $raids24h = pirates_count_recent_raids($db, $uid, 24);
        $riskIndex = max(0, min(100, (int) round(($avgScore * 0.75) + (min(30, $raids24h * 6) * 0.25))));
        $riskLevel = match (true) {
            $riskIndex >= 80 => 'critical',
            $riskIndex >= 55 => 'high',
            $riskIndex >= 30 => 'medium',
            default => 'low',
        };

        json_ok([
            'forecast' => [
                'risk_index' => $riskIndex,
                'risk_level' => $riskLevel,
                'raids_last_24h' => $raids24h,
                'recommended_action' => match ($riskLevel) {
                    'critical' => 'Raise defenses now and improve pirate faction standing immediately.',
                    'high' => 'Strengthen defenses and monitor diplomacy with pirate factions closely.',
                    'medium' => 'Maintain patrol readiness and keep relations from dropping further.',
                    default => 'Current risk is low. Continue standard monitoring.',
                },
            ],
        ]);
        break;

    case 'run_tick':
        only_method('POST');
        verify_csrf();

        $beforeRaids = pirates_count_recent_raids($db, $uid, 24);

        $pirateStmt = $db->prepare(
            'SELECT *
             FROM npc_factions
             WHERE faction_type = "pirate"
             ORDER BY aggression DESC, power_level DESC, id ASC'
        );
        $pirateStmt->execute();
        $pirateFactions = $pirateStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        foreach ($pirateFactions as $faction) {
            npc_faction_tick($db, $uid, $faction);
        }

        $afterRaids = pirates_count_recent_raids($db, $uid, 24);

        json_ok([
            'message' => 'Pirate simulation tick executed.',
            'factions_processed' => count($pirateFactions),
            'new_raids_last_24h_delta' => max(0, $afterRaids - $beforeRaids),
        ]);
        break;

    default:
        json_error('Unknown action', 400);
}

function pirates_count_recent_raids(PDO $db, int $userId, int $hours): int {
    $hours = max(1, min(168, $hours));
    $stmt = $db->prepare(
        'SELECT COUNT(*)
         FROM messages
         WHERE receiver_id = ?
           AND subject = "Pirate Raid!"
           AND sent_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)'
    );
    $stmt->execute([$userId, $hours]);
    return (int) $stmt->fetchColumn();
}
