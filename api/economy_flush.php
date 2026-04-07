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
        $prodRates[$good] = ($prodRates[$good] ?? 0.0) + $def['rate'] * $level * $mult * $satisfactionMult;
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
