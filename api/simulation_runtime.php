<?php

declare(strict_types=1);

require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/npc_ai.php';
require_once __DIR__ . '/../src/Simulation/Application/SimulationEventTaxonomy.php';

use GalaxyQuest\Simulation\Application\SimulationEventTaxonomy;

/**
 * Headless simulation orchestration runtime.
 *
 * Purpose:
 * - Execute simulation ticks outside read endpoints.
 * - Expose deterministic and observable tick summaries.
 */

/**
 * @return array<string, mixed>
 */
function simulation_runtime_event_taxonomy(): array
{
    /** @var array<string, mixed>|null $cachedTaxonomy */
    static $cachedTaxonomy = null;
    if (is_array($cachedTaxonomy)) {
        return $cachedTaxonomy;
    }

    try {
        $cachedTaxonomy = SimulationEventTaxonomy::load(SIMULATION_EVENT_TAXONOMY_FILE);
        return $cachedTaxonomy;
    } catch (Throwable $e) {
        error_log('[simulation] taxonomy_load_error: ' . $e->getMessage());
        $cachedTaxonomy = [
            'version' => 'unknown',
            'events' => [],
        ];
        return $cachedTaxonomy;
    }
}

function simulation_runtime_supports_state_tracking(): bool
{
    $supports = function_exists('app_state_get_int') && function_exists('app_state_set_int');
    if ($supports) {
        return true;
    }

    static $warningLogged = false;
    if (!$warningLogged) {
        error_log('[simulation] state_tracking_unavailable: app_state_get_int/app_state_set_int missing; cooldown enforcement disabled');
        $warningLogged = true;
    }

    return false;
}

/**
 * @return array<string, mixed>
 */
function simulation_tick_global(PDO $db, bool $force = false): array
{
    $now = time();
    $cooldown = max(1, (int)SIMULATION_GLOBAL_TICK_COOLDOWN_SECONDS);
    $stateKey = 'simulation:global:last_tick_unix';

    $supportsStateTracking = simulation_runtime_supports_state_tracking();

    if (!$force && $supportsStateTracking) {
        $last = app_state_get_int($db, $stateKey, 0);
        if (($now - $last) < $cooldown) {
            return [
                'executed' => false,
                'scope' => 'global',
                'reason' => 'cooldown',
                'cooldown_seconds' => $cooldown,
                'last_tick_unix' => $last,
                'now_unix' => $now,
            ];
        }
    }

    $tickStart = microtime(true);

    $result = [
        'executed' => true,
        'scope' => 'global',
        'force' => $force,
        'taxonomy' => simulation_runtime_event_taxonomy()['version'] ?? 'unknown',
        'ticks' => [],
    ];

    try {
        $result['ticks']['economy_production'] = process_economy_production_tick($db, $force);
    } catch (Throwable $e) {
        $result['ticks']['economy_production'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        $result['ticks']['economy_population'] = process_economy_pop_satisfaction_tick($db, $force);
    } catch (Throwable $e) {
        $result['ticks']['economy_population'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        $result['ticks']['war_runtime'] = process_war_runtime_tick($db, $force);
    } catch (Throwable $e) {
        $result['ticks']['war_runtime'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        $result['ticks']['war_attrition'] = process_war_attrition_tick($db, $force);
    } catch (Throwable $e) {
        $result['ticks']['war_attrition'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        $result['ticks']['pirate_raids'] = process_pirate_raid_resolution_tick($db, $force);
    } catch (Throwable $e) {
        $result['ticks']['pirate_raids'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    try {
        trader_tick_global($db, $force);
        $result['ticks']['traders'] = ['ok' => true];
    } catch (Throwable $e) {
        $result['ticks']['traders'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    $hasSuccessfulTick = false;
    foreach ($result['ticks'] as $tick) {
        if (is_array($tick) && !empty($tick['ok'])) {
            $hasSuccessfulTick = true;
            break;
        }
    }

    if ($hasSuccessfulTick && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, $now);
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['tick_unix'] = $now;

    return $result;
}

/**
 * @return array<string, mixed>
 */
function simulation_tick_user(PDO $db, int $userId, bool $force = false): array
{
    if ($userId <= 0) {
        throw new InvalidArgumentException('userId must be > 0');
    }

    $now = time();
    $cooldown = max(1, (int)SIMULATION_USER_TICK_COOLDOWN_SECONDS);
    $stateKey = 'simulation:user:' . $userId . ':last_tick_unix';

    $supportsStateTracking = simulation_runtime_supports_state_tracking();

    if (!$force && $supportsStateTracking) {
        $last = app_state_get_int($db, $stateKey, 0);
        if (($now - $last) < $cooldown) {
            return [
                'executed' => false,
                'scope' => 'user',
                'user_id' => $userId,
                'reason' => 'cooldown',
                'cooldown_seconds' => $cooldown,
                'last_tick_unix' => $last,
                'now_unix' => $now,
            ];
        }
    }

    $tickStart = microtime(true);
    $result = [
        'executed' => true,
        'scope' => 'user',
        'user_id' => $userId,
        'force' => $force,
        'taxonomy' => simulation_runtime_event_taxonomy()['version'] ?? 'unknown',
        'ticks' => [],
    ];

    try {
        npc_ai_tick($db, $userId, $force);
        $result['ticks']['npc_ai'] = ['ok' => true];
    } catch (Throwable $e) {
        $result['ticks']['npc_ai'] = ['ok' => false, 'error' => $e->getMessage()];
    }

    $hasSuccessfulTick = false;
    foreach ($result['ticks'] as $tick) {
        if (is_array($tick) && !empty($tick['ok'])) {
            $hasSuccessfulTick = true;
            break;
        }
    }

    if ($hasSuccessfulTick && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, $now);
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['tick_unix'] = $now;

    return $result;
}
