<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use PDO;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/MigrationRunner.php';

final class ResourceMutationApiConcurrencyTest extends TestCase
{
    private ?PDO $admin = null;
    private string $database = '';
    private string $sessionDirectory = '';
    private mixed $server = null;
    private array $serverPipes = [];
    private int $port = 0;
    private array $sessionIds = [];

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN to run MySQL API concurrency tests.');
        }
        if (PHP_OS_FAMILY === 'Windows') {
            self::markTestSkipped('Concurrent PHP built-in server workers require a POSIX test runtime.');
        }

        $this->admin = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        self::assertSame('mysql', $this->admin->getAttribute(PDO::ATTR_DRIVER_NAME));

        $this->database = 'gq_resource_api_race_' . bin2hex(random_bytes(6));
        $this->admin->exec('CREATE DATABASE `' . $this->database . '`');
        $this->admin->exec('USE `' . $this->database . '`');
        $this->createSchema();
        $this->seedMarket();
        $this->startApiServer();
    }

    protected function tearDown(): void
    {
        if (is_resource($this->server)) {
            proc_terminate($this->server);
            proc_close($this->server);
        }
        foreach ($this->serverPipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }
        if ($this->admin !== null && $this->admin->inTransaction()) {
            $this->admin->rollBack();
        }
        if ($this->admin !== null && $this->database !== '') {
            $this->admin->exec('DROP DATABASE IF EXISTS `' . $this->database . '`');
        }
        foreach ($this->sessionIds as $sessionId) {
            $sessionFile = $this->sessionDirectory . DIRECTORY_SEPARATOR . 'sess_' . $sessionId;
            if (is_file($sessionFile)) {
                unlink($sessionFile);
            }
        }
        if ($this->sessionDirectory !== '' && is_dir($this->sessionDirectory)) {
            rmdir($this->sessionDirectory);
        }
        $this->admin = null;
        $this->server = null;
    }

    public function testConcurrentResearchStartsAcrossColoniesOnlyCommitOnce(): void
    {
        $this->admin->beginTransaction();
        $this->admin->query('SELECT id FROM users WHERE id = 7 FOR UPDATE')->fetchColumn();
        $requests = [
            $this->startResearchRequest($this->sessionIds[0], 11),
            $this->startResearchRequest($this->sessionIds[1], 12),
        ];
        $this->assertApiRequestsWaitingForUserLock(2);
        $this->admin->commit();

        $responses = array_map(fn($socket): array => $this->readResponse($socket), $requests);
        $statuses = array_column($responses, 'status');
        sort($statuses);
        self::assertSame([200, 409], $statuses, json_encode($responses, JSON_THROW_ON_ERROR));
        self::assertSame(
            1,
            count(array_filter($responses, static fn(array $response): bool => $response['status'] === 200))
        );
        self::assertSame(
            1,
            count(array_filter($responses, static fn(array $response): bool => $response['status'] === 409))
        );

        $resourceBalances = $this->admin->query(
            'SELECT metal, crystal, deuterium FROM colonies WHERE id IN (11, 12) ORDER BY id'
        )->fetchAll(PDO::FETCH_NUM);
        $resourceBalances = array_map(
            static fn(array $row): array => array_map('floatval', $row),
            $resourceBalances
        );
        usort($resourceBalances, static fn(array $left, array $right): int => $left[1] <=> $right[1]);
        self::assertSame([[10000.0, 9200.0, 9600.0], [10000.0, 10000.0, 10000.0]], $resourceBalances);
        $research = $this->admin->query(
            "SELECT type, level, research_start, research_end FROM research "
            . "WHERE user_id = 7 AND type = 'energy_tech'"
        )->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($research);
        self::assertSame(0, (int)$research['level']);
        self::assertNotNull($research['research_start']);
        self::assertNotNull($research['research_end']);

        $active = (int)$this->admin->query(
            'SELECT COUNT(*) FROM research WHERE user_id = 7 AND research_end IS NOT NULL'
        )->fetchColumn();
        self::assertSame(1, $active);
    }

    public function testConcurrentBuildingUpgradesOnlyQueueAndChargeOnce(): void
    {
        // Enough metal for level 1 (60) but not for a second queued level (90).
        $this->admin->exec('UPDATE colonies SET metal = 100 WHERE id = 11');
        $this->admin->beginTransaction();
        $this->admin->query('SELECT id FROM users WHERE id = 7 FOR UPDATE')->fetchColumn();
        $requests = [
            $this->startBuildingUpgradeRequest($this->sessionIds[0], 11),
            $this->startBuildingUpgradeRequest($this->sessionIds[1], 11),
        ];
        $this->assertApiRequestsWaitingForUserLock(2);
        $this->admin->commit();

        $responses = array_map(fn($socket): array => $this->readResponse($socket), $requests);
        $statuses = array_column($responses, 'status');
        sort($statuses);
        self::assertSame([200, 409], $statuses, json_encode($responses, JSON_THROW_ON_ERROR));

        $balances = $this->admin->query(
            'SELECT metal, crystal, deuterium FROM colonies WHERE id = 11'
        )->fetch(PDO::FETCH_NUM);
        self::assertSame([40.0, 9985.0, 10000.0], array_map('floatval', $balances));
        $queue = $this->admin->query(
            "SELECT building_type, target_level, cost_metal, cost_crystal, cost_deuterium, status "
            . "FROM building_upgrade_queue WHERE colony_id = 11"
        )->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($queue);
        self::assertSame('metal_mine', $queue['building_type']);
        self::assertSame(1, (int)$queue['target_level']);
        self::assertSame(60, (int)$queue['cost_metal']);
        self::assertSame(15, (int)$queue['cost_crystal']);
        self::assertSame(0, (int)$queue['cost_deuterium']);
        self::assertSame('running', $queue['status']);
        self::assertSame(
            1,
            (int)$this->admin->query(
                "SELECT COUNT(*) FROM building_upgrade_queue "
                . "WHERE colony_id = 11 AND building_type = 'metal_mine' AND status IN ('queued', 'running')"
            )->fetchColumn()
        );
        self::assertNotFalse($this->admin->query(
            "SELECT upgrade_end FROM buildings WHERE colony_id = 11 AND type = 'metal_mine'"
        )->fetchColumn());
    }

    public function testConcurrentShipBuildsCannotReserveTheSameResourcesTwice(): void
    {
        $this->admin->exec('UPDATE colonies SET metal = 20000, crystal = 6000 WHERE id = 11');
        $this->admin->beginTransaction();
        $this->admin->query('SELECT id FROM users WHERE id = 7 FOR UPDATE')->fetchColumn();
        $requests = [
            $this->startShipBuildRequest($this->sessionIds[0], 11),
            $this->startShipBuildRequest($this->sessionIds[1], 11),
        ];
        $this->assertApiRequestsWaitingForUserLock(2);
        $this->admin->commit();

        $responses = array_map(fn($socket): array => $this->readResponse($socket), $requests);
        $statuses = array_column($responses, 'status');
        sort($statuses);
        self::assertSame([200, 409], $statuses, json_encode($responses, JSON_THROW_ON_ERROR));

        $balances = $this->admin->query(
            'SELECT metal, crystal, deuterium FROM colonies WHERE id = 11'
        )->fetch(PDO::FETCH_NUM);
        self::assertSame([8000.0, 2000.0, 10000.0], array_map('floatval', $balances));
        $queue = $this->admin->query(
            'SELECT ship_type, quantity, cost_metal, cost_crystal, cost_deuterium, status '
            . 'FROM ship_build_queue WHERE colony_id = 11'
        )->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($queue);
        self::assertSame('light_fighter', $queue['ship_type']);
        self::assertSame(4, (int)$queue['quantity']);
        self::assertSame(12000, (int)$queue['cost_metal']);
        self::assertSame(4000, (int)$queue['cost_crystal']);
        self::assertSame(0, (int)$queue['cost_deuterium']);
        self::assertSame('running', $queue['status']);
        self::assertSame(
            1,
            (int)$this->admin->query(
                "SELECT COUNT(*) FROM ship_build_queue WHERE colony_id = 11 AND status IN ('queued', 'running')"
            )->fetchColumn()
        );
    }

    public function testConcurrentFleetLaunchesCannotReserveTheSameShipTwice(): void
    {
        $this->admin->exec("INSERT INTO ships (colony_id, type, count) VALUES (11, 'small_cargo', 1)");
        $this->admin->beginTransaction();
        $this->admin->query('SELECT id FROM users WHERE id = 7 FOR UPDATE')->fetchColumn();
        $requests = [
            $this->startFleetSendRequest($this->sessionIds[0], 11),
            $this->startFleetSendRequest($this->sessionIds[1], 11),
        ];
        $this->assertApiRequestsWaitingForUserLock(2);
        $this->admin->commit();

        $responses = array_map(fn($socket): array => $this->readResponse($socket), $requests);
        $statuses = array_column($responses, 'status');
        sort($statuses);
        self::assertSame([200, 409], $statuses, json_encode($responses, JSON_THROW_ON_ERROR));

        self::assertSame(
            0,
            (int)$this->admin->query(
                "SELECT count FROM ships WHERE colony_id = 11 AND type = 'small_cargo'"
            )->fetchColumn()
        );
        self::assertSame(
            [9800.0, 10000.0, 10000.0],
            array_map(
                'floatval',
                $this->admin->query('SELECT metal, crystal, deuterium FROM colonies WHERE id = 11')
                    ->fetch(PDO::FETCH_NUM)
            )
        );
        self::assertSame(1, (int)$this->admin->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        $fleet = $this->admin->query(
            'SELECT mission, ships_json, cargo_metal, cargo_crystal, cargo_deuterium '
            . 'FROM fleets WHERE user_id = 7 AND origin_colony_id = 11'
        )->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($fleet);
        self::assertSame('transport', $fleet['mission']);
        self::assertSame(['small_cargo' => 1], json_decode($fleet['ships_json'], true, flags: JSON_THROW_ON_ERROR));
        self::assertSame(200.0, (float)$fleet['cargo_metal']);
        self::assertSame(0.0, (float)$fleet['cargo_crystal']);
        self::assertSame(0.0, (float)$fleet['cargo_deuterium']);
    }

    public function testConcurrentTradeDispatchesLaunchOnlyOneFleetForDueRoute(): void
    {
        $this->admin->exec(
            "INSERT INTO trade_routes "
            . "(user_id, origin_colony_id, target_colony_id, cargo_metal, cargo_payload, interval_hours) "
            . "VALUES (7, 11, 12, 200, '{\"metal\":200}', 24)"
        );
        $this->admin->beginTransaction();
        $this->admin->query('SELECT id FROM users WHERE id = 7 FOR UPDATE')->fetchColumn();
        $requests = [
            $this->startTradeDispatchRequest($this->sessionIds[0]),
            $this->startTradeDispatchRequest($this->sessionIds[1]),
        ];
        $this->assertApiRequestsWaitingForUserLock(2);
        $this->admin->commit();

        $responses = array_map(fn($socket): array => $this->readResponse($socket), $requests);
        foreach ($responses as $response) {
            self::assertSame(200, $response['status'], json_encode($responses, JSON_THROW_ON_ERROR));
            self::assertTrue($response['payload']['success']);
        }

        $totals = ['dispatched_routes' => 0, 'skipped_routes' => 0, 'failed_routes' => 0];
        foreach ($responses as $response) {
            foreach ($totals as $key => $_) {
                $totals[$key] += (int)$response['payload'][$key];
            }
        }
        self::assertSame(
            ['dispatched_routes' => 1, 'skipped_routes' => 1, 'failed_routes' => 0],
            $totals,
            'API server log: ' . stream_get_contents($this->serverPipes[2])
        );
        self::assertSame(1, (int)$this->admin->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(
            [9800.0, 10000.0, 9995.0],
            array_map(
                'floatval',
                $this->admin->query('SELECT metal, crystal, deuterium FROM colonies WHERE id = 11')
                    ->fetch(PDO::FETCH_NUM)
            )
        );
        self::assertSame(
            1,
            (int)$this->admin->query(
                "SELECT count FROM ships WHERE colony_id = 11 AND type = 'large_cargo'"
            )->fetchColumn()
        );
        $fleet = $this->admin->query(
            'SELECT mission, ships_json, cargo_metal, cargo_payload FROM fleets WHERE user_id = 7'
        )->fetch(PDO::FETCH_ASSOC);
        self::assertIsArray($fleet);
        self::assertSame('transport', $fleet['mission']);
        self::assertSame(['large_cargo' => 1], json_decode($fleet['ships_json'], true, flags: JSON_THROW_ON_ERROR));
        self::assertSame(200.0, (float)$fleet['cargo_metal']);
        self::assertSame(['metal' => 200], json_decode($fleet['cargo_payload'], true, flags: JSON_THROW_ON_ERROR));
        self::assertNotFalse($this->admin->query('SELECT last_dispatch FROM trade_routes WHERE id = 1')->fetchColumn());
    }

    private function createSchema(): void
    {
        $this->admin->exec(<<<'SQL'
            CREATE TABLE users (
                id INT PRIMARY KEY,
                credits DECIMAL(20,2) NOT NULL,
                ftl_drive_type VARCHAR(32) NOT NULL DEFAULT 'aereth',
                ftl_cooldown_until DATETIME NULL
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE colonies (
                id INT PRIMARY KEY,
                user_id INT NOT NULL,
                body_id BIGINT UNSIGNED NOT NULL,
                planet_id INT NULL,
                name VARCHAR(64) NOT NULL DEFAULT 'Test',
                last_update DATETIME NOT NULL,
                colony_type VARCHAR(32) NOT NULL DEFAULT 'balanced',
                population INT NOT NULL DEFAULT 0,
                max_population INT NOT NULL DEFAULT 1000,
                happiness INT NOT NULL DEFAULT 70,
                public_services INT NOT NULL DEFAULT 0,
                energy INT NOT NULL DEFAULT 0,
                metal DECIMAL(20,4) NOT NULL DEFAULT 10000,
                crystal DECIMAL(20,4) NOT NULL DEFAULT 10000,
                deuterium DECIMAL(20,4) NOT NULL DEFAULT 10000,
                rare_earth DECIMAL(20,4) NOT NULL DEFAULT 10000,
                food DECIMAL(20,4) NOT NULL DEFAULT 10000
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE celestial_bodies (
                id BIGINT UNSIGNED PRIMARY KEY,
                galaxy_index INT NOT NULL,
                system_index INT NOT NULL,
                position INT NOT NULL DEFAULT 1
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE planets (
                id INT PRIMARY KEY,
                temp_max INT NOT NULL DEFAULT 20,
                richness_metal DECIMAL(8,4) NOT NULL DEFAULT 1,
                richness_crystal DECIMAL(8,4) NOT NULL DEFAULT 1,
                richness_deuterium DECIMAL(8,4) NOT NULL DEFAULT 1,
                richness_rare_earth DECIMAL(8,4) NOT NULL DEFAULT 1,
                deposit_metal BIGINT NOT NULL DEFAULT 1000000,
                deposit_crystal BIGINT NOT NULL DEFAULT 1000000,
                deposit_deuterium BIGINT NOT NULL DEFAULT 1000000,
                deposit_rare_earth BIGINT NOT NULL DEFAULT 1000000
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE buildings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                colony_id INT NOT NULL,
                type VARCHAR(64) NOT NULL,
                level INT NOT NULL DEFAULT 0,
                upgrade_end DATETIME NULL,
                UNIQUE KEY unique_building (colony_id, type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE building_upgrade_queue (
                id INT AUTO_INCREMENT PRIMARY KEY,
                colony_id INT NOT NULL,
                building_type VARCHAR(64) NOT NULL,
                target_level INT NOT NULL,
                cost_metal INT NOT NULL DEFAULT 0,
                cost_crystal INT NOT NULL DEFAULT 0,
                cost_deuterium INT NOT NULL DEFAULT 0,
                duration_secs INT NOT NULL,
                queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME NULL,
                eta DATETIME NULL,
                status ENUM('queued', 'running', 'done', 'cancelled') NOT NULL DEFAULT 'queued',
                INDEX idx_buq_colony_status (colony_id, status)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE ship_build_queue (
                id INT AUTO_INCREMENT PRIMARY KEY,
                colony_id INT NOT NULL,
                ship_type VARCHAR(64) NOT NULL,
                blueprint_id INT NULL,
                quantity INT NOT NULL DEFAULT 1,
                cost_metal INT NOT NULL DEFAULT 0,
                cost_crystal INT NOT NULL DEFAULT 0,
                cost_deuterium INT NOT NULL DEFAULT 0,
                duration_secs INT NOT NULL,
                queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME NULL,
                eta DATETIME NULL,
                status ENUM('queued', 'running', 'done', 'cancelled') NOT NULL DEFAULT 'queued',
                INDEX idx_sbq_colony_status (colony_id, status)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE achievements (
                id INT PRIMARY KEY,
                code VARCHAR(64) NOT NULL,
                reward_metal INT NOT NULL DEFAULT 0,
                reward_crystal INT NOT NULL DEFAULT 0,
                reward_deuterium INT NOT NULL DEFAULT 0,
                reward_dark_matter INT NOT NULL DEFAULT 0,
                reward_rank_points INT NOT NULL DEFAULT 0,
                title VARCHAR(128) NOT NULL
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE user_achievements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                achievement_id INT NOT NULL,
                completed TINYINT NOT NULL DEFAULT 0,
                progress INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE leaders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                colony_id INT NOT NULL,
                role VARCHAR(64) NOT NULL,
                autonomy INT NOT NULL DEFAULT 0,
                skill_research INT NOT NULL DEFAULT 0,
                skill_efficiency INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE ships (
                colony_id INT NOT NULL,
                type VARCHAR(64) NOT NULL,
                count INT NOT NULL DEFAULT 0,
                UNIQUE KEY unique_ship (colony_id, type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE fleets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                origin_colony_id INT NOT NULL,
                target_galaxy INT NOT NULL,
                target_system INT NOT NULL,
                target_position INT NOT NULL,
                mission VARCHAR(16) NOT NULL,
                ships_json TEXT NOT NULL,
                cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_payload JSON NULL,
                origin_x_ly DOUBLE NOT NULL DEFAULT 0,
                origin_y_ly DOUBLE NOT NULL DEFAULT 0,
                origin_z_ly DOUBLE NOT NULL DEFAULT 0,
                origin_radius_ly DOUBLE NULL,
                origin_theta_rad DOUBLE NULL,
                origin_height_ly DOUBLE NULL,
                target_x_ly DOUBLE NOT NULL DEFAULT 0,
                target_y_ly DOUBLE NOT NULL DEFAULT 0,
                target_z_ly DOUBLE NOT NULL DEFAULT 0,
                target_radius_ly DOUBLE NULL,
                target_theta_rad DOUBLE NULL,
                target_height_ly DOUBLE NULL,
                speed_ly_h DOUBLE NOT NULL DEFAULT 1,
                distance_ly DOUBLE NOT NULL DEFAULT 0,
                departure_time DATETIME NOT NULL,
                arrival_time DATETIME NOT NULL,
                return_time DATETIME NULL,
                stealth_until DATETIME NULL,
                hull_damage_pct TINYINT UNSIGNED NOT NULL DEFAULT 0
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE trade_routes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                origin_colony_id INT NOT NULL,
                target_colony_id INT NOT NULL,
                cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
                cargo_payload JSON NULL,
                interval_hours INT UNSIGNED NOT NULL DEFAULT 24,
                last_dispatch DATETIME NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE star_systems (
                galaxy_index INT NOT NULL,
                system_index INT NOT NULL,
                x_ly DOUBLE NOT NULL,
                y_ly DOUBLE NOT NULL,
                z_ly DOUBLE NOT NULL,
                PRIMARY KEY (galaxy_index, system_index)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE research (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type VARCHAR(64) NOT NULL,
                level INT NOT NULL DEFAULT 0,
                research_start DATETIME NULL,
                research_end DATETIME NULL,
                UNIQUE KEY research_user_type (user_id, type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_policies (
                user_id INT PRIMARY KEY,
                global_policy VARCHAR(32) NOT NULL,
                tax_income DECIMAL(8,5) NOT NULL DEFAULT 0.15,
                tax_trade DECIMAL(8,5) NOT NULL,
                tax_production DECIMAL(8,5) NOT NULL DEFAULT 0,
                subsidy_agriculture TINYINT NOT NULL DEFAULT 0,
                subsidy_research TINYINT NOT NULL DEFAULT 0,
                subsidy_military TINYINT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_processed_goods (
                id BIGINT UNSIGNED AUTO_INCREMENT UNIQUE,
                colony_id INT NOT NULL,
                good_type VARCHAR(64) NOT NULL,
                quantity DECIMAL(20,4) NOT NULL,
                capacity DECIMAL(20,4) NOT NULL,
                production_rate_per_hour DECIMAL(20,4) NOT NULL DEFAULT 0,
                consumption_rate_per_hour DECIMAL(20,4) NOT NULL DEFAULT 0,
                last_calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (colony_id, good_type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_production_methods (
                colony_id INT NOT NULL,
                building_type VARCHAR(64) NOT NULL,
                method VARCHAR(32) NOT NULL,
                UNIQUE KEY unique_method (colony_id, building_type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_pop_classes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                colony_id INT NOT NULL,
                pop_class VARCHAR(32) NOT NULL,
                count INT NOT NULL,
                satisfaction_ticks INT NOT NULL DEFAULT 0,
                shortage_ticks INT NOT NULL DEFAULT 0,
                satisfaction_index DECIMAL(8,4) NOT NULL DEFAULT 50,
                employment_level DECIMAL(8,4) NOT NULL DEFAULT 80,
                UNIQUE KEY unique_pop_class (colony_id, pop_class)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE market_supply_demand (
                galaxy_index INT NOT NULL,
                system_index INT NOT NULL,
                resource_type VARCHAR(64) NOT NULL,
                production_per_hour DECIMAL(20,4) NOT NULL,
                consumption_per_hour DECIMAL(20,4) NOT NULL,
                available_supply DECIMAL(20,4) NOT NULL,
                desired_demand DECIMAL(20,4) NOT NULL,
                net_balance DECIMAL(20,4) NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (galaxy_index, system_index, resource_type)
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_market_events (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                affected_good VARCHAR(64) NULL,
                price_mult DECIMAL(8,4) NOT NULL DEFAULT 1,
                remaining_ticks INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE economy_market_transactions (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                colony_id INT NOT NULL,
                good_type VARCHAR(64) NOT NULL,
                direction VARCHAR(8) NOT NULL,
                quantity DECIMAL(20,4) NOT NULL,
                price_per_unit DECIMAL(20,2) NOT NULL,
                total_credits DECIMAL(20,2) NOT NULL,
                trade_tax_rate DECIMAL(8,5) NOT NULL,
                net_credits DECIMAL(20,2) NOT NULL,
                transacted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        SQL);
        $this->admin->exec(<<<'SQL'
            CREATE TABLE colony_events (
                colony_id INT NOT NULL,
                event_type VARCHAR(64) NOT NULL,
                expires_at DATETIME NOT NULL
            ) ENGINE=InnoDB
        SQL);
        // The on-demand ledger is the only economy path; apply its canonical migrations.
        $sqlDirectory = dirname(__DIR__, 2) . '/sql';
        $parser = new \MigrationRunner($this->admin, $sqlDirectory, 'TEST');
        foreach (['migrate_colony_buildings_v1.sql', 'migrate_body_development_v1.sql',
            'migrate_economy_on_demand_v1.sql'] as $migration) {
            $sql = file_get_contents($sqlDirectory . '/' . $migration);
            self::assertIsString($sql);
            foreach ($parser->splitStatements($sql) as $statement) {
                $result = $this->admin->query($statement);
                $result->closeCursor();
            }
        }
    }

    private function seedMarket(): void
    {
        $this->admin->exec("INSERT INTO users (id, credits) VALUES (7, 100000)");
        $future = date('Y-m-d H:i:s', time() + 86400);
        $colony = $this->admin->prepare(
            'INSERT INTO colonies (id, user_id, body_id, planet_id, last_update) VALUES (?, 7, ?, ?, ?)'
        );
        $colony->execute([11, 21, 31, $future]);
        $colony->execute([12, 22, 32, $future]);
        $this->admin->exec(
            'INSERT INTO celestial_bodies (id, galaxy_index, system_index, position) VALUES '
            . '(21, 1, 4, 1), (22, 1, 4, 2)'
        );
        $this->admin->exec(
            'INSERT INTO star_systems (galaxy_index, system_index, x_ly, y_ly, z_ly) VALUES '
            . '(1, 4, 0, 0, 0), (1, 5, 10, 0, 0)'
        );
        $this->admin->exec('INSERT INTO planets (id) VALUES (31), (32)');
        $this->admin->exec(
            "INSERT INTO research (user_id, type, level) VALUES (7, 'energy_tech', 0), (7, 'quantum_computing', 0)"
        );
        $this->admin->exec(
            "INSERT INTO buildings (colony_id, type, level) VALUES "
            . "(11, 'metal_mine', 0), (11, 'shipyard', 1), (12, 'metal_mine', 0), (12, 'shipyard', 1)"
        );
        $this->admin->exec(
            "INSERT INTO ships (colony_id, type, count) VALUES (11, 'large_cargo', 2)"
        );
        $this->admin->exec(
            "INSERT INTO economy_policies (user_id, global_policy, tax_trade) VALUES (7, 'free_market', 0)"
        );
        $this->admin->exec(
            "INSERT INTO economy_processed_goods "
            . "(colony_id, good_type, quantity, capacity) VALUES (11, 'metal', 0, 100)"
        );

        $this->sessionDirectory = sys_get_temp_dir()
            . DIRECTORY_SEPARATOR . 'gq-resource-api-session-' . bin2hex(random_bytes(6));
        self::assertTrue(mkdir($this->sessionDirectory, 0700));
        $this->sessionIds = [bin2hex(random_bytes(13)), bin2hex(random_bytes(13))];
    }

    private function startApiServer(): void
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        self::assertIsResource($socket, "Unable to allocate API test port: {$error}");
        $address = stream_socket_get_name($socket, false);
        self::assertIsString($address);
        $this->port = (int)substr(strrchr($address, ':'), 1);
        fclose($socket);

        $dsnParts = [];
        $dsn = preg_replace('/^mysql:/', '', (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'));
        foreach (explode(';', (string)$dsn) as $part) {
            if (str_contains($part, '=')) {
                [$key, $value] = explode('=', $part, 2);
                $dsnParts[$key] = $value;
            }
        }
        $environment = array_merge((array)getenv(), [
            'DB_HOST' => $dsnParts['host'] ?? '127.0.0.1',
            'DB_PORT' => $dsnParts['port'] ?? '3306',
            'DB_NAME' => $this->database,
            'DB_USER' => getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            'DB_PASS' => getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            'GQ_RESOURCE_API_TEST_SESSION_IDS' => implode(',', $this->sessionIds),
            'PHP_CLI_SERVER_WORKERS' => '4',
        ]);
        $root = dirname(__DIR__, 2);
        $command = [
            PHP_BINARY,
            '-d',
            'session.save_path=' . $this->sessionDirectory,
            '-d',
            'auto_prepend_file=' . __DIR__             . '/resource_api_test_prepend.php',
            '-S',
            '127.0.0.1:' . $this->port,
            '-t',
            $root,
        ];
        $this->server = proc_open(
            $command,
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $this->serverPipes,
            $root,
            $environment
        );
        self::assertIsResource($this->server);

        stream_set_blocking($this->serverPipes[2], false);
        $serverLog = '';
        $startupMessage = 'Development Server (http://127.0.0.1:' . $this->port . ') started';
        $deadline = hrtime(true) + 10_000_000_000;
        do {
            $serverLog .= stream_get_contents($this->serverPipes[2]);
            if (substr_count($serverLog, $startupMessage) >= 5) {
                $probe = @stream_socket_client('tcp://127.0.0.1:' . $this->port, $errno, $error, 0.1);
                if (is_resource($probe)) {
                    fclose($probe);
                    return;
                }
            }
            $status = proc_get_status($this->server);
            self::assertTrue($status['running'], 'PHP API test server exited before becoming ready: ' . $serverLog);
            usleep(20_000);
        } while (hrtime(true) < $deadline);

        self::fail('PHP API test server workers did not become ready: ' . $serverLog);
    }

    private function startResearchRequest(string $sessionId, int $colonyId): mixed
    {
        return $this->startApiRequest(
            $sessionId,
            '/api/research.php?action=research',
            ['colony_id' => $colonyId, 'type' => 'energy_tech']
        );
    }

    private function startBuildingUpgradeRequest(string $sessionId, int $colonyId): mixed
    {
        return $this->startApiRequest(
            $sessionId,
            '/api/buildings.php?action=upgrade',
            ['colony_id' => $colonyId, 'type' => 'metal_mine']
        );
    }

    private function startShipBuildRequest(string $sessionId, int $colonyId): mixed
    {
        return $this->startApiRequest(
            $sessionId,
            '/api/shipyard.php?action=build',
            ['colony_id' => $colonyId, 'type' => 'light_fighter', 'count' => 4]
        );
    }

    private function startFleetSendRequest(string $sessionId, int $colonyId): mixed
    {
        return $this->startApiRequest(
            $sessionId,
            '/api/fleet.php?action=send',
            [
                'origin_colony_id' => $colonyId,
                'target_galaxy' => 1,
                'target_system' => 5,
                'target_position' => 1,
                'mission' => 'transport',
                'ships' => ['small_cargo' => 1],
                'cargo' => ['metal' => 200],
            ]
        );
    }

    private function startTradeDispatchRequest(string $sessionId): mixed
    {
        return $this->startApiRequest(
            $sessionId,
            '/api/trade.php?action=dispatch_due',
            []
        );
    }

    private function startApiRequest(string $sessionId, string $path, array $payload): mixed
    {
        $socket = stream_socket_client('tcp://127.0.0.1:' . $this->port, $errno, $error, 5);
        self::assertIsResource($socket, "Unable to connect to API test server: {$error}");
        $body = json_encode($payload, JSON_THROW_ON_ERROR);
        $request = "POST {$path} HTTP/1.1\r\n"
            . "Host: 127.0.0.1\r\n"
            . "Cookie: PHPSESSID={$sessionId}\r\n"
            . "X-CSRF-Token: gq-market-test-csrf\r\n"
            . "Content-Type: application/json\r\n"
            . 'Content-Length: ' . strlen($body) . "\r\n"
            . "Connection: close\r\n\r\n"
            . $body;
        self::assertSame(strlen($request), fwrite($socket, $request));
        stream_set_timeout($socket, 10);
        fflush($socket);
        return $socket;
    }

    private function readResponse(mixed $socket): array
    {
        $response = stream_get_contents($socket);
        fclose($socket);
        self::assertIsString($response);
        $parts = explode("\r\n\r\n", $response, 2);
        self::assertCount(2, $parts, 'Expected a complete HTTP response.');
        self::assertMatchesRegularExpression('/^HTTP\/1\.[01] ([0-9]{3})/', $parts[0]);
        preg_match('/^HTTP\/1\.[01] ([0-9]{3})/', $parts[0], $matches);
        $payload = json_decode($parts[1], true, flags: JSON_THROW_ON_ERROR);
        self::assertIsArray($payload);
        return ['status' => (int)$matches[1], 'payload' => $payload];
    }

    private function assertApiRequestsWaitingForUserLock(int $expected): void
    {
        $waits = $this->admin->prepare(<<<'SQL'
            SELECT COUNT(*)
            FROM performance_schema.data_lock_waits waits
            JOIN performance_schema.threads thread
              ON thread.THREAD_ID = waits.REQUESTING_THREAD_ID
            WHERE thread.PROCESSLIST_DB = ?
        SQL);
        $deadline = hrtime(true) + 30_000_000_000;
        $observedWaits = 0;
        do {
            $waits->execute([$this->database]);
            $observedWaits = (int)$waits->fetchColumn();
            if ($observedWaits >= $expected) {
                return;
            }
            usleep(10_000);
        } while (hrtime(true) < $deadline);

        $threads = $this->admin->prepare(
            'SELECT PROCESSLIST_ID, PROCESSLIST_STATE, LEFT(PROCESSLIST_INFO, 256)
             FROM performance_schema.threads
             WHERE PROCESSLIST_DB = ? AND PROCESSLIST_INFO IS NOT NULL'
        );
        $threads->execute([$this->database]);
        self::fail(sprintf(
            'Expected %d API lock waiters; observed %d. Active database threads: %s',
            $expected,
            $observedWaits,
            json_encode($threads->fetchAll(PDO::FETCH_NUM), JSON_THROW_ON_ERROR)
        ));
    }
}
