<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\DiplomacyDispatch;

use PDO;
use PDOException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload, int $status)
    {
        parent::__construct('', $status);
    }
}

final class DiplomacyDispatchTest extends TestCase
{
    public static PDO $db;
    public static array $logs = [];
    public static bool $connectionFailure = false;
    private static array $dispatchers = [];
    private array $previousGet;
    private ?string $previousRequestMethod;

    public static function setUpBeforeClass(): void
    {
        foreach (['diplomacy', 'diplomatic_plays'] as $endpoint) {
            $source = file_get_contents(__DIR__ . '/../../api/' . $endpoint . '.php');
            if ($source === false) {
                throw new RuntimeException('Cannot read diplomacy endpoint.');
            }
            $start = strpos($source, $endpoint === 'diplomacy' ? 'function get_agreement_types(' : 'const DP_TRUST_TRADE_BONUS');
            $dispatch = strrpos($source, "\ntry {");
            if ($start === false || $dispatch === false) {
                throw new RuntimeException('Cannot locate diplomacy handlers and dispatch.');
            }
            $namespace = __NAMESPACE__ . '\\' . $endpoint;
            $prefix = 'namespace ' . $namespace . '; use \PDO; use \PDOException; use \Throwable; ';
            // Isolate duplicate handler names and replace only external dependencies.
            eval($prefix . <<<'PHP'
function get_db(): PDO {
    if (\GalaxyQuest\Tests\DiplomacyDispatch\DiplomacyDispatchTest::$connectionFailure) {
        throw new PDOException('connection-secret');
    }
    return \GalaxyQuest\Tests\DiplomacyDispatch\DiplomacyDispatchTest::$db;
}
function json_response(array $payload, int $status = 200): never {
    throw new \GalaxyQuest\Tests\DiplomacyDispatch\JsonResponse($payload, $status);
}
function json_error(string $message, int $status = 400): never {
    json_response(['success' => false, 'error' => $message], $status);
}
function only_method(string ...$methods): void {
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $methods, true)) {
        json_error('Method not allowed', 405);
    }
}
function verify_csrf(): void {}
function file_get_contents(string $path): string {
    return '{}';
}
function error_log(string $message): bool {
    \GalaxyQuest\Tests\DiplomacyDispatch\DiplomacyDispatchTest::$logs[] = $message;
    return true;
}
PHP
                . substr($source, $start, $dispatch - $start));
            self::$dispatchers[$endpoint] = eval(
                $prefix . 'return function (string $action, int $uid): void {'
                . substr($source, $dispatch) . '};'
            );
        }
    }

    protected function setUp(): void
    {
        $this->previousGet = $_GET;
        $this->previousRequestMethod = $_SERVER['REQUEST_METHOD'] ?? null;
        $_GET = [];
        $_SERVER['REQUEST_METHOD'] = 'GET';
        self::$logs = [];
        self::$connectionFailure = false;
        self::$db = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        self::$db->exec(
            "CREATE TABLE npc_factions (id INTEGER PRIMARY KEY, name TEXT, icon TEXT, color TEXT);
             CREATE TABLE faction_agreements (
                id INTEGER PRIMARY KEY, user_id INTEGER, faction_id INTEGER,
                player_offer TEXT, faction_demand TEXT, proposed_at TEXT);
             CREATE TABLE diplomatic_plays (
                id INTEGER PRIMARY KEY, initiator_uid INTEGER, faction_id INTEGER,
                player_demands TEXT, faction_demands TEXT, updated_at TEXT);
             CREATE TABLE diplomacy (user_id INTEGER, faction_id INTEGER, trust_level REAL, threat_level REAL);
             INSERT INTO npc_factions VALUES (1, 'Fleet', 'F', '#abc'), (2, 'Traders', 'T', '#def');
             INSERT INTO faction_agreements VALUES
                (1, 42, 1, '[\"metal\"]', '[]', '2026-01-01'),
                (2, 99, 1, '[]', '[]', '2026-01-01'),
                (3, 42, 2, '[]', '[\"trade\"]', '2026-01-02');
             INSERT INTO diplomatic_plays VALUES
                (1, 42, 1, '[\"peace\"]', '[]', '2026-01-01'),
                (2, 99, 1, '[]', '[]', '2026-01-01'),
                (3, 42, 2, '[]', '[\"tribute\"]', '2026-01-02');
             INSERT INTO diplomacy VALUES (42, 1, 25.5, 10.5);"
        );
    }

    protected function tearDown(): void
    {
        $_GET = $this->previousGet;
        if ($this->previousRequestMethod === null) {
            unset($_SERVER['REQUEST_METHOD']);
        } else {
            $_SERVER['REQUEST_METHOD'] = $this->previousRequestMethod;
        }
        self::$logs = [];
        self::$connectionFailure = false;
    }

    private function dispatch(string $endpoint, string $action): JsonResponse
    {
        $_SERVER['REQUEST_METHOD'] = match ($action) {
            'list', 'types', 'trust_threat' => 'GET',
            default => 'POST',
        };

        try {
            self::$dispatchers[$endpoint]($action, 42);
        } catch (JsonResponse $response) {
            return $response;
        }
        throw new RuntimeException('Dispatch did not produce a JSON response.');
    }

    /** @return iterable<string, array{string, string, string}> */
    public static function invalidActions(): iterable
    {
        yield 'propose' => ['diplomacy', 'propose', 'Invalid faction_id'];
        yield 'respond' => ['diplomacy', 'respond', 'Invalid agreement_id'];
        yield 'cancel' => ['diplomacy', 'cancel', 'Invalid agreement_id'];
        yield 'trust-threat' => ['diplomatic_plays', 'trust_threat', 'Invalid faction_id'];
        yield 'propose-play' => ['diplomatic_plays', 'propose_play', 'Invalid faction_id'];
        yield 'counter-play' => ['diplomatic_plays', 'counter_play', 'Invalid play_id'];
        yield 'mobilize' => ['diplomatic_plays', 'mobilize', 'Invalid play_id'];
        yield 'resolve' => ['diplomatic_plays', 'resolve', 'Invalid play_id'];
    }

    #[DataProvider('invalidActions')]
    public function testHandlerValidationPayloadsArePreserved(string $endpoint, string $action, string $error): void
    {
        $response = $this->dispatch($endpoint, $action);
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['success' => false, 'error' => $error], $response->payload);
        $this->assertSame([], self::$logs);
    }

    /** @return iterable<string, array{string, string}> */
    public static function endpoints(): iterable
    {
        yield 'agreements' => ['diplomacy', 'agreements'];
        yield 'plays' => ['diplomatic_plays', 'plays'];
    }

    #[DataProvider('endpoints')]
    public function testListScopesUserAndDecodesJson(string $endpoint, string $key): void
    {
        $response = $this->dispatch($endpoint, 'list');
        $this->assertSame(200, $response->getCode());
        $this->assertTrue($response->payload['success']);
        $this->assertSame([3, 1], array_column($response->payload[$key], 'id'));
        $field = $endpoint === 'diplomacy' ? 'player_offer' : 'player_demands';
        $this->assertSame($endpoint === 'diplomacy' ? ['metal'] : ['peace'], $response->payload[$key][1][$field]);
        $_GET['faction_id'] = '1';
        $this->assertSame([1], array_column($this->dispatch($endpoint, 'list')->payload[$key], 'id'));
    }

    public function testTypesCatalogueIsReturnedWithoutExtraEnvelope(): void
    {
        $response = $this->dispatch('diplomacy', 'types');
        $this->assertSame(200, $response->getCode());
        $this->assertTrue($response->payload['success']);
        $this->assertSame(['non_aggression', 'trade', 'research', 'alliance'], array_column($response->payload['types'], 'code'));
    }

    public function testTrustThreatPayload(): void
    {
        $_GET['faction_id'] = '1';
        $response = $this->dispatch('diplomatic_plays', 'trust_threat');
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['success' => true, 'faction_id' => 1, 'trust' => 25.5, 'threat' => 10.5], $response->payload);
    }

    #[DataProvider('endpoints')]
    public function testUnknownActionReturns400(string $endpoint, string $key): void
    {
        $response = $this->dispatch($endpoint, 'unknown');
        $this->assertSame(400, $response->getCode());
        $this->assertSame(['success' => false, 'error' => 'Unknown action'], $response->payload);
    }

    #[DataProvider('endpoints')]
    public function testQueryFailureIsLoggedAndNotExposed(string $endpoint, string $key): void
    {
        self::$db->exec('DROP TABLE ' . ($endpoint === 'diplomacy' ? 'faction_agreements' : 'diplomatic_plays'));
        $response = $this->dispatch($endpoint, 'list');
        $this->assertSame(500, $response->getCode());
        $this->assertFalse($response->payload['success']);
        $this->assertStringStartsWith('Unable to process ', $response->payload['error']);
        $this->assertStringNotContainsString('SQLSTATE', $response->payload['error']);
        $this->assertCount(1, self::$logs);
        $this->assertStringContainsString('SQLSTATE', self::$logs[0]);
    }

    #[DataProvider('endpoints')]
    public function testConnectionFailureIsLoggedAndNotExposed(string $endpoint, string $key): void
    {
        self::$connectionFailure = true;
        $response = $this->dispatch($endpoint, 'list');
        $this->assertSame(500, $response->getCode());
        $this->assertStringNotContainsString('connection-secret', $response->payload['error']);
        $this->assertSame([$endpoint . ' dispatch error: connection-secret'], self::$logs);
    }
}
