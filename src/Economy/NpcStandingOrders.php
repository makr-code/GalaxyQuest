<?php

declare(strict_types=1);

namespace GalaxyQuest\Economy;

use DomainException;
use GalaxyQuest\Simulation\HourlyWindow;
use PDO;
use PDOException;
use RuntimeException;

require_once __DIR__ . '/StandingOrders.php';
require_once __DIR__ . '/../Simulation/DeterministicRandom.php';
require_once __DIR__ . '/../Simulation/HourlyWindow.php';

/** One explicitly bound colony per actor, using the ordinary finite contract ledger. */
final class NpcStandingOrders
{
    public const MAX_OPERATIONS = 4;
    public const MAX_WINDOW_BUDGET_CENTS = 10000000;
    private const RESERVE_HOURS = [
        'subsistence' => 10, 'agriculture' => 8, 'industry' => 8, 'trade' => 8,
    ];

    public function __construct(private PDO $db)
    {
    }

    public static function available(PDO $db): bool
    {
        try {
            $db->query('SELECT user_id FROM economy_npc_profiles LIMIT 1');
            return true;
        } catch (PDOException $error) {
            if ($error->getCode() === '42S02'
                || ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite'
                    && str_contains($error->getMessage(), 'no such table: economy_npc_profiles'))) {
                return false;
            }
            throw $error;
        }
    }

    public function isBound(int $uid): bool
    {
        return $this->row('SELECT user_id FROM economy_npc_profiles WHERE user_id=?', [$uid]) !== null;
    }

    /** Offline operator binding: never creates an actor, world, stock or credit. */
    public function bind(int $uid, int $cid, string $profile, int $budget, bool $dryRun = true): array
    {
        if (!isset(self::RESERVE_HOURS[$profile]) || $budget < 1 || $budget > self::MAX_WINDOW_BUDGET_CENTS) {
            throw new DomainException('Invalid economic profile or hourly budget.');
        }
        return $this->operation(function () use ($uid, $cid, $profile, $budget, $dryRun): array {
            $actor = $this->actor($uid);
            if (!$actor) {
                throw new DomainException('Only active, non-authenticating npc_engine actors may opt in.');
            }
            $colony = $this->row('SELECT id FROM colonies WHERE id=? AND user_id=?' . $this->lock(), [$cid, $uid]);
            if (!$colony) {
                throw new DomainException('Explicit colony is not owned by this NPC.');
            }
            if ($this->isBound($uid)) {
                throw new DomainException('Actor already bound; profiles are not overwritten.');
            }
            if (StandingOrders::capitalCents($actor['credits']) < $budget) {
                throw new DomainException('Hourly cap must be backed by existing account credits at binding.');
            }
            if (!$dryRun) {
                $this->db->prepare(
                    'INSERT INTO economy_npc_profiles (user_id,colony_id,profile,window_budget_cents) VALUES (?,?,?,?)'
                )->execute([$uid, $cid, $profile, $budget]);
            }
            return ['actor' => $uid, 'colony' => $cid, 'profile' => $profile,
                'window_budget_cents' => $budget, 'available_credits' => $actor['credits'], 'status' => 'bound'];
        }, $dryRun);
    }

    public function diagnostics(int $uid): array
    {
        $row = $this->row('SELECT * FROM economy_npc_profiles WHERE user_id=?', [$uid]);
        return $row ? ['binding' => $row, 'summary' => $row['summary_json'] === null ? null
            : json_decode($row['summary_json'], true, 512, JSON_THROW_ON_ERROR)] : ['status' => 'unbound'];
    }

    /** The saved window and all reservations commit together; force is deliberately absent. */
    public function decide(int $uid, ?int $now = null, bool $dryRun = false): array
    {
        if ($dryRun) {
            return $this->preview($uid, $now ?? time());
        }
        return $this->operation(function () use ($uid, $now): array {
            $actor = $this->actor($uid);
            $now ??= time();
            $window = HourlyWindow::id($now);
            if (!$actor) {
                return ['actor' => $uid, 'window' => $window, 'status' => 'excluded'];
            }
            $profile = $this->row('SELECT * FROM economy_npc_profiles WHERE user_id=?' . $this->lock(), [$uid]);
            if (!$profile) {
                return ['actor' => $uid, 'window' => $window, 'status' => 'unbound'];
            }
            if ($profile['last_window'] !== null && (int)$profile['last_window'] >= $window) {
                return ['status' => 'already_decided', 'summary' => json_decode(
                    $profile['summary_json'], true, 512, JSON_THROW_ON_ERROR
                )];
            }
            $cid = (int)$profile['colony_id'];
            $summary = ['actor' => $uid, 'colony' => $cid, 'window' => $window,
                'profile' => $profile['profile'], 'status' => 'decided', 'needs' => [],
                'available_credits' => $actor['credits'], 'created' => [], 'maintained' => [],
                'cancelled' => [], 'deferred' => [], 'errors' => []];
            if (!$this->row('SELECT id FROM colonies WHERE id=? AND user_id=?' . $this->lock(), [$cid, $uid])) {
                $summary['status'] = 'excluded';
                $summary['errors'][] = 'Bound colony ownership changed; operator intervention required.';
                return $this->save($uid, $window, $summary);
            }
            $economy = new OnDemandEconomy($this->db);
            $snapshot = $economy->settle($cid, $uid, $now, true);
            if ((int)$snapshot['economy']['pending_seconds'] > 0) {
                $summary['status'] = 'deferred';
                $summary['deferred'][] = 'catchup:' . $snapshot['economy']['pending_seconds'];
                $summary['production'] = ['method' => ['status' => 'deferred', 'reason' => 'stale_catchup'],
                    'construction' => ['status' => 'deferred', 'reason' => 'stale_catchup'], 'window' => $window];
                return $this->save($uid, $window, $summary);
            }
            $orders = new StandingOrders($this->db);
            $policy = $this->row('SELECT global_policy FROM economy_policies WHERE user_id=?' . $this->lock(), [$uid]);
            $importsAllowed = !in_array((string)($policy['global_policy'] ?? ''), ['autarky', '3'], true);
            $open = $this->openOrders($uid, $cid);
            $summary['reservations'] = $open;
            if (count($open) > 128) {
                $summary['status'] = 'deferred';
                $summary['deferred'][] = 'Too many active contracts; operator intervention required.';
                return $this->save($uid, $window, $summary);
            }
            $operations = 0;
            foreach ($open as $order) {
                $good = $order['good_type'];
                $reserve = (int)ceil(max(0, $snapshot['reserve_rates'][$good] ?? 0)
                    * self::RESERVE_HOURS[$profile['profile']]);
                $available = max(0, (int)floor($snapshot['economy']['stock'][$good] ?? 0));
                $unsuitable = $order['side'] === 'buy' ? (!$importsAllowed || $available >= $reserve)
                    : $available < $reserve;
                if ($order['expires_window'] !== null
                    && ((int)$order['expires_window'] <= $window || $unsuitable)
                    && (int)$order['quantity_remaining'] > 0 && $operations < self::MAX_OPERATIONS) {
                    $orders->cancel($uid, (int)$order['id'], $now);
                    $summary['cancelled'][] = (int)$order['id'];
                    $operations++;
                } else {
                    $summary['maintained'][] = (int)$order['id'];
                }
            }
            // Cancellation returned only residual stock/escrow, never allocated route cargo.
            $snapshot = $economy->settle($cid, $uid, $now, true);
            $open = $this->openOrders($uid, $cid);
            $incoming = [];
            $sides = [];
            foreach ($open as $order) {
                $sides[$order['good_type']][$order['side']] = true;
                if ($order['side'] === 'buy') {
                    $incoming[$order['good_type']] = ($incoming[$order['good_type']] ?? 0)
                        + (int)$order['quantity_remaining'];
                }
            }
            foreach ($this->rows(
                "SELECT resource_type,quantity_acquired FROM trader_routes WHERE target_colony_id=? "
                . "AND funding_status='backed' AND quantity_acquired>0 AND status IN ('acquiring','in_transit')"
                . $this->lock(), [$cid]
            ) as $route) {
                $incoming[$route['resource_type']] = ($incoming[$route['resource_type']] ?? 0)
                    + (int)$route['quantity_acquired'];
                $sides[$route['resource_type']]['buy'] = true;
            }
            $actor = $this->actor($uid);
            $summary['available_credits'] = $actor['credits'];
            $budget = min((int)$profile['window_budget_cents'], StandingOrders::capitalCents($actor['credits']));
            $quotes = $economy->market((int)$snapshot['market_scope']['galaxy'], null, $now, false)['goods'] ?? [];
            $summary['production'] = $this->production(
                $economy, $economy->inspect($cid, $uid, $now), $profile, $budget, $quotes, $now, false
            );
            $snapshot = $economy->inspect($cid, $uid, $now);
            $rates = $snapshot['reserve_rates'];
            $stock = $snapshot['economy']['stock'];
            $hours = self::RESERVE_HOURS[$profile['profile']];
            $populationGoods = [];
            foreach (ColonyEconomySimulation::NEEDS as $class => $needs) {
                if (($snapshot['pop_classes'][$class] ?? 0) > 0) {
                    $populationGoods += $needs;
                }
            }
            $candidates = [];
            $random = HourlyWindow::random($window, 'npc_economy', $uid, 'order_priority');
            foreach (ColonyEconomySimulation::PRICES as $good => $_price) {
                $reserve = (int)ceil(max(0, $rates[$good] ?? 0) * $hours);
                $available = max(0, (int)floor($stock[$good] ?? 0));
                $deficit = max(0, $reserve - $available - ($incoming[$good] ?? 0));
                $surplus = max(0, $available - $reserve);
                $summary['needs'][$good] = ['reserve' => $reserve, 'stock' => $available,
                    'incoming' => $incoming[$good] ?? 0, 'deficit' => $deficit, 'surplus' => $surplus];
                $side = $deficit > 0 ? 'buy' : 'sell';
                $qty = $deficit > 0 ? $deficit : $surplus;
                if ($qty < 1 || isset($sides[$good]) || !isset($quotes[$good])) {
                    if ($deficit > 0 && isset($sides[$good])) {
                        $summary['deferred'][] = $good . ':existing_reservation';
                    }
                    continue;
                }
                if ($side === 'buy' && !$importsAllowed) {
                    $summary['deferred'][] = $good . ':autarky';
                    continue;
                }
                // Food first, then manufacturing/population demand, then measured surplus.
                $priority = 3;
                if ($side === 'buy') {
                    $populationNeed = isset($populationGoods[$good]);
                    $priority = $good === 'food' ? 0 : match ($profile['profile']) {
                        'industry' => $populationNeed ? 2 : 1,
                        'subsistence', 'agriculture' => $populationNeed ? 1 : 2,
                        default => 1,
                    };
                }
                $candidates[] = [$priority, $random->float(), $good, $side, $qty];
            }
            usort($candidates, static fn(array $a, array $b): int => [$a[0], $a[1], $a[2]] <=> [$b[0], $b[1], $b[2]]);
            foreach ($candidates as [, , $good, $side, $qty]) {
                if ($operations >= self::MAX_OPERATIONS) {
                    $summary['deferred'][] = $good . ':operation_cap';
                    continue;
                }
                $quote = StandingOrders::priceCents(number_format((float)$quotes[$good]['price'], 2, '.', ''));
                $cents = $side === 'buy' ? min(StandingOrders::MAX_PRICE_CENTS, intdiv($quote * 110 + 99, 100))
                    : max(1, intdiv($quote * 90, 100));
                $qty = min($qty, StandingOrders::MAX_QUANTITY, intdiv(StandingOrders::MAX_BUDGET_CENTS, $cents));
                if ($side === 'buy') {
                    $qty = min($qty, intdiv($budget, $cents));
                }
                if ($qty < 1) {
                    $summary['deferred'][] = $good . ':unfunded';
                    continue;
                }
                $order = $orders->create($uid, $cid, $side, $good, $qty, StandingOrders::money($cents), $now);
                $this->db->prepare(
                    'INSERT INTO economy_npc_orders (order_id,user_id,created_window,expires_window) VALUES (?,?,?,?)'
                )->execute([$order['id'], $uid, $window, $window + 24]);
                $summary['created'][] = $order;
                $operations++;
                if ($side === 'buy') {
                    $budget -= $qty * $cents;
                }
            }
            $summary['available_credits_after'] = $this->actor($uid)['credits'];
            $summary['window_budget_remaining_cents'] = $budget;
            return $this->save($uid, $window, $summary);
        }, $dryRun);
    }

    private function preview(int $uid, int $now): array
    {
        $actor = $this->row('SELECT * FROM users WHERE id=?', [$uid]);
        $profile = $this->row('SELECT * FROM economy_npc_profiles WHERE user_id=?', [$uid]);
        $window = HourlyWindow::id($now);
        if (!$actor || $actor['control_type'] !== 'npc_engine' || (int)$actor['auth_enabled'] !== 0
            || $actor['deleted_at'] !== null) {
            return ['actor' => $uid, 'window' => $window, 'status' => 'excluded', 'dry_run' => true];
        }
        if (!$profile) {
            return ['actor' => $uid, 'window' => $window, 'status' => 'unbound', 'dry_run' => true];
        }
        if ($profile['last_window'] !== null && (int)$profile['last_window'] >= $window) {
            return ['status' => 'already_decided', 'summary' => json_decode(
                $profile['summary_json'], true, 512, JSON_THROW_ON_ERROR
            ), 'dry_run' => true];
        }
        $economy = new OnDemandEconomy($this->db);
        $summary = ['actor' => $uid, 'colony' => (int)$profile['colony_id'], 'window' => $window,
            'profile' => $profile['profile'], 'status' => 'preview', 'dry_run' => true,
            'available_credits' => $actor['credits'], 'reservations' => $this->openOrders(
                $uid, (int)$profile['colony_id']
            )];
        try {
            $snapshot = $economy->inspect((int)$profile['colony_id'], $uid, $now);
        } catch (DomainException $error) {
            return $summary + ['deferred' => [$error->getMessage()]];
        }
        if ((int)$snapshot['economy']['pending_seconds'] > 0) {
            return $summary + ['deferred' => ['catchup:' . $snapshot['economy']['pending_seconds']],
                'economy_cursor' => $snapshot['economy']['settled_at'],
                'production' => ['method' => ['status' => 'deferred', 'reason' => 'stale_catchup'],
                    'construction' => ['status' => 'deferred', 'reason' => 'stale_catchup'], 'window' => $window]];
        }
        $quotes = $economy->market((int)$snapshot['market_scope']['galaxy'], null, $now, false)['goods'] ?? [];
        $budget = min((int)$profile['window_budget_cents'], StandingOrders::capitalCents($actor['credits']));
        $summary['production'] = $this->production($economy, $snapshot, $profile, $budget, $quotes, $now, true);
        $summary['needs'] = $snapshot['reserve_rates'];
        return $summary;
    }

    /** One method and one construction maximum, sharing the standing-order window and cap. */
    private function production(
        OnDemandEconomy $economy, array $snapshot, array $profile, int &$budget, array $quotes, int $now, bool $preview
    ): array {
        $uid = (int)$profile['user_id'];
        $cid = (int)$profile['colony_id'];
        $hours = self::RESERVE_HOURS[$profile['profile']];
        $targets = [];
        foreach ($snapshot['reserve_rates'] as $good => $rate) {
            $targets[$good] = max(0, $rate) * $hours;
        }
        $prices = [];
        foreach (ColonyEconomySimulation::PRICES as $good => $price) {
            $prices[$good] = (float)($quotes[$good]['price'] ?? $price);
        }
        $loss = static function (array $forecast) use ($targets, $prices, $profile): float {
            $value = 0.0;
            foreach ($targets as $good => $target) {
                $weight = $good === 'food' ? 100 : ($profile['profile'] === 'industry'
                    && !in_array($good, ColonyEconomySimulation::PRIMARY, true) ? 2 : 1);
                $value += max(0, $target - ($forecast['stock'][$good] ?? 0)) * $prices[$good] * $weight;
            }
            return $value;
        };
        $result = ['method' => ['status' => 'deferred', 'reason' => 'no_improvement'],
            'construction' => ['status' => 'deferred', 'reason' => 'no_improvement'], 'candidates' => [],
            'window' => HourlyWindow::id($now), 'budget_before_cents' => $budget,
            'reserve_targets' => $targets, 'valuation_rates' => $prices,
            'population' => array_sum($snapshot['pop_classes']),
            'energy_available' => $snapshot['production_context']['energy_available'],
            'budget_basis' => 'market-valued resource cost plus actual credit cost; valuation is a policy cap only'];
        $baseline = $economy->productionForecast($snapshot);
        $baseLoss = $loss($baseline);
        $best = null;
        foreach ($snapshot['buildings'] as $building) {
            $type = $building['type'];
            if ($building['level'] < 1 || !isset(ColonyEconomySimulation::RECIPES[$type])) {
                continue;
            }
            $current = $snapshot['methods'][$type];
            foreach (['standard', 'efficient', 'premium'] as $method) {
                if ($current === $method) {
                    continue;
                }
                $tech = $method === 'premium' ? 'quantum_computing' : OnDemandEconomy::catalog()[$type]['research'];
                $candidate = ['action' => 'method', 'building' => $type, 'current' => $current,
                    'target' => $method, 'cost' => [], 'research' => $tech, 'status' => 'deferred'];
                if (($snapshot['production_context']['research'][$tech] ?? 0) < 1
                    || ($snapshot['production_context']['research'][OnDemandEconomy::catalog()[$type]['research']] ?? 0) < 1) {
                    $candidate['reason'] = 'research';
                } else {
                    $forecast = $economy->productionForecast($snapshot, $type, $method);
                    $gain = $baseLoss - $loss($forecast);
                    $candidate['benefit'] = $gain;
                    $candidate['need'] = $this->improvedNeeds($baseline, $forecast, $targets);
                    $foodFloor = min($targets['food'] ?? 0, $baseline['stock']['food'] ?? 0);
                    $candidate['reason'] = ($forecast['stock']['food'] ?? 0) + 1e-8 < $foodFloor
                        ? 'food_reserve'
                        : ($gain > max(0.01, $baseLoss * 0.05) ? 'need_reduction' : 'no_improvement');
                    if ($candidate['reason'] === 'need_reduction' && ($best === null || $gain > $best['benefit'])) {
                        $best = $candidate;
                    }
                }
                $result['candidates'][] = $candidate;
            }
        }
        if ($best !== null) {
            if (!$preview) {
                $economy->method($cid, $uid, $best['building'], $best['target'], $now);
                $snapshot = $economy->inspect($cid, $uid, $now);
            } else {
                $snapshot['production_context']['methods'][$best['building']] = $best['target'];
                $snapshot['methods'][$best['building']] = $best['target'];
            }
            $best['status'] = $preview ? 'candidate' : 'executed';
            $result['method'] = $best;
            $baseline = $economy->productionForecast($snapshot);
            $baseLoss = $loss($baseline);
        }
        $pending = $this->rows(
            "SELECT building_type,target_level FROM building_upgrade_queue WHERE colony_id=? "
                . "AND status IN ('queued','running') ORDER BY id", [$cid]
        );
        if ($pending !== []) {
            $result['construction'] = ['status' => 'deferred', 'reason' => 'queue_active', 'pending' => $pending];
            return $result + ['budget_after_cents' => $budget];
        }
        $types = ['hydroponic_farm', 'solar_plant', 'metal_mine', 'crystal_mine',
            'deuterium_synth', 'rare_earth_drill', ...array_keys(ColonyEconomySimulation::RECIPES)];
        $best = null;
        foreach ($types as $type) {
            $level = $snapshot['production_context']['buildings'][$type] ?? 0;
            $candidate = ['action' => 'construction', 'building' => $type, 'current_level' => $level,
                'target_level' => $level + 1, 'status' => 'deferred'];
            if (isset(ColonyEconomySimulation::RECIPES[$type])) {
                $recipe = ColonyEconomySimulation::RECIPES[$type];
                $tech = OnDemandEconomy::catalog()[$type]['research'];
                if (($snapshot['production_context']['research'][$tech] ?? 0) < 1
                    && ($targets[$recipe[0]] ?? 0) > ($baseline['stock'][$recipe[0]] ?? 0)) {
                    $candidate['reason'] = 'research';
                    $candidate['research'] = $tech;
                    $candidate['cost'] = $economy->constructionCost($uid, $type, $level + 1);
                    $result['candidates'][] = $candidate;
                    continue;
                }
            }
            $forecast = $economy->productionForecast($snapshot, $type);
            $gain = $baseLoss - $loss($forecast);
            if ($gain <= max(0.01, $baseLoss * 0.05)) {
                continue;
            }
            $candidate['benefit'] = $gain;
            $candidate['need'] = $this->improvedNeeds($baseline, $forecast, $targets);
            $candidate['reason'] = 'need_reduction';
            $candidate['cost'] = $economy->constructionCost($uid, $type, $level + 1);
            try {
                $slot = $this->constructionSlot($snapshot, $type);
                $plan = $economy->constructionPlan($snapshot, $uid, $type, $slot);
                $candidate['slot'] = $slot;
                $candidate['cost'] = $plan['cost'];
                $candidate['missing_resources'] = $plan['missing_resources'];
                $value = 0;
                foreach ($plan['cost'] as $good => $quantity) {
                    $value += (int)ceil($quantity * $prices[$good] * 100);
                }
                $candidate['policy_cost_cents'] = $value;
                if ($plan['missing_resources'] !== []) {
                    $candidate['reason'] = 'unaffordable';
                } elseif ($value > $budget) {
                    $candidate['reason'] = 'window_budget';
                } elseif ($type !== 'hydroponic_farm' && $type !== 'solar_plant'
                    && ((($snapshot['economy']['stock']['food'] ?? 0) < ($targets['food'] ?? 0)
                        && ($baseline['production']['food'] ?? 0) < ($snapshot['reserve_rates']['food'] ?? 0))
                        || ($forecast['stock']['food'] ?? 0) + 1e-8
                            < min($targets['food'] ?? 0, $baseline['stock']['food'] ?? 0))) {
                    $candidate['reason'] = 'food_reserve';
                } elseif ($best === null || $gain > $best['benefit']) {
                    $best = $candidate;
                }
            } catch (DomainException $error) {
                $candidate['reason'] = $error->getMessage();
            }
            $result['candidates'][] = $candidate;
        }
        if ($best !== null) {
            if (!$preview) {
                // Shared mutation rechecks guards and deducts only physical, unreserved stock.
                $best['queue'] = $economy->queue($cid, $uid, $best['building'], $best['slot'], $now);
            }
            $budget -= $best['policy_cost_cents'];
            $best['status'] = $preview ? 'candidate' : 'executed';
            $result['construction'] = $best;
        } elseif ($result['candidates'] !== []) {
            $result['construction']['reasons'] = array_values(array_unique(array_column(
                array_filter($result['candidates'], static fn(array $item): bool => $item['action'] === 'construction'),
                'reason'
            )));
        }
        return $result + ['budget_after_cents' => $budget];
    }

    private function improvedNeeds(array $before, array $after, array $targets): array
    {
        $needs = [];
        foreach ($targets as $good => $reserve) {
            $current = max(0, $reserve - ($before['stock'][$good] ?? 0));
            $target = max(0, $reserve - ($after['stock'][$good] ?? 0));
            if ($current > $target + 1e-8) {
                $needs[$good] = ['reserve' => $reserve, 'forecast_shortfall_before' => $current,
                    'forecast_shortfall_after' => $target];
            }
        }
        return $needs;
    }

    private function constructionSlot(array $snapshot, string $type): array
    {
        $occupied = [];
        foreach ($snapshot['slots'] as $slot) {
            if ($slot['building_type'] === $type && (int)$slot['level'] > 0) {
                return [(int)$slot['slot_x'], (int)$slot['slot_y']];
            }
            $occupied[$slot['slot_x'] . ':' . $slot['slot_y']] = true;
        }
        for ($y = 0; $y < $snapshot['layout']['grid']['rows']; $y++) {
            for ($x = 0; $x < $snapshot['layout']['grid']['cols']; $x++) {
                if (!isset($occupied[$x . ':' . $y])) {
                    return [$x, $y];
                }
            }
        }
        throw new DomainException('No free surface slots.', 409);
    }

    private function actor(int $uid): ?array
    {
        $row = $this->row('SELECT id,credits,control_type,auth_enabled,deleted_at FROM users WHERE id=?'
            . $this->lock(), [$uid]);
        return $row && $row['control_type'] === 'npc_engine' && (int)$row['auth_enabled'] === 0
            && $row['deleted_at'] === null ? $row : null;
    }

    private function openOrders(int $uid, int $cid): array
    {
        return $this->rows(
            'SELECT o.*,n.expires_window FROM economy_standing_orders o '
            . 'LEFT JOIN economy_npc_orders n ON n.order_id=o.id AND n.user_id=o.user_id '
            . "WHERE o.user_id=? AND o.colony_id=? AND o.status='active' ORDER BY o.id LIMIT 129" . $this->lock(),
            [$uid, $cid]
        );
    }

    private function save(int $uid, int $window, array $summary): array
    {
        $this->db->prepare('UPDATE economy_npc_profiles SET last_window=?,summary_json=? WHERE user_id=?')
            ->execute([$window, json_encode($summary, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), $uid]);
        return $summary;
    }

    private function operation(callable $operation, bool $dryRun): array
    {
        try {
            return (new OnDemandEconomy($this->db))->transaction(static function () use ($operation, $dryRun): array {
                $result = $operation();
                if ($dryRun) {
                    throw new NpcEconomyPreview($result);
                }
                return $result;
            });
        } catch (NpcEconomyPreview $preview) {
            return $preview->summary + ['dry_run' => true];
        }
    }

    private function lock(): string
    {
        return $this->db->inTransaction() && $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql'
            ? ' FOR UPDATE' : '';
    }

    private function row(string $sql, array $params): ?array
    {
        return $this->rows($sql, $params)[0] ?? null;
    }

    private function rows(string $sql, array $params): array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }
}

/** Internal rollback signal for operator previews, including nested savepoints. */
final class NpcEconomyPreview extends RuntimeException
{
    public function __construct(public readonly array $summary)
    {
        parent::__construct('NPC economy preview');
    }
}
