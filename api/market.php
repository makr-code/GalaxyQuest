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
require_once __DIR__ . '/economy_flush.php';

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

function fetch_colony_market_scope(PDO $db, int $colonyId): ?array {
    $stmt = $db->prepare(<<<SQL
        SELECT cb.galaxy_index, cb.system_index
        FROM colonies c
        JOIN celestial_bodies cb ON cb.id = c.body_id
        WHERE c.id = ?
        LIMIT 1
    SQL);
    $stmt->execute([$colonyId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }

    return [
        'galaxy' => (int)$row['galaxy_index'],
        'system' => (int)$row['system_index'],
    ];
}

function fetch_market_snapshot(PDO $db, string $goodType, ?int $colonyId = null): array {
    if ($colonyId !== null) {
        $scope = fetch_colony_market_scope($db, $colonyId);
        if ($scope !== null) {
            $stmt = $db->prepare(<<<SQL
                SELECT available_supply, desired_demand
                FROM market_supply_demand
                WHERE galaxy_index = ? AND system_index = ? AND resource_type = ?
                LIMIT 1
            SQL);
            $stmt->execute([$scope['galaxy'], $scope['system'], $goodType]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                return [
                    'supply' => (float)$row['available_supply'],
                    'demand' => (float)$row['desired_demand'],
                ];
            }
        }
    }

    $stmt = $db->prepare(<<<SQL
        SELECT COALESCE(SUM(available_supply), 100.0) AS supply,
               COALESCE(SUM(desired_demand), 100.0) AS demand
        FROM market_supply_demand
        WHERE resource_type = ?
    SQL);
    $stmt->execute([$goodType]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: ['supply' => 100.0, 'demand' => 100.0];

    return [
        'supply' => (float)$row['supply'],
        'demand' => (float)$row['demand'],
    ];
}

/**
 * Compute current market price from market_supply_demand.
 * With colony_id the local system price is used; otherwise the aggregated
 * galaxy-wide price is returned.
 */
function compute_price(PDO $db, string $goodType, ?int $colonyId = null): float {
    $snapshot = fetch_market_snapshot($db, $goodType, $colonyId);
    $supply   = max(1.0, (float)$snapshot['supply']);
    $demand   = max(1.0, (float)$snapshot['demand']);
    $mult     = pow($demand / $supply, PRICE_ELASTICITY);
    $mult     = max(PRICE_MULT_MIN, min(PRICE_MULT_MAX, $mult));

    $evStmt = $db->prepare(<<<SQL
        SELECT price_mult FROM economy_market_events
        WHERE remaining_ticks > 0 AND (affected_good IS NULL OR affected_good = ?)
    SQL);
    $evStmt->execute([$goodType]);
    foreach ($evStmt->fetchAll(PDO::FETCH_COLUMN) as $evMult) {
        $mult *= (float)$evMult;
    }

    $base = BASE_PRICES[$goodType] ?? 10.0;
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
 * Update local system supply/demand for a colony.
 */
function update_supply_demand(PDO $db, int $colonyId, string $goodType, float $supplyDelta, float $demandDelta): void {
    $scope = fetch_colony_market_scope($db, $colonyId);
    if ($scope === null) {
        return;
    }

    $db->prepare(<<<SQL
        INSERT INTO market_supply_demand
            (galaxy_index, system_index, resource_type,
             production_per_hour, consumption_per_hour,
             available_supply, desired_demand, net_balance)
        VALUES (?, ?, ?, 0, 0,
                GREATEST(0, 100 + ?),
                GREATEST(0, 100 + ?),
                (GREATEST(0, 100 + ?) - GREATEST(0, 100 + ?)))
        ON DUPLICATE KEY UPDATE
            available_supply = GREATEST(0, available_supply + ?),
            desired_demand   = GREATEST(0, desired_demand + ?),
            net_balance      = (GREATEST(0, available_supply + ?) - GREATEST(0, desired_demand + ?)),
            updated_at       = CURRENT_TIMESTAMP
    SQL)->execute([
        $scope['galaxy'],
        $scope['system'],
        $goodType,
        $supplyDelta,
        $demandDelta,
        $supplyDelta,
        $demandDelta,
        $supplyDelta,
        $demandDelta,
        $supplyDelta,
        $demandDelta,
    ]);
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
    $filter   = $_GET['good_type'] ?? null;
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;
    $goods    = $filter ? [$filter] : array_keys(BASE_PRICES);

    if ($colonyId !== null) {
        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) {
            json_error('Colony not found or access denied', 403);
        }
    }

    $prices = [];
    foreach ($goods as $good) {
        $row = fetch_market_snapshot($db, $good, $colonyId);
        $prices[$good] = [
            'good_type'  => $good,
            'base_price' => BASE_PRICES[$good] ?? 0,
            'price'      => compute_price($db, $good, $colonyId),
            'supply'     => (float)$row['supply'],
            'demand'     => (float)$row['demand'],
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
    $price    = compute_price($db, $goodType, $colonyId);
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
        update_supply_demand($db, $colonyId, $goodType, 0, $quantity * 0.1);

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

    flush_colony_production($db, $colonyId);

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

    $price  = compute_price($db, $goodType, $colonyId);
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
        update_supply_demand($db, $colonyId, $goodType, $quantity * 0.1, 0);

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
