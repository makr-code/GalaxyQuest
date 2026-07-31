<?php

declare(strict_types=1);

/**
 * NPC Quest Trigger Log
 *
 * Logs quest generation events: when NPCs create quests, why they created them,
 * and what chain they belong to. Used for debugging, analytics, and quest discovery.
 */

require_once __DIR__ . '/helpers.php';

/**
 * Log a quest generation event
 *
 * @param PDO $db
 * @param array{
 *   faction_id: int,
 *   user_id: int,
 *   quest_id?: int,
 *   trigger_reason: string,
 *   trigger_context?: array,
 *   chain_parent_id?: int,
 *   chain_position?: int
 * } $logData
 * @return array{ok: bool, log_id?: int, error?: string}
 */
function npc_quest_trigger_log_record(PDO $db, array $logData): array
{
    $factionId = (int) ($logData['faction_id'] ?? 0);
    $userId = (int) ($logData['user_id'] ?? 0);
    $questId = (int) ($logData['quest_id'] ?? 0);
    $reason = (string) ($logData['trigger_reason'] ?? '');
    $context = (array) ($logData['trigger_context'] ?? []);
    $chainParentId = (int) ($logData['chain_parent_id'] ?? 0);
    $chainPosition = (int) ($logData['chain_position'] ?? 0);

    if ($factionId === 0 || $userId === 0 || $reason === '') {
        return ['ok' => false, 'error' => 'Missing required fields: faction_id, user_id, trigger_reason'];
    }

    try {
        $stmt = $db->prepare(
            'INSERT INTO npc_quest_generation_log 
             (faction_id, user_id, quest_id, trigger_reason, trigger_context_json, chain_parent_id, chain_position)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );

        $stmt->execute([
            $factionId,
            $userId,
            $questId ?: null,
            $reason,
            json_encode($context),
            $chainParentId ?: null,
            $chainPosition,
        ]);

        $logId = (int) $db->lastInsertId();
        return ['ok' => true, 'log_id' => $logId];
    } catch (\Throwable $e) {
        error_log('npc_quest_trigger_log_record error: ' . $e->getMessage());
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * Get quest generation logs for a user (recent)
 *
 * @param PDO $db
 * @param int $userId
 * @param int $limit
 * @param int $offset
 * @return array<array<string, mixed>>
 */
function npc_quest_trigger_log_get_user(PDO $db, int $userId, int $limit = 50, int $offset = 0): array
{
    $stmt = $db->prepare(
        'SELECT * FROM npc_quest_generation_log
         WHERE user_id = ?
         ORDER BY generated_at DESC
         LIMIT ? OFFSET ?'
    );

    $stmt->execute([$userId, $limit, $offset]);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    foreach ($rows as &$row) {
        $row['trigger_context_json'] = json_decode((string) $row['trigger_context_json'], true) ?? [];
    }

    return $rows;
}

/**
 * Get quest generation logs for a faction (recent)
 *
 * @param PDO $db
 * @param int $factionId
 * @param int $limit
 * @return array<array<string, mixed>>
 */
function npc_quest_trigger_log_get_faction(PDO $db, int $factionId, int $limit = 100): array
{
    $stmt = $db->prepare(
        'SELECT * FROM npc_quest_generation_log
         WHERE faction_id = ?
         ORDER BY generated_at DESC
         LIMIT ?'
    );

    $stmt->execute([$factionId, $limit]);
    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    foreach ($rows as &$row) {
        $row['trigger_context_json'] = json_decode((string) $row['trigger_context_json'], true) ?? [];
    }

    return $rows;
}

/**
 * Get statistics on quest generation by trigger reason
 *
 * @param PDO $db
 * @param int|null $factionId If null, get global stats
 * @param string|null $since ISO 8601 timestamp, defaults to 24 hours ago
 * @return array{reason: string, count: int, avg_chain_length: float}[]
 */
function npc_quest_trigger_log_stats(PDO $db, ?int $factionId = null, ?string $since = null): array
{
    $since = $since ?? date('c', time() - 86400);

    $sql = 'SELECT 
              trigger_reason,
              COUNT(*) as count,
              AVG(chain_position) as avg_chain_length
            FROM npc_quest_generation_log
            WHERE generated_at >= ?';

    if ($factionId !== null) {
        $sql .= ' AND faction_id = ?';
    }

    $sql .= ' GROUP BY trigger_reason
             ORDER BY count DESC';

    $stmt = $db->prepare($sql);
    $params = [$since];
    if ($factionId !== null) {
        $params[] = $factionId;
    }
    $stmt->execute($params);

    $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);

    foreach ($rows as &$row) {
        $row['avg_chain_length'] = round((float) ($row['avg_chain_length'] ?? 0), 2);
    }

    return $rows;
}

/**
 * Get all trigger reasons (for filtering UI)
 *
 * @param PDO $db
 * @return string[]
 */
function npc_quest_trigger_reasons_list(PDO $db): array
{
    $stmt = $db->prepare(
        'SELECT DISTINCT trigger_reason FROM npc_quest_generation_log ORDER BY trigger_reason'
    );
    $stmt->execute();

    return array_column($stmt->fetchAll(\PDO::FETCH_ASSOC), 'trigger_reason');
}

/**
 * Clear old logs (older than X days)
 *
 * @param PDO $db
 * @param int $daysOld
 * @return int Number of deleted records
 */
function npc_quest_trigger_log_cleanup(PDO $db, int $daysOld = 30): int
{
    $cutoff = date('Y-m-d H:i:s', time() - ($daysOld * 86400));

    $stmt = $db->prepare('DELETE FROM npc_quest_generation_log WHERE generated_at < ?');
    $stmt->execute([$cutoff]);

    return $stmt->rowCount();
}
