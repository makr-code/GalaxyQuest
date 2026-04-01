<?php
// api/market.php — Galactic Market: price queries, buy/sell, history, events
//
// Actions:
//   get_prices       — current market prices for all goods (or one good)
//   buy              — buy processed goods from the galactic market (POST)
//   sell             — sell processed goods to the galactic market (POST)
//   get_history      — recent trade transactions for the current player
//   get_active_events — list active market events

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');

$uid    = require_auth();
$db     = get_db();
$action = $_GET['action'] ?? '';

match ($action) {
    'get_prices'       => action_get_prices($db, $uid),
    'buy'              => action_buy($db, $uid),
    'sell'             => action_sell($db, $uid),
    'get_history'      => action_get_history($db, $uid),
    'get_active_events'=> action_get_active_events($db),
    default            => json_error('Unknown action: ' . $action, 400),
};

// ---------------------------------------------------------------------------
// Base price table (mirrors JS GOOD_BASE_PRICE)
// ---------------------------------------------------------------------------

const BASE_PRICES = [
    'metal'                      =>   10,
    'crystal'                    =>   15,
    'deuterium'                  =>   20,
    'rare_earth'                 =>   50,
    'food'                       =>    8,
    'steel_alloy'                =>   35,
    'focus_crystals'             =>   60,
    'reactor_fuel'               =>   55,
    'biocompost'                 =>   25,
    'electronics_components'     =>   70,
    'consumer_goods'             =>   80,
    'luxury_goods'               =>  200,
    'military_equipment'         =>  150,
    'research_kits'              =>  130,
    'colonization_packs'         =>  250,
    'neural_implants'            =>  400,
    'quantum_circuits'           =>  550,
    'bio_supplements'            =>  350,
    'stellar_art'                =>  600,
    'advanced_propulsion'        =>  800,
    'void_crystals'              => 2500,
    'synthetic_consciousness'    => 4000,
    'temporal_luxuries'          => 5000,
];

/** Price elasticity exponent (mirrors JS PRICE_ELASTICITY) */
const PRICE_ELASTICITY = 0.4;
/** Minimum price multiplier */
const PRICE_MULT_MIN = 0.30;
/** Maximum price multiplier */
const PRICE_MULT_MAX = 3.50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute current market price for a good from the market_prices table.
 * Applies supply/demand formula and active event multipliers.
 *
 * @param PDO $db
 * @param string $goodType
 * @return float
 */
function compute_price(PDO $db, string $goodType): float {
    $stmt = $db->prepare('SELECT supply, demand FROM economy_market_prices WHERE good_type = ?');
    $stmt->execute([$goodType]);
    $row  = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return BASE_PRICES[$goodType] ?? 10.0;
    }

    $supply  = max(1.0, (float)$row['supply']);
    $demand  = max(0.0, (float)$row['demand']);
    $mult    = pow($demand / $supply, PRICE_ELASTICITY);
    $mult    = max(PRICE_MULT_MIN, min(PRICE_MULT_MAX, $mult));

    // Apply active event multipliers
    $evStmt = $db->prepare(<<<SQL
        SELECT price_mult FROM economy_market_events
        WHERE remaining_ticks > 0 AND (affected_good IS NULL OR affected_good = ?)
    SQL);
    $evStmt->execute([$goodType]);
    foreach ($evStmt->fetchAll(PDO::FETCH_COLUMN) as $evMult) {
        $mult *= (float)$evMult;
    }

    $base  = BASE_PRICES[$goodType] ?? 10.0;
    return round($base * $mult, 2);
}

/**
 * Fetch the player's trade tax rate from their economy_policies row.
 *
 * @param PDO $db
 * @param int $uid
 * @return float
 */
function fetch_trade_tax(PDO $db, int $uid): float {
    $stmt = $db->prepare('SELECT tax_trade, global_policy FROM economy_policies WHERE user_id = ?');
    $stmt->execute([$uid]);
    $row  = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return 0.05; // default
    $tax  = (float)$row['tax_trade'];
    // Autarky blocks imports entirely — handled in buy()
    return $tax;
}

/**
 * Update supply/demand for a good in economy_market_prices.
 *
 * @param PDO $db
 * @param string $goodType
 * @param float $supplyDelta
 * @param float $demandDelta
 */
