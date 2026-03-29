<?php
/**
 * scripts/recompile_blueprints.php
 *
 * Re-compiles compiled_stats_json / compiled_cost_json / compiled_time_secs
 * for all (or a subset of) vessel_blueprints.
 *
 * Use this after schema/seed changes that added new compiled stat fields
 * (e.g. energy_output, weapon_efficiency, attack_energy_share).
 *
 * Usage:
 *   docker compose exec -T web php scripts/recompile_blueprints.php
 *   docker compose exec -T web php scripts/recompile_blueprints.php --dry-run
 *   docker compose exec -T web php scripts/recompile_blueprints.php --ids=1,2,5
 *   docker compose exec -T web php scripts/recompile_blueprints.php --user=3
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../api/helpers.php';
require_once __DIR__ . '/../api/game_engine.php';

// ── Local replacements for shipyard.php utilities ────────────────────────────
// We cannot require api/shipyard.php directly because it runs as an endpoint
// (calls require_auth() at global scope). Define what we need inline.
// vessel_blueprint_tables_exist() is provided by game_engine.php (required above)
// cli_hull_energy_cols_available() is defined above for the energy-columns check

function cli_hull_energy_cols_available(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) return $cached;
    $row = $db->query(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'vessel_hulls'
           AND COLUMN_NAME IN (
               'base_energy_output','base_energy_capacity','base_energy_upkeep',
               'base_weapon_efficiency','base_shield_efficiency','base_attack_energy_share'
           )"
    )->fetchColumn();
    return ($cached = ((int)$row === 6));
}

// ── Lightweight stat compiler (no unlock checks, no faction affinities) ──────
// Used only in this backfill script; authoritative compile lives in shipyard.php.
function cli_compile_blueprint_stats(array $hull, array $moduleRows): array {
    $energyCols = ['energy_output', 'energy_capacity', 'energy_upkeep'];
    $stats = [
        'attack'              => (float)($hull['base_attack'] ?? 0),
        'shield'              => (float)($hull['base_shield'] ?? 0),
        'hull'                => (float)($hull['base_hull'] ?? 0),
        'cargo'               => (float)($hull['base_cargo'] ?? 0),
        'speed'               => (float)($hull['base_speed'] ?? 1000),
        'energy_output'       => (float)($hull['base_energy_output'] ?? 0),
        'energy_capacity'     => (float)($hull['base_energy_capacity'] ?? 0),
        'energy_upkeep'       => (float)($hull['base_energy_upkeep'] ?? 0),
        'weapon_efficiency'   => (float)($hull['base_weapon_efficiency'] ?? 1.0),
        'shield_efficiency'   => (float)($hull['base_shield_efficiency'] ?? 1.0),
        'attack_energy_share' => (float)($hull['base_attack_energy_share'] ?? 0.5),
    ];

    $cost      = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0];
    $timeSecs  = (int)($hull['build_time_secs'] ?? 0);
    $hullCost  = json_decode((string)($hull['build_cost_json'] ?? '{}'), true);
    if (is_array($hullCost)) {
        foreach (['metal', 'crystal', 'deuterium'] as $k) {
            $cost[$k] += (float)($hullCost[$k] ?? 0);
        }
    }

    foreach ($moduleRows as $mod) {
        $qty   = (int)($mod['quantity'] ?? 1);
        $delta = json_decode((string)($mod['stats_delta_json'] ?? '{}'), true);
        if (!is_array($delta)) {
            $delta = [];
        }

        foreach (['attack', 'shield', 'hull', 'cargo', 'speed', 'energy_output', 'energy_capacity', 'energy_upkeep'] as $k) {
            $stats[$k] += (float)($delta[$k] ?? 0) * $qty;
        }
        $stats['weapon_efficiency']   += (float)($delta['weapon_efficiency_delta'] ?? 0) * $qty;
        $stats['shield_efficiency']   += (float)($delta['shield_efficiency_delta'] ?? 0) * $qty;
        $stats['attack_energy_share'] += (float)($delta['attack_energy_share_delta'] ?? 0) * $qty;

        $modCost = json_decode((string)($mod['build_cost_json'] ?? '{}'), true);
        if (is_array($modCost)) {
            foreach (['metal', 'crystal', 'deuterium'] as $k) {
                $cost[$k] += (float)($modCost[$k] ?? 0) * $qty;
            }
        }
        $timeSecs += (int)($mod['build_time_secs'] ?? 0) * $qty;
    }

    foreach (['attack', 'shield', 'hull', 'cargo', 'speed', 'energy_output', 'energy_capacity', 'energy_upkeep'] as $k) {
        $stats[$k] = (float)round(max(0.0, $stats[$k]), 2);
    }
    $stats['weapon_efficiency']   = (float)round(max(0.5, min(1.6, $stats['weapon_efficiency'])), 4);
    $stats['shield_efficiency']   = (float)round(max(0.5, min(1.6, $stats['shield_efficiency'])), 4);
    $stats['attack_energy_share'] = (float)round(max(0.0, min(1.0, $stats['attack_energy_share'])), 4);

    foreach (['metal', 'crystal', 'deuterium'] as $k) {
        $cost[$k] = (float)round($cost[$k], 2);
    }

    return ['stats' => $stats, 'cost' => $cost, 'time_secs' => max(1, $timeSecs)];
}

$dryRun       = false;
$filterIds    = [];
$filterUserId = null;

foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--dry-run') {
        $dryRun = true;
        continue;
    }
    if (str_starts_with($arg, '--ids=')) {
        $raw = substr($arg, 6);
        foreach (explode(',', $raw) as $raw_id) {
            $id = (int)trim($raw_id);
            if ($id > 0) {
                $filterIds[] = $id;
            }
        }
        continue;
    }
    if (str_starts_with($arg, '--user=')) {
        $filterUserId = (int)substr($arg, 7);
        continue;
    }
    echo "Unknown argument: $arg\n";
}

$db = get_db();

if (!vessel_blueprint_tables_exist($db)) {
    echo "Blueprint tables not found – run migrate_vessel_blueprints_v1.sql first.\n";
    exit(1);
}

// ── Load blueprints to recompile ──────────────────────────────────────────────
$whereParts = [];
$params     = [];

if ($filterIds) {
    $placeholders = implode(',', array_fill(0, count($filterIds), '?'));
    $whereParts[] = "vb.id IN ($placeholders)";
    $params = array_merge($params, $filterIds);
}
if ($filterUserId !== null) {
    $whereParts[] = 'vb.user_id = ?';
    $params[]     = $filterUserId;
}

$whereClause = $whereParts ? ('WHERE ' . implode(' AND ', $whereParts)) : '';

$energyCols = cli_hull_energy_cols_available($db)
    ? ', vh.base_energy_output, vh.base_energy_capacity, vh.base_energy_upkeep,
       vh.base_weapon_efficiency, vh.base_shield_efficiency, vh.base_attack_energy_share'
    : '';

$rows = $db->prepare(
    "SELECT vb.id AS blueprint_id,
            vb.user_id, vb.name AS blueprint_name, vb.hull_id,
            vb.slot_layout_code,
            vh.code AS hull_code, vh.base_attack, vh.base_shield, vh.base_hull, vh.base_cargo, vh.base_speed{$energyCols},
            vh.base_mass, vh.build_time_secs AS hull_time_secs, vh.build_cost_json AS hull_cost_json,
            vh.slot_profile_json, vh.slot_variation_json, vh.research_req_json AS hull_research_req_json,
            vh.build_req_json, vh.faction_tag AS hull_faction_tag
     FROM vessel_blueprints vb
     JOIN vessel_hulls vh ON vh.id = vb.hull_id
     {$whereClause}
     ORDER BY vb.id ASC"
);
$rows->execute($params);
$blueprints = $rows->fetchAll(PDO::FETCH_ASSOC);

if (!$blueprints) {
    echo "No blueprints found to recompile.\n";
    exit(0);
}

echo sprintf(
    "%sRecompiling %d blueprint(s)…\n",
    $dryRun ? '[DRY RUN] ' : '',
    count($blueprints)
);

// ── Module query (reused per blueprint) ──────────────────────────────────────
$modStmt = $db->prepare(
    'SELECT m.id AS module_id, m.code, m.label, m.tier, m.build_time_secs, m.build_cost_json, m.stats_delta_json,
            mg.code AS group_code, vbm.slot_index, vbm.quantity
     FROM vessel_blueprint_modules vbm
     JOIN modules m ON m.id = vbm.module_id
     JOIN module_groups mg ON mg.id = m.group_id
     WHERE vbm.blueprint_id = ?
     ORDER BY vbm.slot_index ASC'
);

$updateStmt = $db->prepare(
    'UPDATE vessel_blueprints
     SET compiled_stats_json = ?,
         compiled_cost_json  = ?,
         compiled_time_secs  = ?,
         version             = version + 1,
         updated_at          = NOW()
     WHERE id = ?'
);

$okCount   = 0;
$skipCount = 0;
$errCount  = 0;

foreach ($blueprints as $bp) {
    $blueprintId   = (int)$bp['blueprint_id'];
    $name          = (string)($bp['blueprint_name'] ?? "ID $blueprintId");
    $uid           = (int)($bp['user_id'] ?? 0);
    $slotLayoutCode = (string)($bp['slot_layout_code'] ?? 'default');

    // Rebuild hull array compatible with compile_shipyard_blueprint()
    $hull = [
        'id'                      => $bp['hull_id'],
        'base_attack'             => (float)($bp['base_attack'] ?? 0),
        'base_shield'             => (float)($bp['base_shield'] ?? 0),
        'base_hull'               => (float)($bp['base_hull'] ?? 0),
        'base_cargo'              => (float)($bp['base_cargo'] ?? 0),
        'base_speed'              => (float)($bp['base_speed'] ?? 1000),
        'base_energy_output'      => (float)($bp['base_energy_output'] ?? 0),
        'base_energy_capacity'    => (float)($bp['base_energy_capacity'] ?? 0),
        'base_energy_upkeep'      => (float)($bp['base_energy_upkeep'] ?? 0),
        'base_weapon_efficiency'  => (float)($bp['base_weapon_efficiency'] ?? 1.0),
        'base_shield_efficiency'  => (float)($bp['base_shield_efficiency'] ?? 1.0),
        'base_attack_energy_share'=> (float)($bp['base_attack_energy_share'] ?? 0.5),
        'base_mass'               => (float)($bp['base_mass'] ?? 0),
        'build_time_secs'         => (int)($bp['hull_time_secs'] ?? 0),
        'build_cost_json'         => (string)($bp['hull_cost_json'] ?? '{}'),
        'slot_profile_json'       => (string)($bp['slot_profile_json'] ?? '{}'),
        'slot_variation_json'     => (string)($bp['slot_variation_json'] ?? '{}'),
        'research_req_json'       => (string)($bp['hull_research_req_json'] ?? '{}'),
        'build_req_json'          => (string)($bp['build_req_json'] ?? '{}'),
        'faction_tag'             => (string)($bp['hull_faction_tag'] ?? ''),
    ];

    // Load module entries for this blueprint
    $modStmt->execute([$blueprintId]);
    $modRows = $modStmt->fetchAll(PDO::FETCH_ASSOC);

    if (!$modRows) {
        echo "  SKIP  #$blueprintId \"$name\" – no modules found\n";
        $skipCount++;
        continue;
    }

    try {
        // Use the local CLI compiler – no unlock/affinity checks.
        $compiled = cli_compile_blueprint_stats($hull, $modRows);
    } catch (Throwable $e) {
        echo "  ERR   #$blueprintId \"$name\" – " . $e->getMessage() . "\n";
        $errCount++;
        continue;
    }

    if ($dryRun) {
        $energyLine = sprintf(
            'energy_out=%.2f cap=%.2f upkeep=%.2f weff=%.4f seff=%.4f eshr=%.4f',
            $compiled['stats']['energy_output'] ?? 0,
            $compiled['stats']['energy_capacity'] ?? 0,
            $compiled['stats']['energy_upkeep'] ?? 0,
            $compiled['stats']['weapon_efficiency'] ?? 1,
            $compiled['stats']['shield_efficiency'] ?? 1,
            $compiled['stats']['attack_energy_share'] ?? 0.5
        );
        echo "  DRY   #$blueprintId \"$name\" – $energyLine\n";
        $okCount++;
        continue;
    }

    try {
        $updateStmt->execute([
            json_encode($compiled['stats']),
            json_encode($compiled['cost']),
            (int)$compiled['time_secs'],
            $blueprintId,
        ]);
        $affected = $updateStmt->rowCount();
        $energyLine = sprintf(
            'energy_out=%.2f upkeep=%.2f eshr=%.4f',
            $compiled['stats']['energy_output'] ?? 0,
            $compiled['stats']['energy_upkeep'] ?? 0,
            $compiled['stats']['attack_energy_share'] ?? 0.5
        );
        echo "  OK    #$blueprintId \"$name\" – rows=$affected $energyLine\n";
        $okCount++;
    } catch (Throwable $e) {
        echo "  ERR   #$blueprintId \"$name\" – DB update failed: " . $e->getMessage() . "\n";
        $errCount++;
    }
}

echo sprintf(
    "\nDone: %d ok, %d skipped, %d errors\n",
    $okCount, $skipCount, $errCount
);
exit($errCount > 0 ? 1 : 0);
