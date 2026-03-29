<?php
/**
 * Opt-in performance telemetry ingestion endpoint.
 *
 * POST /api/perf_telemetry.php?action=ingest
 * Body:
 * {
 *   "opt_in": true,
 *   "source": "galaxy",
 *   "reason": "interval",
 *   "metrics": { ... }
 * }
 */
require_once __DIR__ . '/helpers.php';

$action = (string)($_GET['action'] ?? 'ingest');
$retentionDays = max(1, (int)($_GET['retention_days'] ?? 7));
$maxFileMb = max(1, min(64, (int)($_GET['max_file_mb'] ?? 8)));
$maxFileBytes = $maxFileMb * 1024 * 1024;
$maxShardsPerDay = max(1, min(50, (int)($_GET['max_shards'] ?? 20)));

if ($action === 'recent') {
    only_method('GET');
    $uid = require_auth();
    $db = get_db();
    $isAdmin = is_admin_user($db, $uid);

    $limit = max(1, min(300, (int)($_GET['limit'] ?? 50)));
    $sourceRaw = strtolower(trim((string)($_GET['source'] ?? '')));
    $source = in_array($sourceRaw, ['galaxy', 'auth', 'system', 'other'], true) ? $sourceRaw : '';
    $targetUser = $isAdmin
        ? max(0, (int)($_GET['user_id'] ?? 0))
        : $uid;

    $events = telemetry_read_recent_events($limit * 4, [
        'source' => $source,
        'user_id' => $targetUser,
    ]);
    telemetry_prune_old_files($retentionDays);
    if (count($events) > $limit) {
        $events = array_slice($events, 0, $limit);
    }

    json_ok([
        'action' => 'recent',
        'count' => count($events),
        'limit' => $limit,
        'source' => $source ?: null,
        'user_id' => $targetUser > 0 ? $targetUser : null,
        'events' => $events,
    ]);
}

if ($action === 'summary') {
    only_method('GET');
    $uid = require_auth();
    $db = get_db();
    $isAdmin = is_admin_user($db, $uid);

    $minutes = max(5, min(24 * 60, (int)($_GET['minutes'] ?? 60)));
    $sourceRaw = strtolower(trim((string)($_GET['source'] ?? '')));
    $source = in_array($sourceRaw, ['galaxy', 'auth', 'system', 'other'], true) ? $sourceRaw : '';
    $targetUser = $isAdmin
        ? max(0, (int)($_GET['user_id'] ?? 0))
        : $uid;

    $events = telemetry_read_recent_events(5000, [
        'source' => $source,
        'user_id' => $targetUser,
    ]);
    telemetry_prune_old_files($retentionDays);
    $cutoffMs = (int)round((microtime(true) - ($minutes * 60)) * 1000);
    $events = array_values(array_filter($events, static function(array $ev) use ($cutoffMs): bool {
        return (int)($ev['ts_ms'] ?? 0) >= $cutoffMs;
    }));

    $summary = telemetry_build_summary($events);
    json_ok([
        'action' => 'summary',
        'minutes' => $minutes,
        'count' => count($events),
        'source' => $source ?: null,
        'user_id' => $targetUser > 0 ? $targetUser : null,
        'summary' => $summary,
        'storage' => telemetry_storage_stats($retentionDays, $maxFileMb, $maxShardsPerDay),
    ]);
}

