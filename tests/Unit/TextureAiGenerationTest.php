<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiGeneration;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionProperty;
use ReflectionMethod;
use RuntimeException;

function file_get_contents(string $path, bool $includePath = false, mixed $context = null, int $offset = 0, ?int $length = null): string|false
{
    if (!str_starts_with($path, 'http://comfyui.test')) {
        return \file_get_contents($path, $includePath, $context, $offset, $length);
    }
    TextureAiGenerationTest::$requests[] = [$path, stream_context_get_options($context)];
    $options = stream_context_get_options($context)['http'];
    TestCase::assertSame(0, $options['follow_location']);
    TestCase::assertSame(0, $options['max_redirects']);
    TestCase::assertFalse($options['ignore_errors']);
    TextureAiGenerationTest::$clock += TextureAiGenerationTest::$httpDelay;
    TestCase::assertSame(0, $offset);
    TestCase::assertSame(str_contains($path, '/view?') ? 16777217 : 1048577, $length);
    $next = array_shift(TextureAiGenerationTest::$responses);
    if ($next === null) {
        throw new RuntimeException('Unexpected HTTP request: ' . $path);
    }
    return $next;
}

function sleep(int $seconds): int
{
    TextureAiGenerationTest::$waits[] = $seconds;
    TextureAiGenerationTest::$clock += $seconds * 1000000000;
    return 0;
}

function hrtime(bool $asNumber = false): int
{
    return TextureAiGenerationTest::$clock;
}

function error_log(string $message): bool
{
    TextureAiGenerationTest::$logs[] = $message;
    return true;
}

function rename(string $from, string $to): bool
{
    return TextureAiGenerationTest::$publishFailure ? false : \rename($from, $to);
}

function file_put_contents(string $path, string $data): int|false
{
    if (TextureAiGenerationTest::$partialWrite) {
        return \file_put_contents($path, substr($data, 0, intdiv(strlen($data), 2)));
    }
    return \file_put_contents($path, $data);
}

final class TextureAiGenerationTest extends TestCase
{
    public static bool $publishFailure = false;
    public static bool $partialWrite = false;
    public static int $clock = 1000000000000;
    public static int $httpDelay = 0;
    public static array $responses = [];
    public static array $requests = [];
    public static array $waits = [];
    public static array $logs = [];
    private string $dir;
    private object $service;
    private array $previousServer;

    public static function setUpBeforeClass(): void
    {
        $source = \file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        $offset = $source === false ? false : strpos($source, 'class GQTextureAiService');
        if ($offset === false) {
            throw new RuntimeException('Cannot read texture service.');
        }
        eval('namespace ' . __NAMESPACE__ . '; use \RuntimeException; use \JsonException; use \Exception; '
            . substr($source, $offset));
    }

    protected function setUp(): void
    {
        self::$publishFailure = false;
        self::$partialWrite = false;
        self::$clock = 1000000000000;
        self::$httpDelay = 0;
        self::$responses = self::$requests = self::$waits = self::$logs = [];
        $this->previousServer = $_SERVER;
        unset($_SERVER['HTTP_IF_NONE_MATCH']);
        $this->dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-generation-' . bin2hex(random_bytes(8));
        if (!mkdir($this->dir, 0700) || !mkdir($this->dir . '/locks', 0700)) {
            throw new RuntimeException('Cannot create isolated generation directories.');
        }
        $this->service = new class extends GQTextureAiService {
            public function __construct() {}
        };
        foreach ([
            'comfyuiBaseUrl' => 'http://comfyui.test', 'model' => 'sdxl',
            'checkpoint' => 'fixture.safetensors', 'diffusionSteps' => 30, 'guidanceScale' => 8.5,
            'cacheMode' => 'disk', 'cacheDir' => $this->dir, 'lockDir' => $this->dir . '/locks',
            'fallbackProcedural' => true,
        ] as $property => $value) {
            $this->setProperty($property, $value);
        }
    }

    private function setProperty(string $name, mixed $value): void
    {
        (new ReflectionProperty(GQTextureAiService::class, $name))->setValue($this->service, $value);
    }

