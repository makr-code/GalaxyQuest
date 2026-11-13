<?php

declare(strict_types=1);

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols, PSR1.Classes.ClassDeclaration -- Standalone inspection tests. */

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 2) . '/scripts/inspect_game_administration.php';

final class GameAdministrationSnapshotTest extends TestCase
{
    private string $root;
    private string $release;

    protected function setUp(): void
    {
        $this->root = sys_get_temp_dir() . '/gq-admin-snapshot-' . bin2hex(random_bytes(8));
        $this->release = $this->root . '/release';
        self::assertTrue(mkdir($this->release . '/sql', 0700, true));
        self::assertTrue(mkdir($this->release . '/config', 0700));
        file_put_contents($this->release . '/config/migrations_manifest.php', "<?php return ['first.sql'];\n");
        file_put_contents($this->release . '/sql/first.sql', 'CREATE TABLE must_not_exist (id INT);');
        file_put_contents($this->release . '/sql/schema.sql', 'INVALID BASELINE MUST NOT EXECUTE');
        file_put_contents($this->release . '/VERSION.txt', "1.2.3\n");
        file_put_contents($this->release . '/native-release.json', json_encode([
            'commit' => str_repeat('a', 40), 'web_image_id' => 'sha256:' . str_repeat('b', 64),
            'status' => 'not-deployable',
        ], JSON_THROW_ON_ERROR));
    }

    protected function tearDown(): void
    {
        foreach (
            [
            '/release/sql/first.sql', '/release/sql/schema.sql', '/release/config/migrations_manifest.php',
            '/release/VERSION.txt', '/release/native-release.json', '/report.json', '/config.json',
            ] as $file
        ) {
            if (is_file($this->root . $file)) {
                unlink($this->root . $file);
            }
        }
        rmdir($this->release . '/sql');
        rmdir($this->release . '/config');
        rmdir($this->release);
        rmdir($this->root);
    }

    public function testInvalidCliOptionsFailBeforeConnecting(): void
    {
        $this->expectException(InvalidArgumentException::class);
        gq_admin_snapshot_main(['--environment=production', '--execute=yes']);
    }

    public function testRefusesEnvironmentMismatchInPrivateConfigBeforeConnecting(): void
    {
        file_put_contents($this->root . '/config.json', '{"environment":"production"}');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('environment-bound database configuration');
        gq_admin_snapshot_main([
            '--environment=staging', '--db-config=' . $this->root . '/config.json',
            '--release-dir=' . $this->release, '--output=' . $this->root . '/report.json',
        ]);
    }

    public function testReportWriterAtomicallyReplacesOnlyPrivateExternalJson(): void
    {
        file_put_contents($this->root . '/report.json', 'old');
        gq_admin_snapshot_write($this->root . '/report.json', $this->release, ['read_only' => true]);
        self::assertSame(
            ['read_only' => true],
            json_decode((string)file_get_contents($this->root . '/report.json'), true, 16, JSON_THROW_ON_ERROR)
        );
        if (DIRECTORY_SEPARATOR === '/') {
            self::assertSame(0600, fileperms($this->root . '/report.json') & 0777);
        }
        self::assertSame([], glob($this->root . '/.gq-admin-*'));
    }

    public function testReportCannotBeWrittenInsideRelease(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('outside the release directory');
        gq_admin_snapshot_write($this->release . '/report.json', $this->release, []);
    }

    public function testMysqlInspectionUsesASelectOnlyAccountAndNeverBootstraps(): void
    {
        $dsn = getenv('GQ_GAME_ADMIN_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Requires a dedicated disposable gq_admin_inspection MySQL database.');
        }
        $root = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::assertSame('gq_admin_inspection', $root->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        $root->exec("CREATE USER 'gq_admin_reader'@'%' IDENTIFIED BY 'fixture-read-only'");
        $root->exec('GRANT SELECT ON gq_admin_inspection.* TO \'gq_admin_reader\'@\'%\'');
        $reader = new PDO($dsn, 'gq_admin_reader', 'fixture-read-only', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);

        $empty = gq_admin_snapshot_collect($reader, 'staging', $this->release, 'gq_admin_inspection');
        self::assertSame('empty', $empty['plan']['database']['state']);
        self::assertFalse($empty['plan']['migrations']['tracking_present']);
        self::assertSame('pending', $empty['plan']['migrations']['entries'][0]['status']);
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));

        self::assertSame(1, preg_match('/host=([^;]+)/', $dsn, $host));
        file_put_contents($this->root . '/config.json', json_encode([
            'environment' => 'staging', 'host' => $host[1], 'port' => 3306,
            'database' => 'gq_admin_inspection', 'username' => 'gq_admin_reader', 'password' => 'fixture-read-only',
        ], JSON_THROW_ON_ERROR));
        gq_admin_snapshot_main([
            '--environment=staging', '--db-config=' . $this->root . '/config.json',
            '--release-dir=' . $this->release, '--output=' . $this->root . '/report.json',
        ]);
        $published = json_decode(
            (string)file_get_contents($this->root . '/report.json'),
            true,
            32,
            JSON_THROW_ON_ERROR
        );
        self::assertSame('empty', $published['plan']['database']['state']);
        self::assertSame('gq_admin_inspection', $published['plan']['database']['name']);
        self::assertStringNotContainsString(
            'fixture-read-only',
            (string)file_get_contents($this->root . '/report.json')
        );
        self::assertSame([], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));

        $root->exec('CREATE VIEW inspection_view AS SELECT 1 AS marker');
        $untracked = gq_admin_snapshot_collect($reader, 'staging', $this->release, 'gq_admin_inspection');
        self::assertSame('untracked', $untracked['plan']['database']['state']);
        self::assertNotEmpty($untracked['plan']['migrations']['blockers']);
        $root->exec('DROP VIEW inspection_view');

        $root->exec('CREATE TABLE schema_migrations (
            migration_name VARCHAR(255) PRIMARY KEY, applied_at VARCHAR(30),
            checksum VARCHAR(32), environment VARCHAR(20)
        )');
        $insert = $root->prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)');
        $insert->execute(['first.sql', '2026-11-13 00:00:00', md5('CREATE TABLE must_not_exist (id INT);'), 'STAGING']);
        $before = $root->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        $tracked = gq_admin_snapshot_collect($reader, 'staging', $this->release, 'gq_admin_inspection');
        self::assertSame('tracked', $tracked['plan']['database']['state']);
        self::assertSame('executed', $tracked['plan']['migrations']['entries'][0]['status']);
        self::assertSame(
            hash('sha256', json_encode($tracked['plan'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
            $tracked['plan_sha256']
        );
        self::assertSame($before, $root->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
        self::assertSame(['schema_migrations'], $root->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
        $root->exec("UPDATE schema_migrations SET checksum = 'changed'");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('checksum mismatch');
        gq_admin_snapshot_collect($reader, 'staging', $this->release, 'gq_admin_inspection');
    }
}
