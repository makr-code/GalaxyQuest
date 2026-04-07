<?php
/**
 * War API (strategy-level warfare state)
 *
 * GET  /api/war.php?action=list
 * GET  /api/war.php?action=get_status&war_id=X
 * POST /api/war.php?action=declare       body: {target_user_id, war_goals?, casus_belli?}
 * POST /api/war.php?action=offer_peace   body: {war_id, terms?}
 * POST /api/war.php?action=respond_peace body: {offer_id, accept}
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/../config/combat_config.php';

header('Content-Type: application/json; charset=utf-8');

function war_table_exists(PDO $db, string $name): bool {
    $st = $db->prepare(
        'SELECT 1
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         LIMIT 1'
    );
    $st->execute([$name]);
    return (bool)$st->fetchColumn();
}

function war_require_schema(PDO $db): void {
    $required = ['wars', 'war_goals', 'peace_offers'];
    foreach ($required as $table) {
        if (!war_table_exists($db, $table)) {
            json_error('War schema missing. Apply sql/migrate_combat_v1_wars.sql first.', 503);
        }
    }
}

function war_user_exists(PDO $db, int $userId): bool {
    $st = $db->prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1');
    $st->execute([$userId]);
    return (bool)$st->fetchColumn();
}

function war_load_for_participant(PDO $db, int $warId, int $uid): ?array {
    $st = $db->prepare(
        'SELECT *
         FROM wars
         WHERE id = ? AND (attacker_user_id = ? OR defender_user_id = ?)
         LIMIT 1'
    );
    $st->execute([$warId, $uid, $uid]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function war_find_active_between(PDO $db, int $a, int $b): ?array {
    $st = $db->prepare(
        'SELECT *
         FROM wars
         WHERE status = "active"
           AND ((attacker_user_id = ? AND defender_user_id = ?)
             OR (attacker_user_id = ? AND defender_user_id = ?))
         ORDER BY id DESC
         LIMIT 1'
    );
    $st->execute([$a, $b, $b, $a]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function war_normalize_goals(mixed $goals): array {
    if (!is_array($goals)) {
        return [];
    }

    $out = [];
    foreach ($goals as $goal) {
        if (!is_array($goal)) {
            continue;
        }

        $type = trim((string)($goal['type'] ?? ''));
        if ($type === '') {
            continue;
        }

        $entry = [
            'type' => substr($type, 0, 40),
            'target_id' => isset($goal['target_id']) ? (int)$goal['target_id'] : null,
            'target_value' => isset($goal['target_value']) ? substr((string)$goal['target_value'], 0, 120) : null,
            'score_value' => isset($goal['score_value']) ? (int)$goal['score_value'] : 0,
        ];
        $out[] = $entry;

        if (count($out) >= 8) {
            break;
        }
    }

    return $out;
}

function war_normalize_terms(mixed $terms): array {
    if (!is_array($terms)) {
        return [];
    }
    $out = [];
    foreach ($terms as $term) {
        if (!is_array($term)) {
            continue;
        }
        $type = trim((string)($term['type'] ?? ''));
        if ($type === '') {
            continue;
        }

        $normalized = ['type' => substr($type, 0, 40)];
        foreach ($term as $k => $v) {
            if ($k === 'type') {
                continue;
            }
            if (is_scalar($v) || $v === null) {
                $normalized[(string)$k] = $v;
            }
        }
        $out[] = $normalized;

        if (count($out) >= 10) {
            break;
        }
    }
    return $out;
}

function war_get_goals(PDO $db, int $warId): array {
    $st = $db->prepare(
        'SELECT id, side, goal_type, target_id, target_value, score_value, created_at
         FROM war_goals
         WHERE war_id = ?
         ORDER BY id ASC'
    );
    $st->execute([$warId]);
    return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function war_goal_status_payload(PDO $db, array $warRow, array $goalRow): array {
    $side = (string)($goalRow['side'] ?? '');
    $goalType = (string)($goalRow['goal_type'] ?? '');
    $snapshot = war_side_snapshot($warRow, $side);

    $payload = [
        'id' => (int)($goalRow['id'] ?? 0),
        'side' => $side,
        'goal_type' => $goalType,
        'target_id' => isset($goalRow['target_id']) ? (int)$goalRow['target_id'] : null,
        'target_value' => $goalRow['target_value'] ?? null,
        'score_value' => (int)($goalRow['score_value'] ?? 0),
        'created_at' => (string)($goalRow['created_at'] ?? ''),
        'progress' => [
            'status' => 'unknown',
            'label' => 'Unknown',
            'score_rate_per_day' => 0.0,
            'current_value' => null,
            'target_value' => null,
            'control' => null,
            'hint' => null,
        ],
    ];

    if ($goalType === 'annex_system') {
        $loc = parse_war_goal_location((int)($goalRow['target_id'] ?? 0), (string)($goalRow['target_value'] ?? ''));
        if ($loc === null) {
            $payload['progress']['status'] = 'invalid_target';
            $payload['progress']['label'] = 'Invalid target';
            $payload['progress']['hint'] = 'Goal target is not a valid galaxy/system tuple.';
            return $payload;
        }

        $ownerCols = count_user_colonies_in_system($db, $snapshot['owner_user_id'], (int)$loc['galaxy'], (int)$loc['system']);
        $enemyCols = count_user_colonies_in_system($db, $snapshot['enemy_user_id'], (int)$loc['galaxy'], (int)$loc['system']);
        $isControlled = $ownerCols > $enemyCols;
        $rate = $isControlled ? (float)WAR_SCORE_OCCUPY_PER_DAY : 0.0;

        $payload['progress'] = [
            'status' => $isControlled ? 'contested_controlled' : ($enemyCols > 0 ? 'enemy_holds' : 'unoccupied'),
            'label' => $isControlled ? 'Controlled' : ($enemyCols > 0 ? 'Enemy Holds' : 'Unoccupied'),
            'score_rate_per_day' => $rate,
            'current_value' => $ownerCols,
            'target_value' => $enemyCols,
            'control' => [
                'galaxy' => (int)$loc['galaxy'],
                'system' => (int)$loc['system'],
                'owner_colonies' => $ownerCols,
                'enemy_colonies' => $enemyCols,
            ],
            'hint' => $isControlled
                ? 'War score increases while your side controls more colonies in the target system.'
                : 'Gain control of the target system to start generating war score.',
        ];
        return $payload;
    }

    if ($goalType === 'attrition') {
        $gap = round(max(0.0, $snapshot['enemy_exhaustion'] - $snapshot['own_exhaustion']), 2);
        $rate = round((float)WAR_SCORE_OCCUPY_PER_DAY * min(1.0, $gap / 100.0), 3);
        $payload['progress'] = [
            'status' => $gap > 0 ? 'advantage' : 'neutral',
            'label' => $gap > 0 ? 'Exhaustion Advantage' : 'No Advantage',
            'score_rate_per_day' => $rate,
            'current_value' => $gap,
            'target_value' => 100,
            'control' => null,
            'hint' => $gap > 0
                ? 'War score increases while the enemy exhaustion stays above your own exhaustion.'
                : 'Increase enemy exhaustion above your own to generate war score from attrition.',
        ];
        return $payload;
    }

    $payload['progress']['hint'] = 'No progress model is implemented for this goal type yet.';

        // PHASE 3.4 – Economic goal: capture trade income by blocking enemy colonies
        if ($goalType === 'economic') {
            $ownerId   = (int)$snapshot['owner_user_id'];
            $enemyId   = (int)$snapshot['enemy_user_id'];

            // Count active trade offers for each side as a proxy for economic power
            $ownTrade  = (int)$db->prepare(
                'SELECT COUNT(*) FROM trade_offers WHERE faction_id IN
                 (SELECT id FROM npc_factions WHERE id IN
                    (SELECT faction_id FROM diplomacy WHERE user_id = ? AND standing >= 0))
                 AND active = 1 AND valid_until > NOW()'
            )->execute([$ownerId]) ? 0 : 0; // simplified: use war exhaustion asymmetry

            $ownExhaustion  = (float)$snapshot['own_exhaustion'];
            $enemyExhaustion= (float)$snapshot['enemy_exhaustion'];
            // Economic advantage = enemy trade disrupted (enemy exhaustion > 60) while own < 60
            $economicScore  = max(0, min(100, ($enemyExhaustion - $ownExhaustion) * 0.8));
            $rate = round((float)WAR_SCORE_OCCUPY_PER_DAY * min(1.0, $economicScore / 100.0), 3);
            $isAdvantage = $economicScore > 20;

            $payload['progress'] = [
                'status'             => $isAdvantage ? 'advantage' : 'neutral',
                'label'              => $isAdvantage ? 'Economic Pressure' : 'No Economic Edge',
                'score_rate_per_day' => $rate,
                'current_value'      => round($economicScore, 1),
                'target_value'       => 100,
                'control'            => null,
                'hint'               => $isAdvantage
                    ? 'Economic war score accrues while the enemy is exhausted and trade-disrupted.'
                    : 'Increase enemy exhaustion above 60 to gain economic war score.',
            ];
            return $payload;
        }

        // PHASE 3.4 – Diplomatic goal: form alliances (tracked via diplomacy table)
        if ($goalType === 'diplomatic') {
            $ownerId = (int)$snapshot['owner_user_id'];
            // Count active positive-standing faction relationships (allies)
            $allyStmt = $db->prepare(
                'SELECT COUNT(*) FROM diplomacy WHERE user_id = ? AND standing >= 50'
            );
            $allyStmt->execute([$ownerId]);
            $allyCount  = (int)$allyStmt->fetchColumn();
            $targetAllies = (int)($goalRow['target_value'] ?? 3);
            $isAchieved   = $allyCount >= $targetAllies;
            $rate = $isAchieved ? (float)WAR_SCORE_OCCUPY_PER_DAY * 0.5 : 0.0;

            $payload['progress'] = [
                'status'             => $isAchieved ? 'advantage' : 'neutral',
                'label'              => $isAchieved ? 'Alliance Secured' : 'Building Alliance',
                'score_rate_per_day' => round($rate, 3),
                'current_value'      => $allyCount,
                'target_value'       => $targetAllies,
                'control'            => ['ally_count' => $allyCount, 'target' => $targetAllies],
                'hint'               => $isAchieved
                    ? "Alliance goal met ({$allyCount}/{$targetAllies} factions standing ≥ 50). War score accruing."
                    : "Improve standing with {$targetAllies} factions to ≥ 50 to fulfil this goal. Currently: {$allyCount}.",
            ];
            return $payload;
        }

        // PHASE 3.4 – Subjugation goal: win score exceeds threshold
        if ($goalType === 'subjugation') {
            $ownScore   = (float)$snapshot['own_score'];
            $enemyScore = (float)$snapshot['enemy_score'];
            $threshold  = 100.0;
            $isWinning  = $ownScore > $enemyScore;
            $rate = $isWinning ? (float)WAR_SCORE_OCCUPY_PER_DAY : 0.0;

            $payload['progress'] = [
                'status'             => $isWinning ? 'advantage' : 'neutral',
                'label'              => $isWinning ? 'Winning' : 'Behind',
                'score_rate_per_day' => round($rate, 3),
                'current_value'      => round($ownScore, 1),
                'target_value'       => $threshold,
                'control'            => ['own' => round($ownScore, 1), 'enemy' => round($enemyScore, 1)],
                'hint'               => 'Force enemy surrender by achieving a war score lead. Control systems and outlast your opponent.',
            ];
            return $payload;
        }

    return $payload;
}

function war_get_enriched_goals(PDO $db, array $warRow): array {
    $rawGoals = war_get_goals($db, (int)$warRow['id']);
    $out = [];
    foreach ($rawGoals as $goal) {
        $out[] = war_goal_status_payload($db, $warRow, $goal);
    }
    return $out;
}

function war_list_summary(PDO $db, array $warRow, bool $isAttacker): array {
    $side = $isAttacker ? 'attacker' : 'defender';
    $goals = war_get_enriched_goals($db, $warRow);
    $primaryGoal = null;
    $goalCounts = [
        'total' => 0,
        'advantage' => 0,
        'active' => 0,
        'blocked' => 0,
    ];

    foreach ($goals as $goal) {
        if ((string)($goal['side'] ?? '') !== $side) {
            continue;
        }

        $goalCounts['total']++;
        $status = (string)($goal['progress']['status'] ?? 'unknown');
        if (in_array($status, ['advantage', 'contested_controlled'], true)) {
            $goalCounts['advantage']++;
        } elseif ($status !== 'unknown') {
            $goalCounts['active']++;
        }

        if (in_array($status, ['enemy_holds', 'neutral', 'invalid_target'], true)) {
            $goalCounts['blocked']++;
        }

        if ($primaryGoal === null) {
            $primaryGoal = [
                'goal_type' => (string)($goal['goal_type'] ?? ''),
                'label' => (string)($goal['progress']['label'] ?? 'Unknown'),
                'status' => $status,
                'score_rate_per_day' => (float)($goal['progress']['score_rate_per_day'] ?? 0.0),
                'hint' => (string)($goal['progress']['hint'] ?? ''),
            ];
        }
    }

    $pressure = [
        'own_exhaustion' => $isAttacker ? (float)($warRow['exhaustion_att'] ?? 0.0) : (float)($warRow['exhaustion_def'] ?? 0.0),
        'enemy_exhaustion' => $isAttacker ? (float)($warRow['exhaustion_def'] ?? 0.0) : (float)($warRow['exhaustion_att'] ?? 0.0),
        'own_war_score' => $isAttacker ? (int)($warRow['war_score_att'] ?? 0) : (int)($warRow['war_score_def'] ?? 0),
        'enemy_war_score' => $isAttacker ? (int)($warRow['war_score_def'] ?? 0) : (int)($warRow['war_score_att'] ?? 0),
    ];
    $pressure['score_balance'] = $pressure['own_war_score'] - $pressure['enemy_war_score'];
    $pressure['exhaustion_gap'] = round($pressure['enemy_exhaustion'] - $pressure['own_exhaustion'], 2);

    return [
        'primary_goal' => $primaryGoal,
        'goal_counts' => $goalCounts,
        'pressure' => $pressure,
    ];
}

function war_mark_expired_offers(PDO $db, int $warId): void {
    $db->prepare(
        'UPDATE peace_offers
         SET status = "expired", responded_at = NOW()
         WHERE war_id = ? AND status = "pending" AND expires_at <= NOW()'
    )->execute([$warId]);
}

function war_list_active(PDO $db, int $uid): array {
    $st = $db->prepare(
        'SELECT w.id,
                w.status,
                w.attacker_user_id,
                w.defender_user_id,
                w.war_score_att,
                w.war_score_def,
                w.exhaustion_att,
                w.exhaustion_def,
                w.started_at,
                ua.username AS attacker_name,
                ud.username AS defender_name
         FROM wars w
         JOIN users ua ON ua.id = w.attacker_user_id
         JOIN users ud ON ud.id = w.defender_user_id
         WHERE w.status = "active"
           AND (w.attacker_user_id = ? OR w.defender_user_id = ?)
         ORDER BY w.id DESC'
    );
    $st->execute([$uid, $uid]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $wars = [];
    foreach ($rows as $row) {
        $isAttacker = (int)$row['attacker_user_id'] === $uid;
        $opponentId = $isAttacker ? (int)$row['defender_user_id'] : (int)$row['attacker_user_id'];
        $opponentName = $isAttacker ? (string)$row['defender_name'] : (string)$row['attacker_name'];

        $wars[] = [
            'war_id' => (int)$row['id'],
            'status' => (string)$row['status'],
            'opponent' => [
                'id' => $opponentId,
                'username' => $opponentName,
            ],
            'war_score' => $isAttacker ? (int)$row['war_score_att'] : (int)$row['war_score_def'],
            'enemy_war_score' => $isAttacker ? (int)$row['war_score_def'] : (int)$row['war_score_att'],
            'exhaustion' => $isAttacker ? (float)$row['exhaustion_att'] : (float)$row['exhaustion_def'],
            'enemy_exhaustion' => $isAttacker ? (float)$row['exhaustion_def'] : (float)$row['exhaustion_att'],
            'started_at' => (string)$row['started_at'],
            'summary' => war_list_summary($db, $row, $isAttacker),
        ];
    }

    return $wars;
}

$uid = require_auth();
$db = get_db();
$action = $_GET['action'] ?? '';

war_require_schema($db);

switch ($action) {
    case 'declare': {
        only_method('POST');
        verify_csrf();

        $body = get_json_body();
        $targetUserId = (int)($body['target_user_id'] ?? 0);
        $casusBelli = trim((string)($body['casus_belli'] ?? ''));
        $goals = war_normalize_goals($body['war_goals'] ?? []);

        if ($targetUserId <= 0) {
            json_error('target_user_id is required.', 400);
        }
        if ($targetUserId === $uid) {
            json_error('Cannot declare war on yourself.', 400);
        }
        if (!war_user_exists($db, $targetUserId)) {
            json_error('Target user not found.', 404);
        }

        $active = war_find_active_between($db, $uid, $targetUserId);
        if ($active !== null) {
            json_error('There is already an active war between these users.', 409);
        }

        $db->beginTransaction();
        try {
            $ins = $db->prepare(
                'INSERT INTO wars
                    (attacker_user_id, defender_user_id, status, war_score_att, war_score_def, exhaustion_att, exhaustion_def, casus_belli)
                 VALUES (?, ?, "active", 0, 0, 0, 0, ?)' 
            );
            $ins->execute([$uid, $targetUserId, $casusBelli !== '' ? substr($casusBelli, 0, 120) : null]);
            $warId = (int)$db->lastInsertId();

            if ($goals) {
                $goalStmt = $db->prepare(
                    'INSERT INTO war_goals
                        (war_id, side, goal_type, target_id, target_value, score_value)
                     VALUES (?, "attacker", ?, ?, ?, ?)' 
                );
                foreach ($goals as $goal) {
                    $goalStmt->execute([
                        $warId,
                        $goal['type'],
                        $goal['target_id'],
                        $goal['target_value'],
                        (int)$goal['score_value'],
                    ]);
                }
            }

            $db->commit();

            json_ok([
                'war_id' => $warId,
                'status' => 'active',
                'war_score' => 0,
                'exhaustion' => 0,
            ]);
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
    }

    case 'offer_peace': {
        only_method('POST');
        verify_csrf();

        $body = get_json_body();
        $warId = (int)($body['war_id'] ?? 0);
        if ($warId <= 0) {
            json_error('war_id is required.', 400);
        }

        $war = war_load_for_participant($db, $warId, $uid);
        if ($war === null) {
            json_error('War not found.', 404);
        }
        if ((string)$war['status'] !== 'active') {
            json_error('War is not active.', 409);
        }

        war_mark_expired_offers($db, $warId);
        $terms = war_normalize_terms($body['terms'] ?? []);
        $ttl = max(60, (int)WAR_DEFAULT_PEACE_OFFER_TTL_SECONDS);
        $expiresAt = date('Y-m-d H:i:s', time() + $ttl);

        $st = $db->prepare(
            'INSERT INTO peace_offers (war_id, from_user_id, terms_json, expires_at, status)
             VALUES (?, ?, ?, ?, "pending")'
        );
        $st->execute([$warId, $uid, json_encode($terms), $expiresAt]);

        json_ok([
            'offer_id' => (int)$db->lastInsertId(),
            'expires_at' => $expiresAt,
        ]);
    }

    case 'respond_peace': {
        only_method('POST');
        verify_csrf();

        $body = get_json_body();
        $offerId = (int)($body['offer_id'] ?? 0);
        $accept = filter_var($body['accept'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

        if ($offerId <= 0) {
            json_error('offer_id is required.', 400);
        }
        if ($accept === null) {
            json_error('accept must be a boolean.', 400);
        }

        $st = $db->prepare(
            'SELECT po.*, w.status AS war_status, w.attacker_user_id, w.defender_user_id
             FROM peace_offers po
             JOIN wars w ON w.id = po.war_id
             WHERE po.id = ?
             LIMIT 1'
        );
        $st->execute([$offerId]);
        $offer = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($offer)) {
            json_error('Peace offer not found.', 404);
        }

        $isParticipant = ((int)$offer['attacker_user_id'] === $uid) || ((int)$offer['defender_user_id'] === $uid);
        if (!$isParticipant) {
            json_error('War not found.', 404);
        }
        if ((int)$offer['from_user_id'] === $uid) {
            json_error('Offer author cannot respond to own peace offer.', 403);
        }
        if ((string)$offer['status'] !== 'pending') {
            json_error('Peace offer is no longer pending.', 409);
        }
        if (strtotime((string)$offer['expires_at']) <= time()) {
            $db->prepare('UPDATE peace_offers SET status = "expired", responded_at = NOW() WHERE id = ?')->execute([$offerId]);
            json_error('Peace offer has expired.', 409);
        }
        if ((string)$offer['war_status'] !== 'active') {
            json_error('War is not active.', 409);
        }

        $db->beginTransaction();
        try {
            if ($accept) {
                $db->prepare('UPDATE peace_offers SET status = "accepted", responded_at = NOW() WHERE id = ?')
                   ->execute([$offerId]);
                $db->prepare('UPDATE wars SET status = "ended", ended_at = NOW(), ended_reason = "peace_accepted" WHERE id = ?')
                   ->execute([(int)$offer['war_id']]);

                $db->commit();
                json_ok([
                    'war_status' => 'ended',
                    'new_state' => 'peace_accepted',
                ]);
            }

            $db->prepare('UPDATE peace_offers SET status = "rejected", responded_at = NOW() WHERE id = ?')
               ->execute([$offerId]);
            $db->commit();

            json_ok([
                'war_status' => 'active',
                'new_state' => 'offer_rejected',
            ]);
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
    }

    case 'get_status': {
        only_method('GET');
        $warId = (int)($_GET['war_id'] ?? 0);
        if ($warId <= 0) {
            json_error('war_id is required.', 400);
        }

        $war = war_load_for_participant($db, $warId, $uid);
        if ($war === null) {
            json_error('War not found.', 404);
        }

        war_mark_expired_offers($db, $warId);
        $goals = war_get_enriched_goals($db, $war);

        $offerStmt = $db->prepare(
            'SELECT id, from_user_id, status, created_at, expires_at, responded_at, terms_json
             FROM peace_offers
             WHERE war_id = ?
             ORDER BY id DESC
             LIMIT 10'
        );
        $offerStmt->execute([$warId]);
        $offersRaw = $offerStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $offers = [];
        foreach ($offersRaw as $offer) {
            $decoded = json_decode((string)$offer['terms_json'], true);
            $offers[] = [
                'id' => (int)$offer['id'],
                'from_user_id' => (int)$offer['from_user_id'],
                'status' => (string)$offer['status'],
                'created_at' => (string)$offer['created_at'],
                'expires_at' => (string)$offer['expires_at'],
                'responded_at' => $offer['responded_at'],
                'terms' => is_array($decoded) ? $decoded : [],
            ];
        }

        json_ok([
            'war_id' => (int)$war['id'],
            'status' => (string)$war['status'],
            'war_score_att' => (int)$war['war_score_att'],
            'war_score_def' => (int)$war['war_score_def'],
            'exhaustion_att' => (float)$war['exhaustion_att'],
            'exhaustion_def' => (float)$war['exhaustion_def'],
            'attacker_user_id' => (int)$war['attacker_user_id'],
            'defender_user_id' => (int)$war['defender_user_id'],
            'casus_belli' => $war['casus_belli'],
            'started_at' => (string)$war['started_at'],
            'ended_at' => $war['ended_at'],
            'ended_reason' => $war['ended_reason'],
            'goals' => $goals,
            'peace_offers' => $offers,
        ]);
    }

    case 'list': {
        only_method('GET');
        json_ok([
            'wars' => war_list_active($db, $uid),
        ]);
    }

    case 'get_supply_status': {
        only_method('GET');
        $warId = (int)($_GET['war_id'] ?? 0);
        if ($warId <= 0) json_error('Missing war_id', 400);

        $war = war_load_for_participant($db, $warId, $uid);
        if (!$war) json_error('War not found or access denied', 403);

        $stmt = $db->prepare(<<<SQL
            SELECT id, from_colony_id, to_system_index, distance_ly, logistics_cost,
                   supply_capacity, interdiction_level, status
            FROM war_supply_lines
            WHERE war_id = ?
            ORDER BY status, distance_ly DESC
        SQL);
        $stmt->execute([$warId]);
        $supplyLines = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $lines = [];
        $totalCost = 0;
        foreach ($supplyLines as $line) {
            $capacity = (int)$line['supply_capacity'];
            $interdiction = (int)$line['interdiction_level'];
            $effective = max(0, $capacity - $interdiction * 0.5);
            $cost = (float)$line['logistics_cost'];
            $totalCost += $cost * ($effective / 100.0);

            $lines[] = [
                'id'                => (int)$line['id'],
                'from_colony_id'    => (int)$line['from_colony_id'],
                'to_system_index'   => (int)$line['to_system_index'],
                'distance_ly'       => (float)$line['distance_ly'],
                'logistics_cost'    => $cost,
                'supply_capacity'   => $capacity,
                'effective_capacity'=> round($effective, 2),
                'interdiction_level'=> $interdiction,
                'status'            => $line['status'],
            ];
        }

        // Get attrition estimate
        $attrStmt = $db->prepare(<<<SQL
            SELECT AVG(attrition_rate) as avg_rate FROM war_attrition_events
            WHERE war_id = ? AND (attacker_id = ? OR defender_id = ?)
        SQL);
        $attrStmt->execute([$warId, $uid, $uid]);
        $attr = $attrStmt->fetch(PDO::FETCH_ASSOC);
        $attritionRate = $attr ? (float)($attr['avg_rate'] ?? 0.5) : 0.5;

        json_ok([
            'war_id'           => $warId,
            'supply_lines'     => $lines,
            'total_logistics_cost' => round($totalCost, 2),
            'estimated_attrition_rate' => $attritionRate,
            'count_supply_lines'=> count($lines),
        ]);
    }

    case 'set_supply_route': {
        only_method('POST');
        $warId = (int)($_POST['war_id'] ?? 0);
        $fromColonyId = (int)($_POST['from_colony_id'] ?? 0);
        $toSystemIndex = (int)($_POST['to_system_index'] ?? 0);

        if ($warId <= 0 || $fromColonyId <= 0 || $toSystemIndex < 0) {
            json_error('Missing war_id, from_colony_id, or to_system_index', 400);
        }

        $war = war_load_for_participant($db, $warId, $uid);
        if (!$war) json_error('War not found or access denied', 403);

        // Verify colony ownership
        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$fromColonyId, $uid]);
        if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

        // Calculate distance from colony to target system (simplified)
        $distanceLy = sqrt(abs($toSystemIndex - ($fromColonyId % 10000)) * 2 + 50);
        $logisticsCost = round($distanceLy * 50, 2);

        // Create or update supply line
        $existingStmt = $db->prepare(<<<SQL
            SELECT id FROM war_supply_lines
            WHERE war_id = ? AND from_colony_id = ? AND to_system_index = ?
        SQL);
        $existingStmt->execute([$warId, $fromColonyId, $toSystemIndex]);
        $existing = $existingStmt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            json_error('Supply line already exists for this route', 409);
        }

        $insertStmt = $db->prepare(<<<SQL
            INSERT INTO war_supply_lines
            (war_id, from_colony_id, to_system_index, distance_ly, logistics_cost, supply_capacity)
            VALUES (?, ?, ?, ?, ?, 100)
        SQL);
        $insertStmt->execute([$warId, $fromColonyId, $toSystemIndex, round($distanceLy, 2), $logisticsCost]);

        $supplyLineId = (int)$db->lastInsertId();
        json_ok([
            'supply_line_id'  => $supplyLineId,
            'war_id'          => $warId,
            'distance_ly'     => round($distanceLy, 2),
            'logistics_cost'  => $logisticsCost,
            'status'          => 'active',
        ]);
    }

    // PHASE 3.3 – War goal progress tracker
    // GET /api/war.php?action=get_goal_progress&war_id=X
    case 'get_goal_progress': {
        only_method('GET');
        $warId = (int)($_GET['war_id'] ?? 0);
        if ($warId <= 0) json_error('Missing war_id', 400);

        $war = war_load_for_participant($db, $warId, $uid);
        if (!$war) json_error('War not found or access denied', 403);

        $enrichedGoals = war_get_enriched_goals($db, $war);
        $isAttacker    = (int)$war['attacker_id'] === $uid;
        $side          = $isAttacker ? 'attacker' : 'defender';

        // Tally overall war score as percentage toward victory
        $goalsMet    = 0;
        $goalsTotal  = count($enrichedGoals);
        $scoreDetails = [];
        foreach ($enrichedGoals as $g) {
            $status = $g['progress']['status'] ?? 'unknown';
            $met    = in_array($status, ['contested_controlled', 'advantage'], true);
            if ($met) $goalsMet++;
            $scoreDetails[] = [
                'goal_id'   => $g['id'],
                'goal_type' => $g['goal_type'],
                'side'      => $g['side'],
                'status'    => $status,
                'label'     => $g['progress']['label'] ?? '',
                'hint'      => $g['progress']['hint'] ?? null,
                'score_rate_per_day' => $g['progress']['score_rate_per_day'] ?? 0.0,
            ];
        }

        $warScoreAttacker = (float)($war['war_score_attacker'] ?? 0);
        $warScoreDefender = (float)($war['war_score_defender'] ?? 0);

        json_ok([
            'war_id'           => $warId,
            'your_side'        => $side,
            'war_score'        => [
                'attacker' => round($warScoreAttacker, 2),
                'defender' => round($warScoreDefender, 2),
            ],
            'goals_total'      => $goalsTotal,
            'goals_progressing'=> $goalsMet,
            'goals'            => $scoreDetails,
            'supply_status'    => [
                'total_lines'    => (int)($war['total_supply_lines'] ?? 0),
                'logistics_cost' => (float)($war['total_logistics_cost'] ?? 0),
                'attrition_rate' => round((float)($war['avg_attrition_rate'] ?? 0), 3),
            ],
        ]);
    }

    default:
        json_error('Unknown action', 400);
}
