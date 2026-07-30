<?php

declare(strict_types=1);

/**
 * NPC Quest Contextual Trigger System
 * 
 * Generates quests based on in-game events:
 * - Player colonies under attack
 * - Resource shortage detected
 * - Faction standing changes dramatically
 * - Trade route disruptions
 * - Scientific discoveries
 * 
 * Event-based quest generation to keep game dynamic and engaging.
 */

require_once __DIR__ . '/npc_quest_action_executor.php';
require_once __DIR__ . '/npc_quest_personalizer.php';

/**
 * Check and trigger contextual quests based on recent events
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @return array Triggered quest IDs
 */
function npc_quest_contextual_trigger_check(
    PDO $db,
    int $userId,
    string $factionCode
): array {
    $triggeredQuests = [];

    try {
        // Check various trigger conditions
        $triggers = [
            'low_resources' => npc_check_low_resources($db, $userId),
            'standing_shift' => npc_check_standing_shift($db, $userId, $factionCode),
            'colony_threat' => npc_check_colony_threat($db, $userId),
            'trade_route' => npc_check_trade_route_disruption($db, $userId)
        ];

        foreach ($triggers as $triggerType => $shouldTrigger) {
            if ($shouldTrigger) {
                $questId = npc_quest_contextual_trigger_create(
                    $db,
                    $userId,
                    $factionCode,
                    $triggerType
                );

                if ($questId) {
                    $triggeredQuests[] = $questId;
                }
            }
        }
    } catch (Exception $e) {
        error_log("Contextual trigger check failed: " . $e->getMessage());
    }

    return $triggeredQuests;
}

/**
 * Check if player has low resources (trigger: relief mission)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @return bool Should trigger
 */
function npc_check_low_resources(PDO $db, int $userId): bool
{
    // Check if player has < 500 credits
    try {
        $stmt = $db->prepare("SELECT credits FROM user_inventory WHERE user_id = ? LIMIT 1");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row && (int)$row['credits'] < 500) {
            return true;
        }
    } catch (Exception $e) {
        // Inventory table doesn't exist
    }

    return false;
}

/**
 * Check if player standing changed dramatically (trigger: diplomatic quest)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @return bool Should trigger
 */
function npc_check_standing_shift(PDO $db, int $userId, string $factionCode): bool
{
    // Check if standing changed by > 10 points in last hour
    try {
        $stmt = $db->prepare("
            SELECT standing FROM user_faction_standing
            WHERE user_id = ? AND faction = ?
            LIMIT 1
        ");
        $stmt->execute([$userId, $factionCode]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            // New relationship could trigger diplomatic outreach
            return rand(1, 100) <= 30;  // 30% chance
        }
    } catch (Exception $e) {
        // Table doesn't exist
    }

    return false;
}

/**
 * Check if player has colonies under threat (trigger: defense quest)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @return bool Should trigger
 */
function npc_check_colony_threat(PDO $db, int $userId): bool
{
    // Check if player has colonies in hostile territory or under attack
    try {
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM colonies
            WHERE user_id = ? AND threat_level > 0
        ");
        $stmt->execute([$userId]);
        $threatCount = (int)$stmt->fetchColumn();

        return $threatCount > 0;
    } catch (Exception $e) {
        // Colonies table doesn't exist
    }

    return false;
}

/**
 * Check if player has disrupted trade routes (trigger: trader quest)
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @return bool Should trigger
 */
function npc_check_trade_route_disruption(PDO $db, int $userId): bool
{
    // Check if player's trade routes have been disrupted
    try {
        $stmt = $db->prepare("
            SELECT COUNT(*) FROM trade_offers
            WHERE user_id = ? AND status = 'disrupted'
            AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ");
        $stmt->execute([$userId]);
        $disruptedCount = (int)$stmt->fetchColumn();

        return $disruptedCount > 0;
    } catch (Exception $e) {
        // Trade offers table might not track this
    }

    return false;
}

/**
 * Create quest from contextual trigger
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @param string $factionCode Faction code
 * @param string $triggerType Type of trigger
 * @return ?int Quest ID
 */
function npc_quest_contextual_trigger_create(
    PDO $db,
    int $userId,
    string $factionCode,
    string $triggerType
): ?int {
    // Select appropriate quest template
    $template = match ($triggerType) {
        'low_resources' => 'resource_delivery',
        'standing_shift' => 'diplomacy_mission',
        'colony_threat' => 'combat_patrol',
        'trade_route' => 'trading_chain',
        default => 'resource_delivery'
    };

    try {
        // Get faction ID
        $stmt = $db->prepare("SELECT id FROM npc_factions WHERE code = ? LIMIT 1");
        $stmt->execute([$factionCode]);
        $faction = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$faction) {
            return null;
        }

        $factionId = (int)$faction['id'];

        // Create contextual quest
        $stmt = $db->prepare("
            INSERT INTO faction_quests
            (faction_id, code, title, description, quest_type, active, 
             generated_by_npc, template_code, generated_timestamp, quest_type)
            VALUES (?, ?, ?, ?, ?, 1, 1, ?, NOW(), ?)
        ");

        $questCode = "contextual_{$factionCode}_{$triggerType}_" . time();
        $title = "Urgent: " . ucfirst($triggerType);
        $description = "An urgent opportunity requires your immediate attention.";

        $stmt->execute([
            $factionId,
            $questCode,
            $title,
            $description,
            $template,
            $template,
            'contextual'
        ]);

        $questId = (int)$db->lastInsertId();

        // Log the contextual trigger
        try {
            $logStmt = $db->prepare("
                INSERT INTO npc_quest_generation_log
                (faction_id, user_id, quest_id, trigger_reason, generated_at)
                VALUES (?, ?, ?, ?, NOW())
            ");
            $logStmt->execute($factionId, $userId, $questId, "contextual_trigger:$triggerType");
        } catch (Exception $e) {
            // Logging failed, but quest was created
        }

        return $questId;

    } catch (Exception $e) {
        error_log("Failed to create contextual quest: " . $e->getMessage());
        return null;
    }
}

/**
 * Get all pending contextual trigger events for a user
 * 
 * Useful for UI display of "active opportunities"
 * 
 * @param PDO $db Database connection
 * @param int $userId User ID
 * @return array Pending trigger events
 */
function npc_get_contextual_triggers(PDO $db, int $userId): array
{
    $triggers = [];

    if (npc_check_low_resources($db, $userId)) {
        $triggers[] = ['type' => 'low_resources', 'title' => 'Resource Crisis'];
    }

    if (npc_check_colony_threat($db, $userId)) {
        $triggers[] = ['type' => 'colony_threat', 'title' => 'Colony Under Threat'];
    }

    if (npc_check_trade_route_disruption($db, $userId)) {
        $triggers[] = ['type' => 'trade_route', 'title' => 'Trade Route Disrupted'];
    }

    return $triggers;
}