function update_supply_demand(PDO $db, string $goodType, float $supplyDelta, float $demandDelta): void {
    $db->prepare(<<<SQL
        INSERT INTO economy_market_prices (good_type, supply, demand)
        VALUES (?, GREATEST(0, 100 + ?), GREATEST(0, 100 + ?))
        ON DUPLICATE KEY UPDATE
            supply = GREATEST(0, supply + ?),
            demand = GREATEST(0, demand + ?),
            updated_at = CURRENT_TIMESTAMP
    SQL)->execute([$goodType, $supplyDelta, $demandDelta, $supplyDelta, $demandDelta]);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * GET market.php?action=get_prices[&good_type=X]
 *
 * Returns current market prices (and supply/demand state) for all goods,
 * or for a single good if good_type is specified.
 */
function action_get_prices(PDO $db, int $uid): never {
    $filter = $_GET['good_type'] ?? null;
    $goods  = $filter ? [$filter] : array_keys(BASE_PRICES);

    $prices = [];
    foreach ($goods as $good) {
        $stmt = $db->prepare('SELECT supply, demand FROM economy_market_prices WHERE good_type = ?');
        $stmt->execute([$good]);
        $row  = $stmt->fetch(PDO::FETCH_ASSOC);
        $prices[$good] = [
            'good_type'  => $good,
            'base_price' => BASE_PRICES[$good] ?? 0,
            'price'      => compute_price($db, $good),
            'supply'     => $row ? (float)$row['supply'] : 100.0,
            'demand'     => $row ? (float)$row['demand'] : 100.0,
        ];
    }

    json_ok(['prices' => $filter ? ($prices[$filter] ?? []) : array_values($prices)]);
}

/**
 * POST market.php?action=buy
 * Body: { colony_id, good_type, quantity }
 *
 * Buy processed goods from the galactic market.
 * Deducts credits from the player; adds goods to colony stock.
 * Respects AUTARKY policy (no imports allowed).
 */
function action_buy(PDO $db, int $uid): never {
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $colonyId = (int)($body['colony_id'] ?? 0);
    $goodType = trim($body['good_type'] ?? '');
    $quantity = (float)($body['quantity'] ?? 0);

    if (!$colonyId)       json_error('colony_id required', 400);
    if (!$goodType)       json_error('good_type required', 400);
    if ($quantity <= 0)   json_error('quantity must be > 0', 400);
    if (!isset(BASE_PRICES[$goodType])) json_error('Unknown good_type: ' . $goodType, 400);

    // Verify colony ownership
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

    // Check AUTARKY policy
    $pStmt = $db->prepare('SELECT global_policy FROM economy_policies WHERE user_id = ?');
    $pStmt->execute([$uid]);
    $pRow  = $pStmt->fetch(PDO::FETCH_ASSOC);
    if ($pRow && $pRow['global_policy'] === 'autarky') {
        json_error('Autarky policy: imports are blocked', 403);
    }

    $taxRate  = fetch_trade_tax($db, $uid);
    $price    = compute_price($db, $goodType);
    $gross    = $price * $quantity;
    $total    = round($gross * (1 + $taxRate), 2);

    // Check player credits
    $cStmt = $db->prepare('SELECT credits FROM users WHERE id = ?');
    $cStmt->execute([$uid]);
    $cRow  = $cStmt->fetch(PDO::FETCH_ASSOC);
    if (!$cRow || (float)$cRow['credits'] < $total) {
        json_error('Insufficient credits. Need ' . $total . ', have ' . (float)($cRow['credits'] ?? 0), 400);
    }

    $db->beginTransaction();
    try {
        // Deduct credits
        $db->prepare('UPDATE users SET credits = credits - ? WHERE id = ?')
           ->execute([$total, $uid]);

        // Add goods to colony stock
        $db->prepare(<<<SQL
            INSERT INTO economy_processed_goods (colony_id, good_type, quantity, capacity)
            VALUES (?, ?, ?, 5000)
            ON DUPLICATE KEY UPDATE
                quantity = LEAST(capacity, quantity + VALUES(quantity)),
                updated_at = CURRENT_TIMESTAMP
        SQL)->execute([$colonyId, $goodType, $quantity]);

        // Update market demand
        update_supply_demand($db, $goodType, 0, $quantity * 0.1);

        // Log transaction
        $db->prepare(<<<SQL
            INSERT INTO economy_market_transactions
                (user_id, colony_id, good_type, direction, quantity, price_per_unit, total_credits, trade_tax_rate, net_credits)
            VALUES (?, ?, ?, 'buy', ?, ?, ?, ?, ?)
        SQL)->execute([$uid, $colonyId, $goodType, $quantity, $price, $total, $taxRate, $total]);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        json_error('Transaction failed: ' . $e->getMessage(), 500);
    }

    json_ok([
        'colony_id'     => $colonyId,
        'good_type'     => $goodType,
        'quantity'      => $quantity,
        'price_per_unit'=> $price,
        'trade_tax'     => $taxRate,
        'total_credits' => $total,
    ]);
}

/**
 * POST market.php?action=sell
 * Body: { colony_id, good_type, quantity }
 *
 * Sell processed goods to the galactic market.
 * Adds credits to the player; removes goods from colony stock.
 */
function action_sell(PDO $db, int $uid): never {
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $colonyId = (int)($body['colony_id'] ?? 0);
    $goodType = trim($body['good_type'] ?? '');
    $quantity = (float)($body['quantity'] ?? 0);

    if (!$colonyId)     json_error('colony_id required', 400);
    if (!$goodType)     json_error('good_type required', 400);
    if ($quantity <= 0) json_error('quantity must be > 0', 400);
    if (!isset(BASE_PRICES[$goodType])) json_error('Unknown good_type: ' . $goodType, 400);

    // Verify colony ownership
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) json_error('Colony not found or access denied', 403);

    // Check available stock
    $gStmt = $db->prepare('SELECT quantity FROM economy_processed_goods WHERE colony_id = ? AND good_type = ?');
    $gStmt->execute([$colonyId, $goodType]);
    $gRow  = $gStmt->fetch(PDO::FETCH_ASSOC);
    $available = $gRow ? (float)$gRow['quantity'] : 0;
    if ($available < $quantity) {
        json_error('Insufficient stock. Have ' . $available . ', trying to sell ' . $quantity, 400);
    }

    // MERCANTILISM +20% export bonus
    $pStmt = $db->prepare('SELECT global_policy, tax_trade FROM economy_policies WHERE user_id = ?');
    $pStmt->execute([$uid]);
    $pRow      = $pStmt->fetch(PDO::FETCH_ASSOC);
    $taxRate   = $pRow ? (float)$pRow['tax_trade'] : 0.05;
    $exportMult = ($pRow && $pRow['global_policy'] === 'mercantilism') ? 1.20 : 1.0;

    $price  = compute_price($db, $goodType);
    $gross  = $price * $quantity;
    $net    = round($gross * $exportMult * (1 - $taxRate), 2);

    $db->beginTransaction();
    try {
        // Deduct goods from colony
        $db->prepare(<<<SQL
            UPDATE economy_processed_goods
            SET quantity = GREATEST(0, quantity - ?), updated_at = CURRENT_TIMESTAMP
            WHERE colony_id = ? AND good_type = ?
        SQL)->execute([$quantity, $colonyId, $goodType]);

        // Add credits to player
        $db->prepare('UPDATE users SET credits = credits + ? WHERE id = ?')
           ->execute([$net, $uid]);

        // Update market supply
        update_supply_demand($db, $goodType, $quantity * 0.1, 0);

        // Log transaction
        $db->prepare(<<<SQL
            INSERT INTO economy_market_transactions
                (user_id, colony_id, good_type, direction, quantity, price_per_unit, total_credits, trade_tax_rate, net_credits)
            VALUES (?, ?, ?, 'sell', ?, ?, ?, ?, ?)
        SQL)->execute([$uid, $colonyId, $goodType, $quantity, $price, $net, $taxRate, $net]);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        json_error('Transaction failed: ' . $e->getMessage(), 500);
    }

    json_ok([
        'colony_id'     => $colonyId,
        'good_type'     => $goodType,
        'quantity'      => $quantity,
        'price_per_unit'=> $price,
        'trade_tax'     => $taxRate,
        'net_credits'   => $net,
    ]);
}

