<?php
/**
 * IMPLEMENTATION GUIDE – Adding Cache to Critical Endpoints
 *
 * This file contains tested patterns and ready-to-use code snippets
 * for implementing cache in high-impact endpoints.
 *
 * Start with these endpoints in order:
 * 1. economy.php (complex but high-reward)
 * 2. fleet.php (high-frequency reads)
 * 3. war.php (frequent strategic queries)
 * 4. politics.php (static data, easy win)
 * 5. diplomacy.php (user-specific, moderate complexity)
 */

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 1: Simple User-Scoped Cache with NULL-Check
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Example: /api/diplomacy.php?action=list
 *
 * GET request returning list of user's faction agreements.
 * Normally computed by querying diplomacy table.
 *
 * IMPLEMENTATION STEPS:
 * 1. After require_auth() and $uid = $_SESSION['user_id']
 * 2. Define cache scope and key
 * 3. Try cache get before DB query
 * 4. On miss: perform query, cache result, return
 */
function example_diplomacy_list_cached(PDO $db, int $uid): void {
    require_once __DIR__ . '/cache.php';

    // 1. Define scope and key
    $cacheScope = 'diplomacy_agreements';
    $cacheKey = ['user_id' => $uid];
    $cacheTTL = 60;  // 1 minute

    // 2. Try cache first
    $cached = gq_cache_get($cacheScope, $cacheKey);
    if ($cached !== null) {
        json_ok($cached);
        return;
    }

    // 3. Cache miss: compute
    $stmt = $db->prepare(
        'SELECT fa.id, fa.faction_id, fa.agreement_type, fa.status, fa.expires_at
         FROM faction_agreements fa
         WHERE fa.user_id = ?
         ORDER BY fa.created_at DESC'
    );
    $stmt->execute([$uid]);
    $agreements = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 4. Store and return
    gq_cache_set($cacheScope, $cacheKey, $agreements, $cacheTTL);
    json_ok($agreements);
}

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 2: User+Parameter Scoping (Economy Endpoints)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Example: /api/economy.php?action=get_overview&colony_id=42
 *
 * GET request returning economy snapshot for a specific colony.
 * Cache key must include both user_id AND colony_id to prevent
 * caching cross-contamination between users/colonies.
 *
 * IMPLEMENTATION STEPS:
 * 1. Validate parameters (colony_id, etc.)
 * 2. Verify user owns colony (authorization)
 * 3. Build multi-parameter cache key
 * 4. Try cache
 * 5. On miss: compute overview, cache with short TTL, return
 */
function example_economy_overview_cached(PDO $db, int $uid, int $colony_id): void {
    require_once __DIR__ . '/cache.php';

    // 1. Validate and authorize
    $stmt = $db->prepare('SELECT user_id FROM colonies WHERE id = ?');
    $stmt->execute([$colony_id]);
    $colony = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$colony || $colony['user_id'] != $uid) {
        json_error('Colony not found or not owned by user', 404);
        return;
    }

    // 2. Build multi-parameter cache key
    $cacheScope = 'economy_overview';
    $cacheKey = [
        'user_id' => $uid,
        'colony_id' => $colony_id,
    ];
    $cacheTTL = 30;  // 30 seconds (production changes frequently)

    // 3. Try cache
    $cached = gq_cache_get($cacheScope, $cacheKey);
    if ($cached !== null) {
        json_ok($cached);
        return;
    }

    // 4. Cache miss: compute overview
    $overview = [
        'colony_id' => $colony_id,
        'buildings' => fetch_colony_buildings($db, $colony_id),
        'population' => fetch_colony_population($db, $colony_id),
        'production' => calculate_colony_production($db, $colony_id),
        'storage' => fetch_storage_levels($db, $colony_id),
        'satisfaction_index' => calculate_satisfaction($db, $colony_id),
    ];

    // 5. Cache and return
    gq_cache_set($cacheScope, $cacheKey, $overview, $cacheTTL);
    json_ok($overview);
}

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 3: Global Static Data Cache (Politics, Glossary)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Example: /api/politics.php?action=catalog
 *
 * GET request returning complete catalog of species/governments/civics.
 * This is FULLY STATIC data (only changes on code deploy).
 * Cache with very long TTL and empty params (identical for all users).
 *
 * IMPLEMENTATION STEPS:
 * 1. No params needed (data is identical for everyone)
 * 2. Try cache with empty key
 * 3. On miss: return hardcoded catalog data, cache for 7 days
 */
