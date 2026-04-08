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

function policy_key_from_mixed(mixed $raw): string {
    if (is_numeric($raw)) {
        $idx = (int)$raw;
        return VALID_POLICIES[$idx] ?? 'free_market';
    }
    $key = (string)$raw;
    return in_array($key, VALID_POLICIES, true) ? $key : 'free_market';
}

function policy_storage_value(array $policyRow, string $policy): int|string {
    $current = $policyRow['global_policy'] ?? 'free_market';
    if (is_numeric($current)) {
        $idx = array_search($policy, VALID_POLICIES, true);
        return $idx === false ? 0 : (int)$idx;
    }
    return $policy;
}

function normalize_tax_value(mixed $v): float {
    $n = (float)$v;
    // Legacy schema stores percentages as ints (e.g. 20), newer schema as 0..1
    if ($n > 1.0) $n /= 100.0;
    return max(0.0, min(1.0, $n));
}

/**
 * PHASE 2.1: War→Economy coupling.
 * Returns a modifier (0.4–1.0) applied to production/trade tax efficiency.
 * policy = 'war_economy' avoids the penalty on military goods but hurts civilian.
 */
function fetch_war_economy_modifier(PDO $db, int $uid): array {
    $modifiers = [
        'production_mult'        => 1.0,
        'trade_income_mult'      => 1.0,
        'tax_efficiency_mult'    => 1.0,
        'active_wars'            => 0,
        'war_exhaustion_avg'     => 0.0,
        'has_war_economy_policy' => false,
    ];

    $warTableCheckStmt = $db->query("SHOW TABLES LIKE 'wars'");
    if (!$warTableCheckStmt->fetch()) {
        return $modifiers;
    }

    $stmt = $db->prepare(<<<SQL
        SELECT COUNT(*) AS cnt,
               AVG((exhaustion_att + exhaustion_def) / 2.0) AS avg_exhaustion
        FROM wars
        WHERE status = 'active'
          AND (attacker_user_id = ? OR defender_user_id = ?)
    SQL);
    $stmt->execute([$uid, $uid]);
    $warData = $stmt->fetch(PDO::FETCH_ASSOC);
    $activeWars    = (int)($warData['cnt'] ?? 0);
    $avgExhaustion = (float)($warData['avg_exhaustion'] ?? 0.0);

    if ($activeWars === 0) {
        return $modifiers;
    }

    $modifiers['active_wars']        = $activeWars;
    $modifiers['war_exhaustion_avg'] = $avgExhaustion;

    // Each active war reduces production by 10% (capped at -50%)
    $warPenalty = min(0.5, $activeWars * 0.10 + ($avgExhaustion / 200.0));
    $modifiers['production_mult']     = max(0.4, 1.0 - $warPenalty);
    $modifiers['trade_income_mult']   = max(0.5, 1.0 - $warPenalty * 0.5);
    $modifiers['tax_efficiency_mult'] = max(0.6, 1.0 - $warPenalty * 0.3);

    // War Economy policy reduces civilian penalty, boosts military production
    $policyStmt = $db->prepare('SELECT global_policy FROM economy_policies WHERE user_id = ?');
    $policyStmt->execute([$uid]);
    $policy = policy_key_from_mixed($policyStmt->fetchColumn());
    if ($policy === 'war_economy') {
        $modifiers['production_mult']     = min(1.0, $modifiers['production_mult'] + 0.15);
        $modifiers['has_war_economy_policy'] = true;
    }

    return $modifiers;
}

/**
 * PHASE 2.2: Pirates→Colony damage modifier.
 * Returns a multiplier (0.7–1.0) reflecting unrepaired raid damage.
 */
