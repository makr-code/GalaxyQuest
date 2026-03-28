<?php
/**
 * Galaxy map API
 *
 * GET /api/galaxy.php?galaxy=1&system=1
 *
 * Returns the star-system descriptor (spectral class, 3-D position,
 * habitable zone, frost line, scientifically generated planets) together
 * with any player-colonised planets in this system.
 *
 * The star system is generated deterministically on first access and then
 * cached in the star_systems table for subsequent queries.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/compression.php';
require_once __DIR__ . '/compression-v2.php';
require_once __DIR__ . '/compression-v3.php';
require_once __DIR__ . '/galaxy_gen.php';
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/game_engine.php';

only_method('GET');
require_auth();

// Enable gzip if supported
enable_response_gzip();

$action = (string)($_GET['action'] ?? 'system');
$g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
$s = max(1, min(galaxy_system_limit(), (int)($_GET['system'] ?? 1)));

$db = get_db();
ensure_galaxy_bootstrap_progress($db, true);

if ($action === 'stars') {
    $from      = max(1, min(galaxy_system_limit(), (int)($_GET['from'] ?? 1)));
    $to        = max($from, min(galaxy_system_limit(), (int)($_GET['to'] ?? galaxy_system_limit())));
    $maxPoints = max(100, min(50000, (int)($_GET['max_points'] ?? 1500)));

    $span   = max(1, $to - $from + 1);
    $stride = max(1, (int)ceil($span / $maxPoints));

    // ── Cache-Lookup (statische Stern-Daten, ohne benutzerspezifisches FOW) ──
    $cacheParams = ['g' => $g, 'from' => $from, 'to' => $to, 'stride' => $stride];
    $cachedJson  = gq_cache_get_raw('stars', $cacheParams);
    $stars = $cachedJson !== null ? json_decode($cachedJson, true) : null;
    $servedFrom = $from;
    $servedTo = $to;
    $servedStride = $stride;
    $cacheMode = $stars !== null ? 'exact' : 'miss';
    $overlapPolicyRaw = strtolower((string)(defined('CACHE_STARS_OVERLAP_POLICY') ? CACHE_STARS_OVERLAP_POLICY : 'smallest_superset'));
    $overlapPolicy = in_array($overlapPolicyRaw, ['smallest_superset', 'max_overlap'], true)
        ? $overlapPolicyRaw
        : 'smallest_superset';

    // Fallback: vorhandene Chunk-Pakete mit überlappender ID-Range wiederverwenden.
    if ($stars === null) {
        $requestAnchor = $stride > 0 ? ($from % $stride) : 0;
        $bestEntry = null;
        $bestScore = -1;
        foreach (gq_cache_index_entries('stars') as $entry) {
            $meta = is_array($entry['meta'] ?? null) ? $entry['meta'] : [];
            $params = is_array($entry['params'] ?? null) ? $entry['params'] : [];

            $cg = (int)($meta['g'] ?? $params['g'] ?? 0);
            if ($cg !== $g) continue;

            $cFrom = (int)($meta['range_from'] ?? $params['from'] ?? 0);
            $cTo = (int)($meta['range_to'] ?? $params['to'] ?? 0);
            $cStride = max(1, (int)($meta['stride'] ?? $params['stride'] ?? 1));
            $cAnchor = (int)($meta['anchor'] ?? ($cFrom % $cStride));
            if ($cFrom <= 0 || $cTo < $cFrom) continue;

            // Kompatibel, wenn Full-Density-Chunk oder exakt gleicher Stride+Anchor.
            $compatibleStride = ($cStride === 1)
                || ($cStride === $stride && $cAnchor === $requestAnchor);
            if (!$compatibleStride) continue;

            $overlapFrom = max($from, $cFrom);
            $overlapTo   = min($to, $cTo);
            if ($overlapTo < $overlapFrom) continue;

            $overlapLen = $overlapTo - $overlapFrom + 1;
            $coversRequest = ($cFrom <= $from && $cTo >= $to);
            $span = max(1, $cTo - $cFrom + 1);

            // Policy: smallest_superset bevorzugt das kleinste vollständige Paket,
            // max_overlap bevorzugt maximale Schnittmenge (auch Teilmengen).
            if ($overlapPolicy === 'smallest_superset') {
                $score = $coversRequest
                    ? (2_000_000 - $span)
                    : (1_000_000 + $overlapLen - min(50000, $span));
            } else {
                $score = ($overlapLen * 10_000)
                    + ($coversRequest ? 100_000 : 0)
                    - min(50_000, $span);
            }

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestEntry = $entry;
            }
        }

        if (is_array($bestEntry)) {
            $bestParams = is_array($bestEntry['params'] ?? null) ? $bestEntry['params'] : [];
            $bestMeta = is_array($bestEntry['meta'] ?? null) ? $bestEntry['meta'] : [];
            $candidateRaw = gq_cache_get_raw('stars', $bestParams);
            $candidate = is_string($candidateRaw) ? json_decode($candidateRaw, true) : null;
            if (is_array($candidate)) {
                $stars = $candidate;
                $servedFrom = (int)($bestMeta['range_from'] ?? $bestParams['from'] ?? $from);
                $servedTo = (int)($bestMeta['range_to'] ?? $bestParams['to'] ?? $to);
                $servedStride = max(1, (int)($bestMeta['stride'] ?? $bestParams['stride'] ?? $stride));
                $cacheMode = 'overlap';
            }
        }
    }

    if ($stars === null) {
        // Make sure the requested range is generated and cached.
        ensure_star_system($db, $g, $from);
        ensure_star_system($db, $g, $to);

        // Full-density range requests (stride=1) are expensive on large spans.
        // Guard with a hard limit to avoid long blocking requests starving PHP workers.
        if ($stride === 1) {
            $materializeLimit = max(50, (int)CACHE_STARS_FULL_MATERIALIZE_LIMIT);
            $materializeTo = ($to - $from + 1) <= $materializeLimit
                ? $to
                : min($to, $from + $materializeLimit - 1);
            for ($sys = $from; $sys <= $materializeTo; $sys++) {
                ensure_star_system($db, $g, $sys);
            }
        }

        $stmt = $db->prepare(
            'SELECT id, galaxy_index, system_index, name,
                    COALESCE(NULLIF(catalog_name, ""), name) AS catalog_name,
                    spectral_class, subtype, x_ly, y_ly, z_ly,
                    planet_count, hz_inner_au, hz_outer_au
             FROM star_systems
             WHERE galaxy_index = ?
               AND system_index BETWEEN ? AND ?
               AND MOD(system_index - ?, ?) = 0
             ORDER BY system_index ASC'
        );
        $stmt->execute([$g, $from, $to, $from, $stride]);
        $stars = $stmt->fetchAll();

        // Rohen JSON-String cachen (inkl. ID-Range-Metadaten für Overlap-Reuse).
        gq_cache_set_raw_meta(
            'stars',
            $cacheParams,
            json_encode($stars, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            CACHE_TTL_STARS,
            [
                'g' => $g,
                'range_from' => $from,
                'range_to' => $to,
                'stride' => $stride,
                'anchor' => $stride > 0 ? ($from % $stride) : 0,
            ]
        );
        $cacheMode = 'generated';
    }
    // ── Fog of War: attach visibility level per system ─────────────────────────
    $currentUserId = current_user_id();
    if ($currentUserId !== null && count($stars) > 0) {
        $systemIndices = array_column($stars, 'system_index');
        $placeholders  = implode(',', array_fill(0, count($systemIndices), '?'));
        $params        = array_merge([$currentUserId, $g], $systemIndices);
        $visStmt = $db->prepare(
            "SELECT `system`, level FROM player_system_visibility
              WHERE user_id = ? AND galaxy = ? AND `system` IN ($placeholders)"
        );
        $visStmt->execute($params);
        $visMap = [];
        foreach ($visStmt->fetchAll(PDO::FETCH_ASSOC) as $vr) {
            $visMap[(int)$vr['system']] = $vr['level'];
        }
        foreach ($stars as &$star) {
            $star['visibility_level'] = $visMap[(int)$star['system_index']] ?? 'unknown';
        }
        unset($star);
    }

    json_ok([
        'action' => 'stars',
        'galaxy' => $g,
        'system_max' => galaxy_system_limit(),
        'from' => $from,
        'to' => $to,
        'stride' => $stride,
        'served_from' => $servedFrom,
        'served_to' => $servedTo,
        'served_stride' => $servedStride,
        'cache_mode' => $cacheMode,
        'cache_overlap_policy' => $overlapPolicy,
        'count' => count($stars),
        'server_ts' => gmdate('c'),
        'server_ts_ms' => (int)round(microtime(true) * 1000),
        'stars' => $stars,
        'clusters' => compute_star_cluster_summary($stars),
    ]);
    exit;
}

if ($action === 'search') {
        $q = trim((string)($_GET['q'] ?? ''));
        $limit = max(1, min(40, (int)($_GET['limit'] ?? 18)));
        if (strlen($q) < 2) {
                json_ok([
                        'action' => 'search',
                        'galaxy' => $g,
                        'query' => $q,
                        'count' => 0,
                        'stars' => [],
                ]);
                exit;
        }

        $isNumeric = ctype_digit($q);
        $systemExact = $isNumeric ? (int)$q : -1;
        if ($systemExact > 0 && $systemExact <= galaxy_system_limit()) {
                ensure_star_system($db, $g, $systemExact);
        }

        $likeAny = '%' . $q . '%';
        $likePrefix = $q . '%';

        $stmt = $db->prepare(
                'SELECT id, galaxy_index, system_index, name,
                                COALESCE(NULLIF(catalog_name, ""), name) AS catalog_name,
                                spectral_class, subtype, x_ly, y_ly, z_ly,
                                planet_count, hz_inner_au, hz_outer_au
                 FROM star_systems
                 WHERE galaxy_index = ?
                     AND (
                         system_index = ?
                         OR CAST(system_index AS TEXT) LIKE ?
                         OR name LIKE ?
                         OR catalog_name LIKE ?
                     )
                 ORDER BY
                     CASE
                         WHEN system_index = ? THEN 0
                         WHEN CAST(system_index AS TEXT) LIKE ? THEN 1
                         WHEN name LIKE ? THEN 2
                         WHEN catalog_name LIKE ? THEN 3
                         ELSE 4
                     END,
                     system_index ASC
                 LIMIT ?'
        );
        $stmt->execute([
                $g,
                $systemExact,
                $likePrefix,
                $likeAny,
                $likeAny,
                $systemExact,
                $likePrefix,
                $likePrefix,
                $likePrefix,
                $limit,
        ]);
        $stars = $stmt->fetchAll();

        json_ok([
                'action' => 'search',
                'galaxy' => $g,
                'query' => $q,
                'count' => count($stars),
                'stars' => $stars,
        ]);
        exit;
}

// ── 1. Ensure star system is generated and cached ─────────────────────────────
$starSystem = ensure_star_system($db, $g, $s);
if (!isset($starSystem['catalog_name']) || $starSystem['catalog_name'] === '') {
    $starSystem['catalog_name'] = (string)($starSystem['name'] ?? '');
}

// ── 2. Build or load cached system base payload (planets/colonies/fleets) ────
$systemCacheParams = ['g' => $g, 's' => $s, 'schema' => 2];
$response = null;
$cachedBaseRaw = gq_cache_get_raw('system_payload_base', $systemCacheParams);
if (is_string($cachedBaseRaw) && $cachedBaseRaw !== '') {
    $decodedBase = json_decode($cachedBaseRaw, true);
    if (is_array($decodedBase)) {
        $response = $decodedBase;
    }
}

if (!is_array($response)) {
    $stmt = $db->prepare(
        'SELECT p.id, p.position, p.type, p.planet_class, p.diameter,
                p.temp_min, p.temp_max, p.in_habitable_zone,
                p.semi_major_axis_au, p.orbital_period_days,
                p.surface_gravity_g, p.atmosphere_type,
                p.composition_family, p.dominant_surface_material,
                p.surface_pressure_bar, p.water_state, p.methane_state,
                p.ammonia_state, p.dominant_surface_liquid, p.radiation_level,
                p.habitability_score, p.life_friendliness, p.species_affinity_json,
                c.name, c.id AS colony_id, c.user_id,
                u.username AS owner
         FROM colonies c
         JOIN planets p ON p.id = c.planet_id
         JOIN users u   ON u.id = c.user_id
        WHERE p.galaxy = ? AND p.`system` = ?
         ORDER BY p.position ASC'
    );
    $stmt->execute([$g, $s]);
    $rows = $stmt->fetchAll();

    $playerSlots = [];
    foreach ($rows as $row) {
        $playerSlots[(int)$row['position']] = $row;
    }

    $colonyIds = array_values(array_filter(array_map(static fn(array $row): int => (int)($row['colony_id'] ?? 0), $rows)));
    $buildingsByColony = [];
    $shipsByColony = [];
    if ($colonyIds) {
        $placeholders = implode(',', array_fill(0, count($colonyIds), '?'));
        $buildingStmt = $db->prepare("SELECT colony_id, type, level FROM buildings WHERE colony_id IN ($placeholders) ORDER BY colony_id, type");
        $buildingStmt->execute($colonyIds);
        foreach ($buildingStmt->fetchAll() as $buildingRow) {
            $buildingsByColony[(int)$buildingRow['colony_id']][] = $buildingRow;
        }
        $shipStmt = $db->prepare("SELECT colony_id, type, count FROM ships WHERE colony_id IN ($placeholders) ORDER BY colony_id, type");
        $shipStmt->execute($colonyIds);
        foreach ($shipStmt->fetchAll() as $shipRow) {
            $shipsByColony[(int)$shipRow['colony_id']][(string)$shipRow['type']] = (int)$shipRow['count'];
        }
    }

    $starOrbitInstallations = [];
    foreach ($playerSlots as $position => &$slotRow) {
        $colonyId = (int)($slotRow['colony_id'] ?? 0);
        $userId   = (int)($slotRow['user_id'] ?? 0);
        $slotRow['orbital_facilities'] = summarize_orbital_facilities($buildingsByColony[$colonyId] ?? [], $shipsByColony[$colonyId] ?? []);
        $slotRow['owner_color'] = user_empire_color($userId);
        $starOrbitFacilities = summarize_star_orbit_facilities($buildingsByColony[$colonyId] ?? [], $colonyId, $position);
        foreach ($starOrbitFacilities as $fac) {
            $fac['owner_color'] = $slotRow['owner_color'];
            $fac['owner']       = (string)($slotRow['owner'] ?? '');
            $starOrbitInstallations[] = $fac;
        }
    }
    unset($slotRow);

    $posMax  = defined('POSITION_MAX') ? POSITION_MAX : 15;
    $mergedPlanets = [];
    for ($pos = 1; $pos <= $posMax; $pos++) {
        $genPlanet = null;
        foreach ($starSystem['planets'] as $gp) {
            if ((int)$gp['position'] === $pos) {
                $genPlanet = $gp;
                break;
            }
        }
        $mergedPlanets[] = [
            'position'         => $pos,
            'player_planet'    => $playerSlots[$pos] ?? null,
            'generated_planet' => $genPlanet,
        ];
    }

    $fleetStmt = $db->prepare(
        'SELECT f.id, f.user_id, f.origin_colony_id, f.target_galaxy, f.target_system, f.target_position,
                f.mission, f.ships_json, f.departure_time, f.arrival_time, f.return_time, f.returning,
                f.origin_x_ly, f.origin_y_ly, f.origin_z_ly, f.target_x_ly, f.target_y_ly, f.target_z_ly,
                p.galaxy AS origin_galaxy, p.`system` AS origin_system, p.position AS origin_position,
                u.username AS owner
         FROM fleets f
         JOIN colonies c ON c.id = f.origin_colony_id
         JOIN planets p ON p.id = c.planet_id
         JOIN users u ON u.id = f.user_id
         WHERE (p.galaxy = ? AND p.`system` = ?) OR (f.target_galaxy = ? AND f.target_system = ?)
         ORDER BY f.arrival_time ASC'
    );
    $fleetStmt->execute([$g, $s, $g, $s]);
    $fleetsInSystem = [];
    foreach ($fleetStmt->fetchAll() as $fleetRow) {
        $ships = json_decode((string)$fleetRow['ships_json'], true);
        $fleetRow['ships'] = is_array($ships) ? $ships : [];
        $fleetRow['vessels'] = vessel_manifest($fleetRow['ships']);
        unset($fleetRow['ships_json']);
        $fleetRow['current_pos'] = fleet_current_position($fleetRow);
        $fleetsInSystem[] = $fleetRow;
    }

    $response = [
        'galaxy'               => $g,
        'system'               => $s,
        'system_max'           => galaxy_system_limit(),
        'star_system'          => $starSystem,
        'planets'              => $mergedPlanets,
        'planet_texture_manifest' => build_planet_texture_manifest($g, $s, $starSystem, $mergedPlanets),
        'fleets_in_system'     => $fleetsInSystem,
        'star_installations'   => $starOrbitInstallations,
    ];

    $baseRaw = json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (is_string($baseRaw)) {
        gq_cache_set_raw('system_payload_base', $systemCacheParams, $baseRaw, CACHE_TTL_SYSTEM_PAYLOAD);
    }
}

// Timestamp is request-local and should not be reused from cache.
$response['server_ts_ms'] = (int)round(microtime(true) * 1000);

$mergedPlanets = is_array($response['planets'] ?? null) ? $response['planets'] : [];
$fleetsInSystem = is_array($response['fleets_in_system'] ?? null) ? $response['fleets_in_system'] : [];
$starOrbitInstallations = is_array($response['star_installations'] ?? null) ? $response['star_installations'] : [];

// ── Fog of War filtering ──────────────────────────────────────────────────────
$currentUserId = current_user_id();
if ($currentUserId !== null) {
    $vis = resolve_system_visibility($db, $currentUserId, $g, $s);
    $visLevel = $vis['level'];

    // Does player own a colony here?
    $hasOwnColony = false;
    foreach ($mergedPlanets as $slot) {
        $playerPlanet = $slot['player_planet'] ?? null;
        if (is_array($playerPlanet) && (int)($playerPlanet['user_id'] ?? 0) === $currentUserId) {
            $hasOwnColony = true;
            break;
        }
    }
    if ($hasOwnColony) { $visLevel = 'own'; }

    if ($visLevel === 'own' || $visLevel === 'active') {
        // Fresh intel snapshot stored for future stale views
        $snap = build_intel_snapshot($mergedPlanets, $fleetsInSystem, $starOrbitInstallations);
        touch_system_visibility($db, $currentUserId, $g, $s, $visLevel, null, $snap);
        $response['visibility'] = ['level' => $visLevel, 'scouted_at' => date('c')];
    } else {
        // First-ever visit: record it (no snapshot yet)
        if ($visLevel === 'unknown') {
            touch_system_visibility($db, $currentUserId, $g, $s, 'stale', null, null);
        }
        $response = apply_fog_of_war($response, $visLevel, $vis['scouted_at'], $vis['intel_json']);
    }
}

// Format selection: binary or JSON
$format = strtolower((string)($_GET['format'] ?? 'json'));

if (in_array($format, ['bin', 'bin1', 'bin2', 'bin3'], true)) {
    // Always trim for binary mode (compact)
    $response = trim_system_payload_for_transit($response);

    if ($format === 'bin1') {
        $binary = encode_system_payload_binary($response);
        $version = 1;
    } elseif ($format === 'bin2' && function_exists('encode_system_payload_binary_v2')) {
        $binary = encode_system_payload_binary_v2($response);
        $version = 2;
    } else {
        // Default binary mode uses V3.
        $binary = encode_system_payload_binary_v3($response);
        $version = 3;
    }

    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . strlen($binary));
    header('X-GQ-Format: binary');
    header('X-GQ-Format-Version: ' . $version);
    echo $binary;
} else {
    // JSON mode (default)
    // Optional: trim payload for faster transit
    if ((int)($_GET['trim'] ?? 0) === 1) {
        $response = trim_system_payload_for_transit($response);
    }
    
    json_ok($response);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

require_once __DIR__ . '/planet_helper.php';

/**
 * Compute spatial cluster summary from star data (mirrors JS computeClusterSummary).
 * Groups stars into spatially connected components via 3-D cell BFS.
 * Does NOT assign factions – that stays in the frontend where territory data lives.
 */
