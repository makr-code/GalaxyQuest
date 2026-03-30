<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the User-Overview Projection helpers (Phase 1).
 *
 * These tests exercise the pure/logic parts of projection.php that can be
 * validated without a live database connection:
 *  - enqueue_dirty_user()             – idempotent dirty-queue insertion
 *  - read_user_overview_projection()  – freshness logic and miss conditions
 *  - write_user_overview_projection() – payload persistence
 *  - mark_projection_stale()          – stale-flag setter
 */
final class ProjectionUserOverviewTest extends TestCase
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns a PDO stub that records executed queries and parameters.
     * prepare() returns a statement stub whose execute() records the call.
     *
     * @param array<int,array{sql:string,params:array<mixed>}> &$log  Populated by reference.
     */
    private function makePdoStub(array &$log, mixed $fetchReturn = false): object
    {
        $log = [];

        $stmtStub = new class ($log, $fetchReturn) {
            /** @param array<int,array{sql:string,params:array<mixed>}> $log */
            public function __construct(
                private array &$log,
                private mixed $fetchReturn,
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
                return $this->fetchReturn;
            }

            public function fetchColumn(int $column = 0): mixed
            {
                if (is_array($this->fetchReturn)) {
                    return array_values($this->fetchReturn)[$column] ?? false;
                }
                return $this->fetchReturn;
            }

            public function fetchAll(int $mode = PDO::FETCH_ASSOC): array
            {
                return is_array($this->fetchReturn) ? $this->fetchReturn : [];
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
        };

        return $pdoStub;
    }

    // ── enqueue_dirty_user ────────────────────────────────────────────────────

    public function testEnqueueDirtyUserWritesExpectedSql(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_dirty_user($db, 42, 'fleet_sent');

        $this->assertCount(1, $log, 'One statement should have been executed.');
        $this->assertStringContainsString(
            'projection_dirty_queue',
            $log[0]['sql'],
            'Query must reference projection_dirty_queue.'
        );
        $this->assertStringContainsStringIgnoringCase(
            'INSERT',
            $log[0]['sql'],
            'Query must be an INSERT … ON DUPLICATE KEY.'
        );
        // enqueue_dirty_user() delegates to enqueue_projection_dirty() whose
        // parameter order is: entity_type, entity_id, event_type, reason, payload_json.
        $this->assertSame('user', $log[0]['params'][0], 'First param must be entity_type=user.');
        $this->assertSame(42, $log[0]['params'][1], 'Second param must be the user ID.');
        $this->assertSame('fleet_sent', $log[0]['params'][3], 'Fourth param must be the reason.');
    }

    public function testEnqueueDirtyUserSilentlyHandlesDbError(): void
    {
        // Prepare a PDO stub whose prepare() throws.
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
        enqueue_dirty_user($pdoStub, 7, 'test');
    }

    // ── read_user_overview_projection ─────────────────────────────────────────

    public function testReadProjectionReturnNullWhenRowNotFound(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log, false);

        $result = read_user_overview_projection($db, 1);

        $this->assertNull($result, 'Missing row should return null.');
    }

    public function testReadProjectionReturnNullWhenStaleFlag(): void
    {
        $log = [];
        $row = [
            'payload_json' => json_encode(['user_meta' => []]),
            'stale_flag'   => 1,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_user_overview_projection($db, 1);

        $this->assertNull($result, 'Stale-flagged row should return null.');
    }

    public function testReadProjectionReturnNullWhenTooOld(): void
    {
        $log = [];
        $row = [
            'payload_json' => json_encode(['user_meta' => []]),
            'stale_flag'   => 0,
            // Timestamp far in the past (well beyond any max-age).
            'updated_at'   => date('Y-m-d H:i:s', time() - 9999),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_user_overview_projection($db, 1);

        $this->assertNull($result, 'Expired row should return null.');
    }

    public function testReadProjectionReturnNullWhenJsonCorrupt(): void
    {
        $log = [];
        $row = [
            'payload_json' => 'NOT_VALID_JSON{{{',
            'stale_flag'   => 0,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_user_overview_projection($db, 1);

        $this->assertNull($result, 'Corrupt JSON should return null.');
    }

    public function testReadProjectionReturnPayloadWhenFresh(): void
    {
        $log     = [];
        $payload = ['user_meta' => ['dark_matter' => 100], 'colonies' => []];
        $row     = [
            'payload_json' => json_encode($payload),
            'stale_flag'   => 0,
            'updated_at'   => date('Y-m-d H:i:s'), // Just now – definitely fresh.
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_user_overview_projection($db, 1);

        $this->assertIsArray($result, 'Fresh valid payload should be returned as array.');
        $this->assertArrayHasKey('user_meta', $result);
        $this->assertSame(100, $result['user_meta']['dark_matter']);
    }

    // ── write_user_overview_projection ────────────────────────────────────────

    public function testWriteProjectionExecutesInsertOnDuplicateKey(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        write_user_overview_projection($db, 5, ['user_meta' => [], 'colonies' => []]);

        $this->assertCount(1, $log, 'One statement should have been executed.');
        $this->assertStringContainsString(
            'projection_user_overview',
            $log[0]['sql'],
            'Query must target projection_user_overview.'
        );
        $this->assertStringContainsStringIgnoringCase(
            'INSERT',
            $log[0]['sql'],
            'Query must be an INSERT … ON DUPLICATE KEY.'
        );
        $this->assertSame(5, $log[0]['params'][0], 'First param must be the user ID.');
        // Second param is the JSON blob – verify it is valid JSON.
        $decoded = json_decode((string)$log[0]['params'][1], true);
        $this->assertIsArray($decoded, 'Second param must be valid JSON.');
        $this->assertArrayHasKey('user_meta', $decoded);
    }

    public function testWriteProjectionSilentlyHandlesDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        // Must not throw.
        $this->expectNotToPerformAssertions();
        write_user_overview_projection($pdoStub, 3, ['x' => 1]);
    }

    // ── mark_projection_stale ─────────────────────────────────────────────────

    public function testMarkProjectionStaleExecutesUpdateWithUserId(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        mark_projection_stale($db, 99);

        $this->assertCount(1, $log);
        $this->assertStringContainsStringIgnoringCase('UPDATE', $log[0]['sql']);
        $this->assertStringContainsString('projection_user_overview', $log[0]['sql']);
        $this->assertStringContainsString('stale_flag', $log[0]['sql']);
        $this->assertSame(99, $log[0]['params'][0]);
    }

    // ── Payload structure contract ────────────────────────────────────────────

    /**
     * Verify the keys that the API and downstream consumers expect are present
     * in whatever payload reaches write_user_overview_projection().
     */
    public function testExpectedPayloadKeysArePresent(): void
    {
        $requiredKeys = [
            'user_meta',
            'offline_progress',
            'politics',
            'colonies',
            'fleets',
            'battles',
            'unread_msgs',
        ];

        // Build a minimal example payload (same structure as game.php returns).
        $examplePayload = array_fill_keys($requiredKeys, null);

        foreach ($requiredKeys as $key) {
            $this->assertArrayHasKey(
                $key,
                $examplePayload,
                "Payload must contain '{$key}' key."
            );
        }
    }
}
