<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\FleetLaunch;

use DomainException;
use PDO;
use PDOException;
use PDOStatement;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

const ON_DEMAND_ECONOMY_ENABLED = 0;

// Isolate economy/queue/catalog/cache infrastructure, not the dispatch or ledger.
function update_colony_resources(PDO $db, int $colonyId): void
{
    $db->prepare('UPDATE colonies SET metal = metal + pending_metal, pending_metal = 0 WHERE id = ?')
        ->execute([$colonyId]);
}

function complete_ship_build_queue(PDO $db, int $colonyId): void
{
    $db->prepare('UPDATE ships SET count = count + 0 WHERE colony_id = ?')->execute([$colonyId]);
}

function ship_exists_runtime(string $type, PDO $db): bool
{
    return in_array($type, ['light_fighter', 'carrier'], true);
}

function ship_cargo(string $type): int
{
    return $type === 'carrier' ? 800 : 50;
}

function fleet_speed(array $ships): int
{
    return isset($ships['carrier']) ? 5000 : 12500;
}

function fleet_speed_ly_h(array $ships): float
{
    return fleet_speed($ships) * \FLEET_SPEED_FACTOR * \GAME_SPEED;
}

function lcg_value(): float
{
    return 0.5;
}

function error_log(string $message): bool
{
    FleetLaunchTest::$launchErrors[] = $message;
    return true;
}

function gq_cache_delete(string $type, array $params): void
{
    FleetLaunchTest::$cacheDeletes[] = [$type, $params];
}

function enqueue_dirty_user(PDO $db, int $userId, string $reason): void
{
    $db->prepare('INSERT INTO dirty_users (user_id, reason) VALUES (?, ?)')->execute([$userId, $reason]);
}

