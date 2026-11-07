<?php

declare(strict_types=1);

/**
 * NPC Faction Daily Quest Generator
 * 
 * Globally generates new quests for all factions on a daily basis.
 * Runs once per day (coordinated via app_state).
 * Minimum server load: only runs when players are active.
 * 
 * The generator currently has no production call site.
 * Cooldown: 24 hours (stored in app_state as 'daily_quest_generator:last_run')
 */

require_once __DIR__ . '/npc_quest_action_executor.php';
require_once __DIR__ . '/npc_quest_personalizer.php';

/**
 * Run daily quest generation for all factions globally
 * 
 * Called by the explicit quest-generation entry point.
 * 
 * @param PDO $db Database connection
 * @param bool $force Force generation regardless of cooldown
 * @return array Generation statistics
 */
function npc_faction_daily_quests_generate(PDO $db, bool $force = false): array
{
    $ownsTransaction = !$db->inTransaction();
    $savepoint = 'daily_quest_generation';
    if ($ownsTransaction) {
        $db->beginTransaction();
    } else {
        $db->exec('SAVEPOINT ' . $savepoint);
    }

    try {
        $result = npc_faction_daily_quests_generate_run($db, $force);

        if ($ownsTransaction) {
            $db->commit();
        } else {
            $db->exec('RELEASE SAVEPOINT ' . $savepoint);
        }

        return $result;
    } catch (Throwable $error) {
        npc_faction_daily_quests_rollback_transaction($db, $savepoint, $ownsTransaction);
        error_log("Daily quest generation global error: " . $error->getMessage());
        throw $error;
    }
}

function npc_faction_daily_quests_rollback_transaction(PDO $db, string $savepoint, bool $ownsTransaction): void
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

