<?php
/**
 * economy_flush.php — Lazy-Evaluation Production Flush
 *
 * Provides flush_colony_production(PDO, int): void
 *
 * Design: no background tick is needed for individual colony stock.
 * Instead, every read or write path that needs accurate stock calls this
 * function first.  It computes Δt since last_calculated_at, applies building
 * production and pop consumption rates, and persists the result.
 *
 * market_analysis.php calls this before aggregating system supply/demand so
 * that production_rate_per_hour / consumption_rate_per_hour are always fresh.
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Constants — building → good mapping + base output at level 1 per hour
// ---------------------------------------------------------------------------

if (!defined('ECONOMY_BUILDING_BASE_RATES')) {
    define('ECONOMY_BUILDING_BASE_RATES', [
        // Tier 2
        'metallurgy'              => ['good' => 'steel_alloy',             'rate' => 10.0],
        'crystal_grinder'         => ['good' => 'focus_crystals',          'rate' =>  8.0],
        'refinery'                => ['good' => 'reactor_fuel',            'rate' =>  8.0],
        'bioreactor'              => ['good' => 'biocompost',              'rate' => 12.0],
        'electronics_fab'         => ['good' => 'electronics_components',  'rate' =>  6.0],
        // Tier 3
        'consumer_factory'        => ['good' => 'consumer_goods',          'rate' =>  5.0],
        'luxury_workshop'         => ['good' => 'luxury_goods',            'rate' =>  2.0],
        'arms_factory'            => ['good' => 'military_equipment',      'rate' =>  3.0],
        'research_lab_adv'        => ['good' => 'research_kits',           'rate' =>  2.0],
        'colony_supplies'         => ['good' => 'colonization_packs',      'rate' =>  1.0],
        // Tier 4
        'neural_fabricator'       => ['good' => 'neural_implants',         'rate' =>  0.5],
        'quantum_lab'             => ['good' => 'quantum_circuits',        'rate' =>  0.3],
        'bio_pharma'              => ['good' => 'bio_supplements',         'rate' =>  0.5],
        'cultural_center'         => ['good' => 'stellar_art',             'rate' =>  0.2],
        'propulsion_works'        => ['good' => 'advanced_propulsion',     'rate' =>  0.2],
        // Tier 5
        'void_refinery'           => ['good' => 'void_crystals',           'rate' =>  0.05],
        'consciousness_institute' => ['good' => 'synthetic_consciousness', 'rate' =>  0.02],
        'temporal_atelier'        => ['good' => 'temporal_luxuries',       'rate' =>  0.01],
    ]);
}

/** Multipliers applied to base rate depending on active production method. */
if (!defined('ECONOMY_METHOD_MULTIPLIERS')) {
    define('ECONOMY_METHOD_MULTIPLIERS', [
        'standard'  => 1.0,
        'efficient' => 1.5,
        'premium'   => 2.0,
    ]);
}

/**
 * Per-1000-population consumption rates per hour.
 * Only covers goods that pops actively consume; others accumulate freely.
 */
if (!defined('ECONOMY_POP_CONSUMPTION_RATES')) {
    define('ECONOMY_POP_CONSUMPTION_RATES', [
        'consumer_goods'        => 0.20,
        'biocompost'            => 0.05,
        'research_kits'         => 0.02,
        'military_equipment'    => 0.01,
        'luxury_goods'          => 0.03,
        'neural_implants'       => 0.005,
    ]);
}

/** Maximum hours of back-accumulation applied in a single flush (prevents runaway). */
const ECONOMY_FLUSH_MAX_HOURS = 24.0;

/**
 * Policy-aware per-good production multipliers.
 *
 * war_economy: military_equipment +30%, consumer_goods −20%
 * autarky:     all domestic production +10% (import-substitution bonus)
 * subsidies:   agriculture/research/military +20% on relevant goods
 */
