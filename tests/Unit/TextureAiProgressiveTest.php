<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiProgressive;

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
    TestCase::assertSame(['POST'], $methods);
}

function verify_csrf(): void
{
    TextureAiProgressiveTest::$csrfVerifications++;
}

function get_json_body(): array
{
    return TextureAiProgressiveTest::$input;
}

function error_log(string $message): bool
{
    TextureAiProgressiveTest::$logs[] = $message;
    return true;
}

final class TextureAiProgressiveTest extends TestCase
{
    public static array $logs = [];
    public static array $input = [];
    public static int $csrfVerifications = 0;

    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        $start = $source === false ? false : strpos($source, 'function handle_progressive_loading(');
        if ($start === false) {
            throw new RuntimeException('Cannot locate progressive handler.');
        }
        eval('namespace ' . __NAMESPACE__ . '; use \RuntimeException; use \JsonException; use \Exception; '
            . substr($source, $start));
    }

    protected function setUp(): void
    {
        self::$input = [];
        self::$csrfVerifications = 0;
        self::$logs = [];
    }

    protected function tearDown(): void
    {
        self::$input = [];
        self::$csrfVerifications = 0;
        self::$logs = [];
    }

    private function service(): object
    {
        return new class extends GQTextureAiService {
            public array $calls = [];
            public bool $fail = false;
            public bool $throws = false;
            public function __construct() {}
            public function generateTexture(array $descriptor, int $size = 512): array
            {
                $this->calls[] = [$descriptor, $size];
                if ($this->throws) {
                    throw new RuntimeException('backend-secret');
                }
                return $this->fail ? ['success' => false, 'error' => 'failed']
                    : ['success' => true, 'path' => 'generated/' . $size . '.png'];
            }
        };
    }

    private function request(object $service): JsonResponse
    {
        try {
            only_method('POST');
            verify_csrf();
            handle_progressive_loading($service, self::$input);
        } catch (JsonResponse $response) {
            return $response;
        }
    }

    public function testBothPhasesPreserveDescriptorAndTerminateUpgradeChain(): void
    {
        $service = $this->service();
        self::$input = ['target_size' => '513', 'seed' => '0', 'faction' => 'fleet'];
        $low = $this->request($service);
        $this->assertSame(200, $low->getCode());
        $this->assertSame(1, self::$csrfVerifications);
        $this->assertSame(256, $service->calls[0][1]);
        $this->assertSame('low_res_ready', $low->payload['phase']);
        $request = $low->payload['high_res_request'];
        $this->assertSame(0, $request['seed']);
        $this->assertSame('progressive', $request['action']);
        unset($request['action']);
        self::$input = $request + ['phase' => 'high_res'];
        $high = $this->request($service);
        $this->assertSame(2, self::$csrfVerifications);
        $this->assertSame(200, $high->getCode());
        $this->assertSame(513, $service->calls[1][1]);
        $this->assertSame($service->calls[0][0], $service->calls[1][0]);
        $this->assertSame('high_res_ready', $high->payload['phase']);
        $this->assertSame('generated/513.png', $high->payload['high_res']['path']);
        $this->assertArrayNotHasKey('high_res_request', $high->payload);
    }

    /** @return iterable<array{mixed, mixed}> */
    public static function invalidInputs(): iterable
    {
        foreach ([127, 1025, 'bad', '512.5', []] as $size) {
            yield [$size, 'low_res'];
        }
        yield [512, 'unknown'];
        yield [512, []];
    }

    #[DataProvider('invalidInputs')]
    public function testInvalidSizeOrPhaseDoesNotGenerate(mixed $size, mixed $phase): void
    {
        self::$input = ['target_size' => $size, 'phase' => $phase];
        $service = $this->service();
        $this->assertSame(400, $this->request($service)->getCode());
        $this->assertSame([], $service->calls);
    }

    public function testGenerationFailureIsLoggedAndReturns500(): void
    {
        $service = $this->service();
        $service->fail = true;
        $this->assertSame(500, $this->request($service)->getCode());
        $this->assertCount(1, self::$logs);
        $service->fail = false;
        $service->throws = true;
        $response = $this->request($service);
        $this->assertSame(500, $response->getCode());
        $this->assertStringNotContainsString('backend-secret', $response->payload['error']);
        $this->assertCount(2, self::$logs);
    }

    /** @return iterable<array{int, int}> */
    public static function sizes(): iterable
    {
        yield [128, 128];
        yield [255, 128];
        yield [512, 256];
        yield [1024, 256];
    }

    #[DataProvider('sizes')]
    public function testSizeBoundariesUseIntegerSizes(int $target, int $lowSize): void
    {
        $service = $this->service();
        self::$input = ['target_size' => $target];
        $this->request($service);
        $this->assertSame($lowSize, $service->calls[0][1]);
        self::$input['phase'] = 'high_res';
        $this->request($service);
        $this->assertSame($target, $service->calls[1][1]);
    }
}
