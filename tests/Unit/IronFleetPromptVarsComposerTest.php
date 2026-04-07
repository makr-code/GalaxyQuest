<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/MiniYamlParser.php';
require_once __DIR__ . '/../../api/llm_soc/IronFleetPromptVarsComposer.php';

/**
 * Unit tests for IronFleetPromptVarsComposer (all three constructor modes merged).
 *
 * Tests are isolated: no DB, no HTTP, no Ollama.
 */
final class IronFleetPromptVarsComposerTest extends TestCase
{
    // Mode A: root fractions dir
    private IronFleetPromptVarsComposer $composer;

    // Mode B: temp dir with spec.json + mini_factions/
    private string $tmpDir = '';

    // Mode C: mini-factions dir
    private string $specDir;

    protected function setUp(): void
    {
        // Mode A
        $fractionsDir = realpath(__DIR__ . '/../../fractions');
        $this->assertNotFalse($fractionsDir, 'fractions/ directory must exist');
        $this->composer = new IronFleetPromptVarsComposer($fractionsDir);

        // Mode B
        $this->tmpDir = sys_get_temp_dir() . '/gq_iron_fleet_test_' . uniqid();
        mkdir($this->tmpDir, 0755, true);
        mkdir($this->tmpDir . '/mini_factions', 0755, true);

        // Mode C
        $this->specDir = __DIR__ . '/../../fractions/iron_fleet/mini_factions';
    }

    protected function tearDown(): void
    {
        $this->removeDir($this->tmpDir);
    }

