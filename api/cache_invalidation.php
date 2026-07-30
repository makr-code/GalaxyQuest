<?php
/**
 * GalaxyQuest – Cache Invalidation Strategies
 *
 * Manages coordinated cache invalidation across game domains using event-driven
 * patterns. Each game action (e.g., building placement, fleet arrival) invalidates
 * only the cache scopes affected, minimizing stale data while preserving hot caches.
 *
 * ── Strategy Patterns ──────────────────────────────────────────────────────────
 *
 * 1. EVENT-DRIVEN (Primary)
 *    When a game action succeeds, emit a domain-level invalidation event.
 *    Example: after colonization_complete(), emit invalidation for scopes:
 *    - "game_overview" (affected user)
 *    - "system_payload_base" (affected system)
 *    - "faction_relations" (if relations changed)
 *
 * 2. TTL-BASED (Automatic Fallback)
 *    Most scopes have configured TTLs (cache.php). When TTL expires, stale
 *    entry is naturally replaced on next miss.
 *
 * 3. VERSION-BASED (Automatic)
 *    Incrementing CACHE_VERSION in config invalidates entire cache across
 *    all processes (no restart needed). Used for major updates/deployments.
 *
 * ── API ────────────────────────────────────────────────────────────────────────
 *   gq_invalidate_scope($scope, $params = [])
 *         Invalidate specific entries in a scope (default: all entries in scope).
 *
 *   gq_invalidate_domain($domain, $entity_id)
 *         Invalidate all scopes affected by changes to an entity.
 *         Domains: 'colony', 'fleet', 'research', 'diplomacy', 'economy', etc.
 *
 *   gq_invalidate_user($uid)
 *         Invalidate all user-specific caches (overview, resources, etc.)
 *
 *   gq_invalidate_system($galaxy, $system)
 *         Invalidate all system-level caches (star data, planets, etc.)
 *
 *   gq_register_invalidation_hook($domain, callable $handler)
 *         Register custom handlers for domain-level invalidation.
 *
 * ── Implementation Notes ──────────────────────────────────────────────────────
 * - Hooks are stored in APCu for fast dispatch; no DB lookup.
 * - Invalidation is fire-and-forget; hooks should not raise exceptions.
 * - Always call invalidation AFTER successful database transaction.
 * - Use specific invalidation (scope/domain) over blanket flush for performance.
 */

if (!defined('CACHE_VERSION')) {
    require_once __DIR__ . '/../config/config.php';
}
require_once __DIR__ . '/cache.php';

// ── Constants ───────────────────────────────────────────────────────────────────

// Domain to affected scopes mapping
const INVALIDATION_MAP = [
    'colony' => ['game_overview', 'game_resources', 'system_payload_base'],
    'fleet' => ['game_overview', 'system_payload_base'],
    'research' => ['research_list'],
    'diplomacy' => ['factions_list', 'faction_government'],
    'diplomacy_agreement' => ['diplomacy_agreements'],
    'economy' => ['game_overview', 'game_resources'],
    'shipyard' => ['shipyard_list'],
    'war' => ['faction_relations', 'war_status'],
    'politics' => ['politics_catalog', 'politics_status'],
    'trade' => ['market_data', 'trade_routes'],
    'building' => ['system_payload_base', 'game_overview'],
    'leader' => ['leaders_list', 'game_overview'],
    'achievement' => ['achievements_list'],
    'faction_relations' => ['factions_list', 'faction_government', 'faction_relations'],
];

const INVALIDATION_HOOKS_PREFIX = 'gq_invalidation_hooks:';

// ── Internal State ─────────────────────────────────────────────────────────────

/** @internal */
function _gq_invalidation_hooks_load(): array {
    if (function_exists('apcu_fetch')) {
        $success = false;
        $hooks = apcu_fetch(INVALIDATION_HOOKS_PREFIX, $success);
        if ($success && is_array($hooks)) {
            return $hooks;
        }
    }
    return [];
}

/** @internal */
function _gq_invalidation_hooks_save(array $hooks): void {
    if (function_exists('apcu_store')) {
        apcu_store(INVALIDATION_HOOKS_PREFIX, $hooks, 86400);
    }
}

// ── Invalidation API ───────────────────────────────────────────────────────────

/**
 * Invalidate a specific scope entry or all entries in a scope.
 *
 * @param string $scope  Scope name ('stars', 'game_overview', etc.)
 * @param array  $params Cache params to invalidate (optional; if empty, invalidates all)
 * @return int           Number of entries removed
 */
function gq_invalidate_scope(string $scope, array $params = []): int {
    if (empty($params)) {
        // Invalidate entire scope
        return gq_cache_flush($scope);
    }

    // Invalidate specific entry
    gq_cache_delete($scope, $params);
    return 1;
}

/**
 * Invalidate all scopes affected by a domain-level change.
 *
 * Example: After a building is upgraded, invalidate('building', $colony_id)
 * will clear cache for all affected scopes (system payload, overview, etc.).
 *
 * @param string $domain     Domain name ('colony', 'fleet', 'diplomacy', etc.)
 * @param int    $entity_id  Entity ID (colony_id, fleet_id, etc.)
 * @return int               Total entries removed across all scopes
 */
