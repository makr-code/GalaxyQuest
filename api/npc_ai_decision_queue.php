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
    $stmt = $db->query("SHOW TABLES LIKE 'npc_ai_decision_queue'");
    return (bool) $stmt->fetchColumn();
}

function npc_ai_decision_queue_supports_worker_claim_fields(PDO $db): bool
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'npc_ai_decision_queue'
           AND COLUMN_NAME IN ('claimed_by_worker_id', 'claim_token', 'claim_expires_at')"
    );
    $stmt->execute();
    return ((int) $stmt->fetchColumn()) === 3;
}

function npc_ai_decision_dedupe_key(int $userId, int $factionId): string
{
    return sprintf('npc_ai:user:%d:faction:%d', $userId, $factionId);
}

function npc_ai_decision_queue_dedupe_lock_name(string $dedupeKey): string
{
    return 'gq:npcq:' . substr(hash('sha256', $dedupeKey), 0, 48);
}

function npc_ai_decision_queue_normalize_limit(int $limit): int
{
    return max(1, min(100, $limit));
}

function npc_ai_decision_queue_claim_ttl_seconds(int $configuredTtl, int $controllerTimeout, int $limit): int
{
    $jobBudgetSeconds = max(4, $controllerTimeout) + 30;
    $batchBudgetSeconds = npc_ai_decision_queue_normalize_limit($limit) * $jobBudgetSeconds;
    return max(60, $configuredTtl, $batchBudgetSeconds);
}

function npc_ai_decision_queue_failure_status(int $attempts, int $maxAttempts): string
{
    return $attempts >= $maxAttempts ? 'dead' : 'failed';
}

/**
 * @return 'success'|'failed'|'rejected'
 */
function npc_ai_decision_queue_worker_outcome(bool $accepted, bool $ok): string
{
    if (!$accepted) {
        return 'rejected';
    }

    return $ok ? 'success' : 'failed';
}

function npc_ai_decision_queue_worker_batch_ok(int $failed, int $rejected): bool
{
    return $failed === 0 && $rejected === 0;
}

function npc_ai_decision_queue_normalize_worker_id(?string $workerId): ?string
{
    if ($workerId === null) {
        return null;
    }

    $workerId = trim($workerId);
    if ($workerId === '') {
        return null;
    }

    if (!preg_match('/^[a-zA-Z0-9:_-]{3,64}$/', $workerId)) {
        return null;
    }

    return $workerId;
}

function npc_ai_decision_queue_generate_claim_token(string $workerId, int $queueId): string
{
    return hash('sha256', $workerId . ':' . $queueId . ':' . bin2hex(random_bytes(16)));
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
    $lockName = npc_ai_decision_queue_dedupe_lock_name($dedupeKey);
    $acquire = $db->prepare('SELECT GET_LOCK(?, 5)');
    $acquire->execute([$lockName]);
    if ((int) $acquire->fetchColumn() !== 1) {
        return ['queued' => false, 'reason' => 'lock_busy'];
    }

    try {
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
        if ($payload === false) {
            throw new RuntimeException('NPC decision queue payload could not be encoded.');
        }

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
    } finally {
        $release = $db->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
        if ((int) $release->fetchColumn() !== 1) {
            throw new RuntimeException('NPC decision queue deduplication lock could not be released.');
        }
    }
}

/**
 * @return array<int,array<string,mixed>>
 */
