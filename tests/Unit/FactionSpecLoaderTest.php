<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/llm_soc/FactionSpecLoader.php';

final class FactionSpecLoaderTest extends TestCase {
    private string $tmpDir;
    private FactionSpecLoader $loader;

    protected function setUp(): void {
        $this->tmpDir = sys_get_temp_dir() . '/fsl_test_' . uniqid();
        mkdir($this->tmpDir, 0755, true);
        $this->loader = new FactionSpecLoader($this->tmpDir);
    }

    protected function tearDown(): void {
        $this->removeDir($this->tmpDir);
    }

    private function removeDir(string $path): void {
        if (!is_dir($path)) {
            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $full = $path . '/' . $entry;
            is_dir($full) ? $this->removeDir($full) : unlink($full);
        }
        rmdir($path);
    }

    private function makeSpecDir(string $code): string {
        $dir = $this->tmpDir . '/' . $code;
        mkdir($dir, 0755, true);
        return $dir;
    }

    // ── loadFactionSpec ───────────────────────────────────────────────────────

    public function testLoadFactionSpecFromJson(): void {
        $dir = $this->makeSpecDir('vor_tak');
        $spec = ['species_code' => 'vor_tak', 'description' => 'Warlike reptiles', 'faction_type' => 'military'];
        file_put_contents($dir . '/spec.json', json_encode($spec));

        $result = $this->loader->loadFactionSpec('vor_tak');

        $this->assertSame('vor_tak', $result['species_code']);
        $this->assertSame('Warlike reptiles', $result['description']);
    }

    public function testLoadFactionSpecRejectsInvalidCode(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->loader->loadFactionSpec('');
    }

    public function testLoadFactionSpecRejectsCodeWithSlash(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->loader->loadFactionSpec('../../etc/passwd');
    }

    public function testLoadFactionSpecRejectsCodeWithUpperCase(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->loader->loadFactionSpec('Vor_Tak');
    }

    public function testLoadFactionSpecThrowsForMissingFaction(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/No readable spec file found/');
        $this->loader->loadFactionSpec('unknown_faction');
    }

    public function testLoadFactionSpecThrowsForInvalidJson(): void {
        $dir = $this->makeSpecDir('bad_faction');
        file_put_contents($dir . '/spec.json', '{broken json');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/Invalid JSON/');
        $this->loader->loadFactionSpec('bad_faction');
    }

    public function testLoadFactionSpecPreferJsonOverYaml(): void {
        $dir = $this->makeSpecDir('dual_faction');
        file_put_contents($dir . '/spec.json', json_encode(['source' => 'json']));
        file_put_contents($dir . '/spec.yaml', 'source: yaml');

        $result = $this->loader->loadFactionSpec('dual_faction');

        $this->assertSame('json', $result['source']);
    }

    // ── findNpcByName ─────────────────────────────────────────────────────────

    public function testFindNpcByNameReturnsNpc(): void {
        $spec = [
            'important_npcs' => [
                ['name' => 'General Drak\'Mol', 'role' => 'Commander'],
                ['name' => 'Stratega T\'Asha', 'role' => 'Diplomat'],
            ],
        ];

        $npc = $this->loader->findNpcByName($spec, 'General Drak\'Mol');

        $this->assertNotNull($npc);
        $this->assertSame('Commander', $npc['role']);
    }

    public function testFindNpcByNameIsCaseInsensitive(): void {
        $spec = [
            'important_npcs' => [
                ['name' => 'Stratega T\'Asha', 'role' => 'Diplomat'],
            ],
        ];

        $npc = $this->loader->findNpcByName($spec, 'STRATEGA T\'ASHA');

        $this->assertNotNull($npc);
        $this->assertSame('Diplomat', $npc['role']);
    }

    public function testFindNpcByNameReturnsNullForMissingNpc(): void {
        $spec = [
            'important_npcs' => [
                ['name' => 'General Drak\'Mol', 'role' => 'Commander'],
            ],
        ];

        $result = $this->loader->findNpcByName($spec, 'Unknown NPC');

        $this->assertNull($result);
    }

    public function testFindNpcByNameReturnsNullForEmptyName(): void {
        $spec = ['important_npcs' => [['name' => 'General Drak\'Mol']]];

        $this->assertNull($this->loader->findNpcByName($spec, ''));
        $this->assertNull($this->loader->findNpcByName($spec, '   '));
    }

    public function testFindNpcByNameReturnsNullWhenNpcsKeyMissing(): void {
        $this->assertNull($this->loader->findNpcByName([], 'Any NPC'));
    }

    public function testFindNpcByNameHandlesEmptyNpcsList(): void {
        $this->assertNull($this->loader->findNpcByName(['important_npcs' => []], 'Any NPC'));
    }

    // ── buildNpcSystemPrompt ──────────────────────────────────────────────────

