<?php

declare(strict_types=1);

use GalaxyQuest\Economy\EconomicRequests;
use GalaxyQuest\Economy\NpcStandingOrders;
use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\StandingOrders;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../Unit/TraderRouteLogisticsTest.php';
require_once __DIR__ . '/../../src/Economy/EconomicRequests.php';

final class EconomicRequestsTest extends TestCase
{
    private const NOW = 1800000000;
    private PDO $db;
    private EconomicRequests $requests;

    protected function setUp(): void
    {
        $this->db = TraderRouteLogisticsTest::createLedgerFixture();
        $this->db->exec(<<<'SQL'
            ALTER TABLE users ADD COLUMN control_type TEXT DEFAULT 'npc_engine';
            ALTER TABLE users ADD COLUMN auth_enabled INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL;
            ALTER TABLE users ADD COLUMN email TEXT DEFAULT 'fixture@example.org';
            ALTER TABLE users ADD COLUMN email_notifications INTEGER DEFAULT 1;
            UPDATE users SET control_type='human',auth_enabled=1 WHERE id=2;
            UPDATE colonies SET population=0;
            UPDATE colonies SET food=0,population=100 WHERE id=1;
            UPDATE npc_traders SET active_fleets=0;
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
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,receiver_id INTEGER,subject TEXT,body TEXT
            );
            CREATE TABLE mail_outbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,kind TEXT,dedupe_key TEXT UNIQUE,
                subject TEXT,body_text TEXT,body_html TEXT,status TEXT,attempts INTEGER,next_attempt_at INTEGER,
                last_error TEXT,sent_at TEXT
            );
            SQL);
        $economy = new OnDemandEconomy($this->db);
        $economy->settle(1, 1, self::NOW, true);
        $economy->settle(2, 2, self::NOW, true);
        $controller = new NpcStandingOrders($this->db);
        $controller->bind(1, 1, 'subsistence', 100000, false);
        $controller->decide(1, self::NOW);
        $this->requests = new EconomicRequests($this->db);
    }

    public function testScopedBoundedInviteDedupesMessagesAndDoesNotTouchHumanOrDormantState(): void
    {
        $this->db->exec(<<<'SQL'
            INSERT INTO users (id,control_type,auth_enabled) VALUES (3,'human',1);
            INSERT INTO celestial_bodies VALUES (3,2,1,1);
            INSERT INTO colonies (id,user_id,body_id,name) VALUES (3,3,3,'Hidden galaxy');
            SQL);
        $before = $this->humanLedger();
        $request = $this->invite();
        self::assertSame($before, $this->humanLedger());
        self::assertSame(2, $request['colony_id']);
        self::assertSame('supply', $request['type']);
        self::assertLessThanOrEqual(100, $request['quantity']);
        self::assertNull($this->requests->offer(1, self::NOW + 1));
        self::assertSame([], $this->requests->list(3, 3, self::NOW));
        self::assertSame(1, $this->rowsCount('messages'));
        self::assertSame(1, $this->rowsCount('mail_outbox'));
        self::assertArrayNotHasKey('npc_user_id', $request);
        self::assertArrayNotHasKey('npc_order_id', $request);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state WHERE colony_id=3')->fetchColumn());
    }

    public function testAcceptanceSplitsOnlyExactBackingIntoPrivateReciprocalOrdersAndIsIdempotent(): void
    {
        $request = $this->invite();
        $beforeCredits = $this->db->query('SELECT SUM(credits) FROM users')->fetchColumn();
        $beforeStock = $this->stock(2, $request['good_type']);
        $escrow = $this->db->query('SELECT SUM(escrow_cents) FROM economy_standing_orders')->fetchColumn();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        self::assertSame('accepted', $accepted['status']);
        $sell = $accepted['player_order'];
        self::assertSame($request['quantity'], $sell['quantity_initial']);
        self::assertSame($request['price_cents'], $sell['limit_price_cents']);
        self::assertSame('sell', $sell['side']);
        self::assertSame(0, $sell['escrow_cents']);
        self::assertEquals($beforeStock - $request['quantity'], $this->stock(2, $request['good_type']));
        self::assertSame($beforeCredits, $this->db->query('SELECT SUM(credits) FROM users')->fetchColumn());
        self::assertSame($escrow, $this->db->query('SELECT SUM(escrow_cents) FROM economy_standing_orders')->fetchColumn());
        $pair = (new StandingOrders($this->db))->read((int)$sell['paired_order_id'], 1);
        self::assertSame($sell['id'], (int)$pair['paired_order_id']);
        self::assertSame($request['quantity'], $pair['quantity_remaining']);
        self::assertSame($request['quantity'] * ($request['price_cents'] + 1), $pair['escrow_cents']);
        self::assertSame($accepted, $this->requests->respond(2, $request['id'], 'accept', self::NOW + 86400));
        self::assertSame($accepted, $this->requests->respond(2, $request['id'], 'decline', self::NOW + 1));
        self::assertSame(1, $this->rowsCount('messages'));
        self::assertSame(1, $this->rowsCount('mail_outbox'));
    }

    public function testNormalRoutesFulfilPrivatePairAndCannotMatchAnArbitraryBuyer(): void
    {
        $request = $this->invite();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        $trader = $this->db->query('SELECT * FROM npc_traders WHERE id=1')->fetch();
        self::assertTrue(execute_trader_strategy($this->db, $trader));
        process_route_transitions($this->db, self::NOW);
        $route = $this->db->query('SELECT * FROM trader_routes ORDER BY id DESC LIMIT 1')->fetch();
        self::assertSame('in_transit', $route['status']);
        self::assertSame($accepted['player_order']['id'], (int)$route['source_order_id']);
        self::assertSame((int)$accepted['player_order']['paired_order_id'], (int)$route['target_order_id']);
        self::assertSame($request['quantity'], (int)$route['quantity_acquired']);
        $now = strtotime($route['arrival_at']) + 1;
        process_route_transitions($this->db, $now);
        self::assertSame('completed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT SUM(buyer_escrow_cents) FROM trader_routes')->fetchColumn());
    }

    public function testIgnoringInvitationDoesNotBlockAutonomousNpcTradingOrDebitHuman(): void
    {
        $request = $this->invite();
        $this->db->exec(<<<'SQL'
            INSERT INTO celestial_bodies VALUES (3,1,3,1);
            INSERT INTO star_systems VALUES (1,3,200,0,0);
            INSERT INTO colonies (id,user_id,body_id,name,population,food) VALUES (3,10,3,'NPC supplier',0,100);
            SQL);
        $orders = new StandingOrders($this->db);
        $orders->create(10, 3, 'sell', $request['good_type'], $request['quantity'],
            StandingOrders::money($request['price_cents'] - 1), self::NOW);
        $before = $this->humanLedger();
        self::assertTrue(execute_trader_strategy($this->db, $this->db->query('SELECT * FROM npc_traders')->fetch()));
        process_route_transitions($this->db, self::NOW);
        self::assertSame('in_transit', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertSame($before, $this->humanLedger());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_standing_orders WHERE user_id=2')->fetchColumn());
        self::assertSame('unavailable', $this->requests->list(2, 2, self::NOW)[0]['status']);
        self::assertSame('unavailable', $this->requests->respond(2, $request['id'], 'accept', self::NOW)['status']);
        self::assertSame($before, $this->humanLedger());
    }

    public function testOutstandingInboxCapIsEnforcedAcrossDifferentActors(): void
    {
        $this->invite();
        foreach ([4, 5, 6] as $npc) {
            $this->db->prepare('INSERT INTO users (id) VALUES (?)')->execute([$npc]);
            $this->db->prepare('INSERT INTO celestial_bodies VALUES (?,1,?,1)')->execute([$npc, $npc]);
            $this->db->prepare('INSERT INTO colonies (id,user_id,body_id,name,food,population) VALUES (?,?,?,?,0,100)')
                ->execute([$npc, $npc, $npc, 'NPC']);
            $this->db->prepare('INSERT INTO economy_policies (user_id,tax_income) VALUES (?,0)')->execute([$npc]);
            if ($npc === 4) {
                $this->db->prepare('UPDATE colonies SET population=0,food=1000 WHERE id=?')->execute([$npc]);
            }
            (new OnDemandEconomy($this->db))->settle($npc, $npc, self::NOW, true);
            $controller = new NpcStandingOrders($this->db);
            $controller->bind($npc, $npc, 'subsistence', 100000, false);
            $controller->decide($npc, self::NOW);
            $request = $this->requests->offer($npc, self::NOW);
            if ($npc === 6) {
                self::assertNull($request);
            } else {
                self::assertNotNull($request);
                if ($npc === 4) {
                    self::assertSame('purchase', $request['type']);
                }
            }
        }
        self::assertSame(3, $this->rowsCount('economy_requests'));
        self::assertSame(3, $this->rowsCount('messages'));
        self::assertSame(3, $this->rowsCount('mail_outbox'));
    }

    public function testWrongPrivateCounterpartyRouteCannotTakeReservedGoodsOrEscrow(): void
    {
        $request = $this->invite();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        $other = (new StandingOrders($this->db))->create(1, 1, 'buy', $request['good_type'], $request['quantity'],
            StandingOrders::money($request['price_cents'] + 100), self::NOW);
        $this->db->prepare('INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,'
            . "quantity_planned,status,source_order_id,target_order_id,funding_status) VALUES (1,2,1,?,?,'planning',?,?,'backed')")
            ->execute([$request['good_type'], $request['quantity'], $accepted['player_order']['id'], $other['id']]);
        $before = $this->humanLedger();
        process_route_transitions($this->db, self::NOW);
        self::assertSame('failed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertSame($before, $this->humanLedger());
        self::assertSame($request['quantity'], (new StandingOrders($this->db))->read($accepted['player_order']['id'], 2)['quantity_remaining']);
    }

    public function testAcceptanceWriteFailureRollsBackResourceReservationAndNpcSplit(): void
    {
        $request = $this->invite();
        $before = $this->humanLedger();
        $orders = $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll();
        $this->db->exec("CREATE TRIGGER reject_request_accept BEFORE UPDATE OF status ON economy_requests "
            . "WHEN NEW.status='accepted' BEGIN SELECT RAISE(ABORT,'fixture accept failure'); END");
        try {
            $this->requests->respond(2, $request['id'], 'accept', self::NOW);
            self::fail('Failed request state must roll back reservations.');
        } catch (PDOException $error) {
            self::assertStringContainsString('fixture accept failure', $error->getMessage());
        }
        self::assertSame($before, $this->humanLedger());
        self::assertSame($orders, $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll());
        self::assertSame('pending', $this->db->query('SELECT status FROM economy_requests')->fetchColumn());
    }

    public function testNotificationFailureRollsBackInvitationAndMessageWithoutChangingBacking(): void
    {
        $before = $this->humanLedger();
        $orders = $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll();
        $this->db->exec("CREATE TRIGGER reject_request_mail BEFORE INSERT ON mail_outbox "
            . "BEGIN SELECT RAISE(ABORT,'fixture mail enqueue failure'); END");
        try {
            $this->requests->offer(1, self::NOW);
            self::fail('Outbox enqueue failure must roll back the invitation.');
        } catch (PDOException $error) {
            self::assertStringContainsString('fixture mail enqueue failure', $error->getMessage());
        }
        self::assertSame(0, $this->rowsCount('economy_requests'));
        self::assertSame(0, $this->rowsCount('messages'));
        self::assertSame($before, $this->humanLedger());
        self::assertSame($orders, $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll());
    }

    public function testPairedCancellationNeverRefundsInFlightBuyerBackingOrRepeatsReservation(): void
    {
        $request = $this->invite();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        $this->db->prepare('INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,'
            . "quantity_planned,status,source_order_id,target_order_id,funding_status) VALUES (1,2,1,?,1,'planning',?,?,'backed')")
            ->execute([$request['good_type'], $accepted['player_order']['id'], $accepted['player_order']['paired_order_id']]);
        process_route_transitions($this->db, self::NOW);
        $route = $this->db->query('SELECT * FROM trader_routes')->fetch();
        self::assertSame('in_transit', $route['status']);
        $escrow = (int)$route['buyer_escrow_cents'];
        self::assertSame($request['price_cents'] + 1, $escrow);
        $cancelled = (new StandingOrders($this->db))->cancel(2, $accepted['player_order']['id'], self::NOW);
        self::assertSame('cancelled', $cancelled['status']);
        self::assertSame($escrow, (int)$this->db->query('SELECT buyer_escrow_cents FROM trader_routes')->fetchColumn());
        $before = $this->humanLedger();
        $duplicate = $this->requests->respond(2, $request['id'], 'accept', self::NOW + 1);
        self::assertSame($cancelled['id'], $duplicate['player_order']['id']);
        self::assertSame('cancelled', $duplicate['player_order']['status']);
        self::assertSame($before, $this->humanLedger());
        process_route_transitions($this->db, strtotime($route['arrival_at']) + 1);
        self::assertSame('completed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT buyer_escrow_cents FROM trader_routes')->fetchColumn());
    }

    public function testTwoPlayersCannotAcceptSameFinalNpcQuantity(): void
    {
        $first = $this->invite();
        $this->addPlayerThree();
        $second = $this->requests->offer(1, self::NOW + 3600);
        self::assertNotNull($second);
        self::assertSame(3, $second['colony_id']);
        $firstAccepted = $this->requests->respond(2, $first['id'], 'accept', self::NOW + 3600);
        $before = $this->humanLedger();
        self::assertSame('unavailable', $this->requests->respond(3, $second['id'], 'accept', self::NOW + 3600)['status']);
        self::assertSame($before, $this->humanLedger());
        self::assertSame($first['quantity'], $firstAccepted['player_order']['quantity_remaining']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_standing_orders WHERE user_id=3')->fetchColumn());
    }

    public function testInsufficientGoodsRollBackEntireAcceptanceAndCanBeRetried(): void
    {
        $request = $this->invite();
        $this->db->exec('UPDATE colonies SET food=0 WHERE id=2');
        $before = $this->humanLedger();
        $orders = $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll();
        try {
            $this->requests->respond(2, $request['id'], 'accept', self::NOW);
            self::fail('Insufficient goods must fail.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        self::assertSame($before, $this->humanLedger());
        self::assertSame($orders, $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll());
        self::assertSame('pending', $this->db->query('SELECT status FROM economy_requests')->fetchColumn());
        (new OnDemandEconomy($this->db))->receive(2, ['food' => 100], self::NOW);
        self::assertSame('accepted', $this->requests->respond(2, $request['id'], 'accept', self::NOW)['status']);
    }

    public function testNpcCancellationFundingFailureAndChangedPolicyCannotSpendPlayerGoods(): void
    {
        $request = $this->invite();
        $npcId = (int)$this->db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        $this->db->exec('UPDATE economy_standing_orders SET escrow_cents=0 WHERE id=' . $npcId);
        $before = $this->humanLedger();
        self::assertSame('unavailable', $this->requests->respond(2, $request['id'], 'accept', self::NOW)['status']);
        self::assertSame($before, $this->humanLedger());
    }

    public function testDeclineAndExactDeadlineAreFreeIdempotentAndReadsNeverWrite(): void
    {
        $request = $this->invite();
        $before = $this->humanLedger();
        $writes = $this->db->query('SELECT total_changes()')->fetchColumn();
        self::assertSame('expired', $this->requests->list(2, 2, $request['expires_at'])[0]['status']);
        self::assertSame($writes, $this->db->query('SELECT total_changes()')->fetchColumn());
        self::assertSame('pending', $this->db->query('SELECT status FROM economy_requests')->fetchColumn());
        self::assertSame('expired', $this->requests->respond(2, $request['id'], 'accept', $request['expires_at'])['status']);
        self::assertSame('expired', $this->requests->respond(2, $request['id'], 'decline', $request['expires_at'])['status']);
        self::assertSame($before, $this->humanLedger());
        self::assertSame(1, $this->rowsCount('mail_outbox'));
    }

    public function testDeclineAndHourlyDefaultReleaseNothingAndOptOutIsRecordedWithoutSending(): void
    {
        $this->db->exec('UPDATE users SET email_notifications=0 WHERE id=2');
        $request = $this->invite();
        $before = $this->humanLedger();
        self::assertSame('skipped', $this->db->query('SELECT status FROM mail_outbox')->fetchColumn());
        $declined = $this->requests->respond(2, $request['id'], 'decline', self::NOW);
        self::assertSame('declined', $declined['status']);
        self::assertSame($declined, $this->requests->respond(2, $request['id'], 'decline', self::NOW + 1));
        self::assertSame($before, $this->humanLedger());
        $this->db->exec("UPDATE economy_requests SET status='pending'");
        self::assertSame(1, $this->requests->tick($request['expires_at'])['expired']);
        self::assertSame($before, $this->humanLedger());
        self::assertSame(1, $this->rowsCount('mail_outbox'));
        self::assertSame(0, (int)$this->db->query('SELECT SUM(attempts) FROM mail_outbox')->fetchColumn());
    }

    public function testDeclineDoesNotDependOnNpcColonyStillBeingOwnedByOriginalActor(): void
    {
        $request = $this->invite();
        $this->db->exec('UPDATE colonies SET user_id=10 WHERE id=1');
        $before = $this->humanLedger();
        $declined = $this->requests->respond(2, $request['id'], 'decline', self::NOW);
        self::assertSame('declined', $declined['status']);
        self::assertSame($declined, $this->requests->respond(2, $request['id'], 'decline', self::NOW + 1));
        self::assertSame($before, $this->humanLedger());
    }

    public function testExplicitPairedCancellationRefundsOnlyUnallocatedBackingAndNpcDoesNotExpireCommitment(): void
    {
        $request = $this->invite();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        $pairId = (int)$accepted['player_order']['paired_order_id'];
        (new NpcStandingOrders($this->db))->decide(1, self::NOW + 25 * 3600);
        self::assertSame('active', (new StandingOrders($this->db))->read($pairId, 1)['status']);
        $stock = $this->stock(2, 'food');
        (new StandingOrders($this->db))->cancel(2, $accepted['player_order']['id'], self::NOW + 24 * 3600);
        self::assertEquals($stock + $request['quantity'], $this->stock(2, 'food'));
        self::assertSame('cancelled', (new StandingOrders($this->db))->read($pairId, 1)['status']);
    }

    public function testForeignOwnerAndTransferredColonyHaveNoAccess(): void
    {
        $request = $this->invite();
        try {
            $this->requests->respond(10, $request['id'], 'accept', self::NOW);
            self::fail('Foreign owner must be denied.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        $this->db->exec('UPDATE colonies SET user_id=10 WHERE id=2');
        $this->expectException(DomainException::class);
        $this->requests->list(2, 2, self::NOW);
    }

    public function testPurchaseCarvesPolicySurplusAndReservesOnlyTheQuotedMaximum(): void
    {
        $request = $this->purchaseInvite();
        $source = (int)$this->db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        $orders = new StandingOrders($this->db);
        $original = $orders->read($source, 1);
        $stock = $this->stock(1, $request['good_type']);
        $credits = (float)$this->db->query('SELECT credits FROM users WHERE id=2')->fetchColumn();
        $accepted = $this->requests->respond(2, $request['id'], 'accept', self::NOW);
        $buy = $accepted['player_order'];
        $sell = $orders->read((int)$buy['paired_order_id'], 1);
        self::assertSame('accepted', $accepted['status']);
        self::assertSame('buy', $buy['side']);
        self::assertSame($request['total_cents'], $buy['escrow_cents']);
        self::assertEqualsWithDelta($credits - $request['total_cents'] / 100,
            (float)$this->db->query('SELECT credits FROM users WHERE id=2')->fetchColumn(), 0.00001);
        self::assertSame('sell', $sell['side']);
        self::assertSame($request['price_cents'] - 1, $sell['limit_price_cents']);
        self::assertSame($buy['id'], (int)$sell['paired_order_id']);
        self::assertSame($original['quantity_remaining'], $orders->read($source, 1)['quantity_remaining'] + $sell['quantity_remaining']);
        self::assertEquals($stock, $this->stock(1, $request['good_type']));
        self::assertSame($accepted, $this->requests->respond(2, $request['id'], 'accept', self::NOW + 1));
        $trader = $this->db->query('SELECT * FROM npc_traders WHERE id=1')->fetch();
        $npcCredits = (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn();
        $traderCredits = (float)$trader['capital_credits'];
        self::assertTrue(execute_trader_strategy($this->db, $trader));
        process_route_transitions($this->db, self::NOW);
        $route = $this->db->query('SELECT * FROM trader_routes ORDER BY id DESC LIMIT 1')->fetch();
        self::assertSame('in_transit', $route['status']);
        self::assertSame($sell['id'], (int)$route['source_order_id']);
        self::assertSame($buy['id'], (int)$route['target_order_id']);
        self::assertSame($request['total_cents'], (int)$route['buyer_escrow_cents']);
        self::assertEqualsWithDelta($npcCredits + $request['quantity'] * ($request['price_cents'] - 1) / 100,
            (float)$this->db->query('SELECT credits FROM users WHERE id=1')->fetchColumn(), 0.00001);
        $playerStock = $this->stock(2, $request['good_type']);
        process_route_transitions($this->db, strtotime($route['arrival_at']) + 1);
        self::assertSame('completed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
        self::assertEquals($playerStock + $request['quantity'], $this->stock(2, $request['good_type']));
        self::assertSame(0, (int)$this->db->query('SELECT buyer_escrow_cents FROM trader_routes')->fetchColumn());
        self::assertEqualsWithDelta($traderCredits + $request['quantity'] / 100,
            (float)$this->db->query('SELECT capital_credits FROM npc_traders WHERE id=1')->fetchColumn(), 0.00001);
    }

    public function testPurchaseInsufficientCreditsAndAutarkyRollBackAndAllowRetry(): void
    {
        $request = $this->purchaseInvite();
        $this->db->exec('UPDATE users SET credits=0 WHERE id=2');
        foreach (['free_market', 'autarky'] as $policy) {
            $this->db->prepare('UPDATE economy_policies SET global_policy=? WHERE user_id=2')->execute([$policy]);
            $before = $this->humanLedger();
            $orders = $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll();
            try {
                $this->requests->respond(2, $request['id'], 'accept', self::NOW);
                self::fail('Purchase must not reserve under this policy or balance.');
            } catch (DomainException $error) {
                self::assertSame(409, $error->getCode());
            }
            self::assertSame($before, $this->humanLedger());
            self::assertSame($orders, $this->db->query('SELECT * FROM economy_standing_orders')->fetchAll());
            self::assertSame('pending', $this->db->query('SELECT status FROM economy_requests')->fetchColumn());
        }
        $this->db->exec("UPDATE economy_policies SET global_policy='free_market' WHERE user_id=2");
        $this->db->exec('UPDATE users SET credits=100000 WHERE id=2');
        self::assertSame('accepted', $this->requests->respond(2, $request['id'], 'accept', self::NOW)['status']);
    }

    public function testPurchaseCancellationDeclineAndExpiryAreFree(): void
    {
        $request = $this->purchaseInvite();
        $before = $this->humanLedger();
        $source = (int)$this->db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        (new StandingOrders($this->db))->cancel(1, $source, self::NOW);
        self::assertSame('unavailable', $this->requests->list(2, 2, self::NOW)[0]['status']);
        self::assertSame('unavailable', $this->requests->respond(2, $request['id'], 'accept', self::NOW)['status']);
        self::assertSame($before, $this->humanLedger());
        $this->db->exec("UPDATE economy_requests SET status='pending'");
        self::assertSame('declined', $this->requests->respond(2, $request['id'], 'decline', self::NOW)['status']);
        self::assertSame($before, $this->humanLedger());
        $this->db->exec("UPDATE economy_requests SET status='pending'");
        self::assertSame('expired', $this->requests->list(2, 2, $request['expires_at'])[0]['status']);
        self::assertSame('expired', $this->requests->respond(2, $request['id'], 'accept', $request['expires_at'])['status']);
        self::assertSame($before, $this->humanLedger());
    }

    public function testCompetingPurchasesCannotCarveTheSameGoodsTwice(): void
    {
        $first = $this->purchaseInvite();
        $source = (int)$this->db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        // Return the excess reservation to the NPC before reducing the public order.
        $original = (new StandingOrders($this->db))->read($source, 1);
        (new OnDemandEconomy($this->db))->receive(1, [
            $first['good_type'] => $original['quantity_remaining'] - $first['quantity'],
        ], self::NOW);
        $this->db->prepare('UPDATE economy_standing_orders SET quantity_remaining=? WHERE id=?')
            ->execute([$first['quantity'], $source]);
        $this->addPlayerThree();
        $second = $this->requests->offer(1, self::NOW + 3600);
        self::assertNotNull($second);
        self::assertSame('purchase', $second['type']);
        self::assertSame('accepted', $this->requests->respond(2, $first['id'], 'accept', self::NOW + 3600)['status']);
        $before = $this->humanLedger();
        self::assertSame('unavailable', $this->requests->respond(3, $second['id'], 'accept', self::NOW + 3600)['status']);
        self::assertSame($before, $this->humanLedger());
    }

    public function testUnbackedOrUnmanagedSellCannotGeneratePurchaseOffers(): void
    {
        $request = $this->purchaseInvite();
        $source = (int)$this->db->query('SELECT npc_order_id FROM economy_requests')->fetchColumn();
        $this->addPlayerThree();
        $this->db->exec('UPDATE economy_standing_orders SET quantity_remaining=0 WHERE id=' . $source);
        self::assertNull($this->requests->offer(1, self::NOW + 3600));
        self::assertSame('unavailable', $this->requests->list(2, 2, self::NOW)[0]['status']);
        $this->db->prepare('UPDATE economy_standing_orders SET quantity_remaining=? WHERE id=?')
            ->execute([$request['quantity'], $source]);
        $this->db->exec('DELETE FROM economy_npc_orders WHERE order_id=' . $source);
        self::assertNull($this->requests->offer(1, self::NOW + 3600));
    }

    public function testPurchaseCancellationKeepsAlreadyAllocatedRouteEscrow(): void
    {
        $request = $this->purchaseInvite();
        $buy = $this->requests->respond(2, $request['id'], 'accept', self::NOW)['player_order'];
        $this->db->prepare('INSERT INTO trader_routes (trader_id,source_colony_id,target_colony_id,resource_type,'
            . "quantity_planned,status,source_order_id,target_order_id,funding_status) VALUES (1,1,2,?,1,'planning',?,?,'backed')")
            ->execute([$request['good_type'], $buy['paired_order_id'], $buy['id']]);
        process_route_transitions($this->db, self::NOW);
        $route = $this->db->query('SELECT * FROM trader_routes')->fetch();
        self::assertSame('in_transit', $route['status']);
        self::assertSame($request['price_cents'], (int)$route['buyer_escrow_cents']);
        $balance = (float)$this->db->query('SELECT credits FROM users WHERE id=2')->fetchColumn();
        (new StandingOrders($this->db))->cancel(2, $buy['id'], self::NOW);
        self::assertEqualsWithDelta($balance + ($request['total_cents'] - $request['price_cents']) / 100,
            (float)$this->db->query('SELECT credits FROM users WHERE id=2')->fetchColumn(), 0.00001);
        self::assertSame($request['price_cents'], (int)$this->db->query('SELECT buyer_escrow_cents FROM trader_routes')->fetchColumn());
        process_route_transitions($this->db, strtotime($route['arrival_at']) + 1);
        self::assertSame('completed', $this->db->query('SELECT status FROM trader_routes')->fetchColumn());
    }

    private function purchaseInvite(): array
    {
        $orders = new StandingOrders($this->db);
        foreach ($this->db->query("SELECT id FROM economy_standing_orders WHERE user_id=1 AND status='active'")->fetchAll() as $row) {
            $orders->cancel(1, (int)$row['id'], self::NOW);
        }
        $this->db->exec('UPDATE colonies SET population=0,food=1000 WHERE id=1');
        $this->db->exec('UPDATE economy_npc_profiles SET last_window=NULL WHERE user_id=1');
        $summary = (new NpcStandingOrders($this->db))->decide(1, self::NOW);
        $sells = array_values(array_filter($summary['created'], static fn(array $order): bool => $order['side'] === 'sell'));
        self::assertNotEmpty($sells);
        foreach (array_slice($sells, 1) as $order) {
            $orders->cancel(1, $order['id'], self::NOW);
        }
        $before = $this->humanLedger();
        $request = $this->invite();
        self::assertSame('purchase', $request['type']);
        self::assertSame($before, $this->humanLedger());
        self::assertSame($request['quantity'] * $request['price_cents'], $request['total_cents']);
        self::assertStringContainsString('maximal', $request['consent']);
        $message = $this->db->query('SELECT body FROM messages')->fetchColumn();
        self::assertStringContainsString(StandingOrders::money($request['price_cents']) . ' Credits je Einheit', $message);
        self::assertStringContainsString('höchstens ' . StandingOrders::money($request['total_cents']) . ' Credits', $message);
        self::assertStringContainsString('ohne garantierten Termin', $message);
        self::assertSame(1, $this->rowsCount('mail_outbox'));
        return $request;
    }

    public function testActualApiHandlerRejectsWrongMethodsAndCsrfBeforeAnyLedgerWrite(): void
    {
        if (!function_exists('GalaxyQuest\\Tests\\EconomicRequestApi\\action_economic_request')) {
            $extract = static function (string $source, string $name): string {
                $start = strpos($source, 'function ' . $name . '(');
                $end = strpos($source, "\nfunction ", $start + 1);
                return substr($source, $start, $end - $start);
            };
            $helpers = file_get_contents(__DIR__ . '/../../api/helpers.php');
            $api = file_get_contents(__DIR__ . '/../../api/market.php');
            eval('namespace GalaxyQuest\\Tests\\EconomicRequestApi; use PDO; use DomainException; '
                . 'function json_error(string $message, int $status = 400): never { throw new DomainException($message, $status); }'
                . 'function session_start_secure(): void {} function current_user_id(): ?int { return null; }'
                . $extract($helpers, 'csrf_token')
                . $extract($helpers, 'verify_csrf')
                . $extract($helpers, 'only_method')
                . $extract($helpers, 'require_auth')
                . $extract($api, 'action_economic_request'));
        }
        $server = $_SERVER;
        $session = $_SESSION ?? null;
        $post = $_POST;
        $before = $this->db->query('SELECT total_changes()')->fetchColumn();
        try {
            $_SESSION = ['csrf_token' => 'fixture-csrf'];
            $_POST = [];
            foreach ([['GET', '', 405], ['POST', '', 403], ['POST', 'wrong-token', 403]] as [$method, $token, $code]) {
                $_SERVER['REQUEST_METHOD'] = $method;
                $_SERVER['HTTP_X_CSRF_TOKEN'] = $token;
                try {
                    \GalaxyQuest\Tests\EconomicRequestApi\action_economic_request($this->db, 2, 'accept');
                    self::fail('Guard must reject before mutation.');
                } catch (DomainException $error) {
                    self::assertSame($code, $error->getCode());
                }
            }
            try {
                \GalaxyQuest\Tests\EconomicRequestApi\require_auth();
                self::fail('Unauthenticated request must be denied.');
            } catch (DomainException $error) {
                self::assertSame(401, $error->getCode());
            }
            self::assertSame($before, $this->db->query('SELECT total_changes()')->fetchColumn());
        } finally {
            $_SERVER = $server;
            $_POST = $post;
            if ($session === null) {
                unset($_SESSION);
            } else {
                $_SESSION = $session;
            }
        }
    }

    private function invite(): array
    {
        $request = $this->requests->offer(1, self::NOW);
        self::assertNotNull($request);
        return $request;
    }

    private function addPlayerThree(): void
    {
        $this->db->exec(<<<'SQL'
            INSERT INTO users (id,control_type,auth_enabled) VALUES (3,'human',1);
            INSERT INTO celestial_bodies VALUES (3,1,3,1);
            INSERT INTO star_systems VALUES (1,3,200,0,0);
            INSERT INTO colonies (id,user_id,body_id,name,population) VALUES (3,3,3,'Competitor',0);
            INSERT INTO economy_policies (user_id,tax_income) VALUES (3,0);
            SQL);
        (new OnDemandEconomy($this->db))->settle(3, 3, self::NOW, true);
    }

    private function humanLedger(): array
    {
        return [$this->db->query("SELECT id,credits FROM users WHERE control_type='human' ORDER BY id")->fetchAll(),
            $this->db->query('SELECT * FROM colonies WHERE user_id<>1 ORDER BY id')->fetchAll(),
            $this->db->query('SELECT * FROM colony_economy_state WHERE colony_id<>1 ORDER BY colony_id')->fetchAll()];
    }

    private function stock(int $cid, string $good): float
    {
        if (in_array($good, \GalaxyQuest\Economy\ColonyEconomySimulation::PRIMARY, true)) {
            $statement = $this->db->prepare('SELECT ' . $good . ' FROM colonies WHERE id=?');
            $statement->execute([$cid]);
        } else {
            $statement = $this->db->prepare('SELECT quantity FROM economy_processed_goods WHERE colony_id=? AND good_type=?');
            $statement->execute([$cid, $good]);
        }
        return (float)$statement->fetchColumn();
    }

    private function rowsCount(string $table): int
    {
        return (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
    }
}