if ($action === 'ingest') {
    only_method('POST');
    $uid = require_auth();
    $body = get_json_body();

    $optIn = ($body['opt_in'] ?? false) === true;
    if (!$optIn) {
        json_error('Telemetry not opted in', 400);
    }

    $source = strtolower(trim((string)($body['source'] ?? 'galaxy')));
    if (!in_array($source, ['galaxy', 'auth', 'system', 'other'], true)) {
        $source = 'other';
    }

    $reason = trim((string)($body['reason'] ?? 'interval'));
    if ($reason === '') {
        $reason = 'interval';
    }
    $reason = substr($reason, 0, 64);

    $metricsIn = is_array($body['metrics'] ?? null) ? $body['metrics'] : [];
    $metrics = [];

    $numericFields = [
        'rawStars',
        'visibleStars',
        'clusterCount',
        'targetPoints',
        'densityRatio',
        'pixelRatio',
        'cameraDistance',
        'instancingCandidates',
        'fps',
        'frameTimeMs',
        'drawCalls',
        'triangles',
    ];
    foreach ($numericFields as $field) {
        if (!array_key_exists($field, $metricsIn)) continue;
        $n = NumberOrNull($metricsIn[$field]);
        if ($n !== null) {
            $metrics[$field] = $n;
        }
    }

    $stringFields = [
        'densityMode',
        'lodProfile',
        'qualityProfile',
        'lightRig',
    ];
    foreach ($stringFields as $field) {
        if (!array_key_exists($field, $metricsIn)) continue;
        $v = trim((string)$metricsIn[$field]);
        if ($v !== '') {
            $metrics[$field] = substr($v, 0, 64);
        }
    }

    $event = [
        'ts_ms' => (int)round(microtime(true) * 1000),
        'user_id' => (int)$uid,
        'source' => $source,
        'reason' => $reason,
        'metrics' => $metrics,
        'client' => [
            'app_version' => substr((string)($body['app_version'] ?? ''), 0, 64),
            'assets_manifest_version' => max(0, (int)($body['assets_manifest_version'] ?? 0)),
            'render_schema_version' => max(0, (int)($body['render_schema_version'] ?? 0)),
        ],
    ];

    $line = json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($line)) {
        json_error('Failed to encode telemetry event', 500);
    }

    $dir = telemetry_dir();
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) {
        json_error('Telemetry storage unavailable', 500);
    }

    $date = gmdate('Y-m-d');
    $target = telemetry_resolve_target_file($date, $maxFileBytes, $maxShardsPerDay);
    $file = $target['file'];
    $ok = @file_put_contents($file, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
    if ($ok === false) {
        json_error('Failed to persist telemetry', 500);
    }
    telemetry_prune_old_files($retentionDays);

    json_ok([
        'action' => 'ingest',
        'accepted' => true,
        'event_ts_ms' => $event['ts_ms'],
        'retention_days' => $retentionDays,
        'max_file_mb' => $maxFileMb,
        'shard' => $target['shard'],
    ]);
}

json_error('Unknown action', 404);

function telemetry_dir(): string
{
    return rtrim((string)CACHE_DIR, '/\\') . DIRECTORY_SEPARATOR . 'telemetry';
}

function telemetry_prune_old_files(int $retentionDays = 7): void
{
    $days = max(1, $retentionDays);
    $dir = telemetry_dir();
    if (!is_dir($dir)) return;

    $files = telemetry_list_files($dir);
    if (!is_array($files) || !$files) return;

    $cutoffTs = time() - ($days * 86400);
    foreach ($files as $file) {
        if (!is_string($file) || !is_file($file)) continue;
        $mtime = @filemtime($file);
        if ($mtime !== false && (int)$mtime < $cutoffTs) {
            @unlink($file);
        }
    }
}

/**
 * @return array<int,string>
 */
function telemetry_list_files(string $dir): array
{
    $files = glob($dir . DIRECTORY_SEPARATOR . 'perf_*.jsonl');
    return is_array($files) ? $files : [];
}

/**
 * @return array{file:string,shard:int}
 */
