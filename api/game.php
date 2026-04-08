<?php
/**
 * Game data API
 * GET  /api/game.php?action=overview
 * GET  /api/game.php?action=resources&colony_id=X
 * GET  /api/game.php?action=health
 * POST /api/game.php?action=pvp_toggle
 * POST /api/game.php?action=rename_colony   body: {colony_id, name}
 * POST /api/game.php?action=set_colony_type body: {colony_id, colony_type}
 * POST /api/game.php?action=set_ftl_drive   body: {ftl_drive_type}
 * GET  /api/game.php?action=leaderboard
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/buildings.php';   // verify_colony_ownership
require_once __DIR__ . '/galaxy_seed.php';
require_once __DIR__ . '/projection.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {

    // ── Overview ──────────────────────────────────────────────────────────────
    case 'overview':
        only_method('GET');
        $db = get_db();

        // ── Projection read path (feature-flag guarded) ───────────────────────
        if (defined('PROJECTION_OVERVIEW_ENABLED') && PROJECTION_OVERVIEW_ENABLED) {
            $projPayload = read_user_overview_projection($db, $uid);
            if (is_array($projPayload)) {
                json_ok($projPayload);
            }
            // Projection miss → fall through to live computation below.
        }

        $overviewCacheKey = ['uid' => $uid];
        $cachedOverview = gq_cache_get('game_overview', $overviewCacheKey);
        if (is_array($cachedOverview) && isset($cachedOverview['user_meta'])) {
            json_ok($cachedOverview);
        }

        $payload = build_live_overview_payload($db, $uid, true);

        gq_cache_set('game_overview', $overviewCacheKey, $payload, CACHE_TTL_OVERVIEW);

        // Write fresh projection so the next request can be served from it.
        if (defined('PROJECTION_OVERVIEW_ENABLED') && PROJECTION_OVERVIEW_ENABLED) {
            write_user_overview_projection($db, $uid, $payload);
        }

        json_ok($payload);
        break;

    // ── Colony resources refresh ───────────────────────────────────────────────
    case 'resources':
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $db  = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $resourceCacheKey = ['uid' => $uid, 'cid' => $cid];
        $cachedResources = gq_cache_get('game_resources', $resourceCacheKey);
        if (is_array($cachedResources) && isset($cachedResources['resources'])) {
            json_ok($cachedResources);
        }
        update_colony_resources($db, $cid);
        $row = $db->prepare('SELECT metal, crystal, deuterium, rare_earth, food, energy,
                                    population, max_population, happiness, public_services
                             FROM colonies WHERE id=?');
        $row->execute([$cid]);
        $payload = ['resources' => $row->fetch()];
        gq_cache_set('game_resources', $resourceCacheKey, $payload, CACHE_TTL_OVERVIEW);
        json_ok($payload);
        break;

    // ── Foreign colony intel / sector overview ───────────────────────────────
    case 'planet_intel':
        only_method('GET');
        $g = max(1, min(GALAXY_MAX, (int)($_GET['galaxy'] ?? 1)));
        $s = max(1, min(galaxy_system_limit(), (int)($_GET['system'] ?? 1)));
        $p = max(1, min(15, (int)($_GET['position'] ?? 1)));
        $db = get_db();

        $stmt = $db->prepare(
            'SELECT cb.id AS body_id, cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position,
                p.id AS planet_id, p.planet_class,
                    p.habitability_score, p.life_friendliness,
                    c.id AS colony_id, c.name AS colony_name, c.colony_type,
                    c.population, c.max_population, c.happiness, c.public_services, c.energy,
                    u.id AS owner_id, u.username AS owner_name
             FROM celestial_bodies cb
             LEFT JOIN colonies c ON c.body_id = cb.id
             LEFT JOIN planets p ON p.id = c.planet_id
             LEFT JOIN users u ON u.id = c.user_id
             WHERE cb.galaxy_index = ? AND cb.system_index = ? AND cb.position = ?
             LIMIT 1'
        );
        $stmt->execute([$g, $s, $p]);
        $planet = $stmt->fetch();
        if (!$planet) {
            json_ok([
                'intel' => null,
                'territory' => territory_factions_for_galaxy($db, $uid, $g),
                'diplomacy_hint' => 'Unkartierter Randbereich. Keine belastbaren diplomatischen Hinweise verfügbar.',
            ]);
            break;
        }

        $latestScan = null;
        if (!empty($planet['body_id'])) {
            $scanStmt = $db->prepare(
                'SELECT id, created_at, report_json
                 FROM spy_reports
                 WHERE owner_id = ? AND target_body_id = ?
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1'
            );
            $scanStmt->execute([$uid, (int)$planet['body_id']]);
            $latestScan = $scanStmt->fetch();
        }

        $scanPayload = null;
        if ($latestScan && !empty($latestScan['report_json'])) {
            $scanPayload = json_decode((string)$latestScan['report_json'], true);
            if (!is_array($scanPayload)) {
                $scanPayload = null;
            }
        }

        $territory = territory_factions_for_galaxy($db, $uid, $g);
        $threat = compute_planet_threat($planet, $scanPayload, $territory);

        json_ok([
            'intel' => [
                'body_id' => (int)($planet['body_id'] ?? 0),
                'planet_id' => (int)($planet['planet_id'] ?? 0),
                'colony_id' => (int)($planet['colony_id'] ?? 0),
                'owner_id' => (int)($planet['owner_id'] ?? 0),
                'owner_name' => $planet['owner_name'] ?? null,
                'colony_name' => $planet['colony_name'] ?? null,
                'colony_type' => $planet['colony_type'] ?? null,
                'threat' => $threat,
                'latest_scan_at' => $latestScan['created_at'] ?? null,
                'latest_scan' => summarize_scan_payload($scanPayload),
            ],
            'territory' => $territory,
            'diplomacy_hint' => build_diplomacy_hint($territory, $threat),
        ]);
        break;

    // ── Health / integrity snapshot ────────────────────────────────────────────
    case 'health':
        only_method('GET');
        $db = get_db();
        ensure_star_system_columns($db);

        $meta = [
            'star_systems_total' => 0,
            'star_systems_missing_metadata' => 0,
            'planets_total' => 0,
            'timestamp_utc' => gmdate('c'),
        ];

        $meta['star_systems_total'] = (int)$db
            ->query('SELECT COUNT(*) FROM star_systems')
            ->fetchColumn();
        $meta['star_systems_missing_metadata'] = (int)$db
            ->query('SELECT COUNT(*) FROM star_systems WHERE COALESCE(catalog_name, "") = "" OR COALESCE(planet_count, 0) = 0')
            ->fetchColumn();
        $meta['planets_total'] = (int)$db
            ->query('SELECT COUNT(*) FROM planets')
            ->fetchColumn();

        json_ok([
            'health' => [
                'ok' => $meta['star_systems_missing_metadata'] === 0,
                'checks' => $meta,
            ],
        ]);
        break;

    // ── Rename colony ─────────────────────────────────────────────────────────
    case 'rename_colony':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['colony_id'] ?? 0);
        $name = trim($body['name'] ?? '');
        if (!preg_match('/^[\w\s\-\.]{2,48}$/u', $name)) {
            json_error('Colony name must be 2–48 characters.');
        }
        $db = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $db->prepare('UPDATE colonies SET name=? WHERE id=?')->execute([$name, $cid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => $cid]);
        enqueue_dirty_user($db, $uid, 'colony_renamed');
        json_ok(['name' => $name]);
        break;

    // ── Set colony type / specialisation ─────────────────────────────────────
    case 'set_colony_type':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['colony_id'] ?? 0);
        $type = $body['colony_type'] ?? '';
        $valid = ['balanced','mining','industrial','research','agricultural','military'];
        if (!in_array($type, $valid, true)) { json_error('Invalid colony type.'); }
        $db = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $db->prepare('UPDATE colonies SET colony_type=? WHERE id=?')->execute([$type, $cid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        enqueue_dirty_user($db, $uid, 'colony_type_changed');
        json_ok(['colony_type' => $type]);
        break;

    // ── PvP toggle ────────────────────────────────────────────────────────────
    case 'pvp_toggle':
        only_method('POST');
        verify_csrf();
        $db   = get_db();
        $uRow = $db->prepare('SELECT pvp_mode, protection_until FROM users WHERE id=?');
        $uRow->execute([$uid]);
        $u = $uRow->fetch();
        if ($u['protection_until'] && strtotime($u['protection_until']) > time()) {
            json_error('Cannot enable PvP while under newbie protection.');
        }
        $new = $u['pvp_mode'] ? 0 : 1;
        $db->prepare('UPDATE users SET pvp_mode=? WHERE id=?')->execute([$new, $uid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        enqueue_dirty_user($db, $uid, 'pvp_toggled');
        json_ok(['pvp_mode' => $new]);
        break;

    // ── Leaderboard ───────────────────────────────────────────────────────────
    case 'leaderboard':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            "SELECT u.id, u.username, u.rank_points, u.dark_matter,
                COUNT(DISTINCT c.id) AS planet_count,
                COALESCE(SUM(c.metal + c.crystal + c.deuterium), 0) AS total_resources,
                a.tag AS alliance_tag, a.name AS alliance_name
             FROM users u
             LEFT JOIN colonies c ON c.user_id = u.id
             LEFT JOIN alliance_members am ON am.user_id = u.id
             LEFT JOIN alliances a ON a.id = am.alliance_id
             WHERE u.control_type = 'human' AND u.auth_enabled = 1 AND u.deleted_at IS NULL
             GROUP BY u.id, u.username, u.rank_points, u.dark_matter, a.tag, a.name
             ORDER BY u.rank_points DESC, planet_count DESC
             LIMIT 50"
        );
        $stmt->execute();
        json_ok(['leaderboard' => $stmt->fetchAll()]);
        break;

    // ── FTL Drive Selection ───────────────────────────────────────────────────
    // First selection is free (when still on default 'aereth').
    // Changing an already-chosen drive costs 200 DM.
    case 'set_ftl_drive':
        only_method('POST');
        verify_csrf();
        $body  = get_json_body();
        $drive = $body['ftl_drive_type'] ?? '';
        $validDrives = get_playable_faction_codes();
        if (!in_array($drive, $validDrives, true)) {
            json_error('Invalid FTL drive type.');
        }
        $db   = get_db();
        $uRow = $db->prepare('SELECT ftl_drive_type, dark_matter FROM users WHERE id = ? LIMIT 1');
        $uRow->execute([$uid]);
        $u = $uRow->fetch();
        if (!$u) { json_error('User not found.'); }
        $current = $u['ftl_drive_type'];
        if ($current === $drive) {
            json_ok(['ftl_drive_type' => $drive, 'message' => 'Drive unchanged.']);
            break;
        }
        $CHANGE_COST = 200; // DM cost to change after initial selection
        $isInitial   = ($current === 'aereth'); // default → first real selection is free
        if (!$isInitial) {
            if ((int)$u['dark_matter'] < $CHANGE_COST) {
                json_error("Changing FTL drive costs {$CHANGE_COST} Dark Matter. You have {$u['dark_matter']} DM.");
            }
            $db->prepare('UPDATE users SET dark_matter = dark_matter - ? WHERE id = ?')
               ->execute([$CHANGE_COST, $uid]);
        }
        $db->prepare('UPDATE users SET ftl_drive_type = ?, ftl_cooldown_until = NULL WHERE id = ?')
           ->execute([$drive, $uid]);
        gq_cache_delete('game_overview', ['uid' => $uid]);
        $dmSpent = $isInitial ? 0 : $CHANGE_COST;
        enqueue_dirty_user($db, $uid, 'ftl_drive_changed');
        json_ok([
            'ftl_drive_type' => $drive,
            'dm_spent'       => $dmSpent,
            'message'        => $isInitial
                ? "FTL drive set to {$drive}. Welcome to your faction!"
                : "FTL drive changed to {$drive}. {$CHANGE_COST} DM spent.",
        ]);
        break;

    default:
        json_error('Unknown action');
}

function territory_factions_for_galaxy(PDO $db, int $uid, int $galaxy): array
{
    $factionIds = $db->query('SELECT id, base_diplomacy FROM npc_factions')->fetchAll();
    if ($factionIds) {
        $insert = $db->prepare('INSERT IGNORE INTO diplomacy (user_id, faction_id, standing) VALUES (?, ?, ?)');
        foreach ($factionIds as $factionRow) {
            $insert->execute([$uid, (int)$factionRow['id'], (int)$factionRow['base_diplomacy']]);
        }
    }

    $stmt = $db->prepare(
        'SELECT f.id, f.code, f.name, f.faction_type, f.power_level, f.color, f.icon,
                f.home_galaxy_min, f.home_galaxy_max,
                COALESCE(d.standing, f.base_diplomacy) AS standing
         FROM npc_factions f
         LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
         WHERE ? BETWEEN f.home_galaxy_min AND f.home_galaxy_max
         ORDER BY f.power_level DESC, f.id ASC'
    );
    $stmt->execute([$uid, $galaxy]);
    $rows = $stmt->fetchAll();

    $territory = [];
    foreach ($rows as $row) {
        $gov = get_faction_government($db, (int)$row['id']);
        $territory[] = [
            'id' => (int)$row['id'],
            'code' => (string)$row['code'],
            'name' => (string)$row['name'],
            'type' => (string)$row['faction_type'],
            'power_level' => (int)$row['power_level'],
            'color' => (string)$row['color'],
            'icon' => (string)$row['icon'],
            'standing' => (int)$row['standing'],
            'home_galaxy_min' => (int)$row['home_galaxy_min'],
            'home_galaxy_max' => (int)$row['home_galaxy_max'],
            'government' => [
                'form' => (string)($gov['government_form'] ?? ''),
                'label' => (string)($gov['form_label'] ?? 'Herrschaftsform'),
                'icon' => (string)($gov['form_icon'] ?? '🏳'),
                'color' => (string)($gov['form_color'] ?? $row['color']),
            ],
        ];
    }
    return $territory;
}

function summarize_scan_payload(?array $scanPayload): ?array
{
    if (!$scanPayload) {
        return null;
    }

    $ships = is_array($scanPayload['ships'] ?? null) ? $scanPayload['ships'] : [];
    $leaders = is_array($scanPayload['leaders'] ?? null) ? $scanPayload['leaders'] : [];
    $resources = is_array($scanPayload['resources'] ?? null) ? $scanPayload['resources'] : [];
    $welfare = is_array($scanPayload['welfare'] ?? null) ? $scanPayload['welfare'] : [];
    $healthPct = extract_scan_pct($scanPayload, [
        'integrity_pct',
        'health_pct',
        'hp_pct',
        'condition_pct',
    ]);
    $shieldPct = extract_scan_pct($scanPayload, [
        'shield_pct',
        'shields_pct',
        'planetary_shield_pct',
        'defense_shield_pct',
    ]);

    return [
        'status' => (string)($scanPayload['status'] ?? 'unknown'),
        'ship_count' => array_sum(array_map('intval', $ships)),
        'combat_power_estimate' => estimate_ship_threat($ships),
        'leader_count' => count($leaders),
        'resource_total' => (float)(($resources['metal'] ?? 0) + ($resources['crystal'] ?? 0) + ($resources['deuterium'] ?? 0)),
        'population' => (int)($welfare['population'] ?? 0),
        'happiness' => (int)($welfare['happiness'] ?? 0),
        'health_pct' => $healthPct,
        'shield_pct' => $shieldPct,
    ];
}

/**
 * Read a percentage value from known scan payload key locations.
 * Returns null when no plausible percentage is present.
 */
