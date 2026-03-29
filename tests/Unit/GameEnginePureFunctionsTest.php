<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class GameEnginePureFunctionsTest extends TestCase
{
    public function testMetalProductionMatchesFormula(): void
    {
        $level = 3;
        $expected = 30 * $level * pow(1.1, $level) * GAME_SPEED;
        $this->assertEqualsWithDelta($expected, metal_production($level), 0.0001);
    }

    public function testDeuteriumProductionIsClampedAtZero(): void
    {
        $this->assertSame(0.0, deuterium_production(10, 500));
    }

    public function testBuildingCostUsesFallbackDefinition(): void
    {
        $cost = building_cost('unknown_building', 3);

        $this->assertSame(135, $cost['metal']);
        $this->assertSame(34, $cost['crystal']);
        $this->assertSame(0, $cost['deuterium']);
    }

    public function testBuildingBuildTimeScalesWithRoboticsAndNanite(): void
    {
        $cost = ['metal' => 20000, 'crystal' => 10000, 'deuterium' => 0];

        $base = building_build_time($cost, 0, 0);
        $faster = building_build_time($cost, 4, 1);

        $this->assertGreaterThan(1, $base);
        $this->assertLessThan($base, $faster);
    }

    public function testResearchTimeHasMinimumOfOneSecond(): void
    {
        $this->assertSame(1, research_time(['metal' => 0, 'crystal' => 0, 'deuterium' => 0], 0));
    }

    public function testColonyLayoutProfileContainsExpectedGridAndScale(): void
    {
        $profile = colony_layout_profile(['diameter' => 10000, 'planet_class' => 'rocky']);

        $this->assertSame(7, (int)$profile['grid']['cols']);
        $this->assertSame(5, (int)$profile['grid']['rows']);
        $this->assertSame(35, (int)$profile['grid']['surface_slots']);
        $this->assertSame('small', (string)$profile['planet_scale']['tier']);
        $this->assertGreaterThanOrEqual(2, (int)$profile['grid']['orbital_slots']);
    }

    public function testResearchCostDoublesEachLevel(): void
    {
        $level2 = research_cost('energy_tech', 2);
        $level3 = research_cost('energy_tech', 3);

        // Base is metal=0, crystal=800, deuterium=400
        // Level 2: crystal = 800 * 2^1 = 1600; Level 3: 800 * 2^2 = 3200
        $this->assertSame(1600, $level2['crystal']);
        $this->assertSame(3200, $level3['crystal']);
        $this->assertSame(1600, $level3['crystal'] / 2);
    }

    public function testResearchCostFallsBackToDefaultForUnknownType(): void
    {
        $cost = research_cost('nonexistent_tech', 1);

        // Fallback base: crystal=800, deuterium=400 at level 1 (factor^0 = 1)
        $this->assertSame(800, $cost['crystal']);
        $this->assertSame(400, $cost['deuterium']);
    }

    public function testVesselManifestFiltersZeroCountShips(): void
    {
        $ships = ['light_fighter' => 5, 'cruiser' => 0, 'battleship' => 3];
        $manifest = vessel_manifest($ships);

        $types = array_column($manifest, 'type');
        $this->assertContains('light_fighter', $types);
        $this->assertContains('battleship', $types);
        $this->assertNotContains('cruiser', $types);
        $this->assertCount(2, $manifest);
    }

    public function testVesselManifestCapsCountPerType(): void
    {
        $ships = ['destroyer' => 50];
        $manifest = vessel_manifest($ships, 8);

        $this->assertSame(50, $manifest[0]['count']);
        $this->assertSame(8, $manifest[0]['sample_count']);
    }

    public function testUserEmpireColorReturnsValidHexColor(): void
    {
        foreach ([1, 5, 10, 11, 99, 100] as $uid) {
            $color = user_empire_color($uid);
            $this->assertMatchesRegularExpression('/^#[0-9a-fA-F]{6}$/', $color,
                "user_empire_color($uid) returned invalid hex: $color");
        }
    }

    public function testApplyFogOfWarUnknownStripsAllPlayerData(): void
    {
        $response = [
            'planets'            => [
                ['position' => 1, 'player_planet' => ['name' => 'HomeWorld']],
                ['position' => 2, 'player_planet' => null],
            ],
            'fleets_in_system'   => [['id' => 99]],
            'star_installations' => [['type' => 'stargate']],
        ];

        $result = apply_fog_of_war($response, 'unknown', null, null);

        $this->assertSame('unknown', $result['visibility']['level']);
        $this->assertNull($result['planets'][0]['player_planet']);
        $this->assertNull($result['planets'][1]['player_planet']);
        $this->assertEmpty($result['fleets_in_system']);
        $this->assertEmpty($result['star_installations']);
    }

    public function testApplyFogOfWarOwnReturnsFullData(): void
    {
        $response = [
            'planets'            => [['position' => 1, 'player_planet' => ['name' => 'Capital']]],
            'fleets_in_system'   => [['id' => 7]],
            'star_installations' => [['type' => 'relay_station']],
        ];

        $result = apply_fog_of_war($response, 'own', '2026-01-01 00:00:00', null);

        $this->assertSame('own', $result['visibility']['level']);
        $this->assertSame('Capital', $result['planets'][0]['player_planet']['name']);
        $this->assertCount(1, $result['fleets_in_system']);
        $this->assertCount(1, $result['star_installations']);
    }

    public function testBuildingDefinitionsContainsCoreBuildings(): void
    {
        $defs = building_definitions();

        $required = ['metal_mine', 'solar_plant', 'research_lab', 'shipyard',
                     'robotics_factory', 'colony_hq', 'nanite_factory'];
        foreach ($required as $key) {
            $this->assertArrayHasKey($key, $defs, "Missing building: $key");
            $this->assertArrayHasKey('category', $defs[$key]);
            $this->assertArrayHasKey('zone', $defs[$key]);
        }
        $this->assertGreaterThanOrEqual(20, count($defs));
    }
}