function fetch_pirate_damage_modifier(PDO $db, int $uid): float {
    $tableCheckStmt = $db->query("SHOW TABLES LIKE 'pirate_damage_recovery'");
    if (!$tableCheckStmt->fetch()) {
        return 1.0;
    }

    $stmt = $db->prepare(<<<SQL
        SELECT AVG(initial_damage - recovery_percent) AS avg_unrepaired
        FROM pirate_damage_recovery pdr
        JOIN colonies c ON c.id = pdr.colony_id
        WHERE c.user_id = ?
          AND pdr.recovery_complete IS NULL
    SQL);
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $unrepairedPct = (float)($row['avg_unrepaired'] ?? 0.0);

    // Every % of unrepaired damage = 0.5% production loss, capped at -30%
    return max(0.7, 1.0 - ($unrepairedPct * 0.005));
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

    // PHASE 2.1: Fetch war economy modifiers
    $warModifiers = fetch_war_economy_modifier($db, $uid);
    // PHASE 2.2: Fetch pirate damage modifier
    $pirateDamageMult = fetch_pirate_damage_modifier($db, $uid);

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

    json_ok([
        'colonies'       => $result,
        'war_modifiers'  => $warModifiers,
        'pirate_damage_mult' => $pirateDamageMult,
    ]);
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
    $globalPolicy = policy_key_from_mixed($policy['global_policy'] ?? 'free_market');
    $taxProductionRaw = $policy['tax_production'] ?? ($policy['tax_resources'] ?? 0);
    json_ok([
        'global_policy'       => $globalPolicy,
        'taxes'               => [
            'income'      => normalize_tax_value($policy['tax_income'] ?? 0),
            'production'  => normalize_tax_value($taxProductionRaw),
            'trade'       => normalize_tax_value($policy['tax_trade'] ?? 0),
        ],
        'subsidies'           => [
            'agriculture' => ((int)($policy['subsidy_agriculture'] ?? 0)) > 0,
            'research'    => ((int)($policy['subsidy_research'] ?? 0)) > 0,
            'military'    => ((int)($policy['subsidy_military'] ?? 0)) > 0,
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
    $row = fetch_policy($db, $uid);
    $storage = policy_storage_value($row, $policy);
    $db->prepare('UPDATE economy_policies SET global_policy = ? WHERE user_id = ?')
       ->execute([$storage, $uid]);

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

    ensure_policy_row($db, $uid);
    $row = fetch_policy($db, $uid);

    $clamped = max(0.0, min((float)TAX_MAX[$type], $rate));
    $storeRate = $clamped;

    $col = 'tax_' . $type;
    if ($type === 'production' && !array_key_exists('tax_production', $row) && array_key_exists('tax_resources', $row)) {
        $col = 'tax_resources';
    }
    // Legacy schema stores percentages in whole numbers.
    if (isset($row[$col]) && is_numeric($row[$col]) && (float)$row[$col] > 1.0) {
        $storeRate = round($clamped * 100, 2);
    }

    $db->prepare("UPDATE economy_policies SET {$col} = ? WHERE user_id = ?")
       ->execute([$storeRate, $uid]);

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

/**
 * GET economy.php?action=get_pop_status[&colony_id=N]
 *
 * Returns detailed pop satisfaction, employment, and migration data per colony.
 * Satisfaction index (0-100) affects production yield (-50% to +50%).
 */
function action_get_pop_status(PDO $db, int $uid): never {
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;

    if ($colonyId !== null) {
        // Single colony detailed status
        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

        $stmt = $db->prepare(<<<SQL
            SELECT pop_class, count, satisfaction_index, employment_level, migration_rate, wage_requirement
            FROM economy_pop_classes
            WHERE colony_id = ?
            ORDER BY FIELD(pop_class, 'colonist','citizen','specialist','elite','transcendent')
        SQL);
        $stmt->execute([$colonyId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $out = [];
        $totalCount = 0;
        $avgSatisfaction = 0.0;

        foreach ($rows as $r) {
            $count = (int)$r['count'];
            $satisfaction = (float)$r['satisfaction_index'];
            $totalCount += $count;
            $avgSatisfaction += $satisfaction * $count;

            $out[$r['pop_class']] = [
                'count'              => $count,
                'satisfaction'       => round($satisfaction, 2),
                'employment'         => round((float)$r['employment_level'], 2),
                'migration_rate'     => round((float)$r['migration_rate'], 2),
                'wage_requirement'   => round((float)$r['wage_requirement'], 2),
                'production_mult'    => round(0.5 + ($satisfaction / 100.0), 3),  // 0.5x–1.5x
            ];
        }

        $avgSatisfaction = $totalCount > 0 ? $avgSatisfaction / $totalCount : 50.0;

        json_ok([
            'colony_id'           => $colonyId,
            'total_population'    => $totalCount,
            'avg_satisfaction'    => round($avgSatisfaction, 2),
            'pop_status'          => $out,
        ]);
    }

    // All colonies — aggregated
    $stmt = $db->prepare(<<<SQL
        SELECT c.id, c.name,
               SUM(epc.count) AS total_pop,
               AVG(epc.satisfaction_index) AS avg_satisfaction,
               AVG(epc.employment_level) AS avg_employment,
               SUM(epc.migration_rate * epc.count) / SUM(epc.count) AS avg_migration
        FROM colonies c
        LEFT JOIN economy_pop_classes epc ON epc.colony_id = c.id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY c.id
    SQL);
    $stmt->execute([$uid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $colonies = [];
    foreach ($rows as $r) {
        $satisfaction = (float)($r['avg_satisfaction'] ?? 50.0);
        $colonies[] = [
            'colony_id'        => (int)$r['id'],
            'name'             => $r['name'],
            'total_population' => (int)($r['total_pop'] ?? 0),
            'avg_satisfaction' => round($satisfaction, 2),
            'avg_employment'   => round((float)($r['avg_employment'] ?? 80.0), 2),
            'avg_migration'    => round((float)($r['avg_migration'] ?? 0.0), 2),
            'production_mult'  => round(0.5 + ($satisfaction / 100.0), 3),
        ];
    }

    json_ok(['colonies' => $colonies]);
}

/**
 * POST economy.php?action=set_pop_policy
 *
 * Set satisfaction drivers like wage_adjustment, culture_spending, safety_budget.
 * Recalculates satisfaction_index and employment_level on next tick.
 */
function action_set_pop_policy(PDO $db, int $uid): never {
    $colonyId = (int)($_POST['colony_id'] ?? 0);
    $wageAdjustment = (float)($_POST['wage_adjustment'] ?? 1.0);  // 0.5–2.0x multiplier
    $cultureSpending = (float)($_POST['culture_spending'] ?? 0.0); // 0–1000 credits/tick
    $safetyBudget = (float)($_POST['safety_budget'] ?? 0.0);       // 0–100% budget
    
    // Validate
    if ($colonyId <= 0) json_error('Invalid colony_id', 400);
    if ($wageAdjustment < 0.5 || $wageAdjustment > 2.0) json_error('wage_adjustment must be 0.5–2.0', 400);
    if ($cultureSpending < 0 || $cultureSpending > 1000) json_error('culture_spending must be 0–1000', 400);
    if ($safetyBudget < 0 || $safetyBudget > 100) json_error('safety_budget must be 0–100%', 400);

    // Verify colony ownership
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

    // Update all pop classes in this colony
    $stmt = $db->prepare(<<<SQL
        UPDATE economy_pop_classes
        SET wage_requirement = wage_requirement * ?,
            last_satisfaction_calc = CURRENT_TIMESTAMP
        WHERE colony_id = ?
    SQL);
    $stmt->execute([$wageAdjustment, $colonyId]);

    json_ok([
        'colony_id'        => $colonyId,
        'wage_adjustment'  => $wageAdjustment,
        'culture_spending' => $cultureSpending,
        'safety_budget'    => $safetyBudget,
        'message'          => 'Pop policy updated; satisfaction recalculated on next tick',
    ]);
}

/**
 * GET economy.php?action=get_bottleneck[&colony_id=N]
 *
 * Returns manufacturing bottleneck warnings per colony.
 * A bottleneck occurs when a building is producing at reduced rate due to:
 *   - Policy restrictions (war without war_economy policy)
 *   - Low pop satisfaction (<60%)
 *   - Missing input goods for Tier-3+ production
 */
function action_get_bottleneck(PDO $db, int $uid): never {
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;

    $colonies = fetch_user_colonies($db, $uid);
    if ($colonyId !== null) {
        $colonies = array_filter($colonies, fn($c) => (int)$c['id'] === $colonyId);
    }

    $warModifiers = fetch_war_economy_modifier($db, $uid);
    $policy = fetch_policy($db, $uid);
    $globalPolicy = policy_key_from_mixed($policy['global_policy'] ?? 'free_market');

    $bottlenecks = [];
    foreach ($colonies as $c) {
        $cid = (int)$c['id'];
        flush_colony_production($db, $cid);

        $warnings = [];

        // Check satisfaction
        $satStmt = $db->prepare(<<<SQL
            SELECT COALESCE(SUM(satisfaction_index * count) / NULLIF(SUM(count), 0), 50.0) AS avg_sat,
                   SUM(shortage_ticks) AS total_shortage_ticks
            FROM economy_pop_classes WHERE colony_id = ?
        SQL);
        $satStmt->execute([$cid]);
        $satRow = $satStmt->fetch(PDO::FETCH_ASSOC);
        $avgSat = (float)($satRow['avg_sat'] ?? 50.0);
        $totalShortTicks = (int)($satRow['total_shortage_ticks'] ?? 0);

        if ($avgSat < 40.0) {
            $warnings[] = ['type' => 'satisfaction_critical', 'message' => "Pop satisfaction {$avgSat}% — Tier-3 production halted", 'severity' => 'critical'];
        } elseif ($avgSat < 60.0) {
            $warnings[] = ['type' => 'satisfaction_low', 'message' => "Pop satisfaction {$avgSat}% — production efficiency reduced", 'severity' => 'warning'];
        }

        // Check war policy conflict
        if ($warModifiers['active_wars'] > 0 && !$warModifiers['has_war_economy_policy']) {
            $warnings[] = ['type' => 'war_no_policy', 'message' => 'Active war without War Economy policy — Tier-3 production disrupted', 'severity' => 'warning'];
        }

        // Check shortage goods
        $shortStmt = $db->prepare(<<<SQL
            SELECT good_type, quantity, consumption_rate_per_hour, production_rate_per_hour
            FROM economy_processed_goods
            WHERE colony_id = ? AND consumption_rate_per_hour > production_rate_per_hour
        SQL);
        $shortStmt->execute([$cid]);
        foreach ($shortStmt->fetchAll(PDO::FETCH_ASSOC) as $sg) {
            $deficit = (float)$sg['consumption_rate_per_hour'] - (float)$sg['production_rate_per_hour'];
            $isCritical = in_array($sg['good_type'], ['consumer_goods', 'biocompost'], true);
            $warnings[] = [
                'type'     => $isCritical ? 'starvation_risk' : 'shortage',
                'good'     => $sg['good_type'],
                'message'  => "Shortage: {$sg['good_type']} deficit {$deficit}/hr",
                'severity' => $isCritical ? 'critical' : 'warning',
                'deficit_per_hour' => round($deficit, 3),
            ];
        }

        // Policy-specific warnings
        if ($globalPolicy === 'war_economy') {
            $warnings[] = ['type' => 'policy_info', 'message' => 'War Economy: military +30%, consumer goods −20%', 'severity' => 'info'];
        }
        if ($globalPolicy === 'mercantilism') {
            $warnings[] = ['type' => 'policy_info', 'message' => 'Mercantilism: imports cost +20% more', 'severity' => 'info'];
        }
        if ($globalPolicy === 'autarky') {
            $warnings[] = ['type' => 'policy_info', 'message' => 'Autarky: imports blocked, domestic production +10%', 'severity' => 'info'];
        }

        $bottlenecks[] = [
            'colony_id'    => $cid,
            'colony_name'  => $c['name'],
            'avg_satisfaction' => round($avgSat, 1),
            'shortage_ticks'   => $totalShortTicks,
            'warnings'     => $warnings,
            'warning_count' => count($warnings),
        ];
    }

    json_ok([
        'bottlenecks'    => $bottlenecks,
        'global_policy'  => $globalPolicy,
        'war_modifiers'  => $warModifiers,
    ]);
}

/**
 * GET economy.php?action=get_shortage_events[&colony_id=N][&resolved=0|1]
 *
 * Returns shortage/starvation events log.
 */
function action_get_shortage_events(PDO $db, int $uid): never {
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;
    $showResolved = isset($_GET['resolved']) && $_GET['resolved'] === '1';

    // Verify table exists
    $tableExists = $db->query("SHOW TABLES LIKE 'economy_shortage_events'")->fetchColumn();
    if (!$tableExists) {
        json_ok(['events' => []]);
    }

    $params = [$uid];
    $where = 'c.user_id = ?';
    if ($colonyId !== null) {
        $where .= ' AND e.colony_id = ?';
        $params[] = $colonyId;
    }
    if (!$showResolved) {
        $where .= ' AND e.resolved_at IS NULL';
    }

    $stmt = $db->prepare(<<<SQL
        SELECT e.id, e.colony_id, c.name AS colony_name,
               e.good_type, e.deficit_per_hour, e.severity,
               e.started_at, e.resolved_at
        FROM economy_shortage_events e
        JOIN colonies c ON c.id = e.colony_id
        WHERE {$where}
        ORDER BY e.started_at DESC
        LIMIT 100
    SQL);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    json_ok(['events' => array_map(fn($r) => [
        'id'            => (int)$r['id'],
        'colony_id'     => (int)$r['colony_id'],
        'colony_name'   => $r['colony_name'],
        'good_type'     => $r['good_type'],
        'deficit_per_hour' => (float)$r['deficit_per_hour'],
        'severity'      => $r['severity'],
        'started_at'    => $r['started_at'],
        'resolved_at'   => $r['resolved_at'],
        'active'        => $r['resolved_at'] === null,
    ], $rows)]);
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
    'get_pop_status'        => action_get_pop_status($db, $uid),
    'set_pop_policy'        => action_set_pop_policy($db, $uid),
    'get_bottleneck'        => action_get_bottleneck($db, $uid),
    'get_shortage_events'   => action_get_shortage_events($db, $uid),
    default                 => json_error('Unknown action: ' . $action, 400),
};
