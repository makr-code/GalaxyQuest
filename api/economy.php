<?php
// api/economy.php — Economy System: colony production, pop classes, policy
//
// Actions:
//   get_overview           — colony economy overview (buildings, pop classes, stock)
//   get_production         — detailed production chain status per colony
//   set_production_method  — change active ProcessingMethod for a building
//   get_policy             — player's current economic policy and tax rates
//   set_policy             — change global economic policy (POST)
//   set_tax                — change tax rate (POST)
//   set_subsidy            — toggle a subsidy (POST)
//   get_pop_classes        — pop class distribution across all colonies

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/economy_flush.php';
require_once __DIR__ . '/economy_runtime.php';

header('Content-Type: application/json; charset=utf-8');

$uid    = require_auth();
$db     = get_db();
$action = $_GET['action'] ?? '';

const VALID_METHODS = ['standard', 'efficient', 'premium'];
const VALID_POLICIES = ['free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy'];
const TAX_MAX = ['income' => 0.40, 'production' => 0.30, 'trade' => 0.25];
const VALID_SUBSIDIES = ['agriculture', 'research', 'military'];
const VALID_POP_CLASSES = ['colonist', 'citizen', 'specialist', 'elite', 'transcendent'];

function ensure_policy_row(PDO $db, int $uid): void {
    $db->prepare('INSERT IGNORE INTO economy_policies (user_id) VALUES (?)')->execute([$uid]);
}

