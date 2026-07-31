<?php

declare(strict_types=1);

/**
 * NPC Faction Daily Quest Generator
 * 
 * Globally generates new quests for all factions on a daily basis.
 * Runs once per day (coordinated via app_state).
 * Minimum server load: only runs when players are active.
 * 
 * Triggered by: npc_ai_tick() -> faction_events_tick_global()
 * Cooldown: 24 hours (stored in app_state as 'daily_quest_generator:last_run')
 */

require_once __DIR__ . '/npc_quest_action_executor.php';
require_once __DIR__ . '/npc_quest_personalizer.php';
require_once __DIR__ . '/../lib/SeededRandom.php';

/**
 * Run daily quest generation for all factions globally
 * 
 * Called once per 24 hours from faction_events_tick_global()
 * 
 * @param PDO $db Database connection
 * @param bool $force Force generation regardless of cooldown
 * @return array Generation statistics
 */
function npc_faction_daily_quests_generate(PDO $db, bool $force = false): array
{
    $stats = [
        'factions_processed' => 0,
        'quests_generated' => 0,
        'errors' => 0,
        'skipped' => 0
    ];

    // Rate-limit: run once per 24 hours
    $coolKey = 'daily_quest_generator:last_run';

    if (!$force && function_exists('app_state_get_int')) {
        $lastRun = app_state_get_int($db, $coolKey, 0);
        if (time() - $lastRun < 86400) {  // 24 hours
            return ['ok' => false, 'reason' => 'cooldown_active'];
        }
    }

    try {
        // Load all active factions
        $stmt = $db->prepare("
            SELECT id, code, faction_type, trade_willingness
            FROM npc_factions
            WHERE active = 1
            ORDER BY id ASC
        ");
        $stmt->execute();
        $factions = $stmt->fetchAll(PDO::FETCH_ASSOC);

        foreach ($factions as $faction) {
            try {
                $questCount = npc_faction_daily_quests_for_faction($db, $faction);
                $stats['quests_generated'] += $questCount;
                $stats['factions_processed']++;
            } catch (Exception $e) {
                error_log("Daily quest generation failed for faction {$faction['code']}: " . $e->getMessage());
                $stats['errors']++;
            }
        }

        // Update cooldown
        if (function_exists('app_state_set_int')) {
            app_state_set_int($db, $coolKey, time());
        }

        return ['ok' => true, 'stats' => $stats];

    } catch (Exception $e) {
        error_log("Daily quest generation global error: " . $e->getMessage());
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * Generate daily quests for a specific faction
 * 
 * Decides how many quests to generate based on:
 * - Faction type
 * - Trade willingness
 * - Current active quest count
 * 
 * @param PDO $db Database connection
 * @param array $faction Faction data
 * @return int Number of quests generated
 */
function npc_faction_daily_quests_for_faction(PDO $db, array $faction): int
{
    $factionId = (int)$faction['id'];
    $factionCode = $faction['code'];
    $factionType = $faction['faction_type'];
    $tradeWillingness = (int)$faction['trade_willingness'];

    // Determine quest generation intensity based on faction type
    $questsToGenerate = 0;

    switch ($factionType) {
        case 'trade':
            $questsToGenerate = max(2, (int)($tradeWillingness / 50));
            break;
        case 'military':
            $questsToGenerate = 3;
            break;
        case 'science':
            $questsToGenerate = 2;
            break;
        case 'pirate':
            $questsToGenerate = 1;
            break;
        default:
            $questsToGenerate = 1;
    }

    // Check current active quest count
    $stmt = $db->prepare("
        SELECT COUNT(*) FROM faction_quests
        WHERE faction_id = ? AND active = 1 AND generated_by_npc = 1
    ");
    $stmt->execute([$factionId]);
    $currentQuests = (int)$stmt->fetchColumn();

    // Don't exceed max active quests per faction
    $maxActive = defined('NPC_QUEST_MAX_ACTIVE_PER_FACTION') ?
        NPC_QUEST_MAX_ACTIVE_PER_FACTION : 10;

    if ($currentQuests >= $maxActive) {
        return 0;  // Skip, already at max
    }

    $questsToGenerate = min($questsToGenerate, $maxActive - $currentQuests);

    // Generate quests
    $generated = 0;

    for ($i = 0; $i < $questsToGenerate; $i++) {
        try {
            if (npc_faction_daily_quests_create_one($db, $faction)) {
                $generated++;
            }
        } catch (Exception $e) {
            error_log("Failed to create daily quest for {$factionCode}: " . $e->getMessage());
        }
    }

    return $generated;
}

/**
 * Create a single daily quest for a faction
 * 
 * @param PDO $db Database connection
 * @param array $faction Faction data
 * @return bool True if quest was created
 */
function npc_faction_daily_quests_create_one(PDO $db, array $faction): bool
{
    $factionId = (int)$faction['id'];
    $factionCode = $faction['code'];

    // Select random quest template based on faction type
    $templates = npc_select_faction_templates($faction);

    if (empty($templates)) {
        return false;
    }

    $rng = new SeededRandom(time() % 86400);  // Reset each day
    $selectedTemplate = $rng->choose($templates);

    if (!$selectedTemplate) {
        return false;
    }

    // Load template
    try {
        $templateData = npc_load_quest_template($db, $selectedTemplate);
        if (!$templateData) {
            return false;
        }
    } catch (Exception $e) {
        error_log("Failed to load template $selectedTemplate: " . $e->getMessage());
        return false;
    }

    // Create personalized quest
    try {
        $stmt = $db->prepare("
            INSERT INTO faction_quests
            (faction_id, code, title, description, quest_type, active, 
             generated_by_npc, template_code, generated_timestamp)
            VALUES (?, ?, ?, ?, ?, 1, 1, ?, NOW())
        ");

        $questCode = "daily_quest_{$factionCode}_" . time() . "_" . rand(1000, 9999);
        $title = $templateData['title_template'] ?? 'Mission';
        $description = $templateData['description_template'] ?? 'Complete this quest';

        $stmt->execute([
            $factionId,
            $questCode,
            $title,
            $description,
            $templateData['quest_type'] ?? 'delivery'
        ]);

        // Log generation
        $questId = $db->lastInsertId();
        npc_quest_trigger_log_insert($db, $factionId, null, $questId, 'daily_generator', $faction);

        return true;

    } catch (Exception $e) {
        error_log("Failed to insert daily quest: " . $e->getMessage());
        return false;
    }
}

/**
 * Select quest templates appropriate for faction type
 * 
 * @param array $faction Faction data
 * @return array Template codes
 */
function npc_select_faction_templates(array $faction): array
{
    $factionType = $faction['faction_type'] ?? '';

    $templates = match ($factionType) {
        'trade' => ['resource_delivery', 'trading_chain'],
        'military' => ['combat_patrol', 'combat_raid'],
        'science' => ['exploration_mission', 'research_collaboration'],
        'pirate' => ['raid', 'combat_patrol'],
        default => ['resource_delivery', 'exploration_mission']
    };

    return array_filter($templates, function ($t) use ($faction) {
        // Verify template exists (simplified check)
        return !empty($t);
    });
}

/**
 * Log quest trigger for analytics and audit
 * 
 * @param PDO $db Database connection
 * @param int $factionId Faction ID
 * @param ?int $userId User ID (null for global generation)
 * @param int $questId Quest ID
 * @param string $reason Trigger reason
 * @param array $context Additional context
 * @return void
 */
function npc_quest_trigger_log_insert(
    PDO $db,
    int $factionId,
    ?int $userId,
    int $questId,
    string $reason,
    array $context = []
): void {
    try {
        $stmt = $db->prepare("
            INSERT INTO npc_quest_generation_log
            (faction_id, user_id, quest_id, trigger_reason, trigger_context_json, generated_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        ");

        $stmt->execute([
            $factionId,
            $userId,
            $questId,
            $reason,
            json_encode($context)
        ]);
    } catch (Exception $e) {
        error_log("Failed to log quest trigger: " . $e->getMessage());
    }
}
