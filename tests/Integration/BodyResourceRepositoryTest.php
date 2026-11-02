<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/BodyResourceRepository.php';

/**
 * SQLite by default; GQ_BODY_RESOURCE_TEST_DSN enables disposable MySQL databases.
 */
final class BodyResourceRepositoryTest extends TestCase
{
    private PDO $db;
    private BodyResourceRepository $repository;
    private string $database = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_BODY_RESOURCE_TEST_DSN');
        if ($dsn) {
            $this->db = new PDO($dsn, getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root', getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '', [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->database = 'gq_body_resources_' . bin2hex(random_bytes(6));
            $this->db->exec('CREATE DATABASE `' . $this->database . '`');
            $this->db->exec('USE `' . $this->database . '`');
        } else {
            $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $this->db->exec('PRAGMA foreign_keys = ON');
        }
        $this->db->exec(
            'CREATE TABLE celestial_bodies (
                id BIGINT UNSIGNED PRIMARY KEY, body_type VARCHAR(32), parent_body_type VARCHAR(32),
                galaxy_index INT, system_index INT, position INT, planet_class VARCHAR(32),
                mass_earth DOUBLE, payload_json TEXT
            )'
        );
        $this->db->exec(
            'CREATE TABLE planets (
                galaxy INT, `system` INT, position INT,
                deposit_metal BIGINT, deposit_crystal BIGINT, deposit_deuterium BIGINT, deposit_rare_earth BIGINT,
                richness_metal DOUBLE, richness_crystal DOUBLE, richness_deuterium DOUBLE, richness_rare_earth DOUBLE
            )'
        );
        $migration = file_get_contents(__DIR__ . '/../../sql/migrate_body_resources_v1.sql');
        if (!$dsn) {
            $migration = preg_replace("/ENUM\\([^)]*\\)/", 'VARCHAR(32)', $migration);
            $migration = str_replace('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', '', $migration);
        }
        $this->db->exec($migration);
        $this->db->exec($migration);
        $this->repository = new BodyResourceRepository($this->db);
    }

    protected function tearDown(): void
    {
        if ($this->db->inTransaction()) {
            $this->db->rollBack();
        }
        if ($this->database !== '') {
            $this->db->exec('DROP DATABASE `' . $this->database . '`');
        }
    }

    private function seedBody(int $id = 1, string $type = 'planet', ?array $payload = null): void
    {
        $this->db->prepare(
            'INSERT INTO celestial_bodies
             (id, body_type, parent_body_type, galaxy_index, system_index, position, planet_class, mass_earth, payload_json)
             VALUES (?, ?, ?, 1, 5, 2, ?, 0.01, ?)'
        )->execute([
            $id, $type, $type === 'planet' ? 'star' : 'planet', $type === 'ring_system' ? null : 'ice_dwarf',
            $payload === null ? null : json_encode($payload, JSON_THROW_ON_ERROR),
        ]);
    }

    public function testPreviewIsReadOnlyAndCapturePreservesLegacyRestWithoutResetting(): void
    {
        $this->seedBody();
        $this->db->exec('INSERT INTO planets VALUES (1, 5, 2, 0, 123, -1, 17, 1, 1, 1, 0.5)');
        $profile = $this->repository->preview(1);
        self::assertSame(0.0, $profile['sources']['metal']['remaining_quantity']);
        self::assertNull($profile['sources']['crystal']['initial_quantity']);
        self::assertSame('unlimited', $profile['sources']['deuterium']['source_type']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_profiles')->fetchColumn());
        self::assertSame(4, $this->repository->capture(1));
        $this->db->exec("UPDATE body_resource_sources SET remaining_quantity = 5 WHERE resource_type = 'crystal'");
        $this->db->exec('UPDATE planets SET deposit_crystal = 9999');
        self::assertSame(0, $this->repository->capture(1));
        self::assertSame(5.0, (float)$this->db->query(
            "SELECT remaining_quantity FROM body_resource_sources WHERE resource_type = 'crystal'"
        )->fetchColumn());
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_profiles')->fetchColumn());
    }

    public function testMoonDoesNotInheritPlanetDepositAtSamePosition(): void
    {
        $this->seedBody(2, 'moon');
        $this->db->exec('INSERT INTO planets VALUES (1, 5, 2, 0, 0, 0, 0, 1, 1, 1, 0.5)');
        $profile = $this->repository->preview(2);
        self::assertGreaterThan(0, $profile['sources']['metal']['remaining_quantity']);
        self::assertSame('generated', $profile['sources']['metal']['origin']);
        self::assertSame(4, $this->repository->capture(2));
    }

    public function testUnknownRingRemainsUnassessedAcrossRepeatedCapture(): void
    {
        $this->seedBody(3, 'ring_system');
        self::assertSame(0, $this->repository->capture(3));
        self::assertSame('unassessed', $this->db->query(
            'SELECT assessment FROM body_resource_profiles WHERE body_id = 3'
        )->fetchColumn());
        self::assertSame(0, $this->repository->capture(3));
    }

    public function testProfileCaptureIsAtomicOnInvalidData(): void
    {
        $this->seedBody();
        $this->db->exec('INSERT INTO planets VALUES (1, 5, 2, -2, 0, 0, 0, 1, 1, 1, 0.5)');
        try {
            $this->repository->capture(1);
            self::fail('Invalid legacy data must not be captured.');
        } catch (InvalidArgumentException) {
            self::assertFalse($this->db->inTransaction());
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_profiles')->fetchColumn());
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_sources')->fetchColumn());
        }
    }

    public function testInsertFailureRollsBackProfileHeader(): void
    {
        $this->seedBody();
        $this->db->exec('DROP TABLE body_resource_sources');
        try {
            $this->repository->capture(1);
            self::fail('Missing source table must fail.');
        } catch (PDOException) {
            self::assertFalse($this->db->inTransaction());
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_profiles')->fetchColumn());
        }
    }

    public function testPreviewDoesNotRequireSnapshotTables(): void
    {
        $this->seedBody();
        $this->db->exec('DROP TABLE body_resource_sources');
        $this->db->exec('DROP TABLE body_resource_profiles');
        self::assertCount(4, $this->repository->preview(1)['sources']);
    }

    public function testRecaptureDoesNotAddNewlyGeneratedSources(): void
    {
        $this->seedBody(2, 'moon');
        $this->repository->capture(2);
        $this->db->prepare('UPDATE celestial_bodies SET payload_json = ? WHERE id = 2')->execute([
            json_encode([
                'water_state' => 'liquid', 'atmosphere_type' => 'nitrogen_oxygen',
                'eq_temp_k' => 280, 'habitability_score' => 80,
            ], JSON_THROW_ON_ERROR),
        ]);
        self::assertArrayHasKey('biomass', $this->repository->preview(2)['sources']);
        self::assertSame(0, $this->repository->capture(2));
        self::assertSame(4, (int)$this->db->query(
            'SELECT COUNT(*) FROM body_resource_sources WHERE body_id = 2'
        )->fetchColumn());
    }

    public function testCaptureDoesNotCommitCallerTransaction(): void
    {
        $this->db->beginTransaction();
        try {
            $this->repository->capture(1);
            self::fail('Caller transaction must not be used.');
        } catch (LogicException) {
            self::assertTrue($this->db->inTransaction());
        }
    }

    public function testPayloadNumbersSurviveNullableColumns(): void
    {
        $this->seedBody(2, 'moon', ['mass_earth' => 0.02, 'planet_class' => 'rocky']);
        $this->db->exec('UPDATE celestial_bodies SET mass_earth = NULL, planet_class = NULL WHERE id = 2');
        $profile = $this->repository->preview(2);
        self::assertNotEmpty($profile['sources']);
        self::assertGreaterThan(0, $this->repository->capture(2));
    }

    public function testMissingBodyAndMalformedPayloadFailExplicitly(): void
    {
        try {
            $this->repository->capture(404);
            self::fail('Missing body must fail.');
        } catch (OutOfBoundsException) {
            self::assertFalse($this->db->inTransaction());
        }
        $this->seedBody();
        $this->db->exec("UPDATE celestial_bodies SET payload_json = 'broken' WHERE id = 1");
        $this->expectException(JsonException::class);
        $this->repository->capture(1);
    }

    public function testConstraintsRejectInvalidUnlimitedQuantity(): void
    {
        $this->seedBody();
        $this->repository->capture(1);
        $this->expectException(PDOException::class);
        $this->db->exec("UPDATE body_resource_sources SET source_type = 'unlimited' WHERE resource_type = 'metal'");
    }

    public function testRegeneratingSourcePersistsWithBoundedCapacity(): void
    {
        $this->seedBody(2, 'moon', [
            'water_state' => 'liquid', 'atmosphere_type' => 'nitrogen_oxygen',
            'eq_temp_k' => 280, 'habitability_score' => 80,
        ]);
        self::assertSame(5, $this->repository->capture(2));
        $source = $this->db->query(
            "SELECT * FROM body_resource_sources WHERE body_id = 2 AND resource_type = 'biomass'"
        )->fetch(PDO::FETCH_ASSOC);
        self::assertSame('regenerating', $source['source_type']);
        self::assertSame(100.0, (float)$source['capacity']);
        self::assertSame(0.1, (float)$source['regeneration_per_hour']);
        foreach ([
            'remaining_quantity = capacity + 1', 'remaining_quantity = -1', 'remaining_quantity = NULL',
            'regeneration_per_hour = 0', 'initial_quantity = -1',
        ] as $invalidUpdate) {
            try {
                $this->db->exec(
                    "UPDATE body_resource_sources SET {$invalidUpdate} WHERE body_id = 2 AND resource_type = 'biomass'"
                );
                self::fail('Invalid regenerating inventory accepted.');
            } catch (PDOException) {
                self::assertSame(100.0, (float)$this->db->query(
                    "SELECT remaining_quantity FROM body_resource_sources WHERE body_id = 2 AND resource_type = 'biomass'"
                )->fetchColumn());
            }
        }
    }

    public function testDeletingBodyCascadesOnlyItsOwnResources(): void
    {
        $this->seedBody(1);
        $this->seedBody(2, 'moon');
        $this->repository->capture(1);
        $this->repository->capture(2);
        $this->db->exec('DELETE FROM celestial_bodies WHERE id = 1');
        self::assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM body_resource_sources WHERE body_id = 1'
        )->fetchColumn());
        self::assertSame(4, (int)$this->db->query(
            'SELECT COUNT(*) FROM body_resource_sources WHERE body_id = 2'
        )->fetchColumn());
    }

    private function runCaptureCli(array $arguments, array $environment = []): array
    {
        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../../scripts/capture_body_resources.php', ...$arguments],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            null,
            array_replace(getenv(), $environment)
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return ['exit' => proc_close($process), 'stdout' => $stdout, 'stderr' => $stderr];
    }

    public function testCliRejectsInvalidArgumentsBeforeConnecting(): void
    {
        foreach (['--limit=0', '--limit=1001', '--after=-1', '--after=999999999999999999999', '--unknown'] as $argument) {
            $result = $this->runCaptureCli([$argument]);
            self::assertSame(1, $result['exit']);
            self::assertSame('', $result['stdout']);
            self::assertNotSame('', $result['stderr']);
            self::assertStringNotContainsString('capture failed', $result['stderr']);
        }
    }

    public function testCliPreviewAndApplyAgainstDisposableMySql(): void
    {
        if ($this->database === '') {
            self::markTestSkipped('CLI persistence test requires GQ_BODY_RESOURCE_TEST_DSN.');
        }
        $settings = [];
        foreach (explode(';', substr((string)getenv('GQ_BODY_RESOURCE_TEST_DSN'), 6)) as $setting) {
            $pair = explode('=', $setting, 2);
            if (count($pair) === 2) {
                $settings[$pair[0]] = $pair[1];
            }
        }
        $environment = [
            'DB_HOST' => $settings['host'] ?? 'localhost',
            'DB_PORT' => $settings['port'] ?? '3306',
            'DB_NAME' => $this->database,
            'DB_USER' => getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root',
            'DB_PASS' => getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '',
        ];
        // config.php treats an empty DB_PASS as "use default".
        $user = 'gq_cli_' . bin2hex(random_bytes(6));
        $password = bin2hex(random_bytes(16));
        $this->db->exec("CREATE USER '{$user}'@'%' IDENTIFIED BY '{$password}'");
        try {
            $this->db->exec('GRANT ALL ON `' . $this->database . "`.* TO '{$user}'@'%'");
            $environment['DB_USER'] = $user;
            $environment['DB_PASS'] = $password;
            $this->seedBody();
            $this->seedBody(2, 'moon');
            foreach ([[], ['--apply'], ['--apply']] as $index => $arguments) {
                $result = $this->runCaptureCli([...$arguments, '--limit=1'], $environment);
                self::assertSame(0, $result['exit'], $result['stderr']);
                $lines = explode("\n", trim($result['stdout']));
                $summary = json_decode(end($lines), true, 512, JSON_THROW_ON_ERROR);
                self::assertSame($index === 1 ? 4 : 0, $summary['sources_inserted']);
                self::assertSame(1, $summary['next_after']);
                self::assertFalse($summary['simulation_activated']);
                self::assertSame($index === 0 ? 0 : 1, (int)$this->db->query(
                    'SELECT COUNT(*) FROM body_resource_profiles'
                )->fetchColumn());
            }
            $result = $this->runCaptureCli(['--apply', '--after=1', '--limit=1'], $environment);
            self::assertSame(0, $result['exit'], $result['stderr']);
            self::assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM body_resource_profiles')->fetchColumn());
        } finally {
            $this->db->exec("DROP USER '{$user}'@'%'");
        }
    }
}