function extract_scan_pct(array $scanPayload, array $keys): ?int
{
    $candidates = [$scanPayload];
    if (is_array($scanPayload['colony'] ?? null)) {
        $candidates[] = $scanPayload['colony'];
    }
    if (is_array($scanPayload['defense'] ?? null)) {
        $candidates[] = $scanPayload['defense'];
    }
    if (is_array($scanPayload['fortifications'] ?? null)) {
        $candidates[] = $scanPayload['fortifications'];
    }

    foreach ($candidates as $source) {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $source)) {
                continue;
            }
            $value = $source[$key];
            if (!is_numeric($value)) {
                continue;
            }
            $pct = (int)round((float)$value);
            if ($pct < 0 || $pct > 100) {
                continue;
            }
            return $pct;
        }
    }

    return null;
}

function compute_planet_threat(array $planet, ?array $scanPayload, array $territory): array
{
    $scanSummary = summarize_scan_payload($scanPayload);
    $territoryPressure = 0;
    foreach ($territory as $faction) {
        $territoryPressure += max(0, (int)$faction['power_level']) / 1500;
        if ((int)$faction['standing'] < -20) {
            $territoryPressure += 8;
        }
    }

    $score = 6 + $territoryPressure;
    $score += min(35, (int)round(((int)($planet['population'] ?? 0)) / 250));
    $score += max(0, 12 - (int)round(((int)($planet['happiness'] ?? 0)) / 8));
    if ($scanSummary) {
        $score += min(40, (int)round(($scanSummary['combat_power_estimate'] ?? 0) / 250));
        $score += min(15, (int)round(($scanSummary['ship_count'] ?? 0) / 3));
        $score += min(8, (int)($scanSummary['leader_count'] ?? 0) * 2);
    } else {
        $score += 10;
    }

    $level = 'low';
    $label = 'Niedrig';
    if ($score >= 85) {
        $level = 'extreme';
        $label = 'Extrem';
    } elseif ($score >= 60) {
        $level = 'high';
        $label = 'Hoch';
    } elseif ($score >= 35) {
        $level = 'medium';
        $label = 'Mittel';
    }

    return [
        'score' => (int)round($score),
        'level' => $level,
        'label' => $label,
    ];
}