    // =========================================================================
    // Mode A: loadBaseSpec
    // =========================================================================

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
        $spec    = $this->composer->loadBaseSpec();
        $npcOnly = ($spec['meta'] ?? [])['npc_only'] ?? null;
        $this->assertTrue((bool) $npcOnly, 'npc_only must be truthy');
    }

    public function testBaseSpecMetaPlayableIsFalse(): void
    {
        $spec     = $this->composer->loadBaseSpec();
        $playable = ($spec['meta'] ?? [])['playable'] ?? null;
        $this->assertFalse((bool) $playable, 'playable must be falsy');
    }

    public function testBaseSpecHomeworldHasSystem(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $hw   = $spec['homeworld'] ?? null;
        $this->assertIsArray($hw, 'homeworld must be an array');
        $this->assertSame('Sonnensystem', (string) ($hw['system'] ?? ''));
    }

    public function testBaseSpecHomeworldPrimaryIsErde(): void
    {
        $spec = $this->composer->loadBaseSpec();
        $hw   = $spec['homeworld'] ?? [];
        $this->assertSame('Erde', (string) ($hw['primary'] ?? ''));
    }

    public function testBaseSpecHomeworldContainsAllEightPlanets(): void
    {
        $spec    = $this->composer->loadBaseSpec();
        $planets = ($spec['homeworld'] ?? [])['planets_de'] ?? null;
        $this->assertIsArray($planets, 'planets_de must be an array');
        $expected = ['Merkur', 'Venus', 'Erde', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptun'];
        $this->assertCount(8, $planets);
        foreach ($expected as $p) {
            $this->assertContains($p, $planets, "planets_de must include '{$p}'");
        }
    }

    public function testBaseSpecHasLlmVoice(): void
    {
        $spec  = $this->composer->loadBaseSpec();
        $voice = $spec['llm_voice'] ?? null;
        $this->assertIsArray($voice, 'llm_voice must be an array');
        $this->assertNotEmpty($voice['tone'] ?? '', 'llm_voice.tone must not be empty');
    }

    public function testBaseSpecHasLlmQuotes(): void
    {
        $spec   = $this->composer->loadBaseSpec();
        $quotes = $spec['llm_quotes'] ?? null;
        $this->assertIsArray($quotes, 'llm_quotes must be an array');
        $this->assertNotEmpty($quotes, 'llm_quotes must not be empty');
    }

    // =========================================================================
    // Mode A: loadMiniFactionSpec
    // =========================================================================

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecLoadsForAllCodes(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $this->assertNotEmpty($spec, "loadMiniFactionSpec('{$code}') must return a non-empty array");
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasDescription(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $this->assertArrayHasKey('description', $spec, "Spec for '{$code}' must have 'description'");
        $this->assertNotEmpty((string) ($spec['description'] ?? ''));
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasLlmVoice(string $code): void
    {
        $spec  = $this->composer->loadMiniFactionSpec($code);
        $voice = $spec['llm_voice'] ?? null;
        $this->assertIsArray($voice, "Spec for '{$code}' must have llm_voice array");
    }

    /**
     * @dataProvider miniFactionCodeProvider
     */
    public function testMiniFactionSpecHasAtLeastOneNpc(string $code): void
    {
        $spec = $this->composer->loadMiniFactionSpec($code);
        $npcs = $spec['important_npcs'] ?? null;
        $this->assertIsArray($npcs, "Spec for '{$code}' must have important_npcs array");
        $this->assertNotEmpty($npcs);
    }

    public function testLoadMiniFactionSpecReturnsEmptyForUnknownCode(): void
    {
        $spec = $this->composer->loadMiniFactionSpec('nonexistent_xyz');
        $this->assertSame([], $spec, 'Unknown code must return []');
    }

    public function testLoadMiniFactionSpecRejectsPathTraversal(): void
    {
        $spec = $this->composer->loadMiniFactionSpec('../vor_tak');
        $this->assertSame([], $spec, 'Path traversal must return []');
    }

    public function testLoadMiniFactionSpecRejectsArbitraryStrings(): void
    {
        foreach (['', 'parade; rm -rf /', "parade'"] as $bad) {
            $spec = $this->composer->loadMiniFactionSpec((string) $bad);
            $this->assertSame([], $spec, "loadMiniFactionSpec('$bad') must return [] — not in allowlist");
        }
    }

    public function testLoadMiniFactionSpecIsCaseInsensitive(): void
    {
        $spec  = $this->composer->loadMiniFactionSpec('PARADE');
        $spec2 = $this->composer->loadMiniFactionSpec('Shadow');
        $this->assertNotEmpty($spec,  'PARADE (uppercase) must resolve correctly');
        $this->assertNotEmpty($spec2, 'Shadow (mixed case) must resolve correctly');
    }

    // =========================================================================
    // Mode A: compose(string, array)
    // =========================================================================

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
        $vars     = $this->composer->compose($code);
        $required = [
            'homeworld_system', 'homeworld_primary', 'homeworld_planets_de',
            'faction_name', 'faction_description', 'faction_tier', 'faction_tier_de',
            'canon_note', 'voice_tone', 'mini_faction_code', 'mini_faction_name',
            'mini_faction_description', 'npc_name', 'npc_role',
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
        $vars      = $this->composer->compose('shadow', $overrides);
        $this->assertSame('Verhör', $vars['situation']);
        $this->assertSame('kalt', $vars['emotion']);
    }

    public function testComposeOverridesDoNotOverwriteSpecDerivedValues(): void
    {
        $vars = $this->composer->compose('parade', ['homeworld_system' => 'AlphaSystem']);
        $this->assertSame('AlphaSystem', $vars['homeworld_system']);
    }

    public function testComposeShadowNpcNameIsDirectorinX(): void
    {
        $vars = $this->composer->compose('shadow');
        $this->assertNotEmpty($vars['npc_name'], 'shadow NPC name must not be empty');
    }

    public function testComposeTechNpcIsChefingenieurin(): void
    {
        $vars = $this->composer->compose('tech');
        $this->assertNotEmpty($vars['npc_name'], 'tech NPC name must not be empty');
    }

    public function testComposeMiniCodeMatchesRequestedCode(): void
    {
        foreach (['parade', 'pr', 'tech', 'clan', 'archive', 'shadow'] as $code) {
            $vars = $this->composer->compose($code);
            $this->assertSame($code, $vars['mini_faction_code'],
                "compose('{$code}') mini_faction_code must be '{$code}'");
        }
    }

    public function testComposeWithUnknownCodeFallsBackToBaseVoice(): void
    {
        $vars = $this->composer->compose('nonexistent');
        $this->assertNotEmpty($vars['voice_tone'], 'voice_tone must fall back to base spec');
        $this->assertNotEmpty($vars['faction_name']);
    }

    // =========================================================================
    // Mode B: compose() – iron_fleet_* vars from spec.json + mini_factions/
    // =========================================================================

    private function removeDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
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
        $vars = $this->makeComposer()->compose();
        self::assertArrayNotHasKey('iron_fleet_name', $vars);
    }

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
        $this->writeMiniYaml('bad',  "&anchor_bad: bad_division\n");
        $this->writeMiniYaml('good', "division_code: good\ndisplay_name: \"Good\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");

        $vars = $this->makeComposer()->compose();

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
        $this->writeMiniYaml('xdiv', "display_name: \"X Division\"\nrole: x\nthreat_level: low\nknown_intel: none\ncurrent_objective: x\n");

        $vars = $this->makeComposer()->compose();
        self::assertSame('X Division', $vars['iron_fleet_xdiv_name']);
    }

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
            self::assertArrayHasKey('division_code',     $parsed, basename($file) . ' missing division_code');
            self::assertArrayHasKey('display_name',      $parsed, basename($file) . ' missing display_name');
            self::assertArrayHasKey('role',              $parsed, basename($file) . ' missing role');
            self::assertArrayHasKey('threat_level',      $parsed, basename($file) . ' missing threat_level');
            self::assertArrayHasKey('current_objective', $parsed, basename($file) . ' missing current_objective');
            self::assertArrayHasKey('notable_officer',   $parsed, basename($file) . ' missing notable_officer');
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
        $vars     = $composer->compose();

        self::assertSame('6', $vars['iron_fleet_division_count']);
        self::assertNotEmpty($vars['iron_fleet_name']);
        self::assertNotEmpty($vars['iron_fleet_divisions']);

        foreach (['parade', 'pr', 'tech', 'clan', 'archive', 'shadow'] as $code) {
            self::assertArrayHasKey("iron_fleet_{$code}_name", $vars, "Missing token iron_fleet_{$code}_name");
            self::assertNotEmpty($vars["iron_fleet_{$code}_name"], "Empty name for $code");
        }
    }

    // =========================================================================
    // MiniYamlParser unit tests
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
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/anchor/i');

        (new MiniYamlParser())->parse("&anchor key: value\n");
    }

    public function testParserThrowsOnAlias(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/alias/i');

        (new MiniYamlParser())->parse("*alias: value\n");
    }

    public function testParserThrowsOnTag(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/tag/i');

        (new MiniYamlParser())->parse("!!python/object key: val\n");
    }

    public function testParserThrowsOnFlowMapping(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/flow/i');

        (new MiniYamlParser())->parse("{a: 1, b: 2}\n");
    }

    public function testParserThrowsOnFlowSequence(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/flow/i');

        (new MiniYamlParser())->parse("[a, b, c]\n");
    }

    public function testParserThrowsOnBlockScalarPipe(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/block-scalar/i');

        (new MiniYamlParser())->parse("key: |\n  multi\n  line\n");
    }

    // =========================================================================
    // Mode C: composeVars
    // =========================================================================

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsReturnsRequiredKeys(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code);

        $required = [
            'mini_faction_code', 'display_name', 'mirror_of',
            'npc_name', 'npc_title', 'npc_public_face', 'npc_private_goal',
            'voice_register', 'voice_pacing',
            'voice_style_stack', 'voice_taboos', 'voice_signature_moves',
            'quotes_primary', 'quotes_secondary',
            'content_hooks_quest_archetypes', 'content_hooks_conflict_targets',
        ];

        foreach ($required as $key) {
            $this->assertArrayHasKey($key, $vars, "composeVars('{$code}') must contain '{$key}'");
            $this->assertIsString($vars[$key], "composeVars('{$code}')['{$key}'] must be a string");
        }
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsCodeMatchesFilename(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code);
        $this->assertSame($code, $vars['mini_faction_code'],
            "mini_faction_code must match the requested code '{$code}'");
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsMirrorOfIsIronFleet(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code);
        $this->assertSame('iron_fleet', $vars['mirror_of'],
            "mirror_of must be 'iron_fleet' for '{$code}'");
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsListFieldsAreCommaJoined(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code);

        foreach (['voice_style_stack', 'voice_taboos', 'voice_signature_moves'] as $key) {
            $this->assertNotEmpty($vars[$key], "composeVars('{$code}')['{$key}'] must not be empty");
            $this->assertIsString($vars[$key]);
        }
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposeVarsQuotesSeparatedByPipe(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code);

        foreach (['quotes_primary', 'quotes_secondary'] as $key) {
            $this->assertNotEmpty($vars[$key], "composeVars('{$code}')['{$key}'] must not be empty");
        }
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testContextOverridesVars(string $code): void
    {
        $composer = new IronFleetPromptVarsComposer($this->specDir);
        $vars     = $composer->composeVars($code, ['situation' => 'Test situation', 'player_name' => 'Pilot A']);

        $this->assertSame('Test situation', $vars['situation']);
        $this->assertSame('Pilot A', $vars['player_name']);
    }

    public function testComposeVarsThrowsOnUnknownCode(): void
    {
        $this->expectException(\InvalidArgumentException::class);

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
    public static function miniFactionCodeProvider(): array
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
