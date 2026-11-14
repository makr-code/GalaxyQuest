<?php
/**
 * Market Analysis Engine — Supply/Demand Calculation & Trade Opportunity Detection
 * 
 * This module provides the core economic simulation for the traders system:
 * - Calculates supply/demand per system based on colony production/consumption
 * - Detects profitable trade routes (arbitrage)
 * - Ranks opportunities by profit potential
 */

declare(strict_types=1);

use GalaxyQuest\Economy\OnDemandEconomy;

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

if (!defined('GQ_MARKET_ANALYSIS_BASE_PRICES')) {
    define('GQ_MARKET_ANALYSIS_BASE_PRICES', [
        'metal' => 10.0,
        'crystal' => 15.0,
        'deuterium' => 20.0,
        'rare_earth' => 50.0,
        'food' => 8.0,
        'steel_alloy' => 35.0,
        'focus_crystals' => 60.0,
        'reactor_fuel' => 55.0,
        'biocompost' => 25.0,
        'electronics_components' => 70.0,
        'consumer_goods' => 80.0,
        'luxury_goods' => 200.0,
        'military_equipment' => 150.0,
        'research_kits' => 130.0,
        'colonization_packs' => 250.0,
        'neural_implants' => 400.0,
        'quantum_circuits' => 550.0,
        'bio_supplements' => 350.0,
        'stellar_art' => 600.0,
        'advanced_propulsion' => 800.0,
        'void_crystals' => 2500.0,
        'synthetic_consciousness' => 4000.0,
        'temporal_luxuries' => 5000.0,
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate colony production/consumption for a system to determine local
 * supply and demand per resource type.
 * 
 * @param PDO $db
 * @param int $galaxy_index
 * @param int $system_index
 * @return array<string, array> Keyed by resource_type
 */
function calculate_system_supply_demand(
    PDO $db,
    int $galaxy_index,
    int $system_index
): array {
    $market = (new OnDemandEconomy($db))->market($galaxy_index, $system_index);
    $analysis = [];
    foreach ($market['goods'] as $type => $good) {
        $supply = $good['quantity'] / 24 + $good['production_per_hour'];
        $demand = $good['consumption_per_hour'];
        $analysis[$type] = [
            'production' => $good['production_per_hour'],
            'consumption' => $demand, 'available_supply' => $supply,
            'desired_demand' => $demand, 'net_balance' => $supply - $demand,
            'oldest_settled_at' => $good['oldest_settled_at'],
            'represented_colonies' => $good['represented_colonies'],
        ];
    }
    return $analysis;
}

/**
 * Update the market_supply_demand table with current system analysis.
 * Called once per hour or per trader-tick cycle.
 * 
 * @param PDO $db
 * @return int Number of rows updated
 */
function update_supply_demand_table(PDO $db): int {
    $statement = $db->prepare(<<<SQL
        INSERT INTO market_supply_demand
            (galaxy_index,system_index,resource_type,production_per_hour,consumption_per_hour,
             available_supply,desired_demand,net_balance)
        SELECT galaxy_index,system_index,good_type,SUM(production),SUM(consumption),
               SUM(quantity)/24+SUM(production),SUM(consumption),
               SUM(quantity)/24+SUM(production)-SUM(consumption)
        FROM economy_colony_market GROUP BY galaxy_index,system_index,good_type
        ON DUPLICATE KEY UPDATE
            production_per_hour=VALUES(production_per_hour),
            consumption_per_hour=VALUES(consumption_per_hour),
            available_supply=VALUES(available_supply),desired_demand=VALUES(desired_demand),
            net_balance=VALUES(net_balance),updated_at=NOW()
        SQL);
    $statement->execute();
    return $statement->rowCount();
}

/**
 * Find all profitable trade opportunities by comparing system prices and supply/demand.
 * 
 * Algorithm:
 * 1. Get current prices per system/resource
 * 2. For each resource, find (seller_system, buyer_system) pairs where:
 *    - Seller has surplus (net_balance > 0)
 *    - Buyer has deficit (net_balance < 0)
 *    - buyer_price - seller_price - transport_cost > MIN_MARGIN
 * 3. Calculate actual tradeable quantity = min(surplus, deficit)
 * 4. Rank by profit_per_unit * quantity
 * 
 * @param PDO $db
 * @param float $min_margin_pct Minimum profit margin to consider (default 15%)
 * @return int Number of opportunities found and inserted
 */
function find_and_rank_trade_opportunities(PDO $db, float $min_margin_pct = 15.0): int {
    // 1. Clear old opportunities
    $db->prepare('DELETE FROM trade_opportunities WHERE expires_at < NOW()')->execute();
    
    // 2. Get all systems with supply/demand data
    $sysStmt = $db->prepare(<<<SQL
        SELECT DISTINCT galaxy_index, system_index FROM market_supply_demand
        WHERE net_balance != 0
    SQL);
    $sysStmt->execute();
    $systems = $sysStmt->fetchAll(PDO::FETCH_NUM);
    
    if (count($systems) < 2) {
        return 0;  // Not enough systems to trade between
    }
    
    $inserted = 0;
    
    // 3. For each resource type, compare all system pairs
    $resourceTypes = array_keys(\GalaxyQuest\Economy\ColonyEconomySimulation::PRICES);
    
    foreach ($resourceTypes as $resource) {
        // Get all systems' data for this resource
        $sdStmt = $db->prepare(<<<SQL
            SELECT galaxy_index, system_index, net_balance, available_supply, desired_demand, consumption_per_hour
            FROM market_supply_demand
            WHERE resource_type = ?
        SQL);
        $sdStmt->execute([$resource]);
        $rows = $sdStmt->fetchAll(PDO::FETCH_ASSOC);
        if (empty($rows)) {
            continue;
        }

        // Relative surplus/deficit: center each resource around its mean balance.
        // This keeps opportunities alive even when a resource is globally abundant/scarce.
        $sumBalance = 0.0;
        foreach ($rows as $row) {
            $sumBalance += (float)$row['net_balance'];
        }
        $avgBalance = $sumBalance / max(1, count($rows));

        $systemData = [];
        foreach ($rows as $row) {
            $key = (int)$row['galaxy_index'] . ':' . (int)$row['system_index'];
            $row['effective_balance'] = (float)$row['net_balance'] - $avgBalance;
            $systemData[$key] = $row;
        }
        
        // Compare system pairs
        $systems_list = array_keys($systemData);
        for ($i = 0; $i < count($systems_list); $i++) {
            for ($j = $i + 1; $j < count($systems_list); $j++) {
                $systemA = $systems_list[$i];
                $systemB = $systems_list[$j];
                
                $dataA = $systemData[$systemA];
                $dataB = $systemData[$systemB];
                
                [$galA, $sysA] = explode(':', $systemA);
                [$galB, $sysB] = explode(':', $systemB);
                
                // Try both directions
                check_trade_pair(
                    $db, $resource,
                    (int)$galA, (int)$sysA, 
                    (int)$galB, (int)$sysB,
                    $dataA, $dataB,
                    $min_margin_pct,
                    $inserted
                );
                
                check_trade_pair(
                    $db, $resource,
                    (int)$galB, (int)$sysB,
                    (int)$galA, (int)$sysA,
                    $dataB, $dataA,
                    $min_margin_pct,
                    $inserted
                );
            }
        }
    }
    
    return $inserted;
}

/**
 * Check if trading from systemA to systemB is profitable.
 */
function check_trade_pair(
    PDO $db,
    string $resource,
    int $galA, int $sysA,
    int $galB, int $sysB,
    array $dataA, array $dataB,
    float $min_margin_pct,
    int &$inserted
): void {
    // Seller: system with surplus
    // Buyer: system with deficit
    
    $sellerBalance = (float)($dataA['effective_balance'] ?? $dataA['net_balance']);
    $buyerBalance  = (float)($dataB['effective_balance'] ?? $dataB['net_balance']);
    
    if ($sellerBalance <= 0 || $buyerBalance >= 0) {
        return;  // No arbitrage opportunity
    }
    
    // Get system prices (dynamically computed from supply/demand)
    $priceA = compute_system_price($db, $galA, $sysA, $resource);
    $priceB = compute_system_price($db, $galB, $sysB, $resource);
    
    if ($priceA >= $priceB) {
        return;  // No profit if seller price >= buyer price
    }
    
    // Calculate transport cost approximation
    $distLy = system_distance($db, $galA, $sysA, $galB, $sysB);
    // Calibrated for current star coordinate scale (~10k-80k LY distances).
    $transportCost = $distLy * 0.00005;
    
    // Profit calculation
    $grossMargin = ($priceB - $priceA) / $priceA * 100;
    $netMargin = (($priceB - $transportCost) - $priceA) / $priceA * 100;
    
    if ($netMargin < $min_margin_pct) {
        return;  // Below minimum threshold
    }
    
    // Calculate tradeable quantity
    $availableSell = min(
        (float)$dataA['available_supply'],
        abs($sellerBalance)  // How much surplus
    );
    $desiredDemand = max(0.0, (float)$dataB['desired_demand']) + max(0.0, (float)($dataB['consumption_per_hour'] ?? 0.0));
    $desiredBuy = min(abs($buyerBalance), $desiredDemand > 0 ? $desiredDemand : abs($buyerBalance));
    $tradeQty = min($availableSell, $desiredBuy);
    
    if ($tradeQty <= 0) {
        return;  // No actual goods to trade
    }
    
    // Insert opportunity
    $stmt = $db->prepare(<<<SQL
        INSERT INTO trade_opportunities
        (source_system, target_system, resource_type,
         source_price, target_price, profit_margin,
         available_qty, demand_qty, actual_qty,
         transport_cost, net_profit_per_unit,
         confidence, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))
    SQL);
    
    $profitPerUnit = ($priceB - $transportCost) - $priceA;
    $confidence = min(1.0, ($tradeQty / 1000.0));  // Higher qty = higher confidence
    
    $stmt->execute([
        $sysA, $sysB, $resource,
        $priceA, $priceB, $netMargin,
        $availableSell, $desiredBuy, $tradeQty,
        $transportCost, $profitPerUnit,
        $confidence,
    ]);
    
    $inserted += 1;
}

/**
 * Compute dynamic price for a system based on local supply/demand.
 * Formula: price = base_price * (demand / supply) ^ ELASTICITY
 */
function compute_system_price(PDO $db, int $galaxy, int $system, string $resource): float {
    $stmt = $db->prepare(<<<SQL
        SELECT available_supply, desired_demand, consumption_per_hour FROM market_supply_demand
        WHERE galaxy_index = ? AND system_index = ? AND resource_type = ?
    SQL);
    $stmt->execute([$galaxy, $system, $resource]);
    $data = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$data) {
        return (GQ_MARKET_ANALYSIS_BASE_PRICES[$resource] ?? 100.0);
    }
    
    $supply = max(1.0, (float)$data['available_supply']);
    $demand = max(1.0, (float)$data['desired_demand'] + (float)($data['consumption_per_hour'] ?? 0.0));
    
    $basePrice = (GQ_MARKET_ANALYSIS_BASE_PRICES[$resource] ?? 100.0);
    $elasticity = 0.4;  // Matches market.php pricing
    
    $multiplier = pow($demand / $supply, $elasticity);
    $multiplier = max(0.3, min(3.5, $multiplier));  // Clamp
    
    return $basePrice * $multiplier;
}

/**
 * Estimate distance between two systems using star_systems coordinates.
 * Falls back to legacy approximation when coordinates are unavailable.
 */
function system_distance(PDO $db, int $galA, int $sysA, int $galB, int $sysB): float {
    if ($galA !== $galB) {
        return 10000.0;  // Inter-galactic trade (very expensive)
    }

    static $coordStmt = null;
    if ($coordStmt === null) {
        $coordStmt = $db->prepare(
            'SELECT x_ly, y_ly, z_ly FROM star_systems WHERE galaxy_index = ? AND system_index = ? LIMIT 1'
        );
    }

    $coordStmt->execute([$galA, $sysA]);
    $a = $coordStmt->fetch(PDO::FETCH_ASSOC);

    $coordStmt->execute([$galB, $sysB]);
    $b = $coordStmt->fetch(PDO::FETCH_ASSOC);

    if (!$a || !$b) {
        return abs(($sysA - $sysB) * 15.0);  // legacy fallback
    }

    $dx = (float)$a['x_ly'] - (float)$b['x_ly'];
    $dy = (float)$a['y_ly'] - (float)$b['y_ly'];
    $dz = (float)$a['z_ly'] - (float)$b['z_ly'];
    return max(1.0, sqrt($dx * $dx + $dy * $dy + $dz * $dz));
}
