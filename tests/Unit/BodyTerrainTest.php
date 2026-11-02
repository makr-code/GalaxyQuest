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
}
