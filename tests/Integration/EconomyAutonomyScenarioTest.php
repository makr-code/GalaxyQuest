<?php

declare(strict_types=1);

use GalaxyQuest\Economy\EconomicRequests;
use GalaxyQuest\Economy\ColonyEconomySimulation;
use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\StandingOrders;
use GalaxyQuest\Economy\WorldEvents;
use GalaxyQuest\Simulation\HourlyWindow;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../Unit/TraderRouteLogisticsTest.php';
require_once __DIR__ . '/../../src/Economy/EconomicRequests.php';
require_once __DIR__ . '/../../lib/world_tick.php';

final class EconomyAutonomyScenarioTest extends TestCase
{
    private const START = 1800000000;

    /**
     * Finite one-time endowment: NPC 1 has 100 steel, NPC 2 has 1000 metal,
     * each has 8 food and 100000 credits; the human and trader retain the
     * shared fixture's initial balances. Nothing is replenished by the test.
     */
    private function fixture(): PDO
    {
        $db = TraderRouteLogisticsTest::createLedgerFixture();
        $db->exec(<<<'SQL'
            ALTER TABLE users ADD COLUMN control_type TEXT DEFAULT 'npc_engine';
            ALTER TABLE users ADD COLUMN auth_enabled INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL;
            ALTER TABLE users ADD COLUMN email TEXT DEFAULT 'fixture@example.invalid';
            ALTER TABLE users ADD COLUMN email_notifications INTEGER DEFAULT 1;
            INSERT INTO users (id,control_type,auth_enabled) VALUES (3,'human',1);
            INSERT INTO celestial_bodies VALUES (3,1,3,1);
            INSERT INTO star_systems VALUES (1,3,200,0,0);
            INSERT INTO colonies (id,user_id,body_id,name,population,metal,crystal,deuterium,rare_earth,food)
                VALUES (3,3,3,'Human',0,1000,0,0,0,1000);
            INSERT INTO economy_policies (user_id,tax_income,tax_trade,tax_production) VALUES (3,0,0,0);
            UPDATE economy_policies SET tax_income=0,tax_trade=0,tax_production=0;
            UPDATE colonies SET metal=0,crystal=0,deuterium=0,rare_earth=0,food=8 WHERE id IN (1,2);
            UPDATE colonies SET metal=1000 WHERE id=2;
            INSERT INTO economy_processed_goods (colony_id,good_type,quantity,capacity,
                production_rate_per_hour,consumption_rate_per_hour) VALUES (1,'steel_alloy',100,10000,0,0);
            INSERT INTO buildings (colony_id,type,level) VALUES
                (1,'metallurgy',1),(1,'solar_plant',10),
                (2,'consumer_factory',1),(2,'solar_plant',10),(2,'metal_mine',1);
            INSERT INTO research VALUES (1,'energy_tech',1),(2,'computer_tech',1);
            UPDATE npc_traders SET active_fleets=0,max_fleets=4;
            CREATE TABLE economy_npc_profiles (
                user_id INTEGER PRIMARY KEY,colony_id INTEGER UNIQUE,profile TEXT,
                window_budget_cents INTEGER,last_window INTEGER,summary_json TEXT
            );
            CREATE TABLE economy_npc_orders (
                order_id INTEGER PRIMARY KEY,user_id INTEGER,created_window INTEGER,expires_window INTEGER
            );
            CREATE TABLE economy_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,npc_user_id INTEGER,npc_order_id INTEGER,
                player_user_id INTEGER,player_colony_id INTEGER,window_id INTEGER,good_type TEXT,
                quantity INTEGER,price_cents INTEGER,npc_price_cents INTEGER,expires_at INTEGER,
                status TEXT DEFAULT 'pending',player_order_id INTEGER,committed_npc_order_id INTEGER,
                created_at INTEGER,resolved_at INTEGER,request_type TEXT NOT NULL DEFAULT 'supply',
                UNIQUE(npc_user_id,window_id),UNIQUE(npc_order_id,player_user_id)
            );
            CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT,receiver_id INTEGER,subject TEXT,body TEXT);
            CREATE TABLE mail_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,kind TEXT,dedupe_key TEXT UNIQUE,
                subject TEXT,body_text TEXT,body_html TEXT,status TEXT,attempts INTEGER,next_attempt_at INTEGER,
                last_error TEXT,sent_at TEXT
            );
            SQL);
        $economy = new OnDemandEconomy($db);
        foreach ([1, 2] as $id) {
            $economy->settle($id, $id, self::START, true);
        }
        $policy = new NpcStandingOrders($db);
        $policy->bind(1, 1, 'industry', 100000, false);
        $policy->bind(2, 2, 'industry', 100000, false);
        return $db;
    }

    private function money(PDO $db): float
    {
        return (float)$db->query('SELECT SUM(credits) FROM users')->fetchColumn()
            + (float)$db->query('SELECT SUM(capital_credits) FROM npc_traders')->fetchColumn()
            + (float)$db->query('SELECT COALESCE(SUM(escrow_cents),0)/100.0 FROM economy_standing_orders')->fetchColumn()
            + (float)$db->query('SELECT COALESCE(SUM(buyer_escrow_cents),0)/100.0 FROM trader_routes')->fetchColumn();
    }

    private function human(PDO $db): array
    {
        return [
            $db->query('SELECT credits FROM users WHERE id=3')->fetchColumn(),
            $db->query('SELECT metal,crystal,deuterium,rare_earth,food,population FROM colonies WHERE id=3')->fetch(),
            $db->query('SELECT COUNT(*) FROM colony_economy_state WHERE colony_id=3')->fetchColumn(),
        ];
    }

    /** Physical stores, residual sell reservations and undelivered route cargo, once each. */
    private function holdings(PDO $db): array
    {
        $goods = array_fill_keys(array_keys(ColonyEconomySimulation::PRICES), 0.0);
        foreach ($db->query('SELECT * FROM colonies') as $colony) {
            foreach (ColonyEconomySimulation::PRIMARY as $good) {
                $goods[$good] += (float)$colony[$good];
            }
        }
        foreach ($db->query('SELECT good_type,quantity FROM economy_processed_goods') as $row) {
            $goods[$row['good_type']] += (float)$row['quantity'];
        }
        foreach ($db->query("SELECT good_type,quantity_remaining FROM economy_standing_orders WHERE side='sell' AND status='active'") as $row) {
            $goods[$row['good_type']] += (float)$row['quantity_remaining'];
        }
        foreach ($db->query("SELECT resource_type,quantity_acquired FROM trader_routes WHERE status IN ('acquiring','in_transit')") as $row) {
            $goods[$row['resource_type']] += (float)$row['quantity_acquired'];
        }
        return $goods;
    }

    public function testSevenDayGrossMaterialLedgerIncludesRecipesStarvationStorageAndRealFlights(): void
    {
        $db = $this->fixture();
        $db->exec("UPDATE economy_processed_goods SET quantity=40 WHERE colony_id=2 AND good_type='electronics_components'; "
            . "UPDATE economy_processed_goods SET capacity=0.5 WHERE colony_id=2 AND good_type='consumer_goods'");
        (new StandingOrders($db))->create(2, 2, 'sell', 'metal', 100, '1.00', self::START);
        $initial = $this->holdings($db);
        $money = $this->money($db);
        $flows = [];
        $economy = new OnDemandEconomy($db);
        $policy = new NpcStandingOrders($db);
        for ($hour = 0; $hour <= 168; $hour++) {
            $now = self::START + $hour * 3600;
            (new WorldEvents($db))->generate($now, 6);
            foreach ([1, 2] as $cid) {
                $step = $economy->settle($cid, $cid, $now, true, true);
                foreach ($step['material_flows'] as $component => $goods) {
                    foreach ($goods as $good => $quantity) {
                        $flows[$component][$good] = ($flows[$component][$good] ?? 0.0) + $quantity;
                    }
                }
            }
            $beforeTransfers = $this->holdings($db);
            foreach ([1, 2] as $cid) {
                $decision = $policy->decide($cid, $now);
                self::assertNotSame('executed', $decision['production']['construction']['status']);
            }
            process_route_transitions($db, $now);
            execute_trader_strategy($db, ['id' => 1, 'specialization' => '']);
            process_route_transitions($db, $now);
            foreach ($beforeTransfers as $good => $quantity) {
                self::assertEqualsWithDelta($quantity, $this->holdings($db)[$good], 0.00001, $good . ' transfer');
            }
            self::assertEqualsWithDelta($money, $this->money($db), 0.02);
        }
        $final = $this->holdings($db);
        $totals = [];
        foreach ($initial as $good => $quantity) {
            $expected = $quantity;
            foreach (['raw_output' => 1, 'capacity_loss' => -1, 'processed_output' => 1,
                'processing_used' => -1, 'population_used' => -1, 'production_tax' => -1] as $component => $sign) {
                $expected += $sign * ($flows[$component][$good] ?? 0.0);
            }
            self::assertEqualsWithDelta($expected, $final[$good], 0.00001, $good . ' seven-day gross balance');
            self::assertGreaterThanOrEqual(0, $final[$good]);
            if ($quantity > 0 || $expected > 0 || ($flows['processing_used'][$good] ?? 0) > 0) {
                $totals[$good] = ['initial' => $quantity, 'final' => $final[$good]];
                foreach ($flows as $component => $goods) {
                    $totals[$good][$component] = $goods[$good] ?? 0;
                }
            }
        }
        self::assertGreaterThan(0, $flows['raw_output']['metal']);
        self::assertGreaterThan(0, $flows['processed_output']['steel_alloy']);
        self::assertGreaterThan(0, $flows['processed_output']['consumer_goods']);
        self::assertGreaterThan(0, $flows['processing_used']['metal']);
        self::assertGreaterThan(0, $flows['processing_used']['steel_alloy']);
        self::assertGreaterThan(0, $flows['population_used']['food']);
        self::assertGreaterThan(0, $flows['population_used']['consumer_goods']);
        self::assertGreaterThan(0, $flows['unmet_population']['food']);
        self::assertGreaterThan(0, $flows['unmet_processing']['consumer_goods']);
        self::assertGreaterThan(0, $flows['processing_capacity_blocked']['consumer_goods']);
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM colonies WHERE metal<0 OR food<0')->fetchColumn());
        self::assertGreaterThan(0, (int)$db->query("SELECT COUNT(*) FROM trader_routes WHERE status='completed'")->fetchColumn());
        if (getenv('GQ_SCENARIO_STATS') === '1') {
            fwrite(STDERR, 'GQ_MATERIAL_STATS ' . json_encode($totals, JSON_THROW_ON_ERROR) . PHP_EOL);
        }
    }

    public function testSevenDaysOfBackedAutonomousTradingAndIgnoredRequests(): void
    {
        $db = $this->fixture();
        $policy = new NpcStandingOrders($db);
        $requests = new EconomicRequests($db);
        $events = new WorldEvents($db);
        $money = $this->money($db);
        $human = $this->human($db);
        $created = 0;
        $deferred = 0;
        $methods = 0;
        $builds = 0;

        for ($hour = 0; $hour <= 168; $hour++) {
            $now = self::START + $hour * 3600;
            $generated = $events->generate($now, 6);
            world_events_enqueue_digests($db, HourlyWindow::id($now), $generated, $now);
            foreach ([1, 2] as $id) {
                $decision = $policy->decide($id, $now);
                self::assertSame('decided', $decision['status']);
                $created += count($decision['created']);
                $deferred += count($decision['deferred']);
                $methods += (int)($decision['production']['method']['status'] === 'executed');
                $builds += (int)($decision['production']['construction']['status'] === 'executed');
                self::assertLessThanOrEqual(NpcStandingOrders::MAX_OPERATIONS,
                    count($decision['created']) + count($decision['cancelled']));
                self::assertGreaterThanOrEqual(0, $decision['window_budget_remaining_cents']);
                $construction = $decision['production']['construction'];
                $value = $construction['status'] === 'executed' ? $construction['policy_cost_cents'] : 0;
                self::assertLessThanOrEqual(100000, $value + array_sum(array_column($decision['created'], 'escrow_cents')));
                self::assertSame('already_decided', $policy->decide($id, $now + 1)['status']);
            }
            $requests->tick($now);
            $beforeDuplicate = [
                $db->query('SELECT COUNT(*) FROM economy_requests')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM messages')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM world_events')->fetchColumn(),
                $this->money($db),
            ];
            $requests->tick($now);
            world_events_enqueue_digests($db, HourlyWindow::id($now), $events->generate($now, 6), $now);
            self::assertSame($beforeDuplicate, [
                $db->query('SELECT COUNT(*) FROM economy_requests')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM messages')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn(),
                $db->query('SELECT COUNT(*) FROM world_events')->fetchColumn(),
                $this->money($db),
            ]);
            process_route_transitions($db, $now);
            execute_trader_strategy($db, ['id' => 1, 'specialization' => '']);
            process_route_transitions($db, $now);
            self::assertEqualsWithDelta($money, $this->money($db), 0.02);
            self::assertSame(0, (int)$db->query(
                'SELECT COUNT(*) FROM economy_standing_orders WHERE quantity_remaining<0 OR escrow_cents<0 '
                . "OR (side='buy' AND escrow_cents<>quantity_remaining*limit_price_cents)"
            )->fetchColumn());
            self::assertSame(0, (int)$db->query(
                'SELECT COUNT(*) FROM colonies WHERE metal<0 OR crystal<0 OR deuterium<0 OR rare_earth<0 OR food<0'
            )->fetchColumn());
            self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM economy_processed_goods WHERE quantity<0')->fetchColumn());
            self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM users WHERE credits<0')->fetchColumn());
            self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM npc_traders WHERE capital_credits<0')->fetchColumn());
            self::assertLessThanOrEqual(1, (int)$db->query(
                "SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM building_upgrade_queue "
                . "WHERE status IN ('queued','running') GROUP BY colony_id)"
            )->fetchColumn());
        }
        self::assertGreaterThan(0, $created);
        self::assertGreaterThan(0, $deferred);
        $goods = $db->query("SELECT DISTINCT resource_type FROM trader_routes WHERE status='completed'")
            ->fetchAll(PDO::FETCH_COLUMN);
        self::assertContains('metal', $goods);
        self::assertContains('steel_alloy', $goods);
        self::assertSame(0, (int)$db->query(
            "SELECT COUNT(*) FROM trader_routes r WHERE r.status='completed' AND "
            . "((SELECT COUNT(*) FROM trader_transactions t WHERE t.route_id=r.id AND t.transaction_type='bought')<>1 "
            . "OR (SELECT COUNT(*) FROM trader_transactions t WHERE t.route_id=r.id AND t.transaction_type='sold')<>1 "
            . 'OR r.quantity_acquired<>r.quantity_delivered OR r.buyer_escrow_cents<>0)'
        )->fetchColumn());
        self::assertSame($human, $this->human($db));
        self::assertGreaterThan(0, (int)$db->query("SELECT COUNT(*) FROM economy_requests WHERE status='expired'")->fetchColumn());
        self::assertLessThanOrEqual(3, (int)$db->query("SELECT COUNT(*) FROM economy_requests WHERE status='pending'")->fetchColumn());
        self::assertLessThanOrEqual(2 * 169 * NpcStandingOrders::MAX_OPERATIONS,
            (int)$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        self::assertLessThanOrEqual(2 * 169, (int)$db->query('SELECT COUNT(*) FROM economy_requests')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM economy_standing_orders WHERE user_id=3')->fetchColumn());
        if (getenv('GQ_SCENARIO_STATS') === '1') {
            $stats = [
                'windows' => 169, 'actor_decisions' => 338, 'orders_created' => $created,
                'deferred_reasons' => $deferred, 'methods_changed' => $methods, 'constructions_started' => $builds,
                'completed_by_good' => $db->query(
                    "SELECT resource_type,COUNT(*) routes,SUM(quantity_delivered) quantity "
                    . "FROM trader_routes WHERE status='completed' GROUP BY resource_type ORDER BY resource_type"
                )->fetchAll(),
                'requests' => (int)$db->query('SELECT COUNT(*) FROM economy_requests')->fetchColumn(),
                'expired_requests' => (int)$db->query("SELECT COUNT(*) FROM economy_requests WHERE status='expired'")->fetchColumn(),
                'messages' => (int)$db->query('SELECT COUNT(*) FROM messages')->fetchColumn(),
                'outbox' => (int)$db->query('SELECT COUNT(*) FROM mail_outbox')->fetchColumn(),
                'world_events' => (int)$db->query('SELECT COUNT(*) FROM world_events')->fetchColumn(),
                'money_start' => $money, 'money_end' => $this->money($db),
            ];
            fwrite(STDERR, 'GQ_SCENARIO_STATS ' . json_encode($stats, JSON_THROW_ON_ERROR) . PHP_EOL);
        }
    }

    public function testPlayerFundedOrderChangesTheShipmentWithoutChangingTheBaseline(): void
    {
        $baseline = $this->fixture();
        $influenced = $this->fixture();
        foreach ([$baseline, $influenced] as $db) {
            $policy = new NpcStandingOrders($db);
            $policy->decide(1, self::START);
            $policy->decide(2, self::START);
        }
        $human = $this->human($baseline);
        $buy = $influenced->query(
            "SELECT * FROM economy_standing_orders WHERE user_id=1 AND side='buy' AND good_type='metal'"
        )->fetch();
        self::assertIsArray($buy);
        (new StandingOrders($influenced))->create(
            3, 3, 'sell', 'metal', 1, '0.01', self::START
        );
        foreach ([$baseline, $influenced] as $db) {
            self::assertTrue(execute_trader_strategy($db, ['id' => 1, 'specialization' => 'metal']));
            process_route_transitions($db, self::START);
            process_route_transitions($db, self::START + 7200);
        }
        $baseRoute = $baseline->query('SELECT * FROM trader_routes')->fetch();
        $playerRoute = $influenced->query('SELECT * FROM trader_routes')->fetch();
        self::assertSame('completed', $baseRoute['status']);
        self::assertSame('completed', $playerRoute['status']);
        self::assertSame(2, (int)$baseRoute['source_colony_id']);
        self::assertSame(3, (int)$playerRoute['source_colony_id']);
        self::assertGreaterThan((float)$playerRoute['quantity_delivered'], (float)$baseRoute['quantity_delivered']);
        self::assertNotEquals(
            $baseline->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn(),
            $influenced->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn()
        );
        self::assertSame($human, $this->human($baseline));
        if (getenv('GQ_SCENARIO_STATS') === '1') {
            fwrite(STDERR, 'GQ_INFLUENCE_STATS ' . json_encode([
                'baseline_quantity' => (int)$baseRoute['quantity_delivered'],
                'player_quantity' => (int)$playerRoute['quantity_delivered'],
                'baseline_buyer_metal' => (float)$baseline->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn(),
                'player_buyer_metal' => (float)$influenced->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn(),
            ], JSON_THROW_ON_ERROR) . PHP_EOL);
        }
    }

    public function testActualProductionAndConsumptionAccountForStockInARealLedgerStep(): void
    {
        $db = $this->fixture();
        $economy = new OnDemandEconomy($db);
        $before = $economy->inspect(2, 2, self::START);
        $after = $economy->settle(2, 2, self::START + 300, true, true);
        $initial = $before['economy']['stock'];
        $state = $after['economy'];
        self::assertGreaterThan(0, $state['production']['metal']);
        self::assertGreaterThan(0, $state['consumption']['food']);
        self::assertEqualsWithDelta(
            $initial['metal'] + $state['production']['metal'] / 12,
            $state['stock']['metal'],
            0.00001
        );
        self::assertEqualsWithDelta(
            $initial['food'] - $state['consumption']['food'] / 12,
            $state['stock']['food'],
            0.00001
        );
        self::assertLessThan($after['storage']['metal'], $state['stock']['metal']);
    }

    public function testFullStorageBlocksExtractionRatherThanInventingOrDestroyingStock(): void
    {
        $db = $this->fixture();
        $economy = new OnDemandEconomy($db);
        $initial = $economy->settle(2, 2, self::START, true);
        // A distinct finite initial endowment fills this colony's existing capacity.
        $db->prepare('UPDATE colonies SET metal=? WHERE id=2')->execute([$initial['storage']['metal']]);
        $after = $economy->settle(2, 2, self::START + 300, true, true);
        self::assertEqualsWithDelta($initial['storage']['metal'], $after['economy']['stock']['metal'], 0.00001);
        self::assertSame(0.0, $after['economy']['production']['metal']);
        self::assertGreaterThan(0, $after['material_flows']['capacity_loss']['metal']);
        self::assertEqualsWithDelta(
            $after['material_flows']['raw_output']['metal'],
            $after['material_flows']['capacity_loss']['metal'],
            0.00001
        );
    }

    public function testQueuedNpcConstructionRealizesDuringBoundedOfflineCatchup(): void
    {
        $db = $this->fixture();
        // This is another finite initial endowment, before the first NPC decision.
        $db->exec("UPDATE colonies SET metal=10000,crystal=10000,deuterium=10000,food=0 WHERE id=1; "
            . "INSERT INTO buildings (colony_id,type,level) VALUES (1,'hydroponic_farm',0); "
            . "UPDATE economy_npc_profiles SET window_budget_cents=10000000 WHERE user_id=1");
        $policy = new NpcStandingOrders($db);
        $first = $policy->decide(1, self::START);
        self::assertSame('executed', $first['production']['construction']['status']);
        self::assertSame('hydroponic_farm', $first['production']['construction']['building']);
        self::assertSame(0, (int)$db->query(
            "SELECT level FROM buildings WHERE colony_id=1 AND type='hydroponic_farm'"
        )->fetchColumn());
        $resume = self::START + 4 * 86400;
        $offline = $policy->decide(1, $resume);
        self::assertSame('deferred', $offline['status']);
        self::assertSame([], $offline['created']);
        self::assertSame(1, (int)$db->query(
            "SELECT level FROM buildings WHERE colony_id=1 AND type='hydroponic_farm'"
        )->fetchColumn());
        self::assertSame(1, (int)$db->query("SELECT COUNT(*) FROM building_upgrade_queue WHERE status='done'")->fetchColumn());
        self::assertSame(self::START + 86400, (int)$db->query(
            'SELECT settled_at FROM colony_economy_state WHERE colony_id=1'
        )->fetchColumn());
        self::assertSame('already_decided', $policy->decide(1, $resume)['status']);
    }

    public function testOfflineCatchupAndInterruptedAcquisitionRetryDoNotReplayOrSpendStaleStock(): void
    {
        $db = $this->fixture();
        $policy = new NpcStandingOrders($db);
        $requests = new EconomicRequests($db);
        foreach ([1, 2] as $id) {
            $policy->decide($id, self::START);
        }
        $requests->tick(self::START);
        self::assertTrue(execute_trader_strategy($db, ['id' => 1, 'specialization' => 'metal']));
        $before = $this->money($db);
        $db->exec("CREATE TRIGGER reject_buy BEFORE INSERT ON trader_transactions "
            . "BEGIN SELECT RAISE(ABORT,'interrupted acquisition'); END");
        try {
            process_route_transitions($db, self::START);
            self::fail('Acquisition should roll back.');
        } catch (PDOException $error) {
            self::assertStringContainsString('interrupted acquisition', $error->getMessage());
        }
        self::assertEqualsWithDelta($before, $this->money($db), 0.001);
        self::assertSame('planning', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        $db->exec('DROP TRIGGER reject_buy');
        process_route_transitions($db, self::START);
        self::assertSame('in_transit', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        $control = $this->fixture();
        $controlPolicy = new NpcStandingOrders($control);
        $controlPolicy->decide(1, self::START);
        $controlPolicy->decide(2, self::START);
        $controlRequests = new EconomicRequests($control);
        $controlRequests->tick(self::START);
        self::assertTrue(execute_trader_strategy($control, ['id' => 1, 'specialization' => 'metal']));
        process_route_transitions($control, self::START);
        self::assertSame(
            $control->query('SELECT status,quantity_acquired,price_paid,price_sold,buyer_escrow_cents FROM trader_routes')->fetch(),
            $db->query('SELECT status,quantity_acquired,price_paid,price_sold,buyer_escrow_cents FROM trader_routes')->fetch()
        );
        self::assertEqualsWithDelta($this->money($control), $this->money($db), 0.001);
        $human = $this->human($db);
        $resume = self::START + 4 * 86400;
        $beforeCount = (int)$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn();
        foreach ([1, 2] as $id) {
            $decision = $policy->decide($id, $resume);
            self::assertSame('deferred', $decision['status']);
            self::assertSame([], $decision['created']);
            self::assertSame('already_decided', $policy->decide($id, $resume + 1)['status']);
        }
        self::assertSame($beforeCount, (int)$db->query('SELECT COUNT(*) FROM economy_standing_orders')->fetchColumn());
        $requests->tick($resume);
        self::assertGreaterThan(0, (int)$db->query("SELECT COUNT(*) FROM economy_requests WHERE status='expired'")->fetchColumn());
        process_route_transitions($db, $resume);
        self::assertSame('in_transit', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        process_route_transitions($db, $resume);
        self::assertSame('in_transit', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        $route = $db->query('SELECT * FROM trader_routes')->fetch();
        $economy = new OnDemandEconomy($db);
        $target = (int)$route['target_colony_id'];
        $preDelivery = $economy->settle($target, $target, $resume, true);
        self::assertSame(0, $preDelivery['economy']['pending_seconds']);
        process_route_transitions($db, $resume);
        self::assertSame('completed', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        $postDelivery = $economy->inspect($target, $target, $resume);
        self::assertEqualsWithDelta(
            $preDelivery['economy']['stock'][$route['resource_type']] + $route['quantity_acquired'],
            $postDelivery['economy']['stock'][$route['resource_type']],
            0.00001
        );
        $after = $this->money($db);
        process_route_transitions($db, $resume);
        self::assertEqualsWithDelta($after, $this->money($db), 0.001);
        self::assertEqualsWithDelta($before, $after, 0.02);
        self::assertSame(2, (int)$db->query('SELECT COUNT(*) FROM trader_transactions')->fetchColumn());
        self::assertSame($human, $this->human($db));
        self::assertSame(HourlyWindow::id($resume), (int)$db->query(
            'SELECT last_window FROM economy_npc_profiles WHERE user_id=1'
        )->fetchColumn());
    }
}
