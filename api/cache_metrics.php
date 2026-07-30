<?php
/**
 * GalaxyQuest – Cache Metrics & Monitoring
 *
 * Tracks cache hit/miss rates, performance telemetry, and provides diagnostics
 * for cache effectiveness across all scopes and endpoints.
 *
 * ── API ────────────────────────────────────────────────────────────────────────
 *   gq_metrics_record_hit($scope, $params, $hit)    Record cache access (hit/miss)
 *   gq_metrics_query($scope = null)                 Retrieve aggregate metrics
 *   gq_metrics_flush($scope = null)                 Clear metrics (usually daily)
 *   gq_metrics_export_telemetry()                   JSON export for monitoring
 *
 * ── Data Structure ─────────────────────────────────────────────────────────────
 * Metrics are stored in APCu and periodically flushed to disk for persistence.
 * Each scope maintains:
 *   {
 *     "hits": int,
 *     "misses": int,
 *     "total_payload_bytes": int,
 *     "read_time_ms": float,
 *     "write_time_ms": float,
 *     "last_reset": unix_timestamp,
 *     "entries": [
 *       {
 *         "key": "sha256_hash",
 *         "hit_count": int,
 *         "miss_count": int,
 *         "size_bytes": int,
 *         "created_at": unix_timestamp,
 *         "last_hit": unix_timestamp
 *       }
 *     ]
 *   }
 */

if (!defined('CACHE_VERSION')) {
    require_once __DIR__ . '/../config/config.php';
}

define('_GQ_METRICS_PREFIX', 'gq_metrics:');
define('_GQ_METRICS_PERSIST_DIR', rtrim(CACHE_DIR, '/\\') . DIRECTORY_SEPARATOR . 'metrics');
define('_GQ_METRICS_MAX_ENTRIES_PER_SCOPE', 1000); // Prevent unbounded growth

// ── Internal Helpers ───────────────────────────────────────────────────────────

/** @internal */
function _gq_metrics_init_dir(): void {
    static $done = false;
    if ($done) return;
    $dir = _GQ_METRICS_PERSIST_DIR;
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        error_log('[GQ Metrics] Konnte Verzeichnis nicht anlegen: ' . $dir);
    }
    $done = true;
}

/** @internal */
function _gq_metrics_persist_file(string $scope): string {
    $safe = preg_replace('/[^a-z0-9_]/i', '_', $scope);
    return _GQ_METRICS_PERSIST_DIR . DIRECTORY_SEPARATOR . $safe . '.metrics.json';
}

/** @internal */
function _gq_metrics_load(string $scope): array {
    // Try APCu first
    if (function_exists('apcu_fetch')) {
        $success = false;
        $data = apcu_fetch(_GQ_METRICS_PREFIX . $scope, $success);
        if ($success && is_array($data)) {
            return $data;
        }
    }

    // Fall back to file
    $file = _gq_metrics_persist_file($scope);
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
    }

    // Initialize fresh
    return [
        'scope' => $scope,
        'hits' => 0,
        'misses' => 0,
        'total_payload_bytes' => 0,
        'read_time_ms' => 0.0,
        'write_time_ms' => 0.0,
        'last_reset' => time(),
        'entries' => [],
    ];
}

/** @internal */
function _gq_metrics_save(string $scope, array $metrics): void {
    // Store in APCu for quick access
    if (function_exists('apcu_store')) {
        apcu_store(_GQ_METRICS_PREFIX . $scope, $metrics, 86400); // 24h TTL
    }

    // Persist to disk
    _gq_metrics_init_dir();
    $file = _gq_metrics_persist_file($scope);
    $tmp = $file . '.tmp.' . getmypid();
    $json = json_encode($metrics, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) return;
    if (file_put_contents($tmp, $json, LOCK_EX) !== false) {
        @rename($tmp, $file);
    } else {
        @unlink($tmp);
    }
}

