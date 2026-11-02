<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class BodyResourceProfileTest extends TestCase
{
    public function testPlanetEstimatesKeepExistingGeneratorValues(): void
    {
        $body = [
            'body_type' => 'planet', 'planet_class' => 'rocky',
            'mass_earth' => 1.0, 'in_habitable_zone' => true,
        ];
        $expected = derive_planet_deposits('rocky', true, 1.0);
        $profile = derive_body_resource_profile($body);
        foreach (BodyResourceProfile::MINERALS as $resource) {
            $source = $profile['sources'][$resource];
            self::assertSame('finite', $source['source_type']);
            self::assertSame((float)$expected['deposit_' . $resource], $source['initial_quantity']);
            self::assertSame($source['initial_quantity'], $source['remaining_quantity']);
        }
    }

    public function testLegacySnapshotsPreserveDepletedAndUnlimitedDeposits(): void
    {
        $body = ['body_type' => 'planet', 'planet_class' => 'gas_giant', 'mass_earth' => 300];
        $legacy = [
            'deposit_metal' => 0, 'deposit_crystal' => 12,
            'deposit_deuterium' => -1, 'deposit_rare_earth' => 7,
        ];
        $sources = derive_body_resource_profile($body, $legacy)['sources'];
        self::assertSame(0.0, $sources['metal']['remaining_quantity']);
        self::assertSame(12.0, $sources['crystal']['remaining_quantity']);
        self::assertNull($sources['crystal']['initial_quantity']);
        self::assertSame('legacy_snapshot', $sources['crystal']['origin']);
        self::assertSame('unlimited', $sources['deuterium']['source_type']);
        self::assertNull($sources['deuterium']['remaining_quantity']);
        self::assertSame('atmospheric_extraction', $sources['deuterium']['extraction_method']);
        self::assertSame('deep_core_mining', $sources['metal']['extraction_method']);
    }

    public function testSmallMoonAndCometDoNotReceiveParentSizedReserves(): void
    {
        $planet = derive_body_resource_profile([
            'body_type' => 'planet', 'planet_class' => 'ice_dwarf', 'mass_earth' => 1,
        ]);
        foreach (['moon', 'comet', 'rogue_planet'] as $type) {
            $body = ['body_type' => $type, 'planet_class' => 'ice_dwarf', 'mass_earth' => 0.001];
            $profile = derive_body_resource_profile($body);
            self::assertSame($profile, derive_body_resource_profile($body));
            self::assertLessThan(
                $planet['sources']['metal']['remaining_quantity'] / 100,
                $profile['sources']['metal']['remaining_quantity']
            );
            self::assertArrayNotHasKey('biomass', $profile['sources']);
        }
    }

    public function testBiosphereRequiresLocalLiquidWaterAtmosphereAndTemperature(): void
    {
        $body = [
            'body_type' => 'planet', 'planet_class' => 'ocean', 'mass_earth' => 1,
            'water_state' => 'liquid', 'atmosphere_type' => 'nitrogen_oxygen',
            'habitability_score' => 80, 'eq_temp_k' => 280,
        ];
        $source = derive_body_resource_profile($body)['sources']['biomass'];
        self::assertSame('regenerating', $source['source_type']);
        self::assertSame(10000.0, $source['capacity']);
        self::assertSame(10.0, $source['regeneration_per_hour']);
        foreach ([
            ['water_state' => 'solid'], ['atmosphere_type' => 'none'], ['habitability_score' => 64],
            ['eq_temp_k' => 100], ['eq_temp_k' => 400], ['body_type' => 'rogue_planet'],
        ] as $override) {
            self::assertArrayNotHasKey('biomass', derive_body_resource_profile(array_replace($body, $override))['sources']);
        }
        unset($body['mass_earth']);
        self::assertArrayNotHasKey('biomass', derive_body_resource_profile($body)['sources']);
    }

    public function testUnassessedIsNotTheSameAsDepleted(): void
    {
        foreach ([
            ['body_type' => 'ring_system', 'composition' => 'water_ice', 'optical_depth' => 0.8],
            ['body_type' => 'moon', 'planet_class' => 'unknown'],
        ] as $body) {
            $profile = derive_body_resource_profile($body);
            self::assertSame('unassessed', $profile['assessment']);
            self::assertSame([], $profile['sources']);
        }
        $depleted = derive_body_resource_profile(['deposit_metal' => 0]);
        self::assertSame('estimated', $depleted['assessment']);
        self::assertSame(0.0, $depleted['sources']['metal']['remaining_quantity']);
    }

    public function testInvalidValuesAreRejected(): void
    {
        foreach ([
            ['deposit_metal' => -2], ['deposit_metal' => INF], ['deposit_metal' => 'not-a-number'],
            ['deposit_metal' => 1, 'richness_metal' => -1], ['mass_earth' => -1],
            ['mass_earth' => NAN],
        ] as $body) {
            try {
                derive_body_resource_profile($body);
                self::fail('Invalid profile accepted.');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }

    public function testGeneratedCatalogProfilesAreDeterministicAndDoNotChangeGeometry(): void
    {
        $before = generate_star_system(1, 1234);
        $after = generate_star_system(1, 1234);
        self::assertSame($before, $after);
        self::assertNotEmpty($before['bodies']);
        foreach ($before['bodies'] as $body) {
            self::assertSame(BodyResourceProfile::VERSION, $body['resource_profile']['version']);
            self::assertSame(derive_body_resource_profile($body), $body['resource_profile']);
        }
        self::assertSame($before['planets'][0]['local_x'], $before['bodies'][0]['local_x']);
    }
}
