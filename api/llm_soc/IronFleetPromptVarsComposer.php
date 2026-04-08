<?php

declare(strict_types=1);

require_once __DIR__ . '/../../lib/MiniYamlParser.php';

/**
 * IronFleetPromptVarsComposer
 *
 * Supports three constructor modes, enabling different composer APIs:
 *
 * Mode A – root fractions directory:
 *   new IronFleetPromptVarsComposer('/path/to/fractions')
 *   Methods: loadBaseSpec(), loadMiniFactionSpec(), compose(string $code, array $overrides)
 *
 * Mode B – spec.json + mini_factions directory (two args):
 *   new IronFleetPromptVarsComposer('/path/to/spec.json', '/path/to/mini_factions')
 *   Method: compose()  →  iron_fleet_* prefixed flat vars
 *
 * Mode C – mini-factions directory with *.yaml files (default / single path to mini_factions):
 *   new IronFleetPromptVarsComposer('/path/to/fractions/iron_fleet/mini_factions')
 *   Method: composeVars(string $code, array $context)
 */
final class IronFleetPromptVarsComposer
{
    // Mode A
    private string $fractionsDir;

    // Mode B
    private string $specJsonPath;
    private string $miniFactionDir;

    // Mode C
    private string $specDir;

    /** Tracks which constructor mode was detected. */
    private string $mode;


    // Required fields for Mode C validation
    private const REQUIRED_ROOT        = ['mini_faction_code', 'display_name', 'mirror_of'];
    private const REQUIRED_NPC         = ['name', 'title', 'public_face', 'private_goal'];
    private const REQUIRED_VOICE       = ['register', 'pacing'];
    private const REQUIRED_VOICE_LISTS = ['style_stack', 'taboos', 'signature_moves'];
    private const REQUIRED_QUOTES_LISTS = ['primary', 'secondary'];
    private const REQUIRED_HOOKS_LISTS  = ['quest_archetypes', 'conflict_targets'];

    public function __construct(?string $path1 = null, ?string $path2 = null)
    {
        $defaultBase      = realpath(__DIR__ . '/../../fractions') ?: (__DIR__ . '/../../fractions');
        $defaultIronFleet = $defaultBase . '/iron_fleet';

        if ($path2 !== null) {
            // Mode B: (specJsonPath, miniFactionDir)
            $this->mode           = 'b';
            $this->specJsonPath   = $path1 ?? $defaultIronFleet . '/spec.json';
            $this->miniFactionDir = $path2;
            $this->fractionsDir   = '';
            $this->specDir        = $path2;
        } elseif ($path1 !== null && is_file($path1 . '/iron_fleet/spec.yaml')) {
            // Mode A: root fractions directory (contains iron_fleet/spec.yaml)
            $this->mode           = 'a';
            $this->fractionsDir   = $path1;
            $this->specJsonPath   = $path1 . '/iron_fleet/spec.json';
            $this->miniFactionDir = $path1 . '/iron_fleet/mini_factions';
            $this->specDir        = $path1 . '/iron_fleet/mini_factions';
        } else {
            // Mode C: mini-factions directory (*.yaml files directly) OR default
            $this->mode           = 'c';
            $this->specDir        = $path1 ?? $defaultIronFleet . '/mini_factions';
            $this->fractionsDir   = '';
            $this->specJsonPath   = '';
            $this->miniFactionDir = $this->specDir;
        }
    }

    // =========================================================================
    // Mode A: loadBaseSpec / loadMiniFactionSpec / compose(string, array)
    // =========================================================================

    /**
     * Load the Iron Fleet base spec from fractions/iron_fleet/spec.yaml.
     *
     * @return array<string, mixed>
     */
    public function loadBaseSpec(): array
    {
        return $this->loadSpecFile($this->fractionsDir . '/iron_fleet/spec.yaml');
    }

