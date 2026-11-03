<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TextureEndpointReadSideEffectsTest extends TestCase
{
    public function testProceduralTextureGetOnlyReadsCacheAndRendersMissingTexturesInMemory(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures.php');
        self::assertIsString($source);

        $handlerEnd = strpos($source, "\nfunction decode_descriptor");
        self::assertNotFalse($handlerEnd);
        $handler = substr($source, 0, $handlerEnd);

        foreach ([
            'mkdir(',
            'fopen(',
            'flock(',
            'file_put_contents(',
            'unlink(',
            'rename(',
            'copy(',
        ] as $writeOperation) {
            self::assertStringNotContainsString($writeOperation, $handler);
        }

        self::assertStringContainsString('is_file($cacheFile)', $handler);
        self::assertStringContainsString('file_get_contents($cacheFile)', $handler);
        self::assertStringContainsString('render_planet_map_png($map, $size, $height, $normalizedDescriptor)', $handler);
        self::assertStringContainsString('render_planet_map_svg($map, $size, $height, $normalizedDescriptor)', $handler);
        self::assertStringContainsString("header('ETag: ' . \$etag)", $handler);
        self::assertStringContainsString('http_response_code(304)', $handler);
        self::assertStringContainsString('echo $bytes', $handler);
    }

    public function testProceduralTextureRenderersReturnBytesInsteadOfPersistingFiles(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures.php');
        self::assertIsString($source);

        self::assertStringContainsString(
            'function render_planet_map_png(string $map, int $width, int $height, array $descriptor): string|false',
            $source
        );
        self::assertStringContainsString('$ok = imagepng($img, null, 6)', $source);
        self::assertStringContainsString(
            'function render_planet_map_svg(string $map, int $width, int $height, array $descriptor): string',
            $source
        );
        self::assertStringContainsString('return $svg;', $source);
        self::assertStringNotContainsString('$tmpPath', $source);
        self::assertStringNotContainsString('file_put_contents(', $source);
    }
}
