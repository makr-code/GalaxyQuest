<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/MiniYamlParser.php';
require_once __DIR__ . '/../../api/llm_soc/IronFleetPromptVarsComposer.php';
require_once __DIR__ . '/../../api/llm_soc/PromptCatalogRepository.php';

/**
 * End-to-end integration tests: IronFleetPromptVarsComposer → PromptCatalogRepository
 * → LlmPromptService::renderTemplate() via the iron_fleet_npc profile.
 *
 * These tests do NOT touch the database or call a real LLM.
 * They verify that:
 *   1. The iron_fleet_npc profile exists and is loadable from llm_profiles.json.
 *   2. The vars produced by IronFleetPromptVarsComposer (plus minimal context)
 *      satisfy all required tokens in the profile's user_template.
 *   3. After token substitution no {{…}} placeholders remain in the rendered text.
 */
final class IronFleetPromptVarsComposerIntegrationTest extends TestCase
{
    private IronFleetPromptVarsComposer $composer;
    private PromptCatalogRepository $catalog;
    private string $specDir;

    protected function setUp(): void
    {
        $this->specDir = __DIR__ . '/../../fractions/iron_fleet/mini_factions';
        $this->composer = new IronFleetPromptVarsComposer($this->specDir);
        $this->catalog  = new PromptCatalogRepository(
            __DIR__ . '/../../config/llm_profiles.json'
        );
    }

    // =========================================================================
    // Profile catalogue sanity checks
    // =========================================================================

    public function testIronFleetNpcProfileExistsInCatalogue(): void
    {
        $profiles = $this->catalog->loadFileProfiles();
        $keys = array_column($profiles, 'profile_key');
        $this->assertContains('iron_fleet_npc', $keys,
            'iron_fleet_npc profile must exist in llm_profiles.json');
    }

    public function testIronFleetNpcProfileHasNonEmptySystemPromptAndTemplate(): void
    {
        $profile = $this->findProfile('iron_fleet_npc');
        $this->assertNotSame('', trim((string) ($profile['system_prompt'] ?? '')),
            'iron_fleet_npc system_prompt must not be empty');
        $this->assertNotSame('', trim((string) ($profile['user_template'] ?? '')),
            'iron_fleet_npc user_template must not be empty');
    }

    public function testIronFleetNpcProfileTemplateContainsExpectedTokens(): void
    {
        $profile = $this->findProfile('iron_fleet_npc');
        $template = (string) $profile['user_template'];

        $expected = [
            'npc_name', 'npc_title', 'display_name', 'npc_public_face',
            'voice_style_stack', 'voice_register', 'voice_pacing',
            'voice_taboos', 'voice_signature_moves', 'quotes_primary',
            'situation', 'player_name',
        ];

        foreach ($expected as $token) {
            $this->assertStringContainsString('{{' . $token . '}}', $template,
                "Template must contain {{{$token}}}");
        }
    }

    // =========================================================================
    // Composer + template render integration
    // =========================================================================

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testComposerVarsSatisfyAllRequiredTemplateTokens(string $code): void
    {
        $context = [
            'situation'   => 'The player has just arrived at the parade staging ground.',
            'player_name' => 'Commander Yeva',
        ];
        $vars = $this->composer->composeVars($code, $context);

        $profile  = $this->findProfile('iron_fleet_npc');
        $template = (string) $profile['user_template'];

        // Extract all tokens from the template.
        preg_match_all('/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/', $template, $m);
        $requiredTokens = array_unique($m[1] ?? []);

        $schema   = $profile['input_schema_json'] ?? [];
        $required = $schema['required'] ?? [];

        $missing = [];
        foreach ($required as $token) {
            if (!isset($vars[$token]) || trim((string) $vars[$token]) === '') {
                $missing[] = $token;
            }
        }

        $this->assertEmpty($missing,
            "Faction '{$code}': missing or empty required tokens: " . implode(', ', $missing));

        // All tokens referenced in the template must be satisfiable by vars.
        $templateMissingFromVars = [];
        foreach ($requiredTokens as $token) {
            if (!array_key_exists($token, $vars)) {
                $templateMissingFromVars[] = $token;
            }
        }
        $this->assertEmpty($templateMissingFromVars,
            "Faction '{$code}': template tokens not present in vars: "
            . implode(', ', $templateMissingFromVars));
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testRenderedTemplateContainsNoUnresolvedPlaceholders(string $code): void
    {
        $context = [
            'situation'   => 'Docking clearance request.',
            'player_name' => 'Pilot Orlan',
        ];
        $vars = $this->composer->composeVars($code, $context);

        $profile  = $this->findProfile('iron_fleet_npc');
        $rendered = $this->renderTemplate((string) $profile['user_template'], $vars);

        $this->assertNotRegExp('/\{\{[^}]+\}\}/', $rendered,
            "Faction '{$code}': rendered template still contains {{…}} placeholders");
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testRenderedTemplateContainsNpcName(string $code): void
    {
        $context = [
            'situation'   => 'Interrogation scene.',
            'player_name' => 'Ensign Drey',
        ];
        $vars     = $this->composer->composeVars($code, $context);
        $profile  = $this->findProfile('iron_fleet_npc');
        $rendered = $this->renderTemplate((string) $profile['user_template'], $vars);

        $this->assertStringContainsString($vars['npc_name'], $rendered,
            "Rendered template should contain the NPC name for '{$code}'");
    }

    /**
     * @dataProvider provideMiniFactionCodes
     */
    public function testRenderedTemplateContainsPlayerName(string $code): void
    {
        $context = [
            'situation'   => 'Trade negotiation.',
            'player_name' => 'Admiral Tess',
        ];
        $vars     = $this->composer->composeVars($code, $context);
        $profile  = $this->findProfile('iron_fleet_npc');
        $rendered = $this->renderTemplate((string) $profile['user_template'], $vars);

        $this->assertStringContainsString('Admiral Tess', $rendered,
            "Rendered template should contain the player name for '{$code}'");
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

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * @return array<string, mixed>
     */
    private function findProfile(string $key): array
    {
        $profiles = $this->catalog->loadFileProfiles();
        foreach ($profiles as $p) {
            if ($p['profile_key'] === $key) {
                return $p;
            }
        }
        $this->fail("Profile '{$key}' not found in llm_profiles.json");
    }

    /**
     * Minimal {{token}} substitution — mirrors LlmPromptService::renderTemplate().
     *
     * @param array<string, string> $vars
     */
    private function renderTemplate(string $template, array $vars): string
    {
        foreach ($vars as $token => $value) {
            $template = preg_replace(
                '/\{\{\s*' . preg_quote($token, '/') . '\s*\}\}/',
                $value,
                $template
            ) ?? $template;
        }
        return $template;
    }
}
