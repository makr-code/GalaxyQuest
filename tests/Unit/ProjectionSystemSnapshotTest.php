<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the System-Snapshot Projection helpers (Phase 2).
 *
 * These tests exercise the pure/logic parts of projection.php that can be
 * validated without a live database connection:
 *  - system_dirty_entity_id() / system_dirty_decode()  – key encoding roundtrip
 *  - enqueue_dirty_system()                             – idempotent dirty-queue insertion
 *  - read_system_snapshot()                             – freshness logic and miss conditions
 *  - read_system_snapshot_range()                       – range query wrapper
 *  - write_system_snapshot()                            – payload persistence
 *  - mark_system_snapshot_stale()                       – stale-flag setter
 *  - build_system_snapshot_payload()                    – payload structure contract
 */
final class ProjectionSystemSnapshotTest extends TestCase
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

    // ── system_dirty_entity_id / system_dirty_decode ──────────────────────────

    public function testEntityIdRoundtrip(): void
    {
        $cases = [
            [1, 1],
            [1, 25000],
            [9, 1],
            [9, 25000],
            [3, 12345],
        ];

        foreach ($cases as [$galaxy, $system]) {
            $encoded = system_dirty_entity_id($galaxy, $system);
            $decoded = system_dirty_decode($encoded);
            $this->assertSame($galaxy, $decoded['galaxy'],       "galaxy mismatch for ($galaxy,$system)");
            $this->assertSame($system, $decoded['system_index'], "system_index mismatch for ($galaxy,$system)");
        }
    }

    public function testEntityIdIsPositive(): void
    {
        $id = system_dirty_entity_id(1, 1);
        $this->assertGreaterThan(0, $id);
    }

    public function testEntityIdMaxValueFitsInt(): void
    {
        // GALAXY_MAX=9, SYSTEM_MAX=25000 → max encoded = 9*100000+25000 = 925000
        $maxId = system_dirty_entity_id(9, 25000);
        $this->assertSame(925000, $maxId);
        $this->assertLessThanOrEqual(PHP_INT_MAX, $maxId);
    }

    // ── enqueue_dirty_system ──────────────────────────────────────────────────

    public function testEnqueueDirtySystemWritesExpectedSql(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_dirty_system($db, 2, 500, 'colony_established');

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
        $expectedEntityId = system_dirty_entity_id(2, 500);
        $this->assertSame($expectedEntityId, $log[0]['params'][0], 'First param must be the encoded entity_id.');
        $this->assertSame('colony_established', $log[0]['params'][1], 'Second param must be the reason.');
    }

    public function testEnqueueDirtySystemUsesSystemEntityType(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        enqueue_dirty_system($db, 1, 1, 'test');

        $this->assertStringContainsString("'system'", $log[0]['sql']);
    }

    public function testEnqueueDirtySystemSilentlyHandlesDbError(): void
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
        enqueue_dirty_system($pdoStub, 1, 42, 'test');
    }

    // ── read_system_snapshot ──────────────────────────────────────────────────

    public function testReadSnapshotReturnNullWhenRowNotFound(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log, false);

        $result = read_system_snapshot($db, 1, 100);

        $this->assertNull($result, 'Missing row should return null.');
    }

    public function testReadSnapshotReturnNullWhenStaleFlag(): void
    {
        $log = [];
        $row = [
            'payload_json' => json_encode(['system_index' => 100]),
            'stale_flag'   => 1,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_system_snapshot($db, 1, 100);

        $this->assertNull($result, 'Stale-flagged row should return null.');
    }

    public function testReadSnapshotReturnNullWhenTooOld(): void
    {
        $log = [];
        $row = [
            'payload_json' => json_encode(['system_index' => 100]),
            'stale_flag'   => 0,
            'updated_at'   => date('Y-m-d H:i:s', time() - 99999),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_system_snapshot($db, 1, 100);

        $this->assertNull($result, 'Expired row should return null.');
    }

    public function testReadSnapshotReturnNullWhenJsonCorrupt(): void
    {
        $log = [];
        $row = [
            'payload_json' => 'NOT_VALID_JSON{{{',
            'stale_flag'   => 0,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_system_snapshot($db, 1, 100);

        $this->assertNull($result, 'Corrupt JSON should return null.');
    }

    public function testReadSnapshotReturnPayloadWhenFresh(): void
    {
        $log     = [];
        $payload = ['system_index' => 100, 'colony_count' => 2];
        $row     = [
            'payload_json' => json_encode($payload),
            'stale_flag'   => 0,
            'updated_at'   => date('Y-m-d H:i:s'),
        ];
        $db = $this->makePdoStub($log, $row);

        $result = read_system_snapshot($db, 1, 100);

        $this->assertIsArray($result, 'Fresh valid snapshot should be returned as array.');
        $this->assertArrayHasKey('system_index', $result);
        $this->assertSame(100, $result['system_index']);
    }

    public function testReadSnapshotReturnNullOnDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        $result = read_system_snapshot($pdoStub, 1, 1);

        $this->assertNull($result, 'DB error should return null (safe fallback).');
    }

    // ── read_system_snapshot_range ────────────────────────────────────────────

    public function testReadSnapshotRangeReturnsEmptyOnDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        $result = read_system_snapshot_range($pdoStub, 1, 1, 100, 1);

        $this->assertIsArray($result);
        $this->assertEmpty($result, 'DB error should return empty array.');
    }

    public function testReadSnapshotRangeReturnsEmptyWhenNoRows(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log, []);

        $result = read_system_snapshot_range($db, 1, 1, 100, 10);

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    public function testReadSnapshotRangeKeyedBySystemIndex(): void
    {
        $rows = [
            ['system_index' => 10, 'payload_json' => json_encode(['system_index' => 10, 'name' => 'Alpha'])],
            ['system_index' => 20, 'payload_json' => json_encode(['system_index' => 20, 'name' => 'Beta'])],
        ];
        $log = [];
        $db  = $this->makePdoStub($log, $rows);

        $result = read_system_snapshot_range($db, 1, 10, 20, 10);

        $this->assertArrayHasKey(10, $result, 'Result must be keyed by system_index.');
        $this->assertArrayHasKey(20, $result, 'Result must be keyed by system_index.');
        $this->assertSame('Alpha', $result[10]['name']);
        $this->assertSame('Beta',  $result[20]['name']);
    }

    public function testReadSnapshotRangeSkipsCorruptJson(): void
    {
        $rows = [
            ['system_index' => 10, 'payload_json' => 'CORRUPT'],
            ['system_index' => 20, 'payload_json' => json_encode(['system_index' => 20])],
        ];
        $log = [];
        $db  = $this->makePdoStub($log, $rows);

        $result = read_system_snapshot_range($db, 1, 10, 20, 10);

        $this->assertArrayNotHasKey(10, $result, 'Corrupt JSON entry must be skipped.');
        $this->assertArrayHasKey(20, $result, 'Valid entry must be present.');
    }

    // ── write_system_snapshot ─────────────────────────────────────────────────

    public function testWriteSnapshotExecutesInsertOnDuplicateKey(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        $payload = [
            'system_index'         => 42,
            'colony_count'         => 1,
            'colony_population'    => 500,
            'colony_owner_user_id' => 7,
        ];
        write_system_snapshot($db, 1, 42, $payload);

        $this->assertCount(1, $log, 'One statement should have been executed.');
        $this->assertStringContainsString(
            'projection_system_snapshot',
            $log[0]['sql'],
            'Query must target projection_system_snapshot.'
        );
        $this->assertStringContainsStringIgnoringCase(
            'INSERT',
            $log[0]['sql'],
            'Query must be an INSERT … ON DUPLICATE KEY.'
        );
        // Params: galaxy, system_index, json, owner_user_id, colony_count, colony_population, tick
        $this->assertSame(1,  $log[0]['params'][0], 'First param must be galaxy.');
        $this->assertSame(42, $log[0]['params'][1], 'Second param must be system_index.');
        $decoded = json_decode((string)$log[0]['params'][2], true);
        $this->assertIsArray($decoded, 'Third param must be valid JSON.');
        $this->assertArrayHasKey('system_index', $decoded);
        $this->assertSame(7, $log[0]['params'][3], 'Fourth param must be owner_user_id.');
        $this->assertSame(1, $log[0]['params'][4], 'Fifth param must be colony_count.');
        $this->assertSame(500, $log[0]['params'][5], 'Sixth param must be colony_population.');
    }

    public function testWriteSnapshotSilentlyHandlesDbError(): void
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
        write_system_snapshot($pdoStub, 1, 1, ['system_index' => 1]);
    }

    // ── mark_system_snapshot_stale ────────────────────────────────────────────

    public function testMarkSystemSnapshotStaleExecutesUpdate(): void
    {
        $log = [];
        $db  = $this->makePdoStub($log);

        mark_system_snapshot_stale($db, 3, 77);

        $this->assertCount(1, $log);
        $this->assertStringContainsStringIgnoringCase('UPDATE', $log[0]['sql']);
        $this->assertStringContainsString('projection_system_snapshot', $log[0]['sql']);
        $this->assertStringContainsString('stale_flag', $log[0]['sql']);
        $this->assertSame(3,  $log[0]['params'][0], 'First param must be galaxy.');
        $this->assertSame(77, $log[0]['params'][1], 'Second param must be system_index.');
    }

    public function testMarkSystemSnapshotStaleSilentlyHandlesDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        $this->expectNotToPerformAssertions();
        mark_system_snapshot_stale($pdoStub, 1, 1);
    }

    // ── build_system_snapshot_payload ─────────────────────────────────────────

    public function testBuildSnapshotPayloadReturnsNullWhenStarNotFound(): void
    {
        $log = [];
        // fetch() returns false → no star row
        $db = $this->makePdoStub($log, false);

        $result = build_system_snapshot_payload($db, 1, 999);

        $this->assertNull($result, 'Missing star row should return null.');
    }

    public function testBuildSnapshotPayloadReturnsNullOnDbError(): void
    {
        $pdoStub = new class extends PDO {
            public function __construct() {}
            #[\ReturnTypeWillChange]
            public function prepare(string $sql, array $options = []): never
            {
                throw new RuntimeException('Simulated DB error');
            }
        };

        $result = build_system_snapshot_payload($pdoStub, 1, 1);

        $this->assertNull($result, 'DB error should return null.');
    }

    public function testBuildSnapshotPayloadContainsExpectedFields(): void
    {
        // The stub will return the same star row for every fetch() call.
        $starRow = [
            'id'             => 1,
            'galaxy_index'   => 1,
            'system_index'   => 42,
            'name'           => 'Sol',
            'catalog_name'   => 'Sol',
            'spectral_class' => 'G',
            'subtype'        => 'V',
            'x_ly'           => 0.0,
            'y_ly'           => 0.0,
            'z_ly'           => 0.0,
            'planet_count'   => 8,
            'hz_inner_au'    => 0.95,
            'hz_outer_au'    => 1.37,
        ];

        $log = [];
        $db  = $this->makePdoStub($log, $starRow);

        $result = build_system_snapshot_payload($db, 1, 42);

        $this->assertIsArray($result, 'Valid star row should produce an array payload.');

        $requiredKeys = [
            'system_index', 'galaxy_index', 'name', 'spectral_class',
            'colony_count', 'colony_population',
            'colony_owner_user_id', 'colony_owner_name', 'colony_owner_color',
        ];
        foreach ($requiredKeys as $key) {
            $this->assertArrayHasKey($key, $result, "Payload must contain '{$key}' key.");
        }
    }

    // ── Snapshot payload structure contract ───────────────────────────────────

    public function testSnapshotPayloadDefaultsAreCorrectTypes(): void
    {
        $starRow = [
            'id'             => 5,
            'galaxy_index'   => 2,
            'system_index'   => 100,
            'name'           => 'Vega',
            'catalog_name'   => 'Vega',
            'spectral_class' => 'A',
            'subtype'        => 'V',
            'x_ly'           => 25.0,
            'y_ly'           => 0.0,
            'z_ly'           => 0.0,
            'planet_count'   => 3,
            'hz_inner_au'    => 1.1,
            'hz_outer_au'    => 1.9,
        ];

        $log = [];
        $db  = $this->makePdoStub($log, $starRow);

        $result = build_system_snapshot_payload($db, 2, 100);

        $this->assertIsArray($result);
        $this->assertIsInt($result['colony_count'],         'colony_count must be int.');
        $this->assertIsInt($result['colony_population'],    'colony_population must be int.');
        $this->assertIsInt($result['colony_owner_user_id'], 'colony_owner_user_id must be int.');
        $this->assertIsString($result['colony_owner_name'],  'colony_owner_name must be string.');
        $this->assertIsString($result['colony_owner_color'], 'colony_owner_color must be string.');

        // Unoccupied system defaults
        $this->assertSame(0, $result['colony_count']);
        $this->assertSame(0, $result['colony_population']);
        $this->assertSame(0, $result['colony_owner_user_id']);
    }
}