function get_policy_good_multipliers(PDO $db, int $owner_id): array {
    $mult = [];
    $stmt = $db->prepare('SELECT global_policy, subsidy_agriculture, subsidy_research, subsidy_military FROM economy_policies WHERE user_id = ?');
    $stmt->execute([$owner_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return $mult;
    }

    $policy = is_numeric($row['global_policy'])
        ? (['free_market', 'subsidies', 'mercantilism', 'autarky', 'war_economy'][(int)$row['global_policy']] ?? 'free_market')
        : (string)$row['global_policy'];

    if ($policy === 'war_economy') {
        $mult['military_equipment'] = ($mult['military_equipment'] ?? 1.0) * 1.30;
        $mult['consumer_goods']     = ($mult['consumer_goods']     ?? 1.0) * 0.80;
    }

    if ($policy === 'autarky') {
        // Domestic production bonus — all goods +10%
        foreach (['steel_alloy','focus_crystals','reactor_fuel','biocompost','electronics_components',
                  'consumer_goods','luxury_goods','military_equipment','research_kits','colonization_packs'] as $g) {
            $mult[$g] = ($mult[$g] ?? 1.0) * 1.10;
        }
    }

    if ((int)($row['subsidy_agriculture'] ?? 0)) {
        $mult['biocompost']  = ($mult['biocompost']  ?? 1.0) * 1.20;
        $mult['food']        = ($mult['food']        ?? 1.0) * 1.20;
    }
    if ((int)($row['subsidy_research'] ?? 0)) {
        $mult['research_kits']     = ($mult['research_kits']     ?? 1.0) * 1.20;
        $mult['quantum_circuits']  = ($mult['quantum_circuits']  ?? 1.0) * 1.15;
    }
    if ((int)($row['subsidy_military'] ?? 0)) {
        $mult['military_equipment'] = ($mult['military_equipment'] ?? 1.0) * 1.20;
    }

    return $mult;
}

/**
 * Log a shortage/starvation event for a colony/good when stock hits zero.
 * The economy_shortage_events table must exist (created by migration).
 */
function log_shortage_event(PDO $db, int $colony_id, string $good_type, float $deficit_per_hour): void {
    // Critical goods cause starvation; others are just shortages
    static $criticalGoods = ['consumer_goods', 'biocompost'];
    $severity = in_array($good_type, $criticalGoods, true) ? 'starvation' : 'shortage';

    // Insert only if no open event for this colony+good already exists
    $db->prepare(<<<SQL
        INSERT IGNORE INTO economy_shortage_events (colony_id, good_type, deficit_per_hour, severity)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1 FROM economy_shortage_events
            WHERE colony_id = ? AND good_type = ? AND resolved_at IS NULL
        )
    SQL)->execute([$colony_id, $good_type, $deficit_per_hour, $severity, $colony_id, $good_type]);
}

/**
 * Resolve any open shortage events for a colony+good when stock is positive.
 */
function resolve_shortage_event(PDO $db, int $colony_id, string $good_type): void {
    $db->prepare(<<<SQL
        UPDATE economy_shortage_events
        SET resolved_at = NOW()
        WHERE colony_id = ? AND good_type = ? AND resolved_at IS NULL
    SQL)->execute([$colony_id, $good_type]);
}

/**
 * Update pop satisfaction_index based on goods shortages.
 * Shortage ticks increment shortage_ticks counter; adequate supply restores satisfaction.
 */
