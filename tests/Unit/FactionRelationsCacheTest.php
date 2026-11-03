<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\FactionRelationsCache;

use PDO;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload)
    {
        parent::__construct('');
    }
}

function only_method(string ...$methods): void {}

function json_ok(array $payload): never
{
    throw new JsonResponse(['success' => true] + $payload);
}

function gq_cache_get(string $scope, array $params): mixed
{
    TestCase::assertSame(2, func_num_args(), 'Cache reads must not receive a write TTL.');
    return Storage\gq_cache_get($scope, $params);
}

function gq_cache_set(string $scope, array $params, mixed $data, int $ttl = 0): void
{
    TestCase::assertSame(CACHE_TTL_FACTIONS, $ttl);
    Storage\gq_cache_set($scope, $params, $data, $ttl);
}

const CACHE_TTL_FACTIONS = 300;

final class FactionRelationsCacheTest extends TestCase
{
    public static int $now = 2000000000;
    private static string $cacheDir;
    private static \Closure $dispatch;

    public static function setUpBeforeClass(): void
    {
        self::$cacheDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-faction-cache-' . bin2hex(random_bytes(8));
        if (!mkdir(self::$cacheDir, 0700)) {
            throw new RuntimeException('Cannot create isolated cache directory.');
        }
        $cache = file_get_contents(__DIR__ . '/../../api/cache.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/faction_relations.php');
        if ($cache === false || $endpoint === false) {
            throw new RuntimeException('Cannot read cache and faction endpoint sources.');
        }
        $cacheStart = strpos($cache, 'function _gq_cache_key(');
        $predictionStart = strpos($endpoint, 'function predict_conflicts(');
        $predictionEnd = strpos($endpoint, 'function generate_diplomatic_event(');
        $dispatchStart = strpos($endpoint, "case 'relationships':");
        $dispatchEnd = strpos($endpoint, "case 'trade_routes':");
        if ($cacheStart === false || $predictionStart === false || $predictionEnd === false
            || $dispatchStart === false || $dispatchEnd === false) {
            throw new RuntimeException('Cannot locate cache functions and endpoint branches.');
        }
        // Execute real file-cache functions with an isolated directory, clock and no APCu.
        eval('namespace ' . __NAMESPACE__ . '\\Storage; '
            . 'const CACHE_DIR = ' . var_export(self::$cacheDir, true) . '; '
            . 'const CACHE_ENABLED = true; const CACHE_VERSION = "faction-cache-test"; '
            . 'const _GQ_CACHE_MAGIC = "GQC\x01"; const _GQ_CACHE_HDR_SIZE = 44; '
            . <<<'PHP'
function time(): int {
    return \GalaxyQuest\Tests\FactionRelationsCache\FactionRelationsCacheTest::$now;
}
function function_exists(string $name): bool {
    return str_starts_with($name, 'apcu_') ? false : \function_exists($name);
}
PHP
            . substr($cache, $cacheStart));
        $prefix = 'namespace ' . __NAMESPACE__ . '; use \PDO; ';
        eval($prefix . substr($endpoint, $predictionStart, $predictionEnd - $predictionStart));
        self::$dispatch = eval($prefix
            . 'return function (string $action, int $uid, array $relations_data, PDO $db): void {'
            . '$cache_key = "faction_relations_" . $action; switch ($action) {'
            . substr($endpoint, $dispatchStart, $dispatchEnd - $dispatchStart)
            . '}};');
    }

    protected function setUp(): void
    {
        self::$now = 2000000000;
    }

    protected function tearDown(): void
    {
        $files = scandir(self::$cacheDir);
        if ($files === false) {
            throw new RuntimeException('Cannot inspect isolated cache directory.');
        }
        foreach ($files as $file) {
            if ($file !== '.' && $file !== '..' && !unlink(self::$cacheDir . DIRECTORY_SEPARATOR . $file)) {
                throw new RuntimeException('Cannot remove test cache file.');
            }
        }
    }

