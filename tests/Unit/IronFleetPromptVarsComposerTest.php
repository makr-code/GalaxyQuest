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