    public function testBuildNpcSystemPromptCombinesAllParts(): void {
        $npc = ['ai_prompt' => 'Du bist General Drak\'Mol.'];
        $spec = [
            'description' => 'Warlike reptiles.',
            'society' => ['government' => 'Military Hierarchy', 'culture' => 'Honor, Discipline'],
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, $spec);

        $this->assertStringContainsString('Du bist General Drak\'Mol.', $prompt);
        $this->assertStringContainsString('Warlike reptiles.', $prompt);
        $this->assertStringContainsString('Military Hierarchy', $prompt);
        $this->assertStringContainsString('Honor, Discipline', $prompt);
    }

    public function testBuildNpcSystemPromptWithoutSociety(): void {
        $npc = ['ai_prompt' => 'You are an NPC.'];
        $spec = ['description' => 'A mysterious faction.'];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, $spec);

        $this->assertStringContainsString('You are an NPC.', $prompt);
        $this->assertStringContainsString('A mysterious faction.', $prompt);
    }

    public function testBuildNpcSystemPromptWithEmptyAiPrompt(): void {
        $npc = [];
        $spec = ['description' => 'Trade collective.', 'society' => ['culture' => 'Commerce']];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, $spec);

        $this->assertStringContainsString('Trade collective.', $prompt);
        $this->assertStringContainsString('Commerce', $prompt);
    }

    public function testBuildNpcSystemPromptReturnsEmptyStringForEmptyInputs(): void {
        $prompt = $this->loader->buildNpcSystemPrompt([], []);

        $this->assertSame('', $prompt);
    }

    // ── buildSideFactionVoicePrompt (via buildNpcSystemPrompt with no ai_prompt) ──

    public function testSideFactionNpcNameAndTitleIncluded(): void {
        $npc = [
            'name'  => "Konstrukt Sigma-VII",
            'title' => "Primärer Gleichgewichts-Enforcer",
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('Konstrukt Sigma-VII', $prompt);
        $this->assertStringContainsString("Primärer Gleichgewichts-Enforcer", $prompt);
    }

    public function testSideFactionNameOnlyWithoutTitle(): void {
        $npc = ['name' => 'Echo-Mnemonic Aethra'];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('Echo-Mnemonic Aethra', $prompt);
    }

    public function testSideFactionPublicFaceAndPrivateGoalIncluded(): void {
        $npc = [
            'name'         => 'Sigma-VII',
            'public_face'  => 'Schweigendes Wächterobjekt',
            'private_goal' => 'Alle Zivilisationen opfern',
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('Schweigendes Wächterobjekt', $prompt);
        $this->assertStringContainsString('Alle Zivilisationen opfern', $prompt);
    }

    public function testSideFactionLlmVoiceFieldsIncluded(): void {
        $npc = [
            'name'      => 'Test NPC',
            'llm_voice' => [
                'register'        => 'formell-algorithmisch',
                'pacing'          => 'langsam',
                'style_stack'     => ['archaisch', 'lapidar'],
                'taboos'          => ['Emotionen', 'Verhandlung'],
                'signature_moves' => ['Spricht in der dritten Person'],
            ],
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('formell-algorithmisch', $prompt);
        $this->assertStringContainsString('langsam', $prompt);
        $this->assertStringContainsString('archaisch', $prompt);
        $this->assertStringContainsString('Emotionen', $prompt);
        $this->assertStringContainsString('Spricht in der dritten Person', $prompt);
    }

    public function testSideFactionLlmQuotesPrimaryIncluded(): void {
        $npc = [
            'name'       => 'Test NPC',
            'llm_quotes' => [
                'primary' => ['Ungleichgewicht erkannt.', 'Ordnung ist Stille.'],
            ],
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('Ungleichgewicht erkannt.', $prompt);
        $this->assertStringContainsString('Ordnung ist Stille.', $prompt);
    }

    public function testSideFactionContextAppendedAfterVoicePrompt(): void {
        $npc  = ['name' => 'Test NPC', 'title' => "Wächter"];
        $spec = ['description' => 'Ancient guardian faction.', 'society' => ['government' => 'Algorithmic']];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, $spec);

        $this->assertStringContainsString('Test NPC', $prompt);
        $this->assertStringContainsString('Ancient guardian faction.', $prompt);
        $this->assertStringContainsString('Algorithmic', $prompt);
    }

    public function testSideFactionAiPromptTakesPrecedenceOverStructuredFields(): void {
        $npc = [
            'ai_prompt' => 'Custom system prompt.',
            'name'      => 'Should Not Appear As Header',
            'title'     => 'Also Not As Header',
        ];

        $prompt = $this->loader->buildNpcSystemPrompt($npc, []);

        $this->assertStringContainsString('Custom system prompt.', $prompt);
        // The structured name/title should NOT be duplicated as a generated header
        // since ai_prompt takes precedence over the side-faction voice builder.
        $this->assertStringNotContainsString('Du bist Should Not Appear', $prompt);
    }
}
