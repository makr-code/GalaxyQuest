<?php

declare(strict_types=1);

/**
 * Async queue runtime for strategic NPC AI decisions.
 * Keeps simulation ticks non-blocking by deferring LLM work.
 */

function npc_ai_decision_queue_enabled(): bool
{
    return (int) NPC_LLM_ASYNC_QUEUE_ENABLED === 1;
}

function npc_ai_decision_queue_available(PDO $db): bool
{
    static $available = null;
    if ($available !== null) {
        return $available;
    }

    try {
        $stmt = $db->query("SHOW TABLES LIKE 'npc_ai_decision_queue'");
        $available = (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        $available = false;
    }

    return $available;
}

function npc_ai_decision_dedupe_key(int $userId, int $factionId): string
{
    return sprintf('npc_ai:user:%d:faction:%d', $userId, $factionId);
}

function npc_ai_decision_queue_normalize_limit(int $limit): int
{
    return max(1, min(100, $limit));
}

function npc_ai_decision_queue_failure_status(int $attempts, int $maxAttempts): string
{
    return $attempts >= $maxAttempts ? 'dead' : 'failed';
}

/**
 * @param array<string,mixed> $faction
 * @return array{queued:bool,reason:string,queue_id?:int}
 */
function npc_ai_decision_queue_maybe_enqueue(PDO $db, int $userId, array $faction): array
{
    if (!npc_ai_decision_queue_enabled()) {
        return ['queued' => false, 'reason' => 'disabled'];
    }
    if (!npc_ai_decision_queue_available($db)) {
        return ['queued' => false, 'reason' => 'table_missing'];
    }

    $factionId = (int) ($faction['id'] ?? 0);
    if ($factionId <= 0 || $userId <= 0) {
        return ['queued' => false, 'reason' => 'invalid_input'];
    }

    $dedupeKey = npc_ai_decision_dedupe_key($userId, $factionId);

    $pendingStmt = $db->prepare(
        "SELECT id FROM npc_ai_decision_queue
         WHERE dedupe_key = ?
           AND status IN ('queued', 'processing')
         ORDER BY id DESC
         LIMIT 1"
    );
    $pendingStmt->execute([$dedupeKey]);
    if ($pendingStmt->fetchColumn() !== false) {
        return ['queued' => false, 'reason' => 'already_pending'];
    }

    $cooldownSeconds = max(60, (int) NPC_LLM_ASYNC_QUEUE_COOLDOWN_SECONDS);
    $recentStmt = $db->prepare(
        "SELECT created_at FROM npc_ai_decision_queue
         WHERE dedupe_key = ?
         ORDER BY id DESC
         LIMIT 1"
    );
    $recentStmt->execute([$dedupeKey]);
    $recent = $recentStmt->fetchColumn();
    if ($recent) {
        $recentTs = strtotime((string) $recent);
        if ($recentTs !== false && (time() - $recentTs) < $cooldownSeconds) {
            return ['queued' => false, 'reason' => 'cooldown'];
        }
    }

    $payload = json_encode([
        'user_id' => $userId,
        'faction_id' => $factionId,
        'faction_code' => (string) ($faction['code'] ?? ''),
        'source' => 'simulation_user_tick',
        'lore_lock' => true,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    $insert = $db->prepare(
        "INSERT INTO npc_ai_decision_queue
         (user_id, faction_id, source_scope, status, attempts, max_attempts, available_at, dedupe_key, payload_json)
         VALUES (?, ?, 'simulation_user_tick', 'queued', 0, ?, NOW(), ?, ?)"
    );
    $insert->execute([
        $userId,
        $factionId,
        max(1, (int) NPC_LLM_ASYNC_QUEUE_MAX_ATTEMPTS),
        $dedupeKey,
        $payload,
    ]);

    return [
        'queued' => true,
        'reason' => 'queued',
        'queue_id' => (int) $db->lastInsertId(),
    ];
}

/**
 * @return array<int,array<string,mixed>>
 */
function npc_ai_decision_queue_claim(PDO $db, int $limit): array
{
    if (!npc_ai_decision_queue_enabled() || !npc_ai_decision_queue_available($db)) {
        return [];
    }

    $limit = npc_ai_decision_queue_normalize_limit($limit);
    $claimed = npc_ai_decision_queue_claim_with_locking($db, $limit);
    if ($claimed === null) {
        $claimed = npc_ai_decision_queue_claim_without_locking($db, $limit);
    }

    if (!$claimed) {
        return [];
    }

    foreach ($claimed as &$row) {
        $payload = [];
        if (!empty($row['payload_json'])) {
            $decoded = json_decode((string) $row['payload_json'], true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }
        $row['payload'] = $payload;
    }
    unset($row);

    return $claimed;
}

/**
 * @return array<int,array<string,mixed>>|null
 */
function npc_ai_decision_queue_claim_with_locking(PDO $db, int $limit): ?array
{
    $limit = npc_ai_decision_queue_normalize_limit($limit);
    $claimed = [];

    try {
        $db->beginTransaction();
        $select = $db->prepare(
            "SELECT id, user_id, faction_id, attempts, max_attempts, payload_json
             FROM npc_ai_decision_queue
             WHERE status = 'queued'
               AND available_at <= NOW()
             ORDER BY id ASC
             LIMIT :limit
             FOR UPDATE SKIP LOCKED"
        );
        $select->bindValue(':limit', $limit, PDO::PARAM_INT);
        $select->execute();
        $rows = $select ? ($select->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];

        foreach ($rows as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            $update = $db->prepare(
                "UPDATE npc_ai_decision_queue
                 SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
                 WHERE id = ? AND status = 'queued'"
            );
            $update->execute([$id]);
            if ($update->rowCount() === 1) {
                $claimed[] = $row;
            }
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        return null;
    }

    return $claimed;
}

/**
 * @return array<int,array<string,mixed>>
 */
function npc_ai_decision_queue_claim_without_locking(PDO $db, int $limit): array
{
    $limit = npc_ai_decision_queue_normalize_limit($limit);
    $select = $db->prepare(
        "SELECT id, user_id, faction_id, attempts, max_attempts, payload_json
         FROM npc_ai_decision_queue
         WHERE status = 'queued'
           AND available_at <= NOW()
         ORDER BY id ASC
         LIMIT :limit"
    );
    $select->bindValue(':limit', $limit, PDO::PARAM_INT);
    $select->execute();
    $rows = $select->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (!$rows) {
        return [];
    }

    $claimed = [];
    foreach ($rows as $row) {
        $id = (int) ($row['id'] ?? 0);
        if ($id <= 0) {
            continue;
        }
        $update = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
             WHERE id = ? AND status = 'queued'"
        );
        $update->execute([$id]);
        if ($update->rowCount() === 1) {
            $claimed[] = $row;
        }
    }

    return $claimed;
}

/**
 * @param array<string,mixed> $result
 */
function npc_ai_decision_queue_complete(PDO $db, int $queueId, bool $ok, array $result = [], string $errorMessage = ''): void
{
    if ($queueId <= 0 || !npc_ai_decision_queue_available($db)) {
        return;
    }

    $resultJson = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($ok) {
        $stmt = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'done',
                 completed_at = NOW(),
                 error_message = '',
                 result_json = ?
             WHERE id = ?"
        );
        $stmt->execute([$resultJson, $queueId]);
        return;
    }

    $attemptStmt = $db->prepare('SELECT attempts, max_attempts FROM npc_ai_decision_queue WHERE id = ? LIMIT 1');
    $attemptStmt->execute([$queueId]);
    $attemptRow = $attemptStmt->fetch(PDO::FETCH_ASSOC) ?: ['attempts' => 0, 'max_attempts' => 1];
    $failureStatus = npc_ai_decision_queue_failure_status(
        (int) ($attemptRow['attempts'] ?? 0),
        max(1, (int) ($attemptRow['max_attempts'] ?? 1))
    );
    $retryBackoffSeconds = max(10, (int) NPC_LLM_ASYNC_QUEUE_RETRY_BACKOFF_SECONDS);

    if ($failureStatus === 'failed') {
        $stmt = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'queued',
                 locked_at = NULL,
                 completed_at = NULL,
                 available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 error_message = ?,
                 result_json = ?
             WHERE id = ?"
        );
        $stmt->execute([$retryBackoffSeconds, substr($errorMessage, 0, 255), $resultJson, $queueId]);
        return;
    }

    $stmt = $db->prepare(
        "UPDATE npc_ai_decision_queue
         SET status = 'dead',
             completed_at = NOW(),
             error_message = ?,
             result_json = ?
         WHERE id = ?"
    );
    $stmt->execute([substr($errorMessage, 0, 255), $resultJson, $queueId]);
}
