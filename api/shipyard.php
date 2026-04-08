<?php
/**
 * Shipyard API
 * GET  /api/shipyard.php?action=list&colony_id=X
 * POST /api/shipyard.php?action=build  body: {colony_id, type, count}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';
require_once __DIR__ . '/shipyard_queue.php';

if (PHP_SAPI !== 'cli') {

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        action_shipyard_list(get_db(), $uid, (int)($_GET['colony_id'] ?? 0));
        break;

    case 'list_hulls':
        only_method('GET');
        action_list_hulls(get_db(), $uid, (int)($_GET['colony_id'] ?? 0));
        break;

    case 'list_modules':
        only_method('GET');
        action_list_modules(
            get_db(),
            $uid,
            (int)($_GET['colony_id'] ?? 0),
            (string)($_GET['hull_code'] ?? ''),
            (string)($_GET['slot_layout_code'] ?? 'default')
        );
        break;

    case 'list_blueprints':
        only_method('GET');
        action_list_blueprints(get_db(), $uid, (int)($_GET['colony_id'] ?? 0));
        break;

    case 'list_vessels':
        only_method('GET');
        action_list_vessels(get_db(), $uid, (int)($_GET['colony_id'] ?? 0));
        break;

    case 'decommission_vessel':
        only_method('POST');
        verify_csrf();
        action_decommission_vessel(get_db(), $uid, get_json_body());
        break;

    case 'create_blueprint':
        only_method('POST');
        verify_csrf();
        action_create_blueprint(get_db(), $uid, get_json_body());
        break;

    case 'delete_blueprint':
        only_method('POST');
        verify_csrf();
        action_delete_blueprint(get_db(), $uid, get_json_body());
        break;

    case 'build':
        only_method('POST');
        verify_csrf();
        $body  = get_json_body();
        $cid   = (int)($body['colony_id'] ?? 0);
        $type  = $body['type'] ?? '';
        $count = max(1, (int)($body['count'] ?? 1));
        $db    = get_db();
        verify_colony_ownership($db, $cid, $uid);

        if (get_building_level($db, $cid, 'shipyard') < 1) {
            json_error('A Shipyard building is required.');
        }

        ensure_ship_build_queue_table($db);
        complete_ship_build_queue($db, $cid);

        $blueprintId = (int)($body['blueprint_id'] ?? 0);
        $buildType = resolve_shipyard_build_type($db, $uid, $type, $blueprintId);
        if (!ship_exists_runtime($buildType, $db)) {
            json_error('Unknown ship type.');
        }

        update_colony_resources($db, $cid);
        $cost      = ship_cost($buildType);
        
        // Apply colony-type ship cost bonus (industrial colony −10%)
        $colonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
        $colonyStmt->execute([$cid]);
        $colonyRow = $colonyStmt->fetch();
        if ($colonyRow && $colonyRow['colony_type'] === 'industrial') {
            $cost['metal']     = (int)round($cost['metal']     * 0.9);
            $cost['crystal']   = (int)round($cost['crystal']   * 0.9);
            $cost['deuterium'] = (int)round($cost['deuterium'] * 0.9);
        }
        
        $totalCost = [
            'metal'     => $cost['metal']     * $count,
            'crystal'   => $cost['crystal']   * $count,
            'deuterium' => $cost['deuterium'] * $count,
        ];

        $colony = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ?');
        $colony->execute([$cid]);
        $res = $colony->fetch();

        if ($res['metal'] < $totalCost['metal']
            || $res['crystal'] < $totalCost['crystal']
            || $res['deuterium'] < $totalCost['deuterium']) {
            json_error('Insufficient resources.');
        }

        $db->prepare(
            'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
        )->execute([$totalCost['metal'], $totalCost['crystal'], $totalCost['deuterium'], $cid]);

        $durationSecs = estimate_ship_build_duration($db, $cid, $buildType, $count);
        $db->prepare(
            'INSERT INTO ship_build_queue
             (colony_id, ship_type, blueprint_id, quantity, cost_metal, cost_crystal, cost_deuterium,
              duration_secs, queued_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), \'queued\')'
        )->execute([
            $cid,
            $buildType,
            $blueprintId > 0 ? $blueprintId : null,
            $count,
            (int)$totalCost['metal'],
            (int)$totalCost['crystal'],
            (int)$totalCost['deuterium'],
            $durationSecs,
        ]);
        $queueId = (int)$db->lastInsertId();

        gq_cache_delete('shipyard_list', ['uid' => $uid, 'cid' => $cid]);
        gq_cache_delete('buildings_list', ['uid' => $uid, 'cid' => $cid]);

        start_next_ship_build_queue($db, $cid);
        $queue = list_ship_build_queue($db, $cid);
        $queuedEntry = null;
        foreach ($queue as $entry) {
            if ((int)($entry['id'] ?? 0) === $queueId) {
                $queuedEntry = $entry;
                break;
            }
        }

        json_ok([
            'queued' => true,
            'queue_id' => $queueId,
            'queue_position' => (int)($queuedEntry['position'] ?? 1),
            'quantity' => $count,
            'duration_secs' => $durationSecs,
            'eta' => $queuedEntry['eta'] ?? null,
            'status' => $queuedEntry['status'] ?? 'queued',
            'type' => $buildType,
            'blueprint_id' => $blueprintId > 0 ? $blueprintId : null,
        ]);
        break;

    default:
        json_error('Unknown action');
}

} // end if (PHP_SAPI !== 'cli')

function action_shipyard_list(PDO $db, int $uid, int $cid): never {
    verify_colony_ownership($db, $cid, $uid);
    ensure_ship_build_queue_table($db);
    complete_ship_build_queue($db, $cid);

    $cacheKeyParams = ['uid' => $uid, 'cid' => $cid];
    $hasPendingQueue = ship_build_queue_has_pending($db, $cid);
    $cached = $hasPendingQueue ? null : gq_cache_get('shipyard_list', $cacheKeyParams);
    if (is_array($cached) && isset($cached['ships'])) {
        json_ok($cached);
    }

    $queue = list_ship_build_queue($db, $cid);
    $queueSummary = summarize_ship_build_queue($queue);

    $rows = $db->prepare('SELECT type, count FROM ships WHERE colony_id = ?');
    $rows->execute([$cid]);
    $ships = [];
    foreach ($rows->fetchAll() as $r) {
        $ships[$r['type']] = (int)$r['count'];
    }

    $legacy = [];
    foreach (array_keys(SHIP_STATS) as $type) {
        $legacy[] = [
            'type'  => $type,
            'count' => $ships[$type] ?? 0,
            'queued_count' => (int)($queueSummary[$type]['queued_count'] ?? 0),
            'running_count' => (int)($queueSummary[$type]['running_count'] ?? 0),
            'active_eta' => $queueSummary[$type]['active_eta'] ?? null,
            'cost'  => ship_cost($type),
            'cargo' => ship_cargo($type),
            'speed' => ship_speed($type),
            'source' => 'legacy',
        ];
    }

    $payload = [
        'ships' => $legacy,
        'blueprints' => list_shipyard_blueprints($db, $uid, $cid, $ships),
        'queue' => $queue,
    ];
    if (!$hasPendingQueue) {
        gq_cache_set('shipyard_list', $cacheKeyParams, $payload, CACHE_TTL_DEFAULT);
    }
    json_ok($payload);
}

function action_list_blueprints(PDO $db, int $uid, int $cid): never {
    verify_colony_ownership($db, $cid, $uid);
    json_ok(['blueprints' => list_shipyard_blueprints($db, $uid, $cid)]);
}

function action_create_blueprint(PDO $db, int $uid, array $body): never {
    if (!vessel_blueprint_tables_exist($db)) {
        json_error('Blueprint tables are not available. Run the vessel blueprint migration first.', 409);
    }

    $cid = (int)($body['colony_id'] ?? 0);
    $name = trim((string)($body['name'] ?? ''));
    $code = trim((string)($body['code'] ?? ''));
    $hullCode = trim((string)($body['hull_code'] ?? ''));
    $slotLayoutCode = trim((string)($body['slot_layout_code'] ?? 'default'));
    $modules = is_array($body['modules'] ?? null) ? $body['modules'] : [];
    $doctrineTag = trim((string)($body['doctrine_tag'] ?? 'custom'));

    if ($cid <= 0 || $name === '' || $hullCode === '') {
        json_error('colony_id, name and hull_code are required.');
    }
    verify_colony_ownership($db, $cid, $uid);
    if (!$modules) {
        json_error('At least one module is required.');
    }

    if ($code === '') {
        $code = strtolower(trim(preg_replace('/[^a-zA-Z0-9_\-]+/', '_', $name) ?? 'blueprint', '_'));
    }

    $hull = fetch_active_hull_by_code($db, $hullCode);
    if (!$hull) {
        json_error('Unknown hull_code.');
    }

    $hullGate = evaluate_shipyard_unlock_state(
        $db,
        $uid,
        $cid,
        json_decode((string)($hull['research_req_json'] ?? '{}'), true),
        json_decode((string)($hull['build_req_json'] ?? '{}'), true),
        (string)($hull['faction_tag'] ?? '')
    );
    if (!$hullGate['unlocked']) {
        json_error('Hull requirements not met: ' . implode('; ', $hullGate['blockers']), 403);
    }

    $compiled = compile_shipyard_blueprint($db, $uid, $cid, $hull, $modules, $slotLayoutCode);

    try {
        $db->beginTransaction();
        $ins = $db->prepare(
            'INSERT INTO vessel_blueprints
                (user_id, code, name, hull_id, doctrine_tag, source_type, is_public, version,
                 slot_layout_code, compiled_stats_json, compiled_cost_json, compiled_slot_profile_json, compiled_time_secs)
             VALUES (?, ?, ?, ?, ?, \'player\', 0, 1, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $uid,
            $code,
            $name,
            (int)$hull['id'],
            $doctrineTag,
            $compiled['slot_layout_code'],
            json_encode($compiled['stats']),
            json_encode($compiled['cost']),
            json_encode($compiled['slot_profile']),
            (int)$compiled['time_secs'],
        ]);

        $blueprintId = (int)$db->lastInsertId();
        $modIns = $db->prepare(
            'INSERT INTO vessel_blueprint_modules (blueprint_id, module_id, slot_index, quantity)
             VALUES (?, ?, ?, ?)'
        );
        foreach ($compiled['module_rows'] as $row) {
            $modIns->execute([$blueprintId, $row['module_id'], $row['slot_index'], $row['quantity']]);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        if (stripos($e->getMessage(), 'Duplicate') !== false) {
            json_error('Blueprint code already exists for this user.', 409);
        }
        throw $e;
    }

    json_ok([
        'blueprint_id' => $blueprintId,
        'type' => blueprint_ship_type_code($blueprintId),
        'ship_class' => (string)($hull['ship_class'] ?? $hull['role'] ?? 'corvette'),
        'slot_layout_code' => $compiled['slot_layout_code'],
        'slot_profile' => $compiled['slot_profile'],
        'compiled_stats' => $compiled['stats'],
        'compiled_cost' => $compiled['cost'],
        'compiled_time_secs' => (int)$compiled['time_secs'],
    ]);
}

function action_list_modules(PDO $db, int $uid, int $cid, string $hullCode, string $slotLayoutCode): never {
    verify_colony_ownership($db, $cid, $uid);
    if (!vessel_blueprint_tables_exist($db)) {
        json_ok(['module_groups' => [], 'slot_profile' => []]);
    }
    if ($hullCode === '') {
        json_error('hull_code is required.', 400);
    }

    $hull = fetch_active_hull_by_code($db, $hullCode);
    if (!$hull) {
        json_error('Unknown hull_code.', 404);
    }

    $slotProfile = resolve_hull_slot_profile($hull, $slotLayoutCode);
    $hullUnlock = evaluate_shipyard_unlock_state(
        $db,
        $uid,
        $cid,
        json_decode((string)($hull['research_req_json'] ?? '{}'), true),
        json_decode((string)($hull['build_req_json'] ?? '{}'), true),
        (string)($hull['faction_tag'] ?? '')
    );
    $stmt = $db->prepare(
        'SELECT mg.code AS group_code, mg.label AS group_label,
                hmc.slot_count, hmc.max_module_tier,
                m.id AS module_id, m.code AS module_code, m.label AS module_label,
                m.tier AS module_tier, m.rarity, m.stats_delta_json, m.build_cost_json, m.build_time_secs,
                m.research_req_json, m.shipyard_req_json, m.faction_tag
         FROM hull_module_compatibility hmc
         JOIN module_groups mg ON mg.id = hmc.group_id
         LEFT JOIN modules m ON m.group_id = mg.id
              AND m.is_active = 1
              AND m.tier <= hmc.max_module_tier
         WHERE hmc.hull_id = ?
         ORDER BY mg.id ASC, m.tier ASC, m.id ASC'
    );
    $stmt->execute([(int)$hull['id']]);

    $groups = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $groupCode = (string)($row['group_code'] ?? '');
        if ($groupCode === '') {
            continue;
        }

        if (!isset($groups[$groupCode])) {
            $effectiveSlots = (int)($slotProfile[$groupCode] ?? ($row['slot_count'] ?? 0));
            $groups[$groupCode] = [
                'code' => $groupCode,
                'label' => (string)($row['group_label'] ?? $groupCode),
                'slot_count' => max(0, $effectiveSlots),
                'max_module_tier' => (int)($row['max_module_tier'] ?? 99),
                'modules' => [],
            ];
        }

        if (!isset($row['module_id']) || $row['module_id'] === null) {
            continue;
        }

        $statsDelta = json_decode((string)($row['stats_delta_json'] ?? '{}'), true);
        $buildCost = json_decode((string)($row['build_cost_json'] ?? '{}'), true);
        $unlock = evaluate_shipyard_unlock_state(
            $db,
            $uid,
            $cid,
            json_decode((string)($row['research_req_json'] ?? '{}'), true),
            json_decode((string)($row['shipyard_req_json'] ?? '{}'), true),
            (string)($row['faction_tag'] ?? '')
        );
        $groups[$groupCode]['modules'][] = [
            'id' => (int)$row['module_id'],
            'code' => (string)($row['module_code'] ?? ''),
            'label' => (string)($row['module_label'] ?? ''),
            'tier' => (int)($row['module_tier'] ?? 1),
            'rarity' => (string)($row['rarity'] ?? 'common'),
            'stats_delta' => is_array($statsDelta) ? $statsDelta : [],
            'build_cost' => is_array($buildCost) ? $buildCost : [],
            'build_time_secs' => (int)($row['build_time_secs'] ?? 0),
            'unlocked' => (bool)$unlock['unlocked'],
            'blockers' => $unlock['blockers'],
        ];
    }

    // Attach faction tech affinities per group for display
    $affinityDisplay = load_faction_tech_affinities_display($db, $uid);
    foreach ($groups as $groupCode => &$groupData) {
        $groupData['affinities'] = $affinityDisplay[$groupCode] ?? [];
    }
    unset($groupData);

    json_ok([
        'hull_code' => (string)$hull['code'],
        'ship_class' => (string)($hull['ship_class'] ?? $hull['role'] ?? 'corvette'),
        'slot_layout_code' => $slotLayoutCode !== '' ? $slotLayoutCode : 'default',
        'slot_profile' => $slotProfile,
        'hull_unlocked' => (bool)$hullUnlock['unlocked'],
        'hull_blockers' => $hullUnlock['blockers'],
        'module_groups' => array_values($groups),
    ]);
}

function action_list_hulls(PDO $db, int $uid, int $cid): never {
    verify_colony_ownership($db, $cid, $uid);
    if (!vessel_blueprint_tables_exist($db)) {
        json_ok(['hulls' => []]);
    }

    $energyCols = vessel_hull_energy_columns_available($db)
        ? ', base_energy_output, base_energy_capacity, base_energy_upkeep,
           base_weapon_efficiency, base_shield_efficiency, base_attack_energy_share'
        : '';
    $stmt = $db->query(
        'SELECT id, code, label, role, ship_class, tier, base_attack, base_shield, base_hull, base_cargo, base_speed'
        . $energyCols . ',
                slot_profile_json, slot_variation_json, research_req_json, build_req_json,
                build_cost_json, build_time_secs, faction_tag
         FROM vessel_hulls
         WHERE is_active = 1
         ORDER BY tier ASC, id ASC'
    );

    $hulls = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $slotProfile = json_decode((string)($row['slot_profile_json'] ?? '{}'), true);
        $slotVariations = json_decode((string)($row['slot_variation_json'] ?? '{}'), true);
        $cost = json_decode((string)($row['build_cost_json'] ?? '{}'), true);
        $unlock = evaluate_shipyard_unlock_state(
            $db,
            $uid,
            $cid,
            json_decode((string)($row['research_req_json'] ?? '{}'), true),
            json_decode((string)($row['build_req_json'] ?? '{}'), true),
            (string)($row['faction_tag'] ?? '')
        );
        $hulls[] = [
            'id' => (int)$row['id'],
            'code' => (string)$row['code'],
            'label' => (string)$row['label'],
            'role' => (string)$row['role'],
            'ship_class' => (string)($row['ship_class'] ?? $row['role'] ?? 'corvette'),
            'tier' => (int)($row['tier'] ?? 1),
            'base_stats' => [
                'attack' => (float)($row['base_attack'] ?? 0),
                'shield' => (float)($row['base_shield'] ?? 0),
                'hull' => (float)($row['base_hull'] ?? 0),
                'cargo' => (float)($row['base_cargo'] ?? 0),
                'speed' => (float)($row['base_speed'] ?? 0),
                'energy_output' => (float)($row['base_energy_output'] ?? 0),
                'energy_capacity' => (float)($row['base_energy_capacity'] ?? 0),
                'energy_upkeep' => (float)($row['base_energy_upkeep'] ?? 0),
                'weapon_efficiency' => (float)($row['base_weapon_efficiency'] ?? 1),
                'shield_efficiency' => (float)($row['base_shield_efficiency'] ?? 1),
                'attack_energy_share' => (float)($row['base_attack_energy_share'] ?? 0.5),
            ],
            'slot_profile' => is_array($slotProfile) ? $slotProfile : [],
            'slot_variations' => is_array($slotVariations) ? $slotVariations : [],
            'build_cost' => is_array($cost) ? $cost : [],
            'build_time_secs' => (int)($row['build_time_secs'] ?? 0),
            'faction_tag' => $row['faction_tag'] ?? null,
            'unlocked' => (bool)$unlock['unlocked'],
            'blockers' => $unlock['blockers'],
        ];
    }

    json_ok(['hulls' => $hulls]);
}

function resolve_shipyard_build_type(PDO $db, int $uid, string $legacyType, int $blueprintId): string {
    if ($blueprintId > 0) {
        if (!vessel_blueprint_tables_exist($db)) {
            json_error('Blueprint tables are not available.');
        }
        $stmt = $db->prepare('SELECT id FROM vessel_blueprints WHERE id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1');
        $stmt->execute([$blueprintId, $uid]);
        if (!$stmt->fetchColumn()) {
            json_error('Blueprint not found.', 404);
        }
        return blueprint_ship_type_code($blueprintId);
    }

    return $legacyType;
}

function list_shipyard_blueprints(PDO $db, int $uid, int $cid, array $shipCounts = []): array {
    if (!vessel_blueprint_tables_exist($db)) {
        return [];
    }

    if (!$shipCounts) {
        $rows = $db->prepare('SELECT type, count FROM ships WHERE colony_id = ?');
        $rows->execute([$cid]);
        foreach ($rows->fetchAll() as $r) {
            $shipCounts[(string)$r['type']] = (int)$r['count'];
        }
    }

    $stmt = $db->prepare(
        'SELECT vb.id, vb.code, vb.name, vb.doctrine_tag, vb.source_type, vb.compiled_stats_json,
                vb.compiled_cost_json, vb.compiled_slot_profile_json, vb.slot_layout_code, vb.compiled_time_secs,
                vh.code AS hull_code, vh.label AS hull_label, vh.ship_class
         FROM vessel_blueprints vb
         JOIN vessel_hulls vh ON vh.id = vb.hull_id
         WHERE vb.user_id = ? OR vb.user_id IS NULL
         ORDER BY vb.updated_at DESC, vb.id DESC'
    );
    $stmt->execute([$uid]);

    $blueprints = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $type = blueprint_ship_type_code((int)$row['id']);
        $stats = json_decode((string)($row['compiled_stats_json'] ?? '{}'), true);
        $cost = json_decode((string)($row['compiled_cost_json'] ?? '{}'), true);
        $slotProfile = json_decode((string)($row['compiled_slot_profile_json'] ?? '{}'), true);
        $blueprints[] = [
            'id' => (int)$row['id'],
            'type' => $type,
            'code' => (string)$row['code'],
            'name' => (string)$row['name'],
            'hull_code' => (string)$row['hull_code'],
            'hull_label' => (string)$row['hull_label'],
            'ship_class' => (string)($row['ship_class'] ?? 'corvette'),
            'doctrine_tag' => (string)($row['doctrine_tag'] ?? 'custom'),
            'source_type' => (string)($row['source_type'] ?? 'player'),
            'slot_layout_code' => (string)($row['slot_layout_code'] ?? 'default'),
            'slot_profile' => is_array($slotProfile) ? $slotProfile : [],
            'count' => (int)($shipCounts[$type] ?? 0),
            'queued_count' => 0,
            'running_count' => 0,
            'active_eta' => null,
            'stats' => is_array($stats) ? $stats : [],
            'cost' => is_array($cost) ? $cost : [],
            'build_time_secs' => (int)($row['compiled_time_secs'] ?? 0),
        ];
    }

    $queueSummary = summarize_ship_build_queue(list_ship_build_queue($db, $cid));
    foreach ($blueprints as &$blueprint) {
        $type = (string)($blueprint['type'] ?? '');
        $blueprint['queued_count'] = (int)($queueSummary[$type]['queued_count'] ?? 0);
        $blueprint['running_count'] = (int)($queueSummary[$type]['running_count'] ?? 0);
        $blueprint['active_eta'] = $queueSummary[$type]['active_eta'] ?? null;
    }
    unset($blueprint);

    return $blueprints;
}

function compile_shipyard_blueprint(PDO $db, int $uid, int $cid, array $hull, array $modules, string $slotLayoutCode = 'default'): array {
    $normalized = [];
    $groupCounts = [];
    $groupSlotIndex = [];
    $stats = [
        'attack' => (float)($hull['base_attack'] ?? 0),
        'shield' => (float)($hull['base_shield'] ?? 0),
        'hull' => (float)($hull['base_hull'] ?? 0),
        'cargo' => (float)($hull['base_cargo'] ?? 0),
        'speed' => (float)($hull['base_speed'] ?? 1000),
        'energy_output' => (float)($hull['base_energy_output'] ?? 0),
        'energy_capacity' => (float)($hull['base_energy_capacity'] ?? 0),
        'energy_upkeep' => (float)($hull['base_energy_upkeep'] ?? 0),
        'weapon_efficiency' => (float)($hull['base_weapon_efficiency'] ?? 1.0),
        'shield_efficiency' => (float)($hull['base_shield_efficiency'] ?? 1.0),
        'attack_energy_share' => (float)($hull['base_attack_energy_share'] ?? 0.5),
    ];
    $hullCost = json_decode((string)($hull['build_cost_json'] ?? '{}'), true);
    $hullCost = is_array($hullCost) ? $hullCost : [];
    $cost = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0];
    $timeSecs = (int)($hull['build_time_secs'] ?? 0);
    $effectiveSlotProfile = resolve_hull_slot_profile($hull, $slotLayoutCode);

    // Load faction affinities for this user once; applied per-group below
    $affinities = load_faction_tech_affinities_for_user($db, $uid);

    $compatStmt = $db->prepare(
        'SELECT mg.code AS group_code, hmc.slot_count, hmc.max_module_tier
         FROM hull_module_compatibility hmc
         JOIN module_groups mg ON mg.id = hmc.group_id
         WHERE hmc.hull_id = ?'
    );
    $compatStmt->execute([(int)$hull['id']]);
    $compatRows = [];
    foreach ($compatStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $groupCode = (string)$row['group_code'];
        // unlock_tier affinity: raise effective max_module_tier for this group
        $tierBonus = (int)round((float)($affinities[$groupCode]['unlock_tier'] ?? 0.0));
        $compatRows[(string)$row['group_code']] = [
            'slot_count' => (int)($effectiveSlotProfile[$groupCode] ?? ($row['slot_count'] ?? 0)),
            'max_module_tier' => (int)($row['max_module_tier'] ?? 99) + $tierBonus,
        ];
    }

    $requiredStmt = $db->query('SELECT code FROM module_groups WHERE is_required = 1');
    $requiredGroups = [];
    foreach ($requiredStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $requiredGroups[] = (string)$row['code'];
    }

    $moduleStmt = $db->prepare(
        'SELECT m.id, m.code, m.label, m.tier, mg.code AS group_code, m.stats_delta_json, m.build_cost_json, m.build_time_secs,
                m.research_req_json, m.shipyard_req_json, m.faction_tag
         FROM modules m
         JOIN module_groups mg ON mg.id = m.group_id
         WHERE m.code = ? AND m.is_active = 1
         LIMIT 1'
    );

    foreach ($modules as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $moduleCode = trim((string)($entry['code'] ?? ''));
        $quantity = max(1, (int)($entry['quantity'] ?? 1));
        if ($moduleCode === '') {
            continue;
        }

        $moduleStmt->execute([$moduleCode]);
        $module = $moduleStmt->fetch(PDO::FETCH_ASSOC);
        if (!$module) {
            json_error('Unknown module code: ' . $moduleCode, 400);
        }

        $groupCode = (string)($module['group_code'] ?? '');
        $compat = $compatRows[$groupCode] ?? null;
        if (!$compat) {
            json_error('Module group not compatible with hull: ' . $groupCode, 400);
        }
        if ((int)($module['tier'] ?? 0) > (int)$compat['max_module_tier']) {
            json_error('Module tier exceeds hull compatibility for group: ' . $groupCode, 400);
        }
        $unlock = evaluate_shipyard_unlock_state(
            $db,
            $uid,
            $cid,
            json_decode((string)($module['research_req_json'] ?? '{}'), true),
            json_decode((string)($module['shipyard_req_json'] ?? '{}'), true),
            (string)($module['faction_tag'] ?? '')
        );
        if (!$unlock['unlocked']) {
            json_error('Module requirements not met for ' . $moduleCode . ': ' . implode('; ', $unlock['blockers']), 403);
        }

        $groupCounts[$groupCode] = ($groupCounts[$groupCode] ?? 0) + $quantity;
        if ($groupCounts[$groupCode] > (int)$compat['slot_count']) {
            json_error('Module slot count exceeded for group: ' . $groupCode, 400);
        }

        $slotStart = (int)($groupSlotIndex[$groupCode] ?? 0);
        $groupSlotIndex[$groupCode] = $slotStart + $quantity;

        $deltaStats = json_decode((string)($module['stats_delta_json'] ?? '{}'), true);
        $deltaStats = is_array($deltaStats) ? $deltaStats : [];
        foreach (['attack', 'shield', 'hull', 'cargo', 'speed', 'energy_output', 'energy_capacity', 'energy_upkeep'] as $key) {
            $stats[$key] += (float)($deltaStats[$key] ?? 0);
        }
        $stats['weapon_efficiency'] += (float)($deltaStats['weapon_efficiency_delta'] ?? 0);
        $stats['shield_efficiency'] += (float)($deltaStats['shield_efficiency_delta'] ?? 0);
        $stats['attack_energy_share'] += (float)($deltaStats['attack_energy_share_delta'] ?? 0);

        $moduleCost = json_decode((string)($module['build_cost_json'] ?? '{}'), true);
        $moduleCost = is_array($moduleCost) ? $moduleCost : [];
        $moduleUnitCost = ['metal' => 0.0, 'crystal' => 0.0, 'deuterium' => 0.0];
        foreach (['metal', 'crystal', 'deuterium'] as $resKey) {
            $moduleUnitCost[$resKey] = (float)($moduleCost[$resKey] ?? 0) * $quantity;
        }
        $moduleUnitTimeSecs = (int)($module['build_time_secs'] ?? 0) * $quantity;

        // Apply faction affinity cost_pct / build_time_pct for this module group
        apply_faction_affinity_to_module($affinities, $groupCode, $moduleUnitCost, $moduleUnitTimeSecs);

        foreach (['metal', 'crystal', 'deuterium'] as $resKey) {
            $cost[$resKey] += $moduleUnitCost[$resKey];
        }
        $timeSecs += $moduleUnitTimeSecs;

        for ($i = 0; $i < $quantity; $i++) {
            $normalized[] = [
                'module_id' => (int)$module['id'],
                'slot_index' => $slotStart + $i,
                'quantity' => 1,
            ];
        }
    }

    foreach ($requiredGroups as $groupCode) {
        if (($groupCounts[$groupCode] ?? 0) <= 0) {
            json_error('Required module group missing: ' . $groupCode, 400);
        }
    }

    foreach (['metal', 'crystal', 'deuterium'] as $resKey) {
        $cost[$resKey] += (float)($hullCost[$resKey] ?? 0);
        $cost[$resKey] = (float)round($cost[$resKey], 2);
    }

    // Apply stat_mult affinities per used group after all modules are summed
    foreach (array_keys($groupCounts) as $groupCode) {
        apply_faction_affinity_stat_mult($affinities, $groupCode, $stats);
    }

    foreach (['attack', 'shield', 'hull', 'cargo', 'speed', 'energy_output', 'energy_capacity', 'energy_upkeep'] as $statKey) {
        $stats[$statKey] = (float)round(max(0.0, $stats[$statKey]), 2);
    }
    $stats['weapon_efficiency'] = (float)round(max(0.5, min(1.6, $stats['weapon_efficiency'])), 4);
    $stats['shield_efficiency'] = (float)round(max(0.5, min(1.6, $stats['shield_efficiency'])), 4);
    $stats['attack_energy_share'] = (float)round(max(0.0, min(1.0, $stats['attack_energy_share'])), 4);

    return [
        'slot_layout_code' => $slotLayoutCode,
        'slot_profile' => $effectiveSlotProfile,
        'stats' => $stats,
        'cost' => $cost,
        'time_secs' => max(1, $timeSecs),
        'module_rows' => $normalized,
    ];
}

function resolve_hull_slot_profile(array $hull, string $slotLayoutCode = 'default'): array {
    $base = json_decode((string)($hull['slot_profile_json'] ?? '{}'), true);
    $base = is_array($base) ? $base : [];

    $variations = json_decode((string)($hull['slot_variation_json'] ?? '{}'), true);
    $variations = is_array($variations) ? $variations : [];

    if ($slotLayoutCode === '' || $slotLayoutCode === 'default' || !isset($variations[$slotLayoutCode])) {
        return normalize_slot_profile($base);
    }

    $variant = $variations[$slotLayoutCode];
    $adjustments = is_array($variant['slot_adjustments'] ?? null) ? $variant['slot_adjustments'] : [];
    foreach ($adjustments as $groupCode => $delta) {
        $base[$groupCode] = max(0, (int)($base[$groupCode] ?? 0) + (int)$delta);
    }

    return normalize_slot_profile($base);
}

function fetch_active_hull_by_code(PDO $db, string $hullCode): ?array {
    if ($hullCode === '') {
        return null;
    }

    $energyCols = vessel_hull_energy_columns_available($db)
        ? ', base_energy_output, base_energy_capacity, base_energy_upkeep,
           base_weapon_efficiency, base_shield_efficiency, base_attack_energy_share'
        : '';
    $hullStmt = $db->prepare(
        'SELECT id, code, label, role, ship_class, tier, base_attack, base_shield, base_hull, base_cargo, base_speed'
            . $energyCols . ',
            slot_profile_json, slot_variation_json, research_req_json, build_req_json, build_cost_json, build_time_secs, faction_tag
         FROM vessel_hulls
         WHERE code = ? AND is_active = 1
         LIMIT 1'
    );
    $hullStmt->execute([$hullCode]);
    $row = $hullStmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function evaluate_shipyard_unlock_state(PDO $db, int $uid, int $cid, $researchReq, $buildReq, string $factionTag = ''): array {
    $blockers = [];

    $researchReqs = normalize_shipyard_research_requirements($researchReq);
    if ($researchReqs) {
        $levels = load_user_research_levels($db, $uid);
        foreach ($researchReqs as $req) {
            $tech = (string)$req['tech'];
            $requiredLevel = (int)$req['level'];
            $currentLevel = (int)($levels[$tech] ?? 0);
            if ($currentLevel < $requiredLevel) {
                $blockers[] = $tech . ' Lv' . $requiredLevel . ' required (have ' . $currentLevel . ')';
            }
        }
    }

    $buildReqs = is_array($buildReq) ? $buildReq : [];
    $requiredShipyardLevel = (int)($buildReqs['shipyard_level'] ?? 0);
    if ($requiredShipyardLevel > 0) {
        $currentShipyardLevel = get_building_level($db, $cid, 'shipyard');
        if ($currentShipyardLevel < $requiredShipyardLevel) {
            $blockers[] = 'shipyard Lv' . $requiredShipyardLevel . ' required (have ' . $currentShipyardLevel . ')';
        }
    }

    $standingReq = resolve_shipyard_standing_requirement($buildReqs, $factionTag);
    if ($standingReq !== null) {
        $standing = get_shipyard_faction_standing($db, $uid, $standingReq['faction_code']);
        if ($standing === null) {
            $blockers[] = 'unknown faction standing for ' . $standingReq['faction_code'];
        } elseif ($standing < $standingReq['min']) {
            $blockers[] = $standingReq['faction_code'] . ' standing ' . $standingReq['min'] . ' required (have ' . $standing . ')';
        }
    }

    return [
        'unlocked' => count($blockers) === 0,
        'blockers' => $blockers,
    ];
}

function normalize_shipyard_research_requirements($researchReq): array {
    if (!is_array($researchReq)) {
        return [];
    }

    $result = [];
    $isAssoc = array_keys($researchReq) !== range(0, count($researchReq) - 1);
    if ($isAssoc) {
        foreach ($researchReq as $tech => $level) {
            $tech = trim((string)$tech);
            if ($tech === '') {
                continue;
            }
            $result[] = ['tech' => $tech, 'level' => max(1, (int)$level)];
        }
        return $result;
    }

    foreach ($researchReq as $entry) {
        if (is_array($entry) && array_is_list($entry) && count($entry) >= 2) {
            $tech = trim((string)($entry[0] ?? ''));
            if ($tech !== '') {
                $result[] = ['tech' => $tech, 'level' => max(1, (int)($entry[1] ?? 1))];
            }
            continue;
        }
        if (is_array($entry)) {
            $tech = trim((string)($entry['tech'] ?? $entry['code'] ?? ''));
            if ($tech !== '') {
                $result[] = ['tech' => $tech, 'level' => max(1, (int)($entry['level'] ?? 1))];
            }
        }
    }

    return $result;
}

function load_user_research_levels(PDO $db, int $uid): array {
    static $cache = [];
    if (isset($cache[$uid])) {
        return $cache[$uid];
    }

    $stmt = $db->prepare('SELECT type, level FROM research WHERE user_id = ?');
    $stmt->execute([$uid]);
    $levels = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $levels[(string)$row['type']] = (int)($row['level'] ?? 0);
    }
    $cache[$uid] = $levels;
    return $levels;
}

function resolve_shipyard_standing_requirement(array $buildReqs, string $factionTag = ''): ?array {
    if (isset($buildReqs['faction_standing']) && is_array($buildReqs['faction_standing'])) {
        $factionCode = trim((string)($buildReqs['faction_standing']['code'] ?? $factionTag));
        $min = (int)($buildReqs['faction_standing']['min'] ?? $buildReqs['faction_standing']['value'] ?? 0);
        if ($factionCode !== '') {
            return ['faction_code' => $factionCode, 'min' => $min];
        }
    }

    if (isset($buildReqs['min_standing']) && $factionTag !== '') {
        return ['faction_code' => $factionTag, 'min' => (int)$buildReqs['min_standing']];
    }

    return null;
}

function get_shipyard_faction_standing(PDO $db, int $uid, string $factionCode): ?int {
    static $cache = [];
    $key = $uid . '|' . $factionCode;
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }

    $stmt = $db->prepare(
        'SELECT COALESCE(d.standing, f.base_diplomacy) AS standing
         FROM npc_factions f
         LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
         WHERE f.code = ?
         LIMIT 1'
    );
    $stmt->execute([$uid, $factionCode]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $cache[$key] = $row ? (int)$row['standing'] : null;
    return $cache[$key];
}

function vessel_hull_energy_columns_available(PDO $db): bool {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $stmt = $db->prepare(
        'SELECT COUNT(*)
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME IN (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        'vessel_hulls',
        'base_energy_output',
        'base_energy_capacity',
        'base_energy_upkeep',
        'base_weapon_efficiency',
        'base_shield_efficiency',
        'base_attack_energy_share',
    ]);

    $cached = ((int)$stmt->fetchColumn() === 6);
    return $cached;
}

function normalize_slot_profile(array $profile): array {
    $result = [];
    foreach ($profile as $groupCode => $count) {
        $result[(string)$groupCode] = max(0, (int)$count);
    }
    ksort($result);
    return $result;
}

// ── Einzelvessel-Runtime ─────────────────────────────────────────────────────

function action_list_vessels(PDO $db, int $uid, int $cid): never {
    if ($cid <= 0) {
        json_error('colony_id required');
    }
    verify_colony_ownership($db, $cid, $uid);

    // Lazy-create table if migration has not run yet
    if (function_exists('ensure_built_vessels_table')) {
        ensure_built_vessels_table($db);
    }

    try {
        $stmt = $db->prepare(
            'SELECT bv.id,
                    bv.blueprint_id,
                    bv.name,
                    bv.snapshot_stats_json,
                    bv.hp_state_json,
                    bv.status,
                    bv.created_at,
                    vb.name       AS bp_name,
                    vh.label      AS hull_label,
                    vh.ship_class AS hull_class,
                    vh.tier       AS hull_tier
             FROM built_vessels bv
             JOIN vessel_blueprints vb ON bv.blueprint_id = vb.id
             JOIN vessel_hulls      vh ON vb.hull_id       = vh.id
             WHERE bv.colony_id = ? AND bv.status != \'destroyed\'
             ORDER BY bv.id DESC'
        );
        $stmt->execute([$cid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        // table not yet migrated
        json_ok(['vessels' => []]);
    }

    $vessels = array_map(static function (array $row): array {
        return [
            'id'           => (int)$row['id'],
            'blueprint_id' => (int)$row['blueprint_id'],
            'name'         => $row['name'],
            'bp_name'      => $row['bp_name'] ?? '',
            'hull_label'   => $row['hull_label'] ?? '',
            'hull_class'   => $row['hull_class'] ?? '',
            'hull_tier'    => (int)($row['hull_tier'] ?? 1),
            'stats'        => json_decode($row['snapshot_stats_json'] ?? '{}', true) ?: [],
            'hp_state'     => json_decode($row['hp_state_json']       ?? '{}', true) ?: [],
            'status'       => $row['status'],
            'created_at'   => $row['created_at'],
        ];
    }, $rows);

    json_ok(['vessels' => $vessels]);
}

function action_decommission_vessel(PDO $db, int $uid, array $body): never {
    $vesselId = (int)($body['vessel_id'] ?? 0);
    if ($vesselId <= 0) {
        json_error('vessel_id required');
    }

    // verify ownership via colony
    try {
        $ownerStmt = $db->prepare(
            'SELECT bv.colony_id, c.user_id
             FROM built_vessels bv
             JOIN colonies c ON bv.colony_id = c.id
             WHERE bv.id = ? LIMIT 1'
        );
        $ownerStmt->execute([$vesselId]);
        $row = $ownerStmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        json_error('Vessel system not available.');
    }

    if (!$row || (int)$row['user_id'] !== $uid) {
        json_error('Vessel not found or access denied.', 403);
    }

    // only docked vessels can be decommissioned
    $checkStmt = $db->prepare('SELECT status FROM built_vessels WHERE id = ? LIMIT 1');
    $checkStmt->execute([$vesselId]);
    $currentStatus = (string)$checkStmt->fetchColumn();
    if ($currentStatus !== 'docked') {
        json_error('Only docked vessels can be decommissioned.');
    }

    $db->prepare('UPDATE built_vessels SET status = \'destroyed\' WHERE id = ?')
        ->execute([$vesselId]);

    json_ok(['decommissioned' => $vesselId]);
}

function action_delete_blueprint(PDO $db, int $uid, array $body): never {
    if (!vessel_blueprint_tables_exist($db)) {
        json_error('Blueprint tables are not available.', 409);
    }

    $blueprintId = (int)($body['blueprint_id'] ?? 0);
    if ($blueprintId <= 0) {
        json_error('blueprint_id required.');
    }

    // verify ownership
    $ownerStmt = $db->prepare('SELECT user_id FROM vessel_blueprints WHERE id = ? LIMIT 1');
    $ownerStmt->execute([$blueprintId]);
    $row = $ownerStmt->fetch(PDO::FETCH_ASSOC);

    if (!$row || (int)$row['user_id'] !== $uid) {
        json_error('Blueprint not found or access denied.', 403);
    }

    // prevent deletion while ships are in the build queue
    $queueCheck = $db->prepare(
        "SELECT COUNT(*) FROM ship_build_queue WHERE blueprint_id = ? AND status IN ('queued','running')"
    );
    $queueCheck->execute([$blueprintId]);
    if ((int)$queueCheck->fetchColumn() > 0) {
        json_error('Cannot delete blueprint while ships are being built from it.');
    }

    $db->prepare('DELETE FROM vessel_blueprint_modules WHERE blueprint_id = ?')
        ->execute([$blueprintId]);
    $db->prepare('DELETE FROM vessel_blueprints WHERE id = ? AND user_id = ?')
        ->execute([$blueprintId, $uid]);

    json_ok(['deleted' => $blueprintId]);
}

// ── Faction tech affinities ───────────────────────────────────────────────────

/**
 * Loads all applicable faction_tech_affinities for a user given their current
 * diplomacy standing. Returns a nested array:
 *   [group_code => [bonus_type => total_value, ...], ...]
 * Only returns bonuses where user_standing >= min_standing.
 */