final class FleetLaunchTest extends TestCase
{
    public static array $cacheDeletes = [];
    public static array $launchErrors = [];

    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../lib/fleet_launch.php');
        self::assertIsString($source);
        $start = strpos($source, 'function launch_fleet_dispatch(');
        self::assertNotFalse($start);
        // Execute repository functions in this isolated infrastructure namespace.
        eval('namespace ' . __NAMESPACE__ . '; use PDO; use DomainException; '
            . 'use GalaxyQuest\\Combat\\FleetDispatchReceipt; '
            . 'use GalaxyQuest\\Economy\\ResourceLedger; use GalaxyQuest\\Economy\\OnDemandEconomy; '
            . str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../lib'), true), substr($source, $start)));
        eval('namespace GalaxyQuest\\Tests\\Integration\\FleetLaunchOnDemand; use PDO; use DomainException; '
            . 'use GalaxyQuest\\Combat\\FleetDispatchReceipt; '
            . 'use GalaxyQuest\\Economy\\ResourceLedger; use GalaxyQuest\\Economy\\OnDemandEconomy; '
            . str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../lib'), true), substr($source, $start)));
        $engine = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($engine);
        $start = strpos($engine, 'function launch_fleet_for_user(');
        $end = strpos($engine, "\nfunction ", $start + 1);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        eval('namespace ' . __NAMESPACE__ . '; use PDO; use PDOException; use DomainException; '
            . str_replace(
                '__DIR__',
                var_export(realpath(__DIR__ . '/../../api'), true),
                substr($engine, $start, $end - $start)
            ));
    }

    protected function setUp(): void
    {
        self::$cacheDeletes = [];
        self::$launchErrors = [];
    }

    private function database(string $drive = 'aereth', string $control = 'human'): PDO
    {
        $db = new class ('sqlite::memory:') extends PDO {
            public function prepare(string $query, array $options = []): PDOStatement|false
            {
                if (str_contains($query, 'information_schema.COLUMNS')) {
                    return parent::prepare(
                        'SELECT name AS COLUMN_NAME, type AS COLUMN_TYPE FROM pragma_table_info(?)',
                        $options
                    );
                }
                $query = str_replace(
                    ['DATE_ADD(NOW(), INTERVAL ? SECOND)', 'DATE_ADD(NOW(), INTERVAL 30 MINUTE)',
                        'DATE_ADD(NOW(), INTERVAL 15 MINUTE)', 'OR ? = 1'],
                    ["datetime(NOW(), '+' || ? || ' seconds')", "datetime(NOW(), '+30 minutes')",
                        "datetime(NOW(), '+15 minutes')", 'OR CAST(? AS INTEGER) = 1'],
                    $query
                );
                return parent::prepare($query, $options);
            }
        };
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'), 0);
        $db->sqliteCreateFunction('GREATEST', static fn($a, $b) => max($a, $b), 2);
        $db->sqliteCreateFunction('SQRT', static fn($value) => sqrt($value), 1);
        $db->sqliteCreateFunction('POW', static fn($a, $b) => pow($a, $b), 2);
        $db->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, control_type TEXT, pvp_mode INTEGER,
                protection_until TEXT, ftl_drive_type TEXT, ftl_cooldown_until TEXT);
            INSERT INTO users VALUES (10,"human",1,NULL,"aereth",NULL),(20,"human",1,NULL,"aereth",NULL);
            CREATE TABLE celestial_bodies (id INTEGER PRIMARY KEY, galaxy_index INTEGER,
                system_index INTEGER, position INTEGER);
            INSERT INTO celestial_bodies VALUES (1,1,1,1),(2,1,2,1);
            CREATE TABLE colonies (id INTEGER PRIMARY KEY, user_id INTEGER, body_id INTEGER,
                metal REAL, crystal REAL, deuterium REAL, rare_earth REAL, food REAL, pending_metal REAL);
            INSERT INTO colonies VALUES (1,10,1,1000,1000,1000,0,0,0),(2,20,2,0,0,0,0,0,0);
            CREATE TABLE ships (colony_id INTEGER, type TEXT, count INTEGER, UNIQUE(colony_id,type));
            INSERT INTO ships VALUES (1,"light_fighter",100),(1,"carrier",10);
            CREATE TABLE star_systems (galaxy_index INTEGER, system_index INTEGER, x_ly REAL, y_ly REAL, z_ly REAL);
            INSERT INTO star_systems VALUES (1,1,0,0,0),(1,2,20,0,0);
            CREATE TABLE leaders (colony_id INTEGER, role TEXT, autonomy INTEGER, skill_navigation INTEGER);
            INSERT INTO leaders VALUES (1,"fleet_commander",1,5);
            CREATE TABLE research (user_id INTEGER, type TEXT, level INTEGER);
            CREATE TABLE ftl_gates (id INTEGER PRIMARY KEY, owner_user_id INTEGER, is_active INTEGER,
                health INTEGER, galaxy_a INTEGER, system_a INTEGER, galaxy_b INTEGER, system_b INTEGER);
            CREATE TABLE ftl_resonance_nodes (id INTEGER PRIMARY KEY, owner_user_id INTEGER,
                galaxy INTEGER, "system" INTEGER, cooldown_until TEXT);
            CREATE TABLE wormholes (id INTEGER PRIMARY KEY, endpoint_a_galaxy INTEGER,
                endpoint_a_system INTEGER, endpoint_b_galaxy INTEGER, endpoint_b_system INTEGER,
                stability INTEGER, cooldown_until TEXT, is_active INTEGER, is_permanent INTEGER,
                label TEXT, created_at TEXT);
            CREATE TABLE user_wormhole_unlocks (user_id INTEGER, source_quest_code TEXT, unlocked_at TEXT);
            CREATE TABLE dirty_users (user_id INTEGER, reason TEXT);
            CREATE TABLE fleet_dispatch_receipts (user_id INTEGER, request_id TEXT, payload_hash TEXT,
                fleet_id INTEGER, arrival_time TEXT, PRIMARY KEY(user_id,request_id));
            CREATE TABLE fleets (id INTEGER PRIMARY KEY, user_id INTEGER, origin_colony_id INTEGER,
                target_galaxy INTEGER, target_system INTEGER, target_position INTEGER, mission TEXT,
                ships_json TEXT, cargo_metal REAL, cargo_crystal REAL, cargo_deuterium REAL,
                origin_x_ly REAL, origin_y_ly REAL, origin_z_ly REAL,
                origin_radius_ly REAL, origin_theta_rad REAL, origin_height_ly REAL,
                target_x_ly REAL, target_y_ly REAL, target_z_ly REAL,
                target_radius_ly REAL, target_theta_rad REAL, target_height_ly REAL,
                speed_ly_h REAL, distance_ly REAL, departure_time TEXT, arrival_time TEXT, return_time TEXT,
                stealth_until TEXT, hull_damage_pct INTEGER)');
        $db->prepare('UPDATE users SET ftl_drive_type = ?, control_type = ? WHERE id = 10')
            ->execute([$drive, $control]);
        return $db;
    }

