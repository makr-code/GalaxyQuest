<?php

declare(strict_types=1);

require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/npc_ai.php';
require_once __DIR__ . '/../src/Simulation/Application/SimulationEventTaxonomy.php';
require_once __DIR__ . '/../lib/world_tick.php';

use GalaxyQuest\Simulation\Application\SimulationEventTaxonomy;
use GalaxyQuest\Simulation\HourlyWindow;

/**
 * Headless simulation orchestration runtime.
 *
 * Purpose:
 * - Execute simulation ticks outside read endpoints.
 * - Expose deterministic and observable tick summaries.
 */

/**
 * @param array<string, mixed> $body
 * @return array{scope:string,user_id:int,force:bool}
 */
function simulation_tick_request_options(array $body, int $authenticatedUserId): array
{
    if ($authenticatedUserId <= 0) {
        throw new InvalidArgumentException('Authenticated user ID must be positive.');
    }

    $scope = 'user';
    if (array_key_exists('scope', $body)) {
        if (!is_string($body['scope'])) {
            throw new InvalidArgumentException('scope must be either "global" or "user".');
        }
        $scope = strtolower(trim($body['scope']));
    }
    if (!in_array($scope, ['global', 'user'], true)) {
        throw new InvalidArgumentException('scope must be either "global" or "user".');
    }

    $userIdProvided = array_key_exists('user_id', $body);
    if ($scope === 'global' && $userIdProvided) {
        throw new InvalidArgumentException('user_id may only be used with scope=user.');
    }
    $userId = $authenticatedUserId;
    if ($userIdProvided) {
        if (!is_int($body['user_id']) || $body['user_id'] <= 0) {
            throw new InvalidArgumentException('user_id must be a positive integer.');
        }
        $userId = $body['user_id'];
    }

    $force = false;
    if (array_key_exists('force', $body)) {
        if (!is_bool($body['force'])) {
            throw new InvalidArgumentException('force must be a boolean.');
        }
        $force = $body['force'];
    }

    return [
        'scope' => $scope,
        'user_id' => $userId,
        'force' => $force,
    ];
}

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
        error_log(
            '[simulation] state_tracking_unavailable: app_state_get_int/app_state_set_int missing; '
            . 'cooldown enforcement disabled'
        );
        $warningLogged = true;
    }

    return false;
}

/**
 * Serialize workers for one simulation scope using a connection-scoped MySQL lock.
 *
 * @param callable(): array<string, mixed> $operation
 * @return array<string, mixed>
 */
function simulation_runtime_with_scope_lock(PDO $db, string $scope, string $scopeId, callable $operation): array
{
    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql') {
        throw new RuntimeException('Simulation tick locking requires MySQL.');
    }

    $lockName = 'gq:sim:' . substr(hash('sha256', $scope . ':' . $scopeId), 0, 48);
    $acquire = $db->prepare('SELECT GET_LOCK(?, 0)');
    $acquire->execute([$lockName]);
    $acquired = $acquire->fetchColumn();
    if ($acquired === null) {
        throw new RuntimeException('MySQL GET_LOCK returned NULL.');
    }
    if (!in_array((string)$acquired, ['0', '1'], true)) {
        throw new RuntimeException('MySQL GET_LOCK returned an unexpected result.');
    }
    if ((string)$acquired === '0') {
        return [
            'executed' => false,
            'scope' => $scope,
            'reason' => 'lock_busy',
        ];
    }

    $failure = null;
    try {
        return $operation();
    } catch (Throwable $error) {
        $failure = $error;
        throw $error;
    } finally {
        try {
            $release = $db->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
            if ((string)$release->fetchColumn() !== '1') {
                throw new RuntimeException('Simulation tick lock was not released.');
            }
        } catch (Throwable $releaseError) {
            if ($failure !== null) {
                error_log(sprintf(
                    '[simulation] lock_release_failed scope=%s error_class=%s',
                    $scope,
                    get_class($releaseError)
                ));
            } else {
                throw $releaseError;
            }
        }
    }
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
 * @param array<string, mixed> $result
 * @return array<string, mixed>
 */
