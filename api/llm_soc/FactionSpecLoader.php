<?php

declare(strict_types=1);

/**
 * Loads and queries faction spec files from fractions/{faction_code}/spec.json
 * with a fallback to spec.yaml via MiniYamlParser when available.
 */
final class FactionSpecLoader {
    private string $fractionsBasePath;

    public function __construct(?string $fractionsBasePath = null) {
        $this->fractionsBasePath = $fractionsBasePath ?? realpath(__DIR__ . '/../../fractions') ?: '';
    }

    /**
     * Loads the spec for the given faction code.
     * Tries spec.json first, then spec.yaml (if MiniYamlParser is available).
     *
     * @throws \InvalidArgumentException on invalid code or unreadable spec
     * @return array<string, mixed>
     */
    public function loadFactionSpec(string $code): array {
        $code = trim($code);
        if ($code === '' || !preg_match('/^[a-z0-9_]+$/', $code)) {
            throw new \InvalidArgumentException('Invalid faction code: ' . $code);
        }

        $jsonPath = $this->fractionsBasePath . '/' . $code . '/spec.json';
        if (is_file($jsonPath) && is_readable($jsonPath)) {
            $raw = file_get_contents($jsonPath);
            if ($raw === false) {
                throw new \InvalidArgumentException('Cannot read spec.json for faction: ' . $code);
            }
            $spec = json_decode($raw, true);
            if (!is_array($spec)) {
                throw new \InvalidArgumentException('Invalid JSON in spec.json for faction: ' . $code);
            }
            return $spec;
        }

        $yamlPath = $this->fractionsBasePath . '/' . $code . '/spec.yaml';
        if (is_file($yamlPath) && is_readable($yamlPath)) {
            $miniYamlParserPath = realpath(__DIR__ . '/../../lib/MiniYamlParser.php');
            if ($miniYamlParserPath !== false && is_file($miniYamlParserPath)) {
                require_once $miniYamlParserPath;
                if (class_exists('MiniYamlParser')) {
                    $raw = file_get_contents($yamlPath);
                    if ($raw === false) {
                        throw new \InvalidArgumentException('Cannot read spec.yaml for faction: ' . $code);
                    }
                    $spec = (new MiniYamlParser())->parse($raw);
                    if (!is_array($spec)) {
                        throw new \InvalidArgumentException('Invalid YAML in spec.yaml for faction: ' . $code);
                    }
                    return $spec;
                }
            }
        }

        throw new \InvalidArgumentException('No readable spec file found for faction: ' . $code);
    }

    /**
     * Searches important_npcs[] in the spec for an NPC with a matching name.
     * Comparison is case-insensitive.
     *
     * @param array<string, mixed> $spec
     * @return array<string, mixed>|null
     */
    public function findNpcByName(array $spec, string $npcName): ?array {
        $needle = mb_strtolower(trim($npcName));
        if ($needle === '') {
            return null;
        }

        $npcs = $spec['important_npcs'] ?? [];
        if (!is_array($npcs)) {
            return null;
        }

        foreach ($npcs as $npc) {
            if (!is_array($npc)) {
                continue;
            }
            $name = mb_strtolower(trim((string) ($npc['name'] ?? '')));
            if ($name === $needle) {
                return $npc;
            }
        }

        return null;
    }

