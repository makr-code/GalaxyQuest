<?php

declare(strict_types=1);

use GalaxyQuest\Economy\OnDemandEconomy;
use PHPUnit\Framework\TestCase;

final class OnDemandEconomyTest extends TestCase
{
    private PDO $db;
    private OnDemandEconomy $economy;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->db->exec(<<<'SQL'
            PRAGMA foreign_keys=ON;
            CREATE TABLE users (id INTEGER PRIMARY KEY, credits REAL DEFAULT 100000);
            CREATE TABLE celestial_bodies (
                id INTEGER PRIMARY KEY, galaxy_index INTEGER, system_index INTEGER, position INTEGER
            );
            CREATE TABLE planets (
                id INTEGER PRIMARY KEY, temp_max INTEGER, richness_metal REAL, richness_crystal REAL,
                richness_deuterium REAL, richness_rare_earth REAL,
                deposit_metal REAL, deposit_crystal REAL, deposit_deuterium REAL, deposit_rare_earth REAL
            );
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY, user_id INTEGER, body_id INTEGER, planet_id INTEGER,
                name TEXT, colony_type TEXT DEFAULT 'balanced',
                metal REAL DEFAULT 10000, crystal REAL DEFAULT 10000, deuterium REAL DEFAULT 10000,
                rare_earth REAL DEFAULT 1000, food REAL DEFAULT 500,
                population INTEGER DEFAULT 100, max_population INTEGER DEFAULT 500,
                happiness INTEGER DEFAULT 80, public_services INTEGER DEFAULT 100,
                energy INTEGER DEFAULT 100, last_update TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE buildings (
                id INTEGER PRIMARY KEY, colony_id INTEGER, type TEXT, level INTEGER DEFAULT 0,
                upgrade_end TEXT, UNIQUE(colony_id,type)
            );
            CREATE TABLE building_upgrade_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT, colony_id INTEGER, building_type TEXT,
                target_level INTEGER, cost_metal INTEGER, cost_crystal INTEGER, cost_deuterium INTEGER,
                duration_secs INTEGER, queued_at TEXT, started_at TEXT, eta TEXT, status TEXT
            );
            CREATE TABLE colony_building_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT, colony_id INTEGER, slot_x INTEGER, slot_y INTEGER,
                building_type TEXT, level INTEGER, UNIQUE(colony_id,slot_x,slot_y)
            );
            CREATE TABLE economy_construction_slots (
                queue_id INTEGER PRIMARY KEY, slot_id INTEGER, target_level INTEGER
            );
            CREATE TABLE economy_processed_goods (
                id INTEGER PRIMARY KEY, colony_id INTEGER, good_type TEXT, quantity REAL, capacity REAL,
                production_rate_per_hour REAL, consumption_rate_per_hour REAL,
                last_calculated_at TEXT, UNIQUE(colony_id,good_type)
            );
            CREATE TABLE economy_pop_classes (
                id INTEGER PRIMARY KEY, colony_id INTEGER, pop_class TEXT, count INTEGER,
                satisfaction_ticks INTEGER DEFAULT 0, shortage_ticks INTEGER DEFAULT 0,
                satisfaction_index REAL DEFAULT 50, employment_level REAL DEFAULT 80,
                UNIQUE(colony_id,pop_class)
            );
            CREATE TABLE economy_policies (
                user_id INTEGER PRIMARY KEY, global_policy TEXT DEFAULT 'free_market',
                tax_income REAL DEFAULT 0.15, tax_trade REAL DEFAULT 0.05, tax_production REAL DEFAULT 0,
                subsidy_agriculture INTEGER DEFAULT 0, subsidy_research INTEGER DEFAULT 0,
                subsidy_military INTEGER DEFAULT 0
            );
            CREATE TABLE economy_production_methods (
                colony_id INTEGER, building_type TEXT, method TEXT, UNIQUE(colony_id,building_type)
            );
            CREATE TABLE colony_economy_state (colony_id INTEGER PRIMARY KEY, settled_at INTEGER, state_json TEXT);
            CREATE TABLE body_development (
                body_id INTEGER PRIMARY KEY REFERENCES celestial_bodies(id) ON DELETE CASCADE,
                version INTEGER NOT NULL, peak_population INTEGER NOT NULL, founded_count INTEGER NOT NULL,
                initialized_at INTEGER NOT NULL, observed_at INTEGER NOT NULL
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
                scope_id INTEGER, galaxy_index INTEGER, system_index INTEGER DEFAULT 0,
                good_key TEXT NOT NULL DEFAULT '', modifier_json TEXT, starts_at INTEGER, ends_at INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(window_id, event_type, scope_type, scope_id, good_key)
            );
            INSERT INTO users (id) VALUES (1),(2);
            INSERT INTO celestial_bodies VALUES (1,1,1,1),(2,1,2,1),(3,2,1,1);
            INSERT INTO colonies (id,user_id,body_id,name) VALUES (1,1,1,'Alpha'),(2,2,2,'Beta'),(3,2,3,'Gamma');
            INSERT INTO buildings (colony_id,type,level) VALUES
                (1,'metal_mine',1),(1,'solar_plant',10),(1,'hydroponic_farm',1),
                (1,'hospital',1),(1,'habitat',1),(1,'metallurgy',1),(1,'food_silo',10);
            INSERT INTO research VALUES (1,'energy_tech',1),(1,'computer_tech',1),(1,'quantum_computing',1);
            SQL);
        $this->economy = new OnDemandEconomy($this->db);
    }

    public function testSnapshotInitializesPopulationAndCatalogAndDoesNotInventHistoricalProduction(): void
    {
        $snapshot = $this->economy->settle(1, 1, 1000000);
        self::assertSame(100, $snapshot['pop_classes']['colonist']);
        self::assertCount(18, $snapshot['catalog']);
        self::assertSame('standard', $snapshot['methods']['metallurgy']);
        self::assertGreaterThan(0, $snapshot['storage']['metal']);
        self::assertSame(1000000, $snapshot['economy']['settled_at']);
        self::assertSame(0.0, $snapshot['economy']['stock']['steel_alloy'] ?? 0.0);
        self::assertSame(23, (int)$this->db->query('SELECT COUNT(*) FROM economy_colony_market')->fetchColumn());
    }

    public function testRepeatedReadDoesNotWriteOrChangePopulation(): void
    {
        $this->economy->settle(1, 1, 1000000);
        $writes = $this->db->query('SELECT total_changes()')->fetchColumn();
        $snapshot = $this->economy->settle(1, 1, 1000000);
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
        self::assertSame(100, array_sum($snapshot['pop_classes']));
    }

    public function testBodyDevelopmentTracksSettledPopulationOnlyWhenEnabled(): void
    {
        $this->db->exec('UPDATE colonies SET population=40000 WHERE id=1');
        $snapshot = $this->economy->settle(1, 1, 1000000);
        if (!\GalaxyQuest\Terrain\BodyDevelopment::enabled()) {
            self::assertNull($snapshot['body_development']);
            self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_development')->fetchColumn());
            return;
        }
        self::assertSame(40000, $snapshot['body_development']['peak_population']);
        self::assertSame(6, $snapshot['body_development']['founded_count']);
        $this->db->exec('UPDATE colonies SET population=100 WHERE id=1');
        $declined = $this->economy->settle(1, 1, 1000000);
        self::assertSame(100, $declined['colony']['population']);
        self::assertSame($snapshot['body_development'], $declined['body_development']);
        self::assertSame($snapshot['body_development'], \GalaxyQuest\Terrain\BodyDevelopment::read($this->db, 1));
    }

    public function testUnauthorizedDevelopmentObservationCannotWrite(): void
    {
        try {
            $this->economy->settle(1, 2, 1000000);
            self::fail('An unrelated owner must not settle or observe this body.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_development')->fetchColumn());
    }

    public function testActualLedgerProcessesProductionAndUpdatesMarketOnDemand(): void
    {
        $this->economy->settle(1, 1, 1000000);
        $snapshot = $this->economy->settle(1, 1, 1003600);
        self::assertGreaterThan(0, $snapshot['economy']['stock']['steel_alloy']);
        $market = $this->economy->market(1, 1);
        self::assertGreaterThan(0, $market['goods']['steel_alloy']['quantity']);
        self::assertSame(1003600, $market['goods']['metal']['oldest_settled_at']);
    }

    public function testMacroReadDoesNotSettleDormantColoniesOrHideFreshness(): void
    {
        $this->economy->settle(1, 1, 1000000);
        $this->economy->settle(2, 2, 1000300);
        $this->economy->settle(3, 2, 1000600);
        $writes = $this->db->query('SELECT total_changes()')->fetchColumn();
        $market = $this->economy->market(1);
        self::assertSame(2, $market['goods']['food']['represented_colonies']);
        self::assertSame(1000000, $market['goods']['food']['oldest_settled_at']);
        self::assertSame(1000300, $market['goods']['food']['newest_settled_at']);
        self::assertSame(3, $this->economy->market()['goods']['food']['represented_colonies']);
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
    }

    public function testOwnershipDenialLeavesLedgerUntouched(): void
    {
        try {
            $this->economy->settle(1, 2, 1000000);
            self::fail('Foreign colony must not be accessible.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
    }

    public function testNestedRollbackRestoresAllEconomicChanges(): void
    {
        $this->db->beginTransaction();
        $this->economy->settle(1, 1, 1000000);
        self::assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
    }

    public function testFoodBoughtAtMarketGoesIntoActualFoodLedger(): void
    {
        $before = (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn();
        $result = $this->economy->exchange(1, 1, 'food', 10, true);
        self::assertEqualsWithDelta(510, (float)$this->db->query('SELECT food FROM colonies WHERE id=1')->fetchColumn(), 0.01);
        self::assertEqualsWithDelta(
            $before - $result['total_credits'],
            (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn(),
            0.01
        );
        self::assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM economy_processed_goods WHERE good_type='food'"
        )->fetchColumn());
    }

    public function testOversellingFailsAtomicallyAndNeverPaysForMissingGoods(): void
    {
        try {
            $this->economy->exchange(1, 1, 'food', 100000, false);
            self::fail('Missing goods must not be sold.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        self::assertSame(100000.0, (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_market_transactions')->fetchColumn());
    }

    public function testStorageOverflowRejectsWholePurchase(): void
    {
        $this->expectException(DomainException::class);
        $this->economy->exchange(1, 1, 'consumer_goods', 5001, true);
    }

    public function testLegacyRawMarketStockIsReconciledExactlyOnce(): void
    {
        $this->db->exec(
            "INSERT INTO economy_processed_goods (colony_id,good_type,quantity,capacity) VALUES (1,'food',20,5000)"
        );
        $this->economy->settle(1, 1, 1000000);
        $this->economy->settle(1, 1, 1000000);
        self::assertSame(520.0, (float)$this->db->query('SELECT food FROM colonies WHERE id=1')->fetchColumn());
    }

    public function testConstructionAndSurfacePlacementShareOneEconomicBuilding(): void
    {
        $queued = $this->economy->queue(1, 1, 'metallurgy', [1, 1]);
        self::assertSame(2, $queued['target_level']);
        $end = (string)$this->db->query('SELECT eta FROM building_upgrade_queue')->fetchColumn();
        $snapshot = $this->economy->settle(1, 1, strtotime($end . ' UTC') + 300);
        self::assertSame(1, (int)$snapshot['slots'][0]['level']);
        self::assertSame(2, (int)$this->db->query(
            "SELECT level FROM buildings WHERE colony_id=1 AND type='metallurgy'"
        )->fetchColumn());
        self::assertSame('done', $this->db->query('SELECT status FROM building_upgrade_queue')->fetchColumn());
    }

    public function testProductionMethodValidationAndPersistence(): void
    {
        $this->economy->method(1, 1, 'metallurgy', 'efficient');
        self::assertSame('efficient', $this->db->query('SELECT method FROM economy_production_methods')->fetchColumn());
        self::assertSame('efficient', $this->economy->settle(1, 1)['methods']['metallurgy']);
        $this->expectException(DomainException::class);
        $this->economy->method(1, 1, 'metallurgy', 'unlimited');
    }

    public function testMarketPriceHasDocumentedBounds(): void
    {
        self::assertSame(3.0, OnDemandEconomy::price('metal', 1e12, 100000, 1));
        self::assertSame(35.0, OnDemandEconomy::price('metal', 0, 0, 1e12));
        self::assertSame(35.0, OnDemandEconomy::price('metal', 0, 0, 1e12, 2.0, 2.0));
        self::assertSame(3.0, OnDemandEconomy::price('metal', 1e12, 100000, 1, 0.5));
    }

    public function testWorldEventScalesRegionalPriceQuoteOnlyWhileActive(): void
    {
        $this->economy->settle(1, 1, 1000000);
        $this->economy->settle(2, 2, 1000000);
        $this->db->exec("UPDATE economy_colony_market SET quantity=24, production=0, consumption=1 WHERE good_type='metal'");
        $baseline = $this->economy->market(1, 1, 1000100)['goods']['metal']['price'];
        self::assertSame(10.0, $baseline);
        $this->addEvent('system', 1, 1, 'metal', ['price' => 1.3], 1000000, 1003600);

        $active = $this->economy->market(1, 1, 1000100);
        self::assertSame(1.3, $active['goods']['metal']['event_price_modifier']);
        self::assertSame(1.0, $active['goods']['food']['event_price_modifier']);
        self::assertSame(13.0, $active['goods']['metal']['price']);
        self::assertSame('Versorgungsschock', $active['world_events'][0]['label']);
        self::assertSame(1.0, $this->economy->market(1, 2, 1000100)['goods']['metal']['event_price_modifier']);
        self::assertSame([], $this->economy->market(null, null, 1000100)['world_events']);

        $expired = $this->economy->market(1, 1, 1003600);
        self::assertSame($baseline, $expired['goods']['metal']['price']);
        self::assertSame([], $expired['world_events']);
    }

    public function testWorldEventProductionAppliesOnlyToOverlappingSettleTime(): void
    {
        $settle = function (?array $event): float {
            $this->setUp();
            $this->economy->settle(1, 1, 1000000);
            if ($event !== null) {
                $this->addEvent('system', 1, 1, 'metal', ['production' => 0.5], ...$event);
            }
            return (float)$this->economy->settle(1, 1, 1003600)['economy']['stock']['metal'];
        };
        $baseline = $settle(null);
        self::assertLessThan($baseline, $settle([1000000, 1003600]));
        self::assertSame($baseline, $settle([1003600, 1010800]));
        self::assertSame($baseline, $settle([900000, 1000000]));
    }

    /** @param array<string, float> $modifiers */
    private function addEvent(
        string $scope,
        int $galaxy,
        int $system,
        string $good,
        array $modifiers,
        int $startsAt,
        int $endsAt
    ): void {
        $this->db->prepare(
            'INSERT INTO world_events (window_id, event_type, scope_type, scope_id, galaxy_index, system_index, '
                . 'good_key, modifier_json, starts_at, ends_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            intdiv($startsAt, 3600), 'supply_shock', $scope, $galaxy * 100000 + $system, $galaxy, $system,
            $good, json_encode($modifiers, JSON_THROW_ON_ERROR), $startsAt, $endsAt,
        ]);
    }

    public function testOfflineBacklogIsPersistedAcrossBoundedRequests(): void
    {
        $this->economy->settle(1, 1, 1000000);
        $first = $this->economy->settle(1, 1, 1259200);
        self::assertSame(172800, $first['economy']['pending_seconds']);
        $second = $this->economy->settle(1, 1, 1259200);
        self::assertSame(86400, $second['economy']['pending_seconds']);
    }

    public function testResourcePurchaseRollsBackWhenQueueInsertionFails(): void
    {
        try {
            $this->economy->spend(1, 1, ['metal' => 100], static function (): never {
                throw new RuntimeException('Queue insertion failed.');
            });
            self::fail('Callback failure must propagate.');
        } catch (RuntimeException $error) {
            self::assertSame('Queue insertion failed.', $error->getMessage());
        }
        self::assertSame(10000.0, (float)$this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
        self::assertFalse($this->db->inTransaction());
    }

    public function testPolicyChangesAreValidatedAndPersisted(): void
    {
        $this->economy->configure(1, 'tax_income', 0.2);
        $this->economy->configure(1, 'global_policy', 'autarky');
        $this->economy->configure(1, 'subsidy_agriculture', true);
        $row = $this->db->query('SELECT * FROM economy_policies WHERE user_id=1')->fetch();
        self::assertSame(0.2, (float)$row['tax_income']);
        self::assertSame('autarky', $row['global_policy']);
        self::assertSame(1, (int)$row['subsidy_agriculture']);
        $this->expectException(DomainException::class);
        $this->economy->exchange(1, 1, 'food', 1, true);
    }

    public function testPolicyReadUsesSimulationDefaultsWithoutCreatingPolicyRows(): void
    {
        $policy = $this->economy->policy(1);
        self::assertSame(['income' => 0.15, 'production' => 0.0, 'trade' => 0.05], $policy['taxes']);
        self::assertSame(0.0001, $policy['tax_steps']['income']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_policies')->fetchColumn());
    }

    public function testFirstPolicyWritePreservesOtherEffectiveDefaults(): void
    {
        $this->db->exec('DROP TABLE economy_policies');
        $this->db->exec(<<<'SQL'
            CREATE TABLE economy_policies (
                user_id INTEGER PRIMARY KEY, global_policy INTEGER DEFAULT 50,
                tax_income INTEGER DEFAULT 20, tax_trade INTEGER DEFAULT 15, tax_resources INTEGER DEFAULT 10,
                subsidy_agriculture INTEGER DEFAULT 5, subsidy_research INTEGER DEFAULT 10,
                subsidy_military INTEGER DEFAULT 3
            )
            SQL);
        $this->economy = new OnDemandEconomy($this->db);
        $this->economy->configure(1, 'tax_income', 0.01);
        $policy = $this->economy->policy(1);
        self::assertSame('free_market', $policy['global_policy']);
        self::assertSame(['income' => 0.01, 'production' => 0.0, 'trade' => 0.05], $policy['taxes']);
        self::assertSame(['agriculture' => false, 'research' => false, 'military' => false], $policy['subsidies']);
    }

    public function testIntegerSchemaPreservesZeroOnePercentAndMaximumTaxes(): void
    {
        $this->db->exec(<<<'SQL'
            DROP TABLE economy_policies;
            CREATE TABLE economy_policies (
                user_id INTEGER PRIMARY KEY, global_policy INTEGER DEFAULT 0,
                tax_income INTEGER DEFAULT 15, tax_trade INTEGER DEFAULT 5, tax_resources INTEGER DEFAULT 0,
                subsidy_agriculture INTEGER DEFAULT 0, subsidy_research INTEGER DEFAULT 0,
                subsidy_military INTEGER DEFAULT 0
            );
            SQL);
        $this->economy = new OnDemandEconomy($this->db);
        self::assertSame(0.01, $this->economy->policy(1)['tax_steps']['production']);
        foreach (['income' => 0.4, 'production' => 0.3, 'trade' => 0.25] as $type => $max) {
            foreach ([0.0, 0.01, $max] as $rate) {
                $this->economy->configure(1, 'tax_' . $type, $rate);
                self::assertSame($rate, $this->economy->policy(1)['taxes'][$type]);
            }
        }
        $this->economy->configure(1, 'tax_trade', 0.01);
        $this->economy->exchange(1, 1, 'food', 1, true);
        self::assertSame(0.01, (float)$this->db->query('SELECT trade_tax_rate FROM economy_market_transactions')->fetchColumn());
    }

    public function testDeliveryPreservesOverflowAndDoesNotCreditTreasuryTwice(): void
    {
        $this->economy->settle(1, 1, time() - 3600);
        $this->economy->receive(1, ['consumer_goods' => 6000]);
        $credits = (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn();
        $this->economy->receive(1, ['consumer_goods' => 10]);
        self::assertEqualsWithDelta(6010, (float)$this->db->query(
            "SELECT quantity FROM economy_processed_goods WHERE colony_id=1 AND good_type='consumer_goods'"
        )->fetchColumn(), 0.001);
        self::assertEqualsWithDelta(
            $credits,
            (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn(),
            0.001
        );
    }

    public function testLegacySurfaceIndustryBecomesAnEconomicBuildingOnce(): void
    {
        $this->db->exec(
            "INSERT INTO colony_building_slots (colony_id,slot_x,slot_y,building_type,level) "
                . "VALUES (1,1,1,'consumer_factory',3)"
        );
        $this->economy->settle(1, 1, 1000000);
        self::assertSame(3, (int)$this->db->query(
            "SELECT level FROM buildings WHERE colony_id=1 AND type='consumer_factory'"
        )->fetchColumn());
        $this->economy->settle(1, 1, 1000000);
        self::assertSame(3, (int)$this->db->query(
            "SELECT level FROM buildings WHERE colony_id=1 AND type='consumer_factory'"
        )->fetchColumn());
    }
}
