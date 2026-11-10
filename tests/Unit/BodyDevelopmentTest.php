<?php

declare(strict_types=1);

use GalaxyQuest\Terrain\BodyDevelopment;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/BodyDevelopment.php';

final class BodyDevelopmentTest extends TestCase
{
    private PDO $db;
    private array $colony = ['id' => 7, 'body_id' => 12, 'population' => 40000];

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA foreign_keys=ON;
            CREATE TABLE celestial_bodies (id INTEGER PRIMARY KEY);
            CREATE TABLE colonies (id INTEGER PRIMARY KEY, body_id INTEGER, user_id INTEGER);
            CREATE TABLE buildings (colony_id INTEGER, level INTEGER);
            CREATE TABLE body_development (
                body_id INTEGER PRIMARY KEY REFERENCES celestial_bodies(id) ON DELETE CASCADE,
                version INTEGER NOT NULL, peak_population INTEGER NOT NULL, founded_count INTEGER NOT NULL,
                initialized_at INTEGER NOT NULL, observed_at INTEGER NOT NULL);
            INSERT INTO celestial_bodies VALUES (12);
            INSERT INTO colonies VALUES (7,12,1)');
    }

    private function observe(array $colony, int $peak, int $now): ?array
    {
        $this->db->beginTransaction();
        try {
            $result = BodyDevelopment::observe($this->db, $colony, $peak, $now);
            $this->db->commit();
            return $result;
        } catch (Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    public function testThresholdsMatchTheBoundedClientPrefix(): void
    {
        foreach ([0 => 0, 1 => 1, 1999 => 1, 2000 => 2, 4000 => 3, 40000 => 6, 4096000 => 12] as $pop => $count) {
            self::assertSame($count, BodyDevelopment::settlementCount($pop, false));
        }
        self::assertSame(1, BodyDevelopment::settlementCount(0, true));
        self::assertSame(12, BodyDevelopment::settlementCount(PHP_INT_MAX, true));
    }

    public function testCurrentStateInitializesWithoutInventingEarlierDatesAndKeepsMilestonesOnDecline(): void
    {
        $first = $this->observe($this->colony, 40000, 1000);
        self::assertSame([
            'body_id' => 12, 'version' => 1, 'peak_population' => 40000,
            'founded_count' => 6, 'initialized_at' => 1000, 'observed_at' => 1000,
        ], $first);
        $small = [...$this->colony, 'population' => 100];
        self::assertSame($first, $this->observe($small, 100, 2000));
        $grown = $this->observe($this->colony, 1000000, 3000);
        self::assertSame(10, $grown['founded_count']);
        self::assertSame(1000000, $grown['peak_population']);
        self::assertSame(1000, $grown['initialized_at']);
        self::assertSame(3000, $grown['observed_at']);
    }

    public function testSurvivesConquestColonyDeletionAndRecolonizationButNotBodyDeletion(): void
    {
        $saved = $this->observe($this->colony, 40000, 1000);
        $this->db->exec('UPDATE colonies SET user_id=2 WHERE id=7');
        self::assertSame($saved, $this->observe($this->colony, 100, 2000));
        $this->db->exec('DELETE FROM colonies WHERE id=7; INSERT INTO colonies VALUES (8,12,3)');
        $new = ['id' => 8, 'body_id' => 12, 'population' => 10];
        self::assertSame($saved, $this->observe($new, 10, 3000));
        $this->db->exec('DELETE FROM celestial_bodies WHERE id=12');
        self::assertNull(BodyDevelopment::read($this->db, 12));
    }

    public function testUnchangedObservationsAndEmptyBodiesDoNotWrite(): void
    {
        $empty = [...$this->colony, 'population' => 0];
        self::assertNull($this->observe($empty, 0, 1000));
        $this->db->exec('INSERT INTO buildings VALUES (7,1)');
        $saved = $this->observe($empty, 0, 1000);
        self::assertSame(1, $saved['founded_count']);
        $writes = $this->db->query('SELECT total_changes()')->fetchColumn();
        self::assertSame($saved, $this->observe($empty, 0, 2000));
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
    }

    public function testRollsBackWithTheOwningEconomyTransaction(): void
    {
        $this->db->beginTransaction();
        BodyDevelopment::observe($this->db, $this->colony, 40000, 1000);
        $this->db->rollBack();
        self::assertNull(BodyDevelopment::read($this->db, 12));
        $this->expectException(LogicException::class);
        BodyDevelopment::observe($this->db, $this->colony, 40000, 1000);
    }

    public function testRejectsCorruptPersistentVersion(): void
    {
        $this->observe($this->colony, 40000, 1000);
        $this->db->exec('UPDATE body_development SET version=999');
        $this->expectException(UnexpectedValueException::class);
        $this->observe($this->colony, 40000, 2000);
    }

    public function testMigrationIsAppendOnlyAndHistoryHasNoOwnerOrColonyForeignKey(): void
    {
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        self::assertSame('migrate_body_development_v1.sql', end($manifest));
        $sql = file_get_contents(__DIR__ . '/../../sql/migrate_body_development_v1.sql');
        self::assertStringContainsString('REFERENCES celestial_bodies(id) ON DELETE CASCADE', $sql);
        self::assertStringNotContainsString('REFERENCES colonies', $sql);
        self::assertStringNotContainsString('user_id', $sql);
    }
}
