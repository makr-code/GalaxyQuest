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
 * @param callable(): mixed $operation
 * @return array<string, mixed>
 */
function simulation_runtime_measure_subsystem(
    callable $operation,
    ?int $previousRunUnix,
    int $startedAtUnix
): array {
    $start = microtime(true);
    try {
        $outcome = $operation();
        $result = is_array($outcome) ? $outcome : [];
        $ok = ($result['ok'] ?? true) !== false;
        $errorClass = null;
    } catch (Throwable $e) {
        $result = ['error' => $e->getMessage()];
        $ok = false;
        $errorClass = get_class($e);
    }

    $durationMs = (int)round((microtime(true) - $start) * 1000);
    $lagSeconds = $previousRunUnix === null
        ? null
        : max(0, $startedAtUnix - $previousRunUnix);
    $result['ok'] = $ok;
    $result['duration_ms'] = $durationMs;
    $result['lag_seconds'] = $lagSeconds;
    $result['error_count'] = $ok ? 0 : 1;

    if ($errorClass !== null) {
        $result['error_class'] = $errorClass;
    }

    return $result;
}

/**
 * Execute one subsystem and report its duration, time since its previous run,
 * and error state without allowing telemetry persistence to mask tick results.
 *
 * @param callable(): mixed $operation
 * @return array<string, mixed>
 */
function simulation_runtime_execute_subsystem(
    PDO $db,
    string $scope,
    string $subsystem,
    string $scopeId,
    callable $operation,
    bool $supportsStateTracking,
    int $startedAtUnix
): array {
    $stateScope = $scope === 'user' ? 'u:' . $scopeId : 'g';
    $stateKey = 'sim:m:' . $stateScope . ':' . $subsystem . ':run';
    $previousRunUnix = null;

    if ($supportsStateTracking) {
        try {
            $lastRun = app_state_get_int($db, $stateKey, 0);
            $previousRunUnix = $lastRun > 0 ? $lastRun : null;
        } catch (Throwable $e) {
            error_log(sprintf(
                '[simulation_metrics] state_read_error scope=%s subsystem=%s error_class=%s',
                $scope,
                $subsystem,
                get_class($e)
            ));
        }
    }

    $result = simulation_runtime_measure_subsystem(
        $operation,
        $previousRunUnix,
        $startedAtUnix
    );

    if ($supportsStateTracking) {
        try {
            app_state_set_int($db, $stateKey, $startedAtUnix);
        } catch (Throwable $e) {
            error_log(sprintf(
                '[simulation_metrics] state_write_error scope=%s subsystem=%s error_class=%s',
                $scope,
                $subsystem,
                get_class($e)
            ));
        }
    }

    $metric = [
        'scope' => $scope,
        'subsystem' => $subsystem,
        'duration_ms' => $result['duration_ms'],
        'lag_seconds' => $result['lag_seconds'],
        'ok' => $result['ok'],
        'error_count' => $result['error_count'],
    ];
    if (isset($result['error_class'])) {
        $metric['error_class'] = $result['error_class'];
    }
    error_log('[simulation_metrics] ' . json_encode($metric, JSON_UNESCAPED_SLASHES));

    return $result;
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
    $tickStartedAtUnix = (int)$tickStart;

    $result = [
        'executed' => true,
        'scope' => 'global',
        'force' => $force,
        'taxonomy' => simulation_runtime_event_taxonomy()['version'] ?? 'unknown',
        'ticks' => [],
    ];

    $result['ticks']['economy_production'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'economy_production',
        '',
        static fn(): array => process_economy_production_tick($db, $force),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['economy_population'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'economy_population',
        '',
        static fn(): array => process_economy_pop_satisfaction_tick($db, $force),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['war_runtime'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'war_runtime',
        '',
        static fn(): array => process_war_runtime_tick($db, $force),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['war_attrition'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'war_attrition',
        '',
        static fn(): array => process_war_attrition_tick($db, $force),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['pirate_raids'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'pirate_raids',
        '',
        static fn(): array => process_pirate_raid_resolution_tick($db, $force),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['traders'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'traders',
        '',
        static function () use ($db, $force): array {
            trader_tick_global($db, $force);
            return [];
        },
        $supportsStateTracking,
        $tickStartedAtUnix
    );

    $hasSuccessfulTick = false;
    $errorCount = 0;
    foreach ($result['ticks'] as $tick) {
        $errorCount += (int)($tick['error_count'] ?? 0);
        if (!empty($tick['ok'])) {
            $hasSuccessfulTick = true;
        }
    }

    if ($hasSuccessfulTick && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, $now);
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['error_count'] = $errorCount;
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
    $tickStartedAtUnix = (int)$tickStart;
    $result = [
        'executed' => true,
        'scope' => 'user',
        'user_id' => $userId,
        'force' => $force,
        'taxonomy' => simulation_runtime_event_taxonomy()['version'] ?? 'unknown',
        'ticks' => [],
    ];

    $result['ticks']['npc_ai'] = simulation_runtime_execute_subsystem(
        $db,
        'user',
        'npc_ai',
        (string)$userId,
        static function () use ($db, $userId, $force): array {
            npc_ai_tick($db, $userId, $force);
            return [];
        },
        $supportsStateTracking,
        $tickStartedAtUnix
    );

    $hasSuccessfulTick = false;
    $errorCount = 0;
    foreach ($result['ticks'] as $tick) {
        if (!empty($tick['ok'])) {
            $hasSuccessfulTick = true;
        }
        $errorCount += (int)($tick['error_count'] ?? 0);
    }

    if ($hasSuccessfulTick && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, $now);
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['error_count'] = $errorCount;
    $result['tick_unix'] = $now;

    return $result;
}
