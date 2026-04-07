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
require_once __DIR__ . '/../../lib/MiniYamlParser.php';

/**
 * Composes a flat prompt-vars array from an Iron Fleet mini-faction YAML spec.
 *
 * Usage (internal — no public API endpoint):
 *
 *   $composer = new IronFleetPromptVarsComposer();
 *   $vars = $composer->composeVars('shadow', ['player_name' => 'Kaela']);
 *   // $vars is ready for LlmPromptService::renderTemplate() {{token}} substitution.
 *
 * Each list field is joined to a comma-separated string.
 * Nested map fields are flattened with underscore-separated keys
 * (e.g. npc.name → npc_name).
 */
final class IronFleetPromptVarsComposer
{
    private string $specDir;

    /** Fields that must be present as non-empty scalars in the YAML root. */
    private const REQUIRED_ROOT = ['mini_faction_code', 'display_name', 'mirror_of'];

    /** Required keys inside the 'npc' sub-map. */
    private const REQUIRED_NPC = ['name', 'title', 'public_face', 'private_goal'];

    /** Required keys inside the 'voice' sub-map. */
    private const REQUIRED_VOICE = ['register', 'pacing'];

    /** Required list keys inside the 'voice' sub-map. */
    private const REQUIRED_VOICE_LISTS = ['style_stack', 'taboos', 'signature_moves'];

    /** Required list keys inside the 'quotes' sub-map. */
    private const REQUIRED_QUOTES_LISTS = ['primary', 'secondary'];

    /** Required list keys inside the 'content_hooks' sub-map. */
    private const REQUIRED_HOOKS_LISTS = ['quest_archetypes', 'conflict_targets'];

    public function __construct(?string $specDir = null)
    {
        $this->specDir = $specDir
            ?? __DIR__ . '/../../fractions/iron_fleet/mini_factions';
    }

    /**
     * Load the YAML spec for $miniFactionCode, validate required fields, and
     * return a flat array of prompt variables suitable for {{token}} replacement.
     *
     * The caller-supplied $context array is merged last, so it can override any
     * derived var (e.g. to inject a player name or system-state summary).
     *
     * @param  array<string, string> $context  Extra vars to merge into the result.
     * @return array<string, string>
     * @throws \InvalidArgumentException on unknown mini-faction code
     * @throws \RuntimeException         on missing required fields or YAML parse error
     */
    public function composeVars(string $miniFactionCode, array $context = []): array
    {
        $code = strtolower(trim($miniFactionCode));
        if ($code === '') {
            throw new \InvalidArgumentException('mini_faction_code must not be empty');
        }

        $spec = $this->loadSpec($code);
        $this->validate($spec, $code);

        $vars = $this->flatten($spec);

        // Context overrides / extends derived vars.
        foreach ($context as $k => $v) {
            $vars[(string) $k] = (string) $v;
        }

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
    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * @return array<string, mixed>
     * @throws \InvalidArgumentException|\RuntimeException
     */
    private function loadSpec(string $code): array
    {
        $path = $this->specDir . '/' . $code . '.yaml';

        if (!is_file($path)) {
            throw new \InvalidArgumentException(
                "Unknown Iron Fleet mini-faction: '{$code}' (no spec at {$path})"
            );
        }

        $raw = file_get_contents($path);
        if ($raw === false) {
            throw new \RuntimeException("Cannot read spec file: {$path}");
        }

        $parser = new MiniYamlParser();
        return $parser->parse($raw);
    }

    /**
     * Validate that all required fields are present and non-empty.
     *
     * @param array<string, mixed> $spec
     * @throws \RuntimeException
     */
    private function validate(array $spec, string $code): void
    {
        // Root scalars.
        foreach (self::REQUIRED_ROOT as $field) {
            if (!isset($spec[$field]) || trim((string) $spec[$field]) === '') {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': required root field '{$field}' is missing or empty"
                );
            }
        }

        // npc sub-map.
        $npc = $spec['npc'] ?? null;
        if (!is_array($npc)) {
            throw new \RuntimeException("Mini-faction '{$code}': 'npc' block is missing");
        }
        foreach (self::REQUIRED_NPC as $field) {
            if (!isset($npc[$field]) || trim((string) $npc[$field]) === '') {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': npc.{$field} is missing or empty"
                );
            }
        }