    /**
     * Builds a complete system prompt for an NPC character chat.
     * Combines npc voice data with faction description and society context.
     *
     * Supports two NPC schemas:
     *   - Main-faction NPCs: npc.ai_prompt (long character-voice instruction string)
     *   - Side-faction NPCs: npc.title + npc.public_face + npc.private_goal + npc.llm_voice
     *
     * @param array<string, mixed> $npc
     * @param array<string, mixed> $spec
     */
    public function buildNpcSystemPrompt(array $npc, array $spec): string {
        $aiPrompt = trim((string) ($npc['ai_prompt'] ?? ''));

        // Side-faction schema: synthesise voice prompt from structured NPC fields
        if ($aiPrompt === '') {
            $aiPrompt = $this->buildSideFactionVoicePrompt($npc);
        }

        $factionDescription = trim((string) ($spec['description'] ?? ''));
        $society = $spec['society'] ?? [];
        $culture = trim((string) ($society['culture'] ?? ''));
        $government = trim((string) ($society['government'] ?? ''));

        $parts = [];

        if ($aiPrompt !== '') {
            $parts[] = $aiPrompt;
        }

        $contextLines = [];
        if ($factionDescription !== '') {
            $contextLines[] = 'Fraktion: ' . $factionDescription;
        }
        if ($government !== '') {
            $contextLines[] = 'Regierungsform: ' . $government;
        }
        if ($culture !== '') {
            $contextLines[] = 'Kultur: ' . $culture;
        }

        if (!empty($contextLines)) {
            $parts[] = implode('. ', $contextLines) . '.';
        }

        return implode("\n\n", $parts);
    }

    /**
     * Synthesises a character-voice system-prompt from the structured side-faction
     * NPC schema (title, public_face, private_goal, llm_voice, llm_quotes).
     *
     * @param  array<string, mixed> $npc
     */
    private function buildSideFactionVoicePrompt(array $npc): string {
        $name        = trim((string) ($npc['name']         ?? ''));
        $title       = trim((string) ($npc['title']        ?? ''));
        $publicFace  = trim((string) ($npc['public_face']  ?? ''));
        $privateGoal = trim((string) ($npc['private_goal'] ?? ''));
        $description = trim((string) ($npc['description']  ?? ''));

        $voice          = is_array($npc['llm_voice'] ?? null) ? $npc['llm_voice'] : [];
        $register       = trim((string) ($voice['register'] ?? ''));
        $pacing         = trim((string) ($voice['pacing']   ?? ''));
        $styleStack     = is_array($voice['style_stack']     ?? null)
            ? implode(', ', $voice['style_stack']) : '';
        $taboos         = is_array($voice['taboos']          ?? null)
            ? implode(', ', $voice['taboos']) : '';
        $signatureMoves = is_array($voice['signature_moves'] ?? null)
            ? implode('; ', $voice['signature_moves']) : '';

        $quotesBlock   = $npc['llm_quotes'] ?? [];
        $primaryQuotes = is_array($quotesBlock['primary'] ?? null)
            ? $quotesBlock['primary']
            : (is_array($quotesBlock) && !isset($quotesBlock['primary']) ? $quotesBlock : []);
        $quoteLine = !empty($primaryQuotes)
            ? 'Typische Aussagen: ' . implode(' | ', $primaryQuotes)
            : '';

        $lines = [];
        if ($name !== '' && $title !== '') {
            $lines[] = "Du bist {$name} ({$title}).";
        } elseif ($name !== '') {
            $lines[] = "Du bist {$name}.";
        }
        if ($description !== '') {
            $lines[] = $description;
        }
        if ($publicFace !== '') {
            $lines[] = "Öffentliche Rolle: {$publicFace}";
        }
        if ($privateGoal !== '') {
            $lines[] = "Geheimes Ziel: {$privateGoal}";
        }
        if ($styleStack !== '') {
            $lines[] = "Sprachstil: {$styleStack}.";
        }
        if ($register !== '') {
            $lines[] = "Register: {$register}.";
        }
        if ($pacing !== '') {
            $lines[] = "Tempo: {$pacing}.";
        }
        if ($taboos !== '') {
            $lines[] = "Sprich niemals über: {$taboos}.";
        }
        if ($signatureMoves !== '') {
            $lines[] = "Charakteristische Verhaltensweisen: {$signatureMoves}.";
        }
        if ($quoteLine !== '') {
            $lines[] = $quoteLine;
        }

        return implode("\n", $lines);
    }
}