function compute_star_cluster_summary(array $stars, int $maxClusters = 18): array {
    if (!$stars) return [];

    $minX = INF; $minY = INF; $minZ = INF;
    $maxX = -INF; $maxY = -INF; $maxZ = -INF;
    foreach ($stars as $s) {
        $x = (float)($s['x_ly'] ?? 0);
        $y = (float)($s['y_ly'] ?? 0);
        $z = (float)($s['z_ly'] ?? 0);
        if ($x < $minX) $minX = $x; if ($x > $maxX) $maxX = $x;
        if ($y < $minY) $minY = $y; if ($y > $maxY) $maxY = $y;
        if ($z < $minZ) $minZ = $z; if ($z > $maxZ) $maxZ = $z;
    }

    $spanX = max(1.0, $maxX - $minX);
    $spanY = max(1.0, $maxY - $minY);
    $spanZ = max(1.0, $maxZ - $minZ);
    $diagonal = sqrt($spanX * $spanX + $spanY * $spanY + $spanZ * $spanZ);
    $cellSize = max(40.0, min(420.0, $diagonal / 16.0));

    $cellMap = [];
    foreach ($stars as $s) {
        $cx = (int)floor(((float)($s['x_ly'] ?? 0) - $minX) / $cellSize);
        $cy = (int)floor(((float)($s['y_ly'] ?? 0) - $minY) / $cellSize);
        $cz = (int)floor(((float)($s['z_ly'] ?? 0) - $minZ) / $cellSize);
        $cellMap["$cx|$cy|$cz"][] = $s;
    }

    // Pre-build neighbor offset list
    $offsets = [];
    for ($dx = -1; $dx <= 1; $dx++)
        for ($dy = -1; $dy <= 1; $dy++)
            for ($dz = -1; $dz <= 1; $dz++)
                $offsets[] = [$dx, $dy, $dz];

    $visited = [];
    $components = [];
    foreach (array_keys($cellMap) as $startKey) {
        if (isset($visited[$startKey])) continue;
        $queue = [$startKey];
        $visited[$startKey] = true;
        $cells = [];
        while ($queue) {
            $current = array_shift($queue);
            $cells[] = $current;
            [$cx, $cy, $cz] = array_map('intval', explode('|', $current));
            foreach ($offsets as [$nx, $ny, $nz]) {
                $next = ($cx + $nx) . '|' . ($cy + $ny) . '|' . ($cz + $nz);
                if (!isset($visited[$next]) && isset($cellMap[$next])) {
                    $visited[$next] = true;
                    $queue[] = $next;
                }
            }
        }
        $comp = [];
        foreach ($cells as $ck) $comp = array_merge($comp, $cellMap[$ck]);
        if ($comp) $components[] = $comp;
    }

    usort($components, static fn($a, $b) => count($b) - count($a));
    $components = array_slice($components, 0, $maxClusters);

    $result = [];
    foreach ($components as $idx => $comp) {
        $sysNums = array_unique(array_map(static fn($s) => (int)($s['system_index'] ?? 0), $comp));
        $sysNums = array_values(array_filter($sysNums, static fn($n) => $n > 0));
        sort($sysNums);

        $sumX = 0.0; $sumY = 0.0; $sumZ = 0.0;
        foreach ($comp as $s) {
            $sumX += (float)($s['x_ly'] ?? 0);
            $sumY += (float)($s['y_ly'] ?? 0);
            $sumZ += (float)($s['z_ly'] ?? 0);
        }
        $n = count($comp);
        $from = $sysNums ? $sysNums[0] : 0;
        $to   = $sysNums ? $sysNums[count($sysNums) - 1] : 0;

        $result[] = [
            'key'     => $sysNums ? "cluster-{$from}-{$to}-{$idx}" : "cluster-{$idx}",
            'label'   => 'Cluster ' . ($idx + 1),
            'from'    => $from,
            'to'      => $to,
            'systems' => $sysNums,
            'stars'   => $n,
            'center'  => [
                'x_ly' => round($sumX / $n, 2),
                'y_ly' => round($sumY / $n, 2),
                'z_ly' => round($sumZ / $n, 2),
            ],
        ];
    }
    return $result;
}

