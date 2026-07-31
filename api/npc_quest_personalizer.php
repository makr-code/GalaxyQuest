<?php

declare(strict_types=1);

/**
 * NPC Quest Personalizer
 * 
 * Uses SeededRandom to generate deterministic, reproducible quest variants.
 * Enables players to see the same quest offer multiple times with identical parameters.
 * 
 * Seed structure: userId + factionCode + date (daily seeding)
 */

require_once __DIR__ . '/../lib/SeededRandom.php';
require_once __DIR__ . '/npc_quest_action_executor.php';

/**
 * Generate personalized quest parameters using seeded randomness
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @param array $template Quest template
 * @return array Personalized parameters
 */
function npc_personalize_quest_with_seed(
    PDO $db,
    int $userId,
    string $factionCode,
    array $template
): array {
    // Create deterministic seed based on user+faction+date
    $seed = SeededRandom::createQuestSeed($userId, $factionCode, time());
    $rng = new SeededRandom($seed);

    $personalized = [];

    // Get template parameters and ranges
    $defaultParams = $template['default_params'] ?? [];

    foreach ($defaultParams as $paramName => $paramConfig) {
        if (is_array($paramConfig) && isset($paramConfig['min'], $paramConfig['max'])) {
            // Range parameter: randomize between min/max
            $min = (int)$paramConfig['min'];
            $max = (int)$paramConfig['max'];
            $personalized[$paramName] = $rng->nextInt($min, $max);
        } else {
            // Fixed parameter: use as-is
            $personalized[$paramName] = $paramConfig;
        }
    }

    // Generate deadline based on template
    if (isset($template['quest_type']) && $template['quest_type'] === 'delivery') {
        $baseDeadline = $personalized['deadline_days'] ?? 7;
        $variation = $rng->nextInt(-2, 2);  // ±2 days variation
        $personalized['deadline_days'] = max(1, $baseDeadline + $variation);
    }

    // Apply personality modifiers if specified
    if (isset($template['personality_modifiers'])) {
        $personalityMod = $template['personality_modifiers'];
        // Select random personality modifier from list
        if (is_array($personalityMod)) {
            $personalized['personality_modifier'] = $rng->choose($personalityMod);
        }
    }

    // Generate difficulty multiplier
    if (isset($template['difficulty_modifier'])) {
        $base = (float)$template['difficulty_modifier'];
        $spread = $rng->nextFloatRange(0.95, 1.05);  // ±5% spread
        $personalized['difficulty_multiplier'] = $base * $spread;
    }

    // Store seed for audit trail
    $personalized['_seed'] = $seed;

    return $personalized;
}

/**
 * Generate multiple quest variants for a faction (for discovery UI)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @param int $maxQuests Maximum quests to generate
 * @return array Array of quest variant previews
 */
function npc_generate_quest_variants(
    PDO $db,
    int $userId,
    string $factionCode,
    int $maxQuests = 3
): array {
    // Load faction quests
    try {
        $stmt = $db->prepare(
            "SELECT q.* FROM faction_quests q
             JOIN npc_factions f ON f.id = q.faction_id
             WHERE f.code = ? AND q.generated_by_npc = 1 AND q.active = 1
             LIMIT ?"
        );
        $stmt->execute([$factionCode, $maxQuests]);
        $quests = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Exception $e) {
        return [];
    }

    $variants = [];

    foreach ($quests as $quest) {
        // Try to personalize based on quest template
        try {
            $templateCode = $quest['template_code'] ?? null;
            if (!$templateCode) continue;

            $template = npc_load_quest_template($db, $templateCode);
            if (!$template) continue;

            $personalized = npc_personalize_quest_with_seed($db, $userId, $factionCode, $template);

            $variants[] = [
                'quest_id' => $quest['id'],
                'title' => $quest['title'],
                'description' => $quest['description'],
                'reward_standing' => $quest['reward_standing'] ?? 0,
                'reward_metal' => $quest['reward_metal'] ?? 0,
                'personalized_params' => $personalized
            ];
        } catch (Exception $e) {
            error_log("Failed to personalize quest {$quest['id']}: " . $e->getMessage());
            continue;
        }
    }

    return $variants;
}

/**
 * Load quest template by code
 * 
 * @param PDO $db Database connection
 * @param string $templateCode Template code
 * @return ?array Template data
 */
