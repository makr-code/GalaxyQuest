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
    $prodRates = [];
    foreach (ECONOMY_BUILDING_BASE_RATES as $buildingType => $def) {
        $level = $buildings[$buildingType] ?? 0;
        if ($level <= 0) {
            continue;
        }
        $method = $methods[$buildingType] ?? 'standard';
        $mult   = ECONOMY_METHOD_MULTIPLIERS[$method] ?? 1.0;
        $good   = $def['good'];
        $prodRates[$good] = ($prodRates[$good] ?? 0.0) + $def['rate'] * $level * $mult;
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
}
