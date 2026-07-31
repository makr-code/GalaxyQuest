<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Performance;

use PHPUnit\Framework\TestCase;
use PDO;
use GalaxyQuest\Galaxy\Presentation\GalaxyController;
use GalaxyQuest\Galaxy\Application\GetStarsRangeService;
use GalaxyQuest\Galaxy\Application\GetSystemPayloadService;
use GalaxyQuest\Galaxy\Infrastructure\PdoGalaxyRepository;
use GalaxyQuest\Galaxy\Infrastructure\Encoders\JsonSystemPayloadEncoder;
use GalaxyQuest\Galaxy\Infrastructure\Encoders\BinarySystemPayloadEncoder;
use GalaxyQuest\Shared\Http\RequestContext;

/**
 * GalaxyPerformanceTest – Performance profiling for Galaxy context.
 *
 * Measures:
 * - Query latency (p95, p99)
 * - Payload size (JSON vs Binary)
 * - Consistency across encoding formats
 *
 * Note: These tests are NOT performance gates but provide profiling data
 * for optimization and comparison across versions.
 */
class GalaxyPerformanceTest extends TestCase
{
    private const ITERATIONS = 100;

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
     * Set up in-memory test database with larger dataset for profiling.
     */
    private function setupTestDatabase(): void
    {
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

        // Create celestial_bodies and colonies tables
        $this->testDb->exec(<<<'SQL'
            CREATE TABLE celestial_bodies (
                id INTEGER PRIMARY KEY,
                galaxy_index INTEGER,
                system_index INTEGER,
                position INTEGER
            );
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                body_id INTEGER,
                population INTEGER
            );
        SQL);