    private function request(array $overrides = []): array
    {
        return array_replace([
            'origin_colony_id' => 1, 'target_galaxy' => 1, 'target_system' => 2, 'target_position' => 1,
            'mission' => 'attack', 'ships' => ['light_fighter' => 40], 'cargo' => ['metal' => 100],
        ], $overrides);
    }

    #[DataProvider('actorPairs')]
    public function testEveryActorPairUsesTheSameLaunchAndConservesInventory(string $attacker, string $defender): void
    {
        $db = $this->database(control: $attacker);
        $db->prepare('UPDATE users SET control_type = ? WHERE id = 20')->execute([$defender]);
        $result = launch_fleet_dispatch($db, 10, $this->request());
        self::assertSame(['fleet_id', 'arrival_time'], array_keys($result));
        self::assertSame(1, $result['fleet_id']);
        $fleet = $db->query('SELECT * FROM fleets')->fetch(PDO::FETCH_ASSOC);
        self::assertSame($result['arrival_time'], $fleet['arrival_time']);
        self::assertSame(['light_fighter' => 40], json_decode($fleet['ships_json'], true));
        self::assertSame(60, (int)$db->query('SELECT count FROM ships WHERE type = "light_fighter"')->fetchColumn());
        self::assertSame(900.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertSame(100.0, (float)$fleet['cargo_metal']);
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
        self::assertSame(
            [['shipyard_list', ['uid' => 10, 'cid' => 1]], ['game_overview', ['uid' => 10]]],
            self::$cacheDeletes
        );
        $expectedSpeed = \leader_fleet_speed(fleet_speed_ly_h(['light_fighter' => 40]), 5) * 1.5;
        self::assertSame($expectedSpeed, (float)$fleet['speed_ly_h']);
        self::assertSame(
            \fleet_travel_time_3d(20, $expectedSpeed),
            strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])
        );
        self::assertFalse($db->inTransaction());
    }

    public static function actorPairs(): array
    {
        return [['human', 'human'], ['human', 'npc_engine'], ['npc_engine', 'human'], ['npc_engine', 'npc_engine']];
    }

    #[DataProvider('blockedAttacks')]
    public function testProtectedOrNonPvpHumanTargetsCannotBeBypassed(
        string $control,
        string $change,
        string $message
    ): void {
        $db = $this->database(control: $control);
        $db->exec($change);
        try {
            launch_fleet_dispatch($db, 10, $this->request());
            self::fail('Expected launch rejection.');
        } catch (DomainException $error) {
            self::assertSame($message, $error->getMessage());
        }
        $this->assertNoLaunch($db);
    }

    public static function blockedAttacks(): array
    {
        $cases = [];
        foreach (['human', 'npc_engine'] as $control) {
            $cases[] = [$control, 'UPDATE users SET pvp_mode = 0 WHERE id = 10',
                'Enable PvP mode to attack other players.'];
            $cases[] = [$control, 'UPDATE users SET pvp_mode = 0 WHERE id = 20',
                'Target player has PvP disabled.'];
            $cases[] = [$control, 'UPDATE users SET protection_until = "2099-01-01" WHERE id = 10',
                'You are under newbie protection and cannot launch attacks.'];
            $cases[] = [$control, 'UPDATE users SET protection_until = "2099-01-01" WHERE id = 20',
                'Target player is under newbie protection.'];
        }
        return $cases;
    }

    #[DataProvider('drives')]
    public function testFactionTransitIsAppliedToHumanAndNpcLaunches(string $drive, string $control): void
    {
        $db = $this->database($drive, $control);
        $db->exec('INSERT INTO ftl_gates VALUES (1,10,1,100,1,1,1,2);
            INSERT INTO ftl_resonance_nodes VALUES (1,10,1,2,NULL)');
        launch_fleet_dispatch($db, 10, $this->request());
        $fleet = $db->query('SELECT * FROM fleets')->fetch(PDO::FETCH_ASSOC);
        $travel = strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time']);
        if ($drive === 'vor_tak' || $drive === 'vel_ar') {
            self::assertSame(30, $travel);
        } elseif ($drive === 'syl_nar') {
            self::assertSame(10, $travel);
        } elseif ($drive === 'zhareen') {
            self::assertSame(60, $travel);
        } else {
            $base = \fleet_travel_time_3d(20, \leader_fleet_speed(fleet_speed_ly_h(['light_fighter' => 40]), 5));
            self::assertSame(max(30, (int)round($base * 1.39)), $travel);
            self::assertSame(10, (int)$fleet['hull_damage_pct']);
        }
        if ($drive === 'vel_ar') {
            self::assertSame(60, strtotime($fleet['stealth_until']) - strtotime($fleet['arrival_time']));
        }
        if ($drive === 'vor_tak') {
            $cooldown = $db->query('SELECT ftl_cooldown_until FROM users WHERE id = 10')->fetchColumn();
            self::assertGreaterThan(time(), strtotime($cooldown));
            $this->expectException(DomainException::class);
            launch_fleet_dispatch($db, 10, $this->request());
        }
        if ($drive === 'zhareen') {
            self::assertGreaterThan(
                time(),
                strtotime($db->query('SELECT cooldown_until FROM ftl_resonance_nodes')->fetchColumn())
            );
        }
    }

    public static function drives(): array
    {
        $cases = [];
        foreach (['vor_tak', 'syl_nar', 'vel_ar', 'zhareen', 'kryl_tha'] as $drive) {
            foreach (['human', 'npc_engine'] as $control) {
                $cases[] = [$drive, $control];
            }
        }
        return $cases;
    }

    public function testVorTakCarrierCapacityAndFreshResourceSettlementAreShared(): void
    {
        $db = $this->database('vor_tak', 'npc_engine');
        $db->exec('UPDATE colonies SET metal = 0, pending_metal = 1040 WHERE id = 1');
        launch_fleet_dispatch($db, 10, $this->request(['ships' => ['carrier' => 1], 'cargo' => ['metal' => 1040]]));
        self::assertSame(0.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertSame(1040.0, (float)$db->query('SELECT cargo_metal FROM fleets')->fetchColumn());
    }

    public function testKeyedReplayBypassesSpentInventoryAndCooldownWithoutRepeatingMutation(): void
    {
        $db = $this->database('vor_tak');
        $request = $this->request(['request_id' => 'stable-fleet-request-1']);
        $result = launch_fleet_dispatch($db, 10, $request);
        $writes = $db->query('SELECT total_changes()')->fetchColumn();
        self::assertSame($result, launch_fleet_dispatch($db, 10, array_reverse($request, true)));
        self::assertSame($writes, $db->query('SELECT total_changes()')->fetchColumn());
        self::assertSame(60, (int)$db->query('SELECT count FROM ships WHERE type="light_fighter"')->fetchColumn());
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
    }

    public function testInternalAdapterReusesExplicitNpcOrderIdentity(): void
    {
        $db = $this->database('vor_tak', 'npc_engine');
        for ($attempt = 0; $attempt < 2; $attempt++) {
            self::assertTrue(launch_fleet_for_user(
                $db,
                10,
                1,
                1,
                2,
                1,
                'attack',
                ['light_fighter' => 40],
                [],
                'npc-order-decision-123'
            ));
        }
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
    }

    public function testSameKeyIsIsolatedByUserButConflictsAcrossDifferentOwnedOrigins(): void
    {
        $db = $this->database();
        $request = $this->request(['request_id' => 'user-scoped-request-1']);
        launch_fleet_dispatch($db, 10, $request);
        $db->exec('INSERT INTO colonies VALUES (3,10,1,1000,1000,1000,0,0,0);
            INSERT INTO ships VALUES (3,"light_fighter",100),(2,"light_fighter",100)');
        try {
            launch_fleet_dispatch($db, 10, array_replace($request, ['origin_colony_id' => 3]));
            self::fail('The same user key cannot refer to another colony.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        launch_fleet_dispatch($db, 20, array_replace($request, ['origin_colony_id' => 2, 'cargo' => []]));
        self::assertSame(2, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(2, (int)$db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
    }

    #[DataProvider('invalidRequestIds')]
    public function testInvalidRequestIdsFailBeforeAnyBooking(mixed $requestId): void
    {
        $db = $this->database();
        try {
            launch_fleet_dispatch($db, 10, $this->request(['request_id' => $requestId]));
            self::fail('Expected invalid request ID.');
        } catch (DomainException $error) {
            self::assertSame(400, $error->getCode());
        }
        $this->assertNoLaunch($db);
    }

    public static function invalidRequestIds(): array
    {
        return [[null], [1], [[]], ['short'], [str_repeat('a', 129)], ['invalid request id!']];
    }

    public function testReceiptWriteFailureAndOuterRollbackDoNotConsumeRequestIdentity(): void
    {
        $db = $this->database('vor_tak');
        $request = $this->request(['request_id' => 'rollback-fleet-request-1']);
        $db->exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON fleet_dispatch_receipts
            BEGIN SELECT RAISE(ABORT, 'receipt failure'); END");
        try {
            launch_fleet_dispatch($db, 10, $request);
            self::fail('Expected failed receipt insert.');
        } catch (PDOException $error) {
            self::assertStringContainsString('receipt failure', $error->getMessage());
        }
        $this->assertNoLaunch($db);
        $db->exec('DROP TRIGGER reject_receipt');
        $db->beginTransaction();
        launch_fleet_dispatch($db, 10, $request);
        $db->rollBack();
        self::$cacheDeletes = [];
        $this->assertNoLaunch($db);
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
        launch_fleet_dispatch($db, 10, $request);
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
    }

    public function testWormholeAvailabilityAndConsumptionUseTheSameAtomicPath(): void
    {
        $db = $this->database('syl_nar', 'npc_engine');
        $db->exec('INSERT INTO research VALUES (10,"wormhole_theory",5);
            INSERT INTO user_wormhole_unlocks VALUES (10,"test",NULL);
            INSERT INTO wormholes VALUES (1,1,1,1,2,20,NULL,1,1,"test",NULL)');
        launch_fleet_dispatch($db, 10, $this->request(['use_wormhole' => true]));
        $fleet = $db->query('SELECT * FROM fleets')->fetch(PDO::FETCH_ASSOC);
        self::assertSame(30, strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time']));
        self::assertSame(15, (int)$db->query('SELECT stability FROM wormholes')->fetchColumn());
        self::assertGreaterThan(
            time(),
            strtotime($db->query('SELECT cooldown_until FROM wormholes')->fetchColumn())
        );
        try {
            launch_fleet_dispatch($db, 10, $this->request(['use_wormhole' => true]));
            self::fail('Cooling wormhole must reject a second reservation.');
        } catch (DomainException $error) {
            self::assertStringContainsString('No active wormhole route', $error->getMessage());
        }
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(60, (int)$db->query('SELECT count FROM ships WHERE type = "light_fighter"')->fetchColumn());
    }

    public function testScatteredActualTargetCannotBypassHumanProtection(): void
    {
        $db = $this->database('vel_ar', 'npc_engine');
        $db->exec('UPDATE users SET control_type = "npc_engine" WHERE id = 20;
            INSERT INTO users VALUES (30,"human",1,"2099-01-01","aereth",NULL);
            INSERT INTO celestial_bodies VALUES (3,1,3,1);
            INSERT INTO colonies VALUES (3,30,3,0,0,0,0,0,0);
            INSERT INTO star_systems VALUES (1,3,19.9,0,0)');
        try {
            launch_fleet_dispatch($db, 10, $this->request());
            self::fail('The actual snapped target must also satisfy launch policy.');
        } catch (DomainException $error) {
            self::assertSame('Target player is under newbie protection.', $error->getMessage());
        }
        $this->assertNoLaunch($db);
    }

    public function testInternalAdapterLogsRejectionAndReturnsFalseWithoutBooking(): void
    {
        $db = $this->database(control: 'npc_engine');
        $db->exec('UPDATE users SET pvp_mode = 0 WHERE id = 20');
        self::assertFalse(launch_fleet_for_user($db, 10, 1, 1, 2, 1, 'attack', ['light_fighter' => 40], []));
        self::assertCount(1, self::$launchErrors);
        self::assertStringContainsString('reason=Target player has PvP disabled.', self::$launchErrors[0]);
        $this->assertNoLaunch($db);
    }

    public function testInternalAdapterSuccessUsesFactionTransitAndLeavesOuterTransactionOpen(): void
    {
        $db = $this->database('kryl_tha', 'npc_engine');
        $db->beginTransaction();
        self::assertTrue(launch_fleet_for_user($db, 10, 1, 1, 2, 1, 'attack', ['light_fighter' => 40], []));
        self::assertTrue($db->inTransaction());
        self::assertSame(10, (int)$db->query('SELECT hull_damage_pct FROM fleets')->fetchColumn());
        self::assertSame([], self::$launchErrors);
        $db->rollBack();
        self::assertSame(100, (int)$db->query('SELECT count FROM ships WHERE type = "light_fighter"')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
    }

    public function testTransportDoesNotBecomeSubjectToAttackProtectionRules(): void
    {
        $db = $this->database(control: 'npc_engine');
        $db->exec('UPDATE users SET pvp_mode = 0, protection_until = "2099-01-01"');
        self::assertTrue(launch_fleet_for_user(
            $db,
            10,
            1,
            1,
            2,
            1,
            'transport',
            ['light_fighter' => 40],
            ['metal' => 100]
        ));
        self::assertSame('transport', $db->query('SELECT mission FROM fleets')->fetchColumn());
        self::assertSame(900.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
    }

    public function testHumanAttackOnNpcKeepsLegacyTargetPolicyWithoutRequiringHumanPvp(): void
    {
        $db = $this->database();
        $db->exec('UPDATE users SET pvp_mode = 0 WHERE id = 10;
            UPDATE users SET control_type = "npc_engine", pvp_mode = 0 WHERE id = 20');
        launch_fleet_dispatch($db, 10, $this->request());
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
    }

    #[DataProvider('writeFailures')]
    public function testRealOnDemandEconomyAndDispatchRollbackTogether(string $failureTable): void
    {
        $db = $this->onDemandDatabase();
        $db->exec("CREATE TRIGGER reject_write BEFORE INSERT ON $failureTable
            BEGIN SELECT RAISE(ABORT, 'on-demand dispatch write failure'); END");
        try {
            \GalaxyQuest\Tests\Integration\FleetLaunchOnDemand\launch_fleet_dispatch(
                $db,
                1,
                $this->request(['request_id' => 'economy-fleet-request-1'])
            );
            self::fail('Expected failed dispatch.');
        } catch (PDOException $error) {
            self::assertStringContainsString('on-demand dispatch write failure', $error->getMessage());
        }
        self::assertSame(10000.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertSame(100, (int)$db->query('SELECT count FROM ships')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM economy_colony_market')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
        self::assertSame([], self::$cacheDeletes);
        self::assertFalse($db->inTransaction());
    }

    public function testRealOnDemandEconomyStockAndMarketMatchTheAcceptedFleetCargo(): void
    {
        $db = $this->onDemandDatabase();
        $result = \GalaxyQuest\Tests\Integration\FleetLaunchOnDemand\launch_fleet_dispatch(
            $db,
            1,
            $this->request(['request_id' => 'economy-fleet-request-1'])
        );
        self::assertSame(1, $result['fleet_id']);
        self::assertSame(9900.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertSame(100.0, (float)$db->query('SELECT cargo_metal FROM fleets')->fetchColumn());
        self::assertSame(60, (int)$db->query('SELECT count FROM ships')->fetchColumn());
        $state = json_decode($db->query('SELECT state_json FROM colony_economy_state')->fetchColumn(), true);
        self::assertSame(9900.0, (float)$state['stock']['metal']);
        self::assertSame(
            9900.0,
            (float)$db->query('SELECT quantity FROM economy_colony_market WHERE good_type = "metal"')->fetchColumn()
        );
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
        self::assertFalse($db->inTransaction());
        $writes = $db->query('SELECT total_changes()')->fetchColumn();
        self::assertSame($result, \GalaxyQuest\Tests\Integration\FleetLaunchOnDemand\launch_fleet_dispatch(
            $db,
            1,
            $this->request(['request_id' => 'economy-fleet-request-1'])
        ));
        self::assertSame($writes, $db->query('SELECT total_changes()')->fetchColumn());
    }

    private function onDemandDatabase(): PDO
    {
        $db = new PDO('sqlite::memory:', options: [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        // Reuse the canonical economy test schema instead of duplicating its many tables.
        $fixture = file_get_contents(__DIR__ . '/OnDemandEconomyTest.php');
        self::assertIsString($fixture);
        self::assertSame(1, preg_match("/<<<'SQL'\\R(.*?)\\R\\s*SQL\\);/s", $fixture, $match));
        $db->exec($match[1]);
        $db->exec('ALTER TABLE users ADD COLUMN pvp_mode INTEGER DEFAULT 1;
            ALTER TABLE users ADD COLUMN protection_until TEXT;
            ALTER TABLE users ADD COLUMN control_type TEXT DEFAULT "npc_engine";
            ALTER TABLE users ADD COLUMN ftl_drive_type TEXT DEFAULT "aereth";
            ALTER TABLE users ADD COLUMN ftl_cooldown_until TEXT;
            ALTER TABLE leaders ADD COLUMN skill_navigation INTEGER;
            INSERT INTO ships VALUES (1,"light_fighter",100)');
        $launchSchema = $this->database();
        foreach (
            $launchSchema->query(
                'SELECT sql FROM sqlite_master
                 WHERE name IN ("fleets","star_systems","dirty_users","fleet_dispatch_receipts")'
            )->fetchAll(PDO::FETCH_COLUMN) as $sql
        ) {
            $db->exec($sql);
        }
        $db->exec('INSERT INTO star_systems VALUES (1,1,0,0,0),(1,2,20,0,0)');
        return $db;
    }

    #[DataProvider('invalidRequests')]
    public function testRejectedRequestsLeaveNoPartialBooking(array $request, string $drive): void
    {
        $db = $this->database($drive);
        try {
            launch_fleet_dispatch($db, 10, $this->request($request));
            self::fail('Expected invalid request rejection.');
        } catch (DomainException $error) {
            self::assertNotSame('', $error->getMessage());
        }

        $this->assertNoLaunch($db);
    }

    public static function invalidRequests(): array
    {
        return [
            [['mission' => 'invalid'], 'aereth'], [['target_position' => 0], 'aereth'],
            [['origin_colony_id' => 2], 'aereth'], [['ships' => []], 'aereth'],
            [['ships' => ['light_fighter' => 101]], 'aereth'], [['ships' => 'bad'], 'aereth'],
            [['cargo' => ['metal' => INF]], 'aereth'], [['cargo' => ['metal' => 2001]], 'aereth'],
            [['ships' => ['light_fighter' => 51]], 'kryl_tha'],
            [[], 'syl_nar'], [[], 'zhareen'], [['use_wormhole' => true], 'aereth'],
        ];
    }

    #[DataProvider('writeFailures')]
    public function testWriteFailuresRollBackShipsResourcesCooldownAndDirtyQueue(string $table): void
    {
        $db = $this->database('vor_tak');
        $db->exec('UPDATE colonies SET pending_metal = 100 WHERE id = 1');
        $db->exec("CREATE TRIGGER reject_write BEFORE INSERT ON $table
            BEGIN SELECT RAISE(ABORT, 'injected dispatch write failure'); END");
        try {
            launch_fleet_dispatch($db, 10, $this->request());
            self::fail('Expected database failure.');
        } catch (PDOException $error) {
            self::assertStringContainsString('injected dispatch write failure', $error->getMessage());
        }
        $this->assertNoLaunch($db);
        self::assertSame(100.0, (float)$db->query('SELECT pending_metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertNull($db->query('SELECT ftl_cooldown_until FROM users WHERE id = 10')->fetchColumn());
    }

    public static function writeFailures(): array
    {
        return [['fleets'], ['dirty_users']];
    }

    public function testFailedNestedLaunchPreservesTheCallerTransaction(): void
    {
        $db = $this->database();
        $db->beginTransaction();
        $db->exec('UPDATE colonies SET crystal = 999 WHERE id = 1');
        try {
            launch_fleet_dispatch($db, 10, $this->request(['ships' => ['light_fighter' => 101]]));
            self::fail('Expected rejection.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
            self::assertTrue($db->inTransaction());
        }
        self::assertSame(999.0, (float)$db->query('SELECT crystal FROM colonies WHERE id = 1')->fetchColumn());
        $db->rollBack();
        $this->assertNoLaunch($db);
    }

    private function assertNoLaunch(PDO $db): void
    {
        self::assertSame(100, (int)$db->query('SELECT count FROM ships WHERE type = "light_fighter"')->fetchColumn());
        self::assertSame(1000.0, (float)$db->query('SELECT metal FROM colonies WHERE id = 1')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM dirty_users')->fetchColumn());
        self::assertSame([], self::$cacheDeletes);
        self::assertFalse($db->inTransaction());
    }
}

namespace GalaxyQuest\Tests\Integration\FleetLaunchOnDemand;

use GalaxyQuest\Economy\OnDemandEconomy;
use PDO;

const ON_DEMAND_ECONOMY_ENABLED = 1;

function update_colony_resources(PDO $db, int $colonyId): void
{
    (new OnDemandEconomy($db))->settle($colonyId);
}

function complete_ship_build_queue(PDO $db, int $colonyId): void
{
    \GalaxyQuest\Tests\Integration\FleetLaunch\complete_ship_build_queue($db, $colonyId);
}

function enqueue_dirty_user(PDO $db, int $userId, string $reason): void
{
    \GalaxyQuest\Tests\Integration\FleetLaunch\enqueue_dirty_user($db, $userId, $reason);
}

function gq_cache_delete(string $type, array $params): void
{
    \GalaxyQuest\Tests\Integration\FleetLaunch\gq_cache_delete($type, $params);
}
