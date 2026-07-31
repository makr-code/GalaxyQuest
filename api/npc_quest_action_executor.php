<?php

declare(strict_types=1);

/**
 * NPC Quest Action Executor
 *
 * Handles quest generation triggered by NPC decisions (from Behavior-Scripts or LLM).
 * Manages quest template selection, personalization, and user assignment.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/npc_quest_chain_manager.php';
require_once __DIR__ . '/npc_quest_trigger_log.php';

/**
 * Execute a generate_quest action from an NPC decision
 *
 * @param PDO $db
 * @param int $userId
 * @param array $faction Faction data
 * @param array $action Decision action with quest parameters
 * @return array{ok: bool, executed: bool, reason: string, quest_id?: int, error?: string}
 */
function npc_pve_apply_quest_action(PDO $db, int $userId, array $faction, array $action): array
{
    $factionId = (int) ($faction['id'] ?? 0);
    $factionName = (string) ($faction['name'] ?? 'Unknown Faction');
    $factionCode = (string) ($faction['code'] ?? '');

    // Extract quest parameters from action
    $questTemplate = (string) ($action['quest_template'] ?? '');
    $targetResource = (string) ($action['target_resource'] ?? '');
    $amount = (int) ($action['amount'] ?? 0);
    $rewardStanding = (int) ($action['reward_standing'] ?? 5);
    $durationHours = (int) ($action['duration_hours'] ?? 48);
    $chainParentCode = (string) ($action['parent_quest_code'] ?? '');

    if ($questTemplate === '') {
        return [
            'ok' => false,
            'executed' => false,
            'reason' => 'missing_quest_template',
            'error' => 'Quest action missing required "quest_template" parameter'
        ];
    }

    // Load quest template
    $templateStmt = $db->prepare('SELECT * FROM quest_templates WHERE code = ? LIMIT 1');
    $templateStmt->execute([$questTemplate]);
    $template = $templateStmt->fetch(\PDO::FETCH_ASSOC);

    if (!$template) {
        return [
            'ok' => false,
            'executed' => false,
            'reason' => 'template_not_found',
            'error' => "Quest template '{$questTemplate}' not found"
        ];
    }

    try {
        // Personalize quest from template
        $questData = npc_personalize_quest_from_template($template, [
            'faction_name' => $factionName,
            'faction_code' => $factionCode,
            'amount' => $amount ?: null,
            'resource' => $targetResource ?: null,
            'standing_delta' => $rewardStanding,
        ]);

        $questId = npc_insert_generated_quest($db, $factionId, $questData, $userId);

        // Log quest generation
        $logResult = npc_quest_trigger_log_record($db, [
            'faction_id' => $factionId,
            'user_id' => $userId,
            'quest_id' => $questId,
            'trigger_reason' => 'npc_decision',
            'trigger_context' => [
                'action_type' => 'generate_quest',
                'template' => $questTemplate,
                'llm_or_script' => 'llm',
            ],
            'chain_parent_id' => null,
            'chain_position' => 0,
        ]);

        if (!($logResult['ok'] ?? false)) {
            error_log('Quest log failed for quest ' . $questId);
        }

        // Optional: Auto-assign to user immediately
        // (Or wait for quest discovery UI)
        // npc_quest_assign_to_user($db, $userId, $questId);

        return [
            'ok' => true,
            'executed' => true,
            'reason' => 'quest_generated',
            'quest_id' => $questId,
        ];
    } catch (\Throwable $e) {
        error_log('npc_pve_apply_quest_action error: ' . $e->getMessage());
        return [
            'ok' => false,
            'executed' => false,
            'reason' => 'quest_creation_failed',
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Personalize a quest template with actual values
 *
 * @param array $template Quest template from DB
 * @param array $params Personalization parameters
 * @return array Personalized quest data
 */
function npc_personalize_quest_from_template(array $template, array $params): array
{
    $title = npc_substitute_placeholders((string) $template['title_template'], $params);
    $description = npc_substitute_placeholders((string) $template['description_template'], $params);
    $questType = (string) $template['quest_type'];

    // Parse reward template
    $rewardTemplate = json_decode((string) $template['reward_template'], true) ?? [];
    $rewards = npc_calculate_quest_rewards($rewardTemplate, $params);

    // Parse requirements template
    $requirementsTemplate = json_decode((string) $template['requirements_template'], true) ?? [];
    $requirements = npc_substitute_placeholders_json($requirementsTemplate, $params);

    return [
        'title' => $title,
        'description' => $description,
        'quest_type' => $questType,
        'requirements_json' => json_encode($requirements),
        'reward_metal' => (int) ($rewards['metal'] ?? 0),
        'reward_crystal' => (int) ($rewards['crystal'] ?? 0),
        'reward_deuterium' => (int) ($rewards['deuterium'] ?? 0),
        'reward_rare_earth' => (int) ($rewards['rare_earth'] ?? 0),
        'reward_dark_matter' => (int) ($rewards['dark_matter'] ?? 0),
        'reward_rank_points' => (int) ($rewards['rank_points'] ?? 25),
        'reward_standing' => (int) ($rewards['standing'] ?? 5),
        'min_standing' => -100,
        'difficulty' => npc_calculate_quest_difficulty($template, $params),
        'repeatable' => 0,
    ];
}

/**
 * Substitute placeholders in string
 *
 * @param string $template Template text with {placeholders}
 * @param array $params Replacement parameters
 * @return string
 */
function npc_substitute_placeholders(string $template, array $params): string
{
    foreach ($params as $key => $value) {
        $placeholder = '{' . $key . '}';
        $template = str_replace($placeholder, (string) $value, $template);
    }
    return $template;
}

/**
 * Substitute placeholders in JSON structure
 *
 * @param array $data
 * @param array $params
 * @return array
 */
function npc_substitute_placeholders_json(array $data, array $params): array
{
    $result = [];
    foreach ($data as $key => $value) {
        if (is_string($value)) {
            $result[$key] = npc_substitute_placeholders($value, $params);
        } elseif (is_array($value)) {
            $result[$key] = npc_substitute_placeholders_json($value, $params);
        } else {
            $result[$key] = $value;
        }
    }
    return $result;
}

/**
 * Calculate quest rewards from template
 *
 * @param array $rewardTemplate Template definition
 * @param array $params Personalization params
 * @return array Calculated rewards
 */
function npc_calculate_quest_rewards(array $rewardTemplate, array $params): array
{
    $rewards = [];

    foreach (['metal', 'crystal', 'deuterium', 'rare_earth', 'dark_matter', 'standing', 'rank_points'] as $resource) {
        $base = (int) ($rewardTemplate['base_' . $resource] ?? 0);
        $multiplier = (float) ($rewardTemplate['multipliers'][0] ?? 1.0);

        // Apply amount-based scaling
        if (isset($rewardTemplate['multipliers']['by_amount'])) {
            $amount = (int) ($params['amount'] ?? 0);
            $base += (int) ($amount * (float) $rewardTemplate['multipliers']['by_amount']);
        }

        $rewards[$resource] = (int) ($base * $multiplier);
    }

    return $rewards;
}

/**
 * Calculate quest difficulty rating
 *
 * @param array $template
 * @param array $params
 * @return string easy|medium|hard
 */
function npc_calculate_quest_difficulty(array $template, array $params): string
{
    $modifier = (float) ($template['difficulty_modifier'] ?? 1.0);

    if ($modifier < 0.9) {
        return 'easy';
    }
    if ($modifier > 1.15) {
        return 'hard';
    }
    return 'medium';
}

/**
 * Insert a generated quest into faction_quests
 *
 * @param PDO $db
 * @param int $factionId
 * @param array $questData Personalized quest data
 * @param int $userId User who triggered the quest
 * @return int Quest ID
 */
function npc_insert_generated_quest(PDO $db, int $factionId, array $questData, int $userId): int
{
    $code = 'generated_quest_' . $userId . '_' . time();

    $stmt = $db->prepare(
        'INSERT INTO faction_quests 
         (faction_id, code, title, description, quest_type, requirements_json,
          reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
          reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable,
          generated_by_npc, generated_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  1, NOW())'
    );

    $stmt->execute([
        $factionId,
        $code,
        $questData['title'],
        $questData['description'],
        $questData['quest_type'],
        $questData['requirements_json'],
        $questData['reward_metal'],
        $questData['reward_crystal'],
        $questData['reward_deuterium'],
        $questData['reward_rare_earth'],
        $questData['reward_dark_matter'],
        $questData['reward_rank_points'],
        $questData['reward_standing'],
        $questData['min_standing'],
        $questData['difficulty'],
        $questData['repeatable'],
    ]);

    return (int) $db->lastInsertId();
}