    /**
     * Load a mini-faction spec by code (e.g. 'shadow', 'parade', 'tech').
     * Accepts any code whose name consists solely of a-z, 0-9 and underscores
     * AND for which a spec.yaml file exists in the mini_factions/ directory.
     * All other inputs return [].
     *
     * @return array<string, mixed>
     */
    public function loadMiniFactionSpec(string $miniFactionCode): array
    {
        $code = strtolower(trim($miniFactionCode));
        if ($code === '' || !preg_match('/^[a-z0-9_]+$/', $code)) {
            return [];
        }
        $expectedBase = realpath($this->fractionsDir . '/iron_fleet/mini_factions');
        if ($expectedBase === false) {
            return [];
        }
        $path     = $this->fractionsDir . '/iron_fleet/mini_factions/' . $code . '/spec.yaml';
        $resolved = realpath($path);
        if ($resolved === false || !str_starts_with($resolved, $expectedBase . DIRECTORY_SEPARATOR)) {
            return [];
        }
        if (!is_file($resolved)) {
            return [];
        }
        return $this->loadSpecFile($resolved);
    }

    // =========================================================================
    // compose(): Mode A (with $miniFactionCode) OR Mode B (no args)
    // =========================================================================

    /**
     * Compose a flat prompt-vars array.
     *
     * With $miniFactionCode (Mode A): returns mini-faction-specific vars like
     *   homeworld_system, faction_name, mini_faction_code, npc_name, …
     *
     * Without $miniFactionCode (Mode B): returns iron_fleet_* prefixed vars
     *   built from spec.json + all *.yaml division files.
     *
     * @param  array<string, mixed> $overrides  Caller-supplied vars (Mode A only).
     * @return array<string, string>
     */
    public function compose(string $miniFactionCode = '', array $overrides = []): array
    {
        if ($miniFactionCode === '') {
            return $this->composeBVars();
        }
        return $this->composeAVars($miniFactionCode, $overrides);
    }

    // =========================================================================
    // Mode C: composeVars
    // =========================================================================

    /**
     * Load the YAML spec for $miniFactionCode, validate required fields, and
     * return a flat array of prompt variables suitable for {{token}} replacement.
     *
     * @param  array<string, string> $context  Extra vars merged last.
     * @return array<string, string>
     * @throws \InvalidArgumentException on unknown mini-faction code or empty code
     * @throws \RuntimeException         on missing required fields or YAML parse error
     */
    public function composeVars(string $miniFactionCode, array $context = []): array
    {
        $code = strtolower(trim($miniFactionCode));
        if ($code === '') {
            throw new \InvalidArgumentException('mini_faction_code must not be empty');
        }

        $spec = $this->loadSpecForCode($code);
        $this->validate($spec, $code);

        $vars = $this->flatten($spec);

        foreach ($context as $k => $v) {
            $vars[(string) $k] = (string) $v;
        }

        return $vars;
    }

    // =========================================================================
    // Private: Mode A helpers
    // =========================================================================

