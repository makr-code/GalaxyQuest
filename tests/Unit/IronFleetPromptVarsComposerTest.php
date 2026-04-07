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
}
