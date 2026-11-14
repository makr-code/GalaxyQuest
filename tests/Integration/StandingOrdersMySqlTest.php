<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use DomainException;
use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\StandingOrders;
use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\EconomicRequests;
use GalaxyQuest\Economy\TradeTransports;
use MigrationRunner;
use PDO;
use PDOException;
use PHPUnit\Framework\TestCase;
use function GalaxyQuest\Tests\Integration\StandingOrdersMySql\connection;

require_once __DIR__ . '/standing_orders_mysql_fixture.php';
require_once __DIR__ . '/../../src/Economy/EconomicRequests.php';

final class StandingOrdersMySqlTest extends TestCase
{
    private static ?PDO $db = null;
    private static string $database = '';
    private static string $directory = '';
    private static ?MigrationRunner $runner = null;
    private array $workers = [];

    public static function setUpBeforeClass(): void
    {
        if (!getenv('GQ_RESOURCE_LEDGER_TEST_DSN')) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN for isolated standing-order regressions.');
        }
        self::$db = connection();
        self::assertSame('mysql', self::$db->getAttribute(PDO::ATTR_DRIVER_NAME));
        self::$database = 'gq_standing_mysql_' . bin2hex(random_bytes(6));
        self::$db->exec('CREATE DATABASE `' . self::$database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        self::$db->exec('USE `' . self::$database . '`');
        self::assertSame(self::$database, self::$db->query('SELECT DATABASE()')->fetchColumn());
        self::$directory = __DIR__ . '/.fixtures_' . self::$database;
        mkdir(self::$directory, 0700);
        try {
            $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
            $parser = new MigrationRunner(self::$db, self::$directory, 'TEST');
            foreach (['schema.sql', 'schema_migrations.sql', ...$manifest] as $file) {
                $sql = file_get_contents(__DIR__ . '/../../sql/' . $file);
                $statements = array_filter($parser->splitStatements($sql),
                    static fn(string $sql): bool => $sql !== 'USE galaxyquest'
                        && !str_starts_with($sql, 'CREATE DATABASE IF NOT EXISTS galaxyquest '));
                file_put_contents(self::$directory . '/' . $file, implode(";\n", $statements) . ';');
            }
            self::$db->exec(file_get_contents(self::$directory . '/schema.sql'));
            copy(__DIR__ . '/../../sql/migrate_economy_requests_v1_down.sql',
                self::$directory . '/migrate_economy_requests_v1_down.sql');
            copy(__DIR__ . '/../../sql/migrate_economy_request_purchase_v1_down.sql',
                self::$directory . '/migrate_economy_request_purchase_v1_down.sql');
            copy(__DIR__ . '/../../sql/migrate_trader_transport_return_v1_down.sql',
                self::$directory . '/migrate_trader_transport_return_v1_down.sql');
            file_put_contents(self::$directory . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
            self::$runner = new MigrationRunner(self::$db, self::$directory, 'TEST', self::$directory . '/manifest.php');
            self::$runner->bootstrap();
            self::assertSame($manifest, array_column(self::$runner->runUp(), 'name'));
            self::assertSame([], self::$runner->runUp());
            self::assertSame(count($manifest), self::$runner->verifyDeployment());
        } catch (\Throwable $error) {
            self::tearDownAfterClass();
            throw $error;
        }
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$db !== null && self::$database !== '') {
            if (self::$db->inTransaction()) {
                self::$db->rollBack();
            }
            self::$db->exec('DROP DATABASE IF EXISTS `' . self::$database . '`');
        }
        self::$db = null;
        if (self::$directory !== '' && is_dir(self::$directory)) {
            foreach (glob(self::$directory . '/*') as $file) {
                unlink($file);
            }
            rmdir(self::$directory);
        }
    }

