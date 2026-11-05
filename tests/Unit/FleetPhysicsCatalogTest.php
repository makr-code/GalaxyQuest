<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Fleet\FleetPhysicsCatalog;
use InvalidArgumentException;
use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once __DIR__ . '/../../src/Fleet/FleetPhysicsCatalog.php';

final class FleetPhysicsCatalogTest extends TestCase
{
    private function database(): PDO
    {
        $db = new PDO('sqlite::memory:');
        $db->exec(
            'CREATE TABLE ship_physics_specs (
                ship_type TEXT PRIMARY KEY,
                mass_kg REAL NOT NULL,
                thrust_newtons REAL NOT NULL,
                max_sublight_speed_m_s REAL NOT NULL
            )'
        );
        return $db;
    }

    public function testLoadsOnlyRequestedTypesAndDoesNotRequireUnusedRows(): void
    {
        $db = $this->database();
        $db->exec(
            "INSERT INTO ship_physics_specs VALUES
                ('scout', 1200, 400, 9000000),
                ('hauler', 5000, 0, 1200000),
                ('unrelated', 2000, 50, 3000000)"
        );

        $specifications = (new FleetPhysicsCatalog($db))->requireFleetSpecifications([
            'scout' => 2,
            'hauler' => 1,
            'unconfigured_but_unused' => 0,
        ]);

        $expected = [
            'scout' => [
                'mass_kg' => 1200.0,
                'thrust_newtons' => 400.0,
                'max_sublight_speed_m_s' => 9000000.0,
            ],
            'hauler' => [
                'mass_kg' => 5000.0,
                'thrust_newtons' => 0.0,
                'max_sublight_speed_m_s' => 1200000.0,
            ],
        ];
        ksort($expected);
        ksort($specifications);
        self::assertSame($expected, $specifications);
    }

    public function testMissingPhysicalDataIsAnExplicitError(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Missing physical specifications for ship types: scout');

        (new FleetPhysicsCatalog($this->database()))->requireFleetSpecifications(['scout' => 1]);
    }

    public function testInvalidCatalogValuesAreRejected(): void
    {
        $db = $this->database();
        $db->exec("INSERT INTO ship_physics_specs VALUES ('scout', 1200, 400, 9000000)");
        $db->exec('UPDATE ship_physics_specs SET mass_kg = 0 WHERE ship_type = "scout"');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Invalid physical specification stored for ship type scout.');
        (new FleetPhysicsCatalog($db))->requireFleetSpecifications(['scout' => 1]);
    }

    public function testEmptyOrMalformedFleetCompositionIsRejected(): void
    {
        $catalog = new FleetPhysicsCatalog($this->database());
        try {
            $catalog->requireFleetSpecifications(['scout' => 0]);
            self::fail('An empty fleet must not produce a physics specification.');
        } catch (InvalidArgumentException $exception) {
            self::assertSame('A physical fleet specification requires at least one ship.', $exception->getMessage());
        }

        $this->expectException(InvalidArgumentException::class);
        $catalog->requireFleetSpecifications(['scout' => -1]);
    }
}
