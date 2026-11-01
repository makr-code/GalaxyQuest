<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for MigrationRunner.
 *
 * These tests use an in-process SQLite database so they run without a real
 * MySQL server.  SQLite deviates from MySQL in a few ways (e.g. information_schema
 * is not supported), so the tests interact directly with MigrationRunner's
 * public surface and validate behaviour via the SQLite tables/data.
 */
final class MigrationRunnerTest extends TestCase
{
    private PDO    $db;
    private string $sqlDir;
    private string $manifestFile;

    protected function setUp(): void
    {
        // In-memory SQLite database per test.
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Temporary SQL directory for each test.
        $this->sqlDir = sys_get_temp_dir() . '/gq_migrate_test_' . uniqid('', true);
        mkdir($this->sqlDir, 0777, true);

        // Temporary manifest file.
        $this->manifestFile = $this->sqlDir . '/manifest.php';
    }

    protected function tearDown(): void
    {
        // Clean up temp files.
        foreach (glob($this->sqlDir . '/*') as $f) {
            if (is_file($f)) {
                unlink($f);
            }
        }
        rmdir($this->sqlDir);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private function writeSql(string $name, string $content): void
    {
        file_put_contents($this->sqlDir . '/' . $name, $content);
    }

    private function writeManifest(array $migrations): void
    {
        $encoded = var_export($migrations, true);
        file_put_contents(
            $this->manifestFile,
            "<?php\nreturn {$encoded};\n"
        );
    }

    private function trackExisting(string $name, string $sql): void
    {
        $this->writeSql($name, $sql);
        $query = $this->db->prepare(
            "INSERT INTO schema_migrations (migration_name, checksum, environment) VALUES (?, ?, 'TEST')"
        );
        $query->execute([$name, md5($sql)]);
    }

    /**
     * Bootstrap schema_migrations in the SQLite database directly (bypasses
     * the information_schema check which SQLite doesn't support).
     */
    private function bootstrapTrackingTable(): void
    {
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                migration_name TEXT    NOT NULL UNIQUE,
                applied_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checksum       TEXT    NOT NULL,
                environment    TEXT    NOT NULL DEFAULT \'unknown\',
                execution_ms   INTEGER NOT NULL DEFAULT 0
            )'
        );
    }

    private function buildRunner(): MigrationRunner
    {
        return new MigrationRunner(
            $this->db,
            $this->sqlDir,
            'TEST',
            $this->manifestFile
        );
    }

    // ──────────────────────────────────────────────────────────────────────────
    // splitStatements
    // ──────────────────────────────────────────────────────────────────────────

    public function testVerifyFreshDatabaseDoesNotBootstrap(): void
    {
        $this->writeManifest(['first.sql']);
        $this->writeSql('schema_migrations.sql', 'INVALID SQL MUST NOT EXECUTE');
        try {
            $this->buildRunner()->verifyDeployment();
            $this->fail('Fresh database must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('existing migration tracking table', $error->getMessage());
        }
        $this->assertSame(0, (int) $this->db->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")->fetchColumn());
    }

    public function testVerifyCompleteManifestDoesNotExecuteForwardSqlOrChangeTracking(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql', 'second.sql']);
        $this->trackExisting('first.sql', 'INVALID BUT ALREADY TRACKED BYTES');
        $this->trackExisting('second.sql', 'DROP TABLE schema_migrations;');
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        $this->assertSame(2, $this->buildRunner()->verifyDeployment());
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
    }

    public function testVerifyPendingMigrationIsNotApplied(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql', 'pending.sql']);
        $this->trackExisting('first.sql', 'SELECT 1;');
        $this->writeSql('pending.sql', 'CREATE TABLE must_not_exist (id INT);');
        try {
            $this->buildRunner()->verifyDeployment();
            $this->fail('Pending manifest must not verify.');
        } catch (RuntimeException $error) {
            $this->assertSame('Deployment has a pending migration: pending.sql', $error->getMessage());
        }
        $this->assertSame(1, (int) $this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
        $this->assertSame(0, (int) $this->db->query("SELECT COUNT(*) FROM sqlite_master WHERE name='must_not_exist'")->fetchColumn());
    }

    public function testVerifyForeignHistoryBlocksOlderImageWithoutDeletingHistory(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql']);
        $this->trackExisting('first.sql', 'SELECT 1;');
        $this->trackExisting('newer_release.sql', 'SELECT 2;');
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        try {
            $this->buildRunner()->verifyDeployment();
            $this->fail('Foreign history must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('absent from the deployment manifest: newer_release.sql', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
    }

    public function testVerifyChecksumDriftDoesNotRepairHistory(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql']);
        $this->trackExisting('first.sql', "SELECT 1;\n");
        $this->writeSql('first.sql', "SELECT 1;\r\n");
        try {
            $this->buildRunner()->verifyDeployment();
            $this->fail('Byte drift must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('checksum mismatch: first.sql', $error->getMessage());
        }
        $this->assertSame(md5("SELECT 1;\n"), $this->db->query('SELECT checksum FROM schema_migrations')->fetchColumn());
    }

    public function testVerifyMissingAppliedFileFails(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql']);
        $this->trackExisting('first.sql', 'SELECT 1;');
        unlink($this->sqlDir . '/first.sql');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Migration file not found or unreadable');
        $this->buildRunner()->verifyDeployment();
    }

    public function testVerifyEmptyManifestRequiresEmptyExistingHistory(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest([]);
        $this->assertSame(0, $this->buildRunner()->verifyDeployment());
    }

    public function testSplitStatementsSimple(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();

        $sql    = "CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);";
        $result = $runner->splitStatements($sql);

        $this->assertCount(2, $result);
        $this->assertStringContainsString('CREATE TABLE a', $result[0]);
        $this->assertStringContainsString('CREATE TABLE b', $result[1]);
    }

    public function testSplitStatementsIgnoresLineComments(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();

        $sql    = "-- This is a comment\nCREATE TABLE a (id INT);";
        $result = $runner->splitStatements($sql);

        $this->assertCount(1, $result);
        $this->assertStringContainsString('CREATE TABLE a', $result[0]);
    }

    public function testSplitStatementsIgnoresBlockComments(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();

        $sql    = "/* block */ CREATE TABLE a (id INT);";
        $result = $runner->splitStatements($sql);

        $this->assertCount(1, $result);
        $this->assertStringContainsString('CREATE TABLE a', $result[0]);
    }

    public function testSplitStatementsPreservesSemicolonInStringLiteral(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();

        $sql    = "INSERT INTO t (v) VALUES ('a;b');";
        $result = $runner->splitStatements($sql);

        $this->assertCount(1, $result);
        $this->assertStringContainsString("'a;b'", $result[0]);
    }

    public function testSplitStatementsEmptySqlReturnsEmpty(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();

        $result = $runner->splitStatements('   -- just a comment   ');
        $this->assertCount(0, $result);
    }

    public function testSplitStatementsHandlesBackslashEscapesWithoutMergingStatements(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();
        $sql = <<<'SQL'
INSERT INTO t VALUES ('Vor\'Tak; name');
INSERT INTO t VALUES ("escaped\"; quote");
INSERT INTO t VALUES ('trailing\\');
SELECT 1;
SQL;
        $statements = $runner->splitStatements($sql);
        $this->assertCount(4, $statements);
        $this->assertSame("INSERT INTO t VALUES ('Vor\\'Tak; name')", $statements[0]);
        $this->assertSame('SELECT 1', $statements[3]);
    }

    public function testCanonicalManifestContainsNoMariaDbOnlyConditionalAlters(): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        $unsupported = [];
        foreach ($manifest as $file) {
            $sql = file_get_contents(__DIR__ . '/../../sql/' . $file);
            $this->assertNotFalse($sql);
            foreach ($runner->splitStatements($sql) as $statement) {
                if (preg_match(
                    '/\b(?:ADD|DROP)\s+(?:COLUMN|INDEX|KEY|CONSTRAINT)\s+IF\s+(?:NOT\s+)?EXISTS\b/i',
                    $statement
                )) {
                    $unsupported[] = $file;
                    break;
                }
            }
        }
        $this->assertSame([], $unsupported, 'Use information_schema guards for MySQL-compatible conditional ALTERs.');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // getStatus
    // ──────────────────────────────────────────────────────────────────────────

    public function testGetStatusReturnsAllPendingOnFreshDb(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['migrate_foo_v1.sql', 'migrate_bar_v1.sql']);
        $runner = $this->buildRunner();

        $status = $runner->getStatus();

        $this->assertCount(2, $status);
        $this->assertSame('pending', $status[0]['status']);
        $this->assertSame('pending', $status[1]['status']);
        $this->assertNull($status[0]['applied_at']);
    }

    public function testGetStatusMarksAppliedMigrations(): void
    {
        $this->bootstrapTrackingTable();
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'abc123', 'TEST')"
        );

        $this->writeManifest(['migrate_foo_v1.sql', 'migrate_bar_v1.sql']);
        $runner = $this->buildRunner();

        $status = $runner->getStatus();

        $this->assertSame('applied',  $status[0]['status']);
        $this->assertSame('pending', $status[1]['status']);
        $this->assertSame('abc123',   $status[0]['checksum']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // runUp
    // ──────────────────────────────────────────────────────────────────────────

    public function testRunUpAppliesPendingMigration(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeSql('migrate_foo_v1.sql', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runUp();

        $this->assertCount(1, $results);
        $this->assertSame('migrate_foo_v1.sql', $results[0]['name']);
        $this->assertFalse($results[0]['skipped']);
        $this->assertSame(1, $results[0]['statements']);

        // Verify tracking record.
        $row = $this->db->query(
            "SELECT * FROM schema_migrations WHERE migration_name = 'migrate_foo_v1.sql'"
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertIsArray($row);
        $this->assertSame('TEST', $row['environment']);
    }

    public function testRunUpSkipsAlreadyAppliedMigrations(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('migrate_foo_v1.sql', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
        $this->writeSql('migrate_bar_v1.sql', 'CREATE TABLE bar (id INTEGER PRIMARY KEY);');
        $this->writeManifest(['migrate_foo_v1.sql', 'migrate_bar_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runUp();

        $this->assertCount(1, $results);
        $this->assertSame('migrate_bar_v1.sql', $results[0]['name']);
    }

    public function testRunUpRespectsStepLimit(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeSql('m1.sql', 'CREATE TABLE t1 (id INTEGER PRIMARY KEY);');
        $this->writeSql('m2.sql', 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);');
        $this->writeSql('m3.sql', 'CREATE TABLE t3 (id INTEGER PRIMARY KEY);');
        $this->writeManifest(['m1.sql', 'm2.sql', 'm3.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runUp(2);

        $this->assertCount(2, $results);
        $this->assertSame('m1.sql', $results[0]['name']);
        $this->assertSame('m2.sql', $results[1]['name']);
    }

    public function testRunUpDryRunDoesNotChangeDb(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeSql('migrate_foo_v1.sql', 'CREATE TABLE dry_foo (id INTEGER PRIMARY KEY);');
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runUp(null, true);

        $this->assertCount(1, $results);
        $this->assertTrue($results[0]['skipped']);

        // Tracking table must be empty.
        $count = (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
        $this->assertSame(0, $count);

        // Table must NOT have been created.
        $tables = $this->db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='dry_foo'")->fetchAll();
        $this->assertCount(0, $tables);
    }

    public function testRunUpReturnsEmptyWhenNothingPending(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('migrate_foo_v1.sql', 'SELECT 1;');
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runUp();

        $this->assertCount(0, $results);
    }

    public function testRunUpThrowsOnMissingFile(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['migrate_missing.sql']);
        $runner = $this->buildRunner();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/not found/i');
        $runner->runUp();
    }

    public function testRunUpRollsBackTransactionOnError(): void
    {
        $this->bootstrapTrackingTable();
        // First statement OK, second statement is invalid SQL → should roll back.
        $this->writeSql(
            'migrate_bad.sql',
            "CREATE TABLE good_table (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQL;"
        );
        $this->writeManifest(['migrate_bad.sql']);
        $runner = $this->buildRunner();

        try {
            $runner->runUp();
            $this->fail('Expected RuntimeException was not thrown.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('migrate_bad.sql', $e->getMessage());
        }

        // Tracking table must be empty (transaction rolled back).
        $count = (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
        $this->assertSame(0, $count);
        $this->assertSame([], $this->db->query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='good_table'"
        )->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    // ──────────────────────────────────────────────────────────────────────────
    // runRollback
    // ──────────────────────────────────────────────────────────────────────────

    public function testRunRollbackRevertsLastMigration(): void
    {
        $this->bootstrapTrackingTable();
        // Create the table that the down-migration will drop.
        $this->db->exec('CREATE TABLE rollback_me (id INTEGER PRIMARY KEY)');
        $this->trackExisting('migrate_foo_v1.sql', 'CREATE TABLE rollback_me (id INTEGER PRIMARY KEY);');
        $this->writeSql('migrate_foo_v1_down.sql', 'DROP TABLE IF EXISTS rollback_me;');
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runRollback(1);

        $this->assertCount(1, $results);
        $this->assertSame('rolled_back', $results[0]['status']);

        // Tracking record must be gone.
        $count = (int)$this->db->query(
            "SELECT COUNT(*) FROM schema_migrations WHERE migration_name = 'migrate_foo_v1.sql'"
        )->fetchColumn();
        $this->assertSame(0, $count);
    }

    public function testRunRollbackReportsNoDownFile(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('migrate_foo_v1.sql', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
        // Intentionally do NOT create migrate_foo_v1_down.sql.
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runRollback(1);

        $this->assertCount(1, $results);
        $this->assertSame('no_down_file', $results[0]['status']);

        // Tracking record must still be present.
        $count = (int)$this->db->query(
            "SELECT COUNT(*) FROM schema_migrations WHERE migration_name = 'migrate_foo_v1.sql'"
        )->fetchColumn();
        $this->assertSame(1, $count);
    }

    public function testRunRollbackDryRunDoesNotChangeDb(): void
    {
        $this->bootstrapTrackingTable();
        $this->db->exec('CREATE TABLE dry_rollback (id INTEGER PRIMARY KEY)');
        $this->trackExisting('migrate_foo_v1.sql', 'SELECT 1;');
        $this->writeSql('migrate_foo_v1_down.sql', 'DROP TABLE IF EXISTS dry_rollback;');
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runRollback(1, true);

        $this->assertSame('would_rollback', $results[0]['status']);

        // Tracking record must still be present (dry-run).
        $count = (int)$this->db->query(
            "SELECT COUNT(*) FROM schema_migrations WHERE migration_name = 'migrate_foo_v1.sql'"
        )->fetchColumn();
        $this->assertSame(1, $count);

        // Table must still exist.
        $tables = $this->db->query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='dry_rollback'"
        )->fetchAll();
        $this->assertCount(1, $tables);
    }

    public function testRunRollbackReturnsEmptyWhenNothingApplied(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['migrate_foo_v1.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runRollback(1);

        $this->assertCount(0, $results);
    }

    public function testRunRollbackRespectsManifestOrder(): void
    {
        // m2 applied after m1; rollback with step=1 should revert m2 first.
        $this->bootstrapTrackingTable();
        $this->db->exec('CREATE TABLE rb_t1 (id INTEGER PRIMARY KEY)');
        $this->db->exec('CREATE TABLE rb_t2 (id INTEGER PRIMARY KEY)');
        $this->trackExisting('m1.sql', 'SELECT 1;');
        $this->trackExisting('m2.sql', 'SELECT 1;');
        $this->writeSql('m2_down.sql', 'DROP TABLE IF EXISTS rb_t2;');
        $this->writeManifest(['m1.sql', 'm2.sql']);
        $runner = $this->buildRunner();

        $results = $runner->runRollback(1);

        $this->assertCount(1, $results);
        $this->assertSame('m2.sql', $results[0]['name']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Manifest loading
    // ──────────────────────────────────────────────────────────────────────────

    public function testManifestFileIsLoadedCorrectly(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['alpha.sql', 'beta.sql', 'gamma.sql']);
        $runner = $this->buildRunner();

        $status = $runner->getStatus();

        $this->assertCount(3, $status);
        $this->assertSame('alpha.sql', $status[0]['name']);
        $this->assertSame('beta.sql',  $status[1]['name']);
        $this->assertSame('gamma.sql', $status[2]['name']);
    }

    /** @return iterable<array{mixed}> */
    public static function invalidManifests(): iterable
    {
        yield 'scalar' => ['migration.sql'];
        yield 'map' => [['first' => 'migration.sql']];
        yield 'duplicate' => [['migration.sql', 'migration.sql']];
        yield 'case collision' => [['migration.sql', 'Migration.sql']];
        yield 'traversal' => [['../migration.sql']];
        yield 'absolute' => [['/migration.sql']];
        yield 'windows' => [['C:\\migration.sql']];
        yield 'nested' => [['nested/migration.sql']];
        yield 'nonstring' => [[42]];
        yield 'down' => [['migration_down.sql']];
        yield 'extension' => [['migration.php']];
        yield 'newline' => [["migration.sql\n"]];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidManifests')]
    public function testInvalidManifestFailsDuringConstruction(mixed $manifest): void
    {
        file_put_contents($this->manifestFile, '<?php return ' . var_export($manifest, true) . ';');
        $this->expectException(InvalidArgumentException::class);
        $this->buildRunner();
    }

    /** @return iterable<array{string, bool, bool}> */
    public static function checksumOperations(): iterable
    {
        foreach (['up', 'rollback'] as $operation) {
            foreach ([false, true] as $dryRun) {
                foreach ([false, true] as $missing) {
                    yield $operation . '-' . (int)$dryRun . '-' . (int)$missing => [$operation, $dryRun, $missing];
                }
            }
        }
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('checksumOperations')]
    public function testChangedOrMissingAppliedSqlStopsBeforeMutation(string $operation, bool $dryRun, bool $missing): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('first.sql', 'SELECT 1;');
        $this->writeSql('first_down.sql', 'DELETE FROM schema_migrations;');
        $this->writeSql('next.sql', 'CREATE TABLE must_not_exist (id INT);');
        $this->writeManifest(['first.sql', 'next.sql']);
        if ($missing) {
            unlink($this->sqlDir . '/first.sql');
        } else {
            $this->writeSql('first.sql', 'SELECT 2;');
        }
        $runner = $this->buildRunner();
        try {
            if ($operation === 'up') {
                $runner->runUp(1, $dryRun);
            } else {
                $runner->runRollback(1, $dryRun);
            }
            $this->fail('Expected integrity failure.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('first.sql', $error->getMessage());
        }
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
        $this->assertSame([], $this->db->query(
            "SELECT name FROM sqlite_master WHERE name = 'must_not_exist'"
        )->fetchAll());
    }

    public function testChecksumDriftAlsoRejectsNoOpUp(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('first.sql', 'SELECT 1;');
        $this->writeManifest(['first.sql']);
        $this->writeSql('first.sql', 'SELECT 1; -- changed');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('checksum mismatch');
        $this->buildRunner()->runUp();
    }

    public function testPreflightChecksAllSelectedPendingFilesBeforeFirstMigration(): void
    {
        $this->bootstrapTrackingTable();
        $this->writeManifest(['first.sql', 'missing.sql']);
        $this->writeSql('first.sql', 'CREATE TABLE must_not_exist (id INT);');
        try {
            $this->buildRunner()->runUp();
            $this->fail('Expected missing-file failure.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('missing.sql', $error->getMessage());
        }
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
        $this->assertSame([], $this->db->query(
            "SELECT name FROM sqlite_master WHERE name = 'must_not_exist'"
        )->fetchAll());
        $this->assertCount(1, $this->buildRunner()->runUp(1));
    }

    /** @return iterable<array{string, int}> */
    public static function invalidSteps(): iterable
    {
        yield ['up', 0];
        yield ['up', -1];
        yield ['rollback', 0];
        yield ['rollback', -1];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidSteps')]
    public function testInvalidStepCountsFailBeforeDatabaseProbe(string $operation, int $steps): void
    {
        $this->writeManifest([]);
        $runner = $this->buildRunner();
        $this->expectException(InvalidArgumentException::class);
        if ($operation === 'up') {
            $runner->runUp($steps);
        } else {
            $runner->runRollback($steps);
        }
    }

    /** @return iterable<array{int, bool}> */
    public static function rollbackBarriers(): iterable
    {
        foreach ([1, 2, 3] as $missing) {
            foreach ([false, true] as $dryRun) {
                yield [$missing, $dryRun];
            }
        }
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('rollbackBarriers')]
    public function testMissingCompanionBlocksEntireSelectedRollback(int $missing, bool $dryRun): void
    {
        $this->bootstrapTrackingTable();
        $this->db->exec('CREATE TABLE rollback_probe (id INT); INSERT INTO rollback_probe VALUES (1), (2), (3)');
        $this->writeManifest(['m1.sql', 'm2.sql', 'm3.sql']);
        foreach ([1, 2, 3] as $id) {
            $this->trackExisting('m' . $id . '.sql', 'SELECT 1;');
            if ($id !== $missing) {
                $this->writeSql('m' . $id . '_down.sql', 'DELETE FROM rollback_probe WHERE id = ' . $id . ';');
            }
        }
        $results = $this->buildRunner()->runRollback(3, $dryRun);
        $this->assertCount(1, $results);
        $this->assertSame('no_down_file', $results[0]['status']);
        $this->assertSame('m' . $missing . '.sql', $results[0]['name']);
        $this->assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM rollback_probe')->fetchColumn());
        $this->assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
    }

    public function testStepLimitedRollbackDoesNotInspectUnselectedOlderBarrier(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('m1.sql', 'SELECT 1;');
        $this->trackExisting('m2.sql', 'SELECT 1;');
        $this->writeSql('m2_down.sql', 'SELECT 1;');
        $this->writeManifest(['m1.sql', 'm2.sql']);
        $results = $this->buildRunner()->runRollback(1);
        $this->assertSame('rolled_back', $results[0]['status']);
        $this->assertSame('m2.sql', $results[0]['name']);
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
    }

    public function testInvalidCompanionPathBlocksBeforeEarlierRollbackSql(): void
    {
        $this->bootstrapTrackingTable();
        $this->trackExisting('m1.sql', 'SELECT 1;');
        $this->trackExisting('m2.sql', 'SELECT 1;');
        $this->writeManifest(['m1.sql', 'm2.sql']);
        $this->writeSql('m2_down.sql', 'DELETE FROM schema_migrations;');
        $path = $this->sqlDir . '/m1_down.sql';
        mkdir($path);
        try {
            try {
                $this->buildRunner()->runRollback(2);
                $this->fail('Expected invalid companion rejection.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('m1_down.sql', $error->getMessage());
            }
            $this->assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
        } finally {
            rmdir($path);
        }
    }

    public function testFreshDryRunNeverCreatesTrackingOrApplicationTables(): void
    {
        $this->writeManifest(['fresh.sql']);
        $this->writeSql('fresh.sql', 'CREATE TABLE fresh_data (id INT);');
        // No bootstrap SQL fixture: a preview must not even attempt to read it.
        $runner = $this->buildRunner();
        $results = $runner->runUp(null, true);
        $this->assertCount(1, $results);
        $this->assertTrue($results[0]['skipped']);
        $this->assertSame([], $runner->runRollback(1, true));
        $this->assertSame([], $this->db->query("SELECT name FROM sqlite_master WHERE type = 'table'")->fetchAll());
    }

    public function testRealRunStillBootstrapsAbsentTracking(): void
    {
        $this->writeManifest(['fresh.sql']);
        $this->writeSql('fresh.sql', 'CREATE TABLE fresh_data (id INT);');
        $this->writeSql('schema_migrations.sql', "CREATE TABLE schema_migrations (
            migration_name TEXT PRIMARY KEY, checksum TEXT, environment TEXT,
            execution_ms INT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );");
        $this->assertCount(1, $this->buildRunner()->runUp());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn());
    }

    /** @return iterable<array{string, string, int, string}> */
    public static function trackingProbeFailures(): iterable
    {
        yield 'permission' => ['mysql', '42000', 1142, 'SELECT command denied'];
        yield 'disconnect' => ['mysql', 'HY000', 2006, 'MySQL server has gone away'];
        yield 'bad column' => ['mysql', '42S22', 1054, 'Unknown column'];
        yield 'wrong missing code' => ['mysql', '42S02', 1142, 'denied'];
        yield 'sqlite locked' => ['sqlite', 'HY000', 5, 'database is locked'];
        yield 'sqlite other table' => ['sqlite', 'HY000', 1, 'no such table: other_table'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('trackingProbeFailures')]
    public function testProbeErrorsPreserveOriginalExceptionWithoutBootstrap(
        string $driver,
        string $state,
        int $code,
        string $message
    ): void {
        $error = new PDOException($message);
        $error->errorInfo = [$state, $code, $message];
        (new ReflectionProperty(Exception::class, 'code'))->setValue($error, $state);
        $db = $this->createMock(PDO::class);
        $db->method('getAttribute')->willReturn($driver);
        $db->method('query')->willThrowException($error);
        $db->expects($this->never())->method('exec');
        $this->writeManifest([]);
        $runner = new MigrationRunner($db, $this->sqlDir, 'TEST', $this->manifestFile);
        foreach ([false, true] as $dryRun) {
            try {
                (new ReflectionMethod(MigrationRunner::class, 'ensureTrackingTable'))->invoke($runner, $dryRun);
                $this->fail('Expected original probe error.');
            } catch (PDOException $actual) {
                $this->assertSame($error, $actual);
            }
        }
    }
}
