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

    public function testExpiredVisibilityIsProjectedWithoutUpdatingTheReadModel(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($source);

        $resolver = $this->functionBody($source, 'resolve_system_visibility');
        self::assertStringContainsString("if (\$row['expires_at'] !== null && strtotime(\$row['expires_at']) < time())", $resolver);
        self::assertStringContainsString("\$row['level'] = 'stale';", $resolver);
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
            $resolver
        );
    }

    public function testVisibilitySchemaProbeDoesNotConvertDatabaseErrorsIntoFullVisibility(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($source);

        $schemaProbe = $this->functionBody($source, 'has_player_system_visibility_table');
        self::assertStringContainsString('SHOW TABLES LIKE', $schemaProbe);
        self::assertStringNotContainsString('catch (', $schemaProbe);

        $resolver = $this->functionBody($source, 'resolve_system_visibility');
        self::assertStringContainsString('if (!has_player_system_visibility_table($db))', $resolver);
        self::assertStringContainsString("'level' => 'own'", $resolver);
    }

    public function testEmpireColorSchemaProbeDoesNotHideDatabaseFailures(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/galaxy.php');
        self::assertIsString($source);

        $schemaProbe = $this->functionBody($source, 'galaxy_users_has_empire_color');
        self::assertStringContainsString("SHOW COLUMNS FROM users LIKE 'empire_color'", $schemaProbe);
        self::assertStringNotContainsString('catch (', $schemaProbe);
    }

    public function testGalaxyGetKeepsOnlyTargetedWorldMaterializationAndExplicitVisitTracking(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/galaxy.php');
        $seedSource = file_get_contents(__DIR__ . '/../../api/galaxy_seed.php');
        self::assertIsString($source);
        self::assertIsString($seedSource);
        self::assertStringContainsString("only_method('GET');", $source);
        self::assertStringNotContainsString('ensure_galaxy_bootstrap_progress(', $source);
        self::assertStringContainsString('ensure_star_system($db, $g, $from, false)', $source);
        self::assertStringContainsString('ensure_star_system($db, $g, $to, false)', $source);
        self::assertStringContainsString('ensure_star_system($db, $g, $s);', $source);
        self::assertStringContainsString('cache_generated_system_rows(', $seedSource);
        self::assertStringContainsString('if ($seedPlanets)', $seedSource);
        self::assertStringContainsString('touch_system_visibility($db, $currentUserId, $g, $s, $visLevel, null, $snap)', $source);
        self::assertStringContainsString(
            "touch_system_visibility(\$db, \$currentUserId, \$g, \$s, 'stale', null, null)",
            $source
        );
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