function telemetry_resolve_target_file(string $date, int $maxFileBytes, int $maxShardsPerDay): array
{
    $dir = telemetry_dir();
    $maxBytes = max(1024 * 256, $maxFileBytes);
    $maxShards = max(1, $maxShardsPerDay);

    $base = $dir . DIRECTORY_SEPARATOR . 'perf_' . $date;
    $defaultFile = $base . '.jsonl';
    $files = glob($base . '*.jsonl');
    $files = is_array($files) ? $files : [];

    if (!$files) {
        return ['file' => $defaultFile, 'shard' => 0];
    }

    $bestShard = 0;
    $bestFile = $defaultFile;
    $bestShardSeen = 0;

    foreach ($files as $f) {
        if (!is_file($f)) continue;
        $name = basename($f);
        $shard = 0;
        if (preg_match('/^perf_' . preg_quote($date, '/') . '-(\d+)\.jsonl$/', $name, $m)) {
            $shard = (int)$m[1];
        } elseif ($name !== ('perf_' . $date . '.jsonl')) {
            continue;
        }

        $bestShardSeen = max($bestShardSeen, $shard);
        $size = @filesize($f);
        if ($size !== false && (int)$size < $maxBytes) {
            if ($shard >= $bestShard) {
                $bestShard = $shard;
                $bestFile = $f;
            }
        }
    }

    // If we found a writable shard, reuse it.
    if (is_file($bestFile)) {
        $size = @filesize($bestFile);
        if ($size !== false && (int)$size < $maxBytes) {
            return ['file' => $bestFile, 'shard' => $bestShard];
        }
    }

    // Otherwise rotate to next shard within configured cap.
    $nextShard = min($maxShards - 1, $bestShardSeen + 1);
    if ($nextShard <= 0) {
        return ['file' => $defaultFile, 'shard' => 0];
    }
    return [
        'file' => $base . '-' . $nextShard . '.jsonl',
        'shard' => $nextShard,
    ];
}

/**
 * @return array<string,mixed>
 */
function telemetry_storage_stats(int $retentionDays, int $maxFileMb, int $maxShardsPerDay): array
{
    $dir = telemetry_dir();
    if (!is_dir($dir)) {
        return [
            'files_count' => 0,
            'total_bytes' => 0,
            'latest_file' => null,
            'latest_size_bytes' => 0,
            'today' => [
                'date' => gmdate('Y-m-d'),
                'shards' => 0,
                'max_shard' => 0,
            ],
            'limits' => [
                'retention_days' => max(1, $retentionDays),
                'max_file_mb' => max(1, $maxFileMb),
                'max_file_bytes' => max(1, $maxFileMb) * 1024 * 1024,
                'max_shards' => max(1, $maxShardsPerDay),
            ],
        ];
    }

    $files = telemetry_list_files($dir);
    $totalBytes = 0;
    $latestFile = null;
    $latestSize = 0;
    $latestMtime = 0;
    $today = gmdate('Y-m-d');
    $todayShards = 0;
    $todayMaxShard = 0;

    foreach ($files as $file) {
        if (!is_string($file) || !is_file($file)) continue;
        $name = basename($file);
        $size = @filesize($file);
        if ($size !== false) {
            $totalBytes += (int)$size;
        }
        $mtime = @filemtime($file);
        if ($mtime !== false && (int)$mtime >= $latestMtime) {
            $latestMtime = (int)$mtime;
            $latestFile = $name;
            $latestSize = $size !== false ? (int)$size : 0;
        }

        if (preg_match('/^perf_' . preg_quote($today, '/') . '(?:-(\d+))?\.jsonl$/', $name, $m)) {
            $todayShards += 1;
            $shard = isset($m[1]) ? (int)$m[1] : 0;
            $todayMaxShard = max($todayMaxShard, $shard);
        }
    }

    return [
        'files_count' => count($files),
        'total_bytes' => $totalBytes,
        'latest_file' => $latestFile,
        'latest_size_bytes' => $latestSize,
        'today' => [
            'date' => $today,
            'shards' => $todayShards,
            'max_shard' => $todayMaxShard,
        ],
        'limits' => [
            'retention_days' => max(1, $retentionDays),
            'max_file_mb' => max(1, $maxFileMb),
            'max_file_bytes' => max(1, $maxFileMb) * 1024 * 1024,
            'max_shards' => max(1, $maxShardsPerDay),
        ],
    ];
}