function load_faction_tech_affinities_for_user(PDO $db, int $uid): array {
    static $cache = [];
    if (isset($cache[$uid])) {
        return $cache[$uid];
    }

    try {
        $stmt = $db->prepare(
            'SELECT fta.module_group_code, fta.bonus_type, fta.bonus_value, fta.min_standing, fta.faction_code,
                    COALESCE(d.standing, f.base_diplomacy, 0) AS user_standing
             FROM faction_tech_affinities fta
             JOIN npc_factions f ON f.code = fta.faction_code
             LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
             HAVING user_standing >= fta.min_standing
             ORDER BY fta.module_group_code, fta.bonus_type'
        );
        $stmt->execute([$uid]);
    } catch (PDOException $e) {
        // Table may not exist yet (migration not applied). Degrade gracefully.
        $cache[$uid] = [];
        return $cache[$uid];
    }

    $result = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $group = (string)$row['module_group_code'];
        $type  = (string)$row['bonus_type'];
        $val   = (float)$row['bonus_value'];
        $result[$group][$type] = ($result[$group][$type] ?? 0.0) + $val;
    }
    $cache[$uid] = $result;
    return $result;
}

/**
 * Loads ALL faction_tech_affinities (ignoring standing) indexed by group,
 * with the user's current standing included for display.
 * Returns: [group_code => [[faction_code, bonus_type, bonus_value, min_standing, user_standing], ...]]
 */