/**
 * GET market.php?action=get_history[&limit=N][&good_type=X]
 *
 * Returns recent trade transactions for the current player.
 * Default limit: 50. Maximum: 200.
 */
function action_get_history(PDO $db, int $uid): never {
    $limit    = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $goodType = $_GET['good_type'] ?? null;

    $params = [$uid];
    $where  = 'WHERE user_id = ?';
    if ($goodType) {
        $where   .= ' AND good_type = ?';
        $params[] = $goodType;
    }

    $stmt = $db->prepare(<<<SQL
        SELECT id, colony_id, good_type, direction, quantity, price_per_unit,
               total_credits, trade_tax_rate, net_credits, transacted_at
        FROM economy_market_transactions
        {$where}
        ORDER BY transacted_at DESC
        LIMIT {$limit}
    SQL);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $transactions = array_map(fn($r) => [
        'id'             => (int)$r['id'],
        'colony_id'      => (int)$r['colony_id'],
        'good_type'      => $r['good_type'],
        'direction'      => $r['direction'],
        'quantity'       => (float)$r['quantity'],
        'price_per_unit' => (float)$r['price_per_unit'],
        'total_credits'  => (float)$r['total_credits'],
        'trade_tax_rate' => (float)$r['trade_tax_rate'],
        'net_credits'    => (float)$r['net_credits'],
        'transacted_at'  => $r['transacted_at'],
    ], $rows);

    json_ok(['transactions' => $transactions]);
}

/**
 * GET market.php?action=get_active_events
 *
 * Returns all currently active galactic market events.
 */
function action_get_active_events(PDO $db): never {
    $stmt = $db->prepare(<<<SQL
        SELECT id, event_code, label, affected_good, price_mult, demand_mult,
               remaining_ticks, started_at
        FROM economy_market_events
        WHERE remaining_ticks > 0
        ORDER BY started_at DESC
    SQL);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $events = array_map(fn($r) => [
        'id'            => (int)$r['id'],
        'code'          => $r['event_code'],
        'label'         => $r['label'],
        'affected_good' => $r['affected_good'],
        'price_mult'    => (float)$r['price_mult'],
        'demand_mult'   => (float)$r['demand_mult'],
        'remaining_ticks' => (int)$r['remaining_ticks'],
        'started_at'    => $r['started_at'],
    ], $rows);

    json_ok(['events' => $events]);
}
