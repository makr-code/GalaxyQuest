<?php

declare(strict_types=1);

use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\StandingOrders;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../Unit/TraderRouteLogisticsTest.php';
require_once __DIR__ . '/../../src/Economy/NpcStandingOrders.php';
require_once __DIR__ . '/../../api/npc_ai.php';

final class NpcStandingOrdersTest extends TestCase
{
    private const NOW = 1800000000;
    private PDO $db;
    private NpcStandingOrders $controller;

    protected function setUp(): void
    {
        $this->db = TraderRouteLogisticsTest::createLedgerFixture();
        $this->db->exec(<<<'SQL'
            ALTER TABLE users ADD COLUMN control_type TEXT DEFAULT 'npc_engine';
            ALTER TABLE users ADD COLUMN auth_enabled INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL;
            ALTER TABLE users ADD COLUMN species_id INTEGER DEFAULT 1;
            CREATE TABLE npc_faction_memberships (user_id INTEGER, faction_id INTEGER);
            INSERT INTO npc_faction_memberships VALUES (1,4),(2,4);
            CREATE TABLE economy_npc_profiles (
                user_id INTEGER PRIMARY KEY,colony_id INTEGER UNIQUE,profile TEXT,
                window_budget_cents INTEGER,last_window INTEGER,summary_json TEXT
            );
            CREATE TABLE economy_npc_orders (
                order_id INTEGER PRIMARY KEY,user_id INTEGER,created_window INTEGER,expires_window INTEGER
            );
            UPDATE users SET control_type='human',auth_enabled=1 WHERE id=10;
            UPDATE users SET species_id=6 WHERE id=2;
            UPDATE colonies SET metal=0,crystal=0,deuterium=0,rare_earth=0,food=0,population=100;
            UPDATE npc_traders SET active_fleets=0;
            INSERT INTO buildings (colony_id,type,level) VALUES (1,'metallurgy',1),(1,'solar_plant',10);
            INSERT INTO research VALUES (1,'energy_tech',1);
            SQL);
        $economy = new OnDemandEconomy($this->db);
        $economy->settle(1, 1, self::NOW, true);
        $economy->settle(2, 2, self::NOW, true);
        $this->controller = new NpcStandingOrders($this->db);
        $this->controller->bind(1, 1, 'industry', 100000, false);
        $this->controller->bind(2, 2, 'agriculture', 100000, false);
    }

