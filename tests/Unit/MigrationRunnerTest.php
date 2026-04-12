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
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'x', 'TEST')"
        );
        $this->writeSql('migrate_foo_v1.sql', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
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
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'x', 'TEST')"
        );
        $this->writeSql('migrate_foo_v1.sql', 'SELECT 1;');
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
    }

    // ──────────────────────────────────────────────────────────────────────────
    // runRollback
    // ──────────────────────────────────────────────────────────────────────────

    public function testRunRollbackRevertsLastMigration(): void
    {
        $this->bootstrapTrackingTable();
        // Create the table that the down-migration will drop.
        $this->db->exec('CREATE TABLE rollback_me (id INTEGER PRIMARY KEY)');
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'x', 'TEST')"
        );

        $this->writeSql('migrate_foo_v1.sql', 'CREATE TABLE rollback_me (id INTEGER PRIMARY KEY);');
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
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'x', 'TEST')"
        );
        $this->writeSql('migrate_foo_v1.sql', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);');
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
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment)
             VALUES ('migrate_foo_v1.sql', 'x', 'TEST')"
        );
        $this->writeSql('migrate_foo_v1.sql', 'SELECT 1;');
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
        $this->db->exec(
            "INSERT INTO schema_migrations (migration_name, checksum, environment) VALUES
             ('m1.sql', 'c1', 'TEST'),
             ('m2.sql', 'c2', 'TEST')"
        );
        $this->writeSql('m1.sql', 'SELECT 1;');
        $this->writeSql('m2.sql', 'SELECT 1;');
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
}