function load_faction_tech_affinities_display(PDO $db, int $uid): array {
    try {
        $stmt = $db->prepare(
            'SELECT fta.faction_code, fta.module_group_code, fta.bonus_type, fta.bonus_value, fta.min_standing,
                    COALESCE(d.standing, f.base_diplomacy, 0) AS user_standing,
                    f.name AS faction_name, f.color AS faction_color, f.icon AS faction_icon
             FROM faction_tech_affinities fta
             JOIN npc_factions f ON f.code = fta.faction_code
             LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
             ORDER BY fta.module_group_code, fta.faction_code, fta.bonus_type'
        );
        $stmt->execute([$uid]);
    } catch (PDOException $e) {
        return [];
    }

    $result = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $group = (string)$row['module_group_code'];
        $result[$group][] = [
            'faction_code'   => (string)$row['faction_code'],
            'faction_name'   => (string)($row['faction_name'] ?? $row['faction_code']),
            'faction_color'  => (string)($row['faction_color'] ?? '#888'),
            'faction_icon'   => (string)($row['faction_icon'] ?? '?'),
            'bonus_type'     => (string)$row['bonus_type'],
            'bonus_value'    => (float)$row['bonus_value'],
            'min_standing'   => (int)$row['min_standing'],
            'user_standing'  => (int)$row['user_standing'],
            'active'         => (int)$row['user_standing'] >= (int)$row['min_standing'],
        ];
    }
    return $result;
}