function npc_ai_decision_queue_claim(PDO $db, int $limit, ?string $workerId = null): array
{
    if (!npc_ai_decision_queue_enabled() || !npc_ai_decision_queue_available($db)) {
        return [];
    }

    $limit = npc_ai_decision_queue_normalize_limit($limit);
    $workerId = npc_ai_decision_queue_normalize_worker_id($workerId);
    $claimed = npc_ai_decision_queue_claim_with_locking($db, $limit, $workerId);

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
 * @return array<int,array<string,mixed>>
 */
function npc_ai_decision_queue_claim_with_locking(PDO $db, int $limit, ?string $workerId = null): array
{
    $limit = npc_ai_decision_queue_normalize_limit($limit);
    $workerId = npc_ai_decision_queue_normalize_worker_id($workerId);
    if ($workerId === null) {
        throw new InvalidArgumentException('A valid NPC worker ID is required to claim jobs.');
    }

    $claimed = [];
    if (!npc_ai_decision_queue_supports_worker_claim_fields($db)) {
        throw new RuntimeException('NPC worker claim schema is unavailable.');
    }
    $claimTtlSeconds = npc_ai_decision_queue_claim_ttl_seconds(
        (int) NPC_AI_WORKER_CLAIM_TTL_SECONDS,
        (int) NPC_LLM_CONTROLLER_TIMEOUT_SECONDS,
        $limit
    );

    try {
        $db->beginTransaction();
        $exhausted = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'dead',
                 locked_at = NULL,
                 completed_at = NOW(),
                 error_message = 'Worker claim expired after maximum attempts.',
                 claimed_by_worker_id = NULL,
                 claim_token = NULL,
                 claim_expires_at = NULL
             WHERE status = 'processing'
               AND claim_expires_at IS NOT NULL
               AND claim_expires_at < NOW()
               AND attempts >= max_attempts"
        );
        $exhausted->execute();

        $retryable = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'queued',
                 locked_at = NULL,
                 available_at = NOW(),
                 error_message = 'Worker claim expired before completion.',
                 claimed_by_worker_id = NULL,
                 claim_token = NULL,
                 claim_expires_at = NULL
             WHERE status = 'processing'
               AND claim_expires_at IS NOT NULL
               AND claim_expires_at < NOW()
               AND attempts < max_attempts"
        );
        $retryable->execute();

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

        $claimed = npc_ai_decision_queue_apply_claim_updates(
            $db,
            $rows,
            $workerId,
            $claimTtlSeconds
        );

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }

    return $claimed;
}

/**
 * @param array<int,array<string,mixed>> $rows
 * @return array<int,array<string,mixed>>
 */
function npc_ai_decision_queue_apply_claim_updates(
    PDO $db,
    array $rows,
    string $workerId,
    int $claimTtlSeconds
): array {
    $claimed = [];
    $workerUpdate = $db->prepare(
        "UPDATE npc_ai_decision_queue
         SET status = 'processing',
             locked_at = NOW(),
             attempts = attempts + 1,
             claimed_by_worker_id = ?,
             claim_token = ?,
             claim_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
         WHERE id = ? AND status = 'queued'"
    );

    foreach ($rows as $row) {
        $id = (int) ($row['id'] ?? 0);
        if ($id <= 0) {
            continue;
        }

        $claimToken = npc_ai_decision_queue_generate_claim_token($workerId, $id);
        $workerUpdate->execute([$workerId, $claimToken, $claimTtlSeconds, $id]);
        if ($workerUpdate->rowCount() === 1) {
            $row['claim_token'] = $claimToken;
            $claimed[] = $row;
        }
    }

    return $claimed;
}

/**
 * @param array<string,mixed> $result
 */
