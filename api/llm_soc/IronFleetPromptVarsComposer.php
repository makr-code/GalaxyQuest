<?php

declare(strict_types=1);

/**
 * IronFleetPromptVarsComposer
 *
 * Loads the Iron Fleet base spec and a selected mini-faction spec from the
 * fractions/ directory, merges them, and returns a flat array of prompt
 * variables suitable for use with LlmPromptService::compose().
 *
 * Usage:
 *   $composer = new IronFleetPromptVarsComposer();
 *   $vars = $composer->compose('shadow');
 *   // Pass $vars as input_vars to LlmPromptService::compose($db, $profileKey, $vars)
 *
 * Supported profile keys:
 *   - iron_fleet_npc_dialogue
 *   - iron_fleet_mini_faction_briefing
 */
final class IronFleetPromptVarsComposer {
    private string $fractionsDir;

    public function __construct(?string $fractionsDir = null) {
        $this->fractionsDir = $fractionsDir
            ?? realpath(__DIR__ . '/../../fractions') ?: (__DIR__ . '/../../fractions');
    }

    /**
     * Load the Iron Fleet base spec.
     *
     * @return array<string, mixed>
     */
    public function loadBaseSpec(): array {
        return $this->loadSpec($this->fractionsDir . '/iron_fleet/spec.yaml');
    }