/**
 * Return the star system row from DB, generating and inserting it first if needed.
 */
function ensure_star_system(PDO $db, int $galaxyIdx, int $systemIdx): array
{
    return cache_generated_system($db, $galaxyIdx, $systemIdx, true);
}

function build_planet_texture_manifest(int $galaxyIdx, int $systemIdx, array $starSystem, array $mergedPlanets): array
{
    $manifest = [
        'version' => 1,
        'system_seed' => texture_seed_value([$galaxyIdx, $systemIdx, $starSystem['spectral_class'] ?? 'G', $starSystem['name'] ?? 'system']),
        'planets' => [],
    ];

    foreach ($mergedPlanets as $slot) {
        $body = is_array($slot['player_planet'] ?? null)
            ? $slot['player_planet']
            : (is_array($slot['generated_planet'] ?? null) ? $slot['generated_planet'] : null);
        if (!$body) {
            continue;
        }

        $position = (int)($slot['position'] ?? $body['position'] ?? 0);
        if ($position <= 0) {
            continue;
        }

        $planetClass = (string)($body['planet_class'] ?? $body['type'] ?? 'unknown');
        $composition = (string)($body['composition_family'] ?? $body['dominant_surface_material'] ?? 'generic');
        $seed = texture_seed_value([
            $galaxyIdx,
            $systemIdx,
            $position,
            $planetClass,
            $composition,
            $body['diameter'] ?? 0,
            $body['semi_major_axis_au'] ?? 0,
        ]);

        $variant = texture_variant_for_planet($planetClass);
        $manifest['planets'][(string)$position] = [
            'seed' => $seed,
            'position' => $position,
            'variant' => $variant,
            'palette' => texture_palette_for_planet($planetClass, $composition, $seed),
            'roughness' => round(texture_planet_scalar($seed, 'roughness', 0.58, 0.92), 3),
            'metalness' => round(texture_planet_scalar($seed, 'metalness', 0.01, 0.12), 3),
            'banding' => round(texture_planet_scalar($seed, 'banding', $variant === 'gas' ? 0.45 : 0.08, $variant === 'gas' ? 0.92 : 0.36), 3),
            'clouds' => round(texture_planet_scalar($seed, 'clouds', 0.05, 0.75), 3),
            'craters' => round(texture_planet_scalar($seed, 'craters', 0.0, $variant === 'rocky' ? 0.85 : 0.34), 3),
            'ice_caps' => round(texture_planet_scalar($seed, 'ice_caps', $variant === 'ice' ? 0.25 : 0.0, $variant === 'ice' ? 0.75 : 0.24), 3),
            'atmosphere' => round(texture_planet_scalar($seed, 'atmosphere', 0.12, 0.72), 3),
            'glow' => round(texture_planet_scalar($seed, 'glow', $variant === 'lava' ? 0.08 : 0.0, $variant === 'lava' ? 0.48 : 0.16), 3),
        ];
    }

    return $manifest;
}

