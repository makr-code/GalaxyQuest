<?php

declare(strict_types=1);

/**
 * IronFleetPromptVarsComposer
 *
 * Composes a flat associative array of {{token}} variables for use with
 * LlmPromptService::compose().  Tokens are derived from:
 *
 *   1. fractions/iron_fleet/spec.json   – faction-level metadata
 *   2. fractions/iron_fleet/mini_factions/*.yaml  – one per internal division
 *
 * The returned array is ready to be passed as the $inputVars argument to
 * LlmPromptService::compose() and therefore as "input_vars" in a POST to
 * /api/llm.php?action=compose (or chat_profile).
 *
 * Token naming convention:
 *   iron_fleet_<field>           top-level faction field
 *   iron_fleet_divisions         comma-separated list of all division display names
 *   iron_fleet_<code>_<field>    per-division field (code = division_code value)
 *
 * Example output keys:
 *   iron_fleet_name, iron_fleet_doctrine, iron_fleet_homeworld,
 *   iron_fleet_agenda, iron_fleet_divisions,
 *   iron_fleet_parade_name, iron_fleet_parade_role, iron_fleet_parade_officer,
 *   iron_fleet_parade_objective, iron_fleet_parade_threat, iron_fleet_parade_intel,
 *   iron_fleet_shadow_name, …
 */
final class IronFleetPromptVarsComposer
{
    private string $specJsonPath;
    private string $miniFactionDir;

    public function __construct(?string $specJsonPath = null, ?string $miniFactionDir = null)
    {
        $base                = realpath(__DIR__ . '/../../fractions/iron_fleet') ?: '';
        $this->specJsonPath  = $specJsonPath  ?? $base . '/spec.json';
        $this->miniFactionDir = $miniFactionDir ?? $base . '/mini_factions';
    }

    /**
     * Build and return the full flat token map.
     *
     * @return array<string, string>
     */
    public function compose(): array
    {
        $vars = [];

        $this->addFactionVars($vars);
        $this->addDivisionVars($vars);

        return $vars;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /** @param array<string, string> &$vars */
    private function addFactionVars(array &$vars): void
    {
        if (!is_file($this->specJsonPath)) {
            return;
        }

        $raw  = file_get_contents($this->specJsonPath);
        $spec = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($spec)) {
            return;
        }

        $vars['iron_fleet_name']      = $this->str($spec['faction_name'] ?? $spec['display_name'] ?? '');
        $vars['iron_fleet_homeworld'] = $this->str($spec['homeworld'] ?? '');
        $vars['iron_fleet_agenda']    = $this->str($spec['agenda'] ?? $spec['description'] ?? '');
        $vars['iron_fleet_status']    = $this->str($spec['status'] ?? '');
        $vars['iron_fleet_government'] = $this->str($spec['government'] ?? '');
        $vars['iron_fleet_strength']  = $this->str((string) ($spec['military']['strength'] ?? ''));
        $vars['iron_fleet_doctrine']  = $this->str($spec['military']['doctrine'] ?? '');
    }

    /** @param array<string, string> &$vars */
    private function addDivisionVars(array &$vars): void
    {
        if (!is_dir($this->miniFactionDir)) {
            return;
        }

        $parser = new MiniYamlParser();

        $divisionNames = [];
        $files         = glob($this->miniFactionDir . '/*.yaml') ?: [];
        sort($files); // deterministic order

        foreach ($files as $filePath) {
            $raw = file_get_contents($filePath);
            if ($raw === false) {
                continue;
            }

            try {
                $spec = $parser->parse($raw);
            } catch (\InvalidArgumentException $e) {
                // Skip files that use unsupported YAML features.
                continue;
            }

            if (!is_array($spec) || empty($spec)) {
                continue;
            }

            $code = $this->str($spec['division_code'] ?? basename($filePath, '.yaml'));
            $name = $this->str($spec['display_name'] ?? $code);

            $divisionNames[] = $name;

            $prefix = 'iron_fleet_' . $code . '_';

            $vars[$prefix . 'name']      = $name;
            $vars[$prefix . 'role']      = $this->str($spec['role'] ?? '');
            $vars[$prefix . 'motto']     = $this->str($spec['motto'] ?? '');
            $vars[$prefix . 'scale']     = $this->str($spec['personnel_scale'] ?? '');
            $vars[$prefix . 'threat']    = $this->str($spec['threat_level'] ?? '');
            $vars[$prefix . 'intel']     = $this->str($spec['known_intel'] ?? '');
            $vars[$prefix . 'objective'] = $this->str($spec['current_objective'] ?? '');

            // Flatten notable_officer sub-map
            $officer = $spec['notable_officer'] ?? null;
            if (is_array($officer)) {
                $vars[$prefix . 'officer'] = implode(', ', array_filter([
                    $this->str($officer['rank'] ?? ''),
                    $this->str($officer['name'] ?? ''),
                ]));
                $vars[$prefix . 'officer_specialization'] = $this->str($officer['specialization'] ?? '');
            } else {
                $vars[$prefix . 'officer']                = '';
                $vars[$prefix . 'officer_specialization'] = '';
            }
        }

        $vars['iron_fleet_divisions'] = implode(', ', $divisionNames);
        $vars['iron_fleet_division_count'] = (string) count($divisionNames);
    }

    private function str(mixed $value): string
    {
        return trim((string) ($value ?? ''));
    }
}
