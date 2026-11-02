<?php
/**
 * Shared Projector Runtime – Phase 3: Outbox-Standardisierung
 *
 * Provides the shared technical foundation for all projection workers:
 *  - enqueue_projection_dirty()    Generic idempotent enqueue with coalescing.
 *  - claim_batch()                 Worker-safe batch claiming (queued → processing).
 *  - mark_done()                   Remove a successfully processed queue entry.
 *  - mark_failed()                 Apply exponential backoff or promote to dead-letter.
 *  - projection_backoff_seconds()  Compute exponential backoff duration.
 *  - parse_worker_args()           Parse standard CLI arguments for all workers.
 *
 * Queue status lifecycle:
 *   queued → processing → (deleted on success)
 *                       → queued (retry after backoff)
 *                       → failed (dead-letter after max attempts)
 *
 * Coalescing: a UNIQUE KEY on (entity_type, entity_id) ensures only one row
 * exists per entity.  If a write path enqueues an entity that is currently
 * being processed, the status resets to 'queued' so it is re-processed after
 * the current run.  mark_done() only deletes rows still in 'processing' state,
 * so re-queued rows survive and are picked up by the next batch.
 *
 * Logging conventions (stderr-safe, visible in error_log):
 *  [projection_runtime] enqueue  entity=<type>/<id>  reason=<reason>
 *  [projection_runtime] claim    entity_type=<type>  claimed=<n>
 *  [projection_runtime] done     queue_id=<id>
 *  [projection_runtime] retry    queue_id=<id>  attempt=<n>  next=<datetime>
 *  [projection_runtime] dead_letter  queue_id=<id>  attempts=<n>  err=<msg>
 */

declare(strict_types=1);

/**
 * Enqueue an entity into the shared dirty queue so the appropriate projection
 * worker re-computes its read-model.
 *
 * Idempotent / coalescing: if the entity is already queued the existing row
 * is kept but reason and next_attempt_at are reset.  If the entity is currently
 * being processed (status='processing'), the status is reset to 'queued' so
 * the entity is re-processed after the current run completes.
 *
 * @param PDO         $db          Database connection.
 * @param string      $entityType  Logical type, e.g. 'user' or 'system'.
 * @param int         $entityId    Primary key of the entity.
 * @param string      $reason      Short label for why this was enqueued (e.g. 'fleet_sent').
 * @param string      $eventType   Optional event/trigger classifier (e.g. 'colony_updated').
 * @param string|null $payloadJson Optional supplementary JSON payload for the worker.
 */