    /**
     * Load a mini-faction spec by code (e.g. 'shadow', 'parade', 'tech').
     *
     * @return array<string, mixed>
     */
    public function loadMiniFactionSpec(string $miniFactionCode): array {
        $code = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($miniFactionCode)));
        if ($code === '') {
            return [];
        }
        $path = $this->fractionsDir . '/iron_fleet/mini_factions/' . $code . '/spec.yaml';
        return $this->loadSpec($path);
    }

    /**
     * Compose a flat prompt-vars array from the base spec and the selected
     * mini-faction spec.  Extra keys passed via $overrides take precedence.
     *
     * @param  string               $miniFactionCode  e.g. 'shadow'
     * @param  array<string, mixed> $overrides        caller-supplied vars (e.g. situation, emotion)
     * @return array<string, string>
     */
    public function compose(string $miniFactionCode, array $overrides = []): array {
        $base  = $this->loadBaseSpec();
        $mini  = $this->loadMiniFactionSpec($miniFactionCode);

        // ── homeworld ─────────────────────────────────────────────────────────
        $homeworld = is_array($base['homeworld'] ?? null) ? $base['homeworld'] : [];
        $homeworldSystem  = (string) ($homeworld['system']  ?? 'Sonnensystem');
        $homeworldPrimary = (string) ($homeworld['primary'] ?? 'Erde');
        $planetsDe = is_array($homeworld['planets_de'] ?? null)
            ? implode(', ', $homeworld['planets_de'])
            : '';

        // ── faction-level fields ──────────────────────────────────────────────
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

        // ── base-spec NPC (first entry) ───────────────────────────────────────
        $baseNpcs  = is_array($base['important_npcs'] ?? null) ? $base['important_npcs'] : [];
        $firstBase = is_array($baseNpcs[0] ?? null) ? $baseNpcs[0] : [];
        $baseNpcName = (string) ($firstBase['name'] ?? '');
        $baseNpcRole = (string) ($firstBase['role'] ?? $firstBase['description'] ?? '');

        // ── mini-faction fields ───────────────────────────────────────────────
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

        // ── merged flat array ─────────────────────────────────────────────────
        $vars = [
            // homeworld
            'homeworld_system'        => $homeworldSystem,
            'homeworld_primary'       => $homeworldPrimary,
            'homeworld_planets_de'    => $planetsDe,
            // faction
            'faction_name'            => $factionName,
            'faction_description'     => $factionDescription,
            'faction_tier'            => $factionTier,
            'faction_tier_de'         => $factionTierDe,
            'canon_note'              => $canonNote,
            'voice_tone'              => $miniVoiceTone,
            'speech_style'            => $miniSpeechStyle,
            'typical_greeting'        => $miniGreeting,
            'faction_quotes'          => $baseQuotes,
            // mini-faction
            'mini_faction_code'       => $miniFactionCode_,
            'mini_faction_name'       => $miniFactionName,
            'mini_faction_description'=> $miniFactionDescription,
            'mini_faction_quotes'     => $miniQuotes,
            // NPC defaults (caller can override)
            'npc_name'                => $npcName,
            'npc_role'                => $npcRole,
        ];

        // Caller overrides last (e.g. situation, emotion, activity, last_contact).
        foreach ($overrides as $k => $v) {
            $vars[(string) $k] = (string) $v;
        }

        return $vars;
    }

    /**
     * Parse a YAML spec file into an array.
     *
     * Uses the php-yaml extension when available; falls back to a line-by-line
     * key: value parser for the flat fields that prompt vars need.
     *
     * @return array<string, mixed>
     */
    private function loadSpec(string $path): array {
        if (!is_file($path) || !is_readable($path)) {
            return [];
        }

        if (function_exists('yaml_parse_file')) {
            $result = yaml_parse_file($path);
            return is_array($result) ? $result : [];
        }

        return $this->parseYamlSimple($path);
    }

    /**
     * Minimal YAML parser for flat key: value and simple list fields.
     * Handles the subset of YAML used in Iron Fleet spec files.
     *
     * @return array<string, mixed>
     */
    private function parseYamlSimple(string $path): array {
        $result  = [];
        $lines   = file($path, FILE_IGNORE_NEW_LINES) ?: [];
        $current = null;   // current top-level key being built (for block scalars / lists)
        $listKey = null;   // key of the currently accumulating list
        $listVal = [];
        $blockKey   = null;  // key of the currently accumulating block scalar
        $blockLines = [];
        $blockIndent = 0;

        foreach ($lines as $line) {
            // Skip comments and fully empty lines inside block context
            $trimmed = ltrim($line);
            if ($trimmed === '' || $trimmed[0] === '#') {
                if ($blockKey !== null) {
                    $blockLines[] = '';
                }
                continue;
            }

            // Detect list item under a known key (e.g. "  - Merkur")
            if ($listKey !== null && preg_match('/^(\s+)-\s+(.*)$/', $line, $m)) {
                $listVal[] = trim($m[2], '"\'');
                continue;
            }

            // Flush pending list
            if ($listKey !== null) {
                $result[$listKey] = $listVal;
                $listKey = null;
                $listVal = [];
            }

            // Detect block scalar continuation
            if ($blockKey !== null) {
                $indent = strlen($line) - strlen(ltrim($line));
                if ($indent >= $blockIndent && $indent > 0) {
                    $blockLines[] = ltrim($line);
                    continue;
                }
                // Flush block
                $result[$blockKey] = implode("\n", $blockLines);
                $blockKey   = null;
                $blockLines = [];
                $blockIndent = 0;
            }

            // Top-level key: value
            if (preg_match('/^([a-zA-Z0-9_]+):\s*(.*)$/', $line, $m)) {
                $key = $m[1];
                $val = trim($m[2]);

                if ($val === '' || $val === '|' || $val === '>') {
                    // Start of a block scalar or mapping – look ahead via subsequent lines
                    $blockKey    = $key;
                    $blockLines  = [];
                    $blockIndent = 2; // standard 2-space indent
                    $current     = $key;
                } elseif ($val === '[]') {
                    $result[$key] = [];
                } else {
                    // Inline value – strip optional quotes
                    $result[$key] = trim($val, '"\'');
                    $current = $key;
                }
                continue;
            }

            // List under a top-level key (e.g. "  - item")
            if (preg_match('/^\s+-\s+(.*)$/', $line, $m) && $current !== null) {
                if ($listKey === null) {
                    $listKey = $current;
                    $listVal = [];
                }
                $listVal[] = trim($m[1], '"\'');
                continue;
            }

            // Nested key: value under a mapping (store as sub-array)
            if (preg_match('/^(\s+)([a-zA-Z0-9_]+):\s*(.*)$/', $line, $m) && $current !== null) {
                $subKey = $m[2];
                $subVal = trim($m[3], '"\'');
                if (!is_array($result[$current] ?? null)) {
                    $result[$current] = [];
                }
                /** @var array<string, mixed> $arr */
                $arr = $result[$current];
                $arr[$subKey] = $subVal;
                $result[$current] = $arr;
            }
        }

        // Flush any trailing list or block
        if ($listKey !== null) {
            $result[$listKey] = $listVal;
        }
        if ($blockKey !== null) {
            $result[$blockKey] = implode("\n", $blockLines);
        }

        return $result;
    }
}