function update_pop_satisfaction_from_goods(PDO $db, int $colony_id, array $goodStates): void {
    // goodStates: [ good_type => ['has_shortage' => bool, 'net_rate' => float] ]
    $hasCriticalShortage = false;
    $shortageCount = 0;
    foreach ($goodStates as $good => $state) {
        if ($state['has_shortage']) {
            $shortageCount++;
            if (in_array($good, ['consumer_goods', 'biocompost'], true)) {
                $hasCriticalShortage = true;
            }
        }
    }

    // Adjust satisfaction: -5 per shortage good per tick, -15 for critical shortage
    $satisfactionDelta = 0;
    if ($shortageCount > 0) {
        $satisfactionDelta -= $shortageCount * 5;
    }
    if ($hasCriticalShortage) {
        $satisfactionDelta -= 15;
    }
    // Small recovery if no shortages
    if ($shortageCount === 0) {
        $satisfactionDelta = 2;
    }

    if ($satisfactionDelta === 0) {
        return;
    }

    $db->prepare(<<<SQL
        UPDATE economy_pop_classes
        SET satisfaction_index = GREATEST(0, LEAST(100, satisfaction_index + ?)),
            shortage_ticks     = CASE WHEN ? < 0 THEN shortage_ticks + 1 ELSE GREATEST(0, shortage_ticks - 1) END
        WHERE colony_id = ?
    SQL)->execute([$satisfactionDelta, $satisfactionDelta, $colony_id]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Flush lazy production/consumption for one colony.
 *
 * Must be called before any read that depends on current stock levels, and
 * before any write that modifies quantity (to prevent double-counting).
 *
 * Idempotent: if called twice within milliseconds the second call changes
 * nothing (Δt ≈ 0).
 *
 * @param PDO $db
 * @param int $colony_id
 */
function flush_colony_production(PDO $db, int $colony_id): void {
    // 1. Colony population
    $stmt = $db->prepare('SELECT population FROM colonies WHERE id = ?');
    $stmt->execute([$colony_id]);
    $colRow = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$colRow) {
        return;  // Colony not found — nothing to flush
    }
    $population = (int)$colRow['population'];

    // 2. Building levels per type (UNIQUE per colony+type)
    $stmt = $db->prepare('SELECT type, level FROM buildings WHERE colony_id = ? AND level > 0');
    $stmt->execute([$colony_id]);
    $buildings = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $b) {
        $buildings[$b['type']] = (int)$b['level'];
    }

    // 3. Active production methods
    $stmt = $db->prepare('SELECT building_type, method FROM economy_production_methods WHERE colony_id = ?');
    $stmt->execute([$colony_id]);
    $methods = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $m) {
        $methods[$m['building_type']] = $m['method'];
    }

    // 4. Per-good production rates (from buildings)
    //    PHASE 2.3: satisfaction multiplier (0.5x–1.5x) applied to all rates
    $satisfactionMult = 1.0;
    {
        $satStmt = $db->prepare(<<<SQL
            SELECT COALESCE(
                SUM(satisfaction_index * count) / NULLIF(SUM(count), 0),
                50.0
            ) AS weighted_satisfaction
            FROM economy_pop_classes WHERE colony_id = ?
        SQL);
        $satStmt->execute([$colony_id]);
        $satRow = $satStmt->fetch(PDO::FETCH_ASSOC);
        $satisfactionIndex = (float)($satRow['weighted_satisfaction'] ?? 50.0);
        $satisfactionMult = 0.5 + ($satisfactionIndex / 100.0);  // 0.5x–1.5x
    }

    // PHASE 3.2 – Determine which tiers are unlocked for this colony's owner.
    // T3+ goods are disrupted when:
    //   a) Pop satisfaction < 40 (workforce too unhappy to operate advanced facilities)
    //   b) Player has an active war AND no 'war_economy' policy active
    $tier3Blocked = false;
    {
        if ($satisfactionIndex < 40.0) {
            $tier3Blocked = true;
        } else {
            // Check for war without war_economy policy
            $ownerStmt = $db->prepare('SELECT user_id FROM colonies WHERE id = ?');
            $ownerStmt->execute([$colony_id]);
            $ownerRow = $ownerStmt->fetch(PDO::FETCH_ASSOC);
            if ($ownerRow) {
                $ownerId = (int)$ownerRow['user_id'];
                $hasWarTable = $db->query("SHOW TABLES LIKE 'wars'")->fetchColumn();
                if ($hasWarTable) {
                    $warActive = $db->prepare(
                        'SELECT COUNT(*) FROM wars WHERE (attacker_user_id = ? OR defender_user_id = ?) AND status = ?'
                    );
                    $warActive->execute([$ownerId, $ownerId, 'active']);
                    $atWar = (int)$warActive->fetchColumn() > 0;
                    if ($atWar) {
                        $polStmt = $db->prepare('SELECT global_policy FROM economy_policies WHERE user_id = ?');
                        $polStmt->execute([$ownerId]);
                        $rawPolicy = $polStmt->fetchColumn();

                        $warEconomyActive = false;
                        if (is_numeric($rawPolicy)) {
                            // Legacy schema: global_policy as integer index in VALID_POLICIES order
                            $warEconomyActive = ((int)$rawPolicy === 4);
                        } else {
                            $warEconomyActive = ((string)$rawPolicy === 'war_economy');
                        }

                        if (!$warEconomyActive) {
                            $tier3Blocked = true;
                        }
                    }
                }
            }
        }
    }

    // Tier-3+ building keys (consumer_factory and above in ECONOMY_BUILDING_BASE_RATES definition)
    static $tier3Buildings = [
        'consumer_factory', 'luxury_workshop', 'arms_factory', 'research_lab_adv', 'colony_supplies',
        'neural_fabricator', 'quantum_lab', 'bio_pharma', 'cultural_center', 'propulsion_works',
        'void_refinery', 'consciousness_institute', 'temporal_atelier',
    ];

    // PHASE 3.3 – Fetch policy-aware per-good multipliers (war_economy, autarky, subsidies)
    $policyGoodMults = [];
    if (!empty($ownerRow['user_id']) || isset($ownerId)) {
        $effectiveOwnerId = $ownerId ?? (int)($ownerRow['user_id'] ?? 0);
        if ($effectiveOwnerId > 0) {
            $policyGoodMults = get_policy_good_multipliers($db, $effectiveOwnerId);
        }
    } else {
        // Fallback: resolve owner here
        $ownerFb = $db->prepare('SELECT user_id FROM colonies WHERE id = ?');
        $ownerFb->execute([$colony_id]);
        $ownerFbRow = $ownerFb->fetch(PDO::FETCH_ASSOC);
        if ($ownerFbRow) {
            $policyGoodMults = get_policy_good_multipliers($db, (int)$ownerFbRow['user_id']);
        }
    }

    $prodRates = [];
    foreach (ECONOMY_BUILDING_BASE_RATES as $buildingType => $def) {
        $level = $buildings[$buildingType] ?? 0;
        if ($level <= 0) {
            continue;
        }
        // PHASE 3.2: Block T3+ production under war/satisfaction stress
        if ($tier3Blocked && in_array($buildingType, $tier3Buildings, true)) {
            continue;
        }
        $method = $methods[$buildingType] ?? 'standard';
        $mult   = ECONOMY_METHOD_MULTIPLIERS[$method] ?? 1.0;
        $good   = $def['good'];
        // PHASE 3.3: Apply policy good multipliers
        $policyMult = $policyGoodMults[$good] ?? 1.0;
        $prodRates[$good] = ($prodRates[$good] ?? 0.0) + $def['rate'] * $level * $mult * $satisfactionMult * $policyMult;
    }

    // 5. Per-good consumption rates (from population)
    $consRates = [];
    if ($population > 0) {
        $popK = $population / 1000.0;
        foreach (ECONOMY_POP_CONSUMPTION_RATES as $good => $ratePerK) {
            $consRates[$good] = $ratePerK * $popK;
        }
    }

    // 6. Ensure rows exist for all actively-produced goods (INSERT IGNORE)
    $insStmt = $db->prepare(<<<SQL
        INSERT IGNORE INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
        VALUES (?, ?, 0.0, 5000.0)
    SQL);
    foreach (array_keys($prodRates) as $goodType) {
        $insStmt->execute([$colony_id, $goodType]);
    }

    // 7. Read all current rows and apply delta
    $selStmt = $db->prepare(<<<SQL
        SELECT id, good_type, quantity, capacity, last_calculated_at
        FROM economy_processed_goods
        WHERE colony_id = ?
    SQL);
    $selStmt->execute([$colony_id]);
    $rows = $selStmt->fetchAll(PDO::FETCH_ASSOC);

    if (!$rows) {
        return;
    }

    $now = time();
    $updStmt = $db->prepare(<<<SQL
        UPDATE economy_processed_goods
        SET quantity                 = ?,
            production_rate_per_hour = ?,
            consumption_rate_per_hour = ?,
            last_calculated_at       = NOW()
        WHERE id = ?
    SQL);

    // PHASE 3.3: Track goods states for shortage/satisfaction updates
    $goodStates = [];

    foreach ($rows as $r) {
        $goodType = $r['good_type'];
        $prodRate = $prodRates[$goodType] ?? 0.0;
        $consRate = $consRates[$goodType] ?? 0.0;

        $lastCalc = strtotime((string)$r['last_calculated_at']);
        $deltaH   = ($now - $lastCalc) / 3600.0;
        $deltaH   = max(0.0, min($deltaH, ECONOMY_FLUSH_MAX_HOURS));

        $newQty = (float)$r['quantity'] + ($prodRate - $consRate) * $deltaH;
        $newQty = max(0.0, min((float)$r['capacity'], $newQty));

        $updStmt->execute([$newQty, $prodRate, $consRate, (int)$r['id']]);

        // PHASE 3.3: Track shortage state for consumed goods
        if ($consRate > 0) {
            $hasShortage = ($newQty <= 0.0 && $consRate > $prodRate);
            $goodStates[$goodType] = [
                'has_shortage' => $hasShortage,
                'net_rate'     => $prodRate - $consRate,
            ];
            if ($hasShortage) {
                log_shortage_event($db, $colony_id, $goodType, $consRate - $prodRate);
            } else {
                resolve_shortage_event($db, $colony_id, $goodType);
            }
        }
    }

    // PHASE 3.3: Update pop satisfaction based on shortage state
    if (!empty($goodStates)) {
        update_pop_satisfaction_from_goods($db, $colony_id, $goodStates);
    }

    // PHASE 2.2 – Apply active pirate raid damage to current goods quantities.
    // If a colony has unrepaired damage recorded in pirate_damage_recovery, reduce
    // all stored goods proportionally (simulates disrupted supply chains).
    $hasDmgTable = $db->query("SHOW TABLES LIKE 'pirate_damage_recovery'")->fetchColumn();
    if ($hasDmgTable) {
        $dmgStmt = $db->prepare(<<<SQL
            SELECT (100 - LEAST(recovery_percent, 99)) / 100.0 AS damage_factor
            FROM   pirate_damage_recovery
            WHERE  colony_id = ?
              AND  recovery_percent < 100
                        ORDER BY recovery_started DESC
            LIMIT  1
        SQL);
        $dmgStmt->execute([$colony_id]);
        $dmgRow = $dmgStmt->fetch(PDO::FETCH_ASSOC);

        if ($dmgRow && (float)$dmgRow['damage_factor'] > 0) {
            $damageFactor = (float)$dmgRow['damage_factor'];
            // damageFactor is the fraction of goods capacity still offline (0..1).
            // We cap goods at (1 - damageFactor) of their current quantity, i.e.
            // a colony with 40 % unrepaired damage loses up to 40 % of its stock.
            $capMult = 1.0 - ($damageFactor * 0.5); // maximum 50 % reduction
            $capMult = max(0.5, $capMult);

            $db->prepare(
                'UPDATE economy_processed_goods
                 SET quantity = GREATEST(0, quantity * ?)
                 WHERE colony_id = ?'
            )->execute([$capMult, $colony_id]);
        }
    }
}
