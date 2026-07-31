<?php

declare(strict_types=1);

/**
 * NPC Quest LLM Description Generator
 * 
 * Uses LLM to generate rich, contextual quest descriptions.
 * Results are cached for 48 hours to minimize API calls and server load.
 * 
 * Cache strategy:
 * - Key: hash(template_code + faction + player_context)
 * - TTL: 48 hours
 * - Fallback: Static template if LLM fails
 */

require_once __DIR__ . '/llm.php';
require_once __DIR__ . '/cache.php';

/**
 * Generate LLM-enhanced quest description
 * 
 * Uses caching to avoid repeated LLM calls for identical quests.
 * Fallback to static template if LLM is unavailable.
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @param array $questTemplate Quest template
 * @param array $personalizedParams Personalized quest parameters
 * @return string Quest description (LLM or static)
 */
function npc_generate_quest_description(
    PDO $db,
    int $userId,
    string $factionCode,
    array $questTemplate,
    array $personalizedParams
): string {
    // Prefer static description if available
    $staticDescription = $questTemplate['description_template'] ?? null;
    if (!$staticDescription) {
        return 'Complete this quest to earn rewards.';
    }

    // Check if LLM generation is enabled
    if (!defined('NPC_QUEST_LLM_NARRATIVES_ENABLED') || !NPC_QUEST_LLM_NARRATIVES_ENABLED) {
        // Just apply basic placeholder substitution
        return npc_substitute_placeholders($staticDescription, $personalizedParams);
    }

    // Generate cache key
    $cacheKey = npc_generate_description_cache_key($factionCode, $questTemplate, $personalizedParams);

    // Try to retrieve from cache
    try {
        $cached = cache_get($db, $cacheKey);
        if ($cached !== null) {
            return $cached;
        }
    } catch (Exception $e) {
        // Cache miss or error, continue to generation
    }

    // Try to generate via LLM
    try {
        $description = npc_generate_description_via_llm(
            $db,
            $factionCode,
            $questTemplate,
            $personalizedParams
        );

        if ($description) {
            // Cache for 48 hours
            cache_set($db, $cacheKey, $description, 48 * 3600);
            return $description;
        }
    } catch (Exception $e) {
        error_log("LLM description generation failed: " . $e->getMessage());
    }

    // Fallback to static template with placeholder substitution
    return npc_substitute_placeholders($staticDescription, $personalizedParams);
}

/**
 * Generate LLM prompt for quest description
 * 
 * @param string $factionCode Faction code
 * @param array $questTemplate Quest template
 * @param array $personalizedParams Personalized parameters
 * @return string LLM prompt
 */
function npc_generate_description_prompt(
    string $factionCode,
    array $questTemplate,
    array $personalizedParams
): string {
    $questType = $questTemplate['quest_type'] ?? 'mission';
    $templateDesc = $questTemplate['description_template'] ?? 'Complete this quest';
    $amount = $personalizedParams['amount'] ?? 'some';
    $resource = $personalizedParams['resource'] ?? 'resources';
    $factionName = ucfirst(str_replace('_', ' ', $factionCode));

    $prompt = <<<PROMPT
Generate a compelling, immersive quest description for a space game.

Faction: $factionName
Quest Type: $questType
Base Description: $templateDesc

Quest Details:
- Amount needed: $amount $resource
- Faction: $factionName

Requirements:
- Keep description to 2-3 sentences max
- Make it feel like a real, urgent mission
- Include narrative flavor
- No placeholder text; use actual values
- Professional, sci-fi tone

Generate the quest description:
PROMPT;

    return trim($prompt);
}

/**
 * Call LLM to generate description
 * 
 * @param PDO $db Database connection
 * @param string $factionCode Faction code
 * @param array $questTemplate Quest template
 * @param array $personalizedParams Personalized parameters
 * @return ?string Generated description or null
 */
function npc_generate_description_via_llm(
    PDO $db,
    string $factionCode,
    array $questTemplate,
    array $personalizedParams
): ?string {
    // Build prompt
    $prompt = npc_generate_description_prompt($factionCode, $questTemplate, $personalizedParams);

    // Call LLM (using existing llm.php infrastructure)
    try {
        $result = llm_query($db, $prompt, [
            'max_tokens' => 200,
            'temperature' => 0.7,
            'model' => 'gpt-3.5-turbo'
        ]);

        if (isset($result['content']) && !empty($result['content'])) {
            return trim($result['content']);
        }
    } catch (Exception $e) {
        error_log("LLM query failed: " . $e->getMessage());
        return null;
    }

    return null;
}

/**
 * Generate cache key for description
 * 
 * @param string $factionCode Faction code
 * @param array $questTemplate Quest template
 * @param array $personalizedParams Personalized parameters
 * @return string Cache key
 */
function npc_generate_description_cache_key(
    string $factionCode,
    array $questTemplate,
    array $personalizedParams
): string {
    // Use template code + faction + key quest params
    $templateCode = $questTemplate['code'] ?? 'unknown';
    $questType = $questTemplate['quest_type'] ?? 'unknown';

    // Include some params in cache key (but not all, to avoid cache explosion)
    $keyParams = [
        'template' => $templateCode,
        'faction' => $factionCode,
        'type' => $questType,
        'amount_range' => ($personalizedParams['amount'] ?? 0) / 100  // Bucket by 100s
    ];

    $keyString = json_encode($keyParams);
    return 'quest_desc:' . hash('sha256', $keyString);
}

/**
 * Pre-cache common quest descriptions
 * 
 * Generates and caches descriptions for common quest templates
 * to reduce on-demand LLM load.
 * 
 * @param PDO $db Database connection
 * @param array $factionCodes Faction codes to pre-cache
 * @return array Cache statistics
 */
function npc_precache_quest_descriptions(PDO $db, array $factionCodes): array
{
    $stats = ['cached' => 0, 'failed' => 0, 'skipped' => 0];

    // Load common quest templates
    $templates = [
        'resource_delivery',
        'exploration_mission',
        'combat_patrol',
        'research_collaboration'
    ];

    foreach ($factionCodes as $faction) {
        foreach ($templates as $templateCode) {
            try {
                // Load template
                $templatePath = __DIR__ . "/../scenarios/quest_templates/$templateCode.yaml";
                if (!file_exists($templatePath)) {
                    $stats['skipped']++;
                    continue;
                }

                $template = yaml_parse_file($templatePath) ?? [];
                $template['code'] = $templateCode;

                // Generate sample parameters
                $params = ['amount' => 500, 'resource' => 'metal', 'deadline_days' => 7];

                // Generate description
                $description = npc_generate_description_via_llm($db, $faction, $template, $params);

                if ($description) {
                    $cacheKey = npc_generate_description_cache_key($faction, $template, $params);
                    cache_set($db, $cacheKey, $description, 48 * 3600);
                    $stats['cached']++;
                } else {
                    $stats['failed']++;
                }
            } catch (Exception $e) {
                error_log("Failed to pre-cache description: " . $e->getMessage());
                $stats['failed']++;
            }
        }
    }

    return $stats;
}

/**
 * Check if LLM description generation is enabled
 * 
 * @return bool
 */
function npc_llm_descriptions_enabled(): bool
{
    return defined('NPC_QUEST_LLM_NARRATIVES_ENABLED') && NPC_QUEST_LLM_NARRATIVES_ENABLED;
}
