<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

if (!defined('TRADERS_LIB_MODE')) {
    define('TRADERS_LIB_MODE', true);
}
require_once __DIR__ . '/../../api/traders.php';

final class TraderRouteLogisticsTest extends TestCase
{
    private PDO $db;

    public function testFractionalCapitalCannotBeRoundedUpToSpendableCents(): void
    {
        self::assertSame(199, \GalaxyQuest\Economy\StandingOrders::capitalCents(1.999));
        self::assertSame(199, \GalaxyQuest\Economy\StandingOrders::capitalCents('1.999'));
    }

    protected function setUp(): void
    {
        $this->db = self::createLedgerFixture();
    }

    /** Shared real SQLite ledger/route fixture for autonomous-colony regressions. */
    public static function createLedgerFixture(): PDO
    {
        $db = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $db->exec(<<<'SQL'
            CREATE TABLE users (id INTEGER PRIMARY KEY, credits REAL DEFAULT 100000);
            CREATE TABLE celestial_bodies (id INTEGER PRIMARY KEY, galaxy_index INTEGER, system_index INTEGER, position INTEGER);
            CREATE TABLE star_systems (galaxy_index INTEGER, system_index INTEGER, x_ly REAL, y_ly REAL, z_ly REAL);
            CREATE TABLE planets (
                id INTEGER PRIMARY KEY, temp_max INTEGER, richness_metal REAL, richness_crystal REAL,
                richness_deuterium REAL, richness_rare_earth REAL,
                deposit_metal REAL, deposit_crystal REAL, deposit_deuterium REAL, deposit_rare_earth REAL
            );
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY, user_id INTEGER, body_id INTEGER, planet_id INTEGER, name TEXT,
                colony_type TEXT DEFAULT 'balanced', metal REAL DEFAULT 10000, crystal REAL DEFAULT 10000,
                deuterium REAL DEFAULT 10000, rare_earth REAL DEFAULT 1000, food REAL DEFAULT 500,
                population INTEGER DEFAULT 100, max_population INTEGER DEFAULT 500, happiness INTEGER DEFAULT 80,
                public_services INTEGER DEFAULT 100, energy INTEGER DEFAULT 100, last_update TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE buildings (id INTEGER PRIMARY KEY, colony_id INTEGER, type TEXT, level INTEGER DEFAULT 0,
                upgrade_end TEXT, UNIQUE(colony_id,type));
            CREATE TABLE building_upgrade_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT, colony_id INTEGER, building_type TEXT, target_level INTEGER,
                cost_metal INTEGER, cost_crystal INTEGER, cost_deuterium INTEGER, duration_secs INTEGER,
                queued_at TEXT, started_at TEXT, eta TEXT, status TEXT
            );
            CREATE TABLE colony_building_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT, colony_id INTEGER, slot_x INTEGER, slot_y INTEGER,
                building_type TEXT, level INTEGER, UNIQUE(colony_id,slot_x,slot_y)
            );
            CREATE TABLE economy_construction_slots (queue_id INTEGER PRIMARY KEY, slot_id INTEGER, target_level INTEGER);
            CREATE TABLE economy_processed_goods (
                id INTEGER PRIMARY KEY, colony_id INTEGER, good_type TEXT, quantity REAL, capacity REAL,
                production_rate_per_hour REAL, consumption_rate_per_hour REAL, last_calculated_at TEXT,
                UNIQUE(colony_id,good_type)
            );
            CREATE TABLE economy_pop_classes (
                id INTEGER PRIMARY KEY, colony_id INTEGER, pop_class TEXT, count INTEGER,
                satisfaction_ticks INTEGER DEFAULT 0, shortage_ticks INTEGER DEFAULT 0,
                satisfaction_index REAL DEFAULT 50, employment_level REAL DEFAULT 80, UNIQUE(colony_id,pop_class)
            );
            CREATE TABLE economy_policies (
                user_id INTEGER PRIMARY KEY, global_policy TEXT DEFAULT 'free_market', tax_income REAL DEFAULT 0.15,
                tax_trade REAL DEFAULT 0.05, tax_production REAL DEFAULT 0, subsidy_agriculture INTEGER DEFAULT 0,
                subsidy_research INTEGER DEFAULT 0, subsidy_military INTEGER DEFAULT 0
            );
            CREATE TABLE economy_production_methods (colony_id INTEGER, building_type TEXT, method TEXT,
                UNIQUE(colony_id,building_type));
            CREATE TABLE colony_economy_state (colony_id INTEGER PRIMARY KEY, settled_at INTEGER, state_json TEXT);
            CREATE TABLE body_development (
                body_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, peak_population INTEGER NOT NULL,
                founded_count INTEGER NOT NULL, initialized_at INTEGER NOT NULL, observed_at INTEGER NOT NULL
            );
            CREATE TABLE economy_colony_market (
                colony_id INTEGER, good_type TEXT, galaxy_index INTEGER, system_index INTEGER,
                quantity REAL, production REAL, consumption REAL, settled_at INTEGER,
                PRIMARY KEY(colony_id,good_type)
            );
            CREATE TABLE economy_market_transactions (
                id INTEGER PRIMARY KEY, user_id INTEGER, colony_id INTEGER, good_type TEXT, direction TEXT,
                quantity REAL, price_per_unit REAL, total_credits REAL, trade_tax_rate REAL, net_credits REAL
            );
            CREATE TABLE research (user_id INTEGER, type TEXT, level INTEGER);
            CREATE TABLE leaders (colony_id INTEGER, role TEXT, autonomy INTEGER);
            CREATE TABLE colony_events (colony_id INTEGER, event_type TEXT, expires_at TEXT);
            CREATE TABLE ships (colony_id INTEGER, type TEXT, count INTEGER);
            CREATE TABLE world_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, event_type TEXT, scope_type TEXT,
                scope_id INTEGER, galaxy_index INTEGER, system_index INTEGER DEFAULT 0, good_key TEXT NOT NULL DEFAULT '',
                modifier_json TEXT, starts_at INTEGER, ends_at INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(window_id,event_type,scope_type,scope_id,good_key)
            );
            CREATE TABLE npc_traders (
                id INTEGER PRIMARY KEY, user_id INTEGER, capital_credits REAL, total_profit REAL DEFAULT 0,
                active_fleets INTEGER DEFAULT 0, max_fleets INTEGER DEFAULT 3
            );
            CREATE TABLE trader_routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, trader_id INTEGER, fleet_id INTEGER, source_colony_id INTEGER,
                target_colony_id INTEGER, resource_type TEXT, quantity_planned REAL, quantity_acquired REAL DEFAULT 0,
                quantity_delivered REAL DEFAULT 0, status TEXT, price_paid REAL DEFAULT 0, price_sold REAL DEFAULT 0,
                expected_profit REAL DEFAULT 0, actual_profit REAL, departure_at TEXT, arrival_at TEXT,
                delivered_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                source_order_id INTEGER, target_order_id INTEGER, buyer_escrow_cents INTEGER DEFAULT 0,
                funding_status TEXT DEFAULT 'legacy'
            );
            CREATE TABLE economy_standing_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,colony_id INTEGER,good_type TEXT,side TEXT,
                quantity_initial INTEGER,quantity_remaining INTEGER,limit_price_cents INTEGER,escrow_cents INTEGER,
                status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                paired_order_id INTEGER UNIQUE
            );
            CREATE TABLE trader_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, trader_id INTEGER, route_id INTEGER, transaction_type TEXT,
                resource_type TEXT, quantity REAL, price_per_unit REAL, total_credits REAL,
                source_colony_id INTEGER, target_colony_id INTEGER
            );
            CREATE TABLE fleets (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, origin_colony_id INTEGER,
                target_galaxy INTEGER, target_system INTEGER, target_position INTEGER, mission TEXT, ships_json TEXT,
                cargo_metal REAL DEFAULT 0, cargo_crystal REAL DEFAULT 0, cargo_deuterium REAL DEFAULT 0,
                cargo_payload TEXT, origin_x_ly REAL, origin_y_ly REAL, origin_z_ly REAL,
                target_x_ly REAL, target_y_ly REAL, target_z_ly REAL, speed_ly_h REAL, distance_ly REAL,
                departure_time TEXT, arrival_time TEXT, return_time TEXT
            );
            CREATE TABLE market_supply_demand (
                galaxy_index INTEGER, system_index INTEGER, resource_type TEXT, available_supply REAL,
                desired_demand REAL, consumption_per_hour REAL
            );
            INSERT INTO users (id) VALUES (1),(2),(10);
            INSERT INTO economy_policies (user_id,tax_income) VALUES (1,0),(2,0),(10,0);
            INSERT INTO celestial_bodies VALUES (1,1,1,1),(2,1,2,2);
            INSERT INTO star_systems VALUES (1,1,0,0,0),(1,2,100,0,0);
            INSERT INTO colonies (id,user_id,body_id,name,food,rare_earth) VALUES
                (1,1,1,'Origin',1000,1000),(2,2,2,'Destination',1000,1000);
            INSERT INTO npc_traders (id,user_id,capital_credits,active_fleets) VALUES (1,10,100000,1);
            SQL);
        return $db;
    }

    public function testPlanningAcquiresAndLaunchesInOnePassAndStaleReplayDoesNotDebitTwice(): void
    {
        $routeId = $this->createRoute('food', 'planning', 25);
        $beforeFood = $this->colonyStock(1, 'food');
        $beforeCapital = $this->traderCapital();

        process_route_transitions($this->db);

        $route = $this->route($routeId);
        self::assertSame('in_transit', $route['status']);
        self::assertGreaterThan(0, (int)$route['fleet_id']);
        self::assertNotEmpty($route['departure_at']);
        self::assertNotEmpty($route['arrival_at']);
        $fleet = $this->fleet((int)$route['fleet_id']);
        self::assertSame($route['arrival_at'], $fleet['arrival_time']);
        self::assertSame(
            max(30, (int)round((float)$fleet['distance_ly'] / NPC_TRADER_LOGISTICS_SPEED_LY_H * 3600)),
            strtotime($fleet['arrival_time']) - strtotime($fleet['departure_time'])
        );
        self::assertSame(25.0, $this->fleetCargo((int)$route['fleet_id'], 'food'));
        self::assertEqualsWithDelta($beforeFood, $this->colonyStock(1, 'food'), 0.01);
        self::assertLessThan($beforeCapital, $this->traderCapital());

        $capitalAfterAcquire = $this->traderCapital();
        $transactionsAfterAcquire = $this->transactionCount($routeId);
        process_single_route_transition($this->db, ['id' => $routeId, 'status' => 'planning']);
        self::assertSame($capitalAfterAcquire, $this->traderCapital());
        self::assertSame($transactionsAfterAcquire, $this->transactionCount($routeId));
        self::assertSame('in_transit', $this->route($routeId)['status']);
    }

    public function testDueRoutesDeliverAllCatalogCargoAndCompleteWithoutReplay(): void
    {
        $cases = array_map(
            static fn(string $good): array => [$good, 3],
            array_keys(\GalaxyQuest\Economy\ColonyEconomySimulation::PRICES)
        );
        $routeIds = [];
        $fleetIds = [];
        $scheduledArrivals = [];
        $before = [];
        foreach ($cases as [$good]) {
            $before[$good] = $this->colonyStock(2, $good);
        }
        foreach ($cases as [$good, $quantity]) {
            $routeId = $this->createDueRoute($good, $quantity, $fleetIds);
            $routeIds[] = $routeId;
            if ($good === 'rare_earth') {
                $fleetId = (int)$this->route($routeId)['fleet_id'];
                $scheduledArrivals[] = $this->fleet($fleetId)['arrival_time'];
                $this->db->prepare('UPDATE trader_routes SET arrival_at=NULL WHERE id=?')->execute([$routeId]);
            } else {
                $scheduledArrivals[] = $this->route($routeId)['arrival_at'];
            }
        }

        process_route_transitions($this->db);

        foreach ($cases as [$good, $quantity]) {
            self::assertEqualsWithDelta($before[$good] + $quantity, $this->colonyStock(2, $good), 0.001);
        }
        foreach ($routeIds as $routeId) {
            $route = $this->route($routeId);
            self::assertSame('completed', $route['status']);
            self::assertSame($scheduledArrivals[array_search($routeId, $routeIds, true)], $route['arrival_at']);
            self::assertNotEmpty($route['delivered_at']);
            self::assertSame(1, $this->transactionCountByType($routeId, 'sold'));
            self::assertSame(0, $this->fleetCountForRoute($routeId));
        }
        $capitalAfterDelivery = $this->traderCapital();
        $profitAfterDelivery = $this->traderProfit();
        $activeAfterDelivery = $this->traderActiveFleets();

        process_route_transitions($this->db);

        self::assertSame($capitalAfterDelivery, $this->traderCapital());
        self::assertSame($profitAfterDelivery, $this->traderProfit());
        self::assertSame($activeAfterDelivery, $this->traderActiveFleets());
        foreach ($cases as [$good, $quantity]) {
            self::assertEqualsWithDelta($before[$good] + $quantity, $this->colonyStock(2, $good), 0.001);
        }
    }

    public function testProcessedGoodsAreAcquiredThroughTheLedgerAndRemainIntactInCargo(): void
    {
        $routeId = $this->createRoute('steel_alloy', 'planning', 5);

        process_route_transitions($this->db);

        $route = $this->route($routeId);
        self::assertSame('in_transit', $route['status']);
        self::assertEqualsWithDelta(95, $this->colonyStock(1, 'steel_alloy'), 0.001);
        self::assertEqualsWithDelta(5, $this->fleetCargo((int)$route['fleet_id'], 'steel_alloy'), 0.001);
        $projection = $this->db->prepare(
            'SELECT quantity FROM economy_colony_market WHERE colony_id=1 AND good_type=?'
        );
        $projection->execute(['steel_alloy']);
        self::assertEqualsWithDelta(95, (float)$projection->fetchColumn(), 0.001);
    }

    public function testRouteWaitsForOnDemandCatchupWithoutTradingAgainstStaleStock(): void
    {
        $routeId = $this->createRoute('steel_alloy', 'planning', 5);
        $cursor = time() - 172800;
        $state = json_encode([
            'settled_at' => $cursor,
            'growth_remainder' => 0.0,
            'satisfaction' => 80.0,
            'progress' => [],
        ], JSON_THROW_ON_ERROR);
        $this->db->prepare(
            'UPDATE colony_economy_state SET settled_at=?,state_json=? WHERE colony_id=1'
        )->execute([$cursor, $state]);
        $beforeStock = $this->colonyStock(1, 'steel_alloy');
        $beforeCapital = $this->traderCapital();

        process_route_transitions($this->db);

        self::assertSame('planning', $this->route($routeId)['status']);
        self::assertSame($beforeStock, $this->colonyStock(1, 'steel_alloy'));
        self::assertSame($beforeCapital, $this->traderCapital());
        self::assertSame(0, $this->transactionCount($routeId));
        self::assertSame(100000.0, $this->credits(1));
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $route = $this->route($routeId);
        self::assertSame(5, $orders->read((int)$route['source_order_id'], 1)['quantity_remaining']);
        self::assertSame(7500, $orders->read((int)$route['target_order_id'], 2)['escrow_cents']);
        $settledAt = (int)$this->db->query(
            'SELECT settled_at FROM colony_economy_state WHERE colony_id=1'
        )->fetchColumn();
        self::assertGreaterThan($cursor, $settledAt);
        self::assertGreaterThanOrEqual(300, time() - $settledAt);
    }

    public function testFutureArrivalDoesNotDeliverOrChangeRoute(): void
    {
        $fleetIds = [];
        $routeId = $this->createDueRoute('food', 9, $fleetIds, date('Y-m-d H:i:s', time() + 3600));
        $beforeFood = $this->colonyStock(2, 'food');
        $beforeCapital = $this->traderCapital();

        process_route_transitions($this->db);

        self::assertSame('in_transit', $this->route($routeId)['status']);
        self::assertSame($beforeFood, $this->colonyStock(2, 'food'));
        self::assertSame($beforeCapital, $this->traderCapital());
        self::assertSame(0, $this->transactionCountByType($routeId, 'sold'));
    }

    public function testFailedFinancialWriteRollsBackRouteInventoryAndCapital(): void
    {
        $routeId = $this->createRoute('food', 'planning', 20);
        $beforeFood = $this->colonyStock(1, 'food');
        $beforeCapital = $this->traderCapital();
        $this->db->exec(
            "CREATE TRIGGER reject_trader_buy BEFORE INSERT ON trader_transactions "
            . "WHEN NEW.route_id = $routeId BEGIN SELECT RAISE(ABORT, 'forced write failure'); END"
        );

        try {
            process_route_transitions($this->db);
            self::fail('A failed audit insert must abort the route transition.');
        } catch (PDOException $error) {
            self::assertStringContainsString('forced write failure', $error->getMessage());
        }

        self::assertSame('planning', $this->route($routeId)['status']);
        self::assertSame($beforeFood, $this->colonyStock(1, 'food'));
        self::assertSame($beforeCapital, $this->traderCapital());
        self::assertSame(0, $this->transactionCount($routeId));
        self::assertSame(100000.0, $this->credits(1));
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $route = $this->route($routeId);
        self::assertSame(20, $orders->read((int)$route['source_order_id'], 1)['quantity_remaining']);
        self::assertSame(30000, $orders->read((int)$route['target_order_id'], 2)['escrow_cents']);
    }

    private function createRoute(string $good, string $status, float $quantity): int
    {
        if (!in_array($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRIMARY, true)) {
            $this->db->prepare(
                'INSERT INTO economy_processed_goods (colony_id,good_type,quantity,capacity) VALUES (1,?,?,5000) '
                . 'ON CONFLICT(colony_id,good_type) DO UPDATE SET quantity=excluded.quantity'
            )->execute([$good, 100]);
        }
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $sell = $orders->create(1, 1, 'sell', $good, $quantity, '10.00');
        $buy = $orders->create(2, 2, 'buy', $good, $quantity, '15.00');
        $this->db->prepare(
            'INSERT INTO trader_routes '
            . '(trader_id,source_colony_id,target_colony_id,resource_type,quantity_planned,status,'
            . 'source_order_id,target_order_id,funding_status) '
            . "VALUES (1,1,2,?,?,?, ?,?,'backed')"
        )->execute([$good, $quantity, $status, $sell['id'], $buy['id']]);
        return (int)$this->db->lastInsertId();
    }

    public function testEscrowReservationPartialFillCancellationAndConservation(): void
    {
        $routeId = $this->createRoute('food', 'planning', 20);
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $route = $this->route($routeId);
        self::assertEqualsWithDelta(980.0, $this->colonyStock(1, 'food'), 0.01);
        self::assertSame(99700.0, $this->credits(2));
        $money = $this->totalMoney();
        $this->db->prepare('UPDATE trader_routes SET quantity_planned=7 WHERE id=?')->execute([$routeId]);

        process_single_route_transition($this->db, ['id' => $routeId]);

        self::assertSame(100070.0, $this->credits(1));
        self::assertSame(99930.0, $this->traderCapital());
        self::assertSame(10500, (int)$this->route($routeId)['buyer_escrow_cents']);
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
        $orders->cancel(1, (int)$route['source_order_id']);
        $orders->cancel(2, (int)$route['target_order_id']);
        self::assertEqualsWithDelta(993.0, $this->colonyStock(1, 'food'), 0.01);
        self::assertSame(99895.0, $this->credits(2));
        $this->db->exec("UPDATE economy_policies SET global_policy='autarky' WHERE user_id=2");
        $orders->cancel(1, (int)$route['source_order_id']);
        $orders->cancel(2, (int)$route['target_order_id']);
        self::assertEqualsWithDelta(993.0, $this->colonyStock(1, 'food'), 0.01);
        self::assertSame(99895.0, $this->credits(2));
        $arrival = date('Y-m-d H:i:s', time() - 1);
        $this->db->prepare('UPDATE trader_routes SET arrival_at=? WHERE id=?')->execute([$arrival, $routeId]);
        process_single_route_transition($this->db, ['id' => $routeId]);
        self::assertSame('completed', $this->route($routeId)['status']);
        self::assertEqualsWithDelta(1007.0, $this->colonyStock(2, 'food'), 0.01);
        self::assertSame(100035.0, $this->traderCapital());
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
        process_single_route_transition($this->db, ['id' => $routeId]);
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
        self::assertEqualsWithDelta(1007.0, $this->colonyStock(2, 'food'), 0.01);
    }

    public function testOrdersFailAtomicallyForInsufficientFundsStockAndOwnership(): void
    {
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        foreach ([
            [1, 1, 'buy', 'metal', 100000, '10.00'],
            [1, 1, 'sell', 'food', 1001, '10.00'],
            [1, 2, 'sell', 'food', 1, '10.00'],
            [1, 1, 'buy', 'food', 1.5, '10.00'],
            [1, 1, 'buy', 'food', 1, '10.001'],
        ] as $arguments) {
            try {
                $orders->create(...$arguments);
                self::fail('Invalid order must be rejected.');
            } catch (DomainException) {
                self::assertSame(100000.0, $this->credits(1));
                self::assertSame(1000.0, $this->colonyStock(1, 'food'));
                self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
            }
        }
    }

    public function testReadIsPureAndNoConsentOrLegacyCargoIsNotAcquired(): void
    {
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        self::assertSame([], $orders->list(1, 1));
        self::assertFalse(execute_trader_strategy($this->db, ['id' => 1]));
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
        $this->db->exec(
            "INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,quantity_planned,status) "
            . "VALUES (1,1,2,'food',10,'planning'),(1,1,2,'food',10,'in_transit')"
        );
        process_route_transitions($this->db);
        self::assertSame('failed', $this->route(1)['status']);
        self::assertSame('quarantined', $this->route(2)['funding_status']);
        self::assertSame('in_transit', $this->route(2)['status']);
        self::assertSame(1000.0, $this->colonyStock(1, 'food'));
        self::assertSame(100000.0, $this->traderCapital());
        self::assertSame(0, $this->transactionCount(1));
    }

    public function testSameOwnerOrdersAndCompletionRollbackRetainEscrowAndCargo(): void
    {
        $this->db->exec('UPDATE colonies SET user_id=1 WHERE id=2');
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $sell = $orders->create(1, 1, 'sell', 'rare_earth', 4, '10.01');
        $buy = $orders->create(1, 2, 'buy', 'rare_earth', 4, '15.02');
        $this->db->prepare(
            'INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,quantity_planned,'
            . "status,source_order_id,target_order_id,funding_status) VALUES (1,1,2,'rare_earth',4,'planning',?,?,'backed')"
        )->execute([$sell['id'], $buy['id']]);
        $routeId = (int)$this->db->lastInsertId();
        $money = $this->totalMoney();
        process_single_route_transition($this->db, ['id' => $routeId]);
        $this->db->prepare('UPDATE trader_routes SET arrival_at=? WHERE id=?')
            ->execute([date('Y-m-d H:i:s', time() - 1), $routeId]);
        $this->db->exec(
            "CREATE TRIGGER reject_trader_sale BEFORE INSERT ON trader_transactions "
            . "WHEN NEW.transaction_type='sold' BEGIN SELECT RAISE(ABORT,'forced sale failure'); END"
        );
        try {
            process_single_route_transition($this->db, ['id' => $routeId]);
            self::fail('Sale audit failure must roll back delivery and payment.');
        } catch (PDOException) {
            self::assertSame('in_transit', $this->route($routeId)['status']);
            self::assertSame(6008, (int)$this->route($routeId)['buyer_escrow_cents']);
            self::assertSame(1000.0, $this->colonyStock(2, 'rare_earth'));
            self::assertSame(4.0, $this->fleetCargo((int)$this->route($routeId)['fleet_id'], 'rare_earth'));
            self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
        }

        $this->db->exec('DROP TRIGGER reject_trader_sale');
        process_single_route_transition($this->db, ['id' => $routeId]);
        self::assertSame(1004.0, $this->colonyStock(2, 'rare_earth'));
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
    }

    public function testGenerationBindsBackedOrdersAndCapacityLimitsAllocation(): void
    {
        $this->db->exec('UPDATE colonies SET food=20000 WHERE id=1');
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $sell = $orders->create(1, 1, 'sell', 'food', 20000, '1.01');
        $buy = $orders->create(2, 2, 'buy', 'food', 20000, '2.02');
        $money = $this->totalMoney();
        self::assertTrue(execute_trader_strategy($this->db, ['id' => 1]));
        $routeId = (int)$this->db->query('SELECT id FROM trader_routes')->fetchColumn();
        $route = $this->route($routeId);
        self::assertSame((int)$sell['id'], (int)$route['source_order_id']);
        self::assertSame((int)$buy['id'], (int)$route['target_order_id']);
        self::assertSame('backed', $route['funding_status']);
        process_single_route_transition($this->db, ['id' => $routeId]);
        self::assertSame(10000.0, (float)$this->route($routeId)['quantity_acquired']);
        self::assertSame(2020000, (int)$this->route($routeId)['buyer_escrow_cents']);
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
    }

    public function testOrderInsertFailureRollsBackPhysicalReservationAndWrongOwnerCannotCancel(): void
    {
        $orders = new \GalaxyQuest\Economy\StandingOrders($this->db);
        $this->db->exec(
            "CREATE TRIGGER reject_order BEFORE INSERT ON economy_standing_orders "
            . "BEGIN SELECT RAISE(ABORT,'forced order failure'); END"
        );
        try {
            $orders->create(1, 1, 'sell', 'food', 5, '10.00');
            self::fail('Order insertion failure must restore stock.');
        } catch (PDOException) {
            self::assertSame(1000.0, $this->colonyStock(1, 'food'));
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        }
        $this->db->exec('DROP TRIGGER reject_order');
        $order = $orders->create(1, 1, 'buy', 'food', 5, '10.00');
        try {
            $orders->cancel(2, (int)$order['id']);
            self::fail('Another user cannot cancel an owned order.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
            self::assertSame('active', $orders->read((int)$order['id'], 1)['status']);
            self::assertSame(9999999999999901, \GalaxyQuest\Economy\StandingOrders::capitalCents('99999999999999.01'));
        }
    }

    public function testMismatchedCargoIsQuarantinedWithoutFabricatingGoodsOrSpendingEscrow(): void
    {
        $fleetIds = [];
        $routeId = $this->createDueRoute('food', 5, $fleetIds);
        $this->db->prepare('UPDATE fleets SET cargo_payload=? WHERE id=?')
            ->execute(['{"food":4}', $fleetIds[0]]);
        $money = $this->totalMoney();
        $stats = process_route_transitions($this->db);
        self::assertSame(1, $stats['routes_quarantined']);
        self::assertSame('quarantined', $this->route($routeId)['funding_status']);
        self::assertSame(7500, (int)$this->route($routeId)['buyer_escrow_cents']);
        self::assertEqualsWithDelta(1000.0, $this->colonyStock(2, 'food'), 0.01);
        self::assertSame(4.0, $this->fleetCargo($fleetIds[0], 'food'));
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
        process_route_transitions($this->db);
        self::assertEqualsWithDelta($money, $this->totalMoney(), 0.00001);
    }

    private function credits(int $uid): float
    {
        $statement = $this->db->prepare('SELECT credits FROM users WHERE id=?');
        $statement->execute([$uid]);
        return (float)$statement->fetchColumn();
    }

    private function totalMoney(): float
    {
        return (float)$this->db->query('SELECT SUM(credits) FROM users')->fetchColumn()
            + $this->traderCapital()
            + (float)$this->db->query('SELECT COALESCE(SUM(escrow_cents),0) FROM economy_standing_orders')->fetchColumn() / 100
            + (float)$this->db->query('SELECT COALESCE(SUM(buyer_escrow_cents),0) FROM trader_routes')->fetchColumn() / 100;
    }

    private function createDueRoute(string $good, float $quantity, array &$fleetIds, ?string $arrival = null): int
    {
        $arrival ??= date('Y-m-d H:i:s', time() - 3600);
        $routeId = $this->createRoute($good, 'planning', $quantity);
        process_single_route_transition($this->db, ['id' => $routeId]);
        $fleetId = (int)$this->route($routeId)['fleet_id'];
        $fleetIds[] = $fleetId;
        $this->db->prepare('UPDATE trader_routes SET arrival_at=? WHERE id=?')->execute([$arrival, $routeId]);
        $this->db->prepare('UPDATE fleets SET arrival_time=? WHERE id=?')->execute([$arrival, $fleetId]);
        return $routeId;
    }

    private function route(int $routeId): array
    {
        $statement = $this->db->prepare('SELECT * FROM trader_routes WHERE id=?');
        $statement->execute([$routeId]);
        return $statement->fetch();
    }

    private function fleet(int $fleetId): array
    {
        $statement = $this->db->prepare('SELECT * FROM fleets WHERE id=?');
        $statement->execute([$fleetId]);
        return $statement->fetch();
    }

    private function fleetCargo(int $fleetId, string $good): float
    {
        $cargo = json_decode((string)$this->fleet($fleetId)['cargo_payload'], true, 512, JSON_THROW_ON_ERROR);
        return (float)($cargo[$good] ?? 0);
    }

    private function colonyStock(int $colonyId, string $good): float
    {
        if (in_array($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRIMARY, true)) {
            $statement = $this->db->prepare("SELECT `$good` FROM colonies WHERE id=?");
            $statement->execute([$colonyId]);
            return (float)$statement->fetchColumn();
        }
        $statement = $this->db->prepare(
            'SELECT quantity FROM economy_processed_goods WHERE colony_id=? AND good_type=?'
        );
        $statement->execute([$colonyId, $good]);
        return (float)($statement->fetchColumn() ?: 0);
    }

    private function traderCapital(): float
    {
        return (float)$this->db->query('SELECT capital_credits FROM npc_traders WHERE id=1')->fetchColumn();
    }

    private function traderProfit(): float
    {
        return (float)$this->db->query('SELECT total_profit FROM npc_traders WHERE id=1')->fetchColumn();
    }

    private function traderActiveFleets(): int
    {
        return (int)$this->db->query('SELECT active_fleets FROM npc_traders WHERE id=1')->fetchColumn();
    }

    private function transactionCount(int $routeId): int
    {
        $statement = $this->db->prepare('SELECT COUNT(*) FROM trader_transactions WHERE route_id=?');
        $statement->execute([$routeId]);
        return (int)$statement->fetchColumn();
    }

    private function transactionCountByType(int $routeId, string $type): int
    {
        $statement = $this->db->prepare(
            'SELECT COUNT(*) FROM trader_transactions WHERE route_id=? AND transaction_type=?'
        );
        $statement->execute([$routeId, $type]);
        return (int)$statement->fetchColumn();
    }

    private function fleetCountForRoute(int $routeId): int
    {
        $statement = $this->db->prepare(
            'SELECT COUNT(*) FROM fleets f JOIN trader_routes r ON r.fleet_id=f.id WHERE r.id=?'
        );
        $statement->execute([$routeId]);
        return (int)$statement->fetchColumn();
    }
}