function example_politics_catalog_cached(): void {
    require_once __DIR__ . '/cache.php';

    // 1. No user-specific params needed
    $cacheScope = 'politics_catalog';
    $cacheKey = [];  // Empty = "this is global data"
    $cacheTTL = 604800;  // 7 days

    // 2. Try cache
    $cached = gq_cache_get($cacheScope, $cacheKey);
    if ($cached !== null) {
        json_ok($cached);
        return;
    }

    // 3. Cache miss: return catalog
    $catalog = [
        'species' => [
            ['species_key' => 'adaptive_humans', 'name' => 'Adaptive Humans', ...],
            ['species_key' => 'silicon_collective', 'name' => 'Silicon Collective', ...],
            // ... more species
        ],
        'governments' => [
            ['government_key' => 'stellar_republic', 'name' => 'Stellar Republic', ...],
            ['government_key' => 'synthetic_consensus', 'name' => 'Synthetic Consensus', ...],
            // ... more governments
        ],
        'civics' => [
            ['civic_key' => 'meritocracy', 'name' => 'Meritocracy', ...],
            ['civic_key' => 'militarism', 'name' => 'Militarism', ...],
            // ... more civics
        ],
    ];

    // 4. Cache and return
    gq_cache_set($cacheScope, $cacheKey, $catalog, $cacheTTL);
    json_ok($catalog);
}

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 4: Binary Payload Cache (Fleet Data, System Details)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Example: /api/fleet.php?action=list (binary format response)
 *
 * GET request returning binary-encoded fleet list.
 * Use gq_cache_get_raw/set_raw to avoid JSON serialization overhead.
 * Important: cache should store the already-encoded binary, not decode/recode.
 *
 * IMPLEMENTATION STEPS:
 * 1. Try cache_get_raw
 * 2. On hit: set binary headers, echo cached bytes, exit
 * 3. On miss: build payload, encode to binary, cache raw bytes, echo
 */
function example_fleet_list_binary_cached(PDO $db, int $uid): void {
    require_once __DIR__ . '/cache.php';
    require_once __DIR__ . '/compression-v3.php';  // Assume binary encoder available

    $cacheScope = 'fleet_list_binary';
    $cacheKey = ['user_id' => $uid];
    $cacheTTL = 10;  // 10 seconds

    // 1. Try cache (raw bytes)
    $cachedBytes = gq_cache_get_raw($cacheScope, $cacheKey);
    if ($cachedBytes !== null) {
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . strlen($cachedBytes));
        echo $cachedBytes;
        return;
    }

    // 2. Cache miss: fetch and encode
    $stmt = $db->prepare('SELECT * FROM fleets WHERE user_id = ? ORDER BY id');
    $stmt->execute([$uid]);
    $fleets = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Encode to binary (V3 compression)
    $encoded = compress_v3([
        'version' => 3,
        'user_id' => $uid,
        'fleets' => $fleets,
        'timestamp' => time(),
    ]);

    // 4. Cache raw bytes
    gq_cache_set_raw($cacheScope, $cacheKey, $encoded, $cacheTTL);

    // 5. Stream to client
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . strlen($encoded));
    echo $encoded;
}

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 5: Conditional Cache with Invalidation Hooks
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Example: /api/war.php?action=get_status&war_id=X
 *
 * GET request returning current war status with frequent updates.
 * Uses event-driven invalidation: when war state changes (fleet combat,
 * peace offer accepted), invalidation hook clears this cache.
 *
 * IMPLEMENTATION STEPS:
 * 1. Load cache_invalidation module at startup
 * 2. Implement cache get/set with normal TTL
 * 3. In war mutation endpoints, call gq_invalidate_domain('war', $war_id)
 * 4. Register invalidation hooks (optional advanced pattern)
 */

// In war.php at module level:
require_once __DIR__ . '/cache_invalidation.php';

function example_war_get_status_cached(PDO $db, int $uid, int $war_id): void {
    require_once __DIR__ . '/cache.php';

    // 1. Validate user is participant
    $stmt = $db->prepare(
        'SELECT * FROM wars WHERE id = ? AND (attacker_user_id = ? OR defender_user_id = ?)'
    );
    $stmt->execute([$war_id, $uid, $uid]);
    $war = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$war) {
        json_error('War not found or access denied', 404);
        return;
    }

    // 2. Multi-parameter key includes both user and war
    $cacheScope = 'war_status';
    $cacheKey = [
        'user_id' => $uid,
        'war_id' => $war_id,
    ];
    $cacheTTL = 20;  // 20 seconds (war state is volatile)

    // 3. Try cache
    $cached = gq_cache_get($cacheScope, $cacheKey);
    if ($cached !== null) {
        json_ok($cached);
        return;
    }

    // 4. Cache miss: compute status
    $status = [
        'war_id' => $war_id,
        'attacker_user_id' => $war['attacker_user_id'],
        'defender_user_id' => $war['defender_user_id'],
        'status' => $war['status'],
        'exhaustion_attacker' => (float)$war['exhaustion_att'],
        'exhaustion_defender' => (float)$war['exhaustion_def'],
        'goals' => fetch_war_goals($db, $war_id),
        'recent_battles' => fetch_recent_battles($db, $war_id, 10),
        'peace_offers' => fetch_peace_offers($db, $war_id),
    ];

    // 5. Cache and return
    gq_cache_set($cacheScope, $cacheKey, $status, $cacheTTL);
    json_ok($status);
}

