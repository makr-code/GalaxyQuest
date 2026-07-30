<?php
/**
 * Cache Diagnostics API – Admin Dashboard Endpoint
 *
 * GET /api/cache_diagnostics.php
 *
 * Provides comprehensive cache metrics and health monitoring.
 * Admin-only access. Useful for performance troubleshooting and tuning.
 *
 * Response includes:
 *   - Cache hit rates per scope
 *   - Entry counts and memory footprint
 *   - Invalidation hook status
 *   - Configuration settings
 *   - Recommendations for optimization
 */

// ──────────────────────────────────────────────────────────────────────────────
// SETUP & VALIDATION
// ──────────────────────────────────────────────────────────────────────────────

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');

// ── Admin Authorization ──────────────────────────────────────────────────────
$uid = require_auth();

// Check if admin (adjust this based on your auth system)
$is_admin = check_user_is_admin($uid);
if (!$is_admin) {
    http_response_code(403);
    json_error('Only administrators can access cache diagnostics', 403);
    return;
}

// ──────────────────────────────────────────────────────────────────────────────
// LOAD MODULES
// ──────────────────────────────────────────────────────────────────────────────

require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/cache_metrics.php';
require_once __DIR__ . '/cache_invalidation.php';

// ──────────────────────────────────────────────────────────────────────────────
// ACTION DISPATCHER
// ──────────────────────────────────────────────────────────────────────────────

$action = strtolower((string)($_GET['action'] ?? 'summary'));

switch ($action) {
    case 'summary':
        only_method('GET');
        output_cache_summary();
        break;

    case 'scope_detail':
        only_method('GET');
        $scope = sanitize_input($_GET['scope'] ?? '');
        if ($scope === '') {
            json_error('scope parameter required');
        }
        output_scope_detail($scope);
        break;

    case 'invalidation_hooks':
        only_method('GET');
        output_invalidation_hooks();
        break;

    case 'system_info':
        only_method('GET');
        output_system_info();
        break;

    case 'clear_scope':
        only_method('POST');
        verify_csrf();
        $scope = sanitize_input($_POST['scope'] ?? '');
        if ($scope === '') {
            json_error('scope parameter required');
        }
        $removed = gq_cache_flush($scope);
        json_ok(['message' => "Cleared $removed entries from scope '$scope'"]);
        break;

    case 'clear_all':
        only_method('POST');
        verify_csrf();
        $confirm = $_POST['confirm'] ?? '';
        if ($confirm !== 'yes') {
            json_error('Confirmation required: pass confirm=yes');
        }
        $removed = gq_cache_flush();
        json_ok(['message' => "Cleared entire cache ($removed entries)"]);
        break;

    case 'reset_metrics':
        only_method('POST');
        verify_csrf();
        $scope = $_POST['scope'] ?? null;
        $cleared = gq_metrics_flush($scope);
        $msg = $scope ? "metrics for scope '$scope'" : 'all metrics';
        json_ok(['message' => "Reset $msg ($cleared entries)"]);
        break;

    default:
        json_error("Unknown action: $action");
}

// ──────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Output comprehensive cache summary dashboard.
 */
function output_cache_summary(): void {
    $telemetry = gq_metrics_export_telemetry();

    // Calculate derived metrics
    $totalRequests = (int)($telemetry['summary']['total_requests'] ?? 0);
    $estimatedTimesSaved = 0;
    if ($totalRequests > 0 && CACHE_ENABLED) {
        // Assuming uncached request = 200ms, cached = 2ms
        $hitsSaved = $telemetry['summary']['total_hits'] * 198;  // ms saved per hit
        $estimatedTimesSaved = round($hitsSaved / 1000 / 60, 1);  // convert to minutes
    }

    // Health scoring
    $hitRate = (float)str_replace('%', '', $telemetry['aggregate_hit_rate']);
    $health = $hitRate >= 85 ? 'EXCELLENT'
        : ($hitRate >= 70 ? 'GOOD'
            : ($hitRate >= 50 ? 'FAIR'
                : 'POOR'));

    $diskUsage = disk_usage_mb(CACHE_DIR);

    json_ok([
        'timestamp' => $telemetry['timestamp'],
        'cache_enabled' => CACHE_ENABLED,
        'cache_version' => CACHE_VERSION,

        'health' => [
            'status' => $health,
            'aggregate_hit_rate' => (float)$telemetry['aggregate_hit_rate'],
            'total_requests' => $totalRequests,
            'total_hits' => (int)($telemetry['summary']['total_hits'] ?? 0),
            'total_misses' => (int)($telemetry['summary']['total_misses'] ?? 0),
        ],

        'performance_impact' => [
            'estimated_time_saved_minutes' => $estimatedTimesSaved,
            'estimated_db_queries_reduced' => round($totalRequests * 0.30),
        ],

        'storage' => [
            'cache_dir' => CACHE_DIR,
            'disk_usage_mb' => $diskUsage,
            'total_payload_bytes' => (int)($telemetry['summary']['total_payload_bytes'] ?? 0),
            'entry_count' => count((array)($telemetry['by_scope'] ?? [])),
        ],

        'top_scopes' => array_slice(
            usort_by_key((array)($telemetry['by_scope'] ?? []), 'hit_rate', SORT_DESC) ?: [],
            0,
            5
        ),

        'recommendations' => generate_recommendations($telemetry),

        'actions' => [
            'clear_scope' => 'POST /api/cache_diagnostics.php?action=clear_scope (params: scope)',
            'clear_all' => 'POST /api/cache_diagnostics.php?action=clear_all (params: confirm=yes)',
            'reset_metrics' => 'POST /api/cache_diagnostics.php?action=reset_metrics (params: scope)',
        ],
    ]);
}