    /** @return array<string, string> */
    private function composeAVars(string $miniFactionCode, array $overrides): array
    {
        $base = $this->loadBaseSpec();
        $mini = $this->loadMiniFactionSpec($miniFactionCode);

        // homeworld
        $homeworld        = is_array($base['homeworld'] ?? null) ? $base['homeworld'] : [];
        $homeworldSystem  = (string) ($homeworld['system']  ?? 'Sonnensystem');
        $homeworldPrimary = (string) ($homeworld['primary'] ?? 'Erde');
        $planetsDe        = is_array($homeworld['planets_de'] ?? null)
            ? implode(', ', $homeworld['planets_de'])
            : '';

        // faction-level
        $factionName        = (string) ($base['faction_name']  ?? $base['display_name'] ?? 'Eisenflotte');
        $factionDescription = (string) ($base['description']   ?? '');
        $factionTier        = (string) (($base['meta'] ?? [])['faction_tier'] ?? 'side');
        $factionTierDe      = (string) (($base['meta'] ?? [])['faction_tier_label_de'] ?? 'Nebenfraktion');
        $canonNote          = (string) (($base['meta'] ?? [])['canon_note'] ?? '');

        $baseVoice   = is_array($base['llm_voice'] ?? null) ? $base['llm_voice'] : [];
        $voiceTone   = (string) ($baseVoice['tone']   ?? '');
        $speechStyle = (string) ($baseVoice['speech_style'] ?? '');
        $baseQuotes  = is_array($base['llm_quotes'] ?? null)
            ? implode(' | ', $base['llm_quotes'])
            : '';

        $baseNpcs    = is_array($base['important_npcs'] ?? null) ? $base['important_npcs'] : [];
        $firstBase   = is_array($baseNpcs[0] ?? null) ? $baseNpcs[0] : [];
        $baseNpcName = (string) ($firstBase['name'] ?? '');
        $baseNpcRole = (string) ($firstBase['role'] ?? $firstBase['description'] ?? '');

        // mini-faction
        $miniFactionName        = (string) ($mini['display_name'] ?? $mini['faction_name'] ?? $miniFactionCode);
        $miniFactionCode_       = (string) ($mini['mini_faction_code'] ?? $miniFactionCode);
        $miniFactionDescription = (string) ($mini['description'] ?? '');

        $miniVoice       = is_array($mini['llm_voice'] ?? null) ? $mini['llm_voice'] : [];
        $miniVoiceTone   = (string) ($miniVoice['tone'] ?? $voiceTone);
        $miniSpeechStyle = (string) ($miniVoice['speech_style'] ?? $speechStyle);
        $miniGreeting    = (string) ($miniVoice['typical_greeting'] ?? '');
        $miniQuotes      = is_array($mini['llm_quotes'] ?? null)
            ? implode(' | ', $mini['llm_quotes'])
            : '';

        $miniNpcs  = is_array($mini['important_npcs'] ?? null) ? $mini['important_npcs'] : [];
        $firstMini = is_array($miniNpcs[0] ?? null) ? $miniNpcs[0] : [];
        $npcName   = (string) ($firstMini['name'] ?? $baseNpcName);
        $npcRole   = (string) ($firstMini['role'] ?? $firstMini['description'] ?? $baseNpcRole);

        $vars = [
            'homeworld_system'         => $homeworldSystem,
            'homeworld_primary'        => $homeworldPrimary,
            'homeworld_planets_de'     => $planetsDe,
            'faction_name'             => $factionName,
            'faction_description'      => $factionDescription,
            'faction_tier'             => $factionTier,
            'faction_tier_de'          => $factionTierDe,
            'canon_note'               => $canonNote,
            'voice_tone'               => $miniVoiceTone,
            'speech_style'             => $miniSpeechStyle,
            'typical_greeting'         => $miniGreeting,
            'faction_quotes'           => $baseQuotes,
            'mini_faction_code'        => $miniFactionCode_,
            'mini_faction_name'        => $miniFactionName,
            'mini_faction_description' => $miniFactionDescription,
            'mini_faction_quotes'      => $miniQuotes,
            'npc_name'                 => $npcName,
            'npc_role'                 => $npcRole,
        ];

        foreach ($overrides as $k => $v) {
            $vars[(string) $k] = (string) $v;
        }

        return $vars;
    }

    /**
     * Load a spec YAML file from a full path. Falls back to the inline parser
     * when the php-yaml extension is not available.
     *
     * @return array<string, mixed>
     */
    private function loadSpecFile(string $path): array
    {
        if (!is_file($path) || !is_readable($path)) {
            return [];
        }

        if (function_exists('yaml_parse_file')) {
            $result = yaml_parse_file($path);
            return is_array($result) ? $result : [];
        }

        // Fallback without ext-yaml: prefer MiniYamlParser for nested maps/lists.
        $raw = file_get_contents($path);
        if ($raw === false) {
            return [];
        }
        try {
            return (new MiniYamlParser())->parse($raw);
        } catch (\Throwable $e) {
            // Keep legacy fallback for edge-cases MiniYamlParser intentionally rejects.
            return $this->parseYamlSimple($path);
        }
    }

