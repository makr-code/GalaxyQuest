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
    // The delivery quest requires metal, so use the canonical colony stockpile.
    try {
        $stmt = $db->prepare('
            SELECT COUNT(*)
            FROM colonies
            WHERE user_id = ? AND metal < 500
        ');
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn() > 0;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
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
    // The standing history is optional; the current diplomacy row has no prior value.
    try {
        $stmt = $db->prepare("
            SELECT 1
            FROM diplomacy_history dh
            JOIN npc_factions f ON f.id = dh.faction_id
            WHERE dh.user_id = ? AND f.code = ?
              AND ABS(dh.standing_delta) > 10
              AND dh.created_at >= ?
            LIMIT 1
        ");
        $stmt->execute([$userId, $factionCode, date('Y-m-d H:i:s', time() - 3600)]);
        return $stmt->fetchColumn() !== false;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
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
    // A recent battle report against one of the user's colonies is the persisted
    // canonical signal that the colony was attacked.
    try {
        $stmt = $db->prepare("
            SELECT COUNT(*)
            FROM battle_reports br
            JOIN colonies c ON c.body_id = br.body_id AND c.user_id = br.defender_id
            WHERE br.defender_id = ? AND br.created_at >= ?
        ");
        $stmt->execute([$userId, date('Y-m-d H:i:s', time() - 3600)]);
        $threatCount = (int)$stmt->fetchColumn();

        return $threatCount > 0;
    } catch (PDOException $error) {
        if ($error->getCode() !== '42S02') {
            throw $error;
        }
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
    // trade_routes has no persisted disruption state or event history.
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
    $templateCode = match ($triggerType) {
        'low_resources' => 'resource_delivery',
        'colony_threat' => 'combat_patrol',
        default => null,
    };
    if ($templateCode === null) {
        return null;
    }

    $stmt = $db->prepare("SELECT id, name FROM npc_factions WHERE code = ? LIMIT 1");
    $stmt->execute([$factionCode]);
    $faction = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$faction) {
        return null;
    }

    $factionId = (int)$faction['id'];
    $template = npc_load_quest_template($db, $templateCode);
    if ($template === null) {
        throw new RuntimeException("Contextual quest template '{$templateCode}' is unavailable.");
    }
    $template = npc_contextual_quest_normalize_template($template, $templateCode);
    $params = array_merge(
        is_array($template['default_params'] ?? null) ? $template['default_params'] : [],
        [
            'faction_name' => (string) ($faction['name'] ?? $factionCode),
            'amount' => 500,
            'resource' => 'metal',
            'location' => 'your colony system',
            'enemy_count' => 1,
            'enemy_type' => 'hostile ships',
            'threat_level' => 'high',
        ]
    );
    $questData = npc_personalize_quest_from_template($template, $params);
    $questData['quest_type'] = npc_contextual_quest_type((string) $questData['quest_type']);
    $questData['requirements_json'] = npc_contextual_quest_requirements(
        $questData['quest_type'],
        (string) $questData['requirements_json']
    );

    $ownsTransaction = !$db->inTransaction();
    $savepoint = 'npc_contextual_quest_generation';
    if ($ownsTransaction) {
        $db->beginTransaction();
    } else {
        $db->exec('SAVEPOINT ' . $savepoint);
    }
    try {
        $questId = npc_insert_generated_quest($db, $factionId, $questData, $userId, $templateCode);
        $logResult = npc_quest_trigger_log_record($db, [
            'faction_id' => $factionId,
            'user_id' => $userId,
            'quest_id' => $questId,
            'trigger_reason' => "contextual_trigger:$triggerType",
            'trigger_context' => ['template_code' => $templateCode],
        ]);
        if ($logResult['ok'] === false) {
            throw new RuntimeException('Failed to record contextual quest generation.');
        }

        if ($ownsTransaction) {
            $db->commit();
        } else {
            $db->exec('RELEASE SAVEPOINT ' . $savepoint);
        }

        return $questId;
    } catch (Throwable $error) {
        npc_contextual_quest_rollback($db, $savepoint, $ownsTransaction);
        throw $error;
    }
}

function npc_contextual_quest_normalize_template(array $template, string $templateCode): array
{
    $template['quest_type'] = npc_contextual_quest_type((string) ($template['quest_type'] ?? ''));

    $requirements = $template['requirements_template'] ?? null;
    if (!is_array($requirements)) {
        $requirements = match ($templateCode) {
            'resource_delivery' => ['resource' => '{resource}', 'amount' => '{amount}'],
            'combat_patrol' => ['count' => '{enemy_count}'],
            default => throw new UnexpectedValueException("Unsupported contextual template '{$templateCode}'."),
        };
    }
    $template['requirements_template'] = json_encode($requirements, JSON_THROW_ON_ERROR);

    $rewards = $template['reward_template'] ?? $template['reward_scaling'] ?? [];
    if (!is_array($rewards)) {
        $rewards = [];
    }
    $template['reward_template'] = json_encode($rewards, JSON_THROW_ON_ERROR);

    return $template;
}

function npc_contextual_quest_type(string $type): string
{
    return match ($type) {
        'combat', 'kill' => 'kill',
        'deliver' => 'deliver',
        'explore' => 'explore',
        'build' => 'build',
        'research' => 'research',
        'spy' => 'spy',
        default => throw new UnexpectedValueException("Unsupported contextual quest type '{$type}'."),
    };
}

function npc_contextual_quest_requirements(string $type, string $requirementsJson): string
{
    $requirements = json_decode($requirementsJson, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($requirements)) {
        throw new UnexpectedValueException('Contextual quest requirements must be an object.');
    }

    if ($type === 'deliver') {
        $resource = (string) ($requirements['resource'] ?? '');
        $amount = (int) ($requirements['amount'] ?? 0);
        if (!in_array($resource, ['metal', 'crystal', 'deuterium', 'rare_earth'], true) || $amount <= 0) {
            throw new UnexpectedValueException('Contextual delivery quest requirements are invalid.');
        }
        $requirements = ['resource' => $resource, 'amount' => $amount];
    } elseif ($type === 'kill') {
        $count = (int) ($requirements['count'] ?? 0);
        if ($count <= 0) {
            throw new UnexpectedValueException('Contextual combat quest requirements are invalid.');
        }
        $requirements = ['count' => $count];
    }

    return json_encode($requirements, JSON_THROW_ON_ERROR);
}

function npc_contextual_quest_rollback(PDO $db, string $savepoint, bool $ownsTransaction): void
{
    if (!$db->inTransaction()) {
        return;
    }

    if ($ownsTransaction) {
        $db->rollBack();
        return;
    }

    $db->exec('ROLLBACK TO SAVEPOINT ' . $savepoint);
    $db->exec('RELEASE SAVEPOINT ' . $savepoint);
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
