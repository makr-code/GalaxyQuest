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
}