function npc_faction_daily_quests_generate_run(PDO $db, bool $force): array
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

    // Load all active factions. Any read or generation error aborts the
    // transaction so a retry cannot stack quests from a partial run.
    $stmt = $db->prepare("
        SELECT id, code, name, faction_type, trade_willingness
        FROM npc_factions
        ORDER BY id ASC
    ");
    $stmt->execute();
    $factions = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($factions as $faction) {
        $questCount = npc_faction_daily_quests_for_faction($db, $faction);
        $stats['quests_generated'] += $questCount;
        $stats['factions_processed']++;
    }

    // Update cooldown only after every faction has been processed successfully.
    if (function_exists('app_state_set_int')) {
        app_state_set_int($db, $coolKey, time());
    }

    return ['ok' => true, 'stats' => $stats];
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

    $expireOffers = $db->prepare("
        UPDATE faction_quests fq
        SET active = 0
        WHERE fq.faction_id = ?
          AND fq.active = 1
          AND fq.generated_by_npc = 1
          AND fq.generated_timestamp < DATE_SUB(NOW(), INTERVAL 1 DAY)
          AND NOT EXISTS (
              SELECT 1
              FROM user_faction_quests uq
              WHERE uq.faction_quest_id = fq.id
                AND uq.status IN ('active', 'completed')
          )
    ");
    $expireOffers->execute([$factionId]);

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
        if (npc_faction_daily_quests_create_one($db, $faction)) {
            $generated++;
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
    $factionName = (string)($faction['name'] ?? $factionCode);

    // Select random quest template based on faction type
    $templates = npc_select_faction_templates($faction);

    if (empty($templates)) {
        return false;
    }

    $selectedTemplate = $templates[random_int(0, count($templates) - 1)];

    // Load template
    $templateData = npc_load_quest_template($db, $selectedTemplate);
    if (!$templateData) {
        throw new RuntimeException("Daily quest template '{$selectedTemplate}' is missing.");
    }

    $params = npc_daily_quest_default_params($selectedTemplate, $factionName);
    $questType = npc_daily_quest_canonical_type((string)($templateData['quest_type'] ?? ''));
    $requirements = npc_daily_quest_requirements(
        $selectedTemplate,
        $questType,
        $params
    );
    $rewards = npc_daily_quest_rewards(
        $selectedTemplate,
        (array)($templateData['reward_template'] ?? [])
    );
    $title = npc_daily_quest_render((string)($templateData['title_template'] ?? ''), $params);
    $description = npc_daily_quest_render((string)($templateData['description_template'] ?? ''), $params);
    if ($title === '' || $description === '') {
        throw new RuntimeException("Daily quest template '{$selectedTemplate}' has empty title or description.");
    }

    $stmt = $db->prepare("
        INSERT INTO faction_quests
        (faction_id, code, title, description, quest_type, requirements_json,
         reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
         reward_dark_matter, reward_rank_points, reward_standing, min_standing,
         difficulty, repeatable, active, generated_by_npc, template_code, generated_timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, -100, ?, 0, 1, 1, ?, NOW())
    ");

    $safeFactionCode = substr((string)preg_replace('/[^a-zA-Z0-9_]/', '_', $factionCode), 0, 24);
    $questCode = 'daily_' . $safeFactionCode . '_' . gmdate('YmdHis') . '_' . bin2hex(random_bytes(4));

    $stmt->execute([
        $factionId,
        $questCode,
        substr($title, 0, 128),
        $description,
        $questType,
        json_encode($requirements, JSON_THROW_ON_ERROR),
        $rewards['metal'],
        $rewards['crystal'],
        $rewards['deuterium'],
        $rewards['rare_earth'],
        $rewards['dark_matter'],
        $rewards['rank_points'],
        $rewards['standing'],
        npc_daily_quest_difficulty((float)($templateData['difficulty_modifier'] ?? 1.0)),
        $selectedTemplate,
    ]);

    // Log generation
    $questId = (int)$db->lastInsertId();
    npc_quest_trigger_log_insert($db, $factionId, null, $questId, 'daily_generator', $faction);

    return true;
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

    return match ($factionType) {
        'trade' => ['resource_delivery'],
        'military' => ['combat_patrol'],
        'science' => ['exploration_mission', 'research_collaboration'],
        'pirate' => ['combat_patrol'],
        default => ['resource_delivery', 'exploration_mission']
    };
}

function npc_daily_quest_canonical_type(string $templateType): string
{
    return match ($templateType) {
        'deliver' => 'deliver',
        'combat', 'kill' => 'kill',
        'explore' => 'explore',
        'research' => 'research',
        default => throw new UnexpectedValueException("Unsupported faction quest type '{$templateType}'."),
    };
}

function npc_daily_quest_default_params(string $templateCode, string $factionName): array
{
    $defaults = match ($templateCode) {
        'resource_delivery' => ['amount' => 1000, 'resource' => 'metal', 'location' => 'the faction capital'],
        'exploration_mission' => ['location' => 'a frontier system'],
        'combat_patrol' => ['enemy_count' => 5, 'enemy_type' => 'hostile ships', 'location' => 'a disputed system'],
        'research_collaboration' => ['tech_name' => 'available technology'],
        default => throw new UnexpectedValueException("Unsupported daily quest template '{$templateCode}'."),
    };

    return ['faction_name' => $factionName] + $defaults;
}

function npc_daily_quest_requirements(
    string $templateCode,
    string $questType,
    array $params
): array {
    $requirements = match ($questType) {
        'deliver' => [
            'resource' => $params['resource'] ?? 'metal',
            'amount' => (int)($params['amount'] ?? 0),
        ],
        'kill' => ['count' => (int)($params['enemy_count'] ?? 1)],
        'explore' => ['spy_reports' => 1],
        'research' => ['research_level' => 1],
        default => throw new UnexpectedValueException("Unsupported faction quest type '{$questType}'."),
    };

    if ($questType === 'deliver' && !in_array($requirements['resource'], ['metal', 'crystal', 'deuterium', 'rare_earth'], true)) {
        throw new UnexpectedValueException("Unsupported delivery resource '{$requirements['resource']}'.");
    }
    if (($requirements['amount'] ?? 1) <= 0 || ($requirements['count'] ?? 1) <= 0) {
        throw new UnexpectedValueException("Daily quest template '{$templateCode}' has invalid requirements.");
    }

    return $requirements;
}

function npc_daily_quest_rewards(string $templateCode, array $templateRewards): array
{
    $defaults = match ($templateCode) {
        'resource_delivery' => ['metal' => 500, 'standing' => 5],
        'exploration_mission' => ['crystal' => 600, 'standing' => 6],
        'combat_patrol' => ['metal' => 800, 'deuterium' => 400, 'standing' => 8],
        'research_collaboration' => ['rare_earth' => 700, 'standing' => 7],
        default => throw new UnexpectedValueException("Unsupported daily quest template '{$templateCode}'."),
    };

    $rewards = [
        'metal' => 0,
        'crystal' => 0,
        'deuterium' => 0,
        'rare_earth' => 0,
        'dark_matter' => 0,
        'rank_points' => 0,
        'standing' => 5,
    ];
    foreach (['metal', 'crystal', 'deuterium', 'rare_earth', 'dark_matter', 'rank_points', 'standing'] as $reward) {
        $configured = $templateRewards['base_' . $reward] ?? $defaults[$reward] ?? 0;
        if (is_numeric($configured)) {
            $rewards[$reward] = max(0, (int)$configured);
        }
    }

    return $rewards;
}

function npc_daily_quest_difficulty(float $modifier): string
{
    return match (true) {
        $modifier < 0.9 => 'easy',
        $modifier >= 1.3 => 'hard',
        default => 'medium',
    };
}

function npc_daily_quest_render(string $template, array $params): string
{
    foreach ($params as $key => $value) {
        $template = str_replace('{' . $key . '}', (string)$value, $template);
    }

    return trim($template);
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
        json_encode($context, JSON_THROW_ON_ERROR)
    ]);
}
