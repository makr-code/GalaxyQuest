<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TerrainReadSideEffectsTest extends TestCase
{
    public function testTerrainGetIsReadOnlyAndCacheMaterializationRequiresPostAndCsrf(): void
    {
        $endpoint = file_get_contents(__DIR__ . '/../../api/terrain.php');
        $terrain = file_get_contents(__DIR__ . '/../../lib/BodyTerrain.php');
        self::assertIsString($endpoint);
        self::assertIsString($terrain);

        self::assertStringContainsString("only_method('GET', 'POST')", $endpoint);
        self::assertMatchesRegularExpression(
            "/if \\(\\\$method === 'POST'\\)\\s*\\{\\s*verify_csrf\\(\\);/",
            $endpoint
        );
        self::assertStringContainsString(
            'BodyTerrain::forColony($db, $uid, $colonyId, $method === \'POST\')',
            $endpoint
        );
        self::assertStringContainsString(
            'BodyTerrain::tiles($db, $manifest, $requested, $method === \'POST\')',
            $endpoint
        );
        self::assertStringContainsString('if (!$persist) {', $terrain);
    }
}
