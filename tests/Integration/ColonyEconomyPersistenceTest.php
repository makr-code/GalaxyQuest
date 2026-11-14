<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/economy_runtime.php';

/**
 * Colony stock settlement is covered by OnDemandEconomyTest; this test keeps the
 * galaxy catalog guarantee that a refresh never replenishes persisted deposits.
 */
final class ColonyEconomyPersistenceTest extends TestCase
{
    private PDO $db;
    private string $database = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_BODY_RESOURCE_TEST_DSN');
        if (!$dsn) {
            self::markTestSkipped('Requires GQ_BODY_RESOURCE_TEST_DSN.');
        }
        $this->db = new PDO($dsn, getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root', getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $this->database = 'gq_colony_tick_' . bin2hex(random_bytes(6));
        $this->db->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db->exec('USE `' . $this->database . '`');
    }

    protected function tearDown(): void
    {
        if ($this->database !== '') {
            $this->db->exec('DROP DATABASE `' . $this->database . '`');
        }
    }

    public function testGalaxyCatalogRefreshDoesNotReplenishLegacyDeposits(): void
    {
        $schema = file_get_contents(__DIR__ . '/../../sql/schema.sql');
        // Keep the real tables/data, but not the installer's CREATE/USE galaxyquest preamble.
        $this->db->exec(substr($schema, strpos($schema, '-- Users')));
        self::assertSame($this->database, $this->db->query('SELECT DATABASE()')->fetchColumn());
        $system = generate_star_system(1, 1234);
        upsert_generated_planets($this->db, 1, 1234, 1, []);
        $this->db->exec(
            "INSERT INTO star_systems (id, galaxy_index, system_index, name) VALUES (1, 1, 1234, 'Test')"
        );
        upsert_generated_planets($this->db, 1, 1234, 1, $system['planets']);
        $this->db->exec(
            'UPDATE planets SET deposit_metal = 0, deposit_crystal = 12.3456,
             deposit_deuterium = -1, deposit_rare_earth = 0.000123 WHERE position = 1'
        );
        upsert_generated_planets($this->db, 1, 1234, 1, $system['planets']);
        $preserved = $this->db->query(
            'SELECT deposit_metal, deposit_crystal, deposit_deuterium, deposit_rare_earth
             FROM planets WHERE position = 1'
        )->fetch(PDO::FETCH_ASSOC);
        self::assertSame(0.0, (float)$preserved['deposit_metal']);
        self::assertSame(12.3456, (float)$preserved['deposit_crystal']);
        self::assertSame(-1.0, (float)$preserved['deposit_deuterium']);
        self::assertSame(0.000123, (float)$preserved['deposit_rare_earth']);
    }
}
