<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use PHPUnit\Framework\TestCase;
use PDO;
use GalaxyQuest\Galaxy\Presentation\GalaxyController;
use GalaxyQuest\Galaxy\Application\GetStarsRangeService;
use GalaxyQuest\Galaxy\Application\GetSystemPayloadService;
use GalaxyQuest\Galaxy\Infrastructure\PdoGalaxyRepository;
use GalaxyQuest\Galaxy\Infrastructure\Encoders\JsonSystemPayloadEncoder;
use GalaxyQuest\Shared\Http\RequestContext;

/**
 * GalaxyIntegrationTest – Integration tests for Galaxy context against test database.
 *
 * Tests:
 * - Range queries with real database fixtures
 * - System detail lookups
 * - Error scenarios (not found, invalid range)
 * - Response envelope structure
 */
class GalaxyIntegrationTest extends TestCase
{
    private ?PDO $testDb = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setupTestDatabase();
    }

    protected function tearDown(): void
    {
        if ($this->testDb) {
            $this->testDb = null;
        }
        parent::tearDown();
    }

    /**
     * Set up in-memory test database with sample star systems.
     */
    private function setupTestDatabase(): void
    {
        // Create in-memory SQLite database for testing
        $this->testDb = new PDO('sqlite::memory:');
        $this->testDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Create star_systems table
        $this->testDb->exec(<<<'SQL'
            CREATE TABLE star_systems (
                id INTEGER PRIMARY KEY,
                galaxy_index INTEGER NOT NULL,
                system_index INTEGER NOT NULL,
                x_ly REAL NOT NULL,
                y_ly REAL NOT NULL,
                z_ly REAL NOT NULL,
                name TEXT,
                catalog_name TEXT,
                spectral_class TEXT,
                subtype INTEGER,
                luminosity_class TEXT,
                mass_solar REAL,
                radius_solar REAL,
                temperature_k INTEGER,
                luminosity_solar REAL,
                hz_inner_au REAL,
                hz_outer_au REAL,
                frost_line_au REAL,
                stellar_type TEXT,
                age_gyr REAL,
                metallicity_z REAL,
                is_binary INTEGER,
                planet_count INTEGER
            );
        SQL);

        // Insert test data
        $this->testDb->exec(<<<'SQL'
            INSERT INTO star_systems VALUES
            (1, 1, 1, 10.0, 20.0, 5.0, 'Sol', 'Sun', 'G2V', 2, 'V', 1.0, 1.0, 5778, 1.0, 0.95, 1.68, 4.85, 'G-type', 4.6, 0.0, 0, 8),
            (2, 1, 2, 15.0, 25.0, 3.0, 'Sirius', 'Sirius A', 'A1V', 1, 'V', 2.02, 1.71, 9940, 25.4, 1.5, 2.8, 8.5, 'A-type', 0.3, 0.01, 0, 0),
            (3, 1, 3, 8.0, 18.0, 2.0, 'Betelgeuse', 'Alpha Orionis', 'M1-2I', 0, 'I', 16.5, 887.0, 3500, 140000.0, 500.0, 950.0, 2000.0, 'M-type', 10.0, 0.02, 0, 0),
            (4, 1, 4, 50.0, 60.0, 10.0, 'Vega', 'Alpha Lyrae', 'A0V', 0, 'V', 2.1, 2.362, 9602, 40.0, 1.4, 2.7, 8.2, 'A-type', 0.6, 0.01, 0, 0);
        SQL);

        // Create celestial_bodies table for integration
        $this->testDb->exec(<<<'SQL'
            CREATE TABLE celestial_bodies (
                id INTEGER PRIMARY KEY,
                galaxy_index INTEGER,
                system_index INTEGER,
                position INTEGER
            );
        SQL);

        // Create colonies table
        $this->testDb->exec(<<<'SQL'
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                body_id INTEGER,
                population INTEGER
            );
        SQL);
    }

    /**
     * @test
     * Test successful range query with systems in database.
     */
    public function testGetStarsRangeSuccess(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $service = new GetStarsRangeService($repository);
        $controller = new GalaxyController($service, $this->createSystemPayloadService());

        $request = RequestContext::create(userId: 1);
        $response = $controller->getStarsRange($request, [
            'xmin' => 5,
            'xmax' => 20,
            'ymin' => 15,
            'ymax' => 30,
        ]);

        self::assertTrue($response->isSuccess());
        $data = $response->getData();
        self::assertIsArray($data);
        self::assertArrayHasKey('systems', $data);
        self::assertArrayHasKey('total_count', $data);
        self::assertGreaterThan(0, $data['total_count']);
    }

    /**
     * @test
     * Test empty range query (no systems found).
     */
    public function testGetStarsRangeEmpty(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $service = new GetStarsRangeService($repository);
        $controller = new GalaxyController($service, $this->createSystemPayloadService());

        $request = RequestContext::create(userId: 1);
        $response = $controller->getStarsRange($request, [
            'xmin' => 100,
            'xmax' => 110,
            'ymin' => 100,
            'ymax' => 110,
        ]);

        self::assertTrue($response->isSuccess());
        $data = $response->getData();
        self::assertArrayHasKey('systems', $data);
        self::assertCount(0, $data['systems']);
        self::assertEquals(0, $data['total_count']);
    }

    /**
     * @test
     * Test invalid range (min > max).
     */
    public function testGetStarsRangeInvalidRange(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $service = new GetStarsRangeService($repository);
        $controller = new GalaxyController($service, $this->createSystemPayloadService());

        $request = RequestContext::create(userId: 1);
        $response = $controller->getStarsRange($request, [
            'xmin' => 100,
            'xmax' => 50,  // Invalid: max < min
            'ymin' => 50,
            'ymax' => 100,
        ]);

        self::assertFalse($response->isSuccess());
        $error = $response->getError();
        self::assertNotNull($error);
        self::assertEquals('GALAXY_RANGE_INVALID', $error->getCode());
    }

    /**
     * @test
     * Test system detail lookup success.
     */
    public function testGetSystemPayloadSuccess(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $controller = new GalaxyController(
            $this->createRangeService($repository),
            new GetSystemPayloadService($repository, new JsonSystemPayloadEncoder()),
        );

        $request = RequestContext::create(userId: 1);
        $response = $controller->getSystemPayload($request, [
            'x' => 10,
            'y' => 20,
        ]);

        self::assertTrue($response->isSuccess());
        $data = $response->getData();
        self::assertIsArray($data);
        self::assertArrayHasKey('x', $data);
        self::assertArrayHasKey('y', $data);
        self::assertArrayHasKey('payload', $data);
    }

    /**
     * @test
     * Test system not found.
     */
    public function testGetSystemPayloadNotFound(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $controller = new GalaxyController(
            $this->createRangeService($repository),
            new GetSystemPayloadService($repository, new JsonSystemPayloadEncoder()),
        );

        $request = RequestContext::create(userId: 1);
        $response = $controller->getSystemPayload($request, [
            'x' => 999,
            'y' => 999,
        ]);

        self::assertFalse($response->isSuccess());
        $error = $response->getError();
        self::assertNotNull($error);
        self::assertEquals('GALAXY_SYSTEM_NOT_FOUND', $error->getCode());
    }

    /**
     * @test
     * Test response envelope structure.
     */
    public function testResponseEnvelopeStructure(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $service = new GetStarsRangeService($repository);
        $controller = new GalaxyController($service, $this->createSystemPayloadService());

        $request = RequestContext::create(userId: 1);
        $response = $controller->getStarsRange($request, [
            'xmin' => 5,
            'xmax' => 20,
            'ymin' => 15,
            'ymax' => 30,
        ]);

        // Check envelope structure
        $array = $response->toArray();
        self::assertArrayHasKey('success', $array);
        self::assertArrayHasKey('meta', $array);
        self::assertArrayHasKey('data', $array);

        // Check metadata
        $meta = $array['meta'];
        self::assertArrayHasKey('trace_id', $meta);
        self::assertArrayHasKey('ts', $meta);
        self::assertIsString($meta['trace_id']);
        self::assertIsInt($meta['ts']);
    }

    /**
     * Helper to create range service.
     */
    private function createRangeService(PdoGalaxyRepository $repository): GetStarsRangeService
    {
        return new GetStarsRangeService($repository);
    }

    /**
     * Helper to create system payload service.
     */
    private function createSystemPayloadService(): GetSystemPayloadService
    {
        return new GetSystemPayloadService(
            new PdoGalaxyRepository($this->testDb),
            new JsonSystemPayloadEncoder(),
        );
    }
}
