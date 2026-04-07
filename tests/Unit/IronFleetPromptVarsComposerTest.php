<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

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
