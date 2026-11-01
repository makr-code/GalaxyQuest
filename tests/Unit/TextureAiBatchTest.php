<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TextureAiBatch;

use PHPUnit\Framework\TestCase;
use RuntimeException;

function usleep(int $microseconds): void
{
    TestCase::assertSame(500000, $microseconds);
}

final class TextureAiBatchTest extends TestCase
{
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
        // Load the real class without endpoint dispatch or cache-directory creation.
        eval('namespace ' . __NAMESPACE__ . '; use \Exception; use \RuntimeException; '
            . substr($source, $offset));
    }

    private function service(array $failures = []): object
    {
        return new class($failures) extends GQTextureAiService {
            public array $calls = [];

            public function __construct(private array $failures) {}

            public function generateTexture(array $descriptor, int $size = 512): array
            {
                $this->calls[] = [$descriptor, $size];
                $failure = $this->failures[$descriptor['texture_type']] ?? null;
                if ($failure === 'exception') {
                    throw new RuntimeException('Simulated map failure');
                }
                return ['success' => $failure !== 'result', 'seed' => $descriptor['seed']];
            }
        };
    }

    public function testAllFourMapsUseDeterministicDistinctSeeds(): void
    {
        $service = $this->service();
        $descriptor = ['type' => 'spaceship', 'seed' => 123, 'faction' => 'fleet', 'use_controlnet' => true];
        $result = $service->generateBatchPBR($descriptor, 1024);
        $maps = ['albedo', 'normal', 'specular', 'roughness'];
        $this->assertTrue($result['success']);
        $this->assertTrue($result['batch']);
        $this->assertTrue($result['use_controlnet']);
        $this->assertSame(4, $result['success_count']);
        $this->assertSame(4, $result['total_maps']);
        $this->assertSame($maps, array_keys($result['maps']));
        foreach ($maps as $index => $map) {
            $expected = array_merge($descriptor, ['texture_type' => $map, 'seed' => 123 + abs(crc32($map))]);
            $this->assertSame([$expected, 1024], $service->calls[$index]);
            $this->assertSame($expected['seed'], $result['maps'][$map]['seed']);
        }
        $this->assertCount(4, array_unique(array_column(array_column($service->calls, 0), 'seed')));
        $this->assertSame($result, $service->generateBatchPBR($descriptor, 1024));
    }

    public function testPartialFailuresDoNotPreventOtherMaps(): void
    {
        $service = $this->service(['normal' => 'result', 'specular' => 'exception']);
        $result = $service->generateBatchPBR(['type' => 'planet']);
        $this->assertTrue($result['success']);
        $this->assertSame(2, $result['success_count']);
        $this->assertCount(4, $service->calls);
        $this->assertSame(['success' => false, 'error' => 'failed'], $result['maps']['normal']);
        $this->assertSame(['success' => false, 'error' => 'Simulated map failure'], $result['maps']['specular']);
        $this->assertTrue($result['maps']['roughness']['success']);
        $this->assertFalse($result['use_controlnet']);
        $this->assertSame(abs(crc32('albedo')), $service->calls[0][0]['seed']);
        $this->assertSame(512, $service->calls[0][1]);
    }

    public function testAllFailedMapsReportBatchFailure(): void
    {
        $service = $this->service(array_fill_keys(['albedo', 'normal', 'specular', 'roughness'], 'result'));
        $result = $service->generateBatchPBR(['type' => 'spaceship', 'seed' => 0]);
        $this->assertFalse($result['success']);
        $this->assertSame(0, $result['success_count']);
        $this->assertSame(4, $result['total_maps']);
    }

    public function testMissingDescriptorTypeDoesNotGenerateMaps(): void
    {
        $service = $this->service();
        $this->assertSame(['success' => false, 'error' => 'invalid descriptor'], $service->generateBatchPBR([]));
        $this->assertSame([], $service->calls);
    }
}
