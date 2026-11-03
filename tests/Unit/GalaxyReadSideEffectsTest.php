<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GalaxyReadSideEffectsTest extends TestCase
{
    public function testGalaxyReadsDoNotRunGlobalBootstrapOrSeedFactions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/galaxy.php');
        self::assertIsString($source);

        self::assertStringNotContainsString('ensure_galaxy_bootstrap_progress(', $source);
        self::assertStringNotContainsString('ensure_pve_factions_seed(', $source);
        self::assertStringNotContainsString('ensure_diplomacy_initialized(', $source);
    }

    public function testGalaxyReadsRetainSchemaAssertionsAndTargetedLazySystemMaterialization(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/galaxy.php');
        self::assertIsString($source);

        self::assertStringContainsString('ensure_star_system_columns($db);', $source);
        self::assertStringContainsString('ensure_binary_systems_table($db);', $source);
        self::assertStringContainsString('$starSystem = ensure_star_system($db, $g, $s);', $source);
        self::assertStringContainsString('ensure_star_system($db, $g, $systemExact);', $source);
    }
}