function estimate_ship_threat(array $ships): int
{
    $defs = ship_definitions();
    $total = 0;
    foreach ($ships as $type => $count) {
        $def = $defs[(string)$type] ?? null;
        if (!$def) {
            continue;
        }
        $attack = (float)($def['attack'] ?? 0);
        $shield = (float)($def['shield'] ?? 0);
        $hull = (float)($def['hull'] ?? 0);
        $total += (int)round(((int)$count) * ($attack + ($shield * 0.5) + ($hull / 1200)));
    }
    return $total;
}

function build_diplomacy_hint(array $territory, array $threat): string
{
    if (!$territory) {
        return 'Kein etablierter Machtblock in diesem Sektor erfasst. Aufklärung empfohlen.';
    }

    $friendly = array_values(array_filter($territory, static fn(array $f): bool => (int)$f['standing'] >= 20));
    $hostile = array_values(array_filter($territory, static fn(array $f): bool => (int)$f['standing'] <= -20));

    if ($threat['level'] === 'extreme' || $threat['level'] === 'high') {
        if ($hostile) {
            return 'Militärischer Druck in diesem Sektor ist erhöht. Erst aufklären, dann nur mit Eskorte oder Schlagflotte operieren.';
        }
        return 'Die Kolonie wirkt stark gesichert. Spionage oder Probeangriff vor jeder größeren Operation einplanen.';
    }
    if ($friendly) {
        return 'Diplomatische Lage im Sektor ist stabil. Handel oder begrenzte Präsenz sind wahrscheinlicher als sofortige Eskalation.';
    }
    return 'Gemischte diplomatische Lage. Erst letzte Aufklärung sichern und Flottenprofil an die Missionsart anpassen.';
}
