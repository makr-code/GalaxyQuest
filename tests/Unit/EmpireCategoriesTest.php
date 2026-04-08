<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../scripts/project_user_overview.php';

/**
 * Unit tests for the empire-category score functions defined in
 * scripts/project_user_overview.php.
 *
 * All tests use an SQLite in-memory database so no live MySQL is needed.
 */
final class EmpireCategoriesTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->bootstrapSchema();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Schema helpers
    // ──────────────────────────────────────────────────────────────────────────

    private function bootstrapSchema(): void
    {
        $this->db->exec('
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                colony_type TEXT DEFAULT "balanced",
                metal REAL DEFAULT 0,
                crystal REAL DEFAULT 0,
                deuterium REAL DEFAULT 0,
                population INTEGER DEFAULT 0,
                energy_balance INTEGER DEFAULT 0
            );
            CREATE TABLE fleets (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                ships_json TEXT DEFAULT "{}",
                "returning" INTEGER DEFAULT 0
            );
            CREATE TABLE diplomacy (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                standing INTEGER DEFAULT 0
            );
            CREATE TABLE espionage_agents (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                name TEXT DEFAULT "Agent",
                skill_level INTEGER DEFAULT 1,
                specialization TEXT DEFAULT "general",
                status TEXT DEFAULT "idle"
            );
            CREATE TABLE empire_category_scores (
                user_id INTEGER PRIMARY KEY,
                score_economy INTEGER,
                score_military INTEGER,
                score_research INTEGER,
                score_growth INTEGER,
                score_stability INTEGER,
                score_diplomacy INTEGER,
                score_espionage INTEGER,
                total_score INTEGER,
                calculated_at TEXT
            );
        ');
    }

    private function insertColony(int $userId, array $data = []): void
    {
        $this->db->prepare(
            'INSERT INTO colonies (user_id, colony_type, metal, crystal, deuterium, population, energy_balance)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $userId,
            $data['colony_type']   ?? 'balanced',
            $data['metal']         ?? 0,
            $data['crystal']       ?? 0,
            $data['deuterium']     ?? 0,
            $data['population']    ?? 0,
            $data['energy_balance'] ?? 0,
        ]);
    }

    private function insertFleet(int $userId, array $ships, bool $returning = false): void
    {
        $this->db->prepare(
            'INSERT INTO fleets (user_id, ships_json, "returning") VALUES (?, ?, ?)'
        )->execute([$userId, json_encode($ships), $returning ? 1 : 0]);
    }

    private function insertDiplomacy(int $userId, int $standing): void
    {
        $this->db->prepare('INSERT INTO diplomacy (user_id, standing) VALUES (?, ?)')->execute([$userId, $standing]);
    }

    private function insertAgent(int $userId, int $skill, string $status = 'idle'): void
    {
        $this->db->prepare(
            'INSERT INTO espionage_agents (user_id, skill_level, status) VALUES (?, ?, ?)'
        )->execute([$userId, $skill, $status]);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // clamp_score
    // ──────────────────────────────────────────────────────────────────────────

    public function testClampScoreReturnsZeroForNegative(): void
    {
        $this->assertSame(0, clamp_score(-50.0));
    }

    public function testClampScoreReturnsCentForOver100(): void
    {
        $this->assertSame(100, clamp_score(150.0));
    }

    public function testClampScoreRoundsCorrectly(): void
    {
        $this->assertSame(55, clamp_score(54.6));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calc_economy_score
    // ──────────────────────────────────────────────────────────────────────────

    public function testEconomyScoreZeroWithNoColonies(): void
    {
        $score = calc_economy_score($this->db, 1);
        $this->assertSame(0, $score);
    }

    public function testEconomyScoreClampedTo100(): void
    {
        // 20 000 resources / 200 = 100 → clamped at 100
        $this->insertColony(2, ['metal' => 10000, 'crystal' => 5000, 'deuterium' => 5000]);
        $score = calc_economy_score($this->db, 2);
        $this->assertSame(100, $score);
    }

    public function testEconomyScorePartial(): void
    {
        // 2000 resources / 200 = 10
        $this->insertColony(3, ['metal' => 1000, 'crystal' => 600, 'deuterium' => 400]);
        $score = calc_economy_score($this->db, 3);
        $this->assertSame(10, $score);
    }

    public function testEconomyScoreIsInRange(): void
    {
        $this->insertColony(10, ['metal' => 500, 'crystal' => 300, 'deuterium' => 200]);
        $score = calc_economy_score($this->db, 10);
        $this->assertGreaterThanOrEqual(0, $score);
        $this->assertLessThanOrEqual(100, $score);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calc_military_score
    // ──────────────────────────────────────────────────────────────────────────

    public function testMilitaryScoreZeroWithNoFleets(): void
    {
        $score = calc_military_score($this->db, 1);
        $this->assertSame(0, $score);
    }

    public function testMilitaryScoreCountsNonReturningFleets(): void
    {
        $this->insertFleet(4, ['fighter' => 100, 'cruiser' => 50]);   // 150 ships → 15
        $score = calc_military_score($this->db, 4);
        $this->assertSame(15, $score);
    }

    public function testMilitaryScoreIgnoresReturningFleets(): void
    {
        $this->insertFleet(5, ['fighter' => 1000], true);  // returning — ignored
        $score = calc_military_score($this->db, 5);
        $this->assertSame(0, $score);
    }

    public function testMilitaryScoreClampedTo100(): void
    {
        $this->insertFleet(6, ['fighter' => 2000]);  // 2000 / 10 = 200 → clamped 100
        $score = calc_military_score($this->db, 6);
        $this->assertSame(100, $score);
    }

    public function testMilitaryScoreIsInRange(): void
    {
        $this->insertFleet(11, ['scout' => 50]);
        $score = calc_military_score($this->db, 11);
        $this->assertGreaterThanOrEqual(0, $score);
        $this->assertLessThanOrEqual(100, $score);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calc_espionage_score
    // ──────────────────────────────────────────────────────────────────────────

    public function testEspionageScoreZeroWithNoAgents(): void
    {
        $score = calc_espionage_score($this->db, 1);
        $this->assertSame(0, $score);
    }

    public function testEspionageScoreCalculatedCorrectly(): void
    {
        // 5 agents, avg skill 4 → 5 * 4 = 20
        for ($i = 0; $i < 5; $i++) {
            $this->insertAgent(7, 4);
        }
        $score = calc_espionage_score($this->db, 7);
        $this->assertSame(20, $score);
    }

    public function testEspionageScoreIgnoresRetiredAgents(): void
    {
        $this->insertAgent(8, 10, 'retired');
        $score = calc_espionage_score($this->db, 8);
        $this->assertSame(0, $score);
    }

    public function testEspionageScoreClampedTo100(): void
    {
        // 20 agents at skill 10 = 200 → clamped to 100
        for ($i = 0; $i < 20; $i++) {
            $this->insertAgent(9, 10);
        }
        $score = calc_espionage_score($this->db, 9);
        $this->assertSame(100, $score);
    }

    public function testEspionageScoreIsInRange(): void
    {
        $this->insertAgent(12, 5);
        $score = calc_espionage_score($this->db, 12);
        $this->assertGreaterThanOrEqual(0, $score);
        $this->assertLessThanOrEqual(100, $score);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calc_and_store_empire_scores — PDO upsert (mock PDO for MySQL-specific SQL)
    // ──────────────────────────────────────────────────────────────────────────

    private function makeMockPdo(int $uid): PDO
    {
        // Use a real SQLite DB for the score reads, but mock prepare() for the upsert
        $realDb = new PDO('sqlite::memory:');
        $realDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $realDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $realDb->exec('
            CREATE TABLE colonies (id INTEGER PRIMARY KEY, user_id INTEGER,
                colony_type TEXT DEFAULT "balanced", metal REAL DEFAULT 0,
                crystal REAL DEFAULT 0, deuterium REAL DEFAULT 0,
                population INTEGER DEFAULT 0, energy_balance INTEGER DEFAULT 0);
            CREATE TABLE fleets (id INTEGER PRIMARY KEY, user_id INTEGER,
                ships_json TEXT DEFAULT "{}", "returning" INTEGER DEFAULT 0);
            CREATE TABLE diplomacy (id INTEGER PRIMARY KEY, user_id INTEGER, standing INTEGER DEFAULT 0);
            CREATE TABLE espionage_agents (id INTEGER PRIMARY KEY, user_id INTEGER,
                skill_level INTEGER DEFAULT 1, status TEXT DEFAULT "idle");
        ');

        $mockStmt = $this->createMock(\PDOStatement::class);
        $mockStmt->method('execute')->willReturn(true);

        $mock = $this->getMockBuilder(PDO::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['prepare', 'query'])
            ->getMock();

        // Delegate real SELECT queries to the SQLite DB
        $mock->method('prepare')->willReturnCallback(function (string $sql) use ($realDb, $mockStmt) {
            if (stripos($sql, 'INSERT') !== false) {
                return $mockStmt;
            }
            return $realDb->prepare($sql);
        });

        return $mock;
    }

    public function testCalcAndStoreReturnsAllKeys(): void
    {
        $mock = $this->makeMockPdo(20);
        $result = calc_and_store_empire_scores($mock, 20);
        foreach (['economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage', 'total'] as $key) {
            $this->assertArrayHasKey($key, $result);
        }
    }

    public function testCalcAndStoreCallsPrepareAndExecute(): void
    {
        $mockStmt = $this->createMock(\PDOStatement::class);
        $mockStmt->expects($this->once())->method('execute')->willReturn(true);

        $realDb = new PDO('sqlite::memory:');
        $realDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $realDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $realDb->exec('
            CREATE TABLE colonies (id INTEGER PRIMARY KEY, user_id INTEGER,
                colony_type TEXT DEFAULT "balanced", metal REAL DEFAULT 0,
                crystal REAL DEFAULT 0, deuterium REAL DEFAULT 0,
                population INTEGER DEFAULT 0, energy_balance INTEGER DEFAULT 0);
            CREATE TABLE fleets (id INTEGER PRIMARY KEY, user_id INTEGER,
                ships_json TEXT DEFAULT "{}", "returning" INTEGER DEFAULT 0);
            CREATE TABLE diplomacy (id INTEGER PRIMARY KEY, user_id INTEGER, standing INTEGER DEFAULT 0);
            CREATE TABLE espionage_agents (id INTEGER PRIMARY KEY, user_id INTEGER,
                skill_level INTEGER DEFAULT 1, status TEXT DEFAULT "idle");
        ');

        $mock = $this->getMockBuilder(PDO::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['prepare'])
            ->getMock();

        $mock->method('prepare')->willReturnCallback(function (string $sql) use ($realDb, $mockStmt) {
            if (stripos($sql, 'INSERT') !== false) {
                return $mockStmt;
            }
            return $realDb->prepare($sql);
        });

        calc_and_store_empire_scores($mock, 21);
    }

    public function testCalcAndStoreReturnsTotalAsSum(): void
    {
        $mock = $this->makeMockPdo(22);
        $result = calc_and_store_empire_scores($mock, 22);
        $expectedTotal = $result['economy'] + $result['military'] + $result['research']
            + $result['growth'] + $result['stability'] + $result['diplomacy'] + $result['espionage'];
        $this->assertSame($expectedTotal, $result['total']);
    }

    public function testCalcAndStoreAllScoresAreInRange(): void
    {
        $mock = $this->makeMockPdo(23);
        $result = calc_and_store_empire_scores($mock, 23);
        foreach (['economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage'] as $key) {
            $this->assertGreaterThanOrEqual(0, $result[$key], "$key must be >= 0");
            $this->assertLessThanOrEqual(100, $result[$key], "$key must be <= 100");
        }
    }
}
