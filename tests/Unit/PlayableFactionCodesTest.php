<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/helpers.php';

/**
 * Tests for the get_playable_faction_codes() helper.
 *
 * All tests use a temporary directory so they are completely isolated from
 * the real fractions/ tree and from each other.
 */
final class PlayableFactionCodesTest extends TestCase
{
    private string $tmpDir = '';

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/gq_pfc_test_' . uniqid();
        mkdir($this->tmpDir, 0755, true);
    }

    protected function tearDown(): void
    {
        $this->removeDir($this->tmpDir);
    }

    private function removeDir(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }
        foreach (scandir($path) ?: [] as $e) {
            if ($e === '.' || $e === '..') {
                continue;
            }
            $full = $path . '/' . $e;
            is_dir($full) ? $this->removeDir($full) : unlink($full);
        }
        rmdir($path);
    }

    private function makeSpec(string $code, array $spec): void
    {
        $dir = $this->tmpDir . '/' . $code;
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/spec.json', json_encode($spec));
    }

    // ── basic happy-path ───────────────────────────────────────────────────────

    public function testReturnsPlayableFactions(): void
    {
        $this->makeSpec('aereth',  ['species_code' => 'aereth',  'meta' => ['playable' => true]]);
        $this->makeSpec('vor_tak', ['species_code' => 'vor_tak', 'meta' => ['playable' => true]]);

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertContains('aereth',  $codes);
        $this->assertContains('vor_tak', $codes);
        $this->assertCount(2, $codes);
    }

    public function testExcludesNonPlayableFactions(): void
    {
        $this->makeSpec('aereth',     ['species_code' => 'aereth',     'meta' => ['playable' => true]]);
        $this->makeSpec('iron_fleet', ['faction_code' => 'iron_fleet', 'meta' => ['playable' => false]]);
        $this->makeSpec('omniscienta',['faction_code' => 'omniscienta','meta' => ['playable' => false]]);

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertContains('aereth', $codes);
        $this->assertNotContains('iron_fleet',  $codes);
        $this->assertNotContains('omniscienta', $codes);
        $this->assertCount(1, $codes);
    }

    public function testExcludesSpecWithoutMetaBlock(): void
    {
        $this->makeSpec('no_meta', ['species_code' => 'no_meta']);

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertNotContains('no_meta', $codes);
    }

    // ── code resolution ────────────────────────────────────────────────────────

    public function testUsesSpeciesCodeFromSpec(): void
    {
        // Directory is called 'vor_tak_dir' but species_code says 'vor_tak'
        $dir = $this->tmpDir . '/vor_tak_dir';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/spec.json', json_encode([
            'species_code' => 'vor_tak',
            'meta'         => ['playable' => true],
        ]));

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertContains('vor_tak', $codes);
        $this->assertNotContains('vor_tak_dir', $codes);
    }

    public function testUsesFactionCodeFromSpec(): void
    {
        $dir = $this->tmpDir . '/iron_dir';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/spec.json', json_encode([
            'faction_code' => 'iron_fleet',
            'meta'         => ['playable' => true],
        ]));

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertContains('iron_fleet', $codes);
    }

    public function testFallsBackToDirNameWhenNoCode(): void
    {
        $this->makeSpec('fallback_faction', ['meta' => ['playable' => true]]);

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertContains('fallback_faction', $codes);
    }

    // ── sorting ────────────────────────────────────────────────────────────────

    public function testReturnsSortedCodes(): void
    {
        $this->makeSpec('zhareen', ['species_code' => 'zhareen', 'meta' => ['playable' => true]]);
        $this->makeSpec('aereth',  ['species_code' => 'aereth',  'meta' => ['playable' => true]]);
        $this->makeSpec('vel_ar',  ['species_code' => 'vel_ar',  'meta' => ['playable' => true]]);

        $codes = get_playable_faction_codes($this->tmpDir);

        $sorted = $codes;
        sort($sorted);
        $this->assertSame($sorted, $codes);
    }

    // ── edge-cases ─────────────────────────────────────────────────────────────

    public function testEmptyDirectoryReturnsEmptyArray(): void
    {
        $codes = get_playable_faction_codes($this->tmpDir);
        $this->assertSame([], $codes);
    }

    public function testNonExistentDirectoryReturnsEmptyArray(): void
    {
        $codes = get_playable_faction_codes('/tmp/__nonexistent_dir_xyz__');
        $this->assertSame([], $codes);
    }

    public function testSkipsDirectoriesWithoutSpecJson(): void
    {
        mkdir($this->tmpDir . '/no_spec', 0755, true);
        file_put_contents($this->tmpDir . '/no_spec/readme.txt', 'nothing here');

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertSame([], $codes);
    }

    public function testSkipsInvalidJsonFiles(): void
    {
        $dir = $this->tmpDir . '/bad_json';
        mkdir($dir, 0755, true);
        file_put_contents($dir . '/spec.json', '{broken json');

        $codes = get_playable_faction_codes($this->tmpDir);

        $this->assertSame([], $codes);
    }

    // ── real fractions/ integration smoke-test ────────────────────────────────

    public function testRealFractionsContainExpectedPlayableFactions(): void
    {
        $codes = get_playable_faction_codes();

        $expected = ['aereth', 'kryl_tha', 'syl_nar', 'vel_ar', 'vor_tak', 'zhareen'];
        foreach ($expected as $faction) {
            $this->assertContains($faction, $codes, "Expected '{$faction}' to be playable");
        }
    }

    public function testRealFractionsExcludesSideFactions(): void
    {
        $codes = get_playable_faction_codes();

        foreach (['iron_fleet', 'omniscienta', 'aethernox'] as $side) {
            $this->assertNotContains($side, $codes, "Side faction '{$side}' must not be playable");
        }
    }
}