/**
 * Output detailed metrics for a specific scope.
 */
function output_scope_detail(string $scope): void {
    $metrics = gq_metrics_query($scope);

    if (empty($metrics)) {
        json_error("No metrics found for scope: $scope", 404);
        return;
    }

    $hits = (int)($metrics['hits'] ?? 0);
    $misses = (int)($metrics['misses'] ?? 0);
    $total = $hits + $misses;
    $hitRate = $total > 0 ? round(100.0 * $hits / $total, 2) : 0.0;

    $entries = (array)($metrics['entries'] ?? []);
    usort($entries, fn($a, $b) =>
        (($b['hit_count'] ?? 0) + ($b['miss_count'] ?? 0))
        <=>
        (($a['hit_count'] ?? 0) + ($a['miss_count'] ?? 0))
    );

    json_ok([
        'scope' => $scope,
        'aggregate_metrics' => [
            'total_requests' => $total,
            'hits' => $hits,
            'misses' => $misses,
            'hit_rate' => $hitRate . '%',
            'total_payload_bytes' => (int)($metrics['total_payload_bytes'] ?? 0),
        ],
        'timing' => [
            'avg_read_time_ms' => $hits > 0 ? round((float)($metrics['read_time_ms'] ?? 0) / $hits, 2) : 0,
            'avg_write_time_ms' => $misses > 0 ? round((float)($metrics['write_time_ms'] ?? 0) / $misses, 2) : 0,
        ],
        'entries' => array_map(function($entry) {
            $totalAccess = ($entry['hit_count'] ?? 0) + ($entry['miss_count'] ?? 0);
            return [
                'key_hash' => substr((string)($entry['key'] ?? ''), 0, 16),
                'hits' => (int)($entry['hit_count'] ?? 0),
                'misses' => (int)($entry['miss_count'] ?? 0),
                'hit_rate' => $totalAccess > 0 ? round(100.0 * ($entry['hit_count'] ?? 0) / $totalAccess, 1) : 0,
                'size_bytes' => (int)($entry['size_bytes'] ?? 0),
                'age_minutes' => round((time() - (int)($entry['created_at'] ?? time())) / 60, 1),
                'last_hit_age_seconds' => (int)($entry['last_hit'] ?? 0) > 0
                    ? time() - (int)($entry['last_hit'] ?? 0)
                    : null,
            ];
        }, array_slice($entries, 0, 50)),  // Top 50 entries
        'entry_count' => count($entries),
    ]);
}

/**
 * Output registered invalidation hooks.
 */
function output_invalidation_hooks(): void {
    $hooks = gq_list_invalidation_hooks();

    $formatted = [];
    foreach ($hooks as $domain => $domainHooks) {
        $formatted[$domain] = [];
        foreach ((array)$domainHooks as $hookId => $hookData) {
            $formatted[$domain][$hookId] = [
                'registered_at' => (int)($hookData['registered_at'] ?? 0),
                'registered_at_formatted' => date('Y-m-d H:i:s', (int)($hookData['registered_at'] ?? 0)),
            ];
        }
    }

    json_ok([
        'total_domains_with_hooks' => count($formatted),
        'total_hooks' => array_sum(array_map('count', $formatted)),
        'hooks_by_domain' => $formatted,
    ]);
}

/**
 * Output system information and configuration.
 */