    protected function tearDown(): void
    {
        self::$publishFailure = false;
        self::$partialWrite = false;
        self::$httpDelay = 0;
        $_SERVER = $this->previousServer;
        $blockedPath = $this->dir . '/not-a-directory';
        if (is_file($blockedPath) && !unlink($blockedPath)) {
            throw new RuntimeException('Cannot remove test fixture.');
        }
        foreach (['tmp', 'locks', ''] as $subdir) {
            $path = $this->dir . ($subdir === '' ? '' : DIRECTORY_SEPARATOR . $subdir);
            if (!is_dir($path)) {
                continue;
            }
            foreach (new \DirectoryIterator($path) as $file) {
                if (!$file->isDot() && $file->isFile() && !unlink($file->getPathname())) {
                    throw new RuntimeException('Cannot remove test output.');
                }
            }
            if (!rmdir($path)) {
                throw new RuntimeException('Cannot remove isolated test directory.');
            }
        }
        self::$responses = self::$requests = self::$waits = self::$logs = [];
    }

    private function png(int $width = 1, int $height = 1): string
    {
        $image = imagecreatetruecolor($width, $height);
        ob_start();
        try {
            imagepng($image);
            return ob_get_contents();
        } finally {
            ob_end_clean();
            imagedestroy($image);
        }
    }

    private function history(string $id = 'job-1'): string
    {
        return json_encode([$id => [
            'status' => ['completed' => true, 'status_str' => 'success'],
            'outputs' => ['6' => ['images' => [['filename' => 'image.png', 'subfolder' => 'folder name', 'type' => 'output']]]],
        ]], JSON_THROW_ON_ERROR);
    }

    private function assertLocksReleased(): void
    {
        foreach (glob($this->dir . '/locks/*.lock') as $path) {
            $handle = fopen($path, 'c+');
            try {
                $this->assertTrue(flock($handle, LOCK_EX | LOCK_NB));
                flock($handle, LOCK_UN);
            } finally {
                fclose($handle);
            }
        }
    }

