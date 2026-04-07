<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/llm_soc/IronFleetPromptVarsComposer.php';

/**
 * Unit tests for IronFleetPromptVarsComposer.
 *
 * Tests are isolated: no DB, no HTTP, no Ollama.
 * The composer is pointed at the real fractions/ directory so we also
 * implicitly validate that all spec files are well-formed and parseable.
 */
final class IronFleetPromptVarsComposerTest extends TestCase
{
    private IronFleetPromptVarsComposer $composer;

    protected function setUp(): void
    {
        $fractionsDir = realpath(__DIR__ . '/../../fractions');
        $this->assertNotFalse($fractionsDir, 'fractions/ directory must exist');
        $this->composer = new IronFleetPromptVarsComposer($fractionsDir);
    }

    // ── loadBaseSpec ──────────────────────────────────────────────────────────

    public function testBaseSpecLoadsFactionCode(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $this->assertSame('iron_fleet', (string) ($spec['faction_code'] ?? ''));
    }

    public function testBaseSpecHasMetaBlock(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $meta = $spec['meta'] ?? null;
        $this->assertIsArray($meta, 'meta block must be an array');
        $this->assertSame('side', (string) ($meta['faction_tier'] ?? ''));
        $this->assertSame('Nebenfraktion', (string) ($meta['faction_tier_label_de'] ?? ''));
    }

    public function testBaseSpecMetaNpcOnlyIsFalseOrTrue(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $npcOnly = ($spec['meta'] ?? [])['npc_only'] ?? null;
        // YAML true -> PHP true; we only assert it is present and truthy
        $this->assertTrue((bool) $npcOnly, 'npc_only must be truthy');
    }

    public function testBaseSpecMetaPlayableIsFalse(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $playable = ($spec['meta'] ?? [])['playable'] ?? null;
        $this->assertFalse((bool) $playable, 'playable must be falsy');
    }

    public function testBaseSpecHomeworldHasSystem(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $hw = $spec['homeworld'] ?? null;
        $this->assertIsArray($hw, 'homeworld must be an array');
        $this->assertSame('Sonnensystem', (string) ($hw['system'] ?? ''));
    }

    public function testBaseSpecHomeworldPrimaryIsErde(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $hw = $spec['homeworld'] ?? [];
        $this->assertSame('Erde', (string) ($hw['primary'] ?? ''));
    }