    /**
     * Minimal YAML parser for the subset used in Iron Fleet spec files.
     *
     * @return array<string, mixed>
     */
    private function parseYamlSimple(string $path): array
    {
        $result      = [];
        $lines       = file($path, FILE_IGNORE_NEW_LINES) ?: [];
        $current     = null;
        $listKey     = null;
        $listVal     = [];
        $blockKey    = null;
        $blockLines  = [];
        $blockIndent = 0;

        foreach ($lines as $line) {
            $trimmed = ltrim($line);
            if ($trimmed === '' || $trimmed[0] === '#') {
                if ($blockKey !== null) {
                    $blockLines[] = '';
                }
                continue;
            }

            if ($listKey !== null && preg_match('/^(\s+)-\s+(.*)$/', $line, $m)) {
                $listVal[] = trim($m[2], '"\'');
                continue;
            }

            if ($listKey !== null) {
                $result[$listKey] = $listVal;
                $listKey          = null;
                $listVal          = [];
            }

            if ($blockKey !== null) {
                $indent = strlen($line) - strlen(ltrim($line));
                if ($indent >= $blockIndent && $indent > 0) {
                    $blockLines[] = ltrim($line);
                    continue;
                }
                $result[$blockKey] = implode("\n", $blockLines);
                $blockKey          = null;
                $blockLines        = [];
                $blockIndent       = 0;
            }

            if (preg_match('/^([a-zA-Z0-9_]+):\s*(.*)$/', $line, $m)) {
                $key = $m[1];
                $val = trim($m[2]);

                if ($val === '' || $val === '|' || $val === '>') {
                    $blockKey    = $key;
                    $blockLines  = [];
                    $blockIndent = 2;
                    $current     = $key;
                } elseif ($val === '[]') {
                    $result[$key] = [];
                } else {
                    $result[$key] = trim($val, '"\'');
                    $current      = $key;
                }
                continue;
            }

            if (preg_match('/^\s+-\s+(.*)$/', $line, $m) && $current !== null) {
                if ($listKey === null) {
                    $listKey = $current;
                    $listVal = [];
                }
                $listVal[] = trim($m[1], '"\'');
                continue;
            }

            if (preg_match('/^(\s+)([a-zA-Z0-9_]+):\s*(.*)$/', $line, $m) && $current !== null) {
                $subKey = $m[2];
                $subVal = trim($m[3], '"\'');
                if (!is_array($result[$current] ?? null)) {
                    $result[$current] = [];
                }
                /** @var array<string, mixed> $arr */
                $arr           = $result[$current];
                $arr[$subKey]  = $subVal;
                $result[$current] = $arr;
            }
        }

        if ($listKey !== null) {
            $result[$listKey] = $listVal;
        }
        if ($blockKey !== null) {
            $result[$blockKey] = implode("\n", $blockLines);
        }

        return $result;
    }

    // =========================================================================
    // Private: Mode B helpers
    // =========================================================================

    /** @return array<string, string> */
    private function composeBVars(): array
    {
        $vars = [];
        $this->addFactionVars($vars);
        $this->addDivisionVars($vars);
        return $vars;
    }

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