function npc_ai_decision_queue_complete(
    PDO $db,
    int $queueId,
    bool $ok,
    array $result = [],
    string $errorMessage = ''
): void {
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

function npc_ai_decision_queue_begin_fenced_completion(
    PDO $db,
    int $queueId,
    string $workerId,
    string $claimToken
): bool {
    if ($queueId <= 0 || !npc_ai_decision_queue_supports_worker_claim_fields($db)) {
        return false;
    }

    $workerId = npc_ai_decision_queue_normalize_worker_id($workerId);
    if ($workerId === null || !preg_match('/^[a-f0-9]{64}$/', $claimToken)) {
        return false;
    }
    if ($db->inTransaction()) {
        throw new LogicException('NPC worker fenced completion requires an independent transaction.');
    }

    $db->beginTransaction();
    try {
        $claimStmt = $db->prepare(
            "SELECT id
             FROM npc_ai_decision_queue
             WHERE id = ?
               AND status = 'processing'
               AND claimed_by_worker_id = ?
               AND claim_token = ?
               AND claim_expires_at >= NOW()
             LIMIT 1
             FOR UPDATE"
        );
        $claimStmt->execute([$queueId, $workerId, $claimToken]);
        if ($claimStmt->fetchColumn() === false) {
            $db->rollBack();
            return false;
        }

        $renew = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET claim_expires_at = GREATEST(claim_expires_at, DATE_ADD(NOW(), INTERVAL 60 SECOND))
             WHERE id = ?
               AND status = 'processing'
               AND claimed_by_worker_id = ?
               AND claim_token = ?
               AND claim_expires_at >= NOW()"
        );
        $renew->execute([$queueId, $workerId, $claimToken]);
        return true;
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

/**
 * @param array<string,mixed> $result
 */
function npc_ai_decision_queue_complete_claimed(
    PDO $db,
    int $queueId,
    string $workerId,
    string $claimToken,
    bool $ok,
    array $result = [],
    string $errorMessage = ''
): bool {
    if ($queueId <= 0 || !npc_ai_decision_queue_available($db)) {
        return false;
    }
    if (!npc_ai_decision_queue_supports_worker_claim_fields($db)) {
        return false;
    }

    $workerId = npc_ai_decision_queue_normalize_worker_id($workerId);
    if ($workerId === null || !preg_match('/^[a-f0-9]{64}$/', $claimToken)) {
        return false;
    }

    $claimStmt = $db->prepare(
        "SELECT attempts, max_attempts
         FROM npc_ai_decision_queue
         WHERE id = ?
           AND status = 'processing'
           AND claimed_by_worker_id = ?
           AND claim_token = ?
           AND (claim_expires_at IS NULL OR claim_expires_at >= NOW())
         LIMIT 1"
    );
    $claimStmt->execute([$queueId, $workerId, $claimToken]);
    $claimRow = $claimStmt->fetch(PDO::FETCH_ASSOC);
    if (!$claimRow) {
        return false;
    }

    $resultJson = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($ok) {
        $done = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'done',
                 completed_at = NOW(),
                 error_message = '',
                 result_json = ?,
                 claimed_by_worker_id = NULL,
                 claim_token = NULL,
                 claim_expires_at = NULL
             WHERE id = ?
               AND status = 'processing'
               AND claimed_by_worker_id = ?
               AND claim_token = ?
               AND (claim_expires_at IS NULL OR claim_expires_at >= NOW())"
        );
        $done->execute([$resultJson, $queueId, $workerId, $claimToken]);
        return $done->rowCount() === 1;
    }

    $failureStatus = npc_ai_decision_queue_failure_status(
        (int) ($claimRow['attempts'] ?? 0),
        max(1, (int) ($claimRow['max_attempts'] ?? 1))
    );
    $retryBackoffSeconds = max(10, (int) NPC_LLM_ASYNC_QUEUE_RETRY_BACKOFF_SECONDS);

    if ($failureStatus === 'failed') {
        $failed = $db->prepare(
            "UPDATE npc_ai_decision_queue
             SET status = 'queued',
                 locked_at = NULL,
                 completed_at = NULL,
                 available_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                 error_message = ?,
                 result_json = ?,
                 claimed_by_worker_id = NULL,
                 claim_token = NULL,
                 claim_expires_at = NULL
             WHERE id = ?
               AND status = 'processing'
               AND claimed_by_worker_id = ?
               AND claim_token = ?
               AND (claim_expires_at IS NULL OR claim_expires_at >= NOW())"
        );
        $failed->execute([
            $retryBackoffSeconds,
            substr($errorMessage, 0, 255),
            $resultJson,
            $queueId,
            $workerId,
            $claimToken,
        ]);
        return $failed->rowCount() === 1;
    }

    $dead = $db->prepare(
        "UPDATE npc_ai_decision_queue
         SET status = 'dead',
             completed_at = NOW(),
             error_message = ?,
             result_json = ?,
             claimed_by_worker_id = NULL,
             claim_token = NULL,
             claim_expires_at = NULL
         WHERE id = ?
           AND status = 'processing'
           AND claimed_by_worker_id = ?
           AND claim_token = ?
           AND (claim_expires_at IS NULL OR claim_expires_at >= NOW())"
    );
    $dead->execute([substr($errorMessage, 0, 255), $resultJson, $queueId, $workerId, $claimToken]);
    return $dead->rowCount() === 1;
}
