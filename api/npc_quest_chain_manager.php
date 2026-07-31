<?php

declare(strict_types=1);

/**
 * NPC Quest Chain Manager
 *
 * Manages quest dependencies, chains, and DAG (Directed Acyclic Graph) validation.
 * Handles parent-child quest relationships, sequencing, and escalation.
 */

require_once __DIR__ . '/helpers.php';

/**
 * Create a new quest chain specification
 *
 * @param PDO $db
 * @param array{
 *   code: string,
 *   title: string,
 *   description?: string,
 *   faction_id?: int,
 *   quest_ids: int[],
 *   is_sequential: bool,
 *   min_standing_threshold: int,
 *   reward_escalation: float
 * } $chainSpec
 * @return array{ok: bool, chain_id?: int, error?: string}
 */
function npc_quest_chain_create(PDO $db, array $chainSpec): array
{
    $code = (string) ($chainSpec['code'] ?? '');
    $title = (string) ($chainSpec['title'] ?? '');
    $description = (string) ($chainSpec['description'] ?? '');
    $factionId = (int) ($chainSpec['faction_id'] ?? 0);
    $questIds = (array) ($chainSpec['quest_ids'] ?? []);
    $isSequential = (bool) ($chainSpec['is_sequential'] ?? true);
    $minStanding = (int) ($chainSpec['min_standing_threshold'] ?? 0);
    $escalation = (float) ($chainSpec['reward_escalation'] ?? 1.2);

    if ($code === '' || $title === '' || empty($questIds)) {
        return ['ok' => false, 'error' => 'Missing required fields: code, title, quest_ids'];
    }

    // Validate all quest IDs exist
    foreach ($questIds as $qid) {
        $check = $db->prepare('SELECT id FROM faction_quests WHERE id = ? LIMIT 1');
        $check->execute([$qid]);
        if (!$check->fetch()) {
            return ['ok' => false, 'error' => "Quest ID {$qid} not found"];
        }
    }

    // Insert chain spec
    $stmt = $db->prepare(
        'INSERT INTO quest_chain_specs 
         (code, title, description, faction_id, quest_ids_ordered, is_sequential, min_standing_threshold, reward_escalation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    try {
        $stmt->execute([
            $code,
            $title,
            $description,
            $factionId ?: null,
            json_encode($questIds),
            $isSequential ? 1 : 0,
            $minStanding,
            $escalation,
        ]);

        $chainId = (int) $db->lastInsertId();

        // Update faction_quests to set chain relationships
        foreach ($questIds as $pos => $qid) {
            $parent = $pos > 0 ? $questIds[$pos - 1] : null;
            $db->prepare(
                'UPDATE faction_quests SET quest_chain_parent_id = ?, quest_chain_position = ? WHERE id = ?'
            )->execute([$parent, $pos, $qid]);
        }

        return ['ok' => true, 'chain_id' => $chainId];
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * Get quest chain details
 *
 * @param PDO $db
 * @param int $chainId
 * @return array|null
 */
function npc_quest_chain_get(PDO $db, int $chainId): ?array
{
    $stmt = $db->prepare('SELECT * FROM quest_chain_specs WHERE id = ? LIMIT 1');
    $stmt->execute([$chainId]);
    $row = $stmt->fetch(\PDO::FETCH_ASSOC);

    if (!$row) {
        return null;
    }

    $row['quest_ids_ordered'] = json_decode((string) $row['quest_ids_ordered'], true) ?? [];
    return $row;
}

/**
 * Validate a quest chain DAG (ensure no cycles, proper sequence)
 *
 * @param PDO $db
 * @param int $chainId
 * @return array{valid: bool, errors: string[]}
 */
function npc_quest_chain_validate(PDO $db, int $chainId): array
{
    $chain = npc_quest_chain_get($db, $chainId);
    if (!$chain) {
        return ['valid' => false, 'errors' => ['Chain not found']];
    }

    $questIds = (array) $chain['quest_ids_ordered'];
    $errors = [];

    // Check for duplicates
    if (count($questIds) !== count(array_unique($questIds))) {
        $errors[] = 'Duplicate quest IDs in chain';
    }

    // Check quest_chain_parent relationships
    foreach ($questIds as $pos => $qid) {
        $stmt = $db->prepare('SELECT quest_chain_parent_id, quest_chain_position FROM faction_quests WHERE id = ?');
        $stmt->execute([$qid]);
        $q = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$q) {
            $errors[] = "Quest {$qid} not found";
            continue;
        }

        $expectedParent = $pos > 0 ? $questIds[$pos - 1] : null;
        if ($q['quest_chain_parent_id'] !== $expectedParent) {
            $errors[] = "Quest {$qid} parent mismatch: expected {$expectedParent}, got {$q['quest_chain_parent_id']}";
        }

        if ((int) $q['quest_chain_position'] !== $pos) {
            $errors[] = "Quest {$qid} position mismatch: expected {$pos}, got {$q['quest_chain_position']}";
        }
    }

    return [
        'valid' => empty($errors),
        'errors' => $errors,
    ];
}

/**
 * Get the next quest in a chain for a player
 *
 * @param PDO $db
 * @param int $userId
 * @param int $chainId
 * @return array|null Next quest or null if chain complete
 */
function npc_quest_chain_get_next(PDO $db, int $userId, int $chainId): ?array
{
    $chain = npc_quest_chain_get($db, $chainId);
    if (!$chain) {
        return null;
    }

    $questIds = (array) $chain['quest_ids_ordered'];
    $isSequential = (bool) $chain['is_sequential'];

    foreach ($questIds as $qid) {
        // Check if user has this quest
        $userQuest = $db->prepare(
            'SELECT status FROM user_faction_quests WHERE user_id = ? AND faction_quest_id = ? LIMIT 1'
        );
        $userQuest->execute([$userId, $qid]);
        $uq = $userQuest->fetch(\PDO::FETCH_ASSOC);

        if (!$uq) {
            // User hasn't started this quest yet – it's the next one
            $questStmt = $db->prepare('SELECT * FROM faction_quests WHERE id = ? LIMIT 1');
            $questStmt->execute([$qid]);
            return $questStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        }

        // If sequential, stop at first non-completed
        if ($isSequential && $uq['status'] !== 'completed' && $uq['status'] !== 'claimed') {
            $questStmt = $db->prepare('SELECT * FROM faction_quests WHERE id = ? LIMIT 1');
            $questStmt->execute([$qid]);
            return $questStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        }

        // If not sequential, any non-completed quest counts as "next"
        if (!$isSequential && $uq['status'] !== 'completed' && $uq['status'] !== 'claimed') {
            $questStmt = $db->prepare('SELECT * FROM faction_quests WHERE id = ? LIMIT 1');
            $questStmt->execute([$qid]);
            return $questStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        }
    }

    // All quests completed
    return null;
}

/**
 * Calculate reward escalation for a quest in a chain
 *
 * @param PDO $db
 * @param int $chainId
 * @param int $questId
 * @return float Escalation multiplier
 */
function npc_quest_chain_reward_multiplier(PDO $db, int $chainId, int $questId): float
{
    $chain = npc_quest_chain_get($db, $chainId);
    if (!$chain) {
        return 1.0;
    }

    $questIds = (array) $chain['quest_ids_ordered'];
    $position = array_search($questId, $questIds);

    if ($position === false) {
        return 1.0;
    }

    $baseEscalation = (float) $chain['reward_escalation'];
    return $baseEscalation ** $position; // escalation^position
}

/**
 * Assign entire quest chain to a user
 *
 * @param PDO $db
 * @param int $userId
 * @param int $chainId
 * @return array{ok: bool, quests_assigned?: int[], error?: string}
 */
function npc_quest_chain_assign_to_user(PDO $db, int $userId, int $chainId): array
{
    $chain = npc_quest_chain_get($db, $chainId);
    if (!$chain) {
        return ['ok' => false, 'error' => 'Chain not found'];
    }

    $questIds = (array) $chain['quest_ids_ordered'];
    $assigned = [];

    try {
        foreach ($questIds as $qid) {
            // Check if already assigned
            $check = $db->prepare(
                'SELECT id FROM user_faction_quests WHERE user_id = ? AND faction_quest_id = ? LIMIT 1'
            );
            $check->execute([$userId, $qid]);

            if ($check->fetch()) {
                continue; // Already assigned
            }

            // Create new user quest
            $stmt = $db->prepare(
                'INSERT INTO user_faction_quests (user_id, faction_quest_id, status, progress_json)
                 VALUES (?, ?, ?, ?)'
            );
            $stmt->execute([$userId, $qid, 'active', '{}']);
            $assigned[] = $qid;
        }

        return ['ok' => true, 'quests_assigned' => $assigned];
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * Get chain progress for a user (how many completed?)
 *
 * @param PDO $db
 * @param int $userId
 * @param int $chainId
 * @return array{total: int, completed: int, progress_percent: float}
 */
function npc_quest_chain_progress(PDO $db, int $userId, int $chainId): array
{
    $chain = npc_quest_chain_get($db, $chainId);
    if (!$chain) {
        return ['total' => 0, 'completed' => 0, 'progress_percent' => 0.0];
    }

    $questIds = (array) $chain['quest_ids_ordered'];
    $completed = 0;

    foreach ($questIds as $qid) {
        $stmt = $db->prepare(
            'SELECT status FROM user_faction_quests WHERE user_id = ? AND faction_quest_id = ? LIMIT 1'
        );
        $stmt->execute([$userId, $qid]);
        $uq = $stmt->fetch(\PDO::FETCH_ASSOC);

        if ($uq && ($uq['status'] === 'completed' || $uq['status'] === 'claimed')) {
            $completed++;
        }
    }

    $total = count($questIds);
    $percent = $total > 0 ? ($completed / $total) * 100.0 : 0.0;

    return [
        'total' => $total,
        'completed' => $completed,
        'progress_percent' => round($percent, 1),
    ];
}