/**
 * @param int $scanLimit maximum number of events to return after filtering
 * @param array<string,mixed> $filters
 * @return array<int,array<string,mixed>>
 */
function telemetry_read_recent_events(int $scanLimit = 200, array $filters = []): array
{
    $dir = telemetry_dir();
    if (!is_dir($dir)) return [];

    $files = telemetry_list_files($dir);
    if (!$files) return [];
    rsort($files, SORT_STRING);

    $sourceFilter = strtolower(trim((string)($filters['source'] ?? '')));
    $userFilter = max(0, (int)($filters['user_id'] ?? 0));

    $out = [];
    foreach ($files as $file) {
        if (!is_file($file)) continue;
        $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines) || !$lines) continue;

        for ($i = count($lines) - 1; $i >= 0; $i--) {
            $row = json_decode((string)$lines[$i], true);
            if (!is_array($row)) continue;

            if ($sourceFilter !== '' && strtolower((string)($row['source'] ?? '')) !== $sourceFilter) {
                continue;
            }
            if ($userFilter > 0 && (int)($row['user_id'] ?? 0) !== $userFilter) {
                continue;
            }

            $out[] = [
                'ts_ms' => (int)($row['ts_ms'] ?? 0),
                'user_id' => (int)($row['user_id'] ?? 0),
                'source' => (string)($row['source'] ?? ''),
                'reason' => (string)($row['reason'] ?? ''),
                'metrics' => is_array($row['metrics'] ?? null) ? $row['metrics'] : [],
                'client' => is_array($row['client'] ?? null) ? $row['client'] : [],
            ];

            if (count($out) >= $scanLimit) {
                return $out;
            }
        }
    }
    return $out;
}

/**
 * @param array<int,array<string,mixed>> $events
 * @return array<string,mixed>
 */
function telemetry_build_summary(array $events): array
{
    $fps = [];
    $frameMs = [];
    $drawCalls = [];
    $visibleStars = [];
    $quality = [];

    foreach ($events as $ev) {
        $m = is_array($ev['metrics'] ?? null) ? $ev['metrics'] : [];
        $f = NumberOrNull($m['fps'] ?? null);
        if ($f !== null) $fps[] = $f;
        $ft = NumberOrNull($m['frameTimeMs'] ?? null);
        if ($ft !== null) $frameMs[] = $ft;
        $dc = NumberOrNull($m['drawCalls'] ?? null);
        if ($dc !== null) $drawCalls[] = $dc;
        $vs = NumberOrNull($m['visibleStars'] ?? null);
        if ($vs !== null) $visibleStars[] = $vs;
        $qp = strtolower(trim((string)($m['qualityProfile'] ?? '')));
        if ($qp !== '') {
            $quality[$qp] = (int)($quality[$qp] ?? 0) + 1;
        }
    }

    return [
        'fps' => stats_basic($fps),
        'frame_time_ms' => stats_basic($frameMs),
        'draw_calls' => stats_basic($drawCalls),
        'visible_stars' => stats_basic($visibleStars),
        'quality_profile_histogram' => $quality,
    ];
}

/**
 * @param array<int,float|int> $arr
 * @return array<string,float|int|null>
 */
function stats_basic(array $arr): array
{
    if (!$arr) {
        return [
            'count' => 0,
            'min' => null,
            'avg' => null,
            'max' => null,
            'p95' => null,
        ];
    }
    sort($arr, SORT_NUMERIC);
    $count = count($arr);
    $sum = array_sum($arr);
    $p95Idx = max(0, min($count - 1, (int)floor(($count - 1) * 0.95)));

    return [
        'count' => $count,
        'min' => round((float)$arr[0], 3),
        'avg' => round((float)($sum / $count), 3),
        'max' => round((float)$arr[$count - 1], 3),
        'p95' => round((float)$arr[$p95Idx], 3),
    ];
}

function NumberOrNull($value): ?float
{
    if (!is_numeric($value)) return null;
    $n = (float)$value;
    if (!is_finite($n)) return null;
    return $n;
}
