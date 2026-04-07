<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for api/llm_soc/IronFleetPromptVarsComposer.php
 *
 * Uses temporary YAML fixture files to test the full compose() path without
 * relying on the real fractions/iron_fleet/ tree, keeping the tests hermetic.
 */
final class IronFleetPromptVarsComposerTest extends TestCase
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
require_once __DIR__ . '/../../lib/MiniYamlParser.php';
require_once __DIR__ . '/../../api/llm_soc/IronFleetPromptVarsComposer.php';

/**
 * Tests for IronFleetPromptVarsComposer and its supporting MiniYamlParser.
 */
final class IronFleetPromptVarsComposerTest extends TestCase
{
    private string $specDir;

    protected function setUp(): void
    {
        $this->specDir = __DIR__ . '/../../fractions/iron_fleet/mini_factions';
    }

    // =========================================================================
    // MiniYamlParser — unit tests
    // =========================================================================

    public function testParserHandlesSimpleScalars(): void
    {
        $yaml = <<<YAML
        key_a: hello
        key_b: "quoted value"
        key_c: 'single quoted'
        YAML;

        $result = (new MiniYamlParser())->parse($yaml);

        $this->assertSame('hello', $result['key_a']);
        $this->assertSame('quoted value', $result['key_b']);
        $this->assertSame('single quoted', $result['key_c']);
    }

    public function testParserHandlesNestedMap(): void
    {
        $yaml = <<<YAML
        npc:
          name: "Admiral Voss"
          title: Commander
        YAML;

        $result = (new MiniYamlParser())->parse($yaml);

        $this->assertIsArray($result['npc']);
        $this->assertSame('Admiral Voss', $result['npc']['name']);
        $this->assertSame('Commander', $result['npc']['title']);
    }

    public function testParserHandlesList(): void
    {
        $yaml = <<<YAML
        items:
          - alpha
          - beta
          - "gamma delta"
        YAML;

        $result = (new MiniYamlParser())->parse($yaml);

        $this->assertSame(['alpha', 'beta', 'gamma delta'], $result['items']);
    }

    public function testParserSkipsBlankLinesAndComments(): void
    {
        $yaml = <<<YAML
        # This is a comment
        key_x: value_x

        # Another comment
        key_y: value_y
        YAML;

        $result = (new MiniYamlParser())->parse($yaml);

        $this->assertSame('value_x', $result['key_x']);
        $this->assertSame('value_y', $result['key_y']);
    }

    public function testParserThrowsOnAnchor(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/anchor/i');

        (new MiniYamlParser())->parse("&anchor key: value\n");
    }

    public function testParserThrowsOnAlias(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/anchor/i');

        (new MiniYamlParser())->parse("key: *alias\n");
    }

    public function testParserThrowsOnTag(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/tag/i');

        (new MiniYamlParser())->parse("!!python/object key: val\n");
    }

    public function testParserThrowsOnFlowMapping(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/flow/i');

        (new MiniYamlParser())->parse("key: {a: 1, b: 2}\n");
    }

    public function testParserThrowsOnFlowSequence(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/flow/i');

        (new MiniYamlParser())->parse("key: [a, b, c]\n");
    }

    public function testParserThrowsOnBlockScalarPipe(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/block scalar/i');

        (new MiniYamlParser())->parse("key: |\n  multi\n  line\n");
    }

    // =========================================================================
    // IronFleetPromptVarsComposer — integration against real YAML files
    // =========================================================================

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsReturnsRequiredKeys(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code);

        $required = [
            'mini_faction_code',
            'display_name',
            'mirror_of',
            'npc_name',
            'npc_title',
            'npc_public_face',
            'npc_private_goal',
            'voice_register',
            'voice_pacing',
            'voice_style_stack',
            'voice_taboos',
            'voice_signature_moves',
            'quotes_primary',
            'quotes_secondary',
            'content_hooks_quest_archetypes',
            'content_hooks_conflict_targets',
        ];

        foreach ($required as $key) {
            $this->assertArrayHasKey($key, $vars, "Missing key '{$key}' for faction '{$code}'");
            $this->assertNotSame('', $vars[$key], "Key '{$key}' is empty for faction '{$code}'");
        }
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsCodeMatchesFilename(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code);

        $this->assertSame($code, $vars['mini_faction_code']);
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsMirrorOfIsIronFleet(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code);

        $this->assertSame('iron_fleet', $vars['mirror_of']);
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsListFieldsAreCommaJoined(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code);

        // All list vars should be non-empty strings (comma-joined).
        foreach (['voice_style_stack', 'voice_taboos', 'voice_signature_moves',
                  'content_hooks_quest_archetypes', 'content_hooks_conflict_targets'] as $key) {
            $this->assertIsString($vars[$key], "{$key} should be a string for '{$code}'");
            $this->assertNotSame('', $vars[$key], "{$key} should not be empty for '{$code}'");
        }
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsQuotesSeparatedByPipe(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code);

        // Quotes use " | " as separator — there should be at least one.
        $this->assertStringContainsString(' | ', $vars['quotes_primary'],
            "quotes_primary for '{$code}' should contain ' | ' separator");
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testContextOverridesVars(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars = $composer->composeVars($code, ['player_name' => 'Kaela', 'npc_name' => 'Override']);

        $this->assertSame('Kaela', $vars['player_name']);
        $this->assertSame('Override', $vars['npc_name']);
    }

    public function testComposeVarsThrowsOnUnknownCode(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/unknown iron fleet mini-faction/i');

        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $composer->composeVars('does_not_exist');
    }

    public function testComposeVarsThrowsOnEmptyCode(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $composer->composeVars('');
    }

    public function testComposeVarsThrowsOnMissingRequiredField(): void
    {
        $tmpDir = sys_get_temp_dir() . '/gq_test_minifactions_' . getmypid();
        @mkdir($tmpDir, 0755, true);

        // Write a spec that is missing 'mirror_of'.
        file_put_contents($tmpDir . '/broken.yaml', <<<YAML
        mini_faction_code: broken
        display_name: "Broken Faction"

        npc:
          name: "Test NPC"
          title: "Tester"
          public_face: "Unknown"
          private_goal: "Nothing"

        voice:
          style_stack:
            - neutral
          register: mid
          pacing: normal
          taboos:
            - lies
          signature_moves:
            - nothing

        quotes:
          primary:
            - "A quote."
          secondary:
            - "Another."

        content_hooks:
          quest_archetypes:
            - test_quest
          conflict_targets:
            - test_target
        YAML);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/mirror_of/');

        $composer = new IronFleetPromptVarsComposer($tmpDir);
        try {
            $composer->composeVars('broken');
        } finally {
            @unlink($tmpDir . '/broken.yaml');
            @rmdir($tmpDir);
        }
    }

    // =========================================================================
    // Data providers
    // =========================================================================

    /** @return list<array{string}> */
    public static function provideMiniFactionCodes(): array
    {
        return [
            ['parade'],
            ['pr'],
            ['tech'],
            ['clan'],
            ['archive'],
            ['shadow'],
        ];
    }
}