function enqueue_projection_dirty(
    PDO $db,
    string $entityType,
    int $entityId,
    string $reason = '',
    string $eventType = '',
    ?string $payloadJson = null,
): void {
    try {
        $db->prepare(
            'INSERT INTO projection_dirty_queue
                 (entity_type, entity_id, event_type, reason, payload_json,
                  status, attempts, next_attempt_at, created_at)
             VALUES (?, ?, ?, ?, ?, \'queued\', 0, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                 event_type      = VALUES(event_type),
                 reason          = VALUES(reason),
                 payload_json    = VALUES(payload_json),
                 status          = \'queued\',
                 claim_token     = NULL,
                 attempts        = 0,
                 last_error      = NULL,
                 next_attempt_at = NOW()'
        )->execute([$entityType, $entityId, $eventType, $reason, $payloadJson]);
        error_log(sprintf(
            '[projection_runtime] enqueue  entity=%s/%d  reason=%s',
            $entityType, $entityId, $reason,
        ));
    } catch (Throwable $e) {
        // Non-fatal: dirty-queue failure must never break the write path.
        error_log(sprintf(
            '[projection_runtime] enqueue_error  entity=%s/%d  err=%s',
            $entityType, $entityId, $e->getMessage(),
        ));
    }
}

/**
 * Atomically claim a batch of queued entries for a given entity type.
 *
 * Uses a SELECT … FOR UPDATE inside a transaction to prevent two concurrent
 * workers from processing the same row.  Claimed rows are transitioned from
 * status='queued' to status='processing'.
 *
 * @param PDO    $db         Database connection.
 * @param string $entityType Entity type to filter on (e.g. 'user', 'system').
 * @param int    $batchSize  Maximum number of rows to claim in one call.
 * @return list<array{id:string,entity_id:string,event_type:string,reason:string,payload_json:string|null,
 *     attempts:string,claim_token:string}>
 *               The claimed rows.  Returns an empty array when nothing is due.
 * @throws Throwable  Re-throws any DB exception after rolling back.
 */
function claim_batch(PDO $db, string $entityType, int $batchSize): array
{
    $db->beginTransaction();
    try {
        $now = date('Y-m-d H:i:s');

        $stmt = $db->prepare(
            'SELECT id, entity_id, event_type, reason, payload_json, attempts
             FROM projection_dirty_queue
             WHERE entity_type = ? AND status = \'queued\' AND next_attempt_at <= ?
             ORDER BY next_attempt_at ASC
             LIMIT ' . (int)$batchSize . '
             FOR UPDATE'
        );
        $stmt->execute([$entityType, $now]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (empty($rows)) {
            $db->commit();
            return [];
        }

        $ids          = array_column($rows, 'id');
        $token        = bin2hex(random_bytes(32));
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $db->prepare(
            "UPDATE projection_dirty_queue
             SET status = 'processing', claim_token = ?, updated_at = NOW()
             WHERE id IN ($placeholders)"
        )->execute([$token, ...$ids]);
        foreach ($rows as &$row) {
            $row['claim_token'] = $token;
        }
        unset($row);

        $db->commit();

        error_log(sprintf(
            '[projection_runtime] claim  entity_type=%s  claimed=%d',
            $entityType, count($rows),
        ));

        return $rows;
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

/**
 * Mark a successfully processed queue entry as done and remove it.
 *
 * Only deletes the row if it is still processing under the same claim token.
 * A producer re-enqueue or subsequent claim leaves the row intact.
 *
 * @param PDO $db       Database connection.
 * @param int $queueId  The queue row id returned by claim_batch().
 */
function mark_done(PDO $db, int $queueId, string $claimToken): bool
{
    validate_projection_claim_token($claimToken);
    $statement = $db->prepare(
        'DELETE FROM projection_dirty_queue WHERE id = ? AND status = \'processing\' AND claim_token = ?'
    );
    $statement->execute([$queueId, $claimToken]);
    if ($statement->rowCount() === 0) {
        error_log(sprintf('[projection_runtime] done_skipped  queue_id=%d  reason=claim_mismatch', $queueId));
        return false;
    }
    error_log(sprintf('[projection_runtime] done  queue_id=%d', $queueId));
    return true;
}

/**
 * Publish only while owning the locked claim, committing the write and ack together.
 *
 * Payload building belongs outside this transaction. The callback must only
 * write transactional read-model tables on the supplied connection, without DDL
 * or transaction control. Workers preflight canonical InnoDB storage.
 *
 * @param callable(PDO):void $writeProjection
 * @return bool False when the claim has been superseded; no callback is run.
 */
function complete_projection_claim(
    PDO $db,
    int $queueId,
    string $claimToken,
    callable $writeProjection,
): bool {
    validate_projection_claim_token($claimToken);
    assert_projection_completion_available($db);
    $db->beginTransaction();
    try {
        $statement = $db->prepare(
            'SELECT id FROM projection_dirty_queue
             WHERE id = ? AND status = \'processing\' AND claim_token = ? FOR UPDATE'
        );
        try {
            $statement->execute([$queueId, $claimToken]);
            $owned = $statement->fetchColumn() !== false;
        } finally {
            $statement->closeCursor();
        }
        if (!$owned) {
            $db->rollBack();
            error_log(sprintf('[projection_runtime] completion_skipped  queue_id=%d  reason=claim_mismatch', $queueId));
            return false;
        }
        $writeProjection($db);
        if (!mark_done($db, $queueId, $claimToken)) {
            throw new RuntimeException('Projection claim changed during locked completion.');
        }
        $db->commit();
        error_log(sprintf('[projection_runtime] completion_committed  queue_id=%d', $queueId));
        return true;
    } catch (Throwable $e) {
        $transactionActive = $db->inTransaction();
        if ($transactionActive) {
            try {
                $db->rollBack();
            } catch (PDOException $rollbackError) {
                error_log(sprintf(
                    '[projection_runtime] completion_rollback_error  queue_id=%d  err=%s',
                    $queueId,
                    $rollbackError->getMessage(),
                ));
            }
        }
        throw $e;
    }
}

function assert_projection_completion_available(PDO $db): void
{
    if ($db->inTransaction()) {
        throw new RuntimeException('Projection completion requires its own transaction.');
    }
}

/**
 * Record a processing failure for a queue entry.
 *
 * If the attempt count is below the configured maximum, the row is returned
 * to status='queued' with an exponential backoff on next_attempt_at.
 * Once the maximum is reached the row is promoted to status='failed'
 * (dead-letter) and will not be retried automatically.
 * Only processing rows are changed; a new enqueue or completed transition wins.
 * The claim token fences an older worker after a subsequent claim.
 *
 * @param PDO    $db            Database connection.
 * @param int    $queueId       The queue row id returned by claim_batch().
 * @param int    $attempt       The attempt number that just failed (1-based).
 * @param string $errMsg        Short error description to record.
 * @param int    $baseBackoffSec Base backoff in seconds (doubles per attempt, capped at 64×).
 */
function mark_failed(
    PDO $db,
    int $queueId,
    int $attempt,
    string $errMsg,
    int $baseBackoffSec,
    string $claimToken,
): void {
    validate_projection_claim_token($claimToken);
    $maxAttempts = defined('PROJECTION_MAX_ATTEMPTS') ? (int)PROJECTION_MAX_ATTEMPTS : 10;

    if ($attempt >= $maxAttempts) {
        // Promote to dead-letter – no further automatic retries.
        $statement = $db->prepare(
            'UPDATE projection_dirty_queue
             SET status = \'failed\', claim_token = NULL, attempts = ?, last_error = ?, updated_at = NOW()
             WHERE id = ? AND status = \'processing\' AND claim_token = ?'
        );
        $statement->execute([$attempt, $errMsg, $queueId, $claimToken]);
        if ($statement->rowCount() === 0) {
            error_log(sprintf('[projection_runtime] failure_skipped  queue_id=%d  reason=claim_mismatch', $queueId));
            return;
        }
        error_log(sprintf(
            '[projection_runtime] dead_letter  queue_id=%d  attempts=%d  err=%s',
            $queueId, $attempt, $errMsg,
        ));
    } else {
        $backoffSec  = projection_backoff_seconds($attempt, $baseBackoffSec);
        $nextAttempt = date('Y-m-d H:i:s', time() + $backoffSec);
        $statement = $db->prepare(
            'UPDATE projection_dirty_queue
             SET status = \'queued\', claim_token = NULL, attempts = ?, last_error = ?,
                 next_attempt_at = ?, updated_at = NOW()
             WHERE id = ? AND status = \'processing\' AND claim_token = ?'
        );
        $statement->execute([$attempt, $errMsg, $nextAttempt, $queueId, $claimToken]);
        if ($statement->rowCount() === 0) {
            error_log(sprintf('[projection_runtime] failure_skipped  queue_id=%d  reason=claim_mismatch', $queueId));
            return;
        }
        error_log(sprintf(
            '[projection_runtime] retry  queue_id=%d  attempt=%d  next=%s',
            $queueId, $attempt, $nextAttempt,
        ));
    }
}

function validate_projection_claim_token(string $token): void
{
    if (!preg_match('/^[a-f0-9]{64}$/D', $token)) {
        throw new InvalidArgumentException('Invalid projection claim token.');
    }
}

/**
 * Compute exponential backoff duration in seconds.
 *
 * Formula: baseSeconds × 2^(attempt−1), capped at 64× base.
 * Examples (base=30s): attempt 1→30s, 2→60s, 3→120s, …, 7+→1920s.
 *
 * @param int $attempt     1-based attempt counter (the attempt that just failed).
 * @param int $baseSeconds Base delay in seconds.
 * @return int             Backoff duration in seconds.
 */
function projection_backoff_seconds(int $attempt, int $baseSeconds): int
{
    return $baseSeconds * (1 << min($attempt - 1, 6)); // cap at 64× base
}

/**
 * Parse standard CLI arguments for all projection workers.
 *
 * Supported flags:
 *   --batch=N          Max queue entries to claim per run  (default 50).
 *   --max-seconds=N    Soft wall-clock time limit in seconds (default 0 = no limit).
 *   --max-items=N      Item processing cap (default 0 = no limit).
 *   --dry-run          Read queue and log intent but skip all writes (default false).
 *
 * @param  array<string> $argv  The $argv superglobal (or a test substitute).
 * @return array{batch:int,max-seconds:int,max-items:int,dry-run:bool}
 */
function parse_worker_args(array $argv, int $defaultBatch = 50): array
{
    if ($defaultBatch < 1) {
        throw new InvalidArgumentException('Configured projection batch size must be positive.');
    }
    $opts = [
        'batch'       => $defaultBatch,
        'max-seconds' => 0,
        'max-items'   => 0,
        'dry-run'     => false,
    ];

    $seen = [];
    foreach (array_slice($argv, 1) as $arg) {
        if ($arg === '--dry-run') {
            $key = 'dry-run';
            $value = true;
        } elseif (preg_match('/^--(batch|max-seconds|max-items)=([0-9]+)$/D', $arg, $match)) {
            $key = $match[1];
            $digits = ltrim($match[2], '0');
            $digits = $digits === '' ? '0' : $digits;
            $maximum = (string)PHP_INT_MAX;
            if (
                strlen($digits) > strlen($maximum)
                || (strlen($digits) === strlen($maximum) && strcmp($digits, $maximum) > 0)
            ) {
                throw new InvalidArgumentException('Projection option --' . $key . ' exceeds the integer range.');
            }
            $value = (int)$digits;
            if ($key === 'batch' && $value === 0) {
                throw new InvalidArgumentException('Projection option --batch must be positive.');
            }
        } else {
            throw new InvalidArgumentException(
                'Unknown or invalid projection argument; use --help for supported options.'
            );
        }
        if (isset($seen[$key])) {
            throw new InvalidArgumentException('Duplicate projection option --' . $key . '.');
        }
        $seen[$key] = true;
        $opts[$key] = $value;
    }

    return $opts;
}

function projection_worker_usage(): string
{
    return "Usage: php <projector.php> [--batch=N] [--max-seconds=N] [--max-items=N] [--dry-run]\n"
        . "       php <projector.php> --help\n"
        . "N must be an integer within PHP_INT_MAX; batch > 0; other limits >= 0 (0 = unlimited).\n"
        . "Batch defaults to worker configuration; each option is accepted once, in --name=value form.\n"
        . "Dry runs do not claim or write. Time limits are soft and checked before claiming.\n";
}