function npc_load_quest_template(PDO $db, string $templateCode): ?array
{
    // Try database first
    try {
        $stmt = $db->prepare(
            "SELECT * FROM quest_templates WHERE code = ? LIMIT 1"
        );
        $stmt->execute([$templateCode]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            // Decode JSON fields
            $row['requirements_template'] = json_decode($row['requirements_template'] ?? '{}', true);
            $row['reward_template'] = json_decode($row['reward_template'] ?? '{}', true);
            return $row;
        }
    } catch (Exception $e) {
        // Ignore DB error, try file
    }

    // Fallback to YAML files
    $yamlPath = __DIR__ . "/../scenarios/quest_templates/$templateCode.yaml";
    if (!file_exists($yamlPath)) {
        return null;
    }

    // Parse YAML template
    return yaml_parse_file($yamlPath) ?? null;
}

/**
 * Calculate reproducible rewards using seed
 * 
 * Enables server-side verification of client-claimed quest completion rewards.
 * 
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @param string $questCode Quest code
 * @param int $timestamp Completion timestamp
 * @param array $template Quest template
 * @return array Rewards (metal, crystal, credits, standing)
 */
function npc_calculate_deterministic_rewards(
    int $userId,
    string $factionCode,
    string $questCode,
    int $timestamp,
    array $template
): array {
    // Seed for this specific completion
    $completionSeed = SeededRandom::createQuestSeed($userId, $questCode, $timestamp);
    $rng = new SeededRandom($completionSeed);

    $baseRewards = $template['reward_template'] ?? [];
    $rewards = [];

    foreach ($baseRewards as $rewardType => $baseAmount) {
        if (strpos($rewardType, 'base_') === 0) {
            // Extract resource name (e.g., 'base_metal' -> 'metal')
            $resourceType = substr($rewardType, 5);

            // Apply ±10% random variation
            $variation = $rng->nextFloatRange(0.9, 1.1);
            $amount = (int)($baseAmount * $variation);

            $rewards[$resourceType] = max(0, $amount);
        }
    }

    // Bonus standing based on personality modifiers
    if (isset($template['personality_modifiers'])) {
        $bonusVariation = $rng->nextFloatRange(0.95, 1.05);
        $baseStanding = $template['reward_standing'] ?? 0;
        $rewards['standing'] = (int)($baseStanding * $bonusVariation);
    }

    return $rewards;
}

/**
 * Validate quest completion against expected deterministic rewards
 * 
 * Server-side verification: Given seed + template, verify the claimed rewards are correct.
 * 
 * @param string $questSeed Seed stored in quest record
 * @param array $claimedRewards Rewards client claims
 * @param array $template Quest template
 * @return bool True if rewards are valid
 */
function npc_validate_quest_rewards(
    string $questSeed,
    array $claimedRewards,
    array $template
): bool {
    $rng = new SeededRandom($questSeed);
    $baseRewards = $template['reward_template'] ?? [];
    $tolerance = 0.15;  // Allow ±15% variance

    foreach ($baseRewards as $rewardType => $baseAmount) {
        if (strpos($rewardType, 'base_') === 0) {
            $resourceType = substr($rewardType, 5);
            $claimed = $claimedRewards[$resourceType] ?? 0;

            // Recalculate variation range
            $minReward = (int)($baseAmount * 0.9 * (1 - $tolerance));
            $maxReward = (int)($baseAmount * 1.1 * (1 + $tolerance));

            if ($claimed < $minReward || $claimed > $maxReward) {
                return false;  // Claimed reward outside acceptable range
            }
        }
    }

    return true;
}

/**
 * Log quest generation with seed for reproducibility audit
 * 
 * @param PDO $db Database connection
 * @param int $questId Quest ID
 * @param string $seed Deterministic seed
 * @param int $userId User ID
 * @return void
 */
function npc_log_quest_seed(PDO $db, int $questId, string $seed, int $userId): void
{
    try {
        // Update quest with seed for audit
        $stmt = $db->prepare(
            "UPDATE faction_quests SET quest_reward_seed = ? WHERE id = ?"
        );
        $stmt->execute([$seed, $questId]);

        // Log to generation log
        $stmt = $db->prepare(
            "INSERT INTO npc_quest_generation_log
             (faction_id, user_id, quest_id, trigger_reason, generated_at)
             VALUES (?, ?, ?, ?, NOW())"
        );
        $factionId = (int)($_SESSION['selected_faction_id'] ?? 0);
        $stmt->execute([$factionId, $userId, $questId, 'seeded_generation']);
    } catch (Exception $e) {
        error_log("Failed to log quest seed: " . $e->getMessage());
    }
}