        $vars['iron_fleet_name']       = $this->str($spec['faction_name'] ?? $spec['display_name'] ?? '');
        $hw = $spec['homeworld'] ?? '';
        $vars['iron_fleet_homeworld']  = is_array($hw)
            ? $this->str($hw['system'] ?? $hw['primary'] ?? '')
            : $this->str($hw);
        $vars['iron_fleet_agenda']     = $this->str($spec['agenda'] ?? $spec['description'] ?? '');
        $vars['iron_fleet_status']     = $this->str($spec['status'] ?? '');
        $vars['iron_fleet_government'] = $this->str($spec['government'] ?? '');
        $vars['iron_fleet_strength']   = $this->str((string) ($spec['military']['strength'] ?? ''));
        $vars['iron_fleet_doctrine']   = $this->str($spec['military']['doctrine'] ?? '');
    }

    /** @param array<string, string> &$vars */
    private function addDivisionVars(array &$vars): void
    {
        if (!is_dir($this->miniFactionDir)) {
            return;
        }

        $parser        = new MiniYamlParser();
        $divisionNames = [];
        $files         = glob($this->miniFactionDir . '/*.yaml') ?: [];
        sort($files);

        foreach ($files as $filePath) {
            $raw = file_get_contents($filePath);
            if ($raw === false) {
                continue;
            }

            try {
                $spec = $parser->parse($raw);
            } catch (\Throwable $e) {
                continue;
            }

            if (!is_array($spec) || empty($spec)) {
                continue;
            }

            $code   = $this->str($spec['division_code'] ?? basename($filePath, '.yaml'));
            $name   = $this->str($spec['display_name'] ?? $code);
            $prefix = 'iron_fleet_' . $code . '_';

            $divisionNames[]            = $name;
            $vars[$prefix . 'name']     = $name;
            $vars[$prefix . 'role']     = $this->str($spec['role'] ?? '');
            $vars[$prefix . 'motto']    = $this->str($spec['motto'] ?? '');
            $vars[$prefix . 'scale']    = $this->str($spec['personnel_scale'] ?? '');
            $vars[$prefix . 'threat']   = $this->str($spec['threat_level'] ?? '');
            $vars[$prefix . 'intel']    = $this->str($spec['known_intel'] ?? '');
            $vars[$prefix . 'objective'] = $this->str($spec['current_objective'] ?? '');

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

        $vars['iron_fleet_divisions']      = implode(', ', $divisionNames);
        $vars['iron_fleet_division_count'] = (string) count($divisionNames);
    }

    private function str(mixed $value): string
    {
        return trim((string) ($value ?? ''));
    }

    // =========================================================================
    // Private: Mode C helpers
    // =========================================================================

    /**
     * @return array<string, mixed>
     * @throws \InvalidArgumentException|\RuntimeException
     */
    private function loadSpecForCode(string $code): array
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
     * @param array<string, mixed> $spec
     * @throws \RuntimeException
     */
    private function validate(array $spec, string $code): void
    {
        foreach (self::REQUIRED_ROOT as $field) {
            if (!isset($spec[$field]) || trim((string) $spec[$field]) === '') {
                throw new \RuntimeException(
                    "Mini-faction '{$code}': required root field '{$field}' is missing or empty"
                );
            }
        }

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
     * @param  array<string, mixed> $spec
     * @return array<string, string>
     */
    private function flatten(array $spec): array
    {
        $vars = [];

        foreach (['mini_faction_code', 'display_name', 'mirror_of'] as $key) {
            $vars[$key] = trim((string) ($spec[$key] ?? ''));
        }

        $npc = (array) ($spec['npc'] ?? []);
        foreach (['name', 'title', 'public_face', 'private_goal'] as $key) {
            $vars['npc_' . $key] = trim((string) ($npc[$key] ?? ''));
        }

        $voice = (array) ($spec['voice'] ?? []);
        foreach (['register', 'pacing'] as $key) {
            $vars['voice_' . $key] = trim((string) ($voice[$key] ?? ''));
        }
        foreach (['style_stack', 'taboos', 'signature_moves'] as $key) {
            $vars['voice_' . $key] = $this->joinList($voice[$key] ?? []);
        }

        $quotes = (array) ($spec['quotes'] ?? []);
        foreach (['primary', 'secondary'] as $key) {
            $vars['quotes_' . $key] = $this->joinList($quotes[$key] ?? [], ' | ');
        }

        $hooks = (array) ($spec['content_hooks'] ?? []);
        foreach (['quest_archetypes', 'conflict_targets'] as $key) {
            $vars['content_hooks_' . $key] = $this->joinList($hooks[$key] ?? []);
        }

        return $vars;
    }

    /** @param mixed $list */
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
