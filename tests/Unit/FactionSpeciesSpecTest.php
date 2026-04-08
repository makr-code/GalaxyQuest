<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Validates that each playable faction's spec.json contains all data
 * required by scripts/seed_faction_species.php (portraiture, logo, colours).
 *
 * These tests run against the real fractions/ directory so they catch spec
 * regressions early, without touching the database.
 */
final class FactionSpeciesSpecTest extends TestCase
{
    private const FRACTIONS_DIR = __DIR__ . '/../../fractions';

    private const REQUIRED_PORTRAITURE_KEYS = [
        'base_prompt',
        'male_modifier',
        'female_modifier',
        'material_description',
        'silhouette_description',
    ];

    private const REQUIRED_DISPLAY_COLOR_KEYS = [
        'color_male_primary',
        'color_male_secondary',
        'color_male_accent',
        'color_female_primary',
        'color_female_secondary',
        'color_female_accent',
    ];

    // ── helpers ───────────────────────────────────────────────────────────────

    /** @return list<array{string, array<string,mixed>}> */
    private static function loadPlayableSpecs(): array
    {
        $result = [];
        $dir    = realpath(self::FRACTIONS_DIR);
        if (!$dir) {
            return $result;
        }
        foreach (scandir($dir) ?: [] as $entry) {
            if ($entry[0] === '.') {
                continue;
            }
            $jsonPath = $dir . '/' . $entry . '/spec.json';
            if (!is_file($jsonPath)) {
                continue;
            }
            $spec = json_decode((string) file_get_contents($jsonPath), true);
            if (!is_array($spec)) {
                continue;
            }
            if (!isset($spec['portraiture'])) {
                continue; // not a species spec
            }
            $meta = is_array($spec['meta'] ?? null) ? $spec['meta'] : [];
            if (!($meta['playable'] ?? false)) {
                continue; // only playable species are seeded
            }
            $code    = (string) ($spec['species_code'] ?? $spec['faction_code'] ?? $entry);
            $result[] = [$code, $spec];
        }
        return $result;
    }

    // ── data provider ─────────────────────────────────────────────────────────

    /** @return array<string, array{string, array<string,mixed>}> */
    public static function playableSpecProvider(): array
    {
        $rows = self::loadPlayableSpecs();
        $out  = [];
        foreach ($rows as [$code, $spec]) {
            $out[$code] = [$code, $spec];
        }
        return $out;
    }

    // ── integration smoke-test ────────────────────────────────────────────────

    public function testAtLeastSixPlayableSpecsExist(): void
    {
        $this->assertGreaterThanOrEqual(6, count(self::loadPlayableSpecs()));
    }

    public function testExpectedPlayableFactionsPresent(): void
    {
        $codes = array_column(self::loadPlayableSpecs(), 0);
        foreach (['aereth', 'kryl_tha', 'syl_nar', 'vel_ar', 'vor_tak', 'zhareen'] as $expected) {
            $this->assertContains($expected, $codes, "Expected playable faction '{$expected}' not found");
        }
    }

    // ── per-spec structural tests ─────────────────────────────────────────────

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testPortraitureBlockExists(string $code, array $spec): void
    {
        $this->assertIsArray(
            $spec['portraiture'] ?? null,
            "{$code}: 'portraiture' block must be an object"
        );
    }

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testPortraitureRequiredKeys(string $code, array $spec): void
    {
        $portraiture = $spec['portraiture'] ?? [];
        foreach (self::REQUIRED_PORTRAITURE_KEYS as $key) {
            $this->assertArrayHasKey($key, $portraiture, "{$code}: portraiture missing '{$key}'");
            $this->assertNotEmpty($portraiture[$key], "{$code}: portraiture.{$key} must not be empty");
        }
    }

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testLogoBlockExists(string $code, array $spec): void
    {
        $logo = $spec['logo'] ?? null;
        $this->assertIsArray($logo, "{$code}: 'logo' block must be an object");
        $this->assertArrayHasKey('prompt', $logo, "{$code}: logo must have a 'prompt' key");
        $this->assertNotEmpty($logo['prompt'], "{$code}: logo.prompt must not be empty");
    }

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testDisplayColorPaletteKeys(string $code, array $spec): void
    {
        $display = is_array($spec['display'] ?? null) ? $spec['display'] : [];
        foreach (self::REQUIRED_DISPLAY_COLOR_KEYS as $key) {
            $this->assertArrayHasKey($key, $display, "{$code}: display missing '{$key}'");
            $val = (string) ($display[$key] ?? '');
            $this->assertMatchesRegularExpression(
                '/^#[0-9a-fA-F]{3,8}$/',
                $val,
                "{$code}: display.{$key} must be a valid hex colour (got '{$val}')"
            );
        }
    }

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testSpeciesCodePresent(string $code, array $spec): void
    {
        $specCode = $spec['species_code'] ?? $spec['faction_code'] ?? null;
        $this->assertNotEmpty($specCode, "{$code}: spec must have species_code or faction_code");
    }

    /**
     * @dataProvider playableSpecProvider
     * @param array<string,mixed> $spec
     */
    public function testDescriptionPresent(string $code, array $spec): void
    {
        $desc = $spec['description'] ?? null;
        $this->assertNotEmpty($desc, "{$code}: spec must have a non-empty 'description'");
    }
}