function texture_variant_for_planet(string $planetClass): string
{
    $cls = strtolower($planetClass);
    if (str_contains($cls, 'gas')) return 'gas';
    if (str_contains($cls, 'ice')) return 'ice';
    if (str_contains($cls, 'ocean')) return 'ocean';
    if (str_contains($cls, 'lava') || str_contains($cls, 'volcan')) return 'lava';
    if (str_contains($cls, 'desert')) return 'desert';
    return 'rocky';
}

function texture_palette_for_planet(string $planetClass, string $composition, int $seed): array
{
    $variant = texture_variant_for_planet($planetClass);
    $shift = texture_planet_scalar($seed, 'hue_shift', -0.055, 0.055);
    $accentLift = texture_planet_scalar($seed, 'accent', 0.06, 0.16);

    $base = match ($variant) {
        'gas' => [0.09 + $shift, 0.42, 0.62],
        'ice' => [0.56 + $shift, 0.46, 0.73],
        'ocean' => [0.55 + $shift, 0.58, 0.47],
        'lava' => [0.03 + $shift, 0.68, 0.46],
        'desert' => [0.11 + $shift, 0.48, 0.58],
        default => [0.09 + $shift, 0.16, 0.50],
    };

    $secondary = [$base[0] + texture_planet_scalar($seed, 'sec_hue', -0.03, 0.03), min(0.9, $base[1] + 0.08), max(0.12, $base[2] - 0.12)];
    $accent = [$base[0] + texture_planet_scalar($seed, 'acc_hue', -0.08, 0.08), min(1.0, $base[1] + 0.12), min(0.92, $base[2] + $accentLift)];
    $ice = [$base[0] + 0.02, 0.18, min(0.96, $base[2] + 0.22)];

    if (str_contains(strtolower($composition), 'metal')) {
        $secondary[1] = min(0.24, $secondary[1]);
        $secondary[2] = max(0.34, $secondary[2]);
    }

    return [
        'base' => hsl_to_hex($base[0], $base[1], $base[2]),
        'secondary' => hsl_to_hex($secondary[0], $secondary[1], $secondary[2]),
        'accent' => hsl_to_hex($accent[0], $accent[1], $accent[2]),
        'ice' => hsl_to_hex($ice[0], $ice[1], $ice[2]),
    ];
}