function gq_invalidate_domain(string $domain, int $entity_id): int {
    if (!function_exists('gq_cache_flush')) {
        return 0;
    }

    $removed = 0;
    $scopes = INVALIDATION_MAP[$domain] ?? [];

    foreach ($scopes as $scope) {
        $removed += gq_cache_flush($scope);
    }

    // Dispatch hooks for custom invalidation logic
    $hooks = _gq_invalidation_hooks_load();
    $domainHooks = $hooks[$domain] ?? [];
    foreach ($domainHooks as $hookId => $hookData) {
        if (!is_array($hookData)) continue;
        try {
            // Hooks are stored as serialized closures (if APCu supports)
            // or as function names.
            $callable = $hookData['callable'] ?? null;
            if (is_callable($callable)) {
                call_user_func($callable, $entity_id);
            }
        } catch (Throwable $e) {
            error_log(sprintf(
                '[GQ Invalidation] Hook %s for domain %s failed: %s',
                $hookId,
                $domain,
                $e->getMessage()
            ));
        }
    }

    return $removed;
}

/**
 * Invalidate all caches for a specific user.
 *
 * Call this after user-level changes (policy update, economy setting, etc.).
 *
 * @param int $uid        User ID
 * @return int            Total entries removed
 */
function gq_invalidate_user(int $uid): int {
    if (!function_exists('gq_cache_get_raw')) {
        return 0;
    }

    // User-scoped cache keys typically contain the user ID in params
    // We'll clear scopes that are commonly user-specific:
    $userScopes = [
        'game_overview',
        'game_resources',
        'research_list',
        'shipyard_list',
        'achievements_list',
        'politics_status',
        'diplomacy_agreements',
    ];

    $removed = 0;
    foreach ($userScopes as $scope) {
        // Invalidate entries with this user_id
        $entries = gq_cache_index_entries($scope);
        foreach ($entries as $entry) {
            $params = $entry['params'] ?? [];
            if ((int)($params['user_id'] ?? 0) === $uid) {
                $removed += gq_invalidate_scope($scope, $params);
            }
        }
    }

    return $removed;
}

/**
 * Invalidate all caches for a specific system.
 *
 * Call after system-level changes (planet upgrade, colonization, etc.).
 *
 * @param int $galaxy  Galaxy index
 * @param int $system  System index
 * @return int         Total entries removed
 */
function gq_invalidate_system(int $galaxy, int $system): int {
    if (!function_exists('gq_cache_flush')) {
        return 0;
    }

    $removed = 0;
    $systemScopes = ['stars', 'system_payload_base'];

    foreach ($systemScopes as $scope) {
        // Check all entries in the scope
        $entries = gq_cache_index_entries($scope);
        foreach ($entries as $entry) {
            $params = $entry['params'] ?? [];
            // Star chunks and system payloads typically use galaxy/system in params
            if ((int)($params['galaxy'] ?? -1) === $galaxy &&
                (int)($params['system'] ?? -1) === $system) {
                $removed += gq_invalidate_scope($scope, $params);
            }
        }
    }

    return $removed;
}

/**
 * Register a custom invalidation hook for a domain.
 *
 * Hooks are called whenever the domain is invalidated. Useful for custom logic
 * (e.g., invalidating associated caches that don't fit the standard map).
 *
 * Example:
 *   gq_register_invalidation_hook('colony', function($entity_id) {
 *       // Custom invalidation logic
 *       gq_invalidate_scope('custom_projection', ['colony_id' => $entity_id]);
 *   });
 *
 * @param string   $domain     Domain name
 * @param callable $handler    Callback: function($entity_id) : void
 * @param string   $hookId     Unique hook identifier (optional; auto-generated)
 */
function gq_register_invalidation_hook(
    string $domain,
    callable $handler,
    string $hookId = ''
): void {
    if (!function_exists('apcu_store')) {
        return; // Hooks require APCu
    }

    if ($hookId === '') {
        $hookId = uniqid('hook_', true);
    }

    $hooks = _gq_invalidation_hooks_load();
    if (!isset($hooks[$domain])) {
        $hooks[$domain] = [];
    }

    $hooks[$domain][$hookId] = [
        'callable' => $handler,
        'registered_at' => time(),
    ];

    _gq_invalidation_hooks_save($hooks);
}

/**
 * Unregister an invalidation hook.
 *
 * @param string $domain  Domain name
 * @param string $hookId  Hook ID (returned from register_invalidation_hook)
 */
function gq_unregister_invalidation_hook(string $domain, string $hookId): void {
    $hooks = _gq_invalidation_hooks_load();
    if (isset($hooks[$domain][$hookId])) {
        unset($hooks[$domain][$hookId]);
        if (empty($hooks[$domain])) {
            unset($hooks[$domain]);
        }
        _gq_invalidation_hooks_save($hooks);
    }
}

/**
 * List all registered hooks.
 *
 * @return array  Hooks organized by domain
 */
function gq_list_invalidation_hooks(): array {
    return _gq_invalidation_hooks_load();
}

// ── Batch Invalidation (Helper) ────────────────────────────────────────────────

/**
 * Invalidate multiple domains in a single call.
 * Useful after complex actions affecting multiple systems.
 *
 * @param array $invalidations  Array of ['domain' => $domain, 'entity_id' => $id]
 * @return int                  Total entries removed
 */
function gq_invalidate_batch(array $invalidations): int {
    $removed = 0;
    foreach ($invalidations as $inv) {
        $domain = (string)($inv['domain'] ?? '');
        $entity_id = (int)($inv['entity_id'] ?? 0);
        if ($domain === '' || $entity_id <= 0) continue;
        $removed += gq_invalidate_domain($domain, $entity_id);
    }
    return $removed;
}