    protected function setUp(): void
    {
        // Only the generated disposable schema is reset; canonical faction seeds remain.
        self::$db->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach (['economy_requests', 'messages', 'mail_outbox', 'economy_npc_orders', 'economy_npc_profiles',
            'trader_transactions', 'trader_routes', 'fleets', 'npc_traders', 'economy_standing_orders',
            'colony_economy_state', 'economy_processed_goods', 'economy_colony_market', 'economy_pop_classes',
            'economy_policies', 'colonies', 'users', 'buildings', 'body_development',
            'building_upgrade_queue', 'economy_construction_slots', 'colony_building_slots',
            'economy_production_methods', 'research', 'ships',
            'celestial_bodies', 'star_systems'] as $table) {
            self::$db->exec('TRUNCATE TABLE `' . $table . '`');
        }
        self::$db->exec('SET FOREIGN_KEY_CHECKS=1');
        self::$db->exec(<<<'SQL'
            INSERT INTO users (id,username,email,password_hash,credits,control_type,auth_enabled) VALUES
                (7,'seller','seller@example.invalid','fixture',100,'human',1),
                (8,'buyer','buyer@example.invalid','fixture',100,'human',1),
                (10,'trader','trader@example.invalid','fixture',100,'npc_engine',0);
            INSERT INTO star_systems (galaxy_index,system_index,x_ly) VALUES (1,1,0),(1,2,100);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name) VALUES
                (11,'standing-source',1,1,1,'planet','Source'),(12,'standing-target',1,2,1,'planet','Target');
            INSERT INTO colonies (id,user_id,body_id,population) VALUES (11,7,11,0),(12,8,12,0);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name) VALUES
                (1001,'standing-depot-1',1,1,10,'planet','Carrier depot 1'),
                (1002,'standing-depot-2',1,2,10,'planet','Carrier depot 2'),
                (1003,'standing-depot-3',1,3,10,'planet','Carrier depot 3');
            INSERT INTO colonies (id,user_id,body_id,population,metal,crystal,deuterium,rare_earth,food)
                VALUES (1001,10,1001,0,0,0,0,0,0),(1002,10,1002,0,0,0,0,0,0),
                       (1003,10,1003,0,0,0,0,0,0);
            INSERT INTO ships (colony_id,type,count)
                VALUES (1001,'small_cargo',4),(1002,'small_cargo',4),(1003,'small_cargo',4);
            INSERT INTO economy_policies (user_id,tax_income,tax_trade,tax_production) VALUES (7,0,0,0),(8,0,0,0);
            INSERT INTO economy_processed_goods
                (colony_id,good_type,quantity,capacity,production_rate_per_hour,consumption_rate_per_hour)
                VALUES (11,'steel_alloy',100,10000,0,0),(12,'steel_alloy',100,10000,0,0);
            SQL);
        self::$db->exec(
            "INSERT INTO npc_traders (id,faction_id,name,user_id,capital_credits,active_fleets) "
            . "SELECT 1,MIN(id),'Fixture A',10,100,0 FROM npc_factions"
        );
        self::$db->exec(
            "INSERT INTO npc_traders (id,faction_id,name,user_id,capital_credits,active_fleets) "
            . "SELECT 2,MIN(id),'Fixture B',10,100,0 FROM npc_factions"
        );
        $economy = new OnDemandEconomy(self::$db);
        $economy->settle(11, 7);
        $economy->settle(12, 8);
    }

    protected function tearDown(): void
    {
        if (self::$db->inTransaction()) {
            self::$db->rollBack();
        }
        foreach ($this->workers as $worker) {
            foreach ($worker['pipes'] as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            if (is_resource($worker['process'])) {
                proc_terminate($worker['process']);
                proc_close($worker['process']);
            }
        }
        $this->workers = [];
        self::$db->exec('DROP TRIGGER IF EXISTS standing_reject_write');
    }

    public function testSchemaStatusRollbackAndForeignKeysPreserveFiniteEscrow(): void
    {
        $status = array_column(self::$runner->getStatus(), 'status', 'name');
        self::assertSame('applied', $status['migrate_standing_trade_orders_v1.sql']);
        $columns = self::$db->query(
            "SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS "
            . "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='economy_standing_orders'"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        self::assertSame('bigint unsigned', $columns['id']);
        self::assertSame('bigint', $columns['escrow_cents']);
        $route = $this->route(1, 10);
        $before = $this->balances();
        $rollback = self::$runner->runRollback(1, true);
        self::assertSame('would_rollback', $rollback[0]['status']);
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        self::assertSame($manifest[array_key_last($manifest)], $rollback[0]['name']);
        self::assertSame($before, $this->balances());
        foreach (['DELETE FROM colonies WHERE id=12', 'DELETE FROM users WHERE id=8',
            'DELETE FROM users WHERE id=10', 'DELETE FROM npc_traders WHERE id=1',
            'DELETE FROM economy_standing_orders WHERE id=' . $route['target_order_id']] as $sql) {
            $this->assertConstraint($sql);
        }

        $this->assertConstraint(
            "UPDATE economy_standing_orders SET escrow_cents=-1 WHERE id=" . $route['target_order_id'], 'HY000'
        );
        $this->assertConstraint('UPDATE trader_routes SET buyer_escrow_cents=-1 WHERE id=' . $route['id'], 'HY000');
        process_single_route_transition(self::$db, $route);
        $this->assertConstraint(
            'INSERT INTO trader_routes (trader_id,fleet_id,source_colony_id,target_colony_id,resource_type,quantity_planned) '
            . "SELECT trader_id,fleet_id,source_colony_id,target_colony_id,resource_type,quantity_planned FROM trader_routes"
        );
        self::assertSame(2, (int)self::$db->query(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() "
            . "AND TABLE_NAME='economy_standing_orders' AND INDEX_NAME IN ('standing_owner','standing_match') "
            . 'AND SEQ_IN_INDEX=1'
        )->fetchColumn());
    }

    public function testOfflineCliVerifiesExplicitTargetAndActivationIsRealButPreviewsRollBack(): void
    {
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id=7");
        $before = $this->balances();
        $arguments = ['--actor=7', '--colony=11', '--profile=industry', '--budget=100.00',
            '--expected-db=' . self::$database];
        [$exit, $preview] = $this->cli('bind', $arguments);
        self::assertSame(0, $exit);
        self::assertTrue($preview['dry_run']);
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM economy_npc_profiles')->fetchColumn());
        [$exit, $applied] = $this->cli('bind', [...$arguments, '--apply']);
        self::assertSame(0, $exit);
        self::assertSame('bound', $applied['status']);
        [$exit, $decision] = $this->cli('preview', ['--actor=7', '--expected-db=' . self::$database]);
        self::assertSame(0, $exit);
        self::assertTrue($decision['dry_run']);
        self::assertArrayHasKey('window', $decision);
        self::assertTrue(isset($decision['production']) || isset($decision['deferred']));
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        self::assertNull((new NpcStandingOrders(self::$db))->diagnostics(7)['summary']);
        [$exit, $status] = $this->cli('status', ['--actor=7', '--expected-db=' . self::$database]);
        self::assertSame(0, $exit);
        self::assertSame('industry', $status['binding']['profile']);
        [$exit, $error] = $this->cli('bind', ['--actor=8', '--colony=12', '--profile=trade',
            '--budget=10.00', '--expected-db=wrong_target', '--apply']);
        self::assertSame(1, $exit);
        self::assertStringContainsString('does not match', $error['error']);
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM economy_npc_profiles')->fetchColumn());
        self::assertSame($before, $this->balances());
    }

    private function cli(string $command, array $arguments): array
    {
        $environment = array_merge(getenv(), [
            'XDEBUG_MODE' => 'off',
            'GQ_NPC_ECONOMY_DSN' => getenv('GQ_RESOURCE_LEDGER_TEST_DSN') . ';dbname=' . self::$database,
            'GQ_NPC_ECONOMY_USER' => getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            'GQ_NPC_ECONOMY_PASSWORD' => getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
        ]);
        $process = proc_open([PHP_BINARY, __DIR__ . '/../../scripts/npc_economy.php', $command, ...$arguments],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, dirname(__DIR__, 2), $environment);
        self::assertIsResource($process);
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exit = proc_close($process);
        try {
            return [$exit, json_decode($exit === 0 ? $stdout : $stderr, true, 512, JSON_THROW_ON_ERROR)];
        } catch (\JsonException $error) {
            self::fail('CLI returned malformed JSON; exit=' . $exit . ' stdout=' . $stdout . ' stderr=' . $stderr);
        }
    }

    public function testRequestAcceptanceSerializesDuplicateAndCompetingPlayersWithoutMintingBacking(): void
    {
        $now = time();
        $first = $this->requestFixture($now);
        $duplicates = $this->race([
            ['action' => 'request_accept', 'uid' => 7, 'id' => $first['id'], 'now' => $now],
            ['action' => 'request_accept', 'uid' => 7, 'id' => $first['id'], 'now' => $now],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($duplicates));
        self::assertSame($duplicates[0]['result'], $duplicates[1]['result']);
        self::assertSame('accepted', $duplicates[0]['result']['status']);
        self::assertSame(1, (int)self::$db->query("SELECT COUNT(*) FROM economy_standing_orders WHERE user_id=7")->fetchColumn());
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM messages')->fetchColumn());
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn());
    }

    public function testRequestTwoRecipientsRaceForFinalNpcBudgetAndRollbackGuardPreservesPrivatePair(): void
    {
        $now = time();
        $first = $this->requestFixture($now);
        self::$db->exec(<<<'SQL'
            INSERT INTO users (id,username,email,password_hash,credits) VALUES (9,'second-supplier','supplier@example.org','fixture',100);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
                VALUES (13,'second-supplier',1,1,2,'planet','Supplier');
            INSERT INTO colonies (id,user_id,body_id,population) VALUES (13,9,13,0);
            INSERT INTO economy_policies (user_id,tax_income,tax_trade,tax_production) VALUES (9,0,0,0);
            INSERT INTO economy_processed_goods
                (colony_id,good_type,quantity,capacity,production_rate_per_hour,consumption_rate_per_hour)
                VALUES (13,'steel_alloy',100,10000,0,0);
            SQL);
        (new OnDemandEconomy(self::$db))->settle(13, 9, $now, true);
        $second = (new EconomicRequests(self::$db))->offer(8, $now + 3600);
        self::assertNotNull($second);
        $balances = $this->balances();
        $results = $this->race([
            ['action' => 'request_accept', 'uid' => 7, 'id' => $first['id'], 'now' => $now + 3600],
            ['action' => 'request_accept', 'uid' => 9, 'id' => $second['id'], 'now' => $now + 3600],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        $states = array_column(array_column($results, 'result'), 'status');
        sort($states);
        self::assertSame(['accepted', 'unavailable'], $states);
        self::assertSame($balances, $this->balances());
        self::assertSame(10, (int)self::$db->query(
            "SELECT SUM(quantity_remaining) FROM economy_standing_orders WHERE user_id=8 AND side='buy'"
        )->fetchColumn());
        self::assertSame(2000, (int)self::$db->query(
            "SELECT SUM(escrow_cents) FROM economy_standing_orders WHERE user_id=8"
        )->fetchColumn());
        try {
            self::$runner->runRollback(3);
            self::fail('Rollback must not publish an active private pair.');
        } catch (\RuntimeException $error) {
            self::assertInstanceOf(PDOException::class, $error->getPrevious());
            self::assertSame('HY000', $error->getPrevious()->getCode());
        }
        self::assertTrue(EconomicRequests::available(self::$db));
        self::$db->exec('DROP TABLE IF EXISTS economy_request_rollback_guard');
        self::$runner->runUp();
    }

    public function testRequestAcceptVersusNpcCancelUsesConsistentOwnerLocksAndNoUnfundedCommitment(): void
    {
        $now = time();
        $request = $this->requestFixture($now);
        $npcOrder = (int)self::$db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        $before = $this->balances();
        $results = $this->race([
            ['action' => 'request_accept', 'uid' => 7, 'id' => $request['id'], 'now' => $now],
            ['action' => 'cancel', 'uid' => 8, 'id' => $npcOrder],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        self::assertContains($results[0]['result']['status'], ['accepted', 'unavailable']);
        self::assertSame($before, $this->balances());
        $confirmed = (int)self::$db->query("SELECT COUNT(*) FROM economy_requests WHERE status='accepted'")->fetchColumn();
        self::assertSame($confirmed * 2000, (int)self::$db->query(
            'SELECT COALESCE(SUM(escrow_cents),0) FROM economy_standing_orders WHERE paired_order_id IS NOT NULL'
        )->fetchColumn());
    }

    private function requestFixture(int $now): array
    {
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id=8");
        (new NpcStandingOrders(self::$db))->bind(8, 12, 'trade', 10000, false);
        $order = (new StandingOrders(self::$db))->create(8, 12, 'buy', 'steel_alloy', 10, '2.00', $now);
        $window = intdiv($now, 3600);
        self::$db->prepare('INSERT INTO economy_npc_orders (order_id,user_id,created_window,expires_window) VALUES (?,?,?,?)')
            ->execute([$order['id'], 8, $window, $window + 24]);
        $request = (new EconomicRequests(self::$db))->offer(8, $now);
        self::assertNotNull($request);
        self::assertSame(11, $request['colony_id']);
        return $request;
    }

    public function testRequestMigrationDownAndUpMatchTheExecutableSchema(): void
    {
        $columns = self::$db->query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() "
            . "AND TABLE_NAME='economy_requests'"
        )->fetchAll(PDO::FETCH_COLUMN);
        foreach (['npc_order_id', 'player_order_id', 'committed_npc_order_id', 'expires_at', 'price_cents'] as $column) {
            self::assertContains($column, $columns);
        }
        $rollback = self::$runner->runRollback(3);
        self::assertSame('rolled_back', $rollback[0]['status']);
        self::assertFalse(EconomicRequests::available(self::$db));
        $applied = self::$runner->runUp();
        self::assertSame([
            'migrate_economy_requests_v1.sql', 'migrate_economy_request_purchase_v1.sql',
            'migrate_trader_transport_return_v1.sql',
        ], array_column($applied, 'name'));
        self::assertTrue(EconomicRequests::available(self::$db));
    }

    public function testPurchaseCompetingRecipientsAndRollbackGuardPreserveGoodsAndEscrow(): void
    {
        $now = time();
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id=8");
        (new NpcStandingOrders(self::$db))->bind(8, 12, 'trade', 10000, false);
        $order = (new StandingOrders(self::$db))->create(8, 12, 'sell', 'steel_alloy', 10, '2.00', $now);
        $window = intdiv($now, 3600);
        self::$db->prepare('INSERT INTO economy_npc_orders (order_id,user_id,created_window,expires_window) VALUES (?,?,?,?)')
            ->execute([$order['id'], 8, $window, $window + 24]);
        $first = (new EconomicRequests(self::$db))->offer(8, $now);
        self::assertSame('purchase', $first['type']);
        self::$db->exec(<<<'SQL'
            INSERT INTO users (id,username,email,password_hash,credits) VALUES (9,'second-buyer','buyer9@example.org','fixture',100);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
                VALUES (13,'second-buyer',1,1,2,'planet','Buyer');
            INSERT INTO colonies (id,user_id,body_id,population) VALUES (13,9,13,0);
            INSERT INTO economy_policies (user_id,tax_income,tax_trade,tax_production) VALUES (9,0,0,0);
            SQL);
        (new OnDemandEconomy(self::$db))->settle(13, 9, $now, true);
        $second = (new EconomicRequests(self::$db))->offer(8, $now + 3600);
        self::assertNotNull($second);
        $results = $this->race([
            ['action' => 'request_accept', 'uid' => 7, 'id' => $first['id'], 'now' => $now + 3600],
            ['action' => 'request_accept', 'uid' => 9, 'id' => $second['id'], 'now' => $now + 3600],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        $states = array_column(array_column($results, 'result'), 'status');
        sort($states);
        self::assertSame(['accepted', 'unavailable'], $states);
        self::assertSame(10, (int)self::$db->query("SELECT SUM(quantity_remaining) FROM economy_standing_orders WHERE user_id=8 AND side='sell'")->fetchColumn());
        self::assertSame(2010, (int)self::$db->query("SELECT SUM(escrow_cents) FROM economy_standing_orders WHERE side='buy'")->fetchColumn());
        try {
            self::$runner->runRollback(2);
            self::fail('Rollback must preserve purchase records and their obligations.');
        } catch (\RuntimeException $error) {
            self::assertInstanceOf(PDOException::class, $error->getPrevious());
        }
        self::$db->exec('DROP TABLE IF EXISTS economy_request_purchase_rollback_guard');
        self::$runner->runUp();
        self::assertSame(2010, (int)self::$db->query("SELECT SUM(escrow_cents) FROM economy_standing_orders WHERE side='buy'")->fetchColumn());
    }

    public function testNpcDecisionWindowSerializesConcurrentRetriesAndKeepsFiniteBacking(): void
    {
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id IN (7,8)");
        self::$db->exec('UPDATE colonies SET metal=0,crystal=0,deuterium=0,rare_earth=0,food=0 WHERE id=11');
        $controller = new NpcStandingOrders(self::$db);
        $controller->bind(7, 11, 'industry', 10000, false);
        $before = $this->balances();
        $results = $this->race([
            ['action' => 'npc_decide', 'uid' => 7],
            ['action' => 'npc_decide', 'uid' => 7],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        $statuses = array_column(array_column($results, 'result'), 'status');
        sort($statuses);
        self::assertSame(['already_decided', 'decided'], $statuses);
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        self::assertSame(0.0, $this->stock(11));
        self::assertSame($before, $this->balances());
        self::assertNotNull($controller->diagnostics(7)['summary']);
    }

    public function testNpcDecisionCurrentOwnershipRejectsOuterStaleSnapshotAndCreateRollbackIsAtomic(): void
    {
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id=7");
        $controller = new NpcStandingOrders(self::$db);
        $controller->bind(7, 11, 'industry', 10000, false);
        $worker = $this->start(['action' => 'npc_decide', 'uid' => 7, 'outer' => true]);
        self::$db->beginTransaction();
        self::$db->query('SELECT id FROM users WHERE id=7 FOR UPDATE')->fetchAll();
        $connection = $this->go($worker);
        $this->waiting([$connection], 'REPEATABLE READ');
        self::$db->exec("UPDATE users SET control_type='human',auth_enabled=1 WHERE id=7");
        self::$db->commit();
        $result = $this->workerResult($worker);
        self::assertSame('excluded', $result['result']['status']);
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        self::assertNull($controller->diagnostics(7)['summary']);
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0 WHERE id=7");
        $before = $this->balances();
        self::$db->exec("CREATE TRIGGER standing_reject_write BEFORE INSERT ON economy_npc_orders "
            . "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='npc rollback fixture'");
        try {
            $controller->decide(7);
            self::fail('Managed order persistence failure must roll back reservations.');
        } catch (PDOException $error) {
            self::assertSame('45000', $error->getCode());
        }
        self::assertSame($before, $this->balances());
        self::assertNull($controller->diagnostics(7)['summary']);
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
    }

    public function testNpcProductionQueueIsFundedOnceUnderConcurrentHourlyRetries(): void
    {
        $now = 1800000000;
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0,credits=100000 WHERE id=7; "
            . "UPDATE colonies SET population=100,food=0,metal=10000,crystal=10000,deuterium=10000 WHERE id=11; "
            . "INSERT INTO buildings (colony_id,type,level) VALUES (11,'hydroponic_farm',0),(11,'solar_plant',10)");
        $state = json_decode(self::$db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=11')
            ->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
        $state['settled_at'] = $now;
        $state['classes']['colonist'] = 100;
        self::$db->prepare('UPDATE colony_economy_state SET settled_at=?,state_json=? WHERE colony_id=11')
            ->execute([$now, json_encode($state, JSON_THROW_ON_ERROR)]);
        $controller = new NpcStandingOrders(self::$db);
        $controller->bind(7, 11, 'subsistence', 10000000, false);
        $results = $this->race([
            ['action' => 'npc_decide', 'uid' => 7, 'now' => $now],
            ['action' => 'npc_decide', 'uid' => 7, 'now' => $now],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        $statuses = array_column(array_column($results, 'result'), 'status');
        sort($statuses);
        self::assertSame(['already_decided', 'decided'], $statuses);
        $summary = $controller->diagnostics(7)['summary'];
        self::assertSame('executed', $summary['production']['construction']['status']);
        self::assertSame('hydroponic_farm', $summary['production']['construction']['building']);
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM economy_construction_slots')->fetchColumn());
        self::assertSame(0, (int)self::$db->query(
            "SELECT level FROM buildings WHERE colony_id=11 AND type='hydroponic_farm'"
        )->fetchColumn());
        $cost = $summary['production']['construction']['cost'];
        $reserved = (int)self::$db->query(
            "SELECT COALESCE(SUM(quantity_initial),0) FROM economy_standing_orders WHERE colony_id=11 "
                . "AND good_type='metal' AND side='sell'"
        )->fetchColumn();
        self::assertSame(10000 - $cost['metal'] - $reserved, (int)self::$db->query(
            'SELECT metal FROM colonies WHERE id=11'
        )->fetchColumn());
        $same = $controller->decide(7, $now);
        self::assertSame('already_decided', $same['status']);
    }

    public function testNpcProductionUnexpectedFinalWriteRollsBackQueueAndLedgerInOuterSavepoint(): void
    {
        $now = 1800000000;
        self::$db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0,credits=100000 WHERE id=7; "
            . "UPDATE colonies SET population=100,food=0,metal=10000,crystal=10000,deuterium=10000 WHERE id=11; "
            . "INSERT INTO buildings (colony_id,type,level) VALUES (11,'hydroponic_farm',0),(11,'solar_plant',10)");
        $state = json_decode(self::$db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=11')
            ->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
        $state['settled_at'] = $now;
        $state['classes']['colonist'] = 100;
        self::$db->prepare('UPDATE colony_economy_state SET settled_at=?,state_json=? WHERE colony_id=11')
            ->execute([$now, json_encode($state, JSON_THROW_ON_ERROR)]);
        $controller = new NpcStandingOrders(self::$db);
        $controller->bind(7, 11, 'agriculture', 10000000, false);
        self::$db->exec("CREATE TRIGGER standing_reject_write BEFORE UPDATE ON economy_npc_profiles "
            . "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='production final write fixture'");
        self::$db->beginTransaction();
        self::$db->exec('UPDATE users SET credits=credits+1 WHERE id=8');
        try {
            $controller->decide(7, $now);
            self::fail('Unexpected persistence failure must escape the actor savepoint.');
        } catch (PDOException $error) {
            self::assertSame('45000', $error->getCode());
        }
        self::assertTrue(self::$db->inTransaction());
        self::assertSame(101.0, (float)self::$db->query('SELECT credits FROM users WHERE id=8')->fetchColumn());
        self::assertSame(10000.0, (float)self::$db->query('SELECT metal FROM colonies WHERE id=11')->fetchColumn());
        foreach (['building_upgrade_queue', 'economy_construction_slots', 'colony_building_slots',
            'economy_standing_orders'] as $table) {
            self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
        }
        self::assertNull($controller->diagnostics(7)['summary']);
        self::$db->rollBack();
        self::$db->exec('DROP TRIGGER standing_reject_write');
        self::assertSame('executed', $controller->decide(7, $now)['production']['construction']['status']);
    }

    public function testSevenDayAutonomousExchangeUsesMigratedMySqlLedger(): void
    {
        $start = 1800000000;
        // All capital and inventories are finite, one-time fixture endowments.
        self::$db->exec(<<<'SQL'
            UPDATE users SET control_type='npc_engine',auth_enabled=0,credits=100000 WHERE id IN (7,8);
            UPDATE colonies SET population=100,metal=0,crystal=0,deuterium=0,rare_earth=0,food=8 WHERE id IN (11,12);
            UPDATE colonies SET metal=1000 WHERE id=12;
            UPDATE economy_processed_goods SET quantity=0 WHERE colony_id=12;
            UPDATE buildings SET level=1 WHERE colony_id=11 AND type='metallurgy';
            UPDATE buildings SET level=1 WHERE colony_id=12 AND type='consumer_factory';
            INSERT INTO buildings (colony_id,type,level) VALUES
                (11,'solar_plant',10),(12,'solar_plant',10),(12,'metal_mine',1);
            INSERT INTO research (user_id,type,level) VALUES (7,'energy_tech',1),(8,'computer_tech',1);
            UPDATE economy_policies SET tax_income=0,tax_trade=0,tax_production=0 WHERE user_id IN (7,8);
            UPDATE npc_traders SET capital_credits=100000,max_fleets=4 WHERE id=1;
            INSERT INTO users (id,username,email,password_hash,credits,control_type,auth_enabled)
                VALUES (9,'human-scenario','human-scenario@example.invalid','fixture',100000,'human',1);
            INSERT INTO star_systems (galaxy_index,system_index,x_ly) VALUES (1,3,200);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
                VALUES (13,'scenario-human',1,3,1,'planet','Human');
            INSERT INTO colonies (id,user_id,body_id,population,metal,food) VALUES (13,9,13,0,1000,1000);
            SQL);
        foreach ([11, 12] as $cid) {
            $query = self::$db->prepare('SELECT state_json FROM colony_economy_state WHERE colony_id=?');
            $query->execute([$cid]);
            $state = json_decode($query->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
            $state['settled_at'] = $start;
            self::$db->prepare('UPDATE colony_economy_state SET settled_at=?,state_json=? WHERE colony_id=?')
                ->execute([$start, json_encode($state, JSON_THROW_ON_ERROR), $cid]);
        }
        $policy = new NpcStandingOrders(self::$db);
        $policy->bind(7, 11, 'industry', 100000, false);
        $policy->bind(8, 12, 'industry', 100000, false);
        $requests = new EconomicRequests(self::$db);
        $money = static fn(): float => (float)self::$db->query(
            'SELECT (SELECT SUM(credits) FROM users)+(SELECT SUM(capital_credits) FROM npc_traders)'
            . '+(SELECT COALESCE(SUM(escrow_cents),0)/100 FROM economy_standing_orders)'
            . '+(SELECT COALESCE(SUM(buyer_escrow_cents),0)/100 FROM trader_routes)'
        )->fetchColumn();
        $initial = $money();
        $human = self::$db->query('SELECT metal,food,population FROM colonies WHERE id=13')->fetch();
        for ($hour = 0; $hour <= 168; $hour++) {
            $now = $start + $hour * 3600;
            foreach ([7, 8] as $uid) {
                self::assertSame('decided', $policy->decide($uid, $now)['status']);
                self::assertSame('already_decided', $policy->decide($uid, $now)['status']);
            }
            $requests->tick($now);
            process_route_transitions(self::$db, $now);
            execute_trader_strategy(self::$db, ['id' => 1, 'specialization' => '']);
            process_route_transitions(self::$db, $now);
            self::assertEqualsWithDelta($initial, $money(), 0.02);
        }
        $goods = self::$db->query("SELECT DISTINCT resource_type FROM trader_routes WHERE status='completed'")
            ->fetchAll(PDO::FETCH_COLUMN);
        self::assertContains('metal', $goods);
        self::assertContains('steel_alloy', $goods);
        self::assertSame($human, self::$db->query('SELECT metal,food,population FROM colonies WHERE id=13')->fetch());
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM colony_economy_state WHERE colony_id=13')->fetchColumn());
        self::assertSame(0, (int)self::$db->query(
            'SELECT COUNT(*) FROM economy_standing_orders WHERE quantity_remaining<0 OR escrow_cents<0 '
            . "OR (side='buy' AND escrow_cents<>quantity_remaining*limit_price_cents)"
        )->fetchColumn());
    }

    public function testConcurrentFiniteSellAndBuyReservationsFailAtomically(): void
    {
        $initial = $this->balances();
        foreach (['sell', 'buy'] as $side) {
            $results = $this->race([
                ['action' => 'create', 'uid' => 7, 'cid' => 11, 'side' => $side],
                ['action' => 'create', 'uid' => 7, 'cid' => 11, 'side' => $side],
            ]);
            self::assertSame(['committed', 'rejected'], $this->statuses($results));
            self::assertSame([409], array_values(array_column(array_filter($results,
                static fn(array $r): bool => $r['status'] === 'rejected'), 'code')));
            self::assertSame($initial, $this->balances());
        }
        self::assertSame(20.0, $this->stock(11));
        self::assertSame('20.0000', self::$db->query('SELECT credits FROM users WHERE id=7')->fetchColumn());
        self::assertSame(2, (int)self::$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
    }

    public function testCancellationCompetesWithAcquisitionAndRefundsOnlyFreeCommitment(): void
    {
        $route = $this->route(1, 20, 40);
        $initial = $this->balances();
        $results = $this->race([
            ['action' => 'route', 'id' => $route['id']],
            ['action' => 'cancel', 'uid' => 8, 'id' => $route['target_order_id']],
        ]);
        self::assertSame(['committed', 'committed'], $this->statuses($results));
        self::assertSame($initial, $this->balances());
        $current = trader_route_read(self::$db, $route['id'], false);
        self::assertContains($current['status'], ['failed', 'in_transit']);
        if ($current['status'] === 'failed') {
            self::assertSame(0, (int)$current['buyer_escrow_cents']);
            self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        }
        // Deterministically exercise the acquisition-wins branch too.
        if ($current['status'] === 'failed') {
            (new StandingOrders(self::$db))->cancel(7, $route['source_order_id']);
            $route = $this->route(1, 20, 40);
            process_single_route_transition(self::$db, $route);
        }
        $orders = new StandingOrders(self::$db);
        $orders->cancel(7, $route['source_order_id']);
        $orders->cancel(8, $route['target_order_id']);
        $orders->cancel(8, $route['target_order_id']);
        self::assertSame(4000, (int)trader_route_read(self::$db, $route['id'], false)['buyer_escrow_cents']);
        self::assertSame($initial, $this->balances());
        $this->due($route['id']);
        process_single_route_transition(self::$db, $route);
        process_single_route_transition(self::$db, $route);
        self::assertSame(120.0, $this->stock(12));
        self::assertSame($initial, $this->balances());
        self::assertSame(1, (int)self::$db->query("SELECT COUNT(*) FROM trader_transactions WHERE transaction_type='sold'")->fetchColumn());
    }

    public function testSourceCancellationPreventsAcquisitionAndCrossOwnerReversePartialFillsSerialize(): void
    {
        $route = $this->route(1, 40);
        (new StandingOrders(self::$db))->cancel(7, $route['source_order_id']);
        $this->race([
            ['action' => 'route', 'id' => $route['id']], ['action' => 'route', 'id' => $route['id']],
        ]);
        self::assertSame('failed', trader_route_read(self::$db, $route['id'], false)['status']);
        (new StandingOrders(self::$db))->cancel(8, $route['target_order_id']);
        $route = $this->route(1, 30, 40);
        $second = $this->insertRoute(2, 30, 11, 12, $route['source_order_id'], $route['target_order_id']);
        $initial = $this->balances();
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $route['id']], ['action' => 'route', 'id' => $second],
        ])));
        self::assertSame(40.0, (float)self::$db->query('SELECT SUM(quantity_acquired) FROM trader_routes')->fetchColumn());
        self::assertSame($initial, $this->balances());
        $orders = new StandingOrders(self::$db);
        $sell = $orders->create(8, 12, 'sell', 'steel_alloy', 10, '1.00');
        $buy = $orders->create(7, 11, 'buy', 'steel_alloy', 10, '2.00');
        $reverse = $this->insertRoute(2, 10, 12, 11, $sell['id'], $buy['id']);
        $forward = $this->route(1, 10);
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $reverse], ['action' => 'route', 'id' => $forward['id']],
        ])));
        self::assertSame($initial, $this->balances());
        $sourceRace = $this->route(1, 4);
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'cancel', 'uid' => 7, 'id' => $sourceRace['source_order_id']],
            ['action' => 'route', 'id' => $sourceRace['id']],
        ])));
        self::assertContains(trader_route_read(self::$db, $sourceRace['id'], false)['status'], ['failed', 'in_transit']);
        self::assertSame($initial, $this->balances());
    }

    public function testDueCompletionsOrdinaryArrivalAndLedgerReceiptDeliverAndPayOnce(): void
    {
        self::$db->exec('UPDATE colonies SET user_id=7 WHERE id=12');
        $route = $this->route(1, 10);
        process_single_route_transition(self::$db, $route);
        $this->due($route['id']);
        $route = trader_route_read(self::$db, $route['id'], false);
        $initial = $this->balances();
        self::assertSame(['committed', 'committed', 'committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $route['id']], ['action' => 'route', 'id' => $route['id']],
            ['action' => 'arrival', 'id' => $route['fleet_id']], ['action' => 'receive'],
        ])));
        self::assertSame(113.0, $this->stock(12));
        self::assertSame($initial[0], $this->balances()[0]);
        self::assertSame($initial[1] + 3, $this->balances()[1]);
        self::assertSame(0, (int)self::$db->query('SELECT active_fleets FROM npc_traders WHERE id=1')->fetchColumn());
        $fleet = self::$db->query("SELECT cargo_payload FROM fleets WHERE mission='return'")->fetch();
        self::assertIsArray($fleet);
        self::assertSame([], json_decode($fleet['cargo_payload'], true, flags: JSON_THROW_ON_ERROR));
        $returnAt = strtotime(self::$db->query('SELECT return_time FROM fleets')->fetchColumn() . ' UTC');
        process_route_transitions(self::$db, $returnAt);
        process_route_transitions(self::$db, $returnAt);
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(1, (int)self::$db->query("SELECT COUNT(*) FROM trader_transactions WHERE transaction_type='sold'")->fetchColumn());
    }

    public function testLastOwnedCarrierBoundsPartialAcquisitionAndParticipantProjection(): void
    {
        self::$db->exec(<<<'SQL'
            DELETE FROM ships WHERE colony_id<>1001;
            UPDATE ships SET count=1 WHERE colony_id=1001;
            UPDATE users SET credits=10000 WHERE id=8;
            UPDATE npc_traders SET capital_credits=10000;
            UPDATE economy_processed_goods SET quantity=6001.1250 WHERE colony_id=11 AND good_type='steel_alloy';
            UPDATE economy_processed_goods SET quantity=10.3750 WHERE colony_id=12 AND good_type='steel_alloy';
            SQL);
        $orders = new StandingOrders(self::$db);
        $sell = $orders->create(7, 11, 'sell', 'steel_alloy', 6001, '0.13');
        $buy = $orders->create(8, 12, 'buy', 'steel_alloy', 6001, '0.29');
        $first = $this->insertRoute(1, 6001, 11, 12, $sell['id'], $buy['id']);
        $second = $this->insertRoute(2, 6001, 11, 12, $sell['id'], $buy['id']);
        $initial = $this->balances();
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $first], ['action' => 'route', 'id' => $second],
        ])));
        $routes = self::$db->query('SELECT id,status,quantity_acquired FROM trader_routes ORDER BY id')->fetchAll();
        self::assertSame(['failed', 'in_transit'], $this->statuses($routes));
        self::assertSame(5000.0, (float)self::$db->query('SELECT SUM(quantity_acquired) FROM trader_routes')->fetchColumn());
        self::assertSame(1001, $orders->read($sell['id'], 7)['quantity_remaining']);
        self::assertSame(29029, $orders->read($buy['id'], 8)['escrow_cents']);
        self::assertSame('0.1250', self::$db->query(
            "SELECT quantity FROM economy_processed_goods WHERE colony_id=11 AND good_type='steel_alloy'"
        )->fetchColumn());
        self::assertSame($initial, $this->balances());
        $fleet = self::$db->query('SELECT * FROM fleets')->fetch();
        self::assertSame(['small_cargo' => 1], json_decode($fleet['ships_json'], true, flags: JSON_THROW_ON_ERROR));
        self::assertSame(0, (int)self::$db->query('SELECT SUM(count) FROM ships')->fetchColumn());
        self::assertSame('10.3750', self::$db->query(
            "SELECT quantity FROM economy_processed_goods WHERE colony_id=12 AND good_type='steel_alloy'"
        )->fetchColumn());
        $projection = new TradeTransports(self::$db);
        foreach ([7, 8] as $uid) {
            self::assertCount(1, $projection->list($uid));
            self::assertSame('outbound', $projection->list($uid)[0]['phase']);
            self::assertSame(5000.0, $projection->list($uid)[0]['quantity']);
        }
        foreach ([10, 999] as $uid) {
            self::assertSame([], $projection->list($uid));
        }
        self::$db->exec("UPDATE fleets SET ships_json='{}'");
        self::assertSame([], $projection->list(7));
        self::$db->prepare('UPDATE fleets SET ships_json=?')->execute([$fleet['ships_json']]);
        $winner = (int)self::$db->query("SELECT id FROM trader_routes WHERE status='in_transit'")->fetchColumn();
        process_single_route_transition(self::$db, ['id' => $winner], strtotime($fleet['arrival_time'] . ' UTC'));
        self::assertSame('5010.3750', self::$db->query(
            "SELECT quantity FROM economy_processed_goods WHERE colony_id=12 AND good_type='steel_alloy'"
        )->fetchColumn());
        self::assertSame($initial, $this->balances());
        foreach ([7, 8] as $uid) {
            $return = $projection->list($uid);
            self::assertCount(1, $return);
            self::assertSame('return', $return[0]['phase']);
            self::assertSame(0.0, $return[0]['quantity']);
            self::assertNull($return[0]['good_type']);
            self::assertSame([100.0, 0.0, 0.0], $return[0]['origin']);
            self::assertSame([0.0, 0.0, 0.0], $return[0]['target']);
        }
        self::assertSame([], $projection->list(10));
        // Reapplying the append-only migration must preserve an active return.
        self::$db->exec(file_get_contents(self::$directory . '/migrate_trader_transport_return_v1.sql'));
        try {
            self::$runner->runRollback(1);
            self::fail('Rollback must not truncate the return mission or lose its ship.');
        } catch (\RuntimeException $error) {
            self::assertInstanceOf(PDOException::class, $error->getPrevious());
            self::assertSame('HY000', $error->getPrevious()->getCode());
        } finally {
            self::$db->exec('DROP TABLE IF EXISTS trader_transport_return_rollback_guard');
        }
        self::assertSame('return', self::$db->query('SELECT mission FROM fleets')->fetchColumn());
        $returnAt = strtotime(self::$db->query('SELECT return_time FROM fleets')->fetchColumn() . ' UTC');
        self::assertSame(['committed', 'committed', 'committed'], $this->statuses($this->race([
            ['action' => 'return', 'now' => $returnAt], ['action' => 'return', 'now' => $returnAt],
            ['action' => 'arrival', 'id' => (int)$fleet['id']],
        ])));
        self::assertSame(1, (int)self::$db->query('SELECT SUM(count) FROM ships')->fetchColumn());
        self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame([], $projection->list(7));
        self::assertSame($initial, $this->balances());
        self::assertSame(2, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
    }

    public function testAcquiredCargoDefersWithoutCarrierAndRetriesOnlyAfterRealReturn(): void
    {
        self::$db->exec('DELETE FROM ships WHERE colony_id<>1001');
        self::$db->exec('UPDATE ships SET count=1 WHERE colony_id=1001');
        self::$db->exec('UPDATE colonies SET user_id=10 WHERE id=11');
        self::$db->exec('INSERT INTO economy_policies (user_id,tax_income,tax_trade,tax_production) VALUES (10,0,0,0)');
        // Separate acquisition and departure emulate already-held cargo awaiting a tick.
        $routes = [$this->route(1, 10), $this->route(2, 10)];
        foreach ($routes as $route) {
            trader_route_transaction(self::$db, $route['id'], static function () use ($route): void {
                $trader = trader_trader_read(self::$db, (int)$route['trader_id'], false);
                $route['trader_user_id'] = $trader['user_id'];
                trader_route_lock_owners(self::$db, $route);
                trader_route_acquire(self::$db, trader_route_read(self::$db, $route['id'], true), $trader);
            });
        }
        $initial = $this->balances();
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $routes[0]['id'], 'outer' => true],
            ['action' => 'route', 'id' => $routes[1]['id'], 'outer' => true],
        ])));
        $waiting = trader_route_read(self::$db, (int)self::$db->query(
            "SELECT id FROM trader_routes WHERE status='acquiring'"
        )->fetchColumn(), false);
        self::assertSame(10.0, (float)$waiting['quantity_acquired']);
        self::assertSame(2000, (int)$waiting['buyer_escrow_cents']);
        self::assertNull($waiting['fleet_id']);
        self::assertSame(100.0, $this->stock(12));
        self::assertSame($initial, $this->balances());
        process_single_route_transition(self::$db, $waiting);
        self::assertSame('acquiring', trader_route_read(self::$db, $waiting['id'], false)['status']);
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(2, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        $outbound = trader_route_read(self::$db, (int)self::$db->query(
            "SELECT id FROM trader_routes WHERE status='in_transit'"
        )->fetchColumn(), false);
        $this->due($outbound['id']);
        self::assertSame(['committed', 'committed', 'committed'], $this->statuses($this->race([
            ['action' => 'route', 'id' => $outbound['id']], ['action' => 'route', 'id' => $outbound['id']],
            ['action' => 'arrival', 'id' => $outbound['fleet_id']],
        ])));
        self::assertSame(110.0, $this->stock(12));
        self::assertSame(0, (int)self::$db->query('SELECT SUM(count) FROM ships')->fetchColumn());
        process_single_route_transition(self::$db, $waiting);
        self::assertSame('acquiring', trader_route_read(self::$db, $waiting['id'], false)['status']);
        $returnAt = strtotime(self::$db->query('SELECT return_time FROM fleets')->fetchColumn() . ' UTC');
        self::assertSame(['committed', 'committed'], $this->statuses($this->race([
            ['action' => 'return', 'now' => $returnAt], ['action' => 'return', 'now' => $returnAt],
        ])));
        process_single_route_transition(self::$db, $waiting, $returnAt);
        $retry = trader_route_read(self::$db, $waiting['id'], false);
        self::assertSame('in_transit', $retry['status']);
        self::assertSame(0, (int)self::$db->query('SELECT SUM(count) FROM ships')->fetchColumn());
        self::assertSame(['small_cargo' => 1], json_decode(
            self::$db->query('SELECT ships_json FROM fleets')->fetchColumn(), true, flags: JSON_THROW_ON_ERROR
        ));
        self::assertSame(3, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        process_single_route_transition(self::$db, $retry, strtotime($retry['arrival_at'] . ' UTC'));
        $returnAt = strtotime(self::$db->query('SELECT return_time FROM fleets')->fetchColumn() . ' UTC');
        trader_return_transports(self::$db, $returnAt);
        trader_return_transports(self::$db, $returnAt);
        self::assertSame(1, (int)self::$db->query('SELECT SUM(count) FROM ships')->fetchColumn());
        self::assertSame(120.0, $this->stock(12));
        self::assertSame(4, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        self::assertSame($initial, $this->balances());
    }

    public function testDecimalPrimaryAndProcessedWritesPreserveFractionalStockAndExactCents(): void
    {
        self::$db->exec(<<<'SQL'
            UPDATE colonies SET metal=40.1234 WHERE id=11;
            UPDATE colonies SET metal=10.9876 WHERE id=12;
            UPDATE economy_processed_goods SET quantity=40.1234 WHERE colony_id=11 AND good_type='steel_alloy';
            UPDATE economy_processed_goods SET quantity=10.9876 WHERE colony_id=12 AND good_type='steel_alloy';
            SQL);
        $orders = new StandingOrders(self::$db);
        $initialMoney = $this->balances()[0];
        foreach (['metal', 'steel_alloy'] as $good) {
            $sell = $orders->create(7, 11, 'sell', $good, 3, '0.17');
            $buy = $orders->create(8, 12, 'buy', $good, 3, '0.31');
            $route = $this->insertRoute(1, 3, 11, 12, $sell['id'], $buy['id'], $good);
            process_single_route_transition(self::$db, ['id' => $route]);
            self::assertSame(93, (int)trader_route_read(self::$db, $route, false)['buyer_escrow_cents']);
            self::assertSame($initialMoney, $this->balances()[0]);
            $this->due($route);
            process_single_route_transition(self::$db, ['id' => $route]);
            process_single_route_transition(self::$db, ['id' => $route]);
            self::assertSame($initialMoney, $this->balances()[0]);
            self::assertSame(0, (int)trader_route_read(self::$db, $route, false)['buyer_escrow_cents']);
        }
        $economy = new OnDemandEconomy(self::$db);
        for ($i = 0; $i < 5; $i++) {
            $economy->receive(11, ['metal' => 0.0001, 'steel_alloy' => 0.0001]);
            $economy->spend(11, 7, ['metal' => 0.0001, 'steel_alloy' => 0.0001], static fn(): bool => true);
            $economy->settle(11, 7);
        }
        foreach (['metal', 'steel_alloy'] as $good) {
            $query = $good === 'metal' ? 'SELECT metal FROM colonies WHERE id=?'
                : "SELECT quantity FROM economy_processed_goods WHERE colony_id=? AND good_type='steel_alloy'";
            $statement = self::$db->prepare($query);
            $statement->execute([11]);
            self::assertSame('37.1234', $statement->fetchColumn());
            $statement->execute([12]);
            self::assertSame('13.9876', $statement->fetchColumn());
        }
        self::assertSame('101.0200', self::$db->query('SELECT credits FROM users WHERE id=7')->fetchColumn());
        self::assertSame('98.1400', self::$db->query('SELECT credits FROM users WHERE id=8')->fetchColumn());
        self::assertEquals(100.84, self::$db->query('SELECT capital_credits FROM npc_traders WHERE id=1')->fetchColumn());
        self::assertSame($initialMoney, $this->balances()[0]);
        self::assertSame(4, (int)self::$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
    }

    public function testOuterRepeatableReadSnapshotWaitCannotRespendProcessedStockOrStealOwnership(): void
    {
        $worker = $this->start(['action' => 'spend', 'outer' => true]);
        self::$db->beginTransaction();
        (new OnDemandEconomy(self::$db))->spend(11, 7, ['steel_alloy' => 80], static fn(): bool => true);
        $id = $this->go($worker);
        $this->waiting([$id], 'REPEATABLE READ');
        self::$db->commit();
        $result = $this->workerResult($worker);
        self::assertSame('rejected', $result['status'], json_encode($result));
        self::assertSame(409, $result['code']);
        self::assertSame(20.0, $this->stock(11));
        $worker = $this->start(['action' => 'spend', 'outer' => true]);
        self::$db->exec('UPDATE colonies SET user_id=8 WHERE id=11');
        $this->go($worker);
        self::assertSame('rejected', $this->workerResult($worker)['status']);
        self::assertSame(20.0, $this->stock(11));
    }

    public function testWriteFailureSavepointsAndMissingDestinationsKeepCargoAndEscrow(): void
    {
        $route = $this->route(1, 10);
        $initial = $this->balances();
        self::$db->exec(
            "CREATE TRIGGER standing_reject_write BEFORE INSERT ON trader_transactions FOR EACH ROW "
            . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced acquisition failure'"
        );
        try {
            process_single_route_transition(self::$db, $route);
            self::fail('Forced acquisition failure must roll back both order reservations.');
        } catch (PDOException $error) {
            self::assertSame('45000', $error->getCode());
            self::assertFalse(self::$db->inTransaction());
            self::assertSame('planning', trader_route_read(self::$db, $route['id'], false)['status']);
            self::assertSame(0, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
            self::assertSame(2000, (new StandingOrders(self::$db))->read($route['target_order_id'], 8)['escrow_cents']);
            self::assertSame($initial, $this->balances());
        } finally {
            self::$db->exec('DROP TRIGGER standing_reject_write');
        }
        process_single_route_transition(self::$db, $route);
        $this->due($route['id']);
        $initial = $this->balances();
        $snapshot = trader_route_read(self::$db, $route['id'], false);
        self::$db->exec(
            "CREATE TRIGGER standing_reject_write BEFORE INSERT ON trader_transactions FOR EACH ROW "
            . "BEGIN IF NEW.transaction_type='sold' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced write failure'; END IF; END"
        );
        self::$db->beginTransaction();
        self::$db->exec('UPDATE users SET credits=credits+1 WHERE id=10');
        try {
            process_single_route_transition(self::$db, $route);
            self::fail('Forced sale failure must escape the transaction.');
        } catch (PDOException $error) {
            self::assertSame('45000', $error->getCode());
            self::assertTrue(self::$db->inTransaction());
            self::assertSame(100.0, $this->stock(12));
            self::assertSame($snapshot['buyer_escrow_cents'], trader_route_read(self::$db, $route['id'], true)['buyer_escrow_cents']);
            self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        } finally {
            self::$db->rollBack();
            self::$db->exec('DROP TRIGGER standing_reject_write');
        }
        self::assertSame($initial, $this->balances());
        self::assertSame(1, (int)self::$db->query('SELECT active_fleets FROM npc_traders WHERE id=1')->fetchColumn());
        self::$db->exec('UPDATE colonies SET user_id=7 WHERE id=12');
        process_single_route_transition(self::$db, $route);
        self::assertSame('quarantined', trader_route_read(self::$db, $route['id'], false)['funding_status']);
        self::assertSame(100.0, $this->stock(12));
        self::assertSame($initial, $this->balances());
        self::$db->exec('UPDATE colonies SET user_id=8 WHERE id=12');
        self::$db->exec("UPDATE trader_routes SET funding_status='backed' WHERE id=" . $route['id']);
        self::$db->exec('SET FOREIGN_KEY_CHECKS=0');
        self::$db->exec('DELETE FROM economy_standing_orders WHERE id=' . $route['target_order_id']);
        self::$db->exec('SET FOREIGN_KEY_CHECKS=1');
        process_single_route_transition(self::$db, $route);
        self::assertSame('quarantined', trader_route_read(self::$db, $route['id'], false)['funding_status']);
        self::assertSame($snapshot['buyer_escrow_cents'], trader_route_read(self::$db, $route['id'], false)['buyer_escrow_cents']);
        self::$db->exec("UPDATE trader_routes SET funding_status='backed' WHERE id=" . $route['id']);
        // Simulate legacy/manual corruption, never permitted by the real FK lifecycle.
        self::$db->exec('SET FOREIGN_KEY_CHECKS=0');
        self::$db->exec('DELETE FROM colonies WHERE id=12');
        self::$db->exec('SET FOREIGN_KEY_CHECKS=1');
        process_single_route_transition(self::$db, $route);
        $current = trader_route_read(self::$db, $route['id'], false);
        self::assertSame('quarantined', $current['funding_status']);
        self::assertSame($snapshot['buyer_escrow_cents'], $current['buyer_escrow_cents']);
        self::assertSame(1, (int)self::$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
    }

    private function route(int $trader, int $quantity, ?int $orderQuantity = null): array
    {
        $orders = new StandingOrders(self::$db);
        $sourceOwner = (int)self::$db->query('SELECT user_id FROM colonies WHERE id=11')->fetchColumn();
        $targetOwner = (int)self::$db->query('SELECT user_id FROM colonies WHERE id=12')->fetchColumn();
        $sell = $orders->create($sourceOwner, 11, 'sell', 'steel_alloy', $orderQuantity ?? $quantity, '1.00');
        $buy = $orders->create($targetOwner, 12, 'buy', 'steel_alloy', $orderQuantity ?? $quantity, '2.00');
        return trader_route_read(self::$db,
            $this->insertRoute($trader, $quantity, 11, 12, $sell['id'], $buy['id']), false);
    }

    private function insertRoute(
        int $trader, int $quantity, int $source, int $target, int $sell, int $buy, string $good = 'steel_alloy'
    ): int
    {
        self::$db->prepare(
            'INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,quantity_planned,'
            . "source_order_id,target_order_id,funding_status) VALUES (?,?,?,?,?,?,?,'backed')"
        )->execute([$trader, $source, $target, $good, $quantity, $sell, $buy]);
        $id = (int)self::$db->lastInsertId();
        self::$db->exec('UPDATE npc_traders SET active_fleets=active_fleets+1 WHERE id=' . $trader);
        return $id;
    }

    private function due(int $route): void
    {
        self::$db->exec("UPDATE trader_routes SET arrival_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=$route");
        self::$db->exec(
            "UPDATE fleets SET arrival_time=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id="
            . (int)trader_route_read(self::$db, $route, false)['fleet_id']
        );
    }

    private function stock(int $cid): float
    {
        return (float)self::$db->query(
            "SELECT quantity FROM economy_processed_goods WHERE colony_id=$cid AND good_type='steel_alloy'"
        )->fetchColumn();
    }

    /** Exact cents plus physical stock, reservations and transit; population/factories are zero. */
    private function balances(): array
    {
        $money = self::$db->query(
            'SELECT (SELECT COALESCE(SUM(credits*100),0) FROM users)'
            . '+(SELECT COALESCE(SUM(capital_credits*100),0) FROM npc_traders)'
            . '+(SELECT COALESCE(SUM(escrow_cents),0) FROM economy_standing_orders)'
            . '+(SELECT COALESCE(SUM(buyer_escrow_cents),0) FROM trader_routes)'
        )->fetchColumn();
        $goods = self::$db->query(
            "SELECT (SELECT COALESCE(SUM(quantity),0) FROM economy_processed_goods WHERE good_type='steel_alloy')"
            . "+(SELECT COALESCE(SUM(quantity_remaining),0) FROM economy_standing_orders WHERE side='sell')"
            . "+(SELECT COALESCE(SUM(quantity_acquired),0) FROM trader_routes WHERE status IN ('acquiring','in_transit'))"
        )->fetchColumn();
        return [(int)$money, (float)$goods];
    }

    private function assertConstraint(string $sql, string $state = '23000'): void
    {
        try {
            self::$db->exec($sql);
            self::fail('Expected a constraint rejection: ' . $sql);
        } catch (PDOException $error) {
            self::assertSame($state, $error->getCode());
        }
    }

    private function start(array $arguments): int
    {
        $arguments['database'] = self::$database;
        $process = proc_open([PHP_BINARY, __DIR__ . '/standing_orders_mysql_worker.php',
            json_encode($arguments, JSON_THROW_ON_ERROR)], [
                0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w'],
            ], $pipes, dirname(__DIR__, 2), array_merge(getenv(), ['XDEBUG_MODE' => 'off']));
        self::assertIsResource($process);
        foreach ([1, 2] as $index) {
            stream_set_timeout($pipes[$index], 15);
        }
        $this->workers[] = ['process' => $process, 'pipes' => $pipes];
        self::assertSame("READY\n", fgets($pipes[1]));
        return array_key_last($this->workers);
    }

    private function go(int $worker): int
    {
        $pipes = $this->workers[$worker]['pipes'];
        fwrite($pipes[0], "GO\n");
        fflush($pipes[0]);
        $line = fgets($pipes[1]);
        self::assertStringStartsWith('STARTING:', $line);
        return (int)substr($line, 9);
    }

    private function waiting(array $connections, string $isolation = 'READ COMMITTED'): void
    {
        $deadline = microtime(true) + 5;
        do {
            $waiting = self::$db->query(
                'SELECT DISTINCT t.PROCESSLIST_ID FROM performance_schema.data_lock_waits w '
                . 'JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID'
            )->fetchAll(PDO::FETCH_COLUMN);
            if (array_diff($connections, array_map('intval', $waiting)) === []) {
                $levels = self::$db->query(
                    'SELECT trx_mysql_thread_id,trx_isolation_level FROM information_schema.innodb_trx'
                )->fetchAll(PDO::FETCH_KEY_PAIR);
                foreach ($connections as $connection) {
                    self::assertSame($isolation, $levels[$connection] ?? null);
                }
                return;
            }
            usleep(20000);
        } while (microtime(true) < $deadline);
        self::fail('Workers never reached the real InnoDB lock barrier: ' . json_encode($connections));
    }

    private function workerResult(int $worker): array
    {
        $pipes = $this->workers[$worker]['pipes'];
        $line = fgets($pipes[1]);
        self::assertIsString($line);
        $result = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        foreach ($pipes as $pipe) {
            fclose($pipe);
        }
        self::assertSame(0, proc_close($this->workers[$worker]['process']));
        unset($this->workers[$worker]);
        return $result;
    }

    private function race(array $arguments): array
    {
        $workers = array_map(fn(array $a): int => $this->start($a), $arguments);
        self::$db->beginTransaction();
        self::$db->query('SELECT id FROM users WHERE id IN (7,8) ORDER BY id FOR UPDATE')->fetchAll();
        $connections = [];
        foreach ($workers as $worker) {
            $connections[] = $this->go($worker);
        }
        // Ordinary arrival is excluded rather than blocked on a participant.
        foreach ($arguments as $index => $a) {
            if ($a['action'] !== 'arrival') {
                $this->waiting([$connections[$index]], ($a['outer'] ?? false) ? 'REPEATABLE READ' : 'READ COMMITTED');
            }
        }
        self::$db->commit();
        return array_map(fn(int $worker): array => $this->workerResult($worker), $workers);
    }

    private function statuses(array $results): array
    {
        $statuses = array_column($results, 'status');
        sort($statuses);
        return $statuses;
    }
}