function texture_planet_scalar(int $seed, string $channel, float $min, float $max): float
{
    $range = max(0.0, $max - $min);
    $unit = texture_seed_unit($seed, $channel);
    return $min + ($range * $unit);
}

function texture_seed_unit(int $seed, string $channel): float
{
    $raw = sprintf('%u', crc32($seed . '|' . $channel));
    $value = (int)$raw;
    return ($value % 10000) / 9999;
}

function texture_seed_value(array $parts): int
{
    return (int)sprintf('%u', crc32(implode('|', array_map(static fn($part): string => (string)$part, $parts))));
}

function hsl_to_hex(float $h, float $s, float $l): string
{
    $h = $h - floor($h);
    $s = max(0.0, min(1.0, $s));
    $l = max(0.0, min(1.0, $l));

    if ($s <= 0.00001) {
        $v = (int)round($l * 255);
        return sprintf('#%02x%02x%02x', $v, $v, $v);
    }

    $q = $l < 0.5 ? $l * (1 + $s) : $l + $s - ($l * $s);
    $p = 2 * $l - $q;
    $r = hue_to_rgb($p, $q, $h + 1 / 3);
    $g = hue_to_rgb($p, $q, $h);
    $b = hue_to_rgb($p, $q, $h - 1 / 3);

    return sprintf('#%02x%02x%02x', (int)round($r * 255), (int)round($g * 255), (int)round($b * 255));
}

function hue_to_rgb(float $p, float $q, float $t): float
{
    if ($t < 0) $t += 1;
    if ($t > 1) $t -= 1;
    if ($t < 1 / 6) return $p + ($q - $p) * 6 * $t;
    if ($t < 1 / 2) return $q;
    if ($t < 2 / 3) return $p + ($q - $p) * (2 / 3 - $t) * 6;
    return $p;
}