function simulation_runtime_public_response(array $result): array
{
    $hasErrors = (int)($result['error_count'] ?? 0) > 0;
    if (isset($result['ticks']) && is_array($result['ticks'])) {
        foreach ($result['ticks'] as &$tick) {
            if (is_array($tick)) {
                unset($tick['error']);
            }
        }
        unset($tick);
    }

    $response = [
        'success' => !$hasErrors,
        'simulation' => $result,
    ];
    if ($hasErrors) {
        $response['error'] = 'One or more simulation subsystems failed.';
    }

    return $response;
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

    if ($supportsStateTracking && $result['ok']) {
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
 * Wall-clock aligned cadence: a global tick is due once per cooldown window
 * (e.g. every full hour), so a 5-minute scheduler never drifts past a window.
 */
function simulation_runtime_global_tick_due(int $now, int $last, int $cooldown): bool
{
    $cooldown = max(1, $cooldown);
    return intdiv($now, $cooldown) > intdiv(max(0, $last), $cooldown);
}

/**
 * @return array<string, mixed>
 */
function simulation_tick_global(PDO $db, bool $force = false): array
{
    return simulation_runtime_with_scope_lock(
        $db,
        'global',
        '',
        static fn(): array => simulation_tick_global_locked($db, $force)
    );
}

/**
 * @return array<string, mixed>
 */
function simulation_tick_global_locked(PDO $db, bool $force = false): array
{
    $now = time();
    $cooldown = max(1, (int)SIMULATION_GLOBAL_TICK_COOLDOWN_SECONDS);
    $stateKey = 'simulation:global:last_tick_unix';

    $supportsStateTracking = simulation_runtime_supports_state_tracking();

    if (!$force && $supportsStateTracking) {
        $last = app_state_get_int($db, $stateKey, 0);
        if (!simulation_runtime_global_tick_due($now, $last, $cooldown)) {
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

    $result['ticks']['npc_world'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'npc_world',
        '',
        static function () use ($db, $force): array {
            npc_ai_global_tick($db, $force);
            return [];
        },
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
    $result['ticks']['economy_requests'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'economy_requests',
        '',
        static function () use ($db, $now): array {
            require_once __DIR__ . '/../src/Economy/EconomicRequests.php';
            return (new \GalaxyQuest\Economy\EconomicRequests($db))->tick($now);
        },
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['world_events'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'world_events',
        '',
        static fn(): array => world_events_tick_global($db, $now),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    // Advisory and last: delivery problems are reported but never fail the world tick.
    $result['ticks']['mail_outbox'] = simulation_runtime_execute_subsystem(
        $db,
        'global',
        'mail_outbox',
        '',
        static fn(): array => mail_outbox_tick_global($db, $now),
        $supportsStateTracking,
        $tickStartedAtUnix
    );
    $result['ticks']['mail_outbox']['advisory'] = true;

    $allTicksSucceeded = true;
    $errorCount = 0;
    $advisoryErrorCount = 0;
    foreach ($result['ticks'] as $tick) {
        if (!empty($tick['advisory'])) {
            $advisoryErrorCount += (int)($tick['error_count'] ?? 0);
            continue;
        }
        $errorCount += (int)($tick['error_count'] ?? 0);
        if (empty($tick['ok'])) {
            $allTicksSucceeded = false;
        }
    }

    if ($allTicksSucceeded && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, time());
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['error_count'] = $errorCount;
    $result['advisory_error_count'] = $advisoryErrorCount;
    $result['tick_unix'] = $now;
    $result['window_id'] = HourlyWindow::id($now);

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

    return simulation_runtime_with_scope_lock(
        $db,
        'user',
        (string)$userId,
        static fn(): array => simulation_tick_user_locked($db, $userId, $force)
    );
}

/**
 * @return array<string, mixed>
 */
function simulation_tick_user_locked(PDO $db, int $userId, bool $force = false): array
{
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

    $allTicksSucceeded = true;
    $errorCount = 0;
    foreach ($result['ticks'] as $tick) {
        $errorCount += (int)($tick['error_count'] ?? 0);
        if (empty($tick['ok'])) {
            $allTicksSucceeded = false;
        }
    }

    if ($allTicksSucceeded && $supportsStateTracking) {
        app_state_set_int($db, $stateKey, time());
    }

    $result['duration_ms'] = (int)round((microtime(true) - $tickStart) * 1000);
    $result['error_count'] = $errorCount;
    $result['tick_unix'] = $now;

    return $result;
}