    public function testSubmissionWorkflowDownloadAndCacheHit(): void
    {
        self::$responses = ['{"prompt_id":"job-1","node_errors":{}}', '{}', $this->history(), $this->png()];
        $descriptor = ['type' => 'spaceship', 'seed' => 7, 'size' => 9999, 'model' => 'untrusted',
            'steps' => 999, 'guidance' => 99, 'checkpoint' => 'untrusted', 'faction' => 'fleet'];
        $result = $this->service->generateTexture($descriptor, 2048);
        $this->assertTrue($result['success']);
        $this->assertFileExists($this->dir . '/' . $result['cache_key'] . '.png');
        $this->assertSame($this->png(), \file_get_contents($this->dir . '/' . $result['cache_key'] . '.png'));
        $this->assertCount(4, self::$requests);
        $payload = json_decode(self::$requests[0][1]['http']['content'], true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame(['prompt'], array_keys($payload));
        $graph = $payload['prompt'];
        $this->assertSame('POST', self::$requests[0][1]['http']['method']);
        $this->assertSame(120.0, self::$requests[0][1]['http']['timeout']);
        $this->assertSame('fixture.safetensors', $graph['5']['inputs']['ckpt_name']);
        $this->assertSame(['width' => 1024, 'height' => 1024, 'batch_size' => 1], $graph['7']['inputs']);
        $this->assertSame('CLIPTextEncode', $graph['1']['class_type']);
        $this->assertSame('CLIPTextEncode', $graph['2']['class_type']);
        $this->assertSame(['5', 1], $graph['1']['inputs']['clip']);
        $this->assertSame(['5', 1], $graph['2']['inputs']['clip']);
        $this->assertSame(['5', 2], $graph['4']['inputs']['vae']);
        foreach (['model' => ['5', 0], 'positive' => ['1', 0], 'negative' => ['2', 0], 'latent_image' => ['7', 0]] as $key => $link) {
            $this->assertSame($link, $graph['3']['inputs'][$key]);
        }
        $this->assertSame(30, $graph['3']['inputs']['steps']);
        $this->assertSame(8.5, $graph['3']['inputs']['cfg']);
        $this->assertSame(7, $graph['3']['inputs']['seed']);
        parse_str(parse_url(self::$requests[3][0], PHP_URL_QUERY), $download);
        $this->assertSame(['filename' => 'image.png', 'subfolder' => 'folder name', 'type' => 'output'], $download);
        $this->assertSame([2], self::$waits);
        $_SERVER['HTTP_IF_NONE_MATCH'] = $result['etag'];
        $this->assertSame($result, $this->service->generateTexture($descriptor, 2048));
        $this->assertCount(4, self::$requests);
        $this->assertLocksReleased();
    }

    /** @return iterable<string, array{array}> */
    public static function failures(): iterable
    {
        yield 'transport' => [[false]];
        yield 'invalid-json' => [['{bad']];
        yield 'missing-id' => [['{}']];
        yield 'invalid-id' => [['{"prompt_id":42}']];
        yield 'node-errors' => [['{"prompt_id":"job-1","node_errors":{"3":"bad"}}']];
        yield 'history-json' => [['{"prompt_id":"job-1"}', '{bad']];
        yield 'execution-error' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":{"status_str":"error"}}}']];
        yield 'no-image' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":{"completed":true},"outputs":{}}}']];
        yield 'image-metadata' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":42}]}}}}']];
        yield 'invalid-image' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":"x.png"}]}}}}', '<html>error</html>']];
        yield 'download-failure' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":"x.png"}]}}}}', false]];
        yield 'submission-list' => [['[]']];
        yield 'submission-null' => [['null']];
        yield 'submission-error' => [['{"prompt_id":"job-1","error":"backend rejected"}']];
        yield 'invalid-node-errors' => [['{"prompt_id":"job-1","node_errors":"invalid"}']];
        yield 'history-list' => [['{"prompt_id":"job-1"}', '[]']];
        yield 'history-null' => [['{"prompt_id":"job-1"}', 'null']];
        yield 'null-job' => [['{"prompt_id":"job-1"}', '{"job-1":null}']];
        yield 'scalar-job' => [['{"prompt_id":"job-1"}', '{"job-1":"bad"}']];
        yield 'scalar-status' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":"success"}}']];
        yield 'numeric-completed' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":{"completed":1}}}']];
        yield 'scalar-outputs' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":"bad"}}']];
        yield 'scalar-output-node' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":"bad"}}}']];
        yield 'scalar-image-list' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":"bad"}}}}']];
        yield 'associative-image-list' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":{"name":"x.png"}}}}}']];
        yield 'scalar-image' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":["x.png"]}}}}']];
        yield 'invalid-image-type' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":"x.png","type":"input"}]}}}}']];
        yield 'null-node-errors' => [['{"prompt_id":"job-1","node_errors":null}']];
        yield 'null-status' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":null}}']];
        yield 'null-completed' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":{"completed":null}}}']];
        yield 'array-status-text' => [['{"prompt_id":"job-1"}', '{"job-1":{"status":{"status_str":[]}}}']];
        yield 'null-outputs' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":null}}']];
        yield 'null-image-list' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":null}}}}']];
        yield 'null-image' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[null]}}}}']];
        yield 'null-image-subfolder' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":"x.png","subfolder":null}]}}}}']];
        yield 'null-image-type' => [['{"prompt_id":"job-1"}', '{"job-1":{"outputs":{"6":{"images":[{"filename":"x.png","type":null}]}}}}']];
    }

    #[DataProvider('failures')]
    public function testFailuresDoNotPublishCacheAndReleaseLocks(array $responses): void
    {
        self::$responses = $responses;
        $result = $this->service->generateTexture(['type' => 'planet'], 512);
        $this->assertSame(['success' => false, 'error' => 'Texture generation failed.', 'fallback_required' => true], $result);
        $this->assertSame([], glob($this->dir . '/*.png'));
        $this->assertCount(1, self::$logs);
        $this->assertLocksReleased();
    }

    public function testMissingLockDirectoryFailsBeforeContactingBackend(): void
    {
        $blockedPath = $this->dir . '/not-a-directory';
        if (file_put_contents($blockedPath, 'file') === false) {
            throw new RuntimeException('Cannot create lock directory fixture.');
        }
        $this->setProperty('lockDir', $blockedPath);
        $result = $this->service->generateTexture(['type' => 'planet']);
        $this->assertFalse($result['success']);
        $this->assertSame([], self::$requests);
        $this->assertCount(1, self::$logs);
    }

    public function testPollingHasBoundedRetries(): void
    {
        self::$responses = array_merge(['{"prompt_id":"job-1"}'], array_fill(0, 30, '{}'));
        $result = $this->service->generateTexture(['type' => 'planet']);
        $this->assertFalse($result['success']);
        $this->assertCount(31, self::$requests);
        $this->assertCount(30, self::$waits);
        $this->assertLocksReleased();
    }

    public function testDisabledDiskCacheRegeneratesEvenWhenFileExists(): void
    {
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
        $first = $this->service->generateTexture(['type' => 'planet']);
        $this->setProperty('cacheMode', 'none');
        self::$responses = ['{"prompt_id":"job-2"}', $this->history('job-2'), $this->png()];
        $second = $this->service->generateTexture(['type' => 'planet']);
        $this->assertTrue($first['success']);
        $this->assertTrue($second['success']);
        $this->assertSame($first['cache_key'], $second['cache_key']);
        $this->assertCount(6, self::$requests);
        $this->assertLocksReleased();
    }

    public function testPromptIdentifierCannotEscapeTemporaryDirectory(): void
    {
        $id = '../escape';
        self::$responses = ['{"prompt_id":"../escape"}', $this->history($id), $this->png()];
        $result = $this->service->generateTexture(['type' => 'planet']);
        $this->assertTrue($result['success']);
        $this->assertSame([], glob($this->dir . '/tmp/*'));
        $this->assertFileDoesNotExist($this->dir . '/escape.png');
        $this->assertLocksReleased();
    }

    public function testDisabledFallbackDoesNotAdvertiseFallback(): void
    {
        $this->setProperty('fallbackProcedural', false);
        self::$responses = [false];
        $this->assertSame(
            ['success' => false, 'error' => 'Texture generation failed.'],
            $this->service->generateTexture(['type' => 'planet'])
        );
        $this->assertCount(1, self::$logs);
        $this->assertLocksReleased();
    }

    public function testOversizedSubmissionAndHistoryAreRejected(): void
    {
        foreach ([
            [str_repeat(' ', 1048577)],
            ['{"prompt_id":"job-1"}', str_repeat(' ', 1048577)],
        ] as $responses) {
            self::$responses = $responses;
            $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
            $this->assertSame([], glob($this->dir . '/*.png'));
            $this->assertLocksReleased();
        }
        $this->assertCount(2, self::$logs);
    }

    public function testExactlyJsonByteLimitIsAccepted(): void
    {
        $submission = '{"prompt_id":"job-1"}';
        self::$responses = [
            $submission . str_repeat(' ', 1048576 - strlen($submission)),
            $this->history(), $this->png(),
        ];
        $this->assertTrue($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertLocksReleased();
    }

    public function testOversizedImagesAndDimensionsAreRejected(): void
    {
        foreach ([str_repeat('x', 16777217), $this->png(1025, 1), $this->png(1, 1025)] as $image) {
            self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $image];
            $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
            $this->assertSame([], glob($this->dir . '/*.png'));
            $this->assertSame([], glob($this->dir . '/tmp/*'));
            $this->assertLocksReleased();
        }
    }

    public function testPngHeaderAloneIsNotEnoughToPublishImage(): void
    {
        $truncated = substr($this->png(), 0, 33);
        $this->assertIsArray(getimagesizefromstring($truncated));
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $truncated];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertSame([], glob($this->dir . '/*.png'));
        $this->assertLocksReleased();
    }

    public function testMaximumDimensionsAreAccepted(): void
    {
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png(1024, 1024)];
        $this->assertTrue($this->service->generateTexture(['type' => 'planet'], 1024)['success']);
        $this->assertLocksReleased();
    }

    public function testFailedPublicationRemovesTemporaryImage(): void
    {
        self::$publishFailure = true;
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertSame([], glob($this->dir . '/*.png'));
        $this->assertSame([], glob($this->dir . '/tmp/*'));
        $this->assertLocksReleased();
    }

    public function testPartialImageWriteIsRemovedAndNotPublished(): void
    {
        self::$partialWrite = true;
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertSame([], glob($this->dir . '/*.png'));
        $this->assertSame([], glob($this->dir . '/tmp/*'));
        $this->assertCount(1, self::$logs);
        $this->assertLocksReleased();
    }

    public function testExactlyImageByteLimitIsAccepted(): void
    {
        $png = $this->png();
        self::$responses = [
            '{"prompt_id":"job-1"}', $this->history(),
            $png . str_repeat("\0", 16777216 - strlen($png)),
        ];
        $this->assertTrue($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertLocksReleased();
    }

    public function testRealStreamReadEnforcesExactLimit(): void
    {
        $method = new ReflectionMethod(GQTextureAiService::class, 'readHttpResponse');
        $context = stream_context_create();
        $this->assertSame(
            str_repeat('x', 32),
            $method->invoke($this->service, 'data://text/plain,' . str_repeat('x', 32), $context, 32)
        );
        $this->expectException(RuntimeException::class);
        $method->invoke($this->service, 'data://text/plain,' . str_repeat('x', 1000), $context, 32);
    }

    public function testCapacityExhaustionStopsBeforeHttpAndSlotCanBeReused(): void
    {
        $this->setProperty('maxConcurrent', 1);
        $handle = fopen($this->dir . '/locks/slot_0.lock', 'c+');
        try {
            $this->assertTrue(flock($handle, LOCK_EX | LOCK_NB));
            $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
            $this->assertSame([], self::$requests);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
        $this->assertTrue($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertLocksReleased();
    }

    public function testSecondSlotAllowsGenerationWhenFirstIsOccupied(): void
    {
        $handle = fopen($this->dir . '/locks/slot_0.lock', 'c+');
        try {
            flock($handle, LOCK_EX);
            self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
            $this->assertTrue($this->service->generateTexture(['type' => 'planet'])['success']);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
        $this->assertLocksReleased();
    }

    public function testExpiredHttpBudgetStopsBeforeHistoryAndReleasesSlots(): void
    {
        $this->setProperty('generationTimeout', 5);
        self::$httpDelay = 5000000000;
        self::$responses = ['{"prompt_id":"job-1"}'];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertCount(1, self::$requests);
        $this->assertSame(5.0, self::$requests[0][1]['http']['timeout']);
        $this->assertLocksReleased();
    }

    public function testPollingWaitCannotExceedBudget(): void
    {
        $this->setProperty('generationTimeout', 3);
        self::$responses = ['{"prompt_id":"job-1"}', '{}', '{}'];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertSame([2], self::$waits);
        $this->assertCount(3, self::$requests);
        $this->assertSame(1.0, self::$requests[2][1]['http']['timeout']);
        $this->assertLocksReleased();
    }

    public function testExpiredDownloadDoesNotPublishImage(): void
    {
        $this->setProperty('generationTimeout', 5);
        self::$httpDelay = 2000000000;
        self::$responses = ['{"prompt_id":"job-1"}', $this->history(), $this->png()];
        $this->assertFalse($this->service->generateTexture(['type' => 'planet'])['success']);
        $this->assertSame(1.0, self::$requests[2][1]['http']['timeout']);
        $this->assertSame([], glob($this->dir . '/*.png'));
        $this->assertLocksReleased();
    }

    public function testSameDescriptorLockDoesNotWaitOrSubmit(): void
    {
        $descriptor = ['type' => 'planet'];
        $normalized = (new ReflectionMethod(GQTextureAiService::class, 'normalizeDescriptor'))
            ->invoke($this->service, $descriptor, 512);
        $key = (new ReflectionMethod(GQTextureAiService::class, 'generateCacheKey'))
            ->invoke($this->service, $normalized);
        $handle = fopen($this->dir . '/locks/' . $key . '.lock', 'c+');
        try {
            flock($handle, LOCK_EX);
            $this->assertFalse($this->service->generateTexture($descriptor)['success']);
            $this->assertSame([], self::$requests);
            $this->assertSame([], self::$waits);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
        $this->assertLocksReleased();
    }

    /** @return iterable<array{string, string}> */
    public static function invalidCapacityConfig(): iterable
    {
        yield ['COMFYUI_MAX_CONCURRENT', '0'];
        yield ['COMFYUI_MAX_CONCURRENT', '17'];
        yield ['COMFYUI_MAX_CONCURRENT', 'two'];
        yield ['COMFYUI_QUEUE_TIMEOUT', '0'];
        yield ['COMFYUI_QUEUE_TIMEOUT', '601'];
        yield ['COMFYUI_QUEUE_TIMEOUT', '1.5'];
    }

    #[DataProvider('invalidCapacityConfig')]
    public function testInvalidConfigFailsBeforeDirectorySetup(string $name, string $value): void
    {
        $previous = getenv($name);
        putenv($name . '=' . $value);
        try {
            $this->expectException(\InvalidArgumentException::class);
            $this->expectExceptionMessage('Invalid ' . $name);
            new GQTextureAiService();
        } finally {
            putenv($previous === false ? $name : $name . '=' . $previous);
        }
    }

    /** @return iterable<array{string|false, string, bool}> */
    public static function enabledSettings(): iterable
    {
        yield [false, 'dev', true];
        yield ['', 'dev', true];
        yield ['0', 'dev', false];
        yield ['1', 'dev', true];
        yield [false, 'production', false];
        yield ['', 'production', false];
        yield ['0', 'production', false];
        yield ['1', 'production', true];
        yield ['invalid', 'dev', false];
    }

    #[DataProvider('enabledSettings')]
    public function testExplicitDisabledSettingIsNotOverriddenByDevDefault(string|false $setting, string $env, bool $expected): void
    {
        $source = \file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        $start = strpos($source, '$enabledSetting =');
        $end = strpos($source, 'if (!$aiEnabled)', $start);
        if ($start === false || $end === false) {
            throw new RuntimeException('Cannot locate AI enablement gate.');
        }
        $gate = str_replace(
            ["getenv('COMFYUI_ENABLED')", 'app_is_development()'],
            [var_export($setting, true), var_export($env === 'dev', true)],
            substr($source, $start, $end - $start)
        );
        $this->assertSame($expected, eval($gate . 'return $aiEnabled;'));
    }
}