/**
 * Applies faction affinity modifiers to cost and time totals for a given group_code.
 * Modifies $cost (by reference) and $timeSecs (by reference).
 */
function apply_faction_affinity_to_module(array $affinities, string $groupCode, array &$cost, int &$timeSecs, float $moduleCostFactor = 1.0): void {
    $groupAffinities = $affinities[$groupCode] ?? [];
    foreach ($groupAffinities as $bonusType => $bonusValue) {
        if ($bonusType === 'cost_pct') {
            $pct = max(-80.0, min(80.0, (float)$bonusValue)); // cap at ±80%
            $factor = 1.0 + $pct / 100.0;
            foreach (['metal', 'crystal', 'deuterium'] as $res) {
                $cost[$res] = max(0.0, $cost[$res] * $factor);
            }
        } elseif ($bonusType === 'build_time_pct') {
            $pct = max(-80.0, min(80.0, (float)$bonusValue));
            $timeSecs = (int)max(1, round($timeSecs * (1.0 + $pct / 100.0)));
        }
        // stat_mult and unlock_tier are handled separately in evaluate/compile
    }
}

/**
 * Applies stat_mult affinity bonuses to a stats array for a given group.
 */
function apply_faction_affinity_stat_mult(array $affinities, string $groupCode, array &$stats): void {
    $mult = (float)($affinities[$groupCode]['stat_mult'] ?? 0.0);
    if ($mult === 0.0) {
        return;
    }
    foreach (['attack', 'shield', 'hull', 'cargo', 'speed'] as $key) {
        $stats[$key] = (float)$stats[$key] * (1.0 + $mult);
    }
}