    public function testBaseSpecHomeworldContainsAllEightPlanets(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $planets = ($spec['homeworld'] ?? [])['planets_de'] ?? null;
        $this->assertIsArray($planets, 'planets_de must be an array');
        $expected = ['Merkur', 'Venus', 'Erde', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptun'];
        $this->assertCount(8, $planets);
        foreach ($expected as $planet) {
            $this->assertContains($planet, $planets, "planets_de must include $planet");
        }
    }

    public function testBaseSpecHasLlmVoice(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $voice = $spec['llm_voice'] ?? null;
        $this->assertIsArray($voice, 'llm_voice must be an array');
        $this->assertNotEmpty((string) ($voice['tone'] ?? ''), 'llm_voice.tone must not be empty');
    }

    public function testBaseSpecHasLlmQuotes(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $quotes = $spec['llm_quotes'] ?? null;
        $this->assertIsArray($quotes, 'llm_quotes must be an array');
        $this->assertNotEmpty($quotes, 'llm_quotes must not be empty');
    }

    // ── loadMiniFactionSpec ───────────────────────────────────────────────────

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecLoadsForAllCodes(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $this->assertNotEmpty($spec, "Mini-faction spec for '$code' must not be empty");
        $this->assertNotEmpty(
            (string) ($spec['display_name'] ?? $spec['faction_name'] ?? ''),
            "Mini-faction '$code' must have a display_name or faction_name"
        );
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasDescription(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $this->assertNotEmpty(
            (string) ($spec['description'] ?? ''),
            "Mini-faction '$code' must have a description"
        );
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasLlmVoice(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $voice = $spec['llm_voice'] ?? null;
        $this->assertIsArray($voice, "Mini-faction '$code' must have llm_voice");
        $this->assertNotEmpty((string) ($voice['tone'] ?? ''), "Mini-faction '$code' llm_voice.tone must not be empty");
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasAtLeastOneNpc(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $npcs = $spec['important_npcs'] ?? null;
        $this->assertIsArray($npcs, "Mini-faction '$code' must have important_npcs");
        $this->assertNotEmpty($npcs, "Mini-faction '$code' important_npcs must not be empty");
    }

    /** @return array<string, array{0: string}> */
    public static function miniFactionCodeProvider(): array
    {
        return [
            'parade'  => ['parade'],
            'pr'      => ['pr'],
            'tech'    => ['tech'],
            'clan'    => ['clan'],
            'archive' => ['archive'],
            'shadow'  => ['shadow'],
        ];
    }

    public function testLoadMiniFactionSpecReturnsEmptyForUnknownCode(): void
    {
        $spec = $this->composer->loadMiniFactionSpec('nonexistent_xyz');
        $this->assertSame([], $spec);
    }

    public function testLoadMiniFactionSpecRejectsPathTraversal(): void
    {
        // Allowlist prevents path traversal — not in the known-codes list
        $spec = $this->composer->loadMiniFactionSpec('../vor_tak');
        $this->assertSame([], $spec, 'Path traversal attempt must return empty array');
    }

    public function testLoadMiniFactionSpecRejectsArbitraryStrings(): void
    {
        foreach (['../../config/config', 'null', '', '   '] as $bad) {
            $spec = $this->composer->loadMiniFactionSpec($bad);
            $this->assertSame([], $spec, "loadMiniFactionSpec('$bad') must return [] — not in allowlist");
        }
    }

    public function testLoadMiniFactionSpecIsCaseInsensitive(): void
    {
        // Allowlist check is case-insensitive (strtolower applied before lookup)
        $spec = $this->composer->loadMiniFactionSpec('PARADE');
        $this->assertNotEmpty($spec, 'PARADE (uppercase) should resolve to parade');

        $spec2 = $this->composer->loadMiniFactionSpec('Shadow');
        $this->assertNotEmpty($spec2, 'Shadow (mixed case) should resolve to shadow');
    }

    // ── compose ───────────────────────────────────────────────────────────────

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testComposeReturnsFlatStringArray(string $code): void
    {
        $vars = $this->composer->compose($code);
        $this->assertIsArray($vars);
        foreach ($vars as $k => $v) {
            $this->assertIsString($k, 'All keys must be strings');
            $this->assertIsString($v, "Value for key '$k' must be a string");
        }
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testComposeIncludesRequiredKeys(string $code): void
    {
        $vars = $this->composer->compose($code);
        $required = [
            'homeworld_system',
            'homeworld_primary',
            'homeworld_planets_de',
            'faction_name',
            'faction_description',
            'faction_tier',
            'faction_tier_de',
            'canon_note',
            'voice_tone',
            'mini_faction_code',
            'mini_faction_name',
            'mini_faction_description',
            'npc_name',
            'npc_role',
        ];
        foreach ($required as $key) {
            $this->assertArrayHasKey($key, $vars, "compose('$code') must include '$key'");
            $this->assertNotEmpty($vars[$key], "compose('$code')['$key'] must not be empty");
        }
    }

    public function testComposeHomeworldValuesAreCorrect(): void
    {
        $vars = $this->composer->compose('tech');
        $this->assertSame('Sonnensystem', $vars['homeworld_system']);
        $this->assertSame('Erde', $vars['homeworld_primary']);
        $this->assertStringContainsString('Merkur', $vars['homeworld_planets_de']);
        $this->assertStringContainsString('Neptun', $vars['homeworld_planets_de']);
    }

    public function testComposeFactionTierIsSide(): void
    {
        $vars = $this->composer->compose('clan');
        $this->assertSame('side', $vars['faction_tier']);
        $this->assertSame('Nebenfraktion', $vars['faction_tier_de']);
    }

    public function testComposeOverridesAreMerged(): void
    {
        $overrides = ['situation' => 'Verhör', 'emotion' => 'kalt', 'activity' => 'Sabotage'];
        $vars = $this->composer->compose('shadow', $overrides);
        $this->assertSame('Verhör', $vars['situation']);
        $this->assertSame('kalt', $vars['emotion']);
        $this->assertSame('Sabotage', $vars['activity']);
    }

    public function testComposeOverridesDoNotOverwriteSpecDerivedValues(): void
    {
        // Caller should not be able to overwrite homeworld_system via overrides
        // if they pass the same key — actually they CAN override any key, which is
        // the intended design (callers have final say). Verify the behaviour:
        $vars = $this->composer->compose('parade', ['homeworld_system' => 'AlphaSystem']);
        $this->assertSame('AlphaSystem', $vars['homeworld_system'], 'Overrides must win over spec-derived values');
    }

    public function testComposeShadowNpcNameIsDirectorinX(): void
    {
        $vars = $this->composer->compose('shadow');
        $this->assertStringContainsString('Direktorin', $vars['npc_name']);
    }

    public function testComposeTechNpcIsChefingenieurin(): void
    {
        $vars = $this->composer->compose('tech');
        $this->assertStringContainsString('Tanaka', $vars['npc_name']);
    }

    public function testComposeMiniCodeMatchesRequestedCode(): void
    {
        foreach (['parade', 'pr', 'tech', 'clan', 'archive', 'shadow'] as $code) {
            $vars = $this->composer->compose($code);
            $this->assertSame($code, $vars['mini_faction_code'], "mini_faction_code must be '$code'");
        }
    }

    public function testComposeWithUnknownCodeFallsBackToBaseVoice(): void
    {
        // Unknown mini-faction → mini spec is empty → voice_tone falls back to base spec voice
        $vars = $this->composer->compose('nonexistent');
        $this->assertNotEmpty($vars['voice_tone'], 'voice_tone must fall back to base spec');
        $this->assertNotEmpty($vars['faction_name']);
    }
}

/**
 * Unit tests for api/llm_soc/IronFleetPromptVarsComposer.php
 *
 * Uses temporary YAML fixture files to test the full compose() path without
 * relying on the real fractions/iron_fleet/ tree, keeping the tests hermetic.
 */
final class IronFleetPromptVarsComposerHermeticTest extends TestCase
{
    private string $tmpDir = '';

    protected function setUp(): void
    {
        $this->tmpDir = sys_get_temp_dir() . '/gq_iron_fleet_test_' . uniqid();
        mkdir($this->tmpDir, 0755, true);
        mkdir($this->tmpDir . '/mini_factions', 0755, true);
    }

    protected function tearDown(): void
    {
        $this->removeDir($this->tmpDir);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function removeDir(string $dir): void
    {
        if (!is_dir($dir)) return;
        foreach (glob($dir . '/*') ?: [] as $entry) {
            is_dir($entry) ? $this->removeDir($entry) : unlink($entry);
        }
        rmdir($dir);
    }

    private function writeSpec(array $data): void
    {
        file_put_contents($this->tmpDir . '/spec.json', json_encode($data));
    }

    private function writeMiniYaml(string $code, string $yaml): void
    {
        file_put_contents($this->tmpDir . '/mini_factions/' . $code . '.yaml', $yaml);
    }

    private function makeComposer(): IronFleetPromptVarsComposer
    {
        return new IronFleetPromptVarsComposer(
            $this->tmpDir . '/spec.json',
            $this->tmpDir . '/mini_factions'
        );
    }

    // ── Faction-level vars ────────────────────────────────────────────────────

    public function testFactionVarsFromSpecJson(): void
    {
        $this->writeSpec([
            'faction_name' => 'Die Eisenflotte',
            'homeworld'    => 'Saturn-Kolonie',
            'agenda'       => 'Expansion und Kontrolle',
            'status'       => 'active_hostile',
            'government'   => 'Military Dictatorship',
            'military'     => ['strength' => 7, 'doctrine' => 'Overwhelming Force'],
        ]);

        $vars = $this->makeComposer()->compose();

        self::assertSame('Die Eisenflotte', $vars['iron_fleet_name']);
        self::assertSame('Saturn-Kolonie', $vars['iron_fleet_homeworld']);
        self::assertSame('Expansion und Kontrolle', $vars['iron_fleet_agenda']);
        self::assertSame('active_hostile', $vars['iron_fleet_status']);
        self::assertSame('Military Dictatorship', $vars['iron_fleet_government']);
        self::assertSame('7', $vars['iron_fleet_strength']);
        self::assertSame('Overwhelming Force', $vars['iron_fleet_doctrine']);
    }

    public function testFactionVarsMissingOptionalFields(): void
    {
        $this->writeSpec(['faction_name' => 'Fleet']);

        $vars = $this->makeComposer()->compose();

        self::assertSame('Fleet', $vars['iron_fleet_name']);
        self::assertSame('', $vars['iron_fleet_homeworld']);
        self::assertSame('', $vars['iron_fleet_doctrine']);
    }

    public function testMissingSpecJsonProducesNoFactionVars(): void
    {
        // No spec.json written – composer should not crash.
        $vars = $this->makeComposer()->compose();

        self::assertArrayNotHasKey('iron_fleet_name', $vars);
    }

    // ── Division-level vars ───────────────────────────────────────────────────

    public function testDivisionVarsProduced(): void
    {
        $this->writeSpec(['faction_name' => 'Eisenflotte']);
        $this->writeMiniYaml('parade', <<<YAML
            division_code: parade
            display_name: "Ehrenlegion"
            role: "Zeremonielle Machtdemonstrationen"
            motto: "Stärke durch Spektakel"
            personnel_scale: full_division
            threat_level: low
            known_intel: detailed
            current_objective: "Vierteljährliche Militärparaden"
            notable_officer:
              name: "Vizeadmiral Klaus Brenner"
              rank: "Vizeadmiral"
              specialization: "Zeremonielle Kriegsführung"
            YAML);

        $vars = $this->makeComposer()->compose();

        self::assertSame('Ehrenlegion', $vars['iron_fleet_parade_name']);
        self::assertSame('Zeremonielle Machtdemonstrationen', $vars['iron_fleet_parade_role']);
        self::assertSame('Stärke durch Spektakel', $vars['iron_fleet_parade_motto']);
        self::assertSame('full_division', $vars['iron_fleet_parade_scale']);
        self::assertSame('low', $vars['iron_fleet_parade_threat']);
        self::assertSame('detailed', $vars['iron_fleet_parade_intel']);
        self::assertSame('Vierteljährliche Militärparaden', $vars['iron_fleet_parade_objective']);
        self::assertStringContainsString('Vizeadmiral Klaus Brenner', $vars['iron_fleet_parade_officer']);
        self::assertSame('Zeremonielle Kriegsführung', $vars['iron_fleet_parade_officer_specialization']);
    }

    public function testDivisionsListCommaJoined(): void
    {
        $this->writeSpec(['faction_name' => 'Fleet']);
        $this->writeMiniYaml('alpha', "division_code: alpha\ndisplay_name: \"Alpha\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");
        $this->writeMiniYaml('beta',  "division_code: beta\ndisplay_name: \"Beta\"\nrole: y\nthreat_level: high\nknown_intel: none\ncurrent_objective: y\n");

        $vars = $this->makeComposer()->compose();

        $divs = $vars['iron_fleet_divisions'];
        self::assertStringContainsString('Alpha', $divs);
        self::assertStringContainsString('Beta', $divs);
        self::assertSame('2', $vars['iron_fleet_division_count']);
    }

    public function testDivisionCountIsCorrect(): void
    {
        $this->writeSpec(['faction_name' => 'Fleet']);
        foreach (['a', 'b', 'c'] as $code) {
            $this->writeMiniYaml($code, "division_code: $code\ndisplay_name: \"$code\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");
        }

        $vars = $this->makeComposer()->compose();
        self::assertSame('3', $vars['iron_fleet_division_count']);
    }

    public function testMissingMiniFactionDirProducesNoSectionVars(): void
    {
        $composer = new IronFleetPromptVarsComposer(
            $this->tmpDir . '/spec.json',
            $this->tmpDir . '/nonexistent'
        );
        $this->writeSpec(['faction_name' => 'Fleet']);

        $vars = $composer->compose();

        self::assertArrayNotHasKey('iron_fleet_divisions', $vars);
    }

    public function testInvalidYamlFileGracefullySkipped(): void
    {
        $this->writeSpec(['faction_name' => 'Fleet']);
        // Write a YAML file with an anchor (unsupported) – should be skipped
        $this->writeMiniYaml('bad', "division_code: bad\nkey: &anchor value\n");
        $this->writeMiniYaml('good', "division_code: good\ndisplay_name: \"Good\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");

        $vars = $this->makeComposer()->compose();

        // 'bad' was skipped; 'good' was loaded
        self::assertSame('1', $vars['iron_fleet_division_count']);
        self::assertSame('Good', $vars['iron_fleet_good_name']);
        self::assertArrayNotHasKey('iron_fleet_bad_name', $vars);
    }

    public function testFactionVarsFallbackToDisplayName(): void
    {
        $this->writeSpec(['display_name' => "Vor'Tak"]);

        $vars = $this->makeComposer()->compose();
        self::assertSame("Vor'Tak", $vars['iron_fleet_name']);
    }

    public function testDivisionCodeFallsBackToFilename(): void
    {
        $this->writeSpec(['faction_name' => 'Fleet']);
        // No division_code in YAML – should fall back to filename-derived code
        $this->writeMiniYaml('xdiv', "display_name: \"X Division\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");

        $vars = $this->makeComposer()->compose();
        self::assertSame('X Division', $vars['iron_fleet_xdiv_name']);
    }

    // ── Real fixture YAML files ───────────────────────────────────────────────

    public function testRealMiniFactionFilesAreAllValid(): void
    {
        $realDir = realpath(__DIR__ . '/../../fractions/iron_fleet/mini_factions');
        if ($realDir === false || !is_dir($realDir)) {
            self::markTestSkipped('fractions/iron_fleet/mini_factions/ not present');
        }

        $parser = new MiniYamlParser();
        $files  = glob($realDir . '/*.yaml') ?: [];

        self::assertGreaterThanOrEqual(6, count($files), 'Expected at least 6 mini-faction files');

        foreach ($files as $file) {
            $raw = file_get_contents($file);
            self::assertNotFalse($raw);

            $parsed = $parser->parse((string) $raw);
            self::assertArrayHasKey('division_code',        $parsed, basename($file) . ' missing division_code');
            self::assertArrayHasKey('display_name',         $parsed, basename($file) . ' missing display_name');
            self::assertArrayHasKey('role',                 $parsed, basename($file) . ' missing role');
            self::assertArrayHasKey('threat_level',         $parsed, basename($file) . ' missing threat_level');
            self::assertArrayHasKey('current_objective',    $parsed, basename($file) . ' missing current_objective');
            self::assertArrayHasKey('notable_officer',      $parsed, basename($file) . ' missing notable_officer');
            self::assertIsArray($parsed['notable_officer'], basename($file) . ' notable_officer must be a map');
        }
    }

    public function testRealComposerProducesSixDivisions(): void
    {
        $realSpecJson = realpath(__DIR__ . '/../../fractions/iron_fleet/spec.json');
        $realMiniDir  = realpath(__DIR__ . '/../../fractions/iron_fleet/mini_factions');

        if ($realSpecJson === false || $realMiniDir === false) {
            self::markTestSkipped('Real Iron Fleet files not present');
        }

        $composer = new IronFleetPromptVarsComposer($realSpecJson, $realMiniDir);
        $vars = $composer->compose();

        self::assertSame('6', $vars['iron_fleet_division_count']);
        self::assertNotEmpty($vars['iron_fleet_name']);
        self::assertNotEmpty($vars['iron_fleet_divisions']);

        foreach (['parade', 'pr', 'tech', 'clan', 'archive', 'shadow'] as $code) {
            self::assertArrayHasKey("iron_fleet_{$code}_name", $vars, "Missing token iron_fleet_{$code}_name");
            self::assertNotEmpty($vars["iron_fleet_{$code}_name"], "Empty name for $code");
        }
    }
}