        // voice sub-map.
        $voice = $spec['voice'] ?? null;
        if (!is_array($voice)) {
            throw new \RuntimeException("Mini-faction '{$code}': 'voice' block is missing");
        }
        foreach (self::REQUIRED_VOICE as $field) {
            if (!isset($voice[$field]) || trim((string) $voice[$field]) === '') {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': voice.{$field} is missing or empty"
                );
            }
        }
        foreach (self::REQUIRED_VOICE_LISTS as $field) {
            if (empty($voice[$field]) || !is_array($voice[$field])) {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': voice.{$field} must be a non-empty list"
                );
            }
        }

        // quotes sub-map.
        $quotes = $spec['quotes'] ?? null;
        if (!is_array($quotes)) {
            throw new \RuntimeException("Mini-faction '{$code}': 'quotes' block is missing");
        }
        foreach (self::REQUIRED_QUOTES_LISTS as $field) {
            if (empty($quotes[$field]) || !is_array($quotes[$field])) {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': quotes.{$field} must be a non-empty list"
                );
            }
        }

        // content_hooks sub-map.
        $hooks = $spec['content_hooks'] ?? null;
        if (!is_array($hooks)) {
            throw new \RuntimeException("Mini-faction '{$code}': 'content_hooks' block is missing");
        }
        foreach (self::REQUIRED_HOOKS_LISTS as $field) {
            if (empty($hooks[$field]) || !is_array($hooks[$field])) {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': content_hooks.{$field} must be a non-empty list"
                );
            }
        }
    }

    /**
     * Flatten the spec into a string→string map for {{token}} substitution.
     *
     * Naming conventions:
     *   - Root scalars:        mini_faction_code, display_name, mirror_of
     *   - Sub-map scalars:     npc_name, npc_title, voice_register, …
     *   - Lists (any level):   voice_style_stack, voice_taboos, … joined with ", "
     *   - quotes.primary list: quotes_primary  (items joined with " | ")
     *   - quotes.secondary:    quotes_secondary (items joined with " | ")
     *
     * @param  array<string, mixed> $spec
     * @return array<string, string>
     */
    private function flatten(array $spec): array
    {
        $vars = [];

        // Root scalars.
        foreach (['mini_faction_code', 'display_name', 'mirror_of'] as $key) {
            $vars[$key] = trim((string) ($spec[$key] ?? ''));
        }

        // npc sub-map.
        $npc = (array) ($spec['npc'] ?? []);
        foreach (['name', 'title', 'public_face', 'private_goal'] as $key) {
            $vars['npc_' . $key] = trim((string) ($npc[$key] ?? ''));
        }

        // voice sub-map.
        $voice = (array) ($spec['voice'] ?? []);
        foreach (['register', 'pacing'] as $key) {
            $vars['voice_' . $key] = trim((string) ($voice[$key] ?? ''));
        }
        foreach (['style_stack', 'taboos', 'signature_moves'] as $key) {
            $vars['voice_' . $key] = $this->joinList($voice[$key] ?? []);
        }

        // quotes sub-map (use " | " separator for readability in prompts).
        $quotes = (array) ($spec['quotes'] ?? []);
        foreach (['primary', 'secondary'] as $key) {
            $vars['quotes_' . $key] = $this->joinList($quotes[$key] ?? [], ' | ');
        }

        // content_hooks sub-map.
        $hooks = (array) ($spec['content_hooks'] ?? []);
        foreach (['quest_archetypes', 'conflict_targets'] as $key) {
            $vars['content_hooks_' . $key] = $this->joinList($hooks[$key] ?? []);
        }

        return $vars;
    }

    /**
     * Join a list of scalars into a single string.
     *
     * @param mixed $list
     */
    private function joinList($list, string $separator = ', '): string
    {
        if (!is_array($list)) {
            return '';
        }
        $parts = array_map(static fn($item) => trim((string) $item), $list);
        $parts = array_filter($parts, static fn(string $s) => $s !== '');
        return implode($separator, array_values($parts));
    }
}