function output_system_info(): void {
    $apcuInfo = null;
    if (function_exists('apcu_cache_info')) {
        try {
            $info = apcu_cache_info(false);
            $apcuInfo = [
                'enabled' => true,
                'memory_available' => ini_get('apc.shm_size'),
                'entry_count' => (int)($info['num_entries'] ?? 0),
                'memory_used_bytes' => (int)($info['mem_size'] ?? 0),
                'mem_available_bytes' => (int)($info['avail_mem'] ?? 0),
            ];
        } catch (Throwable) {
            $apcuInfo = ['enabled' => false, 'error' => 'APCu not available'];
        }
    } else {
        $apcuInfo = ['enabled' => false, 'error' => 'APCu extension not loaded'];
    }

    $cacheDir = CACHE_DIR;
    $dirStats = @stat($cacheDir);
    $inodesUsed = $dirStats ? $dirStats['nlink'] : 'N/A';  // Approximation

    json_ok([
        'cache_configuration' => [
            'cache_enabled' => CACHE_ENABLED,
            'cache_version' => CACHE_VERSION,
            'cache_dir' => $cacheDir,
            'cache_dir_writable' => is_writable($cacheDir),
            'cache_ttl_defaults' => [
                'stars' => CACHE_TTL_STARS . ' seconds',
                'system_payload' => CACHE_TTL_SYSTEM_PAYLOAD . ' seconds',
                'factions' => CACHE_TTL_FACTIONS . ' seconds',
                'overview' => CACHE_TTL_OVERVIEW . ' seconds',
                'default' => CACHE_TTL_DEFAULT . ' seconds',
            ],
        ],
        'apcu' => $apcuInfo,
        'disk_cache' => [
            'directory' => $cacheDir,
            'directory_exists' => is_dir($cacheDir),
            'disk_usage_mb' => disk_usage_mb($cacheDir),
            'approximate_file_count' => $inodesUsed,
        ],
        'php_info' => [
            'php_version' => PHP_VERSION,
            'memory_limit' => ini_get('memory_limit'),
            'max_execution_time' => ini_get('max_execution_time'),
        ],
    ]);
}

// ──────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calculate total disk usage of cache directory in MB.
 */
function disk_usage_mb(string $dir): float {
    if (!is_dir($dir)) {
        return 0.0;
    }
    $total = 0;
    foreach (glob($dir . DIRECTORY_SEPARATOR . '*') as $file) {
        if (is_file($file)) {
            $total += filesize($file) ?? 0;
        }
    }
    return round($total / 1024 / 1024, 2);
}

/**
 * Sort array by key descending.
 */
function usort_by_key(array $arr, string $key, int $sort = SORT_DESC): array {
    usort($arr, fn($a, $b) =>
        $sort === SORT_DESC
            ? (($b[$key] ?? 0) <=> ($a[$key] ?? 0))
            : (($a[$key] ?? 0) <=> ($b[$key] ?? 0))
    );
    return $arr;
}

/**
 * Generate optimization recommendations based on current metrics.
 */
function generate_recommendations(array $telemetry): array {
    $recommendations = [];
    $hitRate = (float)str_replace('%', '', $telemetry['aggregate_hit_rate']);

    if ($hitRate < 50) {
        $recommendations[] = [
            'level' => 'CRITICAL',
            'message' => 'Hit rate extremely low (<50%). Check cache is enabled and metrics are recording.',
            'action' => 'Verify CACHE_ENABLED=true and cache_metrics.php is loaded',
        ];
    } elseif ($hitRate < 70) {
        $recommendations[] = [
            'level' => 'WARNING',
            'message' => 'Hit rate below target (70%). Consider increasing TTLs or checking invalidation strategy.',
            'action' => 'Review scope_detail for low-hit-rate scopes and adjust CACHE_TTL_* settings',
        ];
    }

    $diskUsage = disk_usage_mb(CACHE_DIR);
    if ($diskUsage > 500) {
        $recommendations[] = [
            'level' => 'WARNING',
            'message' => "Disk cache growing large ($diskUsage MB). Consider pruning or increasing TTLs.",
            'action' => 'Run: gq_cache_flush() to clear old entries',
        ];
    }

    $scopes = (array)($telemetry['by_scope'] ?? []);
    $lowHitScopes = array_filter($scopes, fn($s) => ($s['hit_rate'] ?? 0) < 30);
    if (!empty($lowHitScopes)) {
        $scopeNames = implode(', ', array_keys(array_slice($lowHitScopes, 0, 3)));
        $recommendations[] = [
            'level' => 'INFO',
            'message' => "Low hit rates in scopes: $scopeNames",
            'action' => 'Use /api/cache_diagnostics.php?action=scope_detail&scope=<name> to investigate',
        ];
    }

    if (empty($recommendations)) {
        $recommendations[] = [
            'level' => 'OK',
            'message' => 'Cache system operating normally',
            'action' => 'Continue monitoring and optimize further scopes',
        ];
    }

    return $recommendations;
}

/**
 * Check if user is admin (customize based on your auth system).
 */
function check_user_is_admin(int $uid): bool {
    global $db;
    // Adjust this query based on your user/auth table schema
    try {
        $stmt = $db->prepare('SELECT is_admin FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$uid]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return (bool)($row['is_admin'] ?? false);
    } catch (Throwable) {
        return false;
    }
}
