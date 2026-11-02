<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use GalaxyQuest\Economy\OnDemandEconomy;

final class MigrationRunnerMySqlTest extends TestCase
{
    private ?PDO $admin = null;
    private ?PDO $db = null;
    private string $database = '';
    private string $sqlDir = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_MIGRATION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            $this->markTestSkipped('Set GQ_MIGRATION_TEST_DSN to run isolated MySQL migration tests.');
        }

        $this->admin = new PDO(
            $dsn,
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $this->assertSame('mysql', $this->admin->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_migration_test_' . bin2hex(random_bytes(8));
        $this->admin->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db = $this->admin;
        $this->db->exec('USE `' . $this->database . '`');
        $this->sqlDir = sys_get_temp_dir() . '/' . $this->database;
        mkdir($this->sqlDir, 0700);
        copy(__DIR__ . '/../../sql/schema_migrations.sql', $this->sqlDir . '/schema_migrations.sql');
    }

    protected function tearDown(): void
    {
        if ($this->db !== null && $this->db->inTransaction()) {
            $this->db->rollBack();
        }
        if ($this->admin !== null && $this->database !== '') {
            $this->admin->exec('DROP DATABASE IF EXISTS `' . $this->database . '`');
        }
        $this->db = null;
        $this->admin = null;
        if ($this->sqlDir !== '' && is_dir($this->sqlDir)) {
            foreach (glob($this->sqlDir . '/*') as $file) {
                unlink($file);
            }
            rmdir($this->sqlDir);
        }
    }

    private function buildRunner(string $upSql, string|null $downSql = null): MigrationRunner
    {
        file_put_contents($this->sqlDir . '/migration.sql', $upSql);
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql'];\n");
        if ($downSql !== null) {
            file_put_contents($this->sqlDir . '/migration_down.sql', $downSql);
        }
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    private function trackingCount(): int
    {
        return (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
    }

    private function migrationLockName(): string
    {
        return 'gq:migrations:' . substr(hash('sha256', $this->database), 0, 48);
    }

    private function secondConnection(): PDO
    {
        $connection = new PDO(
            (string)getenv('GQ_MIGRATION_TEST_DSN'),
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $connection->exec('USE `' . $this->database . '`');
        return $connection;
    }

    private function assertMigrationLockFree(): void
    {
        $query = $this->db->prepare('SELECT IS_FREE_LOCK(?)');
        $query->execute([$this->migrationLockName()]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
    }

    /** @return iterable<array{string, bool}> */
    public static function lockedOperations(): iterable
    {
        yield 'up' => ['up', false];
        yield 'up preview' => ['up', true];
        yield 'rollback' => ['rollback', false];
        yield 'rollback preview' => ['rollback', true];
        yield 'bootstrap' => ['bootstrap', false];
        yield 'verify' => ['verify', false];
    }

    #[DataProvider('lockedOperations')]
    public function testCompetingConnectionFailsBeforeAnyTrackingDdl(string $operation, bool $dryRun): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $holder = $this->secondConnection();
        $query = $holder->prepare('SELECT GET_LOCK(?, 0)');
        $query->execute([$this->migrationLockName()]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
        try {
            $start = hrtime(true);
            try {
                match ($operation) {
                    'up' => $runner->runUp(null, $dryRun),
                    'rollback' => $runner->runRollback(1, $dryRun),
                    'bootstrap' => $runner->bootstrap(),
                    'verify' => $runner->verifyDeployment(),
                };
                $this->fail('Expected competing migration rejection.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('Another migration process', $error->getMessage());
            }
            $this->assertLessThan(2, (hrtime(true) - $start) / 1e9);
            $this->assertSame(0, (int)$this->db->query(
                "SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
            )->fetchColumn());
            $query = $holder->prepare('SELECT IS_USED_LOCK(?) = CONNECTION_ID()');
            $query->execute([$this->migrationLockName()]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        } finally {
            $query = $holder->prepare('SELECT RELEASE_LOCK(?)');
            $query->execute([$this->migrationLockName()]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        }
        $this->assertSame([], $runner->runUp());
        $this->assertMigrationLockFree();
    }

    public function testLockRemainsOwnedAcrossDdlAndRollbackUntilTrackingCompletes(): void
    {
        $name = $this->db->quote($this->migrationLockName());
        $runner = $this->buildRunner(
            "CREATE TABLE lock_probe (owned INT);
             INSERT INTO lock_probe SELECT IS_USED_LOCK($name) = CONNECTION_ID();",
            "INSERT INTO lock_probe SELECT IS_USED_LOCK($name) = CONNECTION_ID();"
        );
        $this->assertMigrationLockFree();
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([1], array_map('intval', $this->db->query('SELECT owned FROM lock_probe')->fetchAll(PDO::FETCH_COLUMN)));
        $this->assertMigrationLockFree();
        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame([1, 1], array_map('intval', $this->db->query('SELECT owned FROM lock_probe')->fetchAll(PDO::FETCH_COLUMN)));
        $this->assertSame(0, $this->trackingCount());
        $this->assertMigrationLockFree();
        $this->assertCount(1, $runner->runUp(null, true));
        $this->assertMigrationLockFree();
    }

    public function testLockReleasedAfterUpAndRollbackSqlFailures(): void
    {
        $runner = $this->buildRunner('THIS IS NOT SQL;');
        try {
            $runner->runUp();
            $this->fail('Expected invalid SQL.');
        } catch (RuntimeException $error) {
            $this->assertInstanceOf(PDOException::class, $error->getPrevious());
        }
        $this->assertMigrationLockFree();
        $runner = $this->buildRunner('SELECT 1;', 'THIS IS NOT SQL;');
        $runner->runUp();
        try {
            $runner->runRollback();
            $this->fail('Expected invalid rollback SQL.');
        } catch (RuntimeException $error) {
            $this->assertInstanceOf(PDOException::class, $error->getPrevious());
        }
        $this->assertMigrationLockFree();
        $this->assertSame(1, $this->trackingCount());
    }

    public function testLockReleasedWhenBootstrapSqlFails(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->runUp();
            $this->fail('Expected bootstrap SQL failure.');
        } catch (PDOException $error) {
            $this->assertSame('42000', $error->getCode());
        }
        $this->assertMigrationLockFree();
    }

    public function testCallerTransactionIsRejectedWithoutImplicitCommit(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $this->db->exec('CREATE TABLE caller_data (id INT) ENGINE=InnoDB');
        $this->db->beginTransaction();
        $this->db->exec('INSERT INTO caller_data VALUES (42)');
        try {
            $runner->runUp();
            $this->fail('Expected active transaction rejection.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('active transaction', $error->getMessage());
        }
        $this->assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM caller_data')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testDatabaseSelectionIsRequiredBeforeLocking(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        $connection = new PDO(
            (string)getenv('GQ_MIGRATION_TEST_DSN'),
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $runner = new MigrationRunner($connection, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Select a database');
        $runner->bootstrap();
    }

    public function testDifferentDatabasesDoNotBlockEachOther(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $holder = $this->secondConnection();
        $otherName = 'gq:migrations:' . substr(hash('sha256', 'another_' . $this->database), 0, 48);
        $query = $holder->prepare('SELECT GET_LOCK(?, 0)');
        $query->execute([$otherName]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
        try {
            $this->assertCount(1, $runner->runUp());
            $this->assertMigrationLockFree();
        } finally {
            $query = $holder->prepare('SELECT RELEASE_LOCK(?)');
            $query->execute([$otherName]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        }
    }

    /** @return iterable<array{string, bool}> */
    public static function integrityOperations(): iterable
    {
        yield 'up' => ['up', false];
        yield 'up preview' => ['up', true];
        yield 'rollback' => ['rollback', false];
        yield 'rollback preview' => ['rollback', true];
        yield 'verify' => ['verify', false];
    }

    #[DataProvider('integrityOperations')]
    public function testChecksumDriftStopsWritesAndReleasesLock(string $operation, bool $dryRun): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE integrity_probe (id INT PRIMARY KEY); INSERT INTO integrity_probe VALUES (42);',
            'DELETE FROM integrity_probe;'
        );
        $runner->runUp();
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        file_put_contents($this->sqlDir . '/migration.sql', 'SELECT 2;');
        try {
            if ($operation === 'up') {
                $runner->runUp(null, $dryRun);
            } elseif ($operation === 'verify') {
                $runner->verifyDeployment();
            } else {
                $runner->runRollback(1, $dryRun);
            }
            $this->fail('Expected checksum mismatch.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('checksum mismatch: migration.sql', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(42, (int)$this->db->query('SELECT id FROM integrity_probe')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testMissingLaterPendingFilePreventsEarlierDdl(): void
    {
        $runner = $this->buildRunner('CREATE TABLE must_not_exist (id INT);');
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql', 'missing.sql'];\n");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->runUp();
            $this->fail('Expected missing pending file.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('missing.sql', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'must_not_exist'"
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testRemovedAppliedFileStopsDeploymentAndReleasesLock(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $runner->runUp();
        unlink($this->sqlDir . '/migration.sql');
        try {
            $runner->runUp();
            $this->fail('Expected missing applied file.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('migration.sql', $error->getMessage());
        }
        $this->assertSame(1, $this->trackingCount());
        $this->assertMigrationLockFree();
    }

    /** @return iterable<array{bool}> */
    public static function rollbackPreviews(): iterable
    {
        yield [false];
        yield [true];
    }

    #[DataProvider('rollbackPreviews')]
    public function testIrreversibleBarrierPreventsAnySelectedDdlRollback(bool $dryRun): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['older.sql', 'newer.sql'];");
        file_put_contents($this->sqlDir . '/older.sql', 'CREATE TABLE older_probe (id INT);');
        file_put_contents($this->sqlDir . '/newer.sql', 'CREATE TABLE newer_probe (id INT);');
        file_put_contents($this->sqlDir . '/newer_down.sql', 'DROP TABLE newer_probe;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->runUp();
        $results = $runner->runRollback(2, $dryRun);
        $this->assertSame('no_down_file', $results[0]['status']);
        $this->assertSame('older.sql', $results[0]['name']);
        $this->assertSame(2, $this->trackingCount());
        $this->assertSame(2, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('older_probe', 'newer_probe')"
        )->fetchColumn());
        $this->assertMigrationLockFree();
        file_put_contents($this->sqlDir . '/older_down.sql', 'DROP TABLE older_probe;');
        $this->assertCount(2, $runner->runRollback(2));
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('older_probe', 'newer_probe')"
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testFreshPreviewDoesNotCreateAnyTablesEvenWithInvalidBootstrapSql(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['preview.sql'];");
        file_put_contents($this->sqlDir . '/preview.sql', 'CREATE TABLE preview_data (id INT);');
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $results = $runner->runUp(null, true);
        $this->assertCount(1, $results);
        $this->assertTrue($results[0]['skipped']);
        $this->assertSame([], $runner->runRollback(1, true));
        $this->assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
        )->fetchColumn());
        $this->assertMigrationLockFree();
        copy(__DIR__ . '/../../sql/schema_migrations.sql', $this->sqlDir . '/schema_migrations.sql');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertMigrationLockFree();
    }

    public function testTrackingPermissionFailureIsNotReplacedByBootstrap(): void
    {
        $this->buildRunner('SELECT 1;');
        $username = 'gq_probe_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT CREATE ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string)getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $limited->exec('USE `' . $this->database . '`');
            $runner = new MigrationRunner($limited, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            // Bootstrap would produce a different error if the denied SELECT were swallowed.
            file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
            foreach ([false, true] as $dryRun) {
                try {
                    $runner->runUp(null, $dryRun);
                    $this->fail('Expected SELECT privilege failure.');
                } catch (PDOException $error) {
                    $this->assertSame(1142, $error->errorInfo[1]);
                    $this->assertSame('42000', $error->getCode());
                }
                $this->assertMigrationLockFree();
            }
            $this->assertSame(0, $this->trackingCount());
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    private function readSqlForTestDatabase(string $file): string
    {
        $source = file_get_contents(__DIR__ . '/../../sql/' . $file);
        $this->assertNotFalse($source);
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST');
        $statements = array_filter(
            $runner->splitStatements($source),
            static fn(string $statement): bool => $statement !== 'USE galaxyquest'
                && !str_starts_with($statement, 'CREATE DATABASE IF NOT EXISTS galaxyquest ')
        );
        return implode(";\n", $statements) . ';';
    }

    public function testVerifyFreshDatabaseNeverCreatesTrackingAndReleasesLock(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql'];");
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'INVALID BOOTSTRAP');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->verifyDeployment();
            $this->fail('Fresh deployment must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('existing migration tracking table', $error->getMessage());
        }
        $this->assertSame(0, (int) $this->db->query(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()'
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testVerifyRejectsPendingAndForeignHistoryWithoutChangingTracking(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT); INSERT INTO verify_probe VALUES (42);');
        try {
            $runner->verifyDeployment();
            $this->fail('Pending deployment must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('pending migration: migration.sql', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertMigrationLockFree();
        $runner->runUp();
        $this->assertSame(1, $runner->verifyDeployment());
        $this->db->exec("INSERT INTO schema_migrations (migration_name,checksum) VALUES ('newer.sql','unknown')");
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        try {
            $runner->verifyDeployment();
            $this->fail('Foreign history must block verification.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('absent from the deployment manifest: newer.sql', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(42, (int) $this->db->query('SELECT id FROM verify_probe')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testVerifyWorksWithSelectOnlyAccountAndDoesNotExecuteSql(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT); INSERT INTO verify_probe VALUES (42);');
        $runner->runUp();
        $username = 'gq_verify_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $limited->exec('USE `' . $this->database . '`');
            $readOnlyRunner = new MigrationRunner($limited, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
            $this->assertSame(1, $readOnlyRunner->verifyDeployment());
            $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame(42, (int) $this->db->query('SELECT id FROM verify_probe')->fetchColumn());
            $this->assertMigrationLockFree();
            $this->admin->exec('REVOKE SELECT ON `' . $this->database . '`.* FROM ' . $account);
            $this->admin->exec('GRANT CREATE ON `' . $this->database . '`.* TO ' . $account);
            $denied = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $denied->exec('USE `' . $this->database . '`');
            $deniedRunner = new MigrationRunner($denied, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            try {
                $deniedRunner->verifyDeployment();
                $this->fail('Denied SELECT must fail.');
            } catch (PDOException $error) {
                $this->assertSame(1142, $error->errorInfo[1]);
            }
            $this->assertMigrationLockFree();
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testVerifyRejectsActiveCallerTransactionWithoutCommittingIt(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT);');
        $runner->runUp();
        $this->db->beginTransaction();
        try {
            $runner->verifyDeployment();
            $this->fail('Caller transaction must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('without an active transaction', $error->getMessage());
        }
        $this->assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        $this->assertMigrationLockFree();
    }

    public function testCompleteV2MigrationAppliesToCurrentBaseSchema(): void
    {
        $schema = $this->readSqlForTestDatabase('schema.sql');
        $this->db->exec($schema);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_v2.sql'));

        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        $this->assertGreaterThan(0, (int)$this->db->query('SELECT COUNT(*) FROM achievements')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'user_id'"
        )->fetchColumn());
    }

    public function testLegacyBackfillsPreserveOwnershipResourcesAndExistingLinks(): void
    {
        $this->db->exec(
            "CREATE TABLE planets (
                id INT PRIMARY KEY, user_id INT, name VARCHAR(64), metal INT,
                crystal INT, deuterium INT, energy INT, is_homeworld TINYINT,
                last_update DATETIME
             );
             CREATE TABLE colonies (
                id INT AUTO_INCREMENT PRIMARY KEY, planet_id INT UNIQUE, user_id INT,
                name VARCHAR(64), colony_type VARCHAR(20), metal INT, crystal INT,
                deuterium INT, energy INT, is_homeworld TINYINT, last_update DATETIME
             );
             CREATE TABLE buildings (id INT PRIMARY KEY, planet_id INT, colony_id INT);
             CREATE TABLE ships (id INT PRIMARY KEY, planet_id INT, colony_id INT);
             CREATE TABLE fleets (id INT PRIMARY KEY, origin_planet_id INT, origin_colony_id INT);
             INSERT INTO planets VALUES
                (10, 42, 'Legacy home', 1234, 567, 89, 100, 1, '2026-10-01 12:00:00'),
                (11, NULL, 'Unowned', 0, 0, 0, 0, 0, '2026-10-01 12:00:00'),
                (12, 0, 'Unowned zero', 0, 0, 0, 0, 0, '2026-10-01 12:00:00');
             INSERT INTO buildings VALUES (1, 10, NULL), (2, 10, 999);
             INSERT INTO ships VALUES (1, 10, NULL), (2, 10, 999);
             INSERT INTO fleets VALUES (1, 10, NULL), (2, 10, 999);"
        );
        $runner = $this->buildRunner('SELECT 1;');
        $source = file_get_contents(__DIR__ . '/../../sql/migrate_v2.sql');
        $this->assertNotFalse($source);
        $statements = $runner->splitStatements($source);
        $backfills = [];
        foreach ($statements as $index => $statement) {
            if (str_starts_with($statement, 'SET @sql = IF(')
                && (str_contains($statement, "'INSERT IGNORE INTO colonies ")
                    || preg_match("/'UPDATE (buildings|ships|fleets) /", $statement))) {
                $backfills[] = implode(";\n", array_slice($statements, $index, 4)) . ';';
            }
        }
        $this->assertCount(4, $backfills);
        $runner = $this->buildRunner(implode("\n", $backfills));
        $runner->runUp();

        $colony = $this->db->query('SELECT * FROM colonies')->fetch(PDO::FETCH_ASSOC);
        $this->assertIsArray($colony);
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        foreach ([
            'planet_id' => '10', 'user_id' => '42', 'name' => 'Legacy home',
            'colony_type' => 'balanced', 'metal' => '1234', 'crystal' => '567',
            'deuterium' => '89', 'energy' => '100', 'is_homeworld' => '1',
            'last_update' => '2026-10-01 12:00:00',
        ] as $column => $expected) {
            $this->assertSame($expected, (string)$colony[$column]);
        }
        foreach (['buildings' => 'colony_id', 'ships' => 'colony_id', 'fleets' => 'origin_colony_id'] as $table => $column) {
            $this->assertSame((int)$colony['id'], (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 1'
            )->fetchColumn());
            $this->assertSame(999, (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 2'
            )->fetchColumn());
        }

        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame($colony, $this->db->query('SELECT * FROM colonies')->fetch(PDO::FETCH_ASSOC));
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
    }

    public function testColonyBuildingsForeignKeysMatchColonyIdsAndCascade(): void
    {
        $this->db->exec('CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_colony_buildings_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO colonies VALUES (42);
             INSERT INTO colony_building_slots (id, colony_id, slot_x, slot_y) VALUES (1, 42, 0, 0);
             INSERT INTO colony_building_upgrades (id, slot_id) VALUES (1, 1);"
        );
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_upgrades')->fetchColumn());
        $this->db->exec('UPDATE colonies SET id = 43 WHERE id = 42');
        $this->assertSame(43, (int)$this->db->query('SELECT colony_id FROM colony_building_slots')->fetchColumn());
        $this->db->exec('DELETE FROM colonies WHERE id = 43');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_slots')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_upgrades')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    /** @return iterable<string, array{bool}> */
    public static function reportSchemaModes(): iterable
    {
        yield 'current body identities' => [false];
        yield 'legacy colony identities' => [true];
    }

    #[DataProvider('reportSchemaModes')]
    public function testHardcutMapsLegacyReportsAndPreservesExistingBodyIds(bool $legacy): void
    {
        $this->db->exec(
            "CREATE TABLE planets (id INT PRIMARY KEY, galaxy INT, `system` INT, position INT);
             CREATE TABLE celestial_bodies (id BIGINT UNSIGNED PRIMARY KEY, body_uid VARCHAR(64) UNIQUE) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY, planet_id INT, body_id BIGINT UNSIGNED NULL) ENGINE=InnoDB;
             CREATE TABLE battle_reports (id INT PRIMARY KEY, defender_id INT, body_id BIGINT UNSIGNED NULL);
             CREATE TABLE spy_reports (id INT PRIMARY KEY, target_body_id BIGINT UNSIGNED NULL);
             INSERT INTO planets VALUES (10, 1, 2, 3);
             INSERT INTO celestial_bodies VALUES (100, 'legacy-p-1-2-3'), (200, 'other-body');
             INSERT INTO colonies VALUES (42, 10, NULL);
             INSERT INTO battle_reports VALUES (1, 5, NULL), (2, 5, 200);
             INSERT INTO spy_reports VALUES (1, NULL), (2, 200);"
        );
        if ($legacy) {
            $this->db->exec(
                'ALTER TABLE battle_reports ADD planet_id INT;
                 ALTER TABLE spy_reports ADD target_planet_id INT;
                 UPDATE battle_reports SET planet_id = 42;
                 UPDATE spy_reports SET target_planet_id = 42;'
            );
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $runner->runUp();
        $this->assertSame(100, (int)$this->db->query('SELECT body_id FROM colonies')->fetchColumn());
        foreach (['battle_reports' => 'body_id', 'spy_reports' => 'target_body_id'] as $table => $column) {
            $value = $this->db->query('SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 1')->fetchColumn();
            if ($legacy) {
                $this->assertSame(100, (int)$value);
            } else {
                $this->assertNull($value);
            }
            $this->assertSame(200, (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 2'
            )->fetchColumn());
        }
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
    }

    public function testHardcutAddsMissingReportBodyColumns(): void
    {
        $this->db->exec(
            'CREATE TABLE planets (id INT PRIMARY KEY, galaxy INT, `system` INT, position INT);
             CREATE TABLE celestial_bodies (id BIGINT UNSIGNED PRIMARY KEY, body_uid VARCHAR(64)) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY, planet_id INT, body_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB;
             CREATE TABLE battle_reports (id INT PRIMARY KEY, defender_id INT);
             CREATE TABLE spy_reports (id INT PRIMARY KEY);'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $runner->runUp();
        $this->assertSame(2, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND ((TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'body_id')
               OR (TABLE_NAME = 'spy_reports' AND COLUMN_NAME = 'target_body_id'))"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testCompleteHardcutAppliesToCurrentBaseSchema(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND ((TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'planet_id')
               OR (TABLE_NAME = 'spy_reports' AND COLUMN_NAME = 'target_planet_id'))"
        )->fetchColumn());
        $this->assertSame('NO', $this->db->query(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'colonies' AND COLUMN_NAME = 'body_id'"
        )->fetchColumn());
    }

    public function testNpcFtlMigrationBootstrapsMembershipBeforeHomeworldMigration(): void
    {
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY, control_type VARCHAR(24), ftl_drive_type VARCHAR(30)) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY, code VARCHAR(32)) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM npc_faction_memberships')->fetchColumn());
        $this->db->exec($this->readSqlForTestDatabase('migrate_faction_homeworlds_v1.sql'));
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
    }

    public function testMarketplaceMigrationResumesPartialColumnsAndPreservesLeaderData(): void
    {
        $this->db->exec(
            "CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE leaders (
                id INT PRIMARY KEY, user_id INT,
                role ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director') NOT NULL,
                skill_efficiency TINYINT UNSIGNED NOT NULL DEFAULT 1,
                rarity ENUM('common','uncommon','rare','legendary') NOT NULL DEFAULT 'common'
             ) ENGINE=InnoDB;
             INSERT INTO users VALUES (42);
             INSERT INTO leaders VALUES (1, 42, 'colony_manager', 3, 'rare');"
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_marketplace_advisor.sql'));
        $runner->runUp();
        $this->assertSame('rare', $this->db->query('SELECT rarity FROM leaders')->fetchColumn());
        $this->assertSame('👤', $this->db->query('SELECT portrait FROM leaders')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT skill_guidance FROM leaders')->fetchColumn());
        $this->assertSame(8, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
               AND COLUMN_NAME IN ('rarity','portrait','tagline','backstory','trait_1','trait_2','skill_guidance','marketplace_source_id')"
        )->fetchColumn());
        $this->db->exec(
            "UPDATE leaders SET role = 'advisor', tagline = 'Keep this profile';
             INSERT INTO leader_marketplace (user_id, name, role, backstory, expires_at)
             VALUES (42, 'Advisor', 'advisor', 'History', '2026-12-01');
             INSERT INTO advisor_hints (user_id, leader_id, title, body) VALUES (42, 1, 'Hint', 'Details');"
        );
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame('Keep this profile', $this->db->query('SELECT tagline FROM leaders')->fetchColumn());
        $this->assertSame('advisor', $this->db->query('SELECT role FROM leaders')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM leader_marketplace')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM advisor_hints')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testSpeciesMigrationSeparatesEscapedNamesWithNativePrepares(): void
    {
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_faction_species_v1.sql'));
        $runner->runUp();
        $this->assertSame(6, (int)$this->db->query('SELECT COUNT(*) FROM faction_species')->fetchColumn());
        $this->assertSame("Vor'Tak", $this->db->query(
            "SELECT display_name FROM faction_species WHERE species_code = 'vor_tak'"
        )->fetchColumn());
        $this->assertSame("Vel'Ar", $this->db->query(
            "SELECT display_name FROM faction_species WHERE species_code = 'vel_ar'"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testWorldScenarioMigrationRetainsJsonDefaults(): void
    {
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY) ENGINE=InnoDB;'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_world_scenarios_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO world_scenarios (code, title_de, description_de) VALUES ('test', 'Title', 'Description')"
        );
        $this->assertSame(
            ['phases_json' => '[]', 'conclusions_json' => '[]', 'effects_json' => '{}'],
            $this->db->query('SELECT phases_json, conclusions_json, effects_json FROM world_scenarios')->fetch(PDO::FETCH_ASSOC)
        );
        $this->assertSame(1, $this->trackingCount());
    }

    public function testUpdateMigrationUsesUserActorsAndPreservesConfiguration(): void
    {
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO users VALUES (42)');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_updates_system_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO update_history (operation_type, admin_user_id) VALUES ('check', 42);
             UPDATE update_configuration SET config_value = 'custom-owner', updated_by = 42 WHERE config_key = 'github_owner';"
        );
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame('custom-owner', $this->db->query(
            "SELECT config_value FROM update_configuration WHERE config_key = 'github_owner'"
        )->fetchColumn());
        $this->assertSame(10, (int)$this->db->query('SELECT COUNT(*) FROM update_configuration')->fetchColumn());
        $this->db->exec('DELETE FROM users WHERE id = 42');
        $this->assertNull($this->db->query('SELECT admin_user_id FROM update_history')->fetchColumn());
        $this->assertNull($this->db->query(
            "SELECT updated_by FROM update_configuration WHERE config_key = 'github_owner'"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testCompleteCanonicalManifestAppliesAndSecondRunIsEmpty(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        $results = $runner->runUp();
        $this->assertSame($manifest, array_column($results, 'name'));
        $this->assertSame(count($manifest), $this->trackingCount());
        foreach ($runner->getStatus() as $migration) {
            $this->assertSame('applied', $migration['status']);
            $this->assertSame(md5_file($this->sqlDir . '/' . $migration['name']), $migration['checksum']);
            $this->assertSame('TEST', $migration['environment']);
        }
        $this->assertSame(count($manifest), $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testOnDemandEconomyUsesCanonicalMySqlSchemaAndNativePrepares(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        $runner->runUp();
        $this->db->exec(<<<'SQL'
            INSERT INTO users (id,username,email,password_hash,credits)
                VALUES (42,'economic_test','economy@example.invalid','not-a-password',100000);
            INSERT INTO planets (id,galaxy,`system`,position) VALUES (42,1,1,1);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
                VALUES (42,'economy-test-body',1,1,1,'planet','Economic test');
            INSERT INTO colonies (id,user_id,body_id,planet_id,metal,crystal,deuterium,food)
                VALUES (42,42,42,42,10000,10000,10000,500);
            INSERT INTO buildings (colony_id,type,level) VALUES
                (42,'solar_plant',10),(42,'metal_mine',1),(42,'hydroponic_farm',1),
                (42,'habitat',1),(42,'hospital',1);
            INSERT INTO research (user_id,type,level) VALUES (42,'energy_tech',1);
            SQL);
        $economy = new OnDemandEconomy($this->db);
        $now = time();
        $snapshot = $economy->settle(42, 42, $now - 3600);
        $this->assertSame(100, array_sum($snapshot['pop_classes']));
        $snapshot = $economy->settle(42, 42, $now);
        $this->assertSame($now, $snapshot['economy']['settled_at']);
        $this->assertGreaterThan(0, $snapshot['economy']['production']['metal']);
        $economy->configure(42, 'tax_income', 0.2);
        $economy->configure(42, 'subsidy_agriculture', true);
        $economy->method(42, 42, 'metallurgy', 'efficient');
        $queue = $economy->queue(42, 42, 'metallurgy', [1, 1]);
        $this->assertSame(1, $queue['target_level']);
        $this->assertGreaterThan(0, $queue['cost']['metal']);
        $before = (float)$this->db->query('SELECT food FROM colonies WHERE id=42')->fetchColumn();
        $economy->exchange(42, 42, 'food', 10, true);
        $this->assertEqualsWithDelta(
            $before + 10,
            (float)$this->db->query('SELECT food FROM colonies WHERE id=42')->fetchColumn(),
            0.1
        );
        $this->assertSame(1, $economy->market(1, 1)['goods']['food']['represented_colonies']);
        $this->assertFalse($this->db->inTransaction());
        $other = $this->secondConnection();
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $this->db->beginTransaction();
        $this->db->query('SELECT id FROM users WHERE id=42 FOR UPDATE')->fetch();
        try {
            (new OnDemandEconomy($other))->exchange(42, 42, 'food', 1, true);
            $this->fail('A concurrent order must not bypass the account lock.');
        } catch (PDOException $error) {
            $this->assertSame(1205, (int)$error->errorInfo[1]);
            $this->assertFalse($other->inTransaction());
        } finally {
            $this->db->rollBack();
        }
        (new OnDemandEconomy($other))->exchange(42, 42, 'food', 1, true);
        $this->assertFalse($other->inTransaction());
        $this->db->exec('DELETE FROM colonies WHERE id=42');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_colony_market')->fetchColumn());
    }

    /** @return iterable<string, array{bool}> */
    public static function projectionTimestampModes(): iterable
    {
        yield 'new timestamp column' => [false];
        yield 'existing timestamp column' => [true];
    }

    #[DataProvider('projectionTimestampModes')]
    public function testProjectionMigrationPreservesHistoricalTimestampsInStrictMode(bool $existing): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_system_snapshot_v1.sql'));
        $strictMode = (string)$this->db->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        $this->assertStringContainsString('STRICT_TRANS_TABLES', $strictMode);
        if ($existing) {
            $this->db->exec('ALTER TABLE projection_dirty_queue ADD created_at DATETIME NULL');
        }
        $this->db->exec(
            "INSERT INTO projection_dirty_queue (entity_id, enqueued_at) VALUES
                (1, '2026-01-02 03:04:05'), (2, '2026-02-03 04:05:06');"
        );
        if ($existing) {
            $this->db->exec("UPDATE projection_dirty_queue SET created_at = '2026-03-04 05:06:07' WHERE entity_id = 1");
            $this->db->exec("SET SESSION sql_mode = ''");
            $this->db->exec(
                "INSERT INTO projection_dirty_queue (entity_id, enqueued_at, created_at)
                 VALUES (3, '2026-04-05 06:07:08', '0000-00-00 00:00:00')"
            );
            $this->db->prepare('SET SESSION sql_mode = ?')->execute([$strictMode]);
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql'));
        $runner->runUp();
        $expected = $existing
            ? ['2026-03-04 05:06:07', '2026-02-03 04:05:06', '2026-04-05 06:07:08']
            : ['2026-01-02 03:04:05', '2026-02-03 04:05:06'];
        $this->assertSame($expected, $this->db->query(
            'SELECT created_at FROM projection_dirty_queue ORDER BY entity_id'
        )->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame($strictMode, $this->db->query('SELECT @@SESSION.sql_mode')->fetchColumn());
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame($expected, $this->db->query(
            'SELECT created_at FROM projection_dirty_queue ORDER BY entity_id'
        )->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame(1, $this->trackingCount());
    }

    public function testNpcFtlMigrationAndRuntimeUseMembershipAndPreserveOtherAccounts(): void
    {
        require_once __DIR__ . '/../../api/npc_ai.php';
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY, control_type VARCHAR(24), ftl_drive_type VARCHAR(30)) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY, code VARCHAR(32)) ENGINE=InnoDB;'
        );
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $codes = [
            'empire' => 'vor_tak', 'pve_empire' => 'vor_tak',
            'science' => 'zhareen', 'pve_science' => 'zhareen',
            'pirates' => 'kryl_tha', 'pve_pirates' => 'kryl_tha',
            'precursors' => 'vel_ar', 'pve_precursors' => 'vel_ar',
            'guild' => 'syl_nar', 'pve_guild' => 'syl_nar',
            'collective' => 'aereth',
        ];
        $expected = [];
        $id = 0;
        foreach ($codes as $code => $drive) {
            $id++;
            $this->db->prepare('INSERT INTO npc_factions VALUES (?, ?)')->execute([$id, $code]);
            $this->db->prepare("INSERT INTO users VALUES (?, 'npc_engine', 'aereth')")->execute([$id]);
            $this->db->prepare('INSERT INTO npc_faction_memberships VALUES (?, ?)')->execute([$id, $id]);
            $expected[$id] = $drive;
        }
        $this->db->exec(
            "INSERT INTO users VALUES (90, 'human', 'aereth'), (91, 'npc_engine', 'vel_ar'), (92, 'npc_engine', 'aereth');
             INSERT INTO npc_faction_memberships VALUES (90, 1), (91, 1);"
        );
        $expected += [90 => 'aereth', 91 => 'vel_ar', 92 => 'aereth'];
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $runner->runUp();
        foreach ($expected as $userId => $drive) {
            $this->assertSame($drive, $this->db->query(
                'SELECT ftl_drive_type FROM users WHERE id = ' . $userId
            )->fetchColumn());
        }
        $this->db->exec("UPDATE users SET ftl_drive_type = 'aereth' WHERE id < 90");
        foreach ($expected as $userId => $drive) {
            npc_assign_ftl_drive($this->db, $userId);
            npc_assign_ftl_drive($this->db, $userId);
            $this->assertSame($drive, $this->db->query(
                'SELECT ftl_drive_type FROM users WHERE id = ' . $userId
            )->fetchColumn());
        }
    }

    public function testDdlMigrationIsTrackedAndNotReapplied(): void
    {
        $sql = 'CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB;
                INSERT INTO example VALUES (1);
                ALTER TABLE example ADD label VARCHAR(20);
                UPDATE example SET label = \'ready\';';
        $runner = $this->buildRunner($sql);

        $result = $runner->runUp();

        $this->assertCount(1, $result);
        $this->assertSame(4, $result[0]['statements']);
        $this->assertSame('ready', $this->db->query('SELECT label FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame(md5($sql), $runner->getStatus()[0]['checksum']);
        $this->assertSame([], $runner->runUp());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlRollbackRemovesTracking(): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB;',
            'DROP TABLE example;'
        );
        $runner->runUp();

        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame([], $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlFailurePreservesOriginalErrorAndDoesNotTrackMigration(): void
    {
        $runner = $this->buildRunner('CREATE TABLE example (id INT); THIS IS NOT SQL;');

        try {
            $runner->runUp();
            $this->fail('Expected migration failure.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Migration "migration.sql" failed:', $e->getMessage());
            $this->assertStringContainsString('Changes may already be committed', $e->getMessage());
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(0, $this->trackingCount());
        $this->assertCount(1, $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlRollbackFailureKeepsTrackingAndOriginalError(): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE example (id INT);',
            'DROP TABLE example; THIS IS NOT SQL;'
        );
        $runner->runUp();

        try {
            $runner->runRollback();
            $this->fail('Expected rollback failure.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback of "migration.sql" failed:', $e->getMessage());
            $this->assertStringContainsString('Changes may already be committed', $e->getMessage());
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlMigrationCommitsDataAndTracking(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);');

        $runner->runUp();

        $this->assertSame('1', (string)$this->db->query('SELECT id FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlFailureRollsBackData(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1); INSERT INTO example VALUES (1);');

        try {
            $runner->runUp();
            $this->fail('Expected duplicate-key failure.');
        } catch (RuntimeException $e) {
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('23000', $e->getPrevious()->getCode());
        }

        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlRollbackCommitsDeletionAndTrackingRemoval(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);', 'DELETE FROM example;');
        $runner->runUp();

        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlRollbackFailureRestoresDataAndKeepsTracking(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);', 'DELETE FROM example; THIS IS NOT SQL;');
        $runner->runUp();

        try {
            $runner->runRollback();
            $this->fail('Expected rollback failure.');
        } catch (RuntimeException $e) {
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    /** @return iterable<string, array{string, int}> */
    public static function conditionalAlterFiles(): iterable
    {
        yield 'legacy v2' => ['migrate_v2.sql', 71];
        yield 'colonization' => ['migrate_colonization_v2.sql', 4];
        yield 'FTL drives' => ['migrate_vessel_blueprints_v10_ftl_drives.sql', 2];
        yield 'FTL phase 4' => ['migrate_vessel_blueprints_v11_ftl_phase4.sql', 2];
        yield 'fleet labels' => ['migrate_fleet_labels_v1.sql', 1];
        yield 'projection runtime' => ['migrate_projection_runtime_v2.sql', 8];
    }

    #[DataProvider('conditionalAlterFiles')]
    public function testActualConditionalAltersSupportPartialSchemasAndReexecution(string $file, int $guardCount): void
    {
        foreach ([
            'users' => 'is_admin TINYINT',
            'star_systems' => 'frost_line_au DOUBLE, name VARCHAR(16)',
            'planets' => 'user_id INT, type VARCHAR(20), temp_max INT',
            'buildings' => '',
            'ships' => '',
            'fleets' => '',
            'colonies' => '',
            'battle_reports' => 'attacker_id INT, defender_id INT, created_at DATETIME',
            'research' => 'research_end DATETIME',
            'projection_dirty_queue' => 'entity_id VARCHAR(60), next_attempt_at DATETIME',
        ] as $table => $columns) {
            $this->db->exec(
                'CREATE TABLE ' . $table . ' (id INT PRIMARY KEY'
                . ($columns !== '' ? ', ' . $columns : '') . ') ENGINE=InnoDB'
            );
        }

        $runner = $this->buildRunner('SELECT 1;');
        $source = file_get_contents(__DIR__ . '/../../sql/' . $file);
        $this->assertNotFalse($source);
        $statements = $runner->splitStatements($source);
        $guards = [];
        foreach ($statements as $index => $statement) {
            if (str_starts_with($statement, 'SET @sql = IF(')
                && str_contains($statement, 'information_schema.')) {
                $this->assertSame('PREPARE _stmt FROM @sql', $statements[$index + 1]);
                $this->assertSame('EXECUTE _stmt', $statements[$index + 2]);
                $this->assertSame('DEALLOCATE PREPARE _stmt', $statements[$index + 3]);
                $guards[] = implode(";\n", array_slice($statements, $index, 4)) . ';';
            }
        }
        $this->assertCount($guardCount, $guards);

        // Apply the first guard independently to model an interrupted deployment.
        $this->buildRunner($guards[0])->runUp();
        $alterGuards = array_values(array_filter($guards, static fn(string $guard): bool => str_contains($guard, "'ALTER TABLE ")));
        $this->db->exec('DELETE FROM schema_migrations');
        $runner = $this->buildRunner(implode("\n", $alterGuards));
        $this->assertSame(count($alterGuards) * 4, $runner->runUp()[0]['statements']);
        $this->assertSame(1, $this->trackingCount());
        foreach ($alterGuards as $guard) {
            $this->assertSame(1, preg_match(
                '/\((SELECT COUNT\(\*\) FROM information_schema\.[\s\S]*?)\) = 0,/',
                $guard,
                $match
            ));
            $this->assertGreaterThan(0, (int)$this->db->query($match[1])->fetchColumn());
        }
        if ($file === 'migrate_vessel_blueprints_v11_ftl_phase4.sql') {
            $this->assertSame(
                "Vel'Ar FTL: fleet hidden from enemies until this timestamp",
                $this->db->query(
                    "SELECT COLUMN_COMMENT FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
                       AND COLUMN_NAME = 'stealth_until'"
                )->fetchColumn()
            );
        }

        $snapshot = $this->db->query(
            'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION'
        )->fetchAll(PDO::FETCH_ASSOC);
        $indexes = $this->db->query(
            'SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'
        )->fetchAll(PDO::FETCH_ASSOC);

        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();

        $this->assertSame($snapshot, $this->db->query(
            'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($indexes, $this->db->query(
            'SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }
}