// In war mutation endpoints (declare_war, offer_peace, etc.):
function declare_war_with_cache_invalidation(PDO $db, int $uid, int $target_uid): void {
    // ... perform war declaration logic ...

    // SUCCESS: Invalidate all affected caches
    gq_invalidate_domain('war', $new_war_id);
    // This clears: war_status, war_list, faction_relations, etc.
}

// ──────────────────────────────────────────────────────────────────────────────
// PATTERN 6: Metrics Integration (Automatic Performance Tracking)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Optionally integrate metrics tracking to monitor cache effectiveness.
 * Call gq_metrics_record_hit() after every cache operation.
 * This creates a performance dashboard showing hit rates per endpoint.
 */
function example_with_metrics(PDO $db, int $uid): void {
    require_once __DIR__ . '/cache.php';
    require_once __DIR__ . '/cache_metrics.php';

    $cacheScope = 'example_data';
    $cacheKey = ['user_id' => $uid];
    $cacheTTL = 60;

    $startTime = microtime(true);

    // Try cache
    $cached = gq_cache_get($cacheScope, $cacheKey);
    $readTime = (microtime(true) - $startTime) * 1000;  // ms

    if ($cached !== null) {
        // HIT: Record metrics
        gq_metrics_record_hit($cacheScope, $cacheKey, true, strlen(json_encode($cached)), $readTime);
        json_ok($cached);
        return;
    }

    // MISS: Compute
    $data = compute_example_data($db, $uid);

    $writeTime = (microtime(true) - $startTime) * 1000;

    // Store
    gq_cache_set($cacheScope, $cacheKey, $data, $cacheTTL);

    // MISS: Record metrics
    gq_metrics_record_hit($cacheScope, $cacheKey, false, strlen(json_encode($data)), $writeTime);

    json_ok($data);
}

// Query metrics dashboard:
// $telemetry = gq_metrics_export_telemetry();
// Returns: {aggregate_hit_rate: "87.5%", by_scope: {...}, ...}

// ──────────────────────────────────────────────────────────────────────────────
// QUICK REFERENCE: Common Cache Keys
// ──────────────────────────────────────────────────────────────────────────────

/*
Global (identical for all users):
  []                                      // Empty = completely static
  ['param' => 'value']                    // Static but parameterized

User-Scoped:
  ['user_id' => $uid]                    // User-level data
  ['user_id' => $uid, 'colony_id' => $c] // User + specific entity
  ['user_id' => $uid, 'fleet_id' => $f]  // User + fleet

System-Scoped:
  ['galaxy' => $g, 'system' => $s]       // System-wide data
  ['galaxy' => $g]                       // Galaxy-wide

Parameterized Global:
  ['term' => 'white_dwarf']              // Glossary term
  ['good_type' => 'metal']               // Market prices
  ['war_id' => $id]                      // War (global, not user-scoped!)
*/

// ──────────────────────────────────────────────────────────────────────────────
// CHECKLIST: Before Deploying Cache to Production
// ──────────────────────────────────────────────────────────────────────────────

/*
☐ Cache key includes all user-scoped parameters (user_id, colony_id, etc.)
☐ No user-sensitive data cached (Fog-of-War, private messages, passwords)
☐ TTL is reasonable for data freshness (not too long = stale, not too short = no benefit)
☐ Invalidation hook registered in mutation endpoints
☐ Tested cache miss scenario (clear cache manually, verify recompute)
☐ Tested cache invalidation (trigger mutation, verify cache cleared)
☐ Metrics enabled and showing reasonable hit rates (>70% is good)
☐ No performance regression compared to uncached version
☐ Disk cache directory writable and has sufficient free space (>1GB for typical install)
☐ APCu size sufficient for APCu tier (check apc.shm_size >= 128M for production)
*/
