<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Terrain\BodyTerrain;

require_once __DIR__ . '/../../lib/BodyTerrain.php';

final class BodyTerrainTest extends TestCase
{
    private PDO $db;
    private array $body;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('CREATE TABLE body_terrain_manifests (body_id INTEGER PRIMARY KEY, manifest_json TEXT NOT NULL)');
        $this->db->exec('CREATE TABLE body_terrain_tiles (
            body_id INTEGER, generator_version INTEGER, face INTEGER, lod INTEGER, tile_x INTEGER, tile_y INTEGER,
            tile_json TEXT NOT NULL, PRIMARY KEY (body_id, generator_version, face, lod, tile_x, tile_y))');
        $this->body = ['id' => 7, 'body_uid' => 'planet:1:2:3', 'diameter_km' => 12742, 'planet_class' => 'ocean', 'body_type' => 'planet'];
    }

    public function testManifestIsPersistedIndependentlyOfColonyAndLaterMetadata(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $changed = $this->body;
        $changed['diameter_km'] = 1;
        $changed['planet_class'] = 'lava';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $changed));
        self::assertEquals(6371.0, $manifest['radius_km']);
        self::assertSame('ocean', $manifest['biome']);
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_manifests')->fetchColumn());
    }

    public function testReadOnlyManifestAndTileGenerationDoesNotPersistCacheRows(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body, false);
        $tile = BodyTerrain::tile(
            $this->db,
            $manifest,
            ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0],
            false
        );

        self::assertSame(7, $manifest['body_id']);
        self::assertCount(289, $tile['heights']);
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_manifests')->fetchColumn());
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_tiles')->fetchColumn());
    }

    public function testReadOnlyLegacyManifestUpgradeDoesNotPersistTheCompatibilityShape(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        unset($manifest['shape']);
        $this->db->prepare('UPDATE body_terrain_manifests SET manifest_json = ? WHERE body_id = ?')
            ->execute([json_encode($manifest, JSON_THROW_ON_ERROR), $this->body['id']]);

        $loaded = BodyTerrain::manifest($this->db, $this->body, false);
        $stored = json_decode(
            (string)$this->db->query('SELECT manifest_json FROM body_terrain_manifests')->fetchColumn(),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        self::assertArrayHasKey('shape', $loaded);
        self::assertArrayNotHasKey('shape', $stored);
    }

    public function testGeoJsonRegionsShareHeightAndMaterialMasksAcrossHolesAndDateline(): void
    {
        $polygon = [
            [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]],
            [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]],
        ];
        $dateline = [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]];
        $body = $this->body;
        $body['payload_json'] = json_encode(['terrain_regions' => [
            'type' => 'FeatureCollection',
            'features' => [
                ['type' => 'Feature', 'properties' => [
                    'material' => 'water', 'height_offset_km' => 2, 'transition_km' => 0.25,
                ], 'geometry' => ['type' => 'Polygon', 'coordinates' => $polygon]],
                ['type' => 'Feature', 'properties' => ['material' => 'ice'],
                    'geometry' => ['type' => 'MultiPolygon', 'coordinates' => [
                        [[ [50, -5], [55, -5], [55, 5], [50, 5], [50, -5] ]],
                        [[ [60, -5], [65, -5], [65, 5], [60, 5], [60, -5] ]],
                    ]]],
                ['type' => 'Feature', 'properties' => ['color' => '#AABBCC', 'height_offset_km' => -1],
                    'geometry' => ['type' => 'Polygon', 'coordinates' => [$dateline]]],
            ],
        ]], JSON_THROW_ON_ERROR);
        $manifest = BodyTerrain::manifest($this->db, $body);
        $baselineBody = $this->body;
        $baselineBody['id'] = 8;
        $baseline = BodyTerrain::manifest($this->db, $baselineBody);
        $direction = static function (float $longitude): array {
            $longitude = deg2rad($longitude);
            return [cos($longitude), 0, sin($longitude)];
        };

        self::assertSame('FeatureCollection', $manifest['regions']['type']);
        self::assertCount(3, $manifest['regions']['features']);
        self::assertSame('MultiPolygon', $manifest['regions']['features'][1]['geometry']['type']);
        self::assertSame('custom', $manifest['regions']['features'][2]['properties']['material']);
        self::assertSame('#AABBCC', $manifest['regions']['features'][2]['properties']['color']);
        $coverageAt = static fn (float $longitude) => BodyTerrain::terrainRegionCoverages(
            $manifest['regions'],
            $direction($longitude),
            $manifest['radius_km']
        );
        $holeCoverage = $coverageAt(0);
        $landCoverage = $coverageAt(10);
        $dateCoverage = $coverageAt(179);
        self::assertSame(0.0, $holeCoverage[0]);
        self::assertEqualsWithDelta(1, $landCoverage[0], 1e-12);
        self::assertEqualsWithDelta(1, $dateCoverage[2], 1e-12);
        self::assertEqualsWithDelta(
            2,
            BodyTerrain::height($manifest, $direction(10)) - BodyTerrain::height($baseline, $direction(10)),
            1e-8
        );
        self::assertEqualsWithDelta(
            0,
            BodyTerrain::height($manifest, $direction(0)) - BodyTerrain::height($baseline, $direction(0)),
            1e-8
        );
        self::assertEqualsWithDelta(
            -1,
            BodyTerrain::height($manifest, $direction(179)) - BodyTerrain::height($baseline, $direction(179)),
            1e-8
        );
        self::assertGreaterThan($baseline['height_max_km'], $manifest['height_max_km'] - 0.01);
        $regionTile = BodyTerrain::tile($this->db, $manifest, ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0]);
        $baseTile = BodyTerrain::tile($this->db, $baseline, ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0]);
        $decode = static fn (array $tile, array $source, int $index) =>
            $source['height_min_km'] + $tile['heights'][$index] / 65535
                * ($source['height_max_km'] - $source['height_min_km']);
        self::assertEqualsWithDelta(2, $decode($regionTile, $manifest, 8 * 17 + 6)
            - $decode($baseTile, $baseline, 8 * 17 + 6), 0.001);
        $regionDatelineTile = BodyTerrain::tile($this->db, $manifest, ['face' => 1, 'lod' => 0, 'x' => 0, 'y' => 0]);
        $baseDatelineTile = BodyTerrain::tile($this->db, $baseline, ['face' => 1, 'lod' => 0, 'x' => 0, 'y' => 0]);
        self::assertEqualsWithDelta(-1, $decode($regionDatelineTile, $manifest, 8 * 17 + 8)
            - $decode($baseDatelineTile, $baseline, 8 * 17 + 8), 0.001);
    }

    public function testGeoJsonRegionsRejectUnclosedRingsAndUnsupportedGeometry(): void
    {
        $body = $this->body;
        $body['payload_json'] = json_encode(['terrain_regions' => [
            'type' => 'FeatureCollection', 'features' => [[
                'type' => 'Feature', 'properties' => [], 'geometry' => [
                    'type' => 'LineString', 'coordinates' => [],
                ],
            ]],
        ]], JSON_THROW_ON_ERROR);
        $this->expectException(InvalidArgumentException::class);
        BodyTerrain::manifest($this->db, $body);
    }

    public function testGeoJsonHeightOffsetsHaveAnAggregateBodyScaleLimit(): void
    {
        $feature = [
            'type' => 'Feature',
            'properties' => ['height_offset_km' => 60],
            'geometry' => ['type' => 'Polygon', 'coordinates' => [[
                [-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20],
            ]]],
        ];
        $body = $this->body;
        $body['payload_json'] = json_encode(['terrain_regions' => [
            'type' => 'FeatureCollection', 'features' => [$feature, $feature],
        ]], JSON_THROW_ON_ERROR);
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('body-scale budget');
        BodyTerrain::manifest($this->db, $body);
    }

    public function testTilePersistenceAndSharedEdgesAtSameAndDifferentDepths(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $left = BodyTerrain::tile($this->db, $manifest, ['face' => 2, 'lod' => 1, 'x' => 0, 'y' => 0]);
        $right = BodyTerrain::tile($this->db, $manifest, ['face' => 2, 'lod' => 1, 'x' => 1, 'y' => 0]);
        $parent = BodyTerrain::tile($this->db, $manifest, ['face' => 2, 'lod' => 0, 'x' => 0, 'y' => 0]);
        for ($row = 0; $row < 17; $row++) {
            self::assertSame($left['heights'][$row * 17 + 16], $right['heights'][$row * 17]);
        }
        for ($row = 0; $row < 17; $row += 2) {
            for ($col = 0; $col < 17; $col += 2) {
                self::assertSame($parent['heights'][($row / 2) * 17 + $col / 2], $left['heights'][$row * 17 + $col]);
            }
        }
        self::assertSame($left, BodyTerrain::tile($this->db, $manifest, ['face' => 2, 'lod' => 1, 'x' => 0, 'y' => 0]));
        self::assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_tiles')->fetchColumn());
        self::assertCount(289, $left['heights']);
        self::assertGreaterThanOrEqual(0, min($left['heights']));
        self::assertLessThanOrEqual(65535, max($left['heights']));
    }

    public function testCubeFaceBordersUseIdenticalDirectionsAndHeights(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        for ($index = 0; $index <= 16; $index++) {
            $v = $index / 8 - 1;
            self::assertSame(BodyTerrain::direction(0, -1, $v), BodyTerrain::direction(4, 1, $v));
            self::assertSame(BodyTerrain::direction(2, 1, $v), BodyTerrain::direction(0, $v, 1));
            self::assertSame(
                BodyTerrain::height($manifest, BodyTerrain::direction(0, -1, $v)),
                BodyTerrain::height($manifest, BodyTerrain::direction(4, 1, $v))
            );
        }
    }

    public function testInvalidAddressesCannotGenerateTiles(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        foreach ([
            ['face' => 6, 'lod' => 0, 'x' => 0, 'y' => 0],
            ['face' => 0, 'lod' => 17, 'x' => 0, 'y' => 0],
            ['face' => 0, 'lod' => 1, 'x' => 2, 'y' => 0],
            ['face' => 0, 'lod' => 0, 'x' => '0', 'y' => 0],
        ] as $tile) {
            try {
                BodyTerrain::tile($this->db, $manifest, $tile);
                self::fail('Invalid address accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotEmpty($expected->getMessage());
            }
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_tiles')->fetchColumn());
    }

    public function testOwnershipIsCheckedBeforeManifestCreation(): void
    {
        $this->db->exec('CREATE TABLE celestial_bodies (
            id INTEGER PRIMARY KEY, body_uid TEXT, diameter_km INTEGER, planet_class TEXT, body_type TEXT)');
        $this->db->exec("INSERT INTO celestial_bodies VALUES (7, 'planet:1:2:3', 12742, 'ocean', 'planet')");
        $this->db->exec('CREATE TABLE colonies (id INTEGER PRIMARY KEY, body_id INTEGER, user_id INTEGER)');
        $this->db->exec('INSERT INTO colonies VALUES (1, 7, 42), (2, 7, 43), (3, NULL, 42)');
        foreach ([[43, 1], [42, 99], [42, 3]] as [$user, $colony]) {
            try {
                BodyTerrain::forColony($this->db, $user, $colony);
                self::fail('Inaccessible body accepted');
            } catch (RuntimeException $error) {
                self::assertSame(404, $error->getCode());
            }
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_manifests')->fetchColumn());
        self::assertSame(BodyTerrain::forColony($this->db, 42, 1), BodyTerrain::forColony($this->db, 43, 2));
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_manifests')->fetchColumn());
    }

    public function testBatchIsCompletelyValidatedBeforeAnyTileIsGenerated(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $address = ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0];
        foreach ([[], array_fill(0, 17, $address), [$address, ['face' => -1]], [$address, null]] as $batch) {
            try {
                BodyTerrain::tiles($this->db, $manifest, $batch);
                self::fail('Invalid batch accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotEmpty($expected->getMessage());
            }
        }
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_tiles')->fetchColumn());
        self::assertCount(1, BodyTerrain::tiles($this->db, $manifest, [$address]));
    }

    public function testPersistedSamplesAreNotRegeneratedAndVersionsAreExplicit(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $address = ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0];
        $tile = BodyTerrain::tile($this->db, $manifest, $address);
        $tile['heights'][5] = 123;
        $this->db->prepare('UPDATE body_terrain_tiles SET tile_json = ?')->execute([json_encode($tile)]);
        self::assertSame($tile, BodyTerrain::tile($this->db, $manifest, $address));
        $manifest['generator_version'] = 999;
        $this->expectException(RuntimeException::class);
        BodyTerrain::tile($this->db, $manifest, $address);
    }

    public function testDifferentBodiesRemainIndependentAndGasHasNoRelief(): void
    {
        $first = BodyTerrain::manifest($this->db, $this->body);
        $gas = $this->body;
        $gas['id'] = 8;
        $gas['body_uid'] = 'another-body';
        $gas['planet_class'] = 'ice_giant';
        $second = BodyTerrain::manifest($this->db, $gas);
        self::assertNotSame($first['seed'], $second['seed']);
        self::assertSame('gas', $second['biome']);
        self::assertEquals(0, BodyTerrain::height($second, [0, 1, 0]));
    }

    public function testSmallBodiesPersistTheirIrregularBaseShape(): void
    {
        $body = $this->body;
        $body['planet_class'] = null;
        $body['body_type'] = 'comet';
        $manifest = BodyTerrain::manifest($this->db, $body);
        self::assertSame(['version' => 1, 'axes' => [1.45, 0.8, 0.95], 'deformation' => 0.22], $manifest['shape']);
        $body['payload_json'] = '{"shape":{"version":1,"axes":[2,1,0.5],"deformation":0.3}}';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $body));
        $body['id'] = 8;
        self::assertEquals(['version' => 1, 'axes' => [2, 1, 0.5], 'deformation' => 0.3],
            BodyTerrain::manifest($this->db, $body)['shape']);
        self::assertSame($manifest['shape'],
            BodyTerrain::shape(['body_type' => 'planet', 'planet_class' => 'asteroid']));
    }

    public function testCometValleySiteIsBoundedDeterministicAndPersisted(): void
    {
        $body = $this->body;
        $body['body_type'] = 'comet';
        $body['planet_class'] = 'ice';
        $body['diameter_km'] = 12;
        $manifest = BodyTerrain::manifest($this->db, $body);
        $site = $manifest['settlement'];
        self::assertSame('valley-dome', $site['kind']);
        self::assertSame(1, $site['version']);
        self::assertEqualsWithDelta(1, sqrt(array_sum(array_map(
            static fn ($value) => $value ** 2,
            $site['direction']
        ))), 1e-12);
        self::assertLessThan(0, $site['floor_height_km']);
        self::assertGreaterThanOrEqual($manifest['height_min_km'], $site['floor_height_km']);
        self::assertSame(BodyTerrain::height($manifest, $site['direction']), $site['floor_height_km']);
        $sampleSpacingKm = $manifest['radius_km'] * M_PI / 2 / (2 ** $manifest['max_lod']) / 16;
        self::assertLessThanOrEqual(0.001, $sampleSpacingKm);
        self::assertEquals(BodyTerrain::valleySettlement($manifest), $site);
        $body['body_uid'] = 'changed-seed';
        $body['body_type'] = 'planet';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $body));
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM body_terrain_tiles')->fetchColumn());
    }

    public function testLegacyCometsAndOrdinaryPlanetsDoNotGainOrMoveSettlements(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        self::assertArrayNotHasKey('settlement', $manifest);
        $body = $this->body;
        $body['body_type'] = 'comet';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $body));
    }

    public function testOldWorldsKeepTheirSphericalBaseWithoutChangingSamples(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $tile = BodyTerrain::tile($this->db, $manifest, ['face' => 2, 'lod' => 0, 'x' => 0, 'y' => 0]);
        unset($manifest['shape']);
        $this->db->prepare('UPDATE body_terrain_manifests SET manifest_json = ?')
            ->execute([json_encode($manifest, JSON_THROW_ON_ERROR)]);
        $body = $this->body;
        $body['body_type'] = 'comet';
        $restored = BodyTerrain::manifest($this->db, $body);
        self::assertSame(['version' => 1, 'axes' => [1, 1, 1], 'deformation' => 0], $restored['shape']);
        self::assertSame($tile, BodyTerrain::tile($this->db, $restored, ['face' => 2, 'lod' => 0, 'x' => 0, 'y' => 0]));
        self::assertSame($restored, BodyTerrain::manifest($this->db, $body));
    }

    public function testInvalidShapeParametersFailExplicitly(): void
    {
        foreach ([
            ['axes' => [0, 1, 1]], ['axes' => [3, 1, 1]], ['axes' => [1, 1]],
            ['axes' => [1, 1, 1], 'deformation' => 0.9],
            ['version' => 2, 'axes' => [1, 1, 1]], 'invalid',
        ] as $shape) {
            try {
                BodyTerrain::shape($this->body + ['shape' => $shape]);
                self::fail('Invalid shape accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotEmpty($expected->getMessage());
            }
        }

    }

    public function testRegenerationFromTheSameManifestReproducesEveryHeightSample(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $address = ['face' => 2, 'lod' => 3, 'x' => 4, 'y' => 3];
        $first = BodyTerrain::tile($this->db, $manifest, $address);
        $this->db->exec('DELETE FROM body_terrain_tiles');
        self::assertSame($first, BodyTerrain::tile($this->db, $manifest, $address));
    }

    public function testGeologyIsDeterministicBoundedAndPersistedWithoutGlobalRandomness(): void
    {
        mt_srand(123);
        $expectedRandom = mt_rand();
        mt_srand(123);
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        self::assertSame($expectedRandom, mt_rand());
        self::assertSame(1, $manifest['geology']['version']);
        self::assertSame(0.8, $manifest['geology']['erosion']);
        self::assertSame(0.6, $manifest['geology']['tectonics']);
        self::assertCount(32, $manifest['geology']['craters']);
        $totalDepth = 0;
        foreach ($manifest['geology']['craters'] as $crater) {
            self::assertEqualsWithDelta(1, array_sum(array_map(
                static fn ($value) => $value ** 2,
                $crater['direction']
            )), 1e-12);
            self::assertGreaterThanOrEqual(0.015, $crater['angular_radius']);
            self::assertLessThanOrEqual(0.18, $crater['angular_radius']);
            self::assertGreaterThan(0, $crater['depth_km']);
            self::assertLessThanOrEqual(min(
                $manifest['amplitude_km'] * 0.5,
                $manifest['radius_km'] * $crater['angular_radius'] * 0.1
            ), $crater['depth_km']);
            $totalDepth += $crater['depth_km'];
        }
        self::assertLessThanOrEqual($manifest['amplitude_km'] * 0.5 + 1e-12, $totalDepth);
        $other = $this->body;
        $other['id']++;
        self::assertSame($manifest['geology'], BodyTerrain::manifest($this->db, $other)['geology']);
        $other['id']++;
        $other['body_uid'] = 'different-geology';
        self::assertNotSame($manifest['geology']['craters'], BodyTerrain::manifest($this->db, $other)['geology']['craters']);
        $this->body['planet_class'] = 'lava';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $this->body));
    }

    public function testGeologicalDefaultsFollowBodyClass(): void
    {
        foreach ([
            ['moon', 'rock', 0, 0],
            ['comet', 'ice', 0.1, 0],
            ['terran', 'terran', 0.8, 0.6],
            ['ocean', 'ocean', 0.8, 0.6],
            ['lava', 'lava', 0.6, 0.8],
            ['gas', 'gas', 0, 0],
        ] as $index => [$kind, $biome, $erosion, $tectonics]) {
            $body = $this->body;
            $body['id'] += $index;
            $body['planet_class'] = $kind;
            $manifest = BodyTerrain::manifest($this->db, $body);
            self::assertSame($biome, $manifest['biome']);
            self::assertEquals($erosion, $manifest['geology']['erosion']);
            self::assertEquals($tectonics, $manifest['geology']['tectonics']);
            self::assertCount($biome === 'gas' ? 0 : 32, $manifest['geology']['craters']);
        }
    }

    public function testCraterCenterRimAndErosionUseSharedDisplacementFormula(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $manifest['geology'] = ['version' => 1, 'erosion' => 0, 'tectonics' => 0, 'craters' => []];
        $crater = ['direction' => [1, 0, 0], 'angular_radius' => 0.1, 'depth_km' => 0.5];
        foreach ([0, 0.1, 0.17] as $angle) {
            $direction = [cos($angle), sin($angle), 0];
            foreach ([0, 0.8] as $erosion) {
                $manifest['geology']['erosion'] = $erosion;
                $base = BodyTerrain::height($manifest, $direction);
                $manifest['geology']['craters'] = [$crater];
                $actual = BodyTerrain::height($manifest, $direction) - $base;
                $q = $angle / 0.1;
                $expected = $q >= 1.6 ? 0 : (
                    -max(0, 1 - $q * $q) ** 2 + 0.25 * exp(-(($q - 1) / 0.16) ** 2)
                ) * 0.5 * (1 - $erosion * 0.85);
                self::assertEqualsWithDelta($expected, $actual, 1e-12);
                $manifest['geology']['craters'] = [];
            }
        }
    }

    public function testLegacyManifestsKeepFieldsAndOriginalHeightFunction(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        unset($manifest['solid'], $manifest['geology']);
        $this->db->prepare('UPDATE body_terrain_manifests SET manifest_json = ?')
            ->execute([json_encode($manifest, JSON_THROW_ON_ERROR)]);
        $this->body['body_type'] = 'comet';
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $this->body));
        [$x, $y, $z] = BodyTerrain::direction(0, 0.2, -0.5);
        $seed = ($manifest['seed'] % 100000) / 1000;
        $expected = max(-1, min(1,
            sin($x * 19 + $seed + sin($z * 11)) * cos($z * 17 - $seed + $y * 9) * 0.6
            + (1 - abs(sin($x * 41 + $z * 29 + $y * 31 + $seed))) ** 3 * 0.32
            + sin($x * 173 + $y * 97 + $seed) * cos($z * 157 - $y * 79) * 0.06 - 0.4
        )) * $manifest['amplitude_km'];
        self::assertSame($expected, BodyTerrain::height($manifest, [$x, $y, $z]));
        $tile = BodyTerrain::tile($this->db, $manifest, ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0]);
        self::assertSame($tile, BodyTerrain::tile($this->db, $manifest, ['face' => 0, 'lod' => 0, 'x' => 0, 'y' => 0]));
    }

    public function testDefaultCometSolidIsConnectedAndValleyUsesItsOuterIntersection(): void
    {
        $body = $this->body;
        $body['planet_class'] = 'comet';
        $body['diameter_km'] = 12;
        $manifest = BodyTerrain::manifest($this->db, $body);
        self::assertCount(2, $manifest['solid']['lobes']);
        self::assertCount(1, $manifest['solid']['cuts']);
        for ($step = 0; $step <= 100; $step++) {
            $x = -0.5 + $step / 100 * 1.15;
            self::assertLessThan(0, BodyTerrain::solidDistance($manifest['solid'], [$x, 0, 0]));
        }
        $directions = [$manifest['settlement']['direction']];
        for ($face = 0; $face < 6; $face++) {
            $directions[] = BodyTerrain::direction($face, 0, 0);
        }
        foreach ($directions as $direction) {
            $radius = BodyTerrain::surfaceRadius($manifest, $direction);
            $factor = ($radius - BodyTerrain::height($manifest, $direction)) / $manifest['radius_km'];
            $point = array_map(static fn ($n) => $n * $factor, $direction);
            self::assertGreaterThan(0, $factor);
            self::assertEqualsWithDelta(0, BodyTerrain::solidDistance($manifest['solid'], $point), 1e-8);
            self::assertGreaterThan(0, BodyTerrain::solidDistance(
                $manifest['solid'],
                array_map(static fn ($n) => $n * ($factor + 0.001), $direction)
            ));
        }
        self::assertNull(BodyTerrain::solid($this->body));
        self::assertNull(BodyTerrain::solid(['body_type' => 'asteroid']));
        $body['payload_json'] = ['solid' => ['invalid']];
        self::assertSame($manifest, BodyTerrain::manifest($this->db, $body));
    }

    public function testExplicitSolidValidationAndPersistence(): void
    {
        $solid = [
            'version' => 1, 'blend' => 0.18,
            'lobes' => [['center' => [0, 0, 0], 'axes' => [1, 0.8, 0.6]]],
            'cuts' => [['center' => [1, 0, 0], 'radius' => 0.2]],
        ];
        $body = $this->body;
        $body['payload_json'] = json_encode(['solid' => $solid], JSON_THROW_ON_ERROR);
        $manifest = BodyTerrain::manifest($this->db, $body);
        self::assertEquals($solid, $manifest['solid']);
        self::assertEqualsWithDelta(-0.6, BodyTerrain::solidDistance($manifest['solid'], [0, 0, 0]), 1e-12);
        self::assertEqualsWithDelta(0.2, BodyTerrain::solidDistance($manifest['solid'], [1, 0, 0]), 1e-12);
        self::assertEqualsWithDelta(
            0.8 * $manifest['radius_km'] + BodyTerrain::height($manifest, [1, 0, 0]),
            BodyTerrain::surfaceRadius($manifest, [1, 0, 0]),
            $manifest['radius_km'] * 1e-9
        );
        $invalid = [
            array_replace($solid, ['version' => 2]), array_replace($solid, ['blend' => 0]),
            array_replace($solid, ['blend' => 0.41]), array_replace($solid, ['blend' => true]),
            array_replace($solid, ['blend' => INF]), array_replace($solid, ['blend' => '0.18']),
            array_replace($solid, ['lobes' => []]), array_replace($solid, ['cuts' => null]),
            array_replace($solid, ['lobes' => array_fill(0, 5, $solid['lobes'][0])]),
            array_replace($solid, ['cuts' => array_fill(0, 9, $solid['cuts'][0])]),
            array_replace($solid, ['lobes' => [['center' => [0, 0], 'axes' => [1, 1, 1]]]]),
            array_replace($solid, ['lobes' => [['center' => [2.01, 0, 0], 'axes' => [1, 1, 1]]]]),
            array_replace($solid, ['lobes' => [['center' => [0, 0, 0], 'axes' => [0, 1, 1]]]]),
            array_replace($solid, ['lobes' => [['center' => [0, 0, 0], 'axes' => [2.01, 1, 1]]]]),
            array_replace($solid, ['lobes' => [['center' => [0, 0, 0], 'axes' => [1, NAN, 1]]]]),
            array_replace($solid, ['cuts' => [['center' => [0, 0, 0], 'radius' => 0.81]]]),
            array_replace($solid, ['cuts' => [['center' => [0, 0, 0], 'radius' => 0.019]]]),
            array_replace($solid, ['cuts' => [['center' => [0, -2.01, 0], 'radius' => 0.2]]]),
        ];
        foreach ($invalid as $value) {
            try {
                BodyTerrain::solid($this->body + ['payload_json' => ['solid' => $value]]);
                self::fail('Invalid solid accepted');
            } catch (InvalidArgumentException $expected) {
                self::assertNotEmpty($expected->getMessage());
            }
        }
    }

    public function testSmoothUnionAndOutermostIntersectionDoNotCollapseToHeightField(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $manifest['solid'] = [
            'version' => 1, 'blend' => 0.18,
            'lobes' => [
                ['center' => [0, 0, 0], 'axes' => [0.5, 0.5, 0.5]],
                ['center' => [1.5, 0, 0], 'axes' => [0.5, 0.5, 0.5]],
            ], 'cuts' => [],
        ];
        self::assertEqualsWithDelta(0.25 - 0.18 / 4, BodyTerrain::solidDistance($manifest['solid'], [0.75, 0, 0]), 1e-12);
        self::assertEqualsWithDelta(
            2 * $manifest['radius_km'] + BodyTerrain::height($manifest, [1, 0, 0]),
            BodyTerrain::surfaceRadius($manifest, [1, 0, 0]),
            $manifest['radius_km'] * 1e-9
        );
    }

    public function testErosionAttenuatesDetailAndTectonicRidgesUseSharedFormula(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        [$x, $y, $z] = BodyTerrain::direction(0, 0.3, -0.2);
        $seed = ($manifest['seed'] % 100000) / 1000;
        $manifest['geology'] = ['version' => 1, 'erosion' => 0, 'tectonics' => 0, 'craters' => []];
        $base = BodyTerrain::height($manifest, [$x, $y, $z]);
        $manifest['geology']['erosion'] = 0.8;
        $eroded = BodyTerrain::height($manifest, [$x, $y, $z]);
        $detail = sin($x * 173 + $y * 97 + $seed) * cos($z * 157 - $y * 79);
        self::assertEqualsWithDelta(-$detail * 0.06 * 0.8 * $manifest['amplitude_km'], $eroded - $base, 1e-12);
        $manifest['geology']['tectonics'] = 0.6;
        $ridge = (1 - abs(sin($x * 5 + $seed) * cos($z * 4 - $seed + $y * 3))) ** 8;
        self::assertEqualsWithDelta(
            $manifest['amplitude_km'] * 0.6 * 0.35 * ($ridge - 0.15),
            BodyTerrain::height($manifest, [$x, $y, $z]) - $eroded,
            1e-12
        );
    }

    public function testMissingSolidRayIntersectionFailsExplicitly(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $manifest['solid'] = [
            'version' => 1, 'blend' => 0.18,
            'lobes' => [['center' => [2, 0, 0], 'axes' => [0.1, 0.1, 0.1]]], 'cuts' => [],
        ];
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('no radial surface intersection');
        BodyTerrain::surfaceRadius($manifest, [-1, 0, 0]);
    }

    public function testComputedRayBoundIncludesSurfacesBeyondFourAndAnisotropicSmoothUnion(): void
    {
        $manifest = BodyTerrain::manifest($this->db, $this->body);
        $manifest['solid'] = [
            'version' => 1, 'blend' => 0.4,
            'lobes' => [['center' => [2, 2, 2], 'axes' => [2, 2, 2]]], 'cuts' => [],
        ];
        $direction = array_fill(0, 3, 1 / sqrt(3));
        $factor = (BodyTerrain::surfaceRadius($manifest, $direction) - BodyTerrain::height($manifest, $direction))
            / $manifest['radius_km'];
        self::assertEqualsWithDelta(sqrt(12) + 2, $factor, 1e-8);
        self::assertGreaterThan(4, $factor);
        $manifest['solid']['lobes'] = array_fill(0, 4, ['center' => [0, 0, 0], 'axes' => [2, 0.1, 0.1]]);
        $solid = $manifest['solid'];
        self::assertLessThan(0, BodyTerrain::solidDistance($solid, [2.4, 0, 0]));
        self::assertGreaterThan(0, BodyTerrain::solidDistance($solid, [BodyTerrain::solidBound($solid), 0, 0]));
        $radius = BodyTerrain::surfaceRadius($manifest, [1, 0, 0]);
        $factor = ($radius - BodyTerrain::height($manifest, [1, 0, 0])) / $manifest['radius_km'];
        self::assertEqualsWithDelta(0, BodyTerrain::solidDistance($solid, [$factor, 0, 0]), 1e-8);
    }

    public function testGeologicalHeightEnvelopeAndUint16EncodingAcrossBiomes(): void
    {
        foreach (['moon', 'comet', 'ocean', 'lava', 'gas'] as $index => $kind) {
            $body = $this->body;
            $body['id'] += $index;
            $body['planet_class'] = $kind;
            $manifest = BodyTerrain::manifest($this->db, $body);
            for ($face = 0; $face < 6; $face++) {
                $tile = BodyTerrain::tile($this->db, $manifest, ['face' => $face, 'lod' => 0, 'x' => 0, 'y' => 0]);
                self::assertGreaterThanOrEqual(0, min($tile['heights']));
                self::assertLessThanOrEqual(65535, max($tile['heights']));
                for ($row = 0; $row <= 16; $row++) {
                    $height = BodyTerrain::height($manifest, BodyTerrain::direction($face, $row / 8 - 1, 0));
                    self::assertGreaterThanOrEqual($manifest['height_min_km'], $height);
                    self::assertLessThanOrEqual($manifest['height_max_km'], $height);
                }
            }
        }
    }
}
