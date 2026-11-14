<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit\TraderFleetArrivalIsolation;

use PDO;
use PHPUnit\Framework\TestCase;

function handle_fleet_arrival(PDO $db, array $fleet): void
{
    $db->prepare('INSERT INTO processed_arrivals (fleet_id) VALUES (?)')->execute([(int)$fleet['id']]);
}

final class TraderFleetArrivalIsolationTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);
        foreach (['fleet_trader_route_table_exists', 'process_fleet_arrival_locked'] as $name) {
            $start = strpos($source, 'function ' . $name . '(');
            self::assertNotFalse($start, $name . ' must exist.');
            $end = strpos($source, "\nfunction ", $start + 1);
            self::assertNotFalse($end, $name . ' must have a bounded body.');
            eval('namespace ' . __NAMESPACE__ . '; use PDO; ' . substr($source, $start, $end - $start));
        }
    }

    public function testRouteOwnedFleetSkipsOrdinaryArrivalButOtherFleetsStillResolve(): void
    {
        $db = new PDO('sqlite::memory:', null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $db->sqliteCreateFunction('NOW', static fn(): string => date('Y-m-d H:i:s'));
        $db->exec(<<<'SQL'
            CREATE TABLE fleets (id INTEGER PRIMARY KEY, arrival_time TEXT);
            CREATE TABLE trader_routes (id INTEGER PRIMARY KEY, fleet_id INTEGER);
            CREATE TABLE processed_arrivals (fleet_id INTEGER);
            INSERT INTO fleets VALUES (1, datetime('now', '-1 hour')), (2, datetime('now', '-1 hour'));
            INSERT INTO trader_routes VALUES (1, 1);
            SQL);

        process_fleet_arrival_locked($db, 1);
        process_fleet_arrival_locked($db, 2);

        self::assertSame([2], array_map(
            'intval',
            $db->query('SELECT fleet_id FROM processed_arrivals ORDER BY fleet_id')->fetchAll(PDO::FETCH_COLUMN)
        ));
        self::assertSame(2, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
    }
}