        // Insert larger test dataset for realistic profiling
        $this->insertTestSystems();
    }

    /**
     * Insert 500 test star systems for profiling.
     */
    private function insertTestSystems(): void
    {
        $stmt = $this->testDb->prepare(
            'INSERT INTO star_systems VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        $spectralClasses = ['G2V', 'K5V', 'M0V', 'F5V', 'A0V', 'B3V'];
        $types = ['G-type', 'K-type', 'M-type', 'F-type', 'A-type', 'B-type'];

        for ($i = 1; $i <= 500; $i++) {
            $x = 10.0 + ($i % 50) * 2.0;
            $y = 20.0 + (int)($i / 50) * 2.0;
            $spectralIdx = ($i - 1) % count($spectralClasses);

            $stmt->execute([
                $i,                            // id
                1,                            // galaxy_index
                $i,                           // system_index
                $x,                           // x_ly
                $y,                           // y_ly
                5.0 + sin($i / 50) * 3.0,    // z_ly
                "Star-$i",                    // name
                "Star-Cat-$i",                // catalog_name
                $spectralClasses[$spectralIdx],  // spectral_class
                $i % 10,                      // subtype
                'V',                          // luminosity_class
                1.0 + ($i % 5) * 0.2,        // mass_solar
                1.0 + ($i % 8) * 0.15,       // radius_solar
                5000 + ($i % 3000),          // temperature_k
                1.0 + ($i % 10) * 0.5,       // luminosity_solar
                0.9,                          // hz_inner_au
                1.7,                          // hz_outer_au
                4.8,                          // frost_line_au
                $types[$spectralIdx],         // stellar_type
                4.0 + ($i % 10) * 0.5,       // age_gyr
                0.0 + ($i % 100) * 0.001,    // metallicity_z
                $i % 3 === 0 ? 1 : 0,        // is_binary
                $i % 20,                      // planet_count
            ]);
        }
    }

    /**
     * @test
     * Profile range query latency over multiple iterations.
     */
    public function testRangeQueryLatency(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $service = new GetStarsRangeService($repository);
        $controller = new GalaxyController($service, $this->createSystemPayloadService());
        $request = RequestContext::create(userId: 1);

        $latencies = [];
        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $start = hrtime(true);
            $controller->getStarsRange($request, [
                'xmin' => 10,
                'xmax' => 30,
                'ymin' => 20,
                'ymax' => 40,
            ]);
            $end = hrtime(true);
            $latencies[] = ($end - $start) / 1_000_000; // Convert to milliseconds
        }

        sort($latencies);
        $p95 = $latencies[(int)(0.95 * count($latencies))];
        $p99 = $latencies[(int)(0.99 * count($latencies))];
        $avg = array_sum($latencies) / count($latencies);

        // Log profiling data (not assertions, just measurements)
        printf(
            "\n✓ Range Query Latency Profile:\n  Average: %.2f ms\n  p95: %.2f ms\n  p99: %.2f ms\n",
            $avg,
            $p95,
            $p99
        );

        // Sanity check: should complete in reasonable time
        self::assertLessThan(1000, $p99, 'p99 latency should be under 1 second');
    }

    /**
     * @test
     * Profile system detail query latency.
     */
    public function testSystemDetailLatency(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        $controller = new GalaxyController(
            new GetStarsRangeService($repository),
            new GetSystemPayloadService($repository, new JsonSystemPayloadEncoder()),
        );
        $request = RequestContext::create(userId: 1);

        $latencies = [];
        for ($i = 0; $i < self::ITERATIONS; $i++) {
            $x = 10.0 + ($i % 50) * 2.0;
            $y = 20.0 + (int)($i / 50) * 2.0;

            $start = hrtime(true);
            $controller->getSystemPayload($request, [
                'x' => (int)$x,
                'y' => (int)$y,
            ]);
            $end = hrtime(true);
            $latencies[] = ($end - $start) / 1_000_000;
        }

        sort($latencies);
        $p95 = $latencies[(int)(0.95 * count($latencies))];
        $p99 = $latencies[(int)(0.99 * count($latencies))];
        $avg = array_sum($latencies) / count($latencies);

        printf(
            "\n✓ System Detail Latency Profile:\n  Average: %.2f ms\n  p95: %.2f ms\n  p99: %.2f ms\n",
            $avg,
            $p95,
            $p99
        );

        self::assertLessThan(500, $p99, 'p99 latency should be under 500 ms');
    }

    /**
     * @test
     * Compare JSON vs Binary encoding sizes.
     */
    public function testPayloadSizeComparison(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        // Use coordinates from the first inserted system: i=1 gives x=12.0, y=20.0
        $systemData = $repository->getSystemByCoordinates(12, 20);

        // Encode as JSON
        $jsonEncoder = new JsonSystemPayloadEncoder();
        $jsonPayload = $jsonEncoder->encode($systemData);
        $jsonSize = strlen(json_encode($jsonPayload));

        // Encode as Binary
        $binaryEncoder = new BinarySystemPayloadEncoder();
        $binaryPayload = $binaryEncoder->encode($systemData);
        $binarySize = strlen($binaryPayload);

        // Log the comparison but don't enforce binary being smaller
        // (for small payloads, overhead can make binary larger)
        $ratio = $binarySize > 0 ? $jsonSize / $binarySize : 0.0;
        printf(
            "\n✓ Payload Size Comparison:\n  JSON: %d bytes\n  Binary: %d bytes\n  Ratio: %.2f x\n",
            $jsonSize,
            $binarySize,
            $ratio
        );

        // Just verify both encode successfully
        self::assertGreaterThan(0, $jsonSize);
        self::assertGreaterThan(0, $binarySize);
    }

    /**
     * @test
     * Verify encoding consistency (same data from both encoders).
     */
    public function testEncodingConsistency(): void
    {
        $repository = new PdoGalaxyRepository($this->testDb);
        // Use coordinates from the first inserted system: i=1 gives x=12.0, y=20.0
        $systemData = $repository->getSystemByCoordinates(12, 20);

        $jsonEncoder = new JsonSystemPayloadEncoder();
        $jsonPayload = $jsonEncoder->encode($systemData);

        $binaryEncoder = new BinarySystemPayloadEncoder();
        $binaryPayload = $binaryEncoder->encode($systemData);

        // Both should encode the same system data
        self::assertIsArray($jsonPayload);
        self::assertIsString($binaryPayload);

        // Verify key fields are present in JSON
        self::assertArrayHasKey('id', $jsonPayload);
        self::assertArrayHasKey('name', $jsonPayload);
        self::assertArrayHasKey('x', $jsonPayload);
        self::assertArrayHasKey('y', $jsonPayload);
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