    public function testFoodAndBlockedManufacturingInputsCreateFundedOrdersAndCapBudget(): void
    {
        $before = (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn();
        $summary = $this->controller->decide(1, self::NOW);
        $orders = $this->orders(1);
        self::assertSame('decided', $summary['status']);
        self::assertArrayHasKey('food', $orders);
        self::assertArrayHasKey('metal', $orders);
        self::assertSame('buy', $orders['metal']['side']);
        self::assertGreaterThan(0, $summary['needs']['metal']['deficit']);
        $escrow = array_sum(array_column($orders, 'escrow_cents'));
        self::assertLessThanOrEqual(100000, $escrow);
        self::assertEquals($before - $escrow / 100, $summary['available_credits_after']);
        foreach ($orders as $order) {
            self::assertSame((int)$order['quantity_remaining'] * (int)$order['limit_price_cents'], (int)$order['escrow_cents']);
        }
        self::assertLessThanOrEqual(NpcStandingOrders::MAX_OPERATIONS, count($orders));
    }

    public function testMeasuredPrimaryAndManufacturedSurplusIsReservedAboveNeeds(): void
    {
        (new OnDemandEconomy($this->db))->receive(1, ['food' => 1000, 'steel_alloy' => 100], self::NOW);
        $summary = $this->controller->decide(1, self::NOW);
        $orders = $this->orders(1);
        self::assertSame('sell', $orders['food']['side']);
        self::assertSame(992, (int)$orders['food']['quantity_initial']);
        self::assertSame('sell', $orders['steel_alloy']['side']);
        self::assertSame(100, (int)$orders['steel_alloy']['quantity_initial']);
        self::assertSame(8.0, $this->stock(1, 'food'));
        self::assertSame(0.0, $this->stock(1, 'steel_alloy'));
        self::assertSame(8, $summary['needs']['food']['reserve']);
        $next = $this->controller->decide(1, self::NOW + 3600);
        self::assertContains((int)$orders['food']['id'], $next['cancelled']);
        self::assertSame('cancelled', (new StandingOrders($this->db))->read((int)$orders['food']['id'], 1)['status']);
        self::assertSame(8.0, $this->stock(1, 'food'));
    }

    public function testNoCapitalOrStockCannotInventOrders(): void
    {
        $this->db->exec('UPDATE users SET credits=0 WHERE id=1');
        $summary = $this->controller->decide(1, self::NOW);
        self::assertSame([], $summary['created']);
        self::assertSame([], $this->orders(1));
        self::assertSame(0.0, $this->stock(1, 'food'));
        self::assertContains('food:unfunded', $summary['deferred']);
    }

    public function testHumanAndAuthenticatingOrDeletedActorsAreUntouchedAndCannotBind(): void
    {
        foreach (["control_type='human',auth_enabled=1", 'auth_enabled=1', "deleted_at='2026-01-01'"] as $change) {
            $this->db->exec('UPDATE users SET ' . $change . ' WHERE id=1');
            $before = $this->db->query('SELECT total_changes()')->fetchColumn();
            self::assertSame('excluded', $this->controller->decide(1, self::NOW)['status']);
            self::assertSame($before, $this->db->query('SELECT total_changes()')->fetchColumn());
            $this->db->exec("UPDATE users SET control_type='npc_engine',auth_enabled=0,deleted_at=NULL WHERE id=1");
        }
        $this->expectException(DomainException::class);
        $this->controller->bind(10, 1, 'trade', 100, false);
    }

    public function testBindingRejectsWrongOwnerNoFundsAndDoesNotProvisionOrOverwrite(): void
    {
        $before = $this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn();
        foreach ([[10, 1, 100], [2, 1, 100], [2, 2, 100]] as [$uid, $cid, $budget]) {
            try {
                $this->controller->bind($uid, $cid, 'trade', $budget, false);
                self::fail('Invalid binding should fail.');
            } catch (DomainException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
        self::assertSame($before, $this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        $this->db->exec('DELETE FROM economy_npc_profiles WHERE user_id=2; UPDATE users SET credits=0 WHERE id=2');
        $this->expectException(DomainException::class);
        $this->controller->bind(2, 2, 'trade', 100, false);
    }

    public function testOwnershipTransferLeavesHumanLedgerUntouchedAndDiagnosticsAreReadOnly(): void
    {
        $this->db->exec('UPDATE colonies SET user_id=10 WHERE id=1');
        $before = $this->balances();
        $state = $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=1')->fetchColumn();
        $result = $this->controller->decide(1, self::NOW);
        self::assertSame('excluded', $result['status']);
        self::assertNotEmpty($result['errors']);
        self::assertSame($before, $this->balances());
        self::assertSame($state, $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=1')->fetchColumn());
        $writes = $this->db->query('SELECT total_changes()')->fetchColumn();
        self::assertSame($result, $this->controller->diagnostics(1)['summary']);
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
        npc_player_account_tick($this->db, 10, true, self::NOW);
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
    }

    public function testDormantOtherColonyIsNotSettledByNpcOrdersOrPriceProjection(): void
    {
        $before = $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=2')->fetchColumn();
        $this->controller->decide(1, self::NOW + 3600);
        self::assertSame($before, $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=2')->fetchColumn());
        self::assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM economy_standing_orders WHERE user_id=2'
        )->fetchColumn());
    }

    public function testSameWindowForcePipelineAndNextWindowMaintainReservationsWithoutReroll(): void
    {
        $first = $this->controller->decide(1, self::NOW);
        $before = $this->orders(1);
        npc_player_account_tick($this->db, 1, true, self::NOW);
        self::assertSame($before, $this->orders(1));
        self::assertSame('already_decided', $this->controller->decide(1, self::NOW)['status']);
        // Use the fixture clock for the independent following-window accounting case.
        $this->controller->decide(2, self::NOW);
        $second = $this->controller->decide(2, self::NOW + 3600);
        self::assertSame([], $second['created']);
        self::assertNotEmpty($second['maintained']);
        self::assertSame(8, $second['needs']['food']['incoming']);
        self::assertSame(0, $second['needs']['food']['deficit']);
        self::assertSame('decided', $first['status']);
    }

    public function testStaleCatchupDefersOncePerWindowWithoutSpendingAndRetriesNextWindow(): void
    {
        $state = json_decode($this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=1')
            ->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
        $state['settled_at'] = self::NOW - 172800;
        $this->db->prepare('UPDATE colony_economy_state SET settled_at=?,state_json=? WHERE colony_id=1')
            ->execute([$state['settled_at'], json_encode($state, JSON_THROW_ON_ERROR)]);
        $summary = $this->controller->decide(1, self::NOW);
        self::assertSame('deferred', $summary['status']);
        self::assertSame([], $this->orders(1));
        self::assertSame('already_decided', $this->controller->decide(1, self::NOW + 1)['status']);
        self::assertSame('deferred', $this->controller->decide(1, self::NOW + 3600)['status']);
        self::assertSame('decided', $this->controller->decide(1, self::NOW + 7200)['status']);
    }

    public function testDeterministicPreviewRollsBackLedgerAndPoliticalSpeciesRemainIndependent(): void
    {
        $before = $this->balances();
        $state = $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=1')->fetchColumn();
        $one = $this->controller->decide(1, self::NOW, true);
        mt_srand(923);
        $this->db->exec('UPDATE users SET species_id=6 WHERE id=1; UPDATE npc_faction_memberships SET faction_id=2');
        $two = $this->controller->decide(1, self::NOW, true);
        self::assertSame($one, $two);
        self::assertSame($before, $this->balances());
        self::assertSame($state, $this->db->query('SELECT state_json FROM colony_economy_state WHERE colony_id=1')->fetchColumn());
        self::assertNull($this->controller->diagnostics(1)['summary']);
        $this->db->beginTransaction();
        $this->db->exec('UPDATE users SET credits=credits+1 WHERE id=10');
        $this->controller->decide(1, self::NOW, true);
        self::assertTrue($this->db->inTransaction());
        self::assertSame($before + 1, $this->balances());
        self::assertNull($this->controller->diagnostics(1)['summary']);
        $this->db->rollBack();
        self::assertSame($before, $this->balances());
    }

    public function testAtomicCreateFailureRollsBackOrdersStockCreditAndDecisionMarker(): void
    {
        (new OnDemandEconomy($this->db))->receive(1, ['food' => 1000], self::NOW);
        $before = $this->balances();
        $this->db->exec("CREATE TRIGGER reject_npc_order BEFORE INSERT ON economy_npc_orders "
            . "BEGIN SELECT RAISE(ABORT,'fixture create failure'); END");
        try {
            $this->controller->decide(1, self::NOW);
            self::fail('Create failure should escape.');
        } catch (PDOException $error) {
            self::assertStringContainsString('fixture create failure', $error->getMessage());
        }
        self::assertSame($before, $this->balances());
        self::assertSame([], $this->orders(1));
        self::assertNull($this->controller->diagnostics(1)['summary']);
        self::assertSame(1000.0, $this->stock(1, 'food'));
        $this->db->exec('DROP TRIGGER reject_npc_order');
        self::assertNotEmpty($this->controller->decide(1, self::NOW)['created']);
    }

    public function testAutarkySuppressesImportsButNotBackedSurplus(): void
    {
        (new OnDemandEconomy($this->db))->receive(1, ['steel_alloy' => 20], self::NOW);
        $this->controller->decide(1, self::NOW);
        $this->db->exec("UPDATE economy_policies SET global_policy='autarky' WHERE user_id=1");
        $summary = $this->controller->decide(1, self::NOW + 3600);
        self::assertContains('food:autarky', $summary['deferred']);
        $orders = $this->orders(1);
        self::assertSame('cancelled', $orders['food']['status']);
        self::assertSame('cancelled', $orders['metal']['status']);
        self::assertSame('active', $orders['steel_alloy']['status']);
        self::assertSame('sell', $orders['steel_alloy']['side']);
        self::assertSame([], $summary['created']);
    }

    public function testAutonomousColoniesExchangeManufacturedAndPrimaryGoodsThroughFundedRoutes(): void
    {
        $economy = new OnDemandEconomy($this->db);
        $economy->receive(1, ['steel_alloy' => 100, 'food' => 8], self::NOW);
        $economy->receive(2, ['metal' => 1000, 'food' => 8], self::NOW);
        $this->db->exec("UPDATE buildings SET level=1 WHERE colony_id=2 AND type='consumer_factory'; "
            . "INSERT INTO buildings (colony_id,type,level) VALUES (2,'solar_plant',10),(2,'metal_mine',1); "
            . "INSERT INTO research VALUES (2,'computer_tech',1); "
            . "UPDATE npc_traders SET max_fleets=4");
        $before = $this->balances();
        for ($window = 0; $window < 3; $window++) {
            $now = self::NOW + $window * 3600;
            $this->controller->decide(1, $now);
            $this->controller->decide(2, $now);
            process_route_transitions($this->db, $now);
            for ($route = 0; $route < 4; $route++) {
                if (!execute_trader_strategy($this->db, ['id' => 1, 'specialization' => ''])) {
                    break;
                }
            }
            process_route_transitions($this->db, $now);
        }
        $goods = $this->db->query("SELECT DISTINCT resource_type FROM trader_routes WHERE status='completed'")
            ->fetchAll(PDO::FETCH_COLUMN);
        self::assertContains('metal', $goods);
        self::assertContains('steel_alloy', $goods);
        self::assertGreaterThan(0, $this->stock(1, 'metal'));
        self::assertGreaterThan(0, $this->stock(2, 'steel_alloy'));
        self::assertEqualsWithDelta($before, $this->balances(), 0.01);
        self::assertSame('human', $this->db->query('SELECT control_type FROM users WHERE id=10')->fetchColumn());
    }

    public function testInFlightIncomingPreventsDuplicateAndExpiryCancelsOnlyResidualEscrow(): void
    {
        (new OnDemandEconomy($this->db))->receive(2, ['food' => 100], self::NOW);
        $this->controller->decide(1, self::NOW);
        $this->controller->decide(2, self::NOW);
        $this->db->exec("UPDATE npc_traders SET capital_credits=10");
        self::assertTrue(execute_trader_strategy($this->db, ['id' => 1, 'specialization' => 'food']));
        process_route_transitions($this->db, self::NOW);
        $route = $this->db->query("SELECT * FROM trader_routes WHERE status='in_transit'")->fetch();
        self::assertIsArray($route);
        $obligation = (int)$route['buyer_escrow_cents'];
        $this->db->exec('UPDATE economy_npc_orders SET expires_window=' . intdiv(self::NOW, 3600));
        $next = $this->controller->decide(1, self::NOW + 3600);
        self::assertSame((int)$route['quantity_acquired'], $next['needs']['food']['incoming']);
        self::assertSame([], array_filter($next['created'], static fn(array $order): bool => $order['good_type'] === 'food'));
        self::assertSame($obligation, (int)$this->db->query('SELECT buyer_escrow_cents FROM trader_routes')->fetchColumn());
        self::assertSame('cancelled', (new StandingOrders($this->db))->read((int)$route['target_order_id'], 1)['status']);
        process_route_transitions($this->db, self::NOW + 3600);
        self::assertSame('completed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertGreaterThan(0, $this->stock(1, 'food'));
    }

    public function testFoodConstructionUsesSharedLedgerAndCompletesOnlyOnDemandOnce(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0)");
        $before = $this->stock(1, 'metal');
        $summary = $this->controller->decide(1, self::NOW);
        $build = $summary['production']['construction'];
        self::assertSame('executed', $build['status']);
        self::assertSame('hydroponic_farm', $build['building']);
        self::assertSame(1, $build['target_level']);
        self::assertSame(0, $this->buildingLevel('hydroponic_farm'));
        self::assertGreaterThan(0, $build['cost']['metal']);
        self::assertLessThanOrEqual($before - $build['cost']['metal'], $this->stock(1, 'metal'));
        self::assertLessThanOrEqual(10000000, $build['policy_cost_cents']
            + array_sum(array_column($summary['created'], 'escrow_cents')));
        npc_player_account_tick($this->db, 1, true, self::NOW);
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
        $next = $this->controller->decide(1, self::NOW + 3600);
        self::assertSame(1, $this->buildingLevel('hydroponic_farm'));
        self::assertSame('deferred', $next['production']['construction']['status']);
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testEnergyDeficitBuildsLegalSolarCapacityInsteadOfAnotherUnpoweredFarm(): void
    {
        $this->fundProduction();
        $this->db->exec("UPDATE buildings SET level=0 WHERE colony_id=1 AND type='solar_plant'; "
            . "INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',1)");
        $summary = $this->controller->decide(1, self::NOW);
        self::assertSame('executed', $summary['production']['construction']['status']);
        self::assertSame('solar_plant', $summary['production']['construction']['building']);
        self::assertSame('solar_plant', $this->db->query('SELECT building_type FROM building_upgrade_queue')->fetchColumn());
    }

    public function testManufacturedChainChoosesEfficientAccessibleMethodWithoutFreeOutputOrFlapping(): void
    {
        $this->prepareMethodChain();
        $economy = new OnDemandEconomy($this->db);
        $before = $this->stock(1, 'steel_alloy');
        $standard = $economy->productionForecast($economy->inspect(1, 1, self::NOW));
        $summary = $this->controller->decide(1, self::NOW);
        self::assertSame('executed', $summary['production']['method']['status']);
        self::assertSame('metallurgy', $summary['production']['method']['building']);
        self::assertSame('efficient', $summary['production']['method']['target']);
        self::assertSame($before, $this->stock(1, 'steel_alloy'));
        self::assertSame('already_decided', $this->controller->decide(1, self::NOW)['status']);
        $after = $economy->settle(1, 1, self::NOW + 3600, true);
        self::assertGreaterThan($standard['stock']['steel_alloy'], $after['economy']['stock']['steel_alloy']);
        $next = $this->controller->decide(1, self::NOW + 3600);
        self::assertSame('deferred', $next['production']['method']['status']);
        self::assertSame('efficient', $this->db->query(
            "SELECT method FROM economy_production_methods WHERE colony_id=1 AND building_type='metallurgy'"
        )->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testAffordableSupplyChainBottleneckBuildsAccessibleMetallurgy(): void
    {
        $this->fundProduction(100);
        $this->db->exec("UPDATE buildings SET level=0 WHERE colony_id=1 AND type='metallurgy'; "
            . "UPDATE buildings SET level=1 WHERE colony_id=1 AND type='consumer_factory'; "
            . "INSERT INTO research VALUES (1,'computer_tech',1)");
        (new OnDemandEconomy($this->db))->receive(1, ['electronics_components' => 100], self::NOW);
        $summary = $this->controller->decide(1, self::NOW);
        self::assertSame('metallurgy', $summary['production']['construction']['building']);
        self::assertSame('executed', $summary['production']['construction']['status']);
        self::assertSame(1, $summary['production']['construction']['target_level']);
    }

    public function testUnfundedResearchAndSurfaceConstraintsHaveExplicitReasonsWithoutConstruction(): void
    {
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0)");
        $unfunded = $this->controller->decide(1, self::NOW, true);
        self::assertContains('unaffordable', $unfunded['production']['construction']['reasons']);
        $food = array_values(array_filter($unfunded['production']['candidates'], static fn(array $item): bool =>
            $item['action'] === 'construction' && $item['building'] === 'hydroponic_farm'))[0];
        self::assertNotEmpty($food['cost']);
        self::assertNotEmpty($food['missing_resources']);
        $this->fundProduction(100);
        $locked = $this->controller->decide(1, self::NOW, true);
        self::assertContains('research', array_column($locked['production']['candidates'], 'reason'));
        $this->db->exec('UPDATE colonies SET food=0 WHERE id=1');
        for ($y = 0; $y < 5; $y++) {
            for ($x = 0; $x < 7; $x++) {
                $this->db->prepare('INSERT INTO colony_building_slots (colony_id,slot_x,slot_y,building_type,level) '
                    . "VALUES (1,?,?,'metal_storage',1)")->execute([$x, $y]);
            }
        }
        $blocked = $this->controller->decide(1, self::NOW);
        self::assertContains('No free surface slots.', $blocked['production']['construction']['reasons']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testExistingConstructionQueueDefersStructuralDecisionAcrossWindows(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0)");
        (new OnDemandEconomy($this->db))->queue(1, 1, 'hydroponic_farm', [0, 0], self::NOW);
        $this->db->prepare("UPDATE building_upgrade_queue SET eta=? WHERE status='running'")
            ->execute([gmdate('Y-m-d H:i:s', self::NOW + 100000)]);
        foreach ([self::NOW, self::NOW + 3600] as $now) {
            $summary = $this->controller->decide(1, $now);
            self::assertSame('queue_active', $summary['production']['construction']['reason']);
            self::assertSame(1, $summary['production']['construction']['pending'][0]['target_level']);
        }
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testPolicyBudgetAndSharedClassCapacityBlockOtherwiseAffordableConstruction(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0); "
            . 'UPDATE economy_npc_profiles SET window_budget_cents=100 WHERE user_id=1');
        $budget = $this->controller->decide(1, self::NOW, true);
        self::assertContains('window_budget', $budget['production']['construction']['reasons']);
        self::assertSame(10000.0, $this->stock(1, 'metal'));
        $this->db->exec('UPDATE economy_npc_profiles SET window_budget_cents=10000000 WHERE user_id=1');
        for ($index = 0; $index < 16; $index++) {
            $this->db->prepare('INSERT INTO colony_building_slots (colony_id,slot_x,slot_y,building_type,level) '
                . "VALUES (1,?,?,'habitat',1)")->execute([$index % 7, intdiv($index, 7)]);
        }
        $capacity = $this->controller->decide(1, self::NOW);
        self::assertContains('Building class capacity reached.', $capacity['production']['construction']['reasons']);
        self::assertSame(0, $this->buildingLevel('hydroponic_farm'));
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testIndustrialConstructionCannotConsumeFoodSafetyReserve(): void
    {
        $this->fundProduction(4);
        $this->db->exec("UPDATE buildings SET level=0 WHERE colony_id=1 AND type='metallurgy'; "
            . "UPDATE buildings SET level=1 WHERE colony_id=1 AND type='consumer_factory'; "
            . "INSERT INTO research VALUES (1,'computer_tech',1)");
        (new OnDemandEconomy($this->db))->receive(1, ['electronics_components' => 100], self::NOW);
        $preview = $this->controller->decide(1, self::NOW, true);
        self::assertContains('food_reserve', $preview['production']['construction']['reasons'],
            json_encode($preview['production'], JSON_THROW_ON_ERROR));
        self::assertSame('deferred', $preview['production']['construction']['status']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
    }

    public function testBuyEscrowAndReservedSellingStockAreUnavailableToConstruction(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0)");
        $orders = new StandingOrders($this->db);
        $orders->create(1, 1, 'buy', 'food', 10000, '10.00', self::NOW);
        $orders->create(1, 1, 'sell', 'metal', 10000, '10.00', self::NOW);
        $summary = $this->controller->decide(1, self::NOW);
        self::assertContains('unaffordable', $summary['production']['construction']['reasons']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
        self::assertSame(10000000, (int)$this->db->query(
            "SELECT escrow_cents FROM economy_standing_orders WHERE user_id=1 AND side='buy'"
        )->fetchColumn());
        self::assertSame(0.0, $this->stock(1, 'metal'));
    }

    public function testProductionPreviewDoesNotEvenTemporarilyWriteOrAdvanceDueQueue(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0)");
        $changes = $this->db->query('SELECT total_changes()')->fetchColumn();
        $preview = $this->controller->decide(1, self::NOW, true);
        self::assertSame('candidate', $preview['production']['construction']['status']);
        self::assertSame($changes, $this->db->query('SELECT total_changes()')->fetchColumn());
        self::assertNull($this->controller->diagnostics(1)['summary']);
        (new OnDemandEconomy($this->db))->queue(1, 1, 'hydroponic_farm', [0, 0], self::NOW);
        $changes = $this->db->query('SELECT total_changes()')->fetchColumn();
        $preview = $this->controller->decide(1, self::NOW + 3600, true);
        self::assertSame(['catchup:3600'], $preview['deferred']);
        self::assertSame(0, $this->buildingLevel('hydroponic_farm'));
        self::assertSame($changes, $this->db->query('SELECT total_changes()')->fetchColumn());
    }

    public function testUnexpectedQueueWriteFailureRollsBackLedgerSlotsMethodsAndWindowForRetry(): void
    {
        $this->fundProduction();
        $this->db->exec("INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0); "
            . "CREATE TRIGGER reject_build BEFORE INSERT ON building_upgrade_queue "
            . "BEGIN SELECT RAISE(ABORT,'fixture queue failure'); END");
        $before = $this->stock(1, 'metal');
        $balances = $this->balances();
        try {
            $this->controller->decide(1, self::NOW);
            self::fail('Unexpected database failure must escape.');
        } catch (PDOException $error) {
            self::assertStringContainsString('fixture queue failure', $error->getMessage());
        }
        self::assertSame($before, $this->stock(1, 'metal'));
        self::assertSame($balances, $this->balances());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_slots')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM building_upgrade_queue')->fetchColumn());
        self::assertSame([], $this->orders(1));
        self::assertNull($this->controller->diagnostics(1)['summary']);
        $this->db->exec('DROP TRIGGER reject_build');
        self::assertSame('executed', $this->controller->decide(1, self::NOW)['production']['construction']['status']);
    }

    public function testUnexpectedDecisionMarkerFailureAlsoRollsBackRealMethodChange(): void
    {
        $this->prepareMethodChain();
        $this->db->exec("CREATE TRIGGER reject_decision BEFORE UPDATE ON economy_npc_profiles "
            . "BEGIN SELECT RAISE(ABORT,'fixture method decision failure'); END");
        $before = $this->stock(1, 'metal');
        try {
            $this->controller->decide(1, self::NOW);
            self::fail('Method and marker must commit together.');
        } catch (PDOException $error) {
            self::assertStringContainsString('fixture method decision failure', $error->getMessage());
        }
        self::assertSame($before, $this->stock(1, 'metal'));
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_production_methods')->fetchColumn());
        self::assertNull($this->controller->diagnostics(1)['summary']);
        $this->db->exec('DROP TRIGGER reject_decision');
        self::assertSame('executed', $this->controller->decide(1, self::NOW)['production']['method']['status']);
    }

    private function fundProduction(int $food = 0): void
    {
        $this->db->exec('UPDATE economy_npc_profiles SET window_budget_cents=10000000 WHERE user_id=1');
        (new OnDemandEconomy($this->db))->receive(1, [
            'metal' => 10000, 'crystal' => 10000, 'deuterium' => 10000, 'food' => $food,
        ], self::NOW);
    }

    private function prepareMethodChain(): void
    {
        $this->db->exec("UPDATE buildings SET level=1 WHERE colony_id=1 AND type='consumer_factory'; "
            . "INSERT INTO research VALUES (1,'computer_tech',1); UPDATE users SET credits=0 WHERE id=1");
        (new OnDemandEconomy($this->db))->receive(1, [
            'metal' => 40, 'food' => 8, 'electronics_components' => 100,
        ], self::NOW);
    }

    private function buildingLevel(string $type): int
    {
        $query = $this->db->prepare('SELECT level FROM buildings WHERE colony_id=1 AND type=?');
        $query->execute([$type]);
        return (int)$query->fetchColumn();
    }

    private function orders(int $uid): array
    {
        $statement = $this->db->prepare('SELECT * FROM economy_standing_orders WHERE user_id=? ORDER BY id');
        $statement->execute([$uid]);
        return array_column($statement->fetchAll(), null, 'good_type');
    }

    private function stock(int $cid, string $good): float
    {
        return (float)((new OnDemandEconomy($this->db))->settle(
            $cid, null, (int)$this->db->query('SELECT settled_at FROM colony_economy_state WHERE colony_id=' . $cid)
                ->fetchColumn(), true
        )['economy']['stock'][$good] ?? 0);
    }

    private function balances(): float
    {
        return (float)$this->db->query('SELECT SUM(credits) FROM users')->fetchColumn()
            + (float)$this->db->query('SELECT SUM(capital_credits) FROM npc_traders')->fetchColumn()
            + (float)$this->db->query('SELECT COALESCE(SUM(escrow_cents),0)/100.0 FROM economy_standing_orders')->fetchColumn()
            + (float)$this->db->query('SELECT COALESCE(SUM(buyer_escrow_cents),0)/100.0 FROM trader_routes')->fetchColumn();
    }
}
