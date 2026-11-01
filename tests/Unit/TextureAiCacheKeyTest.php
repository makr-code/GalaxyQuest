<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiCacheKey;

use JsonException;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use ReflectionProperty;
use RuntimeException;

final class TextureAiCacheKeyTest extends TestCase
{
    private object $service;
    private string $cacheDir;
    private array $previousServer;

    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        if ($source === false) {
            throw new RuntimeException('Cannot read texture AI service.');
        }
        $offset = strpos($source, 'class GQTextureAiService');
        if ($offset === false) {
            throw new RuntimeException('Cannot locate texture AI service.');
        }
        eval('namespace ' . __NAMESPACE__ . '; use \JsonException; use \RuntimeException; use \Exception; '
            . substr($source, $offset));
    }

    protected function setUp(): void
    {
        $this->previousServer = $_SERVER;
        unset($_SERVER['HTTP_IF_NONE_MATCH']);
        $this->cacheDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gq-texture-key-' . bin2hex(random_bytes(8));
        if (!mkdir($this->cacheDir, 0700)) {
            throw new RuntimeException('Cannot create isolated texture cache.');
        }
        $this->service = new class extends GQTextureAiService {
            public function __construct() {}
        };
        foreach ([
            'model' => 'sdxl', 'checkpoint' => 'test.safetensors', 'diffusionSteps' => 30, 'guidanceScale' => 8.5,
            'cacheMode' => 'disk', 'cacheDir' => $this->cacheDir,
        ] as $property => $value) {
            (new ReflectionProperty(GQTextureAiService::class, $property))->setValue($this->service, $value);
        }
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->previousServer;
        $files = scandir($this->cacheDir);
        if ($files === false) {
            throw new RuntimeException('Cannot inspect isolated texture cache.');
        }
        foreach ($files as $file) {
            if ($file !== '.' && $file !== '..' && !unlink($this->cacheDir . DIRECTORY_SEPARATOR . $file)) {
                throw new RuntimeException('Cannot remove test texture.');
            }
        }
        if (!rmdir($this->cacheDir)) {
            throw new RuntimeException('Cannot remove isolated texture cache.');
        }
    }

    private function key(array $descriptor): string
    {
        return (new ReflectionMethod(GQTextureAiService::class, 'generateCacheKey'))->invoke($this->service, $descriptor);
    }

    public function testTopLevelKeyOrderHasNoEffectAndMatchesSha256(): void
    {
        $descriptor = ['type' => 'spaceship', 'seed' => 7, 'faction' => 'fleet'];
        $expected = hash('sha256', '{"faction":"fleet","seed":7,"type":"spaceship"}');
        $this->assertSame($expected, $this->key($descriptor));
        $this->assertSame($expected, $this->key(array_reverse($descriptor, true)));
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $expected);
    }

    public function testNestedMapsAreSortedButListOrderIsPreserved(): void
    {
        $a = ['options' => ['z' => 1, 'a' => 2], 'layers' => [['z' => 3, 'a' => 4], 'base']];
        $b = ['layers' => [['a' => 4, 'z' => 3], 'base'], 'options' => ['a' => 2, 'z' => 1]];
        $this->assertSame($this->key($a), $this->key($b));
        $b['layers'] = array_reverse($b['layers']);
        $this->assertNotSame($this->key($a), $this->key($b));
    }

    public function testDistinctParametersAndTypesHaveDistinctKeys(): void
    {
        $base = ['type' => 'spaceship', 'seed' => 7, 'size' => 512, 'model' => 'sdxl'];
        foreach (['seed' => 8, 'size' => 1024, 'model' => 'other', 'type' => 'planet'] as $field => $value) {
            $this->assertNotSame($this->key($base), $this->key(array_replace($base, [$field => $value])));
        }
        $this->assertNotSame($this->key(['seed' => 7]), $this->key(['seed' => '7']));
    }

    public function testInvalidJsonInputDoesNotProduceAKey(): void
    {
        $this->expectException(JsonException::class);
        $this->key(['faction' => "\xB1\x31"]);
    }

    public function testRealGenerateTextureReturnsExistingCacheEntry(): void
    {
        $descriptor = ['type' => 'spaceship', 'seed' => 7, 'faction' => 'fleet'];
        $normalized = (new ReflectionMethod(GQTextureAiService::class, 'normalizeDescriptor'))
            ->invoke($this->service, $descriptor, 512);
        $key = $this->key($normalized);
        $path = $this->cacheDir . DIRECTORY_SEPARATOR . $key . '.png';
        if (file_put_contents($path, 'cached-texture-fixture') === false) {
            throw new RuntimeException('Cannot write test texture.');
        }
        $response = $this->service->generateTexture(array_reverse($descriptor, true), 512);
        $this->assertTrue($response['success']);
        $this->assertSame('cache', $response['source']);
        $this->assertSame($key, $response['cache_key']);
        $this->assertSame('generated/ai_textures/' . $key . '.png', $response['path']);
        $this->assertSame('"' . $key . '"', $response['etag']);
    }
}
