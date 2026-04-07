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

    case 'set_defense_budget':
        only_method('POST');
        $colonyId    = (int)($_POST['colony_id'] ?? 0);
        $budgetAmount = (float)($_POST['budget_amount'] ?? 0);

        if ($colonyId <= 0 || $budgetAmount < 0) json_error('Invalid colony_id or budget_amount', 400);

        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

        $db->prepare('UPDATE colonies SET defense_budget = ? WHERE id = ?')
           ->execute([$budgetAmount, $colonyId]);

        json_ok([
            'colony_id'      => $colonyId,
            'defense_budget' => $budgetAmount,
            'message'        => 'Defense budget updated; countermeasure effectiveness calculated on next tick',
        ]);
        break;

    case 'get_countermeasures':
        only_method('GET');
        $colonyId = (int)($_GET['colony_id'] ?? 0);

        if ($colonyId <= 0) json_error('Invalid colony_id', 400);

        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

        $measuresStmt = $db->prepare(<<<SQL
            SELECT id, countermeasure_type, spend_credits, effectiveness, activated_at, expires_at
            FROM raid_countermeasures
            WHERE colony_id = ? AND expires_at > NOW()
            ORDER BY expires_at ASC
        SQL);
        $measuresStmt->execute([$colonyId]);
        $measures = $measuresStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $infraStmt = $db->prepare(<<<SQL
            SELECT defense_type, level, effectiveness, maintenance_cost, damage_current, damage_max
            FROM colony_defense_infrastructure
            WHERE colony_id = ?
            ORDER BY effectiveness DESC
        SQL);
        $infraStmt->execute([$colonyId]);
        $infrastructure = $infraStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $colonyStmt = $db->prepare('SELECT defense_budget, countermeasure_level FROM colonies WHERE id = ?');
        $colonyStmt->execute([$colonyId]);
        $colony = $colonyStmt->fetch(PDO::FETCH_ASSOC);

        $measuresOut = array_map(static fn(array $m): array => [
            'id'            => (int)$m['id'],
            'type'          => $m['countermeasure_type'],
            'cost'          => (float)$m['spend_credits'],
            'effectiveness' => (int)$m['effectiveness'],
            'activated_at'  => $m['activated_at'],
            'expires_at'    => $m['expires_at'],
        ], $measures);

        json_ok([
            'colony_id'              => $colonyId,
            'defense_budget'         => (float)($colony['defense_budget'] ?? 0),
            'countermeasure_level'   => (int)($colony['countermeasure_level'] ?? 0),
            'active_countermeasures' => $measuresOut,
            'infrastructure'         => $infrastructure,
        ]);
        break;

    // PHASE 3.1 – Pirate tributary agreement: pay tribute → raids cease for this faction
    case 'propose_contract':
        only_method('POST');
        $factionId   = (int)($_POST['faction_id'] ?? 0);
        $contractType = strtolower((string)($_POST['contract_type'] ?? 'tributary'));
        $creditOffer = (int)($_POST['credit_offer'] ?? 0);
        $durationDays = max(1, min(90, (int)($_POST['duration_days'] ?? 30)));

        if ($factionId <= 0 || $creditOffer < 0) json_error('Invalid faction_id or credit_offer', 400);
        if (!in_array($contractType, ['tributary', 'mercenary', 'non_aggression'], true)) {
            json_error('contract_type must be tributary, mercenary, or non_aggression', 400);
        }

        // Verify faction exists and is a pirate type
        $fStmt = $db->prepare("SELECT id, name, icon, aggression FROM npc_factions WHERE id = ? AND faction_type = 'pirate'");
        $fStmt->execute([$factionId]);
        $faction = $fStmt->fetch(PDO::FETCH_ASSOC);
        if (!$faction) json_error('Pirate faction not found', 404);

        // Check if a contract table exists (PHASE 3.1 migration)
        $hasContracts = $db->query("SHOW TABLES LIKE 'pirate_contracts'")->fetchColumn();
        if (!$hasContracts) json_error('Contract system not yet initialised (run migrate_pirates_v3.sql)', 503);

        // Calculate acceptance probability based on credit offer vs aggression
        $minAcceptable = (int)$faction['aggression'] * 80;  // rough floor
        $acceptChance  = $creditOffer >= $minAcceptable
            ? min(95, 50 + (int)(($creditOffer - $minAcceptable) / 100))
            : max(5, (int)($creditOffer / $minAcceptable * 40));

        $accepted = random_int(1, 100) <= $acceptChance;

        if ($accepted) {
            $db->prepare(<<<SQL
                INSERT INTO pirate_contracts
                    (user_id, faction_id, contract_type, credit_payment,
                     duration_days, status, expires_at)
                VALUES (?, ?, ?, ?, ?, 'active', DATE_ADD(NOW(), INTERVAL ? DAY))
                ON DUPLICATE KEY UPDATE
                    contract_type   = VALUES(contract_type),
                    credit_payment  = VALUES(credit_payment),
                    duration_days   = VALUES(duration_days),
                    status          = 'active',
                    expires_at      = VALUES(expires_at),
                    updated_at      = NOW()
            SQL)->execute([$uid, $factionId, $contractType, $creditOffer, $durationDays, $durationDays]);

            // Improve standing
            require_once __DIR__ . '/factions.php';
            update_standing($db, $uid, $factionId, 15, 'contract_signed', "Signed {$contractType} agreement");

            $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
               ->execute([
                   $uid,
                   "{$faction['icon']} Contract Accepted: {$faction['name']}",
                   "[{$faction['icon']} {$faction['name']}] We accept your terms. "
                   . ucfirst($contractType) . " agreement in force for {$durationDays} days. "
                   . "Honour the arrangement and we will leave your colonies in peace.",
               ]);
        } else {
            update_standing($db, $uid, $factionId, -2, 'contract_rejected', 'Contract offer rejected as insufficient');
            $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
               ->execute([
                   $uid,
                   "{$faction['icon']} Contract Rejected: {$faction['name']}",
                   "[{$faction['icon']} {$faction['name']}] Your offer is insulting. Bring more credits if you wish to negotiate.",
               ]);
        }

        json_ok([
            'accepted'      => $accepted,
            'accept_chance' => $acceptChance,
            'faction_id'    => $factionId,
            'contract_type' => $contractType,
            'duration_days' => $durationDays,
            'credit_offer'  => $creditOffer,
        ]);
        break;

    // PHASE 3.1 – List active pirate contracts for the player
    case 'list_contracts':
        only_method('GET');

        $hasContracts = $db->query("SHOW TABLES LIKE 'pirate_contracts'")->fetchColumn();
        if (!$hasContracts) json_ok(['contracts' => [], 'note' => 'Contract system not yet initialised']);

        $cStmt = $db->prepare(<<<SQL
            SELECT pc.id, pc.faction_id, nf.name AS faction_name, nf.icon AS faction_icon,
                   pc.contract_type, pc.credit_payment, pc.duration_days,
                   pc.status, pc.expires_at, pc.created_at
            FROM pirate_contracts pc
            JOIN npc_factions nf ON nf.id = pc.faction_id
            WHERE pc.user_id = ? AND pc.status = 'active' AND pc.expires_at > NOW()
            ORDER BY pc.expires_at ASC
        SQL);
        $cStmt->execute([$uid]);
        $contracts = $cStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        json_ok(['contracts' => $contracts]);
        break;

    default:
        json_error('Unknown action', 400);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    return (int)$stmt->fetchColumn();
}
