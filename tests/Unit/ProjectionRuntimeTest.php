<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the shared Projector Runtime (Phase 3).
 *
 * Exercises the pure/logic parts of lib/projection_runtime.php that can be
 * validated without a live database connection:
 *  - enqueue_projection_dirty()  – generic idempotent enqueue with coalescing
 *  - claim_batch()               – worker-safe batch claiming
 *  - mark_done()                 – success path: remove processing entry
 *  - mark_failed()               – retry path and dead-letter promotion
 *  - projection_backoff_seconds() – exponential backoff calculation
 *  - parse_worker_args()         – CLI argument parsing
 */
final class ProjectionRuntimeTest extends TestCase
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns a PDO stub that records executed queries and parameters.
     * Supports beginTransaction / commit / rollBack for claim_batch().
     *
     * @param array<int,array{sql:string,params:array<mixed>}> &$log  Populated by reference.
     */
    private function makePdoStub(array &$log, mixed $fetchAllReturn = []): object
    {
        $log = [];

        $stmtStub = new class ($log, $fetchAllReturn) {
            /** @param array<int,array{sql:string,params:array<mixed>}> &$log  Populated by reference. */
            public function __construct(
                private array &$log,
                private mixed $fetchAllReturn,
                public string $lastSql = '',
            ) {}

            /** @param array<mixed> $params */
            public function execute(array $params = []): bool
            {
                $this->log[] = ['sql' => $this->lastSql, 'params' => $params];
                return true;
            }

            public function fetch(int $mode = PDO::FETCH_ASSOC): mixed
            {
                return false;
            }

            public function fetchAll(int $mode = PDO::FETCH_ASSOC): array
            {
                return is_array($this->fetchAllReturn) ? $this->fetchAllReturn : [];
            }

            public function fetchColumn(int $column = 0): mixed
            {
                return false;
            }
        };

        $pdoStub = new class ($log, $stmtStub) extends PDO {
            /** @param array<int,array{sql:string,params:array<mixed>}> $log */
            public function __construct(
                private array &$log,
                private object $stmtStub,
            ) {
                // Intentionally bypass PDO::__construct.
            }

            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = [])
            {
                $this->stmtStub->lastSql = $sql;
                return $this->stmtStub;
            }

            public function lastInsertId(?string $name = null): string
            {
                return '0';
            }

            public function beginTransaction(): bool
            {
                return true;
            }

            public function commit(): bool
            {
                return true;
            }

            public function rollBack(): bool
            {
                return true;
            }
        };

        return $pdoStub;
    }

    // ── enqueue_projection_dirty ──────────────────────────────────────────────

    public function testEnqueueWritesInsertOnDuplicateKey(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_projection_dirty($db, 'user', 42, 'fleet_sent');

        $this->assertCount(1, $log);
        $this->assertStringContainsStringIgnoringCase('INSERT', $log[0]['sql']);
        $this->assertStringContainsString('projection_dirty_queue', $log[0]['sql']);
        $this->assertStringContainsString('ON DUPLICATE KEY', $log[0]['sql']);
    }

    public function testEnqueuePassesEntityTypeAndId(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_projection_dirty($db, 'system', 7, 'colony_updated', 'colony_event');

        $params = $log[0]['params'];
        $this->assertSame('system', $params[0], 'entity_type must be first param');
        $this->assertSame(7, $params[1], 'entity_id must be second param');
        $this->assertSame('colony_event', $params[2], 'event_type must be third param');
        $this->assertSame('colony_updated', $params[3], 'reason must be fourth param');
    }

    public function testEnqueueSilentlyHandlesDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        // Must not throw – errors in dirty-queue writes must never propagate.
        $this->expectNotToPerformAssertions();
        enqueue_projection_dirty($pdoStub, 'user', 1, 'test');
    }

    public function testEnqueueSetsStatusToQueued(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_projection_dirty($db, 'user', 99, 'test');

        $sql = $log[0]['sql'];
        $this->assertStringContainsString("'queued'", $sql);
        // The ON DUPLICATE KEY UPDATE must also force status back to queued.
        $this->assertStringContainsString("status          = 'queued'", $sql);
    }

    // ── claim_batch ───────────────────────────────────────────────────────────

    public function testClaimBatchReturnsEmptyWhenNothingDue(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log, []);

        $result = claim_batch($db, 'user', 10);

        $this->assertSame([], $result);
    }

    public function testClaimBatchUpdatesStatusToProcessing(): void
    {
        $log     = [];
        $dueRows = [
            ['id' => '1', 'entity_id' => '42', 'event_type' => '', 'reason' => 'test', 'payload_json' => null, 'attempts' => '0'],
        ];
        $db = $this->makePdoStub($log, $dueRows);

        $result = claim_batch($db, 'user', 10);

        $this->assertCount(1, $result);

        // Find the UPDATE statement that sets status to processing.
        $updateFound = false;
        foreach ($log as $entry) {
            if (
                stripos($entry['sql'], 'UPDATE') !== false
                && stripos($entry['sql'], "processing") !== false
            ) {
                $updateFound = true;
                break;
            }
        }
        $this->assertTrue($updateFound, 'claim_batch must issue an UPDATE … status=processing statement.');
    }

    public function testClaimBatchFiltersEntityType(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log, []);

        claim_batch($db, 'system', 5);

        // The SELECT must include entity_type filtering.
        $selectSql = $log[0]['sql'] ?? '';
        $this->assertStringContainsString('entity_type', $selectSql);
        $this->assertSame('system', $log[0]['params'][0]);
    }

    // ── mark_done ─────────────────────────────────────────────────────────────

    public function testMarkDoneDeletesOnlyProcessingRow(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        mark_done($db, 123);

        $this->assertCount(1, $log);
        $this->assertStringContainsStringIgnoringCase('DELETE', $log[0]['sql']);
        $this->assertStringContainsString("'processing'", $log[0]['sql']);
        $this->assertSame(123, $log[0]['params'][0]);
    }

    // ── mark_failed ───────────────────────────────────────────────────────────

    public function testMarkFailedRequeuesToQueuedBelowMaxAttempts(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        mark_failed($db, 50, 1, 'timeout', 30);

        $this->assertCount(1, $log);
        $this->assertStringContainsStringIgnoringCase('UPDATE', $log[0]['sql']);
        $this->assertStringContainsString("'queued'", $log[0]['sql']);
        // params: [attempt, errMsg, nextAttempt, queueId]
        $this->assertSame(1, $log[0]['params'][0]);
        $this->assertSame('timeout', $log[0]['params'][1]);
        $this->assertSame(50, $log[0]['params'][3]);
    }

    public function testMarkFailedPromotesToDeadLetterAtMaxAttempts(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        // Set max attempts to 3 for this test via constant if possible, else use default.
        $maxAttempts = defined('PROJECTION_MAX_ATTEMPTS') ? (int)PROJECTION_MAX_ATTEMPTS : 10;

        mark_failed($db, 77, $maxAttempts, 'persistent error', 30);

        $this->assertCount(1, $log);
        $this->assertStringContainsString("'failed'", $log[0]['sql'], 'Dead-letter entries must have status=failed.');
        $this->assertSame($maxAttempts, $log[0]['params'][0]);
        $this->assertSame('persistent error', $log[0]['params'][1]);
        $this->assertSame(77, $log[0]['params'][2]);
    }

    // ── projection_backoff_seconds ────────────────────────────────────────────

    public function testBackoffDoublesPerAttempt(): void
    {
        $base = 30;
        $this->assertSame(30,   projection_backoff_seconds(1, $base));
        $this->assertSame(60,   projection_backoff_seconds(2, $base));
        $this->assertSame(120,  projection_backoff_seconds(3, $base));
        $this->assertSame(240,  projection_backoff_seconds(4, $base));
        $this->assertSame(480,  projection_backoff_seconds(5, $base));
        $this->assertSame(960,  projection_backoff_seconds(6, $base));
        $this->assertSame(1920, projection_backoff_seconds(7, $base));
    }

    public function testBackoffIsCappedAt64xBase(): void
    {
        $base = 30;
        // Attempts 7 and above should all return 64× base (30 * 64 = 1920).
        $this->assertSame(1920, projection_backoff_seconds(7,  $base));
        $this->assertSame(1920, projection_backoff_seconds(10, $base));
        $this->assertSame(1920, projection_backoff_seconds(20, $base));
    }

    public function testBackoffRespectsCustomBase(): void
    {
        $this->assertSame(10, projection_backoff_seconds(1, 10));
        $this->assertSame(20, projection_backoff_seconds(2, 10));
    }

    // ── parse_worker_args ─────────────────────────────────────────────────────

    public function testParseArgsDefaultsWhenNoArgs(): void
    {
        $opts = parse_worker_args(['script.php']);

        $this->assertSame(50,    $opts['batch']);
        $this->assertSame(0,     $opts['max-seconds']);
        $this->assertSame(0,     $opts['max-items']);
        $this->assertFalse($opts['dry-run']);
    }

    public function testParseArgsBatch(): void
    {
        $opts = parse_worker_args(['script.php', '--batch=25']);
        $this->assertSame(25, $opts['batch']);
    }

    public function testParseArgsMaxSeconds(): void
    {
        $opts = parse_worker_args(['script.php', '--max-seconds=120']);
        $this->assertSame(120, $opts['max-seconds']);
    }

    public function testParseArgsMaxItems(): void
    {
        $opts = parse_worker_args(['script.php', '--max-items=200']);
        $this->assertSame(200, $opts['max-items']);
    }

    public function testParseArgsDryRun(): void
    {
        $opts = parse_worker_args(['script.php', '--dry-run']);
        $this->assertTrue($opts['dry-run']);
    }

    public function testParseArgsCombined(): void
    {
        $opts = parse_worker_args(['script.php', '--batch=10', '--max-seconds=60', '--dry-run']);
        $this->assertSame(10,   $opts['batch']);
        $this->assertSame(60,   $opts['max-seconds']);
        $this->assertTrue($opts['dry-run']);
    }

    public function testParseArgsIgnoresUnknownFlags(): void
    {
        // Unknown args must not cause errors.
        $opts = parse_worker_args(['script.php', '--unknown=foo', '--batch=5']);
        $this->assertSame(5, $opts['batch']);
    }

    public function testParseArgsBatchMinimumIsOne(): void
    {
        $opts = parse_worker_args(['script.php', '--batch=0']);
        $this->assertSame(1, $opts['batch'], '--batch=0 must be clamped to 1');
    }
}
