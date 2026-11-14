<?php

declare(strict_types=1);

use GalaxyQuest\Economy\TradeTransports;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../src/Economy/TradeTransports.php';

final class TradeTransportsProjectionTest extends TestCase
{
    public function testOnlyParticipantsSeeBackedInTransitShipmentsAndReadsDoNotMutate(): void
    {
        $db = new PDO('sqlite::memory:');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('CREATE TABLE economy_standing_orders (id INTEGER, user_id INTEGER, colony_id INTEGER, side TEXT)');
        $db->exec('CREATE TABLE fleets (id INTEGER, origin_x_ly REAL, origin_y_ly REAL, origin_z_ly REAL, target_x_ly REAL, target_y_ly REAL, target_z_ly REAL)');
        $db->exec('CREATE TABLE trader_routes (id INTEGER, fleet_id INTEGER, source_colony_id INTEGER, target_colony_id INTEGER, resource_type TEXT, quantity_acquired REAL, departure_at TEXT, arrival_at TEXT, status TEXT, funding_status TEXT, source_order_id INTEGER, target_order_id INTEGER)');
        $db->exec("INSERT INTO economy_standing_orders VALUES (1,10,20,'sell'),(2,11,21,'buy'),(3,12,99,'buy')");
        $db->exec('INSERT INTO fleets VALUES (7,1,2,3,4,5,6)');
        $db->exec("INSERT INTO trader_routes VALUES (9,7,20,21,'metal',5,'2026-01-01 00:00:00','2026-01-01 01:00:00','in_transit','backed',1,2)");
        $projection = new TradeTransports($db);
        self::assertCount(1, $projection->list(10));
        self::assertCount(1, $projection->list(11));
        self::assertSame([], $projection->list(12));
        self::assertSame([], $projection->list(13));
        self::assertSame([1.0, 2.0, 3.0], $projection->list(10)[0]['origin']);
        self::assertSame('in_transit', $db->query('SELECT status FROM trader_routes')->fetchColumn());
        $db->exec("UPDATE trader_routes SET status='completed'");
        self::assertSame([], $projection->list(10));
    }

    public function testRetiredEndpointsRequirePostAndCsrfAndNeverExchange(): void
    {
        $market = file_get_contents(__DIR__ . '/../../api/market.php');
        $economy = file_get_contents(__DIR__ . '/../../api/colony_economy.php');
        self::assertStringNotContainsString('->exchange(', $market);
        self::assertStringNotContainsString('->exchange(', $economy);
        self::assertMatchesRegularExpression("/function action_retired_trade\\(\\): never\\s*\\{\\s*only_method\\('POST'\\);\\s*verify_csrf\\(\\);.*?409/s", $market);
        self::assertMatchesRegularExpression("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);\\s*if \\(\\\$action === 'buy'.*?409/s", $economy);
    }
}