/** @internal */
function _gq_metrics_prune_entries(array &$entries): void {
    if (count($entries) > _GQ_METRICS_MAX_ENTRIES_PER_SCOPE) {
        // Remove entries with lowest total impact (hit_count + miss_count)
        usort($entries, static fn($a, $b) =>
            (($a['hit_count'] ?? 0) + ($a['miss_count'] ?? 0)) <=>
            (($b['hit_count'] ?? 0) + ($b['miss_count'] ?? 0))
        );
        $entries = array_slice($entries, -_GQ_METRICS_MAX_ENTRIES_PER_SCOPE);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record a cache access (hit or miss).
 *
 * @param string $scope     Scope name (e.g., 'stars', 'game_overview')
 * @param array  $params    Cache key parameters
 * @param bool   $hit       true for hit, false for miss
 * @param int    $bytes     Payload size in bytes (optional)
 * @param float  $time_ms   Time taken to read/write (optional)
 */
function gq_metrics_record_hit(
    string $scope,
    array $params,
    bool $hit,
    int $bytes = 0,
    float $time_ms = 0.0
): void {
    if (!function_exists('gq_cache_get_raw')) {
        return; // Cache system not available
    }

    $metrics = _gq_metrics_load($scope);
    $key = hash('sha256', json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    if ($hit) {
        $metrics['hits']++;
        $metrics['read_time_ms'] += $time_ms;
    } else {
        $metrics['misses']++;
        $metrics['write_time_ms'] += $time_ms;
    }

    if ($bytes > 0) {
        $metrics['total_payload_bytes'] += $bytes;
    }

    // Update or create entry
    $found = false;
    foreach ($metrics['entries'] as &$entry) {
        if ((string)($entry['key'] ?? '') === $key) {
            if ($hit) {
                $entry['hit_count'] = ($entry['hit_count'] ?? 0) + 1;
            } else {
                $entry['miss_count'] = ($entry['miss_count'] ?? 0) + 1;
            }
            $entry['last_hit'] = time();
            $found = true;
            break;
        }
    }
    unset($entry);

    if (!$found) {
        $metrics['entries'][] = [
            'key' => $key,
            'hit_count' => $hit ? 1 : 0,
            'miss_count' => $hit ? 0 : 1,
            'size_bytes' => $bytes,
            'created_at' => time(),
            'last_hit' => $hit ? time() : 0,
        ];
    }

    _gq_metrics_prune_entries($metrics['entries']);
    _gq_metrics_save($scope, $metrics);
}

/**
 * Query cache metrics for a specific scope or all scopes.
 *
 * @param string|null $scope  Scope name or null for all scopes
 * @return array              Metrics data
 */
function gq_metrics_query(?string $scope = null): array {
    if ($scope !== null) {
        return _gq_metrics_load($scope);
    }

    // Aggregate all scopes
    $dir = _GQ_METRICS_PERSIST_DIR;
    if (!is_dir($dir)) {
        return ['total_scopes' => 0, 'aggregate_hits' => 0, 'aggregate_misses' => 0, 'scopes' => []];
    }

    $aggregate = [
        'total_scopes' => 0,
        'aggregate_hits' => 0,
        'aggregate_misses' => 0,
        'total_payload_bytes' => 0,
        'scopes' => [],
    ];

    foreach (glob($dir . DIRECTORY_SEPARATOR . '*.metrics.json') ?: [] as $file) {
        $raw = @file_get_contents($file);
        if (!is_string($raw)) continue;
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) continue;

        $scope = (string)($decoded['scope'] ?? basename($file, '.metrics.json'));
        $aggregate['total_scopes']++;
        $aggregate['aggregate_hits'] += (int)($decoded['hits'] ?? 0);
        $aggregate['aggregate_misses'] += (int)($decoded['misses'] ?? 0);
        $aggregate['total_payload_bytes'] += (int)($decoded['total_payload_bytes'] ?? 0);
        $aggregate['scopes'][$scope] = $decoded;
    }

    return $aggregate;
}

/**
 * Calculate cache hit rate for a scope.
 *
 * @param string|null $scope
 * @return float  Hit rate as percentage (0–100)
 */
function gq_metrics_hit_rate(?string $scope = null): float {
    $metrics = gq_metrics_query($scope);

    if ($scope === null) {
        $hits = (int)($metrics['aggregate_hits'] ?? 0);
        $misses = (int)($metrics['aggregate_misses'] ?? 0);
    } else {
        $hits = (int)($metrics['hits'] ?? 0);
        $misses = (int)($metrics['misses'] ?? 0);
    }

    $total = $hits + $misses;
    if ($total === 0) return 0.0;

    return round(100.0 * $hits / $total, 2);
}

/**
 * Clear metrics for a scope or all scopes.
 *
 * @param string|null $scope  Scope name or null for all
 * @return int                Number of scopes cleared
 */
function gq_metrics_flush(?string $scope = null): int {
    $cleared = 0;

    // Clear APCu
    if (function_exists('apcu_delete')) {
        if ($scope !== null) {
            if (apcu_delete(_GQ_METRICS_PREFIX . $scope)) {
                $cleared++;
            }
        } else {
            try {
                $info = apcu_cache_info(false);
                foreach ($info['cache_list'] ?? [] as $entry) {
                    $key = (string)($entry['info'] ?? $entry['key'] ?? '');
                    if (str_starts_with($key, _GQ_METRICS_PREFIX)) {
                        apcu_delete($key);
                        $cleared++;
                    }
                }
            } catch (Throwable) {
                // APCu not available
            }
        }
    }

    // Clear files
    $dir = _GQ_METRICS_PERSIST_DIR;
    if (!is_dir($dir)) return $cleared;

    if ($scope !== null) {
        $file = _gq_metrics_persist_file($scope);
        if (is_file($file)) {
            @unlink($file);
            $cleared++;
        }
    } else {
        foreach (glob($dir . DIRECTORY_SEPARATOR . '*.metrics.json') ?: [] as $file) {
            @unlink($file);
            $cleared++;
        }
    }

    return $cleared;
}

/**
 * Export comprehensive telemetry report.
 *
 * @return array  Telemetry data suitable for JSON response
 */
function gq_metrics_export_telemetry(): array {
    $metrics = gq_metrics_query();
    $hitRate = gq_metrics_hit_rate();

    return [
        'timestamp' => time(),
        'cache_enabled' => CACHE_ENABLED,
        'cache_version' => CACHE_VERSION,
        'aggregate_hit_rate' => $hitRate . '%',
        'summary' => [
            'total_scopes' => (int)($metrics['total_scopes'] ?? 0),
            'total_hits' => (int)($metrics['aggregate_hits'] ?? 0),
            'total_misses' => (int)($metrics['aggregate_misses'] ?? 0),
            'total_requests' => (int)($metrics['aggregate_hits'] ?? 0) + (int)($metrics['aggregate_misses'] ?? 0),
            'total_payload_bytes' => (int)($metrics['total_payload_bytes'] ?? 0),
        ],
        'by_scope' => array_map(static function($scope_data) {
            $hits = (int)($scope_data['hits'] ?? 0);
            $misses = (int)($scope_data['misses'] ?? 0);
            $total = $hits + $misses;
            return [
                'scope' => (string)($scope_data['scope'] ?? 'unknown'),
                'hits' => $hits,
                'misses' => $misses,
                'total' => $total,
                'hit_rate' => $total > 0 ? round(100.0 * $hits / $total, 2) : 0.0,
                'payload_bytes' => (int)($scope_data['total_payload_bytes'] ?? 0),
                'entry_count' => count((array)($scope_data['entries'] ?? [])),
            ];
        }, (array)($metrics['scopes'] ?? [])),
    ];
}
