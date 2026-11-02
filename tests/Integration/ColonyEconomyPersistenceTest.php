<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/economy_runtime.php';

final class ColonyEconomyPersistenceTest extends TestCase
{
    private PDO $db;
    private string $database = '';
    private int $start;

    protected function setUp(): void
    {
        $dsn = getenv('GQ_BODY_RESOURCE_TEST_DSN');
        if ($dsn) {
            $this->db = new PDO($dsn, getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root', getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '', [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $this->database = 'gq_colony_tick_' . bin2hex(random_bytes(6));
            $this->db->exec('CREATE DATABASE `' . $this->database . '`');
            $this->db->exec('USE `' . $this->database . '`');
        } else {
            $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $this->db->exec('PRAGMA foreign_keys = ON');
        }
        $this->db->exec(
            'CREATE TABLE planets (
                id INT PRIMARY KEY, temp_max INT DEFAULT 20,
                richness_metal DOUBLE DEFAULT 1, richness_crystal DOUBLE DEFAULT 1,
                richness_deuterium DOUBLE DEFAULT 1, richness_rare_earth DOUBLE DEFAULT 0.5,
                deposit_metal BIGINT NOT NULL DEFAULT 5000000, deposit_crystal BIGINT NOT NULL DEFAULT 2000000,
                deposit_deuterium BIGINT NOT NULL DEFAULT 1000000, deposit_rare_earth BIGINT NOT NULL DEFAULT 200000
            )'
        );
        $this->db->exec(
            'CREATE TABLE celestial_bodies (
                id BIGINT UNSIGNED PRIMARY KEY, galaxy_index INT DEFAULT 1, system_index INT DEFAULT 1, position INT DEFAULT 1
            )'
        );
        $this->db->exec(
            'CREATE TABLE colonies (
                id INT PRIMARY KEY, planet_id INT, body_id BIGINT UNSIGNED, user_id INT DEFAULT 0,
                name VARCHAR(64) DEFAULT \'Test\', colony_type VARCHAR(32) DEFAULT \'balanced\',
                metal DECIMAL(20,4) DEFAULT 0, crystal DECIMAL(20,4) DEFAULT 0,
                deuterium DECIMAL(20,4) DEFAULT 0, rare_earth DECIMAL(20,4) DEFAULT 0,
                food DECIMAL(20,4) DEFAULT 200, population INT DEFAULT 100, max_population INT DEFAULT 500,
                happiness INT DEFAULT 70, public_services INT DEFAULT 0, energy INT DEFAULT 0, last_update DATETIME NOT NULL
            )'
        );
        $this->db->exec('CREATE TABLE buildings (colony_id INT, type VARCHAR(64), level INT, UNIQUE (colony_id, type))');
        $this->db->exec('CREATE TABLE research (user_id INT, type VARCHAR(64), level INT)');
        $this->db->exec('CREATE TABLE colony_events (colony_id INT, event_type VARCHAR(64), expires_at DATETIME)');
        $this->db->exec('CREATE TABLE ships (colony_id INT, type VARCHAR(64), count INT)');
        $this->db->exec(
            'CREATE TABLE leaders (colony_id INT, role VARCHAR(64), autonomy INT, skill_production INT)'
        );
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY, dark_matter INT DEFAULT 0)');
        $migration = file_get_contents(__DIR__ . '/../../sql/migrate_colony_economy_precision_v1.sql');
        if (!$dsn) {
            $migration = substr($migration, strpos($migration, 'CREATE TABLE'));
            $migration = str_replace('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4', '', $migration);
        }
        $this->db->exec($migration);
        $this->db->exec($migration);
        $this->start = (int)strtotime('2026-01-01 00:00:00');
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

    private function seed(int $id = 1): void
    {
        $this->db->prepare('INSERT INTO planets (id) VALUES (?)')->execute([$id]);
        $this->db->prepare('INSERT INTO celestial_bodies (id) VALUES (?)')->execute([$id]);
        $this->db->prepare('INSERT INTO colonies (id, planet_id, body_id, last_update) VALUES (?, ?, ?, ?)')
            ->execute([$id, $id, $id, date('Y-m-d H:i:s', $this->start)]);
        $insert = $this->db->prepare('INSERT INTO buildings (colony_id, type, level) VALUES (?, ?, ?)');
        foreach (['metal_mine' => 1, 'crystal_mine' => 1, 'deuterium_synth' => 1,
            'rare_earth_drill' => 1, 'solar_plant' => 10, 'hydroponic_farm' => 2, 'hospital' => 1] as $type => $level) {
            $insert->execute([$id, $type, $level]);
        }
    }

    private function state(int $id): array
    {
        $query = $this->db->prepare(
            'SELECT c.metal, c.crystal, c.deuterium, c.rare_earth, c.food, c.population, c.happiness,
                    c.max_population, c.last_update, p.deposit_metal, p.deposit_crystal,
                    p.deposit_deuterium, p.deposit_rare_earth, e.population_remainder, e.dark_matter_remainder,
                    e.stock_remainders_json
             FROM colonies c JOIN planets p ON p.id = c.planet_id
             LEFT JOIN colony_economy_precision e ON e.colony_id = c.id WHERE c.id = ?'
        );
        $query->execute([$id]);
        return $query->fetch(PDO::FETCH_ASSOC);
    }

    public function testOfflineAndMinuteRequestsProduceExactlyTheSameState(): void
    {
        $this->seed(1);
        $this->seed(2);
        update_colony_resources($this->db, 1, $this->start + 12 * 3600);
        for ($minute = 1; $minute <= 720; $minute++) {
            update_colony_resources($this->db, 2, $this->start + $minute * 60);
        }
        self::assertSame($this->state(1), $this->state(2));
        self::assertGreaterThan(100, (int)$this->state(1)['population']);
        self::assertFalse($this->db->inTransaction());
    }

    public function testFiniteExtractionIsConservedAfterAllBonusesAndFullStorageDoesNotWasteDeposits(): void
    {
        $this->seed();
        $this->db->exec("UPDATE colonies SET colony_type = 'mining', crystal = 20000");
        $this->db->exec('UPDATE planets SET deposit_metal = 0, deposit_crystal = 12, deposit_deuterium = -1');
        $this->db->exec("INSERT INTO leaders VALUES (1, 'colony_manager', 1, 10)");
        update_colony_resources($this->db, 1, $this->start + 3600);
        $state = $this->state(1);
        self::assertSame(0.0, (float)$state['metal']);
        self::assertSame(20000.0, (float)$state['crystal']);
        self::assertSame(12.0, (float)$state['deposit_crystal']);
        self::assertSame(-1.0, (float)$state['deposit_deuterium']);
        self::assertGreaterThan(0, (float)$state['deuterium']);
        self::assertEqualsWithDelta(200000, (float)$state['rare_earth'] + (float)$state['deposit_rare_earth'], 1e-6);
    }

    public function testMinuteExtractionKeepsFractionalDepositAndCapsNearExhaustion(): void
    {
        $this->seed();
        $this->db->exec('UPDATE planets SET deposit_metal = 1.25');
        update_colony_resources($this->db, 1, $this->start + 3600);
        $state = $this->state(1);
        self::assertSame(1.25, (float)$state['metal']);
        self::assertSame(0.0, (float)$state['deposit_metal']);
        $before = $state;
        update_colony_resources($this->db, 1, $this->start + 3600);
        self::assertSame($before, $this->state(1));
    }

    public function testStoredFoodProtectsPopulationThenActualShortageCausesDecline(): void
    {
        $this->seed();
        $this->db->exec("UPDATE buildings SET level = 0 WHERE type = 'hydroponic_farm'");
        update_colony_resources($this->db, 1, $this->start + 3600);
        self::assertSame(100, (int)$this->state(1)['population']);
        self::assertEqualsWithDelta(199, (float)$this->state(1)['food'], 0.003);
        $this->db->exec('UPDATE colonies SET food = 0');
        update_colony_resources($this->db, 1, $this->start + 4 * 3600);
        self::assertLessThan(100, (int)$this->state(1)['population']);
        self::assertSame(0.0, (float)$this->state(1)['food']);
    }

    public function testSubMinuteRequestsAdvanceImmediatelyAndHousingDoesNotCullPeople(): void
    {
        $this->seed();
        $this->db->exec('UPDATE colonies SET population = 800, food = 500');
        $this->db->exec("UPDATE buildings SET level = 0 WHERE type = 'hydroponic_farm'");
        update_colony_resources($this->db, 1, $this->start + 1);
        $afterOneSecond = $this->state(1);
        self::assertSame(date('Y-m-d H:i:s', $this->start + 1), $afterOneSecond['last_update']);
        self::assertGreaterThan(0.0, (float)$afterOneSecond['metal']);
        self::assertLessThan(500.0, (float)$afterOneSecond['food']);
        update_colony_resources($this->db, 1, $this->start + 61);
        self::assertSame(800, (int)$this->state(1)['population']);
        self::assertSame(date('Y-m-d H:i:s', $this->start + 61), $this->state(1)['last_update']);
    }

    public function testLongOfflineTimeIsFullySettledByOneRequest(): void
    {
        $this->seed();
        update_colony_resources($this->db, 1, $this->start + 8 * 86400);
        self::assertSame(date('Y-m-d H:i:s', $this->start + 8 * 86400), $this->state(1)['last_update']);
    }

    public function testFrequentSecondRequestsDoNotLoseFoodOrMineralFractions(): void
    {
        $this->seed(1);
        $this->seed(2);
        $this->db->exec('UPDATE colonies SET happiness = 80');
        $this->db->exec("UPDATE buildings SET level = 0 WHERE type = 'hydroponic_farm'");
        update_colony_resources($this->db, 1, $this->start + 3600);
        for ($second = 1; $second <= 3600; $second++) {
            update_colony_resources($this->db, 2, $this->start + $second);
        }
        $offline = $this->state(1);
        $frequent = $this->state(2);
        foreach (['metal', 'crystal', 'deuterium', 'rare_earth', 'food', 'population_remainder'] as $field) {
            self::assertEqualsWithDelta((float)$offline[$field], (float)$frequent[$field], 0.00011, $field);
        }
        self::assertSame($offline['population'], $frequent['population']);
        self::assertEqualsWithDelta(199, (float)$frequent['food'], 0.0001);
    }

    public function testDarkMatterFractionsSurviveFrequentRequests(): void
    {
        $this->seed();
        $this->db->exec('INSERT INTO users (id) VALUES (1)');
        $this->db->exec('UPDATE colonies SET user_id = 1');
        $this->db->exec("INSERT INTO buildings VALUES (1, 'fusion_reactor', 1)");
        $this->db->exec("INSERT INTO research VALUES (1, 'dark_energy_tap', 1)");
        $snapshot = build_colony_consumption_snapshot($this->db, fetch_colony_runtime_row($this->db, 1));
        for ($request = 1; $request <= 60; $request++) {
            update_colony_resources($this->db, 1, $this->start + $request * 60);
        }
        $dark = (float)$this->db->query('SELECT dark_matter FROM users WHERE id = 1')->fetchColumn();
        $remainder = (float)$this->state(1)['dark_matter_remainder'];
        self::assertEqualsWithDelta($snapshot['dark_matter_per_hour'], $dark + $remainder, 1e-6);
    }

    public function testReadOnlySnapshotDoesNotAdvanceTimeOrInventStock(): void
    {
        $this->seed();
        $before = $this->state(1);
        $snapshot = build_colony_consumption_snapshot($this->db, fetch_colony_runtime_row($this->db, 1));
        self::assertSame($before, $this->state(1));
        self::assertSame(1.0, $snapshot['consumption']['food_per_hour']);
        self::assertGreaterThan(0, $snapshot['welfare']['population_growth_per_hour']);
    }

    public function testFailureRollsBackStockPopulationPrecisionAndClock(): void
    {
        $this->seed();
        $before = $this->state(1);
        if ($this->database !== '') {
            $this->db->exec(
                "CREATE TRIGGER reject_depletion BEFORE UPDATE ON planets FOR EACH ROW
                 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test depletion failure'"
            );
        } else {
            $this->db->exec(
                "CREATE TRIGGER reject_depletion BEFORE UPDATE ON planets
                 BEGIN SELECT RAISE(ABORT, 'Test depletion failure'); END"
            );
        }
        $this->db->beginTransaction();
        $this->db->exec('INSERT INTO users (id) VALUES (99)');
        try {
            update_colony_resources($this->db, 1, $this->start + 3600);
            self::fail('Depletion failure must propagate.');
        } catch (PDOException $error) {
            self::assertStringContainsString('Test depletion failure', $error->getMessage());
        }
        self::assertTrue($this->db->inTransaction());
        self::assertSame($before, $this->state(1));
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM users WHERE id = 99')->fetchColumn());
        $this->db->commit();
    }

    public function testSuccessfulUpdateDoesNotCommitCallerTransaction(): void
    {
        $this->seed();
        $before = $this->state(1);
        $this->db->beginTransaction();
        update_colony_resources($this->db, 1, $this->start + 3600);
        self::assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        self::assertSame($before, $this->state(1));
    }

    public function testOwnTransactionAlsoRollsBackOnFailure(): void
    {
        $this->seed();
        $before = $this->state(1);
        $this->db->exec('DROP TABLE colony_economy_precision');
        try {
            update_colony_resources($this->db, 1, $this->start + 3600);
            self::fail('Missing precision migration must be an explicit failure.');
        } catch (PDOException) {
            self::assertFalse($this->db->inTransaction());
            $row = fetch_colony_runtime_row($this->db, 1);
            self::assertSame($before['last_update'], $row['last_update']);
            self::assertSame((float)$before['metal'], (float)$row['metal']);
        }
    }

    public function testMySqlLockingReadDoesNotReuseAnOldRepeatableReadSnapshot(): void
    {
        if ($this->database === '') {
            self::markTestSkipped('Requires GQ_BODY_RESOURCE_TEST_DSN.');
        }
        $this->seed();
        $other = new PDO(
            (string)getenv('GQ_BODY_RESOURCE_TEST_DSN'),
            getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root',
            getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->beginTransaction();
        $other->query('SELECT * FROM colonies')->fetchAll();
        $other->query('SELECT * FROM colony_economy_precision')->fetchAll();
        update_colony_resources($this->db, 1, $this->start + 3600);
        $before = $this->state(1);
        try {
            update_colony_resources($other, 1, $this->start + 3600);
            $other->commit();
        } finally {
            if ($other->inTransaction()) {
                $other->rollBack();
            }
        }
        self::assertSame($before, $this->state(1));
    }

    public function testConcurrentOnDemandRequestsSettleTheIntervalOnlyOnce(): void
    {
        if ($this->database === '') {
            self::markTestSkipped('Requires GQ_BODY_RESOURCE_TEST_DSN.');
        }
        $this->seed();
        $this->db->beginTransaction();
        $this->db->query('SELECT id FROM colonies WHERE id = 1 FOR UPDATE')->fetchColumn();
        $code = <<<'PHP'
            require 'config/config.php';
            require 'api/economy_runtime.php';
            $db = new PDO(getenv('GQ_BODY_RESOURCE_TEST_DSN'), getenv('GQ_BODY_RESOURCE_TEST_USER') ?: 'root',
                getenv('GQ_BODY_RESOURCE_TEST_PASSWORD') ?: '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $db->exec('USE `' . getenv('GQ_ON_DEMAND_DATABASE') . '`');
            fwrite(STDOUT, "ready\n");
            update_colony_resources($db, 1, (int)getenv('GQ_ON_DEMAND_NOW'));
            fwrite(STDOUT, "done\n");
            PHP;
        $process = proc_open([PHP_BINARY, '-r', $code],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, __DIR__ . '/../..',
            array_replace(getenv(), [
                'GQ_ON_DEMAND_DATABASE' => $this->database,
                'GQ_ON_DEMAND_NOW' => (string)($this->start + 3600),
            ])
        );
        self::assertIsResource($process);
        fclose($pipes[0]);
        try {
            self::assertSame("ready\n", fgets($pipes[1]));
            update_colony_resources($this->db, 1, $this->start + 3600);
            $before = $this->state(1);
            self::assertTrue(proc_get_status($process)['running']);
            $this->db->commit();
        } finally {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $output = stream_get_contents($pipes[1]);
            $errors = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $status = proc_close($process);
        }
        self::assertSame(0, $status, $errors);
        self::assertSame("done\n", $output);
        self::assertSame($before, $this->state(1));
    }

    public function testGalaxyCatalogRefreshDoesNotReplenishLegacyDeposits(): void
    {
        if ($this->database === '') {
            self::markTestSkipped('Requires GQ_BODY_RESOURCE_TEST_DSN.');
        }
        // This random, isolated database has no gameplay data in this test.
        foreach (['colony_economy_precision', 'buildings', 'colonies', 'planets', 'celestial_bodies',
            'research', 'colony_events', 'ships', 'leaders', 'users'] as $table) {
            $this->db->exec('DROP TABLE `' . $table . '`');
        }
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

        upsert_generated_celestial_bodies($this->db, 1, 1234, $system['bodies']);
        $this->db->exec(
            "INSERT INTO users (username, email, password_hash) VALUES ('economy_test', 'economy@test.invalid', '')"
        );
        $user = (int)$this->db->lastInsertId();
        $planetId = (int)$this->db->query('SELECT id FROM planets WHERE position = 1')->fetchColumn();
        $bodyId = (int)$this->db->query(
            "SELECT id FROM celestial_bodies WHERE position = 1 AND body_type = 'planet'"
        )->fetchColumn();
        $this->db->prepare('INSERT INTO colonies (planet_id, body_id, user_id, last_update) VALUES (?, ?, ?, ?)')
            ->execute([$planetId, $bodyId, $user, date('Y-m-d H:i:s', $this->start)]);
        $colonyId = (int)$this->db->lastInsertId();
        update_colony_resources($this->db, $colonyId, $this->start + 1);
        self::assertSame(
            date('Y-m-d H:i:s', $this->start + 1),
            fetch_colony_runtime_row($this->db, $colonyId)['last_update']
        );
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_precision')->fetchColumn());
    }
}