    public static function tearDownAfterClass(): void
    {
        if (!rmdir(self::$cacheDir)) {
            throw new RuntimeException('Cannot remove isolated cache directory.');
        }
    }

    private function request(string $action, int $uid, array $relationships): array
    {
        try {
            (self::$dispatch)($action, $uid, ['relationships' => $relationships], new PDO('sqlite::memory:'));
        } catch (JsonResponse $response) {
            return $response->payload;
        }
        throw new RuntimeException('Cache branch did not produce a JSON response.');
    }

    /** @return iterable<string, array{string, string}> */
    public static function actions(): iterable
    {
        yield 'relationships' => ['relationships', 'relationships'];
        yield 'conflicts' => ['conflicts', 'conflicts'];
    }

    #[DataProvider('actions')]
    public function testMissHitAndExpiryUseWriteTtl(string $action, string $key): void
    {
        $data = ['fleet' => ['traders' => -10], 'traders' => ['fleet' => 5]];
        $first = $this->request($action, 42, $data);
        $this->assertTrue($first['success']);
        $this->assertNotEmpty($first[$key]);
        $this->assertSame($first, $this->request($action, 42, []));
        $rows = Storage\gq_cache_index_entries('faction_relations_' . $action);
        $this->assertCount(1, $rows);
        $this->assertSame(self::$now + CACHE_TTL_FACTIONS, $rows[0]['expires']);
        self::$now += CACHE_TTL_FACTIONS + 1;
        $this->assertSame(['success' => true, $key => []], $this->request($action, 42, []));
    }

    #[DataProvider('actions')]
    public function testUsersHaveSeparateKeys(string $action, string $key): void
    {
        $data = ['fleet' => ['traders' => -10], 'traders' => ['fleet' => 5]];
        $first = $this->request($action, 42, $data);
        $this->assertSame(['success' => true, $key => []], $this->request($action, 99, []));
        $this->assertSame($first, $this->request($action, 42, []));
    }

    public function testActionsDoNotShareEntries(): void
    {
        $data = ['fleet' => ['traders' => -10], 'traders' => ['fleet' => 5]];
        $relationships = $this->request('relationships', 42, $data);
        $conflicts = $this->request('conflicts', 42, $data);
        $this->assertSame($data, $relationships['relationships']);
        $this->assertArrayNotHasKey('relationships', $conflicts);
        $this->assertSame($relationships, $this->request('relationships', 42, []));
        $this->assertSame($conflicts, $this->request('conflicts', 42, []));
    }

    #[DataProvider('actions')]
    public function testEmptyResultIsCached(string $action, string $key): void
    {
        $expected = ['success' => true, $key => []];
        $this->assertSame($expected, $this->request($action, 42, []));
        $this->assertSame($expected, $this->request($action, 42, ['a' => ['b' => -10]]));
    }

    public function testExpiredCacheReadsDoNotMutateCacheFilesOrIndex(): void
    {
        $params = ['entry' => 'expired'];
        Storage\gq_cache_set_raw('read_side_effects', $params, 'payload', 30);
        $key = Storage\_gq_cache_key('read_side_effects', $params);
        $cacheFile = Storage\_gq_cache_file($key);
        $indexFile = Storage\_gq_cache_index_file('read_side_effects');
        $cacheContents = file_get_contents($cacheFile);
        $indexContents = file_get_contents($indexFile);
        $this->assertIsString($cacheContents);
        $this->assertIsString($indexContents);

        self::$now += 31;

        $this->assertNull(Storage\gq_cache_get_raw('read_side_effects', $params));
        $this->assertFileExists($cacheFile);
        $this->assertSame($cacheContents, file_get_contents($cacheFile));
        $this->assertSame([], Storage\gq_cache_index_entries('read_side_effects'));
        $this->assertSame($indexContents, file_get_contents($indexFile));
    }
}
