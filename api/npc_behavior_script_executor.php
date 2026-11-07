<?php

declare(strict_types=1);

/**
 * NPC Behavior Script Executor
 * 
 * Integrates Behavior-Scripts with the LLM controller.
 * Evaluates behavior scripts and executes corresponding actions.
 * 
 * Priority Order:
 * 1. Behavior-Script (if available for faction)
 * 2. LLM Controller (fallback)
 * 3. Random action
 * 4. No action
 */

require_once __DIR__ . '/../lib/NpcBehaviorScript.php';
require_once __DIR__ . '/npc_quest_action_executor.php';

/**
 * Execute NPC behavior script for a user-faction pair
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $faction Faction code (e.g., 'iron_fleet')
 * @param array $context Runtime context (standing, resources, time, etc)
 * @return array ['ok' => bool, 'action' => ?array, 'reason' => string]
 */
function npc_execute_behavior_script(PDO $db, int $userId, string $faction, array $context = []): array
{
    // Load behavior script for this faction
    $scriptContent = npc_load_behavior_script($db, $faction);

    if (!$scriptContent) {
        return [
            'ok' => true,
            'action' => null,
            'reason' => 'no_script_available',
            'fallback' => 'llm_controller'
        ];
    }

    try {
        $script = new NpcBehaviorScript();
        $script->parse($scriptContent);

        if (!$script->evaluateConditions($context)) {
            return [
                'ok' => true,
                'action' => null,
                'reason' => 'conditions_not_met',
                'fallback' => 'llm_controller'
            ];
        }

        $action = $script->selectAction($context);

        if (!$action) {
            return [
                'ok' => true,
                'action' => null,
                'reason' => 'no_action_selected',
                'fallback' => $script->getFallback()
            ];
        }

        // Log behavior script decision
        npc_log_behavior_script_decision($db, $userId, $faction, $action, $context);

        return [
            'ok' => true,
            'action' => $action,
            'reason' => 'script_action_selected',
            'fallback' => null
        ];

    } catch (Exception $e) {
        error_log("Behavior script error for $faction: " . $e->getMessage());
        return [
            'ok' => false,
            'action' => null,
            'reason' => 'script_error',
            'error' => $e->getMessage(),
            'fallback' => 'llm_controller'
        ];
    }
}

/**
 * Load faction behavior script from database
 * 
 * @param PDO $db Database connection
 * @param string $faction Faction code
 * @return ?string YAML content or null
 */
function npc_load_behavior_script(PDO $db, string $faction): ?string
{
    // Try to load from behavior_scripts file
    $scriptPath = __DIR__ . "/../scenarios/npc_behaviors/$faction.yaml";

    if (file_exists($scriptPath)) {
        return file_get_contents($scriptPath);
    }

    // Fallback: try from database if schema exists
    try {
        $stmt = $db->prepare("
            SELECT script_yaml
            FROM npc_faction_behavior_scripts
            WHERE faction_code = ? AND active = 1
            LIMIT 1
        ");
        $stmt->execute([$faction]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? $row['script_yaml'] : null;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }

        return null;
    }
}

/**
 * Execute action from behavior script
 * 
 * Routes to appropriate handler (quest, message, raid, etc)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $faction Faction code
 * @param array $action Action from behavior script
 * @return array ['ok' => bool, 'executed' => bool, 'reason' => string, ...]
 */
function npc_execute_behavior_action(PDO $db, int $userId, string $faction, array $action): array
{
    $type = $action['type'] ?? null;

    if (!$type) {
        return ['ok' => false, 'executed' => false, 'reason' => 'invalid_action_type'];
    }

    switch ($type) {
        case 'generate_quest':
            return npc_pve_apply_quest_action($db, $userId, $faction, $action);

        case 'send_message':
            $subject = $action['subject'] ?? 'Message from NPC';
            $message = $action['message'] ?? 'No message content';
            npc_pve_send_message($db, $userId, $subject, $message);
            return ['ok' => true, 'executed' => true, 'reason' => 'message_sent'];

        case 'raid':
            // Raid logic (future implementation)
            $targetFaction = $action['target_faction'] ?? null;
            return ['ok' => false, 'executed' => false, 'reason' => 'raid_not_implemented'];

        case 'diplomacy_shift':
            // Diplomacy logic (future implementation)
            $targetFaction = $action['target_faction'] ?? null;
            return ['ok' => false, 'executed' => false, 'reason' => 'diplomacy_not_implemented'];

        case 'trade_offer':
            // Trade logic (future implementation)
            return ['ok' => false, 'executed' => false, 'reason' => 'trade_not_implemented'];

        default:
            return ['ok' => false, 'executed' => false, 'reason' => "unknown_action_type: $type"];
    }
}

/**
 * Log behavior script decision for analytics
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $faction Faction code
 * @param array $action Selected action
 * @param array $context Decision context
 * @return void
 */
function npc_log_behavior_script_decision(PDO $db, int $userId, string $faction, array $action, array $context): void
{
    try {
        // Try to use existing logging table
        $stmt = $db->prepare("
            INSERT INTO npc_llm_decision_log
            (user_id, faction, decision_type, decision_json, context_json, decision_timestamp)
            VALUES (?, ?, ?, ?, ?, NOW())
        ");

        $stmt->execute([
            $userId,
            $faction,
            'behavior_script:' . ($action['type'] ?? 'unknown'),
            json_encode($action),
            json_encode($context)
        ]);
    } catch (Exception $e) {
        // Logging table might not exist, silently fail
        error_log("Failed to log behavior script decision: " . $e->getMessage());
    }
}

/**
 * Get behavior script evaluation context for user-faction
 * 
 * Aggregates current standing, resources, time, and other factors
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $faction Faction code
 * @return array Context data
 */
function npc_get_behavior_context(PDO $db, int $userId, string $faction): array
{
    $standing = 0;
    $resources = [];

    // Get standing
    try {
        $stmt = $db->prepare("
            SELECT d.standing
            FROM diplomacy d
            JOIN npc_factions f ON f.id = d.faction_id
            WHERE d.user_id = ? AND f.code = ?
            LIMIT 1
        ");
        $stmt->execute([$userId, $faction]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $standing = $row ? (int)$row['standing'] : 0;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
    }

    // Credits belong to the user; material resources are the sum of owned colonies.
    try {
        $stmt = $db->prepare('SELECT credits FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $resources['credits'] = (int) $row['credits'];
        }
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
    }

    try {
        $stmt = $db->prepare("
            SELECT
                COALESCE(SUM(metal), 0) AS metal,
                COALESCE(SUM(crystal), 0) AS crystal,
                COALESCE(SUM(deuterium), 0) AS deuterium,
                COALESCE(SUM(rare_earth), 0) AS rare_earth
            FROM colonies
            WHERE user_id = ?
        ");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            foreach (['metal', 'crystal', 'deuterium', 'rare_earth'] as $resource) {
                $resources[$resource] = (int) $row[$resource];
            }
        }
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
    }

    return [
        'user_id' => $userId,
        'faction' => $faction,
        'standing' => $standing,
        'faction_standing' => $standing,
        'resources' => $resources,
        'current_time' => time(),
        'current_hour' => (int)date('H'),
        'current_day' => (int)date('N'), // 1=Monday, 7=Sunday
        'timestamp' => date('Y-m-d H:i:s')
    ];
}
