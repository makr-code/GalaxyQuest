<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiMonitoring;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;
use RuntimeException;

final class JsonResponse extends RuntimeException
{
    public function __construct(public array $payload, int $status)
    {
        parent::__construct('', $status);
    }
}

function json_response(array $payload, int $status = 200): never
{
    throw new JsonResponse($payload, $status);
}

function json_ok(array $payload): never
{
    json_response(['success' => true] + $payload);
}

function json_error(string $message, int $status = 400): never
{
    json_response(['success' => false, 'error' => $message], $status);
}

function only_method(string ...$methods): void
{
    TestCase::assertSame(['GET'], $methods);
    if (TextureAiMonitoringTest::$method !== 'GET') {
        json_error('Method not allowed', 405);
    }
}

function file_get_contents(string $url, bool $includePath, mixed $context, int $offset, int $length): string|false
{
    TextureAiMonitoringTest::$requests[] = $url;
    TestCase::assertSame(5, stream_context_get_options($context)['http']['timeout']);
    TestCase::assertFalse($includePath);
    TestCase::assertSame(0, $offset);
    TestCase::assertSame(1048577, $length);
    TestCase::assertSame(0, stream_context_get_options($context)['http']['follow_location']);
    TestCase::assertSame(0, stream_context_get_options($context)['http']['max_redirects']);
    TestCase::assertFalse(stream_context_get_options($context)['http']['ignore_errors']);
    return TextureAiMonitoringTest::$response;
}

function error_log(string $message): bool
{
    TextureAiMonitoringTest::$logs[] = $message;
    return true;
}

final class TextureAiMonitoringTest extends TestCase
{
    public static string|false $response = false;
    public static array $logs = [];
    public static array $requests = [];
    public static string $method = 'GET';

    public static function setUpBeforeClass(): void
    {
        $source = \file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        if ($source === false) {
            throw new RuntimeException('Cannot read texture AI endpoint.');
        }
        $start = strpos($source, 'function handle_status(');
        if ($start === false) {
            throw new RuntimeException('Cannot locate monitoring handlers.');
        }
        // Execute real handlers and service, replacing only HTTP and response boundaries.
        eval('namespace ' . __NAMESPACE__ . '; use \RuntimeException; use \JsonException; use \Exception; '
            . substr($source, $start));
    }

    protected function setUp(): void
    {
        self::$response = false;
        self::$logs = [];
        self::$requests = [];
        self::$method = 'GET';
    }

    protected function tearDown(): void
    {
        self::$response = false;
        self::$logs = [];
        self::$requests = [];
        self::$method = 'GET';
    }

    private function request(string $action): JsonResponse
    {
        $service = new class extends GQTextureAiService {
            public function __construct() {}
        };
        (new ReflectionProperty(GQTextureAiService::class, 'comfyuiBaseUrl'))->setValue($service, 'http://comfyui.test');
        (new ReflectionProperty(GQTextureAiService::class, 'model'))->setValue($service, 'sdxl');
        $handler = __NAMESPACE__ . '\\handle_' . $action;
        try {
            $handler($service);
        } catch (JsonResponse $response) {
            return $response;
        }
        throw new RuntimeException('Monitoring handler did not respond.');
    }

    public function testStatusReturnsBackendStats(): void
    {
        $stats = ['system' => ['os' => 'linux'], 'devices' => [['name' => 'GPU']]];
        self::$response = json_encode($stats, JSON_THROW_ON_ERROR);
        $response = $this->request('status');
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['success' => true, 'status' => 'available', 'model' => 'sdxl', 'stats' => $stats], $response->payload);
        $this->assertSame(['http://comfyui.test/system_stats'], self::$requests);
        $this->assertSame([], self::$logs);
    }

    public function testQueueUsesComfyUiFieldsWithoutDiscardingJobs(): void
    {
        $pending = [[2, 'pending-id', ['nodes' => []], [], []]];
        $running = [[1, 'running-id', ['nodes' => []], [], []]];
        self::$response = json_encode(['queue_pending' => $pending, 'queue_running' => $running], JSON_THROW_ON_ERROR);
        $response = $this->request('queue');
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['success' => true, 'pending' => $pending, 'running' => $running], $response->payload);
        $this->assertSame(['http://comfyui.test/queue'], self::$requests);
    }

    public function testEmptyQueueIsAValidSuccessfulResponse(): void
    {
        self::$response = '{"queue_pending":[],"queue_running":[]}';
        $response = $this->request('queue');
        $this->assertSame(200, $response->getCode());
        $this->assertSame(['success' => true, 'pending' => [], 'running' => []], $response->payload);
    }

    /** @return iterable<string, array{string, string|false}> */
    public static function invalidResponses(): iterable
    {
        foreach (['status', 'queue'] as $action) {
            foreach ([false, '{broken', 'null', '[]', '"secret"', '{}'] as $index => $body) {
                yield $action . '-' . $index => [$action, $body];
            }
        }
        yield 'old-queue-fields' => ['queue', '{"queue":[],"executing":null}'];
        yield 'missing-running' => ['queue', '{"queue_pending":[]}'];
        yield 'null-running' => ['queue', '{"queue_pending":[],"queue_running":null}'];
        yield 'object-pending' => ['queue', '{"queue_pending":{"id":1},"queue_running":[]}'];
        yield 'invalid-system' => ['status', '{"system":null,"devices":[]}'];
        yield 'oversized-status' => ['status', str_repeat(' ', 1048577)];
        yield 'oversized-queue' => ['queue', str_repeat(' ', 1048577)];
    }

    #[DataProvider('invalidResponses')]
    public function testBackendFailuresAreExplicitAndLogged(string $action, string|false $body): void
    {
        self::$response = $body;
        $response = $this->request($action);
        $this->assertSame(503, $response->getCode());
        $this->assertSame([
            'success' => false,
            'error' => 'AI texture service ' . ($action === 'status' ? 'status' : 'queue') . ' unavailable.',
        ], $response->payload);
        $this->assertCount(1, self::$logs);
        $this->assertStringStartsWith('texture_ai ' . $action . ' error:', self::$logs[0]);
    }

    public function testNonGetRequestsDoNotContactBackend(): void
    {
        self::$method = 'POST';
        foreach (['status', 'queue'] as $action) {
            $this->assertSame(405, $this->request($action)->getCode());
        }
        $this->assertSame([], self::$requests);
        $this->assertSame([], self::$logs);
    }
}