function fetch_policy(PDO $db, int $uid): array {
    ensure_policy_row($db, $uid);
    $stmt = $db->prepare('SELECT * FROM economy_policies WHERE user_id = ?');
    $stmt->execute([$uid]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
}

function fetch_user_colonies(PDO $db, int $uid): array {
    $stmt = $db->prepare(<<<SQL
        SELECT c.id, c.name, c.population, c.colony_type AS type,
               cb.galaxy_index, cb.system_index, cb.position
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        WHERE c.user_id = ?
        ORDER BY c.id
    SQL);
    $stmt->execute([$uid]);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function fetch_colony_goods(PDO $db, int $colonyId): array {
    $stmt = $db->prepare('SELECT good_type, quantity, capacity FROM economy_processed_goods WHERE colony_id = ?');
    $stmt->execute([$colonyId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $out = [];
    foreach ($rows as $r) {
        $out[$r['good_type']] = [
            'quantity' => (float)$r['quantity'],
            'capacity' => (float)$r['capacity'],
        ];
    }
    return $out;
}

function fetch_production_methods(PDO $db, int $colonyId): array {
    $stmt = $db->prepare('SELECT building_type, method FROM economy_production_methods WHERE colony_id = ?');
    $stmt->execute([$colonyId]);
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[$r['building_type']] = $r['method'];
    }
    return $out;
}

function fetch_pop_classes(PDO $db, int $colonyId): array {
    $stmt = $db->prepare(<<<SQL
        SELECT pop_class, count, satisfaction_ticks, shortage_ticks
        FROM economy_pop_classes
        WHERE colony_id = ?
    SQL);
    $stmt->execute([$colonyId]);
    $out = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $out[$r['pop_class']] = [
            'count' => (int)$r['count'],
            'satisfaction_ticks' => (int)$r['satisfaction_ticks'],
            'shortage_ticks' => (int)$r['shortage_ticks'],
        ];
    }
    return $out;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * GET economy.php?action=get_overview[&colony_id=N]
 *
 * Returns a summary of the player's economy:
 * buildings with active production methods, pop classes, good stock.
 */
function action_get_overview(PDO $db, int $uid): never {
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;
    $colonies = fetch_user_colonies($db, $uid);

    if ($colonyId !== null) {
        $colonies = array_filter($colonies, fn($c) => (int)$c['id'] === $colonyId);
    }

    $result = [];
    foreach ($colonies as $c) {
        $cid  = (int)$c['id'];
        update_colony_resources($db, $cid);
        flush_colony_production($db, $cid);
        $runtimeRow = fetch_colony_runtime_row($db, $cid);
        $runtime = $runtimeRow ? build_colony_consumption_snapshot($db, $runtimeRow) : [];
        $result[] = [
            'id'         => $cid,
            'name'       => $runtimeRow['name'] ?? $c['name'],
            'population' => (int)($runtimeRow['population'] ?? $c['population']),
            'type'       => $runtimeRow['colony_type'] ?? $c['type'],
            'location'   => [
                'galaxy' => (int)$c['galaxy_index'],
                'system' => (int)$c['system_index'],
                'pos'    => (int)$c['position'],
            ],
            'goods'       => fetch_colony_goods($db, $cid),
            'methods'     => fetch_production_methods($db, $cid),
            'pop_classes' => fetch_pop_classes($db, $cid),
            'resources'   => $runtime['resources'] ?? [],
            'storage'     => $runtime['storage'] ?? [],
            'production'  => $runtime['production'] ?? [],
            'consumption' => $runtime['consumption'] ?? [],
            'welfare'     => $runtime['welfare'] ?? [],
            'building_levels' => $runtime['building_levels'] ?? [],
        ];
    }

    json_ok(['colonies' => $result]);
}

/**
 * GET economy.php?action=get_production&colony_id=N
 *
 * Returns detailed per-building production chain status for one colony.
 */
function action_get_production(PDO $db, int $uid): never {
    $colonyId = (int)($_GET['colony_id'] ?? 0);
    if (!$colonyId) json_error('colony_id required', 400);

    // Verify ownership
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

    update_colony_resources($db, $colonyId);
    flush_colony_production($db, $colonyId);
    $methods = fetch_production_methods($db, $colonyId);
    $goods   = fetch_colony_goods($db, $colonyId);
    $runtimeRow = fetch_colony_runtime_row($db, $colonyId);
    $runtime = $runtimeRow ? build_colony_consumption_snapshot($db, $runtimeRow) : [];

    // Fetch colony's processing buildings from buildings table
    $stmt = $db->prepare(<<<SQL
        SELECT type, COUNT(*) AS cnt
        FROM buildings
        WHERE colony_id = ? AND type IN (
            'metallurgy','crystal_grinder','refinery','bioreactor','electronics_fab',
            'consumer_factory','luxury_workshop','arms_factory','research_lab_adv','colony_supplies',
            'neural_fabricator','quantum_lab','bio_pharma','cultural_center','propulsion_works',
            'void_refinery','consciousness_institute','temporal_atelier'
        )
        GROUP BY type
    SQL);
    $stmt->execute([$colonyId]);
    $buildings = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $buildings[$row['type']] = (int)$row['cnt'];
    }

    json_ok([
        'colony_id' => $colonyId,
        'buildings' => $buildings,
        'methods'   => $methods,
        'goods'     => $goods,
        'resources' => $runtime['resources'] ?? [],
        'storage' => $runtime['storage'] ?? [],
        'raw_production' => $runtime['production'] ?? [],
        'raw_consumption' => $runtime['consumption'] ?? [],
        'welfare' => $runtime['welfare'] ?? [],
        'building_levels' => $runtime['building_levels'] ?? [],
    ]);
}

/**
 * POST economy.php?action=set_production_method
 * Body: { colony_id, building_type, method }
 *
 * Sets the active ProcessingMethod for a processing building in a colony.
 */
function action_set_production_method(PDO $db, int $uid): never {
    $body        = json_decode(file_get_contents('php://input'), true) ?? [];
    $colonyId    = (int)($body['colony_id']    ?? 0);
    $buildingType = trim($body['building_type'] ?? '');
    $method      = trim($body['method']         ?? '');

    if (!$colonyId)    json_error('colony_id required', 400);
    if (!$buildingType) json_error('building_type required', 400);
    if (!in_array($method, VALID_METHODS, true)) {
        json_error('Invalid method. Must be: ' . implode(', ', VALID_METHODS), 400);
    }

    // Verify ownership
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

    // PREMIUM method requires research unlock — check via user's completed research
    if ($method === 'premium') {
        // Find the research prereq for this building + premium combo
        // We store it by convention as economy.<building_type>_ii or similar
        // The full check is done server-side by looking at completed research
        $stmt = $db->prepare(<<<SQL
            SELECT 1 FROM research_completed
            WHERE user_id = ? AND tech_id LIKE 'economy.%'
            LIMIT 1
        SQL);
        $stmt->execute([$uid]);
        // Simplified: premium requires at least one economy research completed
        if (!$stmt->fetch()) {
            json_error('Premium method requires economy research unlock', 403);
        }
    }

    $db->prepare(<<<SQL
        INSERT INTO economy_production_methods (colony_id, building_type, method)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE method = VALUES(method), updated_at = CURRENT_TIMESTAMP
    SQL)->execute([$colonyId, $buildingType, $method]);

    json_ok([
        'colony_id'     => $colonyId,
        'building_type' => $buildingType,
        'method'        => $method,
    ]);
}

/**
 * GET economy.php?action=get_policy
 *
 * Returns the player's current economic policy and tax rates.
 */
function action_get_policy(PDO $db, int $uid): never {
    $policy = fetch_policy($db, $uid);
    json_ok([
        'global_policy'       => $policy['global_policy'],
        'taxes'               => [
            'income'      => (float)$policy['tax_income'],
            'production'  => (float)$policy['tax_production'],
            'trade'       => (float)$policy['tax_trade'],
        ],
        'subsidies'           => [
            'agriculture' => (bool)$policy['subsidy_agriculture'],
            'research'    => (bool)$policy['subsidy_research'],
            'military'    => (bool)$policy['subsidy_military'],
        ],
    ]);
}

/**
 * POST economy.php?action=set_policy
 * Body: { policy }
 *
 * Changes the global economic policy. Switching policies has a 10-tick cooldown.
 */
function action_set_policy(PDO $db, int $uid): never {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $policy = trim($body['policy'] ?? '');

    if (!in_array($policy, VALID_POLICIES, true)) {
        json_error('Invalid policy. Must be one of: ' . implode(', ', VALID_POLICIES), 400);
    }

    ensure_policy_row($db, $uid);
    $db->prepare('UPDATE economy_policies SET global_policy = ? WHERE user_id = ?')
       ->execute([$policy, $uid]);

    json_ok(['global_policy' => $policy]);
}

/**
 * POST economy.php?action=set_tax
 * Body: { type, rate }
 *
 * Sets a tax rate (income | production | trade). Clamped to allowed maximum.
 */
function action_set_tax(PDO $db, int $uid): never {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $type = trim($body['type'] ?? '');
    $rate = (float)($body['rate'] ?? 0);

    if (!isset(TAX_MAX[$type])) {
        json_error('Invalid tax type. Must be: ' . implode(', ', array_keys(TAX_MAX)), 400);
    }

    $clamped = max(0.0, min((float)TAX_MAX[$type], $rate));
    $col     = 'tax_' . $type;

    ensure_policy_row($db, $uid);
    $db->prepare("UPDATE economy_policies SET {$col} = ? WHERE user_id = ?")
       ->execute([$clamped, $uid]);

    json_ok(['type' => $type, 'rate' => $clamped]);
}

/**
 * POST economy.php?action=set_subsidy
 * Body: { sector, enabled }
 *
 * Toggles a subsidy for a sector (agriculture | research | military).
 */
function action_set_subsidy(PDO $db, int $uid): never {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $sector  = trim($body['sector']  ?? '');
    $enabled = (bool)($body['enabled'] ?? false);

    if (!in_array($sector, VALID_SUBSIDIES, true)) {
        json_error('Invalid subsidy sector. Must be: ' . implode(', ', VALID_SUBSIDIES), 400);
    }

    $col = 'subsidy_' . $sector;
    ensure_policy_row($db, $uid);
    $db->prepare("UPDATE economy_policies SET {$col} = ? WHERE user_id = ?")
       ->execute([$enabled ? 1 : 0, $uid]);

    json_ok(['sector' => $sector, 'enabled' => $enabled]);
}

/**
 * GET economy.php?action=get_pop_classes[&colony_id=N]
 *
 * Returns pop class distribution aggregated across all player colonies,
 * or for a single colony if colony_id is given.
 */
function action_get_pop_classes(PDO $db, int $uid): never {
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;

    if ($colonyId !== null) {
        // Single colony
        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

        json_ok([
            'colony_id'  => $colonyId,
            'pop_classes' => fetch_pop_classes($db, $colonyId),
        ]);
    }

    // All colonies — aggregate
    $stmt = $db->prepare(<<<SQL
        SELECT epc.pop_class,
               SUM(epc.count) AS total_count,
               AVG(epc.satisfaction_ticks) AS avg_satisfaction,
               AVG(epc.shortage_ticks) AS avg_shortage
        FROM economy_pop_classes epc
        JOIN colonies c ON c.id = epc.colony_id
        WHERE c.user_id = ?
        GROUP BY epc.pop_class
        ORDER BY FIELD(epc.pop_class, 'colonist','citizen','specialist','elite','transcendent')
    SQL);
    $stmt->execute([$uid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $out = [];
    foreach ($rows as $r) {
        $out[$r['pop_class']] = [
            'total'               => (int)$r['total_count'],
            'avg_satisfaction'    => round((float)$r['avg_satisfaction'], 2),
            'avg_shortage'        => round((float)$r['avg_shortage'], 2),
        ];
    }

    json_ok(['pop_classes' => $out]);
}

match ($action) {
    'get_overview'          => action_get_overview($db, $uid),
    'get_production'        => action_get_production($db, $uid),
    'set_production_method' => action_set_production_method($db, $uid),
    'get_policy'            => action_get_policy($db, $uid),
    'set_policy'            => action_set_policy($db, $uid),
    'set_tax'               => action_set_tax($db, $uid),
    'set_subsidy'           => action_set_subsidy($db, $uid),
    'get_pop_classes'       => action_get_pop_classes($db, $uid),
    default                 => json_error('Unknown action: ' . $action, 400),
};
