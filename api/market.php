<?php

// api/market.php — Galactic Market: indicative prices, orders, history, events
//
// Actions:
//   get_prices       — current market prices for all goods (or one good)
//   buy/sell         — retired; use funded standing orders
//   get_history      — recent trade transactions for the current player
//   get_active_events — list active market events

use GalaxyQuest\Economy\OnDemandEconomy;
use GalaxyQuest\Economy\WorldEvents;
use GalaxyQuest\Economy\StandingOrders;
use GalaxyQuest\Economy\EconomicRequests;

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/../src/Economy/OnDemandEconomy.php';
require_once __DIR__ . '/../src/Economy/StandingOrders.php';
require_once __DIR__ . '/../src/Economy/EconomicRequests.php';

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

header('Content-Type: application/json; charset=utf-8');

$uid    = require_auth();
$db     = get_db();
$action = $_GET['action'] ?? '';

match ($action) {
    'get_prices'        => action_get_prices($db, $uid),
    'get_region_prices' => action_get_region_prices($db, $uid),
    'buy', 'sell'       => action_retired_trade(),
    'get_history'       => action_get_history($db, $uid),
    'get_active_events' => action_get_active_events($db, $uid),
    'list_orders'      => action_list_orders($db, $uid),
    'create_order'     => action_create_order($db, $uid),
    'cancel_order'     => action_cancel_order($db, $uid),
    'accept_request'   => action_economic_request($db, $uid, 'accept'),
    'decline_request'  => action_economic_request($db, $uid, 'decline'),
    default             => json_error('Unknown action: ' . $action, 400),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetch_colony_market_scope(PDO $db, int $colonyId): ?array
{
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

function fetch_market_snapshot(PDO $db, string $goodType, ?int $colonyId = null): array
{
    // One market projection per scope and request; it is read-only.
    static $markets = [];
    $key = $colonyId ?? 0;
    if (!isset($markets[$key])) {
        $scope = $colonyId === null ? null : fetch_colony_market_scope($db, $colonyId);
        $markets[$key] = (new OnDemandEconomy($db))->market($scope['galaxy'] ?? null, $scope['system'] ?? null);
    }
    $market = $markets[$key];
    $good = $market['goods'][$goodType] ?? [];
    $modifiers = WorldEvents::priceModifiers($market['world_events'] ?? [], $goodType);
    return [
        'supply' => ($good['quantity'] ?? 0) / 24 + ($good['production_per_hour'] ?? 0),
        'demand' => $good['consumption_per_hour'] ?? 0,
        'price_modifier' => (float)($good['event_price_modifier'] ?? $modifiers['price']),
        'demand_modifier' => (float)($good['event_demand_modifier'] ?? $modifiers['demand']),
        'world_events' => $market['world_events'] ?? [],
    ];
}

/**
 * Compute current market price from the on-demand colony market snapshot.
 * With colony_id the local system price is used; otherwise the aggregated
 * galaxy-wide price is returned. Active world events apply as modifiers.
 */
function compute_price(PDO $db, string $goodType, ?int $colonyId = null): float
{
    $snapshot = fetch_market_snapshot($db, $goodType, $colonyId);
    $supply   = max(1.0, (float)$snapshot['supply']);
    $demand   = max(1.0, (float)$snapshot['demand']) * $snapshot['demand_modifier'];
    $mult     = pow($demand / $supply, PRICE_ELASTICITY) * $snapshot['price_modifier'];
    $mult     = max(PRICE_MULT_MIN, min(PRICE_MULT_MAX, $mult));
    return round((BASE_PRICES[$goodType] ?? 10) * $mult, 2);
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
function action_get_prices(PDO $db, int $uid): never
{
    only_method('GET');
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
    $worldEvents = [];
    foreach ($goods as $good) {
        $row = fetch_market_snapshot($db, $good, $colonyId);
        $worldEvents = $row['world_events'];
        $prices[$good] = [
            'good_type'  => $good,
            'base_price' => BASE_PRICES[$good] ?? 0,
            'price'      => compute_price($db, $good, $colonyId),
            'supply'     => (float)$row['supply'],
            'demand'     => (float)$row['demand'],
        ];
    }

    json_ok([
        'prices' => $filter ? ($prices[$filter] ?? []) : array_values($prices),
        'world_events' => $worldEvents,
    ]);
}

// ---------------------------------------------------------------------------
// Regional market constants
// ---------------------------------------------------------------------------

/**
 * Pre-defined market regions.
 *
 * Each region has:
 *   - transport_cost_mult: surcharge applied on top of the global price formula
 *   - supply_bias: per-good initial supply multiplier seeded into market_region_quotes
 *
 * Core Worlds  — manufacturing hub; raw-material importer.
 * Frontier Sectors — resource-rich frontier; finished-goods importer (+20% surcharge).
 */
const MARKET_REGIONS = [
    'core_worlds' => [
        'label'              => 'Kernwelten',
        'transport_cost_mult' => 1.0,
        'supply_bias'        => [
            'metal' => 0.7, 'crystal' => 0.8, 'deuterium' => 0.8, 'rare_earth' => 0.6, 'food' => 0.9,
            'steel_alloy' => 1.3, 'focus_crystals' => 1.2, 'reactor_fuel' => 1.1,
            'consumer_goods' => 1.4, 'luxury_goods' => 1.3, 'research_kits' => 1.2,
        ],
    ],
    'frontier_sectors' => [
        'label'              => 'Grenzgebiete',
        'transport_cost_mult' => 1.20,
        'supply_bias'        => [
            'metal' => 1.4, 'crystal' => 1.3, 'deuterium' => 1.2, 'rare_earth' => 1.5, 'food' => 0.7,
            'steel_alloy' => 0.7, 'focus_crystals' => 0.6, 'reactor_fuel' => 0.8,
            'consumer_goods' => 0.5, 'luxury_goods' => 0.4, 'research_kits' => 0.6,
        ],
    ],
];

/**
 * Compute the current regional market price for a good.
 *
 * Regional price = global_price × transport_cost_mult × supply_bias_adj
 *
 * The supply_bias_adj is derived from the regional supply/demand row in
 * market_region_quotes (if present) or estimated from supply_bias defaults.
 *
 * @param PDO    $db
 * @param string $goodType
 * @param string $regionId   'core_worlds' | 'frontier_sectors'
 * @return float
 */
function compute_regional_price(PDO $db, string $goodType, string $regionId): float
{
    $region = MARKET_REGIONS[$regionId] ?? null;
    if (!$region) {
        return compute_price($db, $goodType);
    }

    $tcm = (float)$region['transport_cost_mult'];

    // Try market_region_quotes for live supply/demand
    $stmt = $db->prepare(<<<SQL
        SELECT supply, demand, active_events_mult
        FROM market_region_quotes
        WHERE region_id = ? AND good_type = ?
    SQL);
    $stmt->execute([$regionId, $goodType]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        $supply = max(1.0, (float)$row['supply']);
        $demand = max(1.0, (float)$row['demand']);
        $mult   = pow($demand / $supply, PRICE_ELASTICITY);
        $mult   = max(PRICE_MULT_MIN, min(PRICE_MULT_MAX * $tcm, $mult));
        $evMult = (float)($row['active_events_mult'] ?? 1.0);
        $base   = BASE_PRICES[$goodType] ?? 10.0;
        return round($base * $tcm * $mult * $evMult, 2);
    }

    // Fallback: scale global price by transport cost and supply_bias estimate
    $globalPrice = compute_price($db, $goodType);
    $bias        = (float)($region['supply_bias'][$goodType] ?? 1.0);
    // bias > 1 → surplus → lower price; bias < 1 → scarcity → higher price
    $biasAdj     = 1.0 / max(0.1, $bias);
    return round($globalPrice * $tcm * $biasAdj, 2);
}

/**
 * GET market.php?action=get_region_prices[&good_type=X]
 *
 * Returns current market prices per region (core_worlds, frontier_sectors)
 * for all goods, or for a single good if good_type is specified.
 *
 * Response shape:
 * {
 *   "regions": {
 *     "core_worlds": {
 *       "label": "Kernwelten",
 *       "transport_cost_mult": 1.0,
 *       "prices": [ { good_type, base_price, price, supply, demand } ]
 *     },
 *     "frontier_sectors": { … }
 *   }
 * }
 */
function action_get_region_prices(PDO $db, int $uid): never
{
    only_method('GET');
    $filter = $_GET['good_type'] ?? null;
    $goods  = $filter ? [$filter] : array_keys(BASE_PRICES);

    if ($filter && !isset(BASE_PRICES[$filter])) {
        json_error('Unknown good_type: ' . $filter, 400);
    }

    $result = [];
    foreach (MARKET_REGIONS as $regionId => $regionDef) {
        $prices = [];
        foreach ($goods as $good) {
            $regionalPrice = compute_regional_price($db, $good, $regionId);
            $prices[] = [
                'good_type'  => $good,
                'base_price' => BASE_PRICES[$good] ?? 0,
                'price'      => $regionalPrice,
            ];
        }
        $result[$regionId] = [
            'label'              => $regionDef['label'],
            'transport_cost_mult' => $regionDef['transport_cost_mult'],
            'prices'             => $filter ? ($prices[0] ?? []) : $prices,
        ];
    }

    json_ok(['regions' => $result]);
}

function action_retired_trade(): never
{
    only_method('POST');
    verify_csrf();
    json_error('Soforthandel wurde eingestellt. Bitte einen Auftrag mit create_order erstellen; Lieferung erfolgt per Transportschiff.', 409);
}

function invalidate_market_trade_cache(int $uid, int $colonyId): void
{
    gq_cache_delete('game_overview', ['uid' => $uid]);
    gq_cache_delete('game_resources', ['uid' => $uid, 'cid' => $colonyId]);
}

function action_list_orders(PDO $db, int $uid): never
{
    only_method('GET');
    try {
        $cid = standing_order_id($_GET['colony_id'] ?? null);
        $now = time();
        json_ok(['orders' => (new StandingOrders($db))->list($uid, $cid),
            'requests' => (new EconomicRequests($db))->list($uid, $cid, $now), 'now_unix' => $now]);
    } catch (DomainException $error) {
        json_error($error->getMessage(), $error->getCode() ?: 400);
    }
}

function action_economic_request(PDO $db, int $uid, string $action): never
{
    only_method('POST');
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    require_once __DIR__ . '/game_engine.php';
    try {
        $request = (new EconomicRequests($db))->respond($uid, standing_order_id($body['request_id'] ?? null), $action, time());
    } catch (DomainException $error) {
        json_error($error->getMessage(), $error->getCode() ?: 400);
    }
    if ($action === 'accept' && $request['status'] !== 'accepted') {
        json_error(match ($request['status']) {
            'expired' => 'Anfrage ist abgelaufen; es wurde nichts reserviert.',
            'declined' => 'Anfrage wurde bereits abgelehnt.',
            default => 'NPC-Auftrag ist nicht mehr verfügbar; es wurde nichts reserviert.',
        }, 409);
    }
    invalidate_market_trade_cache($uid, (int)$request['colony_id']);
    json_ok(['request' => $request]);
}

function action_create_order(PDO $db, int $uid): never
{
    only_method('POST');
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    require_once __DIR__ . '/game_engine.php';
    try {
        $order = (new StandingOrders($db))->create(
            $uid, standing_order_id($body['colony_id'] ?? null),
            is_string($body['side'] ?? null) ? $body['side'] : '',
            is_string($body['good_type'] ?? null) ? $body['good_type'] : '',
            $body['quantity'] ?? null, $body['limit_price'] ?? null
        );
    } catch (DomainException $error) {
        json_error($error->getMessage(), $error->getCode() ?: 400);
    }
    invalidate_market_trade_cache($uid, (int)$order['colony_id']);
    json_ok(['order' => $order]);
}

function action_cancel_order(PDO $db, int $uid): never
{
    only_method('POST');
    verify_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    require_once __DIR__ . '/game_engine.php';
    try {
        $order = (new StandingOrders($db))->cancel($uid, standing_order_id($body['order_id'] ?? null));
    } catch (DomainException $error) {
        json_error($error->getMessage(), $error->getCode() ?: 400);
    }
    invalidate_market_trade_cache($uid, (int)$order['colony_id']);
    json_ok(['order' => $order]);
}

function standing_order_id(mixed $value): int
{
    if ((!is_int($value) && !is_string($value)) || !preg_match('/^[1-9]\d{0,9}$/D', (string)$value)
        || (int)$value > 2147483647) {
        throw new DomainException('Ungültige Kolonie-/Auftrags-ID.', 400);
    }
    return (int)$value;
}

/**
 * GET market.php?action=get_history[&limit=N][&good_type=X]
 *
 * Returns recent trade transactions for the current player.
 * Default limit: 50. Maximum: 200.
 */
function action_get_history(PDO $db, int $uid): never
{
    only_method('GET');
    $limit    = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    $goodType = $_GET['good_type'] ?? null;

    $params = [$uid];
    $where  = 'WHERE user_id = ?';
    if ($goodType) {
        $where   .= ' AND good_type = ?';
        $params[] = $goodType;
    }

    $params[] = $limit;
    $stmt = $db->prepare(<<<SQL
        SELECT id, colony_id, good_type, direction, quantity, price_per_unit,
               total_credits, trade_tax_rate, net_credits, transacted_at
        FROM economy_market_transactions
        {$where}
        ORDER BY transacted_at DESC
        LIMIT ?
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
 * GET market.php?action=get_active_events[&colony_id=N]
 *
 * Returns world events active now. With colony_id: events affecting the
 * colony's system and galaxy; otherwise all active events.
 */
function action_get_active_events(PDO $db, int $uid): never
{
    only_method('GET');
    $now = time();
    $colonyId = isset($_GET['colony_id']) ? (int)$_GET['colony_id'] : null;
    if ($colonyId !== null) {
        $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
        $stmt->execute([$colonyId, $uid]);
        if (!$stmt->fetch()) {
            json_error('Colony not found or access denied', 403);
        }
        $scope = fetch_colony_market_scope($db, $colonyId);
        $events = (new WorldEvents($db))->forScope($scope['galaxy'] ?? null, $scope['system'] ?? null, $now, $now);
    } else {
        try {
            $stmt = $db->prepare('SELECT * FROM world_events WHERE ends_at > ? AND starts_at <= ? ORDER BY id');
            $stmt->execute([$now, $now]);
            $events = array_map(static function (array $row): array {
                $row['modifiers'] = json_decode((string)$row['modifier_json'], true) ?: [];
                return $row;
            }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        } catch (PDOException $error) {
            if (!WorldEvents::missingTable($error)) {
                throw $error;
            }
            $events = [];
        }
    }

    json_ok(['events' => array_map([WorldEvents::class, 'describe'], $events)]);
}
